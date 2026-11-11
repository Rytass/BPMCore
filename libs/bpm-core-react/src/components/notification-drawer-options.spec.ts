import type { NotificationRecord } from '@rytass/bpm-core-client/workflow';
import { buildNotificationOptions } from './notification-drawer-options';

function record(
  value: Partial<NotificationRecord> & {
    readonly payload?: Readonly<Record<string, unknown>>;
  } = {},
): NotificationRecord {
  const { payload, ...rest } = value;

  return {
    actionable: true,
    allowReject: null,
    archivedAt: null,
    instanceId: 'instance-1',
    payloadJson: JSON.stringify(payload ?? {}),
    status: 'READ',
    ...rest,
  } as unknown as NotificationRecord;
}

const names = (notification: NotificationRecord): readonly string[] =>
  buildNotificationOptions(notification).map((option) => option.name);

describe('buildNotificationOptions', () => {
  it('offers 同意 on an actionable task that asks for nothing special', () => {
    expect(names(record())).toEqual(['同意', '拒絕', '查看案件', '封存']);
  });

  it('opens the case instead of offering 同意 when the node requires an approval comment', () => {
    const options = names(record({ payload: { requireApprovalComment: true } }));

    expect(options).toContain('開啟案件');
    expect(options).not.toContain('同意');
    expect(options).not.toContain('查看案件');
  });

  it('keeps 拒絕 when the node requires an approval comment', () => {
    expect(
      names(record({ payload: { requireApprovalComment: true } })),
    ).toContain('拒絕');
  });

  it('keeps 同意 when the payload says the flag is false or has other values', () => {
    expect(names(record({ payload: { requireApprovalComment: false } }))).toContain(
      '同意',
    );
    expect(names(record({ payload: { requireApprovalComment: 'true' } }))).toContain(
      '同意',
    );
  });

  it('keeps 同意 on a notification made before the flag existed (no key, or an unreadable payload)', () => {
    expect(names(record({ payload: { allowReject: true } }))).toContain('同意');
    expect(names(record({ payloadJson: 'not json' }))).toContain('同意');
  });

  it('never offers 同意 or 開啟案件 once the task is no longer actionable', () => {
    const options = names(
      record({ actionable: false, payload: { requireApprovalComment: true } }),
    );

    expect(options).not.toContain('同意');
    expect(options).not.toContain('開啟案件');
    expect(options).toContain('查看案件');
  });

  it('still opens the case for a task that fills in fields', () => {
    expect(names(record({ payload: { hasFillableFields: true } }))).toContain(
      '開啟案件',
    );
  });
});
