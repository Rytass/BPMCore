import {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  UserTaskNode,
  ServiceTaskNode,
} from '@bpm/shared/workflow';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { DecideTaskInput } from './dto/decide-task.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { evaluateWorkflowEdgeCondition } from './workflow-condition-evaluator';
import { WorkflowTokenEntity } from './workflow-token.entity';

const MAX_PROCESSING_STEPS = 500;

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

        if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
          return;
        }

        await this.processRunningInstance(manager, instance);
      },
    );
  }

  async decideTask(input: DecideTaskInput): Promise<TaskDecisionEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<TaskDecisionEntity> => {
        const taskRepository = manager.getRepository(TaskEntity);
        const taskDecisionRepository =
          manager.getRepository(TaskDecisionEntity);
        const activityRepository = manager.getRepository(ActivityLogEntity);
        const tokenRepository = manager.getRepository(WorkflowTokenEntity);
        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const task = await taskRepository.findOne({
          where: { id: input.taskId },
        });

        if (!task) {
          throw new NotFoundException(`Task ${input.taskId} was not found`);
        }

        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          task.instanceId,
        ]);

        if (
          task.status !== TaskStatusEnum.PENDING &&
          task.status !== TaskStatusEnum.IN_PROGRESS
        ) {
          throw new ConflictException(`Task ${task.id} is not pending`);
        }

        if (task.assigneeMemberId !== input.decidedByMemberId) {
          throw new ConflictException(
            `Task ${task.id} is assigned to another member`,
          );
        }

        if (
          input.action !== TaskDecisionActionEnum.APPROVED &&
          input.action !== TaskDecisionActionEnum.REJECTED
        ) {
          throw new ConflictException(
            `Task decision action ${input.action} is not supported yet`,
          );
        }
        const decisionComment = input.comment?.trim() || null;

        if (
          input.action === TaskDecisionActionEnum.REJECTED &&
          !decisionComment
        ) {
          throw new BadRequestException('Reject decision comment is required');
        }

        const instance = await instanceRepository.findOne({
          where: { id: task.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${task.instanceId} was not found`,
          );
        }

        if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not running`,
          );
        }

        const decidedAt = new Date();
        const decision = await taskDecisionRepository.save(
          taskDecisionRepository.create({
            action: input.action,
            comment: decisionComment,
            decidedAt,
            decidedByMemberId: input.decidedByMemberId,
            returnToNodeId: null,
            signatureId: null,
            taskId: task.id,
            transferToMemberId: null,
          }),
        );
        const completedTask = await taskRepository.save({
          ...task,
          completedAt: decidedAt,
          status: TaskStatusEnum.COMPLETED,
        });

        await activityRepository.save(
          activityRepository.create({
            actorMemberId: input.decidedByMemberId,
            eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
            instanceId: instance.id,
            nodeId: task.nodeId,
            payload: {
              action: input.action,
              comment: decisionComment,
              decisionId: decision.id,
            },
            taskId: completedTask.id,
          }),
        );

        if (input.action === TaskDecisionActionEnum.APPROVED) {
          const token = await tokenRepository.findOne({
            where: { id: task.tokenId },
          });

          if (!token) {
            throw new NotFoundException(
              `Workflow token ${task.tokenId} was not found`,
            );
          }

          if (token.status !== WorkflowTokenStatusEnum.WAITING) {
            throw new ConflictException(
              `Workflow token ${token.id} is not waiting for a task decision`,
            );
          }

          const activeToken = await tokenRepository.save({
            ...token,
            consumedAt: null,
            status: WorkflowTokenStatusEnum.ACTIVE,
          });

          await this.advanceTokenToOutgoingNodes(
            manager,
            instance,
            activeToken,
            readWorkflowNodeOrThrow(instance.workflowSnapshot, task.nodeId),
          );
          await this.processRunningInstance(manager, instance);

          return decision;
        }

        await this.rejectInstance(manager, instance, task, decidedAt);

        return decision;
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

  async listInboxTasks(
    assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.taskRepository.find({
      order: { createdAt: 'DESC' },
      where: {
        assigneeMemberId,
        status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
      },
    });
  }

  async listApprovalHistoryTasks(
    assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.taskRepository.find({
      order: { completedAt: 'DESC', createdAt: 'DESC' },
      where: {
        assigneeMemberId,
        status: TaskStatusEnum.COMPLETED,
      },
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

  private async processActiveToken(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
  ): Promise<void> {
    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      token.currentNodeId,
    );

    if (!(await this.isNodeEntryReady(manager, instance, token, node))) {
      return;
    }

    if (node.type === 'startEvent') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    if (node.type === 'endEvent') {
      await this.completeTokenAtEndNode(manager, instance, token, node);

      return;
    }

    if (node.type === 'userTask') {
      await this.createUserTaskForToken(manager, instance, token, node);

      return;
    }

    if (node.type === 'serviceTask') {
      await this.executeServiceTask(manager, instance, token, node);

      return;
    }

    if (node.type === 'exclusiveGateway') {
      await this.processExclusiveGateway(manager, instance, token, node);

      return;
    }

    if (node.type === 'parallelGateway') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    return;
  }

  private async processRunningInstance(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
  ): Promise<void> {
    for (let step = 0; step < MAX_PROCESSING_STEPS; step += 1) {
      const token = await manager.getRepository(WorkflowTokenEntity).findOne({
        order: { createdAt: 'ASC' },
        where: {
          instanceId: instance.id,
          status: WorkflowTokenStatusEnum.ACTIVE,
        },
      });

      if (!token) {
        return;
      }

      await this.processActiveToken(manager, instance, token);
    }

    throw new ConflictException(
      `Approval instance ${instance.id} exceeded maximum processing steps`,
    );
  }

  private async isNodeEntryReady(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<boolean> {
    if (node.type === 'startEvent') {
      return true;
    }

    const incomingEdges = readIncomingEdges(instance.workflowSnapshot, node.id);

    if (incomingEdges.length < 2) {
      return true;
    }

    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const activeOrWaitingTokens = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
      (candidate) =>
        candidate.currentNodeId === node.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING),
    );
    const arrivedTokens = activeOrWaitingTokens.some(
      (candidate) => candidate.id === token.id,
    )
      ? activeOrWaitingTokens
      : [...activeOrWaitingTokens, token];

    if ((node.data.triggerMode ?? 'AND') === 'OR') {
      await this.cancelAlternativeTokensForOrTrigger(
        manager,
        instance,
        token,
        node.id,
      );
      await this.consumeJoinedTokens(
        manager,
        arrivedTokens.filter((candidate) => candidate.id !== token.id),
      );

      return true;
    }

    if (arrivedTokens.length < incomingEdges.length) {
      await tokenRepository.save({
        ...token,
        status: WorkflowTokenStatusEnum.WAITING,
      });
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            arrivedCount: arrivedTokens.length,
            requiredCount: incomingEdges.length,
            tokenId: token.id,
            triggerMode: 'AND',
          },
          taskId: null,
        }),
      );

      return false;
    }

    await this.consumeJoinedTokens(
      manager,
      arrivedTokens.filter((candidate) => candidate.id !== token.id),
    );

    return true;
  }

  private async advanceTokenToOutgoingNodes(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<void> {
    const edges = readOutgoingEdgesOrThrow(instance.workflowSnapshot, node.id);

    if (edges.length === 1) {
      await this.advanceTokenAlongEdge(manager, instance, token, node, edges[0]);

      return;
    }

    await this.forkTokenAlongEdges(manager, instance, token, node, edges);
  }

  private async advanceTokenAlongEdge(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    edge: WorkflowEdge,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const nextToken = await tokenRepository.save({
      ...token,
      currentNodeId: edge.target,
    });

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: edge.target,
        payload: {
          edgeId: edge.id,
          fromNodeId: node.id,
          tokenId: nextToken.id,
          toNodeId: edge.target,
        },
        taskId: null,
      }),
    );
  }

  private async forkTokenAlongEdges(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    edges: readonly WorkflowEdge[],
  ): Promise<void> {
    const forkedAt = new Date();
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await tokenRepository.save({
      ...token,
      consumedAt: forkedAt,
      status: WorkflowTokenStatusEnum.CONSUMED,
    });

    const childTokens = await tokenRepository.save(
      edges.map((edge) =>
        tokenRepository.create({
          consumedAt: null,
          currentNodeId: edge.target,
          instanceId: instance.id,
          parentTokenId: token.id,
          status: WorkflowTokenStatusEnum.ACTIVE,
        }),
      ),
    );

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          edgeIds: edges.map((edge) => edge.id),
          fromNodeId: node.id,
          tokenId: token.id,
          toNodeIds: edges.map((edge) => edge.target),
        },
        taskId: null,
      }),
      ...childTokens.map((childToken, index) =>
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
          instanceId: instance.id,
          nodeId: childToken.currentNodeId,
          payload: {
            edgeId: edges[index]?.id,
            parentTokenId: token.id,
            tokenId: childToken.id,
          },
          taskId: null,
        }),
      ),
    ]);
  }

  private async completeTokenAtEndNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: Extract<WorkflowNode, { readonly type: 'endEvent' }>,
  ): Promise<void> {
    const completedAt = new Date();
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const endState = node.data.endState ?? 'APPROVED';
    const instanceState =
      endState === 'REJECTED'
        ? ApprovalInstanceStateEnum.REJECTED
        : ApprovalInstanceStateEnum.APPROVED;

    await tokenRepository.save({
      ...token,
      consumedAt: completedAt,
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    const hasOpenToken = (await tokenRepository.find({
      where: { instanceId: instance.id },
    })).some(
      (candidate) =>
        candidate.id !== token.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING),
    );

    if (!hasOpenToken) {
      await instanceRepository.save({
        ...instance,
        completedAt,
        state: instanceState,
      });
    }
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          endState,
          instanceState,
          tokenId: token.id,
        },
        taskId: null,
      }),
    );
  }

  private async createUserTaskForToken(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: UserTaskNode,
  ): Promise<void> {
    const taskRepository = manager.getRepository(TaskEntity);
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const existingTask = await taskRepository.findOne({
      where: {
        nodeId: node.id,
        tokenId: token.id,
      },
    });

    if (existingTask) {
      await tokenRepository.save({
        ...token,
        status: WorkflowTokenStatusEnum.WAITING,
      });

      return;
    }

    const assigneeMemberId = readDirectAssigneeMemberId(node);
    const task = await taskRepository.save(
      taskRepository.create({
        assigneeMemberId,
        completedAt: null,
        delegationChain: [],
        instanceId: instance.id,
        nodeId: node.id,
        openedAt: null,
        originalAssigneeMemberId: assigneeMemberId,
        slaDueAt: null,
        status: TaskStatusEnum.PENDING,
        tokenId: token.id,
      }),
    );

    await tokenRepository.save({
      ...token,
      status: WorkflowTokenStatusEnum.WAITING,
    });
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          assigneeMemberId,
          tokenId: token.id,
        },
        taskId: task.id,
      }),
    );
  }

  private async processExclusiveGateway(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: Extract<WorkflowNode, { readonly type: 'exclusiveGateway' }>,
  ): Promise<void> {
    if (node.data.direction !== 'split') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    const edge = readExclusiveGatewayEdgeOrThrow(
      instance.workflowSnapshot,
      node.id,
      instance.formData,
    );

    await this.advanceTokenAlongEdge(manager, instance, token, node, edge);
  }

  private async executeServiceTask(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: ServiceTaskNode,
  ): Promise<void> {
    if (node.data.action.type !== 'NOTIFY') {
      throw new ConflictException(
        `Service task ${node.id} action ${node.data.action.type} is not supported in linear processing`,
      );
    }

    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await tokenRepository.save({
      ...token,
      consumedAt: new Date(),
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          action: 'NOTIFY',
          tokenId: token.id,
        },
        taskId: null,
      }),
    );
  }

  private async rejectInstance(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    rejectedAt: Date,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);
    const activeTokens = await tokenRepository.find({
      where: { instanceId: instance.id },
    });
    const consumedTokens = activeTokens
      .filter(
        (token) =>
          token.status === WorkflowTokenStatusEnum.ACTIVE ||
          token.status === WorkflowTokenStatusEnum.WAITING,
      )
      .map(
        (token): WorkflowTokenEntity => ({
          ...token,
          consumedAt: rejectedAt,
          status: WorkflowTokenStatusEnum.CONSUMED,
        }),
      );

    if (consumedTokens.length) {
      await tokenRepository.save(consumedTokens);
    }

    await instanceRepository.save({
      ...instance,
      completedAt: rejectedAt,
      state: ApprovalInstanceStateEnum.REJECTED,
    });
    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          action: 'REJECTED',
          taskId: task.id,
        },
        taskId: task.id,
      }),
    );
  }

  private async consumeJoinedTokens(
    manager: EntityManager,
    tokens: readonly WorkflowTokenEntity[],
  ): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    const consumedAt = new Date();

    await manager.getRepository(WorkflowTokenEntity).save(
      tokens.map(
        (token): WorkflowTokenEntity => ({
          ...token,
          consumedAt,
          status: WorkflowTokenStatusEnum.CONSUMED,
        }),
      ),
    );
  }

  private async cancelAlternativeTokensForOrTrigger(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    targetNodeId: string,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const taskRepository = manager.getRepository(TaskEntity);
    const consumedAt = new Date();
    const tokens = await tokenRepository.find({
      where: { instanceId: instance.id },
    });
    const alternativeTokens = tokens.filter(
      (candidate) =>
        candidate.id !== token.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING) &&
        hasPathToNode(
          instance.workflowSnapshot,
          candidate.currentNodeId,
          targetNodeId,
        ),
    );

    if (alternativeTokens.length === 0) {
      return;
    }

    const alternativeTokenIds = alternativeTokens.map(
      (candidate) => candidate.id,
    );
    const cancellableTasks = (await taskRepository.find({
      where: { instanceId: instance.id },
    })).filter(
      (task) =>
        alternativeTokenIds.includes(task.tokenId) &&
        (task.status === TaskStatusEnum.PENDING ||
          task.status === TaskStatusEnum.IN_PROGRESS),
    );

    await tokenRepository.save(
      alternativeTokens.map(
        (candidate): WorkflowTokenEntity => ({
          ...candidate,
          consumedAt,
          status: WorkflowTokenStatusEnum.CONSUMED,
        }),
      ),
    );

    if (cancellableTasks.length) {
      await taskRepository.save(
        cancellableTasks.map((task): TaskEntity =>
          Object.assign(new TaskEntity(), task, {
            completedAt: consumedAt,
            status: TaskStatusEnum.CANCELLED,
          }),
        ),
      );
    }
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

function readWorkflowNodeOrThrow(
  workflow: WorkflowDefinition,
  nodeId: string,
): WorkflowNode {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new ConflictException(`Workflow node ${nodeId} was not found`);
  }

  return node;
}

function readOutgoingEdgesOrThrow(
  workflow: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdge[] {
  const edges = workflow.edges.filter((edge) => edge.source === nodeId);

  if (edges.length === 0) {
    throw new ConflictException(`Workflow node ${nodeId} has no outgoing edge`);
  }

  return edges;
}

function readIncomingEdges(
  workflow: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdge[] {
  return workflow.edges.filter((edge) => edge.target === nodeId);
}

function readExclusiveGatewayEdgeOrThrow(
  workflow: WorkflowDefinition,
  nodeId: string,
  formData: Readonly<Record<string, unknown>>,
): WorkflowEdge {
  const outgoingEdges = readOutgoingEdgesOrThrow(workflow, nodeId);
  const matchingEdge = outgoingEdges.find(
    (edge) =>
      !edge.data.isDefault &&
      evaluateWorkflowEdgeCondition(edge, { formData }),
  );

  if (matchingEdge) {
    return matchingEdge;
  }

  const defaultEdge = outgoingEdges.find((edge) => edge.data.isDefault);

  if (defaultEdge) {
    return defaultEdge;
  }

  throw new ConflictException(
    `Exclusive gateway ${nodeId} has no matching edge and no default edge`,
  );
}

function hasPathToNode(
  workflow: WorkflowDefinition,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  return visitPathToNode(workflow, sourceNodeId, targetNodeId, new Set());
}

function visitPathToNode(
  workflow: WorkflowDefinition,
  sourceNodeId: string,
  targetNodeId: string,
  visitedNodeIds: ReadonlySet<string>,
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }

  if (visitedNodeIds.has(sourceNodeId)) {
    return false;
  }

  const nextVisitedNodeIds = new Set([...visitedNodeIds, sourceNodeId]);

  return workflow.edges
    .filter((edge) => edge.source === sourceNodeId)
    .some((edge) =>
      visitPathToNode(workflow, edge.target, targetNodeId, nextVisitedNodeIds),
    );
}

function readDirectAssigneeMemberId(node: UserTaskNode): string {
  const resolver = node.data.approverResolver;

  if (resolver.type !== 'DIRECT') {
    throw new ConflictException(
      `User task ${node.id} approver resolver ${resolver.type} is not supported yet`,
    );
  }

  const memberId = resolver.memberIds[0]?.trim();

  if (!memberId) {
    throw new ConflictException(
      `User task ${node.id} does not include a primary approver`,
    );
  }

  return memberId;
}
