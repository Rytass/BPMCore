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
  readFillChanges,
  readFillOrgUnitIds,
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

    // Two fill nodes on mutually exclusive branches may fill the same field;
    // whichever node comes first, the viewer's field still reads 本關補填.
    it('keeps 本關補填 on a field an earlier node also fills', () => {
      const earlier = {
        ...fillNode,
        data: {
          ...fillNode.data,
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' },
          ],
          label: '總務',
        },
        id: 'admin',
      } as UserTaskNode;
      const definition: WorkflowDefinition = {
        ...buildDefinition([]),
        nodes: [earlier, fillNode],
      };

      expect(readFillLabelMarkers(definition, fillNode)).toMatchObject({
        note: '本關補填',
      });
      expect(readFillLabelMarkers(definition, null)).toMatchObject({
        note: '總務補填',
      });
    });

    it('adds a seeded fill table the case does not store yet', () => {
      const seeded = [{ name: '' }];

      expect(
        readFillChanges({
          draft: { note: 'n' },
          node: fillNode,
          schema: SCHEMA,
          stored: {},
          values: { financeItems: seeded, note: 'n' },
        }),
      ).toEqual({ financeItems: seeded, note: 'n' });
      expect(
        readFillChanges({
          draft: {},
          node: fillNode,
          schema: SCHEMA,
          stored: { financeItems: [{ name: 'a' }] },
          values: { financeItems: [{ name: 'a' }] },
        }),
      ).toEqual({});
    });

    it('sends the fillable keys the approver changed and nothing else', () => {
      expect(
        readFillPayload({ note: 'n', title: 'T' }, fillNode),
      ).toEqual({ note: 'n' });
      expect(readFillPayload({}, fillNode)).toEqual({});
      expect(readFillPayload({ note: undefined }, fillNode)).toEqual({
        note: null,
      });
    });

    describe('a REQUIRED boolean fill field', () => {
      const BOOLEAN_SCHEMA: FormDefinitionSchema = {
        ...SCHEMA,
        fields: [
          ...SCHEMA.fields,
          {
            fieldKey: 'taxFree',
            label: '免稅',
            required: false,
            type: 'boolean',
          },
        ],
      };
      const booleanNode = (fill: 'OPTIONAL' | 'REQUIRED'): UserTaskNode =>
        ({
          ...fillNode,
          data: {
            ...fillNode.data,
            fieldAccess: [{ display: 'SHOW', fieldKey: 'taxFree', fill }],
          },
        }) as UserTaskNode;

      it('sends the shown false when the approver never touched it', () => {
        const changes = readFillChanges({
          draft: {},
          node: booleanNode('REQUIRED'),
          schema: BOOLEAN_SCHEMA,
          stored: {},
          values: { taxFree: false },
        });

        expect(changes).toEqual({ taxFree: false });
        expect(readFillPayload(changes, booleanNode('REQUIRED'))).toEqual({
          taxFree: false,
        });
      });

      it('sends the changed value over the shown one', () => {
        expect(
          readFillChanges({
            draft: { taxFree: true },
            node: booleanNode('REQUIRED'),
            schema: BOOLEAN_SCHEMA,
            stored: {},
            values: { taxFree: true },
          }),
        ).toEqual({ taxFree: true });
      });

      it('sends a stored true again without treating it as a change', () => {
        expect(
          readFillChanges({
            draft: {},
            node: booleanNode('REQUIRED'),
            schema: BOOLEAN_SCHEMA,
            stored: { taxFree: true },
            values: { taxFree: true },
          }),
        ).toEqual({ taxFree: true });
      });

      it('leaves an OPTIONAL boolean out when untouched', () => {
        expect(
          readFillChanges({
            draft: {},
            node: booleanNode('OPTIONAL'),
            schema: BOOLEAN_SCHEMA,
            stored: {},
            values: { taxFree: false },
          }),
        ).toEqual({});
      });
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
          '「財務明細」第 1 列的「品項」為必填；欄位「財務明細」最多 3 列',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({
        financeItems: '最多 3 列。',
        'financeItems[0].name': '此欄為必填。',
      });
      expect(
        readFillServerErrors(
          '缺少必填欄位：備註',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({ note: '備註為必填欄位。' });
    });

    it('maps the server\'s text length and format errors', () => {
      expect(
        readFillServerErrors(
          '欄位「備註」最多 20 個字；「財務明細」第 2 列的「品項」格式不正確',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({
        'financeItems[1].name': '格式不正確。',
        note: '最多 20 個字。',
      });
      expect(
        readFillServerErrors(
          '欄位「備註」至少需要 2 個字',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({ note: '至少需要 2 個字。' });
    });

    it('words a format error with the designer\'s message when the field has one', () => {
      const schema: FormDefinitionSchema = {
        ...SCHEMA,
        fields: SCHEMA.fields.map((field) =>
          field.fieldKey === 'note' && field.type === 'text'
            ? { ...field, pattern: '[A-Z]+', patternErrorMessage: '請填大寫英文' }
            : field,
        ),
      };

      expect(
        readFillServerErrors(
          '欄位「備註」格式不正確',
          schema,
          fillNode,
        ),
      ).toEqual({ note: '請填大寫英文' });
    });

    it('does not word a format check that ran out of time as a format error', () => {
      expect(
        readFillServerErrors(
          '欄位「備註」無法在時限內完成格式檢查',
          SCHEMA,
          fillNode,
        ),
      ).toEqual({ note: '格式檢查逾時，請縮短內容後再試，或請表單設計者簡化格式。' });
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
          '缺少必填欄位：備註, 說明',
          schema,
          fillNode,
        ),
      ).toEqual({ note: '備註, 說明為必填欄位。' });
      expect(
        readFillServerErrors('Task t-1 is not pending', SCHEMA, fillNode),
      ).toBeNull();
      expect(
        readFillServerErrors(
          '欄位「備註」為必填；something else',
          SCHEMA,
          fillNode,
        ),
      ).toBeNull();
    });

    describe('structured form data issues', () => {
      const LABELED_SCHEMA: FormDefinitionSchema = {
        fields: [
          { fieldKey: 'note', label: '備註', required: false, type: 'text' },
          { fieldKey: 'note2', label: '備註', required: false, type: 'text' },
          {
            fieldKey: 'memo',
            label: 'a「b」；c',
            required: false,
            type: 'text',
          },
          {
            columns: [
              { fieldKey: 'name', label: '品項', required: true, type: 'text' },
            ],
            fieldKey: 'financeItems',
            label: '財務明細',
            minRows: 0,
            required: false,
            type: 'table',
          },
        ],
        schemaVersion: 1,
      };
      const labeledNode = {
        ...fillNode,
        data: {
          ...fillNode.data,
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'note2', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'memo', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'financeItems', fill: 'OPTIONAL' },
          ],
        },
      } as UserTaskNode;

      it('lands on the field the path names when two fields share a label', () => {
        expect(
          readFillServerErrors(
            '欄位「備註」最多 20 個字',
            LABELED_SCHEMA,
            labeledNode,
            [
              {
                message: '欄位「備註」最多 20 個字',
                path: 'note2',
                reason: 'MAX_LENGTH',
                limit: 20,
              },
            ],
          ),
        ).toEqual({ note2: '最多 20 個字。' });
      });

      it('maps a file count past maxFiles, from the structured issue and from the message alone', () => {
        const fileSchema: FormDefinitionSchema = {
          fields: [
            {
              fieldKey: 'files',
              label: '附件',
              maxFiles: 2,
              required: false,
              type: 'file_upload',
            },
          ],
          schemaVersion: 1,
        };
        const fileNode = {
          ...fillNode,
          data: {
            ...fillNode.data,
            fieldAccess: [{ display: 'SHOW', fieldKey: 'files', fill: 'OPTIONAL' }],
          },
        } as UserTaskNode;
        const message = '欄位「附件」最多 2 個檔案';

        expect(
          readFillServerErrors(message, fileSchema, fileNode, [
            { message, path: 'files', reason: 'MAX_FILES', limit: 2 },
          ]),
        ).toEqual({ files: '最多 2 個檔案。' });
        expect(readFillServerErrors(message, fileSchema, fileNode)).toEqual({
          files: '最多 2 個檔案。',
        });
      });

      it('reads a label holding 「」 and ； by path, not by splitting the message', () => {
        expect(
          readFillServerErrors(
            '欄位「a「b」；c」為必填',
            LABELED_SCHEMA,
            labeledNode,
            [
              {
                message: '欄位「a「b」；c」為必填',
                path: 'memo',
                reason: 'REQUIRED',
              },
            ],
          ),
        ).toEqual({ memo: 'a「b」；c為必填欄位。' });
      });

      it('addresses a table cell by its row path', () => {
        expect(
          readFillServerErrors(
            '「財務明細」第 2 列的「品項」為必填',
            LABELED_SCHEMA,
            labeledNode,
            [
              {
                message: '「財務明細」第 2 列的「品項」為必填',
                path: 'financeItems[1].name',
                reason: 'REQUIRED',
              },
            ],
          ),
        ).toEqual({ 'financeItems[1].name': '此欄為必填。' });
      });

      it('words the same refusal the same way whether it came structured or as a message', () => {
        const message =
          '欄位「備註」最多 20 個字；「財務明細」第 2 列的「品項」格式不正確';
        const issues = [
          {
            message: '欄位「備註」最多 20 個字',
            path: 'note',
            reason: 'MAX_LENGTH' as const,
            limit: 20,
          },
          {
            message: '「財務明細」第 2 列的「品項」格式不正確',
            path: 'financeItems[1].name',
            reason: 'PATTERN' as const,
          },
        ];

        expect(
          readFillServerErrors(message, LABELED_SCHEMA, labeledNode, issues),
        ).toEqual(readFillServerErrors(message, LABELED_SCHEMA, labeledNode));
      });

      it('gives up when a path names nothing the approver can fill', () => {
        expect(
          readFillServerErrors('欄位「備註」為必填', LABELED_SCHEMA, labeledNode, [
            { message: '欄位「備註」為必填', path: 'ghost', reason: 'REQUIRED' },
          ]),
        ).toBeNull();
        expect(
          readFillServerErrors('欄位「備註」為必填', SCHEMA, fillNode, [
            { message: '欄位「備註」為必填', path: 'title', reason: 'REQUIRED' },
          ]),
        ).toBeNull();
      });
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

    it('names the members of a member field it knows', () => {
      const schema: FormDefinitionSchema = {
        fields: [
          { fieldKey: 'note', label: '經辦', required: false, type: 'member' },
        ],
        schemaVersion: 1,
      } as FormDefinitionSchema;

      expect(
        readFillSummary(
          schema,
          fillNode,
          { note: 'member-102' },
          new Map([['member-102', '吳採購專員']]),
        ),
      ).toEqual([{ fieldKey: 'note', label: '經辦', text: '吳採購專員' }]);
    });

    describe('org unit fields', () => {
      const orgSchema: FormDefinitionSchema = {
        fields: [
          { fieldKey: 'note', label: '部門', required: false, type: 'org_unit' },
        ],
        schemaVersion: 1,
      } as FormDefinitionSchema;

      it('names the unit it knows', () => {
        expect(
          readFillSummary(
            orgSchema,
            fillNode,
            { note: 'unit-1' },
            new Map(),
            new Map([['unit-1', '財務部']]),
          ),
        ).toEqual([{ fieldKey: 'note', label: '部門', text: '財務部' }]);
      });

      it('shows 未知組織, not the id, for a unit it cannot name', () => {
        expect(
          readFillSummary(orgSchema, fillNode, { note: 'unit-9' }),
        ).toEqual([{ fieldKey: 'note', label: '部門', text: '未知組織' }]);
        expect(
          readFillSummary(
            orgSchema,
            fillNode,
            { note: 'unit-9' },
            new Map([['unit-9', '不相干的成員名字']]),
            new Map([['unit-1', '財務部']]),
          ),
        ).toEqual([{ fieldKey: 'note', label: '部門', text: '未知組織' }]);
      });

      it('does not read member names for an org unit field, nor org names for a member field', () => {
        const memberSchema: FormDefinitionSchema = {
          fields: [
            { fieldKey: 'note', label: '經辦', required: false, type: 'member' },
          ],
          schemaVersion: 1,
        } as FormDefinitionSchema;

        expect(
          readFillSummary(
            memberSchema,
            fillNode,
            { note: 'id-1' },
            new Map([['id-1', '吳採購專員']]),
            new Map([['id-1', '財務部']]),
          ),
        ).toEqual([{ fieldKey: 'note', label: '經辦', text: '吳採購專員' }]);
        // A member id nobody named stays an id, unchanged by the new rule.
        expect(
          readFillSummary(memberSchema, fillNode, { note: 'id-2' }),
        ).toEqual([{ fieldKey: 'note', label: '經辦', text: 'id-2' }]);
      });
    });

    it('leaves out fields the approver did not touch', () => {
      expect(readFillSummary(SCHEMA, fillNode, { note: 'n' })).toEqual([
        { fieldKey: 'note', label: '備註', text: 'n' },
      ]);
    });
  });
});

describe('readFillOrgUnitIds', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      { fieldKey: 'a', label: 'A', required: false, type: 'org_unit' },
      { fieldKey: 'b', label: 'B', required: false, type: 'org_unit' },
      { fieldKey: 'm', label: 'M', required: false, type: 'member' },
      { fieldKey: 't', label: 'T', required: false, type: 'text' },
    ],
    schemaVersion: 1,
  } as FormDefinitionSchema;

  it('lists each org unit id once, in form order, and nothing else', () => {
    expect(
      readFillOrgUnitIds(schema, {
        a: 'unit-1',
        b: 'unit-1',
        m: 'member-1',
        t: 'unit-2',
      }),
    ).toEqual(['unit-1']);
    expect(readFillOrgUnitIds(schema, { a: 'unit-1', b: 'unit-2' })).toEqual([
      'unit-1',
      'unit-2',
    ]);
  });

  it('skips blank and non-string values', () => {
    expect(readFillOrgUnitIds(schema, { a: '', b: undefined })).toEqual([]);
    expect(readFillOrgUnitIds(schema, {})).toEqual([]);
  });
});
