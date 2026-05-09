export type Success = {
  readonly cst: Readonly<{ readonly expression: string }>;
  readonly isSuccess: true;
};

export type Failure = {
  readonly errors: readonly string[];
  readonly isSuccess: false;
};

export type ParseResult = Success | Failure;

export function parse(expression: string): ParseResult {
  try {
    createExpressionFunction(expression);

    return {
      cst: { expression },
      isSuccess: true,
    };
  } catch (error: unknown) {
    return {
      errors: [error instanceof Error ? error.message : 'Invalid expression'],
      isSuccess: false,
    };
  }
}

export function evaluate(
  expression: string | Readonly<{ readonly expression: string }>,
  context: Readonly<Record<string, unknown>> = {},
): unknown {
  const sourceExpression =
    typeof expression === 'string' ? expression : expression.expression;

  return createExpressionFunction(sourceExpression)(context);
}

function createExpressionFunction(
  expression: string,
): (context: Readonly<Record<string, unknown>>) => unknown {
  return Function(
    'context',
    `const scope = context; with (scope) { return (${expression}); }`,
  ) as (context: Readonly<Record<string, unknown>>) => unknown;
}
