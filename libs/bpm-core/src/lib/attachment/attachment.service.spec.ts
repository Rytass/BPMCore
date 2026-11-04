import { BadRequestException } from '@nestjs/common';
import {
  EntityManager,
  FindOperator,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskDecisionEntity } from '../workflow-engine/task-decision.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentStorage } from './attachment-storage.token';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';

// Only `fieldKey` and `type` decide which values name attachments.
const FILE_SCHEMA = {
  fields: [
    { fieldKey: 'file', type: 'file_upload' },
    { fieldKey: 'receipt', type: 'file_upload' },
    { fieldKey: 'items', type: 'table' },
    { fieldKey: 'unit', type: 'org_unit' },
  ],
  schemaVersion: 1,
} as unknown as FormDefinitionSchema;

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
      schema: FILE_SCHEMA,
    });

    expect(attachments[0]).toMatchObject({
      formFieldPath: 'form.file',
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });
  });

  // V1 has no `file_upload` column (ADR 16 §3.2), so a table's cells are
  // never read as attachment references.
  it('leaves table rows alone when looking for attachments', async (): Promise<void> => {
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
      schema: FILE_SCHEMA,
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
      schema: FILE_SCHEMA,
    });

    expect(attachments[0]).toMatchObject({
      instanceId: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    });
  });

  const BIND_INSTANCE_ID = '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce';
  const BIND_ATTACHMENT_ID = '11111111-2222-4333-8444-555555555555';

  function createBindFixture(attachment: Partial<AttachmentEntity>): {
    readonly attachments: AttachmentEntity[];
    readonly service: AttachmentService;
    readonly repository: Repository<AttachmentEntity>;
  } {
    const attachments: AttachmentEntity[] = [
      Object.assign(new AttachmentEntity(), {
        formFieldPath: 'form.file',
        id: BIND_ATTACHMENT_ID,
        instanceId: null,
        taskId: null,
        uploaderMemberId: 'member-001',
        ...attachment,
      }),
    ];
    const repository = createAttachmentRepository(attachments);

    return {
      attachments,
      repository,
      service: new AttachmentService(
        repository,
        createRepository<ApprovalInstanceEntity>({}),
        createRepository<TaskEntity>({}),
        createRepository<TaskCandidateEntity>({}),
        createRepository<TaskDecisionEntity>({}),
        createStorage(),
      ),
    };
  }

  it.each([
    [
      'the initiator',
      { initiatorMemberId: 'member-001', submittedByMemberId: null },
    ],
    [
      "the member who filed on the initiator's behalf",
      { initiatorMemberId: 'member-777', submittedByMemberId: 'member-001' },
    ],
  ])(
    'binds a free attachment uploaded by %s',
    async (
      _who: string,
      filers: Partial<ApprovalInstanceEntity>,
    ): Promise<void> => {
      const { attachments, repository, service } = createBindFixture({});

      await service.bindFormDataAttachmentsToInstance(
        createManager(repository, { id: BIND_INSTANCE_ID, ...filers }),
        {
          formData: { file: [BIND_ATTACHMENT_ID] },
          instanceId: BIND_INSTANCE_ID,
          schema: FILE_SCHEMA,
        },
      );

      expect(attachments[0]?.instanceId).toBe(BIND_INSTANCE_ID);
    },
  );

  it.each([
    [
      'a free attachment someone else uploaded, even with its id in hand',
      {},
      { initiatorMemberId: 'member-777', submittedByMemberId: null },
    ],
    [
      'an attachment that belongs to another case',
      { instanceId: '9e3fd0fc-cc1e-43f5-9601-017dd26ad8ce' },
      { initiatorMemberId: 'member-001', submittedByMemberId: null },
    ],
  ])(
    'refuses %s instead of saving the case without it',
    async (
      _what: string,
      attachment: Partial<AttachmentEntity>,
      filers: Partial<ApprovalInstanceEntity>,
    ): Promise<void> => {
      const { attachments, repository, service } =
        createBindFixture(attachment);
      const before = attachments[0]?.instanceId;
      const error = await service
        .bindFormDataAttachmentsToInstance(
          createManager(repository, { id: BIND_INSTANCE_ID, ...filers }),
          {
            formData: { file: [BIND_ATTACHMENT_ID] },
            instanceId: BIND_INSTANCE_ID,
            schema: FILE_SCHEMA,
          },
        )
        .then(
          (): unknown => undefined,
          (rejection: unknown): unknown => rejection,
        );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain(BIND_ATTACHMENT_ID);
      expect(attachments[0]?.instanceId).toBe(before);
    },
  );

  it('reads the case only when a free attachment needs judging', async (): Promise<void> => {
    const { repository, service } = createBindFixture({
      instanceId: BIND_INSTANCE_ID,
    });
    const instanceFindOne = jest.fn((): Promise<null> => Promise.resolve(null));
    const manager = {
      getRepository: (entity: unknown): unknown =>
        entity === ApprovalInstanceEntity
          ? { findOne: instanceFindOne }
          : repository,
    } as unknown as EntityManager;

    await service.bindFormDataAttachmentsToInstance(manager, {
      formData: { file: [BIND_ATTACHMENT_ID] },
      instanceId: BIND_INSTANCE_ID,
      schema: FILE_SCHEMA,
    });

    expect(instanceFindOne).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an attachment id with no row, such as a deleted file',
      '66666666-2222-4333-8444-555555555555',
    ],
    ['a value that is no attachment id', 'not-an-attachment'],
  ])(
    'refuses %s instead of saving the case with it',
    async (_what: string, value: string): Promise<void> => {
      const { attachments, repository, service } = createBindFixture({});
      const error = await service
        .bindFormDataAttachmentsToInstance(createManager(repository), {
          formData: { file: [BIND_ATTACHMENT_ID, value] },
          instanceId: BIND_INSTANCE_ID,
          schema: FILE_SCHEMA,
        })
        .then(
          (): unknown => undefined,
          (rejection: unknown): unknown => rejection,
        );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain(value);
      expect((error as Error).message).not.toContain(BIND_ATTACHMENT_ID);
      // Nothing is bound when one of the values is refused.
      expect(attachments[0]?.instanceId).toBeNull();
    },
  );

  // An org unit, a DataSource option or a text value can be a UUID that
  // happens to match an attachment; it does not name one.
  it('reads attachment ids from file_upload fields only', async (): Promise<void> => {
    const { attachments, repository, service } = createBindFixture({
      uploaderMemberId: 'member-777',
    });
    const find = jest.spyOn(repository, 'find');

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: {
        items: [{ ref: BIND_ATTACHMENT_ID }],
        note: BIND_ATTACHMENT_ID,
        unit: BIND_ATTACHMENT_ID,
      },
      instanceId: BIND_INSTANCE_ID,
      schema: FILE_SCHEMA,
    });

    expect(find).not.toHaveBeenCalled();
    expect(attachments[0]?.instanceId).toBeNull();
  });

  // A file released from one field and named again by another now belongs to
  // the second; the release on the next resubmit looks it up by that field.
  it('records the field that holds the file now', async (): Promise<void> => {
    const { attachments, repository, service } = createBindFixture({
      formFieldPath: 'form.file',
    });

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: { file: [], receipt: [BIND_ATTACHMENT_ID] },
      instanceId: BIND_INSTANCE_ID,
      schema: FILE_SCHEMA,
    });

    expect(attachments[0]).toMatchObject({
      formFieldPath: 'form.receipt',
      instanceId: BIND_INSTANCE_ID,
    });
  });

  it('takes an empty file_upload entry for no file', async (): Promise<void> => {
    const { attachments, repository, service } = createBindFixture({});

    await service.bindFormDataAttachmentsToInstance(createManager(repository), {
      formData: { file: [BIND_ATTACHMENT_ID, ''], receipt: '' },
      instanceId: BIND_INSTANCE_ID,
      schema: FILE_SCHEMA,
    });

    expect(attachments[0]?.instanceId).toBe(BIND_INSTANCE_ID);
  });

  it('releases only the form attachments the form data no longer refers to', async (): Promise<void> => {
    const instanceId = '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce';
    const kept = '11111111-2222-4333-8444-555555555555';
    const removed = '22222222-2222-4333-8444-555555555555';
    const taskFile = '33333333-2222-4333-8444-555555555555';
    const otherInstance = '44444444-2222-4333-8444-555555555555';
    // Attached to the case directly, not through a form field.
    const caseFile = '55555555-2222-4333-8444-555555555555';
    const attachments: AttachmentEntity[] = [
      { formFieldPath: 'form.file', id: kept, instanceId, taskId: null },
      { formFieldPath: 'form.file', id: removed, instanceId, taskId: null },
      { formFieldPath: null, id: taskFile, instanceId, taskId: 'task-1' },
      { formFieldPath: null, id: caseFile, instanceId, taskId: null },
      {
        formFieldPath: 'form.file',
        id: otherInstance,
        instanceId: '9e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
        taskId: null,
      },
    ].map((entity): AttachmentEntity =>
      Object.assign(new AttachmentEntity(), entity),
    );
    const repository = createAttachmentRepository(attachments);
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
      createRepository<TaskCandidateEntity>({}),
      createRepository<TaskDecisionEntity>({}),
      createStorage(),
    );

    await service.releaseUnreferencedFormAttachments(
      createManager(repository),
      { formData: { file: [kept] }, instanceId, schema: FILE_SCHEMA },
    );

    expect(
      attachments.map((attachment): [string, string | null] => [
        attachment.id,
        attachment.instanceId,
      ]),
    ).toEqual([
      [kept, instanceId],
      [removed, null],
      [taskFile, instanceId],
      [caseFile, instanceId],
      [otherInstance, '9e3fd0fc-cc1e-43f5-9601-017dd26ad8ce'],
    ]);
  });

  it.each([
    [
      'keeps the files of a field the submission leaves out',
      { receipt: [] },
      ['instance', 'instance'],
    ],
    [
      'releases every file of a field sent back empty',
      { file: [] },
      [null, null],
    ],
  ])(
    '%s',
    async (
      _what: string,
      formData: Readonly<Record<string, unknown>>,
      expected: readonly (string | null)[],
    ): Promise<void> => {
      const attachments: AttachmentEntity[] = [
        '11111111-2222-4333-8444-555555555555',
        '22222222-2222-4333-8444-555555555555',
      ].map((id): AttachmentEntity =>
        Object.assign(new AttachmentEntity(), {
          formFieldPath: 'form.file',
          id,
          instanceId: 'instance',
          taskId: null,
        }),
      );
      const repository = createAttachmentRepository(attachments);
      const service = new AttachmentService(
        repository,
        createRepository<ApprovalInstanceEntity>({}),
        createRepository<TaskEntity>({}),
        createRepository<TaskCandidateEntity>({}),
        createRepository<TaskDecisionEntity>({}),
        createStorage(),
      );

      await service.releaseUnreferencedFormAttachments(
        createManager(repository),
        { formData, instanceId: 'instance', schema: FILE_SCHEMA },
      );

      expect(
        attachments.map((attachment): string | null => attachment.instanceId),
      ).toEqual(expected);
    },
  );

  it.each([
    [
      'the requesting origin',
      'https://bpm.example.com',
      'https://bpm.example.com/attachments/',
    ],
    ['a root-relative path', null, '/attachments/'],
  ])(
    'builds an unconfigured public URL from %s',
    async (_label, requestOrigin, expectedPrefix): Promise<void> => {
      const attachments: AttachmentEntity[] = [];
      // No options injected: the service resolves its own defaults, including
      // a generated signing secret, and must still verify its own URLs.
      const service = new AttachmentService(
        createAttachmentRepository(attachments),
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

      const signedUrl = await service.createSignedUrl({
        disposition: 'inline',
        id: attachment.id,
        requestOrigin,
        requestedByMemberId: 'member-001',
      });
      const url = new URL(signedUrl, 'http://ignored.invalid');

      expect(
        signedUrl.startsWith(
          `${expectedPrefix}${attachment.id}/download?token=`,
        ),
      ).toBe(true);
      await expect(
        service.readSignedAttachment({
          disposition: 'inline',
          id: attachment.id,
          token: url.searchParams.get('token') ?? '',
        }),
      ).resolves.toMatchObject({ attachment });
    },
  );

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
  ])(
    'rejects a %s download token without leaking internals',
    async (_label, token): Promise<void> => {
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
    },
  );

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
    expect(url.pathname).toBe(`/internal/bpm/files/${attachment.id}/download`);
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

  it('lets the member who filed the instance for the applicant read its attachments', async (): Promise<void> => {
    const instanceId = '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce';
    const attachment = createAttachment({
      instanceId,
      uploaderMemberId: 'member-uploader',
    });
    const service = new AttachmentService(
      createAttachmentRepository([attachment]),
      createRepository<ApprovalInstanceEntity>({
        findOne: (): Promise<ApprovalInstanceEntity> =>
          Promise.resolve(
            Object.assign(new ApprovalInstanceEntity(), {
              id: instanceId,
              initiatorMemberId: 'member-initiator',
              submittedByMemberId: 'member-assistant',
            }),
          ),
      }),
      createRepository<TaskEntity>({
        find: (): Promise<readonly TaskEntity[]> => Promise.resolve([]),
      }),
      createRepository<TaskCandidateEntity>({
        find: (): Promise<readonly TaskCandidateEntity[]> =>
          Promise.resolve([]),
      }),
      createRepository<TaskDecisionEntity>({
        find: (): Promise<readonly TaskDecisionEntity[]> => Promise.resolve([]),
      }),
      createStorage(),
    );

    await expect(
      service.listAttachments({
        instanceId,
        requestedByMemberId: 'member-assistant',
      }),
    ).resolves.toEqual([attachment]);
    await expect(
      service.listAttachments({
        instanceId,
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

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    if (condition.type === 'isNull') {
      return value === null || value === undefined;
    }

    if (condition.type === 'in') {
      return (condition.value as readonly unknown[]).includes(value);
    }

    throw new Error(`unsupported operator ${condition.type}`);
  }

  return value === condition;
}

function createAttachmentRepository(
  attachments: AttachmentEntity[],
): Repository<AttachmentEntity> {
  const repository = {
    create: (entity: Partial<AttachmentEntity>): AttachmentEntity =>
      Object.assign(new AttachmentEntity(), entity),
    // Honours the `where` the service sends (`In`, `IsNull`, plain values),
    // so a test notices when the service stops narrowing its query.
    find: (
      options: { readonly where?: Readonly<Record<string, unknown>> } = {},
    ): Promise<readonly AttachmentEntity[]> =>
      Promise.resolve(
        attachments.filter((attachment): boolean =>
          Object.entries(options.where ?? {}).every(
            ([key, condition]): boolean =>
              matchesCondition(
                (attachment as unknown as Record<string, unknown>)[key],
                condition,
              ),
          ),
        ),
      ),
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

function createAttachment(value: Partial<AttachmentEntity>): AttachmentEntity {
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
  instance: Partial<ApprovalInstanceEntity> | null = {
    id: '8e3fd0fc-cc1e-43f5-9601-017dd26ad8ce',
    initiatorMemberId: 'member-001',
    submittedByMemberId: null,
  },
): EntityManager {
  return {
    getRepository: (entity: unknown): unknown =>
      entity === ApprovalInstanceEntity
        ? {
            findOne: (): Promise<Partial<ApprovalInstanceEntity> | null> =>
              Promise.resolve(instance),
          }
        : repository,
  } as unknown as EntityManager;
}
