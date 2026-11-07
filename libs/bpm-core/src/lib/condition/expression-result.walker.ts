import { ExpressionRuntimeError } from './expression-errors';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ExpressionResultLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  /** Upper bound on the size the value would have as JSON, estimated while walking. */
  readonly maxBytes: number;
}

export const DEFAULT_EXPRESSION_RESULT_LIMITS: ExpressionResultLimits = {
  maxBytes: 64 * 1024,
  maxDepth: 32,
  maxNodes: 10_000,
};

// Writing these as object keys would let a result reach a prototype when a
// consumer merges it. Rejected at any depth where they are own keys of the
// value the engine returned. What reaches the walker depends on the engine
// (verified on both real engines 2026-11-07; differential corpus P43–P45):
// - cel-legacy (cel-js 0.8.2) builds a map literal by assignment, so
//   `{"constructor": 1}` arrives with that own key and is refused here, and
//   `{"__proto__": {...}}` swaps the prototype and is refused by
//   `isPlainObject`.
// - cel-v2 (@marcbachmann/cel-js 8.0.0) drops all three keys while building
//   the map, so `{"constructor": 1}` arrives as `{}` and nothing is refused:
//   no pollution, but the key is lost silently instead of failing closed.
//   Refusing it needs the AST, which is P2's (docs/24 §2.5).
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const NUMBER_BYTES = 24;
const LITERAL_BYTES = 5;
const KEY_OVERHEAD_BYTES = 4;

/**
 * A map the walker may copy: its prototype is `Object.prototype` or `null`, and
 * it is neither `Object.prototype` itself nor an array. `Object.prototype` has a `null`
 * prototype, so without the second check an engine that handed back the shared
 * prototype would have it accepted as an empty map.
 */
const isPlainObject = (value: object): boolean => {
  // An array whose prototype was swapped for Object.prototype is still an
  // array exotic object; it is refused, not copied as a map of indexes.
  if (value === Object.prototype || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

/**
 * A list the walker may copy: a real array whose prototype is
 * `Array.prototype`. `Array.isArray` alone also accepts `Array.prototype`
 * itself, arrays from another realm and arrays whose prototype was replaced.
 */
const isPlainArray = (value: object): boolean =>
  Array.isArray(value) &&
  value !== Array.prototype &&
  Object.getPrototypeOf(value) === Array.prototype;

/**
 * Reads an own property without running code. An accessor is refused rather
 * than called: a getter would run outside the time budget, and what it returns
 * could differ from one read to the next.
 */
const readDataProperty = (
  value: object,
  key: string,
  refuse: () => never,
): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  return descriptor && 'value' in descriptor ? descriptor.value : refuse();
};

/**
 * Turns whatever an engine returned into a fresh, deep-frozen JSON value, or
 * throws `EXPRESSION_INVALID_RESULT`. Functions, promises, class instances,
 * `undefined`, non-finite numbers and out-of-range integers are all refused. The
 * size is estimated while walking, not with `JSON.stringify`, so a huge shared
 * string cannot cost much before it is refused.
 */
export const normalizeExpressionResult = (
  raw: unknown,
  label: string,
  limits: ExpressionResultLimits = DEFAULT_EXPRESSION_RESULT_LIMITS,
): JsonValue => {
  // Mutable on purpose: one ledger spans the whole walk, and returning the
  // counts from every recursive call would make the walker harder to read.
  const ledger = { bytes: 0, nodes: 0 };
  const refuse = (): never => {
    throw new ExpressionRuntimeError('EXPRESSION_INVALID_RESULT', label);
  };
  const charge = (bytes: number): void => {
    ledger.bytes += bytes;

    if (ledger.bytes > limits.maxBytes) {
      refuse();
    }
  };

  const walk = (value: unknown, depth: number): JsonValue => {
    if (depth > limits.maxDepth) {
      refuse();
    }

    ledger.nodes += 1;

    if (ledger.nodes > limits.maxNodes) {
      refuse();
    }

    if (value === null) {
      charge(LITERAL_BYTES);

      return null;
    }

    if (typeof value === 'boolean') {
      charge(LITERAL_BYTES);

      return value;
    }

    if (typeof value === 'number') {
      // Every double beyond 2^53 is an integer, so this is exactly the out-of-
      // safe-range case. cel-legacy returns numbers, not bigints, so this is the
      // branch that actually sees an oversized integer result.
      if (
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER
      ) {
        refuse();
      }

      charge(NUMBER_BYTES);

      return value;
    }

    if (typeof value === 'bigint') {
      if (
        value > BigInt(Number.MAX_SAFE_INTEGER) ||
        value < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        refuse();
      }

      charge(NUMBER_BYTES);

      return Number(value);
    }

    if (typeof value === 'string') {
      // UTF-8 never takes fewer bytes than UTF-16 code units, so a string longer
      // than the whole allowance is refused before its bytes are counted.
      if (value.length > limits.maxBytes - ledger.bytes) {
        refuse();
      }

      charge(Buffer.byteLength(value, 'utf8'));

      return value;
    }

    if (typeof value === 'object' && isPlainArray(value)) {
      const list = value as readonly unknown[];

      // Indexes are read as data properties, so a getter on an index (or a hole
      // that would read through to the prototype) is refused, not run.
      return Object.freeze(
        Array.from(
          { length: list.length },
          (_item: unknown, index: number): JsonValue =>
            walk(readDataProperty(list, String(index), refuse), depth + 1),
        ),
      );
    }

    if (typeof value === 'object' && value !== null && isPlainObject(value)) {
      // Symbol keys cannot be written as JSON; a value that carries one is not
      // the plain map it looks like.
      if (Object.getOwnPropertySymbols(value).length > 0) {
        refuse();
      }

      const entries = Object.keys(value).map((key): [string, JsonValue] => {
        if (FORBIDDEN_KEYS.has(key)) {
          refuse();
        }

        charge(Buffer.byteLength(key, 'utf8') + KEY_OVERHEAD_BYTES);

        return [key, walk(readDataProperty(value, key, refuse), depth + 1)];
      });

      return Object.freeze(Object.fromEntries(entries));
    }

    return refuse();
  };

  return walk(raw, 0);
};
