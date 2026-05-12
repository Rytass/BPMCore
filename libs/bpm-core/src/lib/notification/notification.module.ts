import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import { NotificationMutations } from './notification.mutations';
import { NotificationQueries } from './notification.queries';
import { NotificationSlaSchedulerService } from './notification-sla-scheduler.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityLogEntity,
      ApprovalInstanceEntity,
      NotificationEntity,
      NotificationPreferenceEntity,
      TaskEntity,
    ]),
  ],
  providers: [
    NotificationMutations,
    NotificationQueries,
    NotificationService,
    NotificationSlaSchedulerService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
