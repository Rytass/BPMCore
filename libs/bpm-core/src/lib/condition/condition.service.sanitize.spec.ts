import { ConditionService } from './condition.service';
import { ExpressionRuntimeError } from './expression-errors';

const SECRET_VALUE = 'TOPSECRET-VALUE-42';

const captureRuntimeError = (action: () => unknown): ExpressionRuntimeError => {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ExpressionRuntimeError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected an ExpressionRuntimeError to be thrown');
};

describe('ConditionService error sanitization', (): void => {
  it('does not put any context value into a missing-key error', (): void => {
    const service = new ConditionService();

    const error = captureRuntimeError(() =>
      service.evaluateValue(
        'missing',
        { form: { secret: SECRET_VALUE } },
        'approver resolver',
        { allowedRootIdentifiers: ['form', 'missing'] },
      ),
    );

    // Here `cel-js` is the `with (scope)` shim, so the code says nothing about
    // the real engine. That it is EXPRESSION_MISSING_KEY is asserted against
    // cel-js itself in condition.service.real-engine.spec.ts. What this test
    // guards holds for any engine: no context value reaches the error.
    expect(error).toBeInstanceOf(ExpressionRuntimeError);
    expect(error.message).not.toContain(SECRET_VALUE);
    expect(error.message).not.toContain('secret');
    expect(JSON.stringify(error.getResponse())).not.toContain(SECRET_VALUE);
  });

  it('refuses a constructor read on a form object as a non-JSON result', (): void => {
    const service = new ConditionService();

    const error = captureRuntimeError(() =>
      service.evaluateValue(
        'form.constructor',
        { form: { amount: 1 } },
        'label',
        {
          allowedRootIdentifiers: ['form'],
        },
      ),
    );

    expect(error.code).toBe('EXPRESSION_INVALID_RESULT');
  });

  it('reports a non-boolean result as a type error, not as a value', (): void => {
    const service = new ConditionService();

    const error = captureRuntimeError(() =>
      service.evaluateBoolean('form.amount', { form: { amount: 5 } }, 'entry', {
        allowedRootIdentifiers: ['form'],
      }),
    );

    expect(error.code).toBe('EXPRESSION_TYPE_ERROR');
    expect(error.message).toBe(
      'entry must evaluate to a boolean: EXPRESSION_TYPE_ERROR',
    );
  });

  it('refuses a root that the use point does not allow', (): void => {
    const service = new ConditionService();

    const error = captureRuntimeError(() =>
      service.evaluateBoolean(
        'secretRoot.x > 1',
        { secretRoot: { x: 2 } },
        'entry',
        {
          allowedRootIdentifiers: ['form'],
        },
      ),
    );

    expect(error.code).toBe('EXPRESSION_SYNTAX_ERROR');
    expect(error.message).not.toContain('secretRoot');
  });
});
