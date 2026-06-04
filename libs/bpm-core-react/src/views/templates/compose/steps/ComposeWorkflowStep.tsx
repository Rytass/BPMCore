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
}

export function ComposeWorkflowStep({
  formSchema,
  initiatorPolicyCel,
  onInitiatorPolicyChange,
  onWorkflowChange,
  workflowDefinition,
}: ComposeWorkflowStepProps): ReactElement {
  return (
    <>
      <Typography color="text-neutral" variant="caption">
        設計簽核節點與條件分流；條件可直接引用上一步設計的表單欄位。
      </Typography>
      <TemplateDesignerView
        embedded
        formSchemaOverride={formSchema}
        initialInitiatorPolicyCel={initiatorPolicyCel}
        initialWorkflowDefinition={workflowDefinition ?? undefined}
        onInitiatorPolicyChange={onInitiatorPolicyChange}
        onWorkflowChange={onWorkflowChange}
      />
    </>
  );
}
