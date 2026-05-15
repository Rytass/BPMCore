'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Layout,
  PageHeader,
  RadioGroup,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { RefreshCwIcon } from '@mezzanine-ui/icons';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { formatDateTime } from '../_lib/date-time';
import { useAuth } from '../auth-provider';
import { useNotificationUnread } from '../notification-unread-provider';
import { renderAppNavigation } from '../app-navigation';
import {
  listNotifications,
  markNotificationRead,
  NotificationDigestMode,
  NotificationPreferenceRecord,
  NotificationRecord,
  readNotificationPreference,
  updateNotificationPreference,
} from '../instances/_lib/workflow-api';
import styles from './notifications.module.scss';

type NotificationRow = Readonly<
  Record<string, unknown> &
    NotificationRecord & {
      key: string;
      statusLabel: string;
      typeLabel: string;
    }
>;

interface DigestOption {
  readonly id: NotificationDigestMode;
  readonly name: string;
}

type EnabledSegmentValue = 'ON' | 'OFF';

interface EnabledSegmentOption {
  readonly id: EnabledSegmentValue;
  readonly name: string;
}

const DIGEST_OPTIONS: readonly DigestOption[] = [
  { id: 'INSTANT', name: '即時通知' },
  { id: 'DAILY', name: '每日摘要' },
];

const ENABLED_SEGMENT_OPTIONS: readonly EnabledSegmentOption[] = [
  { id: 'ON', name: '開' },
  { id: 'OFF', name: '關' },
];

const DEFAULT_PREFERENCE: NotificationPreferenceRecord = {
  emailDigestMode: 'INSTANT',
  emailEnabled: true,
  inAppEnabled: true,
  memberId: '',
  quietHoursEnd: null,
  quietHoursStart: null,
  updatedAt: '',
};
const DEFAULT_NOTIFICATION_PAGE_SIZE = 10;
const NOTIFICATION_PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function NotificationsPage(): ReactElement {
  const router = useRouter();
  const { member } = useAuth();
  const { refreshUnreadCount } = useNotificationUnread();
  const currentMemberId = member?.memberId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preference, setPreference] =
    useState<NotificationPreferenceRecord>(DEFAULT_PREFERENCE);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationPageSize, setNotificationPageSize] = useState(
    DEFAULT_NOTIFICATION_PAGE_SIZE,
  );
  const [notificationTotalCount, setNotificationTotalCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect((): void => {
    if (!currentMemberId) {
      return;
    }

    void refreshNotifications();
  }, [currentMemberId, notificationPage, notificationPageSize]);

  const columns = useMemo(
    (): TableColumn<NotificationRow>[] => [
      {
        dataIndex: 'title',
        key: 'title',
        title: '通知',
        width: 200,
      },
      {
        dataIndex: 'body',
        key: 'body',
        title: '內容',
        width: 360,
      },
      {
        dataIndex: 'typeLabel',
        key: 'typeLabel',
        title: '類型',
        width: 140,
      },
      {
        key: 'statusLabel',
        render: (record: NotificationRow): ReactElement => (
          <Typography
            color={record.status === 'READ' ? 'text-neutral' : 'text-success'}
            component="span"
            variant="body"
          >
            {record.statusLabel}
          </Typography>
        ),
        title: '狀態',
        width: 100,
      },
      {
        key: 'createdAt',
        render: (record: NotificationRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.createdAt)}
          </Typography>
        ),
        title: '建立時間',
        width: 220,
      },
    ],
    [],
  );
  const tableActions = useMemo(
    (): TableActions<NotificationRow> => ({
      render: (record): ReturnType<TableActions<NotificationRow>['render']> => [
        ...(record.instanceId
          ? [
              {
                name: '查看案件',
                onClick: (): void => {
                  void handleOpenInstance(record);
                },
                variant: 'base-primary' as const,
              },
            ]
          : []),
        ...(record.status !== 'READ'
          ? [
              {
                name: '標為已讀',
                onClick: (): void => {
                  void handleMarkRead(record.id);
                },
                variant: 'base-secondary' as const,
              },
            ]
          : []),
      ],
      variant: 'base-secondary',
      width: 168,
    }),
    [router],
  );
  async function refreshNotifications(): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [notificationResult, nextPreference] = await Promise.all([
        listNotifications({
          includeRead: true,
          page: notificationPage,
          pageSize: notificationPageSize,
          recipientMemberId: currentMemberId,
        }),
        readNotificationPreference(currentMemberId),
      ]);

      setRows(notificationResult.notifications.map(readNotificationRow));
      setNotificationTotalCount(notificationResult.totalCount);
      setUnreadCount(notificationResult.unreadCount);
      setPreference(nextPreference);
      await refreshUnreadCount();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRead(id: string): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    await markNotificationRead({
      id,
      readerMemberId: currentMemberId,
    });
    await refreshNotifications();
    await refreshUnreadCount();
  }

  async function handleOpenInstance(record: NotificationRow): Promise<void> {
    if (!record.instanceId) {
      return;
    }

    setError(null);

    try {
      if (record.status !== 'READ') {
        if (!currentMemberId) {
          return;
        }

        await markNotificationRead({
          id: record.id,
          readerMemberId: currentMemberId,
        });
        await refreshUnreadCount();
      }

      router.push(`/instances/${record.instanceId}`);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    }
  }

  async function handlePreferenceChange(
    nextPreference: NotificationPreferenceRecord,
  ): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    setPreference(nextPreference);
    setPreference(
      await updateNotificationPreference({
        emailDigestMode: nextPreference.emailDigestMode,
        emailEnabled: nextPreference.emailEnabled,
        inAppEnabled: nextPreference.inAppEnabled,
        memberId: currentMemberId ?? nextPreference.memberId,
        quietHoursEnd: nextPreference.quietHoursEnd,
        quietHoursStart: nextPreference.quietHoursStart,
      }),
    );
  }

  return (
    <Layout>
      {renderAppNavigation('/notifications')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description={`目前有 ${unreadCount} 則未讀通知。`}
            title="通知中心"
          >
            <Button
              icon={RefreshCwIcon}
              iconType="leading"
              onClick={(): void => {
                void refreshNotifications();
              }}
              variant="base-secondary"
            >
              重新整理
            </Button>
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section
            filterArea={
              <FilterArea
                className={styles.preferenceFilter}
                isDirty={false}
              >
                <FilterLine>
                  <Filter minWidth={160} span={1}>
                    <FormField
                      layout={FormFieldLayout.VERTICAL}
                      name="inAppEnabled"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          站內通知
                        </span>
                        <RadioGroup
                          name="inAppEnabled"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              inAppEnabled: readEnabledSegmentValue(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...ENABLED_SEGMENT_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={readEnabledSegmentValueId(
                            preference.inAppEnabled,
                          )}
                        />
                      </div>
                    </FormField>
                  </Filter>
                  <Filter minWidth={180} span={1}>
                    <FormField
                      layout={FormFieldLayout.VERTICAL}
                      name="emailEnabled"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          Email 通知
                        </span>
                        <RadioGroup
                          name="emailEnabled"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              emailEnabled: readEnabledSegmentValue(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...ENABLED_SEGMENT_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={readEnabledSegmentValueId(
                            preference.emailEnabled,
                          )}
                        />
                      </div>
                    </FormField>
                  </Filter>
                  <Filter minWidth={280} span={2}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="emailDigestMode"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          Email 頻率
                        </span>
                        <RadioGroup
                          name="emailDigestMode"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              emailDigestMode: readDigestMode(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...DIGEST_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={preference.emailDigestMode}
                        />
                      </div>
                    </FormField>
                  </Filter>
                </FilterLine>
              </FilterArea>
            }
          >
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            <Table
              actions={tableActions}
              columns={columns}
              dataSource={rows}
              fullWidth
              loading={loading}
              pagination={{
                current: notificationPage,
                onChange: (page): void => {
                  setNotificationPage(page);
                },
                onChangePageSize: (pageSize): void => {
                  setNotificationPage(1);
                  setNotificationPageSize(pageSize);
                },
                pageSize: notificationPageSize,
                pageSizeLabel: '每頁筆數',
                pageSizeOptions: NOTIFICATION_PAGE_SIZE_OPTIONS,
                renderResultSummary: (from, to, total): string =>
                  `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                showPageSizeOptions: true,
                total: notificationTotalCount,
              }}
            />
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

const FILTER_FIELD_STYLE = {
  minWidth: 0,
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

function readNotificationRow(
  notification: NotificationRecord,
): NotificationRow {
  return {
    ...notification,
    key: notification.id,
    statusLabel: readNotificationStatusLabel(notification.status),
    typeLabel: readNotificationTypeLabel(notification.type),
  };
}

function readNotificationStatusLabel(
  status: NotificationRecord['status'],
): string {
  if (status === 'READ') {
    return '已讀';
  }

  if (status === 'SENT') {
    return '未讀';
  }

  if (status === 'FAILED') {
    return '發送失敗';
  }

  return '待發送';
}

function readNotificationTypeLabel(type: NotificationRecord['type']): string {
  if (type === 'TASK_ASSIGNED') {
    return '任務指派';
  }

  if (type === 'TASK_TRANSFERRED') {
    return '任務轉派';
  }

  if (type === 'SLA_WARNING') {
    return 'SLA 預警';
  }

  if (type === 'SLA_OVERDUE') {
    return 'SLA 逾時';
  }

  return '案件完成';
}

function readDigestMode(value: unknown): NotificationDigestMode {
  return value === 'DAILY' ? 'DAILY' : 'INSTANT';
}

function readEnabledSegmentValue(value: unknown): boolean {
  return value !== 'OFF';
}

function readEnabledSegmentValueId(enabled: boolean): EnabledSegmentValue {
  return enabled ? 'ON' : 'OFF';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
