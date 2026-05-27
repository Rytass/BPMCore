import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AdminOrgsView } from '../../../views/admin/orgs';

export const metadata: Metadata = {
  title: '組織管理 | BPM Admin',
  description: '維護組織樹、職位、會員歸屬與簽核主管解析規則。',
};

export default function AdminOrgsPage(): ReactElement {
  return <AdminOrgsView />;
}
