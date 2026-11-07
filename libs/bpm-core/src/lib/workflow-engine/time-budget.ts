import { createContext, Script } from 'vm';

/** Thrown by {@link runWithinTimeBudget} when the work was interrupted. */
export class TimeBudgetExceededError extends Error {
  constructor() {
    super('The work could not be finished in time');
    this.name = 'TimeBudgetExceededError';
  }
}

const RUN = new Script('run()');

const isScriptTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { readonly code?: unknown }).code ===
    'ERR_SCRIPT_EXECUTION_TIMEOUT';

/**
 * Runs synchronous work and interrupts it once the budget is spent, including
 * host functions it calls. This guards the event loop, not a security boundary:
 * the work runs with full access to this process, memory is not limited, and an
 * interrupt skips every `catch` and `finally` on the way out. So the work must
 * leave nothing behind that an interrupt could strand half-done, such as a
 * module still loading on first use.
 */
export function runWithinTimeBudget<TResult>(
  work: () => TResult,
  timeoutMs: number,
): TResult {
  try {
    return RUN.runInContext(createContext({ run: work }), {
      timeout: timeoutMs,
    }) as TResult;
  } catch (error: unknown) {
    if (isScriptTimeout(error)) {
      throw new TimeBudgetExceededError();
    }

    throw error;
  }
}
