import { Browser, expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

type ResolverInput = Readonly<Record<string, unknown>>;
type WorkflowDefinitionInput = Readonly<Record<string, unknown>>;

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

interface FormDefinitionRecord {
  readonly id: string;
}

interface VersionRecord {
  readonly id: string;
  readonly status: string;
  readonly version: number;
}

interface ApprovalTemplateRecord {
  readonly id: string;
}

interface TaskRecord {
  readonly assigneeMemberId: string | null;
  readonly candidateMemberIds?: readonly string[];
  readonly createdAt: string;
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
}

interface ApprovalInstanceRecord {
  readonly id: string;
  readonly state: string;
  readonly title: string;
}

interface CreateFormDefinitionData {
  readonly createFormDefinition: FormDefinitionRecord;
}

interface FormDefinitionVersionsData {
  readonly formDefinitionVersions: readonly VersionRecord[];
}

interface PublishFormDefinitionVersionData {
  readonly publishFormDefinitionVersion: VersionRecord;
}

interface CreateApprovalTemplateData {
  readonly createApprovalTemplate: ApprovalTemplateRecord;
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

interface ApprovalInstanceVerificationData {
  readonly approvalInstance: ApprovalInstanceRecord;
  readonly tasks: readonly TaskRecord[];
}

interface OrgUnitRecord {
  readonly id: string;
}

interface PositionRecord {
  readonly id: string;
}

interface CreateOrgUnitData {
  readonly createOrgUnit: OrgUnitRecord;
}

interface CreatePositionData {
  readonly createPosition: PositionRecord;
}

interface CreateMembershipData {
  readonly createMembership: { readonly id: string };
}

interface CreateManagerResolutionData {
  readonly createManagerResolution: { readonly id: string };
}

interface OrganizationFixture {
  readonly apOrgUnitId: string;
  readonly apSpecialistPositionId: string;
  readonly hqOrgUnitId: string;
}

interface ExpectedTask {
  readonly assigneeMemberId: string;
  readonly nodeId: string;
  readonly status: string;
}

interface VerificationExpectation {
  readonly absentNodeIds?: readonly string[];
  readonly state: string;
  readonly tasks: readonly ExpectedTask[];
}

interface VerificationSnapshot {
  readonly absent: readonly {
    readonly nodeId: string;
    readonly present: boolean;
  }[];
  readonly state: string;
  readonly tasks: readonly ExpectedTask[];
}

interface ApprovalStep {
  readonly action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  readonly approverMemberId: string;
  readonly approverName: string;
  readonly comment?: string;
  readonly expectation: VerificationExpectation;
  readonly nodeId: string;
}

interface WorkflowExecutionScenario {
  readonly amount: number;
  readonly expectationAfterSubmit: VerificationExpectation;
  readonly initiatorMemberId: string;
  readonly initiatorName: string;
  readonly steps: readonly ApprovalStep[];
  readonly title: string;
  readonly workflowDefinition: WorkflowDefinitionInput;
}

interface WorkflowFailureScenario {
  readonly amount: number;
  readonly expectedErrorText: string;
  readonly initiatorMemberId: string;
  readonly initiatorName: string;
  readonly title: string;
  readonly workflowDefinition: WorkflowDefinitionInput;
}

interface PublishedTemplate {
  readonly id: string;
  readonly name: string;
}

const GRAPHQL_URL =
  process.env.E2E_GRAPHQL_URL ?? 'http://localhost:17603/graphql';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const ADMIN_MEMBER_ID = 'member-001';

test.describe('workflow organization resolver real execution', () => {
  test('exhaustively creates templates and executes real approval paths', async ({
    browser,
  }): Promise<void> => {
    test.setTimeout(360_000);

    const runId = `org-${Date.now()}`;
    const adminPage = await createAuthenticatedPage(browser, ADMIN_MEMBER_ID);
    const organizationFixture = await createOrganizationFixture(
      adminPage,
      runId,
    );
    const formVersionId = await createPublishedFormVersion(adminPage, runId);
    const executionScenarios = readExecutionScenarios(organizationFixture);
    const failureScenarios = readFailureScenarios();
    const publishedExecutionTemplates = await Promise.all(
      executionScenarios.map((scenario) =>
        createPublishedTemplate(adminPage, {
          formVersionId,
          runId,
          scenario,
        }),
      ),
    );
    const publishedFailureTemplates = await Promise.all(
      failureScenarios.map((scenario) =>
        createPublishedTemplate(adminPage, {
          formVersionId,
          runId,
          scenario,
        }),
      ),
    );

    await adminPage.context().close();

    for (const [index, scenario] of executionScenarios.entries()) {
      const template = readTemplateAt(publishedExecutionTemplates, index);

      await executeApprovalScenario(browser, { runId, scenario, template });
    }

    for (const [index, scenario] of failureScenarios.entries()) {
      const template = readTemplateAt(publishedFailureTemplates, index);

      await executeFailureScenario(browser, { runId, scenario, template });
    }
  });
});

function readExecutionScenarios(
  fixture: OrganizationFixture,
): readonly WorkflowExecutionScenario[] {
  return [
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-101',
      approverName: '陳財務經理',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      resolver: directResolver('member-101'),
      title: '直接指定會員',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-101',
      approverName: '陳財務經理',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      resolver: {
        baseFromInitiator: true,
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      title: '發起人直屬主管',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-001',
      approverName: '林總經理',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      resolver: {
        baseFromInitiator: true,
        levelsUp: 2,
        type: 'ORG_MANAGER',
      },
      title: '發起人第二層主管',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-001',
      approverName: '林總經理',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      resolver: {
        baseFromInitiator: true,
        fallback: {
          memberId: 'member-201',
          type: 'DIRECT',
        },
        levelsUp: 3,
        type: 'ORG_MANAGER',
      },
      title: '發起人主管固定改派',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-101',
      approverName: '陳財務經理',
      initiatorMemberId: 'member-103',
      initiatorName: '李成本會計',
      resolver: {
        orgUnitId: fixture.apOrgUnitId,
        type: 'ORG_UNIT_MANAGER',
      },
      title: '指定組織主管',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-201',
      approverName: '黃人資主管',
      initiatorMemberId: 'member-103',
      initiatorName: '李成本會計',
      resolver: {
        fallback: {
          memberId: 'member-201',
          type: 'DIRECT',
        },
        orgUnitId: fixture.hqOrgUnitId,
        type: 'ORG_UNIT_MANAGER',
      },
      title: '指定組織主管固定改派',
    }),
    createSingleApprovalScenario({
      amount: 100,
      approverMemberId: 'member-102',
      approverName: '吳採購專員',
      initiatorMemberId: 'member-101',
      initiatorName: '陳財務經理',
      resolver: {
        positionId: fixture.apSpecialistPositionId,
        type: 'POSITION',
      },
      title: '指定職位',
    }),
    createBranchScenario({
      amount: 2_000,
      expectedNodeId: 'task_high',
      expectedSkippedNodeId: 'task_default',
      expectedApproverMemberId: 'member-101',
      expectedApproverName: '陳財務經理',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      title: '條件分流高額路徑',
    }),
    createBranchScenario({
      amount: 500,
      expectedNodeId: 'task_default',
      expectedSkippedNodeId: 'task_high',
      expectedApproverMemberId: 'member-201',
      expectedApproverName: '黃人資主管',
      initiatorMemberId: 'member-102',
      initiatorName: '吳採購專員',
      title: '條件分流預設路徑',
    }),
    createSequentialApprovalScenario(),
    createRejectScenario(),
    createReturnToPreviousScenario(),
    createParallelAndScenario(),
    createParallelOrScenario(),
  ];
}

function readFailureScenarios(): readonly WorkflowFailureScenario[] {
  return [];
}

async function executeApprovalScenario(
  browser: Browser,
  {
    runId,
    scenario,
    template,
  }: {
    readonly runId: string;
    readonly scenario: WorkflowExecutionScenario;
    readonly template: PublishedTemplate;
  },
): Promise<void> {
  const caseTitle = `${scenario.title} ${runId}`;
  const initiatorPage = await createAuthenticatedPage(
    browser,
    scenario.initiatorMemberId,
  );

  await expect(initiatorPage.getByText(scenario.initiatorName)).toBeVisible();
  await submitCase(initiatorPage, {
    amount: scenario.amount,
    caseTitle,
    templateId: template.id,
  });

  const instanceId = readInstanceIdFromUrl(initiatorPage.url());

  await expect(initiatorPage.getByText('進行中')).toBeVisible();
  await expect(initiatorPage.getByText(caseTitle)).toBeVisible();
  await verifyInstance(initiatorPage, {
    expectation: scenario.expectationAfterSubmit,
    instanceId,
  });
  await initiatorPage.context().close();

  for (const step of scenario.steps) {
    await completeStep(browser, {
      caseTitle,
      instanceId,
      step,
    });
  }
}

async function executeFailureScenario(
  browser: Browser,
  {
    runId,
    scenario,
    template,
  }: {
    readonly runId: string;
    readonly scenario: WorkflowFailureScenario;
    readonly template: PublishedTemplate;
  },
): Promise<void> {
  const caseTitle = `${scenario.title} ${runId}`;
  const initiatorPage = await createAuthenticatedPage(
    browser,
    scenario.initiatorMemberId,
  );

  await expect(initiatorPage.getByText(scenario.initiatorName)).toBeVisible();
  await initiatorPage.goto(`/instances/new?templateId=${template.id}`);
  await fillLaunchForm(initiatorPage, {
    amount: scenario.amount,
    caseTitle,
  });
  await initiatorPage.getByRole('button', { name: '送出' }).click();
  await expect(
    initiatorPage.getByText(scenario.expectedErrorText),
  ).toBeVisible();
  expect(new URL(initiatorPage.url()).pathname).toBe('/instances/new');
  await initiatorPage.context().close();
}

async function submitCase(
  page: Page,
  {
    amount,
    caseTitle,
    templateId,
  }: {
    readonly amount: number;
    readonly caseTitle: string;
    readonly templateId: string;
  },
): Promise<void> {
  await page.goto(`/instances/new?templateId=${templateId}`);
  await fillLaunchForm(page, { amount, caseTitle });
  await Promise.all([
    page.waitForURL(isInstanceDetailUrl, { timeout: 30_000 }),
    page.getByRole('button', { name: '送出' }).click(),
  ]);
}

async function fillLaunchForm(
  page: Page,
  {
    amount,
    caseTitle,
  }: {
    readonly amount: number;
    readonly caseTitle: string;
  },
): Promise<void> {
  await page.getByPlaceholder('請輸入申請主旨').fill(caseTitle);
  await page.getByPlaceholder('請輸入金額').fill(String(amount));
}

async function completeStep(
  browser: Browser,
  {
    caseTitle,
    instanceId,
    step,
  }: {
    readonly caseTitle: string;
    readonly instanceId: string;
    readonly step: ApprovalStep;
  },
): Promise<void> {
  const approverPage = await createAuthenticatedPage(
    browser,
    step.approverMemberId,
  );

  await expect(approverPage.getByText(step.approverName)).toBeVisible();
  await approverPage.goto('/inbox');

  const inboxRow = approverPage
    .getByRole('row')
    .filter({ hasText: caseTitle })
    .first();

  await expect(inboxRow).toBeVisible();
  await Promise.all([
    approverPage.waitForURL(`**/instances/${instanceId}`, {
      timeout: 30_000,
    }),
    inboxRow.getByRole('button', { exact: true, name: '處理' }).click(),
  ]);
  await expect(
    approverPage.getByRole('button', { name: '同意' }),
  ).toBeVisible();

  if (step.action === 'REJECTED') {
    const rejectComment = step.comment ?? 'E2E 拒絕原因';
    const rejectReasonInput = approverPage.getByPlaceholder('請說明拒絕原因');
    const rejectConfirmButton = approverPage.getByRole('button', {
      name: '送出拒絕',
    });

    await approverPage.getByRole('button', { name: '拒絕' }).click();
    await rejectReasonInput.click();
    await rejectReasonInput.fill('');
    await rejectReasonInput.pressSequentially(rejectComment);
    await expect(rejectReasonInput).toHaveValue(rejectComment);
    await expect(rejectConfirmButton).toBeEnabled();
    await rejectConfirmButton.click();
  } else if (step.action === 'RETURNED') {
    await approverPage.getByRole('button', { name: '退回' }).click();
    await approverPage
      .getByPlaceholder('可補充需要修改的內容')
      .fill(step.comment ?? 'E2E 退回說明');
    await approverPage.getByRole('button', { name: '送出退回' }).click();
  } else {
    await approverPage.getByRole('button', { name: '同意' }).click();
    await expect(
      approverPage.getByRole('heading', { name: '簽核意見' }),
    ).toBeVisible();
    await approverPage.getByRole('button', { name: '送出同意' }).click();
  }

  await expect(
    approverPage
      .getByText(readDecisionLabel(step.action), { exact: true })
      .last(),
  ).toBeVisible();

  await verifyInstance(approverPage, {
    expectation: step.expectation,
    instanceId,
  });

  await approverPage.context().close();
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

async function createOrganizationFixture(
  page: Page,
  runId: string,
): Promise<OrganizationFixture> {
  const hq = await createOrgUnit(page, {
    code: `E2E-HQ-${runId}`,
    name: `E2E 總部 ${runId}`,
    parentId: null,
    type: 'COMPANY',
  });
  const finance = await createOrgUnit(page, {
    code: `E2E-FIN-${runId}`,
    name: `E2E 財務部 ${runId}`,
    parentId: hq.id,
    type: 'DEPARTMENT',
  });
  const ap = await createOrgUnit(page, {
    code: `E2E-AP-${runId}`,
    name: `E2E 應付組 ${runId}`,
    parentId: finance.id,
    type: 'TEAM',
  });
  const apSpecialist = await createPosition(page, {
    code: `E2E-AP-SPECIALIST-${runId}`,
    level: 40,
    name: `E2E 應付專員 ${runId}`,
  });

  await Promise.all([
    createMembership(page, {
      memberId: 'member-001',
      orgUnitId: hq.id,
      positionId: null,
    }),
    createMembership(page, {
      memberId: 'member-101',
      orgUnitId: finance.id,
      positionId: null,
    }),
    createMembership(page, {
      memberId: 'member-102',
      orgUnitId: ap.id,
      positionId: apSpecialist.id,
    }),
    createMembership(page, {
      memberId: 'member-103',
      orgUnitId: ap.id,
      positionId: null,
    }),
  ]);
  await Promise.all([
    createManagerResolution(page, {
      managerMemberId: 'member-101',
      priority: 10_000,
      scopeId: ap.id,
      scopeType: 'ORG_UNIT',
    }),
    createManagerResolution(page, {
      managerMemberId: 'member-001',
      priority: 9_990,
      scopeId: finance.id,
      scopeType: 'ORG_UNIT',
    }),
  ]);

  return {
    apOrgUnitId: ap.id,
    apSpecialistPositionId: apSpecialist.id,
    hqOrgUnitId: hq.id,
  };
}

async function createOrgUnit(
  page: Page,
  input: Readonly<{
    code: string;
    name: string;
    parentId: string | null;
    type: string;
  }>,
): Promise<OrgUnitRecord> {
  const data = await requestGraphQl<CreateOrgUnitData>(
    page,
    `mutation CreateE2EOrgUnit($input: CreateOrgUnitInput!) {
      createOrgUnit(input: $input) {
        id
      }
    }`,
    { input: { ...input, metadataJson: '{}' } },
  );

  return data.createOrgUnit;
}

async function createPosition(
  page: Page,
  input: Readonly<{ code: string; level: number; name: string }>,
): Promise<PositionRecord> {
  const data = await requestGraphQl<CreatePositionData>(
    page,
    `mutation CreateE2EPosition($input: CreatePositionInput!) {
      createPosition(input: $input) {
        id
      }
    }`,
    { input: { ...input, metadataJson: '{}' } },
  );

  return data.createPosition;
}

async function createMembership(
  page: Page,
  input: Readonly<{
    memberId: string;
    orgUnitId: string;
    positionId: string | null;
  }>,
): Promise<void> {
  await requestGraphQl<CreateMembershipData>(
    page,
    `mutation CreateE2EMembership($input: CreateMembershipInput!) {
      createMembership(input: $input) {
        id
      }
    }`,
    {
      input: {
        ...input,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isPrimary: true,
      },
    },
  );
}

async function createManagerResolution(
  page: Page,
  input: Readonly<{
    managerMemberId: string;
    priority: number;
    scopeId: string;
    scopeType: string;
  }>,
): Promise<void> {
  await requestGraphQl<CreateManagerResolutionData>(
    page,
    `mutation CreateE2EManagerResolution(
      $input: CreateManagerResolutionInput!
    ) {
      createManagerResolution(input: $input) {
        id
      }
    }`,
    {
      input: {
        ...input,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    },
  );
}

async function createPublishedFormVersion(
  page: Page,
  runId: string,
): Promise<string> {
  const formDefinition = await requestGraphQl<CreateFormDefinitionData>(
    page,
    `mutation CreateE2EForm($input: CreateFormDefinitionInput!) {
      createFormDefinition(input: $input) {
        id
      }
    }`,
    {
      input: {
        createdByMemberId: ADMIN_MEMBER_ID,
        description: 'E2E real workflow matrix form',
        name: `E2E 流程矩陣表單 ${runId}`,
        schemaJson: JSON.stringify(readFormSchema()),
        uiSchemaJson: JSON.stringify(readFormUiSchema()),
      },
    },
  );
  const versions = await requestGraphQl<FormDefinitionVersionsData>(
    page,
    `query E2EFormVersions($formDefinitionId: String!) {
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
    `mutation PublishE2EForm($versionId: String!, $publishedByMemberId: String) {
      publishFormDefinitionVersion(
        versionId: $versionId
        publishedByMemberId: $publishedByMemberId
      ) {
        id
        status
        version
      }
    }`,
    { publishedByMemberId: ADMIN_MEMBER_ID, versionId: draft.id },
  );

  return published.publishFormDefinitionVersion.id;
}

async function createPublishedTemplate(
  page: Page,
  {
    formVersionId,
    runId,
    scenario,
  }: {
    readonly formVersionId: string;
    readonly runId: string;
    readonly scenario: WorkflowExecutionScenario | WorkflowFailureScenario;
  },
): Promise<PublishedTemplate> {
  const name = `E2E ${scenario.title} ${runId}`;
  const template = await requestGraphQl<CreateApprovalTemplateData>(
    page,
    `mutation CreateE2ETemplate($input: CreateApprovalTemplateInput!) {
      createApprovalTemplate(input: $input) {
        id
      }
    }`,
    {
      input: {
        category: 'E2E',
        createdByMemberId: ADMIN_MEMBER_ID,
        description: `E2E workflow matrix scenario: ${scenario.title}`,
        formDefinitionVersionId: formVersionId,
        name,
      },
    },
  );
  const versions = await requestGraphQl<ApprovalTemplateVersionsData>(
    page,
    `query E2ETemplateVersions($templateId: String!) {
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
    `mutation UpdateE2ETemplateDraft($input: UpdateApprovalTemplateDraftInput!) {
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
        workflowDefinitionJson: JSON.stringify(scenario.workflowDefinition),
      },
    },
  );

  await requestGraphQl<PublishApprovalTemplateVersionData>(
    page,
    `mutation PublishE2ETemplate(
      $versionId: String!
      $publishedByMemberId: String
    ) {
      publishApprovalTemplateVersion(
        versionId: $versionId
        publishedByMemberId: $publishedByMemberId
      ) {
        id
        status
        version
      }
    }`,
    { publishedByMemberId: ADMIN_MEMBER_ID, versionId: draft.id },
  );

  return { id: template.createApprovalTemplate.id, name };
}

async function verifyInstance(
  page: Page,
  {
    expectation,
    instanceId,
  }: {
    readonly expectation: VerificationExpectation;
    readonly instanceId: string;
  },
): Promise<void> {
  await expect
    .poll(
      async (): Promise<VerificationSnapshot> =>
        readVerificationSnapshot(
          await readInstanceVerificationData(page, instanceId),
          expectation,
        ),
      { timeout: 15_000 },
    )
    .toEqual(readExpectedVerificationSnapshot(expectation));
}

async function readInstanceVerificationData(
  page: Page,
  instanceId: string,
): Promise<ApprovalInstanceVerificationData> {
  return requestGraphQl<ApprovalInstanceVerificationData>(
    page,
    `query VerifyE2EInstance($instanceId: String!) {
      approvalInstance(id: $instanceId) {
        id
        state
        title
      }
      tasks(instanceId: $instanceId) {
        assigneeMemberId
        candidateMemberIds
        createdAt
        id
        nodeId
        status
      }
    }`,
    { instanceId },
  );
}

function readVerificationSnapshot(
  data: ApprovalInstanceVerificationData,
  expectation: VerificationExpectation,
): VerificationSnapshot {
  return {
    absent: (expectation.absentNodeIds ?? []).map((nodeId) => ({
      nodeId,
      present: data.tasks.some((task) => task.nodeId === nodeId),
    })),
    state: data.approvalInstance.state,
    tasks: expectation.tasks.map((expectedTask) => {
      const actualTask = readLatestTaskForNode(data.tasks, expectedTask.nodeId);

      return {
        assigneeMemberId: readTaskAssigneeForExpectation(
          actualTask,
          expectedTask.assigneeMemberId,
        ),
        nodeId: expectedTask.nodeId,
        status: actualTask?.status ?? 'MISSING',
      };
    }),
  };
}

function readTaskAssigneeForExpectation(
  task: TaskRecord | null,
  expectedAssigneeMemberId: string,
): string {
  if (!task) {
    return 'MISSING';
  }

  if (task.assigneeMemberId) {
    return task.assigneeMemberId;
  }

  return task.candidateMemberIds?.includes(expectedAssigneeMemberId)
    ? expectedAssigneeMemberId
    : 'MISSING';
}

function readLatestTaskForNode(
  tasks: readonly TaskRecord[],
  nodeId: string,
): TaskRecord | null {
  return tasks
    .filter((task) => task.nodeId === nodeId)
    .reduce<TaskRecord | null>(
      (latestTask, task) =>
        !latestTask || task.createdAt > latestTask.createdAt
          ? task
          : latestTask,
      null,
    );
}

function readExpectedVerificationSnapshot(
  expectation: VerificationExpectation,
): VerificationSnapshot {
  return {
    absent: (expectation.absentNodeIds ?? []).map((nodeId) => ({
      nodeId,
      present: false,
    })),
    state: expectation.state,
    tasks: expectation.tasks,
  };
}

async function requestGraphQl<TData>(
  page: Page,
  query: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<TData> {
  const response = await page.context().request.post(GRAPHQL_URL, {
    data: { query, variables },
  });

  if (!response.ok()) {
    throw new Error(
      `GraphQL request failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as GraphQlResponse<TData>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
}

function createSingleApprovalScenario({
  amount,
  approverMemberId,
  approverName,
  initiatorMemberId,
  initiatorName,
  resolver,
  title,
}: {
  readonly amount: number;
  readonly approverMemberId: string;
  readonly approverName: string;
  readonly initiatorMemberId: string;
  readonly initiatorName: string;
  readonly resolver: ResolverInput;
  readonly title: string;
}): WorkflowExecutionScenario {
  return {
    amount,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        {
          assigneeMemberId: approverMemberId,
          nodeId: 'task_review',
          status: 'PENDING',
        },
      ],
    },
    initiatorMemberId,
    initiatorName,
    steps: [
      {
        action: 'APPROVED',
        approverMemberId,
        approverName,
        expectation: {
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: approverMemberId,
              nodeId: 'task_review',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_review',
      },
    ],
    title,
    workflowDefinition: createSingleApprovalWorkflow({ resolver, title }),
  };
}

function createBranchScenario({
  amount,
  expectedApproverMemberId,
  expectedApproverName,
  expectedNodeId,
  expectedSkippedNodeId,
  initiatorMemberId,
  initiatorName,
  title,
}: {
  readonly amount: number;
  readonly expectedApproverMemberId: string;
  readonly expectedApproverName: string;
  readonly expectedNodeId: string;
  readonly expectedSkippedNodeId: string;
  readonly initiatorMemberId: string;
  readonly initiatorName: string;
  readonly title: string;
}): WorkflowExecutionScenario {
  return {
    amount,
    expectationAfterSubmit: {
      absentNodeIds: [expectedSkippedNodeId],
      state: 'RUNNING',
      tasks: [
        {
          assigneeMemberId: expectedApproverMemberId,
          nodeId: expectedNodeId,
          status: 'PENDING',
        },
      ],
    },
    initiatorMemberId,
    initiatorName,
    steps: [
      {
        action: 'APPROVED',
        approverMemberId: expectedApproverMemberId,
        approverName: expectedApproverName,
        expectation: {
          absentNodeIds: [expectedSkippedNodeId],
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: expectedApproverMemberId,
              nodeId: expectedNodeId,
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: expectedNodeId,
      },
    ],
    title,
    workflowDefinition: createExclusiveGatewayWorkflow(),
  };
}

function createSequentialApprovalScenario(): WorkflowExecutionScenario {
  return {
    amount: 100,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        {
          assigneeMemberId: 'member-101',
          nodeId: 'task_first',
          status: 'PENDING',
        },
      ],
    },
    initiatorMemberId: 'member-102',
    initiatorName: '吳採購專員',
    steps: [
      {
        action: 'APPROVED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_first',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_first',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-201',
        approverName: '黃人資主管',
        expectation: {
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_second',
      },
    ],
    title: '連續兩關簽核',
    workflowDefinition: createSequentialApprovalWorkflow(),
  };
}

function createRejectScenario(): WorkflowExecutionScenario {
  return {
    amount: 100,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        {
          assigneeMemberId: 'member-101',
          nodeId: 'task_review',
          status: 'PENDING',
        },
      ],
    },
    initiatorMemberId: 'member-102',
    initiatorName: '吳採購專員',
    steps: [
      {
        action: 'REJECTED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        comment: 'E2E 驗證拒絕原因',
        expectation: {
          state: 'REJECTED',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_review',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_review',
      },
    ],
    title: '拒絕結束流程',
    workflowDefinition: createSingleApprovalWorkflow({
      resolver: directResolver('member-101'),
      title: '拒絕簽核',
    }),
  };
}

function createReturnToPreviousScenario(): WorkflowExecutionScenario {
  return {
    amount: 100,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        {
          assigneeMemberId: 'member-101',
          nodeId: 'task_first',
          status: 'PENDING',
        },
      ],
    },
    initiatorMemberId: 'member-102',
    initiatorName: '吳採購專員',
    steps: [
      {
        action: 'APPROVED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_first',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_first',
      },
      {
        action: 'RETURNED',
        approverMemberId: 'member-201',
        approverName: '黃人資主管',
        comment: 'E2E 退回上一關',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_first',
              status: 'PENDING',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_second',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_first',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_first',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-201',
        approverName: '黃人資主管',
        expectation: {
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_second',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_second',
      },
    ],
    title: '退回上一關再簽核',
    workflowDefinition: createReturnToPreviousWorkflow(),
  };
}

function createParallelAndScenario(): WorkflowExecutionScenario {
  return {
    amount: 100,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        { assigneeMemberId: 'member-101', nodeId: 'task_a', status: 'PENDING' },
        { assigneeMemberId: 'member-201', nodeId: 'task_b', status: 'PENDING' },
      ],
    },
    initiatorMemberId: 'member-102',
    initiatorName: '吳採購專員',
    steps: [
      {
        action: 'APPROVED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        expectation: {
          absentNodeIds: ['task_final'],
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_a',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_b',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_a',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-201',
        approverName: '黃人資主管',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_b',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-001',
              nodeId: 'task_final',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_b',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-001',
        approverName: '林總經理',
        expectation: {
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: 'member-001',
              nodeId: 'task_final',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_final',
      },
    ],
    title: '平行 AND 匯合',
    workflowDefinition: createParallelApprovalWorkflow('AND'),
  };
}

function createParallelOrScenario(): WorkflowExecutionScenario {
  return {
    amount: 100,
    expectationAfterSubmit: {
      state: 'RUNNING',
      tasks: [
        { assigneeMemberId: 'member-101', nodeId: 'task_a', status: 'PENDING' },
        { assigneeMemberId: 'member-201', nodeId: 'task_b', status: 'PENDING' },
      ],
    },
    initiatorMemberId: 'member-102',
    initiatorName: '吳採購專員',
    steps: [
      {
        action: 'APPROVED',
        approverMemberId: 'member-101',
        approverName: '陳財務經理',
        expectation: {
          state: 'RUNNING',
          tasks: [
            {
              assigneeMemberId: 'member-101',
              nodeId: 'task_a',
              status: 'COMPLETED',
            },
            {
              assigneeMemberId: 'member-201',
              nodeId: 'task_b',
              status: 'CANCELLED',
            },
            {
              assigneeMemberId: 'member-001',
              nodeId: 'task_final',
              status: 'PENDING',
            },
          ],
        },
        nodeId: 'task_a',
      },
      {
        action: 'APPROVED',
        approverMemberId: 'member-001',
        approverName: '林總經理',
        expectation: {
          state: 'APPROVED',
          tasks: [
            {
              assigneeMemberId: 'member-001',
              nodeId: 'task_final',
              status: 'COMPLETED',
            },
          ],
        },
        nodeId: 'task_final',
      },
    ],
    title: '平行 OR 匯合',
    workflowDefinition: createParallelApprovalWorkflow('OR'),
  };
}

function createSingleApprovalWorkflow({
  resolver,
  title,
}: {
  readonly resolver: ResolverInput;
  readonly title: string;
}): WorkflowDefinitionInput {
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
      userTaskNode('task_review', title, resolver, 320, 160),
      endNode(),
    ],
  };
}

function createExclusiveGatewayWorkflow(): WorkflowDefinitionInput {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_gateway',
        source: 'start',
        target: 'gateway_amount',
        type: 'smoothstep',
      },
      {
        data: {
          condition: 'form.amount > 1000',
          conditionFieldKey: 'amount',
          conditionOperator: 'GREATER_THAN',
          conditionValue: '1000',
          label: '金額大於 1000',
        },
        id: 'edge_gateway_high',
        source: 'gateway_amount',
        target: 'task_high',
        type: 'smoothstep',
      },
      {
        data: { isDefault: true, label: '其他情況' },
        id: 'edge_gateway_default',
        source: 'gateway_amount',
        target: 'task_default',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_high_end',
        source: 'task_high',
        target: 'end',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_default_end',
        source: 'task_default',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      {
        data: { direction: 'split', label: '金額分流', triggerMode: 'AND' },
        id: 'gateway_amount',
        position: { x: 260, y: 160 },
        type: 'exclusiveGateway',
      },
      userTaskNode(
        'task_high',
        '高額簽核',
        directResolver('member-101'),
        440,
        80,
      ),
      userTaskNode(
        'task_default',
        '一般簽核',
        directResolver('member-201'),
        440,
        240,
      ),
      endNode(),
    ],
  };
}

function createSequentialApprovalWorkflow(): WorkflowDefinitionInput {
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
        directResolver('member-101'),
        300,
        160,
      ),
      userTaskNode(
        'task_second',
        '第二關簽核',
        directResolver('member-201'),
        520,
        160,
      ),
      endNode(),
    ],
  };
}

function createReturnToPreviousWorkflow(): WorkflowDefinitionInput {
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
        directResolver('member-101'),
        300,
        160,
      ),
      userTaskNode(
        'task_second',
        '第二關簽核',
        directResolver('member-201'),
        520,
        160,
        'AND',
        {
          allowReturn: true,
          allowedTargets: 'PREVIOUS',
          resubmitStrategy: 'RESTART',
        },
      ),
      endNode(),
    ],
  };
}

function createParallelApprovalWorkflow(
  finalTriggerMode: 'AND' | 'OR',
): WorkflowDefinitionInput {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_a',
        source: 'start',
        target: 'task_a',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_start_b',
        source: 'start',
        target: 'task_b',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_a_final',
        source: 'task_a',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_b_final',
        source: 'task_b',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_final_end',
        source: 'task_final',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode(),
      userTaskNode('task_a', 'A 簽核', directResolver('member-101'), 300, 80),
      userTaskNode('task_b', 'B 簽核', directResolver('member-201'), 300, 240),
      userTaskNode(
        'task_final',
        '彙整簽核',
        directResolver('member-001'),
        520,
        160,
        finalTriggerMode,
      ),
      endNode(),
    ],
  };
}

function userTaskNode(
  id: string,
  label: string,
  resolver: ResolverInput,
  x: number,
  y: number,
  triggerMode: 'AND' | 'OR' = 'AND',
  returnBehavior: Readonly<{
    allowReturn: boolean;
    allowedTargets: 'ANY' | 'INITIATOR' | 'PREVIOUS';
    resubmitStrategy: 'FROM_RETURN_POINT' | 'RESTART';
  }> = {
    allowReturn: false,
    allowedTargets: 'PREVIOUS',
    resubmitStrategy: 'RESTART',
  },
): WorkflowDefinitionInput {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: resolver,
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior,
      triggerMode,
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function startNode(): WorkflowDefinitionInput {
  return {
    data: { label: '開始' },
    id: 'start',
    position: { x: 80, y: 160 },
    type: 'startEvent',
  };
}

function endNode(): WorkflowDefinitionInput {
  return {
    data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
    id: 'end',
    position: { x: 740, y: 160 },
    type: 'endEvent',
  };
}

function directResolver(memberId: string): ResolverInput {
  return { memberIds: [memberId], type: 'DIRECT' };
}

function readDraftVersion(versions: readonly VersionRecord[]): VersionRecord {
  const draft = versions.find((version) => version.status === 'DRAFT');

  if (!draft) {
    throw new Error('Created record does not have a draft version');
  }

  return draft;
}

function readTemplateAt(
  templates: readonly PublishedTemplate[],
  index: number,
): PublishedTemplate {
  const template = templates[index];

  if (!template) {
    throw new Error(`Missing published template at index ${index}`);
  }

  return template;
}

function readInstanceIdFromUrl(url: string): string {
  const instanceId = new URL(url).pathname.split('/').filter(Boolean).at(-1);

  if (!instanceId || instanceId === 'new') {
    throw new Error(`Cannot read approval instance id from URL: ${url}`);
  }

  return instanceId;
}

function readDecisionLabel(action: ApprovalStep['action']): string {
  if (action === 'APPROVED') return '已同意';
  if (action === 'REJECTED') return '已拒絕';

  return '已退回';
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

function readFormSchema(): WorkflowDefinitionInput {
  return {
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
        min: 0,
        placeholder: '請輸入金額',
        required: true,
        type: 'number',
      },
    ],
    schemaVersion: 1,
  };
}

function readFormUiSchema(): WorkflowDefinitionInput {
  return {
    layout: [
      { fieldKey: 'subject', width: 'FULL' },
      { fieldKey: 'amount', width: 'FULL' },
    ],
    schemaVersion: 1,
  };
}
