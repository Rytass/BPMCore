import type { DataSource } from 'typeorm';
import type {
  BPMAuthContext,
  BPMFormDataSourceSearchRequest,
} from '@rytass/bpm-core-nestjs-module';
import {
  ApiFormDataSourceRegistry,
  API_FORM_DATA_SOURCE_OPTIONS_TABLE,
} from './api-form-data-source';

describe('ApiFormDataSourceRegistry', () => {
  it('exposes only host-owned descriptors and keeps the registry versioned', (): void => {
    const registry = new ApiFormDataSourceRegistry(createDataSource());

    expect(registry.list().map((source) => [source.descriptor.key, source.descriptor.version])).toEqual([
      ['demo.cost-centers', 1],
      ['demo.cost-centers-complete', 1],
      ['demo.cost-centers-always', 1],
    ]);
    expect(registry.get('demo.cost-centers', 1)).not.toBeNull();
    expect(registry.get('demo.cost-centers', 2)).toBeNull();
  });

  it('searches active rows with bounded cursor pagination', async (): Promise<void> => {
    const query = jest.fn(
      async (): Promise<readonly Record<string, string | number>[]> => [
        { label: 'TW01 成本中心 001', sort_order: 1, value: 'CC-TW01-001' },
        { label: 'TW01 成本中心 002', sort_order: 2, value: 'CC-TW01-002' },
        { label: 'TW01 成本中心 003', sort_order: 3, value: 'CC-TW01-003' },
        { label: 'TW01 成本中心 004', sort_order: 4, value: 'CC-TW01-004' },
      ],
    );
    const source = new ApiFormDataSourceRegistry(
      createDataSource(query),
    ).get('demo.cost-centers', 1);

    if (!source) {
      throw new Error('Expected demo.cost-centers@1');
    }

    const result = await source.search(createSearchRequest());

    expect(result).toEqual({
      nextCursor: '3',
      options: [
        { label: 'TW01 成本中心 001', value: 'CC-TW01-001' },
        { label: 'TW01 成本中心 002', value: 'CC-TW01-002' },
        { label: 'TW01 成本中心 003', value: 'CC-TW01-003' },
      ],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(API_FORM_DATA_SOURCE_OPTIONS_TABLE),
      expect.arrayContaining(['demo.cost-centers', 1, 'TW01']),
    );
  });

  it('resolves only active values while preserving the requested value order', async (): Promise<void> => {
    const query = jest.fn(
      async (): Promise<readonly Record<string, string | number>[]> => [
        { label: 'TW01 成本中心 002', sort_order: 2, value: 'CC-TW01-002' },
      ],
    );
    const source = new ApiFormDataSourceRegistry(
      createDataSource(query),
    ).get('demo.cost-centers', 1);

    if (!source) {
      throw new Error('Expected demo.cost-centers@1');
    }

    await expect(
      source.resolve({
        authContext: createAuthContext(),
        bindings: { plant: 'TW01' },
        signal: new AbortController().signal,
        values: ['CC-TW01-001', 'CC-TW01-002'],
      }),
    ).resolves.toEqual([
      { label: 'TW01 成本中心 002', value: 'CC-TW01-002' },
    ]);
  });
});

function createDataSource(
  query: (
    statement: string,
    parameters?: readonly unknown[],
  ) => Promise<readonly Record<string, string | number>[]> = async (): Promise<
    readonly Record<string, string | number>[]
  > => [],
): DataSource {
  return { query } as unknown as DataSource;
}

function createSearchRequest(): BPMFormDataSourceSearchRequest {
  return {
    authContext: createAuthContext(),
    bindings: { plant: 'TW01' },
    cursor: null,
    searchText: '',
    signal: new AbortController().signal,
  };
}

function createAuthContext(): BPMAuthContext {
  return {
    memberId: 'member-102',
    metadata: { memberId: 'member-102' },
    permissions: ['instance.create'],
    roles: ['REQUESTER'],
  };
}
