import { ObjectLiteral, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { ApprovalTemplateListStatusEnum } from './template.enums';
import { TemplateService } from './template.service';

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
});

function createApprovalTemplate(id: string): ApprovalTemplateEntity {
  return Object.assign(new ApprovalTemplateEntity(), {
    category: null,
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

function createRepository<TEntity extends ObjectLiteral>(): Repository<TEntity> {
  return {} as Repository<TEntity>;
}
