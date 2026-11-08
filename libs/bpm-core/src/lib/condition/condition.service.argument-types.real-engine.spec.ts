import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunction } from '../expression-function/expression-function.types';
import { ConditionService } from './condition.service';

/**
 * Function argument types in the cel-v2 lint (live finding after P5): numbers
 * are registered as `dyn` in a function's cel-v2 signature, so the engine's
 * own `env.check()` let `demo_costBand_v1(form.title) == "HIGH"` through the
 * preview and the publish, and every case with a title then failed with
 * `EXPRESSION_TYPE_ERROR`. The lint now compares each argument's checked
 * type with the declared parameter. Runs in jest.real-engine.config.cts.
 */

const SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'title', label: '標題', required: true, type: 'text' },
    { fieldKey: 'amount', label: '金額', required: true, type: 'number' },
    { fieldKey: 'price', label: '單價', required: true, type: 'money' },
    { fieldKey: 'urgent', label: '急件', required: true, type: 'boolean' },
    {
      fieldKey: 'tags',
      label: '標籤',
      mode: 'multiple',
      options: [
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
      ],
      required: true,
      type: 'checkbox',
    },
    {
      fieldKey: 'plant',
      label: '廠別',
      options: [
        { label: 'TW01', value: 'TW01' },
        { label: 'TW02', value: 'TW02' },
      ],
      required: true,
      type: 'select',
    },
    {
      columns: [
        { fieldKey: 'qty', label: '數量', required: true, type: 'number' },
        { fieldKey: 'name', label: '品名', required: true, type: 'text' },
      ],
      fieldKey: 'items',
      label: '明細',
      required: true,
      type: 'table',
    },
  ],
  schemaVersion: 1,
} as FormDefinitionSchema;

const HOST_FUNCTIONS: readonly BPMExpressionFunction[] = [
  {
    description: 'Cost band of an amount',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      (args[0] as number) < 50_000 ? 'LOW' : 'HIGH',
    label: '採購金額級距',
    name: 'demo_costBand_v1',
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
  },
  {
    description: 'Tags a text',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      `#${String(args[0])}`,
    label: 'tag',
    name: 'erp_tag_v1',
    parameters: [{ name: 'text', type: 'string' }],
    returnType: 'string',
  },
  {
    description: 'Pads a count',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      String(args[0]).padStart(3, '0'),
    label: 'pad',
    name: 'erp_pad_v1',
    parameters: [{ name: 'count', type: 'int' }],
    returnType: 'string',
  },
  {
    description: 'Counts a list',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      (args[0] as readonly BPMExpressionValue[]).length,
    label: 'count',
    name: 'erp_count_v1',
    parameters: [{ name: 'values', type: 'list' }],
    returnType: 'double',
  },
  {
    description: 'Echoes anything',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      args[0] ?? null,
    label: 'echo',
    name: 'erp_echo_v1',
    parameters: [{ name: 'value', type: 'dyn' }],
    returnType: 'dyn',
  },
];

const service = new ConditionService(
  new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS),
);

const lint = (
  expression: string,
  formSchema: FormDefinitionSchema | null = SCHEMA,
): readonly string[] =>
  service.lintExpression(expression, 'entry', {
    dialect: 'cel-v2',
    formSchema,
    usagePoint: 'ENTRY_CONDITION',
  });

describe('cel-v2 lint of function argument types', (): void => {
  it('refuses a text field handed to a double parameter (the live case)', (): void => {
    expect(lint('demo_costBand_v1(form.title) == "HIGH"')).toEqual([
      'entry: EXPR_FIELD_TYPE_MISMATCH title',
    ]);
  });

  it('is the case evaluation fails on, so the publish must not let it through (contrast)', (): void => {
    expect(() =>
      service.evaluateValue(
        'demo_costBand_v1(form.title) == "HIGH"',
        { form: { title: '筆電' } },
        'entry',
        { allowedRootIdentifiers: ['form'], dialect: 'cel-v2' },
      ),
    ).toThrow(
      expect.objectContaining({ code: 'EXPRESSION_TYPE_ERROR' }) as Error,
    );
  });

  it.each([
    ['a table field', 'demo_costBand_v1(form.items) == "HIGH"', 'items'],
    ['a multiple checkbox field', 'demo_costBand_v1(form.tags) == "HIGH"', 'tags'],
    ['a boolean field', 'demo_costBand_v1(form.urgent) == "HIGH"', 'urgent'],
    ['a single select field', 'demo_costBand_v1(form.plant) == "HIGH"', 'plant'],
    ['a text field, int parameter', 'erp_pad_v1(form.title) == "001"', 'title'],
    ['a number field, string parameter', 'erp_tag_v1(form.amount) == "#1"', 'amount'],
    ['a money field, string parameter', 'erp_tag_v1(form.price) == "#1"', 'price'],
    ['a table field, string parameter', 'erp_tag_v1(form.items) == "#1"', 'items'],
    ['a text field, list parameter', 'erp_count_v1(form.title) > 1.0', 'title'],
    ['a text field to a built-in', 'round(form.title) == 1.0', 'title'],
    ['a list field to a built-in', 'upper(form.tags) == "A"', 'tags'],
  ])('refuses %s', (_name, expression, subject): void => {
    expect(lint(expression)).toEqual([
      `entry: EXPR_FIELD_TYPE_MISMATCH ${subject}`,
    ]);
  });

  it('refuses a mismatch behind && and inside a comprehension', (): void => {
    expect(
      lint('size(form.title) > 0 && demo_costBand_v1(form.title) == "LOW"'),
    ).toEqual(['entry: EXPR_FIELD_TYPE_MISMATCH title']);
    expect(
      lint('form.items.exists(r, demo_costBand_v1(form.title) == "HIGH")'),
    ).toEqual(['entry: EXPR_FIELD_TYPE_MISMATCH title']);
  });

  it('refuses a literal of the wrong type without naming a field', (): void => {
    expect(lint('demo_costBand_v1("1000") == "HIGH"')).toEqual([
      'entry: EXPR_FIELD_TYPE_MISMATCH',
    ]);
    expect(lint('demo_costBand_v1(null) == "HIGH"')).toEqual([
      'entry: EXPR_FIELD_TYPE_MISMATCH',
    ]);
  });

  it.each([
    'demo_costBand_v1(form.amount) == "HIGH"',
    'demo_costBand_v1(form.price) == "HIGH"',
    'demo_costBand_v1(1000) == "LOW"',
    'demo_costBand_v1(1000.5) == "LOW"',
    'demo_costBand_v1(form.amount * 2) == "HIGH"',
    'demo_costBand_v1(size(form.title)) == "LOW"',
    'demo_costBand_v1(double(form.title)) == "LOW"',
    'erp_pad_v1(form.amount) == "001"',
    'erp_pad_v1(2) == "002"',
    'erp_tag_v1(form.title) == "#x"',
    'erp_tag_v1(form.plant) == "#TW01"',
    'erp_tag_v1(string(form.amount)) == "#1"',
    'erp_count_v1(form.tags) > 1.0',
    'erp_count_v1(form.items) > 1.0',
    'erp_echo_v1(form.title) == "x"',
    'round(form.amount) == 1.0',
    'upper(form.title) == "X"',
  ])('accepts %s', (expression): void => {
    expect(lint(expression)).toEqual([]);
  });

  it('leaves an argument the check cannot type to evaluation (dyn)', (): void => {
    // A table row's cells are `dyn`: decided at evaluation, as before.
    expect(
      lint('form.items.exists(r, demo_costBand_v1(r.name) == "HIGH")'),
    ).toEqual([]);
    expect(
      lint('form.items.exists(r, demo_costBand_v1(r.qty) == "HIGH")'),
    ).toEqual([]);
    // Without a bound form every field is `dyn`.
    expect(lint('demo_costBand_v1(form.title) == "HIGH"', null)).toEqual([]);
  });

  it('reports the same finding to the designer preview (lintExpressionIssues)', (): void => {
    expect(
      service.lintExpressionIssues(
        'demo_costBand_v1(form.title) == "HIGH"',
        'expression',
        { dialect: 'cel-v2', formSchema: SCHEMA, usagePoint: 'ENTRY_CONDITION' },
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'EXPR_FIELD_TYPE_MISMATCH',
        severity: 'ERROR',
        subject: 'title',
      }),
    ]);
  });

  it('checks a SET_FORM_FIELD value the same way', (): void => {
    const target = SCHEMA.fields.find((field) => field.fieldKey === 'title');

    expect(
      service.lintExpression('demo_costBand_v1(form.title)', 'set', {
        dialect: 'cel-v2',
        formSchema: SCHEMA,
        targetField: target ?? null,
        usagePoint: 'SERVICE_FORM_FIELD_VALUE',
      }),
    ).toEqual(['set: EXPR_FIELD_TYPE_MISMATCH title']);
    expect(
      service.lintExpression('demo_costBand_v1(form.amount)', 'set', {
        dialect: 'cel-v2',
        formSchema: SCHEMA,
        targetField: target ?? null,
        usagePoint: 'SERVICE_FORM_FIELD_VALUE',
      }),
    ).toEqual([]);
  });

  it('keeps the tolerated comparisons accepted', (): void => {
    expect(
      lint('form.amount != null && demo_costBand_v1(form.amount) == "HIGH"'),
    ).toEqual([]);
    expect(lint('form.amount in [1, 2, 3]')).toEqual([]);
  });

  // Independent verification after the fix: a tolerated comparison demotes
  // its field to `dyn` for the whole expression, so the argument check saw
  // `dyn` and let the guarded form of every mismatch through.
  it.each([
    [
      'a null guard, double parameter',
      'form.title != null && demo_costBand_v1(form.title) == "HIGH"',
      'title',
    ],
    [
      'a formData null guard',
      'formData.title != null && demo_costBand_v1(formData.title) == "HIGH"',
      'title',
    ],
    [
      'an empty-string guard',
      'form.title != "" && demo_costBand_v1(form.title) == "HIGH"',
      'title',
    ],
    [
      'an in guard',
      'form.title in ["a"] && demo_costBand_v1(form.title) == "HIGH"',
      'title',
    ],
    [
      'an index access behind a null guard',
      'form["title"] != null && demo_costBand_v1(form["title"]) == "HIGH"',
      'title',
    ],
    [
      'a null guard, string parameter',
      'form.amount != null && erp_tag_v1(form.amount) == "#1"',
      'amount',
    ],
    [
      'a null guard, built-in',
      'form.amount != null && upper(form.amount) == "X"',
      'amount',
    ],
    [
      'an empty-list guard, double parameter',
      'form.tags != [] && demo_costBand_v1(form.tags) == "HIGH"',
      'tags',
    ],
  ])('refuses a mismatch behind %s', (_name, expression, subject): void => {
    expect(lint(expression)).toEqual([
      `entry: EXPR_FIELD_TYPE_MISMATCH ${subject}`,
    ]);
    expect(
      service.lintExpression(expression, 'edge', {
        dialect: 'cel-v2',
        formSchema: SCHEMA,
        usagePoint: 'FLOW_CONDITION',
      }),
    ).toEqual([`edge: EXPR_FIELD_TYPE_MISMATCH ${subject}`]);
  });

  it('is a case evaluation fails on behind the guard too (contrast)', (): void => {
    expect(() =>
      service.evaluateValue(
        'form.title != null && demo_costBand_v1(form.title) == "HIGH"',
        { form: { title: '筆電' } },
        'entry',
        { allowedRootIdentifiers: ['form'], dialect: 'cel-v2' },
      ),
    ).toThrow(
      expect.objectContaining({ code: 'EXPRESSION_TYPE_ERROR' }) as Error,
    );
  });

  it.each([
    'form.title != null && erp_tag_v1(form.title) == "#x"',
    'form.title != "" && upper(form.title) == "X"',
    'form.tags != [] && erp_count_v1(form.tags) > 1.0',
    'form.amount in [1, 2] && demo_costBand_v1(form.amount) == "LOW"',
    'form.title != null && erp_echo_v1(form.title) == "x"',
    'form.title != null && demo_costBand_v1(size(form.title)) == "LOW"',
  ])('accepts a matching argument behind a guard: %s', (expression): void => {
    expect(lint(expression)).toEqual([]);
  });
});
