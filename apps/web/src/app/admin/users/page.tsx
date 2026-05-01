'use client';

import { ReactElement } from 'react';
import { Button, Typography } from '@mezzanine-ui/react';
import { SearchIcon } from '@mezzanine-ui/icons';
import { AdminShell } from '../admin-shell';
import styles from '../admin.module.scss';

interface MemberRow {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly orgUnit: string;
  readonly position: string;
}

const members: readonly MemberRow[] = [
  {
    email: 'lin.ceo@example.internal',
    memberId: 'member-001',
    name: '林執行長',
    orgUnit: 'BPM-HQ',
    position: '未綁定',
  },
  {
    email: 'chen.manager@example.internal',
    memberId: 'member-101',
    name: '陳財務主管',
    orgUnit: 'FIN-TW',
    position: '未綁定',
  },
  {
    email: 'wu.staff@example.internal',
    memberId: 'member-102',
    name: '吳財務專員',
    orgUnit: 'FIN-TW',
    position: '未綁定',
  },
];

export default function AdminUsersPage(): ReactElement {
  return (
    <AdminShell activeHref="/admin/users">
      <header className={styles.header}>
        <div>
          <Typography variant="h2" component="h1">
            會員對照
          </Typography>
          <Typography variant="body" color="text-neutral">
            會員資料由 MemberResolver 解析，系統只快取 metadata 與 member_id。
          </Typography>
        </div>
        <Button icon={SearchIcon} iconType="leading" variant="base-secondary">
          查詢 member_id
        </Button>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <Typography variant="h3" component="h2">
              Local mock resolver
            </Typography>
            <Typography variant="body" color="text-neutral">
              M1 W1 開發用名單，之後可替換成外部 SSO / HR resolver。
            </Typography>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Member ID</th>
              <th>姓名</th>
              <th>Email</th>
              <th>主要組織</th>
              <th>職位</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.memberId}>
                <td className={styles.code}>{member.memberId}</td>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.orgUnit}</td>
                <td>{member.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
