import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * The designer's field access overview against the real wrapper host
 * (ADR 20 §3.3, docs/21 P3). The form and template are created here, so the
 * suite does not depend on `pnpm demo:reset`.
 *
 * start → 主管審核 → 財務審核 → 總經理核定 → end
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

interface TemplateVersionRecord {
  readonly status: string;
  readonly version: number;
  readonly workflowDefinitionJson: string;
}

const FORM_SCHEMA = {
  fields: [
    { fieldKey: 'subject', label: '申請主旨', required: true, type: 'text' },
    { fieldKey: 'amount', label: '申請金額', required: true, type: 'number' },
    { fieldKey: 'invoiceNo', label: '發票號碼', required: false, type: 'text' },
    {
      fieldKey: 'internalNote',
      label: '內部備註',
      required: false,
      type: 'text',
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

function userTask(id: string, label: string, x: number): Json {
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
    userTask('finance', '財務審核', 520),
    userTask('director', '總經理核定', 780),
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 1040, y: 0 },
      type: 'endEvent',
    },
  ],
};

test.describe('field access overview in the designer (real backend)', () => {
  test('sets the finance node through the overview, publishes it, and blocks two chained fill nodes', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(150_000);

    const runId = `${Date.now()}`;
    const admin = await createAuthenticatedPage(browser, ADMIN);
    let templateId = '';

    try {
      const formVersionId = await createPublishedForm(admin, runId);

      templateId = await createPublishedTemplate(admin, formVersionId, runId);

      await admin.goto(`/templates/${templateId}/designer`);

      const financeCard = admin
        .locator('.react-flow__node')
        .filter({ hasText: '財務審核' });

      await expect(financeCard).toBeVisible();
      await expect(financeCard).not.toContainText('補填');

      // Nothing is set yet, so the overview opens on every field rather
      // than collapsing them all away.
      await admin.getByRole('button', { name: '欄位總覽' }).click();
      await expect(admin.getByText('欄位與關卡總覽')).toBeVisible();
      await expect(
        admin.getByRole('checkbox', { name: '只看有設定或有問題的欄位' }),
      ).not.toBeChecked();
      await expect(admin.getByText(/已收起/u)).toHaveCount(0);

      await chooseCell(admin, '發票號碼 在關卡 2的設定', '補填（必填）');
      await chooseCell(admin, '內部備註 在關卡 3的設定', '隱藏');
      await expect(admin.getByLabel('發票號碼 在關卡 3的設定')).toHaveValue(
        '預設：唯讀',
      );
      await expect(admin.getByLabel('發票號碼 在關卡 1的設定')).toHaveValue(
        '預設：不顯示',
      );

      // Nothing reaches the canvas before 套用.
      await expect(financeCard).not.toContainText('補填');
      await admin.getByRole('button', { name: '套用' }).click();
      await expect(financeCard).toContainText('補填 1');
      await expect(
        admin.locator('.react-flow__node').filter({ hasText: '總經理核定' }),
      ).toContainText('隱藏 1');

      const publish = admin.getByRole('button', {
        name: /保存並發布|發布草稿/,
      });

      await expect(publish).toBeEnabled();
      await publish.click();

      const published = await waitForPublishedVersion(admin, templateId, 2);
      const nodes = (
        JSON.parse(published.workflowDefinitionJson) as {
          readonly nodes: readonly {
            readonly data: { readonly fieldAccess?: readonly Json[] };
            readonly id: string;
          }[];
        }
      ).nodes;

      expect(
        nodes.find((node) => node.id === 'finance')?.data.fieldAccess,
      ).toEqual([{ display: 'SHOW', fieldKey: 'invoiceNo', fill: 'REQUIRED' }]);
      expect(
        nodes.find((node) => node.id === 'director')?.data.fieldAccess,
      ).toEqual([{ display: 'HIDE', fieldKey: 'internalNote', fill: 'NONE' }]);
      expect(
        nodes.find((node) => node.id === 'manager')?.data.fieldAccess,
      ).toBeUndefined();

      // Two chained nodes filling one field: flagged in the overview before
      // applying, and publishing stays blocked while saving does not.
      await admin.getByRole('button', { name: '欄位總覽' }).click();
      await chooseCell(admin, '發票號碼 在關卡 1的設定', '補填（選填）');
      await expect(
        admin.getByText(
          /欄位「invoiceNo」在「主管審核」與「財務審核」都設為補填/,
        ),
      ).toBeVisible();
      await expect(admin.getByText('1 個欄位設定問題')).toBeVisible();
      await admin.getByRole('button', { name: '套用' }).click();

      await expect(admin.getByText(/發布前需修正：.*都設為補填/)).toBeVisible();
      await expect(publish).toBeDisabled();
      await expect(
        admin.getByRole('button', { name: '儲存草稿' }),
      ).toBeEnabled();
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

async function chooseCell(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByLabel(label).click();
  // Options can open below the fold of the drawer, so they are selected
  // directly.
  await page.getByRole('option', { name: option }).dispatchEvent('click');
  await expect(page.getByLabel(label)).toHaveValue(option);
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
        description: 'E2E field access overview form',
        name: `E2E 欄位總覽表單 ${runId}`,
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
        description: 'E2E field access overview',
        formDefinitionVersionId: formVersionId,
        name: `E2E 欄位總覽流程 ${runId}`,
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

async function waitForPublishedVersion(
  page: Page,
  templateId: string,
  version: number,
): Promise<TemplateVersionRecord> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const result = await gql<{
      readonly approvalTemplateVersions: readonly TemplateVersionRecord[];
    }>(
      page,
      `query($id: String!) { approvalTemplateVersions(templateId: $id) { status version workflowDefinitionJson } }`,
      { id: templateId },
    );
    const published = result.approvalTemplateVersions.find(
      (candidate) =>
        candidate.status === 'PUBLISHED' && candidate.version === version,
    );

    if (published) {
      return published;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Version ${version} of ${templateId} was never published`);
}
