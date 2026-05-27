'use client';

import type { KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  readWorkflowDashboardSummary,
  type WorkflowDashboardSummaryRecord,
} from '@rytass/bpm-core-client/workflow';
import { useAuth } from '../lib/auth-provider';
import { useRouterAdapter } from '../lib/router-adapter';
import { AppNavigation } from './app-navigation';
import styles from './dashboard-page.module.scss';

export interface DashboardPageProps {
  readonly activeHref: string;
}

interface Metric {
  readonly caption: string;
  readonly href: string;
  readonly label: string;
  readonly value: string;
}

const EMPTY_DASHBOARD_SUMMARY: WorkflowDashboardSummaryRecord = {
  activeInstanceCount: 0,
  completedInstanceCount: 0,
  overdueTaskCount: 0,
  pendingTaskCount: 0,
  rejectedInstanceCount: 0,
  totalInstanceCount: 0,
  unreadNotificationCount: 0,
};

/**
 * Operator dashboard — shows pending/unread/active counts for the
 * currently-authenticated member. Reads {@link readWorkflowDashboardSummary}
 * and renders five metric tiles that navigate via {@link useRouterAdapter}.
 */
export function DashboardPage({ activeHref }: DashboardPageProps): ReactElement {
  const router = useRouterAdapter();
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<WorkflowDashboardSummaryRecord>(
    EMPTY_DASHBOARD_SUMMARY,
  );

  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!currentMemberId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setSummary(
        await readWorkflowDashboardSummary({
          currentMemberId,
          from: null,
          to: null,
        }),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [currentMemberId]);

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
        caption: '目前仍在流程中的案件',
        href: '/search',
        label: '進行中案件',
        value: readMetricValue(summary.activeInstanceCount, loading),
      },
      {
        caption: '已超過 SLA 的待處理任務',
        href: '/inbox',
        label: '逾時任務',
        value: readMetricValue(summary.overdueTaskCount, loading),
      },
      {
        caption: '你有權限查看的全部案件',
        href: '/search',
        label: '案件總數',
        value: readMetricValue(summary.totalInstanceCount, loading),
      },
    ],
    [loading, summary],
  );

  return (
    <Layout>
      <AppNavigation activeHref={activeHref} />

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
                  <Typography color="text-neutral" variant="caption">
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
