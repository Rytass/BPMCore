/**
 * Helper functions used by InstanceDetailView (the container) that do not
 * belong in any individual section component.
 */

import {
  ActivityLogRecord,
  MemberProfileRecord,
  TaskDecisionRecord,
  TaskRecord,
  listTaskDecisions,
  resolveMemberProfiles,
} from '@rytass/bpm-core-client/workflow';
import {
  isPresentText,
  readDelegationChain as _readDelegationChain,
} from './shared';

// Re-export shared helpers needed by the container
export {
  canMemberActOnTask,
  readErrorMessage,
  readInstanceStateLabel,
  readNodeRuntimeState,
} from './shared';

export async function readMemberProfilesForTimeline({
  activityLogs,
  tasks,
}: {
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly tasks: readonly TaskRecord[];
}): Promise<readonly MemberProfileRecord[]> {
  const memberIds = [
    ...new Set(
      [
        ...activityLogs.map((activityLog) => activityLog.actorMemberId),
        ...tasks.map((task) => task.assigneeMemberId),
        ...tasks.map((task) => task.originalAssigneeMemberId),
        ...tasks.flatMap((task) => task.candidateMemberIds),
        ...tasks.flatMap((task) =>
          _readDelegationChain(task.delegationChainJson).flatMap((step) => [
            step.from,
            step.to,
          ]),
        ),
      ].filter(isPresentText),
    ),
  ];

  try {
    return await resolveMemberProfiles(memberIds);
  } catch {
    return [];
  }
}

export async function readTaskDecisionsForTasks(
  tasks: readonly TaskRecord[],
): Promise<readonly TaskDecisionRecord[]> {
  const decisionLists = await Promise.all(
    tasks.map((task) => listTaskDecisions(task.id)),
  );

  return decisionLists.flat();
}

export function readLatestTaskDecisionsByTaskId(
  taskDecisions: readonly TaskDecisionRecord[],
): ReadonlyMap<string, TaskDecisionRecord> {
  return taskDecisions.reduce<ReadonlyMap<string, TaskDecisionRecord>>(
    (decisionsByTaskId, decision) => {
      const currentDecision = decisionsByTaskId.get(decision.taskId);
      const nextDecision =
        !currentDecision ||
        new Date(decision.decidedAt).getTime() >
          new Date(currentDecision.decidedAt).getTime()
          ? decision
          : currentDecision;

      return new Map(decisionsByTaskId).set(decision.taskId, nextDecision);
    },
    new Map(),
  );
}
