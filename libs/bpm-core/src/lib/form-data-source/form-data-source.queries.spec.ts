import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { BPMAuthContext } from '../bpm-auth';
import { BPMAuthenticatedGuard } from '../bpm-auth/bpm-auth.guard';
import { BPMDesignerGuard } from '../bpm-auth/bpm-auth.authorization';
import { BPMFormDataSourceException } from './form-data-source.errors';
import {
  FormDataSourceQueries,
  PreviewFormFieldOptionsInput,
  PreviewResolveFormFieldOptionsInput,
  RuntimeFormFieldOptionsInput,
} from './form-data-source.queries';
import { FormDataSourceService } from './form-data-source.service';
import {
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
  BPMFormDataSourceResolveResult,
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
      waitingForFieldKeys: ['plant'],
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
        waitingForFieldKeys: ['plant'],
      }),
    );
  });

  it('maps the resolve result including the values that stayed unresolved', async (): Promise<void> => {
    const service = createService({
      resolveResult: {
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        options: [{ label: 'Cost center A', value: 'A' }],
        unresolvedValues: ['GONE'],
        waitingForFieldKeys: [],
      },
    });
    const queries = new FormDataSourceQueries(service);

    await expect(
      queries.previewResolveFormFieldOptions(
        new PreviewResolveFormFieldOptionsInput(),
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        options: [{ label: 'Cost center A', value: 'A' }],
        unresolvedValues: ['GONE'],
        waitingForFieldKeys: [],
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
    const previewResolveGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      FormDataSourceQueries.prototype.previewResolveFormFieldOptions,
    ) as readonly unknown[];
    const runtimeResolveGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      FormDataSourceQueries.prototype.resolveFormFieldOptions,
    ) as readonly unknown[];

    expect(catalogGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(previewGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(previewResolveGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(runtimeGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard]),
    );
    expect(runtimeGuards).not.toEqual(
      expect.arrayContaining([BPMDesignerGuard]),
    );
    expect(runtimeResolveGuards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard]),
    );
    expect(runtimeResolveGuards).not.toEqual(
      expect.arrayContaining([BPMDesignerGuard]),
    );
  });

  it('bounds every browser-controlled input length', async (): Promise<void> => {
    const input = new RuntimeFormFieldOptionsInput();
    input.cursor = null;
    input.fieldKey = 'costCenter';
    input.formDataJson = null;
    input.instanceId = null;
    input.searchText = 'x'.repeat(201);
    input.templateId = 'template-1';

    const errors = await validate(input);

    expect(errors).toEqual([
      expect.objectContaining({
        constraints: { maxLength: 'FORM_DATA_SOURCE_INVALID_BINDING' },
        property: 'searchText',
      }),
    ]);
  });
});

function createService({
  descriptor,
  error,
  resolveResult,
  result,
}: {
  readonly descriptor?: BPMFormDataSourceDescriptor;
  readonly error?: Error;
  readonly resolveResult?: BPMFormDataSourceResolveResult;
  readonly result?: BPMFormDataSourceOptionResult;
}): FormDataSourceService {
  const readOptions = (): Promise<BPMFormDataSourceOptionResult> =>
    error
      ? Promise.reject(error)
      : Promise.resolve(result as BPMFormDataSourceOptionResult);
  const readResolved = (): Promise<BPMFormDataSourceResolveResult> =>
    error
      ? Promise.reject(error)
      : Promise.resolve(resolveResult as BPMFormDataSourceResolveResult);

  return {
    formFieldOptions: readOptions,
    listDescriptors: (): readonly BPMFormDataSourceDescriptor[] =>
      descriptor ? [descriptor] : [],
    previewFormFieldOptions: readOptions,
    previewResolveFormFieldOptionValues: readResolved,
    resolveFormFieldOptionValues: readResolved,
  } as unknown as FormDataSourceService;
}
