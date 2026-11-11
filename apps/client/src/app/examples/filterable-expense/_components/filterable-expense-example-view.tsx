'use client';

import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  DateRangePicker,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  InlineMessage,
  Input,
  PageHeader,
  Pagination,
  RadioGroup,
  Select,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import { formatDatePickerValue } from '@rytass/bpm-core-client/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { useBPMRoutes, useRouterAdapter } from '@rytass/bpm-core-react';
import {
  listApprovalInstancesPage,
  type ApprovalInstanceRecord,
  type ApprovalInstanceState,
} from '@rytass/bpm-core-client/workflow';
import {
  COMPANY_OPTIONS,
  DEPARTMENT_OPTIONS,
  FILTERABLE_EXPENSE_TEMPLATE_ID,
  REQUEST_TYPE_OPTIONS,
  VENDOR_OPTIONS,
  type DemoOption,
} from '../filterable-expense-demo.constants';
import {
  buildFieldFilters,
  buildSort,
  DEFAULT_SORT_FIELD,
  EMPTY_FILTERABLE_EXPENSE_QUERY,
  readQueryProblem,
  type FilterableExpenseQuery,
} from '../filterable-expense-query';
import styles from '../page.module.scss';

const PAGE_SIZE = 10;

interface SelectChoice {
  readonly id: string;
  readonly name: string;
}

type StateBadgeVariant =
  'dot-error' | 'dot-inactive' | 'dot-info' | 'dot-success' | 'dot-warning';

const STATE_BADGE: Readonly<
  Record<
    ApprovalInstanceState,
    { readonly label: string; readonly variant: StateBadgeVariant }
  >
> = {
  APPROVED: { label: '已核准', variant: 'dot-success' },
  CANCELLED: { label: '已取消', variant: 'dot-inactive' },
  DRAFT: { label: '草稿', variant: 'dot-inactive' },
  EXPIRED: { label: '已逾時', variant: 'dot-warning' },
  REJECTED: { label: '已拒絕', variant: 'dot-error' },
  RETURNED: { label: '已退回', variant: 'dot-warning' },
  RUNNING: { label: '簽核中', variant: 'dot-info' },
};

const STATE_ORDER: readonly ApprovalInstanceState[] = [
  'RUNNING',
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'EXPIRED',
  'CANCELLED',
  'DRAFT',
];

/** 排序欄位：applyDate、amountTwd 是表單欄位；submittedAt 等是時間欄位。 */
const SORT_FIELD_OPTIONS: readonly DemoOption[] = [
  { label: '申請日', value: 'applyDate' },
  { label: '金額', value: 'amountTwd' },
  { label: '送出時間', value: 'submittedAt' },
  { label: '更新時間', value: 'updatedAt' },
  { label: '完成時間', value: 'completedAt' },
];

const SORT_DIRECTION_OPTIONS = [
  { id: 'ASC', name: '升冪' },
  { id: 'DESC', name: '降冪' },
] as const;

const STATE_CHOICES: readonly SelectChoice[] = STATE_ORDER.map(
  (state): SelectChoice => ({ id: state, name: STATE_BADGE[state].label }),
);

interface ExampleRow {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly vendorLabel: string;
  readonly amountText: string;
  readonly applyDate: string;
  readonly state: ApprovalInstanceState;
  readonly startedAt: string;
  readonly completedAt: string;
  /** Table 的資料列需要 index signature。 */
  readonly [field: string]: unknown;
}

function toChoices(options: readonly DemoOption[]): readonly SelectChoice[] {
  return options.map((option): SelectChoice => ({
    id: option.value,
    name: option.label,
  }));
}

function findChoice(
  options: readonly DemoOption[],
  value: string,
): SelectChoice | null {
  const option = options.find((item) => item.value === value);

  return option ? { id: option.value, name: option.label } : null;
}

const VENDOR_CHOICES = toChoices(VENDOR_OPTIONS);
const COMPANY_CHOICES = toChoices(COMPANY_OPTIONS);
const REQUEST_TYPE_CHOICES = toChoices(REQUEST_TYPE_OPTIONS);
const DEPARTMENT_CHOICES = toChoices(DEPARTMENT_OPTIONS);
const SORT_FIELD_CHOICES = toChoices(SORT_FIELD_OPTIONS);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '查詢失敗，請稍後再試。';
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString('zh-TW', {
    hour12: false,
    timeZone: 'Asia/Taipei',
  });
}

/**
 * 表單的廠商值是 vendor id；顯示名稱取自案件自己的 option snapshot，
 * 不去查現行資料來源，避免資料來源改名後舊案件顯示錯誤。
 */
function readVendorLabel(instance: ApprovalInstanceRecord): string {
  const vendorId = instance.formData['vendor'];

  if (typeof vendorId !== 'string') {
    return '—';
  }

  const option = instance.formDataOptionSnapshot['vendor']?.options.find(
    (item) => item.value === vendorId,
  );

  return option?.label ?? vendorId;
}

function toRow(instance: ApprovalInstanceRecord): ExampleRow {
  const amount = instance.formData['amountTwd'];
  const applyDate = instance.formData['applyDate'];

  return {
    applyDate: typeof applyDate === 'string' ? applyDate : '—',
    amountText:
      typeof amount === 'number' ? amount.toLocaleString('zh-TW') : '—',
    completedAt: formatDateTime(instance.completedAt),
    id: instance.id,
    key: instance.id,
    startedAt: formatDateTime(instance.startedAt),
    state: instance.state,
    title: instance.title || instance.id,
    vendorLabel: readVendorLabel(instance),
  };
}

export function FilterableExpenseExampleView(): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const [draft, setDraft] = useState<FilterableExpenseQuery>(
    EMPTY_FILTERABLE_EXPENSE_QUERY,
  );
  const [applied, setApplied] = useState<FilterableExpenseQuery>(
    EMPTY_FILTERABLE_EXPENSE_QUERY,
  );
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<readonly ExampleRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Mezzanine's DateRangePicker falls back to its own last pick when `value`
  // is emptied, so 清除條件 remounts it to show the cleared range.
  const [resetCount, setResetCount] = useState<number>(0);

  useEffect((): (() => void) => {
    let active = true;

    setLoading(true);
    setError(null);

    listApprovalInstancesPage({
      fieldFilters: buildFieldFilters(applied),
      page,
      pageSize: PAGE_SIZE,
      searchText: null,
      sort: buildSort(applied),
      state: applied.state,
      templateId: FILTERABLE_EXPENSE_TEMPLATE_ID,
      view: 'ALL',
    })
      .then((result): void => {
        if (!active) {
          return;
        }

        setRows(result.instances.map(toRow));
        setTotal(result.totalCount);
      })
      .catch((requestError: unknown): void => {
        if (active) {
          setError(readErrorMessage(requestError));
        }
      })
      .finally((): void => {
        if (active) {
          setLoading(false);
        }
      });

    return (): void => {
      active = false;
    };
  }, [applied, page]);

  const patch = useCallback(
    (changes: Partial<FilterableExpenseQuery>): void => {
      setDraft((previous): FilterableExpenseQuery => ({
        ...previous,
        ...changes,
      }));
    },
    [],
  );

  const handleSubmit = useCallback((): void => {
    const problem = readQueryProblem(draft);

    setFormError(problem);

    if (problem) {
      return;
    }

    setApplied(draft);
    setPage(1);
  }, [draft]);

  const handleReset = useCallback((): void => {
    setDraft(EMPTY_FILTERABLE_EXPENSE_QUERY);
    setApplied(EMPTY_FILTERABLE_EXPENSE_QUERY);
    setFormError(null);
    setPage(1);
    setResetCount((count) => count + 1);
  }, []);

  const columns = useMemo(
    (): TableColumn<ExampleRow>[] => [
      { dataIndex: 'title', key: 'title', title: '案件' },
      { dataIndex: 'vendorLabel', key: 'vendorLabel', title: '廠商' },
      { dataIndex: 'amountText', key: 'amountText', title: '金額（TWD）' },
      { dataIndex: 'applyDate', key: 'applyDate', title: '申請日' },
      {
        key: 'state',
        render: (row: ExampleRow): ReactElement => (
          <Badge
            text={STATE_BADGE[row.state].label}
            variant={STATE_BADGE[row.state].variant}
          />
        ),
        title: '狀態',
      },
      { dataIndex: 'startedAt', key: 'startedAt', title: '送出時間' },
      { dataIndex: 'completedAt', key: 'completedAt', title: '完成時間' },
    ],
    [],
  );

  const tableActions = useMemo(
    (): TableActions<ExampleRow> => ({
      render: () => [
        {
          name: '查看',
          onClick: (row: ExampleRow): void => {
            router.push(routes.caseDetail(row.id));
          },
          type: 'button',
        },
      ],
      title: '操作',
    }),
    [router, routes],
  );

  const visibleError = error ?? formError;

  return (
    <div className={styles.page}>
      <PageHeader>
        <ContentHeader
          description="依請款申請的表單欄位篩選案件（ADR 25）。"
          title="欄位篩選示範"
        />
      </PageHeader>

      <FilterArea
        onReset={handleReset}
        onSubmit={handleSubmit}
        resetText="清除條件"
        size="main"
        submitText="重新查詢"
      >
        <FilterLine>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="廠商"
              name="vendor"
            >
              <Select
                clearable
                fullWidth
                mode="multiple"
                onChange={(options: readonly SelectChoice[]): void => {
                  patch({ vendorIds: options.map((option) => option.id) });
                }}
                options={[...VENDOR_CHOICES]}
                placeholder="全部廠商"
                value={VENDOR_CHOICES.filter((choice) =>
                  draft.vendorIds.includes(choice.id),
                )}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="廠商名稱（包含）"
              name="vendorName"
            >
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ vendorName: event.target.value });
                }}
                placeholder="輸入廠商名稱片段"
                value={draft.vendorName}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="公司別"
              name="companyCode"
            >
              <Select
                clearable
                fullWidth
                onChange={(option: SelectChoice | null): void => {
                  patch({ companyCode: option?.id ?? '' });
                }}
                options={[...COMPANY_CHOICES]}
                placeholder="全部公司"
                value={findChoice(COMPANY_OPTIONS, draft.companyCode)}
              />
            </FormField>
          </Filter>
        </FilterLine>

        <FilterLine>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="金額最小值（TWD）"
              name="amountFrom"
            >
              <Input
                fullWidth
                min={0}
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ amountFrom: event.target.value });
                }}
                placeholder="例如 10000"
                inputType="number"
                value={draft.amountFrom}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="金額最大值（TWD）"
              name="amountTo"
            >
              <Input
                fullWidth
                min={0}
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ amountTo: event.target.value });
                }}
                placeholder="例如 500000"
                inputType="number"
                value={draft.amountTo}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="申請日區間"
              name="applyDate"
            >
              <DateRangePicker
                key={resetCount}
                clearable
                fullWidth
                inputFromPlaceholder="起日"
                inputToPlaceholder="迄日"
                onChange={(target?: readonly (string | undefined)[]): void => {
                  patch({
                    applyDateFrom: formatDatePickerValue(target?.[0]) ?? '',
                    applyDateTo: formatDatePickerValue(target?.[1]) ?? '',
                  });
                }}
                value={
                  draft.applyDateFrom && draft.applyDateTo
                    ? [draft.applyDateFrom, draft.applyDateTo]
                    : []
                }
              />
            </FormField>
          </Filter>
        </FilterLine>

        <FilterLine>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="請款類型"
              name="requestType"
            >
              <Select
                clearable
                fullWidth
                mode="multiple"
                onChange={(options: readonly SelectChoice[]): void => {
                  patch({
                    requestTypes: options.map((option) => option.id),
                  });
                }}
                options={[...REQUEST_TYPE_CHOICES]}
                placeholder="全部類型"
                value={REQUEST_TYPE_CHOICES.filter((choice) =>
                  draft.requestTypes.includes(choice.id),
                )}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="需求部門"
              name="demandDept"
            >
              <Select
                clearable
                fullWidth
                onChange={(option: SelectChoice | null): void => {
                  patch({ departmentId: option?.id ?? '' });
                }}
                options={[...DEPARTMENT_CHOICES]}
                placeholder="全部部門"
                value={findChoice(DEPARTMENT_OPTIONS, draft.departmentId)}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="品項品號"
              name="sku"
            >
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ sku: event.target.value });
                }}
                placeholder="例如 SKU-A"
                value={draft.sku}
              />
            </FormField>
          </Filter>
        </FilterLine>

        <FilterLine>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="品項數量最小值"
              name="qtyFrom"
            >
              <Input
                fullWidth
                min={0}
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ qtyFrom: event.target.value });
                }}
                placeholder="例如 1"
                inputType="number"
                value={draft.qtyFrom}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="品項數量最大值"
              name="qtyTo"
            >
              <Input
                fullWidth
                min={0}
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({ qtyTo: event.target.value });
                }}
                placeholder="例如 20"
                inputType="number"
                value={draft.qtyTo}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="案件狀態"
              name="state"
            >
              <Select
                clearable
                fullWidth
                onChange={(option: SelectChoice | null): void => {
                  patch({
                    state: option ? (option.id as ApprovalInstanceState) : null,
                  });
                }}
                options={[...STATE_CHOICES]}
                placeholder="全部狀態"
                value={
                  draft.state
                    ? { id: draft.state, name: STATE_BADGE[draft.state].label }
                    : null
                }
              />
            </FormField>
          </Filter>
        </FilterLine>

        <FilterLine>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="排序欄位"
              name="sortField"
            >
              <Select
                fullWidth
                onChange={(option: SelectChoice | null): void => {
                  patch({ sortField: option?.id ?? DEFAULT_SORT_FIELD });
                }}
                options={[...SORT_FIELD_CHOICES]}
                value={findChoice(SORT_FIELD_OPTIONS, draft.sortField)}
              />
            </FormField>
          </Filter>
          <Filter>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              label="排序方向"
              name="sortDirection"
            >
              <RadioGroup
                name="sortDirection"
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  patch({
                    sortDirection:
                      event.target.value === 'ASC' ? 'ASC' : 'DESC',
                  });
                }}
                options={[...SORT_DIRECTION_OPTIONS]}
                type="segment"
                value={draft.sortDirection}
              />
            </FormField>
          </Filter>
        </FilterLine>
      </FilterArea>

      <div className={styles.body}>
        {visibleError ? (
          <InlineMessage content={visibleError} severity="error" />
        ) : null}
        <Typography color="text-neutral" variant="body">
          共 {total} 筆案件
        </Typography>
        <Table
          actions={tableActions}
          columns={columns}
          dataSource={[...rows]}
          emptyProps={{
            description: '調整篩選條件後重新查詢。',
            title: '沒有符合條件的案件',
          }}
          fullWidth
          loading={loading}
        />
        <Pagination
          current={page}
          onChange={(nextPage: number): void => {
            setPage(nextPage);
          }}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </div>
    </div>
  );
}
