'use client';

import { type Key, ReactElement, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
  Tab,
  TabItem,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  ApprovalInstanceRecord,
  listApprovalHistoryTasks,
  listInboxTasks,
  listTaskDecisions,
  readApprovalInstance,
  readApprovalInstanceCaseTitle,
  TaskDecisionRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../lib/format-date-time';
import { useAuth } from '../../lib/auth-provider';
import { useRouterAdapter } from '../../lib/router-adapter';
import { AppNavigation } from '../../components/app-navigation';

type InboxTabKey = 'history' | 'pending' | 'tracking';

type InboxTaskRow = Readonly<
  Record<string, unknown> &
    TaskRecord & {
      caseTitle: string;
      key: string;
      slaStatusColor: 'text-error' | 'text-neutral' | 'text-success';
      slaStatusText: string;
      statusLabel: string;
    }
>;

type ApprovalHistoryRow = Readonly<
  Record<string, unknown> &
    TaskRecord & {
      caseTitle: string;
      decisionAction: TaskDecisionRecord['action'] | null;
      decisionComment: string | null;
      decisionCommentText: string;
      decisionLabel: string;
      decidedAt: string | null;
      instanceState: ApprovalInstanceRecord['state'] | null;
      instanceStateLabel: string;
      key: string;
    }
>;

export interface InboxViewProps {}

/**
 * Framework-agnostic view for the BPM "我的待簽" inbox. Mechanical port of
 * `apps/client/src/app/inbox/page.tsx` — renders pending tasks, tracking,
 * and history tabs.
 */
export function InboxView(_props: InboxViewProps = {}): ReactElement {
  const router = useRouterAdapter();
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [activeTab, setActiveTab] = useState<InboxTabKey>('pending');
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ApprovalHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRows, setPendingRows] = useState<InboxTaskRow[]>([]);

  useEffect((): void => {
    if (!currentMemberId) {
      return;
    }

    void refreshTasks();
  }, [currentMemberId]);

  const pendingColumns = useMemo(
    (): TableColumn<InboxTaskRow>[] => [
      { dataIndex: 'caseTitle', key: 'caseTitle', title: '案件', width: 280 },
      { dataIndex: 'nodeId', key: 'nodeId', title: '節點', width: 180 },
      {
        dataIndex: 'statusLabel',
        key: 'statusLabel',
        title: '狀態',
        width: 120,
      },
      {
        key: 'slaDueAt',
        render: (record: InboxTaskRow): ReactElement => (
          <Typography
            color={record.slaStatusColor}
            component="span"
            variant="body"
          >
            {record.slaStatusText}
          </Typography>
        ),
        title: 'SLA',
        width: 180,
      },
      {
        key: 'createdAt',
        render: (record: InboxTaskRow): ReactElement => (
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
  const pendingTableActions = useMemo(
    (): TableActions<InboxTaskRow> => ({
      render: (record): ReturnType<TableActions<InboxTaskRow>['render']> => [
        {
          name: '處理',
          onClick: (): void => router.push(`/instances/${record.instanceId}`),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );
  const historyColumns = useMemo(
    (): TableColumn<ApprovalHistoryRow>[] => [
      { dataIndex: 'caseTitle', key: 'caseTitle', title: '案件', width: 280 },
      { dataIndex: 'nodeId', key: 'nodeId', title: '節點', width: 180 },
      {
        key: 'decisionLabel',
        render: (record: ApprovalHistoryRow): ReactElement => (
          <Typography
            color={readTaskDecisionColor(record.decisionAction)}
            component="span"
            variant="body"
          >
            {record.decisionLabel}
          </Typography>
        ),
        title: '決議',
        width: 120,
      },
      {
        key: 'decisionComment',
        render: (record: ApprovalHistoryRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.decisionCommentText}
          </Typography>
        ),
        title: '意見',
        width: 240,
      },
      {
        key: 'instanceStateLabel',
        render: (record: ApprovalHistoryRow): ReactElement => (
          <Typography
            color={readInstanceStateColor(record.instanceState)}
            component="span"
            variant="body"
          >
            {record.instanceStateLabel}
          </Typography>
        ),
        title: '流程狀態',
        width: 140,
      },
      {
        key: 'decidedAt',
        render: (record: ApprovalHistoryRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatHistoryDateTime(record.decidedAt)}
          </Typography>
        ),
        title: '簽核時間',
        width: 220,
      },
    ],
    [],
  );
  const historyTableActions = useMemo(
    (): TableActions<ApprovalHistoryRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<ApprovalHistoryRow>['render']> => [
        {
          name: '查看',
          onClick: (): void => router.push(`/instances/${record.instanceId}`),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );
  const trackingRows = useMemo(
    (): ApprovalHistoryRow[] =>
      historyRows.filter((row) => row.instanceState === 'RUNNING'),
    [historyRows],
  );

  function handleTabChange(activeKey: Key): void {
    if (
      activeKey === 'history' ||
      activeKey === 'pending' ||
      activeKey === 'tracking'
    ) {
      setActiveTab(activeKey);
      return;
    }

    setActiveTab('pending');
  }

  async function refreshTasks(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      if (!currentMemberId) {
        setPendingRows([]);
        setHistoryRows([]);
        return;
      }

      const [nextPendingTasks, nextHistoryTasks] = await Promise.all([
        listInboxTasks(currentMemberId),
        listApprovalHistoryTasks(currentMemberId),
      ]);
      const [nextPendingRows, nextHistoryRows] = await Promise.all([
        readInboxTaskRows(nextPendingTasks),
        readApprovalHistoryRows(nextHistoryTasks),
      ]);

      setPendingRows(nextPendingRows);
      setHistoryRows(nextHistoryRows);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <AppNavigation activeHref="/inbox" />

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description={`目前以 ${member?.name ?? currentMemberId ?? '目前登入會員'} 查詢待處理與歷史簽核任務。`}
            title="我的待簽"
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
            <Tab activeKey={activeTab} onChange={handleTabChange} size="sub">
              <TabItem
                badgeCount={loading ? undefined : pendingRows.length}
                key="pending"
              >
                待簽核
              </TabItem>
              <TabItem
                badgeCount={loading ? undefined : trackingRows.length}
                key="tracking"
              >
                已處理未結束
              </TabItem>
              <TabItem key="history">歷史簽核記錄</TabItem>
            </Tab>

            {activeTab === 'pending' ? (
              <Table
                actions={pendingTableActions}
                columns={pendingColumns}
                dataSource={pendingRows}
                fullWidth
                loading={loading}
              />
            ) : null}
            {activeTab === 'tracking' ? (
              <Table
                actions={historyTableActions}
                columns={historyColumns}
                dataSource={trackingRows}
                fullWidth
                loading={loading}
              />
            ) : null}
            {activeTab === 'history' ? (
              <Table
                actions={historyTableActions}
                columns={historyColumns}
                dataSource={historyRows}
                fullWidth
                loading={loading}
              />
            ) : null}
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

async function readInboxTaskRows(
  tasks: readonly TaskRecord[],
): Promise<InboxTaskRow[]> {
  const instances = await readTaskInstances(tasks);

  return tasks.map(
    (task, index): InboxTaskRow => ({
      ...task,
      caseTitle: readTaskCaseTitle(task, instances[index] ?? null),
      key: task.id,
      slaStatusColor: readSlaStatusColor(task.slaDueAt),
      slaStatusText: readSlaStatusText(task.slaDueAt),
      statusLabel: readTaskStatusLabel(task.status),
    }),
  );
}

async function readApprovalHistoryRows(
  tasks: readonly TaskRecord[],
): Promise<ApprovalHistoryRow[]> {
  const [decisionLists, instances] = await Promise.all([
    Promise.all(tasks.map((task) => listTaskDecisions(task.id))),
    readTaskInstances(tasks),
  ]);

  return tasks.map((task, index): ApprovalHistoryRow => {
    const decision = readLatestTaskDecision(decisionLists[index] ?? []);
    const instance = instances[index] ?? null;

    return {
      ...task,
      caseTitle: readTaskCaseTitle(task, instance),
      decisionAction: decision?.action ?? null,
      decisionComment: decision?.comment ?? null,
      decisionCommentText: readDecisionCommentText(decision?.comment ?? null),
      decisionLabel: readTaskDecisionLabel(decision?.action ?? null),
      decidedAt: decision?.decidedAt ?? task.completedAt,
      instanceState: instance?.state ?? null,
      instanceStateLabel: readInstanceStateLabel(instance?.state ?? null),
      key: task.id,
    };
  });
}

async function readTaskInstances(
  tasks: readonly TaskRecord[],
): Promise<readonly (ApprovalInstanceRecord | null)[]> {
  return Promise.all(
    tasks.map(async (task): Promise<ApprovalInstanceRecord | null> => {
      try {
        return (await readApprovalInstance(task.instanceId)).instance;
      } catch {
        return null;
      }
    }),
  );
}

function readTaskCaseTitle(
  task: TaskRecord,
  instance: ApprovalInstanceRecord | null,
): string {
  return instance ? readApprovalInstanceCaseTitle(instance) : task.instanceId;
}

function readLatestTaskDecision(
  decisions: readonly TaskDecisionRecord[],
): TaskDecisionRecord | null {
  return [...decisions].sort(compareTaskDecisionDesc)[0] ?? null;
}

function compareTaskDecisionDesc(
  left: TaskDecisionRecord,
  right: TaskDecisionRecord,
): number {
  return (
    new Date(right.decidedAt).getTime() - new Date(left.decidedAt).getTime()
  );
}

function readTaskDecisionLabel(
  action: TaskDecisionRecord['action'] | null,
): string {
  if (action === 'APPROVED') {
    return '同意';
  }

  if (action === 'REJECTED') {
    return '拒絕';
  }

  if (action === 'RETURNED') {
    return '退回';
  }

  if (action === 'TRANSFERRED') {
    return '轉派';
  }

  return '未記錄';
}

function readTaskDecisionColor(
  action: TaskDecisionRecord['action'] | null,
): 'text-error' | 'text-neutral' | 'text-success' {
  if (action === 'APPROVED') {
    return 'text-success';
  }

  if (action === 'REJECTED' || action === 'RETURNED') {
    return 'text-error';
  }

  return 'text-neutral';
}

function readInstanceStateLabel(
  state: ApprovalInstanceRecord['state'] | null,
): string {
  if (state === 'RUNNING') {
    return '進行中';
  }

  if (state === 'APPROVED') {
    return '已通過';
  }

  if (state === 'REJECTED') {
    return '已拒絕';
  }

  if (state === 'RETURNED') {
    return '已退回';
  }

  if (state === 'CANCELLED') {
    return '已取消';
  }

  if (state === 'EXPIRED') {
    return '已逾期';
  }

  if (state === 'DRAFT') {
    return '草稿';
  }

  return '-';
}

function readInstanceStateColor(
  state: ApprovalInstanceRecord['state'] | null,
): 'text-error' | 'text-neutral' | 'text-success' {
  if (state === 'APPROVED') {
    return 'text-success';
  }

  if (state === 'REJECTED' || state === 'CANCELLED' || state === 'EXPIRED') {
    return 'text-error';
  }

  return 'text-neutral';
}

function readDecisionCommentText(comment: string | null): string {
  const trimmedComment = comment?.trim() ?? '';

  return trimmedComment || '-';
}

function formatHistoryDateTime(value: string | null): string {
  return formatDateTime(value);
}

function readSlaStatusText(value: string | null): string {
  if (!value) {
    return '-';
  }

  const dueAt = new Date(value).getTime();
  const now = Date.now();
  const diffMs = Math.abs(dueAt - now);
  const label = formatDuration(diffMs);

  return dueAt < now ? `已逾期 ${label}` : `剩餘 ${label}`;
}

function readSlaStatusColor(
  value: string | null,
): 'text-error' | 'text-neutral' | 'text-success' {
  if (!value) {
    return 'text-neutral';
  }

  return new Date(value).getTime() < Date.now() ? 'text-error' : 'text-success';
}

function formatDuration(value: number): string {
  const totalMinutes = Math.max(1, Math.ceil(value / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}天 ${hours}小時`;
  }

  if (hours > 0) {
    return `${hours}小時 ${minutes}分鐘`;
  }

  return `${minutes}分鐘`;
}

function readTaskStatusLabel(status: TaskRecord['status']): string {
  if (status === 'PENDING') {
    return '待處理';
  }

  if (status === 'IN_PROGRESS') {
    return '處理中';
  }

  if (status === 'COMPLETED') {
    return '已完成';
  }

  if (status === 'TRANSFERRED') {
    return '已轉派';
  }

  if (status === 'CANCELLED') {
    return '已取消';
  }

  return status;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
