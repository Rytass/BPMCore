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
  /** Switched off by an administrator; also reported as `deprecated`. */
  readonly disabled: boolean;
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
        disabled
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

// ── Database-managed endpoints (administrators, ADR 18 §3.13) ───────────────

export interface WorkflowWebhookEndpointManagementRecord {
  readonly allowedUrlPatterns: readonly string[];
  /** `false` when this server does not manage endpoints in the database. */
  readonly enabled: boolean;
}

/**
 * An administrator's view of a database endpoint. Header values and the
 * signing secret are write-only: only header names and whether a secret is
 * set ever come back.
 */
export interface WorkflowWebhookManagedEndpointRecord {
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdByMemberId: string | null;
  readonly deprecated: boolean;
  readonly description: string | null;
  readonly hasSigningSecret: boolean;
  readonly headerNames: readonly string[];
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly method: string;
  readonly parameters: readonly WorkflowWebhookParameterRecord[];
  readonly secretRotatedAt: string | null;
  readonly timeoutMs: number | null;
  readonly updatedAt: string;
  readonly updatedByMemberId: string | null;
  readonly url: string;
  readonly version: number;
}

export type WorkflowWebhookEndpointAuditAction =
  | 'CREATED'
  | 'DISABLED'
  | 'ENABLED'
  | 'SECRET_ROTATED'
  | 'TEST_SENT'
  | 'UPDATED';

export interface WorkflowWebhookEndpointAuditRecord {
  readonly action: WorkflowWebhookEndpointAuditAction;
  readonly actorMemberId: string | null;
  /** Field names only; values are never recorded. */
  readonly changedFields: readonly string[];
  readonly createdAt: string;
  readonly endpointId: string;
  readonly id: string;
}

export interface WorkflowWebhookEndpointTestResultRecord {
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly ok: boolean;
  readonly status: number | null;
}

export interface WorkflowWebhookEndpointHeaderInput {
  readonly name: string;
  readonly value: string;
}

export interface WorkflowWebhookEndpointParameterInput {
  readonly description?: string | null;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: NotifyWebhookParameterType;
}

export interface CreateWorkflowWebhookEndpointInput {
  readonly deprecated?: boolean | null;
  readonly description?: string | null;
  readonly headers?: readonly WorkflowWebhookEndpointHeaderInput[] | null;
  readonly key: string;
  readonly label: string;
  readonly method?: string | null;
  readonly parameters: readonly WorkflowWebhookEndpointParameterInput[];
  readonly signingSecret?: string | null;
  readonly timeoutMs?: number | null;
  readonly url: string;
  readonly version: number;
}

/** Omitted fields are kept; `headers` replaces every header when given. */
export interface UpdateWorkflowWebhookEndpointInput {
  readonly deprecated?: boolean | null;
  readonly description?: string | null;
  readonly headers?: readonly WorkflowWebhookEndpointHeaderInput[] | null;
  readonly id: string;
  readonly label?: string | null;
  readonly method?: string | null;
  readonly parameters?: readonly WorkflowWebhookEndpointParameterInput[] | null;
  readonly timeoutMs?: number | null;
  readonly url?: string | null;
}

const MANAGED_ENDPOINT_FIELDS = `
  active
  createdAt
  createdByMemberId
  deprecated
  description
  hasSigningSecret
  headerNames
  id
  key
  label
  method
  parameters {
    description
    key
    label
    required
    type
  }
  secretRotatedAt
  timeoutMs
  updatedAt
  updatedByMemberId
  url
  version
`;

export async function readWorkflowWebhookEndpointManagement(): Promise<WorkflowWebhookEndpointManagementRecord> {
  const data = await requestGraphQl<{
    readonly workflowWebhookEndpointManagement: WorkflowWebhookEndpointManagementRecord;
  }>(
    `query WorkflowWebhookEndpointManagement {
      workflowWebhookEndpointManagement { allowedUrlPatterns enabled }
    }`,
  );

  return data.workflowWebhookEndpointManagement;
}

export async function listWorkflowWebhookManagedEndpoints(): Promise<
  readonly WorkflowWebhookManagedEndpointRecord[]
> {
  const data = await requestGraphQl<{
    readonly workflowWebhookManagedEndpoints: readonly WorkflowWebhookManagedEndpointRecord[];
  }>(
    `query WorkflowWebhookManagedEndpoints {
      workflowWebhookManagedEndpoints { ${MANAGED_ENDPOINT_FIELDS} }
    }`,
  );

  return data.workflowWebhookManagedEndpoints;
}

export async function listWorkflowWebhookEndpointAudits(
  endpointId: string,
): Promise<readonly WorkflowWebhookEndpointAuditRecord[]> {
  const data = await requestGraphQl<{
    readonly workflowWebhookEndpointAudits: readonly WorkflowWebhookEndpointAuditRecord[];
  }>(
    `query WorkflowWebhookEndpointAudits($endpointId: ID!) {
      workflowWebhookEndpointAudits(endpointId: $endpointId) {
        action
        actorMemberId
        changedFields
        createdAt
        endpointId
        id
      }
    }`,
    { endpointId },
  );

  return data.workflowWebhookEndpointAudits;
}

export async function createWorkflowWebhookEndpoint(
  input: CreateWorkflowWebhookEndpointInput,
): Promise<WorkflowWebhookManagedEndpointRecord> {
  const data = await requestGraphQl<{
    readonly createWorkflowWebhookEndpoint: WorkflowWebhookManagedEndpointRecord;
  }>(
    `mutation CreateWorkflowWebhookEndpoint($input: BPMCreateWorkflowWebhookEndpointInput!) {
      createWorkflowWebhookEndpoint(input: $input) { ${MANAGED_ENDPOINT_FIELDS} }
    }`,
    { input },
  );

  return data.createWorkflowWebhookEndpoint;
}

export async function updateWorkflowWebhookEndpoint(
  input: UpdateWorkflowWebhookEndpointInput,
): Promise<WorkflowWebhookManagedEndpointRecord> {
  const data = await requestGraphQl<{
    readonly updateWorkflowWebhookEndpoint: WorkflowWebhookManagedEndpointRecord;
  }>(
    `mutation UpdateWorkflowWebhookEndpoint($input: BPMUpdateWorkflowWebhookEndpointInput!) {
      updateWorkflowWebhookEndpoint(input: $input) { ${MANAGED_ENDPOINT_FIELDS} }
    }`,
    { input },
  );

  return data.updateWorkflowWebhookEndpoint;
}

export async function setWorkflowWebhookEndpointActive(
  id: string,
  active: boolean,
): Promise<WorkflowWebhookManagedEndpointRecord> {
  const data = await requestGraphQl<{
    readonly setWorkflowWebhookEndpointActive: WorkflowWebhookManagedEndpointRecord;
  }>(
    `mutation SetWorkflowWebhookEndpointActive($id: ID!, $active: Boolean!) {
      setWorkflowWebhookEndpointActive(id: $id, active: $active) { ${MANAGED_ENDPOINT_FIELDS} }
    }`,
    { active, id },
  );

  return data.setWorkflowWebhookEndpointActive;
}

/** `signingSecret: null` removes the secret, so requests stop being signed. */
export async function rotateWorkflowWebhookEndpointSecret(
  id: string,
  signingSecret: string | null,
): Promise<WorkflowWebhookManagedEndpointRecord> {
  const data = await requestGraphQl<{
    readonly rotateWorkflowWebhookEndpointSecret: WorkflowWebhookManagedEndpointRecord;
  }>(
    `mutation RotateWorkflowWebhookEndpointSecret($id: ID!, $signingSecret: String) {
      rotateWorkflowWebhookEndpointSecret(id: $id, signingSecret: $signingSecret) { ${MANAGED_ENDPOINT_FIELDS} }
    }`,
    { id, signingSecret },
  );

  return data.rotateWorkflowWebhookEndpointSecret;
}

/** Sends a sample event (never a real case); rate limited per endpoint. */
export async function testWorkflowWebhookEndpoint(
  id: string,
): Promise<WorkflowWebhookEndpointTestResultRecord> {
  const data = await requestGraphQl<{
    readonly testWorkflowWebhookEndpoint: WorkflowWebhookEndpointTestResultRecord;
  }>(
    `mutation TestWorkflowWebhookEndpoint($id: ID!) {
      testWorkflowWebhookEndpoint(id: $id) { errorCode errorDetail ok status }
    }`,
    { id },
  );

  return data.testWorkflowWebhookEndpoint;
}
