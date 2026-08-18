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

  it('separates an unselectable value from a provider contract breach', async (): Promise<void> => {
    const service = createService(
      createSource({
        resolve: (): Promise<readonly FormFieldOption[]> => Promise.resolve([]),
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
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.VALUE_NOT_RESOLVED,
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

  it('records the source policy on every snapshot it writes', async (): Promise<void> => {
    const service = createService(createSource());

    const snapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData: { costCenter: 'CC-001', plant: 'TPE' },
      revalidateAll: true,
      schema: createSchema(),
    });

    expect(snapshots.costCenter.revalidationPolicy).toBe(
      'WHEN_VALUE_OR_BINDINGS_CHANGE',
    );
  });

  it('refuses to carry an ALWAYS snapshot forward once its source is gone', async (): Promise<void> => {
    // The descriptor is unreachable at this point, so the snapshot's own record
    // of the policy is the only thing standing between a delisted source and a
    // resubmit that skips the revalidation the host demanded.
    const alwaysSource = createSource({
      descriptor: { ...createDescriptor(), revalidationPolicy: 'ALWAYS' },
    });
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await createService(
      alwaysSource,
    ).resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });

    await expect(
      createService(null).resolveFormDataOptionSnapshots({
        authContext,
        formData,
        previousFormData: formData,
        previousSnapshots,
        schema: createSchema(),
      }),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING,
    });
  });

  it('keeps reusing a snapshot written before the policy was recorded', async (): Promise<void> => {
    // Instances persisted before the field existed must stay resubmittable.
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await createService(
      createSource(),
    ).resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });
    const legacySnapshots = {
      costCenter: {
        bindingHash: previousSnapshots.costCenter.bindingHash,
        dataSourceKey: previousSnapshots.costCenter.dataSourceKey,
        dataSourceVersion: previousSnapshots.costCenter.dataSourceVersion,
        options: previousSnapshots.costCenter.options,
        validatedAt: previousSnapshots.costCenter.validatedAt,
      },
    };

    await expect(
      createService(null).resolveFormDataOptionSnapshots({
        authContext,
        formData,
        previousFormData: formData,
        previousSnapshots: legacySnapshots,
        schema: createSchema(),
      }),
    ).resolves.toEqual(legacySnapshots);
  });

  it('stamps the current policy onto a reused snapshot while the source is readable', async (): Promise<void> => {
    const service = createService(createSource());
    const formData = { costCenter: 'CC-001', plant: 'TPE' };
    const previousSnapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema: createSchema(),
    });
    const legacySnapshots = {
      costCenter: {
        bindingHash: previousSnapshots.costCenter.bindingHash,
        dataSourceKey: previousSnapshots.costCenter.dataSourceKey,
        dataSourceVersion: previousSnapshots.costCenter.dataSourceVersion,
        options: previousSnapshots.costCenter.options,
        validatedAt: previousSnapshots.costCenter.validatedAt,
      },
    };

    const snapshots = await service.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      previousFormData: formData,
      previousSnapshots: legacySnapshots,
      schema: createSchema(),
    });

    expect(snapshots.costCenter.revalidationPolicy).toBe(
      'WHEN_VALUE_OR_BINDINGS_CHANGE',
    );
  });

  it('bounds how many providers a single submit calls at once', async (): Promise<void> => {
    const pendingCalls: (() => void)[] = [];
    const resolve = jest.fn(
      (request: BPMFormDataSourceResolveRequest): Promise<readonly FormFieldOption[]> =>
        new Promise<readonly FormFieldOption[]>((settle) => {
          pendingCalls.push(() =>
            settle([{ label: request.values[0], value: request.values[0] }]),
          );
        }),
    );
    const service = createService(createSource({ resolve }));
    const pending = service.resolveFormDataOptionSnapshots({
      authContext,
      formData: createWideFormData(10),
      revalidateAll: true,
      schema: createWideSchema(10),
    });

    // Ten dynamic fields, but the eleventh call only opens once one of the
    // first four has answered.
    await flushMicrotasks();
    expect(resolve).toHaveBeenCalledTimes(4);

    await releaseAll(pendingCalls);
    expect(resolve).toHaveBeenCalledTimes(8);

    await releaseAll(pendingCalls);
    expect(resolve).toHaveBeenCalledTimes(10);

    await releaseAll(pendingCalls);
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ costCenter9: expect.anything() }),
    );
  });

  it('stops starting provider calls once one field has failed', async (): Promise<void> => {
    const resolve = jest.fn(
      (request: BPMFormDataSourceResolveRequest): Promise<readonly FormFieldOption[]> =>
        request.values[0] === 'CC-0'
          ? Promise.reject(new Error('upstream down'))
          : new Promise<readonly FormFieldOption[]>((settle) => {
              setImmediate(() =>
                settle([
                  { label: request.values[0], value: request.values[0] },
                ]),
              );
            }),
    );
    const service = createService(createSource({ resolve }));

    await expect(
      service.resolveFormDataOptionSnapshots({
        authContext,
        formData: createWideFormData(10),
        revalidateAll: true,
        schema: createWideSchema(10),
      }),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.PROVIDER_FAILURE,
    });
    // The failure is seen before the already-running calls answer, so the
    // fields behind them never reach their provider at all.
    expect(resolve.mock.calls.length).toBeLessThan(10);
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

/**
 * Lets every already-queued microtask run before the assertion, so "how many
 * provider calls are open right now" is a settled number rather than a race.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((settle) => {
    setImmediate(settle);
  });
}

async function releaseAll(pendingCalls: (() => void)[]): Promise<void> {
  pendingCalls.splice(0, pendingCalls.length).forEach((release) => release());

  await flushMicrotasks();
}

function createWideFormData(
  fieldCount: number,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries([
    ['plant', 'TPE'],
    ...Array.from({ length: fieldCount }, (_item, index) => [
      `costCenter${index}`,
      `CC-${index}`,
    ]),
  ]);
}

function createWideSchema(fieldCount: number): FormDefinitionSchema {
  const [plantField, dynamicField] = createSchema().fields;

  return {
    fields: [
      plantField,
      ...Array.from({ length: fieldCount }, (_item, index) => ({
        ...dynamicField,
        fieldKey: `costCenter${index}`,
      })),
    ] as FormDefinitionSchema['fields'],
    schemaVersion: 1,
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
