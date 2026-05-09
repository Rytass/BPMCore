import {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  UserTaskNode,
  ServiceTaskNode,
  ApproverResolver,
  ReturnResubmitStrategy,
} from '@bpm/shared/workflow';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  DelegationService,
  DelegationStep,
} from '../delegation/delegation.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ConditionService } from '../condition/condition.service';
import { MembershipEntity } from '../organization/membership.entity';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { DecideTaskInput } from './dto/decide-task.input';
import { DryRunApprovalWorkflowInput } from './dto/dry-run-approval-workflow.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
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
import {
  WorkflowDryRunResultObject,
  WorkflowDryRunStepObject,
} from './workflow-dry-run.object';
import { WorkflowTokenEntity } from './workflow-token.entity';

const MAX_PROCESSING_STEPS = 500;
const SYSTEM_DRY_RUN_INSTANCE_ID = 'dry-run-instance';

interface DryRunSimulationInput {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly initiatorMetadataSnapshot: Readonly<Record<string, unknown>>;
  readonly workflowDefinition: WorkflowDefinition;
}

interface DryRunPathInput extends DryRunSimulationInput {
  readonly depth: number;
  readonly incomingEdge: WorkflowEdge | null;
  readonly lastDecision: Readonly<Record<string, unknown>> | null;
  readonly nodeId: string;
  readonly steps: readonly WorkflowDryRunStepObject[];
  readonly visitedNodeIds: ReadonlySet<string>;
}

interface ReturnedInstanceContext {
  readonly resubmitStrategy: ReturnResubmitStrategy;
  readonly returnedFromNodeId: string;
  readonly returnToNodeId: string;
}

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
    private readonly conditionService: ConditionService,
    private readonly delegationService: DelegationService,
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

    if (
      !this.conditionService.evaluateBoolean(
        templateVersion.initiatorPolicyCel,
        buildInitiatorPolicyContext(initiatorMetadataSnapshot),
        'initiatorPolicyCel',
      )
    ) {
      throw new ConflictException(
        'Current member is not allowed to start this approval template',
      );
    }

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
          input.action !== TaskDecisionActionEnum.REJECTED &&
          input.action !== TaskDecisionActionEnum.RETURNED &&
          input.action !== TaskDecisionActionEnum.TRANSFERRED
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
        const transferToMemberId = input.transferToMemberId?.trim() || null;

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          !transferToMemberId
        ) {
          throw new BadRequestException('Transfer target member is required');
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          transferToMemberId === task.assigneeMemberId
        ) {
          throw new ConflictException(
            'Transfer target must be a different member',
          );
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

        const returnToNodeId =
          input.action === TaskDecisionActionEnum.RETURNED
            ? readReturnTargetNodeId(
                instance.workflowSnapshot,
                task.nodeId,
                input.returnToNodeId,
              )
            : null;
        const decidedAt = new Date();
        const decision = await taskDecisionRepository.save(
          taskDecisionRepository.create({
            action: input.action,
            comment: decisionComment,
            decidedAt,
            decidedByMemberId: input.decidedByMemberId,
            returnToNodeId,
            signatureId: null,
            taskId: task.id,
            transferToMemberId,
          }),
        );

        if (input.action === TaskDecisionActionEnum.TRANSFERRED) {
          await this.transferTask(
            manager,
            instance,
            task,
            decision,
            transferToMemberId,
            decisionComment,
            decidedAt,
          );

          return decision;
        }

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

        if (input.action === TaskDecisionActionEnum.RETURNED) {
          await this.returnInstanceToNode(
            manager,
            instance,
            task,
            returnToNodeId,
            decidedAt,
          );

          return decision;
        }

        await this.rejectInstance(manager, instance, task, decidedAt);

        return decision;
      },
    );
  }

  async cancelApprovalInstance(
    input: CancelApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          input.instanceId,
        ]);

        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const instance = await instanceRepository.findOne({
          where: { id: input.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${input.instanceId} was not found`,
          );
        }

        if (instance.initiatorMemberId !== input.cancelledByMemberId) {
          throw new ConflictException(
            `Approval instance ${instance.id} can only be cancelled by its initiator`,
          );
        }

        if (
          instance.state !== ApprovalInstanceStateEnum.RUNNING &&
          instance.state !== ApprovalInstanceStateEnum.RETURNED
        ) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not cancellable`,
          );
        }

        const cancelledAt = new Date();
        await this.consumeOpenRuntimeState(
          manager,
          instance,
          cancelledAt,
          TaskStatusEnum.CANCELLED,
        );
        const cancelledInstance = await instanceRepository.save({
          ...instance,
          completedAt: cancelledAt,
          state: ApprovalInstanceStateEnum.CANCELLED,
        });

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: input.cancelledByMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_CANCELLED,
            instanceId: instance.id,
            nodeId: null,
            payload: {
              comment: input.comment?.trim() || null,
            },
            taskId: null,
          }),
        );

        return cancelledInstance;
      },
    );
  }

  async resubmitApprovalInstance(
    input: ResubmitApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    const formData = parseJsonObject(input.formDataJson, 'formDataJson');

    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          input.instanceId,
        ]);

        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const instance = await instanceRepository.findOne({
          where: { id: input.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${input.instanceId} was not found`,
          );
        }

        if (instance.initiatorMemberId !== input.initiatorMemberId) {
          throw new ConflictException(
            `Approval instance ${instance.id} can only be resubmitted by its initiator`,
          );
        }

        if (instance.state !== ApprovalInstanceStateEnum.RETURNED) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not returned`,
          );
        }

        const resubmittedInstance = await instanceRepository.save({
          ...instance,
          completedAt: null,
          formData,
          state: ApprovalInstanceStateEnum.RUNNING,
          title: input.title?.trim() || instance.title,
        });
        const returnedContext = await this.readLatestReturnedInstanceContext(
          manager,
          instance.id,
        );
        const runtimeInstance =
          returnedContext?.resubmitStrategy === 'FROM_RETURN_POINT'
            ? await this.resumeReturnedInstanceFromReturnPoint(
                manager,
                resubmittedInstance,
                returnedContext,
                new Date(),
              )
            : resubmittedInstance;

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: input.initiatorMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
            instanceId: instance.id,
            nodeId: null,
            payload: {
              resubmitStrategy: returnedContext?.resubmitStrategy ?? 'RESTART',
            },
            taskId: null,
          }),
        );
        await this.processRunningInstance(manager, runtimeInstance);

        return runtimeInstance;
      },
    );
  }

  dryRunApprovalWorkflow(
    input: DryRunApprovalWorkflowInput,
  ): WorkflowDryRunResultObject {
    const workflowDefinition = parseWorkflowDefinition(
      input.workflowDefinitionJson,
    );
    const formData = parseJsonObject(input.formDataJson, 'formDataJson');
    const initiatorMetadataSnapshot = input.initiatorMetadataSnapshotJson
      ? parseJsonObject(
          input.initiatorMetadataSnapshotJson,
          'initiatorMetadataSnapshotJson',
        )
      : readDefaultInitiatorMetadataSnapshot(input.initiatorMemberId);

    try {
      return Object.assign(new WorkflowDryRunResultObject(), {
        errors: [],
        steps: this.simulateWorkflow({
          formData,
          initiatorMemberId: input.initiatorMemberId,
          initiatorMetadataSnapshot,
          workflowDefinition,
        }),
        valid: true,
      });
    } catch (error: unknown) {
      return Object.assign(new WorkflowDryRunResultObject(), {
        errors: [error instanceof Error ? error.message : 'Dry run failed'],
        steps: [],
        valid: false,
      });
    }
  }

  private simulateWorkflow(
    input: DryRunSimulationInput,
  ): readonly WorkflowDryRunStepObject[] {
    const startNode = input.workflowDefinition.nodes.find(
      (node) => node.type === 'startEvent',
    );

    if (!startNode) {
      throw new BadRequestException('Workflow does not include a startEvent');
    }

    return this.simulateWorkflowPath({
      ...input,
      depth: 0,
      incomingEdge: null,
      lastDecision: null,
      nodeId: startNode.id,
      steps: [],
      visitedNodeIds: new Set(),
    });
  }

  private simulateWorkflowPath(
    input: DryRunPathInput,
  ): readonly WorkflowDryRunStepObject[] {
    if (input.depth > MAX_PROCESSING_STEPS) {
      throw new ConflictException('Dry run exceeded maximum processing steps');
    }

    const node = readWorkflowNodeOrThrow(
      input.workflowDefinition,
      input.nodeId,
    );
    const visitKey = `${input.nodeId}:${input.incomingEdge?.id ?? 'start'}`;
    const entryCondition = readNodeEntryCondition(node);

    if (input.visitedNodeIds.has(visitKey)) {
      return [
        ...input.steps,
        createDryRunStep({
          assigneeMemberId: null,
          edge: input.incomingEdge,
          edgeMatched: null,
          edgeReason: null,
          entryCondition,
          entryConditionMet: null,
          message: '偵測到循環路徑，已停止此分支。',
          node,
          status: 'STOPPED',
          stepIndex: input.steps.length,
        }),
      ];
    }

    const nextVisitedNodeIds = new Set([...input.visitedNodeIds, visitKey]);
    const entryConditionMet = this.conditionService.evaluateBoolean(
      entryCondition,
      buildDryRunExpressionContext(input, input.lastDecision),
      `workflow.nodes.${node.id}.data.entryCondition`,
    );
    const assigneeMemberId =
      entryConditionMet && node.type === 'userTask'
        ? this.resolveDryRunAssigneeMemberId(
            input,
            node.data.approverResolver,
            `workflow.nodes.${node.id}.data.approverResolver`,
          )
        : null;
    const nextLastDecision =
      entryConditionMet && node.type === 'userTask'
        ? {
            action: TaskDecisionActionEnum.APPROVED,
            assigneeMemberId,
            nodeId: node.id,
          }
        : input.lastDecision;
    const nextSteps = [
      ...input.steps,
      createDryRunStep({
        assigneeMemberId,
        edge: input.incomingEdge,
        edgeMatched: input.incomingEdge ? true : null,
        edgeReason: readDryRunEdgeReason(input.incomingEdge),
        entryCondition,
        entryConditionMet,
        message: readDryRunStepMessage(node, entryConditionMet),
        node,
        status: readDryRunStepStatus(node, entryConditionMet),
        stepIndex: input.steps.length,
      }),
    ];

    if (!entryConditionMet || node.type === 'endEvent') {
      if (node.type === 'endEvent') {
        return nextSteps;
      }

      return readOutgoingEdgesOrThrow(input.workflowDefinition, node.id).reduce(
        (steps, edge) =>
          this.simulateWorkflowPath({
            ...input,
            depth: input.depth + 1,
            incomingEdge: edge,
            lastDecision: nextLastDecision,
            nodeId: edge.target,
            steps,
            visitedNodeIds: nextVisitedNodeIds,
          }),
        nextSteps,
      );
    }

    const outgoingEdges = this.readDryRunAvailableOutgoingEdges(
      input,
      node,
      nextLastDecision,
    );

    return outgoingEdges.reduce(
      (steps, edge) =>
        this.simulateWorkflowPath({
          ...input,
          depth: input.depth + 1,
          incomingEdge: edge,
          lastDecision: nextLastDecision,
          nodeId: edge.target,
          steps,
          visitedNodeIds: nextVisitedNodeIds,
        }),
      nextSteps,
    );
  }

  private readDryRunAvailableOutgoingEdges(
    input: DryRunSimulationInput,
    node: WorkflowNode,
    lastDecision: Readonly<Record<string, unknown>> | null,
  ): readonly WorkflowEdge[] {
    if (node.type === 'endEvent') {
      return [];
    }

    const outgoingEdges = readOutgoingEdgesOrThrow(
      input.workflowDefinition,
      node.id,
    );
    const conditionalEdges = outgoingEdges.filter(
      (edge) => !edge.data.isDefault && edgeHasCondition(edge),
    );

    if (conditionalEdges.length === 0) {
      return outgoingEdges;
    }

    const matchingEdges = conditionalEdges.filter((edge) =>
      this.evaluateDryRunEdge(input, edge, lastDecision),
    );

    if (matchingEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [matchingEdges[0]]
        : matchingEdges;
    }

    const defaultEdges = outgoingEdges.filter((edge) => edge.data.isDefault);

    if (defaultEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [defaultEdges[0]]
        : defaultEdges;
    }

    throw new ConflictException(
      `Workflow node ${node.id} has no matching outgoing edge`,
    );
  }

  private evaluateDryRunEdge(
    input: DryRunSimulationInput,
    edge: WorkflowEdge,
    lastDecision: Readonly<Record<string, unknown>> | null,
  ): boolean {
    const expression = edge.data.condition?.trim();

    if (expression) {
      return this.conditionService.evaluateBoolean(
        expression,
        buildDryRunExpressionContext(input, lastDecision),
        `workflow.edges.${edge.id}.data.condition`,
      );
    }

    return evaluateWorkflowEdgeCondition(edge, { formData: input.formData });
  }

  private resolveDryRunAssigneeMemberId(
    input: DryRunSimulationInput,
    resolver: ApproverResolver,
    label: string,
  ): string {
    if (resolver.type === 'DIRECT') {
      return readMemberIdFromValue(resolver.memberIds, label);
    }

    if (resolver.type === 'DYNAMIC_FORM') {
      return readMemberIdFromValue(
        readValueAtPath(input.formData, resolver.formPath),
        `${label}.formPath`,
      );
    }

    if (resolver.type === 'EXPRESSION') {
      return readMemberIdFromValue(
        this.conditionService.evaluateValue(
          resolver.expression,
          buildDryRunExpressionContext(input, null),
          `${label}.expression`,
        ),
        `${label}.expression`,
      );
    }

    if (resolver.type === 'POSITION') {
      return `position:${resolver.positionId}`;
    }

    return readMemberIdFromValue(
      readManagerMemberIdFromInitiatorSnapshot(
        input.initiatorMetadataSnapshot,
        resolver.levelsUp,
      ),
      label,
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

    if (!this.isNodeEntryConditionMet(instance, node)) {
      await this.skipNodeByEntryCondition(manager, instance, token, node);

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
    const edges = await this.readAvailableOutgoingEdges(
      manager,
      instance,
      node,
    );

    if (edges.length === 1) {
      await this.advanceTokenAlongEdge(
        manager,
        instance,
        token,
        node,
        edges[0],
      );

      return;
    }

    await this.forkTokenAlongEdges(manager, instance, token, node, edges);
  }

  private isNodeEntryConditionMet(
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
  ): boolean {
    const entryCondition = readNodeEntryCondition(node);

    return this.conditionService.evaluateBoolean(
      entryCondition,
      buildWorkflowExpressionContext(instance),
      `workflow.nodes.${node.id}.data.entryCondition`,
    );
  }

  private async skipNodeByEntryCondition(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<void> {
    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          skippedByEntryCondition: true,
          tokenId: token.id,
        },
        taskId: null,
      }),
    );
    await this.advanceTokenToOutgoingNodes(manager, instance, token, node);
  }

  private async readAvailableOutgoingEdges(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
  ): Promise<readonly WorkflowEdge[]> {
    const outgoingEdges = readOutgoingEdgesOrThrow(
      instance.workflowSnapshot,
      node.id,
    );
    const conditionalEdges = outgoingEdges.filter(
      (edge) => !edge.data.isDefault && edgeHasCondition(edge),
    );

    if (conditionalEdges.length === 0) {
      return outgoingEdges;
    }

    const matchingEdges = (
      await Promise.all(
        conditionalEdges.map(
          async (edge): Promise<WorkflowEdge | null> =>
            (await this.evaluateWorkflowEdge(manager, instance, node, edge))
              ? edge
              : null,
        ),
      )
    ).filter((edge): edge is WorkflowEdge => edge !== null);

    if (matchingEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [matchingEdges[0]]
        : matchingEdges;
    }

    const defaultEdges = outgoingEdges.filter((edge) => edge.data.isDefault);

    if (defaultEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [defaultEdges[0]]
        : defaultEdges;
    }

    throw new ConflictException(
      `Workflow node ${node.id} has no matching outgoing edge`,
    );
  }

  private async evaluateWorkflowEdge(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
    edge: WorkflowEdge,
  ): Promise<boolean> {
    const expression = edge.data.condition?.trim();

    if (expression) {
      return this.conditionService.evaluateBoolean(
        expression,
        {
          ...buildWorkflowExpressionContext(instance),
          lastDecision: await this.readLastDecisionContext(
            manager,
            instance.id,
            node.id,
          ),
        },
        `workflow.edges.${edge.id}.data.condition`,
      );
    }

    return evaluateWorkflowEdgeCondition(edge, { formData: instance.formData });
  }

  private async readLastDecisionContext(
    manager: EntityManager,
    instanceId: string,
    nodeId: string,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    const tasks = await manager.getRepository(TaskEntity).find({
      where: { instanceId, nodeId },
    });
    const taskIds = tasks.map((task) => task.id);

    if (taskIds.length === 0) {
      return null;
    }

    const decision = (
      await manager.getRepository(TaskDecisionEntity).find({
        order: { decidedAt: 'DESC' },
        where: { taskId: In(taskIds) },
      })
    )[0];

    if (!decision) {
      return null;
    }

    return {
      action: decision.action,
      comment: decision.comment,
      decidedAt: decision.decidedAt.toISOString(),
      decidedByMemberId: decision.decidedByMemberId,
      returnToNodeId: decision.returnToNodeId,
      taskId: decision.taskId,
      transferToMemberId: decision.transferToMemberId,
    };
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
    const hasOpenToken = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).some(
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

    const assigneeMemberId = await this.resolveAssigneeMemberId(
      manager,
      instance,
      node,
    );
    const delegationResolution = await this.delegationService.resolveAssignee(
      assigneeMemberId,
      {
        formData: instance.formData,
        initiatorMemberId: instance.initiatorMemberId,
        initiatorMetadataSnapshot: instance.initiatorMetadataSnapshot,
        instanceId: instance.id,
        nodeId: node.id,
        state: instance.state,
        templateId: instance.templateId,
        templateVersionId: instance.templateVersionId,
        title: instance.title,
      },
    );
    const task = await taskRepository.save(
      taskRepository.create({
        assigneeMemberId: delegationResolution.finalAssigneeMemberId,
        completedAt: null,
        delegationChain: delegationResolution.delegationChain,
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
          assigneeMemberId: delegationResolution.finalAssigneeMemberId,
          delegationChain: delegationResolution.delegationChain,
          originalAssigneeMemberId: assigneeMemberId,
          tokenId: token.id,
        },
        taskId: task.id,
      }),
    );
  }

  private async transferTask(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    decision: TaskDecisionEntity,
    transferToMemberId: string | null,
    decisionComment: string | null,
    decidedAt: Date,
  ): Promise<void> {
    if (!transferToMemberId) {
      throw new BadRequestException('Transfer target member is required');
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const nextDelegationChain: readonly DelegationStep[] = [
      ...readDelegationSteps(task.delegationChain),
      {
        from: task.assigneeMemberId,
        reason: 'MANUAL_TRANSFER',
        ruleId: null,
        to: transferToMemberId,
      },
    ];
    const transferredTask = await taskRepository.save({
      ...task,
      completedAt: decidedAt,
      delegationChain: nextDelegationChain,
      status: TaskStatusEnum.TRANSFERRED,
    });
    const nextTask = await taskRepository.save(
      taskRepository.create({
        assigneeMemberId: transferToMemberId,
        completedAt: null,
        delegationChain: nextDelegationChain,
        instanceId: task.instanceId,
        nodeId: task.nodeId,
        openedAt: null,
        originalAssigneeMemberId: task.originalAssigneeMemberId,
        slaDueAt: task.slaDueAt,
        status: TaskStatusEnum.PENDING,
        tokenId: task.tokenId,
      }),
    );

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          action: TaskDecisionActionEnum.TRANSFERRED,
          comment: decisionComment,
          decisionId: decision.id,
          transferToMemberId,
        },
        taskId: transferredTask.id,
      }),
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          assigneeMemberId: transferToMemberId,
          delegationChain: nextDelegationChain,
          originalAssigneeMemberId: task.originalAssigneeMemberId,
          tokenId: task.tokenId,
          transferredFromTaskId: task.id,
        },
        taskId: nextTask.id,
      }),
    ]);
  }

  private async resolveAssigneeMemberId(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
  ): Promise<string> {
    return this.resolveApproverResolver(
      manager,
      instance,
      node.data.approverResolver,
      `workflow.nodes.${node.id}.data.approverResolver`,
    );
  }

  private async resolveApproverResolver(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: ApproverResolver,
    label: string,
  ): Promise<string> {
    if (resolver.type === 'DIRECT') {
      return readMemberIdFromValue(resolver.memberIds, label);
    }

    if (resolver.type === 'DYNAMIC_FORM') {
      return readMemberIdFromValue(
        readValueAtPath(instance.formData, resolver.formPath),
        `${label}.formPath`,
      );
    }

    if (resolver.type === 'EXPRESSION') {
      return readMemberIdFromValue(
        this.conditionService.evaluateValue(
          resolver.expression,
          buildWorkflowExpressionContext(instance),
          `${label}.expression`,
        ),
        `${label}.expression`,
      );
    }

    if (resolver.type === 'POSITION') {
      return this.resolvePositionAssignee(manager, resolver.positionId, label);
    }

    return readMemberIdFromValue(
      readManagerMemberIdFromInitiatorSnapshot(
        instance.initiatorMetadataSnapshot,
        resolver.levelsUp,
      ),
      label,
    );
  }

  private async resolvePositionAssignee(
    manager: EntityManager,
    positionId: string,
    label: string,
  ): Promise<string> {
    const today = toDateOnlyString(new Date());
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { positionId },
    });
    const activeMembership = memberships
      .filter(
        (membership) =>
          membership.effectiveFrom <= today &&
          (!membership.effectiveTo || membership.effectiveTo >= today),
      )
      .sort((first, second) => {
        if (first.isPrimary !== second.isPrimary) {
          return first.isPrimary ? -1 : 1;
        }

        return second.effectiveFrom.localeCompare(first.effectiveFrom);
      })[0];

    if (!activeMembership) {
      throw new ConflictException(
        `${label} position ${positionId} has no active membership`,
      );
    }

    return activeMembership.memberId;
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

    const edge = (
      await this.readAvailableOutgoingEdges(manager, instance, node)
    )[0];

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

  private async returnInstanceToNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    returnToNodeId: string | null,
    returnedAt: Date,
  ): Promise<void> {
    if (!returnToNodeId) {
      throw new ConflictException('Return target node is required');
    }

    const targetNode = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      returnToNodeId,
    );
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await this.consumeOpenRuntimeState(
      manager,
      instance,
      returnedAt,
      TaskStatusEnum.CANCELLED,
    );

    const returnedInstance = await instanceRepository.save({
      ...instance,
      completedAt: null,
      state:
        targetNode.type === 'startEvent'
          ? ApprovalInstanceStateEnum.RETURNED
          : ApprovalInstanceStateEnum.RUNNING,
    });
    const resubmitStrategy = readReturnResubmitStrategy(task, instance);
    const returnToken = await tokenRepository.save(
      tokenRepository.create({
        consumedAt: null,
        currentNodeId: targetNode.id,
        instanceId: instance.id,
        parentTokenId: null,
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
    );

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          resubmitStrategy,
          returnedFromNodeId: task.nodeId,
          returnToNodeId: targetNode.id,
          taskId: task.id,
        },
        taskId: task.id,
      }),
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
        instanceId: instance.id,
        nodeId: targetNode.id,
        payload: {
          returnedFromNodeId: task.nodeId,
          tokenId: returnToken.id,
        },
        taskId: null,
      }),
    ]);

    if (returnedInstance.state === ApprovalInstanceStateEnum.RUNNING) {
      await this.processRunningInstance(manager, returnedInstance);
    }
  }

  private async readLatestReturnedInstanceContext(
    manager: EntityManager,
    instanceId: string,
  ): Promise<ReturnedInstanceContext | null> {
    const activity = await manager.getRepository(ActivityLogEntity).findOne({
      order: { createdAt: 'DESC' },
      where: {
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        instanceId,
      },
    });

    if (!activity) {
      return null;
    }

    const returnToNodeId = readStringPayloadValue(
      activity.payload,
      'returnToNodeId',
    );
    const returnedFromNodeId =
      readStringPayloadValue(activity.payload, 'returnedFromNodeId') ??
      activity.nodeId;

    if (!returnToNodeId || !returnedFromNodeId) {
      return null;
    }

    return {
      resubmitStrategy: readReturnResubmitStrategyFromPayload(activity.payload),
      returnedFromNodeId,
      returnToNodeId,
    };
  }

  private async resumeReturnedInstanceFromReturnPoint(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    context: ReturnedInstanceContext,
    resubmittedAt: Date,
  ): Promise<ApprovalInstanceEntity> {
    const targetNode = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      context.returnToNodeId,
    );

    if (targetNode.type !== 'startEvent') {
      return instance;
    }

    readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      context.returnedFromNodeId,
    );

    await this.consumeOpenRuntimeState(
      manager,
      instance,
      resubmittedAt,
      TaskStatusEnum.CANCELLED,
    );

    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const returnPointToken = await tokenRepository.save(
      tokenRepository.create({
        consumedAt: null,
        currentNodeId: context.returnedFromNodeId,
        instanceId: instance.id,
        parentTokenId: null,
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
    );

    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
        instanceId: instance.id,
        nodeId: context.returnedFromNodeId,
        payload: {
          resubmitStrategy: context.resubmitStrategy,
          resumedFromNodeId: context.returnToNodeId,
          tokenId: returnPointToken.id,
        },
        taskId: null,
      }),
    );

    return instance;
  }

  private async consumeOpenRuntimeState(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    consumedAt: Date,
    taskStatus: TaskStatusEnum,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const taskRepository = manager.getRepository(TaskEntity);
    const tokens = await tokenRepository.find({
      where: { instanceId: instance.id },
    });
    const openTokens = tokens.filter(
      (token) =>
        token.status === WorkflowTokenStatusEnum.ACTIVE ||
        token.status === WorkflowTokenStatusEnum.WAITING,
    );
    const tasks = await taskRepository.find({
      where: { instanceId: instance.id },
    });
    const openTasks = tasks.filter(
      (task) =>
        task.status === TaskStatusEnum.PENDING ||
        task.status === TaskStatusEnum.IN_PROGRESS,
    );

    if (openTokens.length > 0) {
      await tokenRepository.save(
        openTokens.map(
          (token): WorkflowTokenEntity => ({
            ...token,
            consumedAt,
            status: WorkflowTokenStatusEnum.CONSUMED,
          }),
        ),
      );
    }

    if (openTasks.length > 0) {
      await taskRepository.save(
        openTasks.map(
          (openTask): TaskEntity =>
            Object.assign(new TaskEntity(), openTask, {
              completedAt: consumedAt,
              status: taskStatus,
            }),
        ),
      );
    }
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
    const cancellableTasks = (
      await taskRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
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
        cancellableTasks.map(
          (task): TaskEntity =>
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

function parseWorkflowDefinition(value: string): WorkflowDefinition {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (
      isRecord(parsedValue) &&
      Array.isArray(parsedValue.nodes) &&
      Array.isArray(parsedValue.edges) &&
      isRecord(parsedValue.meta)
    ) {
      return parsedValue as unknown as WorkflowDefinition;
    }

    throw new BadRequestException(
      'workflowDefinitionJson must be a workflow definition object',
    );
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException(
      error instanceof Error
        ? error.message
        : 'workflowDefinitionJson is invalid JSON',
    );
  }
}

function buildInitiatorPolicyContext(
  initiatorMetadataSnapshot: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    initiator: initiatorMetadataSnapshot,
    subject: initiatorMetadataSnapshot,
  };
}

function buildWorkflowExpressionContext(
  instance: ApprovalInstanceEntity,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    form: instance.formData,
    formData: instance.formData,
    initiator: {
      ...instance.initiatorMetadataSnapshot,
      memberId: instance.initiatorMemberId,
    },
    instance: {
      id: instance.id,
      state: instance.state,
      templateId: instance.templateId,
      templateVersionId: instance.templateVersionId,
      title: instance.title,
    },
  };
}

function readDelegationSteps(
  value: readonly Readonly<Record<string, unknown>>[],
): readonly DelegationStep[] {
  return value
    .map((step): DelegationStep | null => {
      const from = readStringValue(step.from);
      const to = readStringValue(step.to);
      const reason = readStringValue(step.reason);

      if (!from || !to || !reason) {
        return null;
      }

      return {
        from,
        reason,
        ruleId: readStringValue(step.ruleId),
        to,
      };
    })
    .filter((step): step is DelegationStep => step !== null);
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function buildDryRunExpressionContext(
  input: DryRunSimulationInput,
  lastDecision: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    form: input.formData,
    formData: input.formData,
    initiator: {
      ...input.initiatorMetadataSnapshot,
      memberId: input.initiatorMemberId,
    },
    instance: {
      id: SYSTEM_DRY_RUN_INSTANCE_ID,
      state: ApprovalInstanceStateEnum.RUNNING,
      title: 'Dry Run',
    },
    lastDecision,
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

function readReturnTargetNodeId(
  workflow: WorkflowDefinition,
  currentNodeId: string,
  requestedNodeId?: string | null,
): string {
  const currentNode = readWorkflowNodeOrThrow(workflow, currentNodeId);

  if (currentNode.type !== 'userTask') {
    throw new ConflictException(
      `Workflow node ${currentNodeId} does not support return decisions`,
    );
  }

  if (!currentNode.data.returnBehavior.allowReturn) {
    throw new ConflictException(
      `User task ${currentNodeId} does not allow return decisions`,
    );
  }

  const trimmedRequestedNodeId = requestedNodeId?.trim() || null;
  const defaultTargetNodeId = readDefaultReturnTargetNodeId(
    workflow,
    currentNode,
  );

  if (currentNode.data.returnBehavior.allowedTargets === 'ANY') {
    if (!trimmedRequestedNodeId) {
      throw new BadRequestException('returnToNodeId is required');
    }

    readWorkflowNodeOrThrow(workflow, trimmedRequestedNodeId);

    return trimmedRequestedNodeId;
  }

  if (
    trimmedRequestedNodeId &&
    trimmedRequestedNodeId !== defaultTargetNodeId
  ) {
    throw new ConflictException(
      `User task ${currentNodeId} can only return to ${defaultTargetNodeId}`,
    );
  }

  return defaultTargetNodeId;
}

function readDefaultReturnTargetNodeId(
  workflow: WorkflowDefinition,
  currentNode: UserTaskNode,
): string {
  if (currentNode.data.returnBehavior.allowedTargets === 'INITIATOR') {
    const startNode = workflow.nodes.find((node) => node.type === 'startEvent');

    if (!startNode) {
      throw new ConflictException('Workflow does not include a startEvent');
    }

    return startNode.id;
  }

  const previousNodeId = readIncomingEdges(workflow, currentNode.id)[0]?.source;

  if (!previousNodeId) {
    throw new ConflictException(
      `User task ${currentNode.id} does not have a previous node to return to`,
    );
  }

  return previousNodeId;
}

function readReturnResubmitStrategy(
  task: TaskEntity,
  instance: ApprovalInstanceEntity,
): ReturnResubmitStrategy {
  const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, task.nodeId);

  if (node.type !== 'userTask') {
    return 'RESTART';
  }

  return node.data.returnBehavior.resubmitStrategy ?? 'RESTART';
}

function readReturnResubmitStrategyFromPayload(
  payload: Readonly<Record<string, unknown>>,
): ReturnResubmitStrategy {
  return payload.resubmitStrategy === 'FROM_RETURN_POINT'
    ? 'FROM_RETURN_POINT'
    : 'RESTART';
}

function readStringPayloadValue(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = payload[key];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNodeEntryCondition(node: WorkflowNode): string | null {
  if (node.type === 'userTask' || node.type === 'serviceTask') {
    return node.data.entryCondition?.trim() || null;
  }

  return null;
}

function edgeHasCondition(edge: WorkflowEdge): boolean {
  return Boolean(
    edge.data.condition?.trim() ||
    (edge.data.conditionFieldKey && edge.data.conditionOperator),
  );
}

function readMemberIdFromValue(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const memberId = value.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && Boolean(candidate.trim()),
    );

    if (memberId) {
      return memberId.trim();
    }
  }

  throw new ConflictException(`${label} did not resolve to a member id`);
}

function readValueAtPath(
  value: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  return path
    .split('.')
    .filter((segment) => segment.trim())
    .reduce<unknown>((currentValue, segment) => {
      if (!isRecord(currentValue)) {
        return undefined;
      }

      return currentValue[segment];
    }, value);
}

function readManagerMemberIdFromInitiatorSnapshot(
  initiatorMetadataSnapshot: Readonly<Record<string, unknown>>,
  levelsUp: number,
): unknown {
  const managerChain = initiatorMetadataSnapshot.managerChain;

  if (Array.isArray(managerChain)) {
    return managerChain[Math.max(levelsUp - 1, 0)];
  }

  const managerMemberIds = initiatorMetadataSnapshot.managerMemberIds;

  if (Array.isArray(managerMemberIds)) {
    return managerMemberIds[Math.max(levelsUp - 1, 0)];
  }

  const customFields = initiatorMetadataSnapshot.customFields;

  if (isRecord(customFields)) {
    return customFields.managerMemberId;
  }

  return initiatorMetadataSnapshot.managerMemberId;
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function createDryRunStep(input: {
  readonly assigneeMemberId: string | null;
  readonly edge: WorkflowEdge | null;
  readonly edgeMatched: boolean | null;
  readonly edgeReason: string | null;
  readonly entryCondition: string | null;
  readonly entryConditionMet: boolean | null;
  readonly message: string;
  readonly node: WorkflowNode;
  readonly status: string;
  readonly stepIndex: number;
}): WorkflowDryRunStepObject {
  return Object.assign(new WorkflowDryRunStepObject(), {
    assigneeMemberId: input.assigneeMemberId,
    edgeDefault: input.edge ? Boolean(input.edge.data.isDefault) : null,
    edgeId: input.edge?.id ?? null,
    edgeLabel: input.edge ? readDryRunEdgeLabel(input.edge) : null,
    edgeMatched: input.edgeMatched,
    edgeReason: input.edgeReason,
    entryCondition: input.entryCondition,
    entryConditionMatched: input.entryConditionMet,
    id: `dry-run-step-${input.stepIndex + 1}`,
    message: input.message,
    nodeId: input.node.id,
    nodeLabel: input.node.data.label,
    nodeType: input.node.type,
    status: input.status,
  });
}

function readDryRunEdgeLabel(edge: WorkflowEdge): string {
  return edge.data.label?.trim() || edge.id;
}

function readDryRunEdgeReason(edge: WorkflowEdge | null): string | null {
  if (!edge) {
    return null;
  }

  if (edge.data.isDefault) {
    return '其他條件不符合時採用預設路徑。';
  }

  const expression = edge.data.condition?.trim();

  if (expression) {
    return `條件成立：${expression}`;
  }

  if (edge.data.conditionFieldKey && edge.data.conditionOperator) {
    return `條件成立：${edge.data.conditionFieldKey} ${edge.data.conditionOperator}${
      edge.data.conditionValue ? ` ${edge.data.conditionValue}` : ''
    }`;
  }

  return '無條件路徑。';
}

function readDryRunStepStatus(
  node: WorkflowNode,
  entryConditionMet: boolean,
): string {
  if (!entryConditionMet) {
    return 'SKIPPED';
  }

  if (node.type === 'userTask') {
    return 'WAITING';
  }

  if (node.type === 'endEvent') {
    return 'COMPLETED';
  }

  return 'PASSED';
}

function readDryRunStepMessage(
  node: WorkflowNode,
  entryConditionMet: boolean,
): string {
  if (!entryConditionMet) {
    return '進入條件不符合，略過節點。';
  }

  if (node.type === 'userTask') {
    return '將建立待簽任務。';
  }

  if (node.type === 'endEvent') {
    return `流程結束：${node.data.endState ?? 'APPROVED'}`;
  }

  return '節點條件通過。';
}
