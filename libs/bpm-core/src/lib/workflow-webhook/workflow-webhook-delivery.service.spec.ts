import { createHmac } from 'node:crypto';
import { EntityManager, FindOperator, Repository } from 'typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ActivityLogEventTypeEnum } from '../workflow-engine/workflow-engine.enums';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import {
  WorkflowWebhookDeliveryService,
  WorkflowWebhookFetch,
} from './workflow-webhook-delivery.service';
import {
  BPMResolvedWorkflowWebhookOptions,
  resolveBPMWorkflowWebhookOptions,
} from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookRequest,
} from './workflow-webhook.types';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function createRow(
  overrides: Partial<WorkflowWebhookDeliveryEntity> = {},
): WorkflowWebhookDeliveryEntity {
  return Object.assign(new WorkflowWebhookDeliveryEntity(), {
    attemptCount: 0,
    createdAt: NOW,
    endpointKey: 'erp.po',
    endpointVersion: 1,
    event: {
      endpoint: { key: 'erp.po', version: 1 },
      initiator: { memberId: 'member-102' },
      instance: {
        id: 'instance-1',
        templateId: 'template-1',
        templateVersionId: 'template-version-1',
        title: '採購申請',
      },
      node: { id: 'notify_erp', label: '通知 ERP' },
      occurredAt: NOW.toISOString(),
      parameters: { amount: 1200 },
    },
    id: 'delivery-1',
    instanceId: 'instance-1',
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    lastResponseStatus: null,
    nextRetryAt: null,
    nodeId: 'notify_erp',
    sentAt: null,
    status: WorkflowWebhookDeliveryStatusEnum.PENDING,
    targetId: 'webhook_erp',
    tokenId: 'token-1',
    updatedAt: NOW,
    ...overrides,
  });
}

interface Harness {
  readonly activities: Partial<ActivityLogEntity>[];
  readonly requests: { readonly init: RequestInit; readonly url: string }[];
  readonly service: WorkflowWebhookDeliveryService;
  readonly store: Map<string, WorkflowWebhookDeliveryEntity>;
}

function createHarness({
  buildRequest = async (): Promise<BPMWorkflowWebhookRequest> => ({
    url: 'https://erp.example.com/hooks/bpm',
  }),
  endpointMissing = false,
  options = resolveBPMWorkflowWebhookOptions(),
  respond = async (): Promise<Response> => new Response('ok', { status: 200 }),
  rows = [createRow()],
  source = 'REGISTRY',
}: {
  readonly buildRequest?: BPMWorkflowWebhookEndpointEntry['endpoint']['buildRequest'];
  readonly endpointMissing?: boolean;
  readonly options?: BPMResolvedWorkflowWebhookOptions;
  readonly respond?: WorkflowWebhookFetch;
  readonly rows?: readonly WorkflowWebhookDeliveryEntity[];
  readonly source?: BPMWorkflowWebhookEndpointEntry['source'];
} = {}): Harness {
  const store = new Map(rows.map((row) => [row.id, row]));
  const activities: Partial<ActivityLogEntity>[] = [];
  const requests: { init: RequestInit; url: string }[] = [];
  const claimManager = {
    getRepository: () => ({
      find: async ({
        where,
      }: {
        readonly where: { readonly id: FindOperator<string[]> };
      }): Promise<WorkflowWebhookDeliveryEntity[]> =>
        (where.id.value as unknown as string[]).flatMap((id) => {
          const row = store.get(id);

          return row ? [row] : [];
        }),
    }),
    // Stands in for the claiming UPDATE: due PENDING rows, optionally limited
    // to the requested ids, move to DELIVERY_IN_PROGRESS.
    query: async (
      _sql: string,
      parameters: readonly unknown[],
    ): Promise<unknown> => {
      const ids = parameters[5] as string[] | null;
      const limit = parameters[4] as number;
      const claimed = [...store.values()]
        .filter(
          (row) =>
            row.status === WorkflowWebhookDeliveryStatusEnum.PENDING &&
            (!row.nextRetryAt || row.nextRetryAt <= NOW) &&
            (!ids || ids.includes(row.id)),
        )
        .slice(0, limit);

      claimed.forEach((row) =>
        store.set(row.id, {
          ...row,
          lastAttemptAt: parameters[1] as Date,
          status: WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
        }),
      );

      return [claimed.map((row) => ({ id: row.id })), claimed.length];
    },
  };
  const deliveryRepository = {
    manager: {
      transaction: async <T>(
        work: (manager: typeof claimManager) => Promise<T>,
      ): Promise<T> => work(claimManager),
    },
    // Mirrors a conditional UPDATE: applies only while the row is still
    // claimed with the stamp the caller holds.
    update: async (
      criteria: {
        readonly id: string;
        readonly lastAttemptAt?: Date | FindOperator<unknown>;
        readonly status: WorkflowWebhookDeliveryStatusEnum;
      },
      changes: Partial<WorkflowWebhookDeliveryEntity>,
    ): Promise<{ readonly affected: number }> => {
      const row = store.get(criteria.id);
      const stampMatches =
        criteria.lastAttemptAt === undefined
          ? true
          : criteria.lastAttemptAt instanceof Date
            ? row?.lastAttemptAt?.getTime() === criteria.lastAttemptAt.getTime()
            : row?.lastAttemptAt === null;

      if (!row || row.status !== criteria.status || !stampMatches) {
        return { affected: 0 };
      }

      store.set(row.id, { ...row, ...changes });

      return { affected: 1 };
    },
  } as unknown as Repository<WorkflowWebhookDeliveryEntity>;
  const activityLogRepository = {
    create: (value: Partial<ActivityLogEntity>): Partial<ActivityLogEntity> =>
      value,
    save: async (
      value: Partial<ActivityLogEntity>,
    ): Promise<Partial<ActivityLogEntity>> => {
      activities.push(value);

      return value;
    },
  } as unknown as Repository<ActivityLogEntity>;
  const webhookService = {
    getEndpoint: async (): Promise<BPMWorkflowWebhookEndpointEntry | null> =>
      endpointMissing
        ? null
        : {
            endpoint: {
              buildRequest,
              descriptor: {
                key: 'erp.po',
                label: 'ERP',
                parameters: [],
                version: 1,
              },
            },
            source,
          },
  } as unknown as WorkflowWebhookService;
  const fetchImpl: WorkflowWebhookFetch = async (url, init) => {
    requests.push({ init, url });

    return respond(url, init);
  };

  const service = new WorkflowWebhookDeliveryService(
    deliveryRepository,
    activityLogRepository,
    webhookService,
    options,
    fetchImpl,
  );

  jest.spyOn(service, 'readCurrentTime').mockReturnValue(NOW);

  return { activities, requests, service, store };
}

function withDelivery(
  overrides: Partial<BPMResolvedWorkflowWebhookOptions['delivery']>,
  base = resolveBPMWorkflowWebhookOptions(),
): BPMResolvedWorkflowWebhookOptions {
  return { ...base, delivery: { ...base.delivery, ...overrides } };
}

describe('WorkflowWebhookDeliveryService', () => {
  describe('outcome classification', () => {
    it.each([
      [200, WorkflowWebhookDeliveryStatusEnum.SENT, null, true],
      [204, WorkflowWebhookDeliveryStatusEnum.SENT, null, true],
      [
        408,
        WorkflowWebhookDeliveryStatusEnum.PENDING,
        'WEBHOOK_HTTP_408',
        false,
      ],
      [
        429,
        WorkflowWebhookDeliveryStatusEnum.PENDING,
        'WEBHOOK_HTTP_429',
        false,
      ],
      [
        500,
        WorkflowWebhookDeliveryStatusEnum.PENDING,
        'WEBHOOK_HTTP_500',
        false,
      ],
      [
        503,
        WorkflowWebhookDeliveryStatusEnum.PENDING,
        'WEBHOOK_HTTP_503',
        false,
      ],
      [400, WorkflowWebhookDeliveryStatusEnum.FAILED, 'WEBHOOK_HTTP_400', true],
      [404, WorkflowWebhookDeliveryStatusEnum.FAILED, 'WEBHOOK_HTTP_404', true],
      [302, WorkflowWebhookDeliveryStatusEnum.FAILED, 'WEBHOOK_REDIRECT', true],
    ])(
      'HTTP %i ends as %s (%s)',
      async (
        status,
        expectedStatus,
        errorCode,
        writesActivity,
      ): Promise<void> => {
        const harness = createHarness({
          respond: async () =>
            new Response(status === 204 ? null : 'body', {
              headers: status === 302 ? { location: 'http://127.0.0.1/' } : {},
              status,
            }),
        });

        await harness.service.deliverByIds(['delivery-1'], NOW);

        const row = harness.store.get('delivery-1');

        expect(row?.status).toBe(expectedStatus);
        expect(row?.lastErrorCode).toBe(errorCode);
        expect(row?.attemptCount).toBe(1);
        expect(harness.activities).toHaveLength(writesActivity ? 1 : 0);

        if (expectedStatus === WorkflowWebhookDeliveryStatusEnum.PENDING) {
          expect(row?.nextRetryAt?.getTime()).toBeGreaterThan(NOW.getTime());
        }
      },
    );

    it('treats an opaque redirect as a redirect, never following it', async () => {
      const harness = createHarness({
        respond: async (_url, init) => {
          expect(init.redirect).toBe('manual');

          // What a spec-compliant fetch returns for `redirect: 'manual'`.
          return {
            status: 0,
            text: async () => '',
            type: 'opaqueredirect',
          } as unknown as Response;
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_REDIRECT',
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
    });

    it('retries a network error without keeping its message', async () => {
      const harness = createHarness({
        respond: async () => {
          throw new TypeError('fetch failed');
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_NETWORK',
        // No system error code on this one, so only its kind is kept.
        lastErrorDetail: 'TypeError',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('aborts a request that exceeds its timeout and retries it', async () => {
      const harness = createHarness({
        options: withDelivery({ defaultTimeoutMs: 20 }),
        respond: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              ),
            );
          }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_TIMEOUT',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('retries a buildRequest that throws synchronously, keeping only the error kind', async () => {
      const harness = createHarness({
        buildRequest: ((): never => {
          throw new Error('vault token s3cr3t rejected');
        }) as unknown as () => Promise<BPMWorkflowWebhookRequest>,
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        attemptCount: 1,
        lastErrorCode: 'WEBHOOK_BUILD_REQUEST_FAILED',
        lastErrorDetail: 'Error',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('fails a buildRequest that returns something other than a request', async () => {
      const harness = createHarness({
        buildRequest: (async () =>
          undefined) as unknown as () => Promise<BPMWorkflowWebhookRequest>,
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_INVALID_REQUEST',
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
    });

    it('refuses credentials in the URL and a method other than POST, PUT or PATCH', async () => {
      const withCredentials = createHarness({
        buildRequest: async () => ({
          url: 'https://user:pa55@erp.example.com/hooks',
        }),
      });
      const withGet = createHarness({
        buildRequest: async () =>
          ({
            method: 'GET',
            url: 'https://erp.example.com/hooks',
          }) as unknown as BPMWorkflowWebhookRequest,
      });

      await withCredentials.service.deliverByIds(['delivery-1'], NOW);
      await withGet.service.deliverByIds(['delivery-1'], NOW);

      expect(withCredentials.requests).toHaveLength(0);
      expect(withGet.requests).toHaveLength(0);
      expect(withCredentials.store.get('delivery-1')?.lastErrorCode).toBe(
        'WEBHOOK_INVALID_REQUEST',
      );
      expect(
        withCredentials.store.get('delivery-1')?.lastErrorDetail,
      ).not.toContain('pa55');
      expect(withGet.store.get('delivery-1')?.lastErrorCode).toBe(
        'WEBHOOK_INVALID_REQUEST',
      );
    });

    it('keeps the system error code, not a message that may quote the URL', async () => {
      const harness = createHarness({
        respond: async () => {
          throw Object.assign(
            new TypeError(
              'fetch failed for https://erp.example.com/hooks?token=x',
            ),
            { cause: { code: 'ECONNREFUSED' } },
          );
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.lastErrorDetail).toBe(
        'ECONNREFUSED',
      );
    });

    it('retries when the endpoint source throws during lookup', async () => {
      const harness = createHarness();

      jest
        .spyOn(
          (
            harness.service as unknown as {
              readonly webhookService: WorkflowWebhookService;
            }
          ).webhookService,
          'getEndpoint',
        )
        .mockRejectedValue(new Error('db down'));

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_ENDPOINT_LOOKUP_FAILED',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('strips NUL from a failing body so the write-back cannot be rejected by PostgreSQL', async () => {
      const harness = createHarness({
        respond: async () =>
          new Response(new Uint8Array([0x61, 0x00, 0x62]), { status: 500 }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        attemptCount: 1,
        lastErrorDetail: 'ab',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('keeps a terminal outcome when only the activity log write fails', async () => {
      const harness = createHarness({
        respond: async () => new Response('nope', { status: 404 }),
      });

      jest
        .spyOn(
          (
            harness.service as unknown as {
              readonly activityLogRepository: { save: () => Promise<unknown> };
            }
          ).activityLogRepository,
          'save',
        )
        .mockRejectedValue(new Error('log table locked'));

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.status).toBe(
        WorkflowWebhookDeliveryStatusEnum.FAILED,
      );
    });

    it('reads only a bounded prefix of a large failing response', async () => {
      const harness = createHarness({
        respond: async () =>
          new Response('x'.repeat(1_000_000), { status: 500 }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.lastErrorDetail).toHaveLength(
        500,
      );
    });

    it('retries when the host cannot build the request', async () => {
      const harness = createHarness({
        buildRequest: async () => {
          throw new Error('vault unavailable');
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.requests).toHaveLength(0);
      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_BUILD_REQUEST_FAILED',
        status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      });
    });

    it('fails without sending when the endpoint was removed', async () => {
      const harness = createHarness({ endpointMissing: true });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.requests).toHaveLength(0);
      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_ENDPOINT_MISSING',
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
    });

    it('refuses a URL that is not http(s)', async () => {
      const harness = createHarness({
        buildRequest: async () => ({ url: 'file:///etc/passwd' }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.requests).toHaveLength(0);
      expect(harness.store.get('delivery-1')?.lastErrorCode).toBe(
        'WEBHOOK_INVALID_REQUEST',
      );
    });
  });

  describe('allowlist', () => {
    const allowlisted = resolveBPMWorkflowWebhookOptions({
      workflowWebhookAllowedUrlPatterns: ['https://erp.example.com/hooks/*'],
      workflowWebhookEnforceAllowlistForRegistry: true,
    });

    it('stops a registry URL outside the list when enforcement is on', async () => {
      const harness = createHarness({
        buildRequest: async () => ({ url: 'https://evil.example.net/hooks' }),
        options: allowlisted,
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.requests).toHaveLength(0);
      expect(harness.store.get('delivery-1')).toMatchObject({
        lastErrorCode: 'WEBHOOK_URL_NOT_ALLOWED',
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
    });

    it('lets a registry URL through when enforcement is off', async () => {
      const harness = createHarness({
        buildRequest: async () => ({ url: 'http://localhost:17603/demo/sink' }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.status).toBe(
        WorkflowWebhookDeliveryStatusEnum.SENT,
      );
    });

    it('always checks a database-managed endpoint', async () => {
      const harness = createHarness({
        buildRequest: async () => ({ url: 'https://evil.example.net/hooks' }),
        options: resolveBPMWorkflowWebhookOptions({
          workflowWebhookAllowedUrlPatterns: ['https://erp.example.com/*'],
        }),
        source: 'DATABASE',
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.lastErrorCode).toBe(
        'WEBHOOK_URL_NOT_ALLOWED',
      );
    });
  });

  describe('request shape', () => {
    it('sends the frozen event with a stable delivery id and a verifiable signature', async () => {
      const harness = createHarness({
        buildRequest: async () => ({
          headers: {
            Authorization: 'Bearer host-token',
            'x-bpm-delivery-id': 'spoofed',
          },
          signingSecret: 'shh',
          url: 'https://erp.example.com/hooks/bpm',
        }),
        rows: [createRow({ attemptCount: 2 })],
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      const [{ init, url }] = harness.requests;
      const headers = init.headers as Record<string, string>;
      const body = init.body as string;

      expect(url).toBe('https://erp.example.com/hooks/bpm');
      expect(init.method).toBe('POST');
      expect(JSON.parse(body)).toMatchObject({
        attempt: 3,
        deliveryId: 'delivery-1',
        eventType: 'workflow.notify',
        parameters: { amount: 1200 },
      });
      expect(headers).toMatchObject({
        Authorization: 'Bearer host-token',
        'content-type': 'application/json',
        'x-bpm-delivery-id': 'delivery-1',
        'x-bpm-event': 'workflow.notify',
        'x-bpm-timestamp': String(NOW.getTime() / 1000),
      });
      expect(headers['x-bpm-signature-sha256']).toBe(
        createHmac('sha256', 'shh')
          .update(`${headers['x-bpm-timestamp']}.${body}`)
          .digest('hex'),
      );
    });

    it('uses the host body and method when given, and omits signing without a secret', async () => {
      const harness = createHarness({
        buildRequest: async () => ({
          body: '<xml/>',
          headers: { 'Content-Type': 'application/xml' },
          method: 'PUT',
          url: 'https://erp.example.com/hooks/bpm',
        }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      const [{ init }] = harness.requests;
      const headers = init.headers as Record<string, string>;

      expect(init.method).toBe('PUT');
      expect(init.body).toBe('<xml/>');
      expect(headers['Content-Type']).toBe('application/xml');
      expect(headers['content-type']).toBeUndefined();
      expect(headers['x-bpm-signature-sha256']).toBeUndefined();
    });
  });

  describe('claims held by more than one worker', () => {
    it('stands down when another worker reclaimed the row between claim and attempt', async () => {
      const harness = createHarness();

      jest
        .spyOn(harness.service, 'readCurrentTime')
        .mockImplementationOnce(() => {
          // The attempt's first clock read: another worker reclaims the row
          // after this one claimed it but before it re-stamped it.
          const row = harness.store.get('delivery-1');

          if (row) {
            harness.store.set('delivery-1', {
              ...row,
              lastAttemptAt: new Date(NOW.getTime() + 95_000),
            });
          }

          return NOW;
        });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.requests).toHaveLength(0);
      expect(harness.store.get('delivery-1')?.status).toBe(
        WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
      );
    });

    it('discards its write-back when the row was reclaimed mid-attempt, so a SENT row is never overwritten', async () => {
      const harness = createHarness({
        respond: async () => {
          const row = harness.store.get('delivery-1');

          // Another worker reclaimed and finished the row while this one waited.
          if (row) {
            harness.store.set('delivery-1', {
              ...row,
              lastAttemptAt: new Date(NOW.getTime() + 95_000),
              status: WorkflowWebhookDeliveryStatusEnum.SENT,
            });
          }

          return new Response('down', { status: 503 });
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.status).toBe(
        WorkflowWebhookDeliveryStatusEnum.SENT,
      );
      expect(harness.activities).toHaveLength(0);
    });

    it('never holds a claim on a row it is not already attempting', async () => {
      const ids = Array.from({ length: 12 }, (_, index) => `row-${index}`);
      const harness = createHarness({
        rows: ids.map((id) => createRow({ id })),
      });
      let inFlight = 0;
      let peak = 0;
      const claimedWhileSending: number[] = [];

      jest
        .spyOn(
          harness.service as unknown as {
            post: (...args: unknown[]) => unknown;
          },
          'post',
        )
        .mockImplementation(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          claimedWhileSending.push(
            [...harness.store.values()].filter(
              (row) =>
                row.status ===
                WorkflowWebhookDeliveryStatusEnum.DELIVERY_IN_PROGRESS,
            ).length,
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;

          return { kind: 'SENT', status: 200 };
        });

      expect(await harness.service.deliverDue(NOW)).toBe(12);
      expect(peak).toBe(5);
      expect(Math.max(...claimedWhileSending)).toBeLessThanOrEqual(5);
      expect(harness.requests).toHaveLength(0);
      expect(
        [...harness.store.values()].every(
          (row) => row.status === WorkflowWebhookDeliveryStatusEnum.SENT,
        ),
      ).toBe(true);
    });

    it('stops a scheduler pass at the batch size', async () => {
      const ids = Array.from({ length: 30 }, (_, index) => `row-${index}`);
      const harness = createHarness({
        rows: ids.map((id) => createRow({ id })),
      });

      expect(await harness.service.deliverDue(NOW)).toBe(25);
      expect(
        [...harness.store.values()].filter(
          (row) => row.status === WorkflowWebhookDeliveryStatusEnum.PENDING,
        ),
      ).toHaveLength(5);
    });

    it('sends a repeated id only once', async () => {
      const harness = createHarness();

      expect(
        await harness.service.deliverByIds(
          ['delivery-1', 'delivery-1', 'delivery-1'],
          NOW,
        ),
      ).toBe(1);
      expect(harness.requests).toHaveLength(1);
    });
  });

  describe('batches', () => {
    it('does not let one slow receiver hold back the rest of the batch', async () => {
      let releaseSlow: () => void = () => undefined;
      const order: string[] = [];
      const harness = createHarness({
        rows: [
          createRow({ id: 'slow' }),
          createRow({ id: 'fast-1' }),
          createRow({ id: 'fast-2' }),
        ],
        respond: async (_url, init) => {
          const deliveryId = (init.headers as Record<string, string>)[
            'x-bpm-delivery-id'
          ];

          if (deliveryId === 'slow') {
            await new Promise<void>((resolve) => {
              releaseSlow = resolve;
            });
          }

          order.push(deliveryId);

          return new Response('ok', { status: 200 });
        },
      });
      const delivering = harness.service.deliverByIds(
        ['slow', 'fast-1', 'fast-2'],
        NOW,
      );

      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(order).toEqual(['fast-1', 'fast-2']);

      releaseSlow();
      await delivering;
      expect(order).toEqual(['fast-1', 'fast-2', 'slow']);
    });

    it('makes a host error name storable too', async () => {
      const harness = createHarness({
        buildRequest: async () => {
          throw Object.assign(new Error('x'), { name: 'Bad\u0000Name' });
        },
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')?.lastErrorDetail).toBe('BadName');
    });
  });

  describe('clock', () => {
    it('signs with the time of sending and schedules the retry from the time of finishing', async () => {
      const claimedAt = new Date('2026-09-15T10:00:00.000Z');
      const sentAt = new Date('2026-09-15T10:20:00.000Z');
      const finishedAt = new Date('2026-09-15T10:20:05.000Z');
      const harness = createHarness({
        buildRequest: async () => ({
          signingSecret: 'shh',
          url: 'https://erp.example.com/hooks/bpm',
        }),
        respond: async () => new Response('down', { status: 503 }),
      });
      const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      jest
        .spyOn(harness.service, 'readCurrentTime')
        .mockReturnValueOnce(claimedAt)
        .mockReturnValueOnce(sentAt)
        .mockReturnValueOnce(finishedAt);

      try {
        await harness.service.deliverByIds(['delivery-1'], claimedAt);
      } finally {
        random.mockRestore();
      }

      const headers = harness.requests[0]?.init.headers as Record<
        string,
        string
      >;

      expect(headers['x-bpm-timestamp']).toBe(String(sentAt.getTime() / 1000));
      expect(harness.store.get('delivery-1')?.nextRetryAt?.getTime()).toBe(
        finishedAt.getTime() + 30_000,
      );
    });
  });

  describe('retries and terminal records', () => {
    it('marks the last allowed attempt FAILED and logs it once', async () => {
      const harness = createHarness({
        respond: async () => new Response('down', { status: 503 }),
        rows: [createRow({ attemptCount: 5 })],
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      expect(harness.store.get('delivery-1')).toMatchObject({
        attemptCount: 6,
        nextRetryAt: null,
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
      expect(harness.activities).toEqual([
        {
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: 'instance-1',
          nodeId: 'notify_erp',
          payload: {
            action: 'NOTIFY_WEBHOOK',
            attempts: 6,
            deliveryId: 'delivery-1',
            endpointKey: 'erp.po',
            endpointVersion: 1,
            errorCode: 'WEBHOOK_HTTP_503',
            status: 503,
            targetId: 'webhook_erp',
          },
          taskId: null,
        },
      ]);
    });

    it('never puts the URL or the response body on the activity log', async () => {
      const harness = createHarness({
        respond: async () =>
          new Response('secret internal stack trace', { status: 400 }),
      });

      await harness.service.deliverByIds(['delivery-1'], NOW);

      const serialized = JSON.stringify(harness.activities);

      expect(serialized).not.toContain('erp.example.com');
      expect(serialized).not.toContain('stack trace');
      expect(harness.store.get('delivery-1')?.lastErrorDetail).toBe(
        'secret internal stack trace',
      );
    });

    it('backs off exponentially with jitter, up to the cap', () => {
      const { service } = createHarness();
      const random = jest.spyOn(Math, 'random');

      try {
        random.mockReturnValue(0);
        expect(service.readRetryDelay(1)).toBe(24_000);
        expect(service.readRetryDelay(3)).toBe(96_000);
        random.mockReturnValue(1);
        expect(service.readRetryDelay(1)).toBe(36_000);
        // Jitter never pushes a delay past the configured cap.
        expect(service.readRetryDelay(20)).toBe(3_600_000);
      } finally {
        random.mockRestore();
      }
    });

    it('does not claim rows that are already terminal or not yet due', async () => {
      const harness = createHarness({
        rows: [
          createRow({
            id: 'failed',
            status: WorkflowWebhookDeliveryStatusEnum.FAILED,
          }),
          createRow({
            id: 'later',
            nextRetryAt: new Date(NOW.getTime() + 60_000),
          }),
        ],
      });

      expect(await harness.service.deliverByIds(['failed', 'later'], NOW)).toBe(
        0,
      );
      expect(harness.requests).toHaveLength(0);
    });
  });

  describe('enqueueNotifyWebhooks', () => {
    it('writes queued rows and a terminal log for rows that cannot be delivered', async () => {
      const saved: unknown[] = [];
      const manager = {
        getRepository: (target: unknown) => ({
          create: (value: object) => value,
          save: async (values: readonly Record<string, unknown>[]) => {
            const withIds = values.map((value, index) => ({
              id: `${target === WorkflowWebhookDeliveryEntity ? 'delivery' : 'log'}-${index}`,
              ...value,
            }));

            saved.push(...withIds);

            return withIds;
          },
        }),
      } as unknown as EntityManager;
      const service = new WorkflowWebhookDeliveryService(
        {} as Repository<WorkflowWebhookDeliveryEntity>,
        {} as Repository<ActivityLogEntity>,
        {
          getEndpoint: async (key: string) =>
            key === 'erp.po'
              ? {
                  endpoint: {
                    buildRequest: async () => ({ url: 'https://x.test' }),
                    descriptor: {
                      key,
                      label: 'ERP',
                      parameters: [],
                      version: 1,
                    },
                  },
                  source: 'REGISTRY',
                }
              : null,
        } as unknown as WorkflowWebhookService,
        resolveBPMWorkflowWebhookOptions(),
        async () => new Response(null),
      );

      const ids = await service.enqueueNotifyWebhooks(
        manager,
        {
          instance: {
            formData: {},
            id: 'instance-1',
            initiatorMemberId: 'member-1',
            templateId: 'template-1',
            templateVersionId: 'version-1',
            title: 'T',
          },
          node: { id: 'notify', label: 'N' },
          occurredAt: NOW,
          tokenId: 'token-1',
        },
        [
          { bindings: [], endpoint: { key: 'erp.po', version: 1 }, id: 'ok' },
          { bindings: [], endpoint: { key: 'gone', version: 1 }, id: 'gone' },
        ],
      );

      expect(ids).toEqual(['delivery-0', 'delivery-1']);
      expect(saved).toEqual([
        expect.objectContaining({ status: 'PENDING', targetId: 'ok' }),
        expect.objectContaining({
          lastErrorCode: 'WEBHOOK_ENDPOINT_MISSING',
          status: 'FAILED',
          targetId: 'gone',
        }),
        expect.objectContaining({
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          payload: expect.objectContaining({ deliveryId: 'delivery-1' }),
        }),
      ]);
    });
  });
});
