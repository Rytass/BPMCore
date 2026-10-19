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
    expect(WORKFLOW_LINT_MESSAGES.noPathToEnd('n1')).toBe(
      'workflow.nodes.n1 does not have a path to an endEvent',
    );
    expect(WORKFLOW_LINT_MESSAGES.notifyOutgoingEdge('e1')).toBe(
      'workflow.edges.e1.source cannot be a NOTIFY serviceTask',
    );
    expect(WORKFLOW_LINT_MESSAGES.parallelJoinIncomingEdges('n1')).toBe(
      'workflow.nodes.n1 parallel join requires at least two incoming edges',
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
