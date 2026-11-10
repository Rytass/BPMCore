'use client';

import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  PageHeader,
  RadioGroup,
  Section,
  SectionGroup,
  Select,
  Table,
  Typography,
  type FilterLineProps,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  resolveMembers,
  type MemberProfileRecord,
} from '@rytass/bpm-core-client';
import {
  listApprovalTemplates,
  type ApprovalTemplateRecord,
} from '@rytass/bpm-core-client/template';
import {
  listApprovalInstancesPage,
  readApprovalInstanceCaseTitle,
  readApprovalTemplateCurrentFormSchema,
  type ApprovalInstanceRecord,
  type ApprovalInstanceState,
  type ApprovalInstanceView,
} from '@rytass/bpm-core-client/workflow';
import {
  readFilterableFieldPaths,
  type ApprovalInstanceFieldFilter,
  type ApprovalInstanceSort,
  type ApprovalInstanceSortDirection,
  type FilterableFieldPath,
  type FormDefinitionSchema,
} from '@rytass/bpm-core-shared';
import { useRouterAdapter } from '../lib/router-adapter';
import { useBPMRoutes } from '../lib/routes-config';
import { formatDateTime } from '../lib/format-date-time';
import {
  buildApprovalInstanceFieldFilters,
  DEFAULT_SORT_DRAFT,
  DEFAULT_SORT_OPTION,
  isSortFieldAvailable,
  readSortFieldOptions,
  toApprovalInstanceSort,
  type FieldFilterDraft,
  type FieldFilterDrafts,
  type SortDraft,
  type SortFieldOption,
} from './approval-instance-field-filters';
import { readFieldFilterElements } from './approval-instance-field-filter-controls';
import styles from './approval-instance-list-page.module.scss';

export interface ApprovalInstanceListPageProps {
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

type SelectChoice = Readonly<{ id: string; name: string }>;

const INSTANCE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const FIELD_FILTERS_PER_LINE = 3;
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
const SORT_DIRECTION_OPTIONS: readonly (SelectChoice & {
  id: ApprovalInstanceSortDirection;
})[] = [
  { id: 'DESC', name: '新到舊' },
  { id: 'ASC', name: '舊到新' },
];

/**
 * Shared list page for any approval-instance "view" (inbox / sent / cc /
 * delegated). Caller picks the view + default state filter; the page renders
 * the standard BPM filter bar + paginated table and navigates to
 * `/instances/:id` on row action.
 *
 * With a template selected, the filter bar also carries one control per
 * filterable field of that template's current form (ADR 25 §7), and the sort
 * may use those fields. Without a template only time fields can sort.
 */
export function ApprovalInstanceListPage({
  defaultState,
  description,
  emptyMessage,
  searchPlaceholder,
  title,
  view,
}: ApprovalInstanceListPageProps): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
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
  const [templates, setTemplates] = useState<readonly ApprovalTemplateRecord[]>(
    [],
  );
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateSchema, setTemplateSchema] =
    useState<FormDefinitionSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [fieldDrafts, setFieldDrafts] = useState<FieldFilterDrafts>({});
  const [sortDraft, setSortDraft] = useState<SortDraft>(DEFAULT_SORT_DRAFT);
  const refreshRequestIdRef = useRef(0);

  const fieldPaths = useMemo(
    (): readonly FilterableFieldPath[] =>
      templateSchema ? readFilterableFieldPaths(templateSchema) : [],
    [templateSchema],
  );
  const fieldFilters = useMemo(
    (): readonly ApprovalInstanceFieldFilter[] | undefined =>
      templateId === null
        ? undefined
        : buildApprovalInstanceFieldFilters(fieldPaths, fieldDrafts),
    [fieldDrafts, fieldPaths, templateId],
  );
  const sort = useMemo(
    (): readonly ApprovalInstanceSort[] | undefined =>
      toApprovalInstanceSort(sortDraft),
    [sortDraft],
  );
  const sortOptions = useMemo(
    (): readonly SortFieldOption[] =>
      readSortFieldOptions(fieldPaths, templateId !== null),
    [fieldPaths, templateId],
  );

  const refreshInstances = useCallback(async (): Promise<void> => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const result = await listApprovalInstancesPage({
        fieldFilters,
        page: instancePage,
        pageSize: instancePageSize,
        searchText,
        sort,
        state: stateFilter.state,
        templateId,
        view,
      });

      if (requestId !== refreshRequestIdRef.current) {
        return;
      }

      setRows(result.instances.map(readApprovalInstanceRow));
      setInstanceTotalCount(result.totalCount);
    } catch (requestError: unknown) {
      if (requestId === refreshRequestIdRef.current) {
        setError(readErrorMessage(requestError));
      }
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    fieldFilters,
    instancePage,
    instancePageSize,
    searchText,
    sort,
    stateFilter,
    templateId,
    view,
  ]);

  useEffect((): void => {
    void refreshInstances();
  }, [refreshInstances]);

  useEffect((): (() => void) | void => {
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const loaded = await listApprovalTemplates();

        if (!cancelled) {
          setTemplates(loaded);
        }
      } catch {
        if (!cancelled) {
          setTemplates([]);
        }
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, []);

  // Race guard: a schema response for a previously picked template is dropped
  // when the template changes again (cleanup flips `cancelled`).
  useEffect((): (() => void) | void => {
    if (templateId === null) {
      setTemplateSchema(null);
      setSchemaLoading(false);
      setSchemaError(null);

      return;
    }

    let cancelled = false;
    setSchemaLoading(true);
    setSchemaError(null);

    void (async (): Promise<void> => {
      try {
        const schema = await readApprovalTemplateCurrentFormSchema(templateId);

        if (!cancelled) {
          setTemplateSchema(schema);
        }
      } catch (schemaLoadError: unknown) {
        if (!cancelled) {
          setTemplateSchema(null);
          setSchemaError(readErrorMessage(schemaLoadError));
        }
      } finally {
        if (!cancelled) {
          setSchemaLoading(false);
        }
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [templateId]);

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

  const handleTemplateChange = useCallback(
    (option: SelectChoice | null): void => {
      setTemplateId(option?.id ?? null);
      // Drop the previous template's fields at once, so nothing is built from
      // them while the new schema loads.
      setTemplateSchema(null);
      setFieldDrafts({});
      setInstancePage(1);
      // A form-field sort belongs to one template. Time-field sorts survive.
      setSortDraft((previous): SortDraft =>
        isSortFieldAvailable(previous.field, [], false)
          ? previous
          : { ...previous, field: DEFAULT_SORT_DRAFT.field },
      );
    },
    [],
  );

  const handleFilterReset = useCallback((): void => {
    setSearchText('');
    setStateFilter(readStateFilterOption(defaultState));
    setTemplateId(null);
    setTemplateSchema(null);
    setFieldDrafts({});
    setSortDraft(DEFAULT_SORT_DRAFT);
    setInstancePage(1);
  }, [defaultState]);
  const handleFilterSubmit = useCallback((): void => {
    void refreshInstances();
  }, [refreshInstances]);
  const handleFieldDraftChange = useCallback(
    (path: string, draft: FieldFilterDraft): void => {
      setFieldDrafts((previous): FieldFilterDrafts => ({
        ...previous,
        [path]: draft,
      }));
      setInstancePage(1);
    },
    [],
  );

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
          onClick: (): void => router.push(routes.caseDetail(record.id)),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );

  const templateOptions = useMemo(
    (): readonly SelectChoice[] =>
      templates.map((template) => ({ id: template.id, name: template.name })),
    [templates],
  );
  const selectedTemplate = templateOptions.find(
    (option) => option.id === templateId,
  );
  const fieldFilterLines = useMemo(
    (): readonly ReactElement<FilterLineProps>[] =>
      chunkElements(
        readFieldFilterElements(
          fieldPaths,
          fieldDrafts,
          handleFieldDraftChange,
        ),
        FIELD_FILTERS_PER_LINE,
      ).map((elements, index): ReactElement<FilterLineProps> => (
        <FilterLine key={`field-filter-line-${index}`}>
          {[...elements]}
        </FilterLine>
      )),
    [fieldDrafts, fieldPaths, handleFieldDraftChange],
  );
  const sortFieldChoices = useMemo(
    (): readonly SelectChoice[] =>
      sortOptions.map((option) => ({ id: option.id, name: option.label })),
    [sortOptions],
  );
  const selectedSortField =
    sortFieldChoices.find((option) => option.id === sortDraft.field) ??
    sortFieldChoices.find((option) => option.id === DEFAULT_SORT_OPTION.id);

  const searchFilterLine = (
    <FilterLine key="search">
      <Filter span={3}>
        <FormField
          fullWidth
          layout={FormFieldLayout.VERTICAL}
          name="instanceSearchText"
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
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
      <Filter span={2}>
        <FormField
          fullWidth
          layout={FormFieldLayout.VERTICAL}
          label="範本"
          name="instanceTemplate"
        >
          <Select
            clearable
            fullWidth
            onChange={handleTemplateChange}
            options={[...templateOptions]}
            placeholder="全部範本"
            size="sub"
            value={selectedTemplate ?? null}
          />
        </FormField>
      </Filter>
    </FilterLine>
  );

  const sortFilterLine = (
    <FilterLine key="sort">
      <Filter span={2}>
        <FormField
          fullWidth
          layout={FormFieldLayout.VERTICAL}
          label="排序欄位"
          name="instanceSortField"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option: SelectChoice | null): void => {
              setSortDraft((previous): SortDraft => ({
                ...previous,
                field: option?.id ?? DEFAULT_SORT_DRAFT.field,
              }));
              setInstancePage(1);
            }}
            options={[...sortFieldChoices]}
            placeholder="排序欄位"
            size="sub"
            value={selectedSortField ?? null}
          />
        </FormField>
      </Filter>
      <Filter span={2}>
        <FormField
          fullWidth
          layout={FormFieldLayout.VERTICAL}
          label="排序方向"
          name="instanceSortDirection"
        >
          <RadioGroup
            name="instanceSortDirection"
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setSortDraft((previous): SortDraft => ({
                ...previous,
                direction: readSortDirection(event.target.value),
              }));
              setInstancePage(1);
            }}
            options={[...SORT_DIRECTION_OPTIONS]}
            size="sub"
            type="segment"
            value={sortDraft.direction}
          />
        </FormField>
      </Filter>
    </FilterLine>
  );

  return (
    <>
      <PageHeader>
        <ContentHeader description={description} title={title} />
      </PageHeader>

      <SectionGroup>
        <Section
          filterArea={
            <FilterArea
              className={styles.instanceFilterArea}
              onReset={handleFilterReset}
              onSubmit={handleFilterSubmit}
              resetText="清除條件"
              size="sub"
              submitText="重新查詢"
            >
              {[searchFilterLine, ...fieldFilterLines, sortFilterLine]}
            </FilterArea>
          }
        >
          {error ? (
            <Typography color="text-error" variant="body">
              {error}
            </Typography>
          ) : null}
          {schemaError ? (
            <Typography color="text-error" variant="body">
              {schemaError}
            </Typography>
          ) : null}
          {templateId !== null &&
          !schemaLoading &&
          !schemaError &&
          templateSchema &&
          fieldPaths.length === 0 ? (
            <Typography color="text-neutral" variant="body">
              此範本沒有可篩選的欄位。
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
    </>
  );
}

function chunkElements<T>(
  items: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  return items.reduce<readonly (readonly T[])[]>(
    (lines, item): readonly (readonly T[])[] => {
      const last = lines[lines.length - 1];

      return last && last.length < size
        ? [...lines.slice(0, -1), [...last, item]]
        : [...lines, [item]];
    },
    [],
  );
}

function readSortDirection(value: string): ApprovalInstanceSortDirection {
  return value === 'ASC' ? 'ASC' : 'DESC';
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
