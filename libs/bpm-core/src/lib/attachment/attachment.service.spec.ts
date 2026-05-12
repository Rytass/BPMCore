import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentStorage } from './attachment-storage.token';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';

describe('AttachmentService', () => {
  it('stores uploads through the configured storage adapter and binds form attachment ids to an instance', async (): Promise<void> => {
    const attachments: AttachmentEntity[] = [];
    const storage = createStorage();
    const repository = createAttachmentRepository(attachments);
    const service = new AttachmentService(
      repository,
      createRepository<ApprovalInstanceEntity>({}),
      createRepository<TaskEntity>({}),
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
