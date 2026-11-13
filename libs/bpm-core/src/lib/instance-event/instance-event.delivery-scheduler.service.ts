import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';
import { InstanceEventService } from './instance-event.service';

/** Retention sweeps are cheap but not urgent; once an hour is plenty. */
const PURGE_INTERVAL_MS = 3_600_000;

/**
 * The fallback that retries failed attempts, releases rows the commit kick
 * missed (ADR 27 §1.3), and sweeps delivered rows past retention. `SKIP LOCKED`
 * in the claim lets several API instances run it at once.
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
  private lastPurgeAt = 0;

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

      await this.purgeIfDue(Date.now());
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

  private async purgeIfDue(now: number): Promise<void> {
    if (now - this.lastPurgeAt < PURGE_INTERVAL_MS) {
      return;
    }

    // Stamped before the call, so a failing sweep is not retried every scan.
    this.lastPurgeAt = now;

    const purged = await this.deliveryService.purgeDelivered(new Date(now));

    if (purged) {
      this.logger.log(`Purged ${purged} delivered instance events`);
    }
  }
}
