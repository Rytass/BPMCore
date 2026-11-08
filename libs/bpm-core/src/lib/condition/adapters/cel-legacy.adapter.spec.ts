import { parseCelLegacy } from './cel-legacy.adapter';

// cel-js is replaced so the parser can be made to throw, which the real engine
// does on very deep nesting (a stack overflow, reported as a bare RangeError).
jest.mock('cel-js', (): Record<string, unknown> => ({
  evaluate: (): unknown => true,
  parse: (expression: string): unknown => {
    if (expression.startsWith('deep')) {
      throw new RangeError('Maximum call stack size exceeded');
    }

    return { cst: { expression }, isSuccess: true };
  },
}));

describe('parseCelLegacy', (): void => {
  it('returns a handle for an expression the engine accepts', (): void => {
    expect(parseCelLegacy('form.amount > 1')).not.toBeNull();
  });

  it('maps a parser that throws instead of reporting failure to a syntax refusal', (): void => {
    expect(parseCelLegacy('deep nesting')).toBeNull();
  });
});
