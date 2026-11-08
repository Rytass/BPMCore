import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  ExpressionLintCode,
  ExpressionLintIssue,
} from '@rytass/bpm-core-shared';
import type {
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import type { WorkflowEdgeConditionOperator } from '@rytass/bpm-core-shared/workflow';
import { readConditionExpression } from '@rytass/bpm-core-shared/workflow-graph';
import {
  ExpressionFunctionAvailability,
  ExpressionLintContext,
  ExpressionReferences,
  lintCelV2Expression,
  readExpressionHostFunctionNames,
  readExpressionReferences,
} from './expression-ast';

/**
 * Phase 23 P2: the AST reading and the cel-v2 lint, against the installed
 * engines. Runs in jest.real-engine.config.cts; the unit tests' `cel-js` shim
 * has no CST, which `readExpressionReferences` answers with `UNAVAILABLE`.
 */

const field = (
  fieldKey: string,
  type: FormFieldDefinition['type'],
  extra: Readonly<Record<string, unknown>> = {},
): FormFieldDefinition =>
  ({
    fieldKey,
    label: fieldKey,
    required: true,
    type,
    ...extra,
  }) as unknown as FormFieldDefinition;

const SCHEMA: FormDefinitionSchema = {
  fields: [
    field('amount', 'number'),
    field('price', 'money'),
    field('title', 'text'),
    field('note', 'textarea', { required: false }),
    field('start', 'date'),
    field('urgent', 'boolean'),
    field('category', 'select', { options: [{ label: 'A', value: 'A' }] }),
    field('tags', 'checkbox', { options: [{ label: 'A', value: 'A' }] }),
    field('channels', 'select', {
      mode: 'multiple',
      options: [{ label: 'A', value: 'A' }],
    }),
    field('owner', 'member'),
    field('watchers', 'member', { multiple: true }),
    field('dept', 'org_unit'),
    field('files', 'file_upload', { required: false }),
    field('items', 'table', {
      columns: [field('qty', 'number')],
      required: false,
    }),
    field('secret', 'text', { hidden: true, required: false }),
    field('visible', 'text', { required: false }),
  ],
  schemaVersion: 1,
};

const readReferences = (
  expression: string,
  dialect: 'cel-legacy' | 'cel-v2' = 'cel-v2',
): ExpressionReferences => {
  const result = readExpressionReferences(expression, dialect);

  if (result.status !== 'OK') {
    throw new Error(`Expected references for ${expression}: ${result.status}`);
  }

  return result.references;
};

const codes = (findings: readonly ExpressionLintIssue[]): readonly string[] =>
  findings.map((finding) =>
    finding.subject ? `${finding.code} ${finding.subject}` : finding.code,
  );

const errorCodes = (
  expression: string,
  context: ExpressionLintContext = {},
): readonly string[] =>
  codes(
    lintCelV2Expression(expression, 'label', context).filter(
      (finding) => finding.severity === 'ERROR',
    ),
  );

const warningCodes = (
  expression: string,
  context: ExpressionLintContext = {},
): readonly string[] =>
  codes(
    lintCelV2Expression(expression, 'label', context).filter(
      (finding) => finding.severity === 'WARNING',
    ),
  );

const ENTRY: ExpressionLintContext = {
  formSchema: SCHEMA,
  usagePoint: 'ENTRY_CONDITION',
};

describe('readExpressionReferences', (): void => {
  describe.each(['cel-v2', 'cel-legacy'] as const)('%s', (dialect): void => {
    it('reads roots and field paths', (): void => {
      const references = readReferences(
        'form.amount > 1 && initiator.dept == "x" && form["title"] != ""',
        dialect,
      );

      expect(references.roots).toEqual(['form', 'initiator']);
      expect(references.formFieldKeys).toEqual(['amount', 'title']);
      expect(references.fieldPaths).toContainEqual({
        complete: true,
        root: 'initiator',
        segments: ['dept'],
      });
      expect(references.wholeRootReferences).toEqual([]);
      expect(references.computedKeys).toEqual([]);
    });

    it('scopes a macro variable to its macro', (): void => {
      const references = readReferences(
        'form.items.exists(row, row.qty > 1) && row.qty == 1',
        dialect,
      );

      // `row` inside the macro is bound; after `&&` it is a root.
      expect(references.roots).toEqual(['form', 'row']);
      expect(references.comprehensionDepth).toBe(1);
      expect(references.fieldPaths).toContainEqual({
        complete: true,
        root: 'row',
        segments: ['qty'],
      });
    });

    it('reports a computed key and a whole-root reference', (): void => {
      const references = readReferences(
        'form[form.key] == 1 || size(form) > 0',
        dialect,
      );

      expect(references.computedKeys).toEqual([
        { kind: 'INDEX', root: 'form' },
      ]);
      expect(references.wholeRootReferences).toEqual(['form']);
    });

    it('records function calls with their argument count', (): void => {
      const references = readReferences(
        'erp_band_v1(form.amount, 2) == "A" && size(form.tags) > 0',
        dialect,
      );

      expect(references.functionCalls).toEqual([
        { argumentCount: 2, name: 'erp_band_v1', receiver: false },
        { argumentCount: 1, name: 'size', receiver: false },
      ]);
    });

    it('finds reserved segments in members and literal keys', (): void => {
      expect(
        readReferences(
          'form.__proto__.x == 1 || form["constructor"] == 1',
          dialect,
        ).reservedSegments,
      ).toEqual(['__proto__', 'constructor']);
    });

    it('records guards, has() arguments, divisors and || operands', (): void => {
      const references = readReferences(
        'has(form.note) && form.title != null && 10 / form.amount > 1 || form.urgent == true',
        dialect,
      );

      expect(references.hasArguments).toEqual([
        { complete: true, root: 'form', segments: ['note'] },
      ]);
      expect(
        references.guardedFieldPaths.map((path) => path.segments[0]),
      ).toEqual(['note', 'title']);
      expect(references.divisorFieldPaths).toEqual([
        { complete: true, root: 'form', segments: ['amount'] },
      ]);
      expect(
        references.orOperandFieldPaths.map((path) => path.segments[0]),
      ).toEqual(['note', 'title', 'amount', 'urgent']);
    });

    it('answers PARSE_FAILED for an expression that does not parse', (): void => {
      expect(readExpressionReferences('form.amount >', dialect)).toEqual({
        limitExceeded: false,
        status: 'PARSE_FAILED',
      });
    });
  });

  describe('cel-v2 only', (): void => {
    it('counts nested comprehensions', (): void => {
      expect(
        readReferences('[1].all(a, [2].all(b, [3].all(c, a + b + c > 0)))')
          .comprehensionDepth,
      ).toBe(3);
    });

    // The evaluation guard refuses `cel` as a root, so `cel.bind` is not a
    // scope: the lint must not pass what every case would fail on.
    it('reads cel.bind as roots, which the lint refuses', (): void => {
      expect(readReferences('cel.bind(v, form.amount, v > 1)').roots).toEqual([
        'cel',
        'form',
        'v',
      ]);
      expect(
        errorCodes('cel.bind(v, form.amount, v > 1)', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual(['EXPR_ROOT_NOT_ALLOWED cel', 'EXPR_ROOT_NOT_ALLOWED v']);
    });

    it('reports a non-literal map key and a reserved map key', (): void => {
      const references = readReferences('{form.k: 1, "__proto__": 2}');

      expect(references.computedKeys).toEqual([
        { kind: 'MAP_KEY', root: null },
      ]);
      expect(references.reservedSegments).toEqual(['__proto__']);
    });

    it('answers a parse over the AST node limit as limitExceeded', (): void => {
      expect(
        readExpressionReferences(`1${' + 1'.repeat(150)}`, 'cel-v2'),
      ).toEqual({ limitExceeded: true, status: 'PARSE_FAILED' });
    });

    it('counts AST nodes', (): void => {
      expect(readReferences('form.amount > 1').nodeCount).toBe(4);
    });
  });
});

describe('lintCelV2Expression', (): void => {
  describe('Phase 23 P2 gate', (): void => {
    it.each([
      ['form["sec" + "ret"] == "x"', 'EXPR_COMPUTED_KEY'],
      ['string(form) != ""', 'EXPR_WHOLE_FORM_REFERENCE form'],
      ['form.__proto__.x == 1', 'EXPR_RESERVED_PATH_SEGMENT __proto__'],
      ['form["constructor"] == 1', 'EXPR_RESERVED_PATH_SEGMENT constructor'],
    ])('refuses %s', (expression, expected): void => {
      expect(
        errorCodes(expression, { usagePoint: 'ENTRY_CONDITION' }),
      ).toContain(expected);
    });

    it('accepts a literal string key', (): void => {
      expect(errorCodes('form["title"] == "x"', ENTRY)).toEqual([]);
    });
  });

  describe('roots (docs/24 §2.3, handover 3)', (): void => {
    it('refuses a root bound by a macro but read outside it', (): void => {
      expect(
        errorCodes('[1].exists(lastDecision, true) && lastDecision.d != ""', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual(['EXPR_ROOT_NOT_ALLOWED lastDecision']);
    });

    it('lets a macro read its own variable whatever its name', (): void => {
      expect(
        errorCodes('[1, 2].exists(lastDecision, lastDecision == 2)', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual([]);
    });

    it('allows lastDecision on an edge only', (): void => {
      expect(
        errorCodes('lastDecision.decision == "APPROVE"', {
          usagePoint: 'FLOW_CONDITION',
        }),
      ).toEqual([]);
      expect(
        errorCodes('lastDecision.decision == "APPROVE"', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual(['EXPR_ROOT_NOT_ALLOWED lastDecision']);
    });

    it('gives each use point its own roots', (): void => {
      expect(
        errorCodes('form.amount > 1', { usagePoint: 'INITIATOR_POLICY' }),
      ).toEqual(['EXPR_ROOT_NOT_ALLOWED form']);
      expect(
        errorCodes('principal.memberId != ""', {
          usagePoint: 'DELEGATION_CONDITION',
        }),
      ).toEqual([]);
      expect(
        errorCodes('row.qty * form.amount', {
          usagePoint: 'DATA_SOURCE_BINDING',
        }),
      ).toEqual([]);
      expect(
        errorCodes('row.qty', { usagePoint: 'NOTIFY_WEBHOOK_BINDING' }),
      ).toEqual(['EXPR_ROOT_NOT_ALLOWED row']);
    });

    it('does not check roots without a use point or allowlist', (): void => {
      expect(errorCodes('anything.goes == 1')).toEqual([]);
    });

    // P4's preview may take a use point from a client: one that is not a use
    // point (a prototype key included) fails closed instead of throwing.
    it.each(['toString', 'constructor', '__proto__', 'NOT_A_USE_POINT'])(
      'allows no root and no host function under the unknown use point %s',
      (usagePoint): void => {
        expect(
          errorCodes('form.a == 1', {
            usagePoint: usagePoint as unknown as 'ENTRY_CONDITION',
          }),
        ).toEqual(['EXPR_ROOT_NOT_ALLOWED form']);
        expect(
          errorCodes('erp_band_v1("x") == "A"', {
            functionRegistry: {
              assertPublishable: (): readonly string[] => [],
              get: () => null,
            },
            usagePoint: usagePoint as unknown as 'ENTRY_CONDITION',
          }),
        ).toEqual(['EXPR_FUNCTION_NOT_ALLOWED erp_band_v1']);
      },
    );
  });

  describe('map literals (handover 4)', (): void => {
    it.each([
      '{"constructor": 1}',
      '{"__proto__": {"a": 1}}',
      '{"a": 1, "prototype": 2}',
    ])('refuses the reserved key in %s', (expression): void => {
      expect(
        errorCodes(expression, { usagePoint: 'WEBHOOK_PAYLOAD' })[0],
      ).toMatch(/^EXPR_RESERVED_PATH_SEGMENT /u);
    });

    it('refuses a map key that is not a literal', (): void => {
      expect(
        errorCodes('{form.title: 1}', { usagePoint: 'WEBHOOK_PAYLOAD' }),
      ).toEqual(['EXPR_COMPUTED_KEY']);
    });

    it('accepts literal keys', (): void => {
      expect(
        errorCodes('{"a": form.title, "b": 2}', {
          ...ENTRY,
          usagePoint: 'WEBHOOK_PAYLOAD',
        }),
      ).toEqual([]);
    });
  });

  describe('complexity', (): void => {
    it('refuses comprehensions nested deeper than two', (): void => {
      expect(
        errorCodes('[1].all(a, [2].all(b, [3].all(c, a + b + c > 0)))'),
      ).toEqual(['EXPR_COMPREHENSION_NESTING']);
      expect(errorCodes('[1].all(a, [2].all(b, a + b > 0))')).toEqual([]);
    });

    it('refuses an expression over the AST node limit', (): void => {
      expect(errorCodes(`1${' + 1'.repeat(150)} > 0`)).toEqual([
        'EXPR_COMPLEXITY_EXCEEDED',
      ]);
    });

    it('reports a syntax error as EXPR_PARSE_FAILED', (): void => {
      expect(errorCodes('form.amount >')).toEqual(['EXPR_PARSE_FAILED']);
    });
  });

  describe('fields and types', (): void => {
    it('refuses a field the bound form does not have', (): void => {
      expect(errorCodes('form.missing == 1', ENTRY)).toEqual([
        'EXPR_FIELD_UNKNOWN missing',
      ]);
      expect(errorCodes('formData.missing == 1', ENTRY)).toEqual([
        'EXPR_FIELD_UNKNOWN missing',
      ]);
    });

    it('refuses a comparison the field type does not support', (): void => {
      expect(errorCodes('form.title > 1', ENTRY)).toEqual([
        'EXPR_FIELD_TYPE_MISMATCH title',
      ]);
      expect(errorCodes('form.amount.contains("1")', ENTRY)).toEqual([
        'EXPR_FIELD_TYPE_MISMATCH amount',
      ]);
    });

    it('accepts mixed int and double arithmetic', (): void => {
      expect(
        errorCodes('form.amount * 2 > 1.5 && form.price + 1 > 0', ENTRY),
      ).toEqual([]);
    });

    it('refuses a result type the use point cannot take', (): void => {
      expect(errorCodes('form.amount + 1', ENTRY)).toEqual([
        'EXPR_RESULT_TYPE_MISMATCH',
      ]);
      expect(
        errorCodes('form.title', {
          formSchema: SCHEMA,
          targetField: field('total', 'number'),
          usagePoint: 'SERVICE_FORM_FIELD_VALUE',
        }),
      ).toEqual(['EXPR_RESULT_TYPE_MISMATCH']);
      expect(
        errorCodes('form.amount * 2', {
          formSchema: SCHEMA,
          targetField: field('total', 'number'),
          usagePoint: 'SERVICE_FORM_FIELD_VALUE',
        }),
      ).toEqual([]);
      expect(
        errorCodes('form.watchers', {
          formSchema: SCHEMA,
          usagePoint: 'APPROVER_RESOLVER',
        }),
      ).toEqual([]);
      expect(
        errorCodes('form.amount > 1', {
          formSchema: SCHEMA,
          usagePoint: 'APPROVER_RESOLVER',
        }),
      ).toEqual(['EXPR_RESULT_TYPE_MISMATCH']);
    });

    it('types every field as dyn without a schema', (): void => {
      expect(
        errorCodes('form.anything > 1', { usagePoint: 'ENTRY_CONDITION' }),
      ).toEqual([]);
    });
  });

  describe('designer conditions (readConditionExpression)', (): void => {
    const OPERATORS: readonly WorkflowEdgeConditionOperator[] = [
      'EQUALS',
      'NOT_EQUALS',
      'GREATER_THAN',
      'GREATER_THAN_OR_EQUALS',
      'LESS_THAN',
      'LESS_THAN_OR_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ];
    const SAMPLE_VALUES: Readonly<Record<string, string>> = {
      boolean: 'true',
      money: '1000',
      number: '3',
    };
    const cases = SCHEMA.fields.flatMap((schemaField) =>
      OPERATORS.flatMap((operator) => {
        const expression = readConditionExpression(
          schemaField,
          operator,
          SAMPLE_VALUES[schemaField.type] ?? 'A',
        );

        return expression === undefined
          ? []
          : [[`${schemaField.fieldKey} ${operator}`, expression] as const];
      }),
    );

    it('produces some conditions to test', (): void => {
      expect(cases.length).toBeGreaterThan(40);
    });

    it.each(cases)('passes the lint: %s', (_name, expression): void => {
      expect(errorCodes(expression, ENTRY)).toEqual([]);
      expect(
        errorCodes(expression, { ...ENTRY, usagePoint: 'FLOW_CONDITION' }),
      ).toEqual([]);
    });
  });

  describe('functions (handover 6)', (): void => {
    // Like the real registry (docs/24 §3): the nine built-ins plus `hosts`.
    const registry = (
      hosts: readonly string[],
      parameterCount = 1,
    ): ExpressionFunctionAvailability => {
      const names = [...BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES, ...hosts];

      return {
        assertPublishable: (requested): readonly string[] => [
          ...new Set(requested.filter((name) => !names.includes(name))),
        ],
        get: (name) =>
          names.includes(name)
            ? {
                description: name,
                handler: (): null => null,
                label: name,
                name,
                parameters: Array.from(
                  { length: parameterCount },
                  (_v, index) => ({
                    name: `p${index}`,
                    type: 'dyn' as const,
                  }),
                ),
                returnType: 'string' as const,
              }
            : null,
      };
    };

    it('accepts engine functions and the nine built-ins without a registry', (): void => {
      expect(
        errorCodes('int(form.amount) > 1 && form.title.contains("a")', ENTRY),
      ).toEqual([]);
      expect(errorCodes('round(form.amount) > 1', ENTRY)).toEqual([]);
    });

    it('refuses a host function without a registry', (): void => {
      expect(errorCodes('erp_band_v1(form.amount) == "A"', ENTRY)).toEqual([
        'EXPR_FUNCTION_NOT_REGISTERED erp_band_v1',
      ]);
    });

    it('asks the registry which names are available', (): void => {
      expect(
        errorCodes('erp_band_v1(form.amount) == "A"', {
          ...ENTRY,
          functionRegistry: registry(['erp_band_v1']),
        }),
      ).toEqual([]);
      expect(
        errorCodes('erp_band_v2(form.amount) == "A"', {
          ...ENTRY,
          functionRegistry: registry(['erp_band_v1']),
        }),
      ).toEqual(['EXPR_FUNCTION_NOT_REGISTERED erp_band_v2']);
    });

    it('refuses a call with an argument count no registration has', (): void => {
      expect(
        errorCodes('erp_band_v1(form.amount, 2) == "A"', {
          ...ENTRY,
          functionRegistry: registry(['erp_band_v1']),
        }),
      ).toEqual(['EXPR_FUNCTION_NOT_REGISTERED erp_band_v1']);
    });

    it('refuses a method the engine does not have', (): void => {
      expect(errorCodes('form.title.erp_band_v1() == "A"', ENTRY)).toEqual([
        'EXPR_FUNCTION_NOT_REGISTERED erp_band_v1',
      ]);
    });

    it('refuses host functions in bindings, built-ins stay allowed', (): void => {
      const context: ExpressionLintContext = {
        functionRegistry: registry(['erp_band_v1']),
        usagePoint: 'DATA_SOURCE_BINDING',
      };

      expect(errorCodes('erp_band_v1(form.amount)', context)).toEqual([
        'EXPR_FUNCTION_NOT_ALLOWED erp_band_v1',
      ]);
      expect(errorCodes('upper(form.title)', context)).toEqual([]);
    });

    it('reads the host function names a rollback must find', (): void => {
      expect(
        readExpressionHostFunctionNames(
          'erp_band_v1(form.a) == upper(form.b) && size(form.c) > 0',
          'cel-v2',
        ),
      ).toEqual(['erp_band_v1', 'upper']);
      expect(
        readExpressionHostFunctionNames('size(form.c) > 0', 'cel-legacy'),
      ).toEqual([]);
      expect(readExpressionHostFunctionNames('form.a >', 'cel-v2')).toBeNull();
    });
  });

  describe('warnings (handover 5)', (): void => {
    const warns = (
      expression: string,
      expected: ExpressionLintCode,
      context: ExpressionLintContext = ENTRY,
    ): void => {
      expect(
        warningCodes(expression, context).map((line) => line.split(' ')[0]),
      ).toContain(expected);
    };

    it('warns about a field divisor (P35)', (): void => {
      warns('form.price / form.amount > 1', 'EXPR_DIVISOR_IS_FIELD');
      expect(warningCodes('form.price / 2.0 > 1', ENTRY)).toEqual([]);
    });

    it('warns about has() on a nested path (D20)', (): void => {
      warns('has(form.items.qty)', 'EXPR_HAS_NESTED_PARENT', {
        usagePoint: 'ENTRY_CONDITION',
      });
      expect(
        warningCodes('has(form.a) && has(form.a.b)', {
          usagePoint: 'ENTRY_CONDITION',
        }),
      ).toEqual([]);
    });

    it('warns when || can absorb a missing field (D21, P41, P42)', (): void => {
      warns('form.amount == 1 || form.urgent', 'EXPR_OR_ABSORBS_ERROR');
      expect(
        warningCodes('form.title == null || form.title == ""', ENTRY),
      ).toEqual([]);
    });

    it('warns about an optional field read without has()', (): void => {
      expect(warningCodes('form.note == "x"', ENTRY)).toEqual([
        'EXPR_OPTIONAL_FIELD_WITHOUT_HAS note',
      ]);
      expect(warningCodes('has(form.note) && form.note == "x"', ENTRY)).toEqual(
        [],
      );
      expect(warningCodes('form.title == "x"', ENTRY)).toEqual([]);
    });

    it('warns when a hidden field is copied into a visible one', (): void => {
      warns('form.secret', 'EXPR_HIDDEN_FIELD_COPIED', {
        formSchema: SCHEMA,
        targetField: SCHEMA.fields.find(
          (entry) => entry.fieldKey === 'visible',
        ),
        usagePoint: 'SERVICE_FORM_FIELD_VALUE',
      });
      expect(
        warningCodes('has(form.secret) ? form.secret : ""', {
          formSchema: SCHEMA,
          targetField: SCHEMA.fields.find(
            (entry) => entry.fieldKey === 'secret',
          ),
          usagePoint: 'SERVICE_FORM_FIELD_VALUE',
        }),
      ).toEqual([]);
    });

    it('warns when an approver expression reads the form', (): void => {
      warns('form.owner', 'EXPR_APPROVER_READS_FORM', {
        formSchema: SCHEMA,
        usagePoint: 'APPROVER_RESOLVER',
      });
      expect(
        warningCodes('initiator.memberId', { usagePoint: 'APPROVER_RESOLVER' }),
      ).toEqual([]);
    });

    it('never makes a warning an error', (): void => {
      expect(
        errorCodes('form.price / form.amount > 1 || form.note == "x"', ENTRY),
      ).toEqual([]);
    });
  });
});
