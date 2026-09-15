import { BadRequestException } from '@nestjs/common';

export const BPM_WORKFLOW_WEBHOOK_ERROR_CODES = {
  BINDING_INCOMPATIBLE: 'WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE',
  /** A database endpoint cannot be managed: the source is not enabled. */
  DATABASE_SOURCE_DISABLED: 'WORKFLOW_WEBHOOK_DATABASE_SOURCE_DISABLED',
  /** A database endpoint was saved with a key a registered endpoint uses. */
  ENDPOINT_KEY_CONFLICT: 'WORKFLOW_WEBHOOK_ENDPOINT_KEY_CONFLICT',
  /** The saved endpoint's shape is invalid (key, version, parameters, headers). */
  ENDPOINT_INVALID: 'WORKFLOW_WEBHOOK_ENDPOINT_INVALID',
  /**
   * An existing endpoint version's parameters were changed; a new contract
   * needs a new version so in-flight templates keep theirs.
   */
  ENDPOINT_CONTRACT_CHANGED: 'WORKFLOW_WEBHOOK_ENDPOINT_CONTRACT_CHANGED',
  ENDPOINT_DEPRECATED: 'WORKFLOW_WEBHOOK_ENDPOINT_DEPRECATED',
  /** A database endpoint an administrator disabled. */
  ENDPOINT_DISABLED: 'WORKFLOW_WEBHOOK_ENDPOINT_DISABLED',
  ENDPOINT_MISSING: 'WORKFLOW_WEBHOOK_ENDPOINT_MISSING',
  PARAMETER_REQUIRED: 'WORKFLOW_WEBHOOK_PARAMETER_REQUIRED',
  PARAMETER_UNKNOWN: 'WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN',
  REGISTRY_MISSING: 'WORKFLOW_WEBHOOK_REGISTRY_MISSING',
  /** Test sends for one endpoint came too close together. */
  TEST_RATE_LIMITED: 'WORKFLOW_WEBHOOK_TEST_RATE_LIMITED',
  /**
   * The endpoint's URL is outside `workflowWebhookAllowedUrlPatterns`.
   * Raised when a database-managed endpoint is saved (P6) and again before
   * every delivery attempt (P2), so tightening the list stops queued work.
   */
  URL_NOT_ALLOWED: 'WORKFLOW_WEBHOOK_URL_NOT_ALLOWED',
} as const;

export type BPMWorkflowWebhookErrorCode =
  (typeof BPM_WORKFLOW_WEBHOOK_ERROR_CODES)[keyof typeof BPM_WORKFLOW_WEBHOOK_ERROR_CODES];

export class BPMWorkflowWebhookException extends BadRequestException {
  readonly code: BPMWorkflowWebhookErrorCode;

  constructor(code: BPMWorkflowWebhookErrorCode, detail?: string) {
    super({ code, message: detail ? `${code}: ${detail}` : code });
    this.code = code;
  }
}
