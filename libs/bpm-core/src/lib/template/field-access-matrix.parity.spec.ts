import { readFieldAccessMatrix } from '@rytass/bpm-core-shared';
import {
  FieldAccessEntry,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { lintWorkflowDefinition } from './workflow-definition.validator';

// The designer's field access matrix and the publish lint read one rule set
// (`field-access-lint` in shared). This pins that the lint reports exactly the
// matrix's definition-level issues, so neither can drift into a rule of its
// own. Form-bound issues are checked on publish (`TemplateService`) and are
// not part of `lintWorkflowDefinition`.
const FORM_CODES: ReadonlySet<string> = new Set([
  'applicantRuleReadsApproverFilled',
  'approverFilledFieldDataSource',
  'approverFilledFieldFileUpload',
  'approverFilledFieldFormRule',
  'approverFilledRequiredBoolean',
  'approverFilledTableDataSourceColumn',
  'fieldAccessUnknownField',
]);

const edge = (source: string, target: string): WorkflowEdge => ({
  data: {},
  id: `edge_${source}_${target}`,
  source,
  target,
  type: 'smoothstep',
});

const userTask = (
  id: string,
  fieldAccess: readonly FieldAccessEntry[],
  data: Readonly<Record<string, unknown>> = {},
): UserTaskNode =>
  ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess,
      label: id,
      returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      ...data,
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  }) as UserTaskNode;

const event = (id: string, type: 'endEvent' | 'startEvent'): WorkflowNode => ({
  data: { label: id },
  id,
  position: { x: 0, y: 0 },
  type,
});

describe('field access matrix and publish lint parity', () => {
  it('reports the same definition-level issues in the same order', () => {
    const definition: WorkflowDefinition = {
      edges: [
        edge('start', 'task_a'),
        edge('task_a', 'task_b'),
        edge('task_b', 'write'),
        edge('write', 'end'),
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        event('start', 'startEvent'),
        userTask(
          'task_a',
          [
            { display: 'SHOW', fieldKey: 'amount', fill: 'REQUIRED' },
            { display: 'SHOW', fieldKey: 'amount', fill: 'REQUIRED' },
          ],
          {
            decisionPolicy: { quorum: 2, type: 'QUORUM' },
            fieldPermissions: [],
          },
        ),
        userTask('task_b', [
          { display: 'HIDE', fieldKey: 'amount', fill: 'OPTIONAL' },
        ]),
        {
          data: {
            action: {
              fieldPath: 'form.amount',
              type: 'SET_FORM_FIELD',
              value: '1',
            },
            label: 'write',
            triggerMode: 'AND',
          },
          id: 'write',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
        event('end', 'endEvent'),
      ],
    };
    const matrixMessages = readFieldAccessMatrix(definition, null)
      .issues.filter((issue) => !FORM_CODES.has(issue.code))
      .map((issue) => issue.message);

    expect(matrixMessages.length).toBeGreaterThanOrEqual(6);
    expect(lintWorkflowDefinition(definition).errors).toEqual(matrixMessages);
  });
});
