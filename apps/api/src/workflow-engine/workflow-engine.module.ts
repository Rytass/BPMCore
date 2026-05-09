import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { DelegationModule } from '../delegation/delegation.module';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { NotificationModule } from '../notification/notification.module';
import { MembershipEntity } from '../organization/membership.entity';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowEngineMutations } from './workflow-engine.mutations';
import { WorkflowEngineQueries } from './workflow-engine.queries';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTokenEntity } from './workflow-token.entity';

@Module({
  imports: [
    ConditionModule,
    DelegationModule,
    NotificationModule,
    TypeOrmModule.forFeature([
      ActivityLogEntity,
      ApprovalInstanceEntity,
      ApprovalTemplateEntity,
      ApprovalTemplateVersionEntity,
      FormDefinitionVersionEntity,
      MembershipEntity,
      TaskDecisionEntity,
      TaskEntity,
      WorkflowTokenEntity,
    ]),
  ],
  providers: [
    WorkflowEngineMutations,
    WorkflowEngineQueries,
    WorkflowEngineService,
  ],
  exports: [WorkflowEngineService],
})
export class WorkflowEngineModule {}
