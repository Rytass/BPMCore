'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import Drawer from '@mezzanine-ui/react/Drawer';
import Modal from '@mezzanine-ui/react/Modal';
import NotificationCenter from '@mezzanine-ui/react/NotificationCenter';
import Textarea from '@mezzanine-ui/react/Textarea';
import { Typography } from '@mezzanine-ui/react';
import type { NotificationSeverity } from '@mezzanine-ui/core/notification-center';
import type { DropdownOption } from '@mezzanine-ui/core/dropdown/dropdown';
import {
  archiveNotifications,
  decideTask,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unarchiveNotifications,
  type NotificationRecord,
  type NotificationResolution,
  type NotificationType,
} from '@rytass/bpm-core-client/workflow';
import { useAuth } from '../lib/auth-provider';
import { useNotificationDrawer } from '../lib/notification-drawer-provider';
import { useNotificationUnread } from '../lib/notification-unread-provider';
import { useRouterAdapter } from '../lib/router-adapter';
import { useBPMRoutes } from '../lib/routes-config';
import { BPMFormField } from './bpm-form-field';

type FilterValue = 'all' | 'read' | 'unread';

type TimeGroup = 'today' | 'yesterday' | 'past7Days' | 'earlier';

const TIME_GROUP_ORDER: readonly TimeGroup[] = [
  'today',
  'yesterday',
  'past7Days',
  'earlier',
];

const TIME_GROUP_LABEL: Readonly<Record<TimeGroup, string>> = {
  earlier: '更早',
  past7Days: '過去七天',
  today: '今天',
  yesterday: '昨天',
};

const PAGE_SIZE = 50;

/** Identifiers for the per-notification `...` dropdown menu entries. */
type NotificationAction =
  | 'approve'
  | 'archive'
  | 'reject'
  | 'unarchive'
  | 'view'
  | 'read';

/** Identifier for the filter-bar dropdown entry toggling the archived view. */
const TOGGLE_ARCHIVED_OPTION_ID = 'toggleArchived';

/**
 * Build the `...` dropdown options for one notification. Approve / reject are
 * offered only while the server still reports the notification as `actionable`
 * (an unresolved task assignment) — once the task is decided / cancelled the
 * backend flips `actionable` to false, so a stale "同意" can never appear.
 * "查看案件" needs an `instanceId`; "標為已讀" only shows while unread.
 * Archiving is independent of read state, so the entry flips between
 * "封存" / "取消封存" for every notification.
 */
function buildNotificationOptions(
  record: NotificationRecord,
): readonly DropdownOption[] {
  const canReject = readNotificationAllowReject(record) !== false;

  return [
    ...(record.actionable
      ? ([
          { id: 'approve', name: '同意' },
          ...(canReject ? [{ id: 'reject', name: '拒絕' }] : []),
        ] satisfies DropdownOption[])
      : []),
    ...(record.instanceId
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
 * Title shown for a resolved task-assignment notification, replacing the
 * stored "新的待簽任務" wording so a decided card no longer reads as pending.
 * The stored `body` is kept as historical context (which case / node).
 */
const RESOLVED_TITLE: Readonly<Record<NotificationResolution, string>> = {
  APPROVED: '簽核任務已同意',
  REJECTED: '簽核任務已拒絕',
  RETURNED: '簽核任務已退回',
  SUPERSEDED: '簽核任務已結束',
  TRANSFERRED: '簽核任務已轉派',
};

function resolveDisplayTitle(record: NotificationRecord): string {
  return record.resolution ? RESOLVED_TITLE[record.resolution] : record.title;
}

/**
 * Severity (icon colour) for a notification. Once resolved, it reflects the
 * outcome — green for approved, red for rejected, neutral otherwise — instead
 * of the original by-type colour.
 */
function resolveSeverity(record: NotificationRecord): NotificationSeverity {
  if (record.resolution === 'APPROVED') return 'success';
  if (record.resolution === 'REJECTED') return 'error';
  if (record.resolution) return 'info';
  return toSeverity(record.type);
}

/**
 * Right-side notification drawer mounted at the root by `<Providers>`.
 * Opens / closes via `useNotificationDrawer()`, polls
 * `listNotifications()` for the current member, supports filter
 * (`all` / `read` / `unread`), per-row mark-read, per-row archive / unarchive,
 * bulk mark-all-read, and load-more pagination. Archived notifications are
 * hidden until the filter-bar menu turns "顯示已封存" on. Clicking a row with an
 * `instanceId` navigates to `/instances/<id>` via the host's router adapter.
 */
export function NotificationDrawer(): ReactElement | null {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const { member } = useAuth();
  const { close, isOpen } = useNotificationDrawer();
  const { refreshUnreadCount } = useNotificationUnread();
  const currentMemberId = member?.memberId ?? null;
  const [rows, setRows] = useState<readonly NotificationRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [approveTarget, setApproveTarget] = useState<NotificationRecord | null>(
    null,
  );
  const [approveComment, setApproveComment] = useState('');
  const [rejectTarget, setRejectTarget] = useState<NotificationRecord | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState('');
  const [deciding, setDeciding] = useState(false);

  const trimmedApproveComment = approveComment.trim();
  const trimmedRejectReason = rejectReason.trim();

  const loadPage = useCallback(
    async (nextPage: number, append: boolean): Promise<boolean> => {
      if (!currentMemberId) return false;
      setLoading(true);
      setError(null);
      try {
        const result = await listNotifications({
          includeArchived,
          includeRead: true,
          page: nextPage,
          pageSize: PAGE_SIZE,
          recipientMemberId: currentMemberId,
        });
        setRows((current): readonly NotificationRecord[] =>
          append ? [...current, ...result.notifications] : result.notifications,
        );
        setTotalCount(result.totalCount);
        setPage(nextPage);
        await refreshUnreadCount();
        return true;
      } catch (e: unknown) {
        setError(readErrorMessage(e));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [currentMemberId, includeArchived, refreshUnreadCount],
  );

  useEffect((): void => {
    if (!isOpen || !currentMemberId) return;
    setError(null);
    setNotice(null);
    void loadPage(1, false);
  }, [isOpen, currentMemberId, loadPage]);

  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const next = event.target.value;
      if (next === 'all' || next === 'read' || next === 'unread') setFilter(next);
    },
    [],
  );

  const handleMarkAllRead = useCallback(async (): Promise<void> => {
    if (!currentMemberId || bulkLoading) return;
    setBulkLoading(true);
    setError(null);
    try {
      await markAllNotificationsRead({ recipientMemberId: currentMemberId });
      await loadPage(1, false);
    } catch (e: unknown) {
      setError(readErrorMessage(e));
    } finally {
      setBulkLoading(false);
    }
  }, [bulkLoading, currentMemberId, loadPage]);

  const handleLoadMore = useCallback((): void => {
    if (loading) return;
    void loadPage(page + 1, true);
  }, [loading, loadPage, page]);

  const handleMarkRead = useCallback(
    async (id: string): Promise<void> => {
      if (!currentMemberId) return;
      try {
        await markNotificationRead({ id, readerMemberId: currentMemberId });
        await loadPage(1, false);
      } catch (e: unknown) {
        setError(readErrorMessage(e));
      }
    },
    [currentMemberId, loadPage],
  );

  const handleArchive = useCallback(
    async (record: NotificationRecord): Promise<void> => {
      if (!currentMemberId) return;
      setError(null);
      setNotice(null);
      try {
        // Name the notification the way the row does — `title` is the raw
        // stored title, which can differ from the rendered one.
        const label = resolveDisplayTitle(record);

        if (record.archivedAt) {
          await unarchiveNotifications({ ids: [record.id] });
          setNotice(`已將「${label}」移出封存。`);
        } else {
          await archiveNotifications({ ids: [record.id] });
          setNotice(`已封存「${label}」。`);
        }
        await loadPage(1, false);
      } catch (e: unknown) {
        setError(readErrorMessage(e));
      }
    },
    [currentMemberId, loadPage],
  );

  const handleFilterAreaSelect = useCallback((option: DropdownOption): void => {
    if (option.id !== TOGGLE_ARCHIVED_OPTION_ID) return;
    setNotice(null);
    setIncludeArchived((current): boolean => !current);
  }, []);

  const handleOpenInstance = useCallback(
    async (record: NotificationRecord): Promise<void> => {
      if (!record.instanceId || !currentMemberId) return;
      try {
        if (record.status !== 'READ') {
          await markNotificationRead({
            id: record.id,
            readerMemberId: currentMemberId,
          });
          await refreshUnreadCount();
        }
        close();
        router.push(routes.caseDetail(record.instanceId));
      } catch (e: unknown) {
        setError(readErrorMessage(e));
      }
    },
    [close, currentMemberId, refreshUnreadCount, router, routes],
  );

  const openApproveModal = useCallback((record: NotificationRecord): void => {
    setError(null);
    setApproveTarget(record);
    setApproveComment('');
  }, []);

  const closeApproveModal = useCallback((): void => {
    if (deciding) return;
    setApproveTarget(null);
    setApproveComment('');
  }, [deciding]);

  const handleApproveConfirm = useCallback(async (): Promise<void> => {
    const target = approveTarget;
    if (!target?.taskId || !currentMemberId || deciding) return;
    setDeciding(true);
    setError(null);
    setNotice(null);
    try {
      await decideTask({
        action: 'APPROVED',
        comment: trimmedApproveComment || null,
        decidedByMemberId: currentMemberId,
        taskId: target.taskId,
      });
      const refreshed = await loadPage(1, false);
      if (!refreshed) return;
      setApproveTarget(null);
      setApproveComment('');
      setNotice(`已同意「${target.title}」。`);
    } catch (e: unknown) {
      setError(readErrorMessage(e));
    } finally {
      setDeciding(false);
    }
  }, [
    approveTarget,
    currentMemberId,
    deciding,
    loadPage,
    trimmedApproveComment,
  ]);

  const openRejectModal = useCallback((record: NotificationRecord): void => {
    setRejectTarget(record);
    setRejectReason('');
  }, []);

  const closeRejectModal = useCallback((): void => {
    setRejectTarget(null);
    setRejectReason('');
  }, []);

  const handleRejectConfirm = useCallback(async (): Promise<void> => {
    const target = rejectTarget;
    if (!target?.taskId || !currentMemberId || !trimmedRejectReason || deciding)
      return;
    setDeciding(true);
    setError(null);
    setNotice(null);
    try {
      await decideTask({
        action: 'REJECTED',
        comment: trimmedRejectReason,
        decidedByMemberId: currentMemberId,
        taskId: target.taskId,
      });
      setRejectTarget(null);
      setRejectReason('');
      setNotice(`已拒絕「${target.title}」。`);
      await loadPage(1, false);
    } catch (e: unknown) {
      setError(readErrorMessage(e));
    } finally {
      setDeciding(false);
    }
  }, [currentMemberId, deciding, loadPage, rejectTarget, trimmedRejectReason]);

  const handleBadgeSelect = useCallback(
    (record: NotificationRecord, option: DropdownOption): void => {
      const action = option.id as NotificationAction;
      if (action === 'approve') openApproveModal(record);
      else if (action === 'reject') openRejectModal(record);
      else if (action === 'view') void handleOpenInstance(record);
      else if (action === 'read') void handleMarkRead(record.id);
      else if (action === 'archive' || action === 'unarchive')
        void handleArchive(record);
    },
    [
      handleArchive,
      handleMarkRead,
      handleOpenInstance,
      openApproveModal,
      openRejectModal,
    ],
  );

  /**
   * Whether an event that reached the card wrapper actually happened inside the
   * card, and not on one of its action controls.
   *
   * Two escape hatches are needed. The `...` menu button (and its `<svg>` icon —
   * hence the `Element` check, SVG nodes are not HTMLElements) sits inside the
   * card and must open the dropdown rather than navigate. The dropdown itself
   * renders into a portal, and React replays events along the component tree
   * rather than the DOM tree, so picking "封存" also reaches this handler even
   * though the `<li role="option">` lives outside the card's DOM — and it is not
   * a `<button>`, so the first guard alone misses it.
   */
  const isCardActivation = useCallback(
    (target: EventTarget | null, card: HTMLDivElement): boolean => {
      if (!(target instanceof Node) || !card.contains(target)) return false;

      return !(target instanceof Element && target.closest('button'));
    },
    [],
  );

  const handleCardActivate = useCallback(
    (record: NotificationRecord, event: ReactMouseEvent<HTMLDivElement>): void => {
      if (!isCardActivation(event.target, event.currentTarget)) return;
      void handleOpenInstance(record);
    },
    [handleOpenInstance, isCardActivation],
  );

  const handleCardKeyDown = useCallback(
    (
      record: NotificationRecord,
      event: ReactKeyboardEvent<HTMLDivElement>,
    ): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!isCardActivation(event.target, event.currentTarget)) return;
      event.preventDefault();
      void handleOpenInstance(record);
    },
    [handleOpenInstance, isCardActivation],
  );

  const filteredRows = useMemo(
    (): readonly NotificationRecord[] =>
      rows.filter((row): boolean => {
        if (filter === 'all') return true;
        if (filter === 'read') return row.status === 'READ';
        return row.status !== 'READ';
      }),
    [filter, rows],
  );

  const groupedRows = useMemo(
    (): ReadonlyArray<readonly [TimeGroup, readonly NotificationRecord[]]> => {
    const now = new Date();
    const buckets = TIME_GROUP_ORDER.reduce<
      Record<TimeGroup, NotificationRecord[]>
    >(
      (accumulator, group) => {
        accumulator[group] = [];
        return accumulator;
      },
      { earlier: [], past7Days: [], today: [], yesterday: [] },
    );
    filteredRows.forEach((row): void => {
      buckets[resolveTimeGroup(row.createdAt, now)].push(row);
    });
    return TIME_GROUP_ORDER.map(
      (group) => [group, buckets[group]] as const,
    ).filter(([, items]) => items.length > 0);
    },
    [filteredRows],
  );

  const hasMore = rows.length < totalCount;

  if (!currentMemberId) return null;

  return (
    <>
      <Drawer
        bottomGhostActionDisabled={bulkLoading || loading}
        bottomGhostActionLoading={bulkLoading}
        bottomGhostActionText="全部標為已讀"
        bottomOnGhostActionClick={(): void => {
          void handleMarkAllRead();
        }}
        bottomOnPrimaryActionClick={(): void => {
          handleLoadMore();
        }}
        bottomPrimaryActionDisabled={!hasMore || loading}
        bottomPrimaryActionLoading={loading && hasMore}
        bottomPrimaryActionText={hasMore ? '載入更多' : '已顯示全部'}
        contentKey={`${filter}:${includeArchived}:${rows.length}`}
        filterAreaAllRadioLabel="全部"
        filterAreaOnRadioChange={handleFilterChange}
        filterAreaOnSelect={handleFilterAreaSelect}
        filterAreaOptions={[
          {
            id: TOGGLE_ARCHIVED_OPTION_ID,
            name: includeArchived ? '隱藏已封存' : '顯示已封存',
          },
        ]}
        filterAreaReadRadioLabel="已讀"
        filterAreaShow
        filterAreaUnreadRadioLabel="未讀"
        filterAreaValue={filter}
        headerTitle="通知中心"
        isBottomDisplay
        isHeaderDisplay
        onClose={close}
        open={isOpen}
        size="medium"
      >
        <div role="list">
          {error ? (
            <p
              role="alert"
              style={{
                color: 'var(--mzn-color-text-error, #d92d20)',
                padding: '12px 16px',
              }}
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              style={{
                color: 'var(--mzn-color-text-success, #079455)',
                padding: '12px 16px',
              }}
            >
              {notice}
            </p>
          ) : null}
          {groupedRows.length === 0 ? (
            <p
              style={{
                color: 'var(--mzn-color-text-secondary, #6b7280)',
                padding: '24px 16px',
                textAlign: 'center',
              }}
            >
              {loading ? '載入中…' : '目前沒有通知'}
            </p>
          ) : null}
          {groupedRows.map(([group, items]) => (
            <Fragment key={group}>
              {items.map((record, itemIndex) => {
                const openable = record.instanceId !== null;

                return (
                  <div
                    key={record.id}
                    onClick={
                      openable
                        ? (event: ReactMouseEvent<HTMLDivElement>): void => {
                            handleCardActivate(record, event);
                          }
                        : undefined
                    }
                    onKeyDown={
                      openable
                        ? (event: ReactKeyboardEvent<HTMLDivElement>): void => {
                            handleCardKeyDown(record, event);
                          }
                        : undefined
                    }
                    role={openable ? 'button' : undefined}
                    style={openable ? { cursor: 'pointer' } : undefined}
                    tabIndex={openable ? 0 : undefined}
                  >
                    <NotificationCenter
                      appendTips={record.archivedAt ? '已封存' : undefined}
                      description={record.body}
                      onBadgeSelect={(option: DropdownOption): void => {
                        handleBadgeSelect(record, option);
                      }}
                      options={[...buildNotificationOptions(record)]}
                      prependTips={
                        itemIndex === 0 ? TIME_GROUP_LABEL[group] : undefined
                      }
                      reference={record.id}
                      severity={resolveSeverity(record)}
                      showBadge={record.status !== 'READ'}
                      timeStamp={record.createdAt}
                      title={resolveDisplayTitle(record)}
                      type="drawer"
                    />
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </Drawer>
      <Modal
        cancelText="取消"
        confirmText="送出同意"
        loading={deciding}
        modalType="standard"
        onCancel={closeApproveModal}
        onClose={closeApproveModal}
        onConfirm={(): void => {
          void handleApproveConfirm();
        }}
        open={approveTarget !== null}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText="可以留下同意說明，內容會記錄在簽核歷程；不填也可以直接送出。"
        title="簽核意見"
      >
        {error ? (
          <Typography color="text-error" role="alert" variant="body">
            {error}
          </Typography>
        ) : null}
        <BPMFormField label="簽核意見" name="notificationApproveComment">
          <Textarea
            autoFocus
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
              setApproveComment(event.target.value);
            }}
            placeholder="選填，例如補充核准條件或提醒事項"
            rows={4}
            value={approveComment}
          />
        </BPMFormField>
      </Modal>
      <Modal
        cancelText="取消"
        confirmButtonProps={{
          disabled: !trimmedRejectReason,
          variant: 'destructive-primary',
        }}
        confirmText="送出拒絕"
        loading={deciding}
        modalStatusType="error"
        modalType="standard"
        onCancel={closeRejectModal}
        onClose={closeRejectModal}
        onConfirm={(): void => {
          void handleRejectConfirm();
        }}
        open={rejectTarget !== null}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText="拒絕案件時必須留下原因，供發起人與後續追蹤查看。"
        title="拒絕原因"
      >
        <Textarea
          autoFocus
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
            setRejectReason(event.target.value);
          }}
          placeholder="請輸入拒絕原因"
          rows={4}
          value={rejectReason}
        />
      </Modal>
    </>
  );
}

function toSeverity(type: NotificationType): NotificationSeverity {
  if (type === 'SLA_OVERDUE') return 'error';
  if (type === 'SLA_WARNING') return 'warning';
  if (type === 'INSTANCE_COMPLETED') return 'success';
  return 'info';
}

function resolveTimeGroup(value: string, now: Date): TimeGroup {
  const notificationDate = new Date(value);
  if (Number.isNaN(notificationDate.getTime())) return 'earlier';
  const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const notificationStartOfDay = new Date(
    notificationDate.getFullYear(),
    notificationDate.getMonth(),
    notificationDate.getDate(),
  );
  if (notificationStartOfDay.getTime() === nowStartOfDay.getTime()) return 'today';
  const yesterdayStartOfDay = new Date(nowStartOfDay);
  yesterdayStartOfDay.setDate(yesterdayStartOfDay.getDate() - 1);
  if (notificationStartOfDay.getTime() === yesterdayStartOfDay.getTime())
    return 'yesterday';
  const diffInDays =
    (now.getTime() - notificationDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffInDays <= 7) return 'past7Days';
  return 'earlier';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
