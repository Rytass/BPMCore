import { runWithinTimeBudget, TimeBudgetExceededError } from './time-budget';

describe('runWithinTimeBudget', (): void => {
  it('returns what the work returns', (): void => {
    const value = { answer: 42 };

    expect(runWithinTimeBudget(() => value, 1000)).toBe(value);
  });

  it('passes on what the work throws', (): void => {
    const failure = new Error('failed');

    expect(() =>
      runWithinTimeBudget(() => {
        throw failure;
      }, 1000),
    ).toThrow(failure);
  });

  it('interrupts host code, and no catch inside can swallow that', (): void => {
    const spin = (): void => {
      try {
        for (;;) {
          // Spins until interrupted.
        }
      } catch {
        // An interrupt must not end here.
      }
    };

    expect(() => runWithinTimeBudget(spin, 20)).toThrow(
      TimeBudgetExceededError,
    );
  });

  it('can run again after an interrupt', (): void => {
    expect(() =>
      runWithinTimeBudget(() => {
        for (;;) {
          // Spins until interrupted.
        }
      }, 20),
    ).toThrow(TimeBudgetExceededError);
    expect(runWithinTimeBudget(() => 'next', 1000)).toBe('next');
  });

  it('lets an outer budget interrupt work running under an inner one', (): void => {
    // Had the inner budget fired first, its caller would catch it and the
    // outer call would return 'swallowed' instead of throwing.
    expect(() =>
      runWithinTimeBudget((): string => {
        try {
          return runWithinTimeBudget((): string => {
            for (;;) {
              // Spins until interrupted.
            }
          }, 1000);
        } catch {
          // The outer interrupt must not be caught by the inner caller.
          return 'swallowed';
        }
      }, 30),
    ).toThrow(TimeBudgetExceededError);
    expect(runWithinTimeBudget(() => 'next', 1000)).toBe('next');
  });

  it('keeps the outer work running after an inner interrupt', (): void => {
    const outcome = runWithinTimeBudget((): string => {
      const inner = ((): string => {
        try {
          return runWithinTimeBudget((): string => {
            for (;;) {
              // Spins until interrupted.
            }
          }, 20);
        } catch (error: unknown) {
          return error instanceof TimeBudgetExceededError ? 'inner' : 'other';
        }
      })();

      return `${inner}|${runWithinTimeBudget(() => 'again', 1000)}`;
    }, 1000);

    expect(outcome).toBe('inner|again');
  });
});
