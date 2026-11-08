import { AsyncLocalStorage } from 'async_hooks';

export interface ExpressionBudgetOptions {
  /** Upper bound for one evaluation, in milliseconds. */
  readonly perExpressionMs: number;
  /** Upper bound for every evaluation in one operation, in milliseconds. */
  readonly cumulativeMs: number;
}

/** ADR 22 §3.2 initial values. Measured values must be written back to the ADR. */
export const DEFAULT_EXPRESSION_BUDGET: ExpressionBudgetOptions = {
  cumulativeMs: 250,
  perExpressionMs: 100,
};

export interface ExpressionBudget {
  /**
   * Timeout for the next evaluation: the smaller of the per-expression cap and
   * what is left, rounded down to whole milliseconds. `vm.Script` rejects a
   * fractional timeout, so a caller must treat a result below 1 as exhausted.
   */
  nextTimeoutMs(): number;
  /** Records the time one evaluation actually took. */
  record(elapsedMs: number): void;
  /** Milliseconds still available in this operation. Zero or less means exhausted. */
  readonly remainingMs: number;
}

/**
 * A ledger that tracks evaluation time for one operation. It counts only time
 * spent inside evaluations, not wall-clock time, so database waits do not use
 * up the budget.
 */
export const createExpressionBudget = (
  options: ExpressionBudgetOptions = DEFAULT_EXPRESSION_BUDGET,
): ExpressionBudget => {
  let spentMs = 0;

  return {
    nextTimeoutMs(): number {
      // `spentMs` is a sum of measured fractions, so the remainder is usually
      // fractional (250 - 202.37 = 47.63). Node rejects that as a `vm` timeout.
      return Math.floor(
        Math.min(options.perExpressionMs, options.cumulativeMs - spentMs),
      );
    },
    get remainingMs(): number {
      return options.cumulativeMs - spentMs;
    },
    record(elapsedMs: number): void {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new RangeError('An expression elapsed time must be non-negative');
      }

      spentMs += elapsedMs;
    },
  };
};

const operationBudget = new AsyncLocalStorage<ExpressionBudget>();

/**
 * The budget of the operation this code is running in, or `null` outside one.
 * Evaluations outside any operation fall back to a fresh single-expression
 * budget, which is the behaviour before this change.
 */
export const currentExpressionBudget = (): ExpressionBudget | null =>
  operationBudget.getStore() ?? null;

/**
 * Runs `work` as one operation: every evaluation inside it shares one cumulative
 * budget. An operation nested inside another reuses the outer budget, so a
 * public method that calls another cannot multiply the allowance.
 *
 * The budget is carried by `AsyncLocalStorage` instead of being passed down
 * explicitly. Threading it through every token-advancing helper would change
 * about thirty signatures; the P1 dialect work is planned to thread a parameter
 * through the same helpers, so this is a deliberate deviation from ADR 24 §7.2
 * that should be revisited then.
 */
export const runExpressionOperation = <TResult>(
  work: () => TResult,
): TResult => {
  if (operationBudget.getStore()) {
    return work();
  }

  return operationBudget.run(createExpressionBudget(), work);
};
