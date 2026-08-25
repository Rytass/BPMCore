'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AutoComplete,
  Button,
  CheckboxGroup,
  DatePicker,
  DateTimePicker,
  Input,
  RadioGroup,
  Select,
  Textarea,
  Toggle,
  Typography,
  Upload,
} from '@mezzanine-ui/react';
import type { UploadFile } from '@mezzanine-ui/react/Upload';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  FormUiSchema,
  isFormDataSourceFieldDefinition,
  isFormStaticOptionFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  buildFormRendererValues,
  clampOptionalNumber,
  formatDatePickerValue,
  formatDateTimePickerValue,
  FormRendererValues,
  isFormRendererFieldReadonly,
  isFormRendererFieldRequired,
  parseOptionalNumberInput,
  readDatePickerValue,
  readFieldOptionAsSelectOption,
  readSelectedFormDataSourceOptions,
  readSelectOption,
  readVisibleFormRendererFields,
} from '@rytass/bpm-core-client/form';
import { BPMFormField } from '../../../components/bpm-form-field';
import {
  FormDataSourceFieldState,
  FormRendererDataSourceContext,
  readFormDataSourceFieldStatusMessage,
  useFormDataSourceField,
} from './form-data-source-field';

export interface FormRendererProps {
  readonly dataSourceContext?: FormRendererDataSourceContext;
  readonly dataSourceInitialValues?: FormRendererValues;
  readonly emptyText?: string;
  readonly errors?: Readonly<Record<string, string>>;
  readonly maxWidth?: CSSProperties['maxWidth'];
  readonly onChange?: (values: FormRendererValues) => void;
  readonly onDataSourceStateChange?: (
    fieldKey: string,
    state: Pick<
      FormDataSourceFieldState,
      'hasValue' | 'invalidValues' | 'status'
    >,
  ) => void;
  readonly onUploadAttachment?: (
    field: FormFieldDefinition,
    file: File,
  ) => Promise<{ readonly id: string }>;
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly readonly?: boolean;
  readonly schema: FormDefinitionSchema;
  readonly singleColumn?: boolean;
  readonly uiSchema: FormUiSchema;
  readonly value?: FormRendererValues;
}

const FORM_RENDERER_GRID_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
};

const FORM_RENDERER_EMPTY_STYLE: CSSProperties = {
  gridColumn: '1 / -1',
};

const FORM_RENDERER_FIELD_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'grid',
  gap: 8,
  minWidth: 0,
};

const TEXTAREA_STYLE: CSSProperties = {
  minWidth: '100%',
  width: '100%',
};

function applyFullWidthTextareaHost(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }

  element.style.width = '100%';
}

export function FormRenderer({
  dataSourceContext,
  dataSourceInitialValues,
  emptyText = '尚未建立欄位。',
  errors = {},
  maxWidth,
  onChange,
  onDataSourceStateChange,
  onUploadAttachment,
  optionSnapshots,
  readonly = false,
  schema,
  singleColumn = false,
  uiSchema,
  value,
}: FormRendererProps): ReactElement {
  const [internalValues, setInternalValues] = useState<FormRendererValues>(() =>
    buildFormRendererValues(schema.fields, value ?? {}),
  );
  const values = useMemo(
    (): FormRendererValues =>
      buildFormRendererValues(schema.fields, value ?? internalValues),
    [internalValues, schema.fields, value],
  );
  const valuesRef = useRef<FormRendererValues>(values);
  const visibleFields = useMemo(
    (): readonly FormFieldDefinition[] =>
      readVisibleFormRendererFields(schema, uiSchema, values),
    [schema, uiSchema, values],
  );

  useEffect((): void => {
    valuesRef.current = values;
  }, [values]);

  useEffect((): void => {
    setInternalValues((currentValues) =>
      buildFormRendererValues(schema.fields, value ?? currentValues),
    );
  }, [schema.fields, value]);

  function updateValue(
    fieldKey: string,
    nextValue: FormFieldValue | undefined,
  ): void {
    const nextValues = {
      ...valuesRef.current,
      [fieldKey]: nextValue,
    };
    valuesRef.current = nextValues;

    if (!value) {
      setInternalValues(nextValues);
    }

    onChange?.(nextValues);
  }

  if (!visibleFields.length) {
    return (
      <div style={FORM_RENDERER_GRID_STYLE}>
        <Typography
          color="text-neutral"
          style={FORM_RENDERER_EMPTY_STYLE}
          variant="body"
        >
          {schema.fields.length > 0 ? '目前條件下沒有可填寫欄位。' : emptyText}
        </Typography>
      </div>
    );
  }

  return (
    <div
      style={{
        ...FORM_RENDERER_GRID_STYLE,
        ...(singleColumn ? { maxWidth, width: '100%' } : {}),
      }}
    >
      {visibleFields.map((field) => (
        <FormRendererField
          dataSourceContext={dataSourceContext}
          dataSourceInitialValues={dataSourceInitialValues}
          field={field}
          error={errors[field.fieldKey] ?? null}
          fields={schema.fields}
          key={field.fieldKey}
          onChange={updateValue}
          onDataSourceStateChange={onDataSourceStateChange}
          onUploadAttachment={onUploadAttachment}
          optionSnapshots={optionSnapshots}
          readonly={readonly}
          schema={schema}
          style={{
            ...FORM_RENDERER_FIELD_STYLE,
            gridColumn: `span ${
              singleColumn ? 12 : readFieldColumnSpan(field, uiSchema)
            }`,
          }}
          value={values[field.fieldKey]}
          values={values}
          uiSchema={uiSchema}
        />
      ))}
    </div>
  );
}

function FormRendererField({
  dataSourceContext,
  dataSourceInitialValues,
  error,
  field,
  fields,
  onChange,
  onDataSourceStateChange,
  onUploadAttachment,
  optionSnapshots,
  readonly,
  schema,
  style,
  value,
  values,
  uiSchema,
}: {
  readonly dataSourceContext?: FormRendererDataSourceContext;
  readonly dataSourceInitialValues?: FormRendererValues;
  readonly error: string | null;
  readonly field: FormFieldDefinition;
  readonly fields: readonly FormFieldDefinition[];
  readonly onChange: (
    fieldKey: string,
    value: FormFieldValue | undefined,
  ) => void;
  readonly onDataSourceStateChange?: (
    fieldKey: string,
    state: Pick<
      FormDataSourceFieldState,
      'hasValue' | 'invalidValues' | 'status'
    >,
  ) => void;
  readonly onUploadAttachment?:
    | ((
        field: FormFieldDefinition,
        file: File,
      ) => Promise<{ readonly id: string }>)
    | undefined;
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly readonly: boolean;
  readonly schema: FormDefinitionSchema;
  readonly style: CSSProperties;
  readonly uiSchema: FormUiSchema;
  readonly value: FormFieldValue | undefined;
  readonly values: FormRendererValues;
}): ReactElement {
  const required = isFormRendererFieldRequired(field, fields, values);
  const fieldReadonly =
    readonly || isFormRendererFieldReadonly(field, fields, values);
  const dataSourceState = useFormDataSourceField({
    context: dataSourceContext,
    field,
    formData: values,
    initialFormData: dataSourceInitialValues,
    initialValue: dataSourceInitialValues?.[field.fieldKey],
    optionSnapshots,
    readonly: fieldReadonly,
    schema,
    uiSchema,
  });
  const dataSourceStatusMessage = readFormDataSourceFieldStatusMessage(
    dataSourceState,
  );
  const dataSourceStateSignature = JSON.stringify({
    hasValue: dataSourceState.hasValue,
    invalidValues: dataSourceState.invalidValues,
    status: dataSourceState.status,
  });

  useEffect((): void => {
    if (!isFormDataSourceFieldDefinition(field)) {
      return;
    }

    onDataSourceStateChange?.(field.fieldKey, {
      hasValue: dataSourceState.hasValue,
      invalidValues: dataSourceState.invalidValues,
      status: dataSourceState.status,
    });
  }, [
    dataSourceStateSignature,
    field.fieldKey,
    onDataSourceStateChange,
  ]);

  return (
    <div data-form-field-key={field.fieldKey} style={style}>
      <BPMFormField
        label={field.label}
        name={field.fieldKey}
        required={required}
      >
        {renderControl(
          field,
          value,
          fieldReadonly,
          onChange,
          onUploadAttachment,
          dataSourceContext,
          dataSourceState,
        )}
      </BPMFormField>
      {error ? (
        <Typography color="text-error" variant="caption">
          {error}
        </Typography>
      ) : null}
      {dataSourceStatusMessage ? (
        <div style={DATA_SOURCE_FEEDBACK_STYLE}>
          <Typography
            color={
              dataSourceState.status === 'INVALID' ||
              dataSourceState.status === 'UNAVAILABLE'
                ? 'text-error'
                : 'text-neutral'
            }
            variant="caption"
          >
            {dataSourceStatusMessage}
          </Typography>
          {dataSourceState.status === 'UNAVAILABLE' && dataSourceState.canRetry ? (
            <Button
              onClick={dataSourceState.retry}
              size="sub"
              type="button"
              variant="base-ghost"
            >
              重試
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const DATA_SOURCE_FEEDBACK_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
};

function renderControl(
  field: FormFieldDefinition,
  value: FormFieldValue | undefined,
  readonly: boolean,
  onChange: (fieldKey: string, value: FormFieldValue | undefined) => void,
  onUploadAttachment:
    | ((
        field: FormFieldDefinition,
        file: File,
      ) => Promise<{ readonly id: string }>)
    | undefined,
  dataSourceContext: FormRendererDataSourceContext | undefined,
  dataSourceState: FormDataSourceFieldState,
): ReactElement {
  if (field.type === 'textarea') {
    return (
      <Textarea
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
          onChange(field.fieldKey, event.target.value)
        }
        placeholder={field.placeholder ?? '請輸入多行文字'}
        readOnly={readonly}
        ref={applyFullWidthTextareaHost}
        rows={3}
        style={TEXTAREA_STYLE}
        value={readStringValue(value)}
      />
    );
  }

  if (field.type === 'boolean') {
    return (
      <Toggle
        checked={value === true}
        disabled={readonly}
        label="啟用"
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(field.fieldKey, event.target.checked)
        }
      />
    );
  }

  if (isFormDataSourceFieldDefinition(field)) {
    return renderDynamicOptionControl(
      field,
      value,
      readonly,
      onChange,
      dataSourceContext,
      dataSourceState,
    );
  }

  if (isFormStaticOptionFieldDefinition(field) && field.type === 'checkbox') {
    const options = field.options.map(readFieldOptionAsSelectOption);

    return (
      <Select
        mode="multiple"
        onChange={(options): void =>
          onChange(
            field.fieldKey,
            options?.length
              ? options.map((option) => option.id)
              : undefined,
          )
        }
        options={options}
        placeholder={field.placeholder ?? '請選擇一或多個選項'}
        readOnly={readonly}
        value={options.filter((option) =>
          readStringArrayValue(value).includes(option.id),
        )}
      />
    );
  }

  if (isFormStaticOptionFieldDefinition(field)) {
    const options = field.options.map(readFieldOptionAsSelectOption);

    return (
      <Select
        onChange={(option): void =>
          onChange(field.fieldKey, option?.id ?? undefined)
        }
        options={options}
        placeholder={field.placeholder ?? '請選擇'}
        readOnly={readonly}
        value={readSelectOption(options, readStringValue(value))}
      />
    );
  }

  if (field.type === 'file_upload') {
    return (
      <Upload
        accept={field.acceptedMimeTypes?.join(',')}
        disabled={readonly}
        maxFiles={field.maxFiles}
        mode="button-list"
        {...((field.maxFiles ?? 1) > 1 ? { multiple: true } : {})}
        onChange={(files): void =>
          onChange(
            field.fieldKey,
            files.length ? files.map((file) => file.id) : undefined,
          )
        }
        onUpload={async (files): Promise<UploadFile[]> =>
          Promise.all(
            files.map(async (file): Promise<UploadFile> => {
              const uploadedFile = onUploadAttachment
                ? await onUploadAttachment(field, file)
                : { id: `${file.name}-${file.lastModified}` };

              return {
                file,
                id: uploadedFile.id,
                progress: 100,
                status: 'done',
              };
            }),
          )
        }
        size="sub"
      />
    );
  }

  if (field.type === 'date') {
    return (
      <DatePicker
        format="YYYY-MM-DD"
        fullWidth
        onChange={(nextValue): void =>
          onChange(field.fieldKey, formatDatePickerValue(nextValue))
        }
        placeholder={field.placeholder ?? readInputPlaceholder(field.type)}
        readOnly={readonly}
        value={readDatePickerValue(value)}
      />
    );
  }

  if (field.type === 'datetime') {
    return (
      <DateTimePicker
        formatDate="YYYY-MM-DD"
        formatTime="HH:mm"
        fullWidth
        hideSecond
        onChange={(nextValue): void =>
          onChange(field.fieldKey, formatDateTimePickerValue(nextValue))
        }
        placeholderLeft="選擇日期"
        placeholderRight="選擇時間"
        readOnly={readonly}
        value={readDatePickerValue(value)}
      />
    );
  }

  if (field.type === 'number' || field.type === 'money') {
    return (
      <Input
        fullWidth
        max={field.maximum}
        min={field.minimum}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(
            field.fieldKey,
            clampOptionalNumber(parseOptionalNumberInput(event.target.value), {
              max: field.maximum,
              min: field.minimum,
            }),
          )
        }
        placeholder={field.placeholder ?? readInputPlaceholder(field.type)}
        {...(readonly ? { readonly: true as const } : {})}
        showSpinner
        value={readNumberInputValue(value)}
        variant="measure"
      />
    );
  }

  return (
    <Input
      fullWidth
      onChange={(event: ChangeEvent<HTMLInputElement>): void =>
        onChange(field.fieldKey, event.target.value)
      }
      placeholder={field.placeholder ?? readInputPlaceholder(field.type)}
      {...(readonly ? { readonly: true as const } : {})}
      value={readStringValue(value)}
      variant="base"
    />
  );
}

function renderDynamicOptionControl(
  field: FormDataSourceOptionFieldDefinition,
  value: FormFieldValue | undefined,
  readonly: boolean,
  onChange: (fieldKey: string, value: FormFieldValue | undefined) => void,
  dataSourceContext: FormRendererDataSourceContext | undefined,
  dataSourceState: FormDataSourceFieldState,
): ReactElement {
  const options = dataSourceState.options.map(readFieldOptionAsSelectOption);
  const selectedOptions = readSelectedFormDataSourceOptions(
    value,
    dataSourceState.options,
  ).map(readFieldOptionAsSelectOption);
  const loading = dataSourceState.status === 'LOADING';
  const waitingForDependencies =
    dataSourceState.status === 'WAITING_FOR_DEPENDENCIES';
  const interactiveSearch = Boolean(dataSourceContext) && !readonly;
  const optionControlDisabled = readonly || waitingForDependencies;
  // AutoComplete alone has no pre-query gate — it only learns a dependency is
  // missing from the answer to a search the filler already typed. Disabling it
  // at that point strands that text in a locked input with no way to clear it,
  // so it stays editable and reports the wait through the status line instead.
  const autoCompleteDisabled = readonly;

  if (field.type === 'autocomplete') {
    if (readFormFieldSelectionMode(field) === 'multiple') {
      return (
        <AutoComplete
          asyncData={interactiveSearch}
          clearSearchText
          disabled={autoCompleteDisabled}
          disabledOptionsFilter={interactiveSearch}
          globalPortal
          loading={loading}
          mode="multiple"
          onChange={(nextOptions): void =>
            onChange(
              field.fieldKey,
              nextOptions.length
                ? nextOptions.map((option) => option.id)
                : undefined,
            )
          }
          onReachBottom={
            dataSourceState.hasNextPage
              ? dataSourceState.onReachBottom
              : undefined
          }
          onSearch={interactiveSearch ? dataSourceState.onSearch : undefined}
          options={options}
          placeholder={field.placeholder ?? '請輸入或選擇'}
          readOnly={readonly}
          searchDebounceTime={300}
          value={selectedOptions}
        />
      );
    }

    return (
      <AutoComplete
        asyncData={interactiveSearch}
        clearSearchText
        disabled={autoCompleteDisabled}
        disabledOptionsFilter={interactiveSearch}
        globalPortal
        loading={loading}
        mode="single"
        onChange={(nextOption): void =>
          onChange(field.fieldKey, nextOption?.id ?? undefined)
        }
        onReachBottom={
          dataSourceState.hasNextPage
            ? dataSourceState.onReachBottom
            : undefined
        }
        onSearch={interactiveSearch ? dataSourceState.onSearch : undefined}
        options={options}
        placeholder={field.placeholder ?? '請輸入或選擇'}
        readOnly={readonly}
        searchDebounceTime={300}
        value={selectedOptions[0] ?? null}
      />
    );
  }

  if (field.type === 'radio') {
    return (
      <RadioGroup
        disabled={optionControlDisabled}
        name={field.fieldKey}
        onChange={(event): void =>
          onChange(field.fieldKey, event.target.value || undefined)
        }
        options={options}
        value={readStringValue(value)}
      />
    );
  }

  if (field.type === 'checkbox') {
    return (
      <CheckboxGroup
        disabled={optionControlDisabled}
        name={field.fieldKey}
        onChange={(event): void =>
          onChange(
            field.fieldKey,
            event.target.values.length ? event.target.values : undefined,
          )
        }
        options={options.map((option) => ({
          label: option.name,
          value: option.id,
        }))}
        value={[...readStringArrayValue(value)]}
      />
    );
  }

  if (readFormFieldSelectionMode(field) === 'multiple') {
    return (
      <Select
        disabled={optionControlDisabled}
        loading={loading}
        mode="multiple"
        onChange={(nextOptions): void =>
          onChange(
            field.fieldKey,
            nextOptions.length
              ? nextOptions.map((option) => option.id)
              : undefined,
          )
        }
        onReachBottom={
          dataSourceState.hasNextPage
            ? dataSourceState.onReachBottom
            : undefined
        }
        options={options}
        placeholder={field.placeholder ?? '請選擇一或多個選項'}
        readOnly={readonly}
        value={selectedOptions}
      />
    );
  }

  return (
    <Select
      disabled={optionControlDisabled}
      loading={loading}
      onChange={(nextOption): void =>
        onChange(field.fieldKey, nextOption?.id ?? undefined)
      }
      onReachBottom={
        dataSourceState.hasNextPage
          ? dataSourceState.onReachBottom
          : undefined
      }
      options={options}
      placeholder={field.placeholder ?? '請選擇'}
      readOnly={readonly}
      value={selectedOptions[0] ?? null}
    />
  );
}

function readFieldColumnSpan(
  field: FormFieldDefinition,
  uiSchema: FormUiSchema,
): number {
  const width =
    uiSchema.layout.find((item) => item.fieldKey === field.fieldKey)?.width ??
    'FULL';
  const spans: Readonly<Record<typeof width, number>> = {
    FULL: 12,
    HALF: 6,
    THIRD: 4,
  };

  return spans[width];
}

function readStringValue(value: FormFieldValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readStringArrayValue(
  value: FormFieldValue | undefined,
): readonly string[] {
  // A table value is also an array, so the element check is what separates a
  // multi-select value from table rows here.
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [];
}

function readNumberInputValue(value: FormFieldValue | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

function readInputPlaceholder(type: FormFieldDefinition['type']): string {
  const placeholders: Readonly<Record<FormFieldDefinition['type'], string>> = {
    boolean: '',
    autocomplete: '請輸入或選擇',
    checkbox: '請選擇一或多個選項',
    date: '請選擇日期',
    datetime: '請選擇日期與時間',
    file_upload: '請上傳附件',
    money: '請輸入金額',
    number: '請輸入數字',
    radio: '請選擇一個選項',
    select: '請選擇一個選項',
    table: '',
    text: '請輸入文字',
    textarea: '請輸入多行文字',
  };

  return placeholders[type];
}

export { FormRenderer as FormRendererView };
