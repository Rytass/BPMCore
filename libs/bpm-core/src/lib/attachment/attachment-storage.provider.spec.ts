import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AttachmentModule } from './attachment.module';
import { createLocalAttachmentStorage } from './attachment-storage.provider';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from './attachment-storage.token';

jest.mock('@rytass/storages-adapter-local', () => {
  const fs = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  const path = jest.requireActual<typeof import('path')>('path');

  class LocalStorage {
    private readonly directory: string;

    constructor(options: { readonly directory: string }) {
      this.directory = options.directory;
    }

    async write(
      file: Buffer,
      options: { readonly filename?: string } = {},
    ): Promise<{ readonly key: string }> {
      const filename = options.filename ?? 'file.bin';

      await fs.writeFile(path.join(this.directory, filename), file);

      return { key: filename };
    }
  }

  return { LocalStorage };
});

describe('createLocalAttachmentStorage', () => {
  it('creates nested local directories before writing adapter files', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'bpm-attachments-'));
    const storage = createLocalAttachmentStorage(directory);

    try {
      const storedFile = await storage.write(Buffer.from('hello'), {
        filename: 'instance-001/hello.pdf',
      });

      await expect(
        readFile(join(directory, 'instance-001', 'hello.pdf'), 'utf8'),
      ).resolves.toBe('hello');
      expect(storedFile.key).toBe('instance-001/hello.pdf');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('allows host applications to replace the attachment storage provider', (): void => {
    const customStorage: AttachmentStorage = {
      batchWrite: jest.fn(),
      converterManager: {} as AttachmentStorage['converterManager'],
      getBufferFilename: jest.fn(),
      getExtension: jest.fn(),
      getStreamFilename: jest.fn(),
      hashAlgorithm: 'sha256',
      isExists: jest.fn(),
      read: jest.fn(),
      remove: jest.fn(),
      write: jest.fn(),
    };
    const customStorageProvider = {
      provide: ATTACHMENT_STORAGE,
      useValue: customStorage,
    };
    const module = AttachmentModule.forRoot({
      storageProvider: customStorageProvider,
    });

    expect(module.providers).toContain(customStorageProvider);
  });
});
