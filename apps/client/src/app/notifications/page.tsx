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
  FormField,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Table,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { NotificationIcon } from '@mezzanine-ui/icons';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { formatDateTime } from '../_lib/date-time';
import { renderAppNavigation } from '../app-navigation';
import {
  CURRENT_MEMBER_ID,
  listNotifications,
  markNotificationRead,
  NotificationDigestMode,
  NotificationPreferenceRecord,
  NotificationRecord,
  readNotificationPreference,
  updateNotificationPreference,
} from '../instances/_lib/workflow-api';

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

const DIGEST_OPTIONS: readonly DigestOption[] = [
  { id: 'INSTANT', name: '即時通知' },
  { id: 'DAILY', name: '每日摘要' },
];

const DEFAULT_PREFERENCE: NotificationPreferenceRecord = {
  emailDigestMode: 'INSTANT',
  emailEnabled: true,
  inAppEnabled: true,
  memberId: CURRENT_MEMBER_ID,
  quietHoursEnd: null,
  quietHoursStart: null,
  updatedAt: '',
};

export default function NotificationsPage(): ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preference, setPreference] =
    useState<NotificationPreferenceRecord>(DEFAULT_PREFERENCE);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect((): void => {
    void refreshNotifications();
  }, []);

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
                onClick: (): void => router.push(`/instances/${record.instanceId}`),
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
              },
            ]
          : []),
      ],
      variant: 'base-secondary',
      width: 168,
    }),
    [router],
  );
  const selectedDigestOption = useMemo(
    (): DigestOption =>
      DIGEST_OPTIONS.find(
        (option) => option.id === preference.emailDigestMode,
      ) ?? DIGEST_OPTIONS[0],
    [preference.emailDigestMode],
  );

  async function refreshNotifications(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [notificationResult, nextPreference] = await Promise.all([
        listNotifications({
          includeRead: true,
          recipientMemberId: CURRENT_MEMBER_ID,
        }),
        readNotificationPreference(CURRENT_MEMBER_ID),
      ]);

      setRows(notificationResult.notifications.map(readNotificationRow));
      setUnreadCount(notificationResult.unreadCount);
      setPreference(nextPreference);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRead(id: string): Promise<void> {
    await markNotificationRead({
      id,
      readerMemberId: CURRENT_MEMBER_ID,
    });
    await refreshNotifications();
  }

  async function handlePreferenceChange(
    nextPreference: NotificationPreferenceRecord,
  ): Promise<void> {
    setPreference(nextPreference);
    setPreference(
      await updateNotificationPreference({
        emailDigestMode: nextPreference.emailDigestMode,
        emailEnabled: nextPreference.emailEnabled,
        inAppEnabled: nextPreference.inAppEnabled,
        memberId: nextPreference.memberId,
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
              icon={NotificationIcon}
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
          <Section>
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
            />
          </Section>

          <Section>
            <Typography component="h2" variant="h3">
              通知偏好設定
            </Typography>
            <div style={PREFERENCE_GRID_STYLE}>
              <Toggle
                checked={preference.inAppEnabled}
                label="站內通知"
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  void handlePreferenceChange({
                    ...preference,
                    inAppEnabled: event.target.checked,
                  });
                }}
              />
              <Toggle
                checked={preference.emailEnabled}
                label="Email 通知"
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  void handlePreferenceChange({
                    ...preference,
                    emailEnabled: event.target.checked,
                  });
                }}
              />
              <FormField
                density={FormFieldDensity.WIDE}
                fullWidth
                label="Email 頻率"
                layout={FormFieldLayout.STRETCH}
                name="emailDigestMode"
              >
                <Select
                  clearable={false}
                  fullWidth
                  onChange={(option): void => {
                    void handlePreferenceChange({
                      ...preference,
                      emailDigestMode: readDigestMode(option?.id),
                    });
                  }}
                  options={[...DIGEST_OPTIONS]}
                  value={selectedDigestOption}
                />
              </FormField>
            </div>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

const PREFERENCE_GRID_STYLE = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  maxWidth: 720,
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
