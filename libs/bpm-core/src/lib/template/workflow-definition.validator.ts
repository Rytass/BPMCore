import {
  ApproverResolver,
  ServiceAction,
  SlaCalendarMode,
  SlaConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  isDecisionPolicyUnsatisfiable,
  readDesignTimeApproverCount,
} from '@rytass/bpm-core-shared/workflow-graph';
import { parseIsoDurationParts } from '../common/iso-duration';

const SLA_TIMEOUT_ACTIONS: readonly SlaConfig['onTimeout'][] = [
  'REMIND',
  'AUTO_APPROVE',
  'ESCALATE',
  'TERMINATE_INSTANCE',
];

const SLA_CALENDAR_MODES: readonly SlaCalendarMode[] = [
  'CALENDAR',
  'BUSINESS_DAY',
];

export interface WorkflowDefinitionLintResult {
  readonly errors: readonly string[];
  readonly valid: boolean;
  readonly warnings: readonly string[];
}

export const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
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
      position: { x: 520, y: 160 },
      type: 'endEvent',
    },
  ],
};

export function parseWorkflowDefinitionJson(
  value: string | null | undefined,
): WorkflowDefinition {
  if (!value) {
    return EMPTY_WORKFLOW_DEFINITION;
  }

  const parsedValue = JSON.parse(value) as unknown;

  return parsedValue as WorkflowDefinition;
}

export function lintWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinitionLintResult {
  const basicErrors = lintBasicShape(definition);

  if (basicErrors.length) {
    return { errors: basicErrors, valid: false, warnings: [] };
  }

  const nodes = definition.nodes;
  const edges = definition.edges;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const startNodes = nodes.filter((node) => node.type === 'startEvent');
  const endNodes = nodes.filter((node) => node.type === 'endEvent');
  const topologyErrors = [
    ...(startNodes.length === 1
      ? []
      : ['workflow must include exactly one startEvent node']),
    ...(endNodes.length >= 1
      ? []
      : ['workflow must include at least one endEvent node']),
    ...lintEdges(edges, nodeIds),
    ...lintUserTaskNodes(nodes),
    ...lintServiceTaskNodes(nodes),
    ...lintAsyncNotifyOutgoingEdges(nodes, edges),
    ...lintExclusiveGateways(nodes, edges),
    ...lintParallelGateways(nodes, edges),
  ];

  if (topologyErrors.length) {
    return { errors: topologyErrors, valid: false, warnings: [] };
  }

  const startNode = startNodes[0];
  const reachabilityErrors = startNode
    ? lintReachability(nodes, edges, startNode.id)
    : [];
  const cycleErrors = startNode ? lintCycles(edges, startNode.id) : [];
  const errors = [...reachabilityErrors, ...cycleErrors];

  return {
    errors,
    valid: errors.length === 0,
    warnings: lintSlaWarnings(nodes),
  };
}

function lintBasicShape(definition: WorkflowDefinition): readonly string[] {
  const errors = [
    ...(definition?.meta?.schemaVersion === 1
      ? []
      : ['workflow.meta.schemaVersion must be 1']),
    ...(Array.isArray(definition?.nodes)
      ? []
      : ['workflow.nodes must be an array']),
    ...(Array.isArray(definition?.edges)
      ? []
      : ['workflow.edges must be an array']),
  ];

  if (errors.length) {
    return errors;
  }

  const nodeErrors = definition.nodes.flatMap((node, index) =>
    lintNodeShape(node, index),
  );
  const edgeErrors = definition.edges.flatMap((edge, index) =>
    lintEdgeShape(edge, index),
  );
  const duplicateNodeErrors = readDuplicateErrors(
    definition.nodes.map((node) => node.id),
    'workflow.nodes id is duplicated',
  );
  const duplicateEdgeErrors = readDuplicateErrors(
    definition.edges.map((edge) => edge.id),
    'workflow.edges id is duplicated',
  );

  return [
    ...nodeErrors,
    ...edgeErrors,
    ...duplicateNodeErrors,
    ...duplicateEdgeErrors,
  ];
}

function lintNodeShape(node: WorkflowNode, index: number): readonly string[] {
  const path = `workflow.nodes[${index}]`;

  return [
    ...(typeof node.id === 'string' && node.id.trim()
      ? []
      : [`${path}.id must be a non-empty string`]),
    ...(typeof node.type === 'string' && node.type.trim()
      ? []
      : [`${path}.type must be a non-empty string`]),
    ...(typeof node.data?.label === 'string' && node.data.label.trim()
      ? []
      : [`${path}.data.label must be a non-empty string`]),
    ...(!node.data?.triggerMode ||
    node.data.triggerMode === 'AND' ||
    node.data.triggerMode === 'OR'
      ? []
      : [`${path}.data.triggerMode must be AND or OR`]),
    ...(typeof node.position?.x === 'number' &&
    typeof node.position?.y === 'number'
      ? []
      : [`${path}.position must include numeric x and y`]),
  ];
}

function lintEdgeShape(edge: WorkflowEdge, index: number): readonly string[] {
  const path = `workflow.edges[${index}]`;

  return [
    ...(typeof edge.id === 'string' && edge.id.trim()
      ? []
      : [`${path}.id must be a non-empty string`]),
    ...(typeof edge.source === 'string' && edge.source.trim()
      ? []
      : [`${path}.source must be a non-empty string`]),
    ...(typeof edge.target === 'string' && edge.target.trim()
      ? []
      : [`${path}.target must be a non-empty string`]),
  ];
}

function lintEdges(
  edges: readonly WorkflowEdge[],
  nodeIds: ReadonlySet<string>,
): readonly string[] {
  return edges.flatMap((edge) => [
    ...(nodeIds.has(edge.source)
      ? []
      : [`workflow.edges.${edge.id}.source does not match a node`]),
    ...(nodeIds.has(edge.target)
      ? []
      : [`workflow.edges.${edge.id}.target does not match a node`]),
  ]);
}

function lintUserTaskNodes(nodes: readonly WorkflowNode[]): readonly string[] {
  return nodes
    .filter((node) => node.type === 'userTask')
    .flatMap((node) => {
      const data = node.data;

      return [
        ...lintApproverResolver(data.approverResolver, node.id),
        ...(data.decisionPolicy?.type
          ? []
          : [`workflow.nodes.${node.id}.decisionPolicy is required`]),
        // A COUNT quorum above the number of approvers the node can produce
        // deadlocks the task forever — the engine gates on
        // `completedCount >= threshold` and an ad-hoc signer opens a separate
        // task instead of adding a candidate here. Only DIRECT exposes its
        // count in the definition; everything else is a runtime question.
        ...(isDecisionPolicyUnsatisfiable(
          data.decisionPolicy,
          data.approverResolver,
        )
          ? [
              `workflow.nodes.${node.id}.decisionPolicy.threshold exceeds the ${readDesignTimeApproverCount(data.approverResolver)} approver(s) this node resolves to`,
            ]
          : []),
        ...(data.returnBehavior?.allowedTargets
          ? []
          : [`workflow.nodes.${node.id}.returnBehavior is required`]),
        ...(!data.returnBehavior?.resubmitStrategy ||
        data.returnBehavior.resubmitStrategy === 'RESTART' ||
        data.returnBehavior.resubmitStrategy === 'FROM_RETURN_POINT'
          ? []
          : [
              `workflow.nodes.${node.id}.returnBehavior.resubmitStrategy is invalid`,
            ]),
        ...(data.returnBehavior?.requireComment === undefined ||
        typeof data.returnBehavior.requireComment === 'boolean'
          ? []
          : [
              `workflow.nodes.${node.id}.returnBehavior.requireComment must be a boolean`,
            ]),
        ...lintSlaConfig(data.sla, node.id),
      ];
    });
}

function lintSlaConfig(
  sla: SlaConfig | undefined,
  nodeId: string,
): readonly string[] {
  if (!sla) {
    return [];
  }

  return [
    ...(parseIsoDurationParts(sla.duration ?? '')
      ? []
      : [`workflow.nodes.${nodeId}.sla.duration is not a valid ISO duration`]),
    ...(SLA_TIMEOUT_ACTIONS.includes(sla.onTimeout)
      ? []
      : [`workflow.nodes.${nodeId}.sla.onTimeout is invalid`]),
    ...(sla.calendar === undefined || SLA_CALENDAR_MODES.includes(sla.calendar)
      ? []
      : [`workflow.nodes.${nodeId}.sla.calendar is invalid`]),
  ];
}

function isSlaWarningAtUsable(sla: SlaConfig): boolean {
  return (
    sla.warningAt === undefined ||
    (typeof sla.warningAt === 'number' &&
      sla.warningAt > 0 &&
      sla.warningAt < 1)
  );
}

/**
 * `BUSINESS_DAY` only advances the duration's day component; any hour/minute
 * part is added as plain elapsed time afterwards and can therefore land outside
 * working hours. That is legal but rarely intended, so it surfaces as a
 * warning rather than blocking publication.
 */
function lintSlaWarnings(nodes: readonly WorkflowNode[]): readonly string[] {
  return nodes
    .filter((node) => node.type === 'userTask')
    .flatMap((node) => {
      const sla = node.data.sla;

      if (!sla) {
        return [];
      }

      const parts = parseIsoDurationParts(sla.duration ?? '');
      const mixesBusinessDayWithTime =
        sla.calendar === 'BUSINESS_DAY' && Boolean(parts) && parts?.timeMs !== 0;

      return [
        ...(mixesBusinessDayWithTime
          ? [
              `workflow.nodes.${node.id}.sla mixes BUSINESS_DAY with an hour/minute component; only the day part skips non-business days`,
            ]
          : []),
        // Deliberately a warning, not an error: the SLA scanner has always
        // ignored an out-of-range warningAt, so promoting it to an error would
        // block republishing templates that already carry one (for example a
        // percentage stored as `75` instead of `0.75`).
        ...(isSlaWarningAtUsable(sla)
          ? []
          : [
              `workflow.nodes.${node.id}.sla.warningAt must be between 0 and 1; the warning notification is skipped`,
            ]),
      ];
    });
}

function lintApproverResolver(
  resolver: ApproverResolver,
  nodeId: string,
): readonly string[] {
  if (!resolver?.type) {
    return [`workflow.nodes.${nodeId}.approverResolver is required`];
  }

  if (resolver.type === 'DIRECT' && resolver.memberIds.length === 0) {
    return [`workflow.nodes.${nodeId}.approverResolver.memberIds is required`];
  }

  if (resolver.type === 'POSITION' && !resolver.positionId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.positionId is required`];
  }

  if (resolver.type === 'ORG_UNIT_MEMBER' && !resolver.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.orgUnitId is required`];
  }

  if (
    resolver.type === 'ORG_UNIT_POSITION' &&
    (!resolver.orgUnitId.trim() || !resolver.positionId.trim())
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.orgUnitId and positionId are required`,
    ];
  }

  if (resolver.type === 'ORG_UNIT_MANAGER' && !resolver.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.orgUnitId is required`];
  }

  if (resolver.type === 'ORG_MANAGER' && resolver.levelsUp < 1) {
    return [`workflow.nodes.${nodeId}.approverResolver.levelsUp is invalid`];
  }

  if (
    (resolver.type === 'ORG_MANAGER' || resolver.type === 'ORG_UNIT_MANAGER') &&
    resolver.fallback?.type === 'DIRECT' &&
    !resolver.fallback.memberId.trim()
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.fallback.memberId is required`,
    ];
  }

  if (resolver.type === 'DYNAMIC_FORM' && !resolver.formPath.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.formPath is required`];
  }

  if (resolver.type === 'EXPRESSION' && !resolver.expression.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.expression is required`];
  }

  return [];
}

function lintServiceTaskNodes(
  nodes: readonly WorkflowNode[],
): readonly string[] {
  return nodes
    .filter((node) => node.type === 'serviceTask')
    .flatMap((node) => lintServiceAction(node.data.action, node.id));
}

function lintServiceAction(
  action: ServiceAction,
  nodeId: string,
): readonly string[] {
  if (!action?.type) {
    return [`workflow.nodes.${nodeId}.action is required`];
  }

  if (action.type === 'WEBHOOK' && !action.url.trim()) {
    return [`workflow.nodes.${nodeId}.action.url is required`];
  }

  if (action.type === 'SET_FORM_FIELD' && !action.fieldPath.trim()) {
    return [`workflow.nodes.${nodeId}.action.fieldPath is required`];
  }

  if (action.type === 'NOTIFY') {
    return lintNotifyRecipients(action.recipients, nodeId);
  }

  return [];
}

function lintNotifyRecipients(
  recipients: ApproverResolver,
  nodeId: string,
): readonly string[] {
  if (!recipients?.type) {
    return [`workflow.nodes.${nodeId}.action.recipients is required`];
  }

  if (recipients.type === 'DIRECT' && recipients.memberIds.length === 0) {
    return [`workflow.nodes.${nodeId}.action.recipients.memberIds is required`];
  }

  if (recipients.type === 'POSITION' && !recipients.positionId.trim()) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.positionId is required`,
    ];
  }

  if (recipients.type === 'ORG_UNIT_MEMBER' && !recipients.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.action.recipients.orgUnitId is required`];
  }

  if (
    recipients.type === 'ORG_UNIT_POSITION' &&
    (!recipients.orgUnitId.trim() || !recipients.positionId.trim())
  ) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.orgUnitId and positionId are required`,
    ];
  }

  if (recipients.type === 'DYNAMIC_FORM' && !recipients.formPath.trim()) {
    return [`workflow.nodes.${nodeId}.action.recipients.formPath is required`];
  }

  if (recipients.type === 'EXPRESSION' && !recipients.expression.trim()) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.expression is required`,
    ];
  }

  return [];
}

function lintAsyncNotifyOutgoingEdges(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  const asyncNotifyNodeIds = new Set(
    nodes
      .filter((node) => isAsyncNotifyServiceTask(node))
      .map((node) => node.id),
  );

  return edges
    .filter((edge) => asyncNotifyNodeIds.has(edge.source))
    .map(
      (edge) =>
        `workflow.edges.${edge.id}.source cannot be a NOTIFY serviceTask`,
    );
}

function lintExclusiveGateways(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  return nodes
    .filter(
      (node) =>
        node.type === 'exclusiveGateway' && node.data.direction === 'split',
    )
    .flatMap((node) => {
      const outgoingEdges = edges.filter((edge) => edge.source === node.id);

      return [
        ...(outgoingEdges.length >= 2
          ? []
          : [
              `workflow.nodes.${node.id} exclusive split requires at least two outgoing edges`,
            ]),
        ...(outgoingEdges.some((edge) => edge.data.isDefault)
          ? []
          : [`workflow.nodes.${node.id} must include a default outgoing edge`]),
      ];
    });
}

function lintParallelGateways(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  return nodes
    .filter(
      (node) =>
        node.type === 'parallelGateway' && node.data.direction === 'join',
    )
    .flatMap((node) => {
      const incomingEdges = edges.filter((edge) => edge.target === node.id);

      return incomingEdges.length >= 2
        ? []
        : [
            `workflow.nodes.${node.id} parallel join requires at least two incoming edges`,
          ];
    });
}

function lintReachability(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): readonly string[] {
  const reachableNodeIds = readReachableNodeIds(edges, startNodeId);
  const unreachableErrors = nodes
    .filter((node) => !reachableNodeIds.has(node.id))
    .map((node) => `workflow.nodes.${node.id} is not reachable from start`);
  const noEndPathErrors = nodes
    .filter(
      (node) =>
        node.type !== 'endEvent' &&
        !isAsyncNotifyServiceTask(node) &&
        !hasPathToEnd(node.id, nodes, edges, new Set<string>()),
    )
    .map(
      (node) => `workflow.nodes.${node.id} does not have a path to an endEvent`,
    );

  return [...unreachableErrors, ...noEndPathErrors];
}

function isAsyncNotifyServiceTask(node: WorkflowNode): boolean {
  return node.type === 'serviceTask' && node.data.action.type === 'NOTIFY';
}

function readReachableNodeIds(
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): ReadonlySet<string> {
  return visitReachableNodeIds(edges, [startNodeId], new Set([startNodeId]));
}

function visitReachableNodeIds(
  edges: readonly WorkflowEdge[],
  pendingNodeIds: readonly string[],
  visitedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentNodeId = pendingNodeIds[0];

  if (!currentNodeId) {
    return visitedNodeIds;
  }

  const remainingNodeIds = pendingNodeIds.slice(1);
  const nextNodeIds = edges
    .filter((edge) => edge.source === currentNodeId)
    .map((edge) => edge.target)
    .filter((nodeId) => !visitedNodeIds.has(nodeId));
  const nextVisitedNodeIds = new Set([...visitedNodeIds, ...nextNodeIds]);

  return visitReachableNodeIds(
    edges,
    [...remainingNodeIds, ...nextNodeIds],
    nextVisitedNodeIds,
  );
}

function hasPathToEnd(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  visited: ReadonlySet<string>,
): boolean {
  const node = nodes.find((candidate) => candidate.id === nodeId);

  if (!node || visited.has(nodeId)) {
    return false;
  }

  if (node.type === 'endEvent') {
    return true;
  }

  const nextVisited = new Set([...visited, nodeId]);

  return edges
    .filter((edge) => edge.source === nodeId)
    .some((edge) => hasPathToEnd(edge.target, nodes, edges, nextVisited));
}

function lintCycles(
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): readonly string[] {
  const cyclicNodeIds = readCyclicNodeIds(edges, startNodeId, [], new Set());

  return [...cyclicNodeIds].map(
    (nodeId) => `workflow contains a cycle involving node ${nodeId}`,
  );
}

function readCyclicNodeIds(
  edges: readonly WorkflowEdge[],
  nodeId: string,
  path: readonly string[],
  visitedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (path.includes(nodeId)) {
    return new Set([nodeId]);
  }

  if (visitedNodeIds.has(nodeId)) {
    return new Set();
  }

  const nextVisitedNodeIds = new Set([...visitedNodeIds, nodeId]);
  const nextPath = [...path, nodeId];

  return edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) =>
      readCyclicNodeIds(edges, edge.target, nextPath, nextVisitedNodeIds),
    )
    .reduce<ReadonlySet<string>>(
      (currentNodeIds, nextNodeIds) =>
        new Set([...currentNodeIds, ...nextNodeIds]),
      new Set(),
    );
}

function readDuplicateErrors(
  values: readonly string[],
  message: string,
): readonly string[] {
  return values
    .filter((value, index) => values.indexOf(value) !== index)
    .filter((value, index, duplicates) => duplicates.indexOf(value) === index)
    .map((value) => `${message}: ${value}`);
}
