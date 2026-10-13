import type { TaskRecord } from '@rytass/bpm-core-client/workflow';

/**
 * What a task list shows in its 「節點」 column: the node's display name
 * (`nodeLabel`, resolved server-side from the instance's workflow snapshot),
 * falling back to the raw `nodeId` when the server sent none — an unknown node
 * or a host running its own queries. An ad-hoc task keeps the label of the
 * node it was spawned on and gets the same 臨時會簽／臨時加簽 marker the
 * instance timeline uses.
 */
export function readTaskNodeText(
  task: Pick<TaskRecord, 'adhocType' | 'isAdhoc' | 'nodeId' | 'nodeLabel'>,
): string {
  const label = task.nodeLabel?.trim() ? task.nodeLabel : task.nodeId;

  if (!task.isAdhoc) {
    return label;
  }

  return `${label}${
    task.adhocType === 'COUNTERSIGN' ? '（臨時會簽）' : '（臨時加簽）'
  }`;
}
