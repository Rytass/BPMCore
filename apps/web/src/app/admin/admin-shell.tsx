'use client';

import { ReactElement, ReactNode } from 'react';
import { Icon, Typography } from '@mezzanine-ui/react';
import {
  FolderIcon,
  HomeIcon,
  SystemIcon,
  UserIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import styles from './admin.module.scss';

interface AdminNavItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
}

interface AdminShellProps {
  readonly activeHref: string;
  readonly children: ReactNode;
}

const navItems: readonly AdminNavItem[] = [
  { href: '/', icon: HomeIcon, label: '工作台' },
  { href: '/templates', icon: FolderIcon, label: '簽核模板' },
  { href: '/admin/orgs', icon: SystemIcon, label: '組織管理' },
  { href: '/admin/users', icon: UserIcon, label: '會員對照' },
];

export function AdminShell({
  activeHref,
  children,
}: AdminShellProps): ReactElement {
  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="管理導覽">
        <div className={styles.brand}>
          <div className={styles.brandMark}>B</div>
          <div>
            <Typography variant="body-highlight" component="p">
              BPM Admin
            </Typography>
            <Typography variant="caption" color="text-neutral">
              Identity / Organization
            </Typography>
          </div>
        </div>

        <nav className={styles.navList}>
          {navItems.map((item) => (
            <a
              className={`${styles.navItem} ${
                item.href === activeHref ? styles.navItemActive : ''
              }`}
              href={item.href}
              key={item.href}
            >
              <Icon icon={item.icon} size={18} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className={styles.content}>{children}</section>
    </main>
  );
}
