import { Logger } from '@nestjs/common';
import { ConditionService } from './condition.service';
import { runExpressionOperation } from './expression-budget';
import { ExpressionRuntimeError } from './expression-errors';

/**
 * ConditionService against the installed `cel-js` 0.8.2 (cel-legacy), not the
 * jest shim. Runs in jest.real-engine.config.cts. Everything here depends on
 * what the real engine does, so it cannot live in the default project.
 */

const SECRET_VALUE = 'TOPSECRET-VALUE-42';
const FORM_ROOTS: readonly string[] = ['form'];

// A cel-legacy expression that takes far longer than one budget without any
// macro: each `+` copies the whole list again, so 150 terms over 20,000 items
// copy about 2.3 × 10^8 elements. Unbounded it took about 680 ms on Node 24
// (2026-11-07); the budget stops it at 100 ms.
const SLOW_LIST = Array.from({ length: 20_000 }, (_item, index) => index);
const SLOW_EXPRESSION = `size(${Array.from({ length: 150 }, () => 'form.l').join(' + ')}) > 0`;

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

const evaluateForm = (
  service: ConditionService,
  expression: string,
  form: Readonly<Record<string, unknown>>,
): unknown =>
  service.evaluateValue(expression, { form }, 'entry', {
    allowedRootIdentifiers: FORM_ROOTS,
  });

describe('ConditionService on the real cel-legacy engine', (): void => {
  const service = new ConditionService();

  beforeAll((): void => {
    service.prepareEngine();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe('error sanitization', (): void => {
    it('reports a missing field as EXPRESSION_MISSING_KEY with no context value in the error or the log', (): void => {
      // cel-js 0.8.2 writes the whole context into this message; the runtime
      // must keep none of it.
      const logged = [
        jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined),
        jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined),
        jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined),
        jest.spyOn(Logger.prototype, 'error').mockReturnValue(undefined),
      ];

      const error = captureRuntimeError(() =>
        evaluateForm(service, 'form.missing == 1', {
          amount: 1,
          secret: SECRET_VALUE,
        }),
      );
      const loggedText = JSON.stringify(
        logged.flatMap((spy) => spy.mock.calls),
      );

      expect(error.code).toBe('EXPRESSION_MISSING_KEY');
      expect(error.keyName).toBe('missing');
      expect(error.message).toBe('entry: EXPRESSION_MISSING_KEY');
      expect(JSON.stringify(error.getResponse())).not.toContain(SECRET_VALUE);
      expect(JSON.stringify(error.getResponse())).not.toContain('secret');
      expect(loggedText).toContain('EXPRESSION_MISSING_KEY');
      expect(loggedText).not.toContain(SECRET_VALUE);
      expect(loggedText).not.toContain('secret');
    });

    it.each([
      [
        'a key read from the form',
        'form.a[form.b] == 1',
        { a: {}, b: 'Payroll_Alice' },
      ],
      [
        'a key inside a string literal',
        'form.a["Payroll_Alice"] == 1',
        { a: {} },
      ],
    ])(
      'keeps no key name for %s, which the author did not write as an identifier',
      (_case, expression, form): void => {
        jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined);

        // cel-js 0.8.2 reports the missing key itself: for a computed index
        // that is the context value `Payroll_Alice`.
        const error = captureRuntimeError(() =>
          evaluateForm(service, expression, form),
        );

        expect(error.code).toBe('EXPRESSION_MISSING_KEY');
        expect(error.keyName).toBeNull();
      },
    );

    it('reports a parse failure as EXPRESSION_SYNTAX_ERROR without echoing the expression', (): void => {
      const error = captureRuntimeError(() =>
        evaluateForm(service, `form.amount > "${SECRET_VALUE}" &&`, {
          amount: 1,
        }),
      );

      expect(error.code).toBe('EXPRESSION_SYNTAX_ERROR');
      expect(error.message).not.toContain(SECRET_VALUE);
    });
  });

  describe('non-JSON results', (): void => {
    it.each(['form.constructor', 'form.toString', 'form.__proto__'])(
      'refuses %s as EXPRESSION_INVALID_RESULT',
      (expression): void => {
        // cel-js 0.8.2 hands back the function, or Object.prototype itself
        // for __proto__ (which has a null prototype and would otherwise pass
        // as an empty map).
        expect(
          captureRuntimeError(() =>
            evaluateForm(service, expression, { amount: 1 }),
          ).code,
        ).toBe('EXPRESSION_INVALID_RESULT');
      },
    );

    it('refuses a result outside the safe integer range', (): void => {
      expect(
        captureRuntimeError(() =>
          evaluateForm(service, '9007199254740992 + 2', {}),
        ).code,
      ).toBe('EXPRESSION_INVALID_RESULT');
    });

    it('drops a literal __proto__ key before the result is read, without touching a prototype', (): void => {
      // cel-js 0.8.2 builds the map with plain assignment, so the literal key
      // never becomes an own property and the walker never sees it.
      const result = evaluateForm(service, '{"__proto__": 1}', {});

      expect(result).toEqual({});
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.keys(result as object)).toEqual([]);
    });

    it('returns a fresh frozen copy of a map built by the engine', (): void => {
      const result = evaluateForm(service, '{"a": form.amount, "b": 2}', {
        amount: 1,
      });

      expect(result).toEqual({ a: 1, b: 2 });
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('known cel-legacy limits', (): void => {
    it('refuses a map literal whose values mix types', (): void => {
      // A webhook payload mixing a string and a number fails the same way.
      expect(
        captureRuntimeError(() =>
          evaluateForm(service, '{"a": "x", "b": 2}', {}),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
    });

    it('accepts a list that mixes types', (): void => {
      expect(evaluateForm(service, '["x", 2]', {})).toEqual(['x', 2]);
    });

    it.each(['[1, 2].map(x, x * 2)', '[1, 2].exists(x, x > 1)'])(
      'does not parse the %s macro',
      (expression): void => {
        expect(
          captureRuntimeError(() => evaluateForm(service, expression, {})).code,
        ).toBe('EXPRESSION_SYNTAX_ERROR');
      },
    );

    it('has no string contains method', (): void => {
      expect(
        captureRuntimeError(() =>
          evaluateForm(service, 'form.email.contains("@")', {
            email: 'a@example.com',
          }),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
    });

    it('reports division by zero as EXPRESSION_TYPE_ERROR', (): void => {
      expect(
        captureRuntimeError(() =>
          evaluateForm(service, 'form.amount / 0', { amount: 1 }),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
    });
  });

  describe('time budget', (): void => {
    it('interrupts one slow evaluation at the per-expression budget', (): void => {
      jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
      const startedAt = performance.now();

      const error = captureRuntimeError(() =>
        evaluateForm(service, SLOW_EXPRESSION, { l: SLOW_LIST }),
      );

      expect(error.code).toBe('EXPRESSION_BUDGET_EXCEEDED');
      // 100 ms budget; the rest is slack for a loaded CI runner.
      expect(performance.now() - startedAt).toBeLessThan(400);
    });

    it('stops an operation once its cumulative budget is spent', (): void => {
      jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
      const startedAt = performance.now();

      const codes = runExpressionOperation(() =>
        Array.from(
          { length: 4 },
          (): string =>
            captureRuntimeError(() =>
              evaluateForm(service, SLOW_EXPRESSION, { l: SLOW_LIST }),
            ).code,
        ),
      );
      const elapsedMs = performance.now() - startedAt;

      // 100 + 100 + 50 ms, then nothing is left for the fourth.
      expect(codes).toEqual([
        'EXPRESSION_BUDGET_EXCEEDED',
        'EXPRESSION_BUDGET_EXCEEDED',
        'EXPRESSION_BUDGET_EXCEEDED',
        'EXPRESSION_BUDGET_EXCEEDED',
      ]);
      expect(elapsedMs).toBeGreaterThanOrEqual(240);
      expect(elapsedMs).toBeLessThan(700);
    });

    it('still evaluates an ordinary expression well inside the budget', (): void => {
      expect(
        service.evaluateBoolean(
          'form.amount >= 100000 && form.amount <= 1000000',
          { form: { amount: 200000 } },
          'entry',
          { allowedRootIdentifiers: FORM_ROOTS },
        ),
      ).toBe(true);
    });
  });
});
