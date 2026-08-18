import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  previewFormFieldOptions,
  readFormFieldOptions,
  resolveFormFieldOptions,
  type FormDataSourceOptionsResultRecord,
} from '@rytass/bpm-core-client/form';
import {
  isFormDataSourceFieldSubmissionBlocked,
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
    previewResolveFormFieldOptions: jest.fn(),
    readFormFieldOptions: jest.fn(),
    resolveFormFieldOptions: jest.fn(),
  };
});

const previewOptionsMock = previewFormFieldOptions as jest.MockedFunction<
  typeof previewFormFieldOptions
>;
const runtimeOptionsMock = readFormFieldOptions as jest.MockedFunction<
  typeof readFormFieldOptions
>;
const runtimeResolveMock = resolveFormFieldOptions as jest.MockedFunction<
  typeof resolveFormFieldOptions
>;

const RUNTIME_CONTEXT = {
  instanceId: 'returned-instance-1',
  kind: 'runtime',
  templateId: 'template-1',
} as const;

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

  it('waits from the first paint and keeps waiting when the host confirms', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
    ]);
    previewOptionsMock.mockResolvedValue({
      ...createOptionsResult(),
      waitingForFieldKeys: ['plant'],
    });
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    // No optimistic "usable" frame before the answer arrives.
    expect(harness.current().status).toBe('WAITING_FOR_DEPENDENCIES');

    await flushAsync();
    await flushAsync();

    expect(previewOptionsMock).toHaveBeenCalledTimes(1);
    expect(harness.current().status).toBe('WAITING_FOR_DEPENDENCIES');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBe(
      '請先填寫相依欄位。',
    );
  });

  it('keeps the control usable when an unfilled binding is optional', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
      {
        from: { fieldKey: 'project', kind: 'FIELD' },
        parameter: 'project',
      },
    ]);
    // The host answers normally: `project` is bound to an optional parameter, so
    // leaving it empty is not a blocker even though the browser cannot tell.
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: { plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    expect(harness.current().status).toBe('WAITING_FOR_DEPENDENCIES');

    // The host answer is the authority, so the guess is released immediately.
    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);
    expect(harness.current().options).toEqual([{ label: 'A', value: 'A' }]);
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

  it('aborts a superseded request without reporting it as a failure', async (): Promise<void> => {
    const field = createField('autocomplete');
    previewOptionsMock
      .mockImplementationOnce(
        (input): Promise<FormDataSourceOptionsResultRecord> =>
          new Promise((_resolve, reject): void => {
            input.signal?.addEventListener('abort', (): void => {
              reject(new Error('The operation was aborted.'));
            });
          }),
      )
      .mockResolvedValue(createOptionsResult('new'));

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
    });
    act((): void => {
      harness.current().onSearch('new');
    });

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(harness.current().error).toBeNull();
    expect(harness.current().options).toEqual([{ label: 'new', value: 'new' }]);
  });

  // A page that fits the dropdown exactly never scrolls, so `onReachBottom`
  // never fires and everything past page one is unreachable. The hook has to
  // pull the next pages itself.
  it('keeps paging until the menu can scroll', async (): Promise<void> => {
    const field = createField('select');
    previewOptionsMock.mockImplementation(
      async (input): Promise<FormDataSourceOptionsResultRecord> => {
        const start = Number(input.cursor ?? '0');
        const values = [start + 1, start + 2, start + 3].map(String);

        return {
          dataSourceKey: 'demo.options',
          dataSourceVersion: 1,
          nextCursor: start + 3 >= 12 ? null : String(start + 3),
          options: values.map((value) => ({ label: value, value })),
          waitingForFieldKeys: [],
        };
      },
    );

    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.options.length >= 10);
    expect(harness.current().status).toBe('VALID');
    // Stops as soon as scrolling is possible rather than draining the source.
    expect(harness.current().options.length).toBe(12);
  });

  // A source that hands back a cursor with an empty page would otherwise spin
  // forever.
  it('stops auto-paging when a page comes back empty', async (): Promise<void> => {
    const field = createField('select');
    previewOptionsMock.mockResolvedValue({
      dataSourceKey: 'demo.options',
      dataSourceVersion: 1,
      nextCursor: 'always-more',
      options: [],
      waitingForFieldKeys: [],
    });

    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);
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
    expect(harness.current().canRetry).toBe(true);
    expect(readFormDataSourceFieldStatusMessage(harness.current())).not.toContain(
      'FORM_DATA_SOURCE',
    );
  });

  // A host that reduces unhandled errors to a generic message (as `apps/api`
  // does) would otherwise have that English string rendered in the field.
  it('never renders a non-DataSource error message verbatim', async (): Promise<void> => {
    const field = createField('select');
    previewOptionsMock.mockRejectedValue(new Error('Internal server error'));
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'UNAVAILABLE');
    expect(harness.current().error).toBe('選項來源暫時無法使用。');
  });

  it('keeps a searchable field submittable when the search text is too short', async (): Promise<void> => {
    const field = createField('autocomplete');
    previewOptionsMock.mockResolvedValueOnce(createOptionsResult('A'));
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: { choice: 'A' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    act((): void => {
      harness.current().onSearch('AB');
    });
    await waitForState(harness, (state) => state.status === 'VALID');

    previewOptionsMock.mockRejectedValueOnce(
      new Error('FORM_DATA_SOURCE_SEARCH_TOO_SHORT'),
    );
    act((): void => {
      harness.current().onSearch('A');
    });
    await waitForState(harness, (state) => state.error !== null);

    expect(harness.current().status).toBe('VALID');
    expect(harness.current().error).toBe('請輸入更多搜尋文字。');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBe(
      '請輸入更多搜尋文字。',
    );
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(
      false,
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

  it('invalidates a snapshot value the source no longer resolves', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
    ]);
    // The upstream plant changed, so the loaded page no longer offers `A`; only
    // the instance snapshot still carries its label.
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('B'));
    runtimeResolveMock.mockResolvedValue({
      dataSourceKey: 'demo.options',
      dataSourceVersion: 1,
      options: [],
      unresolvedValues: ['A'],
      waitingForFieldKeys: [],
    });
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: { choice: 'A', plant: 'TW02' },
      initialFormData: { choice: 'A', plant: 'TW01' },
      initialValue: 'A',
      optionSnapshots: createSnapshots('A', '歷史標籤'),
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'INVALID');
    expect(runtimeResolveMock).toHaveBeenCalledTimes(1);
    expect(runtimeResolveMock.mock.calls[0]?.[0].values).toEqual(['A']);
    expect(harness.current().invalidValues).toEqual(['A']);
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(true);
    // The old label stays on screen so the filler can tell what they lost.
    expect(harness.current().options).toContainEqual({
      label: '歷史標籤',
      value: 'A',
    });
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toContain(
      'A',
    );
  });

  it('re-validates a stale value and adopts the authoritative label', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
    ]);
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('A'));
    runtimeResolveMock.mockResolvedValue({
      dataSourceKey: 'demo.options',
      dataSourceVersion: 1,
      options: [{ label: '現行標籤', value: 'A' }],
      unresolvedValues: [],
      waitingForFieldKeys: [],
    });
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: { choice: 'A', plant: 'TW02' },
      initialFormData: { choice: 'A', plant: 'TW01' },
      initialValue: 'A',
      optionSnapshots: createSnapshots('A', '歷史標籤'),
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(harness.current().invalidValues).toEqual([]);
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(
      false,
    );
    expect(harness.current().options).toContainEqual({
      label: '現行標籤',
      value: 'A',
    });
  });

  it('does not query a read-only instance and hydrates its snapshot', async (): Promise<void> => {
    const field = createField('select');
    const harness = mountHookHarness({
      field,
      formData: { choice: 'A' },
      optionSnapshots: createSnapshots('A', '歷史標籤'),
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

  it('stays silent on a read-only field that was never filled in', (): void => {
    const field = createField('select');
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: {},
      readonly: true,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    expect(harness.current().status).toBe('IDLE');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBeNull();
    expect(harness.current().canRetry).toBe(false);
    expect(runtimeOptionsMock).not.toHaveBeenCalled();
  });

  it('reports an unlabelled read-only value as unavailable without a retry', (): void => {
    const field = createField('select');
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: { choice: 'A' },
      readonly: true,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    expect(harness.current().status).toBe('UNAVAILABLE');
    expect(harness.current().canRetry).toBe(false);
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

async function flushAsync(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 0);
    });
  });
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

function createSnapshots(
  value: string,
  label: string,
): NonNullable<UseFormDataSourceFieldInput['optionSnapshots']> {
  return {
    choice: {
      bindingHash: 'hash',
      dataSourceKey: 'demo.options',
      dataSourceVersion: 1,
      options: [{ label, value }],
      validatedAt: '2026-08-12T00:00:00.000Z',
    },
  };
}

function createOptionsResult(
  value?: string,
): FormDataSourceOptionsResultRecord {
  return {
    dataSourceKey: 'demo.options',
    dataSourceVersion: 1,
    nextCursor: null,
    options: value ? [{ label: value, value }] : [],
    waitingForFieldKeys: [],
  };
}
