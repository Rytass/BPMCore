import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import {
  BPMAdminOnly,
  BPMAuthenticated,
  BPMCurrentMemberId,
} from '../bpm-auth';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import {
  AdhocDirectiveTypeEnum,
  AdhocPreApprovalRejectBehaviorEnum,
} from './adhoc.enums';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { AdhocNotificationInput } from './dto/adhoc-notification.input';
import { AdhocTargetInput } from './dto/adhoc-target.input';
import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { DecideTaskInput } from './dto/decide-task.input';
import { DryRunApprovalWorkflowInput } from './dto/dry-run-approval-workflow.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowDryRunResultObject } from './workflow-dry-run.object';
import { WorkflowEngineService } from './workflow-engine.service';

@Resolver()
@BPMAuthenticated()
export class WorkflowEngineMutations {
  constructor(private readonly workflowEngineService: WorkflowEngineService) {}

  @Mutation(() => ApprovalInstanceEntity)
  async submitApprovalInstance(
    @Args('input') input: SubmitApprovalInstanceInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.submitApprovalInstance({
      ...input,
      initiatorMemberId: currentMemberId,
      initiatorMetadataSnapshotJson: null,
    });
  }

  @Mutation(() => Boolean)
  @BPMAdminOnly()
  async processApprovalInstance(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<boolean> {
    await this.workflowEngineService.processInstance(instanceId);

    return true;
  }

  @Mutation(() => TaskDecisionEntity)
  async decideTask(
    @Args('input') input: DecideTaskInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<TaskDecisionEntity> {
    return this.workflowEngineService.decideTask({
      ...input,
      decidedByMemberId: currentMemberId,
    });
  }

  @Mutation(() => ApprovalInstanceEntity)
  async cancelApprovalInstance(
    @Args('input') input: CancelApprovalInstanceInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.cancelApprovalInstance({
      ...input,
      cancelledByMemberId: currentMemberId,
    });
  }

  @Mutation(() => ApprovalInstanceEntity)
  async resubmitApprovalInstance(
    @Args('input') input: ResubmitApprovalInstanceInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.resubmitApprovalInstance({
      ...input,
      initiatorMemberId: currentMemberId,
    });
  }

  @Mutation(() => WorkflowDryRunResultObject)
  async dryRunApprovalWorkflow(
    @Args('input') input: DryRunApprovalWorkflowInput,
  ): Promise<WorkflowDryRunResultObject> {
    return Promise.resolve(
      this.workflowEngineService.dryRunApprovalWorkflow(input),
    );
  }

  @Mutation(() => AdhocDirectiveEntity)
  async requestAdhocCountersign(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('target') target: AdhocTargetInput,
    @Args('comment', { nullable: true, type: () => String })
    comment: string | null,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<AdhocDirectiveEntity> {
    return this.workflowEngineService.requestAdhocCountersign({
      comment,
      requestedByMemberId: currentMemberId,
      target,
      taskId,
    });
  }

  @Mutation(() => TaskEntity)
  async requestAdhocPreApproval(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('target') target: AdhocTargetInput,
    @Args('onReject', { type: () => AdhocPreApprovalRejectBehaviorEnum })
    onReject: AdhocPreApprovalRejectBehaviorEnum,
    @Args('comment', { nullable: true, type: () => String })
    comment: string | null,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<TaskEntity> {
    return this.workflowEngineService.requestAdhocPreApproval({
      comment,
      onReject,
      requestedByMemberId: currentMemberId,
      target,
      taskId,
    });
  }

  @Mutation(() => AdhocDirectiveEntity)
  async configureAdhocStageNotification(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('input') input: AdhocNotificationInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<AdhocDirectiveEntity> {
    return this.workflowEngineService.configureAdhocNotification({
      channels: input.channels,
      requestedByMemberId: currentMemberId,
      target: input.target,
      taskId,
      type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
    });
  }

  @Mutation(() => AdhocDirectiveEntity)
  async configureAdhocCompletionNotification(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('input') input: AdhocNotificationInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<AdhocDirectiveEntity> {
    return this.workflowEngineService.configureAdhocNotification({
      channels: input.channels,
      requestedByMemberId: currentMemberId,
      target: input.target,
      taskId,
      type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
    });
  }

  @Mutation(() => AdhocDirectiveEntity)
  async cancelAdhocDirective(
    @Args('directiveId', { type: () => ID }) directiveId: string,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<AdhocDirectiveEntity> {
    return this.workflowEngineService.cancelAdhocDirective({
      cancelledByMemberId: currentMemberId,
      directiveId,
    });
  }
}
