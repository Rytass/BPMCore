import type { TaskDecisionRecord } from '@rytass/bpm-core-client/workflow';

/**
 * Newest decision first. Two decisions made in the same instant fall back to
 * their ids, so the inbox and the instance timeline settle on the same one.
 */
export function compareTaskDecisionDesc(
  left: TaskDecisionRecord,
  right: TaskDecisionRecord,
): number {
  const byTime =
    new Date(right.decidedAt).getTime() - new Date(left.decidedAt).getTime();

  return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
}

export function readLatestTaskDecision(
  decisions: readonly TaskDecisionRecord[],
): TaskDecisionRecord | null {
  return [...decisions].sort(compareTaskDecisionDesc)[0] ?? null;
}

/**
 * The newest decision on each task. A sequential or countersign task holds
 * decisions from several signers, so an entry here is only the last signer's.
 */
export function readLatestTaskDecisionsByTaskId(
  decisions: readonly TaskDecisionRecord[],
): ReadonlyMap<string, TaskDecisionRecord> {
  return decisions.reduce(
    (latest, decision): Map<string, TaskDecisionRecord> => {
      const current = latest.get(decision.taskId);

      return !current || compareTaskDecisionDesc(decision, current) < 0
        ? latest.set(decision.taskId, decision)
        : latest;
    },
    new Map<string, TaskDecisionRecord>(),
  );
}
