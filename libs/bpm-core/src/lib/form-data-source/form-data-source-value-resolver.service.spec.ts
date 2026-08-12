import {
  FormDefinitionSchema,
  FormFieldOption,
} from '@rytass/bpm-core-shared/form';
import { BPMAuthContext } from '../bpm-auth';
import { BPMFormDataSourceResolveRequest } from './form-data-source.types';
import { BPM_FORM_DATA_SOURCE_ERROR_CODES } from './form-data-source.errors';
import { FormDataSourceValueResolverService } from './form-data-source-value-resolver.service';
import {
  BPMFormDataSource,
  BPMFormDataSourceDescriptor,
  StaticBPMFormDataSourceRegistry,
} from './form-data-source.types';

const authContext: BPMAuthContext = {
  memberId: 'member-1',
  metadata: {},
  permissions: [],
  roles: [],
};

describe('FormDataSourceValueResolverService', () => {
  it('resolves selected dynamic values into a persisted snapshot', async (): Promise<void> => {
    const resolve = jest.fn(
      (request: BPMFormDataSourceResolveRequest): Promise<readonly FormFieldOption[]> =>
        Promise.resolve([
          {
            label: `Cost center ${request.bindings.plant ?? 'unknown'}`,
            value: request.values[0],
          },
        ]),
    );
    const service = createService(createSource({ resolve }));

    const snapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData: { costCenter: 'CC-001', plant: 'TPE' },
      revalidateAll: true,
      schema: createSchema(),
    });

    expect(snapshots).toEqual({
      costCenter: expect.objectContaining({
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        options: [
          { label: 'Cost center TPE', value: 'CC-001' },
        ],
      }),
    });
    expect(snapshots.costCenter.bindingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext,
        bindings: { plant: 'TPE' },
        values: ['CC-001'],
      }),
    );
  });

  it('reuses an unchanged snapshot when the source policy permits it', async (): Promise<void> => {
    const resolve = jest.fn(() =>
      Promise.resolve([{ label: 'Cost center TPE', value: 'CC-001' }]),
    );
    const source = createSource({ resolve });
    const service = createService(source);
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });

    const snapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      previousFormData: formData,
      previousSnapshots,
      schema: createSchema(),
    });

    expect(snapshots).toEqual(previousSnapshots);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('revalidates when a binding changes', async (): Promise<void> => {
    const resolve = jest.fn(
      (request: BPMFormDataSourceResolveRequest): Promise<readonly FormFieldOption[]> =>
        Promise.resolve([
          { label: `Cost center ${request.bindings.plant}`, value: 'CC-001' },
        ]),
    );
    const service = createService(createSource({ resolve }));
    const previousFormData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData: previousFormData,
      revalidateAll: true,
      schema: createSchema(),
    });

    const snapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData: { costCenter: 'CC-001', plant: 'HKG' },
      previousFormData,
      previousSnapshots,
      schema: createSchema(),
    });

    expect(snapshots.costCenter.options).toEqual([
      { label: 'Cost center HKG', value: 'CC-001' },
    ]);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('always revalidates sources with the ALWAYS policy', async (): Promise<void> => {
    const resolve = jest.fn(() =>
      Promise.resolve([{ label: 'Cost center TPE', value: 'CC-001' }]),
    );
    const source = createSource({
      descriptor: {
        ...createDescriptor(),
        revalidationPolicy: 'ALWAYS',
      },
      resolve,
    });
    const service = createService(source);
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });

    await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      previousFormData: formData,
      previousSnapshots,
      schema: createSchema(),
    });

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('does not call providers while a required binding is missing', async (): Promise<void> => {
    const resolve = jest.fn(() => Promise.resolve([]));
    const service = createService(createSource({ resolve }));

    await expect(
      service.resolveFormDataOptionSnapshots({
        authContext,
        formData: { costCenter: 'CC-001' },
        revalidateAll: true,
        schema: createSchema(),
      }),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects provider results that do not exactly cover selected values', async (): Promise<void> => {
    const service = createService(
      createSource({
        resolve: (): Promise<readonly FormFieldOption[]> =>
          Promise.resolve([{ label: 'Wrong option', value: 'WRONG' }]),
      }),
    );

    await expect(
      service.resolveFormDataOptionSnapshots({
        authContext,
        formData: { costCenter: 'CC-001', plant: 'TPE' },
        revalidateAll: true,
        schema: createSchema(),
      }),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
    });
  });

  it('fails initial resolution when the registered source version is unavailable', async (): Promise<void> => {
    const service = createService(null);

    await expect(
      service.resolveFormDataOptionSnapshots({
        authContext,
        formData: { costCenter: 'CC-001', plant: 'TPE' },
        revalidateAll: true,
        schema: createSchema(),
      }),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING,
    });
  });

  it('keeps an unchanged snapshot readable when its provider is unavailable', async (): Promise<void> => {
    const source = createSource();
    const firstService = createService(source);
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await firstService.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });
    const unavailableService = createService(null);

    await expect(
      unavailableService.resolveFormDataOptionSnapshots({
        authContext,
        formData,
        previousFormData: formData,
        previousSnapshots,
        schema: createSchema(),
      }),
    ).resolves.toEqual(previousSnapshots);
  });

  it('does not create a snapshot for an empty dynamic value', async (): Promise<void> => {
    const resolve = jest.fn(() => Promise.resolve([]));
    const service = createService(createSource({ resolve }));

    await expect(
      service.resolveFormDataOptionSnapshots({
        authContext,
        formData: { plant: 'TPE' },
        revalidateAll: true,
        schema: createSchema(),
      }),
    ).resolves.toEqual({});
    expect(resolve).not.toHaveBeenCalled();
  });
});

function createService(
  source: BPMFormDataSource | null,
): FormDataSourceValueResolverService {
  return new FormDataSourceValueResolverService(
    new StaticBPMFormDataSourceRegistry(source ? [source] : []),
  );
}

function createSource(
  overrides: Partial<BPMFormDataSource> = {},
): BPMFormDataSource {
  return {
    descriptor: createDescriptor(),
    resolve: (): Promise<readonly FormFieldOption[]> =>
      Promise.resolve([{ label: 'Cost center TPE', value: 'CC-001' }]),
    search: (): Promise<{ readonly options: readonly FormFieldOption[] }> =>
      Promise.resolve({ options: [] }),
    ...overrides,
  };
}

function createDescriptor(): BPMFormDataSourceDescriptor {
  return {
    key: 'demo.cost-centers',
    label: 'Cost centers',
    maximumResultCount: 20,
    minimumSearchLength: 0,
    pageSize: 20,
    paginationMode: 'NONE',
    parameters: [
      {
        key: 'plant',
        required: true,
        type: 'STRING',
      },
    ],
    revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
    returnsCompleteList: true,
    supportedControls: ['select'],
    supportsSearch: false,
    version: 1,
  };
}

function createSchema(): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'plant',
        label: 'Plant',
        required: true,
        type: 'text',
      },
      {
        dataSource: {
          bindings: [
            {
              from: { fieldKey: 'plant', kind: 'FIELD' },
              parameter: 'plant',
            },
          ],
          key: 'demo.cost-centers',
          version: 1,
        },
        fieldKey: 'costCenter',
        label: 'Cost center',
        required: true,
        type: 'select',
      },
    ],
    schemaVersion: 1,
  };
}
