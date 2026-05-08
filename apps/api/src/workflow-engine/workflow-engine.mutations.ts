import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { DecideTaskInput } from './dto/decide-task.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { TaskDecisionEntity } from './task-decision.entity';
import { WorkflowEngineService } from './workflow-engine.service';

@Resolver()
export class WorkflowEngineMutations {
  constructor(private readonly workflowEngineService: WorkflowEngineService) {}

  @Mutation(() => ApprovalInstanceEntity)
  async submitApprovalInstance(
    @Args('input') input: SubmitApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.submitApprovalInstance(input);
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
  ): Promise<TaskDecisionEntity> {
    return this.workflowEngineService.decideTask(input);
  }
}
