import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { NotificationDeliveryService } from './notification-delivery.service';
import {
  BPM_NOTIFICATION_OPTIONS,
  BPMResolvedNotificationOptions,
  DEFAULT_BPM_NOTIFICATION_OPTIONS,
} from './notification-options';

@Injectable()
export class NotificationDeliverySchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    NotificationDeliverySchedulerService.name,
  );
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deliveryService: NotificationDeliveryService,
    @Optional()
    @Inject(BPM_NOTIFICATION_OPTIONS)
    private readonly notificationOptions: BPMResolvedNotificationOptions = DEFAULT_BPM_NOTIFICATION_OPTIONS,
  ) {}

  onApplicationBootstrap(): void {
    if (
      process.env.NODE_ENV === 'test' ||
      !this.notificationOptions.deliverySchedulerEnabled
    ) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.scanPendingDeliveries();
    }, this.notificationOptions.deliveryScanIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scanPendingDeliveries(): Promise<void> {
    try {
      const deliveredCount =
        await this.deliveryService.deliverPendingNotifications({
          options: this.notificationOptions,
        });

      if (deliveredCount) {
        this.logger.log(`Delivered ${deliveredCount} pending notifications`);
      }
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error ? error.message : 'Delivery scan failed',
      );
    }
  }
}
