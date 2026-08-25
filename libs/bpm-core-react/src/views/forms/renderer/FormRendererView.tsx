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
  Table,
  Textarea,
  Toggle,
  Typography,
  Upload,
} from '@mezzanine-ui/react';
import type { UploadFile } from '@mezzanine-ui/react/Upload';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { PlusIcon, TrashIcon } from '@mezzanine-ui/icons';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  FormTableRowValue,
  FormUiSchema,
  TableColumnDefinition,
  TableFieldDefinition,
  isFormDataSourceFieldDefinition,
  isFormStaticOptionFieldDefinition,
  isFormTableCellValue,
  isTableFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  buildFormRendererValues,
  clampOptionalNumber,
  createFormTableRow,
  formatDatePickerValue,
  formatDateTimePickerValue,
  FormRendererValues,
  isFormRendererFieldReadonly,
  isFormRendererFieldRequired,
  parseOptionalNumberInput,
  readDatePickerValue,
  readFieldOptionAsSelectOption,
  readFormTableCellPath,
  readFormTableRowBounds,
  readFormTableRows,
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
        // `maxWidth` is applied per field rather than to the grid, so a table
        // field can use the full content width while every other field keeps
        // the single-column reading width (docs/17 P4).
        ...(singleColumn ? { width: '100%' } : {}),
      }}
    >
      {visibleFields.map((field) => (
        <FormRendererField
          dataSourceContext={dataSourceContext}
          dataSourceInitialValues={dataSourceInitialValues}
          field={field}
          error={errors[field.fieldKey] ?? null}
          errors={errors}
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
            ...(singleColumn && !isTableFieldDefinition(field)
              ? { maxWidth }
              : {}),
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
  errors,
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
  /**
   * The whole error map, not just this field's line: a table addresses its
   * cells by instance path, so it needs the keys of its own rows too
   * (ADR 16 §3.3).
   */
  readonly errors: Readonly<Record<string, string>>;
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
        {isTableFieldDefinition(field) ? (
          <FormTableField
            dataSourceContext={dataSourceContext}
            dataSourceInitialValues={dataSourceInitialValues}
            errors={errors}
            field={field}
            onChange={onChange}
            onDataSourceStateChange={onDataSourceStateChange}
            optionSnapshots={optionSnapshots}
            readonly={fieldReadonly}
            schema={schema}
            uiSchema={uiSchema}
            value={value}
            values={values}
          />
        ) : (
          renderControl(
            field,
            value,
            fieldReadonly,
            onChange,
            onUploadAttachment,
            dataSourceContext,
            dataSourceState,
          )
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

const TABLE_FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  width: '100%',
};

const TABLE_FIELD_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
};

const TABLE_SCROLLER_STYLE: CSSProperties = {
  maxWidth: '100%',
  overflowX: 'auto',
};

// Mezzanine `Table` fills whatever box it is given, so an `overflow-x: auto`
// wrapper on its own never scrolls: the columns just keep shrinking. Keeping
// the table out of the single-column reading width is what stops a control
// from overflowing its own cell; this floor is the defence for tables wide
// enough that even the full width would squeeze them, and it is what makes the
// wrapper actually scroll when that happens.
const TABLE_COLUMN_MIN_WIDTH = 160;
const TABLE_ACTIONS_COLUMN_WIDTH = 56;

const TABLE_CELL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
};

type FormTableRowRecord = Readonly<
  Record<string, unknown> & {
    index: number;
    key: string;
  }
>;

/**
 * Rows carry no identity in `formData` — array order is display order
 * (ADR 16 §3.2) — so the React key and, from P3, the per-cell DataSource state
 * key come from an ephemeral id minted here and never written to the value.
 */
function FormTableField({
  dataSourceContext,
  dataSourceInitialValues,
  errors,
  field,
  onChange,
  onDataSourceStateChange,
  optionSnapshots,
  readonly,
  schema,
  uiSchema,
  value,
  values,
}: {
  readonly dataSourceContext?: FormRendererDataSourceContext;
  readonly dataSourceInitialValues?: FormRendererValues;
  readonly errors: Readonly<Record<string, string>>;
  readonly field: TableFieldDefinition;
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
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly readonly: boolean;
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
  readonly value: FormFieldValue | undefined;
  readonly values: FormRendererValues;
}): ReactElement {
  const rows = readFormTableRows(value);
  const bounds = readFormTableRowBounds(field);
  const rowIdSequenceRef = useRef(0);
  const [rowIds, setRowIds] = useState<readonly string[]>(() =>
    rows.map((): string => createRowId(rowIdSequenceRef)),
  );

  // The value can also change from outside (a parent reset, a returned case
  // loading its saved rows). Re-mint ids only then, so ordinary edits keep the
  // per-row identity stable.
  useEffect((): void => {
    if (rowIds.length === rows.length) {
      return;
    }

    setRowIds(rows.map((): string => createRowId(rowIdSequenceRef)));
  }, [rowIds.length, rows.length]);

  function commitRows(nextRows: readonly FormTableRowValue[]): void {
    onChange(field.fieldKey, nextRows);
  }

  function handleAddRow(): void {
    setRowIds([...rowIds, createRowId(rowIdSequenceRef)]);
    commitRows([...rows, createFormTableRow(field.columns)]);
  }

  function handleRemoveRow(rowIndex: number): void {
    setRowIds(rowIds.filter((_, index) => index !== rowIndex));
    commitRows(rows.filter((_, index) => index !== rowIndex));
  }

  function handleCellChange(
    rowIndex: number,
    columnKey: string,
    cellValue: FormFieldValue | undefined,
  ): void {
    commitRows(
      rows.map((row, index) =>
        index === rowIndex
          ? readNextTableRow(row, columnKey, cellValue)
          : row,
      ),
    );
  }

  const dataSource: readonly FormTableRowRecord[] = rows.map((row, index) => ({
    ...row,
    index,
    key: rowIds[index] ?? `row-${index}`,
  }));
  const columns: TableColumn<FormTableRowRecord>[] = field.columns.map(
    (column) => ({
      key: column.fieldKey,
      render: (row): ReactElement => (
        <FormTableCell
          column={column}
          dataSourceContext={dataSourceContext}
          error={
            errors[
              readFormTableCellPath(field.fieldKey, row.index, column.fieldKey)
            ] ?? null
          }
          fieldPath={`${field.fieldKey}.${column.fieldKey}`}
          formData={values}
          initialFormData={dataSourceInitialValues}
          initialRowValues={readInitialTableRow(
            dataSourceInitialValues?.[field.fieldKey],
            row.index,
          )}
          // Keyed by the ephemeral row id, so a cell's DataSource state follows
          // its row rather than its position (ADR 16 §3.9).
          key={`${rowIds[row.index] ?? row.index}-${column.fieldKey}`}
          onChange={(cellValue): void =>
            handleCellChange(row.index, column.fieldKey, cellValue)
          }
          onDataSourceStateChange={onDataSourceStateChange}
          optionSnapshots={optionSnapshots}
          path={readFormTableCellPath(
            field.fieldKey,
            row.index,
            column.fieldKey,
          )}
          readonly={readonly}
          rowValues={rows[row.index] ?? {}}
          schema={schema}
          uiSchema={uiSchema}
        />
      ),
      title: column.label || column.fieldKey,
    }),
  );
  const actions: TableActions<FormTableRowRecord> | undefined = readonly
    ? undefined
    : {
        render: (row): ReturnType<TableActions<FormTableRowRecord>['render']> => [
          {
            disabled: (): boolean => rows.length <= bounds.minRows,
            icon: TrashIcon,
            iconType: 'icon-only',
            name: '刪除此列',
            onClick: (): void => handleRemoveRow(row.index),
            variant: 'destructive-ghost',
          },
        ],
        width: 56,
      };

  return (
    <div style={TABLE_FIELD_STYLE}>
      {/*
        Mezzanine `Table`'s `scroll` is vertical only, so a wide table is kept
        inside its own horizontal scroller rather than pushing the page sideways.
        The wrapper adds no styling of its own to the table (ADR 16 §3.9 assumed
        `scroll` covered this; see docs/17).
      */}
      <div style={TABLE_SCROLLER_STYLE}>
        <div
          style={{
            minWidth:
              field.columns.length * TABLE_COLUMN_MIN_WIDTH +
              (actions ? TABLE_ACTIONS_COLUMN_WIDTH : 0),
          }}
        >
          <Table
            {...(actions ? { actions } : {})}
            columns={columns}
            dataSource={[...dataSource]}
            showHeader
            size="sub"
          />
        </div>
      </div>
      {readonly ? null : (
        <div style={TABLE_FIELD_ACTIONS_STYLE}>
          <Button
            disabled={rows.length >= bounds.maxRows}
            icon={PlusIcon}
            iconType="leading"
            onClick={handleAddRow}
            size="sub"
            type="button"
            variant="base-secondary"
          >
            {field.addRowLabel || '新增一列'}
          </Button>
        </div>
      )}
    </div>
  );
}

function FormTableCell({
  column,
  dataSourceContext,
  error,
  fieldPath,
  formData,
  initialFormData,
  initialRowValues,
  onChange,
  onDataSourceStateChange,
  optionSnapshots,
  path,
  readonly,
  rowValues,
  schema,
  uiSchema,
}: {
  readonly column: TableColumnDefinition;
  readonly dataSourceContext?: FormRendererDataSourceContext;
  readonly error: string | null;
  readonly fieldPath: string;
  readonly formData: FormRendererValues;
  readonly initialFormData?: FormRendererValues;
  readonly initialRowValues?: FormTableRowValue;
  readonly onChange: (value: FormFieldValue | undefined) => void;
  readonly onDataSourceStateChange?: (
    fieldKey: string,
    state: Pick<
      FormDataSourceFieldState,
      'hasValue' | 'invalidValues' | 'status'
    >,
  ) => void;
  readonly optionSnapshots?: FormDataSourceValueSnapshots;
  readonly path: string;
  readonly readonly: boolean;
  readonly rowValues: FormTableRowValue;
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
}): ReactElement {
  const value = readTableCellValue(rowValues, column.fieldKey);
  const dataSourceState = useFormDataSourceField({
    context: dataSourceContext,
    field: column,
    fieldPath,
    formData,
    initialFormData,
    initialValue: initialRowValues
      ? readTableCellValue(initialRowValues, column.fieldKey)
      : undefined,
    optionSnapshots,
    readonly,
    row: {
      initialValues: initialRowValues,
      values: rowValues,
    },
    schema,
    snapshotKey: path,
    uiSchema,
  });
  const statusMessage = readFormDataSourceFieldStatusMessage(dataSourceState);
  const stateSignature = JSON.stringify({
    hasValue: dataSourceState.hasValue,
    invalidValues: dataSourceState.invalidValues,
    status: dataSourceState.status,
  });

  useEffect((): (() => void) | void => {
    if (!isFormDataSourceFieldDefinition(column)) {
      return;
    }

    onDataSourceStateChange?.(path, {
      hasValue: dataSourceState.hasValue,
      invalidValues: dataSourceState.invalidValues,
      status: dataSourceState.status,
    });

    // A deleted row must stop blocking the submit it can no longer be fixed in.
    return (): void => {
      onDataSourceStateChange?.(path, {
        hasValue: false,
        invalidValues: [],
        status: 'IDLE',
      });
    };
  }, [onDataSourceStateChange, path, stateSignature]);

  return (
    <div data-form-field-key={path} style={TABLE_CELL_STYLE}>
      {renderControl(
        column,
        value,
        readonly,
        (_columnKey, nextValue): void => onChange(nextValue),
        undefined,
        dataSourceContext,
        dataSourceState,
      )}
      {error ? (
        <Typography color="text-error" variant="caption">
          {error}
        </Typography>
      ) : null}
      {statusMessage ? (
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
            {statusMessage}
          </Typography>
          {dataSourceState.status === 'UNAVAILABLE' &&
          dataSourceState.canRetry ? (
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

/**
 * The row as it was loaded, used to tell a returned case's stored values from
 * edits. Absent when the table itself is new.
 */
function readInitialTableRow(
  value: FormFieldValue | undefined,
  rowIndex: number,
): FormTableRowValue | undefined {
  return readFormTableRows(value)[rowIndex];
}

function createRowId(sequenceRef: { current: number }): string {
  sequenceRef.current += 1;

  return `table-row-${sequenceRef.current}`;
}

/**
 * Clearing a cell removes the key instead of storing `undefined`: the row is
 * serialised to JSON, where `undefined` would vanish anyway, and an absent key
 * is what an untouched cell looks like.
 */
function readNextTableRow(
  row: FormTableRowValue,
  columnKey: string,
  value: FormFieldValue | undefined,
): FormTableRowValue {
  if (typeof value === 'undefined' || !isFormTableCellValue(value)) {
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== columnKey),
    );
  }

  return { ...row, [columnKey]: value };
}

function readTableCellValue(
  row: FormTableRowValue | undefined,
  columnKey: string,
): FormFieldValue | undefined {
  if (!row || !Object.prototype.hasOwnProperty.call(row, columnKey)) {
    return undefined;
  }

  return row[columnKey];
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
  dataSourceContext: FormRendererDataSourceContext | undefined,
  dataSourceState: FormDataSourceFieldState,
): ReactElement {
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

  return renderStaticControl(field, value, readonly, onChange, onUploadAttachment);
}

/**
 * Every control that does not depend on a DataSource. Split out of
 * {@link renderControl} so a table cell can reuse the same controls without
 * carrying a field-level DataSource state it has no use for (ADR 16 §3.9).
 */
function renderStaticControl(
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
