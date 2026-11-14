import { readReachableWorkflowNodeIds } from '@rytass/bpm-core-shared';
import {
  ApproverResolver,
  ExcludeInitiatorWhenEmpty,
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  canUserTaskHaveMultipleApprovers,
  readChainContinuationSourceIssues,
  readExcludeNodeActorsIssues,
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
  '這個節點前面沒有可以選的簽核關卡，請先在它前面加入簽核節點（沒有進入條件、沒設跳過此關、沒設逾時自動核准，主管鏈也沒設略過）';

/** The 關卡 picker's hint while the selection has no problem to report. */
export const NODE_ACTOR_STAGE_HINT =
  '簽核人取自你選的前面關卡實際簽核的人；可複選，整組要涵蓋每條路徑。複選多個關卡時，取最近實際走到的那一關的簽核人，不是全部關卡的簽核人。';

/**
 * The 關卡 picker's hint for a manager chain's 前面關卡的簽核者 start, while
 * the selection has no problem to report.
 */
export const ORG_MANAGER_CHAIN_STAGE_HINT =
  '起點是你選的前面關卡實際簽核的那一位，從他的主管開始往上簽；只能選每次只會有一位簽核人的關卡。可複選，整組要涵蓋每條路徑，取最近實際走到的那一關的簽核者。';

/**
 * The 關卡 picker's hint when every stage upstream of a manager chain may end
 * with several signers, so none can be the start.
 */
export const ORG_MANAGER_CHAIN_ONLY_MULTI_APPROVER_STAGES_HINT =
  '前面的簽核關卡都可能有多位簽核人，所以不能當主管鏈的起點；請改用只有一位簽核人的關卡，或改選其他起點。';

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
  const choice = readStageChoice(
    definition,
    nodeId,
    selectedIds,
    (node) => !canUserTaskHaveMultipleApprovers(node),
    (ids) => readSingleApproverSourceIssues(definition, ids),
  );

  // Empty only because of the single-signer filter: saying "add an approval
  // node" would be wrong, there are some, just none that can start a chain.
  const onlyMultiApproverStages =
    choice.options.length === 0 &&
    selectedIds.length === 0 &&
    readNodeActorStageChoice(definition, nodeId, []).options.length > 0;

  return onlyMultiApproverStages
    ? {
        ...choice,
        problems: [ORG_MANAGER_CHAIN_ONLY_MULTI_APPROVER_STAGES_HINT],
      }
    : choice;
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

/** The hint under the 不可與前面關卡同一人 picker while it has no problem to report. */
export const EXCLUDE_NODE_ACTORS_STAGE_HINT =
  '此關的簽核人不會是你選的前面關卡實際簽核的人（含其代理人），也不能被轉簽或加簽到此關；可複選，每個關卡都會排除。只能選每條路徑都會經過、而且一定有人實際簽核的關卡（沒有進入條件、沒設跳過此關、沒設逾時自動核准，主管鏈也沒設略過）；條件式的關卡、平行分支上的關卡都不支援，條件式的請改用分流把兩關放在同一條路線上，平行分支上的請改成先後串接。';

/** Shown when no earlier stage can be picked. */
export const NO_EXCLUDABLE_STAGE_HINT =
  '這個節點前面沒有可以選的簽核關卡，請先在它前面加入簽核節點（每條路徑都會經過、沒有進入條件、沒設跳過此關、沒設逾時自動核准，主管鏈也沒設略過）';

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

export type ChainContinuationSourceChoice = Readonly<{
  /** The upstream manager chains that can be continued, plus a stale stored choice. */
  options: readonly NodeActorOption[];
  /** Live problems of the stored choice (the publish check's own lines). */
  problems: readonly string[];
  selected: NodeActorOption | null;
}>;

/** Shown when no upstream manager chain can be continued. */
export const NO_CONTINUABLE_CHAIN_HINT =
  '這個節點前面沒有可以接續的主管鏈關卡；需要是每條路徑都會經過、起點為申請人或前面關卡簽核者、本身不是接續型、沒有進入條件、也沒設跳過此關的「沿主管鏈簽核」關卡。';

// A copy of the definition in which `nodeId` continues `sourceId` at a level no
// stage can be at or below, with the hand-over to the initiator's manager taken
// out: those two only produce lines about the continuing stage itself, so what
// is left is the verdict on `sourceId` alone.
function readContinuationProbe(
  definition: WorkflowDefinition,
  nodeId: string,
  sourceId: string,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node): WorkflowNode => {
      if (node.id !== nodeId || !isUserTaskNode(node)) {
        return node;
      }

      const { excludeInitiator, excludeNodeActors, ...rest } = node.data;

      return {
        ...node,
        data: {
          ...rest,
          approverResolver: {
            minPositionLevel: Number.MAX_SAFE_INTEGER,
            startFrom: { nodeId: sourceId, type: 'CHAIN_CONTINUATION' },
            type: 'ORG_MANAGER_CHAIN',
          },
          ...(excludeInitiator &&
          excludeInitiator.whenEmpty !== 'INITIATOR_MANAGER'
            ? { excludeInitiator }
            : {}),
          ...(excludeNodeActors &&
          excludeNodeActors.whenEmpty !== 'INITIATOR_MANAGER'
            ? { excludeNodeActors }
            : {}),
        },
      };
    }),
  };
}

/**
 * The 接續哪一關 picker of a manager chain that continues an earlier one: the
 * manager-chain stages for which `readChainContinuationSourceIssues` has
 * nothing to say when `nodeId` continues them (at an unreachably high level, so
 * the level rule never decides). Judged by the shared check itself, not by
 * matching strings, so the list cannot drift from the publish lint. A stage with
 * 起點本人已達簽到職等時略過 is still offered: the engine reads its skip record.
 * A stored stage that does not qualify stays in the list, marked, and the
 * `problems` say why, so the stored choice is never dropped silently.
 */
export function readChainContinuationSourceChoice(
  definition: WorkflowDefinition,
  nodeId: string,
  selectedId: string | null,
): ChainContinuationSourceChoice {
  const offered: readonly NodeActorOption[] = definition.nodes
    .filter(isUserTaskNode)
    .filter(
      (node) =>
        node.id !== nodeId &&
        node.data.approverResolver?.type === 'ORG_MANAGER_CHAIN' &&
        readChainContinuationSourceIssues(
          readContinuationProbe(definition, nodeId, node.id),
          nodeId,
        ).length === 0,
    )
    .map((node) => ({ id: node.id, name: readNodeName(node) }));
  const storedId = selectedId?.trim() ? selectedId : null;
  const stale: readonly NodeActorOption[] =
    storedId === null || offered.some((option) => option.id === storedId)
      ? []
      : [
          (() => {
            const node = definition.nodes.find(
              (candidate) => candidate.id === storedId,
            );

            return {
              id: storedId,
              name: node
                ? `${readNodeName(node)}${UNUSABLE_STAGE_SUFFIX}`
                : `${storedId}${MISSING_STAGE_SUFFIX}`,
            };
          })(),
        ];
  const options = [...offered, ...stale];

  return {
    options,
    problems:
      storedId !== null
        ? readChainContinuationSourceIssues(definition, nodeId)
        : options.length === 0
          ? [NO_CONTINUABLE_CHAIN_HINT]
          : [],
    selected: options.find((option) => option.id === storedId) ?? null,
  };
}

/**
 * The graph problems of every manager chain that continues an earlier one,
 * naming the node: the checks the backend publish lint runs
 * (`readChainContinuationSourceIssues`), for the designer to show before
 * publish. A missing stage id is left to `readOrgManagerChainIssue`.
 */
export function readChainContinuationGraphIssues(
  definition: WorkflowDefinition,
): readonly string[] {
  return definition.nodes
    .filter(isUserTaskNode)
    .flatMap((node) =>
      readChainContinuationSourceIssues(definition, node.id).map(
        (issue) => `簽核節點「${readNodeName(node)}」：${issue}`,
      ),
    );
}
