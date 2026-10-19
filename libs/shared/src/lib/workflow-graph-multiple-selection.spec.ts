import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { FormFieldDefinition } from './form';
import { WorkflowEdgeConditionOperator } from './workflow';
import {
  readConditionExpression,
  readConditionLabel,
  readConditionOperatorIds,
  readConditionOperatorOptionsForField,
} from './workflow-graph';

const OPTIONS = [
  { label: '甲', value: 'A' },
  { label: '乙', value: 'B' },
];
const CHECKBOX: FormFieldDefinition = {
  fieldKey: 'x',
  label: '勾選',
  options: OPTIONS,
  required: false,
  type: 'checkbox',
};
const MULTI_SELECT: FormFieldDefinition = {
  fieldKey: 'x',
  label: '多選',
  mode: 'multiple',
  options: OPTIONS,
  required: false,
  type: 'select',
};
const MULTI_AUTOCOMPLETE: FormFieldDefinition = {
  fieldKey: 'x',
  label: '多選搜尋',
  mode: 'multiple',
  options: OPTIONS,
  required: false,
  type: 'autocomplete',
};
const SINGLE_SELECT: FormFieldDefinition = {
  fieldKey: 'x',
  label: '單選',
  options: OPTIONS,
  required: false,
  type: 'select',
};
const SINGLE_SELECT_EXPLICIT: FormFieldDefinition = {
  ...SINGLE_SELECT,
  mode: 'single',
};
const RADIO: FormFieldDefinition = {
  fieldKey: 'x',
  label: '單選鈕',
  options: OPTIONS,
  required: false,
  type: 'radio',
};

const MULTI_FIELDS: readonly (readonly [string, FormFieldDefinition])[] = [
  ['checkbox', CHECKBOX],
  ['select multiple', MULTI_SELECT],
  ['autocomplete multiple', MULTI_AUTOCOMPLETE],
];

describe('multiple-selection condition expressions (string shape)', () => {
  it.each(MULTI_FIELDS)('%s compiles list semantics', (_name, field): void => {
    expect(readConditionExpression(field, 'EQUALS', 'A')).toBe(
      'form.x != null && "A" in form.x',
    );
    expect(readConditionExpression(field, 'NOT_EQUALS', 'A')).toBe(
      '!(form.x != null && "A" in form.x)',
    );
    expect(readConditionExpression(field, 'IS_FILLED', undefined)).toBe(
      'form.x != null && form.x != []',
    );
    expect(readConditionExpression(field, 'IS_EMPTY', undefined)).toBe(
      'form.x == null || form.x == []',
    );
  });

  it('refuses a value operator without a value, and ordering operators', () => {
    expect(readConditionExpression(CHECKBOX, 'EQUALS', undefined)).toBe(
      undefined,
    );
    expect(readConditionExpression(CHECKBOX, 'GREATER_THAN', 'A')).toBe(
      undefined,
    );
  });

  it('emits bracket access for a non-identifier key and a JSON-quoted option value (string shape only; cel-js 0.8.2 does not unescape \\" so this value never matches at run time, same as single selection)', () => {
    expect(
      readConditionExpression(
        { ...CHECKBOX, fieldKey: 'a-b' },
        'EQUALS',
        'x"y',
      ),
    ).toBe('form["a-b"] != null && "x\\"y" in form["a-b"]');
  });

  it.each([
    ['single select', SINGLE_SELECT],
    ['single select (explicit mode)', SINGLE_SELECT_EXPLICIT],
    ['radio', RADIO],
  ])(
    '%s keeps the single-value expressions unchanged',
    (_name, field): void => {
      expect(readConditionExpression(field, 'EQUALS', 'A')).toBe(
        'form.x == "A"',
      );
      expect(readConditionExpression(field, 'NOT_EQUALS', 'A')).toBe(
        'form.x != "A"',
      );
      expect(readConditionExpression(field, 'IS_FILLED', undefined)).toBe(
        'form.x != null && form.x != ""',
      );
      expect(readConditionExpression(field, 'IS_EMPTY', undefined)).toBe(
        'form.x == null || form.x == ""',
      );
    },
  );
});

describe('multiple-selection operator names', () => {
  it.each(MULTI_FIELDS)('%s says 包含 / 不包含', (_name, field): void => {
    expect(readConditionOperatorOptionsForField(field)).toEqual([
      { id: 'EQUALS', name: '包含' },
      { id: 'NOT_EQUALS', name: '不包含' },
      { id: 'IS_FILLED', name: '已填寫' },
      { id: 'IS_EMPTY', name: '未填寫' },
    ]);
    expect(readConditionLabel(field, 'EQUALS', 'A')).toBe(
      `${field.label} 包含 甲`,
    );
    expect(readConditionLabel(field, 'NOT_EQUALS', 'B')).toBe(
      `${field.label} 不包含 乙`,
    );
    expect(readConditionLabel(field, 'IS_EMPTY', undefined)).toBe(
      `${field.label} 未填寫`,
    );
  });

  it.each([
    ['single select', SINGLE_SELECT],
    ['radio', RADIO],
  ])('%s keeps 等於 / 不等於', (_name, field): void => {
    expect(readConditionOperatorOptionsForField(field)).toEqual([
      { id: 'EQUALS', name: '等於' },
      { id: 'NOT_EQUALS', name: '不等於' },
      { id: 'IS_FILLED', name: '已填寫' },
      { id: 'IS_EMPTY', name: '未填寫' },
    ]);
    expect(readConditionLabel(field, 'EQUALS', 'A')).toBe(
      `${field.label} 等於 甲`,
    );
  });

  it('offers the same operator ids as before, so stored definitions still load', () => {
    expect(readConditionOperatorIds(CHECKBOX)).toEqual([
      'EQUALS',
      'NOT_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ]);
  });
});

/**
 * The generated expressions run through the real cel-js (ESM-only, hence a
 * child process; see `cel-js-member-condition.spec.ts` in bpm-core), against
 * the shapes a submitted multiple-selection value really has. The single-select
 * rows are the control: they show what the old, single-value expression gives.
 */
type Shape = 'a' | 'b' | 'ab' | 'empty' | 'null' | 'absent';

const SHAPES: Readonly<Record<Shape, Readonly<Record<string, unknown>>>> = {
  a: { x: ['A'] },
  ab: { x: ['A', 'B'] },
  absent: {},
  b: { x: ['B'] },
  empty: { x: [] },
  null: { x: null },
};
const SINGLE_SHAPES: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  a: { x: 'A' },
  b: { x: 'B' },
  empty: { x: '' },
  null: { x: null },
};

const OPERATORS: readonly WorkflowEdgeConditionOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'IS_FILLED',
  'IS_EMPTY',
];

// operator -> shape -> expected, for the value "A".
const EXPECTED_MULTI: Readonly<
  Record<string, Readonly<Record<Exclude<Shape, 'absent'>, boolean>>>
> = {
  EQUALS: { a: true, ab: true, b: false, empty: false, null: false },
  IS_EMPTY: { a: false, ab: false, b: false, empty: true, null: true },
  IS_FILLED: { a: true, ab: true, b: true, empty: false, null: false },
  NOT_EQUALS: { a: false, ab: false, b: true, empty: true, null: true },
};

describe('multiple-selection condition expressions under cel-js', () => {
  // Evaluated once, in a hook rather than the describe body: a cel-js load or
  // child-process failure then fails each test by name instead of breaking
  // test collection.
  let multi: Readonly<Record<string, unknown>> = {};
  let single: Readonly<Record<string, unknown>> = {};

  beforeAll((): void => {
    multi = evaluateAll(CHECKBOX, SHAPES);
    single = evaluateAll(SINGLE_SELECT, SINGLE_SHAPES);
  });

  it.each(
    OPERATORS.flatMap((operator) =>
      (
        Object.keys(
          EXPECTED_MULTI['EQUALS'],
        ) as (keyof (typeof EXPECTED_MULTI)['EQUALS'])[]
      ).map(
        (shape) => [operator, shape, EXPECTED_MULTI[operator][shape]] as const,
      ),
    ),
  )('%s on %s is %s', (operator, shape, expected): void => {
    expect(multi[`${operator}:${shape}`]).toBe(expected);
  });

  it('never throws for null, even for IS_EMPTY', () => {
    expect(
      OPERATORS.map((operator) => multi[`${operator}:null`]),
    ).not.toContain('THROW');
  });

  it('throws on an absent key, as every expression shape already does', () => {
    // An absent key makes cel-js throw "Identifier not found" for every
    // expression shape, single-value ones included: not something this
    // change introduces or could fix from the expression alone.
    expect(OPERATORS.map((operator) => multi[`${operator}:absent`])).toEqual(
      OPERATORS.map(() => 'THROW'),
    );
  });

  it('control: the single-select expression gives the old answers', () => {
    expect(single['EQUALS:a']).toBe(true);
    expect(single['NOT_EQUALS:a']).toBe(false);
    expect(single['EQUALS:b']).toBe(false);
    expect(single['NOT_EQUALS:b']).toBe(true);
    expect(single['IS_FILLED:a']).toBe(true);
    expect(single['IS_FILLED:empty']).toBe(false);
    expect(single['IS_EMPTY:empty']).toBe(true);
    expect(single['IS_EMPTY:null']).toBe(true);
  });

  it('control: the single-value expression is wrong on a list (the bug)', () => {
    const wrong = evaluateExpressions(
      ['form.x == "A"', 'form.x != "A"', 'form.x != null && form.x != ""'],
      [SHAPES.a, SHAPES.empty],
    );

    expect(wrong).toEqual([
      [false, false],
      [true, true],
      [true, true],
    ]);
  });
});

function evaluateAll(
  field: FormFieldDefinition,
  shapes: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
  const names = Object.keys(shapes);
  const expressions = OPERATORS.map((operator) =>
    readConditionExpression(field, operator, 'A'),
  );
  const results = evaluateExpressions(
    expressions.map((expression) => expression ?? 'false'),
    names.map((name) => shapes[name]),
  );

  return Object.fromEntries(
    OPERATORS.flatMap((operator, operatorIndex) =>
      names.map((name, shapeIndex) => [
        `${operator}:${name}`,
        results[operatorIndex][shapeIndex],
      ]),
    ),
  );
}

function evaluateExpressions(
  expressions: readonly string[],
  forms: readonly Readonly<Record<string, unknown>>[],
): readonly (readonly unknown[])[] {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const forms = ${JSON.stringify(forms)};
    const run = (expression) => forms.map((form) => {
      try {
        return evaluate(parse(expression).cst, { form });
      } catch {
        return 'THROW';
      }
    });

    process.stdout.write(JSON.stringify(${JSON.stringify(expressions)}.map(run)));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: resolve(__dirname, '../../../..'),
      encoding: 'utf8',
    }),
  );
}
