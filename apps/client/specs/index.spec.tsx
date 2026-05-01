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

  function ContentHeader({
    children,
    description,
    title,
  }: {
    readonly children?: React.ReactNode;
    readonly description?: string;
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('header', null, title, description, children);
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
    ContentHeader,
    Layout,
    Navigation,
    NavigationHeader,
    NavigationOption,
    NavigationOptionCategory,
    PageHeader,
    QuickActionCard,
    Section,
    SectionGroup,
    Table,
    Typography,
  };
});

jest.mock('@mezzanine-ui/react/ContentHeader', () => {
  const React = require('react') as typeof import('react');

  return function ContentHeader({
    children,
    description,
    title,
  }: {
    readonly children?: React.ReactNode;
    readonly description?: string;
    readonly title: string;
  }): React.ReactElement {
    return React.createElement('header', null, title, description, children);
  };
});

jest.mock('@mezzanine-ui/icons', () => ({
  CalendarTimeIcon: { name: 'calendar-time' },
  FileIcon: { name: 'file' },
  FolderIcon: { name: 'folder' },
  HomeIcon: { name: 'home' },
  PlusIcon: { name: 'plus' },
  SettingIcon: { name: 'setting' },
  SystemIcon: { name: 'system' },
  UserIcon: { name: 'user' },
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { getByText } = render(<Page />);

    expect(
      getByText((content) => content.includes('BPM Project M0')),
    ).toBeTruthy();
  });
});
