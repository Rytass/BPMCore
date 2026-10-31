import {
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { readNodeActorSourceIssues } from '@rytass/bpm-core-shared/workflow-graph';

export type NodeActorOption = Readonly<{
  id: string;
  name: string;
}>;

export type NodeActorStageChoice = Readonly<{
  /** What the 關卡 picker offers, with any stale stored choice appended. */
  options: readonly NodeActorOption[];
  /**
   * Live problems of the whole selection (coverage, parallel branches, a stage
   * that can be skipped, ...), or the hint that nothing can be picked.
   */
  problems: readonly string[];
  selected: readonly NodeActorOption[];
}>;

export const NO_UPSTREAM_USER_TASK_HINT =
  '這個節點前面沒有可以選的簽核關卡，請先在它前面加入簽核節點（沒有進入條件、也沒設跳過此關）';

const UNUSABLE_STAGE_SUFFIX = '（無法使用）';
const MISSING_STAGE_SUFFIX = '（已不存在）';

type UserTaskNode = Extract<WorkflowNode, { type: 'userTask' }>;

function isUserTaskNode(node: WorkflowNode): node is UserTaskNode {
  return node.type === 'userTask';
}

// A node that is skipped (an entry condition or 跳過此關) may leave nobody
// who signed it, so it cannot be the source of "who signed".
function isSkippableUserTask(node: UserTaskNode): boolean {
  return (
    Boolean(node.data.entryCondition?.trim()) ||
    node.data.excludeInitiator?.whenEmpty === 'SKIP_NODE'
  );
}

// Every node a path from `startNodeId` can reach, the start itself excluded
// unless a cycle leads back to it.
function readReachableNodeIds(
  definition: WorkflowDefinition,
  startNodeId: string,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [startNodeId];

  while (pending.length > 0) {
    const current = pending.pop() as string;

    definition.edges
      .filter((edge) => edge.source === current)
      .forEach((edge) => {
        if (!reached.has(edge.target)) {
          reached.add(edge.target);
          pending.push(edge.target);
        }
      });
  }

  return reached;
}

function readNodeName(node: WorkflowNode): string {
  return node.data.label || node.id;
}

/**
 * The 關卡 picker of 依前面關卡的簽核者: the user tasks upstream of `nodeId`
 * that carry no entry condition and no 跳過此關. Whether the whole group
 * covers every path, or straddles a parallel split, is a property of the
 * selection, not of one stage, so it is reported as `problems` and never used
 * to filter the list (SPEC 5.2: the 154 CF_HR_0002 cases rest on two mutually
 * exclusive stages that would each fail the coverage test alone).
 *
 * A stored stage that no longer qualifies stays in the list, marked, so the
 * stored choice stays visible until the author fixes it.
 */
export function readNodeActorStageChoice(
  definition: WorkflowDefinition,
  nodeId: string,
  selectedIds: readonly string[],
): NodeActorStageChoice {
  const offered: readonly NodeActorOption[] = definition.nodes
    .filter(isUserTaskNode)
    .filter(
      (node) =>
        node.id !== nodeId &&
        !isSkippableUserTask(node) &&
        readReachableNodeIds(definition, node.id).has(nodeId),
    )
    .map((node) => ({ id: node.id, name: readNodeName(node) }));
  const stale: readonly NodeActorOption[] = selectedIds
    .filter((id) => !offered.some((option) => option.id === id))
    .map((id) => {
      const node = definition.nodes.find((candidate) => candidate.id === id);

      return {
        id,
        name: node
          ? `${readNodeName(node)}${UNUSABLE_STAGE_SUFFIX}`
          : `${id}${MISSING_STAGE_SUFFIX}`,
      };
    });
  const options = [...offered, ...stale];
  const selected = selectedIds.flatMap((id): readonly NodeActorOption[] => {
    const option = options.find((candidate) => candidate.id === id);

    return option ? [option] : [];
  });

  return {
    options,
    problems:
      selectedIds.length > 0
        ? readNodeActorSourceIssues(definition, nodeId, selectedIds)
        : options.length === 0
          ? [NO_UPSTREAM_USER_TASK_HINT]
          : [],
    selected,
  };
}

/**
 * The graph problems of every 依前面關卡的簽核者 node, naming the node: the
 * checks the backend publish lint runs (`readNodeActorSourceIssues`), for the
 * designer to show before publish. An empty stage list is left to
 * `readApproverResolverIssue`, which owns that message.
 */
export function readNodeActorGraphIssues(
  definition: WorkflowDefinition,
): readonly string[] {
  return definition.nodes.filter(isUserTaskNode).flatMap((node) => {
    const resolver = node.data.approverResolver;

    if (
      (resolver.type !== 'NODE_ACTOR' &&
        resolver.type !== 'NODE_ACTOR_MANAGER') ||
      resolver.nodeIds.length === 0
    ) {
      return [];
    }

    return readNodeActorSourceIssues(definition, node.id, resolver.nodeIds).map(
      (issue) => `簽核節點「${readNodeName(node)}」：${issue}`,
    );
  });
}
