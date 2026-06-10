'use client';

import type { ReactElement } from 'react';
import { Typography } from '@mezzanine-ui/react';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { TemplateDesignerView } from '../../designer';

export interface ComposeWorkflowStepProps {
  readonly formSchema: FormDefinitionSchema;
  readonly workflowDefinition: WorkflowDefinition | null;
  readonly initiatorPolicyCel: string | null;
  readonly onWorkflowChange: (definition: WorkflowDefinition) => void;
  readonly onInitiatorPolicyChange: (cel: string | null) => void;
  /**
   * Show the AI assistant button inside the embedded designer's side panel.
   * Follows the same opt-in contract as the standalone designer page; default
   * hidden. Wired up the stack from the server page's `BPM_AI_ASSISTANT_ENABLED`.
   */
  readonly showAiAssistant?: boolean;
  /**
   * Whether the LLM backend is configured (host has an API key). When `false`
   * the AI button shows disabled as a placeholder. Default `false`.
   */
  readonly aiAssistantAvailable?: boolean;
}

export function ComposeWorkflowStep({
  aiAssistantAvailable = false,
  formSchema,
  initiatorPolicyCel,
  onInitiatorPolicyChange,
  onWorkflowChange,
  showAiAssistant = false,
  workflowDefinition,
}: ComposeWorkflowStepProps): ReactElement {
  return (
    <>
      <Typography color="text-neutral" variant="caption">
        設計簽核節點與條件分流；條件可直接引用上一步設計的表單欄位。
      </Typography>
      <TemplateDesignerView
        aiAssistantAvailable={aiAssistantAvailable}
        embedded
        formSchemaOverride={formSchema}
        initialInitiatorPolicyCel={initiatorPolicyCel}
        initialWorkflowDefinition={workflowDefinition ?? undefined}
        onInitiatorPolicyChange={onInitiatorPolicyChange}
        onWorkflowChange={onWorkflowChange}
        showAiAssistant={showAiAssistant}
      />
    </>
  );
}
