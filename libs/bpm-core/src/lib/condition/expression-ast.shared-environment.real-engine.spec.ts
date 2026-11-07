import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { loadCelV2Environment } from './adapters/cel-v2.adapter';
import { ConditionService } from './condition.service';
import { lintCelV2Expression } from './expression-ast';

/**
 * The type check clones the shared cel-v2 environment, and cloning freezes
 * the original's registry (`Cannot modify frozen registry`, probed
 * 2026-11-07). In production a template is linted at publish and its cases
 * are evaluated afterwards with that same environment, so this file does
 * both in one module instance: lint first, then evaluate.
 */
const SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: 'amount', required: true, type: 'number' },
    { fieldKey: 'title', label: 'title', required: true, type: 'text' },
  ],
  schemaVersion: 1,
};

describe('the shared cel-v2 environment after a lint', (): void => {
  const service = new ConditionService();

  beforeAll((): void => {
    // Runs the type check, which clones the shared environment and
    // registers `form` on the clone.
    expect(
      lintCelV2Expression('form.amount * 2 > 1 && form.title != ""', 'lint', {
        formSchema: SCHEMA,
        usagePoint: 'ENTRY_CONDITION',
      }),
    ).toEqual([]);
  });

  it('is frozen against new registrations', (): void => {
    expect(() =>
      loadCelV2Environment().registerFunction(
        'later_v1(string): string',
        (value: unknown): unknown => value,
      ),
    ).toThrow();
  });

  it.each([
    ['form.amount * 2 + 1', { amount: 2.5 }, 6],
    ['{"a": form.title, "b": 2}', { title: 'x' }, { a: 'x', b: 2 }],
    ['[1, 2, 3].map(x, x * form.amount)', { amount: 0.5 }, [0.5, 1, 1.5]],
    ['form.title.contains("急")', { title: '急件' }, true],
    ['[1, 2].exists(v, v == form.amount)', { amount: 2 }, true],
    [
      'size(form.title) == 2 && form.amount == 1',
      { amount: 1, title: 'ab' },
      true,
    ],
  ])('still parses and evaluates %s', (expression, form, expected): void => {
    expect(
      service.evaluateValue(expression, { form }, 'entry', {
        allowedRootIdentifiers: ['form'],
        dialect: 'cel-v2',
      }),
    ).toEqual(expected);
  });

  it('keeps linting after the freeze', (): void => {
    expect(
      lintCelV2Expression('form.title > 1', 'lint', {
        formSchema: SCHEMA,
        usagePoint: 'ENTRY_CONDITION',
      }).map((finding) => finding.code),
    ).toEqual(['EXPR_FIELD_TYPE_MISMATCH']);
  });
});
