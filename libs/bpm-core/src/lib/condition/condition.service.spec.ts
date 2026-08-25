import { BadRequestException } from '@nestjs/common';
import { ConditionService } from './condition.service';

describe('ConditionService', () => {
  it('rejects expressions longer than the configured guard limit', (): void => {
    const service = new ConditionService();

    expect(
      service.lintExpression('form.amount > 1000', 'edge condition', {
        maxExpressionLength: 10,
      }),
    ).toEqual(['edge condition must be 10 characters or fewer']);
  });

  it('rejects unsupported root identifiers when a registry is provided', (): void => {
    const service = new ConditionService();

    expect(
      service.lintExpression('account.amount > 1000', 'edge condition', {
        allowedRootIdentifiers: ['form', 'initiator'],
      }),
    ).toEqual(['edge condition references unsupported identifier account']);
  });

  it('does not treat string literals as identifiers', (): void => {
    const service = new ConditionService();

    expect(
      service.lintExpression('form.status == "account"', 'edge condition', {
        allowedRootIdentifiers: ['form'],
      }),
    ).toEqual([]);
  });

  it('applies guard lint before evaluating expressions', (): void => {
    const service = new ConditionService();

    expect(() =>
      service.evaluateBoolean(
        'form.amount > 1000',
        { form: { amount: 100 } },
        'edge condition',
      ),
    ).not.toThrow();

    expect(() =>
      service.evaluateBoolean('x'.repeat(2001), {}, 'edge condition'),
    ).toThrow(BadRequestException);
  });

  /**
   * The evaluation half of the table field story is in
   * `cel-js-list-behaviour.spec.ts`, which drives the real engine; this suite
   * runs against the jest shim (see `moduleNameMapper`) and so can only speak
   * for the lint half, which is plain string analysis.
   */
  describe('table field conditions', () => {
    it('accepts size as a macro rather than an unknown identifier', (): void => {
      const service = new ConditionService();

      expect(
        service.lintExpression('size(form.items) > 0', 'edge condition', {
          allowedRootIdentifiers: ['form'],
        }),
      ).toEqual([]);
    });

    it('rejects the loop variable a comprehension macro would introduce', (): void => {
      const service = new ConditionService();

      // Comprehensions evaluate fine in cel-js, but their loop variable is an
      // unknown root identifier, so they cannot reach a published template
      // today. V1 ships no UI that produces them (ADR 16 §3.8).
      expect(
        service.lintExpression(
          'form.items.exists(row, row.qty > 2)',
          'edge condition',
          { allowedRootIdentifiers: ['form'] },
        ),
      ).toEqual(['edge condition references unsupported identifier row']);
    });
  });
});
