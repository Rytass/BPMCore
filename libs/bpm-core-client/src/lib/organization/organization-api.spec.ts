import {
  createOrgUnit,
  deleteOrgUnit,
  readOrgUnitRetirementImpact,
  resolveOrgUnitOptions,
  searchOrgUnitOptions,
  updateMembership,
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
  describe('searchOrgUnitOptions', () => {
    it('sends the text as searchText and returns the options', async (): Promise<void> => {
      const options = [
        { code: 'FIN', deleted: false, id: 'unit-1', name: 'Finance' },
      ];
      const harness = installFetchMock({ searchOrgUnitOptions: options });
      try {
        const result = await searchOrgUnitOptions('fin');
        const request = harness.capture();

        expect(request.query).toContain('searchOrgUnitOptions');
        expect(request.query).toContain('$searchText: String');
        expect(request.query).toContain('searchText: $searchText');
        expect(request.query).not.toContain('orgUnits');
        expect(request.variables).toEqual({ searchText: 'fin' });
        expect(result).toEqual(options);
      } finally {
        harness.restore();
      }
    });

    it('selects the four fields of an option and nothing else', async (): Promise<void> => {
      const harness = installFetchMock({ searchOrgUnitOptions: [] });
      try {
        await searchOrgUnitOptions('');
        const request = harness.capture();
        const selection = request.query
          .slice(request.query.indexOf('searchOrgUnitOptions(', 20))
          .replace(/[^{]*\{/, '')
          .split('}')[0]
          .split(/\s+/)
          .filter(Boolean)
          .sort();

        expect(selection).toEqual(['code', 'deleted', 'id', 'name']);
        expect(request.variables).toEqual({ searchText: '' });
      } finally {
        harness.restore();
      }
    });
  });

  describe('resolveOrgUnitOptions', () => {
    it('sends the ids and returns retired units too', async (): Promise<void> => {
      const options = [
        { code: 'OLD', deleted: true, id: 'unit-2', name: 'Old Unit' },
      ];
      const harness = installFetchMock({ orgUnitOptionsByIds: options });
      try {
        const result = await resolveOrgUnitOptions(['unit-2']);
        const request = harness.capture();

        expect(request.query).toContain('orgUnitOptionsByIds');
        expect(request.query).toContain('$ids: [ID!]!');
        expect(request.variables).toEqual({ ids: ['unit-2'] });
        expect(result).toEqual(options);
      } finally {
        harness.restore();
      }
    });

    it('makes no request for an empty list', async (): Promise<void> => {
      const originalFetch = global.fetch;
      const fetchMock = jest.fn();
      (global as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;
      try {
        await expect(resolveOrgUnitOptions([])).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        (global as { fetch: typeof fetch }).fetch = originalFetch;
      }
    });
  });

  describe('updateMembership', () => {
    // UpdateMembershipInput (bpm-core organization/dto/membership.input.ts).
    // A key outside this list fails GraphQL validation with HTTP 400 before
    // the resolver runs.
    const UPDATE_MEMBERSHIP_INPUT_FIELDS = [
      'effectiveFrom',
      'effectiveTo',
      'id',
      'isPrimary',
      'orgUnitId',
      'positionId',
    ];

    it('sends only the fields UpdateMembershipInput defines', async (): Promise<void> => {
      // The admin membership modal hands back the member it was opened for.
      // Spreading it into the call compiles, because TypeScript does not
      // check excess properties that arrive through a spread.
      const modalInput = {
        effectiveFrom: '2026-10-01',
        effectiveTo: '2026-10-26',
        isPrimary: false,
        memberId: 'member-1',
        orgUnitId: 'unit-1',
        positionId: null,
      };
      const harness = installFetchMock({
        updateMembership: {
          createdAt: '2026-10-01T00:00:00.000Z',
          effectiveFrom: '2026-10-01',
          effectiveTo: '2026-10-26',
          id: 'membership-1',
          isPrimary: false,
          memberId: 'member-1',
          orgUnitId: 'unit-1',
          positionId: null,
          updatedAt: '2026-10-27T00:00:00.000Z',
        },
      });
      try {
        await updateMembership({ ...modalInput, id: 'membership-1' });
        const request = harness.capture();
        const sentKeys = Object.keys(
          (request.variables?.['input'] ?? {}) as Record<string, unknown>,
        ).sort();

        expect(sentKeys).toEqual(UPDATE_MEMBERSHIP_INPUT_FIELDS);
        expect(request.variables).toEqual({
          input: {
            effectiveFrom: '2026-10-01',
            effectiveTo: '2026-10-26',
            id: 'membership-1',
            isPrimary: false,
            orgUnitId: 'unit-1',
            positionId: null,
          },
        });
      } finally {
        harness.restore();
      }
    });
  });
});
