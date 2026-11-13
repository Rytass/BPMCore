import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type {
  FormDataSourceBindingSource,
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormFieldOption,
} from '@rytass/bpm-core-shared/form';
import { Repository } from 'typeorm';
import { BPMAuthContext } from '../bpm-auth';
import { ConditionService } from '../condition/condition.service';
import { createExpressionBudget } from '../condition/expression-budget';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunction } from '../expression-function/expression-function.types';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { parseAndValidateFormSchemas } from '../form/form-schema.validator';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import { BPM_FORM_DATA_SOURCE_ERROR_CODES } from './form-data-source.errors';
import {
  createFormDataSourceExpressionEvaluator,
  readExpressionBindingDependencies,
} from './form-data-source.expression';
import { FormDataSourceService } from './form-data-source.service';
import {
  BPMFormDataSource,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceResolveRequest,
  BPMFormDataSourceSearchRequest,
  StaticBPMFormDataSourceRegistry,
} from './form-data-source.types';
import { FormDataSourceValueResolverService } from './form-data-source-value-resolver.service';
import {
  createTableColumnBindingPosition,
  readBindingHash,
  readBindingValues,
  readWaitingForFieldKeys,
  TOP_LEVEL_BINDING_POSITION,
} from './form-data-source.validation';

/**
 * Phase 23 P5: `EXPRESSION` DataSource bindings (ADR 22 §3.7, docs/24 §2.8),
 * against the installed cel-v2 engine (jest.real-engine.config.cts).
 */

const authContext: BPMAuthContext = {
  memberId: 'member-1',
  metadata: {},
  permissions: [],
  roles: [],
};

const PLANT_EXPRESSION =
  'form.chargeTo == "OTHER" ? (form.plant == "TW01" ? "TW02" : "TW01") : form.plant';

const HOST_FUNCTIONS: readonly BPMExpressionFunction[] = [
  {
    description: 'Plant of a region',
    handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
      args[0] === 'north' ? 'TW02' : 'TW01',
    label: 'plant',
    name: 'erp_plant_v1',
    parameters: [{ name: 'region', type: 'string' }],
    returnType: 'string',
  },
];

const DESCRIPTOR: BPMFormDataSourceDescriptor = {
  key: 'demo.cost-centers',
  label: 'Cost centers',
  maximumResultCount: 50,
  minimumSearchLength: 0,
  pageSize: 20,
  paginationMode: 'NONE',
  parameters: [{ key: 'plant', required: true, type: 'STRING' }],
  revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
  returnsCompleteList: true,
  supportedControls: ['select', 'autocomplete'],
  supportsSearch: true,
  version: 1,
};

const expressionField = (
  expression: string,
  overrides: Partial<FormDataSourceOptionFieldDefinition> = {},
): FormDataSourceOptionFieldDefinition =>
  ({
    dataSource: {
      bindings: [{ from: { expression, kind: 'EXPRESSION' }, parameter: 'plant' }],
      key: 'demo.cost-centers',
      version: 1,
    },
    fieldKey: 'chargedCostCenter',
    label: 'Charged cost center',
    required: true,
    type: 'select',
    ...overrides,
  }) as FormDataSourceOptionFieldDefinition;

const createSchema = (
  from: FormDataSourceBindingSource = {
    expression: PLANT_EXPRESSION,
    kind: 'EXPRESSION',
  },
): FormDefinitionSchema => ({
  fields: [
    {
      fieldKey: 'plant',
      label: 'Plant',
      options: [
        { label: 'TW01', value: 'TW01' },
        { label: 'TW02', value: 'TW02' },
      ],
      required: true,
      type: 'select',
    },
    {
      fieldKey: 'chargeTo',
      label: 'Charge to',
      options: [
        { label: 'Self', value: 'SELF' },
        { label: 'Other', value: 'OTHER' },
      ],
      required: true,
      type: 'select',
    },
    { fieldKey: 'amount', label: 'Amount', required: false, type: 'number' },
    {
      dataSource: {
        bindings: [{ from, parameter: 'plant' }],
        key: 'demo.cost-centers',
        version: 1,
      },
      fieldKey: 'chargedCostCenter',
      label: 'Charged cost center',
      required: true,
      type: 'select',
    },
  ],
  schemaVersion: 1,
});

const createTableSchema = (expression: string): FormDefinitionSchema => ({
  fields: [
    {
      fieldKey: 'defaultPlant',
      label: 'Default plant',
      required: false,
      type: 'text',
    },
    {
      columns: [
        { fieldKey: 'plant', label: 'Plant', required: false, type: 'text' },
        {
          dataSource: {
            bindings: [
              { from: { expression, kind: 'EXPRESSION' }, parameter: 'plant' },
            ],
            key: 'demo.cost-centers',
            version: 1,
          },
          fieldKey: 'costCenter',
          label: 'Cost center',
          mode: 'single',
          required: false,
          type: 'select',
        },
      ],
      fieldKey: 'items',
      label: 'Items',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
});

interface RecordingSource {
  readonly resolveRequests: BPMFormDataSourceResolveRequest[];
  readonly searchRequests: BPMFormDataSourceSearchRequest[];
  readonly source: BPMFormDataSource;
}

const createRecordingSource = (): RecordingSource => {
  const resolveRequests: BPMFormDataSourceResolveRequest[] = [];
  const searchRequests: BPMFormDataSourceSearchRequest[] = [];

  return {
    resolveRequests,
    searchRequests,
    source: {
      descriptor: DESCRIPTOR,
      resolve: (request): Promise<readonly FormFieldOption[]> => {
        resolveRequests.push(request);

        return Promise.resolve(
          request.values.map((value) => ({
            label: `${String(request.bindings.plant)} ${value}`,
            value,
          })),
        );
      },
      search: (request) => {
        searchRequests.push(request);

        return Promise.resolve({
          options: [
            { label: `${String(request.bindings.plant)} CC`, value: 'CC-1' },
          ],
        });
      },
    },
  };
};

const conditionService = new ConditionService(
  new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS),
);

/** A runtime service whose published schema is `schema`, as stored. */
const createRuntimeService = (
  source: BPMFormDataSource,
  schema: FormDefinitionSchema,
  service: ConditionService | null = conditionService,
): FormDataSourceService =>
  new FormDataSourceService(
    new StaticBPMFormDataSourceRegistry([source]),
    {
      findOne: jest.fn(() =>
        Promise.resolve({
          formDefinitionVersionId: 'form-version-1',
          id: 'template-version-1',
          status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        } as ApprovalTemplateVersionEntity),
      ),
    } as unknown as Repository<ApprovalTemplateVersionEntity>,
    {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 'form-version-1',
          schema,
          status: FormDefinitionVersionStatusEnum.PUBLISHED,
          uiSchema: { layout: [], schemaVersion: 1 },
        } as unknown as FormDefinitionVersionEntity),
      ),
    } as unknown as Repository<FormDefinitionVersionEntity>,
    {
      readFormOptionsTemplateVersion: jest.fn(() =>
        Promise.resolve({
          formDefinitionVersionId: 'form-version-1',
          id: 'template-version-1',
        }),
      ),
    } as unknown as WorkflowEngineService,
    service,
  );

const evaluator = (
  budget = createExpressionBudget(),
): ReturnType<typeof createFormDataSourceExpressionEvaluator> =>
  createFormDataSourceExpressionEvaluator({ budget, conditionService });

const errorCode = (
  code: (typeof BPM_FORM_DATA_SOURCE_ERROR_CODES)[keyof typeof BPM_FORM_DATA_SOURCE_ERROR_CODES],
): Error => expect.objectContaining({ code }) as Error;

describe('readExpressionBindingDependencies', (): void => {
  it('reads the form and row keys from the AST', (): void => {
    expect(readExpressionBindingDependencies(PLANT_EXPRESSION)).toEqual({
      formFieldKeys: ['chargeTo', 'plant'],
      rowColumnKeys: [],
    });
    expect(
      readExpressionBindingDependencies('row.plant == "DEFAULT" ? form.defaultPlant : row.plant'),
    ).toEqual({ formFieldKeys: ['defaultPlant'], rowColumnKeys: ['plant'] });
  });

  it.each([
    ['form["pla" + "nt"]'],
    ['string(form)'],
    ['instance.id'],
    ['form.__proto__'],
    ['form.plant +'],
  ])('cannot know the dependencies of %s', (expression): void => {
    expect(readExpressionBindingDependencies(expression)).toBeNull();
  });
});

describe('readBindingValues with an EXPRESSION source', (): void => {
  it('evaluates the expression into the parameter', (): void => {
    expect(
      readBindingValues(
        expressionField(PLANT_EXPRESSION),
        DESCRIPTOR,
        { chargeTo: 'OTHER', plant: 'TW01' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      ),
    ).toEqual({ missingParameters: [], values: { plant: 'TW02' } });
  });

  it('waits on an empty dependency without evaluating, and names only that one', (): void => {
    const field = expressionField(PLANT_EXPRESSION);
    const evaluateValue = jest.spyOn(conditionService, 'evaluateValue');
    const formData = { chargeTo: '', plant: 'TW01' };

    try {
      const result = readBindingValues(
        field,
        DESCRIPTOR,
        formData,
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      );

      expect(result).toEqual({ missingParameters: ['plant'], values: {} });
      expect(evaluateValue).not.toHaveBeenCalled();
      expect(
        readWaitingForFieldKeys(field, result.missingParameters, { formData }),
      ).toEqual(['chargeTo']);
    } finally {
      evaluateValue.mockRestore();
    }
  });

  it('reads row values inside a table column, and waits on an empty row', (): void => {
    const field = expressionField(
      'row.plant == "DEFAULT" ? form.defaultPlant : row.plant',
    );

    expect(
      readBindingValues(
        field,
        DESCRIPTOR,
        { defaultPlant: 'TW01' },
        createTableColumnBindingPosition({ plant: 'TW02' }),
        evaluator(),
      ).values,
    ).toEqual({ plant: 'TW02' });
    expect(
      readBindingValues(
        field,
        DESCRIPTOR,
        { defaultPlant: 'TW01' },
        createTableColumnBindingPosition({}),
        evaluator(),
      )
        .missingParameters,
    ).toEqual(['plant']);
    expect(
      readWaitingForFieldKeys(field, ['plant'], {
        formData: { defaultPlant: 'TW01' },
      }),
    ).toEqual(['plant']);
  });

  it('lets a top-level field read form only, failing closed on row (roots by position)', (): void => {
    // Without row values the field is top-level, where the lint allows `form`
    // only: a stored `row` reference was written around it and must neither
    // wait forever nor be evaluated.
    const evaluateValue = jest.spyOn(conditionService, 'evaluateValue');

    try {
      expect(() =>
        readBindingValues(
          expressionField('row.plant'),
          DESCRIPTOR,
          { plant: 'TW01' },
          TOP_LEVEL_BINDING_POSITION,
          evaluator(),
        ),
      ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
      expect(evaluateValue).not.toHaveBeenCalled();
    } finally {
      evaluateValue.mockRestore();
    }
  });

  it('takes its roots from the position it is given, not from whether a row arrived', (): void => {
    // docs/24 §2.8, made explicit (Phase 23 P4／P5 integration): the caller
    // says where the field sits. A table column with no row values yet still
    // has `row` as a root (it waits), and its `form` reads work as usual.
    const evaluateValue = jest.spyOn(conditionService, 'evaluateValue');

    try {
      expect(
        readBindingValues(
          expressionField('row.plant'),
          DESCRIPTOR,
          { plant: 'TW01' },
          createTableColumnBindingPosition(undefined),
          evaluator(),
        ),
      ).toEqual({ missingParameters: ['plant'], values: {} });
      expect(evaluateValue).not.toHaveBeenCalled();
      expect(
        readBindingValues(
          expressionField('form.plant'),
          DESCRIPTOR,
          { plant: 'TW01' },
          createTableColumnBindingPosition({}),
          evaluator(),
        ).values,
      ).toEqual({ plant: 'TW01' });
      // The same top-level expression reading `row` is refused outright.
      expect(() =>
        readBindingValues(
          expressionField('row.plant'),
          DESCRIPTOR,
          { plant: 'TW01' },
          TOP_LEVEL_BINDING_POSITION,
          evaluator(),
        ),
      ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
    } finally {
      evaluateValue.mockRestore();
    }
  });

  it('refuses a result that does not fit the parameter', (): void => {
    expect(() =>
      readBindingValues(
        expressionField('size(form.plant)'),
        DESCRIPTOR,
        { plant: 'TW01' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      ),
    ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
  });

  it('refuses a result that is not a scalar', (): void => {
    expect(() =>
      readBindingValues(
        expressionField('[form.plant]'),
        DESCRIPTOR,
        { plant: 'TW01' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      ),
    ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
  });

  it('refuses a host function even when the registry has it (built-ins only)', (): void => {
    const evaluateValue = jest.spyOn(conditionService, 'evaluateValue');

    try {
      expect(() =>
        readBindingValues(
          expressionField('erp_plant_v1(form.plant)'),
          DESCRIPTOR,
          { plant: 'north' },
          TOP_LEVEL_BINDING_POSITION,
          evaluator(),
        ),
      ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
      expect(evaluateValue).not.toHaveBeenCalled();
    } finally {
      evaluateValue.mockRestore();
    }
  });

  it('calls the built-in functions', (): void => {
    expect(
      readBindingValues(
        expressionField('upper(trim(form.plant))'),
        DESCRIPTOR,
        { plant: ' tw01 ' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      ).values,
    ).toEqual({ plant: 'TW01' });
  });

  it('refuses dynamic access and other roots at run time too', (): void => {
    ['form["pla" + "nt"]', 'instance.id', 'string(form)'].forEach(
      (expression): void => {
        expect(() =>
          readBindingValues(
            expressionField(expression),
            DESCRIPTOR,
            { plant: 'TW01' },
            TOP_LEVEL_BINDING_POSITION,
            evaluator(),
          ),
        ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
      },
    );
  });

  it('answers an exhausted budget with the existing TIMEOUT (UNAVAILABLE) code', (): void => {
    const budget = createExpressionBudget({ cumulativeMs: 1, perExpressionMs: 1 });

    budget.record(5);

    expect(() =>
      readBindingValues(
        expressionField(PLANT_EXPRESSION),
        DESCRIPTOR,
        { chargeTo: 'SELF', plant: 'TW01' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(budget),
      ),
    ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.TIMEOUT));
  });

  it('never leaks the expression or a form value in the error', (): void => {
    try {
      readBindingValues(
        expressionField('form.plant + 1'),
        DESCRIPTOR,
        { plant: 'SECRET_PLANT_42' },
        TOP_LEVEL_BINDING_POSITION,
        evaluator(),
      );
      throw new Error('expected a failure');
    } catch (error: unknown) {
      const text = JSON.stringify({
        message: (error as Error).message,
        response: (error as { getResponse?: () => unknown }).getResponse?.(),
      });

      expect(text).toContain(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING);
      expect(text).not.toContain('SECRET_PLANT_42');
      expect(text).not.toContain('form.plant');
    }
  });

  it('fails closed without a ConditionService', (): void => {
    expect(() =>
      readBindingValues(
        expressionField(PLANT_EXPRESSION),
        DESCRIPTOR,
        { chargeTo: 'SELF', plant: 'TW01' },
        TOP_LEVEL_BINDING_POSITION,
        createFormDataSourceExpressionEvaluator({ conditionService: null }),
      ),
    ).toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING));
  });
});

describe('search, resolve and submit agree (Phase 23 P5 gate)', (): void => {
  it('compute the same values and binding hash for the same input', async (): Promise<void> => {
    const recording = createRecordingSource();
    const schema = createSchema();
    const service = createRuntimeService(recording.source, schema);
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const formData = {
      chargeTo: 'OTHER',
      chargedCostCenter: 'CC-1',
      plant: 'TW01',
    };

    await service.formFieldOptions(
      {
        fieldKey: 'chargedCostCenter',
        formDataJson: JSON.stringify(formData),
        templateId: 'template-1',
      },
      authContext,
    );
    await service.resolveFormFieldOptionValues(
      {
        fieldKey: 'chargedCostCenter',
        formDataJson: JSON.stringify(formData),
        templateId: 'template-1',
        valuesJson: JSON.stringify(['CC-1']),
      },
      authContext,
    );
    const snapshots = await resolver.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema,
    });

    const searchBindings = recording.searchRequests[0].bindings;
    const resolveBindings = recording.resolveRequests[0].bindings;
    const submitBindings = recording.resolveRequests[1].bindings;

    expect(searchBindings).toEqual({ plant: 'TW02' });
    expect(resolveBindings).toEqual(searchBindings);
    expect(submitBindings).toEqual(searchBindings);
    expect(readBindingHash(DESCRIPTOR, searchBindings)).toBe(
      snapshots.chargedCostCenter.bindingHash,
    );
    expect(readBindingHash(DESCRIPTOR, resolveBindings)).toBe(
      snapshots.chargedCostCenter.bindingHash,
    );
    // Same hash as a FIELD binding feeding the same value: only the value is
    // hashed, never the expression text.
    expect(snapshots.chargedCostCenter.bindingHash).toBe(
      readBindingHash(DESCRIPTOR, { plant: 'TW02' }),
    );
  });

  it('agree inside a table row too', async (): Promise<void> => {
    const recording = createRecordingSource();
    const schema = createTableSchema(
      'row.plant == "DEFAULT" ? form.defaultPlant : row.plant',
    );
    const service = createRuntimeService(recording.source, schema);
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const row = { costCenter: 'CC-1', plant: 'DEFAULT' };
    const formData = { defaultPlant: 'TW01', items: [row] };

    await service.formFieldOptions(
      {
        fieldKey: 'items.costCenter',
        formDataJson: JSON.stringify(formData),
        rowValuesJson: JSON.stringify(row),
        templateId: 'template-1',
      },
      authContext,
    );
    const snapshots = await resolver.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      revalidateAll: true,
      schema,
    });

    expect(recording.searchRequests[0].bindings).toEqual({ plant: 'TW01' });
    expect(recording.resolveRequests[0].bindings).toEqual({ plant: 'TW01' });
    expect(snapshots['items[0].costCenter'].bindingHash).toBe(
      readBindingHash(DESCRIPTOR, { plant: 'TW01' }),
    );
  });
});

describe('the browser cannot send an expression (Phase 23 P5 gate)', (): void => {
  it('evaluates the stored schema whatever the request carries', async (): Promise<void> => {
    const recording = createRecordingSource();
    const service = createRuntimeService(recording.source, createSchema());
    const formData = { chargeTo: 'SELF', plant: 'TW01' };

    await service.formFieldOptions(
      {
        fieldKey: 'chargedCostCenter',
        formDataJson: JSON.stringify(formData),
        templateId: 'template-1',
      },
      authContext,
    );
    // Binding-shaped data in the form and row values is data, never a
    // definition: the stored expression still decides the parameter.
    await service.formFieldOptions(
      {
        fieldKey: 'chargedCostCenter',
        formDataJson: JSON.stringify({
          ...formData,
          bindings: [{ from: { expression: '"TW09"', kind: 'EXPRESSION' } }],
          dataSource: { bindings: [], key: 'demo.cost-centers', version: 1 },
          expression: '"TW09"',
        }),
        rowValuesJson: JSON.stringify({ expression: '"TW09"', plant: 'TW09' }),
        templateId: 'template-1',
      },
      authContext,
    );

    expect(recording.searchRequests.map((request) => request.bindings)).toEqual([
      { plant: 'TW01' },
      { plant: 'TW01' },
    ]);
  });

  it('never hands a top-level field the row values the browser sent', async (): Promise<void> => {
    const recording = createRecordingSource();
    // A stored schema written around the lint: a top-level field reading `row`.
    const service = createRuntimeService(
      recording.source,
      createSchema({ expression: 'row.plant', kind: 'EXPRESSION' }),
    );

    await expect(
      service.formFieldOptions(
        {
          fieldKey: 'chargedCostCenter',
          formDataJson: JSON.stringify({ chargeTo: 'SELF', plant: 'TW01' }),
          rowValuesJson: JSON.stringify({ plant: 'TW02' }),
          templateId: 'template-1',
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    });
    expect(recording.searchRequests).toEqual([]);
  });

  it('treats a table column as a column even when the browser sent no row', async (): Promise<void> => {
    const recording = createRecordingSource();
    const service = createRuntimeService(
      recording.source,
      createTableSchema('row.plant'),
    );

    // The position comes from the schema: `items.costCenter` is a column, so
    // `row` is a root and the missing cell is a dependency to fill in, not a
    // broken binding.
    await expect(
      service.formFieldOptions(
        {
          fieldKey: 'items.costCenter',
          formDataJson: JSON.stringify({ defaultPlant: 'TW01', items: [] }),
          templateId: 'template-1',
        },
        authContext,
      ),
    ).resolves.toMatchObject({ waitingForFieldKeys: ['plant'] });
    expect(recording.searchRequests).toEqual([]);
  });

  it('only lets a designer-only preview use a schema the browser sent', async (): Promise<void> => {
    const recording = createRecordingSource();
    const service = createRuntimeService(recording.source, createSchema());

    // The runtime query takes no schema at all; its input type has no field
    // for one. The schema-taking queries are the `@BPMDesignerOnly()` previews.
    await service.previewFormFieldOptions(
      {
        fieldKey: 'chargedCostCenter',
        formDataJson: JSON.stringify({ chargeTo: 'SELF', plant: 'TW01' }),
        schemaJson: JSON.stringify(
          createSchema({ expression: '"TW02"', kind: 'EXPRESSION' }),
        ),
      },
      authContext,
    );

    expect(recording.searchRequests[0].bindings).toEqual({ plant: 'TW02' });
  });
});

describe('the operation budget (Phase 23 P5 gate)', (): void => {
  it('fails a submit with TIMEOUT before anything is resolved once the budget is gone', async (): Promise<void> => {
    const recording = createRecordingSource();
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const evaluateValue = jest
      .spyOn(conditionService, 'evaluateValue')
      .mockImplementation((): never => {
        // What the runtime raises when the operation's budget runs out.
        throw new (jest.requireActual<
          typeof import('../condition/expression-errors')
        >('../condition/expression-errors').ExpressionRuntimeError)(
          'EXPRESSION_BUDGET_EXCEEDED',
          'dataSource.binding',
        );
      });

    try {
      await expect(
        resolver.resolveFormDataOptionSnapshots({
          authContext,
          formData: { chargeTo: 'SELF', chargedCostCenter: 'CC-1', plant: 'TW01' },
          revalidateAll: true,
          schema: createSchema(),
        }),
      ).rejects.toMatchObject({ code: BPM_FORM_DATA_SOURCE_ERROR_CODES.TIMEOUT });
      expect(recording.resolveRequests).toHaveLength(0);
    } finally {
      evaluateValue.mockRestore();
    }
  });

  it('shares one budget across every row of a submit', async (): Promise<void> => {
    const recording = createRecordingSource();
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const budgets = new Set<unknown>();
    const original = conditionService.evaluateValue.bind(conditionService);
    const { currentExpressionBudget } = jest.requireActual<
      typeof import('../condition/expression-budget')
    >('../condition/expression-budget');
    const evaluateValue = jest
      .spyOn(conditionService, 'evaluateValue')
      .mockImplementation((...args) => {
        budgets.add(currentExpressionBudget());

        return original(...args);
      });
    const rows = Array.from({ length: 5 }, () => ({
      costCenter: 'CC-1',
      plant: 'TW02',
    }));

    try {
      await resolver.resolveFormDataOptionSnapshots({
        authContext,
        formData: { defaultPlant: 'TW01', items: rows },
        revalidateAll: true,
        schema: createTableSchema('row.plant == "DEFAULT" ? form.defaultPlant : row.plant'),
      });

      expect(evaluateValue).toHaveBeenCalled();
      expect(budgets.size).toBe(1);
      expect([...budgets][0]).not.toBeNull();
    } finally {
      evaluateValue.mockRestore();
    }
  });
});

describe('publish lint of EXPRESSION bindings', (): void => {
  const lint = (
    from: FormDataSourceBindingSource,
    service: ConditionService | null = conditionService,
  ): readonly string[] =>
    createRuntimeService(
      createRecordingSource().source,
      createSchema(),
      service,
    ).lintDefinitionSchemaEnvironment(createSchema(from));
  const label = 'schema.fields[3].dataSource.bindings[0].from.expression';

  it('accepts a well-formed expression', (): void => {
    expect(lint({ expression: PLANT_EXPRESSION, kind: 'EXPRESSION' })).toEqual(
      [],
    );
  });

  it.each([
    ['instance.id', `${label}: EXPR_ROOT_NOT_ALLOWED instance`],
    ['row.plant', `${label}: EXPR_ROOT_NOT_ALLOWED row`],
    ['form["pla" + "nt"]', `${label}: EXPR_COMPUTED_KEY`],
    ['string(form)', `${label}: EXPR_WHOLE_FORM_REFERENCE form`],
    ['form.missing', `${label}: EXPR_FIELD_UNKNOWN missing`],
    ['erp_plant_v1(form.plant)', `${label}: EXPR_FUNCTION_NOT_ALLOWED erp_plant_v1`],
    ['form.amount', `${label}: EXPR_RESULT_TYPE_MISMATCH`],
    ['form.plant == "TW01"', `${label}: EXPR_RESULT_TYPE_MISMATCH`],
    ['[form.plant]', `${label}: EXPR_RESULT_TYPE_MISMATCH`],
    ['', `${label}: EXPR_PARSE_FAILED`],
  ])('refuses %s', (expression, line): void => {
    expect(lint({ expression, kind: 'EXPRESSION' })).toContain(line);
  });

  it('cannot publish an expression without the injected ConditionService', (): void => {
    expect(
      lint({ expression: PLANT_EXPRESSION, kind: 'EXPRESSION' }, null),
    ).toEqual([
      'schema.fields[3].dataSource.bindings expression cannot be checked: no ConditionService is available',
    ]);
  });

  it('lets a table column read sibling columns through row, and only those', (): void => {
    const service = createRuntimeService(
      createRecordingSource().source,
      createSchema(),
    );
    const columnLabel =
      'schema.fields[1].columns[1].dataSource.bindings[0].from.expression';

    expect(
      service.lintDefinitionSchemaEnvironment(
        createTableSchema('row.plant == "DEFAULT" ? form.defaultPlant : row.plant'),
      ),
    ).toEqual([]);
    expect(
      service.lintDefinitionSchemaEnvironment(createTableSchema('row.nope')),
    ).toEqual([`${columnLabel}: EXPR_FIELD_UNKNOWN nope`]);
  });

  it('maps an expression lint line to INVALID_BINDING in the designer preview', async (): Promise<void> => {
    const service = createRuntimeService(
      createRecordingSource().source,
      createSchema(),
    );

    await expect(
      service.previewFormFieldOptions(
        {
          fieldKey: 'chargedCostCenter',
          schemaJson: JSON.stringify(
            createSchema({ expression: 'instance.id', kind: 'EXPRESSION' }),
          ),
        },
        authContext,
      ),
    ).rejects.toMatchObject({
      code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    });
  });
});

describe('static dependencies in the schema lint', (): void => {
  const parse = (schema: FormDefinitionSchema): (() => unknown) => (): unknown =>
    parseAndValidateFormSchemas(JSON.stringify(schema), null);

  it('closes a cycle through an EXPRESSION edge', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          dataSource: {
            bindings: [
              {
                from: { expression: 'form.b', kind: 'EXPRESSION' },
                parameter: 'plant',
              },
            ],
            key: 'demo.cost-centers',
            version: 1,
          },
          fieldKey: 'a',
          label: 'A',
          required: false,
          type: 'select',
        },
        {
          dataSource: {
            bindings: [
              { from: { fieldKey: 'a', kind: 'FIELD' }, parameter: 'plant' },
            ],
            key: 'demo.cost-centers',
            version: 1,
          },
          fieldKey: 'b',
          label: 'B',
          required: false,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    };

    expect(parse(schema)).toThrow('schema.fields dependency cycle: a -> b -> a');
  });

  it('closes a cycle through a row EXPRESSION edge', (): void => {
    expect(parse(createTableSchema('row.costCenter'))).toThrow(
      'dependency cycle: items.costCenter -> items.costCenter',
    );
  });

  it('refuses a hidden field whose expression reads a visible one', (): void => {
    const schema = createSchema();
    const hidden: FormDefinitionSchema = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === 'chargedCostCenter'
          ? { ...field, hidden: true }
          : field,
      ),
    };

    expect(parse(hidden)).toThrow(
      'schema.fields[3].dataSource 所屬欄位為 hidden，只能綁定同為 hidden 的欄位，不可綁定顯示中的欄位：chargeTo',
    );
  });

  it('keeps a draft with an unwritten expression saveable', (): void => {
    expect(parse(createSchema({ expression: '', kind: 'EXPRESSION' }))).not.toThrow();
  });

  it('refuses a source kind it does not know', (): void => {
    expect(
      parse(
        createSchema({
          kind: 'LOOKUP',
        } as unknown as FormDataSourceBindingSource),
      ),
    ).toThrow(
      'schema.fields[3].dataSource.bindings[0].from.kind must be FIELD, CONSTANT, ROW_FIELD, or EXPRESSION',
    );
  });
});

describe('an old value after an EXPRESSION dependency changes (P5 D5, backend)', (): void => {
  // Cost centers belong to one plant: `CC-TW01` exists only under TW01.
  const createPlantSource = (): RecordingSource => {
    const resolveRequests: BPMFormDataSourceResolveRequest[] = [];
    const searchRequests: BPMFormDataSourceSearchRequest[] = [];

    return {
      resolveRequests,
      searchRequests,
      source: {
        descriptor: DESCRIPTOR,
        resolve: (request): Promise<readonly FormFieldOption[]> => {
          resolveRequests.push(request);

          return Promise.resolve(
            request.values
              .filter((value) =>
                value.startsWith(`CC-${String(request.bindings.plant)}`),
              )
              .map((value) => ({ label: value, value })),
          );
        },
        search: (request) => {
          searchRequests.push(request);

          return Promise.resolve({ options: [] });
        },
      },
    };
  };

  const SELF_TW01 = {
    chargeTo: 'SELF',
    chargedCostCenter: 'CC-TW01',
    plant: 'TW01',
  };

  const firstSubmit = async (
    resolver: FormDataSourceValueResolverService,
    schema: FormDefinitionSchema,
  ): ReturnType<FormDataSourceValueResolverService['resolveFormDataOptionSnapshots']> =>
    resolver.resolveFormDataOptionSnapshots({
      authContext,
      formData: SELF_TW01,
      schema,
    });

  it('resolves the old value again with the new binding and refuses it on resubmit', async (): Promise<void> => {
    const recording = createPlantSource();
    const schema = createSchema();
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const previousSnapshots = await firstSubmit(resolver, schema);

    expect(recording.resolveRequests[0].bindings).toEqual({ plant: 'TW01' });

    // `chargeTo` is read only by the expression; the field value is untouched.
    await expect(
      resolver.resolveFormDataOptionSnapshots({
        authContext,
        formData: { ...SELF_TW01, chargeTo: 'OTHER' },
        previousFormData: SELF_TW01,
        previousSnapshots,
        schema,
      }),
    ).rejects.toThrow(errorCode(BPM_FORM_DATA_SOURCE_ERROR_CODES.VALUE_NOT_RESOLVED));
    // Not carried forward: asked again, under the plant the expression now gives.
    expect(recording.resolveRequests).toHaveLength(2);
    expect(recording.resolveRequests[1]).toMatchObject({
      bindings: { plant: 'TW02' },
      values: ['CC-TW01'],
    });
  });

  it('keeps the snapshot when the dependency changed but the expression value did not', async (): Promise<void> => {
    const recording = createPlantSource();
    const schema = createSchema();
    const resolver = new FormDataSourceValueResolverService(
      new StaticBPMFormDataSourceRegistry([recording.source]),
      conditionService,
    );
    const previousSnapshots = await firstSubmit(resolver, schema);
    // OTHER of TW02 is TW01 again: the binding, and its hash, are unchanged.
    const formData = { ...SELF_TW01, chargeTo: 'OTHER', plant: 'TW02' };

    await expect(
      resolver.resolveFormDataOptionSnapshots({
        authContext,
        formData,
        previousFormData: SELF_TW01,
        previousSnapshots,
        schema,
      }),
    ).resolves.toEqual({
      chargedCostCenter: expect.objectContaining({
        bindingHash: previousSnapshots.chargedCostCenter.bindingHash,
      }),
    });
    expect(recording.resolveRequests).toHaveLength(1);
  });

  it('reports the old value as unresolved to the read-only resolve the browser asks', async (): Promise<void> => {
    const recording = createPlantSource();
    const service = createRuntimeService(recording.source, createSchema());
    const ask = (
      formData: Readonly<Record<string, unknown>>,
    ): ReturnType<FormDataSourceService['resolveFormFieldOptionValues']> =>
      service.resolveFormFieldOptionValues(
        {
          fieldKey: 'chargedCostCenter',
          formDataJson: JSON.stringify(formData),
          templateId: 'template-1',
          valuesJson: JSON.stringify(['CC-TW01']),
        },
        authContext,
      );

    await expect(ask(SELF_TW01)).resolves.toMatchObject({
      options: [{ label: 'CC-TW01', value: 'CC-TW01' }],
      unresolvedValues: [],
    });
    await expect(ask({ ...SELF_TW01, chargeTo: 'OTHER' })).resolves.toMatchObject({
      options: [],
      unresolvedValues: ['CC-TW01'],
      waitingForFieldKeys: [],
    });
    expect(recording.resolveRequests.map((request) => request.bindings)).toEqual([
      { plant: 'TW01' },
      { plant: 'TW02' },
    ]);
  });
});
