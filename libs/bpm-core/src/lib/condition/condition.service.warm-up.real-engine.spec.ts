import { Logger } from '@nestjs/common';
import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import { ConditionService } from './condition.service';
import type { ExpressionDialect } from './expression-dialect';

/**
 * Boot warm-up (Phase 23 P3 live finding, P4): after an api restart the first
 * evaluation took about 90 ms of its 100 ms budget. `ConditionService` now
 * warms both dialects in `onApplicationBootstrap`.
 *
 * What is asserted is behaviour, not a cold/warm timing gap: the cold cost
 * is paid once per process (engine code loading and compilation), not once
 * per module registry, so a second `jest.isolateModules` copy is already
 * warm with or without `warmUp()`, and another real-engine suite run earlier
 * in the same worker warms this one too. A timing comparison would pass with
 * an empty `warmUp()`. So the suite checks that the warm-up really parses,
 * lints and evaluates each dialect through this service's own environment,
 * that the first real evaluation afterwards is well inside the budget, that
 * it never throws and never logs host text. Timings are printed only:
 * `warmUp itself` is the cold cost moved to boot when this suite is the first
 * to touch the engines in its worker.
 */

type ConditionModule = typeof import('./condition.service');
type RegistryModule =
  typeof import('../expression-function/expression-function.registry');

interface FreshModules {
  readonly condition: ConditionModule;
  readonly registry: RegistryModule;
}

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

const EXPRESSION = 'form.amount * 2 > 100 && demo_band_v1(form.amount) == "HIGH"';
const LEGACY_EXPRESSION = 'form.amount * 2 > 100';
const DIALECTS: readonly ExpressionDialect[] = ['cel-legacy', 'cel-v2'];

const createRegistry = (
  registryModule: RegistryModule,
): InstanceType<RegistryModule['StaticBPMExpressionFunctionRegistry']> =>
  new registryModule.StaticBPMExpressionFunctionRegistry([
    {
      description: 'Cost band',
      handler: (amount: BPMExpressionValue): BPMExpressionValue =>
        typeof amount === 'number' && amount > 1000 ? 'HIGH' : 'LOW',
      label: 'Cost band',
      name: 'demo_band_v1',
      parameters: [{ name: 'amount', type: 'double' }],
      returnType: 'string',
    },
  ]);

/** Milliseconds the first evaluation per dialect takes on this service. */
const timeFirstEvaluations = (
  service: InstanceType<ConditionModule['ConditionService']>,
): Readonly<Record<ExpressionDialect, number>> =>
  Object.fromEntries(
    DIALECTS.map((dialect): readonly [ExpressionDialect, number] => {
      const startedAt = performance.now();

      service.evaluateValue(
        dialect === 'cel-v2' ? EXPRESSION : LEGACY_EXPRESSION,
        { form: { amount: 1500 } },
        'entry',
        { dialect },
      );

      return [dialect, performance.now() - startedAt];
    }),
  ) as Readonly<Record<ExpressionDialect, number>>;

describe('ConditionService boot warm-up', (): void => {
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

  it('leaves the first evaluation after warmUp well inside the budget', (): void => {
    const fresh = loadFreshModules();
    const service = new fresh.condition.ConditionService(
      createRegistry(fresh.registry),
    );
    // The first test of the suite and measured before anything else, so it
    // absorbs the cold cost when this suite is the first in its worker to
    // touch the engines. Keep it first.
    const warmUp = service.warmUp();
    const first = timeFirstEvaluations(service);

    // The numbers this change is about; read them in the test output.
    console.info(
      `expression warm-up: warmUp itself legacy=${String(warmUp['cel-legacy']?.toFixed(1))}ms v2=${String(warmUp['cel-v2']?.toFixed(1))}ms; ` +
        `first evaluation after it legacy=${first['cel-legacy'].toFixed(1)}ms v2=${first['cel-v2'].toFixed(1)}ms`,
    );

    // A quarter of the 100 ms budget leaves room for a loaded CI machine.
    expect(first['cel-legacy']).toBeLessThan(25);
    expect(first['cel-v2']).toBeLessThan(25);
    expect(logged).toEqual([]);
  });

  it('parses, lints and evaluates each dialect through its own environment', (): void => {
    const fresh = loadFreshModules();
    const service = new fresh.condition.ConditionService(
      createRegistry(fresh.registry),
    );
    const prepare = jest.spyOn(service, 'prepareEngine');
    const lint = jest.spyOn(service, 'lintExpressionIssues');
    const evaluate = jest.spyOn(service, 'evaluateValue');

    const result = service.warmUp();

    expect(result['cel-legacy']).toEqual(expect.any(Number));
    expect(result['cel-v2']).toEqual(expect.any(Number));
    DIALECTS.forEach((dialect): void => {
      expect(prepare).toHaveBeenCalledWith(dialect);
      expect(lint).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ dialect }),
      );
      // A real evaluation that returned a value, not a skipped one.
      const call = evaluate.mock.calls.findIndex(
        ([, , , options]): boolean => options?.dialect === dialect,
      );

      expect(call).toBeGreaterThanOrEqual(0);
      expect(evaluate.mock.results[call]).toEqual({
        type: 'return',
        value: true,
      });
    });
    expect(logged).toEqual([]);
  });

  it('runs on application bootstrap', (): void => {
    const fresh = loadFreshModules();
    const service = new fresh.condition.ConditionService();
    const warmUp = jest.spyOn(service, 'warmUp');

    service.onApplicationBootstrap();

    expect(warmUp).toHaveBeenCalledTimes(1);
  });

  it('logs one line with both timings when the boot warm-up succeeds', (): void => {
    // The module-level class, so its Logger is the one spied on above.
    const service = new ConditionService();
    const log = jest.mocked(Logger.prototype.log);

    service.onApplicationBootstrap();

    expect(log).toHaveBeenCalledTimes(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(
      /^code=EXPRESSION_WARM_UP_DONE cel-legacy=\d+\.\dms cel-v2=\d+\.\dms$/u,
    );
    // Fixed words and milliseconds only: never the expression or its data.
    expect(logged[0]).not.toContain('warmUp');
    expect(logged[0]).not.toContain('form');
  });

  it('marks a dialect that failed and logs nothing when both failed', (): void => {
    const service = new ConditionService();

    jest
      .spyOn(service, 'warmUp')
      .mockReturnValueOnce({ 'cel-legacy': 2, 'cel-v2': null })
      .mockReturnValueOnce({ 'cel-legacy': null, 'cel-v2': null });

    service.onApplicationBootstrap();
    expect(logged).toEqual([
      'code=EXPRESSION_WARM_UP_DONE cel-legacy=2.0ms cel-v2=failed',
    ]);

    service.onApplicationBootstrap();
    expect(logged).toHaveLength(1);
  });

  it('never throws and logs only a fixed code when the registry cannot be read', (): void => {
    const secret = 'host-secret-registry-message';
    // The module-level class, so its Logger is the one spied on above.
    const service = new ConditionService({
      assertPublishable: (): readonly string[] => [],
      get: (): null => null,
      list: (): never => {
        throw new Error(secret);
      },
    });

    const result = service.warmUp();

    expect(result).toEqual({ 'cel-legacy': null, 'cel-v2': null });
    expect(logged.join('\n')).not.toContain(secret);
    expect(logged).toEqual(
      expect.arrayContaining([
        'code=EXPRESSION_WARM_UP_FAILED dialect=cel-legacy',
        'code=EXPRESSION_WARM_UP_FAILED dialect=cel-v2',
      ]),
    );
  });
});
