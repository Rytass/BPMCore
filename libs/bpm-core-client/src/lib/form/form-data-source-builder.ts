import {
  FormDataSourceBinding,
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  isFormDataSourceFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  FormDataSourceControl,
  FormDataSourceDescriptorRecord,
  FormDataSourceParameterType,
} from './form-data-source-api';

export interface FormDataSourceBindingFieldOption {
  readonly id: string;
  readonly name: string;
}

export function isFormDataSourceDescriptorCompatible(
  descriptor: FormDataSourceDescriptorRecord,
  control: FormDataSourceControl,
): boolean {
  if (!descriptor.supportedControls.includes(control)) {
    return false;
  }

  return control === 'radio' || control === 'checkbox'
    ? descriptor.returnsCompleteList && descriptor.maximumResultCount <= 50
    : true;
}

export function readCompatibleFormDataSourceDescriptors(
  control: FormDataSourceControl,
  descriptors: readonly FormDataSourceDescriptorRecord[],
): readonly FormDataSourceDescriptorRecord[] {
  return descriptors.filter((descriptor) =>
    isFormDataSourceDescriptorCompatible(descriptor, control),
  );
}

export function readFormDataSourceParameterType(
  field: FormFieldDefinition,
): FormDataSourceParameterType | null {
  switch (field.type) {
    case 'boolean':
      return 'BOOLEAN';
    case 'checkbox':
    case 'file_upload':
      return 'STRING_ARRAY';
    case 'money':
    case 'number':
      return 'NUMBER';
    case 'autocomplete':
    case 'radio':
    case 'select': {
      const mode = readFormFieldSelectionMode(field);

      return mode === 'multiple' ? 'STRING_ARRAY' : 'STRING';
    }
    case 'date':
    case 'datetime':
    case 'text':
    case 'textarea':
      return 'STRING';
    default:
      return null;
  }
}

export function readCompatibleFormDataSourceBindingFields(
  parameterType: FormDataSourceParameterType,
  fields: readonly FormFieldDefinition[],
  targetFieldKey: string,
): readonly FormDataSourceBindingFieldOption[] {
  return fields
    .filter((field) => field.fieldKey !== targetFieldKey)
    .filter(
      (field) => readFormDataSourceParameterType(field) === parameterType,
    )
    .map((field) => ({ id: field.fieldKey, name: field.label }));
}

export function readFormDataSourceBinding(
  field: FormDataSourceOptionFieldDefinition,
  parameterKey: string,
): FormDataSourceBinding | null {
  return (
    field.dataSource.bindings.find(
      (binding) => binding.parameter === parameterKey,
    ) ?? null
  );
}

export function upsertFormDataSourceFieldBinding(
  field: FormDataSourceOptionFieldDefinition,
  parameterKey: string,
  binding: FormDataSourceBinding | null,
): FormDataSourceOptionFieldDefinition {
  const nextBindings = field.dataSource.bindings
    .filter((candidate) => candidate.parameter !== parameterKey)
    .concat(binding ? [binding] : []);

  return {
    ...field,
    dataSource: {
      ...field.dataSource,
      bindings: nextBindings,
    },
  };
}

export function renameFormDataSourceFieldBindings(
  schema: FormDefinitionSchema,
  previousFieldKey: string,
  nextFieldKey: string,
): FormDefinitionSchema {
  return {
    ...schema,
    fields: schema.fields.map((field) => {
      if (!isFormDataSourceFieldDefinition(field)) {
        return field;
      }

      return {
        ...field,
        dataSource: {
          ...field.dataSource,
          bindings: field.dataSource.bindings.map((binding) =>
            binding.from.kind === 'FIELD' &&
            binding.from.fieldKey === previousFieldKey
              ? {
                  ...binding,
                  from: {
                    ...binding.from,
                    fieldKey: nextFieldKey,
                  },
                }
              : binding,
          ),
        },
      };
    }),
  };
}

export function readFormDataSourceFieldDependencyKeys(
  field: FormDataSourceOptionFieldDefinition,
): readonly string[] {
  return field.dataSource.bindings.flatMap((binding) =>
    binding.from.kind === 'FIELD' ? [binding.from.fieldKey] : [],
  );
}

export function readFormDataSourceBindingValue(
  field: FormDataSourceOptionFieldDefinition,
  parameterKey: string,
): FormFieldValue | undefined {
  const binding = readFormDataSourceBinding(field, parameterKey);

  return binding?.from.kind === 'CONSTANT' ? binding.from.value : undefined;
}

export type FormDataSourceBindingValueKind = 'CONSTANT' | 'FIELD';

export function readFormDataSourceBindingValueKind(
  binding: FormDataSourceBinding | null,
): FormDataSourceBindingValueKind | null {
  const kind = binding?.from.kind;

  // ROW_FIELD only exists on table columns, which the builder cannot edit yet
  // (P3); reporting null keeps the top-level binding editor unchanged.
  return kind === 'CONSTANT' || kind === 'FIELD' ? kind : null;
}
