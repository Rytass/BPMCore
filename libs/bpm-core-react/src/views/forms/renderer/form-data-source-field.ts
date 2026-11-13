'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FormDataSourceBinding,
  FormDataSourceBindingSource,
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldValue,
  FormUiSchema,
  isFormDataSourceFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  buildFormRendererValues,
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
  /**
   * True while the pending query is a next page rather than a first page. An
   * AutoComplete in async mode empties its list whenever it is told it is
   * loading, so the view keeps the loaded options on screen while paging.
   */
  readonly loadingNextPage: boolean;
  readonly invalidValues: readonly string[];
  /**
   * Call when the control's menu opens. A control that only queries on search
   * (AutoComplete) loads its first page here, so opening it lists options
   * instead of an empty menu; it is a no-op once that page is loaded.
   */
  readonly onOpen: () => void;
  readonly onReachBottom: () => void;
  readonly onSearch: (searchText: string) => void;
  readonly options: readonly FormFieldOption[];
  readonly retry: () => void;
  /**
   * True when the held value was valid for the form it was picked in, an
   * `EXPRESSION` binding's inputs have changed since, and the host's resolve
   * no longer accounts for it. The status is then `INVALID` and the message is
   * the host's `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` copy — the same sentence
   * a `FIELD` binding's stale value gets when the submission is refused.
   */
  readonly selectionExpired?: boolean;
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
  /**
   * The value it answered for. A new case leaves the value out of
   * `signature` (and an `EXPRESSION` binding leaves the field's own key out
   * of its refresh input), so without this a fresh pick would inherit the
   * verdict on the value it replaced.
   */
  readonly valueSignature: string;
}

const EMPTY_FIELD_STATE: FormDataSourceFieldState = {
  canRetry: false,
  error: null,
  hasValue: false,
  hasNextPage: false,
  loadingNextPage: false,
  invalidValues: [],
  onOpen: (): void => undefined,
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
 * How long an `EXPRESSION` binding's re-query waits for the form to settle.
 * Its refresh input is the whole form: the browser never parses CEL
 * (docs/24 §2.5), and the host does not report which fields an expression
 * reads — `waitingForFieldKeys` only lists the ones still empty, so it is no
 * dependency list. Without this every keystroke anywhere would query the
 * host. Aligned with the 300 ms `searchDebounceTime` of the renderer's
 * searchable DataSource controls.
 */
const FORM_DATA_SOURCE_EXPRESSION_REFRESH_DEBOUNCE_MS = 300;

/**
 * Failures the filler can clear on their own by typing differently. They are
 * reported as an inline hint and never turn the field unavailable, because a
 * short search string says nothing about the validity of an existing value.
 */
const RECOVERABLE_ERROR_CODES: readonly FormDataSourceErrorCode[] = [
  'FORM_DATA_SOURCE_SEARCH_NOT_SUPPORTED',
  'FORM_DATA_SOURCE_SEARCH_TOO_SHORT',
];

interface BindingRefreshScope {
  readonly formData: FormRendererValues;
  /** The form key holding this field's own value: never a dependency of it. */
  readonly ownFormKey: string | null;
  /** The row key holding this cell's own value, inside a table. */
  readonly ownRowKey: string | null;
  readonly rowValues: FormRendererValues | undefined;
}

/**
 * The form key this field's own value lives under: the field itself at the top
 * level, the table for a cell (`<tableKey>.<columnKey>` schema path, ADR 16
 * §3.3). Leaving it out keeps picking a value from re-querying the options.
 */
function readOwnFormKey(
  fieldKey: string,
  input: UseFormDataSourceFieldInput,
): string | null {
  if (!input.row) {
    return fieldKey;
  }

  const separatorIndex = input.fieldPath?.indexOf('.') ?? -1;

  return input.fieldPath && separatorIndex > 0
    ? input.fieldPath.slice(0, separatorIndex)
    : null;
}

function omitKey(
  values: FormRendererValues,
  key: string | null,
): FormRendererValues {
  return key === null
    ? values
    : Object.fromEntries(
        Object.entries(values).filter(([candidate]) => candidate !== key),
      );
}

/**
 * What one binding feeds its parameter from, for the refresh signature. An
 * `EXPRESSION` is evaluated only by the backend, which never tells the browser
 * what it reads, so the whole form (and row) stands in for its dependencies;
 * the signature then changes whenever anything it could read does. A source
 * kind this version does not know is listed as such and never read.
 */
function readBindingRefreshInput(
  binding: FormDataSourceBinding,
  scope: BindingRefreshScope,
): unknown {
  const from: FormDataSourceBindingSource = binding.from;

  switch (from.kind) {
    case 'FIELD':
      return { fieldKey: from.fieldKey, value: scope.formData[from.fieldKey] };
    case 'CONSTANT':
      return { value: from.value };
    case 'ROW_FIELD':
      return {
        columnKey: from.columnKey,
        value: scope.rowValues?.[from.columnKey],
      };
    case 'EXPRESSION':
      return {
        expression: from.expression,
        form: omitKey(scope.formData, scope.ownFormKey),
        row: scope.rowValues ? omitKey(scope.rowValues, scope.ownRowKey) : null,
      };
    default:
      return readUnknownBindingRefreshInput(from);
  }
}

function readUnknownBindingRefreshInput(from: never): unknown {
  void from;
  return { unsupported: true };
}

/**
 * JSON with object keys sorted, so two forms holding the same values compare
 * equal whatever order their keys arrived in — a stored instance comes back
 * from the database in its own key order, the renderer builds its values in
 * schema order.
 */
function stringifyStable(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value)) ?? 'null';
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => typeof entry !== 'undefined')
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortObjectKeys(entry)]),
    );
  }

  return value;
}

/**
 * The refresh signature a held value was last known good against: the one in
 * force when it was picked. A form without an `initialFormData` (a new case)
 * has nothing else to compare with.
 */
interface HeldValueBaseline {
  readonly bindings: string;
  readonly value: string;
}

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
  const bindingsRefreshSignature = dynamicField
    ? JSON.stringify(
        dynamicField.dataSource.bindings.map((binding) =>
          readBindingRefreshInput(binding, {
            formData: input.formData,
            ownFormKey: readOwnFormKey(dynamicField.fieldKey, input),
            ownRowKey: input.row ? dynamicField.fieldKey : null,
            rowValues: input.row?.values,
          }),
        ),
      )
    : '';
  const valueRefreshSignature = dynamicField
    ? JSON.stringify(
        typeof input.initialFormData !== 'undefined' ||
          typeof input.initialValue !== 'undefined'
          ? (currentValue ?? null)
          : null,
      )
    : '';
  // Every answer is tagged with this one, so a response to an older form
  // state is never taken for the current one.
  const dataSourceRefreshSignature = dynamicField
    ? `${bindingsRefreshSignature}\u0000${valueRefreshSignature}`
    : '';
  // Only a field with an `EXPRESSION` binding waits; every other binding
  // re-queries at once, as before.
  const settledBindingsRefreshSignature = useSettledSignature(
    bindingsRefreshSignature,
    dynamicField?.dataSource.bindings.some(
      (binding) => binding.from.kind === 'EXPRESSION',
    )
      ? FORM_DATA_SOURCE_EXPRESSION_REFRESH_DEBOUNCE_MS
      : 0,
  );
  // While the form settles the options and any earlier answer describe an
  // older form: the field reports itself pending, so a value in it blocks
  // the submission until the re-query answers (and the host re-resolves
  // every dynamic value on submit regardless).
  const refreshSettling =
    settledBindingsRefreshSignature !== bindingsRefreshSignature;
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

        // The browser cannot tell which fields an expression reads (it never
        // parses CEL, docs/24 §2.5), so any change to the rest of the form or
        // row may have changed its value: the kept value is re-resolved.
        //
        // Only where something can be re-resolved: a read-only field has no
        // query, so calling it stale would only print a warning nobody can
        // act on. Both sides go through the renderer's own value builder and
        // a key-order-free comparison, because the stored instance differs
        // from what the renderer holds in ways that are not edits — its key
        // order, the defaults the renderer fills in, keys outside the schema.
        if (binding.from.kind === 'EXPRESSION') {
          if (!effectiveContext) {
            return false;
          }

          const scope = {
            ownFormKey: readOwnFormKey(dynamicField.fieldKey, input),
            ownRowKey: input.row ? dynamicField.fieldKey : null,
          };

          return (
            stringifyStable(
              readBindingRefreshInput(binding, {
                ...scope,
                formData: buildFormRendererValues(
                  input.schema.fields,
                  input.initialFormData ?? {},
                ),
                rowValues: input.row?.initialValues ?? input.row?.values,
              }),
            ) !==
            stringifyStable(
              readBindingRefreshInput(binding, {
                ...scope,
                formData: buildFormRendererValues(
                  input.schema.fields,
                  input.formData,
                ),
                rowValues: input.row?.values,
              }),
            )
          );
        }

        return false;
      })
    : false;
  const hasExpressionBinding = Boolean(
    dynamicField?.dataSource.bindings.some(
      (binding) => binding.from.kind === 'EXPRESSION',
    ),
  );
  // Re-taken whenever the value itself changes (a pick, a clear), so it always
  // names the form the current value was chosen in. Kept in settled terms: a
  // value picked while the form was still settling was picked from options
  // for the older form, and is re-resolved once it settles.
  const [heldValueBaseline, setHeldValueBaseline] = useState<HeldValueBaseline>(
    (): HeldValueBaseline => ({
      bindings: settledBindingsRefreshSignature,
      value: currentValueSignature,
    }),
  );

  if (heldValueBaseline.value !== currentValueSignature) {
    setHeldValueBaseline({
      bindings: settledBindingsRefreshSignature,
      value: currentValueSignature,
    });
  }

  // A `FIELD` binding's stale value is caught by the host when the case is
  // submitted (`FORM_DATA_SOURCE_VALUE_NOT_RESOLVED`). An `EXPRESSION` one is
  // re-resolved here instead, once the form settles: its options are only
  // re-queried after the debounce, and without a resolve nothing would ever
  // say whether the held value survived the change. Compared with the settled
  // signature, so the status (and with it the query effect) does not move
  // before the debounce has passed.
  const expressionInputsChanged = Boolean(
    hasExpressionBinding &&
      effectiveContext &&
      hasValue &&
      heldValueBaseline.value === currentValueSignature &&
      heldValueBaseline.bindings !== settledBindingsRefreshSignature,
  );
  // A default on a dynamic source is only a guess until the source confirms it:
  // nothing in a new case says it was picked from the options (ADR 27 §8). The
  // untouched default is therefore resolved once, like a stale value, so its
  // label comes from the source and a default the source no longer offers is
  // flagged instead of passing as a valid pick.
  const untouchedDefault = Boolean(
    dynamicField &&
      !snapshot &&
      typeof input.initialFormData === 'undefined' &&
      typeof input.initialValue === 'undefined' &&
      typeof dynamicField.defaultValue !== 'undefined' &&
      currentValueSignature ===
        readFormDataSourceValueSignature(dynamicField.defaultValue),
  );
  const isStale = Boolean(
    (snapshot || hasValue) &&
      (valueChanged ||
        bindingsChanged ||
        expressionInputsChanged ||
        untouchedDefault),
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
  const quiescentStatusRef = useRef(quiescentStatus);
  quiescentStatusRef.current = quiescentStatus;
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
  const [loadingNextPage, setLoadingNextPage] = useState(false);
  const loadedOptionCount = useRef(0);
  const requestSequence = useRef(0);
  const resolveSequence = useRef(0);
  const optionsAbort = useRef<AbortController | null>(null);
  const resolveAbort = useRef<AbortController | null>(null);
  // Whether anything was queried since the options were last reset, so that
  // opening a search-only control loads its first page exactly once.
  const queriedSinceReset = useRef(false);
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
    resolution &&
    resolution.signature === dataSourceRefreshSignature &&
    resolution.valueSignature === currentValueSignature
      ? resolution
      : null;
  const resolvePending = needsResolve && !currentResolution;
  const selectionExpired = Boolean(
    expressionInputsChanged &&
      currentResolution &&
      currentResolution.unresolvedValues.length > 0,
  );
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
      queriedSinceReset.current = true;
      lastRequest.current = {
        cursor,
        searchText: nextSearchTextToLoad,
      };
      optionsAbort.current?.abort();
      const controller = new AbortController();
      optionsAbort.current = controller;
      setStatus(pendingQueryStatus);
      setLoadingNextPage(cursor !== null);
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

          setLoadingNextPage(false);
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
          // A failed first page leaves nothing loaded, so the next open retries
          // it; a failed later page keeps what is already listed.
          if (cursor === null) {
            queriedSinceReset.current = false;
          }
          setLoadingNextPage(false);

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
    const valueSignature = currentValueSignature;
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
          valueSignature,
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
    currentValueSignature,
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
    queriedSinceReset.current = false;
    optionsAbort.current?.abort();
    setLoadingNextPage(false);
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
      setStatus(quiescentStatusRef.current);

      return;
    }

    loadOptionsRef.current('', null);
    // The pending and quiescent statuses are read, not depended on: both
    // follow `isStale`, which flips when the filler picks a new value for an
    // expired `EXPRESSION` selection — and a pick must never re-query the
    // options (the field's own key is left out of its refresh input for that
    // reason). Re-querying there left the field `LOADING` right after the
    // pick, so an immediate submit was refused with the "wait" copy.
  }, [
    autoQueries,
    dynamicFieldSignature,
    effectiveContext,
    settledBindingsRefreshSignature,
    valueRefreshSignature,
    initialFormDataSignature,
    initialRowValuesSignature,
    input.readonly,
    snapshotSignature,
  ]);

  // A field nobody queries still has to follow its quiescent status (a value
  // turning stale, or no longer stale), which the effect above now only reads.
  useEffect((): void => {
    if (dynamicField && !autoQueries) {
      setStatus(quiescentStatus);
    }
  }, [autoQueries, dynamicFieldSignature, quiescentStatus]);

  useEffect((): void => {
    // An `EXPRESSION` field resolves only once the form has settled, like its
    // option re-query; every other binding settles at once.
    if (!needsResolve || refreshSettling) {
      return;
    }

    runResolveRef.current();
  }, [
    effectiveContext,
    needsResolve,
    refreshSettling,
    settledBindingsRefreshSignature,
    valueRefreshSignature,
  ]);

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
  const onOpen = useCallback((): void => {
    // A field that loads by itself, or that cannot query, has nothing to do.
    if (autoQueries || !effectiveContext || input.readonly) {
      return;
    }

    // `clearSearchText` empties the input when the menu closes, so a list
    // still filtered by the last search would no longer match what is shown.
    if (!queriedSinceReset.current || searchText !== '') {
      onSearch('');
    }
  }, [autoQueries, effectiveContext, input.readonly, onSearch, searchText]);
  // Read through a ref so the callback can keep one identity. The menu's
  // scrollbar keeps the handler it was given when the menu first rendered;
  // a control that only queries on open (AutoComplete) renders that menu
  // before its first page lands, so a handler closing over `nextCursor` would
  // still see `null` when the list is scrolled to the bottom.
  const nextPageRequest = useRef({ cursor: nextCursor, searchText });
  nextPageRequest.current = { cursor: nextCursor, searchText };
  const onReachBottom = useCallback((): void => {
    const { cursor, searchText: pageSearchText } = nextPageRequest.current;

    if (cursor) {
      loadOptionsRef.current(pageSearchText, cursor);
    }
  }, []);
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
    loadingNextPage,
    invalidValues,
    onOpen,
    onReachBottom,
    onSearch,
    options: mergedOptions,
    retry,
    selectionExpired,
    status:
      refreshSettling && effectiveContext && (autoQueries || hasValue)
        ? autoQueries
          ? pendingQueryStatus
          : 'STALE'
        : readFormDataSourceExposedStatus({
            invalidValues,
            resolvePending,
            status,
          }),
  };
}

/**
 * `signature` once it has stayed the same for `delayMs`; with no delay, the
 * signature itself. The first value is taken at once, so a field still loads
 * on its first paint.
 */
function useSettledSignature(signature: string, delayMs: number): string {
  const [settled, setSettled] = useState(signature);

  useEffect((): (() => void) | undefined => {
    if (delayMs <= 0) {
      return undefined;
    }

    const timer = setTimeout((): void => {
      setSettled(signature);
    }, delayMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [delayMs, signature]);

  return delayMs > 0 ? settled : signature;
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
      if (state.selectionExpired) {
        // The host's own copy for the code, not a second wording of it.
        return readFormDataSourceErrorMessage(
          'FORM_DATA_SOURCE_VALUE_NOT_RESOLVED',
        );
      }

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
  states: readonly Pick<
    FormDataSourceFieldState,
    'hasValue' | 'selectionExpired' | 'status'
  >[],
): string | null {
  const blocked = states.filter(isFormDataSourceFieldSubmissionBlocked);

  if (blocked.length === 0) {
    return null;
  }

  // An expired selection reads the same as the field (and as a FIELD binding
  // the server refuses): the host's copy for FORM_DATA_SOURCE_VALUE_NOT_RESOLVED.
  if (
    blocked.some(
      (state) => state.status === 'INVALID' && state.selectionExpired === true,
    )
  ) {
    return readFormDataSourceErrorMessage('FORM_DATA_SOURCE_VALUE_NOT_RESOLVED');
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
