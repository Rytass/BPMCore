'use client';

import type { ReactElement, ReactNode } from 'react';
import {
  Layout,
  Navigation,
  NavigationFooter,
  NavigationHeader,
  NavigationIconButton,
  NavigationOption,
  NavigationOptionCategory,
  NavigationUserMenu,
} from '@mezzanine-ui/react';
import {
  FolderIcon,
  HomeIcon,
  ListIcon,
  LogoutIcon,
  MailIcon,
  MailUnreadIcon,
  SearchIcon,
  ShareIcon,
  SystemIcon,
  SwitchHorizontalIcon,
  UserIcon,
  type IconDefinition,
} from '@mezzanine-ui/icons';
import {
  BPMNotificationBellButton,
  useBPMMember,
  useBPMLogout,
  useBPMRoutes,
  useRouterAdapter,
  type BPMRoutes,
} from '@rytass/bpm-core-react';
import styles from './host-layout.module.scss';

interface NavigationItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
  readonly requiresAdmin?: boolean;
}

interface NavigationGroup {
  readonly title: string;
  readonly items: readonly NavigationItem[];
}

function createNavigationGroups(routes: BPMRoutes): readonly NavigationGroup[] {
  return [
    {
      title: '我的工作',
      items: [
        { href: routes.dashboard(), icon: HomeIcon, label: '工作台' },
        { href: routes.inbox(), icon: MailUnreadIcon, label: '我的待簽' },
        { href: routes.sent(), icon: MailIcon, label: '我發起的' },
        { href: routes.cc(), icon: ShareIcon, label: '抄送給我' },
      ],
    },
    {
      title: '查詢與代理',
      items: [
        { href: routes.search(), icon: SearchIcon, label: '搜尋' },
        { href: routes.delegations(), icon: SwitchHorizontalIcon, label: '個人代理' },
      ],
    },
    {
      title: '簽核設計',
      items: [
        { href: routes.templates(), icon: FolderIcon, label: '簽核模板', requiresAdmin: true },
        { href: routes.templateCategories(), icon: ListIcon, label: '模板分類', requiresAdmin: true },
      ],
    },
    {
      title: '系統管理',
      items: [
        { href: routes.adminOrgs(), icon: SystemIcon, label: '組織管理', requiresAdmin: true },
        { href: routes.adminUsers(), icon: UserIcon, label: '會員對照', requiresAdmin: true },
        { href: routes.adminDelegations(), icon: ShareIcon, label: '代理設定', requiresAdmin: true },
      ],
    },
  ];
}

export interface HostLayoutProps {
  readonly children?: ReactNode;
}

/**
 * Reference host layout for embedding BPMCore views. Demonstrates the
 * recommended integration shape — host owns the `<Layout>` / `<Navigation>`
 * shell and composes BPM-provided widgets (`<BPMNotificationBellButton />`,
 * `useBPMLogout`, `useBPMMember`) into its own chrome. The nav mirrors the
 * structure BPM used to ship with internally; consumers are free to remap
 * or omit groups.
 */
export function HostLayout({ children }: HostLayoutProps): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const member = useBPMMember();
  const logout = useBPMLogout();
  const isAdmin = isAdminMember(member);
  const groups = createNavigationGroups(routes);
  const visibleGroups = groups
    .map((group) => ({
      title: group.title,
      items: group.items.filter((item) => !item.requiresAdmin || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  const navigationChildren = [
    <NavigationHeader key="header" title="BPM Admin">
      <img
        alt=""
        className={styles.logo}
        height={24}
        src="/rytass-logo.png"
        width={24}
      />
    </NavigationHeader>,
    ...visibleGroups.map((group) => (
      <NavigationOptionCategory key={group.title} title={group.title}>
        {group.items.map((item) => (
          <NavigationOption
            active={item.href === router.pathname}
            href={item.href}
            icon={item.icon}
            key={item.href}
            title={item.label}
          />
        ))}
      </NavigationOptionCategory>
    )),
    <NavigationFooter key="footer">
      <NavigationUserMenu
        options={[
          { id: 'notification-settings', name: '通知設定' },
        ]}
        onSelect={(option): void => {
          if (option.id === 'notification-settings') {
            router.push(routes.notificationSettings());
          }
        }}
      >
        {member?.name ?? ''}
      </NavigationUserMenu>
      <BPMNotificationBellButton />
      <NavigationIconButton
        aria-label="登出"
        icon={LogoutIcon}
        onClick={(): void => {
          void logout();
        }}
        title="登出"
        type="button"
      />
    </NavigationFooter>,
  ];

  return (
    <Layout>
      <Navigation exactActivatedMatch>{navigationChildren}</Navigation>
      <Layout.Main>{children}</Layout.Main>
    </Layout>
  );
}

function isAdminMember(
  member: ReturnType<typeof useBPMMember>,
): boolean {
  if (!member) return false;
  return (
    (member.roles ?? []).includes('BPM_ADMIN') ||
    (member.permissions ?? []).some((p) =>
      ['bpm:*', 'bpm:admin', 'bpm.admin', 'bpm:admin:*'].includes(p),
    )
  );
}
