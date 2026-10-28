import {
  TEXT_FIELD_PATTERN_TIME_BUDGET_MS,
  type FormDefinitionSchema,
  type FormUiSchema,
  type TextFieldPatternTest,
} from '@rytass/bpm-core-shared/form';
import {
  FormRendererPatternTimeoutError,
  type FormRendererValidationResult,
  type FormRendererValues,
  validateFormRendererValues,
} from './form-rendering';

/**
 * How long the main thread waits for the worker before it terminates it, on
 * top of {@link TEXT_FIELD_PATTERN_TIME_BUDGET_MS}. The budget only charges
 * matching time, as the engine does; this covers starting the worker, and is
 * also the longest a single runaway pattern can run before it is cut off,
 * since a running regular expression cannot be interrupted from inside.
 */
export const FORM_PATTERN_WORKER_START_ALLOWANCE_MS = 1_000;

/** One pattern run the worker is asked for. */
export type FormPatternCheckRequest = Readonly<{
  flags: string;
  source: string;
  value: string;
}>;

/** The worker's answer for the request at `index`. */
export type FormPatternCheckResponse = Readonly<{
  index: number;
  result: boolean | 'timeout';
}>;

/**
 * The part of a `Worker` the validation uses, so a test or a host can supply
 * its own. `terminate` must also release whatever the worker holds.
 */
export interface FormPatternWorker {
  onerror: (() => void) | null;
  onmessage:
    ((event: { readonly data: FormPatternCheckResponse }) => void) | null;
  postMessage(requests: readonly FormPatternCheckRequest[]): void;
  terminate(): void;
}

/**
 * Runs in the worker. Mirrors the engine's timed test: the runs of one pass
 * share {@link TEXT_FIELD_PATTERN_TIME_BUDGET_MS} of matching time, a run that
 * goes past what is left counts as timed out, and so does every run after the
 * budget is spent. Each answer is posted as soon as it is known, so the main
 * thread keeps the answers it got when it has to terminate a runaway run.
 */
const PATTERN_WORKER_SOURCE = `
const BUDGET_MS = ${TEXT_FIELD_PATTERN_TIME_BUDGET_MS};
self.onmessage = (event) => {
  let spent = 0;
  event.data.forEach((request, index) => {
    if (spent >= BUDGET_MS) {
      self.postMessage({ index, result: 'timeout' });
      return;
    }
    const pattern = new RegExp(request.source, request.flags);
    const started = performance.now();
    const matched = pattern.test(request.value);
    const elapsed = performance.now() - started;
    const result = elapsed > BUDGET_MS - spent ? 'timeout' : matched;
    spent += elapsed;
    self.postMessage({ index, result });
  });
};
`;

/**
 * A worker running {@link PATTERN_WORKER_SOURCE} from a `blob:` URL, or `null`
 * where there is no `Worker` (a server render, Node, jsdom). A page whose
 * Content Security Policy does not allow `worker-src blob:` refuses it; that
 * surfaces as an error the caller treats like a missing `Worker`.
 */
export function createFormPatternWorker(): FormPatternWorker | null {
  if (
    typeof Worker === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  const url = URL.createObjectURL(
    new Blob([PATTERN_WORKER_SOURCE], { type: 'text/javascript' }),
  );

  try {
    const worker = new Worker(url);
    // The caller sets its handlers on this object; the worker's own events
    // read them at the time they fire.
    const wrapper: FormPatternWorker = {
      onerror: null,
      onmessage: null,
      postMessage: (requests): void => worker.postMessage(requests),
      terminate: (): void => {
        worker.terminate();
        URL.revokeObjectURL(url);
      },
    };

    worker.onmessage = (event: MessageEvent<FormPatternCheckResponse>): void =>
      wrapper.onmessage?.({ data: event.data });
    worker.onerror = (): void => wrapper.onerror?.();

    return wrapper;
  } catch {
    URL.revokeObjectURL(url);

    return null;
  }
}

const readCheckKey = ({
  flags,
  source,
  value,
}: FormPatternCheckRequest): string => JSON.stringify([source, flags, value]);

/**
 * Answers every request, or `null` when the worker could not be started or
 * failed: the caller then checks on the main thread as before, so a page that
 * cannot run workers is never blocked from submitting. A request still
 * unanswered at the deadline counts as timed out.
 */
function runPatternChecks(
  requests: readonly FormPatternCheckRequest[],
  createWorker: () => FormPatternWorker | null,
  deadlineMs: number,
): Promise<ReadonlyMap<string, boolean | 'timeout'> | null> {
  const worker = ((): FormPatternWorker | null => {
    try {
      return createWorker();
    } catch {
      return null;
    }
  })();

  if (!worker) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    // Answers arrive one message at a time, so they are collected as they come.
    const answers = new Map<number, boolean | 'timeout'>();
    const settle = (
      result: ReadonlyMap<string, boolean | 'timeout'> | null,
    ): void => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(result);
    };
    const settleWithAnswers = (): void =>
      settle(
        new Map(
          requests.map((request, index) => [
            readCheckKey(request),
            answers.get(index) ?? 'timeout',
          ]),
        ),
      );
    const timer = setTimeout(settleWithAnswers, deadlineMs);

    worker.onmessage = ({ data }): void => {
      answers.set(data.index, data.result);

      if (answers.size === requests.length) {
        settleWithAnswers();
      }
    };
    worker.onerror = (): void => settle(null);
    worker.postMessage(requests);
  });
}

/**
 * {@link validateFormRendererValues} with the text field patterns run in a Web
 * Worker, so a pattern that backtracks cannot freeze the page. The patterns of
 * one call share the engine's {@link TEXT_FIELD_PATTERN_TIME_BUDGET_MS} of
 * matching time, and a value whose pattern did not finish in time is reported
 * as not checked (`…的格式檢查逾時…`), never as a format error.
 *
 * Where no worker can run — no `Worker`, a Content Security Policy without
 * `worker-src blob:`, or a worker that fails — the values are checked on the
 * calling thread, with no time limit, exactly as `validateFormRendererValues`.
 */
export async function validateFormRendererValuesInWorker(
  input: Readonly<{
    schema: FormDefinitionSchema;
    uiSchema: FormUiSchema;
    values: FormRendererValues;
  }>,
  {
    createWorker = createFormPatternWorker,
    deadlineMs = TEXT_FIELD_PATTERN_TIME_BUDGET_MS +
      FORM_PATTERN_WORKER_START_ALLOWANCE_MS,
  }: Readonly<{
    createWorker?: () => FormPatternWorker | null;
    deadlineMs?: number;
  }> = {},
): Promise<FormRendererValidationResult> {
  // A first pass that only records the patterns it would run: the validator
  // decides which values reach a pattern (visible fields, lengths first), so
  // that logic stays in one place.
  const requested = new Map<string, FormPatternCheckRequest>();
  const recordingPass = validateFormRendererValues({
    ...input,
    testPattern: (pattern, value): boolean => {
      const request = { flags: pattern.flags, source: pattern.source, value };

      requested.set(readCheckKey(request), request);

      return true;
    },
  });

  if (requested.size === 0) {
    return recordingPass;
  }

  const answers = await runPatternChecks(
    [...requested.values()],
    createWorker,
    deadlineMs,
  );

  if (!answers) {
    return validateFormRendererValues(input);
  }

  const answeredPattern: TextFieldPatternTest = (pattern, value) => {
    const answer = answers.get(
      readCheckKey({ flags: pattern.flags, source: pattern.source, value }),
    );

    if (answer === 'timeout' || answer === undefined) {
      throw new FormRendererPatternTimeoutError();
    }

    return answer;
  };

  return validateFormRendererValues({ ...input, testPattern: answeredPattern });
}
