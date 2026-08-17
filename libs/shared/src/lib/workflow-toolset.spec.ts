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

describe('SLA and return-comment tools', () => {
  async function stateWithUserTask(): Promise<WorkflowDesignerState> {
    const result = await executeWorkflowTool(
      initialState(),
      'add_node',
      { nodeType: 'userTask' },
      deterministicIds,
    );

    if (!result.ok || result.kind === 'query') {
      throw new Error('Expected a mutation result');
    }

    return result.result.state;
  }

  function readUserTaskData(
    state: WorkflowDesignerState,
  ): Record<string, unknown> {
    const node = state.definition.nodes.find(
      (candidate) => candidate.type === 'userTask',
    );

    if (node?.type !== 'userTask') {
      throw new Error('Expected a user task node');
    }

    return node.data as unknown as Record<string, unknown>;
  }

  async function runTool(
    state: WorkflowDesignerState,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowDesignerState> {
    const result = await executeWorkflowTool(
      state,
      name,
      input,
      deterministicIds,
    );

    if (!result.ok || result.kind === 'query') {
      throw new Error(
        result.ok ? 'Expected a mutation result' : `Tool failed: ${result.error}`,
      );
    }

    return result.result.state;
  }

  it('exposes both new mutation tools', () => {
    const names = WORKFLOW_TOOLSET.map((tool) => tool.name);

    expect(names).toContain('set_user_task_return_require_comment');
    expect(names).toContain('set_user_task_sla');
  });

  it('turns on the return comment requirement', async () => {
    const state = await stateWithUserTask();
    const nodeId = String(
      state.definition.nodes.find((node) => node.type === 'userTask')?.id,
    );
    const next = await runTool(state, 'set_user_task_return_require_comment', {
      nodeId,
      requireComment: true,
    });

    expect(readUserTaskData(next)['returnBehavior']).toEqual(
      expect.objectContaining({ requireComment: true }),
    );
  });

  it('composes a business-day SLA from a value and unit', async () => {
    const state = await stateWithUserTask();
    const nodeId = String(
      state.definition.nodes.find((node) => node.type === 'userTask')?.id,
    );
    const next = await runTool(state, 'set_user_task_sla', {
      calendar: 'BUSINESS_DAY',
      durationUnit: 'DAY',
      durationValue: 3,
      nodeId,
      onTimeout: 'ESCALATE',
      warningAt: 0.75,
    });

    expect(readUserTaskData(next)['sla']).toEqual({
      calendar: 'BUSINESS_DAY',
      duration: 'P3D',
      escalateLevelsUp: 1,
      onTimeout: 'ESCALATE',
      warningAt: 0.75,
    });
  });

  it('forces CALENDAR mode for an hour-based SLA', async () => {
    const state = await stateWithUserTask();
    const nodeId = String(
      state.definition.nodes.find((node) => node.type === 'userTask')?.id,
    );
    const next = await runTool(state, 'set_user_task_sla', {
      calendar: 'BUSINESS_DAY',
      durationUnit: 'HOUR',
      durationValue: 4,
      nodeId,
      onTimeout: 'REMIND',
    });

    expect(readUserTaskData(next)['sla']).toEqual({
      calendar: 'CALENDAR',
      duration: 'PT4H',
      onTimeout: 'REMIND',
    });
  });

  it('removes the SLA when disabled', async () => {
    const state = await stateWithUserTask();
    const nodeId = String(
      state.definition.nodes.find((node) => node.type === 'userTask')?.id,
    );
    const withSla = await runTool(state, 'set_user_task_sla', {
      durationUnit: 'DAY',
      durationValue: 2,
      nodeId,
      onTimeout: 'REMIND',
    });
    const withoutSla = await runTool(withSla, 'set_user_task_sla', {
      enabled: false,
      nodeId,
    });

    expect('sla' in readUserTaskData(withoutSla)).toBe(false);
  });

  it('rejects a warningAt outside the open unit interval', async () => {
    const state = await stateWithUserTask();
    const nodeId = String(
      state.definition.nodes.find((node) => node.type === 'userTask')?.id,
    );
    const result = await executeWorkflowTool(
      state,
      'set_user_task_sla',
      { durationValue: 2, nodeId, warningAt: 1 },
      deterministicIds,
    );

    expect(result.ok).toBe(false);
  });
});

describe('set_user_task_decision_policy', () => {
  async function runTool(
    state: WorkflowDesignerState,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowDesignerState> {
    const result = await executeWorkflowTool(
      state,
      name,
      input,
      deterministicIds,
    );

    if (!result.ok || result.kind === 'query') {
      throw new Error(
        result.ok ? 'Expected a mutation result' : `Tool failed: ${result.error}`,
      );
    }

    return result.result.state;
  }

  async function stateWithUserTask(): Promise<
    Readonly<{ nodeId: string; state: WorkflowDesignerState }>
  > {
    const state = await runTool(initialState(), 'add_node', {
      nodeType: 'userTask',
    });
    const nodeId = state.definition.nodes.find(
      (node) => node.type === 'userTask',
    )?.id;

    if (!nodeId) {
      throw new Error('Expected a user task node');
    }

    return { nodeId, state };
  }

  function readDecisionPolicy(state: WorkflowDesignerState): unknown {
    const node = state.definition.nodes.find(
      (candidate) => candidate.type === 'userTask',
    );

    if (node?.type !== 'userTask') {
      throw new Error('Expected a user task node');
    }

    return node.data.decisionPolicy;
  }

  it('is exposed as a mutation tool', () => {
    expect(
      WORKFLOW_TOOLSET.find(
        (tool) => tool.name === 'set_user_task_decision_policy',
      )?.kind,
    ).toBe('mutation');
  });

  it('stores a bare type for the non-quorum policies', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const next = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      type: 'PARALLEL_ALL',
    });

    expect(readDecisionPolicy(next)).toEqual({ type: 'PARALLEL_ALL' });
  });

  it('sanitises the quorum threshold the way the designer form does', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const overCap = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      threshold: 500,
      thresholdType: 'PERCENTAGE',
      type: 'QUORUM',
    });

    expect(readDecisionPolicy(overCap)).toEqual({
      threshold: 100,
      thresholdType: 'PERCENTAGE',
      type: 'QUORUM',
    });

    const underFloor = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      threshold: 0,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });

    expect(readDecisionPolicy(underFloor)).toEqual({
      threshold: 1,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
  });

  it('seeds the default threshold when the model omits it', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const next = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      type: 'QUORUM',
    });

    expect(readDecisionPolicy(next)).toEqual({
      threshold: 2,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
  });

  it('reports the policy in the snapshot so it can be read back', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const next = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      threshold: 3,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
    const summary = readWorkflowSnapshot(next).nodes.find(
      (node) => node.id === nodeId,
    )?.summary;

    expect(summary).toContain('決策=QUORUM(COUNT 3)');
  });

  // The assistant reaches `applySetUserTaskApprover` through the toolset while
  // the designer reaches it through the property form. Both must agree, which
  // is why the rule lives in the reducer rather than in the React view.
  it('keeps a quorum the new approver set can still satisfy', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const withQuorum = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      threshold: 3,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
    const afterApprover = await runTool(withQuorum, 'set_user_task_approver', {
      approverResolver: { memberIds: ['m1', 'm2', 'm3'], type: 'DIRECT' },
      nodeId,
    });

    expect(readDecisionPolicy(afterApprover)).toEqual({
      threshold: 3,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
  });

  it('drops a quorum the new approver set can never satisfy', async () => {
    const { nodeId, state } = await stateWithUserTask();
    const withQuorum = await runTool(state, 'set_user_task_decision_policy', {
      nodeId,
      threshold: 3,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
    const afterApprover = await runTool(withQuorum, 'set_user_task_approver', {
      approverResolver: { memberIds: ['m1'], type: 'DIRECT' },
      nodeId,
    });

    expect(readDecisionPolicy(afterApprover)).toEqual({ type: 'SINGLE' });
  });
});
