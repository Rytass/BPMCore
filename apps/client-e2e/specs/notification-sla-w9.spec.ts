import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const INSTANCE_ID = 'w9-instance';
const TASK_ID = 'w9-task';
const CREATED_AT = '2026-05-09T08:00:00.000Z';

test.describe('W9 notifications and SLA', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('opens the notification drawer from the bell button and marks a notification as read', async ({
    page,
  }): Promise<void> => {
    await mockNotificationGraphQl(page);

    await page.goto('/dashboard');
    await expect(
      page.getByRole('button', { name: '通知中心，1 則未讀' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^通知中心/ }).click();
    await expect(page.getByText('新的待簽任務')).toBeVisible();
    await expect(page.getByText('SLA 即將到期')).toBeVisible();
    await expect(page.getByRole('button', { name: '標為已讀' })).toHaveCount(1);

    await page.getByRole('button', { name: '標為已讀' }).click();
    await expect(page.getByRole('button', { name: '標為已讀' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '通知中心，1 則未讀' }),
    ).toHaveCount(0);
  });

  test('marks an unread notification as read before opening its instance', async ({
    page,
  }): Promise<void> => {
    await mockNotificationGraphQl(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /^通知中心/ }).click();
    await expect(page.getByText('新的待簽任務')).toBeVisible();

    await page.getByText('新的待簽任務', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/instances/${INSTANCE_ID}$`));
  });

  test('loads additional notifications via the load more action', async ({
    page,
  }): Promise<void> => {
    await mockPaginatedNotificationGraphQl(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /^通知中心/ }).click();

    await expect(page.getByText('通知 1', { exact: true })).toBeVisible();
    await expect(page.getByText('通知 60', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '載入更多' }).click();
    await expect(page.getByText('通知 60', { exact: true })).toBeVisible();
  });

  test('shows SLA countdown in inbox pending tasks', async ({
    page,
  }): Promise<void> => {
    await mockInboxSlaGraphQl(page);

    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: '我的待簽' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'SLA' })).toBeVisible();
    await expect(page.getByRole('table').getByText('剩餘')).toBeVisible();
    await expect(page.getByText('申請事由：W9 SLA 測試')).toBeVisible();
  });
});

async function mockNotificationGraphQl(page: Page): Promise<void> {
  let read = false;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query Notifications')) {
      const pageNumber = readNumberVariable(payload.variables, 'page', 1);
      const pageSize = readNumberVariable(payload.variables, 'pageSize', 50);
      const notifications = readNotifications(read);

      await fulfillGraphQl(route, {
        notificationCount: notifications.length,
        notifications: notifications.slice(
          (pageNumber - 1) * pageSize,
          pageNumber * pageSize,
        ),
        unreadNotificationCount: read ? 0 : 1,
      });
      return;
    }

    if (query.includes('query UnreadNotificationCount')) {
      await fulfillGraphQl(route, {
        unreadNotificationCount: read ? 0 : 1,
      });
      return;
    }

    if (query.includes('query NotificationPreference')) {
      await fulfillGraphQl(route, {
        notificationPreference: readPreference(),
      });
      return;
    }

    if (query.includes('mutation MarkAllNotificationsRead')) {
      read = true;
      await fulfillGraphQl(route, {
        markAllNotificationsRead: 1,
      });
      return;
    }

    if (query.includes('mutation MarkNotificationRead')) {
      read = true;
      await fulfillGraphQl(route, {
        markNotificationRead: readNotifications(read)[0],
      });
      return;
    }

    if (query.includes('mutation UpdateNotificationPreference')) {
      await fulfillGraphQl(route, {
        updateNotificationPreference: readPreference(),
      });
      return;
    }

    if (query.includes('query DashboardOverview')) {
      await fulfillGraphQl(route, readDashboardOverview());
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

async function mockPaginatedNotificationGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query Notifications')) {
      const pageNumber = readNumberVariable(payload.variables, 'page', 1);
      const pageSize = readNumberVariable(payload.variables, 'pageSize', 50);
      const notifications = readManyNotifications(60);

      await fulfillGraphQl(route, {
        notificationCount: notifications.length,
        notifications: notifications.slice(
          (pageNumber - 1) * pageSize,
          pageNumber * pageSize,
        ),
        unreadNotificationCount: notifications.length,
      });
      return;
    }

    if (query.includes('query UnreadNotificationCount')) {
      await fulfillGraphQl(route, {
        unreadNotificationCount: 60,
      });
      return;
    }

    if (query.includes('query NotificationPreference')) {
      await fulfillGraphQl(route, {
        notificationPreference: readPreference(),
      });
      return;
    }

    if (query.includes('query DashboardOverview')) {
      await fulfillGraphQl(route, readDashboardOverview());
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

async function mockInboxSlaGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query InboxTasks')) {
      await fulfillGraphQl(route, {
        inboxTasks: [readInboxTask()],
      });
      return;
    }

    if (query.includes('query UnreadNotificationCount')) {
      await fulfillGraphQl(route, {
        unreadNotificationCount: 0,
      });
      return;
    }

    if (query.includes('query ApprovalHistoryTasks')) {
      await fulfillGraphQl(route, {
        approvalHistoryTasks: [],
      });
      return;
    }

    if (query.includes('query ApprovalInstance')) {
      await fulfillGraphQl(route, {
        activityLogs: [],
        approvalInstance: readApprovalInstance(),
        tasks: [readInboxTask()],
        workflowTokens: [],
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readManyNotifications(
  count: number,
): readonly Readonly<Record<string, unknown>>[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;

    return {
      body: `第 ${ordinal} 筆通知內容`,
      channel: 'IN_APP',
      createdAt: CREATED_AT,
      id: `notification-${ordinal}`,
      instanceId: INSTANCE_ID,
      payloadJson: '{}',
      readAt: null,
      recipientMemberId: 'member-001',
      sentAt: CREATED_AT,
      status: 'SENT',
      taskId: TASK_ID,
      title: `通知 ${ordinal}`,
      type: 'TASK_ASSIGNED',
    };
  });
}

function readNotifications(
  read: boolean,
): readonly Readonly<Record<string, unknown>>[] {
  return [
    {
      body: '案件 W9 SLA 測試 的 財務簽核 已指派給你。',
      channel: 'IN_APP',
      createdAt: CREATED_AT,
      id: 'notification-task',
      instanceId: INSTANCE_ID,
      payloadJson: '{}',
      readAt: read ? CREATED_AT : null,
      recipientMemberId: 'member-001',
      sentAt: CREATED_AT,
      status: read ? 'READ' : 'SENT',
      taskId: TASK_ID,
      title: '新的待簽任務',
      type: 'TASK_ASSIGNED',
    },
    {
      body: '財務簽核 將於 2026-05-09T10:00:00.000Z 到期，請儘快處理。',
      channel: 'IN_APP',
      createdAt: CREATED_AT,
      id: 'notification-sla',
      instanceId: INSTANCE_ID,
      payloadJson: '{}',
      readAt: CREATED_AT,
      recipientMemberId: 'member-001',
      sentAt: CREATED_AT,
      status: 'READ',
      taskId: TASK_ID,
      title: 'SLA 即將到期',
      type: 'SLA_WARNING',
    },
  ];
}

function readPreference(): Readonly<Record<string, unknown>> {
  return {
    emailDigestMode: 'INSTANT',
    emailEnabled: true,
    inAppEnabled: true,
    memberId: 'member-001',
    quietHoursEnd: null,
    quietHoursStart: null,
    updatedAt: CREATED_AT,
  };
}

function readDashboardOverview(): Readonly<Record<string, unknown>> {
  return {
    inboxTasks: [],
    sentInstances: [],
    workflowSummary: {
      activeInstances: 0,
      completedInstances: 0,
      overdueTasks: 0,
      pendingTasks: 0,
    },
  };
}

function readInboxTask(): Readonly<Record<string, unknown>> {
  return {
    assigneeMemberId: 'member-001',
    completedAt: null,
    createdAt: CREATED_AT,
    delegationChainJson: '[]',
    id: TASK_ID,
    instanceId: INSTANCE_ID,
    nodeId: 'task_finance',
    openedAt: null,
    originalAssigneeMemberId: 'member-001',
    slaDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: 'PENDING',
    tokenId: 'token-1',
  };
}

function readApprovalInstance(): Readonly<Record<string, unknown>> {
  return {
    completedAt: null,
    formDataJson: JSON.stringify({ reason: 'W9 SLA 測試' }),
    formDefinitionSnapshotJson: JSON.stringify({
      schema: {
        fields: [
          {
            fieldKey: 'reason',
            label: '申請事由',
            required: true,
            type: 'text',
          },
        ],
        version: 1,
      },
      uiSchema: { layout: [{ fieldKey: 'reason' }] },
      version: 1,
    }),
    id: INSTANCE_ID,
    initiatorMemberId: 'member-001',
    startedAt: CREATED_AT,
    state: 'RUNNING',
    templateId: 'template-1',
    templateVersionId: 'template-version-1',
    title: 'W9 SLA 測試',
    workflowSnapshotJson: JSON.stringify({
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    }),
  };
}

function readGraphQlPayload(route: Route): GraphQlPayload {
  return JSON.parse(route.request().postData() ?? '{}') as GraphQlPayload;
}

function readNumberVariable(
  variables: Readonly<Record<string, unknown>> | undefined,
  key: string,
  fallback: number,
): number {
  const value = variables?.[key];

  return typeof value === 'number' ? value : fallback;
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
