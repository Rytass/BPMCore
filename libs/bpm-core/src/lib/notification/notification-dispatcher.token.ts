import { InjectionToken } from '@nestjs/common';
import { NotificationEntity } from './notification.entity';
import { BPMResolvedNotificationOptions } from './notification-options';

export interface BPMNotificationDispatcher {
  dispatch(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string>;
}

export const BPM_NOTIFICATION_DISPATCHER: InjectionToken<BPMNotificationDispatcher> =
  Symbol('BPM_NOTIFICATION_DISPATCHER');
