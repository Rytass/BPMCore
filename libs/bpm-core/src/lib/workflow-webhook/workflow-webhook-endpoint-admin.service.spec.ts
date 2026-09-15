import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Repository } from 'typeorm';
import { BPMAdminGuard } from '../bpm-auth/bpm-auth.authorization';
import { DatabaseWorkflowWebhookEndpointSource } from './workflow-webhook-database-source';
import {
  WorkflowWebhookDeliveryService,
  WorkflowWebhookTestOutcome,
} from './workflow-webhook-delivery.service';
import { WorkflowWebhookEndpointAdminResolver } from './workflow-webhook-endpoint-admin.resolver';
import {
  CreateWorkflowWebhookEndpointData,
  WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS,
  WorkflowWebhookEndpointAdminService,
} from './workflow-webhook-endpoint-admin.service';
import {
  WorkflowWebhookEndpointAuditEntity,
  WorkflowWebhookEndpointEntity,
} from './workflow-webhook-endpoint.entity';
import { resolveBPMWorkflowWebhookOptions } from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookEvent,
  StaticBPMWorkflowWebhookRegistry,
} from './workflow-webhook.types';

const KEY = 'c'.repeat(64);
const SECRET = 'receiver-shared-secret-value';
const TOKEN = 'Bearer do-not-leak-token';

interface Harness {
  readonly audits: WorkflowWebhookEndpointAuditEntity[];
  readonly resolver: WorkflowWebhookEndpointAdminResolver;
  readonly rows: Map<string, WorkflowWebhookEndpointEntity>;
  readonly sent: {
    entry: BPMWorkflowWebhookEndpointEntry;
    event: BPMWorkflowWebhookEvent;
  }[];
  readonly service: WorkflowWebhookEndpointAdminService;
  readonly source: DatabaseWorkflowWebhookEndpointSource;
}

function harness({
  database = true,
}: { readonly database?: boolean } = {}): Harness {
  const rows = new Map<string, WorkflowWebhookEndpointEntity>();
  const audits: WorkflowWebhookEndpointAuditEntity[] = [];
  const sent: Harness['sent'] = [];
  const options = resolveBPMWorkflowWebhookOptions(
    database
      ? {
          workflowWebhookAllowedUrlPatterns: ['https://*.example.com/hooks/*'],
          workflowWebhookSecretEncryptionKey: KEY,
          workflowWebhookTargetSources: ['REGISTRY', 'DATABASE'],
        }
      : {},
  );
  const matches = (
    row: WorkflowWebhookEndpointEntity,
    where: Readonly<Record<string, unknown>> = {},
  ): boolean =>
    Object.entries(where).every(
      ([field, value]) =>
        row[field as keyof WorkflowWebhookEndpointEntity] === value,
    );
  const endpointRepository = {
    create: (value: Partial<WorkflowWebhookEndpointEntity>) => value,
    find: async ({
      where,
    }: { readonly where?: Record<string, unknown> } = {}) =>
      [...rows.values()].filter((row) => matches(row, where)),
    findOne: async ({ where }: { readonly where: Record<string, unknown> }) =>
      [...rows.values()].find((row) => matches(row, where)) ?? null,
    save: async (value: Partial<WorkflowWebhookEndpointEntity>) => {
      const saved = {
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        id: value.id ?? `endpoint-${rows.size + 1}`,
        ...value,
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
      } as WorkflowWebhookEndpointEntity;

      rows.set(saved.id, saved);

      return saved;
    },
    update: async (
      { id }: { readonly id: string },
      changes: Partial<WorkflowWebhookEndpointEntity>,
    ) => {
      const current = rows.get(id);

      if (current) {
        rows.set(id, { ...current, ...changes });
      }

      return { affected: current ? 1 : 0 };
    },
  } as unknown as Repository<WorkflowWebhookEndpointEntity>;
  const auditRepository = {
    create: (value: Partial<WorkflowWebhookEndpointAuditEntity>) => value,
    find: async () => audits,
    save: async (value: WorkflowWebhookEndpointAuditEntity) => {
      audits.push(value);

      return value;
    },
  } as unknown as Repository<WorkflowWebhookEndpointAuditEntity>;
  const source = new DatabaseWorkflowWebhookEndpointSource(
    endpointRepository,
    options,
  );
  const webhookService = new WorkflowWebhookService(
    new StaticBPMWorkflowWebhookRegistry([
      {
        buildRequest: async () => ({ url: 'https://erp.example.com/hooks/po' }),
        descriptor: { key: 'erp.po', label: 'ERP', parameters: [], version: 1 },
      },
    ]),
    options,
    source,
  );
  const deliveryService = {
    sendTestEvent: async (
      entry: BPMWorkflowWebhookEndpointEntry,
      event: BPMWorkflowWebhookEvent,
    ): Promise<WorkflowWebhookTestOutcome> => {
      sent.push({ entry, event });

      return { errorCode: null, errorDetail: null, ok: true, status: 200 };
    },
  } as unknown as WorkflowWebhookDeliveryService;
  const service = new WorkflowWebhookEndpointAdminService(
    endpointRepository,
    auditRepository,
    webhookService,
    deliveryService,
    source,
    options,
  );

  return {
    audits,
    resolver: new WorkflowWebhookEndpointAdminResolver(service, webhookService),
    rows,
    sent,
    service,
    source,
  };
}

function input(
  overrides: Partial<CreateWorkflowWebhookEndpointData> = {},
): CreateWorkflowWebhookEndpointData {
  return {
    headers: [{ name: 'Authorization', value: TOKEN }],
    key: 'crm.lead-created',
    label: 'CRM 建立名單',
    parameters: [
      { key: 'amount', label: '金額', required: true, type: 'number' },
      { key: 'title', label: '主旨', required: false, type: 'string' },
    ],
    signingSecret: SECRET,
    url: 'https://crm.example.com/hooks/lead',
    version: 1,
    ...overrides,
  };
}

describe('WorkflowWebhookEndpointAdminService', () => {
  it('stores header values and the secret only encrypted, and delivers them decrypted', async () => {
    const { rows, source, service } = harness();
    const saved = await service.create(input(), 'member-admin');
    const stored = JSON.stringify(rows.get(saved.id));

    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(SECRET);
    expect(saved.encryptedHeaders).toMatch(/^v1:/);

    const request = await source
      .toEndpoint(saved)
      .buildRequest({} as BPMWorkflowWebhookEvent);

    expect(request).toMatchObject({
      headers: { Authorization: TOKEN },
      method: 'POST',
      signingSecret: SECRET,
      url: 'https://crm.example.com/hooks/lead',
    });
  });

  it('masks every value in the admin view and audits field names only', async () => {
    const { audits, resolver } = harness();
    const created = await resolver.createWorkflowWebhookEndpoint(
      input() as never,
      'member-admin',
    );
    const listed = await resolver.workflowWebhookManagedEndpoints();

    expect(created).toMatchObject({
      hasSigningSecret: true,
      headerNames: ['Authorization'],
    });
    expect(JSON.stringify([created, listed, audits])).not.toMatch(
      new RegExp(`${SECRET}|${TOKEN}|v1:`),
    );
    expect(audits[0]).toMatchObject({
      action: 'CREATED',
      actorMemberId: 'member-admin',
    });
    expect(audits[0]?.changedFields).toContain('headers');
  });

  it('refuses a URL outside the allowlist, with credentials, or not http(s)', async () => {
    const { service } = harness();

    await expect(
      service.create(input({ url: 'https://evil.test/hooks/lead' }), null),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_URL_NOT_ALLOWED');
    await expect(
      service.create(
        input({ url: 'https://u:p@crm.example.com/hooks/x' }),
        null,
      ),
    ).rejects.toThrow(/credentials/);
    await expect(
      service.create(input({ url: 'ftp://crm.example.com/hooks/x' }), null),
    ).rejects.toThrow(/http\(s\)/);
    // A wildcard host never matches a loopback or private address.
    await expect(
      service.create(input({ url: 'https://127.0.0.1/hooks/x' }), null),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_URL_NOT_ALLOWED');
  });

  it('refuses a key the host registry already uses and a version that is not newer', async () => {
    const { service } = harness();

    await expect(
      service.create(input({ key: 'erp.po' }), null),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_ENDPOINT_KEY_CONFLICT');

    await service.create(input(), null);
    await expect(service.create(input(), null)).rejects.toThrow(
      /already has version 1/,
    );
    await expect(
      service.create(input({ version: 2 }), null),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('validates parameters and headers without echoing header values', async () => {
    const { service } = harness();

    await expect(
      service.create(
        input({
          parameters: [
            { key: 'a', label: 'A', required: false, type: 'string' },
            { key: 'a', label: 'B', required: false, type: 'number' },
          ],
        }),
        null,
      ),
    ).rejects.toThrow(/unique/);
    await expect(
      service.create(
        input({ headers: [{ name: 'X-BPM-Signature-Sha256', value: TOKEN }] }),
        null,
      ),
    ).rejects.toThrow(/set by BPM/);

    const invalidValue = service.create(
      input({ headers: [{ name: 'X-Token', value: `${TOKEN}\r\nX-Evil: 1` }] }),
      null,
    );

    await expect(invalidValue).rejects.toThrow(/X-Token/);
    await expect(invalidValue).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it('requires the headers again before stored credentials follow the URL to another host', async () => {
    const { rows, service } = harness();
    const saved = await service.create(input(), null);

    await expect(
      service.update(
        saved.id,
        { url: 'https://attacker.example.com/hooks/x' },
        null,
      ),
    ).rejects.toThrow(/entering the headers again/);
    // Same origin, another path: the stored headers may stay.
    await expect(
      service.update(
        saved.id,
        { url: 'https://crm.example.com/hooks/other' },
        null,
      ),
    ).resolves.toMatchObject({ url: 'https://crm.example.com/hooks/other' });

    const moved = await service.update(
      saved.id,
      { headers: [], url: 'https://erp.example.com/hooks/x' },
      null,
    );

    expect(moved.encryptedHeaders).toBeNull();
    expect(rows.get(saved.id)?.url).toBe('https://erp.example.com/hooks/x');
  });

  it('does not count a reordered jsonb parameter object as a change', async () => {
    const { audits, rows, service } = harness();
    const saved = await service.create(input(), null);
    const stored = rows.get(saved.id) as WorkflowWebhookEndpointEntity;

    // Postgres hands jsonb back with its own key order.
    rows.set(saved.id, {
      ...stored,
      parameters: stored.parameters.map(
        ({ description, key, label, required, type }) =>
          ({ key, type, label, required, description }) as never,
      ),
    });

    const unchanged = await service.update(
      saved.id,
      { parameters: input().parameters },
      null,
    );

    expect(unchanged.id).toBe(saved.id);
    expect(audits.map((audit) => audit.action)).toEqual(['CREATED']);
  });

  it('refuses header values fetch would reject and hop-by-hop headers', async () => {
    const { service } = harness();

    await expect(
      service.create(
        input({ headers: [{ name: 'X-Name', value: '中文值' }] }),
        null,
      ),
    ).rejects.toThrow(/X-Name/);
    await expect(
      service.create(
        input({ headers: [{ name: 'Connection', value: 'close' }] }),
        null,
      ),
    ).rejects.toThrow(/set by BPM/);
  });

  it('answers a concurrent duplicate version with a sentence instead of a database error', async () => {
    const { service } = harness();
    const repository = (
      service as unknown as {
        readonly endpointRepository: {
          save: (value: unknown) => Promise<unknown>;
        };
      }
    ).endpointRepository;

    jest
      .spyOn(repository, 'save')
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

    await expect(service.create(input(), null)).rejects.toThrow(
      /version 1 already exists/,
    );
  });

  it('keeps a version’s parameter contract but lets labels change', async () => {
    const { audits, service } = harness();
    const saved = await service.create(input(), null);

    await expect(
      service.update(
        saved.id,
        {
          parameters: [
            { key: 'amount', label: '金額', required: false, type: 'number' },
          ],
        },
        null,
      ),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_ENDPOINT_CONTRACT_CHANGED');

    const updated = await service.update(
      saved.id,
      {
        label: 'CRM 名單',
        parameters: [
          { key: 'title', label: '標題', required: false, type: 'string' },
          { key: 'amount', label: '總額', required: true, type: 'number' },
        ],
      },
      'member-admin',
    );

    expect(updated.label).toBe('CRM 名單');
    expect(updated.parameters.map((parameter) => parameter.label)).toEqual([
      '標題',
      '總額',
    ]);
    expect(audits.at(-1)).toMatchObject({
      action: 'UPDATED',
      changedFields: ['label', 'parameters'],
    });
  });

  it('disables an endpoint so the catalog, publish lint and deliveries all see it', async () => {
    const { audits, source, service } = harness();
    const saved = await service.create(input(), null);
    const disabled = await service.setActive(saved.id, false, 'member-admin');
    const endpoint = source.toEndpoint(disabled);

    expect(endpoint.descriptor).toMatchObject({
      deprecated: true,
      disabled: true,
    });
    expect(audits.at(-1)).toMatchObject({
      action: 'DISABLED',
      changedFields: ['isActive'],
    });
  });

  it('rotates or removes the signing secret without returning it', async () => {
    const { audits, resolver, source, service } = harness();
    const saved = await service.create(input(), null);
    const rotated = await resolver.rotateWorkflowWebhookEndpointSecret(
      saved.id,
      'next-secret',
      'member-admin',
    );

    expect(JSON.stringify(rotated)).not.toContain('next-secret');
    expect(
      await source
        .toEndpoint(await service.rotateSecret(saved.id, 'next-secret', null))
        .buildRequest({} as BPMWorkflowWebhookEvent),
    ).toMatchObject({ signingSecret: 'next-secret' });

    const removed = await service.rotateSecret(saved.id, null, null);

    expect(removed.encryptedSigningSecret).toBeNull();
    expect(audits.at(-1)?.action).toBe('SECRET_ROTATED');
  });

  it('test-sends a sample event, never a real case, and limits how often', async () => {
    const { sent, service } = harness();
    const saved = await service.create(input(), null);
    const now = Date.parse('2026-09-15T10:00:00.000Z');

    await expect(
      service.testSend(saved.id, 'member-admin', now),
    ).resolves.toEqual({
      errorCode: null,
      errorDetail: null,
      ok: true,
      status: 200,
    });
    expect(sent[0]?.entry.source).toBe('DATABASE');
    expect(sent[0]?.event).toMatchObject({
      deliveryId: expect.stringMatching(/^test-/),
      instance: { id: 'test-instance' },
      parameters: { amount: 1, title: 'sample' },
    });

    await expect(
      service.testSend(saved.id, 'member-admin', now + 1_000),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_TEST_RATE_LIMITED');
    await expect(
      service.testSend(
        saved.id,
        'member-admin',
        now + WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('checks a database endpoint URL against the allowlist at publish time', async () => {
    const { service, source } = harness();
    const saved = await service.create(input(), null);
    const webhookService = (
      service as unknown as {
        readonly webhookService: WorkflowWebhookService;
      }
    ).webhookService;
    const entry = {
      endpoint: source.toEndpoint(saved),
      source: 'DATABASE' as const,
    };

    expect(await webhookService.isEndpointUrlAllowedAtPublish(entry)).toBe(
      true,
    );
    expect(
      await webhookService.isEndpointUrlAllowedAtPublish({
        endpoint: source.toEndpoint({
          ...saved,
          url: 'https://evil.test/hooks/x',
        }),
        source: 'DATABASE',
      }),
    ).toBe(false);
  });

  it('refuses every change when the database source is not enabled', async () => {
    const { resolver, service } = harness({ database: false });

    expect(resolver.workflowWebhookEndpointManagement()).toMatchObject({
      enabled: false,
    });
    await expect(service.create(input(), null)).rejects.toThrow(
      'WORKFLOW_WEBHOOK_DATABASE_SOURCE_DISABLED',
    );
  });

  it('is administrator-only', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        WorkflowWebhookEndpointAdminResolver,
      ),
    ).toContain(BPMAdminGuard);
  });
});
