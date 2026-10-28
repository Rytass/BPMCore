import { Context, createContext, Script } from 'vm';
import type { TextFieldPatternTest } from '@rytass/bpm-core-shared/form';

/**
 * How long the text field patterns of one validation pass may spend matching,
 * together, on the server. A normal format check spends about a microsecond
 * in the regular expression, so even a full table of them uses a small part
 * of it; a pass that still runs past this is backtracking.
 */
export const TEXT_FIELD_PATTERN_TIME_BUDGET_MS = 50;

/** Thrown by a timed pattern test once its pass has used up the time budget. */
export class TextFieldPatternTimeoutError extends Error {
  constructor() {
    super('The text field patterns could not be checked in time');
    this.name = 'TextFieldPatternTimeoutError';
  }
}

const RUN_PATTERN = new Script(
  'started = now(); matched = pattern.test(value); spent = now() - started;',
);

const isScriptTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { readonly code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';

/**
 * A pattern test for one validation pass. The schema lint refuses repeated
 * groups, the shape whose backtracking grows exponentially with the value,
 * but what is left can still grow polynomially (`\w*\w*\w*!` takes seconds on
 * a few hundred characters), and a form can hold many such values. The pass
 * therefore shares one {@link TEXT_FIELD_PATTERN_TIME_BUDGET_MS} budget: each
 * run is interrupted when the budget runs out, and that run and every later
 * one throw {@link TextFieldPatternTimeoutError} instead of answering, so a
 * value is never reported as not matching when it was not checked.
 *
 * Only the time spent in the regular expression is charged. Starting a timed
 * run costs about 45 µs on its own, far more than a normal match, so charging
 * it would refuse a large table of valid values. That cost is paid once per
 * value with a pattern, and the schema bounds how many there are: a table with
 * more rows than its `maxRows` is refused before any cell is checked.
 */
export function createTimedTextFieldPatternTest(
  now: () => number = () => performance.now(),
): TextFieldPatternTest {
  // Created on the first run, so a pass over a form without any pattern
  // never pays for a context.
  let context: Context | undefined;
  let left = TEXT_FIELD_PATTERN_TIME_BUDGET_MS;
  let exhausted = false;

  return (pattern, value) => {
    const remaining = Math.floor(left);

    if (exhausted || remaining < 1) {
      exhausted = true;

      throw new TextFieldPatternTimeoutError();
    }

    context ??= createContext({
      matched: false,
      now,
      pattern: null,
      spent: 0,
      started: 0,
      value: '',
    });
    context.pattern = pattern;
    context.value = value;

    try {
      RUN_PATTERN.runInContext(context, { timeout: remaining });
    } catch (error) {
      if (!isScriptTimeout(error)) {
        throw error;
      }

      exhausted = true;

      throw new TextFieldPatternTimeoutError();
    }

    left -= context.spent;

    return context.matched === true;
  };
}
