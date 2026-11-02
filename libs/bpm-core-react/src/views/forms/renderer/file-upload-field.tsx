'use client';

import { ReactElement, useRef, useState } from 'react';
import { Upload } from '@mezzanine-ui/react';
import type { UploadFile } from '@mezzanine-ui/react/Upload';
import type {
  FileUploadFieldDefinition,
  FormFieldDefinition,
  FormFieldValue,
} from '@rytass/bpm-core-shared/form';

export interface FileUploadFieldControlProps {
  readonly field: FileUploadFieldDefinition;
  readonly onChange: (value: FormFieldValue | undefined) => void;
  readonly onUploadAttachment?: (
    field: FormFieldDefinition,
    file: File,
  ) => Promise<{ readonly id: string }>;
  readonly readonly: boolean;
  readonly value: FormFieldValue | undefined;
}

/**
 * The `file_upload` control.
 *
 * Mezzanine's `Upload` is fully controlled: it renders `files` and, on every
 * render, resets its own working list back to that prop. It never keeps an
 * uploaded file by itself. So the list has to live here and be passed back,
 * otherwise the file disappears the moment the form re-renders and the upload
 * that resolves afterwards maps over an empty list — the field value ends up
 * empty, the attachment is never bound to the instance, and the filler sees
 * nothing after uploading.
 *
 * The field value carries attachment ids only (the backend binds attachments
 * by the UUIDs it finds in the form data). Ids already in the value that were
 * not uploaded through this control — a resubmitted instance, a default — have
 * no `File` to show, so they are carried through unchanged rather than dropped
 * when a new file is added.
 */
export function FileUploadFieldControl({
  field,
  onChange,
  onUploadAttachment,
  readonly,
  value,
}: FileUploadFieldControlProps): ReactElement {
  const [files, setFiles] = useState<UploadFile[]>([]);
  // Ids this control produced. Anything else in `value` was there before.
  const ownIdsRef = useRef<ReadonlySet<string>>(new Set());

  function handleChange(nextFiles: UploadFile[]): void {
    setFiles(nextFiles);

    // A file still uploading, or one that failed, holds a temporary id that is
    // not an attachment; only finished uploads belong in the form data.
    const uploadedIds = nextFiles
      .filter((file) => file.status === 'done')
      .map((file) => file.id);
    const carriedIds = readStringIds(value).filter(
      (id) => !ownIdsRef.current.has(id),
    );

    ownIdsRef.current = new Set(nextFiles.map((file) => file.id));

    const nextIds = [...carriedIds, ...uploadedIds];

    onChange(nextIds.length ? nextIds : undefined);
  }

  return (
    <Upload
      accept={field.acceptedMimeTypes?.join(',')}
      disabled={readonly}
      files={files}
      maxFiles={field.maxFiles}
      mode="button-list"
      {...((field.maxFiles ?? 1) > 1 ? { multiple: true } : {})}
      onChange={handleChange}
      onUpload={async (selectedFiles): Promise<UploadFile[]> =>
        Promise.all(
          selectedFiles.map(async (file): Promise<UploadFile> => {
            const uploadedFile = onUploadAttachment
              ? await onUploadAttachment(field, file)
              : { id: `${file.name}-${file.lastModified}` };

            return {
              file,
              id: uploadedFile.id,
              progress: 100,
              status: 'done',
            };
          }),
        )
      }
      size="sub"
    />
  );
}

function readStringIds(value: FormFieldValue | undefined): readonly string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
