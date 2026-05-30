import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplateDesignerView } from '../../../views/templates/designer';

export const metadata: Metadata = {
  title: '流程設計器 | BPM Admin',
  description: '以視覺化設計器編輯 BPM 簽核流程節點、條件與發佈版本。',
};

export default async function TemplateDesignerPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;

  // AI assistant is opt-in per deployment. `BPM_AI_ASSISTANT_ENABLED` shows the
  // feature; `OPENAI_API_KEY` decides whether it's usable (else a disabled
  // placeholder). Both are server-only env on the Next.js host.
  return (
    <TemplateDesignerView
      aiAssistantAvailable={Boolean(process.env.OPENAI_API_KEY)}
      showAiAssistant={process.env.BPM_AI_ASSISTANT_ENABLED === 'true'}
      templateId={id}
    />
  );
}
