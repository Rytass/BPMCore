'use client';

import { ChangeEvent, CSSProperties, ReactElement, useMemo } from 'react';
import {
  Button,
  InlineMessage,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import { RefreshCcwIcon } from '@mezzanine-ui/icons';
import type { ResolvedFieldAccess } from '@rytass/bpm-core-shared';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { ApprovalInstanceRecord, WorkflowFormData } from '@rytass/bpm-core-client/workflow';
import { BPMFormField } from '../../../../components/bpm-form-field';
import { readApplicantFormSchema } from '../../approver-filled-form';
import { FormRenderer } from '../../../forms/renderer/FormRendererView';
import type { FormDataSourceFieldState } from '../../../forms/renderer/form-data-source-field';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const COMMENT_TEXTAREA_STYLE: CSSProperties = {
  minWidth: '100%',
  width: '100%',
};

function applyFullWidthTextareaHost(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }

  element.style.width = '100%';
}

/** The fill state of the viewer's own task at a node that fills in fields. */
export interface InstanceFormSectionFill {
  /** Field errors from the page's check or the server's, keyed by path. */
  readonly errors: Readonly<Record<string, string>>;
  /** How many fields this node lets the viewer fill in. */
  readonly fieldCount: number;
  /** Called with the whole form value whenever a fill field changes. */
  readonly onChange: (values: WorkflowFormData) => void;
  /** The form as this approver sees it (fill fields required per node). */
  readonly schema: FormDefinitionSchema;
  /** The stored form data with the draft fill on top. */
  readonly value: WorkflowFormData;
}

export interface InstanceFormSectionProps {
  /**
   * What the viewer may see and edit per field (`readViewerFieldAccess`).
   * Ignored while the applicant edits a returned instance.
   */
  readonly fieldAccess?: Readonly<Record<string, ResolvedFieldAccess>>;
  /** Marker after each approver-filled field's label (`readFillLabelMarkers`). */
  readonly fieldLabelMarkers?: Readonly<Record<string, string>>;
  /** Present when the viewer's task fills in fields; edits go through it. */
  readonly fill?: InstanceFormSectionFill | null;
  /**
   * Present after approving failed because the form changed meanwhile; the
   * draft fill is kept and re-applied after reloading.
   */
  readonly onReloadAfterConflict?: (() => void) | null;
  /** The loaded approval instance, or null while loading. */
  readonly instance: ApprovalInstanceRecord | null;
  /** Whether the instance is in a loading state. */
  readonly loading: boolean;
  /** Error message to display, if any. */
  readonly error: string | null;
  /** Whether the current user can resubmit (edit + resubmit the returned form). */
  readonly canResubmitInstance: boolean;
  /** Current form data for the resubmit flow. */
  readonly resubmitFormData: WorkflowFormData;
  /** Validation error map for the resubmit form. */
  readonly resubmitFormErrors: Readonly<Record<string, string>>;
  /** Whether a decision/submit action is in progress. */
  readonly deciding: boolean;
  /** Called when the form data changes in the resubmit flow. */
  readonly onResubmitFormChange: (values: WorkflowFormData) => void;
  /** Called when a dynamic option field changes validation state. */
  readonly onDataSourceStateChange: (
    fieldKey: string,
    state: Pick<
      FormDataSourceFieldState,
      'hasValue' | 'invalidValues' | 'status'
    >,
  ) => void;
  /** Called when the user clicks "重新送出". */
  readonly onResubmitInstance: () => void;
  /**
   * The applicant's comment for the resubmission. The comment box shows only
   * when `onResubmitCommentChange` is given.
   */
  readonly resubmitComment?: string;
  /** Called when the applicant edits the resubmission comment. */
  readonly onResubmitCommentChange?: ((value: string) => void) | null;
  /** Called when an attachment upload is requested via the form field. */
  readonly onUploadAttachment: (
    field: FormFieldDefinition,
    file: File,
  ) => Promise<{ readonly id: string }>;
}

/**
 * Renders the form snapshot section of the approval instance detail page.
 * Displays the form in read-only mode normally, or editable mode when the
 * instance has been returned and the current member can resubmit it.
 */
export function InstanceFormSection({
  canResubmitInstance,
  deciding,
  error,
  fieldAccess,
  fieldLabelMarkers,
  fill = null,
  instance,
  loading,
  onDataSourceStateChange,
  onResubmitFormChange,
  onReloadAfterConflict = null,
  onResubmitCommentChange = null,
  onResubmitInstance,
  onUploadAttachment,
  resubmitComment = '',
  resubmitFormData,
  resubmitFormErrors,
}: InstanceFormSectionProps): ReactElement {
  const schemaSnapshot = instance?.formDefinitionSnapshot.schema;
  const workflowSnapshot = instance?.workflowSnapshot;
  // Approver-filled fields are not the applicant's to edit (the server drops
  // them on resubmit), so the edit state leaves them out. The read-only view
  // keeps the full schema and `fieldAccess` decides what each viewer sees.
  // Memoised so the renderer is not handed a new schema on every render.
  const displayedSchema = useMemo(
    () =>
      canResubmitInstance && schemaSnapshot && workflowSnapshot
        ? readApplicantFormSchema(schemaSnapshot, workflowSnapshot)
        : (fill?.schema ?? schemaSnapshot),
    [canResubmitInstance, fill?.schema, schemaSnapshot, workflowSnapshot],
  );
  const filling = !canResubmitInstance && fill !== null;

  return (
    <div style={SECTION_BODY_STYLE}>
      {error ? (
        <Typography color="text-error" variant="body">
          {error}
        </Typography>
      ) : null}
      {loading ? (
        <Typography color="text-neutral" variant="body">
          載入中...
        </Typography>
      ) : null}
      {onReloadAfterConflict ? (
        <div style={SECTION_BODY_STYLE}>
          <InlineMessage
            content="表單在你填寫期間被更新了，你填的內容還在。請重新載入後確認再同意。"
            severity="error"
          />
          <div style={BUTTON_ROW_STYLE}>
            <Button
              disabled={loading}
              icon={RefreshCcwIcon}
              iconType="leading"
              onClick={onReloadAfterConflict}
              variant="base-secondary"
            >
              重新載入
            </Button>
          </div>
        </div>
      ) : null}
      {filling && fill.fieldCount > 0 ? (
        <InlineMessage
          content={`本關需要你補填 ${fill.fieldCount} 個欄位，按「同意」時會一起送出並納入簽章。`}
          severity="info"
        />
      ) : null}
      {displayedSchema && instance?.formDefinitionSnapshot.uiSchema ? (
        <>
          <FormRenderer
            dataSourceContext={
              canResubmitInstance
                ? {
                    // Instance-scoped only: the runtime query rejects a context
                    // that names both, and a returned instance must resolve its
                    // options against its own form definition snapshot rather
                    // than whatever version the template publishes today.
                    instanceId: instance.id,
                    kind: 'runtime',
                  }
                : undefined
            }
            dataSourceInitialValues={instance.formData}
            errors={filling ? fill.errors : resubmitFormErrors}
            {...(!canResubmitInstance && fieldAccess ? { fieldAccess } : {})}
            {...(!canResubmitInstance && fieldLabelMarkers
              ? { fieldLabelMarkers }
              : {})}
            onChange={(values): void => {
              if (filling) {
                fill.onChange(values);

                return;
              }

              onResubmitFormChange(values);
            }}
            onDataSourceStateChange={onDataSourceStateChange}
            onUploadAttachment={
              canResubmitInstance ? onUploadAttachment : undefined
            }
            optionSnapshots={instance.formDataOptionSnapshot}
            readonly={!canResubmitInstance}
            schema={displayedSchema}
            uiSchema={instance.formDefinitionSnapshot.uiSchema}
            value={
              canResubmitInstance
                ? resubmitFormData
                : filling
                  ? fill.value
                  : instance.formData
            }
          />
          {canResubmitInstance && onResubmitCommentChange ? (
            <BPMFormField label="簽核意見" name="resubmitComment">
              <Textarea
                disabled={deciding}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  onResubmitCommentChange(event.target.value)
                }
                placeholder="選填，例如說明這次補正或修改了哪些內容"
                ref={applyFullWidthTextareaHost}
                resize="vertical"
                rows={4}
                style={COMMENT_TEXTAREA_STYLE}
                value={resubmitComment}
              />
            </BPMFormField>
          ) : null}
          {canResubmitInstance ? (
            <div style={BUTTON_ROW_STYLE}>
              <Button
                disabled={deciding}
                icon={RefreshCcwIcon}
                iconType="leading"
                onClick={onResubmitInstance}
                variant="base-primary"
              >
                重新送出
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <Typography color="text-neutral" variant="body">
          此案件沒有可顯示的表單快照。
        </Typography>
      )}
    </div>
  );
}
