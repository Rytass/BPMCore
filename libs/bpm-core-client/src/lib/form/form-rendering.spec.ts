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
  readVisibleFormRendererFields,
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

  // The launch and resubmit views hold their own copy of the values, which
  // stays empty until the filler edits something — while the renderer already
  // shows the seeded rows. Validating the untouched copy reported "at least 1
  // row" for a table with a visible row, so both views must compose these two
  // the way this test does.
  it('needs the seeded values to agree with what the renderer shows', (): void => {
    expect(
      validateFormRendererValues({ schema, uiSchema, values: {} }).errors,
    ).toEqual({ items: '請購明細至少需要 1 列。' });

    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: buildFormRendererValues(schema.fields, {}),
      }).errors,
    ).toEqual({ 'items[0].name': '品項為必填欄位。' });
  });

  // `constructor` and friends satisfy the column key identifier rule, so a
  // plain index read walks the prototype chain and calls an empty row filled —
  // passing a submission the backend then rejects. The backend guards this in
  // `readRowCellValue`; this is the matching frontend guard.
  it('does not read a required cell off the row prototype', (): void => {
    const prototypeSchema: FormDefinitionSchema = {
      fields: [
        {
          columns: [
            {
              fieldKey: 'constructor',
              label: '建構',
              required: true,
              type: 'text',
            },
            { fieldKey: 'toString', label: '字串', required: true, type: 'text' },
          ],
          fieldKey: 'items',
          label: '明細',
          required: false,
          type: 'table',
        },
      ],
      schemaVersion: 1,
    };

    expect(
      validateFormRendererValues({
        schema: prototypeSchema,
        uiSchema: {
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        },
        values: { items: [{}] },
      }).errors,
    ).toEqual({
      'items[0].constructor': '建構為必填欄位。',
      'items[0].toString': '字串為必填欄位。',
    });
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

describe('hidden (store-only) fields', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
      {
        fieldKey: 'sourceDocId',
        hidden: true,
        label: '來源單據',
        required: true,
        type: 'text',
      },
      {
        fieldKey: 'docVersion',
        hidden: true,
        label: '版本',
        required: false,
        type: 'number',
        visibleWhen: 'form.reason == "x"',
      },
    ],
    schemaVersion: 1,
  };
  const uiSchema: FormUiSchema = {
    layout: [
      { fieldKey: 'sourceDocId', width: 'FULL' },
      { fieldKey: 'reason', width: 'FULL' },
    ],
    schemaVersion: 1,
  };

  it('is never visible, whatever visibleWhen says', (): void => {
    const [reason, sourceDocId, docVersion] = schema.fields;

    expect(isFormRendererFieldVisible(reason, schema.fields, {})).toBe(true);
    expect(isFormRendererFieldVisible(sourceDocId, schema.fields, {})).toBe(
      false,
    );
    expect(
      isFormRendererFieldVisible(docVersion, schema.fields, { reason: 'x' }),
    ).toBe(false);
  });

  it('is left out of the rendered field list', (): void => {
    expect(
      readVisibleFormRendererFields(schema, uiSchema, { reason: 'x' }).map(
        (field) => field.fieldKey,
      ),
    ).toEqual(['reason']);
  });

  it('is skipped by client validation even when marked required', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { reason: 'ok' },
      }),
    ).toEqual({ errors: {}, firstInvalidFieldKey: null, valid: true });
  });

  it('keeps its stored value in the values the renderer emits', (): void => {
    const emitted = buildFormRendererValues(schema.fields, {
      docVersion: 3,
      reason: 'ok',
      sourceDocId: 'PO-1',
    });

    expect(emitted).toMatchObject({
      docVersion: 3,
      reason: 'ok',
      sourceDocId: 'PO-1',
    });
  });
});

describe('member fields in the renderer', () => {
  const single: FormFieldDefinition = {
    fieldKey: 'reviewer',
    label: '審核人',
    required: true,
    type: 'member',
  };
  const multiple: FormFieldDefinition = {
    fieldKey: 'watchers',
    label: '關注者',
    multiple: true,
    required: true,
    type: 'member',
  };
  const schema: FormDefinitionSchema = {
    fields: [single, multiple],
    schemaVersion: 1,
  };
  const uiSchema: FormUiSchema = {
    layout: [
      { fieldKey: 'reviewer', width: 'HALF' },
      { fieldKey: 'watchers', width: 'HALF' },
    ],
    schemaVersion: 1,
  };

  it('starts a single field empty and a multiple field as an empty list', (): void => {
    const values = buildFormRendererValues(schema.fields, {});

    expect(values.reviewer).toBeUndefined();
    expect(values.watchers).toEqual([]);
  });

  it('keeps a stored member value instead of resetting it', (): void => {
    expect(
      buildFormRendererValues(schema.fields, {
        reviewer: 'm1',
        watchers: ['m1', 'm2'],
      }),
    ).toEqual({ reviewer: 'm1', watchers: ['m1', 'm2'] });
  });

  it('reports a required member field that nobody was picked for', (): void => {
    const result = validateFormRendererValues({
      schema,
      uiSchema,
      values: buildFormRendererValues(schema.fields, {}),
    });

    expect(result.errors).toEqual({
      reviewer: '審核人為必填欄位。',
      watchers: '關注者為必填欄位。',
    });
  });

  it('accepts a required member field once someone is picked', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { reviewer: 'm1', watchers: ['m2'] },
      }).valid,
    ).toBe(true);
  });
});

describe('org unit fields in the renderer', () => {
  const field: FormFieldDefinition = {
    fieldKey: 'department',
    label: '申請部門',
    required: true,
    type: 'org_unit',
  };
  const schema: FormDefinitionSchema = { fields: [field], schemaVersion: 1 };
  const uiSchema: FormUiSchema = {
    layout: [{ fieldKey: 'department', width: 'HALF' }],
    schemaVersion: 1,
  };
  const UNIT_ID = '3f2b1c4e-0000-4000-8000-000000000001';

  it('starts empty and keeps a stored org unit id', (): void => {
    expect(buildFormRendererValues(schema.fields, {}).department).toBeUndefined();
    expect(
      buildFormRendererValues(schema.fields, { department: UNIT_ID }),
    ).toEqual({ department: UNIT_ID });
  });

  it('reports a required org unit field nobody picked', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: buildFormRendererValues(schema.fields, {}),
      }).errors,
    ).toEqual({ department: '申請部門為必填欄位。' });
  });

  it('accepts a required org unit field once a unit is picked', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { department: UNIT_ID },
      }).valid,
    ).toBe(true);
  });
});

describe('text length and format in the renderer', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      {
        fieldKey: 'taxId',
        label: '統一編號',
        maxLength: 8,
        minLength: 8,
        pattern: '[0-9]+',
        patternErrorMessage: '統一編號只能是數字。',
        required: false,
        type: 'text',
      },
      {
        fieldKey: 'code',
        label: '代碼',
        pattern: '[A-Z]{3}',
        required: false,
        type: 'text',
      },
      {
        columns: [
          {
            fieldKey: 'note',
            label: '備註',
            maxLength: 3,
            required: false,
            type: 'text',
          },
        ],
        fieldKey: 'items',
        label: '明細',
        required: false,
        type: 'table',
      },
    ],
    schemaVersion: 1,
  };
  const uiSchema: FormUiSchema = {
    layout: [
      { fieldKey: 'taxId', width: 'HALF' },
      { fieldKey: 'code', width: 'HALF' },
      { fieldKey: 'items', width: 'FULL' },
    ],
    schemaVersion: 1,
  };

  it('accepts values that satisfy every rule, and empty optional fields', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { code: 'ABC', items: [{ note: 'ok' }], taxId: '12345678' },
      }).valid,
    ).toBe(true);
    expect(
      validateFormRendererValues({ schema, uiSchema, values: {} }).valid,
    ).toBe(true);
  });

  it('reports length before format, and the designer message for a mismatch', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { code: 'abc', taxId: '1234' },
      }).errors,
    ).toEqual({
      code: '代碼格式不正確。',
      taxId: '統一編號至少需要 8 個字。',
    });
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { taxId: '1234567A' },
      }).errors,
    ).toEqual({ taxId: '統一編號只能是數字。' });
  });

  it('reports an over-long table cell by its instance path', (): void => {
    expect(
      validateFormRendererValues({
        schema,
        uiSchema,
        values: { items: [{ note: 'ok' }, { note: 'toolong' }] },
      }).errors,
    ).toEqual({ 'items[1].note': '備註最多 3 個字。' });
  });
});
