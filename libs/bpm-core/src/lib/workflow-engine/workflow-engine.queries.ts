import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import {
  BPMAdminOnly,
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  BPMAuthContext,
} from '../bpm-auth';
import { IdentityService } from '../identity/identity.service';
import {
  InactiveMemberWithOpenTasksObject,
  MemberOpenTaskObject,
} from './task-reassignment.object';
import {
  InactiveMemberOpenTasksRecord,
  MemberOpenTaskRecord,
} from './workflow-engine.service';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
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
  constructor(
    private readonly workflowEngineService: WorkflowEngineService,
    private readonly moduleRef: ModuleRef,
  ) {}

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

  @Query(() => [MemberOpenTaskObject], {
    description:
      'Administrator: the open tasks a member holds (assignee, or a PENDING, ' +
      'CLAIMED or WAITING candidate seat) on RUNNING instances.',
  })
  @BPMAdminOnly()
  async memberOpenTasks(
    @Args('memberId', { type: () => ID }) memberId: string,
  ): Promise<readonly MemberOpenTaskRecord[]> {
    return this.workflowEngineService.listMemberOpenTasks(memberId);
  }

  @Query(() => [InactiveMemberWithOpenTasksObject], {
    description:
      'Administrator: members the host reports as deactivated who still hold ' +
      'open tasks, with the count memberOpenTasks would list. Always empty ' +
      'when the host member resolver does not implement resolveInactive, or ' +
      'when the engine is wired without the identity module.',
  })
  @BPMAdminOnly()
  async inactiveMembersWithOpenTasks(): Promise<
    readonly InactiveMemberOpenTasksRecord[]
  > {
    const identityService = this.readIdentityService();

    if (!identityService) {
      return [];
    }

    return this.workflowEngineService.listInactiveMembersWithOpenTasks(
      (memberIds): Promise<readonly MemberMetadata[]> =>
        identityService.resolveInactiveMembers(memberIds),
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

  @Query(() => [AdhocDirectiveEntity])
  async adhocDirectives(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @BPMCurrentAuthContext() currentAuthContext: BPMAuthContext,
  ): Promise<readonly AdhocDirectiveEntity[]> {
    return this.workflowEngineService.listAdhocDirectives(
      instanceId,
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

  /**
   * Looked up at call time rather than injected: `IdentityModule` is a dynamic
   * module the root configures with the host's options, so this module cannot
   * import it. A host that wires the engine without it gets an empty list, the
   * same answer as a member resolver without `resolveInactive`.
   */
  private readIdentityService(): IdentityService | null {
    try {
      return this.moduleRef.get(IdentityService, { strict: false });
    } catch (error) {
      // Only "not registered" means no identity module; anything else is a
      // real failure and must not pass for an empty list.
      if (error instanceof UnknownElementException) {
        return null;
      }

      throw error;
    }
  }
}
