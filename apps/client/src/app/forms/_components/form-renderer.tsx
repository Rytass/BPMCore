'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DatePicker,
  DateTimePicker,
  Input,
  Select,
  Textarea,
  Toggle,
  Typography,
  Upload,
} from '@mezzanine-ui/react';
import type { UploadFile } from '@mezzanine-ui/react/Upload';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  FormUiSchema,
} from '@bpm/shared/form';
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
  readSelectOption,
  readVisibleFormRendererFields,
} from '../_lib/form-rendering';
import { BPMFormField } from '../../_components/bpm-form-field';

export interface FormRendererProps {
  readonly emptyText?: string;
  readonly maxWidth?: CSSProperties['maxWidth'];
  readonly onChange?: (values: FormRendererValues) => void;
  readonly onUploadAttachment?: (
    field: FormFieldDefinition,
    file: File,
  ) => Promise<{ readonly id: string }>;
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
  emptyText = '尚未建立欄位。',
  maxWidth,
  onChange,
  onUploadAttachment,
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
  const visibleFields = useMemo(
    (): readonly FormFieldDefinition[] =>
      readVisibleFormRendererFields(schema, uiSchema, values),
    [schema, uiSchema, values],
  );

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
      ...values,
      [fieldKey]: nextValue,
    };

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
          field={field}
          fields={schema.fields}
          key={field.fieldKey}
          onChange={updateValue}
          onUploadAttachment={onUploadAttachment}
          readonly={readonly}
          style={{
            ...FORM_RENDERER_FIELD_STYLE,
            gridColumn: `span ${
              singleColumn ? 12 : readFieldColumnSpan(field, uiSchema)
            }`,
          }}
          value={values[field.fieldKey]}
          values={values}
        />
      ))}
    </div>
  );
}

function FormRendererField({
  field,
  fields,
  onChange,
  onUploadAttachment,
  readonly,
  style,
  value,
  values,
}: {
  readonly field: FormFieldDefinition;
  readonly fields: readonly FormFieldDefinition[];
  readonly onChange: (
    fieldKey: string,
    value: FormFieldValue | undefined,
  ) => void;
  readonly onUploadAttachment?:
    | ((
        field: FormFieldDefinition,
        file: File,
      ) => Promise<{ readonly id: string }>)
    | undefined;
  readonly readonly: boolean;
  readonly style: CSSProperties;
  readonly value: FormFieldValue | undefined;
  readonly values: FormRendererValues;
}): ReactElement {
  const required = isFormRendererFieldRequired(field, fields, values);
  const fieldReadonly =
    readonly || isFormRendererFieldReadonly(field, fields, values);

  return (
    <div style={style}>
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
        )}
      </BPMFormField>
    </div>
  );
}

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

  if (field.type === 'checkbox') {
    const options = field.options.map(readFieldOptionAsSelectOption);

    return (
      <Select
        mode="multiple"
        onChange={(options): void =>
          onChange(
            field.fieldKey,
            options.length ? options.map((option) => option.id) : undefined,
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

  if (field.type === 'select' || field.type === 'radio') {
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
  return Array.isArray(value) ? value : [];
}

function readNumberInputValue(value: FormFieldValue | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

function readInputPlaceholder(type: FormFieldDefinition['type']): string {
  const placeholders: Readonly<Record<FormFieldDefinition['type'], string>> = {
    boolean: '',
    checkbox: '請選擇一或多個選項',
    date: '請選擇日期',
    datetime: '請選擇日期與時間',
    file_upload: '請上傳附件',
    money: '請輸入金額',
    number: '請輸入數字',
    radio: '請選擇一個選項',
    select: '請選擇一個選項',
    text: '請輸入文字',
    textarea: '請輸入多行文字',
  };

  return placeholders[type];
}
