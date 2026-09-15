import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';
import { WorkflowWebhookService } from './workflow-webhook.service';

/**
 * The fallback that retries failed attempts, releases rows the immediate kick
 * missed, and reclaims rows a crashed worker left in progress. `SKIP LOCKED`
 * in the claim lets several API instances run it at once.
 */
@Injectable()
export class WorkflowWebhookDeliverySchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    WorkflowWebhookDeliverySchedulerService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    private readonly deliveryService: WorkflowWebhookDeliveryService,
    private readonly webhookService: WorkflowWebhookService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !(await this.isEnabled())) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.scan();
    }, this.webhookService.readOptions().delivery.scanIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Unset means "on when there is anything to deliver to": a host with no
   * endpoints gets no idle timer, and one with endpoints never silently loses
   * its retries.
   */
  async isEnabled(): Promise<boolean> {
    const configured =
      this.webhookService.readOptions().delivery.schedulerEnabled;

    if (configured !== null) {
      return configured;
    }

    if (!this.webhookService.hasEndpointSources()) {
      return false;
    }

    // Endpoints can be added in the database at any time, so an empty list
    // at boot says nothing about tomorrow; a scan with nothing due is cheap.
    if (this.webhookService.hasDatabaseSource()) {
      return true;
    }

    try {
      return (
        (await this.webhookService.listEndpoints({ includeDeprecated: true }))
          .length > 0
      );
    } catch {
      // A source that cannot list its endpoints at boot may still have rows
      // to retry; running an idle scan is cheaper than losing them.
      this.logger.warn(
        'Could not list webhook endpoints at boot; the delivery scheduler runs anyway',
      );

      return true;
    }
  }

  async scan(): Promise<void> {
    // A slow receiver must not stack scans on top of each other.
    if (this.scanning) {
      return;
    }

    this.scanning = true;

    try {
      const count = await this.deliveryService.deliverDue();

      if (count) {
        this.logger.log(`Attempted ${count} webhook deliveries`);
      }
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error ? error.message : 'Webhook delivery scan failed',
      );
    } finally {
      this.scanning = false;
    }
  }
}
