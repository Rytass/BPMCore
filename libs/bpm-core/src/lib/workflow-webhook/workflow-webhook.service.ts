import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX } from '@rytass/bpm-core-shared/workflow-graph';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMResolvedWorkflowWebhookOptions,
  DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
} from './workflow-webhook-options';
import {
  BPM_WORKFLOW_WEBHOOK_REGISTRY,
  BPMWorkflowWebhookEndpoint,
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookEndpointSource,
  BPMWorkflowWebhookRegistry,
  readWorkflowWebhookEndpointKey,
} from './workflow-webhook.types';

/**
 * Wraps the host's synchronous registry as an endpoint source so the catalog,
 * the publish lint and (from P2) the delivery path only ever talk to the
 * source interface. P6 adds the database source beside this one without
 * touching any of them.
 */
class RegistryWorkflowWebhookEndpointSource implements BPMWorkflowWebhookEndpointSource {
  readonly kind = 'REGISTRY' as const;

  constructor(private readonly registry: BPMWorkflowWebhookRegistry) {}

  async get(
    key: string,
    version: number,
  ): Promise<BPMWorkflowWebhookEndpoint | null> {
    return this.registry.get(key, version);
  }

  async list(): Promise<readonly BPMWorkflowWebhookEndpoint[]> {
    return this.registry.list();
  }
}

export interface ListWorkflowWebhookEndpointsOptions {
  readonly includeDeprecated?: boolean;
}

@Injectable()
export class WorkflowWebhookService implements OnModuleInit {
  private readonly sources: readonly BPMWorkflowWebhookEndpointSource[];

  constructor(
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_REGISTRY)
    private readonly registry: BPMWorkflowWebhookRegistry | undefined,
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_OPTIONS)
    private readonly options: BPMResolvedWorkflowWebhookOptions = DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  ) {
    this.sources = this.options.targetSources.flatMap((kind) =>
      kind === 'REGISTRY' && this.registry
        ? [new RegistryWorkflowWebhookEndpointSource(this.registry)]
        : [],
    );
  }

  /**
   * A descriptor that contradicts itself would only surface as a confusing
   * publish error much later, so the registry is checked once at boot and the
   * application refuses to start instead.
   */
  onModuleInit(): void {
    const errors = readRegistryDescriptorErrors(this.registry);

    if (errors.length) {
      throw new Error(
        `Invalid BPM webhook endpoint registry: ${errors.join('; ')}`,
      );
    }
  }

  /**
   * `false` when no source can ever answer, which is what a publish lint needs
   * in order to refuse a template that references any endpoint at all.
   */
  hasEndpointSources(): boolean {
    return this.sources.length > 0;
  }

  async listEndpoints(
    options: ListWorkflowWebhookEndpointsOptions = {},
  ): Promise<readonly BPMWorkflowWebhookEndpointEntry[]> {
    const lists = await Promise.all(
      this.sources.map(async (source) =>
        (await source.list()).map((endpoint) => ({
          endpoint,
          source: source.kind,
        })),
      ),
    );

    return lists
      .flat()
      .filter(
        (entry, index, entries) =>
          // Source order decides: an endpoint registered in code wins over a
          // database row that claims the same key.
          entries.findIndex(
            (candidate) =>
              readWorkflowWebhookEndpointKey(candidate.endpoint.descriptor) ===
              readWorkflowWebhookEndpointKey(entry.endpoint.descriptor),
          ) === index,
      )
      .filter(
        (entry) =>
          Boolean(options.includeDeprecated) ||
          !entry.endpoint.descriptor.deprecated,
      );
  }

  async getEndpoint(
    key: string,
    version: number,
  ): Promise<BPMWorkflowWebhookEndpointEntry | null> {
    for (const source of this.sources) {
      const endpoint = await source.get(key, version);

      if (endpoint) {
        return { endpoint, source: source.kind };
      }
    }

    return null;
  }

  readOptions(): BPMResolvedWorkflowWebhookOptions {
    return this.options;
  }
}

const PARAMETER_TYPES: readonly NotifyWebhookParameterType[] = [
  'boolean',
  'json',
  'number',
  'string',
  'stringArray',
];

export function readRegistryDescriptorErrors(
  registry: BPMWorkflowWebhookRegistry | undefined,
): readonly string[] {
  if (!registry) {
    return [];
  }

  const endpoints = registry.list();
  const seen = new Set<string>();

  return endpoints.flatMap((endpoint, index) => {
    const descriptor = endpoint?.descriptor;

    // A host-code mistake should fail the boot with a sentence, not with
    // "cannot read properties of undefined".
    if (!descriptor || typeof descriptor !== 'object') {
      return [`endpoint #${index} has no descriptor`];
    }

    if (
      typeof descriptor.key !== 'string' ||
      typeof descriptor.label !== 'string'
    ) {
      return [`endpoint #${index} must have a string key and label`];
    }

    const id = readWorkflowWebhookEndpointKey(descriptor);
    const duplicate = seen.has(id);

    seen.add(id);

    if (!Array.isArray(descriptor.parameters)) {
      return [`${id} must declare parameters as an array`];
    }

    // Compared trimmed, like the template-side structural lint, so " a" and
    // "a" cannot both be declared and then collide in a binding.
    const parameterKeys = descriptor.parameters.map((parameter) =>
      typeof parameter?.key === 'string' ? parameter.key.trim() : '',
    );

    return [
      ...(descriptor.key?.trim() ? [] : ['an endpoint has an empty key']),
      ...(descriptor.key !== descriptor.key?.trim()
        ? [`${id} key must not have surrounding whitespace`]
        : []),
      // The catalog exposes `version` as a GraphQL Int: one value past the
      // int32 range fails the whole query, not just this endpoint.
      ...(Number.isInteger(descriptor.version) &&
      descriptor.version >= 1 &&
      descriptor.version <= NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX
        ? []
        : [
            `${id} must have an integer version between 1 and ${NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX}`,
          ]),
      ...(descriptor.label?.trim() ? [] : [`${id} must have a label`]),
      ...(duplicate ? [`${id} is registered more than once`] : []),
      ...(new Set(parameterKeys).size === parameterKeys.length
        ? []
        : [`${id} has duplicate parameter keys`]),
      ...descriptor.parameters.flatMap((parameter, index) => [
        ...(parameterKeys[index]
          ? []
          : [`${id} has a parameter with an empty key`]),
        ...(typeof parameter?.key === 'string' &&
        parameter.key !== parameter.key.trim()
          ? [
              `${id} parameter "${parameter.key}" must not have surrounding whitespace`,
            ]
          : []),
        ...(PARAMETER_TYPES.includes(parameter?.type)
          ? []
          : [
              `${id} parameter "${parameterKeys[index]}" has unsupported type "${String(parameter?.type)}"`,
            ]),
      ]),
    ];
  });
}
