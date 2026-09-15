import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { ApiDemoWebhookSinkController } from './api-demo-webhook-sink.controller';
import {
  API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET,
  API_DEMO_WEBHOOK_MAX_DELAY_MS,
  API_DEMO_WEBHOOK_MAX_STORED_DELIVERIES,
  ApiDemoWebhookSigningSecret,
  ApiDemoWebhookSinkStore,
  createApiDemoWebhookRegistry,
  isApiDemoWebhookSignatureValid,
  readApiDemoWebhookBehavior,
} from './api-demo-webhooks';

const NO_VAULT_VALUE = new ApiDemoWebhookSigningSecret(async () => '');

function signedHeaders(
  body: object,
  deliveryId: string,
  secret = API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET,
): Record<string, string> {
  const timestamp = '1789466400';

  return {
    'x-bpm-delivery-id': deliveryId,
    'x-bpm-event': 'workflow.notify',
    'x-bpm-signature-sha256': createHmac('sha256', secret)
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

function createController(
  store = new ApiDemoWebhookSinkStore(),
  secret = NO_VAULT_VALUE,
): ApiDemoWebhookSinkController {
  return new ApiDemoWebhookSinkController(store, secret);
}

async function send(
  controller: ApiDemoWebhookSinkController,
  mode: string,
  deliveryId: string,
  query: Readonly<Record<string, unknown>> = {},
): Promise<number> {
  const body = { deliveryId };
  const response = fakeResponse();

  await controller.receive(
    mode,
    body,
    signedHeaders(body, deliveryId),
    response,
    query,
  );

  return response.statusCode;
}

describe('api demo webhooks', () => {
  const previousSecret = process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET;

  afterEach((): void => {
    if (previousSecret === undefined) {
      delete process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET;
    } else {
      process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET = previousSecret;
    }
  });

  it('registers the demo endpoints outside production', () => {
    expect(
      createApiDemoWebhookRegistry(NO_VAULT_VALUE)
        .list()
        .map((endpoint) => endpoint.descriptor.key),
    ).toEqual([
      'demo.purchase-approved',
      'demo.leave-submitted',
      'demo.flaky',
      'demo.slow',
      'demo.switchable',
    ]);
  });

  it('registers nothing in production', () => {
    const previous = process.env.NODE_ENV;

    process.env.NODE_ENV = 'production';

    try {
      expect(createApiDemoWebhookRegistry(NO_VAULT_VALUE).list()).toEqual([]);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('reads the signing secret from Vault, then the environment, then the default', async () => {
    delete process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET;

    await expect(NO_VAULT_VALUE.read()).resolves.toBe(
      API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET,
    );

    process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET = 'from-env';
    await expect(NO_VAULT_VALUE.read()).resolves.toBe('from-env');
    await expect(
      new ApiDemoWebhookSigningSecret(async () => {
        throw new Error('vault down');
      }).read(),
    ).resolves.toBe('from-env');

    const fromVault = new ApiDemoWebhookSigningSecret(async (key) =>
      key === 'BPM_DEMO_WEBHOOK_SIGNING_SECRET' ? 'from-vault' : '',
    );

    await expect(fromVault.read()).resolves.toBe('from-vault');

    // The endpoints sign with what the reader returns at the time of sending.
    const endpoint = createApiDemoWebhookRegistry(fromVault).get(
      'demo.purchase-approved',
      1,
    );

    await expect(endpoint?.buildRequest({} as never)).resolves.toMatchObject({
      signingSecret: 'from-vault',
    });
  });

  it('verifies the signature over timestamp and body', () => {
    const body = { deliveryId: 'd-1' };
    const headers = signedHeaders(body, 'd-1');

    expect(
      isApiDemoWebhookSignatureValid({
        body: JSON.stringify(body),
        secret: API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET,
        signature: headers['x-bpm-signature-sha256'],
        timestamp: headers['x-bpm-timestamp'],
      }),
    ).toBe(true);
    expect(
      isApiDemoWebhookSignatureValid({
        body: JSON.stringify({ deliveryId: 'tampered' }),
        secret: API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET,
        signature: headers['x-bpm-signature-sha256'],
        timestamp: headers['x-bpm-timestamp'],
      }),
    ).toBe(false);
  });

  it('answers the flaky mode with 503 twice, then 200, per delivery id', async () => {
    const store = new ApiDemoWebhookSinkStore();
    const controller = createController(store);
    const statuses = [
      await send(controller, 'flaky', 'd-flaky'),
      await send(controller, 'flaky', 'd-flaky'),
      await send(controller, 'flaky', 'd-flaky'),
    ];

    expect(statuses).toEqual([503, 503, 200]);
    expect(store.list()[0]?.receipts.map((receipt) => receipt.attempt)).toEqual(
      [1, 2, 3],
    );
  });

  it('switches a mode to a simulated failure and back', async () => {
    const store = new ApiDemoWebhookSinkStore();
    const controller = createController(store);

    expect(controller.setMode('switchable', { status: 400 })).toEqual({
      delayMs: 0,
      status: 400,
    });
    expect(await send(controller, 'switchable', 'd-switch')).toBe(400);

    controller.setMode('switchable', {});
    expect(await send(controller, 'switchable', 'd-switch')).toBe(200);
    expect(
      store.list()[0]?.receipts.map((receipt) => receipt.respondedWith),
    ).toEqual([400, 200]);

    controller.setMode('switchable', { status: 503 });
    controller.clearDeliveries();
    expect(controller.listModes()['switchable']).toEqual({
      delayMs: 0,
      status: null,
    });
  });

  it('lets one request ask for a status without changing the mode', async () => {
    const controller = createController();

    expect(await send(controller, 'ok', 'd-query', { status: '503' })).toBe(
      503,
    );
    expect(await send(controller, 'ok', 'd-query-2')).toBe(200);
  });

  it('ignores a status that is not an HTTP status and clamps the delay', () => {
    expect(
      readApiDemoWebhookBehavior({ delayMs: '999999', status: '42' }),
    ).toEqual({ delayMs: API_DEMO_WEBHOOK_MAX_DELAY_MS, status: null });
    expect(readApiDemoWebhookBehavior({ delayMs: -5, status: 'abc' })).toEqual({
      delayMs: 0,
      status: null,
    });
  });

  it('rejects an unsigned request with 401 even when a status is simulated', async () => {
    const controller = createController();
    const response = fakeResponse();

    controller.setMode('switchable', { status: 200 });
    await controller.receive(
      'switchable',
      { a: 1 },
      { 'x-bpm-delivery-id': 'd' },
      response,
      {},
    );

    expect(response.statusCode).toBe(401);
  });

  it('answers an unsigned request at once, without its delay or a receipt', async () => {
    const store = new ApiDemoWebhookSinkStore();
    const controller = createController(store);
    const response = fakeResponse();
    const startedAt = Date.now();

    await controller.receive(
      'ok',
      { a: 1 },
      { 'x-bpm-delivery-id': 'd-unsigned' },
      response,
      { delayMs: '5000' },
    );

    expect(response.statusCode).toBe(401);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(store.list()).toEqual([]);
  });

  it('forgets the oldest deliveries beyond the cap', () => {
    const store = new ApiDemoWebhookSinkStore();
    const receipt = {
      headers: {},
      mode: 'ok' as const,
      receivedAt: 'now',
      respondedWith: 200,
      signatureValid: true,
    };

    Array.from({ length: API_DEMO_WEBHOOK_MAX_STORED_DELIVERIES + 1 }, (_, i) =>
      store.record(`d-${i}`, {}, receipt),
    );

    expect(store.list()).toHaveLength(API_DEMO_WEBHOOK_MAX_STORED_DELIVERIES);
    expect(store.list()[0]?.deliveryId).toBe('d-1');
  });
});
