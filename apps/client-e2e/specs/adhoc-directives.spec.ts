/**
 * E2E spec: ad-hoc directives (PRE_APPROVAL, COUNTERSIGN, STAGE_NOTIFY, COMPLETION_NOTIFY)
 *
 * Journey (one instance threads all four features):
 *  1. member-102 submits a new "供應商請款簽核" instance via GraphQL mutation.
 *  2. member-101 (manager_review approver) opens the instance and via real UI:
 *     a. adds a PRE_APPROVAL signer (member-201)
 *     b. adds a COUNTERSIGN (member-301)
 *     c. configures a STAGE_NOTIFY for member-202
 *     d. configures a COMPLETION_NOTIFY for member-202
 *  3. Assertions: task table shows "（臨時加簽）" row; pending directives panel
 *     shows countersign & notify entries. Verified via GraphQL.
 *  4. member-101 clicks 同意 (UI) → instance stays RUNNING, no finance_review task.
 *  5. member-201 clicks 同意 (UI) for pre-approval → finance_review tasks appear,
 *     including "（臨時會簽）" row.
 *  6. member-202 checks notifications page (UI) → stage notification present.
 *  7. member-101 clicks 同意 (UI) for finance_review main task → still RUNNING.
 *  8. member-301 clicks 同意 (UI) for countersign task → instance becomes APPROVED.
 *  9. member-202 verifies completion notification (GraphQL + UI).
 */
import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';
import { requestGraphQl } from './_helpers/graphql';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';

const TEMPLATE_ID = '50000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// GraphQL shape types
// ---------------------------------------------------------------------------

interface SubmitInstanceData {
  readonly submitApprovalInstance: {
    readonly id: string;
  };
}

interface TaskQueryRecord {
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
  readonly isAdhoc: boolean;
  readonly adhocType: string | null;
  readonly assigneeMemberId: string | null;
}

interface InstanceStateData {
  readonly approvalInstance: {
    readonly id: string;
    readonly state: string;
    readonly title: string;
  };
}

interface InstanceTasksData {
  readonly tasks: readonly TaskQueryRecord[];
}

interface AdhocDirectivesData {
  readonly adhocDirectives: readonly {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly targetKind: string;
  }[];
}

interface NotificationRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

interface NotificationsData {
  readonly notifications: readonly NotificationRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createAuthenticatedPage(
  browser: Browser,
  memberId: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await authenticateApiMember(page, memberId);

  return page;
}

/**
 * Submit the seeded EXPENSE template via GraphQL mutation on behalf of member-102.
 * Returns the new instance id.
 */
async function submitExpenseInstanceViaGraphQl(
  browser: Browser,
  runLabel: string,
): Promise<string> {
  const page = await createAuthenticatedPage(browser, 'member-102');
  const data = await requestGraphQl<SubmitInstanceData>(
    page,
    `mutation AdhocSubmitInstance($input: SubmitApprovalInstanceInput!) {
      submitApprovalInstance(input: $input) {
        id
      }
    }`,
    {
      input: {
        formDataJson: JSON.stringify({
          amount: 10000,
          invoiceDate: '2026-06-01',
          paymentType: 'material',
          reason: `E2E 臨時加簽驗證 ${runLabel}`,
          vendorName: `E2E 測試供應商 ${runLabel}`,
        }),
        initiatorMemberId: 'member-102',
        templateId: TEMPLATE_ID,
        title: `供應商請款 ${runLabel}`,
      },
    },
  );
  await page.context().close();
  return data.submitApprovalInstance.id;
}

/** Read the instance state via GraphQL (as member-001 admin for full visibility). */
async function queryInstanceState(
  browser: Browser,
  instanceId: string,
): Promise<InstanceStateData> {
  const page = await createAuthenticatedPage(browser, 'member-001');
  const data = await requestGraphQl<InstanceStateData>(
    page,
    `query AdhocInstanceState($id: String!) {
      approvalInstance(id: $id) {
        id
        state
        title
      }
    }`,
    { id: instanceId },
  );
  await page.context().close();
  return data;
}

/** Read tasks for an instance (as member-001 for full visibility). */
async function queryInstanceTasks(
  browser: Browser,
  instanceId: string,
): Promise<InstanceTasksData> {
  const page = await createAuthenticatedPage(browser, 'member-001');
  const data = await requestGraphQl<InstanceTasksData>(
    page,
    `query AdhocInstanceTasks($instanceId: String!) {
      tasks(instanceId: $instanceId) {
        id
        nodeId
        status
        isAdhoc
        adhocType
        assigneeMemberId
      }
    }`,
    { instanceId },
  );
  await page.context().close();
  return data;
}

/** Read adhocDirectives for an instance (as member-101). */
async function queryAdhocDirectives(
  browser: Browser,
  instanceId: string,
): Promise<AdhocDirectivesData> {
  const page = await createAuthenticatedPage(browser, 'member-101');
  const data = await requestGraphQl<AdhocDirectivesData>(
    page,
    `query AdhocDirectives($instanceId: String!) {
      adhocDirectives(instanceId: $instanceId) {
        id
        type
        status
        targetKind
      }
    }`,
    { instanceId },
  );
  await page.context().close();
  return data;
}

/** Query notifications for a given memberId (authenticated as that member). */
async function queryNotifications(
  browser: Browser,
  memberId: string,
): Promise<NotificationsData> {
  const page = await createAuthenticatedPage(browser, memberId);
  const data = await requestGraphQl<NotificationsData>(
    page,
    `query AdhocNotifications($memberId: String!) {
      notifications(
        recipientMemberId: $memberId
        includeRead: true
        page: 1
        pageSize: 50
      ) {
        id
        title
        body
        status
      }
    }`,
    { memberId },
  );
  await page.context().close();
  return data;
}

/**
 * Navigate to the instance page and click a header button to open the adhoc
 * member-picker modal (加簽 or 會簽), then pick a member and submit.
 *
 * Assumes `page` is already authenticated as the task owner.
 */
async function performAdhocSignerAction(
  page: Page,
  instanceId: string,
  headerButtonName: string,
  memberSearchText: string,
  memberOptionText: string,
): Promise<void> {
  await page.goto(`/instances/${instanceId}`);
  await expect(
    page.getByRole('button', { name: headerButtonName }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: headerButtonName }).click();

  const modal = page.getByRole('dialog');

  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Click into the autocomplete input and search
  const searchInput = modal.locator('input[name="adhoc-member-search"]');

  await searchInput.click();
  await searchInput.fill(memberSearchText);

  // Wait for the option and click it
  await expect(
    page.getByRole('option', { name: memberOptionText }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('option', { name: memberOptionText }).click();

  // Wait for option selection to register, then dismiss dropdown by clicking the
  // modal header area (neutral area that closes the autocomplete popup)
  await page.waitForTimeout(300);
  await modal.locator('.mzn-modal__header').click({ force: true }).catch(() => {
    // Fallback: just use force click on submit if header isn't available
  });
  await page.waitForTimeout(200);

  // Submit (use force to bypass any residual popper z-index issues)
  await modal.getByRole('button', { name: '送出' }).click({ force: true });
  await expect(modal).toBeHidden({ timeout: 15_000 });
  // Allow page to refresh
  await page.waitForTimeout(1_500);
}

/**
 * Navigate to the instance page, click 通知設定, optionally switch timing
 * to COMPLETION_NOTIFY, then pick the member and submit.
 */
async function performAdhocNotifyAction(
  page: Page,
  instanceId: string,
  notifyTiming: 'STAGE_NOTIFY' | 'COMPLETION_NOTIFY',
  memberSearchText: string,
  memberOptionText: string,
): Promise<void> {
  await page.goto(`/instances/${instanceId}`);
  await expect(page.getByRole('button', { name: '通知設定' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '通知設定' }).click();

  const modal = page.getByRole('dialog');

  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Switch timing if needed — modal opens in STAGE_NOTIFY mode by default
  if (notifyTiming === 'COMPLETION_NOTIFY') {
    // The 通知時機 Select has an input with value "階段完成通知"; click to open dropdown
    const timingSelectInput = modal.locator('input').first();

    await timingSelectInput.click();
    await expect(
      page.getByRole('option', { name: '結案通知' }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole('option', { name: '結案通知' }).click();
  }

  // Pick the member from AutoComplete
  const searchInput = modal.locator('input[name="adhoc-member-search"]');

  await searchInput.click();
  await searchInput.fill(memberSearchText);
  await expect(
    page.getByRole('option', { name: memberOptionText }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('option', { name: memberOptionText }).click();

  // Dismiss dropdown by clicking a neutral area in the modal, then submit
  await page.waitForTimeout(300);
  await modal.locator('.mzn-modal__header').click({ force: true }).catch(() => {
    // Best effort — ignore if header selector not present
  });
  await page.waitForTimeout(200);

  // Submit
  await modal.getByRole('button', { name: '送出' }).click({ force: true });
  await expect(modal).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
}

/**
 * Open the instance page as a member and click 同意.
 * Waits for the approval to be fully processed (button disappears or page
 * transitions) before closing the context, preventing race conditions.
 * The page context is closed afterward.
 */
async function clickApprove(
  browser: Browser,
  memberId: string,
  instanceId: string,
): Promise<void> {
  const page = await createAuthenticatedPage(browser, memberId);

  await page.goto(`/instances/${instanceId}`);
  await expect(page.getByRole('button', { name: '同意' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '同意' }).click();
  await expect(page.getByRole('heading', { name: '簽核意見' })).toBeVisible();
  await page.getByRole('button', { name: '送出同意' }).click();

  // Wait for the UI to confirm the approval was processed:
  // The 同意 button should disappear once the task decision is committed.
  // Using toBeHidden ensures the server has processed the request before we
  // close the context (avoids the race where context closes mid-flight).
  await expect(page.getByRole('button', { name: '同意' })).toBeHidden({
    timeout: 20_000,
  });

  // Extra buffer to allow the workflow engine to advance the instance state
  await page.waitForTimeout(1_500);
  await page.context().close();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Ad-hoc directives: PRE_APPROVAL, COUNTERSIGN, STAGE_NOTIFY, COMPLETION_NOTIFY', () => {
  test('threads all four ad-hoc features through one instance journey', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(300_000);

    const runLabel = `adhoc-e2e-${Date.now()}`;

    // ------------------------------------------------------------------
    // Step 1: member-102 submits a new expense instance via GraphQL
    // ------------------------------------------------------------------
    const instanceId = await submitExpenseInstanceViaGraphQl(
      browser,
      runLabel,
    );

    expect(instanceId).toBeTruthy();

    // Wait briefly for the workflow engine to assign tasks
    await new Promise<void>((resolve) => setTimeout(resolve, 1_500));

    // ------------------------------------------------------------------
    // Step 2: member-101 adds all four ad-hoc directives via UI
    // ------------------------------------------------------------------
    const approverPage = await createAuthenticatedPage(browser, 'member-101');

    // 2a. Add PRE_APPROVAL signer: member-201 黃人資主管
    await performAdhocSignerAction(
      approverPage,
      instanceId,
      '加簽',
      '黃人資',
      '黃人資主管',
    );

    // Verify: task table shows (臨時加簽) after page refresh
    await approverPage.goto(`/instances/${instanceId}`);
    await expect(
      approverPage.getByRole('cell', { name: /臨時加簽/ }),
    ).toBeVisible({ timeout: 15_000 });

    // 2b. Add COUNTERSIGN: member-301 張業務經理
    await performAdhocSignerAction(
      approverPage,
      instanceId,
      '會簽',
      '張業務',
      '張業務經理',
    );

    // 2c. Configure STAGE_NOTIFY for member-202 蔡人資專員
    await performAdhocNotifyAction(
      approverPage,
      instanceId,
      'STAGE_NOTIFY',
      '蔡人資',
      '蔡人資專員',
    );

    // 2d. Configure COMPLETION_NOTIFY for member-202 蔡人資專員
    await performAdhocNotifyAction(
      approverPage,
      instanceId,
      'COMPLETION_NOTIFY',
      '蔡人資',
      '蔡人資專員',
    );

    // ------------------------------------------------------------------
    // Step 3: Assert pending directives panel and GraphQL state
    // ------------------------------------------------------------------
    await approverPage.goto(`/instances/${instanceId}`);
    await expect(
      approverPage.getByText('待生效的臨時設定'),
    ).toBeVisible({ timeout: 10_000 });

    // GraphQL: all four directives should be PENDING
    const directivesData = await queryAdhocDirectives(browser, instanceId);

    expect(directivesData.adhocDirectives).toHaveLength(4);
    expect(
      directivesData.adhocDirectives.find((d) => d.type === 'PRE_APPROVAL'),
    ).toBeTruthy();
    expect(
      directivesData.adhocDirectives.find((d) => d.type === 'COUNTERSIGN'),
    ).toBeTruthy();
    expect(
      directivesData.adhocDirectives.find((d) => d.type === 'STAGE_NOTIFY'),
    ).toBeTruthy();
    expect(
      directivesData.adhocDirectives.find(
        (d) => d.type === 'COMPLETION_NOTIFY',
      ),
    ).toBeTruthy();

    // PRE_APPROVAL directive is created with CONSUMED status immediately because
    // the system spawns an adhoc task for the pre-approval signer right away.
    // COUNTERSIGN, STAGE_NOTIFY, COMPLETION_NOTIFY stay PENDING until triggered.
    const preApprovalDirective = directivesData.adhocDirectives.find(
      (d) => d.type === 'PRE_APPROVAL',
    );
    const pendingDirectiveTypes = directivesData.adhocDirectives
      .filter((d) => d.status === 'PENDING')
      .map((d) => d.type);

    expect(preApprovalDirective?.status).toBe('CONSUMED');
    expect(pendingDirectiveTypes).toContain('COUNTERSIGN');
    expect(pendingDirectiveTypes).toContain('STAGE_NOTIFY');
    expect(pendingDirectiveTypes).toContain('COMPLETION_NOTIFY');

    // ------------------------------------------------------------------
    // Step 4: member-101 clicks 同意 — PRE_APPROVAL gate keeps it RUNNING
    // ------------------------------------------------------------------
    await approverPage.goto(`/instances/${instanceId}`);
    await expect(
      approverPage.getByRole('button', { name: '同意' }),
    ).toBeVisible({ timeout: 10_000 });
    await approverPage.getByRole('button', { name: '同意' }).click();
    await expect(
      approverPage.getByRole('heading', { name: '簽核意見' }),
    ).toBeVisible();
    await approverPage.getByRole('button', { name: '送出同意' }).click();
    await approverPage.waitForTimeout(3_000);

    // Poll GraphQL: instance still RUNNING
    await expect
      .poll(
        async () => queryInstanceState(browser, instanceId),
        { timeout: 20_000 },
      )
      .toMatchObject({ approvalInstance: { state: 'RUNNING' } });

    // No finance_review task should be active yet (pre-approval gate)
    const tasksBeforeGate = await queryInstanceTasks(browser, instanceId);
    const activeFinanceBeforeGate = tasksBeforeGate.tasks.filter(
      (t) =>
        t.nodeId === 'finance_review' &&
        (t.status === 'PENDING' || t.status === 'IN_PROGRESS'),
    );

    expect(activeFinanceBeforeGate).toHaveLength(0);

    // ------------------------------------------------------------------
    // Step 5: member-201 approves the pre-approval task → gate clears
    // finance_review tasks appear including countersign
    // ------------------------------------------------------------------
    await clickApprove(browser, 'member-201', instanceId);

    // Poll until at least 2 finance-stage tasks are active (main + countersign)
    let activeFinanceAfterGate: readonly TaskQueryRecord[] = [];

    await expect
      .poll(
        async () => {
          const data = await queryInstanceTasks(browser, instanceId);
          activeFinanceAfterGate = data.tasks.filter(
            (t) =>
              (t.nodeId === 'finance_review' ||
                (t.isAdhoc && t.adhocType === 'COUNTERSIGN')) &&
              (t.status === 'PENDING' || t.status === 'IN_PROGRESS'),
          );
          return activeFinanceAfterGate.length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // Verify UI shows (臨時會簽) row in tasks section (as member-101)
    await approverPage.goto(`/instances/${instanceId}`);
    await expect(
      approverPage.getByRole('cell', { name: /臨時會簽/ }),
    ).toBeVisible({ timeout: 20_000 });

    // ------------------------------------------------------------------
    // Step 6: member-202 verifies stage notification was received
    // Notification body: 案件「...」的階段「...」已通過。
    // ------------------------------------------------------------------
    await expect
      .poll(
        async () => {
          const data = await queryNotifications(browser, 'member-202');
          return data.notifications.some((n) => n.body.includes('已通過'));
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // UI verification: open notification drawer as member-202 and check for stage notification
    const member202Page = await createAuthenticatedPage(browser, 'member-202');

    await member202Page.goto('/dashboard');
    // Click the bell/notification button to open the drawer
    await member202Page
      .getByRole('button', { name: /^通知中心/ })
      .click();
    // The drawer renders notification rows; look for the stage notification body text
    await expect(
      member202Page.getByText(/已通過/).first(),
    ).toBeVisible({ timeout: 15_000 });
    await member202Page.context().close();

    // ------------------------------------------------------------------
    // Step 7: member-101 approves finance_review main task
    // countersign gate keeps it RUNNING
    // ------------------------------------------------------------------
    await clickApprove(browser, 'member-101', instanceId);

    await expect
      .poll(
        async () => queryInstanceState(browser, instanceId),
        { timeout: 20_000 },
      )
      .toMatchObject({ approvalInstance: { state: 'RUNNING' } });

    // Countersign task for member-301 should still be pending
    const tasksAfterFinanceApprove = await queryInstanceTasks(
      browser,
      instanceId,
    );
    const pendingCountersign = tasksAfterFinanceApprove.tasks.find(
      (t) =>
        t.isAdhoc &&
        t.adhocType === 'COUNTERSIGN' &&
        (t.status === 'PENDING' || t.status === 'IN_PROGRESS'),
    );

    expect(pendingCountersign).toBeTruthy();

    // ------------------------------------------------------------------
    // Step 8: member-301 approves the countersign task → APPROVED
    // ------------------------------------------------------------------
    await clickApprove(browser, 'member-301', instanceId);

    await expect
      .poll(
        async () => queryInstanceState(browser, instanceId),
        { timeout: 30_000 },
      )
      .toMatchObject({ approvalInstance: { state: 'APPROVED' } });

    // UI: instance shows 已同意 (readInstanceStateLabel maps APPROVED → '已同意')
    const finalPage = await createAuthenticatedPage(browser, 'member-001');

    await finalPage.goto(`/instances/${instanceId}`);
    await expect(finalPage.getByText('已同意').first()).toBeVisible({
      timeout: 10_000,
    });
    await finalPage.context().close();

    // ------------------------------------------------------------------
    // Step 9: member-202 verifies completion notification
    // Notification body: 案件「...」已結案（核准）。
    // ------------------------------------------------------------------
    await expect
      .poll(
        async () => {
          const data = await queryNotifications(browser, 'member-202');
          return data.notifications.some(
            (n) => n.body.includes('已結案') && n.body.includes('核准'),
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // UI verification: open notification drawer as member-202 and check for completion notification
    const member202FinalPage = await createAuthenticatedPage(
      browser,
      'member-202',
    );

    await member202FinalPage.goto('/dashboard');
    await member202FinalPage
      .getByRole('button', { name: /^通知中心/ })
      .click();
    // Completion notification body: 案件「...」已結案（核准）。
    await expect(
      member202FinalPage.getByText(/已結案/).first(),
    ).toBeVisible({ timeout: 15_000 });
    await member202FinalPage.context().close();

    // Done — all four ad-hoc features verified
    await approverPage.context().close();
  });
});
