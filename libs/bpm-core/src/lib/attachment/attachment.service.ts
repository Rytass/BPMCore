import { createHash, createHmac, randomUUID } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from './attachment-storage.token';
import { AttachmentEntity } from './attachment.entity';
import { UploadAttachmentInput } from './dto/upload-attachment.input';

const STORAGE_PROVIDER = 'local';
const SIGNED_URL_TTL_SECONDS = 300;
const SIGNED_URL_KEY = 'bpm-core-local-attachment-url-key-v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AttachmentDisposition = 'attachment' | 'inline';

interface AttachmentTokenPayload {
  readonly disposition: AttachmentDisposition;
  readonly expiresAt: number;
  readonly id: string;
}

@Injectable()
export class AttachmentService {
  constructor(
    @InjectRepository(AttachmentEntity)
    private readonly attachmentRepository: Repository<AttachmentEntity>,
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
  ) {}

  async uploadAttachment(
    input: UploadAttachmentInput,
  ): Promise<AttachmentEntity> {
    const fileBuffer = Buffer.from(input.contentBase64, 'base64');

    if (fileBuffer.length !== input.sizeBytes) {
      throw new BadRequestException('Attachment size does not match payload');
    }

    const checksumSha256 = hashBuffer(fileBuffer);

    if (input.checksumSha256 && input.checksumSha256 !== checksumSha256) {
      throw new BadRequestException('Attachment checksum mismatch');
    }

    const id = randomUUID();
    const storageKey = buildStorageKey(id, input.filename);
    const storedFile = await this.storage.write(fileBuffer, {
      contentType: input.mimeType,
      filename: storageKey,
    });

    return this.attachmentRepository.save(
      this.attachmentRepository.create({
        checksumSha256,
        encryptionKeyId: null,
        filename: input.filename,
        formFieldPath: normalizeOptionalText(input.formFieldPath),
        id,
        instanceId: input.instanceId ?? null,
        mimeType: input.mimeType,
        sizeBytes: String(input.sizeBytes),
        storageKey: storedFile.key,
        storageProvider: STORAGE_PROVIDER,
        taskId: input.taskId ?? null,
        uploaderMemberId: input.uploaderMemberId.trim(),
      }),
    );
  }

  async listAttachments({
    formFieldPath = null,
    instanceId,
    requestedByMemberId = null,
    taskId = null,
  }: {
    readonly formFieldPath?: string | null;
    readonly instanceId: string;
    readonly requestedByMemberId?: string | null;
    readonly taskId?: string | null;
  }): Promise<readonly AttachmentEntity[]> {
    const attachments = await this.attachmentRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId,
        ...(formFieldPath ? { formFieldPath } : {}),
        ...(taskId ? { taskId } : {}),
      },
    });

    if (!requestedByMemberId) {
      return attachments;
    }

    const readableAttachments = await Promise.all(
      attachments.map(async (attachment): Promise<AttachmentEntity | null> => {
        try {
          await this.assertAttachmentReadableByMember(
            attachment,
            requestedByMemberId,
          );

          return attachment;
        } catch {
          return null;
        }
      }),
    );

    return readableAttachments.filter(
      (attachment): attachment is AttachmentEntity => attachment !== null,
    );
  }

  async bindFormDataAttachmentsToInstance(
    manager: EntityManager,
    {
      formData,
      instanceId,
    }: {
      readonly formData: Readonly<Record<string, unknown>>;
      readonly instanceId: string;
    },
  ): Promise<void> {
    const attachmentRefs = readAttachmentRefsFromFormData(formData);
    const ids = [...new Set(attachmentRefs.map((ref) => ref.id))];

    if (ids.length === 0) {
      return;
    }

    const attachmentRepository = manager.getRepository(AttachmentEntity);
    const attachments = await attachmentRepository.find({
      where: { id: In(ids) },
    });
    const refsById = new Map(attachmentRefs.map((ref) => [ref.id, ref]));
    const nextAttachments = attachments
      .filter(
        (attachment) =>
          attachment.instanceId === null ||
          attachment.instanceId === instanceId,
      )
      .map((attachment) => ({
        ...attachment,
        formFieldPath:
          attachment.formFieldPath ?? refsById.get(attachment.id)?.path ?? null,
        instanceId,
      }));

    if (nextAttachments.length > 0) {
      await attachmentRepository.save(nextAttachments);
    }
  }

  async createSignedUrl({
    disposition,
    id,
    requestedByMemberId,
  }: {
    readonly disposition: AttachmentDisposition;
    readonly id: string;
    readonly requestedByMemberId: string;
  }): Promise<string> {
    const attachment = await this.readAttachmentOrThrow(id);

    await this.assertAttachmentReadableByMember(
      attachment,
      requestedByMemberId,
    );

    if (disposition === 'inline' && attachment.mimeType !== 'application/pdf') {
      throw new BadRequestException('Only PDF attachments can be previewed');
    }

    const token = signAttachmentToken({
      disposition,
      expiresAt: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
      id,
    });

    return `${readApiPublicUrl()}/api/attachments/${id}/download?token=${encodeURIComponent(
      token,
    )}&disposition=${disposition}`;
  }

  async readSignedAttachment({
    disposition,
    id,
    token,
  }: {
    readonly disposition: AttachmentDisposition;
    readonly id: string;
    readonly token: string;
  }): Promise<{
    readonly attachment: AttachmentEntity;
    readonly buffer: Buffer;
  }> {
    const payload = verifyAttachmentToken(token);

    if (
      payload.id !== id ||
      payload.disposition !== disposition ||
      payload.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      throw new NotFoundException(`Attachment ${id} was not found`);
    }

    const attachment = await this.readAttachmentOrThrow(id);
    const buffer = await this.storage.read(attachment.storageKey, {
      format: 'buffer',
    });

    return { attachment, buffer };
  }

  private async readAttachmentOrThrow(id: string): Promise<AttachmentEntity> {
    const attachment = await this.attachmentRepository.findOne({
      where: { id },
    });

    if (!attachment) {
      throw new NotFoundException(`Attachment ${id} was not found`);
    }

    return attachment;
  }

  private async assertAttachmentReadableByMember(
    attachment: AttachmentEntity,
    requestedByMemberId: string,
  ): Promise<void> {
    if (attachment.uploaderMemberId === requestedByMemberId) {
      return;
    }

    const instance = attachment.instanceId
      ? await this.approvalInstanceRepository.findOne({
          where: { id: attachment.instanceId },
        })
      : null;

    if (instance?.initiatorMemberId === requestedByMemberId) {
      return;
    }

    const task = attachment.taskId
      ? await this.taskRepository.findOne({ where: { id: attachment.taskId } })
      : null;

    if (task?.assigneeMemberId === requestedByMemberId) {
      return;
    }

    throw new NotFoundException(`Attachment ${attachment.id} was not found`);
  }
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildStorageKey(id: string, filename: string): string {
  return `${id}/${sanitizeFilename(filename)}`;
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return sanitized || 'attachment.bin';
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function readAttachmentRefsFromFormData(
  formData: Readonly<Record<string, unknown>>,
): readonly { readonly id: string; readonly path: string }[] {
  return Object.entries(formData).flatMap(([fieldKey, value]) =>
    readAttachmentRefsFromValue(value, `form.${fieldKey}`),
  );
}

function readAttachmentRefsFromValue(
  value: unknown,
  path: string,
): readonly { readonly id: string; readonly path: string }[] {
  if (typeof value === 'string') {
    return UUID_PATTERN.test(value) ? [{ id: value, path }] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => readAttachmentRefsFromValue(entry, path));
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      readAttachmentRefsFromValue(entry, `${path}.${key}`),
    );
  }

  return [];
}

function signAttachmentToken(payload: AttachmentTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', SIGNED_URL_KEY)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

function verifyAttachmentToken(token: string): AttachmentTokenPayload {
  const [body, signature] = token.split('.');
  const expectedSignature = createHmac('sha256', SIGNED_URL_KEY)
    .update(body ?? '')
    .digest('base64url');

  if (!body || !signature || signature !== expectedSignature) {
    throw new NotFoundException('Attachment token is invalid');
  }

  const payload = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  ) as unknown;

  if (!isAttachmentTokenPayload(payload)) {
    throw new NotFoundException('Attachment token is invalid');
  }

  return payload;
}

function isAttachmentTokenPayload(
  value: unknown,
): value is AttachmentTokenPayload {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.expiresAt === 'number' &&
    (value.disposition === 'attachment' || value.disposition === 'inline')
  );
}

function readApiPublicUrl(): string {
  return (process.env.BPM_API_PUBLIC_URL ?? 'http://localhost:17603').replace(
    /\/+$/,
    '',
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
