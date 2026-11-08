import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * Phase 23 P4 gate (docs/23): a designer writes a cel-v2 edge condition that
 * uses `contains` and the wrapper host's `demo_costBand_v1`, checks it against
 * a sample, publishes, and cases route by it.
 *
 * The form and a draft template (start → gateway → high / default review →
 * end, the high edge still on a structured condition) are created through the
 * API; everything about the expression happens in the designer UI. Routing is
 * then checked on two cases submitted through the API.
 *
 * Needs `pnpm dev` (api + client) outside production, with the wrapper host's
 * demo expression functions registered (`apps/api/src/app/api-expression-functions.ts`).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';
const NAME_PREFIX = '[e2e-expr-designer]';
const HIGH_EDGE_ID = 'edge_gateway_high';
const EXPRESSION =
  'form.email.contains("@vip.") && demo_costBand_v1(form.amount) == "HIGH"';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

interface TaskRecord {
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
}

interface WorkflowEdgeRecord {
  readonly data: { readonly condition?: string; readonly conditionFieldKey?: string };
  readonly id: string;
}

const FORM_SCHEMA = {
  fields: [
    { fieldKey: 'email', label: '聯絡信箱', required: true, type: 'text' },
    { fieldKey: 'amount', label: '採購金額', required: true, type: 'number' },
  ],
  schemaVersion: 1,
};

const FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'email', width: 'FULL' },
    { fieldKey: 'amount', width: 'FULL' },
  ],
  schemaVersion: 1,
};

function userTask(id: string, label: string, x: number, y: number): Json {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function edge(source: string, target: string, data: Json = {}): Json {
  return {
    data,
    id: `edge_${source}_${target}`,
    source,
    target,
    type: 'smoothstep',
  };
}

/** The draft the designer starts from: the high edge is a structured condition. */
const DRAFT_WORKFLOW: Json = {
  edges: [
    edge('start', 'gateway'),
    {
      ...edge('gateway', 'review_high', {
        condition: 'form.amount > 1000',
        conditionFieldKey: 'amount',
        conditionOperator: 'GREATER_THAN',
        conditionValue: '1000',
      }),
      id: HIGH_EDGE_ID,
    },
    {
      ...edge('gateway', 'review_default', { isDefault: true, label: '其他情況' }),
      id: 'edge_gateway_default',
    },
    edge('review_high', 'end'),
    edge('review_default', 'end'),
  ],
  expressionDialect: 'cel-v2',
  meta: { schemaVersion: 1 },
  nodes: [
    { data: { label: '開始' }, id: 'start', position: { x: 0, y: 160 }, type: 'startEvent' },
    {
      data: { direction: 'split', label: '採購分流', triggerMode: 'AND' },
      id: 'gateway',
      position: { x: 220, y: 160 },
      type: 'exclusiveGateway',
    },
    userTask('review_high', '高額 VIP 簽核', 480, 40),
    userTask('review_default', '一般簽核', 480, 280),
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 760, y: 160 },
      type: 'endEvent',
    },
  ],
};

test.describe.configure({ mode: 'serial' });

test.describe('cel-v2 edge condition written in the designer (real backend)', () => {
  const runId = `${Date.now()}`;
  let admin: Page;
  let requester: Page;
  let templateId = '';

  test.beforeAll(async ({ browser }): Promise<void> => {
    admin = await createAuthenticatedPage(browser, ADMIN);
    requester = await createAuthenticatedPage(browser, REQUESTER);

    const formVersionId = await createPublishedForm(admin, runId);

    templateId = await createDraftTemplate(admin, formVersionId, runId);
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

  test('writes, checks, previews and publishes the expression', async (): Promise<void> => {
    test.setTimeout(120_000);

    await admin.goto(`/templates/${templateId}/designer`);

    // The dialect is on the header's description line (a Tag child of
    // ContentHeader is dropped by Mezzanine).
    await expect(admin.getByText(/運算式方言 cel-v2/u)).toBeVisible();

    await admin.getByTestId(`rf__edge-${HIGH_EDGE_ID}`).click({ force: true });
    await expect(admin.getByRole('heading', { name: '條件設定' })).toBeVisible();
    // Mezzanine's Toggle label is not a <label>, so the switch itself is
    // what turns the advanced expression on.
    await admin.getByRole('checkbox', { name: '進階：自訂運算式' }).check();

    const expression = admin.locator('textarea[name="edgeConditionExpression"]');

    await expect(expression).toBeVisible();
    await expression.fill(EXPRESSION);
    await expect(admin.getByText('通過檢查', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // The catalog lists the host function with its description as text.
    await expect(admin.getByRole('list', { name: '函式說明' })).toContainText(
      'demo_costBand_v1（採購金額級距）',
    );

    // The side panel, condition form included, stays inside the 1600 px
    // viewport, and nothing makes the page scroll sideways.
    const layout = await admin.evaluate(
      (): { readonly panelRight: number; readonly overflow: number } => ({
        overflow:
          document.documentElement.scrollWidth - window.innerWidth,
        panelRight:
          document
            .querySelector('.workflow-designer-side-panel')
            ?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
      }),
    );

    expect(layout.panelRight).toBeLessThanOrEqual(1600);
    expect(layout.overflow).toBeLessThanOrEqual(0);

    // Preview against a sample (EVALUATE on the backend).
    await admin
      .getByLabel('條件運算式試算樣本')
      .fill(
        JSON.stringify({
          form: { amount: 600000, email: 'buyer@vip.example.com' },
        }),
      );
    await admin.getByRole('button', { name: '以樣本試算' }).click();
    await expect(admin.getByText(/試算結果：true/u)).toBeVisible();

    await admin.getByRole('button', { name: '儲存草稿' }).click();
    await admin.getByRole('button', { name: '發布草稿' }).click();
    await expect(admin.getByText(/已發布 v1/u)).toBeVisible({ timeout: 20_000 });

    const published = await readPublishedEdges(admin, templateId);
    const highEdge = published.find((candidate) => candidate.id === HIGH_EDGE_ID);

    expect(highEdge?.data.condition).toBe(EXPRESSION);
    expect(highEdge?.data.conditionFieldKey ?? null).toBeNull();
  });

  test('routes a case by the published expression', async (): Promise<void> => {
    test.setTimeout(60_000);

    const vipHigh = await submit(requester, templateId, {
      amount: 600000,
      email: 'buyer@vip.example.com',
    }, `${NAME_PREFIX} VIP 高額 ${runId}`);
    const vipLow = await submit(requester, templateId, {
      amount: 1200,
      email: 'buyer@vip.example.com',
    }, `${NAME_PREFIX} VIP 小額 ${runId}`);
    const plainHigh = await submit(requester, templateId, {
      amount: 600000,
      email: 'buyer@example.com',
    }, `${NAME_PREFIX} 一般高額 ${runId}`);

    expect(await waitForPendingNode(admin, vipHigh)).toBe('review_high');
    expect(await waitForPendingNode(admin, vipLow)).toBe('review_default');
    expect(await waitForPendingNode(admin, plainHigh)).toBe('review_default');
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
        description: 'E2E cel-v2 edge condition form',
        name: `${NAME_PREFIX} 採購表單 ${runId}`,
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

/** A template with a saved, unpublished draft; the designer publishes it. */
async function createDraftTemplate(
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
        description: 'E2E cel-v2 edge condition journey',
        formDefinitionVersionId: formVersionId,
        name: `${NAME_PREFIX} 採購分流 ${runId}`,
      },
    },
  );
  const id = template.createApprovalTemplate.id;
  const draft = await readDraftVersionId(page, id);

  await gql(
    page,
    `mutation($input: UpdateApprovalTemplateDraftInput!) { updateApprovalTemplateDraft(input: $input) { id } }`,
    {
      input: {
        formDefinitionVersionId: formVersionId,
        initiatorPolicyCel: null,
        notificationConfigJson: null,
        slaDefaultsJson: null,
        versionId: draft,
        workflowDefinitionJson: JSON.stringify(DRAFT_WORKFLOW),
      },
    },
  );

  return id;
}

async function readDraftVersionId(
  page: Page,
  templateId: string,
): Promise<string | undefined> {
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

  return versions.approvalTemplateVersions.find(
    (version) => version.status === 'DRAFT',
  )?.id;
}

async function readPublishedEdges(
  page: Page,
  templateId: string,
): Promise<readonly WorkflowEdgeRecord[]> {
  const versions = await gql<{
    readonly approvalTemplateVersions: readonly {
      readonly status: string;
      readonly workflowDefinitionJson: string;
    }[];
  }>(
    page,
    `query($id: String!) { approvalTemplateVersions(templateId: $id) { status workflowDefinitionJson } }`,
    { id: templateId },
  );
  const published = versions.approvalTemplateVersions.find(
    (version) => version.status === 'PUBLISHED',
  );

  if (!published) {
    throw new Error('The template has no published version');
  }

  return (
    JSON.parse(published.workflowDefinitionJson) as {
      readonly edges: readonly WorkflowEdgeRecord[];
    }
  ).edges;
}

async function submit(
  page: Page,
  templateId: string,
  formData: Json,
  title: string,
): Promise<string> {
  const submitted = await gql<{
    readonly submitApprovalInstance: { readonly id: string };
  }>(
    page,
    `mutation($input: SubmitApprovalInstanceInput!) { submitApprovalInstance(input: $input) { id } }`,
    {
      input: {
        formDataJson: JSON.stringify(formData),
        initiatorMemberId: REQUESTER,
        initiatorMetadataSnapshotJson: null,
        templateId,
        title,
      },
    },
  );

  return submitted.submitApprovalInstance.id;
}

async function waitForPendingNode(
  page: Page,
  instanceId: string,
  deadline = Date.now() + 20_000,
): Promise<string> {
  const tasks = (
    await gql<{ readonly tasks: readonly TaskRecord[] }>(
      page,
      `query($id: String!) { tasks(instanceId: $id) { id nodeId status } }`,
      { id: instanceId },
    )
  ).tasks;
  const pending = tasks.find((task) => task.status === 'PENDING');

  if (pending) {
    return pending.nodeId;
  }

  if (Date.now() > deadline) {
    throw new Error(`No pending task on ${instanceId} after 20 s`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));

  return waitForPendingNode(page, instanceId, deadline);
}
