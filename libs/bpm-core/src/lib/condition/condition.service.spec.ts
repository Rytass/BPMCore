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
});
