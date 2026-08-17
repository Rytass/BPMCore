import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

interface CategoryRecord {
  readonly createdAt: string;
  readonly description: string | null;
  readonly id: string;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

const UPDATED_AT = '2026-05-12T09:00:00.000Z';
const CREATED_TEMPLATE_ID = 'template-created';
const CREATED_FORM_ID = 'form-created';
const CREATED_VERSION_ID = 'version-created';

test.describe('approval template categories', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('manages categories and uses them when creating templates', async ({
    page,
  }): Promise<void> => {
    await mockTemplateCategoryGraphQl(page);

    await page.goto('/templates/categories');
    await expect(
      page.getByRole('heading', { name: '簽核模板分類' }),
    ).toBeVisible();
    await expect(page.getByText('財務')).toBeVisible();
    await expect(page.getByRole('table').getByText('啟用')).toBeVisible();

    await page.getByRole('button', { name: '建立分類' }).click();
    await page.getByPlaceholder('例如：行政管理').fill('人資');
    await page.getByPlaceholder('補充分類用途').fill('人資流程分類');
    await page.getByRole('button', { exact: true, name: '建立' }).click();
    await expect(page.getByRole('table').getByText('人資')).toBeVisible();

    const financeRow = page.getByRole('row').filter({ hasText: '財務' });
    await financeRow.getByRole('button', { name: '停用' }).click();
    await expect(
      financeRow.getByRole('button', { name: '啟用' }),
    ).toBeVisible();
    await financeRow.getByRole('button', { name: '啟用' }).click();
    await expect(
      financeRow.getByRole('button', { name: '停用' }),
    ).toBeVisible();

    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: '簽核模板' })).toBeVisible();
    await page.getByRole('combobox', { name: '全部分類' }).click();
    await page.locator('[role="option"]').filter({ hasText: '財務' }).click();
    await expect(page.getByText('財務簽核')).toBeVisible();

    await page.getByRole('button', { name: '建立模板' }).click();
    await expect(
      page.getByRole('heading', { name: '建立模板（表單 + 流程）' }),
    ).toBeVisible();
    await page.getByPlaceholder('例如：請款簽核').fill('人資簽核流程');
    await page.getByRole('combobox', { name: '未分類' }).click();
    await page.locator('[role="option"]').filter({ hasText: '人資' }).click();
    await page.getByRole('button', { name: /^文字$/u }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByRole('heading', { name: '流程工具' })).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(
      page.getByRole('heading', { name: '人資簽核流程' }),
    ).toBeVisible();

    const composeRequest = page.waitForRequest((request): boolean => {
      const payload = request.postDataJSON() as unknown;

      return (
        isRecord(payload) &&
        typeof payload.query === 'string' &&
        payload.query.includes('mutation ComposeApprovalTemplateWithForm')
      );
    });
    await Promise.all([
      page.waitForURL(`**/templates/${CREATED_TEMPLATE_ID}/designer`),
      page.getByRole('button', { exact: true, name: '發佈' }).click(),
    ]);

    const requestPayload = (await composeRequest).postDataJSON() as unknown;
    const input = isRecord(requestPayload)
      ? readRecord(readRecord(requestPayload.variables).input)
      : {};
    expect(input.categoryId).toBe('category-hr');
    expect(input.templateName).toBe('人資簽核流程');
  });
});

async function mockTemplateCategoryGraphQl(page: Page): Promise<void> {
  let categories: readonly CategoryRecord[] = [
    readCategory({
      id: 'category-finance',
      isActive: true,
      name: '財務',
      sortOrder: 10,
    }),
  ];

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query ApprovalTemplateCategoriesPage')) {
      const status = readOptionalString(payload.variables?.status);
      const activeFilteredCategories = categories.filter((category) => {
        if (status === 'ACTIVE') {
          return category.isActive;
        }

        if (status === 'INACTIVE') {
          return !category.isActive;
        }

        return true;
      });

      await fulfillGraphQl(route, {
        approvalTemplateCategories: activeFilteredCategories,
        approvalTemplateCategoryCount: activeFilteredCategories.length,
      });
      return;
    }

    if (query.includes('mutation CreateApprovalTemplateCategory')) {
      const input = readRecord(payload.variables?.input);
      const category = readCategory({
        id: 'category-hr',
        isActive: true,
        name: readRequiredString(input.name),
        sortOrder: readOptionalNumber(input.sortOrder) ?? 0,
      });

      categories = [...categories, category];
      await fulfillGraphQl(route, {
        createApprovalTemplateCategory: category,
      });
      return;
    }

    if (query.includes('mutation UpdateApprovalTemplateCategory')) {
      const input = readRecord(payload.variables?.input);
      const id = readRequiredString(input.id);
      const updatedCategory = readCategory({
        id,
        isActive: readOptionalBoolean(input.isActive) ?? true,
        name: readRequiredString(input.name),
        sortOrder: readOptionalNumber(input.sortOrder) ?? 0,
      });

      categories = categories.map((category) =>
        category.id === id ? updatedCategory : category,
      );
      await fulfillGraphQl(route, {
        updateApprovalTemplateCategory: updatedCategory,
      });
      return;
    }

    if (query.includes('query ApprovalTemplatesPage')) {
      await fulfillGraphQl(route, {
        approvalTemplateCount: 1,
        approvalTemplates: [
          {
            category: '財務',
            categoryDetail: categories[0],
            categoryId: 'category-finance',
            currentVersionId: null,
            description: null,
            id: 'template-finance',
            isActive: true,
            name: '財務簽核',
            updatedAt: UPDATED_AT,
          },
        ],
      });
      return;
    }

    if (query.includes('query ApprovalTemplates')) {
      await fulfillGraphQl(route, {
        approvalTemplateCount: 1,
        approvalTemplates: [],
      });
      return;
    }

    if (query.includes('query LaunchableTemplates')) {
      await fulfillGraphQl(route, {
        launchableApprovalTemplates: [],
      });
      return;
    }

    if (query.includes('mutation CreateApprovalTemplate')) {
      await fulfillGraphQl(route, {
        createApprovalTemplate: { id: CREATED_TEMPLATE_ID },
      });
      return;
    }

    if (query.includes('query AdminOrganizationDashboard')) {
      await fulfillGraphQl(route, {
        memberships: [],
        organizationSummary: {
          managerResolutionCount: 0,
          membershipCount: 0,
          orgUnitCount: 0,
          positionCount: 0,
        },
        orgUnits: [],
        positions: [],
      });
      return;
    }

    if (query.includes('mutation ComposeApprovalTemplateWithForm')) {
      await fulfillGraphQl(route, {
        composeApprovalTemplateWithForm: {
          formDefinition: {
            currentVersionId: CREATED_VERSION_ID,
            id: CREATED_FORM_ID,
          },
          formDefinitionVersion: {
            id: CREATED_VERSION_ID,
            status: 'PUBLISHED',
            version: 1,
          },
          published: true,
          template: {
            currentVersionId: CREATED_VERSION_ID,
            id: CREATED_TEMPLATE_ID,
          },
          templateVersion: {
            archivedAt: null,
            formDefinitionVersionId: CREATED_VERSION_ID,
            id: CREATED_VERSION_ID,
            initiatorPolicyCel: null,
            notificationConfigJson: null,
            publishedAt: UPDATED_AT,
            slaDefaultsJson: null,
            status: 'PUBLISHED',
            updatedAt: UPDATED_AT,
            version: 1,
            workflowDefinitionJson: '{}',
          },
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readCategory({
  id,
  isActive,
  name,
  sortOrder,
}: {
  readonly id: string;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
}): CategoryRecord {
  return {
    createdAt: UPDATED_AT,
    description: null,
    id,
    isActive,
    name,
    sortOrder,
    updatedAt: UPDATED_AT,
  };
}

function readGraphQlPayload(route: Route): GraphQlPayload {
  const payload = route.request().postDataJSON() as unknown;

  if (!isRecord(payload) || typeof payload.query !== 'string') {
    return { query: '' };
  }

  return {
    query: payload.query,
    variables: isRecord(payload.variables) ? payload.variables : undefined,
  };
}

async function fulfillGraphQl(
  route: Route,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  await route.fulfill({
    contentType: 'application/json',
    json: { data },
  });
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readRequiredString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Expected string value');
  }

  return value;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
