import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FindOperator, Repository } from 'typeorm';
import { BPMAdminGuard } from '../bpm-auth/bpm-auth.authorization';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ActivityLogEventTypeEnum } from '../workflow-engine/workflow-engine.enums';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import { WorkflowWebhookDeliveryResolver } from './workflow-webhook-delivery.resolver';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';
import { resolveBPMWorkflowWebhookOptions } from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function row(
  overrides: Partial<WorkflowWebhookDeliveryEntity> = {},
): WorkflowWebhookDeliveryEntity {
  return Object.assign(new WorkflowWebhookDeliveryEntity(), {
    attemptCount: 6,
    createdAt: NOW,
    endpointKey: 'demo.flaky',
    endpointVersion: 1,
    event: {
      endpoint: { key: 'demo.flaky', version: 1 },
      initiator: { memberId: 'member-1' },
      instance: {
        id: 'instance-1',
        templateId: 't',
        templateVersionId: 'v',
        title: 'T',
      },
      node: { id: 'notify', label: 'N' },
      occurredAt: NOW.toISOString(),
      parameters: { secretish: 'personal data' },
    },
    id: 'delivery-1',
    instanceId: 'instance-1',
    lastAttemptAt: NOW,
    lastErrorCode: 'WEBHOOK_HTTP_503',
    lastErrorDetail: 'down',
    lastResponseStatus: 503,
    nextRetryAt: null,
    nodeId: 'notify',
    sentAt: null,
    status: WorkflowWebhookDeliveryStatusEnum.FAILED,
    targetId: 'wh',
    tokenId: 'token-1',
    updatedAt: NOW,
    ...overrides,
  });
}

function setup(initial: readonly WorkflowWebhookDeliveryEntity[] = [row()]): {
  readonly activities: Partial<ActivityLogEntity>[];
  readonly deliverByIds: jest.SpyInstance;
  readonly deliveryService: WorkflowWebhookDeliveryService;
  readonly resolver: WorkflowWebhookDeliveryResolver;
  readonly store: Map<string, WorkflowWebhookDeliveryEntity>;
} {
  const store = new Map(initial.map((item) => [item.id, item]));
  const activities: Partial<ActivityLogEntity>[] = [];
  const deliveryRepository = {
    find: async () => [...store.values()],
    findOne: async ({ where }: { readonly where: { readonly id: string } }) =>
      store.get(where.id) ?? null,
    update: async (
      criteria: {
        readonly attemptCount?: FindOperator<number>;
        readonly id: string;
        readonly status: string;
      },
      changes: Partial<WorkflowWebhookDeliveryEntity>,
    ) => {
      const current = store.get(criteria.id);
      const minimumAttempts = criteria.attemptCount?.value ?? -1;

      if (
        !current ||
        current.status !== criteria.status ||
        current.attemptCount <= minimumAttempts
      ) {
        return { affected: 0 };
      }

      store.set(current.id, { ...current, ...changes });

      return { affected: 1 };
    },
  };
  const activityRepository = {
    create: (value: Partial<ActivityLogEntity>) => value,
    save: async (value: Partial<ActivityLogEntity>) => {
      activities.push(value);

      return value;
    },
  };
  const manager = {
    getRepository: (target: unknown) =>
      target === WorkflowWebhookDeliveryEntity
        ? deliveryRepository
        : activityRepository,
  };
  const webhookService = {
    getEndpoint: async (key: string) =>
      key === 'demo.flaky'
        ? {
            endpoint: {
              buildRequest: async () => ({ url: 'https://x.test' }),
              descriptor: {
                key,
                label: '示範：不穩定',
                parameters: [],
                version: 1,
              },
            },
            source: 'REGISTRY',
          }
        : null,
  } as unknown as WorkflowWebhookService;
  const deliveryService = new WorkflowWebhookDeliveryService(
    {
      ...deliveryRepository,
      manager: {
        transaction: async <T>(work: (m: typeof manager) => Promise<T>) =>
          work(manager),
      },
    } as unknown as Repository<WorkflowWebhookDeliveryEntity>,
    activityRepository as unknown as Repository<ActivityLogEntity>,
    webhookService,
    resolveBPMWorkflowWebhookOptions(),
    async () => new Response(null),
  );
  const deliverByIds = jest
    .spyOn(deliveryService, 'deliverByIds')
    .mockResolvedValue(1);

  return {
    activities,
    deliverByIds,
    deliveryService,
    resolver: new WorkflowWebhookDeliveryResolver(deliveryService),
    store,
  };
}

describe('WorkflowWebhookDeliveryResolver', () => {
  it('is administrator-only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WorkflowWebhookDeliveryResolver),
    ).toContain(BPMAdminGuard);
  });

  it('lists deliveries with the endpoint label and without the frozen event', async () => {
    const { resolver } = setup([
      row(),
      row({ endpointKey: 'gone.endpoint', id: 'delivery-2' }),
    ]);
    const deliveries = await resolver.workflowWebhookDeliveries('instance-1');

    expect(deliveries.map((delivery) => delivery.endpointLabel)).toEqual([
      '示範：不穩定',
      null,
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('personal data');
    expect(deliveries[0]).not.toHaveProperty('event');
    expect(deliveries[0]).not.toHaveProperty('tokenId');
  });

  it('re-queues a FAILED delivery under the same id, audits it and starts it', async () => {
    const { activities, deliverByIds, resolver, store } = setup();

    const retried = await resolver.retryWorkflowWebhookDelivery(
      'delivery-1',
      'member-admin',
    );
    await new Promise((resolve) => setImmediate(resolve));

    // The mutation answers with the row as it now stands: queued again, with
    // the previous error kept until the next attempt replaces it.
    expect(retried).toMatchObject({
      attemptCount: 0,
      id: 'delivery-1',
      lastErrorCode: 'WEBHOOK_HTTP_503',
      status: WorkflowWebhookDeliveryStatusEnum.PENDING,
    });
    expect(store.get('delivery-1')).toMatchObject({
      attemptCount: 0,
      nextRetryAt: null,
      status: WorkflowWebhookDeliveryStatusEnum.PENDING,
    });
    expect(activities).toEqual([
      expect.objectContaining({
        actorMemberId: 'member-admin',
        eventType: ActivityLogEventTypeEnum.WEBHOOK_DELIVERY_RETRIED,
        payload: expect.objectContaining({
          deliveryId: 'delivery-1',
          endpointLabel: '示範：不穩定',
          previousErrorCode: 'WEBHOOK_HTTP_503',
        }),
      }),
    ]);
    expect(deliverByIds).toHaveBeenCalledWith(['delivery-1']);
  });

  it('refuses to re-queue a delivery that is not FAILED', async () => {
    const { activities, deliverByIds, resolver } = setup([
      row({ status: WorkflowWebhookDeliveryStatusEnum.SENT }),
    ]);

    await expect(
      resolver.retryWorkflowWebhookDelivery('delivery-1', 'member-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await new Promise((resolve) => setImmediate(resolve));
    expect(activities).toEqual([]);
    expect(deliverByIds).not.toHaveBeenCalled();
  });

  it('refuses a delivery that failed while being queued and was never sent', async () => {
    const { activities, deliverByIds, resolver, store } = setup([
      row({
        attemptCount: 0,
        lastErrorCode: 'WEBHOOK_PARAMETER_INVALID',
        lastResponseStatus: null,
      }),
    ]);

    await expect(
      resolver.retryWorkflowWebhookDelivery('delivery-1', 'member-admin'),
    ).rejects.toThrow('failed before it was ever sent');
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get('delivery-1')?.status).toBe(
      WorkflowWebhookDeliveryStatusEnum.FAILED,
    );
    expect(activities).toEqual([]);
    expect(deliverByIds).not.toHaveBeenCalled();
  });

  it('still records the retry when the host registry misbehaves', async () => {
    const { activities, deliveryService } = setup();

    jest
      .spyOn(deliveryService['webhookService'], 'getEndpoint')
      .mockResolvedValue({} as never);

    await deliveryService.retryFailedDelivery('delivery-1', 'member-admin');

    expect(activities).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ endpointLabel: null }),
      }),
    ]);
  });

  it('answers not found for an unknown delivery', async () => {
    const { resolver } = setup([]);

    await expect(
      resolver.retryWorkflowWebhookDelivery('missing', 'member-admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
