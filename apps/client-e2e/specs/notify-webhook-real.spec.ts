import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * NOTIFY webhooks end to end against the real wrapper host (ADR 18, P5).
 *
 * Needs `pnpm dev` (api + client) outside production: the demo endpoints and
 * their receiver (`apps/api/src/app/api-demo-webhooks.ts`) are what these
 * journeys deliver to. The form and templates are created here, so the suite
 * does not depend on `pnpm demo:reset`.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';
const DEMO_SIGNING_SECRET = 'bpm-demo-webhook-signing-secret';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly {
    readonly extensions?: { readonly code?: string };
    readonly message: string;
  }[];
}

interface DeliveryRecord {
  readonly attemptCount: number;
  readonly endpointKey: string;
  readonly endpointLabel: string | null;
  readonly id: string;
  readonly lastErrorCode: string | null;
  readonly lastResponseStatus: number | null;
  readonly nodeId: string;
  readonly status: string;
}

interface SinkDelivery {
  readonly deliveryId: string;
  readonly event: {
    readonly parameters: Json;
    readonly instance: { readonly id: string; readonly title: string };
  };
  readonly receipts: readonly {
    readonly attempt: number;
    readonly mode: string;
    readonly respondedWith: number;
    readonly signatureValid: boolean;
  }[];
}

interface TaskRecord {
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
}

const FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'subject',
      label: '申請主旨',
      placeholder: '請輸入申請主旨',
      required: true,
      type: 'text',
    },
    {
      fieldKey: 'amount',
      label: '申請金額',
      placeholder: '請輸入金額',
      required: true,
      type: 'number',
    },
  ],
  schemaVersion: 1,
};

const FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'subject', width: 'FULL' },
    { fieldKey: 'amount', width: 'FULL' },
  ],
  schemaVersion: 1,
};

function userTask(
  id: string,
  label: string,
  x: number,
  returnBehavior: Json = { allowReturn: false, allowedTargets: 'PREVIOUS' },
): Json {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior,
    },
    id,
    position: { x, y: 0 },
    type: 'userTask',
  };
}

function edge(source: string, target: string): Json {
  return {
    data: {},
    id: `edge_${source}_${target}`,
    source,
    target,
    type: 'smoothstep',
  };
}

/**
 * start → first review → second review → end, with a webhook-only notify
 * node branching off the first review. The second review can return the
 * case to the initiator with RESTART, so a resubmission passes the notify
 * node again.
 */
function readRuntimeWorkflow(recipientMemberIds: readonly string[] = []): Json {
  return {
    edges: [
      edge('start', 'review_first'),
      edge('review_first', 'review_second'),
      edge('review_first', 'notify_systems'),
      edge('review_second', 'end'),
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 0, y: 0 },
        type: 'startEvent',
      },
      userTask('review_first', '初審', 260),
      userTask('review_second', '複審', 520, {
        allowReturn: true,
        allowedTargets: 'INITIATOR',
        resubmitStrategy: 'RESTART',
      }),
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: { memberIds: [...recipientMemberIds], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [
              {
                bindings: [
                  {
                    from: { fieldKey: 'amount', kind: 'FIELD' },
                    parameter: 'amount',
                  },
                  {
                    from: { kind: 'CONTEXT', path: 'instance.title' },
                    parameter: 'caseTitle',
                  },
                ],
                endpoint: { key: 'demo.purchase-approved', version: 1 },
                id: 'webhook_ok',
              },
              {
                bindings: [
                  {
                    from: { kind: 'CONTEXT', path: 'instance.id' },
                    parameter: 'caseId',
                  },
                ],
                endpoint: { key: 'demo.flaky', version: 1 },
                id: 'webhook_flaky',
              },
              {
                bindings: [],
                endpoint: { key: 'demo.slow', version: 1 },
                id: 'webhook_slow',
              },
              {
                bindings: [
                  {
                    from: { kind: 'CONSTANT', value: 'E2E' },
                    parameter: 'caseId',
                  },
                ],
                endpoint: { key: 'demo.switchable', version: 1 },
                id: 'webhook_switchable',
              },
            ],
          },
          label: '通知外部系統',
          triggerMode: 'AND',
        },
        id: 'notify_systems',
        position: { x: 260, y: 220 },
        type: 'serviceTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 780, y: 0 },
        type: 'endEvent',
      },
    ],
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('notify webhooks (real backend)', () => {
  const runId = `${Date.now()}`;
  const caseTitle = `E2E Webhook 案件 ${runId}`;
  let admin: Page;
  let requester: Page;
  let templateId = '';
  let formVersionId = '';
  let instanceId = '';

  test.beforeAll(async ({ browser }): Promise<void> => {
    admin = await createAuthenticatedPage(browser, ADMIN);
    requester = await createAuthenticatedPage(browser, REQUESTER);
    await resetSink(admin);

    formVersionId = await createPublishedForm(admin, runId);
    templateId = await createPublishedTemplate(admin, {
      formVersionId,
      name: `E2E Webhook 流程 ${runId}`,
      workflow: readRuntimeWorkflow(),
    });
  });

  test.afterAll(async (): Promise<void> => {
    if (!admin || !requester) {
      return;
    }

    await setSinkMode(admin, 'switchable', {}).catch(() => undefined);

    if (templateId) {
      await gql(
        admin,
        `mutation($id: String!) { deactivateApprovalTemplate(id: $id) { id } }`,
        { id: templateId },
      ).catch(() => undefined);
    }

    await admin.context().close();
    await requester.context().close();
  });

  test('delivers on reaching the notify node without holding the decision up', async (): Promise<void> => {
    test.setTimeout(120_000);
    await setSinkMode(admin, 'switchable', { status: 400 });

    instanceId = await submit(requester, templateId, caseTitle, 1200);

    const startedAt = Date.now();
    await decide(admin, instanceId, 'review_first', 'APPROVED');
    // The slow receiver takes 15 s; delivery runs after the commit.
    expect(Date.now() - startedAt).toBeLessThan(8_000);

    const ok = await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        delivery.endpointKey === 'demo.purchase-approved' &&
        delivery.status === 'SENT',
      30_000,
    );
    const sink = await waitForSink(admin, ok.id, 1, 10_000);

    expect(sink.receipts[0]).toMatchObject({
      mode: 'ok',
      respondedWith: 200,
      signatureValid: true,
    });
    expect(sink.event.parameters).toEqual({ amount: 1200, caseTitle });
    expect(sink.event.instance).toMatchObject({
      id: instanceId,
      title: caseTitle,
    });

    // A 4xx is final at once.
    await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        delivery.endpointKey === 'demo.switchable' &&
        delivery.status === 'FAILED' &&
        delivery.lastErrorCode === 'WEBHOOK_HTTP_400',
      30_000,
    );
    // The slow receiver outlasts the 10 s timeout: aborted, then queued again.
    await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        delivery.endpointKey === 'demo.slow' &&
        delivery.status === 'PENDING' &&
        delivery.lastErrorCode === 'WEBHOOK_TIMEOUT',
      40_000,
    );
    await expect
      .poll(async () =>
        (await readTasks(admin, instanceId)).map(
          (t) => `${t.nodeId}:${t.status}`,
        ),
      )
      .toContain('review_second:PENDING');
  });

  test('retries a receiver that fails twice under the same delivery id', async (): Promise<void> => {
    test.setTimeout(300_000);

    const flaky = await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        delivery.endpointKey === 'demo.flaky' && delivery.status === 'SENT',
      280_000,
    );
    const sink = await waitForSink(admin, flaky.id, 3, 10_000);

    expect(flaky.attemptCount).toBe(3);
    expect(sink.receipts.map((receipt) => receipt.respondedWith)).toEqual([
      503, 503, 200,
    ]);
    expect(sink.receipts.every((receipt) => receipt.signatureValid)).toBe(true);

    const terminalLogs = (await readActivityLogs(admin, instanceId)).filter(
      (log) =>
        (log.eventType === 'SERVICE_TASK_EXECUTED' ||
          log.eventType === 'SERVICE_TASK_FAILED') &&
        log.payloadJson.includes(flaky.id),
    );

    expect(terminalLogs).toHaveLength(1);
  });

  test('lets an administrator resend a permanently failed delivery from the case page', async (): Promise<void> => {
    test.setTimeout(90_000);
    await setSinkMode(admin, 'switchable', {});

    const failed = await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        delivery.endpointKey === 'demo.switchable' &&
        delivery.status === 'FAILED',
      10_000,
    );

    await admin.goto(`/instances/${instanceId}`);

    const section = admin
      .getByRole('heading', { name: '外部系統通知' })
      .locator('xpath=..');
    const row = section.locator('tr', { hasText: 'demo.switchable@1' });

    await expect(row).toContainText('失敗');
    await row.getByRole('button', { name: '重新傳送' }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: '重新傳送' })
      .click();

    // The section follows the delivery while it is in flight.
    await expect(row).toContainText('已送達', { timeout: 30_000 });

    const resent = await waitForDelivery(
      admin,
      instanceId,
      (delivery) => delivery.id === failed.id && delivery.status === 'SENT',
      10_000,
    );

    expect(resent.id).toBe(failed.id);
    await expect(
      admin.getByText('管理者重新傳送外部系統通知：示範：可切換回應的接收端'),
    ).toBeVisible();
  });

  test('keeps delivery details from members who are not administrators', async (): Promise<void> => {
    const deliveries = await gqlRaw(
      requester,
      `query($id: ID!) { workflowWebhookDeliveries(instanceId: $id) { id } }`,
      { id: instanceId },
    );
    const retry = await gqlRaw(
      requester,
      `mutation($id: ID!) { retryWorkflowWebhookDelivery(id: $id) { id } }`,
      { id: instanceId },
    );
    const catalog = await gqlRaw(
      requester,
      `{ workflowWebhookEndpoints { key } }`,
      {},
    );

    expect(deliveries.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(retry.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(catalog.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    await requester.goto(`/instances/${instanceId}`);
    await expect(
      requester.getByText('已通知外部系統：示範：採購核准通知 ERP'),
    ).toBeVisible();
    await expect(
      requester.getByRole('heading', { name: '外部系統通知' }),
    ).toHaveCount(0);
    await expect(requester.getByText(/WEBHOOK_[A-Z0-9_]+/)).toHaveCount(0);
  });

  test('never exposes a URL or secret in templates, snapshots, the catalog or activity logs', async (): Promise<void> => {
    const payloads = [
      JSON.stringify(
        await gql(
          admin,
          `query($id: String!) { approvalTemplateVersions(templateId: $id) { workflowDefinitionJson } }`,
          { id: templateId },
        ),
      ),
      JSON.stringify(
        await gql(
          admin,
          `query($id: String!) { approvalInstance(id: $id) { workflowSnapshotJson formDataJson } }`,
          { id: instanceId },
        ),
      ),
      JSON.stringify(
        await gql(
          admin,
          `{ workflowWebhookEndpoints(includeDeprecated: true) { key label description parameters { key label description } } }`,
          {},
        ),
      ),
      JSON.stringify(await readActivityLogs(admin, instanceId)),
    ];

    for (const payload of payloads) {
      expect(payload).not.toMatch(/https?:\/\//);
      expect(payload).not.toContain('/demo/webhook-sink');
      // The secret compared here is the local default; a Vault-provided one
      // is covered by the key names below instead.
      expect(payload).not.toContain(DEMO_SIGNING_SECRET);
      expect(payload).not.toMatch(
        /signingSecret|x-bpm-signature|authorization/i,
      );
    }
  });

  test('queues new deliveries when a restarted case passes the notify node again', async (): Promise<void> => {
    test.setTimeout(90_000);

    const before = await readDeliveries(admin, instanceId);

    await decide(
      admin,
      instanceId,
      'review_second',
      'RETURNED',
      'E2E 退回重送',
    );
    await gql(
      requester,
      `mutation($input: ResubmitApprovalInstanceInput!) { resubmitApprovalInstance(input: $input) { id state } }`,
      {
        input: {
          formDataJson: JSON.stringify({ amount: 800, subject: caseTitle }),
          initiatorMemberId: REQUESTER,
          instanceId,
          title: caseTitle,
        },
      },
    );
    await decide(admin, instanceId, 'review_first', 'APPROVED');

    const after = await waitForDeliveries(
      admin,
      instanceId,
      (deliveries) => deliveries.length === before.length * 2,
      30_000,
    );
    const fresh = after.filter(
      (delivery) => !before.some((previous) => previous.id === delivery.id),
    );

    expect(fresh.map((delivery) => delivery.endpointKey).sort()).toEqual(
      before.map((delivery) => delivery.endpointKey).sort(),
    );

    const freshOk = await waitForDelivery(
      admin,
      instanceId,
      (delivery) =>
        fresh.some((candidate) => candidate.id === delivery.id) &&
        delivery.endpointKey === 'demo.purchase-approved' &&
        delivery.status === 'SENT',
      30_000,
    );

    expect(
      (await waitForSink(admin, freshOk.id, 1, 10_000)).event.parameters,
    ).toMatchObject({ amount: 800 });
  });
});

test.describe('notify webhooks in the designer (real backend)', () => {
  test('binds all three sources, blocks publishing on a missing parameter and keeps webhooks when recipients change', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(120_000);

    const runId = `${Date.now()}`;
    const admin = await createAuthenticatedPage(browser, ADMIN);
    let templateId = '';

    try {
      const formVersionId = await createPublishedForm(admin, runId);

      templateId = await createPublishedTemplate(admin, {
        formVersionId,
        name: `E2E Webhook 設計器 ${runId}`,
        workflow: readRuntimeWorkflow([ADMIN]),
      });

      await admin.goto(`/templates/${templateId}/designer`);

      const notifyCard = admin
        .locator('.react-flow__node')
        .filter({ hasText: '通知外部系統' });

      await expect(notifyCard).toContainText('Webhook 4 個');
      await expect(notifyCard).toContainText('林總經理');
      await notifyCard.click();
      await expect(admin.getByText(/第 \d+ 個 Webhook/)).toHaveCount(4);

      // Regression: editing recipients used to rebuild the whole action.
      await admin
        .locator('.mzn-tag', { hasText: '林總經理' })
        .locator('.mzn-tag__close-button')
        .click();
      await expect(notifyCard).not.toContainText('林總經理');
      await expect(notifyCard).toContainText('Webhook 4 個');
      await expect(admin.getByText(/第 \d+ 個 Webhook/)).toHaveCount(4);

      // A fifth target starts unbound: its required amount blocks publishing.
      await admin.getByRole('button', { name: '新增 Webhook' }).click();
      await expect(
        admin.getByText(
          /發布前需修正：.*第 5 個 Webhook.*必填參數「amount」尚未設定/,
        ),
      ).toBeVisible();

      const publish = admin.getByRole('button', {
        name: /保存並發布|發布草稿/,
      });

      await expect(publish).toBeDisabled();
      await expect(
        admin.getByRole('button', { name: '儲存草稿' }),
      ).toBeEnabled();

      // FIELD: a number parameter only offers number fields and constants.
      await admin.getByPlaceholder('選擇來源').last().click();
      await expect(admin.getByRole('option')).toHaveText([
        '表單欄位',
        '固定值',
      ]);
      await admin.getByRole('option', { name: '表單欄位' }).click();
      await expect(admin.getByText(/發布前需修正/)).toHaveCount(0);

      // CONSTANT, for the fifth target's optional title. Options can open
      // below the fold, so they are selected directly.
      await admin.locator('input[value="不傳送"]').last().click();
      await admin
        .getByRole('option', { name: '固定值' })
        .dispatchEvent('click');
      await admin.getByPlaceholder('輸入固定值').last().fill('設計器常數');

      // CONTEXT, replacing the constant the fourth target was created with.
      await admin.locator('input[value="固定值"]').nth(0).click();
      await admin
        .getByRole('option', { name: '案件資訊' })
        .dispatchEvent('click');
      await expect(admin.getByText(/發布前需修正/)).toHaveCount(0);
      await expect(publish).toBeEnabled();

      await publish.click();

      // The header already read "published" before this publish, so wait on
      // the version itself.
      const versions = await waitFor(
        () =>
          gql<{
            readonly approvalTemplateVersions: readonly {
              readonly status: string;
              readonly version: number;
              readonly workflowDefinitionJson: string;
            }[];
          }>(
            admin,
            `query($id: String!) { approvalTemplateVersions(templateId: $id) { status version workflowDefinitionJson } }`,
            { id: templateId },
          ),
        (result) =>
          result.approvalTemplateVersions.some(
            (version) => version.status === 'PUBLISHED' && version.version > 1,
          ),
        20_000,
      );
      const published = versions.approvalTemplateVersions.find(
        (version) => version.status === 'PUBLISHED' && version.version > 1,
      );
      const notify = (
        JSON.parse(published?.workflowDefinitionJson ?? '{}') as {
          readonly nodes: readonly {
            readonly id: string;
            readonly data: {
              readonly action?: {
                readonly recipients: { readonly memberIds: readonly string[] };
                readonly webhooks: readonly {
                  readonly bindings: readonly Json[];
                  readonly endpoint: { readonly key: string };
                  readonly id: string;
                }[];
              };
            };
          }[];
        }
      ).nodes.find((node) => node.id === 'notify_systems')?.data.action;

      expect(notify?.recipients.memberIds).toEqual([]);
      expect(notify?.webhooks).toHaveLength(5);
      expect(
        notify?.webhooks.find((target) => target.id === 'webhook_switchable')
          ?.bindings,
      ).toEqual([
        {
          from: { kind: 'CONTEXT', path: 'instance.title' },
          parameter: 'caseId',
        },
      ]);
      expect(notify?.webhooks[4]).toMatchObject({
        bindings: [
          { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
          {
            from: { kind: 'CONSTANT', value: '設計器常數' },
            parameter: 'caseTitle',
          },
        ],
        endpoint: { key: 'demo.purchase-approved' },
      });
    } finally {
      if (templateId) {
        await gql(
          admin,
          `mutation($id: String!) { deactivateApprovalTemplate(id: $id) { id } }`,
          { id: templateId },
        ).catch(() => undefined);
      }

      await admin.context().close();
    }
  });
});

async function createAuthenticatedPage(
  browser: Browser,
  memberId: string,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { height: 1100, width: 1600 },
  });
  const page = await context.newPage();

  await authenticateApiMember(page, memberId);
  await page.goto('/');

  return page;
}

async function gqlRaw<TData>(
  page: Page,
  query: string,
  variables: Json,
): Promise<GraphQlResult<TData>> {
  const response = await page.context().request.post(GRAPHQL_URL, {
    data: { query, variables },
  });

  return (await response.json()) as GraphQlResult<TData>;
}

async function gql<TData = Json>(
  page: Page,
  query: string,
  variables: Json,
): Promise<TData> {
  const result = await gqlRaw<TData>(page, query, variables);

  if (result.errors?.length || !result.data) {
    throw new Error(
      result.errors?.map((error) => error.message).join('; ') ??
        'GraphQL response did not include data',
    );
  }

  return result.data;
}

async function createPublishedForm(page: Page, runId: string): Promise<string> {
  const created = await gql<{
    readonly createFormDefinition: { readonly id: string };
  }>(
    page,
    `mutation($input: CreateFormDefinitionInput!) { createFormDefinition(input: $input) { id } }`,
    {
      input: {
        createdByMemberId: ADMIN,
        description: 'E2E notify webhook form',
        name: `E2E Webhook 表單 ${runId}`,
        schemaJson: JSON.stringify(FORM_SCHEMA),
        uiSchemaJson: JSON.stringify(FORM_UI_SCHEMA),
      },
    },
  );
  const versions = await gql<{
    readonly formDefinitionVersions: readonly {
      readonly id: string;
      readonly status: string;
    }[];
  }>(
    page,
    `query($id: String!) { formDefinitionVersions(formDefinitionId: $id) { id status } }`,
    { id: created.createFormDefinition.id },
  );
  const draft = versions.formDefinitionVersions.find(
    (version) => version.status === 'DRAFT',
  );
  const published = await gql<{
    readonly publishFormDefinitionVersion: { readonly id: string };
  }>(
    page,
    `mutation($versionId: String!, $by: String) { publishFormDefinitionVersion(versionId: $versionId, publishedByMemberId: $by) { id } }`,
    { by: ADMIN, versionId: draft?.id },
  );

  return published.publishFormDefinitionVersion.id;
}

async function createPublishedTemplate(
  page: Page,
  {
    formVersionId,
    name,
    workflow,
  }: {
    readonly formVersionId: string;
    readonly name: string;
    readonly workflow: Json;
  },
): Promise<string> {
  const template = await gql<{
    readonly createApprovalTemplate: { readonly id: string };
  }>(
    page,
    `mutation($input: CreateApprovalTemplateInput!) { createApprovalTemplate(input: $input) { id } }`,
    {
      input: {
        category: 'E2E',
        createdByMemberId: ADMIN,
        description: 'E2E notify webhook journey',
        formDefinitionVersionId: formVersionId,
        name,
      },
    },
  );
  const templateId = template.createApprovalTemplate.id;
  const versions = await gql<{
    readonly approvalTemplateVersions: readonly {
      readonly id: string;
      readonly status: string;
    }[];
  }>(
    page,
    `query($id: String!) { approvalTemplateVersions(templateId: $id) { id status } }`,
    { id: templateId },
  );
  const draft = versions.approvalTemplateVersions.find(
    (version) => version.status === 'DRAFT',
  );

  await gql(
    page,
    `mutation($input: UpdateApprovalTemplateDraftInput!) { updateApprovalTemplateDraft(input: $input) { id } }`,
    {
      input: {
        formDefinitionVersionId: formVersionId,
        initiatorPolicyCel: null,
        notificationConfigJson: null,
        slaDefaultsJson: null,
        versionId: draft?.id,
        workflowDefinitionJson: JSON.stringify(workflow),
      },
    },
  );
  // Publishing runs the webhook publish lint against the host registry.
  await gql(
    page,
    `mutation($versionId: String!, $by: String) { publishApprovalTemplateVersion(versionId: $versionId, publishedByMemberId: $by) { id } }`,
    { by: ADMIN, versionId: draft?.id },
  );

  return templateId;
}

async function submit(
  page: Page,
  templateId: string,
  title: string,
  amount: number,
): Promise<string> {
  const submitted = await gql<{
    readonly submitApprovalInstance: { readonly id: string };
  }>(
    page,
    `mutation($input: SubmitApprovalInstanceInput!) { submitApprovalInstance(input: $input) { id } }`,
    {
      input: {
        formDataJson: JSON.stringify({ amount, subject: title }),
        initiatorMemberId: REQUESTER,
        initiatorMetadataSnapshotJson: null,
        templateId,
        title,
      },
    },
  );

  return submitted.submitApprovalInstance.id;
}

async function readTasks(
  page: Page,
  instanceId: string,
): Promise<readonly TaskRecord[]> {
  return (
    await gql<{ readonly tasks: readonly TaskRecord[] }>(
      page,
      `query($id: String!) { tasks(instanceId: $id) { id nodeId status } }`,
      { id: instanceId },
    )
  ).tasks;
}

async function decide(
  page: Page,
  instanceId: string,
  nodeId: string,
  action: 'APPROVED' | 'RETURNED',
  comment: string | null = null,
): Promise<void> {
  const task = await waitFor(
    async () =>
      (await readTasks(page, instanceId)).find(
        (candidate) =>
          candidate.nodeId === nodeId && candidate.status === 'PENDING',
      ) ?? null,
    (candidate) => candidate !== null,
    20_000,
  );

  await gql(
    page,
    `mutation($input: DecideTaskInput!) { decideTask(input: $input) { id } }`,
    {
      input: {
        action,
        comment,
        decidedByMemberId: ADMIN,
        returnToNodeId: null,
        taskId: task?.id,
        transferToMemberId: null,
      },
    },
  );
}

async function readDeliveries(
  page: Page,
  instanceId: string,
): Promise<readonly DeliveryRecord[]> {
  return (
    await gql<{
      readonly workflowWebhookDeliveries: readonly DeliveryRecord[];
    }>(
      page,
      `query($id: ID!) { workflowWebhookDeliveries(instanceId: $id) { attemptCount endpointKey endpointLabel id lastErrorCode lastResponseStatus nodeId status } }`,
      { id: instanceId },
    )
  ).workflowWebhookDeliveries;
}

async function readActivityLogs(
  page: Page,
  instanceId: string,
): Promise<
  readonly { readonly eventType: string; readonly payloadJson: string }[]
> {
  return (
    await gql<{
      readonly activityLogs: readonly {
        readonly eventType: string;
        readonly payloadJson: string;
      }[];
    }>(
      page,
      `query($id: String!) { activityLogs(instanceId: $id) { eventType payloadJson } }`,
      { id: instanceId },
    )
  ).activityLogs;
}

async function waitForDeliveries(
  page: Page,
  instanceId: string,
  done: (deliveries: readonly DeliveryRecord[]) => boolean,
  timeoutMs: number,
): Promise<readonly DeliveryRecord[]> {
  return waitFor(() => readDeliveries(page, instanceId), done, timeoutMs);
}

async function waitForDelivery(
  page: Page,
  instanceId: string,
  match: (delivery: DeliveryRecord) => boolean,
  timeoutMs: number,
): Promise<DeliveryRecord> {
  const deliveries = await waitForDeliveries(
    page,
    instanceId,
    (candidates) => candidates.some(match),
    timeoutMs,
  );

  return deliveries.find(match) as DeliveryRecord;
}

async function waitForSink(
  page: Page,
  deliveryId: string,
  receipts: number,
  timeoutMs: number,
): Promise<SinkDelivery> {
  const delivery = await waitFor(
    async () =>
      (
        (await (
          await page
            .context()
            .request.get(`${API_URL}/demo/webhook-sink/deliveries`)
        ).json()) as readonly SinkDelivery[]
      ).find((candidate) => candidate.deliveryId === deliveryId) ?? null,
    (candidate) => (candidate?.receipts.length ?? 0) >= receipts,
    timeoutMs,
  );

  return delivery as SinkDelivery;
}

async function resetSink(page: Page): Promise<void> {
  await page
    .context()
    .request.delete(`${API_URL}/demo/webhook-sink/deliveries`);
}

async function setSinkMode(
  page: Page,
  mode: string,
  behavior: Json,
): Promise<void> {
  const response = await page
    .context()
    .request.put(`${API_URL}/demo/webhook-sink/modes/${mode}`, {
      data: behavior,
    });

  expect(response.ok()).toBe(true);
}

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
  deadline = Date.now() + timeoutMs,
): Promise<T> {
  const value = await read();

  if (done(value)) {
    return value;
  }

  if (Date.now() > deadline) {
    throw new Error(
      `Timed out after ${timeoutMs} ms; last value: ${JSON.stringify(value)}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));

  return waitFor(read, done, timeoutMs, deadline);
}
