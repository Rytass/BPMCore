import { readReachableWorkflowNodeIds } from '@rytass/bpm-core-shared';
import {
  ExcludeInitiatorWhenEmpty,
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  readExcludeNodeActorsIssues,
  readNodeActorSourceIssues,
  readNodeActorSourceSkipReasons,
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
  const offered: readonly NodeActorOption[] = definition.nodes
    .filter(isUserTaskNode)
    .filter(
      (node) =>
        node.id !== nodeId &&
        readNodeActorSourceSkipReasons(node).length === 0 &&
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

/** The hint under the 不可與前面關卡同一人 picker while it has no problem to report. */
export const EXCLUDE_NODE_ACTORS_STAGE_HINT =
  '此關的簽核人不會是你選的前面關卡實際簽核的人（含其代理人），也不能被轉簽或加簽到此關；可複選，每個關卡都會排除。只能選每條路徑都會經過、而且一定有人實際簽核的關卡（沒有進入條件、沒設跳過此關、沒設逾時自動核准）；條件式的關卡請改用分流，把兩關放在同一條路線上。';

/** Shown when no earlier stage can be picked. */
export const NO_EXCLUDABLE_STAGE_HINT =
  '這個節點前面沒有可以選的簽核關卡，請先在它前面加入簽核節點（每條路徑都會經過、沒有進入條件、沒設跳過此關，也沒設逾時自動核准）';

/**
 * The 不可與前面關卡同一人 picker: the user tasks that pass the publish
 * check on their own (`readExcludeNodeActorsIssues` with just that stage
 * listed: upstream of `nodeId`, on every path to it, not skippable, a real
 * signer every time). Each listed stage has to pass alone, so unlike the
 * `NODE_ACTOR` picker nothing is left to the selection as a whole. A stored
 * stage that does not qualify (gone, no longer upstream, or skippable) stays in
 * the list, marked, and the selection's `problems` say why, so the stored
 * choice is never dropped silently.
 */
export function readExcludeNodeActorStageChoice(
  definition: WorkflowDefinition,
  nodeId: string,
  selectedIds: readonly string[],
  whenEmpty: ExcludeInitiatorWhenEmpty,
): NodeActorStageChoice {
  const offered: readonly NodeActorOption[] = definition.nodes
    .filter(isUserTaskNode)
    .filter(
      (node) =>
        node.id !== nodeId &&
        readExcludeNodeActorsIssues(definition, nodeId, {
          nodeIds: [node.id],
          whenEmpty: 'FAIL',
        }).length === 0,
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
        ? readExcludeNodeActorsIssues(definition, nodeId, {
            nodeIds: selectedIds,
            whenEmpty,
          })
        : options.length === 0
          ? [NO_EXCLUDABLE_STAGE_HINT]
          : [],
    selected,
  };
}

/**
 * The graph problems of every node with 不可與前面關卡同一人, naming the node:
 * the checks the backend publish lint runs (`readExcludeNodeActorsIssues`),
 * for the designer to show before publish. The shape of the setting (no stage
 * chosen, no 排除後沒有簽核人時) is left to `readExcludeNodeActorsShapeIssue`,
 * which blocks saving.
 */
export function readExcludeNodeActorsGraphIssues(
  definition: WorkflowDefinition,
): readonly string[] {
  return definition.nodes.filter(isUserTaskNode).flatMap((node) =>
    readExcludeNodeActorsIssues(
      definition,
      node.id,
      node.data.excludeNodeActors,
    ).map((issue) => `簽核節點「${readNodeName(node)}」：${issue}`),
  );
}
