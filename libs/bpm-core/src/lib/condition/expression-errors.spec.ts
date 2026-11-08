import { BadRequestException } from '@nestjs/common';
import { TimeBudgetExceededError } from '../workflow-engine/time-budget';
import {
  EXPRESSION_ERROR_CODES,
  ExpressionRuntimeError,
  toExpressionRuntimeError,
} from './expression-errors';

describe('toExpressionRuntimeError', (): void => {
  it('maps a missing identifier to MISSING_KEY and drops the context values', (): void => {
    // Real cel-js shape: the engine appends the whole context after the colon.
    const engineMessage =
      'Identifier "missing" not found in context: {"form":{"secret":"TOPSECRET-VALUE"}}';

    const error = toExpressionRuntimeError(
      new Error(engineMessage),
      'approver resolver',
      'form.missing == 1',
    );

    expect(error.code).toBe('EXPRESSION_MISSING_KEY');
    expect(error.keyName).toBe('missing');
    expect(error.message).toBe('approver resolver: EXPRESSION_MISSING_KEY');
    expect(error.message).not.toContain('TOPSECRET-VALUE');
    expect(error.message).not.toContain('secret');
  });

  it('maps a property read on a non-object to MISSING_KEY', (): void => {
    const error = toExpressionRuntimeError(
      new Error('Cannot obtain "amount" from non-object context'),
      'entry condition',
      'form.amount > 1',
    );

    expect(error.code).toBe('EXPRESSION_MISSING_KEY');
    expect(error.keyName).toBe('amount');
  });

  describe('keeps a key name only when the expression writes it as an identifier', (): void => {
    const missing = (name: string): Error =>
      new Error(`Identifier "${name}" not found in context: {}`);

    it.each([
      ['no expression is given', undefined],
      ['the name is a value read through a computed index', 'form.a[form.b]'],
      ['the name only occurs inside a string literal', 'form.a["Secret"]'],
      [
        'the name only occurs inside a single-quoted literal',
        "form.a['Secret']",
      ],
      [
        'the name only occurs inside a triple-quoted literal',
        'form.a["""Secret"""]',
      ],
      ['the name only occurs inside a raw literal', "form.a[r'Secret']"],
      ['the name is only part of a longer identifier', 'form.Secrets == 1'],
      ['the name only follows an escaped quote', 'form.a["x\\" Secret"]'],
    ])('drops it when %s', (_case, expression): void => {
      const error = toExpressionRuntimeError(
        missing('Secret'),
        'label',
        expression,
      );

      expect(error.code).toBe('EXPRESSION_MISSING_KEY');
      expect(error.keyName).toBeNull();
    });

    it.each([
      ['a root identifier', 'Secret > 1'],
      ['a member access', 'form.Secret > 1'],
      ['an identifier after a string literal', 'form.a == "x" && form.Secret'],
      ['an identifier after a bytes literal', 'b"x" == form.Secret'],
    ])('keeps it for %s', (_case, expression): void => {
      expect(
        toExpressionRuntimeError(missing('Secret'), 'label', expression)
          .keyName,
      ).toBe('Secret');
    });
  });

  it('keeps no key name when the captured name is not identifier-shaped', (): void => {
    const error = toExpressionRuntimeError(
      new Error('Identifier "a-b c" not found in context: {}'),
      'label',
    );

    expect(error.code).toBe('EXPRESSION_MISSING_KEY');
    expect(error.keyName).toBeNull();
  });

  it('maps division by zero to TYPE_ERROR without copying the engine text', (): void => {
    const error = toExpressionRuntimeError(
      new Error('Division by zero'),
      'label',
    );

    expect(error.code).toBe('EXPRESSION_TYPE_ERROR');
    expect(error.message).toBe('label: EXPRESSION_TYPE_ERROR');
  });

  it('maps an unrecognised engine message to TYPE_ERROR and keeps none of it', (): void => {
    const error = toExpressionRuntimeError(
      new Error(
        'CelTypeError: addition operation cannot be applied to (string, uint) VALUE-XYZ',
      ),
      'label',
    );

    expect(error.code).toBe('EXPRESSION_TYPE_ERROR');
    expect(error.keyName).toBeNull();
    expect(error.message).not.toContain('VALUE-XYZ');
  });

  it('maps a time budget failure to BUDGET_EXCEEDED', (): void => {
    const error = toExpressionRuntimeError(
      new TimeBudgetExceededError(),
      'label',
    );

    expect(error.code).toBe('EXPRESSION_BUDGET_EXCEEDED');
  });

  it('returns an existing ExpressionRuntimeError unchanged', (): void => {
    const original = new ExpressionRuntimeError(
      'EXPRESSION_INVALID_RESULT',
      'label',
    );

    expect(toExpressionRuntimeError(original, 'other')).toBe(original);
  });

  it('keeps HTTP 400 by extending BadRequestException', (): void => {
    const error = toExpressionRuntimeError(new Error('boom'), 'label');

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
  });

  it('exposes exactly the six ADR 22 codes', (): void => {
    expect([...EXPRESSION_ERROR_CODES]).toEqual([
      'EXPRESSION_SYNTAX_ERROR',
      'EXPRESSION_MISSING_KEY',
      'EXPRESSION_TYPE_ERROR',
      'EXPRESSION_BUDGET_EXCEEDED',
      'EXPRESSION_INVALID_RESULT',
      'EXPRESSION_FUNCTION_FAILED',
    ]);
  });
});
