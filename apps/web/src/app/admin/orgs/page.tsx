'use client';

import { ReactElement } from 'react';
import { Button, Typography } from '@mezzanine-ui/react';
import { PlusIcon } from '@mezzanine-ui/icons';
import { AdminShell } from '../admin-shell';
import styles from '../admin.module.scss';

interface OrgUnitRow {
  readonly code: string;
  readonly manager: string;
  readonly name: string;
  readonly path: string;
  readonly type: string;
}

const orgUnits: readonly OrgUnitRow[] = [
  {
    code: 'BPM-HQ',
    manager: 'member-001',
    name: '總管理處',
    path: 'org.n_root',
    type: 'company',
  },
  {
    code: 'FIN-TW',
    manager: 'member-101',
    name: '財務部',
    path: 'org.n_root.n_fin',
    type: 'department',
  },
];

export default function AdminOrgsPage(): ReactElement {
  return (
    <AdminShell activeHref="/admin/orgs">
      <header className={styles.header}>
        <div>
          <Typography variant="h2" component="h1">
            組織管理
          </Typography>
          <Typography variant="body" color="text-neutral">
            M1 W1 基礎版：對齊 org_units、positions、memberships 與主管解析。
          </Typography>
        </div>
        <Button icon={PlusIcon} iconType="leading" variant="base-primary">
          新增組織
        </Button>
      </header>

      <section className={styles.summaryGrid} aria-label="組織摘要">
        {[
          { label: '組織節點', value: '2' },
          { label: '職位', value: '0' },
          { label: '主管規則', value: '2' },
        ].map((item) => (
          <article className={styles.summaryCard} key={item.label}>
            <Typography variant="caption" color="text-neutral">
              {item.label}
            </Typography>
            <Typography variant="h3" component="p">
              {item.value}
            </Typography>
          </article>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <Typography variant="h3" component="h2">
              組織樹
            </Typography>
            <Typography variant="body" color="text-neutral">
              後端 GraphQL CRUD 已提供，前端下一步接入查詢與表單。
            </Typography>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>代碼</th>
              <th>名稱</th>
              <th>類型</th>
              <th>Path</th>
              <th>簽核主管</th>
            </tr>
          </thead>
          <tbody>
            {orgUnits.map((orgUnit) => (
              <tr key={orgUnit.code}>
                <td className={styles.code}>{orgUnit.code}</td>
                <td>{orgUnit.name}</td>
                <td>{orgUnit.type}</td>
                <td className={styles.code}>{orgUnit.path}</td>
                <td className={styles.code}>{orgUnit.manager}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
