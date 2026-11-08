import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import {
  analyzeWorkflowExpressions,
  previewExpression,
  previewWorkflowDialectUpgrade,
  readExpressionCatalog,
  readExpressionFieldReferences,
} from './expression-api';
import {
  readExpressionIssueMessage,
  readExpressionLabelLocation,
} from './workflow-lint-errors';

interface CapturedRequest {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

function installFetchMock<TData>(payload: TData): {
  readonly capture: () => CapturedRequest;
  readonly restore: () => void;
} {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<
    Promise<Response>,
    [RequestInfo | URL, RequestInit?]
  >();

  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ data: payload }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
  );
  (global as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;

  return {
    capture: (): CapturedRequest => {
      expect(fetchMock).toHaveBeenCalledTimes(1);

      return JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
      ) as CapturedRequest;
    },
    restore: (): void => {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

const DEFINITION = {
  edges: [
    { data: {}, id: 'e1', source: 'gw', target: 'end', type: 'smoothstep' },
  ],
  expressionDialect: 'cel-v2',
  meta: { schemaVersion: 1 },
  nodes: [
    { data: { label: '分流' }, id: 'gw', position: { x: 0, y: 0 }, type: 'exclusiveGateway' },
    { data: { endState: 'APPROVED', label: '完成' }, id: 'end', position: { x: 0, y: 0 }, type: 'endEvent' },
  ],
} as unknown as WorkflowDefinition;

describe('@rytass/bpm-core-client/template expression API', (): void => {
  it('previews an expression, sending the sample only when evaluating', async (): Promise<void> => {
    const harness = installFetchMock({
      previewExpression: { evaluation: null, issues: [], valid: true },
    });

    try {
      const result = await previewExpression({
        dialect: 'cel-v2',
        expression: 'form.amount > 1',
        mode: 'LINT',
        sampleContext: { form: { amount: 2 } },
        usagePoint: 'FLOW_CONDITION',
      });
      const request = harness.capture();

      expect(result.valid).toBe(true);
      expect(request.query).toContain('previewExpression(input: $input)');
      expect(request.variables).toEqual({
        input: {
          dialect: 'cel-v2',
          edgeSourceNodeType: null,
          expression: 'form.amount > 1',
          formDefinitionVersionId: null,
          mode: 'LINT',
          sampleContextJson: null,
          targetFieldKey: null,
          usagePoint: 'FLOW_CONDITION',
        },
      });
    } finally {
      harness.restore();
    }
  });

  it('serializes the sample for EVALUATE', async (): Promise<void> => {
    const harness = installFetchMock({
      previewExpression: { evaluation: null, issues: [], valid: true },
    });

    try {
      await previewExpression({
        expression: 'form.amount',
        mode: 'EVALUATE',
        sampleContext: { form: { amount: 2 } },
        usagePoint: 'ENTRY_CONDITION',
      });

      expect(
        (harness.capture().variables?.['input'] as Record<string, unknown>)[
          'sampleContextJson'
        ],
      ).toBe('{"form":{"amount":2}}');
    } finally {
      harness.restore();
    }
  });

  it('reads the catalog and sends the draft for analysis and the upgrade check', async (): Promise<void> => {
    const catalogHarness = installFetchMock({
      expressionCatalog: {
        fields: [],
        functions: [],
        functionsAvailable: true,
        roots: ['form'],
        usagePoint: 'ENTRY_CONDITION',
      },
    });

    try {
      await readExpressionCatalog({ usagePoint: 'ENTRY_CONDITION' });
      expect(catalogHarness.capture().query).toContain('expressionCatalog');
    } finally {
      catalogHarness.restore();
    }

    for (const call of [analyzeWorkflowExpressions, previewWorkflowDialectUpgrade]) {
      const harness = installFetchMock({
        analyzeWorkflowExpressions: { dialect: 'cel-v2', expressions: [] },
        previewWorkflowDialectUpgrade: {},
      });

      try {
        await call({
          formDefinitionVersionId: null,
          initiatorPolicyCel: null,
          workflowDefinition: DEFINITION,
        });

        expect(harness.capture().variables).toEqual({
          input: {
            formDefinitionVersionId: null,
            initiatorPolicyCel: null,
            workflowDefinitionJson: JSON.stringify(DEFINITION),
          },
        });
      } finally {
        harness.restore();
      }
    }
  });

  it('groups the labels that read each field', (): void => {
    expect(
      readExpressionFieldReferences({
        dialect: 'cel-v2',
        expressions: [
          { fieldKeys: ['amount'], issues: [], label: 'a', usagePoint: 'FLOW_CONDITION' },
          { fieldKeys: ['amount', 'title'], issues: [], label: 'b', usagePoint: 'ENTRY_CONDITION' },
        ],
      }),
    ).toEqual(
      new Map([
        ['amount', ['a', 'b']],
        ['title', ['b']],
      ]),
    );
    expect(readExpressionFieldReferences(null)).toEqual(new Map());
  });

  it('writes a finding as a designer sentence, with its location when the definition holds it', (): void => {
    const issue = {
      code: 'EXPR_LAST_DECISION_UNAVAILABLE' as const,
      label: 'workflow.edges.e1.data.condition',
      subject: null,
    };

    expect(readExpressionIssueMessage(issue)).toContain('lastDecision');
    expect(readExpressionIssueMessage(issue, DEFINITION)).toMatch(
      /^從「分流」出發的連線條件：/u,
    );
    expect(readExpressionIssueMessage(issue, DEFINITION, 'en')).toMatch(
      /^The condition on the connection leaving "分流": /u,
    );
    expect(
      readExpressionIssueMessage({ code: 'EXPR_FIELD_UNKNOWN', label: 'expression', subject: 'amount' }),
    ).toBe('讀取了表單沒有的欄位「amount」。');
    expect(readExpressionLabelLocation('workflow.edges.e1.data.condition', DEFINITION)).toBe(
      '從「分流」出發的連線條件',
    );
    expect(readExpressionLabelLocation('nope', DEFINITION)).toBeNull();
  });
});
