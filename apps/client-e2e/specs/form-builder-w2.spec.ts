import { expect, Page, Route, test } from '@playwright/test';

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
    await page.getByRole('button', { name: '發布版本' }).click();

    await expect(page.getByText(/已發布版本/u)).toBeVisible();

    await page.getByRole('button', { exact: true, name: '版本' }).click();
    await expect(page.getByText('PUBLISHED')).toBeVisible();
  });
});

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
    currentVersionId,
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
