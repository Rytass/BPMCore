import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import {
  EntityManager,
  FindOptionsWhere,
  ILike,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import {
  isTableInternalFieldKey,
  readTableFieldKeys,
  referencesTableInternals,
} from '../form/form-table-reference';
import { FormDefinitionEntity } from '../form/form-definition.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { FormService } from '../form/form.service';
import { ComposeApprovalTemplateWithFormInput } from './dto/compose-approval-template.input';
import { ComposeApprovalTemplateWithFormObject } from './compose-approval-template.object';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  BPMTemplateChangeActionEnum,
  BPMTemplateChangedEvent,
  BPMTemplateObserver,
  BPM_TEMPLATE_OBSERVER,
} from './template-observer.token';
import {
  CreateApprovalTemplateCategoryInput,
  CreateApprovalTemplateInput,
  UpdateApprovalTemplateCategoryInput,
  UpdateApprovalTemplateDraftInput,
  UpdateApprovalTemplateInput,
} from './dto/approval-template.input';
import {
  ApprovalTemplateActivationStatusEnum,
  ApprovalTemplateCategoryStatusEnum,
  ApprovalTemplateListStatusEnum,
  ApprovalTemplateVersionStatusEnum,
} from './template.enums';
import {
  EMPTY_WORKFLOW_DEFINITION,
  lintWorkflowDefinition,
  parseWorkflowDefinitionJson,
} from './workflow-definition.validator';

interface MaxVersionRow {
  readonly maxVersion?: number | string | null;
}

interface ListApprovalTemplatesOptions {
  readonly activationStatus?: ApprovalTemplateActivationStatusEnum;
  readonly page?: number;
  readonly pageSize?: number;
  readonly categoryId?: string;
  readonly searchText?: string;
  readonly status?: ApprovalTemplateListStatusEnum;
}

interface ListApprovalTemplateCategoriesOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly searchText?: string;
  readonly status?: ApprovalTemplateCategoryStatusEnum;
}

interface PublishedVersionResult {
  readonly previousVersionId: string | null;
  readonly template: ApprovalTemplateEntity;
  readonly version: ApprovalTemplateVersionEntity;
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    @InjectRepository(ApprovalTemplateEntity)
    private readonly templateRepository: Repository<ApprovalTemplateEntity>,
    @InjectRepository(ApprovalTemplateCategoryEntity)
    private readonly templateCategoryRepository: Repository<ApprovalTemplateCategoryEntity>,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly templateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly conditionService: ConditionService,
    private readonly formService: FormService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createApprovalTemplate(
    input: CreateApprovalTemplateInput,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateEntity> {
    const run = (txManager: EntityManager): Promise<ApprovalTemplateEntity> =>
      this.createApprovalTemplateWithManager(txManager, input);

    return manager
      ? run(manager)
      : this.templateRepository.manager.transaction(run);
  }

  private async createApprovalTemplateWithManager(
    manager: EntityManager,
    input: CreateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    await this.validateOptionalFormDefinitionVersion(
      input.formDefinitionVersionId,
      manager,
    );
    const category = await this.validateOptionalTemplateCategory(
      input.categoryId,
      manager,
    );
    const templateRepository = manager.getRepository(ApprovalTemplateEntity);
    const versionRepository = manager.getRepository(
      ApprovalTemplateVersionEntity,
    );
    const template = await templateRepository.save(
      templateRepository.create({
        category: input.category ?? category?.name ?? null,
        // `categoryDetail` owns `category_id`; the `categoryId` scalar is a
        // read-only projection of the same column (see the entity).
        categoryDetail: category ?? null,
        createdByMemberId: input.createdByMemberId,
        currentVersionId: null,
        description: input.description,
        // Stated rather than left to the column default, because publishing
        // reads `isActive` back and a template that never carried the value
        // in memory would read as deactivated.
        isActive: true,
        name: input.name,
      }),
    );

    await versionRepository.save(
      versionRepository.create({
        archivedAt: null,
        formDefinitionVersionId: input.formDefinitionVersionId,
        initiatorPolicyCel: null,
        notificationConfig: null,
        publishedAt: null,
        publishedByMemberId: null,
        slaDefaults: null,
        status: ApprovalTemplateVersionStatusEnum.DRAFT,
        templateId: template.id,
        version: 1,
        workflowDefinition: EMPTY_WORKFLOW_DEFINITION,
      }),
    );

    // As in `updateApprovalTemplate`: `categoryId` is no longer written by
    // `save()`, so the in-memory entity would come back without it even though
    // the row has it. Re-read so the caller sees the persisted truth.
    return this.getTemplateOrThrow(template.id, manager);
  }

  /**
   * Atomically build (and optionally publish) a form definition together with
   * the approval template that binds it. The whole flow runs in a single DB
   * transaction so a partial failure rolls back both sides.
   */
  async composeApprovalTemplateWithForm(
    input: ComposeApprovalTemplateWithFormInput,
    currentMemberId: string | null,
  ): Promise<ComposeApprovalTemplateWithFormObject> {
    const { event, result } = await this.templateRepository.manager.transaction(
      async (
        manager,
      ): Promise<{
        readonly event: BPMTemplateChangedEvent;
        readonly result: ComposeApprovalTemplateWithFormObject;
      }> => {
        const formDefinitionVersion = await this.resolveComposedFormVersion(
          manager,
          input,
          currentMemberId,
        );
        const templateDraftVersion =
          await this.resolveComposedTemplateDraftVersion(
            manager,
            input,
            currentMemberId,
          );

        let templateVersion = await this.updateApprovalTemplateDraft(
          {
            formDefinitionVersionId: formDefinitionVersion.id,
            initiatorPolicyCel: input.initiatorPolicyCel,
            notificationConfigJson: input.notificationConfigJson,
            slaDefaultsJson: input.slaDefaultsJson,
            versionId: templateDraftVersion.id,
            workflowDefinitionJson: input.workflowDefinitionJson,
          },
          manager,
        );
        let previousVersionId: string | null = null;

        if (input.publish) {
          const published = await this.publishVersion(
            templateDraftVersion.id,
            currentMemberId ?? undefined,
            manager,
          );

          previousVersionId = published.previousVersionId;
          templateVersion = published.version;
        }

        const formDefinition = await manager
          .getRepository(FormDefinitionEntity)
          .findOneByOrFail({ id: formDefinitionVersion.formDefinitionId });
        const template = await manager
          .getRepository(ApprovalTemplateEntity)
          .findOneByOrFail({ id: templateVersion.templateId });

        return {
          event: {
            action: BPMTemplateChangeActionEnum.COMPOSED,
            actorMemberId: currentMemberId,
            previousVersionId: input.publish
              ? previousVersionId
              : template.currentVersionId,
            published: input.publish,
            template,
            version: templateVersion,
          },
          result: {
            formDefinition,
            formDefinitionVersion,
            published: input.publish,
            template,
            templateVersion,
          },
        };
      },
    );

    await this.notifyTemplateObserver(event);

    return result;
  }

  private async resolveComposedFormVersion(
    manager: EntityManager,
    input: ComposeApprovalTemplateWithFormInput,
    currentMemberId: string | null,
  ): Promise<FormDefinitionVersionEntity> {
    if (!input.formDefinitionId) {
      const definition = await this.formService.createFormDefinition(
        {
          createdByMemberId: currentMemberId,
          description: input.formDescription,
          name: input.formName,
          schemaJson: input.schemaJson,
          uiSchemaJson: input.uiSchemaJson,
        },
        manager,
      );
      const draft = await this.formService.findDraftVersion(
        definition.id,
        manager,
      );

      if (!draft) {
        throw new NotFoundException(
          `Form definition ${definition.id} draft version was not created`,
        );
      }

      return input.publish
        ? this.formService.publishFormDefinitionVersion(
            draft.id,
            currentMemberId ?? undefined,
            manager,
          )
        : draft;
    }

    const existingDraft = await this.formService.findDraftVersion(
      input.formDefinitionId,
      manager,
    );

    if (existingDraft) {
      const updated = await this.formService.updateFormDefinitionDraft(
        {
          schemaJson: input.schemaJson ?? '',
          uiSchemaJson: input.uiSchemaJson ?? '',
          versionId: existingDraft.id,
        },
        manager,
      );

      return input.publish
        ? this.formService.publishFormDefinitionVersion(
            updated.id,
            currentMemberId ?? undefined,
            manager,
          )
        : updated;
    }

    // Published definitions no longer keep a parallel draft: edits publish a
    // new version immediately (content-identical saves reuse the current
    // version) so the template draft can bind a published form version.
    return this.formService.publishFormDefinitionContent(
      {
        formDefinitionId: input.formDefinitionId,
        schemaJson: input.schemaJson,
        uiSchemaJson: input.uiSchemaJson,
      },
      currentMemberId ?? undefined,
      manager,
    );
  }

  private async resolveComposedTemplateDraftVersion(
    manager: EntityManager,
    input: ComposeApprovalTemplateWithFormInput,
    currentMemberId: string | null,
  ): Promise<ApprovalTemplateVersionEntity> {
    if (!input.templateId) {
      const template = await this.createApprovalTemplate(
        {
          category: input.category,
          categoryId: input.categoryId,
          createdByMemberId: currentMemberId,
          description: input.templateDescription,
          formDefinitionVersionId: null,
          name: input.templateName,
        },
        manager,
      );
      const draft = await this.findDraftTemplateVersion(template.id, manager);

      if (!draft) {
        throw new NotFoundException(
          `Approval template ${template.id} draft version was not created`,
        );
      }

      return draft;
    }

    return (
      (await this.findDraftTemplateVersion(input.templateId, manager)) ??
      (await this.forkApprovalTemplate(input.templateId, manager))
    );
  }

  private async findDraftTemplateVersion(
    templateId: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity | null> {
    return this.templateVersions(manager).findOne({
      where: {
        status: ApprovalTemplateVersionStatusEnum.DRAFT,
        templateId,
      },
    });
  }

  async updateApprovalTemplate(
    input: UpdateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    const existing = await this.getTemplateOrThrow(input.id);
    const category =
      input.categoryId === undefined
        ? undefined
        : await this.validateOptionalTemplateCategory(input.categoryId);
    const next = this.templateRepository.merge(existing, {
      category:
        input.category !== undefined
          ? input.category
          : category !== undefined
            ? (category?.name ?? null)
            : existing.category,
      description: input.description ?? existing.description,
      name: input.name ?? existing.name,
    });

    // Assigned outside `merge` because the relation, not the `categoryId`
    // scalar, owns `category_id`. Leaving `categoryDetail` untouched when the
    // caller omitted `categoryId` keeps the loaded relation, which persists
    // the current category unchanged.
    if (category !== undefined) {
      next.categoryDetail = category;
    }

    await this.templateRepository.save(next);

    // Re-read rather than returning the saved entity: `categoryId` is not
    // written by `save()` any more, so the in-memory copy would still carry
    // the previous category alongside the new `categoryDetail` — the same
    // disagreement this change exists to remove, just moved to the response.
    return this.getTemplateOrThrow(input.id);
  }

  async listApprovalTemplates(
    options: ListApprovalTemplatesOptions = {},
  ): Promise<readonly ApprovalTemplateEntity[]> {
    const isPaginated =
      typeof options.page === 'number' || typeof options.pageSize === 'number';
    const normalizedPageSize = isPaginated
      ? normalizePageSize(options.pageSize ?? 10)
      : undefined;

    return this.templateRepository.find({
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
      relations: { categoryDetail: true },
      ...(normalizedPageSize
        ? {
            skip: (normalizePage(options.page ?? 1) - 1) * normalizedPageSize,
            take: normalizedPageSize,
          }
        : {}),
      where: createApprovalTemplateWhere({
        activationStatus: options.activationStatus,
        categoryId: options.categoryId,
        searchText: options.searchText,
        status: options.status,
      }),
    });
  }

  async countApprovalTemplates({
    activationStatus,
    categoryId,
    searchText,
    status,
  }: {
    readonly activationStatus?: ApprovalTemplateActivationStatusEnum;
    readonly categoryId?: string;
    readonly searchText?: string;
    readonly status?: ApprovalTemplateListStatusEnum;
  } = {}): Promise<number> {
    return this.templateRepository.count({
      where: createApprovalTemplateWhere({
        activationStatus,
        categoryId,
        searchText,
        status,
      }),
    });
  }

  async getApprovalTemplate(id: string): Promise<ApprovalTemplateEntity> {
    return this.getTemplateOrThrow(id);
  }

  async activateApprovalTemplate(id: string): Promise<ApprovalTemplateEntity> {
    return this.setApprovalTemplateActive(id, true);
  }

  async deactivateApprovalTemplate(
    id: string,
  ): Promise<ApprovalTemplateEntity> {
    return this.setApprovalTemplateActive(id, false);
  }

  async listApprovalTemplateCategories(
    options: ListApprovalTemplateCategoriesOptions = {},
  ): Promise<readonly ApprovalTemplateCategoryEntity[]> {
    const isPaginated =
      typeof options.page === 'number' || typeof options.pageSize === 'number';
    const normalizedPageSize = isPaginated
      ? normalizePageSize(options.pageSize ?? 10)
      : undefined;

    return this.templateCategoryRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC', createdAt: 'ASC' },
      ...(normalizedPageSize
        ? {
            skip: (normalizePage(options.page ?? 1) - 1) * normalizedPageSize,
            take: normalizedPageSize,
          }
        : {}),
      where: createApprovalTemplateCategoryWhere({
        searchText: options.searchText,
        status: options.status,
      }),
    });
  }

  async countApprovalTemplateCategories({
    searchText,
    status,
  }: {
    readonly searchText?: string;
    readonly status?: ApprovalTemplateCategoryStatusEnum;
  } = {}): Promise<number> {
    return this.templateCategoryRepository.count({
      where: createApprovalTemplateCategoryWhere({ searchText, status }),
    });
  }

  async createApprovalTemplateCategory(
    input: CreateApprovalTemplateCategoryInput,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateCategoryRepository.save(
      this.templateCategoryRepository.create({
        description: input.description,
        isActive: input.isActive ?? true,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      }),
    );
  }

  async updateApprovalTemplateCategory(
    input: UpdateApprovalTemplateCategoryInput,
  ): Promise<ApprovalTemplateCategoryEntity> {
    const existing = await this.getTemplateCategoryOrThrow(input.id);

    return this.templateCategoryRepository.save(
      this.templateCategoryRepository.merge(existing, {
        description: input.description ?? existing.description,
        isActive: input.isActive ?? existing.isActive,
        name: input.name ?? existing.name,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      }),
    );
  }

  async activateApprovalTemplateCategory(
    id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.setApprovalTemplateCategoryActive(id, true);
  }

  async deactivateApprovalTemplateCategory(
    id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.setApprovalTemplateCategoryActive(id, false);
  }

  async deleteApprovalTemplateCategory(
    id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    const category = await this.getTemplateCategoryOrThrow(id);
    const templateCount = await this.templateRepository.count({
      where: { categoryId: id, deletedAt: IsNull() },
    });

    // Deleting a referenced category used to quietly turn into a
    // *deactivation* and report success, so a caller could not tell that the
    // operation it asked for had not happened — and that `isActive` had been
    // flipped as a side effect it never requested. Deactivation is already
    // reachable on its own through `deactivateApprovalTemplateCategory`, so
    // refusing here costs no capability.
    if (templateCount > 0) {
      throw new BadRequestException(
        `Approval template category ${id} is still referenced by ${templateCount} template(s) and cannot be deleted`,
      );
    }

    await this.templateCategoryRepository.remove(category);

    return category;
  }

  async listApprovalTemplateVersions(
    templateId: string,
  ): Promise<readonly ApprovalTemplateVersionEntity[]> {
    await this.getTemplateOrThrow(templateId);

    return this.templateVersionRepository.find({
      order: { version: 'DESC' },
      where: { templateId },
    });
  }

  async getApprovalTemplateVersion(
    id: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.getTemplateVersionOrThrow(id);
  }

  async updateApprovalTemplateDraft(
    input: UpdateApprovalTemplateDraftInput,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    const versionRepository = this.templateVersions(manager);
    const existing = await this.getTemplateVersionOrThrow(
      input.versionId,
      manager,
    );

    if (existing.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft approval template versions can be updated',
      );
    }

    await this.validateOptionalFormDefinitionVersion(
      input.formDefinitionVersionId,
      manager,
    );
    const workflowDefinition = this.parseWorkflowDefinitionOrThrow(
      input.workflowDefinitionJson,
    );
    const next = versionRepository.merge(existing, {
      formDefinitionVersionId: input.formDefinitionVersionId,
      initiatorPolicyCel: input.initiatorPolicyCel,
      notificationConfig: parseOptionalJsonObject(input.notificationConfigJson),
      slaDefaults: parseOptionalJsonObject(input.slaDefaultsJson),
      workflowDefinition,
    });

    return versionRepository.save(next);
  }

  async forkApprovalTemplate(
    templateId: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    const versionRepository = this.templateVersions(manager);
    const template = await this.getTemplateOrThrow(templateId, manager);
    const existingDraft = await versionRepository.findOne({
      where: {
        status: ApprovalTemplateVersionStatusEnum.DRAFT,
        templateId: template.id,
      },
    });

    if (existingDraft) {
      throw new ConflictException(
        'A draft approval template version already exists',
      );
    }

    const source = template.currentVersionId
      ? await this.getTemplateVersionOrThrow(template.currentVersionId, manager)
      : null;
    const nextVersion = await this.readNextVersionNumber(template.id, manager);

    return versionRepository.save(
      versionRepository.create({
        archivedAt: null,
        formDefinitionVersionId: source?.formDefinitionVersionId ?? null,
        initiatorPolicyCel: source?.initiatorPolicyCel ?? null,
        notificationConfig: source?.notificationConfig ?? null,
        publishedAt: null,
        publishedByMemberId: null,
        slaDefaults: source?.slaDefaults ?? null,
        status: ApprovalTemplateVersionStatusEnum.DRAFT,
        templateId: template.id,
        version: nextVersion,
        workflowDefinition:
          source?.workflowDefinition ?? EMPTY_WORKFLOW_DEFINITION,
      }),
    );
  }

  async publishApprovalTemplateVersion(
    versionId: string,
    publishedByMemberId?: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    const published = await this.publishVersion(
      versionId,
      publishedByMemberId,
      manager,
    );

    await this.notifyTemplateObserver({
      action: BPMTemplateChangeActionEnum.VERSION_PUBLISHED,
      actorMemberId: publishedByMemberId ?? null,
      previousVersionId: published.previousVersionId,
      published: true,
      template: published.template,
      version: published.version,
      ...(manager ? { manager } : {}),
    });

    return published.version;
  }

  /**
   * The publish itself, without the observer notification. Split out so
   * `composeApprovalTemplateWithForm` can publish inside its own transaction
   * and still report a single `COMPOSED` event rather than two.
   */
  private async publishVersion(
    versionId: string,
    publishedByMemberId?: string,
    manager?: EntityManager,
  ): Promise<PublishedVersionResult> {
    const version = await this.getTemplateVersionOrThrow(versionId, manager);

    if (version.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft approval template versions can be published',
      );
    }

    await this.validatePublishableVersion(version, manager);

    const run = (txManager: EntityManager): Promise<PublishedVersionResult> =>
      this.publishApprovalTemplateVersionWithManager(
        txManager,
        version,
        publishedByMemberId,
      );

    return manager
      ? run(manager)
      : this.templateRepository.manager.transaction(run);
  }

  private async publishApprovalTemplateVersionWithManager(
    manager: EntityManager,
    version: ApprovalTemplateVersionEntity,
    publishedByMemberId?: string,
  ): Promise<PublishedVersionResult> {
    const templateRepository = manager.getRepository(ApprovalTemplateEntity);
    const versionRepository = manager.getRepository(
      ApprovalTemplateVersionEntity,
    );
    const template = await templateRepository.findOne({
      where: { deletedAt: IsNull(), id: version.templateId },
    });

    if (!template) {
      throw new NotFoundException(
        `Approval template ${version.templateId} was not found`,
      );
    }

    // Same refusal the workflow engine applies when starting or advancing an
    // instance: a deactivated template must not gain a new published version
    // behind the host's back.
    if (!template.isActive) {
      throw new ConflictException('Approval template is deactivated');
    }

    const previousVersionId = template.currentVersionId;

    if (template.currentVersionId) {
      await versionRepository.update(
        { id: template.currentVersionId },
        {
          archivedAt: new Date(),
          status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
        },
      );
    }

    const published = versionRepository.merge(version, {
      archivedAt: null,
      publishedAt: new Date(),
      publishedByMemberId: publishedByMemberId ?? null,
      status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const saved = await versionRepository.save(published);
    const savedTemplate = await templateRepository.save(
      templateRepository.merge(template, {
        currentVersionId: saved.id,
      }),
    );

    return {
      previousVersionId,
      template: savedTemplate,
      version: saved,
    };
  }

  async rollbackApprovalTemplateVersion(
    versionId: string,
    rolledBackByMemberId?: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const target = await this.getTemplateVersionOrThrow(versionId);

    if (target.status === ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Draft approval template versions cannot be rollback targets',
      );
    }

    const rolledBack = await this.templateRepository.manager.transaction(
      async (manager): Promise<PublishedVersionResult> => {
        const templateRepository = manager.getRepository(
          ApprovalTemplateEntity,
        );
        const versionRepository = manager.getRepository(
          ApprovalTemplateVersionEntity,
        );
        const template = await templateRepository.findOne({
          where: { deletedAt: IsNull(), id: target.templateId },
        });

        if (!template) {
          throw new NotFoundException(
            `Approval template ${target.templateId} was not found`,
          );
        }

        // See `publishApprovalTemplateVersionWithManager`: rolling back moves
        // the published pointer, which a deactivated template must not do.
        if (!template.isActive) {
          throw new ConflictException('Approval template is deactivated');
        }

        const previousVersionId = template.currentVersionId;

        if (
          template.currentVersionId &&
          template.currentVersionId !== target.id
        ) {
          await versionRepository.update(
            { id: template.currentVersionId },
            {
              archivedAt: new Date(),
              status: ApprovalTemplateVersionStatusEnum.ARCHIVED,
            },
          );
        }

        const restored = versionRepository.merge(target, {
          archivedAt: null,
          status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });
        const saved = await versionRepository.save(restored);
        const savedTemplate = await templateRepository.save(
          templateRepository.merge(template, {
            currentVersionId: saved.id,
          }),
        );

        return {
          previousVersionId,
          template: savedTemplate,
          version: saved,
        };
      },
    );

    await this.notifyTemplateObserver({
      action: BPMTemplateChangeActionEnum.VERSION_ROLLED_BACK,
      actorMemberId: rolledBackByMemberId ?? null,
      previousVersionId: rolledBack.previousVersionId,
      published: true,
      template: rolledBack.template,
      version: rolledBack.version,
    });

    return rolledBack.version;
  }

  /**
   * Tells a host-provided observer that a template changed. Errors are logged
   * and dropped: an audit-trail hook must not be able to fail the mutation it
   * is observing.
   */
  private async notifyTemplateObserver(
    event: BPMTemplateChangedEvent,
  ): Promise<void> {
    const observer = this.readHostObserver();

    if (!observer) {
      return;
    }

    try {
      await observer.onTemplateChanged(event);
    } catch (error: unknown) {
      this.logger.error(
        `BPM_TEMPLATE_OBSERVER failed for ${event.action} on template ${event.template.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private readHostObserver(): BPMTemplateObserver | null {
    try {
      return this.moduleRef.get(BPM_TEMPLATE_OBSERVER, { strict: false });
    } catch {
      return null;
    }
  }

  private async validatePublishableVersion(
    version: ApprovalTemplateVersionEntity,
    manager?: EntityManager,
  ): Promise<void> {
    if (!version.formDefinitionVersionId) {
      throw new BadRequestException(
        'Approval template version must bind a form definition version before publishing',
      );
    }

    const formVersion = await this.formVersions(manager).findOne({
      where: { id: version.formDefinitionVersionId },
    });

    if (!formVersion) {
      throw new NotFoundException(
        `Form definition version ${version.formDefinitionVersionId} was not found`,
      );
    }

    if (formVersion.status !== FormDefinitionVersionStatusEnum.PUBLISHED) {
      throw new BadRequestException(
        'Approval template can only bind a published form definition version',
      );
    }

    const workflowResult = lintWorkflowDefinition(version.workflowDefinition);
    const conditionErrors = this.conditionService.lintExpressions(
      readConditionExpressions(
        version.workflowDefinition,
        version.initiatorPolicyCel,
      ),
      {
        allowedRootIdentifiers: [
          'env',
          'form',
          'formData',
          'initiator',
          'instance',
          'subject',
        ],
      },
    );
    const tableReferenceErrors = lintWorkflowTableReferences(
      version.workflowDefinition,
      version.initiatorPolicyCel,
      formVersion.schema,
    );
    const errors = [
      ...workflowResult.errors,
      ...conditionErrors,
      ...tableReferenceErrors,
    ];

    if (errors.length) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private async validateOptionalFormDefinitionVersion(
    formDefinitionVersionId: string | null | undefined,
    manager?: EntityManager,
  ): Promise<void> {
    if (!formDefinitionVersionId) {
      return;
    }

    const formVersion = await this.formVersions(manager).findOne({
      where: { id: formDefinitionVersionId },
    });

    if (!formVersion) {
      throw new NotFoundException(
        `Form definition version ${formDefinitionVersionId} was not found`,
      );
    }
  }

  private async validateOptionalTemplateCategory(
    categoryId: string | null | undefined,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateCategoryEntity | null> {
    if (!categoryId) {
      return null;
    }

    return this.getTemplateCategoryOrThrow(categoryId, manager);
  }

  private templates(
    manager?: EntityManager,
  ): Repository<ApprovalTemplateEntity> {
    return manager
      ? manager.getRepository(ApprovalTemplateEntity)
      : this.templateRepository;
  }

  private templateVersions(
    manager?: EntityManager,
  ): Repository<ApprovalTemplateVersionEntity> {
    return manager
      ? manager.getRepository(ApprovalTemplateVersionEntity)
      : this.templateVersionRepository;
  }

  private templateCategories(
    manager?: EntityManager,
  ): Repository<ApprovalTemplateCategoryEntity> {
    return manager
      ? manager.getRepository(ApprovalTemplateCategoryEntity)
      : this.templateCategoryRepository;
  }

  private formVersions(
    manager?: EntityManager,
  ): Repository<FormDefinitionVersionEntity> {
    return manager
      ? manager.getRepository(FormDefinitionVersionEntity)
      : this.formDefinitionVersionRepository;
  }

  private async getTemplateOrThrow(
    id: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateEntity> {
    const entity = await this.templates(manager).findOne({
      relations: { categoryDetail: true },
      where: { deletedAt: IsNull(), id },
    });

    if (!entity) {
      throw new NotFoundException(`Approval template ${id} was not found`);
    }

    return entity;
  }

  private async getTemplateCategoryOrThrow(
    id: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateCategoryEntity> {
    const entity = await this.templateCategories(manager).findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(
        `Approval template category ${id} was not found`,
      );
    }

    return entity;
  }

  private async setApprovalTemplateActive(
    id: string,
    isActive: boolean,
  ): Promise<ApprovalTemplateEntity> {
    const template = await this.getTemplateOrThrow(id);

    return this.templateRepository.save(
      this.templateRepository.merge(template, {
        isActive,
      }),
    );
  }

  private async setApprovalTemplateCategoryActive(
    id: string,
    isActive: boolean,
  ): Promise<ApprovalTemplateCategoryEntity> {
    const category = await this.getTemplateCategoryOrThrow(id);

    return this.templateCategoryRepository.save(
      this.templateCategoryRepository.merge(category, {
        isActive,
      }),
    );
  }

  private async getTemplateVersionOrThrow(
    id: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    const entity = await this.templateVersions(manager).findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(
        `Approval template version ${id} was not found`,
      );
    }

    return entity;
  }

  private async readNextVersionNumber(
    templateId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const row = await this.templateVersions(manager)
      .createQueryBuilder('version')
      .select('MAX(version.version)', 'maxVersion')
      .where('version.template_id = :templateId', { templateId })
      .getRawOne<MaxVersionRow>();
    const maxVersion =
      typeof row?.maxVersion === 'number'
        ? row.maxVersion
        : Number(row?.maxVersion ?? 0);

    return maxVersion + 1;
  }

  private parseWorkflowDefinitionOrThrow(value: string): WorkflowDefinition {
    try {
      return parseWorkflowDefinitionJson(value);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid workflow definition',
      );
    }
  }
}

function parseOptionalJsonObject(
  value: string | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!value) {
    return null;
  }

  const parsedValue = parseJson(value);

  if (!isRecord(parsedValue)) {
    throw new BadRequestException('JSON value must be an object');
  }

  return parsedValue;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid JSON value',
    );
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

function createApprovalTemplateWhere(
  options: Readonly<{
    readonly activationStatus?: ApprovalTemplateActivationStatusEnum;
    readonly categoryId?: string;
    readonly searchText?: string;
    readonly status?: ApprovalTemplateListStatusEnum;
  }>,
):
  | FindOptionsWhere<ApprovalTemplateEntity>
  | FindOptionsWhere<ApprovalTemplateEntity>[] {
  const activeTemplateWhere: FindOptionsWhere<ApprovalTemplateEntity> = {
    deletedAt: IsNull(),
  };
  // Administrative activation is orthogonal to the version-derived publication
  // status, so an omitted filter keeps both active and deactivated templates.
  const activationWhere: FindOptionsWhere<ApprovalTemplateEntity> =
    options.activationStatus === ApprovalTemplateActivationStatusEnum.ACTIVE
      ? { isActive: true }
      : options.activationStatus ===
          ApprovalTemplateActivationStatusEnum.INACTIVE
        ? { isActive: false }
        : {};
  const statusWhere: FindOptionsWhere<ApprovalTemplateEntity> =
    options.status === ApprovalTemplateListStatusEnum.DRAFT
      ? { currentVersionId: IsNull() }
      : {};
  const publicationWhere: FindOptionsWhere<ApprovalTemplateEntity> =
    options.status === ApprovalTemplateListStatusEnum.PUBLISHED
      ? { currentVersionId: Not(IsNull()) }
      : {};
  const baseWhere: FindOptionsWhere<ApprovalTemplateEntity> = {
    ...activeTemplateWhere,
    ...activationWhere,
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...statusWhere,
    ...publicationWhere,
  };

  const trimmedSearchText = options.searchText?.trim();

  if (!trimmedSearchText) {
    return baseWhere;
  }

  const searchPattern = `%${trimmedSearchText}%`;

  return [
    { ...baseWhere, name: ILike(searchPattern) },
    { ...baseWhere, category: ILike(searchPattern) },
    { ...baseWhere, description: ILike(searchPattern) },
  ];
}

function createApprovalTemplateCategoryWhere(
  options: Readonly<{
    readonly searchText?: string;
    readonly status?: ApprovalTemplateCategoryStatusEnum;
  }>,
):
  | FindOptionsWhere<ApprovalTemplateCategoryEntity>
  | FindOptionsWhere<ApprovalTemplateCategoryEntity>[] {
  const statusWhere: FindOptionsWhere<ApprovalTemplateCategoryEntity> =
    options.status === ApprovalTemplateCategoryStatusEnum.ALL
      ? {}
      : options.status === ApprovalTemplateCategoryStatusEnum.INACTIVE
        ? { isActive: false }
        : { isActive: true };
  const trimmedSearchText = options.searchText?.trim();

  if (!trimmedSearchText) {
    return statusWhere;
  }

  const searchPattern = `%${trimmedSearchText}%`;

  return [
    { ...statusWhere, name: ILike(searchPattern) },
    { ...statusWhere, description: ILike(searchPattern) },
  ];
}

/**
 * The workflow half of the "conditions must not address table internals" ban
 * (ADR 16 §3.8). The form schema half — `visibleWhen` and friends — is enforced
 * by the form schema lint; this covers the structured edge condition, which
 * carries a plain field key, and every CEL expression the workflow can hold.
 *
 * Neither the CEL root-identifier lint nor the structured evaluator would
 * report these on its own: `form.items[0].qty` has a legal root identifier and
 * a `conditionFieldKey` of `items.qty` simply resolves to `undefined` at
 * runtime. Both would fail silently rather than loudly.
 */
function lintWorkflowTableReferences(
  definition: WorkflowDefinition,
  initiatorPolicyCel: string | null,
  schema: FormDefinitionSchema | null,
): readonly string[] {
  const tableFieldKeys = readTableFieldKeys(schema);

  if (!tableFieldKeys.size) {
    return [];
  }

  const expressionErrors = readConditionExpressions(
    definition,
    initiatorPolicyCel,
  ).flatMap(({ expression, label }) =>
    typeof expression === 'string'
      ? [...tableFieldKeys]
          .filter((tableKey) => referencesTableInternals(expression, tableKey))
          .map(
            (tableKey) =>
              `${label} must not reference table field internals: ${tableKey}`,
          )
      : [],
  );
  const structuredErrors = definition.edges
    .filter(
      (edge) =>
        typeof edge.data.conditionFieldKey === 'string' &&
        isTableInternalFieldKey(edge.data.conditionFieldKey, tableFieldKeys),
    )
    .map(
      (edge) =>
        `workflow.edges.${edge.id}.data.conditionFieldKey must not reference table field internals: ${edge.data.conditionFieldKey}`,
    );

  return [...expressionErrors, ...structuredErrors];
}

function readConditionExpressions(
  definition: WorkflowDefinition,
  initiatorPolicyCel: string | null,
): readonly {
  readonly expression: string | null | undefined;
  readonly label: string;
}[] {
  return [
    { expression: initiatorPolicyCel, label: 'initiatorPolicyCel' },
    ...definition.edges.map((edge) => ({
      expression: edge.data.condition,
      label: `workflow.edges.${edge.id}.data.condition`,
    })),
    ...definition.nodes.flatMap((node) => {
      if (node.type === 'userTask') {
        return [
          {
            expression: node.data.entryCondition,
            label: `workflow.nodes.${node.id}.data.entryCondition`,
          },
          ...(node.data.approverResolver.type === 'EXPRESSION'
            ? [
                {
                  expression: node.data.approverResolver.expression,
                  label: `workflow.nodes.${node.id}.data.approverResolver.expression`,
                },
              ]
            : []),
        ];
      }

      if (node.type === 'serviceTask') {
        return [
          {
            expression: node.data.entryCondition,
            label: `workflow.nodes.${node.id}.data.entryCondition`,
          },
          ...(node.data.action.type === 'WEBHOOK'
            ? [
                {
                  expression: node.data.action.payload,
                  label: `workflow.nodes.${node.id}.data.action.payload`,
                },
              ]
            : []),
          ...(node.data.action.type === 'SET_FORM_FIELD'
            ? [
                {
                  expression: node.data.action.value,
                  label: `workflow.nodes.${node.id}.data.action.value`,
                },
              ]
            : []),
        ];
      }

      return [];
    }),
  ];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
