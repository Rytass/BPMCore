/**
 * Helper functions used by InstanceDetailView (the container) that do not
 * belong in any individual section component.
 */

import {
  ActivityLogRecord,
  AdhocDirectiveRecord,
  ApprovalInstanceRecord,
  MemberProfileRecord,
  TaskDecisionRecord,
  TaskRecord,
  listTaskDecisions,
  resolveMemberProfiles,
} from '@rytass/bpm-core-client/workflow';
import {
  isPresentText,
  readDelegationChain as _readDelegationChain,
  readSequentialActivityPayloadMemberIds,
} from './shared';

// Re-export shared helpers needed by the container
export {
  readActingTask,
  readErrorMessage,
  readInstanceStateLabel,
  readNodeRuntimeState,
} from './shared';

export async function readMemberProfilesForTimeline({
  activityLogs,
  adhocDirectives = [],
  instance,
  tasks,
}: {
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly adhocDirectives?: readonly AdhocDirectiveRecord[];
  readonly instance?: Pick<
    ApprovalInstanceRecord,
    'initiatorMemberId' | 'submittedByMemberId'
  >;
  readonly tasks: readonly TaskRecord[];
}): Promise<readonly MemberProfileRecord[]> {
  const memberIds = [
    ...new Set(
      [
        // The applicant and whoever filed on their behalf are named in the
        // page header even when the timeline does not mention them.
        instance?.initiatorMemberId ?? null,
        instance?.submittedByMemberId ?? null,
        ...activityLogs.map((activityLog) => activityLog.actorMemberId),
        ...activityLogs.flatMap(readSequentialActivityPayloadMemberIds),
        ...tasks.map((task) => task.assigneeMemberId),
        ...tasks.map((task) => task.originalAssigneeMemberId),
        ...tasks.flatMap((task) => task.candidateMemberIds),
        ...tasks.flatMap((task) =>
          _readDelegationChain(task.delegationChainJson).flatMap((step) => [
            step.from,
            step.to,
          ]),
        ),
        ...adhocDirectives.flatMap((directive) => [
          directive.createdByMemberId,
          ...readAdhocDirectiveTargetMemberIds(directive.targetValueJson),
        ]),
      ].filter(isPresentText),
    ),
  ];

  try {
    return await resolveMemberProfiles(memberIds);
  } catch {
    return [];
  }
}

function readAdhocDirectiveTargetMemberIds(
  targetValueJson: string,
): readonly string[] {
  try {
    const value = JSON.parse(targetValueJson) as {
      readonly memberIds?: readonly unknown[];
    };

    return (value.memberIds ?? []).filter(
      (memberId): memberId is string => typeof memberId === 'string',
    );
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
