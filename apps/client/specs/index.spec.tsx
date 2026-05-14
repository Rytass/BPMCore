import { render } from '@testing-library/react';
import Page from '../src/app/page';

jest.mock('@mezzanine-ui/react', () => {
  const React = require('react') as typeof import('react');

  function Button({
    children,
    component,
    href,
  }: {
    readonly children?: React.ReactNode;
    readonly component?: React.ElementType;
    readonly href?: string;
  }): React.ReactElement {
    return React.createElement(component ?? 'button', { href }, children);
  }

  function BaseCard({
    children,
    description,
    title,
  }: {
    readonly children?: React.ReactNode;
    readonly description?: string;
    readonly title?: string;
  }): React.ReactElement {
    return React.createElement('article', null, title, description, children);
  }

  function CardGroup({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('section', null, children);
  }

  function Layout({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('div', null, children);
  }

  Layout.Main = function LayoutMain({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('main', null, children);
  };

  function Navigation({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('nav', null, children);
  }

  function NavigationHeader({
    children,
    title,
  }: {
    readonly children?: React.ReactNode;
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('header', null, title, children);
  }

  function NavigationOption({
    title,
  }: {
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('a', null, title);
  }

  function NavigationOptionCategory({
    children,
    title,
  }: {
    readonly children?: React.ReactNode;
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('section', null, title, children);
  }

  function NavigationFooter({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('footer', null, children);
  }

  function PageHeader({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('header', null, children);
  }

  function QuickActionCard({
    subtitle,
    title,
  }: {
    readonly subtitle?: string;
    readonly title?: string;
  }): React.ReactElement {
    return React.createElement('article', null, title, subtitle);
  }

  function NavigationIconButton({
    title,
  }: {
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('button', null, title);
  }

  function NavigationUserMenu({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('div', null, children);
  }

  function Section({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('section', null, children);
  }

  function SectionGroup({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('main', null, children);
  }

  function Table(): React.ReactElement {
    return React.createElement('table');
  }

  function Typography({
    children,
    component,
  }: {
    readonly children?: React.ReactNode;
    readonly component?: React.ElementType;
  }): React.ReactElement {
    return React.createElement(component ?? 'p', null, children);
  }

  return {
    BaseCard,
    Button,
    CardGroup,
    Layout,
    Navigation,
    NavigationFooter,
    NavigationHeader,
    NavigationIconButton,
    NavigationOption,
    NavigationOptionCategory,
    NavigationUserMenu,
    PageHeader,
    QuickActionCard,
    Section,
    SectionGroup,
    Table,
    Typography,
  };
});

jest.mock('@mezzanine-ui/icons', () => ({
  CalendarTimeIcon: { name: 'calendar-time' },
  ChevronLeftIcon: { name: 'chevron-left' },
  FileIcon: { name: 'file' },
  FolderIcon: { name: 'folder' },
  HomeIcon: { name: 'home' },
  ListIcon: { name: 'list' },
  LogoutIcon: { name: 'logout' },
  MailUnreadIcon: { name: 'mail-unread' },
  NotificationUnreadIcon: { name: 'notification-unread' },
  PlusIcon: { name: 'plus' },
  SettingIcon: { name: 'setting' },
  ShareIcon: { name: 'share' },
  SystemIcon: { name: 'system' },
  UserIcon: { name: 'user' },
}));

jest.mock('../src/app/auth-provider', () => ({
  useAuth: (): Readonly<{ member: { readonly name: string } }> => ({
    member: { name: '測試使用者' },
  }),
}));

jest.mock('../src/app/_lib/api-auth-client', () => ({
  logoutApi: jest.fn((): Promise<void> => Promise.resolve()),
}));

jest.mock('next/navigation', () => ({
  useRouter: (): Readonly<{ push: jest.Mock<void, [string]> }> => ({
    push: jest.fn(),
  }),
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { getByText } = render(<Page />);

    expect(getByText((content) => content.includes('發起簽核'))).toBeTruthy();
  });
});
