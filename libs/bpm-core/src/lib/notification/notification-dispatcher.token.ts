import { InjectionToken } from '@nestjs/common';
import { NotificationEntity } from './notification.entity';
import { BPMResolvedNotificationOptions } from './notification-options';

export interface BPMNotificationDispatcher {
  dispatch(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string>;

  /**
   * Sends one message covering several notifications, for a recipient whose
   * `emailDigestMode` is `DAILY`.
   *
   * Optional. Without it BPM falls back to {@link dispatch} once per row, so
   * a `DAILY` recipient still gets their email held until the digest hour but
   * receives one message per notification rather than one combined message.
   * BPM's built-in SMTP path always combines.
   *
   * Every notification in the batch is for the same recipient and channel.
   * Return the delivery target recorded against every row in the batch.
   */
  dispatchDigest?(
    notifications: readonly NotificationEntity[],
    options: BPMResolvedNotificationOptions,
  ): Promise<string>;
}

export const BPM_NOTIFICATION_DISPATCHER: InjectionToken<BPMNotificationDispatcher> =
  Symbol('BPM_NOTIFICATION_DISPATCHER');
