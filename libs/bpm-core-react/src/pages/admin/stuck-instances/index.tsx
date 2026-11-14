import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AdminStuckInstancesView } from '../../../views/admin/stuck-instances';

export const metadata: Metadata = {
  title: '卡住的案件 | BPM Admin',
  description: '列出往下一關失敗而停住的案件，管理員可撤銷。',
};

export default function AdminStuckInstancesPage(): ReactElement {
  return <AdminStuckInstancesView />;
}
