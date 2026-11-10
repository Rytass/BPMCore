import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Minimal reproduction, with the real cel-js, of why the workflow engine routes
 * a designer-built edge through the structured evaluator when its stored CEL
 * fails on a field that has no value (`evaluateWithStructuredFallback` in the
 * workflow engine).
 *
 * The condition designer used to store these expressions. A client serialises
 * the form with `JSON.stringify`, so an optional field the user never touched
 * has no key at all, and cel-js throws instead of answering. Definitions that
 * were already published (and instances already running on them) keep that
 * stored CEL, so a compile-time fix alone cannot reach them.
 *
 * The suite cannot import `cel-js` directly: jest maps it to a JavaScript-eval
 * shim that answers `undefined` for an absent key and never throws (see
 * `cel-js-list-behaviour.spec.ts`). The real package runs in a child Node
 * process doing the same parse -> evaluate sequence as
 * `ConditionService.evaluateBoolean`.
 */
interface CelProbe {
  readonly context: Readonly<Record<string, unknown>>;
  readonly expression: string;
  readonly name: string;
}

interface CelProbeResult {
  readonly name: string;
  readonly outcome: 'PARSE_FAIL' | 'THROW' | 'VALUE';
  readonly message?: string;
  readonly value?: unknown;
}

const LEGACY_IS_FILLED = 'form.agent != null && form.agent != ""';
const LEGACY_GREATER_THAN = 'form.amount > 5';
const LEGACY_NON_IDENTIFIER_IS_FILLED =
  'form["a-b"] != null && form["a-b"] != ""';

const PROBES: readonly CelProbe[] = [
  {
    context: { form: {} },
    expression: LEGACY_IS_FILLED,
    name: 'is filled, key absent',
  },
  {
    context: { form: { agent: null } },
    expression: LEGACY_IS_FILLED,
    name: 'is filled, null',
  },
  {
    context: { form: { agent: 'someone' } },
    expression: LEGACY_IS_FILLED,
    name: 'is filled, value',
  },
  {
    context: { form: { amount: null } },
    expression: LEGACY_GREATER_THAN,
    name: 'greater than, null',
  },
  {
    context: { form: {} },
    expression: LEGACY_GREATER_THAN,
    name: 'greater than, key absent',
  },
  {
    context: { form: { amount: 9 } },
    expression: LEGACY_GREATER_THAN,
    name: 'greater than, value',
  },
  {
    context: { form: {} },
    expression: LEGACY_NON_IDENTIFIER_IS_FILLED,
    name: 'non-identifier key, key absent',
  },
  {
    context: { form: { 'a-b': 'x' } },
    expression: LEGACY_NON_IDENTIFIER_IS_FILLED,
    name: 'non-identifier key, value',
  },
];

describe('cel-js on a form key that is absent or null', () => {
  const results = readCelProbeResults();
  const readResult = (name: string): CelProbeResult => {
    const result = results.find((item) => item.name === name);

    if (!result) {
      throw new Error(`No probe result for ${name}`);
    }

    return result;
  };

  it('parses every probed expression', (): void => {
    expect(results.filter((result) => result.outcome === 'PARSE_FAIL')).toEqual(
      [],
    );
  });

  it('throws on the stored "is filled" CEL when the key is absent', (): void => {
    expect(readResult('is filled, key absent')).toEqual({
      message: expect.stringContaining('Identifier "agent" not found'),
      name: 'is filled, key absent',
      outcome: 'THROW',
    });
  });

  it('answers false for the same CEL when the key is null or has a value', (): void => {
    expect(readResult('is filled, null')).toEqual({
      name: 'is filled, null',
      outcome: 'VALUE',
      value: false,
    });
    expect(readResult('is filled, value')).toEqual({
      name: 'is filled, value',
      outcome: 'VALUE',
      value: true,
    });
  });

  it('throws on an ordered comparison against null', (): void => {
    expect(readResult('greater than, null').outcome).toBe('THROW');
    expect(readResult('greater than, key absent')).toEqual({
      message: expect.stringContaining('Identifier "amount" not found'),
      name: 'greater than, key absent',
      outcome: 'THROW',
    });
    expect(readResult('greater than, value')).toEqual({
      name: 'greater than, value',
      outcome: 'VALUE',
      value: true,
    });
  });

  it('throws on a key that is not an identifier, which has() cannot guard', (): void => {
    expect(readResult('non-identifier key, key absent').outcome).toBe('THROW');
    expect(readResult('non-identifier key, value')).toEqual({
      name: 'non-identifier key, value',
      outcome: 'VALUE',
      value: true,
    });
  });
});

function readCelProbeResults(): readonly CelProbeResult[] {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const probes = ${JSON.stringify(PROBES)};
    const results = probes.map(({ context, expression, name }) => {
      const parsed = parse(expression);

      if (!parsed.isSuccess) {
        return { name, outcome: 'PARSE_FAIL' };
      }

      try {
        return {
          name,
          outcome: 'VALUE',
          value: evaluate(parsed.cst, { ...context }),
        };
      } catch (error) {
        return { message: error.message, name, outcome: 'THROW' };
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
    },
  );

  return JSON.parse(output) as readonly CelProbeResult[];
}
