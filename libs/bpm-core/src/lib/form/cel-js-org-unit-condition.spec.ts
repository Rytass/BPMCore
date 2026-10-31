import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readConditionExpression } from '@rytass/bpm-core-shared/workflow-graph';

/**
 * The IS_FILLED / IS_EMPTY expressions generated for an org_unit field, run
 * through the real cel-js (see `cel-js-list-behaviour.spec.ts` for why this
 * needs a child process). An org unit value is a string, or null when nobody
 * picked one.
 */
const FIELD = {
  fieldKey: 'u',
  label: 'U',
  required: false,
  type: 'org_unit',
} as const;
const FILLED = readConditionExpression(FIELD, 'IS_FILLED', undefined);
const EMPTY = readConditionExpression(FIELD, 'IS_EMPTY', undefined);
const VALUES: readonly unknown[] = ['unit-1', '', null];

describe('org_unit field condition expressions under cel-js', () => {
  const results = readResults();

  it.each([
    ['unit-1', true],
    ['', false],
    [null, false],
  ])('IS_FILLED for %j is %s', (value, expected): void => {
    expect(results.filled[VALUES.findIndex((v) => v === value)]).toBe(expected);
  });

  it.each([
    ['unit-1', false],
    ['', true],
    [null, true],
  ])('IS_EMPTY for %j is %s', (value, expected): void => {
    expect(results.empty[VALUES.findIndex((v) => v === value)]).toBe(expected);
  });
});

function readResults(): {
  readonly empty: readonly unknown[];
  readonly filled: readonly unknown[];
} {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const safe = (expression, form) => {
      try {
        return evaluate(parse(expression).cst, { form });
      } catch {
        return 'THROW';
      }
    };
    const run = (expression) =>
      ${JSON.stringify(VALUES)}.map((u) => safe(expression, { u }));

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
