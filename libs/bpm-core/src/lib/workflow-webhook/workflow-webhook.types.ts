import { InjectionToken } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';

/**
 * Where an endpoint definition came from (ADR 18 §3.13).
 *
 * `REGISTRY` endpoints are registered by host code, so their URL has already
 * been through code review. `DATABASE` endpoints are maintained by a BPM
 * administrator and only exist once P6 ships; the catalog, the publish lint
 * and the delivery path are written against this union from P1 so that phase
 * adds a source rather than rewriting them.
 */
export type BPMWorkflowWebhookEndpointSourceKind = 'DATABASE' | 'REGISTRY';

export interface BPMWorkflowWebhookParameter {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: NotifyWebhookParameterType;
}

export interface BPMWorkflowWebhookEndpointDescriptor {
  /**
   * Hidden from the designer's endpoint picker, but still deliverable: a
   * template that already references it keeps working.
   */
  readonly deprecated?: boolean;
  readonly description?: string;
  /**
   * Switched off by an administrator (database endpoints, P6). Unlike
   * `deprecated`, nothing is delivered any more: queued and new deliveries
   * fail with `WEBHOOK_ENDPOINT_DISABLED`, and templates cannot publish it.
   */
  readonly disabled?: boolean;
  readonly key: string;
  readonly label: string;
  readonly parameters: readonly BPMWorkflowWebhookParameter[];
  readonly version: number;
}

/**
 * One NOTIFY webhook event, as handed to the host's `buildRequest()` and, when
 * the host supplies no body, serialized as the request body itself
 * (ADR 18 §3.4).
 */
export interface BPMWorkflowWebhookEvent {
  /** Which attempt this is, from 1. Does not affect idempotency. */
  readonly attempt: number;
  /** Stable across retries; the receiver's idempotency key. */
  readonly deliveryId: string;
  readonly endpoint: {
    readonly key: string;
    readonly version: number;
  };
  readonly eventType: 'workflow.notify';
  readonly initiator: {
    readonly memberId: string;
  };
  readonly instance: {
    readonly id: string;
    readonly templateId: string;
    readonly templateVersionId: string;
    readonly title: string;
  };
  readonly node: {
    readonly id: string;
    readonly label: string;
  };
  /** When the node ran, not when this attempt is being sent. */
  readonly occurredAt: string;
  /** Only the parameters the template bound; never the whole form. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface BPMWorkflowWebhookRequest {
  /** Omitted: BPM sends the JSON-serialized event. */
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Omitted: POST. */
  readonly method?: 'PATCH' | 'POST' | 'PUT';
  /** Set to have BPM add the signature headers (ADR 18 §3.6). */
  readonly signingSecret?: string;
  readonly timeoutMs?: number;
  readonly url: string;
}

export interface BPMWorkflowWebhookEndpoint {
  readonly descriptor: BPMWorkflowWebhookEndpointDescriptor;

  /**
   * Called once per delivery attempt, never at enqueue time, so a rotated
   * credential or a moved URL takes effect on deliveries that are already
   * queued and on in-flight instances.
   */
  buildRequest(
    event: BPMWorkflowWebhookEvent,
  ): Promise<BPMWorkflowWebhookRequest>;
}

/**
 * The host-facing catalog: a plain, synchronous lookup so a host can back it
 * with a literal list. Asynchronous sources (the database one) implement
 * {@link BPMWorkflowWebhookEndpointSource} instead.
 */
export interface BPMWorkflowWebhookRegistry {
  get(key: string, version: number): BPMWorkflowWebhookEndpoint | null;
  list(): readonly BPMWorkflowWebhookEndpoint[];
}

export const BPM_WORKFLOW_WEBHOOK_REGISTRY: InjectionToken<BPMWorkflowWebhookRegistry> =
  Symbol('BPM_WORKFLOW_WEBHOOK_REGISTRY');

/** One endpoint plus the source it was resolved from. */
export interface BPMWorkflowWebhookEndpointEntry {
  readonly endpoint: BPMWorkflowWebhookEndpoint;
  readonly source: BPMWorkflowWebhookEndpointSourceKind;
}

/**
 * Internal abstraction over "where endpoints come from". Asynchronous because
 * the database source (P6) reads a table; the registry source resolves
 * immediately.
 */
export interface BPMWorkflowWebhookEndpointSource {
  readonly kind: BPMWorkflowWebhookEndpointSourceKind;

  get(
    key: string,
    version: number,
    manager?: EntityManager,
  ): Promise<BPMWorkflowWebhookEndpoint | null>;
  list(): Promise<readonly BPMWorkflowWebhookEndpoint[]>;
}

export class EmptyBPMWorkflowWebhookRegistry implements BPMWorkflowWebhookRegistry {
  get(key: string, version: number): BPMWorkflowWebhookEndpoint | null {
    void key;
    void version;

    return null;
  }

  list(): readonly BPMWorkflowWebhookEndpoint[] {
    return [];
  }
}

export class StaticBPMWorkflowWebhookRegistry implements BPMWorkflowWebhookRegistry {
  private readonly endpoints: readonly BPMWorkflowWebhookEndpoint[];

  constructor(endpoints: readonly BPMWorkflowWebhookEndpoint[]) {
    this.endpoints = [...endpoints];
  }

  get(key: string, version: number): BPMWorkflowWebhookEndpoint | null {
    return (
      this.endpoints.find(
        (endpoint) =>
          endpoint.descriptor.key === key &&
          endpoint.descriptor.version === version,
      ) ?? null
    );
  }

  list(): readonly BPMWorkflowWebhookEndpoint[] {
    return this.endpoints;
  }
}

export function readWorkflowWebhookEndpointKey(
  descriptor: BPMWorkflowWebhookEndpointDescriptor,
): string {
  return `${descriptor.key}@${descriptor.version}`;
}
