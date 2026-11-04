import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FileUploadFieldDefinition,
  FormDefinitionSchema,
  FormFieldValue,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import type { FormRendererValues } from '@rytass/bpm-core-client/form';
import {
  FileUploadFieldControl,
  readFileUploadSubmissionBlockMessage,
  type FileUploadFieldState,
  type FormRendererAttachment,
} from './file-upload-field';
import { FormRenderer } from './FormRendererView';

// Deliberately NOT mocking `@mezzanine-ui/react`: the bug this guards against
// lives in how the real, fully controlled `Upload` treats a missing `files`
// prop, which a mock would only restate.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const UPLOADED_ID = '11111111-2222-4333-8444-555555555555';
const EXISTING_ID = '99999999-8888-4777-8666-555555555555';

const field: FileUploadFieldDefinition = {
  fieldKey: 'attachment',
  label: '附件',
  required: false,
  type: 'file_upload',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * jsdom has no object URLs; the real `UploadItem` creates one to preview an
 * image and revokes it on unmount. Returns the restore function.
 */
function stubObjectUrls(): () => void {
  const { createObjectURL, revokeObjectURL } = URL;

  URL.createObjectURL = (): string => 'blob:test';
  URL.revokeObjectURL = (): void => undefined;

  return (): void => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await delay(5);
    });
  }
}

async function selectFile(
  container: HTMLElement,
  name = 'evidence.jpg',
): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');

  if (!input) {
    throw new Error('file input not rendered');
  }

  const file = new File(['bpm'], name, { type: 'image/jpeg' });

  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function removeFile(container: HTMLElement, name: string): Promise<void> {
  // The trash icon of the list item that shows `name`.
  const trash = Array.from(
    container.querySelectorAll<HTMLElement>('[data-icon-name="TrashIcon"]'),
  ).find((icon): boolean => {
    let item = icon.parentElement;

    while (item && !item.textContent?.includes(name)) {
      item = item.parentElement;
    }

    return item?.querySelectorAll('[data-icon-name="TrashIcon"]').length === 1;
  });

  if (!trash) {
    throw new Error(`no delete control for ${name}`);
  }

  await act(async () => {
    trash.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

describe('FileUploadFieldControl', () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreObjectUrls: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    restoreObjectUrls = stubObjectUrls();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreObjectUrls();
  });

  function renderControl(
    initialValue: FormFieldValue | undefined,
    onUploadAttachment: (file: File) => Promise<{ readonly id: string }>,
    controlField: FileUploadFieldDefinition = field,
  ): { readonly values: (FormFieldValue | undefined)[] } {
    const values: (FormFieldValue | undefined)[] = [];

    function Host(): ReactElement {
      const [value, setValue] = useState<FormFieldValue | undefined>(
        initialValue,
      );

      return (
        <FileUploadFieldControl
          field={controlField}
          onChange={(nextValue): void => {
            values.push(nextValue);
            setValue(nextValue);
          }}
          onUploadAttachment={async (_field, file): Promise<{ id: string }> =>
            onUploadAttachment(file)
          }
          readonly={false}
          value={value}
        />
      );
    }

    act(() => root.render(<Host />));

    return { values };
  }

  it('keeps the uploaded attachment id after the upload resolves', async () => {
    const uploaded: string[] = [];
    const { values } = renderControl(undefined, async (file) => {
      await delay(20);
      uploaded.push(file.name);

      return { id: UPLOADED_ID };
    });

    await selectFile(container);

    expect(uploaded).toEqual(['evidence.jpg']);
    expect(values.at(-1)).toEqual([UPLOADED_ID]);
    expect(container.textContent).toContain('evidence.jpg');
  });

  it('never puts the temporary id of an in-flight upload into the value', async () => {
    const { values } = renderControl(undefined, async () => {
      await delay(20);

      return { id: UPLOADED_ID };
    });

    await selectFile(container);

    expect(
      values.flatMap((value) => (Array.isArray(value) ? value : [])),
    ).toEqual([UPLOADED_ID]);
  });

  it('leaves the value empty when the upload fails', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((): void => undefined);
    const { values } = renderControl(undefined, async () => {
      await delay(20);
      throw new Error('upload rejected');
    });

    await selectFile(container);

    // Nothing was attached, so nothing is emitted; the file stays listed as
    // failed instead of looking uploaded.
    expect(values.every((value) => value === undefined)).toBe(true);
    expect(container.textContent).toContain(
      'evidence.jpg：上傳失敗：upload rejected，未附加。請重試或刪除。',
    );
    consoleError.mockRestore();
  });

  it('carries ids already in the value when another file is added', async () => {
    const { values } = renderControl([EXISTING_ID], async () => {
      await delay(20);

      return { id: UPLOADED_ID };
    });

    await selectFile(container);

    expect(values.at(-1)).toEqual([EXISTING_ID, UPLOADED_ID]);
  });

  it('empties the value when the uploaded file is removed', async () => {
    const { values } = renderControl(undefined, async () => {
      await delay(20);

      return { id: UPLOADED_ID };
    });

    await selectFile(container);
    expect(values.at(-1)).toEqual([UPLOADED_ID]);

    await removeFile(container, 'evidence.jpg');

    expect(values.at(-1)).toBeUndefined();
    expect(container.textContent).not.toContain('evidence.jpg');
  });

  it('keeps a file removed while another upload runs out of the value', async () => {
    // `Upload` reports the second upload through the change handler of the
    // render the file was picked in, which still saw the first file.
    const ids: Readonly<Record<string, string>> = {
      'first.jpg': UPLOADED_ID,
      'second.jpg': EXISTING_ID,
    };
    let finishSecond: () => void = (): void => undefined;
    const { values } = renderControl(
      undefined,
      async (file) => {
        if (file.name === 'second.jpg') {
          await new Promise<void>((resolve) => {
            finishSecond = resolve;
          });
        }

        return { id: ids[file.name] };
      },
      { ...field, maxFiles: 3 },
    );

    await selectFile(container, 'first.jpg');
    expect(values.at(-1)).toEqual([UPLOADED_ID]);

    await selectFile(container, 'second.jpg');
    await removeFile(container, 'first.jpg');
    expect(values.at(-1)).toBeUndefined();

    await act(async () => {
      finishSecond();
    });
    await settle();

    expect(values.at(-1)).toEqual([EXISTING_ID]);
    expect(container.textContent).not.toContain('first.jpg');
  });
});

describe('FileUploadFieldControl, as the user sees it', () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreObjectUrls: () => void;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    restoreObjectUrls = stubObjectUrls();
    // `Upload` logs every failed upload.
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((): void => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreObjectUrls();
    consoleError.mockRestore();
  });

  interface HostOptions {
    readonly attachments?: readonly FormRendererAttachment[];
    readonly field?: FileUploadFieldDefinition;
    readonly initialValue?: FormFieldValue;
    /** Renders the host's value back one tick late, as a slow host would. */
    readonly lagging?: boolean;
    /** Never renders a change back, against the controlled contract. */
    readonly ignoreChanges?: boolean;
    readonly onDownloadAttachment?: (attachmentId: string) => void;
    readonly upload?: ((file: File) => Promise<{ readonly id: string }>) | null;
  }

  interface HostHandle {
    readonly setHostValue: (value: FormFieldValue | undefined) => void;
    /** Mounts or unmounts the control, as a field hidden by a condition. */
    readonly setShown: (shown: boolean) => void;
    readonly states: FileUploadFieldState[];
    readonly values: (FormFieldValue | undefined)[];
  }

  function renderHost(options: HostOptions = {}): HostHandle {
    const values: (FormFieldValue | undefined)[] = [];
    const states: FileUploadFieldState[] = [];
    let setHostValue: (value: FormFieldValue | undefined) => void = (): void =>
      undefined;
    let setShownState: (shown: boolean) => void = (): void => undefined;
    const upload =
      options.upload === undefined
        ? async (): Promise<{ id: string }> => {
            await delay(20);

            return { id: UPLOADED_ID };
          }
        : options.upload;

    function Host(): ReactElement {
      const [value, setValue] = useState<FormFieldValue | undefined>(
        options.initialValue,
      );

      const [shown, setShown] = useState(true);

      setHostValue = (next): void => setValue(next);
      setShownState = setShown;

      return !shown ? (
        <></>
      ) : (
        <FileUploadFieldControl
          attachments={options.attachments}
          field={options.field ?? field}
          onChange={(nextValue): void => {
            values.push(nextValue);

            if (options.ignoreChanges) {
              return;
            }

            if (options.lagging) {
              setTimeout((): void => setValue(nextValue), 30);
            } else {
              setValue(nextValue);
            }
          }}
          onStateChange={(state): void => {
            states.push(state);
          }}
          {...(options.onDownloadAttachment
            ? { onDownloadAttachment: options.onDownloadAttachment }
            : {})}
          {...(upload
            ? {
                onUploadAttachment: async (
                  _field: unknown,
                  file: File,
                ): Promise<{ readonly id: string }> => upload(file),
              }
            : {})}
          readonly={false}
          value={value}
        />
      );
    }

    act(() => root.render(<Host />));

    return {
      setHostValue: (value): void => act(() => setHostValue(value)),
      setShown: (shown): void => act(() => setShownState(shown)),
      states,
      values,
    };
  }

  function readFileInput(): HTMLInputElement {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');

    if (!input) {
      throw new Error('file input not rendered');
    }

    return input;
  }

  async function clickIcon(name: string): Promise<void> {
    const icon = container.querySelector<HTMLElement>(
      `[data-icon-name="${name}"]`,
    );

    if (!icon) {
      throw new Error(`no ${name} rendered`);
    }

    await act(async () => {
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }

  it('cannot upload, and says so, without an upload handler', async () => {
    const { values } = renderHost({ upload: null });

    expect(readFileInput().disabled).toBe(true);
    expect(container.textContent).toContain('此處無法上傳附件');

    // A browser never opens a disabled picker; jsdom still fires the event, so
    // this pins that even then nothing is listed as uploaded.
    await selectFile(container);

    expect(values).toEqual([]);
    expect(container.textContent).toContain('未附加');
  });

  it('lists an attachment the value already holds by its name and size', () => {
    renderHost({
      attachments: [
        { filename: '舊報價單.pdf', id: EXISTING_ID, sizeBytes: '2048' },
      ],
      initialValue: [EXISTING_ID],
    });

    expect(container.textContent).toContain('舊報價單.pdf');
    expect(container.textContent).toContain('2 KB');
    expect(container.textContent).not.toContain('0 B');
  });

  it('never shows an existing image attachment as a broken thumbnail', () => {
    renderHost({
      attachments: [{ filename: '收據.jpg', id: EXISTING_ID, sizeBytes: 10 }],
      initialValue: [EXISTING_ID],
    });

    expect(container.textContent).toContain('收據.jpg');
    expect(container.querySelector('img')).toBeNull();
  });

  it('lists an attachment it has no metadata for without inventing a name', () => {
    renderHost({ initialValue: [EXISTING_ID] });

    expect(container.textContent).toContain('無法讀取檔名的附件');
    expect(container.textContent).not.toContain(EXISTING_ID);
  });

  it('lets the filler remove an existing attachment', async () => {
    const { values } = renderHost({
      attachments: [{ filename: '舊報價單.pdf', id: EXISTING_ID, sizeBytes: 1 }],
      initialValue: [EXISTING_ID],
    });

    await removeFile(container, '舊報價單.pdf');

    expect(values.at(-1)).toBeUndefined();
    expect(container.textContent).not.toContain('舊報價單.pdf');
  });

  it('counts an existing attachment towards maxFiles', () => {
    renderHost({
      attachments: [{ filename: '舊報價單.pdf', id: EXISTING_ID, sizeBytes: 1 }],
      field: { ...field, maxFiles: 1 },
      initialValue: [EXISTING_ID],
    });

    // A single-file field that already holds one attachment takes no other.
    expect(readFileInput().disabled).toBe(true);
  });

  it('follows a value the host replaces, and does not bring a cleared file back', async () => {
    const ids: Readonly<Record<string, string>> = {
      'first.jpg': UPLOADED_ID,
      'second.jpg': EXISTING_ID,
    };
    const { setHostValue, values } = renderHost({
      field: { ...field, maxFiles: 3 },
      upload: async (file): Promise<{ id: string }> => {
        await delay(20);

        return { id: ids[file.name] ?? '' };
      },
    });

    await selectFile(container, 'first.jpg');
    expect(container.textContent).toContain('first.jpg');

    setHostValue(undefined);
    await settle();
    expect(container.textContent).not.toContain('first.jpg');

    await selectFile(container, 'second.jpg');

    expect(values.at(-1)).toEqual([EXISTING_ID]);
    expect(container.textContent).not.toContain('first.jpg');
  });

  it('keeps the value in the order the files were attached', async () => {
    const ids: Readonly<Record<string, string>> = {
      'b.jpg': UPLOADED_ID,
      'c.jpg': '22222222-2222-4333-8444-555555555555',
    };
    const { values } = renderHost({
      attachments: [{ filename: 'a.pdf', id: EXISTING_ID, sizeBytes: 1 }],
      field: { ...field, maxFiles: 3 },
      initialValue: [EXISTING_ID],
      upload: async (file): Promise<{ id: string }> => {
        await delay(20);

        return { id: ids[file.name] ?? '' };
      },
    });

    await selectFile(container, 'b.jpg');
    await selectFile(container, 'c.jpg');

    expect(values.at(-1)).toEqual([EXISTING_ID, ids['b.jpg'], ids['c.jpg']]);
  });

  it('keeps every finished upload while the host renders the value late', async () => {
    const ids: Readonly<Record<string, string>> = {
      'first.jpg': UPLOADED_ID,
      'second.jpg': EXISTING_ID,
    };
    const { values } = renderHost({
      field: { ...field, maxFiles: 3 },
      lagging: true,
      upload: async (file): Promise<{ id: string }> => {
        await delay(file.name === 'first.jpg' ? 10 : 15);

        return { id: ids[file.name] ?? '' };
      },
    });
    const input = readFileInput();

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File(['1'], 'first.jpg', { type: 'image/jpeg' }),
        new File(['2'], 'second.jpg', { type: 'image/jpeg' }),
      ],
    });
    input.multiple = true;
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(values.at(-1)).toEqual([UPLOADED_ID, EXISTING_ID]);
    expect(container.textContent).toContain('first.jpg');
    expect(container.textContent).toContain('second.jpg');
  });

  it('lists only what the host holds when the host does not take a change', async () => {
    const { values } = renderHost({ ignoreChanges: true });

    await selectFile(container);

    // The change was offered, but the value the host renders is the truth:
    // the field must not show a file the form will not submit.
    expect(values.at(-1)).toEqual([UPLOADED_ID]);
    expect(container.textContent).not.toContain('evidence.jpg');
  });

  it('ignores an upload that finishes after the field was hidden', async () => {
    let finish: () => void = (): void => undefined;
    const { setShown, states, values } = renderHost({
      upload: async (): Promise<{ id: string }> => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });

        return { id: UPLOADED_ID };
      },
    });

    await selectFile(container);
    expect(states.at(-1)).toEqual({ failedCount: 0, pendingCount: 1 });

    setShown(false);
    // Hidden, the field stops blocking the submit…
    expect(states.at(-1)).toEqual({ failedCount: 0, pendingCount: 0 });

    await act(async () => {
      finish();
    });
    await settle();

    // …and its late upload never writes into a field that is not shown.
    expect(values).toEqual([]);
  });

  it('lists files in the order they were picked while an earlier one still uploads', async () => {
    const ids: Readonly<Record<string, string>> = {
      'fast.jpg': EXISTING_ID,
      'slow.jpg': UPLOADED_ID,
    };
    let finishSlow: () => void = (): void => undefined;
    const { values } = renderHost({
      field: { ...field, maxFiles: 3 },
      upload: async (file): Promise<{ id: string }> => {
        if (file.name === 'slow.jpg') {
          await new Promise<void>((resolve) => {
            finishSlow = resolve;
          });
        } else {
          await delay(10);
        }

        return { id: ids[file.name] ?? '' };
      },
    });
    const listedNames = (): readonly string[] =>
      ['slow.jpg', 'fast.jpg']
        .map((name): [string, number] => [
          name,
          container.textContent?.indexOf(name) ?? -1,
        ])
        .filter(([, index]): boolean => index >= 0)
        .sort(([, left], [, right]): number => left - right)
        .map(([name]): string => name);

    await selectFile(container, 'slow.jpg');
    await selectFile(container, 'fast.jpg');

    // The later file finished first; it does not jump ahead of the earlier one.
    expect(listedNames()).toEqual(['slow.jpg', 'fast.jpg']);

    await act(async () => {
      finishSlow();
    });
    await settle();

    expect(listedNames()).toEqual(['slow.jpg', 'fast.jpg']);
    expect(values.at(-1)).toEqual([UPLOADED_ID, EXISTING_ID]);
  });

  it('downloads a listed attachment from the host, never as an empty local file', async () => {
    const createObjectUrl = jest.fn((): string => 'blob:test');
    const downloads: string[] = [];

    URL.createObjectURL = createObjectUrl;
    renderHost({
      attachments: [{ filename: '舊報價單.pdf', id: EXISTING_ID, sizeBytes: 1 }],
      initialValue: [EXISTING_ID],
      onDownloadAttachment: (attachmentId): void => {
        downloads.push(attachmentId);
      },
    });

    await clickIcon('DownloadIcon');

    expect(downloads).toEqual([EXISTING_ID]);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('does nothing for a listed attachment when the host cannot download', async () => {
    const createObjectUrl = jest.fn((): string => 'blob:test');

    URL.createObjectURL = createObjectUrl;
    renderHost({
      attachments: [{ filename: '舊報價單.pdf', id: EXISTING_ID, sizeBytes: 1 }],
      initialValue: [EXISTING_ID],
    });

    await clickIcon('DownloadIcon');

    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('downloads a file picked here from its own bytes', async () => {
    const downloads: string[] = [];
    const createObjectUrl = jest.fn((): string => 'blob:test');

    renderHost({
      onDownloadAttachment: (attachmentId): void => {
        downloads.push(attachmentId);
      },
    });
    await selectFile(container);
    URL.createObjectURL = createObjectUrl;
    const revokeObjectUrl = jest.fn();
    const clicks: (HTMLAnchorElement | null)[] = [];
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement): void {
        // Some browsers ignore a click on an anchor outside the document.
        clicks.push(this.isConnected ? this : null);
      });

    URL.revokeObjectURL = revokeObjectUrl;

    try {
      await clickIcon('DownloadIcon');

      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]?.download).toBe('evidence.jpg');
      // The download starts after `click` returns, so the URL must outlive
      // it — well past the rounds `clickIcon` waited through.
      expect(revokeObjectUrl).not.toHaveBeenCalled();
      expect(document.querySelector('a[download]')).toBeNull();
      expect(downloads).toEqual([]);
    } finally {
      click.mockRestore();
    }
  });

  it('reports an upload in flight, then the attachment it produced', async () => {
    const { states } = renderHost();

    await selectFile(container);

    expect(states.some((state) => state.pendingCount === 1)).toBe(true);
    expect(states.at(-1)).toEqual({
      failedCount: 0,
      pendingCount: 0,
    });
  });

  it('reports a failed upload, and clears it once a retry succeeds', async () => {
    let attempts = 0;
    const { states, values } = renderHost({
      upload: async (): Promise<{ id: string }> => {
        attempts += 1;
        await delay(20);

        if (attempts === 1) {
          throw new Error('network down');
        }

        return { id: UPLOADED_ID };
      },
    });

    await selectFile(container);
    expect(states.at(-1)?.failedCount).toBe(1);

    await clickIcon('ResetIcon');

    expect(attempts).toBe(2);
    expect(values.at(-1)).toEqual([UPLOADED_ID]);
    expect(states.at(-1)).toEqual({
      failedCount: 0,
      pendingCount: 0,
    });
    expect(container.textContent).not.toContain('上傳失敗');
  });

  it('keeps a retried upload that fails again listed as failed', async () => {
    const { states, values } = renderHost({
      upload: async (): Promise<{ id: string }> => {
        await delay(20);
        throw new Error('network down');
      },
    });

    await selectFile(container);
    await clickIcon('ResetIcon');

    // Without its own `onReload` the item would sit at "uploading" for good.
    expect(states.at(-1)).toMatchObject({ failedCount: 1, pendingCount: 0 });
    expect(values).toEqual([]);
  });
});

describe('readFileUploadSubmissionBlockMessage', () => {
  it('waits for an upload in flight before anything else', () => {
    expect(
      readFileUploadSubmissionBlockMessage([
        { failedCount: 1, pendingCount: 0 },
        { failedCount: 0, pendingCount: 1 },
      ]),
    ).toBe('附件仍在上傳中，請稍候再送出。');
  });

  it('asks for a failed upload to be retried or removed', () => {
    expect(
      readFileUploadSubmissionBlockMessage([{ failedCount: 1, pendingCount: 0 }]),
    ).toBe('有附件上傳失敗，請重試或移除後再送出。');
  });

  it('lets a settled form through', () => {
    expect(
      readFileUploadSubmissionBlockMessage([{ failedCount: 0, pendingCount: 0 }]),
    ).toBeNull();
  });
});

describe('FormRenderer file_upload field', () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreObjectUrls: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    restoreObjectUrls = stubObjectUrls();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreObjectUrls();
  });

  it('submits the attachment id the upload returned', async () => {
    const schema: FormDefinitionSchema = {
      fields: [field],
      schemaVersion: 1,
    } as FormDefinitionSchema;
    const uiSchema: FormUiSchema = {
      layout: [{ fieldKey: field.fieldKey, width: 'FULL' }],
      schemaVersion: 1,
    };
    const fieldPaths: string[] = [];
    let latest: FormRendererValues = {};

    function Host(): ReactElement {
      const [values, setValues] = useState<FormRendererValues>({});

      return (
        <FormRenderer
          onChange={(next): void => {
            latest = next;
            setValues(next);
          }}
          onUploadAttachment={async (uploadField): Promise<{ id: string }> => {
            fieldPaths.push(uploadField.fieldKey);
            await delay(20);

            return { id: UPLOADED_ID };
          }}
          schema={schema}
          uiSchema={uiSchema}
          value={values}
        />
      );
    }

    act(() => root.render(<Host />));
    await selectFile(container);

    expect(fieldPaths).toEqual([field.fieldKey]);
    expect(latest[field.fieldKey]).toEqual([UPLOADED_ID]);
  });
});
