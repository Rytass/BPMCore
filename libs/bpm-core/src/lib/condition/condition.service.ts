import { BadRequestException, Injectable } from '@nestjs/common';
import { evaluate, parse, type Failure, type ParseResult } from 'cel-js';

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
const CEL_KEYWORDS = new Set(['false', 'has', 'in', 'null', 'true']);

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

    const parseResult = parse(trimmedExpression);

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

    const parseResult = parse(trimmedExpression);

    if (isParseFailure(parseResult)) {
      throw new BadRequestException(
        parseResult.errors.map((error) => `${label}: ${error}`).join('; '),
      );
    }

    try {
      return evaluate(parseResult.cst, { ...context });
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
