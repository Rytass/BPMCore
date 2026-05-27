import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AdminDelegationsView } from '../../../views/admin/delegations';

export const metadata: Metadata = {
  title: '代理設定 | BPM Admin',
  description: '設定簽核代理規則，讓符合範圍的待簽任務自動改派給代理人。',
};

export default function AdminDelegationsPage(): ReactElement {
  return <AdminDelegationsView />;
}
