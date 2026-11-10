import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { ApiSessionService } from './api-session.service';
import {
  API_SHOWCASE_WEBHOOK_ENDPOINT_KEY,
  API_SHOWCASE_WEBHOOK_MAX_REMEMBERED_DELIVERIES,
  ApiShowcaseNotification,
  ApiShowcaseWebhookHub,
  createApiShowcaseWebhookEndpoints,
  isApiShowcaseTimestampFresh,
  isApiShowcaseWebhookEnabled,
  readApiShowcaseNotification,
} from './api-showcase-webhook';
import {
  ApiShowcaseWebhookController,
  formatServerSentEvent,
} from './api-showcase-webhook.controller';

const SECRET = 'showcase-test-secret';

function event(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    attempt: 1,
    deliveryId: 'delivery-1',
    endpoint: { key: API_SHOWCASE_WEBHOOK_ENDPOINT_KEY, version: 1 },
    eventType: 'workflow.notify',
    initiator: { memberId: 'member-102' },
    instance: {
      id: 'instance-1',
      templateId: 'template-1',
      templateVersionId: 'version-1',
      title: '採購申請 #12',
    },
    node: { id: 'notify-1', label: '通知財務' },
    occurredAt: '2026-11-10T08:00:00.000Z',
    parameters: {},
    ...overrides,
  };
}

function signedHeaders(
  body: object,
  {
    deliveryId = 'delivery-1',
    secret = SECRET,
    timestamp = String(Math.floor(Date.now() / 1000)),
  }: {
    readonly deliveryId?: string;
    readonly secret?: string;
    readonly timestamp?: string;
  } = {},
): Record<string, string> {
  return {
    'x-bpm-delivery-id': deliveryId,
    'x-bpm-signature-sha256': createHmac('sha256', secret)
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest('hex'),
    'x-bpm-timestamp': timestamp,
  };
}

function statusResponse(): Response & { statusCode: number } {
  const response = { statusCode: 200 } as Response & { statusCode: number };

  response.status = ((code: number) => {
    response.statusCode = code;

    return response;
  }) as Response['status'];

  return response;
}

function sessionService(signedIn: boolean): ApiSessionService {
  return {
    readAuthenticatedMemberFromRequest: jest
      .fn()
      .mockResolvedValue(signedIn ? { memberId: 'member-001' } : null),
  } as unknown as ApiSessionService;
}

describe('isApiShowcaseWebhookEnabled', () => {
  it('is on outside production and opt-in under production', (): void => {
    expect(isApiShowcaseWebhookEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isApiShowcaseWebhookEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      isApiShowcaseWebhookEnabled({
        API_SHOWCASE_WEBHOOK_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toBe(true);
    expect(
      isApiShowcaseWebhookEnabled({
        API_SHOWCASE_WEBHOOK_ENABLED: '1',
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });
});

describe('createApiShowcaseWebhookEndpoints', () => {
  it('registers nothing when the showcase is off', (): void => {
    expect(
      createApiShowcaseWebhookEndpoints(new ApiShowcaseWebhookHub(), false),
    ).toEqual([]);
  });

  it('points the endpoint at the in-process receiver with the hub secret', async (): Promise<void> => {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const [endpoint] = createApiShowcaseWebhookEndpoints(hub, true);
    const request = await endpoint.buildRequest(event() as never);

    expect(endpoint.descriptor).toMatchObject({
      key: API_SHOWCASE_WEBHOOK_ENDPOINT_KEY,
      version: 1,
    });
    expect(request.signingSecret).toBe(SECRET);
    expect(request.url).toMatch(
      /^http:\/\/localhost:\d+\/showcase\/webhook-notifications\/deliveries$/u,
    );
  });

  it('gives each process its own random secret', (): void => {
    expect(new ApiShowcaseWebhookHub().signingSecret).not.toBe(
      new ApiShowcaseWebhookHub().signingSecret,
    );
    expect(new ApiShowcaseWebhookHub().signingSecret).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });
});

describe('isApiShowcaseTimestampFresh', () => {
  const now = new Date('2026-11-10T08:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);

  it('accepts a timestamp within five minutes either way', (): void => {
    expect(isApiShowcaseTimestampFresh(String(nowSeconds - 300), now)).toBe(
      true,
    );
    expect(isApiShowcaseTimestampFresh(String(nowSeconds + 300), now)).toBe(
      true,
    );
  });

  it('refuses an old, future, missing or malformed timestamp', (): void => {
    expect(isApiShowcaseTimestampFresh(String(nowSeconds - 301), now)).toBe(
      false,
    );
    expect(isApiShowcaseTimestampFresh(String(nowSeconds + 301), now)).toBe(
      false,
    );
    expect(isApiShowcaseTimestampFresh(undefined, now)).toBe(false);
    expect(isApiShowcaseTimestampFresh('12.5', now)).toBe(false);
  });
});

describe('readApiShowcaseNotification', () => {
  it('describes the case and node when no message is bound', (): void => {
    expect(readApiShowcaseNotification(event(), 'delivery-1')).toEqual({
      deliveryId: 'delivery-1',
      description: '案件「採購申請 #12」已抵達「通知財務」。',
      instanceId: 'instance-1',
      occurredAt: '2026-11-10T08:00:00.000Z',
      title: '外部系統通知：通知財務',
    });
  });

  it('shows the bound message, cut to 200 characters', (): void => {
    const notification = readApiShowcaseNotification(
      event({ parameters: { message: `  ${'款'.repeat(250)}  ` } }),
      'delivery-1',
    );

    expect(notification?.description).toBe(
      `${'款'.repeat(200)}（案件「採購申請 #12」）`,
    );
  });

  it('refuses another endpoint, event type or delivery id', (): void => {
    expect(
      readApiShowcaseNotification(
        event({ endpoint: { key: 'demo.ok', version: 1 } }),
        'delivery-1',
      ),
    ).toBeNull();
    expect(
      readApiShowcaseNotification(event({ eventType: 'other' }), 'delivery-1'),
    ).toBeNull();
    expect(readApiShowcaseNotification(event(), 'delivery-2')).toBeNull();
    expect(
      readApiShowcaseNotification('not an event', 'delivery-1'),
    ).toBeNull();
    expect(
      readApiShowcaseNotification(event({ instance: {} }), 'delivery-1'),
    ).toBeNull();
  });
});

describe('ApiShowcaseWebhookHub', () => {
  const notification = (deliveryId: string): ApiShowcaseNotification => ({
    deliveryId,
    description: 'd',
    instanceId: 'i',
    occurredAt: 'o',
    title: 't',
  });

  it('publishes a delivery once to every subscriber', (): void => {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const first = jest.fn();
    const second = jest.fn();

    hub.subscribe(first);
    hub.subscribe(second);

    expect(hub.publish(notification('a'))).toBe(true);
    expect(hub.publish(notification('a'))).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', (): void => {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const listener = jest.fn();
    const unsubscribe = hub.subscribe(listener);

    unsubscribe();
    hub.publish(notification('a'));

    expect(listener).not.toHaveBeenCalled();
    expect(hub.subscriberCount()).toBe(0);
  });

  it('keeps delivering to the others when one subscriber throws', (): void => {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const listener = jest.fn();

    hub.subscribe((): void => {
      throw new Error('stream closed');
    });
    hub.subscribe(listener);
    hub.publish(notification('a'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets the oldest delivery ids beyond its bound', (): void => {
    const hub = new ApiShowcaseWebhookHub(SECRET);

    Array.from(
      { length: API_SHOWCASE_WEBHOOK_MAX_REMEMBERED_DELIVERIES + 1 },
      (_value, index) => notification(`d-${index}`),
    ).forEach((item): void => {
      hub.publish(item);
    });

    expect(hub.publish(notification('d-0'))).toBe(true);
    expect(
      hub.publish(
        notification(`d-${API_SHOWCASE_WEBHOOK_MAX_REMEMBERED_DELIVERIES}`),
      ),
    ).toBe(false);
  });
});

describe('ApiShowcaseWebhookController.receive', () => {
  function setup(): {
    readonly controller: ApiShowcaseWebhookController;
    readonly published: ApiShowcaseNotification[];
  } {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const published: ApiShowcaseNotification[] = [];

    hub.subscribe((notification): void => {
      published.push(notification);
    });

    return {
      controller: new ApiShowcaseWebhookController(hub, sessionService(true)),
      published,
    };
  }

  it('publishes a correctly signed showcase event', (): void => {
    const { controller, published } = setup();
    const body = event();
    const response = statusResponse();

    expect(controller.receive(body, signedHeaders(body), response)).toEqual({
      ok: true,
    });
    expect(response.statusCode).toBe(200);
    expect(published.map((item) => item.deliveryId)).toEqual(['delivery-1']);
  });

  it('answers 401 for a wrong secret or a stale timestamp', (): void => {
    const { controller, published } = setup();
    const body = event();
    const wrongSecret = statusResponse();
    const stale = statusResponse();

    controller.receive(
      body,
      signedHeaders(body, { secret: 'someone-else' }),
      wrongSecret,
    );
    controller.receive(
      body,
      signedHeaders(body, {
        timestamp: String(Math.floor(Date.now() / 1000) - 3600),
      }),
      stale,
    );

    expect(wrongSecret.statusCode).toBe(401);
    expect(stale.statusCode).toBe(401);
    expect(published).toEqual([]);
  });

  it('answers 400 for a signed event that is not the showcase one', (): void => {
    const { controller, published } = setup();
    const body = event({ endpoint: { key: 'demo.ok', version: 1 } });
    const response = statusResponse();

    controller.receive(body, signedHeaders(body), response);

    expect(response.statusCode).toBe(400);
    expect(published).toEqual([]);
  });
});

describe('ApiShowcaseWebhookController.stream', () => {
  interface FakeStreamResponse {
    readonly headers: Record<string, string>;
    readonly response: Response;
    readonly statusCode: () => number;
    readonly writes: string[];
  }

  function fakeStreamResponse(): FakeStreamResponse {
    const headers: Record<string, string> = {};
    const writes: string[] = [];
    let statusCode = 200;
    const response = {
      flushHeaders: jest.fn(),
      json: jest.fn(),
      setHeader: (name: string, value: string): void => {
        headers[name] = value;
      },
      write: (chunk: string): boolean => {
        writes.push(chunk);

        return true;
      },
    } as unknown as Response;

    (response as unknown as { status: (code: number) => Response }).status = (
      code: number,
    ): Response => {
      statusCode = code;

      return response;
    };

    return { headers, response, statusCode: () => statusCode, writes };
  }

  it('refuses a request without a session', async (): Promise<void> => {
    const hub = new ApiShowcaseWebhookHub(SECRET);
    const controller = new ApiShowcaseWebhookController(
      hub,
      sessionService(false),
    );
    const fake = fakeStreamResponse();

    await controller.stream(
      new EventEmitter() as unknown as Request,
      fake.response,
    );

    expect(fake.statusCode()).toBe(401);
    expect(hub.subscriberCount()).toBe(0);
  });

  it('streams published notifications until the browser disconnects', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const hub = new ApiShowcaseWebhookHub(SECRET);
      const controller = new ApiShowcaseWebhookController(
        hub,
        sessionService(true),
      );
      const request = new EventEmitter();
      const fake = fakeStreamResponse();
      const notification = readApiShowcaseNotification(event(), 'delivery-1');

      await controller.stream(request as unknown as Request, fake.response);
      hub.publish(notification as ApiShowcaseNotification);
      jest.advanceTimersByTime(25_000);

      expect(fake.headers['Content-Type']).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(fake.writes).toEqual([
        'retry: 5000\n\n',
        formatServerSentEvent(notification as ApiShowcaseNotification),
        ': heartbeat\n\n',
      ]);

      request.emit('close');

      expect(hub.subscriberCount()).toBe(0);
      jest.advanceTimersByTime(25_000);
      expect(fake.writes).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('formats one named event per delivery', (): void => {
    const notification = readApiShowcaseNotification(
      event(),
      'delivery-1',
    ) as ApiShowcaseNotification;

    expect(formatServerSentEvent(notification)).toBe(
      `id: delivery-1\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`,
    );
  });
});
