import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskDecisionEntity } from '../workflow-engine/task-decision.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentStorage } from './attachment-storage.token';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';

describe('AttachmentService', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('stores uploads through the configured storage adapter and binds form attachment ids to an instance', async (): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const storage = createStorage();
    const repository = createAttachmentRepository(attachments);
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      storage,
    );

    const attachment = await service.uploadAttachment({
      checksumSha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      contentBase64: Buffer.from('hello').toString('base64'),
      filename: 'hello.pdf',
      formFieldPath: 'form.file',
      instanceId: null,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      taskId: null,
      uploaderMemberId: 'member-001',
    });

    expect(storage.write).toHaveBeenCalledWith(expect.any(Buffer), {
      contentType: 'application/pdf',
      filename: `${attachment.id}/hello.pdf`,
    });

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: { file: [attachment.id] },
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });

    expect(attachments[0]).toMatchObject({
      formFieldPath: 'form.file',
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });
  });

  // Table rows are plain records, so the generic scan walks them without
  // special-casing. V1 has no `file_upload` column, so ordinary cell values
  // must not be mistaken for attachment references (ADR 16 §3.2).
  it('walks table rows without binding ordinary cell values as attachments', async (): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const repository = createAttachmentRepository(attachments);
    const find = jest.spyOn(repository, 'find');
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      createStorage(),
    );

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: {
        items: [
          { name: 'Bolt', qty: 3, tags: ['a', 'b'] },
          { name: 'Nut', qty: null },
        ],
      },
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });

    expect(find).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(0);
  });

  it('still finds an attachment id stored beside a table', async (): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const repository = createAttachmentRepository(attachments);
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      createStorage(),
    );

    const attachment = await service.uploadAttachment({
      checksumSha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      contentBase64: Buffer.from('hello').toString('base64'),
      filename: 'hello.pdf',
      formFieldPath: 'form.file',
      instanceId: null,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      taskId: null,
      uploaderMemberId: 'member-001',
    });

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: {
        file: [attachment.id],
        items: [{ name: 'Bolt', qty: 3 }],
      },
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });

    expect(attachments[0]).toMatchObject({
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });
  });

  it('builds signed URLs with configured public URL, TTL, and signing secret', async (): Promise<void> => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-05-15T10:00:00.000Z').getTime());
    const attachments: AttachmentEntity[] = [];
    const storage = createStorage();
    const repository = createAttachmentRepository(attachments);
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      storage,
      {
        publicBaseUrl: 'https://bpm.example.com',
        routePrefix: '/api/attachments',
        signedUrlSecret: 'attachment-secret',
        signedUrlTtlSeconds: 60,
        storageProviderId: 'local',
      },
    );

    const attachment = await service.uploadAttachment({
      checksumSha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      contentBase64: Buffer.from('hello').toString('base64'),
      filename: 'hello.pdf',
      formFieldPath: 'form.file',
      instanceId: null,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      taskId: null,
      uploaderMemberId: 'member-001',
    });
    const signedUrl = await service.createSignedUrl({
      disposition: 'inline',
      id: attachment.id,
      requestedByMemberId: 'member-001',
    });
    const url = new URL(signedUrl);

    await expect(
      service.readSignedAttachment({
        disposition: 'inline',
        id: attachment.id,
        token: url.searchParams.get('token') ?? '',
      }),
    ).resolves.toMatchObject({ attachment });
    expect(url.origin).toBe('https://bpm.example.com');
    expect(url.pathname).toBe(`/api/attachments/${attachment.id}/download`);
    expect(url.searchParams.get('disposition')).toBe('inline');
  });

  // A missing `?token=` used to reach `token.split('.')` and throw a raw
  // TypeError, which the global filter reported as a 500 carrying the
  // implementation detail. It now answers exactly like a wrong token: telling
  // them apart would reveal whether the attachment exists.
  it.each([
    ['missing', undefined as unknown as string],
    ['empty', ''],
    ['unsigned', 'no-dot-separator'],
    ['wrongly signed', 'body.badsignature'],
  ])('rejects a %s download token without leaking internals', async (
    _label,
    token,
  ): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const service = new AttachmentService(
      createAttachmentRepository(attachments),
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      createStorage(),
      {
        publicBaseUrl: 'https://bpm.example.com',
        routePrefix: '/attachments',
        signedUrlSecret: 'attachment-secret',
        signedUrlTtlSeconds: 60,
        storageProviderId: 'local',
      },
    );

    await expect(
      service.readSignedAttachment({
        disposition: 'inline',
        id: '11111111-1111-4111-8111-111111111111',
        token,
      }),
    ).rejects.toThrow('Attachment token is invalid');
  });

  it('records custom storage provider metadata and uses configured signed URL route prefix', async (): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const service = new AttachmentService(
      createAttachmentRepository(attachments),
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      createStorage(),
      {
        publicBaseUrl: 'https://bpm.example.com',
        routePrefix: '/internal/bpm/files',
        signedUrlSecret: 'attachment-secret',
        signedUrlTtlSeconds: 60,
        storageProviderId: 's3',
      },
    );

    const attachment = await service.uploadAttachment({
      checksumSha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      contentBase64: Buffer.from('hello').toString('base64'),
      filename: 'hello.pdf',
      formFieldPath: 'form.file',
      instanceId: null,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      taskId: null,
      uploaderMemberId: 'member-001',
    });
    const signedUrl = await service.createSignedUrl({
      disposition: 'attachment',
      id: attachment.id,
      requestedByMemberId: 'member-001',
    });
    const url = new URL(signedUrl);

    expect(attachment.storageProvider).toBe('s3');
    expect(url.pathname).toBe(
      `/internal/bpm/files/${attachment.id}/download`,
    );
  });

  it('allows workflow-related members to read instance attachments', async (): Promise<void> => {
    const attachment = createAttachment({
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
      uploaderMemberId: 'member-uploader',
    });
    const service = new AttachmentService(
      createAttachmentRepository([attachment]),
      createRepository<ApprovalInstanceEntity>({
        findOne: (): Promise<ApprovalInstanceEntity> =>
          Promise.resolve(
            Object.assign(new ApprovalInstanceEntity(), {
              id: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
              initiatorMemberId: 'member-initiator',
            }),
          ),
      }),
      createRepository<TaskEntity>({
        find: (): Promise<readonly TaskEntity[]> =>
          Promise.resolve([
            Object.assign(new TaskEntity(), {
              assigneeMemberId: 'member-assignee',
              id: 'task-1',
              instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
              originalAssigneeMemberId: 'member-original-assignee',
            }),
          ]),
      }),
      createRepository<TaskCandidateEntity>({
        find: (): Promise<readonly TaskCandidateEntity[]> =>
          Promise.resolve([
            Object.assign(new TaskCandidateEntity(), {
              memberId: 'member-candidate',
              originalMemberId: 'member-original-candidate',
              taskId: 'task-1',
            }),
          ]),
      }),
      createRepository<TaskDecisionEntity>({
        find: (): Promise<readonly TaskDecisionEntity[]> =>
          Promise.resolve([
            Object.assign(new TaskDecisionEntity(), {
              decidedByMemberId: 'member-decision-actor',
              taskId: 'task-1',
            }),
          ]),
      }),
      createStorage(),
    );

    await expect(
      service.listAttachments({
        instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
        requestedByMemberId: 'member-original-candidate',
      }),
    ).resolves.toEqual([attachment]);
    await expect(
      service.createSignedUrl({
        disposition: 'attachment',
        id: attachment.id,
        requestedByMemberId: 'member-decision-actor',
      }),
    ).resolves.toContain(`/attachments/${attachment.id}/download`);
    await expect(
      service.listAttachments({
        instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
        requestedByMemberId: 'member-unrelated',
      }),
    ).resolves.toEqual([]);
  });
});

function createStorage(): AttachmentStorage & {
  readonly write: jest.Mock;
} {
  return {
    batchWrite: jest.fn(),
    converterManager: {} as AttachmentStorage['converterManager'],
    getBufferFilename: jest.fn(),
    getExtension: jest.fn(),
    getStreamFilename: jest.fn(),
    hashAlgorithm: 'sha256',
    isExists: jest.fn(),
    read: jest.fn(),
    remove: jest.fn(),
    write: jest.fn((_buffer: Buffer, options: { readonly filename: string }) =>
      Promise.resolve({ key: options.filename }),
    ),
  };
}

function createAttachmentRepository(
  attachments: AttachmentEntity[],
): Repository<AttachmentEntity> {
  const repository = {
    create: (entity: Partial<AttachmentEntity>): AttachmentEntity =>
      Object.assign(new AttachmentEntity(), entity),
    find: (): Promise<readonly AttachmentEntity[]> =>
      Promise.resolve(attachments),
    findOne: ({
      where,
    }: {
      readonly where: { readonly id: string };
    }): Promise<AttachmentEntity | null> =>
      Promise.resolve(
        attachments.find((attachment) => attachment.id === where.id) ?? null,
      ),
    save: (
      entityOrEntities: AttachmentEntity | readonly AttachmentEntity[],
    ): Promise<AttachmentEntity | readonly AttachmentEntity[]> => {
      const entities = Array.isArray(entityOrEntities)
        ? entityOrEntities
        : [entityOrEntities];

      entities.forEach((entity) => {
        const currentIndex = attachments.findIndex(
          (attachment) => attachment.id === entity.id,
        );

        if (currentIndex === -1) {
          attachments.push(entity);
        } else {
          attachments[currentIndex] = entity;
        }
      });

      return Promise.resolve(entityOrEntities);
    },
  };

  return repository as unknown as Repository<AttachmentEntity>;
}

function createAttachment(
  value: Partial<AttachmentEntity>,
): AttachmentEntity {
  return Object.assign(new AttachmentEntity(), {
    checksumSha256:
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    createdAt: new Date('2026-05-15T10:00:00.000Z'),
    filename: 'hello.pdf',
    formFieldPath: 'form.file',
    id: '9dd3f2e8-6d7e-4f28-8801-f6859b25669e',
    instanceId: null,
    mimeType: 'application/pdf',
    sizeBytes: '5',
    storageKey: 'hello.pdf',
    storageProvider: 'local',
    taskId: null,
    uploaderMemberId: 'member-001',
    ...value,
  });
}

function createRepository<TEntity extends ObjectLiteral>(
  value: Readonly<Record<string, unknown>>,
): Repository<TEntity> {
  return value as unknown as Repository<TEntity>;
}

function createManager(
  repository: Repository<AttachmentEntity>,
): EntityManager {
  return {
    getRepository: (): Repository<AttachmentEntity> => repository,
  } as unknown as EntityManager;
}
