import type { DropdownOption } from '@mezzanine-ui/core/dropdown/dropdown';
import type { NotificationRecord } from '@rytass/bpm-core-client/workflow';

export type NotificationAction =
  'approve' | 'archive' | 'reject' | 'unarchive' | 'view' | 'read';

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
  const payload = readNotificationPayload(record);
  const canReject = readNotificationAllowReject(record, payload) !== false;
  const opensToFill =
    record.actionable &&
    Boolean(record.instanceId) &&
    (readPayloadFlag(payload, 'hasFillableFields') ||
      readPayloadFlag(payload, 'requireApprovalComment'));

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

/**
 * The notification's `payloadJson`, parsed once. `null` when it is not a JSON
 * object; every reader below takes this one result.
 */
function readNotificationPayload(
  record: NotificationRecord,
): Readonly<Record<string, unknown>> | null {
  try {
    const payload: unknown = JSON.parse(record.payloadJson);

    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readNotificationAllowReject(
  record: NotificationRecord,
  payload: Readonly<Record<string, unknown>> | null,
): boolean | null {
  if (payload && typeof payload.allowReject === 'boolean') {
    return payload.allowReject;
  }

  return record.allowReject;
}

/**
 * `true` only when the payload sets the flag to `true`. A missing key, a
 * `false`, or an unparsable payload all read as `false`.
 *
 * `TASK_ASSIGNED` / `TASK_TRANSFERRED` payloads carry `hasFillableFields`, and
 * `requireApprovalComment: true` only when the node asks for a comment on
 * approval. Notifications created before those keys existed read as `false`.
 */
function readPayloadFlag(
  payload: Readonly<Record<string, unknown>> | null,
  key: string,
): boolean {
  return payload !== null && payload[key] === true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
