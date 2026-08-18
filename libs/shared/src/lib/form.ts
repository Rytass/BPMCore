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
  | FileUploadFieldDefinition;

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

export type FormFieldValue =
  | boolean
  | number
  | string
  | readonly string[]
  | null;

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

export type FormDataSourceBinding =
  | {
      readonly from: {
        readonly fieldKey: string;
        readonly kind: 'FIELD';
      };
      readonly parameter: string;
    }
  | {
      readonly from: {
        readonly kind: 'CONSTANT';
        readonly value: boolean | number | string | null;
      };
      readonly parameter: string;
    };

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
  if (field.type === 'select' || field.type === 'autocomplete') {
    return {
      ...field,
      mode: field.mode ?? 'single',
    };
  }

  return field;
}
