import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from './expression-function.registry';

/**
 * The handlers on their own, with arguments as the runtime hands them over
 * (already checked JS numbers and strings). How each dialect gets values to
 * them is covered on the real engines in
 * `condition/expression-function.real-engine.spec.ts`.
 */
const call = (
  name: string,
  ...args: readonly BPMExpressionValue[]
): BPMExpressionValue => {
  const fn = BUILT_IN_EXPRESSION_FUNCTION_REGISTRY.get(name);

  if (fn === null) {
    throw new Error(`No built-in ${name}`);
  }

  return fn.handler(...args);
};

describe('built-in expression functions', (): void => {
  it('round rounds halves away from zero', (): void => {
    expect(call('round', 2.5)).toBe(3);
    expect(call('round', -2.5)).toBe(-3);
    expect(call('round', 2.4)).toBe(2);
    expect(call('round', -2.4)).toBe(-2);
    expect(call('round', 7)).toBe(7);
  });

  it('ceil, floor and abs follow Math and never return -0', (): void => {
    expect(call('ceil', 1.2)).toBe(2);
    expect(call('ceil', -1.2)).toBe(-1);
    expect(Object.is(call('ceil', -0.5), 0)).toBe(true);
    expect(call('floor', 1.8)).toBe(1);
    expect(call('floor', -1.2)).toBe(-2);
    expect(Object.is(call('round', -0.4), 0)).toBe(true);
    expect(call('abs', -3.5)).toBe(3.5);
    expect(Object.is(call('abs', -0), 0)).toBe(true);
  });

  it('min and max take exactly two numbers', (): void => {
    expect(call('min', 1, 2.5)).toBe(1);
    expect(call('max', 1, 2.5)).toBe(2.5);
    expect(call('max', -1, -2)).toBe(-1);
    expect(
      BUILT_IN_EXPRESSION_FUNCTION_REGISTRY.get('min')?.parameters,
    ).toHaveLength(2);
  });

  it('lower, upper and trim are locale independent string operations', (): void => {
    expect(call('lower', 'ÀBC İ')).toBe('àbc i̇');
    expect(call('upper', 'abc ß')).toBe('ABC SS');
    // A Turkish locale would give `İ`; the built-in never reads the locale.
    expect(call('upper', 'i')).toBe('I');
    expect(call('trim', '\t a b \n')).toBe('a b');
  });

  it('declares double results for numbers and string results for strings', (): void => {
    expect(
      BUILT_IN_EXPRESSION_FUNCTION_REGISTRY.list().map((descriptor) => [
        descriptor.name,
        descriptor.parameters.map((parameter) => parameter.type),
        descriptor.returnType,
      ]),
    ).toEqual([
      ['abs', ['double'], 'double'],
      ['ceil', ['double'], 'double'],
      ['floor', ['double'], 'double'],
      ['lower', ['string'], 'string'],
      ['max', ['double', 'double'], 'double'],
      ['min', ['double', 'double'], 'double'],
      ['round', ['double'], 'double'],
      ['trim', ['string'], 'string'],
      ['upper', ['string'], 'string'],
    ]);
  });
});
