import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  API_DEMO_WEBHOOK_FLAKY_FAILURES,
  API_DEMO_WEBHOOK_SLOW_DELAY_MS,
  ApiDemoWebhookDeliveryRecord,
  ApiDemoWebhookMode,
  ApiDemoWebhookSinkStore,
  isApiDemoWebhookSignatureValid,
  isApiDemoWebhooksEnabled,
  readApiDemoWebhookSigningSecret,
} from './api-demo-webhooks';

const MODES: readonly ApiDemoWebhookMode[] = ['flaky', 'ok', 'slow'];

/**
 * The receiver the demo endpoints call. Unauthenticated on purpose — BPM calls
 * it — and therefore unavailable under `NODE_ENV=production`.
 *
 * The signature is checked against the re-serialized JSON body: BPM's default
 * body is `JSON.stringify(event)`, which a parse/stringify round trip
 * reproduces exactly. A receiver of a host-supplied body would need the raw
 * bytes instead.
 */
@Controller('demo/webhook-sink')
export class ApiDemoWebhookSinkController {
  constructor(private readonly store: ApiDemoWebhookSinkStore) {}

  @Post(':mode')
  @HttpCode(200)
  async receive(
    @Param('mode') mode: string,
    @Body() body: Readonly<Record<string, unknown>>,
    @Headers() headers: Readonly<Record<string, string | undefined>>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ readonly ok: boolean }> {
    const knownMode = this.readMode(mode);
    const deliveryId = headers['x-bpm-delivery-id'] ?? 'missing-delivery-id';
    const signatureValid = isApiDemoWebhookSignatureValid({
      body: JSON.stringify(body),
      secret: readApiDemoWebhookSigningSecret(),
      signature: headers['x-bpm-signature-sha256'],
      timestamp: headers['x-bpm-timestamp'],
    });
    const failing =
      knownMode === 'flaky' &&
      this.store.countAttempts(deliveryId) < API_DEMO_WEBHOOK_FLAKY_FAILURES;
    const status = signatureValid ? (failing ? 503 : 200) : 401;

    if (knownMode === 'slow') {
      await new Promise((resolve) =>
        setTimeout(resolve, API_DEMO_WEBHOOK_SLOW_DELAY_MS),
      );
    }

    this.store.record(deliveryId, body, {
      headers: {
        'x-bpm-delivery-id': headers['x-bpm-delivery-id'],
        'x-bpm-event': headers['x-bpm-event'],
        'x-bpm-timestamp': headers['x-bpm-timestamp'],
      },
      mode: knownMode,
      receivedAt: new Date().toISOString(),
      respondedWith: status,
      signatureValid,
    });
    response.status(status);

    return { ok: status === 200 };
  }

  @Get('deliveries')
  listDeliveries(): readonly ApiDemoWebhookDeliveryRecord[] {
    this.assertEnabled();

    return this.store.list();
  }

  @Delete('deliveries')
  clearDeliveries(): { readonly ok: true } {
    this.assertEnabled();
    this.store.clear();

    return { ok: true };
  }

  private readMode(mode: string): ApiDemoWebhookMode {
    this.assertEnabled();

    const known = MODES.find((candidate) => candidate === mode);

    if (!known) {
      throw new NotFoundException();
    }

    return known;
  }

  private assertEnabled(): void {
    if (!isApiDemoWebhooksEnabled()) {
      throw new NotFoundException();
    }
  }
}
