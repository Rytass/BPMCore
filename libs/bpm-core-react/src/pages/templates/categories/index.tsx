import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TemplateCategoriesView } from '../../../views/templates/categories';

export const metadata: Metadata = {
  title: '範本分類管理 | BPM Admin',
  description: '維護 BPM 流程範本的分類設定。',
};

export default function TemplateCategoriesPage(): ReactElement {
  return <TemplateCategoriesView />;
}
