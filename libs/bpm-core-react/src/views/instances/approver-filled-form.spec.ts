import type {
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { validateFormRendererValues } from '@rytass/bpm-core-client/form';
import {
  readApplicantFormSchema,
  readApplicantSubmission,
  readFillValidationSchema,
} from './approver-filled-form';

const SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'title', label: '標題', required: true, type: 'text' },
    {
      columns: [
        { fieldKey: 'name', label: '品項', required: true, type: 'text' },
      ],
      fieldKey: 'financeItems',
      label: '財務明細',
      minRows: 1,
      required: false,
      type: 'table',
    },
    { fieldKey: 'note', label: '備註', required: false, type: 'text' },
  ],
  schemaVersion: 1,
};

const buildDefinition = (
  fillableFieldKeys: readonly string[],
): WorkflowDefinition => ({
  edges: [],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: false,
        approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
        decisionPolicy: { type: 'SINGLE' },
        fieldAccess: fillableFieldKeys.map((fieldKey) => ({
          display: 'SHOW' as const,
          fieldKey,
          fill: 'OPTIONAL' as const,
        })),
        label: 'finance',
        returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      },
      id: 'finance',
      position: { x: 0, y: 0 },
      type: 'userTask',
    },
  ],
});

describe('approver-filled form helpers', () => {
  describe('readApplicantFormSchema', () => {
    it('drops the fields an approver fills in', () => {
      const result = readApplicantFormSchema(
        SCHEMA,
        buildDefinition(['financeItems']),
      );

      expect(result.fields.map((field) => field.fieldKey)).toEqual([
        'title',
        'note',
      ]);
      expect(result.schemaVersion).toBe(1);
    });

    it('returns an equal schema when no field is approver-filled', () => {
      expect(readApplicantFormSchema(SCHEMA, buildDefinition([]))).toEqual(
        SCHEMA,
      );
    });

    it('does not mutate its input', () => {
      const input: FormDefinitionSchema = JSON.parse(
        JSON.stringify(SCHEMA),
      ) as FormDefinitionSchema;

      readApplicantFormSchema(input, buildDefinition(['financeItems']));

      expect(input).toEqual(SCHEMA);
    });
  });

  describe('readApplicantSubmission', () => {
    it('strips approver-filled keys from the payload', () => {
      const values = {
        financeItems: [{ name: 'x' }],
        note: 'hello',
        title: 'T',
      };

      expect(
        readApplicantSubmission(values, buildDefinition(['financeItems'])),
      ).toEqual({ note: 'hello', title: 'T' });
      expect(values).toHaveProperty('financeItems');
    });

    it('keeps everything when no field is approver-filled', () => {
      const values = { note: 'hello', title: 'T' };

      expect(readApplicantSubmission(values, buildDefinition([]))).toEqual(
        values,
      );
    });
  });

  describe('readFillValidationSchema', () => {
    const node = {
      ...buildDefinition([]).nodes[0],
      data: {
        ...buildDefinition([]).nodes[0].data,
        fieldAccess: [
          { display: 'SHOW', fieldKey: 'note', fill: 'REQUIRED' },
          { display: 'SHOW', fieldKey: 'financeItems', fill: 'OPTIONAL' },
          { display: 'SHOW', fieldKey: 'title', fill: 'NONE' },
        ],
      },
    } as UserTaskNode;
    const uiSchema = { layout: [], schemaVersion: 1 };

    it("keeps only the node's fillable fields, required as the node says", () => {
      const result = readFillValidationSchema(SCHEMA, node);

      expect(
        result.fields.map((field) => [field.fieldKey, field.required]),
      ).toEqual([
        ['financeItems', false],
        ['note', true],
      ]);
    });

    // Mirrors the server's fill check: a REQUIRED blank field fails, an
    // OPTIONAL table still answers to its own minRows, and a field the node
    // does not let them fill is never checked.
    it('validates a fill the way the server does', () => {
      const schema = readFillValidationSchema(SCHEMA, node);

      expect(
        validateFormRendererValues({
          schema,
          uiSchema,
          values: { financeItems: [], note: '  ', title: '' },
        }).errors,
      ).toEqual({
        financeItems: '財務明細至少需要 1 列。',
        note: '備註為必填欄位。',
      });
      expect(
        validateFormRendererValues({
          schema,
          uiSchema,
          values: { financeItems: [{ name: 'x' }], note: 'ok' },
        }).valid,
      ).toBe(true);
    });

    it('does not mutate its input', () => {
      const input = JSON.parse(JSON.stringify(SCHEMA)) as FormDefinitionSchema;

      readFillValidationSchema(input, node);

      expect(input).toEqual(SCHEMA);
    });
  });
});
