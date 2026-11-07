import { ConditionService } from './condition.service';

/**
 * Phase 23 P2: `ConditionService`'s lint entry points against the real
 * engines. cel-v2 goes through the AST lint; cel-legacy keeps its lines.
 */
describe('ConditionService lint on the real engines', (): void => {
  const service = new ConditionService();

  describe('lintExpression', (): void => {
    it('writes one "<label>: <code>" line per cel-v2 error and drops warnings', (): void => {
      expect(
        service.lintExpression(
          '[1].exists(lastDecision, true) && lastDecision.d != "" || form.x / form.y > 1',
          'entry',
          { dialect: 'cel-v2', usagePoint: 'ENTRY_CONDITION' },
        ),
      ).toEqual(['entry: EXPR_ROOT_NOT_ALLOWED lastDecision']);
    });

    it('reports a cel-v2 syntax error as EXPR_PARSE_FAILED', (): void => {
      expect(
        service.lintExpression('form.x >', 'entry', { dialect: 'cel-v2' }),
      ).toEqual(['entry: EXPR_PARSE_FAILED']);
    });

    // Publish and the preview read one code list (docs/24 §2.2), so a cel-v2
    // blank or over-long expression is the same code in both.
    it('reports a blank or over-long cel-v2 expression with the preview codes', (): void => {
      expect(
        service.lintExpression('  ', 'entry', { dialect: 'cel-v2' }),
      ).toEqual(['entry: EXPR_PARSE_FAILED']);
      expect(
        service.lintExpression('form.x == 1', 'entry', {
          dialect: 'cel-v2',
          maxExpressionLength: 5,
        }),
      ).toEqual(['entry: EXPR_COMPLEXITY_EXCEEDED']);
    });

    it('keeps the blank and length lines for cel-legacy', (): void => {
      expect(service.lintExpression('  ', 'entry')).toEqual([
        'entry must not be blank',
      ]);
      expect(
        service.lintExpression('form.x == 1', 'entry', {
          maxExpressionLength: 5,
        }),
      ).toEqual(['entry must be 5 characters or fewer']);
    });

    // A use point from a client is not trusted to be one: an unknown one
    // allows no root at all, in both dialects, rather than throw.
    it.each(['toString', 'constructor', '__proto__'])(
      'refuses every root under the unknown use point %s',
      (usagePoint): void => {
        const options = {
          usagePoint: usagePoint as unknown as 'ENTRY_CONDITION',
        };

        expect(
          service.lintExpression('form.a == 1', 'entry', {
            ...options,
            dialect: 'cel-v2',
          }),
        ).toEqual(['entry: EXPR_ROOT_NOT_ALLOWED form']);
        expect(
          service.lintExpression('form.a == 1 && true', 'entry', options),
        ).toEqual(['entry references unsupported identifier form']);
        expect(
          service
            .lintExpressionIssues('form.a == 1', 'entry', options)
            .map((finding) => `${finding.code} ${finding.subject ?? ''}`),
        ).toEqual(['EXPR_ROOT_NOT_ALLOWED form']);
      },
    );

    it('keeps the cel-legacy lines', (): void => {
      expect(
        service.lintExpression('account.x == 1 && form.y >', 'entry', {
          allowedRootIdentifiers: ['form'],
        }),
      ).toEqual(['entry: EXPRESSION_SYNTAX_ERROR']);
      expect(
        service.lintExpression('account.x == 1', 'entry', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual(['entry references unsupported identifier account']);
    });
  });

  describe('lintExpressionIssues', (): void => {
    it('returns cel-v2 errors and warnings with their severity', (): void => {
      expect(
        service.lintExpressionIssues('form.price / form.qty > 1', 'entry', {
          dialect: 'cel-v2',
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual([
        {
          code: 'EXPR_DIVISOR_IS_FIELD',
          label: 'entry',
          severity: 'WARNING',
        },
      ]);
    });

    it('maps the cel-legacy lint onto the shared codes', (): void => {
      expect(
        service.lintExpressionIssues('account.x == 1', 'entry', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual([
        {
          code: 'EXPR_ROOT_NOT_ALLOWED',
          label: 'entry',
          severity: 'ERROR',
          subject: 'account',
        },
      ]);
      expect(
        service.lintExpressionIssues('[1].all(x, x > 0)', 'entry'),
      ).toEqual([
        { code: 'EXPR_PARSE_FAILED', label: 'entry', severity: 'ERROR' },
      ]);
    });

    it('refuses blank, over-long and unknown-dialect expressions', (): void => {
      expect(service.lintExpressionIssues(' ', 'entry')).toEqual([
        { code: 'EXPR_PARSE_FAILED', label: 'entry', severity: 'ERROR' },
      ]);
      expect(
        service.lintExpressionIssues('form.x == 1', 'entry', {
          maxExpressionLength: 3,
        }),
      ).toEqual([
        { code: 'EXPR_COMPLEXITY_EXCEEDED', label: 'entry', severity: 'ERROR' },
      ]);
      expect(
        service.lintExpressionIssues('form.x == 1', 'entry', {
          dialect: 'cel-v3' as unknown as 'cel-v2',
        }),
      ).toEqual([
        { code: 'EXPR_PARSE_FAILED', label: 'entry', severity: 'ERROR' },
      ]);
      expect(service.lintExpressionIssues(null, 'entry')).toEqual([]);
    });
  });
});
