import { Browser, expect, Page, Request, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * Phase 23 P5 gate (docs/23): a DataSource parameter bound by an `EXPRESSION`
 * on the new-case page.
 *
 * `chargedCostCenter` reads `demo.cost-centers` with
 * `plant = form.chargeTo == "OTHER" ? (form.plant == "TW01" ? "TW02" : "TW01") : form.plant`.
 * Changing `chargeTo` must re-query the options, re-resolve the value already
 * picked (P5 D5: it used to stay "選項驗證中" for good) and say it has
 * expired with the host's sentence; a new pick then submits. The read-only
 * case page right after must not ask for re-validation (P5 D6).
 *
 * Needs `pnpm dev` (api + client) outside production; the form and template
 * are created here, so the suite does not depend on `pnpm demo:reset`.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL ?? `${API_URL}/graphql`;
const ADMIN = 'member-001';
const REQUESTER = 'member-102';
const NAME_PREFIX = '[e2e-expr-datasource]';
const EXPIRED_MESSAGE = '已選取的選項已失效，請重新選擇。';

type Json = Readonly<Record<string, unknown>>;

interface GraphQlResult<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
}

const FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'plant',
      label: '申請廠別',
      options: [
        { label: '台中廠 TW01', value: 'TW01' },
        { label: '台北廠 TW02', value: 'TW02' },
      ],
      required: true,
      type: 'select',
    },
    {
      fieldKey: 'chargeTo',
      label: '費用負擔',
      options: [
        { label: '本廠負擔', value: 'SELF' },
        { label: '由另一廠負擔', value: 'OTHER' },
      ],
      required: true,
      type: 'select',
    },
    {
      dataSource: {
        bindings: [
          {
            from: {
              expression:
                'form.chargeTo == "OTHER" ? (form.plant == "TW01" ? "TW02" : "TW01") : form.plant',
              kind: 'EXPRESSION',
            },
            parameter: 'plant',
          },
        ],
        key: 'demo.cost-centers',
        version: 1,
      },
      fieldKey: 'chargedCostCenter',
      label: '負擔成本中心',
      required: true,
      type: 'select',
    },
  ],
  schemaVersion: 1,
};

const FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'plant', width: 'HALF' },
    { fieldKey: 'chargeTo', width: 'HALF' },
    { fieldKey: 'chargedCostCenter', width: 'FULL' },
  ],
  schemaVersion: 1,
};

const WORKFLOW: Json = {
  edges: [
    { data: {}, id: 'edge_start_review', source: 'start', target: 'review', type: 'smoothstep' },
    { data: {}, id: 'edge_review_end', source: 'review', target: 'end', type: 'smoothstep' },
  ],
  expressionDialect: 'cel-v2',
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
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 520, y: 0 },
      type: 'endEvent',
    },
  ],
};

test.describe.configure({ mode: 'serial' });

test.describe('EXPRESSION DataSource binding on the new-case page (real backend)', () => {
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

  test('re-queries on a dependency change, flags the expired value and submits a new pick', async (): Promise<void> => {
    test.setTimeout(90_000);

    const optionQueries: Json[] = [];
    const resolveQueries: Json[] = [];

    requester.on('request', (request: Request): void => {
      const body = readGraphQlBody(request);

      if (!body) {
        return;
      }

      if (body.query.includes('query FormFieldOptions(')) {
        optionQueries.push(body.variables);
      }

      if (body.query.includes('query ResolveFormFieldOptions(')) {
        resolveQueries.push(body.variables);
      }
    });

    await requester.goto(`/instances/new?templateId=${templateId}`);
    await expect(requester.getByRole('heading', { name: '發起簽核' })).toBeVisible();

    await chooseOption(requester, 'plant', '台中廠 TW01');
    await chooseOption(requester, 'chargeTo', '本廠負擔');
    await chooseOption(requester, 'chargedCostCenter', 'TW01 成本中心 001');

    const queriesBeforeChange = optionQueries.length;

    await chooseOption(requester, 'chargeTo', '由另一廠負擔');

    // The expression now yields TW02: the options are re-queried with the new
    // form, and the held TW01 value is re-resolved and reported expired.
    await expect
      .poll(() =>
        optionQueries
          .slice(queriesBeforeChange)
          .some((variables) => JSON.stringify(variables).includes('OTHER')),
      )
      .toBe(true);
    await expect.poll(() => resolveQueries.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolveQueries.at(-1))).toContain('CC-TW01-001');
    await expect(
      fieldContainer(requester, 'chargedCostCenter').getByText(EXPIRED_MESSAGE),
    ).toBeVisible();

    // Submitting the expired value is refused with the "fix it" copy, never
    // the "wait" copy that used to stay forever.
    await requester.getByRole('button', { name: '送出', exact: true }).click();
    // Once under the field and once as the submit banner.
    await expect(requester.getByText(EXPIRED_MESSAGE)).toHaveCount(2);
    await expect(requester.getByText('選項驗證中，請稍候再送出。')).toHaveCount(0);

    await chooseOption(requester, 'chargedCostCenter', 'TW02 成本中心 001');
    await expect(
      fieldContainer(requester, 'chargedCostCenter').getByText(EXPIRED_MESSAGE),
    ).toHaveCount(0);

    const submitButton = requester.getByRole('button', { name: '送出', exact: true });

    await expect(submitButton).toBeEnabled();
    await Promise.all([
      requester.waitForURL(/\/instances\/[0-9a-f-]+$/u),
      submitButton.click(),
    ]);

    instanceId = requester.url().split('/').at(-1) ?? '';

    const instance = await gql<{
      readonly approvalInstance: {
        readonly formDataJson: string;
        readonly formDataOptionSnapshotJson: string;
      };
    }>(
      admin,
      `query($id: String!) { approvalInstance(id: $id) { formDataJson formDataOptionSnapshotJson } }`,
      { id: instanceId },
    );

    expect(JSON.parse(instance.approvalInstance.formDataJson)).toMatchObject({
      chargeTo: 'OTHER',
      chargedCostCenter: 'CC-TW02-001',
      plant: 'TW01',
    });
    expect(instance.approvalInstance.formDataOptionSnapshotJson).toContain(
      'CC-TW02-001',
    );
  });

  test('shows the just-submitted case without asking for re-validation', async (): Promise<void> => {
    expect(instanceId).not.toBe('');

    await requester.goto(`/instances/${instanceId}`);

    // A read-only Select may carry its label in the input's value rather than
    // as text, so either counts.
    await expect
      .poll(async (): Promise<boolean> =>
        fieldContainer(requester, 'chargedCostCenter').evaluate(
          (element, label): boolean =>
            (element.textContent ?? '').includes(label) ||
            Array.from(element.querySelectorAll('input')).some(
              (input) => input.value === label,
            ),
          'TW02 成本中心 001',
        ),
      )
      .toBe(true);
    await expect(requester.getByText('選項需要重新載入或驗證。')).toHaveCount(0);
  });
});

function readGraphQlBody(
  request: Request,
): { readonly query: string; readonly variables: Json } | null {
  if (request.method() !== 'POST' || !request.url().includes('/graphql')) {
    return null;
  }

  try {
    const body = request.postDataJSON() as {
      readonly query?: unknown;
      readonly variables?: unknown;
    } | null;

    return typeof body?.query === 'string'
      ? { query: body.query, variables: (body.variables ?? {}) as Json }
      : null;
  } catch {
    return null;
  }
}

function fieldContainer(page: Page, fieldKey: string): ReturnType<Page['locator']> {
  return page.locator(`[data-form-field-key="${fieldKey}"]`);
}

async function chooseOption(
  page: Page,
  fieldKey: string,
  optionLabel: string,
): Promise<void> {
  const trigger = page.locator(
    `[data-form-field-key="${fieldKey}"] .mzn-select-trigger`,
  );

  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    const chevron = trigger.locator('.mzn-select-trigger__suffix-action-icon');

    if ((await chevron.count()) > 0) {
      await chevron.first().click();
    } else {
      await trigger.click();
    }
  }

  await page.getByRole('option', { exact: true, name: optionLabel }).click();
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
        description: 'E2E EXPRESSION DataSource binding form',
        name: `${NAME_PREFIX} 跨廠成本中心表單 ${runId}`,
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
  // Publishing lints the EXPRESSION binding with the cel-v2 engine.
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
        description: 'E2E EXPRESSION DataSource binding journey',
        formDefinitionVersionId: formVersionId,
        name: `${NAME_PREFIX} 跨廠成本中心申請 ${runId}`,
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
