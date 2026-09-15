import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WorkflowWebhookEndpointEntity } from './workflow-webhook-endpoint.entity';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMResolvedWorkflowWebhookOptions,
  DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
} from './workflow-webhook-options';
import { WorkflowWebhookSecretCipher } from './workflow-webhook-secret-cipher';
import {
  BPMWorkflowWebhookEndpoint,
  BPMWorkflowWebhookEndpointSource,
  BPMWorkflowWebhookRequest,
} from './workflow-webhook.types';

/**
 * Endpoints maintained by a BPM administrator (ADR 18 §3.13), read straight
 * from `workflow_webhook_endpoints` on every lookup so a change applies to
 * the next attempt without a restart or a cache to invalidate.
 *
 * A disabled row is still returned, flagged `disabled` (and `deprecated`, so
 * the designer stops offering it): a delivery must be able to tell "switched
 * off" from "never existed".
 */
@Injectable()
export class DatabaseWorkflowWebhookEndpointSource
  implements BPMWorkflowWebhookEndpointSource, OnApplicationBootstrap
{
  readonly kind = 'DATABASE' as const;

  private readonly logger = new Logger(
    DatabaseWorkflowWebhookEndpointSource.name,
  );

  private readonly cipher: WorkflowWebhookSecretCipher | null;

  constructor(
    @InjectRepository(WorkflowWebhookEndpointEntity)
    private readonly endpointRepository: Repository<WorkflowWebhookEndpointEntity>,
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_OPTIONS)
    options: BPMResolvedWorkflowWebhookOptions = DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  ) {
    this.cipher = options.secretEncryptionKey
      ? new WorkflowWebhookSecretCipher(options.secretEncryptionKey)
      : null;
  }

  /**
   * A wrong key still boots (any 32 bytes parse), and would otherwise only
   * show up as every database delivery failing to build its request. One
   * stored value is decrypted at boot so the mistake is logged at once; the
   * log names the problem, never a value.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cipher) {
      return;
    }

    const sample = await this.endpointRepository
      .createQueryBuilder('endpoint')
      .where(
        'endpoint.encryptedHeaders IS NOT NULL OR endpoint.encryptedSigningSecret IS NOT NULL',
      )
      .getOne()
      .catch((): null => null);
    const envelope =
      sample?.encryptedSigningSecret ?? sample?.encryptedHeaders ?? null;

    if (!envelope) {
      return;
    }

    try {
      this.cipher.decrypt(envelope);
    } catch {
      this.logger.error(
        'workflowWebhookSecretEncryptionKey cannot decrypt the stored webhook endpoint secrets; database endpoint deliveries will fail until the original key is restored',
      );
    }
  }

  async get(
    key: string,
    version: number,
    manager?: EntityManager,
  ): Promise<BPMWorkflowWebhookEndpoint | null> {
    const repository =
      manager?.getRepository(WorkflowWebhookEndpointEntity) ??
      this.endpointRepository;
    const row = await repository.findOne({ where: { key, version } });

    return row ? this.toEndpoint(row) : null;
  }

  async list(): Promise<readonly BPMWorkflowWebhookEndpoint[]> {
    const rows = await this.endpointRepository.find({
      order: { key: 'ASC', version: 'ASC' },
    });

    return rows.map((row) => this.toEndpoint(row));
  }

  toEndpoint(row: WorkflowWebhookEndpointEntity): BPMWorkflowWebhookEndpoint {
    return {
      // Decrypted per attempt, so a rotated secret or edited header applies
      // to deliveries that are already queued.
      buildRequest: async (): Promise<BPMWorkflowWebhookRequest> => ({
        headers: this.readHeaders(row.encryptedHeaders),
        method: readMethod(row.method),
        ...(row.encryptedSigningSecret
          ? { signingSecret: this.decrypt(row.encryptedSigningSecret) }
          : {}),
        ...(row.timeoutMs ? { timeoutMs: row.timeoutMs } : {}),
        url: row.url,
      }),
      descriptor: {
        deprecated: row.deprecated || !row.isActive,
        ...(row.description ? { description: row.description } : {}),
        disabled: !row.isActive,
        key: row.key,
        label: row.label,
        parameters: row.parameters.map((parameter) => ({
          ...(parameter.description
            ? { description: parameter.description }
            : {}),
          key: parameter.key,
          label: parameter.label,
          required: parameter.required,
          type: parameter.type,
        })),
        version: row.version,
      },
    };
  }

  private readHeaders(
    envelope: string | null,
  ): Readonly<Record<string, string>> {
    if (!envelope) {
      return {};
    }

    const parsed: unknown = JSON.parse(this.decrypt(envelope));

    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  }

  private decrypt(envelope: string): string {
    if (!this.cipher) {
      // Unreachable through BPM's own wiring: without a key the options
      // resolution drops this source, so its rows are not looked up at all.
      throw new Error('Webhook secret encryption key is not configured');
    }

    return this.cipher.decrypt(envelope);
  }
}

function readMethod(value: string): BPMWorkflowWebhookRequest['method'] {
  return value === 'PUT' || value === 'PATCH' ? value : 'POST';
}
