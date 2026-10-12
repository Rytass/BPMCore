import type {
  ActivityLogRecord,
  MemberProfileRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';

import {
  canMemberActOnTask,
  isActivityError,
  isUserMeaningfulActivity,
  readActivityDetailParts,
  readActivityEventLabel,
  readAdhocTargetDraft,
} from './shared';

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

describe('readAdhocTargetDraft', () => {
  it('sends every selected member, not just the first', () => {
    expect(
      readAdhocTargetDraft({
        memberIds: ['member-a', 'member-b', 'member-c'],
        useWebhookTarget: false,
        webhookUrl: '',
      }),
    ).toEqual({
      target: {
        kind: 'MEMBER',
        memberIds: ['member-a', 'member-b', 'member-c'],
      },
      valid: true,
    });
  });

  it('refuses an empty member selection', () => {
    expect(
      readAdhocTargetDraft({
        memberIds: [],
        useWebhookTarget: false,
        webhookUrl: '',
      }),
    ).toEqual({ error: '請選擇對象成員', valid: false });
  });

  it('trims a webhook url', () => {
    expect(
      readAdhocTargetDraft({
        memberIds: [],
        useWebhookTarget: true,
        webhookUrl: '  https://example.com/hook  ',
      }),
    ).toEqual({
      target: { kind: 'WEBHOOK', webhookUrl: 'https://example.com/hook' },
      valid: true,
    });
  });

  it('refuses a blank webhook url', () => {
    expect(
      readAdhocTargetDraft({
        memberIds: ['member-a'],
        useWebhookTarget: true,
        webhookUrl: '   ',
      }),
    ).toEqual({ error: '請輸入 Webhook URL', valid: false });
  });

  it('ignores selected members once the webhook target is chosen', () => {
    expect(
      readAdhocTargetDraft({
        memberIds: ['member-a'],
        useWebhookTarget: true,
        webhookUrl: 'https://example.com/hook',
      }),
    ).toEqual({
      target: { kind: 'WEBHOOK', webhookUrl: 'https://example.com/hook' },
      valid: true,
    });
  });
});

describe('notify webhook timeline entries', () => {
  function webhookLog(
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
  ): ActivityLogRecord {
    return {
      actorMemberId: null,
      createdAt: '2026-09-15T10:00:00.000Z',
      eventType,
      id: `log-${eventType}`,
      instanceId: 'instance-1',
      nodeId: 'notify',
      payloadJson: JSON.stringify(payload),
      taskId: null,
    } as unknown as ActivityLogRecord;
  }

  const sent = {
    action: 'NOTIFY_WEBHOOK',
    endpointKey: 'demo.ok',
    endpointLabel: '示範：採購核准',
    errorCode: null,
  };

  it('puts webhook outcomes and retries on the timeline, but no other service task', () => {
    expect(
      isUserMeaningfulActivity(webhookLog('SERVICE_TASK_EXECUTED', sent)),
    ).toBe(true);
    expect(
      isUserMeaningfulActivity(
        webhookLog('WEBHOOK_DELIVERY_RETRIED', { ...sent }),
      ),
    ).toBe(true);
    expect(
      isUserMeaningfulActivity(
        webhookLog('SERVICE_TASK_EXECUTED', { action: 'WEBHOOK' }),
      ),
    ).toBe(false);
  });

  it('names the endpoint, falling back to its key on logs written without a label', () => {
    expect(readActivityEventLabel('SERVICE_TASK_EXECUTED', sent)).toBe(
      '已通知外部系統：示範：採購核准',
    );
    expect(
      readActivityEventLabel('SERVICE_TASK_FAILED', {
        action: 'NOTIFY_WEBHOOK',
        endpointKey: 'demo.flaky',
      }),
    ).toBe('通知外部系統失敗：demo.flaky');
    expect(readActivityEventLabel('WEBHOOK_DELIVERY_RETRIED', sent)).toBe(
      '管理者重新傳送外部系統通知：示範：採購核准',
    );
  });

  it('marks a failed delivery as an error without exposing its error code', () => {
    const failed = { ...sent, errorCode: 'WEBHOOK_HTTP_503' };
    const log = webhookLog('SERVICE_TASK_FAILED', failed);

    expect(isActivityError(log, failed)).toBe(true);
    expect(
      isActivityError(webhookLog('SERVICE_TASK_EXECUTED', sent), sent),
    ).toBe(false);
    expect(
      JSON.stringify(
        readActivityDetailParts(
          log,
          failed,
          null,
          new Map(),
          new Map(),
          null,
          new Map(),
        ),
      ),
    ).not.toContain('WEBHOOK_HTTP_503');
  });
});

function readEventParts(
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): readonly ReturnType<typeof readActivityDetailParts>[number][] {
  const profiles = new Map<string, MemberProfileRecord>(
    ['alice', 'bob', 'carol'].map((id) => [
      id,
      { email: `${id}@example.com`, id, name: id.toUpperCase() } as MemberProfileRecord,
    ]),
  );

  return readActivityDetailParts(
    { ...createDecisionActivityLog(), eventType } as ActivityLogRecord,
    payload,
    null,
    new Map(),
    new Map(),
    null,
    profiles,
  );
}

describe('sequential signing in the timeline', () => {
  it('lists the whole signing order on a SEQUENTIAL TASK_CREATED', () => {
    expect(
      readEventParts('TASK_CREATED', {
        assigneeMemberId: 'alice',
        candidateMemberIds: ['alice'],
        sequentialCandidateMemberIds: ['alice', 'bob', 'carol'],
      }),
    ).toEqual([
      {
        text: '簽核順序：ALICE（alice@example.com） → BOB（bob@example.com） → CAROL（carol@example.com）',
        type: 'text',
      },
    ]);
  });

  it('keeps 候選簽核人 for a task that is not sequential', () => {
    expect(
      readEventParts('TASK_CREATED', {
        assigneeMemberId: null,
        candidateMemberIds: ['alice', 'bob'],
      }),
    ).toEqual([
      {
        text: '候選簽核人：ALICE（alice@example.com）、BOB（bob@example.com）',
        type: 'text',
      },
    ]);
  });

  it('labels and describes a candidate being activated', () => {
    expect(readActivityEventLabel('TASK_CANDIDATE_ACTIVATED', {})).toBe(
      '輪到下一位簽核',
    );
    expect(
      readEventParts('TASK_CANDIDATE_ACTIVATED', {
        candidateMemberId: 'bob',
        previousMemberId: 'alice',
      }),
    ).toEqual([
      {
        text: '輪到：BOB（bob@example.com）（前一位：ALICE（alice@example.com））',
        type: 'text',
      },
    ]);
  });
});

describe('canMemberActOnTask', () => {
  function task(overrides: Partial<TaskRecord>): TaskRecord {
    return {
      assigneeMemberId: 'alice',
      candidateMemberIds: ['alice', 'bob'],
      ...overrides,
    } as TaskRecord;
  }

  it('lets the active candidate act but not one still waiting their turn', () => {
    const sequential = task({ openCandidateMemberIds: ['alice'] });

    expect(canMemberActOnTask(sequential, 'alice')).toBe(true);
    expect(canMemberActOnTask(sequential, 'bob')).toBe(false);
  });

  it('lets every open candidate act on a parallel task', () => {
    const parallel = task({
      assigneeMemberId: null,
      openCandidateMemberIds: ['alice', 'bob'],
    });

    expect(canMemberActOnTask(parallel, 'bob')).toBe(true);
  });

  it('falls back to candidateMemberIds when the server sends no open list', () => {
    expect(canMemberActOnTask(task({ assigneeMemberId: null }), 'bob')).toBe(
      true,
    );
    expect(canMemberActOnTask(task({}), null)).toBe(false);
  });
});
