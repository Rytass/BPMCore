import { Args, Query, Resolver } from '@nestjs/graphql';
import {
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  BPMAuthContext,
} from '../bpm-auth';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTokenEntity } from './workflow-token.entity';

@Resolver()
@BPMAuthenticated()
export class WorkflowEngineQueries {
  constructor(private readonly workflowEngineService: WorkflowEngineService) {}

  @Query(() => [ApprovalInstanceEntity])
  async approvalInstances(
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly ApprovalInstanceEntity[]> {
    return this.workflowEngineService.listApprovalInstances(currentAuthContext);
  }

  @Query(() => ApprovalInstanceEntity)
  async approvalInstance(
    @Args('id', { type: () => String }) id: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<ApprovalInstanceEntity> {
    return this.workflowEngineService.getApprovalInstance(
      id,
      currentAuthContext,
    );
  }

  @Query(() => [WorkflowTokenEntity])
  async workflowTokens(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly WorkflowTokenEntity[]> {
    return this.workflowEngineService.listWorkflowTokens(
      instanceId,
      currentAuthContext,
    );
  }

  @Query(() => [TaskEntity])
  async tasks(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listTasks(instanceId, currentAuthContext);
  }

  @Query(() => [TaskEntity])
  async inboxTasks(
    @Args('assigneeMemberId', { type: () => String }) assigneeMemberId: string,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listInboxTasks(currentMemberId);
  }

  @Query(() => [TaskEntity])
  async approvalHistoryTasks(
    @Args('assigneeMemberId', { type: () => String }) assigneeMemberId: string,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    return this.workflowEngineService.listApprovalHistoryTasks(
      currentMemberId,
    );
  }

  @Query(() => [ApprovalTemplateEntity])
  async launchableApprovalTemplates(
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<readonly ApprovalTemplateEntity[]> {
    return this.workflowEngineService.listLaunchableApprovalTemplates(
      currentMemberId,
    );
  }

  @Query(() => [TaskDecisionEntity])
  async taskDecisions(
    @Args('taskId', { type: () => String }) taskId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly TaskDecisionEntity[]> {
    return this.workflowEngineService.listTaskDecisions(
      taskId,
      currentAuthContext,
    );
  }

  @Query(() => [TaskCandidateEntity])
  async taskCandidates(
    @Args('taskId', { type: () => String }) taskId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly TaskCandidateEntity[]> {
    return this.workflowEngineService.listTaskCandidates(
      taskId,
      currentAuthContext,
    );
  }

  @Query(() => [ActivityLogEntity])
  async activityLogs(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly ActivityLogEntity[]> {
    return this.workflowEngineService.listActivityLogs(
      instanceId,
      currentAuthContext,
    );
  }
}
