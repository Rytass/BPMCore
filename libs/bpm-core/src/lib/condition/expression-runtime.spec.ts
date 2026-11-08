import {
  ExpressionRuntime,
  type ExpressionEngineAdapter,
} from './expression-runtime';
import { createExpressionBudget } from './expression-budget';
import { ExpressionRuntimeError } from './expression-errors';

// A stand-in engine: the runtime only needs compile and evaluate to run inside
// the time budget, so the result is fixed and no real parser is involved.
const stubAdapter: ExpressionEngineAdapter = {
  compile: (expression: string): { readonly native: string } => ({
    native: expression,
  }),
  evaluate: (): unknown => 42,
};

const readErrorCode = (action: () => unknown): string | null => {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof ExpressionRuntimeError ? error.code : 'OTHER';
  }

  return null;
};

describe('ExpressionRuntime budget', (): void => {
  const runtime = new ExpressionRuntime(stubAdapter);

  it('evaluates when the remainder is fractional and at least one whole millisecond', (): void => {
    const budget = createExpressionBudget();

    // Before the floor, this remainder reached `vm` as 47.63 and failed with
    // ERR_OUT_OF_RANGE, which was then reported as EXPRESSION_TYPE_ERROR.
    budget.record(202.37);

    expect(
      runtime.evaluate({
        budget,
        expression: 'form.amount',
        label: 'test',
        roots: {},
      }),
    ).toBe(42);
  });

  it('reports EXPRESSION_BUDGET_EXCEEDED when the remainder is under one millisecond', (): void => {
    const budget = createExpressionBudget();

    budget.record(249.5);

    expect(
      readErrorCode((): unknown =>
        runtime.evaluate({
          budget,
          expression: 'form.amount',
          label: 'test',
          roots: {},
        }),
      ),
    ).toBe('EXPRESSION_BUDGET_EXCEEDED');
  });

  it('reports EXPRESSION_BUDGET_EXCEEDED once the allowance is fully spent', (): void => {
    const budget = createExpressionBudget();

    budget.record(250);

    expect(
      readErrorCode((): unknown =>
        runtime.evaluate({
          budget,
          expression: 'form.amount',
          label: 'test',
          roots: {},
        }),
      ),
    ).toBe('EXPRESSION_BUDGET_EXCEEDED');
  });
});
