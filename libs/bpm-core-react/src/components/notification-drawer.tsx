'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import Drawer from '@mezzanine-ui/react/Drawer';
import NotificationCenter from '@mezzanine-ui/react/NotificationCenter';
import type { NotificationSeverity } from '@mezzanine-ui/core/notification-center';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
  type NotificationType,
} from '@rytass/bpm-core-client/workflow';
import { useAuth } from '../lib/auth-provider';
import { useNotificationDrawer } from '../lib/notification-drawer-provider';
import { useNotificationUnread } from '../lib/notification-unread-provider';
import { useRouterAdapter } from '../lib/router-adapter';
import { useBPMRoutes } from '../lib/routes-config';

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

/**
 * Right-side notification drawer mounted at the root by `<Providers>`.
 * Opens / closes via `useNotificationDrawer()`, polls
 * `listNotifications()` for the current member, supports filter
 * (`all` / `read` / `unread`), per-row mark-read, bulk mark-all-read, and
 * load-more pagination. Clicking a row with an `instanceId` navigates to
 * `/instances/<id>` via the host's router adapter.
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
  const [filter, setFilter] = useState<FilterValue>('all');

  const loadPage = useCallback(
    async (nextPage: number, append: boolean): Promise<void> => {
      if (!currentMemberId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await listNotifications({
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
      } catch (e: unknown) {
        setError(readErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [currentMemberId, refreshUnreadCount],
  );

  useEffect((): void => {
    if (!isOpen || !currentMemberId) return;
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
      contentKey={`${filter}:${rows.length}`}
      filterAreaAllRadioLabel="全部"
      filterAreaOnRadioChange={handleFilterChange}
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
        {groupedRows.map(([group, items], groupIndex) => (
          <Fragment key={group}>
            {items.map((record, itemIndex) => (
              <NotificationCenter
                appendTips={
                  groupIndex === groupedRows.length - 1 &&
                  itemIndex === items.length - 1 &&
                  !hasMore
                    ? '已顯示全部通知'
                    : undefined
                }
                cancelButtonText={
                  record.status !== 'READ' ? '標為已讀' : undefined
                }
                description={record.body}
                key={record.id}
                onCancel={
                  record.status !== 'READ'
                    ? (): void => {
                        void handleMarkRead(record.id);
                      }
                    : undefined
                }
                onConfirm={
                  record.instanceId
                    ? (): void => {
                        void handleOpenInstance(record);
                      }
                    : undefined
                }
                confirmButtonText={record.instanceId ? '查看案件' : undefined}
                prependTips={itemIndex === 0 ? TIME_GROUP_LABEL[group] : undefined}
                reference={record.id}
                severity={toSeverity(record.type)}
                showBadge={record.status !== 'READ'}
                timeStamp={record.createdAt}
                title={record.title}
                type="drawer"
              />
            ))}
          </Fragment>
        ))}
      </div>
    </Drawer>
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
