import { expect, Page, Request, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface FormDefinitionRecord {
  readonly currentVersionId: string | null;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

interface FormDefinitionVersionRecord {
  readonly id: string;
  readonly publishedAt: string | null;
  readonly schemaJson: string;
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly uiSchemaJson: string;
  readonly updatedAt: string;
  readonly version: number;
}

type FormDefinitionListStatus = 'DRAFT' | 'PUBLISHED';

interface UpdateDraftInput {
  readonly schemaJson: string;
  readonly uiSchemaJson: string;
  readonly versionId: string;
}

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const FORM_ID = 'e2e-form';
const VERSION_ID = 'e2e-version';
const UPDATED_AT = '2026-05-04T08:00:00.000Z';

test.describe('M1 W2 form builder', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('loads form definitions with server-side pagination', async ({
    page,
  }): Promise<void> => {
    await mockFormListGraphQl(page);

    const firstPageRequest = page.waitForRequest((request): boolean =>
      isFormDefinitionsPageRequest(request, 1, null),
    );
    await page.goto('/forms');
    await firstPageRequest;

    await expect(page.getByRole('button', { name: '全部' })).toBeVisible();
    await expect(page.getByRole('button', { name: '已發布' })).toBeVisible();
    await expect(page.getByRole('button', { name: '草稿' })).toBeVisible();
    await expect(
      page.getByRole('table').getByText('E2E 表單 1', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('顯示 1-10 筆，共 12 筆')).toBeVisible();

    const secondPageRequest = page.waitForRequest((request): boolean =>
      isFormDefinitionsPageRequest(request, 2, null),
    );
    await page.getByRole('button', { name: 'Go to 2 page' }).click();
    await secondPageRequest;

    await expect(
      page.getByRole('table').getByText('E2E 表單 11', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('顯示 11-12 筆，共 12 筆')).toBeVisible();

    const publishedRequest = page.waitForRequest((request): boolean =>
      isFormDefinitionsPageRequest(request, 1, 'PUBLISHED'),
    );
    await page.getByRole('button', { name: '已發布' }).click();
    await publishedRequest;

    await expect(
      page.getByRole('table').getByText('E2E 表單 1', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('table').getByText('E2E 表單 2', { exact: true }),
    ).toBeHidden();
    await expect(page.getByText('顯示 1-6 筆，共 6 筆')).toBeVisible();
  });

  test('builds, previews, saves, and publishes a form version', async ({
    page,
  }): Promise<void> => {
    await mockFormBuilderGraphQl(page);

    await page.goto(`/forms/${FORM_ID}/builder`);

    await expect(page.getByText('E2E 表單')).toBeVisible();
    await page.getByRole('button', { name: /^文字$/u }).click();
    await expect(page.getByText('文字 1')).toBeVisible();

    await page.getByRole('button', { name: '預覽' }).click();
    const textInput = page.getByPlaceholder('請輸入文字');
    await expect(textInput).toBeVisible();
    await textInput.fill('W2 e2e 渲染填寫');
    await expect(textInput).toHaveValue('W2 e2e 渲染填寫');

    await page.getByRole('button', { name: '設計' }).click();
    await page.getByLabel('儲存草稿').click();
    await page.getByRole('button', { name: /發布/u }).click();

    await expect(page.getByText(/當前內容已發布/u)).toBeVisible();

    await page.getByRole('button', { exact: true, name: '版本' }).click();
    await expect(page.getByRole('table').getByText('已發布')).toBeVisible();
  });

  test('saves current edits before publishing a form version', async ({
    page,
  }): Promise<void> => {
    await mockFormBuilderGraphQl(page);

    await page.goto(`/forms/${FORM_ID}/builder`);

    await page.getByRole('button', { name: /^文字$/u }).click();
    await expect(page.getByText('文字 1')).toBeVisible();

    await page.getByRole('button', { name: /發布/u }).click();

    await expect(page.getByText(/當前內容已發布/u)).toBeVisible();
    await expect(page.getByText('文字 1')).toBeVisible();
  });
});

async function mockFormListGraphQl(page: Page): Promise<void> {
  const forms = Array.from({ length: 12 }, (_, index) => ({
    currentVersionCreatedAt: index % 2 === 0 ? UPDATED_AT : null,
    currentVersionId: index % 2 === 0 ? VERSION_ID : null,
    currentVersionNumber: index % 2 === 0 ? 1 : null,
    currentVersionPublishedAt: index % 2 === 0 ? UPDATED_AT : null,
    description: null,
    id: `e2e-form-${index + 1}`,
    name: `E2E 表單 ${index + 1}`,
    updatedAt: UPDATED_AT,
  }));

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);

    if (payload.query.includes('query FormDefinitionsPage')) {
      const pageNumber = readNumberVariable(payload.variables?.page, 1);
      const pageSize = readNumberVariable(payload.variables?.pageSize, 10);
      const status = readFormDefinitionListStatus(payload.variables?.status);
      const filteredForms = forms.filter((form) => {
        if (status === 'PUBLISHED') {
          return Boolean(form.currentVersionId);
        }

        if (status === 'DRAFT') {
          return !form.currentVersionId;
        }

        return true;
      });
      const offset = (pageNumber - 1) * pageSize;

      await fulfillGraphQl(route, {
        formDefinitionCount: filteredForms.length,
        formDefinitions: filteredForms.slice(offset, offset + pageSize),
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function isFormDefinitionsPageRequest(
  request: Request,
  pageNumber: number,
  status: FormDefinitionListStatus | null,
): boolean {
  const payload = request.postDataJSON() as unknown;

  return (
    isRecord(payload) &&
    typeof payload.query === 'string' &&
    payload.query.includes('query FormDefinitionsPage') &&
    isRecord(payload.variables) &&
    payload.variables.page === pageNumber &&
    payload.variables.status === status
  );
}

async function mockFormBuilderGraphQl(page: Page): Promise<void> {
  let currentVersionId: string | null = null;
  let publishedAt: string | null = null;
  let status: FormDefinitionVersionRecord['status'] = 'DRAFT';
  let schemaJson = JSON.stringify({
    fields: [],
    schemaVersion: 1,
  });
  let uiSchemaJson = JSON.stringify({
    layout: [],
    schemaVersion: 1,
  });

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query FormBuilder')) {
      await fulfillGraphQl(route, {
        formDefinition: readDefinition(currentVersionId),
        formDefinitionVersions: [
          readVersion({
            publishedAt,
            schemaJson,
            status,
            uiSchemaJson,
          }),
        ],
      });
      return;
    }

    if (query.includes('mutation UpdateFormDefinitionDraft')) {
      const input = readUpdateDraftInput(payload.variables?.input);
      schemaJson = input.schemaJson;
      uiSchemaJson = input.uiSchemaJson;
      await fulfillGraphQl(route, {
        updateFormDefinitionDraft: readVersion({
          publishedAt,
          schemaJson,
          status,
          uiSchemaJson,
        }),
      });
      return;
    }

    if (query.includes('mutation PublishFormDefinitionVersion')) {
      status = 'PUBLISHED';
      publishedAt = UPDATED_AT;
      currentVersionId = VERSION_ID;
      await fulfillGraphQl(route, {
        publishFormDefinitionVersion: readVersion({
          publishedAt,
          schemaJson,
          status,
          uiSchemaJson,
        }),
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readDefinition(currentVersionId: string | null): FormDefinitionRecord {
  return {
    currentVersionCreatedAt: currentVersionId ? UPDATED_AT : null,
    currentVersionId,
    currentVersionNumber: currentVersionId ? 1 : null,
    currentVersionPublishedAt: currentVersionId ? UPDATED_AT : null,
    description: null,
    id: FORM_ID,
    name: 'E2E 表單',
    updatedAt: UPDATED_AT,
  };
}

function readVersion({
  publishedAt,
  schemaJson,
  status,
  uiSchemaJson,
}: Pick<
  FormDefinitionVersionRecord,
  'publishedAt' | 'schemaJson' | 'status' | 'uiSchemaJson'
>): FormDefinitionVersionRecord {
  return {
    id: VERSION_ID,
    publishedAt,
    schemaJson,
    status,
    uiSchemaJson,
    updatedAt: UPDATED_AT,
    version: 1,
  };
}

function readGraphQlPayload(route: Route): GraphQlPayload {
  const payload = route.request().postDataJSON() as unknown;

  if (!isRecord(payload) || typeof payload.query !== 'string') {
    throw new Error('GraphQL request payload is invalid');
  }

  return {
    query: payload.query,
    variables: isRecord(payload.variables) ? payload.variables : undefined,
  };
}

function readNumberVariable(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function readFormDefinitionListStatus(
  value: unknown,
): FormDefinitionListStatus | null {
  if (value === 'DRAFT' || value === 'PUBLISHED') {
    return value;
  }

  return null;
}

function readUpdateDraftInput(value: unknown): UpdateDraftInput {
  if (
    !isRecord(value) ||
    typeof value.schemaJson !== 'string' ||
    typeof value.uiSchemaJson !== 'string' ||
    typeof value.versionId !== 'string'
  ) {
    throw new Error('UpdateFormDefinitionDraft input is invalid');
  }

  return {
    schemaJson: value.schemaJson,
    uiSchemaJson: value.uiSchemaJson,
    versionId: value.versionId,
  };
}

async function fulfillGraphQl(
  route: Route,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  await route.fulfill({
    contentType: 'application/json',
    json: { data },
    status: 200,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
