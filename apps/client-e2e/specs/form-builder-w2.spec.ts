import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

test.describe('M1 W2 form builder', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
    await mockTemplateComposeGraphQl(page);
  });

  test('opens the controlled builder inside the template compose wizard', async ({
    page,
  }): Promise<void> => {
    await page.goto('/templates/compose');

    await expect(
      page.getByRole('heading', { name: '建立模板（表單 + 流程）' }),
    ).toBeVisible();
    await page.getByPlaceholder('例如：請款簽核').fill('W2 表單模板');
    await page.getByRole('button', { name: /^文字$/u }).click();
    await expect(page.getByText('文字 1')).toBeVisible();

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByRole('heading', { name: '流程工具' })).toBeVisible();
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(page.getByText('文字 1')).toBeVisible();
  });

  test('does not expose a standalone form builder route', async ({
    page,
  }): Promise<void> => {
    const formResponse = await page.goto('/forms');
    const builderResponse = await page.goto('/forms/legacy-template/builder');

    expect([formResponse?.status(), builderResponse?.status()]).toEqual([
      404,
      404,
    ]);
  });

  test('previews a controlled form field and keeps its value when returning to design', async ({
    page,
  }): Promise<void> => {
    await page.goto('/templates/compose');

    await page.getByPlaceholder('例如：請款簽核').fill('W2 預覽模板');
    await page.getByRole('button', { name: /^文字$/u }).click();
    await page.getByRole('button', { name: '預覽' }).click();

    const textInput = page.getByPlaceholder('請輸入文字');
    await expect(textInput).toBeVisible();
    await textInput.fill('W2 e2e 渲染填寫');
    await expect(textInput).toHaveValue('W2 e2e 渲染填寫');

    await page.getByRole('button', { name: '設計' }).click();
    await expect(page.getByText('文字 1')).toBeVisible();
  });

  test('requires both a template name and a field before leaving form design', async ({
    page,
  }): Promise<void> => {
    await page.goto('/templates/compose');

    await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
    await page.getByPlaceholder('例如：請款簽核').fill('W2 驗證模板');
    await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();

    await page.getByRole('button', { name: /^文字$/u }).click();
    await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
  });
});

async function mockTemplateComposeGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);

    if (payload.query.includes('query ApprovalTemplateCategoriesPage')) {
      await fulfillGraphQl(route, {
        approvalTemplateCategories: [],
        approvalTemplateCategoryCount: 0,
      });
      return;
    }

    if (payload.query.includes('query AdminOrganizationDashboard')) {
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

    await fulfillGraphQl(route, {});
  });
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
