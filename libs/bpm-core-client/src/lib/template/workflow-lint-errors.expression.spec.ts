import {
  EXPRESSION_LINT_ERROR_CODES,
  EXPRESSION_LINT_WARNING_CODES,
  formatExpressionLintIssue,
  readExpressionLintSeverity,
  UNKNOWN_EXPRESSION_DIALECT_LINT_MESSAGE,
} from '@rytass/bpm-core-shared';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { WORKFLOW_EXPRESSION_LABELS } from '@rytass/bpm-core-shared/workflow-graph';
import {
  parseFormBindingExpressionLintLine,
  readFormBindingExpressionLintMessage,
  readWorkflowLintMessage,
  WORKFLOW_LINT_LANGUAGES,
} from './workflow-lint-errors';

/**
 * Phase 23 P2: every expression lint code (docs/24 §2.2) has designer copy in
 * both languages, and no copy carries the `'; '` the publish lint joins
 * lines with.
 */
const definition = {
  edges: [
    { data: {}, id: 'e1', source: 'start', target: 'set' },
    { data: {}, id: 'e2', source: 'set', target: 'end' },
  ],
  expressionDialect: 'cel-v2',
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'startEvent',
    },
    {
      data: {
        action: { fieldPath: 'total', type: 'SET_FORM_FIELD', value: 'form.a' },
        entryCondition: 'form.a > 1',
        label: '寫入總額',
      },
      id: 'set',
      position: { x: 0, y: 0 },
      type: 'serviceTask',
    },
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 0, y: 0 },
      type: 'endEvent',
    },
  ],
} as unknown as WorkflowDefinition;

const ALL_CODES = [
  ...EXPRESSION_LINT_ERROR_CODES,
  ...EXPRESSION_LINT_WARNING_CODES,
];

const line = (
  label: string,
  code: (typeof ALL_CODES)[number],
  subject?: string,
): string =>
  formatExpressionLintIssue({
    code,
    label,
    severity: readExpressionLintSeverity(code),
    ...(subject === undefined ? {} : { subject }),
  });

describe('readWorkflowLintMessage for expression lint lines', (): void => {
  describe.each(WORKFLOW_LINT_LANGUAGES)('%s', (language): void => {
    it.each(ALL_CODES)(
      'translates %s, with and without a subject',
      (code): void => {
        const edgeLine = line(
          WORKFLOW_EXPRESSION_LABELS.edgeCondition('e1'),
          code,
        );
        const subjectLine = line(
          WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition('set'),
          code,
          'amount',
        );
        const translated = [edgeLine, subjectLine].map((backend) =>
          readWorkflowLintMessage(backend, definition, language),
        );

        translated.forEach((text, index): void => {
          expect(text).not.toBe([edgeLine, subjectLine][index]);
          expect(text).not.toContain('; ');
          expect(text).not.toContain(code);
        });
      },
    );
  });

  it('names the place the way the canvas does', (): void => {
    expect(
      readWorkflowLintMessage(
        [
          line(
            WORKFLOW_EXPRESSION_LABELS.edgeCondition('e1'),
            'EXPR_FIELD_UNKNOWN',
            'missing',
          ),
          line(
            WORKFLOW_EXPRESSION_LABELS.nodeActionValue('set'),
            'EXPR_RESULT_TYPE_MISMATCH',
          ),
          line(
            'workflow.nodes.set.action.fieldPath',
            'EXPR_RESERVED_PATH_SEGMENT',
            '__proto__',
          ),
          line('initiatorPolicyCel', 'EXPR_ROOT_NOT_ALLOWED', 'form'),
        ].join('; '),
        definition,
      ).split('; '),
    ).toEqual([
      '從「開始」出發的連線條件：讀取了表單沒有的欄位「missing」。',
      '系統節點「寫入總額」的運算式：運算結果的型別不符合這個位置的要求（例如條件必須是真或假）。',
      '系統節點「寫入總額」寫入的欄位：路徑或鍵使用了保留名稱「__proto__」，請改名。',
      '發起權限條件：讀取了這裡不能使用的「form」。',
    ]);
  });

  it('leaves a line for a place this definition does not have as written', (): void => {
    const backend = line(
      'workflow.edges.ghost.data.condition',
      'EXPR_COMPUTED_KEY',
    );

    expect(readWorkflowLintMessage(backend, definition)).toBe(backend);
  });

  it('translates the unknown dialect line', (): void => {
    expect(
      readWorkflowLintMessage(
        UNKNOWN_EXPRESSION_DIALECT_LINT_MESSAGE,
        definition,
      ),
    ).toBe(
      '流程指定了這個版本不認得的運算式方言，請改為 cel-legacy 或 cel-v2。',
    );
  });
});

describe('formatExpressionLintIssue', (): void => {
  it('drops a subject that is not an identifier', (): void => {
    expect(
      formatExpressionLintIssue({
        code: 'EXPR_FIELD_UNKNOWN',
        label: 'x',
        severity: 'ERROR',
        subject: 'a; b',
      }),
    ).toBe('x: EXPR_FIELD_UNKNOWN');
  });
});

/**
 * Phase 23 P4／P5 integration: the `EXPRESSION` binding lines of a NOTIFY
 * webhook (publish lint) and of a form DataSource (form-schema lint) get the
 * same per-code copy, placed by name.
 */
describe('EXPRESSION binding lint lines', (): void => {
  const webhookLabel =
    'workflow.nodes.notify.action.webhooks[0].bindings[1].from.expression';
  const notifyDefinition = {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: { memberIds: [], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [
              {
                bindings: [
                  {
                    from: { fieldKey: 'amount', kind: 'FIELD' },
                    parameter: 'amount',
                  },
                  {
                    from: { expression: 'form.missing', kind: 'EXPRESSION' },
                    parameter: 'summary',
                  },
                ],
                endpoint: { key: 'erp.po', version: 1 },
                id: 'webhook_erp',
              },
            ],
          },
          label: '通知 ERP',
        },
        id: 'notify',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
    ],
  } as unknown as WorkflowDefinition;

  it('names a NOTIFY webhook parameter in both languages', (): void => {
    expect(
      readWorkflowLintMessage(
        `${webhookLabel}: EXPR_FIELD_UNKNOWN missing`,
        notifyDefinition,
      ),
    ).toBe(
      '知會節點「通知 ERP」第 1 個 Webhook 參數「summary」的運算式：讀取了表單沒有的欄位「missing」。',
    );
    expect(
      readWorkflowLintMessage(
        `${webhookLabel}: EXPR_RESULT_TYPE_MISMATCH`,
        notifyDefinition,
        'en',
      ),
    ).toMatch(
      /^The expression for the parameter "summary" of webhook 1 on the notify node "通知 ERP": /u,
    );
  });

  it('leaves a webhook line whose binding is not an EXPRESSION as written', (): void => {
    const fieldLine =
      'workflow.nodes.notify.action.webhooks[0].bindings[0].from.expression: EXPR_PARSE_FAILED';

    expect(readWorkflowLintMessage(fieldLine, notifyDefinition)).toBe(fieldLine);
  });

  it('parses a form binding line for a field and for a table column', (): void => {
    expect(
      parseFormBindingExpressionLintLine(
        'schema.fields[2].dataSource.bindings[0].from.expression: EXPR_FUNCTION_NOT_ALLOWED erp_band_v1',
      ),
    ).toEqual({
      bindingIndex: 0,
      code: 'EXPR_FUNCTION_NOT_ALLOWED',
      columnIndex: null,
      fieldIndex: 2,
      subject: 'erp_band_v1',
    });
    expect(
      parseFormBindingExpressionLintLine(
        'schema.fields[1].columns[3].dataSource.bindings[2].from.expression: EXPR_ROOT_NOT_ALLOWED instance',
      ),
    ).toEqual({
      bindingIndex: 2,
      code: 'EXPR_ROOT_NOT_ALLOWED',
      columnIndex: 3,
      fieldIndex: 1,
      subject: 'instance',
    });
    expect(
      parseFormBindingExpressionLintLine(
        'schema.fields[1].dataSource.bindings missing required parameter: plant',
      ),
    ).toBeNull();
    expect(
      parseFormBindingExpressionLintLine(
        `${webhookLabel}: EXPR_FIELD_UNKNOWN missing`,
      ),
    ).toBeNull();
  });

  it('words a form binding finding by the labels the builder shows', (): void => {
    expect(
      readFormBindingExpressionLintMessage({
        code: 'EXPR_FIELD_UNKNOWN',
        columnLabel: null,
        fieldLabel: '成本中心',
        parameterLabel: '廠別',
        subject: 'missing',
      }),
    ).toBe('「成本中心」欄位查詢條件「廠別」的運算式：讀取了表單沒有的欄位「missing」。');
    expect(
      readFormBindingExpressionLintMessage({
        code: 'EXPR_ROOT_NOT_ALLOWED',
        columnLabel: '成本中心',
        fieldLabel: '明細',
        parameterLabel: '廠別',
        subject: 'instance',
      }),
    ).toBe('「明細」表格「成本中心」欄查詢條件「廠別」的運算式：讀取了這裡不能使用的「instance」。');
  });

  it.each(WORKFLOW_LINT_LANGUAGES)(
    'has copy for every code with no separator in it (%s)',
    (language): void => {
      ALL_CODES.forEach((code): void => {
        [
          readFormBindingExpressionLintMessage(
            {
              code,
              columnLabel: 'C',
              fieldLabel: 'F',
              parameterLabel: 'P',
              subject: 'x',
            },
            language,
          ),
          readFormBindingExpressionLintMessage(
            { code, columnLabel: null, fieldLabel: 'F', parameterLabel: 'P' },
            language,
          ),
          readWorkflowLintMessage(
            `${webhookLabel}: ${code}`,
            notifyDefinition,
            language,
          ),
        ].forEach((message): void => {
          expect(message).not.toContain('; ');
          expect(message).not.toContain(code);
        });
      });
    },
  );
});
