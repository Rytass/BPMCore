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

    await page.getByRole('button', { name: '停用' }).first().click();
    await expect(page.getByText('停用')).toBeVisible();

    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: '簽核模板' })).toBeVisible();
    await page.getByRole('combobox', { name: '全部分類' }).click();
    await page.locator('[role="option"]').filter({ hasText: '財務' }).click();
    await expect(page.getByText('財務簽核')).toBeVisible();

    await page.getByRole('button', { name: '建立模板' }).click();
    await page.getByPlaceholder('例如：費用申請流程').fill('人資簽核流程');
    await page.getByRole('combobox', { name: '未分類' }).click();
    await page.locator('[role="option"]').filter({ hasText: '人資' }).click();
    await Promise.all([
      page.waitForURL('**/templates/template-created/designer'),
      page.getByRole('button', { exact: true, name: '建立' }).click(),
    ]);
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
        createApprovalTemplate: { id: 'template-created' },
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
