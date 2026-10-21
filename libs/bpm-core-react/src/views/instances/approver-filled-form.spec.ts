import type {
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { validateFormRendererValues } from '@rytass/bpm-core-client/form';
import {
  isFillConflictMessage,
  readApplicantFormSchema,
  readApplicantSubmission,
  readFillDisplaySchema,
  readFillLabelMarkers,
  readFillPayload,
  readFillServerErrors,
  readFillSummary,
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

  describe('fill helpers', () => {
    const fillNode = {
      ...buildDefinition([]).nodes[0],
      data: {
        ...buildDefinition([]).nodes[0].data,
        fieldAccess: [
          { display: 'SHOW', fieldKey: 'note', fill: 'REQUIRED' },
          { display: 'SHOW', fieldKey: 'financeItems', fill: 'OPTIONAL' },
        ],
        label: '財務',
      },
    } as UserTaskNode;

    it('marks only the node\'s fill fields required per the node', () => {
      expect(
        readFillDisplaySchema(SCHEMA, fillNode).fields.map((field) => [
          field.fieldKey,
          field.required,
        ]),
      ).toEqual([
        ['title', true],
        ['financeItems', false],
        ['note', true],
      ]);
    });

    it('labels the viewer\'s fields 本關補填 and others by their fill node', () => {
      const definition: WorkflowDefinition = {
        ...buildDefinition([]),
        nodes: [
          fillNode,
          {
            ...fillNode,
            data: {
              ...fillNode.data,
              fieldAccess: [
                { display: 'SHOW', fieldKey: 'title', fill: 'OPTIONAL' },
              ],
              label: '總務',
            },
            id: 'admin',
          } as UserTaskNode,
        ],
      };

      expect(readFillLabelMarkers(definition, fillNode)).toEqual({
        financeItems: '本關補填',
        note: '本關補填',
        title: '總務補填',
      });
      expect(readFillLabelMarkers(definition, null)).toEqual({
        financeItems: '財務補填',
        note: '財務補填',
        title: '總務補填',
      });
    });

    it('sends every fillable key and nothing else', () => {
      expect(
        readFillPayload({ note: 'n', title: 'T' }, fillNode),
      ).toEqual({ financeItems: undefined, note: 'n' });
      expect(Object.keys(readFillPayload({}, fillNode)).sort()).toEqual([
        'financeItems',
        'note',
      ]);
    });

    it('recognises the conflict message as the client throws it', () => {
      expect(
        isFillConflictMessage(
          'Approval instance inst-1 form data changed; refresh and retry',
        ),
      ).toBe(true);
      expect(isFillConflictMessage('Task t-1 is not pending')).toBe(false);
    });

    it('maps the server\'s fill errors onto renderer paths', () => {
      expect(
        readFillServerErrors(
          'formData.financeItems[0].name is required; formData.financeItems must include at most 3 row(s)',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({
        financeItems: '最多 3 列。',
        'financeItems[0].name': '此欄為必填。',
      });
      expect(
        readFillServerErrors(
          'Form data is missing required fields: 備註',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({ note: '備註為必填欄位。' });
    });

    it('matches a missing label that holds a comma, and gives up on the unknown', () => {
      const schema: FormDefinitionSchema = {
        ...SCHEMA,
        fields: SCHEMA.fields.map((field) =>
          field.fieldKey === 'note' ? { ...field, label: '備註, 說明' } : field,
        ),
      };

      expect(
        readFillServerErrors(
          'Form data is missing required fields: 備註, 說明',
          schema,
          fillNode,
        ),
      ).toEqual({ note: '備註, 說明為必填欄位。' });
      expect(
        readFillServerErrors('Task t-1 is not pending', SCHEMA, fillNode),
      ).toBeNull();
      expect(
        readFillServerErrors(
          'formData.note is required; something else',
          SCHEMA,
          fillNode,
        ),
      ).toBeNull();
    });

    it('summarises each fill field for the approve dialog', () => {
      const schema: FormDefinitionSchema = {
        ...SCHEMA,
        fields: SCHEMA.fields.map((field) =>
          field.fieldKey === 'financeItems' && field.type === 'table'
            ? {
                ...field,
                columns: [
                  ...field.columns,
                  {
                    fieldKey: 'amount',
                    label: '金額',
                    required: false,
                    type: 'money' as const,
                  },
                ],
              }
            : field,
        ),
      };

      expect(
        readFillSummary(schema, fillNode, {
          financeItems: [
            { amount: 1200, name: 'a' },
            { amount: 300, name: 'b' },
          ],
          note: '',
        }),
      ).toEqual([
        { fieldKey: 'financeItems', label: '財務明細', text: '2 列，金額合計 1,500' },
        { fieldKey: 'note', label: '備註', text: '未填寫' },
      ]);
    });
  });
});
