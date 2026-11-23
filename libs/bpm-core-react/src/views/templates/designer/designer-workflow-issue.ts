import type {
  WorkflowDefinition,
  WorkflowEdge,
} from '@rytass/bpm-core-shared/workflow';
import {
  isExclusiveGatewaySourceEdge,
  isOrgManagerChainDecisionPolicyInvalid,
  isParallelGatewaySourceEdge,
  readApproverResolverIssue,
  readExcludeInitiatorIssue,
  readExcludeNodeActorsShapeIssue,
  readNotifyServiceTaskIssue,
} from '@rytass/bpm-core-shared/workflow-graph';

/**
 * `true` for an exclusive-gateway outgoing edge that has neither a condition
 * nor the default flag, so the designer shows it in red and blocks saving.
 */
export function isIncompleteConditionEdge(
  edge: WorkflowEdge,
  definition: Pick<WorkflowDefinition, 'edges' | 'nodes'>,
): boolean {
  return (
    isExclusiveGatewaySourceEdge(edge, definition.nodes) &&
    !edge.data.isDefault &&
    !edge.data.condition
  );
}

/**
 * The text drawn on an edge: its own label, else the path label of the
 * gateway it leaves.
 */
export function readEdgeCanvasLabel(
  edge: WorkflowEdge,
  definition: Pick<WorkflowDefinition, 'edges' | 'nodes'>,
): string | undefined {
  if (edge.data.label) {
    return edge.data.label;
  }

  if (isExclusiveGatewaySourceEdge(edge, definition.nodes)) {
    return readExclusiveGatewayPathLabel(edge);
  }

  if (isParallelGatewaySourceEdge(edge, definition.nodes)) {
    return '同時進行';
  }

  return undefined;
}

function readExclusiveGatewayPathLabel(edge: WorkflowEdge): string {
  if (edge.data.isDefault) {
    return '其他情況';
  }

  return '請設定條件';
}

/**
 * The first reason the designer refuses to save, test-run or publish the
 * definition, or `null` when nothing blocks it. Kept apart from the shared
 * `readWorkflowDefinitionIssue`, which also asks for a quorum threshold that
 * can be met and a default path (docs/19-notify-webhook-phases.md, item 8).
 */
export function readDesignerWorkflowIssue(
  definition: WorkflowDefinition,
): string | null {
  const incompleteUserTaskNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      Boolean(readApproverResolverIssue(node.data.approverResolver)),
  );
  const excludeInitiatorNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      Boolean(readExcludeInitiatorIssue(node.data.excludeInitiator)),
  );
  const excludeNodeActorsShapeIssue =
    definition.nodes
      .map((node) =>
        node.type === 'userTask'
          ? readExcludeNodeActorsShapeIssue(node.data.excludeNodeActors)
          : null,
      )
      .find((issue): issue is string => issue !== null) ?? null;
  // Shared with the backend lint and the AI toolset so a webhook-only or a
  // runtime-resolved (position, org unit, manager) NOTIFY node is judged the
  // same everywhere (ADR 18 P0).
  const notifyNodeIssue =
    definition.nodes
      .map((node) => readNotifyServiceTaskIssue(node))
      .find((issue): issue is string => issue !== null) ?? null;
  const incompleteConditionEdge = definition.edges.find((edge) =>
    isIncompleteConditionEdge(edge, definition),
  );
  const chainPolicyNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      isOrgManagerChainDecisionPolicyInvalid(
        node.data.approverResolver,
        node.data.decisionPolicy,
      ),
  );

  if (incompleteUserTaskNode && incompleteUserTaskNode.type === 'userTask') {
    return readApproverResolverIssue(
      incompleteUserTaskNode.data.approverResolver,
    );
  }

  if (chainPolicyNode && chainPolicyNode.type === 'userTask') {
    return `簽核節點「${chainPolicyNode.data.label}」使用「沿主管鏈簽核」時，決策方式必須是「依序簽核或全部同意」，否則任一位主管簽完就會結案。`;
  }

  if (excludeInitiatorNode && excludeInitiatorNode.type === 'userTask') {
    return readExcludeInitiatorIssue(
      excludeInitiatorNode.data.excludeInitiator,
    );
  }

  if (excludeNodeActorsShapeIssue) {
    return excludeNodeActorsShapeIssue;
  }

  if (notifyNodeIssue) {
    return notifyNodeIssue;
  }

  if (incompleteConditionEdge) {
    return '條件分流的每條輸出連線都需要先設定條件。';
  }

  return null;
}
