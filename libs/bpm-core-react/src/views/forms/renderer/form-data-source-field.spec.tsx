import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  previewFormFieldOptions,
  previewResolveFormFieldOptions,
  readFormFieldOptions,
  resolveFormFieldOptions,
  type FormDataSourceOptionsResultRecord,
  type FormDataSourceResolveResultRecord,
} from '@rytass/bpm-core-client/form';
import {
  isFormDataSourceFieldSubmissionBlocked,
  readFormDataSourceFieldStatusMessage,
  readFormDataSourceSubmissionBlockMessage,
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
const previewResolveMock = previewResolveFormFieldOptions as jest.MockedFunction<
  typeof previewResolveFormFieldOptions
>;
const runtimeOptionsMock = readFormFieldOptions as jest.MockedFunction<
  typeof readFormFieldOptions
>;
const runtimeResolveMock = resolveFormFieldOptions as jest.MockedFunction<
  typeof resolveFormFieldOptions
>;

const NEW_CASE_CONTEXT = {
  instanceId: null,
  kind: 'runtime',
  templateId: 'template-1',
} as const;

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

  it('re-queries an EXPRESSION binding whenever another field changes, never its own value', async (): Promise<void> => {
    // The browser cannot know what an expression reads (docs/24 §2.5), so any
    // other field stands in for its dependencies; the field's own selection
    // is not one of them.
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const input: UseFormDataSourceFieldInput = {
      context: { kind: 'preview' },
      field,
      formData: { plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);

    await harness.rerender({ ...input, formData: { plant: 'TW02' } });
    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
    // Only the form values travel; the expression is read from the schema by
    // the backend, never sent as a parameter.
    expect(JSON.stringify(previewOptionsMock.mock.calls[1])).toContain('TW02');

    await harness.rerender({
      ...input,
      formData: { choice: 'A', plant: 'TW02' },
    });
    await flushAsync();
    await flushAsync();
    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
  });

  it('debounces an EXPRESSION re-query: a burst of edits makes one request with the last values', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const input: UseFormDataSourceFieldInput = {
      context: { kind: 'preview' },
      field,
      formData: { plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    // The first paint still loads at once.
    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);

    await harness.rerender({ ...input, formData: { plant: 'TW0' } });
    await harness.rerender({ ...input, formData: { plant: 'TW02' } });
    await harness.rerender({ ...input, formData: { plant: 'TW03' } });
    await flushAsync();

    // Settling: nothing sent yet, and the field does not claim to be valid.
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);
    expect(harness.current().status).toBe('LOADING');

    await waitForState(
      harness,
      (state) =>
        state.status === 'VALID' && previewOptionsMock.mock.calls.length === 2,
    );
    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
    expect(previewOptionsMock.mock.calls[1]?.[0].formData).toEqual({
      plant: 'TW03',
    });
  });

  it('blocks the submission of a held value while its EXPRESSION re-query settles', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const input: UseFormDataSourceFieldInput = {
      context: { kind: 'preview' },
      field,
      formData: { choice: 'A', plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    // The held value is re-resolved once the form settles (P5 D5).
    previewResolveMock.mockResolvedValue(createResolveResult([]));
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(false);

    await harness.rerender({
      ...input,
      formData: { choice: 'A', plant: 'TW02' },
    });

    // The options describe the old plant until the re-query answers.
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(true);

    await waitForState(
      harness,
      (state) =>
        state.status === 'VALID' && previewOptionsMock.mock.calls.length === 2,
    );
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(false);
  });

  it('re-resolves a value held across an EXPRESSION dependency change on a new case, once the form settles', async (): Promise<void> => {
    // A new case has no initialFormData to compare with. Before the fix the
    // value was never re-resolved, so nothing could say whether it survived.
    const field = createField('select', [
      {
        from: {
          expression: 'form.chargeTo == "OTHER" ? "TW02" : form.plant',
          kind: 'EXPRESSION',
        },
        parameter: 'plant',
      },
    ]);
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('A'));
    runtimeResolveMock.mockResolvedValue(createResolveResult(['A']));
    const input: UseFormDataSourceFieldInput = {
      context: NEW_CASE_CONTEXT,
      field,
      formData: { chargeTo: 'SELF', choice: 'A', plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    expect(runtimeResolveMock).not.toHaveBeenCalled();

    runtimeOptionsMock.mockResolvedValue(createOptionsResult('B'));
    await harness.rerender({
      ...input,
      formData: { chargeTo: 'OTHER', choice: 'A', plant: 'TW01' },
    });
    await flushAsync();

    // Debounced: nothing is resolved while the form may still be changing.
    expect(runtimeResolveMock).not.toHaveBeenCalled();
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(true);

    await waitForState(harness, (state) => state.status === 'INVALID');
    expect(runtimeResolveMock).toHaveBeenCalledTimes(1);
    expect(runtimeResolveMock.mock.calls[0]?.[0]).toMatchObject({
      fieldKey: 'choice',
      formData: { chargeTo: 'OTHER', choice: 'A', plant: 'TW01' },
      instanceId: null,
      templateId: 'template-1',
      values: ['A'],
    });
    expect(harness.current().selectionExpired).toBe(true);
    // The same sentence a FIELD binding's stale value gets from the host.
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBe(
      '已選取的選項已失效，請重新選擇。',
    );
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(true);
    // ...and the submit banner says the same, not a generic "validate first".
    expect(
      readFormDataSourceSubmissionBlockMessage([harness.current()]),
    ).toBe('已選取的選項已失效，請重新選擇。');
  });

  it('takes a new pick over an expired EXPRESSION value at once, without re-querying', async (): Promise<void> => {
    // A new case leaves the value out of the refresh signature, and an
    // EXPRESSION leaves the field's own key out of its refresh input. The
    // answer on the expired value used to stick to the new pick ("無法辨識選
    // 項：A" under B), and the pick re-queried the options, leaving the field
    // LOADING so an immediate submit was refused with the "wait" copy.
    const field = createField('select', [
      {
        from: {
          expression: 'form.chargeTo == "OTHER" ? "TW02" : form.plant',
          kind: 'EXPRESSION',
        },
        parameter: 'plant',
      },
    ]);
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('A'));
    runtimeResolveMock.mockResolvedValue(createResolveResult(['A']));
    const input: UseFormDataSourceFieldInput = {
      context: NEW_CASE_CONTEXT,
      field,
      formData: { chargeTo: 'SELF', choice: 'A', plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('B'));
    await harness.rerender({
      ...input,
      formData: { chargeTo: 'OTHER', choice: 'A', plant: 'TW01' },
    });
    await waitForState(harness, (state) => state.selectionExpired === true);

    const optionCallsBeforePick = runtimeOptionsMock.mock.calls.length;

    await harness.rerender({
      ...input,
      formData: { chargeTo: 'OTHER', choice: 'B', plant: 'TW01' },
    });

    // Right after the pick, with nothing left in flight.
    expect(harness.current().status).toBe('VALID');
    expect(harness.current().invalidValues).toEqual([]);
    expect(harness.current().selectionExpired).toBe(false);
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(false);

    await flushAsync();
    await flushAsync();

    expect(runtimeOptionsMock.mock.calls.length).toBe(optionCallsBeforePick);
    expect(runtimeResolveMock).toHaveBeenCalledTimes(1);
    expect(harness.current().status).toBe('VALID');
  });

  it('releases a held value the host still resolves after an EXPRESSION dependency change', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('A'));
    runtimeResolveMock.mockResolvedValue({
      ...createResolveResult([]),
      options: [{ label: 'A', value: 'A' }],
    });
    const input: UseFormDataSourceFieldInput = {
      context: NEW_CASE_CONTEXT,
      field,
      formData: { choice: 'A', plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    await harness.rerender({
      ...input,
      formData: { choice: 'A', plant: 'TW02' },
    });
    await waitForState(
      harness,
      (state) =>
        state.status === 'VALID' && runtimeResolveMock.mock.calls.length === 1,
    );

    expect(harness.current().selectionExpired).toBe(false);
    expect(isFormDataSourceFieldSubmissionBlocked(harness.current())).toBe(false);
  });

  it('does not re-resolve a value picked after the EXPRESSION dependency changed', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('B'));
    const input: UseFormDataSourceFieldInput = {
      context: NEW_CASE_CONTEXT,
      field,
      formData: { plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    await harness.rerender({ ...input, formData: { plant: 'TW02' } });
    await waitForState(
      harness,
      (state) =>
        state.status === 'VALID' && runtimeOptionsMock.mock.calls.length === 2,
    );
    await harness.rerender({ ...input, formData: { choice: 'B', plant: 'TW02' } });
    await flushAsync();
    await flushAsync();

    expect(runtimeResolveMock).not.toHaveBeenCalled();
    expect(harness.current().status).toBe('VALID');
  });

  it('leaves a read-only EXPRESSION value alone when the stored case differs only in key order and defaults (P5 D6)', async (): Promise<void> => {
    // A just-submitted case: the stored formData comes back in the database's
    // key order and without the defaults the renderer fills in. Before the fix
    // the whole-form comparison called that a change and showed STALE.
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    const schema: FormDefinitionSchema = {
      fields: [
        { fieldKey: 'plant', label: 'Plant', required: true, type: 'text' },
        { fieldKey: 'urgent', label: 'Urgent', required: false, type: 'boolean' },
        field,
      ],
      schemaVersion: 1,
    };
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: { plant: 'TW01', urgent: false, choice: 'A' },
      initialFormData: { choice: 'A', plant: 'TW01' },
      initialValue: 'A',
      optionSnapshots: createSnapshots('A', '歷史標籤'),
      readonly: true,
      schema,
      uiSchema: createUiSchema(),
    });

    await flushAsync();

    expect(harness.current().status).toBe('VALID');
    expect(readFormDataSourceFieldStatusMessage(harness.current())).toBeNull();
    expect(runtimeOptionsMock).not.toHaveBeenCalled();
    expect(runtimeResolveMock).not.toHaveBeenCalled();
  });

  it('does not take key order or filled-in defaults for an EXPRESSION edit on an editable returned case', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { expression: 'form.plant', kind: 'EXPRESSION' },
        parameter: 'plant',
      },
    ]);
    const schema: FormDefinitionSchema = {
      fields: [
        { fieldKey: 'plant', label: 'Plant', required: true, type: 'text' },
        { fieldKey: 'urgent', label: 'Urgent', required: false, type: 'boolean' },
        field,
      ],
      schemaVersion: 1,
    };
    runtimeOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const harness = mountHookHarness({
      context: RUNTIME_CONTEXT,
      field,
      formData: { plant: 'TW01', urgent: false, choice: 'A' },
      initialFormData: { choice: 'A', plant: 'TW01' },
      initialValue: 'A',
      optionSnapshots: createSnapshots('A', '歷史標籤'),
      readonly: false,
      schema,
      uiSchema: createUiSchema(),
    });

    await waitForState(harness, (state) => state.status === 'VALID');
    await flushAsync();

    expect(runtimeResolveMock).not.toHaveBeenCalled();
    expect(harness.current().status).toBe('VALID');
  });

  it('re-queries a FIELD binding at once, without the EXPRESSION debounce', async (): Promise<void> => {
    const field = createField('select', [
      {
        from: { fieldKey: 'plant', kind: 'FIELD' },
        parameter: 'plant',
      },
    ]);
    previewOptionsMock.mockResolvedValue(createOptionsResult('A'));
    const input: UseFormDataSourceFieldInput = {
      context: { kind: 'preview' },
      field,
      formData: { plant: 'TW01' },
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    };
    const harness = mountHookHarness(input);

    await waitForState(harness, (state) => state.status === 'VALID');
    await harness.rerender({ ...input, formData: { plant: 'TW02' } });
    await flushAsync();

    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
  });

  it('loads the first page of a search-only field when its menu opens, once', async (): Promise<void> => {
    const field = createField('autocomplete');
    previewOptionsMock.mockResolvedValue(createOptionsResult('first'));

    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    // AutoComplete does not query by itself, so an unopened menu stays idle.
    expect(previewOptionsMock).not.toHaveBeenCalled();

    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.status === 'VALID');
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);
    expect(previewOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, searchText: '' }),
    );
    expect(harness.current().options).toEqual([
      { label: 'first', value: 'first' },
    ]);

    // Reopening keeps the loaded page rather than querying it again.
    act((): void => {
      harness.current().onOpen();
    });
    expect(previewOptionsMock).toHaveBeenCalledTimes(1);

    // After a search, reopening (with the input cleared on close) goes back to
    // the unfiltered first page.
    await act(async (): Promise<void> => {
      harness.current().onSearch('abc');
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.status === 'VALID');
    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    expect(previewOptionsMock).toHaveBeenCalledTimes(3);
    expect(previewOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, searchText: '' }),
    );
  });

  it('keeps one onReachBottom that pages with the latest cursor', async (): Promise<void> => {
    const field = createField('autocomplete');
    const page = (start: number, nextCursor: string | null): FormDataSourceOptionsResultRecord => ({
      ...createOptionsResult(),
      nextCursor,
      options: Array.from({ length: 10 }, (_, index) => ({
        label: `option-${start + index}`,
        value: `option-${start + index}`,
      })),
    });
    previewOptionsMock
      .mockResolvedValueOnce(page(1, 'page-2'))
      .mockResolvedValueOnce(page(11, null));

    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });
    // The menu's scrollbar keeps the handler from its first render, which is
    // before the first page — and its cursor — exist.
    const handlerFromFirstRender = harness.current().onReachBottom;

    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.options.length === 10);
    expect(harness.current().onReachBottom).toBe(handlerFromFirstRender);

    await act(async (): Promise<void> => {
      handlerFromFirstRender();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.options.length === 20);
    expect(previewOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'page-2', searchText: '' }),
    );
    expect(harness.current().hasNextPage).toBe(false);

    // Past the last page the same handler does nothing.
    act((): void => {
      handlerFromFirstRender();
    });
    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
  });

  it('flags a next-page load apart from a first-page load', async (): Promise<void> => {
    const field = createField('autocomplete');
    let resolvePage: (result: FormDataSourceOptionsResultRecord) => void = (): void => undefined;
    previewOptionsMock
      .mockResolvedValueOnce({
        ...createOptionsResult(),
        nextCursor: 'page-2',
        options: Array.from({ length: 10 }, (_, index) => ({
          label: `option-${index}`,
          value: `option-${index}`,
        })),
      })
      .mockImplementationOnce(
        (): Promise<FormDataSourceOptionsResultRecord> =>
          new Promise((resolve): void => {
            resolvePage = resolve;
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

    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.options.length === 10);
    expect(harness.current().loadingNextPage).toBe(false);

    act((): void => {
      harness.current().onReachBottom();
    });
    expect(harness.current().status).toBe('LOADING');
    expect(harness.current().loadingNextPage).toBe(true);
    expect(harness.current().options).toHaveLength(10);

    await act(async (): Promise<void> => {
      resolvePage({ ...createOptionsResult('option-10'), nextCursor: null });
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.options.length === 11);
    expect(harness.current().loadingNextPage).toBe(false);
  });

  it('retries the first page on the next open after it failed', async (): Promise<void> => {
    const field = createField('autocomplete');
    previewOptionsMock
      .mockRejectedValueOnce(new Error('Internal server error'))
      .mockResolvedValueOnce(createOptionsResult('first'));
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: false,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.error !== null);

    await act(async (): Promise<void> => {
      harness.current().onOpen();
      await Promise.resolve();
    });
    await waitForState(harness, (state) => state.options.length === 1);
    expect(previewOptionsMock).toHaveBeenCalledTimes(2);
  });

  it('does not query on open for a read-only field', (): void => {
    const field = createField('autocomplete');
    const harness = mountHookHarness({
      context: { kind: 'preview' },
      field,
      formData: {},
      readonly: true,
      schema: createSchema(field),
      uiSchema: createUiSchema(),
    });

    act((): void => {
      harness.current().onOpen();
    });
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

function createResolveResult(
  unresolvedValues: readonly string[],
): FormDataSourceResolveResultRecord {
  return {
    dataSourceKey: 'demo.options',
    dataSourceVersion: 1,
    options: [],
    unresolvedValues: [...unresolvedValues],
    waitingForFieldKeys: [],
  };
}
