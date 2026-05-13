import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

interface OrgUnitRecord {
  readonly code: string;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly type: string;
  readonly updatedAt: string;
}

const UPDATED_AT = '2026-05-12T09:00:00.000Z';

test.describe('admin organization management', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('filters organization units through GraphQL variables', async ({
    page,
  }): Promise<void> => {
    const requestedVariables: Readonly<Record<string, unknown>>[] = [];

    await mockOrganizationGraphQl(page, requestedVariables);

    await page.goto('/admin/orgs');
    await expect(page.getByRole('button', { name: '組織樹' })).toBeVisible();
    await expect(
      page.getByRole('table').getByText('公司', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('table').getByText('部門', { exact: true }),
    ).toBeVisible();

    await page.getByPlaceholder('搜尋組織名稱或代碼').fill('財務');
    await expect(page.getByRole('table').getByText('財務部')).toBeVisible();

    await page.getByRole('combobox', { name: '全部類型' }).click();
    await page.locator('[role="option"]').filter({ hasText: '部門' }).click();

    await expect
      .poll((): boolean =>
        requestedVariables.some(
          (variables) =>
            variables.orgUnitSearchText === '財務' &&
            variables.orgUnitType === 'DEPARTMENT' &&
            variables.orgUnitPage === 1 &&
            variables.orgUnitPageSize === 10,
        ),
      )
      .toBe(true);

    await page.getByRole('button', { name: '職位' }).click();
    await page.getByPlaceholder('搜尋職位名稱或代碼').fill('主管');

    await expect
      .poll((): boolean =>
        requestedVariables.some(
          (variables) => variables.positionSearchText === '主管',
        ),
      )
      .toBe(true);

    await page.getByRole('button', { name: '會員歸屬' }).click();
    await page.getByRole('combobox', { name: '全部狀態' }).click();
    await page.locator('[role="option"]').filter({ hasText: '目前有效' }).click();

    await expect
      .poll((): boolean =>
        requestedVariables.some(
          (variables) => variables.membershipActiveOnly === true,
        ),
      )
      .toBe(true);

    await page.getByRole('button', { name: '簽核主管' }).click();
    await page.getByRole('combobox', { name: '全部範圍' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '指定組織' })
      .click();

    await expect
      .poll((): boolean =>
        requestedVariables.some(
          (variables) => variables.managerScopeType === 'ORG_UNIT',
        ),
      )
      .toBe(true);
  });

  test('keeps org tree edits in draft until save', async ({
    page,
  }): Promise<void> => {
    const requestedVariables: Readonly<Record<string, unknown>>[] = [];
    const commitVariables: Readonly<Record<string, unknown>>[] = [];

    await mockOrganizationGraphQl(page, requestedVariables, commitVariables);

    await page.goto('/admin/orgs');
    await page.getByRole('button', { name: '切換樹狀圖' }).click();
    await expect(page.locator('.react-flow__node[data-id="org-finance"]')).toBeVisible();

    await page.getByRole('button', { name: '開始編輯' }).click();

    const rootNode = page.locator('.react-flow__node[data-id="__org-tree-root__"]');
    const financeNode = page.locator('.react-flow__node[data-id="org-finance"]');
    const rootBox = await rootNode.boundingBox();
    const financeBox = await financeNode.boundingBox();

    if (!rootBox || !financeBox) {
      throw new Error('Unable to locate org tree nodes for drag test');
    }

    await page.mouse.move(
      financeBox.x + financeBox.width / 2,
      financeBox.y + financeBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rootBox.x + rootBox.width / 2,
      rootBox.y + rootBox.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();

    await expect(page.getByText('已暫存為根節點。')).toBeVisible();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled();
    expect(commitVariables).toHaveLength(0);

    await page.getByRole('button', { name: '儲存' }).click();

    await expect
      .poll((): number => commitVariables.length)
      .toBe(1);
    expect(commitVariables[0]).toMatchObject({
      input: {
        moves: [
          {
            baseUpdatedAt: UPDATED_AT,
            id: 'org-finance',
            parentId: null,
          },
        ],
      },
    });
  });
});

async function mockOrganizationGraphQl(
  page: Page,
  requestedVariables: Readonly<Record<string, unknown>>[],
  commitVariables: Readonly<Record<string, unknown>>[] = [],
): Promise<void> {
  const orgUnits = [
    readOrgUnit({
      code: 'HQ',
      id: 'org-hq',
      name: '總公司',
      parentId: null,
      path: 'org.hq',
      type: 'COMPANY',
    }),
    readOrgUnit({
      code: 'FIN',
      id: 'org-finance',
      name: '財務部',
      parentId: 'org-hq',
      path: 'org.hq.finance',
      type: 'DEPARTMENT',
    }),
  ];
  const positions = [
    {
      code: 'FIN-MGR',
      createdAt: UPDATED_AT,
      id: 'position-fin-manager',
      level: 5,
      name: '財務主管',
      updatedAt: UPDATED_AT,
    },
  ];

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);

    if (payload.query.includes('query AdminOrganizationDashboard')) {
      const searchText = readOptionalString(
        payload.variables?.orgUnitSearchText,
      );
      const type = readOptionalString(payload.variables?.orgUnitType);
      const positionSearchText = readOptionalString(
        payload.variables?.positionSearchText,
      );

      requestedVariables.push(payload.variables ?? {});
      await fulfillGraphQl(route, {
        filteredOrgUnits: orgUnits.filter((orgUnit) => {
          const matchesSearch = searchText
            ? orgUnit.name.includes(searchText) ||
              orgUnit.code.includes(searchText)
            : true;
          const matchesType = type ? orgUnit.type === type : true;

          return matchesSearch && matchesType;
        }),
        filteredPositions: positions.filter((position) => {
          if (!positionSearchText) {
            return true;
          }

          return (
            position.name.includes(positionSearchText) ||
            position.code.includes(positionSearchText)
          );
        }),
        filteredMemberships: [],
        filteredManagerResolutions: [],
        managerResolutionCount: 0,
        managerResolutions: [],
        membershipCount: 0,
        memberships: [],
        organizationSummary: {
          managerResolutionCount: 0,
          membershipCount: 0,
          orgUnitCount: orgUnits.length,
          positionCount: positions.length,
        },
        orgUnitCount: orgUnits.length,
        orgUnits,
        positionCount: positions.length,
        positions,
      });
      return;
    }

    if (payload.query.includes('mutation AdminCommitOrgUnitTreeDraft')) {
      commitVariables.push(payload.variables ?? {});
      await fulfillGraphQl(route, {
        commitOrgUnitTreeDraft: {
          orgUnits,
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readOrgUnit({
  code,
  id,
  name,
  parentId,
  path,
  type,
}: {
  readonly code: string;
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly type: string;
}): OrgUnitRecord {
  return {
    code,
    createdAt: UPDATED_AT,
    deletedAt: null,
    id,
    name,
    parentId,
    path,
    type,
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

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
