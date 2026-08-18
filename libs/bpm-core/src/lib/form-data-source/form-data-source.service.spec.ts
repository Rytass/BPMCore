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
import { FormDataSourceValueResolverService } from './form-data-source-value-resolver.service';
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

  it('names the fields it is waiting for instead of failing the query', async (): Promise<void> => {
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
    ).resolves.toEqual({
      dataSourceKey: 'demo.cost-centers',
      dataSourceVersion: 1,
      nextCursor: null,
      options: [],
      waitingForFieldKeys: ['plant'],
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('does not wait on a field bound to an optional parameter', async (): Promise<void> => {
    // The renderer cannot tell required from optional, so a source with one
    // required and one optional parameter is exactly the case that used to
    // disable the control forever.
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [{ label: 'A', value: 'A' }] }),
    );
    const service = createService(
      createSource(
        { search },
        {
          parameters: [
            { key: 'plant', required: true, type: 'STRING' },
            { key: 'costType', required: false, type: 'STRING' },
          ],
        },
      ),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema({ withOptionalBinding: true })),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        options: [{ label: 'A', value: 'A' }],
        waitingForFieldKeys: [],
      }),
    );
    expect(search).toHaveBeenCalled();
  });

  it('rejects a required parameter fed by an empty constant as a schema defect', async (): Promise<void> => {
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [] }),
    );
    const service = createService(createSource({ search }));
    const schema = createSchema();
    const constantSchema: FormDefinitionSchema = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === 'costCenter'
          ? {
              ...field,
              dataSource: {
                ...(field as FormDataSourceOptionFieldDefinition).dataSource,
                bindings: [
                  { from: { kind: 'CONSTANT', value: null }, parameter: 'plant' },
                ],
              },
            }
          : field,
      ) as FormDefinitionSchema['fields'],
    };

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(constantSchema),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects array form data instead of treating it as a binding source', async (): Promise<void> => {
    const service = createService(createSource());

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: '[1,2]',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
  });

  it('rejects a non-finite binding value that JSON cannot round-trip', async (): Promise<void> => {
    // `1e999` parses to Infinity, which `JSON.stringify` would hand the
    // provider as `null` — a value the parameter never declared.
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [] }),
    );
    const service = createService(
      createSource(
        { search },
        { parameters: [{ key: 'plant', required: true, type: 'NUMBER' }] },
      ),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: '{"plant":1e999}',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
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
    const service = createValueResolver(createSource({ resolve }));

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

  it('reports an unregistered source key during environment lint', (): void => {
    const service = createService(null);

    expect(service.lintDefinitionSchemaEnvironment(createSchema())).toEqual([
      'schema.fields[1].dataSource FORM_DATA_SOURCE_MISSING',
    ]);
  });

  it('reports an unavailable source version during environment lint', (): void => {
    const service = createService(createSource({}, { version: 2 }));

    expect(service.lintDefinitionSchemaEnvironment(createSchema())).toEqual([
      'schema.fields[1].dataSource FORM_DATA_SOURCE_VERSION_MISSING',
    ]);
  });

  it('reports the code of the first environment error, not the first enum entry', async (): Promise<void> => {
    // Field 1 fails on control capability; field 2 references a key the host
    // never registered. DATA_SOURCE_MISSING is declared earlier in the code
    // enum, so scanning the enum would report it even though the first actual
    // error is the unsupported control.
    const service = createService(
      createSource(
        {},
        {
          maximumResultCount: 200,
          returnsCompleteList: false,
          supportedControls: ['select'],
        },
      ),
    );
    const schema = createSchema();
    const [plantField, dynamicField] = schema.fields;
    const twoErrorSchema: FormDefinitionSchema = {
      ...schema,
      fields: [
        plantField,
        { ...dynamicField, type: 'radio' },
        {
          ...dynamicField,
          dataSource: {
            ...(dynamicField as FormDataSourceOptionFieldDefinition).dataSource,
            key: 'demo.absent',
          },
          fieldKey: 'costCenterAbsent',
        },
      ] as FormDefinitionSchema['fields'],
    };

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(twoErrorSchema),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_UNSUPPORTED_CONTROL',
    });
  });

  it('does not read a code out of a host-chosen parameter name', async (): Promise<void> => {
    // The unbound parameter is named exactly like an error code, so the prose
    // line ends in "FORM_DATA_SOURCE_TIMEOUT". Reporting that as the code would
    // tell the designer the source timed out instead of that a binding is
    // missing, which is what the binding shape must yield.
    const service = createService(
      createSource(
        {},
        {
          parameters: [
            { key: 'plant', required: true, type: 'STRING' },
            {
              key: 'FORM_DATA_SOURCE_TIMEOUT',
              required: true,
              type: 'STRING',
            },
          ],
        },
      ),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      // The binding shape decides the code; the parameter's name must not.
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
  });

  it('reports a binding failure as an actionable binding error', async (): Promise<void> => {
    // The source and control are fine; only the binding is wrong. Falling back
    // to INVALID_DESCRIPTOR would tell the designer to contact an admin about
    // something they can fix themselves.
    const service = createService(
      createSource(
        {},
        {
          parameters: [
            { key: 'plant', required: true, type: 'STRING' },
            { key: 'company', required: true, type: 'STRING' },
          ],
        },
      ),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
  });

  it('falls back to the descriptor code when no lint line carries one', async (): Promise<void> => {
    // An invalid descriptor only produces prose ("descriptor.pageSize must be
    // positive"), so there is no code to extract. This pins the fallback branch
    // itself, which had no coverage before — it does not discriminate between
    // the old and new code parsers.
    const service = createService(createSource({}, { pageSize: 0 }));

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_DESCRIPTOR',
    });
  });

  it('reports an unsupported bounded control exactly once', (): void => {
    const service = createService(
      createSource(
        {},
        {
          maximumResultCount: 200,
          returnsCompleteList: false,
          supportedControls: ['select'],
        },
      ),
    );
    const schema = createSchema();
    const radioSchema: FormDefinitionSchema = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === 'costCenter' ? { ...field, type: 'radio' } : field,
      ) as FormDefinitionSchema['fields'],
    };

    expect(service.lintDefinitionSchemaEnvironment(radioSchema)).toEqual([
      'schema.fields[1].dataSource FORM_DATA_SOURCE_UNSUPPORTED_CONTROL',
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

  it('reports the values a provider could not account for instead of failing', async (): Promise<void> => {
    const service = createService(
      createSource({
        resolve: jest.fn(() => Promise.resolve([{ label: 'A', value: 'A' }])),
      }),
    );

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify(['A', 'GONE']),
        },
        authContext,
      ),
    ).resolves.toEqual({
      dataSourceKey: 'demo.cost-centers',
      dataSourceVersion: 1,
      options: [{ label: 'A', value: 'A' }],
      unresolvedValues: ['GONE'],
      waitingForFieldKeys: [],
    });
  });

  it('keeps submit-time resolution all-or-nothing while the query is lenient', async (): Promise<void> => {
    // The same provider answer the read-only query reports as a partial result
    // must still refuse to be written into an instance, so both modes are
    // driven from one source here rather than trusted to stay in step.
    const source = createSource({
      resolve: jest.fn(() => Promise.resolve([{ label: 'A', value: 'A' }])),
    });

    await expect(
      createValueResolver(source).resolveFormFieldOptions({
        authContext,
        field: createSchema().fields[1] as FormDataSourceOptionFieldDefinition,
        formData: { plant: 'TPE' },
        values: ['A', 'GONE'],
      }),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_VALUE_NOT_RESOLVED',
    });
    await expect(
      createService(source).previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify(['A', 'GONE']),
        },
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ unresolvedValues: ['GONE'] }),
    );
  });

  it('reports only the required dependency when an optional one is also empty', async (): Promise<void> => {
    // The shape the demo form uses: one required binding and one optional one,
    // both pointing at empty fields. Naming the optional field too would keep
    // the control disabled after the filler has done everything required.
    const search = jest.fn(
      (): Promise<BPMFormDataSourceSearchResult> =>
        Promise.resolve({ options: [] }),
    );
    const service = createService(
      createSource(
        { search },
        {
          parameters: [
            { key: 'plant', required: true, type: 'STRING' },
            { key: 'costType', required: false, type: 'STRING' },
          ],
        },
      ),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({}),
          schemaJson: JSON.stringify(createSchema({ withOptionalBinding: true })),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
        },
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ options: [], waitingForFieldKeys: ['plant'] }),
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('does not call the provider to resolve an empty value list', async (): Promise<void> => {
    const resolve = jest.fn(() => Promise.resolve([]));
    const service = createService(createSource({ resolve }));

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: '[]',
        },
        authContext,
      ),
    ).resolves.toEqual({
      dataSourceKey: 'demo.cost-centers',
      dataSourceVersion: 1,
      options: [],
      unresolvedValues: [],
      waitingForFieldKeys: [],
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reports a waiting dependency from the resolve query without calling the provider', async (): Promise<void> => {
    const resolve = jest.fn(() => Promise.resolve([]));
    const service = createService(createSource({ resolve }));

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify(['A']),
        },
        authContext,
      ),
    ).resolves.toEqual({
      dataSourceKey: 'demo.cost-centers',
      dataSourceVersion: 1,
      options: [],
      unresolvedValues: [],
      waitingForFieldKeys: ['plant'],
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('still rejects a provider that answers with an unrequested value', async (): Promise<void> => {
    const service = createService(
      createSource({
        resolve: jest.fn(() =>
          Promise.resolve([{ label: 'Other', value: 'OTHER' }]),
        ),
      }),
    );

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify(['A']),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
    });
  });

  it('rejects a duplicated requested value', async (): Promise<void> => {
    const resolve = jest.fn(() => Promise.resolve([]));
    const service = createService(createSource({ resolve }));

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify(['A', 'A']),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a values payload that is not a JSON string array', async (): Promise<void> => {
    const service = createService(createSource());

    await expect(
      service.previewResolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          schemaJson: JSON.stringify(createSchema()),
          uiSchemaJson: JSON.stringify({ layout: [], schemaVersion: 1 }),
          valuesJson: JSON.stringify([1, 2]),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: 'FORM_DATA_SOURCE_INVALID_BINDING',
    });
  });

  it('resolves runtime values through the same launchable-template check', async (): Promise<void> => {
    const resolve = jest.fn(() =>
      Promise.resolve([{ label: 'Cost center A', value: 'A' }]),
    );
    const service = createService(createSource({ resolve }), {
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
          Promise.resolve([
            { currentVersionId: 'template-version-1', id: 'template-1' },
          ]),
        ),
      } as unknown as WorkflowEngineService,
    });

    await expect(
      service.resolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          formDataJson: JSON.stringify({ plant: 'TPE' }),
          templateId: 'template-1',
          valuesJson: JSON.stringify(['A']),
        },
        authContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        options: [{ label: 'Cost center A', value: 'A' }],
        unresolvedValues: [],
      }),
    );
  });

  it('rejects a runtime resolve for a non-launchable template', async (): Promise<void> => {
    const service = createService(createSource(), {
      workflowEngineService: {
        listLaunchableApprovalTemplates: jest.fn(() => Promise.resolve([])),
      } as unknown as WorkflowEngineService,
    });

    await expect(
      service.resolveFormFieldOptionValues(
        {
          fieldKey: 'costCenter',
          templateId: 'not-launchable',
          valuesJson: JSON.stringify(['A']),
        },
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

/**
 * The submit-time resolver is a different class from the query service, and the
 * all-or-nothing rule lives there, so contrast tests build both from one source.
 */
function createValueResolver(
  source: BPMFormDataSource,
): FormDataSourceValueResolverService {
  return new FormDataSourceValueResolverService(
    new StaticBPMFormDataSourceRegistry([source]),
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

function createSchema({
  withOptionalBinding = false,
}: { readonly withOptionalBinding?: boolean } = {}): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'plant',
        label: 'Plant',
        required: true,
        type: 'text',
      },
      ...(withOptionalBinding
        ? [
            {
              fieldKey: 'costType',
              label: 'Cost type',
              required: false,
              type: 'text' as const,
            },
          ]
        : []),
      {
        dataSource: {
          bindings: [
            {
              from: { fieldKey: 'plant', kind: 'FIELD' },
              parameter: 'plant',
            },
            ...(withOptionalBinding
              ? [
                  {
                    from: { fieldKey: 'costType', kind: 'FIELD' as const },
                    parameter: 'costType',
                  },
                ]
              : []),
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
