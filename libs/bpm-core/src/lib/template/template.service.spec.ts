import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionEntity } from '../form/form-definition.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { FormService } from '../form/form.service';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { ComposeApprovalTemplateWithFormInput } from './dto/compose-approval-template.input';
import {
  BPMTemplateChangeActionEnum,
  BPMTemplateChangedEvent,
  BPMTemplateObserver,
  BPM_TEMPLATE_OBSERVER,
} from './template-observer.token';
import {
  ApprovalTemplateActivationStatusEnum,
  ApprovalTemplateCategoryStatusEnum,
  ApprovalTemplateListStatusEnum,
  ApprovalTemplateVersionStatusEnum,
} from './template.enums';
import { TemplateService } from './template.service';
import { EMPTY_WORKFLOW_DEFINITION } from './workflow-definition.validator';
import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  ApproverResolver,
  NotifyWebhookTarget,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { resolveBPMWorkflowWebhookOptions } from '../workflow-webhook/workflow-webhook-options';
import { WorkflowWebhookService } from '../workflow-webhook/workflow-webhook.service';
import {
  BPMWorkflowWebhookParameter,
  StaticBPMWorkflowWebhookRegistry,
} from '../workflow-webhook/workflow-webhook.types';

describe('TemplateService', () => {
  it('applies backend pagination when listing approval templates and counts active records', async (): Promise<void> => {
    const templates = Array.from({ length: 13 }, (_, index) =>
      createApprovalTemplate(`template-${index + 1}`),
    );
    const find = jest.fn(
      ({
        skip = 0,
        take = 10,
      }: {
        readonly skip?: number;
        readonly take?: number;
      }): Promise<readonly ApprovalTemplateEntity[]> =>
        Promise.resolve(templates.slice(skip, skip + take)),
    );
    const count = jest.fn(
      (): Promise<number> => Promise.resolve(templates.length),
    );
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    const pageTwo = await service.listApprovalTemplates({
      page: 2,
      pageSize: 5,
    });
    const totalCount = await service.countApprovalTemplates();

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC', updatedAt: 'DESC' },
        skip: 5,
        take: 5,
        where: expect.objectContaining({
          deletedAt: expect.any(Object),
        }),
      }),
    );
    expect(pageTwo.map((template) => template.id)).toEqual([
      'template-6',
      'template-7',
      'template-8',
      'template-9',
      'template-10',
    ]);
    expect(totalCount).toBe(13);
  });

  it('filters approval templates by derived publication status', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplates({
      status: ApprovalTemplateListStatusEnum.PUBLISHED,
    });
    await service.countApprovalTemplates({
      status: ApprovalTemplateListStatusEnum.DRAFT,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currentVersionId: expect.any(Object),
          deletedAt: expect.any(Object),
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currentVersionId: expect.any(Object),
          deletedAt: expect.any(Object),
        }),
      }),
    );
  });

  it('pushes search text into server-side template filters', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplates({
      searchText: '費用',
      status: ApprovalTemplateListStatusEnum.PUBLISHED,
    });
    await service.countApprovalTemplates({
      searchText: '費用',
      status: ApprovalTemplateListStatusEnum.PUBLISHED,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            currentVersionId: expect.any(Object),
            deletedAt: expect.any(Object),
            name: expect.any(Object),
          }),
          expect.objectContaining({
            category: expect.any(Object),
            currentVersionId: expect.any(Object),
            deletedAt: expect.any(Object),
          }),
          expect.objectContaining({
            currentVersionId: expect.any(Object),
            deletedAt: expect.any(Object),
            description: expect.any(Object),
          }),
        ]),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.any(Array),
      }),
    );
  });

  it('filters approval templates by category id', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplates({
      categoryId: 'category-1',
    });
    await service.countApprovalTemplates({
      categoryId: 'category-1',
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: 'category-1',
          deletedAt: expect.any(Object),
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: 'category-1',
          deletedAt: expect.any(Object),
        }),
      }),
    );
  });

  it('keeps deactivated approval templates listed unless activation is filtered', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplates({});
    await service.countApprovalTemplates({
      activationStatus: ApprovalTemplateActivationStatusEnum.ALL,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          isActive: expect.anything(),
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          isActive: expect.anything(),
        }),
      }),
    );
  });

  it('filters approval templates by activation status', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplates({
      activationStatus: ApprovalTemplateActivationStatusEnum.ACTIVE,
    });
    await service.countApprovalTemplates({
      activationStatus: ApprovalTemplateActivationStatusEnum.INACTIVE,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: expect.any(Object),
          isActive: true,
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: expect.any(Object),
          isActive: false,
        }),
      }),
    );
  });

  it('activates and deactivates approval templates without touching versions', async (): Promise<void> => {
    const template = createApprovalTemplate('template-1');
    const templateSave = jest.fn(
      (value: ApprovalTemplateEntity): Promise<ApprovalTemplateEntity> =>
        Promise.resolve(value),
    );
    const service = new TemplateService(
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateEntity | null> =>
            Promise.resolve(template),
        ),
        merge: jest.fn(
          (
            entity: ApprovalTemplateEntity,
            value: Partial<ApprovalTemplateEntity>,
          ): ApprovalTemplateEntity => Object.assign(entity, value),
        ),
        save: templateSave,
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    const deactivated = await service.deactivateApprovalTemplate('template-1');

    expect(deactivated.isActive).toBe(false);
    expect(deactivated.currentVersionId).toBe(template.currentVersionId);

    const activated = await service.activateApprovalTemplate('template-1');

    expect(activated.isActive).toBe(true);
    expect(templateSave).toHaveBeenCalledTimes(2);
  });

  it('rejects activation toggles for unknown approval templates', async (): Promise<void> => {
    const service = new TemplateService(
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateEntity | null> => Promise.resolve(null),
        ),
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await expect(
      service.deactivateApprovalTemplate('template-missing'),
    ).rejects.toThrow('Approval template template-missing was not found');
  });

  it('lists active approval template categories by default', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly ApprovalTemplateCategoryEntity[]> =>
        Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new TemplateService(
      createRepository<ApprovalTemplateEntity>(),
      {
        count,
        find,
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.listApprovalTemplateCategories({
      page: 1,
      pageSize: 20,
      searchText: '財務',
    });
    await service.countApprovalTemplateCategories({
      status: ApprovalTemplateCategoryStatusEnum.ALL,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'ASC', name: 'ASC', sortOrder: 'ASC' },
        take: 20,
        where: expect.arrayContaining([
          expect.objectContaining({
            isActive: true,
            name: expect.any(Object),
          }),
          expect.objectContaining({
            description: expect.any(Object),
            isActive: true,
          }),
        ]),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
  });

  it('validates category existence when creating approval templates', async (): Promise<void> => {
    const category = createApprovalTemplateCategory('category-1');
    const categoryFindOne = jest.fn(
      (): Promise<ApprovalTemplateCategoryEntity | null> =>
        Promise.resolve(category),
    );
    const templateCreate = jest.fn(
      (value: Partial<ApprovalTemplateEntity>): ApprovalTemplateEntity =>
        Object.assign(new ApprovalTemplateEntity(), value),
    );
    const templateSave = jest.fn(
      (value: ApprovalTemplateEntity): Promise<ApprovalTemplateEntity> =>
        Promise.resolve({ ...value, id: 'template-1' }),
    );
    const versionSave = jest.fn(
      (
        value: ApprovalTemplateVersionEntity,
      ): Promise<ApprovalTemplateVersionEntity> => Promise.resolve(value),
    );
    const versionCreate = jest.fn(
      (
        value: Partial<ApprovalTemplateVersionEntity>,
      ): ApprovalTemplateVersionEntity =>
        Object.assign(new ApprovalTemplateVersionEntity(), value),
    );
    // `createApprovalTemplate` re-reads the row it just wrote, because
    // `categoryId` is a read-only projection of the column `categoryDetail`
    // owns and so is absent from the in-memory entity after `save()`.
    const templateFindOne = jest.fn(
      (): Promise<ApprovalTemplateEntity> =>
        Promise.resolve(
          Object.assign(new ApprovalTemplateEntity(), {
            category: '財務',
            categoryDetail: category,
            categoryId: category.id,
            id: 'template-1',
          }),
        ),
    );
    const manager = {
      getRepository: jest.fn((entity: unknown): unknown => {
        if (entity === ApprovalTemplateEntity) {
          return {
            create: templateCreate,
            findOne: templateFindOne,
            save: templateSave,
          };
        }

        if (entity === ApprovalTemplateCategoryEntity) {
          return {
            findOne: categoryFindOne,
          };
        }

        if (entity === FormDefinitionVersionEntity) {
          return {
            findOne: jest.fn(
              (): Promise<FormDefinitionVersionEntity | null> =>
                Promise.resolve(null),
            ),
          };
        }

        return {
          create: versionCreate,
          save: versionSave,
        };
      }),
      transaction: jest.fn(
        <TResult>(
          operation: (manager: {
            readonly getRepository: (entity: unknown) => unknown;
          }) => Promise<TResult>,
        ): Promise<TResult> => operation(manager),
      ),
    };
    const service = new TemplateService(
      { manager } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await service.createApprovalTemplate({
      category: null,
      categoryId: 'category-1',
      createdByMemberId: null,
      description: null,
      formDefinitionVersionId: null,
      name: '費用簽核',
    });

    expect(categoryFindOne).toHaveBeenCalledWith({
      where: { id: 'category-1' },
    });
    // The category is assigned through the relation, not the scalar: both map
    // to `category_id` and TypeORM lets the relation win on persist, so a
    // scalar-only write is silently dropped.
    expect(templateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: '財務',
        categoryDetail: category,
      }),
    );
    expect(templateCreate.mock.calls[0]?.[0]).not.toHaveProperty('categoryId');
  });

  it('moves a template to another category through the relation', async (): Promise<void> => {
    // Regression: assigning only the `categoryId` scalar updated the legacy
    // `category` string but left `category_id` on the old category, because
    // the loaded `categoryDetail` relation overwrote it on save. The template
    // then reported two different categories depending on which field a
    // consumer read.
    const nextCategory = createApprovalTemplateCategory('category-2');
    const existing = Object.assign(new ApprovalTemplateEntity(), {
      category: '財務',
      categoryDetail: createApprovalTemplateCategory('category-1'),
      categoryId: 'category-1',
      id: 'template-1',
    });
    const saved: ApprovalTemplateEntity[] = [];
    const templateFindOne = jest.fn(
      (): Promise<ApprovalTemplateEntity> =>
        Promise.resolve(
          saved.length > 0
            ? Object.assign(new ApprovalTemplateEntity(), {
                ...saved[0],
                categoryId: saved[0]?.categoryDetail?.id ?? null,
              })
            : existing,
        ),
    );
    const templateRepository = {
      findOne: templateFindOne,
      merge: jest.fn(
        (
          target: ApprovalTemplateEntity,
          patch: Partial<ApprovalTemplateEntity>,
        ): ApprovalTemplateEntity => Object.assign(target, patch),
      ),
      save: jest.fn(
        (value: ApprovalTemplateEntity): Promise<ApprovalTemplateEntity> => {
          saved.push(value);

          return Promise.resolve(value);
        },
      ),
    } as unknown as Repository<ApprovalTemplateEntity>;
    const service = new TemplateService(
      templateRepository,
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateCategoryEntity> =>
            Promise.resolve(nextCategory),
        ),
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    const updated = await service.updateApprovalTemplate({
      category: null,
      categoryId: 'category-2',
      description: null,
      id: 'template-1',
      name: null,
    });

    expect(saved[0]?.categoryDetail).toBe(nextCategory);
    expect(updated.categoryId).toBe('category-2');
  });

  it('rejects publishing a draft with workflow lint errors before mutating template state', async (): Promise<void> => {
    const draftVersion = Object.assign(new ApprovalTemplateVersionEntity(), {
      archivedAt: null,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      formDefinitionVersionId: 'form-version-1',
      id: 'template-version-1',
      initiatorPolicyCel: null,
      notificationConfig: null,
      publishedAt: null,
      publishedByMemberId: null,
      slaDefaults: null,
      status: ApprovalTemplateVersionStatusEnum.DRAFT,
      templateId: 'template-1',
      updatedAt: new Date('2026-05-10T00:00:00.000Z'),
      version: 1,
      workflowDefinition: EMPTY_WORKFLOW_DEFINITION,
    });
    const formVersion = Object.assign(new FormDefinitionVersionEntity(), {
      archivedAt: null,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      formDefinitionId: 'form-1',
      id: 'form-version-1',
      publishedAt: new Date('2026-05-10T00:00:00.000Z'),
      publishedByMemberId: 'member-admin',
      schema: { fields: [], schemaVersion: 1 },
      status: FormDefinitionVersionStatusEnum.PUBLISHED,
      uiSchema: { fieldOrder: [] },
      updatedAt: new Date('2026-05-10T00:00:00.000Z'),
      version: 1,
    });
    const transaction = jest.fn(
      <TResult>(
        operation: (
          manager: Readonly<Record<string, unknown>>,
        ) => Promise<TResult>,
      ): Promise<TResult> => operation({}),
    );
    const service = new TemplateService(
      {
        manager: { transaction },
      } as unknown as Repository<ApprovalTemplateEntity>,
      createRepository<ApprovalTemplateCategoryEntity>(),
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateVersionEntity | null> =>
            Promise.resolve(draftVersion),
        ),
      } as unknown as Repository<ApprovalTemplateVersionEntity>,
      {
        findOne: jest.fn(
          (): Promise<FormDefinitionVersionEntity | null> =>
            Promise.resolve(formVersion),
        ),
      } as unknown as Repository<FormDefinitionVersionEntity>,
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.nodes.start does not have a path to an endEvent',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects publishing an edge CEL expression that reaches into a table', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      condition: 'form.items[0].qty > 3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.edges.edge_start_end.data.condition must not reference table field internals: items',
    );
  });

  it('rejects publishing a structured edge condition that names a table column', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      conditionFieldKey: 'items.qty',
      conditionOperator: 'GREATER_THAN',
      conditionValue: '3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.edges.edge_start_end.data.conditionFieldKey must not reference table field internals: items.qty',
    );
  });

  describe('DYNAMIC_FORM member references', (): void => {
    const memberSchema: FormDefinitionSchema = {
      fields: [
        { fieldKey: 'reviewer', label: '審核人', required: true, type: 'member' },
        { fieldKey: 'backup', label: '代理人', required: false, type: 'member' },
        {
          fieldKey: 'auditor',
          label: '稽核',
          required: true,
          type: 'member',
          visibleWhen: 'form.note == "audit"',
        },
        {
          fieldKey: 'syncedOwner',
          hidden: true,
          label: '外部負責人',
          required: false,
          type: 'member',
        },
        { fieldKey: 'note', label: '備註', required: false, type: 'text' },
      ],
      schemaVersion: 1,
    };

    it('rejects a user task whose formPath names no field of the bound form', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: memberSchema,
        workflowDefinition: createDynamicFormWorkflow({
          formPath: 'missing',
          type: 'DYNAMIC_FORM',
        }),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(
        'workflow.nodes.task_manager.approverResolver.formPath must reference a member (人員選擇) field of the bound form: missing',
      );
    });

    it('rejects a user task whose formPath names a non-member field', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: memberSchema,
        workflowDefinition: createDynamicFormWorkflow({
          formPath: 'note',
          type: 'DYNAMIC_FORM',
        }),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(
        'workflow.nodes.task_manager.approverResolver.formPath must reference a member (人員選擇) field of the bound form: note',
      );
    });

    it('rejects NOTIFY recipients whose formPath is not a member field', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: memberSchema,
        workflowDefinition: createDynamicFormWorkflow(
          { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
          { formPath: 'note', type: 'DYNAMIC_FORM' },
        ),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(
        'workflow.nodes.notify_peer.action.recipients.formPath must reference a member (人員選擇) field of the bound form: note',
      );
    });

    it.each([
      ['an optional', 'backup'],
      ['a conditionally hidden', 'auditor'],
      ['a store-only hidden', 'syncedOwner'],
    ])(
      'rejects a user task and NOTIFY recipients that read %s member field',
      async (_kind, formPath): Promise<void> => {
        const service = createTableConditionPublishService({
          schema: memberSchema,
          workflowDefinition: createDynamicFormWorkflow(
            { formPath, type: 'DYNAMIC_FORM' },
            { formPath, type: 'DYNAMIC_FORM' },
          ),
        });
        const publish = service.publishApprovalTemplateVersion(
          'template-version-1',
        );

        await expect(publish).rejects.toThrow(
          `workflow.nodes.task_manager.approverResolver.formPath must reference a required member field that no visibility rule or hidden flag can leave empty: ${formPath}`,
        );
        await expect(publish).rejects.toThrow(
          `workflow.nodes.notify_peer.action.recipients.formPath must reference a required member field that no visibility rule or hidden flag can leave empty: ${formPath}`,
        );
      },
    );

    it('publishes when formPath names a required, always-visible member field', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: memberSchema,
        workflowDefinition: createDynamicFormWorkflow(
          { formPath: 'reviewer', type: 'DYNAMIC_FORM' },
          { formPath: 'reviewer', type: 'DYNAMIC_FORM' },
        ),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });
  });

  describe('approver-filled fields against the bound form', (): void => {
    const dataSource = { bindings: [], key: 'invoice_kinds', version: 1 };
    const fillSchema: FormDefinitionSchema = {
      fields: [
        {
          fieldKey: 'invoiceKind',
          label: '發票種類',
          options: [{ label: '二聯', value: 'B2C' }],
          required: false,
          type: 'select',
        },
        { fieldKey: 'amount', label: '金額', required: false, type: 'number' },
        { fieldKey: 'note', label: '備註', required: false, type: 'text' },
        { fieldKey: 'taxFree', label: '免稅', required: false, type: 'boolean' },
        {
          dataSource,
          fieldKey: 'taxCode',
          label: '稅碼',
          required: false,
          type: 'select',
        },
        {
          fieldKey: 'attachment',
          label: '附件',
          required: false,
          type: 'file_upload',
        },
        {
          columns: [
            { fieldKey: 'name', label: '品項', required: false, type: 'text' },
          ],
          fieldKey: 'lines',
          label: '明細',
          required: false,
          type: 'table',
        },
        {
          columns: [
            { fieldKey: 'name', label: '品項', required: false, type: 'text' },
            {
              dataSource,
              fieldKey: 'kind',
              label: '種類',
              required: false,
              type: 'select',
            },
          ],
          fieldKey: 'sourcedLines',
          label: '來源明細',
          required: false,
          type: 'table',
        },
      ],
      schemaVersion: 1,
    };

    const withFieldRule = (
      fieldKey: string,
      rule: Readonly<Record<string, unknown>>,
    ): FormDefinitionSchema => ({
      ...fillSchema,
      fields: fillSchema.fields.map((field) =>
        field.fieldKey === fieldKey ? ({ ...field, ...rule } as typeof field) : field,
      ),
    });

    const editable = (
      fieldPath: string,
      extra: Readonly<Record<string, unknown>> = {},
    ): Readonly<Record<string, unknown>> => ({
      editable: true,
      fieldPath,
      visible: true,
      ...extra,
    });

    const publishError = async (
      service: TemplateService,
    ): Promise<string> => {
      try {
        await service.publishApprovalTemplateVersion('template-version-1');
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }

      return '';
    };

    const rulePublishLine = (fieldKey: string, rule: string): string =>
      `formData.${fieldKey} is filled in by an approver, so the form cannot set ${rule} on it`;

    it('publishes when every approver-filled field is a plain field with no form rules', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [
            editable('invoiceKind'),
            editable('amount', { required: true }),
            editable('lines'),
            { editable: false, fieldPath: 'note', visible: true },
          ],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });

    it.each([
      ['required', { required: true }],
      ['requiredWhen', { requiredWhen: 'form.amount > 10' }],
      ['visibleWhen', { visibleWhen: 'form.amount > 10' }],
      ['readonlyWhen', { readonlyWhen: 'form.amount > 10' }],
      ['hidden', { hidden: true }],
      ['defaultValue', { defaultValue: 'B2C' }],
    ])(
      'rejects an approver-filled field that the form gives %s',
      async (rule, formRule): Promise<void> => {
        const service = createTableConditionPublishService({
          schema: withFieldRule('invoiceKind', formRule),
          workflowDefinition: createFieldPermissionWorkflow([
            [editable('invoiceKind')],
          ]),
        });

        await expect(publishError(service)).resolves.toBe(
          rulePublishLine('invoiceKind', rule),
        );
      },
    );

    it('rejects a hidden approver-filled field, which the approver could never see to fill in', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: withFieldRule('invoiceKind', { hidden: true }),
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('invoiceKind', { required: true })],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(rulePublishLine('invoiceKind', 'hidden'));
    });

    it('rejects an approver-filled field that the form can hide with visibleWhen', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: withFieldRule('invoiceKind', {
          visibleWhen: 'form.amount > 1000',
        }),
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('invoiceKind', { required: true })],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(rulePublishLine('invoiceKind', 'visibleWhen'));
    });

    it.each([
      ['required: false', { required: false }],
      ['hidden: false', { hidden: false }],
    ])(
      'does not count %s as a rule the form sets',
      async (_name, formRule): Promise<void> => {
        const service = createTableConditionPublishService({
          schema: withFieldRule('invoiceKind', formRule),
          workflowDefinition: createFieldPermissionWorkflow([
            [editable('invoiceKind')],
          ]),
        });

        await expect(
          service.publishApprovalTemplateVersion('template-version-1'),
        ).resolves.toMatchObject({ id: 'template-version-1' });
      },
    );

    it('leaves form rules alone on a field no approver fills in', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: withFieldRule('invoiceKind', { hidden: true, required: false }),
        workflowDefinition: createFieldPermissionWorkflow([
          [{ editable: false, fieldPath: 'invoiceKind', visible: true }],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });

    it('reports one line per field and rule even when two nodes make it editable', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: withFieldRule('invoiceKind', {
          hidden: true,
          visibleWhen: 'form.amount > 10',
        }),
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('invoiceKind')],
          [editable('invoiceKind')],
        ]),
      });
      const message = await publishError(service);

      expect(message.split('; ').sort()).toEqual([
        rulePublishLine('invoiceKind', 'hidden'),
        rulePublishLine('invoiceKind', 'visibleWhen'),
      ]);
    });

    it('rejects an approver-filled data-source field', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('taxCode')],
        ]),
      });

      await expect(publishError(service)).resolves.toBe(
        'formData.taxCode is filled in by an approver, so it cannot be a data-source field',
      );
    });

    it('rejects an approver-filled file upload field', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('attachment')],
        ]),
      });

      await expect(publishError(service)).resolves.toBe(
        'formData.attachment is filled in by an approver, so it cannot be a file upload field',
      );
    });

    it('rejects an approver-filled table that has a data-source column', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('sourcedLines')],
        ]),
      });

      await expect(publishError(service)).resolves.toBe(
        'formData.sourcedLines is filled in by an approver, so its table cannot have a data-source column',
      );
    });

    it('leaves data-source fields and columns alone while no approver fills them in', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('invoiceKind')],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });

    it('rejects a field permission that names no field of the bound form', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [
            editable('missing'),
            { editable: false, fieldPath: 'alsoMissing', visible: true },
          ],
        ]),
      });
      const lines = (await publishError(service)).split('; ');

      expect(lines.sort()).toEqual([
        'workflow.nodes.task_1.fieldPermissions must name a field of the bound form: alsoMissing',
        'workflow.nodes.task_1.fieldPermissions must name a field of the bound form: missing',
      ]);
    });

    it('does not call a nested path an unknown field, since it is already refused as nested', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('lines.name')],
        ]),
      });

      await expect(publishError(service)).resolves.toBe(
        'workflow.nodes.task_1.fieldPermissions must name a top-level form field, not a nested path: lines.name',
      );
    });

    it('rejects requiring a boolean field the approver fills in', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('taxFree', { required: true })],
        ]),
      });

      await expect(publishError(service)).resolves.toBe(
        'workflow.nodes.task_1.fieldPermissions cannot require the boolean field: taxFree',
      );
    });

    it('allows an optional boolean field the approver fills in', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        schema: fillSchema,
        workflowDefinition: createFieldPermissionWorkflow([
          [editable('taxFree')],
        ]),
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });
  });

  it('rejects publishing a webhook whose endpoint is not registered', async (): Promise<void> => {
    const service = createWebhookPublishService(
      new WorkflowWebhookService(
        new StaticBPMWorkflowWebhookRegistry([]),
        resolveBPMWorkflowWebhookOptions(),
      ),
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_ENDPOINT_MISSING');
  });

  it('rejects publishing a binding the endpoint never declared', async (): Promise<void> => {
    const service = createWebhookPublishService(
      createWebhookService([
        { key: 'other', label: 'Other', required: false, type: 'string' },
      ]),
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN');
  });

  it('rejects publishing a webhook with no endpoint source at all', async (): Promise<void> => {
    const service = createWebhookPublishService();

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_REGISTRY_MISSING');
  });

  it('rejects publishing a webhook binding that does not fit the parameter', async (): Promise<void> => {
    const service = createWebhookPublishService(
      createWebhookService([
        { key: 'amount', label: 'Amount', required: true, type: 'stringArray' },
      ]),
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE');
  });

  it('reports malformed webhook JSON as a publish error instead of crashing', async (): Promise<void> => {
    const service = createWebhookPublishService(
      createWebhookService([
        { key: 'amount', label: 'Amount', required: true, type: 'number' },
      ]),
      [{ bindings: 'x', endpoint: { key: 'erp.purchase-approved', version: 1 }, id: 'w' }],
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.nodes.notify_erp.action.webhooks[0].bindings must be an array',
    );
  });

  it('publishes a webhook whose endpoint and bindings check out', async (): Promise<void> => {
    const service = createWebhookPublishService(
      createWebhookService([
        { key: 'amount', label: 'Amount', required: true, type: 'number' },
      ]),
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).resolves.toMatchObject({ status: ApprovalTemplateVersionStatusEnum.PUBLISHED });
  });

  it('rejects publishing a structured edge condition that indexes a table row', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      conditionFieldKey: 'items[0].qty',
      conditionOperator: 'GREATER_THAN',
      conditionValue: '3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('must not reference table field internals: items[0].qty');
  });

  // cel-js parses and evaluates `form ["items"][0].qty` happily, and the
  // root-identifier lint sees nothing wrong with it (the key hides in a string
  // literal, `qty` follows a dot). A gap between `form` and the accessor used
  // to walk straight through this lint.
  it('rejects publishing a spaced bracket path into a table', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      condition: 'form ["items"][0].qty > 3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('must not reference table field internals: items');
  });

  it('rejects publishing a spaced dot path into a table', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      condition: 'form . items . qty > 3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow('must not reference table field internals: items');
  });

  it('publishes a field whose key merely starts with a table key', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      condition: 'form.itemsExtra.qty > 3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).resolves.toMatchObject({ id: 'template-version-1' });
  });

  it('rejects publishing an initiator policy that reaches into a table', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      initiatorPolicyCel: 'form.items[0].qty > 3',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'initiatorPolicyCel must not reference table field internals: items',
    );
  });

  it('publishes a condition that only asks a table for its row count', async (): Promise<void> => {
    // The row-count form is exactly what IS_FILLED / IS_EMPTY compile to, so
    // banning table internals must not ban the table itself.
    const service = createTableConditionPublishService({
      condition: 'form.items != null && size(form.items) > 0',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).resolves.toMatchObject({ id: 'template-version-1' });
  });

  it('publishes an edge condition that reads the last decision', async (): Promise<void> => {
    // The engine and its dry run both hand edge conditions `lastDecision`,
    // so publishing must not reject the identifier there.
    const service = createTableConditionPublishService({
      condition: 'lastDecision != null && lastDecision.action == "APPROVED"',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).resolves.toMatchObject({ id: 'template-version-1' });
  });

  it('rejects lastDecision outside an edge condition', async (): Promise<void> => {
    const service = createTableConditionPublishService({
      initiatorPolicyCel: 'lastDecision != null',
    });

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'initiatorPolicyCel references unsupported identifier lastDecision',
    );
  });

  describe('roots each expression is evaluated with', (): void => {
    it('publishes an initiator policy that reads subject', async (): Promise<void> => {
      const service = createTableConditionPublishService({
        initiatorPolicyCel: '"unit-1" in subject.orgUnitIds',
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).resolves.toMatchObject({ id: 'template-version-1' });
    });

    it('rejects an initiator policy that reads the form', async (): Promise<void> => {
      // Initiator policies run before the instance exists, with no form data.
      const service = createTableConditionPublishService({
        initiatorPolicyCel: 'form.amount > 0',
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow(
        'initiatorPolicyCel references unsupported identifier form',
      );
    });

    it('rejects subject in a workflow expression', async (): Promise<void> => {
      // `subject` only exists for initiator policies; on a node or an edge it
      // used to pass publish and then fail every instance that reached it.
      const service = createTableConditionPublishService({
        condition: 'subject.orgUnitIds.size() > 0',
      });

      await expect(
        service.publishApprovalTemplateVersion('template-version-1'),
      ).rejects.toThrow('references unsupported identifier subject');
    });
  });

  it('refuses to delete a category that templates still reference', async (): Promise<void> => {
    // This used to succeed and quietly deactivate the category instead, so the
    // caller was told the delete happened while `isActive` was flipped behind
    // its back. Deactivation stays reachable through
    // `deactivateApprovalTemplateCategory`.
    const category = createApprovalTemplateCategory('category-1');
    const categorySave = jest.fn(
      (
        value: ApprovalTemplateCategoryEntity,
      ): Promise<ApprovalTemplateCategoryEntity> => Promise.resolve(value),
    );
    const categoryRemove = jest.fn(
      (
        value: ApprovalTemplateCategoryEntity,
      ): Promise<ApprovalTemplateCategoryEntity> => Promise.resolve(value),
    );
    const service = new TemplateService(
      {
        count: jest.fn((): Promise<number> => Promise.resolve(2)),
      } as unknown as Repository<ApprovalTemplateEntity>,
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateCategoryEntity | null> =>
            Promise.resolve(category),
        ),
        merge: jest.fn(
          (
            entity: ApprovalTemplateCategoryEntity,
            value: Partial<ApprovalTemplateCategoryEntity>,
          ): ApprovalTemplateCategoryEntity => Object.assign(entity, value),
        ),
        remove: categoryRemove,
        save: categorySave,
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    await expect(
      service.deleteApprovalTemplateCategory('category-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Neither operation ran: no delete, and no deactivation substituted for it.
    expect(categoryRemove).not.toHaveBeenCalled();
    expect(categorySave).not.toHaveBeenCalled();
    expect(category.isActive).toBe(true);
  });

  it('deletes a category that no template references', async (): Promise<void> => {
    const category = createApprovalTemplateCategory('category-1');
    // TypeORM's `remove()` clears the primary key on the entity it removes.
    const categoryRemove = jest.fn(
      (
        value: ApprovalTemplateCategoryEntity,
      ): Promise<ApprovalTemplateCategoryEntity> =>
        Promise.resolve(
          Object.assign(value, { id: undefined as unknown as string }),
        ),
    );
    const service = new TemplateService(
      {
        count: jest.fn((): Promise<number> => Promise.resolve(0)),
      } as unknown as Repository<ApprovalTemplateEntity>,
      {
        findOne: jest.fn(
          (): Promise<ApprovalTemplateCategoryEntity | null> =>
            Promise.resolve(category),
        ),
        remove: categoryRemove,
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
      {} as unknown as FormService,
      createTemplateModuleRef(),
    );

    const deleted = await service.deleteApprovalTemplateCategory('category-1');

    expect(categoryRemove).toHaveBeenCalledWith(category);
    expect(deleted).toBe(category);
    // `id` is non-null in the GraphQL schema; losing it fails the mutation.
    expect(deleted.id).toBe('category-1');
  });
});

describe('TemplateService.composeApprovalTemplateWithForm', () => {
  it('publishes form and template atomically when publish is true', async (): Promise<void> => {
    const { manager, store } = createInMemoryManager();
    const service = createComposingService(manager);

    const result = await service.composeApprovalTemplateWithForm(
      {
        category: null,
        categoryId: null,
        formDefinitionId: null,
        formDescription: null,
        formName: '請款表單',
        initiatorPolicyCel: null,
        notificationConfigJson: null,
        publish: true,
        schemaJson: JSON.stringify(SAMPLE_FORM_SCHEMA),
        slaDefaultsJson: null,
        templateDescription: null,
        templateId: null,
        templateName: '請款簽核',
        uiSchemaJson: JSON.stringify(SAMPLE_FORM_UI_SCHEMA),
        workflowDefinitionJson: JSON.stringify(VALID_WORKFLOW_DEFINITION),
      },
      'member-admin',
    );

    expect(result.published).toBe(true);
    expect(result.formDefinitionVersion.status).toBe(
      FormDefinitionVersionStatusEnum.PUBLISHED,
    );
    expect(result.templateVersion.status).toBe(
      ApprovalTemplateVersionStatusEnum.PUBLISHED,
    );
    // The template version binds the freshly published form version.
    expect(result.templateVersion.formDefinitionVersionId).toBe(
      result.formDefinitionVersion.id,
    );
    // Both parents now point at the published versions.
    expect(result.formDefinition.currentVersionId).toBe(
      result.formDefinitionVersion.id,
    );
    expect(result.template.currentVersionId).toBe(result.templateVersion.id);

    const formVersions = [
      ...store(FormDefinitionVersionEntity).values(),
    ] as FormDefinitionVersionEntity[];
    expect(formVersions).toHaveLength(1);
  });

  it('keeps both sides as drafts when publish is false', async (): Promise<void> => {
    const { manager } = createInMemoryManager();
    const service = createComposingService(manager);

    const result = await service.composeApprovalTemplateWithForm(
      {
        category: null,
        categoryId: null,
        formDefinitionId: null,
        formDescription: null,
        formName: '請款表單',
        initiatorPolicyCel: null,
        notificationConfigJson: null,
        publish: false,
        schemaJson: JSON.stringify(SAMPLE_FORM_SCHEMA),
        slaDefaultsJson: null,
        templateDescription: null,
        templateId: null,
        templateName: '請款簽核',
        uiSchemaJson: JSON.stringify(SAMPLE_FORM_UI_SCHEMA),
        workflowDefinitionJson: JSON.stringify(VALID_WORKFLOW_DEFINITION),
      },
      'member-admin',
    );

    expect(result.published).toBe(false);
    expect(result.formDefinitionVersion.status).toBe(
      FormDefinitionVersionStatusEnum.DRAFT,
    );
    expect(result.templateVersion.status).toBe(
      ApprovalTemplateVersionStatusEnum.DRAFT,
    );
    // Draft template binds the draft form version so condition fields resolve.
    expect(result.templateVersion.formDefinitionVersionId).toBe(
      result.formDefinitionVersion.id,
    );
    expect(result.formDefinition.currentVersionId).toBeNull();
    expect(result.template.currentVersionId).toBeNull();
  });

  it('rolls back inside the single transaction when the workflow fails to lint', async (): Promise<void> => {
    const { manager, store } = createInMemoryManager();
    const service = createComposingService(manager);

    await expect(
      service.composeApprovalTemplateWithForm(
        {
          category: null,
          categoryId: null,
          formDefinitionId: null,
          formDescription: null,
          formName: '請款表單',
          initiatorPolicyCel: null,
          notificationConfigJson: null,
          publish: true,
          schemaJson: JSON.stringify(SAMPLE_FORM_SCHEMA),
          slaDefaultsJson: null,
          templateDescription: null,
          templateId: null,
          templateName: '請款簽核',
          uiSchemaJson: JSON.stringify(SAMPLE_FORM_UI_SCHEMA),
          // EMPTY workflow cannot reach an endEvent and must fail publish lint.
          workflowDefinitionJson: JSON.stringify(EMPTY_WORKFLOW_DEFINITION),
        },
        'member-admin',
      ),
    ).rejects.toThrow('does not have a path to an endEvent');

    // The single manager.transaction wraps every write, so a real DataSource
    // would roll back the form rows created before the failing publish step.
    expect(store(ApprovalTemplateEntity).size).toBeGreaterThanOrEqual(1);
  });

  it('refuses to publish a new version onto a deactivated template', async (): Promise<void> => {
    const { manager, store } = createInMemoryManager();
    const service = createStoreBackedService(manager);

    const drafted = await service.composeApprovalTemplateWithForm(
      composeInput(),
      'member-admin',
    );

    await service.deactivateApprovalTemplate(drafted.template.id);

    await expect(
      service.composeApprovalTemplateWithForm(
        composeInput({ publish: true, templateId: drafted.template.id }),
        'member-admin',
      ),
    ).rejects.toThrow('Approval template is deactivated');

    // The refusal is the whole point: the template must still have no
    // published version, exactly as the workflow engine assumes.
    const template = store(ApprovalTemplateEntity).get(
      drafted.template.id,
    ) as ApprovalTemplateEntity;
    expect(template.currentVersionId).toBeNull();
  });

  it('refuses to roll back onto a deactivated template', async (): Promise<void> => {
    const { manager } = createInMemoryManager();
    const service = createStoreBackedService(manager);

    const published = await service.composeApprovalTemplateWithForm(
      composeInput({ publish: true }),
      'member-admin',
    );

    await service.deactivateApprovalTemplate(published.template.id);

    await expect(
      service.rollbackApprovalTemplateVersion(
        published.templateVersion.id,
        'member-admin',
      ),
    ).rejects.toThrow('Approval template is deactivated');
  });

  it('reports one COMPOSED event to a host template observer', async (): Promise<void> => {
    const { manager } = createInMemoryManager();
    const events: BPMTemplateChangedEvent[] = [];
    const service = createStoreBackedService(manager, {
      onTemplateChanged: (event): void => {
        events.push(event);
      },
    });

    const result = await service.composeApprovalTemplateWithForm(
      composeInput({ publish: true }),
      'member-admin',
    );

    // A compose that also publishes is still one host-facing mutation, so the
    // host must not have to de-duplicate a COMPOSED against a
    // VERSION_PUBLISHED for the same change.
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        action: BPMTemplateChangeActionEnum.COMPOSED,
        actorMemberId: 'member-admin',
        previousVersionId: null,
        published: true,
      }),
    );
    expect(events[0].version.id).toBe(result.templateVersion.id);
    expect(events[0].template.id).toBe(result.template.id);
    // BPM owned the transaction, so the rows are already committed and the
    // host is free to push immediately.
    expect(events[0].manager).toBeUndefined();
  });

  it('reports a rollback to the observer with the version it replaced', async (): Promise<void> => {
    const { manager } = createInMemoryManager();
    const events: BPMTemplateChangedEvent[] = [];
    const service = createStoreBackedService(manager, {
      onTemplateChanged: (event): void => {
        events.push(event);
      },
    });

    const first = await service.composeApprovalTemplateWithForm(
      composeInput({ publish: true }),
      'member-admin',
    );
    const second = await service.composeApprovalTemplateWithForm(
      composeInput({ publish: true, templateId: first.template.id }),
      'member-admin',
    );

    const restored = await service.rollbackApprovalTemplateVersion(
      first.templateVersion.id,
      'member-auditor',
    );

    expect(restored.id).toBe(first.templateVersion.id);
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual(
      expect.objectContaining({
        action: BPMTemplateChangeActionEnum.VERSION_ROLLED_BACK,
        actorMemberId: 'member-auditor',
        previousVersionId: second.templateVersion.id,
        published: true,
      }),
    );
  });

  it('keeps the mutation succeeding when the host observer throws', async (): Promise<void> => {
    const { manager } = createInMemoryManager();
    const service = createStoreBackedService(manager, {
      onTemplateChanged: (): never => {
        throw new Error('host audit sink is down');
      },
    });

    await expect(
      service.composeApprovalTemplateWithForm(
        composeInput({ publish: true }),
        'member-admin',
      ),
    ).resolves.toEqual(expect.objectContaining({ published: true }));
  });
});

function createApprovalTemplate(id: string): ApprovalTemplateEntity {
  return Object.assign(new ApprovalTemplateEntity(), {
    category: null,
    categoryDetail: null,
    categoryId: null,
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    createdByMemberId: null,
    currentVersionId: null,
    deletedAt: null,
    description: null,
    id,
    isActive: true,
    name: `簽核模板 ${id}`,
    updatedAt: new Date('2026-05-10T00:00:00.000Z'),
  });
}

function createApprovalTemplateCategory(
  id: string,
): ApprovalTemplateCategoryEntity {
  return Object.assign(new ApprovalTemplateCategoryEntity(), {
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    description: null,
    id,
    isActive: true,
    name: '財務',
    sortOrder: 0,
    updatedAt: new Date('2026-05-10T00:00:00.000Z'),
  });
}

function createRepository<
  TEntity extends ObjectLiteral,
>(): Repository<TEntity> {
  return {} as Repository<TEntity>;
}

const SAMPLE_FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'amount',
      label: '金額',
      required: true,
      type: 'number',
    },
  ],
  schemaVersion: 1,
};

const SAMPLE_FORM_UI_SCHEMA = {
  layout: [{ fieldKey: 'amount', width: 'FULL' }],
  schemaVersion: 1,
};

const VALID_WORKFLOW_DEFINITION = {
  edges: [
    {
      data: {},
      id: 'edge_start_task',
      source: 'start',
      target: 'task_manager',
      type: 'smoothstep',
    },
    {
      data: {},
      id: 'edge_task_end',
      source: 'task_manager',
      target: 'end',
      type: 'smoothstep',
    },
  ],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 80, y: 160 },
      type: 'startEvent',
    },
    {
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: true,
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
        decisionPolicy: { type: 'SINGLE' },
        label: '主管簽核',
        returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
      },
      id: 'task_manager',
      position: { x: 300, y: 160 },
      type: 'userTask',
    },
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 520, y: 160 },
      type: 'endEvent',
    },
  ],
};

/**
 * start → task_1 → … → end, one approval node per list of field permissions
 * (node ids `task_1`, `task_2`, …), each otherwise like the manager task.
 */
function createFieldPermissionWorkflow(
  permissionsPerNode: readonly (readonly Readonly<Record<string, unknown>>[])[],
): WorkflowDefinition {
  const nodeIds = permissionsPerNode.map((_permissions, index) => `task_${index + 1}`);
  const chain = ['start', ...nodeIds, 'end'];

  return {
    edges: chain.slice(1).map((target, index) => ({
      data: {},
      id: `edge_${index}`,
      source: chain[index],
      target,
      type: 'smoothstep',
    })),
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      ...permissionsPerNode.map((fieldPermissions, index) => ({
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: true,
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
          decisionPolicy: { type: 'SINGLE' },
          fieldPermissions,
          label: `補填 ${index + 1}`,
          returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
        },
        id: nodeIds[index],
        position: { x: 300 + index * 200, y: 160 },
        type: 'userTask',
      })),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520 + permissionsPerNode.length * 200, y: 160 },
        type: 'endEvent',
      },
    ],
  } as unknown as WorkflowDefinition;
}

const TABLE_FORM_SCHEMA = {
  fields: [
    {
      columns: [
        { fieldKey: 'name', label: '品項', required: true, type: 'text' },
        { fieldKey: 'qty', label: '數量', required: true, type: 'number' },
      ],
      fieldKey: 'items',
      label: '請購明細',
      required: true,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};

/**
 * VALID_WORKFLOW_DEFINITION with the manager task's approver resolver swapped
 * and, when `notifyRecipients` is given, a NOTIFY service task hanging off the
 * start event (a NOTIFY node is a leaf, it cannot have outgoing edges).
 */
function createDynamicFormWorkflow(
  approverResolver: ApproverResolver,
  notifyRecipients?: ApproverResolver,
): WorkflowDefinition {
  const base = VALID_WORKFLOW_DEFINITION as unknown as WorkflowDefinition;
  const nodes = base.nodes.map((node) =>
    node.type === 'userTask'
      ? { ...node, data: { ...node.data, approverResolver } }
      : node,
  );

  if (!notifyRecipients) {
    return { ...base, nodes };
  }

  return {
    ...base,
    edges: [
      ...base.edges,
      {
        data: {},
        id: 'edge_start_notify',
        source: 'start',
        target: 'notify_peer',
        type: 'smoothstep',
      },
    ],
    nodes: [
      ...nodes,
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: notifyRecipients,
            type: 'NOTIFY',
          },
          label: '通知',
        },
        id: 'notify_peer',
        position: { x: 400, y: 160 },
        type: 'serviceTask',
      },
    ],
  } as WorkflowDefinition;
}

/**
 * A publishable draft bound to a form whose only field is a table, with the
 * given condition data on the single start → end edge. Used to prove both
 * halves of the table-internals ban: the CEL expressions and the structured
 * `conditionFieldKey`.
 */
function createTableConditionPublishService({
  condition,
  conditionFieldKey,
  conditionOperator,
  conditionValue,
  initiatorPolicyCel = null,
  schema = TABLE_FORM_SCHEMA as FormDefinitionSchema,
  workflowDefinition,
}: {
  readonly condition?: string;
  readonly conditionFieldKey?: string;
  readonly conditionOperator?: string;
  readonly conditionValue?: string;
  readonly initiatorPolicyCel?: string | null;
  readonly schema?: FormDefinitionSchema;
  readonly workflowDefinition?: WorkflowDefinition;
}): TemplateService {
  const draftVersion = Object.assign(new ApprovalTemplateVersionEntity(), {
    archivedAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    formDefinitionVersionId: 'form-version-1',
    id: 'template-version-1',
    initiatorPolicyCel,
    notificationConfig: null,
    publishedAt: null,
    publishedByMemberId: null,
    slaDefaults: null,
    status: ApprovalTemplateVersionStatusEnum.DRAFT,
    templateId: 'template-1',
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    version: 1,
    workflowDefinition: workflowDefinition ?? {
      edges: [
        {
          data: {
            ...(condition ? { condition } : {}),
            ...(conditionFieldKey ? { conditionFieldKey } : {}),
            ...(conditionOperator ? { conditionOperator } : {}),
            ...(conditionValue ? { conditionValue } : {}),
          },
          id: 'edge_start_end',
          source: 'start',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    },
  });
  const formVersion = Object.assign(new FormDefinitionVersionEntity(), {
    archivedAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    formDefinitionId: 'form-1',
    id: 'form-version-1',
    publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    publishedByMemberId: 'member-admin',
    schema,
    status: FormDefinitionVersionStatusEnum.PUBLISHED,
    uiSchema: { layout: [{ fieldKey: 'items', width: 'FULL' }] },
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    version: 1,
  });
  const template = createApprovalTemplate('template-1');
  const manager = {
    getRepository: (target: unknown): ObjectLiteral =>
      target === ApprovalTemplateEntity
        ? {
            findOne: jest.fn(
              (): Promise<ApprovalTemplateEntity> => Promise.resolve(template),
            ),
            merge: jest.fn(
              (
                entity: ApprovalTemplateEntity,
                patch: Partial<ApprovalTemplateEntity>,
              ): ApprovalTemplateEntity => Object.assign(entity, patch),
            ),
            save: jest.fn(
              (
                entity: ApprovalTemplateEntity,
              ): Promise<ApprovalTemplateEntity> => Promise.resolve(entity),
            ),
          }
        : {
            merge: jest.fn(
              (
                entity: ApprovalTemplateVersionEntity,
                patch: Partial<ApprovalTemplateVersionEntity>,
              ): ApprovalTemplateVersionEntity => Object.assign(entity, patch),
            ),
            save: jest.fn(
              (
                entity: ApprovalTemplateVersionEntity,
              ): Promise<ApprovalTemplateVersionEntity> =>
                Promise.resolve(entity),
            ),
            update: jest.fn((): Promise<void> => Promise.resolve()),
          },
  } as unknown as EntityManager;

  return new TemplateService(
    {
      manager: {
        transaction: jest.fn(
          <TResult>(
            operation: (txManager: EntityManager) => Promise<TResult>,
          ): Promise<TResult> => operation(manager),
        ),
      },
    } as unknown as Repository<ApprovalTemplateEntity>,
    createRepository<ApprovalTemplateCategoryEntity>(),
    {
      findOne: jest.fn(
        (): Promise<ApprovalTemplateVersionEntity | null> =>
          Promise.resolve(draftVersion),
      ),
    } as unknown as Repository<ApprovalTemplateVersionEntity>,
    {
      findOne: jest.fn(
        (): Promise<FormDefinitionVersionEntity | null> =>
          Promise.resolve(formVersion),
      ),
    } as unknown as Repository<FormDefinitionVersionEntity>,
    new ConditionService(),
    {} as unknown as FormService,
    createTemplateModuleRef(),
  );
}

/**
 * `TemplateService` only reaches for `ModuleRef` to look up the optional
 * `BPM_TEMPLATE_OBSERVER`; throwing is how "no host observer registered" is
 * expressed, which is the default these tests run under.
 */
function createTemplateModuleRef(
  observer?: BPMTemplateObserver,
  webhookService?: WorkflowWebhookService,
): ModuleRef {
  return {
    get: (token: unknown): BPMTemplateObserver | WorkflowWebhookService => {
      if (observer && token === BPM_TEMPLATE_OBSERVER) {
        return observer;
      }

      if (webhookService && token === WorkflowWebhookService) {
        return webhookService;
      }

      // Mirrors a host without that module: `TemplateService` catches the
      // throw and treats the feature as absent.
      throw new Error('Unexpected ModuleRef lookup');
    },
  } as unknown as ModuleRef;
}

const WEBHOOK_FORM_SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: 'Amount', required: true, type: 'money' },
  ],
  schemaVersion: 1,
};

/**
 * A publishable draft whose NOTIFY node calls one webhook endpoint, so the
 * publish path can be exercised against a real `WorkflowWebhookService`.
 */
function createWebhookPublishService(
  webhookService?: WorkflowWebhookService,
  webhooksOverride?: unknown,
): TemplateService {
  const draftVersion = Object.assign(new ApprovalTemplateVersionEntity(), {
    archivedAt: null,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    formDefinitionVersionId: 'form-version-1',
    id: 'template-version-1',
    initiatorPolicyCel: null,
    notificationConfig: null,
    publishedAt: null,
    publishedByMemberId: null,
    slaDefaults: null,
    status: ApprovalTemplateVersionStatusEnum.DRAFT,
    templateId: 'template-1',
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    version: 1,
    workflowDefinition: {
      edges: [
        {
          data: {},
          id: 'edge_start_end',
          source: 'start',
          target: 'end',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_start_notify',
          source: 'start',
          target: 'notify_erp',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: [], type: 'DIRECT' },
              type: 'NOTIFY',
              webhooks: (webhooksOverride ?? [
                {
                  bindings: [
                    {
                      from: { fieldKey: 'amount', kind: 'FIELD' },
                      parameter: 'amount',
                    },
                  ],
                  endpoint: { key: 'erp.purchase-approved', version: 1 },
                  id: 'webhook_erp',
                },
              ]) as NotifyWebhookTarget[],
            },
            label: '通知 ERP',
          },
          id: 'notify_erp',
          position: { x: 300, y: 320 },
          type: 'serviceTask',
        },
      ],
    },
  });
  const formVersion = Object.assign(new FormDefinitionVersionEntity(), {
    archivedAt: null,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    formDefinitionId: 'form-1',
    id: 'form-version-1',
    publishedAt: new Date('2026-09-15T00:00:00.000Z'),
    publishedByMemberId: 'member-admin',
    schema: WEBHOOK_FORM_SCHEMA,
    status: FormDefinitionVersionStatusEnum.PUBLISHED,
    uiSchema: { layout: [{ fieldKey: 'amount', width: 'FULL' }] },
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    version: 1,
  });
  const template = createApprovalTemplate('template-1');
  const manager = {
    getRepository: (target: unknown): ObjectLiteral =>
      target === ApprovalTemplateEntity
        ? {
            findOne: jest.fn(
              (): Promise<ApprovalTemplateEntity> => Promise.resolve(template),
            ),
            merge: jest.fn(
              (
                entity: ApprovalTemplateEntity,
                patch: Partial<ApprovalTemplateEntity>,
              ): ApprovalTemplateEntity => Object.assign(entity, patch),
            ),
            save: jest.fn(
              (
                entity: ApprovalTemplateEntity,
              ): Promise<ApprovalTemplateEntity> => Promise.resolve(entity),
            ),
          }
        : {
            merge: jest.fn(
              (
                entity: ApprovalTemplateVersionEntity,
                patch: Partial<ApprovalTemplateVersionEntity>,
              ): ApprovalTemplateVersionEntity => Object.assign(entity, patch),
            ),
            save: jest.fn(
              (
                entity: ApprovalTemplateVersionEntity,
              ): Promise<ApprovalTemplateVersionEntity> =>
                Promise.resolve(entity),
            ),
            update: jest.fn((): Promise<void> => Promise.resolve()),
          },
  } as unknown as EntityManager;

  return new TemplateService(
    {
      manager: {
        transaction: jest.fn(
          <TResult>(
            operation: (txManager: EntityManager) => Promise<TResult>,
          ): Promise<TResult> => operation(manager),
        ),
      },
    } as unknown as Repository<ApprovalTemplateEntity>,
    createRepository<ApprovalTemplateCategoryEntity>(),
    {
      findOne: jest.fn(
        (): Promise<ApprovalTemplateVersionEntity | null> =>
          Promise.resolve(draftVersion),
      ),
    } as unknown as Repository<ApprovalTemplateVersionEntity>,
    {
      findOne: jest.fn(
        (): Promise<FormDefinitionVersionEntity | null> =>
          Promise.resolve(formVersion),
      ),
    } as unknown as Repository<FormDefinitionVersionEntity>,
    new ConditionService(),
    {} as unknown as FormService,
    createTemplateModuleRef(undefined, webhookService),
  );
}

function createWebhookService(
  parameters: readonly BPMWorkflowWebhookParameter[],
): WorkflowWebhookService {
  return new WorkflowWebhookService(
    new StaticBPMWorkflowWebhookRegistry([
      {
        buildRequest: async () => ({ url: 'https://erp.example.com/hooks/bpm' }),
        descriptor: {
          key: 'erp.purchase-approved',
          label: 'ERP purchase order',
          parameters,
          version: 1,
        },
      },
    ]),
    resolveBPMWorkflowWebhookOptions(),
  );
}

/**
 * A `TemplateService` whose four repositories all read and write the same
 * in-memory store, so the paths that run without a caller-supplied manager
 * (publish, rollback) work as well as the composed ones.
 */
function createStoreBackedService(
  manager: EntityManager,
  observer?: BPMTemplateObserver,
): TemplateService {
  const repositoryFor = <TEntity extends ObjectLiteral>(
    entity: new () => ObjectLiteral,
  ): Repository<TEntity> =>
    ({
      ...manager.getRepository(entity),
      manager,
    }) as unknown as Repository<TEntity>;

  return new TemplateService(
    repositoryFor<ApprovalTemplateEntity>(ApprovalTemplateEntity),
    repositoryFor<ApprovalTemplateCategoryEntity>(
      ApprovalTemplateCategoryEntity,
    ),
    repositoryFor<ApprovalTemplateVersionEntity>(ApprovalTemplateVersionEntity),
    repositoryFor<FormDefinitionVersionEntity>(FormDefinitionVersionEntity),
    new ConditionService(),
    new FormService(
      {} as Repository<FormDefinitionEntity>,
      {} as Repository<FormDefinitionVersionEntity>,
    ),
    createTemplateModuleRef(observer),
  );
}

function composeInput(
  overrides: Partial<ComposeApprovalTemplateWithFormInput> = {},
): ComposeApprovalTemplateWithFormInput {
  return {
    category: null,
    categoryId: null,
    formDefinitionId: null,
    formDescription: null,
    formName: '請款表單',
    initiatorPolicyCel: null,
    notificationConfigJson: null,
    publish: false,
    schemaJson: JSON.stringify(SAMPLE_FORM_SCHEMA),
    slaDefaultsJson: null,
    templateDescription: null,
    templateId: null,
    templateName: '請款簽核',
    uiSchemaJson: JSON.stringify(SAMPLE_FORM_UI_SCHEMA),
    workflowDefinitionJson: JSON.stringify(VALID_WORKFLOW_DEFINITION),
    ...overrides,
  };
}

function createComposingService(manager: EntityManager): TemplateService {
  const formService = new FormService(
    {} as Repository<FormDefinitionEntity>,
    {} as Repository<FormDefinitionVersionEntity>,
  );

  return new TemplateService(
    { manager } as unknown as Repository<ApprovalTemplateEntity>,
    {} as Repository<ApprovalTemplateCategoryEntity>,
    {} as Repository<ApprovalTemplateVersionEntity>,
    {} as Repository<FormDefinitionVersionEntity>,
    new ConditionService(),
    formService,
    createTemplateModuleRef(),
  );
}

/**
 * Minimal in-memory EntityManager that backs the composed-mutation tests. It
 * supports the create/find/update surface the compose flow exercises and runs
 * `transaction(op)` by invoking `op` with itself, mirroring a single DB
 * transaction boundary.
 */
function createInMemoryManager(): {
  readonly manager: EntityManager;
  readonly store: (entity: unknown) => Map<string, ObjectLiteral>;
} {
  const stores = new Map<unknown, Map<string, ObjectLiteral>>();
  let sequence = 0;

  const storeFor = (entity: unknown): Map<string, ObjectLiteral> => {
    const existing = stores.get(entity);

    if (existing) {
      return existing;
    }

    const created = new Map<string, ObjectLiteral>();
    stores.set(entity, created);

    return created;
  };

  const matches = (
    row: ObjectLiteral,
    where: Readonly<Record<string, unknown>>,
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'relations') {
        return true;
      }

      if (value !== null && typeof value === 'object' && '_type' in value) {
        // Treat any FindOperator (e.g. IsNull()) as a null match.
        return row[key] === null || row[key] === undefined;
      }

      return row[key] === value;
    });

  const makeRepository = (
    entity: new () => ObjectLiteral,
  ): Record<string, unknown> => {
    const store = storeFor(entity);

    return {
      create: (value: ObjectLiteral): ObjectLiteral =>
        Object.assign(new entity(), value),
      // Only `readNextVersionNumber` builds a query, and only ever to read
      // MAX(version) for one template, so the stub answers that one shape.
      createQueryBuilder: (): Record<string, unknown> => {
        let templateId: string | null = null;
        const builder: Record<string, unknown> = {
          getRawOne: (): Promise<{ readonly maxVersion: number | null }> => {
            const versions = [...store.values()]
              .filter((row) => row['templateId'] === templateId)
              .map((row) => Number(row['version'] ?? 0));

            return Promise.resolve({
              maxVersion: versions.length ? Math.max(...versions) : null,
            });
          },
          select: (): Record<string, unknown> => builder,
          where: (
            _clause: string,
            parameters: Readonly<Record<string, unknown>>,
          ): Record<string, unknown> => {
            templateId = String(parameters['templateId']);

            return builder;
          },
        };

        return builder;
      },
      findOne: ({
        where,
      }: {
        readonly where:
          | Readonly<Record<string, unknown>>
          | readonly Readonly<Record<string, unknown>>[];
      }): Promise<ObjectLiteral | null> => {
        const clauses = Array.isArray(where) ? where : [where];

        for (const row of store.values()) {
          if (clauses.some((clause) => matches(row, clause))) {
            return Promise.resolve(row);
          }
        }

        return Promise.resolve(null);
      },
      findOneByOrFail: (
        where: Readonly<Record<string, unknown>>,
      ): Promise<ObjectLiteral> => {
        for (const row of store.values()) {
          if (matches(row, where)) {
            return Promise.resolve(row);
          }
        }

        return Promise.reject(new Error(`${entity.name} was not found`));
      },
      merge: (target: ObjectLiteral, patch: ObjectLiteral): ObjectLiteral =>
        Object.assign(target, patch),
      save: (value: ObjectLiteral): Promise<ObjectLiteral> => {
        if (!value.id) {
          sequence += 1;
          value.id = `${entity.name}-${sequence}`;
        }

        store.set(value.id as string, value);

        return Promise.resolve(value);
      },
      update: (
        criteria: Readonly<Record<string, unknown>>,
        patch: ObjectLiteral,
      ): Promise<void> => {
        for (const row of store.values()) {
          if (matches(row, criteria)) {
            Object.assign(row, patch);
          }
        }

        return Promise.resolve();
      },
    };
  };

  const manager = {
    getRepository: (entity: new () => ObjectLiteral): Record<string, unknown> =>
      makeRepository(entity),
    transaction: <TResult>(
      operation: (manager: EntityManager) => Promise<TResult>,
    ): Promise<TResult> => operation(manager as unknown as EntityManager),
  } as unknown as EntityManager;

  return {
    manager,
    store: (entity: unknown): Map<string, ObjectLiteral> => storeFor(entity),
  };
}
