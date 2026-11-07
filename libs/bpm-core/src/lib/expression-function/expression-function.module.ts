import {
  DynamicModule,
  Global,
  Module,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';
import { expressionFunctionRegistryProvider } from './expression-function.provider';
import {
  BPM_EXPRESSION_FUNCTION_REGISTRY,
  BPMExpressionFunction,
} from './expression-function.types';

export interface ExpressionFunctionModuleOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Host functions as a Nest provider for `BPM_EXPRESSION_FUNCTIONS`, for
   * functions that need injected dependencies to be built. Added after the
   * `expressionFunctions` runtime option; a name in both is a boot error.
   */
  readonly functionsProvider?: Provider<readonly BPMExpressionFunction[]>;
}

/**
 * Publishes the expression function registry (ADR 22 §3.5) under
 * `BPM_EXPRESSION_FUNCTION_REGISTRY`. Global, because every module that
 * evaluates or lints an expression (`ConditionModule` consumers: templates,
 * the workflow engine, delegation) reads the same registry.
 */
@Global()
@Module({})
export class ExpressionFunctionModule {
  static forRoot(options: ExpressionFunctionModuleOptions = {}): DynamicModule {
    return {
      exports: [BPM_EXPRESSION_FUNCTION_REGISTRY],
      global: true,
      imports: [...(options.imports ?? [])],
      module: ExpressionFunctionModule,
      providers: [
        ...(options.functionsProvider ? [options.functionsProvider] : []),
        expressionFunctionRegistryProvider,
      ],
    };
  }
}
