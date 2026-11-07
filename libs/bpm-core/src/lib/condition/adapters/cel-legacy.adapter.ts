import type { ParseResult } from 'cel-js';
import type {
  ExpressionEngineAdapter,
  ExpressionHandle,
} from '../expression-runtime';

/**
 * The slice of `cel-js` this adapter uses.
 */
interface CelEngine {
  readonly evaluate: (
    cst: unknown,
    context: Readonly<Record<string, unknown>>,
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

export const celLegacyAdapter: ExpressionEngineAdapter = {
  compile: parseCelLegacy,
  evaluate: (handle, roots): unknown =>
    loadCelEngine().evaluate(handle.native, { ...roots }),
};
