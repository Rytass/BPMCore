import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormLayoutItem,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';

const SUPPORTED_FIELD_TYPES: readonly FormFieldDefinition['type'][] = [
  'boolean',
  'checkbox',
  'date',
  'datetime',
  'file_upload',
  'money',
  'number',
  'radio',
  'select',
  'text',
  'textarea',
];

const SELECT_FIELD_TYPES = new Set<FormFieldDefinition['type']>([
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
    schema: schema as FormDefinitionSchema,
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
  const uiSchemaErrors = lintUiSchema(uiSchema, readFieldKeySet(schema));
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

  const fieldErrors = fields.flatMap((field, index) =>
    lintFieldDefinition(field, index),
  );
  const duplicateErrors = readDuplicateFieldKeyErrors(fields);

  return [...versionErrors, ...fieldErrors, ...duplicateErrors];
}

function lintFieldDefinition(
  field: unknown,
  index: number,
): readonly string[] {
  if (!isRecord(field)) {
    return [`schema.fields[${index}] must be an object`];
  }

  const type = field.type;
  const basicErrors = [
    ...lintRequiredString(field.fieldKey, `schema.fields[${index}].fieldKey`),
    ...lintRequiredString(field.label, `schema.fields[${index}].label`),
    ...lintOptionalString(field.description, `schema.fields[${index}].description`),
    ...lintOptionalString(field.placeholder, `schema.fields[${index}].placeholder`),
    ...lintOptionalString(field.visibleWhen, `schema.fields[${index}].visibleWhen`),
    ...lintOptionalString(field.requiredWhen, `schema.fields[${index}].requiredWhen`),
    ...lintOptionalString(field.readonlyWhen, `schema.fields[${index}].readonlyWhen`),
    ...(typeof field.required === 'boolean'
      ? []
      : [`schema.fields[${index}].required must be a boolean`]),
    ...(isSupportedFieldType(type)
      ? []
      : [`schema.fields[${index}].type is not supported`]),
  ];

  if (!isSupportedFieldType(type)) {
    return basicErrors;
  }

  const path = `schema.fields[${index}]`;

  if (TEXT_FIELD_TYPES.has(type)) {
    return [...basicErrors, ...lintTextField(field, path)];
  }

  if (NUMBER_FIELD_TYPES.has(type)) {
    return [...basicErrors, ...lintNumberField(field, path)];
  }

  if (DATE_FIELD_TYPES.has(type)) {
    return [...basicErrors, ...lintDateField(field, path)];
  }

  if (SELECT_FIELD_TYPES.has(type)) {
    return [...basicErrors, ...lintSelectField(field, type, path)];
  }

  if (type === 'boolean') {
    return [...basicErrors, ...lintBooleanField(field, path)];
  }

  return [...basicErrors, ...lintFileUploadField(field, path)];
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
): readonly string[] {
  return [
    ...lintFieldOptions(field.options, `${path}.options`),
    ...lintSelectDefaultValue(field.defaultValue, type, path),
  ];
}

function lintBooleanField(
  field: Readonly<Record<string, unknown>>,
  path: string,
): readonly string[] {
  return lintOptionalDefaultValue(field.defaultValue, path, (value) =>
    typeof value === 'boolean' || value === null,
  );
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
  value: unknown,
  type: FormFieldDefinition['type'],
  path: string,
): readonly string[] {
  if (typeof value === 'undefined') {
    return [];
  }

  if (type === 'checkbox') {
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
      lintLayoutItem(item, index, fieldKeys),
    ),
  ];
}

function lintLayoutItem(
  item: unknown,
  index: number,
  fieldKeys: ReadonlySet<string>,
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

function readFieldKeySet(schema: unknown): ReadonlySet<string> {
  if (!isRecord(schema) || !Array.isArray(schema.fields)) {
    return new Set();
  }

  return new Set(
    schema.fields
      .filter(isRecord)
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
