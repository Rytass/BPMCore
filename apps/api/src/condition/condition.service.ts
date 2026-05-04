import { Injectable } from '@nestjs/common';

interface ConditionExpression {
  readonly expression: string | null | undefined;
  readonly label: string;
}

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

    return hasBalancedQuotes(trimmedExpression)
      ? []
      : [`${label} has unbalanced string quotes`];
  }
}

function hasBalancedQuotes(expression: string): boolean {
  return countUnescaped(expression, "'") % 2 === 0 &&
    countUnescaped(expression, '"') % 2 === 0;
}

function countUnescaped(value: string, character: string): number {
  return Array.from(value).reduce(
    (count, current, index, characters): number =>
      current === character && characters[index - 1] !== '\\'
        ? count + 1
        : count,
    0,
  );
}
