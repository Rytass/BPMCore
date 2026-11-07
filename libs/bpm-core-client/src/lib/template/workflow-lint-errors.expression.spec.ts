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
