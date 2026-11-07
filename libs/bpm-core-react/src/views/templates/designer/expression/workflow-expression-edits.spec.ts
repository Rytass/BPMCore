import {
  WorkflowDesignerState,
  applyWorkflowCommand,
  applyWorkflowMacroCommand,
  normalizeDesignerWorkflowDefinition,
  readFallbackWorkflowDefinition,
} from '@rytass/bpm-core-shared';
import type {
  WorkflowDefinition,
  WorkflowEdge,
} from '@rytass/bpm-core-shared/workflow';
import {
  checkFormEditExpressionFields,
  isWorkflowEdgeExpressionCondition,
  readRemovedExpressionFields,
  readWorkflowEdgeSourceNodeType,
  setWorkflowEdgeExpressionCondition,
  setWorkflowNodeEntryCondition,
} from './workflow-expression-edits';

const DEFINITION: WorkflowDefinition = {
  edges: [
    {
      data: {
        condition: 'form.amount > 1',
        conditionFieldKey: 'amount',
        conditionOperator: 'GREATER_THAN',
        conditionValue: '1',
        isDefault: false,
        label: '金額 > 1',
      },
      id: 'e1',
      source: 'task',
      target: 'end',
      type: 'smoothstep',
    },
  ],
  expressionDialect: 'cel-v2',
  meta: { schemaVersion: 1 },
  nodes: [
    ...readFallbackWorkflowDefinition().nodes,
    {
      data: {
        action: { fieldPath: 'copy', type: 'SET_FORM_FIELD', value: 'form.note' },
        label: '寫入',
      },
      id: 'task',
      position: { x: 0, y: 0 },
      type: 'serviceTask',
    },
  ],
};

const stateOf = (definition: WorkflowDefinition): WorkflowDesignerState => ({
  definition,
  editingEdgeId: null,
  formDefinitionVersionId: null,
  formSchema: null,
  initiatorPolicyCel: null,
  selectedEdgeIds: [],
  selectedNodeId: 'start',
});

describe('designer expression edits (Phase 23 P4)', (): void => {
  it('sets and clears an entry condition only on task nodes', (): void => {
    const set = setWorkflowNodeEntryCondition(DEFINITION, 'task', 'form.amount > 0');
    const cleared = setWorkflowNodeEntryCondition(set, 'task', '  ');
    const onStart = setWorkflowNodeEntryCondition(DEFINITION, 'start', 'true');

    expect(set.nodes.find((node) => node.id === 'task')?.data).toEqual(
      expect.objectContaining({ entryCondition: 'form.amount > 0' }),
    );
    expect(cleared.nodes.find((node) => node.id === 'task')?.data).not.toHaveProperty(
      'entryCondition',
    );
    expect(onStart).toEqual(DEFINITION);
    expect(set.expressionDialect).toBe('cel-v2');
  });

  it('turns a builder condition into a hand-written one', (): void => {
    const next = setWorkflowEdgeExpressionCondition(DEFINITION, 'e1', 'form.amount > 1 && form.urgent');

    expect(next.edges[0]?.data).toEqual({
      condition: 'form.amount > 1 && form.urgent',
      isDefault: false,
      label: '自訂條件',
    });
    expect(isWorkflowEdgeExpressionCondition(next.edges[0] as WorkflowEdge)).toBe(true);
    expect(isWorkflowEdgeExpressionCondition(DEFINITION.edges[0] as WorkflowEdge)).toBe(false);
    expect(readWorkflowEdgeSourceNodeType(DEFINITION, 'e1')).toBe('serviceTask');
    expect(readWorkflowEdgeSourceNodeType(DEFINITION, 'nope')).toBeNull();
  });

  it('keeps the draft dialect through commands, macros, normalization and JSON', (): void => {
    const renamed = applyWorkflowCommand(stateOf(DEFINITION), {
      label: '改名',
      nodeId: 'task',
      type: 'renameNode',
    });
    const inserted = applyWorkflowMacroCommand(renamed.state, {
      approverResolver: { type: 'ORG_MANAGER' },
      type: 'insertApprovalStep',
    });
    const roundTripped = JSON.parse(
      JSON.stringify(normalizeDesignerWorkflowDefinition(inserted.state.definition)),
    ) as WorkflowDefinition;

    expect(renamed.changed).toBe(true);
    expect(inserted.changed).toBe(true);
    expect(roundTripped.expressionDialect).toBe('cel-v2');
  });

  it('adds no dialect to a legacy draft', (): void => {
    const legacy = Object.fromEntries(
      Object.entries(DEFINITION).filter(([key]) => key !== 'expressionDialect'),
    ) as unknown as WorkflowDefinition;
    const next = applyWorkflowMacroCommand(stateOf(legacy), {
      approverResolver: { type: 'ORG_MANAGER' },
      type: 'insertApprovalStep',
    });

    expect(next.state.definition).not.toHaveProperty('expressionDialect');
  });

  it('blocks only removed fields that expressions still read', (): void => {
    const references = new Map([
      ['amount', ['workflow.edges.e1.data.condition']],
      ['note', ['workflow.nodes.task.data.action.value']],
    ]);

    expect(
      readRemovedExpressionFields(['amount', 'note', 'title'], ['amount2', 'note'], references),
    ).toEqual([{ fieldKey: 'amount', labels: ['workflow.edges.e1.data.condition'] }]);
    expect(readRemovedExpressionFields(['title'], [], references)).toEqual([]);
  });
});

describe('checkFormEditExpressionFields', () => {
  const references: ReadonlyMap<string, readonly string[]> = new Map([
    ['amount', ['workflow.edges.e1.data.condition']],
  ]);

  it('allows an edit that removes no field without asking the backend', async () => {
    const resolve = jest.fn(async () => references);

    await expect(
      checkFormEditExpressionFields(['amount'], ['amount', 'extra'], resolve),
    ).resolves.toEqual({ kind: 'allowed' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('blocks removing a referenced field', async () => {
    await expect(
      checkFormEditExpressionFields(['amount', 'note'], ['amount2', 'note'], async () => references),
    ).resolves.toEqual({
      fields: [{ fieldKey: 'amount', labels: ['workflow.edges.e1.data.condition'] }],
      kind: 'blocked',
    });
  });

  it('allows removing a field no expression reads', async () => {
    await expect(
      checkFormEditExpressionFields(['amount', 'note'], ['amount'], async () => references),
    ).resolves.toEqual({ kind: 'allowed' });
  });

  it('refuses a removal it cannot verify instead of letting it through', async () => {
    await expect(
      checkFormEditExpressionFields(['amount', 'note'], [], async () => null),
    ).resolves.toEqual({ fieldKeys: ['amount', 'note'], kind: 'unverified' });
  });
});
