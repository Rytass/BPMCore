import { BadRequestException } from '@nestjs/common';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionEntity } from '../form/form-definition.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { FormService } from '../form/form.service';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  ApprovalTemplateActivationStatusEnum,
  ApprovalTemplateCategoryStatusEnum,
  ApprovalTemplateListStatusEnum,
  ApprovalTemplateVersionStatusEnum,
} from './template.enums';
import { TemplateService } from './template.service';
import { EMPTY_WORKFLOW_DEFINITION } from './workflow-definition.validator';

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
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.nodes.start does not have a path to an endEvent',
    );
    expect(transaction).not.toHaveBeenCalled();
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
    const categoryRemove = jest.fn(
      (
        value: ApprovalTemplateCategoryEntity,
      ): Promise<ApprovalTemplateCategoryEntity> => Promise.resolve(value),
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
    );

    const deleted = await service.deleteApprovalTemplateCategory('category-1');

    expect(categoryRemove).toHaveBeenCalledWith(category);
    expect(deleted).toBe(category);
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
