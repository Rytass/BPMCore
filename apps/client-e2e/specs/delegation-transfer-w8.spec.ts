import { expect, Page, Route, test } from '@playwright/test';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const INSTANCE_ID = 'w8-instance';
const TASK_ID = 'w8-task';
const TRANSFERRED_TASK_ID = 'w8-task-transfer';
const UPDATED_AT = '2026-05-09T08:00:00.000Z';

test.describe('W8 delegation and transfer', () => {
  test('creates and revokes a delegation rule from the admin page', async ({
    page,
  }): Promise<void> => {
    await mockDelegationAdminGraphQl(page);

    await page.goto('/admin/delegations');
    await expect(page.getByRole('heading', { name: '代理設定' })).toBeVisible();

    await page.getByRole('button', { name: '建立代理' }).click();
    await page
      .getByPlaceholder('搜尋姓名、信箱或 member_id')
      .first()
      .fill('林');
    await page
      .getByRole('option', { name: '林執行長 · lin.ceo@example.internal' })
      .click();
    await page.getByPlaceholder('搜尋姓名、信箱或 member_id').nth(1).fill('陳');
    await page
      .getByRole('option', {
        name: '陳財務主管 · chen.manager@example.internal',
      })
      .click();
    await page.getByRole('button', { name: '建立代理' }).last().click();

    await expect(page.getByRole('table').getByText('啟用中')).toBeVisible();
    await expect(
      page
        .getByRole('table')
        .getByText('林執行長 · lin.ceo@example.internal（member-001）'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('table')
        .getByText('陳財務主管 · chen.manager@example.internal（member-101）'),
    ).toBeVisible();

    await page.getByRole('button', { name: '撤銷' }).click();
    await expect(page.getByRole('table').getByText('已撤銷')).toBeVisible();
  });

  test('transfers a pending task and records the new assignee', async ({
    page,
  }): Promise<void> => {
    await mockTransferGraphQl(page);

    await page.goto(`/instances/${INSTANCE_ID}`);
    await expect(page.getByRole('button', { name: '轉派' })).toBeVisible();
    await page.getByRole('button', { name: '轉派' }).click();
    await page.getByPlaceholder('搜尋姓名、信箱或 member_id').fill('陳');
    await page
      .getByRole('option', {
        name: '陳財務主管 · chen.manager@example.internal',
      })
      .click();
    await page.getByPlaceholder('可補充轉派原因').fill('請財務主管協助');
    await page.getByRole('button', { name: '送出轉派' }).click();

    await expect(page.getByRole('table').getByText('已轉派')).toBeVisible();
    await expect(
      page.getByRole('table').getByText('member-101（原：member-001）'),
    ).toBeVisible();
    await expect(page.getByText('決議：轉派')).toBeVisible();
    await expect(page.getByText('轉派給：member-101')).toBeVisible();
    await expect(page.getByText('轉派說明：請財務主管協助')).toBeVisible();
  });
});

async function mockDelegationAdminGraphQl(page: Page): Promise<void> {
  let ruleStatus: 'ACTIVE' | 'REVOKED' | null = null;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query SearchMembers')) {
      await fulfillGraphQl(route, {
        searchMembers: readMemberProfiles(['member-001', 'member-101']),
      });
      return;
    }

    if (query.includes('query DelegationRules')) {
      await fulfillGraphQl(route, {
        delegationRules: ruleStatus ? [readDelegationRule(ruleStatus)] : [],
      });
      return;
    }

    if (query.includes('mutation CreateDelegationRule')) {
      ruleStatus = 'ACTIVE';
      await fulfillGraphQl(route, {
        createDelegationRule: readDelegationRule(ruleStatus),
      });
      return;
    }

    if (query.includes('mutation RevokeDelegationRule')) {
      ruleStatus = 'REVOKED';
      await fulfillGraphQl(route, {
        revokeDelegationRule: readDelegationRule(ruleStatus),
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

async function mockTransferGraphQl(page: Page): Promise<void> {
  let transferred = false;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query SearchMembers')) {
      await fulfillGraphQl(route, {
        searchMembers: readMemberProfiles(['member-101', 'member-102']),
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
        activityLogs: readTransferActivityLogs(transferred),
        approvalInstance: readInstance(),
        tasks: readTransferTasks(transferred),
        workflowTokens: [readWorkflowToken()],
      });
      return;
    }

    if (query.includes('query TaskDecisions')) {
      await fulfillGraphQl(route, {
        taskDecisions: transferred
          ? [
              {
                action: 'TRANSFERRED',
                comment: '請財務主管協助',
                decidedAt: UPDATED_AT,
                decidedByMemberId: 'member-001',
                id: 'decision-1',
                returnToNodeId: null,
                taskId: TASK_ID,
                transferToMemberId: 'member-101',
              },
            ]
          : [],
      });
      return;
    }

    if (query.includes('mutation DecideTask')) {
      transferred = true;
      await fulfillGraphQl(route, {
        decideTask: {
          action: 'TRANSFERRED',
          comment: '請財務主管協助',
          decidedAt: UPDATED_AT,
          decidedByMemberId: 'member-001',
          id: 'decision-1',
          returnToNodeId: null,
          taskId: TASK_ID,
          transferToMemberId: 'member-101',
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readDelegationRule(
  status: 'ACTIVE' | 'REVOKED',
): Readonly<Record<string, unknown>> {
  return {
    agentMemberId: 'member-101',
    createdAt: UPDATED_AT,
    createdByMemberId: 'member-001',
    endAt: null,
    id: 'delegation-rule-1',
    principalMemberId: 'member-001',
    priority: 100,
    requiresConfirmation: false,
    revokedAt: status === 'REVOKED' ? UPDATED_AT : null,
    revokedByMemberId: status === 'REVOKED' ? 'member-001' : null,
    scopeConditionCel: null,
    scopeTemplateIds: [],
    scopeType: 'ALL',
    startAt: UPDATED_AT,
    status,
    updatedAt: UPDATED_AT,
  };
}

function readInstance(): Readonly<Record<string, unknown>> {
  return {
    completedAt: null,
    formDataJson: JSON.stringify({ reason: 'W8 轉派測試' }),
    formDefinitionSnapshotJson: JSON.stringify({
      formDefinitionVersionId: 'form-version-1',
      schema: {
        fields: [{ fieldKey: 'reason', label: '申請事由', type: 'text' }],
        schemaVersion: 1,
      },
      uiSchema: {
        layout: [{ fieldKey: 'reason', width: 'FULL' }],
        schemaVersion: 1,
      },
      version: 1,
    }),
    id: INSTANCE_ID,
    initiatorMemberId: 'member-001',
    startedAt: UPDATED_AT,
    state: 'RUNNING',
    templateId: 'template-1',
    templateVersionId: 'template-version-1',
    title: 'W8 轉派測試',
    workflowSnapshotJson: JSON.stringify({
      edges: [
        {
          data: {},
          id: 'edge-start-task',
          source: 'start',
          target: 'task',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge-task-end',
          source: 'task',
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
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: true,
            approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
            decisionPolicy: { type: 'SINGLE' },
            label: '主管簽核',
            returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
            triggerMode: 'AND',
          },
          id: 'task',
          position: { x: 240, y: 0 },
          type: 'userTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 480, y: 0 },
          type: 'endEvent',
        },
      ],
    }),
  };
}

function readTransferTasks(
  transferred: boolean,
): readonly Readonly<Record<string, unknown>>[] {
  const delegationChainJson = JSON.stringify([
    {
      from: 'member-001',
      reason: 'MANUAL_TRANSFER',
      ruleId: null,
      to: 'member-101',
    },
  ]);

  return transferred
    ? [
        readTask({
          completedAt: UPDATED_AT,
          delegationChainJson,
          id: TASK_ID,
          status: 'TRANSFERRED',
        }),
        readTask({
          assigneeMemberId: 'member-101',
          delegationChainJson,
          id: TRANSFERRED_TASK_ID,
          status: 'PENDING',
        }),
      ]
    : [readTask({ id: TASK_ID, status: 'PENDING' })];
}

function readTask(
  value: Readonly<{
    readonly assigneeMemberId?: string;
    readonly completedAt?: string | null;
    readonly delegationChainJson?: string;
    readonly id: string;
    readonly status: string;
  }>,
): Readonly<Record<string, unknown>> {
  return {
    assigneeMemberId: value.assigneeMemberId ?? 'member-001',
    completedAt: value.completedAt ?? null,
    createdAt: UPDATED_AT,
    delegationChainJson: value.delegationChainJson ?? '[]',
    id: value.id,
    instanceId: INSTANCE_ID,
    nodeId: 'task',
    openedAt: null,
    originalAssigneeMemberId: 'member-001',
    slaDueAt: null,
    status: value.status,
    tokenId: 'token-1',
  };
}

function readWorkflowToken(): Readonly<Record<string, unknown>> {
  return {
    consumedAt: null,
    createdAt: UPDATED_AT,
    currentNodeId: 'task',
    id: 'token-1',
    instanceId: INSTANCE_ID,
    parentTokenId: null,
    status: 'WAITING',
  };
}

function readTransferActivityLogs(
  transferred: boolean,
): readonly Readonly<Record<string, unknown>>[] {
  return transferred
    ? [
        {
          actorMemberId: 'member-001',
          createdAt: UPDATED_AT,
          eventType: 'TASK_DECIDED',
          id: 'activity-transfer',
          nodeId: 'task',
          payloadJson: JSON.stringify({
            action: 'TRANSFERRED',
            comment: '請財務主管協助',
            decisionId: 'decision-1',
            transferToMemberId: 'member-101',
          }),
          taskId: TASK_ID,
        },
      ]
    : [
        {
          actorMemberId: null,
          createdAt: UPDATED_AT,
          eventType: 'TASK_CREATED',
          id: 'activity-created',
          nodeId: 'task',
          payloadJson: JSON.stringify({
            assigneeMemberId: 'member-001',
            originalAssigneeMemberId: 'member-001',
            tokenId: 'token-1',
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

    if (memberId === 'member-101') {
      return {
        email: 'chen.manager@example.internal',
        memberId,
        name: '陳財務主管',
      };
    }

    return {
      email: 'wu.staff@example.internal',
      memberId,
      name: '吳財務專員',
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
