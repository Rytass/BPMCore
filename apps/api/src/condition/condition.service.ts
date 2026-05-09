import { BadRequestException, Injectable } from '@nestjs/common';
import { evaluate, parse, type Failure, type ParseResult } from 'cel-js';

interface ConditionExpression {
  readonly expression: string | null | undefined;
  readonly label: string;
}

export type CelEvaluationContext = Readonly<Record<string, unknown>>;

@Injectable()
export class ConditionService {
  lintExpressions(
    expressions: readonly ConditionExpression[],
  ): readonly string[] {
    return expressions.flatMap(({ expression, label }) =>
      this.lintExpression(expression, label),
    );
  }

  lintExpression(
    expression: string | null | undefined,
    label: string,
  ): readonly string[] {
    if (typeof expression === 'undefined' || expression === null) {
      return [];
    }

    const trimmedExpression = expression.trim();

    if (!trimmedExpression) {
      return [`${label} must not be blank`];
    }

    const parseResult = parse(trimmedExpression);

    if (isParseFailure(parseResult)) {
      return parseResult.errors.map((error) => `${label}: ${error}`);
    }

    return [];
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
