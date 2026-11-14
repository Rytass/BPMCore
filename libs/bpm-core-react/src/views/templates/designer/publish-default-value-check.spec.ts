import type {
  FormDataSourceResolveResultRecord,
  PreviewResolveFormFieldOptionsInput,
} from '@rytass/bpm-core-client/form';
import type {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  readDefaultValueStrings,
  readPublishDefaultValueNoticeMessage,
  readPublishDefaultValueNotices,
  type PreviewResolveFormFieldOptions,
} from './publish-default-value-check';

const UI_SCHEMA: FormUiSchema = { layout: [], schemaVersion: 1 };

function resolveResult(
  unresolvedValues: readonly string[],
): FormDataSourceResolveResultRecord {
  return {
    dataSourceKey: 'departments',
    dataSourceVersion: 1,
    options: [],
    unresolvedValues,
    waitingForFieldKeys: [],
  };
}

function schemaWith(
  fields: FormDefinitionSchema['fields'],
): FormDefinitionSchema {
  return { fields, schemaVersion: 1 };
}

describe('readDefaultValueStrings', () => {
  it('reads a single value, a list, and drops empty strings', () => {
    expect(readDefaultValueStrings('A')).toEqual(['A']);
    expect(readDefaultValueStrings('')).toEqual([]);
    expect(readDefaultValueStrings(['A', '', 'B'])).toEqual(['A', 'B']);
    expect(readDefaultValueStrings(undefined)).toEqual([]);
    expect(readDefaultValueStrings(null)).toEqual([]);
  });
});

describe('readPublishDefaultValueNotices', () => {
  it('asks nothing when no dynamic option field carries a default', async () => {
    const preview = jest.fn<
      ReturnType<PreviewResolveFormFieldOptions>,
      [PreviewResolveFormFieldOptionsInput]
    >();

    const notices = await readPublishDefaultValueNotices({
      preview,
      schema: schemaWith([
        {
          dataSource: { bindings: [], key: 'departments', version: 1 },
          fieldKey: 'dept',
          label: '部門',
          type: 'select',
        },
        {
          fieldKey: 'note',
          label: '備註',
          type: 'text',
          defaultValue: 'x',
        },
      ]),
      uiSchema: UI_SCHEMA,
    });

    expect(notices).toEqual([]);
    expect(preview).not.toHaveBeenCalled();
  });

  it('skips a dependent field and a static option field', async () => {
    const preview = jest.fn<
      ReturnType<PreviewResolveFormFieldOptions>,
      [PreviewResolveFormFieldOptionsInput]
    >();

    const notices = await readPublishDefaultValueNotices({
      preview,
      schema: schemaWith([
        {
          dataSource: {
            bindings: [
              { from: { fieldKey: 'dept', kind: 'FIELD' }, parameter: 'd' },
            ],
            key: 'employees',
            version: 1,
          },
          defaultValue: 'E1',
          fieldKey: 'owner',
          label: '負責人',
          type: 'select',
        },
        {
          defaultValue: 'A',
          fieldKey: 'static',
          label: '靜態',
          options: [{ label: 'A', value: 'A' }],
          type: 'select',
        },
      ]),
      uiSchema: UI_SCHEMA,
    });

    expect(notices).toEqual([]);
    expect(preview).not.toHaveBeenCalled();
  });

  it('reports only the default values the source no longer offers', async () => {
    const schema = schemaWith([
      {
        dataSource: { bindings: [], key: 'departments', version: 1 },
        defaultValue: ['D1', 'D2'],
        fieldKey: 'depts',
        label: '部門',
        mode: 'multiple',
        type: 'select',
      },
    ]);
    const preview = jest.fn<
      ReturnType<PreviewResolveFormFieldOptions>,
      [PreviewResolveFormFieldOptionsInput]
    >(async () => resolveResult(['D2']));

    const notices = await readPublishDefaultValueNotices({
      preview,
      schema,
      uiSchema: UI_SCHEMA,
    });

    expect(preview).toHaveBeenCalledWith({
      fieldKey: 'depts',
      schema,
      uiSchema: UI_SCHEMA,
      values: ['D1', 'D2'],
    });
    expect(notices).toEqual([
      {
        fieldKey: 'depts',
        label: '部門',
        status: 'UNRESOLVED',
        values: ['D2'],
      },
    ]);
  });

  it('reports nothing when every default is still offered', async () => {
    const notices = await readPublishDefaultValueNotices({
      preview: async () => resolveResult([]),
      schema: schemaWith([
        {
          dataSource: { bindings: [], key: 'departments', version: 1 },
          defaultValue: 'D1',
          fieldKey: 'dept',
          label: '部門',
          type: 'select',
        },
      ]),
      uiSchema: UI_SCHEMA,
    });

    expect(notices).toEqual([]);
  });

  it('reports CHECK_FAILED instead of throwing when the lookup fails', async () => {
    const notices = await readPublishDefaultValueNotices({
      preview: async () => {
        throw new Error('network down');
      },
      schema: schemaWith([
        {
          dataSource: { bindings: [], key: 'departments', version: 1 },
          defaultValue: 'D1',
          fieldKey: 'dept',
          label: '部門',
          type: 'select',
        },
      ]),
      uiSchema: UI_SCHEMA,
    });

    expect(notices).toEqual([
      { fieldKey: 'dept', label: '部門', status: 'CHECK_FAILED', values: [] },
    ]);
  });
});

describe('readPublishDefaultValueNoticeMessage', () => {
  it('names the field and the stale value for an unresolved default', () => {
    expect(
      readPublishDefaultValueNoticeMessage({
        fieldKey: 'dept',
        label: '部門',
        status: 'UNRESOLVED',
        values: ['D2'],
      }),
    ).toContain('欄位「部門」的預設值「D2」');
  });
});
