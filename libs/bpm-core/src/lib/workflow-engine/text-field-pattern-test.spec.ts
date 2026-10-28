import { compileTextFieldPattern } from '@rytass/bpm-core-shared/form';
import { createTimedTextFieldPatternTest } from './text-field-pattern-test';

const compile = (pattern: string): RegExp => {
  const compiled = compileTextFieldPattern(pattern);

  if (!compiled) {
    throw new Error(`${pattern} does not compile`);
  }

  return compiled;
};

describe('createTimedTextFieldPatternTest', () => {
  it('answers like RegExp#test for a pattern that finishes', (): void => {
    const test = createTimedTextFieldPatternTest();

    expect(test(compile('[A-Z]{2}[0-9]{8}'), 'AB12345678')).toBe(true);
    expect(test(compile('[A-Z]{2}[0-9]{8}'), 'ab12345678')).toBe(false);
  });

  it('gives up on a pattern that backtracks and reports no match', (): void => {
    const test = createTimedTextFieldPatternTest();
    const startedAt = Date.now();

    // Unbounded, this run takes tens of seconds.
    expect(test(compile('\\w*\\w*\\w*\\w*!'), 'a'.repeat(500))).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('fails the rest of the pass without running once a run is interrupted', (): void => {
    const test = createTimedTextFieldPatternTest();
    const stalling = compile('\\w*\\w*\\w*\\w*!');
    const startedAt = Date.now();

    expect(test(stalling, 'a'.repeat(500))).toBe(false);
    Array.from({ length: 100 }).forEach((): void => {
      expect(test(stalling, 'a'.repeat(500))).toBe(false);
    });
    expect(test(compile('[A-Z]+'), 'AB')).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    // A new pass starts afresh.
    expect(createTimedTextFieldPatternTest()(compile('[A-Z]+'), 'AB')).toBe(true);
  });
});
