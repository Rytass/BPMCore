import {
  DEFAULT_EXPRESSION_DIALECT,
  isExpressionDialect,
  readExpressionDialect,
  readWorkflowExpressionDialect,
} from './expression-dialect';
import { ExpressionRuntimeError } from './expression-errors';

describe('expression dialect', (): void => {
  it('reads a missing dialect as cel-legacy (ADR 22 §3.3)', (): void => {
    expect(DEFAULT_EXPRESSION_DIALECT).toBe('cel-legacy');
    expect(readExpressionDialect(undefined, 'label')).toBe('cel-legacy');
    expect(readExpressionDialect(null, 'label')).toBe('cel-legacy');
    expect(readWorkflowExpressionDialect({})).toBe('cel-legacy');
    expect(readWorkflowExpressionDialect(null)).toBe('cel-legacy');
  });

  it.each(['cel-legacy', 'cel-v2'] as const)(
    'reads %s as itself',
    (dialect): void => {
      expect(isExpressionDialect(dialect)).toBe(true);
      expect(readExpressionDialect(dialect, 'label')).toBe(dialect);
      expect(
        readWorkflowExpressionDialect({ expressionDialect: dialect }),
      ).toBe(dialect);
    },
  );

  it.each(['cel-v3', '', 'CEL-V2', 2, {}])(
    'refuses %p rather than guess an engine',
    (value): void => {
      expect(isExpressionDialect(value)).toBe(false);

      try {
        readWorkflowExpressionDialect({ expressionDialect: value });
        throw new Error('expected a refusal');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExpressionRuntimeError);
        expect((error as ExpressionRuntimeError).code).toBe(
          'EXPRESSION_SYNTAX_ERROR',
        );
        expect((error as ExpressionRuntimeError).message).toBe(
          'workflow.expressionDialect names an unknown expression dialect: EXPRESSION_SYNTAX_ERROR',
        );
      }
    },
  );
});
