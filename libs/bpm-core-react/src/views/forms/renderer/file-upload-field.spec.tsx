import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FileUploadFieldDefinition,
  FormDefinitionSchema,
  FormFieldValue,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import type { FormRendererValues } from '@rytass/bpm-core-client/form';
import { FileUploadFieldControl } from './file-upload-field';
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
  ): { readonly values: (FormFieldValue | undefined)[] } {
    const values: (FormFieldValue | undefined)[] = [];

    function Host(): ReactElement {
      const [value, setValue] = useState<FormFieldValue | undefined>(
        initialValue,
      );

      return (
        <FileUploadFieldControl
          field={field}
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

    expect(values.at(-1)).toBeUndefined();
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
