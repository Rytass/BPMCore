import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Evidence for docs/17 appendix A: what cel-js really does with a table field,
 * which reaches the evaluator as a list of maps.
 *
 * This suite cannot import `cel-js` directly. The bpm-core jest config maps the
 * package to a JavaScript-eval shim (`testing/cel-js.jest.ts`) because the real
 * package is ESM-only and will not load under the CommonJS test runtime — and
 * the shim answers with JavaScript semantics, not CEL ones (`[] != ""` is false
 * in JavaScript and true in CEL; `size()` does not exist at all). So the real
 * package is driven in a child Node process running the same parse → evaluate
 * sequence as {@link ConditionService.evaluateBoolean}.
 */
interface CelProbeResult {
  readonly expression: string;
  readonly outcome: 'PARSE_FAIL' | 'THROW' | 'VALUE';
  readonly value?: unknown;
}

const CONTEXT = {
  form: {
    empty: [],
    items: [
      { name: 'A', qty: 3 },
      { name: 'B', qty: 0 },
    ],
  },
};

const EXPRESSIONS: readonly string[] = [
  'form.items != null && size(form.items) > 0',
  'form.empty == null || size(form.empty) == 0',
  'form.empty != null && form.empty != ""',
  'size(form.items) == 2',
  'form.items.size() > 0',
  'form.items[0].qty > 1',
  'form.items[5].qty > 1',
  'form.items[0].missing == null',
  'form.items.exists(row, row.qty > 2)',
  'form.items.all(row, row.qty >= 0)',
  'has(form.items)',
];

describe('cel-js list of map behaviour', () => {
  const results = readCelProbeResults();
  const readResult = (expression: string): CelProbeResult => {
    const result = results.find((item) => item.expression === expression);

    if (!result) {
      throw new Error(`No probe result for ${expression}`);
    }

    return result;
  };

  it('parses every probed expression', (): void => {
    expect(
      results.filter((result) => result.outcome === 'PARSE_FAIL'),
    ).toEqual([]);
  });

  it('counts rows with the global size macro', (): void => {
    expect(readResult('form.items != null && size(form.items) > 0')).toEqual({
      expression: 'form.items != null && size(form.items) > 0',
      outcome: 'VALUE',
      value: true,
    });
    expect(readResult('form.empty == null || size(form.empty) == 0')).toEqual({
      expression: 'form.empty == null || size(form.empty) == 0',
      outcome: 'VALUE',
      value: true,
    });
    expect(readResult('size(form.items) == 2').value).toBe(true);
  });

  it('is why table emptiness cannot reuse the string comparison', (): void => {
    // An empty list is neither null nor "", so the flat-field IS_FILLED
    // expression would report a zero-row table as filled.
    expect(readResult('form.empty != null && form.empty != ""').value).toBe(
      true,
    );
  });

  it('rejects the method form of size', (): void => {
    expect(readResult('form.items.size() > 0').outcome).toBe('THROW');
  });

  it('supports indexed cell access but throws outside the data', (): void => {
    expect(readResult('form.items[0].qty > 1').value).toBe(true);
    expect(readResult('form.items[5].qty > 1').outcome).toBe('THROW');
    expect(readResult('form.items[0].missing == null').outcome).toBe('THROW');
  });

  it('evaluates comprehension macros over rows', (): void => {
    expect(readResult('form.items.exists(row, row.qty > 2)').value).toBe(true);
    expect(readResult('form.items.all(row, row.qty >= 0)').value).toBe(true);
    expect(readResult('has(form.items)').value).toBe(true);
  });
});

function readCelProbeResults(): readonly CelProbeResult[] {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const context = ${JSON.stringify(CONTEXT)};
    const expressions = ${JSON.stringify(EXPRESSIONS)};
    const results = expressions.map((expression) => {
      const parsed = parse(expression);

      if (!parsed.isSuccess) {
        return { expression, outcome: 'PARSE_FAIL' };
      }

      try {
        return {
          expression,
          outcome: 'VALUE',
          value: evaluate(parsed.cst, { ...context }),
        };
      } catch {
        return { expression, outcome: 'THROW' };
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
