import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BPMWorkflowWebhookEndpoint,
  BPMWorkflowWebhookRegistry,
} from '@rytass/bpm-core-nestjs-module';

/**
 * Demo NOTIFY webhook endpoints and the in-process receiver they call
 * (ADR 18, wrapper-host verification).
 *
 * Wrapper-app simulation only, like the test members: never registered under
 * `NODE_ENV=production`. The three modes exist to exercise delivery end to
 * end — a receiver that answers, one that fails twice before answering, and
 * one slower than BPM's request timeout.
 */

export type ApiDemoWebhookMode = 'flaky' | 'ok' | 'slow';

/** The receiver fails this many attempts per delivery before answering 200. */
export const API_DEMO_WEBHOOK_FLAKY_FAILURES = 2;

/** Longer than BPM's default 10 s request timeout. */
export const API_DEMO_WEBHOOK_SLOW_DELAY_MS = 15_000;

export interface ApiDemoWebhookReceipt {
  readonly attempt: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly mode: ApiDemoWebhookMode;
  readonly receivedAt: string;
  readonly respondedWith: number;
  readonly signatureValid: boolean;
}

export interface ApiDemoWebhookDeliveryRecord {
  readonly deliveryId: string;
  readonly event: unknown;
  readonly receipts: readonly ApiDemoWebhookReceipt[];
}

export function isApiDemoWebhooksEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function readApiDemoWebhookSigningSecret(): string {
  return (
    process.env.BPM_DEMO_WEBHOOK_SIGNING_SECRET ??
    'bpm-demo-webhook-signing-secret'
  );
}

function readApiBaseUrl(): string {
  return `http://localhost:${process.env.PORT ?? 17603}`;
}

/**
 * Verifies `x-bpm-signature-sha256 = HMAC-SHA256(secret, "<timestamp>.<body>")`
 * the way a real receiver would, in constant time.
 */
export function isApiDemoWebhookSignatureValid({
  body,
  secret,
  signature,
  timestamp,
}: {
  readonly body: string;
  readonly secret: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
}): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'),
  );
  const received = Buffer.from(signature);

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function createEndpoint(
  key: string,
  label: string,
  mode: ApiDemoWebhookMode,
  parameters: BPMWorkflowWebhookEndpoint['descriptor']['parameters'],
): BPMWorkflowWebhookEndpoint {
  return {
    // Called once per attempt, which is where a real host would read its
    // current credentials.
    buildRequest: async () => ({
      signingSecret: readApiDemoWebhookSigningSecret(),
      url: `${readApiBaseUrl()}/demo/webhook-sink/${mode}`,
    }),
    descriptor: {
      description: `Demo receiver in apps/api (${mode})`,
      key,
      label,
      parameters,
      version: 1,
    },
  };
}

export function createApiDemoWebhookRegistry(): BPMWorkflowWebhookRegistry {
  const endpoints: readonly BPMWorkflowWebhookEndpoint[] =
    isApiDemoWebhooksEnabled()
      ? [
          createEndpoint(
            'demo.purchase-approved',
            '示範：採購核准通知 ERP',
            'ok',
            [
              { key: 'amount', label: '金額', required: true, type: 'number' },
              {
                key: 'caseTitle',
                label: '案件標題',
                required: false,
                type: 'string',
              },
            ],
          ),
          createEndpoint('demo.flaky', '示範：先失敗兩次的接收端', 'flaky', [
            {
              key: 'caseId',
              label: '案件編號',
              required: false,
              type: 'string',
            },
          ]),
          createEndpoint('demo.slow', '示範：超過逾時的接收端', 'slow', []),
        ]
      : [];

  // A literal registry rather than the library's Static one, so this file
  // only needs the library's types.
  return {
    get: (key: string, version: number): BPMWorkflowWebhookEndpoint | null =>
      endpoints.find(
        (endpoint) =>
          endpoint.descriptor.key === key &&
          endpoint.descriptor.version === version,
      ) ?? null,
    list: (): readonly BPMWorkflowWebhookEndpoint[] => endpoints,
  };
}

/** Receipts per delivery id, kept in memory for the life of the process. */
export class ApiDemoWebhookSinkStore {
  private readonly deliveries = new Map<string, ApiDemoWebhookDeliveryRecord>();

  record(
    deliveryId: string,
    event: unknown,
    receipt: Omit<ApiDemoWebhookReceipt, 'attempt'>,
  ): ApiDemoWebhookReceipt {
    const existing = this.deliveries.get(deliveryId);
    const stored: ApiDemoWebhookReceipt = {
      ...receipt,
      attempt: (existing?.receipts.length ?? 0) + 1,
    };

    this.deliveries.set(deliveryId, {
      deliveryId,
      event,
      receipts: [...(existing?.receipts ?? []), stored],
    });

    return stored;
  }

  countAttempts(deliveryId: string): number {
    return this.deliveries.get(deliveryId)?.receipts.length ?? 0;
  }

  list(): readonly ApiDemoWebhookDeliveryRecord[] {
    return [...this.deliveries.values()];
  }

  clear(): void {
    this.deliveries.clear();
  }
}
