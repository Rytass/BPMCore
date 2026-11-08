import { readFallbackWorkflowDefinition } from './workflow-graph';
import { WorkflowDesignerState } from './workflow-command';
import {
  WORKFLOW_TOOL_BY_NAME,
  WorkflowExpressionFinding,
  WorkflowExpressionRequest,
  WorkflowExpressionTools,
  executeWorkflowTool,
} from './workflow-toolset';

/**
 * Phase 23 P4 (ADR 22 §3.8): the assistant may write an expression only once
 * the backend lint passed it. The toolset lints through host-injected tools
 * and refuses the write on an error, on a lint that cannot answer, and when
 * no lint was injected at all.
 */

function state(dialect?: 'cel-legacy' | 'cel-v2'): WorkflowDesignerState {
  const fallback = readFallbackWorkflowDefinition();

  return {
    definition: {
      ...fallback,
      ...(dialect ? { expressionDialect: dialect } : {}),
      edges: [
        { data: {}, id: 'e1', source: 'gw', target: 'end', type: 'smoothstep' },
      ],
      nodes: [
        ...fallback.nodes,
        { data: { direction: 'split', label: '分流' }, id: 'gw', position: { x: 0, y: 0 }, type: 'exclusiveGateway' },
        {
          data: {
            action: { channels: ['IN_APP'], recipients: { memberIds: [], type: 'DIRECT' }, type: 'NOTIFY' },
            label: '寫入',
          },
          id: 'svc',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
      ],
    },
    editingEdgeId: null,
    formDefinitionVersionId: null,
    formSchema: null,
    initiatorPolicyCel: null,
    selectedEdgeIds: [],
    selectedNodeId: 'start',
  };
}

function createTools(
  findings: readonly WorkflowExpressionFinding[] = [],
): WorkflowExpressionTools & {
  readonly requests: WorkflowExpressionRequest[];
} {
  const requests: WorkflowExpressionRequest[] = [];

  return {
    catalog: async (usagePoint): Promise<unknown> => ({ roots: [usagePoint] }),
    evaluate: async (): Promise<unknown> => ({ outcome: 'OK', resultJson: 'true' }),
    lint: async (request): Promise<readonly WorkflowExpressionFinding[]> => {
      requests.push(request);

      return findings;
    },
    requests,
  };
}

const ERROR: WorkflowExpressionFinding = {
  code: 'EXPR_FIELD_UNKNOWN',
  message: '讀取了表單沒有的欄位「amount」。',
  severity: 'ERROR',
};

describe('expression tools in the workflow toolset', (): void => {
  it('advertises the catalog and preview as read-only queries', (): void => {
    expect(WORKFLOW_TOOL_BY_NAME.get('get_expression_catalog')?.kind).toBe('query');
    expect(WORKFLOW_TOOL_BY_NAME.get('preview_expression')?.kind).toBe('query');
  });

  it('lints an initiator policy in the draft dialect before writing it', async (): Promise<void> => {
    const tools = createTools();
    const result = await executeWorkflowTool(
      state('cel-v2'),
      'set_initiator_policy_cel',
      { cel: '"org-1" in subject.orgUnitIds' },
      { expressions: tools },
    );

    expect(result.ok).toBe(true);
    expect(tools.requests).toEqual([
      {
        dialect: 'cel-v2',
        edgeSourceNodeType: null,
        expression: '"org-1" in subject.orgUnitIds',
        targetFieldKey: null,
        usagePoint: 'INITIATOR_POLICY',
      },
    ]);
  });

  it('refuses the write and changes nothing when the lint reports an error', async (): Promise<void> => {
    const before = state('cel-v2');
    const result = await executeWorkflowTool(
      before,
      'set_service_action',
      {
        action: { fieldPath: 'copy', type: 'SET_FORM_FIELD', value: 'form.amount' },
        nodeId: 'svc',
      },
      { expressions: createTools([ERROR]) },
    );

    expect(result).toEqual({
      error: expect.stringContaining('EXPR_FIELD_UNKNOWN') as unknown as string,
      ok: false,
    });
  });

  it('lets warnings through', async (): Promise<void> => {
    const tools = createTools([{ ...ERROR, code: 'EXPR_OR_ABSORBS_ERROR', severity: 'WARNING' }]);
    const result = await executeWorkflowTool(
      state('cel-v2'),
      'set_service_action',
      {
        action: { fieldPath: 'form.copy', type: 'SET_FORM_FIELD', value: 'form.note' },
        nodeId: 'svc',
      },
      { expressions: tools },
    );

    expect(result.ok).toBe(true);
    expect(tools.requests[0]).toEqual(
      expect.objectContaining({
        targetFieldKey: 'copy',
        usagePoint: 'SERVICE_FORM_FIELD_VALUE',
      }),
    );
  });

  it('fails closed without a lint and when the lint cannot answer', async (): Promise<void> => {
    const withoutLint = await executeWorkflowTool(
      state(),
      'set_initiator_policy_cel',
      { cel: 'true' },
    );
    const broken = await executeWorkflowTool(
      state(),
      'insert_approval_step',
      { approverResolver: { expression: 'form.manager', type: 'EXPRESSION' } },
      {
        expressions: {
          ...createTools(),
          lint: async (): Promise<readonly WorkflowExpressionFinding[]> => {
            throw new Error('network');
          },
        },
      },
    );

    expect(withoutLint.ok).toBe(false);
    expect(broken.ok).toBe(false);
  });

  it('does not lint what holds no free-text expression', async (): Promise<void> => {
    const tools = createTools([ERROR]);
    const cleared = await executeWorkflowTool(
      state(),
      'set_initiator_policy_cel',
      { cel: null },
      { expressions: tools },
    );
    const step = await executeWorkflowTool(
      state(),
      'insert_approval_step',
      {},
      { expressions: tools },
    );

    expect(cleared.ok).toBe(true);
    expect(step.ok).toBe(true);
    expect(tools.requests).toEqual([]);
  });

  it('previews with the edge source and evaluates only with a sample', async (): Promise<void> => {
    const tools = createTools();
    const lintOnly = await executeWorkflowTool(
      state('cel-v2'),
      'preview_expression',
      { edgeId: 'e1', expression: 'lastDecision != null', usagePoint: 'FLOW_CONDITION' },
      { expressions: tools },
    );
    const evaluated = await executeWorkflowTool(
      state('cel-v2'),
      'preview_expression',
      { expression: 'form.a', sample: { form: { a: 1 } }, usagePoint: 'ENTRY_CONDITION' },
      { expressions: tools },
    );

    expect(lintOnly).toEqual({
      data: { available: true, findings: [] },
      kind: 'query',
      ok: true,
    });
    expect(tools.requests[0]?.edgeSourceNodeType).toBe('exclusiveGateway');
    expect(evaluated).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ evaluation: { outcome: 'OK', resultJson: 'true' } }) as unknown,
      }),
    );
  });

  it('reports the catalog as unavailable without tools, and refuses an unknown use point', async (): Promise<void> => {
    await expect(
      executeWorkflowTool(state(), 'get_expression_catalog', { usagePoint: 'ENTRY_CONDITION' }),
    ).resolves.toEqual({ data: { available: false }, kind: 'query', ok: true });
    await expect(
      executeWorkflowTool(
        state(),
        'get_expression_catalog',
        { usagePoint: 'toString' },
        { expressions: createTools() },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: false }));
  });
});
