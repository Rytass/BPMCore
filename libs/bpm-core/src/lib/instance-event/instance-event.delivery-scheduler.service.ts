import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';
import { InstanceEventService } from './instance-event.service';

/**
 * The fallback that retries failed attempts and releases rows the commit kick
 * missed (ADR 27 §1.3). `SKIP LOCKED` in the claim lets several API instances
 * run it at once.
 */
@Injectable()
export class InstanceEventDeliverySchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    InstanceEventDeliverySchedulerService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    private readonly deliveryService: InstanceEventDeliveryService,
    private readonly events: InstanceEventService,
  ) {}

  onApplicationBootstrap(): void {
    // Without an observer there is nothing to deliver to, so no idle timer.
    if (process.env.NODE_ENV === 'test' || !this.events.enabled) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.scan();
    }, this.events.delivery.scanIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scan(): Promise<void> {
    // A slow observer must not stack scans on top of each other.
    if (this.scanning) {
      return;
    }

    this.scanning = true;

    try {
      const count = await this.deliveryService.deliverDue();

      if (count) {
        this.logger.log(`Attempted ${count} instance event deliveries`);
      }
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error
          ? error.message
          : 'Instance event delivery scan failed',
      );
    } finally {
      this.scanning = false;
    }
  }
}
