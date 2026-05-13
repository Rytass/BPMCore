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
  MailUnreadIcon,
  NotificationUnreadIcon,
  ShareIcon,
  SystemIcon,
  UserIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import styles from './app-navigation.module.scss';
import { useAuth } from './auth-provider';
import { logoutApi } from './_lib/api-auth-client';

interface NavigationItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
}

const mainItems: readonly NavigationItem[] = [
  { href: '/', icon: HomeIcon, label: '工作台' },
  { href: '/inbox', icon: MailUnreadIcon, label: '我的待簽' },
  { href: '/notifications', icon: NotificationUnreadIcon, label: '通知中心' },
  { href: '/templates', icon: FolderIcon, label: '簽核模板' },
  { href: '/templates/categories', icon: ListIcon, label: '模板分類' },
  { href: '/forms', icon: FileIcon, label: '表單設計' },
  { href: '/admin/orgs', icon: SystemIcon, label: '組織管理' },
  { href: '/admin/users', icon: UserIcon, label: '會員對照' },
  { href: '/admin/delegations', icon: ShareIcon, label: '代理設定' },
];

export function renderAppNavigation(activeHref: string): ReactElement {
  return (
    <Navigation exactActivatedMatch>
      <NavigationHeader title="BPM Admin">
        <Image
          alt=""
          className={styles.logo}
          height={24}
          priority
          src="/rytass-logo.png"
          width={24}
        />
      </NavigationHeader>
      <NavigationOptionCategory title="Approval Engine">
        {mainItems.map((item) => (
          <NavigationOption
            active={item.href === activeHref}
            href={item.href}
            icon={item.icon}
            key={item.href}
            title={item.label}
          />
        ))}
      </NavigationOptionCategory>
      <NavigationFooter>
        <NavigationUserMenu
          options={[
            {
              id: 'logout',
              name: '登出',
            },
          ]}
          onSelect={(option): void => {
            if (option.id === 'logout') {
              void logoutAndRedirect();
            }
          }}
        >
          <NavigationMemberName />
        </NavigationUserMenu>
        <NavigationIconButton
          aria-label="登出"
          icon={LogoutIcon}
          onClick={(): void => {
            void logoutAndRedirect();
          }}
          title="登出"
          type="button"
        />
      </NavigationFooter>
    </Navigation>
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
