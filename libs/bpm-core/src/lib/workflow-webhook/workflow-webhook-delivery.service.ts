import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  InjectionToken,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';
import { readClaimedIds, withDispatchTimeout } from '../common/outbox';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ActivityLogEventTypeEnum } from '../workflow-engine/workflow-engine.enums';
import { readNotifyWebhookStructureIssues } from '@rytass/bpm-core-shared/workflow-graph';
import { isWorkflowWebhookUrlAllowed } from './workflow-webhook-allowlist';
import {
  WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES,
  WorkflowWebhookDeliveryStatusEnum,
} from './workflow-webhook-delivery.enums';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import {
  buildWorkflowWebhookDeliveryDrafts,
  WorkflowWebhookEnqueueContext,
} from './workflow-webhook-enqueue';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMResolvedWorkflowWebhookOptions,
  DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
} from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookEvent,
  BPMWorkflowWebhookRequest,
} from './workflow-webhook.types';

export type WorkflowWebhookFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * The HTTP client deliveries go through. Defaults to the global `fetch`;
 * bound mainly so tests can observe requests without a network.
 */
export const BPM_WORKFLOW_WEBHOOK_FETCH: InjectionToken<WorkflowWebhookFetch> =
  Symbol('BPM_WORKFLOW_WEBHOOK_FETCH');

/** How much of a failing response body an administrator gets to see. */
const MAX_ERROR_DETAIL_LENGTH = 500;

/** Bytes read from a failing response before the rest is discarded. */
const MAX_ERROR_BODY_BYTES = 4_096;

const ALLOWED_METHODS: readonly string[] = ['PATCH', 'POST', 'PUT'];

/** Deliveries from one claimed batch that are attempted at the same time. */
const MAX_CONCURRENT_ATTEMPTS = 5;

/**
 * A claimed row whose attempt never wrote back is reclaimable after this. Rows
 * are claimed no more than {@link MAX_CONCURRENT_ATTEMPTS} at a time and all of
 * them start at once, so no claimed row ever waits in a queue: the window only
 * has to cover one `buildRequest()` plus one request (30 s each at most) and
 * the write.
 */
const STALE_CLAIM_MS = WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS * 3;

/** The columns an attempt writes back; never the frozen event. */
type DeliveryOutcomeColumns = Pick<
  WorkflowWebhookDeliveryEntity,
  | 'attemptCount'
  | 'lastErrorCode'
  | 'lastErrorDetail'
  | 'lastResponseStatus'
  | 'nextRetryAt'
  | 'status'
> &
  Partial<Pick<WorkflowWebhookDeliveryEntity, 'sentAt'>>;

/** What an administrator's test send came back with. */
export interface WorkflowWebhookTestOutcome {
  readonly errorCode: string | null;
  /** Error kind, network code or a truncated response body; never the URL. */
  readonly errorDetail: string | null;
  readonly ok: boolean;
  readonly status: number | null;
}

type AttemptOutcome =
  | { readonly kind: 'SENT'; readonly status: number }
  | {
      readonly code: string;
      readonly detail: string | null;
      readonly kind: 'RETRY' | 'FAIL';
      readonly status: number | null;
    };

@Injectable()
export class WorkflowWebhookDeliveryService {
  private readonly logger = new Logger(WorkflowWebhookDeliveryService.name);
  private readonly fetchImpl: WorkflowWebhookFetch;

  constructor(
    @InjectRepository(WorkflowWebhookDeliveryEntity)
    private readonly deliveryRepository: Repository<WorkflowWebhookDeliveryEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
    private readonly webhookService: WorkflowWebhookService,
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_OPTIONS)
    private readonly options: BPMResolvedWorkflowWebhookOptions = DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_FETCH)
    fetchImpl?: WorkflowWebhookFetch,
  ) {
    this.fetchImpl =
      fetchImpl ??
      ((input: string, init: RequestInit): Promise<Response> =>
        fetch(input, init));
  }

  /** The clock every attempt reads; separate so tests can pin it. */
  readCurrentTime(): Date {
    return new Date();
  }

  /**
   * Queues a NOTIFY node's webhooks inside the engine transaction `manager`.
   * Sends nothing: delivery starts only once that transaction commits
   * (ADR 18 §3.5). Rows that can already be judged undeliverable are written
   * as `FAILED` together with their terminal activity log.
   */
  async enqueueNotifyWebhooks(
    manager: EntityManager,
    context: WorkflowWebhookEnqueueContext,
    targets: unknown,
  ): Promise<readonly string[]> {
    const listIssues = readNotifyWebhookStructureIssues(targets).filter(
      (issue) => issue.targetIndex === null,
    );

    // Publish refuses these, so reaching one means the snapshot was written
    // around the lint. Nothing can be queued, but it must not pass silently.
    if (listIssues.length) {
      this.logger.warn(
        `Instance ${context.instance.id} node ${context.node.id}: webhooks not queued (${listIssues
          .map((issue) => issue.code)
          .join(', ')})`,
      );
    }

    const drafts = await buildWorkflowWebhookDeliveryDrafts({
      context,
      resolveEndpoint: (key, version) =>
        this.webhookService.getEndpoint(key, version, manager),
      targets,
    });

    if (!drafts.length) {
      return [];
    }

    const repository = manager.getRepository(WorkflowWebhookDeliveryEntity);
    const saved = await repository.save(
      drafts.map((draft) => repository.create({ ...draft, attemptCount: 0 })),
    );
    const failed = saved.filter(
      (row) => row.status === WorkflowWebhookDeliveryStatusEnum.FAILED,
    );

    if (failed.length) {
      const activityRepository = manager.getRepository(ActivityLogEntity);

      const activities = await Promise.all(
        failed.map(async (row) =>
          activityRepository.create(
            this.createTerminalActivity(
              row,
              await this.readEndpointLabel(row, manager),
            ),
          ),
        ),
      );

      await activityRepository.save(activities);
    }

    return saved.map((row) => row.id);
  }

  /** Every delivery queued for an instance, oldest first (ADR 18 §3.10). */
  async listInstanceDeliveries(
    instanceId: string,
  ): Promise<readonly WorkflowWebhookDeliveryEntity[]> {
    return this.deliveryRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  /**
   * Puts a `FAILED` delivery back in the queue with a fresh attempt budget
   * and starts it at once. The delivery id does not change, so a receiver
   * that already processed an earlier attempt still recognizes it.
   *
   * Only `FAILED` rows that were actually attempted qualify. A row in flight
   * or already sent would be sent again; a row that failed while being queued
   * (endpoint missing, lookup failed, parameter invalid) froze an event that
   * never passed the parameter checks, and sending it would break the
   * endpoint's contract. The state change and the audit entry commit together.
   */
  async retryFailedDelivery(
    id: string,
    actorMemberId: string | null,
  ): Promise<WorkflowWebhookDeliveryEntity> {
    const existing = await this.deliveryRepository.findOne({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Webhook delivery ${id} was not found`);
    }

    // Read before the transaction: a host lookup has no business holding the
    // row lock or a second pooled connection.
    const endpointLabel = await this.readEndpointLabel(existing);
    const retried = await this.deliveryRepository.manager.transaction(
      async (manager): Promise<WorkflowWebhookDeliveryEntity> => {
        const repository = manager.getRepository(WorkflowWebhookDeliveryEntity);
        const result = await repository.update(
          {
            attemptCount: MoreThan(0),
            id,
            status: WorkflowWebhookDeliveryStatusEnum.FAILED,
          },
          {
            attemptCount: 0,
            nextRetryAt: null,
            status: WorkflowWebhookDeliveryStatusEnum.PENDING,
          },
        );
        const row = await repository.findOne({ where: { id } });

        if (!row) {
          throw new NotFoundException(`Webhook delivery ${id} was not found`);
        }

        if (!result.affected) {
          throw new BadRequestException(
            row.status === WorkflowWebhookDeliveryStatusEnum.FAILED
              ? `Webhook delivery ${id} failed before it was ever sent (${row.lastErrorCode ?? 'unknown'}) and cannot be retried`
              : `Webhook delivery ${id} is ${row.status}; only FAILED deliveries can be retried`,
          );
        }

        const activityRepository = manager.getRepository(ActivityLogEntity);

        await activityRepository.save(
          activityRepository.create({
            actorMemberId,
            eventType: ActivityLogEventTypeEnum.WEBHOOK_DELIVERY_RETRIED,
            instanceId: row.instanceId,
            nodeId: row.nodeId,
            payload: {
              action: 'NOTIFY_WEBHOOK',
              deliveryId: row.id,
              endpointKey: row.endpointKey,
              endpointLabel,
              endpointVersion: row.endpointVersion,
              previousErrorCode: row.lastErrorCode,
              targetId: row.targetId,
            },
            taskId: null,
          }),
        );

        return row;
      },
    );

    // After the commit, like the subscriber's kick: the scheduler would get
    // there too, but an administrator who pressed retry expects an answer now.
    setImmediate((): void => {
      this.deliverByIds([retried.id]).catch((error: unknown): void => {
        this.logger.warn(
          `Retried webhook delivery ${retried.id} could not start immediately (${readErrorName(error)})`,
        );
      });
    });

    return retried;
  }

  /**
   * One scheduler pass: claim what is due, a few rows at a time, until the
   * batch size is reached or nothing more is due.
   *
   * Claiming the whole batch up front and attempting it a few at a time left
   * the rows at the back holding a claim while they waited; past the stale
   * window another worker took them over. Claiming only what starts at once
   * means a claimed row is always a row in flight.
   */
  async deliverDue(now?: Date): Promise<number> {
    const { batchSize } = this.options.delivery;
    let total = 0;

    while (total < batchSize) {
      const claimed = await this.claim({
        ids: null,
        limit: Math.min(MAX_CONCURRENT_ATTEMPTS, batchSize - total),
        now: total === 0 && now ? now : this.readCurrentTime(),
      });

      if (!claimed.length) {
        break;
      }

      await this.attemptTogether(claimed);
      total += claimed.length;
    }

    return total;
  }

  /**
   * Attempts specific rows right after the transaction that queued them
   * committed, in groups that start together. Rows another worker already
   * claimed, or that are not due, are skipped by the claim itself.
   */
  async deliverByIds(ids: readonly string[], now?: Date): Promise<number> {
    const unique = [...new Set(ids)];
    let total = 0;

    for (
      let start = 0;
      start < unique.length;
      start += MAX_CONCURRENT_ATTEMPTS
    ) {
      const group = unique.slice(start, start + MAX_CONCURRENT_ATTEMPTS);
      const claimed = await this.claim({
        ids: group,
        limit: group.length,
        now: start === 0 && now ? now : this.readCurrentTime(),
      });

      await this.attemptTogether(claimed);
      total += claimed.length;
    }

    return total;
  }

  /**
   * Starts every claimed row at once (never more than
   * {@link MAX_CONCURRENT_ATTEMPTS}). Strictly one by one, a single receiver
   * that runs into its timeout held every other delivery back by that long
   * (seen on the wrapper host: a 10 s timeout delayed an unrelated endpoint by
   * 10 s). Each row still re-stamps and writes back under its own claim.
   */
  private async attemptTogether(
    rows: readonly WorkflowWebhookDeliveryEntity[],
  ): Promise<void> {
    await Promise.all(rows.map((row) => this.attemptSafely(row)));
  }

  private async attemptSafely(
    row: WorkflowWebhookDeliveryEntity,
  ): Promise<void> {
    try {
      await this.attempt(row);
    } catch (error: unknown) {
      // Only a failed write can land here. The row stays claimed and the
      // stale window hands it to a later scan. The error's name only: a
      // driver message can quote the parameters it was given.
      this.logger.error(
        `Webhook delivery ${row.id} could not record its outcome (${readErrorName(error)})`,
      );
    }
  }

  private async claim({
    ids,
    limit,
    now,
  }: {
    readonly ids: readonly string[] | null;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly WorkflowWebhookDeliveryEntity[]> {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);

    return this.deliveryRepository.manager.transaction(
      async (manager): Promise<readonly WorkflowWebhookDeliveryEntity[]> => {
        const claimedRows = (await manager.query(
          `
            UPDATE workflow_webhook_deliveries
               SET status = $1,
                   last_attempt_at = $2,
                   updated_at = $2
             WHERE id IN (
               SELECT id
                 FROM workflow_webhook_deliveries
                WHERE (
                    (status = $3 AND (next_retry_at IS NULL OR next_retry_at <= $2))
                    OR (status = $1 AND last_attempt_at <= $4)
                  )
                  AND ($6::uuid[] IS NULL OR id = ANY($6::uuid[]))
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $5
             )
             RETURNING id
          `,
          [
            WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
            now,
            WorkflowWebhookDeliveryStatusEnum.PENDING,
            staleBefore,
            limit,
            ids ? [...ids] : null,
          ],
        )) as unknown;
        const claimedIds = readClaimedIds(claimedRows);

        return claimedIds.length
          ? manager
              .getRepository(WorkflowWebhookDeliveryEntity)
              .find({ where: { id: In([...claimedIds]) } })
          : [];
      },
    );
  }

  private async attempt(row: WorkflowWebhookDeliveryEntity): Promise<void> {
    const startedAt = this.readCurrentTime();

    // Re-stamping at the start of the attempt confirms this worker still owns
    // the row: if another one reclaimed it between the claim and this line,
    // the stamp no longer matches and this attempt stands down instead of
    // sending a second time.
    if (!(await this.moveClaim(row, row.lastAttemptAt, startedAt))) {
      return;
    }

    const claimed: WorkflowWebhookDeliveryEntity = {
      ...row,
      lastAttemptAt: startedAt,
    };
    const attempt = row.attemptCount + 1;
    const outcome = await this.resolveOutcome(claimed, attempt).catch(
      (error: unknown): AttemptOutcome => ({
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.INTERNAL_ERROR,
        detail: readErrorName(error),
        kind: 'RETRY',
        status: null,
      }),
    );

    await this.record(claimed, attempt, outcome, this.readCurrentTime());
  }

  private async resolveOutcome(
    row: WorkflowWebhookDeliveryEntity,
    attempt: number,
  ): Promise<AttemptOutcome> {
    const lookup = await this.webhookService
      .getEndpoint(row.endpointKey, row.endpointVersion)
      .then(
        (entry) => ({ entry }),
        (error: unknown) => ({ error }),
      );

    if ('error' in lookup) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_LOOKUP_FAILED,
        detail: readErrorName(lookup.error),
        kind: 'RETRY',
        status: null,
      };
    }

    if (!lookup.entry) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_MISSING,
        detail: `${row.endpointKey}@${row.endpointVersion} is not registered`,
        kind: 'FAIL',
        status: null,
      };
    }

    // Checked per attempt: disabling an endpoint stops what is already queued.
    if (lookup.entry.endpoint.descriptor.disabled) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_DISABLED,
        detail: `${row.endpointKey}@${row.endpointVersion} is disabled`,
        kind: 'FAIL',
        status: null,
      };
    }

    return this.sendEvent(lookup.entry, {
      ...row.event,
      attempt,
      deliveryId: row.id,
      eventType: 'workflow.notify',
    });
  }

  /**
   * Sends one event to an endpoint exactly as a delivery attempt would —
   * same refusals, allowlist, timeout, redirect handling and signature —
   * without a delivery row, for an administrator's test send (ADR 18 §3.13).
   * The endpoint may be disabled: testing before enabling is the point.
   */
  async sendTestEvent(
    entry: BPMWorkflowWebhookEndpointEntry,
    event: BPMWorkflowWebhookEvent,
  ): Promise<WorkflowWebhookTestOutcome> {
    const outcome = await this.sendEvent(entry, event).catch(
      (error: unknown): AttemptOutcome => ({
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.INTERNAL_ERROR,
        detail: readErrorName(error),
        kind: 'FAIL',
        status: null,
      }),
    );

    return outcome.kind === 'SENT'
      ? { errorCode: null, errorDetail: null, ok: true, status: outcome.status }
      : {
          errorCode: outcome.code,
          errorDetail: outcome.detail ? truncate(outcome.detail) : null,
          ok: false,
          status: outcome.status,
        };
  }

  private async sendEvent(
    entry: BPMWorkflowWebhookEndpointEntry,
    event: BPMWorkflowWebhookEvent,
  ): Promise<AttemptOutcome> {
    // Wrapped so a host that throws synchronously, or returns a non-promise,
    // is judged like any other failure instead of escaping the attempt.
    const built = await withDispatchTimeout(
      Promise.resolve().then(() => entry.endpoint.buildRequest(event)),
      WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
    ).then(
      (value: unknown) => ({ value }),
      (error: unknown) => ({ error }),
    );

    if ('error' in built) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.BUILD_REQUEST_FAILED,
        // The host's message may name the secret it failed to read, so only
        // the error's kind is kept.
        detail: readErrorName(built.error),
        kind: 'RETRY',
        status: null,
      };
    }

    if (!isWebhookRequest(built.value)) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.INVALID_REQUEST,
        detail: 'buildRequest did not return a request with a string url',
        kind: 'FAIL',
        status: null,
      };
    }

    const request = built.value;
    const refusal = this.readRequestRefusal(request, entry);

    if (refusal) {
      return refusal;
    }

    const body = request.body ?? JSON.stringify(event);
    const timeoutMs = Math.min(
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? request.timeoutMs
        : this.options.delivery.defaultTimeoutMs,
      WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
    );

    return this.post({
      body,
      // Signed at the moment of sending, not when the row was claimed, so a
      // receiver's replay window measures the request it actually got.
      headers: buildHeaders(
        request,
        body,
        event.deliveryId,
        this.readCurrentTime(),
      ),
      method: request.method ?? 'POST',
      timeoutMs,
      url: request.url,
    });
  }

  /**
   * A request BPM refuses to send at all. These never become retryable: the
   * same endpoint would return the same request next time. None of the
   * details quote the URL.
   */
  private readRequestRefusal(
    request: BPMWorkflowWebhookRequest,
    entry: BPMWorkflowWebhookEndpointEntry,
  ): AttemptOutcome | null {
    const invalid = (detail: string): AttemptOutcome => ({
      code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.INVALID_REQUEST,
      detail,
      kind: 'FAIL',
      status: null,
    });
    const parsed = ((): URL | null => {
      try {
        return new URL(request.url);
      } catch {
        return null;
      }
    })();

    if (
      !parsed ||
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    ) {
      return invalid('buildRequest returned a URL that is not http(s)');
    }

    if (parsed.username || parsed.password) {
      return invalid('buildRequest returned a URL that carries credentials');
    }

    if (
      request.method !== undefined &&
      !ALLOWED_METHODS.includes(String(request.method))
    ) {
      return invalid(
        'buildRequest returned a method other than POST, PUT or PATCH',
      );
    }

    if (request.body !== undefined && typeof request.body !== 'string') {
      return invalid('buildRequest returned a body that is not a string');
    }

    const enforceAllowlist =
      entry.source === 'DATABASE' || this.options.enforceAllowlistForRegistry;

    // Checked on every attempt, not only when the endpoint was saved, so
    // tightening the allowlist stops deliveries that are already queued.
    if (
      enforceAllowlist &&
      !isWorkflowWebhookUrlAllowed(request.url, this.options.allowedUrlPatterns)
    ) {
      return {
        code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.URL_NOT_ALLOWED,
        detail: null,
        kind: 'FAIL',
        status: null,
      };
    }

    return null;
  }

  private async post({
    body,
    headers,
    method,
    timeoutMs,
    url,
  }: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: string;
    readonly timeoutMs: number;
    readonly url: string;
  }): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const timer = setTimeout((): void => controller.abort(), timeoutMs);

    timer.unref();

    try {
      const response = await this.fetchImpl(url, {
        body,
        headers,
        method,
        // A 3xx is a failure, never followed: an allowed host must not be
        // able to bounce the request somewhere the allowlist would refuse.
        redirect: 'manual',
        signal: controller.signal,
      });
      const status = response.status;

      if (status >= 200 && status < 300) {
        await discardBody(response);

        return { kind: 'SENT', status };
      }

      // `redirect: 'manual'` surfaces as an opaque redirect with status 0 in
      // spec-compliant fetch implementations and as the raw 3xx in Node's.
      if (
        response.type === 'opaqueredirect' ||
        (status >= 300 && status < 400)
      ) {
        await discardBody(response);

        return {
          code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.REDIRECT,
          detail: null,
          kind: 'FAIL',
          status: status || null,
        };
      }

      const detail = truncate(await readBodyPrefix(response));

      return {
        code: `WEBHOOK_HTTP_${status}`,
        detail: detail || null,
        kind: isRetryableStatus(status) ? 'RETRY' : 'FAIL',
        status,
      };
    } catch (error: unknown) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');

      return {
        code: aborted
          ? WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.TIMEOUT
          : WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.NETWORK,
        // A fetch error message can quote the URL; the system error code
        // (ECONNREFUSED, ENOTFOUND, ...) says what happened without it.
        detail: aborted ? null : readNetworkErrorCode(error),
        kind: 'RETRY',
        status: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async record(
    row: WorkflowWebhookDeliveryEntity,
    attempt: number,
    outcome: AttemptOutcome,
    finishedAt: Date,
  ): Promise<void> {
    const exhausted =
      outcome.kind === 'RETRY' && attempt >= this.options.delivery.maxAttempts;
    const terminal = outcome.kind !== 'RETRY' || exhausted;
    const changes: DeliveryOutcomeColumns =
      outcome.kind === 'SENT'
        ? {
            attemptCount: attempt,
            lastErrorCode: null,
            lastErrorDetail: null,
            lastResponseStatus: outcome.status,
            nextRetryAt: null,
            sentAt: finishedAt,
            status: WorkflowWebhookDeliveryStatusEnum.SENT,
          }
        : {
            attemptCount: attempt,
            lastErrorCode: outcome.code,
            // Every detail source passes through here, so every one is made
            // storable — including a host error's `name`.
            lastErrorDetail:
              outcome.detail === null ? null : truncate(String(outcome.detail)),
            lastResponseStatus: outcome.status,
            nextRetryAt: terminal
              ? null
              : new Date(finishedAt.getTime() + this.readRetryDelay(attempt)),
            status: terminal
              ? WorkflowWebhookDeliveryStatusEnum.FAILED
              : WorkflowWebhookDeliveryStatusEnum.PENDING,
          };

    // Written only if this worker still holds the claim it started with, so a
    // late write-back can never overwrite what another worker already
    // recorded — a SENT row least of all.
    const result = await this.deliveryRepository.update(
      {
        id: row.id,
        lastAttemptAt: row.lastAttemptAt ?? IsNull(),
        status: WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
      },
      changes,
    );

    if (!result.affected) {
      this.logger.warn(
        `Webhook delivery ${row.id} was reclaimed before attempt ${attempt} finished; its outcome was discarded`,
      );

      return;
    }

    // Intermediate retries stay off the instance timeline; only the final
    // word about a delivery is worth a reader's attention (ADR 18 §3.10).
    if (terminal) {
      // The outcome is already recorded; a failed timeline write must not be
      // reported as if the delivery itself were unrecorded.
      const endpointLabel = await this.readEndpointLabel(row);

      await this.activityLogRepository
        .save(
          this.activityLogRepository.create(
            this.createTerminalActivity({ ...row, ...changes }, endpointLabel),
          ),
        )
        .catch((error: unknown): void => {
          this.logger.error(
            `Webhook delivery ${row.id} is ${changes.status} but its activity log could not be written (${readErrorName(error)})`,
          );
        });
    }
  }

  /**
   * The endpoint's display name for the timeline, which every reader of the
   * instance sees; `null` when the endpoint is gone and the key must stand in.
   */
  async readEndpointLabel(
    row: Pick<WorkflowWebhookDeliveryEntity, 'endpointKey' | 'endpointVersion'>,
    manager?: EntityManager,
  ): Promise<string | null> {
    // Every step is guarded: a host entry missing its descriptor must cost
    // the label, not the activity log it is written into.
    return Promise.resolve()
      .then(() =>
        this.webhookService.getEndpoint(
          row.endpointKey,
          row.endpointVersion,
          manager,
        ),
      )
      .then((entry): string | null => {
        const label = (
          entry as {
            readonly endpoint?: {
              readonly descriptor?: { readonly label?: unknown };
            };
          } | null
        )?.endpoint?.descriptor?.label;

        return typeof label === 'string' ? label : null;
      })
      .catch((): null => null);
  }

  /** Takes the claim over from `from` to `to`; `false` if it moved on. */
  private async moveClaim(
    row: WorkflowWebhookDeliveryEntity,
    from: Date | null,
    to: Date,
  ): Promise<boolean> {
    const result = await this.deliveryRepository.update(
      {
        id: row.id,
        lastAttemptAt: from ?? IsNull(),
        status: WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
      },
      { lastAttemptAt: to },
    );

    return Boolean(result.affected);
  }

  /**
   * `base * 2^(attempt - 1)` with ±20 % jitter so a receiver that came back up
   * is not hit by every queued delivery in the same second, then capped: the
   * cap is a promise to the operator, so jitter may not exceed it.
   */
  readRetryDelay(attempt: number): number {
    const { maxRetryDelayMs, retryBaseDelayMs } = this.options.delivery;
    const exponential =
      retryBaseDelayMs * 2 ** Math.min(Math.max(attempt - 1, 0), 30);

    return Math.min(
      Math.round(exponential * (0.8 + Math.random() * 0.4)),
      maxRetryDelayMs,
    );
  }

  /**
   * Visible to everyone who can read the instance, so it carries the outcome
   * and nothing else: no URL, no response body, no parameters.
   */
  private createTerminalActivity(
    row: Pick<
      WorkflowWebhookDeliveryEntity,
      | 'attemptCount'
      | 'endpointKey'
      | 'endpointVersion'
      | 'id'
      | 'instanceId'
      | 'lastErrorCode'
      | 'lastResponseStatus'
      | 'nodeId'
      | 'status'
      | 'targetId'
    >,
    endpointLabel: string | null,
  ): Partial<ActivityLogEntity> {
    return {
      actorMemberId: null,
      eventType:
        row.status === WorkflowWebhookDeliveryStatusEnum.SENT
          ? ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED
          : ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
      instanceId: row.instanceId,
      nodeId: row.nodeId,
      payload: {
        action: 'NOTIFY_WEBHOOK',
        attempts: row.attemptCount,
        deliveryId: row.id,
        endpointKey: row.endpointKey,
        endpointLabel,
        endpointVersion: row.endpointVersion,
        errorCode: row.lastErrorCode,
        status: row.lastResponseStatus,
        targetId: row.targetId,
      },
      taskId: null,
    };
  }
}

function isWebhookRequest(value: unknown): value is BPMWorkflowWebhookRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly url?: unknown }).url === 'string'
  );
}

function buildHeaders(
  request: BPMWorkflowWebhookRequest,
  body: string,
  deliveryId: string,
  sentAt: Date,
): Readonly<Record<string, string>> {
  const hostHeaders = Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(
      ([name, value]) =>
        typeof value === 'string' && !name.toLowerCase().startsWith('x-bpm-'),
    ),
  );
  const hasContentType = Object.keys(hostHeaders).some(
    (name) => name.toLowerCase() === 'content-type',
  );
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));

  // BPM's own headers are applied last and a host cannot supply an
  // `x-bpm-*` header, so a receiver can trust them.
  return {
    ...(hasContentType ? {} : { 'content-type': 'application/json' }),
    ...hostHeaders,
    'x-bpm-delivery-id': deliveryId,
    'x-bpm-event': 'workflow.notify',
    ...(request.signingSecret
      ? {
          'x-bpm-signature-sha256': createHmac('sha256', request.signingSecret)
            .update(`${timestamp}.${body}`)
            .digest('hex'),
          'x-bpm-timestamp': timestamp,
        }
      : {}),
  };
}

/** Releases the connection without reading a body nobody will look at. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch((): void => undefined);
}

/**
 * Reads at most {@link MAX_ERROR_BODY_BYTES} of a failing response, so a
 * receiver answering with megabytes of HTML cannot make BPM buffer them.
 */
async function readBodyPrefix(response: Response): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return response.text().catch(() => '');
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (received < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();

      if (done || !value) {
        break;
      }

      chunks.push(value);
      received += value.byteLength;
    }
  } catch {
    // A body that fails mid-read still says something; keep what arrived.
  } finally {
    await reader.cancel().catch((): void => undefined);
  }

  return new TextDecoder()
    .decode(Buffer.concat(chunks).subarray(0, MAX_ERROR_BODY_BYTES))
    .replace(/�+$/u, '');
}

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function readNetworkErrorCode(error: unknown): string {
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error
      ? (error as { readonly cause: unknown }).cause
      : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { readonly code: unknown }).code
      : undefined;

  return typeof code === 'string' ? code : readErrorName(error);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Makes a receiver-supplied string safe to store: PostgreSQL `text` rejects
 * NUL, and a write that always fails would leave the row claimed and resent
 * forever instead of counting towards `maxAttempts`.
 */
function truncate(value: string): string {
  const storable = value.split('\u0000').join('');

  return storable.length > MAX_ERROR_DETAIL_LENGTH
    ? storable.slice(0, MAX_ERROR_DETAIL_LENGTH)
    : storable;
}
