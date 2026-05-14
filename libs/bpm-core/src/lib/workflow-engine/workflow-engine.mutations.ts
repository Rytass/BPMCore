import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { DecideTaskInput } from './dto/decide-task.input';
import { DryRunApprovalWorkflowInput } from './dto/dry-run-approval-workflow.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { TaskDecisionEntity } from './task-decision.entity';
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
}
