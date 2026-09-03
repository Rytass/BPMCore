import type { ConditionService as ConditionServiceType } from './condition.service';

/**
 * Guards the fix for the defect that made `@rytass/bpm-core-nestjs-module`
 * untestable in a host project.
 *
 * `cel-js` is ESM-only and its `chevrotain` dependency ships an exports map
 * `jest-resolve` cannot follow. While `condition.service` imported it at the
 * top of the file, the chain `index → bpm-root → delegation → condition`
 * dragged it into *every* consumer test that touched the package root, which
 * then failed with `Cannot find module 'chevrotain'` before running a single
 * assertion.
 *
 * The counter below only moves when the engine is genuinely required, so this
 * fails the moment the load creeps back to module scope.
 */
let mockCelLoadCount = 0;

jest.mock('cel-js', () => {
  mockCelLoadCount += 1;

  return {
    evaluate: (): unknown => true,
    parse: (): unknown => ({ cst: { expression: 'true' }, isSuccess: true }),
  };
});

describe('cel-js loading', () => {
  // Declared first on purpose: the counter is file-scoped, so this is the only
  // point at which an absolute zero is meaningful. The regression being guarded
  // is the whole chain `index -> bpm-root -> delegation -> condition`, not one
  // file — a consumer that imports anything from the package root must not pay
  // for `cel-js`, and testing `condition.service` alone would still pass if
  // some other module started importing it at module scope.
  it('is not triggered by importing the package root', (): void => {
    require('../../index');

    expect(mockCelLoadCount).toBe(0);
  });

  it('is deferred until an expression is parsed', (): void => {
    expect(mockCelLoadCount).toBe(0);

    const { ConditionService } = jest.requireActual<{
      readonly ConditionService: new () => ConditionServiceType;
    }>('./condition.service');

    // Importing the module — which is what a host's `import` of the package
    // root ends up doing — must not reach `cel-js`.
    expect(mockCelLoadCount).toBe(0);

    const service = new ConditionService();

    expect(service.lintExpression('true', 'condition')).toEqual([]);
    expect(mockCelLoadCount).toBe(1);

    // And the engine is loaded once, not once per call.
    service.lintExpression('true', 'condition');

    expect(mockCelLoadCount).toBe(1);
  });
});
