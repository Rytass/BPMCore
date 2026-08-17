import type {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  isFormDataSourceDescriptorCompatible,
  readCompatibleFormDataSourceBindingFields,
  readCompatibleFormDataSourceDescriptors,
  readFormDataSourceBinding,
  readFormDataSourceParameterType,
  renameFormDataSourceFieldBindings,
  upsertFormDataSourceFieldBinding,
} from './form-data-source-builder';
import type { FormDataSourceDescriptorRecord } from './form-data-source-api';

describe('form DataSource builder helpers', () => {
  it('filters descriptors by control capability and bounded radio/checkbox rules', (): void => {
    const descriptors = [
      createDescriptor('select-source', ['select']),
      createDescriptor('radio-source', ['radio'], {
        maximumResultCount: 50,
        returnsCompleteList: true,
      }),
      createDescriptor('search-radio-source', ['radio'], {
        maximumResultCount: 50,
        returnsCompleteList: false,
      }),
      createDescriptor('large-checkbox-source', ['checkbox'], {
        maximumResultCount: 51,
        returnsCompleteList: true,
      }),
    ];

    expect(
      readCompatibleFormDataSourceDescriptors('radio', descriptors).map(
        (descriptor) => descriptor.key,
      ),
    ).toEqual(['radio-source']);
    expect(
      readCompatibleFormDataSourceDescriptors('select', descriptors).map(
        (descriptor) => descriptor.key,
      ),
    ).toEqual(['select-source']);
    expect(
      isFormDataSourceDescriptorCompatible(
        descriptors[2],
        'radio',
      ),
    ).toBe(false);
  });

  it('maps form field values to parameter types and excludes the target field', (): void => {
    const fields = createBindingFields();

    expect(readFormDataSourceParameterType(fields[0])).toBe('STRING');
    expect(readFormDataSourceParameterType(fields[1])).toBe('NUMBER');
    expect(readFormDataSourceParameterType(fields[2])).toBe('STRING_ARRAY');
    expect(
      readCompatibleFormDataSourceBindingFields(
        'STRING',
        fields,
        'target',
      ),
    ).toEqual([{ id: 'plant', name: 'Plant' }]);
  });

  it('upserts and removes one parameter binding without mutating the field', (): void => {
    const dynamicField = createDynamicField();
    const field: FormDataSourceOptionFieldDefinition = {
      ...dynamicField,
      dataSource: {
        ...dynamicField.dataSource,
        bindings: [],
      },
    };
    const nextField = upsertFormDataSourceFieldBinding(field, 'plant', {
      from: { fieldKey: 'plant', kind: 'FIELD' },
      parameter: 'plant',
    });

    expect(field.dataSource.bindings).toEqual([]);
    expect(readFormDataSourceBinding(nextField, 'plant')).toEqual({
      from: { fieldKey: 'plant', kind: 'FIELD' },
      parameter: 'plant',
    });

    const removedField = upsertFormDataSourceFieldBinding(
      nextField,
      'plant',
      null,
    );
    expect(removedField.dataSource.bindings).toEqual([]);
  });

  it('renames field bindings across the schema', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          fieldKey: 'plant',
          label: 'Plant',
          required: false,
          type: 'text',
        },
        createDynamicField(),
      ],
      schemaVersion: 1,
    };

    const renamed = renameFormDataSourceFieldBindings(
      schema,
      'plant',
      'plantCode',
    );
    const dynamicField = renamed.fields[1] as FormDataSourceOptionFieldDefinition;

    expect(dynamicField.dataSource.bindings[0]).toEqual({
      from: { fieldKey: 'plantCode', kind: 'FIELD' },
      parameter: 'plant',
    });
  });
});

function createDescriptor(
  key: string,
  supportedControls: FormDataSourceDescriptorRecord['supportedControls'],
  overrides: Partial<FormDataSourceDescriptorRecord> = {},
): FormDataSourceDescriptorRecord {
  return {
    description: null,
    key,
    label: key,
    maximumResultCount: 100,
    minimumSearchLength: 0,
    pageSize: 20,
    paginationMode: 'NONE',
    parameters: [],
    revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
    returnsCompleteList: false,
    supportedControls,
    supportsSearch: false,
    version: 1,
    ...overrides,
  };
}

function createBindingFields(): readonly FormFieldDefinition[] {
  return [
    {
      fieldKey: 'plant',
      label: 'Plant',
      required: false,
      type: 'text',
    },
    {
      fieldKey: 'amount',
      label: 'Amount',
      required: false,
      type: 'number',
    },
    {
      fieldKey: 'choices',
      label: 'Choices',
      options: [{ label: 'A', value: 'A' }],
      required: false,
      type: 'checkbox',
    },
    {
      fieldKey: 'target',
      label: 'Target',
      options: [{ label: 'A', value: 'A' }],
      required: false,
      type: 'select',
    },
  ];
}

function createDynamicField(): FormDataSourceOptionFieldDefinition {
  return {
    dataSource: {
      bindings: [
        {
          from: { fieldKey: 'plant', kind: 'FIELD' },
          parameter: 'plant',
        },
      ],
      key: 'demo.options',
      version: 1,
    },
    fieldKey: 'costCenter',
    label: 'Cost center',
    required: false,
    type: 'select',
  };
}
