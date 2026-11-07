/**
 * cel-js writes the data it was evaluating into its error messages: a missing
 * identifier error carries `JSON.stringify` of the whole evaluation context
 * (form values, initiator metadata, instance info), and other evaluation errors
 * carry the offending value (`Cannot obtain "x" from non-object context: <v>`,
 * `invalid_argument: <v>`, `Index out of bounds: <v>`). These messages reach the
 * GraphQL client and the designer dry run, so only the following may leave this
 * module:
 *
 * - the error class name (`CelTypeError`, `CelEvaluationError`, `Error`, …);
 * - for a message that is *exactly* the missing identifier shape, the
 *   identifier name, and only when that name is text the designer wrote in the
 *   expression being evaluated: a bare token outside any string literal (a root
 *   identifier or `.name`) or a string literal used as an index (`["a-b"]`).
 *   A token must start at a word boundary, so the suffix of a number
 *   (`5u`, `1e5`) is not a name; a bracketed string counts as an index only
 *   when an expression precedes the bracket (an identifier character, `]` or
 *   `)`, whitespace allowed), so a list literal (`["a"]`, `x in ["a"]`,
 *   `f(["a"])`) is not an index. Without the expression, or when the name is
 *   not written there, the message is `Identifier not found` with no name.
 *
 * Why the check against the expression: cel-js also reports an *evaluated
 * index* as the "identifier". `form.rates[form.currency]` fails with
 * `Identifier "<the value of form.currency>" not found`, so the name slot can
 * hold a context value. A value is never an authored token of the expression,
 * with one limit that cannot be closed: a value that happens to equal a name
 * the expression also writes (`form.currency` holding `"currency"`) is
 * indistinguishable from the name itself.
 *
 * Deliberately not exported from the package entry point: it is shared by
 * {@link ConditionService} and the workflow engine's dry run only.
 */
const MISSING_IDENTIFIER_PATTERN =
  /^Identifier "([^"\r\n]{1,128})" not found(?:, no context passed| in context: [\s\S]*)?$/u;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const FALLBACK_ERROR_NAME = 'EvaluationError';
const STRING_LITERAL_PATTERN = /"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'/gu;
const INDEX_LITERAL_PATTERN =
  /(?<=[A-Za-z0-9_\])]\s*)(?<!(?<![A-Za-z0-9_])in\s*)\[\s*(?:"([^"\\\r\n]*)"|'([^'\\\r\n]*)')\s*\]/gu;
const TOKEN_PATTERN = /(?<![0-9A-Za-z_])[A-Za-z_][A-Za-z0-9_]*/gu;

/**
 * The CEL engine could not be loaded on this Node version. It carries no
 * evaluation data, so its name is what the designer is told instead of a bare
 * `Error`.
 */
export class CelEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CelEngineUnavailableError';
  }
}

export function describeCelEvaluationError(
  error: unknown,
  expression?: string,
): string {
  if (!(error instanceof Error)) {
    return FALLBACK_ERROR_NAME;
  }

  const missingIdentifier = MISSING_IDENTIFIER_PATTERN.exec(error.message);

  if (missingIdentifier) {
    const name = missingIdentifier[1];

    return expression !== undefined && readAuthoredNames(expression).has(name)
      ? `Identifier "${name}" not found`
      : 'Identifier not found';
  }

  return SAFE_ERROR_NAME_PATTERN.test(error.name)
    ? error.name
    : FALLBACK_ERROR_NAME;
}

function readAuthoredNames(expression: string): ReadonlySet<string> {
  const indexLiterals = Array.from(expression.matchAll(INDEX_LITERAL_PATTERN))
    .map((match) => match[1] ?? match[2])
    .filter((name): name is string => typeof name === 'string' && name !== '');
  const tokens = Array.from(
    expression.replace(STRING_LITERAL_PATTERN, '""').matchAll(TOKEN_PATTERN),
  ).map((match) => match[0]);

  return new Set([...indexLiterals, ...tokens]);
}
