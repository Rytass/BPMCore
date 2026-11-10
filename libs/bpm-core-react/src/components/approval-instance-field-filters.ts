import {
  APPROVAL_INSTANCE_SORT_TIME_FIELDS,
  isFilterableFieldSortable,
  type ApprovalInstanceFieldFilter,
  type ApprovalInstanceSort,
  type ApprovalInstanceSortDirection,
  type FilterableFieldPath,
  type FormFieldOption,
} from '@rytass/bpm-core-shared';

/**
 * Pure logic behind the list page's field filters (ADR 25 §7). Turns the
 * filterable fields of a template's schema into controls, and the control
 * values into `fieldFilters` and `sort` for `listApprovalInstancesPage`. The
 * operator for each control is one `readFilterOperatorsForFieldType` allows.
 */

/** Which control a filterable field gets on the list page. */
export type FieldFilterControl =
  /** Text, textarea and dynamic (data-source) options: CONTAINS on a text input. */
  | { readonly kind: 'contains' }
  /** Static options: IN on a multi-select. */
  | { readonly kind: 'option-in'; readonly options: readonly FormFieldOption[] }
  /** Member and org unit: IN on comma-separated ids (no picker yet). */
  | { readonly kind: 'id-in' }
  /** Number and money: RANGE with two number inputs. */
  | { readonly kind: 'number-range' }
  /** Date: RANGE with a date range picker. */
  | { readonly kind: 'date-range' }
  /** Datetime: RANGE with a datetime range picker. */
  | { readonly kind: 'datetime-range' }
  /** Boolean: EQUALS with a yes / no select. */
  | { readonly kind: 'boolean' };

export function readFieldFilterControl(
  item: FilterableFieldPath,
): FieldFilterControl {
  switch (item.kind) {
    case 'number':
      return { kind: 'number-range' };
    case 'date':
      return { kind: 'date-range' };
    case 'datetime':
      return { kind: 'datetime-range' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'member':
    case 'org_unit':
      return { kind: 'id-in' };
    case 'option':
      return item.staticOptions
        ? { kind: 'option-in', options: item.staticOptions }
        : { kind: 'contains' };
    case 'text':
      return { kind: 'contains' };
  }
}

/**
 * One field's entered condition. `from` and `to` hold canonical values
 * (decimal string, `YYYY-MM-DD`, or ISO 8601) as the controls produce them.
 */
export interface FieldFilterDraft {
  readonly from: string;
  readonly to: string;
  /** CONTAINS text, or comma-separated ids for IN on member and org unit. */
  readonly text: string;
  /** Selected option values (IN), or `['true']` / `['false']` for boolean. */
  readonly values: readonly string[];
}

export const EMPTY_FIELD_FILTER_DRAFT: FieldFilterDraft = {
  from: '',
  text: '',
  to: '',
  values: [],
};

/** Drafts keyed by the field path, so a path can be looked up directly. */
export type FieldFilterDrafts = Readonly<Record<string, FieldFilterDraft>>;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/u;

/**
 * Whether a number control's text is a decimal. Surrounding spaces and
 * thousands separators (`1,000`) are accepted and dropped before sending.
 */
export function isDecimalText(value: string): boolean {
  return readDecimal(value) !== null;
}

function readDecimal(value: string): string | null {
  const plain = value.trim().replace(/,/gu, '');

  return DECIMAL_PATTERN.test(plain) ? plain : null;
}

function readIdList(text: string): readonly string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * The condition one draft asks for, or `null` when it is empty. Empty means
 * no condition, so it must not reach the server as a filter.
 */
export function toApprovalInstanceFieldFilter(
  item: FilterableFieldPath,
  draft: FieldFilterDraft,
): ApprovalInstanceFieldFilter | null {
  const control = readFieldFilterControl(item);

  switch (control.kind) {
    case 'contains': {
      const text = draft.text.trim();

      return text
        ? { fieldKey: item.path, operator: 'CONTAINS', values: [text] }
        : null;
    }
    case 'option-in':
      return draft.values.length > 0
        ? { fieldKey: item.path, operator: 'IN', values: [...draft.values] }
        : null;
    case 'id-in': {
      const ids = readIdList(draft.text);

      return ids.length > 0
        ? { fieldKey: item.path, operator: 'IN', values: ids }
        : null;
    }
    case 'number-range': {
      const from = readDecimal(draft.from);
      const to = readDecimal(draft.to);

      return from || to
        ? {
            fieldKey: item.path,
            operator: 'RANGE',
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          }
        : null;
    }
    case 'date-range':
    case 'datetime-range': {
      const from = draft.from.trim();
      const to = draft.to.trim();

      return from || to
        ? {
            fieldKey: item.path,
            operator: 'RANGE',
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          }
        : null;
    }
    case 'boolean': {
      const value = draft.values[0];

      return value === 'true' || value === 'false'
        ? { fieldKey: item.path, operator: 'EQUALS', values: [value] }
        : null;
    }
  }
}

/** Every non-empty condition, in schema order. */
export function buildApprovalInstanceFieldFilters(
  paths: readonly FilterableFieldPath[],
  drafts: FieldFilterDrafts,
): readonly ApprovalInstanceFieldFilter[] {
  return paths.flatMap((item): readonly ApprovalInstanceFieldFilter[] => {
    const filter = toApprovalInstanceFieldFilter(
      item,
      drafts[item.path] ?? EMPTY_FIELD_FILTER_DRAFT,
    );

    return filter ? [filter] : [];
  });
}

/** The sort the user picked. An empty `field` keeps the server default. */
export interface SortDraft {
  readonly direction: ApprovalInstanceSortDirection;
  readonly field: string;
}

export const DEFAULT_SORT_DRAFT: SortDraft = { direction: 'DESC', field: '' };

export interface SortFieldOption {
  readonly id: string;
  readonly label: string;
}

export const DEFAULT_SORT_OPTION: SortFieldOption = {
  id: '',
  label: '預設（建立時間，新到舊）',
};

const SORT_TIME_LABELS: Readonly<
  Record<(typeof APPROVAL_INSTANCE_SORT_TIME_FIELDS)[number], string>
> = {
  completedAt: '完成時間',
  submittedAt: '送出時間',
  updatedAt: '最後更新',
};

/**
 * Sort choices. Time fields are always offered. Form fields are offered only
 * with a template selected, because the server needs a template to sort by a
 * form field.
 */
export function readSortFieldOptions(
  paths: readonly FilterableFieldPath[],
  templateSelected: boolean,
): readonly SortFieldOption[] {
  const timeOptions = APPROVAL_INSTANCE_SORT_TIME_FIELDS.map(
    (field): SortFieldOption => ({ id: field, label: SORT_TIME_LABELS[field] }),
  );
  const fieldOptions = templateSelected
    ? paths
        .filter(isFilterableFieldSortable)
        .map((item): SortFieldOption => ({ id: item.path, label: item.label }))
    : [];

  return [DEFAULT_SORT_OPTION, ...timeOptions, ...fieldOptions];
}

/** Whether a sort on `field` is valid for the current template selection. */
export function isSortFieldAvailable(
  field: string,
  paths: readonly FilterableFieldPath[],
  templateSelected: boolean,
): boolean {
  if (field === '') {
    return true;
  }

  if (
    (APPROVAL_INSTANCE_SORT_TIME_FIELDS as readonly string[]).includes(field)
  ) {
    return true;
  }

  return templateSelected && paths.some((item) => item.path === field);
}

export function toApprovalInstanceSort(
  draft: SortDraft,
): readonly ApprovalInstanceSort[] | undefined {
  return draft.field === ''
    ? undefined
    : [{ direction: draft.direction, field: draft.field }];
}
