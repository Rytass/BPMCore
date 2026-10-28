import { createContext, Script } from 'vm';
import type { TextFieldPatternTest } from '@rytass/bpm-core-shared/form';

/**
 * How long one run of a text field pattern may take on the server. A format
 * check finishes in well under a millisecond; anything still running after
 * this is backtracking, and the value is refused rather than waited on.
 */
export const TEXT_FIELD_PATTERN_TIME_LIMIT_MS = 20;

const RUN_PATTERN = new Script('pattern.test(value)');

/**
 * A pattern test for one validation pass. The schema lint refuses the
 * patterns known to backtrack exponentially, but it is a heuristic, and some
 * shapes it lets through (`\w*\w*\w*!`) still take seconds on a few hundred
 * characters. Each run is therefore interrupted after
 * {@link TEXT_FIELD_PATTERN_TIME_LIMIT_MS} and counts as no match. Once one run
 * is interrupted the rest of the pass fails without running, so a request
 * full of such values costs one time limit, not one per value.
 */
export function createTimedTextFieldPatternTest(): TextFieldPatternTest {
  const context = createContext({ pattern: null, value: '' });
  let interrupted = false;

  return (pattern, value) => {
    if (interrupted) {
      return false;
    }

    context.pattern = pattern;
    context.value = value;

    try {
      return RUN_PATTERN.runInContext(context, {
        timeout: TEXT_FIELD_PATTERN_TIME_LIMIT_MS,
      }) === true;
    } catch {
      interrupted = true;

      return false;
    }
  };
}
