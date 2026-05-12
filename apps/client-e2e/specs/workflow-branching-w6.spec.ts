import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const INSTANCE_ID = 'w6-instance';
const UPDATED_AT = '2026-05-06T09:00:00.000Z';

test.describe('M2 W6 workflow visualization', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('shows conditional paths, parallel branch status, and cancelled alternatives', async ({
    page,
  }): Promise<void> => {
    await mockBranchingGraphQl(page);

    await page.goto(`/instances/${INSTANCE_ID}`);

    await expect(
      page.getByRole('button', { name: '查看流程圖' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '查看流程圖' }).click();
    await expect(page.getByRole('heading', { name: '流程圖' })).toBeVisible();
    await expect(
      page.getByTestId('rf__node-task_high').getByText('高額簽核'),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('rf__edge-edge_gateway_high')
        .getByText('金額大於 1000'),
    ).toBeVisible();
    await expect(
      page.getByTestId('rf__edge-edge_gateway_default').getByText('其他情況'),
    ).toBeVisible();
    await expect(
      page.getByTestId('rf__node-task_high').getByText('待處理', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByTestId('rf__node-task_default').getByText('已取消', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByTestId('rf__node-task_final').getByText('等待前置', {
        exact: true,
      }),
    ).toBeVisible();

    await expect(page.getByText('待簽任務已建立')).not.toBeVisible();
    await expect(page.getByText('等待簽核處理')).toBeVisible();
    await expect(
      page.getByText('節點：高額簽核 · 處理者：member-high', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText('未來簽核：彙整簽核')).toBeVisible();
    await expect(page.getByText('流程完成：完成')).toBeVisible();

    const timelineTitles = await page
      .locator('.mzn-stepper-step__title')
      .allTextContents();

    expect(timelineTitles.indexOf('未來簽核：彙整簽核')).toBeLessThan(
      timelineTitles.indexOf('流程完成：完成'),
    );
  });
});

async function mockBranchingGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);

    if (payload.query.includes('query ApprovalInstance')) {
      await fulfillGraphQl(route, {
        activityLogs: [
          {
            actorMemberId: null,
            createdAt: UPDATED_AT,
            eventType: 'TASK_CREATED',
            id: 'activity-1',
            nodeId: 'task_high',
            payloadJson: '{}',
            taskId: 'task-high',
          },
        ],
        approvalInstance: readInstance(),
        tasks: [
          readTask({
            assigneeMemberId: 'member-high',
            id: 'task-high',
            nodeId: 'task_high',
            status: 'PENDING',
            tokenId: 'token-high',
          }),
          readTask({
            assigneeMemberId: 'member-default',
            id: 'task-default',
            nodeId: 'task_default',
            status: 'CANCELLED',
            tokenId: 'token-default',
          }),
        ],
        workflowTokens: [
          readWorkflowToken({
            currentNodeId: 'task_high',
            id: 'token-high',
            status: 'WAITING',
          }),
          readWorkflowToken({
            consumedAt: UPDATED_AT,
            currentNodeId: 'task_default',
            id: 'token-default',
            status: 'CONSUMED',
          }),
          readWorkflowToken({
            currentNodeId: 'task_final',
            id: 'token-final',
            status: 'WAITING',
          }),
        ],
      });
      return;
    }

    if (payload.query.includes('query InstanceMembers')) {
      await fulfillGraphQl(route, {
        members: readMemberProfiles(readMemberIds(payload.variables)),
      });
      return;
    }

    if (payload.query.includes('query TaskDecisions')) {
      await fulfillGraphQl(route, { taskDecisions: [] });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readInstance(): Readonly<Record<string, unknown>> {
  return {
    completedAt: null,
    formDataJson: '{"amount":1500}',
    formDefinitionSnapshotJson: JSON.stringify({
      schema: {
        fields: [
          {
            fieldKey: 'amount',
            label: '金額',
            required: true,
            type: 'number',
          },
        ],
        schemaVersion: 1,
      },
      uiSchema: {
        layout: [{ fieldKey: 'amount', width: 'FULL' }],
        schemaVersion: 1,
      },
      version: 1,
    }),
    id: INSTANCE_ID,
    initiatorMemberId: 'member-001',
    startedAt: UPDATED_AT,
    state: 'RUNNING',
    templateId: 'template-w6',
    templateVersionId: 'template-version-w6',
    title: 'W6 分支流程',
    workflowSnapshotJson: JSON.stringify(readWorkflowDefinition()),
  };
}

function readWorkflowDefinition(): Readonly<Record<string, unknown>> {
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
        id: 'edge_high_final',
        source: 'task_high',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_default_final',
        source: 'task_default',
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
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { direction: 'split', label: '金額分流', triggerMode: 'AND' },
        id: 'gateway_amount',
        position: { x: 280, y: 160 },
        type: 'exclusiveGateway',
      },
      readUserTaskNode('task_high', '高額簽核', 500, 80),
      readUserTaskNode('task_default', '一般簽核', 500, 240),
      {
        data: { label: '完成' },
        id: 'end',
        position: { x: 940, y: 160 },
        type: 'endEvent',
      },
      readUserTaskNode('task_final', '彙整簽核', 720, 160),
    ],
  };
}

function readUserTaskNode(
  id: string,
  label: string,
  x: number,
  y: number,
): Readonly<Record<string, unknown>> {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
      triggerMode: 'AND',
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function readTask({
  assigneeMemberId,
  id,
  nodeId,
  status,
  tokenId,
}: {
  readonly assigneeMemberId: string;
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
  readonly tokenId: string;
}): Readonly<Record<string, unknown>> {
  return {
    assigneeMemberId,
    completedAt: status === 'PENDING' ? null : UPDATED_AT,
    createdAt: UPDATED_AT,
    id,
    instanceId: INSTANCE_ID,
    nodeId,
    openedAt: null,
    originalAssigneeMemberId: assigneeMemberId,
    slaDueAt: null,
    status,
    tokenId,
  };
}

function readWorkflowToken({
  consumedAt = null,
  currentNodeId,
  id,
  status,
}: {
  readonly consumedAt?: string | null;
  readonly currentNodeId: string;
  readonly id: string;
  readonly status: string;
}): Readonly<Record<string, unknown>> {
  return {
    consumedAt,
    createdAt: UPDATED_AT,
    currentNodeId,
    id,
    instanceId: INSTANCE_ID,
    parentTokenId: null,
    status,
  };
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

function readMemberProfiles(
  memberIds: readonly string[],
): readonly Readonly<Record<string, unknown>>[] {
  return memberIds.map((memberId) => ({
    email: `${memberId}@example.internal`,
    memberId,
    name: memberId,
  }));
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
