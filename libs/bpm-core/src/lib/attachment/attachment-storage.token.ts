import type { Storage } from '@rytass/storages';

export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

export type AttachmentStorage = Storage<Readonly<Record<string, unknown>>>;
