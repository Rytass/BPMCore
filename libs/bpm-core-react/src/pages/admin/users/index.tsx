import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AdminUsersView } from '../../../views/admin/users';

export const metadata: Metadata = {
  title: '會員對照 | BPM Admin',
  description: '檢視 BPM 內部會員組織歸屬與主管解析。',
};

export default function AdminUsersPage(): ReactElement {
  return <AdminUsersView />;
}
