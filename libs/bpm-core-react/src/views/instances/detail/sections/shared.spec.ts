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
  readActingTask,
  readActivityStepRecords,
  readAdhocTargetDraft,
  readMemberDisplayText,
  readNodeRuntimeState,
  readSequentialActivityPayloadMemberIds,
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

describe('approver-filled fields in the timeline', () => {
  const parts = (
    payload: Readonly<Record<string, unknown>>,
  ): readonly ReturnType<typeof readActivityDetailParts>[number][] =>
    readActivityDetailParts(
      createDecisionActivityLog(),
      payload,
      null,
      new Map(),
      new Map(),
      null,
      new Map(),
      {
        fields: [
          { fieldKey: 'invoiceNo', label: '發票號碼', required: false, type: 'text' },
        ],
        schemaVersion: 1,
      },
    );

  it('names the filled fields by label and falls back to the key', () => {
    expect(
      parts({ action: 'APPROVED', changedFieldKeys: ['invoiceNo', 'gone'] }),
    ).toContainEqual({ text: '補填 2 個欄位：發票號碼、gone', type: 'text' });
  });

  it('adds nothing when no field was filled', () => {
    expect(
      parts({ action: 'APPROVED', changedFieldKeys: [] }).filter(
        (part) => part.type === 'text' && part.text.startsWith('補填'),
      ),
    ).toHaveLength(0);
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

describe('readActingTask', () => {
  function task(overrides: Partial<TaskRecord>): TaskRecord {
    return {
      assigneeMemberId: 'alice',
      candidateMemberIds: ['alice'],
      isAdhoc: false,
      status: 'PENDING',
      ...overrides,
    } as TaskRecord;
  }

  it("prefers the node's own task over an ad-hoc one", () => {
    const adhoc = task({ id: 'adhoc', isAdhoc: true });
    const own = task({ id: 'own' });

    expect(readActingTask([adhoc, own], 'alice')?.id).toBe('own');
  });

  it('falls back to an ad-hoc task when that is all the member holds', () => {
    expect(
      readActingTask([task({ id: 'adhoc', isAdhoc: true })], 'alice')?.id,
    ).toBe('adhoc');
  });

  it('skips tasks that are closed or not the member\'s to act on', () => {
    const tasks = [
      task({ id: 'done', status: 'COMPLETED' }),
      task({ assigneeMemberId: 'bob', candidateMemberIds: ['bob'], id: 'bob' }),
      task({ id: 'adhoc', isAdhoc: true, status: 'IN_PROGRESS' }),
    ];

    expect(readActingTask(tasks, 'alice')?.id).toBe('adhoc');
    expect(readActingTask(tasks, 'carol')).toBeNull();
    expect(readActingTask(tasks, null)).toBeNull();
  });
});

describe('sequential signing in the instance timeline', () => {
  const profiles = new Map<string, MemberProfileRecord>(
    ['alice', 'bob', 'carol'].map((id) => [
      id,
      { email: `${id}@example.com`, id, name: id.toUpperCase() } as MemberProfileRecord,
    ]),
  );

  function log(
    id: string,
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
  ): ActivityLogRecord {
    return {
      ...createDecisionActivityLog(),
      eventType,
      id,
      payloadJson: JSON.stringify(payload),
    } as ActivityLogRecord;
  }

  function steps(
    logs: readonly ActivityLogRecord[],
  ): ReturnType<typeof readActivityStepRecords> {
    return readActivityStepRecords(
      logs,
      [],
      [],
      null,
      'IN_PROGRESS' as never,
      profiles,
      new Map(),
      new Map(),
      null,
    );
  }

  function textOf(
    step: ReturnType<typeof readActivityStepRecords>[number],
  ): string {
    return step.descriptionParts
      .map((part) => ('text' in part ? part.text : ''))
      .join(' | ');
  }

  it('shows the signing order, each approval and every hand-off', () => {
    const result = steps([
      log('created', 'TASK_CREATED', {
        assigneeMemberId: 'alice',
        candidateMemberIds: ['alice'],
        sequentialCandidateMemberIds: ['alice', 'bob'],
      }),
      log('decided', 'TASK_DECIDED', { action: 'APPROVED' }),
      log('activated', 'TASK_CANDIDATE_ACTIVATED', {
        candidateMemberId: 'bob',
        previousMemberId: 'alice',
      }),
    ]);

    expect(result.map((step) => step.id).slice(0, 3)).toEqual([
      'created',
      'decided',
      'activated',
    ]);
    expect(textOf(result[0])).toContain(
      '簽核順序：ALICE（alice@example.com） → BOB（bob@example.com）',
    );
    expect(result[2].title).toBe('輪到下一位簽核');
    expect(textOf(result[2])).toContain('輪到：BOB（bob@example.com）');
  });

  it('keeps an ordinary TASK_CREATED off the timeline', () => {
    const result = steps([
      log('created', 'TASK_CREATED', {
        assigneeMemberId: 'alice',
        candidateMemberIds: ['alice', 'bob'],
      }),
    ]);

    expect(result.map((step) => step.id)).not.toContain('created');
    expect(
      isUserMeaningfulActivity(log('x', 'TASK_CREATED', {})),
    ).toBe(false);
  });

  it('collects the member ids that only appear in sequential payloads', () => {
    expect(
      readSequentialActivityPayloadMemberIds(
        log('c', 'TASK_CREATED', {
          sequentialCandidateMemberIds: ['alice', 'bob', 'carol'],
        }),
      ),
    ).toEqual(['alice', 'bob', 'carol']);
    expect(
      readSequentialActivityPayloadMemberIds(
        log('a', 'TASK_CANDIDATE_ACTIVATED', {
          candidateMemberId: 'bob',
          previousMemberId: 'alice',
        }),
      ),
    ).toEqual(['bob', 'alice']);
    expect(
      readSequentialActivityPayloadMemberIds(
        log('d', 'TASK_DECIDED', { candidateMemberId: 'bob' }),
      ),
    ).toEqual([]);
  });
});

describe('instance start on behalf of the applicant', () => {
  const profiles = new Map<string, MemberProfileRecord>([
    ['applicant', { email: 'a@example.com', id: 'applicant', name: '陳申請' } as MemberProfileRecord],
    ['assistant', { email: 'b@example.com', id: 'assistant', name: '王助理' } as MemberProfileRecord],
  ]);

  function startedSteps(
    submittedByMemberId: string | null,
  ): ReturnType<typeof readActivityStepRecords> {
    return readActivityStepRecords(
      [
        {
          ...createDecisionActivityLog(),
          actorMemberId: 'applicant',
          eventType: 'INSTANCE_STARTED',
          id: 'started',
          payloadJson: JSON.stringify({ submittedByMemberId }),
        } as ActivityLogRecord,
      ],
      [],
      [],
      null,
      'RUNNING' as never,
      profiles,
      new Map(),
      new Map(),
      null,
    );
  }

  function textOf(
    step: ReturnType<typeof readActivityStepRecords>[number],
  ): string {
    return step.descriptionParts
      .map((part) => ('text' in part ? part.text : ''))
      .join(' | ');
  }

  it('shows who filed it when that is not the applicant', () => {
    const [started] = startedSteps('assistant');

    expect(started.title).toBe('案件已發起');
    expect(textOf(started)).toContain('由 王助理 代 陳申請 送出');
  });

  it.each([
    ['the applicant submitted it themselves', 'applicant'],
    ['no submitter was recorded', null],
  ])('adds nothing when %s', (_label, submittedByMemberId) => {
    const [started] = startedSteps(submittedByMemberId);

    expect(textOf(started)).not.toContain('代');
  });
});

describe('readMemberDisplayText', (): void => {
  const profile = (email: string): MemberProfileRecord =>
    ({
      customFieldsJson: '{}',
      email,
      memberId: 'member-1',
      name: '王小明',
    }) as MemberProfileRecord;

  it('shows the name with the e-mail in fullwidth parentheses', (): void => {
    expect(
      readMemberDisplayText(
        'member-1',
        new Map([['member-1', profile('ming@example.com')]]),
      ),
    ).toBe('王小明（ming@example.com）');
  });

  it('drops the empty parentheses when the member has no e-mail', (): void => {
    expect(
      readMemberDisplayText('member-1', new Map([['member-1', profile('')]])),
    ).toBe('王小明');
    expect(
      readMemberDisplayText(
        'member-1',
        new Map([['member-1', profile('  ')]]),
      ),
    ).toBe('王小明');
  });
});

describe('administrator reassignment in the timeline', () => {
  it('puts a TASK_REASSIGNED entry on the user timeline', () => {
    expect(
      isUserMeaningfulActivity({
        actorMemberId: 'admin-001',
        createdAt: '2026-10-15T10:00:00.000Z',
        eventType: 'TASK_REASSIGNED',
        id: 'log-reassigned',
        instanceId: 'instance-1',
        nodeId: 'task_finance',
        payloadJson: '{}',
        taskId: 'task-1',
      } as unknown as ActivityLogRecord),
    ).toBe(true);
  });
});

describe('how an instance ended', (): void => {
  const endNode = {
    data: { endState: 'APPROVED', label: '結束' },
    id: 'end',
    position: { x: 0, y: 0 },
    type: 'endEvent',
  } as Parameters<typeof readNodeRuntimeState>[0];
  const endLabel = (instanceState: string): string =>
    readNodeRuntimeState(endNode, [], [], instanceState).statusLabel;
  const instanceLog = (eventType: string): ActivityLogRecord =>
    ({
      actorMemberId: null,
      createdAt: '2026-10-15T08:00:00.000Z',
      eventType,
      id: 'activity-end',
      instanceId: 'instance-1',
      nodeId: null,
      payloadJson: '{}',
      taskId: null,
    }) as unknown as ActivityLogRecord;

  it('names the outcome on the end node', (): void => {
    // Every state but RUNNING used to read 已完成 here.
    expect(endLabel('APPROVED')).toBe('已完成');
    expect(endLabel('REJECTED')).toBe('已拒絕');
    expect(endLabel('CANCELLED')).toBe('已取消');
    expect(endLabel('EXPIRED')).toBe('已逾期終止');
  });

  it('leaves the end node unreached while the case is still open', (): void => {
    expect(endLabel('RUNNING')).toBe('未抵達');
    expect(endLabel('RETURNED')).toBe('未抵達');
  });

  it('shows a cancellation and an SLA expiry in the timeline', (): void => {
    expect(isUserMeaningfulActivity(instanceLog('INSTANCE_CANCELLED'))).toBe(
      true,
    );
    expect(isUserMeaningfulActivity(instanceLog('INSTANCE_EXPIRED'))).toBe(true);
    expect(readActivityEventLabel('INSTANCE_CANCELLED', {})).toBe('案件已取消');
    expect(readActivityEventLabel('INSTANCE_EXPIRED', {})).toBe(
      '案件逾期，已由系統終止',
    );
    expect(isActivityError(instanceLog('INSTANCE_EXPIRED'), {})).toBe(true);
  });
});
