/**
 * cel-js writes the data it was evaluating into its error messages: a missing
 * identifier error carries `JSON.stringify` of the whole evaluation context
 * (form values, initiator metadata, instance info), and other evaluation errors
 * carry the offending value (`Cannot obtain "x" from non-object context: <v>`,
 * `invalid_argument: <v>`, `Index out of bounds: <v>`). These messages reach the
 * GraphQL client and the designer dry run, so nothing but the allowlist below
 * may leave this module:
 *
 * - the error class name (`CelTypeError`, `CelEvaluationError`, `Error`, …), and
 * - for a message that is *exactly* the missing identifier shape, the
 *   identifier name. The name comes from the expression the designer wrote
 *   (`form.agent`), never from the context.
 *
 * Deliberately not exported from the package entry point: it is shared by
 * {@link ConditionService} and the workflow engine's dry run only.
 */
const MISSING_IDENTIFIER_PATTERN =
  /^Identifier "([^"\r\n]{1,128})" not found(?:, no context passed| in context: [\s\S]*)?$/u;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const FALLBACK_ERROR_NAME = 'EvaluationError';

export function describeCelEvaluationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return FALLBACK_ERROR_NAME;
  }

  const missingIdentifier = MISSING_IDENTIFIER_PATTERN.exec(error.message);

  if (missingIdentifier) {
    return `Identifier "${missingIdentifier[1]}" not found`;
  }

  return SAFE_ERROR_NAME_PATTERN.test(error.name)
    ? error.name
    : FALLBACK_ERROR_NAME;
}
