'use client';

import { ReactElement } from 'react';
import Image from 'next/image';
import {
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
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import styles from './app-navigation.module.scss';
import { useAuth } from './auth-provider';
import { logoutApi } from './_lib/api-auth-client';
import { useNotificationDrawer } from './notification-drawer-provider';
import { useNotificationUnread } from './notification-unread-provider';

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

const navigationGroups: readonly NavigationGroup[] = [
  {
    title: '我的工作',
    items: [
      { href: '/dashboard', icon: HomeIcon, label: '工作台' },
      { href: '/inbox', icon: MailUnreadIcon, label: '我的待簽' },
      { href: '/sent', icon: MailIcon, label: '我發起的' },
      { href: '/cc', icon: ShareIcon, label: '抄送給我' },
    ],
  },
  {
    title: '查詢與代理',
    items: [
      { href: '/search', icon: SearchIcon, label: '案件搜尋' },
      { href: '/delegations', icon: SwitchHorizontalIcon, label: '我的代理' },
    ],
  },
  {
    title: '簽核設計',
    items: [
      {
        href: '/templates',
        icon: FolderIcon,
        label: '簽核模板',
        requiresAdmin: true,
      },
      {
        href: '/templates/categories',
        icon: ListIcon,
        label: '模板分類',
        requiresAdmin: true,
      },
      {
        href: '/forms',
        icon: FileIcon,
        label: '表單設計',
        requiresAdmin: true,
      },
    ],
  },
  {
    title: '系統管理',
    items: [
      {
        href: '/admin/orgs',
        icon: SystemIcon,
        label: '組織管理',
        requiresAdmin: true,
      },
      {
        href: '/admin/users',
        icon: UserIcon,
        label: '會員對照',
        requiresAdmin: true,
      },
      {
        href: '/admin/delegations',
        icon: ShareIcon,
        label: '代理設定',
        requiresAdmin: true,
      },
    ],
  },
];

export function renderAppNavigation(activeHref: string): ReactElement {
  const { member } = useAuth();
  const { unreadCount } = useNotificationUnread();
  const isAdmin = isAdminMember(member);
  const visibleGroups = navigationGroups
    .map((group) => ({
      title: group.title,
      items: group.items.filter((item) => !item.requiresAdmin || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  const children = [
    <NavigationHeader key="header" title="BPM Admin">
      <Image
        alt=""
        className={styles.logo}
        height={24}
        priority
        src="/rytass-logo.png"
        width={24}
      />
    </NavigationHeader>,
    ...visibleGroups.map((group) => (
      <NavigationOptionCategory key={group.title} title={group.title}>
        {group.items.map((item) => (
          <NavigationOption
            active={item.href === activeHref}
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
          {
            id: 'notification-settings',
            name: '通知設定',
          },
          {
            id: 'logout',
            name: '登出',
          },
        ]}
        onSelect={(option): void => {
          if (option.id === 'notification-settings') {
            window.location.assign('/settings/notifications');

            return;
          }

          if (option.id === 'logout') {
            void logoutAndRedirect();
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
          void logoutAndRedirect();
        }}
        title="登出"
        type="button"
      />
    </NavigationFooter>,
  ];

  return <Navigation exactActivatedMatch>{children}</Navigation>;
}

function isAdminMember(member: ReturnType<typeof useAuth>['member']): boolean {
  if (!member) {
    return false;
  }

  return (
    (member.roles ?? []).includes('BPM_ADMIN') ||
    (member.permissions ?? []).some((permission) =>
      ['bpm:*', 'bpm:admin', 'bpm.admin', 'bpm:admin:*'].includes(permission),
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
        aria-label={
          unreadCount > 0 ? `通知中心，${unreadCount} 則未讀` : '通知中心'
        }
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

  if (!member) {
    return null;
  }

  return <>{member.name}</>;
}

async function logoutAndRedirect(): Promise<void> {
  await logoutApi();
  window.location.assign('/login');
}
