import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { WorkflowTokenEntity } from './workflow-token.entity';

@Injectable()
export class WorkflowEngineService {
  constructor(
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(WorkflowTokenEntity)
    private readonly workflowTokenRepository: Repository<WorkflowTokenEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @InjectRepository(TaskDecisionEntity)
    private readonly taskDecisionRepository: Repository<TaskDecisionEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
    @InjectRepository(ApprovalTemplateEntity)
    private readonly approvalTemplateRepository: Repository<ApprovalTemplateEntity>,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly approvalTemplateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
  ) {}

  async submitApprovalInstance(
    input: SubmitApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    const formData = parseJsonObject(input.formDataJson, 'formDataJson');
    const initiatorMetadataSnapshot = input.initiatorMetadataSnapshotJson
      ? parseJsonObject(
          input.initiatorMetadataSnapshotJson,
          'initiatorMetadataSnapshotJson',
        )
      : readDefaultInitiatorMetadataSnapshot(input.initiatorMemberId);
    const template = await this.getTemplateOrThrow(input.templateId);

    if (!template.currentVersionId) {
      throw new ConflictException(
        'Approval template does not have a published version',
      );
    }

    const templateVersion = await this.getPublishedTemplateVersionOrThrow(
      template.currentVersionId,
    );
    const formDefinitionVersion = await this.getPublishedFormVersionOrThrow(
      templateVersion.formDefinitionVersionId,
    );
    const startedAt = new Date();
    const startNode = templateVersion.workflowDefinition.nodes.find(
      (node) => node.type === 'startEvent',
    );

    if (!startNode) {
      throw new BadRequestException(
        'Published workflow does not include a startEvent',
      );
    }

    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const tokenRepository = manager.getRepository(WorkflowTokenEntity);
        const activityRepository = manager.getRepository(ActivityLogEntity);
        const instance = await instanceRepository.save(
          instanceRepository.create({
            completedAt: null,
            formData,
            formDefinitionSnapshot: {
              formDefinitionVersionId: formDefinitionVersion.id,
              schema: formDefinitionVersion.schema,
              uiSchema: formDefinitionVersion.uiSchema,
              version: formDefinitionVersion.version,
            },
            initiatorMemberId: input.initiatorMemberId,
            initiatorMetadataSnapshot,
            startedAt,
            state: ApprovalInstanceStateEnum.RUNNING,
            templateId: template.id,
            templateVersionId: templateVersion.id,
            title: input.title?.trim() || template.name,
            workflowSnapshot: templateVersion.workflowDefinition,
          }),
        );
        const token = await tokenRepository.save(
          tokenRepository.create({
            consumedAt: null,
            currentNodeId: startNode.id,
            instanceId: instance.id,
            parentTokenId: null,
            status: WorkflowTokenStatusEnum.ACTIVE,
          }),
        );

        await activityRepository.save([
          activityRepository.create({
            actorMemberId: input.initiatorMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_STARTED,
            instanceId: instance.id,
            nodeId: startNode.id,
            payload: {
              templateId: template.id,
              templateVersionId: templateVersion.id,
            },
            taskId: null,
          }),
          activityRepository.create({
            actorMemberId: null,
            eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
            instanceId: instance.id,
            nodeId: startNode.id,
            payload: {
              tokenId: token.id,
            },
            taskId: null,
          }),
        ]);

        return instance;
      },
    );
  }

  async processInstance(instanceId: string): Promise<void> {
    await this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<void> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          instanceId,
        ]);

        const instance = await manager
          .getRepository(ApprovalInstanceEntity)
          .findOne({ where: { id: instanceId } });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${instanceId} was not found`,
          );
        }

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: null,
            eventType: ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
            instanceId,
            nodeId: null,
            payload: {
              state: instance.state,
            },
            taskId: null,
          }),
        );
      },
    );
  }

  async getApprovalInstance(id: string): Promise<ApprovalInstanceEntity> {
    const instance = await this.approvalInstanceRepository.findOne({
      where: { id },
    });

    if (!instance) {
      throw new NotFoundException(`Approval instance ${id} was not found`);
    }

    return instance;
  }

  async listApprovalInstances(): Promise<readonly ApprovalInstanceEntity[]> {
    return this.approvalInstanceRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async listWorkflowTokens(
    instanceId: string,
  ): Promise<readonly WorkflowTokenEntity[]> {
    await this.getApprovalInstance(instanceId);

    return this.workflowTokenRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  async listTasks(instanceId: string): Promise<readonly TaskEntity[]> {
    await this.getApprovalInstance(instanceId);

    return this.taskRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  async listTaskDecisions(
    taskId: string,
  ): Promise<readonly TaskDecisionEntity[]> {
    return this.taskDecisionRepository.find({
      order: { decidedAt: 'ASC' },
      where: { taskId },
    });
  }

  async listActivityLogs(
    instanceId: string,
  ): Promise<readonly ActivityLogEntity[]> {
    await this.getApprovalInstance(instanceId);

    return this.activityLogRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  private async getTemplateOrThrow(
    templateId: string,
  ): Promise<ApprovalTemplateEntity> {
    const template = await this.approvalTemplateRepository.findOne({
      where: { deletedAt: IsNull(), id: templateId },
    });

    if (!template) {
      throw new NotFoundException(
        `Approval template ${templateId} was not found`,
      );
    }

    return template;
  }

  private async getPublishedTemplateVersionOrThrow(
    versionId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const version = await this.approvalTemplateVersionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(
        `Approval template version ${versionId} was not found`,
      );
    }

    if (version.status !== ApprovalTemplateVersionStatusEnum.PUBLISHED) {
      throw new ConflictException(
        'Approval template current version must be published',
      );
    }

    return version;
  }

  private async getPublishedFormVersionOrThrow(
    versionId: string | null,
  ): Promise<FormDefinitionVersionEntity> {
    if (!versionId) {
      throw new ConflictException(
        'Approval template version does not bind a form version',
      );
    }

    const version = await this.formDefinitionVersionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(
        `Form definition version ${versionId} was not found`,
      );
    }

    if (version.status !== FormDefinitionVersionStatusEnum.PUBLISHED) {
      throw new ConflictException(
        'Approval template must bind a published form version',
      );
    }

    return version;
  }
}

function parseJsonObject(
  value: string,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (isRecord(parsedValue)) {
      return parsedValue;
    }

    throw new BadRequestException(`${label} must be a JSON object`);
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException(
      error instanceof Error ? error.message : `${label} is invalid JSON`,
    );
  }
}

function readDefaultInitiatorMetadataSnapshot(
  memberId: string,
): Readonly<Record<string, unknown>> {
  return {
    customFields: {},
    memberId,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
