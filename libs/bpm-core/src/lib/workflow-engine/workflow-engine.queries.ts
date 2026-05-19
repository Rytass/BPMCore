import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  BPMAuthContext,
} from '../bpm-auth';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { ApprovalInstancePageInfoObject } from './approval-instance-page-info.object';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowDashboardSummaryObject } from './workflow-dashboard-summary.object';
import {
  ApprovalInstanceListViewEnum,
  ApprovalInstanceStateEnum,
} from './workflow-engine.enums';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTokenEntity } from './workflow-token.entity';

@Resolver()
@BPMAuthenticated()
export class WorkflowEngineQueries {
  constructor(private readonly workflowEngineService: WorkflowEngineService) {}

  @Query(() => [ApprovalInstanceEntity])
  async approvalInstances(
    @Args('view', {
      nullable: true,
      type: () => ApprovalInstanceListViewEnum,
    })
    view: ApprovalInstanceListViewEnum | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText: string | null,
    @Args('state', {
      nullable: true,
      type: () => [ApprovalInstanceStateEnum],
    })
    state: readonly ApprovalInstanceStateEnum[] | null,
    @Args('templateId', { nullable: true, type: () => String })
    templateId: string | null,
    @Args('page', { nullable: true, type: () => Int })
    page: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize: number | null,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly ApprovalInstanceEntity[]> {
    return this.workflowEngineService.listApprovalInstances(
      currentAuthContext,
      {
        page: page ?? undefined,
        pageSize: pageSize ?? undefined,
        searchText: searchText ?? undefined,
        state: state ?? undefined,
        templateId: templateId ?? undefined,
        view: view ?? undefined,
      },
    );
  }

  @Query(() => Int)
  async approvalInstanceCount(
    @Args('view', {
      nullable: true,
      type: () => ApprovalInstanceListViewEnum,
    })
    view: ApprovalInstanceListViewEnum | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText: string | null,
    @Args('state', {
      nullable: true,
      type: () => [ApprovalInstanceStateEnum],
    })
    state: readonly ApprovalInstanceStateEnum[] | null,
    @Args('templateId', { nullable: true, type: () => String })
    templateId: string | null,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<number> {
    return this.workflowEngineService.countApprovalInstances(
      currentAuthContext,
      {
        searchText: searchText ?? undefined,
        state: state ?? undefined,
        templateId: templateId ?? undefined,
        view: view ?? undefined,
      },
    );
  }

  @Query(() => ApprovalInstancePageInfoObject)
  async approvalInstancePageInfo(
    @Args('view', {
      nullable: true,
      type: () => ApprovalInstanceListViewEnum,
    })
    view: ApprovalInstanceListViewEnum | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText: string | null,
    @Args('state', {
      nullable: true,
      type: () => [ApprovalInstanceStateEnum],
    })
    state: readonly ApprovalInstanceStateEnum[] | null,
    @Args('templateId', { nullable: true, type: () => String })
    templateId: string | null,
    @Args('page', { nullable: true, type: () => Int })
    page: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize: number | null,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<ApprovalInstancePageInfoObject> {
    return this.workflowEngineService.readApprovalInstancePageInfo(
      currentAuthContext,
      {
        page: page ?? undefined,
        pageSize: pageSize ?? undefined,
        searchText: searchText ?? undefined,
        state: state ?? undefined,
        templateId: templateId ?? undefined,
        view: view ?? undefined,
      },
    );
  }

  @Query(() => WorkflowDashboardSummaryObject)
  async workflowDashboardSummary(
    @Args('from', { nullable: true, type: () => Date }) from: Date | null,
    @Args('to', { nullable: true, type: () => Date }) to: Date | null,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<WorkflowDashboardSummaryObject> {
    return this.workflowEngineService.readWorkflowDashboardSummary(
      currentAuthContext,
      {
        from: from ?? undefined,
        to: to ?? undefined,
      },
    );
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
    return this.workflowEngineService.listApprovalHistoryTasks(currentMemberId);
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
