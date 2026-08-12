import { Repository } from 'typeorm';
import {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
} from '@rytass/bpm-core-shared/form';
import { BPMAuthContext } from '../bpm-auth';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalInstanceStateEnum } from '../workflow-engine/workflow-engine.enums';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import { FormDataSourceService } from './form-data-source.service';
import {
  BPMFormDataSource,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceSearchRequest,
  BPMFormDataSourceSearchResult,
  StaticBPMFormDataSourceRegistry,
} from './form-data-source.types';

const authContext: BPMAuthContext = {
  memberId: 'member-1',
  metadata: {},
  permissions: ['bpm:form:design'],
  roles: [],
};

describe('FormDataSourceService', () => {
  afterEach((): void => {
    jest.useRealTimers();
  });

  it('searches a registered source with server-derived bindings', async (): Promise<void> => {
    const search = jest.fn(
      (request: BPMFormDataSourceSearchRequest): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({
          nextCursor: null,
          options: [
            {
              label: `Cost center ${request.bindings.plant}`,
              value: 'CC-001',
            },
          ],
        }),
    );
    const source = createSource({ search });
    const service = createService(source);
    const result = await service.previewFormFieldOptions(
      {
        fieldKey: 'costCenter',
        formDataJson: JSON.stringify({ plant: 'TPE' }),
        schemaJson: JSON.stringify(createSchema()),
        searchText: '',
        uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
      },
      authContext,
    );

    expect(result.options).toEqual([
      { label: 'Cost center TPE', value: 'CC-001' },
    ]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: { plant: 'TPE' },
        searchText: '',
      }),
    );
  });

  it('waits for required dependencies before calling the provider', async (): Promise<void> => {
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [] }),
    );
    const service = createService(createSource({ search }));

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({}),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES',
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('allows an empty initial page when a non-empty search has a minimum length', async (): Promise<void> => {
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [{ label: 'Cost center', value: 'CC-001' }] }),
    );
    const service = createService(
      createSource({ search }, { minimumSearchLength: 2 }),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TW01' }),
          schemaJson: JSON.stringify(createSchema()),
          searchText: '',
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        options: [{ label: 'Cost center', value: 'CC-001' }],
      }),
    );
    expect(search).toHaveBeenCalled();
  });

  it('resolves all requested values and restores the client order', async (): Promise<void> => {
    const resolve = jest.fn(() =>
      Promise.resolve([
        { label: 'B', value: 'B' },
        { label: 'A', value: 'A' },
      ]),
    );
    const source = createSource({
      resolve,
    });
    const service = createService(source);

    const result = await service.resolveFormFieldOptions({
      authContext,
      field: createSchema().fields[1] as FormDataSourceOptionFieldDefinition,
      formData: { plant: 'TPE' },
      values: ['A', 'B'],
    });

    expect(result).toEqual([
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
    ]);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['A', 'B'] }),
    );
  });

  it('rejects duplicate provider options without exposing provider details', async (): Promise<void> => {
    const service = createService(
      createSource({
        search: jest.fn(() =>
          Promise.resolve({
            options: [
              { label: 'A', value: 'A' },
              { label: 'A again', value: 'A' },
            ],
          }),
        ),
      }),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
      response: {
        message: 'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
      },
    });
  });

  it('aborts a provider that exceeds the bounded timeout', async (): Promise<void> => {
    jest.useFakeTimers();
    const service = createService(
      createSource({
        search: jest.fn(
          (): Promise<BPMFormDataSourceSearchResult> =>
            new Promise<BPMFormDataSourceSearchResult>(() => undefined),
        ),
      }),
    );
    const request = service.previewFormFieldOptions(
      {
        fieldKey: 'costCenter',
        formDataJson: JSON.stringify({ plant: 'TPE' }),
        schemaJson: JSON.stringify(createSchema()),
        uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
      },
      authContext,
    );
    const requestExpectation = expect(request).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_TIMEOUT',
    });

    await jest.advanceTimersByTimeAsync(5_000);

    await requestExpectation;
  });

  it('reports an unavailable source version during environment lint', (): void => {
    const service = createService(null);

    expect(service.lintDefinitionSchemaEnvironment(createSchema())).toEqual([
      'schema.fields[1].dataSource FORM_DATA_SOURCE_VERSION_MISSING',
    ]);
  });

  it('derives a runtime source from a launchable published template', async (): Promise<void> => {
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [{ label: 'A', value: 'A' }] }),
    );
    const service = createService(createSource({ search }), {
      approvalTemplateVersionRepository: {
        findOne: jest.fn(() =>
          Promise.resolve({
            formDefinitionVersionId: 'form-version-1',
            id: 'template-version-1',
            status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          } as ApprovalTemplateVersionEntity),
        ),
      } as unknown as Repository<ApprovalTemplateVersionEntity>,
      formDefinitionVersionRepository: {
        findOne: jest.fn(() =>
          Promise.resolve({
            id: 'form-version-1',
            schema: createSchema(),
            status: FormDefinitionVersionStatusEnum.PUBLISHED,
            uiSchema: { layout: [], schemaVersion: 1 },
          } as unknown as FormDefinitionVersionEntity),
        ),
      } as unknown as Repository<FormDefinitionVersionEntity>,
      workflowEngineService: {
        listLaunchableApprovalTemplates: jest.fn(() =>
          Promise.resolve([{ currentVersionId: 'template-version-1', id: 'template-1' }]),
        ),
      } as unknown as WorkflowEngineService,
    });

    const result = await service.formFieldOptions(
      {
        fieldKey: 'costCenter',
        formDataJson: JSON.stringify({ plant: 'TPE' }),
        templateId: 'template-1',
      },
      authContext,
    );

    expect(result.options).toEqual([{ label: 'A', value: 'A' }]);
    expect(search).toHaveBeenCalled();
  });

  it('rejects a runtime request for a non-launchable template', async (): Promise<void> => {
    const service = createService(createSource(), {
      workflowEngineService: {
        listLaunchableApprovalTemplates: jest.fn(() => Promise.resolve([])),
      } as unknown as WorkflowEngineService,
    });

    await expect(
      service.formFieldOptions(
        { fieldKey: 'costCenter', templateId: 'not-launchable' },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN',
    });
  });

  it('allows only the initiator to query a returned instance', async (): Promise<void> => {
    const service = createService(createSource(), {
      workflowEngineService: {
        getApprovalInstance: jest.fn(() =>
          Promise.resolve({
            formDefinitionSnapshot: {
              schema: createSchema(),
              uiSchema: { layout: [], schemaVersion: 1 },
            },
            initiatorMemberId: 'other-member',
            state: ApprovalInstanceStateEnum.RETURNED,
          }),
        ),
      } as unknown as WorkflowEngineService,
    });

    await expect(
      service.formFieldOptions(
        { fieldKey: 'costCenter', instanceId: 'returned-instance-1' },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN',
    });
  });
});

function createService(
  source: BPMFormDataSource | null,
  dependencies: {
    readonly approvalTemplateVersionRepository?: Repository<ApprovalTemplateVersionEntity>;
    readonly formDefinitionVersionRepository?: Repository<FormDefinitionVersionEntity>;
    readonly workflowEngineService?: WorkflowEngineService;
  } = {},
): FormDataSourceService {
  const registry = new StaticBPMFormDataSourceRegistry(
    source ? [source] : [],
  );

  return new FormDataSourceService(
    registry,
    dependencies.approvalTemplateVersionRepository ??
      ({} as Repository<ApprovalTemplateVersionEntity>),
    dependencies.formDefinitionVersionRepository ??
      ({} as Repository<FormDefinitionVersionEntity>),
    dependencies.workflowEngineService ?? ({} as WorkflowEngineService),
  );
}

function createSource(
  overrides: Partial<BPMFormDataSource> = {},
  descriptorOverrides: Partial<BPMFormDataSourceDescriptor> = {},
): BPMFormDataSource {
  const descriptor: BPMFormDataSourceDescriptor = {
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
    supportedControls: ['select', 'autocomplete'],
    supportsSearch: true,
    version: 1,
    ...descriptorOverrides,
  };

  return {
    descriptor,
    resolve: () => Promise.resolve([]),
    search: () => Promise.resolve({ options: [] }),
    ...overrides,
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
