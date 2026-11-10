import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type {
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { FormService } from '../form/form.service';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { ApprovalTemplateVersionStatusEnum } from './template.enums';
import { TemplateService } from './template.service';

/**
 * Phase 23 P2: the publish lint and the rollback check against the real
 * engines (docs/24 §1, §2.2, §2.3). Runs in jest.real-engine.config.cts.
 */

const FORM_SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: '金額', required: true, type: 'number' },
    { fieldKey: 'title', label: '標題', required: true, type: 'text' },
    {
      fieldKey: 'secret',
      hidden: true,
      label: '代碼',
      required: false,
      type: 'text',
    },
    {
      columns: [
        { fieldKey: 'qty', label: '數量', required: true, type: 'number' },
      ],
      fieldKey: 'items',
      label: '明細',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};

const START: WorkflowNode = {
  data: { label: '開始' },
  id: 'start',
  position: { x: 0, y: 0 },
  type: 'startEvent',
};
const END: WorkflowNode = {
  data: { endState: 'APPROVED', label: '完成' },
  id: 'end',
  position: { x: 400, y: 0 },
  type: 'endEvent',
};

const edge = (
  id: string,
  source: string,
  target: string,
  data: WorkflowEdge['data'] = {},
): WorkflowEdge => ({ data, id, source, target, type: 'smoothstep' });

/** start → end with a condition on the one edge. */
const edgeConditionDefinition = (
  condition: string,
  expressionDialect?: string,
): WorkflowDefinition =>
  ({
    edges: [edge('e1', 'start', 'end', { condition })],
    ...(expressionDialect === undefined ? {} : { expressionDialect }),
    meta: { schemaVersion: 1 },
    nodes: [START, END],
  }) as unknown as WorkflowDefinition;

/** start → system node writing `fieldPath` from `value` → end. */
const setFormFieldDefinition = (
  fieldPath: string,
  value: string,
  expressionDialect: 'cel-legacy' | 'cel-v2' | null = 'cel-v2',
): WorkflowDefinition =>
  ({
    edges: [edge('e1', 'start', 'set'), edge('e2', 'set', 'end')],
    ...(expressionDialect === null ? {} : { expressionDialect }),
    meta: { schemaVersion: 1 },
    nodes: [
      START,
      {
        data: {
          action: { fieldPath, type: 'SET_FORM_FIELD', value },
          label: '寫入',
        },
        id: 'set',
        position: { x: 200, y: 0 },
        type: 'serviceTask',
      },
      END,
    ],
  }) as unknown as WorkflowDefinition;

interface ServiceOptions {
  readonly conditionService?: ConditionService;
  readonly definition: WorkflowDefinition;
  readonly initiatorPolicyCel?: string | null;
  readonly registry?: BPMExpressionFunctionRegistry;
  readonly status?: ApprovalTemplateVersionStatusEnum;
}

const createRegistry = (
  hostNames: readonly string[],
): BPMExpressionFunctionRegistry => {
  const names = [...BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES, ...hostNames];

  return {
    assertPublishable: (requested): readonly string[] => [
      ...new Set(requested.filter((name) => !names.includes(name))),
    ],
    get: (name) =>
      names.includes(name)
        ? {
            description: name,
            handler: (): string => 'A',
            label: name,
            name,
            parameters: [{ name: 'value', type: 'dyn' }],
            returnType: 'string',
          }
        : null,
    list: () => [],
  };
};

const createService = ({
  conditionService = new ConditionService(),
  definition,
  initiatorPolicyCel = null,
  registry,
  status = ApprovalTemplateVersionStatusEnum.DRAFT,
}: ServiceOptions): TemplateService => {
  const version = Object.assign(new ApprovalTemplateVersionEntity(), {
    archivedAt: null,
    formDefinitionVersionId: 'form-version-1',
    id: 'template-version-1',
    initiatorPolicyCel,
    status,
    templateId: 'template-1',
    version: 1,
    workflowDefinition: definition,
  });
  const formVersion = Object.assign(new FormDefinitionVersionEntity(), {
    id: 'form-version-1',
    schema: FORM_SCHEMA,
    status: FormDefinitionVersionStatusEnum.PUBLISHED,
  });
  const template = Object.assign(new ApprovalTemplateEntity(), {
    currentVersionId: null,
    id: 'template-1',
    isActive: true,
  });
  const passThrough = {
    merge: <T extends ObjectLiteral>(entity: T, patch: Partial<T>): T =>
      Object.assign(entity, patch),
    save: <T>(entity: T): Promise<T> => Promise.resolve(entity),
    update: (): Promise<void> => Promise.resolve(),
  };
  const manager = {
    getRepository: (target: unknown): ObjectLiteral => {
      if (target === ApprovalTemplateEntity) {
        return { ...passThrough, findOne: () => Promise.resolve(template) };
      }

      if (target === FormDefinitionVersionEntity) {
        // Rollback reads the target's form schema for the filterable-field check.
        return { ...passThrough, findOne: () => Promise.resolve(formVersion) };
      }

      return passThrough;
    },
  } as unknown as EntityManager;

  return new TemplateService(
    {
      manager: {
        transaction: <T>(
          operation: (txManager: EntityManager) => Promise<T>,
        ): Promise<T> => operation(manager),
      },
    } as unknown as Repository<ApprovalTemplateEntity>,
    {} as Repository<ApprovalTemplateCategoryEntity>,
    {
      findOne: () => Promise.resolve(version),
    } as unknown as Repository<ApprovalTemplateVersionEntity>,
    {
      findOne: () => Promise.resolve(formVersion),
    } as unknown as Repository<FormDefinitionVersionEntity>,
    conditionService,
    {} as FormService,
    {
      get: (): never => {
        throw new Error('no host module');
      },
    } as unknown as ModuleRef,
    registry,
  );
};

const readPublishError = async (service: TemplateService): Promise<string> => {
  try {
    await service.publishApprovalTemplateVersion('template-version-1');
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      return error.message;
    }

    throw error;
  }

  return '';
};

const EDGE = 'workflow.edges.e1.data.condition';

describe('TemplateService publish lint on the real engines', (): void => {
  describe('Phase 23 P2 gate (cel-v2)', (): void => {
    it.each([
      ['form["sec" + "ret"] == "x"', `${EDGE}: EXPR_COMPUTED_KEY`],
      ['string(form) != ""', `${EDGE}: EXPR_WHOLE_FORM_REFERENCE form`],
      [
        'form.__proto__.x == 1',
        `${EDGE}: EXPR_RESERVED_PATH_SEGMENT __proto__`,
      ],
    ])('refuses %s', async (condition, line): Promise<void> => {
      const message = await readPublishError(
        createService({
          definition: edgeConditionDefinition(condition, 'cel-v2'),
        }),
      );

      expect(message.split('; ')).toContain(line);
    });

    it('publishes a clean cel-v2 condition', async (): Promise<void> => {
      await expect(
        createService({
          definition: edgeConditionDefinition(
            'form.title.contains("急") && form.amount * 2 > 1000',
            'cel-v2',
          ),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    });
  });

  describe('dialect (handovers 1 and 2)', (): void => {
    it('lints a cel-v2 definition with its dialect: macro names are not roots', async (): Promise<void> => {
      await expect(
        createService({
          definition: edgeConditionDefinition(
            '[1, 2].exists(x, x > 1) && form.amount > 0',
            'cel-v2',
          ),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    });

    it('refuses a macro name read outside its macro', async (): Promise<void> => {
      const message = await readPublishError(
        createService({
          definition: edgeConditionDefinition(
            '[1].exists(principal, true) && principal.d != ""',
            'cel-v2',
          ),
        }),
      );

      expect(message).toBe(`${EDGE}: EXPR_ROOT_NOT_ALLOWED principal`);
    });

    it('refuses an unknown dialect without parsing anything', async (): Promise<void> => {
      const conditionService = new ConditionService();
      const lint = jest.spyOn(conditionService, 'lintExpression');
      const message = await readPublishError(
        createService({
          conditionService,
          definition: edgeConditionDefinition('form.amount > 1', 'cel-v3'),
        }),
      );

      expect(message).toBe(
        'workflow.expressionDialect must be cel-legacy or cel-v2',
      );
      expect(lint).not.toHaveBeenCalled();
    });

    it('keeps the cel-legacy lint as it was', async (): Promise<void> => {
      const message = await readPublishError(
        createService({
          definition: edgeConditionDefinition('account.amount > 1'),
        }),
      );

      expect(message).toBe(`${EDGE} references unsupported identifier account`);
    });
  });

  describe('fields, types and use points', (): void => {
    it('refuses an unknown field and a type mismatch', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: edgeConditionDefinition('form.missing == 1', 'cel-v2'),
          }),
        ),
      ).toBe(`${EDGE}: EXPR_FIELD_UNKNOWN missing`);
      expect(
        await readPublishError(
          createService({
            definition: edgeConditionDefinition('form.title > 1', 'cel-v2'),
          }),
        ),
      ).toBe(`${EDGE}: EXPR_FIELD_TYPE_MISMATCH title`);
    });

    it('refuses a non-boolean condition', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: edgeConditionDefinition('form.amount + 1', 'cel-v2'),
          }),
        ),
      ).toBe(`${EDGE}: EXPR_RESULT_TYPE_MISMATCH`);
    });

    it('refuses form in the initiator policy', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: edgeConditionDefinition('true', 'cel-v2'),
            initiatorPolicyCel: 'form.amount > 1',
          }),
        ),
      ).toBe('initiatorPolicyCel: EXPR_ROOT_NOT_ALLOWED form');
    });

    it('refuses a SET_FORM_FIELD path that is reserved or not declared', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition(
              '__proto__.polluted',
              'form.title',
            ),
          }),
        ),
      ).toContain(
        'workflow.nodes.set.action.fieldPath: EXPR_RESERVED_PATH_SEGMENT __proto__',
      );
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition('nowhere', 'form.title'),
          }),
        ),
      ).toBe('workflow.nodes.set.action.fieldPath: EXPR_FIELD_UNKNOWN nowhere');
    });

    // ADR 22 §5 invariant 5 names no dialect, and a path is not CEL: the
    // reserved-segment half applies to cel-legacy too. Whether a legacy path
    // must name a declared field is left open (forks of older versions).
    it('refuses a reserved SET_FORM_FIELD path in a cel-legacy definition too', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition(
              '__proto__.polluted',
              'form.title',
              'cel-legacy',
            ),
          }),
        ),
      ).toBe(
        'workflow.nodes.set.action.fieldPath: EXPR_RESERVED_PATH_SEGMENT __proto__',
      );
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition(
              'items[0].constructor',
              'form.title',
              'cel-legacy',
            ),
          }),
        ),
      ).toBe(
        'workflow.nodes.set.action.fieldPath: EXPR_RESERVED_PATH_SEGMENT constructor',
      );
      // A stored definition without the key is cel-legacy, as every template
      // created before P4 is.
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition(
              '__proto__.polluted',
              'form.title',
              null,
            ),
          }),
        ),
      ).toBe(
        'workflow.nodes.set.action.fieldPath: EXPR_RESERVED_PATH_SEGMENT __proto__',
      );
    });

    it('does not ask a cel-legacy SET_FORM_FIELD path to name a declared field', async (): Promise<void> => {
      await expect(
        createService({
          definition: setFormFieldDefinition(
            'nowhere',
            'form.title',
            'cel-legacy',
          ),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toBeDefined();
    });

    it('checks a SET_FORM_FIELD value against the field it writes', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: setFormFieldDefinition('amount', 'form.title'),
          }),
        ),
      ).toBe('workflow.nodes.set.data.action.value: EXPR_RESULT_TYPE_MISMATCH');
      // Copying a hidden field is only a warning.
      await expect(
        createService({
          definition: setFormFieldDefinition(
            'title',
            'has(form.secret) ? form.secret : ""',
          ),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    });

    it('reads table internals from the AST', async (): Promise<void> => {
      expect(
        await readPublishError(
          createService({
            definition: edgeConditionDefinition(
              'form.items.exists(row, row.qty > 1)',
              'cel-v2',
            ),
          }),
        ),
      ).toBe(`${EDGE} must not reference table field internals: items`);
      await expect(
        createService({
          definition: edgeConditionDefinition(
            'form.items != null && size(form.items) > 0',
            'cel-v2',
          ),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    });
  });

  describe('functions (handover 6)', (): void => {
    const definition = edgeConditionDefinition(
      'erp_band_v1(form.amount) == "A"',
      'cel-v2',
    );

    it('refuses a host function nobody registered', async (): Promise<void> => {
      expect(await readPublishError(createService({ definition }))).toBe(
        `${EDGE}: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1`,
      );
    });

    it('publishes once the registry has it', async (): Promise<void> => {
      await expect(
        createService({
          definition,
          registry: createRegistry(['erp_band_v1']),
        }).publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    });

    describe('argument types against the real registry (live finding)', (): void => {
      const registry = new StaticBPMExpressionFunctionRegistry([
        {
          description: 'Cost band',
          handler: (): string => 'HIGH',
          label: '採購金額級距',
          name: 'demo_costBand_v1',
          parameters: [{ name: 'amount', type: 'double' }],
          returnType: 'string',
        },
      ]);
      const wired = (condition: string): TemplateService =>
        createService({
          conditionService: new ConditionService(registry),
          definition: edgeConditionDefinition(condition, 'cel-v2'),
          registry,
        });

      it('refuses a text field handed to a double parameter', async (): Promise<void> => {
        expect(
          await readPublishError(
            wired('demo_costBand_v1(form.title) == "HIGH"'),
          ),
        ).toBe(`${EDGE}: EXPR_FIELD_TYPE_MISMATCH title`);
      });

      it('publishes the same call with a number field', async (): Promise<void> => {
        await expect(
          wired(
            'demo_costBand_v1(form.amount) == "HIGH"',
          ).publishApprovalTemplateVersion('template-version-1'),
        ).resolves.toMatchObject({
          status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });
      });
    });
  });
});

describe('TemplateService rollback (docs/24 §1)', (): void => {
  const rollBack = (service: TemplateService): Promise<unknown> =>
    service.rollbackApprovalTemplateVersion('template-version-1', 'member-1');

  it('does not lint a published version again (Phase 23 P2 gate)', async (): Promise<void> => {
    const conditionService = new ConditionService();
    const lint = jest.spyOn(conditionService, 'lintExpression');
    const lintAll = jest.spyOn(conditionService, 'lintExpressions');

    // Would be refused at publish today: a computed key.
    await expect(
      rollBack(
        createService({
          conditionService,
          definition: edgeConditionDefinition(
            'form["sec" + "ret"] == "x"',
            'cel-v2',
          ),
          status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
        }),
      ),
    ).resolves.toMatchObject({
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    expect(lint).not.toHaveBeenCalled();
    expect(lintAll).not.toHaveBeenCalled();
  });

  it('refuses a version that calls a function no longer registered', async (): Promise<void> => {
    const definition = edgeConditionDefinition(
      'erp_band_v1(form.amount) == "A"',
      'cel-v2',
    );

    await expect(
      rollBack(
        createService({
          definition,
          status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
        }),
      ),
    ).rejects.toThrow(`${EDGE}: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1`);
    await expect(
      rollBack(
        createService({
          definition,
          registry: createRegistry(['erp_band_v1']),
          status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
        }),
      ),
    ).resolves.toMatchObject({
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
  });

  it('does not look up functions for cel-legacy', async (): Promise<void> => {
    await expect(
      rollBack(
        createService({
          definition: edgeConditionDefinition('form.amount > 1'),
          status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
        }),
      ),
    ).resolves.toMatchObject({
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
  });
});

/**
 * Phase 23 P3 gate, after the integration (2026-11-07): one real registry,
 * handed to both `TemplateService` and `ConditionService` as Nest does, before
 * and after the host withdrew `erp_band_v1`.
 */
describe('Phase 23 P3 gate: a withdrawn function (real registry)', (): void => {
  const band: BPMExpressionFunction = {
    description: 'Band of an amount',
    handler: (): string => 'A',
    label: 'band',
    name: 'erp_band_v1',
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
  };
  const other: BPMExpressionFunction = {
    ...band,
    name: 'erp_other_v1',
  };
  const published = new StaticBPMExpressionFunctionRegistry([band, other]);
  const withdrawn = new StaticBPMExpressionFunctionRegistry([other]);
  const definition = edgeConditionDefinition(
    'erp_band_v1(form.amount) == "A"',
    'cel-v2',
  );
  const wired = (
    registry: BPMExpressionFunctionRegistry,
    status: ApprovalTemplateVersionStatusEnum,
  ): TemplateService =>
    createService({
      conditionService: new ConditionService(registry),
      definition,
      registry,
      status,
    });

  it('publishes a version that calls it while it is registered', async (): Promise<void> => {
    await expect(
      wired(
        published,
        ApprovalTemplateVersionStatusEnum.DRAFT,
      ).publishApprovalTemplateVersion('template-version-1'),
    ).resolves.toMatchObject({
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
  });

  it('refuses to publish a new version that calls it after the withdrawal', async (): Promise<void> => {
    expect(
      await readPublishError(
        wired(withdrawn, ApprovalTemplateVersionStatusEnum.DRAFT),
      ),
    ).toBe(`${EDGE}: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1`);
  });

  it('refuses to roll back to a version that calls it after the withdrawal', async (): Promise<void> => {
    await expect(
      wired(
        withdrawn,
        ApprovalTemplateVersionStatusEnum.ARCHIVED,
      ).rollbackApprovalTemplateVersion('template-version-1', 'member-1'),
    ).rejects.toThrow(`${EDGE}: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1`);
    await expect(
      wired(
        published,
        ApprovalTemplateVersionStatusEnum.ARCHIVED,
      ).rollbackApprovalTemplateVersion('template-version-1', 'member-1'),
    ).resolves.toMatchObject({
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
  });

  it('isolates a registry that throws during rollback', async (): Promise<void> => {
    const secret = 'ROLLBACK_SECRET_5';
    const broken: BPMExpressionFunctionRegistry = {
      assertPublishable: (): never => {
        throw new Error(secret);
      },
      get: (name) => published.get(name),
      list: () => published.list(),
    };
    const error: unknown = await wired(
      broken,
      ApprovalTemplateVersionStatusEnum.ARCHIVED,
    )
      .rollbackApprovalTemplateVersion('template-version-1', 'member-1')
      .then(
        (): null => null,
        (thrown: unknown): unknown => thrown,
      );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(
      `${EDGE}: EXPR_FUNCTION_NOT_REGISTERED erp_band_v1`,
    );
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).not.toContain(secret);
  });
});
