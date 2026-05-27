import { createFormDefinition, listFormDefinitions } from './form-api';

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
      const init = fetchMock.mock.calls[0]?.[1];
      return JSON.parse(String(init?.body ?? '{}')) as CapturedRequest;
    },
    restore: (): void => {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

describe('@rytass/bpm-core-client/form', () => {
  describe('listFormDefinitions', () => {
    it('issues the FormDefinitions query and returns the array', async (): Promise<void> => {
      const harness = installFetchMock({ formDefinitions: [] });
      try {
        const records = await listFormDefinitions();
        const request = harness.capture();

        expect(request.query).toContain('query FormDefinitions');
        expect(request.variables).toBeUndefined();
        expect(records).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('createFormDefinition', () => {
    it('wraps the name in a CreateFormDefinitionInput and returns the new id', async (): Promise<void> => {
      const harness = installFetchMock({
        createFormDefinition: { id: 'form-1' },
      });
      try {
        const id = await createFormDefinition('Vacation request');
        const request = harness.capture();

        expect(request.query).toContain('mutation CreateFormDefinition');
        expect(request.variables).toEqual({
          input: {
            createdByMemberId: null,
            description: null,
            name: 'Vacation request',
            schemaJson: null,
            uiSchemaJson: null,
          },
        });
        expect(id).toBe('form-1');
      } finally {
        harness.restore();
      }
    });
  });
});
