'use client';

import {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Upload } from '@mezzanine-ui/react';
import type { UploadFile } from '@mezzanine-ui/react/Upload';
import type {
  FileUploadFieldDefinition,
  FormFieldDefinition,
  FormFieldValue,
} from '@rytass/bpm-core-shared/form';
import { readStringArrayValue } from './form-value-readers';

/**
 * What a `file_upload` field needs to know about an attachment it did not
 * upload itself (a resubmitted case, a stored instance) to list it. The shape
 * is a subset of `AttachmentRecord`, so a host passes its attachment list as is.
 */
export interface FormRendererAttachment {
  readonly filename: string;
  readonly id: string;
  readonly sizeBytes: number | string;
}

/**
 * Where a `file_upload` field stands, reported to the host through
 * `FormRenderer`'s `onFileUploadStateChange`.
 */
export interface FileUploadFieldState {
  /** Files that failed to upload. They are listed, but not in the value. */
  readonly failedCount: number;
  /** Display name of every attachment the value holds, by attachment id. */
  readonly fileNames: Readonly<Record<string, string>>;
  /** Files still uploading. They are listed, but not in the value yet. */
  readonly pendingCount: number;
}

/**
 * The copy to show when a submission is refused because a `file_upload` field
 * has not settled. An upload still running is a "wait a moment"; a failed one
 * needs the filler to retry or remove it. Returns `null` when nothing blocks.
 *
 * Without this check a submit made while a file is uploading sends the form
 * without that attachment, although the field lists the file.
 */
export function readFileUploadSubmissionBlockMessage(
  states: readonly Pick<FileUploadFieldState, 'failedCount' | 'pendingCount'>[],
): string | null {
  if (states.some((state): boolean => state.pendingCount > 0)) {
    return '附件仍在上傳中，請稍候再送出。';
  }

  if (states.some((state): boolean => state.failedCount > 0)) {
    return '有附件上傳失敗，請重試或移除後再送出。';
  }

  return null;
}

export interface FileUploadFieldStates {
  /** `readFileUploadSubmissionBlockMessage` over every field reported so far. */
  readonly blockMessage: string | null;
  /** Display name of every attachment the fields hold, by attachment id. */
  readonly fileNames: Readonly<Record<string, string>>;
  /** Pass to `FormRenderer`'s `onFileUploadStateChange`. */
  readonly onFileUploadStateChange: (
    fieldKey: string,
    state: FileUploadFieldState,
  ) => void;
}

/**
 * Collects what a form's `file_upload` fields report, for a host that has to
 * refuse a submit while one of them is uploading or holds a failed upload.
 */
export function useFileUploadFieldStates(): FileUploadFieldStates {
  const [states, setStates] = useState<
    Readonly<Record<string, FileUploadFieldState>>
  >({});
  const onFileUploadStateChange = useCallback(
    (fieldKey: string, state: FileUploadFieldState): void =>
      setStates(
        (current): Readonly<Record<string, FileUploadFieldState>> => ({
          ...current,
          [fieldKey]: state,
        }),
      ),
    [],
  );
  const fileNames = useMemo(
    (): Readonly<Record<string, string>> =>
      Object.assign(
        {},
        ...Object.values(states).map(
          (state): Readonly<Record<string, string>> => state.fileNames,
        ),
      ) as Readonly<Record<string, string>>,
    [states],
  );

  return {
    blockMessage: readFileUploadSubmissionBlockMessage(Object.values(states)),
    fileNames,
    onFileUploadStateChange,
  };
}

export interface FileUploadFieldControlProps {
  /** Metadata for listing attachments this control did not upload. */
  readonly attachments?: readonly FormRendererAttachment[];
  readonly field: FileUploadFieldDefinition;
  readonly onChange: (value: FormFieldValue | undefined) => void;
  /** Opens an attachment the value holds. Without it, only files picked here download. */
  readonly onDownloadAttachment?: (attachmentId: string) => void;
  readonly onStateChange?: (state: FileUploadFieldState) => void;
  readonly onUploadAttachment?: (
    field: FormFieldDefinition,
    file: File,
  ) => Promise<{ readonly id: string }>;
  readonly readonly: boolean;
  readonly value: FormFieldValue | undefined;
}

const UNKNOWN_ATTACHMENT_NAME = '無法讀取檔名的附件';
const UPLOAD_UNAVAILABLE_HINT = '此處無法上傳附件';

/**
 * The `file_upload` control.
 *
 * Mezzanine's `Upload` is fully controlled: it renders `files` and, on every
 * render, resets its working list to that prop, so the list is built here.
 *
 * The field value — attachment ids — is the source of truth for what is
 * attached. The list shows, in value order, every id the value holds: a file
 * picked here by its own `File`, any other id from `attachments` (or as an
 * unnamed attachment when the host has no metadata for it). Uploads still
 * running and uploads that failed follow; they are not in the value, and the
 * host learns about them through `onStateChange` so it can refuse to submit.
 * Because every attachment is listed, each one can be removed and counts
 * towards `maxFiles`, and a value replaced by the host is what the list shows.
 *
 * `Upload` reports a finished upload through the `onChange` it captured when
 * the file was picked, i.e. a handler from an older render, so the handler
 * reads refs only. The ids it emits are the ids attached so far (`attachedIds`)
 * minus the ones the filler removed, plus the uploads that just finished —
 * never the stale render's list as a whole.
 *
 * Without `onUploadAttachment` nothing can be uploaded, so the control is
 * disabled and says so rather than listing a file no attachment stands behind.
 */
export function FileUploadFieldControl({
  attachments,
  field,
  onChange,
  onDownloadAttachment,
  onStateChange,
  onUploadAttachment,
  readonly,
  value,
}: FileUploadFieldControlProps): ReactElement {
  // Files picked here: uploads running or failed, and finished ones by id.
  const [pendingFiles, setPendingFiles] = useState<readonly UploadFile[]>([]);
  const [ownFiles, setOwnFiles] = useState<
    ReadonlyMap<string, UploadFile>
  >(() => new Map());
  const valueIds = readStringArrayValue(value);
  const valueKey = valueIds.join('\n');
  // What is attached: the host's value, until this control emits a newer one
  // the host has not rendered back yet.
  const attachedIdsRef = useRef<readonly string[]>(valueIds);
  const seenValueKeyRef = useRef(valueKey);

  if (seenValueKeyRef.current !== valueKey) {
    seenValueKeyRef.current = valueKey;
    attachedIdsRef.current = valueIds;
  }

  const attachedIds = attachedIdsRef.current;
  const attachmentsById = useMemo(
    (): ReadonlyMap<string, FormRendererAttachment> =>
      new Map(
        (attachments ?? []).map((attachment): [string, FormRendererAttachment] => [
          attachment.id,
          attachment,
        ]),
      ),
    [attachments],
  );
  const listedFileCache = useRef(new Map<string, UploadFile>());
  const files = useMemo(
    (): UploadFile[] => [
      ...attachedIds.map(
        (id): UploadFile =>
          ownFiles.get(id) ??
          readListedFile(listedFileCache.current, id, attachmentsById.get(id)),
      ),
      ...pendingFiles,
    ],
    [attachedIds, attachmentsById, ownFiles, pendingFiles],
  );
  // The list `Upload` works from; it changes between renders when `Upload`
  // emits, so removals are read against it rather than against `files`.
  const listRef = useRef<readonly UploadFile[]>(files);

  listRef.current = files;

  const canUpload = Boolean(onUploadAttachment) && !readonly;
  // `Upload` shows a file's `errorMessage` on picture cards only; in a list a
  // failed file would look like an uploaded one but for its retry icon.
  const hints = [
    ...(!readonly && !onUploadAttachment
      ? [{ label: UPLOAD_UNAVAILABLE_HINT, type: 'info' as const }]
      : []),
    ...pendingFiles
      .filter((file): boolean => file.status === 'error')
      .map((file): { label: string; type: 'error' } => ({
        label: `${file.file?.name ?? '檔案'}：${
          file.errorMessage ?? '上傳失敗'
        }，未附加。請重試或刪除。`,
        type: 'error',
      })),
  ];
  const fileNamesKey = files
    .filter((file): boolean => file.status === 'done')
    .map((file): string => `${file.id}\t${readListedFileName(file)}`)
    .join('\n');
  const pendingCount = pendingFiles.filter(
    (file): boolean => file.status === 'loading',
  ).length;
  const failedCount = pendingFiles.filter(
    (file): boolean => file.status === 'error',
  ).length;
  const onStateChangeRef = useRef(onStateChange);

  onStateChangeRef.current = onStateChange;

  useEffect((): void => {
    onStateChangeRef.current?.({
      failedCount,
      fileNames: Object.fromEntries(
        fileNamesKey
          ? fileNamesKey
              .split('\n')
              .map((line): [string, string] => {
                const [id = '', name = ''] = line.split('\t');

                return [id, name];
              })
          : [],
      ),
      pendingCount,
    });
  }, [failedCount, fileNamesKey, pendingCount]);

  // A field that unmounts (hidden by a condition) must stop blocking a submit.
  useEffect(
    (): (() => void) => (): void =>
      onStateChangeRef.current?.({
        failedCount: 0,
        fileNames: {},
        pendingCount: 0,
      }),
    [],
  );

  function handleChange(nextFiles: readonly UploadFile[]): void {
    const nextIds = new Set(nextFiles.map((file): string => file.id));
    const removedIds = new Set(
      listRef.current
        .filter(
          (file): boolean => file.status === 'done' && !nextIds.has(file.id),
        )
        .map((file): string => file.id),
    );
    const previousAttachedIds = attachedIdsRef.current;
    const keptIds = previousAttachedIds.filter(
      (id): boolean => !removedIds.has(id),
    );
    const keptIdSet = new Set(keptIds);
    const finishedFiles = nextFiles.filter(
      (file): boolean =>
        file.status === 'done' &&
        file.file !== undefined &&
        !keptIdSet.has(file.id) &&
        !isListedFile(file),
    );
    const nextAttachedIds = [
      ...keptIds,
      ...finishedFiles.map((file): string => file.id),
    ];

    listRef.current = nextFiles;
    attachedIdsRef.current = nextAttachedIds;
    setPendingFiles(
      nextFiles.filter((file): boolean => file.status !== 'done'),
    );

    if (finishedFiles.length > 0) {
      setOwnFiles(
        (current): ReadonlyMap<string, UploadFile> =>
          new Map([
            ...current,
            ...finishedFiles.map((file): [string, UploadFile] => [
              file.id,
              file,
            ]),
          ]),
      );
    }

    // A file picked but still uploading changes the list, not the value.
    if (nextAttachedIds.join('\n') !== previousAttachedIds.join('\n')) {
      onChange(nextAttachedIds.length ? nextAttachedIds : undefined);
    }
  }

  async function uploadFile(file: File): Promise<UploadFile> {
    if (!onUploadAttachment) {
      throw new Error(UPLOAD_UNAVAILABLE_HINT);
    }

    const uploaded = await onUploadAttachment(field, file);

    return { file, id: uploaded.id, progress: 100, status: 'done' };
  }

  async function handleReload(fileId: string, file: File): Promise<void> {
    // `Upload` has already listed the file as uploading again.
    const replacement = await uploadFile(file).catch(
      (error: unknown): UploadFile => ({
        errorMessage: readUploadErrorMessage(error),
        file,
        id: fileId,
        status: 'error',
      }),
    );

    handleChange(
      listRef.current.map(
        (entry): UploadFile => (entry.id === fileId ? replacement : entry),
      ),
    );
  }

  function handleDownload(fileId: string, file: File): void {
    // A file picked here holds the bytes that were uploaded.
    if (ownFiles.has(fileId)) {
      downloadLocalFile(file);

      return;
    }

    // A listed attachment's `File` is a name and size only; its content is
    // the host's to fetch, and without a host handler there is none to give.
    onDownloadAttachment?.(fileId);
  }

  return (
    <Upload
      accept={field.acceptedMimeTypes?.join(',')}
      disabled={!canUpload}
      files={files}
      {...(hints.length > 0 ? { hints } : {})}
      maxFiles={field.maxFiles}
      mode="button-list"
      {...((field.maxFiles ?? 1) > 1 ? { multiple: true } : {})}
      onChange={handleChange}
      onDownload={handleDownload}
      onReload={(fileId, file): void => {
        void handleReload(fileId, file);
      }}
      onUpload={async (selectedFiles): Promise<UploadFile[]> =>
        Promise.all(
          selectedFiles.map(
            async (file): Promise<UploadFile> =>
              uploadFile(file).catch(
                (error: unknown): UploadFile => ({
                  errorMessage: readUploadErrorMessage(error),
                  file,
                  // `Upload` maps results by position, so the id only has to
                  // be unique within this list.
                  id: `failed-${file.name}-${file.lastModified}-${Math.random()}`,
                  status: 'error',
                }),
              ),
          ),
        )
      }
      size="sub"
    />
  );
}

// Files that stand for an attachment the value holds but this control did not
// upload. Their `File` carries a name and size only, never content.
const listedFiles = new WeakSet<UploadFile>();

function isListedFile(file: UploadFile | undefined): boolean {
  return file !== undefined && listedFiles.has(file);
}

function readListedFile(
  cache: Map<string, UploadFile>,
  id: string,
  attachment: FormRendererAttachment | undefined,
): UploadFile {
  const name = attachment?.filename ?? null;
  const cached = cache.get(id);

  if (cached && readListedFileName(cached) === (name ?? UNKNOWN_ATTACHMENT_NAME)) {
    return cached;
  }

  const listed: UploadFile = attachment
    ? {
        file: createDisplayFile(attachment),
        id,
        progress: 100,
        status: 'done',
      }
    : {
        // Listed by name only: a `url` with no size or content behind it.
        id,
        progress: 100,
        status: 'done',
        url: UNKNOWN_ATTACHMENT_NAME,
      };

  listedFiles.add(listed);
  cache.set(id, listed);

  return listed;
}

/**
 * A content-less `File` that shows the attachment's real name and size. Its
 * type is left empty on purpose: an image type would make `Upload` render a
 * thumbnail from these empty bytes, a broken image.
 */
function createDisplayFile(attachment: FormRendererAttachment): File {
  const file = new File([], attachment.filename);
  const size = Number(attachment.sizeBytes);

  if (Number.isFinite(size) && size >= 0) {
    Object.defineProperty(file, 'size', { value: size });
  }

  return file;
}

function readListedFileName(file: UploadFile): string {
  return file.file?.name ?? file.url ?? '';
}

function readUploadErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? `上傳失敗：${error.message}`
    : '上傳失敗，請重試。';
}

function downloadLocalFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}
