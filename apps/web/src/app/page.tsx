'use client';

import { ReactElement } from 'react';
import { Button, Icon, Typography } from '@mezzanine-ui/react';
import {
  CalendarTimeIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  PlusIcon,
  SettingIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import styles from './page.module.scss';

interface NavItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
}

interface Metric {
  readonly label: string;
  readonly value: string;
}

const navItems: readonly NavItem[] = [
  { href: '/', icon: HomeIcon, label: '工作台' },
  { href: '/templates', icon: FolderIcon, label: '簽核模板' },
  { href: '/forms', icon: FileIcon, label: '表單設計' },
  { href: '/admin/orgs', icon: SettingIcon, label: '系統管理' },
];

const metrics: readonly Metric[] = [
  { label: '今日待簽', value: '0' },
  { label: '進行中流程', value: '0' },
  { label: '模板版本', value: 'M0' },
];

export default function Page(): ReactElement {
  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="主導覽">
        <div className={styles.brand}>
          <div className={styles.brandMark}>B</div>
          <div>
            <Typography variant="body-highlight" component="p">
              BPM Admin
            </Typography>
            <Typography variant="caption" color="text-neutral">
              Approval Engine
            </Typography>
          </div>
        </div>

        <nav className={styles.navList}>
          {navItems.map((item) => (
            <a className={styles.navItem} href={item.href} key={item.href}>
              <Icon className={styles.navIcon} icon={item.icon} size={18} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className={styles.content}>
        <header className={styles.header}>
          <div>
            <Typography variant="h2" component="h1">
              BPM Project M0
            </Typography>
            <Typography variant="body" color="text-neutral">
              本機開發骨架已對齊 NestJS、Next.js、GraphQL、TypeORM 與 Mezzanine
              UI。
            </Typography>
          </div>
          <Button icon={PlusIcon} iconType="leading" variant="base-primary">
            建立模板
          </Button>
        </header>

        <section className={styles.metricGrid} aria-label="系統摘要">
          {metrics.map((metric) => (
            <article className={styles.metricCard} key={metric.label}>
              <Typography variant="caption" color="text-neutral">
                {metric.label}
              </Typography>
              <Typography variant="h3" component="p">
                {metric.value}
              </Typography>
            </article>
          ))}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <Typography variant="h3" component="h2">
                M0 Workspace
              </Typography>
              <Typography variant="body" color="text-neutral">
                後續 M1 可從 Identity、Organization、Form、Template
                四個模組往下展開。
              </Typography>
            </div>
            <Icon
              className={styles.panelIcon}
              icon={CalendarTimeIcon}
              size={28}
            />
          </div>

          <div className={styles.moduleGrid}>
            {[
              'GraphQL API',
              'TypeORM Migrations',
              'Workflow Types',
              'Mezzanine Shell',
            ].map((item) => (
              <div className={styles.moduleItem} key={item}>
                {item}
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
