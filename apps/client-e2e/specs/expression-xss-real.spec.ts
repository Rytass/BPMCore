import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * Phase 23 P4 (docs/24 §0, p4-designer.md §10): a value an expression copies
 * from one form field into another is shown as text, never as markup. The
 * requester types an HTML payload into `note`; a cel-v2 SET_FORM_FIELD node
 * writes `form.note` into `copy`; the case page must show the payload
 * verbatim, create no element from it, and run none of its script.
 *
 * The notification drawer is checked too (docs/23 P4 Gate), with one limit:
 * a notification's payload carries no form data (`notification.service.ts`
 * builds it from the case title, node label and NOTIFY template only), so an
 * expression-written value cannot reach a notification today. What does reach
 * the drawer is the case title, through the reviewer's TASK_ASSIGNED body
 * ("案件 {title} 的 審核 已指派給你。"). The title carries a second payload
 * and the drawer must show it as text as well.
 *
 * Needs `pnpm dev` (api + client) outside production. The form and template
 * are created here, so the suite does not depend on `pnpm demo:reset`.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';
const MARKER = '__bpmExpressionXss';
const PAYLOAD = `<img src=x onerror="window.${MARKER}=1">`;
const TITLE_MARKER = '__bpmNotificationXss';
// A different string from PAYLOAD, so the case page cannot pass on the title.
const TITLE_PAYLOAD = `<img src=y onerror="window.${TITLE_MARKER}=1">`;

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

const FORM_SCHEMA = {
  fields: [
    { fieldKey: 'note', label: '備註', required: true, type: 'text' },
    { fieldKey: 'copy', label: '備註副本', required: false, type: 'text' },
  ],
  schemaVersion: 1,
};

const FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'note', width: 'FULL' },
    { fieldKey: 'copy', width: 'FULL' },
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

/** start → copy note into copy (cel-v2) → review → end. */
const WORKFLOW: Json = {
  edges: [edge('start', 'copy_note'), edge('copy_note', 'review'), edge('review', 'end')],
  expressionDialect: 'cel-v2',
  meta: { schemaVersion: 1 },
  nodes: [
    { data: { label: '開始' }, id: 'start', position: { x: 0, y: 0 }, type: 'startEvent' },
    {
      data: {
        action: { fieldPath: 'copy', type: 'SET_FORM_FIELD', value: 'form.note' },
        label: '複製備註',
      },
      id: 'copy_note',
      position: { x: 260, y: 0 },
      type: 'serviceTask',
    },
    {
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: false,
        approverResolver: { memberIds: [ADMIN], type: 'DIRECT' },
        decisionPolicy: { type: 'SINGLE' },
        label: '審核',
      },
      id: 'review',
      position: { x: 520, y: 0 },
      type: 'userTask',
    },
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 780, y: 0 },
      type: 'endEvent',
    },
  ],
};

test.describe.configure({ mode: 'serial' });

test.describe('expression output is text (real backend)', () => {
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
    instanceId = await submit(
      requester,
      templateId,
      `E2E 運算式 XSS ${runId} ${TITLE_PAYLOAD}`,
    );
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

  test('copies the payload verbatim through the expression', async (): Promise<void> => {
    const formData = await waitFor(
      async (): Promise<Json> => {
        const data = await gql<{
          readonly approvalInstance: { readonly formDataJson: string };
        }>(
          admin,
          `query($id: String!) { approvalInstance(id: $id) { formDataJson } }`,
          { id: instanceId },
        );

        return JSON.parse(data.approvalInstance.formDataJson) as Json;
      },
      (value) => value['copy'] !== undefined,
      20_000,
    );

    expect(formData['copy']).toBe(PAYLOAD);
  });

  test('shows the copied payload as text on the case page and runs nothing', async (): Promise<void> => {
    const dialogs: string[] = [];

    admin.on('dialog', (dialog): void => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    const response = await admin.goto(`/instances/${instanceId}`);

    // The client host sends the report-only CSP and nosniff (P4 §9).
    expect(response?.headers()['content-security-policy-report-only']).toContain(
      "worker-src 'self' blob:",
    );
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');

    await expect
      .poll(async (): Promise<boolean> =>
        admin.evaluate(
          (payload): boolean =>
            document.body.innerText.includes(payload) ||
            Array.from(
              document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
                'input, textarea',
              ),
            ).some((element) => element.value === payload),
          PAYLOAD,
        ),
      )
      .toBe(true);

    expect(await admin.locator('img[src="x"]').count()).toBe(0);
    expect(await admin.locator('img[src="y"]').count()).toBe(0);
    expect(
      await admin.evaluate(
        (marker): unknown => (window as unknown as Record<string, unknown>)[marker],
        MARKER,
      ),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test('shows the case-title payload as text in the notification drawer and runs nothing', async (): Promise<void> => {
    const dialogs: string[] = [];

    admin.on('dialog', (dialog): void => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await admin.goto('/dashboard');
    await admin.getByRole('button', { name: /^通知中心/ }).click();

    // The reviewer's TASK_ASSIGNED card quotes the case title in its body.
    const card = admin
      .locator('.mzn-notification-center')
      .filter({ hasText: runId });

    await expect(card.first()).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> =>
        card
          .first()
          .evaluate(
            (element, payload): boolean =>
              (element.textContent ?? '').includes(payload),
            TITLE_PAYLOAD,
          ),
      )
      .toBe(true);

    expect(await admin.locator('img[src="y"]').count()).toBe(0);
    expect(await admin.locator('img[src="x"]').count()).toBe(0);
    expect(
      await admin.evaluate(
        (markers): readonly string[] =>
          markers.map(
            (marker) =>
              typeof (window as unknown as Record<string, unknown>)[marker],
          ),
        [MARKER, TITLE_MARKER],
      ),
    ).toEqual(['undefined', 'undefined']);
    expect(dialogs).toEqual([]);
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
        description: 'E2E expression XSS form',
        name: `E2E 運算式 XSS 表單 ${runId}`,
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
        description: 'E2E expression XSS journey',
        formDefinitionVersionId: formVersionId,
        name: `E2E 運算式 XSS 流程 ${runId}`,
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
  // Publishing lints the expression with the cel-v2 engine.
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
        formDataJson: JSON.stringify({ note: PAYLOAD }),
        initiatorMemberId: REQUESTER,
        initiatorMetadataSnapshotJson: null,
        templateId,
        title,
      },
    },
  );

  return submitted.submitApprovalInstance.id;
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
