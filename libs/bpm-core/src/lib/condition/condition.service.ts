import { BadRequestException, Injectable } from '@nestjs/common';
import type { Failure, ParseResult } from 'cel-js';

/**
 * The slice of `cel-js` this service uses.
 */
interface CelEngine {
  readonly evaluate: (
    cst: unknown,
    context: Readonly<Record<string, unknown>>,
  ) => unknown;
  readonly parse: (expression: string) => ParseResult;
}

let celEngine: CelEngine | null = null;

/**
 * Loads `cel-js` on first use rather than when this module is imported.
 *
 * `cel-js` is ESM-only and its `chevrotain` dependency ships an exports map
 * that `jest-resolve` cannot follow. While the import sat at the top of this
 * file, the package root pulled it in through
 * `index → bpm-root → delegation → condition`, so *any* consumer test that
 * imported anything from `@rytass/bpm-core-nestjs-module` failed to load with
 * `Cannot find module 'chevrotain'` — pointing deep into `node_modules`, far
 * from the code under test. Hosts had to stub `cel-js` before they could write
 * a single test.
 *
 * Deferring the load means a host that never evaluates a CEL expression never
 * resolves the package at all. `require` (not `await import`) keeps every
 * caller in this file synchronous.
 */
function loadCelEngine(): CelEngine {
  if (celEngine === null) {
    try {
      celEngine = require('cel-js') as CelEngine;
    } catch (error: unknown) {
      // Deferring the load also defers this failure: it used to surface at
      // boot as a bare ERR_REQUIRE_ESM, and would now surface as a 500 on
      // whichever request first evaluated a condition. Name the cause where it
      // is thrown.
      if (isRequireEsmError(error)) {
        throw new Error(
          `[@rytass/bpm-core-nestjs-module] This Node version cannot require the ESM-only 'cel-js'. BPM needs Node >=20.19 or >=22.12 to evaluate CEL conditions. Original error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      throw error;
    }
  }

  return celEngine;
}

function isRequireEsmError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ERR_REQUIRE_ESM'
  );
}

interface ConditionExpression {
  readonly expression: string | null | undefined;
  readonly label: string;
}

interface ConditionLintOptions {
  readonly allowedRootIdentifiers?: readonly string[];
  readonly maxExpressionLength?: number;
}

export type CelEvaluationContext = Readonly<Record<string, unknown>>;

const DEFAULT_MAX_EXPRESSION_LENGTH = 2000;
// `has` and `size` are CEL macros, not context identifiers; the root-identifier
// lint must not report them as unknown. `size` is required by the table field
// IS_FILLED / IS_EMPTY expressions (ADR 16 §3.8).
const CEL_KEYWORDS = new Set(['false', 'has', 'in', 'null', 'size', 'true']);

@Injectable()
export class ConditionService {
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

    const parseResult = loadCelEngine().parse(trimmedExpression);

    if (isParseFailure(parseResult)) {
      return parseResult.errors.map((error) => `${label}: ${error}`);
    }

    return lintRootIdentifiers(trimmedExpression, label, options);
  }

  evaluateBoolean(
    expression: string | null | undefined,
    context: CelEvaluationContext,
    label: string,
  ): boolean {
    if (typeof expression !== 'string' || !expression.trim()) {
      return true;
    }

    const value = this.evaluateValue(expression, context, label);

    if (typeof value === 'boolean') {
      return value;
    }

    throw new BadRequestException(`${label} must evaluate to a boolean`);
  }

  evaluateValue(
    expression: string,
    context: CelEvaluationContext,
    label: string,
  ): unknown {
    const trimmedExpression = expression.trim();
    const lengthErrors = this.lintExpression(trimmedExpression, label);

    if (lengthErrors.length) {
      throw new BadRequestException(lengthErrors.join('; '));
    }

    const engine = loadCelEngine();
    const parseResult = engine.parse(trimmedExpression);

    if (isParseFailure(parseResult)) {
      throw new BadRequestException(
        parseResult.errors.map((error) => `${label}: ${error}`).join('; '),
      );
    }

    try {
      return engine.evaluate(parseResult.cst, { ...context });
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? `${label}: ${error.message}` : label,
      );
    }
  }
}

function isParseFailure(parseResult: ParseResult): parseResult is Failure {
  return !parseResult.isSuccess;
}

function lintRootIdentifiers(
  expression: string,
  label: string,
  options: ConditionLintOptions,
): readonly string[] {
  const allowedRootIdentifiers = options.allowedRootIdentifiers;

  if (!allowedRootIdentifiers?.length) {
    return [];
  }

  const allowed = new Set([...allowedRootIdentifiers, ...CEL_KEYWORDS]);
  const sanitizedExpression = stripStringLiterals(expression);
  const identifiers = Array.from(
    sanitizedExpression.matchAll(
      /(^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)/gu,
    ),
  ).map((match) => match[2]);
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
