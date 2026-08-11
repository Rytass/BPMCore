import {
  FormDefinitionSchema,
  FormFieldDefinition,
  NumberFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  WorkflowDefinition,
  WorkflowEdge,
  DecisionPolicy,
  WorkflowNode,
  UserTaskNode,
  ServiceTaskNode,
  ApproverResolver,
  ApproverResolverFallback,
  ReturnResubmitStrategy,
} from '@rytass/bpm-core-shared/workflow';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { AttachmentService } from '../attachment/attachment.service';
import {
  DelegationService,
  DelegationStep,
} from '../delegation/delegation.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { BPMSlaScheduleService } from '../calendar/sla-schedule.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationEntity } from '../notification/notification.entity';
import {
  NotificationChannelEnum,
  NotificationResolutionEnum,
} from '../notification/notification.enums';
import { SignatureService } from '../signature/signature.service';
import { ConditionService } from '../condition/condition.service';
import { BPMAuthContext } from '../bpm-auth';
import { ManagerResolutionEntity } from '../organization/manager-resolution.entity';
import { MembershipEntity } from '../organization/membership.entity';
import { OrgUnitEntity } from '../organization/org-unit.entity';
import { ManagerResolutionScopeTypeEnum } from '../organization/organization.enums';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { DecideTaskInput } from './dto/decide-task.input';
import { DryRunApprovalWorkflowInput } from './dto/dry-run-approval-workflow.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import {
  AdhocDirectiveStatusEnum,
  AdhocDirectiveTypeEnum,
  AdhocPreApprovalRejectBehaviorEnum,
  AdhocTargetKindEnum,
} from './adhoc.enums';
import { AdhocTargetInput } from './dto/adhoc-target.input';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceListViewEnum,
  ApprovalInstanceStateEnum,
  TaskAssignmentTypeEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { evaluateWorkflowEdgeCondition } from './workflow-condition-evaluator';
import {
  WorkflowDryRunResultObject,
  WorkflowDryRunStepObject,
} from './workflow-dry-run.object';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  BPMWorkflowWebhookDispatchResult,
  DefaultWorkflowServiceTaskDispatcher,
} from './workflow-service-task-dispatcher.token';
import { WorkflowTokenEntity } from './workflow-token.entity';

const MAX_PROCESSING_STEPS = 500;
const DEFAULT_APPROVAL_HISTORY_TASK_LIMIT = 50;
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

/**
 * Delegation-chain reason recorded for an approver-initiated transfer, as
 * opposed to {@link SLA_ESCALATION_DELEGATION_REASON}.
 */
export const MANUAL_TRANSFER_DELEGATION_REASON = 'MANUAL_TRANSFER';

/**
 * Engine-internal decision knobs that are deliberately kept out of
 * {@link DecideTaskInput} so they never reach the GraphQL schema.
 */
export interface DecideTaskOptions {
  /**
   * Reason stamped on the delegation-chain step when the decision is a
   * transfer. Defaults to {@link MANUAL_TRANSFER_DELEGATION_REASON}.
   */
  readonly transferReason?: string;
}

interface ReturnedInstanceContext {
  readonly resubmitStrategy: ReturnResubmitStrategy;
  readonly returnedFromNodeId: string;
  readonly returnToNodeId: string;
}

interface ResolvedApproverCandidate {
  readonly memberId: string;
  readonly sourceType: ApproverResolver['type'];
}

interface RuntimeTaskCandidate {
  readonly delegationChain: readonly DelegationStep[];
  readonly memberId: string;
  readonly originalMemberId: string;
  readonly sourceType: ApproverResolver['type'];
}

type AdhocTargetValue = {
  readonly includeDescendants?: boolean;
  readonly kind: AdhocTargetKindEnum;
  readonly memberIds?: readonly string[];
  readonly orgUnitId?: string;
  readonly positionId?: string;
  readonly webhookHeaders?: Readonly<Record<string, string>>;
  readonly webhookUrl?: string;
};

type AdhocStageOutcome = 'APPROVED' | 'REJECTED' | 'RETURNED';

interface AdhocOperationContext {
  readonly instance: ApprovalInstanceEntity;
  readonly node: UserTaskNode;
  readonly task: TaskEntity;
}

interface ListApprovalInstancesOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly searchText?: string;
  readonly state?: readonly ApprovalInstanceStateEnum[];
  readonly templateId?: string;
  readonly view?: ApprovalInstanceListViewEnum;
}

interface WorkflowDashboardSummaryOptions {
  readonly from?: Date;
  readonly to?: Date;
}

type WorkflowReadScope = BPMAuthContext;
type FormConditionOperator =
  | 'equals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'notEquals';

const WORKFLOW_READ_ALL_PERMISSIONS = new Set([
  'bpm:*',
  'bpm.workflow.read_all',
  'bpm:workflow:read_all',
  'workflow.read_all',
]);

@Injectable()
export class WorkflowEngineService {
  constructor(
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(WorkflowTokenEntity)
    private readonly workflowTokenRepository: Repository<WorkflowTokenEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @InjectRepository(TaskCandidateEntity)
    private readonly taskCandidateRepository: Repository<TaskCandidateEntity>,
    @InjectRepository(TaskDecisionEntity)
    private readonly taskDecisionRepository: Repository<TaskDecisionEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
    @InjectRepository(AdhocDirectiveEntity)
    private readonly adhocDirectiveRepository: Repository<AdhocDirectiveEntity>,
    @InjectRepository(ApprovalTemplateEntity)
    private readonly approvalTemplateRepository: Repository<ApprovalTemplateEntity>,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly approvalTemplateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly attachmentService: AttachmentService,
    private readonly conditionService: ConditionService,
    private readonly delegationService: DelegationService,
    private readonly notificationService: NotificationService,
    private readonly signatureService: SignatureService,
    private readonly slaScheduleService: BPMSlaScheduleService,
    @Optional()
    @Inject(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER)
    private readonly serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher = new DefaultWorkflowServiceTaskDispatcher(),
  ) {}

  async submitApprovalInstance(
    input: SubmitApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    const formData = parseJsonObject(input.formDataJson, 'formDataJson');
    const template = await this.getTemplateOrThrow(input.templateId);

    if (!template.isActive) {
      throw new ConflictException('Approval template is deactivated');
    }

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
    validateSubmittedFormData(formDefinitionVersion.schema, formData);
    const initiatorMetadataSnapshot = input.initiatorMetadataSnapshotJson
      ? parseJsonObject(
          input.initiatorMetadataSnapshotJson,
          'initiatorMetadataSnapshotJson',
        )
      : await this.readDefaultInitiatorMetadataSnapshot(
          input.initiatorMemberId,
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
        await this.attachmentService.bindFormDataAttachmentsToInstance(
          manager,
          {
            formData,
            instanceId: instance.id,
          },
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
        await this.processRunningInstance(manager, instance);

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

  async decideTask(
    input: DecideTaskInput,
    options: DecideTaskOptions = {},
  ): Promise<TaskDecisionEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<TaskDecisionEntity> => {
        const taskRepository = manager.getRepository(TaskEntity);
        const taskCandidateRepository =
          manager.getRepository(TaskCandidateEntity);
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

        const { actorCandidate, taskCandidates } =
          await this.readTaskActorContext(manager, task, input.decidedByMemberId);

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
          transferToMemberId === input.decidedByMemberId
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

        const taskNode = readWorkflowNodeOrThrow(
          instance.workflowSnapshot,
          task.nodeId,
        );

        if (taskNode.type !== 'userTask') {
          throw new ConflictException(
            `Task ${task.id} is not bound to a user task node`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.REJECTED &&
          taskNode.data.allowReject === false
        ) {
          throw new ForbiddenException(
            `Workflow node ${task.nodeId} does not allow rejection`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          taskNode.data.allowTransfer === false
        ) {
          throw new ForbiddenException(
            `Workflow node ${task.nodeId} does not allow transfer`,
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

        // Read from the instance snapshot, not the live template: templates
        // that turn `requireComment` on later must not retroactively block
        // in-flight instances started against the previous version.
        if (
          input.action === TaskDecisionActionEnum.RETURNED &&
          !decisionComment &&
          isReturnCommentRequired(instance.workflowSnapshot, task.nodeId)
        ) {
          throw new BadRequestException(
            `Return decision comment is required by workflow node ${task.nodeId}`,
          );
        }
        const decidedAt = new Date();
        const claimedTask = await taskRepository.save({
          ...task,
          assigneeMemberId: task.assigneeMemberId ?? input.decidedByMemberId,
          openedAt: task.openedAt ?? decidedAt,
          originalAssigneeMemberId:
            task.originalAssigneeMemberId ??
            actorCandidate?.originalMemberId ??
            input.decidedByMemberId,
          status: TaskStatusEnum.IN_PROGRESS,
        });
        const claimedCandidate = actorCandidate
          ? await taskCandidateRepository.save({
              ...actorCandidate,
              claimedAt: actorCandidate.claimedAt ?? decidedAt,
              status: TaskCandidateStatusEnum.CLAIMED,
            })
          : null;
        const signature = await this.signatureService.signTaskDecision(
          manager,
          {
            action: input.action,
            comment: decisionComment,
            decidedAt,
            instance,
            returnToNodeId,
            signerMemberId: input.decidedByMemberId,
            task: claimedTask,
            transferToMemberId,
          },
        );
        const decision = await taskDecisionRepository.save(
          taskDecisionRepository.create({
            action: input.action,
            comment: decisionComment,
            decidedAt,
            decidedByMemberId: input.decidedByMemberId,
            returnToNodeId,
            signatureId: signature.id,
            taskId: task.id,
            transferToMemberId,
          }),
        );

        if (input.action === TaskDecisionActionEnum.TRANSFERRED) {
          await this.transferTask(
            manager,
            instance,
            claimedTask,
            decision,
            signature,
            transferToMemberId,
            decisionComment,
            decidedAt,
            claimedCandidate,
            options.transferReason ?? MANUAL_TRANSFER_DELEGATION_REASON,
          );

          await this.notificationService.resolveTaskNotifications({
            actingMemberId: input.decidedByMemberId,
            manager,
            resolution: NotificationResolutionEnum.TRANSFERRED,
            supersedeOthers: true,
            taskId: claimedTask.id,
          });

          return decision;
        }

        const nextCandidateRows = await this.markTaskCandidateDecision({
          action: input.action,
          candidate: claimedCandidate,
          candidates: taskCandidates,
          decidedAt,
          manager,
          task: claimedTask,
        });
        const shouldCompleteTask = shouldCompleteTaskAfterDecision({
          action: input.action,
          candidates: nextCandidateRows,
          decisionPolicy: readDecisionPolicySnapshot(claimedTask),
        });
        const completedTask = shouldCompleteTask
          ? await taskRepository.save({
              ...claimedTask,
              completedAt: decidedAt,
              status: TaskStatusEnum.COMPLETED,
            })
          : await taskRepository.save({
              ...claimedTask,
              status: TaskStatusEnum.IN_PROGRESS,
            });

        await activityRepository.save(
          activityRepository.create({
            actorMemberId: input.decidedByMemberId,
            eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
            instanceId: instance.id,
            nodeId: claimedTask.nodeId,
            payload: {
              action: input.action,
              comment: decisionComment,
              decisionId: decision.id,
              signatureId: signature.id,
              signedPayloadHash: signature.signedPayloadHash,
            },
            taskId: completedTask.id,
          }),
        );

        // Resolve the recipient's "待簽" notification so its inline 同意/拒絕
        // actions disappear once the task is decided. When the task has ended
        // (rejected / returned, or an approval that completed it), every other
        // candidate's notification is superseded too; a non-completing approval
        // on a multi-approver task leaves the remaining approvers' open.
        const taskEnded =
          input.action !== TaskDecisionActionEnum.APPROVED || shouldCompleteTask;

        await this.notificationService.resolveTaskNotifications({
          actingMemberId: input.decidedByMemberId,
          manager,
          resolution: mapDecisionToResolution(input.action),
          supersedeOthers: taskEnded,
          taskId: completedTask.id,
        });

        if (
          input.action === TaskDecisionActionEnum.APPROVED &&
          shouldCompleteTask
        ) {
          // Ad-hoc gate: the token may only advance once every task bound to
          // this token+node (the original task plus any ad-hoc countersign /
          // pre-approval tasks) has reached a terminal state. Nodes without
          // ad-hoc tasks keep the original single-task behaviour.
          if (
            await this.hasOpenTasksForTokenNode(
              manager,
              claimedTask.tokenId,
              claimedTask.nodeId,
            )
          ) {
            return decision;
          }

          const token = await tokenRepository.findOne({
            where: { id: claimedTask.tokenId },
          });

          if (!token) {
            throw new NotFoundException(
              `Workflow token ${claimedTask.tokenId} was not found`,
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

          await this.dispatchAdhocStageNotifications(
            manager,
            instance,
            claimedTask.nodeId,
            'APPROVED',
          );
          await this.advanceTokenToOutgoingNodes(
            manager,
            instance,
            activeToken,
            readWorkflowNodeOrThrow(
              instance.workflowSnapshot,
              claimedTask.nodeId,
            ),
          );
          await this.processRunningInstance(manager, instance);

          return decision;
        }

        if (input.action === TaskDecisionActionEnum.APPROVED) {
          return decision;
        }

        if (input.action === TaskDecisionActionEnum.RETURNED) {
          await this.returnInstanceToNode(
            manager,
            instance,
            completedTask,
            returnToNodeId,
            decidedAt,
          );

          return decision;
        }

        if (
          await this.handleAdhocPreApprovalRejection(
            manager,
            instance,
            completedTask,
            decidedAt,
            decisionComment,
          )
        ) {
          return decision;
        }

        await this.rejectInstance(manager, instance, completedTask, decidedAt);

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
        await this.notificationService.supersedeInstanceTaskNotifications({
          instanceId: instance.id,
          manager,
        });
        const cancelledInstance = await instanceRepository.save({
          ...instance,
          completedAt: cancelledAt,
          state: ApprovalInstanceStateEnum.CANCELLED,
        });

        await this.dispatchAdhocCompletionNotifications(
          manager,
          cancelledInstance,
          ApprovalInstanceStateEnum.CANCELLED,
        );
        await this.cancelPendingAdhocDirectives(manager, instance.id, null);

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

        const template = await this.getTemplateOrThrow(instance.templateId);

        if (!template.isActive) {
          throw new ConflictException('Approval template is deactivated');
        }

        validateSubmittedFormData(
          readFormDefinitionSnapshotSchema(instance.formDefinitionSnapshot),
          formData,
        );

        const resubmittedInstance = await instanceRepository.save({
          ...instance,
          completedAt: null,
          formData,
          state: ApprovalInstanceStateEnum.RUNNING,
          title: input.title?.trim() || instance.title,
        });
        await this.attachmentService.bindFormDataAttachmentsToInstance(
          manager,
          {
            formData,
            instanceId: instance.id,
          },
        );
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

  async requestAdhocCountersign({
    comment,
    requestedByMemberId,
    target,
    taskId,
  }: {
    readonly comment?: string | null;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
  }): Promise<AdhocDirectiveEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const { instance, node, task } = await this.loadAdhocOperationContext(
          manager,
          taskId,
          requestedByMemberId,
          { requireAllowAddSigner: true },
        );
        const targetValue = buildAdhocTargetValue(target);

        // Rejects WEBHOOK targets — countersigners must be members.
        buildAdhocApproverResolver(targetValue);

        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.save(
          directiveRepository.create({
            channels: null,
            comment: comment?.trim() || null,
            consumedAt: null,
            createdByMemberId: requestedByMemberId,
            instanceId: instance.id,
            onReject: null,
            originNodeId: task.nodeId,
            originTaskId: task.id,
            status: AdhocDirectiveStatusEnum.PENDING,
            targetKind: targetValue.kind,
            targetValue: { ...targetValue },
            type: AdhocDirectiveTypeEnum.COUNTERSIGN,
          }),
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          directive,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
          requestedByMemberId,
          { nodeLabel: node.data.label },
        );

        return directive;
      },
    );
  }

  async requestAdhocPreApproval({
    comment,
    onReject,
    requestedByMemberId,
    target,
    taskId,
  }: {
    readonly comment?: string | null;
    readonly onReject: AdhocPreApprovalRejectBehaviorEnum;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
  }): Promise<TaskEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<TaskEntity> => {
        const { instance, node, task } = await this.loadAdhocOperationContext(
          manager,
          taskId,
          requestedByMemberId,
          { requireAllowAddSigner: true },
        );
        const targetValue = buildAdhocTargetValue(target);

        // Rejects WEBHOOK targets — pre-approvers must be members.
        buildAdhocApproverResolver(targetValue);

        const now = new Date();
        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.save(
          directiveRepository.create({
            channels: null,
            comment: comment?.trim() || null,
            consumedAt: now,
            createdByMemberId: requestedByMemberId,
            instanceId: instance.id,
            onReject,
            originNodeId: task.nodeId,
            originTaskId: task.id,
            status: AdhocDirectiveStatusEnum.CONSUMED,
            targetKind: targetValue.kind,
            targetValue: { ...targetValue },
            type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          }),
        );
        const adhocTask = await this.createAdhocTaskForDirective(
          manager,
          instance,
          task.tokenId,
          node,
          directive,
          now,
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          directive,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
          requestedByMemberId,
          { adhocTaskId: adhocTask.id, nodeLabel: node.data.label, onReject },
        );

        return adhocTask;
      },
    );
  }

  async configureAdhocNotification({
    channels,
    requestedByMemberId,
    target,
    taskId,
    type,
  }: {
    readonly channels?: readonly NotificationChannelEnum[] | null;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
    readonly type:
      | AdhocDirectiveTypeEnum.COMPLETION_NOTIFY
      | AdhocDirectiveTypeEnum.STAGE_NOTIFY;
  }): Promise<AdhocDirectiveEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const { instance, node, task } = await this.loadAdhocOperationContext(
          manager,
          taskId,
          requestedByMemberId,
          { requireAllowAddSigner: false },
        );
        const targetValue = buildAdhocTargetValue(target);
        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.save(
          directiveRepository.create({
            channels: channels?.length ? [...channels] : null,
            comment: null,
            consumedAt: null,
            createdByMemberId: requestedByMemberId,
            instanceId: instance.id,
            onReject: null,
            originNodeId: task.nodeId,
            originTaskId: task.id,
            status: AdhocDirectiveStatusEnum.PENDING,
            targetKind: targetValue.kind,
            targetValue: { ...targetValue },
            type,
          }),
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          directive,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
          requestedByMemberId,
          { nodeLabel: node.data.label },
        );

        return directive;
      },
    );
  }

  async cancelAdhocDirective({
    cancelledByMemberId,
    directiveId,
  }: {
    readonly cancelledByMemberId: string;
    readonly directiveId: string;
  }): Promise<AdhocDirectiveEntity> {
    return this.approvalInstanceRepository.manager.transaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.findOne({
          where: { id: directiveId },
        });

        if (!directive) {
          throw new NotFoundException(
            `Ad-hoc directive ${directiveId} was not found`,
          );
        }

        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          directive.instanceId,
        ]);

        if (directive.createdByMemberId !== cancelledByMemberId) {
          throw new ConflictException(
            `Ad-hoc directive ${directive.id} can only be cancelled by its creator`,
          );
        }

        if (directive.status !== AdhocDirectiveStatusEnum.PENDING) {
          throw new ConflictException(
            `Ad-hoc directive ${directive.id} is not pending`,
          );
        }

        const cancelledDirective = await directiveRepository.save({
          ...directive,
          status: AdhocDirectiveStatusEnum.CANCELLED,
        });

        await this.recordAdhocDirectiveActivity(
          manager,
          cancelledDirective,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CANCELLED,
          cancelledByMemberId,
        );

        return cancelledDirective;
      },
    );
  }

  async listAdhocDirectives(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly AdhocDirectiveEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.adhocDirectiveRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  private async readTaskActorContext(
    manager: EntityManager,
    task: TaskEntity,
    actingMemberId: string,
  ): Promise<{
    readonly actorCandidate: TaskCandidateEntity | null;
    readonly taskCandidates: readonly TaskCandidateEntity[];
  }> {
    const taskCandidates = await manager
      .getRepository(TaskCandidateEntity)
      .find({ where: { taskId: task.id } });
    const actorCandidate =
      taskCandidates.find(
        (candidate) => candidate.memberId === actingMemberId,
      ) ?? null;
    const isDirectAssignee = task.assigneeMemberId === actingMemberId;

    if (!isDirectAssignee && !actorCandidate) {
      throw new ConflictException(
        `Task ${task.id} is assigned to another member`,
      );
    }

    if (
      actorCandidate &&
      actorCandidate.status !== TaskCandidateStatusEnum.PENDING &&
      actorCandidate.status !== TaskCandidateStatusEnum.CLAIMED
    ) {
      throw new ConflictException(
        `Task ${task.id} was already decided by this member`,
      );
    }

    return { actorCandidate, taskCandidates };
  }

  private async loadAdhocOperationContext(
    manager: EntityManager,
    taskId: string,
    actingMemberId: string,
    options: { readonly requireAllowAddSigner: boolean },
  ): Promise<AdhocOperationContext> {
    const task = await manager
      .getRepository(TaskEntity)
      .findOne({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} was not found`);
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

    await this.readTaskActorContext(manager, task, actingMemberId);

    const instance = await manager
      .getRepository(ApprovalInstanceEntity)
      .findOne({ where: { id: task.instanceId } });

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

    const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, task.nodeId);

    if (node.type !== 'userTask') {
      throw new ConflictException(
        `Task ${task.id} is not bound to a user task node`,
      );
    }

    if (options.requireAllowAddSigner && !node.data.allowAddSigner) {
      throw new ForbiddenException(
        `簽核節點「${node.data.label}」does not allow ad-hoc signers`,
      );
    }

    return { instance, node, task };
  }

  private async recordAdhocDirectiveActivity(
    manager: EntityManager,
    directive: AdhocDirectiveEntity,
    eventType: ActivityLogEventTypeEnum,
    actorMemberId: string | null,
    extraPayload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await activityRepository.save(
      activityRepository.create({
        actorMemberId,
        eventType,
        instanceId: directive.instanceId,
        nodeId: directive.originNodeId,
        payload: {
          ...extraPayload,
          directiveId: directive.id,
          directiveStatus: directive.status,
          directiveType: directive.type,
          targetKind: directive.targetKind,
        },
        taskId: directive.originTaskId,
      }),
    );
  }

  private async createAdhocTaskForDirective(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    tokenId: string,
    node: UserTaskNode,
    directive: AdhocDirectiveEntity,
    now: Date,
  ): Promise<TaskEntity> {
    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const label =
      directive.type === AdhocDirectiveTypeEnum.COUNTERSIGN
        ? '臨時會簽'
        : '臨時加簽';
    const resolvedCandidates = await this.resolveApproverResolver(
      manager,
      instance,
      buildAdhocApproverResolver(readAdhocTargetValue(directive)),
      `${label}「${node.data.label}」`,
    );
    const candidates = await this.applyDelegationToResolvedCandidates(
      instance,
      node.id,
      resolvedCandidates,
    );

    if (candidates.length === 0) {
      throw new ConflictException(
        `${label}「${node.data.label}」 did not resolve to any member id`,
      );
    }

    const primaryCandidate = candidates[0];
    const task = await taskRepository.save(
      taskRepository.create({
        adhocDirectiveId: directive.id,
        adhocOriginTaskId: directive.originTaskId,
        adhocType: directive.type,
        assigneeMemberId:
          candidates.length === 1 ? primaryCandidate.memberId : null,
        assignmentType:
          candidates.length === 1
            ? TaskAssignmentTypeEnum.DIRECT_MEMBER
            : TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        completedAt: null,
        createdAt: now,
        decisionPolicySnapshot: { type: 'SINGLE' },
        delegationChain:
          candidates.length === 1 ? primaryCandidate.delegationChain : [],
        instanceId: instance.id,
        isAdhoc: true,
        nodeId: node.id,
        openedAt: null,
        originalAssigneeMemberId:
          candidates.length === 1 ? primaryCandidate.originalMemberId : null,
        slaDueAt: null,
        status: TaskStatusEnum.PENDING,
        tokenId,
      }),
    );
    const savedCandidates = await taskCandidateRepository.save(
      candidates.map((candidate) =>
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: now,
          decidedAt: null,
          delegationChain: candidate.delegationChain,
          memberId: candidate.memberId,
          originalMemberId: candidate.originalMemberId,
          sourceType: candidate.sourceType,
          status: TaskCandidateStatusEnum.PENDING,
          taskId: task.id,
        }),
      ),
    );
    task.candidateMemberIds = savedCandidates.map(
      (candidate) => candidate.memberId,
    );

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: directive.createdByMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          adhocDirectiveId: directive.id,
          adhocType: directive.type,
          assigneeMemberId: task.assigneeMemberId,
          assignmentType: task.assignmentType,
          candidateMemberIds: savedCandidates.map(
            (candidate) => candidate.memberId,
          ),
          originTaskId: directive.originTaskId,
          tokenId,
        },
        taskId: task.id,
      }),
    );
    await savedCandidates.reduce<Promise<void>>(
      async (previous, candidate): Promise<void> => {
        await previous;
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: Object.assign(new TaskEntity(), task, {
            assigneeMemberId: candidate.memberId,
            delegationChain: candidate.delegationChain,
            originalAssigneeMemberId: candidate.originalMemberId,
          }),
        });
      },
      Promise.resolve(),
    );

    return task;
  }

  private async spawnCountersignTasksForNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: UserTaskNode,
    now: Date,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.COUNTERSIGN,
      },
    });

    if (directives.length === 0) {
      return;
    }

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;

        try {
          await this.createAdhocTaskForDirective(
            manager,
            instance,
            token.id,
            node,
            directive,
            now,
          );
          await directiveRepository.save({
            ...directive,
            consumedAt: now,
            status: AdhocDirectiveStatusEnum.CONSUMED,
          });
        } catch (error: unknown) {
          // A countersign target that no longer resolves must not block the
          // main flow — cancel the directive and record the failure.
          await directiveRepository.save({
            ...directive,
            status: AdhocDirectiveStatusEnum.CANCELLED,
          });
          await this.recordAdhocDirectiveActivity(
            manager,
            directive,
            ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CANCELLED,
            null,
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Countersign target resolution failed',
            },
          );
        }
      },
      Promise.resolve(),
    );
  }

  private async hasOpenTasksForTokenNode(
    manager: EntityManager,
    tokenId: string,
    nodeId: string,
  ): Promise<boolean> {
    const tasks = await manager.getRepository(TaskEntity).find({
      where: { nodeId, tokenId },
    });

    return tasks.some(
      (task) =>
        task.tokenId === tokenId &&
        task.nodeId === nodeId &&
        (task.status === TaskStatusEnum.PENDING ||
          task.status === TaskStatusEnum.IN_PROGRESS),
    );
  }

  private async handleAdhocPreApprovalRejection(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    decidedAt: Date,
    decisionComment: string | null,
  ): Promise<boolean> {
    if (
      !task.isAdhoc ||
      task.adhocType !== AdhocDirectiveTypeEnum.PRE_APPROVAL ||
      !task.adhocDirectiveId
    ) {
      return false;
    }

    const directive = await manager
      .getRepository(AdhocDirectiveEntity)
      .findOne({ where: { id: task.adhocDirectiveId } });

    if (
      directive?.onReject !==
      AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN
    ) {
      return false;
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const originTask = task.adhocOriginTaskId
      ? await taskRepository.findOne({ where: { id: task.adhocOriginTaskId } })
      : null;
    const originTaskIsOpen =
      originTask?.status === TaskStatusEnum.PENDING ||
      originTask?.status === TaskStatusEnum.IN_PROGRESS;

    // Safety: when there is nobody to hand the decision back to (origin task
    // missing, or already closed without a resolvable assignee), fall back to
    // the default rejection path instead of leaving the token stuck WAITING
    // with no open task.
    if (!originTask || (!originTaskIsOpen && !originTask.assigneeMemberId)) {
      return false;
    }

    const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, task.nodeId);

    if (!originTaskIsOpen && originTask.assigneeMemberId) {
      // The origin approver already decided — reopen a fresh decision task so
      // the stage can be re-decided after the rejected pre-approval.
      const reopenedTask = await taskRepository.save(
        taskRepository.create({
          assigneeMemberId: originTask.assigneeMemberId,
          assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
          completedAt: null,
          createdAt: decidedAt,
          decisionPolicySnapshot: { type: 'SINGLE' },
          delegationChain: originTask.delegationChain,
          instanceId: instance.id,
          nodeId: originTask.nodeId,
          openedAt: null,
          originalAssigneeMemberId: originTask.originalAssigneeMemberId,
          slaDueAt: null,
          status: TaskStatusEnum.PENDING,
          tokenId: originTask.tokenId,
        }),
      );

      await taskCandidateRepository.save(
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: decidedAt,
          decidedAt: null,
          delegationChain: originTask.delegationChain,
          memberId: originTask.assigneeMemberId,
          originalMemberId:
            originTask.originalAssigneeMemberId ?? originTask.assigneeMemberId,
          sourceType: 'DIRECT',
          status: TaskCandidateStatusEnum.PENDING,
          taskId: reopenedTask.id,
        }),
      );
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: task.assigneeMemberId,
          eventType: ActivityLogEventTypeEnum.TASK_CREATED,
          instanceId: instance.id,
          nodeId: originTask.nodeId,
          payload: {
            adhocDirectiveId: directive.id,
            assigneeMemberId: originTask.assigneeMemberId,
            reopenedFromTaskId: originTask.id,
            rejectedAdhocTaskId: task.id,
            tokenId: originTask.tokenId,
          },
          taskId: reopenedTask.id,
        }),
      );

      if (node.type === 'userTask') {
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: reopenedTask,
        });
      }
    }

    const recipientMemberIds = await this.readOpenTaskRecipientMemberIds(
      manager,
      originTask,
    );

    if (recipientMemberIds.length > 0) {
      await this.notificationService.createAdhocWorkflowNotifications({
        channels: null,
        instance,
        manager,
        message: `案件「${instance.title}」的臨時加簽已被拒絕${
          decisionComment ? `：${decisionComment}` : '。'
        }`,
        payload: {
          adhocTaskId: task.id,
          directiveId: directive.id,
          nodeId: task.nodeId,
          originTaskId: originTask.id,
          type: 'PRE_APPROVAL_RETURNED',
        },
        recipientMemberIds,
      });
    }

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.ADHOC_PRE_APPROVAL_RETURNED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          comment: decisionComment,
          directiveId: directive.id,
          originTaskId: originTask.id,
          rejectedAdhocTaskId: task.id,
        },
        taskId: task.id,
      }),
    );

    return true;
  }

  private async readOpenTaskRecipientMemberIds(
    manager: EntityManager,
    task: TaskEntity,
  ): Promise<readonly string[]> {
    if (task.assigneeMemberId) {
      return [task.assigneeMemberId];
    }

    const candidates = await manager
      .getRepository(TaskCandidateEntity)
      .find({ where: { taskId: task.id } });

    return uniqueTexts(
      candidates
        .filter(
          (candidate) =>
            candidate.status === TaskCandidateStatusEnum.PENDING ||
            candidate.status === TaskCandidateStatusEnum.CLAIMED,
        )
        .map((candidate) => candidate.memberId),
    );
  }

  private async dispatchAdhocStageNotifications(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeId: string,
    outcome: AdhocStageOutcome,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        originNodeId: nodeId,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
      },
    });

    if (directives.length === 0) {
      return;
    }

    const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, nodeId);
    const nodeLabel = node.data.label;
    const outcomeLabel = readAdhocStageOutcomeLabel(outcome);
    const consumedAt = new Date();

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;
        await this.dispatchAdhocDirectiveNotification(
          manager,
          instance,
          directive,
          `案件「${instance.title}」的階段「${nodeLabel}」已${outcomeLabel}。`,
          {
            nodeId,
            nodeLabel,
            outcome,
            type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
          },
        );
        await directiveRepository.save({
          ...directive,
          consumedAt,
          status: AdhocDirectiveStatusEnum.CONSUMED,
        });
      },
      Promise.resolve(),
    );
  }

  private async dispatchAdhocCompletionNotifications(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    finalState: ApprovalInstanceStateEnum,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
      },
    });

    if (directives.length === 0) {
      return;
    }

    const finalStateLabel = readInstanceFinalStateLabel(finalState);
    const consumedAt = new Date();

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;
        await this.dispatchAdhocDirectiveNotification(
          manager,
          instance,
          directive,
          `案件「${instance.title}」已結案（${finalStateLabel}）。`,
          {
            finalState,
            type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
          },
        );
        await directiveRepository.save({
          ...directive,
          consumedAt,
          status: AdhocDirectiveStatusEnum.CONSUMED,
        });
      },
      Promise.resolve(),
    );
  }

  private async dispatchAdhocDirectiveNotification(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    directive: AdhocDirectiveEntity,
    message: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const targetValue = readAdhocTargetValue(directive);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    if (targetValue.kind === AdhocTargetKindEnum.WEBHOOK) {
      const result = await executeAdhocWebhookDispatch(
        this.serviceTaskDispatcher,
        targetValue,
        {
          ...payload,
          instanceId: instance.id,
          instanceTitle: instance.title,
          message,
          triggeredAt: new Date().toISOString(),
        },
      );

      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: result.ok
            ? ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED
            : ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: directive.originNodeId,
          payload: {
            action: 'ADHOC_WEBHOOK',
            directiveId: directive.id,
            error: result.error,
            ok: result.ok,
            status: result.status,
            url: targetValue.webhookUrl,
          },
          taskId: null,
        }),
      );

      return;
    }

    try {
      const recipients = await this.resolveApproverResolver(
        manager,
        instance,
        buildAdhocApproverResolver(targetValue),
        '臨時通知對象',
      );

      await this.notificationService.createAdhocWorkflowNotifications({
        channels: directive.channels,
        instance,
        manager,
        message,
        payload: { ...payload, directiveId: directive.id },
        recipientMemberIds: recipients.map((recipient) => recipient.memberId),
      });
    } catch (error: unknown) {
      // Notification target resolution must never block the workflow
      // transition that triggered it — record the failure instead.
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: directive.originNodeId,
          payload: {
            action: 'ADHOC_NOTIFY',
            directiveId: directive.id,
            error:
              error instanceof Error
                ? error.message
                : 'Ad-hoc notification dispatch failed',
          },
          taskId: null,
        }),
      );
    }
  }

  private async cancelPendingAdhocDirectives(
    manager: EntityManager,
    instanceId: string,
    types: readonly AdhocDirectiveTypeEnum[] | null,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      where: {
        instanceId,
        status: AdhocDirectiveStatusEnum.PENDING,
        ...(types ? { type: In([...types]) } : {}),
      },
    });

    if (directives.length === 0) {
      return;
    }

    await directiveRepository.save(
      directives.map((directive) => ({
        ...directive,
        status: AdhocDirectiveStatusEnum.CANCELLED,
      })),
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

    if (resolver.type === 'ORG_UNIT_MEMBER') {
      return `orgUnitMember:${resolver.orgUnitId}`;
    }

    if (resolver.type === 'ORG_UNIT_POSITION') {
      return `orgUnitPosition:${resolver.orgUnitId}:${resolver.positionId}`;
    }

    if (resolver.type === 'ORG_UNIT_MANAGER') {
      return `orgUnitManager:${resolver.orgUnitId}`;
    }

    return readMemberIdFromValue(
      readManagerMemberIdFromInitiatorSnapshot(
        input.initiatorMetadataSnapshot,
        resolver.levelsUp,
      ),
      label,
    );
  }

  async getApprovalInstance(
    id: string,
    scope?: WorkflowReadScope,
  ): Promise<ApprovalInstanceEntity> {
    const instance = await this.approvalInstanceRepository.findOne({
      where: { id },
    });

    if (!instance) {
      throw new NotFoundException(`Approval instance ${id} was not found`);
    }

    if (
      scope &&
      !canReadAllWorkflows(scope) &&
      !(await this.isApprovalInstanceReadableByMember(instance, scope.memberId))
    ) {
      throw new NotFoundException(`Approval instance ${id} was not found`);
    }

    return instance;
  }

  async listApprovalInstances(
    scope?: WorkflowReadScope,
    options: ListApprovalInstancesOptions = {},
  ): Promise<readonly ApprovalInstanceEntity[]> {
    const queryBuilder = await this.createFilteredApprovalInstanceQueryBuilder(
      scope,
      options,
    );

    if (!queryBuilder) {
      return [];
    }

    queryBuilder.orderBy('"approvalInstance"."created_at"', 'DESC');

    if (shouldPaginateList(options)) {
      queryBuilder
        .skip(readPageOffset(options.page, options.pageSize))
        .take(normalizePageSize(options.pageSize));
    }

    return queryBuilder.getMany();
  }

  async countApprovalInstances(
    scope?: WorkflowReadScope,
    options: Omit<ListApprovalInstancesOptions, 'page' | 'pageSize'> = {},
  ): Promise<number> {
    const queryBuilder = await this.createFilteredApprovalInstanceQueryBuilder(
      scope,
      options,
    );

    return queryBuilder ? queryBuilder.getCount() : 0;
  }

  async readApprovalInstancePageInfo(
    scope?: WorkflowReadScope,
    options: ListApprovalInstancesOptions = {},
  ): Promise<{
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly page: number;
    readonly pageSize: number;
    readonly totalCount: number;
    readonly totalPages: number;
  }> {
    const totalCount = await this.countApprovalInstances(scope, options);
    const page = normalizePage(options.page);
    const pageSize = normalizePageSize(options.pageSize);
    const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

    return {
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      page,
      pageSize,
      totalCount,
      totalPages,
    };
  }

  private async createFilteredApprovalInstanceQueryBuilder(
    scope?: WorkflowReadScope,
    options: Omit<ListApprovalInstancesOptions, 'page' | 'pageSize'> = {},
  ): Promise<SelectQueryBuilder<ApprovalInstanceEntity> | null> {
    const queryBuilder =
      this.approvalInstanceRepository.createQueryBuilder('approvalInstance');
    const hasReadableInstances = this.applyReadableInstanceFilter(
      queryBuilder,
      scope,
      options,
    );

    if (!hasReadableInstances) {
      return null;
    }

    const templateId = normalizeText(options.templateId);

    if (options.state?.length) {
      queryBuilder.andWhere('"approvalInstance"."state" IN (:...states)', {
        states: [...options.state],
      });
    }

    if (templateId) {
      queryBuilder.andWhere('"approvalInstance"."template_id" = :templateId', {
        templateId,
      });
    }

    applyApprovalInstanceSearchFilter(queryBuilder, options.searchText);

    return queryBuilder;
  }

  private applyReadableInstanceFilter(
    queryBuilder: SelectQueryBuilder<ApprovalInstanceEntity>,
    scope: WorkflowReadScope | undefined,
    options: Omit<ListApprovalInstancesOptions, 'page' | 'pageSize'>,
  ): boolean {
    if (!scope) {
      return true;
    }

    const view = options.view ?? ApprovalInstanceListViewEnum.ALL;

    if (view === ApprovalInstanceListViewEnum.SENT) {
      queryBuilder.andWhere(
        '"approvalInstance"."initiator_member_id" = :readableMemberId',
        {
          readableMemberId: scope.memberId,
        },
      );

      return true;
    }

    if (view === ApprovalInstanceListViewEnum.CC) {
      queryBuilder.andWhere(
        `
          EXISTS (
            SELECT 1
            FROM "notifications" "readableNotification"
            WHERE "readableNotification"."instance_id" = "approvalInstance"."id"
              AND "readableNotification"."recipient_member_id" = :readableMemberId
          )
        `,
        {
          readableMemberId: scope.memberId,
        },
      );

      return true;
    }

    if (canReadAllWorkflows(scope)) {
      return true;
    }

    queryBuilder.andWhere(
      `
        (
          "approvalInstance"."initiator_member_id" = :readableMemberId
          OR EXISTS (
            SELECT 1
            FROM "tasks" "readableTask"
            WHERE "readableTask"."instance_id" = "approvalInstance"."id"
              AND (
                "readableTask"."assignee_member_id" = :readableMemberId
                OR "readableTask"."original_assignee_member_id" = :readableMemberId
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "task_candidates" "readableCandidate"
            INNER JOIN "tasks" "readableCandidateTask"
              ON "readableCandidateTask"."id" = "readableCandidate"."task_id"
            WHERE "readableCandidateTask"."instance_id" = "approvalInstance"."id"
              AND (
                "readableCandidate"."member_id" = :readableMemberId
                OR "readableCandidate"."original_member_id" = :readableMemberId
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "task_decisions" "readableDecision"
            INNER JOIN "tasks" "readableDecisionTask"
              ON "readableDecisionTask"."id" = "readableDecision"."task_id"
            WHERE "readableDecisionTask"."instance_id" = "approvalInstance"."id"
              AND "readableDecision"."decided_by_member_id" = :readableMemberId
          )
        )
      `,
      {
        readableMemberId: scope.memberId,
      },
    );

    return true;
  }

  async readWorkflowDashboardSummary(
    scope?: WorkflowReadScope,
    options: WorkflowDashboardSummaryOptions = {},
  ): Promise<{
    readonly activeInstanceCount: number;
    readonly completedInstanceCount: number;
    readonly overdueTaskCount: number;
    readonly pendingTaskCount: number;
    readonly rejectedInstanceCount: number;
    readonly totalInstanceCount: number;
  }> {
    const instances = (
      await this.listApprovalInstances(scope, {
        view: ApprovalInstanceListViewEnum.ALL,
      })
    ).filter((instance) => isInstanceWithinRange(instance, options));
    const instanceIds = instances.map((instance) => instance.id);
    const openTasks = instanceIds.length
      ? await this.taskRepository.find({
          where: {
            instanceId: In(instanceIds),
            status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
          },
        })
      : [];
    const now = Date.now();

    return {
      activeInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.RUNNING,
      ).length,
      completedInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.APPROVED,
      ).length,
      overdueTaskCount: openTasks.filter(
        (task) => task.slaDueAt && task.slaDueAt.getTime() <= now,
      ).length,
      pendingTaskCount: openTasks.length,
      rejectedInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.REJECTED,
      ).length,
      totalInstanceCount: instances.length,
    };
  }

  async listLaunchableApprovalTemplates(
    memberId: string,
  ): Promise<readonly ApprovalTemplateEntity[]> {
    const templates = await this.approvalTemplateRepository.find({
      order: { updatedAt: 'DESC' },
      where: { isActive: true },
    });
    const currentVersionIds = templates
      .map((template) => template.currentVersionId)
      .filter((versionId): versionId is string => Boolean(versionId));

    if (!currentVersionIds.length) {
      return [];
    }

    const versions = await this.approvalTemplateVersionRepository.find({
      where: {
        id: In(currentVersionIds),
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      },
    });
    const versionById = new Map(
      versions.map(
        (version): readonly [string, ApprovalTemplateVersionEntity] => [
          version.id,
          version,
        ],
      ),
    );
    const initiatorMetadataSnapshot =
      await this.readDefaultInitiatorMetadataSnapshot(memberId);

    return templates.filter((template) => {
      const currentVersion = template.currentVersionId
        ? (versionById.get(template.currentVersionId) ?? null)
        : null;

      if (!currentVersion?.formDefinitionVersionId) {
        return false;
      }

      return this.conditionService.evaluateBoolean(
        currentVersion.initiatorPolicyCel,
        buildInitiatorPolicyContext(initiatorMetadataSnapshot),
        'initiatorPolicyCel',
      );
    });
  }

  async listWorkflowTokens(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly WorkflowTokenEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.workflowTokenRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  async listTasks(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.attachTaskCandidateSummaries(
      await this.taskRepository.find({
        order: { createdAt: 'ASC' },
        where: { instanceId },
      }),
    );
  }

  async listInboxTasks(
    assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    const directTasks = await this.taskRepository.find({
      order: { createdAt: 'DESC' },
      where: [
        {
          assigneeMemberId,
          status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
        },
      ],
    });
    const candidateRows = await this.taskCandidateRepository.find({
      where: {
        memberId: assigneeMemberId,
        status: In([
          TaskCandidateStatusEnum.PENDING,
          TaskCandidateStatusEnum.CLAIMED,
        ]),
      },
    });
    const candidateTasks = candidateRows.length
      ? await this.taskRepository.find({
          order: { createdAt: 'DESC' },
          where: {
            id: In(candidateRows.map((candidate) => candidate.taskId)),
            status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
          },
        })
      : [];

    return this.attachTaskCandidateSummaries(
      uniqueTasksById([...directTasks, ...candidateTasks]),
    );
  }

  async listApprovalHistoryTasks(
    assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    const directTasks = await this.taskRepository.find({
      order: { completedAt: 'DESC', createdAt: 'DESC' },
      take: DEFAULT_APPROVAL_HISTORY_TASK_LIMIT,
      where: { assigneeMemberId, status: TaskStatusEnum.COMPLETED },
    });
    const candidateRows = await this.taskCandidateRepository.find({
      where: {
        memberId: assigneeMemberId,
        status: TaskCandidateStatusEnum.COMPLETED,
      },
    });
    const candidateTasks = candidateRows.length
      ? await this.taskRepository.find({
          order: { completedAt: 'DESC', createdAt: 'DESC' },
          take: DEFAULT_APPROVAL_HISTORY_TASK_LIMIT,
          where: {
            id: In(candidateRows.map((candidate) => candidate.taskId)),
            status: TaskStatusEnum.COMPLETED,
          },
        })
      : [];

    return this.attachTaskCandidateSummaries(
      uniqueTasksById([...directTasks, ...candidateTasks]),
    );
  }

  async listTaskDecisions(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskDecisionEntity[]> {
    await this.assertTaskReadable(taskId, scope);

    return this.taskDecisionRepository.find({
      order: { decidedAt: 'ASC' },
      where: { taskId },
    });
  }

  async listTaskCandidates(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskCandidateEntity[]> {
    await this.assertTaskReadable(taskId, scope);

    return this.taskCandidateRepository.find({
      order: { createdAt: 'ASC', id: 'ASC' },
      where: { taskId },
    });
  }

  private async attachTaskCandidateSummaries(
    tasks: readonly TaskEntity[],
  ): Promise<readonly TaskEntity[]> {
    if (!tasks.length) {
      return tasks;
    }

    const candidates = await this.taskCandidateRepository.find({
      order: { createdAt: 'ASC', id: 'ASC' },
      where: { taskId: In(tasks.map((task) => task.id)) },
    });
    const candidatesByTaskId = candidates.reduce<
      ReadonlyMap<string, readonly string[]>
    >((currentMap, candidate) => {
      const nextMap = new Map(currentMap);
      const memberIds = nextMap.get(candidate.taskId) ?? [];

      nextMap.set(candidate.taskId, [...memberIds, candidate.memberId]);

      return nextMap;
    }, new Map<string, readonly string[]>());

    return tasks.map((task) =>
      Object.assign(new TaskEntity(), task, {
        candidateMemberIds: candidatesByTaskId.get(task.id) ?? [],
      }),
    );
  }

  private async readDefaultInitiatorMetadataSnapshot(
    memberId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const today = toDateOnlyString(new Date());
    const memberships = (
      await this.approvalInstanceRepository.manager
        .getRepository(MembershipEntity)
        .find({ where: { memberId } })
    )
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership);
    const primaryMembership = memberships[0] ?? null;
    const positionIds = uniqueTexts(
      memberships
        .map((membership) => membership.positionId)
        .filter((positionId): positionId is string => Boolean(positionId)),
    );

    return {
      customFields: {},
      memberId,
      orgUnitIds: uniqueTexts(
        memberships.map((membership) => membership.orgUnitId),
      ),
      positionId: primaryMembership?.positionId ?? null,
      positionIds,
      primaryOrgUnitId: primaryMembership?.orgUnitId ?? null,
    };
  }

  async listActivityLogs(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly ActivityLogEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.activityLogRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  private async assertTaskReadable(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<TaskEntity> {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    await this.getApprovalInstance(task.instanceId, scope);

    return task;
  }

  private async isApprovalInstanceReadableByMember(
    instance: ApprovalInstanceEntity,
    memberId: string,
  ): Promise<boolean> {
    if (instance.initiatorMemberId === memberId) {
      return true;
    }

    const tasks = await this.taskRepository.find({
      where: { instanceId: instance.id },
    });

    if (tasks.some((task) => isTaskRelatedToMember(task, memberId))) {
      return true;
    }

    const taskIds = tasks.map((task) => task.id);

    if (!taskIds.length) {
      return false;
    }

    const candidates = await this.taskCandidateRepository.find({
      where: { taskId: In(taskIds) },
    });

    if (
      candidates.some(
        (candidate) =>
          candidate.memberId === memberId ||
          candidate.originalMemberId === memberId,
      )
    ) {
      return true;
    }

    const decisions = await this.taskDecisionRepository.find({
      where: { taskId: In(taskIds) },
    });

    if (
      decisions.some((decision) => decision.decidedByMemberId === memberId)
    ) {
      return true;
    }

    // Members who received any notification for this instance (e.g. ad-hoc
    // stage / completion notify recipients, CC'd service-task recipients) may
    // open the instance they were notified about.
    const notification = await this.notificationRepository.findOne({
      where: { instanceId: instance.id, recipientMemberId: memberId },
    });

    return Boolean(notification);
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
        await this.completeInstanceIfNoOpenRuntimeState(manager, instance);

        return;
      }

      await this.processActiveToken(manager, instance, token);
    }

    throw new ConflictException(
      `Approval instance ${instance.id} exceeded maximum processing steps`,
    );
  }

  private async completeInstanceIfNoOpenRuntimeState(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
  ): Promise<void> {
    if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
      return;
    }

    const waitingTokens = await manager
      .getRepository(WorkflowTokenEntity)
      .find({
        where: {
          instanceId: instance.id,
          status: WorkflowTokenStatusEnum.WAITING,
        },
      });

    if (waitingTokens.length > 0) {
      return;
    }

    const completedAt = new Date();
    const completedInstance = await manager
      .getRepository(ApprovalInstanceEntity)
      .save({
        ...instance,
        completedAt,
        state: ApprovalInstanceStateEnum.APPROVED,
      });

    await this.notificationService.createInstanceCompletedNotification({
      instance: completedInstance,
      manager,
    });
    await this.dispatchAdhocCompletionNotifications(
      manager,
      completedInstance,
      ApprovalInstanceStateEnum.APPROVED,
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, null);
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

    const pendingTokensThatMayReachNode = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
      (candidate) =>
        candidate.id !== token.id &&
        !arrivedTokens.some(
          (arrivedToken) => arrivedToken.id === candidate.id,
        ) &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING) &&
        hasPathToNode(
          instance.workflowSnapshot,
          candidate.currentNodeId,
          node.id,
        ),
    );

    if (
      arrivedTokens.length < incomingEdges.length &&
      pendingTokensThatMayReachNode.length > 0
    ) {
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
      const completedInstance = await instanceRepository.save({
        ...instance,
        completedAt,
        state: instanceState,
      });

      if (instanceState === ApprovalInstanceStateEnum.APPROVED) {
        await this.notificationService.createInstanceCompletedNotification({
          instance: completedInstance,
          manager,
        });
      }

      await this.dispatchAdhocCompletionNotifications(
        manager,
        completedInstance,
        instanceState,
      );
      await this.cancelPendingAdhocDirectives(manager, instance.id, null);
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
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const existingTask = await taskRepository.findOne({
      where: {
        isAdhoc: false,
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

    const candidates = await this.resolveRuntimeTaskCandidates(
      manager,
      instance,
      node,
    );
    const primaryCandidate = candidates[0];
    const now = new Date();
    const slaDueAt = await this.slaScheduleService.resolveTaskSlaDueAt({
      node,
      now,
    });
    const task = await taskRepository.save(
      taskRepository.create({
        assigneeMemberId:
          candidates.length === 1 ? primaryCandidate.memberId : null,
        assignmentType:
          candidates.length === 1
            ? TaskAssignmentTypeEnum.DIRECT_MEMBER
            : TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        completedAt: null,
        createdAt: now,
        decisionPolicySnapshot: node.data.decisionPolicy,
        delegationChain:
          candidates.length === 1 ? primaryCandidate.delegationChain : [],
        instanceId: instance.id,
        nodeId: node.id,
        openedAt: null,
        originalAssigneeMemberId:
          candidates.length === 1 ? primaryCandidate.originalMemberId : null,
        slaDueAt,
        status: TaskStatusEnum.PENDING,
        tokenId: token.id,
      }),
    );
    const savedCandidates = await taskCandidateRepository.save(
      candidates.map((candidate) =>
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: now,
          decidedAt: null,
          delegationChain: candidate.delegationChain,
          memberId: candidate.memberId,
          originalMemberId: candidate.originalMemberId,
          sourceType: candidate.sourceType,
          status: TaskCandidateStatusEnum.PENDING,
          taskId: task.id,
        }),
      ),
    );
    task.candidateMemberIds = savedCandidates.map(
      (candidate) => candidate.memberId,
    );
    const singleCandidate =
      savedCandidates.length === 1 ? savedCandidates[0] : null;

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
          assignmentType: task.assignmentType,
          assigneeMemberId: singleCandidate?.memberId ?? null,
          candidateMemberIds: savedCandidates.map(
            (candidate) => candidate.memberId,
          ),
          originalAssigneeMemberId: singleCandidate?.originalMemberId ?? null,
          tokenId: token.id,
        },
        taskId: task.id,
      }),
    );
    await savedCandidates.reduce<Promise<void>>(
      async (previous, candidate): Promise<void> => {
        await previous;
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: Object.assign(new TaskEntity(), task, {
            assigneeMemberId: candidate.memberId,
            delegationChain: candidate.delegationChain,
            originalAssigneeMemberId: candidate.originalMemberId,
          }),
        });
      },
      Promise.resolve(),
    );

    // Pending ad-hoc countersign directives attach to the next user task
    // created after they were requested — spawn their parallel tasks now.
    await this.spawnCountersignTasksForNode(manager, instance, token, node, now);
  }

  private async markTaskCandidateDecision({
    action,
    candidate,
    candidates,
    decidedAt,
    manager,
    task,
  }: {
    readonly action: TaskDecisionActionEnum;
    readonly candidate: TaskCandidateEntity | null;
    readonly candidates: readonly TaskCandidateEntity[];
    readonly decidedAt: Date;
    readonly manager: EntityManager;
    readonly task: TaskEntity;
  }): Promise<readonly TaskCandidateEntity[]> {
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);

    if (!candidate && candidates.length === 0 && task.assigneeMemberId) {
      const legacyCandidate = await taskCandidateRepository.save(
        taskCandidateRepository.create({
          claimedAt: task.openedAt ?? decidedAt,
          createdAt: task.createdAt,
          decidedAt,
          delegationChain: task.delegationChain,
          memberId: task.assigneeMemberId,
          originalMemberId:
            task.originalAssigneeMemberId ?? task.assigneeMemberId,
          sourceType: 'DIRECT',
          status: TaskCandidateStatusEnum.COMPLETED,
          taskId: task.id,
        }),
      );

      return [legacyCandidate];
    }

    const completedCandidate = candidate
      ? Object.assign(new TaskCandidateEntity(), candidate, {
          claimedAt: candidate.claimedAt ?? decidedAt,
          decidedAt,
          status: TaskCandidateStatusEnum.COMPLETED,
        })
      : null;
    const decisionPolicy = readDecisionPolicySnapshot(task);
    const shouldCancelOpenCandidates =
      action !== TaskDecisionActionEnum.APPROVED ||
      decisionPolicy.type === 'SINGLE' ||
      decisionPolicy.type === 'PARALLEL_ANY';
    const nextCandidates = candidates.map((currentCandidate) => {
      if (currentCandidate.id === completedCandidate?.id) {
        return completedCandidate;
      }

      if (
        shouldCancelOpenCandidates &&
        (currentCandidate.status === TaskCandidateStatusEnum.PENDING ||
          currentCandidate.status === TaskCandidateStatusEnum.CLAIMED)
      ) {
        return Object.assign(new TaskCandidateEntity(), currentCandidate, {
          decidedAt,
          status: TaskCandidateStatusEnum.CANCELLED,
        });
      }

      return currentCandidate;
    });

    if (nextCandidates.length > 0) {
      await taskCandidateRepository.save(nextCandidates);
    }

    return nextCandidates;
  }

  private async transferTask(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    decision: TaskDecisionEntity,
    signature: { readonly id: string; readonly signedPayloadHash: string },
    transferToMemberId: string | null,
    decisionComment: string | null,
    decidedAt: Date,
    actorCandidate: TaskCandidateEntity | null,
    transferReason: string,
  ): Promise<void> {
    if (!transferToMemberId) {
      throw new BadRequestException('Transfer target member is required');
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const transferringMemberId = task.assigneeMemberId;

    if (!transferringMemberId) {
      throw new ConflictException('Task must be claimed before transfer');
    }

    const nextDelegationChain: readonly DelegationStep[] = [
      ...readDelegationSteps(task.delegationChain),
      {
        from: transferringMemberId,
        reason: transferReason,
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
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
        completedAt: null,
        decisionPolicySnapshot: { type: 'SINGLE' },
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
    await taskCandidateRepository.save([
      ...(actorCandidate
        ? [
            taskCandidateRepository.create({
              ...actorCandidate,
              decidedAt,
              status: TaskCandidateStatusEnum.TRANSFERRED,
            }),
          ]
        : []),
      taskCandidateRepository.create({
        claimedAt: null,
        createdAt: decidedAt,
        decidedAt: null,
        delegationChain: nextDelegationChain,
        memberId: transferToMemberId,
        originalMemberId: task.originalAssigneeMemberId ?? transferToMemberId,
        sourceType: 'DIRECT',
        status: TaskCandidateStatusEnum.PENDING,
        taskId: nextTask.id,
      }),
    ]);

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
          signatureId: signature.id,
          signedPayloadHash: signature.signedPayloadHash,
          transferToMemberId,
        },
        taskId: transferredTask.id,
      }),
      activityRepository.create({
        actorMemberId: transferringMemberId,
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
    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      task.nodeId,
    );

    if (node.type === 'userTask') {
      await this.notificationService.createTaskAssignedNotification({
        instance,
        manager,
        node,
        task: nextTask,
        transferred: true,
      });
    }
  }

  private async resolveRuntimeTaskCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
  ): Promise<readonly RuntimeTaskCandidate[]> {
    const resolvedCandidates = await this.resolveApproverResolver(
      manager,
      instance,
      node.data.approverResolver,
      `簽核節點「${node.data.label}」`,
    );
    const uniqueCandidates = await this.applyDelegationToResolvedCandidates(
      instance,
      node.id,
      resolvedCandidates,
    );

    if (uniqueCandidates.length === 0) {
      throw new ConflictException(
        `簽核節點「${node.data.label}」 did not resolve to any member id`,
      );
    }

    return uniqueCandidates;
  }

  private async applyDelegationToResolvedCandidates(
    instance: ApprovalInstanceEntity,
    nodeId: string,
    resolvedCandidates: readonly ResolvedApproverCandidate[],
  ): Promise<readonly RuntimeTaskCandidate[]> {
    const context = {
      formData: instance.formData,
      initiatorMemberId: instance.initiatorMemberId,
      initiatorMetadataSnapshot: instance.initiatorMetadataSnapshot,
      instanceId: instance.id,
      nodeId,
      state: instance.state,
      templateId: instance.templateId,
      templateVersionId: instance.templateVersionId,
      title: instance.title,
    };
    const delegatedCandidates = await Promise.all(
      resolvedCandidates.map(
        async (candidate): Promise<RuntimeTaskCandidate> => {
          const delegationResolution =
            await this.delegationService.resolveAssignee(
              candidate.memberId,
              context,
            );

          return {
            delegationChain: delegationResolution.delegationChain,
            memberId: delegationResolution.finalAssigneeMemberId,
            originalMemberId: candidate.memberId,
            sourceType: candidate.sourceType,
          };
        },
      ),
    );

    return uniqueRuntimeCandidates(delegatedCandidates);
  }

  private async resolveApproverResolver(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: ApproverResolver,
    label: string,
  ): Promise<readonly ResolvedApproverCandidate[]> {
    if (resolver.type === 'DIRECT') {
      return readMemberIdsFromValue(resolver.memberIds, label).map(
        (memberId) => ({ memberId, sourceType: resolver.type }),
      );
    }

    if (resolver.type === 'DYNAMIC_FORM') {
      return readMemberIdsFromValue(
        readValueAtPath(instance.formData, resolver.formPath),
        `${label}.formPath`,
      ).map((memberId) => ({ memberId, sourceType: resolver.type }));
    }

    if (resolver.type === 'EXPRESSION') {
      return readMemberIdsFromValue(
        this.conditionService.evaluateValue(
          resolver.expression,
          buildWorkflowExpressionContext(instance),
          `${label}.expression`,
        ),
        `${label}.expression`,
      ).map((memberId) => ({ memberId, sourceType: resolver.type }));
    }

    if (resolver.type === 'POSITION') {
      return this.resolvePositionCandidates(
        manager,
        resolver.positionId,
        label,
      ).then((memberIds) =>
        memberIds.map((memberId) => ({ memberId, sourceType: resolver.type })),
      );
    }

    if (resolver.type === 'ORG_UNIT_MEMBER') {
      return this.resolveOrgUnitMemberCandidates(
        manager,
        resolver.orgUnitId,
        Boolean(resolver.includeDescendants),
        label,
      ).then((memberIds) =>
        memberIds.map((memberId) => ({ memberId, sourceType: resolver.type })),
      );
    }

    if (resolver.type === 'ORG_UNIT_POSITION') {
      return this.resolveOrgUnitPositionCandidates(
        manager,
        resolver.orgUnitId,
        resolver.positionId,
        Boolean(resolver.includeDescendants),
        label,
      ).then((memberIds) =>
        memberIds.map((memberId) => ({ memberId, sourceType: resolver.type })),
      );
    }

    if (resolver.type === 'ORG_UNIT_MANAGER') {
      return this.resolveOrgUnitManagerCandidates(
        manager,
        instance,
        resolver.orgUnitId,
        resolver.fallback,
        label,
        resolver.preferClosestOrgUnit === true,
      ).then((memberIds) =>
        memberIds.map((memberId) => ({ memberId, sourceType: resolver.type })),
      );
    }

    return this.resolveInitiatorManagerCandidates(
      manager,
      instance,
      resolver.levelsUp,
      resolver.fallback,
      label,
      resolver.preferClosestOrgUnit === true,
    ).then((memberIds) =>
      memberIds.map((memberId) => ({ memberId, sourceType: resolver.type })),
    );
  }

  private async resolvePositionCandidates(
    manager: EntityManager,
    positionId: string,
    label: string,
  ): Promise<readonly string[]> {
    const today = toDateOnlyString(new Date());
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { positionId },
    });
    const activeMemberships = memberships
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
      });

    if (!activeMemberships.length) {
      throw new ConflictException(
        `${label} position ${positionId} has no active membership`,
      );
    }

    return uniqueTexts(
      activeMemberships.map((membership) => membership.memberId),
    );
  }

  private async resolveInitiatorManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    levelsUp: number,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const normalizedLevelsUp = Math.max(Math.trunc(levelsUp), 1);
    const resolvedManagerMemberIds =
      await this.resolveManagerMemberIdsFromOrganization(
        manager,
        instance.initiatorMemberId,
        normalizedLevelsUp,
        preferClosestOrgUnit,
      );

    if (resolvedManagerMemberIds.length) {
      return resolvedManagerMemberIds;
    }

    return [
      this.resolveFallbackAssignee(
        instance,
        fallback,
        label,
        `找不到發起人的第 ${normalizedLevelsUp} 層主管`,
      ),
    ];
  }

  private resolveFallbackAssignee(
    instance: ApprovalInstanceEntity,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    failureReason: string,
  ): string {
    if (!fallback || fallback.type === 'NONE') {
      throw new ConflictException(
        `${label} 無法建立待簽任務：${failureReason}，且未設定改派固定人。請聯絡流程管理員調整主管規則或模板 fallback。`,
      );
    }

    if (!fallback.memberId.trim()) {
      throw new ConflictException(
        `${label} 無法建立待簽任務：改派固定人未設定。`,
      );
    }

    if (
      fallback.memberId === instance.initiatorMemberId &&
      !fallback.allowInitiatorSelfApproval
    ) {
      throw new ConflictException(
        `${label} 無法建立待簽任務：改派固定人是申請人本人，且此節點未允許申請人自簽。`,
      );
    }

    return fallback.memberId;
  }

  private async resolveManagerMemberIdsFromOrganization(
    manager: EntityManager,
    memberId: string,
    levelsUp: number,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    return this.resolveManagerMemberIdsAtLevel(
      manager,
      memberId,
      toDateOnlyString(new Date()),
      levelsUp,
      preferClosestOrgUnit,
    );
  }

  private async resolveManagerMemberIdsAtLevel(
    manager: EntityManager,
    memberId: string,
    date: string,
    remainingLevels: number,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const directManagerMemberIds = await this.resolveDirectManagerMemberIds(
      manager,
      memberId,
      date,
      preferClosestOrgUnit,
    );

    if (remainingLevels <= 1 || directManagerMemberIds.length === 0) {
      return directManagerMemberIds;
    }

    const nextLevelGroups = await Promise.all(
      directManagerMemberIds.map((managerMemberId) =>
        this.resolveManagerMemberIdsAtLevel(
          manager,
          managerMemberId,
          date,
          remainingLevels - 1,
          preferClosestOrgUnit,
        ),
      ),
    );

    return uniqueTexts(nextLevelGroups.flat());
  }

  private async resolveDirectManagerMemberIds(
    manager: EntityManager,
    memberId: string,
    date: string,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { memberId },
    });
    const activeMemberships = memberships.filter((membership) =>
      isDateRangeActive(membership, date),
    );
    const directOrgUnitIds = activeMemberships.map(
      (membership) => membership.orgUnitId,
    );
    const positionIds = activeMemberships
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId));
    const orgUnits = await this.readOrgUnitAndAncestors(
      manager,
      directOrgUnitIds,
    );
    const candidatePairs = [
      { scopeId: memberId, scopeType: ManagerResolutionScopeTypeEnum.MEMBER },
      ...orgUnits.map((orgUnit) => ({
        scopeId: orgUnit.id,
        scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
      })),
      ...positionIds.map((scopeId) => ({
        scopeId,
        scopeType: ManagerResolutionScopeTypeEnum.POSITION,
      })),
    ];

    return this.resolveManagerResolutionCandidates(
      manager,
      candidatePairs,
      date,
      readOrgUnitDepthMap(orgUnits),
      preferClosestOrgUnit,
    );
  }

  private async resolveOrgUnitManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    orgUnitId: string,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const date = toDateOnlyString(new Date());
    const orgUnits = await this.readOrgUnitAndAncestors(manager, [orgUnitId]);
    const managerMemberIds = await this.resolveManagerResolutionCandidates(
      manager,
      orgUnits.map((orgUnit) => ({
        scopeId: orgUnit.id,
        scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
      })),
      date,
      readOrgUnitDepthMap(orgUnits),
      preferClosestOrgUnit,
    );

    if (!managerMemberIds.length) {
      return [
        this.resolveFallbackAssignee(
          instance,
          fallback,
          label,
          `找不到指定組織的主管規則`,
        ),
      ];
    }

    return managerMemberIds;
  }

  private async readOrgUnitAndAncestors(
    manager: EntityManager,
    orgUnitIds: readonly string[],
  ): Promise<readonly OrgUnitEntity[]> {
    if (!orgUnitIds.length) {
      return [];
    }

    const orgUnitRepository = manager.getRepository(OrgUnitEntity);
    const directOrgUnits = await orgUnitRepository.find({
      where: { deletedAt: IsNull(), id: In([...orgUnitIds]) },
    });
    const ancestorGroups = await Promise.all(
      directOrgUnits.map((orgUnit) =>
        orgUnitRepository
          .createQueryBuilder('orgUnit')
          .where('orgUnit.deleted_at IS NULL')
          .andWhere('orgUnit.path @> :path', { path: orgUnit.path })
          .getMany(),
      ),
    );
    const byId = new Map(
      [...directOrgUnits, ...ancestorGroups.flat()].map(
        (orgUnit): readonly [string, OrgUnitEntity] => [orgUnit.id, orgUnit],
      ),
    );

    return [...byId.values()];
  }

  private async resolveManagerResolutionCandidates(
    manager: EntityManager,
    candidatePairs: readonly {
      readonly scopeId: string;
      readonly scopeType: ManagerResolutionScopeTypeEnum;
    }[],
    date: string,
    orgUnitDepths: ReadonlyMap<string, number>,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const scopeIds = candidatePairs.map((pair) => pair.scopeId);

    if (!scopeIds.length) {
      return [];
    }

    const resolutions = await manager
      .getRepository(ManagerResolutionEntity)
      .find({
        where: {
          scopeId: In([...scopeIds]),
          scopeType: In([
            ManagerResolutionScopeTypeEnum.MEMBER,
            ManagerResolutionScopeTypeEnum.ORG_UNIT,
            ManagerResolutionScopeTypeEnum.POSITION,
          ]),
        },
      });
    const depthLookup = preferClosestOrgUnit ? orgUnitDepths : undefined;
    const active = resolutions
      .filter((resolution) =>
        candidatePairs.some(
          (pair) =>
            pair.scopeId === resolution.scopeId &&
            pair.scopeType === resolution.scopeType,
        ),
      )
      .filter((resolution) => isDateRangeActive(resolution, date))
      .sort((left, right) =>
        compareManagerResolution(left, right, depthLookup),
      );

    return uniqueTexts(
      readTopPriorityResolutions(active, depthLookup).map(
        (resolution) => resolution.managerMemberId,
      ),
    );
  }

  private async resolveOrgUnitMemberCandidates(
    manager: EntityManager,
    orgUnitId: string,
    includeDescendants: boolean,
    label: string,
  ): Promise<readonly string[]> {
    const orgUnitIds = await this.readOrgUnitScopeIds(
      manager,
      orgUnitId,
      includeDescendants,
    );
    const today = toDateOnlyString(new Date());
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { orgUnitId: In([...orgUnitIds]) },
    });
    const memberIds = memberships
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership)
      .map((membership) => membership.memberId);

    if (memberIds.length === 0) {
      throw new ConflictException(
        `${label} orgUnit ${orgUnitId} has no active member`,
      );
    }

    return uniqueTexts(memberIds);
  }

  private async resolveOrgUnitPositionCandidates(
    manager: EntityManager,
    orgUnitId: string,
    positionId: string,
    includeDescendants: boolean,
    label: string,
  ): Promise<readonly string[]> {
    const orgUnitIds = await this.readOrgUnitScopeIds(
      manager,
      orgUnitId,
      includeDescendants,
    );
    const today = toDateOnlyString(new Date());
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { orgUnitId: In([...orgUnitIds]), positionId },
    });
    const memberIds = memberships
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership)
      .map((membership) => membership.memberId);

    if (memberIds.length === 0) {
      throw new ConflictException(
        `${label} orgUnit ${orgUnitId} and position ${positionId} has no active membership`,
      );
    }

    return uniqueTexts(memberIds);
  }

  private async readOrgUnitScopeIds(
    manager: EntityManager,
    orgUnitId: string,
    includeDescendants: boolean,
  ): Promise<readonly string[]> {
    const orgUnitRepository = manager.getRepository(OrgUnitEntity);
    const orgUnit = await orgUnitRepository.findOne({
      where: { deletedAt: IsNull(), id: orgUnitId },
    });

    if (!orgUnit) {
      throw new ConflictException(`Org unit ${orgUnitId} was not found`);
    }

    if (!includeDescendants) {
      return [orgUnit.id];
    }

    const descendants = await orgUnitRepository
      .createQueryBuilder('orgUnit')
      .where('orgUnit.deleted_at IS NULL')
      .andWhere('orgUnit.path <@ :path', { path: orgUnit.path })
      .getMany();

    return uniqueTexts([orgUnit.id, ...descendants.map((unit) => unit.id)]);
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
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const action = node.data.action;

    if (action.type === 'WEBHOOK') {
      const payload =
        typeof action.payload === 'string' && action.payload.trim()
          ? this.conditionService.evaluateValue(
              action.payload,
              buildWorkflowExpressionContext(instance),
              `workflow.nodes.${node.id}.data.action.payload`,
            )
          : {
              instance: buildWorkflowExpressionContext(instance).instance,
              triggeredAt: new Date().toISOString(),
            };
      const result = await executeWebhookServiceAction(
        this.serviceTaskDispatcher,
        action,
        payload,
      );

      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: result.ok
            ? ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED
            : ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            action: 'WEBHOOK',
            error: result.error,
            ok: result.ok,
            status: result.status,
            tokenId: token.id,
            url: action.url,
          },
          taskId: null,
        }),
      );
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    if (action.type === 'SET_FORM_FIELD') {
      const value = this.conditionService.evaluateValue(
        action.value,
        buildWorkflowExpressionContext(instance),
        `workflow.nodes.${node.id}.data.action.value`,
      );
      const updatedFormData = writeValueAtPath(
        instance.formData,
        action.fieldPath,
        value,
      );
      const updatedInstance = await manager
        .getRepository(ApprovalInstanceEntity)
        .save({
          ...instance,
          formData: updatedFormData,
        });

      Object.assign(instance, updatedInstance);
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            action: 'SET_FORM_FIELD',
            fieldPath: action.fieldPath,
            tokenId: token.id,
          },
          taskId: null,
        }),
      );
      await this.advanceTokenToOutgoingNodes(
        manager,
        updatedInstance,
        token,
        node,
      );

      return;
    }

    const recipients = await this.resolveApproverResolver(
      manager,
      instance,
      action.recipients,
      `知會節點「${node.data.label}」`,
    );
    const recipientMemberIds = uniqueTexts(
      recipients.map((recipient) => recipient.memberId),
    );

    await this.notificationService.createServiceTaskNotifications({
      instance,
      manager,
      node,
      recipientMemberIds,
    });
    await manager.getRepository(WorkflowTokenEntity).save({
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
          recipientMemberIds,
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
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);

    // Dispatch pending ad-hoc notifications for the rejecting node before the
    // remaining directives are cancelled by the terminal cleanup below.
    await this.dispatchAdhocStageNotifications(
      manager,
      instance,
      task.nodeId,
      'REJECTED',
    );

    // Consume open tokens and cancel any still-open tasks (parallel branches,
    // ad-hoc countersign / pre-approval tasks) so nothing actionable lingers
    // on a rejected instance.
    await this.consumeOpenRuntimeState(
      manager,
      instance,
      rejectedAt,
      TaskStatusEnum.CANCELLED,
    );
    await this.notificationService.supersedeInstanceTaskNotifications({
      instanceId: instance.id,
      manager,
    });

    const rejectedInstance = await instanceRepository.save({
      ...instance,
      completedAt: rejectedAt,
      state: ApprovalInstanceStateEnum.REJECTED,
    });
    await this.dispatchAdhocCompletionNotifications(
      manager,
      rejectedInstance,
      ApprovalInstanceStateEnum.REJECTED,
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, null);
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

    // The returning node's stage has ended (outcome: RETURNED) — dispatch its
    // pending ad-hoc stage notifications, then drop flow-affecting ad-hoc
    // directives so they cannot replay after the return/resubmit cycle.
    await this.dispatchAdhocStageNotifications(
      manager,
      instance,
      task.nodeId,
      'RETURNED',
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, [
      AdhocDirectiveTypeEnum.COUNTERSIGN,
      AdhocDirectiveTypeEnum.PRE_APPROVAL,
    ]);
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
      await this.closeTaskCandidates(
        manager,
        openTasks.map((task) => task.id),
        readCandidateStatusForClosedTask(taskStatus),
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
      await this.closeTaskCandidates(
        manager,
        cancellableTasks.map((task) => task.id),
        TaskCandidateStatusEnum.SUPERSEDED,
      );
    }
  }

  private async closeTaskCandidates(
    manager: EntityManager,
    taskIds: readonly string[],
    status: TaskCandidateStatusEnum,
  ): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    const candidateRepository = manager.getRepository(TaskCandidateEntity);
    const candidates = (
      await candidateRepository.find({ where: { taskId: In([...taskIds]) } })
    ).filter(
      (candidate) =>
        candidate.status === TaskCandidateStatusEnum.PENDING ||
        candidate.status === TaskCandidateStatusEnum.CLAIMED,
    );

    if (candidates.length === 0) {
      return;
    }

    await candidateRepository.save(
      candidates.map(
        (candidate): TaskCandidateEntity =>
          Object.assign(new TaskCandidateEntity(), candidate, { status }),
      ),
    );
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

function isReturnCommentRequired(
  workflow: WorkflowDefinition,
  nodeId: string,
): boolean {
  const node = readWorkflowNodeOrThrow(workflow, nodeId);

  return (
    node.type === 'userTask' &&
    node.data.returnBehavior.requireComment === true
  );
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
  return readMemberIdsFromValue(value, label)[0] ?? '';
}

function readMemberIdsFromValue(
  value: unknown,
  label: string,
): readonly string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    const memberIds = value
      .filter(
        (candidate): candidate is string =>
          typeof candidate === 'string' && Boolean(candidate.trim()),
      )
      .map((candidate) => candidate.trim());

    if (memberIds.length > 0) {
      return uniqueTexts(memberIds);
    }
  }

  throw new ConflictException(`${label} did not resolve to a member id`);
}

function uniqueTexts(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function uniqueRuntimeCandidates(
  candidates: readonly RuntimeTaskCandidate[],
): readonly RuntimeTaskCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.memberId)) {
      return false;
    }

    seen.add(candidate.memberId);

    return true;
  });
}

function uniqueTasksById(tasks: readonly TaskEntity[]): readonly TaskEntity[] {
  const seen = new Set<string>();

  return tasks.filter((task) => {
    if (seen.has(task.id)) {
      return false;
    }

    seen.add(task.id);

    return true;
  });
}

function normalizeText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPageOffset(
  page: number | null | undefined,
  pageSize: number | null | undefined,
): number {
  const normalizedPageSize = normalizePageSize(pageSize);

  return (normalizePage(page) - 1) * normalizedPageSize;
}

function shouldPaginateList(options: ListApprovalInstancesOptions): boolean {
  return (
    typeof options.page !== 'undefined' ||
    typeof options.pageSize !== 'undefined'
  );
}

function normalizePage(value: number | null | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function normalizePageSize(value: number | null | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return 20;
  }

  return Math.min(Number(value), 100);
}

function applyApprovalInstanceSearchFilter(
  queryBuilder: SelectQueryBuilder<ApprovalInstanceEntity>,
  searchTextValue: string | null | undefined,
): void {
  const searchText = normalizeText(searchTextValue)?.toLocaleLowerCase();

  if (!searchText) {
    return;
  }

  queryBuilder.andWhere(
    [
      '(',
      'LOWER("approvalInstance"."title") LIKE :approvalInstanceSearchText',
      'OR LOWER("approvalInstance"."initiator_member_id") LIKE :approvalInstanceSearchText',
      'OR LOWER(CAST("approvalInstance"."id" AS text)) LIKE :approvalInstanceSearchText',
      ')',
    ].join(' '),
    {
      approvalInstanceSearchText: `%${escapeLikePattern(searchText)}%`,
    },
  );
}

function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/%/gu, '\\%')
    .replace(/_/gu, '\\_');
}

function isInstanceWithinRange(
  instance: ApprovalInstanceEntity,
  options: WorkflowDashboardSummaryOptions,
): boolean {
  const fromTime = options.from?.getTime() ?? null;
  const toTime = options.to?.getTime() ?? null;
  const candidateTime = (
    instance.completedAt ??
    instance.startedAt ??
    instance.createdAt
  ).getTime();

  return (
    (fromTime === null || candidateTime >= fromTime) &&
    (toTime === null || candidateTime <= toTime)
  );
}

function readDecisionPolicySnapshot(task: TaskEntity): DecisionPolicy {
  const value = task.decisionPolicySnapshot;

  if (
    isRecord(value) &&
    typeof value.type === 'string' &&
    (value.type === 'SINGLE' ||
      value.type === 'SEQUENTIAL' ||
      value.type === 'PARALLEL_ALL' ||
      value.type === 'PARALLEL_ANY')
  ) {
    return { type: value.type };
  }

  if (
    isRecord(value) &&
    value.type === 'QUORUM' &&
    typeof value.threshold === 'number' &&
    (value.thresholdType === 'COUNT' || value.thresholdType === 'PERCENTAGE')
  ) {
    return {
      threshold: value.threshold,
      thresholdType: value.thresholdType,
      type: 'QUORUM',
    };
  }

  return { type: 'SINGLE' };
}

function shouldCompleteTaskAfterDecision({
  action,
  candidates,
  decisionPolicy,
}: {
  readonly action: TaskDecisionActionEnum;
  readonly candidates: readonly TaskCandidateEntity[];
  readonly decisionPolicy: DecisionPolicy;
}): boolean {
  if (action !== TaskDecisionActionEnum.APPROVED) {
    return true;
  }

  if (
    decisionPolicy.type === 'SINGLE' ||
    decisionPolicy.type === 'PARALLEL_ANY'
  ) {
    return true;
  }

  const completedCount = candidates.filter(
    (candidate) => candidate.status === TaskCandidateStatusEnum.COMPLETED,
  ).length;
  const totalCount = Math.max(candidates.length, 1);

  if (
    decisionPolicy.type === 'PARALLEL_ALL' ||
    decisionPolicy.type === 'SEQUENTIAL'
  ) {
    return completedCount >= totalCount;
  }

  const threshold =
    decisionPolicy.thresholdType === 'PERCENTAGE'
      ? Math.ceil((totalCount * decisionPolicy.threshold) / 100)
      : decisionPolicy.threshold;

  return completedCount >= Math.max(threshold, 1);
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

function writeValueAtPath(
  value: Readonly<Record<string, unknown>>,
  path: string,
  nextValue: unknown,
): Readonly<Record<string, unknown>> {
  const segments = normalizeFormFieldPath(path);

  if (segments.length === 0) {
    return value;
  }

  return writeNestedValue(value, segments, nextValue);
}

function writeNestedValue(
  value: Readonly<Record<string, unknown>>,
  segments: readonly string[],
  nextValue: unknown,
): Readonly<Record<string, unknown>> {
  const [currentSegment, ...remainingSegments] = segments;

  if (!currentSegment) {
    return value;
  }

  if (remainingSegments.length === 0) {
    return { ...value, [currentSegment]: nextValue };
  }

  const currentValue = value[currentSegment];
  const nestedValue = isRecord(currentValue) ? currentValue : {};

  return {
    ...value,
    [currentSegment]: writeNestedValue(
      nestedValue,
      remainingSegments,
      nextValue,
    ),
  };
}

function normalizeFormFieldPath(path: string): readonly string[] {
  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments[0] === 'form' || segments[0] === 'formData') {
    return segments.slice(1);
  }

  return segments;
}

async function executeWebhookServiceAction(
  serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher,
  action: Extract<
    ServiceTaskNode['data']['action'],
    { readonly type: 'WEBHOOK' }
  >,
  payload: unknown,
): Promise<BPMWorkflowWebhookDispatchResult> {
  try {
    return await serviceTaskDispatcher.dispatchWebhook({
      headers: action.headers,
      payload,
      url: action.url,
    });
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : 'Unknown webhook error',
      ok: false,
      status: null,
    };
  }
}

async function executeAdhocWebhookDispatch(
  serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher,
  target: AdhocTargetValue,
  payload: unknown,
): Promise<BPMWorkflowWebhookDispatchResult> {
  if (!target.webhookUrl) {
    return { error: 'Webhook URL is missing', ok: false, status: null };
  }

  try {
    return await serviceTaskDispatcher.dispatchWebhook({
      headers: target.webhookHeaders,
      payload,
      url: target.webhookUrl,
    });
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : 'Unknown webhook error',
      ok: false,
      status: null,
    };
  }
}

function buildAdhocTargetValue(input: AdhocTargetInput): AdhocTargetValue {
  if (input.kind === AdhocTargetKindEnum.MEMBER) {
    const memberIds = uniqueTexts([...(input.memberIds ?? [])]);

    if (memberIds.length === 0) {
      throw new BadRequestException(
        'memberIds is required for a MEMBER ad-hoc target',
      );
    }

    return { kind: input.kind, memberIds };
  }

  if (input.kind === AdhocTargetKindEnum.POSITION) {
    const positionId = input.positionId?.trim();

    if (!positionId) {
      throw new BadRequestException(
        'positionId is required for a POSITION ad-hoc target',
      );
    }

    return { kind: input.kind, positionId };
  }

  if (input.kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    const orgUnitId = input.orgUnitId?.trim();

    if (!orgUnitId) {
      throw new BadRequestException(
        'orgUnitId is required for an ORG_UNIT_MEMBER ad-hoc target',
      );
    }

    return {
      includeDescendants: Boolean(input.includeDescendants),
      kind: input.kind,
      orgUnitId,
    };
  }

  const webhookUrl = input.webhookUrl?.trim();

  if (!webhookUrl) {
    throw new BadRequestException(
      'webhookUrl is required for a WEBHOOK ad-hoc target',
    );
  }

  return {
    kind: input.kind,
    webhookHeaders: input.webhookHeadersJson
      ? parseAdhocWebhookHeaders(input.webhookHeadersJson)
      : undefined,
    webhookUrl,
  };
}

function parseAdhocWebhookHeaders(
  json: string,
): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(json);

    if (!isRecord(parsed)) {
      throw new BadRequestException(
        'webhookHeadersJson must be a JSON object of string values',
      );
    }

    return Object.entries(parsed).reduce<Readonly<Record<string, string>>>(
      (accumulator, [key, value]) => ({
        ...accumulator,
        ...(typeof value === 'string' ? { [key]: value } : {}),
      }),
      {},
    );
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException('webhookHeadersJson is not valid JSON');
  }
}

function readAdhocTargetValue(
  directive: AdhocDirectiveEntity,
): AdhocTargetValue {
  const value = directive.targetValue;
  const kind = directive.targetKind;

  if (kind === AdhocTargetKindEnum.MEMBER) {
    return {
      kind,
      memberIds: Array.isArray(value.memberIds)
        ? value.memberIds.filter(
            (memberId): memberId is string => typeof memberId === 'string',
          )
        : [],
    };
  }

  if (kind === AdhocTargetKindEnum.POSITION) {
    return {
      kind,
      positionId:
        typeof value.positionId === 'string' ? value.positionId : '',
    };
  }

  if (kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    return {
      includeDescendants: Boolean(value.includeDescendants),
      kind,
      orgUnitId: typeof value.orgUnitId === 'string' ? value.orgUnitId : '',
    };
  }

  return {
    kind,
    webhookHeaders: isRecord(value.webhookHeaders)
      ? Object.entries(value.webhookHeaders).reduce<
          Readonly<Record<string, string>>
        >(
          (accumulator, [key, headerValue]) => ({
            ...accumulator,
            ...(typeof headerValue === 'string'
              ? { [key]: headerValue }
              : {}),
          }),
          {},
        )
      : undefined,
    webhookUrl: typeof value.webhookUrl === 'string' ? value.webhookUrl : '',
  };
}

function buildAdhocApproverResolver(
  target: AdhocTargetValue,
): ApproverResolver {
  if (target.kind === AdhocTargetKindEnum.MEMBER) {
    return { memberIds: target.memberIds ?? [], type: 'DIRECT' };
  }

  if (target.kind === AdhocTargetKindEnum.POSITION) {
    return { positionId: target.positionId ?? '', type: 'POSITION' };
  }

  if (target.kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    return {
      includeDescendants: target.includeDescendants,
      orgUnitId: target.orgUnitId ?? '',
      type: 'ORG_UNIT_MEMBER',
    };
  }

  throw new BadRequestException(
    'WEBHOOK ad-hoc targets cannot be used as approvers',
  );
}

function readAdhocStageOutcomeLabel(outcome: AdhocStageOutcome): string {
  if (outcome === 'APPROVED') {
    return '通過';
  }

  if (outcome === 'REJECTED') {
    return '拒絕';
  }

  return '退回';
}

function readInstanceFinalStateLabel(
  finalState: ApprovalInstanceStateEnum,
): string {
  if (finalState === ApprovalInstanceStateEnum.APPROVED) {
    return '核准';
  }

  if (finalState === ApprovalInstanceStateEnum.REJECTED) {
    return '拒絕';
  }

  return '取消';
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

  // An empty `customFields` object must not swallow the top-level fallback:
  // callers commonly send `{ customFields: {}, managerMemberId: '...' }`, and
  // returning early there resolves no approver at all.
  if (isRecord(customFields) && customFields.managerMemberId !== undefined) {
    return customFields.managerMemberId;
  }

  return initiatorMetadataSnapshot.managerMemberId;
}

function isDateRangeActive(
  value: Pick<
    MembershipEntity | ManagerResolutionEntity,
    'effectiveFrom' | 'effectiveTo'
  >,
  date: string,
): boolean {
  return (
    value.effectiveFrom <= date &&
    (!value.effectiveTo || value.effectiveTo >= date)
  );
}

/**
 * Manager resolutions are sorted by priority and then by scope specificity, so
 * every entry below the winning tier is a lower-precedence fallback that must
 * not join the approver list — a company-wide catch-all rule would otherwise be
 * appended to every member's direct manager. The organization module already
 * resolves managers this way (`OrganizationService.resolveManagerMemberId`
 * returns `active[0]`); this keeps the workflow engine consistent with it.
 *
 * Ties on the winning tier are preserved so a step can still be shared by
 * several managers of equal precedence.
 *
 * When `orgUnitDepths` is provided and the winning scope is ORG_UNIT, only the
 * deepest org units on the winning tier are kept so that ancestor-level
 * catch-all rules do not dilute the approver list. This is opt-in via the
 * resolver's `preferClosestOrgUnit` flag because org-tree depth does not always
 * reflect authority (e.g. project offices attached to executive roles).
 */
function readTopPriorityResolutions(
  resolutions: readonly ManagerResolutionEntity[],
  orgUnitDepths?: ReadonlyMap<string, number>,
): readonly ManagerResolutionEntity[] {
  const [top] = resolutions;

  if (!top) {
    return [];
  }

  const sameTier = resolutions.filter(
    (resolution) =>
      resolution.priority === top.priority &&
      resolution.scopeType === top.scopeType,
  );

  if (
    orgUnitDepths &&
    top.scopeType === ManagerResolutionScopeTypeEnum.ORG_UNIT
  ) {
    const maxDepth = Math.max(
      ...sameTier.map(
        (resolution) => orgUnitDepths.get(resolution.scopeId) ?? 0,
      ),
    );

    return sameTier.filter(
      (resolution) =>
        (orgUnitDepths.get(resolution.scopeId) ?? 0) === maxDepth,
    );
  }

  return sameTier;
}

function compareManagerResolution(
  left: ManagerResolutionEntity,
  right: ManagerResolutionEntity,
  orgUnitDepths?: ReadonlyMap<string, number>,
): number {
  const priorityDiff = right.priority - left.priority;

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const scopeRankDiff =
    readManagerResolutionScopeRank(right.scopeType) -
    readManagerResolutionScopeRank(left.scopeType);

  if (scopeRankDiff !== 0) {
    return scopeRankDiff;
  }

  if (orgUnitDepths) {
    const depthDiff =
      (orgUnitDepths.get(right.scopeId) ?? 0) -
      (orgUnitDepths.get(left.scopeId) ?? 0);

    if (depthDiff !== 0) {
      return depthDiff;
    }
  }

  return right.effectiveFrom.localeCompare(left.effectiveFrom);
}

function readOrgUnitDepthMap(
  orgUnits: readonly OrgUnitEntity[],
): ReadonlyMap<string, number> {
  return new Map(
    orgUnits.map((orgUnit) => [
      orgUnit.id,
      orgUnit.path.split('.').length,
    ]),
  );
}

function readManagerResolutionScopeRank(
  scopeType: ManagerResolutionScopeTypeEnum,
): number {
  const ranks: Readonly<Record<ManagerResolutionScopeTypeEnum, number>> = {
    [ManagerResolutionScopeTypeEnum.MEMBER]: 3,
    [ManagerResolutionScopeTypeEnum.ORG_UNIT]: 2,
    [ManagerResolutionScopeTypeEnum.POSITION]: 1,
  };

  return ranks[scopeType];
}

function compareMembership(
  left: MembershipEntity,
  right: MembershipEntity,
): number {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  return right.effectiveFrom.localeCompare(left.effectiveFrom);
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function canReadAllWorkflows(scope: WorkflowReadScope): boolean {
  return (
    scope.roles.includes('BPM_ADMIN') ||
    scope.permissions.some((permission) =>
      WORKFLOW_READ_ALL_PERMISSIONS.has(permission),
    )
  );
}

function isTaskRelatedToMember(task: TaskEntity, memberId: string): boolean {
  return (
    task.assigneeMemberId === memberId ||
    task.originalAssigneeMemberId === memberId
  );
}

function readCandidateStatusForClosedTask(
  taskStatus: TaskStatusEnum,
): TaskCandidateStatusEnum {
  if (taskStatus === TaskStatusEnum.TRANSFERRED) {
    return TaskCandidateStatusEnum.TRANSFERRED;
  }

  if (taskStatus === TaskStatusEnum.COMPLETED) {
    return TaskCandidateStatusEnum.COMPLETED;
  }

  return TaskCandidateStatusEnum.CANCELLED;
}

function validateSubmittedFormData(
  schema: FormDefinitionSchema,
  formData: Readonly<Record<string, unknown>>,
): void {
  const missingFields = schema.fields.filter((field) => {
    const fieldValue = formData[field.fieldKey];

    return (
      isSubmittedFormFieldVisible(field, schema.fields, formData) &&
      isSubmittedFormFieldRequired(field, schema.fields, formData) &&
      !isSubmittedFieldValuePresent(fieldValue)
    );
  });

  if (missingFields.length > 0) {
    throw new BadRequestException(
      `Form data is missing required fields: ${missingFields
        .map((field) => field.label || field.fieldKey)
        .join(', ')}`,
    );
  }
}

function readFormDefinitionSnapshotSchema(
  snapshot: Readonly<Record<string, unknown>>,
): FormDefinitionSchema {
  const schema = snapshot.schema;

  if (isFormDefinitionSchema(schema)) {
    return schema;
  }

  throw new BadRequestException('Approval instance form schema is invalid');
}

function isFormDefinitionSchema(value: unknown): value is FormDefinitionSchema {
  return (
    isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.fields)
  );
}

function isSubmittedFormFieldVisible(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  return field.visibleWhen
    ? evaluateFormConditionExpression(field.visibleWhen, fields, values, true)
    : true;
}

function isSubmittedFormFieldRequired(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  return (
    field.required ||
    Boolean(
      field.requiredWhen
        ? evaluateFormConditionExpression(
            field.requiredWhen,
            fields,
            values,
            false,
          )
        : false,
    )
  );
}

function evaluateFormConditionExpression(
  expression: string,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
  fallback: boolean,
): boolean {
  const rule = parseFormConditionRule(expression);

  if (!rule) {
    return fallback;
  }

  const field = fields.find(
    (candidate) => candidate.fieldKey === rule.fieldKey,
  );

  if (!field) {
    return fallback;
  }

  return evaluateFormConditionRule(rule, field, values[field.fieldKey]);
}

function parseFormConditionRule(expression: string): {
  readonly fieldKey: string;
  readonly operator: FormConditionOperator;
  readonly value: string;
} | null {
  const match = expression
    .trim()
    .match(/^form\.([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u);

  if (!match) {
    return null;
  }

  const operator = readFormConditionOperatorFromSymbol(match[2]);

  if (!operator) {
    return null;
  }

  return {
    fieldKey: match[1],
    operator,
    value: parseFormConditionLiteral(match[3]),
  };
}

function evaluateFormConditionRule(
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
  field: FormFieldDefinition,
  value: unknown,
): boolean {
  if (Array.isArray(value)) {
    return evaluateArrayFormCondition(value, rule);
  }

  if (field.type === 'boolean') {
    return compareFormConditionValues(
      value === true ? 'true' : 'false',
      rule.value,
      rule.operator,
    );
  }

  if (isNumberFormField(field)) {
    return compareNumericFormCondition(value, rule);
  }

  return compareFormConditionValues(
    typeof value === 'undefined' || value === null ? '' : String(value),
    rule.value,
    rule.operator,
  );
}

function evaluateArrayFormCondition(
  value: readonly unknown[],
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
): boolean {
  const stringValues = value.filter(
    (entry): entry is string => typeof entry === 'string',
  );

  if (rule.operator === 'equals') {
    return stringValues.includes(rule.value);
  }

  if (rule.operator === 'notEquals') {
    return !stringValues.includes(rule.value);
  }

  return false;
}

function compareNumericFormCondition(
  value: unknown,
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
): boolean {
  const actualValue = typeof value === 'number' ? value : Number(value);
  const expectedValue = Number(rule.value);

  if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) {
    return false;
  }

  return compareFormConditionValues(actualValue, expectedValue, rule.operator);
}

function compareFormConditionValues(
  actualValue: number | string,
  expectedValue: number | string,
  operator: FormConditionOperator,
): boolean {
  if (operator === 'equals') {
    return actualValue === expectedValue;
  }

  if (operator === 'notEquals') {
    return actualValue !== expectedValue;
  }

  if (operator === 'greaterThan') {
    return actualValue > expectedValue;
  }

  if (operator === 'greaterThanOrEqual') {
    return actualValue >= expectedValue;
  }

  if (operator === 'lessThan') {
    return actualValue < expectedValue;
  }

  return actualValue <= expectedValue;
}

function readFormConditionOperatorFromSymbol(
  symbol: string | undefined,
): FormConditionOperator | null {
  const operators: Readonly<Record<string, FormConditionOperator>> = {
    '!=': 'notEquals',
    '<': 'lessThan',
    '<=': 'lessThanOrEqual',
    '==': 'equals',
    '>': 'greaterThan',
    '>=': 'greaterThanOrEqual',
  };

  return symbol ? (operators[symbol] ?? null) : null;
}

function parseFormConditionLiteral(value: string): string {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function isSubmittedFieldValuePresent(value: unknown): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function isNumberFormField(
  field: FormFieldDefinition,
): field is NumberFieldDefinition {
  return field.type === 'number' || field.type === 'money';
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

function mapDecisionToResolution(
  action: TaskDecisionActionEnum,
): NotificationResolutionEnum {
  switch (action) {
    case TaskDecisionActionEnum.APPROVED:
      return NotificationResolutionEnum.APPROVED;
    case TaskDecisionActionEnum.REJECTED:
      return NotificationResolutionEnum.REJECTED;
    case TaskDecisionActionEnum.RETURNED:
      return NotificationResolutionEnum.RETURNED;
    case TaskDecisionActionEnum.TRANSFERRED:
      return NotificationResolutionEnum.TRANSFERRED;
  }
}
