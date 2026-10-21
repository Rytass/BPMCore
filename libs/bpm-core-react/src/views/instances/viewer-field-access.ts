import {
  readRevealedFieldKeys,
  resolveFieldAccess,
  type ResolvedFieldAccess,
} from '@rytass/bpm-core-shared';
import type {
  ActivityLogRecord,
  ApprovalInstanceRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';

/**
 * The nodes that have produced a non-ad-hoc task (docs/08 §8.3): every
 * `TASK_CREATED` whose task is not ad hoc. The task decides, not the log
 * payload — the original task reopened after a refused pre-approval carries an
 * `adhocDirectiveId` too, yet it is the node's own task. A log whose task is
 * not in `tasks` is skipped, since nothing tells whether it was ad hoc.
 */
export function readRevealedNodeIds(
  activityLogs: readonly ActivityLogRecord[],
  tasks: readonly TaskRecord[],
): ReadonlySet<string> {
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const));

  return new Set(
    activityLogs
      .filter((log) => log.eventType === 'TASK_CREATED')
      .map((log) => (log.taskId === null ? undefined : tasksById.get(log.taskId)))
      .filter((task): task is TaskRecord => task !== undefined && !task.isAdhoc)
      .map((task) => task.nodeId),
  );
}

/**
 * What the viewer may see and edit per top-level form field (ADR 20 §3.3).
 * `actingTask` is the task the viewer may act on now, or `null` for the
 * applicant, an administrator or a closed instance, who get the revealed
 * fields read-only and nothing else editable.
 */
export function readViewerFieldAccess({
  activityLogs,
  actingTask,
  instance,
  tasks,
}: {
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly actingTask: TaskRecord | null;
  readonly instance: Pick<
    ApprovalInstanceRecord,
    'formDefinitionSnapshot' | 'workflowSnapshot'
  >;
  readonly tasks: readonly TaskRecord[];
}): Readonly<Record<string, ResolvedFieldAccess>> {
  const definition = instance.workflowSnapshot;

  return resolveFieldAccess({
    definition,
    fieldKeys: (instance.formDefinitionSnapshot.schema?.fields ?? []).map(
      (field) => field.fieldKey,
    ),
    isAdhocTask: actingTask?.isAdhoc ?? false,
    nodeId: actingTask?.nodeId ?? null,
    revealedFieldKeys: readRevealedFieldKeys(
      definition,
      readRevealedNodeIds(activityLogs, tasks),
    ),
  });
}
