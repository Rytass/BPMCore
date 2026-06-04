/**
 * Shared types, helpers, and label functions used across
 * InstanceDetailView section components.
 */

import {
  ActivityLogRecord,
  ApprovalInstanceRecord,
  AttachmentRecord,
  MemberProfileRecord,
  SignatureRecord,
  SignatureVerificationRecord,
  TaskDecisionRecord,
  TaskRecord,
  WorkflowTokenRecord,
} from '@rytass/bpm-core-client/workflow';
import { WorkflowDefinition, WorkflowNode } from '@rytass/bpm-core-shared/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type TaskRow = Readonly<
  Record<string, unknown> &
    TaskRecord & {
      assigneeLabel: string;
      key: string;
      nodeLabel: string;
      statusLabel: string;
    }
>;

export type AttachmentRow = Readonly<
  Record<string, unknown> & {
    attachment: AttachmentRecord;
    createdAt: string;
    filename: string;
    id: string;
    key: string;
    mimeType: string;
    sizeLabel: string;
  }
>;

export type SignatureRow = Readonly<
  Record<string, unknown> & {
    algorithm: string;
    hashLabel: string;
    key: string;
    keyVersion: number;
    signedAtLabel: string;
    signerMemberId: string;
  }
>;

export type MemberOption = Readonly<{
  email: string | null;
  id: string;
  name: string;
}>;

// ---------------------------------------------------------------------------
// Activity step types (used by InstanceHistorySection)
// ---------------------------------------------------------------------------

export type ActivityStepDescriptionPart =
  | Readonly<{ text: string; type: 'text' }>
  | Readonly<{ text: string; type: 'dangerText' }>
  | Readonly<{
      email: string | null;
      label: string;
      memberId: string | null;
      prefix: string;
      type: 'member';
    }>;

export interface ActivityStepRecord {
  readonly descriptionParts: readonly ActivityStepDescriptionPart[];
  readonly error: boolean;
  readonly forcePending?: boolean;
  readonly id: string;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Delegation chain
// ---------------------------------------------------------------------------

interface DelegationChainStep {
  readonly from: string;
  readonly reason: string;
  readonly ruleId: string | null;
  readonly to: string;
}

function readDelegationChainStep(
  item: Readonly<Record<string, unknown>>,
): DelegationChainStep | null {
  const from = readStringField(item, 'from');
  const to = readStringField(item, 'to');
  const reason = readStringField(item, 'reason');

  if (!from || !to || !reason) {
    return null;
  }

  return {
    from,
    reason,
    ruleId: readStringField(item, 'ruleId'),
    to,
  };
}

export function readDelegationChain(value: string): readonly DelegationChainStep[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed
          .map((item): DelegationChainStep | null =>
            isRecord(item) ? readDelegationChainStep(item) : null,
          )
          .filter((item): item is DelegationChainStep => item !== null)
      : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generic field readers
// ---------------------------------------------------------------------------

export function readStringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];

  return typeof value === 'string' ? value : null;
}

export function readStringArrayField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function readNumberField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = record[key];

  return typeof value === 'number' ? value : null;
}

// ---------------------------------------------------------------------------
// Type guards / predicates
// ---------------------------------------------------------------------------

export function isPresentText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function isPendingTask(task: TaskRecord): boolean {
  return task.status === 'PENDING' || task.status === 'IN_PROGRESS';
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '-';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function readShortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 12)}...` : hash;
}

export function readInstanceStateLabel(state: string): string {
  if (state === 'APPROVED') return '已同意';
  if (state === 'CANCELLED') return '已取消';
  if (state === 'DRAFT') return '草稿';
  if (state === 'EXPIRED') return '已逾期';
  if (state === 'REJECTED') return '已拒絕';
  if (state === 'RETURNED') return '已退回';
  if (state === 'RUNNING') return '進行中';

  return state;
}

export function readTaskStatusLabel(status: TaskRecord['status']): string {
  if (status === 'PENDING') return '待處理';
  if (status === 'IN_PROGRESS') return '處理中';
  if (status === 'COMPLETED') return '已完成';
  if (status === 'CANCELLED') return '已取消';
  if (status === 'TRANSFERRED') return '已轉派';

  return status;
}

export function readTaskDecisionActionLabel(action: string): string {
  if (action === 'APPROVED') return '同意';
  if (action === 'REJECTED') return '拒絕';
  if (action === 'RETURNED') return '退回';
  if (action === 'TRANSFERRED') return '轉派';

  return action;
}

export function readNodeKindLabel(type: WorkflowNode['type']): string {
  if (type === 'startEvent') return '開始';
  if (type === 'endEvent') return '完成';
  if (type === 'userTask') return '簽核節點';
  if (type === 'serviceTask') return '知會節點';
  if (type === 'exclusiveGateway') return '條件分流';

  return '平行處理';
}

export function readNodeDisplayLabel(
  nodeId: string,
  workflow: WorkflowDefinition | null,
): string {
  return (
    workflow?.nodes.find((node) => node.id === nodeId)?.data.label ?? nodeId
  );
}

export function readMemberDisplayText(
  memberId: string | null,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
): string {
  if (!memberId) {
    return '-';
  }

  const profile = memberProfilesById.get(memberId);

  return profile ? `${profile.name}（${profile.email}）` : memberId;
}

export function readTaskAssigneeLabel(
  task: TaskRecord,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord> = new Map(),
): string {
  const delegationChain = readDelegationChain(task.delegationChainJson);

  if (!task.assigneeMemberId) {
    return task.candidateMemberIds.length
      ? `候選 ${task.candidateMemberIds
          .map((memberId) => readMemberDisplayText(memberId, memberProfilesById))
          .join('、')}`
      : '未指定';
  }

  const assigneeLabel = readMemberDisplayText(
    task.assigneeMemberId,
    memberProfilesById,
  );
  const originalAssigneeLabel = readMemberDisplayText(
    task.originalAssigneeMemberId,
    memberProfilesById,
  );

  if (
    delegationChain.length === 0 ||
    task.originalAssigneeMemberId === task.assigneeMemberId
  ) {
    return assigneeLabel;
  }

  return `${assigneeLabel}（原：${originalAssigneeLabel}）`;
}

export function canMemberActOnTask(
  task: TaskRecord,
  memberId: string | null,
): boolean {
  if (!memberId) {
    return false;
  }

  return (
    task.assigneeMemberId === memberId ||
    task.candidateMemberIds.includes(memberId)
  );
}

export function readReturnTargetOptions(
  workflow: WorkflowDefinition,
  node: WorkflowNode,
): readonly { readonly id: string; readonly name: string }[] {
  if (node.type !== 'userTask' || !node.data.returnBehavior.allowReturn) {
    return [];
  }

  if (node.data.returnBehavior.allowedTargets === 'ANY') {
    return workflow.nodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        id: candidate.id,
        name: `${candidate.data.label}（${readNodeKindLabel(candidate.type)}）`,
      }));
  }

  const targetNodeId =
    node.data.returnBehavior.allowedTargets === 'INITIATOR'
      ? workflow.nodes.find((candidate) => candidate.type === 'startEvent')?.id
      : workflow.edges.find((edge) => edge.target === node.id)?.source;
  const targetNode = workflow.nodes.find(
    (candidate) => candidate.id === targetNodeId,
  );

  return targetNode
    ? [
        {
          id: targetNode.id,
          name: `${targetNode.data.label}（${readNodeKindLabel(targetNode.type)}）`,
        },
      ]
    : [];
}

export function readMemberOption(profile: MemberProfileRecord): MemberOption {
  return {
    email: profile.email,
    id: profile.memberId,
    name: `${profile.name} · ${profile.email}`,
  };
}

export function readMemberOptionFromValue(value: unknown): MemberOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const email = value.email;
  const id = value.id;
  const name = value.name;

  return typeof id === 'string' && typeof name === 'string'
    ? { email: typeof email === 'string' ? email : null, id, name }
    : null;
}

export function readUniqueMemberOption(
  searchText: string,
  options: readonly MemberOption[],
): MemberOption | null {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return null;
  }

  const matches = options.filter((option) =>
    [option.id, option.name, option.email ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearchText),
    ),
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Activity step helpers
// ---------------------------------------------------------------------------

export function readTextDescriptionPart(
  text: string | null,
): ActivityStepDescriptionPart | null {
  return isPresentText(text) ? { text, type: 'text' } : null;
}

export function readDangerTextDescriptionPart(
  text: string | null,
): ActivityStepDescriptionPart | null {
  return isPresentText(text) ? { text, type: 'dangerText' } : null;
}

export function readMemberDescriptionPart(
  prefix: string,
  memberId: string | null,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
  fallbackLabel: string,
): ActivityStepDescriptionPart {
  const profile = memberId ? memberProfilesById.get(memberId) : null;

  return {
    email: profile?.email ?? null,
    label: profile?.name ?? fallbackLabel,
    memberId,
    prefix,
    type: 'member',
  };
}

export function isActivityDescriptionPart(
  part: ActivityStepDescriptionPart | null,
): part is ActivityStepDescriptionPart {
  return Boolean(part);
}

export function readCurrentActivityStep(
  activitySteps: readonly ActivityStepRecord[],
): number {
  const firstPendingStepIndex = activitySteps.findIndex(
    (activityStep) =>
      activityStep.id.startsWith('pending-task-') ||
      activityStep.id.startsWith('future-node-'),
  );

  return firstPendingStepIndex === -1
    ? activitySteps.length
    : firstPendingStepIndex;
}

export function isUserMeaningfulActivity(activityLog: ActivityLogRecord): boolean {
  return (
    activityLog.eventType === 'INSTANCE_STARTED' ||
    activityLog.eventType === 'TASK_DECIDED' ||
    activityLog.eventType === 'SLA_TRIGGERED'
  );
}

function readTaskDecisionEventLabel(action: string | null): string {
  if (action === 'APPROVED') return '已同意';
  if (action === 'REJECTED') return '已拒絕';
  if (action === 'RETURNED') return '已退回';
  if (action === 'TRANSFERRED') return '已轉派';

  return '簽核已決議';
}

export function readActivityEventLabel(
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  if (eventType === 'INSTANCE_STARTED') return '案件已發起';
  if (eventType === 'TOKEN_CREATED') return '流程路徑已建立';
  if (eventType === 'ENGINE_PROCESS_REQUESTED') return '流程引擎已處理';
  if (eventType === 'TOKEN_ADVANCED') return '流程已前進';
  if (eventType === 'TASK_CREATED') return '待簽任務已建立';
  if (eventType === 'TASK_DECIDED') {
    return readTaskDecisionEventLabel(readStringField(payload, 'action'));
  }
  if (eventType === 'SLA_TRIGGERED') return '時限提醒已觸發';

  return eventType;
}

export function readActivityPayload(
  activityLog: ActivityLogRecord,
): Readonly<Record<string, unknown>> {
  try {
    const payload = JSON.parse(activityLog.payloadJson) as unknown;

    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

export function isActivityError(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return (
    activityLog.eventType === 'SLA_TRIGGERED' ||
    readStringField(payload, 'action') === 'REJECTED' ||
    readStringField(payload, 'instanceState') === 'REJECTED'
  );
}

export function formatActivityDateTime(value: string): string {
  return formatDateTime(value);
}

function readActivityDetail(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowDefinition | null,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
): string | null {
  if (activityLog.eventType === 'TASK_CREATED') {
    const assigneeMemberId = readStringField(payload, 'assigneeMemberId');
    const originalAssigneeMemberId = readStringField(
      payload,
      'originalAssigneeMemberId',
    );

    if (!assigneeMemberId) {
      const candidateMemberIds = readStringArrayField(
        payload,
        'candidateMemberIds',
      );

      return candidateMemberIds.length
        ? `候選簽核人：${candidateMemberIds
            .map((memberId) =>
              readMemberDisplayText(memberId, memberProfilesById),
            )
            .join('、')}`
        : null;
    }

    const assigneeLabel = readMemberDisplayText(
      assigneeMemberId,
      memberProfilesById,
    );
    const originalAssigneeLabel = readMemberDisplayText(
      originalAssigneeMemberId,
      memberProfilesById,
    );

    return originalAssigneeMemberId &&
      originalAssigneeMemberId !== assigneeMemberId
      ? `待簽人：${assigneeLabel}（原簽核人：${originalAssigneeLabel}）`
      : `待簽人：${assigneeLabel}`;
  }

  if (activityLog.eventType === 'TASK_DECIDED') {
    const action = readStringField(payload, 'action');
    const comment = readStringField(payload, 'comment');
    const decisionLabel = action
      ? `決議：${readTaskDecisionActionLabel(action)}`
      : null;

    const transferToMemberId = readStringField(payload, 'transferToMemberId');

    return action === 'REJECTED' && comment
      ? [decisionLabel, `拒絕原因：${comment}`]
          .filter(isPresentText)
          .join(' · ')
      : action === 'TRANSFERRED'
        ? [
            decisionLabel,
            `轉派給：${readMemberDisplayText(
              transferToMemberId,
              memberProfilesById,
            )}`,
          ]
            .filter(isPresentText)
            .join(' · ')
        : decisionLabel;
  }

  if (activityLog.eventType === 'TOKEN_ADVANCED') {
    const action = readStringField(payload, 'action');

    if (action) {
      return `流程結果：${readTaskDecisionActionLabel(action)}`;
    }

    const arrivedCount = readNumberField(payload, 'arrivedCount');
    const requiredCount = readNumberField(payload, 'requiredCount');

    if (arrivedCount !== null && requiredCount !== null) {
      return `等待匯合：${arrivedCount}/${requiredCount}`;
    }

    const fromNodeId = readStringField(payload, 'fromNodeId');
    const toNodeId = readStringField(payload, 'toNodeId');

    if (fromNodeId && toNodeId) {
      return `由 ${readNodeDisplayLabel(fromNodeId, workflow)} 前進至 ${readNodeDisplayLabel(toNodeId, workflow)}`;
    }
  }

  if (activityLog.eventType === 'ENGINE_PROCESS_REQUESTED') {
    const state = readStringField(payload, 'state');

    return state ? `案件狀態：${readInstanceStateLabel(state)}` : null;
  }

  return null;
}

export function readActivityDetailParts(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowDefinition | null,
  taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  signatureVerification: SignatureVerificationRecord | null,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
): readonly ActivityStepDescriptionPart[] {
  if (activityLog.eventType !== 'TASK_DECIDED') {
    return [
      readTextDescriptionPart(
        readActivityDetail(
          activityLog,
          payload,
          workflow,
          memberProfilesById,
        ),
      ),
    ].filter(isActivityDescriptionPart);
  }

  const taskDecision = activityLog.taskId
    ? taskDecisionsByTaskId.get(activityLog.taskId)
    : null;
  const action =
    readStringField(payload, 'action') ?? taskDecision?.action ?? null;
  const comment =
    readStringField(payload, 'comment') ?? taskDecision?.comment ?? null;
  const transferToMemberId =
    readStringField(payload, 'transferToMemberId') ??
    taskDecision?.transferToMemberId ??
    null;
  const signatureId =
    readStringField(payload, 'signatureId') ??
    taskDecision?.signatureId ??
    null;
  const signature = signatureId ? signaturesById.get(signatureId) : null;
  const decisionLabel = action
    ? `決議：${readTaskDecisionActionLabel(action)}`
    : null;

  return [
    readTextDescriptionPart(decisionLabel),
    action === 'REJECTED'
      ? readDangerTextDescriptionPart(`拒絕原因：${comment ?? '-'}`)
      : null,
    action === 'RETURNED'
      ? readTextDescriptionPart(`退回說明：${comment ?? '-'}`)
      : null,
    action === 'TRANSFERRED'
      ? readTextDescriptionPart(
          `轉派給：${readMemberDisplayText(
            transferToMemberId,
            memberProfilesById,
          )}`,
        )
      : null,
    action === 'TRANSFERRED'
      ? readTextDescriptionPart(`轉派說明：${comment ?? '-'}`)
      : null,
    signature
      ? readTextDescriptionPart(
          signatureVerification?.valid
            ? `簽章：已驗證（${readShortHash(signature.signedPayloadHash)}）`
            : `簽章：待檢查（${readShortHash(signature.signedPayloadHash)}）`,
        )
      : null,
  ].filter(isActivityDescriptionPart);
}

export function isFutureTimelineNode(
  node: WorkflowNode,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: ApprovalInstanceRecord['state'],
  representedNodeIds: ReadonlySet<string>,
): boolean {
  if (node.type === 'startEvent' || representedNodeIds.has(node.id)) {
    return false;
  }

  if (instanceState === 'REJECTED') {
    return true;
  }

  const state = readNodeRuntimeState(node, tasks, tokens, instanceState);

  return state.tone === 'neutral' || state.tone === 'waiting';
}

export function readFutureTimelineNodes(
  workflow: WorkflowDefinition,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: ApprovalInstanceRecord['state'],
  representedNodeIds: ReadonlySet<string>,
): readonly WorkflowNode[] {
  if (instanceState !== 'RUNNING' && instanceState !== 'REJECTED') {
    return [];
  }

  const futureNodes = workflow.nodes.filter((node) =>
    isFutureTimelineNode(
      node,
      tasks,
      tokens,
      instanceState,
      representedNodeIds,
    ),
  );
  const reachableDistances = readReachableFutureNodeDistances(
    workflow,
    futureNodes,
    tasks,
    tokens,
    representedNodeIds,
  );
  const originalNodeIndexes = new Map(
    workflow.nodes.map((node, index) => [node.id, index]),
  );

  return futureNodes
    .filter((node) => reachableDistances.has(node.id))
    .sort((left, right) => {
      const leftDistance = reachableDistances.get(left.id) ?? 0;
      const rightDistance = reachableDistances.get(right.id) ?? 0;

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (left.position.x !== right.position.x) {
        return left.position.x - right.position.x;
      }

      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y;
      }

      return (
        (originalNodeIndexes.get(left.id) ?? 0) -
        (originalNodeIndexes.get(right.id) ?? 0)
      );
    });
}

function readReachableFutureNodeDistances(
  workflow: WorkflowDefinition,
  futureNodes: readonly WorkflowNode[],
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  representedNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const futureNodeIds = new Set(futureNodes.map((node) => node.id));
  const outgoingNodeIds = workflow.edges.reduce<
    ReadonlyMap<string, readonly string[]>
  >((groups, edge) => {
    const nextTargets = [...(groups.get(edge.source) ?? []), edge.target];

    return new Map(groups).set(edge.source, nextTargets);
  }, new Map());
  const frontierNodeIds = readFutureTimelineFrontierNodeIds(
    workflow,
    tasks,
    tokens,
    representedNodeIds,
  );

  return frontierNodeIds.reduce<ReadonlyMap<string, number>>(
    (distances, nodeId) =>
      mergeFutureNodeDistances(
        distances,
        readFutureNodeDistancesFrom(nodeId, outgoingNodeIds, futureNodeIds),
      ),
    new Map(),
  );
}

function readFutureTimelineFrontierNodeIds(
  workflow: WorkflowDefinition,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  representedNodeIds: ReadonlySet<string>,
): readonly string[] {
  const tokenNodeIds = tokens
    .filter((token) => token.status === 'ACTIVE' || token.status === 'WAITING')
    .map((token) => token.currentNodeId);
  const pendingTaskNodeIds = tasks
    .filter(isPendingTask)
    .map((task) => task.nodeId);
  const representedFrontierNodeIds = workflow.nodes
    .filter((node) => representedNodeIds.has(node.id))
    .map((node) => node.id);
  const activeFrontierNodeIds = [
    ...new Set([
      ...tokenNodeIds,
      ...pendingTaskNodeIds,
      ...representedFrontierNodeIds,
    ]),
  ];
  const startNodeIds = workflow.nodes
    .filter((node) => node.type === 'startEvent')
    .map((node) => node.id);

  return activeFrontierNodeIds.length > 0
    ? activeFrontierNodeIds
    : startNodeIds;
}

function readFutureNodeDistancesFrom(
  startNodeId: string,
  outgoingNodeIds: ReadonlyMap<string, readonly string[]>,
  futureNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const initialQueue: readonly {
    readonly distance: number;
    readonly nodeId: string;
  }[] = [{ distance: 0, nodeId: startNodeId }];

  return walkFutureNodeDistances(initialQueue, outgoingNodeIds, futureNodeIds);
}

function walkFutureNodeDistances(
  queue: readonly { readonly distance: number; readonly nodeId: string }[],
  outgoingNodeIds: ReadonlyMap<string, readonly string[]>,
  futureNodeIds: ReadonlySet<string>,
  visitedNodeIds: ReadonlySet<string> = new Set(),
  distances: ReadonlyMap<string, number> = new Map(),
): ReadonlyMap<string, number> {
  const [current, ...restQueue] = queue;

  if (!current) {
    return distances;
  }

  if (visitedNodeIds.has(current.nodeId)) {
    return walkFutureNodeDistances(
      restQueue,
      outgoingNodeIds,
      futureNodeIds,
      visitedNodeIds,
      distances,
    );
  }

  const nextVisitedNodeIds = new Set(visitedNodeIds).add(current.nodeId);
  const nextDistances = futureNodeIds.has(current.nodeId)
    ? new Map(distances).set(
        current.nodeId,
        Math.min(
          distances.get(current.nodeId) ?? current.distance,
          current.distance,
        ),
      )
    : distances;
  const nextQueue = [
    ...restQueue,
    ...(outgoingNodeIds.get(current.nodeId) ?? []).map((nodeId) => ({
      distance: current.distance + 1,
      nodeId,
    })),
  ];

  return walkFutureNodeDistances(
    nextQueue,
    outgoingNodeIds,
    futureNodeIds,
    nextVisitedNodeIds,
    nextDistances,
  );
}

function mergeFutureNodeDistances(
  currentDistances: ReadonlyMap<string, number>,
  nextDistances: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  return [...nextDistances.entries()].reduce<ReadonlyMap<string, number>>(
    (mergedDistances, [nodeId, distance]) =>
      new Map(mergedDistances).set(
        nodeId,
        Math.min(mergedDistances.get(nodeId) ?? distance, distance),
      ),
    currentDistances,
  );
}

export function readFutureNodeStepTitle(node: WorkflowNode): string {
  if (node.type === 'userTask') return `未來簽核：${node.data.label}`;
  if (node.type === 'serviceTask') return `未來知會：${node.data.label}`;
  if (node.type === 'exclusiveGateway') return `未來分流：${node.data.label}`;
  if (node.type === 'parallelGateway') return `未來匯合：${node.data.label}`;
  if (node.type === 'endEvent') return `流程完成：${node.data.label}`;

  return `未來節點：${node.data.label}`;
}

export function readActivityStepRecords(
  activityLogs: readonly ActivityLogRecord[],
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  workflow: WorkflowDefinition | null,
  instanceState: ApprovalInstanceRecord['state'],
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
  taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  signatureVerification: SignatureVerificationRecord | null,
): ActivityStepRecord[] {
  const historySteps = activityLogs
    .filter(isUserMeaningfulActivity)
    .map((activityLog): ActivityStepRecord => {
      const payload = readActivityPayload(activityLog);
      const nodeLabel = activityLog.nodeId
        ? readNodeDisplayLabel(activityLog.nodeId, workflow)
        : null;
      const descriptionParts = [
        readTextDescriptionPart(
          nodeLabel ? `節點：${nodeLabel}` : '節點：全流程',
        ),
        readMemberDescriptionPart(
          '操作者',
          activityLog.actorMemberId,
          memberProfilesById,
          '系統',
        ),
        readTextDescriptionPart(
          `時間：${formatActivityDateTime(activityLog.createdAt)}`,
        ),
        ...readActivityDetailParts(
          activityLog,
          payload,
          workflow,
          taskDecisionsByTaskId,
          signaturesById,
          signatureVerification,
          memberProfilesById,
        ),
      ].filter(isActivityDescriptionPart);

      return {
        descriptionParts,
        error: isActivityError(activityLog, payload),
        id: activityLog.id,
        title: readActivityEventLabel(activityLog.eventType, payload),
      };
    });
  const pendingTaskSteps = tasks.filter(isPendingTask).map(
    (task): ActivityStepRecord => ({
      descriptionParts: [
        readTextDescriptionPart(
          `節點：${readNodeDisplayLabel(task.nodeId, workflow)}`,
        ),
        readMemberDescriptionPart(
          '處理者',
          task.assigneeMemberId,
          memberProfilesById,
          '未指定',
        ),
        readTextDescriptionPart(
          `建立時間：${formatActivityDateTime(task.createdAt)}`,
        ),
      ].filter(isActivityDescriptionPart),
      error: false,
      id: `pending-task-${task.id}`,
      title: task.status === 'IN_PROGRESS' ? '簽核處理中' : '等待簽核處理',
    }),
  );
  const representedNodeIds = new Set(
    [
      ...activityLogs
        .filter(isUserMeaningfulActivity)
        .map((activityLog) => activityLog.nodeId),
      ...tasks.map((task) => task.nodeId),
    ].filter(isPresentText),
  );
  const futureNodeSteps = workflow
    ? readFutureTimelineNodes(
        workflow,
        tasks,
        tokens,
        instanceState,
        representedNodeIds,
      ).map(
        (node): ActivityStepRecord => ({
          descriptionParts: [
            readTextDescriptionPart(
              `${readNodeKindLabel(node.type)} · 尚未抵達`,
            ),
          ].filter(isActivityDescriptionPart),
          error: false,
          forcePending: true,
          id: `future-node-${node.id}`,
          title: readFutureNodeStepTitle(node),
        }),
      )
    : [];

  return [...historySteps, ...pendingTaskSteps, ...futureNodeSteps];
}

// ---------------------------------------------------------------------------
// Node runtime state (used by flow canvas AND history)
// ---------------------------------------------------------------------------

type RuntimeTone = 'cancelled' | 'completed' | 'current' | 'neutral' | 'waiting';

export function readNodeRuntimeState(
  node: WorkflowNode,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: string,
): Readonly<{
  secondaryLabel: string;
  statusLabel: string;
  tone: RuntimeTone;
}> {
  const nodeTasks = tasks.filter((task) => task.nodeId === node.id);
  const pendingTask = nodeTasks.find(
    (task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS',
  );
  const cancelledTask = nodeTasks.find((task) => task.status === 'CANCELLED');
  const completedTask = nodeTasks.find((task) => task.status === 'COMPLETED');
  const nodeTokens = tokens.filter((token) => token.currentNodeId === node.id);
  const activeToken = nodeTokens.find((token) => token.status === 'ACTIVE');
  const waitingToken = nodeTokens.find((token) => token.status === 'WAITING');

  if (pendingTask) {
    return {
      secondaryLabel: `處理者 ${readTaskAssigneeLabel(pendingTask)}`,
      statusLabel: '待處理',
      tone: 'current',
    };
  }

  if (cancelledTask) {
    return {
      secondaryLabel: `已取消 ${readTaskAssigneeLabel(cancelledTask)}`,
      statusLabel: '已取消',
      tone: 'cancelled',
    };
  }

  if (completedTask) {
    return {
      secondaryLabel: `已完成 ${readTaskAssigneeLabel(completedTask)}`,
      statusLabel: '已完成',
      tone: 'completed',
    };
  }

  if (activeToken) {
    return {
      secondaryLabel: `token ${activeToken.id}`,
      statusLabel: '執行中',
      tone: 'current',
    };
  }

  if (waitingToken) {
    return {
      secondaryLabel: `token ${waitingToken.id}`,
      statusLabel: '等待前置',
      tone: 'waiting',
    };
  }

  if (node.type === 'startEvent') {
    return {
      secondaryLabel: '流程已發起',
      statusLabel: '已發起',
      tone: 'completed',
    };
  }

  if (node.type === 'endEvent' && instanceState !== 'RUNNING') {
    return {
      secondaryLabel: instanceState,
      statusLabel: instanceState === 'REJECTED' ? '已拒絕' : '已完成',
      tone: instanceState === 'REJECTED' ? 'cancelled' : 'completed',
    };
  }

  return {
    secondaryLabel: readNodeKindLabel(node.type),
    statusLabel: '未抵達',
    tone: 'neutral',
  };
}
