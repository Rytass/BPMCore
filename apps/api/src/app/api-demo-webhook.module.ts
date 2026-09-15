import { Module } from '@nestjs/common';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { ApiDemoWebhookSinkController } from './api-demo-webhook-sink.controller';
import {
  ApiDemoWebhookSigningSecret,
  ApiDemoWebhookSinkStore,
} from './api-demo-webhooks';

/**
 * The demo NOTIFY webhook receiver and the signing secret it shares with the
 * demo endpoints. Imported into `BPMRootModule` so the registry provider can
 * inject the secret reader.
 */
@Module({
  controllers: [ApiDemoWebhookSinkController],
  exports: [ApiDemoWebhookSigningSecret],
  imports: [VaultModule],
  providers: [
    ApiDemoWebhookSinkStore,
    {
      inject: [VaultService],
      provide: ApiDemoWebhookSigningSecret,
      useFactory: (vault: VaultService): ApiDemoWebhookSigningSecret =>
        new ApiDemoWebhookSigningSecret((key) => vault.get(key)),
    },
  ],
})
export class ApiDemoWebhookModule {}
