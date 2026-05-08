'use client';

import { type Key, ReactElement, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { formatDateTime } from '../_lib/date-time';
import { renderAppNavigation } from '../app-navigation';
import {
  ApprovalInstanceRecord,
  CURRENT_MEMBER_ID,
  listApprovalHistoryTasks,
  listInboxTasks,
  listTaskDecisions,
  readApprovalInstance,
  readApprovalInstanceCaseTitle,
  TaskDecisionRecord,
  TaskRecord,
} from '../instances/_lib/workflow-api';

type InboxTabKey = 'history' | 'pending';

type InboxTaskRow = Readonly<
  Record<string, unknown> &
    TaskRecord & {
      caseTitle: string;
      key: string;
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
      key: string;
    }
>;

export default function InboxPage(): ReactElement {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<InboxTabKey>('pending');
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ApprovalHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRows, setPendingRows] = useState<InboxTaskRow[]>([]);

  useEffect((): void => {
    void refreshTasks();
  }, []);

  const pendingColumns = useMemo(
    (): TableColumn<InboxTaskRow>[] => [
      { dataIndex: 'caseTitle', key: 'caseTitle', title: '案件', width: 280 },
      { dataIndex: 'nodeId', key: 'nodeId', title: '節點', width: 180 },
      { dataIndex: 'statusLabel', key: 'statusLabel', title: '狀態', width: 120 },
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

  function handleTabChange(activeKey: Key): void {
    setActiveTab(activeKey === 'history' ? 'history' : 'pending');
  }

  async function refreshTasks(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [nextPendingTasks, nextHistoryTasks] = await Promise.all([
        listInboxTasks(CURRENT_MEMBER_ID),
        listApprovalHistoryTasks(CURRENT_MEMBER_ID),
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
      {renderAppNavigation('/inbox')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description={`目前以開發用會員 ${CURRENT_MEMBER_ID} 查詢待處理與歷史簽核任務。`}
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
              <TabItem key="pending">待簽核</TabItem>
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

  return tasks.map((task, index): InboxTaskRow => ({
    ...task,
    caseTitle: readTaskCaseTitle(task, instances[index] ?? null),
    key: task.id,
    statusLabel: readTaskStatusLabel(task.status),
  }));
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

    return {
      ...task,
      caseTitle: readTaskCaseTitle(task, instances[index] ?? null),
      decisionAction: decision?.action ?? null,
      decisionComment: decision?.comment ?? null,
      decisionCommentText: readDecisionCommentText(decision?.comment ?? null),
      decisionLabel: readTaskDecisionLabel(decision?.action ?? null),
      decidedAt: decision?.decidedAt ?? task.completedAt,
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

function readDecisionCommentText(comment: string | null): string {
  const trimmedComment = comment?.trim() ?? '';

  return trimmedComment || '-';
}

function formatHistoryDateTime(value: string | null): string {
  return formatDateTime(value);
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
