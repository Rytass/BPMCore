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

export type ApiDemoWebhookMode = 'flaky' | 'ok' | 'slow' | 'switchable';

export const API_DEMO_WEBHOOK_MODES: readonly ApiDemoWebhookMode[] = [
  'flaky',
  'ok',
  'slow',
  'switchable',
];

/** Deliveries the receiver remembers; the oldest are forgotten first. */
export const API_DEMO_WEBHOOK_MAX_STORED_DELIVERIES = 500;

/** Upper bound for a simulated delay, so a typo cannot hang a request. */
export const API_DEMO_WEBHOOK_MAX_DELAY_MS = 60_000;

/**
 * A simulated response for one mode, set through the receiver's control
 * endpoint or a query parameter: `status` overrides the mode's own answer,
 * `delayMs` holds the response back first.
 */
export interface ApiDemoWebhookBehavior {
  readonly delayMs: number;
  readonly status: number | null;
}

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

export const API_DEMO_WEBHOOK_SIGNING_SECRET_KEY =
  'BPM_DEMO_WEBHOOK_SIGNING_SECRET';

/** Only ever used outside production, where the demo is registered at all. */
export const API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET =
  'bpm-demo-webhook-signing-secret';

/**
 * Where the demo reads its signing secret: the selected Vault path first,
 * then the process environment (Kubernetes `vault-secret`), then the local
 * default. Read per call, as a real host would, so a rotated value applies
 * without a restart. The endpoints and the receiver share one instance.
 */
export class ApiDemoWebhookSigningSecret {
  constructor(
    private readonly readVaultValue: (key: string) => Promise<unknown>,
  ) {}

  async read(): Promise<string> {
    const vaultValue = await this.readVaultValue(
      API_DEMO_WEBHOOK_SIGNING_SECRET_KEY,
    ).catch((): unknown => null);

    if (typeof vaultValue === 'string' && vaultValue) {
      return vaultValue;
    }

    return (
      process.env[API_DEMO_WEBHOOK_SIGNING_SECRET_KEY] ||
      API_DEMO_WEBHOOK_DEFAULT_SIGNING_SECRET
    );
  }
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
  secret: ApiDemoWebhookSigningSecret,
  key: string,
  label: string,
  mode: ApiDemoWebhookMode,
  parameters: BPMWorkflowWebhookEndpoint['descriptor']['parameters'],
): BPMWorkflowWebhookEndpoint {
  return {
    // Called once per attempt, which is where a real host would read its
    // current credentials.
    buildRequest: async () => ({
      signingSecret: await secret.read(),
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

export function createApiDemoWebhookRegistry(
  secret: ApiDemoWebhookSigningSecret,
): BPMWorkflowWebhookRegistry {
  const endpoints: readonly BPMWorkflowWebhookEndpoint[] =
    isApiDemoWebhooksEnabled()
      ? [
          createEndpoint(
            secret,
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
          createEndpoint(
            secret,
            'demo.leave-submitted',
            '示範：請假申請同步人資系統',
            'ok',
            [
              {
                description: '假別代碼，例如 annual、sick',
                key: 'leaveType',
                label: '假別',
                required: true,
                type: 'string',
              },
              {
                key: 'startDate',
                label: '開始日期',
                required: true,
                type: 'string',
              },
              {
                key: 'endDate',
                label: '結束日期',
                required: true,
                type: 'string',
              },
              {
                key: 'applicantId',
                label: '申請人',
                required: false,
                type: 'string',
              },
            ],
          ),
          createEndpoint(
            secret,
            'demo.flaky',
            '示範：先失敗兩次的接收端',
            'flaky',
            [
              {
                key: 'caseId',
                label: '案件編號',
                required: false,
                type: 'string',
              },
            ],
          ),
          createEndpoint(
            secret,
            'demo.slow',
            '示範：超過逾時的接收端',
            'slow',
            [],
          ),
          createEndpoint(
            secret,
            'demo.switchable',
            '示範：可切換回應的接收端',
            'switchable',
            [
              {
                key: 'caseId',
                label: '案件編號',
                required: false,
                type: 'string',
              },
            ],
          ),
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

/**
 * Receipts per delivery id and simulated behaviors per mode, kept in memory
 * for the life of the process.
 */
export class ApiDemoWebhookSinkStore {
  private readonly deliveries = new Map<string, ApiDemoWebhookDeliveryRecord>();

  private readonly behaviors = new Map<
    ApiDemoWebhookMode,
    ApiDemoWebhookBehavior
  >();

  readBehavior(mode: ApiDemoWebhookMode): ApiDemoWebhookBehavior {
    return this.behaviors.get(mode) ?? { delayMs: 0, status: null };
  }

  setBehavior(
    mode: ApiDemoWebhookMode,
    behavior: ApiDemoWebhookBehavior,
  ): void {
    this.behaviors.set(mode, behavior);
  }

  listBehaviors(): Readonly<Record<string, ApiDemoWebhookBehavior>> {
    return Object.fromEntries(
      API_DEMO_WEBHOOK_MODES.map((mode) => [mode, this.readBehavior(mode)]),
    );
  }

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

    this.deliveries.delete(deliveryId);
    this.deliveries.set(deliveryId, {
      deliveryId,
      event,
      receipts: [...(existing?.receipts ?? []), stored],
    });

    // Map keeps insertion order, so the first key is the least recently
    // received delivery.
    const oldest = this.deliveries.keys().next().value;

    if (
      this.deliveries.size > API_DEMO_WEBHOOK_MAX_STORED_DELIVERIES &&
      oldest !== undefined
    ) {
      this.deliveries.delete(oldest);
    }

    return stored;
  }

  countAttempts(deliveryId: string): number {
    return this.deliveries.get(deliveryId)?.receipts.length ?? 0;
  }

  list(): readonly ApiDemoWebhookDeliveryRecord[] {
    return [...this.deliveries.values()];
  }

  /** Forgets receipts and simulated behaviors alike. */
  clear(): void {
    this.deliveries.clear();
    this.behaviors.clear();
  }
}

/**
 * Reads a simulated status or delay from untrusted input (a query parameter
 * or a control request): a status must be a real HTTP status, a delay is
 * clamped to {@link API_DEMO_WEBHOOK_MAX_DELAY_MS}.
 */
export function readApiDemoWebhookBehavior(input: {
  readonly delayMs?: unknown;
  readonly status?: unknown;
}): ApiDemoWebhookBehavior {
  const status = Number(input.status);
  const delayMs = Number(input.delayMs);

  return {
    delayMs:
      Number.isFinite(delayMs) && delayMs > 0
        ? Math.min(Math.round(delayMs), API_DEMO_WEBHOOK_MAX_DELAY_MS)
        : 0,
    status:
      Number.isInteger(status) && status >= 200 && status <= 599
        ? status
        : null,
  };
}
