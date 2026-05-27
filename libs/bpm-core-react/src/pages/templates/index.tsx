import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplatesView } from '../../views/templates';

export const metadata: Metadata = {
  title: '流程範本 | BPM Admin',
  description: '管理 BPM 流程範本，建立、編輯與發佈簽核模板。',
};

export default function TemplatesPage(): ReactElement {
  return <TemplatesView />;
}
