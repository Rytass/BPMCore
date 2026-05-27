import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { DelegationModule } from '../delegation/delegation.module';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { ManagerResolutionEntity } from '../organization/manager-resolution.entity';
import { NotificationEntity } from '../notification/notification.entity';
import { NotificationModule } from '../notification/notification.module';
import { OrgUnitEntity } from '../organization/org-unit.entity';
import { SignatureModule } from '../signature/signature.module';
import { MembershipEntity } from '../organization/membership.entity';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskEntity } from './task.entity';
import { WorkflowEngineMutations } from './workflow-engine.mutations';
import { WorkflowEngineQueries } from './workflow-engine.queries';
import { WorkflowEngineService } from './workflow-engine.service';
import { BPM_WORKFLOW_ENGINE_SERVICE } from './workflow-engine.tokens';
import { BPMWorkflowServiceTaskDispatcher } from './workflow-service-task-dispatcher.token';
import { WorkflowTokenEntity } from './workflow-token.entity';

export interface WorkflowEngineModuleOptions
  extends Pick<ModuleMetadata, 'imports'> {
  readonly serviceTaskDispatcherProvider?: Provider<BPMWorkflowServiceTaskDispatcher>;
}

@Module({
  imports: [
    ConditionModule,
    DelegationModule,
    NotificationModule,
    SignatureModule,
    TypeOrmModule.forFeature([
      ActivityLogEntity,
      ApprovalInstanceEntity,
      ApprovalTemplateEntity,
      ApprovalTemplateVersionEntity,
      FormDefinitionVersionEntity,
      ManagerResolutionEntity,
      MembershipEntity,
      NotificationEntity,
      OrgUnitEntity,
      TaskCandidateEntity,
      TaskDecisionEntity,
      TaskEntity,
      WorkflowTokenEntity,
    ]),
  ],
  providers: [
    WorkflowEngineMutations,
    WorkflowEngineQueries,
    WorkflowEngineService,
    {
      provide: BPM_WORKFLOW_ENGINE_SERVICE,
      useExisting: WorkflowEngineService,
    },
  ],
  exports: [BPM_WORKFLOW_ENGINE_SERVICE, WorkflowEngineService],
})
export class WorkflowEngineModule {
  static forRoot(options: WorkflowEngineModuleOptions = {}): DynamicModule {
    return {
      imports: options.imports ? [...options.imports] : [],
      module: WorkflowEngineModule,
      providers: options.serviceTaskDispatcherProvider
        ? [options.serviceTaskDispatcherProvider]
        : [],
    };
  }
}
