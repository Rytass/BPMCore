import { BadRequestException } from '@nestjs/common';
import { TimeBudgetExceededError } from '../workflow-engine/time-budget';
import { ExpressionEngineFailure } from './expression-engine-failure';

/**
 * The only runtime error codes an expression may surface (ADR 22 §3.2). They
 * are part of the public contract: do not add to or rename them without an ADR
 * update.
 */
export const EXPRESSION_ERROR_CODES = [
  'EXPRESSION_SYNTAX_ERROR',
  'EXPRESSION_MISSING_KEY',
  'EXPRESSION_TYPE_ERROR',
  'EXPRESSION_BUDGET_EXCEEDED',
  'EXPRESSION_INVALID_RESULT',
  'EXPRESSION_FUNCTION_FAILED',
] as const;

export type ExpressionErrorCode = (typeof EXPRESSION_ERROR_CODES)[number];

interface ExpressionRuntimeErrorOptions {
  /** Short fixed phrase inserted between the label and the code. Never engine text. */
  readonly detail?: string;
  /**
   * The missing root-level key, if the engine said so in a known shape. Only the
   * dry run shows it; the case runtime never reads it.
   */
  readonly keyName?: string | null;
}

/**
 * The one error an expression can raise to a caller. The message is only the
 * label and the code, so neither the engine text nor a context value can reach
 * an HTTP response, an activity log or a notification. It extends
 * `BadRequestException` so the HTTP status stays 400, as before.
 */
export class ExpressionRuntimeError extends BadRequestException {
  readonly code: ExpressionErrorCode;
  readonly label: string;
  readonly keyName: string | null;

  constructor(
    code: ExpressionErrorCode,
    label: string,
    options: ExpressionRuntimeErrorOptions = {},
  ) {
    super(`${label}${options.detail ? ` ${options.detail}` : ''}: ${code}`);

    this.code = code;
    this.label = label;
    this.keyName = options.keyName ?? null;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/*
 * Allowlist of engine message shapes that identify a missing key. Matching is
 * anchored at the start and only the captured name is kept. Anything that does
 * not match is classified by the fallback below and no fragment of it is kept.
 */
const MISSING_KEY_PATTERNS: readonly RegExp[] = [
  /^Identifier "([^"]*)" not found in context: /u,
  /^Cannot obtain "([^"]*)" from non-object context/u,
];

/*
 * CEL string and bytes literals, prefix included (`r`, `b`, `rb` ...) when it
 * starts a token, so the tail of an identifier is never removed with it. Triple
 * quotes come first so `"""a"""` is one literal, not three. Escapes are skipped
 * even in raw strings: a raw literal ending in a backslash then swallows more of
 * the source than it should, which only removes candidate names, never adds one.
 */
const STRING_LITERAL_PATTERN =
  /(?:(?<![A-Za-z0-9_])[rRbB]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/gu;

/**
 * Whether `name` is written in the expression as an identifier, outside every
 * string literal. The engine reports the key it failed to find, and with a
 * computed index (`form.a[form.b]`) that key is a value read from the context,
 * not something the author wrote. Only a name the author wrote may be shown.
 * `name` has already passed {@link IDENTIFIER_PATTERN}, so it is safe in a regex.
 */
const isWrittenIdentifier = (expression: string, name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'u').test(
    expression.replace(STRING_LITERAL_PATTERN, ' '),
  );

/**
 * Converts anything an evaluation threw into an {@link ExpressionRuntimeError}.
 * Unknown failures become `EXPRESSION_TYPE_ERROR`: the message is dropped rather
 * than guessed at, so a new engine message can never leak.
 *
 * `keyName` is kept only when `expression` is given and writes that name as an
 * identifier outside string literals; otherwise it is `null`. Without the
 * expression there is no way to tell a key name from a context value.
 */
export function toExpressionRuntimeError(
  error: unknown,
  label: string,
  expression?: string,
): ExpressionRuntimeError {
  if (error instanceof ExpressionRuntimeError) {
    return error;
  }

  if (error instanceof TimeBudgetExceededError) {
    return new ExpressionRuntimeError('EXPRESSION_BUDGET_EXCEEDED', label);
  }

  if (error instanceof ExpressionEngineFailure) {
    const name = error.keyNameCandidate ?? '';

    return new ExpressionRuntimeError(error.code, label, {
      keyName:
        error.code === 'EXPRESSION_MISSING_KEY' &&
        expression !== undefined &&
        IDENTIFIER_PATTERN.test(name) &&
        isWrittenIdentifier(expression, name)
          ? name
          : null,
    });
  }

  const message = error instanceof Error ? error.message : '';

  for (const pattern of MISSING_KEY_PATTERNS) {
    const match = pattern.exec(message);

    if (match) {
      const name = match[1] ?? '';

      return new ExpressionRuntimeError('EXPRESSION_MISSING_KEY', label, {
        keyName:
          expression !== undefined &&
          IDENTIFIER_PATTERN.test(name) &&
          isWrittenIdentifier(expression, name)
            ? name
            : null,
      });
    }
  }

  return new ExpressionRuntimeError('EXPRESSION_TYPE_ERROR', label);
}
