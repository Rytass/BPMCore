import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationDeliverySchedulerService } from './notification-delivery-scheduler.service';
import { NotificationDeliveryService } from './notification-delivery.service';
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
      TaskCandidateEntity,
      TaskEntity,
    ]),
  ],
  providers: [
    NotificationMutations,
    NotificationQueries,
    NotificationDeliverySchedulerService,
    NotificationDeliveryService,
    NotificationService,
    NotificationSlaSchedulerService,
  ],
  exports: [NotificationDeliveryService, NotificationService],
})
export class NotificationModule {}
