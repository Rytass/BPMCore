'use client';

import type { ReactElement } from 'react';
import {
  Button,
  PageHeader,
  Section,
  SectionGroup,
  Step,
  Stepper,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { useRouterAdapter } from '../../../lib/router-adapter';
import { useBPMRoutes } from '../../../lib/routes-config';
import { ComposeFormStep } from './steps/ComposeFormStep';
import { ComposeReviewStep } from './steps/ComposeReviewStep';
import { ComposeWorkflowStep } from './steps/ComposeWorkflowStep';
import { useTemplateComposeWizard } from './use-template-compose-wizard';

export interface TemplateComposeWizardViewProps {
  /**
   * Show the workflow designer AI assistant inside Step 1 (流程設計). Opt-in,
   * default hidden — the server page maps `BPM_AI_ASSISTANT_ENABLED` to it.
   */
  readonly showAiAssistant?: boolean;
  /**
   * Whether the LLM backend is configured (host has an API key). When `false`
   * the AI button shows disabled as a placeholder. Default `false`.
   */
  readonly aiAssistantAvailable?: boolean;
}

/**
 * Unified "form + flow" template creation wizard. Walks the user through
 * Step 0 表單設計 → Step 1 流程設計 → Step 2 檢視並發佈, then commits both
 * sides atomically through `composeApprovalTemplateWithForm`. Coexists with
 * the separate `/forms` and `/templates` entry points.
 */
export function TemplateComposeWizardView({
  aiAssistantAvailable = false,
  showAiAssistant = false,
}: TemplateComposeWizardViewProps = {}): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const wizard = useTemplateComposeWizard();
  const submitting = wizard.publishPhase === 'submitting';

  async function handlePublish(): Promise<void> {
    const result = await wizard.publish();

    if (result) {
      router.push(routes.templateDesigner(result.templateId));
    }
  }

  return (
    <>
      <PageHeader>
        <ContentHeader
          description="一次完成表單與流程設計，發佈後即可直接發起。"
          title="建立模板（表單 + 流程）"
        >
          <Button
            disabled={submitting}
            onClick={(): void => router.push(routes.templates())}
            variant="base-secondary"
          >
            返回模板列表
          </Button>
        </ContentHeader>
      </PageHeader>

      <SectionGroup>
        <Section>
          <Stepper currentStep={wizard.currentStep}>
            <Step description="設計欄位與版面" title="表單設計" />
            <Step description="設計簽核節點與條件" title="流程設計" />
            <Step description="確認後發佈" title="檢視並發佈" />
          </Stepper>

          {wizard.currentStep === 0 ? (
            <ComposeFormStep
              categoryId={wizard.categoryId}
              formSchema={wizard.formSchema}
              formUiSchema={wizard.formUiSchema}
              name={wizard.name}
              onCategoryIdChange={wizard.setCategoryId}
              onFormChange={wizard.setFormValue}
              onNameChange={wizard.setName}
            />
          ) : null}

          {wizard.currentStep === 1 ? (
            <ComposeWorkflowStep
              aiAssistantAvailable={aiAssistantAvailable}
              formSchema={wizard.formSchema}
              initiatorPolicyCel={wizard.initiatorPolicyCel}
              onInitiatorPolicyChange={wizard.setInitiatorPolicyCel}
              onWorkflowChange={wizard.setWorkflowDefinition}
              showAiAssistant={showAiAssistant}
              workflowDefinition={wizard.workflowDefinition}
            />
          ) : null}

          {wizard.currentStep === 2 ? (
            <ComposeReviewStep
              formSchema={wizard.formSchema}
              formUiSchema={wizard.formUiSchema}
              initiatorPolicyCel={wizard.initiatorPolicyCel}
              name={wizard.name}
              publishError={wizard.publishError}
              workflowDefinition={wizard.workflowDefinition}
            />
          ) : null}

          <div style={FOOTER_STYLE}>
            {wizard.currentStep === 0 && !wizard.canLeaveBasics ? (
              <Typography color="text-neutral" variant="caption">
                請填寫模板名稱、表單名稱，並至少新增一個表單欄位。
              </Typography>
            ) : (
              <span />
            )}
            <div style={FOOTER_ACTIONS_STYLE}>
              <Button
                disabled={wizard.currentStep === 0 || submitting}
                onClick={wizard.goBack}
                variant="base-secondary"
              >
                上一步
              </Button>
              {wizard.currentStep < 2 ? (
                <Button
                  disabled={wizard.currentStep === 0 && !wizard.canLeaveBasics}
                  onClick={wizard.goNext}
                  variant="base-primary"
                >
                  下一步
                </Button>
              ) : (
                <Button
                  disabled={submitting}
                  loading={submitting}
                  onClick={(): void => {
                    void handlePublish();
                  }}
                  variant="base-primary"
                >
                  發佈
                </Button>
              )}
            </div>
          </div>
        </Section>
      </SectionGroup>
    </>
  );
}

const FOOTER_STYLE = {
  alignItems: 'center',
  display: 'flex',
  // Match the breathing room used elsewhere (the Section's top padding token).
  marginTop: 'var(--mzn-spacing-padding-vertical-spacious)',
  justifyContent: 'space-between',
  gap: 16,
} as const;

const FOOTER_ACTIONS_STYLE = {
  display: 'flex',
  gap: 8,
} as const;
