'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldValue,
  FormUiSchema,
  isFormDataSourceFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  FormDataSourceErrorCode,
  FormDataSourceFieldStatus,
  FormRendererValues,
  mergeFormDataSourceOptions,
  previewResolveFormFieldOptions,
  readFormDataSourceErrorCode,
  readFormDataSourceErrorMessage,
  readMissingFormDataSourceDependencies,
  readMissingFormDataSourceOptionValues,
  previewFormFieldOptions,
  readFormDataSourceSelectedValues,
  readFormDataSourceValueSignature,
  readSelectedFormDataSourceOptions,
  readFormFieldOptions,
  resolveFormFieldOptions,
} from '@rytass/bpm-core-client/form';

export type FormRendererDataSourceContext =
  | { readonly kind: 'preview' }
  | {
      readonly instanceId?: string | null;
      readonly kind: 'runtime';
      readonly templateId?: string | null;
    };

export interface FormDataSourceFieldState {
  /**
   * False when nothing can be re-requested — a read-only or context-less field
   * has no query to retry, so the view must not offer a dead retry action.
   */
  readonly canRetry: boolean;
  readonly error: string | null;
  readonly hasValue: boolean;
  readonly hasNextPage: boolean;
  readonly invalidValues: readonly string[];
  readonly onReachBottom: () => void;
  readonly onSearch: (searchText: string) => void;
  readonly options: readonly FormFieldOption[];
  readonly retry: () => void;
  readonly status: FormDataSourceFieldStatus;
}

/**
 * What makes a table cell different from a top-level field: it is addressed by
 * a schema path, snapshotted under an instance path, and its `ROW_FIELD`
 * bindings read from its own row rather than the form (ADR 16 §3.3, §3.5).
 */
export interface UseFormDataSourceFieldRow {
  /** The row as it was loaded, so a returned case can tell what changed. */
  readonly initialValues?: FormRendererValues;
  readonly values: FormRendererValues;
}

export interface UseFormDataSourceFieldInput {
  readonly context?: FormRendererDataSourceContext;
  readonly field: FormFieldDefinition;
  /** Schema path used to address the field; defaults to its own key. */
  readonly fieldPath?: string;
  readonly formData: FormRendererValues;
  readonly initialFormData?: FormRendererValues;
  readonly initialValue?: FormFieldValue | undefined;
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly readonly: boolean;
  /** Set only for a table cell. */
  readonly row?: UseFormDataSourceFieldRow;
  readonly schema: FormDefinitionSchema;
  /** Snapshot map key; defaults to the field key. */
  readonly snapshotKey?: string;
  readonly uiSchema: FormUiSchema;
}

interface FormDataSourceResolution {
  readonly signature: string;
  readonly unresolvedValues: readonly string[];
}

const EMPTY_FIELD_STATE: FormDataSourceFieldState = {
  canRetry: false,
  error: null,
  hasValue: false,
  hasNextPage: false,
  invalidValues: [],
  onReachBottom: (): void => undefined,
  onSearch: (): void => undefined,
  options: [],
  retry: (): void => undefined,
  status: 'IDLE',
};

const NO_INVALID_VALUES: readonly string[] = [];

/**
 * A dropdown only fires `onReachBottom` once its content overflows. A source
 * whose first page is smaller than the menu is therefore unreachable past page
 * one — `demo.cost-centers` serves 3 at a time, which fits exactly, so nothing
 * ever scrolls and the remaining options cannot be selected at all. Keep
 * pulling pages until there are enough rows to scroll, or the source runs out.
 */
const MIN_SCROLLABLE_OPTION_COUNT = 10;

/**
 * Failures the filler can clear on their own by typing differently. They are
 * reported as an inline hint and never turn the field unavailable, because a
 * short search string says nothing about the validity of an existing value.
 */
const RECOVERABLE_ERROR_CODES: readonly FormDataSourceErrorCode[] = [
  'FORM_DATA_SOURCE_SEARCH_NOT_SUPPORTED',
  'FORM_DATA_SOURCE_SEARCH_TOO_SHORT',
];

export function useFormDataSourceField(
  input: UseFormDataSourceFieldInput,
): FormDataSourceFieldState {
  const dynamicField = isFormDataSourceFieldDefinition(input.field)
    ? input.field
    : null;
  const queryFieldKey = input.fieldPath ?? dynamicField?.fieldKey ?? '';
  const snapshot = dynamicField
    ? input.optionSnapshots?.[input.snapshotKey ?? dynamicField.fieldKey]
    : undefined;
  // The field object is rebuilt on every parent render, so depending on its
  // identity re-ran the load effect three extra times per change — each request
  // aborting the last. Depend on what actually decides the query instead.
  const dynamicFieldSignature = dynamicField
    ? JSON.stringify({
        dataSource: dynamicField.dataSource,
        fieldKey: dynamicField.fieldKey,
        type: dynamicField.type,
      })
    : '';
  const snapshotSignature = JSON.stringify(snapshot ?? null);
  const snapshotOptions = useMemo(
    (): readonly FormFieldOption[] => snapshot?.options ?? [],
    [snapshotSignature],
  );
  const formDataSignature = JSON.stringify(input.formData);
  const initialFormDataSignature = JSON.stringify(input.initialFormData ?? {});
  const schemaSignature = JSON.stringify(input.schema);
  const uiSchemaSignature = JSON.stringify(input.uiSchema);
  const contextKind = input.context?.kind;
  const contextInstanceId =
    input.context?.kind === 'runtime' ? input.context.instanceId : undefined;
  const contextTemplateId =
    input.context?.kind === 'runtime' ? input.context.templateId : undefined;
  const rowValuesSignature = JSON.stringify(input.row?.values ?? null);
  const initialRowValuesSignature = JSON.stringify(
    input.row?.initialValues ?? null,
  );
  // A cell's value lives on its row, never on the form data — a top-level field
  // may even share the column's key.
  const currentValue = dynamicField
    ? input.row
      ? input.row.values[dynamicField.fieldKey]
      : input.formData[dynamicField.fieldKey]
    : undefined;
  const currentValueSignature = readFormDataSourceValueSignature(currentValue);
  const selectedValues = useMemo(
    (): readonly string[] => readFormDataSourceSelectedValues(currentValue),
    [currentValueSignature],
  );
  const hasValue = selectedValues.length > 0;
  const dataSourceRefreshSignature = dynamicField
    ? JSON.stringify({
        bindings: dynamicField.dataSource.bindings.map((binding) =>
          binding.from.kind === 'FIELD'
            ? {
                fieldKey: binding.from.fieldKey,
                value: input.formData[binding.from.fieldKey],
              }
            : binding.from.kind === 'CONSTANT'
              ? { value: binding.from.value }
              : {
                  columnKey: binding.from.columnKey,
                  value: input.row?.values[binding.from.columnKey],
                },
        ),
        value:
          typeof input.initialFormData !== 'undefined' ||
          typeof input.initialValue !== 'undefined'
            ? currentValue
            : undefined,
      })
    : '';
  const effectiveContext = useMemo(
    (): FormRendererDataSourceContext | undefined => {
      if (contextKind === 'preview') {
        return { kind: 'preview' };
      }

      if (contextKind === 'runtime' && !input.readonly) {
        return {
          instanceId: contextInstanceId,
          kind: 'runtime',
          templateId: contextTemplateId,
        };
      }

      return undefined;
    },
    [
      contextInstanceId,
      contextKind,
      contextTemplateId,
      input.readonly,
    ],
  );
  const valueChanged = dynamicField
    ? (typeof input.initialFormData !== 'undefined' ||
        typeof input.initialValue !== 'undefined') &&
      readFormDataSourceValueSignature(input.initialValue) !==
        currentValueSignature
    : false;
  const bindingsChanged = dynamicField
    ? typeof input.initialFormData !== 'undefined' &&
      dynamicField.dataSource.bindings.some((binding) => {
        if (binding.from.kind === 'FIELD') {
          return (
            readFormDataSourceValueSignature(
              input.initialFormData?.[binding.from.fieldKey],
            ) !==
            readFormDataSourceValueSignature(
              input.formData[binding.from.fieldKey],
            )
          );
        }

        if (binding.from.kind === 'ROW_FIELD' && input.row?.initialValues) {
          return (
            readFormDataSourceValueSignature(
              input.row.initialValues[binding.from.columnKey],
            ) !==
            readFormDataSourceValueSignature(
              input.row.values[binding.from.columnKey],
            )
          );
        }

        return false;
      })
    : false;
  const isStale = Boolean(
    (snapshot || hasValue) && (valueChanged || bindingsChanged),
  );
  // A stale field with a value is only trustworthy once the host has resolved
  // it: display options may still carry the value through the snapshot merge.
  const needsResolve = Boolean(dynamicField && effectiveContext && isStale && hasValue);
  const quiescentStatus = readQuiescentFormDataSourceStatus({
    hasSnapshot: Boolean(snapshot),
    hasValue,
    isStale,
    readonly: input.readonly,
  });
  // AutoComplete only queries on search, so every other control is the one that
  // loads by itself as soon as it has a context.
  const autoQueries = Boolean(
    dynamicField && effectiveContext && dynamicField.type !== 'autocomplete',
  );
  // Optimistic, and only until the first answer arrives: a binding pointing at
  // an empty field is usually blocking, and showing the control as usable for
  // one round trip would flash an enabled, empty list. AutoComplete is excluded
  // because nothing would ever correct the guess — it cannot be searched while
  // disabled, so an optional binding would lock it for good.
  const waitsForDependencies =
    autoQueries &&
    dynamicField !== null &&
    readMissingFormDataSourceDependencies(
      dynamicField,
      input.formData,
      input.row?.values,
    ).length > 0;
  const pendingQueryStatus = readPendingQueryStatus(isStale, waitsForDependencies);
  const [remoteOptions, setRemoteOptions] = useState<readonly FormFieldOption[]>(
    [],
  );
  const [searchText, setSearchText] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [resolution, setResolution] = useState<FormDataSourceResolution | null>(
    null,
  );
  const [status, setStatus] = useState<FormDataSourceFieldStatus>(
    (): FormDataSourceFieldStatus => {
      if (!dynamicField) {
        return 'IDLE';
      }

      // The very first paint already reflects the query the effect is about to
      // fire, so the control never appears usable before its options exist.
      return autoQueries ? pendingQueryStatus : quiescentStatus;
    },
  );
  const [error, setError] = useState<string | null>(null);
  const loadedOptionCount = useRef(0);
  const requestSequence = useRef(0);
  const resolveSequence = useRef(0);
  const optionsAbort = useRef<AbortController | null>(null);
  const resolveAbort = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ readonly cursor: string | null; readonly searchText: string }>({
    cursor: null,
    searchText: '',
  });

  const queryFormData = useMemo(
    (): Readonly<Record<string, FormFieldValue>> =>
      readDefinedValues(input.formData),
    [formDataSignature],
  );
  const queryRowValues = useMemo(
    (): Readonly<Record<string, FormFieldValue>> | undefined =>
      input.row ? readDefinedValues(input.row.values) : undefined,
    [rowValuesSignature],
  );
  const mergedOptions = useMemo(
    (): readonly FormFieldOption[] =>
      mergeFormDataSourceOptions(snapshotOptions, remoteOptions),
    [remoteOptions, snapshotOptions],
  );
  const currentResolution =
    resolution && resolution.signature === dataSourceRefreshSignature
      ? resolution
      : null;
  const resolvePending = needsResolve && !currentResolution;
  const invalidValues = readInvalidFormDataSourceValues({
    options: mergedOptions,
    resolution: currentResolution,
    resolvePending,
    value: currentValue,
  });

  const loadOptions = useCallback(
    (nextSearchTextToLoad: string, cursor: string | null): void => {
      if (!dynamicField || !effectiveContext) {
        return;
      }

      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      lastRequest.current = {
        cursor,
        searchText: nextSearchTextToLoad,
      };
      optionsAbort.current?.abort();
      const controller = new AbortController();
      optionsAbort.current = controller;
      setStatus(pendingQueryStatus);
      setError(null);

      const request =
        effectiveContext.kind === 'preview'
          ? previewFormFieldOptions({
              cursor,
              fieldKey: queryFieldKey,
              formData: queryFormData,
              rowValues: queryRowValues,
              schema: input.schema,
              searchText: nextSearchTextToLoad,
              signal: controller.signal,
              uiSchema: input.uiSchema,
            })
          : readFormFieldOptions({
              cursor,
              fieldKey: queryFieldKey,
              formData: queryFormData,
              instanceId: effectiveContext.instanceId ?? null,
              rowValues: queryRowValues,
              searchText: nextSearchTextToLoad,
              signal: controller.signal,
              templateId: effectiveContext.templateId ?? null,
            });

      void request
        .then((result): void => {
          if (isSupersededRequest(controller, requestSequence, requestId)) {
            return;
          }

          setRemoteOptions((currentOptions) => {
            const selectedOptions = readSelectedFormDataSourceOptions(
              currentValue,
              currentOptions,
            );

            return mergeFormDataSourceOptions(
              selectedOptions,
              cursor ? currentOptions : [],
              result.options,
            );
          });
          setNextCursor(result.nextCursor);
          setError(null);
          loadedOptionCount.current = cursor
            ? loadedOptionCount.current + result.options.length
            : result.options.length;

          // An empty page that still hands back a cursor would loop forever.
          if (
            result.nextCursor &&
            result.options.length > 0 &&
            loadedOptionCount.current < MIN_SCROLLABLE_OPTION_COUNT
          ) {
            loadOptionsRef.current(nextSearchTextToLoad, result.nextCursor);
          }

          // Only the host knows which bound parameters are required, so a
          // control is disabled on its answer instead of on a browser guess.
          setStatus(
            result.waitingForFieldKeys.length
              ? 'WAITING_FOR_DEPENDENCIES'
              : 'VALID',
          );
        })
        .catch((requestError: unknown): void => {
          if (isSupersededRequest(controller, requestSequence, requestId)) {
            return;
          }

          // Anything that is not a DataSource code — a transport failure, or a
          // server-side error the host deliberately reduced to a generic
          // message — must not be rendered verbatim; it is English technical
          // copy the filler cannot act on.
          const message =
            readFormDataSourceErrorMessage(requestError) ??
            '選項來源暫時無法使用。';
          const code = readFormDataSourceErrorCode(requestError);

          setError(message);
          setStatus(
            readFailedQueryStatus(
              Boolean(code && RECOVERABLE_ERROR_CODES.includes(code)),
              hasValue,
            ),
          );
        });
    },
    [
      currentValueSignature,
      dynamicFieldSignature,
      effectiveContext,
      hasValue,
      pendingQueryStatus,
      queryFieldKey,
      queryFormData,
      queryRowValues,
      schemaSignature,
      uiSchemaSignature,
    ],
  );
  const loadOptionsRef = useRef(loadOptions);
  loadOptionsRef.current = loadOptions;

  const runResolve = useCallback((): void => {
    if (!dynamicField || !effectiveContext || selectedValues.length === 0) {
      return;
    }

    const signature = dataSourceRefreshSignature;
    const requestId = resolveSequence.current + 1;
    resolveSequence.current = requestId;
    resolveAbort.current?.abort();
    const controller = new AbortController();
    resolveAbort.current = controller;
    setError(null);

    const request =
      effectiveContext.kind === 'preview'
        ? previewResolveFormFieldOptions({
            fieldKey: queryFieldKey,
            formData: queryFormData,
            rowValues: queryRowValues,
            schema: input.schema,
            signal: controller.signal,
            uiSchema: input.uiSchema,
            values: selectedValues,
          })
        : resolveFormFieldOptions({
            fieldKey: queryFieldKey,
            formData: queryFormData,
            instanceId: effectiveContext.instanceId ?? null,
            rowValues: queryRowValues,
            signal: controller.signal,
            templateId: effectiveContext.templateId ?? null,
            values: selectedValues,
          });

    void request
      .then((result): void => {
        if (isSupersededRequest(controller, resolveSequence, requestId)) {
          return;
        }

        if (result.waitingForFieldKeys.length) {
          // The host could not consult the provider, so this is no answer about
          // the value: leave the field waiting rather than call it resolved.
          setStatus('WAITING_FOR_DEPENDENCIES');

          return;
        }

        // Authoritative labels for the values that survived, merged so the old
        // snapshot label of an unresolved value stays visible for recognition.
        setRemoteOptions((currentOptions) =>
          mergeFormDataSourceOptions(currentOptions, result.options),
        );
        setResolution({
          signature,
          unresolvedValues: result.unresolvedValues,
        });
        // `invalidValues` turns this into `INVALID` when anything went missing.
        setStatus('VALID');
      })
      .catch((requestError: unknown): void => {
        if (isSupersededRequest(controller, resolveSequence, requestId)) {
          return;
        }

        setStatus('UNAVAILABLE');
        setError(
          readFormDataSourceErrorMessage(requestError) ??
            '選項來源暫時無法使用。',
        );
      });
  }, [
    dataSourceRefreshSignature,
    dynamicFieldSignature,
    effectiveContext,
    queryFieldKey,
    queryFormData,
    queryRowValues,
    schemaSignature,
    selectedValues,
    uiSchemaSignature,
  ]);
  const runResolveRef = useRef(runResolve);
  runResolveRef.current = runResolve;

  useEffect((): void => {
    requestSequence.current += 1;
    optionsAbort.current?.abort();
    setRemoteOptions((currentOptions) =>
      readSelectedFormDataSourceOptions(currentValue, currentOptions),
    );
    setNextCursor((currentCursor) =>
      currentCursor === null ? currentCursor : null,
    );
    setSearchText((currentSearchText) =>
      currentSearchText ? '' : currentSearchText,
    );
    setError((currentError) => (currentError ? null : currentError));

    if (!dynamicField) {
      setStatus('IDLE');

      return;
    }

    if (!autoQueries) {
      // AutoComplete queries on search only, so it stays quiescent until the
      // filler types; a context-less field has nothing to query at all.
      setStatus(quiescentStatus);

      return;
    }

    loadOptionsRef.current('', null);
  }, [
    autoQueries,
    dynamicFieldSignature,
    effectiveContext,
    dataSourceRefreshSignature,
    initialFormDataSignature,
    initialRowValuesSignature,
    input.readonly,
    pendingQueryStatus,
    quiescentStatus,
    snapshotSignature,
  ]);

  useEffect((): void => {
    if (!needsResolve) {
      return;
    }

    runResolveRef.current();
  }, [dataSourceRefreshSignature, effectiveContext, needsResolve]);

  useEffect((): (() => void) => {
    return (): void => {
      optionsAbort.current?.abort();
      resolveAbort.current?.abort();
    };
  }, []);

  const onSearch = useCallback(
    (nextSearchTextToLoad: string): void => {
      setSearchText(nextSearchTextToLoad);
      setRemoteOptions((currentOptions) =>
        readSelectedFormDataSourceOptions(currentValue, currentOptions),
      );
      setNextCursor(null);
      loadOptions(nextSearchTextToLoad, null);
    },
    [loadOptions],
  );
  const onReachBottom = useCallback((): void => {
    if (nextCursor) {
      loadOptions(searchText, nextCursor);
    }
  }, [loadOptions, nextCursor, searchText]);
  const retry = useCallback((): void => {
    if (!effectiveContext) {
      return;
    }

    loadOptions(lastRequest.current.searchText, lastRequest.current.cursor);

    if (needsResolve) {
      runResolveRef.current();
    }
  }, [effectiveContext, loadOptions, needsResolve]);

  if (!dynamicField) {
    return EMPTY_FIELD_STATE;
  }

  return {
    canRetry: Boolean(effectiveContext),
    error,
    hasValue,
    hasNextPage: Boolean(nextCursor),
    invalidValues,
    onReachBottom,
    onSearch,
    options: mergedOptions,
    retry,
    status: readFormDataSourceExposedStatus({
      invalidValues,
      resolvePending,
      status,
    }),
  };
}

export function readFormDataSourceFieldStatusMessage(
  state: FormDataSourceFieldState,
): string | null {
  switch (state.status) {
    case 'WAITING_FOR_DEPENDENCIES':
      return '請先填寫相依欄位。';
    case 'STALE':
      return '選項需要重新載入或驗證。';
    case 'INVALID':
      return state.invalidValues.length
        ? `無法辨識選項：${state.invalidValues.join('、')}`
        : '目前選項已失效，請重新選擇。';
    case 'UNAVAILABLE':
      return state.error ?? '選項來源暫時無法使用。';
    case 'VALID':
      // A recoverable search hint outranks the empty-result copy: it is what
      // tells the filler how to get results at all.
      return state.error ?? (state.options.length ? null : '目前沒有可用選項。');
    default:
      return state.error;
  }
}

export function isFormDataSourceFieldSubmissionBlocked(
  state: Pick<FormDataSourceFieldState, 'hasValue' | 'status'>,
): boolean {
  return state.hasValue && state.status !== 'VALID';
}

/**
 * The copy to show when a submission is refused because of dynamic options.
 * `LOADING` and `STALE` clear on their own once the pending query answers, so
 * saying "finish validating" reads as a dead end for what is really a "wait a
 * moment"; the caller would otherwise show the same permanent-sounding line for
 * both cases.
 *
 * Returns `null` when nothing blocks the submission.
 */
export function readFormDataSourceSubmissionBlockMessage(
  states: readonly Pick<FormDataSourceFieldState, 'hasValue' | 'status'>[],
): string | null {
  const blocked = states.filter(isFormDataSourceFieldSubmissionBlocked);

  if (blocked.length === 0) {
    return null;
  }

  return blocked.every(
    (state) => state.status === 'LOADING' || state.status === 'STALE',
  )
    ? '選項驗證中，請稍候再送出。'
    : '請先完成動態選項驗證。';
}

/**
 * The values the field holds that no option accounts for.
 *
 * A completed resolve is the authority — the loaded pages are not, because the
 * option snapshot is merged into them for display and would vouch for a value
 * the source has already dropped.
 */
function readInvalidFormDataSourceValues(input: {
  readonly options: readonly FormFieldOption[];
  readonly resolution: FormDataSourceResolution | null;
  readonly resolvePending: boolean;
  readonly value: FormFieldValue | undefined;
}): readonly string[] {
  if (input.resolution) {
    return input.resolution.unresolvedValues;
  }

  // While the host is being asked, its answer is the only one worth showing.
  if (input.resolvePending) {
    return NO_INVALID_VALUES;
  }

  return readMissingFormDataSourceOptionValues(input.value, input.options);
}

/**
 * Status of a field nobody is querying — read-only history, a Designer preview
 * before the first search, or a control the host gave no context for.
 */
function readQuiescentFormDataSourceStatus(input: {
  readonly hasSnapshot: boolean;
  readonly hasValue: boolean;
  readonly isStale: boolean;
  readonly readonly: boolean;
}): FormDataSourceFieldStatus {
  if (input.isStale) {
    return 'STALE';
  }

  if (input.hasSnapshot) {
    return 'VALID';
  }

  // A read-only value with no snapshot cannot be labelled from anywhere, which
  // is worth saying. An empty read-only field is simply blank — warning about a
  // source nobody is going to query would be noise.
  return input.readonly && input.hasValue ? 'UNAVAILABLE' : 'IDLE';
}

/**
 * Status held while a query is in flight.
 *
 * `waiting` is the browser's optimistic guess and only survives until the host
 * answers: `waitingForFieldKeys` from the response replaces it either way, so an
 * optional binding left empty clears within one round trip instead of locking
 * the control.
 */
function readPendingQueryStatus(
  isStale: boolean,
  waiting: boolean,
): FormDataSourceFieldStatus {
  if (waiting) {
    return 'WAITING_FOR_DEPENDENCIES';
  }

  return isStale ? 'STALE' : 'LOADING';
}

/**
 * Status after a rejected query. A recoverable failure leaves the field as
 * usable as it was — only a broken source makes it unavailable.
 */
function readFailedQueryStatus(
  recoverable: boolean,
  hasValue: boolean,
): FormDataSourceFieldStatus {
  if (!recoverable) {
    return 'UNAVAILABLE';
  }

  return hasValue ? 'VALID' : 'IDLE';
}

function readFormDataSourceExposedStatus(input: {
  readonly invalidValues: readonly string[];
  readonly resolvePending: boolean;
  readonly status: FormDataSourceFieldStatus;
}): FormDataSourceFieldStatus {
  if (
    input.status === 'LOADING' ||
    input.status === 'UNAVAILABLE' ||
    input.status === 'WAITING_FOR_DEPENDENCIES'
  ) {
    return input.status;
  }

  if (input.invalidValues.length) {
    return 'INVALID';
  }

  return input.resolvePending ? 'STALE' : input.status;
}

/**
 * True when a response no longer belongs to the field: its request was aborted
 * by a newer one, or a newer one started before it settled. Such a response
 * must not touch state — an aborted request is not a failure to report.
 */
function isSupersededRequest(
  controller: AbortController,
  sequence: { readonly current: number },
  requestId: number,
): boolean {
  return controller.signal.aborted || sequence.current !== requestId;
}

function readDefinedValues(
  values: FormRendererValues,
): Readonly<Record<string, FormFieldValue>> {
  return Object.entries(values).reduce<
    Readonly<Record<string, FormFieldValue>>
  >((defined, [key, value]) => {
    if (typeof value === 'undefined') {
      return defined;
    }

    return { ...defined, [key]: value };
  }, {});
}
