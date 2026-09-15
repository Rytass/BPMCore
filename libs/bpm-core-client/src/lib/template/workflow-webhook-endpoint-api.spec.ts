import { listWorkflowWebhookEndpoints } from './workflow-webhook-endpoint-api';

interface CapturedRequest {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

function installFetchMock<TData>(payload: TData): {
  readonly capture: () => CapturedRequest;
  readonly captureSignal: () => AbortSignal | null | undefined;
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
      const init = fetchMock.mock.calls[0]?.[1];
      return JSON.parse(String(init?.body ?? '{}')) as CapturedRequest;
    },
    captureSignal: (): AbortSignal | null | undefined =>
      fetchMock.mock.calls[0]?.[1]?.signal,
    restore: (): void => {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

describe('@rytass/bpm-core-client/template webhook endpoint catalog', () => {
  it('asks for active endpoints by default and returns the catalog as is', async (): Promise<void> => {
    const endpoint = {
      deprecated: false,
      description: null,
      key: 'erp.po',
      label: 'ERP',
      parameters: [
        {
          description: null,
          key: 'amount',
          label: '金額',
          required: true,
          type: 'number',
        },
      ],
      source: 'REGISTRY',
      version: 1,
    };
    const harness = installFetchMock({ workflowWebhookEndpoints: [endpoint] });

    try {
      const endpoints = await listWorkflowWebhookEndpoints();
      const request = harness.capture();

      expect(request.query).toContain('query WorkflowWebhookEndpoints');
      expect(request.query).not.toMatch(/url|header|secret/i);
      expect(request.variables).toEqual({ includeDeprecated: false });
      expect(endpoints).toEqual([endpoint]);
    } finally {
      harness.restore();
    }
  });

  it('includes deprecated endpoints when asked', async (): Promise<void> => {
    const harness = installFetchMock({ workflowWebhookEndpoints: [] });

    try {
      await listWorkflowWebhookEndpoints({ includeDeprecated: true });

      expect(harness.capture().variables).toEqual({ includeDeprecated: true });
    } finally {
      harness.restore();
    }
  });
});
