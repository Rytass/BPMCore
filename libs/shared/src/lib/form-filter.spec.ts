import type { FormDefinitionSchema } from './form';
import {
  checkFilterableFieldValue,
  describeFilterableFieldIssue,
  readFilterOperatorsForFieldType,
  readFilterableFieldIssues,
  readFilterableFieldPaths,
  readFilterableValueProblems,
} from './form-filter';

const schema: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'vendor', filterable: true, label: '廠商', options: [{ label: '甲廠商', value: 'v1' }], required: false, type: 'select' },
    { fieldKey: 'amount', filterable: true, hidden: true, label: '金額', required: false, type: 'money' },
    { fieldKey: 'note', label: '備註', required: false, type: 'text' },
    { fieldKey: 'files', filterable: true, label: '附件', required: false, type: 'file_upload' },
    {
      columns: [
        { fieldKey: 'sku', filterable: true, label: '品號', required: false, type: 'text' },
        { fieldKey: 'qty', filterable: true, label: '數量', required: false, type: 'number' },
        { fieldKey: 'memo', label: '說明', required: false, type: 'text' },
      ],
      fieldKey: 'items',
      label: '明細',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};

describe('readFilterableFieldPaths', () => {
  it('lists filterable top-level fields and table columns, skipping types that cannot filter', () => {
    expect(readFilterableFieldPaths(schema).map((path) => path.path)).toEqual([
      'vendor',
      'amount',
      'items.sku',
      'items.qty',
    ]);
  });

  it('carries static options and labels', () => {
    const [vendor, , sku] = readFilterableFieldPaths(schema);

    expect(vendor.staticOptions).toEqual([{ label: '甲廠商', value: 'v1' }]);
    expect(sku.label).toBe('明細／品號');
    expect(sku.tableKey).toBe('items');
  });
});

describe('checkFilterableFieldValue', () => {
  const money = { fieldKey: 'a', label: 'a', required: false, type: 'money' } as const;
  const date = { fieldKey: 'd', label: 'd', required: false, type: 'date' } as const;
  const datetime = { fieldKey: 't', label: 't', required: false, type: 'datetime' } as const;
  const select = { fieldKey: 's', label: 's', options: [], required: false, type: 'select' } as const;

  it.each([
    [money, undefined, 'empty'],
    [money, null, 'empty'],
    [money, '', 'empty'],
    [money, 12.5, 'valid'],
    [money, '12', 'invalid'],
    [money, 'abc', 'invalid'],
    [date, '2026-11-03', 'valid'],
    [date, '2026-02-30', 'invalid'],
    [date, '11/3', 'invalid'],
    [datetime, '2026-11-03T08:30:00.000Z', 'valid'],
    [datetime, '2026-11-03T08:30:00+08:00', 'invalid'],
    [select, 'v1', 'valid'],
    [select, ['v1', 'v2'], 'valid'],
    [select, [], 'empty'],
    [select, 3, 'invalid'],
  ])('%j with %j is %s', (field, value, status) => {
    expect(checkFilterableFieldValue(field, value).status).toBe(status);
  });
});

describe('readFilterableValueProblems', () => {
  it('reports top-level and per-row problems', () => {
    const problems = readFilterableValueProblems(readFilterableFieldPaths(schema), {
      amount: 'abc',
      items: [{ qty: 3, sku: 'A1' }, { qty: 'many', sku: 'B2' }],
    });

    expect(problems).toEqual([
      { expected: 'number', path: 'amount', rowIndex: null, value: 'abc' },
      { expected: 'number', path: 'items.qty', rowIndex: 1, value: 'many' },
    ]);
  });
});

describe('readFilterableFieldIssues', () => {
  it('refuses a field whose type differs in an older version with instances', () => {
    const issues = readFilterableFieldIssues({
      history: [
        {
          schema: { fields: [{ fieldKey: 'amount', label: '金額', required: false, type: 'text' }], schemaVersion: 1 },
          versionNumber: 1,
        },
      ],
      instances: [],
      schema,
    });

    expect(issues).toEqual([
      expect.objectContaining({ conflicts: [{ type: 'text', versionNumber: 1 }], kind: 'TYPE_CHANGED', path: 'amount' }),
    ]);
    expect(describeFilterableFieldIssue(issues[0])).toContain('v1（text）');
  });

  it('refuses a field while old instances hold values of the wrong type', () => {
    const issues = readFilterableFieldIssues({
      history: [],
      instances: [
        { formData: { amount: 'abc' }, id: 'i-1' },
        { formData: { amount: '' }, id: 'i-2' },
        { formData: { amount: 5 }, id: 'i-3' },
      ],
      schema,
    });

    expect(issues).toEqual([
      expect.objectContaining({ invalidInstanceCount: 1, kind: 'INVALID_VALUES', path: 'amount' }),
    ]);
    expect(describeFilterableFieldIssue(issues[0])).toContain('i-1');
  });

  it('passes when history and data agree', () => {
    expect(
      readFilterableFieldIssues({
        history: [{ schema, versionNumber: 1 }],
        instances: [{ formData: { amount: 5, items: [{ qty: 1 }] }, id: 'i-1' }],
        schema,
      }),
    ).toEqual([]);
  });
});

describe('readFilterOperatorsForFieldType', () => {
  it('limits boolean and textarea', () => {
    expect(readFilterOperatorsForFieldType('boolean')).toEqual(['EQUALS']);
    expect(readFilterOperatorsForFieldType('textarea')).toEqual(['CONTAINS']);
    expect(readFilterOperatorsForFieldType('money')).toContain('RANGE');
  });
});
