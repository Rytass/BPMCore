import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ExpressionUsagePoint,
  formatExpressionLintIssue,
  readApproverFilledFieldKeys,
  readFormFieldAccessIssues,
  readFormFieldPathTopLevelKey,
  readNodeFillableFieldKeys,
  readReachableWorkflowNodeIds,
  readTopLevelFieldKey,
} from '@rytass/bpm-core-shared';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isMemberFieldDefinition,
  isOrgUnitFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  ApproverResolver,
  ServiceAction,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  readExcludeNodeActorsIssues,
  readNodeActorSourceIssues,
  readSingleApproverSourceIssues,
  WORKFLOW_EXPRESSION_LABELS,
  WORKFLOW_LINT_MESSAGES,
} from '@rytass/bpm-core-shared/workflow-graph';
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
  DEFAULT_EXPRESSION_DIALECT,
  ExpressionDialect,
  isExpressionDialect,
} from '../condition/expression-dialect';
import {
  ExpressionReferences,
  readExpressionHostFunctionNames,
  readExpressionReferences,
  readUnavailableExpressionFunctions,
  readsFormField,
  readsTableInternals,
  RESERVED_PATH_SEGMENTS,
} from '../condition/expression-ast';
import {
  BPM_EXPRESSION_FUNCTION_REGISTRY,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import {
  isTableInternalFieldKey,
  readTableFieldKeys,
  referencesFormField,
  referencesTableInternals,
} from '../form/form-table-reference';
import { FormDefinitionEntity } from '../form/form-definition.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { FormService } from '../form/form.service';
import { lintWorkflowWebhookTargets } from '../workflow-webhook/workflow-webhook.validator';
import { WorkflowWebhookService } from '../workflow-webhook/workflow-webhook.service';
import { assertTemplateFilterableFieldsEnabled } from './filterable-field-guard';
import {
  normalizeTemplateKey,
  translateTemplateKeyConflict,
} from './template-key';
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
  ApprovalTemplateLaunchModeEnum,
  ApprovalTemplateListStatusEnum,
  ApprovalTemplateVersionStatusEnum,
} from './template.enums';
import {
  EMPTY_WORKFLOW_DEFINITION,
  NEW_TEMPLATE_WORKFLOW_DEFINITION,
  lintWorkflowDefinition,
  parseWorkflowDefinitionJson,
} from './workflow-definition.validator';

// The roots each kind of expression is evaluated with, so publish refuses an
// expression that could only fail at run time. Initiator policies run before
// an instance exists (workflow-engine `buildInitiatorPolicyContext`); every
// other workflow expression runs against the instance
// (`buildWorkflowExpressionContext`), and edge conditions also see the last
// decision on the node they leave.
const INITIATOR_POLICY_ROOT_IDENTIFIERS: readonly string[] = [
  'env',
  'initiator',
  'subject',
];
const WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS: readonly string[] = [
  'env',
  'form',
  'formData',
  'initiator',
  'instance',
];

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
    // The same registry `ConditionService` evaluates and lints with. Without
    // one only the nine built-in functions exist, so a template calling a host
    // function cannot be published or rolled back to.
    @Optional()
    @Inject(BPM_EXPRESSION_FUNCTION_REGISTRY)
    private readonly expressionFunctionRegistry?: BPMExpressionFunctionRegistry | null,
  ) {}

  async createApprovalTemplate(
    input: CreateApprovalTemplateInput,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateEntity> {
    const run = (txManager: EntityManager): Promise<ApprovalTemplateEntity> =>
      this.createApprovalTemplateWithManager(txManager, input);

    return manager
      ? run(manager)
      : translateTemplateKeyConflict(
          this.templateRepository.manager.transaction(run),
        );
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
        key: normalizeTemplateKey(input.key),
        name: input.name,
      }),
    );

    await versionRepository.save(
      versionRepository.create({
        archivedAt: null,
        formDefinitionVersionId: input.formDefinitionVersionId,
        initiatorPolicyCel: null,
        launchMode: ApprovalTemplateLaunchModeEnum.OPEN,
        notificationConfig: null,
        publishedAt: null,
        publishedByMemberId: null,
        slaDefaults: null,
        status: ApprovalTemplateVersionStatusEnum.DRAFT,
        templateId: template.id,
        version: 1,
        workflowDefinition: NEW_TEMPLATE_WORKFLOW_DEFINITION,
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
    // Validated before any lock is taken. `undefined` keeps the stored key.
    const key =
      input.key === undefined ? undefined : normalizeTemplateKey(input.key);
    const templateKey = normalizeTemplateKey(input.templateKey);

    if (key !== undefined && templateKey !== null && key !== templateKey) {
      throw new BadRequestException(
        'key and templateKey must match when both are given',
      );
    }

    // The key the template row ends up with. `templateKey` names the template
    // when `templateId` is absent, so it is also the key written on create.
    const writtenKey = key !== undefined ? key : (templateKey ?? undefined);

    const { event, result } = await translateTemplateKeyConflict(
      this.templateRepository.manager.transaction(
        async (
          manager,
        ): Promise<{
          readonly event: BPMTemplateChangedEvent;
          readonly result: ComposeApprovalTemplateWithFormObject;
        }> => {
          // ADR 25 §15: an existing template's row is locked before anything
          // else, so this compose takes the template lock before it forks or
          // writes the draft row, the same order a standalone publish uses.
          // Taking it later (after the draft write, inside publishVersion) let a
          // concurrent publish of the same draft deadlock against this one.
          // ADR 27 §6.2: without a templateId, a live template holding the
          // templateKey is versioned instead of creating a second one. Soft-
          // deleted rows are skipped, so their key is free again.
          const keyed =
            templateKey === null
              ? null
              : await manager.getRepository(ApprovalTemplateEntity).findOne({
                  where: { deletedAt: IsNull(), key: templateKey },
                });

          if (input.templateId && keyed && keyed.id !== input.templateId) {
            throw new BadRequestException(
              'templateId and templateKey point at different templates',
            );
          }

          const targetTemplateId = input.templateId ?? keyed?.id ?? null;

          if (targetTemplateId) {
            const locked = await this.readLockedTemplateOrThrow(
              manager,
              targetTemplateId,
            );

            if (writtenKey !== undefined) {
              await manager
                .getRepository(ApprovalTemplateEntity)
                .update({ id: locked.id }, { key: writtenKey });
            }
          }

          const formDefinitionVersion = await this.resolveComposedFormVersion(
            manager,
            input,
            currentMemberId,
          );
          const templateDraftVersion =
            await this.resolveComposedTemplateDraftVersion(
              manager,
              input,
              targetTemplateId,
              writtenKey,
              currentMemberId,
            );

          let templateVersion = await this.updateApprovalTemplateDraft(
            {
              formDefinitionVersionId: formDefinitionVersion.id,
              initiatorPolicyCel: input.initiatorPolicyCel,
              launchMode: input.launchMode ?? null,
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
      ),
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
    templateId: string | null,
    key: string | null | undefined,
    currentMemberId: string | null,
  ): Promise<ApprovalTemplateVersionEntity> {
    if (!templateId) {
      const template = await this.createApprovalTemplate(
        {
          category: input.category,
          categoryId: input.categoryId,
          createdByMemberId: currentMemberId,
          description: input.templateDescription,
          formDefinitionVersionId: null,
          key,
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
      (await this.findDraftTemplateVersion(templateId, manager)) ??
      (await this.forkApprovalTemplate(templateId, manager))
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
    const category =
      input.categoryId === undefined
        ? undefined
        : await this.validateOptionalTemplateCategory(input.categoryId);
    // Validated before the lock is taken. `undefined` keeps the stored key.
    const key =
      input.key === undefined ? undefined : normalizeTemplateKey(input.key);

    await translateTemplateKeyConflict(
      this.templateRepository.manager.transaction(
        async (manager): Promise<void> => {
          const existing = await this.readLockedTemplateOrThrow(
            manager,
            input.id,
          );
          const templates = manager.getRepository(ApprovalTemplateEntity);
          const next = templates.merge(existing, {
            category:
              input.category !== undefined
                ? input.category
                : category !== undefined
                  ? (category?.name ?? null)
                  : existing.category,
            description: input.description ?? existing.description,
            key: key !== undefined ? key : existing.key,
            name: input.name ?? existing.name,
          });

          // Assigned outside `merge` because the relation, not the `categoryId`
          // scalar, owns `category_id`. Leaving `categoryDetail` untouched when
          // the caller omitted `categoryId` keeps the loaded relation, which
          // persists the current category unchanged.
          if (category !== undefined) {
            next.categoryDetail = category;
          }

          await templates.save(next);
        },
      ),
    );

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

    // `remove()` clears the primary key on the entity it is handed, and `id` is
    // non-null in the schema — returning it bare failed the mutation *after*
    // the row was already gone. Put the id back for the response.
    await this.templateCategoryRepository.remove(category);

    return Object.assign(category, { id });
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
    return this.runInTemplateTransaction(
      manager,
      async (txManager): Promise<ApprovalTemplateVersionEntity> => {
        const versionRepository = this.templateVersions(txManager);
        // Read once to learn the template, lock its row (ADR 25 §15), then read
        // the draft again: a publish that committed before the lock has turned
        // it PUBLISHED, and saving the copy read before would write the old
        // DRAFT status and empty publish fields back over it.
        const unlocked = await this.getTemplateVersionOrThrow(
          input.versionId,
          txManager,
        );

        await this.readLockedTemplateOrThrow(txManager, unlocked.templateId);

        const existing = await this.getTemplateVersionOrThrow(
          input.versionId,
          txManager,
        );

        if (existing.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
          throw new ConflictException(
            'Only draft approval template versions can be updated',
          );
        }

        await this.validateOptionalFormDefinitionVersion(
          input.formDefinitionVersionId,
          txManager,
        );
        const workflowDefinition = this.parseWorkflowDefinitionOrThrow(
          input.workflowDefinitionJson,
        );
        const next = versionRepository.merge(existing, {
          formDefinitionVersionId: input.formDefinitionVersionId,
          initiatorPolicyCel: input.initiatorPolicyCel,
          // Absent keeps the draft's: a caller that predates the field must
          // not turn a HOST_ONLY draft back to OPEN by saving it.
          launchMode: input.launchMode ?? existing.launchMode,
          notificationConfig: parseOptionalJsonObject(
            input.notificationConfigJson,
          ),
          slaDefaults: parseOptionalJsonObject(input.slaDefaultsJson),
          workflowDefinition,
        });

        return versionRepository.save(next);
      },
    );
  }

  /**
   * Runs `run` in the caller's transaction when one is passed, otherwise in a
   * new one, so a template lock taken inside it is held until the write
   * commits.
   */
  private runInTemplateTransaction<TResult>(
    manager: EntityManager | undefined,
    run: (txManager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    return manager
      ? run(manager)
      : this.templateRepository.manager.transaction(run);
  }

  async forkApprovalTemplate(
    templateId: string,
    manager?: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.runInTemplateTransaction(manager, (txManager) =>
      this.forkApprovalTemplateLocked(templateId, txManager),
    );
  }

  /**
   * Forks under the template row lock (ADR 25 §15): the draft check, the
   * source read and the insert see the template as no concurrent publish or
   * fork can change it until this commits.
   */
  private async forkApprovalTemplateLocked(
    templateId: string,
    manager: EntityManager,
  ): Promise<ApprovalTemplateVersionEntity> {
    const versionRepository = this.templateVersions(manager);
    const template = await this.readLockedTemplateOrThrow(manager, templateId);
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
        launchMode: source?.launchMode ?? ApprovalTemplateLaunchModeEnum.OPEN,
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

    // Early refusals only: they run outside the lock and are repeated below.
    await this.validatePublishableVersion(version, manager);

    // ADR 25 §5.4 and §15: the template row is locked before the enable check
    // and before the draft is read again, so a concurrent form-data write
    // (which takes FOR SHARE on the same row) cannot slip between the check
    // and the commit, and the draft is judged as it is under the lock.
    const run = async (
      txManager: EntityManager,
    ): Promise<PublishedVersionResult> => {
      const lockedTemplate = await this.lockTemplateRow(
        txManager,
        version.templateId,
        'pessimistic_write',
      );

      if (!lockedTemplate) {
        throw new NotFoundException(
          `Approval template ${version.templateId} was not found`,
        );
      }

      const lockedVersion = await this.getTemplateVersionOrThrow(
        versionId,
        txManager,
      );

      if (lockedVersion.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
        throw new ConflictException(
          'Only draft approval template versions can be published',
        );
      }

      const formSchema = await this.validatePublishableVersion(
        lockedVersion,
        txManager,
      );

      return this.publishApprovalTemplateVersionWithManager(
        txManager,
        lockedVersion,
        publishedByMemberId,
        formSchema,
      );
    };

    return manager
      ? run(manager)
      : this.templateRepository.manager.transaction(run);
  }

  /**
   * Reads one template row, optionally locked. Locks are only taken inside a
   * transaction; the caller passes the transaction's manager.
   */
  private async lockTemplateRow(
    manager: EntityManager,
    templateId: string,
    mode: 'pessimistic_read' | 'pessimistic_write',
  ): Promise<ApprovalTemplateEntity | null> {
    return manager.getRepository(ApprovalTemplateEntity).findOne({
      lock: { mode },
      where: { deletedAt: IsNull(), id: templateId },
    });
  }

  private async publishApprovalTemplateVersionWithManager(
    manager: EntityManager,
    version: ApprovalTemplateVersionEntity,
    publishedByMemberId: string | undefined,
    formSchema: FormDefinitionSchema,
  ): Promise<PublishedVersionResult> {
    const templateRepository = manager.getRepository(ApprovalTemplateEntity);
    const versionRepository = manager.getRepository(
      ApprovalTemplateVersionEntity,
    );
    // Already locked by the caller (`publishVersion`); the lock is taken again
    // here so this method is safe on its own, and the lock is re-entrant
    // within one transaction.
    const template = await this.lockTemplateRow(
      manager,
      version.templateId,
      'pessimistic_write',
    );

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

    // ADR 25 §5.4: a field that becomes filterable must not hold values the
    // template's existing instances cannot satisfy. Checked here, inside the
    // publish transaction, so the instances it reads are the ones it archives.
    // Only what this publish makes filterable is scanned (ADR 25 §15).
    await assertTemplateFilterableFieldsEnabled(
      manager,
      template.id,
      formSchema,
      (): Promise<FormDefinitionSchema | null> =>
        this.readInForceFormSchema(manager, template),
    );

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

    // A rollback is a recovery path: the version passed the lint of its day
    // and is not linted again, since a rule tightened since could refuse it
    // (ADR 22 §5, docs/24 §1). The one check is that every function it calls
    // is still registered; without it every case would fail on evaluation.
    // The filterable-field check (ADR 25 §5.4) is the exception: it reads the
    // instances stored now, so it runs again inside the transaction below.
    const unregisteredFunctionErrors = this.lintRegisteredFunctions(
      target.workflowDefinition,
      target.initiatorPolicyCel,
    );

    if (unregisteredFunctionErrors.length) {
      throw new BadRequestException(unregisteredFunctionErrors.join('; '));
    }

    const rolledBack = await this.templateRepository.manager.transaction(
      async (manager): Promise<PublishedVersionResult> => {
        const templateRepository = manager.getRepository(
          ApprovalTemplateEntity,
        );
        const versionRepository = manager.getRepository(
          ApprovalTemplateVersionEntity,
        );
        // ADR 25 §5.4 and §15: lock the template row before the enable check,
        // the same lock a publish takes (see `publishVersion`).
        const template = await this.lockTemplateRow(
          manager,
          target.templateId,
          'pessimistic_write',
        );

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

        // The target becomes the current version again, so its filterable
        // fields are checked against the instances stored now (ADR 25 §5.4).
        await assertTemplateFilterableFieldsEnabled(
          manager,
          template.id,
          await this.readFormSchemaOfVersion(
            manager,
            target.formDefinitionVersionId,
          ),
          (): Promise<FormDefinitionSchema | null> =>
            this.readInForceFormSchema(manager, template),
        );

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

  /**
   * Returns the bound form schema so the publish can run the filterable-field
   * check against it without loading the form version a second time.
   */
  private async validatePublishableVersion(
    version: ApprovalTemplateVersionEntity,
    manager?: EntityManager,
  ): Promise<FormDefinitionSchema> {
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
    // An unknown dialect is refused by `lintWorkflowDefinition`; its
    // expressions are not parsed with a guessed engine.
    const dialect = readPublishDialect(version.workflowDefinition);
    const fieldReader = createExpressionFieldReader(
      dialect ?? DEFAULT_EXPRESSION_DIALECT,
    );
    const conditionErrors =
      dialect === 'cel-v2'
        ? this.lintCelV2Expressions(version, formVersion.schema)
        : dialect === null
          ? []
          : this.lintCelLegacyExpressions(version);
    // ADR 22 §5.5 names no dialect, and a write path is not CEL: its reserved
    // segments are refused in either. That it names a declared field is
    // checked for cel-v2 only (`lintCelV2Expressions`).
    const setFormFieldPathErrors =
      dialect === null
        ? []
        : lintSetFormFieldReservedSegments(version.workflowDefinition);
    const tableReferenceErrors = lintWorkflowTableReferences(
      version.workflowDefinition,
      version.initiatorPolicyCel,
      formVersion.schema,
      fieldReader,
    );
    const memberReferenceErrors = lintWorkflowMemberReferences(
      version.workflowDefinition,
      formVersion.schema,
    );
    const orgUnitReferenceErrors = lintWorkflowOrgUnitReferences(
      version.workflowDefinition,
      formVersion.schema,
    );
    // The graph checks read a sound graph (the publish lint refuses cycles
    // first), and only run once the structural lint passed, so a node whose
    // `nodeIds` it already refused is not reported a second time.
    const nodeActorSourceErrors = workflowResult.valid
      ? lintWorkflowNodeActorSources(version.workflowDefinition)
      : [];
    const excludeNodeActorsErrors = workflowResult.valid
      ? lintWorkflowExcludeNodeActors(version.workflowDefinition)
      : [];
    const approverFilledFieldErrors = readFormFieldAccessIssues(
      version.workflowDefinition,
      formVersion.schema,
    ).map((issue): string => issue.message);
    const approverFilledReadErrors = lintApproverFilledFieldReads(
      version.workflowDefinition,
      fieldReader,
    );
    const webhookErrors = await this.lintWorkflowWebhooks(
      version.workflowDefinition,
      formVersion.schema,
    );
    const errors = [
      ...workflowResult.errors,
      ...conditionErrors,
      ...setFormFieldPathErrors,
      ...tableReferenceErrors,
      ...memberReferenceErrors,
      ...orgUnitReferenceErrors,
      ...nodeActorSourceErrors,
      ...excludeNodeActorsErrors,
      ...approverFilledFieldErrors,
      ...approverFilledReadErrors,
      ...webhookErrors,
    ];

    if (errors.length) {
      throw new BadRequestException(errors.join('; '));
    }

    return formVersion.schema;
  }

  /** The cel-legacy publish lint, unchanged (docs/24 §1). */
  private lintCelLegacyExpressions(
    version: ApprovalTemplateVersionEntity,
  ): readonly string[] {
    return [
      ...this.conditionService.lintExpressions(
        [
          {
            expression: version.initiatorPolicyCel,
            label: 'initiatorPolicyCel',
          },
        ],
        { allowedRootIdentifiers: INITIATOR_POLICY_ROOT_IDENTIFIERS },
      ),
      ...this.conditionService.lintExpressions(
        readNodeConditionExpressions(version.workflowDefinition),
        { allowedRootIdentifiers: WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS },
      ),
      // Edge conditions also see the decision just made on the node they
      // leave (workflow-engine `evaluateWorkflowEdge` and its dry-run twin).
      ...this.conditionService.lintExpressions(
        readEdgeConditionExpressions(version.workflowDefinition),
        {
          allowedRootIdentifiers: [
            ...WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS,
            'lastDecision',
          ],
        },
      ),
    ];
  }

  /**
   * The cel-v2 publish lint (ADR 22 §3.4, §5): every expression on its AST
   * with its use point's roots, the bound form's fields and types and the
   * function registry, plus the `SET_FORM_FIELD` write targets. Warnings do
   * not refuse a publish; the designer reads them through
   * `ConditionService.lintExpressionIssues`.
   */
  private lintCelV2Expressions(
    version: ApprovalTemplateVersionEntity,
    formSchema: FormDefinitionSchema | null,
  ): readonly string[] {
    const fields = new Map(
      (formSchema?.fields ?? []).map((entry) => [entry.fieldKey, entry]),
    );

    return [
      ...readUsagePointExpressions(
        version.workflowDefinition,
        version.initiatorPolicyCel,
      ).flatMap(({ expression, label, targetFieldKey, usagePoint }) =>
        this.conditionService.lintExpression(expression, label, {
          dialect: 'cel-v2',
          formSchema,
          functionRegistry: this.expressionFunctionRegistry ?? null,
          targetField:
            targetFieldKey === null ? null : (fields.get(targetFieldKey) ?? null),
          usagePoint,
        }),
      ),
      ...lintSetFormFieldDeclaredFields(version.workflowDefinition, formSchema),
    ];
  }

  /**
   * The functions a version calls that the registry no longer has, as lint
   * lines. Only cel-v2 can call registered functions at all.
   */
  private lintRegisteredFunctions(
    definition: WorkflowDefinition,
    initiatorPolicyCel: string | null,
  ): readonly string[] {
    if (readPublishDialect(definition) !== 'cel-v2') {
      return [];
    }

    const registry = this.expressionFunctionRegistry ?? null;

    return readUsagePointExpressions(definition, initiatorPolicyCel).flatMap(
      ({ expression, label }): readonly string[] => {
        const names =
          typeof expression === 'string'
            ? (readExpressionHostFunctionNames(expression.trim(), 'cel-v2') ?? [])
            : [];
        // Same name rule and registry isolation as the publish lint.
        const missing = readUnavailableExpressionFunctions(names, registry);

        return missing.map((name) =>
          formatExpressionLintIssue({
            code: 'EXPR_FUNCTION_NOT_REGISTERED',
            label,
            severity: 'ERROR',
            subject: name,
          }),
        );
      },
    );
  }

  /**
   * Publish rules that need the webhook endpoint catalog (ADR 18 §4).
   *
   * Resolved through `ModuleRef` rather than injected so `TemplateModule`
   * still boots on its own, outside `BPMRootModule`; a host without the
   * webhook module simply has no endpoint source, which the lint reports as
   * such for any template that references one.
   */
  private async lintWorkflowWebhooks(
    definition: WorkflowDefinition,
    formSchema: FormDefinitionSchema,
  ): Promise<readonly string[]> {
    const webhookService = ((): WorkflowWebhookService | null => {
      try {
        return this.moduleRef.get(WorkflowWebhookService, { strict: false });
      } catch {
        return null;
      }
    })();

    return lintWorkflowWebhookTargets({
      // The injected service: the NOTIFY `EXPRESSION` lint sees the same
      // function registry the engine evaluates with (docs/23 P4／P5 交接).
      conditionService: this.conditionService,
      definition,
      formSchema,
      hasEndpointSources: Boolean(webhookService?.hasEndpointSources()),
      isEndpointUrlAllowed: webhookService
        ? (entry) => webhookService.isEndpointUrlAllowedAtPublish(entry)
        : undefined,
      resolveEndpoint: async (key, version) =>
        webhookService ? webhookService.getEndpoint(key, version) : null,
    });
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

  /**
   * The form schema of the template's current version: the one whose
   * filterable fields the stored instances already satisfy. Null when the
   * template has no published version yet. Read under the caller's template
   * row lock, so no write can change what it guarantees before the publish
   * commits.
   */
  private async readInForceFormSchema(
    manager: EntityManager,
    template: ApprovalTemplateEntity,
  ): Promise<FormDefinitionSchema | null> {
    if (!template.currentVersionId) {
      return null;
    }

    const current = await manager
      .getRepository(ApprovalTemplateVersionEntity)
      .findOne({ where: { id: template.currentVersionId } });

    return this.readFormSchemaOfVersion(
      manager,
      current?.formDefinitionVersionId ?? null,
    );
  }

  private async readFormSchemaOfVersion(
    manager: EntityManager,
    formDefinitionVersionId: string | null,
  ): Promise<FormDefinitionSchema | null> {
    if (!formDefinitionVersionId) {
      return null;
    }

    const formVersion = await manager
      .getRepository(FormDefinitionVersionEntity)
      .findOne({ where: { id: formDefinitionVersionId } });

    return formVersion?.schema ?? null;
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
    return this.templateRepository.manager.transaction(
      async (manager): Promise<ApprovalTemplateEntity> => {
        const template = await this.readLockedTemplateOrThrow(manager, id);
        const templates = manager.getRepository(ApprovalTemplateEntity);

        return templates.save(templates.merge(template, { isActive }));
      },
    );
  }

  /**
   * Locks the template row FOR UPDATE, the lock a publish, compose or rollback
   * takes (ADR 25 §15), then reads the row with its category. A template edit
   * saves the whole entity it read, so reading it unlocked would let a publish
   * that commits in between be overwritten with the pre-publish
   * `currentVersionId`; under the lock the read is the latest committed row
   * and a publish waits for this edit instead.
   */
  private async readLockedTemplateOrThrow(
    manager: EntityManager,
    id: string,
  ): Promise<ApprovalTemplateEntity> {
    // The lock is taken without the category join: Postgres refuses FOR
    // UPDATE on the nullable side of an outer join.
    const locked = await this.lockTemplateRow(manager, id, 'pessimistic_write');

    if (!locked) {
      throw new NotFoundException(`Approval template ${id} was not found`);
    }

    return this.getTemplateOrThrow(id, manager);
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
  fieldReader: ExpressionFieldReader,
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
          .filter((tableKey) =>
            fieldReader.readsTableInternals(expression, tableKey),
          )
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

/**
 * A `DYNAMIC_FORM` approver resolver (user task) or recipient resolver (NOTIFY)
 * reads member ids from the form data at `formPath`; a `FORM_MEMBER_MANAGER`
 * approver resolver reads one member id there. A path that names no
 * member field of the bound form version resolves to nothing at runtime, which
 * throws while the task is created and can strand the case — so it is caught
 * here instead. The same throw happens when the field is merely empty (a
 * manager chain with a `FORM_MEMBER` start is the exception: an empty field
 * sends it to its fallback, and it throws only when it has none), and on a
 * node past the first one it lands inside the previous approver's decision,
 * which then can never commit. So the field must also be one the submit
 * validation guarantees a value for: required, with no `visibleWhen` that can
 * hide it and not a store-only `hidden` field. `FORM_MEMBER_MANAGER` looks one
 * person's manager up, so its field must not be `multiple` either; so does an
 * `ORG_MANAGER_CHAIN` whose `startFrom` is a `FORM_MEMBER`.
 */
function lintWorkflowMemberReferences(
  definition: WorkflowDefinition,
  schema: FormDefinitionSchema | null,
): readonly string[] {
  const memberFields = new Map(
    (schema?.fields ?? [])
      .filter(isMemberFieldDefinition)
      .map((field) => [field.fieldKey, field]),
  );

  return definition.nodes
    .flatMap((node) => {
      if (
        node.type === 'userTask' &&
        (node.data.approverResolver?.type === 'DYNAMIC_FORM' ||
          node.data.approverResolver?.type === 'FORM_MEMBER_MANAGER')
      ) {
        return [
          {
            formPath: node.data.approverResolver.formPath,
            label: `workflow.nodes.${node.id}.approverResolver.formPath`,
            single: node.data.approverResolver.type === 'FORM_MEMBER_MANAGER',
          },
        ];
      }

      // A manager chain that starts from a form pick reads one person there,
      // the same as FORM_MEMBER_MANAGER.
      if (
        node.type === 'userTask' &&
        node.data.approverResolver?.type === 'ORG_MANAGER_CHAIN' &&
        node.data.approverResolver.startFrom?.type === 'FORM_MEMBER'
      ) {
        return [
          {
            formPath: node.data.approverResolver.startFrom.formPath,
            label: `workflow.nodes.${node.id}.approverResolver.startFrom.formPath`,
            single: true,
          },
        ];
      }

      if (
        node.type === 'serviceTask' &&
        node.data.action?.type === 'NOTIFY' &&
        node.data.action.recipients?.type === 'DYNAMIC_FORM'
      ) {
        return [
          {
            formPath: node.data.action.recipients.formPath,
            label: `workflow.nodes.${node.id}.action.recipients.formPath`,
            single: false,
          },
        ];
      }

      return [];
    })
    .flatMap(({ formPath, label, single }) => {
      // A blank path is reported by the workflow definition lint already.
      if (typeof formPath !== 'string' || formPath.trim() === '') {
        return [];
      }

      const field = memberFields.get(formPath);

      if (!field) {
        return [
          `${label} must reference a member (人員選擇) field of the bound form: ${formPath}`,
        ];
      }

      if (single && field.multiple === true) {
        return [
          `${label} must reference a single-person member field, not a multiple one: ${formPath}`,
        ];
      }

      return isMemberFieldAlwaysFilled(field)
        ? []
        : [
            `${label} must reference a required member field that no visibility rule or hidden flag can leave empty: ${formPath}`,
          ];
    });
}

/**
 * A `FORM_ORG_UNIT_MANAGER` approver resolver reads one organization unit id
 * from the form data at `formPath`. Same reasoning as the member references:
 * the field must exist, be an `org_unit` field, and be one the submit
 * validation guarantees a value for.
 */
function lintWorkflowOrgUnitReferences(
  definition: WorkflowDefinition,
  schema: FormDefinitionSchema | null,
): readonly string[] {
  const orgUnitFields = new Map(
    (schema?.fields ?? [])
      .filter(isOrgUnitFieldDefinition)
      .map((field) => [field.fieldKey, field]),
  );

  return definition.nodes.flatMap((node): readonly string[] => {
    if (
      node.type !== 'userTask' ||
      node.data.approverResolver?.type !== 'FORM_ORG_UNIT_MANAGER'
    ) {
      return [];
    }

    const formPath = node.data.approverResolver.formPath;
    const label = `workflow.nodes.${node.id}.approverResolver.formPath`;

    // A blank path is reported by the workflow definition lint already.
    if (typeof formPath !== 'string' || formPath.trim() === '') {
      return [];
    }

    const field = orgUnitFields.get(formPath);

    if (!field) {
      return [
        `${label} must reference an org unit (組織選擇) field of the bound form: ${formPath}`,
      ];
    }

    return isMemberFieldAlwaysFilled(field)
      ? []
      : [
          `${label} must reference a required org unit field that no visibility rule or hidden flag can leave empty: ${formPath}`,
        ];
  });
}

/**
 * The graph checks behind `NODE_ACTOR` / `NODE_ACTOR_MANAGER` nodes, and the
 * `NODE_ACTOR` start of an `ORG_MANAGER_CHAIN` (shared with the designer):
 * every source is an unskippable, upstream, non-parallel user task and every
 * path to the node passes one.
 */
function lintWorkflowNodeActorSources(
  definition: WorkflowDefinition,
): readonly string[] {
  return definition.nodes.flatMap((node): readonly string[] => {
    const resolver = node.type === 'userTask' ? node.data.approverResolver : null;

    // A manager chain that starts from an earlier stage reads that stage's
    // signer the way NODE_ACTOR does, so it meets the same graph rules. It
    // also needs that signer to be one person: when the last of several
    // signers approves, the engine's "which one?" Conflict would land in that
    // approval's own transaction and it could never commit. NODE_ACTOR and
    // NODE_ACTOR_MANAGER take every signer and are not held to this.
    if (
      resolver?.type === 'ORG_MANAGER_CHAIN' &&
      resolver.startFrom?.type === 'NODE_ACTOR'
    ) {
      return [
        ...readNodeActorSourceIssues(
          definition,
          node.id,
          resolver.startFrom.nodeIds,
        ),
        ...readSingleApproverSourceIssues(
          definition,
          resolver.startFrom.nodeIds,
        ),
      ].map(
        (issue) =>
          `workflow.nodes.${node.id}.approverResolver.startFrom.nodeIds: ${issue}`,
      );
    }

    if (resolver?.type !== 'NODE_ACTOR' && resolver?.type !== 'NODE_ACTOR_MANAGER') {
      return [];
    }

    return readNodeActorSourceIssues(definition, node.id, resolver.nodeIds).map(
      (issue) => `workflow.nodes.${node.id}.approverResolver.nodeIds: ${issue}`,
    );
  });
}

/**
 * The graph checks behind `excludeNodeActors` (shared with the designer): every
 * listed node, on its own, is an upstream user task that is on every path to
 * the node and always has a person sign (the `NODE_ACTOR` source rules, worded
 * for the exclusion). Runs after the structural lint, like the `NODE_ACTOR`
 * checks.
 */
function lintWorkflowExcludeNodeActors(
  definition: WorkflowDefinition,
): readonly string[] {
  return definition.nodes.flatMap((node): readonly string[] =>
    node.type === 'userTask'
      ? readExcludeNodeActorsIssues(
          definition,
          node.id,
          node.data.excludeNodeActors,
        ).map(
          (issue) => `workflow.nodes.${node.id}.excludeNodeActors: ${issue}`,
        )
      : [],
  );
}

/**
 * A condition that reads a field an approver fills in, before that approver
 * has filled it in, finds the field absent: the applicant's form is submitted
 * without it. Evaluated while the previous approver's decision is being
 * committed, that throws and the case can never leave the previous node; a
 * structured condition compares against the absent value and routes on that.
 * So it is refused at publish, from the graph alone (no CEL semantics, which
 * the unit tests' cel-js shim cannot reproduce).
 *
 * Per approver-filled field X:
 * - `G` is the nodes that fill X in and have no `entryCondition`. A filling
 *   node with an `entryCondition` can be skipped and then nobody fills X in
 *   (`skipNode` carries on regardless), so it guards nothing.
 * - `R` is every node reachable from the start without entering a node of `G`:
 *   the nodes X may still be empty at. `F` is the filling nodes right after a
 *   node of `R`.
 * - An edge condition or `conditionFieldKey` is evaluated while leaving its
 *   source, so it is early when the source is in `R`. A node expression is
 *   evaluated on arrival, before the task is created, so it is early when the
 *   node is in `R` or `F` (the filling node's own `entryCondition` and
 *   EXPRESSION resolver run before the fill-in).
 *
 * Deliberately conservative: the graph cannot tell "parallel, all branches
 * run, AND join waits" from "exclusive, one branch runs", so a read after a
 * join is refused when only some of the branches pass through a node of `G`.
 * `has(form.x)` is not recognised as a guard either; the read belongs after
 * the filling node. `initiatorPolicyCel` is not read here: its root
 * identifiers cannot include `form`.
 *
 * The definition may hold a cycle (the cycle lint reports it in the same
 * pass), which the visited set in `readReachableWorkflowNodeIds` copes with.
 */
function lintApproverFilledFieldReads(
  definition: WorkflowDefinition,
  fieldReader: ExpressionFieldReader,
): readonly string[] {
  const fieldKeys = [...readApproverFilledFieldKeys(definition)];

  if (!fieldKeys.length) {
    return [];
  }

  const userTasks = definition.nodes.filter(
    (node): node is UserTaskNode => node.type === 'userTask',
  );
  const startNodeIds = definition.nodes
    .filter((node) => node.type === 'startEvent')
    .map((node) => node.id);
  const nodeSources = definition.nodes.flatMap((node) =>
    [
      ...readNodeExpressions(node),
      ...readNotifyRecipientsExpressions(node),
    ].map((source) => ({ ...source, nodeId: node.id })),
  );

  return fieldKeys.flatMap((fieldKey) => {
    const fillingNodes = userTasks.filter((node) =>
      readNodeFillableFieldKeys(node).has(fieldKey),
    );
    const fillingNodeIds = new Set(fillingNodes.map((node) => node.id));
    const guardNodeIds = new Set(
      fillingNodes
        .filter((node) => !hasEntryCondition(node))
        .map((node) => node.id),
    );
    const earlyNodeIds = readReachableWorkflowNodeIds(
      definition.edges,
      startNodeIds,
      guardNodeIds,
    );
    const nodeIdsReadingEarly = new Set([
      ...earlyNodeIds,
      ...definition.edges
        .filter(
          (edge) =>
            earlyNodeIds.has(edge.source) && fillingNodeIds.has(edge.target),
        )
        .map((edge) => edge.target),
    ]);
    const nodeLabels = nodeSources
      .filter(
        ({ expression, nodeId }) =>
          nodeIdsReadingEarly.has(nodeId) &&
          typeof expression === 'string' &&
          fieldReader.readsField(expression, fieldKey),
      )
      .map(({ label }) => label);
    const edgeLabels = definition.edges
      .filter((edge) => earlyNodeIds.has(edge.source))
      .flatMap((edge) => readEdgeFieldReadLabels(edge, fieldKey, fieldReader));

    return [...nodeLabels, ...edgeLabels].map((label) =>
      WORKFLOW_LINT_MESSAGES.approverFilledFieldReadEarly(label, fieldKey),
    );
  });
}

function hasEntryCondition(node: UserTaskNode): boolean {
  const entryCondition: unknown = node.data.entryCondition;

  return typeof entryCondition === 'string' && entryCondition.trim() !== '';
}

// The label of the one line an edge earns for `fieldKey`: the CEL condition
// wins over the structured condition, so an edge carrying both reads once.
function readEdgeFieldReadLabels(
  edge: WorkflowEdge,
  fieldKey: string,
  fieldReader: ExpressionFieldReader,
): readonly string[] {
  // A draft's edge may carry no `data` at all.
  const data: WorkflowEdge['data'] | undefined = edge.data;
  const condition: unknown = data?.condition;
  const conditionFieldKey: unknown = data?.conditionFieldKey;

  if (
    typeof condition === 'string' &&
    fieldReader.readsField(condition, fieldKey)
  ) {
    return [WORKFLOW_EXPRESSION_LABELS.edgeCondition(edge.id)];
  }

  return typeof conditionFieldKey === 'string' &&
    readTopLevelFieldKey(conditionFieldKey) === fieldKey
    ? [WORKFLOW_EXPRESSION_LABELS.edgeConditionFieldKey(edge.id)]
    : [];
}

// A NOTIFY node resolves an EXPRESSION recipient list the moment it is reached
// (`resolveApproverResolver`), so it reads the form like any node expression.
// Kept out of `readNodeConditionExpressions` so the CEL root-identifier lint
// keeps covering exactly what it did.
function readNotifyRecipientsExpressions(
  node: WorkflowNode,
): readonly ExpressionSource[] {
  // A draft is not shape-checked: the node may have no `action`, and a NOTIFY
  // action may have no `recipients` (the structural lint reports that line).
  const action: ServiceAction | undefined =
    node.type === 'serviceTask' ? node.data?.action : undefined;

  if (action?.type !== 'NOTIFY') {
    return [];
  }

  const recipients: ApproverResolver | undefined = action.recipients;

  return recipients?.type === 'EXPRESSION'
    ? [
        {
          expression: recipients.expression,
          label: WORKFLOW_EXPRESSION_LABELS.nodeActionRecipientsExpression(node.id),
        },
      ]
    : [];
}

// Used for member and org_unit fields alike: a field an approver resolver reads
// must be one the submit validation guarantees a value for.
function isMemberFieldAlwaysFilled(field: FormFieldDefinition): boolean {
  return (
    field.required === true &&
    field.hidden !== true &&
    !field.visibleWhen?.trim()
  );
}

function readEdgeConditionExpressions(
  definition: WorkflowDefinition,
): readonly {
  readonly expression: string | null | undefined;
  readonly label: string;
}[] {
  return definition.edges.map((edge) => ({
    expression: edge.data.condition,
    label: WORKFLOW_EXPRESSION_LABELS.edgeCondition(edge.id),
  }));
}

// Every CEL expression of a template version, edge conditions included.
function readConditionExpressions(
  definition: WorkflowDefinition,
  initiatorPolicyCel: string | null,
): readonly {
  readonly expression: string | null | undefined;
  readonly label: string;
}[] {
  return [
    { expression: initiatorPolicyCel, label: 'initiatorPolicyCel' },
    ...readNodeConditionExpressions(definition),
    ...readEdgeConditionExpressions(definition),
  ];
}

// Node-level expressions: entry conditions, EXPRESSION resolvers, webhook
// payloads and SET_FORM_FIELD values.
function readNodeConditionExpressions(
  definition: WorkflowDefinition,
): readonly ExpressionSource[] {
  return definition.nodes.flatMap(readNodeExpressions);
}

function readNodeExpressions(node: WorkflowNode): readonly ExpressionSource[] {
  if (node.type === 'userTask') {
    return [
      {
        expression: node.data.entryCondition,
        label: WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition(node.id),
      },
      ...(node.data.approverResolver.type === 'EXPRESSION'
        ? [
            {
              expression: node.data.approverResolver.expression,
              label: WORKFLOW_EXPRESSION_LABELS.nodeApproverResolverExpression(node.id),
            },
          ]
        : []),
    ];
  }

  if (node.type === 'serviceTask') {
    return [
      {
        expression: node.data.entryCondition,
        label: WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition(node.id),
      },
      ...(node.data.action.type === 'WEBHOOK'
        ? [
            {
              expression: node.data.action.payload,
              label: WORKFLOW_EXPRESSION_LABELS.nodeActionPayload(node.id),
            },
          ]
        : []),
      ...(node.data.action.type === 'SET_FORM_FIELD'
        ? [
            {
              expression: node.data.action.value,
              label: WORKFLOW_EXPRESSION_LABELS.nodeActionValue(node.id),
            },
          ]
        : []),
    ];
  }

  return [];
}

export interface ExpressionSource {
  readonly expression: string | null | undefined;
  readonly label: string;
}

/**
 * The dialect a definition is published with: the default when it names
 * none, `null` when it names one this version does not know (refused by
 * `lintWorkflowDefinition`).
 */
function readPublishDialect(
  definition: WorkflowDefinition | null | undefined,
): ExpressionDialect | null {
  const value: unknown = definition?.expressionDialect;

  if (value === undefined || value === null) {
    return DEFAULT_EXPRESSION_DIALECT;
  }

  return isExpressionDialect(value) ? value : null;
}

/**
 * "Does this expression read field X / step inside table T", per dialect.
 * cel-v2 answers from the AST, so `form["sec" + "ret"]` is not missed the way
 * a pattern misses it; cel-legacy keeps the textual rules (docs/24 §1). An
 * expression the AST cannot be read for falls back to the textual rules:
 * the lint has refused it already, and a false hit only adds a line.
 */
interface ExpressionFieldReader {
  readonly readsField: (expression: string, fieldKey: string) => boolean;
  readonly readsTableInternals: (
    expression: string,
    tableKey: string,
  ) => boolean;
}

const TEXTUAL_FIELD_READER: ExpressionFieldReader = {
  readsField: referencesFormField,
  readsTableInternals: referencesTableInternals,
};

function createExpressionFieldReader(
  dialect: ExpressionDialect,
): ExpressionFieldReader {
  if (dialect !== 'cel-v2') {
    return TEXTUAL_FIELD_READER;
  }

  const cache = new Map<string, ExpressionReferences | null>();
  const read = (expression: string): ExpressionReferences | null => {
    if (!cache.has(expression)) {
      const result = readExpressionReferences(expression.trim(), 'cel-v2');

      cache.set(expression, result.status === 'OK' ? result.references : null);
    }

    return cache.get(expression) ?? null;
  };

  return {
    readsField: (expression, fieldKey): boolean => {
      const references = read(expression);

      return references
        ? readsFormField(references, fieldKey)
        : referencesFormField(expression, fieldKey);
    },
    readsTableInternals: (expression, tableKey): boolean => {
      const references = read(expression);

      return references
        ? readsTableInternals(references, tableKey)
        : referencesTableInternals(expression, tableKey);
    },
  };
}

export interface UsagePointExpression extends ExpressionSource {
  /** The top-level field a `SET_FORM_FIELD` value is written to. */
  readonly targetFieldKey: string | null;
  readonly usagePoint: ExpressionUsagePoint;
}

/**
 * Every expression of a version with its use point (docs/24 §2.3). Unlike
 * the cel-legacy readers this includes the NOTIFY recipients expression,
 * which is evaluated like an approver expression. A draft is not
 * shape-checked, so every read is guarded. Also read by the designer's
 * expression analysis and dialect upgrade check (Phase 23 P4).
 */
export function readUsagePointExpressions(
  definition: WorkflowDefinition,
  initiatorPolicyCel: string | null,
): readonly UsagePointExpression[] {
  const nodes: readonly WorkflowNode[] = Array.isArray(definition?.nodes)
    ? definition.nodes
    : [];
  const edges: readonly WorkflowEdge[] = Array.isArray(definition?.edges)
    ? definition.edges
    : [];
  const entry = (
    expression: string | null | undefined,
    label: string,
    usagePoint: ExpressionUsagePoint,
    targetFieldKey: string | null = null,
  ): UsagePointExpression => ({ expression, label, targetFieldKey, usagePoint });

  return [
    entry(initiatorPolicyCel, 'initiatorPolicyCel', 'INITIATOR_POLICY'),
    ...nodes.flatMap((node): readonly UsagePointExpression[] => {
      const data: unknown = node?.data;

      if (!isRecord(data) || typeof node.id !== 'string') {
        return [];
      }

      const entryCondition = entry(
        readOptionalString(data['entryCondition']),
        WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition(node.id),
        'ENTRY_CONDITION',
      );

      if (node.type === 'userTask') {
        const resolver = data['approverResolver'];

        return [
          entryCondition,
          ...(isRecord(resolver) && resolver['type'] === 'EXPRESSION'
            ? [
                entry(
                  readOptionalString(resolver['expression']),
                  WORKFLOW_EXPRESSION_LABELS.nodeApproverResolverExpression(
                    node.id,
                  ),
                  'APPROVER_RESOLVER',
                ),
              ]
            : []),
        ];
      }

      if (node.type !== 'serviceTask') {
        return [];
      }

      const action = data['action'];

      if (!isRecord(action)) {
        return [entryCondition];
      }

      if (action['type'] === 'WEBHOOK') {
        return [
          entryCondition,
          entry(
            readOptionalString(action['payload']),
            WORKFLOW_EXPRESSION_LABELS.nodeActionPayload(node.id),
            'WEBHOOK_PAYLOAD',
          ),
        ];
      }

      if (action['type'] === 'SET_FORM_FIELD') {
        const fieldPath = action['fieldPath'];

        return [
          entryCondition,
          entry(
            readOptionalString(action['value']),
            WORKFLOW_EXPRESSION_LABELS.nodeActionValue(node.id),
            'SERVICE_FORM_FIELD_VALUE',
            typeof fieldPath === 'string' ? readWholeFieldTarget(fieldPath) : null,
          ),
        ];
      }

      const recipients = action['recipients'];

      return action['type'] === 'NOTIFY' &&
        isRecord(recipients) &&
        recipients['type'] === 'EXPRESSION'
        ? [
            entryCondition,
            entry(
              readOptionalString(recipients['expression']),
              WORKFLOW_EXPRESSION_LABELS.nodeActionRecipientsExpression(node.id),
              'APPROVER_RESOLVER',
            ),
          ]
        : [entryCondition];
    }),
    ...edges.flatMap((edge): readonly UsagePointExpression[] => {
      const data: unknown = edge?.data;

      return typeof edge?.id === 'string' && isRecord(data)
        ? [
            entry(
              readOptionalString(data['condition']),
              WORKFLOW_EXPRESSION_LABELS.edgeCondition(edge.id),
              'FLOW_CONDITION',
            ),
          ]
        : [];
    }),
  ];
}

/**
 * The field a `SET_FORM_FIELD` path writes as a whole: `amount`, `form.amount`.
 * A deeper path (`meta.code`) writes inside a field, whose declared type then
 * says nothing about the value, so it has no target.
 */
function readWholeFieldTarget(fieldPath: string): string | null {
  const segments = fieldPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fieldSegments =
    segments[0] === 'form' || segments[0] === 'formData'
      ? segments.slice(1)
      : segments;

  return fieldSegments.length === 1 && !/[[\]]/u.test(fieldSegments[0])
    ? fieldSegments[0]
    : null;
}

function readOptionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined;
}

interface SetFormFieldPath {
  readonly fieldPath: string;
  readonly label: string;
  /** The reserved segments in the path, each once. */
  readonly reserved: readonly string[];
}

/**
 * Every non-blank `SET_FORM_FIELD` write path in a definition. A blank path is
 * reported by the structural lint already.
 */
function readSetFormFieldPaths(
  definition: WorkflowDefinition,
): readonly SetFormFieldPath[] {
  const nodes: readonly WorkflowNode[] = Array.isArray(definition?.nodes)
    ? definition.nodes
    : [];

  return nodes.flatMap((node): readonly SetFormFieldPath[] => {
    const data: unknown = node?.data;
    const action = isRecord(data) ? data['action'] : undefined;
    const fieldPath =
      isRecord(action) && action['type'] === 'SET_FORM_FIELD'
        ? action['fieldPath']
        : undefined;

    if (typeof fieldPath !== 'string' || !fieldPath.trim()) {
      return [];
    }

    return [
      {
        fieldPath,
        label: `workflow.nodes.${node.id}.action.fieldPath`,
        reserved: [
          ...new Set(
            fieldPath
              .split(/[.[\]"']/u)
              .map((segment) => segment.trim())
              .filter((segment) => RESERVED_PATH_SEGMENTS.has(segment)),
          ),
        ],
      },
    ];
  });
}

/**
 * ADR 22 §5.5, the half that holds in both dialects: a `SET_FORM_FIELD` path
 * has no `__proto__`, `constructor` or `prototype` segment.
 */
function lintSetFormFieldReservedSegments(
  definition: WorkflowDefinition,
): readonly string[] {
  return readSetFormFieldPaths(definition).flatMap(
    ({ label, reserved }): readonly string[] =>
      reserved.map((segment) =>
        formatExpressionLintIssue({
          code: 'EXPR_RESERVED_PATH_SEGMENT',
          label,
          severity: 'ERROR',
          subject: segment,
        }),
      ),
  );
}

/**
 * ADR 22 §3.4 / §5.5 for cel-v2 definitions: a `SET_FORM_FIELD` writes a
 * field the bound form declares. A path with a reserved segment is reported
 * by `lintSetFormFieldReservedSegments` instead. cel-legacy does not get this
 * half yet: a fork of an older version may write a field its form dropped.
 */
function lintSetFormFieldDeclaredFields(
  definition: WorkflowDefinition,
  schema: FormDefinitionSchema | null,
): readonly string[] {
  if (!schema) {
    return [];
  }

  const fieldKeys = new Set(
    (schema.fields ?? []).map((entry) => entry.fieldKey),
  );

  return readSetFormFieldPaths(definition)
    .filter(({ reserved }) => reserved.length === 0)
    .flatMap(({ fieldPath, label }): readonly string[] => {
      const fieldKey = readFormFieldPathTopLevelKey(fieldPath);

      return fieldKeys.has(fieldKey)
        ? []
        : [
            formatExpressionLintIssue({
              code: 'EXPR_FIELD_UNKNOWN',
              label,
              severity: 'ERROR',
              subject: fieldKey,
            }),
          ];
    });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
