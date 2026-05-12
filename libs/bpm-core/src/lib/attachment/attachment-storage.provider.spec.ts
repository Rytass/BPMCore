import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLocalAttachmentStorage } from './attachment-storage.provider';

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
});
