import { types } from 'node:util';
import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  BPM_EXPRESSION_FUNCTION_NAME_PATTERN,
  type BPMExpressionFunctionDescriptor,
  type BPMExpressionFunctionParameter,
  type BPMExpressionValueType,
} from '@rytass/bpm-core-shared';
import { BPM_BUILT_IN_EXPRESSION_FUNCTIONS } from './expression-function.built-ins';
import type {
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from './expression-function.types';

/** Every value type a parameter or a result may declare (ADR 22 §3.5). */
export const BPM_EXPRESSION_VALUE_TYPES: readonly BPMExpressionValueType[] =
  Object.freeze([
    'bool',
    'double',
    'dyn',
    'int',
    'list',
    'map',
    'null',
    'string',
  ]);

const VALUE_TYPES: ReadonlySet<string> = new Set(BPM_EXPRESSION_VALUE_TYPES);
const BUILT_IN_NAMES: ReadonlySet<string> = new Set(
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
);
const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/*
 * cel-js 0.8.2 (cel-legacy) lexes `true`, `false` and `null` without a word
 * boundary and ahead of identifiers, so `nullable_v1(1)` is read as `null`
 * followed by `able_v1` — a syntax error. cel-v2 has no such problem, but a
 * host function must work in both dialects, so the name is refused here.
 * (`in` is lexed with a boundary; `inRange_v1` is fine.)
 */
const CEL_LEGACY_KEYWORD_PREFIX = /^(?:true|false|null)/u;

/*
 * `async function`, `function*` and `async function*` all return something a
 * synchronous evaluation cannot use.
 *
 * The primary check is the engine's own function kind (`util.types`): it is
 * fixed when the function is created, so neither `Object.setPrototypeOf` nor
 * an own `Symbol.toStringTag` changes it, and it holds across realms. It does
 * not see through `bind`, so the prototype chain is checked too: every such
 * function inherits from the intrinsic `AsyncFunction.prototype`,
 * `GeneratorFunction.prototype` or `AsyncGeneratorFunction.prototype` of this
 * realm, and a bound copy keeps that prototype. The tag is a last check for a
 * bound handler from another realm.
 *
 * A bound copy whose prototype was also moved to `Function.prototype` and
 * re-tagged still passes all three; such a handler returns a promise, which
 * the call wrapper refuses as `EXPRESSION_FUNCTION_FAILED` (fail closed).
 */
const REFUSED_FUNCTION_PROTOTYPES: readonly object[] = [
  Object.getPrototypeOf(async (): Promise<void> => undefined) as object,
  Object.getPrototypeOf(function* refusedGenerator(): Generator<never> {
    // Never called: only its prototype is read.
  }) as object,
  Object.getPrototypeOf(
    async function* refusedAsyncGenerator(): AsyncGenerator<never> {
      // Never called: only its prototype is read.
    },
  ) as object,
  // A build that compiled these down to plain functions would yield
  // `Function.prototype`, which every handler inherits from: never compare to it.
].filter((prototype) => prototype !== Function.prototype);

const REFUSED_FUNCTION_TAGS: ReadonlySet<string> = new Set([
  '[object AsyncFunction]',
  '[object AsyncGeneratorFunction]',
  '[object GeneratorFunction]',
]);

const isAsyncOrGenerator = (handler: object): boolean =>
  types.isAsyncFunction(handler) ||
  types.isGeneratorFunction(handler) ||
  REFUSED_FUNCTION_PROTOTYPES.some((prototype) =>
    Object.prototype.isPrototypeOf.call(prototype, handler),
  ) ||
  REFUSED_FUNCTION_TAGS.has(Object.prototype.toString.call(handler));

const PREFIX = '[@rytass/bpm-core-nestjs-module]';

const refuse = (name: string, reason: string): never => {
  throw new Error(`${PREFIX} Expression function "${name}" ${reason}.`);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readDisplayName = (candidate: unknown, index: number): string =>
  isRecord(candidate) && typeof candidate.name === 'string'
    ? candidate.name
    : `#${index}`;

const readParameter = (
  name: string,
  candidate: unknown,
  index: number,
): BPMExpressionFunctionParameter => {
  if (!isRecord(candidate)) {
    return refuse(name, `has parameter ${index} that is not an object`);
  }

  if (
    typeof candidate.name !== 'string' ||
    !PARAMETER_NAME_PATTERN.test(candidate.name)
  ) {
    return refuse(name, `has parameter ${index} without a valid name`);
  }

  if (typeof candidate.type !== 'string' || !VALUE_TYPES.has(candidate.type)) {
    return refuse(
      name,
      `declares parameter "${candidate.name}" with an unsupported type (expected one of ${BPM_EXPRESSION_VALUE_TYPES.join(', ')})`,
    );
  }

  const { description } = candidate;

  if (description !== undefined && typeof description !== 'string') {
    return refuse(
      name,
      `declares parameter "${candidate.name}" with a description that is not a string`,
    );
  }

  return Object.freeze({
    ...(typeof description === 'string' ? { description } : {}),
    name: candidate.name,
    type: candidate.type as BPMExpressionValueType,
  });
};

/**
 * Checks one host function and returns a frozen copy of it. Throws a plain
 * `Error` naming the function and the reason; the host's boot fails with it.
 * Uniqueness across the list is checked by {@link validateExpressionFunctions}.
 */
const validateExpressionFunction = (
  candidate: unknown,
  index: number,
): BPMExpressionFunction => {
  const displayName = readDisplayName(candidate, index);

  if (!isRecord(candidate)) {
    return refuse(displayName, 'is not an object');
  }

  const { description, handler, label, name, parameters, returnType } =
    candidate;

  if (typeof name !== 'string') {
    return refuse(displayName, 'has no name');
  }

  if (BUILT_IN_NAMES.has(name)) {
    return refuse(name, 'uses the name of a built-in function');
  }

  // The pattern also keeps a host name clear of every cel-v2 built-in and CEL
  // keyword: none of them ends in `_v<digits>`.
  if (!BPM_EXPRESSION_FUNCTION_NAME_PATTERN.test(name)) {
    return refuse(
      name,
      'has an invalid name (lower camel segments joined by "_", ending in a version such as "_v1")',
    );
  }

  if (CEL_LEGACY_KEYWORD_PREFIX.test(name)) {
    return refuse(
      name,
      'starts with "true", "false" or "null", which cel-legacy reads as a keyword; such a name can never be called there',
    );
  }

  if (typeof handler !== 'function') {
    return refuse(name, 'has no handler function');
  }

  if (isAsyncOrGenerator(handler)) {
    return refuse(
      name,
      'has an async or generator handler; handlers must be synchronous',
    );
  }

  if (typeof label !== 'string' || !label.trim()) {
    return refuse(name, 'has no label');
  }

  if (typeof description !== 'string') {
    return refuse(name, 'has no description');
  }

  if (!Array.isArray(parameters)) {
    return refuse(name, 'has no parameter list');
  }

  if (typeof returnType !== 'string' || !VALUE_TYPES.has(returnType)) {
    return refuse(
      name,
      `declares an unsupported return type (expected one of ${BPM_EXPRESSION_VALUE_TYPES.join(', ')})`,
    );
  }

  const checkedParameters = Object.freeze(
    (parameters as readonly unknown[]).map(
      (parameter: unknown, parameterIndex: number) =>
        readParameter(name, parameter, parameterIndex),
    ),
  );
  const parameterNames = checkedParameters.map((parameter) => parameter.name);

  if (new Set(parameterNames).size !== parameterNames.length) {
    return refuse(name, 'declares the same parameter name twice');
  }

  return Object.freeze({
    description,
    handler: handler as BPMExpressionFunction['handler'],
    label,
    name,
    parameters: checkedParameters,
    returnType: returnType as BPMExpressionValueType,
  });
};

/**
 * Validates every host function (ADR 22 §3.5) and returns frozen copies:
 * the name matches `BPM_EXPRESSION_FUNCTION_NAME_PATTERN` and is neither a
 * built-in nor registered twice; the handler is a plain synchronous function;
 * every parameter and the result declare a supported type.
 *
 * Throws a plain `Error` naming the function and the reason, so a host that
 * registers a bad function does not boot.
 */
export const validateExpressionFunctions = (
  functions: readonly unknown[],
): readonly BPMExpressionFunction[] => {
  if (!Array.isArray(functions)) {
    throw new Error(
      `${PREFIX} Expression functions must be given as an array.`,
    );
  }

  const checked = functions.map(validateExpressionFunction);

  checked.reduce<ReadonlySet<string>>((seen, fn) => {
    if (seen.has(fn.name)) {
      refuse(fn.name, 'is registered more than once');
    }

    return new Set([...seen, fn.name]);
  }, new Set());

  return Object.freeze(checked);
};

const toDescriptor = (
  fn: BPMExpressionFunction,
  builtIn: boolean,
): BPMExpressionFunctionDescriptor =>
  Object.freeze({
    builtIn,
    description: fn.description,
    label: fn.label,
    name: fn.name,
    parameters: fn.parameters,
    returnType: fn.returnType,
  });

const BUILT_INS: readonly BPMExpressionFunction[] = validateBuiltIns();

/**
 * The built-ins go through the same shape checks as host functions, except
 * the name rule they are exempt from, so a mistake in them fails at import.
 */
function validateBuiltIns(): readonly BPMExpressionFunction[] {
  return Object.freeze(
    BPM_BUILT_IN_EXPRESSION_FUNCTIONS.map((fn): BPMExpressionFunction =>
      Object.freeze({
        ...fn,
        parameters: Object.freeze(
          fn.parameters.map((parameter, index) =>
            readParameter(fn.name, parameter, index),
          ),
        ),
      }),
    ),
  );
}

/**
 * A fixed set of functions: the nine built-ins plus the host functions given
 * at construction, validated there. Lookups are by own key only, so a name
 * such as `constructor` or `toString` is never found on a prototype.
 */
export class StaticBPMExpressionFunctionRegistry implements BPMExpressionFunctionRegistry {
  private readonly functions: ReadonlyMap<string, BPMExpressionFunction>;
  private readonly descriptors: readonly BPMExpressionFunctionDescriptor[];

  constructor(hostFunctions: readonly BPMExpressionFunction[] = []) {
    const host = validateExpressionFunctions(hostFunctions);

    this.functions = new Map(
      [...BUILT_INS, ...host].map(
        (fn): readonly [string, BPMExpressionFunction] => [fn.name, fn],
      ),
    );
    this.descriptors = Object.freeze([
      ...BUILT_INS.map((fn) => toDescriptor(fn, true)),
      ...host.map((fn) => toDescriptor(fn, false)),
    ]);
  }

  get(name: string): BPMExpressionFunction | null {
    return this.functions.get(name) ?? null;
  }

  list(): readonly BPMExpressionFunctionDescriptor[] {
    return this.descriptors;
  }

  assertPublishable(names: readonly string[]): readonly string[] {
    return [...new Set(names)].filter((name) => !this.functions.has(name));
  }
}

/** Only the nine built-ins: what BPM uses when the host registers no function. */
export class EmptyBPMExpressionFunctionRegistry extends StaticBPMExpressionFunctionRegistry {
  constructor() {
    super([]);
  }
}

/**
 * The shared built-ins-only registry. Evaluation falls back to it wherever no
 * registry was handed in, so the built-ins are always available.
 */
export const BUILT_IN_EXPRESSION_FUNCTION_REGISTRY: BPMExpressionFunctionRegistry =
  new EmptyBPMExpressionFunctionRegistry();
