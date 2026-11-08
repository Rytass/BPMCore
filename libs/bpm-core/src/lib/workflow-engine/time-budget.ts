import { createContext, Script } from 'vm';

/** Thrown by {@link runWithinTimeBudget} when the work was interrupted. */
export class TimeBudgetExceededError extends Error {
  constructor() {
    super('The work could not be finished in time');
    this.name = 'TimeBudgetExceededError';
  }
}

const RUN = new Script('run()');

/*
 * One context for every call. Creating a context costs about 180 us on Node 20
 * and 24, reusing one about 50 us (measured 2026-11-07), and an operation's
 * expression budget is charged for that time. The context only ever holds the
 * `run` slot below; the work itself is a closure from the calling realm, so
 * nothing an evaluation touches is left in the context for the next one.
 */
const SANDBOX: { run: (() => unknown) | null } = { run: null };

// Contextifies SANDBOX in place; the returned object is SANDBOX itself.
createContext(SANDBOX);

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
  // Calls nest (a dry run's budget wraps every expression budget inside it),
  // so the slot is put back as it was rather than cleared. The outer `run()`
  // has already been called by then; restoring only keeps the slot from
  // holding a finished closure. An interrupt still unwinds through `finally`
  // here, because this frame is outside the context being interrupted.
  const previous = SANDBOX.run;

  SANDBOX.run = work;

  try {
    return RUN.runInContext(SANDBOX, { timeout: timeoutMs }) as TResult;
  } catch (error: unknown) {
    if (isScriptTimeout(error)) {
      throw new TimeBudgetExceededError();
    }

    throw error;
  } finally {
    SANDBOX.run = previous;
  }
}
