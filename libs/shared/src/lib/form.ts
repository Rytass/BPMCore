export interface FormDefinitionSchema {
  readonly fields: readonly FormFieldDefinition[];
  readonly schemaVersion: 1;
}

export type FormFieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | DateFieldDefinition
  | SelectFieldDefinition
  | BooleanFieldDefinition
  | FileUploadFieldDefinition;

interface BaseFormFieldDefinition<TType extends string> {
  readonly defaultValue?: FormFieldValue;
  readonly description?: string;
  readonly fieldKey: string;
  readonly label: string;
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

export type SelectFieldDefinition = BaseFormFieldDefinition<
  'select' | 'radio' | 'checkbox'
> & {
  readonly options: readonly FormFieldOption[];
};

export interface FormFieldOption {
  readonly label: string;
  readonly value: string;
}

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
