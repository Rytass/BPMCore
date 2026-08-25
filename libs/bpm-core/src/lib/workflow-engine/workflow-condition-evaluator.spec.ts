import { WorkflowEdge } from '@rytass/bpm-core-shared/workflow';
import { evaluateWorkflowEdgeCondition } from './workflow-condition-evaluator';

describe('evaluateWorkflowEdgeCondition', () => {
  // ADR 16 §3.8 gives a table exactly two operators, and both mean row count.
  it('treats a table with rows as filled', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items', 'IS_FILLED'), {
        formData: { items: [{ name: 'Bolt', qty: 1 }] },
      }),
    ).toBe(true);
  });

  it('treats a table with no rows as empty', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items', 'IS_EMPTY'), {
        formData: { items: [] },
      }),
    ).toBe(true);
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items', 'IS_FILLED'), {
        formData: { items: [] },
      }),
    ).toBe(false);
  });

  it('treats an absent table as empty', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items', 'IS_EMPTY'), {
        formData: {},
      }),
    ).toBe(true);
  });

  // A structured condition carries a plain field key, so a cell path is simply
  // absent from `formData`. Publish lint rejects it; this is the runtime
  // backstop that keeps it from throwing or matching by accident.
  it('does not resolve a cell path through a table value', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items.qty', 'IS_FILLED'), {
        formData: { items: [{ name: 'Bolt', qty: 3 }] },
      }),
    ).toBe(false);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('items.qty', 'EQUALS', '3'),
        { formData: { items: [{ name: 'Bolt', qty: 3 }] } },
      ),
    ).toBe(false);
  });

  // The designer only offers IS_FILLED / IS_EMPTY for a table, but an imported
  // or hand-edited definition can still carry a value comparison. Stringifying
  // a row record would match `[object Object]` and route the instance on a
  // coincidence.
  it('never matches a value comparison against table rows', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('items', 'EQUALS', 'Bolt'), {
        formData: { items: [{ name: 'Bolt', qty: 1 }] },
      }),
    ).toBe(false);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('items', 'EQUALS', '[object Object]'),
        { formData: { items: [{ name: 'Bolt', qty: 1 }] } },
      ),
    ).toBe(false);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('items', 'NOT_EQUALS', '[object Object]'),
        { formData: { items: [{ name: 'Bolt', qty: 1 }] } },
      ),
    ).toBe(false);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('items', 'GREATER_THAN', '0'),
        { formData: { items: [{ name: 'Bolt', qty: 1 }] } },
      ),
    ).toBe(false);
  });

  it('keeps the flat multi-select behaviour unchanged', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('tags', 'EQUALS', 'a'), {
        formData: { tags: ['a', 'b'] },
      }),
    ).toBe(true);
  });
});

function createEdge(
  conditionFieldKey: string,
  conditionOperator: string,
  conditionValue?: string,
): WorkflowEdge {
  return {
    data: {
      conditionFieldKey,
      conditionOperator,
      ...(typeof conditionValue === 'string' ? { conditionValue } : {}),
    },
    id: 'edge-1',
    source: 'gateway',
    target: 'end',
    type: 'smoothstep',
  } as WorkflowEdge;
}
