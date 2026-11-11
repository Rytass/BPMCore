import { readReachableWorkflowNodeIds } from '@rytass/bpm-core-shared';
import {
  ApproverResolver,
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  canUserTaskHaveMultipleApprovers,
  readNodeActorSourceIssues,
  readNodeActorSourceSkipReasons,
  readSingleApproverSourceIssues,
} from '@rytass/bpm-core-shared/workflow-graph';

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
  '這個節點前面沒有可以選的簽核關卡，請先在它前面加入簽核節點（沒有進入條件、沒設跳過此關，也沒設逾時自動核准）';

/** The 關卡 picker's hint while the selection has no problem to report. */
export const NODE_ACTOR_STAGE_HINT =
  '簽核人取自你選的前面關卡實際簽核的人；可複選，整組要涵蓋每條路徑。複選多個關卡時，取最近實際走到的那一關的簽核人，不是全部關卡的簽核人。';

/**
 * The 關卡 picker's hint for a manager chain's 前面關卡的簽核者 start, while
 * the selection has no problem to report.
 */
export const ORG_MANAGER_CHAIN_STAGE_HINT =
  '起點是你選的前面關卡實際簽核的那一位，從他的主管開始往上簽；只能選每次只會有一位簽核人的關卡。可複選，整組要涵蓋每條路徑，取最近實際走到的那一關的簽核者。';

const UNUSABLE_STAGE_SUFFIX = '（無法使用）';
const MISSING_STAGE_SUFFIX = '（已不存在）';

type UserTaskNode = Extract<WorkflowNode, { type: 'userTask' }>;

function isUserTaskNode(node: WorkflowNode): node is UserTaskNode {
  return node.type === 'userTask';
}

function readNodeName(node: WorkflowNode): string {
  return node.data.label || node.id;
}

/**
 * The 關卡 picker of 依前面關卡的簽核者: the user tasks upstream of `nodeId`
 * that always end with a real signer (`readNodeActorSourceSkipReasons` is
 * empty: no entry condition, no 跳過此關, no 逾時自動核准). Whether the whole group
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
  return readStageChoice(
    definition,
    nodeId,
    selectedIds,
    () => true,
    () => [],
  );
}

/**
 * The 關卡 picker of a manager chain's 前面關卡的簽核者 start: the same stages
 * as {@link readNodeActorStageChoice} offers, minus the ones that may end with
 * several signers. The chain climbs from one person, so a stage that
 * `canUserTaskHaveMultipleApprovers` is not offered (a 並行全部同意 stage still
 * is for 依前面關卡的簽核者, which takes everyone). A stored stage of that kind
 * stays in the list, marked, and the selection's problems include the
 * single-signer rule the publish lint runs (`readSingleApproverSourceIssues`).
 */
export function readOrgManagerChainStageChoice(
  definition: WorkflowDefinition,
  nodeId: string,
  selectedIds: readonly string[],
): NodeActorStageChoice {
  return readStageChoice(
    definition,
    nodeId,
    selectedIds,
    (node) => !canUserTaskHaveMultipleApprovers(node),
    (ids) => readSingleApproverSourceIssues(definition, ids),
  );
}

function readStageChoice(
  definition: WorkflowDefinition,
  nodeId: string,
  selectedIds: readonly string[],
  isOfferable: (node: UserTaskNode) => boolean,
  readExtraIssues: (selectedIds: readonly string[]) => readonly string[],
): NodeActorStageChoice {
  const offered: readonly NodeActorOption[] = definition.nodes
    .filter(isUserTaskNode)
    .filter(
      (node) =>
        node.id !== nodeId &&
        readNodeActorSourceSkipReasons(node).length === 0 &&
        isOfferable(node) &&
        readReachableWorkflowNodeIds(definition.edges, [node.id]).has(nodeId),
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
        ? [
            ...readNodeActorSourceIssues(definition, nodeId, selectedIds),
            ...readExtraIssues(selectedIds),
          ]
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
    const nodeIds = readGraphCheckedNodeIds(resolver);

    if (nodeIds.length === 0) {
      return [];
    }

    return [
      ...readNodeActorSourceIssues(definition, node.id, nodeIds),
      // A manager chain starting from a stage also needs that stage to end
      // with one person; `NODE_ACTOR`/`NODE_ACTOR_MANAGER` take everyone.
      ...(resolver.type === 'ORG_MANAGER_CHAIN'
        ? readSingleApproverSourceIssues(definition, nodeIds)
        : []),
    ].map((issue) => `簽核節點「${readNodeName(node)}」：${issue}`);
  });
}

// The stages a resolver reads its signers from, when it is one of the three
// that name earlier stages (a manager chain only with a `NODE_ACTOR` start).
function readGraphCheckedNodeIds(
  resolver: ApproverResolver,
): readonly string[] {
  if (
    resolver.type === 'NODE_ACTOR' ||
    resolver.type === 'NODE_ACTOR_MANAGER'
  ) {
    return resolver.nodeIds;
  }

  if (
    resolver.type === 'ORG_MANAGER_CHAIN' &&
    resolver.startFrom?.type === 'NODE_ACTOR' &&
    Array.isArray(resolver.startFrom.nodeIds)
  ) {
    return resolver.startFrom.nodeIds;
  }

  return [];
}
