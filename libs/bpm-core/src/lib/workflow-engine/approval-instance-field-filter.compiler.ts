import { BadRequestException } from '@nestjs/common';
import {
  type ApprovalInstanceFieldFilter,
  type ApprovalInstanceFieldFilterOperator,
  type ApprovalInstanceSort,
  type ApprovalInstanceSortDirection,
  type FilterableFieldPath,
  isApprovalInstanceSortTimeField,
  isCanonicalDate,
  isFilterableFieldSortable,
  readFilterOperatorsForFieldType,
} from '@rytass/bpm-core-shared';
import {
  type FormDefinitionSchema,
  type FormFieldDefinition,
  type FormFieldOption,
  isFormStaticOptionFieldDefinition,
  isTableFieldDefinition,
} from '@rytass/bpm-core-shared/form';

/**
 * Compiles the list query's field filters and sort into SQL fragments for the
 * approval-instance query builder (ADR 25 §7). Internal: not exported from the
 * library's public index, and free of TypeORM so it can be tested as plain
 * input and output.
 *
 * Every value reaches the database as a named parameter. The SQL text holds
 * only the table alias, column names and parameter placeholders; a field key
 * is a parameter too, so no key is ever spliced into the statement.
 */

type SqlParameters = Readonly<Record<string, unknown>>;

export interface CompiledSqlFragment {
  readonly sql: string;
  readonly parameters: SqlParameters;
}

export interface CompiledApprovalInstanceOrder extends CompiledSqlFragment {
  readonly direction: ApprovalInstanceSortDirection;
}

export interface CompiledApprovalInstanceFieldFilters {
  /** One WHERE clause each, to be combined with AND. */
  readonly conditions: readonly CompiledSqlFragment[];
  /** Always ends with the `id` tie-breaker (ADR 25 §7.6). */
  readonly orderBy: readonly CompiledApprovalInstanceOrder[];
}

export interface CompileApprovalInstanceFieldFiltersInput {
  /** The TypeORM alias of `approval_instances` in the query, e.g. `approvalInstance`. */
  readonly alias: string;
  /** The filterable fields of the template's current version. */
  readonly paths: readonly FilterableFieldPath[];
  readonly fieldFilters: readonly ApprovalInstanceFieldFilter[];
  readonly sort: readonly ApprovalInstanceSort[];
  /**
   * Static option lists by field path, across the current version and every
   * historical version that holds instances. A CONTAINS on a static option
   * matches its names against these lists.
   */
  readonly staticOptionsByPath: ReadonlyMap<string, readonly FormFieldOption[]>;
}

type ValueKind = FilterableFieldPath['kind'];

interface NormalizedFilter {
  readonly path: FilterableFieldPath;
  readonly operator: ApprovalInstanceFieldFilterOperator;
  readonly value: string | null;
  readonly values: readonly string[];
  readonly from: string | null;
  readonly to: string | null;
}

interface IndexedFilter {
  readonly index: number;
  readonly filter: NormalizedFilter;
}

/** One stored value to compare: a top-level field, or a column of a table row. */
interface FilterTarget {
  /** Prefix of this condition's parameters, e.g. `ff0`. */
  readonly prefix: string;
  /** The stored value as jsonb. */
  readonly json: string;
  /** The same value as text (`->>`). */
  readonly text: string;
  /** Top-level only: the form data column and the field's key in it. */
  readonly formData: { readonly column: string; readonly key: string } | null;
  /** Top-level data-source fields only: the option snapshot column. */
  readonly optionSnapshot: string | null;
  /** Stored values of the static options whose names match a CONTAINS. */
  readonly labelValues: readonly string[];
  readonly parameters: SqlParameters;
}

const DEFAULT_DIRECTION: ApprovalInstanceSortDirection = 'DESC';

/** Limits on one list request; past them the query is refused, not truncated. */
const MAX_FIELD_FILTERS = 20;
const MAX_SORT_KEYS = 5;

const SORT_TIME_COLUMNS = {
  submittedAt: 'started_at',
  updatedAt: 'updated_at',
  completedAt: 'completed_at',
} as const;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/u;
const DATETIME_INPUT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u;
const DATE_TEXT_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const DATETIME_TEXT_PATTERN =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

/** The rejection for any field the template does not declare filterable (ADR 25 §7.1). */
const NOT_FILTERABLE_MESSAGE = '這個欄位不能用來篩選';
/** One message for every unusable sort key, so the answer reveals nothing about the form. */
const NOT_SORTABLE_MESSAGE = '這個欄位不能用來排序';

export class ApprovalInstanceFieldFilterCompiler {
  compile(
    input: CompileApprovalInstanceFieldFiltersInput,
  ): CompiledApprovalInstanceFieldFilters {
    if (input.fieldFilters.length > MAX_FIELD_FILTERS) {
      throw new BadRequestException(`篩選條件最多 ${MAX_FIELD_FILTERS} 個`);
    }

    if (input.sort.length > MAX_SORT_KEYS) {
      throw new BadRequestException(`排序條件最多 ${MAX_SORT_KEYS} 個`);
    }

    const alias = `"${input.alias}"`;
    const filters = input.fieldFilters.map((filter, index): IndexedFilter => ({
      filter: normalizeFilter(filter, input.paths),
      index,
    }));
    const topLevel = filters
      .filter(({ filter }) => filter.path.tableKey === null)
      .map((item) => compileTopLevelCondition(alias, item, input));
    // Conditions on one table share a row subquery: they must hold in the same row.
    const tables = groupByTable(filters).map((group, groupIndex) =>
      compileTableCondition(alias, group, groupIndex, input),
    );

    return {
      conditions: [...topLevel, ...tables],
      orderBy: compileOrderBy(alias, input),
    };
  }
}

/**
 * The static option lists of a set of form schemas, by field path. A table
 * column is keyed `<tableKey>.<columnKey>`, the way the query names it.
 */
export function readStaticOptionsByPath(
  schemas: readonly (FormDefinitionSchema | null | undefined)[],
): ReadonlyMap<string, readonly FormFieldOption[]> {
  const grouped = new Map<string, readonly FormFieldOption[]>();
  const add = (path: string, options: readonly FormFieldOption[]): void => {
    grouped.set(path, [...(grouped.get(path) ?? []), ...options]);
  };

  schemas.forEach((schema) => {
    if (!schema || !Array.isArray(schema.fields)) {
      return;
    }

    schema.fields.forEach((field) => {
      if (isTableFieldDefinition(field)) {
        field.columns.forEach((column) => {
          const asField = column as FormFieldDefinition;

          if (isFormStaticOptionFieldDefinition(asField)) {
            add(`${field.fieldKey}.${column.fieldKey}`, asField.options);
          }
        });

        return;
      }

      if (isFormStaticOptionFieldDefinition(field)) {
        add(field.fieldKey, field.options);
      }
    });
  });

  return grouped;
}

function normalizeFilter(
  filter: ApprovalInstanceFieldFilter,
  paths: readonly FilterableFieldPath[],
): NormalizedFilter {
  const path = paths.find((item) => item.path === filter.fieldKey);

  if (!path) {
    throw new BadRequestException(NOT_FILTERABLE_MESSAGE);
  }

  if (
    !readFilterOperatorsForFieldType(path.field.type).includes(filter.operator)
  ) {
    throw new BadRequestException(
      `欄位「${path.label}」不能使用 ${filter.operator} 條件篩選`,
    );
  }

  const invalid = (detail: string): BadRequestException =>
    new BadRequestException(`欄位「${path.label}」的篩選值不正確：${detail}`);
  const normalize = (raw: string): string =>
    normalizeValue(path.kind, raw, invalid);

  switch (filter.operator) {
    case 'EQUALS':
    case 'NOT_EQUALS':
    case 'CONTAINS': {
      const raw = filter.values?.[0];

      if (!raw) {
        throw invalid('需要一個值');
      }

      return emptyFilter(path, filter.operator, { value: normalize(raw) });
    }
    case 'IN': {
      const raws = filter.values ?? [];

      if (raws.length === 0 || raws.some((raw) => raw === '')) {
        throw invalid('需要至少一個值，且不可為空字串');
      }

      return emptyFilter(path, filter.operator, {
        values: raws.map(normalize),
      });
    }
    case 'RANGE': {
      if (!filter.from && !filter.to) {
        throw invalid('需要下界或上界');
      }

      return emptyFilter(path, filter.operator, {
        from: filter.from ? normalize(filter.from) : null,
        to: filter.to ? normalize(filter.to) : null,
      });
    }
  }
}

function emptyFilter(
  path: FilterableFieldPath,
  operator: ApprovalInstanceFieldFilterOperator,
  overrides: Partial<
    Pick<NormalizedFilter, 'from' | 'to' | 'value' | 'values'>
  >,
): NormalizedFilter {
  return {
    from: null,
    operator,
    path,
    to: null,
    value: null,
    values: [],
    ...overrides,
  };
}

/**
 * A filter value in its stored format (ADR 25 §6). A value that cannot be
 * written in that format is refused rather than guessed at. A datetime must
 * carry an explicit offset, so the server's own time zone never decides what
 * it means; it is then stored as `toISOString()`.
 */
function normalizeValue(
  kind: ValueKind,
  raw: string,
  invalid: (detail: string) => BadRequestException,
): string {
  // PostgreSQL text and jsonb cannot hold U+0000: such a value would fail in
  // the database as a 500 instead of being refused here.
  if (raw.includes('\u0000')) {
    throw invalid('不能包含 NUL 字元');
  }

  switch (kind) {
    case 'number':
      if (!DECIMAL_PATTERN.test(raw)) {
        throw invalid('需要十進位數字');
      }

      return raw;
    case 'date':
      if (!isCanonicalDate(raw)) {
        throw invalid('需要 YYYY-MM-DD 格式的日期');
      }

      return raw;
    case 'datetime': {
      const time = DATETIME_INPUT_PATTERN.test(raw) ? Date.parse(raw) : NaN;

      if (!Number.isFinite(time)) {
        throw invalid('需要含時區的 ISO 8601 時間，例如 2026-11-03T08:30:00Z');
      }

      return new Date(time).toISOString();
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') {
        throw invalid('需要 true 或 false');
      }

      return raw;
    default:
      return raw;
  }
}

function compileTopLevelCondition(
  alias: string,
  item: IndexedFilter,
  input: CompileApprovalInstanceFieldFiltersInput,
): CompiledSqlFragment {
  const target = createTarget({
    alias,
    path: item.filter.path,
    prefix: `ff${item.index}`,
    rowAlias: null,
    staticOptionsByPath: input.staticOptionsByPath,
    filter: item.filter,
  });

  return compilePredicate(target, item.filter);
}

interface TableGroup {
  readonly tableKey: string;
  readonly items: readonly IndexedFilter[];
}

function groupByTable(
  filters: readonly IndexedFilter[],
): readonly TableGroup[] {
  const tableKeys = [
    ...new Set(
      filters
        .map(({ filter }) => filter.path.tableKey)
        .filter((key): key is string => key !== null),
    ),
  ];

  return tableKeys.map((tableKey) => ({
    items: filters.filter(({ filter }) => filter.path.tableKey === tableKey),
    tableKey,
  }));
}

/**
 * "Some row of the table satisfies every condition on it" (ADR 25 §7.4): one
 * EXISTS over the rows, with all the table's conditions inside it.
 */
function compileTableCondition(
  alias: string,
  group: TableGroup,
  groupIndex: number,
  input: CompileApprovalInstanceFieldFiltersInput,
): CompiledSqlFragment {
  const rowAlias = `ffrow${groupIndex}`;
  const tableParameter = `${rowAlias}_tk`;
  const predicates = group.items.map((item) =>
    compilePredicate(
      createTarget({
        alias,
        filter: item.filter,
        path: item.filter.path,
        prefix: `ff${item.index}`,
        rowAlias,
        staticOptionsByPath: input.staticOptionsByPath,
      }),
      item.filter,
    ),
  );
  const rows = `CASE WHEN jsonb_typeof(${alias}."form_data" -> :${tableParameter}) = 'array' THEN ${alias}."form_data" -> :${tableParameter} ELSE CAST('[]' AS jsonb) END`;

  return {
    parameters: mergeParameters([
      { [tableParameter]: group.tableKey },
      ...predicates.map((predicate) => predicate.parameters),
    ]),
    sql: `EXISTS (SELECT 1 FROM jsonb_array_elements(${rows}) ${rowAlias} WHERE ${predicates
      .map((predicate) => predicate.sql)
      .join(' AND ')})`,
  };
}

function createTarget(input: {
  readonly alias: string;
  readonly filter: NormalizedFilter;
  readonly path: FilterableFieldPath;
  readonly prefix: string;
  /** The row alias for a table column; `null` for a top-level field. */
  readonly rowAlias: string | null;
  readonly staticOptionsByPath: ReadonlyMap<string, readonly FormFieldOption[]>;
}): FilterTarget {
  const { alias, filter, path, prefix, rowAlias, staticOptionsByPath } = input;
  const keyParameter = `${prefix}_key`;
  const labelValues = labelValuesFor(filter, staticOptionsByPath);

  if (rowAlias === null) {
    const column = `${alias}."form_data"`;

    return {
      formData: { column, key: path.key },
      json: `(${column} -> :${keyParameter})`,
      labelValues,
      optionSnapshot: path.usesOptionSnapshot
        ? `${alias}."form_data_option_snapshot"`
        : null,
      parameters: { [keyParameter]: path.key },
      prefix,
      text: `(${column} ->> :${keyParameter})`,
    };
  }

  return {
    formData: null,
    json: `(${rowAlias} -> :${keyParameter})`,
    labelValues,
    optionSnapshot: null,
    parameters: { [keyParameter]: path.key },
    prefix,
    text: `(${rowAlias} ->> :${keyParameter})`,
  };
}

/** The stored values whose option name contains the CONTAINS text. */
function labelValuesFor(
  filter: NormalizedFilter,
  staticOptionsByPath: ReadonlyMap<string, readonly FormFieldOption[]>,
): readonly string[] {
  if (
    filter.operator !== 'CONTAINS' ||
    filter.path.usesOptionSnapshot ||
    filter.value === null
  ) {
    return [];
  }

  const needle = filter.value.toLocaleLowerCase();

  return (staticOptionsByPath.get(filter.path.path) ?? [])
    .filter((option) => option.label.toLocaleLowerCase().includes(needle))
    .map((option) => option.value);
}

/**
 * One condition on one target. The target's own key parameter is part of the
 * SQL it emits, so it travels with the predicate.
 */
function compilePredicate(
  target: FilterTarget,
  filter: NormalizedFilter,
): CompiledSqlFragment {
  const predicate = compileOperator(target, filter);

  return {
    parameters: referencedParameters(
      mergeParameters([target.parameters, predicate.parameters]),
      predicate.sql,
    ),
    sql: predicate.sql,
  };
}

/** Only the parameters the SQL text names. A key the containment form embeds is not one of them. */
function referencedParameters(
  parameters: SqlParameters,
  sql: string,
): SqlParameters {
  return Object.fromEntries(
    Object.entries(parameters).filter(([name]) =>
      new RegExp(`:${name}(?![A-Za-z0-9_])`, 'u').test(sql),
    ),
  );
}

function compileOperator(
  target: FilterTarget,
  filter: NormalizedFilter,
): CompiledSqlFragment {
  const kind = filter.path.kind;

  switch (filter.operator) {
    case 'EQUALS':
    case 'IN':
      return equalsAny(
        target,
        kind,
        filter.values.length > 0 ? filter.values : [filter.value ?? ''],
      );
    case 'NOT_EQUALS': {
      const equal = equalsAny(target, kind, [filter.value ?? '']);

      // "No stored value equals it", and a field with no value matches no condition.
      return {
        parameters: equal.parameters,
        sql: `(${hasValueSql(target.json)} AND NOT (${equal.sql}))`,
      };
    }
    case 'RANGE':
      return rangePredicate(target, kind, filter.from, filter.to);
    case 'CONTAINS':
      return containsPredicate(target, kind, filter.value ?? '');
  }
}

/**
 * Matches any of `values`. On a top-level field, string-like values go through
 * the form data containment operator, which the GIN index serves (ADR 25 §4.1).
 * A table cell is compared directly.
 */
function equalsAny(
  target: FilterTarget,
  kind: ValueKind,
  values: readonly string[],
): CompiledSqlFragment {
  const parts = values.map((value, valueIndex) =>
    equalsOne(target, kind, value, valueIndex),
  );

  return {
    parameters: mergeParameters(parts.map((part) => part.parameters)),
    sql: `(${parts.map((part) => part.sql).join(' OR ')})`,
  };
}

function equalsOne(
  target: FilterTarget,
  kind: ValueKind,
  value: string,
  valueIndex: number,
): CompiledSqlFragment {
  const name = `${target.prefix}_v${valueIndex}`;

  if (kind === 'number') {
    return {
      parameters: { [name]: value },
      sql: `${numericSql(target)} = CAST(:${name} AS numeric)`,
    };
  }

  // An option or member value is stored as a string or as a list of strings
  // (`multiple`), and both shapes match.
  const multiShape = kind === 'option' || kind === 'member';

  const formData = target.formData;

  if (formData !== null) {
    const shapes: readonly unknown[] = multiShape
      ? [value, [value]]
      : [jsonScalar(kind, value)];
    const parts = shapes.map((shape, shapeIndex) => {
      const shapeName = `${name}_s${shapeIndex}`;

      return {
        parameters: {
          [shapeName]: JSON.stringify({ [formData.key]: shape }),
        },
        sql: `${formData.column} @> CAST(:${shapeName} AS jsonb)`,
      };
    });

    return {
      parameters: mergeParameters(parts.map((part) => part.parameters)),
      sql: `(${parts.map((part) => part.sql).join(' OR ')})`,
    };
  }

  if (multiShape) {
    return {
      parameters: { [name]: JSON.stringify([value]) },
      sql: `${storedArraySql(target.json)} @> CAST(:${name} AS jsonb)`,
    };
  }

  return {
    parameters: { [name]: JSON.stringify(jsonScalar(kind, value)) },
    sql: `${target.json} = CAST(:${name} AS jsonb)`,
  };
}

function jsonScalar(kind: ValueKind, value: string): string | boolean {
  return kind === 'boolean' ? value === 'true' : value;
}

function rangePredicate(
  target: FilterTarget,
  kind: ValueKind,
  from: string | null,
  to: string | null,
): CompiledSqlFragment {
  const isNumber = kind === 'number';
  // Dates and datetimes compare as text: their canonical forms sort in time
  // order. The pattern keeps any value outside that form out of the comparison.
  const pattern = kind === 'date' ? DATE_TEXT_PATTERN : DATETIME_TEXT_PATTERN;
  const patternName = `${target.prefix}_re`;
  const expression = isNumber
    ? numericSql(target)
    : stringSql(target, patternName);
  const bounds = [
    from !== null
      ? { name: `${target.prefix}_from`, operator: '>=', value: from }
      : null,
    to !== null
      ? { name: `${target.prefix}_to`, operator: '<=', value: to }
      : null,
  ].filter(isPresent);
  const operand = (name: string): string =>
    isNumber ? `CAST(:${name} AS numeric)` : `:${name}`;

  return {
    parameters: mergeParameters([
      isNumber ? {} : { [patternName]: pattern },
      Object.fromEntries(bounds.map((bound) => [bound.name, bound.value])),
    ]),
    sql: `(${bounds
      .map((bound) => `${expression} ${bound.operator} ${operand(bound.name)}`)
      .join(' AND ')})`,
  };
}

function containsPredicate(
  target: FilterTarget,
  kind: ValueKind,
  value: string,
): CompiledSqlFragment {
  const patternName = `${target.prefix}_pat`;
  const pattern = `%${escapeLikePattern(value)}%`;

  if (kind === 'text') {
    return {
      parameters: { [patternName]: pattern },
      sql: `(jsonb_typeof(${target.json}) = 'string' AND ${target.text} ILIKE :${patternName})`,
    };
  }

  // An option matches by its stored value and, where its name is known, by
  // its name: the option snapshot for a data-source field, the static option
  // lists otherwise.
  const valueMatch = `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${storedArraySql(target.json)}) ${target.prefix}v WHERE ${target.prefix}v ILIKE :${patternName})`;
  const snapshotMatch =
    target.optionSnapshot === null
      ? null
      : `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${target.optionSnapshot} -> :${target.prefix}_key -> 'options') = 'array' THEN ${target.optionSnapshot} -> :${target.prefix}_key -> 'options' ELSE CAST('[]' AS jsonb) END) ${target.prefix}o WHERE ${target.prefix}o ->> 'label' ILIKE :${patternName} AND ${storedArraySql(target.json)} @> jsonb_build_array(${target.prefix}o ->> 'value'))`;
  const labelMatches = target.labelValues.map((stored, labelIndex) => {
    const name = `${target.prefix}_l${labelIndex}`;

    return {
      parameters: { [name]: JSON.stringify([stored]) },
      sql: `${storedArraySql(target.json)} @> CAST(:${name} AS jsonb)`,
    };
  });
  const labelSql =
    labelMatches.length === 0
      ? []
      : [`(${labelMatches.map((match) => match.sql).join(' OR ')})`];

  return {
    parameters: mergeParameters([
      { [patternName]: pattern },
      ...labelMatches.map((match) => match.parameters),
    ]),
    sql: `(${[valueMatch, ...(snapshotMatch ? [snapshotMatch] : []), ...labelSql].join(' OR ')})`,
  };
}

function compileOrderBy(
  alias: string,
  input: CompileApprovalInstanceFieldFiltersInput,
): readonly CompiledApprovalInstanceOrder[] {
  const idColumn = `${alias}."id"`;

  if (input.sort.length === 0) {
    return [
      { direction: 'DESC', parameters: {}, sql: `${alias}."created_at"` },
      { direction: 'DESC', parameters: {}, sql: idColumn },
    ];
  }

  const orders = input.sort.map(
    (sort, index): CompiledApprovalInstanceOrder => {
      const direction = sort.direction ?? DEFAULT_DIRECTION;

      if (isApprovalInstanceSortTimeField(sort.field)) {
        return {
          direction,
          parameters: {},
          sql: `${alias}."${SORT_TIME_COLUMNS[sort.field]}"`,
        };
      }

      const path = input.paths.find((item) => item.path === sort.field);

      if (!path || !isFilterableFieldSortable(path)) {
        throw new BadRequestException(NOT_SORTABLE_MESSAGE);
      }

      const target = createTarget({
        alias,
        filter: emptyFilter(path, 'EQUALS', {}),
        path,
        prefix: `fs${index}`,
        rowAlias: null,
        staticOptionsByPath: new Map(),
      });

      return { direction, ...compileSortKey(target, path.kind) };
    },
  );
  // The id breaks ties, in the direction of the last sort key.
  const lastDirection =
    orders[orders.length - 1]?.direction ?? DEFAULT_DIRECTION;

  return [
    ...orders,
    { direction: lastDirection, parameters: {}, sql: idColumn },
  ];
}

/**
 * The sort key of a top-level field: its value when the value has the
 * expected type, `NULL` otherwise, so a stray value sorts with the missing
 * ones instead of failing the query.
 */
function compileSortKey(
  target: FilterTarget,
  kind: ValueKind,
): CompiledSqlFragment {
  if (kind === 'number') {
    return { parameters: target.parameters, sql: numericSql(target) };
  }

  if (kind === 'date' || kind === 'datetime') {
    const pattern = kind === 'date' ? DATE_TEXT_PATTERN : DATETIME_TEXT_PATTERN;
    const patternName = `${target.prefix}_re`;

    return {
      parameters: { ...target.parameters, [patternName]: pattern },
      sql: stringSql(target, patternName),
    };
  }

  if (kind === 'boolean') {
    return {
      parameters: target.parameters,
      sql: `CASE WHEN jsonb_typeof(${target.json}) = 'boolean' THEN ${target.text} END`,
    };
  }

  return {
    parameters: target.parameters,
    sql: `CASE WHEN jsonb_typeof(${target.json}) = 'string' THEN ${target.text} END`,
  };
}

function numericSql(target: FilterTarget): string {
  return `CAST(CASE WHEN jsonb_typeof(${target.json}) = 'number' THEN ${target.text} END AS numeric)`;
}

function stringSql(target: FilterTarget, patternName: string): string {
  return `CASE WHEN jsonb_typeof(${target.json}) = 'string' AND ${target.text} ~ :${patternName} THEN ${target.text} END`;
}

/** The stored value as an array, so one containment test covers a string and a list. */
function storedArraySql(json: string): string {
  return `CASE WHEN jsonb_typeof(${json}) = 'array' THEN ${json} ELSE jsonb_build_array(${json}) END`;
}

/** Has a value: not missing, not `null`, not `""`, not `[]` (ADR 25 §5.4). */
function hasValueSql(json: string): string {
  return `(${json} IS NOT NULL AND ${json} NOT IN (CAST('null' AS jsonb), CAST('""' AS jsonb), CAST('[]' AS jsonb)))`;
}

/** The pattern for ILIKE: `%`, `_` and the escape character itself are escaped. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function mergeParameters(parts: readonly SqlParameters[]): SqlParameters {
  return parts.reduce<SqlParameters>(
    (merged, part) => ({ ...merged, ...part }),
    {},
  );
}
