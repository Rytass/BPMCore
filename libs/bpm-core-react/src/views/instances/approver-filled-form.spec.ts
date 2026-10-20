import type { WorkflowDefinition } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  readApplicantFormSchema,
  readApplicantSubmission,
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
  editableFieldKeys: readonly string[],
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
        fieldPermissions: editableFieldKeys.map((fieldPath) => ({
          editable: true,
          fieldPath,
          required: false,
          visible: true,
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
});
