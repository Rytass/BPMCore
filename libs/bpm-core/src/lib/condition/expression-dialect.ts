import type { WorkflowExpressionDialect } from '@rytass/bpm-core-shared/workflow';
import { ExpressionRuntimeError } from './expression-errors';

/**
 * The engines an expression can be written for (ADR 22 §3.3). A definition or
 * a delegation rule names one; everything it holds is evaluated with it.
 */
export const EXPRESSION_DIALECTS = ['cel-legacy', 'cel-v2'] as const;

export type ExpressionDialect = WorkflowExpressionDialect;

/**
 * What a missing dialect means. Every definition, case snapshot and rule saved
 * before the field existed was written for `cel-legacy`, so this must never
 * change: changing it would re-route cases already in flight.
 */
export const DEFAULT_EXPRESSION_DIALECT: ExpressionDialect = 'cel-legacy';

export const isExpressionDialect = (
  value: unknown,
): value is ExpressionDialect =>
  typeof value === 'string' &&
  (EXPRESSION_DIALECTS as readonly string[]).includes(value);

/**
 * The dialect a stored value names. `undefined` and `null` are the default.
 * Anything else that is not a known dialect (a value written by a newer
 * version, or hand-edited) is refused as `EXPRESSION_SYNTAX_ERROR` instead of
 * being guessed at: evaluating it with the wrong engine could route a case
 * differently from what its author tested.
 */
export const readExpressionDialect = (
  value: unknown,
  label: string,
): ExpressionDialect => {
  if (value === undefined || value === null) {
    return DEFAULT_EXPRESSION_DIALECT;
  }

  if (isExpressionDialect(value)) {
    return value;
  }

  throw new ExpressionRuntimeError('EXPRESSION_SYNTAX_ERROR', label, {
    detail: 'names an unknown expression dialect',
  });
};

/**
 * The dialect of a workflow definition or case snapshot. Takes the loosest
 * shape on purpose: snapshots are parsed JSON, and the field may be missing.
 */
export const readWorkflowExpressionDialect = (
  definition: { readonly expressionDialect?: unknown } | null | undefined,
): ExpressionDialect =>
  readExpressionDialect(
    definition?.expressionDialect,
    'workflow.expressionDialect',
  );
