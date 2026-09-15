import { BadRequestException } from '@nestjs/common';

export const BPM_WORKFLOW_WEBHOOK_ERROR_CODES = {
  BINDING_INCOMPATIBLE: 'WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE',
  ENDPOINT_DEPRECATED: 'WORKFLOW_WEBHOOK_ENDPOINT_DEPRECATED',
  ENDPOINT_MISSING: 'WORKFLOW_WEBHOOK_ENDPOINT_MISSING',
  PARAMETER_REQUIRED: 'WORKFLOW_WEBHOOK_PARAMETER_REQUIRED',
  PARAMETER_UNKNOWN: 'WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN',
  REGISTRY_MISSING: 'WORKFLOW_WEBHOOK_REGISTRY_MISSING',
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
