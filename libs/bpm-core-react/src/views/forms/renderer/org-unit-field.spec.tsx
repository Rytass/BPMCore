import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  resolveOrgUnitOptions,
  searchOrgUnitOptions,
  type OrgUnitOptionRecord,
} from '@rytass/bpm-core-client/organization';
import { OrgUnitFieldControl } from './org-unit-field';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MockAutoCompleteProps {
  readonly disabled?: boolean;
  readonly emptyText?: string;
  readonly loading?: boolean;
  readonly loadingText?: string;
  readonly mode: 'multiple' | 'single';
  readonly onChange: (value: unknown) => void;
  readonly onSearch: (text: string) => void;
  readonly onVisibilityChange?: (open: boolean) => void;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly readOnly?: boolean;
  readonly value: unknown;
}

let latestProps: MockAutoCompleteProps | null = null;

jest.mock('@mezzanine-ui/react', () => ({
  AutoComplete: (props: MockAutoCompleteProps): ReactElement => {
    latestProps = props;

    return <div data-mock-autocomplete={props.mode} />;
  },
  Typography: (props: {
    readonly children?: React.ReactNode;
  }): ReactElement => <span data-mock-error="">{props.children}</span>,
}));

jest.mock('@rytass/bpm-core-client/organization', () => ({
  resolveOrgUnitOptions: jest.fn(),
  searchOrgUnitOptions: jest.fn(),
}));

const resolveMock = resolveOrgUnitOptions as jest.MockedFunction<
  typeof resolveOrgUnitOptions
>;
const searchMock = searchOrgUnitOptions as jest.MockedFunction<
  typeof searchOrgUnitOptions
>;

const FINANCE: OrgUnitOptionRecord = {
  code: 'FIN',
  deleted: false,
  id: 'u1',
  name: '財務部',
};
const SALES: OrgUnitOptionRecord = {
  code: 'SAL',
  deleted: false,
  id: 'u2',
  name: '業務部',
};
const RETIRED: OrgUnitOptionRecord = {
  code: 'OLD',
  deleted: true,
  id: 'u3',
  name: '舊部門',
};

interface Harness {
  readonly container: HTMLElement;
  readonly onChange: jest.Mock;
  readonly root: Root;
}

async function mount(
  props: Partial<Parameters<typeof OrgUnitFieldControl>[0]> = {},
): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onChange = jest.fn();

  await act(async (): Promise<void> => {
    root.render(
      <OrgUnitFieldControl
        name="department"
        onChange={onChange}
        readonly={false}
        value={undefined}
        {...props}
      />,
    );
  });

  return { container, onChange, root };
}

async function unmount(harness: Harness): Promise<void> {
  await act(async (): Promise<void> => {
    harness.root.unmount();
  });
  harness.container.remove();
}

function readProps(): MockAutoCompleteProps {
  if (!latestProps) {
    throw new Error('AutoComplete was not rendered.');
  }

  return latestProps;
}

function readErrorText(container: HTMLElement): string | null {
  return container.querySelector('[data-mock-error]')?.textContent ?? null;
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  const handlers: {
    reject: (reason: unknown) => void;
    resolve: (value: T) => void;
  } = { reject: () => undefined, resolve: () => undefined };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });

  return { promise, ...handlers };
}

describe('OrgUnitFieldControl', () => {
  beforeEach((): void => {
    latestProps = null;
    resolveMock.mockReset();
    searchMock.mockReset();
  });

  it('resolves a stored id to its name so a read-only view shows the unit, not the id', async (): Promise<void> => {
    resolveMock.mockResolvedValue([FINANCE]);
    const harness = await mount({ readonly: true, value: 'u1' });

    try {
      expect(resolveMock).toHaveBeenCalledWith(['u1']);
      expect(readProps().value).toEqual({ id: 'u1', name: '財務部' });
      expect(readProps().readOnly).toBe(true);
      expect(readProps().disabled).toBe(true);
      expect(readProps().mode).toBe('single');
    } finally {
      await unmount(harness);
    }
  });

  it('shows the id while the name is on its way, then swaps in the name', async (): Promise<void> => {
    const pending = createDeferred<readonly OrgUnitOptionRecord[]>();

    resolveMock.mockReturnValue(pending.promise);
    const harness = await mount({ readonly: true, value: 'u1' });

    try {
      expect(readProps().value).toEqual({
        id: 'u1',
        name: 'u1',
        unresolved: true,
      });

      await act(async (): Promise<void> => {
        pending.resolve([FINANCE]);
      });

      expect(readProps().value).toEqual({ id: 'u1', name: '財務部' });
    } finally {
      await unmount(harness);
    }
  });

  it('shows 未知組織 for a stored id the server does not know, and asks once', async (): Promise<void> => {
    resolveMock.mockResolvedValue([]);
    const harness = await mount({ readonly: true, value: 'u9' });

    try {
      expect(readProps().value).toEqual({
        id: 'u9',
        name: '未知組織',
        unresolved: true,
      });
      expect(resolveMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(harness);
    }
  });

  it('shows 未知組織 when the lookup itself fails, and does not ask again', async (): Promise<void> => {
    resolveMock.mockRejectedValue(new Error('server down'));
    const harness = await mount({ value: 'u9' });

    try {
      expect(readProps().value).toEqual({
        id: 'u9',
        name: '未知組織',
        unresolved: true,
      });
      expect(resolveMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(harness);
    }
  });

  it('marks a deleted unit as 已刪除 after its name', async (): Promise<void> => {
    resolveMock.mockResolvedValue([RETIRED]);
    const harness = await mount({ readonly: true, value: 'u3' });

    try {
      expect(readProps().value).toEqual({
        id: 'u3',
        name: '舊部門（已刪除）',
      });
    } finally {
      await unmount(harness);
    }
  });

  it('does not call the server when nothing is stored', async (): Promise<void> => {
    const harness = await mount({ value: undefined });

    try {
      expect(resolveMock).not.toHaveBeenCalled();
      expect(readProps().value).toBeNull();
    } finally {
      await unmount(harness);
    }
  });

  it('stores the picked unit id and clears to undefined', async (): Promise<void> => {
    const harness = await mount();

    try {
      act((): void => {
        readProps().onChange({ id: 'u2', name: '業務部' });
      });
      expect(harness.onChange).toHaveBeenLastCalledWith('u2');

      act((): void => {
        readProps().onChange(null);
      });
      expect(harness.onChange).toHaveBeenLastCalledWith(undefined);
    } finally {
      await unmount(harness);
    }
  });

  it('searches the units, offers the hits as options and shows nothing as failed', async (): Promise<void> => {
    searchMock.mockResolvedValue([FINANCE, SALES]);
    const harness = await mount();

    try {
      await act(async (): Promise<void> => {
        readProps().onSearch('部');
      });

      expect(searchMock).toHaveBeenCalledWith('部');
      expect(readProps().options).toEqual([
        { id: 'u1', name: '財務部' },
        { id: 'u2', name: '業務部' },
      ]);
      expect(readProps().loading).toBe(false);
      expect(readErrorText(harness.container)).toBeNull();
    } finally {
      await unmount(harness);
    }
  });

  it('lists the first units when the dropdown opens', async (): Promise<void> => {
    searchMock.mockResolvedValue([FINANCE]);
    const harness = await mount();

    try {
      await act(async (): Promise<void> => {
        readProps().onVisibilityChange?.(true);
      });

      expect(searchMock).toHaveBeenCalledWith('');
      expect(readProps().options).toEqual([{ id: 'u1', name: '財務部' }]);
    } finally {
      await unmount(harness);
    }
  });

  it('shows the searching state while a search is in flight', async (): Promise<void> => {
    const pending = createDeferred<readonly OrgUnitOptionRecord[]>();

    searchMock.mockReturnValue(pending.promise);
    const harness = await mount();

    try {
      act((): void => {
        readProps().onSearch('部');
      });

      expect(readProps().loading).toBe(true);
      expect(readProps().loadingText).toBe('搜尋組織中...');

      await act(async (): Promise<void> => {
        pending.resolve([]);
      });

      expect(readProps().loading).toBe(false);
    } finally {
      await unmount(harness);
    }
  });

  it('tells the filler nothing matched', async (): Promise<void> => {
    searchMock.mockResolvedValue([]);
    const harness = await mount();

    try {
      await act(async (): Promise<void> => {
        readProps().onSearch('不存在');
      });

      expect(readProps().options).toEqual([]);
      expect(readProps().emptyText).toBe('沒有符合的組織');
      expect(readErrorText(harness.container)).toBeNull();
    } finally {
      await unmount(harness);
    }
  });

  it('reports a failed search without dropping the picked unit', async (): Promise<void> => {
    resolveMock.mockResolvedValue([FINANCE]);
    searchMock.mockRejectedValue(new Error('server down'));
    const harness = await mount({ value: 'u1' });

    try {
      await act(async (): Promise<void> => {
        readProps().onSearch('部');
      });

      expect(readErrorText(harness.container)).toBe(
        '搜尋組織失敗，請稍後再試。',
      );
      expect(readProps().value).toEqual({ id: 'u1', name: '財務部' });
      expect(harness.onChange).not.toHaveBeenCalled();
      expect(readProps().loading).toBe(false);

      // The next search that works takes the message away.
      searchMock.mockResolvedValue([SALES]);
      await act(async (): Promise<void> => {
        readProps().onSearch('業');
      });

      expect(readErrorText(harness.container)).toBeNull();
      expect(readProps().value).toEqual({ id: 'u1', name: '財務部' });
    } finally {
      await unmount(harness);
    }
  });

  it('keeps the picked unit among the options so it can be un-ticked', async (): Promise<void> => {
    resolveMock.mockResolvedValue([FINANCE]);
    searchMock.mockResolvedValue([SALES]);
    const harness = await mount({ value: 'u1' });

    try {
      await act(async (): Promise<void> => {
        readProps().onSearch('業');
      });

      expect(readProps().options).toEqual([
        { id: 'u1', name: '財務部' },
        { id: 'u2', name: '業務部' },
      ]);
    } finally {
      await unmount(harness);
    }
  });

  it('ignores the answer of a search that a newer one replaced', async (): Promise<void> => {
    const first = createDeferred<readonly OrgUnitOptionRecord[]>();
    const second = createDeferred<readonly OrgUnitOptionRecord[]>();

    searchMock.mockReturnValueOnce(first.promise);
    searchMock.mockReturnValueOnce(second.promise);
    const harness = await mount();

    try {
      act((): void => {
        readProps().onSearch('財');
      });
      act((): void => {
        readProps().onSearch('業');
      });

      await act(async (): Promise<void> => {
        second.resolve([SALES]);
      });
      await act(async (): Promise<void> => {
        first.resolve([FINANCE]);
      });

      expect(readProps().options).toEqual([{ id: 'u2', name: '業務部' }]);
    } finally {
      await unmount(harness);
    }
  });
});
