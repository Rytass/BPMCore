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
      setStates((current): Readonly<Record<string, FileUploadFieldState>> => ({
        ...current,
        [fieldKey]: state,
      })),
    [],
  );
  return {
    blockMessage: readFileUploadSubmissionBlockMessage(Object.values(states)),
    onFileUploadStateChange,
  };
}

export interface FileUploadFieldControlProps {
  /** Metadata for listing attachments this control did not upload. */
  readonly attachments?: readonly FormRendererAttachment[];
  readonly field: FileUploadFieldDefinition;
  /**
   * Receives the attachment ids the field now holds. Like a controlled input,
   * the host renders the value back: the list shows the value it is given.
   */
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
 * Mezzanine's `Upload` is fully controlled: it renders `files` and resets its
 * working list to that prop after every render, so the list is built here.
 *
 * What is attached is the host's value, and only that: every id it holds is
 * listed — a file picked here by its own `File`, any other id by the name and
 * size in `attachments` (or as an unnamed attachment without them) — so each
 * one can be removed and counts towards `maxFiles`. Uploads still running and
 * uploads that failed are listed too, in the order `Upload` keeps, but are not
 * in the value; `onStateChange` reports them so the host can refuse a submit.
 *
 * The value emitted on a change is read off the list `Upload` hands back —
 * the finished files in it, in order — never off this control's state. That
 * list is `Upload`'s own working copy, which it updates the moment it emits,
 * so it is current even when two uploads finish before the host re-renders.
 * `Upload` calls the `onChange` it captured when a file was picked, so it is
 * given a stable function that forwards to the latest handler.
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
  // Uploads running or failed; they are listed but not attached.
  const [pendingFiles, setPendingFiles] = useState<readonly UploadFile[]>([]);
  // Files picked here that finished, by attachment id: they keep their bytes.
  const [ownFiles, setOwnFiles] = useState<ReadonlyMap<string, UploadFile>>(
    () => new Map(),
  );
  // The order `Upload` keeps its list in (picked order), by id.
  const [listOrder, setListOrder] = useState<readonly string[]>([]);
  const valueIds = readStringArrayValue(value);
  const valueKey = valueIds.join('\n');
  const attachmentsById = useMemo(
    (): ReadonlyMap<string, FormRendererAttachment> =>
      new Map(
        (attachments ?? []).map(
          (attachment): [string, FormRendererAttachment] => [
            attachment.id,
            attachment,
          ],
        ),
      ),
    [attachments],
  );
  const files = useMemo((): UploadFile[] => {
    const position = new Map(
      listOrder.map((id, index): [string, number] => [id, index]),
    );
    const listed = [
      ...valueIds.map(
        (id): UploadFile =>
          ownFiles.get(id) ?? createListedFile(id, attachmentsById.get(id)),
      ),
      ...pendingFiles,
    ];

    // Stable: what `Upload` has never listed keeps its place at the front.
    return [...listed].sort(
      (left, right): number =>
        (position.get(left.id) ?? -1) - (position.get(right.id) ?? -1),
    );
    // `valueKey` stands for `valueIds`, a new array on every render.
  }, [attachmentsById, listOrder, ownFiles, pendingFiles, valueKey]);
  // `Upload`'s working list as of now: what it last emitted, or `files` once
  // it has taken them in. Only a retry, which `Upload` does not run itself,
  // needs it.
  const uploadListRef = useRef<readonly UploadFile[]>(files);
  const mountedRef = useRef(true);
  const handleChangeRef = useRef(handleChange);

  handleChangeRef.current = handleChange;

  useEffect((): void => {
    uploadListRef.current = files;
  }, [files]);

  const stableOnChange = useCallback(
    (nextFiles: UploadFile[]): void => handleChangeRef.current(nextFiles),
    [],
  );
  const pendingCount = pendingFiles.filter(
    (file): boolean => file.status === 'loading',
  ).length;
  const failedCount = pendingFiles.filter(
    (file): boolean => file.status === 'error',
  ).length;
  const onStateChangeRef = useRef(onStateChange);

  onStateChangeRef.current = onStateChange;

  useEffect((): void => {
    onStateChangeRef.current?.({ failedCount, pendingCount });
  }, [failedCount, pendingCount]);

  // A field that unmounts (hidden by a condition) stops blocking a submit and
  // ignores uploads that finish afterwards: the field is no longer the form's.
  useEffect((): (() => void) => {
    mountedRef.current = true;

    return (): void => {
      mountedRef.current = false;
      onStateChangeRef.current?.({ failedCount: 0, pendingCount: 0 });
    };
  }, []);

  function handleChange(nextFiles: readonly UploadFile[]): void {
    if (!mountedRef.current) {
      return;
    }

    const finished = nextFiles.filter(
      (file): boolean => file.status === 'done',
    );
    const nextIds = finished.map((file): string => file.id);
    const attachedIds = new Set(valueIds);
    const justUploaded = finished.filter(
      (file): boolean => file.file !== undefined && !attachedIds.has(file.id),
    );

    uploadListRef.current = nextFiles;
    setListOrder(nextFiles.map((file): string => file.id));
    setPendingFiles(
      nextFiles.filter((file): boolean => file.status !== 'done'),
    );

    if (justUploaded.length > 0) {
      setOwnFiles(
        (current): ReadonlyMap<string, UploadFile> =>
          new Map([
            ...current,
            ...justUploaded.map((file): [string, UploadFile] => [
              file.id,
              file,
            ]),
          ]),
      );
    }

    // A file picked but still uploading changes the list, not the value.
    if (nextIds.join('\n') !== valueKey) {
      onChange(nextIds.length ? nextIds : undefined);
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

    handleChangeRef.current(
      uploadListRef.current.map((entry): UploadFile =>
        entry.id === fileId ? replacement : entry,
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

  return (
    <Upload
      accept={field.acceptedMimeTypes?.join(',')}
      disabled={!canUpload}
      files={files}
      {...(hints.length > 0 ? { hints } : {})}
      maxFiles={field.maxFiles}
      mode="button-list"
      {...((field.maxFiles ?? 1) > 1 ? { multiple: true } : {})}
      onChange={stableOnChange}
      onDownload={handleDownload}
      onReload={(fileId, file): void => {
        void handleReload(fileId, file);
      }}
      onUpload={async (selectedFiles): Promise<UploadFile[]> =>
        Promise.all(
          selectedFiles.map(async (file): Promise<UploadFile> =>
            uploadFile(file).catch((error: unknown): UploadFile => ({
              errorMessage: readUploadErrorMessage(error),
              file,
              // `Upload` maps results by position, so the id only has to
              // be unique within this list.
              id: `failed-${file.name}-${file.lastModified}-${Math.random()}`,
              status: 'error',
            })),
          ),
        )
      }
      size="sub"
    />
  );
}

/**
 * An attachment the value holds but this control did not upload. With
 * metadata it is listed by name and size through a content-less `File`;
 * without, by a placeholder name only.
 */
function createListedFile(
  id: string,
  attachment: FormRendererAttachment | undefined,
): UploadFile {
  return attachment
    ? { file: createDisplayFile(attachment), id, progress: 100, status: 'done' }
    : {
        // Listed by name only: a `url` with no size or content behind it.
        id,
        progress: 100,
        status: 'done',
        url: UNKNOWN_ATTACHMENT_NAME,
      };
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
  anchor.style.display = 'none';
  // Some browsers only download through an anchor in the document, and start
  // the download after `click` returns, so the URL outlives the click.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout((): void => URL.revokeObjectURL(url), 30_000);
}
