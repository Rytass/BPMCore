import { Injectable } from '@nestjs/common';
import { ExpressionRuntimeError } from './expression-errors';
import {
  createExpressionBudget,
  currentExpressionBudget,
  DEFAULT_EXPRESSION_BUDGET,
  ExpressionBudget,
} from './expression-budget';
import { ExpressionRuntime } from './expression-runtime';
import { JsonValue } from './expression-result.walker';
import { loadCelEngine, parseCelLegacy } from './adapters/cel-legacy.adapter';
import { loadCelV2Environment, parseCelV2 } from './adapters/cel-v2.adapter';
import {
  DEFAULT_EXPRESSION_DIALECT,
  ExpressionDialect,
  isExpressionDialect,
  readExpressionDialect,
} from './expression-dialect';

interface ConditionExpression {
  readonly expression: string | null | undefined;
  readonly label: string;
}

interface ConditionLintOptions {
  readonly allowedRootIdentifiers?: readonly string[];
  /**
   * The engine whose parser decides syntax. Absent means `cel-legacy`; one
   * this version does not know is reported as `EXPRESSION_SYNTAX_ERROR`.
   */
  readonly dialect?: ExpressionDialect;
  readonly maxExpressionLength?: number;
}

/**
 * Options for one evaluation. Both fields are optional: without them a
 * evaluation uses the operation's budget if it runs inside one
 * (see `runExpressionOperation`), or a fresh single-expression budget.
 */
export interface ExpressionCallOptions {
  /**
   * Roots the expression may read. Checked at evaluation time, so a dry run
   * cannot read a root that the published definition would be refused for.
   */
  readonly allowedRootIdentifiers?: readonly string[];
  readonly budget?: ExpressionBudget;
  /**
   * The dialect of the definition or rule the expression belongs to. Absent
   * means `cel-legacy`, which is what every expression saved before the
   * dialect existed was written for (ADR 22 §3.3). One this version does not
   * know is refused as `EXPRESSION_SYNTAX_ERROR`.
   */
  readonly dialect?: ExpressionDialect;
}

export type CelEvaluationContext = Readonly<Record<string, unknown>>;

const DEFAULT_MAX_EXPRESSION_LENGTH = 2000;
// `has` and `size` are CEL macros, not context identifiers; the root-identifier
// lint must not report them as unknown. `size` is required by the table field
// IS_FILLED / IS_EMPTY expressions (ADR 16 §3.8).
const CEL_KEYWORDS = new Set(['false', 'has', 'in', 'null', 'size', 'true']);

@Injectable()
export class ConditionService {
  // Not a Nest provider: `ConditionService` is constructed with `new` in hosts
  // and tests, so its constructor must stay argument-free.
  private readonly runtime = new ExpressionRuntime();

  /**
   * Loads the dialect's engine now, outside any budget. Callers that are about to start a
   * budgeted run (the dry run) call this first so an interrupt cannot land
   * halfway through module loading.
   */
  prepareEngine(dialect: ExpressionDialect = DEFAULT_EXPRESSION_DIALECT): void {
    if (readExpressionDialect(dialect, 'expressionDialect') === 'cel-v2') {
      loadCelV2Environment();

      return;
    }

    loadCelEngine();
  }

  lintExpressions(
    expressions: readonly ConditionExpression[],
    options: ConditionLintOptions = {},
  ): readonly string[] {
    return expressions.flatMap(({ expression, label }) =>
      this.lintExpression(expression, label, options),
    );
  }

  lintExpression(
    expression: string | null | undefined,
    label: string,
    options: ConditionLintOptions = {},
  ): readonly string[] {
    if (typeof expression === 'undefined' || expression === null) {
      return [];
    }

    const trimmedExpression = expression.trim();
    const maxExpressionLength =
      options.maxExpressionLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;

    if (!trimmedExpression) {
      return [`${label} must not be blank`];
    }

    if (trimmedExpression.length > maxExpressionLength) {
      return [`${label} must be ${maxExpressionLength} characters or fewer`];
    }

    // A dialect this version does not know is not guessed at: parsing with
    // the wrong engine could pass what the right one refuses.
    if (
      options.dialect !== undefined &&
      !isExpressionDialect(options.dialect)
    ) {
      return [`${label}: EXPRESSION_SYNTAX_ERROR`];
    }

    // The engine's parse message is not returned: it can echo the expression,
    // and the lint result reaches GraphQL clients (ADR 22 §3.2).
    const parse =
      (options.dialect ?? DEFAULT_EXPRESSION_DIALECT) === 'cel-v2'
        ? parseCelV2
        : parseCelLegacy;

    if (parse(trimmedExpression) === null) {
      return [`${label}: EXPRESSION_SYNTAX_ERROR`];
    }

    return lintRootIdentifiers(
      trimmedExpression,
      label,
      options.allowedRootIdentifiers,
      options.dialect,
    );
  }

  evaluateBoolean(
    expression: string | null | undefined,
    context: CelEvaluationContext,
    label: string,
    options: ExpressionCallOptions = {},
  ): boolean {
    if (typeof expression !== 'string' || !expression.trim()) {
      return true;
    }

    const value = this.evaluateValue(expression, context, label, options);

    if (typeof value === 'boolean') {
      return value;
    }

    throw new ExpressionRuntimeError('EXPRESSION_TYPE_ERROR', label, {
      detail: 'must evaluate to a boolean',
    });
  }

  evaluateValue(
    expression: string,
    context: CelEvaluationContext,
    label: string,
    options: ExpressionCallOptions = {},
  ): JsonValue {
    const trimmedExpression = expression.trim();
    const dialect = readExpressionDialect(options.dialect, label);

    assertEvaluable(
      trimmedExpression,
      label,
      options.allowedRootIdentifiers,
      dialect,
    );

    return this.runtime.evaluate({
      budget:
        options.budget ??
        currentExpressionBudget() ??
        createExpressionBudget(DEFAULT_EXPRESSION_BUDGET),
      dialect,
      expression: trimmedExpression,
      label,
      roots: pickAllowedRoots(context, options.allowedRootIdentifiers),
    });
  }
}

/**
 * The roots handed to the engine: only the allowed ones when the use point has
 * an allowlist. The textual root check cannot see a macro variable's scope (it
 * skips the bound name everywhere in the expression), so this is what keeps a
 * root the use point may not read out of reach, whatever else the caller's
 * context holds. Without an allowlist the context is passed as given.
 */
function pickAllowedRoots(
  context: CelEvaluationContext,
  allowedRootIdentifiers: readonly string[] | undefined,
): CelEvaluationContext {
  if (!allowedRootIdentifiers?.length) {
    return context;
  }

  return Object.fromEntries(
    allowedRootIdentifiers
      .filter((identifier) =>
        Object.prototype.hasOwnProperty.call(context, identifier),
      )
      .map((identifier): readonly [string, unknown] => [
        identifier,
        context[identifier],
      ]),
  );
}

/**
 * Guards that run before anything is parsed or evaluated. A refusal is an
 * `EXPRESSION_SYNTAX_ERROR`: the expression is not one this runtime will run.
 */
function assertEvaluable(
  expression: string,
  label: string,
  allowedRootIdentifiers: readonly string[] | undefined,
  dialect: ExpressionDialect | undefined,
): void {
  if (!expression || expression.length > DEFAULT_MAX_EXPRESSION_LENGTH) {
    throw new ExpressionRuntimeError('EXPRESSION_SYNTAX_ERROR', label);
  }

  if (
    lintRootIdentifiers(expression, label, allowedRootIdentifiers, dialect)
      .length > 0
  ) {
    throw new ExpressionRuntimeError('EXPRESSION_SYNTAX_ERROR', label);
  }
}

// cel-v2 macros that bind a variable as their first argument
// (`list.map(x, ...)`, `list.exists(x, ...)` ...).
const CEL_V2_BINDING_MACRO_PATTERN =
  /\.\s*(?:all|exists|exists_one|filter|map)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/gu;

/**
 * Root identifiers the expression reads that its use point does not allow.
 *
 * The scan is textual. For `cel-v2` it also skips what that dialect adds and
 * is not a root: names a macro binds (`a` in `form.l.map(a, a.qty)`) and
 * global function calls (`int(form.x)`). This is an interim rule until P2
 * checks roots on the AST (ADR 22 §3.4).
 *
 * A bound name is skipped everywhere in the expression, not only inside its
 * macro, so `[1].exists(lastDecision, true) && lastDecision.d == ""` passes
 * this check (and the lint) even where `lastDecision` is not allowed. What
 * stops it reading that root is evaluation: `evaluateValue` hands the engine
 * only the allowed roots (`pickAllowedRoots`), so the name outside the macro
 * is a missing key. The lint still says nothing; P2 closes that on the AST.
 */
function lintRootIdentifiers(
  expression: string,
  label: string,
  allowedRootIdentifiers: readonly string[] | undefined,
  dialect: ExpressionDialect = DEFAULT_EXPRESSION_DIALECT,
): readonly string[] {
  if (!allowedRootIdentifiers?.length) {
    return [];
  }

  const sanitizedExpression = stripStringLiterals(expression);
  const isV2 = dialect === 'cel-v2';
  const boundNames = isV2
    ? Array.from(
        sanitizedExpression.matchAll(CEL_V2_BINDING_MACRO_PATTERN),
      ).map((match) => match[1])
    : [];
  const allowed = new Set([
    ...allowedRootIdentifiers,
    ...CEL_KEYWORDS,
    ...boundNames,
  ]);
  const identifiers = Array.from(
    sanitizedExpression.matchAll(
      /(^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)/gu,
    ),
  )
    .filter(
      (match) =>
        !isV2 ||
        !/^\s*\(/u.test(
          sanitizedExpression.slice((match.index ?? 0) + match[0].length),
        ),
    )
    .map((match) => match[2]);
  const unknownIdentifiers = [
    ...new Set(identifiers.filter((identifier) => !allowed.has(identifier))),
  ];

  return unknownIdentifiers.map(
    (identifier) => `${label} references unsupported identifier ${identifier}`,
  );
}

function stripStringLiterals(expression: string): string {
  return expression.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/gu, '""');
}
