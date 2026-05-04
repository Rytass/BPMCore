import {
  ApproverResolver,
  ServiceAction,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@bpm/shared/workflow';

export interface WorkflowDefinitionLintResult {
  readonly errors: readonly string[];
  readonly valid: boolean;
}

export const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
  edges: [
    {
      data: {},
      id: 'edge_start_end',
      source: 'start',
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
      data: { endState: 'APPROVED', label: '完成' },
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
    return { errors: basicErrors, valid: false };
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
    ...lintExclusiveGateways(nodes, edges),
    ...lintParallelGateways(nodes, edges),
  ];

  if (topologyErrors.length) {
    return { errors: topologyErrors, valid: false };
  }

  const startNode = startNodes[0];
  const reachabilityErrors = startNode
    ? lintReachability(nodes, edges, startNode.id)
    : [];

  return {
    errors: reachabilityErrors,
    valid: reachabilityErrors.length === 0,
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
        ...(data.returnBehavior?.allowedTargets
          ? []
          : [`workflow.nodes.${node.id}.returnBehavior is required`]),
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

  return [];
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

      return outgoingEdges.some((edge) => edge.data.isDefault)
        ? []
        : [`workflow.nodes.${node.id} must include a default outgoing edge`];
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
        !hasPathToEnd(node.id, nodes, edges, new Set<string>()),
    )
    .map(
      (node) => `workflow.nodes.${node.id} does not have a path to an endEvent`,
    );

  return [...unreachableErrors, ...noEndPathErrors];
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

function readDuplicateErrors(
  values: readonly string[],
  message: string,
): readonly string[] {
  return values
    .filter((value, index) => values.indexOf(value) !== index)
    .filter((value, index, duplicates) => duplicates.indexOf(value) === index)
    .map((value) => `${message}: ${value}`);
}
