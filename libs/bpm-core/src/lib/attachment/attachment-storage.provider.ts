import { Provider } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from './attachment-storage.token';

interface LocalStorageConstructor {
  new (options: {
    readonly autoMkdir: boolean;
    readonly directory: string;
  }): AttachmentStorage;
}

interface LocalStorageModule {
  readonly LocalStorage: LocalStorageConstructor;
}

/**
 * Default attachment storage used when the host registers none.
 *
 * Prefers a storage adapter handed to `BPMRootModule` as a runtime value
 * (`attachmentStorage`, which a `forRootAsync` factory can build once its
 * credentials are in hand) and otherwise writes to `.storage/attachments`
 * through `@rytass/storages-adapter-local`.
 *
 * `BPM_ROOT_OPTIONS` is injected optionally so `AttachmentModule` still
 * resolves when it is used on its own, outside `BPMRootModule`.
 */
export const attachmentStorageProvider: Provider<AttachmentStorage> = {
  inject: [{ optional: true, token: BPM_ROOT_OPTIONS }],
  provide: ATTACHMENT_STORAGE,
  useFactory: (
    rootOptions: BPMRootRuntimeOptions | undefined,
  ): AttachmentStorage =>
    rootOptions?.attachmentStorage ??
    createLocalAttachmentStorage(
      resolve(process.cwd(), '.storage', 'attachments'),
    ),
};

export function createLocalAttachmentStorage(
  directory: string,
): AttachmentStorage {
  const storageDirectory = resolve(directory);
  const LocalStorage = readLocalStorageConstructor();
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

function readLocalStorageConstructor(): LocalStorageConstructor {
  const adapter = require('@rytass/storages-adapter-local') as LocalStorageModule;

  return adapter.LocalStorage;
}
