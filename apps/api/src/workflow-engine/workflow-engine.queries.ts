import { Args, Query, Resolver } from '@nestjs/graphql';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTokenEntity } from './workflow-token.entity';

@Resolver()
export class WorkflowEngineQueries {
  constructor(private readonly workflowEngineService: WorkflowEngineService) {}

  @Query(() => [ApprovalInstanceEntity])
  async approvalInstances(): Promise<readonly ApprovalInstanceEntity[]> {
    return this.workflowEngineService.listApprovalInstances();
  }

  @Query(() => ApprovalInstanceEntity)
  async approvalInstance(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.getApprovalInstance(id);
  }

  @Query(() => [WorkflowTokenEntity])
  async workflowTokens(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<readonly WorkflowTokenEntity[]> {
    return this.workflowEngineService.listWorkflowTokens(instanceId);
  }

  @Query(() => [TaskEntity])
  async tasks(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listTasks(instanceId);
  }

  @Query(() => [TaskEntity])
  async inboxTasks(
    @Args('assigneeMemberId', { type: () => String }) assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listInboxTasks(assigneeMemberId);
  }

  @Query(() => [TaskEntity])
  async approvalHistoryTasks(
    @Args('assigneeMemberId', { type: () => String }) assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listApprovalHistoryTasks(
      assigneeMemberId,
    );
  }

  @Query(() => [TaskDecisionEntity])
  async taskDecisions(
    @Args('taskId', { type: () => String }) taskId: string,
  ): Promise<readonly TaskDecisionEntity[]> {
    return this.workflowEngineService.listTaskDecisions(taskId);
  }

  @Query(() => [ActivityLogEntity])
  async activityLogs(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<readonly ActivityLogEntity[]> {
    return this.workflowEngineService.listActivityLogs(instanceId);
  }
}
