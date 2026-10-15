import {
  createOrgUnit,
  deleteOrgUnit,
  readOrgUnitRetirementImpact,
} from './organization-api';

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
        expect(request.variables).toEqual({
          id: 'unit-1',
          transferToOrgUnitId: null,
        });
        expect(result).toBe(true);
      } finally {
        harness.restore();
      }
    });

    it('passes the successor unit when one is given', async (): Promise<void> => {
      const harness = installFetchMock({ deleteOrgUnit: true });
      try {
        await deleteOrgUnit('unit-1', { transferToOrgUnitId: 'unit-2' });
        const request = harness.capture();

        expect(request.query).toContain('transferToOrgUnitId');
        expect(request.variables).toEqual({
          id: 'unit-1',
          transferToOrgUnitId: 'unit-2',
        });
      } finally {
        harness.restore();
      }
    });
  });

  describe('readOrgUnitRetirementImpact', () => {
    it('returns the counts the API reports', async (): Promise<void> => {
      const impact = {
        childUnitCount: 0,
        openManagerResolutionCount: 1,
        openMembershipCount: 3,
      };
      const harness = installFetchMock({ orgUnitRetirementImpact: impact });
      try {
        const result = await readOrgUnitRetirementImpact('unit-1');
        const request = harness.capture();

        expect(request.query).toContain('orgUnitRetirementImpact');
        expect(request.variables).toEqual({ id: 'unit-1' });
        expect(result).toEqual(impact);
      } finally {
        harness.restore();
      }
    });
  });
});
