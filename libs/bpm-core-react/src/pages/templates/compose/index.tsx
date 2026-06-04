import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplateComposeWizardView } from '../../../views/templates/compose';

export const metadata: Metadata = {
  title: '建立模板（表單 + 流程） | BPM Admin',
  description: '以精靈式流程一次完成 BPM 表單與簽核流程設計並發佈。',
};

/**
 * Drop-in Next.js App Router page for the unified template wizard.
 *
 * Consumer usage in `app/templates/compose/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/templates/compose';
 * ```
 */
export default function TemplateComposePage(): ReactElement {
  return <TemplateComposeWizardView />;
}
