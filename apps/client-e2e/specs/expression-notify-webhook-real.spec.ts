import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * Phase 23 P5 gate (docs/23): NOTIFY webhook parameters bound by an
 * `EXPRESSION`. After the review is approved the notify node queues a
 * delivery whose parameters are the expressions' values, evaluated by the
 * engine in the decision's transaction (docs/24 §1).
 *
 * Delivers to the wrapper host's demo endpoint `demo.purchase-approved@1` and
 * reads what arrived from its demo sink (`/demo/webhook-sink/deliveries`,
 * `apps/api/src/app/api-demo-webhooks.ts`), like `notify-webhook-real.spec.ts`.
 *
 * Needs `pnpm dev` (api + client) outside production; the form and template
 * are created here, so the suite does not depend on `pnpm demo:reset`.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';
const NAME_PREFIX = '[e2e-expr-webhook]';
const TITLE_SUFFIX = '（運算式通知）';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

interface DeliveryRecord {
  readonly endpointKey: string;
  readonly id: string;
  readonly lastErrorCode: string | null;
  readonly nodeId: string;
  readonly status: string;
}

interface SinkDelivery {
  readonly deliveryId: string;
  readonly event: {
    readonly instance: { readonly id: string; readonly title: string };
    readonly parameters: Json;
  };
  readonly receipts: readonly {
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
    { fieldKey: 'subject', label: '申請主旨', required: true, type: 'text' },
    { fieldKey: 'amount', label: '申請金額', required: true, type: 'number' },
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

function edge(source: string, target: string): Json {
  return {
    data: {},
    id: `edge_${source}_${target}`,
    source,
    target,
    type: 'smoothstep',
  };
}

/** start → review → end, with a webhook-only notify node off the review. */
const WORKFLOW: Json = {
  edges: [
    edge('start', 'review'),
    edge('review', 'end'),
    edge('review', 'notify_erp'),
  ],
  meta: { schemaVersion: 1 },
  nodes: [
    { data: { label: '開始' }, id: 'start', position: { x: 0, y: 0 }, type: 'startEvent' },
    {
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: false,
        approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
        decisionPolicy: { type: 'SINGLE' },
        label: '審核',
        returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
      },
      id: 'review',
      position: { x: 260, y: 0 },
      type: 'userTask',
    },
    {
      data: {
        action: {
          channels: ['IN_APP'],
          recipients: { memberIds: [], type: 'DIRECT' },
          type: 'NOTIFY',
          webhooks: [
            {
              bindings: [
                {
                  from: { expression: 'form.amount', kind: 'EXPRESSION' },
                  parameter: 'amount',
                },
                {
                  from: {
                    expression: `form.subject + "${TITLE_SUFFIX}"`,
                    kind: 'EXPRESSION',
                  },
                  parameter: 'caseTitle',
                },
              ],
              endpoint: { key: 'demo.purchase-approved', version: 1 },
              id: 'webhook_expression',
            },
          ],
        },
        label: '通知 ERP',
        triggerMode: 'AND',
      },
      id: 'notify_erp',
      position: { x: 260, y: 220 },
      type: 'serviceTask',
    },
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 520, y: 0 },
      type: 'endEvent',
    },
  ],
};

test.describe.configure({ mode: 'serial' });

test.describe('NOTIFY webhook EXPRESSION parameters (real backend)', () => {
  const runId = `${Date.now()}`;
  const subject = `${NAME_PREFIX} 運算式通知 ${runId}`;
  let admin: Page;
  let requester: Page;
  let templateId = '';

  test.beforeAll(async ({ browser }): Promise<void> => {
    admin = await createAuthenticatedPage(browser, ADMIN);
    requester = await createAuthenticatedPage(browser, REQUESTER);
    await admin
      .context()
      .request.delete(`${API_URL}/demo/webhook-sink/deliveries`);

    const formVersionId = await createPublishedForm(admin, runId);

    // Publishing lints both expressions (cel-v2, built-in functions only).
    templateId = await createPublishedTemplate(admin, formVersionId, runId);
  });

  test.afterAll(async (): Promise<void> => {
    if (!admin || !requester) {
      return;
    }

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

  test('delivers the expressions values once the review is approved', async (): Promise<void> => {
    test.setTimeout(90_000);

    const instanceId = await submit(requester, templateId, subject, 1200);

    // Nothing is queued before the decision.
    expect(await readDeliveries(admin, instanceId)).toEqual([]);

    await approve(admin, instanceId, 'review');

    const delivery = await waitFor(
      async (): Promise<DeliveryRecord | null> =>
        (await readDeliveries(admin, instanceId)).find(
          (candidate) =>
            candidate.endpointKey === 'demo.purchase-approved' &&
            candidate.status === 'SENT',
        ) ?? null,
      (candidate) => candidate !== null,
      30_000,
    );

    expect(delivery?.nodeId).toBe('notify_erp');

    const sink = await waitFor(
      async (): Promise<SinkDelivery | null> =>
        (
          (await (
            await admin
              .context()
              .request.get(`${API_URL}/demo/webhook-sink/deliveries`)
          ).json()) as readonly SinkDelivery[]
        ).find((candidate) => candidate.deliveryId === delivery?.id) ?? null,
      (candidate) => (candidate?.receipts.length ?? 0) >= 1,
      10_000,
    );

    expect(sink?.receipts[0]).toMatchObject({
      respondedWith: 200,
      signatureValid: true,
    });
    expect(sink?.event.parameters).toEqual({
      amount: 1200,
      caseTitle: `${subject}${TITLE_SUFFIX}`,
    });
    expect(sink?.event.instance.id).toBe(instanceId);
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

async function gql<TData = Json>(
  page: Page,
  query: string,
  variables: Json,
): Promise<TData> {
  const response = await page.context().request.post(GRAPHQL_URL, {
    data: { query, variables },
  });
  const result = (await response.json()) as GraphQlResult<TData>;

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
        description: 'E2E NOTIFY webhook EXPRESSION form',
        name: `${NAME_PREFIX} 採購通知表單 ${runId}`,
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
  formVersionId: string,
  runId: string,
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
        description: 'E2E NOTIFY webhook EXPRESSION journey',
        formDefinitionVersionId: formVersionId,
        name: `${NAME_PREFIX} 採購通知流程 ${runId}`,
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
        workflowDefinitionJson: JSON.stringify(WORKFLOW),
      },
    },
  );
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
  subject: string,
  amount: number,
): Promise<string> {
  const submitted = await gql<{
    readonly submitApprovalInstance: { readonly id: string };
  }>(
    page,
    `mutation($input: SubmitApprovalInstanceInput!) { submitApprovalInstance(input: $input) { id } }`,
    {
      input: {
        formDataJson: JSON.stringify({ amount, subject }),
        initiatorMemberId: REQUESTER,
        initiatorMetadataSnapshotJson: null,
        templateId,
        title: subject,
      },
    },
  );

  return submitted.submitApprovalInstance.id;
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
      `query($id: ID!) { workflowWebhookDeliveries(instanceId: $id) { endpointKey id lastErrorCode nodeId status } }`,
      { id: instanceId },
    )
  ).workflowWebhookDeliveries;
}

async function approve(
  page: Page,
  instanceId: string,
  nodeId: string,
): Promise<void> {
  const task = await waitFor(
    async (): Promise<TaskRecord | null> =>
      (
        await gql<{ readonly tasks: readonly TaskRecord[] }>(
          page,
          `query($id: String!) { tasks(instanceId: $id) { id nodeId status } }`,
          { id: instanceId },
        )
      ).tasks.find(
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
        action: 'APPROVED',
        comment: null,
        decidedByMemberId: ADMIN,
        returnToNodeId: null,
        taskId: task?.id,
        transferToMemberId: null,
      },
    },
  );
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
