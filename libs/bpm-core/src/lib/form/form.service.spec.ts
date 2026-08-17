import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import {
  FormDefinitionListStatusEnum,
  FormDefinitionVersionStatusEnum,
} from './form.enums';
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

  describe('publishFormDefinitionContent', () => {
    const changedSchemaJson = JSON.stringify({
      fields: [
        { fieldKey: 'text_1', label: '姓名', required: false, type: 'text' },
      ],
      schemaVersion: 1,
    });

    it('publishes a brand-new version when published content changed', async (): Promise<void> => {
      const definition = Object.assign(createFormDefinition('def-1'), {
        currentVersionId: 'version-1',
      });
      const currentVersion = createVersion({
        id: 'version-1',
        status: FormDefinitionVersionStatusEnum.PUBLISHED,
      });
      const versionRepository = createVersionRepository({
        currentVersion,
        maxVersion: 1,
      });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      const published = await service.publishFormDefinitionContent(
        {
          formDefinitionId: 'def-1',
          schemaJson: changedSchemaJson,
          uiSchemaJson: null,
        },
        'member-1',
        createManager(createDefinitionRepository(definition), versionRepository),
      );

      expect(published.status).toBe(FormDefinitionVersionStatusEnum.PUBLISHED);
      expect(published.version).toBe(2);
      expect(published.publishedByMemberId).toBe('member-1');
      expect(versionRepository.update).toHaveBeenCalledWith(
        { id: 'version-1' },
        expect.objectContaining({
          status: FormDefinitionVersionStatusEnum.ARCHIVED,
        }),
      );
      expect(definition.currentVersionId).toBe(published.id);
    });

    it('returns the current version untouched when content is identical', async (): Promise<void> => {
      const definition = Object.assign(createFormDefinition('def-1'), {
        currentVersionId: 'version-1',
      });
      const currentVersion = createVersion({
        id: 'version-1',
        schema: JSON.parse(changedSchemaJson) as Record<string, unknown>,
        status: FormDefinitionVersionStatusEnum.PUBLISHED,
      });
      const versionRepository = createVersionRepository({
        currentVersion,
        maxVersion: 1,
      });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      const published = await service.publishFormDefinitionContent(
        {
          formDefinitionId: 'def-1',
          schemaJson: changedSchemaJson,
          uiSchemaJson: null,
        },
        'member-1',
        createManager(createDefinitionRepository(definition), versionRepository),
      );

      expect(published).toBe(currentVersion);
      expect(versionRepository.save).not.toHaveBeenCalled();
      expect(versionRepository.update).not.toHaveBeenCalled();
    });

    it('updates and publishes the pre-publish draft in place', async (): Promise<void> => {
      const definition = createFormDefinition('def-1');
      const draft = createVersion({
        id: 'version-1',
        status: FormDefinitionVersionStatusEnum.DRAFT,
      });
      const versionRepository = createVersionRepository({
        draft,
        maxVersion: 1,
      });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      const published = await service.publishFormDefinitionContent(
        {
          formDefinitionId: 'def-1',
          schemaJson: changedSchemaJson,
          uiSchemaJson: null,
        },
        'member-1',
        createManager(createDefinitionRepository(definition), versionRepository),
      );

      expect(published.id).toBe('version-1');
      expect(published.version).toBe(1);
      expect(published.status).toBe(FormDefinitionVersionStatusEnum.PUBLISHED);
      expect(JSON.stringify(published.schema)).toBe(changedSchemaJson);
      expect(versionRepository.update).not.toHaveBeenCalled();
      expect(definition.currentVersionId).toBe('version-1');
    });

    it('refuses to publish a dynamic option field without a host registry', async (): Promise<void> => {
      const definition = createFormDefinition('def-1');
      const versionRepository = createVersionRepository({ maxVersion: 1 });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      await expect(
        service.publishFormDefinitionContent(
          {
            formDefinitionId: 'def-1',
            schemaJson: dynamicSchemaJson,
            uiSchemaJson: null,
          },
          'member-1',
          createManager(
            createDefinitionRepository(definition),
            versionRepository,
          ),
        ),
      ).rejects.toThrow('FORM_DATA_SOURCE_MISSING');
    });

    it('still saves a draft that references an unavailable DataSource', async (): Promise<void> => {
      const definition = createFormDefinition('def-1');
      const draft = createVersion({
        id: 'version-1',
        status: FormDefinitionVersionStatusEnum.DRAFT,
      });
      const versionRepository = createVersionRepository({
        draft,
        maxVersion: 1,
      });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      // The ADR keeps an unavailable reference in the draft verbatim and only
      // blocks publishing a new version.
      const updated = await service.updateFormDefinitionDraft(
        {
          schemaJson: dynamicSchemaJson,
          uiSchemaJson: '{"layout":[],"schemaVersion":1}',
          versionId: 'version-1',
        },
        createManager(createDefinitionRepository(definition), versionRepository),
      );

      // Normalization still adds the implicit single mode; what matters is
      // that the unavailable reference survived instead of being rejected.
      expect(updated.schema.fields[1]).toMatchObject({
        dataSource: { key: 'demo.cost-centers', version: 1 },
        fieldKey: 'costCenter',
      });
    });

    it('refuses to roll back to a version whose DataSource is unavailable', async (): Promise<void> => {
      const archived = createVersion({
        id: 'version-1',
        schema: JSON.parse(dynamicSchemaJson) as Record<string, unknown>,
        status: FormDefinitionVersionStatusEnum.ARCHIVED,
      });
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        {
          findOne: jest.fn(() => Promise.resolve(archived)),
        } as unknown as Repository<FormDefinitionVersionEntity>,
      );

      // A rollback republishes the archived version, so the registry gate that
      // guards publishing must apply here too.
      await expect(
        service.rollbackFormDefinitionVersion('version-1'),
      ).rejects.toThrow('FORM_DATA_SOURCE_MISSING');
    });

    it('reports a dynamic option field as unlintable without a host registry', (): void => {
      const service = new FormService(
        createRepository<FormDefinitionEntity>(),
        createRepository<FormDefinitionVersionEntity>(),
      );

      expect(
        service.lintFormSchema({
          schemaJson: dynamicSchemaJson,
          uiSchemaJson: null,
        }),
      ).toEqual({
        errors: ['schema.fields[1].dataSource FORM_DATA_SOURCE_MISSING'],
        valid: false,
      });
    });
  });
});

const dynamicSchemaJson = JSON.stringify({
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

function createVersion(overrides: {
  readonly id: string;
  readonly schema?: Record<string, unknown>;
  readonly status: FormDefinitionVersionStatusEnum;
}): FormDefinitionVersionEntity {
  return Object.assign(new FormDefinitionVersionEntity(), {
    archivedAt: null,
    formDefinitionId: 'def-1',
    id: overrides.id,
    publishedAt: null,
    publishedByMemberId: null,
    schema: overrides.schema ?? { fields: [], schemaVersion: 1 },
    status: overrides.status,
    uiSchema: { layout: [], schemaVersion: 1 },
    version: 1,
  });
}

function createDefinitionRepository(
  definition: FormDefinitionEntity,
): Repository<FormDefinitionEntity> {
  return {
    findOne: jest.fn(
      (): Promise<FormDefinitionEntity> => Promise.resolve(definition),
    ),
    merge: (
      target: FormDefinitionEntity,
      source: Partial<FormDefinitionEntity>,
    ): FormDefinitionEntity => Object.assign(target, source),
    save: jest.fn(
      (entity: FormDefinitionEntity): Promise<FormDefinitionEntity> =>
        Promise.resolve(entity),
    ),
  } as unknown as Repository<FormDefinitionEntity>;
}

function createVersionRepository(options: {
  readonly currentVersion?: FormDefinitionVersionEntity;
  readonly draft?: FormDefinitionVersionEntity;
  readonly maxVersion: number;
}): Repository<FormDefinitionVersionEntity> {
  const versionsById = new Map(
    [options.currentVersion, options.draft]
      .filter(
        (version): version is FormDefinitionVersionEntity =>
          version !== undefined,
      )
      .map((version) => [version.id, version]),
  );

  return {
    create: (
      data: Partial<FormDefinitionVersionEntity>,
    ): FormDefinitionVersionEntity =>
      Object.assign(new FormDefinitionVersionEntity(), data),
    createQueryBuilder: (): unknown => {
      const builder = {
        getRawOne: (): Promise<{ readonly maxVersion: number }> =>
          Promise.resolve({ maxVersion: options.maxVersion }),
        select: (): unknown => builder,
        where: (): unknown => builder,
      };

      return builder;
    },
    findOne: jest.fn(
      ({
        where,
      }: {
        readonly where: { readonly id?: string };
      }): Promise<FormDefinitionVersionEntity | null> =>
        Promise.resolve(
          where.id !== undefined
            ? (versionsById.get(where.id) ?? null)
            : (options.draft ?? null),
        ),
    ),
    merge: (
      target: FormDefinitionVersionEntity,
      source: Partial<FormDefinitionVersionEntity>,
    ): FormDefinitionVersionEntity => Object.assign(target, source),
    save: jest.fn(
      (
        entity: FormDefinitionVersionEntity,
      ): Promise<FormDefinitionVersionEntity> => {
        const saved = entity.id
          ? entity
          : Object.assign(entity, { id: `version-${versionsById.size + 1}` });

        versionsById.set(saved.id, saved);

        return Promise.resolve(saved);
      },
    ),
    update: jest.fn((): Promise<void> => Promise.resolve()),
  } as unknown as Repository<FormDefinitionVersionEntity>;
}

function createManager(
  definitionRepository: Repository<FormDefinitionEntity>,
  versionRepository: Repository<FormDefinitionVersionEntity>,
): EntityManager {
  return {
    getRepository: (entity: unknown): unknown =>
      entity === FormDefinitionEntity
        ? definitionRepository
        : versionRepository,
  } as unknown as EntityManager;
}
