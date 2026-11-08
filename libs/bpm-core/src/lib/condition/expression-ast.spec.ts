import { readExpressionReferences } from './expression-ast';

/**
 * In this jest project `cel-js` is a shim whose parse result carries no CST,
 * which is the "cannot get an AST" case docs/24 §1 covers: cel-legacy keeps
 * its textual lint. The real readings are in expression-ast.real-engine.spec.ts.
 */
describe('readExpressionReferences without a cel-legacy CST', (): void => {
  it('answers UNAVAILABLE instead of guessing', (): void => {
    expect(readExpressionReferences('form.amount > 1', 'cel-legacy')).toEqual({
      status: 'UNAVAILABLE',
    });
  });

  it('defaults to cel-legacy, like every stored expression without a dialect', (): void => {
    expect(readExpressionReferences('form.amount > 1')).toEqual({
      status: 'UNAVAILABLE',
    });
  });
});
