import type { WorkflowDefinition, WorkflowEdge } from './workflow';

/**
 * The nodes reachable from `startNodeIds` along `edges` without entering one
 * of `blockedNodeIds`, the start nodes included unless blocked. Walks the
 * graph one frontier at a time and drops every node it has already seen, so a
 * cycle ends the walk instead of feeding it.
 */
export function readReachableWorkflowNodeIds(
  edges: readonly WorkflowEdge[],
  startNodeIds: readonly string[],
  blockedNodeIds: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const walk = (
    frontier: readonly string[],
    visited: ReadonlySet<string>,
  ): ReadonlySet<string> => {
    const fresh = [...new Set(frontier)].filter(
      (nodeId) => !visited.has(nodeId) && !blockedNodeIds.has(nodeId),
    );

    return fresh.length
      ? walk(
          edges
            .filter((edge) => fresh.includes(edge.source))
            .map((edge) => edge.target),
          new Set([...visited, ...fresh]),
        )
      : visited;
  };

  return walk(startNodeIds, new Set<string>());
}

/**
 * For every `parallelGateway` with at least two outgoing edges, the sets of
 * nodes each outgoing edge reaches (one set per edge, in edge order).
 * `readReachable` lets a caller that walks the same graph many times pass its
 * own cached reader.
 */
export function readWorkflowParallelBranchSets(
  definition: WorkflowDefinition,
  readReachable: (nodeId: string) => ReadonlySet<string> = (nodeId) =>
    readReachableWorkflowNodeIds(definition.edges, [nodeId]),
): readonly (readonly ReadonlySet<string>[])[] {
  return definition.nodes
    .filter((node) => node.type === 'parallelGateway')
    .map((node) =>
      definition.edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => readReachable(edge.target)),
    )
    .filter((branches) => branches.length >= 2);
}

/**
 * Whether one parallel split sends `nodeId` and `otherNodeId` down branches of
 * their own: `nodeId` is reachable from one outgoing edge but not the
 * `otherNodeId`, and another outgoing edge reaches `otherNodeId` but not
 * `nodeId`. Two nodes in a row, on one branch, or both after the join are not.
 */
export function isOnOwnParallelBranch(
  branches: readonly ReadonlySet<string>[],
  nodeId: string,
  otherNodeId: string,
): boolean {
  return branches.some(
    (branch, index) =>
      branch.has(nodeId) &&
      !branch.has(otherNodeId) &&
      branches.some(
        (other, otherIndex) =>
          otherIndex !== index && other.has(otherNodeId) && !other.has(nodeId),
      ),
  );
}
