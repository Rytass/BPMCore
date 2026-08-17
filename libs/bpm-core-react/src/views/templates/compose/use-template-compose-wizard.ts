'use client';

import { useCallback, useState } from 'react';
import type {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { readFormSchemaLintMessage } from '@rytass/bpm-core-client/form';
import {
  ComposeApprovalTemplateWithFormResult,
  composeApprovalTemplateWithForm,
} from '@rytass/bpm-core-client/template';

export type ComposeWizardStep = 0 | 1 | 2;

export type ComposePublishPhase = 'error' | 'idle' | 'submitting' | 'success';

export const EMPTY_COMPOSE_FORM_SCHEMA: FormDefinitionSchema = {
  fields: [],
  schemaVersion: 1,
};

export const EMPTY_COMPOSE_FORM_UI_SCHEMA: FormUiSchema = {
  layout: [],
  schemaVersion: 1,
};

export interface TemplateComposeWizard {
  readonly currentStep: ComposeWizardStep;
  /**
   * Single user-facing name. Persisted to both the template and the form
   * (`templateName` / `formName`) at the `composeApprovalTemplateWithForm`
   * boundary — the DB keeps two columns, the UI keeps one field.
   */
  readonly name: string;
  readonly categoryId: string | null;
  readonly formSchema: FormDefinitionSchema;
  readonly formUiSchema: FormUiSchema;
  readonly workflowDefinition: WorkflowDefinition | null;
  readonly initiatorPolicyCel: string | null;
  readonly publishPhase: ComposePublishPhase;
  readonly publishError: string | null;
  readonly canLeaveBasics: boolean;
  readonly goToStep: (step: ComposeWizardStep) => void;
  readonly goNext: () => void;
  readonly goBack: () => void;
  readonly setName: (value: string) => void;
  readonly setCategoryId: (value: string | null) => void;
  readonly setFormValue: (next: {
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
  }) => void;
  readonly setWorkflowDefinition: (definition: WorkflowDefinition) => void;
  readonly setInitiatorPolicyCel: (cel: string | null) => void;
  readonly publish: () => Promise<ComposeApprovalTemplateWithFormResult | null>;
}

/**
 * Owns the cross-step state for the unified "form + flow" template wizard.
 *
 * Step 0 (表單) edits `formSchema`/`formUiSchema`; that same in-memory schema
 * feeds Step 1 (流程) as the field source for condition branches, so the
 * embedded designer never needs a published form version. Step 2 (檢視發佈)
 * submits everything through the atomic `composeApprovalTemplateWithForm`
 * mutation.
 */
export function useTemplateComposeWizard(): TemplateComposeWizard {
  const [currentStep, setCurrentStep] = useState<ComposeWizardStep>(0);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [formSchema, setFormSchema] = useState<FormDefinitionSchema>(
    EMPTY_COMPOSE_FORM_SCHEMA,
  );
  const [formUiSchema, setFormUiSchema] = useState<FormUiSchema>(
    EMPTY_COMPOSE_FORM_UI_SCHEMA,
  );
  const [workflowDefinition, setWorkflowDefinitionState] =
    useState<WorkflowDefinition | null>(null);
  const [initiatorPolicyCel, setInitiatorPolicyCelState] = useState<
    string | null
  >(null);
  const [publishPhase, setPublishPhase] = useState<ComposePublishPhase>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);

  const canLeaveBasics = name.trim().length > 0 && formSchema.fields.length > 0;

  const goToStep = useCallback((step: ComposeWizardStep): void => {
    setCurrentStep(step);
  }, []);

  const goNext = useCallback((): void => {
    setCurrentStep((step) =>
      step < 2 ? ((step + 1) as ComposeWizardStep) : step,
    );
  }, []);

  const goBack = useCallback((): void => {
    setCurrentStep((step) =>
      step > 0 ? ((step - 1) as ComposeWizardStep) : step,
    );
  }, []);

  const setFormValue = useCallback(
    (next: {
      readonly schema: FormDefinitionSchema;
      readonly uiSchema: FormUiSchema;
    }): void => {
      setFormSchema(next.schema);
      setFormUiSchema(next.uiSchema);
    },
    [],
  );

  const setWorkflowDefinition = useCallback(
    (definition: WorkflowDefinition): void => {
      setWorkflowDefinitionState(definition);
    },
    [],
  );

  const setInitiatorPolicyCel = useCallback((cel: string | null): void => {
    setInitiatorPolicyCelState(cel);
  }, []);

  const publish =
    useCallback(async (): Promise<ComposeApprovalTemplateWithFormResult | null> => {
      setPublishPhase('submitting');
      setPublishError(null);

      try {
        const result = await composeApprovalTemplateWithForm({
          category: null,
          categoryId,
          formDefinitionId: null,
          formDescription: null,
          // One UI name fans out to both persisted columns.
          formName: name,
          initiatorPolicyCel,
          notificationConfig: null,
          publish: true,
          schema: formSchema,
          slaDefaults: null,
          templateDescription: null,
          templateId: null,
          templateName: name,
          uiSchema: formUiSchema,
          workflowDefinition: workflowDefinition ?? EMPTY_WORKFLOW_DEFINITION,
        });

        setPublishPhase('success');

        return result;
      } catch (requestError: unknown) {
        setPublishError(readErrorMessage(requestError));
        setPublishPhase('error');

        return null;
      }
    }, [
      categoryId,
      formSchema,
      formUiSchema,
      initiatorPolicyCel,
      name,
      workflowDefinition,
    ]);

  return {
    canLeaveBasics,
    categoryId,
    currentStep,
    formSchema,
    formUiSchema,
    goBack,
    goNext,
    goToStep,
    initiatorPolicyCel,
    name,
    publish,
    publishError,
    publishPhase,
    setCategoryId,
    setFormValue,
    setInitiatorPolicyCel,
    setName,
    setWorkflowDefinition,
    workflowDefinition,
  };
}

const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
  edges: [],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 80, y: 160 },
      type: 'startEvent',
    },
    {
      data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
      id: 'end',
      position: { x: 560, y: 160 },
      type: 'endEvent',
    },
  ],
};

function readErrorMessage(error: unknown): string {
  // Publish failures can carry stable `FORM_DATA_SOURCE_*` codes; map them to
  // readable copy and leave every other message untouched.
  return error instanceof Error
    ? readFormSchemaLintMessage(error.message)
    : '發生未知錯誤';
}
