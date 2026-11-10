import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isApiDemoWebhookSignatureValid } from './api-demo-webhooks';
import { ApiSessionService } from './api-session.service';
import {
  API_SHOWCASE_WEBHOOK_ROUTE,
  ApiShowcaseNotification,
  ApiShowcaseWebhookHub,
  isApiShowcaseTimestampFresh,
  isApiShowcaseWebhookEnabled,
  readApiShowcaseNotification,
} from './api-showcase-webhook';

/** Comment line that keeps proxies from closing an idle stream. */
export const API_SHOWCASE_WEBHOOK_HEARTBEAT_MS = 25_000;

/** How long the browser waits before reconnecting a dropped stream. */
export const API_SHOWCASE_WEBHOOK_RETRY_MS = 5_000;

/**
 * The showcase receiver and the browser stream (see `api-showcase-webhook.ts`).
 *
 * `POST deliveries` is called by BPM from inside this process and is not
 * routed by the staging ingress; it trusts nothing but the signature. `GET
 * stream` is what the browser opens, and needs a signed-in session.
 */
@Controller(API_SHOWCASE_WEBHOOK_ROUTE)
export class ApiShowcaseWebhookController {
  constructor(
    private readonly hub: ApiShowcaseWebhookHub,
    private readonly sessionService: ApiSessionService,
  ) {}

  @Post('deliveries')
  @HttpCode(200)
  receive(
    @Body() body: Readonly<Record<string, unknown>>,
    @Headers() headers: Readonly<Record<string, string | undefined>>,
    @Res({ passthrough: true }) response: Response,
  ): { readonly ok: boolean } {
    this.assertEnabled();

    const timestamp = headers['x-bpm-timestamp'];
    const signatureValid =
      isApiShowcaseTimestampFresh(timestamp) &&
      isApiDemoWebhookSignatureValid({
        body: JSON.stringify(body),
        secret: this.hub.signingSecret,
        signature: headers['x-bpm-signature-sha256'],
        timestamp,
      });

    if (!signatureValid) {
      response.status(401);

      return { ok: false };
    }

    const notification = readApiShowcaseNotification(
      body,
      headers['x-bpm-delivery-id'] ?? '',
    );

    // Signed by BPM but not something to show: answering 400 marks it FAILED
    // without retries, which is what an unusable event deserves.
    if (!notification) {
      response.status(400);

      return { ok: false };
    }

    this.hub.publish(notification);

    return { ok: true };
  }

  @Get('stream')
  async stream(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.assertEnabled();

    const member =
      await this.sessionService.readAuthenticatedMemberFromRequest(request);

    if (!member) {
      // A non-200 answer makes EventSource give up instead of reconnecting.
      response.status(401).json({ message: 'BPM API session is required' });

      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write(`retry: ${API_SHOWCASE_WEBHOOK_RETRY_MS}\n\n`);

    const unsubscribe = this.hub.subscribe(
      (notification: ApiShowcaseNotification): void => {
        response.write(formatServerSentEvent(notification));
      },
    );
    const heartbeat = setInterval((): void => {
      response.write(': heartbeat\n\n');
    }, API_SHOWCASE_WEBHOOK_HEARTBEAT_MS);

    request.on('close', (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  private assertEnabled(): void {
    if (!isApiShowcaseWebhookEnabled()) {
      throw new NotFoundException();
    }
  }
}

/** One `notification` event; the id lets the browser drop a repeat. */
export function formatServerSentEvent(
  notification: ApiShowcaseNotification,
): string {
  return [
    `id: ${notification.deliveryId}`,
    'event: notification',
    `data: ${JSON.stringify(notification)}`,
    '',
    '',
  ].join('\n');
}
