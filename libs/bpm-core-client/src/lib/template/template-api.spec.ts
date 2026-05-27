import {
  createApprovalTemplate,
  listApprovalTemplates,
} from './template-api';

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

describe('@rytass/bpm-core-client/template', () => {
  describe('listApprovalTemplates', () => {
    it('issues the ApprovalTemplates query and returns the records', async (): Promise<void> => {
      const harness = installFetchMock({ approvalTemplates: [] });
      try {
        const records = await listApprovalTemplates();
        const request = harness.capture();

        expect(request.query).toContain('query ApprovalTemplates');
        expect(request.variables).toBeUndefined();
        expect(records).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('createApprovalTemplate', () => {
    it('wraps the name and category into CreateApprovalTemplateInput', async (): Promise<void> => {
      const harness = installFetchMock({
        createApprovalTemplate: { id: 'template-1' },
      });
      try {
        const id = await createApprovalTemplate({
          categoryId: 'cat-1',
          name: 'Expense reimbursement',
        });
        const request = harness.capture();

        expect(request.query).toContain('mutation CreateApprovalTemplate');
        expect(request.variables).toEqual({
          input: {
            category: null,
            categoryId: 'cat-1',
            createdByMemberId: null,
            description: null,
            formDefinitionVersionId: null,
            name: 'Expense reimbursement',
          },
        });
        expect(id).toBe('template-1');
      } finally {
        harness.restore();
      }
    });
  });
});
