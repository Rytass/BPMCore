import type {
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import type { WorkflowEdgeConditionOperator } from '@rytass/bpm-core-shared/workflow';
import {
  readConditionExpression,
  readConditionOperatorIds,
} from '@rytass/bpm-core-shared/workflow-graph';
import { ConditionService } from './condition.service';

/**
 * The guarded conditions the designer compiles (`has(form.x) && (…)`) under
 * cel-v2, the dialect every new template uses. They must pass the publish lint
 * for the field's own type, and an unfilled field (key absent or `null`) must
 * give the operator's "empty" answer instead of failing. Runs in
 * jest.real-engine.config.cts against the real engine.
 */

const FIELDS: readonly FormFieldDefinition[] = [
  { fieldKey: 'agent', label: '代理人', required: false, type: 'text' },
  { fieldKey: 'amount', label: '金額', required: false, type: 'number' },
  { fieldKey: 'price', label: '單價', required: false, type: 'money' },
  { fieldKey: 'due', label: '期限', required: false, type: 'date' },
  { fieldKey: 'urgent', label: '急件', required: false, type: 'boolean' },
  {
    fieldKey: 'plant',
    label: '廠別',
    options: [
      { label: 'TW01', value: 'TW01' },
      { label: 'TW02', value: 'TW02' },
    ],
    required: false,
    type: 'select',
  },
] as readonly FormFieldDefinition[];

const SCHEMA = {
  fields: FIELDS,
  schemaVersion: 1,
} as unknown as FormDefinitionSchema;

const SAMPLE_VALUE: Readonly<Record<string, string>> = {
  agent: 'someone',
  amount: '5',
  due: '2026-01-01',
  plant: 'TW01',
  price: '5',
  urgent: 'true',
};

const UNFILLED_ANSWER: Readonly<Record<WorkflowEdgeConditionOperator, boolean>> =
  {
    EQUALS: false,
    GREATER_THAN: false,
    GREATER_THAN_OR_EQUALS: false,
    IS_EMPTY: true,
    IS_FILLED: false,
    LESS_THAN: false,
    LESS_THAN_OR_EQUALS: false,
    NOT_EQUALS: true,
  };

const service = new ConditionService();

const cases = FIELDS.flatMap((field) =>
  readConditionOperatorIds(field).map(
    (operator): readonly [string, FormFieldDefinition, WorkflowEdgeConditionOperator, string] => [
      `${field.type} ${operator}`,
      field,
      operator,
      readConditionExpression(field, operator, SAMPLE_VALUE[field.fieldKey]) ?? '',
    ],
  ),
);

describe('designer-compiled conditions under cel-v2', (): void => {
  it('compiles a condition for every case', (): void => {
    expect(cases.length).toBeGreaterThan(0);
    cases.forEach(([, , , expression]) => {
      expect(expression).not.toBe('');
    });
  });

  it.each(cases)('passes the publish lint: %s', (_name, _field, _operator, expression): void => {
    expect(
      service.lintExpression(expression, 'edge', {
        dialect: 'cel-v2',
        formSchema: SCHEMA,
        usagePoint: 'FLOW_CONDITION',
      }),
    ).toEqual([]);
  });

  it.each(cases)(
    'gives the unfilled answer for an absent key or null: %s',
    (_name, field, operator, expression): void => {
      [{}, { [field.fieldKey]: null }].forEach((form) => {
        expect(
          service.evaluateBoolean(expression, { form }, 'edge', {
            dialect: 'cel-v2',
          }),
        ).toBe(UNFILLED_ANSWER[operator]);
      });
    },
  );
});
