import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  buildFormRendererValues,
  formatDatePickerValue,
  formatDateTimePickerValue,
  isFormRendererFieldRequired,
  isFormRendererFieldVisible,
  readFormTableCellPath,
  readFormTableRowBounds,
  readFormTableRows,
  validateFormRendererValues,
} from './form-rendering';

// Every expectation below is written for UTC+8, because the off-by-one-day bug
// these tests guard against only appears when the local calendar day differs
// from the UTC one. The zone is pinned in `jest.preset.js`, which the CLI loads
// before forking its workers — setting `process.env.TZ` from a `beforeAll` here
// looks like it works but does nothing, since the worker has already resolved
// its timezone by then.
//
// Assert the zone up front so removing that pin fails with the reason instead
// of an inscrutable one-day-off date mismatch.
describe('timezone assumption', () => {
  it('runs in UTC+8', (): void => {
    expect(new Date('2026-08-20T00:00:00Z').getTimezoneOffset()).toBe(-480);
  });
});

describe('formatDatePickerValue', () => {
  it('keeps the local calendar day for UTC values', (): void => {
    // 2026-08-19T16:00:00Z is 2026-08-20 00:00 in Asia/Taipei, which is what
    // the calendar adapter emits when the user picks the 20th.
    expect(formatDatePickerValue('2026-08-19T16:00:00.000Z')).toBe(
      '2026-08-20',
    );
  });

  it('keeps the local calendar day for offset-qualified values', (): void => {
    expect(formatDatePickerValue('2026-08-20T00:00:00+08:00')).toBe(
      '2026-08-20',
    );
    expect(formatDatePickerValue('2026-08-19T12:00:00-05:00')).toBe(
      '2026-08-20',
    );
  });

  it('treats zone-less values as local time', (): void => {
    expect(formatDatePickerValue('2026-08-20')).toBe('2026-08-20');
    expect(formatDatePickerValue('2026-08-20T09:30')).toBe('2026-08-20');
  });

  it('returns undefined for empty or unparsable values', (): void => {
    expect(formatDatePickerValue(undefined)).toBeUndefined();
    expect(formatDatePickerValue('')).toBeUndefined();
    expect(formatDatePickerValue('not-a-date')).toBeUndefined();
  });
});

describe('formatDateTimePickerValue', () => {
  it('preserves the instant for UTC values', (): void => {
    expect(formatDateTimePickerValue('2026-08-19T16:00:00.000Z')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('preserves the instant for offset-qualified values', (): void => {
    expect(formatDateTimePickerValue('2026-08-20T00:00:00+08:00')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('treats zone-less values as local time', (): void => {
    expect(formatDateTimePickerValue('2026-08-20T00:00')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('returns undefined for empty or unparsable values', (): void => {
    expect(formatDateTimePickerValue(undefined)).toBeUndefined();
    expect(formatDateTimePickerValue('not-a-date')).toBeUndefined();
  });
});

describe('table values as condition operands', () => {
  const tableField: FormFieldDefinition = {
    columns: [
      { fieldKey: 'name', label: '品項', required: true, type: 'text' },
    ],
    fieldKey: 'items',
    label: '請購明細',
    required: false,
    type: 'table',
  };
  const dependentField: FormFieldDefinition = {
    fieldKey: 'note',
    label: '備註',
    required: false,
    type: 'text',
    visibleWhen: 'form.items == "Bolt"',
  };

  // Row records used to fall into the multi-select branch and get string
  // compared, so a condition could decide visibility by accident. A table is
  // not a comparable operand in V1, so the caller's fallback stands
  // (ADR 16 §3.8).
  it('falls back instead of string-comparing row records', (): void => {
    expect(
      isFormRendererFieldVisible(dependentField, [tableField, dependentField], {
        items: [{ name: 'Bolt' }],
      }),
    ).toBe(true);
    expect(
      isFormRendererFieldVisible(dependentField, [tableField, dependentField], {
        items: [{ name: 'Nut' }],
      }),
    ).toBe(true);
  });

  it('does not make a table operand satisfy a requiredWhen condition', (): void => {
    expect(
      isFormRendererFieldRequired(
        {
          fieldKey: 'note',
          label: '備註',
          required: false,
          requiredWhen: 'form.items != "Bolt"',
          type: 'text',
        },
        [tableField],
        { items: [{ name: 'Nut' }] },
      ),
    ).toBe(false);
  });

  it('keeps the flat multi-select condition behaviour unchanged', (): void => {
    const tagsField: FormFieldDefinition = {
      fieldKey: 'tags',
      label: '標籤',
      mode: 'multiple',
      options: [{ label: 'A', value: 'a' }],
      required: false,
      type: 'select',
    };

    expect(
      isFormRendererFieldVisible(
        {
          fieldKey: 'note',
          label: '備註',
          required: false,
          type: 'text',
          visibleWhen: 'form.tags == "a"',
        },
        [tagsField],
        { tags: ['a'] },
      ),
    ).toBe(true);
  });
});

describe('table field values', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      {
        columns: [
          { fieldKey: 'name', label: '品項', required: true, type: 'text' },
          { fieldKey: 'qty', label: '數量', required: false, type: 'number' },
          {
            defaultValue: true,
            fieldKey: 'inStock',
            label: '有庫存',
            required: false,
            type: 'boolean',
          },
        ],
        fieldKey: 'items',
        label: '請購明細',
        maxRows: 3,
        minRows: 1,
        required: false,
        type: 'table',
      },
    ],
    schemaVersion: 1,
  };
  const uiSchema: FormUiSchema = {
    layout: [{ fieldKey: 'items', width: 'FULL' }],
    schemaVersion: 1,
  };

  it('seeds minRows rows from the column defaults', (): void => {
    expect(buildFormRendererValues(schema.fields, {}).items).toEqual([
      { inStock: true },
    ]);
  });

  it('leaves a column without a default absent rather than null', (): void => {
    const [row] = buildFormRendererValues(schema.fields, {})
      .items as readonly Readonly<Record<string, unknown>>[];

    expect(Object.prototype.hasOwnProperty.call(row, 'name')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'qty')).toBe(false);
  });

  it('reports a missing required cell by its instance path', (): void => {
    const result = validateFormRendererValues({
      schema,
      uiSchema,
      values: { items: [{ name: 'Bolt' }, { qty: 2 }] },
    });

    expect(result.errors).toEqual({ 'items[1].name': '品項為必填欄位。' });
    expect(result.firstInvalidFieldKey).toBe('items[1].name');
    expect(result.valid).toBe(false);
  });

  it('reports a row count problem on the table itself and stops there', (): void => {
    expect(
      validateFormRendererValues({ schema, uiSchema, values: { items: [] } })
        .errors,
    ).toEqual({ items: '請購明細至少需要 1 列。' });

    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { items: [{}, {}, {}, {}] },
      }).errors,
    ).toEqual({ items: '請購明細最多 3 列。' });
  });

  it('treats a required table as needing at least one row', (): void => {
    const tableField = schema.fields[0];

    if (!tableField || tableField.type !== 'table') {
      throw new Error('Expected the fixture to start with a table field.');
    }

    const requiredSchema: FormDefinitionSchema = {
      fields: [{ ...tableField, minRows: 0, required: true }],
      schemaVersion: 1,
    };

    expect(
      validateFormRendererValues({
        schema: requiredSchema,
        uiSchema,
        values: { items: [] },
      }).errors,
    ).toEqual({ items: '請購明細至少需要 1 列。' });
  });

  it('accepts rows that satisfy every required column', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { items: [{ name: 'Bolt', qty: 3 }] },
      }),
    ).toEqual({ errors: {}, firstInvalidFieldKey: null, valid: true });
  });

  it('builds a cell instance path', (): void => {
    expect(readFormTableCellPath('items', 2, 'qty')).toBe('items[2].qty');
  });

  it('reads rows only from a table-shaped value', (): void => {
    expect(readFormTableRows([{ name: 'Bolt' }])).toEqual([{ name: 'Bolt' }]);
    expect(readFormTableRows(['a', 'b'])).toEqual([]);
    expect(readFormTableRows('not-a-table')).toEqual([]);
    expect(readFormTableRows(undefined)).toEqual([]);
  });

  it('falls back to the hard ceiling when maxRows is absent', (): void => {
    expect(
      readFormTableRowBounds({
        columns: [],
        fieldKey: 'items',
        label: '明細',
        required: false,
        type: 'table',
      }),
    ).toEqual({ maxRows: 100, minRows: 0 });
  });
});
