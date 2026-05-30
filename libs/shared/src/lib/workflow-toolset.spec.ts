import { readFallbackWorkflowDefinition } from './workflow-graph';
import { WorkflowDesignerState } from './workflow-command';
import {
  WORKFLOW_TOOLSET,
  WorkflowSnapshot,
  executeWorkflowTool,
  readWorkflowSnapshot,
} from './workflow-toolset';

function initialState(): WorkflowDesignerState {
  return {
    definition: readFallbackWorkflowDefinition(),
    editingEdgeId: null,
    formDefinitionVersionId: null,
    formSchema: null,
    initiatorPolicyCel: null,
    selectedEdgeIds: [],
    selectedNodeId: 'start',
  };
}

const deterministicIds = {
  createEdgeId: ((): ((source: string, target: string) => string) => {
    let counter = 0;

    return (source: string, target: string): string =>
      `edge_${source}_${target}_${(counter += 1)}`;
  })(),
};

describe('WORKFLOW_TOOLSET', () => {
  it('every tool has a unique name and an object input schema', () => {
    const names = WORKFLOW_TOOLSET.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);

    WORKFLOW_TOOLSET.forEach((tool) => {
      expect(tool.inputSchema['type']).toBe('object');
      expect(['mutation', 'macro', 'query']).toContain(tool.kind);
    });
  });
});

describe('executeWorkflowTool', () => {
  it('returns an error for an unknown tool', () => {
    const result = executeWorkflowTool(initialState(), 'no_such_tool', {});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('未知的工具');
    }
  });

  it('runs a mutation tool and returns a fresh snapshot', () => {
    const result = executeWorkflowTool(
      initialState(),
      'add_node',
      { nodeType: 'userTask' },
      deterministicIds,
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'mutation') {
      expect(
        result.snapshot.nodes.some((node) => node.type === 'userTask'),
      ).toBe(true);
    }
  });

  it('runs a macro tool (insert_approval_step)', () => {
    const result = executeWorkflowTool(
      initialState(),
      'insert_approval_step',
      {
        approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
        label: '主管簽核',
      },
      deterministicIds,
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'macro') {
      const userTask = result.snapshot.nodes.find(
        (node) => node.type === 'userTask',
      );

      expect(userTask?.label).toBe('主管簽核');
    }
  });

  it('rejects a malformed approver resolver', () => {
    const result = executeWorkflowTool(initialState(), 'set_user_task_approver', {
      approverResolver: { type: 'DIRECT' },
      nodeId: 'whatever',
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('缺少必要欄位');
    }
  });

  it('answers the get_workflow_snapshot query without mutating', () => {
    const result = executeWorkflowTool(
      initialState(),
      'get_workflow_snapshot',
      {},
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'query') {
      const snapshot = result.data as WorkflowSnapshot;

      expect(snapshot.nodes.map((node) => node.type)).toEqual([
        'startEvent',
        'endEvent',
      ]);
    }
  });

  it('reports validation issues via validate_workflow', () => {
    const result = executeWorkflowTool(initialState(), 'validate_workflow', {});

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'query') {
      expect(result.data).toEqual({ issue: null });
    }
  });
});

describe('readWorkflowSnapshot', () => {
  it('summarises nodes and selection', () => {
    const snapshot = readWorkflowSnapshot(initialState());

    expect(snapshot.selectedNodeId).toBe('start');
    expect(snapshot.issue).toBeNull();
    expect(snapshot.nodes).toHaveLength(2);
  });
});
