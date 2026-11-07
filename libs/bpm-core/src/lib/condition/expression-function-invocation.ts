import { Logger } from '@nestjs/common';
import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  BPM_EXPRESSION_FUNCTION_NAME_PATTERN,
  type BPMExpressionValue,
  type BPMExpressionValueType,
} from '@rytass/bpm-core-shared';
import { BPM_EXPRESSION_VALUE_TYPES } from '../expression-function/expression-function.registry';
import type {
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { ExpressionEngineFailure } from './expression-engine-failure';
import type { ExpressionDialect } from './expression-dialect';
import {
  DEFAULT_EXPRESSION_RESULT_LIMITS,
  type JsonValue,
  normalizeExpressionResult,
} from './expression-result.walker';

/*
 * The one place a function an expression calls is run (ADR 22 §3.5). Both
 * engine adapters register the wrappers built here, so the two dialects share
 * one set of rules:
 *
 * - arguments become fresh deep-frozen JSON copies (the walker), so a handler
 *   can never reach `formData`; writing to one throws `TypeError` in strict mode;
 * - an argument that does not fit the declared parameter type is
 *   `EXPRESSION_TYPE_ERROR`, as the engine reports an overload mismatch;
 * - a handler that throws, returns a thenable, or returns something that is
 *   not JSON or not its `returnType` is `EXPRESSION_FUNCTION_FAILED`, and its
 *   message is never kept: only the function name and the code are logged;
 * - the handler runs inside the evaluation, so its time is charged to the
 *   expression budget and a handler that does not finish is interrupted
 *   (`EXPRESSION_BUDGET_EXCEEDED`, the interrupt skips every catch here).
 */

const logger = new Logger('ExpressionFunction');

type FailureReason = 'invalid-result' | 'return-type' | 'thenable' | 'threw';

/**
 * Per-evaluation record of whether any function failed. cel-v2's `||`, `&&`
 * and `exists` absorb an error when the other side decides the result, as CEL
 * specifies (docs/24 §1). A host function failure must not vanish that way:
 * the evaluation is failed afterwards whatever it returned.
 *
 * Evaluations are synchronous, so one slot is enough. It is replaced at the
 * start of every evaluation rather than relied on to be cleared: a budget
 * interrupt skips `finally` blocks, and a stale frame must never be read.
 */
interface ExpressionFunctionCallFrame {
  failed: boolean;
}

let activeFrame: ExpressionFunctionCallFrame | null = null;

/**
 * Runs one engine evaluation and fails it with `EXPRESSION_FUNCTION_FAILED`
 * when any function it called failed, even if the engine absorbed that error.
 */
export const runWithExpressionFunctionFrame = <TResult>(
  work: () => TResult,
): TResult => {
  const previous = activeFrame;
  // Mutable on purpose: the wrappers below flag it while the engine runs.
  const frame: ExpressionFunctionCallFrame = { failed: false };

  activeFrame = frame;

  try {
    const result = work();

    if (frame.failed) {
      throw new ExpressionEngineFailure('EXPRESSION_FUNCTION_FAILED');
    }

    return result;
  } catch (error: unknown) {
    if (frame.failed) {
      throw new ExpressionEngineFailure('EXPRESSION_FUNCTION_FAILED');
    }

    throw error;
  } finally {
    activeFrame = previous;
  }
};

const failFunction = (name: string, reason: FailureReason): never => {
  if (activeFrame !== null) {
    activeFrame.failed = true;
  }

  // The name is the host's validated identifier and the reason a fixed word;
  // neither the handler's message nor any argument is ever written.
  logger.warn(
    `function=${name} code=EXPRESSION_FUNCTION_FAILED reason=${reason}`,
  );

  throw new ExpressionEngineFailure('EXPRESSION_FUNCTION_FAILED');
};

const refuseArgument = (): never => {
  throw new ExpressionEngineFailure('EXPRESSION_TYPE_ERROR');
};

const isPlainMap = (value: JsonValue): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a JSON value is of a declared type. `dyn` accepts any JSON value. */
const isOfType = (value: JsonValue, type: BPMExpressionValueType): boolean => {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'double':
      return typeof value === 'number';
    case 'dyn':
      return true;
    case 'int':
      return typeof value === 'number' && Number.isInteger(value);
    case 'list':
      return Array.isArray(value);
    case 'map':
      return isPlainMap(value);
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    default:
      return false;
  }
};

/**
 * One argument as the handler sees it: a fresh deep-frozen JSON copy (cel-v2
 * `int`s become JS numbers). A value that is not JSON — cel-v2 bytes, a
 * timestamp, a value beyond the result limits — is a type error at the call.
 */
const readArgument = (
  name: string,
  raw: unknown,
  type: BPMExpressionValueType,
): BPMExpressionValue => {
  let value: JsonValue;

  try {
    value = normalizeExpressionResult(
      raw,
      name,
      DEFAULT_EXPRESSION_RESULT_LIMITS,
    );
  } catch {
    return refuseArgument();
  }

  return isOfType(value, type) ? value : refuseArgument();
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { readonly then?: unknown }).then === 'function';

const ignoreRejection = (): void => undefined;

/**
 * Marks a native promise's rejection as handled, so a rejection nobody awaits
 * does not become an unhandled rejection in the host process.
 *
 * Only a real promise is touched, and through the intrinsic
 * `Promise.prototype.then`: its brand check throws for anything else before
 * any host code runs, and an own `then` the host put on a promise is never
 * called. A foreign thenable is deliberately not adopted — `Promise.resolve`
 * would call its `then` in a later microtask, after the evaluation and outside
 * the budget, where it could block the event loop for as long as it likes.
 * Whatever does run here (a promise subclass's species constructor) runs now,
 * inside the evaluation and its budget.
 */
const silenceNativeRejection = (value: unknown): void => {
  try {
    Reflect.apply(Promise.prototype.then, value, [undefined, ignoreRejection]);
  } catch {
    // Not a native promise, or a subclass that refused: nothing to silence.
  }
};

/**
 * What the engine gets back: the checked JSON result, with a declared `int`
 * turned into a `bigint` for cel-v2, whose `int` is a `bigint` (a JS number
 * there is a `double`, and `int` results would silently compare unequal).
 */
const toEngineValue = (
  value: JsonValue,
  returnType: BPMExpressionValueType,
  dialect: ExpressionDialect,
): unknown =>
  dialect === 'cel-v2' && returnType === 'int' && typeof value === 'number'
    ? BigInt(value)
    : value;

/**
 * Wraps a registered function for one dialect's engine. The wrapper is what
 * the engine calls; the handler only ever sees checked, frozen arguments.
 */
export const createExpressionFunctionInvoker =
  (fn: BPMExpressionFunction, dialect: ExpressionDialect) =>
  (...rawArgs: readonly unknown[]): unknown => {
    // cel-v2 enforces arity through the registered signature; cel-legacy
    // passes whatever was written.
    if (rawArgs.length !== fn.parameters.length) {
      return refuseArgument();
    }

    const args = rawArgs.map((raw, index) =>
      readArgument(fn.name, raw, fn.parameters[index].type),
    );
    let raw: unknown;
    let thenable: boolean;

    try {
      raw = Reflect.apply(fn.handler, undefined, args);
      // Inside the `try`: reading `then` can run a host getter.
      thenable = isThenable(raw);
    } catch {
      // Whatever the handler threw — a `TypeError` from writing to a frozen
      // argument, a host error, even an `ExpressionRuntimeError` that would
      // otherwise pass through with its own label and code — becomes one code.
      return failFunction(fn.name, 'threw');
    }

    if (thenable) {
      // Nobody will await it; without a handler a later rejection would be an
      // unhandled rejection in the host process.
      silenceNativeRejection(raw);

      return failFunction(fn.name, 'thenable');
    }

    let value: JsonValue;

    try {
      value = normalizeExpressionResult(
        raw,
        fn.name,
        DEFAULT_EXPRESSION_RESULT_LIMITS,
      );
    } catch {
      return failFunction(fn.name, 'invalid-result');
    }

    return isOfType(value, fn.returnType)
      ? toEngineValue(value, fn.returnType, dialect)
      : failFunction(fn.name, 'return-type');
  };

/** The functions of one registry, read once. */
export interface ExpressionFunctionTable {
  readonly functions: readonly BPMExpressionFunction[];
  readonly names: ReadonlySet<string>;
}

const tables = new WeakMap<
  BPMExpressionFunctionRegistry,
  ExpressionFunctionTable
>();

type RegistryFailureReason = 'registry-shape' | 'registry-threw';

/** Thrown inside the table read when the registry answered out of shape. */
class RegistryShapeError extends Error {}

const VALUE_TYPES: ReadonlySet<string> = new Set(BPM_EXPRESSION_VALUE_TYPES);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refuseShape = (): never => {
  throw new RegistryShapeError();
};

const readValueType = (value: unknown): BPMExpressionValueType =>
  typeof value === 'string' && VALUE_TYPES.has(value)
    ? (value as BPMExpressionValueType)
    : refuseShape();

/**
 * A frozen copy of what `get` returned for `name`, or a shape refusal. The
 * copy is what the wrappers read, so a registry that changes the object it
 * returned later changes nothing here.
 */
const readRegisteredFunction = (
  candidate: unknown,
  name: string,
): BPMExpressionFunction => {
  if (!isRecord(candidate) || candidate.name !== name) {
    return refuseShape();
  }

  const { description, handler, label, parameters, returnType } = candidate;

  if (typeof handler !== 'function' || !Array.isArray(parameters)) {
    return refuseShape();
  }

  return Object.freeze({
    description: typeof description === 'string' ? description : '',
    handler: handler as BPMExpressionFunction['handler'],
    label: typeof label === 'string' ? label : name,
    name,
    parameters: Object.freeze(
      (parameters as readonly unknown[]).map((parameter: unknown) =>
        isRecord(parameter) && typeof parameter.name === 'string'
          ? Object.freeze({
              name: parameter.name,
              type: readValueType(parameter.type),
            })
          : refuseShape(),
      ),
    ),
    returnType: readValueType(returnType),
  });
};

const failRegistry = (reason: RegistryFailureReason): never => {
  logger.warn(`code=EXPRESSION_FUNCTION_FAILED reason=${reason}`);

  throw new ExpressionEngineFailure('EXPRESSION_FUNCTION_FAILED');
};

const readListedNames = (listed: unknown): readonly string[] => {
  if (!Array.isArray(listed)) {
    return refuseShape();
  }

  const names = (listed as readonly unknown[]).map((descriptor: unknown) =>
    isRecord(descriptor) &&
    typeof descriptor.name === 'string' &&
    isRegistryFunctionName(descriptor.name)
      ? descriptor.name
      : refuseShape(),
  );

  // A name listed twice would register two overloads of one signature.
  return new Set(names).size === names.length ? names : refuseShape();
};

/**
 * Reads every function a registry lists, through `get`, once per registry.
 *
 * The registry is host code (a host may provide its own under
 * `BPM_EXPRESSION_FUNCTION_REGISTRY`). If `list` or `get` throws, or answers
 * out of shape — not a list, a name that is not a function name or is listed
 * twice, `null` for a listed name, an object without a handler or with an
 * unknown type — the evaluation fails with `EXPRESSION_FUNCTION_FAILED`. The
 * host's message is never kept: only a fixed reason is logged. A failure is
 * not cached, so the next evaluation asks the registry again.
 */
export const readExpressionFunctionTable = (
  registry: BPMExpressionFunctionRegistry,
): ExpressionFunctionTable => {
  const cached = tables.get(registry);

  if (cached) {
    return cached;
  }

  let functions: readonly BPMExpressionFunction[];

  try {
    functions = Object.freeze(
      readListedNames(registry.list()).map((name) =>
        readRegisteredFunction(registry.get(name), name),
      ),
    );
  } catch (error: unknown) {
    return failRegistry(
      error instanceof RegistryShapeError ? 'registry-shape' : 'registry-threw',
    );
  }

  const table: ExpressionFunctionTable = Object.freeze({
    functions,
    names: new Set(functions.map((fn) => fn.name)),
  });

  tables.set(registry, table);

  return table;
};

const BUILT_IN_NAMES: ReadonlySet<string> = new Set(
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
);

/**
 * Whether a called name is one a registry decides: shaped like a host function
 * (`…_vN`) or one of the nine built-ins. The engine's own functions (`size`,
 * `int`, `matches`, …) never are, and neither is any other unknown name, which
 * keeps the engine's own error (`EXPRESSION_TYPE_ERROR`) at evaluation and is
 * refused outright by the publish lint (docs/24 §2.1, 2026-11-07).
 *
 * The publish lint, the rollback check and {@link callsUnavailableFunction}
 * all read this one rule.
 */
export const isRegistryFunctionName = (name: string): boolean =>
  BUILT_IN_NAMES.has(name) || BPM_EXPRESSION_FUNCTION_NAME_PATTERN.test(name);

/**
 * Whether an expression calls a function the registry does not have — a host
 * function withdrawn after the version was published, or a built-in a custom
 * registry left out. Only names {@link isRegistryFunctionName} accepts count:
 * any other unknown name keeps the engine's own error, as before functions
 * existed. The caller fails the evaluation with `EXPRESSION_FUNCTION_FAILED`
 * before the engine runs, so the outcome does not depend on which branch the
 * engine would have reached.
 */
export const callsUnavailableFunction = (
  calledNames: readonly string[],
  table: ExpressionFunctionTable,
): boolean =>
  calledNames.some(
    (name) => isRegistryFunctionName(name) && !table.names.has(name),
  );
