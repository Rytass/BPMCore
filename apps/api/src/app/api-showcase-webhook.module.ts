import { Module } from '@nestjs/common';
import { ApiAuthModule } from './api-auth.module';
import { ApiShowcaseWebhookController } from './api-showcase-webhook.controller';
import { ApiShowcaseWebhookHub } from './api-showcase-webhook';

/**
 * The staging NOTIFY webhook showcase: receiver, browser stream and the hub
 * that holds their shared signing secret. Imported into `BPMRootModule` so the
 * registry provider can build the showcase endpoint from the same hub.
 */
@Module({
  controllers: [ApiShowcaseWebhookController],
  exports: [ApiShowcaseWebhookHub],
  imports: [ApiAuthModule],
  providers: [
    {
      provide: ApiShowcaseWebhookHub,
      useFactory: (): ApiShowcaseWebhookHub => new ApiShowcaseWebhookHub(),
    },
  ],
})
export class ApiShowcaseWebhookModule {}
