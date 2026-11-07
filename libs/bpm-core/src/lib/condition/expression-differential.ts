import { ConditionService } from './condition.service';
import { createExpressionBudget } from './expression-budget';
import type { ExpressionDialect } from './expression-dialect';
import { ExpressionRuntimeError } from './expression-errors';
import type { JsonValue } from './expression-result.walker';

/**
 * Differential testing of the two dialects (Phase 23 P1, ADR 22 §3.3): the
 * same expression and the same context, evaluated once per dialect, compared
 * by result and by error code. Used by the real-engine suite to pin every
 * known difference, and meant for the dialect upgrade check (P4), which must
 * list the expressions whose behaviour would change.
 */

export interface ExpressionDifferentialCase {
  readonly expression: string;
  /** Every root the expression may read; the same object goes to both dialects. */
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * One evaluation, reduced to what a caller can observe: `ok:` and the JSON of
 * the normalized result, or `err:` and the error code. Never engine text, so
 * the outcome is safe to log or show.
 */
export type ExpressionOutcome = `ok:${string}` | `err:${string}`;

export interface ExpressionDifferentialResult {
  readonly legacy: ExpressionOutcome;
  readonly v2: ExpressionOutcome;
  readonly same: boolean;
}

/** JSON with object keys sorted, so two engines' maps compare by content. */
const stableStringify = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [key: string]: JsonValue };

    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

/**
 * Evaluates one expression with one dialect (`undefined` passes none, which
 * is how a definition saved before dialects existed is read), under a fresh
 * budget of its own so one slow case cannot fail the cases after it. Only an `ExpressionRuntimeError`
 * becomes an outcome; anything else is a bug in the runtime and is rethrown.
 */
export const readExpressionOutcome = (
  service: ConditionService,
  testCase: ExpressionDifferentialCase,
  dialect: ExpressionDialect | undefined,
): ExpressionOutcome => {
  try {
    return `ok:${stableStringify(
      service.evaluateValue(
        testCase.expression,
        testCase.context,
        'differential',
        {
          budget: createExpressionBudget(),
          ...(dialect === undefined ? {} : { dialect }),
        },
      ),
    )}`;
  } catch (error: unknown) {
    if (error instanceof ExpressionRuntimeError) {
      return `err:${error.code}`;
    }

    throw error;
  }
};

export const runExpressionDifferential = (
  testCase: ExpressionDifferentialCase,
  service: ConditionService = new ConditionService(),
): ExpressionDifferentialResult => {
  const legacy = readExpressionOutcome(service, testCase, 'cel-legacy');
  const v2 = readExpressionOutcome(service, testCase, 'cel-v2');

  return { legacy, same: legacy === v2, v2 };
};
