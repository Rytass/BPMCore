import { randomBytes } from 'node:crypto';
import type {
  BPMWorkflowWebhookEndpoint,
  BPMWorkflowWebhookRequest,
} from '@rytass/bpm-core-nestjs-module';

/**
 * Staging showcase for NOTIFY webhooks (ADR 18): a code-registered endpoint
 * whose receiver lives in this API and pushes each delivery to the signed-in
 * browsers over Server-Sent Events, where the client host shows it as a
 * top-right notification.
 *
 * Wrapper-host demo only — nothing here belongs in `@rytass/bpm-core-*`. The
 * sender (BPM's delivery service) and the receiver are the same process, so
 * the signing secret is a random per-process value nobody has to configure,
 * and the endpoint calls the receiver on `localhost`. Registry endpoints are
 * not held to `workflowWebhookAllowedUrlPatterns` unless the host opts in, so
 * the loopback URL is accepted.
 *
 * The hub is in memory: every browser connected to *this* process sees every
 * delivery. Staging runs one replica; with more, a browser would only see the
 * deliveries its own replica received.
 */

export const API_SHOWCASE_WEBHOOK_ENABLED_KEY = 'API_SHOWCASE_WEBHOOK_ENABLED';

export const API_SHOWCASE_WEBHOOK_ENDPOINT_KEY = 'showcase.toast';

export const API_SHOWCASE_WEBHOOK_ROUTE = 'showcase/webhook-notifications';

/** A signature older (or newer) than this is refused as a replay. */
export const API_SHOWCASE_WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 300;

/** Delivery ids remembered for de-duplication; the oldest go first. */
export const API_SHOWCASE_WEBHOOK_MAX_REMEMBERED_DELIVERIES = 500;

/** Longest `message` parameter shown in a notification. */
export const API_SHOWCASE_WEBHOOK_MAX_MESSAGE_LENGTH = 200;

/**
 * On outside production (local development); under `NODE_ENV=production` —
 * staging included — only when `API_SHOWCASE_WEBHOOK_ENABLED=true`.
 */
export function isApiShowcaseWebhookEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.NODE_ENV !== 'production' ||
    env[API_SHOWCASE_WEBHOOK_ENABLED_KEY] === 'true'
  );
}

/** What the browser receives for one delivery. */
export interface ApiShowcaseNotification {
  readonly deliveryId: string;
  readonly description: string;
  readonly instanceId: string;
  readonly occurredAt: string;
  readonly title: string;
}

export type ApiShowcaseNotificationListener = (
  notification: ApiShowcaseNotification,
) => void;

/**
 * Holds the signing secret the endpoint and the receiver share, and fans each
 * accepted delivery out to the open SSE streams.
 */
export class ApiShowcaseWebhookHub {
  readonly signingSecret: string;

  private readonly listeners = new Set<ApiShowcaseNotificationListener>();

  private readonly seenDeliveryIds = new Set<string>();

  constructor(signingSecret: string = randomBytes(32).toString('hex')) {
    this.signingSecret = signingSecret;
  }

  /** Returns the unsubscribe function. */
  subscribe(listener: ApiShowcaseNotificationListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Publishes once per delivery id: BPM retries a delivery under the same id
   * (and a receiver that answered 200 too late may see it again), and the
   * browser should show it only once. Returns whether it was published.
   */
  publish(notification: ApiShowcaseNotification): boolean {
    if (this.seenDeliveryIds.has(notification.deliveryId)) {
      return false;
    }

    this.seenDeliveryIds.add(notification.deliveryId);

    if (
      this.seenDeliveryIds.size > API_SHOWCASE_WEBHOOK_MAX_REMEMBERED_DELIVERIES
    ) {
      const [oldest] = this.seenDeliveryIds;

      this.seenDeliveryIds.delete(oldest);
    }

    [...this.listeners].forEach((listener): void => {
      try {
        listener(notification);
      } catch {
        // A stream that cannot be written to is dropped by its own `close`
        // handler; it must not keep the others from receiving this one.
      }
    });

    return true;
  }
}

/** Whether `x-bpm-timestamp` (Unix seconds) is close enough to `now`. */
export function isApiShowcaseTimestampFresh(
  timestamp: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!timestamp || !/^\d+$/u.test(timestamp)) {
    return false;
  }

  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));

  return skew <= API_SHOWCASE_WEBHOOK_MAX_CLOCK_SKEW_SECONDS;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Turns a verified NOTIFY event into the notification text. `null` when the
 * body is not a `workflow.notify` event for the showcase endpoint.
 */
export function readApiShowcaseNotification(
  body: unknown,
  deliveryId: string,
): ApiShowcaseNotification | null {
  const event = readRecord(body);
  const endpoint = readRecord(event?.endpoint);
  const instance = readRecord(event?.instance);
  const node = readRecord(event?.node);
  const parameters = readRecord(event?.parameters) ?? {};

  if (
    event?.eventType !== 'workflow.notify' ||
    endpoint?.key !== API_SHOWCASE_WEBHOOK_ENDPOINT_KEY ||
    event.deliveryId !== deliveryId
  ) {
    return null;
  }

  const instanceId = readText(instance?.id);

  if (!instanceId) {
    return null;
  }

  const caseTitle = readText(instance?.title) ?? '（未命名案件）';
  const nodeLabel = readText(node?.label) ?? '知會節點';
  const message = readText(parameters.message)?.slice(
    0,
    API_SHOWCASE_WEBHOOK_MAX_MESSAGE_LENGTH,
  );

  return {
    deliveryId,
    description: message
      ? `${message}（案件「${caseTitle}」）`
      : `案件「${caseTitle}」已抵達「${nodeLabel}」。`,
    instanceId,
    occurredAt: readText(event.occurredAt) ?? new Date().toISOString(),
    title: `外部系統通知：${nodeLabel}`,
  };
}

function readApiOrigin(): string {
  return `http://localhost:${process.env.PORT ?? 17603}`;
}

/** The showcase endpoint, or nothing when the showcase is off. */
export function createApiShowcaseWebhookEndpoints(
  hub: ApiShowcaseWebhookHub,
  enabled: boolean = isApiShowcaseWebhookEnabled(),
): readonly BPMWorkflowWebhookEndpoint[] {
  if (!enabled) {
    return [];
  }

  return [
    {
      buildRequest: async (): Promise<BPMWorkflowWebhookRequest> => ({
        signingSecret: hub.signingSecret,
        url: `${readApiOrigin()}/${API_SHOWCASE_WEBHOOK_ROUTE}/deliveries`,
      }),
      descriptor: {
        description:
          '展示用：送達後，所有已登入的瀏覽器右上角會跳出通知（apps/api 內建接收端）',
        key: API_SHOWCASE_WEBHOOK_ENDPOINT_KEY,
        label: '展示：右上角通知',
        parameters: [
          {
            description: '通知內文；未綁定時顯示案件與節點名稱',
            key: 'message',
            label: '通知內文',
            required: false,
            type: 'string',
          },
        ],
        version: 1,
      },
    },
  ];
}
