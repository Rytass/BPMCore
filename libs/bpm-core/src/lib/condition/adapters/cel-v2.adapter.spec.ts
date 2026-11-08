import { ExpressionEngineFailure } from '../expression-engine-failure';
import { toExpressionRuntimeError } from '../expression-errors';
import { classifyCelV2Error } from './cel-v2.adapter';

// The engine's error shape (`@marcbachmann/cel-js` 8.0.0): `name`, `code` and
// `summary`, with `message` carrying the expression highlighted.
const celError = (name: string, code: string, summary: string): Error =>
  Object.assign(new Error(`${summary}\n\n>    1 | form.secret`), {
    code,
    name,
    summary,
  });

describe('classifyCelV2Error', (): void => {
  it.each([
    [
      'no_such_key',
      'No such key: missing',
      'EXPRESSION_MISSING_KEY',
      'missing',
    ],
    [
      'unknown_variable',
      'Unknown variable: other',
      'EXPRESSION_MISSING_KEY',
      'other',
    ],
    [
      'index_out_of_bounds',
      'No such key: index out of bounds, index 5 >= size 1',
      'EXPRESSION_MISSING_KEY',
      null,
    ],
    [
      'numeric_overflow',
      'integer overflow: 1',
      'EXPRESSION_INVALID_RESULT',
      null,
    ],
    [
      'no_such_overload',
      'no such overload: string + int',
      'EXPRESSION_TYPE_ERROR',
      null,
    ],
    ['division_by_zero', 'division by zero', 'EXPRESSION_TYPE_ERROR', null],
    [
      'something_new',
      'whatever the engine says',
      'EXPRESSION_TYPE_ERROR',
      null,
    ],
  ])(
    'maps %s by its code only',
    (code, summary, expectedCode, keyName): void => {
      const classified = classifyCelV2Error(
        celError('EvaluationError', code, summary),
      );

      expect(classified).toBeInstanceOf(ExpressionEngineFailure);
      expect((classified as ExpressionEngineFailure).code).toBe(expectedCode);
      expect((classified as ExpressionEngineFailure).keyNameCandidate).toBe(
        keyName,
      );
      expect((classified as Error).message).toBe(expectedCode);
    },
  );

  it('passes errors that are not the engine’s through unchanged', (): void => {
    const own = new RangeError('Maximum call stack size exceeded');

    expect(classifyCelV2Error(own)).toBe(own);
  });

  it('shows a key name only when the author wrote it', (): void => {
    const failure = new ExpressionEngineFailure(
      'EXPRESSION_MISSING_KEY',
      'Payroll_Alice',
    );

    expect(
      toExpressionRuntimeError(failure, 'entry', 'form.a[form.b] == 1').keyName,
    ).toBeNull();
    expect(
      toExpressionRuntimeError(
        new ExpressionEngineFailure('EXPRESSION_MISSING_KEY', 'missing'),
        'entry',
        'form.missing == 1',
      ).keyName,
    ).toBe('missing');
    expect(
      toExpressionRuntimeError(failure, 'entry', 'form.a[form.b] == 1').message,
    ).toBe('entry: EXPRESSION_MISSING_KEY');
  });
});
