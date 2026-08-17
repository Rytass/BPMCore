'use client';

import { CSSProperties, ReactElement } from 'react';
import { Button, Typography } from '@mezzanine-ui/react';
import { RefreshCcwIcon } from '@mezzanine-ui/icons';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import { ApprovalInstanceRecord, WorkflowFormData } from '@rytass/bpm-core-client/workflow';
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

export interface InstanceFormSectionProps {
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
  instance,
  loading,
  onDataSourceStateChange,
  onResubmitFormChange,
  onResubmitInstance,
  onUploadAttachment,
  resubmitFormData,
  resubmitFormErrors,
}: InstanceFormSectionProps): ReactElement {
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
      {instance?.formDefinitionSnapshot.schema &&
      instance.formDefinitionSnapshot.uiSchema ? (
        <>
          <FormRenderer
            dataSourceContext={
              canResubmitInstance
                ? {
                    instanceId: instance.id,
                    kind: 'runtime',
                    templateId: instance.templateId,
                  }
                : undefined
            }
            dataSourceInitialValues={instance.formData}
            errors={resubmitFormErrors}
            onChange={(values): void => {
              onResubmitFormChange(values);
            }}
            onDataSourceStateChange={onDataSourceStateChange}
            onUploadAttachment={
              canResubmitInstance ? onUploadAttachment : undefined
            }
            optionSnapshots={instance.formDataOptionSnapshot}
            readonly={!canResubmitInstance}
            schema={instance.formDefinitionSnapshot.schema}
            uiSchema={instance.formDefinitionSnapshot.uiSchema}
            value={
              canResubmitInstance ? resubmitFormData : instance.formData
            }
          />
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
