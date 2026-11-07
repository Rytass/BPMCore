import { Logger } from '@nestjs/common';
import { runWithinTimeBudget } from '../workflow-engine/time-budget';
import {
  ExpressionRuntimeError,
  toExpressionRuntimeError,
} from './expression-errors';
import type { ExpressionBudget } from './expression-budget';
import {
  DEFAULT_EXPRESSION_RESULT_LIMITS,
  type JsonValue,
  normalizeExpressionResult,
} from './expression-result.walker';
import {
  celLegacyAdapter,
  createCelLegacyAdapter,
} from './adapters/cel-legacy.adapter';
import { celV2Adapter, createCelV2Adapter } from './adapters/cel-v2.adapter';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunctionRegistry } from '../expression-function/expression-function.types';
import {
  DEFAULT_EXPRESSION_DIALECT,
  type ExpressionDialect,
} from './expression-dialect';

/** An engine's compiled form of one expression. `native` is never read outside its adapter. */
export interface ExpressionHandle {
  readonly native: unknown;
}

/**
 * One engine behind the runtime. `compile` runs before any budget starts and
 * returns `null` when the expression does not parse. `evaluate` runs inside the
 * budget and may throw whatever the engine throws; the runtime maps it.
 */
export interface ExpressionEngineAdapter {
  compile(expression: string): ExpressionHandle | null;
  evaluate(
    handle: ExpressionHandle,
    roots: Readonly<Record<string, unknown>>,
  ): unknown;
}

export interface ExpressionEvalRequest {
  readonly expression: string;
  /** Names the use point in errors and logs. Must never contain a context value. */
  readonly label: string;
  /** Only the roots the use point allows. */
  readonly roots: Readonly<Record<string, unknown>>;
  readonly budget: ExpressionBudget;
  /**
   * The engine to evaluate with: the dialect of the definition or rule the
   * expression belongs to. Absent means `cel-legacy` (ADR 22 §3.3).
   */
  readonly dialect?: ExpressionDialect;
}

const logger = new Logger('ExpressionRuntime');

const runtimesByRegistry = new WeakMap<
  BPMExpressionFunctionRegistry,
  ExpressionRuntime
>();

/**
 * The single place where an expression is compiled and evaluated (ADR 22 §3.2).
 * Every caller goes through here: nothing reaches an engine directly.
 *
 * Order: compile (outside any budget, so an interrupt cannot land in module
 * loading), check the budget, evaluate under `runWithinTimeBudget`, normalize
 * the result, and map any failure to an {@link ExpressionRuntimeError}.
 *
 * A timeout raises `EXPRESSION_BUDGET_EXCEEDED`. It never returns `false`: an
 * expression that did not finish is not the same as one that is false.
 */
export class ExpressionRuntime {
  /**
   * Without arguments the runtime calls the nine built-in functions only
   * (ADR 22 §3.5); use {@link ExpressionRuntime.withFunctions} for a host's.
   */
  constructor(
    private readonly legacyAdapter: ExpressionEngineAdapter = celLegacyAdapter,
    private readonly v2Adapter: ExpressionEngineAdapter = celV2Adapter,
  ) {}

  /**
   * The runtime for a function registry: both dialects call the functions it
   * lists, through the same argument, result and failure rules. One runtime
   * per registry, cached, so every caller shares its compiled environments.
   * The built-ins-only registry gets the default adapters.
   */
  static withFunctions(
    registry: BPMExpressionFunctionRegistry,
  ): ExpressionRuntime {
    if (registry === BUILT_IN_EXPRESSION_FUNCTION_REGISTRY) {
      return new ExpressionRuntime();
    }

    const cached = runtimesByRegistry.get(registry);

    if (cached) {
      return cached;
    }

    const runtime = new ExpressionRuntime(
      createCelLegacyAdapter(registry),
      createCelV2Adapter(registry),
    );

    runtimesByRegistry.set(registry, runtime);

    return runtime;
  }

  /**
   * Compiles with the dialect's engine. This is also what loads that engine,
   * so callers that compile before starting a budget never have an interrupt
   * land inside module loading.
   */
  compile(
    expression: string,
    label: string,
    dialect: ExpressionDialect = DEFAULT_EXPRESSION_DIALECT,
  ): ExpressionHandle {
    const handle = this.readAdapter(dialect, label).compile(expression);

    if (handle === null) {
      throw new ExpressionRuntimeError('EXPRESSION_SYNTAX_ERROR', label);
    }

    return handle;
  }

  evaluate(request: ExpressionEvalRequest): JsonValue {
    const dialect = request.dialect ?? DEFAULT_EXPRESSION_DIALECT;
    const adapter = this.readAdapter(dialect, request.label);
    const handle = this.compile(request.expression, request.label, dialect);
    const timeoutMs = request.budget.nextTimeoutMs();

    // Below one whole millisecond nothing useful can run, and `vm` would reject
    // the timeout as a range error rather than report an exhausted budget.
    if (timeoutMs < 1) {
      const exhausted = new ExpressionRuntimeError(
        'EXPRESSION_BUDGET_EXCEEDED',
        request.label,
      );

      this.logFailure(exhausted, dialect, performance.now());

      throw exhausted;
    }

    const startedAt = performance.now();

    try {
      const raw = runWithinTimeBudget(
        () => adapter.evaluate(handle, request.roots),
        timeoutMs,
      );

      return normalizeExpressionResult(
        raw,
        request.label,
        DEFAULT_EXPRESSION_RESULT_LIMITS,
      );
    } catch (error: unknown) {
      const mapped = toExpressionRuntimeError(
        error,
        request.label,
        request.expression,
      );

      this.logFailure(mapped, dialect, startedAt);

      throw mapped;
    } finally {
      request.budget.record(performance.now() - startedAt);
    }
  }

  private readAdapter(
    dialect: ExpressionDialect,
    label: string,
  ): ExpressionEngineAdapter {
    switch (dialect) {
      case 'cel-legacy':
        return this.legacyAdapter;
      case 'cel-v2':
        return this.v2Adapter;
      default:
        // Unreachable for typed callers; a value cast or read from storage
        // could still get here, and is refused rather than guessed at.
        throw new ExpressionRuntimeError('EXPRESSION_SYNTAX_ERROR', label, {
          detail: 'names an unknown expression dialect',
        });
    }
  }

  /**
   * Logs only the label, the dialect, the code and the elapsed time. The message, the key
   * name and the expression are not logged: they can carry case data.
   */
  private logFailure(
    error: ExpressionRuntimeError,
    dialect: ExpressionDialect,
    startedAt: number,
  ): void {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const line = `label=${error.label} dialect=${dialect} code=${error.code} elapsedMs=${elapsedMs}`;

    if (error.code === 'EXPRESSION_BUDGET_EXCEEDED') {
      logger.warn(line);

      return;
    }

    logger.debug(line);
  }
}
