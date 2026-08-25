import {
  DateFieldDefinition,
  FORM_TABLE_MAX_ROWS,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldValue,
  FormTableCellValue,
  FormTableRowValue,
  FormUiSchema,
  NumberFieldDefinition,
  FormStaticOptionFieldDefinition,
  TableColumnDefinition,
  TableFieldDefinition,
  isFormStaticOptionFieldDefinition,
  isFormTableCellValue,
  isFormTableRowValues,
  isTableFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export type ConditionOperator =
  | 'equals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'notEquals';

export type ParsedConditionRule = Readonly<{
  fieldKey: string;
  operator: ConditionOperator;
  value: string;
}>;

export type FormRendererValues = Readonly<
  Record<string, FormFieldValue | undefined>
>;

export interface FormRendererValidationResult {
  readonly errors: Readonly<Record<string, string>>;
  readonly firstInvalidFieldKey: string | null;
  readonly valid: boolean;
}

export function buildFormRendererValues(
  fields: readonly FormFieldDefinition[],
  currentValues: FormRendererValues,
): FormRendererValues {
  return fields.reduce<FormRendererValues>(
    (values, field) => ({
      ...values,
      [field.fieldKey]:
        typeof currentValues[field.fieldKey] === 'undefined'
          ? readInitialFormRendererValue(field)
          : currentValues[field.fieldKey],
    }),
    {},
  );
}

export function readVisibleFormRendererFields(
  schema: FormDefinitionSchema,
  uiSchema: FormUiSchema,
  values: FormRendererValues,
): readonly FormFieldDefinition[] {
  const fieldsByKey = new Map(
    schema.fields.map((field) => [field.fieldKey, field]),
  );
  const orderedFields = [
    ...uiSchema.layout
      .map((item) => fieldsByKey.get(item.fieldKey))
      .filter((field): field is FormFieldDefinition => Boolean(field)),
    ...schema.fields.filter(
      (field) =>
        !uiSchema.layout.some((item) => item.fieldKey === field.fieldKey),
    ),
  ];

  return orderedFields.filter((field) =>
    isFormRendererFieldVisible(field, schema.fields, values),
  );
}

export function validateFormRendererValues({
  schema,
  uiSchema,
  values,
}: {
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
  readonly values: FormRendererValues;
}): FormRendererValidationResult {
  const visibleFields = readVisibleFormRendererFields(schema, uiSchema, values);
  const errors = visibleFields.reduce<Readonly<Record<string, string>>>(
    (currentErrors, field) => ({
      ...currentErrors,
      ...readFormRendererFieldErrors(field, schema, values),
    }),
    {},
  );

  return {
    errors,
    firstInvalidFieldKey: readFirstInvalidFieldKey(visibleFields, errors),
    valid: Object.keys(errors).length === 0,
  };
}

function readFormRendererFieldErrors(
  field: FormFieldDefinition,
  schema: FormDefinitionSchema,
  values: FormRendererValues,
): Readonly<Record<string, string>> {
  const required = isFormRendererFieldRequired(field, schema.fields, values);

  if (isTableFieldDefinition(field)) {
    return readFormTableErrors(field, values[field.fieldKey], required);
  }

  return required && !isFormRendererFieldValuePresent(values[field.fieldKey])
    ? { [field.fieldKey]: `${field.label || field.fieldKey}為必填欄位。` }
    : {};
}

/**
 * Row bounds first, then per-row required columns. A wrong row count is fixed
 * by adding or deleting rows, so listing the cells of rows that should not
 * exist would only add noise (mirrors the backend order, ADR 16 §3.7).
 */
function readFormTableErrors(
  field: TableFieldDefinition,
  value: FormFieldValue | undefined,
  required: boolean,
): Readonly<Record<string, string>> {
  const rows = readFormTableRows(value);
  const bounds = readFormTableRowBounds(field);
  const minRows = required ? Math.max(bounds.minRows, 1) : bounds.minRows;
  const label = field.label || field.fieldKey;

  if (rows.length < minRows) {
    return { [field.fieldKey]: `${label}至少需要 ${minRows} 列。` };
  }

  if (rows.length > bounds.maxRows) {
    return { [field.fieldKey]: `${label}最多 ${bounds.maxRows} 列。` };
  }

  return rows.reduce<Readonly<Record<string, string>>>(
    (currentErrors, row, rowIndex) => ({
      ...currentErrors,
      ...readFormTableRowErrors(field, row, rowIndex),
    }),
    {},
  );
}

function readFormTableRowErrors(
  field: TableFieldDefinition,
  row: FormTableRowValue,
  rowIndex: number,
): Readonly<Record<string, string>> {
  return field.columns
    .filter(
      (column) =>
        column.required && !isFormRendererFieldValuePresent(row[column.fieldKey]),
    )
    .reduce<Readonly<Record<string, string>>>(
      (currentErrors, column) => ({
        ...currentErrors,
        [readFormTableCellPath(field.fieldKey, rowIndex, column.fieldKey)]:
          `${column.label || column.fieldKey}為必填欄位。`,
      }),
      {},
    );
}

/**
 * The first error in display order, so focusing it lands on the topmost
 * problem. A table contributes either its own key (row count) or a cell
 * instance path, both of which `focusFormRendererField` can address.
 */
function readFirstInvalidFieldKey(
  fields: readonly FormFieldDefinition[],
  errors: Readonly<Record<string, string>>,
): string | null {
  const errorKeys = Object.keys(errors);

  return (
    fields
      .flatMap((field) =>
        errorKeys.filter(
          (key) =>
            key === field.fieldKey || key.startsWith(`${field.fieldKey}[`),
        ),
      )
      .at(0) ?? null
  );
}

/**
 * Instance path of one cell (ADR 16 §3.3). Used as the error map key and as the
 * `data-form-field-key` the focus helper looks for.
 */
export function readFormTableCellPath(
  tableKey: string,
  rowIndex: number,
  columnKey: string,
): string {
  return `${tableKey}[${rowIndex}].${columnKey}`;
}

/**
 * Narrows a field value to table rows. An empty array is ambiguous — it also
 * satisfies the multi-select shape — so only call this when the field
 * definition says `table`.
 */
export function readFormTableRows(
  value: FormFieldValue | undefined,
): readonly FormTableRowValue[] {
  return isFormTableRowValues(value) ? value : [];
}

export function readFormTableRowBounds(field: TableFieldDefinition): {
  readonly maxRows: number;
  readonly minRows: number;
} {
  return {
    maxRows:
      typeof field.maxRows === 'number' ? field.maxRows : FORM_TABLE_MAX_ROWS,
    minRows: typeof field.minRows === 'number' ? field.minRows : 0,
  };
}

/**
 * A fresh row seeded from each column's own `defaultValue`. Columns without one
 * are left absent rather than set to `null`, so an untouched cell reads exactly
 * like an untouched flat field.
 */
export function createFormTableRow(
  columns: readonly TableColumnDefinition[],
): FormTableRowValue {
  return columns.reduce<FormTableRowValue>((row, column) => {
    const value = readInitialFormTableCellValue(column);

    return typeof value === 'undefined' ? row : { ...row, [column.fieldKey]: value };
  }, {});
}

function readInitialFormTableCellValue(
  column: TableColumnDefinition,
): FormTableCellValue | undefined {
  if (typeof column.defaultValue !== 'undefined') {
    return isFormTableCellValue(column.defaultValue)
      ? column.defaultValue
      : undefined;
  }

  return column.type === 'boolean' ? false : undefined;
}

export function focusFormRendererField(fieldKey: string): void {
  const fieldElement = document.querySelector<HTMLElement>(
    `[data-form-field-key="${CSS.escape(fieldKey)}"]`,
  );
  const focusableElement = fieldElement?.querySelector<HTMLElement>(
    'input, textarea, button, [tabindex]:not([tabindex="-1"])',
  );

  focusableElement?.focus();
  fieldElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function isFormRendererFieldVisible(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: FormRendererValues,
): boolean {
  return field.visibleWhen
    ? evaluateConditionExpression(field.visibleWhen, fields, values, true)
    : true;
}

export function isFormRendererFieldRequired(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: FormRendererValues,
): boolean {
  return (
    field.required ||
    Boolean(
      field.requiredWhen
        ? evaluateConditionExpression(field.requiredWhen, fields, values, false)
        : false,
    )
  );
}

export function isFormRendererFieldReadonly(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: FormRendererValues,
): boolean {
  return field.readonlyWhen
    ? evaluateConditionExpression(field.readonlyWhen, fields, values, false)
    : false;
}

export function evaluateConditionExpression(
  expression: string,
  fields: readonly FormFieldDefinition[],
  values: FormRendererValues,
  fallback: boolean,
): boolean {
  const rule = parseConditionRule(expression);

  if (!rule) {
    return fallback;
  }

  const field = fields.find(
    (candidate) => candidate.fieldKey === rule.fieldKey,
  );

  if (!field) {
    return fallback;
  }

  // Mirrors the backend: a table value is a list of rows, so it is not a
  // comparable operand. Without this the row records fall into the array
  // branch and get string-compared, which decides visibility by accident
  // (ADR 16 §3.8).
  if (isTableFieldDefinition(field)) {
    return fallback;
  }

  return evaluateConditionRule(rule, field, values[field.fieldKey]);
}

export function parseConditionRule(
  expression: string,
): ParsedConditionRule | null {
  const match = expression
    .trim()
    .match(/^form\.([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u);

  if (!match) {
    return null;
  }

  const operator = readConditionOperatorFromSymbol(match[2]);

  if (!operator) {
    return null;
  }

  return {
    fieldKey: match[1],
    operator,
    value: parseConditionLiteral(match[3]),
  };
}

export function buildConditionExpression(
  field: FormFieldDefinition,
  operator: ConditionOperator,
  value: string,
): string {
  return `form.${field.fieldKey} ${readConditionOperatorSymbol(operator)} ${formatConditionLiteral(field, value)}`;
}

export function readDefaultConditionOperator(
  field: FormFieldDefinition,
): ConditionOperator {
  return isComparableConditionField(field) ? 'greaterThan' : 'equals';
}

export function readDefaultConditionValue(field: FormFieldDefinition): string {
  if (field.type === 'boolean') {
    return 'true';
  }

  if (isFormStaticOptionFieldDefinition(field)) {
    return field.options[0]?.value ?? '';
  }

  return '';
}

export function readConditionOperatorOptions(
  field: FormFieldDefinition,
): readonly { readonly id: ConditionOperator; readonly name: string }[] {
  const operatorIds: readonly ConditionOperator[] = isComparableConditionField(
    field,
  )
    ? [
        'equals',
        'notEquals',
        'greaterThan',
        'greaterThanOrEqual',
        'lessThan',
        'lessThanOrEqual',
      ]
    : ['equals', 'notEquals'];

  return CONDITION_OPERATOR_OPTIONS.filter((option) =>
    operatorIds.includes(option.id),
  );
}

export function readConditionOperatorOption(
  value: string | undefined,
): ConditionOperator | null {
  return CONDITION_OPERATOR_OPTIONS.some((option) => option.id === value)
    ? (value as ConditionOperator)
    : null;
}

export function readDatePickerValue(
  value: FormFieldValue | string | undefined,
): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function formatDatePickerValue(
  value: string | undefined,
): string | undefined {
  const date = value ? parseDatePickerValue(value) : null;

  return date ? formatDateParts(date) : undefined;
}

export function formatDateTimePickerValue(
  value: string | undefined,
): string | undefined {
  const date = value ? parseDatePickerValue(value) : null;

  return date ? date.toISOString() : undefined;
}

export function isNumberFieldDefinition(
  field: FormFieldDefinition,
): field is NumberFieldDefinition {
  return field.type === 'number' || field.type === 'money';
}

export function isDateFieldDefinition(
  field: FormFieldDefinition,
): field is DateFieldDefinition {
  return field.type === 'date' || field.type === 'datetime';
}

export function isSelectFieldDefinition(
  field: FormFieldDefinition,
): field is FormStaticOptionFieldDefinition {
  return isFormStaticOptionFieldDefinition(field);
}

export function readSelectOption<TOption extends { readonly id: string }>(
  options: readonly TOption[],
  id: string,
): TOption | null {
  return options.find((option) => option.id === id) ?? null;
}

export function readFieldOptionAsSelectOption(option: FormFieldOption): {
  readonly id: string;
  readonly name: string;
} {
  return {
    id: option.value,
    name: option.label,
  };
}

export function parseOptionalNumberInput(value: string): number | undefined {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  const nextValue = Number(trimmedValue);

  return Number.isFinite(nextValue) ? nextValue : undefined;
}

export function clampOptionalNumber(
  value: number | undefined,
  range: {
    readonly max?: number;
    readonly min?: number;
  },
): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof range.min === 'number' && value < range.min) {
    return range.min;
  }

  if (typeof range.max === 'number' && value > range.max) {
    return range.max;
  }

  return value;
}

const CONDITION_OPERATOR_OPTIONS: readonly {
  readonly id: ConditionOperator;
  readonly name: string;
}[] = [
  { id: 'equals', name: '等於' },
  { id: 'notEquals', name: '不等於' },
  { id: 'greaterThan', name: '大於' },
  { id: 'greaterThanOrEqual', name: '大於等於' },
  { id: 'lessThan', name: '小於' },
  { id: 'lessThanOrEqual', name: '小於等於' },
];

function readInitialFormRendererValue(
  field: FormFieldDefinition,
): FormFieldValue | undefined {
  // Checked before `defaultValue`: a table has no default of its own (the type
  // says `never` and the lint rejects one), its initial rows come from
  // `minRows` × the column defaults (ADR 16 §3.1).
  if (isTableFieldDefinition(field)) {
    return Array.from({ length: readFormTableRowBounds(field).minRows }, () =>
      createFormTableRow(field.columns),
    );
  }

  if (typeof field.defaultValue !== 'undefined') {
    return field.defaultValue;
  }

  if (field.type === 'boolean') {
    return false;
  }

  if (field.type === 'checkbox' || field.type === 'file_upload') {
    return [];
  }

  return undefined;
}

function isFormRendererFieldValuePresent(
  value: FormFieldValue | undefined,
): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function evaluateConditionRule(
  rule: ParsedConditionRule,
  field: FormFieldDefinition,
  value: FormFieldValue | undefined,
): boolean {
  if (Array.isArray(value)) {
    return evaluateArrayCondition(value, rule);
  }

  if (field.type === 'boolean') {
    return compareConditionValues(
      value === true ? 'true' : 'false',
      rule.value,
      rule.operator,
    );
  }

  if (isNumberFieldDefinition(field)) {
    return compareNumericCondition(value, rule);
  }

  return compareConditionValues(
    typeof value === 'undefined' || value === null ? '' : String(value),
    rule.value,
    rule.operator,
  );
}

function evaluateArrayCondition(
  value: readonly string[],
  rule: ParsedConditionRule,
): boolean {
  if (rule.operator === 'equals') {
    return value.includes(rule.value);
  }

  if (rule.operator === 'notEquals') {
    return !value.includes(rule.value);
  }

  return false;
}

function compareNumericCondition(
  value: FormFieldValue | undefined,
  rule: ParsedConditionRule,
): boolean {
  const actualValue = typeof value === 'number' ? value : Number(value);
  const expectedValue = Number(rule.value);

  if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) {
    return false;
  }

  return compareConditionValues(actualValue, expectedValue, rule.operator);
}

function compareConditionValues(
  actualValue: number | string,
  expectedValue: number | string,
  operator: ConditionOperator,
): boolean {
  if (operator === 'equals') {
    return actualValue === expectedValue;
  }

  if (operator === 'notEquals') {
    return actualValue !== expectedValue;
  }

  if (operator === 'greaterThan') {
    return actualValue > expectedValue;
  }

  if (operator === 'greaterThanOrEqual') {
    return actualValue >= expectedValue;
  }

  if (operator === 'lessThan') {
    return actualValue < expectedValue;
  }

  return actualValue <= expectedValue;
}

function readConditionOperatorFromSymbol(
  symbol: string | undefined,
): ConditionOperator | null {
  const operators: Readonly<Record<string, ConditionOperator>> = {
    '!=': 'notEquals',
    '<': 'lessThan',
    '<=': 'lessThanOrEqual',
    '==': 'equals',
    '>': 'greaterThan',
    '>=': 'greaterThanOrEqual',
  };

  return symbol ? (operators[symbol] ?? null) : null;
}

function readConditionOperatorSymbol(operator: ConditionOperator): string {
  const symbols: Readonly<Record<ConditionOperator, string>> = {
    equals: '==',
    greaterThan: '>',
    greaterThanOrEqual: '>=',
    lessThan: '<',
    lessThanOrEqual: '<=',
    notEquals: '!=',
  };

  return symbols[operator];
}

function parseConditionLiteral(value: string): string {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function formatConditionLiteral(
  field: FormFieldDefinition,
  value: string,
): string {
  if (field.type === 'boolean') {
    return value === 'false' ? 'false' : 'true';
  }

  if (isNumberFieldDefinition(field)) {
    return String(parseOptionalNumberInput(value) ?? 0);
  }

  return JSON.stringify(value);
}

function isComparableConditionField(field: FormFieldDefinition): boolean {
  return (
    field.type === 'date' ||
    field.type === 'datetime' ||
    field.type === 'money' ||
    field.type === 'number'
  );
}

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_TIME_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;
const ZONE_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/u;

function parseDatePickerValue(value: string): Date | null {
  // Calendar adapters hand back zoned ISO strings (`CalendarMethodsMoment`
  // returns `moment(...).toISOString()`, i.e. UTC). Splitting those on `T`
  // would read the UTC calendar date and rebuild it as a local date, shifting
  // the result by a day for every user east of UTC. Let the runtime resolve
  // the offset instead, and keep the manual parse for zone-less input.
  if (ZONE_SUFFIX_PATTERN.test(value)) {
    const zonedDate = new Date(value);

    return Number.isNaN(zonedDate.getTime()) ? null : zonedDate;
  }

  if (DATE_TIME_VALUE_PATTERN.test(value)) {
    const [datePart = '', timePart = '00:00'] = value.split('T');
    const [year = 0, month = 1, day = 1] = datePart.split('-').map(Number);
    const [hour = 0, minute = 0] = timePart.split(':').map(Number);

    return new Date(year, month - 1, day, hour, minute);
  }

  if (DATE_VALUE_PATTERN.test(value)) {
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number);

    return new Date(year, month - 1, day);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateParts(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )}`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}
