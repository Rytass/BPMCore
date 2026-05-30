import { readFallbackWorkflowDefinition } from './workflow-graph';
import { WorkflowDesignerState } from './workflow-command';
import {
  WORKFLOW_TOOLSET,
  WorkflowDirectory,
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
  it('returns an error for an unknown tool', async () => {
    const result = await executeWorkflowTool(
      initialState(),
      'no_such_tool',
      {},
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('未知的工具');
    }
  });

  it('runs a mutation tool and returns a fresh snapshot', async () => {
    const result = await executeWorkflowTool(
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

  it('runs a macro tool (insert_approval_step)', async () => {
    const result = await executeWorkflowTool(
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

  it('coerces a malformed approver resolver to the manager default instead of failing', async () => {
    const added = await executeWorkflowTool(
      initialState(),
      'add_node',
      { nodeType: 'userTask' },
      deterministicIds,
    );

    expect(added.ok).toBe(true);

    if (!(added.ok && added.kind === 'mutation')) {
      return;
    }

    const nodeId =
      added.snapshot.nodes.find((node) => node.type === 'userTask')?.id ?? '';
    const result = await executeWorkflowTool(
      added.result.state,
      'set_user_task_approver',
      { approverResolver: { type: 'DIRECT' }, nodeId },
      deterministicIds,
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'mutation') {
      const userTask = result.snapshot.nodes.find((node) => node.id === nodeId);

      expect(userTask?.summary).toContain('簽核人=ORG_MANAGER');
    }
  });

  it('draws a draft approval step with no approver supplied (manager default)', async () => {
    const result = await executeWorkflowTool(
      initialState(),
      'insert_approval_step',
      { label: '主管簽核' },
      deterministicIds,
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'macro') {
      const userTask = result.snapshot.nodes.find(
        (node) => node.type === 'userTask',
      );

      expect(userTask?.label).toBe('主管簽核');
      expect(result.snapshot.issue).toBeNull();
    }
  });

  it('answers the get_workflow_snapshot query without mutating', async () => {
    const result = await executeWorkflowTool(
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

  it('reports validation issues via validate_workflow', async () => {
    const result = await executeWorkflowTool(
      initialState(),
      'validate_workflow',
      {},
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'query') {
      expect(result.data).toEqual({ issue: null });
    }
  });

  it('search_members reports unavailable without an injected directory', async () => {
    const result = await executeWorkflowTool(initialState(), 'search_members', {
      query: '財務',
    });

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'query') {
      expect(result.data).toEqual({ available: false, items: [] });
    }
  });

  it('search_members returns members from the injected directory', async () => {
    const directory: WorkflowDirectory = {
      listOrgUnits: async () => [],
      listPositions: async () => [],
      searchMembers: async (query) => [
        { email: 'amy@example.com', id: 'm-1', name: `${query}-王小明` },
      ],
    };
    const result = await executeWorkflowTool(
      initialState(),
      'search_members',
      { query: '財務' },
      { directory },
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.kind === 'query') {
      expect(result.data).toEqual({
        available: true,
        items: [{ email: 'amy@example.com', id: 'm-1', name: '財務-王小明' }],
      });
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
