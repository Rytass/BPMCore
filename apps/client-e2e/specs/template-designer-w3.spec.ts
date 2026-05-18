import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

interface UpdateTemplateDraftInput {
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel: string | null;
  readonly workflowDefinitionJson: string;
}

interface MockTemplateGraphQlOptions {
  readonly onDraftUpdate?: (input: UpdateTemplateDraftInput) => void;
}

const TEMPLATE_ID = 'e2e-template';
const TEMPLATE_VERSION_ID = 'e2e-template-version';
const FORM_ID = 'e2e-form';
const FORM_VERSION_ID = 'e2e-form-version';
const UPDATED_AT = '2026-05-04T09:00:00.000Z';

test.describe('M1 W3 template designer', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('creates, designs, publishes, and reviews a template version', async ({
    page,
  }): Promise<void> => {
    await mockTemplateGraphQl(page);

    await page.goto('/templates');
    await page.getByRole('button', { name: '建立模板' }).click();
    await page.getByPlaceholder('例如：費用申請流程').fill('E2E 簽核模板');
    await Promise.all([
      page.waitForURL(`**/templates/${TEMPLATE_ID}/designer`, {
        timeout: 30_000,
      }),
      page.getByRole('button', { exact: true, name: '建立' }).click(),
    ]);

    await expect(page.getByText('E2E 簽核模板')).toBeVisible();
    await expect(page.getByText('未設定')).toBeVisible();
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page.locator('[role="option"]').filter({ hasText: '所有人' }).click();
    await expect(page.getByRole('combobox', { name: '所有人' })).toBeVisible();

    await page.getByRole('button', { name: '簽核節點' }).click();
    await expect(
      page
        .locator('.react-flow__node')
        .filter({ hasText: '林總經理 (lin.ceo@example.internal)' }),
    ).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expect(page.getByText('重送策略')).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: '重新送出後從開始重跑' }),
    ).toBeVisible();
    await page.getByRole('combobox', { name: '重新送出後從開始重跑' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '重新送出後回到退回節點' })
      .click();
    await expect(
      page.getByRole('combobox', { name: '重新送出後回到退回節點' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '儲存草稿' }).click();
    await page.getByRole('button', { name: '發布版本' }).click();
    await expect(page.getByText(/已發布版本/u)).toBeVisible();

    await page.goto(`/templates/${TEMPLATE_ID}/versions`);
    await expect(page.getByText('PUBLISHED')).toBeVisible();
    await expect(page.getByText('E2E 表單 v1')).toBeVisible();
  });

  test('edits condition edges from the side panel', async ({
    page,
  }): Promise<void> => {
    await mockTemplateGraphQl(page);

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page.locator('[role="option"]').filter({ hasText: '所有人' }).click();
    await page.getByRole('button', { name: '條件分流' }).click();

    const defaultEdgeLabel = page
      .locator('.react-flow__edge-text')
      .filter({ hasText: '其他情況' });

    await expect(defaultEdgeLabel).toBeVisible();
    await page.getByRole('button', { name: '完成' }).click();
    await expect(page.getByRole('heading', { name: '條件設定' })).toBeVisible();
    await expect(page.getByText('其他條件都不符合時')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('shows readable dry run routing details', async ({
    page,
  }): Promise<void> => {
    await mockTemplateGraphQl(page);

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page.locator('[role="option"]').filter({ hasText: '所有人' }).click();
    await page.getByRole('button', { name: '簽核節點' }).click();
    await page.getByRole('button', { name: '試跑流程' }).click();
    await page.getByRole('button', { name: '執行試跑' }).click();

    await expect(page.getByText('試跑通過')).toBeVisible();
    await expect(page.getByText('來源線段：其他情況')).toBeVisible();
    await expect(
      page.getByText('其他條件不符合時採用預設路徑。'),
    ).toBeVisible();
    await expect(
      page.getByText('進入條件：符合 · form.amount > 0'),
    ).toBeVisible();
  });

  test('configures initiator manager fallback behavior on an approval node', async ({
    page,
  }): Promise<void> => {
    let savedResolver: Readonly<Record<string, unknown>> | null = null;

    await page.setViewportSize({ height: 1200, width: 1440 });
    await mockTemplateGraphQl(page, {
      onDraftUpdate: (input): void => {
        savedResolver = readFirstUserTaskResolver(input.workflowDefinitionJson);
      },
    });

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page.locator('[role="option"]').filter({ hasText: '所有人' }).click();
    await page.getByRole('button', { name: '簽核節點' }).click();

    await page.getByRole('combobox', { name: '指定會員' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '發起人主管' })
      .click();

    await expect(page.getByText('無主管時')).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: '停止流程並提示' }),
    ).toBeVisible();

    await page.getByRole('combobox', { name: '停止流程並提示' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '固定改派' })
      .click();
    await expect(page.getByText('改派人員')).toBeVisible();
    await expect(
      page.locator('label[for="allowInitiatorSelfApproval"]'),
    ).toBeVisible();

    const fallbackMemberSearch = page.getByPlaceholder('搜尋姓名或信箱');

    await fallbackMemberSearch.fill('chen');
    await expect(
      page
        .locator('[role="option"]')
        .filter({ hasText: '陳財務主管 (chen.manager@example.internal)' }),
    ).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect.poll((): boolean => savedResolver !== null).toBe(true);

    expect(savedResolver).toMatchObject({
      fallback: {
        allowInitiatorSelfApproval: true,
        memberId: 'member-101',
        type: 'DIRECT',
      },
      levelsUp: 1,
      type: 'ORG_MANAGER',
    });
  });

  test('configures organization and position approver resolvers on approval nodes', async ({
    page,
  }): Promise<void> => {
    const savedResolvers: Readonly<Record<string, unknown>>[] = [];

    await mockTemplateGraphQl(page, {
      onDraftUpdate: (input): void => {
        savedResolvers.push(
          readFirstUserTaskResolver(input.workflowDefinitionJson),
        );
      },
    });

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page.locator('[role="option"]').filter({ hasText: '所有人' }).click();
    await page.getByRole('button', { name: '簽核節點' }).click();

    await page.getByRole('combobox', { name: '指定會員' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '指定組織主管' })
      .click();
    await page.getByRole('combobox', { exact: true, name: '選擇組織' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '財務部 · FIN-TW' })
      .click();
    await expect(page.getByText('組織主管：財務部 · FIN-TW')).toBeVisible();
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect
      .poll((): number => savedResolvers.length)
      .toBeGreaterThanOrEqual(1);

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page
      .locator('.react-flow__node')
      .filter({ hasText: '組織主管：財務部 · FIN-TW' })
      .click();

    await page.getByRole('combobox', { name: '指定組織主管' }).click();
    const positionResolverOption = page
      .locator('[role="option"]')
      .filter({ hasText: '指定職位' });
    await positionResolverOption.evaluate((element: HTMLElement): void => {
      element.click();
    });
    await page.getByRole('combobox', { name: '選擇職位' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '部門主管 · DEPARTMENT_HEAD' })
      .click({ force: true });
    await expect(
      page.getByText('職位：部門主管 · DEPARTMENT_HEAD'),
    ).toBeVisible();
    await page.getByRole('button', { name: '儲存草稿' }).click();

    expect(savedResolvers[0]).toMatchObject({
      orgUnitId: 'org-finance',
      type: 'ORG_UNIT_MANAGER',
    });
    expect(savedResolvers[1]).toMatchObject({
      positionId: 'position-department-head',
      type: 'POSITION',
    });

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page
      .locator('.react-flow__node')
      .filter({ hasText: '職位：部門主管 · DEPARTMENT_HEAD' })
      .click();

    await page.getByRole('combobox', { name: '指定職位' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '組織特定職位' })
      .click();
    await page.getByRole('combobox', { exact: true, name: '選擇組織' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '財務部 · FIN-TW' })
      .click();
    await page.getByRole('combobox', { name: '選擇職位' }).click();
    await clickDropdownOption(page, '部門主管 · DEPARTMENT_HEAD');
    await expect(
      page.getByText('組織職位：財務部 · FIN-TW / 部門主管 · DEPARTMENT_HEAD'),
    ).toBeVisible();
    await page.getByRole('button', { name: '儲存草稿' }).click();

    expect(savedResolvers[2]).toMatchObject({
      orgUnitId: 'org-finance',
      positionId: 'position-department-head',
      type: 'ORG_UNIT_POSITION',
    });
  });

  test('configures start initiator policy from organization and organization position', async ({
    page,
  }): Promise<void> => {
    const savedInitiatorPolicies: (string | null)[] = [];

    await mockTemplateGraphQl(page, {
      onDraftUpdate: (input): void => {
        savedInitiatorPolicies.push(input.initiatorPolicyCel);
      },
    });

    await page.goto(`/templates/${TEMPLATE_ID}/designer`);
    await page.getByRole('combobox', { name: '未設定' }).click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: '指定組織職位' })
      .click();
    await page.getByRole('combobox', { exact: true, name: '選擇組織' }).click();
    await clickDropdownOption(page, '財務部 · FIN-TW');
    await expect(
      page.getByRole('combobox', { name: '財務部 · FIN-TW' }),
    ).toBeVisible();
    await page.getByRole('combobox', { exact: true, name: '選擇職位' }).click();
    await clickDropdownOption(page, '部門主管 · DEPARTMENT_HEAD');
    await expect(
      page.getByText('組織職位：財務部 · FIN-TW / 部門主管 · DEPARTMENT_HEAD'),
    ).toBeVisible();
    await page.getByRole('button', { name: '簽核節點' }).click();
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect
      .poll((): number => savedInitiatorPolicies.length)
      .toBeGreaterThanOrEqual(1);

    expect(savedInitiatorPolicies[0]).toContain(
      '"org-finance" in subject.orgUnitIds',
    );
    expect(savedInitiatorPolicies[0]).toContain(
      '"position-department-head" in subject.positionIds',
    );
  });
});

async function mockTemplateGraphQl(
  page: Page,
  options: MockTemplateGraphQlOptions = {},
): Promise<void> {
  let templateCurrentVersionId: string | null = null;
  let templateStatus: 'DRAFT' | 'PUBLISHED' = 'DRAFT';
  let templatePublishedAt: string | null = null;
  let workflowDefinitionJson = JSON.stringify(readEmptyWorkflowDefinition());
  let formDefinitionVersionId: string | null = null;
  let templateInitiatorPolicyCel: string | null = null;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query ApprovalTemplates')) {
      await fulfillGraphQl(route, {
        approvalTemplates: [],
        approvalTemplateCount: 0,
      });
      return;
    }

    if (query.includes('query ApprovalTemplateCategoriesPage')) {
      await fulfillGraphQl(route, {
        approvalTemplateCategories: [],
        approvalTemplateCategoryCount: 0,
      });
      return;
    }

    if (query.includes('mutation CreateApprovalTemplate')) {
      await fulfillGraphQl(route, {
        createApprovalTemplate: { id: TEMPLATE_ID },
      });
      return;
    }

    if (query.includes('query TemplateDesigner')) {
      await fulfillGraphQl(route, {
        approvalTemplate: {
          category: null,
          currentVersionId: templateCurrentVersionId,
          description: null,
          id: TEMPLATE_ID,
          name: 'E2E 簽核模板',
          updatedAt: UPDATED_AT,
        },
        approvalTemplateVersions: [
          readTemplateVersion({
            formDefinitionVersionId,
            initiatorPolicyCel: templateInitiatorPolicyCel,
            publishedAt: templatePublishedAt,
            status: templateStatus,
            workflowDefinitionJson,
          }),
        ],
        formDefinitions: [
          {
            currentVersionId: FORM_VERSION_ID,
            id: FORM_ID,
            name: 'E2E 表單',
            updatedAt: UPDATED_AT,
          },
        ],
      });
      return;
    }

    if (query.includes('query AdminOrganizationDashboard')) {
      await fulfillGraphQl(route, readOrganizationDashboardData());
      return;
    }

    if (query.includes('query FormVersions')) {
      await fulfillGraphQl(route, {
        formDefinitionVersions: [
          {
            formDefinitionId: FORM_ID,
            id: FORM_VERSION_ID,
            publishedAt: UPDATED_AT,
            schemaJson: JSON.stringify({
              fields: [
                {
                  fieldKey: 'amount',
                  label: '申請金額',
                  required: true,
                  type: 'money',
                },
                {
                  fieldKey: 'department',
                  label: '申請部門',
                  options: [
                    { label: '財務部', value: 'finance' },
                    { label: '營運部', value: 'operations' },
                  ],
                  required: true,
                  type: 'select',
                },
              ],
              schemaVersion: 1,
            }),
            status: 'PUBLISHED',
            version: 1,
          },
        ],
      });
      return;
    }

    if (query.includes('query SelectedMembers')) {
      await fulfillGraphQl(route, {
        members: [
          {
            email: 'lin.ceo@example.internal',
            memberId: 'member-001',
            name: '林總經理',
          },
        ],
      });
      return;
    }

    if (query.includes('query MemberOptions')) {
      const searchText = readOptionalString(payload.variables?.searchText);
      await fulfillGraphQl(route, {
        searchMembers: [
          {
            email: 'chen.manager@example.internal',
            memberId: 'member-101',
            name: '陳財務主管',
          },
        ].filter((member) => memberMatchesSearchText(member, searchText)),
      });
      return;
    }

    if (query.includes('mutation UpdateApprovalTemplateDraft')) {
      const input = readUpdateTemplateDraftInput(payload.variables?.input);

      options.onDraftUpdate?.(input);
      formDefinitionVersionId = input.formDefinitionVersionId;
      templateInitiatorPolicyCel = input.initiatorPolicyCel;
      workflowDefinitionJson = input.workflowDefinitionJson;

      if (!workflowDefinitionHasLinearTask(workflowDefinitionJson)) {
        throw new Error('Workflow draft must contain start -> userTask -> end');
      }

      await fulfillGraphQl(route, {
        updateApprovalTemplateDraft: readTemplateVersion({
          formDefinitionVersionId,
          initiatorPolicyCel: templateInitiatorPolicyCel,
          publishedAt: templatePublishedAt,
          status: templateStatus,
          workflowDefinitionJson,
        }),
      });
      return;
    }

    if (query.includes('mutation PublishApprovalTemplateVersion')) {
      templateCurrentVersionId = TEMPLATE_VERSION_ID;
      templateStatus = 'PUBLISHED';
      templatePublishedAt = UPDATED_AT;
      await fulfillGraphQl(route, {
        publishApprovalTemplateVersion: readTemplateVersion({
          formDefinitionVersionId,
          initiatorPolicyCel: templateInitiatorPolicyCel,
          publishedAt: templatePublishedAt,
          status: templateStatus,
          workflowDefinitionJson,
        }),
      });
      return;
    }

    if (query.includes('mutation DryRunApprovalWorkflow')) {
      await fulfillGraphQl(route, {
        dryRunApprovalWorkflow: {
          errors: [],
          steps: [
            {
              assigneeMemberId: null,
              edgeDefault: null,
              edgeId: null,
              edgeLabel: null,
              edgeMatched: null,
              edgeReason: null,
              entryCondition: null,
              entryConditionMatched: null,
              id: 'dry-run-step-1',
              message: '節點條件通過。',
              nodeId: 'start',
              nodeLabel: '開始',
              nodeType: 'startEvent',
              status: 'PASSED',
            },
            {
              assigneeMemberId: 'member-001',
              edgeDefault: true,
              edgeId: 'edge_gateway_default',
              edgeLabel: '其他情況',
              edgeMatched: true,
              edgeReason: '其他條件不符合時採用預設路徑。',
              entryCondition: 'form.amount > 0',
              entryConditionMatched: true,
              id: 'dry-run-step-2',
              message: '將建立待簽任務。',
              nodeId: 'task_default',
              nodeLabel: '一般簽核',
              nodeType: 'userTask',
              status: 'WAITING',
            },
          ],
          valid: true,
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readTemplateVersion({
  formDefinitionVersionId,
  initiatorPolicyCel,
  publishedAt,
  status,
  workflowDefinitionJson,
}: {
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel?: string | null;
  readonly publishedAt: string | null;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly workflowDefinitionJson: string;
}): Readonly<Record<string, unknown>> {
  return {
    archivedAt: null,
    formDefinitionVersionId,
    id: TEMPLATE_VERSION_ID,
    initiatorPolicyCel: initiatorPolicyCel ?? null,
    notificationConfigJson: null,
    publishedAt,
    slaDefaultsJson: null,
    status,
    updatedAt: UPDATED_AT,
    version: 1,
    workflowDefinitionJson,
  };
}

function readEmptyWorkflowDefinition(): Readonly<Record<string, unknown>> {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
        id: 'end',
        position: { x: 560, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function readOrganizationDashboardData(): Readonly<Record<string, unknown>> {
  return {
    managerResolutions: [],
    memberships: [
      readMembership({
        id: 'membership-ceo',
        memberId: 'member-001',
        orgUnitId: 'org-hq',
        positionId: 'position-ceo',
      }),
      readMembership({
        id: 'membership-finance-manager',
        memberId: 'member-101',
        orgUnitId: 'org-finance',
        positionId: 'position-department-head',
      }),
      readMembership({
        id: 'membership-ap-specialist',
        memberId: 'member-102',
        orgUnitId: 'org-finance-ap',
        positionId: 'position-ap-specialist',
      }),
    ],
    organizationSummary: {
      managerResolutionCount: 0,
      membershipCount: 0,
      orgUnitCount: 3,
      positionCount: 3,
    },
    orgUnits: [
      readOrgUnit({
        code: 'BPM-HQ',
        id: 'org-hq',
        name: 'Rytass 總管理處',
        parentId: null,
        path: 'org.hq',
        type: 'COMPANY',
      }),
      readOrgUnit({
        code: 'FIN-TW',
        id: 'org-finance',
        name: '財務部',
        parentId: 'org-hq',
        path: 'org.hq.finance',
        type: 'DEPARTMENT',
      }),
      readOrgUnit({
        code: 'FIN-AP',
        id: 'org-finance-ap',
        name: '應付帳款組',
        parentId: 'org-finance',
        path: 'org.hq.finance.ap',
        type: 'TEAM',
      }),
    ],
    positions: [
      readPosition({
        code: 'CEO',
        id: 'position-ceo',
        level: 100,
        name: '執行長',
      }),
      readPosition({
        code: 'DEPARTMENT_HEAD',
        id: 'position-department-head',
        level: 80,
        name: '部門主管',
      }),
      readPosition({
        code: 'AP_SPECIALIST',
        id: 'position-ap-specialist',
        level: 40,
        name: '應付帳款專員',
      }),
    ],
  };
}

function readMembership({
  id,
  memberId,
  orgUnitId,
  positionId,
}: {
  readonly id: string;
  readonly memberId: string;
  readonly orgUnitId: string;
  readonly positionId: string;
}): Readonly<Record<string, unknown>> {
  return {
    createdAt: UPDATED_AT,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    id,
    isPrimary: true,
    memberId,
    orgUnitId,
    positionId,
    updatedAt: UPDATED_AT,
  };
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
}): Readonly<Record<string, unknown>> {
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

function readPosition({
  code,
  id,
  level,
  name,
}: {
  readonly code: string;
  readonly id: string;
  readonly level: number;
  readonly name: string;
}): Readonly<Record<string, unknown>> {
  return {
    code,
    createdAt: UPDATED_AT,
    id,
    level,
    name,
    updatedAt: UPDATED_AT,
  };
}

function readFirstUserTaskResolver(
  workflowDefinitionJson: string,
): Readonly<Record<string, unknown>> {
  const parsedValue = JSON.parse(workflowDefinitionJson) as unknown;

  if (!isRecord(parsedValue) || !Array.isArray(parsedValue.nodes)) {
    throw new Error('Workflow definition nodes are invalid');
  }

  const userTask = parsedValue.nodes.find(
    (node): node is Readonly<Record<string, unknown>> =>
      isRecord(node) && node.type === 'userTask',
  );

  if (!isRecord(userTask) || !isRecord(userTask.data)) {
    throw new Error('Workflow definition must contain a user task');
  }

  if (!isRecord(userTask.data.approverResolver)) {
    throw new Error('User task approver resolver is invalid');
  }

  return userTask.data.approverResolver;
}

function workflowDefinitionHasLinearTask(
  workflowDefinitionJson: string,
): boolean {
  const parsedValue = JSON.parse(workflowDefinitionJson) as unknown;

  if (!isRecord(parsedValue) || !Array.isArray(parsedValue.edges)) {
    return false;
  }

  const edges = parsedValue.edges.filter(isWorkflowEdgeRecord);

  return (
    edges.some(
      (edge) => edge.source === 'start' && edge.target.startsWith('userTask_'),
    ) &&
    edges.some(
      (edge) => edge.source.startsWith('userTask_') && edge.target === 'end',
    )
  );
}

function isWorkflowEdgeRecord(
  value: unknown,
): value is Readonly<{ source: string; target: string }> {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string'
  );
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

function readUpdateTemplateDraftInput(
  value: unknown,
): UpdateTemplateDraftInput {
  if (
    !isRecord(value) ||
    typeof value.workflowDefinitionJson !== 'string' ||
    (typeof value.formDefinitionVersionId !== 'string' &&
      value.formDefinitionVersionId !== null)
  ) {
    throw new Error('UpdateApprovalTemplateDraft input is invalid');
  }

  return {
    formDefinitionVersionId: value.formDefinitionVersionId,
    initiatorPolicyCel:
      typeof value.initiatorPolicyCel === 'string'
        ? value.initiatorPolicyCel
        : null,
    workflowDefinitionJson: value.workflowDefinitionJson,
  };
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function memberMatchesSearchText(
  member: Readonly<{ email: string; memberId: string; name: string }>,
  searchText: string,
): boolean {
  if (!searchText) {
    return true;
  }

  return [member.email, member.memberId, member.name].some((value) =>
    value.toLowerCase().includes(searchText),
  );
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

async function clickDropdownOption(page: Page, text: string): Promise<void> {
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: text })
    .first();

  await expect(option).toBeVisible();
  await option.evaluate((element): void => {
    const mouseEventOptions: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
    };

    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
    element.dispatchEvent(new MouseEvent('click', mouseEventOptions));
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
