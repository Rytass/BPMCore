import type { ActivityLogRecord } from '@rytass/bpm-core-client';

import { readActivityDetailParts } from './shared';

function createDecisionActivityLog(): ActivityLogRecord {
  return {
    actorMemberId: 'member-approver',
    createdAt: '2026-09-07T08:44:45.000Z',
    eventType: 'TASK_DECIDED',
    id: 'activity-1',
    instanceId: 'instance-1',
    nodeId: 'userTask_1',
    payloadJson: '{}',
    taskId: 'task-1',
  } as unknown as ActivityLogRecord;
}

function readParts(
  payload: Readonly<Record<string, unknown>>,
): readonly ReturnType<typeof readActivityDetailParts>[number][] {
  return readActivityDetailParts(
    createDecisionActivityLog(),
    payload,
    null,
    new Map(),
    new Map(),
    null,
    new Map(),
  );
}

describe('readActivityDetailParts', () => {
  it('keeps an approval comment out of the inline metadata run', () => {
    const parts = readParts({ action: 'APPROVED', comment: '請注意交期' });

    // The comment must not be folded into a `text` part: those are joined with
    // " · " alongside the node, actor, timestamp and signature hash, which is
    // what made a written comment unreadable in the timeline.
    expect(parts).toContainEqual({
      label: '同意說明',
      text: '請注意交期',
      tone: 'neutral',
      type: 'comment',
    });
    expect(
      parts.filter((part) => part.type === 'text' && part.text.includes('請注意交期')),
    ).toHaveLength(0);
  });

  it('marks a rejection reason as a danger comment', () => {
    const parts = readParts({ action: 'REJECTED', comment: '金額有誤' });

    expect(parts).toContainEqual({
      label: '拒絕原因',
      text: '金額有誤',
      tone: 'danger',
      type: 'comment',
    });
  });

  it('keeps the decision label inline', () => {
    const parts = readParts({ action: 'APPROVED', comment: '請注意交期' });

    expect(parts).toContainEqual({ text: '決議：同意', type: 'text' });
  });

  it('emits no comment part when an approval carries no comment', () => {
    const parts = readParts({ action: 'APPROVED', comment: null });

    expect(parts.filter((part) => part.type === 'comment')).toHaveLength(0);
  });

  it('still shows a placeholder for a rejection with no comment', () => {
    const parts = readParts({ action: 'REJECTED', comment: null });

    expect(parts).toContainEqual({
      label: '拒絕原因',
      text: '-',
      tone: 'danger',
      type: 'comment',
    });
  });
});
