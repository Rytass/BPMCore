import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import {
  CreateFormDefinitionInput,
  LintFormSchemaInput,
  PublishFormDefinitionContentInput,
  UpdateFormDefinitionDraftInput,
  UpdateFormDefinitionInput,
} from './dto/form-definition.input';
import {
  FormDefinitionListStatusEnum,
  FormDefinitionVersionStatusEnum,
} from './form.enums';
import { FormSchemaLintResultObject } from './form-schema-lint.object';
import {
  lintFormSchemaJson,
  parseAndValidateFormSchemas,
} from './form-schema.validator';
import { FormDataSourceService } from '../form-data-source/form-data-source.service';

interface MaxVersionRow {
  readonly maxVersion?: number | string | null;
}

interface ListFormDefinitionsOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly status?: FormDefinitionListStatusEnum;
}

@Injectable()
export class FormService {
  constructor(
    @InjectRepository(FormDefinitionEntity)
    private readonly formDefinitionRepository: Repository<FormDefinitionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    @Optional()
    private readonly formDataSourceService?: FormDataSourceService,
  ) {}

  async createFormDefinition(
    input: CreateFormDefinitionInput,
    manager?: EntityManager,
  ): Promise<FormDefinitionEntity> {
    const schemas = this.parseSchemasOrThrow(
      input.schemaJson,
      input.uiSchemaJson,
    );
    const run = (txManager: EntityManager): Promise<FormDefinitionEntity> =>
      this.createFormDefinitionWithManager(txManager, input, schemas);

    return manager
      ? run(manager)
      : this.formDefinitionRepository.manager.transaction(run);
  }

  private async createFormDefinitionWithManager(
    manager: EntityManager,
    input: CreateFormDefinitionInput,
    schemas: ReturnType<typeof parseAndValidateFormSchemas>,
  ): Promise<FormDefinitionEntity> {
    const definitionRepository = manager.getRepository(FormDefinitionEntity);
    const versionRepository = manager.getRepository(FormDefinitionVersionEntity);
    const definition = await definitionRepository.save(
      definitionRepository.create({
        createdByMemberId: input.createdByMemberId,
        currentVersionId: null,
        description: input.description,
        name: input.name,
      }),
    );

    await versionRepository.save(
      versionRepository.create({
        archivedAt: null,
        formDefinitionId: definition.id,
        publishedAt: null,
        publishedByMemberId: null,
        schema: schemas.schema,
        status: FormDefinitionVersionStatusEnum.DRAFT,
        uiSchema: schemas.uiSchema,
        version: 1,
      }),
    );

    return definition;
  }

  async updateFormDefinition(
    input: UpdateFormDefinitionInput,
  ): Promise<FormDefinitionEntity> {
    const existing = await this.getFormDefinitionOrThrow(input.id);
    const next = this.formDefinitionRepository.merge(existing, {
      description: input.description ?? existing.description,
      name: input.name ?? existing.name,
    });

    return this.formDefinitionRepository.save(next);
  }

  async listFormDefinitions(
    options: ListFormDefinitionsOptions = {},
  ): Promise<readonly FormDefinitionEntity[]> {
    const isPaginated =
      typeof options.page === 'number' || typeof options.pageSize === 'number';
    const normalizedPageSize = isPaginated
      ? normalizePageSize(options.pageSize ?? 10)
      : undefined;

    const definitions = await this.formDefinitionRepository.find({
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
      ...(normalizedPageSize
        ? {
            skip: (normalizePage(options.page ?? 1) - 1) * normalizedPageSize,
            take: normalizedPageSize,
          }
        : {}),
      where: createFormDefinitionWhere(options.status),
    });

    return this.hydrateCurrentVersions(definitions);
  }

  async countFormDefinitions(
    status?: FormDefinitionListStatusEnum,
  ): Promise<number> {
    return this.formDefinitionRepository.count({
      where: createFormDefinitionWhere(status),
    });
  }

  async getFormDefinition(id: string): Promise<FormDefinitionEntity> {
    const definition = await this.getFormDefinitionOrThrow(id);

    return this.hydrateCurrentVersion(definition);
  }

  async listFormDefinitionVersions(
    formDefinitionId: string,
  ): Promise<readonly FormDefinitionVersionEntity[]> {
    await this.getFormDefinitionOrThrow(formDefinitionId);

    return this.formDefinitionVersionRepository.find({
      order: { version: 'DESC' },
      where: { formDefinitionId },
    });
  }

  async getFormDefinitionVersion(
    id: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.getFormDefinitionVersionOrThrow(id);
  }

  async updateFormDefinitionDraft(
    input: UpdateFormDefinitionDraftInput,
    manager?: EntityManager,
  ): Promise<FormDefinitionVersionEntity> {
    const versionRepository = this.formVersions(manager);
    const existing = await this.getFormDefinitionVersionOrThrow(
      input.versionId,
      manager,
    );

    if (existing.status !== FormDefinitionVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft form definition versions can be updated',
      );
    }

    const schemas = this.parseSchemasOrThrow(
      input.schemaJson,
      input.uiSchemaJson,
    );
    const next = versionRepository.merge(existing, {
      schema: schemas.schema,
      uiSchema: schemas.uiSchema,
    });

    return versionRepository.save(next);
  }

  /**
   * Publishes the given form content as the current version atomically.
   *
   * Form definitions do not keep a draft in parallel with a published
   * version: before the first publish the single draft is updated in place
   * and published; afterwards every save publishes a brand-new version
   * (version + 1) directly. Saving content identical to the current
   * published version is a no-op that returns the current version.
   */
  async publishFormDefinitionContent(
    input: PublishFormDefinitionContentInput,
    publishedByMemberId?: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionVersionEntity> {
    const schemas = this.parseSchemasOrThrow(
      input.schemaJson,
      input.uiSchemaJson,
    );
    const run = async (
      txManager: EntityManager,
    ): Promise<FormDefinitionVersionEntity> => {
      const definition = await this.getFormDefinitionOrThrow(
        input.formDefinitionId,
        txManager,
      );
      const versionRepository = txManager.getRepository(
        FormDefinitionVersionEntity,
      );
      const draft = await this.findDraftVersion(definition.id, txManager);

      if (draft) {
        const updated = await versionRepository.save(
          versionRepository.merge(draft, {
            schema: schemas.schema,
            uiSchema: schemas.uiSchema,
          }),
        );

        return this.publishFormDefinitionVersionWithManager(
          txManager,
          updated,
          publishedByMemberId,
        );
      }

      const current = definition.currentVersionId
        ? await this.getFormDefinitionVersionOrThrow(
            definition.currentVersionId,
            txManager,
          )
        : null;

      if (current && hasSameFormContent(current, schemas)) {
        return current;
      }

      const created = await versionRepository.save(
        versionRepository.create({
          archivedAt: null,
          formDefinitionId: definition.id,
          publishedAt: null,
          publishedByMemberId: null,
          schema: schemas.schema,
          status: FormDefinitionVersionStatusEnum.DRAFT,
          uiSchema: schemas.uiSchema,
          version: await this.readNextVersionNumber(definition.id, txManager),
        }),
      );

      return this.publishFormDefinitionVersionWithManager(
        txManager,
        created,
        publishedByMemberId,
      );
    };

    return manager
      ? run(manager)
      : this.formDefinitionRepository.manager.transaction(run);
  }

  async findDraftVersion(
    formDefinitionId: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionVersionEntity | null> {
    return this.formVersions(manager).findOne({
      where: {
        formDefinitionId,
        status: FormDefinitionVersionStatusEnum.DRAFT,
      },
    });
  }

  async publishFormDefinitionVersion(
    versionId: string,
    publishedByMemberId?: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionVersionEntity> {
    const version = await this.getFormDefinitionVersionOrThrow(
      versionId,
      manager,
    );

    if (version.status !== FormDefinitionVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft form definition versions can be published',
      );
    }

    this.parseSchemasOrThrow(
      JSON.stringify(version.schema),
      JSON.stringify(version.uiSchema),
    );

    const run = (
      txManager: EntityManager,
    ): Promise<FormDefinitionVersionEntity> =>
      this.publishFormDefinitionVersionWithManager(
        txManager,
        version,
        publishedByMemberId,
      );

    return manager
      ? run(manager)
      : this.formDefinitionRepository.manager.transaction(run);
  }

  private async publishFormDefinitionVersionWithManager(
    manager: EntityManager,
    version: FormDefinitionVersionEntity,
    publishedByMemberId?: string,
  ): Promise<FormDefinitionVersionEntity> {
    const definitionRepository = manager.getRepository(FormDefinitionEntity);
    const versionRepository = manager.getRepository(FormDefinitionVersionEntity);
    const definition = await definitionRepository.findOne({
      where: { deletedAt: IsNull(), id: version.formDefinitionId },
    });

    if (!definition) {
      throw new NotFoundException(
        `Form definition ${version.formDefinitionId} was not found`,
      );
    }

    if (definition.currentVersionId) {
      await versionRepository.update(
        { id: definition.currentVersionId },
        {
          archivedAt: new Date(),
          status: FormDefinitionVersionStatusEnum.ARCHIVED,
        },
      );
    }

    const published = versionRepository.merge(version, {
      archivedAt: null,
      publishedAt: new Date(),
      publishedByMemberId: publishedByMemberId ?? null,
      status: FormDefinitionVersionStatusEnum.PUBLISHED,
    });
    const saved = await versionRepository.save(published);
    await definitionRepository.save(
      definitionRepository.merge(definition, {
        currentVersionId: saved.id,
      }),
    );

    return saved;
  }

  async rollbackFormDefinitionVersion(
    versionId: string,
  ): Promise<FormDefinitionVersionEntity> {
    const target = await this.getFormDefinitionVersionOrThrow(versionId);

    if (target.status === FormDefinitionVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Draft form definition versions cannot be rollback targets',
      );
    }

    return this.formDefinitionRepository.manager.transaction(
      async (manager): Promise<FormDefinitionVersionEntity> => {
        const definitionRepository =
          manager.getRepository(FormDefinitionEntity);
        const versionRepository = manager.getRepository(
          FormDefinitionVersionEntity,
        );
        const definition = await definitionRepository.findOne({
          where: { deletedAt: IsNull(), id: target.formDefinitionId },
        });

        if (!definition) {
          throw new NotFoundException(
            `Form definition ${target.formDefinitionId} was not found`,
          );
        }

        if (
          definition.currentVersionId &&
          definition.currentVersionId !== target.id
        ) {
          await versionRepository.update(
            { id: definition.currentVersionId },
            {
              archivedAt: new Date(),
              status: FormDefinitionVersionStatusEnum.ARCHIVED,
            },
          );
        }

        const restored = versionRepository.merge(target, {
          archivedAt: null,
          status: FormDefinitionVersionStatusEnum.PUBLISHED,
        });
        const saved = await versionRepository.save(restored);
        await definitionRepository.save(
          definitionRepository.merge(definition, {
            currentVersionId: saved.id,
          }),
        );

        return saved;
      },
    );
  }

  lintFormSchema(input: LintFormSchemaInput): FormSchemaLintResultObject {
    const result = lintFormSchemaJson(input.schemaJson, input.uiSchemaJson);

    if (!result.valid || !this.formDataSourceService) {
      return {
        errors: result.errors,
        valid: result.valid,
      };
    }

    const parsed = parseAndValidateFormSchemas(
      input.schemaJson,
      input.uiSchemaJson,
    );
    const environmentErrors =
      this.formDataSourceService.lintDefinitionSchemaEnvironment(parsed.schema);

    return {
      errors: [...result.errors, ...environmentErrors],
      valid: environmentErrors.length === 0,
    };
  }

  private formDefinitions(
    manager?: EntityManager,
  ): Repository<FormDefinitionEntity> {
    return manager
      ? manager.getRepository(FormDefinitionEntity)
      : this.formDefinitionRepository;
  }

  private formVersions(
    manager?: EntityManager,
  ): Repository<FormDefinitionVersionEntity> {
    return manager
      ? manager.getRepository(FormDefinitionVersionEntity)
      : this.formDefinitionVersionRepository;
  }

  private async getFormDefinitionOrThrow(
    id: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionEntity> {
    const entity = await this.formDefinitions(manager).findOne({
      where: { deletedAt: IsNull(), id },
    });

    if (!entity) {
      throw new NotFoundException(`Form definition ${id} was not found`);
    }

    return entity;
  }

  private async hydrateCurrentVersions(
    definitions: readonly FormDefinitionEntity[],
  ): Promise<readonly FormDefinitionEntity[]> {
    const currentVersionIds = definitions.flatMap((definition) =>
      definition.currentVersionId ? [definition.currentVersionId] : [],
    );

    if (currentVersionIds.length === 0) {
      return definitions;
    }

    const versions = await this.formDefinitionVersionRepository.findBy({
      id: In(currentVersionIds),
    });
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );

    return definitions.map((definition) =>
      applyCurrentVersionSummary(
        definition,
        definition.currentVersionId
          ? (versionById.get(definition.currentVersionId) ?? null)
          : null,
      ),
    );
  }

  private async hydrateCurrentVersion(
    definition: FormDefinitionEntity,
  ): Promise<FormDefinitionEntity> {
    if (!definition.currentVersionId) {
      return definition;
    }

    const version = await this.formDefinitionVersionRepository.findOne({
      where: { id: definition.currentVersionId },
    });

    return applyCurrentVersionSummary(definition, version);
  }

  private async getFormDefinitionVersionOrThrow(
    id: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionVersionEntity> {
    const entity = await this.formVersions(manager).findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(
        `Form definition version ${id} was not found`,
      );
    }

    return entity;
  }

  private async readNextVersionNumber(
    formDefinitionId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const row = await this.formVersions(manager)
      .createQueryBuilder('version')
      .select('MAX(version.version)', 'maxVersion')
      .where('version.form_definition_id = :formDefinitionId', {
        formDefinitionId,
      })
      .getRawOne<MaxVersionRow>();
    const maxVersion =
      typeof row?.maxVersion === 'number'
        ? row.maxVersion
        : Number(row?.maxVersion ?? 0);

    return maxVersion + 1;
  }

  private parseSchemasOrThrow(
    schemaJson: string | null | undefined,
    uiSchemaJson: string | null | undefined,
  ): ReturnType<typeof parseAndValidateFormSchemas> {
    try {
      const schemas = parseAndValidateFormSchemas(schemaJson, uiSchemaJson);
      const environmentErrors =
        this.formDataSourceService?.lintDefinitionSchemaEnvironment(
          schemas.schema,
        ) ?? [];

      if (environmentErrors.length > 0) {
        throw new Error(environmentErrors.join('; '));
      }

      return schemas;
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid form schema',
      );
    }
  }
}

function normalizePage(page: number): number {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    return 10;
  }

  return Math.min(pageSize, 100);
}

function createFormDefinitionWhere(
  status: FormDefinitionListStatusEnum | undefined,
): FindOptionsWhere<FormDefinitionEntity> {
  if (status === FormDefinitionListStatusEnum.DRAFT) {
    return {
      currentVersionId: IsNull(),
      deletedAt: IsNull(),
    };
  }

  if (status === FormDefinitionListStatusEnum.PUBLISHED) {
    return {
      currentVersionId: Not(IsNull()),
      deletedAt: IsNull(),
    };
  }

  return { deletedAt: IsNull() };
}

function hasSameFormContent(
  version: FormDefinitionVersionEntity,
  schemas: ReturnType<typeof parseAndValidateFormSchemas>,
): boolean {
  return (
    JSON.stringify(version.schema) === JSON.stringify(schemas.schema) &&
    JSON.stringify(version.uiSchema) === JSON.stringify(schemas.uiSchema)
  );
}

function applyCurrentVersionSummary(
  definition: FormDefinitionEntity,
  version: FormDefinitionVersionEntity | null,
): FormDefinitionEntity {
  return Object.assign(new FormDefinitionEntity(), definition, {
    currentVersionCreatedAt: version?.createdAt ?? null,
    currentVersionNumber: version?.version ?? null,
    currentVersionPublishedAt: version?.publishedAt ?? null,
  });
}
