import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  readConditionExpression,
  readConditionOperatorIds,
} from '@rytass/bpm-core-shared/workflow-graph';
import type { WorkflowEdgeConditionOperator } from '@rytass/bpm-core-shared/workflow';

/**
 * Every (field type x operator) the condition designer offers, compiled by
 * `readConditionExpression` and run through the real cel-js (see
 * `cel-js-list-behaviour.spec.ts` for why that needs a child process; the jest
 * `cel-js` shim has JavaScript semantics and never throws on a missing key).
 *
 * The point is the missing key. The runtime `form` is the submitted form data
 * as-is, and a client serialises it with `JSON.stringify`, so a field the user
 * never touched is not `null` — it is not there at all, and cel-js throws when
 * an expression reads it. An unfilled field (key absent or `null`) must never
 * throw and must give the operator's "empty" answer.
 */
type Operator = WorkflowEdgeConditionOperator;
type Expected = Partial<Record<Operator, boolean>>;

const ABSENT = Symbol('absent');

interface Scenario {
  readonly expected: Expected;
  readonly name: string;
  readonly value: unknown;
}

interface Kind {
  readonly field: FormFieldDefinition;
  readonly name: string;
  readonly scenarios: readonly Scenario[];
  /** The comparison value the designer stores for an operator that needs one. */
  readonly value: string;
}

const UNFILLED: Expected = {
  EQUALS: false,
  GREATER_THAN: false,
  GREATER_THAN_OR_EQUALS: false,
  IS_EMPTY: true,
  IS_FILLED: false,
  LESS_THAN: false,
  LESS_THAN_OR_EQUALS: false,
  NOT_EQUALS: true,
};

const unfilled = (name: string, value: unknown): Scenario => ({
  expected: UNFILLED,
  name,
  value,
});

const filled = (
  name: string,
  value: unknown,
  expected: Expected,
): Scenario => ({
  expected: { IS_EMPTY: false, IS_FILLED: true, ...expected },
  name,
  value,
});

const base = { label: 'F', required: false } as const;
const OPTIONS = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
] as const;

// What an ordering operator gives against `reference` for a value that is
// before / equal to / after it.
const BEFORE: Expected = {
  EQUALS: false,
  GREATER_THAN: false,
  GREATER_THAN_OR_EQUALS: false,
  LESS_THAN: true,
  LESS_THAN_OR_EQUALS: true,
  NOT_EQUALS: true,
};
const SAME: Expected = {
  EQUALS: true,
  GREATER_THAN: false,
  GREATER_THAN_OR_EQUALS: true,
  LESS_THAN: false,
  LESS_THAN_OR_EQUALS: true,
  NOT_EQUALS: false,
};
const AFTER: Expected = {
  EQUALS: false,
  GREATER_THAN: true,
  GREATER_THAN_OR_EQUALS: true,
  LESS_THAN: false,
  LESS_THAN_OR_EQUALS: false,
  NOT_EQUALS: true,
};
const MATCH: Expected = { EQUALS: true, NOT_EQUALS: false };
const OTHER: Expected = { EQUALS: false, NOT_EQUALS: true };

const textKind = (type: 'text' | 'textarea'): Kind => ({
  field: { ...base, fieldKey: 'agent', type },
  name: type,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    unfilled('empty string', ''),
    filled('matching', 'v', MATCH),
    filled('other', 'w', OTHER),
  ],
  value: 'v',
});

const numberKind = (type: 'money' | 'number'): Kind => ({
  field: { ...base, fieldKey: 'amount', type },
  name: type,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    unfilled('empty string', ''),
    filled('below', 3, BEFORE),
    filled('equal', 5, SAME),
    filled('above', 7, AFTER),
  ],
  value: '5',
});

const dateKind = (type: 'date' | 'datetime', reference: string): Kind => ({
  field: { ...base, fieldKey: 'when', type },
  name: type,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    unfilled('empty string', ''),
    filled('before', '2026-05-01T00:00:00', BEFORE),
    filled('equal', reference, SAME),
    filled('after', '2026-07-01T00:00:00', AFTER),
  ],
  value: reference,
});

const singleKind = (name: string, field: FormFieldDefinition): Kind => ({
  field,
  name,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    unfilled('empty string', ''),
    filled('matching', 'a', MATCH),
    filled('other', 'b', OTHER),
  ],
  value: 'a',
});

const multipleKind = (name: string, field: FormFieldDefinition): Kind => ({
  field,
  name,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    unfilled('empty list', []),
    filled('contains', ['a', 'b'], MATCH),
    filled('does not contain', ['b'], OTHER),
  ],
  value: 'a',
});

const presenceKind = (
  name: string,
  field: FormFieldDefinition,
  unfilledValues: readonly (readonly [string, unknown])[],
  filledValue: unknown,
): Kind => ({
  field,
  name,
  scenarios: [
    unfilled('absent', ABSENT),
    unfilled('null', null),
    ...unfilledValues.map(([label, value]) => unfilled(label, value)),
    filled('filled', filledValue, {}),
  ],
  value: 'unused',
});

const DATE_DAY = '2026-06-01T00:00:00';
const KINDS: readonly Kind[] = [
  textKind('text'),
  textKind('textarea'),
  numberKind('number'),
  numberKind('money'),
  dateKind('date', DATE_DAY),
  dateKind('datetime', DATE_DAY),
  {
    field: { ...base, fieldKey: 'approved', type: 'boolean' },
    name: 'boolean',
    scenarios: [
      unfilled('absent', ABSENT),
      unfilled('null', null),
      filled('true', true, MATCH),
      filled('false', false, OTHER),
    ],
    value: 'true',
  },
  singleKind('select', {
    ...base,
    fieldKey: 'choice',
    options: OPTIONS,
    type: 'select',
  }),
  singleKind('radio', {
    ...base,
    fieldKey: 'choice',
    options: OPTIONS,
    type: 'radio',
  }),
  singleKind('autocomplete', {
    ...base,
    fieldKey: 'choice',
    options: OPTIONS,
    type: 'autocomplete',
  }),
  multipleKind('checkbox', {
    ...base,
    fieldKey: 'choices',
    options: OPTIONS,
    type: 'checkbox',
  }),
  multipleKind('select (multiple)', {
    ...base,
    fieldKey: 'choices',
    mode: 'multiple',
    options: OPTIONS,
    type: 'select',
  }),
  multipleKind('autocomplete (multiple)', {
    ...base,
    fieldKey: 'choices',
    mode: 'multiple',
    options: OPTIONS,
    type: 'autocomplete',
  }),
  presenceKind(
    'member',
    { ...base, fieldKey: 'owner', type: 'member' },
    [['empty string', '']],
    'user-1',
  ),
  presenceKind(
    'member (multiple)',
    { ...base, fieldKey: 'owners', multiple: true, type: 'member' },
    [['empty list', []]],
    ['user-1', 'user-2'],
  ),
  presenceKind(
    'org_unit',
    { ...base, fieldKey: 'unit', type: 'org_unit' },
    [['empty string', '']],
    'unit-1',
  ),
  presenceKind(
    'table',
    {
      ...base,
      columns: [{ ...base, fieldKey: 'qty', type: 'number' }],
      fieldKey: 'items',
      type: 'table',
    },
    [['no rows', []]],
    [{ qty: 1 }],
  ),
  presenceKind(
    'file_upload',
    { ...base, fieldKey: 'attachment', type: 'file_upload' },
    [],
    ['att-1'],
  ),
];

interface Case {
  readonly expected: boolean;
  readonly expression: string;
  readonly form: Readonly<Record<string, unknown>>;
  readonly id: string;
}

interface Probe {
  readonly id: string;
  readonly outcome: 'PARSE_FAIL' | 'THROW' | 'VALUE';
  readonly value?: unknown;
}

const buildCases = (): readonly Case[] =>
  KINDS.flatMap((kind) =>
    readConditionOperatorIds(kind.field).flatMap((operator) => {
      const expression = readConditionExpression(
        kind.field,
        operator,
        kind.value,
      );

      return kind.scenarios.map((scenario): Case => {
        const expected = scenario.expected[operator];

        if (expression === undefined || expected === undefined) {
          throw new Error(
            `${kind.name} ${operator} has no compiled expression or expected result for ${scenario.name}`,
          );
        }

        return {
          expected,
          expression,
          form:
            scenario.value === ABSENT
              ? {}
              : { [kind.field.fieldKey]: scenario.value },
          id: `${kind.name} ${operator} ${scenario.name}`,
        };
      });
    }),
  );

describe('designer condition expressions under cel-js', () => {
  const cases = buildCases();
  const probes = readProbes(cases);

  it('covers every field type the designer compiles', (): void => {
    expect(new Set(KINDS.map((kind) => kind.field.type))).toEqual(
      new Set([
        'autocomplete',
        'boolean',
        'checkbox',
        'date',
        'datetime',
        'file_upload',
        'member',
        'money',
        'number',
        'org_unit',
        'radio',
        'select',
        'table',
        'text',
        'textarea',
      ]),
    );
    expect(cases.length).toBeGreaterThan(150);
  });

  it.each(cases.map((item) => [item.id, item] as const))(
    '%s',
    (id, item): void => {
      expect(probes.get(id)).toEqual({
        id,
        outcome: 'VALUE',
        value: item.expected,
      });
    },
  );

  it('never reads a field through `||` after a has() guard', (): void => {
    // cel-js does not short-circuit `||`, so such a string would still throw.
    expect(cases.filter((item) => item.expression.includes('||'))).toEqual([]);
  });
});

describe('designer condition expressions for a non-identifier key', () => {
  // has() accepts only a field selection, so these cannot be gated; the
  // output stays exactly as it was before identifier keys were guarded.
  const ref = 'form["a-b"]';
  const text = { ...base, fieldKey: 'a-b', type: 'text' } as const;
  const amount = { ...base, fieldKey: 'a-b', type: 'number' } as const;
  const multi = {
    ...base,
    fieldKey: 'a-b',
    options: OPTIONS,
    type: 'checkbox',
  } as const;
  const member = { ...base, fieldKey: 'a-b', type: 'member' } as const;
  const table = {
    ...base,
    columns: [],
    fieldKey: 'a-b',
    type: 'table',
  } as const;
  const orgUnit = { ...base, fieldKey: 'a-b', type: 'org_unit' } as const;

  it.each([
    [text, 'IS_FILLED', undefined, `${ref} != null && ${ref} != ""`],
    [text, 'IS_EMPTY', undefined, `${ref} == null || ${ref} == ""`],
    [text, 'EQUALS', 'v', `${ref} == "v"`],
    [text, 'NOT_EQUALS', 'v', `${ref} != "v"`],
    [amount, 'GREATER_THAN', '5', `${ref} > 5`],
    [amount, 'LESS_THAN_OR_EQUALS', '5', `${ref} <= 5`],
    [multi, 'IS_FILLED', undefined, `${ref} != null && ${ref} != []`],
    [multi, 'IS_EMPTY', undefined, `${ref} == null || ${ref} == []`],
    [multi, 'EQUALS', 'a', `${ref} != null && "a" in ${ref}`],
    [multi, 'NOT_EQUALS', 'a', `!(${ref} != null && "a" in ${ref})`],
    [
      member,
      'IS_FILLED',
      undefined,
      `${ref} != null && ${ref} != "" && ${ref} != []`,
    ],
    [
      member,
      'IS_EMPTY',
      undefined,
      `${ref} == null || ${ref} == "" || ${ref} == []`,
    ],
    [orgUnit, 'IS_FILLED', undefined, `${ref} != null && ${ref} != ""`],
    [table, 'IS_FILLED', undefined, `${ref} != null && size(${ref}) > 0`],
    [table, 'IS_EMPTY', undefined, `${ref} == null || size(${ref}) == 0`],
  ] as const)(
    '%j %s compiles unchanged',
    (field, operator, value, expected): void => {
      expect(readConditionExpression(field, operator, value)).toBe(expected);
    },
  );
});

function readProbes(cases: readonly Case[]): ReadonlyMap<string, Probe> {
  // No top-level `const self` here: lodash probes `typeof self`.
  const script = `
    import { evaluate, parse } from 'cel-js';

    const cases = ${JSON.stringify(cases)};
    const results = cases.map(({ expression, form, id }) => {
      const parsed = parse(expression);

      if (!parsed.isSuccess) {
        return { id, outcome: 'PARSE_FAIL' };
      }

      try {
        return { id, outcome: 'VALUE', value: evaluate(parsed.cst, { form }) };
      } catch {
        return { id, outcome: 'THROW' };
      }
    });

    process.stdout.write(JSON.stringify(results));
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  return new Map(
    (JSON.parse(output) as readonly Probe[]).map((probe): [string, Probe] => [
      probe.id,
      probe,
    ]),
  );
}
