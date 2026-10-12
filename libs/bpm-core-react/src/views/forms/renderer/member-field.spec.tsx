import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolveMembers, searchMembers } from '@rytass/bpm-core-client';
import { MemberFieldControl } from './member-field';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MockAutoCompleteProps {
  readonly disabled?: boolean;
  readonly mode: 'multiple' | 'single';
  readonly onChange: (value: unknown) => void;
  readonly onSearch: (text: string) => void;
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
}));

jest.mock('@rytass/bpm-core-client', () => ({
  resolveMembers: jest.fn(),
  searchMembers: jest.fn(),
}));

const resolveMembersMock = resolveMembers as jest.MockedFunction<
  typeof resolveMembers
>;
const searchMembersMock = searchMembers as jest.MockedFunction<
  typeof searchMembers
>;

const ALICE = {
  customFieldsJson: '{}',
  email: 'alice@example.com',
  memberId: 'm1',
  name: 'Alice',
};
const BOB = {
  customFieldsJson: '{}',
  email: 'bob@example.com',
  memberId: 'm2',
  name: 'Bob',
};

async function mount(
  props: Partial<Parameters<typeof MemberFieldControl>[0]> = {},
): Promise<{
  readonly onChange: jest.Mock;
  readonly root: Root;
  readonly container: HTMLElement;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onChange = jest.fn();

  await act(async (): Promise<void> => {
    root.render(
      <MemberFieldControl
        multiple={false}
        name="reviewer"
        onChange={onChange}
        readonly={false}
        value={undefined}
        {...props}
      />,
    );
  });

  return { container, onChange, root };
}

async function unmount(harness: {
  readonly container: HTMLElement;
  readonly root: Root;
}): Promise<void> {
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

describe('MemberFieldControl', () => {
  beforeEach((): void => {
    latestProps = null;
    resolveMembersMock.mockReset();
    searchMembersMock.mockReset();
  });

  it('resolves stored ids to names so a read-only view shows people, not ids', async (): Promise<void> => {
    resolveMembersMock.mockResolvedValue([ALICE, BOB]);
    const harness = await mount({
      multiple: true,
      readonly: true,
      value: ['m1', 'm2'],
    });

    try {
      expect(resolveMembersMock).toHaveBeenCalledWith(['m1', 'm2']);
      expect(readProps().value).toEqual([
        { id: 'm1', name: 'Alice (alice@example.com)' },
        { id: 'm2', name: 'Bob (bob@example.com)' },
      ]);
      expect(readProps().readOnly).toBe(true);
      expect(readProps().disabled).toBe(true);
    } finally {
      await unmount(harness);
    }
  });

  it('keeps an unresolvable id visible as an unknown member and asks only once', async (): Promise<void> => {
    resolveMembersMock.mockRejectedValue(new Error('directory down'));
    const harness = await mount({ readonly: true, value: 'm9' });

    try {
      expect(readProps().value).toEqual({
        id: 'm9',
        name: '未知會員',
        unresolved: true,
      });
      expect(resolveMembersMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(harness);
    }
  });

  it('keeps the names the directory can give when one stored id fails the whole batch', async (): Promise<void> => {
    resolveMembersMock.mockImplementation(async (memberIds) => {
      if (memberIds.length === 1 && memberIds[0] === 'm1') {
        return [ALICE];
      }

      throw new Error('directory cannot handle m9');
    });
    const harness = await mount({
      multiple: true,
      readonly: true,
      value: ['m1', 'm9'],
    });

    try {
      expect(readProps().value).toEqual([
        { id: 'm1', name: 'Alice (alice@example.com)' },
        { id: 'm9', name: '未知會員', unresolved: true },
      ]);
      // batch + one request per id; the failing id is not retried afterwards.
      expect(resolveMembersMock).toHaveBeenCalledTimes(3);
    } finally {
      await unmount(harness);
    }
  });

  it('does not call the directory when nothing is stored', async (): Promise<void> => {
    const harness = await mount({ value: undefined });

    try {
      expect(resolveMembersMock).not.toHaveBeenCalled();
      expect(readProps().value).toBeNull();
      expect(readProps().mode).toBe('single');
    } finally {
      await unmount(harness);
    }
  });

  it('stores the picked member id for a single field and clears to undefined', async (): Promise<void> => {
    const harness = await mount();

    try {
      act((): void => {
        readProps().onChange({ id: 'm1', name: 'Alice (alice@example.com)' });
      });
      expect(harness.onChange).toHaveBeenLastCalledWith('m1');

      act((): void => {
        readProps().onChange(null);
      });
      expect(harness.onChange).toHaveBeenLastCalledWith(undefined);
    } finally {
      await unmount(harness);
    }
  });

  it('stores member ids, not options, for a multiple field', async (): Promise<void> => {
    const harness = await mount({ multiple: true });

    try {
      expect(readProps().mode).toBe('multiple');

      act((): void => {
        readProps().onChange([
          { id: 'm1', name: 'Alice (alice@example.com)' },
          { id: 'm2', name: 'Bob (bob@example.com)' },
        ]);
      });
      expect(harness.onChange).toHaveBeenLastCalledWith(['m1', 'm2']);

      act((): void => {
        readProps().onChange([]);
      });
      expect(harness.onChange).toHaveBeenLastCalledWith(undefined);
    } finally {
      await unmount(harness);
    }
  });

  it('searches the member directory and offers the hits as options', async (): Promise<void> => {
    searchMembersMock.mockResolvedValue([ALICE]);
    const harness = await mount();

    try {
      await act(async (): Promise<void> => {
        readProps().onSearch('ali');
      });

      expect(searchMembersMock).toHaveBeenCalledWith('ali');
      expect(readProps().options).toEqual([
        { id: 'm1', name: 'Alice (alice@example.com)' },
      ]);
    } finally {
      await unmount(harness);
    }
  });
});
