import {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  FormPatternCheckRequest,
  FormPatternCheckResponse,
  FormPatternWorker,
  createFormPatternWorker,
  validateFormRendererValuesInWorker,
} from './form-pattern-worker';

const schema: FormDefinitionSchema = {
  fields: [
    {
      fieldKey: 'code',
      label: '代碼',
      pattern: '[A-Z]{3}',
      required: false,
      type: 'text',
    },
    {
      columns: [
        {
          fieldKey: 'sku',
          label: '料號',
          pattern: '[0-9]{4}',
          required: false,
          type: 'text',
        },
      ],
      fieldKey: 'items',
      label: '明細',
      required: false,
      type: 'table',
    },
    {
      fieldKey: 'note',
      label: '備註',
      required: false,
      type: 'text',
    },
  ],
  schemaVersion: 1,
};
const uiSchema: FormUiSchema = {
  layout: [
    { fieldKey: 'code', width: 'HALF' },
    { fieldKey: 'items', width: 'FULL' },
    { fieldKey: 'note', width: 'HALF' },
  ],
  schemaVersion: 1,
};

/**
 * A worker that answers each request on a later tick, with `answer` deciding
 * what it says; `RegExp#test` by default, like the real one under budget.
 */
const createFakeWorker = (
  answer: (
    request: FormPatternCheckRequest,
  ) => FormPatternCheckResponse['result'] | null = (request) =>
    new RegExp(request.source, request.flags).test(request.value),
): FormPatternWorker & {
  readonly received: () => readonly FormPatternCheckRequest[];
  readonly terminate: jest.Mock;
} => {
  const sent: FormPatternCheckRequest[][] = [];
  // One object: the validation sets its handlers on it, and the answers read
  // them from it.
  const worker: FormPatternWorker & {
    readonly received: () => readonly FormPatternCheckRequest[];
    readonly terminate: jest.Mock;
  } = {
    onerror: null,
    onmessage: null,
    postMessage: (requests): void => {
      sent.push([...requests]);
      requests.forEach((request, index) => {
        const result = answer(request);

        if (result !== null) {
          setTimeout(() => worker.onmessage?.({ data: { index, result } }), 0);
        }
      });
    },
    received: () => sent.flat(),
    terminate: jest.fn(),
  };

  return worker;
};

describe('validateFormRendererValuesInWorker', () => {
  it('runs every pattern in the worker and words a mismatch as before', async (): Promise<void> => {
    const worker = createFakeWorker();
    const result = await validateFormRendererValuesInWorker(
      {
        schema,
        uiSchema,
        values: { code: 'abc', items: [{ sku: '12' }, { sku: '1234' }] },
      },
      { createWorker: () => worker },
    );

    expect(result.errors).toEqual({
      code: '代碼格式不正確。',
      'items[0].sku': '料號格式不正確。',
    });
    expect(worker.received()).toEqual([
      { flags: 'u', source: '^(?:[A-Z]{3})$', value: 'abc' },
      { flags: 'u', source: '^(?:[0-9]{4})$', value: '12' },
      { flags: 'u', source: '^(?:[0-9]{4})$', value: '1234' },
    ]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('words a pattern the worker timed out on as not checked', async (): Promise<void> => {
    const result = await validateFormRendererValuesInWorker(
      { schema, uiSchema, values: { code: 'ABC' } },
      { createWorker: () => createFakeWorker(() => 'timeout') },
    );

    expect(result.errors).toEqual({
      code: '代碼的格式檢查逾時，請縮短內容後再試，或請表單設計者簡化格式。',
    });
  });

  it('terminates a worker that has not answered by the deadline', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const worker = createFakeWorker(() => null);
      const pending = validateFormRendererValuesInWorker(
        { schema, uiSchema, values: { code: 'ABC' } },
        { createWorker: () => worker, deadlineMs: 300 },
      );

      await jest.advanceTimersByTimeAsync(300);

      await expect(pending).resolves.toMatchObject({
        errors: {
          code: '代碼的格式檢查逾時，請縮短內容後再試，或請表單設計者簡化格式。',
        },
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('checks on the calling thread when no worker can run', async (): Promise<void> => {
    await expect(
      validateFormRendererValuesInWorker(
        { schema, uiSchema, values: { code: 'abc' } },
        { createWorker: () => null },
      ),
    ).resolves.toMatchObject({ errors: { code: '代碼格式不正確。' } });
    await expect(
      validateFormRendererValuesInWorker(
        { schema, uiSchema, values: { code: 'ABC' } },
        {
          createWorker: () => {
            throw new Error('blocked by the Content Security Policy');
          },
        },
      ),
    ).resolves.toMatchObject({ valid: true });
  });

  it('checks on the calling thread when the worker fails', async (): Promise<void> => {
    const failing: FormPatternWorker = {
      onerror: null,
      onmessage: null,
      postMessage: (): void => {
        setTimeout(() => failing.onerror?.(), 0);
      },
      terminate: jest.fn(),
    };

    await expect(
      validateFormRendererValuesInWorker(
        { schema, uiSchema, values: { code: 'abc' } },
        { createWorker: () => failing },
      ),
    ).resolves.toMatchObject({ errors: { code: '代碼格式不正確。' } });
  });

  it('starts no worker for values that reach no pattern', async (): Promise<void> => {
    const createWorker = jest.fn(() => createFakeWorker());

    await expect(
      validateFormRendererValuesInWorker(
        { schema, uiSchema, values: { note: 'free text' } },
        { createWorker },
      ),
    ).resolves.toMatchObject({ valid: true });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('has no worker to offer outside a browser', (): void => {
    expect(createFormPatternWorker()).toBeNull();
  });
});
