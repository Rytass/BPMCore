export interface FormDefinitionSchema {
  readonly fields: readonly FormFieldDefinition[];
  readonly schemaVersion: 1;
}

export type FormFieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | DateFieldDefinition
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | RadioFieldDefinition
  | CheckboxFieldDefinition
  | BooleanFieldDefinition
  | FileUploadFieldDefinition
  | TableFieldDefinition;

interface BaseFormFieldDefinition<TType extends string> {
  readonly defaultValue?: FormFieldValue;
  readonly description?: string;
  readonly fieldKey: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly readonlyWhen?: string;
  readonly required: boolean;
  readonly requiredWhen?: string;
  readonly type: TType;
  readonly visibleWhen?: string;
}

/**
 * The value contract every non-table field keeps, and the only shape a table
 * cell may hold. Table rows are records of these primitives, so the "no
 * `{ value, label }` in stored form data" rule holds inside tables too.
 */
export type FormTableCellValue =
  | boolean
  | number
  | string
  | readonly string[]
  | null;

/**
 * One table row. Keys are column keys; rows carry no identity of their own —
 * array order is display order (see ADR 16 §3.2).
 */
export type FormTableRowValue = Readonly<Record<string, FormTableCellValue>>;

export type FormFieldValue = FormTableCellValue | readonly FormTableRowValue[];

export type TextFieldDefinition = BaseFormFieldDefinition<
  'text' | 'textarea'
> & {
  readonly maxLength?: number;
  readonly minLength?: number;
};

export type NumberFieldDefinition = BaseFormFieldDefinition<
  'number' | 'money'
> & {
  readonly maximum?: number;
  readonly minimum?: number;
};

export type DateFieldDefinition = BaseFormFieldDefinition<'date' | 'datetime'>;

export type FormSelectionMode = 'multiple' | 'single';

export interface FormDataSourceReference {
  readonly bindings: readonly FormDataSourceBinding[];
  readonly key: string;
  readonly version: number;
}

export type FormDataSourceBindingSource =
  | {
      readonly fieldKey: string;
      readonly kind: 'FIELD';
    }
  | {
      readonly kind: 'CONSTANT';
      readonly value: boolean | number | string | null;
    }
  | {
      readonly columnKey: string;
      readonly kind: 'ROW_FIELD';
    };

export interface FormDataSourceBinding {
  readonly from: FormDataSourceBindingSource;
  readonly parameter: string;
}

export type FormFieldOptionSource =
  | {
      readonly dataSource?: never;
      readonly options: readonly FormFieldOption[];
    }
  | {
      readonly dataSource: FormDataSourceReference;
      readonly options?: never;
    };

export type SelectFieldDefinition = BaseFormFieldDefinition<'select'> &
  FormFieldOptionSource & {
    readonly mode?: FormSelectionMode;
  };

export type AutoCompleteFieldDefinition =
  BaseFormFieldDefinition<'autocomplete'> &
    FormFieldOptionSource & {
      readonly mode?: FormSelectionMode;
    };

export type RadioFieldDefinition = BaseFormFieldDefinition<'radio'> &
  FormFieldOptionSource;

export type CheckboxFieldDefinition = BaseFormFieldDefinition<'checkbox'> &
  FormFieldOptionSource;

export type FormOptionFieldDefinition =
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | RadioFieldDefinition
  | CheckboxFieldDefinition;

export interface FormFieldOption {
  readonly label: string;
  readonly value: string;
}

export type FormDataSourceValueSnapshot = {
  readonly bindingHash: string;
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly options: readonly FormFieldOption[];
  /**
   * The policy the source declared when this snapshot was written. Once the
   * source leaves the registry its descriptor is gone, so without this record
   * there is no way to tell whether reusing the snapshot would quietly skip an
   * `ALWAYS` revalidation. Optional because snapshots persisted before this
   * field existed must keep loading.
   */
  readonly revalidationPolicy?: 'ALWAYS' | 'WHEN_VALUE_OR_BINDINGS_CHANGE';
  readonly validatedAt: string;
};

export type FormDataSourceValueSnapshots = Readonly<
  Record<string, FormDataSourceValueSnapshot>
>;

export type BooleanFieldDefinition = BaseFormFieldDefinition<'boolean'>;

export type FileUploadFieldDefinition =
  BaseFormFieldDefinition<'file_upload'> & {
    readonly acceptedMimeTypes?: readonly string[];
    readonly maxFiles?: number;
  };

/**
 * Field types a table column may use. `textarea`, `radio`, `checkbox`,
 * `file_upload` and nested `table` are intentionally excluded in V1
 * (ADR 16 §3.10); opening any of them later is an additive change.
 */
export type TableColumnDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | DateFieldDefinition
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | BooleanFieldDefinition;

/**
 * The column types the structural lint accepts. `text` is listed without
 * `textarea` on purpose — {@link TextFieldDefinition} covers both, and only
 * `text` is allowed inside a table cell.
 */
export const TABLE_COLUMN_FIELD_TYPES: readonly TableColumnDefinition['type'][] =
  [
    'autocomplete',
    'boolean',
    'date',
    'datetime',
    'money',
    'number',
    'select',
    'text',
  ];

/**
 * Hard ceiling on table rows, matching the 65,536 byte `formDataJson` GraphQL
 * input limit (ADR 14 §3.12). A table without `maxRows` is capped here.
 */
export const FORM_TABLE_MAX_ROWS = 100;

export type TableFieldDefinition = BaseFormFieldDefinition<'table'> & {
  readonly addRowLabel?: string;
  readonly columns: readonly TableColumnDefinition[];
  /**
   * Prefilled rows are out of scope for V1; initial rows come from `minRows`
   * multiplied by each column's own `defaultValue`.
   */
  readonly defaultValue?: never;
  readonly maxRows?: number;
  readonly minRows?: number;
};

export interface FormUiSchema {
  readonly layout: readonly FormLayoutItem[];
  readonly schemaVersion: 1;
}

export interface FormLayoutItem {
  readonly fieldKey: string;
  readonly width: 'FULL' | 'HALF' | 'THIRD';
}

export function isFormOptionFieldDefinition(
  field: FormFieldDefinition,
): field is FormOptionFieldDefinition {
  return (
    field.type === 'select' ||
    field.type === 'autocomplete' ||
    field.type === 'radio' ||
    field.type === 'checkbox'
  );
}

export function isTableFieldDefinition(
  field: FormFieldDefinition,
): field is TableFieldDefinition {
  return field.type === 'table';
}

export function isTableColumnFieldType(
  type: FormFieldDefinition['type'],
): type is TableColumnDefinition['type'] {
  return TABLE_COLUMN_FIELD_TYPES.includes(
    type as TableColumnDefinition['type'],
  );
}

export function isFormTableCellValue(
  value: unknown,
): value is FormTableCellValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function isFormTableRowValue(
  value: unknown,
): value is FormTableRowValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isFormTableCellValue)
  );
}

/**
 * Note the inherent ambiguity of `[]`: an empty array satisfies both this
 * guard and the multi-select cell shape (`readonly string[]`). Callers that
 * hold the field definition should decide by `type === 'table'`; callers that
 * do not should treat `[]` as the primitive it has always been, which is what
 * {@link readFormTableCellValue} does.
 */
export function isFormTableRowValues(
  value: unknown,
): value is readonly FormTableRowValue[] {
  return Array.isArray(value) && value.every(isFormTableRowValue);
}

/**
 * Narrows a field value to the primitive contract the flat-field code paths
 * have always assumed, returning `undefined` for table row arrays. Use it
 * where "a table value does not apply here" is the correct answer.
 */
export function readFormTableCellValue(
  value: FormFieldValue | undefined,
): FormTableCellValue | undefined {
  return isFormTableCellValue(value) ? value : undefined;
}

/**
 * The identifier shape a table field key and every column key must take so
 * that `<tableKey>[<i>].<columnKey>` paths stay parseable (ADR 16 §3.3). It is
 * the same rule {@link readFormFieldReference} uses to decide between dot and
 * bracket access.
 */
export function isFormIdentifierKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

export function isFormDataSourceFieldDefinition(
  field: FormFieldDefinition,
): field is FormDataSourceOptionFieldDefinition {
  return (
    isFormOptionFieldDefinition(field) &&
    'dataSource' in field &&
    typeof field.dataSource !== 'undefined'
  );
}

export function isFormStaticOptionFieldDefinition(
  field: FormFieldDefinition,
): field is FormStaticOptionFieldDefinition {
  return (
    isFormOptionFieldDefinition(field) &&
    'options' in field &&
    Array.isArray(field.options)
  );
}

export function readFormFieldSelectionMode(
  field: FormOptionFieldDefinition,
): FormSelectionMode {
  if (field.type === 'checkbox') {
    return 'multiple';
  }

  if (field.type === 'radio') {
    return 'single';
  }

  return field.mode ?? 'single';
}

export function normalizeFormDefinitionSchema(
  schema: FormDefinitionSchema,
): FormDefinitionSchema {
  return {
    ...schema,
    fields: schema.fields.map(normalizeFormFieldDefinition),
  };
}

export type FormDataSourceOptionFieldDefinition =
  | (SelectFieldDefinition & { readonly dataSource: FormDataSourceReference })
  | (AutoCompleteFieldDefinition & {
      readonly dataSource: FormDataSourceReference;
    })
  | (RadioFieldDefinition & { readonly dataSource: FormDataSourceReference })
  | (CheckboxFieldDefinition & {
      readonly dataSource: FormDataSourceReference;
    });

export type FormStaticOptionFieldDefinition =
  | (SelectFieldDefinition & { readonly options: readonly FormFieldOption[] })
  | (AutoCompleteFieldDefinition & {
      readonly options: readonly FormFieldOption[];
    })
  | (RadioFieldDefinition & { readonly options: readonly FormFieldOption[] })
  | (CheckboxFieldDefinition & {
      readonly options: readonly FormFieldOption[];
    });

function normalizeFormFieldDefinition(
  field: FormFieldDefinition,
): FormFieldDefinition {
  if (field.type === 'table') {
    return {
      ...field,
      columns: field.columns.map(normalizeTableColumnDefinition),
    };
  }

  if (field.type === 'select' || field.type === 'autocomplete') {
    return {
      ...field,
      mode: field.mode ?? 'single',
    };
  }

  return field;
}

function normalizeTableColumnDefinition(
  column: TableColumnDefinition,
): TableColumnDefinition {
  if (column.type === 'select' || column.type === 'autocomplete') {
    return {
      ...column,
      mode: column.mode ?? 'single',
    };
  }

  return column;
}
