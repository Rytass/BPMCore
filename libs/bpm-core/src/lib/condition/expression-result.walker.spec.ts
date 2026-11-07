import { ExpressionRuntimeError } from './expression-errors';
import {
  DEFAULT_EXPRESSION_RESULT_LIMITS,
  normalizeExpressionResult,
} from './expression-result.walker';

const expectInvalidResult = (action: () => unknown): void => {
  let thrown: unknown = null;

  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ExpressionRuntimeError);
  expect((thrown as ExpressionRuntimeError).code).toBe(
    'EXPRESSION_INVALID_RESULT',
  );
};

describe('normalizeExpressionResult', (): void => {
  it('accepts JSON primitives and returns them unchanged', (): void => {
    expect(normalizeExpressionResult(null, 'label')).toBeNull();
    expect(normalizeExpressionResult(true, 'label')).toBe(true);
    expect(normalizeExpressionResult(3.5, 'label')).toBe(3.5);
    expect(normalizeExpressionResult('text', 'label')).toBe('text');
  });

  it('returns a deep-frozen copy of arrays and plain objects', (): void => {
    const input = { list: [1, { deep: 'x' }] };

    const result = normalizeExpressionResult(input, 'label');

    expect(result).toEqual({ list: [1, { deep: 'x' }] });
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(Reflect.get(result as object, 'list'))).toBe(true);
  });

  it('turns a safe-range bigint into a number', (): void => {
    expect(normalizeExpressionResult(BigInt(42), 'label')).toBe(42);
  });

  it('refuses a bigint outside the safe integer range', (): void => {
    expectInvalidResult(() =>
      normalizeExpressionResult(
        BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
        'label',
      ),
    );
  });

  it('accepts a number at the edge of the safe integer range', (): void => {
    expect(normalizeExpressionResult(Number.MAX_SAFE_INTEGER, 'label')).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(normalizeExpressionResult(-Number.MAX_SAFE_INTEGER, 'label')).toBe(
      -Number.MAX_SAFE_INTEGER,
    );
  });

  it('refuses a number outside the safe integer range, which cel-legacy returns as a number', (): void => {
    // 9007199254740993 is rounded to 2^53 by the engine before it reaches us.
    expectInvalidResult(() =>
      normalizeExpressionResult(Number.MAX_SAFE_INTEGER + 2, 'label'),
    );
    expectInvalidResult(() => normalizeExpressionResult(2 ** 53, 'label'));
    expectInvalidResult(() => normalizeExpressionResult(-(2 ** 53), 'label'));
  });

  it('refuses NaN and Infinity', (): void => {
    expectInvalidResult(() => normalizeExpressionResult(Number.NaN, 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult(Number.POSITIVE_INFINITY, 'label'),
    );
  });

  it('refuses undefined, functions, promises and class instances', (): void => {
    class Money {
      readonly amount = 1;
    }

    expectInvalidResult(() => normalizeExpressionResult(undefined, 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult((): number => 1, 'label'),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult(Promise.resolve(1), 'label'),
    );
    expectInvalidResult(() => normalizeExpressionResult(new Money(), 'label'));
  });

  it('refuses Object.prototype and Array.prototype themselves', (): void => {
    // Object.prototype has a null prototype, so a prototype check alone would
    // accept it as an empty map; Array.isArray(Array.prototype) is true.
    expectInvalidResult(() =>
      normalizeExpressionResult(Object.prototype, 'label'),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult({ nested: Object.prototype }, 'label'),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult(Array.prototype, 'label'),
    );
  });

  it('accepts a map whose prototype is null', (): void => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, {
      a: 1,
    });

    expect(normalizeExpressionResult(bare, 'label')).toEqual({ a: 1 });
  });

  it('refuses an object whose prototype is neither Object.prototype nor null', (): void => {
    const inherited = Object.create({ inherited: 1 }) as Record<
      string,
      unknown
    >;
    const fromPrototype = Object.create(Object.prototype, {
      own: { enumerable: true, value: 1 },
    }) as Record<string, unknown>;

    expect(normalizeExpressionResult(fromPrototype, 'label')).toEqual({
      own: 1,
    });
    expectInvalidResult(() => normalizeExpressionResult(inherited, 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult(Object.create(Array.prototype), 'label'),
    );
    expectInvalidResult(() => normalizeExpressionResult(new Date(0), 'label'));
    expectInvalidResult(() => normalizeExpressionResult(new Map(), 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult(Object(1) as unknown, 'label'),
    );
  });

  it('refuses an array whose prototype was replaced or that subclasses Array', (): void => {
    class Tagged extends Array<number> {}

    expectInvalidResult(() =>
      normalizeExpressionResult(
        Object.setPrototypeOf([1], Object.prototype),
        'label',
      ),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult(Tagged.from([1]), 'label'),
    );
  });

  it('refuses an accessor property instead of calling the getter', (): void => {
    const getter = jest.fn((): number => 1);
    const withGetter = Object.defineProperty({}, 'a', {
      enumerable: true,
      get: getter,
    });
    const listWithGetter = Object.defineProperty([0], 0, {
      enumerable: true,
      get: getter,
    });

    expectInvalidResult(() => normalizeExpressionResult(withGetter, 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult(listWithGetter, 'label'),
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('refuses a sparse array and a map with a symbol key', (): void => {
    // eslint-disable-next-line no-sparse-arrays
    expectInvalidResult(() => normalizeExpressionResult([1, , 2], 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult({ [Symbol('tag')]: 1, a: 1 }, 'label'),
    );
  });

  it('refuses the constructor and prototype keys and __proto__ as own keys', (): void => {
    expectInvalidResult(() =>
      normalizeExpressionResult(JSON.parse('{"__proto__":{"x":1}}'), 'label'),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult({ constructor: 'x' }, 'label'),
    );
    expectInvalidResult(() =>
      normalizeExpressionResult({ nested: { prototype: 'x' } }, 'label'),
    );
  });

  it('refuses nesting deeper than the depth limit and accepts the limit itself', (): void => {
    const buildNested = (levels: number): unknown => {
      let value: unknown = 'leaf';

      for (let index = 0; index < levels; index += 1) {
        value = [value];
      }

      return value;
    };

    expect(() =>
      normalizeExpressionResult(
        buildNested(DEFAULT_EXPRESSION_RESULT_LIMITS.maxDepth),
        'label',
      ),
    ).not.toThrow();
    expectInvalidResult(() =>
      normalizeExpressionResult(
        buildNested(DEFAULT_EXPRESSION_RESULT_LIMITS.maxDepth + 1),
        'label',
      ),
    );
  });

  it('refuses a value with more nodes than the node limit', (): void => {
    const wide = Array.from({ length: 10_001 }, (): number => 0);

    expectInvalidResult(() => normalizeExpressionResult(wide, 'label'));
  });

  it('refuses a value whose estimated size exceeds the byte limit', (): void => {
    const big = 'x'.repeat(DEFAULT_EXPRESSION_RESULT_LIMITS.maxBytes + 1);

    expectInvalidResult(() => normalizeExpressionResult(big, 'label'));
    expectInvalidResult(() =>
      normalizeExpressionResult(
        Array.from({ length: 3_000 }, (): number => 1),
        'label',
      ),
    );
  });
});
