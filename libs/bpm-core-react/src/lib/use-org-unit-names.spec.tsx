import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  resolveOrgUnitOptions,
  type OrgUnitOptionRecord,
} from '@rytass/bpm-core-client/organization';
import { useOrgUnitNames } from './use-org-unit-names';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@rytass/bpm-core-client/organization', () => ({
  resolveOrgUnitOptions: jest.fn(),
}));

const resolveMock = resolveOrgUnitOptions as jest.MockedFunction<
  typeof resolveOrgUnitOptions
>;

const FINANCE: OrgUnitOptionRecord = {
  code: 'FIN',
  deleted: false,
  id: 'u1',
  name: '財務部',
};
const RETIRED: OrgUnitOptionRecord = {
  code: 'OLD',
  deleted: true,
  id: 'u3',
  name: '舊部門',
};

let latestNames: ReadonlyMap<string, string> = new Map();

function Probe({ ids }: { readonly ids: readonly string[] }): ReactElement {
  latestNames = useOrgUnitNames(ids);

  return <div />;
}

interface Harness {
  readonly container: HTMLElement;
  readonly render: (ids: readonly string[]) => Promise<void>;
  readonly root: Root;
}

async function mount(ids: readonly string[]): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (nextIds: readonly string[]): Promise<void> => {
    await act(async (): Promise<void> => {
      root.render(<Probe ids={nextIds} />);
    });
  };

  await render(ids);

  return { container, render, root };
}

async function unmount(harness: Harness): Promise<void> {
  await act(async (): Promise<void> => {
    harness.root.unmount();
  });
  harness.container.remove();
}

describe('useOrgUnitNames', () => {
  beforeEach((): void => {
    latestNames = new Map();
    resolveMock.mockReset();
  });

  it('names the units, marking a deleted one', async (): Promise<void> => {
    resolveMock.mockResolvedValue([FINANCE, RETIRED]);
    const harness = await mount(['u1', 'u3']);

    try {
      expect(resolveMock).toHaveBeenCalledWith(['u1', 'u3']);
      expect([...latestNames]).toEqual([
        ['u1', '財務部'],
        ['u3', '舊部門（已刪除）'],
      ]);
    } finally {
      await unmount(harness);
    }
  });

  it('shows the id until the names come back', async (): Promise<void> => {
    let finish: (records: readonly OrgUnitOptionRecord[]) => void = () =>
      undefined;

    resolveMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const harness = await mount(['u1']);

    try {
      expect([...latestNames]).toEqual([['u1', 'u1']]);

      await act(async (): Promise<void> => {
        finish([FINANCE]);
      });

      expect([...latestNames]).toEqual([['u1', '財務部']]);
    } finally {
      await unmount(harness);
    }
  });

  it('leaves an id the server does not know out of the map, and does not ask again', async (): Promise<void> => {
    resolveMock.mockResolvedValue([]);
    const harness = await mount(['u9']);

    try {
      expect(latestNames.has('u9')).toBe(false);
      expect(resolveMock).toHaveBeenCalledTimes(1);

      await harness.render(['u9']);

      expect(resolveMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(harness);
    }
  });

  it('leaves the ids out when the lookup fails, and does not ask again', async (): Promise<void> => {
    resolveMock.mockRejectedValue(new Error('server down'));
    const harness = await mount(['u1']);

    try {
      expect(latestNames.has('u1')).toBe(false);
      expect(resolveMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(harness);
    }
  });

  it('asks only for ids it has not settled yet', async (): Promise<void> => {
    resolveMock.mockResolvedValue([FINANCE]);
    const harness = await mount(['u1']);

    try {
      resolveMock.mockResolvedValue([RETIRED]);
      await harness.render(['u1', 'u3']);

      expect(resolveMock).toHaveBeenLastCalledWith(['u3']);
      expect([...latestNames]).toEqual([
        ['u1', '財務部'],
        ['u3', '舊部門（已刪除）'],
      ]);
    } finally {
      await unmount(harness);
    }
  });

  it('makes no request without ids', async (): Promise<void> => {
    const harness = await mount([]);

    try {
      expect(resolveMock).not.toHaveBeenCalled();
      expect(latestNames.size).toBe(0);
    } finally {
      await unmount(harness);
    }
  });
});
