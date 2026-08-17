import {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
} from '@rytass/bpm-core-shared/form';
import {
  mergeFormDataSourceOptions,
  readMissingFormDataSourceOptionValues,
  readMissingFormDataSourceDependencies,
  readSelectedFormDataSourceOptions,
} from './form-data-source-state';

describe('form data source state helpers', () => {
  it('merges pages in stable order and lets newer labels win', (): void => {
    expect(
      mergeFormDataSourceOptions(
        [{ label: 'Old A', value: 'A' }, { label: 'B', value: 'B' }],
        [{ label: 'New A', value: 'A' }, { label: 'C', value: 'C' }],
      ),
    ).toEqual([
      { label: 'New A', value: 'A' },
      { label: 'B', value: 'B' },
      { label: 'C', value: 'C' },
    ]);
  });

  it('hydrates only selected values that have authoritative labels', (): void => {
    expect(
      readSelectedFormDataSourceOptions('A', [
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
      ]),
    ).toEqual([{ label: 'A', value: 'A' }]);
    expect(
      readSelectedFormDataSourceOptions(['A', 'MISSING'], [
        { label: 'A', value: 'A' },
      ]),
    ).toEqual([{ label: 'A', value: 'A' }]);
  });

  it('reports field bindings that are not ready', (): void => {
    const field = createDynamicField();

    expect(
      readMissingFormDataSourceDependencies(field, { costCenter: undefined }),
    ).toEqual(['plant']);
    expect(
      readMissingFormDataSourceDependencies(field, {
        costCenter: undefined,
        plant: 'TPE',
      }),
    ).toEqual([]);
  });

  it('keeps the unresolved selected values in their original order', (): void => {
    expect(
      readMissingFormDataSourceOptionValues(['A', 'MISSING', 'B'], [
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
      ]),
    ).toEqual(['MISSING']);
  });
});

function createDynamicField(): FormDataSourceOptionFieldDefinition {
  const schema: FormDefinitionSchema = {
    fields: [
      {
        fieldKey: 'plant',
        label: 'Plant',
        required: true,
        type: 'text',
      },
      {
        dataSource: {
          bindings: [
            {
              from: { fieldKey: 'plant', kind: 'FIELD' },
              parameter: 'plant',
            },
          ],
          key: 'demo.cost-centers',
          version: 1,
        },
        fieldKey: 'costCenter',
        label: 'Cost center',
        required: false,
        type: 'select',
      },
    ],
    schemaVersion: 1,
  };

  return schema.fields[1] as FormDataSourceOptionFieldDefinition;
}
