import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkflowDefinition } from '@bpm/shared/workflow';
import { FindOptionsWhere, ILike, IsNull, Not, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  CreateApprovalTemplateInput,
  UpdateApprovalTemplateDraftInput,
  UpdateApprovalTemplateInput,
} from './dto/approval-template.input';
import {
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
  readonly page?: number;
  readonly pageSize?: number;
  readonly searchText?: string;
  readonly status?: ApprovalTemplateListStatusEnum;
}

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(ApprovalTemplateEntity)
    private readonly templateRepository: Repository<ApprovalTemplateEntity>,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly templateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly conditionService: ConditionService,
  ) {}

  async createApprovalTemplate(
    input: CreateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    await this.validateOptionalFormDefinitionVersion(
      input.formDefinitionVersionId,
    );

    return this.templateRepository.manager.transaction(
      async (manager): Promise<ApprovalTemplateEntity> => {
        const templateRepository = manager.getRepository(
          ApprovalTemplateEntity,
        );
        const versionRepository = manager.getRepository(
          ApprovalTemplateVersionEntity,
        );
        const template = await templateRepository.save(
          templateRepository.create({
            category: input.category,
            createdByMemberId: input.createdByMemberId,
            currentVersionId: null,
            description: input.description,
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

        return template;
      },
    );
  }

  async updateApprovalTemplate(
    input: UpdateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    const existing = await this.getTemplateOrThrow(input.id);
    const next = this.templateRepository.merge(existing, {
      category: input.category ?? existing.category,
      description: input.description ?? existing.description,
      name: input.name ?? existing.name,
    });

    return this.templateRepository.save(next);
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
      ...(normalizedPageSize
        ? {
            skip: (normalizePage(options.page ?? 1) - 1) * normalizedPageSize,
            take: normalizedPageSize,
          }
        : {}),
      where: createApprovalTemplateWhere({
        searchText: options.searchText,
        status: options.status,
      }),
    });
  }

  async countApprovalTemplates({
    searchText,
    status,
  }: {
    readonly searchText?: string;
    readonly status?: ApprovalTemplateListStatusEnum;
  } = {}): Promise<number> {
    return this.templateRepository.count({
      where: createApprovalTemplateWhere({ searchText, status }),
    });
  }

  async getApprovalTemplate(id: string): Promise<ApprovalTemplateEntity> {
    return this.getTemplateOrThrow(id);
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
  ): Promise<ApprovalTemplateVersionEntity> {
    const existing = await this.getTemplateVersionOrThrow(input.versionId);

    if (existing.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft approval template versions can be updated',
      );
    }

    await this.validateOptionalFormDefinitionVersion(
      input.formDefinitionVersionId,
    );
    const workflowDefinition = this.parseWorkflowDefinitionOrThrow(
      input.workflowDefinitionJson,
    );
    const next = this.templateVersionRepository.merge(existing, {
      formDefinitionVersionId: input.formDefinitionVersionId,
      initiatorPolicyCel: input.initiatorPolicyCel,
      notificationConfig: parseOptionalJsonObject(input.notificationConfigJson),
      slaDefaults: parseOptionalJsonObject(input.slaDefaultsJson),
      workflowDefinition,
    });

    return this.templateVersionRepository.save(next);
  }

  async forkApprovalTemplate(
    templateId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const template = await this.getTemplateOrThrow(templateId);
    const existingDraft = await this.templateVersionRepository.findOne({
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
      ? await this.getTemplateVersionOrThrow(template.currentVersionId)
      : null;
    const nextVersion = await this.readNextVersionNumber(template.id);

    return this.templateVersionRepository.save(
      this.templateVersionRepository.create({
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
  ): Promise<ApprovalTemplateVersionEntity> {
    const version = await this.getTemplateVersionOrThrow(versionId);

    if (version.status !== ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Only draft approval template versions can be published',
      );
    }

    await this.validatePublishableVersion(version);

    return this.templateRepository.manager.transaction(
      async (manager): Promise<ApprovalTemplateVersionEntity> => {
        const templateRepository = manager.getRepository(
          ApprovalTemplateEntity,
        );
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
        await templateRepository.save(
          templateRepository.merge(template, {
            currentVersionId: saved.id,
          }),
        );

        return saved;
      },
    );
  }

  async rollbackApprovalTemplateVersion(
    versionId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const target = await this.getTemplateVersionOrThrow(versionId);

    if (target.status === ApprovalTemplateVersionStatusEnum.DRAFT) {
      throw new ConflictException(
        'Draft approval template versions cannot be rollback targets',
      );
    }

    return this.templateRepository.manager.transaction(
      async (manager): Promise<ApprovalTemplateVersionEntity> => {
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
        await templateRepository.save(
          templateRepository.merge(template, {
            currentVersionId: saved.id,
          }),
        );

        return saved;
      },
    );
  }

  private async validatePublishableVersion(
    version: ApprovalTemplateVersionEntity,
  ): Promise<void> {
    if (!version.formDefinitionVersionId) {
      throw new BadRequestException(
        'Approval template version must bind a form definition version before publishing',
      );
    }

    const formVersion = await this.formDefinitionVersionRepository.findOne({
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
    );
    const errors = [...workflowResult.errors, ...conditionErrors];

    if (errors.length) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private async validateOptionalFormDefinitionVersion(
    formDefinitionVersionId: string | null | undefined,
  ): Promise<void> {
    if (!formDefinitionVersionId) {
      return;
    }

    const formVersion = await this.formDefinitionVersionRepository.findOne({
      where: { id: formDefinitionVersionId },
    });

    if (!formVersion) {
      throw new NotFoundException(
        `Form definition version ${formDefinitionVersionId} was not found`,
      );
    }
  }

  private async getTemplateOrThrow(
    id: string,
  ): Promise<ApprovalTemplateEntity> {
    const entity = await this.templateRepository.findOne({
      where: { deletedAt: IsNull(), id },
    });

    if (!entity) {
      throw new NotFoundException(`Approval template ${id} was not found`);
    }

    return entity;
  }

  private async getTemplateVersionOrThrow(
    id: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const entity = await this.templateVersionRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(
        `Approval template version ${id} was not found`,
      );
    }

    return entity;
  }

  private async readNextVersionNumber(templateId: string): Promise<number> {
    const row = await this.templateVersionRepository
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
    readonly searchText?: string;
    readonly status?: ApprovalTemplateListStatusEnum;
  }>,
):
  | FindOptionsWhere<ApprovalTemplateEntity>
  | FindOptionsWhere<ApprovalTemplateEntity>[] {
  const activeTemplateWhere: FindOptionsWhere<ApprovalTemplateEntity> = {
    deletedAt: IsNull(),
  };
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
