import { readFallbackWorkflowDefinition } from './workflow-graph';
import {
  WorkflowCommandOptions,
  WorkflowDesignerState,
  applyWorkflowCommand,
  applyWorkflowMacroCommand,
} from './workflow-command';

function deterministicEdgeIds(): WorkflowCommandOptions {
  let counter = 0;

  return {
    createEdgeId: (source, target): string =>
      `edge_${source}_${target}_${(counter += 1)}`,
  };
}

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

describe('applyWorkflowCommand', () => {
  it('adds a user task between start and end, flagging layout', () => {
    const result = applyWorkflowCommand(
      initialState(),
      { nodeType: 'userTask', type: 'addNode' },
      deterministicEdgeIds(),
    );

    expect(result.changed).toBe(true);
    expect(result.effects.layout).toBe(true);
    expect(
      result.state.definition.nodes.some((node) => node.type === 'userTask'),
    ).toBe(true);
    // start -> userTask -> end
    expect(result.state.definition.edges).toHaveLength(2);
  });

  it('only node inserts and autoLayout request a relayout', () => {
    const base = applyWorkflowCommand(
      initialState(),
      { nodeType: 'userTask', type: 'addNode' },
      deterministicEdgeIds(),
    );

    // addNode positions the new node -> relayout.
    expect(base.effects.layout).toBe(true);

    // Connecting already-positioned nodes preserves manual layout.
    expect(
      applyWorkflowCommand(base.state, {
        source: 'start',
        target: 'end',
        type: 'connectEdge',
      }).effects.layout,
    ).toBe(false);

    // autoLayout is the explicit tidy step.
    expect(
      applyWorkflowCommand(base.state, { type: 'autoLayout' }).effects.layout,
    ).toBe(true);
  });

  it('rejects an invalid connection (end node cannot be a source)', () => {
    const result = applyWorkflowCommand(initialState(), {
      source: 'end',
      target: 'start',
      type: 'connectEdge',
    });

    expect(result.changed).toBe(false);
    expect(result.error).toContain('無法連線');
  });

  it('refuses to delete the start node', () => {
    const result = applyWorkflowCommand(initialState(), {
      nodeId: 'start',
      type: 'deleteNode',
    });

    expect(result.changed).toBe(false);
    expect(result.error).toContain('無法刪除');
  });

  it('sets a user task approver and resets the decision policy to SINGLE', () => {
    const withNode = applyWorkflowCommand(
      initialState(),
      { nodeType: 'userTask', type: 'addNode' },
      deterministicEdgeIds(),
    ).state;
    const nodeId = withNode.definition.nodes.find(
      (node) => node.type === 'userTask',
    )?.id;

    const result = applyWorkflowCommand(withNode, {
      approverResolver: { positionId: 'pos-1', type: 'POSITION' },
      nodeId: nodeId ?? '',
      type: 'setUserTaskApprover',
    });
    const updated = result.state.definition.nodes.find(
      (node) => node.id === nodeId,
    );

    expect(updated?.type).toBe('userTask');

    if (updated?.type === 'userTask') {
      expect(updated.data.approverResolver).toEqual({
        positionId: 'pos-1',
        type: 'POSITION',
      });
      expect(updated.data.decisionPolicy).toEqual({ type: 'SINGLE' });
    }
  });

  it('reports a validation issue for an unconfigured DIRECT approver', () => {
    const withNode = applyWorkflowCommand(
      initialState(),
      { nodeType: 'userTask', type: 'addNode' },
      deterministicEdgeIds(),
    ).state;
    const nodeId =
      withNode.definition.nodes.find((node) => node.type === 'userTask')?.id ??
      '';

    const result = applyWorkflowCommand(withNode, {
      approverResolver: { memberIds: [], type: 'DIRECT' },
      nodeId,
      type: 'setUserTaskApprover',
    });

    expect(result.issue).toBe('簽核節點需要指定簽核會員。');
  });

  it('compiles an edge condition against the bound form schema', () => {
    // Build: start -> gateway -> end, then condition the gateway output.
    const base = applyWorkflowCommand(
      {
        ...initialState(),
        formSchema: {
          fields: [
            {
              fieldKey: 'amount',
              label: '金額',
              required: true,
              type: 'money',
            },
          ],
          schemaVersion: 1,
        },
      },
      { nodeType: 'exclusiveGateway', type: 'addNode' },
      deterministicEdgeIds(),
    ).state;
    const gatewayOutEdge = base.definition.edges.find((edge) =>
      base.definition.nodes.some(
        (node) =>
          node.id === edge.source && node.type === 'exclusiveGateway',
      ),
    );

    const result = applyWorkflowCommand(base, {
      edgeId: gatewayOutEdge?.id ?? '',
      fieldKey: 'amount',
      operator: 'GREATER_THAN',
      type: 'setEdgeCondition',
      value: '1000',
    });
    const updatedEdge = result.state.definition.edges.find(
      (edge) => edge.id === gatewayOutEdge?.id,
    );

    expect(updatedEdge?.data.condition).toBe('form.amount > 1000');
    expect(updatedEdge?.data.isDefault).toBe(false);
  });
});

describe('applyWorkflowMacroCommand', () => {
  it('insertApprovalStep adds a user task and sets its approver in one call', () => {
    const result = applyWorkflowMacroCommand(
      initialState(),
      {
        approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
        label: '部門簽核',
        type: 'insertApprovalStep',
      },
      deterministicEdgeIds(),
    );
    const userTask = result.state.definition.nodes.find(
      (node) => node.type === 'userTask',
    );

    expect(result.changed).toBe(true);
    expect(userTask?.data.label).toBe('部門簽核');

    if (userTask?.type === 'userTask') {
      expect(userTask.data.approverResolver).toEqual({
        memberIds: ['m-1'],
        type: 'DIRECT',
      });
    }
  });
});
