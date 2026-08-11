import { expect, Page, Route, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const INSTANCE_ID = 'candidate-instance';
const TASK_ID = 'candidate-task';
const UPDATED_AT = '2026-05-13T10:00:00.000Z';

test.describe('candidate approver tasks', () => {
  test.beforeEach(async ({ page }): Promise<void> => {
    await authenticateApiMember(page);
  });

  test('allows a candidate member to act on a group task', async ({
    page,
  }): Promise<void> => {
    await mockCandidateWorkflowGraphQl(page);

    await page.goto(`/instances/${INSTANCE_ID}`);

    await expect(
      page.getByText(
        '候選 member-001（member-001@example.internal）、member-002（member-002@example.internal）',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '同意' })).toBeVisible();

    await page.getByRole('button', { name: '同意' }).click();
    await expect(page.getByRole('heading', { name: '簽核意見' })).toBeVisible();
    await page.getByRole('button', { name: '送出同意' }).click();

    await expect(page.getByText(/已同意/)).toBeVisible();
    await expect(page.getByRole('button', { name: '同意' })).toHaveCount(0);
  });
});

async function mockCandidateWorkflowGraphQl(page: Page): Promise<void> {
  let approved = false;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query ApprovalInstance')) {
      await fulfillGraphQl(route, {
        activityLogs: [
          {
            actorMemberId: null,
            createdAt: UPDATED_AT,
            eventType: 'TASK_CREATED',
            id: 'activity-task-created',
            nodeId: 'task_review',
            payloadJson: JSON.stringify({
              candidateMemberIds: ['member-001', 'member-002'],
              taskId: TASK_ID,
            }),
            taskId: TASK_ID,
          },
        ],
        approvalInstance: readInstance(approved ? 'APPROVED' : 'RUNNING'),
        tasks: [
          {
            assigneeMemberId: approved ? 'member-001' : null,
            assignmentType: 'CANDIDATE_GROUP',
            candidateMemberIds: ['member-001', 'member-002'],
            completedAt: approved ? UPDATED_AT : null,
            createdAt: UPDATED_AT,
            decisionPolicySnapshotJson: JSON.stringify({ type: 'SINGLE' }),
            delegationChainJson: '[]',
            id: TASK_ID,
            instanceId: INSTANCE_ID,
            nodeId: 'task_review',
            openedAt: approved ? UPDATED_AT : null,
            originalAssigneeMemberId: approved ? 'member-001' : null,
            slaDueAt: null,
            status: approved ? 'COMPLETED' : 'PENDING',
            tokenId: 'token-1',
          },
        ],
        workflowTokens: [
          {
            consumedAt: approved ? UPDATED_AT : null,
            createdAt: UPDATED_AT,
            currentNodeId: 'task_review',
            id: 'token-1',
            instanceId: INSTANCE_ID,
            parentTokenId: null,
            status: approved ? 'CONSUMED' : 'WAITING',
          },
        ],
      });
      return;
    }

    if (query.includes('mutation DecideTask')) {
      approved = true;
      await fulfillGraphQl(route, {
        decideTask: {
          action: 'APPROVED',
          comment: null,
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

    if (query.includes('query TaskDecisions')) {
      await fulfillGraphQl(route, {
        taskDecisions: approved
          ? [
              {
                action: 'APPROVED',
                comment: null,
                decidedAt: UPDATED_AT,
                decidedByMemberId: 'member-001',
                id: 'decision-1',
                returnToNodeId: null,
                signatureId: 'signature-1',
                taskId: TASK_ID,
                transferToMemberId: null,
              },
            ]
          : [],
      });
      return;
    }

    if (query.includes('query InstanceMembers')) {
      await fulfillGraphQl(route, {
        members: readMemberProfiles(readMemberIds(payload.variables)),
      });
      return;
    }

    if (query.includes('query InstanceAttachments')) {
      await fulfillGraphQl(route, { attachments: [] });
      return;
    }

    if (query.includes('query InstanceSignatures')) {
      await fulfillGraphQl(route, {
        signatures: [],
        verifySignatureChain: {
          checkedCount: 0,
          errors: [],
          instanceId: INSTANCE_ID,
          valid: true,
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readInstance(state: 'APPROVED' | 'RUNNING'): Readonly<Record<string, unknown>> {
  return {
    completedAt: state === 'APPROVED' ? UPDATED_AT : null,
    formDataJson: '{}',
    formDefinitionSnapshotJson: JSON.stringify({
      schema: { fields: [], version: 1 },
      uiSchema: { layout: [] },
      version: 1,
    }),
    id: INSTANCE_ID,
    initiatorMemberId: 'member-003',
    startedAt: UPDATED_AT,
    state,
    templateId: 'candidate-template',
    templateVersionId: 'candidate-template-version',
    title: '候選簽核 E2E',
    workflowSnapshotJson: JSON.stringify(readWorkflowDefinition()),
  };
}

function readWorkflowDefinition(): Readonly<Record<string, unknown>> {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: false,
          approverResolver: {
            memberIds: ['member-001', 'member-002'],
            type: 'DIRECT',
          },
          decisionPolicy: { type: 'SINGLE' },
          label: '候選簽核',
          returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
          triggerMode: 'AND',
        },
        id: 'task_review',
        position: { x: 240, y: 0 },
        type: 'userTask',
      },
    ],
  };
}

function readMemberIds(
  variables: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const memberIds = variables?.memberIds;

  return Array.isArray(memberIds)
    ? memberIds.filter((memberId): memberId is string => typeof memberId === 'string')
    : [];
}

function readMemberProfiles(
  memberIds: readonly string[],
): readonly Readonly<Record<string, string>>[] {
  return memberIds.map((memberId) => ({
    email: `${memberId}@example.internal`,
    memberId,
    name: memberId,
  }));
}

function readGraphQlPayload(route: Route): GraphQlPayload {
  return JSON.parse(route.request().postData() ?? '{}') as GraphQlPayload;
}

async function fulfillGraphQl(
  route: Route,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  await route.fulfill({
    contentType: 'application/json',
    status: 200,
    body: JSON.stringify({ data }),
  });
}
