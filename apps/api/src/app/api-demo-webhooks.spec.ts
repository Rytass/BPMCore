import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { ApiDemoWebhookSinkController } from './api-demo-webhook-sink.controller';
import {
  ApiDemoWebhookSinkStore,
  createApiDemoWebhookRegistry,
  isApiDemoWebhookSignatureValid,
  readApiDemoWebhookSigningSecret,
} from './api-demo-webhooks';

function signedHeaders(
  body: object,
  deliveryId: string,
): Record<string, string> {
  const timestamp = '1789466400';

  return {
    'x-bpm-delivery-id': deliveryId,
    'x-bpm-event': 'workflow.notify',
    'x-bpm-signature-sha256': createHmac(
      'sha256',
      readApiDemoWebhookSigningSecret(),
    )
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest('hex'),
    'x-bpm-timestamp': timestamp,
  };
}

function fakeResponse(): Response & { statusCode: number } {
  const response = { statusCode: 200 } as Response & { statusCode: number };

  response.status = ((code: number) => {
    response.statusCode = code;

    return response;
  }) as Response['status'];

  return response;
}

describe('api demo webhooks', () => {
  it('registers the three demo endpoints outside production', () => {
    expect(
      createApiDemoWebhookRegistry()
        .list()
        .map((endpoint) => endpoint.descriptor.key),
    ).toEqual(['demo.purchase-approved', 'demo.flaky', 'demo.slow']);
  });

  it('registers nothing in production', () => {
    const previous = process.env.NODE_ENV;

    process.env.NODE_ENV = 'production';

    try {
      expect(createApiDemoWebhookRegistry().list()).toEqual([]);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('verifies the signature over timestamp and body', () => {
    const body = { deliveryId: 'd-1' };
    const headers = signedHeaders(body, 'd-1');

    expect(
      isApiDemoWebhookSignatureValid({
        body: JSON.stringify(body),
        secret: readApiDemoWebhookSigningSecret(),
        signature: headers['x-bpm-signature-sha256'],
        timestamp: headers['x-bpm-timestamp'],
      }),
    ).toBe(true);
    expect(
      isApiDemoWebhookSignatureValid({
        body: JSON.stringify({ deliveryId: 'tampered' }),
        secret: readApiDemoWebhookSigningSecret(),
        signature: headers['x-bpm-signature-sha256'],
        timestamp: headers['x-bpm-timestamp'],
      }),
    ).toBe(false);
  });

  it('answers the flaky mode with 503 twice, then 200, per delivery id', async () => {
    const store = new ApiDemoWebhookSinkStore();
    const controller = new ApiDemoWebhookSinkController(store);
    const body = { deliveryId: 'd-flaky' };
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = fakeResponse();

      await controller.receive(
        'flaky',
        body,
        signedHeaders(body, 'd-flaky'),
        response,
      );
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([503, 503, 200]);
    expect(store.list()[0]?.receipts.map((receipt) => receipt.attempt)).toEqual(
      [1, 2, 3],
    );
  });

  it('rejects an unsigned request with 401', async () => {
    const controller = new ApiDemoWebhookSinkController(
      new ApiDemoWebhookSinkStore(),
    );
    const response = fakeResponse();

    await controller.receive(
      'ok',
      { a: 1 },
      { 'x-bpm-delivery-id': 'd' },
      response,
    );

    expect(response.statusCode).toBe(401);
  });
});
