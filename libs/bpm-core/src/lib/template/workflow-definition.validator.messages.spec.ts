import { lintWorkflowDefinition } from './workflow-definition.validator';
import {
  APPLICANT_FIELD_CONDITION_RULES,
  APPROVER_FILLED_FORM_RULES,
  WORKFLOW_EXPRESSION_LABELS,
  WORKFLOW_LINT_MESSAGES,
} from '@rytass/bpm-core-shared/workflow-graph';
import {
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';

// The structural lint lines are a contract: hosts may match them, and the
// designer translates them by exact text. These cases pin the wording the
// backend actually emits, so a reword shows up here rather than as an English
// line on the designer's screen.

const START: WorkflowNode = {
  data: { label: '開始' },
  id: 'start',
  position: { x: 0, y: 0 },
  type: 'startEvent',
};

const END: WorkflowNode = {
  data: { endState: 'APPROVED', label: '完成' },
  id: 'end',
  position: { x: 0, y: 0 },
  type: 'endEvent',
};

function createUserTask(id: string, label: string): WorkflowNode {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: {
        baseFromInitiator: true,
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  } as WorkflowNode;
}

function createWorkflow(
  nodes: readonly WorkflowNode[],
  edges: readonly (readonly [string, string, string])[],
): WorkflowDefinition {
  return {
    edges: edges.map(([id, source, target]) => ({
      data: {},
      id,
      source,
      target,
    })),
    meta: { schemaVersion: 1 },
    nodes: [...nodes],
  } as WorkflowDefinition;
}

describe('workflow lint message wording', (): void => {
  it('names the form rules an approver-filled field cannot carry', (): void => {
    expect(APPROVER_FILLED_FORM_RULES).toEqual([
      'required',
      'requiredWhen',
      'visibleWhen',
      'readonlyWhen',
      'hidden',
      'defaultValue',
    ]);
  });

  it('names the applicant rules that cannot read an approver-filled field', (): void => {
    expect(APPLICANT_FIELD_CONDITION_RULES).toEqual([
      'requiredWhen',
      'visibleWhen',
      'readonlyWhen',
    ]);
  });

  // The labels also appear in the CEL lint lines published before field
  // access existed, so they must stay character for character.
  it('builds every expression label with its published wording', (): void => {
    expect(WORKFLOW_EXPRESSION_LABELS.edgeCondition('e1')).toBe(
      'workflow.edges.e1.data.condition',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.edgeConditionFieldKey('e1')).toBe(
      'workflow.edges.e1.data.conditionFieldKey',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.nodeActionPayload('n1')).toBe(
      'workflow.nodes.n1.data.action.payload',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.nodeActionRecipientsExpression('n1')).toBe(
      'workflow.nodes.n1.data.action.recipients.expression',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.nodeActionValue('n1')).toBe(
      'workflow.nodes.n1.data.action.value',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.nodeApproverResolverExpression('n1')).toBe(
      'workflow.nodes.n1.data.approverResolver.expression',
    );
    expect(WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition('n1')).toBe(
      'workflow.nodes.n1.data.entryCondition',
    );
  });

  it('builds every structural line with its published wording', (): void => {
    expect(WORKFLOW_LINT_MESSAGES.blankNodeLabel(2)).toBe(
      'workflow.nodes[2].data.label must be a non-empty string',
    );
    expect(WORKFLOW_LINT_MESSAGES.cycle('n1')).toBe(
      'workflow contains a cycle involving node n1',
    );
    expect(WORKFLOW_LINT_MESSAGES.endEventMissing()).toBe(
      'workflow must include at least one endEvent node',
    );
    expect(WORKFLOW_LINT_MESSAGES.exclusiveSplitDefaultEdge('n1')).toBe(
      'workflow.nodes.n1 must include a default outgoing edge',
    );
    expect(WORKFLOW_LINT_MESSAGES.exclusiveSplitOutgoingEdges('n1')).toBe(
      'workflow.nodes.n1 exclusive split requires at least two outgoing edges',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessAutoApprove('n1')).toBe(
      'workflow.nodes.n1.sla.onTimeout cannot be AUTO_APPROVE on a node with fillable fields',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessDuplicate('n1', 'amount')).toBe(
      'workflow.nodes.n1.fieldAccess lists a field more than once: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessFillHidden('n1', 'amount')).toBe(
      'workflow.nodes.n1.fieldAccess cannot let a field be filled in while it is hidden: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessGroupPolicy('n1')).toBe(
      'workflow.nodes.n1.fieldAccess cannot make fields fillable on a PARALLEL_ALL or QUORUM node',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessSkipNode('n1')).toBe(
      'workflow.nodes.n1.excludeInitiator.whenEmpty cannot be SKIP_NODE on a node with fillable fields',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessInvalid('n1')).toBe(
      'workflow.nodes.n1.fieldAccess is invalid',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessUnknownField('n1', 'amount')).toBe(
      'workflow.nodes.n1.fieldAccess must name a field of the bound form: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.legacyFieldPermissions('n1')).toBe(
      'workflow.nodes.n1.fieldPermissions is no longer supported: remove it and use fieldAccess instead',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.applicantRuleReadsApproverFilled(
        'reason',
        'visibleWhen',
        'amount',
      ),
    ).toBe(
      'formData.reason.visibleWhen reads formData.amount, which an approver fills in after the applicant submits',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.approverFilledMultipleFillNodesOnPath(
        'amount',
        'n1',
        'n2',
      ),
    ).toBe(
      'formData.amount is filled in by both workflow.nodes.n1 and workflow.nodes.n2, which lie on the same path',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.approverFilledFieldFormRule('amount', 'hidden'),
    ).toBe(
      'formData.amount is filled in by an approver, so the form cannot set hidden on it',
    );
    expect(WORKFLOW_LINT_MESSAGES.approverFilledFieldDataSource('amount')).toBe(
      'formData.amount is filled in by an approver, so it cannot be a data-source field',
    );
    expect(WORKFLOW_LINT_MESSAGES.approverFilledFieldFileUpload('amount')).toBe(
      'formData.amount is filled in by an approver, so it cannot be a file upload field',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.approverFilledTableDataSourceColumn('items'),
    ).toBe(
      'formData.items is filled in by an approver, so its table cannot have a data-source column',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.approverFilledRequiredBoolean('n1', 'taxFree'),
    ).toBe(
      'workflow.nodes.n1.fieldAccess cannot require the boolean field: taxFree',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.approverFilledFieldReadEarly(
        'workflow.edges.e1.data.condition',
        'amount',
      ),
    ).toBe(
      'workflow.edges.e1.data.condition reads formData.amount before an approver fills it in',
    );
    expect(WORKFLOW_LINT_MESSAGES.noPathToEnd('n1')).toBe(
      'workflow.nodes.n1 does not have a path to an endEvent',
    );
    expect(WORKFLOW_LINT_MESSAGES.notifyOutgoingEdge('e1')).toBe(
      'workflow.edges.e1.source cannot be a NOTIFY serviceTask',
    );
    expect(WORKFLOW_LINT_MESSAGES.parallelJoinIncomingEdges('n1')).toBe(
      'workflow.nodes.n1 parallel join requires at least two incoming edges',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.setFormFieldApproverFilled('n1', 'amount'),
    ).toBe(
      'workflow.nodes.n1.action.fieldPath cannot write a field an approver fills in: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.startEventCount()).toBe(
      'workflow must include exactly one startEvent node',
    );
    expect(WORKFLOW_LINT_MESSAGES.unreachableNode('n1')).toBe(
      'workflow.nodes.n1 is not reachable from start',
    );
  });

  it('names a blank label by the node index', (): void => {
    const workflow = createWorkflow(
      [START, createUserTask('task', '  '), END],
      [
        ['e1', 'start', 'task'],
        ['e2', 'task', 'end'],
      ],
    );

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes[1].data.label must be a non-empty string',
    );
  });

  it('reports a missing start and end node', (): void => {
    const workflow = createWorkflow([createUserTask('task', '簽核')], []);

    expect(lintWorkflowDefinition(workflow).errors).toEqual(
      expect.arrayContaining([
        'workflow must include exactly one startEvent node',
        'workflow must include at least one endEvent node',
      ]),
    );
  });

  it('reports a parallel join with a single incoming edge', (): void => {
    const join = {
      data: { direction: 'join', label: '會簽匯合' },
      id: 'join',
      position: { x: 0, y: 0 },
      type: 'parallelGateway',
    } as WorkflowNode;
    const workflow = createWorkflow(
      [START, join, END],
      [
        ['e1', 'start', 'join'],
        ['e2', 'join', 'end'],
      ],
    );

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.join parallel join requires at least two incoming edges',
    );
  });
});
