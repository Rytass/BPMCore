import { lintWorkflowDefinition } from './workflow-definition.validator';
import { WORKFLOW_LINT_MESSAGES } from '@rytass/bpm-core-shared/workflow-graph';
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
    expect(WORKFLOW_LINT_MESSAGES.fieldPermissionAutoApprove('n1')).toBe(
      'workflow.nodes.n1.sla.onTimeout cannot be AUTO_APPROVE on a node with editable fields',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldPermissionDuplicate('n1', 'amount')).toBe(
      'workflow.nodes.n1.fieldPermissions lists a field more than once: amount',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.fieldPermissionEditableInvisible('n1', 'amount'),
    ).toBe(
      'workflow.nodes.n1.fieldPermissions cannot make a field editable while it is not visible: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldPermissionGroupPolicy('n1')).toBe(
      'workflow.nodes.n1.fieldPermissions cannot make fields editable on a PARALLEL_ALL or QUORUM node',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.fieldPermissionNestedPath('n1', 'items.price'),
    ).toBe(
      'workflow.nodes.n1.fieldPermissions must name a top-level form field, not a nested path: items.price',
    );
    expect(
      WORKFLOW_LINT_MESSAGES.fieldPermissionRequiredNotEditable('n1', 'amount'),
    ).toBe(
      'workflow.nodes.n1.fieldPermissions can only require a field that is editable: amount',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldPermissionSkipNode('n1')).toBe(
      'workflow.nodes.n1.excludeInitiator.whenEmpty cannot be SKIP_NODE on a node with editable fields',
    );
    expect(WORKFLOW_LINT_MESSAGES.fieldPermissionsInvalid('n1')).toBe(
      'workflow.nodes.n1.fieldPermissions is invalid',
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
