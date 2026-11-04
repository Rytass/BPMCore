import { Browser, expect, Locator, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * `file_upload` fields end to end against the real wrapper host (PR #133):
 * what a field lists has to be what the case really holds. The form and
 * template are created here, so the suite does not depend on `pnpm demo:reset`.
 *
 * start → 主管審核 (may return to the applicant) → end
 *
 * An approver never uploads: ADR 20 keeps `file_upload` out of the fields an
 * approver may fill in, and publishing refuses a node that tries.
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
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
}

interface AttachmentRow {
  readonly filename: string;
  readonly id: string;
}

const FORM_SCHEMA = {
  fields: [
    { fieldKey: 'subject', label: '申請主旨', required: true, type: 'text' },
    {
      fieldKey: 'evidence',
      label: '申請佐證',
      maxFiles: 1,
      required: false,
      type: 'file_upload',
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
  extra: Json = {},
): Json {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess: [],
      label,
      returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
      ...extra,
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
    edge('manager', 'end'),
  ],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'startEvent',
    },
    userTask('manager', '主管審核', 260, {
      returnBehavior: {
        allowReturn: true,
        allowedTargets: 'INITIATOR',
        resubmitStrategy: 'RESTART',
      },
    }),
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 780, y: 0 },
      type: 'endEvent',
    },
  ],
};

/** A 2 KiB file, so a size shown as `0 B` cannot pass for this one. */
function testFile(
  name: string,
  mimeType: string,
): { name: string; mimeType: string; buffer: Buffer } {
  return { buffer: Buffer.alloc(2048, 7), mimeType, name };
}

test.describe.configure({ mode: 'serial' });

test.describe('file_upload fields (real backend)', () => {
  const runId = `${Date.now()}`;
  let admin: Page;
  let requester: Page;
  let templateId = '';
  let instanceId = '';

  test.beforeAll(async ({ browser }): Promise<void> => {
    admin = await createAuthenticatedPage(browser, ADMIN);
    requester = await createAuthenticatedPage(browser, REQUESTER);

    const formVersionId = await createPublishedForm(admin, runId);

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

  test('a failed upload says so, is not attached, and a retry attaches it', async (): Promise<void> => {
    let failNext = true;

    await requester.route(GRAPHQL_URL, async (route) => {
      if (failNext && (route.request().postData() ?? '').includes('UploadAttachment')) {
        failNext = false;
        await route.abort('failed');

        return;
      }

      await route.continue();
    });
    await requester.goto(`/instances/new?templateId=${templateId}`);
    await fileInput(requester, '申請佐證').setInputFiles(
      testFile('失敗再試.pdf', 'application/pdf'),
    );

    await expect(
      formField(requester, '申請佐證').getByText(/失敗再試\.pdf：上傳失敗.*未附加/),
    ).toBeVisible();
    await requester.screenshot({
      fullPage: true,
      path: `test-results/file-upload-1-failed-${runId}.png`,
    });

    // Submitting now would send the form without it.
    await fieldInput(requester, '申請主旨').fill(`E2E 附件失敗 ${runId}`);
    await requester.getByRole('button', { exact: true, name: '送出' }).click();
    await expect(
      requester.getByText('有附件上傳失敗，請重試或移除後再送出。'),
    ).toBeVisible();

    await formField(requester, '申請佐證')
      .locator('[class*="__reset-icon"]')
      .click();
    await expect(
      formField(requester, '申請佐證').getByText(/未附加/),
    ).toHaveCount(0);
    await expect(
      formField(requester, '申請佐證').getByText('失敗再試.pdf'),
    ).toBeVisible();
    await requester.unroute(GRAPHQL_URL);
  });

  test('a new case waits for a running upload, then submits the attachment', async (): Promise<void> => {
    test.setTimeout(90_000);
    let releaseUpload: () => void = (): void => undefined;
    const uploadHeld = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    await requester.route(GRAPHQL_URL, async (route) => {
      if ((route.request().postData() ?? '').includes('UploadAttachment')) {
        await uploadHeld;
      }

      await route.continue();
    });
    await requester.goto(`/instances/new?templateId=${templateId}`);
    await fieldInput(requester, '申請主旨').fill(`E2E 附件 ${runId}`);
    await fileInput(requester, '申請佐證').setInputFiles(
      testFile('現場照片.jpg', 'image/jpeg'),
    );

    await requester.getByRole('button', { exact: true, name: '送出' }).click();
    await expect(
      requester.getByText('附件仍在上傳中，請稍候再送出。'),
    ).toBeVisible();
    await expect(requester).toHaveURL(/\/instances\/new/);

    releaseUpload();
    await expect(
      formField(requester, '申請佐證').getByText('2 KB'),
    ).toBeVisible();
    await requester.screenshot({
      fullPage: true,
      path: `test-results/file-upload-2-uploaded-${runId}.png`,
    });
    await requester.unroute(GRAPHQL_URL);

    await requester.getByRole('button', { exact: true, name: '送出' }).click();
    await requester.waitForURL(/\/instances\/(?!new)[0-9a-f-]+$/);
    instanceId = requester.url().split('/').at(-1) ?? '';

    const attachments = await readAttachments(requester, instanceId);

    expect(attachments.map((attachment) => attachment.filename)).toEqual([
      '現場照片.jpg',
    ]);
    expect((await readFormData(requester, instanceId))['evidence']).toEqual([
      attachments[0]?.id,
    ]);
  });

  test('a returned case lists the old file, lets it go, and the case drops it', async (): Promise<void> => {
    test.setTimeout(90_000);
    await decide(admin, instanceId, 'manager', 'RETURNED');
    await expect
      .poll(async () => (await readInstance(requester, instanceId)).state)
      .toBe('RETURNED');

    await requester.goto(`/instances/${instanceId}`);
    const evidence = formField(requester, '申請佐證');

    await expect(evidence.getByText('現場照片.jpg')).toBeVisible();
    await expect(evidence.getByText('2 KB')).toBeVisible();
    await expect(evidence.getByText('0 B')).toHaveCount(0);
    // A listed file carries no bytes; an image thumbnail of it would be broken.
    await expect(evidence.locator('img')).toHaveCount(0);
    // A single-file field that holds one takes no other.
    await expect(evidence.locator('input[type="file"]')).toBeDisabled();
    await requester.screenshot({
      fullPage: true,
      path: `test-results/file-upload-3-returned-${runId}.png`,
    });

    await evidence.locator('[class*="__delete-icon"]').click();
    await expect(evidence.getByText('現場照片.jpg')).toHaveCount(0);
    await fileInput(requester, '申請佐證').setInputFiles(
      testFile('補正文件.pdf', 'application/pdf'),
    );
    await expect(evidence.getByText('補正文件.pdf')).toBeVisible();
    await expect(evidence.getByText('2 KB')).toBeVisible();

    await requester.getByRole('button', { name: '重新送出' }).click();
    await expect
      .poll(async () => (await readInstance(requester, instanceId)).state)
      .toBe('RUNNING');

    const attachments = await readAttachments(requester, instanceId);

    expect(attachments.map((attachment) => attachment.filename)).toEqual([
      '補正文件.pdf',
    ]);
    expect((await readFormData(requester, instanceId))['evidence']).toEqual([
      attachments[0]?.id,
    ]);
  });

  test('a reader sees the attached file by name, and cannot change it', async (): Promise<void> => {
    // The approver reads the resubmitted case; the field is read-only for them.
    await admin.goto(`/instances/${instanceId}`);
    const evidence = formField(admin, '申請佐證');

    await expect(evidence.getByText('補正文件.pdf')).toBeVisible();
    await expect(evidence.getByText('2 KB')).toBeVisible();
    await expect(evidence.locator('input[type="file"]')).toBeDisabled();
    await expect(evidence.locator('[class*="__delete-icon"]')).toHaveCount(
      0,
    );
    await expect(evidence.getByText('此處無法上傳附件')).toHaveCount(0);
    await admin.screenshot({
      fullPage: true,
      path: `test-results/file-upload-4-readonly-${runId}.png`,
    });
  });
});

/** The form field whose label reads `label` (labels are not tied to inputs). */
function formField(page: Page, label: string): Locator {
  return page.locator('.mzn-form-field').filter({ hasText: label });
}

function fieldInput(page: Page, label: string): Locator {
  return formField(page, label).getByRole('textbox');
}

function fileInput(page: Page, label: string): Locator {
  return formField(page, label).locator('input[type="file"]');
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
        description: 'E2E file upload form',
        name: `E2E 附件表單 ${runId}`,
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
        description: 'E2E file upload journey',
        formDefinitionVersionId: formVersionId,
        name: `E2E 附件流程 ${runId}`,
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

async function waitForPendingTask(
  page: Page,
  instanceId: string,
  nodeId: string,
): Promise<TaskRecord> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const { tasks } = await gql<{ readonly tasks: readonly TaskRecord[] }>(
      page,
      `query($id: String!) { tasks(instanceId: $id) { id nodeId status } }`,
      { id: instanceId },
    );
    const task = tasks.find(
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
  action: 'APPROVED' | 'RETURNED',
): Promise<void> {
  const task = await waitForPendingTask(page, instanceId, nodeId);

  await gql(
    page,
    `mutation($input: DecideTaskInput!) { decideTask(input: $input) { id } }`,
    {
      input: {
        action,
        comment: action === 'RETURNED' ? '請補正佐證文件' : null,
        decidedByMemberId: ADMIN,
        returnToNodeId: null,
        taskId: task.id,
        transferToMemberId: null,
      },
    },
  );
}

async function readInstance(
  page: Page,
  instanceId: string,
): Promise<{ readonly formDataJson: string; readonly state: string }> {
  return (
    await gql<{
      readonly approvalInstance: {
        readonly formDataJson: string;
        readonly state: string;
      };
    }>(
      page,
      `query($id: String!) { approvalInstance(id: $id) { formDataJson state } }`,
      { id: instanceId },
    )
  ).approvalInstance;
}

async function readFormData(page: Page, instanceId: string): Promise<Json> {
  return JSON.parse((await readInstance(page, instanceId)).formDataJson) as Json;
}

async function readAttachments(
  page: Page,
  instanceId: string,
): Promise<readonly AttachmentRow[]> {
  return (
    await gql<{ readonly attachments: readonly AttachmentRow[] }>(
      page,
      `query($instanceId: String!) { attachments(instanceId: $instanceId) { id filename } }`,
      { instanceId },
    )
  ).attachments;
}
