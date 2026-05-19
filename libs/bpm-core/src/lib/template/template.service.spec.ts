import { ObjectLiteral, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
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
    const manager = {
      getRepository: jest.fn((entity: unknown): unknown => {
        if (entity === ApprovalTemplateEntity) {
          return {
            create: templateCreate,
            save: templateSave,
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
      {
        findOne: categoryFindOne,
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      {
        findOne: jest.fn(
          (): Promise<FormDefinitionVersionEntity | null> =>
            Promise.resolve(null),
        ),
      } as unknown as Repository<FormDefinitionVersionEntity>,
      new ConditionService(),
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
    expect(templateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: '財務',
        categoryId: 'category-1',
      }),
    );
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
    );

    await expect(
      service.publishApprovalTemplateVersion('template-version-1'),
    ).rejects.toThrow(
      'workflow.nodes.start does not have a path to an endEvent',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('deactivates categories on delete when templates still use them', async (): Promise<void> => {
    const category = createApprovalTemplateCategory('category-1');
    const categorySave = jest.fn(
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
        save: categorySave,
      } as unknown as Repository<ApprovalTemplateCategoryEntity>,
      createRepository<ApprovalTemplateVersionEntity>(),
      createRepository<FormDefinitionVersionEntity>(),
      new ConditionService(),
    );

    const deleted = await service.deleteApprovalTemplateCategory('category-1');

    expect(deleted.isActive).toBe(false);
    expect(categorySave).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
      }),
    );
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
