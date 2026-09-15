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
}

export interface BPMResolvedWorkflowWebhookOptions {
  readonly allowedUrlPatterns: readonly ParsedWorkflowWebhookUrlPattern[];
  readonly enforceAllowlistForRegistry: boolean;
  readonly secretEncryptionKey: string | null;
  readonly targetSources: readonly BPMWorkflowWebhookEndpointSourceKind[];
}

export const BPM_WORKFLOW_WEBHOOK_OPTIONS: InjectionToken<BPMResolvedWorkflowWebhookOptions> =
  Symbol('BPM_WORKFLOW_WEBHOOK_OPTIONS');

export const DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS: BPMResolvedWorkflowWebhookOptions =
  {
    allowedUrlPatterns: [],
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

  return {
    allowedUrlPatterns: patterns,
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
