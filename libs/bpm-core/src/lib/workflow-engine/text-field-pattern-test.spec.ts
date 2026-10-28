import { compileTextFieldPattern } from '@rytass/bpm-core-shared/form';
import * as vm from 'vm';
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

  it('creates its context only when a pattern first runs', (): void => {
    const createContext = jest.spyOn(vm, 'createContext');

    try {
      const test = createTimedTextFieldPatternTest();

      expect(createContext).not.toHaveBeenCalled();
      test(compile('[0-9]+'), '42');
      test(compile('[0-9]+'), '43');
      expect(createContext).toHaveBeenCalledTimes(1);
    } finally {
      createContext.mockRestore();
    }
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
    // A clock that moves 10 ms at every reading. The run reads it right
    // before and after matching, so each run is charged 10 ms and five fit
    // the budget. Charging the whole run (about 45 µs of start-up for a
    // normal match, more than the match itself) would read it around the run
    // as well and charge 30 ms; charging nothing would never stop.
    const read = { count: 0 };
    const test = createTimedTextFieldPatternTest((): number => 10 * read.count++);
    const answers = Array.from({ length: 6 }, (): string => {
      try {
        return String(test(compile('[A-Z]+'), 'AB'));
      } catch (error) {
        return error instanceof TextFieldPatternTimeoutError ? 'timeout' : 'other';
      }
    });

    expect(TEXT_FIELD_PATTERN_TIME_BUDGET_MS).toBe(50);
    expect(answers).toEqual(['true', 'true', 'true', 'true', 'true', 'timeout']);
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
