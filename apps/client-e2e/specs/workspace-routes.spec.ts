import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

type ApprovalInstanceView = 'ALL' | 'CC' | 'SENT';

const STARTED_AT = '2026-05-19T09:00:00.000Z';

test.describe('Workspace route shortcuts', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
    await mockWorkspaceGraphQl(page);
  });

  test('shows dashboard metrics and navigates to launch center', async ({
    page,
  }): Promise<void> => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: '前往待處理簽核' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '前往逾時任務' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '前往案件總數' }),
    ).toBeVisible();

    await Promise.all([
      page.waitForURL('**/instances/new', { timeout: 30_000 }),
      page.getByRole('button', { name: '發起簽核' }).click(),
    ]);
  });

  test('opens sent, cc, and search instance lists', async ({
    page,
  }): Promise<void> => {
    await page.goto('/sent');
    await expect(page.getByRole('heading', { name: '我發起的' })).toBeVisible();
    await expect(page.getByText('我發起的採購申請')).toBeVisible();

    await page.goto('/cc');
    await expect(page.getByRole('heading', { name: '抄送給我' })).toBeVisible();
    await expect(page.getByText('抄送給我的折讓申請')).toBeVisible();

    await page.goto('/search');
    await expect(page.getByRole('heading', { name: '案件搜尋' })).toBeVisible();
    await expect(page.getByText('全部案件搜尋結果')).toBeVisible();
  });
});

async function mockWorkspaceGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query WorkflowDashboardSummary')) {
      await fulfillGraphQl(route, {
        workflowDashboardSummary: {
          activeInstanceCount: 3,
          completedInstanceCount: 8,
          overdueTaskCount: 1,
          pendingTaskCount: 4,
          rejectedInstanceCount: 2,
          totalInstanceCount: 13,
        },
      });
      return;
    }

    if (query.includes('query Notifications')) {
      await fulfillGraphQl(route, {
        notificationCount: 2,
        notifications: [],
        unreadNotificationCount: 2,
      });
      return;
    }

    if (query.includes('query UnreadNotificationCount')) {
      await fulfillGraphQl(route, {
        unreadNotificationCount: 2,
      });
      return;
    }

    if (
      query.includes('query ApprovalInstancesPage') ||
      query.includes('query ApprovalInstancesCount')
    ) {
      await fulfillGraphQl(route, {
        approvalInstances: readInstances(readApprovalInstanceView(payload)),
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readInstances(
  view: ApprovalInstanceView,
): readonly Readonly<Record<string, unknown>>[] {
  if (view === 'SENT') {
    return [
      readInstance({
        id: 'sent-instance',
        state: 'RUNNING',
        title: '我發起的採購申請',
      }),
    ];
  }

  if (view === 'CC') {
    return [
      readInstance({
        id: 'cc-instance',
        state: 'APPROVED',
        title: '抄送給我的折讓申請',
      }),
    ];
  }

  return [
    readInstance({
      id: 'search-instance',
      state: 'RETURNED',
      title: '全部案件搜尋結果',
    }),
  ];
}

function readInstance({
  id,
  state,
  title,
}: {
  readonly id: string;
  readonly state: string;
  readonly title: string;
}): Readonly<Record<string, unknown>> {
  return {
    completedAt: null,
    formDataJson: '{}',
    formDefinitionSnapshotJson: '{}',
    id,
    initiatorMemberId: 'member-001',
    startedAt: STARTED_AT,
    state,
    templateId: 'template-001',
    templateVersionId: 'template-version-001',
    title,
    workflowSnapshotJson: JSON.stringify({
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    }),
  };
}

function readApprovalInstanceView(
  payload: GraphQlPayload,
): ApprovalInstanceView {
  const view = payload.variables?.view;

  if (view === 'SENT' || view === 'CC' || view === 'ALL') {
    return view;
  }

  return 'ALL';
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
