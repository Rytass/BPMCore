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
  FormDataSourceFieldStatus,
  FormRendererValues,
  mergeFormDataSourceOptions,
  readMissingFormDataSourceOptionValues,
  previewFormFieldOptions,
  readFormDataSourceValueSignature,
  readMissingFormDataSourceDependencies,
  readSelectedFormDataSourceOptions,
  readFormFieldOptions,
} from '@rytass/bpm-core-client/form';

export type FormRendererDataSourceContext =
  | { readonly kind: 'preview' }
  | {
      readonly instanceId?: string | null;
      readonly kind: 'runtime';
      readonly templateId?: string | null;
    };

export interface FormDataSourceFieldState {
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

export interface UseFormDataSourceFieldInput {
  readonly context?: FormRendererDataSourceContext;
  readonly field: FormFieldDefinition;
  readonly formData: FormRendererValues;
  readonly initialFormData?: FormRendererValues;
  readonly initialValue?: FormFieldValue | undefined;
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly readonly: boolean;
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
}

const EMPTY_FIELD_STATE: FormDataSourceFieldState = {
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

export function useFormDataSourceField(
  input: UseFormDataSourceFieldInput,
): FormDataSourceFieldState {
  const dynamicField = isFormDataSourceFieldDefinition(input.field)
    ? input.field
    : null;
  const snapshot = dynamicField
    ? input.optionSnapshots?.[dynamicField.fieldKey]
    : undefined;
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
  const missingDependencies = dynamicField
    ? readMissingFormDataSourceDependencies(dynamicField, input.formData)
    : [];
  const missingDependenciesSignature = JSON.stringify(missingDependencies);
  const dataSourceRefreshSignature = dynamicField
    ? JSON.stringify({
        bindings: dynamicField.dataSource.bindings.map((binding) =>
          binding.from.kind === 'FIELD'
            ? {
                fieldKey: binding.from.fieldKey,
                value: input.formData[binding.from.fieldKey],
              }
            : { value: binding.from.value },
        ),
        value:
          typeof input.initialFormData !== 'undefined' ||
          typeof input.initialValue !== 'undefined'
            ? input.formData[dynamicField.fieldKey]
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
        readFormDataSourceValueSignature(input.formData[dynamicField.fieldKey])
    : false;
  const bindingsChanged = dynamicField
    ? typeof input.initialFormData !== 'undefined' &&
      dynamicField.dataSource.bindings.some((binding) => {
        if (binding.from.kind !== 'FIELD') {
          return false;
        }

        return (
          readFormDataSourceValueSignature(
            input.initialFormData?.[binding.from.fieldKey],
          ) !==
          readFormDataSourceValueSignature(input.formData[binding.from.fieldKey])
        );
      })
    : false;
  const isStale = Boolean(snapshot && (valueChanged || bindingsChanged));
  const [remoteOptions, setRemoteOptions] = useState<readonly FormFieldOption[]>(
    [],
  );
  const [searchText, setSearchText] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FormDataSourceFieldStatus>(
    dynamicField ? (snapshot ? (isStale ? 'STALE' : 'VALID') : 'IDLE') : 'IDLE',
  );
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const lastRequest = useRef<{ readonly cursor: string | null; readonly searchText: string }>({
    cursor: null,
    searchText: '',
  });

  const queryFormData = useMemo(
    (): Readonly<Record<string, FormFieldValue>> =>
      Object.entries(input.formData).reduce<
        Readonly<Record<string, FormFieldValue>>
      >((values, [key, value]) => {
        if (typeof value === 'undefined') {
          return values;
        }

        return { ...values, [key]: value };
      }, {}),
    [formDataSignature],
  );
  const mergedOptions = useMemo(
    (): readonly FormFieldOption[] =>
      mergeFormDataSourceOptions(snapshotOptions, remoteOptions),
    [remoteOptions, snapshotOptions],
  );
  const invalidValues = useMemo(
    (): readonly string[] =>
      readMissingFormDataSourceOptionValues(
        dynamicField ? input.formData[dynamicField.fieldKey] : undefined,
        mergedOptions,
      ),
    [dynamicField, input.formData, mergedOptions],
  );
  const hasValue = readFormDataSourceValuePresent(
    dynamicField ? input.formData[dynamicField.fieldKey] : undefined,
  );

  const loadOptions = useCallback(
    (nextSearchTextToLoad: string, cursor: string | null): void => {
      if (!dynamicField || !effectiveContext) {
        return;
      }

      if (missingDependencies.length > 0) {
        setStatus('WAITING_FOR_DEPENDENCIES');
        setError(null);

        return;
      }

      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      lastRequest.current = {
        cursor,
        searchText: nextSearchTextToLoad,
      };
      setStatus(isStale ? 'STALE' : 'LOADING');
      setError(null);

      const request =
        effectiveContext.kind === 'preview'
          ? previewFormFieldOptions({
              cursor,
              fieldKey: dynamicField.fieldKey,
              formData: queryFormData,
              schema: input.schema,
              searchText: nextSearchTextToLoad,
              uiSchema: input.uiSchema,
            })
          : readFormFieldOptions({
              cursor,
              fieldKey: dynamicField.fieldKey,
              formData: queryFormData,
              instanceId: effectiveContext.instanceId ?? null,
              searchText: nextSearchTextToLoad,
              templateId: effectiveContext.templateId ?? null,
            });

      void request
        .then((result): void => {
          if (requestSequence.current !== requestId) {
            return;
          }

          setRemoteOptions((currentOptions) => {
            const currentValue = dynamicField
              ? input.formData[dynamicField.fieldKey]
              : undefined;
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
          setStatus('VALID');
          setError(null);
        })
        .catch((requestError: unknown): void => {
          if (requestSequence.current !== requestId) {
            return;
          }

          setStatus('UNAVAILABLE');
          setError(
            requestError instanceof Error
              ? requestError.message
              : '選項來源暫時無法使用。',
          );
        });
    },
    [
      dynamicField,
      effectiveContext,
      isStale,
      missingDependencies.length,
      queryFormData,
      schemaSignature,
      uiSchemaSignature,
    ],
  );
  const loadOptionsRef = useRef(loadOptions);
  loadOptionsRef.current = loadOptions;

  useEffect((): void => {
    requestSequence.current += 1;
    setRemoteOptions((currentOptions) => {
      const currentValue = dynamicField
        ? input.formData[dynamicField.fieldKey]
        : undefined;

      return readSelectedFormDataSourceOptions(currentValue, currentOptions);
    });
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

    if (missingDependencies.length > 0) {
      setStatus('WAITING_FOR_DEPENDENCIES');

      return;
    }

    if (!effectiveContext) {
      setStatus(
        snapshot
          ? isStale
            ? 'STALE'
            : 'VALID'
          : input.readonly
            ? 'UNAVAILABLE'
            : 'IDLE',
      );

      return;
    }

    if (dynamicField.type === 'autocomplete') {
      setStatus(snapshot ? (isStale ? 'STALE' : 'VALID') : 'IDLE');

      return;
    }

    loadOptionsRef.current('', null);
  }, [
    dynamicField,
    effectiveContext,
    dataSourceRefreshSignature,
    initialFormDataSignature,
    input.readonly,
    isStale,
    missingDependenciesSignature,
    snapshotSignature,
  ]);

  const onSearch = useCallback(
    (nextSearchTextToLoad: string): void => {
      setSearchText(nextSearchTextToLoad);
      setRemoteOptions((currentOptions) => {
        const currentValue = dynamicField
          ? input.formData[dynamicField.fieldKey]
          : undefined;

        return readSelectedFormDataSourceOptions(currentValue, currentOptions);
      });
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
    loadOptions(lastRequest.current.searchText, lastRequest.current.cursor);
  }, [loadOptions]);

  if (!dynamicField) {
    return EMPTY_FIELD_STATE;
  }

  return {
    error,
    hasValue,
    hasNextPage: Boolean(nextCursor),
    invalidValues,
    onReachBottom,
    onSearch,
    options: mergedOptions,
    retry,
    status: status === 'VALID' && invalidValues.length ? 'INVALID' : status,
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
      return state.options.length ? null : '目前沒有可用選項。';
    default:
      return null;
  }
}

export function isFormDataSourceFieldSubmissionBlocked(
  state: Pick<FormDataSourceFieldState, 'hasValue' | 'status'>,
): boolean {
  return state.hasValue && state.status !== 'VALID';
}

function readFormDataSourceValuePresent(
  value: FormFieldValue | undefined,
): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}
