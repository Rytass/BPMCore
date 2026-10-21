import { Browser, expect, Locator, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * Approver-filled fields end to end against the real wrapper host
 * (ADR 20, docs/21 P2). The form and template are created here, so the suite
 * does not depend on `pnpm demo:reset`.
 *
 * start → 主管審核 → 財務審核 (fills 發票號碼 required, 費用明細 optional)
 *       → 總經理核定 → end
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

interface TaskRecord {
  readonly hasFillableFields: boolean;
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
}

const FORM_SCHEMA = {
  fields: [
    { fieldKey: 'subject', label: '申請主旨', required: true, type: 'text' },
    { fieldKey: 'amount', label: '申請金額', required: true, type: 'number' },
    { fieldKey: 'invoiceNo', label: '發票號碼', required: false, type: 'text' },
    {
      columns: [
        { fieldKey: 'item', label: '品項', required: true, type: 'text' },
        { fieldKey: 'cost', label: '金額', required: true, type: 'number' },
      ],
      fieldKey: 'costItems',
      label: '費用明細',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};

const FORM_UI_SCHEMA = {
  layout: FORM_SCHEMA.fields.map((field) => ({
    fieldKey: field.fieldKey,
    width: 'FULL',
  })),
  schemaVersion: 1,
};

function userTask(
  id: string,
  label: string,
  x: number,
  fieldAccess: readonly Json[] = [],
): Json {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess,
      label,
      returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
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

const WORKFLOW = {
  edges: [
    edge('start', 'manager'),
    edge('manager', 'finance'),
    edge('finance', 'director'),
    edge('director', 'end'),
  ],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'startEvent',
    },
    userTask('manager', '主管審核', 260),
    userTask('finance', '財務審核', 520, [
      { display: 'SHOW', fieldKey: 'invoiceNo', fill: 'REQUIRED' },
      { display: 'SHOW', fieldKey: 'costItems', fill: 'OPTIONAL' },
    ]),
    userTask('director', '總經理核定', 780),
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 1040, y: 0 },
      type: 'endEvent',
    },
  ],
};

test.describe.configure({ mode: 'serial' });

test.describe('approver-filled fields (real backend)', () => {
  const runId = `${Date.now()}`;
  let admin: Page;
  let requester: Page;
  let templateId = '';
  let formVersionId = '';

  test.beforeAll(async ({ browser }): Promise<void> => {
    admin = await createAuthenticatedPage(browser, ADMIN);
    requester = await createAuthenticatedPage(browser, REQUESTER);

    formVersionId = await createPublishedForm(admin, runId);

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

  test('the finance approver fills in fields and approves them with the decision', async (): Promise<void> => {
    test.setTimeout(180_000);
    const title = `E2E 補填案件 ${runId}`;
    const instanceId = await submit(requester, templateId, title);

    await decide(admin, instanceId, 'manager');
    const financeTask = await waitForPendingTask(admin, instanceId, 'finance');

    // The task list reads the flag in its batch query.
    expect(financeTask.hasFillableFields).toBe(true);
    const inbox = await gql<{
      readonly inboxTasks: readonly TaskRecord[];
    }>(
      admin,
      `query($memberId: String!) { inboxTasks(assigneeMemberId: $memberId) { id nodeId status hasFillableFields } }`,
      { memberId: ADMIN },
    );
    expect(
      inbox.inboxTasks.find((task) => task.id === financeTask.id)
        ?.hasFillableFields,
    ).toBe(true);

    // Once the case reaches the fill node the requester sees its fields,
    // read-only and marked with the node that fills them in.
    await requester.goto(`/instances/${instanceId}`);
    await expect(requester.getByText('申請主旨').first()).toBeVisible();
    await expect(requester.getByText('財務審核補填').first()).toBeVisible();
    await expect(requester.getByText(/本關需要你補填/)).toHaveCount(0);

    await admin.goto(`/instances/${instanceId}`);
    await expect(
      admin.getByText(
        '本關需要你補填 2 個欄位，按「同意」時會一起送出並納入簽章。',
      ),
    ).toBeVisible();
    await expect(admin.getByText('本關補填').first()).toBeVisible();
    await admin.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-pr2-1-${runId}.png`,
    });

    // An incomplete fill keeps the dialog shut and says what is missing.
    await admin.getByRole('button', { exact: true, name: '同意' }).click();
    await expect(admin.getByText(/還有 1 個補填欄位需要完成/)).toBeVisible();
    await expect(admin.getByRole('button', { name: '送出同意' })).toHaveCount(
      0,
    );
    await admin.waitForTimeout(500);
    await admin.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-pr2-2-${runId}.png`,
    });

    await fieldInput(admin, '發票號碼').fill('AB-12345678');
    await admin.getByRole('button', { name: '新增一列' }).click();
    const costRow = formField(admin, '費用明細').getByRole('row').nth(1);

    await costRow.getByRole('textbox').nth(0).fill('機票');
    await costRow.getByRole('textbox').nth(1).fill('1200');

    await admin.getByRole('button', { exact: true, name: '同意' }).click();
    const dialog = admin.getByRole('dialog');

    await expect(dialog.getByText('AB-12345678')).toBeVisible();
    await expect(dialog.getByText(/1 列/)).toBeVisible();
    // Let the dialog finish its entry transition before the screenshot.
    await admin.waitForTimeout(500);
    await admin.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-pr2-3-${runId}.png`,
    });
    await dialog.getByRole('button', { name: '送出同意' }).click();

    await expect
      .poll(
        async () =>
          (await readInstanceFormData(admin, instanceId))['invoiceNo'],
      )
      .toBe('AB-12345678');
    expect(
      (await readInstanceFormData(admin, instanceId))['costItems'],
    ).toEqual([{ cost: 1200, item: '機票' }]);

    await admin.reload();
    await expect(
      admin.getByText(/補填 2 個欄位：(費用明細、發票號碼|發票號碼、費用明細)/),
    ).toBeVisible();

    // The requester now reads the filled values, read-only.
    await requester.reload();
    await expect(requester.getByText('財務審核補填').first()).toBeVisible();
    await expect(fieldInput(requester, '發票號碼')).toHaveValue('AB-12345678');
    await expect(fieldInput(requester, '發票號碼')).not.toBeEditable();
    await requester.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-pr2-4-${runId}.png`,
    });
  });

  test('a form changed meanwhile keeps the draft and offers a reload', async (): Promise<void> => {
    test.setTimeout(120_000);
    const title = `E2E 補填衝突 ${runId}`;
    const instanceId = await submit(requester, templateId, title);

    await decide(admin, instanceId, 'manager');
    await waitForPendingTask(admin, instanceId, 'finance');

    await admin.goto(`/instances/${instanceId}`);
    await fieldInput(admin, '發票號碼').fill('CONFLICT-1');

    await admin.route(GRAPHQL_URL, async (route) => {
      const body = route.request().postData() ?? '';

      if (!body.includes('decideTask')) {
        await route.continue();

        return;
      }

      await route.fulfill({
        body: JSON.stringify({
          data: null,
          errors: [
            {
              extensions: { code: 'CONFLICT' },
              message: `Approval instance ${instanceId} form data changed; refresh and retry`,
            },
          ],
        }),
        contentType: 'application/json',
        status: 200,
      });
    });

    await admin.getByRole('button', { exact: true, name: '同意' }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: '送出同意' })
      .click();

    await expect(
      admin.getByText(
        '表單在你填寫期間被更新了，你填的內容還在。請重新載入後確認再同意。',
      ),
    ).toBeVisible();
    await admin.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-conflict-${runId}.png`,
    });
    await admin.unroute(GRAPHQL_URL);

    await admin.getByRole('button', { name: '重新載入' }).click();
    await expect(
      admin.getByText(
        '表單在你填寫期間被更新了，你填的內容還在。請重新載入後確認再同意。',
      ),
    ).toHaveCount(0);
    await expect(fieldInput(admin, '發票號碼')).toHaveValue('CONFLICT-1');

    // The table was never touched, so approving neither sends nor records it.
    await admin.getByRole('button', { exact: true, name: '同意' }).click();
    const dialog = admin.getByRole('dialog');

    await expect(dialog.getByText('費用明細')).toHaveCount(0);
    await dialog.getByRole('button', { name: '送出同意' }).click();
    await expect
      .poll(
        async () =>
          (await readInstanceFormData(admin, instanceId))['invoiceNo'],
      )
      .toBe('CONFLICT-1');
    expect(await readInstanceFormData(admin, instanceId)).not.toHaveProperty(
      'costItems',
    );
  });

  test('refuses to publish a system node that writes form.<fill field>', async (): Promise<void> => {
    // The engine strips a leading `form.` before writing, so the publish lint
    // has to read the path the same way.
    const writer = {
      ...WORKFLOW,
      edges: [
        edge('start', 'manager'),
        edge('manager', 'stamp'),
        edge('stamp', 'finance'),
        edge('finance', 'director'),
        edge('director', 'end'),
      ],
      nodes: [
        ...WORKFLOW.nodes,
        {
          data: {
            action: {
              fieldPath: 'form.invoiceNo',
              type: 'SET_FORM_FIELD',
              value: '"PRESET"',
            },
            label: '預填發票',
          },
          id: 'stamp',
          position: { x: 390, y: 200 },
          type: 'serviceTask',
        },
      ],
    };

    await expect(
      createPublishedTemplate(admin, formVersionId, `${runId}-writer`, writer),
    ).rejects.toThrow(/cannot write a field an approver fills in: invoiceNo/);
  });

  test('the inbox flags the task and the notification opens the case', async (): Promise<void> => {
    test.setTimeout(120_000);
    const title = `E2E 補填通知 ${runId}`;
    const instanceId = await submit(requester, templateId, title);

    await decide(admin, instanceId, 'manager');
    await waitForPendingTask(admin, instanceId, 'finance');

    await admin.goto('/inbox');
    const row = admin.getByRole('row').filter({ hasText: title });

    await expect(row.getByText('需補填')).toBeVisible();
    await admin.screenshot({
      fullPage: true,
      path: `test-results/approver-fill-inbox-${runId}.png`,
    });

    await admin.getByRole('button', { name: /^通知中心/ }).click();
    const card = admin
      .locator('[role="button"]')
      .filter({ hasText: title })
      .filter({ hasText: '財務審核' })
      .first();

    await expect(card).toBeVisible();
    await card.locator('button').last().click();
    await expect(admin.getByRole('option', { name: '開啟案件' })).toBeVisible();
    await expect(
      admin.getByRole('option', { exact: true, name: '同意' }),
    ).toHaveCount(0);
    await admin.screenshot({
      path: `test-results/approver-fill-notification-${runId}.png`,
    });
    await admin.getByRole('option', { name: '開啟案件' }).click();
    await admin.waitForURL(`**/instances/${instanceId}`);
  });
});

/** The form field whose label reads `label` (labels are not tied to inputs). */
function formField(page: Page, label: string): Locator {
  return page.locator('.mzn-form-field').filter({ hasText: label });
}

function fieldInput(page: Page, label: string): Locator {
  return formField(page, label).getByRole('textbox');
}

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
        description: 'E2E approver fill form',
        name: `E2E 補填表單 ${runId}`,
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
  workflow: Json = WORKFLOW,
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
        description: 'E2E approver fill journey',
        formDefinitionVersionId: formVersionId,
        name: `E2E 補填流程 ${runId}`,
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
): Promise<string> {
  const submitted = await gql<{
    readonly submitApprovalInstance: { readonly id: string };
  }>(
    page,
    `mutation($input: SubmitApprovalInstanceInput!) { submitApprovalInstance(input: $input) { id } }`,
    {
      input: {
        formDataJson: JSON.stringify({ amount: 1200, subject: title }),
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
      `query($id: String!) { tasks(instanceId: $id) { id nodeId status hasFillableFields } }`,
      { id: instanceId },
    )
  ).tasks;
}

async function waitForPendingTask(
  page: Page,
  instanceId: string,
  nodeId: string,
): Promise<TaskRecord> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const task = (await readTasks(page, instanceId)).find(
      (candidate) =>
        candidate.nodeId === nodeId && candidate.status === 'PENDING',
    );

    if (task) {
      return task;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`No pending task at ${nodeId} for ${instanceId}`);
}

async function decide(
  page: Page,
  instanceId: string,
  nodeId: string,
): Promise<void> {
  const task = await waitForPendingTask(page, instanceId, nodeId);

  await gql(
    page,
    `mutation($input: DecideTaskInput!) { decideTask(input: $input) { id } }`,
    {
      input: {
        action: 'APPROVED',
        comment: null,
        decidedByMemberId: ADMIN,
        returnToNodeId: null,
        taskId: task.id,
        transferToMemberId: null,
      },
    },
  );
}

async function readInstanceFormData(
  page: Page,
  instanceId: string,
): Promise<Json> {
  const result = await gql<{
    readonly approvalInstance: { readonly formDataJson: string };
  }>(
    page,
    `query($id: String!) { approvalInstance(id: $id) { formDataJson } }`,
    { id: instanceId },
  );

  return JSON.parse(result.approvalInstance.formDataJson) as Json;
}
