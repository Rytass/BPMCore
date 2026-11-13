import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { readClaimedIds, withDispatchTimeout } from '../common/outbox';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import type { BPMInstanceEventObserver } from './instance-event.token';
import { InstanceEventService } from './instance-event.service';
import type {
  BPMInstanceEvent,
  BPMInstanceEventStatus,
} from './instance-event.types';

/** Dispatches in flight per claim, so one scan cannot saturate the host observer. */
const MAX_CONCURRENT_DISPATCHES = 5;
/** Stored error text is capped; host error messages are not trusted to be short. */
const MAX_ERROR_LENGTH = 500;
/** A claim older than this is treated as abandoned and may be taken over. */
const MIN_STALE_CLAIM_MS = 60_000;
const DAY_MS = 86_400_000;

interface DispatchOutcome {
  readonly kind: 'DELIVERED' | 'FAILED';
  readonly error?: unknown;
}

/**
 * Delivers outbox rows to the host observer (ADR 27 §1.3).
 *
 * Guarantees, and how they are kept:
 * - At least once. A row is `DELIVERED` only after the observer resolved; a
 *   crash between dispatch and write-back redelivers. Hosts dedupe on `id`.
 * - Per-instance order by `seq`. The claim skips a row while an earlier `PENDING`
 *   row of the same instance exists. `FAILED` rows do not block.
 * - Claims never change `status`. A claim is a `claimed_at` stamp, taken with
 *   `FOR UPDATE SKIP LOCKED`, so several replicas can scan at once.
 * - Write-back is conditional on `claimed_at`. A worker that lost its claim
 *   records nothing.
 */
@Injectable()
export class InstanceEventDeliveryService {
  private readonly logger = new Logger(InstanceEventDeliveryService.name);

  constructor(
    @InjectRepository(ApprovalInstanceEventEntity)
    private readonly repository: Repository<ApprovalInstanceEventEntity>,
    private readonly events: InstanceEventService,
  ) {}

  /**
   * Claims and delivers due rows across all instances, up to `batchSize`.
   * Returns the number of rows attempted. No-op without a bound observer.
   */
  async deliverDue(now: Date = new Date()): Promise<number> {
    if (!this.events.enabled) {
      return 0;
    }

    const { batchSize } = this.events.delivery;
    let attempted = 0;

    while (attempted < batchSize) {
      const rows = await this.claim({
        ids: null,
        limit: Math.min(MAX_CONCURRENT_DISPATCHES, batchSize - attempted),
        now,
      });

      if (rows.length === 0) {
        break;
      }

      attempted += rows.length;
      await Promise.all(
        rows.map((row): Promise<void> => this.attemptSafely(row, now)),
      );
    }

    return attempted;
  }

  /**
   * Delivers the named rows. Used by the commit subscriber. A row whose earlier
   * sibling is still pending is skipped here and picked up by the scheduler.
   */
  async deliverByIds(
    ids: readonly string[],
    now: Date = new Date(),
  ): Promise<number> {
    if (!this.events.enabled || ids.length === 0) {
      return 0;
    }

    const rows = await this.claim({
      ids: [...new Set(ids)],
      limit: ids.length,
      now,
    });

    await Promise.all(
      rows.map((row): Promise<void> => this.attemptSafely(row, now)),
    );

    return rows.length;
  }

  /**
   * Deletes `DELIVERED` rows older than `retentionDays`. `FAILED` rows are kept
   * until an operator retries or removes them. Returns the number deleted.
   */
  async purgeDelivered(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.events.delivery.retentionDays * DAY_MS,
    );
    const result = await this.repository.delete({
      deliveredAt: LessThan(cutoff),
      status: 'DELIVERED',
    });

    return result.affected ?? 0;
  }

  /**
   * `base * 2^(attempt - 1)` with ±20 % jitter, capped at `maxRetryDelayMs`.
   * Same policy as the webhook outbox.
   */
  readRetryDelay(attempt: number): number {
    const { maxRetryDelayMs, retryBaseDelayMs } = this.events.delivery;
    const exponential =
      retryBaseDelayMs * 2 ** Math.min(Math.max(attempt - 1, 0), 30);

    return Math.min(
      Math.round(exponential * (0.8 + Math.random() * 0.4)),
      maxRetryDelayMs,
    );
  }

  private async claim({
    ids,
    limit,
    now,
  }: {
    readonly ids: readonly string[] | null;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly ApprovalInstanceEventEntity[]> {
    const staleBefore = new Date(now.getTime() - this.readStaleClaimMs());

    return this.repository.manager.transaction(
      async (manager): Promise<readonly ApprovalInstanceEventEntity[]> => {
        const claimedRows = (await manager.query(
          `
            UPDATE approval_instance_events
               SET claimed_at = $1
             WHERE id IN (
               SELECT e.id
                 FROM approval_instance_events e
                WHERE e.status = $2
                  AND e.next_attempt_at <= $1
                  AND (e.claimed_at IS NULL OR e.claimed_at <= $3)
                  AND ($5::uuid[] IS NULL OR e.id = ANY($5::uuid[]))
                  AND NOT EXISTS (
                    SELECT 1
                      FROM approval_instance_events earlier
                     WHERE earlier.instance_id = e.instance_id
                       AND earlier.seq < e.seq
                       AND earlier.status = $2
                  )
                ORDER BY e.seq ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $4
             )
             RETURNING id
          `,
          [now, 'PENDING', staleBefore, limit, ids ? [...ids] : null],
        )) as unknown;
        const claimedIds = readClaimedIds(claimedRows);

        if (claimedIds.length === 0) {
          return [];
        }

        const found = await manager
          .getRepository(ApprovalInstanceEventEntity)
          .find({ where: { id: In([...claimedIds]) } });

        return [...found].sort(
          (left, right): number => Number(left.seq) - Number(right.seq),
        );
      },
    );
  }

  private async attemptSafely(
    row: ApprovalInstanceEventEntity,
    claimedAt: Date,
  ): Promise<void> {
    try {
      await this.attempt(row, claimedAt);
    } catch (error: unknown) {
      this.logger.warn(
        `Instance event ${row.id} could not record its outcome (${readErrorName(error)})`,
      );
    }
  }

  private async attempt(
    row: ApprovalInstanceEventEntity,
    claimedAt: Date,
  ): Promise<void> {
    const observer = this.events.observer;

    if (observer === null) {
      return;
    }

    const { dispatchTimeoutMs, maxAttempts } = this.events.delivery;
    const attemptCount = row.attemptCount + 1;
    const outcome = await withDispatchTimeout(
      this.dispatch(observer, row),
      dispatchTimeoutMs,
    ).then(
      (): DispatchOutcome => ({ kind: 'DELIVERED' }),
      (error: unknown): DispatchOutcome => ({ error, kind: 'FAILED' }),
    );

    if (outcome.kind === 'DELIVERED') {
      await this.writeOutcome(row, claimedAt, {
        attemptCount,
        claimedAt: null,
        deliveredAt: new Date(),
        lastError: null,
        status: 'DELIVERED',
      });

      return;
    }

    const terminal = attemptCount >= maxAttempts;

    await this.writeOutcome(row, claimedAt, {
      attemptCount,
      claimedAt: null,
      lastError: readErrorText(outcome.error),
      nextAttemptAt: terminal
        ? row.nextAttemptAt
        : new Date(Date.now() + this.readRetryDelay(attemptCount)),
      status: terminal ? 'FAILED' : 'PENDING',
    });
  }

  private async dispatch(
    observer: BPMInstanceEventObserver,
    row: ApprovalInstanceEventEntity,
  ): Promise<void> {
    await observer.onInstanceEvent(toObserverEvent(row));
  }

  private async writeOutcome(
    row: ApprovalInstanceEventEntity,
    claimedAt: Date,
    changes: {
      readonly attemptCount: number;
      readonly claimedAt: Date | null;
      readonly deliveredAt?: Date;
      readonly lastError: string | null;
      readonly nextAttemptAt?: Date;
      readonly status: BPMInstanceEventStatus;
    },
  ): Promise<void> {
    const result = await this.repository.update(
      { claimedAt, id: row.id },
      changes,
    );

    if (!result.affected) {
      this.logger.warn(
        `Instance event ${row.id} lost its claim before the outcome was recorded`,
      );
    }
  }

  private readStaleClaimMs(): number {
    return Math.max(
      this.events.delivery.dispatchTimeoutMs * 3,
      MIN_STALE_CLAIM_MS,
    );
  }
}

/** Reads a stored row as the observer sees it. Payloads never hold `formData`. */
function toObserverEvent(row: ApprovalInstanceEventEntity): BPMInstanceEvent {
  return {
    ...row.payload,
    id: row.id,
    instanceId: row.instanceId,
    occurredAt: row.occurredAt.toISOString(),
    seq: row.seq,
    type: row.type,
  } as BPMInstanceEvent;
}

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function readErrorText(error: unknown): string {
  const name = readErrorName(error);
  const message = error instanceof Error ? error.message : '';

  return `${name}: ${message}`.slice(0, MAX_ERROR_LENGTH);
}
