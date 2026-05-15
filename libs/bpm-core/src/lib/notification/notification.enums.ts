import { registerEnumType } from '@nestjs/graphql';

export enum NotificationChannelEnum {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  WEBHOOK = 'WEBHOOK',
}

export enum NotificationDigestModeEnum {
  DAILY = 'DAILY',
  INSTANT = 'INSTANT',
}

export enum NotificationStatusEnum {
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  READ = 'READ',
  SENT = 'SENT',
}

export enum NotificationTypeEnum {
  INSTANCE_COMPLETED = 'INSTANCE_COMPLETED',
  SLA_OVERDUE = 'SLA_OVERDUE',
  SLA_WARNING = 'SLA_WARNING',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_TRANSFERRED = 'TASK_TRANSFERRED',
  WORKFLOW_NOTIFICATION = 'WORKFLOW_NOTIFICATION',
}

registerEnumType(NotificationChannelEnum, {
  name: 'NotificationChannel',
});

registerEnumType(NotificationDigestModeEnum, {
  name: 'NotificationDigestMode',
});

registerEnumType(NotificationStatusEnum, {
  name: 'NotificationStatus',
});

registerEnumType(NotificationTypeEnum, {
  name: 'NotificationType',
});
