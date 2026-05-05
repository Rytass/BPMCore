import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
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
    TypeOrmModule.forFeature([
      ActivityLogEntity,
      ApprovalInstanceEntity,
      ApprovalTemplateEntity,
      ApprovalTemplateVersionEntity,
      FormDefinitionVersionEntity,
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
