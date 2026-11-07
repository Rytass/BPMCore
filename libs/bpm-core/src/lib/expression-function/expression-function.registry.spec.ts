import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  type BPMExpressionValue,
} from '@rytass/bpm-core-shared';
import {
  BUILT_IN_EXPRESSION_FUNCTION_REGISTRY,
  EmptyBPMExpressionFunctionRegistry,
  StaticBPMExpressionFunctionRegistry,
  validateExpressionFunctions,
} from './expression-function.registry';
import type { BPMExpressionFunction } from './expression-function.types';

const hostFunction = (
  overrides: Partial<Record<keyof BPMExpressionFunction, unknown>> = {},
): BPMExpressionFunction =>
  ({
    description: 'Cost band of an amount',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      typeof args[0] === 'number' && args[0] > 100 ? 'HIGH' : 'LOW',
    label: '金額級距',
    name: 'erp_costBand_v1',
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
    ...overrides,
  }) as BPMExpressionFunction;

const readRefusal = (functions: readonly unknown[]): string => {
  try {
    validateExpressionFunctions(functions);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'not an Error';
  }

  throw new Error('Expected the registration to be refused');
};

describe('validateExpressionFunctions', (): void => {
  it('accepts a well-formed host function and returns a frozen copy', (): void => {
    const [checked] = validateExpressionFunctions([hostFunction()]);

    expect(checked.name).toBe('erp_costBand_v1');
    expect(Object.isFrozen(checked)).toBe(true);
    expect(Object.isFrozen(checked.parameters)).toBe(true);
    expect(Object.isFrozen(checked.parameters[0])).toBe(true);
  });

  it.each([
    ['without a version suffix', 'erp_costBand'],
    ['with a dotted namespace', 'erp.costBand_v1'],
    ['starting with an upper-case letter', 'Erp_costBand_v1'],
    ['with a non-numeric version', 'erp_costBand_vX'],
    ['that is empty', ''],
  ])('refuses a name %s', (_case: string, name: string): void => {
    expect(readRefusal([hostFunction({ name })])).toContain(
      `"${name}" has an invalid name`,
    );
  });

  it.each(BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES)(
    'refuses the built-in name %s',
    (name: string): void => {
      expect(readRefusal([hostFunction({ name })])).toContain(
        `"${name}" uses the name of a built-in function`,
      );
    },
  );

  it.each([['nullable_v1'], ['trueUp_v1'], ['falsey_v1'], ['null_x_v1']])(
    'refuses %s, whose prefix cel-legacy lexes as a keyword',
    (name: string): void => {
      expect(readRefusal([hostFunction({ name })])).toContain(
        `"${name}" starts with "true", "false" or "null"`,
      );
    },
  );

  it.each([['inRange_v1'], ['notNull_v1'], ['isTrue_v1']])(
    'accepts %s: only a leading keyword is a problem',
    (name: string): void => {
      expect(
        validateExpressionFunctions([hostFunction({ name })])[0].name,
      ).toBe(name);
    },
  );

  it('refuses a name registered twice', (): void => {
    expect(readRefusal([hostFunction(), hostFunction()])).toContain(
      '"erp_costBand_v1" is registered more than once',
    );
  });

  it.each([
    [
      'an async function',
      async (): Promise<BPMExpressionValue> => Promise.resolve('LOW'),
    ],
    [
      'a generator function',
      function* generator(): Generator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
    [
      'an async generator function',
      async function* asyncGenerator(): AsyncGenerator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
  ])('refuses %s as handler', (_case: string, handler: unknown): void => {
    expect(readRefusal([hostFunction({ handler })])).toContain(
      '"erp_costBand_v1" has an async or generator handler',
    );
  });

  // An own `Symbol.toStringTag` changes what `Object.prototype.toString`
  // reports, but not the prototype chain the check reads (2026-11-07).
  it.each([
    [
      'an async function',
      async (): Promise<BPMExpressionValue> => Promise.resolve('LOW'),
    ],
    [
      'a generator function',
      function* generator(): Generator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
    [
      'an async generator function',
      async function* asyncGenerator(): AsyncGenerator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
  ])(
    'refuses %s disguised by an own Symbol.toStringTag',
    (_case: string, handler: object): void => {
      const disguised = Object.defineProperty(handler, Symbol.toStringTag, {
        value: 'Function',
      });

      expect(Object.prototype.toString.call(disguised)).toBe(
        '[object Function]',
      );
      expect(readRefusal([hostFunction({ handler: disguised })])).toContain(
        '"erp_costBand_v1" has an async or generator handler',
      );
    },
  );

  // Integration review (2026-11-07): moving the prototype to
  // `Function.prototype` as well as setting the tag used to pass both checks.
  // The engine's own function kind (`util.types`) cannot be changed that way.
  it.each([
    [
      'an async function',
      async (): Promise<BPMExpressionValue> => Promise.resolve('LOW'),
    ],
    [
      'a generator function',
      function* generator(): Generator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
    [
      'an async generator function',
      async function* asyncGenerator(): AsyncGenerator<BPMExpressionValue> {
        yield 'LOW';
      },
    ],
  ])(
    'refuses %s re-parented to Function.prototype and re-tagged',
    (_case: string, handler: object): void => {
      const disguised = Object.defineProperty(
        Object.setPrototypeOf(handler, Function.prototype) as object,
        Symbol.toStringTag,
        { value: 'Function' },
      );

      expect(Object.getPrototypeOf(disguised)).toBe(Function.prototype);
      expect(Object.prototype.toString.call(disguised)).toBe(
        '[object Function]',
      );
      expect(readRefusal([hostFunction({ handler: disguised })])).toContain(
        '"erp_costBand_v1" has an async or generator handler',
      );
    },
  );

  it('refuses a bound async function', (): void => {
    const bound = (async (): Promise<BPMExpressionValue> => 'LOW').bind(
      undefined,
    );

    expect(readRefusal([hostFunction({ handler: bound })])).toContain(
      'has an async or generator handler',
    );
  });

  it('refuses a missing handler', (): void => {
    expect(
      readRefusal([hostFunction({ handler: 'not a function' })]),
    ).toContain('has no handler function');
  });

  it.each([['date'], ['list<string>'], ['optional(string)'], ['']])(
    'refuses the parameter type %p',
    (type: string): void => {
      expect(
        readRefusal([hostFunction({ parameters: [{ name: 'amount', type }] })]),
      ).toContain('declares parameter "amount" with an unsupported type');
    },
  );

  it.each([['date'], ['uint'], ['bytes']])(
    'refuses the return type %p',
    (returnType: string): void => {
      expect(readRefusal([hostFunction({ returnType })])).toContain(
        'declares an unsupported return type',
      );
    },
  );

  it('refuses a parameter without a valid name and duplicated parameter names', (): void => {
    expect(
      readRefusal([
        hostFunction({ parameters: [{ name: '1st', type: 'double' }] }),
      ]),
    ).toContain('has parameter 0 without a valid name');
    expect(
      readRefusal([
        hostFunction({
          parameters: [
            { name: 'a', type: 'double' },
            { name: 'a', type: 'string' },
          ],
        }),
      ]),
    ).toContain('declares the same parameter name twice');
  });

  it('refuses a missing parameter list, label or description', (): void => {
    expect(readRefusal([hostFunction({ parameters: undefined })])).toContain(
      'has no parameter list',
    );
    expect(readRefusal([hostFunction({ label: '  ' })])).toContain(
      'has no label',
    );
    expect(readRefusal([hostFunction({ description: 1 })])).toContain(
      'has no description',
    );
  });

  it('names the entry by position when it has no name', (): void => {
    expect(readRefusal([null])).toContain('"#0" is not an object');
  });
});

describe('StaticBPMExpressionFunctionRegistry', (): void => {
  it('lists the nine built-ins first, then the host functions', (): void => {
    const registry = new StaticBPMExpressionFunctionRegistry([hostFunction()]);

    expect(registry.list().map((descriptor) => descriptor.name)).toEqual([
      ...BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
      'erp_costBand_v1',
    ]);
    expect(registry.list().map((descriptor) => descriptor.builtIn)).toEqual([
      ...BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES.map(() => true),
      false,
    ]);
    // The descriptor carries no handler: it is what the browser may see.
    expect(registry.list().at(-1)).not.toHaveProperty('handler');
  });

  it('returns a function by own name only', (): void => {
    const registry = new StaticBPMExpressionFunctionRegistry([hostFunction()]);

    expect(registry.get('erp_costBand_v1')?.label).toBe('金額級距');
    expect(registry.get('round')?.name).toBe('round');
    expect(registry.get('erp_costBand_v2')).toBeNull();
    expect(registry.get('constructor')).toBeNull();
    expect(registry.get('toString')).toBeNull();
  });

  it('reports the unavailable names in first-seen order without duplicates', (): void => {
    const registry = new StaticBPMExpressionFunctionRegistry([hostFunction()]);

    expect(
      registry.assertPublishable([
        'gone_v1',
        'round',
        'erp_costBand_v1',
        'other_v2',
        'gone_v1',
      ]),
    ).toEqual(['gone_v1', 'other_v2']);
    expect(registry.assertPublishable(['round', 'erp_costBand_v1'])).toEqual(
      [],
    );
  });

  it('validates at construction', (): void => {
    expect(
      () =>
        new StaticBPMExpressionFunctionRegistry([
          hostFunction({ name: 'bad' }),
        ]),
    ).toThrow('"bad" has an invalid name');
  });
});

describe('EmptyBPMExpressionFunctionRegistry', (): void => {
  it('has only the built-ins', (): void => {
    const registry = new EmptyBPMExpressionFunctionRegistry();

    expect(registry.list().every((descriptor) => descriptor.builtIn)).toBe(
      true,
    );
    expect(registry.list()).toHaveLength(9);
    expect(registry.assertPublishable(['erp_costBand_v1'])).toEqual([
      'erp_costBand_v1',
    ]);
    expect(BUILT_IN_EXPRESSION_FUNCTION_REGISTRY.list()).toEqual(
      registry.list(),
    );
  });
});
