import { Logger } from '@nestjs/common';
import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  type BPMExpressionFunctionDescriptor,
  type BPMExpressionValue,
} from '@rytass/bpm-core-shared';
import type { Environment, EnvironmentOptions } from '@marcbachmann/cel-js';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type {
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { loadCelV2Environment, parseCelV2 } from './adapters/cel-v2.adapter';
import { ConditionService } from './condition.service';
import { createExpressionBudget } from './expression-budget';
import type { ExpressionDialect } from './expression-dialect';
import { ExpressionRuntimeError } from './expression-errors';
import { ExpressionRuntime } from './expression-runtime';

/**
 * Expression functions (ADR 22 §3.5, docs/24 §2.6) against the installed
 * engines: `cel-js` 0.8.2 (cel-legacy) and `@marcbachmann/cel-js` 8.0.0
 * (cel-v2). Runs in jest.real-engine.config.cts; the jest shim cannot call
 * functions at all.
 */

const SECRET = 'HANDLER-SECRET-91';
const DIALECTS: readonly ExpressionDialect[] = ['cel-legacy', 'cel-v2'];

const hostFunction = (
  name: string,
  handler: (...args: readonly BPMExpressionValue[]) => unknown,
  overrides: Partial<BPMExpressionFunction> = {},
): BPMExpressionFunction => ({
  description: name,
  handler: handler as BPMExpressionFunction['handler'],
  label: name,
  name,
  parameters: [{ name: 'value', type: 'dyn' }],
  returnType: 'dyn',
  ...overrides,
});

const busyWait = (ms: number): void => {
  const until = performance.now() + ms;

  while (performance.now() < until) {
    // Spin: a handler that does real CPU work for `ms`.
  }
};

// What the mutating handler caught before rethrowing it.
const caughtByMutatingHandler: unknown[] = [];
// Every call of a `then` a handler's result carried.
const thenCalls: string[] = [];

const costBand = hostFunction(
  'erp_costBand_v1',
  (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
    (args[0] as number) < 50_000 ? 'LOW' : 'HIGH',
  {
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
  },
);

const HOST_FUNCTIONS: readonly BPMExpressionFunction[] = [
  costBand,
  hostFunction(
    'count_v1',
    (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      (args[0] as readonly BPMExpressionValue[]).length,
    { parameters: [{ name: 'items', type: 'list' }], returnType: 'int' },
  ),
  hostFunction('mutates_v1', (...args: readonly BPMExpressionValue[]) => {
    const [items] = args as readonly BPMExpressionValue[][];

    try {
      items.push('injected');
    } catch (error: unknown) {
      caughtByMutatingHandler.push(error);
      throw error;
    }

    return true;
  }),
  hostFunction('throws_v1', (): BPMExpressionValue => {
    throw new Error(SECRET);
  }),
  hostFunction('async_v1', () => Promise.reject(new Error(SECRET))),
  hostFunction('foreignThen_v1', () => ({
    then: (): void => {
      thenCalls.push('foreign');
    },
  })),
  hostFunction('ownThen_v1', () =>
    Object.assign(Promise.reject(new Error(SECRET)), {
      then: (): void => {
        thenCalls.push('own');
      },
    }),
  ),
  hostFunction('wrongType_v1', (): BPMExpressionValue => 'x', {
    returnType: 'bool',
  }),
  hostFunction('slow_v1', (...args: readonly BPMExpressionValue[]) => {
    busyWait(args[0] as number);

    return true;
  }),
];

const registry = new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS);
// The same host after `erp_costBand_v1` was withdrawn.
const withdrawnRegistry = new StaticBPMExpressionFunctionRegistry(
  HOST_FUNCTIONS.filter((fn) => fn.name !== 'erp_costBand_v1'),
);

const captureRuntimeError = (action: () => unknown): ExpressionRuntimeError => {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ExpressionRuntimeError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected an ExpressionRuntimeError to be thrown');
};

const evaluateWith =
  (runtime: ExpressionRuntime) =>
  (
    expression: string,
    form: Readonly<Record<string, unknown>>,
    dialect: ExpressionDialect,
  ): unknown =>
    runtime.evaluate({
      budget: createExpressionBudget(),
      dialect,
      expression,
      label: 'entry',
      roots: { form },
    });

const builtIns = evaluateWith(new ExpressionRuntime());
const host = evaluateWith(ExpressionRuntime.withFunctions(registry));
const withdrawn = evaluateWith(
  ExpressionRuntime.withFunctions(withdrawnRegistry),
);

describe('expression functions on the real engines', (): void => {
  let logged: string[];

  beforeAll((): void => {
    // Load both engines outside any budget, as the services do.
    new ConditionService().prepareEngine('cel-legacy');
    new ConditionService().prepareEngine('cel-v2');
  });

  beforeEach((): void => {
    logged = [];
    (['debug', 'log', 'warn', 'error'] as const).forEach((level): void => {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown): void => {
          logged.push(String(message));
        });
    });
    caughtByMutatingHandler.length = 0;
    thenCalls.length = 0;
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe('built-ins, available without any registry', (): void => {
    it.each(DIALECTS)('computes numbers in %s', (dialect): void => {
      expect(builtIns('round(2.5)', {}, dialect)).toBe(3);
      expect(builtIns('round(form.x)', { x: -2.5 }, dialect)).toBe(-3);
      expect(builtIns('round(2)', {}, dialect)).toBe(2);
      expect(builtIns('ceil(form.x)', { x: 1.2 }, dialect)).toBe(2);
      expect(builtIns('floor(form.x)', { x: -1.2 }, dialect)).toBe(-2);
      expect(builtIns('abs(form.x)', { x: -3 }, dialect)).toBe(3);
      expect(builtIns('min(1, 2.5)', {}, dialect)).toBe(1);
      expect(builtIns('max(form.a, 3)', { a: 7.5 }, dialect)).toBe(7.5);
    });

    it.each(DIALECTS)(
      'compares and combines results in %s',
      (dialect): void => {
        // cel-v2: `double == int` through the exact operator, `double + int`
        // through the mixed one.
        expect(builtIns('abs(-2) == 2', {}, dialect)).toBe(true);
        expect(builtIns('ceil(form.x) + 1', { x: 1.2 }, dialect)).toBe(3);
        expect(
          builtIns('max(form.a, form.b) > 3', { a: 1, b: 4 }, dialect),
        ).toBe(true);
      },
    );

    it.each(DIALECTS)('handles strings in %s', (dialect): void => {
      expect(builtIns('lower(form.s)', { s: 'AbC' }, dialect)).toBe('abc');
      expect(builtIns('upper("abc")', {}, dialect)).toBe('ABC');
      expect(builtIns('trim(form.s) == "a b"', { s: ' a b \t' }, dialect)).toBe(
        true,
      );
    });

    it('keeps cel-v2’s own string.trim() method beside the global trim()', (): void => {
      expect(
        builtIns('form.s.trim() == trim(form.s)', { s: ' x ' }, 'cel-v2'),
      ).toBe(true);
    });

    it('does not shadow any cel-v2 global function', (): void => {
      const { Environment } = require('@marcbachmann/cel-js') as {
        readonly Environment: new (options?: EnvironmentOptions) => Environment;
      };
      const definitions = new Environment().getDefinitions().functions;
      const globalNames = new Set(
        definitions
          .filter((definition) => definition.receiverType === null)
          .map((definition) => definition.name),
      );

      expect(
        BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES.filter((name) =>
          globalNames.has(name),
        ),
      ).toEqual([]);
      // `trim` exists in cel-v2 only as a method on string.
      expect(
        definitions
          .filter((definition) => definition.name === 'trim')
          .map((definition) => definition.receiverType),
      ).toEqual(['string']);
    });

    it.each([
      ['round("x")', 'cel-legacy'],
      ['round("x")', 'cel-v2'],
      ['lower(1)', 'cel-legacy'],
      ['lower(1)', 'cel-v2'],
      ['min(1)', 'cel-legacy'],
      ['min(1)', 'cel-v2'],
    ] as const)(
      'refuses %s in %s as EXPRESSION_TYPE_ERROR',
      (expression, dialect): void => {
        expect(
          captureRuntimeError(() => builtIns(expression, {}, dialect)).code,
        ).toBe('EXPRESSION_TYPE_ERROR');
      },
    );

    it.each(DIALECTS)(
      'keeps the engine error for an unknown name that is not host-shaped in %s',
      (dialect): void => {
        expect(
          captureRuntimeError(() => builtIns('nope(1)', {}, dialect)).code,
        ).toBe('EXPRESSION_TYPE_ERROR');
      },
    );
  });

  describe('host functions', (): void => {
    it.each(DIALECTS)('calls a registered function in %s', (dialect): void => {
      expect(
        host('erp_costBand_v1(form.amount)', { amount: 1200 }, dialect),
      ).toBe('LOW');
      expect(
        host(
          'erp_costBand_v1(form.amount) == "HIGH"',
          { amount: 90_000 },
          dialect,
        ),
      ).toBe(true);
    });

    it('accepts an int literal for a double parameter in cel-v2', (): void => {
      expect(host('erp_costBand_v1(1000)', {}, 'cel-v2')).toBe('LOW');
    });

    it.each(DIALECTS)(
      'returns a declared int that compares and adds as one in %s',
      (dialect): void => {
        expect(host('count_v1(form.l) == 2', { l: [1, 2] }, dialect)).toBe(
          true,
        );
        expect(host('count_v1(form.l) + 1', { l: [1, 2] }, dialect)).toBe(3);
      },
    );

    it.each(DIALECTS)(
      'hands deep-frozen copies: a write throws TypeError, fails the call and leaves formData unchanged in %s',
      (dialect): void => {
        const form = { items: ['a', 'b'], nested: { qty: 1 } };
        const snapshot = structuredClone(form);
        const error = captureRuntimeError(() =>
          host('mutates_v1(form.items)', form, dialect),
        );

        expect(error.code).toBe('EXPRESSION_FUNCTION_FAILED');
        expect(caughtByMutatingHandler).toHaveLength(1);
        expect(caughtByMutatingHandler[0]).toBeInstanceOf(TypeError);
        expect(form).toEqual(snapshot);
      },
    );

    it.each(DIALECTS)(
      'keeps the handler message out of the error and the log in %s',
      (dialect): void => {
        const error = captureRuntimeError(() =>
          host('throws_v1(form.x)', { x: 1 }, dialect),
        );

        expect(error.code).toBe('EXPRESSION_FUNCTION_FAILED');
        expect(error.message).toBe('entry: EXPRESSION_FUNCTION_FAILED');
        expect(JSON.stringify(error.getResponse())).not.toContain(SECRET);
        expect(logged).toContain(
          'function=throws_v1 code=EXPRESSION_FUNCTION_FAILED reason=threw',
        );
        expect(logged.join('\n')).not.toContain(SECRET);
      },
    );

    it.each(DIALECTS)(
      'fails a handler that returns a promise in %s',
      async (dialect): Promise<void> => {
        const unhandled = jest.fn();

        process.on('unhandledRejection', unhandled);

        try {
          expect(
            captureRuntimeError(() => host('async_v1(1)', {}, dialect)).code,
          ).toBe('EXPRESSION_FUNCTION_FAILED');
          await new Promise((resolve) => setImmediate(resolve));
          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          process.off('unhandledRejection', unhandled);
        }
      },
    );

    it.each(DIALECTS)(
      'never calls the then of a foreign thenable, during or after the evaluation, in %s',
      async (dialect): Promise<void> => {
        // Adopting it (`Promise.resolve`) would call `then` in a microtask
        // after the evaluation, outside the budget and beyond its interrupt.
        expect(
          captureRuntimeError(() => host('foreignThen_v1(1)', {}, dialect))
            .code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
        await new Promise((resolve) => setImmediate(resolve));
        expect(thenCalls).toEqual([]);
      },
    );

    it.each(DIALECTS)(
      'silences a rejected promise without calling its own then in %s',
      async (dialect): Promise<void> => {
        const unhandled = jest.fn();

        process.on('unhandledRejection', unhandled);

        try {
          expect(
            captureRuntimeError(() => host('ownThen_v1(1)', {}, dialect)).code,
          ).toBe('EXPRESSION_FUNCTION_FAILED');
          await new Promise((resolve) => setImmediate(resolve));
          expect(unhandled).not.toHaveBeenCalled();
          expect(thenCalls).toEqual([]);
        } finally {
          process.off('unhandledRejection', unhandled);
        }
      },
    );

    it.each(DIALECTS)(
      'fails a result of the wrong type in %s',
      (dialect): void => {
        expect(
          captureRuntimeError(() => host('wrongType_v1(1)', {}, dialect)).code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
      },
    );

    it.each([
      'throws_v1(1) || true',
      'throws_v1(1) && false',
      '[1, 2].exists(x, throws_v1(x) || x == 1)',
    ])(
      'does not let cel-v2 absorb a function failure: %s',
      (expression): void => {
        expect(
          captureRuntimeError(() => host(expression, {}, 'cel-v2')).code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
      },
    );

    it.each([
      ['true || throws_v1(1)', true],
      ['false && throws_v1(1)', false],
    ])(
      'does not call a function cel-v2 short-circuits past: %s',
      (expression, expected): void => {
        // Not absorption: the handler never runs, so nothing failed.
        expect(host(expression, {}, 'cel-v2')).toBe(expected);
        expect(logged.join('\n')).not.toContain('function=throws_v1');
      },
    );

    it('fails a cel-legacy `||` with a failing function', (): void => {
      expect(
        captureRuntimeError(() =>
          host('throws_v1(1) || true', {}, 'cel-legacy'),
        ).code,
      ).toBe('EXPRESSION_FUNCTION_FAILED');
    });

    it('does not reach a function through cel-legacy has()', (): void => {
      expect(
        captureRuntimeError(() =>
          host('has(throws_v1(form.x))', { x: 1 }, 'cel-legacy'),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
      expect(logged.join('\n')).not.toContain('function=throws_v1');
    });

    it.each(DIALECTS)(
      'charges the handler time to the budget in %s',
      (dialect): void => {
        const budget = createExpressionBudget();

        ExpressionRuntime.withFunctions(registry).evaluate({
          budget,
          dialect,
          expression: 'slow_v1(30)',
          label: 'entry',
          roots: {},
        });

        expect(budget.remainingMs).toBeLessThanOrEqual(250 - 30);
      },
    );

    it.each(DIALECTS)(
      'interrupts a handler that outruns the budget in %s',
      (dialect): void => {
        const startedAt = performance.now();

        expect(
          captureRuntimeError(() => host('slow_v1(2000)', {}, dialect)).code,
        ).toBe('EXPRESSION_BUDGET_EXCEEDED');
        // 100 ms per expression; generous for a loaded machine.
        expect(performance.now() - startedAt).toBeLessThan(1000);
      },
    );
  });

  describe('a function withdrawn after publishing', (): void => {
    it.each([
      ['erp_costBand_v1(form.amount) == "LOW"', 'cel-legacy'],
      ['erp_costBand_v1(form.amount) == "LOW"', 'cel-v2'],
      // Fails closed wherever the call sits, even on a branch the engine
      // would not have reached.
      ['true || erp_costBand_v1(form.amount) == "LOW"', 'cel-v2'],
      ['false && erp_costBand_v1(form.amount) == "LOW"', 'cel-v2'],
      ['[1].exists(x, erp_costBand_v1(x) == "LOW")', 'cel-v2'],
      ['true || erp_costBand_v1(form.amount) == "LOW"', 'cel-legacy'],
    ] as const)(
      'fails %s in %s with EXPRESSION_FUNCTION_FAILED',
      (expression, dialect): void => {
        expect(
          captureRuntimeError(() =>
            withdrawn(expression, { amount: 1 }, dialect),
          ).code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
      },
    );

    it.each(DIALECTS)(
      'fails a host-shaped name nobody registered without a registry in %s',
      (dialect): void => {
        expect(
          captureRuntimeError(() => builtIns('erp_costBand_v1(1)', {}, dialect))
            .code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
      },
    );
  });

  describe('names the registry refuses for cel-legacy’s lexer', (): void => {
    // Built by hand: the registry itself refuses these names, which is the
    // point. cel-js 0.8.2 lexes `true` / `false` / `null` without a word
    // boundary, so the name is split before the parser sees it.
    const names = ['nullable_v1', 'trueUp_v1', 'falsey_v1'] as const;
    const unvalidated = names.map((name) =>
      hostFunction(name, (): BPMExpressionValue => 1, { returnType: 'int' }),
    );
    const handBuilt: BPMExpressionFunctionRegistry = {
      assertPublishable: (): readonly string[] => [],
      get: (name: string): BPMExpressionFunction | null =>
        unvalidated.find((fn) => fn.name === name) ?? null,
      list: (): readonly BPMExpressionFunctionDescriptor[] =>
        unvalidated.map((fn): BPMExpressionFunctionDescriptor => ({
          builtIn: false,
          description: fn.description,
          label: fn.label,
          name: fn.name,
          parameters: fn.parameters,
          returnType: fn.returnType,
        })),
    };
    const keywordHost = evaluateWith(
      ExpressionRuntime.withFunctions(handBuilt),
    );

    it.each(names)('cannot call %s in cel-legacy', (name): void => {
      expect(
        captureRuntimeError(() => keywordHost(`${name}(1)`, {}, 'cel-legacy'))
          .code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
    });

    it.each(names)('can call %s in cel-v2', (name): void => {
      expect(keywordHost(`${name}(1) == 1`, {}, 'cel-v2')).toBe(true);
    });

    it.each(names)('is refused at registration: %s', (name): void => {
      expect(
        () =>
          new StaticBPMExpressionFunctionRegistry([
            hostFunction(name, (): BPMExpressionValue => 1),
          ]),
      ).toThrow(`"${name}" starts with "true", "false" or "null"`);
    });
  });

  describe('the cel-v2 environment of a registry', (): void => {
    it('is cached and frozen', (): void => {
      const environment = loadCelV2Environment(registry);

      expect(loadCelV2Environment(registry)).toBe(environment);
      expect(() =>
        environment.registerFunction(
          'late_v1(int): int',
          (value: bigint) => value,
        ),
      ).toThrow();
    });

    it('can be cloned to type-check against declared variables', (): void => {
      const checking = loadCelV2Environment(registry)
        .clone()
        .registerVariable('form', 'map');

      expect(checking.check('erp_costBand_v1(form.amount)').valid).toBe(true);
      expect(checking.check('round(form.amount) > 1').valid).toBe(true);
      expect(checking.check('gone_v1(form.amount)').valid).toBe(false);
      expect(checking.check('lower(1)').valid).toBe(false);
    });

    it('keeps the base options: parse limits and mixed-type literals', (): void => {
      const tooLarge = Array.from(
        { length: 120 },
        (_item, index) => `${index}`,
      ).join(' + ');

      expect(parseCelV2(tooLarge, registry)).toBeNull();
      expect(host('{"a": "x", "b": count_v1([1])}', {}, 'cel-v2')).toEqual({
        a: 'x',
        b: 1,
      });
    });
  });

  // Rewritten 2026-11-07 (integration of P2 and P3), a deliberate change: this
  // group used to pin that `ConditionService` called the built-ins only,
  // until it was given the registry. It now injects one; without it,
  // `new ConditionService()` still has only the built-ins.
  describe('through ConditionService', (): void => {
    const evaluateThrough =
      (service: ConditionService) =>
      (expression: string, dialect: ExpressionDialect): unknown =>
        service.evaluateValue(expression, { form: { x: 2.4 } }, 'entry', {
          allowedRootIdentifiers: ['form'],
          dialect,
        });
    const builtInsOnly = evaluateThrough(new ConditionService());
    const withRegistry = evaluateThrough(new ConditionService(registry));
    const withWithdrawn = evaluateThrough(
      new ConditionService(withdrawnRegistry),
    );

    it('calls a built-in in cel-v2, with or without a registry', (): void => {
      expect(builtInsOnly('round(form.x)', 'cel-v2')).toBe(2);
      expect(withRegistry('round(form.x)', 'cel-v2')).toBe(2);
    });

    it('calls the injected registry’s host function in cel-v2', (): void => {
      expect(withRegistry('erp_costBand_v1(form.x * 100000.0)', 'cel-v2')).toBe(
        'HIGH',
      );
    });

    it.each([
      ['without a registry', builtInsOnly],
      ['after the function was withdrawn', withWithdrawn],
    ])(
      'fails a host function call %s with EXPRESSION_FUNCTION_FAILED',
      (_case, evaluate): void => {
        expect(
          captureRuntimeError(() =>
            evaluate('erp_costBand_v1(form.x) == "LOW"', 'cel-v2'),
          ).code,
        ).toBe('EXPRESSION_FUNCTION_FAILED');
      },
    );

    it('keeps an unknown name that is not shaped like a host function a type error (docs/24 §2.1)', (): void => {
      expect(
        captureRuntimeError(() => withRegistry('nope(form.x)', 'cel-v2')).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
    });

    it('keeps the handler’s message out of the error and the logs', (): void => {
      const error = captureRuntimeError(() =>
        withRegistry('throws_v1(1) || true', 'cel-v2'),
      );

      expect(error.code).toBe('EXPRESSION_FUNCTION_FAILED');
      expect(error.message).toBe('entry: EXPRESSION_FUNCTION_FAILED');
      expect(JSON.stringify(error.getResponse())).not.toContain(SECRET);
      expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('still refuses a call in cel-legacy: its textual root check reads the name as a root', (): void => {
      // Unchanged behaviour, pinned: the cel-legacy root lint in
      // condition.service.ts treats `round` as an unknown root, so the call
      // never reaches the engine when the use point has an allowlist.
      expect(
        captureRuntimeError(() => builtInsOnly('round(form.x)', 'cel-legacy'))
          .code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
      expect(
        captureRuntimeError(() =>
          withRegistry('erp_costBand_v1(form.x)', 'cel-legacy'),
        ).code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
    });
  });
});
