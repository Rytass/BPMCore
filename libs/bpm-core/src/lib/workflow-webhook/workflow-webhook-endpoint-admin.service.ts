import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX } from '@rytass/bpm-core-shared/workflow-graph';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { isWorkflowWebhookUrlAllowed } from './workflow-webhook-allowlist';
import { DatabaseWorkflowWebhookEndpointSource } from './workflow-webhook-database-source';
import {
  WorkflowWebhookDeliveryService,
  WorkflowWebhookTestOutcome,
} from './workflow-webhook-delivery.service';
import {
  WorkflowWebhookEndpointAuditActionEnum,
  WorkflowWebhookEndpointAuditEntity,
  WorkflowWebhookEndpointEntity,
  WorkflowWebhookStoredParameter,
} from './workflow-webhook-endpoint.entity';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMResolvedWorkflowWebhookOptions,
  DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
} from './workflow-webhook-options';
import { WorkflowWebhookSecretCipher } from './workflow-webhook-secret-cipher';
import {
  BPM_WORKFLOW_WEBHOOK_ERROR_CODES,
  BPMWorkflowWebhookException,
} from './workflow-webhook.errors';
import { WorkflowWebhookService } from './workflow-webhook.service';
import { BPMWorkflowWebhookEvent } from './workflow-webhook.types';

export interface WorkflowWebhookEndpointHeaderData {
  readonly name: string;
  readonly value: string;
}

export interface WorkflowWebhookEndpointParameterData {
  readonly description?: string | null;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: NotifyWebhookParameterType;
}

export interface CreateWorkflowWebhookEndpointData {
  readonly deprecated?: boolean | null;
  readonly description?: string | null;
  readonly headers?: readonly WorkflowWebhookEndpointHeaderData[] | null;
  readonly key: string;
  readonly label: string;
  readonly method?: string | null;
  readonly parameters: readonly WorkflowWebhookEndpointParameterData[];
  readonly signingSecret?: string | null;
  readonly timeoutMs?: number | null;
  readonly url: string;
  readonly version: number;
}

/**
 * Omitted fields stay as they are. `headers` replaces the whole set when
 * given — values are write-only, so there is nothing to merge into — and
 * `parameters` must match the stored contract (a change needs a new version).
 */
export interface UpdateWorkflowWebhookEndpointData {
  readonly deprecated?: boolean | null;
  readonly description?: string | null;
  readonly headers?: readonly WorkflowWebhookEndpointHeaderData[] | null;
  readonly label?: string | null;
  readonly method?: string | null;
  readonly parameters?: readonly WorkflowWebhookEndpointParameterData[] | null;
  readonly timeoutMs?: number | null;
  readonly url?: string | null;
}

const PARAMETER_TYPES: readonly NotifyWebhookParameterType[] = [
  'boolean',
  'json',
  'number',
  'string',
  'stringArray',
];
const METHODS = ['PATCH', 'POST', 'PUT'] as const;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/u;
const MAX_HEADERS = 20;
const MAX_SECRET_LENGTH = 1024;
const MAX_HEADER_VALUE_LENGTH = 4096;
/** Headers BPM sets itself or that describe the connection, not the call. */
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
/**
 * What `fetch` accepts in a header value: tab, visible ASCII and Latin-1.
 * Anything else would only fail every delivery as a retryable network error.
 */
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7e\x80-\xff]*$/u;

/** One test send per endpoint every 10 s, at most 5 per 10 minutes. */
export const WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS = 10_000;
export const WORKFLOW_WEBHOOK_TEST_WINDOW_MS = 600_000;
export const WORKFLOW_WEBHOOK_TEST_MAX_PER_WINDOW = 5;

/**
 * Administrator management of database webhook endpoints (ADR 18 §3.13).
 *
 * Header values and the signing secret go in encrypted and never come back
 * out: not in a response, an error message or a log. Every change writes an
 * audit row naming the fields that changed, never their values.
 */
@Injectable()
export class WorkflowWebhookEndpointAdminService {
  // Per process: several API replicas each allow their own budget, which is
  // acceptable for a manual test button and documented as such.
  private readonly testSends = new Map<string, readonly number[]>();

  constructor(
    @InjectRepository(WorkflowWebhookEndpointEntity)
    private readonly endpointRepository: Repository<WorkflowWebhookEndpointEntity>,
    @InjectRepository(WorkflowWebhookEndpointAuditEntity)
    private readonly auditRepository: Repository<WorkflowWebhookEndpointAuditEntity>,
    private readonly webhookService: WorkflowWebhookService,
    private readonly deliveryService: WorkflowWebhookDeliveryService,
    private readonly databaseSource: DatabaseWorkflowWebhookEndpointSource,
    @Optional()
    @Inject(BPM_WORKFLOW_WEBHOOK_OPTIONS)
    private readonly options: BPMResolvedWorkflowWebhookOptions = DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  ) {}

  isEnabled(): boolean {
    return this.webhookService.hasDatabaseSource();
  }

  async list(): Promise<readonly WorkflowWebhookEndpointEntity[]> {
    return this.endpointRepository.find({
      order: { key: 'ASC', version: 'DESC' },
    });
  }

  async listAudits(
    endpointId: string,
  ): Promise<readonly WorkflowWebhookEndpointAuditEntity[]> {
    return this.auditRepository.find({
      order: { createdAt: 'DESC' },
      take: 100,
      where: { endpointId },
    });
  }

  async create(
    data: CreateWorkflowWebhookEndpointData,
    actorMemberId: string | null,
  ): Promise<WorkflowWebhookEndpointEntity> {
    const cipher = this.readCipher();
    const key = data.key.trim();

    assertEndpoint(
      KEY_PATTERN.test(key),
      'key must be 1–100 letters, digits, ".", "_", ":" or "-"',
    );
    assertEndpoint(
      Number.isInteger(data.version) &&
        data.version >= 1 &&
        data.version <= NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX,
      `version must be an integer between 1 and ${NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX}`,
    );

    if (
      this.webhookService
        .listRegistryEndpoints()
        .some((endpoint) => endpoint.descriptor.key === key)
    ) {
      throw new BPMWorkflowWebhookException(
        BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_KEY_CONFLICT,
        `"${key}" is already registered by the host application`,
      );
    }

    const existing = await this.endpointRepository.find({ where: { key } });
    const latestVersion = existing.reduce(
      (latest, row) => Math.max(latest, row.version),
      0,
    );

    assertEndpoint(
      data.version > latestVersion,
      latestVersion
        ? `"${key}" already has version ${latestVersion}; a new contract needs a higher version`
        : 'version is invalid',
    );

    const url = this.readUrl(data.url);
    const saved = await this.endpointRepository
      .save(
        this.endpointRepository.create({
          createdByMemberId: actorMemberId,
          deprecated: Boolean(data.deprecated),
          description: readOptionalText(data.description, 'description', 2000),
          encryptedHeaders: this.encryptHeaders(cipher, data.headers ?? []),
          encryptedSigningSecret: this.encryptSecret(
            cipher,
            data.signingSecret,
          ),
          isActive: true,
          key,
          label: readRequiredText(data.label, 'label', 200),
          method: readMethod(data.method),
          parameters: readParameters(data.parameters),
          secretRotatedAt: null,
          timeoutMs: readTimeout(data.timeoutMs),
          updatedByMemberId: actorMemberId,
          url,
          version: data.version,
        }),
      )
      .catch((error: unknown): never => {
        // Two administrators creating the same version at once: the unique
        // constraint decides, and the loser gets a sentence, not a 500.
        if (readDatabaseErrorCode(error) === '23505') {
          throw new BPMWorkflowWebhookException(
            BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_INVALID,
            `"${key}" version ${data.version} already exists`,
          );
        }

        throw error;
      });

    await this.audit(
      saved.id,
      WorkflowWebhookEndpointAuditActionEnum.CREATED,
      [
        'key',
        'version',
        'label',
        'url',
        'method',
        'parameters',
        ...(data.description ? ['description'] : []),
        ...(data.headers?.length ? ['headers'] : []),
        ...(data.signingSecret ? ['signingSecret'] : []),
        ...(data.timeoutMs ? ['timeoutMs'] : []),
        ...(data.deprecated ? ['deprecated'] : []),
      ],
      actorMemberId,
    );

    return saved;
  }

  async update(
    id: string,
    data: UpdateWorkflowWebhookEndpointData,
    actorMemberId: string | null,
  ): Promise<WorkflowWebhookEndpointEntity> {
    const cipher = this.readCipher();
    const row = await this.readRow(id);

    if (
      data.parameters &&
      stableParameters(readParameters(data.parameters)) !==
        stableParameters(row.parameters)
    ) {
      throw new BPMWorkflowWebhookException(
        BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_CONTRACT_CHANGED,
        `the parameters of ${row.key}@${row.version} cannot change; create version ${row.version + 1} instead`,
      );
    }

    const parameters = data.parameters ? readParameters(data.parameters) : null;
    const url = isGiven(data.url) ? this.readUrl(data.url) : null;

    // Pointing stored credentials at another host would let whoever controls
    // that host read header values the admin view never returns, so a new
    // origin needs the headers re-entered in the same request.
    assertEndpoint(
      !url || readOrigin(url) === readOrigin(row.url) || Boolean(data.headers),
      'changing the URL to another host requires entering the headers again',
    );

    const next: Partial<WorkflowWebhookEndpointEntity> = {
      // Same contract, so only labels and descriptions can differ here.
      ...(parameters &&
      describeParameters(parameters) !== describeParameters(row.parameters)
        ? { parameters }
        : {}),
      ...(isGiven(data.label)
        ? { label: readRequiredText(data.label, 'label', 200) }
        : {}),
      ...(data.description !== undefined
        ? {
            description: readOptionalText(
              data.description,
              'description',
              2000,
            ),
          }
        : {}),
      ...(url ? { url } : {}),
      ...(isGiven(data.method) ? { method: readMethod(data.method) } : {}),
      ...(data.timeoutMs !== undefined
        ? { timeoutMs: readTimeout(data.timeoutMs) }
        : {}),
      ...(typeof data.deprecated === 'boolean'
        ? { deprecated: data.deprecated }
        : {}),
    };
    const changes: Partial<WorkflowWebhookEndpointEntity> = Object.fromEntries(
      Object.entries(next).filter(
        ([field, value]) =>
          field === 'parameters' || row[field as keyof typeof row] !== value,
      ),
    );
    const changedFields = [
      ...Object.keys(changes),
      // Values are write-only, so giving headers at all counts as a change.
      ...(data.headers ? ['headers'] : []),
    ];

    if (!changedFields.length) {
      return row;
    }

    // Only the changed columns are written, so a concurrent secret rotation
    // or header replacement is not reverted by this row's stale copy.
    await this.endpointRepository.update(
      { id: row.id },
      {
        ...changes,
        ...(data.headers
          ? { encryptedHeaders: this.encryptHeaders(cipher, data.headers) }
          : {}),
        updatedByMemberId: actorMemberId,
      },
    );
    await this.audit(
      row.id,
      WorkflowWebhookEndpointAuditActionEnum.UPDATED,
      changedFields,
      actorMemberId,
    );

    return this.readRow(row.id);
  }

  async setActive(
    id: string,
    active: boolean,
    actorMemberId: string | null,
  ): Promise<WorkflowWebhookEndpointEntity> {
    this.readCipher();

    const row = await this.readRow(id);

    if (row.isActive === active) {
      return row;
    }

    // Re-enabling puts a URL back into use, so it must still pass today's
    // allowlist.
    if (active) {
      this.readUrl(row.url);
    }

    await this.endpointRepository.update(
      { id: row.id },
      { isActive: active, updatedByMemberId: actorMemberId },
    );
    await this.audit(
      row.id,
      active
        ? WorkflowWebhookEndpointAuditActionEnum.ENABLED
        : WorkflowWebhookEndpointAuditActionEnum.DISABLED,
      ['isActive'],
      actorMemberId,
    );

    return this.readRow(row.id);
  }

  /** `null` removes the secret, so BPM stops signing requests. */
  async rotateSecret(
    id: string,
    signingSecret: string | null,
    actorMemberId: string | null,
  ): Promise<WorkflowWebhookEndpointEntity> {
    const cipher = this.readCipher();
    const row = await this.readRow(id);
    await this.endpointRepository.update(
      { id: row.id },
      {
        encryptedSigningSecret: this.encryptSecret(cipher, signingSecret),
        secretRotatedAt: new Date(),
        updatedByMemberId: actorMemberId,
      },
    );
    await this.audit(
      row.id,
      WorkflowWebhookEndpointAuditActionEnum.SECRET_ROTATED,
      ['signingSecret'],
      actorMemberId,
    );

    return this.readRow(row.id);
  }

  /**
   * Sends a sample event — placeholder ids and a sample value for every
   * declared parameter, never a real case — through the normal delivery
   * path, and reports what the receiver answered.
   */
  async testSend(
    id: string,
    actorMemberId: string | null,
    now = Date.now(),
  ): Promise<WorkflowWebhookTestOutcome> {
    this.readCipher();

    const row = await this.readRow(id);

    this.acquireTestSend(row.id, now);

    const outcome = await this.deliveryService.sendTestEvent(
      { endpoint: this.databaseSource.toEndpoint(row), source: 'DATABASE' },
      readSampleEvent(row, new Date(now)),
    );

    await this.audit(
      row.id,
      WorkflowWebhookEndpointAuditActionEnum.TEST_SENT,
      [],
      actorMemberId,
    );

    return outcome;
  }

  private acquireTestSend(endpointId: string, now: number): void {
    const recent = (this.testSends.get(endpointId) ?? []).filter(
      (sentAt) => now - sentAt < WORKFLOW_WEBHOOK_TEST_WINDOW_MS,
    );
    const last = recent[recent.length - 1];

    if (
      (last !== undefined &&
        now - last < WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS) ||
      recent.length >= WORKFLOW_WEBHOOK_TEST_MAX_PER_WINDOW
    ) {
      throw new BPMWorkflowWebhookException(
        BPM_WORKFLOW_WEBHOOK_ERROR_CODES.TEST_RATE_LIMITED,
        `wait before testing this endpoint again (at most one test every ${WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS / 1000} s and ${WORKFLOW_WEBHOOK_TEST_MAX_PER_WINDOW} per ${WORKFLOW_WEBHOOK_TEST_WINDOW_MS / 60_000} minutes)`,
      );
    }

    this.testSends.set(endpointId, [...recent, now]);
  }

  private readCipher(): WorkflowWebhookSecretCipher {
    if (!this.isEnabled() || !this.options.secretEncryptionKey) {
      throw new BPMWorkflowWebhookException(
        BPM_WORKFLOW_WEBHOOK_ERROR_CODES.DATABASE_SOURCE_DISABLED,
        'database webhook endpoints are not enabled on this server',
      );
    }

    return new WorkflowWebhookSecretCipher(this.options.secretEncryptionKey);
  }

  private async readRow(id: string): Promise<WorkflowWebhookEndpointEntity> {
    const row = await this.endpointRepository.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException(`Webhook endpoint ${id} was not found`);
    }

    return row;
  }

  private readUrl(value: string): string {
    const url = value.trim();
    const parsed = ((): URL | null => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();

    assertEndpoint(
      parsed !== null &&
        (parsed.protocol === 'https:' || parsed.protocol === 'http:'),
      'url must be an absolute http(s) URL',
    );
    assertEndpoint(
      !parsed?.username && !parsed?.password,
      'url must not carry credentials; use a header instead',
    );

    if (!isWorkflowWebhookUrlAllowed(url, this.options.allowedUrlPatterns)) {
      throw new BPMWorkflowWebhookException(
        BPM_WORKFLOW_WEBHOOK_ERROR_CODES.URL_NOT_ALLOWED,
        'url is not allowed by workflowWebhookAllowedUrlPatterns',
      );
    }

    return url;
  }

  private encryptHeaders(
    cipher: WorkflowWebhookSecretCipher,
    headers: readonly WorkflowWebhookEndpointHeaderData[],
  ): string | null {
    assertEndpoint(
      headers.length <= MAX_HEADERS,
      `at most ${MAX_HEADERS} headers`,
    );

    const entries = headers.map((header): [string, string] => {
      const name = header.name.trim();

      assertEndpoint(
        HEADER_NAME_PATTERN.test(name),
        'a header name is invalid',
      );
      // Messages name the header, never its value.
      assertEndpoint(
        !name.toLowerCase().startsWith('x-bpm-') &&
          !RESERVED_HEADERS.has(name.toLowerCase()),
        `header "${name}" is set by BPM and cannot be configured`,
      );
      assertEndpoint(
        typeof header.value === 'string' &&
          header.value.length <= MAX_HEADER_VALUE_LENGTH &&
          HEADER_VALUE_PATTERN.test(header.value),
        `header "${name}" has an invalid value`,
      );

      return [name, header.value];
    });
    const names = entries.map(([name]) => name.toLowerCase());

    assertEndpoint(
      new Set(names).size === names.length,
      'header names must be unique',
    );

    return entries.length
      ? cipher.encrypt(JSON.stringify(Object.fromEntries(entries)))
      : null;
  }

  private encryptSecret(
    cipher: WorkflowWebhookSecretCipher,
    secret: string | null | undefined,
  ): string | null {
    if (!secret) {
      return null;
    }

    assertEndpoint(
      secret.length <= MAX_SECRET_LENGTH,
      `signingSecret must be at most ${MAX_SECRET_LENGTH} characters`,
    );

    return cipher.encrypt(secret);
  }

  private async audit(
    endpointId: string,
    action: WorkflowWebhookEndpointAuditActionEnum,
    changedFields: readonly string[],
    actorMemberId: string | null,
  ): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        action,
        actorMemberId,
        changedFields: [...new Set(changedFields)].sort(),
        endpointId,
      }),
    );
  }
}

/**
 * The header names of a stored endpoint, for the admin view. Decrypting the
 * envelope is the only way to know them; the values are dropped at once.
 */
export function readWorkflowWebhookHeaderNames(
  row: WorkflowWebhookEndpointEntity,
  secretEncryptionKey: string | null,
): readonly string[] {
  if (!row.encryptedHeaders || !secretEncryptionKey) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(
      new WorkflowWebhookSecretCipher(secretEncryptionKey).decrypt(
        row.encryptedHeaders,
      ),
    );

    return typeof parsed === 'object' && parsed !== null
      ? Object.keys(parsed).sort()
      : [];
  } catch {
    return [];
  }
}

function assertEndpoint(condition: boolean, detail: string): void {
  if (!condition) {
    throw new BPMWorkflowWebhookException(
      BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_INVALID,
      detail,
    );
  }
}

function isGiven<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function readRequiredText(value: string, field: string, max: number): string {
  const text = value.trim();

  assertEndpoint(
    text.length > 0 && text.length <= max,
    `${field} must be 1–${max} characters`,
  );

  return text;
}

function readOptionalText(
  value: string | null | undefined,
  field: string,
  max: number,
): string | null {
  const text = value?.trim() ?? '';

  assertEndpoint(
    text.length <= max,
    `${field} must be at most ${max} characters`,
  );

  return text || null;
}

function readMethod(value: string | null | undefined): string {
  const method = (value ?? 'POST').trim().toUpperCase();

  assertEndpoint(
    METHODS.some((candidate) => candidate === method),
    'method must be POST, PUT or PATCH',
  );

  return method;
}

function readTimeout(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  assertEndpoint(
    Number.isInteger(value) &&
      value > 0 &&
      value <= WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS,
    `timeoutMs must be an integer between 1 and ${WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS}`,
  );

  return value;
}

function readParameters(
  parameters: readonly WorkflowWebhookEndpointParameterData[],
): readonly WorkflowWebhookStoredParameter[] {
  const stored = parameters.map((parameter) => {
    const key = parameter.key.trim();

    assertEndpoint(
      KEY_PATTERN.test(key),
      'a parameter key must be 1–100 letters, digits, ".", "_", ":" or "-"',
    );
    assertEndpoint(
      PARAMETER_TYPES.includes(parameter.type),
      `parameter "${key}" has an unsupported type`,
    );

    return {
      description: readOptionalText(
        parameter.description,
        `parameter "${key}" description`,
        500,
      ),
      key,
      label: readRequiredText(parameter.label, `parameter "${key}" label`, 200),
      required: Boolean(parameter.required),
      type: parameter.type,
    };
  });
  const keys = stored.map((parameter) => parameter.key);

  assertEndpoint(
    new Set(keys).size === keys.length,
    'parameter keys must be unique',
  );

  return stored;
}

/** Order-independent: jsonb does not keep an object's key order. */
function describeParameters(
  parameters: readonly WorkflowWebhookStoredParameter[],
): string {
  return JSON.stringify(
    [...parameters]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((parameter) => [
        parameter.key,
        parameter.type,
        parameter.required,
        parameter.label,
        parameter.description ?? null,
      ]),
  );
}

function readOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function readDatabaseErrorCode(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null
      ? ((
          error as {
            readonly code?: unknown;
            readonly driverError?: { readonly code?: unknown };
          }
        ).code ??
        (error as { readonly driverError?: { readonly code?: unknown } })
          .driverError?.code)
      : null;

  return typeof code === 'string' ? code : null;
}

function stableParameters(
  parameters: readonly WorkflowWebhookStoredParameter[],
): string {
  return JSON.stringify(
    [...parameters]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((parameter) => [parameter.key, parameter.type, parameter.required]),
  );
}

function readSampleEvent(
  row: WorkflowWebhookEndpointEntity,
  occurredAt: Date,
): BPMWorkflowWebhookEvent {
  const samples: Readonly<Record<NotifyWebhookParameterType, unknown>> = {
    boolean: true,
    json: { sample: true },
    number: 1,
    string: 'sample',
    stringArray: ['sample'],
  };

  return {
    attempt: 1,
    deliveryId: `test-${randomUUID()}`,
    endpoint: { key: row.key, version: row.version },
    eventType: 'workflow.notify',
    initiator: { memberId: 'test-member' },
    instance: {
      id: 'test-instance',
      templateId: 'test-template',
      templateVersionId: 'test-template-version',
      title: 'BPM Webhook 測試送出',
    },
    node: { id: 'test-node', label: '測試送出' },
    occurredAt: occurredAt.toISOString(),
    parameters: Object.fromEntries(
      row.parameters.map((parameter) => [
        parameter.key,
        samples[parameter.type],
      ]),
    ),
  };
}
