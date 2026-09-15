import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { requestGraphQl } from '../graphql-client';

/** Where an endpoint is registered: in host code, or maintained in BPM. */
export type WorkflowWebhookEndpointSource = 'DATABASE' | 'REGISTRY';

export interface WorkflowWebhookParameterRecord {
  readonly description: string | null;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: NotifyWebhookParameterType;
}

/**
 * The designer's view of a webhook endpoint (ADR 18 §3.8). Carries no URL,
 * header or secret — those never leave the server.
 */
export interface WorkflowWebhookEndpointRecord {
  readonly deprecated: boolean;
  readonly description: string | null;
  readonly key: string;
  readonly label: string;
  readonly parameters: readonly WorkflowWebhookParameterRecord[];
  readonly source: WorkflowWebhookEndpointSource;
  readonly version: number;
}

interface WorkflowWebhookEndpointsQueryData {
  readonly workflowWebhookEndpoints: readonly WorkflowWebhookEndpointRecord[];
}

/**
 * The endpoints a notify node can call. Designer-only. Pass
 * `includeDeprecated` when editing an existing draft, so a target that
 * already points at a deprecated endpoint still shows its name.
 */
export async function listWorkflowWebhookEndpoints({
  includeDeprecated = false,
}: {
  readonly includeDeprecated?: boolean;
} = {}): Promise<readonly WorkflowWebhookEndpointRecord[]> {
  const data = await requestGraphQl<WorkflowWebhookEndpointsQueryData>(
    `query WorkflowWebhookEndpoints($includeDeprecated: Boolean) {
      workflowWebhookEndpoints(includeDeprecated: $includeDeprecated) {
        deprecated
        description
        key
        label
        parameters {
          description
          key
          label
          required
          type
        }
        source
        version
      }
    }`,
    { includeDeprecated },
  );

  return data.workflowWebhookEndpoints;
}
