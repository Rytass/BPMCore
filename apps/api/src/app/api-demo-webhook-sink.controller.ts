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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  API_DEMO_WEBHOOK_FLAKY_FAILURES,
  API_DEMO_WEBHOOK_MODES,
  API_DEMO_WEBHOOK_SLOW_DELAY_MS,
  ApiDemoWebhookBehavior,
  ApiDemoWebhookDeliveryRecord,
  ApiDemoWebhookMode,
  ApiDemoWebhookSigningSecret,
  ApiDemoWebhookSinkStore,
  isApiDemoWebhookSignatureValid,
  isApiDemoWebhooksEnabled,
  readApiDemoWebhookBehavior,
} from './api-demo-webhooks';

/**
 * The receiver the demo endpoints call. Unauthenticated on purpose — BPM calls
 * it — and therefore unavailable under `NODE_ENV=production`.
 *
 * The signature is checked against the re-serialized JSON body: BPM's default
 * body is `JSON.stringify(event)`, which a parse/stringify round trip
 * reproduces exactly. A receiver of a host-supplied body would need the raw
 * bytes instead.
 *
 * A mode's answer can be overridden to exercise failures: per request with
 * `?status=503&delayMs=2000`, or for every later request with
 * `PUT /demo/webhook-sink/modes/:mode`. A bad signature is answered 401 at
 * once, before any simulated behavior, and is not recorded.
 */
@Controller('demo/webhook-sink')
export class ApiDemoWebhookSinkController {
  constructor(
    private readonly store: ApiDemoWebhookSinkStore,
    private readonly secret: ApiDemoWebhookSigningSecret,
  ) {}

  @Post(':mode')
  @HttpCode(200)
  async receive(
    @Param('mode') mode: string,
    @Body() body: Readonly<Record<string, unknown>>,
    @Headers() headers: Readonly<Record<string, string | undefined>>,
    @Res({ passthrough: true }) response: Response,
    @Query() query: Readonly<Record<string, unknown>> = {},
  ): Promise<{ readonly ok: boolean }> {
    const knownMode = this.readMode(mode);
    const deliveryId = headers['x-bpm-delivery-id'] ?? 'missing-delivery-id';
    const signatureValid = isApiDemoWebhookSignatureValid({
      body: JSON.stringify(body),
      secret: await this.secret.read(),
      signature: headers['x-bpm-signature-sha256'],
      timestamp: headers['x-bpm-timestamp'],
    });

    // An unsigned caller gets nothing it could use to hold a connection or
    // grow the store: no simulated delay, no receipt.
    if (!signatureValid) {
      response.status(401);

      return { ok: false };
    }

    const behavior = this.readEffectiveBehavior(knownMode, query);
    const failing =
      knownMode === 'flaky' &&
      this.store.countAttempts(deliveryId) < API_DEMO_WEBHOOK_FLAKY_FAILURES;
    const status = behavior.status ?? (failing ? 503 : 200);

    if (behavior.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
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
      signatureValid: true,
    });
    response.status(status);

    return { ok: status >= 200 && status < 300 };
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

  @Get('modes')
  listModes(): Readonly<Record<string, ApiDemoWebhookBehavior>> {
    this.assertEnabled();

    return this.store.listBehaviors();
  }

  /** `{ "status": 400 }` to fail every later request; `{}` to restore. */
  @Put('modes/:mode')
  setMode(
    @Param('mode') mode: string,
    @Body() body: Readonly<Record<string, unknown>>,
  ): ApiDemoWebhookBehavior {
    const knownMode = this.readMode(mode);
    const behavior = readApiDemoWebhookBehavior(body ?? {});

    this.store.setBehavior(knownMode, behavior);

    return behavior;
  }

  private readEffectiveBehavior(
    mode: ApiDemoWebhookMode,
    query: Readonly<Record<string, unknown>>,
  ): ApiDemoWebhookBehavior {
    const requested = readApiDemoWebhookBehavior(query);
    const stored = this.store.readBehavior(mode);

    return {
      delayMs:
        requested.delayMs ||
        stored.delayMs ||
        (mode === 'slow' ? API_DEMO_WEBHOOK_SLOW_DELAY_MS : 0),
      status: requested.status ?? stored.status,
    };
  }

  private readMode(mode: string): ApiDemoWebhookMode {
    this.assertEnabled();

    const known = API_DEMO_WEBHOOK_MODES.find(
      (candidate) => candidate === mode,
    );

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
