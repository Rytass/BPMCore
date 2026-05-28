'use client';

import {
  ChangeEvent,
  CSSProperties,
  Key,
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
  PageHeader,
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
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import {
  AlignLeftIcon,
  CalendarIcon,
  CheckedOutlineIcon,
  CheckedIcon,
  CurrencyDollarIcon,
  DotDragVerticalIcon,
  DotGridIcon,
  EditIcon,
  FileAttachmentIcon,
  FileIcon,
  ListIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  BooleanFieldDefinition,
  DateFieldDefinition,
  FileUploadFieldDefinition,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormUiSchema,
  NumberFieldDefinition,
  SelectFieldDefinition,
  TextFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { formatDateTime } from '../../../lib/format-date-time';
import {
  createFieldDefinition,
  FormBuilderRecord,
  FormDefinitionVersionRecord,
  forkFormDefinition,
  publishFormDefinitionVersion,
  readFormBuilder,
  updateFormDefinition,
  updateFormDefinitionDraft,
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
  readSelectOption,
} from '@rytass/bpm-core-client/form';
import { useRouterAdapter } from '../../../lib/router-adapter';
import { useBPMRoutes } from '../../../lib/routes-config';
import { BPMFormField } from '../../../components/bpm-form-field';
import { FormRenderer } from '../renderer/FormRendererView';
import { FormNameModal } from '../form-name-modal';
import { JsonCodeEditor } from './json-code-editor';

type FieldType = FormFieldDefinition['type'];
type BuilderTabKey = 'design' | 'preview' | 'versions' | 'advanced';
type FieldOptionRow = Readonly<
  Record<string, unknown> & {
    index: number;
    key: string;
    label: string;
    value: string;
  }
>;

type VersionRow = Readonly<
  Record<string, unknown> & {
    key: string;
    publishedAt: string;
    status: FormDefinitionVersionRecord['status'];
    updatedAt: string;
    version: string;
  }
>;

type BuilderSnapshot = Readonly<{
  schemaJson: string;
  uiSchemaJson: string;
}>;

type FieldTypeOption = Readonly<{
  description: string;
  icon: IconDefinition;
  label: string;
  type: FieldType;
}>;

type ConditionRuleTarget = 'readonlyWhen' | 'requiredWhen' | 'visibleWhen';

type ConditionRuleConfig = Readonly<{
  label: string;
  name: string;
  supportingText: string;
  target: ConditionRuleTarget;
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
];

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
  userSelect: 'none',
};

const FIELD_BLOCK_DRAGGING_STYLE: CSSProperties = {
  filter: 'drop-shadow(0 8px 18px rgba(0, 0, 0, 0.12))',
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
   * The id of the form definition being edited. Routed via the host's
   * dynamic segment (e.g. `[id]` in Next.js).
   */
  readonly formId: string;
}

export function FormBuilderView({ formId }: FormBuilderViewProps): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const formDefinitionId = formId;
  const [record, setRecord] = useState<FormBuilderRecord | null>(null);
  const [draft, setDraft] = useState<FormDefinitionVersionRecord | null>(null);
  const [schema, setSchema] = useState<FormDefinitionSchema>(EMPTY_SCHEMA);
  const [uiSchema, setUiSchema] = useState<FormUiSchema>(EMPTY_UI_SCHEMA);
  const [schemaJsonText, setSchemaJsonText] = useState(
    stringifyJson(EMPTY_SCHEMA),
  );
  const [uiSchemaJsonText, setUiSchemaJsonText] = useState(
    stringifyJson(EMPTY_UI_SCHEMA),
  );
  const [previewValues, setPreviewValues] = useState<FormRendererValues>({});
  const [advancedSchemaMessage, setAdvancedSchemaMessage] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<BuilderTabKey>('design');
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [loadedSnapshot, setLoadedSnapshot] = useState<BuilderSnapshot>(
    readBuilderSnapshot(EMPTY_SCHEMA, EMPTY_UI_SCHEMA),
  );
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect((): void => {
    void refreshBuilder();
  }, [formDefinitionId]);

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
  const versionRows = useMemo(
    (): VersionRow[] =>
      (record?.versions ?? []).map((version) => ({
        key: version.id,
        publishedAt: formatDateTime(version.publishedAt),
        status: version.status,
        updatedAt: formatDateTime(version.updatedAt),
        version: `v${version.version}`,
      })),
    [record],
  );
  const versionColumns = useMemo(
    (): TableColumn<VersionRow>[] => [
      { dataIndex: 'version', key: 'version', title: '版本', width: 120 },
      {
        key: 'status',
        render: (record: VersionRow): ReactElement => (
          <FormVersionStatusBadge status={record.status} />
        ),
        title: '狀態',
        width: 140,
      },
      {
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        title: '最後更新',
        width: 180,
      },
      {
        dataIndex: 'publishedAt',
        key: 'publishedAt',
        title: '發布時間',
        width: 180,
      },
    ],
    [],
  );
  const currentSnapshot = useMemo(
    (): BuilderSnapshot => readBuilderSnapshot(schema, uiSchema),
    [schema, uiSchema],
  );
  const hasUnsavedChanges =
    currentSnapshot.schemaJson !== loadedSnapshot.schemaJson ||
    currentSnapshot.uiSchemaJson !== loadedSnapshot.uiSchemaJson;

  useEffect((): (() => void) => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return (): void => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  function handleBackToForms(): void {
    if (
      hasUnsavedChanges &&
      !window.confirm('目前有尚未儲存的表單草稿，確定要離開嗎？')
    ) {
      return;
    }

    router.push(routes.forms());
  }
  const latestPublishedVersion = useMemo(
    (): FormDefinitionVersionRecord | null =>
      readPublishedVersion(
        record?.versions ?? [],
        record?.definition.currentVersionId,
      ),
    [record?.definition.currentVersionId, record?.versions],
  );
  const openedVersion =
    draft ?? latestPublishedVersion ?? record?.versions[0] ?? null;
  const openedContentPublished =
    !hasUnsavedChanges && openedVersion?.status === 'PUBLISHED';
  const headerDescription = readHeaderDescription({
    hasUnsavedChanges,
    latestPublishedVersion,
    openedContentPublished,
    openedVersion,
  });
  const publishDisabled =
    saving || (!hasUnsavedChanges && openedContentPublished && !draft);
  const publishButtonText = hasUnsavedChanges
    ? '保存並發布'
    : draft
      ? '發布草稿'
      : openedContentPublished
        ? '已發布'
        : '發布版本';

  async function refreshBuilder(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const nextRecord = await readFormBuilder(formDefinitionId);
      const nextDraft =
        nextRecord.versions.find((version) => version.status === 'DRAFT') ??
        null;

      setRecord(nextRecord);
      setDraft(nextDraft);
      const nextSchema =
        nextDraft?.schema ?? nextRecord.versions[0]?.schema ?? EMPTY_SCHEMA;
      const nextUiSchema =
        nextDraft?.uiSchema ??
        nextRecord.versions[0]?.uiSchema ??
        EMPTY_UI_SCHEMA;

      setSchema(nextSchema);
      setUiSchema(nextUiSchema);
      setLoadedSnapshot(readBuilderSnapshot(nextSchema, nextUiSchema));
      setSchemaJsonText(stringifyJson(nextSchema));
      setUiSchemaJsonText(stringifyJson(nextUiSchema));
      setSelectedFieldKey(
        nextDraft?.schema.fields[0]?.fieldKey ??
          nextRecord.versions[0]?.schema.fields[0]?.fieldKey ??
          null,
      );
      setAdvancedSchemaMessage(null);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrentDraft(): Promise<FormDefinitionVersionRecord> {
    const targetDraft = draft ?? (await forkFormDefinition(formDefinitionId));
    const nextDraft = await updateFormDefinitionDraft(
      targetDraft.id,
      schema,
      uiSchema,
    );

    setDraft(nextDraft);

    return nextDraft;
  }

  async function handleSaveDraft(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await saveCurrentDraft();
      await refreshBuilder();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const savedDraft = await saveCurrentDraft();
      await publishFormDefinitionVersion(savedDraft.id);
      await refreshBuilder();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameForm(name: string): Promise<void> {
    if (!record) {
      throw new Error('尚未載入表單資料');
    }

    setRenaming(true);

    try {
      const updatedDefinition = await updateFormDefinition(
        record.definition.id,
        name,
      );

      setRecord({
        ...record,
        definition: updatedDefinition,
      });
      setRenameModalOpen(false);
    } finally {
      setRenaming(false);
    }
  }

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
          width:
            type === 'textarea' || type === 'file_upload' ? 'FULL' : 'HALF',
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

    setSchema({
      ...schema,
      fields: schema.fields.map(
        (field): FormFieldDefinition =>
          field.fieldKey === previousFieldKey ? nextField : field,
      ),
    });
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
  }

  function updateSelectedTextField(
    patch: Partial<
      Pick<TextFieldDefinition, 'defaultValue' | 'maxLength' | 'minLength'>
    >,
  ): void {
    updateSelectedFieldWith((field) =>
      isTextFieldDefinition(field) ? { ...field, ...patch } : field,
    );
  }

  function updateSelectedNumberField(
    patch: Partial<
      Pick<NumberFieldDefinition, 'defaultValue' | 'maximum' | 'minimum'>
    >,
  ): void {
    updateSelectedFieldWith((field) =>
      isNumberFieldDefinition(field) ? { ...field, ...patch } : field,
    );
  }

  function updateSelectedDateField(
    patch: Partial<Pick<DateFieldDefinition, 'defaultValue'>>,
  ): void {
    updateSelectedFieldWith((field) =>
      isDateFieldDefinition(field) ? { ...field, ...patch } : field,
    );
  }

  function updateSelectedSelectField(
    patch: Partial<Pick<SelectFieldDefinition, 'defaultValue' | 'options'>>,
  ): void {
    updateSelectedFieldWith((field) =>
      isSelectFieldDefinition(field) ? { ...field, ...patch } : field,
    );
  }

  function updateSelectedBooleanField(
    patch: Partial<Pick<BooleanFieldDefinition, 'defaultValue'>>,
  ): void {
    updateSelectedFieldWith((field) =>
      field.type === 'boolean' ? { ...field, ...patch } : field,
    );
  }

  function updateSelectedFileUploadField(
    patch: Partial<
      Pick<
        FileUploadFieldDefinition,
        'acceptedMimeTypes' | 'defaultValue' | 'maxFiles'
      >
    >,
  ): void {
    updateSelectedFieldWith((field) =>
      field.type === 'file_upload' ? { ...field, ...patch } : field,
    );
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
          <PageHeader>
            <ContentHeader
              description={headerDescription}
              onBackClick={handleBackToForms}
              title={record?.definition.name ?? '表單設計器'}
            >
              <Button
                aria-label="修改表單名稱"
                disabled={renaming || !record}
                icon={EditIcon}
                iconType="icon-only"
                onClick={(): void => setRenameModalOpen(true)}
                variant="base-ghost"
              >
                修改表單名稱
              </Button>
              <Button
                aria-label="儲存草稿"
                disabled={saving || !hasUnsavedChanges}
                icon={SaveIcon}
                iconType="icon-only"
                onClick={(): void => void handleSaveDraft()}
                variant="base-secondary"
              >
                儲存草稿
              </Button>
              <Button
                disabled={publishDisabled}
                icon={CheckedIcon}
                iconType="leading"
                onClick={(): void => void handlePublish()}
                variant="base-primary"
              >
                {publishButtonText}
              </Button>
            </ContentHeader>
          </PageHeader>

          <SectionGroup>
            <Section>
              <div style={WORKBENCH_STYLE}>
                {error ? (
                  <Typography color="text-error" variant="body">
                    {error}
                  </Typography>
                ) : null}
                <Tab
                  activeKey={activeTab}
                  onChange={handleTabChange}
                  size="sub"
                >
                  <TabItem key="design">設計</TabItem>
                  <TabItem key="preview">預覽</TabItem>
                  <TabItem key="versions">版本</TabItem>
                  <TabItem key="advanced">進階</TabItem>
                </Tab>

                {activeTab === 'design' ? renderDesignTab() : null}
                {activeTab === 'preview' ? renderPreviewTab() : null}
                {activeTab === 'versions' ? renderVersionsTab() : null}
                {activeTab === 'advanced' ? renderAdvancedTab() : null}
              </div>
            </Section>
          </SectionGroup>
        </>

      <FormNameModal
        confirmText="儲存"
        initialName={record?.definition.name ?? ''}
        loading={renaming}
        onClose={(): void => setRenameModalOpen(false)}
        onSubmit={handleRenameForm}
        open={renameModalOpen}
        title="修改表單名稱"
      />
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
                disabled={saving}
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
                          isDragDisabled={saving}
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
                    disabled={saving}
                    onClick={(): void => handleAddField('text')}
                    variant="base-primary"
                  >
                    新增文字欄位
                  </Button>
                  <Button
                    disabled={saving}
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
          saving,
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
          saving,
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
          saving,
        )}
        {renderTypeSpecificSettings(field)}
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
  ): ReactElement {
    if (isTextFieldDefinition(field)) {
      return renderTextFieldSettings(field);
    }

    if (isNumberFieldDefinition(field)) {
      return renderNumberFieldSettings(field);
    }

    if (isDateFieldDefinition(field)) {
      return renderDateFieldSettings(field);
    }

    if (isSelectFieldDefinition(field)) {
      return renderSelectFieldSettings(field);
    }

    if (field.type === 'boolean') {
      return renderBooleanFieldSettings(field);
    }

    return renderFileUploadFieldSettings(field);
  }

  function renderTextFieldSettings(field: TextFieldDefinition): ReactElement {
    return (
      <>
        {renderSettingsFormRow(
          '預設值',
          'fieldDefaultValue',
          field.type === 'textarea' ? (
            renderSettingsTextarea({
              disabled: saving,
              name: 'fieldDefaultValue',
              onChange: (value): void =>
                updateSelectedTextField({ defaultValue: value || undefined }),
              placeholder: '輸入此欄位的預設文字',
              rows: 3,
              value: readStringDefaultValue(field.defaultValue),
            })
          ) : (
            <Input
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateSelectedTextField({
                  defaultValue: event.target.value || undefined,
                })
              }
              placeholder="輸入此欄位的預設文字"
              value={readStringDefaultValue(field.defaultValue)}
              variant="base"
            />
          ),
          saving,
        )}
        {renderSettingsFormRow(
          '最小長度',
          'fieldMinLength',
          renderNumberInput(
            field.minLength,
            (value): void => updateSelectedTextField({ minLength: value }),
            '例如：2',
            { min: 0 },
          ),
          saving,
        )}
        {renderSettingsFormRow(
          '最大長度',
          'fieldMaxLength',
          renderNumberInput(
            field.maxLength,
            (value): void => updateSelectedTextField({ maxLength: value }),
            '例如：100',
            { min: 1 },
          ),
          saving,
        )}
      </>
    );
  }

  function renderNumberFieldSettings(
    field: NumberFieldDefinition,
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
            (value): void => updateSelectedNumberField({ defaultValue: value }),
            field.type === 'money' ? '例如：1000' : '輸入預設數值',
            { max: field.maximum, min: field.minimum },
          ),
          saving,
        )}
        {renderSettingsFormRow(
          '最小值',
          'fieldMinimum',
          renderNumberInput(
            field.minimum,
            (value): void => updateSelectedNumberField({ minimum: value }),
            '例如：0',
          ),
          saving,
        )}
        {renderSettingsFormRow(
          '最大值',
          'fieldMaximum',
          renderNumberInput(
            field.maximum,
            (value): void => updateSelectedNumberField({ maximum: value }),
            '例如：999999',
          ),
          saving,
        )}
      </>
    );
  }

  function renderDateFieldSettings(field: DateFieldDefinition): ReactElement {
    return renderSettingsFormRow(
      '預設值',
      'fieldDefaultValue',
      renderDateValuePicker(
        field,
        readStringDefaultValue(field.defaultValue),
        (value): void => updateSelectedDateField({ defaultValue: value }),
      ),
      saving,
    );
  }

  function renderSelectFieldSettings(
    field: SelectFieldDefinition,
  ): ReactElement {
    const defaultValues = Array.isArray(field.defaultValue)
      ? field.defaultValue
      : [];
    const selectedValues = field.options
      .filter((option) => defaultValues.includes(option.value))
      .map(readFieldOptionAsSelectOption);

    return (
      <>
        {renderSettingsFormRow(
          '預設值',
          'fieldDefaultValue',
          field.type === 'checkbox' ? (
            <Select
              clearable
              mode="multiple"
              onChange={(options): void =>
                updateSelectedSelectField({
                  defaultValue: options.length
                    ? options.map((option) => option.id)
                    : undefined,
                })
              }
              options={field.options.map(readFieldOptionAsSelectOption)}
              placeholder="選擇一或多個預設選項"
              value={selectedValues}
            />
          ) : (
            <Select
              clearable
              onChange={(option): void =>
                updateSelectedSelectField({
                  defaultValue: option?.id || undefined,
                })
              }
              options={field.options.map(readFieldOptionAsSelectOption)}
              placeholder="選擇預設選項"
              value={
                typeof field.defaultValue === 'string'
                  ? readSelectOption(
                      field.options.map(readFieldOptionAsSelectOption),
                      field.defaultValue,
                    )
                  : null
              }
            />
          ),
          saving,
        )}
        {renderSettingsFormRow(
          '選項',
          'fieldOptions',
          renderFieldOptionsTable(field),
          saving,
          true,
        )}
      </>
    );
  }

  function renderBooleanFieldSettings(
    field: BooleanFieldDefinition,
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
          updateSelectedBooleanField({
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
      saving,
    );
  }

  function renderFileUploadFieldSettings(
    field: FileUploadFieldDefinition,
  ): ReactElement {
    return (
      <>
        {renderSettingsFormRow(
          '檔案數',
          'fieldMaxFiles',
          renderNumberInput(
            field.maxFiles,
            (value): void => updateSelectedFileUploadField({ maxFiles: value }),
            '例如：1',
            { min: 1 },
          ),
          saving,
        )}
        {renderSettingsFormRow(
          'MIME',
          'fieldAcceptedMimeTypes',
          renderSettingsTextarea({
            disabled: saving,
            name: 'fieldAcceptedMimeTypes',
            onChange: (value): void =>
              updateSelectedFileUploadField({
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
          disabled={saving}
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
      saving,
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
    disabled,
    name,
    onChange,
    placeholder,
    rows,
    value,
  }: {
    readonly disabled: boolean;
    readonly name: string;
    readonly onChange: (value: string) => void;
    readonly placeholder: string;
    readonly rows: number;
    readonly value: string;
  }): ReactElement {
    return (
      <Textarea
        aria-label={name}
        disabled={disabled}
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

  function renderFieldOptionsTable(field: SelectFieldDefinition): ReactElement {
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
              updateSelectedSelectField({
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
              updateSelectedSelectField({
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
          disabled: (): boolean => saving || field.options.length <= 1,
          icon: TrashIcon,
          iconType: 'icon-only',
          name: '移除選項',
          onClick: (): void =>
            updateSelectedSelectField({
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
            disabled={saving}
            icon={PlusIcon}
            iconType="leading"
            onClick={(): void =>
              updateSelectedSelectField({
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
        <BaseCard>
          {renderFieldBlockContent(field, draggableProvided, isDragging)}
        </BaseCard>
      </div>
    );
  }

  function renderSettingsFormRow(
    label: string,
    name: string,
    control: ReactElement,
    disabled: boolean,
    wide = false,
  ): ReactElement {
    return (
      <div
        style={wide ? FIELD_SETTINGS_ROW_WIDE_STYLE : FIELD_SETTINGS_ROW_STYLE}
      >
        <div style={FIELD_SETTINGS_VALUE_STYLE}>
          <BPMFormField disabled={disabled} label={label} name={name}>
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
        aria-label="拖曳排序欄位"
        style={FIELD_BLOCK_ROW_STYLE}
        title="拖曳排序"
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
        <div style={FIELD_BLOCK_ACTIONS_STYLE}>
          <div style={FIELD_BLOCK_REQUIRED_STYLE}>
            <Toggle
              checked={Boolean(field.required)}
              disabled={saving || isDragging}
              label="必填"
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateFieldRequired(field.fieldKey, event.target.checked)
              }
            />
          </div>
          <Button
            disabled={isDragging}
            icon={EditIcon}
            iconType="icon-only"
            onClick={(): void => setSelectedFieldKey(field.fieldKey)}
            variant={
              field.fieldKey === selectedField?.fieldKey
                ? 'base-primary'
                : 'base-ghost'
            }
          >
            編輯欄位
          </Button>
          <Button
            disabled={saving || isDragging}
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
          onChange={updatePreviewValues}
          schema={schema}
          uiSchema={uiSchema}
          value={previewValues}
        />
      </div>
    );
  }

  function renderVersionsTab(): ReactElement {
    return (
      <div style={STACK_STYLE}>
        <Typography component="h2" variant="h3">
          版本紀錄
        </Typography>
        <Table
          columns={versionColumns}
          dataSource={versionRows}
          loading={loading}
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
              disabled={saving}
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
              disabled={saving}
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
          <BPMFormField disabled={saving} label={label} name={name}>
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

function readBuilderSnapshot(
  schema: FormDefinitionSchema,
  uiSchema: FormUiSchema,
): BuilderSnapshot {
  return {
    schemaJson: stringifyJson(schema),
    uiSchemaJson: stringifyJson(uiSchema),
  };
}

function readPublishedVersion(
  versions: readonly FormDefinitionVersionRecord[],
  currentVersionId: string | null | undefined,
): FormDefinitionVersionRecord | null {
  return (
    (currentVersionId
      ? versions.find((version) => version.id === currentVersionId)
      : null) ??
    versions.find((version) => version.status === 'PUBLISHED') ??
    null
  );
}

function readHeaderDescription({
  hasUnsavedChanges,
  latestPublishedVersion,
  openedContentPublished,
  openedVersion,
}: {
  readonly hasUnsavedChanges: boolean;
  readonly latestPublishedVersion: FormDefinitionVersionRecord | null;
  readonly openedContentPublished: boolean;
  readonly openedVersion: FormDefinitionVersionRecord | null;
}): string {
  const editState = hasUnsavedChanges ? '有未儲存修改' : '沒有未儲存修改';
  const openedState = readOpenedVersionState({
    hasUnsavedChanges,
    openedContentPublished,
    openedVersion,
  });
  const publishedState = latestPublishedVersion
    ? `目前發布 v${latestPublishedVersion.version}：${formatDateTime(
        latestPublishedVersion.publishedAt,
      )}`
    : '目前沒有已發布版本';

  return `${editState} · ${openedState} · ${publishedState}`;
}

function readOpenedVersionState({
  hasUnsavedChanges,
  openedContentPublished,
  openedVersion,
}: {
  readonly hasUnsavedChanges: boolean;
  readonly openedContentPublished: boolean;
  readonly openedVersion: FormDefinitionVersionRecord | null;
}): string {
  if (hasUnsavedChanges) {
    return openedVersion
      ? `修改尚未發布，來源 v${openedVersion.version}`
      : '修改尚未發布';
  }

  if (openedContentPublished && openedVersion) {
    return `當前內容已發布 v${openedVersion.version}`;
  }

  if (openedVersion) {
    return `當前內容尚未發布 v${openedVersion.version}`;
  }

  return '當前內容尚未發布';
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

function FormVersionStatusBadge({
  status,
}: {
  readonly status: FormDefinitionVersionRecord['status'];
}): ReactElement {
  if (status === 'PUBLISHED') {
    return <Badge size="sub" text="已發布" variant="dot-success" />;
  }

  if (status === 'ARCHIVED') {
    return <Badge size="sub" text="已封存" variant="dot-inactive" />;
  }

  return <Badge size="sub" text="草稿" variant="dot-warning" />;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
