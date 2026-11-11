import { expect, Page, Request, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

type Variables = Readonly<Record<string, unknown>>;

interface GraphQlRequestPayload {
  readonly query: string;
  readonly variables: Variables;
}

const EXAMPLE_PATH = '/examples/filterable-expense';
const TEMPLATE_ID = '50000000-0000-4000-8000-000000000014';
const INSTANCE_ID = 'filterable-expense-case-01';
const STARTED_AT = '2026-05-19T09:00:00.000Z';
const APPLY_DATE = '2026-05-10';
const DEFAULT_SORT = [{ direction: 'DESC', field: 'submittedAt' }];

test.describe('欄位篩選示範頁', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
    await mockFilterableExpenseGraphQl(page);
  });

  test('loads with the default sort and no field filters', async ({
    page,
  }): Promise<void> => {
    const firstRequest = waitForInstancesRequest(page, (): boolean => true);

    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });

    const variables = await firstRequest;

    expect(variables.templateId).toBe(TEMPLATE_ID);
    expect(variables.fieldFilters).toBeNull();
    expect(variables.sort).toEqual(DEFAULT_SORT);

    await expect(
      page.getByRole('heading', { name: '欄位篩選示範' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '欄位篩選示範' }),
    ).toBeVisible();
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expect(page.getByText('甲供應商', { exact: true })).toBeVisible();
  });

  test('sends field filters from the draft only after 重新查詢', async ({
    page,
  }): Promise<void> => {
    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expandFilters(page);

    await page.getByPlaceholder('輸入廠商名稱片段').fill('丙');
    await page.getByPlaceholder('例如 10000').fill('10000');
    await page.getByPlaceholder('例如 500000').fill('500000');

    const submitted = waitForInstancesRequest(page, (variables): boolean =>
      hasFieldFilters(variables),
    );

    await page.getByRole('button', { name: '重新查詢' }).click();

    const variables = await submitted;

    expect(variables.fieldFilters).toEqual([
      { fieldKey: 'vendor', operator: 'CONTAINS', values: ['丙'] },
      { fieldKey: 'amountTwd', from: '10000', operator: 'RANGE', to: '500000' },
    ]);
    expect(variables.sort).toEqual(DEFAULT_SORT);
  });

  test('sends ascending sort when 升冪 is selected', async ({
    page,
  }): Promise<void> => {
    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expandFilters(page);

    const submitted = waitForInstancesRequest(page, (variables): boolean =>
      JSON.stringify(variables.sort) ===
      JSON.stringify([{ direction: 'ASC', field: 'submittedAt' }]),
    );

    await page.getByRole('radio', { name: '升冪' }).check({ force: true });
    await page.getByRole('button', { name: '重新查詢' }).click();

    const variables = await submitted;

    expect(variables.sort).toEqual([{ direction: 'ASC', field: 'submittedAt' }]);
  });

  test('blocks 重新查詢 when the amount range is inverted', async ({
    page,
  }): Promise<void> => {
    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expandFilters(page);

    await page.getByPlaceholder('例如 10000').fill('500000');
    await page.getByPlaceholder('例如 500000').fill('10000');
    await page.getByRole('button', { name: '重新查詢' }).click();

    await expect(
      page.getByText('金額的最小值不可大於最大值。'),
    ).toBeVisible();
  });

  test('清除條件 empties the draft and reloads without field filters', async ({
    page,
  }): Promise<void> => {
    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expandFilters(page);

    await page.getByPlaceholder('輸入廠商名稱片段').fill('丙');

    const filtered = waitForInstancesRequest(page, (variables): boolean =>
      hasFieldFilters(variables),
    );

    await page.getByRole('button', { name: '重新查詢' }).click();
    await filtered;

    const cleared = waitForInstancesRequest(
      page,
      (variables): boolean => variables.fieldFilters === null,
    );

    await page.getByRole('button', { name: '清除條件' }).click();

    const variables = await cleared;

    expect(variables.fieldFilters).toBeNull();
    await expect(page.getByPlaceholder('輸入廠商名稱片段')).toHaveValue('');
  });

  test('opens the case detail from the 查看 action', async ({
    page,
  }): Promise<void> => {
    await page.goto(EXAMPLE_PATH, { timeout: 60_000 });
    await expect(page.getByText('共 1 筆案件')).toBeVisible();
    await expandFilters(page);

    await page.getByRole('button', { name: '查看' }).first().click();

    await page.waitForURL(`**/instances/${INSTANCE_ID}`, { timeout: 30_000 });
  });
});

/**
 * FilterArea 預設只顯示第一行，其餘行要按「Expand filters」才可見。
 */
async function expandFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Expand filters' }).click();
}

async function mockFilterableExpenseGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readRouteGraphQlPayload(route.request());

    if (payload?.query.includes('query ApprovalInstancesPage')) {
      await fulfillGraphQl(route, {
        approvalInstances: [readInstance()],
      });
      return;
    }

    if (payload?.query.includes('query ApprovalInstancePageInfo')) {
      await fulfillGraphQl(route, {
        approvalInstancePageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        },
      });
      return;
    }

    if (payload?.query.includes('query ApprovalTemplates')) {
      await fulfillGraphQl(route, { approvalTemplates: [] });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

/**
 * 等待下一筆 ApprovalInstancesPage 請求，並回傳它的 variables。
 * 必須在觸發動作之前呼叫，否則會錯過請求。
 */
function waitForInstancesRequest(
  page: Page,
  matches: (variables: Variables) => boolean,
): Promise<Variables> {
  return page
    .waitForRequest(
      (request: Request): boolean => {
        const payload = readRequestGraphQlPayload(request);

        return (
          payload !== null &&
          payload.query.includes('query ApprovalInstancesPage') &&
          matches(payload.variables)
        );
      },
      { timeout: 20_000 },
    )
    .then((request: Request): Variables => {
      return readRequestGraphQlPayload(request)?.variables ?? {};
    });
}

function hasFieldFilters(variables: Variables): boolean {
  const fieldFilters = variables.fieldFilters;

  return Array.isArray(fieldFilters) && fieldFilters.length > 0;
}

function readInstance(): Readonly<Record<string, unknown>> {
  return {
    completedAt: null,
    formDataJson: JSON.stringify({
      amountTwd: 61000,
      applyDate: APPLY_DATE,
      vendor: 'V-001',
    }),
    formDataOptionSnapshotJson: JSON.stringify({
      vendor: {
        options: [{ label: '甲供應商', value: 'V-001' }],
      },
    }),
    formDefinitionSnapshotJson: '{}',
    id: INSTANCE_ID,
    initiatorMemberId: 'member-001',
    startedAt: STARTED_AT,
    state: 'APPROVED',
    submittedByMemberId: 'member-001',
    templateId: TEMPLATE_ID,
    templateVersionId: 'template-version-filterable-expense',
    title: '請款 01：甲供應商',
    workflowSnapshotJson: JSON.stringify({
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    }),
  };
}

function readRouteGraphQlPayload(
  request: Request,
): GraphQlRequestPayload | null {
  return readRequestGraphQlPayload(request);
}

function readRequestGraphQlPayload(
  request: Request,
): GraphQlRequestPayload | null {
  try {
    const body = request.postDataJSON() as unknown;

    if (!isRecord(body) || typeof body.query !== 'string') {
      return null;
    }

    return {
      query: body.query,
      variables: isRecord(body.variables) ? body.variables : {},
    };
  } catch {
    return null;
  }
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
