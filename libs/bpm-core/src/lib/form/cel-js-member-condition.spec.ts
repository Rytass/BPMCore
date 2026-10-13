import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readConditionExpression } from '@rytass/bpm-core-shared/workflow-graph';

/**
 * The IS_FILLED / IS_EMPTY expressions generated for a member field, run
 * through the real cel-js (see `cel-js-list-behaviour.spec.ts` for why this
 * needs a child process). A member value is a string or, when `multiple`, a
 * list — and `size(null)` throws, so the expressions must not use it.
 */
const FILLED = readConditionExpression(
  { fieldKey: 'm', label: 'M', required: false, type: 'member' },
  'IS_FILLED',
  undefined,
);
const EMPTY = readConditionExpression(
  { fieldKey: 'm', label: 'M', required: false, type: 'member' },
  'IS_EMPTY',
  undefined,
);
const VALUES: readonly unknown[] = ['user-1', '', null, ['a', 'b'], []];

describe('member field condition expressions under cel-js', () => {
  const results = readResults();

  it.each([
    ['user-1', true],
    ['', false],
    [null, false],
    [['a', 'b'], true],
    [[], false],
  ])('IS_FILLED for %j is %s', (value, expected): void => {
    expect(results.filled[VALUES.findIndex((v) => equals(v, value))]).toBe(
      expected,
    );
  });

  it.each([
    ['user-1', false],
    ['', true],
    [null, true],
    [['a', 'b'], false],
    [[], true],
  ])('IS_EMPTY for %j is %s', (value, expected): void => {
    expect(results.empty[VALUES.findIndex((v) => equals(v, value))]).toBe(
      expected,
    );
  });
});

function equals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readResults(): {
  readonly empty: readonly unknown[];
  readonly filled: readonly unknown[];
} {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const run = (expression) => ${JSON.stringify(VALUES)}.map((m) => {
      try {
        return evaluate(parse(expression).cst, { form: { m } });
      } catch {
        return 'THROW';
      }
    });

    process.stdout.write(JSON.stringify({
      empty: run(${JSON.stringify(EMPTY)}),
      filled: run(${JSON.stringify(FILLED)}),
    }));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }),
  );
}
