import type {
  ApprovalInstanceFieldFilter,
  ApprovalInstanceSort,
  ApprovalInstanceSortDirection,
} from '@rytass/bpm-core-shared';
import type { ApprovalInstanceState } from '@rytass/bpm-core-client/workflow';

/** 送出查詢時使用的條件；畫面草稿與此同形，按下「重新查詢」才套用。 */
export interface FilterableExpenseQuery {
  readonly vendorIds: readonly string[];
  readonly vendorName: string;
  readonly amountFrom: string;
  readonly amountTo: string;
  readonly applyDateFrom: string;
  readonly applyDateTo: string;
  readonly companyCode: string;
  readonly requestTypes: readonly string[];
  readonly departmentId: string;
  readonly sku: string;
  readonly qtyFrom: string;
  readonly qtyTo: string;
  readonly state: ApprovalInstanceState | null;
  readonly sortField: string;
  readonly sortDirection: ApprovalInstanceSortDirection;
}

export const DEFAULT_SORT_FIELD = 'submittedAt';

export const EMPTY_FILTERABLE_EXPENSE_QUERY: FilterableExpenseQuery = {
  amountFrom: '',
  amountTo: '',
  applyDateFrom: '',
  applyDateTo: '',
  companyCode: '',
  departmentId: '',
  qtyFrom: '',
  qtyTo: '',
  requestTypes: [],
  sku: '',
  sortDirection: 'DESC',
  sortField: DEFAULT_SORT_FIELD,
  state: null,
  vendorIds: [],
  vendorName: '',
};

function readText(value: string): string {
  return value.trim();
}

/** 單一值條件（EQUALS）；空字串代表不設條件。 */
function equalsFilter(
  fieldKey: string,
  value: string,
): readonly ApprovalInstanceFieldFilter[] {
  const text = readText(value);

  return text
    ? [{ fieldKey, operator: 'EQUALS', values: [text] }]
    : [];
}

/** 多值條件（IN）；清單為空時不設條件。 */
function inFilter(
  fieldKey: string,
  values: readonly string[],
): readonly ApprovalInstanceFieldFilter[] {
  return values.length > 0
    ? [{ fieldKey, operator: 'IN', values: [...values] }]
    : [];
}

/** 區間條件（RANGE）；兩端皆空時不設條件，單端留空表示不設該端。 */
function rangeFilter(
  fieldKey: string,
  from: string,
  to: string,
): readonly ApprovalInstanceFieldFilter[] {
  const lower = readText(from);
  const upper = readText(to);

  if (!lower && !upper) {
    return [];
  }

  return [
    {
      fieldKey,
      operator: 'RANGE',
      ...(lower ? { from: lower } : {}),
      ...(upper ? { to: upper } : {}),
    },
  ];
}

/**
 * 把查詢草稿轉成 SDK 的 fieldFilters（ADR 25 §7）。
 * 廠商名稱以 CONTAINS 比對資料來源的 label，與廠商 id 的 IN 條件並存。
 */
export function buildFieldFilters(
  query: FilterableExpenseQuery,
): readonly ApprovalInstanceFieldFilter[] {
  const vendorName = readText(query.vendorName);

  return [
    ...inFilter('vendor', query.vendorIds),
    ...(vendorName
      ? [
          {
            fieldKey: 'vendor',
            operator: 'CONTAINS',
            values: [vendorName],
          } satisfies ApprovalInstanceFieldFilter,
        ]
      : []),
    ...rangeFilter('amountTwd', query.amountFrom, query.amountTo),
    ...rangeFilter('applyDate', query.applyDateFrom, query.applyDateTo),
    ...equalsFilter('companyCode', query.companyCode),
    ...inFilter('requestType', query.requestTypes),
    ...equalsFilter('demandDept', query.departmentId),
    ...equalsFilter('items.sku', query.sku),
    ...rangeFilter('items.qty', query.qtyFrom, query.qtyTo),
  ];
}

/** 排序欄位可以是表單欄位（applyDate、amountTwd）或時間欄位（submittedAt 等）。 */
export function buildSort(
  query: FilterableExpenseQuery,
): readonly ApprovalInstanceSort[] {
  return [{ direction: query.sortDirection, field: query.sortField }];
}

/**
 * 送出前的草稿檢查：區間的下限不可大於上限。
 * 回傳第一個錯誤訊息，沒有錯誤時回傳 null。
 */
export function readQueryProblem(query: FilterableExpenseQuery): string | null {
  const pairs: readonly [string, string, string][] = [
    ['金額', query.amountFrom, query.amountTo],
    ['數量', query.qtyFrom, query.qtyTo],
  ];

  const numericProblem = pairs.find(
    ([, from, to]) =>
      readText(from) !== '' &&
      readText(to) !== '' &&
      Number(from) > Number(to),
  );

  if (numericProblem) {
    return `${numericProblem[0]}的最小值不可大於最大值。`;
  }

  if (
    readText(query.applyDateFrom) &&
    readText(query.applyDateTo) &&
    readText(query.applyDateFrom) > readText(query.applyDateTo)
  ) {
    return '申請日的起日不可晚於迄日。';
  }

  return null;
}
