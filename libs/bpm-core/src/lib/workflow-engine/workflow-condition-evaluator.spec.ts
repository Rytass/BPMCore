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

describe('evaluateWorkflowEdgeCondition on an unfilled field', () => {
  type Operator = Parameters<typeof createEdge>[1];

  // What an untouched field looks like in the submitted form data: no key at
  // all (client JSON drops undefined), an explicit null, or a cleared input.
  const unfilledForms: ReadonlyArray<
    readonly [string, Readonly<Record<string, unknown>>]
  > = [
    ['absent', {}],
    ['undefined', { field: undefined }],
    ['null', { field: null }],
    ['an empty string', { field: '' }],
  ];
  // One realistic comparison value for each field kind that has an order.
  const orderedKinds: ReadonlyArray<readonly [string, string]> = [
    ['date', '2026-01-01'],
    ['datetime', '2026-01-01T09:00'],
    ['money', '1000'],
    ['number', '5'],
  ];
  const expectations: ReadonlyArray<readonly [Operator, boolean]> = [
    ['EQUALS', false],
    ['NOT_EQUALS', true],
    ['GREATER_THAN', false],
    ['GREATER_THAN_OR_EQUALS', false],
    ['LESS_THAN', false],
    ['LESS_THAN_OR_EQUALS', false],
    ['IS_FILLED', false],
    ['IS_EMPTY', true],
  ];

  describe.each(unfilledForms)('when the value is %s', (_label, formData) => {
    describe.each(orderedKinds)('on a %s field (value %s)', (_kind, value) => {
      it.each(expectations)('%s is %s', (operator, expected): void => {
        expect(
          evaluateWorkflowEdgeCondition(createEdge('field', operator, value), {
            formData,
          }),
        ).toBe(expected);
      });
    });
  });

  it('treats a whitespace-only text like IS_EMPTY does', (): void => {
    const formData = { field: '   ' };

    expect(
      evaluateWorkflowEdgeCondition(createEdge('field', 'IS_EMPTY'), {
        formData,
      }),
    ).toBe(true);
    expect(
      evaluateWorkflowEdgeCondition(createEdge('field', 'LESS_THAN', '5'), {
        formData,
      }),
    ).toBe(false);
    expect(
      evaluateWorkflowEdgeCondition(createEdge('field', 'NOT_EQUALS', 'x'), {
        formData,
      }),
    ).toBe(true);
  });

  // `{}['constructor']` is Object's constructor function, so an evaluator that
  // reads inherited members sees a blank field named like one as filled.
  it.each(['constructor', 'toString', 'valueOf'])(
    'does not read the inherited member %s as a value',
    (key): void => {
      const read = (operator: Operator, value?: string): boolean =>
        evaluateWorkflowEdgeCondition(createEdge(key, operator, value), {
          formData: {},
        });

      expect(read('IS_FILLED')).toBe(false);
      expect(read('IS_EMPTY')).toBe(true);
      expect(read('NOT_EQUALS', 'x')).toBe(true);
      expect(read('EQUALS', 'x')).toBe(false);
    },
  );

  it('still compares an own key named like an inherited member by value', (): void => {
    const formData = { constructor: 'abc' };

    expect(
      evaluateWorkflowEdgeCondition(createEdge('constructor', 'IS_FILLED'), {
        formData,
      }),
    ).toBe(true);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('constructor', 'EQUALS', 'abc'),
        { formData },
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowEdgeCondition(
        createEdge('constructor', 'EQUALS', 'x'),
        { formData },
      ),
    ).toBe(false);
  });

  it('keeps a comparison without a comparison value false', (): void => {
    expect(
      evaluateWorkflowEdgeCondition(createEdge('field', 'NOT_EQUALS'), {
        formData: {},
      }),
    ).toBe(false);
  });

  it('leaves filled values comparing as before', (): void => {
    const compare = (
      operator: Operator,
      actual: unknown,
      expected: string,
    ): boolean =>
      evaluateWorkflowEdgeCondition(createEdge('field', operator, expected), {
        formData: { field: actual },
      });

    expect(compare('LESS_THAN', 3, '5')).toBe(true);
    expect(compare('LESS_THAN', '3', '5')).toBe(true);
    expect(compare('GREATER_THAN', '1500', '1000')).toBe(true);
    expect(compare('LESS_THAN', 0, '5')).toBe(true);
    expect(compare('GREATER_THAN_OR_EQUALS', '2026-01-01', '2026-01-01')).toBe(
      true,
    );
    expect(compare('LESS_THAN', '2025-12-31', '2026-01-01')).toBe(true);
    expect(
      compare('LESS_THAN_OR_EQUALS', '2026-01-01T10:00', '2026-01-01T09:00'),
    ).toBe(false);
    expect(compare('EQUALS', 'A', 'A')).toBe(true);
    expect(compare('NOT_EQUALS', 'A', 'B')).toBe(true);
    expect(compare('EQUALS', 0, '0')).toBe(true);
    expect(compare('EQUALS', false, 'false')).toBe(true);
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
