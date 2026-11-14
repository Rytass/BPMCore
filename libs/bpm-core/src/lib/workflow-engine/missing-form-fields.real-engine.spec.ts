import { FormDefinitionSchema } from '@rytass/bpm-core-shared';
import { ConditionService } from '../condition/condition.service';
import type { ExpressionDialect } from '../condition/expression-dialect';
import { ExpressionRuntimeError } from '../condition/expression-errors';
import { fillMissingFormFields } from './missing-form-fields';

/**
 * ADR 27 §3 on the installed engines: what an expression on an unfilled field
 * answers with `expressionMissingFormFieldsAsNull` off (the stored data) and
 * on (the data filled by `fillMissingFormFields`). Runs in
 * jest.real-engine.config.cts; the jest shim reads a missing key as
 * `undefined` and would hide the difference.
 */

const SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: '金額', required: false, type: 'number' },
    { fieldKey: 'note', label: '備註', required: false, type: 'text' },
    {
      columns: [
        { fieldKey: 'qty', label: '數量', required: false, type: 'number' },
      ],
      fieldKey: 'items',
      label: '明細',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};
const STORED: Readonly<Record<string, unknown>> = { amount: 10 };

describe.each<ExpressionDialect>(['cel-v2', 'cel-legacy'])(
  'unfilled form fields on %s',
  (dialect: ExpressionDialect): void => {
    const service = new ConditionService();
    const evaluate = (
      expression: string,
      form: Readonly<Record<string, unknown>>,
    ): unknown =>
      service.evaluateValue(expression, { form }, 'entry', {
        allowedRootIdentifiers: ['form'],
        dialect,
      });
    const filled = fillMissingFormFields(STORED, SCHEMA);

    beforeAll((): void => {
      service.prepareEngine(dialect);
    });

    it('fills the unfilled top-level fields and keeps the stored ones', (): void => {
      expect(filled).toEqual({ amount: 10, items: [], note: null });
      expect(STORED).toEqual({ amount: 10 });
    });

    it('turns has(form.x) from false to true', (): void => {
      expect(evaluate('has(form.note)', STORED)).toBe(false);
      expect(evaluate('has(form.note)', filled)).toBe(true);
    });

    it('turns form.x == null from a missing-key error to true', (): void => {
      expect(() => evaluate('form.note == null', STORED)).toThrow(
        ExpressionRuntimeError,
      );
      expect(evaluate('form.note == null', filled)).toBe(true);
    });

    it('still fails form.x > 5, as a type error instead of a missing key', (): void => {
      expect(() => evaluate('form.note > 5', STORED)).toThrow(
        ExpressionRuntimeError,
      );
      expect(() => evaluate('form.note > 5', filled)).toThrow(
        ExpressionRuntimeError,
      );
    });

    it('reads an unfilled table as an empty list', (): void => {
      expect(() => evaluate('size(form.items) == 0', STORED)).toThrow(
        ExpressionRuntimeError,
      );
      expect(evaluate('size(form.items) == 0', filled)).toBe(true);
    });

    it('leaves a filled field as it was', (): void => {
      expect(evaluate('form.amount > 5', STORED)).toBe(true);
      expect(evaluate('form.amount > 5', filled)).toBe(true);
    });
  },
);
