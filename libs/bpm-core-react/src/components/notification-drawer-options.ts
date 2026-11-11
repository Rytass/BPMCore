import type { DropdownOption } from '@mezzanine-ui/core/dropdown/dropdown';
import type { NotificationRecord } from '@rytass/bpm-core-client/workflow';

export type NotificationAction =
  | 'approve'
  | 'archive'
  | 'reject'
  | 'unarchive'
  | 'view'
  | 'read';

/**
 * Build the `...` dropdown options for one notification. Approve / reject are
 * offered only while the server still reports the notification as `actionable`
 * (an unresolved task assignment) — once the task is decided / cancelled the
 * backend flips `actionable` to false, so a stale "同意" can never appear.
 * A task that fills in form fields (`hasFillableFields`) cannot be approved
 * from here — the fill has to be entered on the case page — so its "同意"
 * becomes "開啟案件". So does a task at a node that requires an approval
 * comment (`requireApprovalComment`): the drawer has no comment dialog of its
 * own for that, the case page does.
 * "查看案件" needs an `instanceId`; "標為已讀" only shows while unread.
 * Archiving is independent of read state, so the entry flips between
 * "封存" / "取消封存" for every notification.
 */
export function buildNotificationOptions(
  record: NotificationRecord,
): readonly DropdownOption[] {
  const canReject = readNotificationAllowReject(record) !== false;
  const opensToFill =
    record.actionable &&
    Boolean(record.instanceId) &&
    (readNotificationHasFillableFields(record) ||
      readNotificationRequireApprovalComment(record));

  return [
    ...(record.actionable
      ? ([
          opensToFill
            ? { id: 'view', name: '開啟案件' }
            : { id: 'approve', name: '同意' },
          ...(canReject ? [{ id: 'reject', name: '拒絕' }] : []),
        ] satisfies DropdownOption[])
      : []),
    ...(record.instanceId && !opensToFill
      ? ([{ id: 'view', name: '查看案件' }] satisfies DropdownOption[])
      : []),
    ...(record.status !== 'READ'
      ? ([{ id: 'read', name: '標為已讀' }] satisfies DropdownOption[])
      : []),
    record.archivedAt
      ? { id: 'unarchive', name: '取消封存' }
      : { id: 'archive', name: '封存' },
  ];
}

function readNotificationAllowReject(
  record: NotificationRecord,
): boolean | null {
  try {
    const payload: unknown = JSON.parse(record.payloadJson);

    if (isRecord(payload) && typeof payload.allowReject === 'boolean') {
      return payload.allowReject;
    }

    return record.allowReject;
  } catch {
    return record.allowReject;
  }
}

/**
 * `TASK_ASSIGNED` / `TASK_TRANSFERRED` payloads carry `hasFillableFields`;
 * older notifications do not, which reads as `false`.
 */
function readNotificationHasFillableFields(
  record: NotificationRecord,
): boolean {
  try {
    const payload: unknown = JSON.parse(record.payloadJson);

    return isRecord(payload) && payload.hasFillableFields === true;
  } catch {
    return false;
  }
}

/**
 * `TASK_ASSIGNED` / `TASK_TRANSFERRED` payloads carry
 * `requireApprovalComment: true` only when the node asks for a comment on
 * approval; a payload without the key, and every notification created before
 * the key existed, reads as `false`.
 */
function readNotificationRequireApprovalComment(
  record: NotificationRecord,
): boolean {
  try {
    const payload: unknown = JSON.parse(record.payloadJson);

    return isRecord(payload) && payload.requireApprovalComment === true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
