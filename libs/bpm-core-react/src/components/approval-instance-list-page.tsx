'use client';

import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { resolveMembers, type MemberProfileRecord } from '@rytass/bpm-core-client';
import {
  listApprovalInstancesPage,
  readApprovalInstanceCaseTitle,
  type ApprovalInstanceRecord,
  type ApprovalInstanceState,
  type ApprovalInstanceView,
} from '@rytass/bpm-core-client/workflow';
import { useRouterAdapter } from '../lib/router-adapter';
import { formatDateTime } from '../lib/format-date-time';
import { AppLayout } from './app-navigation';
import styles from './approval-instance-list-page.module.scss';

export interface ApprovalInstanceListPageProps {
  readonly activeHref: string;
  readonly defaultState: ApprovalInstanceState | null;
  readonly description: string;
  readonly emptyMessage: string;
  readonly searchPlaceholder: string;
  readonly title: string;
  readonly view: ApprovalInstanceView;
}

type StateFilterOption = Readonly<{
  id: 'ALL' | ApprovalInstanceState;
  name: string;
  state: ApprovalInstanceState | null;
}>;

type ApprovalInstanceRow = Readonly<
  Record<string, unknown> &
    ApprovalInstanceRecord & {
      caseTitle: string;
      key: string;
      stateLabel: string;
    }
>;

const INSTANCE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const STATE_FILTER_OPTIONS: readonly StateFilterOption[] = [
  { id: 'ALL', name: '全部狀態', state: null },
  { id: 'RUNNING', name: '進行中', state: 'RUNNING' },
  { id: 'APPROVED', name: '已通過', state: 'APPROVED' },
  { id: 'REJECTED', name: '已拒絕', state: 'REJECTED' },
  { id: 'RETURNED', name: '已退回', state: 'RETURNED' },
  { id: 'CANCELLED', name: '已取消', state: 'CANCELLED' },
  { id: 'EXPIRED', name: '已逾期', state: 'EXPIRED' },
  { id: 'DRAFT', name: '草稿', state: 'DRAFT' },
];

/**
 * Shared list page for any approval-instance "view" (inbox / sent / cc /
 * delegated). Caller picks the view + default state filter; the page renders
 * the standard BPM filter bar + paginated table and navigates to
 * `/instances/:id` on row action.
 */
export function ApprovalInstanceListPage({
  activeHref,
  defaultState,
  description,
  emptyMessage,
  searchPlaceholder,
  title,
  view,
}: ApprovalInstanceListPageProps): ReactElement {
  const router = useRouterAdapter();
  const [error, setError] = useState<string | null>(null);
  const [initiatorProfilesById, setInitiatorProfilesById] = useState<
    ReadonlyMap<string, MemberProfileRecord>
  >(new Map());
  const [instancePage, setInstancePage] = useState(1);
  const [instancePageSize, setInstancePageSize] = useState(10);
  const [instanceTotalCount, setInstanceTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<readonly ApprovalInstanceRow[]>([]);
  const [searchText, setSearchText] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilterOption>(
    readStateFilterOption(defaultState),
  );

  const refreshInstances = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const result = await listApprovalInstancesPage({
        page: instancePage,
        pageSize: instancePageSize,
        searchText,
        state: stateFilter.state,
        templateId: null,
        view,
      });

      setRows(result.instances.map(readApprovalInstanceRow));
      setInstanceTotalCount(result.totalCount);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [instancePage, instancePageSize, searchText, stateFilter, view]);

  useEffect((): void => {
    void refreshInstances();
  }, [refreshInstances]);

  useEffect((): (() => void) | void => {
    const initiatorMemberIds = Array.from(
      new Set(rows.map((row) => row.initiatorMemberId).filter(Boolean)),
    );

    if (initiatorMemberIds.length === 0) {
      setInitiatorProfilesById(new Map());

      return;
    }

    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const profiles = await resolveMembers(initiatorMemberIds);

        if (cancelled) {
          return;
        }

        setInitiatorProfilesById(
          new Map(profiles.map((profile) => [profile.memberId, profile])),
        );
      } catch {
        if (cancelled) {
          return;
        }

        setInitiatorProfilesById(new Map());
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [rows]);

  const columns = useMemo(
    (): TableColumn<ApprovalInstanceRow>[] => [
      { dataIndex: 'caseTitle', key: 'caseTitle', title: '案件', width: 300 },
      {
        key: 'state',
        render: (record: ApprovalInstanceRow): ReactElement => (
          <Typography
            color={readInstanceStateColor(record.state)}
            component="span"
            variant="body"
          >
            {record.stateLabel}
          </Typography>
        ),
        title: '狀態',
        width: 120,
      },
      {
        key: 'initiatorMemberId',
        render: (record: ApprovalInstanceRow): ReactElement => (
          <Typography component="span" variant="body">
            {readInitiatorLabel(
              record.initiatorMemberId,
              initiatorProfilesById,
            )}
          </Typography>
        ),
        title: '發起人',
        width: 180,
      },
      {
        key: 'startedAt',
        render: (record: ApprovalInstanceRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.startedAt)}
          </Typography>
        ),
        title: '發起時間',
        width: 220,
      },
      {
        key: 'completedAt',
        render: (record: ApprovalInstanceRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.completedAt)}
          </Typography>
        ),
        title: '完成時間',
        width: 220,
      },
    ],
    [initiatorProfilesById],
  );
  const tableActions = useMemo(
    (): TableActions<ApprovalInstanceRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<ApprovalInstanceRow>['render']> => [
        {
          name: '查看',
          onClick: (): void => router.push(`/instances/${record.id}`),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );

  return (
    <AppLayout activeHref={activeHref}>
        <PageHeader>
          <ContentHeader description={description} title={title} />
        </PageHeader>

        <SectionGroup>
          <Section
            filterArea={
              <FilterArea className={styles.instanceFilterArea} size="sub">
                <FilterLine>
                  <Filter span={3}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="instanceSearchText"
                    >
                      <Input
                        fullWidth
                        onChange={(
                          event: ChangeEvent<HTMLInputElement>,
                        ): void => {
                          setSearchText(event.target.value);
                          setInstancePage(1);
                        }}
                        placeholder={searchPlaceholder}
                        size="sub"
                        value={searchText}
                        variant="base"
                      />
                    </FormField>
                  </Filter>
                  <Filter span={2}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="instanceState"
                    >
                      <Select
                        clearable={false}
                        fullWidth
                        onChange={(option): void => {
                          setStateFilter(readSelectedStateFilterOption(option));
                          setInstancePage(1);
                        }}
                        options={[...STATE_FILTER_OPTIONS]}
                        placeholder="狀態"
                        renderValue={(value): string =>
                          `狀態：${readStateFilterLabel(value)}`
                        }
                        size="sub"
                        value={stateFilter}
                      />
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
            {!error && !loading && rows.length === 0 ? (
              <Typography color="text-neutral" variant="body">
                {emptyMessage}
              </Typography>
            ) : null}
            <Table
              actions={tableActions}
              columns={columns}
              dataSource={[...rows]}
              fullWidth
              loading={loading}
              pagination={{
                current: instancePage,
                onChange: (page): void => {
                  setInstancePage(page);
                },
                onChangePageSize: (pageSize): void => {
                  setInstancePage(1);
                  setInstancePageSize(pageSize);
                },
                pageSize: instancePageSize,
                pageSizeLabel: '每頁筆數',
                pageSizeOptions: INSTANCE_PAGE_SIZE_OPTIONS,
                renderResultSummary: (from, to, total): string =>
                  `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                showPageSizeOptions: true,
                total: instanceTotalCount,
              }}
            />
          </Section>
        </SectionGroup>
      </AppLayout>
  );
}

function readApprovalInstanceRow(
  instance: ApprovalInstanceRecord,
): ApprovalInstanceRow {
  return {
    ...instance,
    caseTitle: readApprovalInstanceCaseTitle(instance),
    key: instance.id,
    stateLabel: readInstanceStateLabel(instance.state),
  };
}

function readSelectedStateFilterOption(option: unknown): StateFilterOption {
  if (!isStateFilterOption(option)) {
    return STATE_FILTER_OPTIONS[0];
  }
  return readStateFilterOption(option.state);
}

function readStateFilterOption(
  state: ApprovalInstanceState | null,
): StateFilterOption {
  return (
    STATE_FILTER_OPTIONS.find((option) => option.state === state) ??
    STATE_FILTER_OPTIONS[0]
  );
}

function readStateFilterLabel(value: unknown): string {
  return isStateFilterOption(value) ? value.name : STATE_FILTER_OPTIONS[0].name;
}

function isStateFilterOption(value: unknown): value is StateFilterOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'state' in value
  );
}

function readInstanceStateLabel(state: ApprovalInstanceState): string {
  if (state === 'RUNNING') return '進行中';
  if (state === 'APPROVED') return '已通過';
  if (state === 'REJECTED') return '已拒絕';
  if (state === 'RETURNED') return '已退回';
  if (state === 'CANCELLED') return '已取消';
  if (state === 'EXPIRED') return '已逾期';
  return '草稿';
}

function readInstanceStateColor(
  state: ApprovalInstanceState,
): 'text-error' | 'text-neutral' | 'text-success' {
  if (state === 'APPROVED') return 'text-success';
  if (state === 'REJECTED' || state === 'CANCELLED' || state === 'EXPIRED') {
    return 'text-error';
  }
  return 'text-neutral';
}

function readInitiatorLabel(
  initiatorMemberId: string | null | undefined,
  initiatorProfilesById: ReadonlyMap<string, MemberProfileRecord>,
): string {
  const trimmedMemberId = (initiatorMemberId ?? '').trim();
  if (!trimmedMemberId) return '未知發起人';
  return initiatorProfilesById.get(trimmedMemberId)?.name ?? trimmedMemberId;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '讀取簽核案件失敗。';
}
