import {
  listFormDataSources,
  previewFormFieldOptions,
  readFormFieldOptions,
} from './form-data-source-api';

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

describe('@rytass/bpm-core-client/form DataSource API', () => {
  it('lists the public DataSource catalog', async (): Promise<void> => {
    const harness = installFetchMock({ formDataSources: [] });

    try {
      await expect(listFormDataSources()).resolves.toEqual([]);
      expect(harness.capture().query).toContain('query FormDataSources');
    } finally {
      harness.restore();
    }
  });

  it('serializes structural preview input without exposing a client reference override', async (): Promise<void> => {
    const harness = installFetchMock({
      previewFormFieldOptions: {
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        nextCursor: null,
        options: [{ label: 'A', value: 'A' }],
      },
    });

    try {
      const result = await previewFormFieldOptions({
        fieldKey: 'costCenter',
        formData: { plant: 'TPE' },
        schema: {
          fields: [],
          schemaVersion: 1,
        },
        searchText: 'A',
        uiSchema: {
          layout: [],
          schemaVersion: 1,
        },
      });
      const request = harness.capture();
      const input = request.variables?.input as Readonly<Record<string, unknown>>;

      expect(request.query).toContain('query PreviewFormFieldOptions');
      expect(input.fieldKey).toBe('costCenter');
      expect(input.formDataJson).toBe(JSON.stringify({ plant: 'TPE' }));
      expect(input.schemaJson).toBe(
        JSON.stringify({ fields: [], schemaVersion: 1 }),
      );
      expect(input).not.toHaveProperty('dataSourceKey');
      expect(result.options).toEqual([{ label: 'A', value: 'A' }]);
    } finally {
      harness.restore();
    }
  });

  it('serializes runtime context IDs while leaving source authority on the server', async (): Promise<void> => {
    const harness = installFetchMock({
      formFieldOptions: {
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        nextCursor: 'next',
        options: [],
      },
    });

    try {
      await readFormFieldOptions({
        fieldKey: 'costCenter',
        instanceId: 'returned-instance-1',
        templateId: null,
      });
      const request = harness.capture();
      const input = request.variables?.input as Readonly<Record<string, unknown>>;

      expect(request.query).toContain('query FormFieldOptions');
      expect(input).toMatchObject({
        fieldKey: 'costCenter',
        instanceId: 'returned-instance-1',
        templateId: null,
      });
      expect(input).not.toHaveProperty('dataSourceKey');
      expect(input).not.toHaveProperty('dataSourceVersion');
    } finally {
      harness.restore();
    }
  });
});
