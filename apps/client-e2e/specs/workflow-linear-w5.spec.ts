import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const TEMPLATE_ID = 'e2e-template';
const TEMPLATE_VERSION_ID = 'e2e-template-version';
const FORM_VERSION_ID = 'e2e-form-version';
const INSTANCE_ID = 'e2e-instance';
const TASK_ID = 'e2e-task';
const UPDATED_AT = '2026-05-06T08:00:00.000Z';

test.describe('M2 W5 linear workflow', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('submits, opens, approves, and completes a linear instance', async ({
    page,
  }): Promise<void> => {
    await mockWorkflowGraphQl(page);

    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);

    await expect(page.getByText('請假原因')).toBeVisible();
    await page.getByPlaceholder('請輸入文字').fill('家庭照顧請假');
    await Promise.all([
      page.waitForURL(`**/instances/${INSTANCE_ID}`, { timeout: 30_000 }),
      page.getByRole('button', { name: '送出' }).click(),
    ]);

    await expect(page.getByText('進行中')).toBeVisible();
    await expect(page.getByText('RUNNING')).toHaveCount(0);
    await expect(
      page.getByText('進行中 · 2026-05-06 16:00:00'),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: '請輸入文字' }),
    ).toHaveValue('家庭照顧請假');

    await page.goto('/inbox');
    await expect(page.getByText('請假原因：家庭照顧請假')).toBeVisible();
    await Promise.all([
      page.waitForURL(`**/instances/${INSTANCE_ID}`, { timeout: 30_000 }),
      page.getByRole('button', { exact: true, name: '處理' }).click(),
    ]);

    await page.getByRole('button', { name: '同意' }).click();

    await expect(page.getByText('已同意', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('APPROVED');
    await expect(page.getByRole('button', { name: '同意' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '拒絕' })).toHaveCount(0);
    await expect(
      page.getByText('簽章鏈已驗證，共 1 筆。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/簽章：已驗證/)).toBeVisible();
    await expect(page.getByText('此案件沒有附件。')).toBeVisible();
    await page.getByTestId('member-tooltip-member-001').hover();
    await expect(page.getByText('lin.ceo@example.internal')).toBeVisible();

    await page.goto('/inbox');
    await expect(page.getByText('task_manager')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '待簽核' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '歷史簽核記錄' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '歷史簽核記錄' }).click();
    await expect(page.getByText('請假原因：家庭照顧請假')).toBeVisible();
    await expect(page.getByText('task_manager')).toBeVisible();
    await expect(page.getByRole('table').getByText('-', { exact: true })).toBeVisible();
    await expect(page.getByText('2026-05-06 16:00:00')).toBeVisible();
    const approvedDecision = page
      .getByRole('table')
      .getByText('同意', { exact: true });

    await expect(approvedDecision).toBeVisible();
    await expect(approvedDecision).toHaveCSS(
      'color',
      await readResolvedCssColor(page, '--mzn-color-text-success'),
    );
  });

  test('requires a rejection reason before rejecting a task', async ({
    page,
  }): Promise<void> => {
    await mockWorkflowGraphQl(page);

    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);

    await page.getByPlaceholder('請輸入文字').fill('家庭照顧請假');
    await Promise.all([
      page.waitForURL(`**/instances/${INSTANCE_ID}`, { timeout: 30_000 }),
      page.getByRole('button', { name: '送出' }).click(),
    ]);

    await page.getByRole('button', { name: '拒絕' }).click();
    await expect(page.getByRole('heading', { name: '拒絕原因' })).toBeVisible();
    await expect(page.getByRole('button', { name: '送出拒絕' })).toBeDisabled();

    await page.getByPlaceholder('請說明拒絕原因').fill('資料不足，請補件');
    await page.getByRole('button', { name: '送出拒絕' }).click();

    await expect(
      page.getByText('已拒絕 · 2026-05-06 16:00:00'),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('REJECTED');
    await expect(page.getByText('已拒絕', { exact: true })).toBeVisible();
    await expect(page.getByText('簽核已決議')).not.toBeVisible();
    await expect(page.getByText('決議：拒絕')).toBeVisible();
    const rejectionReason = page.getByText('拒絕原因：資料不足，請補件');

    await expect(rejectionReason).toBeVisible();
    await expect(rejectionReason).toHaveCSS(
      'color',
      await readResolvedCssColor(page, '--mzn-color-text-error'),
    );
    await expect(page.getByText('未來簽核：複核簽核')).toBeVisible();
    await expect(page.getByText('流程完成：完成')).toBeVisible();

    const futureStepClasses = await page
      .locator('.mzn-stepper-step')
      .filter({ hasText: '未來簽核：複核簽核' })
      .getAttribute('class');

    expect(futureStepClasses).toContain('mzn-stepper-step--pending');
    expect(futureStepClasses).not.toContain('mzn-stepper-step--processing');

    await page.goto('/inbox');
    await page.getByText('歷史簽核記錄', { exact: true }).click();
    await expect(page.getByText('請假原因：家庭照顧請假')).toBeVisible();
    await expect(page.getByText('task_manager')).toBeVisible();
    const rejectedDecision = page
      .getByRole('table')
      .getByText('拒絕', { exact: true });

    await expect(rejectedDecision).toBeVisible();
    await expect(rejectedDecision).toHaveCSS(
      'color',
      await readResolvedCssColor(page, '--mzn-color-text-error'),
    );
    await expect(
      page.getByRole('table').getByText('資料不足，請補件', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('2026-05-06 16:00:00')).toBeVisible();
  });

  test('hides decision buttons when the task belongs to another member', async ({
    page,
  }): Promise<void> => {
    await mockWorkflowGraphQl(page, { taskAssigneeMemberId: 'member-002' });

    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);

    await page.getByPlaceholder('請輸入文字').fill('家庭照顧請假');
    await Promise.all([
      page.waitForURL(`**/instances/${INSTANCE_ID}`, { timeout: 30_000 }),
      page.getByRole('button', { name: '送出' }).click(),
    ]);

    await expect(page.getByText('進行中')).toBeVisible();
    await expect(
      page.getByRole('table').getByText('member-002', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '同意' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '拒絕' })).toHaveCount(0);
  });
});

interface MockWorkflowGraphQlOptions {
  readonly taskAssigneeMemberId?: string;
}

async function mockWorkflowGraphQl(
  page: Page,
  options: MockWorkflowGraphQlOptions = {},
): Promise<void> {
  let instanceCreated = false;
  let instanceState: 'APPROVED' | 'REJECTED' | 'RUNNING' = 'RUNNING';
  let taskStatus: 'COMPLETED' | 'PENDING' = 'PENDING';
  let formDataJson = '{}';
  let rejectionComment: string | null = null;
  const taskAssigneeMemberId = options.taskAssigneeMemberId ?? 'member-001';

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query LaunchTemplate')) {
      await fulfillGraphQl(route, {
        approvalTemplate: {
          currentVersionId: TEMPLATE_VERSION_ID,
          id: TEMPLATE_ID,
          name: 'E2E 請假流程',
        },
        approvalTemplateVersions: [
          {
            formDefinitionVersionId: FORM_VERSION_ID,
            id: TEMPLATE_VERSION_ID,
            status: 'PUBLISHED',
            version: 1,
          },
        ],
      });
      return;
    }

    if (query.includes('query LaunchFormVersion')) {
      await fulfillGraphQl(route, {
        formDefinitionVersion: {
          id: FORM_VERSION_ID,
          schemaJson: JSON.stringify(readFormSchema()),
          uiSchemaJson: JSON.stringify(readFormUiSchema()),
          version: 1,
        },
      });
      return;
    }

    if (query.includes('mutation SubmitApprovalInstance')) {
      instanceCreated = true;
      formDataJson = readSubmitFormDataJson(payload.variables?.input);
      await fulfillGraphQl(route, {
        submitApprovalInstance: { id: INSTANCE_ID },
      });
      return;
    }

    if (query.includes('mutation ProcessApprovalInstance')) {
      await fulfillGraphQl(route, {
        processApprovalInstance: true,
      });
      return;
    }

    if (query.includes('query InstanceMembers')) {
      await fulfillGraphQl(route, {
        members: readMemberProfiles(readMemberIds(payload.variables)),
      });
      return;
    }

    if (query.includes('query ApprovalInstance')) {
      await fulfillGraphQl(route, {
        activityLogs: readActivityLogs(instanceState),
        approvalInstance: readInstance({
          formDataJson,
          instanceCreated,
          state: instanceState,
        }),
        tasks: readTasks(taskStatus, taskAssigneeMemberId),
        workflowTokens: readWorkflowTokens(taskStatus),
      });
      return;
    }

    if (query.includes('query InboxTasks')) {
      await fulfillGraphQl(route, {
        inboxTasks:
          taskStatus === 'PENDING'
            ? readTasks(taskStatus, taskAssigneeMemberId)
            : [],
      });
      return;
    }

    if (query.includes('query ApprovalHistoryTasks')) {
      await fulfillGraphQl(route, {
        approvalHistoryTasks:
          taskStatus === 'COMPLETED'
            ? readTasks(taskStatus, taskAssigneeMemberId)
            : [],
      });
      return;
    }

    if (query.includes('query TaskDecisions')) {
      await fulfillGraphQl(route, {
        taskDecisions:
          taskStatus === 'COMPLETED'
            ? [readTaskDecision(instanceState, rejectionComment)]
            : [],
      });
      return;
    }

    if (query.includes('query InstanceAttachments')) {
      await fulfillGraphQl(route, {
        attachments: [],
      });
      return;
    }

    if (query.includes('query InstanceSignatures')) {
      await fulfillGraphQl(route, {
        signatures:
          taskStatus === 'COMPLETED'
            ? [readSignature(instanceState)]
            : [],
        verifySignatureChain: {
          checkedCount: taskStatus === 'COMPLETED' ? 1 : 0,
          errors: [],
          instanceId: INSTANCE_ID,
          valid: true,
        },
      });
      return;
    }

    if (query.includes('mutation DecideTask')) {
      const decisionInput = payload.variables?.input;
      const action = readDecisionAction(decisionInput);
      const comment = readDecisionComment(decisionInput);
      instanceState = action === 'REJECTED' ? 'REJECTED' : 'APPROVED';
      taskStatus = 'COMPLETED';
      rejectionComment = action === 'REJECTED' ? comment : null;
      await fulfillGraphQl(route, {
        decideTask: {
          action,
          comment,
          decidedAt: UPDATED_AT,
          decidedByMemberId: 'member-001',
          id: 'decision-1',
          returnToNodeId: null,
          signatureId: 'signature-1',
          taskId: TASK_ID,
          transferToMemberId: null,
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readFormSchema(): Readonly<Record<string, unknown>> {
  return {
    fields: [
      {
        fieldKey: 'reason',
        label: '請假原因',
        required: true,
        type: 'text',
      },
    ],
    schemaVersion: 1,
  };
}

function readFormUiSchema(): Readonly<Record<string, unknown>> {
  return {
    layout: [{ fieldKey: 'reason', width: 'FULL' }],
    schemaVersion: 1,
  };
}

async function readResolvedCssColor(
  page: Page,
  variableName: string,
): Promise<string> {
  return page.evaluate((cssVariableName): string => {
    const probe = document.createElement('span');

    probe.style.color = `var(${cssVariableName})`;
    document.body.appendChild(probe);

    const color = window.getComputedStyle(probe).color;

    probe.remove();

    return color;
  }, variableName);
}

function readInstance({
  formDataJson,
  instanceCreated,
  state,
}: {
  readonly formDataJson: string;
  readonly instanceCreated: boolean;
  readonly state: 'APPROVED' | 'REJECTED' | 'RUNNING';
}): Readonly<Record<string, unknown>> {
  if (!instanceCreated) {
    throw new Error('Instance was not submitted');
  }

  return {
    completedAt: state === 'RUNNING' ? null : UPDATED_AT,
    formDataJson,
    formDefinitionSnapshotJson: JSON.stringify({
      formDefinitionVersionId: FORM_VERSION_ID,
      schema: readFormSchema(),
      uiSchema: readFormUiSchema(),
      version: 1,
    }),
    id: INSTANCE_ID,
    initiatorMemberId: 'member-001',
    startedAt: UPDATED_AT,
    state,
    templateId: TEMPLATE_ID,
    templateVersionId: TEMPLATE_VERSION_ID,
    title: 'E2E 請假流程',
    workflowSnapshotJson: JSON.stringify({
      edges: [
        {
          data: {},
          id: 'edge-start-task',
          source: 'start',
          target: 'task_manager',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge-task-followup',
          source: 'task_manager',
          target: 'task_followup',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge-followup-end',
          source: 'task_followup',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 0, y: 0 },
          type: 'startEvent',
        },
        {
          data: { label: '完成' },
          id: 'end',
          position: { x: 480, y: 0 },
          type: 'endEvent',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: false,
            approverResolver: { memberIds: ['member-002'], type: 'DIRECT' },
            decisionPolicy: { type: 'SINGLE' },
            label: '複核簽核',
            returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
            triggerMode: 'AND',
          },
          id: 'task_followup',
          position: { x: 360, y: 0 },
          type: 'userTask',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: false,
            approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
            decisionPolicy: { type: 'SINGLE' },
            label: '主管簽核',
            returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
            triggerMode: 'AND',
          },
          id: 'task_manager',
          position: { x: 240, y: 0 },
          type: 'userTask',
        },
      ],
    }),
  };
}

function readTasks(
  status: 'COMPLETED' | 'PENDING',
  assigneeMemberId = 'member-001',
): readonly Readonly<Record<string, unknown>>[] {
  return [
    {
      assigneeMemberId,
      completedAt: status === 'COMPLETED' ? UPDATED_AT : null,
      createdAt: UPDATED_AT,
      id: TASK_ID,
      instanceId: INSTANCE_ID,
      nodeId: 'task_manager',
      openedAt: null,
      originalAssigneeMemberId: assigneeMemberId,
      slaDueAt: null,
      status,
      tokenId: 'token-1',
    },
  ];
}

function readTaskDecision(
  state: 'APPROVED' | 'REJECTED' | 'RUNNING',
  rejectionComment: string | null,
): Readonly<Record<string, unknown>> {
  const action = state === 'REJECTED' ? 'REJECTED' : 'APPROVED';

  return {
    action,
    comment: action === 'REJECTED' ? rejectionComment : null,
    decidedAt: UPDATED_AT,
    decidedByMemberId: 'member-001',
    id: 'decision-1',
    returnToNodeId: null,
    signatureId: 'signature-1',
    taskId: TASK_ID,
    transferToMemberId: null,
  };
}

function readSignature(
  state: 'APPROVED' | 'REJECTED' | 'RUNNING',
): Readonly<Record<string, unknown>> {
  return {
    algorithm: 'HMAC-SHA256',
    id: 'signature-1',
    instanceId: INSTANCE_ID,
    keyVersion: 1,
    previousSignatureHash: null,
    signature: 'signature',
    signedAt: UPDATED_AT,
    signedPayloadHash:
      state === 'REJECTED'
        ? 'rejected-signed-payload-hash'
        : 'approved-signed-payload-hash',
    signedPayloadJson: '{}',
    signerMemberId: 'member-001',
    taskId: TASK_ID,
    timestampTokenBase64: 'dGltZXN0YW1w',
  };
}

function readWorkflowTokens(
  status: 'COMPLETED' | 'PENDING',
): readonly Readonly<Record<string, unknown>>[] {
  return [
    {
      consumedAt: status === 'COMPLETED' ? UPDATED_AT : null,
      createdAt: UPDATED_AT,
      currentNodeId: status === 'COMPLETED' ? 'end' : 'task_manager',
      id: 'token-1',
      instanceId: INSTANCE_ID,
      parentTokenId: null,
      status: status === 'COMPLETED' ? 'CONSUMED' : 'WAITING',
    },
  ];
}

function readActivityLogs(
  state: 'APPROVED' | 'REJECTED' | 'RUNNING',
): readonly Readonly<Record<string, unknown>>[] {
  return [
    {
      actorMemberId: state === 'RUNNING' ? null : 'member-001',
      createdAt: UPDATED_AT,
      eventType: state === 'RUNNING' ? 'TASK_CREATED' : 'TASK_DECIDED',
      id: 'activity-1',
      nodeId: 'task_manager',
      payloadJson: JSON.stringify({
        action: state === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        comment: null,
        signatureId: state === 'RUNNING' ? null : 'signature-1',
      }),
      taskId: TASK_ID,
    },
  ];
}

function readMemberProfiles(
  memberIds: readonly string[],
): readonly Readonly<Record<string, unknown>>[] {
  return memberIds.map((memberId) => {
    if (memberId === 'member-001') {
      return {
        email: 'lin.ceo@example.internal',
        memberId,
        name: '林執行長',
      };
    }

    return {
      email: `${memberId}@example.internal`,
      memberId,
      name: memberId,
    };
  });
}

function readMemberIds(
  variables: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const memberIds = variables?.memberIds;

  return Array.isArray(memberIds)
    ? memberIds.filter(
        (memberId): memberId is string => typeof memberId === 'string',
      )
    : [];
}

function readDecisionAction(value: unknown): 'APPROVED' | 'REJECTED' {
  if (!isRecord(value) || value.action !== 'REJECTED') {
    return 'APPROVED';
  }

  return 'REJECTED';
}

function readDecisionComment(value: unknown): string | null {
  if (!isRecord(value) || typeof value.comment !== 'string') {
    return null;
  }

  return value.comment;
}

function readSubmitFormDataJson(value: unknown): string {
  if (!isRecord(value) || typeof value.formDataJson !== 'string') {
    throw new Error('SubmitApprovalInstance input is invalid');
  }

  return value.formDataJson;
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
  return typeof value === 'object' && value !== null;
}
