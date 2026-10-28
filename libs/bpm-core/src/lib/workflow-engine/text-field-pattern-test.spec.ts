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

  it('charges only the time spent matching, not the cost of starting a run', (): void => {
    // Starting a timed run takes about 50 µs; charged, 5,000 fast runs would
    // spend the budget several times over.
    const test = createTimedTextFieldPatternTest();
    const pattern = compile('[A-Z]{2}[0-9]{8}');
    const answers = Array.from({ length: 5000 }, (): boolean =>
      test(pattern, 'AB12345678'),
    );

    expect(answers.every((answer) => answer)).toBe(true);
  });

  it('throws without running once the budget is spent, and a new pass starts afresh', (): void => {
    // The run reads the clock before and after matching: this one is charged
    // the whole budget.
    const readings = [0, TEXT_FIELD_PATTERN_TIME_BUDGET_MS];
    const read = { count: 0 };
    const test = createTimedTextFieldPatternTest(
      (): number => readings[Math.min(read.count++, readings.length - 1)],
    );

    expect(test(compile('[A-Z]+'), 'AB')).toBe(true);

    const readsBefore = read.count;

    expect(() => test(compile('[A-Z]+'), 'AB')).toThrow(
      TextFieldPatternTimeoutError,
    );
    expect(read.count).toBe(readsBefore);
    expect(createTimedTextFieldPatternTest()(compile('[A-Z]+'), 'AB')).toBe(true);
  });

  it('lets an error other than a timeout through, and keeps the budget', (): void => {
    const test = createTimedTextFieldPatternTest();

    expect(() =>
      test(compile('[A-Z]+'), Symbol('not text') as unknown as string),
    ).toThrow('Symbol');
    expect(test(compile('[A-Z]+'), 'AB')).toBe(true);
  });
});
