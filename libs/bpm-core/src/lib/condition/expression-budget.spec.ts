import {
  createExpressionBudget,
  currentExpressionBudget,
  DEFAULT_EXPRESSION_BUDGET,
  runExpressionOperation,
} from './expression-budget';

describe('createExpressionBudget', (): void => {
  it('caps one evaluation at the per-expression limit while the operation has time', (): void => {
    const budget = createExpressionBudget();

    expect(budget.nextTimeoutMs()).toBe(
      DEFAULT_EXPRESSION_BUDGET.perExpressionMs,
    );
    expect(budget.remainingMs).toBe(DEFAULT_EXPRESSION_BUDGET.cumulativeMs);
  });

  it('shrinks the next timeout to what the operation has left', (): void => {
    const budget = createExpressionBudget();

    budget.record(200);

    expect(budget.remainingMs).toBe(50);
    expect(budget.nextTimeoutMs()).toBe(50);
  });

  it('rounds a fractional remainder down to whole milliseconds', (): void => {
    const budget = createExpressionBudget();

    // 250 - 202.37 is 47.63 in floating point; `vm` only accepts integers.
    budget.record(202.37);

    expect(Number.isInteger(budget.nextTimeoutMs())).toBe(true);
    expect(budget.nextTimeoutMs()).toBe(47);
  });

  it('reports a sub-millisecond remainder as less than one whole millisecond', (): void => {
    const budget = createExpressionBudget();

    budget.record(249.5);

    expect(budget.remainingMs).toBe(0.5);
    expect(budget.nextTimeoutMs()).toBe(0);
  });

  it('reports zero or less once the cumulative allowance is spent', (): void => {
    const budget = createExpressionBudget();

    budget.record(DEFAULT_EXPRESSION_BUDGET.cumulativeMs);

    expect(budget.remainingMs).toBeLessThanOrEqual(0);
  });

  it('rejects a negative or non-finite elapsed time', (): void => {
    const budget = createExpressionBudget();

    expect(() => budget.record(-1)).toThrow(RangeError);
    expect(() => budget.record(Number.NaN)).toThrow(RangeError);
    expect(() => budget.record(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(budget.remainingMs).toBe(DEFAULT_EXPRESSION_BUDGET.cumulativeMs);
  });

  it('honours custom limits', (): void => {
    const budget = createExpressionBudget({
      cumulativeMs: 20,
      perExpressionMs: 5,
    });

    expect(budget.nextTimeoutMs()).toBe(5);
    budget.record(18);
    expect(budget.nextTimeoutMs()).toBe(2);
  });
});

describe('runExpressionOperation', (): void => {
  it('has no budget outside an operation', (): void => {
    expect(currentExpressionBudget()).toBeNull();
  });

  it('shares one budget across the whole operation', (): void => {
    runExpressionOperation((): void => {
      const outer = currentExpressionBudget();

      expect(outer).not.toBeNull();
      outer?.record(100);
    });
  });

  it('lets a nested operation reuse the outer budget instead of starting a new one', (): void => {
    runExpressionOperation((): void => {
      const outer = currentExpressionBudget();

      runExpressionOperation((): void => {
        expect(currentExpressionBudget()).toBe(outer);
      });
    });
  });

  it('returns the value produced by the work', (): void => {
    expect(runExpressionOperation((): string => 'done')).toBe('done');
  });
});
