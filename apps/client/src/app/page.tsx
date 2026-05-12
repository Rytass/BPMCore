'use client';

import type { KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BaseCard,
  Button,
  CardGroup,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import { renderAppNavigation } from './app-navigation';
import {
  CURRENT_MEMBER_ID,
  listApprovalInstances,
  listInboxTasks,
  listNotifications,
} from './instances/_lib/workflow-api';
import styles from './page.module.scss';

interface Metric {
  readonly caption: string;
  readonly href: string;
  readonly label: string;
  readonly value: string;
}

interface DashboardSummary {
  readonly pendingTaskCount: number;
  readonly runningInitiatedCount: number;
  readonly runningInitiatedInstanceId: string | null;
  readonly unreadNotificationCount: number;
}

const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  pendingTaskCount: 0,
  runningInitiatedCount: 0,
  runningInitiatedInstanceId: null,
  unreadNotificationCount: 0,
};

export default function Page(): ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary>(
    EMPTY_DASHBOARD_SUMMARY,
  );

  const refreshSummary = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [pendingTasks, notificationResult, instances] = await Promise.all([
        listInboxTasks(CURRENT_MEMBER_ID),
        listNotifications({
          includeRead: true,
          page: 1,
          pageSize: 1,
          recipientMemberId: CURRENT_MEMBER_ID,
        }),
        listApprovalInstances(),
      ]);

      const runningInitiatedInstances = instances.filter(
        (instance) =>
          instance.initiatorMemberId === CURRENT_MEMBER_ID &&
          instance.state === 'RUNNING',
      );

      setSummary({
        pendingTaskCount: pendingTasks.length,
        runningInitiatedCount: runningInitiatedInstances.length,
        runningInitiatedInstanceId: runningInitiatedInstances[0]?.id ?? null,
        unreadNotificationCount: notificationResult.unreadCount,
      });
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect((): void => {
    void refreshSummary();
  }, [refreshSummary]);

  const metrics = useMemo(
    (): readonly Metric[] => [
      {
        caption: '目前需要你處理的任務',
        href: '/inbox',
        label: '待處理簽核',
        value: readMetricValue(summary.pendingTaskCount, loading),
      },
      {
        caption: '尚未讀取的站內通知',
        href: '/notifications',
        label: '未讀通知',
        value: readMetricValue(summary.unreadNotificationCount, loading),
      },
      {
        caption: '由你發起且仍在流程中的案件',
        href: summary.runningInitiatedInstanceId
          ? `/instances/${summary.runningInitiatedInstanceId}`
          : '/instances/new',
        label: '我發起進行中',
        value: readMetricValue(summary.runningInitiatedCount, loading),
      },
    ],
    [loading, summary],
  );

  return (
    <Layout>
      {renderAppNavigation('/')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="查看待處理簽核、近期通知與你發起的案件進度。"
            title="工作台"
          >
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={(): void => router.push('/instances/new')}
              variant="base-primary"
            >
              發起簽核
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
            <CardGroup>
              {metrics.map((metric) => (
                <BaseCard
                  aria-label={`前往${metric.label}`}
                  className={styles.metricCard}
                  description={metric.value}
                  key={metric.label}
                  onClick={(): void => router.push(metric.href)}
                  onKeyDown={(event: KeyboardEvent<HTMLElement>): void => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      router.push(metric.href);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  title={metric.label}
                >
                  <Typography variant="caption" color="text-neutral">
                    {metric.caption}
                  </Typography>
                </BaseCard>
              ))}
            </CardGroup>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

function readMetricValue(value: number, loading: boolean): string {
  return loading ? '-' : String(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '讀取工作台摘要失敗。';
}
