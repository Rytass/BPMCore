import {
  type FormDefinitionSchema,
  type FormFieldDefinition,
  type FormFieldOption,
  type TableColumnDefinition,
  TABLE_COLUMN_FIELD_TYPES,
  isFormDataSourceFieldDefinition,
  isFormStaticOptionFieldDefinition,
  isTableFieldDefinition,
} from './form';

/**
 * Filtering and sorting the approval-instance list by form fields (ADR 25).
 *
 * Everything that decides "is this value right for a filterable field" lives
 * here so the write-time check, the enable-time scan of old instances, the
 * query compiler and the designer all answer the same way.
 */

/** Top-level field types a form designer may mark `filterable` (ADR 25 §5.2). */
export const FILTERABLE_FIELD_TYPES = [
  'autocomplete',
  'boolean',
  'checkbox',
  'date',
  'datetime',
  'member',
  'money',
  'number',
  'org_unit',
  'radio',
  'select',
  'text',
  'textarea',
] as const satisfies readonly FormFieldDefinition['type'][];

export type FilterableFieldType = (typeof FILTERABLE_FIELD_TYPES)[number];

/** Table column types a form designer may mark `filterable`: every column type. */
export const FILTERABLE_TABLE_COLUMN_TYPES: readonly TableColumnDefinition['type'][] =
  TABLE_COLUMN_FIELD_TYPES;

/**
 * Sort keys that are not form fields. A filterable field must not use one of
 * these as its `fieldKey`, or a sort request would be ambiguous.
 */
export const APPROVAL_INSTANCE_SORT_TIME_FIELDS = [
  'submittedAt',
  'updatedAt',
  'completedAt',
] as const;

export type ApprovalInstanceSortTimeField =
  (typeof APPROVAL_INSTANCE_SORT_TIME_FIELDS)[number];

export function isApprovalInstanceSortTimeField(
  value: string,
): value is ApprovalInstanceSortTimeField {
  return (APPROVAL_INSTANCE_SORT_TIME_FIELDS as readonly string[]).includes(
    value,
  );
}

export function isFilterableFieldType(
  type: FormFieldDefinition['type'],
  placement: 'column' | 'top-level' = 'top-level',
): boolean {
  return placement === 'column'
    ? (FILTERABLE_TABLE_COLUMN_TYPES as readonly string[]).includes(type)
    : (FILTERABLE_FIELD_TYPES as readonly string[]).includes(type);
}

export type ApprovalInstanceFieldFilterOperator =
  | 'CONTAINS'
  | 'EQUALS'
  | 'IN'
  | 'NOT_EQUALS'
  | 'RANGE';

export const APPROVAL_INSTANCE_FIELD_FILTER_OPERATORS: readonly ApprovalInstanceFieldFilterOperator[] =
  ['EQUALS', 'NOT_EQUALS', 'IN', 'RANGE', 'CONTAINS'];

export interface ApprovalInstanceFieldFilter {
  /** A top-level fieldKey, or `<tableKey>.<columnKey>` for a table column. */
  readonly fieldKey: string;
  readonly operator: ApprovalInstanceFieldFilterOperator;
  /** EQUALS, NOT_EQUALS and CONTAINS read the first value; IN reads them all. */
  readonly values?: readonly string[];
  /** RANGE lower bound, inclusive. Decimal string, `YYYY-MM-DD` or ISO 8601. */
  readonly from?: string;
  /** RANGE upper bound, inclusive. */
  readonly to?: string;
}

export type ApprovalInstanceSortDirection = 'ASC' | 'DESC';

export interface ApprovalInstanceSort {
  /** A top-level filterable fieldKey, or one of {@link APPROVAL_INSTANCE_SORT_TIME_FIELDS}. */
  readonly field: string;
  readonly direction?: ApprovalInstanceSortDirection;
}

/**
 * How a filterable value is stored and compared. Several field types share a
 * kind: `money` compares like `number`, and every option-like field compares
 * by its stored value.
 */
export type FilterableValueKind =
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'member'
  | 'number'
  | 'option'
  | 'org_unit'
  | 'text';

export function readFilterableValueKind(
  type: FormFieldDefinition['type'],
): FilterableValueKind | null {
  switch (type) {
    case 'text':
    case 'textarea':
      return 'text';
    case 'number':
    case 'money':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'boolean':
      return 'boolean';
    case 'select':
    case 'autocomplete':
    case 'radio':
    case 'checkbox':
      return 'option';
    case 'member':
      return 'member';
    case 'org_unit':
      return 'org_unit';
    default:
      return null;
  }
}

/** Operators a field type accepts (ADR 25 §7.2). */
export function readFilterOperatorsForFieldType(
  type: FormFieldDefinition['type'],
): readonly ApprovalInstanceFieldFilterOperator[] {
  if (type === 'textarea') {
    return ['CONTAINS'];
  }

  if (type === 'boolean') {
    return ['EQUALS'];
  }

  switch (readFilterableValueKind(type)) {
    case 'text':
      return ['EQUALS', 'NOT_EQUALS', 'IN', 'CONTAINS'];
    case 'number':
      return ['EQUALS', 'NOT_EQUALS', 'IN', 'RANGE'];
    case 'date':
    case 'datetime':
      return ['EQUALS', 'NOT_EQUALS', 'RANGE'];
    case 'option':
      return ['EQUALS', 'NOT_EQUALS', 'IN', 'CONTAINS'];
    case 'member':
    case 'org_unit':
      return ['EQUALS', 'NOT_EQUALS', 'IN'];
    default:
      return [];
  }
}

/** A filterable top-level field can be sorted on; a table column cannot (ADR 25 §7.5). */
export function isFilterableFieldSortable(path: FilterableFieldPath): boolean {
  return path.tableKey === null && path.field.type !== 'textarea';
}

/** One filterable field, top-level or table column, as the list query sees it. */
export interface FilterableFieldPath {
  /** `fieldKey`, or `<tableKey>.<columnKey>`. */
  readonly path: string;
  readonly tableKey: string | null;
  /** The key inside a row for a column; the fieldKey for a top-level field. */
  readonly key: string;
  readonly field: FormFieldDefinition | TableColumnDefinition;
  readonly kind: FilterableValueKind;
  readonly label: string;
  /** Static options and their labels; `null` for a data-source or non-option field. */
  readonly staticOptions: readonly FormFieldOption[] | null;
  /** Labels live in the instance's option snapshot (a top-level data-source field). */
  readonly usesOptionSnapshot: boolean;
}

/**
 * The fields of `schema` a list query may filter on: every field (or table
 * column) marked `filterable` whose type allows it. A field marked filterable
 * with a type that does not allow it is skipped here; the schema lint reports
 * it.
 */
export function readFilterableFieldPaths(
  schema: FormDefinitionSchema | null | undefined,
): readonly FilterableFieldPath[] {
  if (!schema || !Array.isArray(schema.fields)) {
    return [];
  }

  return schema.fields.flatMap((field): readonly FilterableFieldPath[] => {
    if (isTableFieldDefinition(field)) {
      const table = field;

      return table.columns
        .filter(
          (column) =>
            column.filterable === true &&
            isFilterableFieldType(column.type, 'column'),
        )
        .map((column) =>
          toFilterableFieldPath(column, table.fieldKey, table.label),
        );
    }

    return field.filterable === true && isFilterableFieldType(field.type)
      ? [toFilterableFieldPath(field, null, null)]
      : [];
  });
}

export function findFilterableFieldPath(
  schema: FormDefinitionSchema | null | undefined,
  path: string,
): FilterableFieldPath | null {
  return readFilterableFieldPaths(schema).find((item) => item.path === path) ?? null;
}

/**
 * Every field and column of a schema by path, filterable or not. The enable
 * check compares a new filterable field against what older versions stored
 * at the same path, whether or not they were filterable then.
 */
export function readFormFieldTypesByPath(
  schema: FormDefinitionSchema | null | undefined,
): ReadonlyMap<string, FormFieldDefinition['type']> {
  if (!schema || !Array.isArray(schema.fields)) {
    return new Map();
  }

  return new Map(
    schema.fields.flatMap((field): readonly (readonly [string, FormFieldDefinition['type']])[] =>
      isTableFieldDefinition(field)
        ? [
            [field.fieldKey, field.type],
            ...field.columns.map(
              (column): readonly [string, FormFieldDefinition['type']] => [
                `${field.fieldKey}.${column.fieldKey}`,
                column.type,
              ],
            ),
          ]
        : [[field.fieldKey, field.type]],
    ),
  );
}

function toFilterableFieldPath(
  field: FormFieldDefinition | TableColumnDefinition,
  tableKey: string | null,
  tableLabel: string | null,
): FilterableFieldPath {
  const asField = field as FormFieldDefinition;
  const staticOptions = isFormStaticOptionFieldDefinition(asField)
    ? asField.options
    : null;

  return {
    field,
    key: field.fieldKey,
    kind: readFilterableValueKind(field.type) ?? 'text',
    label: tableLabel
      ? `${tableLabel}／${field.label || field.fieldKey}`
      : field.label || field.fieldKey,
    path: tableKey ? `${tableKey}.${field.fieldKey}` : field.fieldKey,
    staticOptions,
    tableKey,
    usesOptionSnapshot:
      tableKey === null && isFormDataSourceFieldDefinition(asField),
  };
}

/**
 * The canonical stored formats (ADR 25 §6), matching what the form renderer
 * writes: `formatDatePickerValue` for a date, `Date#toISOString` for a
 * datetime, `Number(...)` for a number.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type FilterableValueCheck =
  | { readonly status: 'empty' }
  | { readonly status: 'valid' }
  | { readonly status: 'invalid'; readonly expected: string };

const EMPTY: FilterableValueCheck = { status: 'empty' };
const VALID: FilterableValueCheck = { status: 'valid' };

function invalid(expected: string): FilterableValueCheck {
  return { expected, status: 'invalid' };
}

/**
 * Whether one stored value fits a filterable field (ADR 25 §5.4, §6).
 *
 * - Missing and `null` are "no value". So is `""` for a number, money, date,
 *   datetime or boolean field (a cleared input), and `[]` for a multi-value
 *   field.
 * - An option or member field accepts a string or an array of strings either
 *   way: its `mode` / `multiple` may change between versions without changing
 *   its type, and the query matches both shapes.
 */
export function checkFilterableFieldValue(
  field: FormFieldDefinition | TableColumnDefinition,
  value: unknown,
): FilterableValueCheck {
  if (value === undefined || value === null) {
    return EMPTY;
  }

  switch (readFilterableValueKind(field.type)) {
    case 'text':
      return typeof value === 'string' ? VALID : invalid('文字');
    case 'number':
      if (value === '') {
        return EMPTY;
      }

      return typeof value === 'number' && Number.isFinite(value)
        ? VALID
        : invalid('數字');
    case 'date':
      if (value === '') {
        return EMPTY;
      }

      return isCanonicalDate(value) ? VALID : invalid('日期（YYYY-MM-DD）');
    case 'datetime':
      if (value === '') {
        return EMPTY;
      }

      return isCanonicalDateTime(value)
        ? VALID
        : invalid('日期時間（ISO 8601 UTC，例如 2026-11-03T08:30:00.000Z）');
    case 'boolean':
      if (value === '') {
        return EMPTY;
      }

      return typeof value === 'boolean' ? VALID : invalid('布林值（true 或 false）');
    case 'option':
    case 'member':
      return checkStringOrStringArray(value);
    case 'org_unit':
      return typeof value === 'string' ? VALID : invalid('組織單位 ID（文字）');
    default:
      return VALID;
  }
}

function checkStringOrStringArray(value: unknown): FilterableValueCheck {
  if (typeof value === 'string') {
    return VALID;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.length === 0 ? EMPTY : VALID;
  }

  return invalid('文字或文字清單');
}

export function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isCanonicalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    return false;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * A value inside a filterable path that does not fit its field. `path` is the
 * top-level fieldKey, `<tableKey>.<columnKey>` for a bad cell, or the bare
 * `tableKey` when the table itself (or one of its rows) is malformed.
 */
export interface FilterableValueProblem {
  readonly path: string;
  /** Index of the table row, or `null` for a top-level field. */
  readonly rowIndex: number | null;
  readonly value: unknown;
  readonly expected: string;
}

/**
 * Every value in `formData` that does not fit one of `paths`. Used both when
 * writing (refuse the write) and when enabling a field (refuse to enable while
 * old instances hold such values). A table that is not an array, or a row that
 * is not an object, is a problem of every filterable column in it.
 */
export function readFilterableValueProblems(
  paths: readonly FilterableFieldPath[],
  formData: Readonly<Record<string, unknown>> | null | undefined,
): readonly FilterableValueProblem[] {
  const data = formData ?? {};

  return paths.flatMap((item): readonly FilterableValueProblem[] => {
    if (item.tableKey === null) {
      const value = ownValue(data, item.key);
      const check = checkFilterableFieldValue(item.field, value);

      return check.status === 'invalid'
        ? [{ expected: check.expected, path: item.path, rowIndex: null, value }]
        : [];
    }

    const tableKey = item.tableKey;
    // A malformed table or row is one problem however many of its columns are
    // filterable, so only the table's first filterable column reports it.
    const reportsTable =
      paths.find((candidate) => candidate.tableKey === tableKey) === item;
    const rows = ownValue(data, tableKey);

    if (rows === undefined || rows === null) {
      return [];
    }

    if (!Array.isArray(rows)) {
      return reportsTable
        ? [{ expected: '表格列的清單', path: tableKey, rowIndex: null, value: rows }]
        : [];
    }

    return rows.flatMap((row, rowIndex): readonly FilterableValueProblem[] => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return reportsTable
          ? [{ expected: '物件', path: tableKey, rowIndex, value: row }]
          : [];
      }

      const value = ownValue(row as Readonly<Record<string, unknown>>, item.key);
      const check = checkFilterableFieldValue(item.field, value);

      return check.status === 'invalid'
        ? [{ expected: check.expected, path: item.path, rowIndex, value }]
        : [];
    });
  });
}

function ownValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

/** A field that would become filterable but whose history forbids it. */
export type FilterableFieldIssue =
  | {
      readonly kind: 'TYPE_CHANGED';
      readonly path: string;
      readonly label: string;
      readonly type: FormFieldDefinition['type'];
      /** Older versions, still holding instances, that stored another type here. */
      readonly conflicts: readonly {
        readonly versionNumber: number;
        readonly type: FormFieldDefinition['type'];
      }[];
    }
  | {
      readonly kind: 'INVALID_VALUES';
      readonly path: string;
      readonly label: string;
      readonly type: FormFieldDefinition['type'];
      readonly invalidInstanceCount: number;
      /**
       * The first few, for the message. The stored value is deliberately not
       * carried: the issue reaches designers who may not read the instance.
       */
      readonly samples: readonly {
        readonly instanceId: string;
        readonly rowIndex: number | null;
        readonly expected: string;
      }[];
    };

export const FILTERABLE_FIELD_ISSUE_SAMPLE_LIMIT = 5;

/**
 * The enable check (ADR 25 §5.4), pure: given the schema about to take effect,
 * the schemas of older versions that hold instances, and those instances'
 * form data, report every filterable field that may not be enabled.
 */
export function readFilterableFieldIssues(input: {
  readonly schema: FormDefinitionSchema | null | undefined;
  readonly history: readonly {
    readonly versionNumber: number;
    readonly schema: FormDefinitionSchema | null | undefined;
  }[];
  readonly instances: readonly {
    readonly id: string;
    readonly formData: Readonly<Record<string, unknown>> | null | undefined;
  }[];
}): readonly FilterableFieldIssue[] {
  const paths = readFilterableFieldPaths(input.schema);
  const historyTypes = input.history.map((version) => ({
    types: readFormFieldTypesByPath(version.schema),
    versionNumber: version.versionNumber,
  }));

  return paths.flatMap((item): readonly FilterableFieldIssue[] => {
    const conflicts = historyTypes
      .map((version) => ({
        type: version.types.get(item.path),
        versionNumber: version.versionNumber,
      }))
      .filter(
        (version): version is { readonly type: FormFieldDefinition['type']; readonly versionNumber: number } =>
          version.type !== undefined && version.type !== item.field.type,
      )
      .sort((left, right) => left.versionNumber - right.versionNumber);

    if (conflicts.length > 0) {
      return [
        {
          conflicts,
          kind: 'TYPE_CHANGED',
          label: item.label,
          path: item.path,
          type: item.field.type,
        },
      ];
    }

    const problems = input.instances.flatMap((instance) =>
      readFilterableValueProblems([item], instance.formData).map((problem) => ({
        expected: problem.expected,
        instanceId: instance.id,
        rowIndex: problem.rowIndex,
      })),
    );

    if (problems.length === 0) {
      return [];
    }

    return [
      {
        invalidInstanceCount: new Set(problems.map((problem) => problem.instanceId)).size,
        kind: 'INVALID_VALUES',
        label: item.label,
        path: item.path,
        samples: problems.slice(0, FILTERABLE_FIELD_ISSUE_SAMPLE_LIMIT),
        type: item.field.type,
      },
    ];
  });
}

/** One line per issue, in the words the designer and the publish error use. */
export function describeFilterableFieldIssue(issue: FilterableFieldIssue): string {
  if (issue.kind === 'TYPE_CHANGED') {
    const versions = issue.conflicts
      .map((conflict) => `v${conflict.versionNumber}（${conflict.type}）`)
      .join('、');

    return (
      `欄位「${issue.label}」（${issue.path}）無法啟用篩選：已有案件的舊版本 ${versions} ` +
      `在這個欄位存的是不同型別，現在是 ${issue.type}。請改用新的欄位 key 再勾選可篩選。`
    );
  }

  // The stored values are deliberately left out: a designer need not be able
  // to read the instances, and could otherwise read any key's values by
  // declaring it filterable. Instance ids and row numbers locate the problem.
  const samples = issue.samples
    .map(
      (sample) =>
        `${sample.instanceId}${sample.rowIndex === null ? '' : `（第 ${sample.rowIndex + 1} 列）`}`,
    )
    .join('、');

  return (
    `欄位「${issue.label}」（${issue.path}）無法啟用篩選：有 ${issue.invalidInstanceCount} 筆舊案件` +
    `的值不符合 ${issue.type} 型別（例如 ${samples}）。舊案件的值無法修改，請改用新的欄位 key 再勾選可篩選。`
  );
}
