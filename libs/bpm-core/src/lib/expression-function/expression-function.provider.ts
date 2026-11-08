import { Provider } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BUILT_IN_EXPRESSION_FUNCTION_REGISTRY,
  StaticBPMExpressionFunctionRegistry,
} from './expression-function.registry';
import {
  BPM_EXPRESSION_FUNCTION_REGISTRY,
  BPM_EXPRESSION_FUNCTIONS,
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from './expression-function.types';

/**
 * Resolves the registry every BPM module injects under
 * `BPM_EXPRESSION_FUNCTION_REGISTRY`: the nine built-ins plus the host
 * functions from `BPMRootModule`'s `expressionFunctions` runtime option and
 * from a `BPM_EXPRESSION_FUNCTIONS` provider, in that order. With neither, only
 * the built-ins are available.
 *
 * Every function is validated here, so a bad name, an async handler or an
 * unsupported type fails the host's boot — for `forRoot` and `forRootAsync`
 * alike — instead of the first evaluation that would reach it.
 *
 * Both sources are injected optionally so the module also resolves on its own,
 * outside `BPMRootModule`.
 */
export const expressionFunctionRegistryProvider: Provider<BPMExpressionFunctionRegistry> =
  {
    inject: [
      { optional: true, token: BPM_ROOT_OPTIONS },
      { optional: true, token: BPM_EXPRESSION_FUNCTIONS },
    ],
    provide: BPM_EXPRESSION_FUNCTION_REGISTRY,
    useFactory: (
      rootOptions: BPMRootRuntimeOptions | undefined,
      hostFunctions: readonly BPMExpressionFunction[] | undefined,
    ): BPMExpressionFunctionRegistry => {
      const functions = [
        ...(rootOptions?.expressionFunctions ?? []),
        ...(hostFunctions ?? []),
      ];

      // Without host functions every consumer shares the built-ins-only
      // registry, and with it the default engine environments.
      return functions.length === 0
        ? BUILT_IN_EXPRESSION_FUNCTION_REGISTRY
        : new StaticBPMExpressionFunctionRegistry(functions);
    },
  };
