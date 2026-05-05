import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
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
}
