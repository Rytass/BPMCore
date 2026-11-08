import { Logger } from '@nestjs/common';
import { ConditionService } from './condition.service';
import type { ExpressionDialect } from './expression-dialect';
import { runExpressionOperation } from './expression-budget';
import { ExpressionRuntimeError } from './expression-errors';

/**
 * ConditionService against the installed `@marcbachmann/cel-js` 8.0.0
 * (cel-v2) and, where the two are compared, `cel-js` 0.8.2 (cel-legacy). Runs in
 * jest.real-engine.config.cts: nothing here holds for the jest shim.
 */

const SECRET_VALUE = 'TOPSECRET-VALUE-42';
const FORM_ROOTS: readonly string[] = ['form'];

// Four nested `map`s over 60 items visit 60^4 ≈ 1.3 × 10^7 elements. cel-v2
// took about 80 ms for 40 items (Node 24, 2026-11-07), so 60 items is several
// times one 100 ms budget. cel-legacy can run `map` on a field too (docs/23
// §P1 correction); this suite is about cel-v2, so only cel-v2 is timed here.
const NESTED_MAP_LIST = Array.from({ length: 60 }, (_item, index) => index);
const NESTED_MAP_EXPRESSION =
  'size(form.l.map(a, form.l.map(b, form.l.map(c, form.l.map(d, a))))) > 0';

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

describe('ConditionService on the real cel-v2 engine', (): void => {
  const service = new ConditionService();
  // `null` stands for "no dialect given", so the caller's default is tested.
  const evaluate = (
    expression: string,
    form: Readonly<Record<string, unknown>>,
    dialect: ExpressionDialect | null = 'cel-v2',
  ): unknown =>
    service.evaluateValue(expression, { form }, 'entry', {
      allowedRootIdentifiers: FORM_ROOTS,
      ...(dialect === null ? {} : { dialect }),
    });

  beforeAll((): void => {
    service.prepareEngine('cel-v2');
    service.prepareEngine('cel-legacy');
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe('dialect selection', (): void => {
    it('evaluates with cel-legacy when no dialect is given', (): void => {
      // `contains` exists only in cel-v2, so this tells the engines apart.
      expect(
        captureRuntimeError(() =>
          evaluate('form.email.contains("@")', { email: 'a@b' }, null),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
      expect(evaluate('form.email.contains("@")', { email: 'a@b' })).toBe(true);
    });

    it('lints with the dialect parser', (): void => {
      // cel-legacy runs macros on a field (`form.l.map(...)`), but cannot parse
      // one on a list literal.
      const macro = '[1, 2].all(x, x > 0)';

      expect(service.lintExpression(macro, 'entry')).toEqual([
        'entry: EXPRESSION_SYNTAX_ERROR',
      ]);
      expect(
        service.lintExpression(macro, 'entry', { dialect: 'cel-v2' }),
      ).toEqual([]);
    });
  });

  // The public API takes a dialect from the host; one it does not know is
  // refused like a stored one, never guessed at.
  describe('an unknown dialect', (): void => {
    const UNKNOWN_DIALECT = 'cel-v3' as unknown as ExpressionDialect;

    it('refuses to evaluate with it', (): void => {
      expect(
        captureRuntimeError(() =>
          evaluate('form.x == 1', { x: 1 }, UNKNOWN_DIALECT),
        ).code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
    });

    it('refuses to lint with it', (): void => {
      expect(
        service.lintExpression('form.x == 1', 'entry', {
          dialect: UNKNOWN_DIALECT,
        }),
      ).toEqual(['entry: EXPRESSION_SYNTAX_ERROR']);
    });

    it('refuses to prepare an engine for it', (): void => {
      expect(
        captureRuntimeError(() => service.prepareEngine(UNKNOWN_DIALECT)).code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
    });
  });

  // The cel-v2 root check skips names a macro binds, anywhere in the
  // expression. The engine must still not hand over a root the use point does
  // not allow, even when the caller's context holds it (the dry run passes
  // `lastDecision` to entry conditions, which may not read it).
  describe('roots outside the allowlist', (): void => {
    const WORKFLOW_ROOTS: readonly string[] = [
      'env',
      'form',
      'formData',
      'initiator',
      'instance',
    ];
    const evaluateWithLastDecision = (expression: string): unknown =>
      service.evaluateValue(
        expression,
        { form: {}, lastDecision: { d: SECRET_VALUE } },
        'entry',
        { allowedRootIdentifiers: WORKFLOW_ROOTS, dialect: 'cel-v2' },
      );

    it.each([
      `[1].exists(lastDecision, true) && lastDecision.d == "${SECRET_VALUE}"`,
      `[1].map(lastDecision, 1) == [1] && lastDecision.d == "${SECRET_VALUE}"`,
    ])(
      'cannot be read by naming a macro variable after them: %s',
      (expression): void => {
        const error = captureRuntimeError(() =>
          evaluateWithLastDecision(expression),
        );

        expect(error.code).toBe('EXPRESSION_MISSING_KEY');
        expect(error.message).not.toContain(SECRET_VALUE);
      },
    );

    it('still lets the macro read its own variable', (): void => {
      expect(
        evaluateWithLastDecision(
          '[1, 2].exists(lastDecision, lastDecision == 2)',
        ),
      ).toBe(true);
    });
  });

  describe('mixed int and double arithmetic (ADR 22 §3.3)', (): void => {
    it.each([
      ['form.price * 2', 5],
      ['2 * form.price', 5],
      ['form.amount + 1', 1_500_001],
      ['1 + form.amount', 1_500_001],
      ['form.amount - 1', 1_499_999],
      ['10 - form.price', 7.5],
      ['form.qty / 2', 1.5],
      ['10 / form.qty', 10 / 3],
      ['form.qty % 2', 1],
      ['7 % form.qty', 1],
    ])('%s gives what cel-legacy gives', (expression, expected): void => {
      const form = { amount: 1_500_000, price: 2.5, qty: 3 };

      expect(evaluate(expression, form)).toBe(expected);
      expect(evaluate(expression, form, 'cel-legacy')).toBe(expected);
    });

    it('compares an int with a double, both ways', (): void => {
      expect(evaluate('1 == 1.0', {})).toBe(true);
      expect(evaluate('1.0 == 1', {})).toBe(true);
      expect(evaluate('1 != 1.5', {})).toBe(true);
      expect(evaluate('form.qty + 1 == 4', { qty: 3 })).toBe(true);
    });

    it('does not round a large int into equality with a nearby double', (): void => {
      expect(evaluate('9007199254740993 == 9007199254740992.0', {})).toBe(
        false,
      );
    });

    it.each(['form.qty / 0', 'form.qty % 0', '1 / form.zero'])(
      'reports %s as EXPRESSION_TYPE_ERROR, not Infinity or NaN',
      (expression): void => {
        expect(
          captureRuntimeError(() => evaluate(expression, { qty: 3, zero: 0 }))
            .code,
        ).toBe('EXPRESSION_TYPE_ERROR');
      },
    );

    it('refuses to turn an int outside the safe range into a double', (): void => {
      expect(
        captureRuntimeError(() =>
          evaluate('9007199254740993 + form.price', { price: 0.5 }),
        ).code,
      ).toBe('EXPRESSION_INVALID_RESULT');
    });
  });

  describe('integers come back as numbers', (): void => {
    it('normalizes a bigint result inside the safe range', (): void => {
      expect(evaluate('size(form.tags) + 1', { tags: ['a', 'b'] })).toBe(3);
      expect(evaluate('[1, 2]', {})).toEqual([1, 2]);
    });

    it('refuses a bigint result outside the safe range', (): void => {
      expect(
        captureRuntimeError(() => evaluate('9007199254740993', {})).code,
      ).toBe('EXPRESSION_INVALID_RESULT');
    });

    it('reports int64 overflow as EXPRESSION_INVALID_RESULT', (): void => {
      expect(
        captureRuntimeError(() => evaluate('9223372036854775807 + 1', {})).code,
      ).toBe('EXPRESSION_INVALID_RESULT');
    });
  });

  describe('map literals', (): void => {
    it('accepts a map literal whose values mix types (cel-legacy refuses it)', (): void => {
      expect(evaluate('{"a": "x", "b": 2, "c": [1, "y"]}', {})).toEqual({
        a: 'x',
        b: 2,
        c: [1, 'y'],
      });
      expect(
        captureRuntimeError(() =>
          evaluate('{"a": "x", "b": 2}', {}, 'cel-legacy'),
        ).code,
      ).toBe('EXPRESSION_TYPE_ERROR');
    });
  });

  describe('error sanitization', (): void => {
    it('reports a missing field with only the code and the written key name', (): void => {
      const logged = [
        jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined),
        jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined),
      ];
      const error = captureRuntimeError(() =>
        evaluate('form.missing == 1', { secret: SECRET_VALUE }),
      );

      expect(error.code).toBe('EXPRESSION_MISSING_KEY');
      expect(error.keyName).toBe('missing');
      expect(error.message).toBe('entry: EXPRESSION_MISSING_KEY');
      expect(JSON.stringify(error.getResponse())).not.toContain(SECRET_VALUE);
      expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain(
        SECRET_VALUE,
      );
    });

    it('does not take a key name read from the context through a computed index', (): void => {
      const error = captureRuntimeError(() =>
        evaluate('form.a[form.b] == 1', { a: {}, b: 'Payroll_Alice' }),
      );

      expect(error.code).toBe('EXPRESSION_MISSING_KEY');
      expect(error.keyName).toBeNull();
    });

    it('reports an index out of range as a missing key without a name', (): void => {
      const error = captureRuntimeError(() =>
        evaluate('form.items[5].qty', { items: [{ qty: 1 }] }),
      );

      expect(error.code).toBe('EXPRESSION_MISSING_KEY');
      expect(error.keyName).toBeNull();
    });

    it.each(['form.constructor', 'form.toString', 'form.__proto__'])(
      'does not hand back %s',
      (expression): void => {
        expect(
          captureRuntimeError(() => evaluate(expression, { amount: 1 })).code,
        ).toBe('EXPRESSION_MISSING_KEY');
      },
    );

    it('refuses an expression over the AST node limit as a syntax error', (): void => {
      expect(
        captureRuntimeError(() => evaluate(`1${' + 1'.repeat(150)}`, {})).code,
      ).toBe('EXPRESSION_SYNTAX_ERROR');
    });
  });

  describe('time budget (Phase 23 P1 gate: nested map)', (): void => {
    it('interrupts a nested map at the per-expression budget', (): void => {
      jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
      const startedAt = performance.now();
      const error = captureRuntimeError(() =>
        evaluate(NESTED_MAP_EXPRESSION, { l: NESTED_MAP_LIST }),
      );

      expect(error.code).toBe('EXPRESSION_BUDGET_EXCEEDED');
      expect(error.message).toBe('entry: EXPRESSION_BUDGET_EXCEEDED');
      // 100 ms budget; the rest is slack for a loaded runner.
      expect(performance.now() - startedAt).toBeLessThan(1_000);
    });

    it('refuses every evaluation once the operation budget is spent', (): void => {
      jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);

      runExpressionOperation((): void => {
        const codes = [1, 2, 3].map(
          () =>
            captureRuntimeError(() =>
              evaluate(NESTED_MAP_EXPRESSION, { l: NESTED_MAP_LIST }),
            ).code,
        );

        expect(codes).toEqual([
          'EXPRESSION_BUDGET_EXCEEDED',
          'EXPRESSION_BUDGET_EXCEEDED',
          'EXPRESSION_BUDGET_EXCEEDED',
        ]);
        expect(
          captureRuntimeError(() => evaluate('form.x == 1', { x: 1 })).code,
        ).toBe('EXPRESSION_BUDGET_EXCEEDED');
      });
    });

    it('still evaluates the same macro over a small list', (): void => {
      expect(evaluate(NESTED_MAP_EXPRESSION, { l: [1, 2] })).toBe(true);
    });
  });
});
