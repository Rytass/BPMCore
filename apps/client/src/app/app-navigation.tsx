'use client';

import { ReactElement } from 'react';
import {
  Navigation,
  NavigationHeader,
  NavigationOption,
  NavigationOptionCategory,
} from '@mezzanine-ui/react';
import {
  FileIcon,
  FolderIcon,
  HomeIcon,
  SystemIcon,
  UserIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';

interface NavigationItem {
  readonly href: string;
  readonly icon: IconDefinition;
  readonly label: string;
}

const mainItems: readonly NavigationItem[] = [
  { href: '/', icon: HomeIcon, label: '工作台' },
  { href: '/templates', icon: FolderIcon, label: '簽核模板' },
  { href: '/forms', icon: FileIcon, label: '表單設計' },
  { href: '/admin/orgs', icon: SystemIcon, label: '組織管理' },
  { href: '/admin/users', icon: UserIcon, label: '會員對照' },
];

export function renderAppNavigation(activeHref: string): ReactElement {
  return (
    <Navigation exactActivatedMatch>
      <NavigationHeader title="BPM Admin">B</NavigationHeader>
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
    </Navigation>
  );
}
