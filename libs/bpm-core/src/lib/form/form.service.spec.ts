import { ObjectLiteral, Repository } from 'typeorm';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import { FormDefinitionListStatusEnum } from './form.enums';
import { FormService } from './form.service';

describe('FormService', () => {
  it('applies backend pagination when listing form definitions and counts active records', async (): Promise<void> => {
    const forms = Array.from({ length: 13 }, (_, index) =>
      createFormDefinition(`form-${index + 1}`),
    );
    const find = jest.fn(
      ({
        skip = 0,
        take = 10,
      }: {
        readonly skip?: number;
        readonly take?: number;
      }): Promise<readonly FormDefinitionEntity[]> =>
        Promise.resolve(forms.slice(skip, skip + take)),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(forms.length));
    const service = new FormService(
      {
        count,
        find,
      } as unknown as Repository<FormDefinitionEntity>,
      createRepository<FormDefinitionVersionEntity>(),
    );

    const pageTwo = await service.listFormDefinitions({
      page: 2,
      pageSize: 5,
    });
    const totalCount = await service.countFormDefinitions();

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(pageTwo.map((form) => form.id)).toEqual([
      'form-6',
      'form-7',
      'form-8',
      'form-9',
      'form-10',
    ]);
    expect(totalCount).toBe(13);
  });

  it('filters form definitions by derived publication status', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly FormDefinitionEntity[]> => Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new FormService(
      {
        count,
        find,
      } as unknown as Repository<FormDefinitionEntity>,
      createRepository<FormDefinitionVersionEntity>(),
    );

    await service.listFormDefinitions({
      status: FormDefinitionListStatusEnum.PUBLISHED,
    });
    await service.countFormDefinitions(FormDefinitionListStatusEnum.DRAFT);

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

  it('hydrates current version summary when listing form definitions', async (): Promise<void> => {
    const publishedForm = Object.assign(createFormDefinition('form-1'), {
      currentVersionId: 'version-1',
    });
    const find = jest.fn(
      (): Promise<readonly FormDefinitionEntity[]> =>
        Promise.resolve([publishedForm]),
    );
    const versionCreatedAt = new Date('2026-05-10T01:00:00.000Z');
    const versionPublishedAt = new Date('2026-05-10T02:00:00.000Z');
    const findBy = jest.fn(
      (): Promise<readonly FormDefinitionVersionEntity[]> =>
        Promise.resolve([
          Object.assign(new FormDefinitionVersionEntity(), {
            createdAt: versionCreatedAt,
            id: 'version-1',
            publishedAt: versionPublishedAt,
            version: 3,
          }),
        ]),
    );
    const service = new FormService(
      {
        find,
      } as unknown as Repository<FormDefinitionEntity>,
      {
        findBy,
      } as unknown as Repository<FormDefinitionVersionEntity>,
    );

    const definitions = await service.listFormDefinitions();

    expect(definitions[0]).toMatchObject({
      currentVersionCreatedAt: versionCreatedAt,
      currentVersionNumber: 3,
      currentVersionPublishedAt: versionPublishedAt,
    });
    expect(findBy).toHaveBeenCalledWith({
      id: expect.any(Object),
    });
  });
});

function createFormDefinition(id: string): FormDefinitionEntity {
  return Object.assign(new FormDefinitionEntity(), {
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    createdByMemberId: null,
    currentVersionId: null,
    deletedAt: null,
    description: null,
    id,
    name: `表單 ${id}`,
    updatedAt: new Date('2026-05-10T00:00:00.000Z'),
  });
}

function createRepository<TEntity extends ObjectLiteral>(): Repository<TEntity> {
  return {} as Repository<TEntity>;
}
