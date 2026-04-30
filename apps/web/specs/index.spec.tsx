import { render } from '@testing-library/react';
import Page from '../src/app/page';

jest.mock('@mezzanine-ui/react', () => {
  const React = require('react') as typeof import('react');

  function Button({
    children,
  }: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return React.createElement('button', null, children);
  }

  function Icon(): React.ReactElement {
    return React.createElement('span');
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

  return { Button, Icon, Typography };
});

jest.mock('@mezzanine-ui/icons', () => ({
  CalendarTimeIcon: { name: 'calendar-time' },
  FileIcon: { name: 'file' },
  FolderIcon: { name: 'folder' },
  HomeIcon: { name: 'home' },
  PlusIcon: { name: 'plus' },
  SettingIcon: { name: 'setting' },
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { getByText } = render(<Page />);

    expect(getByText('BPM Project M0')).toBeTruthy();
  });
});
