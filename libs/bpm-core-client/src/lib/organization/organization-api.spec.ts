import { createOrgUnit, deleteOrgUnit } from './organization-api';

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

describe('@rytass/bpm-core-client/organization', () => {
  describe('createOrgUnit', () => {
    it('forwards the input under the GraphQL "input" variable', async (): Promise<void> => {
      const input = {
        code: 'ENG',
        metadataJson: '{}',
        name: 'Engineering',
        parentId: null,
        type: 'DEPARTMENT' as const,
      };
      const harness = installFetchMock({
        createOrgUnit: {
          code: 'ENG',
          createdAt: '2026-05-26T00:00:00.000Z',
          deletedAt: null,
          id: 'unit-1',
          name: 'Engineering',
          parentId: null,
          path: 'unit-1',
          type: 'DEPARTMENT',
          updatedAt: '2026-05-26T00:00:00.000Z',
        },
      });
      try {
        const result = await createOrgUnit(input);
        const request = harness.capture();

        expect(request.query).toContain('mutation AdminCreateOrgUnit');
        expect(request.variables).toEqual({ input });
        expect(result.id).toBe('unit-1');
      } finally {
        harness.restore();
      }
    });
  });

  describe('deleteOrgUnit', () => {
    it('passes the id and returns the boolean payload', async (): Promise<void> => {
      const harness = installFetchMock({ deleteOrgUnit: true });
      try {
        const result = await deleteOrgUnit('unit-1');
        const request = harness.capture();

        expect(request.query).toContain('deleteOrgUnit');
        expect(request.variables).toEqual({ id: 'unit-1' });
        expect(result).toBe(true);
      } finally {
        harness.restore();
      }
    });
  });
});
