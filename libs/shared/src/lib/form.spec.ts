import {
  FormDefinitionSchema,
  isFormIdentifierKey,
  isFormTableCellValue,
  isFormTableRowValue,
  isFormTableRowValues,
  isTableColumnFieldType,
  isTableFieldDefinition,
  normalizeFormDefinitionSchema,
  readFormTableCellValue,
  TABLE_COLUMN_FIELD_TYPES,
} from './form';

describe('form table contracts', () => {
  it('normalizes select and autocomplete columns inside a table', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          columns: [
            {
              fieldKey: 'kind',
              label: 'Kind',
              options: [{ label: 'A', value: 'a' }],
              required: false,
              type: 'select',
            },
            {
              fieldKey: 'vendor',
              label: 'Vendor',
              mode: 'multiple',
              options: [{ label: 'A', value: 'a' }],
              required: false,
              type: 'autocomplete',
            },
            {
              fieldKey: 'qty',
              label: 'Quantity',
              required: true,
              type: 'number',
            },
          ],
          fieldKey: 'items',
          label: 'Items',
          required: true,
          type: 'table',
        },
      ],
      schemaVersion: 1,
    };
    const normalized = normalizeFormDefinitionSchema(schema);
    const table = normalized.fields[0];

    expect(table && isTableFieldDefinition(table)).toBe(true);
    expect(table && isTableFieldDefinition(table) ? table.columns : []).toEqual([
      {
        fieldKey: 'kind',
        label: 'Kind',
        mode: 'single',
        options: [{ label: 'A', value: 'a' }],
        required: false,
        type: 'select',
      },
      {
        fieldKey: 'vendor',
        label: 'Vendor',
        mode: 'multiple',
        options: [{ label: 'A', value: 'a' }],
        required: false,
        type: 'autocomplete',
      },
      {
        fieldKey: 'qty',
        label: 'Quantity',
        required: true,
        type: 'number',
      },
    ]);
  });

  it('leaves a table-free schema byte-identical after normalization', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          defaultValue: 'A-001',
          fieldKey: 'code',
          label: 'Code',
          required: true,
          type: 'text',
        },
        {
          fieldKey: 'kind',
          label: 'Kind',
          mode: 'single',
          options: [{ label: 'A', value: 'a' }],
          required: false,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    };

    expect(normalizeFormDefinitionSchema(schema)).toEqual(schema);
  });

  it('reports which field types a column may use', (): void => {
    expect(isTableColumnFieldType('text')).toBe(true);
    expect(isTableColumnFieldType('select')).toBe(true);
    expect(isTableColumnFieldType('textarea')).toBe(false);
    expect(isTableColumnFieldType('radio')).toBe(false);
    expect(isTableColumnFieldType('checkbox')).toBe(false);
    expect(isTableColumnFieldType('file_upload')).toBe(false);
    expect(isTableColumnFieldType('table')).toBe(false);
    expect(TABLE_COLUMN_FIELD_TYPES).not.toContain('textarea');
  });

  it('separates cell values from row values', (): void => {
    expect(isFormTableCellValue('a')).toBe(true);
    expect(isFormTableCellValue(['a', 'b'])).toBe(true);
    expect(isFormTableCellValue(null)).toBe(true);
    expect(isFormTableCellValue({ qty: 1 })).toBe(false);
    expect(isFormTableRowValue({ name: 'a', qty: 1, tags: ['x'] })).toBe(true);
    expect(isFormTableRowValue({ nested: { qty: 1 } })).toBe(false);
    expect(isFormTableRowValue(['a'])).toBe(false);
    expect(isFormTableRowValues([{ qty: 1 }, { qty: 2 }])).toBe(true);
    expect(isFormTableRowValues(['a'])).toBe(false);
    expect(isFormTableRowValues('a')).toBe(false);
  });

  it('treats an empty array as the primitive it has always been', (): void => {
    // `[]` is both an empty multi-select value and an empty table; without a
    // field definition the primitive reading is the compatible one.
    expect(isFormTableRowValues([])).toBe(true);
    expect(readFormTableCellValue([])).toEqual([]);
  });

  it('narrows table row values away from primitive read paths', (): void => {
    expect(readFormTableCellValue('a')).toBe('a');
    expect(readFormTableCellValue(42)).toBe(42);
    expect(readFormTableCellValue(null)).toBeNull();
    expect(readFormTableCellValue(undefined)).toBeUndefined();
    expect(readFormTableCellValue([{ qty: 1 }])).toBeUndefined();
  });

  it('accepts only plain identifiers as table and column keys', (): void => {
    expect(isFormIdentifierKey('items')).toBe(true);
    expect(isFormIdentifierKey('_items2')).toBe(true);
    expect(isFormIdentifierKey('2items')).toBe(false);
    expect(isFormIdentifierKey('line-items')).toBe(false);
    expect(isFormIdentifierKey('items.qty')).toBe(false);
    expect(isFormIdentifierKey('')).toBe(false);
  });
});
