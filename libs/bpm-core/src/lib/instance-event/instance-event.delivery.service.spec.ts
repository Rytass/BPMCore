import { LessThan } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';
import {
  DEFAULT_BPM_INSTANCE_EVENT_DELIVERY_OPTIONS,
  BPMInstanceEventDeliveryOptions,
} from './instance-event.options';
import type { InstanceEventService } from './instance-event.service';
import type { BPMInstanceEventObserver } from './instance-event.token';

const NOW = new Date('2026-11-14T00:00:00.000Z');
const CLAIMED_AT = NOW;

interface FakeRowOverrides {
  readonly attemptCount?: number;
  readonly id?: string;
  readonly seq?: string;
}

function createRow(
  overrides: FakeRowOverrides = {},
): ApprovalInstanceEventEntity {
  return {
    attemptCount: overrides.attemptCount ?? 0,
    claimedAt: CLAIMED_AT,
    deliveredAt: null,
    id: overrides.id ?? 'event-1',
    instanceId: 'instance-1',
    lastError: null,
    nextAttemptAt: new Date('2026-11-13T23:00:00.000Z'),
    occurredAt: new Date('2026-11-13T22:59:00.000Z'),
    payload: { actorMemberId: 'member-2', nodeId: 'node-3' },
    seq: overrides.seq ?? '7',
    status: 'PENDING',
    type: 'INSTANCE_RETURNED',
  } as unknown as ApprovalInstanceEventEntity;
}

interface FakeHarness {
  readonly query: jest.Mock;
  readonly update: jest.Mock;
  readonly remove: jest.Mock;
  readonly find: jest.Mock;
  readonly service: InstanceEventDeliveryService;
}

function createHarness(options: {
  readonly observer: BPMInstanceEventObserver | null;
  readonly delivery?: Partial<BPMInstanceEventDeliveryOptions>;
  readonly claimBatches?: readonly (readonly ApprovalInstanceEventEntity[])[];
  readonly updateAffected?: number;
}): FakeHarness {
  const batches = [...(options.claimBatches ?? [])];
  let lastClaim: readonly ApprovalInstanceEventEntity[] = [];

  // `UPDATE ... RETURNING` in the TypeORM Postgres shape: [rows, affected].
  const query = jest.fn((): Promise<unknown> => {
    lastClaim = batches.shift() ?? [];

    return Promise.resolve([
      lastClaim.map((row) => ({ id: row.id })),
      lastClaim.length,
    ]);
  });
  const find = jest.fn((): Promise<readonly ApprovalInstanceEventEntity[]> =>
    Promise.resolve(lastClaim),
  );
  const manager = {
    getRepository: (): { readonly find: jest.Mock } => ({ find }),
    query,
  } as unknown as EntityManager;
  const update = jest.fn((): Promise<{ readonly affected: number }> =>
    Promise.resolve({ affected: options.updateAffected ?? 1 }),
  );
  const remove = jest.fn((): Promise<{ readonly affected: number }> =>
    Promise.resolve({ affected: 2 }),
  );
  const repository = {
    delete: remove,
    manager: {
      transaction: (
        callback: (entityManager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    },
    update,
  } as unknown as Repository<ApprovalInstanceEventEntity>;
  const events = {
    delivery: {
      ...DEFAULT_BPM_INSTANCE_EVENT_DELIVERY_OPTIONS,
      ...options.delivery,
    },
    enabled: options.observer !== null,
    observer: options.observer,
  } as unknown as InstanceEventService;

  return {
    find,
    query,
    remove,
    service: new InstanceEventDeliveryService(repository, events),
    update,
  };
}

describe('InstanceEventDeliveryService', (): void => {
  it('does nothing and never claims when no observer is bound', async (): Promise<void> => {
    const { query, service } = createHarness({ observer: null });

    await expect(service.deliverDue(NOW)).resolves.toBe(0);
    await expect(service.deliverByIds(['event-1'], NOW)).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('claims with the ordering guard and SKIP LOCKED', async (): Promise<void> => {
    const { query, service } = createHarness({
      claimBatches: [[]],
      observer: { onInstanceEvent: (): void => undefined },
    });

    await service.deliverDue(NOW);

    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('earlier.seq < e.seq');
    expect(sql).toContain('earlier.status = $2');
    expect(query.mock.calls[0]?.[1]?.[1]).toBe('PENDING');
  });

  it('dispatches the row without formData and marks it DELIVERED', async (): Promise<void> => {
    const received: unknown[] = [];
    const observer: BPMInstanceEventObserver = {
      onInstanceEvent: (event): void => {
        received.push(event);
      },
    };
    const row = createRow();
    const { service, update } = createHarness({
      claimBatches: [[row], []],
      observer,
    });

    await expect(service.deliverDue(NOW)).resolves.toBe(1);

    expect(received).toEqual([
      {
        actorMemberId: 'member-2',
        id: 'event-1',
        instanceId: 'instance-1',
        nodeId: 'node-3',
        occurredAt: '2026-11-13T22:59:00.000Z',
        seq: '7',
        type: 'INSTANCE_RETURNED',
      },
    ]);
    expect(JSON.stringify(received)).not.toContain('formData');
    expect(update).toHaveBeenCalledWith(
      { claimedAt: CLAIMED_AT, id: 'event-1' },
      expect.objectContaining({
        attemptCount: 1,
        claimedAt: null,
        lastError: null,
        status: 'DELIVERED',
      }),
    );
  });

  it('reschedules a failed row as PENDING with a retry delay', async (): Promise<void> => {
    const observer: BPMInstanceEventObserver = {
      onInstanceEvent: (): Promise<void> =>
        Promise.reject(new TypeError('boom')),
    };
    const { service, update } = createHarness({
      claimBatches: [[createRow({ attemptCount: 1 })], []],
      delivery: { maxAttempts: 6, retryBaseDelayMs: 1_000 },
      observer,
    });
    const before = Date.now();

    await service.deliverDue(NOW);

    const changes = update.mock.calls[0]?.[1] as {
      readonly attemptCount: number;
      readonly lastError: string;
      readonly nextAttemptAt: Date;
      readonly status: string;
    };

    expect(changes.status).toBe('PENDING');
    expect(changes.attemptCount).toBe(2);
    expect(changes.lastError).toBe('TypeError: boom');
    expect(changes.nextAttemptAt.getTime()).toBeGreaterThan(before);
  });

  it('parks a row as FAILED at maxAttempts and keeps its nextAttemptAt', async (): Promise<void> => {
    const observer: BPMInstanceEventObserver = {
      onInstanceEvent: (): Promise<void> => Promise.reject(new Error('down')),
    };
    const row = createRow({ attemptCount: 5 });
    const { service, update } = createHarness({
      claimBatches: [[row], []],
      delivery: { maxAttempts: 6 },
      observer,
    });

    await service.deliverDue(NOW);

    expect(update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        attemptCount: 6,
        nextAttemptAt: row.nextAttemptAt,
        status: 'FAILED',
      }),
    );
  });

  it('records nothing and does not throw when the claim was lost', async (): Promise<void> => {
    const observer: BPMInstanceEventObserver = {
      onInstanceEvent: (): void => undefined,
    };
    const { service, update } = createHarness({
      claimBatches: [[createRow()], []],
      observer,
      updateAffected: 0,
    });

    await expect(service.deliverDue(NOW)).resolves.toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('purges only DELIVERED rows older than retentionDays', async (): Promise<void> => {
    const { remove, service } = createHarness({
      observer: null,
      delivery: { retentionDays: 30 },
    });

    const purged = await service.purgeDelivered(NOW);

    expect(purged).toBe(2);
    expect(remove).toHaveBeenCalledWith({
      deliveredAt: LessThan(new Date('2026-10-15T00:00:00.000Z')),
      status: 'DELIVERED',
    });
  });

  it('caps the retry delay at maxRetryDelayMs and grows it per attempt', (): void => {
    const { service } = createHarness({
      observer: null,
      delivery: { maxRetryDelayMs: 100_000, retryBaseDelayMs: 1_000 },
    });

    const first = service.readRetryDelay(1);
    const late = service.readRetryDelay(30);

    expect(first).toBeGreaterThanOrEqual(800);
    expect(first).toBeLessThanOrEqual(1_200);
    expect(late).toBe(100_000);
  });
});
