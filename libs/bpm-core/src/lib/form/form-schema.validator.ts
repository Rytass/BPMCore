import {
  FORM_TABLE_MAX_ROWS,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormLayoutItem,
  FormUiSchema,
  isFormIdentifierKey,
  isTableColumnFieldType,
  normalizeFormDefinitionSchema,
} from '@rytass/bpm-core-shared/form';

const SUPPORTED_FIELD_TYPES: readonly FormFieldDefinition['type'][] = [
  'boolean',
  'checkbox',
  'date',
  'datetime',
  'file_upload',
  'money',
  'number',
  'autocomplete',
  'radio',
  'select',
  'table',
  'text',
  'textarea',
];

const SELECT_FIELD_TYPES = new Set<FormFieldDefinition['type']>([
  'autocomplete',
  'checkbox',
  'radio',
  'select',
]);

const TEXT_FIELD_TYPES = new Set<FormFieldDefinition['type']>([
  'text',
  'textarea',
]);

const NUMBER_FIELD_TYPES = new Set<FormFieldDefinition['type']>([
  'money',
  'number',
]);

const DATE_FIELD_TYPES = new Set<FormFieldDefinition['type']>([
  'date',
  'datetime',
]);

const UI_WIDTHS = new Set<FormLayoutItem['width']>(['FULL', 'HALF', 'THIRD']);

const CONDITION_FIELD_KEYS: readonly string[] = [
  'visibleWhen',
  'requiredWhen',
  'readonlyWhen',
];

/**
 * Where a field definition sits, so binding rules can be enforced per level:
 * `FIELD` only reaches top-level scalar fields, `ROW_FIELD` only exists inside
 * a table column (ADR 16 §3.4).
 */
interface FieldReferenceScope {
  /** Column keys of the owning table, or `null` at the top level. */
  readonly columnKeys: ReadonlySet<string> | null;
  readonly scalarFieldKeys: ReadonlySet<string>;
  readonly tableFieldKeys: ReadonlySet<string>;
}

export interface ParsedFormSchemas {
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
}

export interface FormSchemaLintResult {
  readonly errors: readonly string[];
  readonly valid: boolean;
}

export const EMPTY_FORM_SCHEMA: FormDefinitionSchema = {
  fields: [],
  schemaVersion: 1,
};

export const EMPTY_FORM_UI_SCHEMA: FormUiSchema = {
  layout: [],
  schemaVersion: 1,
};

export function parseAndValidateFormSchemas(
  schemaJson: string | null | undefined,
  uiSchemaJson: string | null | undefined,
): ParsedFormSchemas {
  const schema = schemaJson
    ? parseJsonValue(schemaJson, 'schemaJson')
    : EMPTY_FORM_SCHEMA;
  const uiSchema = uiSchemaJson
    ? parseJsonValue(uiSchemaJson, 'uiSchemaJson')
    : EMPTY_FORM_UI_SCHEMA;
  const result = lintFormSchemaValues(schema, uiSchema);

  if (!result.valid) {
    throw new Error(result.errors.join('; '));
  }

  return {
    schema: normalizeFormDefinitionSchema(schema as FormDefinitionSchema),
    uiSchema: uiSchema as FormUiSchema,
  };
}

export function lintFormSchemaJson(
  schemaJson: string,
  uiSchemaJson: string | null | undefined,
): FormSchemaLintResult {
  const schema = parseJsonForLint(schemaJson, 'schemaJson');
  const uiSchema = uiSchemaJson
    ? parseJsonForLint(uiSchemaJson, 'uiSchemaJson')
    : {
        errors: [],
        value: EMPTY_FORM_UI_SCHEMA,
      };
  const parseErrors = [
    ...schema.errors,
    ...uiSchema.errors,
  ];

  if (parseErrors.length) {
    return {
      errors: parseErrors,
      valid: false,
    };
  }

  return lintFormSchemaValues(schema.value, uiSchema.value);
}

function parseJsonForLint(
  value: string,
  label: string,
): { readonly errors: readonly string[]; readonly value: unknown } {
  try {
    return {
      errors: [],
      value: JSON.parse(value) as unknown,
    };
  } catch (error: unknown) {
    return {
      errors: [`${label} is not valid JSON: ${readErrorMessage(error)}`],
      value: null,
    };
  }
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new Error(`${label} is not valid JSON: ${readErrorMessage(error)}`);
  }
}

function lintFormSchemaValues(
  schema: unknown,
  uiSchema: unknown,
): FormSchemaLintResult {
  const schemaErrors = lintDefinitionSchema(schema);
  const uiSchemaErrors = lintUiSchema(
    uiSchema,
    readFieldKeySet(schema),
    readTableFieldKeySet(schema),
  );
  const errors = [...schemaErrors, ...uiSchemaErrors];

  return {
    errors,
    valid: errors.length === 0,
  };
}

function lintDefinitionSchema(schema: unknown): readonly string[] {
  if (!isRecord(schema)) {
    return ['schema must be an object'];
  }

  const versionErrors =
    schema.schemaVersion === 1 ? [] : ['schema.schemaVersion must be 1'];
  const fields = schema.fields;

  if (!Array.isArray(fields)) {
    return [...versionErrors, 'schema.fields must be an array'];
  }

  const tableFieldKeys = readTableFieldKeySet(schema);
  const scope: FieldReferenceScope = {
    columnKeys: null,
    scalarFieldKeys: readScalarFieldKeySet(schema),
    tableFieldKeys,
  };
  const fieldErrors = fields.flatMap((field, index) =>
    lintFieldDefinition(field, index, scope),
  );
  const duplicateErrors = readDuplicateFieldKeyErrors(fields);
  const dependencyErrors = lintFieldDependencyGraph(fields);

  return [
    ...versionErrors,
    ...fieldErrors,
    ...duplicateErrors,
    ...dependencyErrors,
  ];
}

function lintFieldDefinition(
  field: unknown,
  index: number,
  scope: FieldReferenceScope,
): readonly string[] {
  if (!isRecord(field)) {
    return [`schema.fields[${index}] must be an object`];
  }

  const path = `schema.fields[${index}]`;
  const type = field.type;
  const basicErrors = [
    ...lintFieldIdentity(field, path),
    ...lintOptionalString(field.visibleWhen, `${path}.visibleWhen`),
    ...lintOptionalString(field.requiredWhen, `${path}.requiredWhen`),
    ...lintOptionalString(field.readonlyWhen, `${path}.readonlyWhen`),
    ...lintFieldRequiredFlag(field, path),
    ...(isSupportedFieldType(type) ? [] : [`${path}.type is not supported`]),
    ...lintConditionTableReferences(field, path, scope.tableFieldKeys),
  ];

  if (!isSupportedFieldType(type)) {
    return basicErrors;
  }

  return [...basicErrors, ...lintFieldTypeSpecifics(field, type, path, scope)];
}

function lintFieldTypeSpecifics(
  field: Readonly<Record<string, unknown>>,
  type: FormFieldDefinition['type'],
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  if (TEXT_FIELD_TYPES.has(type)) {
    return lintTextField(field, path);
  }

  if (NUMBER_FIELD_TYPES.has(type)) {
    return lintNumberField(field, path);
  }

  if (DATE_FIELD_TYPES.has(type)) {
    return lintDateField(field, path);
  }

  if (SELECT_FIELD_TYPES.has(type)) {
    return lintSelectField(field, type, path, scope);
  }

  if (type === 'boolean') {
    return lintBooleanField(field, path);
  }

  if (type === 'table') {
    return lintTableField(field, path, scope);
  }

  return lintFileUploadField(field, path);
}

function lintFieldIdentity(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return [
    ...lintRequiredString(field.fieldKey, `${path}.fieldKey`),
    ...lintRequiredString(field.label, `${path}.label`),
    ...lintOptionalString(field.description, `${path}.description`),
    ...lintOptionalString(field.placeholder, `${path}.placeholder`),
  ];
}

function lintFieldRequiredFlag(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return typeof field.required === 'boolean'
    ? []
    : [`${path}.required must be a boolean`];
}

/**
 * Form-level conditions cannot address a cell: neither the frontend nor the
 * backend condition parser understands bracket paths, so referencing table
 * internals is rejected outright instead of relying on a parse failure
 * (ADR 16 §3.8). Referencing the table itself stays legal — that is what the
 * IS_FILLED / IS_EMPTY operators compile to.
 */
function lintConditionTableReferences(
  field: Readonly<Record<string, unknown>>,
  path: string,
  tableFieldKeys: ReadonlySet<string>,
): readonly string[] {
  if (!tableFieldKeys.size) {
    return [];
  }

  return CONDITION_FIELD_KEYS.flatMap((conditionKey) => {
    const expression = field[conditionKey];

    if (typeof expression !== 'string') {
      return [];
    }

    return [...tableFieldKeys]
      .filter((tableKey) => referencesTableInternals(expression, tableKey))
      .map(
        (tableKey) =>
          `${path}.${conditionKey} must not reference table field internals: ${tableKey}`,
      );
  });
}

function referencesTableInternals(
  expression: string,
  tableKey: string,
): boolean {
  const escapedKey = tableKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  return [
    new RegExp(`form\\.${escapedKey}\\s*(?:\\.|\\[)`, 'u'),
    new RegExp(`form\\[\\s*["']${escapedKey}["']\\s*\\]\\s*(?:\\.|\\[)`, 'u'),
  ].some((pattern) => pattern.test(expression));
}

function lintTextField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  const minLengthErrors = lintOptionalInteger(
    field.minLength,
    `${path}.minLength`,
    0,
  );
  const maxLengthErrors = lintOptionalInteger(
    field.maxLength,
    `${path}.maxLength`,
    1,
  );
  const lengthRangeErrors =
    typeof field.minLength === 'number' &&
    typeof field.maxLength === 'number' &&
    field.minLength > field.maxLength
      ? [`${path}.minLength must be less than or equal to ${path}.maxLength`]
      : [];

  return [
    ...minLengthErrors,
    ...maxLengthErrors,
    ...lengthRangeErrors,
    ...lintOptionalDefaultValue(field.defaultValue, path, (value) =>
      typeof value === 'string' || value === null,
    ),
  ];
}

function lintNumberField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  const minimumErrors = lintOptionalNumber(field.minimum, `${path}.minimum`);
  const maximumErrors = lintOptionalNumber(field.maximum, `${path}.maximum`);
  const rangeErrors =
    typeof field.minimum === 'number' &&
    typeof field.maximum === 'number' &&
    field.minimum > field.maximum
      ? [`${path}.minimum must be less than or equal to ${path}.maximum`]
      : [];

  return [
    ...minimumErrors,
    ...maximumErrors,
    ...rangeErrors,
    ...lintOptionalDefaultValue(field.defaultValue, path, (value) =>
      typeof value === 'number' || value === null,
    ),
  ];
}

function lintDateField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return lintOptionalDefaultValue(field.defaultValue, path, (value) =>
    typeof value === 'string' || value === null,
  );
}

function lintSelectField(
  field: Readonly<Record<string, unknown>>,
  type: FormFieldDefinition['type'],
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  const sourceErrors = lintOptionSource(field, type, path, scope);
  const hasDataSource = Object.prototype.hasOwnProperty.call(
    field,
    'dataSource',
  );

  return [
    ...sourceErrors,
    ...(hasDataSource
      ? lintDynamicDefaultValue(field, path)
      : lintSelectDefaultValue(field, type, path)),
  ];
}

function lintOptionSource(
  field: Readonly<Record<string, unknown>>,
  type: FormFieldDefinition['type'],
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  const hasOptions = Object.prototype.hasOwnProperty.call(field, 'options');
  const hasDataSource = Object.prototype.hasOwnProperty.call(
    field,
    'dataSource',
  );
  const sourceCount = Number(hasOptions) + Number(hasDataSource);
  const sourceShapeErrors =
    sourceCount === 1
      ? []
      : [
          `${path} must contain exactly one of options or dataSource`,
        ];
  const modeErrors = lintOptionMode(field, type, path);

  if (sourceCount !== 1) {
    return [...sourceShapeErrors, ...modeErrors];
  }

  if (hasOptions) {
    return [
      ...sourceShapeErrors,
      ...modeErrors,
      ...lintFieldOptions(field.options, `${path}.options`),
    ];
  }

  return [
    ...sourceShapeErrors,
    ...modeErrors,
    ...lintDataSourceReference(field.dataSource, `${path}.dataSource`, scope),
  ];
}

function lintOptionMode(
  field: Readonly<Record<string, unknown>>,
  type: FormFieldDefinition['type'],
  path: string,
): readonly string[] {
  const hasMode = Object.prototype.hasOwnProperty.call(field, 'mode');

  if (type === 'radio' || type === 'checkbox') {
    return hasMode
      ? [`${path}.mode is not supported for ${type}; mode is fixed`]
      : [];
  }

  if (!hasMode || typeof field.mode === 'undefined') {
    return [];
  }

  return field.mode === 'single' || field.mode === 'multiple'
    ? []
    : [`${path}.mode must be single or multiple`];
}

function lintDataSourceReference(
  value: unknown,
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  if (!isRecord(value)) {
    return [`${path} must be an object`];
  }

  const referenceErrors = [
    ...lintRequiredString(value.key, `${path}.key`),
    ...lintRequiredInteger(value.version, `${path}.version`, 1),
  ];
  const bindings = value.bindings;

  if (!Array.isArray(bindings)) {
    return [...referenceErrors, `${path}.bindings must be an array`];
  }

  const bindingErrors = bindings.flatMap((binding, index) =>
    lintDataSourceBinding(binding, `${path}.bindings[${index}]`, scope),
  );
  const parameters = bindings
    .filter(isRecord)
    .map((binding) => binding.parameter)
    .filter((parameter): parameter is string => typeof parameter === 'string');
  const duplicateParameters = [
    ...new Set(
      parameters.filter(
        (parameter, index, allParameters) =>
          allParameters.indexOf(parameter) !== index,
      ),
    ),
  ];

  return [
    ...referenceErrors,
    ...bindingErrors,
    ...duplicateParameters.map(
      (parameter) => `${path}.bindings.parameter is duplicated: ${parameter}`,
    ),
  ];
}

function lintDataSourceBinding(
  value: unknown,
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  if (!isRecord(value)) {
    return [`${path} must be an object`];
  }

  const errors = lintRequiredString(value.parameter, `${path}.parameter`);
  const from = value.from;

  if (!isRecord(from)) {
    return [...errors, `${path}.from must be an object`];
  }

  if (from.kind === 'FIELD') {
    return [
      ...errors,
      ...lintRequiredString(from.fieldKey, `${path}.from.fieldKey`),
      ...lintFieldBindingTarget(from.fieldKey, `${path}.from.fieldKey`, scope),
    ];
  }

  if (from.kind === 'CONSTANT') {
    return [
      ...errors,
      ...lintConstantValue(from.value, `${path}.from.value`),
    ];
  }

  if (from.kind === 'ROW_FIELD') {
    const columnKeys = scope.columnKeys;

    if (!columnKeys) {
      return [
        ...errors,
        `${path}.from.kind ROW_FIELD is only supported inside a table column`,
      ];
    }

    return [
      ...errors,
      ...lintRequiredString(from.columnKey, `${path}.from.columnKey`),
      ...(typeof from.columnKey === 'string' && !columnKeys.has(from.columnKey)
        ? [`${path}.from.columnKey does not match a table column`]
        : []),
    ];
  }

  return [...errors, `${path}.from.kind must be FIELD, CONSTANT, or ROW_FIELD`];
}

function lintFieldBindingTarget(
  fieldKey: unknown,
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  if (typeof fieldKey !== 'string') {
    return [];
  }

  // A table value is a list of rows, so it can never stand in for a scalar
  // data source parameter — and cross-row references have no single-value
  // semantics in V1 (ADR 16 §3.4).
  if (scope.tableFieldKeys.has(fieldKey)) {
    return [`${path} must not reference a table field`];
  }

  return scope.scalarFieldKeys.has(fieldKey)
    ? []
    : [`${path} does not match a schema field`];
}


function lintConstantValue(value: unknown, path: string): readonly string[] {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? []
    : [`${path} must be a primitive constant`];
}

function lintDynamicDefaultValue(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return Object.prototype.hasOwnProperty.call(field, 'defaultValue')
    ? [`${path}.defaultValue is not supported for dynamic data sources`]
    : [];
}

function lintBooleanField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return lintOptionalDefaultValue(field.defaultValue, path, (value) =>
    typeof value === 'boolean' || value === null,
  );
}

function lintTableField(
  field: Readonly<Record<string, unknown>>,
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  const structureErrors = [
    ...lintIdentifierKey(field.fieldKey, `${path}.fieldKey`),
    ...lintOptionalString(field.addRowLabel, `${path}.addRowLabel`),
    ...lintTableRowBounds(field, path),
    ...(Object.prototype.hasOwnProperty.call(field, 'defaultValue')
      ? [`${path}.defaultValue is not supported for table fields`]
      : []),
  ];
  const columns = field.columns;

  if (!Array.isArray(columns) || columns.length === 0) {
    return [...structureErrors, `${path}.columns must contain at least one column`];
  }

  const columnKeys = columns
    .filter(isRecord)
    .map((column) => column.fieldKey)
    .filter((columnKey): columnKey is string => typeof columnKey === 'string');
  const columnScope: FieldReferenceScope = {
    ...scope,
    columnKeys: new Set(columnKeys),
  };
  const duplicatedColumnKeys = [
    ...new Set(
      columnKeys.filter(
        (columnKey, index) => columnKeys.indexOf(columnKey) !== index,
      ),
    ),
  ];

  return [
    ...structureErrors,
    ...columns.flatMap((column, index) =>
      lintTableColumn(column, `${path}.columns[${index}]`, columnScope),
    ),
    ...duplicatedColumnKeys.map(
      (columnKey) => `${path}.columns fieldKey is duplicated: ${columnKey}`,
    ),
  ];
}

function lintTableRowBounds(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  const minRowsErrors = lintOptionalInteger(field.minRows, `${path}.minRows`, 0);
  const maxRowsErrors = lintOptionalInteger(field.maxRows, `${path}.maxRows`, 1);
  const ceilingErrors =
    typeof field.maxRows === 'number' && field.maxRows > FORM_TABLE_MAX_ROWS
      ? [
          `${path}.maxRows must be less than or equal to ${FORM_TABLE_MAX_ROWS}`,
        ]
      : [];
  const rangeErrors =
    typeof field.minRows === 'number' &&
    typeof field.maxRows === 'number' &&
    field.minRows > field.maxRows
      ? [`${path}.minRows must be less than or equal to ${path}.maxRows`]
      : [];
  const implicitCeilingErrors =
    typeof field.minRows === 'number' &&
    typeof field.maxRows === 'undefined' &&
    field.minRows > FORM_TABLE_MAX_ROWS
      ? [
          `${path}.minRows must be less than or equal to ${FORM_TABLE_MAX_ROWS}`,
        ]
      : [];

  return [
    ...minRowsErrors,
    ...maxRowsErrors,
    ...ceilingErrors,
    ...rangeErrors,
    ...implicitCeilingErrors,
  ];
}

function lintTableColumn(
  column: unknown,
  path: string,
  scope: FieldReferenceScope,
): readonly string[] {
  if (!isRecord(column)) {
    return [`${path} must be an object`];
  }

  const type = column.type;
  const basicErrors = [
    ...lintFieldIdentity(column, path),
    ...lintIdentifierKey(column.fieldKey, `${path}.fieldKey`),
    ...CONDITION_FIELD_KEYS.filter((conditionKey) =>
      Object.prototype.hasOwnProperty.call(column, conditionKey),
    ).map(
      (conditionKey) =>
        `${path}.${conditionKey} is not supported for table columns`,
    ),
    ...lintFieldRequiredFlag(column, path),
    ...lintTableColumnType(type, path),
  ];

  if (!isSupportedFieldType(type) || !isTableColumnFieldType(type)) {
    return basicErrors;
  }

  return [...basicErrors, ...lintFieldTypeSpecifics(column, type, path, scope)];
}

function lintTableColumnType(
  type: unknown,
  path: string,
): readonly string[] {
  if (type === 'table') {
    return [`${path}.type must not be a nested table`];
  }

  if (!isSupportedFieldType(type)) {
    return [`${path}.type is not supported`];
  }

  return isTableColumnFieldType(type)
    ? []
    : [`${path}.type is not supported for a table column`];
}

function lintIdentifierKey(value: unknown, path: string): readonly string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return isFormIdentifierKey(value)
    ? []
    : [`${path} must match /^[A-Za-z_][A-Za-z0-9_]*$/`];
}

function lintFileUploadField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return [
    ...lintOptionalInteger(field.maxFiles, `${path}.maxFiles`, 1),
    ...lintOptionalStringArray(
      field.acceptedMimeTypes,
      `${path}.acceptedMimeTypes`,
    ),
    ...lintOptionalDefaultValue(field.defaultValue, path, (value) =>
      isStringArray(value) || value === null,
    ),
  ];
}

function lintFieldOptions(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${path} must contain at least one option`];
  }

  const optionErrors = value.flatMap((option, index) =>
    lintFieldOption(option, `${path}[${index}]`),
  );
  const duplicatedValues = value
    .filter(isRecord)
    .map((option) => option.value)
    .filter((optionValue): optionValue is string => typeof optionValue === 'string')
    .filter((optionValue, index, values) => values.indexOf(optionValue) !== index);

  return [
    ...optionErrors,
    ...[...new Set(duplicatedValues)].map(
      (optionValue) => `${path}.value is duplicated: ${optionValue}`,
    ),
  ];
}

function lintFieldOption(
  option: unknown,
  path: string,
): readonly string[] {
  if (!isRecord(option)) {
    return [`${path} must be an object`];
  }

  return [
    ...lintRequiredString(option.label, `${path}.label`),
    ...lintRequiredString(option.value, `${path}.value`),
  ];
}

function lintSelectDefaultValue(
  field: Readonly<Record<string, unknown>>,
  type: FormFieldDefinition['type'],
  path: string,
): readonly string[] {
  const value = field.defaultValue;

  if (typeof value === 'undefined') {
    return [];
  }

  const isMultiple =
    type === 'checkbox' ||
    ((type === 'select' || type === 'autocomplete') &&
      field.mode === 'multiple');

  if (isMultiple) {
    return isStringArray(value) || value === null
      ? []
      : [`${path}.defaultValue must be an array of strings or null`];
  }

  return typeof value === 'string' || value === null
    ? []
    : [`${path}.defaultValue must be a string or null`];
}

function lintOptionalDefaultValue(
  value: unknown,
  path: string,
  predicate: (value: unknown) => boolean,
): readonly string[] {
  if (typeof value === 'undefined' || predicate(value)) {
    return [];
  }

  return [`${path}.defaultValue has invalid type for field type`];
}

function lintUiSchema(
  uiSchema: unknown,
  fieldKeys: ReadonlySet<string>,
  tableFieldKeys: ReadonlySet<string>,
): readonly string[] {
  if (!isRecord(uiSchema)) {
    return ['uiSchema must be an object'];
  }

  const versionErrors =
    uiSchema.schemaVersion === 1 ? [] : ['uiSchema.schemaVersion must be 1'];
  const layout = uiSchema.layout;

  if (!Array.isArray(layout)) {
    return [...versionErrors, 'uiSchema.layout must be an array'];
  }

  return [
    ...versionErrors,
    ...layout.flatMap((item, index) =>
      lintLayoutItem(item, index, fieldKeys, tableFieldKeys),
    ),
  ];
}

function lintLayoutItem(
  item: unknown,
  index: number,
  fieldKeys: ReadonlySet<string>,
  tableFieldKeys: ReadonlySet<string>,
): readonly string[] {
  if (!isRecord(item)) {
    return [`uiSchema.layout[${index}] must be an object`];
  }

  const fieldKey = item.fieldKey;
  const width = item.width;

  return [
    ...lintRequiredString(fieldKey, `uiSchema.layout[${index}].fieldKey`),
    ...(typeof fieldKey === 'string' && !fieldKeys.has(fieldKey)
      ? [`uiSchema.layout[${index}].fieldKey does not match a schema field`]
      : []),
    ...(isUiWidth(width)
      ? []
      : [`uiSchema.layout[${index}].width must be FULL, HALF, or THIRD`]),
    ...(typeof fieldKey === 'string' &&
    tableFieldKeys.has(fieldKey) &&
    width !== 'FULL'
      ? [`uiSchema.layout[${index}].width must be FULL for table fields`]
      : []),
  ];
}

function readDuplicateFieldKeyErrors(fields: readonly unknown[]): readonly string[] {
  const keys = fields
    .filter(isRecord)
    .map((field) => field.fieldKey)
    .filter((fieldKey): fieldKey is string => typeof fieldKey === 'string');
  const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
  const uniqueDuplicated = [...new Set(duplicated)];

  return uniqueDuplicated.map((key) => `schema.fields fieldKey is duplicated: ${key}`);
}

/**
 * Two layers in one graph (ADR 16 §3.4): top-level fields joined by `FIELD`
 * bindings, and each table's columns joined by `ROW_FIELD` bindings plus their
 * `FIELD` edges up to the top level. Node ids are prefixed so a top-level key
 * that happens to contain a dot cannot collide with a column node.
 */
function lintFieldDependencyGraph(
  fields: readonly unknown[],
): readonly string[] {
  const dependencies = new Map<string, readonly string[]>(
    fields.filter(isRecord).flatMap(readFieldDependencyEntries),
  );
  const cycles = [...dependencies.keys()]
    .map((node) => findDependencyCycle(node, dependencies, []))
    .filter((cycle): cycle is readonly string[] => Boolean(cycle))
    .map((cycle) => cycle.map(readDependencyNodeLabel).join(' -> '));
  const uniqueCycles = [...new Set(cycles)];

  return uniqueCycles.map((cycle) => `schema.fields dependency cycle: ${cycle}`);
}

function readFieldDependencyEntries(
  field: Readonly<Record<string, unknown>>,
): readonly (readonly [string, readonly string[]])[] {
  if (typeof field.fieldKey !== 'string') {
    return [];
  }

  const fieldKey = field.fieldKey;

  if (field.type === 'table') {
    return Array.isArray(field.columns)
      ? field.columns
          .filter(isRecord)
          .filter((column) => typeof column.fieldKey === 'string')
          .map(
            (column) =>
              [
                `col:${fieldKey}.${String(column.fieldKey)}`,
                readBindingSources(column).flatMap((from) =>
                  readColumnDependencyNode(from, fieldKey),
                ),
              ] as const,
          )
      : [];
  }

  return [
    [
      `top:${fieldKey}`,
      readBindingSources(field)
        .filter((from) => from.kind === 'FIELD')
        .map((from) => from.fieldKey)
        .filter(
          (dependencyKey): dependencyKey is string =>
            typeof dependencyKey === 'string',
        )
        .map((dependencyKey) => `top:${dependencyKey}`),
    ],
  ];
}

function readColumnDependencyNode(
  from: Readonly<Record<string, unknown>>,
  tableKey: string,
): readonly string[] {
  if (from.kind === 'FIELD' && typeof from.fieldKey === 'string') {
    return [`top:${from.fieldKey}`];
  }

  if (from.kind === 'ROW_FIELD' && typeof from.columnKey === 'string') {
    return [`col:${tableKey}.${from.columnKey}`];
  }

  return [];
}

function readBindingSources(
  field: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
  return isRecord(field.dataSource) && Array.isArray(field.dataSource.bindings)
    ? field.dataSource.bindings
        .filter(isRecord)
        .map((binding) => binding.from)
        .filter(isRecord)
    : [];
}

function readDependencyNodeLabel(node: string): string {
  return node.replace(/^(?:top|col):/u, '');
}

function findDependencyCycle(
  fieldKey: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
  path: readonly string[],
): readonly string[] | null {
  const cycleStart = path.indexOf(fieldKey);

  if (cycleStart >= 0) {
    return [...path.slice(cycleStart), fieldKey];
  }

  const nextPath = [...path, fieldKey];
  const nextFields = dependencies.get(fieldKey) ?? [];

  for (const nextField of nextFields) {
    const cycle = findDependencyCycle(nextField, dependencies, nextPath);

    if (cycle) {
      return cycle;
    }
  }

  return null;
}

function readFieldKeySet(schema: unknown): ReadonlySet<string> {
  return readFieldKeySetBy(schema, () => true);
}

function readTableFieldKeySet(schema: unknown): ReadonlySet<string> {
  return readFieldKeySetBy(schema, (field) => field.type === 'table');
}

function readScalarFieldKeySet(schema: unknown): ReadonlySet<string> {
  return readFieldKeySetBy(schema, (field) => field.type !== 'table');
}

function readFieldKeySetBy(
  schema: unknown,
  predicate: (field: Readonly<Record<string, unknown>>) => boolean,
): ReadonlySet<string> {
  if (!isRecord(schema) || !Array.isArray(schema.fields)) {
    return new Set();
  }

  return new Set(
    schema.fields
      .filter(isRecord)
      .filter(predicate)
      .map((field) => field.fieldKey)
      .filter((fieldKey): fieldKey is string => typeof fieldKey === 'string'),
  );
}

function lintRequiredString(
  value: unknown,
  path: string,
): readonly string[] {
  return typeof value === 'string' && value.trim() ? [] : [`${path} is required`];
}

function lintOptionalString(value: unknown, path: string): readonly string[] {
  return typeof value === 'undefined' ||
    value === null ||
    typeof value === 'string'
    ? []
    : [`${path} must be a string`];
}

function lintOptionalNumber(value: unknown, path: string): readonly string[] {
  return typeof value === 'undefined' || typeof value === 'number'
    ? []
    : [`${path} must be a number`];
}

function lintOptionalInteger(
  value: unknown,
  path: string,
  minimum: number,
): readonly string[] {
  if (typeof value === 'undefined') {
    return [];
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    return [`${path} must be an integer greater than or equal to ${minimum}`];
  }

  return [];
}

function lintRequiredInteger(
  value: unknown,
  path: string,
  minimum: number,
): readonly string[] {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum
    ? []
    : [`${path} must be an integer greater than or equal to ${minimum}`];
}

function lintOptionalStringArray(
  value: unknown,
  path: string,
): readonly string[] {
  if (typeof value === 'undefined') {
    return [];
  }

  return isStringArray(value) && value.every((item) => item.trim())
    ? []
    : [`${path} must be an array of non-empty strings`];
}

function isSupportedFieldType(
  value: unknown,
): value is FormFieldDefinition['type'] {
  return (
    typeof value === 'string' &&
    SUPPORTED_FIELD_TYPES.includes(value as FormFieldDefinition['type'])
  );
}

function isUiWidth(value: unknown): value is FormLayoutItem['width'] {
  return typeof value === 'string' && UI_WIDTHS.has(value as FormLayoutItem['width']);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
