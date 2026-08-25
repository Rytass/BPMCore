'use client';

import {
  ChangeEvent,
  CSSProperties,
  Key,
  MouseEvent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DropResult,
} from '@hello-pangea/dnd';
import {
  Accordion,
  BaseCard,
  Badge,
  Button,
  DatePicker,
  DateTimePicker,
  Icon,
  Input,
  Modal,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Table,
  Textarea,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import {
  AlignLeftIcon,
  CalendarIcon,
  CheckedIcon,
  CheckedOutlineIcon,
  CurrencyDollarIcon,
  DotDragVerticalIcon,
  DotGridIcon,
  FileAttachmentIcon,
  FileIcon,
  ListIcon,
  PlusIcon,
  SettingIcon,
  TrashIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  BooleanFieldDefinition,
  DateFieldDefinition,
  FORM_TABLE_MAX_ROWS,
  FormDataSourceBinding,
  FormDataSourceOptionFieldDefinition,
  FileUploadFieldDefinition,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormOptionFieldDefinition,
  FormStaticOptionFieldDefinition,
  FormUiSchema,
  NumberFieldDefinition,
  TableColumnDefinition,
  TableFieldDefinition,
  TextFieldDefinition,
  isFormDataSourceFieldDefinition,
  isFormOptionFieldDefinition,
  isTableColumnFieldType,
  isTableFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  createFieldDefinition,
  createTableColumnDefinition,
  isFormDataSourceDescriptorCompatible,
  lintFormSchema,
  listFormDataSources,
  readCompatibleFormDataSourceBindingFields,
  readCompatibleFormDataSourceDescriptors,
  readFormDataSourceBinding,
  readFormDataSourceBindingValue,
  readFormSchemaLintMessage,
  readFormDataSourceBindingValueKind,
  readFormDataSourceFieldDependencyKeys,
  renameFormDataSourceFieldBindings,
  renameFormTableColumnBindings,
  upsertFormDataSourceFieldBinding,
  type FormDataSourceDescriptorRecord,
  type FormDataSourceParameterType,
} from '@rytass/bpm-core-client/form';
import {
  buildConditionExpression,
  buildFormRendererValues,
  clampOptionalNumber,
  formatDatePickerValue,
  formatDateTimePickerValue,
  FormRendererValues,
  isDateFieldDefinition,
  isNumberFieldDefinition,
  isSelectFieldDefinition,
  parseConditionRule,
  parseOptionalNumberInput,
  readConditionOperatorOption,
  readConditionOperatorOptions,
  readDatePickerValue,
  readDefaultConditionOperator,
  readDefaultConditionValue,
  readFieldOptionAsSelectOption,
  readFormTableRowBounds,
  readSelectOption,
} from '@rytass/bpm-core-client/form';
import { BPMFormField } from '../../../components/bpm-form-field';
import { FormRenderer } from '../renderer/FormRendererView';
import { JsonCodeEditor } from './json-code-editor';

type FieldType = FormFieldDefinition['type'];
type BuilderTabKey = 'design' | 'preview' | 'advanced';
type FieldOptionRow = Readonly<
  Record<string, unknown> & {
    index: number;
    key: string;
    label: string;
    value: string;
  }
>;

type FieldTypeOption = Readonly<{
  description: string;
  icon: IconDefinition;
  label: string;
  type: FieldType;
}>;

type TableColumnRow = Readonly<
  Record<string, unknown> & {
    fieldKey: string;
    index: number;
    key: string;
    label: string;
    type: TableColumnDefinition['type'];
  }
>;

type ConditionRuleTarget = 'readonlyWhen' | 'requiredWhen' | 'visibleWhen';

type ConditionRuleConfig = Readonly<{
  label: string;
  name: string;
  supportingText: string;
  target: ConditionRuleTarget;
}>;

type DataSourceCatalogState = 'loading' | 'ready' | 'unavailable';
type FormDataSourceConstantValue = string | number | boolean | null;

/**
 * How a settings renderer hands back an edited field. Passing the whole next
 * field (rather than a patch) keeps one signature for every field type, and
 * lets the same renderer serve a top-level field or a table column — the caller
 * decides where the result is written (ADR 16 §3.9).
 */
type FieldCommit<TField extends FormFieldDefinition> = (nextField: TField) => void;

/**
 * A change that needs confirmation before it touches the schema, because it can
 * invalidate existing options, bindings or default values.
 */
type OptionFieldChangeRequester = (
  field: FormOptionFieldDefinition,
  nextField: FormOptionFieldDefinition,
  impact?: string,
) => void;

type PendingBuilderConfirmation =
  | Readonly<{
      affectedFieldKeys: readonly string[];
      kind: 'remove-field';
      fieldKey: string;
    }>
  | Readonly<{
      fieldKey: string;
      impact: string;
      kind: 'replace-field';
      nextField: FormFieldDefinition;
    }>
  | Readonly<{
      columnKey: string;
      fieldKey: string;
      kind: 'remove-column';
    }>
  | Readonly<{
      columnKey: string;
      fieldKey: string;
      impact: string;
      kind: 'replace-column';
      nextColumn: TableColumnDefinition;
    }>;

const FIELD_TYPE_OPTIONS: readonly FieldTypeOption[] = [
  {
    description: '單行文字、姓名、編號',
    icon: AlignLeftIcon,
    label: '文字',
    type: 'text',
  },
  {
    description: '多行補充內容',
    icon: FileIcon,
    label: '長文字',
    type: 'textarea',
  },
  {
    description: '金額、數量、分數',
    icon: CurrencyDollarIcon,
    label: '數字',
    type: 'number',
  },
  {
    description: '金額與費用',
    icon: CurrencyDollarIcon,
    label: '金額',
    type: 'money',
  },
  {
    description: '日期或到期日',
    icon: CalendarIcon,
    label: '日期',
    type: 'date',
  },
  {
    description: '日期與時間',
    icon: CalendarIcon,
    label: '日期時間',
    type: 'datetime',
  },
  {
    description: '是 / 否狀態',
    icon: CheckedIcon,
    label: '開關',
    type: 'boolean',
  },
  {
    description: '固定選項擇一',
    icon: ListIcon,
    label: '下拉選單',
    type: 'select',
  },
  {
    description: '可搜尋的固定選項',
    icon: ListIcon,
    label: '自動完成',
    type: 'autocomplete',
  },
  {
    description: '固定選項單選',
    icon: DotGridIcon,
    label: '單選',
    type: 'radio',
  },
  {
    description: '固定選項複選',
    icon: CheckedOutlineIcon,
    label: '複選',
    type: 'checkbox',
  },
  {
    description: '附件或佐證資料',
    icon: FileAttachmentIcon,
    label: '附件',
    type: 'file_upload',
  },
  {
    description: '多列多欄明細',
    icon: DotGridIcon,
    label: '表格',
    type: 'table',
  },
];

/**
 * Column types a table accepts (ADR 16 §3.10). `textarea`, `radio`, `checkbox`,
 * `file_upload` and a nested `table` are excluded, so the picker is built from
 * the field library minus those rather than from a second hand-kept list.
 */
const TABLE_COLUMN_TYPE_OPTIONS: readonly {
  readonly id: TableColumnDefinition['type'];
  readonly name: string;
}[] = FIELD_TYPE_OPTIONS.filter((option) =>
  isTableColumnFieldType(option.type),
).map((option) => ({
  id: option.type as TableColumnDefinition['type'],
  name: option.label,
}));

const WORKSPACE_GRID_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
};

const CANVAS_COLUMN_STYLE: CSSProperties = {
  flex: '0.55 1 300px',
  minWidth: 0,
};

const SETTINGS_COLUMN_STYLE: CSSProperties = {
  flex: '1.45 1 720px',
  minWidth: 620,
};

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const FIELD_LIBRARY_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const FIELD_LIBRARY_BUTTON_STYLE: CSSProperties = {
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
};

const FIELD_LIBRARY_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const FIELD_BLOCK_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  cursor: 'grab',
  display: 'flex',
  gap: 12,
  touchAction: 'none',
};

const FIELD_BLOCK_TEXT_STYLE: CSSProperties = {
  display: 'grid',
  flex: '1 1 auto',
  gap: 2,
  minWidth: 0,
};

const FIELD_BLOCK_ACTIONS_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flex: '0 0 auto',
  gap: 4,
};

const FIELD_BLOCK_REQUIRED_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 6,
};

const FIELD_BLOCK_STYLE: CSSProperties = {
  cursor: 'pointer',
  userSelect: 'none',
};

const FIELD_BLOCK_DRAGGING_STYLE: CSSProperties = {
  filter: 'drop-shadow(0 8px 18px rgba(0, 0, 0, 0.12))',
};

// Selected field: tint the whole card with a light brand fill over the surface
// so the active row is obvious without relying on the (removed) edit button.
const FIELD_BLOCK_SELECTED_CARD_STYLE: CSSProperties = {
  backgroundColor:
    'color-mix(in srgb, var(--mzn-color-primary) 8%, var(--mzn-color-bg-surface))',
  boxShadow: 'inset 0 0 0 1px var(--mzn-color-border-primary)',
};

const EMPTY_CANVAS_STYLE: CSSProperties = {
  alignItems: 'center',
  border: '1px dashed var(--mzn-color-border-neutral)',
  borderRadius: 6,
  display: 'grid',
  gap: 12,
  minHeight: 240,
  padding: 32,
  textAlign: 'center',
};

const EMPTY_CANVAS_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
};

const FIELD_SETTINGS_FORM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 14,
};

const FIELD_SETTINGS_SECTION_STYLE: CSSProperties = {
  display: 'grid',
  columnGap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  rowGap: 8,
};

const FIELD_SETTINGS_SECTION_TITLE_STYLE: CSSProperties = {
  gridColumn: '1 / -1',
};

const FIELD_SETTINGS_BADGE_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
  gridColumn: '1 / -1',
  justifyContent: 'flex-end',
};

const FIELD_SETTINGS_HINT_STYLE: CSSProperties = {
  gridColumn: '1 / -1',
};

const FIELD_SETTINGS_ROW_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'block',
  width: '100%',
};

const FIELD_SETTINGS_ROW_WIDE_STYLE: CSSProperties = {
  ...FIELD_SETTINGS_ROW_STYLE,
  gridColumn: '1 / -1',
};

const FIELD_SETTINGS_VALUE_STYLE: CSSProperties = {
  minWidth: 0,
  width: '100%',
};

const FIELD_SETTINGS_TEXTAREA_STYLE: CSSProperties = {
  minWidth: '100%',
  width: '100%',
};

const ADVANCED_SCHEMA_FORM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 14,
};

const ADVANCED_SCHEMA_ROW_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'block',
  width: '100%',
};

const ADVANCED_SCHEMA_VALUE_STYLE: CSSProperties = {
  minWidth: 0,
  width: '100%',
};

const ADVANCED_SCHEMA_MESSAGE_STYLE: CSSProperties = {
  gridColumn: '2 / -1',
};

const CONDITION_RULE_CONTROL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  width: '100%',
};

const CONDITION_RULE_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
};

const DRAG_HANDLE_STYLE: CSSProperties = {
  display: 'inline-flex',
};

const WORKBENCH_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const COMPACT_STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const OPTION_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const REQUIRED_ASTERISK_STYLE: CSSProperties = {
  color: 'var(--mzn-color-text-error)',
  fontSize: '0.72em',
  lineHeight: 0,
  marginLeft: 2,
  verticalAlign: 'super',
};

const DATA_SOURCE_SETTINGS_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridColumn: '1 / -1',
};

const DATA_SOURCE_SUMMARY_STYLE: CSSProperties = {
  backgroundColor: 'var(--mzn-color-bg-surface-secondary)',
  borderRadius: 6,
  display: 'grid',
  gap: 4,
  padding: 10,
};

const TABLE_COLUMN_SETTINGS_STYLE: CSSProperties = {
  backgroundColor: 'var(--mzn-color-bg-surface-secondary)',
  borderRadius: 6,
  display: 'grid',
  gap: 10,
  gridColumn: '1 / -1',
  padding: 12,
};

const DATA_SOURCE_PARAMETER_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'minmax(180px, 0.7fr) minmax(220px, 1.3fr)',
};

function applyFullWidthTextareaHost(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }

  element.style.width = '100%';
}

const EMPTY_SCHEMA: FormDefinitionSchema = {
  fields: [],
  schemaVersion: 1,
};

const EMPTY_UI_SCHEMA: FormUiSchema = {
  layout: [],
  schemaVersion: 1,
};

const STATIC_OPTION_SOURCE_ID = '__STATIC_OPTIONS__';
const CONSTANT_BINDING_ID = '__CONSTANT__';
const UNBOUND_BINDING_ID = '__UNBOUND__';

const OPTION_SOURCE_KIND_OPTIONS: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  { id: STATIC_OPTION_SOURCE_ID, name: '靜態選項' },
];

const OPTION_MODE_OPTIONS: readonly {
  readonly id: 'multiple' | 'single';
  readonly name: string;
}[] = [
  { id: 'single', name: '單選' },
  { id: 'multiple', name: '複選' },
];

const BOOLEAN_DEFAULT_OPTIONS: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  { id: 'unset', name: '不預設' },
  { id: 'true', name: '是' },
  { id: 'false', name: '否' },
];

const BOOLEAN_CONDITION_VALUE_OPTIONS: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  { id: 'true', name: '是' },
  { id: 'false', name: '否' },
];

const CONDITION_RULE_CONFIGS: readonly ConditionRuleConfig[] = [
  {
    label: '顯示',
    name: 'fieldVisibleWhen',
    supportingText: '符合條件時才顯示這個欄位。',
    target: 'visibleWhen',
  },
  {
    label: '必填',
    name: 'fieldRequiredWhen',
    supportingText: '符合條件時才要求填寫這個欄位。',
    target: 'requiredWhen',
  },
  {
    label: '唯讀',
    name: 'fieldReadonlyWhen',
    supportingText: '符合條件時不允許修改這個欄位。',
    target: 'readonlyWhen',
  },
];

export interface FormBuilderViewProps {
  /**
   * Initial (or controlled) schema value.
   * If omitted, the builder starts with empty schema / uiSchema.
   */
  readonly value?: {
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
  };

  /** Called whenever the schema or uiSchema changes. */
  readonly onChange?: (next: {
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
  }) => void;
}

export function FormBuilderView({
  onChange,
  value,
}: FormBuilderViewProps): ReactElement {
  const initialSchema = value?.schema ?? EMPTY_SCHEMA;
  const initialUiSchema = value?.uiSchema ?? EMPTY_UI_SCHEMA;
  const [schema, setSchema] = useState<FormDefinitionSchema>(initialSchema);
  const [uiSchema, setUiSchema] = useState<FormUiSchema>(initialUiSchema);
  const [schemaJsonText, setSchemaJsonText] = useState(
    stringifyJson(initialSchema),
  );
  const [uiSchemaJsonText, setUiSchemaJsonText] = useState(
    stringifyJson(initialUiSchema),
  );
  const [previewValues, setPreviewValues] = useState<FormRendererValues>({});
  const [advancedSchemaMessage, setAdvancedSchemaMessage] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<BuilderTabKey>('design');
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [dataSourceCatalog, setDataSourceCatalog] = useState<
    readonly FormDataSourceDescriptorRecord[]
  >([]);
  const [dataSourceCatalogError, setDataSourceCatalogError] = useState<
    string | null
  >(null);
  const [dataSourceCatalogState, setDataSourceCatalogState] =
    useState<DataSourceCatalogState>('loading');
  const [dataSourceLint, setDataSourceLint] = useState<
    readonly string[] | null
  >(null);
  const [dataSourceLintLoading, setDataSourceLintLoading] = useState(false);
  const [pendingBuilderConfirmation, setPendingBuilderConfirmation] =
    useState<PendingBuilderConfirmation | null>(null);
  const [selectedColumnKey, setSelectedColumnKey] = useState<string | null>(
    null,
  );

  useEffect((): (() => void) => {
    let active = true;

    void listFormDataSources()
      .then((descriptors): void => {
        if (!active) {
          return;
        }

        setDataSourceCatalog(descriptors);
        setDataSourceCatalogError(null);
        setDataSourceCatalogState('ready');
      })
      .catch((requestError: unknown): void => {
        if (!active) {
          return;
        }

        setDataSourceCatalog([]);
        void requestError;
        setDataSourceCatalogError('目前無法載入 DataSource Catalog，請稍後重試。');
        setDataSourceCatalogState('unavailable');
      });

    return (): void => {
      active = false;
    };
  }, []);
  useEffect((): void => {
    const hasSelectedField = schema.fields.some(
      (field) => field.fieldKey === selectedFieldKey,
    );

    if (hasSelectedField) {
      return;
    }

    setSelectedFieldKey(schema.fields[0]?.fieldKey ?? null);
  }, [schema.fields, selectedFieldKey]);

  useEffect((): void => {
    setPreviewValues((currentValues) =>
      buildFormRendererValues(schema.fields, currentValues),
    );
  }, [schema.fields]);

  useEffect((): void => {
    if (activeTab === 'advanced') {
      return;
    }

    setSchemaJsonText(stringifyJson(schema));
    setUiSchemaJsonText(stringifyJson(uiSchema));
  }, [activeTab, schema, uiSchema]);

  const selectedField = useMemo(
    (): FormFieldDefinition | null =>
      schema.fields.find((field) => field.fieldKey === selectedFieldKey) ??
      schema.fields[0] ??
      null,
    [schema.fields, selectedFieldKey],
  );
  useEffect((): void => {
    onChange?.({ schema, uiSchema });
  }, [schema, uiSchema]);

  function handleAddField(type: FieldType): void {
    const nextIndex = schema.fields.length + 1;
    const field = createFieldDefinition(type, nextIndex);

    setSchema({
      ...schema,
      fields: [...schema.fields, field],
    });
    setUiSchema({
      ...uiSchema,
      layout: [
        ...uiSchema.layout,
        {
          fieldKey: field.fieldKey,
          // A table must be FULL width or the publish lint rejects it
          // (ADR 16 §3.7).
          width:
            type === 'textarea' || type === 'file_upload' || type === 'table'
              ? 'FULL'
              : 'HALF',
        },
      ],
    });
    setSelectedFieldKey(field.fieldKey);
    setActiveTab('design');
    setAdvancedSchemaMessage(null);
  }

  function handleTabChange(activeKey: Key): void {
    const nextTab = activeKey as BuilderTabKey;

    if (nextTab === 'advanced' && activeTab !== 'advanced') {
      setSchemaJsonText(stringifyJson(schema));
      setUiSchemaJsonText(stringifyJson(uiSchema));
    }

    setActiveTab(nextTab);
  }

  function handleRemoveField(fieldKey: string): void {
    const affectedFieldKeys = schema.fields.flatMap((field) =>
      isFormDataSourceFieldDefinition(field) &&
      readFormDataSourceFieldDependencyKeys(field).includes(fieldKey)
        ? [field.fieldKey]
        : [],
    );

    if (affectedFieldKeys.length > 0) {
      setPendingBuilderConfirmation({
        affectedFieldKeys,
        fieldKey,
        kind: 'remove-field',
      });

      return;
    }

    applyRemoveField(fieldKey);
  }

  function applyRemoveField(fieldKey: string): void {
    const remainingFields = schema.fields.filter(
      (field) => field.fieldKey !== fieldKey,
    );

    setSchema({
      ...schema,
      fields: remainingFields,
    });
    setUiSchema({
      ...uiSchema,
      layout: uiSchema.layout.filter((item) => item.fieldKey !== fieldKey),
    });
    setSelectedFieldKey(
      selectedFieldKey === fieldKey
        ? (remainingFields[0]?.fieldKey ?? null)
        : selectedFieldKey,
    );
    setAdvancedSchemaMessage(null);
    setDataSourceLint(null);
  }

  function handleFieldDragEnd(result: DropResult): void {
    const destination = result.destination;

    if (!destination) {
      return;
    }

    if (result.source.index === destination.index) {
      return;
    }

    setSchema((currentSchema) => ({
      ...currentSchema,
      fields: moveItemByIndex(
        currentSchema.fields,
        result.source.index,
        destination.index,
      ),
    }));
    setUiSchema((currentUiSchema) => ({
      ...currentUiSchema,
      layout: moveItemByIndex(
        currentUiSchema.layout,
        result.source.index,
        destination.index,
      ),
    }));
    setAdvancedSchemaMessage(null);
  }

  function updateSelectedField(
    patch: Partial<
      Pick<
        FormFieldDefinition,
        | 'defaultValue'
        | 'fieldKey'
        | 'label'
        | 'placeholder'
        | 'readonlyWhen'
        | 'required'
        | 'requiredWhen'
        | 'visibleWhen'
      >
    >,
  ): void {
    updateSelectedFieldWith(
      (field) => ({ ...field, ...patch }) as FormFieldDefinition,
    );
  }

  function updateSelectedFieldWith(
    updater: (field: FormFieldDefinition) => FormFieldDefinition,
  ): void {
    if (!selectedField) {
      return;
    }

    const previousFieldKey = selectedField.fieldKey;
    const nextField = updater(selectedField);
    const nextFieldKey = nextField.fieldKey;

    const updatedSchema = {
      ...schema,
      fields: schema.fields.map(
        (field): FormFieldDefinition =>
          field.fieldKey === previousFieldKey ? nextField : field,
      ),
    };
    const nextSchema =
      previousFieldKey === nextFieldKey
        ? updatedSchema
        : renameFormDataSourceFieldBindings(
            updatedSchema,
            previousFieldKey,
            nextFieldKey,
          );

    setSchema(nextSchema);
    setUiSchema({
      ...uiSchema,
      layout: uiSchema.layout.map((item) =>
        item.fieldKey === previousFieldKey
          ? { ...item, fieldKey: nextFieldKey }
          : item,
      ),
    });
    setSelectedFieldKey(nextFieldKey);
    setAdvancedSchemaMessage(null);
    setDataSourceLint(null);
  }

  /**
   * Commits a whole replacement field. Every type-specific settings renderer
   * takes a committer like this instead of closing over the selected field, so
   * one implementation can serve both a top-level field and a table column
   * (ADR 16 §3.9).
   */
  function commitSelectedField(nextField: FormFieldDefinition): void {
    updateSelectedFieldWith((): FormFieldDefinition => nextField);
  }

  function updateTableField(
    fieldKey: string,
    updater: (field: TableFieldDefinition) => TableFieldDefinition,
  ): void {
    setSchema((currentSchema) => ({
      ...currentSchema,
      fields: currentSchema.fields.map(
        (field): FormFieldDefinition =>
          field.fieldKey === fieldKey && isTableFieldDefinition(field)
            ? updater(field)
            : field,
      ),
    }));
    setAdvancedSchemaMessage(null);
    setDataSourceLint(null);
  }

  /**
   * Writes an edited column back into its table. Renaming a column key rewrites
   * the sibling `ROW_FIELD` bindings that address it, exactly as a top-level
   * key rename rewrites `FIELD` bindings (ADR 16 §3.9).
   */
  function commitTableColumn(
    field: TableFieldDefinition,
    columnIndex: number,
    nextColumn: TableColumnDefinition,
  ): void {
    const previousColumnKey = field.columns[columnIndex]?.fieldKey;

    updateTableField(field.fieldKey, (currentField) => {
      const nextField: TableFieldDefinition = {
        ...currentField,
        columns: currentField.columns.map((column, index) =>
          index === columnIndex ? nextColumn : column,
        ),
      };

      return typeof previousColumnKey === 'string' &&
        previousColumnKey !== nextColumn.fieldKey
        ? renameFormTableColumnBindings(
            nextField,
            previousColumnKey,
            nextColumn.fieldKey,
          )
        : nextField;
    });

    if (previousColumnKey !== nextColumn.fieldKey) {
      setSelectedColumnKey(nextColumn.fieldKey);
    }
  }

  function handleAddTableColumn(field: TableFieldDefinition): void {
    const column = createTableColumnDefinition(field.columns, 'text');

    updateTableField(field.fieldKey, (currentField) => ({
      ...currentField,
      columns: [...currentField.columns, column],
    }));
    setSelectedColumnKey(column.fieldKey);
  }

  function applyRemoveTableColumn(fieldKey: string, columnKey: string): void {
    updateTableField(fieldKey, (currentField) => ({
      ...currentField,
      columns: currentField.columns.filter(
        (column) => column.fieldKey !== columnKey,
      ),
    }));
    setSelectedColumnKey((currentKey) =>
      currentKey === columnKey ? null : currentKey,
    );
  }

  function handleReorderTableColumns(
    field: TableFieldDefinition,
    fromIndex: number,
    toIndex: number,
  ): void {
    updateTableField(field.fieldKey, (currentField) => ({
      ...currentField,
      columns: moveItemByIndex(currentField.columns, fromIndex, toIndex),
    }));
  }

  function handleOptionModeChange(
    field: FormOptionFieldDefinition,
    mode: 'multiple' | 'single',
    requestChange: OptionFieldChangeRequester,
  ): void {
    if (field.type !== 'select' && field.type !== 'autocomplete') {
      return;
    }

    if (readFormFieldSelectionMode(field) === mode) {
      return;
    }

    const currentDefaultValue = field.defaultValue;
    const defaultValue =
      mode === 'multiple'
        ? typeof currentDefaultValue === 'string'
          ? [currentDefaultValue]
          : currentDefaultValue
        : Array.isArray(currentDefaultValue)
          ? currentDefaultValue[0]
          : currentDefaultValue;

    requestChange(
      field,
      {
        ...field,
        defaultValue,
        mode,
      },
      '選擇模式變更可能轉換或捨棄既有預設值。',
    );
  }

  function requestDataSourceFieldChange(
    field: FormOptionFieldDefinition,
    nextField: FormFieldDefinition,
    impact = '此變更會替換目前選項來源；既有 options、dynamic reference 或 bindings 可能失效。',
  ): void {
    if (JSON.stringify(field) === JSON.stringify(nextField)) {
      return;
    }

    setPendingBuilderConfirmation({
      fieldKey: field.fieldKey,
      impact,
      kind: 'replace-field',
      nextField,
    });
  }

  function handleOptionSourceChange(
    field: FormOptionFieldDefinition,
    optionId: string | undefined,
    requestChange: OptionFieldChangeRequester,
  ): void {
    if (!optionId) {
      return;
    }

    if (optionId === STATIC_OPTION_SOURCE_ID) {
      if (!isFormDataSourceFieldDefinition(field)) {
        return;
      }

      const { dataSource, defaultValue, ...baseField } = field;
      void dataSource;
      void defaultValue;
      requestChange(field, {
        ...baseField,
        options: [],
      } as FormOptionFieldDefinition);

      return;
    }

    const descriptor = dataSourceCatalog.find(
      (candidate) => readDataSourceDescriptorOptionId(candidate) === optionId,
    );

    if (!descriptor) {
      return;
    }

    if (isFormDataSourceFieldDefinition(field)) {
      const parameterKeys = new Set(
        descriptor.parameters.map((parameter) => parameter.key),
      );
      const nextBindings = field.dataSource.bindings.filter((binding) =>
        parameterKeys.has(binding.parameter),
      );

      requestChange(field, {
        ...field,
        dataSource: {
          bindings: nextBindings,
          key: descriptor.key,
          version: descriptor.version,
        },
      });

      return;
    }

    const { options, defaultValue, ...baseField } = field;
    void options;
    void defaultValue;
    requestChange(field, {
      ...baseField,
      dataSource: {
        bindings: [],
        key: descriptor.key,
        version: descriptor.version,
      },
    } as FormDataSourceOptionFieldDefinition);
  }

  function handleConfirmBuilderChange(): void {
    if (!pendingBuilderConfirmation) {
      return;
    }

    applyBuilderConfirmation(pendingBuilderConfirmation);
    setPendingBuilderConfirmation(null);
  }

  function applyBuilderConfirmation(
    confirmation: PendingBuilderConfirmation,
  ): void {
    if (confirmation.kind === 'remove-field') {
      applyRemoveField(confirmation.fieldKey);

      return;
    }

    if (confirmation.kind === 'remove-column') {
      applyRemoveTableColumn(confirmation.fieldKey, confirmation.columnKey);

      return;
    }

    if (confirmation.kind === 'replace-column') {
      updateTableField(confirmation.fieldKey, (currentField) => ({
        ...currentField,
        columns: currentField.columns.map((column) =>
          column.fieldKey === confirmation.columnKey
            ? confirmation.nextColumn
            : column,
        ),
      }));

      return;
    }

    setSchema({
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === confirmation.fieldKey
          ? confirmation.nextField
          : field,
      ),
    });
    setAdvancedSchemaMessage(null);
    setDataSourceLint(null);
  }

  async function handleLintDataSourceSchema(): Promise<void> {
    setDataSourceLintLoading(true);

    try {
      const result = await lintFormSchema(schema, uiSchema);
      // Lint lines carry stable `FORM_DATA_SOURCE_*` codes; show the designer
      // readable copy while keeping the field path.
      setDataSourceLint(result.errors.map(readFormSchemaLintMessage));
    } catch {
      setDataSourceLint(['目前無法完成 DataSource schema 驗證。']);
    } finally {
      setDataSourceLintLoading(false);
    }
  }

  function updatePreviewValues(values: FormRendererValues): void {
    setPreviewValues(values);
  }

  function updateFieldRequired(fieldKey: string, required: boolean): void {
    setSchema((currentSchema) => ({
      ...currentSchema,
      fields: currentSchema.fields.map(
        (field): FormFieldDefinition =>
          field.fieldKey === fieldKey
            ? ({ ...field, required } as FormFieldDefinition)
            : field,
      ),
    }));
    setAdvancedSchemaMessage(null);
  }

  function updateSchemaJson(value: string): void {
    setSchemaJsonText(value);

    try {
      setSchema(JSON.parse(value) as FormDefinitionSchema);
      setAdvancedSchemaMessage(null);
    } catch {
      setAdvancedSchemaMessage('Form Schema JSON 格式不正確');
    }
  }

  function updateUiSchemaJson(value: string): void {
    setUiSchemaJsonText(value);

    try {
      setUiSchema(JSON.parse(value) as FormUiSchema);
      setAdvancedSchemaMessage(null);
    } catch {
      setAdvancedSchemaMessage('UI Schema JSON 格式不正確');
    }
  }

  return (
    <>
      <>
          <SectionGroup>
            <Section>
              <div style={WORKBENCH_STYLE}>
                <Tab
                  activeKey={activeTab}
                  onChange={handleTabChange}
                  size="sub"
                >
                  <TabItem key="design">設計</TabItem>
                  <TabItem key="preview">預覽</TabItem>
                  <TabItem key="advanced">進階</TabItem>
                </Tab>

                {activeTab === 'design' ? renderDesignTab() : null}
                {activeTab === 'preview' ? renderPreviewTab() : null}
                {activeTab === 'advanced' ? renderAdvancedTab() : null}
              </div>
            </Section>
          </SectionGroup>
        </>
      {pendingBuilderConfirmation ? (
        <Modal
          cancelText="返回"
          confirmText="確認變更"
          modalType="standard"
          onCancel={(): void => setPendingBuilderConfirmation(null)}
          onClose={(): void => setPendingBuilderConfirmation(null)}
          onConfirm={handleConfirmBuilderChange}
          open
          showModalFooter
          showModalHeader
          title={readBuilderConfirmationTitle(pendingBuilderConfirmation)}
        >
          {pendingBuilderConfirmation.kind === 'remove-field' ? (
            <div style={COMPACT_STACK_STYLE}>
              <Typography variant="body">
                此欄位仍被下列 DataSource binding 使用；移除後請重新設定這些欄位。
              </Typography>
              <Typography color="text-warning" variant="body">
                {pendingBuilderConfirmation.affectedFieldKeys.join('、')}
              </Typography>
            </div>
          ) : pendingBuilderConfirmation.kind === 'remove-column' ? (
            <Typography variant="body">
              移除欄「{pendingBuilderConfirmation.columnKey}
              」後，既有案件仍保留原本的表單版本，但新版本的這一欄資料將不再被填寫。
            </Typography>
          ) : (
            <Typography variant="body">
              {pendingBuilderConfirmation.impact}確認後才會寫入 schema。
            </Typography>
          )}
        </Modal>
      ) : null}
    </>
  );

  function renderDesignTab(): ReactElement {
    return (
      <div style={STACK_STYLE}>
        <div style={FIELD_LIBRARY_HEADER_STYLE}>
          <Typography component="h2" variant="label-primary">
            新增欄位
          </Typography>
          <div style={FIELD_LIBRARY_STYLE}>
            {FIELD_TYPE_OPTIONS.map((option) => (
              <Button
                icon={option.icon}
                iconType="leading"
                key={option.type}
                onClick={(): void => handleAddField(option.type)}
                size="sub"
                style={FIELD_LIBRARY_BUTTON_STYLE}
                type="button"
                variant="base-secondary"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div style={WORKSPACE_GRID_STYLE}>
          <div style={{ ...STACK_STYLE, ...CANVAS_COLUMN_STYLE }}>
            <Typography component="h2" variant="label-primary">
              表單畫布
            </Typography>
            {schema.fields.length > 0 ? (
              <DragDropContext onDragEnd={handleFieldDragEnd}>
                <Droppable droppableId="form-builder-fields">
                  {(droppableProvided): ReactElement => (
                    <div
                      {...droppableProvided.droppableProps}
                      ref={droppableProvided.innerRef}
                      style={STACK_STYLE}
                    >
                      {schema.fields.map((field, index) => (
                        <Draggable
                          draggableId={field.fieldKey}
                          index={index}
                          key={field.fieldKey}
                        >
                          {(draggableProvided, snapshot): ReactElement =>
                            renderFieldBlock(
                              field,
                              draggableProvided,
                              snapshot.isDragging,
                            )
                          }
                        </Draggable>
                      ))}
                      {droppableProvided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            ) : (
              <div style={EMPTY_CANVAS_STYLE}>
                <div style={STACK_STYLE}>
                  <Typography component="h3" variant="h3">
                    尚未建立欄位
                  </Typography>
                  <Typography color="text-neutral" variant="body">
                    從上方新增第一個欄位，或直接建立常用文字欄位開始設計。
                  </Typography>
                </div>
                <div style={EMPTY_CANVAS_ACTIONS_STYLE}>
                  <Button
                    onClick={(): void => handleAddField('text')}
                    variant="base-primary"
                  >
                    新增文字欄位
                  </Button>
                  <Button
                    onClick={(): void => handleAddField('textarea')}
                    variant="base-secondary"
                  >
                    新增長文字
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div style={{ ...STACK_STYLE, ...SETTINGS_COLUMN_STYLE }}>
            <Typography component="h2" variant="label-primary">
              欄位設定
            </Typography>
            {selectedField ? (
              renderFieldSettings(selectedField)
            ) : (
              <Typography color="text-neutral" variant="body">
                請先新增或選取欄位。
              </Typography>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderFieldSettings(field: FormFieldDefinition): ReactElement {
    return (
      <div style={FIELD_SETTINGS_FORM_STYLE}>
        {renderMainFieldSettings(field)}
        {renderAdvancedFieldSettings(field)}
      </div>
    );
  }

  function renderMainFieldSettings(field: FormFieldDefinition): ReactElement {
    return (
      <div style={FIELD_SETTINGS_SECTION_STYLE}>
        <div style={FIELD_SETTINGS_BADGE_ROW_STYLE}>
          <Badge
            size="main"
            text={readFieldTypeLabel(field.type)}
            variant="text-info"
          />
        </div>
        {renderSettingsFormRow(
          '標題',
          'fieldLabel',
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedField({ label: event.target.value })
            }
            placeholder="例如：申請金額"
            value={field.label}
            variant="base"
          />,
        )}
        {renderSettingsFormRow(
          '欄位 Key',
          'fieldKey',
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedField({ fieldKey: event.target.value })
            }
            placeholder="例如：amount"
            value={field.fieldKey}
            variant="base"
          />,
        )}
        {renderSettingsFormRow(
          '提示文字',
          'fieldPlaceholder',
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedField({
                placeholder: event.target.value || undefined,
              })
            }
            placeholder="例如：請輸入申請金額"
            value={field.placeholder ?? ''}
            variant="base"
          />,
        )}
        {renderTypeSpecificSettings(
          field,
          commitSelectedField,
          requestDataSourceFieldChange,
        )}
      </div>
    );
  }

  function renderAdvancedFieldSettings(
    field: FormFieldDefinition,
  ): ReactElement {
    return (
      <Accordion
        defaultExpanded={hasConditionRules(field)}
        size="sub"
        title="進階設定"
      >
        <div style={FIELD_SETTINGS_SECTION_STYLE}>
          <Typography
            component="h3"
            style={FIELD_SETTINGS_SECTION_TITLE_STYLE}
            variant="label-primary"
          >
            條件規則
          </Typography>
          <Typography
            color="text-neutral"
            style={FIELD_SETTINGS_HINT_STYLE}
            variant="body"
          >
            只有需要根據其他欄位改變顯示、必填或唯讀狀態時才需要設定。
          </Typography>
          {renderConditionSettings(field)}
        </div>
      </Accordion>
    );
  }

  function renderTypeSpecificSettings(
    field: FormFieldDefinition,
    commit: FieldCommit<FormFieldDefinition>,
    requestChange: OptionFieldChangeRequester,
  ): ReactElement | null {
    if (isTextFieldDefinition(field)) {
      return renderTextFieldSettings(field, commit);
    }

    if (isNumberFieldDefinition(field)) {
      return renderNumberFieldSettings(field, commit);
    }

    if (isDateFieldDefinition(field)) {
      return renderDateFieldSettings(field, commit);
    }

    if (isFormOptionFieldDefinition(field)) {
      return renderOptionFieldSettings(field, commit, requestChange);
    }

    if (field.type === 'boolean') {
      return renderBooleanFieldSettings(field, commit);
    }

    if (field.type === 'file_upload') {
      return renderFileUploadFieldSettings(field, commit);
    }

    if (isTableFieldDefinition(field)) {
      return renderTableFieldSettings(field);
    }

    return null;
  }

  function renderTableFieldSettings(field: TableFieldDefinition): ReactElement {
    const bounds = readFormTableRowBounds(field);

    return (
      <>
        {renderSettingsFormRow(
          '最少列數',
          'fieldMinRows',
          renderNumberInput(
            field.minRows,
            (value): void =>
              updateTableField(field.fieldKey, (currentField) => ({
                ...currentField,
                minRows: value,
              })),
            '例如：1',
            { max: bounds.maxRows, min: 0 },
          ),
        )}
        {renderSettingsFormRow(
          '最多列數',
          'fieldMaxRows',
          renderNumberInput(
            field.maxRows,
            (value): void =>
              updateTableField(field.fieldKey, (currentField) => ({
                ...currentField,
                maxRows: value,
              })),
            `未設定即為 ${FORM_TABLE_MAX_ROWS}`,
            { max: FORM_TABLE_MAX_ROWS, min: Math.max(bounds.minRows, 1) },
          ),
        )}
        {renderSettingsFormRow(
          '新增列按鈕文字',
          'fieldAddRowLabel',
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateTableField(field.fieldKey, (currentField) => ({
                ...currentField,
                addRowLabel: event.target.value || undefined,
              }))
            }
            placeholder="預設為「新增一列」"
            value={field.addRowLabel ?? ''}
            variant="base"
          />,
        )}
        {renderSettingsFormRow(
          '欄',
          'fieldColumns',
          renderTableColumnsTable(field),
          true,
        )}
        {renderSelectedTableColumnSettings(field)}
      </>
    );
  }

  function renderTableColumnsTable(field: TableFieldDefinition): ReactElement {
    const columnRows: TableColumnRow[] = field.columns.map((column, index) => ({
      fieldKey: column.fieldKey,
      index,
      key: `${field.fieldKey}-${column.fieldKey}`,
      label: column.label,
      type: column.type,
    }));
    const columns: TableColumn<TableColumnRow>[] = [
      {
        key: 'fieldKey',
        render: (row): ReactElement => (
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commitTableColumn(field, row.index, {
                ...readTableColumn(field, row.index),
                fieldKey: event.target.value,
              })
            }
            placeholder="例如：qty"
            size="sub"
            value={row.fieldKey}
            variant="base"
          />
        ),
        title: '欄位 Key',
      },
      {
        key: 'label',
        render: (row): ReactElement => (
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commitTableColumn(field, row.index, {
                ...readTableColumn(field, row.index),
                label: event.target.value,
              })
            }
            placeholder="例如：數量"
            size="sub"
            value={row.label}
            variant="base"
          />
        ),
        title: '標題',
      },
      {
        key: 'type',
        render: (row): ReactElement => (
          <Select
            clearable={false}
            onChange={(option): void =>
              handleTableColumnTypeChange(field, row.index, option?.id)
            }
            options={[...TABLE_COLUMN_TYPE_OPTIONS]}
            value={readSelectOption(TABLE_COLUMN_TYPE_OPTIONS, row.type)}
          />
        ),
        title: '型別',
      },
      {
        key: 'required',
        render: (row): ReactElement => (
          <Toggle
            checked={readTableColumn(field, row.index).required === true}
            label="必填"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commitTableColumn(field, row.index, {
                ...readTableColumn(field, row.index),
                required: event.target.checked,
              })
            }
            size="sub"
          />
        ),
        title: '必填',
      },
    ];
    const actions: TableActions<TableColumnRow> = {
      render: (row): ReturnType<TableActions<TableColumnRow>['render']> => [
        {
          icon: SettingIcon,
          iconType: 'icon-only',
          name: '設定此欄',
          onClick: (): void => setSelectedColumnKey(row.fieldKey),
          variant: 'base-ghost',
        },
        {
          // A table with no columns cannot be published (ADR 16 §4), so the
          // last one stays.
          disabled: (): boolean => field.columns.length <= 1,
          icon: TrashIcon,
          iconType: 'icon-only',
          name: '移除此欄',
          onClick: (): void =>
            setPendingBuilderConfirmation({
              columnKey: row.fieldKey,
              fieldKey: field.fieldKey,
              kind: 'remove-column',
            }),
          variant: 'destructive-ghost',
        },
      ],
      width: 96,
    };

    return (
      <div style={COMPACT_STACK_STYLE}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={columnRows}
          draggable={{
            enabled: true,
            onDragEnd: (_rows, options): void =>
              handleReorderTableColumns(
                field,
                options.fromIndex,
                options.toIndex,
              ),
          }}
          showHeader
          size="sub"
        />
        <div style={OPTION_ACTIONS_STYLE}>
          <Button
            icon={PlusIcon}
            iconType="leading"
            onClick={(): void => handleAddTableColumn(field)}
            variant="base-secondary"
          >
            新增欄
          </Button>
        </div>
      </div>
    );
  }

  function renderSelectedTableColumnSettings(
    field: TableFieldDefinition,
  ): ReactElement {
    const columnIndex = field.columns.findIndex(
      (column) => column.fieldKey === selectedColumnKey,
    );
    const column = field.columns[columnIndex];

    if (!column) {
      return (
        <Typography
          color="text-neutral"
          style={FIELD_SETTINGS_HINT_STYLE}
          variant="body"
        >
          選取上方任一欄的「設定此欄」，即可調整該欄的型別專屬設定。
        </Typography>
      );
    }

    return (
      <div style={TABLE_COLUMN_SETTINGS_STYLE}>
        <Typography component="h3" variant="label-primary">
          欄設定：{column.label || column.fieldKey}
        </Typography>
        {renderSettingsFormRow(
          '提示文字',
          'columnPlaceholder',
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commitTableColumn(field, columnIndex, {
                ...column,
                placeholder: event.target.value || undefined,
              })
            }
            placeholder="例如：請輸入數量"
            value={column.placeholder ?? ''}
            variant="base"
          />,
        )}
        {renderTypeSpecificSettings(
          column,
          (nextColumn): void => {
            if (isTableColumnFieldType(nextColumn.type)) {
              commitTableColumn(
                field,
                columnIndex,
                nextColumn as TableColumnDefinition,
              );
            }
          },
          // Column DataSource selection arrives in P3; until then a column can
          // only carry static options, so a change never needs confirming.
          (_column, nextColumn): void => {
            if (isTableColumnFieldType(nextColumn.type)) {
              commitTableColumn(
                field,
                columnIndex,
                nextColumn as TableColumnDefinition,
              );
            }
          },
        )}
      </div>
    );
  }

  function handleTableColumnTypeChange(
    field: TableFieldDefinition,
    columnIndex: number,
    optionId: string | undefined,
  ): void {
    const column = field.columns[columnIndex];
    const nextType = TABLE_COLUMN_TYPE_OPTIONS.find(
      (option) => option.id === optionId,
    )?.id;

    if (!column || !nextType || column.type === nextType) {
      return;
    }

    setPendingBuilderConfirmation({
      columnKey: column.fieldKey,
      fieldKey: field.fieldKey,
      impact: '變更欄型別會捨棄該欄目前的預設值、選項與數值範圍設定。',
      kind: 'replace-column',
      nextColumn: convertTableColumnType(column, nextType),
    });
  }

  function readTableColumn(
    field: TableFieldDefinition,
    columnIndex: number,
  ): TableColumnDefinition {
    const column = field.columns[columnIndex];

    if (!column) {
      throw new Error(
        `Table ${field.fieldKey} has no column at index ${columnIndex}.`,
      );
    }

    return column;
  }

  function renderTextFieldSettings(
    field: TextFieldDefinition,
    commit: FieldCommit<TextFieldDefinition>,
  ): ReactElement {
    return (
      <>
        {renderSettingsFormRow(
          '預設值',
          'fieldDefaultValue',
          field.type === 'textarea' ? (
            renderSettingsTextarea({
              name: 'fieldDefaultValue',
              onChange: (value): void =>
                commit({ ...field, defaultValue: value || undefined }),
              placeholder: '輸入此欄位的預設文字',
              rows: 3,
              value: readStringDefaultValue(field.defaultValue),
            })
          ) : (
            <Input
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                commit({
                  ...field,
                  defaultValue: event.target.value || undefined,
                })
              }
              placeholder="輸入此欄位的預設文字"
              value={readStringDefaultValue(field.defaultValue)}
              variant="base"
            />
          ),
        )}
        {renderSettingsFormRow(
          '最小長度',
          'fieldMinLength',
          renderNumberInput(
            field.minLength,
            (value): void => commit({ ...field, minLength: value }),
            '例如：2',
            { min: 0 },
          ),
        )}
        {renderSettingsFormRow(
          '最大長度',
          'fieldMaxLength',
          renderNumberInput(
            field.maxLength,
            (value): void => commit({ ...field, maxLength: value }),
            '例如：100',
            { min: 1 },
          ),
        )}
      </>
    );
  }

  function renderNumberFieldSettings(
    field: NumberFieldDefinition,
    commit: FieldCommit<NumberFieldDefinition>,
  ): ReactElement {
    return (
      <>
        {renderSettingsFormRow(
          '預設值',
          'fieldDefaultValue',
          renderNumberInput(
            typeof field.defaultValue === 'number'
              ? field.defaultValue
              : undefined,
            (value): void => commit({ ...field, defaultValue: value }),
            field.type === 'money' ? '例如：1000' : '輸入預設數值',
            { max: field.maximum, min: field.minimum },
          ),
        )}
        {renderSettingsFormRow(
          '最小值',
          'fieldMinimum',
          renderNumberInput(
            field.minimum,
            (value): void => commit({ ...field, minimum: value }),
            '例如：0',
          ),
        )}
        {renderSettingsFormRow(
          '最大值',
          'fieldMaximum',
          renderNumberInput(
            field.maximum,
            (value): void => commit({ ...field, maximum: value }),
            '例如：999999',
          ),
        )}
      </>
    );
  }

  function renderDateFieldSettings(
    field: DateFieldDefinition,
    commit: FieldCommit<DateFieldDefinition>,
  ): ReactElement {
    return renderSettingsFormRow(
      '預設值',
      'fieldDefaultValue',
      renderDateValuePicker(
        field,
        readStringDefaultValue(field.defaultValue),
        (value): void => commit({ ...field, defaultValue: value }),
      ),
    );
  }

  function renderOptionFieldSettings(
    field: FormOptionFieldDefinition,
    commit: FieldCommit<FormOptionFieldDefinition>,
    requestChange: OptionFieldChangeRequester,
  ): ReactElement {
    const compatibleDescriptors = readCompatibleFormDataSourceDescriptors(
      field.type,
      dataSourceCatalog,
    );
    const currentSourceId = isFormDataSourceFieldDefinition(field)
      ? readDataSourceDescriptorOptionId(field.dataSource)
      : STATIC_OPTION_SOURCE_ID;
    const currentDescriptor = isFormDataSourceFieldDefinition(field)
      ? dataSourceCatalog.find(
          (descriptor) =>
            descriptor.key === field.dataSource.key &&
            descriptor.version === field.dataSource.version,
        )
      : null;
    const currentDescriptorIsCompatible = currentDescriptor
      ? compatibleDescriptors.some(
          (descriptor) =>
            descriptor.key === currentDescriptor.key &&
            descriptor.version === currentDescriptor.version,
        )
      : false;
    const sourceOptions = [
      ...OPTION_SOURCE_KIND_OPTIONS,
      ...compatibleDescriptors.map(readDataSourceDescriptorOption),
      ...(isFormDataSourceFieldDefinition(field) &&
      !currentDescriptorIsCompatible
        ? [
            {
              id: currentSourceId,
              name: `${field.dataSource.key} v${field.dataSource.version}（目前不可用或不支援）`,
            },
          ]
        : []),
    ];
    const mode = readFormFieldSelectionMode(field);

    return (
      <>
        {field.type === 'select' || field.type === 'autocomplete'
          ? renderSettingsFormRow(
              '選擇模式',
              'fieldSelectionMode',
              <Select
                clearable={false}
                onChange={(option): void => {
                  if (option?.id === 'single' || option?.id === 'multiple') {
                    handleOptionModeChange(field, option.id, requestChange);
                  }
                }}
                options={[...OPTION_MODE_OPTIONS]}
                value={readSelectOption(OPTION_MODE_OPTIONS, mode)}
              />,
            )
          : renderSettingsFormRow(
              '選擇模式',
              'fieldSelectionMode',
              <Typography color="text-neutral" variant="body">
                {mode === 'multiple' ? '固定複選' : '固定單選'}
              </Typography>,
            )}
        {renderSettingsFormRow(
          '選項來源',
          'fieldOptionSource',
          <Select
            clearable={false}
            disabled={
              dataSourceCatalogState === 'loading' &&
              !isFormDataSourceFieldDefinition(field)
            }
            onChange={(option): void =>
              handleOptionSourceChange(field, option?.id, requestChange)
            }
            options={sourceOptions}
            placeholder="選擇選項來源"
            value={readSelectOption(sourceOptions, currentSourceId)}
          />,
        )}
        {isFormDataSourceFieldDefinition(field)
          ? renderDataSourceFieldSettings(field, compatibleDescriptors)
          : renderStaticOptionFieldSettings(field, commit)}
      </>
    );
  }

  function renderDataSourceFieldSettings(
    field: FormDataSourceOptionFieldDefinition,
    compatibleDescriptors: readonly FormDataSourceDescriptorRecord[],
  ): ReactElement {
    const descriptor = dataSourceCatalog.find(
      (candidate) =>
        candidate.key === field.dataSource.key &&
        candidate.version === field.dataSource.version,
    );
    const unsupportedCurrentSource =
      descriptor && !isFormDataSourceDescriptorCompatible(descriptor, field.type);

    return (
      <div style={DATA_SOURCE_SETTINGS_STYLE}>
        {dataSourceCatalogState === 'loading' ? (
          <Typography color="text-neutral" variant="body">
            正在載入可用的 DataSource Catalog…
          </Typography>
        ) : null}
        {dataSourceCatalogError ? (
          <Typography color="text-error" variant="body">
            {dataSourceCatalogError}
          </Typography>
        ) : null}
        {!descriptor ? (
          <Typography color="text-warning" variant="body">
            目前來源版本未出現在 Catalog；會保留原設定，但在環境 lint 通過前不可發布。
          </Typography>
        ) : null}
        {unsupportedCurrentSource ? (
          <Typography color="text-error" variant="body">
            目前來源不支援此控制項或超出 bounded list 限制，請選擇其他版本。
          </Typography>
        ) : null}
        {descriptor ? renderDataSourceDescriptorSummary(descriptor) : null}
        {descriptor
          ? descriptor.parameters.map((parameter) =>
              renderDataSourceParameterBinding(field, parameter),
            )
          : null}
        {compatibleDescriptors.length === 0 && !dataSourceCatalogError ? (
          <Typography color="text-warning" variant="body">
            沒有符合目前控制項能力的已註冊來源。
          </Typography>
        ) : null}
        <div style={OPTION_ACTIONS_STYLE}>
          <Button
            disabled={dataSourceLintLoading}
            onClick={(): void => void handleLintDataSourceSchema()}
            size="sub"
            type="button"
            variant="base-secondary"
          >
            {dataSourceLintLoading ? '驗證中…' : '驗證 DataSource 設定'}
          </Button>
        </div>
        {dataSourceLint ? (
          <Typography
            color={dataSourceLint.length > 0 ? 'text-error' : 'text-success'}
            variant="caption"
          >
            {dataSourceLint.length > 0
              ? dataSourceLint.join('；')
              : 'DataSource schema 與目前環境均通過驗證。'}
          </Typography>
        ) : null}
      </div>
    );
  }

  function renderDataSourceDescriptorSummary(
    descriptor: FormDataSourceDescriptorRecord,
  ): ReactElement {
    return (
      <div style={DATA_SOURCE_SUMMARY_STYLE}>
        <Typography variant="label-primary">
          {descriptor.label} · v{descriptor.version}
        </Typography>
        {descriptor.description ? (
          <Typography color="text-neutral" variant="caption">
            {descriptor.description}
          </Typography>
        ) : null}
        <Typography color="text-neutral" variant="caption">
          支援：{descriptor.supportedControls.join('、')}；
          {descriptor.supportsSearch ? '支援搜尋' : '不支援搜尋'}；
          {descriptor.paginationMode === 'CURSOR' ? '支援分頁' : '完整清單'}；
          policy：{descriptor.revalidationPolicy}
        </Typography>
      </div>
    );
  }

  function renderDataSourceParameterBinding(
    field: FormDataSourceOptionFieldDefinition,
    parameter: FormDataSourceDescriptorRecord['parameters'][number],
  ): ReactElement {
    const binding = readFormDataSourceBinding(field, parameter.key);
    const bindingId = readDataSourceBindingOptionId(binding);
    const fieldOptions = readCompatibleFormDataSourceBindingFields(
      parameter.type,
      schema.fields,
      field.fieldKey,
    );
    const bindingOptions = [
      ...(parameter.required
        ? []
        : [{ id: UNBOUND_BINDING_ID, name: '未綁定' }]),
      ...fieldOptions,
      ...(parameter.type === 'STRING_ARRAY'
        ? []
        : [{ id: CONSTANT_BINDING_ID, name: '固定常數' }]),
    ];

    return (
      <div key={parameter.key} style={DATA_SOURCE_PARAMETER_GRID_STYLE}>
        <BPMFormField
          label={`${parameter.label ?? parameter.key}${parameter.required ? '（必填）' : '（選填）'}`}
          name={`dataSourceParameter_${parameter.key}`}
        >
          <Select
            clearable={false}
            onChange={(option): void =>
              handleDataSourceBindingChange(
                field,
                parameter.key,
                parameter.type,
                option?.id,
              )
            }
            options={bindingOptions}
            placeholder="選擇欄位或常數"
            value={readSelectOption(bindingOptions, bindingId)}
          />
        </BPMFormField>
        {readFormDataSourceBindingValueKind(binding) === 'CONSTANT'
          ? renderDataSourceConstantEditor(field, parameter.key, parameter.type, binding)
          : readFormDataSourceBindingValueKind(binding) === 'FIELD'
            ? (
                <Typography color="text-neutral" variant="caption">
                  使用表單欄位「{binding?.from.kind === 'FIELD' ? binding.from.fieldKey : ''}」的目前值。
                </Typography>
              )
            : (
                <Typography color="text-neutral" variant="caption">
                  {parameter.required
                    ? fieldOptions.length > 0
                      ? '請選擇相容的表單欄位或固定常數。'
                      : '目前沒有型別相容的表單欄位，請先建立 dependency。'
                    : '此參數可不綁定。'}
                </Typography>
              )}
      </div>
    );
  }

  function renderDataSourceConstantEditor(
    field: FormDataSourceOptionFieldDefinition,
    parameterKey: string,
    parameterType: FormDataSourceParameterType,
    binding: FormDataSourceBinding | null,
  ): ReactElement {
    const value = readFormDataSourceBindingValue(field, parameterKey);

    if (parameterType === 'BOOLEAN') {
      const options = [
        { id: 'true', name: '是' },
        { id: 'false', name: '否' },
      ];

      return (
        <Select
          clearable={false}
          onChange={(option): void =>
            updateDataSourceConstant(
              parameterKey,
              option?.id === 'true',
            )
          }
          options={options}
          value={readSelectOption(
            options,
            value === true ? 'true' : 'false',
          )}
        />
      );
    }

    if (parameterType === 'STRING_ARRAY') {
      return (
        <Typography color="text-warning" variant="caption">
          STRING_ARRAY 參數請綁定複選欄位；目前不接受固定常數。
        </Typography>
      );
    }

    return (
      <Input
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          updateDataSourceConstant(
            parameterKey,
            parameterType === 'NUMBER'
              ? parseOptionalNumberInput(event.target.value) ?? 0
              : event.target.value,
          )
        }
        placeholder={parameterType === 'NUMBER' ? '輸入數字' : '輸入固定值'}
        value={readDataSourceConstantInputValue(binding, parameterType)}
        variant="base"
      />
    );
  }

  function handleDataSourceBindingChange(
    field: FormDataSourceOptionFieldDefinition,
    parameterKey: string,
    parameterType: FormDataSourceParameterType,
    optionId: string | undefined,
  ): void {
    if (!optionId || optionId === UNBOUND_BINDING_ID) {
      updateSelectedFieldWith((currentField) =>
        isFormDataSourceFieldDefinition(currentField)
          ? upsertFormDataSourceFieldBinding(currentField, parameterKey, null)
          : currentField,
      );

      return;
    }

    if (optionId === CONSTANT_BINDING_ID) {
      updateSelectedFieldWith((currentField) =>
        isFormDataSourceFieldDefinition(currentField)
          ? upsertFormDataSourceFieldBinding(
              currentField,
              parameterKey,
              {
                from: {
                  kind: 'CONSTANT',
                  value: readDefaultDataSourceConstant(parameterType),
                },
                parameter: parameterKey,
              },
            )
          : currentField,
      );

      return;
    }

    updateSelectedFieldWith((currentField) =>
      isFormDataSourceFieldDefinition(currentField)
        ? upsertFormDataSourceFieldBinding(currentField, parameterKey, {
            from: { fieldKey: optionId, kind: 'FIELD' },
            parameter: parameterKey,
          })
        : currentField,
    );
  }

  function updateDataSourceConstant(
    parameterKey: string,
    value: FormDataSourceConstantValue,
  ): void {
    updateSelectedFieldWith((currentField) =>
      isFormDataSourceFieldDefinition(currentField)
        ? upsertFormDataSourceFieldBinding(currentField, parameterKey, {
            from: { kind: 'CONSTANT', value },
            parameter: parameterKey,
          })
        : currentField,
    );
  }

  function renderStaticOptionFieldSettings(
    field: FormStaticOptionFieldDefinition,
    commit: FieldCommit<FormStaticOptionFieldDefinition>,
  ): ReactElement {
    const mode = readFormFieldSelectionMode(field);
    const defaultValues = Array.isArray(field.defaultValue)
      ? field.defaultValue
      : [];
    const options = field.options.map(readFieldOptionAsSelectOption);
    const selectedValues = options.filter((option) =>
      defaultValues.includes(option.id),
    );

    return (
      <>
        {renderSettingsFormRow(
          '預設值',
          'fieldDefaultValue',
          mode === 'multiple' ? (
            <Select
              clearable
              mode="multiple"
              onChange={(nextOptions): void =>
                commit({
                  ...field,
                  defaultValue: nextOptions.length
                    ? nextOptions.map((option) => option.id)
                    : undefined,
                })
              }
              options={options}
              placeholder="選擇一或多個預設選項"
              value={selectedValues}
            />
          ) : (
            <Select
              clearable
              onChange={(option): void =>
                commit({ ...field, defaultValue: option?.id || undefined })
              }
              options={options}
              placeholder="選擇預設選項"
              value={
                typeof field.defaultValue === 'string'
                  ? readSelectOption(options, field.defaultValue)
                  : null
              }
            />
          ),
        )}
        {renderSettingsFormRow(
          '選項',
          'fieldOptions',
          renderFieldOptionsTable(field, commit),
          true,
        )}
      </>
    );
  }

  function renderBooleanFieldSettings(
    field: BooleanFieldDefinition,
    commit: FieldCommit<BooleanFieldDefinition>,
  ): ReactElement {
    const defaultValue =
      typeof field.defaultValue === 'boolean'
        ? String(field.defaultValue)
        : 'unset';

    return renderSettingsFormRow(
      '預設值',
      'fieldDefaultValue',
      <Select
        clearable={false}
        onChange={(option): void =>
          commit({
            ...field,
            defaultValue:
              option?.id === 'true'
                ? true
                : option?.id === 'false'
                  ? false
                  : undefined,
          })
        }
        options={[...BOOLEAN_DEFAULT_OPTIONS]}
        placeholder="選擇預設狀態"
        value={readSelectOption(BOOLEAN_DEFAULT_OPTIONS, defaultValue)}
      />,
    );
  }

  function renderFileUploadFieldSettings(
    field: FileUploadFieldDefinition,
    commit: FieldCommit<FileUploadFieldDefinition>,
  ): ReactElement {
    return (
      <>
        {renderSettingsFormRow(
          '檔案數',
          'fieldMaxFiles',
          renderNumberInput(
            field.maxFiles,
            (value): void => commit({ ...field, maxFiles: value }),
            '例如：1',
            { min: 1 },
          ),
        )}
        {renderSettingsFormRow(
          'MIME',
          'fieldAcceptedMimeTypes',
          renderSettingsTextarea({
            name: 'fieldAcceptedMimeTypes',
            onChange: (value): void =>
              commit({
                ...field,
                acceptedMimeTypes: parseStringList(value),
              }),
            placeholder: '每行一個 MIME type，例如：application/pdf',
            rows: 3,
            value: readStringListInput(field.acceptedMimeTypes),
          }),
          false,
        )}
      </>
    );
  }

  function renderConditionSettings(field: FormFieldDefinition): ReactElement {
    const conditionFieldOptions = schema.fields.filter(
      (schemaField) => schemaField.fieldKey !== field.fieldKey,
    );

    if (!conditionFieldOptions.length) {
      return (
        <Typography
          color="text-neutral"
          style={FIELD_SETTINGS_HINT_STYLE}
          variant="body"
        >
          目前沒有其他欄位可作為條件來源。新增更多欄位後即可設定條件規則。
        </Typography>
      );
    }

    return (
      <>
        {CONDITION_RULE_CONFIGS.map((config) =>
          renderConditionRule(field, config, conditionFieldOptions),
        )}
      </>
    );
  }

  function renderConditionRule(
    field: FormFieldDefinition,
    config: ConditionRuleConfig,
    conditionFieldOptions: readonly FormFieldDefinition[],
  ): ReactElement {
    const expression = field[config.target];
    const parsedRule = expression ? parseConditionRule(expression) : null;
    const parsedConditionField = conditionFieldOptions.find(
      (conditionField) => conditionField.fieldKey === parsedRule?.fieldKey,
    );
    const selectedConditionField =
      parsedConditionField ?? conditionFieldOptions[0];
    const conditionFieldSelectOptions = conditionFieldOptions.map(
      readFieldAsConditionSelectOption,
    );
    const conditionOperatorOptions = readConditionOperatorOptions(
      selectedConditionField,
    );
    const selectedOperator =
      parsedRule &&
      conditionOperatorOptions.some(
        (option) => option.id === parsedRule.operator,
      )
        ? parsedRule.operator
        : readDefaultConditionOperator(selectedConditionField);
    const selectedValue =
      parsedRule?.value ?? readDefaultConditionValue(selectedConditionField);
    const enabled = Boolean(expression);
    const unsupportedRule = enabled && (!parsedRule || !parsedConditionField);

    return renderSettingsFormRow(
      config.label,
      config.name,
      <div style={CONDITION_RULE_CONTROL_STYLE}>
        <Toggle
          checked={enabled}
          label={enabled ? '已啟用' : '不啟用'}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            updateSelectedConditionRule(
              config.target,
              event.target.checked
                ? buildConditionExpression(
                    selectedConditionField,
                    readDefaultConditionOperator(selectedConditionField),
                    readDefaultConditionValue(selectedConditionField),
                  )
                : undefined,
            )
          }
          size="sub"
          supportingText={config.supportingText}
        />
        {enabled ? (
          unsupportedRule ? (
            <Typography color="text-warning" variant="body">
              這個規則不是目前 UI 支援的格式。重新選擇條件後會取代既有規則。
            </Typography>
          ) : (
            <div style={CONDITION_RULE_GRID_STYLE}>
              <Select
                clearable={false}
                onChange={(option): void => {
                  const nextField =
                    conditionFieldOptions.find(
                      (conditionField) =>
                        conditionField.fieldKey === option?.id,
                    ) ?? selectedConditionField;

                  updateSelectedConditionRule(
                    config.target,
                    buildConditionExpression(
                      nextField,
                      readDefaultConditionOperator(nextField),
                      readDefaultConditionValue(nextField),
                    ),
                  );
                }}
                options={conditionFieldSelectOptions}
                placeholder="選擇欄位"
                value={readSelectOption(
                  conditionFieldSelectOptions,
                  selectedConditionField.fieldKey,
                )}
              />
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateSelectedConditionRule(
                    config.target,
                    buildConditionExpression(
                      selectedConditionField,
                      readConditionOperatorOption(option?.id) ??
                        selectedOperator,
                      selectedValue,
                    ),
                  )
                }
                options={[...conditionOperatorOptions]}
                placeholder="判斷方式"
                value={readSelectOption(
                  conditionOperatorOptions,
                  selectedOperator,
                )}
              />
              {renderConditionValueControl(
                selectedConditionField,
                selectedValue,
                (nextValue): void =>
                  updateSelectedConditionRule(
                    config.target,
                    buildConditionExpression(
                      selectedConditionField,
                      selectedOperator,
                      nextValue,
                    ),
                  ),
              )}
            </div>
          )
        ) : null}
      </div>,
      true,
    );
  }

  function updateSelectedConditionRule(
    target: ConditionRuleTarget,
    expression: string | undefined,
  ): void {
    updateSelectedField({ [target]: expression });
  }

  function renderConditionValueControl(
    conditionField: FormFieldDefinition,
    value: string,
    onChange: (value: string) => void,
  ): ReactElement {
    if (conditionField.type === 'boolean') {
      return (
        <Select
          clearable={false}
          onChange={(option): void => onChange(option?.id ?? 'true')}
          options={[...BOOLEAN_CONDITION_VALUE_OPTIONS]}
          placeholder="比較值"
          value={readSelectOption(
            BOOLEAN_CONDITION_VALUE_OPTIONS,
            value === 'false' ? 'false' : 'true',
          )}
        />
      );
    }

    if (isSelectFieldDefinition(conditionField)) {
      const options = conditionField.options.map(readFieldOptionAsSelectOption);

      return (
        <Select
          clearable={false}
          onChange={(option): void =>
            onChange(option?.id ?? options[0]?.id ?? '')
          }
          options={options}
          placeholder="比較值"
          value={readSelectOption(options, value)}
        />
      );
    }

    if (isNumberFieldDefinition(conditionField)) {
      return renderNumberInput(
        parseOptionalNumberInput(value),
        (nextValue): void => onChange(String(nextValue ?? 0)),
        '比較值',
      );
    }

    if (isDateFieldDefinition(conditionField)) {
      return renderDateValuePicker(conditionField, value, (nextValue): void =>
        onChange(nextValue ?? ''),
      );
    }

    return (
      <Input
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(event.target.value)
        }
        placeholder="比較值"
        value={value}
        variant="base"
      />
    );
  }

  function renderSettingsTextarea({
    name,
    onChange,
    placeholder,
    rows,
    value,
  }: {
    readonly name: string;
    readonly onChange: (value: string) => void;
    readonly placeholder: string;
    readonly rows: number;
    readonly value: string;
  }): ReactElement {
    return (
      <Textarea
        aria-label={name}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        ref={applyFullWidthTextareaHost}
        resize="vertical"
        rows={rows}
        style={FIELD_SETTINGS_TEXTAREA_STYLE}
        value={value}
      />
    );
  }

  function renderNumberInput(
    value: number | undefined,
    onChange: (value: number | undefined) => void,
    placeholder: string,
    options: {
      readonly max?: number;
      readonly min?: number;
      readonly step?: number;
    } = {},
  ): ReactElement {
    return (
      <Input
        max={options.max}
        min={options.min}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(
            clampOptionalNumber(
              parseOptionalNumberInput(event.target.value),
              options,
            ),
          )
        }
        placeholder={placeholder}
        showSpinner
        step={options.step ?? 1}
        value={typeof value === 'number' ? String(value) : ''}
        variant="measure"
      />
    );
  }

  function renderDateValuePicker(
    field: DateFieldDefinition,
    value: string,
    onChange: (value: string | undefined) => void,
  ): ReactElement {
    if (field.type === 'datetime') {
      return (
        <DateTimePicker
          formatDate="YYYY-MM-DD"
          formatTime="HH:mm"
          hideSecond
          onChange={(nextValue): void =>
            onChange(formatDateTimePickerValue(nextValue))
          }
          placeholderLeft="選擇日期"
          placeholderRight="選擇時間"
          value={readDatePickerValue(value)}
        />
      );
    }

    return (
      <DatePicker
        format="YYYY-MM-DD"
        onChange={(nextValue): void =>
          onChange(formatDatePickerValue(nextValue))
        }
        placeholder="選擇日期"
        value={readDatePickerValue(value)}
      />
    );
  }

  function renderFieldOptionsTable(
    field: FormStaticOptionFieldDefinition,
    commit: FieldCommit<FormStaticOptionFieldDefinition>,
  ): ReactElement {
    const optionRows: FieldOptionRow[] = field.options.map((option, index) => ({
      index,
      key: `${field.fieldKey}-${index}`,
      label: option.label,
      value: option.value,
    }));
    const optionColumns: TableColumn<FieldOptionRow>[] = [
      {
        key: 'label',
        render: (row): ReactElement => (
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commit({
                ...field,
                options: updateFieldOption(field.options, row.index, {
                  label: event.target.value,
                }),
              })
            }
            placeholder="例如：主管"
            size="sub"
            value={row.label}
            variant="base"
          />
        ),
        title: 'Label',
      },
      {
        key: 'value',
        render: (row): ReactElement => (
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              commit({
                ...field,
                options: updateFieldOption(field.options, row.index, {
                  value: event.target.value,
                }),
              })
            }
            placeholder="例如：manager"
            size="sub"
            value={row.value}
            variant="base"
          />
        ),
        title: 'Value',
      },
    ];
    const optionActions: TableActions<FieldOptionRow> = {
      render: (row): ReturnType<TableActions<FieldOptionRow>['render']> => [
        {
          disabled: (): boolean => field.options.length <= 1,
          icon: TrashIcon,
          iconType: 'icon-only',
          name: '移除選項',
          onClick: (): void =>
            commit({
              ...field,
              options: field.options.filter((_, index) => index !== row.index),
            }),
          variant: 'destructive-ghost',
        },
      ],
      width: 56,
    };

    return (
      <div style={COMPACT_STACK_STYLE}>
        <Table
          actions={optionActions}
          columns={optionColumns}
          dataSource={optionRows}
          showHeader
          size="sub"
        />
        <div style={OPTION_ACTIONS_STYLE}>
          <Button
            icon={PlusIcon}
            iconType="leading"
            onClick={(): void =>
              commit({
                ...field,
                options: [
                  ...field.options,
                  createNextFieldOption(field.options),
                ],
              })
            }
            variant="base-secondary"
          >
            新增選項
          </Button>
        </div>
      </div>
    );
  }

  function renderFieldBlock(
    field: FormFieldDefinition,
    draggableProvided: DraggableProvided,
    isDragging: boolean,
  ): ReactElement {
    return (
      <div
        {...draggableProvided.draggableProps}
        data-form-builder-field-key={field.fieldKey}
        ref={draggableProvided.innerRef}
        style={{
          ...FIELD_BLOCK_STYLE,
          ...(isDragging ? FIELD_BLOCK_DRAGGING_STYLE : null),
          ...draggableProvided.draggableProps.style,
        }}
      >
        <BaseCard
          style={
            field.fieldKey === selectedField?.fieldKey
              ? FIELD_BLOCK_SELECTED_CARD_STYLE
              : undefined
          }
        >
          {renderFieldBlockContent(field, draggableProvided, isDragging)}
        </BaseCard>
      </div>
    );
  }

  function renderSettingsFormRow(
    label: string,
    name: string,
    control: ReactElement,
    wide = false,
  ): ReactElement {
    return (
      <div
        style={wide ? FIELD_SETTINGS_ROW_WIDE_STYLE : FIELD_SETTINGS_ROW_STYLE}
      >
        <div style={FIELD_SETTINGS_VALUE_STYLE}>
          <BPMFormField label={label} name={name}>
            {control}
          </BPMFormField>
        </div>
      </div>
    );
  }

  function renderFieldBlockContent(
    field: FormFieldDefinition,
    draggableProvided: DraggableProvided,
    isDragging: boolean,
  ): ReactElement {
    return (
      <div
        {...(draggableProvided.dragHandleProps ?? {})}
        aria-label="選取或拖曳排序欄位"
        onClick={(): void => setSelectedFieldKey(field.fieldKey)}
        style={FIELD_BLOCK_ROW_STYLE}
        title="點擊選取，拖曳排序"
      >
        <span
          aria-label="拖曳排序"
          role="img"
          style={DRAG_HANDLE_STYLE}
          title="拖曳排序"
        >
          <Icon icon={DotDragVerticalIcon} size={20} />
        </span>
        <div style={FIELD_BLOCK_TEXT_STYLE}>
          <Typography component="span" ellipsis variant="label-primary">
            {field.label}
            {field.required ? (
              <sup aria-label="必填" style={REQUIRED_ASTERISK_STYLE}>
                *
              </sup>
            ) : null}
          </Typography>
          <Typography
            color="text-neutral"
            component="span"
            ellipsis
            variant="caption"
          >
            {readFieldTypeLabel(field.type)} ·
            {field.required ? ' 必填' : ' 選填'} ·{field.fieldKey}
          </Typography>
        </div>
        <div
          onClick={(event: MouseEvent<HTMLDivElement>): void =>
            event.stopPropagation()
          }
          style={FIELD_BLOCK_ACTIONS_STYLE}
        >
          <div style={FIELD_BLOCK_REQUIRED_STYLE}>
            <Toggle
              checked={Boolean(field.required)}
              disabled={isDragging}
              label="必填"
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateFieldRequired(field.fieldKey, event.target.checked)
              }
            />
          </div>
          <Button
            disabled={isDragging}
            icon={TrashIcon}
            iconType="icon-only"
            onClick={(): void => handleRemoveField(field.fieldKey)}
            variant="destructive-ghost"
          >
            移除欄位
          </Button>
        </div>
      </div>
    );
  }

  function renderPreviewTab(): ReactElement {
    return (
      <div style={STACK_STYLE}>
        <Typography component="h2" variant="h3">
          填寫預覽
        </Typography>
        <FormRenderer
          dataSourceContext={{ kind: 'preview' }}
          onChange={updatePreviewValues}
          schema={schema}
          uiSchema={uiSchema}
          value={previewValues}
        />
      </div>
    );
  }

  function renderAdvancedTab(): ReactElement {
    return (
      <div style={STACK_STYLE}>
        <Typography component="h2" variant="h3">
          Schema
        </Typography>
        <div style={ADVANCED_SCHEMA_FORM_STYLE}>
          {renderAdvancedSchemaRow(
            'Form Schema',
            'schemaJson',
            <JsonCodeEditor
              height="360px"
              name="schemaJson"
              onChange={updateSchemaJson}
              placeholder="輸入 Form Schema JSON"
              value={schemaJsonText}
            />,
          )}
          {renderAdvancedSchemaRow(
            'UI Schema',
            'uiSchemaJson',
            <JsonCodeEditor
              height="240px"
              name="uiSchemaJson"
              onChange={updateUiSchemaJson}
              placeholder="輸入 UI Schema JSON"
              value={uiSchemaJsonText}
            />,
          )}
          {advancedSchemaMessage ? (
            <Typography
              color="text-error"
              style={ADVANCED_SCHEMA_MESSAGE_STYLE}
              variant="body"
            >
              {advancedSchemaMessage}
            </Typography>
          ) : null}
        </div>
      </div>
    );
  }

  function renderAdvancedSchemaRow(
    label: string,
    name: string,
    control: ReactElement,
  ): ReactElement {
    return (
      <div style={ADVANCED_SCHEMA_ROW_STYLE}>
        <div style={ADVANCED_SCHEMA_VALUE_STYLE}>
          <BPMFormField label={label} name={name}>
            {control}
          </BPMFormField>
        </div>
      </div>
    );
  }
}

function readFieldTypeLabel(type: FieldType): string {
  return (
    FIELD_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type
  );
}

function readDataSourceDescriptorOptionId(value: {
  readonly key: string;
  readonly version: number;
}): string {
  return `${value.key}@${value.version}`;
}

function readDataSourceDescriptorOption(
  descriptor: FormDataSourceDescriptorRecord,
): { readonly id: string; readonly name: string } {
  return {
    id: readDataSourceDescriptorOptionId(descriptor),
    name: `${descriptor.label} · ${descriptor.key} v${descriptor.version}`,
  };
}

function readDataSourceBindingOptionId(
  binding: FormDataSourceBinding | null,
): string {
  if (!binding) {
    return UNBOUND_BINDING_ID;
  }

  return binding.from.kind === 'FIELD'
    ? binding.from.fieldKey
    : CONSTANT_BINDING_ID;
}

function readDefaultDataSourceConstant(
  parameterType: FormDataSourceParameterType,
): FormDataSourceConstantValue {
  switch (parameterType) {
    case 'BOOLEAN':
      return false;
    case 'NUMBER':
      return 0;
    case 'STRING_ARRAY':
      return '';
    case 'STRING':
      return '';
    default:
      return '';
  }
}

function readDataSourceConstantInputValue(
  binding: FormDataSourceBinding | null,
  parameterType: FormDataSourceParameterType,
): string {
  const value = binding?.from.kind === 'CONSTANT' ? binding.from.value : '';

  if (parameterType === 'NUMBER') {
    return typeof value === 'number' ? String(value) : '';
  }

  return typeof value === 'string' ? value : '';
}

function readBuilderConfirmationTitle(
  confirmation: PendingBuilderConfirmation,
): string {
  if (confirmation.kind === 'remove-field') {
    return '確認移除 dependency 欄位';
  }

  if (confirmation.kind === 'remove-column') {
    return '確認移除表格欄';
  }

  return confirmation.kind === 'replace-column'
    ? '確認變更欄型別'
    : '確認替換選項來源';
}

/**
 * Keeps identity and required-ness, drops everything the old type owned. A
 * `number` column's `minimum` means nothing to a `date` one, and carrying it
 * over would leave a schema the lint rejects for the wrong reason.
 */
function convertTableColumnType(
  column: TableColumnDefinition,
  type: TableColumnDefinition['type'],
): TableColumnDefinition {
  const base = {
    fieldKey: column.fieldKey,
    label: column.label,
    required: column.required,
    ...(column.description ? { description: column.description } : {}),
    ...(column.placeholder ? { placeholder: column.placeholder } : {}),
  };

  return type === 'select' || type === 'autocomplete'
    ? {
        ...base,
        mode: 'single' as const,
        options: [
          { label: '選項 A', value: 'option_a' },
          { label: '選項 B', value: 'option_b' },
        ],
        type,
      }
    : ({ ...base, type } as TableColumnDefinition);
}

function hasConditionRules(field: FormFieldDefinition): boolean {
  return Boolean(field.visibleWhen || field.requiredWhen || field.readonlyWhen);
}

function readFieldAsConditionSelectOption(field: FormFieldDefinition): {
  readonly id: string;
  readonly name: string;
} {
  return {
    id: field.fieldKey,
    name: field.label,
  };
}

function isTextFieldDefinition(
  field: FormFieldDefinition,
): field is TextFieldDefinition {
  return field.type === 'text' || field.type === 'textarea';
}

function readStringDefaultValue(
  value: FormFieldDefinition['defaultValue'],
): string {
  return typeof value === 'string' ? value : '';
}

function parseStringList(value: string): readonly string[] | undefined {
  const values = value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

function readStringListInput(value: readonly string[] | undefined): string {
  return value?.join('\n') ?? '';
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function updateFieldOption(
  options: readonly FormFieldOption[],
  targetIndex: number,
  patch: Partial<FormFieldOption>,
): readonly FormFieldOption[] {
  return options.map((option, index) =>
    index === targetIndex ? { ...option, ...patch } : option,
  );
}

function createNextFieldOption(
  options: readonly FormFieldOption[],
): FormFieldOption {
  const nextIndex = options.length + 1;

  return {
    label: `選項 ${nextIndex}`,
    value: readNextOptionValue(options, nextIndex),
  };
}

function readNextOptionValue(
  options: readonly FormFieldOption[],
  index: number,
): string {
  const value = `option_${index}`;

  return options.some((option) => option.value === value)
    ? readNextOptionValue(options, index + 1)
    : value;
}

function moveItemByIndex<TItem>(
  items: readonly TItem[],
  sourceIndex: number,
  destinationIndex: number,
): TItem[] {
  const sourceItem = items[sourceIndex];

  if (!sourceItem || sourceIndex === destinationIndex) {
    return [...items];
  }

  const remainingItems = items.filter((_, index) => index !== sourceIndex);

  return [
    ...remainingItems.slice(0, destinationIndex),
    sourceItem,
    ...remainingItems.slice(destinationIndex),
  ];
}
