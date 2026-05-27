import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplateVersionsView } from '../../../views/templates/versions';

export const metadata: Metadata = {
  title: '範本版本歷史 | BPM Admin',
  description: '檢視 BPM 流程範本的版本發布與 rollback 紀錄。',
};

export default async function TemplateVersionsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <TemplateVersionsView templateId={id} />;
}
