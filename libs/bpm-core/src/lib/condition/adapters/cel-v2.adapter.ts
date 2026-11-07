import type {
  Environment,
  EnvironmentOptions,
  ParseResult,
} from '@marcbachmann/cel-js';
import { ExpressionEngineFailure } from '../expression-engine-failure';
import type { ExpressionErrorCode } from '../expression-errors';
import type {
  ExpressionEngineAdapter,
  ExpressionHandle,
} from '../expression-runtime';

/** The slice of `@marcbachmann/cel-js` this adapter uses. */
interface CelV2Module {
  readonly Environment: new (options?: EnvironmentOptions) => Environment;
}

/**
 * Parse-time structure limits (ADR 22 §3.4, docs/24 §2.7). They are applied by
 * the engine while parsing, so an over-large expression never reaches the
 * budget. Comprehension nesting is not an engine limit; P2 checks it on the AST.
 */
export const CEL_V2_LIMITS = {
  maxAstNodes: 200,
  maxDepth: 32,
} as const;

const MIXED_ARITHMETIC_OPERATORS = ['+', '-', '*', '/', '%'] as const;

type MixedArithmeticOperator = (typeof MIXED_ARITHMETIC_OPERATORS)[number];

/**
 * A CEL `int` (a `bigint`) or `double` (a `number`) as a JS number. An int
 * outside the safe range cannot become a double without silently changing,
 * so it is refused (docs/24 §2.1: out of safe range is `EXPRESSION_INVALID_RESULT`).
 */
const toDouble = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (
    typeof value === 'bigint' &&
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(value);
  }

  throw new ExpressionEngineFailure('EXPRESSION_INVALID_RESULT');
};

/**
 * The mixed `int`/`double` arithmetic cel-legacy gives for free (it only has
 * JS numbers) and cel-v2 refuses with `no such overload`. Form values arrive as
 * JS numbers, which cel-v2 types as `double`, while integer literals are `int`,
 * so without these `form.amount * 2` fails (ADR 22 §3.3). The result is a
 * `double`, as in cel-legacy.
 *
 * A zero divisor throws `EXPRESSION_TYPE_ERROR` (docs/24 §2.1) instead of
 * returning `Infinity`/`NaN`, which a comparison would quietly turn into a
 * routing decision.
 */
const MIXED_ARITHMETIC: Readonly<
  Record<MixedArithmeticOperator, (left: number, right: number) => number>
> = {
  '%': (left, right) => left % right,
  '*': (left, right) => left * right,
  '+': (left, right) => left + right,
  '-': (left, right) => left - right,
  '/': (left, right) => left / right,
};

const runMixedArithmetic = (
  operator: MixedArithmeticOperator,
  left: unknown,
  right: unknown,
): number => {
  const leftNumber = toDouble(left);
  const rightNumber = toDouble(right);

  if ((operator === '/' || operator === '%') && rightNumber === 0) {
    throw new ExpressionEngineFailure('EXPRESSION_TYPE_ERROR');
  }

  return MIXED_ARITHMETIC[operator](leftNumber, rightNumber);
};

/**
 * `int == double`, exact: the int is compared as a `bigint`, so a large int is
 * never rounded into equality with a nearby double. Registering it also gives
 * the reverse order and `!=` (the engine derives them).
 */
const isIntEqualToDouble = (left: unknown, right: unknown): boolean => {
  const [int, double] =
    typeof left === 'bigint' ? [left, right] : [right, left];

  return (
    typeof int === 'bigint' &&
    typeof double === 'number' &&
    Number.isInteger(double) &&
    BigInt(double) === int
  );
};

/**
 * Options that make cel-v2 read a BPM context the way cel-legacy did:
 * undeclared roots are `dyn` (the roots are checked by the runtime's
 * allowlist, not by declaration), and list and map literals may mix value
 * types (`{"a": "x", "b": 2}`, which cel-legacy refuses).
 */
const ENVIRONMENT_OPTIONS: EnvironmentOptions = {
  homogeneousAggregateLiterals: false,
  limits: CEL_V2_LIMITS,
  unlistedVariablesAreDyn: true,
};

const createEnvironment = (module: CelV2Module): Environment => {
  const environment = new module.Environment(ENVIRONMENT_OPTIONS);

  MIXED_ARITHMETIC_OPERATORS.forEach((operator): void => {
    environment.registerOperator(
      `double ${operator} int: double`,
      (left: unknown, right: unknown): number =>
        runMixedArithmetic(operator, left, right),
    );
    environment.registerOperator(
      `int ${operator} double: double`,
      (left: unknown, right: unknown): number =>
        runMixedArithmetic(operator, left, right),
    );
  });
  // `in` is deliberately not registered for mixed lists: an `int in
  // list<double>` overload makes the engine's own `V in list<V>` ambiguous for
  // `dyn` values, and `form.qty in [1, 2.5]` then fails at evaluation.
  environment.registerOperator('int == double', isIntEqualToDouble);

  return environment;
};

let celV2Environment: Environment | null = null;

/**
 * Loads `@marcbachmann/cel-js` on first use, like `loadCelEngine` does for
 * cel-legacy, and for the same reasons: a host that never evaluates a cel-v2
 * expression never resolves the package, and the ESM-only package is loaded
 * with `require` so every caller stays synchronous (Node >=20.19 / >=22.12).
 *
 * The runtime compiles before any budget starts, and compiling loads the
 * engine, so an interrupt can never land halfway through loading it.
 */
export function loadCelV2Environment(): Environment {
  if (celV2Environment === null) {
    let module: CelV2Module;

    try {
      module = require('@marcbachmann/cel-js') as CelV2Module;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { readonly code?: unknown }).code === 'ERR_REQUIRE_ESM'
      ) {
        throw new Error(
          `[@rytass/bpm-core-nestjs-module] This Node version cannot require the ESM-only '@marcbachmann/cel-js'. BPM needs Node >=20.19 or >=22.12 to evaluate cel-v2 expressions. Original error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      throw error;
    }

    celV2Environment = createEnvironment(module);
  }

  return celV2Environment;
}

/**
 * Parses with cel-v2. Returns `null` when the expression does not parse or
 * breaks a structure limit. The engine is loaded outside the `try`: a failure
 * to load it is a configuration error, not a bad expression.
 */
export function parseCelV2(expression: string): ExpressionHandle | null {
  const environment = loadCelV2Environment();

  try {
    return { native: environment.parse(expression) };
  } catch {
    return null;
  }
}

interface CelErrorShape {
  readonly code: string;
  readonly name: string;
  readonly summary: string;
}

const isCelError = (error: unknown): error is CelErrorShape =>
  error instanceof Error &&
  (error.name === 'EvaluationError' ||
    error.name === 'TypeError' ||
    error.name === 'ParseError') &&
  typeof (error as { readonly code?: unknown }).code === 'string' &&
  typeof (error as { readonly summary?: unknown }).summary === 'string';

/*
 * The only engine summaries a key name is read from. Anchored at both ends;
 * the candidate is checked against the expression before anyone sees it.
 * `No such key: index out of bounds, ...` does not match, by design.
 */
const KEY_NAME_PATTERNS: readonly RegExp[] = [
  /^No such key: ([A-Za-z_][A-Za-z0-9_]*)$/u,
  /^Unknown variable: ([A-Za-z_][A-Za-z0-9_]*)$/u,
];

const readKeyNameCandidate = (summary: string): string | null =>
  KEY_NAME_PATTERNS.reduce<string | null>(
    (found, pattern) => found ?? pattern.exec(summary)?.[1] ?? null,
    null,
  );

const CEL_V2_CODE_MAP: Readonly<Record<string, ExpressionErrorCode>> = {
  index_out_of_bounds: 'EXPRESSION_MISSING_KEY',
  index_out_of_range: 'EXPRESSION_MISSING_KEY',
  no_such_key: 'EXPRESSION_MISSING_KEY',
  numeric_overflow: 'EXPRESSION_INVALID_RESULT',
  unknown_variable: 'EXPRESSION_MISSING_KEY',
};

/**
 * Maps an error cel-v2 threw to a classified failure, by its `code` only. Any
 * code not listed is a type or evaluation error. Errors that are not cel-v2's
 * (an operator handler's own failure, a stack overflow) pass through unchanged
 * and are classified by the runtime.
 */
export function classifyCelV2Error(error: unknown): unknown {
  if (!isCelError(error)) {
    return error;
  }

  const code = CEL_V2_CODE_MAP[error.code] ?? 'EXPRESSION_TYPE_ERROR';

  return new ExpressionEngineFailure(
    code,
    code === 'EXPRESSION_MISSING_KEY'
      ? readKeyNameCandidate(error.summary)
      : null,
  );
}

export const celV2Adapter: ExpressionEngineAdapter = {
  compile: parseCelV2,
  evaluate: (handle, roots): unknown => {
    try {
      return (handle.native as ParseResult)({ ...roots });
    } catch (error: unknown) {
      throw classifyCelV2Error(error);
    }
  },
};
