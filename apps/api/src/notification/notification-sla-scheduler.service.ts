import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { NotificationService } from './notification.service';

const SLA_SCAN_INTERVAL_MS = 60_000;

@Injectable()
export class NotificationSlaSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationSlaSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly notificationService: NotificationService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.timer = setInterval((): void => {
      void this.scanSla();
    }, SLA_SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scanSla(): Promise<void> {
    try {
      const result = await this.notificationService.runSlaScan();

      if (result.overdueCount || result.warningCount) {
        this.logger.log(
          `SLA scan created ${result.warningCount} warning and ${result.overdueCount} overdue notifications`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error ? error.message : 'SLA scan failed',
      );
    }
  }
}
