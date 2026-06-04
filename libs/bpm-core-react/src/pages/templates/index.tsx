import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplatesView } from '../../views/templates';

export const metadata: Metadata = {
  title: '簽核模板 | BPM Admin',
  description: '設計簽核表單與流程，建立、編輯與發佈簽核模板。',
};

export default function TemplatesPage(): ReactElement {
  return <TemplatesView />;
}
