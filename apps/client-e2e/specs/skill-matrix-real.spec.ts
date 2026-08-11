import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';
import { requestGraphQl } from './_helpers/graphql';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';

const SEEDED_INSTANCE_IDS = {
  EXPENSE_RUNNING: '60000000-0000-4000-8000-000000000001',
} as const;

interface SeedCompletenessData {
  readonly approvalInstanceCount: number;
  readonly approvalInstancePageInfo: {
    readonly page: number;
    readonly pageSize: number;
    readonly totalCount: number;
    readonly totalPages: number;
  };
  readonly approvalTemplateCategoryCount: number;
  readonly approvalTemplateCount: number;
  readonly delegationRuleCount: number;
  readonly formDefinitionCount: number;
  readonly memberCount: number;
  readonly notificationCount: number;
  readonly orgUnitCount: number;
  readonly positionCount: number;
  readonly signatures: readonly {
    readonly algorithm: string;
    readonly id: string;
  }[];
  readonly tasks: readonly {
    readonly assigneeMemberId: string | null;
    readonly candidateMemberIds: readonly string[];
    readonly id: string;
    readonly nodeId: string;
    readonly status: string;
  }[];
  readonly verifySignatureChain: {
    readonly checkedCount: number;
    readonly valid: boolean;
  };
  readonly workflowDashboardSummary: {
    readonly activeInstanceCount: number;
    readonly totalInstanceCount: number;
  };
  readonly workflowTokens: readonly {
    readonly currentNodeId: string;
    readonly status: string;
  }[];
}

interface MemberSearchData {
  readonly searchMembers: readonly {
    readonly email: string | null;
    readonly memberId: string;
    readonly name: string;
  }[];
}

interface CreateFormDefinitionData {
  readonly createFormDefinition: { readonly id: string };
}

interface VersionRecord {
  readonly id: string;
  readonly status: string;
  readonly version: number;
}

interface FormDefinitionVersionsData {
  readonly formDefinitionVersions: readonly VersionRecord[];
}

interface PublishFormDefinitionVersionData {
  readonly publishFormDefinitionVersion: VersionRecord;
}

interface CreateApprovalTemplateData {
  readonly createApprovalTemplate: { readonly id: string };
}

interface ApprovalTemplateVersionsData {
  readonly approvalTemplateVersions: readonly VersionRecord[];
}

interface UpdateApprovalTemplateDraftData {
  readonly updateApprovalTemplateDraft: VersionRecord;
}

interface PublishApprovalTemplateVersionData {
  readonly publishApprovalTemplateVersion: VersionRecord;
}

interface ApprovalInstanceData {
  readonly approvalInstance: {
    readonly formDataJson: string;
    readonly id: string;
    readonly state: string;
    readonly title: string;
  };
}

interface ApprovalInstanceVerificationData extends ApprovalInstanceData {
  readonly activityLogs: readonly {
    readonly eventType: string;
    readonly payloadJson: string;
  }[];
  readonly taskCandidates: readonly {
    readonly memberId: string;
    readonly status: string;
  }[];
  readonly tasks: readonly {
    readonly assigneeMemberId: string | null;
    readonly candidateMemberIds: readonly string[];
    readonly id: string;
    readonly nodeId: string;
    readonly status: string;
  }[];
}

interface ApprovalTemplateCategoryData {
  readonly approvalTemplateCategories: readonly {
    readonly description: string | null;
    readonly id: string;
    readonly isActive: boolean;
    readonly name: string;
    readonly sortOrder: number;
  }[];
}

interface DelegationRuleData {
  readonly delegationRules: readonly {
    readonly agentMemberId: string;
    readonly id: string;
    readonly principalMemberId: string;
    readonly scopeType: string;
    readonly status: string;
  }[];
}

interface NotificationData {
  readonly notificationPreference: {
    readonly emailDigestMode: string;
    readonly emailEnabled: boolean;
    readonly inAppEnabled: boolean;
    readonly memberId: string;
  };
  readonly notifications: readonly {
    readonly id: string;
    readonly status: string;
    readonly title: string;
  }[];
  readonly unreadNotificationCount: number;
}

type NotificationSummary = NotificationData['notifications'][number];

interface NotificationPageData {
  readonly notificationCount: number;
  readonly notifications: readonly NotificationSummary[];
}

interface AttachmentAccessData {
  readonly attachmentDownloadUrl: string;
  readonly attachmentPreviewUrl: string;
  readonly attachments: readonly {
    readonly filename: string;
    readonly id: string;
    readonly mimeType: string;
  }[];
}

interface SubmitTemplateOptions {
  readonly amount?: number;
  readonly title: string;
}

interface ReturnedInstanceFixture {
  readonly id: string;
  readonly title: string;
}

test.describe('BPM skill matrix real browser e2e coverage', () => {
  test('validates auth, health, deterministic seed, admin surfaces, detail audit, security, performance, and responsive routes', async ({
    browser,
    request,
  }): Promise<void> => {
    test.setTimeout(120_000);

    const unauthenticatedPage = await browser.newPage({ baseURL: BASE_URL });

    await unauthenticatedPage.goto('/inbox');
    await expect(unauthenticatedPage).toHaveURL(/\/login\?next=%2Finbox/);
    await expect(
      unauthenticatedPage.getByRole('heading', { name: 'BPM Admin' }),
    ).toBeVisible();
    await expect(unauthenticatedPage.getByText('林總經理')).toBeVisible();
    await unauthenticatedPage
      .getByPlaceholder('member id 或 email')
      .fill('lin.ceo@example.internal');
    await unauthenticatedPage.getByRole('button', { name: '登入' }).click();
    await expect(unauthenticatedPage).toHaveURL(/\/inbox$/);
    await expect(
      unauthenticatedPage
        .getByRole('combobox')
        .filter({ hasText: '林總經理' })
        .first(),
    ).toBeVisible();

    const healthResponse = await request.get('http://localhost:17603/health');
    await expect(healthResponse).toBeOK();
    await expect(healthResponse.json()).resolves.toEqual({
      service: 'api',
      status: 'ok',
    });

    const meResponse = await unauthenticatedPage
      .context()
      .request.get(`${API_URL}/auth/me`);

    await expect(meResponse).toBeOK();
    await expect(meResponse.json()).resolves.toEqual(
      expect.objectContaining({
        memberId: 'member-001',
        name: '林總經理',
      }),
    );

    await verifySeedCompleteness(unauthenticatedPage);
    await verifyAdminAndWorkspaceRoutes(unauthenticatedPage);
    await verifyAttachmentSignatureAndReadability(unauthenticatedPage);
    await verifyResponsiveRoutes(browser);

    await unauthenticatedPage.getByLabel('登出').click();
    await unauthenticatedPage.waitForURL(/\/login(?:\?.*)?$/);

    const loggedOutMeResponse = await unauthenticatedPage
      .context()
      .request.get(`${API_URL}/auth/me`);

    expect(loggedOutMeResponse.status()).toBe(401);
    await unauthenticatedPage.close();
  });

  test('executes real candidate approver, service task, cancel, and resubmit browser journeys', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(180_000);

    const runId = `matrix-${Date.now()}`;
    const adminPage = await createAuthenticatedPage(browser, 'member-001');
    const formVersionId = await createPublishedFormVersion(adminPage, runId);
    const candidateTemplateId = await createPublishedTemplate(adminPage, {
      formVersionId,
      runId,
      title: '候選簽核人',
      workflowDefinition: createCandidateWorkflow(),
    });
    const cancelTemplateId = await createPublishedTemplate(adminPage, {
      formVersionId,
      runId,
      title: '取消流程',
      workflowDefinition: createSingleApprovalWorkflow('member-101'),
    });
    const notifyTemplateId = await createPublishedTemplate(adminPage, {
      formVersionId,
      runId,
      title: '服務任務通知',
      workflowDefinition: createNotifyServiceTaskWorkflow(),
    });
    const setFieldTemplateId = await createPublishedTemplate(adminPage, {
      formVersionId,
      runId,
      title: '服務任務設值',
      workflowDefinition: createSetFormFieldServiceTaskWorkflow(),
    });
    const webhookTemplateId = await createPublishedTemplate(adminPage, {
      formVersionId,
      runId,
      title: '服務任務 Webhook',
      workflowDefinition: createWebhookServiceTaskWorkflow(),
    });

    await adminPage.context().close();

    const candidateInstanceId = await submitTemplate(browser, 'member-102', {
      amount: 100,
      templateId: candidateTemplateId,
      title: `候選簽核人 ${runId}`,
    });

    await approveCandidateTask(browser, {
      instanceId: candidateInstanceId,
      memberId: 'member-101',
      title: `候選簽核人 ${runId}`,
    });
    await expect
      .poll(
        async (): Promise<ApprovalInstanceVerificationData> =>
          readInstanceVerification(
            await createAuthenticatedPage(browser, 'member-001'),
            candidateInstanceId,
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({
        approvalInstance: { state: 'APPROVED' },
        taskCandidates: expect.arrayContaining([
          expect.objectContaining({
            memberId: 'member-101',
            status: 'COMPLETED',
          }),
          expect.objectContaining({
            memberId: 'member-201',
            status: 'CANCELLED',
          }),
        ]),
      });

    const cancelInstanceId = await submitTemplate(browser, 'member-102', {
      amount: 250,
      templateId: cancelTemplateId,
      title: `取消流程 ${runId}`,
    });
    await cancelInstance(browser, {
      instanceId: cancelInstanceId,
      memberId: 'member-102',
      title: `取消流程 ${runId}`,
    });

    await submitTemplate(browser, 'member-102', {
      amount: 300,
      templateId: notifyTemplateId,
      title: `服務任務通知 ${runId}`,
    });
    const setFieldInstanceId = await submitTemplate(browser, 'member-102', {
      amount: 400,
      templateId: setFieldTemplateId,
      title: `服務任務設值 ${runId}`,
    });
    const webhookInstanceId = await submitTemplate(browser, 'member-102', {
      amount: 500,
      templateId: webhookTemplateId,
      title: `服務任務 Webhook ${runId}`,
    });

    const servicePage = await createAuthenticatedPage(browser, 'member-001');

    await expect
      .poll(
        async (): Promise<ApprovalInstanceData> =>
          requestGraphQl<ApprovalInstanceData>(
            servicePage,
            `query MatrixServiceTaskInstance($id: String!) {
              approvalInstance(id: $id) {
                formDataJson
                id
                state
                title
              }
            }`,
            { id: setFieldInstanceId },
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({
        approvalInstance: {
          state: 'APPROVED',
        },
      });

    const setFieldData = await requestGraphQl<ApprovalInstanceData>(
      servicePage,
      `query MatrixSetFieldInstance($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          id
          state
          title
        }
      }`,
      { id: setFieldInstanceId },
    );
    const setFieldFormData = JSON.parse(
      setFieldData.approvalInstance.formDataJson,
    ) as Readonly<Record<string, unknown>>;

    expect(setFieldFormData.approvalLevel).toBe('主管簽核');

    const webhookVerification = await readInstanceVerification(
      servicePage,
      webhookInstanceId,
    );

    expect(webhookVerification.approvalInstance.state).toBe('APPROVED');
    expect(
      webhookVerification.activityLogs.some(
        (log) => log.eventType === 'SERVICE_TASK_FAILED',
      ),
    ).toBe(true);

    await verifyReturnedSeedResubmitWarning(browser);
    await servicePage.context().close();
  });

  test('mutates real categories, notifications, delegations, and returned resubmission through browser journeys', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(180_000);

    const runId = `matrix-ui-${Date.now()}`;

    await verifyTemplateCategoryCrud(browser, runId);
    await verifyNotificationReadAndPreference(browser);
    await verifyDelegationCreateAndRevoke(browser);
    await verifyReturnedSeedResubmit(browser);
  });
});

async function verifySeedCompleteness(page: Page): Promise<void> {
  const data = await requestGraphQl<SeedCompletenessData>(
    page,
    `query MatrixSeedCompleteness {
      orgUnitCount
      positionCount
      memberCount
      formDefinitionCount
      approvalTemplateCount
      approvalTemplateCategoryCount
      approvalInstanceCount(view: ALL)
      approvalInstancePageInfo(view: ALL, page: 1, pageSize: 2) {
        page
        pageSize
        totalCount
        totalPages
      }
      workflowDashboardSummary {
        activeInstanceCount
        totalInstanceCount
      }
      notificationCount(recipientMemberId: "member-101", includeRead: true)
      delegationRuleCount(includeInactive: true)
      workflowTokens(instanceId: "60000000-0000-4000-8000-000000000001") {
        currentNodeId
        status
      }
      tasks(instanceId: "60000000-0000-4000-8000-000000000001") {
        assigneeMemberId
        candidateMemberIds
        id
        nodeId
        status
      }
      signatures(instanceId: "60000000-0000-4000-8000-000000000003") {
        algorithm
        id
      }
      verifySignatureChain(instanceId: "60000000-0000-4000-8000-000000000003") {
        checkedCount
        valid
      }
    }`,
  );

  expect(data.orgUnitCount).toBeGreaterThanOrEqual(10);
  expect(data.positionCount).toBeGreaterThanOrEqual(10);
  expect(data.memberCount).toBeGreaterThanOrEqual(13);
  expect(data.formDefinitionCount).toBeGreaterThanOrEqual(5);
  expect(data.approvalTemplateCount).toBeGreaterThanOrEqual(5);
  expect(data.approvalTemplateCategoryCount).toBeGreaterThanOrEqual(5);
  expect(data.approvalInstanceCount).toBeGreaterThanOrEqual(7);
  expect(data.approvalInstancePageInfo).toMatchObject({
    page: 1,
    pageSize: 2,
    totalCount: data.approvalInstanceCount,
  });
  expect(data.workflowDashboardSummary.totalInstanceCount).toBeGreaterThan(0);
  expect(data.workflowDashboardSummary.activeInstanceCount).toBeGreaterThan(0);
  expect(data.notificationCount).toBeGreaterThan(0);
  expect(data.delegationRuleCount).toBeGreaterThan(0);
  expect(data.workflowTokens.length).toBeGreaterThan(0);
  expect(data.tasks.length).toBeGreaterThan(0);
  expect(data.signatures.length).toBeGreaterThan(0);
  expect(data.verifySignatureChain.valid).toBe(true);
  expect(data.verifySignatureChain.checkedCount).toBeGreaterThan(0);
}

async function verifyAdminAndWorkspaceRoutes(page: Page): Promise<void> {
  await page.goto('/admin/orgs');
  await expect(page.getByRole('heading', { name: '組織管理' })).toBeVisible();
  await page.getByPlaceholder('搜尋組織名稱或代碼').fill('財務管理部');
  await expect(page.getByText('財務管理部').first()).toBeVisible();

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '會員對照' })).toBeVisible();
  await page.getByPlaceholder('搜尋姓名或信箱').fill('陳財務');
  await expect(page.getByText('陳財務經理')).toBeVisible();

  const memberData = await requestGraphQl<MemberSearchData>(
    page,
    `query MatrixMemberDirectory {
      searchMembers(searchText: "陳財務", page: 1, pageSize: 5) {
        email
        memberId
        name
      }
    }`,
  );

  expect(memberData.searchMembers).toContainEqual(
    expect.objectContaining({
      memberId: 'member-101',
      name: '陳財務經理',
    }),
  );

  await page.goto('/templates/compose');
  await expect(
    page.getByRole('heading', { name: '建立模板（表單 + 流程）' }),
  ).toBeVisible();
  await expect(page.getByText('表單設計')).toBeVisible();

  await page.goto('/templates/categories');
  await expect(
    page.getByRole('heading', { name: '簽核模板分類' }),
  ).toBeVisible();
  await expect(page.getByText('採購請款')).toBeVisible();

  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: '簽核模板' })).toBeVisible();
  const templateSearchResponse = page.waitForResponse((response): boolean => {
    const payload = response.request().postDataJSON() as unknown;

    if (!isRecord(payload) || typeof payload.query !== 'string') {
      return false;
    }

    return (
      payload.query.includes('query ApprovalTemplatesPage') &&
      isRecord(payload.variables) &&
      payload.variables.searchText === '供應商請款'
    );
  });
  await page
    .getByPlaceholder('關鍵字：搜尋模板名稱、分類或描述')
    .fill('供應商請款');
  const templateSearchResult = await templateSearchResponse;
  const templateSearchPayload = (await templateSearchResult.json()) as unknown;
  const templateSearchData = isRecord(templateSearchPayload)
    ? readRecord(templateSearchPayload.data)
    : {};
  expect(templateSearchData.approvalTemplates).toContainEqual(
    expect.objectContaining({
      name: '供應商請款簽核',
    }),
  );
  await expect(page.getByText('供應商請款簽核')).toBeVisible();

  await page.goto(
    '/instances/new?templateId=50000000-0000-4000-8000-000000000001',
  );
  await expect(page.getByRole('heading', { name: '發起簽核' })).toBeVisible();
  await expect(page.getByText('供應商請款簽核')).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: '案件搜尋' })).toBeVisible();
  await page
    .getByPlaceholder('關鍵字：搜尋案件、發起人、模板或狀態')
    .fill('供應商請款');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await page.goto('/cc');
  await expect(page.getByRole('heading', { name: '抄送給我' })).toBeVisible();
  await page.goto('/settings/notifications');
  await expect(page.getByRole('heading', { name: '通知設定' })).toBeVisible();

  await page.goto('/dashboard');
  await page.getByRole('button', { name: /^通知中心/ }).click();
  await expect(page.getByText('SLA 已逾期：鋁合金胚料採購')).toBeVisible();
  await page.goto('/admin/delegations');
  await expect(page.getByRole('heading', { name: '代理設定' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  const seededDelegationData = await requestGraphQl<DelegationRuleData>(
    page,
    `query MatrixSeededAdminDelegation {
      delegationRules(
        principalMemberId: "member-101"
        includeInactive: true
        page: 1
        pageSize: 20
      ) {
        agentMemberId
        id
        principalMemberId
        scopeType
        status
      }
    }`,
  );
  expect(seededDelegationData.delegationRules).toContainEqual(
    expect.objectContaining({
      agentMemberId: 'member-103',
      principalMemberId: 'member-101',
      scopeType: 'TEMPLATE_LIST',
      status: 'ACTIVE',
    }),
  );
}

async function verifyAttachmentSignatureAndReadability(
  page: Page,
): Promise<void> {
  const browser = page.context().browser();

  if (!browser) {
    throw new Error('Browser context is not available');
  }

  const attachmentPage = await browser.newPage({ baseURL: BASE_URL });

  await authenticateApiMember(attachmentPage, 'member-102');
  const attachmentData = await requestGraphQl<AttachmentAccessData>(
    attachmentPage,
    `query MatrixAttachmentAccess($instanceId: String!) {
      attachments(instanceId: $instanceId) {
        filename
        id
        mimeType
      }
      attachmentPreviewUrl(id: "65000000-0000-4000-8000-000000000001")
      attachmentDownloadUrl(id: "65000000-0000-4000-8000-000000000001")
    }`,
    { instanceId: SEEDED_INSTANCE_IDS.EXPENSE_RUNNING },
  );

  expect(attachmentData.attachments.length).toBeGreaterThan(0);
  expect(attachmentData.attachmentPreviewUrl).toContain('/attachments/');
  expect(attachmentData.attachmentDownloadUrl).toContain('/attachments/');

  await attachmentPage.goto(
    `/instances/${SEEDED_INSTANCE_IDS.EXPENSE_RUNNING}`,
  );
  await expect(
    attachmentPage.getByRole('heading', { name: '供應商請款：CNC 治具加工費' }),
  ).toBeVisible();
  await expect(attachmentPage.getByText('任務')).toBeVisible();
  await expect(attachmentPage.getByText('歷程')).toBeVisible();
  await attachmentPage.close();

  const signaturePage = await browser.newPage({ baseURL: BASE_URL });

  await authenticateApiMember(signaturePage, 'member-103');
  await signaturePage.goto('/instances/60000000-0000-4000-8000-000000000003');
  await expect(
    signaturePage.getByRole('heading', { name: '附件' }),
  ).toBeVisible();
  await expect(
    signaturePage.getByRole('heading', { name: '簽章' }),
  ).toBeVisible();
  await expect(signaturePage.getByText(/簽章鏈已驗證/)).toBeVisible();
  await signaturePage.close();

  const unrelatedPage = await browser.newPage({ baseURL: BASE_URL });

  await authenticateApiMember(unrelatedPage, 'member-202');
  await expect(
    requestGraphQl<ApprovalInstanceData>(
      unrelatedPage,
      `query MatrixUnreadableInstance($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          id
          state
          title
        }
      }`,
      { id: SEEDED_INSTANCE_IDS.EXPENSE_RUNNING },
    ),
  ).rejects.toThrow();
  await unrelatedPage.close();
}

async function verifyResponsiveRoutes(browser: Browser): Promise<void> {
  const mobileContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { height: 844, width: 390 },
  });
  const mobilePage = await mobileContext.newPage();

  await authenticateApiMember(mobilePage, 'member-001');
  await mobilePage.goto('/dashboard');
  await expect(
    mobilePage.getByRole('heading', { name: '工作台' }),
  ).toBeVisible();
  await expect(mobilePage.locator('body')).not.toHaveText(/Error|Unhandled/);
  await mobilePage.goto('/templates');
  await expect(
    mobilePage.getByRole('heading', { name: '簽核模板' }),
  ).toBeVisible();
  await mobileContext.close();
}

async function createAuthenticatedPage(
  browser: Browser,
  memberId: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await authenticateApiMember(page, memberId);
  await page.goto('/');

  return page;
}

async function createPublishedFormVersion(
  page: Page,
  runId: string,
): Promise<string> {
  const formDefinition = await requestGraphQl<CreateFormDefinitionData>(
    page,
    `mutation MatrixCreateForm($input: CreateFormDefinitionInput!) {
      createFormDefinition(input: $input) {
        id
      }
    }`,
    {
      input: {
        createdByMemberId: 'member-001',
        description: 'Matrix real e2e form',
        name: `Matrix E2E 表單 ${runId}`,
        schemaJson: JSON.stringify({
          fields: [
            {
              fieldKey: 'subject',
              label: '申請主旨',
              placeholder: '請輸入申請主旨',
              required: true,
              type: 'text',
            },
            {
              fieldKey: 'amount',
              label: '申請金額',
              placeholder: '請輸入金額',
              required: true,
              type: 'number',
            },
          ],
          schemaVersion: 1,
        }),
        uiSchemaJson: JSON.stringify({
          layout: [
            { fieldKey: 'subject', width: 'FULL' },
            { fieldKey: 'amount', width: 'FULL' },
          ],
          schemaVersion: 1,
        }),
      },
    },
  );
  const versions = await requestGraphQl<FormDefinitionVersionsData>(
    page,
    `query MatrixFormVersions($formDefinitionId: String!) {
      formDefinitionVersions(formDefinitionId: $formDefinitionId) {
        id
        status
        version
      }
    }`,
    { formDefinitionId: formDefinition.createFormDefinition.id },
  );
  const draft = readDraftVersion(versions.formDefinitionVersions);
  const published = await requestGraphQl<PublishFormDefinitionVersionData>(
    page,
    `mutation MatrixPublishForm($versionId: String!, $publishedByMemberId: String) {
      publishFormDefinitionVersion(
        versionId: $versionId
        publishedByMemberId: $publishedByMemberId
      ) {
        id
        status
        version
      }
    }`,
    { publishedByMemberId: 'member-001', versionId: draft.id },
  );

  return published.publishFormDefinitionVersion.id;
}

async function createPublishedTemplate(
  page: Page,
  {
    formVersionId,
    runId,
    title,
    workflowDefinition,
  }: {
    readonly formVersionId: string;
    readonly runId: string;
    readonly title: string;
    readonly workflowDefinition: Readonly<Record<string, unknown>>;
  },
): Promise<string> {
  const template = await requestGraphQl<CreateApprovalTemplateData>(
    page,
    `mutation MatrixCreateTemplate($input: CreateApprovalTemplateInput!) {
      createApprovalTemplate(input: $input) {
        id
      }
    }`,
    {
      input: {
        category: 'Matrix E2E',
        createdByMemberId: 'member-001',
        description: `Matrix real e2e: ${title}`,
        formDefinitionVersionId: formVersionId,
        name: `Matrix ${title} ${runId}`,
      },
    },
  );
  const versions = await requestGraphQl<ApprovalTemplateVersionsData>(
    page,
    `query MatrixTemplateVersions($templateId: String!) {
      approvalTemplateVersions(templateId: $templateId) {
        id
        status
        version
      }
    }`,
    { templateId: template.createApprovalTemplate.id },
  );
  const draft = readDraftVersion(versions.approvalTemplateVersions);

  await requestGraphQl<UpdateApprovalTemplateDraftData>(
    page,
    `mutation MatrixUpdateTemplateDraft($input: UpdateApprovalTemplateDraftInput!) {
      updateApprovalTemplateDraft(input: $input) {
        id
        status
        version
      }
    }`,
    {
      input: {
        formDefinitionVersionId: formVersionId,
        initiatorPolicyCel: null,
        notificationConfigJson: null,
        slaDefaultsJson: null,
        versionId: draft.id,
        workflowDefinitionJson: JSON.stringify(workflowDefinition),
      },
    },
  );

  await requestGraphQl<PublishApprovalTemplateVersionData>(
    page,
    `mutation MatrixPublishTemplate($versionId: String!, $publishedByMemberId: String) {
      publishApprovalTemplateVersion(
        versionId: $versionId
        publishedByMemberId: $publishedByMemberId
      ) {
        id
        status
        version
      }
    }`,
    { publishedByMemberId: 'member-001', versionId: draft.id },
  );

  return template.createApprovalTemplate.id;
}

async function submitTemplate(
  browser: Browser,
  memberId: string,
  {
    amount = 100,
    templateId,
    title,
  }: SubmitTemplateOptions & { readonly templateId: string },
): Promise<string> {
  const page = await createAuthenticatedPage(browser, memberId);

  await page.goto(`/instances/new?templateId=${templateId}`);
  await page.getByPlaceholder('請輸入申請主旨').fill(title);
  await page.getByPlaceholder('請輸入金額').fill(String(amount));
  await Promise.all([
    page.waitForURL(isInstanceDetailUrl, { timeout: 30_000 }),
    page.getByRole('button', { name: '送出' }).click(),
  ]);
  await expect(page.getByText(title)).toBeVisible();

  const instanceId = readInstanceIdFromUrl(page.url());

  await page.context().close();

  return instanceId;
}

async function createReturnedInstance(
  browser: Browser,
  runId: string,
): Promise<ReturnedInstanceFixture> {
  const adminPage = await createAuthenticatedPage(browser, 'member-001');
  const formVersionId = await createPublishedFormVersion(
    adminPage,
    `returned-${runId}`,
  );
  const templateId = await createPublishedTemplate(adminPage, {
    formVersionId,
    runId: `returned-${runId}`,
    title: '可退回案件',
    workflowDefinition: createReturnableWorkflow(),
  });
  await adminPage.context().close();

  const title = `系統權限：MES 工單編輯權限 ${runId}`;
  const instanceId = await submitTemplate(browser, 'member-303', {
    templateId,
    title,
  });

  await approveCandidateTask(browser, {
    instanceId,
    memberId: 'member-101',
    title,
  });

  const returnPage = await createAuthenticatedPage(browser, 'member-201');
  await expect
    .poll(
      async (): Promise<boolean> => {
        try {
          const data = await requestGraphQl<ApprovalInstanceData>(
            returnPage,
            `query MatrixReturnableInstanceReady($id: String!) {
              approvalInstance(id: $id) {
                formDataJson
                id
                state
                title
              }
            }`,
            { id: instanceId },
          );

          return data.approvalInstance.title.includes(title);
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await returnPage.goto(`/instances/${instanceId}`);
  await expect(returnPage.getByText(title)).toBeVisible();
  await expect(returnPage.getByRole('button', { name: '退回' })).toBeVisible();
  await returnPage.getByRole('button', { name: '退回' }).click();
  await expect(
    returnPage.getByRole('heading', { name: '退回簽核' }),
  ).toBeVisible();
  await returnPage
    .getByPlaceholder('可補充需要修改的內容')
    .fill('Matrix E2E 退回後重新送出驗證');
  await returnPage.getByRole('button', { name: '送出退回' }).click();

  await expect
    .poll(
      async (): Promise<string> => {
        const data = await requestGraphQl<ApprovalInstanceData>(
          returnPage,
          `query MatrixReturnedInstance($id: String!) {
            approvalInstance(id: $id) {
              formDataJson
              id
              state
              title
            }
          }`,
          { id: instanceId },
        );

        return data.approvalInstance.state;
      },
      { timeout: 15_000 },
    )
    .toBe('RETURNED');

  await returnPage.context().close();

  return { id: instanceId, title };
}

async function approveCandidateTask(
  browser: Browser,
  {
    instanceId,
    memberId,
    title,
  }: {
    readonly instanceId: string;
    readonly memberId: string;
    readonly title: string;
  },
): Promise<void> {
  const page = await createAuthenticatedPage(browser, memberId);

  await page.goto('/inbox');
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await Promise.all([
    page.waitForURL(`**/instances/${instanceId}`),
    page
      .getByRole('row')
      .filter({ hasText: title })
      .getByRole('button', { name: '處理' })
      .click(),
  ]);
  await page.getByRole('button', { name: '同意' }).click();
  await expect(page.getByRole('heading', { name: '簽核意見' })).toBeVisible();
  await page.getByRole('button', { name: '送出同意' }).click();
  await expect(page.getByText(title)).toBeVisible();
  await page.context().close();
}

async function cancelInstance(
  browser: Browser,
  {
    instanceId,
    memberId,
    title,
  }: {
    readonly instanceId: string;
    readonly memberId: string;
    readonly title: string;
  },
): Promise<void> {
  const page = await createAuthenticatedPage(browser, memberId);

  await page.goto(`/instances/${instanceId}`);
  await expect(page.getByText(title)).toBeVisible();
  await page.getByRole('button', { name: '取消案件' }).click();
  await page.getByPlaceholder('可填寫取消原因').fill('Matrix E2E 取消驗證');
  await page.getByRole('button', { name: '確認取消' }).click();
  await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible();
  await page.context().close();
}

async function readInstanceVerification(
  page: Page,
  instanceId: string,
): Promise<ApprovalInstanceVerificationData> {
  const data = await requestGraphQl<ApprovalInstanceVerificationData>(
    page,
    `query MatrixInstanceVerification($instanceId: String!) {
      approvalInstance(id: $instanceId) {
        formDataJson
        id
        state
        title
      }
      activityLogs(instanceId: $instanceId) {
        eventType
        payloadJson
      }
      tasks(instanceId: $instanceId) {
        assigneeMemberId
        candidateMemberIds
        id
        nodeId
        status
      }
      taskCandidates(taskId: "") {
        memberId
        status
      }
    }`,
    { instanceId },
  ).catch(async (): Promise<ApprovalInstanceVerificationData> => {
    const taskData = await requestGraphQl<
      Omit<ApprovalInstanceVerificationData, 'taskCandidates'>
    >(
      page,
      `query MatrixInstanceWithoutCandidates($instanceId: String!) {
        approvalInstance(id: $instanceId) {
          formDataJson
          id
          state
          title
        }
        activityLogs(instanceId: $instanceId) {
          eventType
          payloadJson
        }
        tasks(instanceId: $instanceId) {
          assigneeMemberId
          candidateMemberIds
          id
          nodeId
          status
        }
      }`,
      { instanceId },
    );
    const task = taskData.tasks[0];
    const candidateData = task
      ? await requestGraphQl<{
          readonly taskCandidates: ApprovalInstanceVerificationData['taskCandidates'];
        }>(
          page,
          `query MatrixTaskCandidates($taskId: String!) {
            taskCandidates(taskId: $taskId) {
              memberId
              status
            }
          }`,
          { taskId: task.id },
        )
      : { taskCandidates: [] };

    return {
      ...taskData,
      taskCandidates: candidateData.taskCandidates,
    };
  });

  await page.context().close();

  return data;
}

async function verifyReturnedSeedResubmitWarning(
  browser: Browser,
): Promise<void> {
  const returnedInstance = await createReturnedInstance(
    browser,
    `warning-${Date.now()}`,
  );
  const page = await createAuthenticatedPage(browser, 'member-303');

  await page.goto(`/instances/${returnedInstance.id}`);
  await expect(
    page.getByRole('heading', { name: returnedInstance.title }),
  ).toBeVisible();
  await expect(page.getByText('已退回', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新送出' })).toBeVisible();
  await page.context().close();
}

async function verifyTemplateCategoryCrud(
  browser: Browser,
  runId: string,
): Promise<void> {
  const page = await createAuthenticatedPage(browser, 'member-001');
  const categoryName = `Matrix 分類 ${runId}`;
  const updatedCategoryName = `${categoryName} 更新`;

  await page.goto('/templates/categories');
  await expect(
    page.getByRole('heading', { name: '簽核模板分類' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '建立分類' }).click();
  await page.getByPlaceholder('例如：行政管理').fill(categoryName);
  await page.getByPlaceholder('0').fill('77');
  await page.getByPlaceholder('補充分類用途').fill('Matrix UI CRUD 驗證');
  await page.getByRole('button', { exact: true, name: '建立' }).click();
  await page.getByPlaceholder('關鍵字：搜尋分類名稱或說明').fill(categoryName);
  await expect(
    page.getByRole('row').filter({ hasText: categoryName }),
  ).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: categoryName })
    .getByRole('button', { name: '編輯' })
    .click();
  await page.getByPlaceholder('例如：行政管理').fill(updatedCategoryName);
  await page.getByPlaceholder('補充分類用途').fill('Matrix UI CRUD 更新驗證');
  await page.getByRole('button', { exact: true, name: '儲存' }).click();
  await page
    .getByPlaceholder('關鍵字：搜尋分類名稱或說明')
    .fill(updatedCategoryName);
  await expect(
    page.getByRole('row').filter({ hasText: updatedCategoryName }),
  ).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: updatedCategoryName })
    .getByRole('button', { name: '停用' })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: updatedCategoryName })
      .getByText('停用'),
  ).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: updatedCategoryName })
    .getByRole('button', { name: '刪除' })
    .click();
  await expect(page.getByRole('heading', { name: '刪除分類' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '刪除' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: updatedCategoryName }),
  ).toBeHidden();

  const categoryData = await requestGraphQl<ApprovalTemplateCategoryData>(
    page,
    `query MatrixCategoryDeleted($searchText: String!) {
      approvalTemplateCategories(searchText: $searchText, status: ALL) {
        description
        id
        isActive
        name
        sortOrder
      }
    }`,
    { searchText: updatedCategoryName },
  );

  expect(categoryData.approvalTemplateCategories).toContainEqual(
    expect.objectContaining({
      isActive: false,
      name: updatedCategoryName,
      sortOrder: 77,
    }),
  );
  await page.context().close();
}

async function readNotificationPages(
  page: Page,
  recipientMemberId: string,
  targetNotificationId: string,
  pageNumber = 1,
  collected: readonly NotificationSummary[] = [],
): Promise<readonly NotificationSummary[]> {
  const pageSize = 100;
  const pageData = await requestGraphQl<NotificationPageData>(
    page,
    `query MatrixNotificationPage(
      $recipientMemberId: String!
      $page: Int!
      $pageSize: Int!
    ) {
      notifications(
        recipientMemberId: $recipientMemberId
        includeRead: true
        page: $page
        pageSize: $pageSize
      ) {
        id
        status
        title
      }
      notificationCount(
        recipientMemberId: $recipientMemberId
        includeRead: true
      )
    }`,
    { page: pageNumber, pageSize, recipientMemberId },
  );
  const nextNotifications = [...collected, ...pageData.notifications];
  const isTargetLoaded = nextNotifications.some(
    (notification): boolean => notification.id === targetNotificationId,
  );
  const isLastPage =
    pageData.notifications.length < pageSize ||
    pageNumber * pageSize >= pageData.notificationCount;

  if (isTargetLoaded || isLastPage) {
    return nextNotifications;
  }

  return readNotificationPages(
    page,
    recipientMemberId,
    targetNotificationId,
    pageNumber + 1,
    nextNotifications,
  );
}

async function verifyNotificationReadAndPreference(
  browser: Browser,
): Promise<void> {
  const page = await createAuthenticatedPage(browser, 'member-101');

  const seededNotificationId = '70000000-0000-4000-8000-000000000001';
  const initialNotifications = await readNotificationPages(
    page,
    'member-101',
    seededNotificationId,
  );
  const seededNotification = initialNotifications.find(
    (notification): boolean => notification.id === seededNotificationId,
  );

  expect(seededNotification).toEqual(
    expect.objectContaining({
      id: seededNotificationId,
      title: '待簽核：供應商請款',
    }),
  );

  if (seededNotification?.status !== 'READ') {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /^通知中心/ }).click();
    const notificationCard = page
      .getByRole('button')
      .filter({
        has: page.getByText('待簽核：供應商請款', { exact: true }),
      })
      .first();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await notificationCard.isVisible()) {
        break;
      }

      const loadMoreButton = page.getByRole('button', { name: '載入更多' });
      if (
        (await loadMoreButton.count()) === 0 ||
        !(await loadMoreButton.first().isEnabled())
      ) {
        break;
      }

      await loadMoreButton.first().click();
    }

    await expect(notificationCard).toBeVisible();
    await notificationCard.locator('button').click();
    await page.getByRole('button', { name: '標為已讀' }).click();
  }

  await page.goto('/settings/notifications');
  await expect(
    page.locator('input[name="emailDigestMode"][value="DAILY"]'),
  ).toBeEnabled();
  await page
    .locator('input[name="emailDigestMode"][value="DAILY"]')
    .check({ force: true });
  await expect(
    page.locator('input[name="emailEnabled"][value="OFF"]'),
  ).toBeEnabled();
  await page
    .locator('input[name="emailEnabled"][value="OFF"]')
    .check({ force: true });
  await expect(
    page.locator('input[name="emailEnabled"][value="OFF"]'),
  ).toBeEnabled();

  const notificationData = await requestGraphQl<NotificationData>(
    page,
    `query MatrixNotificationPreference {
      notifications(
        recipientMemberId: "member-101"
        includeRead: true
        page: 1
        pageSize: 100
      ) {
        id
        status
        title
      }
      notificationPreference(memberId: "member-101") {
        emailDigestMode
        emailEnabled
        inAppEnabled
        memberId
      }
      unreadNotificationCount(recipientMemberId: "member-101")
    }`,
  );

  const finalNotifications = await readNotificationPages(
    page,
    'member-101',
    seededNotificationId,
  );
  expect(finalNotifications).toContainEqual(
    expect.objectContaining({
      id: seededNotificationId,
      status: 'READ',
      title: '待簽核：供應商請款',
    }),
  );
  expect(notificationData.notificationPreference).toMatchObject({
    emailDigestMode: 'DAILY',
    emailEnabled: false,
    inAppEnabled: true,
    memberId: 'member-101',
  });
  expect(notificationData.unreadNotificationCount).toBeGreaterThanOrEqual(0);
  await page.context().close();
}

async function verifyDelegationCreateAndRevoke(
  browser: Browser,
): Promise<void> {
  const page = await createAuthenticatedPage(browser, 'member-102');

  await page.goto('/delegations');
  await expect(page.getByRole('heading', { name: '我的代理' })).toBeVisible();
  await revokeExistingActiveDelegations(page);
  await page.getByRole('button', { name: '建立代理' }).click();
  await page.getByPlaceholder('搜尋姓名或信箱').fill('member-103');
  await page
    .getByRole('option', { name: '李成本會計 (li.fpna@example.internal)' })
    .click();
  await page.getByRole('heading', { name: '建立個人代理' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '建立代理' }),
  ).toBeEnabled();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '建立代理' })
    .click();
  const activeDelegationRow = page
    .getByRole('row')
    .filter({ hasText: '李成本會計' })
    .filter({ hasText: '啟用中' })
    .first();
  await expect(activeDelegationRow).toBeVisible();

  const activeRuleData = await requestGraphQl<DelegationRuleData>(
    page,
    `query MatrixActiveDelegation {
      delegationRules(
        principalMemberId: "member-102"
        agentMemberId: "member-103"
        includeInactive: true
        status: ACTIVE
      ) {
        agentMemberId
        id
        principalMemberId
        scopeType
        status
      }
    }`,
  );

  expect(activeRuleData.delegationRules).toContainEqual(
    expect.objectContaining({
      agentMemberId: 'member-103',
      principalMemberId: 'member-102',
      scopeType: 'ALL',
      status: 'ACTIVE',
    }),
  );

  await page
    .getByRole('row')
    .filter({ hasText: '李成本會計' })
    .filter({ hasText: '啟用中' })
    .first()
    .getByRole('button', { name: '撤銷' })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: '李成本會計' })
      .filter({ hasText: '已撤銷' })
      .first()
      .getByText('已撤銷'),
  ).toBeVisible();

  const revokedRuleData = await requestGraphQl<DelegationRuleData>(
    page,
    `query MatrixRevokedDelegation {
      delegationRules(
        principalMemberId: "member-102"
        agentMemberId: "member-103"
        includeInactive: true
        status: REVOKED
      ) {
        agentMemberId
        id
        principalMemberId
        scopeType
        status
      }
    }`,
  );

  expect(revokedRuleData.delegationRules).toContainEqual(
    expect.objectContaining({
      agentMemberId: 'member-103',
      principalMemberId: 'member-102',
      scopeType: 'ALL',
      status: 'REVOKED',
    }),
  );
  await page.context().close();
}

async function revokeExistingActiveDelegations(page: Page): Promise<void> {
  const activeRuleData = await requestGraphQl<DelegationRuleData>(
    page,
    `query MatrixExistingActiveDelegations {
      delegationRules(
        principalMemberId: "member-102"
        agentMemberId: "member-103"
        includeInactive: true
        status: ACTIVE
      ) {
        agentMemberId
        id
        principalMemberId
        scopeType
        status
      }
    }`,
  );

  for (const rule of activeRuleData.delegationRules) {
    const row = page.locator(`tr[data-row-key="${rule.id}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '撤銷' }).click();
    await expect(row.getByText('已撤銷')).toBeVisible();
  }
}

async function verifyReturnedSeedResubmit(browser: Browser): Promise<void> {
  const returnedInstance = await createReturnedInstance(
    browser,
    `resubmit-${Date.now()}`,
  );
  const page = await createAuthenticatedPage(browser, 'member-303');

  await page.goto(`/instances/${returnedInstance.id}`);
  await expect(
    page.getByRole('heading', { name: returnedInstance.title }),
  ).toBeVisible();
  await expect(page.getByText('已退回', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新送出' }).click();
  await expect(page.getByText('進行中')).toBeVisible();

  const instanceData = await readInstanceVerification(
    page,
    returnedInstance.id,
  );

  expect(instanceData.approvalInstance.state).toBe('RUNNING');
  expect(
    instanceData.activityLogs.some(
      (log) => log.eventType === 'INSTANCE_RESUBMITTED',
    ),
  ).toBe(true);
}

function readDraftVersion(versions: readonly VersionRecord[]): VersionRecord {
  const draft = versions.find((version) => version.status === 'DRAFT');

  if (!draft) {
    throw new Error('Created record does not have a draft version');
  }

  return draft;
}

function createCandidateWorkflow(): Readonly<Record<string, unknown>> {
  return createSingleApprovalWorkflow(['member-101', 'member-201']);
}

function createSingleApprovalWorkflow(
  memberIds: readonly string[] | string,
): Readonly<Record<string, unknown>> {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_review',
        source: 'start',
        target: 'task_review',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_review_end',
        source: 'task_review',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      userTaskNode(
        'task_review',
        '簽核',
        {
          memberIds: Array.isArray(memberIds) ? memberIds : [memberIds],
          type: 'DIRECT',
        },
        320,
        160,
      ),
      endNode(),
    ],
  };
}

function createReturnableWorkflow(): Readonly<Record<string, unknown>> {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_first',
        source: 'start',
        target: 'task_first',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_first_second',
        source: 'task_first',
        target: 'task_second',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_second_end',
        source: 'task_second',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      userTaskNode(
        'task_first',
        '第一關簽核',
        { memberIds: ['member-101'], type: 'DIRECT' },
        320,
        160,
      ),
      userTaskNode(
        'task_second',
        '第二關簽核',
        { memberIds: ['member-201'], type: 'DIRECT' },
        520,
        160,
        {
          allowReturn: true,
          allowedTargets: 'INITIATOR',
          resubmitStrategy: 'RESTART',
        },
      ),
      endNode(),
    ],
  };
}

function createNotifyServiceTaskWorkflow(): Readonly<Record<string, unknown>> {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_end',
        source: 'start',
        target: 'end',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_start_notify',
        source: 'start',
        target: 'notify_finance',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: {
              memberIds: ['member-101', 'member-001'],
              type: 'DIRECT',
            },
            template: 'Matrix E2E 通知 {{instanceTitle}}。',
            type: 'NOTIFY',
          },
          label: '財務知會',
        },
        id: 'notify_finance',
        position: { x: 300, y: 260 },
        type: 'serviceTask',
      },
      endNode(),
    ],
  };
}

function createSetFormFieldServiceTaskWorkflow(): Readonly<
  Record<string, unknown>
> {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_set_field',
        source: 'start',
        target: 'set_approval_level',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_set_field_end',
        source: 'set_approval_level',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      {
        data: {
          action: {
            fieldPath: 'form.approvalLevel',
            type: 'SET_FORM_FIELD',
            value: '"主管簽核"',
          },
          label: '設定簽核層級',
        },
        id: 'set_approval_level',
        position: { x: 300, y: 160 },
        type: 'serviceTask',
      },
      endNode(),
    ],
  };
}

function createWebhookServiceTaskWorkflow(): Readonly<Record<string, unknown>> {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_webhook',
        source: 'start',
        target: 'webhook_erp',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_webhook_end',
        source: 'webhook_erp',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      {
        data: {
          action: {
            type: 'WEBHOOK',
            url: 'http://localhost:17603/health',
          },
          label: '同步 ERP',
        },
        id: 'webhook_erp',
        position: { x: 300, y: 160 },
        type: 'serviceTask',
      },
      endNode(),
    ],
  };
}

function userTaskNode(
  id: string,
  label: string,
  resolver: Readonly<Record<string, unknown>>,
  x: number,
  y: number,
  returnBehavior: Readonly<Record<string, unknown>> = {
    allowReturn: true,
    allowedTargets: 'PREVIOUS',
    resubmitStrategy: 'RESTART',
  },
): Readonly<Record<string, unknown>> {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: resolver,
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior,
      triggerMode: 'AND',
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function startNode(): Readonly<Record<string, unknown>> {
  return {
    data: { label: '開始' },
    id: 'start',
    position: { x: 80, y: 160 },
    type: 'startEvent',
  };
}

function endNode(): Readonly<Record<string, unknown>> {
  return {
    data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
    id: 'end',
    position: { x: 560, y: 160 },
    type: 'endEvent',
  };
}

function readInstanceIdFromUrl(url: string): string {
  const instanceId = new URL(url).pathname.split('/').filter(Boolean).at(-1);

  if (!instanceId || instanceId === 'new') {
    throw new Error(`Cannot read approval instance id from URL: ${url}`);
  }

  return instanceId;
}

function isInstanceDetailUrl(url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean);

  return (
    parts.length === 2 &&
    parts[0] === 'instances' &&
    Boolean(parts[1]) &&
    parts[1] !== 'new'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}
