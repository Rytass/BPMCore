import {
  readFilterOperatorsForFieldType,
  readFilterableFieldPaths,
  type FormDefinitionSchema,
} from '@rytass/bpm-core-shared';
import {
  buildApprovalInstanceFieldFilters,
  EMPTY_FIELD_FILTER_DRAFT,
  isSortFieldAvailable,
  readFieldFilterControl,
  readSortFieldOptions,
  toApprovalInstanceFieldFilter,
  toApprovalInstanceSort,
  type FieldFilterDraft,
  type FieldFilterDrafts,
} from './approval-instance-field-filters';

const schema: FormDefinitionSchema = {
  fields: [
    {
      fieldKey: 'vendor',
      filterable: true,
      label: '廠商',
      options: [
        { label: '甲廠商', value: 'v1' },
        { label: '華碩', value: 'v2' },
      ],
      required: false,
      type: 'select',
    },
    {
      fieldKey: 'amount',
      filterable: true,
      label: '金額',
      required: false,
      type: 'money',
    },
    {
      fieldKey: 'submitDate',
      filterable: true,
      label: '申請日',
      required: false,
      type: 'date',
    },
    {
      fieldKey: 'visitAt',
      filterable: true,
      label: '拜訪時間',
      required: false,
      type: 'datetime',
    },
    {
      fieldKey: 'urgent',
      filterable: true,
      label: '加急',
      required: false,
      type: 'boolean',
    },
    {
      fieldKey: 'applicant',
      filterable: true,
      label: '申請人',
      required: false,
      type: 'member',
    },
    {
      fieldKey: 'remark',
      filterable: true,
      label: '備註',
      required: false,
      type: 'textarea',
    },
    { fieldKey: 'secret', label: '不可篩選', required: false, type: 'text' },
    {
      columns: [
        {
          fieldKey: 'sku',
          filterable: true,
          label: '品號',
          required: false,
          type: 'text',
        },
        {
          fieldKey: 'qty',
          filterable: true,
          label: '數量',
          required: false,
          type: 'number',
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

const paths = readFilterableFieldPaths(schema);

function readPath(path: string): (typeof paths)[number] {
  const found = paths.find((item) => item.path === path);

  if (!found) {
    throw new Error(`missing filterable path ${path}`);
  }

  return found;
}

function draft(overrides: Partial<FieldFilterDraft>): FieldFilterDraft {
  return { ...EMPTY_FIELD_FILTER_DRAFT, ...overrides };
}

describe('readFieldFilterControl', () => {
  it('produces one control per filterable field, and only the schema filterable fields', () => {
    expect(paths.map((item) => item.path)).toEqual([
      'vendor',
      'amount',
      'submitDate',
      'visitAt',
      'urgent',
      'applicant',
      'remark',
      'items.sku',
      'items.qty',
    ]);
    expect(paths.map((item) => readFieldFilterControl(item).kind)).toEqual([
      'option-in',
      'number-range',
      'date-range',
      'datetime-range',
      'boolean',
      'id-in',
      'contains',
      'contains',
      'number-range',
    ]);
  });

  it('gives every control an operator the field type allows (ADR 25 §7.2)', () => {
    const operatorByKind = {
      boolean: 'EQUALS',
      contains: 'CONTAINS',
      'date-range': 'RANGE',
      'datetime-range': 'RANGE',
      'id-in': 'IN',
      'number-range': 'RANGE',
      'option-in': 'IN',
    } as const;

    for (const item of paths) {
      const filter = toApprovalInstanceFieldFilter(item, {
        ...EMPTY_FIELD_FILTER_DRAFT,
        from: '1',
        text: 'x',
        values: ['v1'],
      });
      const operator = operatorByKind[readFieldFilterControl(item).kind];

      expect(readFilterOperatorsForFieldType(item.field.type)).toContain(
        operator,
      );
      expect(filter === null || filter.operator === operator).toBe(true);
    }
  });

  it('marks an option field without static options (a data source) as a free-text CONTAINS', () => {
    const dynamic = readFilterableFieldPaths({
      fields: [
        {
          fieldKey: 'vendorSource',
          filterable: true,
          label: '廠商（資料來源）',
          required: false,
          type: 'autocomplete',
        },
      ],
      schemaVersion: 1,
    });

    expect(dynamic.map((item) => readFieldFilterControl(item).kind)).toEqual([
      'contains',
    ]);
  });
});

describe('toApprovalInstanceFieldFilter', () => {
  it('turns a text draft into CONTAINS, and drops a blank one', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('remark'),
        draft({ text: '  急件  ' }),
      ),
    ).toEqual({ fieldKey: 'remark', operator: 'CONTAINS', values: ['急件'] });
    expect(
      toApprovalInstanceFieldFilter(readPath('remark'), draft({ text: '   ' })),
    ).toBeNull();
  });

  it('turns selected static options into IN, keeping every value', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('vendor'),
        draft({ values: ['v1', 'v2'] }),
      ),
    ).toEqual({ fieldKey: 'vendor', operator: 'IN', values: ['v1', 'v2'] });
    expect(
      toApprovalInstanceFieldFilter(readPath('vendor'), draft({})),
    ).toBeNull();
  });

  it('turns a number range into RANGE with decimal strings, one end or both', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('amount'),
        draft({ from: ' 100 ', to: '500.50' }),
      ),
    ).toEqual({
      fieldKey: 'amount',
      from: '100',
      operator: 'RANGE',
      to: '500.50',
    });
    expect(
      toApprovalInstanceFieldFilter(readPath('amount'), draft({ from: '100' })),
    ).toEqual({ fieldKey: 'amount', from: '100', operator: 'RANGE' });
    expect(
      toApprovalInstanceFieldFilter(readPath('amount'), draft({ from: 'abc' })),
    ).toBeNull();
    expect(
      toApprovalInstanceFieldFilter(
        readPath('amount'),
        draft({ from: '1,000', to: '12,500.5' }),
      ),
    ).toEqual({
      fieldKey: 'amount',
      from: '1000',
      operator: 'RANGE',
      to: '12500.5',
    });
  });

  it('passes canonical date and datetime bounds through as RANGE', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('submitDate'),
        draft({ from: '2026-11-01', to: '2026-11-30' }),
      ),
    ).toEqual({
      fieldKey: 'submitDate',
      from: '2026-11-01',
      operator: 'RANGE',
      to: '2026-11-30',
    });
    expect(
      toApprovalInstanceFieldFilter(
        readPath('visitAt'),
        draft({ from: '2026-11-03T08:30:00.000Z' }),
      ),
    ).toEqual({
      fieldKey: 'visitAt',
      from: '2026-11-03T08:30:00.000Z',
      operator: 'RANGE',
    });
  });

  it('turns a boolean choice into EQUALS with the string form', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('urgent'),
        draft({ values: ['true'] }),
      ),
    ).toEqual({ fieldKey: 'urgent', operator: 'EQUALS', values: ['true'] });
    expect(
      toApprovalInstanceFieldFilter(readPath('urgent'), draft({})),
    ).toBeNull();
  });

  it('splits comma-separated ids for member IN and uses the table column path as fieldKey', () => {
    expect(
      toApprovalInstanceFieldFilter(
        readPath('applicant'),
        draft({ text: 'm-1, m-2 ,,' }),
      ),
    ).toEqual({
      fieldKey: 'applicant',
      operator: 'IN',
      values: ['m-1', 'm-2'],
    });
    expect(
      toApprovalInstanceFieldFilter(
        readPath('items.qty'),
        draft({ from: '10' }),
      ),
    ).toEqual({ fieldKey: 'items.qty', from: '10', operator: 'RANGE' });
  });
});

describe('buildApprovalInstanceFieldFilters', () => {
  it('keeps only non-empty conditions, in schema order', () => {
    const drafts: FieldFilterDrafts = {
      amount: draft({ from: '100', to: '200' }),
      remark: draft({ text: '' }),
      vendor: draft({ values: ['v2'] }),
    };

    expect(buildApprovalInstanceFieldFilters(paths, drafts)).toEqual([
      { fieldKey: 'vendor', operator: 'IN', values: ['v2'] },
      { fieldKey: 'amount', from: '100', operator: 'RANGE', to: '200' },
    ]);
  });

  it('returns nothing when no draft is filled', () => {
    expect(buildApprovalInstanceFieldFilters(paths, {})).toEqual([]);
  });
});

describe('readSortFieldOptions and sort conversion', () => {
  it('offers only time fields without a template, and form fields once a template is picked', () => {
    expect(
      readSortFieldOptions(paths, false).map((option) => option.id),
    ).toEqual(['', 'submittedAt', 'updatedAt', 'completedAt']);

    const withTemplate = readSortFieldOptions(paths, true).map(
      (option) => option.id,
    );

    // Textarea is filterable but not sortable (ADR 25 §7.5); table columns cannot be sorted.
    expect(withTemplate).toContain('amount');
    expect(withTemplate).not.toContain('remark');
    expect(withTemplate).not.toContain('items.sku');
  });

  it('rejects a form-field sort when no template is selected, so it can be reset', () => {
    expect(isSortFieldAvailable('amount', paths, false)).toBe(false);
    expect(isSortFieldAvailable('amount', paths, true)).toBe(true);
    expect(isSortFieldAvailable('submittedAt', paths, false)).toBe(true);
    expect(isSortFieldAvailable('', paths, false)).toBe(true);
  });

  it('leaves sort unset for the server default, and states the direction otherwise', () => {
    expect(
      toApprovalInstanceSort({ direction: 'DESC', field: '' }),
    ).toBeUndefined();
    expect(
      toApprovalInstanceSort({ direction: 'ASC', field: 'amount' }),
    ).toEqual([{ direction: 'ASC', field: 'amount' }]);
  });
});
