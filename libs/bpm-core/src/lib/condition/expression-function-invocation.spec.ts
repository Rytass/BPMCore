import { Logger } from '@nestjs/common';
import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type { BPMExpressionFunction } from '../expression-function/expression-function.types';
import { ExpressionEngineFailure } from './expression-engine-failure';
import {
  createExpressionFunctionInvoker,
  runWithExpressionFunctionFrame,
} from './expression-function-invocation';

const SECRET = 'HANDLER-SECRET-77';

const hostFunction = (
  handler: (...args: readonly BPMExpressionValue[]) => unknown,
  overrides: Partial<BPMExpressionFunction> = {},
): BPMExpressionFunction => ({
  description: 'test',
  handler: handler as BPMExpressionFunction['handler'],
  label: 'test',
  name: 'test_fn_v1',
  parameters: [{ name: 'value', type: 'dyn' }],
  returnType: 'dyn',
  ...overrides,
});

const readFailureCode = (action: () => unknown): string | null => {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof ExpressionEngineFailure ? error.code : 'OTHER';
  }

  return null;
};

describe('createExpressionFunctionInvoker', (): void => {
  let warn: jest.SpyInstance;

  beforeEach((): void => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('hands the handler deep-frozen copies, so a strict-mode write throws TypeError and the source is untouched', (): void => {
    const formData = { items: [{ qty: 1 }], tags: ['a'] };
    const snapshot = structuredClone(formData);
    const caught: unknown[] = [];
    const invoke = createExpressionFunctionInvoker(
      hostFunction(
        (...args: readonly BPMExpressionValue[]): BPMExpressionValue => {
          const [value] = args as readonly {
            items: { qty: number }[];
            tags: string[];
          }[];

          try {
            value.tags.push('b');
          } catch (error: unknown) {
            caught.push(error);
            throw error;
          }

          return null;
        },
      ),
      'cel-v2',
    );

    expect(readFailureCode(() => invoke(formData))).toBe(
      'EXPRESSION_FUNCTION_FAILED',
    );
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(TypeError);
    expect(formData).toEqual(snapshot);
  });

  it('freezes nested arguments', (): void => {
    const seen: unknown[] = [];
    const invoke = createExpressionFunctionInvoker(
      hostFunction(
        (...args: readonly BPMExpressionValue[]): BPMExpressionValue => {
          seen.push(args[0]);

          return true;
        },
      ),
      'cel-legacy',
    );

    invoke({ nested: { list: [1, { deep: 'x' }] } });

    const [value] = seen as readonly {
      readonly nested: { readonly list: readonly [number, object] };
    }[];

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.nested.list)).toBe(true);
    expect(Object.isFrozen(value.nested.list[1])).toBe(true);
  });

  it('turns a cel-v2 int argument into a JS number', (): void => {
    const seen: unknown[] = [];
    const invoke = createExpressionFunctionInvoker(
      hostFunction(
        (...args: readonly BPMExpressionValue[]): BPMExpressionValue => {
          seen.push(...args);

          return 1;
        },
        { parameters: [{ name: 'value', type: 'int' }] },
      ),
      'cel-v2',
    );

    invoke(BigInt(42));

    expect(seen).toEqual([42]);
  });

  it.each([
    ['a string for a double', 'double', 'x'],
    ['a fraction for an int', 'int', 1.5],
    ['a number for a string', 'string', 1],
    ['a map for a list', 'list', { a: 1 }],
    ['a list for a map', 'map', [1]],
    ['a string for null', 'null', 'x'],
    ['a number for a bool', 'bool', 0],
  ] as const)(
    'refuses %s as EXPRESSION_TYPE_ERROR without calling the handler',
    (
      _case: string,
      type: BPMExpressionFunction['returnType'],
      value: unknown,
    ): void => {
      const handler = jest.fn((): BPMExpressionValue => null);
      const invoke = createExpressionFunctionInvoker(
        hostFunction(handler, { parameters: [{ name: 'value', type }] }),
        'cel-legacy',
      );

      expect(readFailureCode(() => invoke(value))).toBe(
        'EXPRESSION_TYPE_ERROR',
      );
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-JSON argument and the wrong number of arguments', (): void => {
    const handler = jest.fn((): BPMExpressionValue => null);
    const invoke = createExpressionFunctionInvoker(
      hostFunction(handler),
      'cel-legacy',
    );

    expect(readFailureCode(() => invoke(new Uint8Array([1])))).toBe(
      'EXPRESSION_TYPE_ERROR',
    );
    expect(readFailureCode(() => invoke(1, 2))).toBe('EXPRESSION_TYPE_ERROR');
    expect(readFailureCode(() => invoke())).toBe('EXPRESSION_TYPE_ERROR');
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps a throwing handler to EXPRESSION_FUNCTION_FAILED and logs only the name and code', (): void => {
    const invoke = createExpressionFunctionInvoker(
      hostFunction((): BPMExpressionValue => {
        throw new Error(SECRET);
      }),
      'cel-v2',
    );
    let thrown: unknown;

    try {
      invoke(1);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ExpressionEngineFailure);
    expect(String((thrown as Error).message)).not.toContain(SECRET);
    expect(warn).toHaveBeenCalledWith(
      'function=test_fn_v1 code=EXPRESSION_FUNCTION_FAILED reason=threw',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });

  it('does not let a handler pick its own error code', async (): Promise<void> => {
    const { ExpressionRuntimeError } = await import('./expression-errors');
    const invoke = createExpressionFunctionInvoker(
      hostFunction((): BPMExpressionValue => {
        throw new ExpressionRuntimeError('EXPRESSION_MISSING_KEY', SECRET);
      }),
      'cel-v2',
    );

    expect(readFailureCode(() => invoke(1))).toBe('EXPRESSION_FUNCTION_FAILED');
  });

  it('fails a thenable result and leaves no unhandled rejection behind', async (): Promise<void> => {
    const unhandled = jest.fn();

    process.on('unhandledRejection', unhandled);

    try {
      const invoke = createExpressionFunctionInvoker(
        hostFunction(() => Promise.reject(new Error(SECRET))),
        'cel-v2',
      );

      expect(readFailureCode(() => invoke(1))).toBe(
        'EXPRESSION_FUNCTION_FAILED',
      );
      expect(warn).toHaveBeenCalledWith(
        'function=test_fn_v1 code=EXPRESSION_FUNCTION_FAILED reason=thenable',
      );

      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('fails a result whose then getter throws', (): void => {
    const invoke = createExpressionFunctionInvoker(
      hostFunction(() =>
        Object.defineProperty({}, 'then', {
          get: (): never => {
            throw new Error(SECRET);
          },
        }),
      ),
      'cel-legacy',
    );

    expect(readFailureCode(() => invoke(1))).toBe('EXPRESSION_FUNCTION_FAILED');
  });

  it.each([
    ['undefined', undefined],
    ['a function', (): number => 1],
    ['NaN', Number.NaN],
    ['a class instance', new Date(0)],
    ['a map with a forbidden key', JSON.parse('{"__proto__": 1}') as unknown],
  ])('fails a result that is %s', (_case: string, result: unknown): void => {
    const invoke = createExpressionFunctionInvoker(
      hostFunction(() => result),
      'cel-legacy',
    );

    expect(readFailureCode(() => invoke(1))).toBe('EXPRESSION_FUNCTION_FAILED');
  });

  it('fails a result that does not match the declared return type', (): void => {
    const invoke = createExpressionFunctionInvoker(
      hostFunction(() => 'x', { returnType: 'double' }),
      'cel-legacy',
    );
    const invokeInt = createExpressionFunctionInvoker(
      hostFunction(() => 1.5, { returnType: 'int' }),
      'cel-legacy',
    );

    expect(readFailureCode(() => invoke(1))).toBe('EXPRESSION_FUNCTION_FAILED');
    expect(readFailureCode(() => invokeInt(1))).toBe(
      'EXPRESSION_FUNCTION_FAILED',
    );
    expect(warn).toHaveBeenCalledWith(
      'function=test_fn_v1 code=EXPRESSION_FUNCTION_FAILED reason=return-type',
    );
  });

  it('returns a declared int as a bigint to cel-v2 and as a number to cel-legacy', (): void => {
    const fn = hostFunction(() => 5, { returnType: 'int' });

    expect(createExpressionFunctionInvoker(fn, 'cel-v2')(1)).toBe(BigInt(5));
    expect(createExpressionFunctionInvoker(fn, 'cel-legacy')(1)).toBe(5);
  });

  it('returns a fresh frozen copy of the result', (): void => {
    const result = { a: [1] };
    const returned = createExpressionFunctionInvoker(
      hostFunction(() => result),
      'cel-legacy',
    )(1) as { readonly a: readonly number[] };

    expect(returned).toEqual(result);
    expect(returned).not.toBe(result);
    expect(Object.isFrozen(returned.a)).toBe(true);
  });
});

describe('runWithExpressionFunctionFrame', (): void => {
  beforeEach((): void => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  const failing = createExpressionFunctionInvoker(
    hostFunction((): BPMExpressionValue => {
      throw new Error(SECRET);
    }),
    'cel-v2',
  );

  it('fails the evaluation when a function failed even if the engine swallowed the error', (): void => {
    expect(
      readFailureCode(() =>
        runWithExpressionFunctionFrame((): boolean => {
          try {
            failing(1);
          } catch {
            // What cel-v2's `||` does with an error when the other side is true.
          }

          return true;
        }),
      ),
    ).toBe('EXPRESSION_FUNCTION_FAILED');
  });

  it('reports EXPRESSION_FUNCTION_FAILED over a later engine error', (): void => {
    expect(
      readFailureCode(() =>
        runWithExpressionFunctionFrame((): never => {
          try {
            failing(1);
          } catch {
            // swallowed
          }

          throw new ExpressionEngineFailure('EXPRESSION_MISSING_KEY');
        }),
      ),
    ).toBe('EXPRESSION_FUNCTION_FAILED');
  });

  it('starts every evaluation clean', (): void => {
    expect(() =>
      runWithExpressionFunctionFrame((): never => {
        throw new Error('first');
      }),
    ).toThrow('first');
    expect(runWithExpressionFunctionFrame((): number => 1)).toBe(1);
  });
});
