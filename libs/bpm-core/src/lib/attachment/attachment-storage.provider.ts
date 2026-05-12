import { Provider } from '@nestjs/common';
import { LocalStorage } from '@rytass/storages-adapter-local';
import { mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from './attachment-storage.token';

export const attachmentStorageProvider: Provider<AttachmentStorage> = {
  provide: ATTACHMENT_STORAGE,
  useFactory: (): AttachmentStorage =>
    createLocalAttachmentStorage(
      resolve(process.cwd(), '.storage', 'attachments'),
    ),
};

export function createLocalAttachmentStorage(
  directory: string,
): AttachmentStorage {
  const storageDirectory = resolve(directory);
  const localStorage = new LocalStorage({
    autoMkdir: true,
    directory: storageDirectory,
  });
  const write: AttachmentStorage['write'] = async (
    file,
    options,
  ): ReturnType<AttachmentStorage['write']> => {
    if (options?.filename) {
      await mkdir(dirname(resolve(storageDirectory, options.filename)), {
        recursive: true,
      });
    }

    return localStorage.write(file, options);
  };

  return new Proxy(localStorage, {
    get: (target, property, receiver): unknown =>
      property === 'write' ? write : Reflect.get(target, property, receiver),
  }) as AttachmentStorage;
}
