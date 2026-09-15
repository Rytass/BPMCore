import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  isFormIdentifierKey,
  isFormOptionFieldDefinition,
  isFormStaticOptionFieldDefinition,
  readFormFieldSelectionMode,
} from './form';
import {
  ApproverResolver,
  DecisionPolicy,
  NotifyWebhookBindingSource,
  NotifyWebhookContextPath,
  NotifyWebhookEndpointReference,
  NotifyWebhookParameterType,
  NotifyWebhookTarget,
  ServiceAction,
  SlaCalendarMode,
  SlaConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowEdgeConditionOperator,
  WorkflowEdgeData,
  WorkflowNode,
  WorkflowNodeTriggerMode,
} from './workflow';

/**
 * Pure, framework-agnostic structural operations over a {@link WorkflowDefinition}.
 *
 * This module is the canonical home for every transform that the template
 * designer performs on the workflow graph. It intentionally contains **no**
 * React, DOM, or layout (dagre) dependency so that both the frontend designer
 * and the backend can share the exact same semantics, and so the LLM command
 * layer ({@link ./workflow-command}) can be built on top of it.
 *
 * Pixel layout (dagre) and ReactFlow node/edge mapping stay in the React lib;
 * the structures here only describe the logical graph.
 */

/** Node types a user can add from the palette (start/end are implicit). */
export type NodePaletteType = 'exclusiveGateway' | 'serviceTask' | 'userTask';

export const WORKFLOW_INPUT_HANDLE_ID = 'input';
export const WORKFLOW_OUTPUT_HANDLE_ID = 'output';

export const WORKFLOW_NODE_TYPE_LABELS: Readonly<
  Record<WorkflowNode['type'], string>
> = {
  endEvent: '結束',
  exclusiveGateway: '條件分流',
  parallelGateway: '並行處理',
  serviceTask: '系統',
  startEvent: '開始',
  userTask: '簽核',
};

export interface ConditionOperatorOption {
  readonly id: WorkflowEdgeConditionOperator;
  readonly name: string;
}

export const CONDITION_OPERATOR_OPTIONS: readonly ConditionOperatorOption[] = [
  { id: 'EQUALS', name: '等於' },
  { id: 'NOT_EQUALS', name: '不等於' },
  { id: 'GREATER_THAN', name: '大於' },
  { id: 'GREATER_THAN_OR_EQUALS', name: '大於等於' },
  { id: 'LESS_THAN', name: '小於' },
  { id: 'LESS_THAN_OR_EQUALS', name: '小於等於' },
  { id: 'IS_FILLED', name: '已填寫' },
  { id: 'IS_EMPTY', name: '未填寫' },
];

// ── SLA option catalogs & duration helpers ─────────────────────────────────

/**
 * The two duration shapes the designer and the LLM toolset are allowed to
 * author. Restricting authoring to a single unit keeps mixed ISO durations
 * such as `P1DT4H` out of templates, where `BUSINESS_DAY` semantics would be
 * ambiguous (the day part is business-day counted, a trailing time part is
 * not).
 */
export type SlaDurationUnit = 'DAY' | 'HOUR';

export interface SlaDurationParts {
  readonly unit: SlaDurationUnit;
  readonly value: number;
}

export interface SlaOption<T extends string> {
  readonly id: T;
  readonly name: string;
}

export const SLA_DURATION_UNIT_OPTIONS: readonly SlaOption<SlaDurationUnit>[] =
  [
    { id: 'DAY', name: '日' },
    { id: 'HOUR', name: '小時' },
  ];

export const SLA_CALENDAR_MODE_OPTIONS: readonly SlaOption<SlaCalendarMode>[] =
  [
    { id: 'CALENDAR', name: '日曆日' },
    { id: 'BUSINESS_DAY', name: '工作日' },
  ];

export const SLA_TIMEOUT_ACTION_OPTIONS: readonly SlaOption<
  SlaConfig['onTimeout']
>[] = [
  { id: 'REMIND', name: '提醒' },
  { id: 'AUTO_APPROVE', name: '自動核准' },
  { id: 'ESCALATE', name: '升級主管' },
  { id: 'TERMINATE_INSTANCE', name: '終止案件' },
];

export const DEFAULT_SLA_CONFIG: SlaConfig = {
  calendar: 'CALENDAR',
  duration: 'P2D',
  onTimeout: 'REMIND',
};

/** Builds the ISO 8601 duration for a single-unit SLA. */
export function composeSlaDuration(parts: SlaDurationParts): string {
  const value = Math.max(Math.trunc(parts.value), 1);

  return parts.unit === 'DAY' ? `P${value}D` : `PT${value}H`;
}

export const DEFAULT_QUORUM_THRESHOLD = 2;

/**
 * Sanitises a `QUORUM` threshold the same way {@link composeSlaDuration}
 * sanitises an SLA value: reject non-finite input, drop any fractional part,
 * and floor at 1. Nothing downstream rejects `threshold: 0` or a fractional
 * threshold — the publish lint only checks `decisionPolicy?.type` and the
 * engine merely clamps with `Math.max(threshold, 1)` rather than validating.
 *
 * `PERCENTAGE` additionally gets an upper bound of 100. The engine computes
 * `Math.ceil((totalCount * threshold) / 100)`, so a percentage above 100
 * always exceeds `totalCount` and the quorum can never complete.
 *
 * Lives here rather than in the designer because the LLM toolset writes the
 * same policy through `set_user_task_decision_policy`; a sanitiser that only
 * guarded the React form would leave the assistant as a hole straight past it.
 */
export function composeQuorumThreshold(
  value: number,
  thresholdType: 'COUNT' | 'PERCENTAGE',
): number {
  const sanitised = Number.isFinite(value) ? Math.max(Math.trunc(value), 1) : 1;

  return thresholdType === 'PERCENTAGE' ? Math.min(sanitised, 100) : sanitised;
}

/**
 * How many approvers a resolver is guaranteed to produce, or `null` when only
 * runtime can tell.
 *
 * Deliberately conservative: only `DIRECT` carries its member list in the
 * definition. Every other resolver depends on the org chart at the moment the
 * instance runs — an `ORG_MANAGER` may resolve to one manager, several, or
 * none (falling through to its fallback). Guessing a count for those would
 * reject templates that are in fact fine, which is worse than the check it
 * would buy.
 */
export function readDesignTimeApproverCount(
  resolver: ApproverResolver,
): number | null {
  return resolver.type === 'DIRECT' ? resolver.memberIds.length : null;
}

/**
 * `true` when a policy demands more approvals than its node can ever collect,
 * which leaves the task permanently incomplete: the engine gates on
 * `completedCount >= Math.max(threshold, 1)` against the candidates this
 * resolver produced, and an ad-hoc signer opens a *separate* task rather than
 * adding a candidate to this one, so there is no runtime escape.
 *
 * Only `COUNT` can reach that state. A `PERCENTAGE` threshold resolves to
 * `Math.ceil((totalCount * threshold) / 100)`, which never exceeds
 * `totalCount` once {@link composeQuorumThreshold} has capped it at 100.
 */
export function isDecisionPolicyUnsatisfiable(
  policy: DecisionPolicy | undefined,
  resolver: ApproverResolver,
): boolean {
  if (policy?.type !== 'QUORUM' || policy.thresholdType !== 'COUNT') {
    return false;
  }

  const available = readDesignTimeApproverCount(resolver);

  return available !== null && policy.threshold > available;
}

/**
 * Reads a single-unit ISO duration back into editable parts. Returns `null`
 * for durations the designer cannot represent (mixed or sub-hour values), so
 * callers can fall back to a read-only presentation instead of silently
 * rewriting a hand-authored template.
 */
export function readSlaDurationParts(
  duration: string,
): SlaDurationParts | null {
  const dayMatch = /^P(\d+)D$/u.exec(duration.trim());

  if (dayMatch) {
    return { unit: 'DAY', value: Number(dayMatch[1]) };
  }

  const hourMatch = /^PT(\d+)H$/u.exec(duration.trim());

  return hourMatch ? { unit: 'HOUR', value: Number(hourMatch[1]) } : null;
}

/**
 * `BUSINESS_DAY` only changes how the day component is advanced, so it is
 * meaningless for hour-based durations. The designer hides the selector in
 * that case and this predicate is the single source of that rule.
 */
export function isSlaCalendarModeApplicable(duration: string): boolean {
  return readSlaDurationParts(duration)?.unit === 'DAY';
}

export const CONDITION_OPERATORS_REQUIRING_VALUE: readonly WorkflowEdgeConditionOperator[] =
  [
    'EQUALS',
    'GREATER_THAN',
    'GREATER_THAN_OR_EQUALS',
    'LESS_THAN',
    'LESS_THAN_OR_EQUALS',
    'NOT_EQUALS',
  ];

export interface WorkflowConnectionCandidate {
  readonly source?: string | null;
  readonly sourceHandle?: string | null;
  readonly target?: string | null;
  readonly targetHandle?: string | null;
}

/** Result of inserting a node, including the post-insert selection intent. */
export interface WorkflowNodeInsertResult {
  readonly definition: WorkflowDefinition;
  readonly editingEdgeId: string | null;
  readonly selectedEdgeIds: readonly string[];
  readonly selectedNodeId: string | null;
}

/**
 * Factory used to mint workflow edge ids. Injectable so callers (e.g. tests or
 * a deterministic reducer run) can supply stable ids; defaults to a
 * time + random suffix to match the original designer behaviour.
 */
export type WorkflowEdgeIdFactory = (source: string, target: string) => string;

export function defaultWorkflowEdgeId(source: string, target: string): string {
  return `edge_${source}_${target}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ── Node transforms ────────────────────────────────────────────────────────

export function renameWorkflowNode(
  node: WorkflowNode,
  label: string,
): WorkflowNode {
  if (node.type === 'startEvent') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'endEvent') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'userTask') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'serviceTask') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'exclusiveGateway') {
    return { ...node, data: { ...node.data, label } };
  }

  return { ...node, data: { ...node.data, label } };
}

export function applyWorkflowNodeTriggerMode(
  node: WorkflowNode,
  triggerMode: WorkflowNodeTriggerMode,
): WorkflowNode {
  if (node.type === 'startEvent') {
    return node;
  }

  if (node.type === 'endEvent') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'userTask') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'serviceTask') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'exclusiveGateway') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  return { ...node, data: { ...node.data, triggerMode } };
}

export function normalizeDesignerWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  return normalizeSingleIncomingTriggerModes(
    removeAsyncNotifyOutgoingEdges(definition),
  );
}

export function removeAsyncNotifyOutgoingEdges(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const asyncNotifyNodeIds = new Set(
    definition.nodes
      .filter((node) => isAsyncNotifyServiceTask(node))
      .map((node) => node.id),
  );
  const edges = definition.edges.filter(
    (edge) => !asyncNotifyNodeIds.has(edge.source),
  );

  return edges.length === definition.edges.length
    ? definition
    : { ...definition, edges };
}

export function normalizeSingleIncomingTriggerModes(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const incomingEdgeCounts = definition.edges.reduce<Record<string, number>>(
    (counts, edge) => ({
      ...counts,
      [edge.target]: (counts[edge.target] ?? 0) + 1,
    }),
    {},
  );
  const nodes = definition.nodes.map((node) => {
    if (node.type === 'startEvent') {
      return node;
    }

    const incomingEdgeCount = incomingEdgeCounts[node.id] ?? 0;

    return incomingEdgeCount < 2 && node.data.triggerMode !== 'AND'
      ? applyWorkflowNodeTriggerMode(node, 'AND')
      : node;
  });
  const hasNodeChanges = nodes.some(
    (node, index) => node !== definition.nodes[index],
  );

  return hasNodeChanges ? { ...definition, nodes } : definition;
}

// ── Node / edge factories ──────────────────────────────────────────────────

export function createWorkflowNode(
  type: NodePaletteType,
  index: number,
): WorkflowNode {
  const id = `${type}_${index}`;
  const base = {
    id,
    position: { x: 260 + index * 48, y: 120 + index * 42 },
  };

  if (type === 'userTask') {
    return {
      ...base,
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: true,
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        decisionPolicy: { type: 'SINGLE' },
        label: `簽核節點 ${index}`,
        returnBehavior: {
          allowReturn: true,
          allowedTargets: 'INITIATOR',
          requireComment: false,
          resubmitStrategy: 'RESTART',
        },
        triggerMode: 'AND',
      },
      type,
    };
  }

  if (type === 'serviceTask') {
    return {
      ...base,
      data: {
        action: {
          channels: ['IN_APP'],
          recipients: { memberIds: ['member-001'], type: 'DIRECT' },
          type: 'NOTIFY',
        },
        label: `知會節點 ${index}`,
        triggerMode: 'AND',
      },
      type,
    };
  }

  return {
    ...base,
    data: {
      direction: 'split',
      label: `條件分流 ${index}`,
      triggerMode: 'AND',
    },
    type,
  };
}

export function readNextWorkflowNodeIndex(
  nodes: readonly WorkflowNode[],
  type: NodePaletteType,
): number {
  const usedIndexes = new Set(
    nodes
      .filter((node) => node.type === type)
      .map((node) => Number(node.id.replace(`${type}_`, '')))
      .filter((index) => Number.isInteger(index) && index > 0),
  );

  return (
    Array.from({ length: nodes.length + 1 }, (_, index) => index + 1).find(
      (index) => !usedIndexes.has(index),
    ) ?? nodes.length + 1
  );
}

export function createWorkflowEdge(
  source: string,
  target: string,
  data: WorkflowEdgeData,
  createId: WorkflowEdgeIdFactory = defaultWorkflowEdgeId,
): WorkflowEdge {
  return {
    data,
    id: createId(source, target),
    source,
    sourceHandle: WORKFLOW_OUTPUT_HANDLE_ID,
    target,
    targetHandle: WORKFLOW_INPUT_HANDLE_ID,
    type: 'smoothstep',
  };
}

export function readInsertedOutgoingEdgeData(
  node: WorkflowNode,
): WorkflowEdgeData {
  if (node.type === 'exclusiveGateway') {
    return { isDefault: true, label: '其他情況' };
  }

  return {};
}

// ── Node insertion ─────────────────────────────────────────────────────────

export function insertWorkflowNodeIntoDefinition({
  createId = defaultWorkflowEdgeId,
  definition,
  node,
  selectedEdgeId,
  selectedNodeId,
}: {
  readonly createId?: WorkflowEdgeIdFactory;
  readonly definition: WorkflowDefinition;
  readonly node: WorkflowNode;
  readonly selectedEdgeId: string | null;
  readonly selectedNodeId: string | null;
}): WorkflowNodeInsertResult {
  const selectedEdge = selectedEdgeId
    ? (definition.edges.find((edge) => edge.id === selectedEdgeId) ?? null)
    : null;
  const selectedNode = selectedNodeId
    ? (definition.nodes.find((candidate) => candidate.id === selectedNodeId) ??
      null)
    : null;

  if (selectedEdge) {
    return insertWorkflowNodeAtEdge(definition, node, selectedEdge, createId);
  }

  if (selectedNode) {
    return insertWorkflowNodeAfterNode(definition, node, selectedNode, createId);
  }

  return {
    definition: { ...definition, nodes: [...definition.nodes, node] },
    editingEdgeId: null,
    selectedEdgeIds: [],
    selectedNodeId: node.id,
  };
}

export function insertWorkflowNodeAtEdge(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  edge: WorkflowEdge,
  createId: WorkflowEdgeIdFactory = defaultWorkflowEdgeId,
): WorkflowNodeInsertResult {
  if (!isWorkflowNodeInputConnectable(node)) {
    return {
      definition,
      editingEdgeId: null,
      selectedEdgeIds: [edge.id],
      selectedNodeId: null,
    };
  }

  if (!isWorkflowNodeOutputConnectable(node)) {
    const incomingEdge = createWorkflowEdge(edge.source, node.id, {}, createId);

    return {
      definition: {
        ...definition,
        edges: [...definition.edges, incomingEdge],
        nodes: [...definition.nodes, node],
      },
      editingEdgeId: null,
      selectedEdgeIds: [],
      selectedNodeId: node.id,
    };
  }

  const incomingEdge = createWorkflowEdge(
    edge.source,
    node.id,
    edge.data,
    createId,
  );
  const outgoingEdge = createWorkflowEdge(
    node.id,
    edge.target,
    readInsertedOutgoingEdgeData(node),
    createId,
  );
  const shouldEditOutgoingEdge = isExclusiveGatewaySourceEdge(outgoingEdge, [
    ...definition.nodes,
    node,
  ]);

  return {
    definition: {
      ...definition,
      edges: definition.edges.flatMap((currentEdge) =>
        currentEdge.id === edge.id
          ? [incomingEdge, outgoingEdge]
          : [currentEdge],
      ),
      nodes: [...definition.nodes, node],
    },
    editingEdgeId: shouldEditOutgoingEdge ? outgoingEdge.id : null,
    selectedEdgeIds: shouldEditOutgoingEdge ? [outgoingEdge.id] : [],
    selectedNodeId: shouldEditOutgoingEdge ? null : node.id,
  };
}

export function insertWorkflowNodeAfterNode(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  sourceNode: WorkflowNode,
  createId: WorkflowEdgeIdFactory = defaultWorkflowEdgeId,
): WorkflowNodeInsertResult {
  if (!isWorkflowNodeOutputConnectable(sourceNode)) {
    return {
      definition: { ...definition, nodes: [...definition.nodes, node] },
      editingEdgeId: null,
      selectedEdgeIds: [],
      selectedNodeId: node.id,
    };
  }

  const firstOutgoingEdge =
    definition.edges.find((edge) => edge.source === sourceNode.id) ?? null;

  if (firstOutgoingEdge && isWorkflowNodeOutputConnectable(node)) {
    return insertWorkflowNodeAtEdge(
      definition,
      node,
      firstOutgoingEdge,
      createId,
    );
  }

  const endNode = definition.nodes.find(
    (candidate) => candidate.type === 'endEvent',
  );

  if (
    endNode &&
    sourceNode.id !== endNode.id &&
    isWorkflowNodeOutputConnectable(node)
  ) {
    const incomingEdge = createWorkflowEdge(
      sourceNode.id,
      node.id,
      {},
      createId,
    );
    const outgoingEdge = createWorkflowEdge(
      node.id,
      endNode.id,
      readInsertedOutgoingEdgeData(node),
      createId,
    );
    const shouldEditOutgoingEdge = isExclusiveGatewaySourceEdge(outgoingEdge, [
      ...definition.nodes,
      node,
    ]);

    return {
      definition: {
        ...definition,
        edges: [...definition.edges, incomingEdge, outgoingEdge],
        nodes: [...definition.nodes, node],
      },
      editingEdgeId: shouldEditOutgoingEdge ? outgoingEdge.id : null,
      selectedEdgeIds: shouldEditOutgoingEdge ? [outgoingEdge.id] : [],
      selectedNodeId: shouldEditOutgoingEdge ? null : node.id,
    };
  }

  const incomingEdge = createWorkflowEdge(sourceNode.id, node.id, {}, createId);

  return {
    definition: {
      ...definition,
      edges: [...definition.edges, incomingEdge],
      nodes: [...definition.nodes, node],
    },
    editingEdgeId: null,
    selectedEdgeIds: [],
    selectedNodeId: node.id,
  };
}

// ── Fallback / emptiness ───────────────────────────────────────────────────

export function readFallbackWorkflowDefinition(): WorkflowDefinition {
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

export function isEmptyDesignerWorkflowDefinition(
  definition: WorkflowDefinition,
): boolean {
  return (
    definition.edges.length === 0 &&
    definition.nodes.length === 2 &&
    definition.nodes.some((node) => node.type === 'startEvent') &&
    definition.nodes.some((node) => node.type === 'endEvent')
  );
}

// ── Connection rules ───────────────────────────────────────────────────────

export function isWorkflowConnectionValid(
  connection: WorkflowConnectionCandidate,
  nodes: readonly WorkflowNode[],
): boolean {
  const sourceNode = connection.source
    ? (nodes.find((node) => node.id === connection.source) ?? null)
    : null;
  const targetNode = connection.target
    ? (nodes.find((node) => node.id === connection.target) ?? null)
    : null;

  return (
    Boolean(sourceNode) &&
    Boolean(targetNode) &&
    connection.source !== connection.target &&
    connection.sourceHandle === WORKFLOW_OUTPUT_HANDLE_ID &&
    connection.targetHandle === WORKFLOW_INPUT_HANDLE_ID &&
    Boolean(sourceNode && isWorkflowNodeOutputConnectable(sourceNode)) &&
    Boolean(targetNode && isWorkflowNodeInputConnectable(targetNode))
  );
}

export function isWorkflowNodeRemovable(node: WorkflowNode): boolean {
  return node.type !== 'startEvent' && node.type !== 'endEvent';
}

export function isWorkflowNodeInputConnectable(node: WorkflowNode): boolean {
  return node.type !== 'startEvent';
}

export function isWorkflowNodeOutputConnectable(node: WorkflowNode): boolean {
  return node.type !== 'endEvent' && !isAsyncNotifyServiceTask(node);
}

export function isAsyncNotifyServiceTask(node: WorkflowNode): boolean {
  return node.type === 'serviceTask' && node.data.action.type === 'NOTIFY';
}

export function isExclusiveGatewaySourceEdge(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): boolean {
  return nodes.some(
    (node) => node.id === edge.source && node.type === 'exclusiveGateway',
  );
}

export function isParallelGatewaySourceEdge(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): boolean {
  return nodes.some(
    (node) => node.id === edge.source && node.type === 'parallelGateway',
  );
}

export function toggleSelectedEdgeId(
  edgeIds: readonly string[],
  edgeId: string,
): readonly string[] {
  return edgeIds.includes(edgeId)
    ? edgeIds.filter((currentEdgeId) => currentEdgeId !== edgeId)
    : [...edgeIds, edgeId];
}

// ── Validation ─────────────────────────────────────────────────────────────

export function readWorkflowDefinitionIssue(
  definition: WorkflowDefinition,
): string | null {
  const incompleteUserTaskNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      Boolean(readApproverResolverIssue(node.data.approverResolver)),
  );
  const unsatisfiableQuorumNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      isDecisionPolicyUnsatisfiable(
        node.data.decisionPolicy,
        node.data.approverResolver,
      ),
  );
  const notifyNodeIssue =
    definition.nodes
      .map((node) => readNotifyServiceTaskIssue(node))
      .find((issue): issue is string => issue !== null) ?? null;
  const incompleteConditionEdge = definition.edges.find(
    (edge) =>
      isExclusiveGatewaySourceEdge(edge, definition.nodes) &&
      !edge.data.isDefault &&
      !edge.data.condition,
  );
  // An exclusive gateway must always keep one "其他情況" (default) outgoing edge,
  // otherwise the flow has no path when none of the conditions match.
  const gatewayMissingDefault = definition.nodes.find((node) => {
    if (node.type !== 'exclusiveGateway') {
      return false;
    }

    const outgoing = definition.edges.filter(
      (edge) => edge.source === node.id,
    );

    return outgoing.length > 0 && !outgoing.some((edge) => edge.data.isDefault);
  });

  if (incompleteUserTaskNode && incompleteUserTaskNode.type === 'userTask') {
    return readApproverResolverIssue(
      incompleteUserTaskNode.data.approverResolver,
    );
  }

  if (
    unsatisfiableQuorumNode &&
    unsatisfiableQuorumNode.type === 'userTask' &&
    unsatisfiableQuorumNode.data.decisionPolicy?.type === 'QUORUM'
  ) {
    return (
      `簽核節點「${unsatisfiableQuorumNode.data.label}」的門檻人數為 ` +
      `${unsatisfiableQuorumNode.data.decisionPolicy.threshold}，` +
      `但只指定了 ${readDesignTimeApproverCount(unsatisfiableQuorumNode.data.approverResolver)} 位簽核者，` +
      '這一關將永遠無法通過。請降低門檻人數或增加簽核者。'
    );
  }

  if (notifyNodeIssue) {
    return notifyNodeIssue;
  }

  if (incompleteConditionEdge) {
    return '條件分流的每條輸出連線都需要先設定條件。';
  }

  if (gatewayMissingDefault) {
    return '條件分流需要保留一條「其他情況」預設路徑（用 set_edge_default 將其中一條輸出連線設為預設）。';
  }

  return null;
}

/**
 * The designer-facing issue for one NOTIFY service task, or `null` for any
 * other node. Exported so every validation entry point (this module's
 * {@link readWorkflowDefinitionIssue} and the template designer's own
 * pre-save check) applies the same NOTIFY rule.
 */
export function readNotifyServiceTaskIssue(node: WorkflowNode): string | null {
  if (node.type !== 'serviceTask' || node.data.action.type !== 'NOTIFY') {
    return null;
  }

  const action = node.data.action;
  const structureIssue = readNotifyWebhookStructureIssues(action.webhooks)[0];

  if (structureIssue) {
    return readNotifyWebhookIssueMessage(structureIssue, node.data.label);
  }

  if (!action.recipients?.type) {
    return readNotifyWebhookTargets(action).length > 0
      ? '知會節點的知會對象設定格式錯誤。'
      : '知會節點需要至少一位知會對象或一個 Webhook。';
  }

  if (isNotifyRecipientsEmpty(action.recipients)) {
    return readNotifyWebhookTargets(action).length > 0
      ? null
      : '知會節點需要至少一位知會對象或一個 Webhook。';
  }

  return readNotifyRecipientsIssue(action.recipients);
}

export function readApproverResolverIssue(
  resolver: ApproverResolver,
): string | null {
  if (resolver.type === 'DIRECT' && resolver.memberIds.length === 0) {
    return '簽核節點需要指定簽核會員。';
  }

  if (resolver.type === 'ORG_MANAGER' && resolver.levelsUp < 1) {
    return '簽核節點需要指定有效的主管層級。';
  }

  if (resolver.type === 'ORG_UNIT_MANAGER' && !resolver.orgUnitId.trim()) {
    return '簽核節點需要指定組織。';
  }

  if (resolver.type === 'ORG_UNIT_MEMBER' && !resolver.orgUnitId.trim()) {
    return '簽核節點需要指定組織。';
  }

  if (
    resolver.type === 'ORG_UNIT_POSITION' &&
    (!resolver.orgUnitId.trim() || !resolver.positionId.trim())
  ) {
    return '簽核節點需要指定組織與職位。';
  }

  if (
    (resolver.type === 'ORG_MANAGER' || resolver.type === 'ORG_UNIT_MANAGER') &&
    resolver.fallback?.type === 'DIRECT' &&
    !resolver.fallback.memberId.trim()
  ) {
    return '簽核節點需要指定改派固定人。';
  }

  if (resolver.type === 'POSITION' && !resolver.positionId.trim()) {
    return '簽核節點需要指定職位。';
  }

  return null;
}

export function hasConfiguredConditionEdges(
  definition: WorkflowDefinition,
): boolean {
  return definition.edges.some(
    (edge) =>
      isExclusiveGatewaySourceEdge(edge, definition.nodes) &&
      Boolean(
        edge.data.condition ||
          edge.data.conditionFieldKey ||
          edge.data.conditionOperator ||
          edge.data.conditionValue,
      ),
  );
}

export function readServiceTaskMemberIds(
  action: ServiceAction,
): readonly string[] {
  return action.type === 'NOTIFY' && action.recipients.type === 'DIRECT'
    ? action.recipients.memberIds
    : [];
}

// ── NOTIFY webhooks (ADR 18) ───────────────────────────────────────────────

export const NOTIFY_WEBHOOK_TARGET_LIMIT = 10;

/** Upper bound for `endpoint.version`, matching the outbox's `int` column. */
export const NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX = 2_147_483_647;

// A Record rather than a bare array so adding a member to
// `NotifyWebhookContextPath` fails to compile until it is listed here.
const NOTIFY_WEBHOOK_CONTEXT_PATH_SET: Readonly<
  Record<NotifyWebhookContextPath, true>
> = {
  'initiator.memberId': true,
  'instance.id': true,
  'instance.templateId': true,
  'instance.templateVersionId': true,
  'instance.title': true,
  'node.id': true,
  'node.label': true,
};

export const NOTIFY_WEBHOOK_CONTEXT_PATHS: readonly NotifyWebhookContextPath[] =
  Object.keys(NOTIFY_WEBHOOK_CONTEXT_PATH_SET) as NotifyWebhookContextPath[];

export type NotifyWebhookTargetIdFactory = () => string;

export type NotifyWebhookStructureIssueCode =
  | 'BINDING_CONSTANT_INVALID'
  | 'BINDING_CONTEXT_PATH_INVALID'
  | 'BINDING_FIELD_KEY_REQUIRED'
  | 'BINDING_INVALID'
  | 'BINDING_PARAMETER_DUPLICATE'
  | 'BINDING_PARAMETER_REQUIRED'
  | 'BINDING_SOURCE_INVALID'
  | 'BINDINGS_NOT_ARRAY'
  | 'ENDPOINT_KEY_REQUIRED'
  | 'ENDPOINT_VERSION_INVALID'
  | 'TARGET_ID_DUPLICATE'
  | 'TARGET_ID_REQUIRED'
  | 'TARGET_INVALID'
  | 'TARGET_LIMIT_EXCEEDED'
  | 'UNKNOWN_PROPERTY'
  | 'WEBHOOKS_NOT_ARRAY';

/**
 * A registry-independent shape problem in a NOTIFY node's `webhooks`.
 *
 * Returned as a code rather than a message so the designer (zh-TW, user
 * facing) and the backend publish lint (path-style, developer facing) share
 * one rule set and can never drift apart.
 */
export interface NotifyWebhookStructureIssue {
  readonly bindingIndex: number | null;
  readonly code: NotifyWebhookStructureIssueCode;
  readonly parameter: string | null;
  /**
   * For `UNKNOWN_PROPERTY`: the offending key, relative to the target when
   * `bindingIndex` is `null` (`url`, `endpoint.secret`) and to the binding
   * otherwise (`label`, `from.expression`). `null` for every other code.
   */
  readonly property: string | null;
  readonly targetIndex: number | null;
}

export function defaultNotifyWebhookTargetId(): string {
  return `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createNotifyWebhookTarget(
  endpoint: NotifyWebhookEndpointReference,
  createId: NotifyWebhookTargetIdFactory = defaultNotifyWebhookTargetId,
): NotifyWebhookTarget {
  return {
    bindings: [],
    endpoint: { key: endpoint.key, version: endpoint.version },
    id: createId(),
  };
}

export function readNotifyWebhookTargets(
  action: ServiceAction,
): readonly NotifyWebhookTarget[] {
  return action.type === 'NOTIFY' && Array.isArray(action.webhooks)
    ? action.webhooks
    : [];
}

/**
 * `true` for the one recipient shape that names nobody: a `DIRECT` resolver
 * with no member ids. Every other resolver picks members at runtime, so it is
 * "configured" or "misconfigured" (see {@link readNotifyRecipientsIssue}) but
 * never empty.
 */
export function isNotifyRecipientsEmpty(
  recipients: ApproverResolver | null | undefined,
): boolean {
  return (
    recipients?.type === 'DIRECT' &&
    (!Array.isArray(recipients.memberIds) || recipients.memberIds.length === 0)
  );
}

/**
 * Misconfiguration of a non-empty NOTIFY recipient resolver. Mirrors the
 * backend publish lint (`lintNotifyRecipients`) rule for rule; an empty
 * `DIRECT` resolver is not reported here because whether it is allowed
 * depends on the node's webhooks.
 */
export function readNotifyRecipientsIssue(
  recipients: ApproverResolver,
): string | null {
  if (recipients.type === 'POSITION' && !recipients.positionId.trim()) {
    return '知會節點需要指定職位。';
  }

  if (recipients.type === 'ORG_UNIT_MEMBER' && !recipients.orgUnitId.trim()) {
    return '知會節點需要指定組織。';
  }

  if (
    recipients.type === 'ORG_UNIT_POSITION' &&
    (!recipients.orgUnitId.trim() || !recipients.positionId.trim())
  ) {
    return '知會節點需要指定組織與職位。';
  }

  if (recipients.type === 'DYNAMIC_FORM' && !recipients.formPath.trim()) {
    return '知會節點需要指定知會對象的表單欄位。';
  }

  if (recipients.type === 'EXPRESSION' && !recipients.expression.trim()) {
    return '知會節點需要指定知會對象的運算式。';
  }

  return null;
}

/**
 * Structural checks that need neither the host webhook registry nor the form
 * schema. Reads defensively: on the backend the definition is parsed JSON
 * that no DTO has validated.
 */
export function readNotifyWebhookStructureIssues(
  webhooks: unknown,
): readonly NotifyWebhookStructureIssue[] {
  if (webhooks === undefined) {
    return [];
  }

  if (!Array.isArray(webhooks)) {
    return [createNotifyWebhookIssue('WEBHOOKS_NOT_ARRAY')];
  }

  const limitIssues =
    webhooks.length > NOTIFY_WEBHOOK_TARGET_LIMIT
      ? [createNotifyWebhookIssue('TARGET_LIMIT_EXCEEDED')]
      : [];
  const targetIssues = webhooks.flatMap((target: unknown, targetIndex) =>
    readNotifyWebhookTargetIssues(target, targetIndex, webhooks),
  );

  return [...limitIssues, ...targetIssues];
}

export function isNotifyWebhookContextPath(
  value: unknown,
): value is NotifyWebhookContextPath {
  return (
    typeof value === 'string' &&
    NOTIFY_WEBHOOK_CONTEXT_PATHS.some((path) => path === value)
  );
}

/**
 * Whether a form field's stored value can feed a webhook parameter of `type`
 * through a `FIELD` binding (ADR 18 §4).
 */
export function isFormFieldCompatibleWithWebhookParameter(
  field: FormFieldDefinition,
  type: NotifyWebhookParameterType,
): boolean {
  if (type === 'json') {
    return true;
  }

  if (type === 'number') {
    return field.type === 'number' || field.type === 'money';
  }

  if (type === 'boolean') {
    return field.type === 'boolean';
  }

  const selectionMode = isFormOptionFieldDefinition(field)
    ? readFormFieldSelectionMode(field)
    : null;

  if (type === 'stringArray') {
    return selectionMode === 'multiple';
  }

  return (
    field.type === 'text' ||
    field.type === 'textarea' ||
    field.type === 'date' ||
    field.type === 'datetime' ||
    selectionMode === 'single'
  );
}

/**
 * Whether a concrete value fits a webhook parameter of `type`. Used for
 * `CONSTANT` bindings at publish and for resolved values at runtime. `null`
 * fits every type; whether a required parameter may be `null` is decided by
 * the caller.
 */
export function isNotifyWebhookValueCompatibleWithParameter(
  value: unknown,
  type: NotifyWebhookParameterType,
): boolean {
  if (value === null || type === 'json') {
    return true;
  }

  if (type === 'string') {
    return typeof value === 'string';
  }

  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (type === 'boolean') {
    return typeof value === 'boolean';
  }

  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/** The part of an endpoint descriptor the catalog lint reads. */
export interface NotifyWebhookEndpointContract {
  readonly deprecated?: boolean;
  /** Switched off by an administrator; nothing is delivered any more. */
  readonly disabled?: boolean;
  readonly parameters: readonly {
    readonly key: string;
    readonly required: boolean;
    readonly type: NotifyWebhookParameterType;
  }[];
}

export type NotifyWebhookCatalogIssueCode =
  | 'CONSTANT_INCOMPATIBLE'
  | 'CONSTANT_REQUIRED_NULL'
  | 'CONTEXT_INCOMPATIBLE'
  | 'ENDPOINT_DEPRECATED'
  | 'ENDPOINT_DISABLED'
  | 'ENDPOINT_MISSING'
  | 'FIELD_INCOMPATIBLE'
  | 'FIELD_MISSING'
  | 'PARAMETER_REQUIRED'
  | 'PARAMETER_UNKNOWN';

/**
 * A publish problem in one well-formed webhook target that needs the endpoint
 * catalog and the bound form (ADR 18 §4, items 2 and 5–8). A code, like
 * {@link NotifyWebhookStructureIssue}, so the designer and the backend publish
 * lint share the rules and only differ in wording.
 */
export interface NotifyWebhookCatalogIssue {
  readonly bindingIndex: number | null;
  readonly code: NotifyWebhookCatalogIssueCode;
  readonly fieldKey: string | null;
  readonly fieldType: string | null;
  readonly parameter: string | null;
  readonly parameterType: NotifyWebhookParameterType | null;
}

/**
 * Checks a structurally valid target against its endpoint and the form.
 * `endpoint` is `null` when the catalog does not list the target's key and
 * version. A missing or deprecated endpoint is the only issue reported for
 * that target: its parameters are no longer a contract worth checking.
 */
export function readNotifyWebhookTargetCatalogIssues({
  endpoint,
  formFields,
  target,
}: {
  readonly endpoint: NotifyWebhookEndpointContract | null;
  readonly formFields: readonly FormFieldDefinition[];
  readonly target: NotifyWebhookTarget;
}): readonly NotifyWebhookCatalogIssue[] {
  if (!endpoint) {
    return [createNotifyWebhookCatalogIssue('ENDPOINT_MISSING')];
  }

  if (endpoint.disabled) {
    return [createNotifyWebhookCatalogIssue('ENDPOINT_DISABLED')];
  }

  if (endpoint.deprecated) {
    return [createNotifyWebhookCatalogIssue('ENDPOINT_DEPRECATED')];
  }

  const boundParameters = new Set(
    target.bindings.map((binding) => binding.parameter),
  );
  const requiredIssues = endpoint.parameters.flatMap((parameter) =>
    parameter.required && !boundParameters.has(parameter.key)
      ? [
          createNotifyWebhookCatalogIssue('PARAMETER_REQUIRED', {
            parameter: parameter.key,
            parameterType: parameter.type,
          }),
        ]
      : [],
  );
  const bindingIssues = target.bindings.flatMap(
    (binding, bindingIndex): readonly NotifyWebhookCatalogIssue[] => {
      const parameter = endpoint.parameters.find(
        (candidate) => candidate.key === binding.parameter,
      );
      const location = { bindingIndex, parameter: binding.parameter };

      if (!parameter) {
        return [createNotifyWebhookCatalogIssue('PARAMETER_UNKNOWN', location)];
      }

      const typed = { ...location, parameterType: parameter.type };
      const from = binding.from;

      if (from.kind === 'FIELD') {
        const field = formFields.find(
          (candidate) => candidate.fieldKey === from.fieldKey,
        );

        if (!field) {
          return [
            createNotifyWebhookCatalogIssue('FIELD_MISSING', {
              ...typed,
              fieldKey: from.fieldKey,
            }),
          ];
        }

        return isFormFieldCompatibleWithWebhookParameter(field, parameter.type)
          ? []
          : [
              createNotifyWebhookCatalogIssue('FIELD_INCOMPATIBLE', {
                ...typed,
                fieldKey: from.fieldKey,
                fieldType: field.type,
              }),
            ];
      }

      if (from.kind === 'CONSTANT') {
        if (from.value === null && parameter.required) {
          return [
            createNotifyWebhookCatalogIssue('CONSTANT_REQUIRED_NULL', typed),
          ];
        }

        return isNotifyWebhookValueCompatibleWithParameter(
          from.value,
          parameter.type,
        )
          ? []
          : [createNotifyWebhookCatalogIssue('CONSTANT_INCOMPATIBLE', typed)];
      }

      // Every CONTEXT path resolves to a string, so anything but a string or
      // an opaque json parameter is a mistake the author should see.
      return parameter.type === 'string' || parameter.type === 'json'
        ? []
        : [createNotifyWebhookCatalogIssue('CONTEXT_INCOMPATIBLE', typed)];
    },
  );

  return [...requiredIssues, ...bindingIssues];
}

/** The designer's wording for {@link NotifyWebhookCatalogIssue}. */
export function readNotifyWebhookCatalogIssueMessage({
  endpointLabel,
  issue,
  nodeLabel,
  targetIndex,
}: {
  readonly endpointLabel: string;
  readonly issue: NotifyWebhookCatalogIssue;
  readonly nodeLabel: string;
  readonly targetIndex: number;
}): string {
  const target = `知會節點「${nodeLabel}」的第 ${targetIndex + 1} 個 Webhook（${endpointLabel}）`;
  const parameter = `參數「${issue.parameter ?? ''}」`;

  switch (issue.code) {
    case 'ENDPOINT_MISSING':
      return `${target}的端點已不存在，請移除或改選其他端點。`;
    case 'ENDPOINT_DEPRECATED':
      return `${target}的端點不建議再使用，請改選其他端點。`;
    case 'ENDPOINT_DISABLED':
      return `${target}的端點已被管理者停用，請改選其他端點。`;
    case 'PARAMETER_REQUIRED':
      return `${target}的必填${parameter}尚未設定。`;
    case 'PARAMETER_UNKNOWN':
      return `${target}的${parameter}已不在端點定義中，請移除此設定。`;
    case 'FIELD_MISSING':
      return `${target}的${parameter}綁定的表單欄位「${issue.fieldKey ?? ''}」不存在。`;
    case 'FIELD_INCOMPATIBLE':
      return `${target}的${parameter}綁定的表單欄位「${issue.fieldKey ?? ''}」型別不相容。`;
    case 'CONSTANT_REQUIRED_NULL':
      return `${target}的必填${parameter}固定值不可為空。`;
    case 'CONSTANT_INCOMPATIBLE':
      return `${target}的${parameter}固定值型別不相容。`;
    case 'CONTEXT_INCOMPATIBLE':
      return `${target}的${parameter}無法使用案件資訊（案件資訊皆為文字）。`;
  }
}

function createNotifyWebhookCatalogIssue(
  code: NotifyWebhookCatalogIssueCode,
  location: Partial<Omit<NotifyWebhookCatalogIssue, 'code'>> = {},
): NotifyWebhookCatalogIssue {
  return {
    bindingIndex: location.bindingIndex ?? null,
    code,
    fieldKey: location.fieldKey ?? null,
    fieldType: location.fieldType ?? null,
    parameter: location.parameter ?? null,
    parameterType: location.parameterType ?? null,
  };
}

function readNotifyWebhookTargetIssues(
  target: unknown,
  targetIndex: number,
  targets: readonly unknown[],
): readonly NotifyWebhookStructureIssue[] {
  if (!isPlainRecord(target)) {
    return [createNotifyWebhookIssue('TARGET_INVALID', { targetIndex })];
  }

  const targetId = target['id'];
  const idIssues =
    typeof targetId !== 'string' || !targetId.trim()
      ? [createNotifyWebhookIssue('TARGET_ID_REQUIRED', { targetIndex })]
      : targets.findIndex(
            (candidate) =>
              isPlainRecord(candidate) &&
              typeof candidate['id'] === 'string' &&
              candidate['id'].trim() === targetId.trim(),
          ) !== targetIndex
        ? [createNotifyWebhookIssue('TARGET_ID_DUPLICATE', { targetIndex })]
        : [];
  const endpoint = target['endpoint'];
  const endpointKey = isPlainRecord(endpoint) ? endpoint['key'] : undefined;
  const endpointVersion = isPlainRecord(endpoint)
    ? endpoint['version']
    : undefined;
  const endpointIssues = [
    ...(typeof endpointKey !== 'string' || !endpointKey.trim()
      ? [createNotifyWebhookIssue('ENDPOINT_KEY_REQUIRED', { targetIndex })]
      : []),
    ...(typeof endpointVersion !== 'number' ||
    !Number.isInteger(endpointVersion) ||
    endpointVersion < 1 ||
    endpointVersion > NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX
      ? [createNotifyWebhookIssue('ENDPOINT_VERSION_INVALID', { targetIndex })]
      : []),
  ];
  // The template must never carry a URL, header or secret (ADR 18 §3.1), so
  // anything beyond the reference and bindings is rejected, not ignored.
  const unknownPropertyIssues = [
    ...readUnknownProperties(target, TARGET_PROPERTIES, ''),
    ...(isPlainRecord(endpoint)
      ? readUnknownProperties(endpoint, ENDPOINT_PROPERTIES, 'endpoint.')
      : []),
  ].map((property) =>
    createNotifyWebhookIssue('UNKNOWN_PROPERTY', { property, targetIndex }),
  );
  const bindings = target['bindings'];
  const bindingIssues = Array.isArray(bindings)
    ? bindings.flatMap((binding: unknown, bindingIndex) =>
        readNotifyWebhookBindingIssues(
          binding,
          targetIndex,
          bindingIndex,
          bindings,
        ),
      )
    : [createNotifyWebhookIssue('BINDINGS_NOT_ARRAY', { targetIndex })];

  return [
    ...idIssues,
    ...endpointIssues,
    ...unknownPropertyIssues,
    ...bindingIssues,
  ];
}

function readNotifyWebhookBindingIssues(
  binding: unknown,
  targetIndex: number,
  bindingIndex: number,
  bindings: readonly unknown[],
): readonly NotifyWebhookStructureIssue[] {
  if (!isPlainRecord(binding)) {
    return [
      createNotifyWebhookIssue('BINDING_INVALID', {
        bindingIndex,
        targetIndex,
      }),
    ];
  }

  const parameterValue = binding['parameter'];
  const parameter =
    typeof parameterValue === 'string' && parameterValue.trim()
      ? parameterValue
      : null;
  const location = { bindingIndex, parameter, targetIndex };
  const parameterIssues = !parameter
    ? [createNotifyWebhookIssue('BINDING_PARAMETER_REQUIRED', location)]
    : bindings.findIndex(
          (candidate) =>
            isPlainRecord(candidate) &&
            typeof candidate['parameter'] === 'string' &&
            candidate['parameter'].trim() === parameter.trim(),
        ) !== bindingIndex
      ? [createNotifyWebhookIssue('BINDING_PARAMETER_DUPLICATE', location)]
      : [];
  const from = binding['from'];
  const unknownPropertyIssues = [
    ...readUnknownProperties(binding, BINDING_PROPERTIES, ''),
    ...(isPlainRecord(from) && isNotifyWebhookSourceKind(from['kind'])
      ? readUnknownProperties(from, SOURCE_PROPERTIES[from['kind']], 'from.')
      : []),
  ].map((property) =>
    createNotifyWebhookIssue('UNKNOWN_PROPERTY', { ...location, property }),
  );

  return [
    ...parameterIssues,
    ...readNotifyWebhookSourceIssues(from, location),
    ...unknownPropertyIssues,
  ];
}

const TARGET_PROPERTIES: readonly string[] = ['bindings', 'endpoint', 'id'];
const ENDPOINT_PROPERTIES: readonly string[] = ['key', 'version'];
const BINDING_PROPERTIES: readonly string[] = ['from', 'parameter'];
const SOURCE_PROPERTIES: Readonly<
  Record<NotifyWebhookBindingSource['kind'], readonly string[]>
> = {
  CONSTANT: ['kind', 'value'],
  CONTEXT: ['kind', 'path'],
  FIELD: ['fieldKey', 'kind'],
};

function isNotifyWebhookSourceKind(
  value: unknown,
): value is NotifyWebhookBindingSource['kind'] {
  return value === 'CONSTANT' || value === 'CONTEXT' || value === 'FIELD';
}

function readUnknownProperties(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  prefix: string,
): readonly string[] {
  // A key holding `undefined` disappears in JSON, so the backend never sees
  // it; counting it here would make the designer stricter than publish.
  return Object.keys(value)
    .filter((key) => value[key] !== undefined && !allowed.includes(key))
    .map((key) => `${prefix}${key}`);
}

function readNotifyWebhookSourceIssues(
  source: unknown,
  location: Partial<Omit<NotifyWebhookStructureIssue, 'code'>>,
): readonly NotifyWebhookStructureIssue[] {
  if (!isPlainRecord(source)) {
    return [createNotifyWebhookIssue('BINDING_SOURCE_INVALID', location)];
  }

  if (source['kind'] === 'FIELD') {
    const fieldKey = source['fieldKey'];

    return typeof fieldKey === 'string' && fieldKey.trim()
      ? []
      : [createNotifyWebhookIssue('BINDING_FIELD_KEY_REQUIRED', location)];
  }

  if (source['kind'] === 'CONTEXT') {
    return isNotifyWebhookContextPath(source['path'])
      ? []
      : [createNotifyWebhookIssue('BINDING_CONTEXT_PATH_INVALID', location)];
  }

  if (source['kind'] === 'CONSTANT') {
    const value = source['value'];

    return value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
      ? []
      : [createNotifyWebhookIssue('BINDING_CONSTANT_INVALID', location)];
  }

  return [createNotifyWebhookIssue('BINDING_SOURCE_INVALID', location)];
}

function createNotifyWebhookIssue(
  code: NotifyWebhookStructureIssueCode,
  location: Partial<Omit<NotifyWebhookStructureIssue, 'code'>> = {},
): NotifyWebhookStructureIssue {
  return {
    bindingIndex: location.bindingIndex ?? null,
    code,
    parameter: location.parameter ?? null,
    property: location.property ?? null,
    targetIndex: location.targetIndex ?? null,
  };
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNotifyWebhookIssueMessage(
  issue: NotifyWebhookStructureIssue,
  nodeLabel: string,
): string {
  const target =
    issue.targetIndex === null
      ? `知會節點「${nodeLabel}」`
      : `知會節點「${nodeLabel}」的第 ${issue.targetIndex + 1} 個 Webhook`;

  switch (issue.code) {
    case 'TARGET_LIMIT_EXCEEDED':
      return `知會節點「${nodeLabel}」最多只能設定 ${NOTIFY_WEBHOOK_TARGET_LIMIT} 個 Webhook。`;
    case 'ENDPOINT_KEY_REQUIRED':
    case 'ENDPOINT_VERSION_INVALID':
      return `${target}需要選擇端點。`;
    case 'BINDING_PARAMETER_REQUIRED':
      return `${target}有未指定參數的綁定。`;
    case 'BINDING_PARAMETER_DUPLICATE':
      return `${target}的參數「${issue.parameter ?? ''}」重複綁定。`;
    case 'BINDING_FIELD_KEY_REQUIRED':
      return `${target}的參數「${issue.parameter ?? ''}」需要選擇表單欄位。`;
    case 'BINDING_CONTEXT_PATH_INVALID':
      return `${target}的參數「${issue.parameter ?? ''}」需要選擇案件資訊。`;
    case 'BINDING_CONSTANT_INVALID':
      return `${target}的參數「${issue.parameter ?? ''}」固定值格式錯誤。`;
    case 'UNKNOWN_PROPERTY':
      return `${target}包含不支援的設定「${issue.property ?? ''}」，請移除後重新新增。`;
    default:
      return `${target}設定格式錯誤，請移除後重新新增。`;
  }
}

// ── Condition compilation ──────────────────────────────────────────────────

export function readConditionField(
  schema: FormDefinitionSchema | null,
  fieldKey: string | null,
): FormFieldDefinition | null {
  return fieldKey
    ? (schema?.fields.find((field) => field.fieldKey === fieldKey) ?? null)
    : null;
}

export function readConditionOperator(
  value: string | null,
): WorkflowEdgeConditionOperator | null {
  return CONDITION_OPERATOR_OPTIONS.some((option) => option.id === value)
    ? (value as WorkflowEdgeConditionOperator)
    : null;
}

export function readConditionOperatorIds(
  field: FormFieldDefinition,
): readonly WorkflowEdgeConditionOperator[] {
  if (field.type === 'file_upload' || field.type === 'table') {
    return ['IS_FILLED', 'IS_EMPTY'];
  }

  if (field.type === 'boolean') {
    return ['EQUALS', 'NOT_EQUALS', 'IS_FILLED', 'IS_EMPTY'];
  }

  if (
    field.type === 'date' ||
    field.type === 'datetime' ||
    field.type === 'money' ||
    field.type === 'number'
  ) {
    return [
      'EQUALS',
      'NOT_EQUALS',
      'GREATER_THAN',
      'GREATER_THAN_OR_EQUALS',
      'LESS_THAN',
      'LESS_THAN_OR_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ];
  }

  return ['EQUALS', 'NOT_EQUALS', 'IS_FILLED', 'IS_EMPTY'];
}

export interface ConditionValueOption {
  readonly id: string;
  readonly name: string;
}

export function readConditionValueOptions(
  field: FormFieldDefinition | null,
): readonly ConditionValueOption[] {
  if (!field) {
    return [];
  }

  if (field.type === 'boolean') {
    return [
      { id: 'true', name: '是' },
      { id: 'false', name: '否' },
    ];
  }

  if (isFormStaticOptionFieldDefinition(field)) {
    return field.options.map((option) => ({
      id: option.value,
      name: option.label,
    }));
  }

  return [];
}

export function readNextConditionOperator(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | null,
): WorkflowEdgeConditionOperator | undefined {
  if (!field) {
    return undefined;
  }

  const operatorIds = readConditionOperatorIds(field);

  return operator && operatorIds.includes(operator) ? operator : operatorIds[0];
}

export function readNextConditionValue(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | null,
): string | undefined {
  if (!field || !operator || !shouldConditionOperatorUseValue(operator)) {
    return undefined;
  }

  const valueOptions = readConditionValueOptions(field);

  if (valueOptions.length === 0) {
    return value ?? undefined;
  }

  return valueOptions.some((option) => option.id === value)
    ? (value ?? undefined)
    : valueOptions[0]?.id;
}

export function shouldConditionOperatorUseValue(
  operator: WorkflowEdgeConditionOperator,
): boolean {
  return CONDITION_OPERATORS_REQUIRING_VALUE.includes(operator);
}

export function readConditionLabel(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | undefined,
): string | undefined {
  if (!field || !operator) {
    return undefined;
  }

  const operatorLabel = readConditionOperatorLabel(operator);

  if (!shouldConditionOperatorUseValue(operator)) {
    return `${field.label} ${operatorLabel}`;
  }

  if (!value) {
    return undefined;
  }

  return `${field.label} ${operatorLabel} ${readConditionValueLabel(
    field,
    value,
  )}`;
}

export function readConditionOperatorLabel(
  operator: WorkflowEdgeConditionOperator,
): string {
  return (
    CONDITION_OPERATOR_OPTIONS.find((option) => option.id === operator)?.name ??
    operator
  );
}

export function readConditionValueLabel(
  field: FormFieldDefinition,
  value: string,
): string {
  if (field.type === 'boolean') {
    return value === 'true' ? '是' : '否';
  }

  if (isFormStaticOptionFieldDefinition(field)) {
    return readFormFieldOption(field.options, value)?.label ?? value;
  }

  return value;
}

export function readFormFieldOption(
  options: readonly FormFieldOption[],
  value: string,
): FormFieldOption | null {
  return options.find((option) => option.value === value) ?? null;
}

export function readConditionExpression(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | undefined,
): string | undefined {
  if (!field || !operator) {
    return undefined;
  }

  const fieldReference = readFormFieldReference(field.fieldKey);

  if (field.type === 'table') {
    // A table value is a list, so emptiness means row count, not `== ""`.
    // cel-js supports the global `size()` macro but not a `.size()` method,
    // and `size(null)` throws — hence the null guard (see docs/17 appendix A).
    if (operator === 'IS_FILLED') {
      return `${fieldReference} != null && size(${fieldReference}) > 0`;
    }

    if (operator === 'IS_EMPTY') {
      return `${fieldReference} == null || size(${fieldReference}) == 0`;
    }

    return undefined;
  }

  if (operator === 'IS_FILLED') {
    return `${fieldReference} != null && ${fieldReference} != ""`;
  }

  if (operator === 'IS_EMPTY') {
    return `${fieldReference} == null || ${fieldReference} == ""`;
  }

  if (!value) {
    return undefined;
  }

  return `${fieldReference} ${readConditionExpressionOperator(
    operator,
  )} ${readConditionExpressionValue(field, value)}`;
}

export function readFormFieldReference(fieldKey: string): string {
  return isFormIdentifierKey(fieldKey)
    ? `form.${fieldKey}`
    : `form[${JSON.stringify(fieldKey)}]`;
}

export function readConditionExpressionOperator(
  operator: WorkflowEdgeConditionOperator,
): string {
  if (operator === 'EQUALS') {
    return '==';
  }

  if (operator === 'NOT_EQUALS') {
    return '!=';
  }

  if (operator === 'GREATER_THAN') {
    return '>';
  }

  if (operator === 'GREATER_THAN_OR_EQUALS') {
    return '>=';
  }

  if (operator === 'LESS_THAN') {
    return '<';
  }

  return '<=';
}

export function readConditionExpressionValue(
  field: FormFieldDefinition,
  value: string,
): string {
  if (field.type === 'boolean') {
    return value === 'true' ? 'true' : 'false';
  }

  if (field.type === 'money' || field.type === 'number') {
    return Number.isFinite(Number(value)) ? value : JSON.stringify(value);
  }

  return JSON.stringify(value);
}
