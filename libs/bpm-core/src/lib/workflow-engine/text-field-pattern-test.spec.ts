import { compileTextFieldPattern } from '@rytass/bpm-core-shared/form';
import {
  createTimedTextFieldPatternTest,
  TEXT_FIELD_PATTERN_TIME_BUDGET_MS,
  TextFieldPatternTimeoutError,
} from './text-field-pattern-test';

const compile = (pattern: string): RegExp => {
  const compiled = compileTextFieldPattern(pattern);

  if (!compiled) {
    throw new Error(`${pattern} does not compile`);
  }

  return compiled;
};

// Unbounded, one run of this on 500 characters takes tens of seconds.
const POLYNOMIAL = '\\w*\\w*\\w*\\w*!';

describe('createTimedTextFieldPatternTest', () => {
  it('answers like RegExp#test for a pattern that finishes', (): void => {
    const test = createTimedTextFieldPatternTest();

    expect(test(compile('[A-Z]{2}[0-9]{8}'), 'AB12345678')).toBe(true);
    expect(test(compile('[A-Z]{2}[0-9]{8}'), 'ab12345678')).toBe(false);
  });

  it('interrupts a run that outlasts the budget and throws', (): void => {
    const test = createTimedTextFieldPatternTest();
    const startedAt = Date.now();

    expect(() => test(compile(POLYNOMIAL), 'a'.repeat(500))).toThrow(
      TextFieldPatternTimeoutError,
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('shares one budget across the runs of a pass', (): void => {
    const test = createTimedTextFieldPatternTest();
    const pattern = compile(POLYNOMIAL);
    // Each run finishes well inside the budget on its own; together they do not.
    const value = 'a'.repeat(110);
    const startedAt = Date.now();
    const answers = Array.from({ length: 100 }, (): string => {
      try {
        return String(test(pattern, value));
      } catch (error) {
        return error instanceof TextFieldPatternTimeoutError ? 'timeout' : 'other';
      }
    });

    expect(answers).toContain('timeout');
    expect(answers.slice(answers.indexOf('timeout'))).toEqual(
      answers.slice(answers.indexOf('timeout')).map(() => 'timeout'),
    );
    expect(Date.now() - startedAt).toBeLessThan(
      TEXT_FIELD_PATTERN_TIME_BUDGET_MS * 4,
    );
  });

  it('throws without running once the budget is spent, and a new pass starts afresh', (): void => {
    const clock = { now: 0 };
    const test = createTimedTextFieldPatternTest(() => clock.now);

    expect(test(compile('[A-Z]+'), 'AB')).toBe(true);
    clock.now = TEXT_FIELD_PATTERN_TIME_BUDGET_MS;
    expect(() => test(compile('[A-Z]+'), 'AB')).toThrow(
      TextFieldPatternTimeoutError,
    );
    expect(createTimedTextFieldPatternTest()(compile('[A-Z]+'), 'AB')).toBe(true);
  });
});
