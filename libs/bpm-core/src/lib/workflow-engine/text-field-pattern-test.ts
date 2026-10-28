import { createContext, Script } from 'vm';
import type { TextFieldPatternTest } from '@rytass/bpm-core-shared/form';

/**
 * How long all the text field patterns of one validation pass may take
 * together on the server. A normal format check finishes in well under a
 * millisecond, so a whole form of them fits many times over; a pass that
 * still runs past this is backtracking.
 */
export const TEXT_FIELD_PATTERN_TIME_BUDGET_MS = 50;

/** Thrown by a timed pattern test once its pass has used up the time budget. */
export class TextFieldPatternTimeoutError extends Error {
  constructor() {
    super('The text field patterns could not be checked in time');
    this.name = 'TextFieldPatternTimeoutError';
  }
}

const RUN_PATTERN = new Script('pattern.test(value)');

/**
 * A pattern test for one validation pass. The schema lint refuses repeated
 * groups, the shape whose backtracking grows exponentially with the value,
 * but what is left can still grow polynomially (`\w*\w*\w*!` takes seconds on
 * a few hundred characters), and a form can hold many such values. The pass
 * therefore shares one {@link TEXT_FIELD_PATTERN_TIME_BUDGET_MS} budget: each
 * run is interrupted when the budget runs out, and that run and every later
 * one throw {@link TextFieldPatternTimeoutError} instead of answering, so a
 * value is never reported as not matching when it was not checked.
 */
export function createTimedTextFieldPatternTest(
  now: () => number = () => performance.now(),
): TextFieldPatternTest {
  const context = createContext({ pattern: null, value: '' });
  const deadline = now() + TEXT_FIELD_PATTERN_TIME_BUDGET_MS;
  let exhausted = false;

  return (pattern, value) => {
    const remaining = Math.floor(deadline - now());

    if (exhausted || remaining < 1) {
      exhausted = true;

      throw new TextFieldPatternTimeoutError();
    }

    context.pattern = pattern;
    context.value = value;

    try {
      return RUN_PATTERN.runInContext(context, { timeout: remaining }) === true;
    } catch {
      exhausted = true;

      throw new TextFieldPatternTimeoutError();
    }
  };
}
