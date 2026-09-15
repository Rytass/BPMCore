import { InjectionToken } from '@nestjs/common';
import {
  ParsedWorkflowWebhookUrlPattern,
  parseWorkflowWebhookUrlPatterns,
} from './workflow-webhook-allowlist';
import { BPMWorkflowWebhookEndpointSourceKind } from './workflow-webhook.types';

/**
 * Flattened webhook settings on `BPMRootModule`, alongside the notification
 * ones (ADR 18 §3.13).
 */
export interface BPMRootWorkflowWebhookOptions {
  /**
   * Where NOTIFY webhook endpoints may come from. Defaults to `['REGISTRY']`,
   * so an existing host keeps exactly the endpoints its code registers.
   *
   * `DATABASE` additionally needs a non-empty
   * {@link BPMRootWorkflowWebhookOptions.workflowWebhookAllowedUrlPatterns}
   * and a {@link BPMRootWorkflowWebhookOptions.workflowWebhookSecretEncryptionKey};
   * without them the source stays off rather than running unguarded.
   */
  readonly workflowWebhookTargetSources?: readonly BPMWorkflowWebhookEndpointSourceKind[];

  /**
   * URLs webhook endpoints may call, as patterns (`https://*.example.com/hooks/*`).
   *
   * An invalid pattern fails the application at boot. An empty list is not
   * "allow everything": it means the `DATABASE` source cannot be enabled.
   */
  readonly workflowWebhookAllowedUrlPatterns?: readonly string[];

  /**
   * Also check `REGISTRY` endpoints against the allowlist. Off by default,
   * because those URLs come from host code rather than from a form.
   */
  readonly workflowWebhookEnforceAllowlistForRegistry?: boolean;

  /**
   * Key used to encrypt header values and signing secrets of
   * database-managed endpoints (P6). Expected to come from the host's secret
   * store; 32 bytes, hex or base64.
   */
  readonly workflowWebhookSecretEncryptionKey?: string;

  /**
   * Runs the background scan that retries and releases queued deliveries.
   * Omitted: on whenever at least one endpoint is registered, because without
   * it a failed delivery would never be retried. Always off under
   * `NODE_ENV=test`.
   */
  readonly workflowWebhookDeliverySchedulerEnabled?: boolean;

  /** How often the scheduler scans for due deliveries. Default 15 000 ms. */
  readonly workflowWebhookDeliveryScanIntervalMs?: number;

  /** Deliveries claimed per scan. Default 25. */
  readonly workflowWebhookDeliveryBatchSize?: number;

  /** Attempts before a retryable failure becomes `FAILED`. Default 6. */
  readonly workflowWebhookDeliveryMaxAttempts?: number;

  /**
   * First retry delay; each further attempt doubles it, with ±20 % jitter.
   * Default 30 000 ms.
   */
  readonly workflowWebhookDeliveryRetryBaseDelayMs?: number;

  /** Ceiling for a single retry delay. Default 3 600 000 ms (1 hour). */
  readonly workflowWebhookDeliveryMaxRetryDelayMs?: number;

  /**
   * Request timeout when the endpoint does not set one. Default 10 000 ms.
   * An endpoint's own `timeoutMs` is capped at
   * {@link WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS}.
   */
  readonly workflowWebhookDeliveryDefaultTimeoutMs?: number;
}

/** No single request may hold a delivery longer than this (ADR 18 §3.6). */
export const WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS = 30_000;

export interface BPMResolvedWorkflowWebhookDeliveryOptions {
  readonly batchSize: number;
  readonly defaultTimeoutMs: number;
  readonly maxAttempts: number;
  readonly maxRetryDelayMs: number;
  readonly retryBaseDelayMs: number;
  readonly scanIntervalMs: number;
  /** `null` means "decide from the catalog at boot". */
  readonly schedulerEnabled: boolean | null;
}

export interface BPMResolvedWorkflowWebhookOptions {
  readonly allowedUrlPatterns: readonly ParsedWorkflowWebhookUrlPattern[];
  readonly delivery: BPMResolvedWorkflowWebhookDeliveryOptions;
  readonly enforceAllowlistForRegistry: boolean;
  readonly secretEncryptionKey: string | null;
  readonly targetSources: readonly BPMWorkflowWebhookEndpointSourceKind[];
}

export const BPM_WORKFLOW_WEBHOOK_OPTIONS: InjectionToken<BPMResolvedWorkflowWebhookOptions> =
  Symbol('BPM_WORKFLOW_WEBHOOK_OPTIONS');

export const DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS: BPMResolvedWorkflowWebhookOptions =
  {
    allowedUrlPatterns: [],
    delivery: {
      batchSize: 25,
      defaultTimeoutMs: 10_000,
      maxAttempts: 6,
      maxRetryDelayMs: 3_600_000,
      retryBaseDelayMs: 30_000,
      scanIntervalMs: 15_000,
      schedulerEnabled: null,
    },
    enforceAllowlistForRegistry: false,
    secretEncryptionKey: null,
    targetSources: ['REGISTRY'],
  };

export function resolveBPMWorkflowWebhookOptions(
  options: BPMRootWorkflowWebhookOptions = {},
): BPMResolvedWorkflowWebhookOptions {
  const { errors, patterns } = parseWorkflowWebhookUrlPatterns(
    options.workflowWebhookAllowedUrlPatterns ?? [],
  );

  if (errors.length) {
    throw new Error(errors.join('; '));
  }

  const requestedSources =
    options.workflowWebhookTargetSources ??
    DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS.targetSources;
  const secretEncryptionKey =
    options.workflowWebhookSecretEncryptionKey?.trim() || null;

  const defaults = DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS.delivery;

  return {
    allowedUrlPatterns: patterns,
    delivery: {
      batchSize: readPositiveInteger(
        options.workflowWebhookDeliveryBatchSize,
        defaults.batchSize,
      ),
      defaultTimeoutMs: Math.min(
        readPositiveInteger(
          options.workflowWebhookDeliveryDefaultTimeoutMs,
          defaults.defaultTimeoutMs,
        ),
        WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
      ),
      maxAttempts: readPositiveInteger(
        options.workflowWebhookDeliveryMaxAttempts,
        defaults.maxAttempts,
      ),
      maxRetryDelayMs: readPositiveInteger(
        options.workflowWebhookDeliveryMaxRetryDelayMs,
        defaults.maxRetryDelayMs,
      ),
      retryBaseDelayMs: readPositiveInteger(
        options.workflowWebhookDeliveryRetryBaseDelayMs,
        defaults.retryBaseDelayMs,
      ),
      scanIntervalMs: readPositiveInteger(
        options.workflowWebhookDeliveryScanIntervalMs,
        defaults.scanIntervalMs,
      ),
      schedulerEnabled:
        typeof options.workflowWebhookDeliverySchedulerEnabled === 'boolean'
          ? options.workflowWebhookDeliverySchedulerEnabled
          : null,
    },
    enforceAllowlistForRegistry: Boolean(
      options.workflowWebhookEnforceAllowlistForRegistry,
    ),
    secretEncryptionKey,
    targetSources: resolveTargetSources(
      requestedSources,
      patterns.length > 0,
      Boolean(secretEncryptionKey),
    ),
  };
}

/**
 * The database source is refused rather than silently downgraded when its
 * guards are missing, but refusing to boot would strand a host that turned it
 * on before wiring Vault. It is dropped from the resolved list instead, and
 * `readDisabledWorkflowWebhookSourceReason` explains why for the log.
 */
function resolveTargetSources(
  requested: readonly BPMWorkflowWebhookEndpointSourceKind[],
  hasAllowlist: boolean,
  hasEncryptionKey: boolean,
): readonly BPMWorkflowWebhookEndpointSourceKind[] {
  const unique = [...new Set(requested)];

  return unique.filter(
    (source) => source !== 'DATABASE' || (hasAllowlist && hasEncryptionKey),
  );
}

export function readDisabledWorkflowWebhookSourceReason(
  options: BPMRootWorkflowWebhookOptions,
  resolved: BPMResolvedWorkflowWebhookOptions,
): string | null {
  const requestedDatabase = (
    options.workflowWebhookTargetSources ?? []
  ).includes('DATABASE');

  if (!requestedDatabase || resolved.targetSources.includes('DATABASE')) {
    return null;
  }

  const missing = [
    ...(resolved.allowedUrlPatterns.length
      ? []
      : ['workflowWebhookAllowedUrlPatterns']),
    ...(resolved.secretEncryptionKey
      ? []
      : ['workflowWebhookSecretEncryptionKey']),
  ];

  return `DATABASE webhook endpoints are disabled: ${missing.join(' and ')} must be set`;
}

function readPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
