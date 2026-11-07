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
});
