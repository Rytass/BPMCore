import { registerEnumType } from '@nestjs/graphql';

export enum WorkflowWebhookDeliveryStatusEnum {
  DELIVERY_IN_PROGRESS = 'DELIVERY_IN_PROGRESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  SENT = 'SENT',
}

registerEnumType(WorkflowWebhookDeliveryStatusEnum, {
  name: 'BPMWorkflowWebhookDeliveryStatus',
});

/**
 * Why a delivery attempt did not end in `SENT` (ADR 18 §3.6). Stored on the
 * row and copied into the terminal activity log; never contains the URL or
 * the response body.
 */
export const WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES = {
  BUILD_REQUEST_FAILED: 'WEBHOOK_BUILD_REQUEST_FAILED',
  /** The endpoint source threw while looking the endpoint up. */
  ENDPOINT_LOOKUP_FAILED: 'WEBHOOK_ENDPOINT_LOOKUP_FAILED',
  ENDPOINT_MISSING: 'WEBHOOK_ENDPOINT_MISSING',
  /** An unexpected error inside BPM itself; retried like a transient one. */
  INTERNAL_ERROR: 'WEBHOOK_INTERNAL_ERROR',
  INVALID_REQUEST: 'WEBHOOK_INVALID_REQUEST',
  NETWORK: 'WEBHOOK_NETWORK',
  PARAMETER_INVALID: 'WEBHOOK_PARAMETER_INVALID',
  REDIRECT: 'WEBHOOK_REDIRECT',
  TIMEOUT: 'WEBHOOK_TIMEOUT',
  URL_NOT_ALLOWED: 'WEBHOOK_URL_NOT_ALLOWED',
} as const;

export type WorkflowWebhookDeliveryErrorCode =
  | (typeof WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES)[keyof typeof WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES]
  | `WEBHOOK_HTTP_${number}`;
