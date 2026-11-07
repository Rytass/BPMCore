import type { ParseResult } from 'cel-js';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from '../../expression-function/expression-function.registry';
import type { BPMExpressionFunctionRegistry } from '../../expression-function/expression-function.types';
import { ExpressionEngineFailure } from '../expression-engine-failure';
import {
  callsUnavailableFunction,
  createExpressionFunctionInvoker,
  readExpressionFunctionTable,
  runWithExpressionFunctionFrame,
} from '../expression-function-invocation';
import type {
  ExpressionEngineAdapter,
  ExpressionHandle,
} from '../expression-runtime';

type CelLegacyFunction = (...args: readonly unknown[]) => unknown;

/**
 * The slice of `cel-js` this adapter uses. The third `evaluate` argument is
 * the function table: `cel-js` 0.8.2 merges it over its own `has` and `size`
 * and calls an entry for every global call (`round(x)`), with the evaluated
 * arguments. Methods (`x.round()`) never reach it.
 */
interface CelEngine {
  readonly evaluate: (
    cst: unknown,
    context: Readonly<Record<string, unknown>>,
    functions?: Readonly<Record<string, CelLegacyFunction>>,
  ) => unknown;
  readonly parse: (expression: string) => ParseResult;
}

let celEngine: CelEngine | null = null;

/**
 * Loads `cel-js` on first use rather than when this module is imported.
 *
 * `cel-js` is ESM-only and its `chevrotain` dependency ships an exports map
 * that `jest-resolve` cannot follow. While the import sat at the top of this
 * file, the package root pulled it in through
 * `index → bpm-root → delegation → condition`, so *any* consumer test that
 * imported anything from `@rytass/bpm-core-nestjs-module` failed to load with
 * `Cannot find module 'chevrotain'` — pointing deep into `node_modules`, far
 * from the code under test. Hosts had to stub `cel-js` before they could write
 * a single test.
 *
 * Deferring the load means a host that never evaluates a CEL expression never
 * resolves the package at all. `require` (not `await import`) keeps every
 * caller in this file synchronous.
 *
 * The engine is loaded before a budget starts, so an interrupt can never land
 * halfway through loading a module.
 */
export function loadCelEngine(): CelEngine {
  if (celEngine === null) {
    try {
      celEngine = require('cel-js') as CelEngine;
    } catch (error: unknown) {
      // Deferring the load also defers this failure: it used to surface at
      // boot as a bare ERR_REQUIRE_ESM, and would now surface as a 500 on
      // whichever request first evaluated a condition. Name the cause where it
      // is thrown.
      if (isRequireEsmError(error)) {
        throw new Error(
          `[@rytass/bpm-core-nestjs-module] This Node version cannot require the ESM-only 'cel-js'. BPM needs Node >=20.19 or >=22.12 to evaluate CEL conditions. Original error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      throw error;
    }
  }

  return celEngine;
}

function isRequireEsmError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ERR_REQUIRE_ESM'
  );
}

/**
 * Parses with `cel-js`. Returns `null` when the expression does not parse.
 *
 * `cel-js` can throw instead of reporting failure: a deeply nested expression
 * (about 200 levels, still under the length limit) overflows the parser's stack
 * with a bare `RangeError`. That is a syntax refusal, not a crash, so it maps to
 * `null`. The engine is loaded outside the `try`: a failure to load it is a
 * configuration error and must not be reported as a bad expression.
 */
export function parseCelLegacy(expression: string): ExpressionHandle | null {
  const engine = loadCelEngine();
  let parseResult: ParseResult;

  try {
    parseResult = engine.parse(expression);
  } catch {
    return null;
  }

  return parseResult.isSuccess ? { native: parseResult.cst } : null;
}

interface CstNodeShape {
  readonly children: Readonly<Record<string, readonly unknown[]>>;
  readonly name: string;
}

const isCstNode = (value: unknown): value is CstNodeShape =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { readonly name?: unknown }).name === 'string' &&
  typeof (value as { readonly children?: unknown }).children === 'object' &&
  (value as { readonly children?: unknown }).children !== null;

const readTokenImage = (token: unknown): string | null =>
  typeof token === 'object' &&
  token !== null &&
  typeof (token as { readonly image?: unknown }).image === 'string'
    ? (token as { readonly image: string }).image
    : null;

/**
 * Names of the global functions a `cel-js` CST calls: its `macrosExpression`
 * nodes, which is where `cel-js` looks a global call up in the function table.
 * Anything that is not a CST node yields nothing, so the jest shim's stand-in
 * CST simply has no calls.
 */
const readCalledFunctionNames = (node: unknown): readonly string[] => {
  if (!isCstNode(node)) {
    return [];
  }

  const identifier =
    node.name === 'macrosExpression'
      ? readTokenImage(node.children.Identifier?.[0])
      : null;

  return [
    ...(identifier === null ? [] : [identifier]),
    ...Object.values(node.children).flatMap((children) =>
      children.flatMap(readCalledFunctionNames),
    ),
  ];
};

const celLegacyFunctionTables = new WeakMap<
  BPMExpressionFunctionRegistry,
  Readonly<Record<string, CelLegacyFunction>>
>();

/**
 * The function table handed to `cel-js` for a registry, built once: every
 * function the registry lists, wrapped for cel-legacy. Verified on the real
 * engine (2026-11-07): `cel-js` 0.8.2 accepts the table and calls it.
 */
const readCelLegacyFunctions = (
  registry: BPMExpressionFunctionRegistry,
): Readonly<Record<string, CelLegacyFunction>> => {
  const cached = celLegacyFunctionTables.get(registry);

  if (cached) {
    return cached;
  }

  const functions = Object.freeze(
    Object.fromEntries(
      readExpressionFunctionTable(registry).functions.map(
        (fn): readonly [string, CelLegacyFunction] => [
          fn.name,
          createExpressionFunctionInvoker(fn, 'cel-legacy'),
        ],
      ),
    ),
  );

  celLegacyFunctionTables.set(registry, functions);

  return functions;
};

/**
 * The cel-legacy adapter for a registry. A host function the registry no
 * longer has fails the evaluation with `EXPRESSION_FUNCTION_FAILED` before the
 * engine runs; any other unknown name keeps `cel-js`'s own error.
 */
export const createCelLegacyAdapter = (
  registry: BPMExpressionFunctionRegistry,
): ExpressionEngineAdapter => ({
  compile: parseCelLegacy,
  evaluate: (handle, roots): unknown => {
    if (
      callsUnavailableFunction(
        readCalledFunctionNames(handle.native),
        readExpressionFunctionTable(registry),
      )
    ) {
      throw new ExpressionEngineFailure('EXPRESSION_FUNCTION_FAILED');
    }

    const functions = readCelLegacyFunctions(registry);

    return runWithExpressionFunctionFrame((): unknown =>
      loadCelEngine().evaluate(handle.native, { ...roots }, functions),
    );
  },
});

/** The built-ins-only adapter, used wherever no registry was handed in. */
export const celLegacyAdapter: ExpressionEngineAdapter = createCelLegacyAdapter(
  BUILT_IN_EXPRESSION_FUNCTION_REGISTRY,
);
