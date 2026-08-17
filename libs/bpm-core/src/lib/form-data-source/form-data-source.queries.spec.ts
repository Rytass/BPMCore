import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BPMAuthContext } from '../bpm-auth';
import { BPMAuthenticatedGuard } from '../bpm-auth/bpm-auth.guard';
import { BPMDesignerGuard } from '../bpm-auth/bpm-auth.authorization';
import { BPMFormDataSourceException } from './form-data-source.errors';
import {
  FormDataSourceQueries,
  PreviewFormFieldOptionsInput,
} from './form-data-source.queries';
import { FormDataSourceService } from './form-data-source.service';
import {
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
} from './form-data-source.types';

const authContext: BPMAuthContext = {
  memberId: 'designer-1',
  metadata: {},
  permissions: ['bpm:form:design'],
  roles: [],
};

describe('FormDataSourceQueries', () => {
  it('maps the catalog and option result to GraphQL objects', async (): Promise<void> => {
    const descriptor: BPMFormDataSourceDescriptor = {
      key: 'demo.cost-centers',
      label: 'Cost centers',
      maximumResultCount: 20,
      minimumSearchLength: 2,
      pageSize: 20,
      paginationMode: 'CURSOR',
      parameters: [
        { key: 'plant', label: 'Plant', required: true, type: 'STRING' },
      ],
      revalidationPolicy: 'ALWAYS',
      returnsCompleteList: false,
      supportedControls: ['autocomplete'],
      supportsSearch: true,
      version: 1,
    };
    const result: BPMFormDataSourceOptionResult = {
      dataSourceKey: descriptor.key,
      dataSourceVersion: descriptor.version,
      nextCursor: 'next',
      options: [{ label: 'Cost center A', value: 'A' }],
    };
    const service = createService({ descriptor, result });
    const queries = new FormDataSourceQueries(service);

    expect(queries.formDataSources()).toEqual([
      expect.objectContaining({
        key: descriptor.key,
        parameters: [
          expect.objectContaining({ key: 'plant', type: 'STRING' }),
        ],
      }),
    ]);
    await expect(
      queries.previewFormFieldOptions(
        new PreviewFormFieldOptionsInput(),
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        dataSourceKey: descriptor.key,
        nextCursor: 'next',
        options: [{ label: 'Cost center A', value: 'A' }],
      }),
    );
  });

  it('preserves stable provider errors at the GraphQL resolver boundary', async (): Promise<void> => {
    const service = createService({
      error: new BPMFormDataSourceException(
        'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
      ),
    });
    const queries = new FormDataSourceQueries(service);

    await expect(
      queries.previewFormFieldOptions(
        new PreviewFormFieldOptionsInput(),
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
    });
  });

  it('requires designer guards for catalog/preview and authentication for runtime', (): void => {
    const catalogGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      FormDataSourceQueries.prototype.formDataSources,
    ) as readonly unknown[];
    const previewGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      FormDataSourceQueries.prototype.previewFormFieldOptions,
    ) as readonly unknown[];
    const runtimeGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      FormDataSourceQueries.prototype.formFieldOptions,
    ) as readonly unknown[];

    expect(catalogGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(previewGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(runtimeGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard]),
    );
    expect(runtimeGuards).not.toEqual(
      expect.arrayContaining([BPMDesignerGuard]),
    );
  });
});

function createService({
  descriptor,
  error,
  result,
}: {
  readonly descriptor?: BPMFormDataSourceDescriptor;
  readonly error?: Error;
  readonly result?: BPMFormDataSourceOptionResult;
}): FormDataSourceService {
  return {
    formFieldOptions: (): Promise<BPMFormDataSourceOptionResult> =>
      error ? Promise.reject(error) : Promise.resolve(result as BPMFormDataSourceOptionResult),
    listDescriptors: (): readonly BPMFormDataSourceDescriptor[] =>
      descriptor ? [descriptor] : [],
    previewFormFieldOptions: (): Promise<BPMFormDataSourceOptionResult> =>
      error ? Promise.reject(error) : Promise.resolve(result as BPMFormDataSourceOptionResult),
  } as unknown as FormDataSourceService;
}
