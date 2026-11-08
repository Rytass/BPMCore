import { Logger } from '@nestjs/common';
import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type {
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { ConditionService } from './condition.service';
import { ExpressionRuntimeError } from './expression-errors';

/**
 * Phase 23 integration of P2 and P3 (2026-11-07): `ConditionService` lints
 * and evaluates with the injected function registry. Runs in
 * jest.real-engine.config.cts against the installed engines.
 */

const SECRET = 'REGISTRY_SECRET_77';

const SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: 'amount', required: true, type: 'number' },
    { fieldKey: 'title', label: 'title', required: true, type: 'text' },
  ],
  schemaVersion: 1,
};

const ENTRY = {
  dialect: 'cel-v2',
  formSchema: SCHEMA,
  usagePoint: 'ENTRY_CONDITION',
} as const;

const HOST_FUNCTIONS: readonly BPMExpressionFunction[] = [
  {
    description: 'Cost band of an amount',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      (args[0] as number) < 1000 ? 'LOW' : 'HIGH',
    label: 'band',
    name: 'erp_band_v1',
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
  },
  {
    description: 'Tags a text',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      `#${String(args[0])}`,
    label: 'tag',
    name: 'erp_tag_v1',
    parameters: [{ name: 'text', type: 'string' }],
    returnType: 'string',
  },
];

type ConditionModule = typeof import('./condition.service');
type RegistryModule =
  typeof import('../expression-function/expression-function.registry');

interface FreshModules {
  readonly condition: ConditionModule;
  readonly registry: RegistryModule;
}

/**
 * A fresh module registry: the cel-v2 base environment and every registry
 * environment start uncached, so the order a test runs things in is the
 * order the engine sees them in.
 */
const loadFreshModules = (): FreshModules => {
  let modules: FreshModules | null = null;

  jest.isolateModules((): void => {
    modules = {
      condition: jest.requireActual<ConditionModule>('./condition.service'),
      registry: jest.requireActual<RegistryModule>(
        '../expression-function/expression-function.registry',
      ),
    };
  });

  if (modules === null) {
    throw new Error('jest.isolateModules did not run');
  }

  return modules;
};

const codes = (
  service: ConditionService,
  expression: string,
): readonly string[] => service.lintExpression(expression, 'entry', ENTRY);

const evaluate = (
  service: ConditionService,
  expression: string,
  form: Readonly<Record<string, unknown>>,
): unknown =>
  service.evaluateValue(expression, { form }, 'entry', {
    allowedRootIdentifiers: ['form'],
    dialect: 'cel-v2',
  });

describe('ConditionService with a function registry', (): void => {
  let logged: string[];

  beforeEach((): void => {
    logged = [];
    (['debug', 'log', 'warn', 'error'] as const).forEach((level): void => {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown): void => {
          logged.push(String(message));
        });
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe('type-checks host functions (env.check on the registry environment)', (): void => {
    const service = new ConditionService(
      new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS),
    );

    it('accepts a well-typed call', (): void => {
      expect(codes(service, 'erp_band_v1(form.amount) == "HIGH"')).toEqual([]);
    });

    it('refuses a host function whose result does not fit the use point', (): void => {
      expect(codes(service, 'erp_band_v1(form.amount)')).toEqual([
        'entry: EXPR_RESULT_TYPE_MISMATCH',
      ]);
    });

    it('refuses an argument of the wrong declared type', (): void => {
      expect(codes(service, 'erp_tag_v1(form.amount) == "#1"')).toEqual([
        'entry: EXPR_FIELD_TYPE_MISMATCH amount',
      ]);
    });

    it('could not check a host function before it was wired (contrast)', (): void => {
      // Availability alone (no environment) skips the type check.
      expect(
        new ConditionService().lintExpression(
          'erp_band_v1(form.amount)',
          'entry',
          {
            ...ENTRY,
            functionRegistry: new StaticBPMExpressionFunctionRegistry(
              HOST_FUNCTIONS,
            ),
          },
        ),
      ).toEqual([]);
    });
  });

  // `clone()` freezes the environment it is called on (P2 handover). Every
  // environment is complete and frozen when it is built, so no order of
  // boot (building a registry's environment), lint (cloning it) and
  // evaluation can hit `Cannot modify frozen registry`.
  describe('the freeze is order-independent', (): void => {
    const exercise = (
      modules: FreshModules,
      order: readonly ('evaluate' | 'lint')[],
    ): void => {
      const first = new modules.condition.ConditionService(
        new modules.registry.StaticBPMExpressionFunctionRegistry(
          HOST_FUNCTIONS,
        ),
      );

      order.forEach((step): void => {
        if (step === 'lint') {
          expect(codes(first, 'erp_band_v1(form.amount)')).toEqual([
            'entry: EXPR_RESULT_TYPE_MISMATCH',
          ]);
        } else {
          expect(
            evaluate(first, 'erp_band_v1(form.amount)', { amount: 5 }),
          ).toBe('LOW');
        }
      });

      // A second registry booted after the first was linted and evaluated:
      // its environment is cloned from the already-frozen base.
      const second = new modules.condition.ConditionService(
        new modules.registry.StaticBPMExpressionFunctionRegistry([
          HOST_FUNCTIONS[1],
        ]),
      );

      [...order].reverse().forEach((step): void => {
        if (step === 'lint') {
          expect(codes(second, 'erp_tag_v1(form.title) == "#a"')).toEqual([]);
          expect(codes(second, 'erp_band_v1(form.amount) == "LOW"')).toEqual([
            'entry: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1',
          ]);
        } else {
          expect(
            evaluate(second, 'erp_tag_v1(form.title)', { title: 'a' }),
          ).toBe('#a');
        }
      });
      expect(logged.join('\n')).not.toContain('frozen');
    };

    it('lint first, then evaluate, then boot another registry', (): void => {
      expect(() =>
        exercise(loadFreshModules(), ['lint', 'evaluate']),
      ).not.toThrow();
    });

    it('evaluate first, then lint, then boot another registry', (): void => {
      expect(() =>
        exercise(loadFreshModules(), ['evaluate', 'lint']),
      ).not.toThrow();
    });

    it('prepares the engine before either', (): void => {
      const modules = loadFreshModules();
      const service = new modules.condition.ConditionService(
        new modules.registry.StaticBPMExpressionFunctionRegistry(
          HOST_FUNCTIONS,
        ),
      );

      service.prepareEngine('cel-v2');
      service.prepareEngine('cel-legacy');

      expect(codes(service, 'erp_band_v1(form.amount) == "LOW"')).toEqual([]);
      expect(evaluate(service, 'erp_band_v1(form.amount)', { amount: 5 })).toBe(
        'LOW',
      );
    });
  });

  describe('which names the lint asks the registry about', (): void => {
    const registry = new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS);
    const service = new ConditionService(registry);

    it('asks only for `…_vN` names and built-ins, never the engine’s own', (): void => {
      const ask = jest.spyOn(registry, 'assertPublishable');

      expect(
        codes(
          service,
          'size(form.title) > 1 && int(form.amount) > 1 && round(form.amount) > 1 && erp_band_v1(form.amount) == "LOW" && form.title.matches("a")',
        ),
      ).toEqual([]);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask.mock.calls[0][0]).toEqual(['round', 'erp_band_v1']);
    });

    it('refuses any other unknown name without asking', (): void => {
      const ask = jest.spyOn(registry, 'assertPublishable');

      expect(codes(service, 'nope(form.amount) == 1')).toEqual([
        'entry: EXPR_FUNCTION_NOT_REGISTERED nope',
      ]);
      expect(ask).not.toHaveBeenCalled();
    });
  });

  describe('isolates a registry that throws or answers out of shape', (): void => {
    const real = new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS);
    const throwSecret = (): never => {
      throw new Error(SECRET);
    };
    const availability = (
      overrides: Partial<Record<'assertPublishable' | 'get', unknown>>,
    ): BPMExpressionFunctionRegistry =>
      ({
        assertPublishable: (names: readonly string[]): readonly string[] =>
          real.assertPublishable(names),
        get: (name: string): BPMExpressionFunction | null => real.get(name),
        list: () => real.list(),
        ...overrides,
      }) as BPMExpressionFunctionRegistry;
    const call = 'erp_band_v1(form.amount) == "LOW"';

    it.each([
      ['assertPublishable throws', { assertPublishable: throwSecret }],
      [
        'assertPublishable answers a string',
        { assertPublishable: () => SECRET },
      ],
      [
        'assertPublishable answers non-strings',
        { assertPublishable: () => [{ name: SECRET }] },
      ],
      ['get throws', { get: throwSecret }],
      ['get answers without parameters', { get: () => ({ name: SECRET }) }],
    ])(
      'refuses the call when %s, with a fixed code only',
      (_case, overrides): void => {
        const lines = new ConditionService().lintExpression(call, 'entry', {
          ...ENTRY,
          functionRegistry: availability(overrides),
        });

        expect(lines).toEqual([
          'entry: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1',
        ]);
        expect(logged.join('\n')).not.toContain(SECRET);
        expect(logged).toContainEqual(
          expect.stringMatching(
            /^code=EXPR_FUNCTION_NOT_REGISTERED reason=[a-z-]+$/u,
          ),
        );
      },
    );

    it('never takes a subject from what the registry returned', (): void => {
      const lines = new ConditionService().lintExpression(call, 'entry', {
        ...ENTRY,
        // An identifier-shaped secret would pass the subject pattern.
        functionRegistry: availability({
          assertPublishable: () => [SECRET],
        }),
      });

      expect(lines.join('; ')).not.toContain(SECRET);
    });

    it.each([
      ['list throws', { list: throwSecret }],
      ['list answers a string', { list: () => SECRET }],
      ['get throws while the environment is built', { get: throwSecret }],
    ])(
      'refuses every cel-v2 expression when the injected registry’s %s',
      (_case, overrides): void => {
        const service = new ConditionService({
          ...availability({}),
          ...overrides,
        } as BPMExpressionFunctionRegistry);

        expect(codes(service, 'form.amount > 1')).toEqual([
          'entry: EXPR_FUNCTION_NOT_REGISTERED',
        ]);
        expect(codes(service, call)).toEqual([
          'entry: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1',
        ]);
        expect(logged.join('\n')).not.toContain(SECRET);
      },
    );

    /*
     * Integration review (2026-11-07): evaluation and `prepareEngine` used to
     * pass the host's own error up (its message included), and an answer out
     * of shape surfaced as a raw `TypeError`. Both dialects now fail closed
     * with `EXPRESSION_FUNCTION_FAILED` and log a fixed line only.
     */
    describe('at evaluation and prepareEngine', (): void => {
      const capture = (action: () => unknown): unknown => {
        try {
          action();
        } catch (error: unknown) {
          return error;
        }

        throw new Error('Expected the action to throw');
      };
      const expectFunctionFailed = (error: unknown): void => {
        expect(error).toBeInstanceOf(ExpressionRuntimeError);
        expect((error as ExpressionRuntimeError).code).toBe(
          'EXPRESSION_FUNCTION_FAILED',
        );
        expect(String((error as Error).message)).not.toContain(SECRET);
        expect(
          JSON.stringify((error as ExpressionRuntimeError).getResponse()),
        ).not.toContain(SECRET);
      };
      const evaluateIn = (
        service: ConditionService,
        dialect: 'cel-legacy' | 'cel-v2',
        expression: string,
      ): unknown =>
        service.evaluateValue(expression, { form: { amount: 5 } }, 'entry', {
          allowedRootIdentifiers: ['form'],
          dialect,
        });

      it.each([
        ['list throws', { list: throwSecret }],
        ['list answers a string', { list: () => SECRET }],
        ['get throws', { get: throwSecret }],
        ['get answers null', { get: () => null }],
        ['get answers without parameters', { get: () => ({ name: SECRET }) }],
        ['get answers another function', { get: () => real.get('erp_tag_v1') }],
        [
          'get answers a parameter of an unknown type',
          {
            get: (name: string) => ({
              ...real.get(name),
              parameters: [{ name: 'x', type: SECRET }],
            }),
          },
        ],
      ])('when %s', (_case, overrides): void => {
        const service = new ConditionService({
          ...availability({}),
          ...overrides,
        } as BPMExpressionFunctionRegistry);

        expectFunctionFailed(
          capture(() => evaluateIn(service, 'cel-v2', 'form.amount > 1')),
        );
        expectFunctionFailed(
          capture(() => evaluateIn(service, 'cel-legacy', 'form.amount > 1')),
        );
        expectFunctionFailed(capture(() => service.prepareEngine('cel-v2')));
        expectFunctionFailed(
          capture(() => service.prepareEngine('cel-legacy')),
        );
        expect(logged.join('\n')).not.toContain(SECRET);
        expect(logged).toContainEqual(
          expect.stringMatching(
            /^code=EXPRESSION_FUNCTION_FAILED reason=registry-[a-z-]+$/u,
          ),
        );
      });

      it('reads the registry again once it answers', (): void => {
        const answers = { broken: true };
        const service = new ConditionService({
          ...availability({}),
          list: () => {
            if (answers.broken) {
              throw new Error(SECRET);
            }

            return real.list();
          },
        } as BPMExpressionFunctionRegistry);

        expectFunctionFailed(
          capture(() => evaluateIn(service, 'cel-v2', call)),
        );
        answers.broken = false;
        expect(evaluateIn(service, 'cel-v2', call)).toBe(true);
        expect(evaluateIn(service, 'cel-legacy', 'form.amount > 1')).toBe(true);
      });
    });
  });

  /*
   * Current behaviour, pinned — not a design goal (integration review,
   * 2026-11-07). cel-legacy host functions are "not opened" only in the sense
   * that the publish lint and an evaluation that passes
   * `allowedRootIdentifiers` refuse them through the textual root check. The
   * workflow engine's evaluation points and delegation pass only the dialect,
   * so a cel-legacy expression that never went through today's lint does run
   * the host's handler. Closing that is a P4/P5 decision (docs/23).
   */
  describe('cel-legacy host function calls (current behaviour, not a design goal)', (): void => {
    const calls: string[] = [];
    const service = new ConditionService(
      new StaticBPMExpressionFunctionRegistry([
        {
          ...HOST_FUNCTIONS[0],
          handler: (
            ...args: readonly BPMExpressionValue[]
          ): BPMExpressionValue => {
            calls.push('band');

            return (args[0] as number) < 1000 ? 'LOW' : 'HIGH';
          },
        },
      ]),
    );
    const call = 'erp_band_v1(form.amount) == "LOW"';

    beforeEach((): void => {
      calls.length = 0;
    });

    it('runs the handler when the caller passes only the dialect', (): void => {
      expect(
        service.evaluateValue(call, { form: { amount: 5 } }, 'entry', {
          dialect: 'cel-legacy',
        }),
      ).toBe(true);
      expect(calls).toEqual(['band']);
    });

    it('refuses the call before the engine when the caller passes an allowlist', (): void => {
      let code: string | null = null;

      try {
        service.evaluateValue(call, { form: { amount: 5 } }, 'entry', {
          allowedRootIdentifiers: ['form'],
          dialect: 'cel-legacy',
        });
      } catch (error: unknown) {
        code = error instanceof ExpressionRuntimeError ? error.code : null;
      }

      expect(code).toBe('EXPRESSION_SYNTAX_ERROR');
      expect(calls).toEqual([]);
    });

    it('is refused by the publish lint of a use point', (): void => {
      expect(
        service.lintExpression(call, 'entry', {
          dialect: 'cel-legacy',
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual(['entry references unsupported identifier erp_band_v1']);
      // Binding the name in a macro does not hide it from cel-legacy's scan.
      expect(
        service.lintExpression(
          'form.tags.exists(erp_band_v1, true) && erp_band_v1(form.amount) == "LOW"',
          'entry',
          { dialect: 'cel-legacy', usagePoint: 'ENTRY_CONDITION' },
        ),
      ).toEqual(['entry references unsupported identifier erp_band_v1']);
    });
  });

  /*
   * Current behaviour, pinned — not a design goal (integration review,
   * 2026-11-07). `util.types` does not see through `bind`, so a bound async
   * handler whose prototype was also moved to `Function.prototype` and
   * re-tagged is accepted at registration. It returns a promise, which the
   * call wrapper refuses: the evaluation fails closed.
   */
  it('fails closed on a bound async handler disguised past registration (current behaviour)', (): void => {
    const bound = (async (): Promise<BPMExpressionValue> => 'LOW').bind(
      undefined,
    );
    const disguised = Object.defineProperty(
      Object.setPrototypeOf(bound, Function.prototype) as object,
      Symbol.toStringTag,
      { value: 'Function' },
    ) as BPMExpressionFunction['handler'];
    const registry = new StaticBPMExpressionFunctionRegistry([
      { ...HOST_FUNCTIONS[0], handler: disguised },
    ]);
    const service = new ConditionService(registry);

    (['cel-legacy', 'cel-v2'] as const).forEach((dialect): void => {
      let code: string | null = null;

      try {
        service.evaluateValue(
          'erp_band_v1(form.amount) == "LOW"',
          { form: { amount: 5 } },
          'entry',
          { dialect },
        );
      } catch (error: unknown) {
        code = error instanceof ExpressionRuntimeError ? error.code : null;
      }

      expect(code).toBe('EXPRESSION_FUNCTION_FAILED');
    });
  });

  it('lints a delegation condition with its use point (result type, roots)', (): void => {
    const service = new ConditionService();

    expect(
      // `principal` is `dyn`; `size()` makes the result an `int`.
      service.lintExpression('size(principal.memberId)', 'scopeConditionCel', {
        dialect: 'cel-v2',
        usagePoint: 'DELEGATION_CONDITION',
      }),
    ).toEqual(['scopeConditionCel: EXPR_RESULT_TYPE_MISMATCH']);
    expect(
      service.lintExpression('lastDecision.d == "x"', 'scopeConditionCel', {
        dialect: 'cel-v2',
        usagePoint: 'DELEGATION_CONDITION',
      }),
    ).toEqual(['scopeConditionCel: EXPR_ROOT_NOT_ALLOWED lastDecision']);
  });
});
