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
  FileIcon,
  FolderIcon,
  HomeIcon,
  ListIcon,
  LogoutIcon,
  MailIcon,
  MailUnreadIcon,
  NotificationUnreadIcon,
  SearchIcon,
  ShareIcon,
  SystemIcon,
  SwitchHorizontalIcon,
  UserIcon,
  type IconDefinition,
} from '@mezzanine-ui/icons';
import { logoutApi } from '@rytass/bpm-core-client';
import { useAuth } from '../lib/auth-provider';
import { useRouterAdapter } from '../lib/router-adapter';
import { useNotificationDrawer } from '../lib/notification-drawer-provider';
import { useNotificationUnread } from '../lib/notification-unread-provider';
import { useBPMRoutes, type BPMRoutes } from '../lib/routes-config';
import styles from './app-navigation.module.scss';

interface NavigationItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
  readonly requiresAdmin?: boolean;
}

export interface AppNavigationGroup {
  readonly title: string;
  readonly items: readonly NavigationItem[];
}

function createDefaultNavigationGroups(
  routes: BPMRoutes,
): readonly AppNavigationGroup[] {
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
        { href: routes.forms(), icon: FileIcon, label: '表單設計', requiresAdmin: true },
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

export interface AppLayoutProps {
  /** Override the active href detection (defaults to router's pathname). */
  readonly activeHref?: string;
  /** Logo image URL displayed in the sidebar header. */
  readonly logoSrc?: string;
  /** Sidebar title (defaults to "BPM Admin"). */
  readonly title?: string;
  /**
   * Override the entire navigation tree. When omitted, the default 4-group
   * BPM admin nav (`我的工作` / `查詢與代理` / `簽核設計` / `系統管理`) is used.
   */
  readonly groups?: readonly AppNavigationGroup[];
  /** Page content rendered inside the Mezzanine `<Layout.Main>` slot. */
  readonly children?: ReactNode;
}

/**
 * BPM admin layout shell — composes Mezzanine `<Layout>` + `<Navigation>`
 * with the default 4-group BPM tree, and exposes a `children` prop that
 * fills the `<Layout.Main>` slot.
 *
 * Why a single component instead of a `<Navigation>` wrapper: Mezzanine
 * `<Layout>` discovers its slot children by component-identity match
 * (`child.type === Navigation` / `LayoutMain` / etc.). Any custom wrapper
 * around `<Navigation>` is silently dropped, so the sidebar disappears.
 * Keeping the `<Navigation>` element as a direct child of `<Layout>` here
 * is mandatory for the slot to register.
 */
export function AppLayout({
  activeHref,
  logoSrc = '/rytass-logo.png',
  title = 'BPM Admin',
  groups,
  children,
}: AppLayoutProps): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const { member } = useAuth();
  const { unreadCount } = useNotificationUnread();
  const resolvedActive = activeHref ?? router.pathname ?? '';
  const isAdmin = isAdminMember(member);
  const resolvedGroups = groups ?? createDefaultNavigationGroups(routes);
  const visibleGroups = resolvedGroups
    .map((group) => ({
      title: group.title,
      items: group.items.filter((item) => !item.requiresAdmin || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  const handleLogout = async (): Promise<void> => {
    await logoutApi();
    router.replace('/login');
  };

  const navigationChildren = [
    <NavigationHeader key="header" title={title}>
      <img alt="" className={styles.logo} height={24} src={logoSrc} width={24} />
    </NavigationHeader>,
    ...visibleGroups.map((group) => (
      <NavigationOptionCategory key={group.title} title={group.title}>
        {group.items.map((item) => (
          <NavigationOption
            active={item.href === resolvedActive}
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
          { id: 'logout', name: '登出' },
        ]}
        onSelect={(option): void => {
          if (option.id === 'notification-settings') {
            router.push(routes.notificationSettings());
            return;
          }
          if (option.id === 'logout') {
            void handleLogout();
          }
        }}
      >
        <NavigationMemberName />
      </NavigationUserMenu>
      <NotificationBell unreadCount={unreadCount} />
      <NavigationIconButton
        aria-label="登出"
        icon={LogoutIcon}
        onClick={(): void => {
          void handleLogout();
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

function isAdminMember(member: ReturnType<typeof useAuth>['member']): boolean {
  if (!member) return false;
  return (
    (member.roles ?? []).includes('BPM_ADMIN') ||
    (member.permissions ?? []).some((p) =>
      ['bpm:*', 'bpm:admin', 'bpm.admin', 'bpm:admin:*'].includes(p),
    )
  );
}

function NotificationBell({
  unreadCount,
}: {
  readonly unreadCount: number;
}): ReactElement {
  const { open } = useNotificationDrawer();
  return (
    <span className={styles.notificationBell}>
      <NavigationIconButton
        aria-label={unreadCount > 0 ? `通知中心，${unreadCount} 則未讀` : '通知中心'}
        icon={NotificationUnreadIcon}
        onClick={(): void => {
          open();
        }}
        title="通知中心"
        type="button"
      />
      {unreadCount > 0 ? (
        <span className={styles.notificationBadge}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </span>
  );
}

function NavigationMemberName(): ReactElement | null {
  const { member } = useAuth();
  if (!member) return null;
  return <>{member.name}</>;
}
