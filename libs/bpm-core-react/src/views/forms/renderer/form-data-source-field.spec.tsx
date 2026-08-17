import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  previewFormFieldOptions,
  type FormDataSourceOptionsResultRecord,
} from '@rytass/bpm-core-client/form';
import {
  readFormDataSourceFieldStatusMessage,
  useFormDataSourceField,
  type FormDataSourceFieldState,
  type UseFormDataSourceFieldInput,
} from './form-data-source-field';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@rytass/bpm-core-client/form', (): typeof import('@rytass/bpm-core-client/form') => {
  const actual = jest.requireActual(
    '@rytass/bpm-core-client/form',
  ) as typeof import('@rytass/bpm-core-client/form');

  return {
    ...actual,
    previewFormFieldOptions: jest.fn(),
    readFormFieldOptions: jest.fn(),
  };
});

const previewOptionsMock = previewFormFieldOptions as jest.MockedFunction<
  typeof previewFormFieldOptions
>;

interface HookHarnessProps {
  readonly input: UseFormDataSourceFieldInput;
}

interface MountedHookHarness {
  readonly current: () => FormDataSourceFieldState;
  readonly rerender: (input: UseFormDataSourceFieldInput) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

const mountedHarnesses: MountedHookHarness[] = [];

describe('useFormDataSourceField', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  afterEach(async (): Promise<void> => {
    await Promise.all(
      mountedHarnesses.splice(0).map((harness) => harness.unmount()),
    );
  });

  it('waits for required field bindings without querying', (): void => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
    ]);
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    expect(harness.current().status).toBe('WAITING_FOR_DEPENDENCIES');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBe(
      '請先填寫相依欄位。',
    );
    expect(previewOptionsMock).not.toHaveBeenCalled();
  });

  it('supersedes an older search response', async (): Promise<void> => {
    const field = createField('autocomplete');
    let resolveFirst: ((result: FormDataSourceOptionsResultRecord) => void) | null =
      null;
    let resolveSecond: ((result: FormDataSourceOptionsResultRecord) => void) | null =
      null;
    previewOptionsMock
      .mockImplementationOnce(
        (): Promise<FormDataSourceOptionsResultRecord> =>
          new Promise((resolve): void => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        (): Promise<FormDataSourceOptionsResultRecord> =>
          new Promise((resolve): void => {
            resolveSecond = resolve;
          }),
      );

    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    act((): void => {
      harness.current().onSearch('old');
      harness.current().onSearch('new');
    });

    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
    await act(async (): Promise<void> => {
      resolveSecond?.(createOptionsResult('new'));
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.status === 'VALID');

    await act(async (): Promise<void> => {
      resolveFirst?.(createOptionsResult('old'));
      await Promise.resolve();
    });
    expect(harness.current().options).toEqual([
      { label: 'new', value: 'new' },
    ]);
  });

  it('shows mapped copy instead of a raw error code when a query fails', async (): Promise<void> => {
    const field = createField('select');
    previewOptionsMock.mockRejectedValue(
      new Error('FORM_DATA_SOURCE_PROVIDER_FAILURE'),
    );
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'UNAVAILABLE');
    expect(harness.current().error).toBe('選項來源目前無法回應，請稍後再試。');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).not.toContain(
      'FORM_DATA_SOURCE',
    );
  });

  it('marks partial multiple values invalid without dropping them', async (): Promise<void> => {
    const field = createField('checkbox');
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: { choices: ['A', 'MISSING'] },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'INVALID');
    expect(harness.current().invalidValues).toEqual(['MISSING']);
    expect(harness.current().hasValue).toBe(true);
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toContain(
      'MISSING',
    );
  });

  it('does not query a read-only instance and hydrates its snapshot', async (): Promise<void> => {
    const field = createField('select');
    const harness = mountHookHarness({
      field,
      formData: { choice: 'A' },
      optionSnapshots: {
        choice: {
          bindingHash: 'hash',
          dataSourceKey: 'demo.options',
          dataSourceVersion: 1,
          options: [{ label: '歷史標籤', value: 'A' }],
          validatedAt: '2026-08-12T00:00:00.000Z',
        },
      },
      readonly: true,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(harness.current().options).toEqual([
      { label: '歷史標籤', value: 'A' },
    ]);
    expect(previewOptionsMock).not.toHaveBeenCalled();
  });
});

function mountHookHarness(input: UseFormDataSourceFieldInput): MountedHookHarness {
  let currentState: FormDataSourceFieldState | null = null;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  function HookHarness({ input: nextInput }: HookHarnessProps): ReactElement {
    currentState = useFormDataSourceField(nextInput);

    return <></>;
  }

  act((): void => {
    root.render(<HookHarness input={input} />);
  });

  const harness: MountedHookHarness = {
    current: (): FormDataSourceFieldState => {
      if (!currentState) {
        throw new Error('Hook has not rendered yet.');
      }

      return currentState;
    },
    rerender: async (nextInput): Promise<void> => {
      await act(async (): Promise<void> => {
        root.render(<HookHarness input={nextInput} />);
      });
    },
    unmount: async (): Promise<void> => {
      await act(async (): Promise<void> => {
        root.unmount();
      });
      container.remove();
    },
  };
  mountedHarnesses.push(harness);

  return harness;
}

async function waitForState(
  harness: MountedHookHarness,
  predicate: (state: FormDataSourceFieldState) => boolean,
): Promise<void> {
  const timeoutAt = Date.now() + 1000;

  while (!predicate(harness.current())) {
    if (Date.now() > timeoutAt) {
      throw new Error('Timed out waiting for hook state.');
    }

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve): void => {
        setTimeout(resolve, 0);
      });
    });
  }
}

function createField(
  type: FormDataSourceOptionFieldDefinition['type'],
  bindings: FormDataSourceOptionFieldDefinition['dataSource']['bindings'] = [],
): FormDataSourceOptionFieldDefinition {
  return {
    dataSource: {
      bindings,
      key: 'demo.options',
      version: 1,
    },
    fieldKey: type === 'checkbox' ? 'choices' : 'choice',
    label: 'Choice',
    mode: type === 'checkbox' ? undefined : 'single',
    required: false,
    type,
  } as FormDataSourceOptionFieldDefinition;
}

function createSchema(field: FormDataSourceOptionFieldDefinition): FormDefinitionSchema {
  return {
    fields: [field],
    schemaVersion: 1,
  };
}

function createUiSchema(): FormUiSchema {
  return {
    layout: [],
    schemaVersion: 1,
  };
}

function createOptionsResult(
  value: string,
): FormDataSourceOptionsResultRecord {
  return {
    dataSourceKey: 'demo.options',
    dataSourceVersion: 1,
    nextCursor: null,
    options: [{ label: value, value }],
  };
}
