import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as memberApi from '@rytass/bpm-core-client';
import type { MemberProfileRecord } from '@rytass/bpm-core-client';
import * as organizationApi from '@rytass/bpm-core-client/organization';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { InactiveMemberWithOpenTasksRecord } from '@rytass/bpm-core-client/workflow';
import { AdminUsersView } from './AdminUsersView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldLayout: { VERTICAL: 'vertical' },
}));
jest.mock('@mezzanine-ui/core/table', () => ({}));

jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <div data-content-header="">{props.title as string}</div>
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  const Passthrough = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => <div>{props.children as ReactNode}</div>;
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly dataIndex?: string;
      readonly key: string;
    }[];
    const rows = props.dataSource as readonly Readonly<
      Record<string, unknown>
    >[];
    const actions = props.actions as
      | {
          readonly render: (record: unknown) => readonly {
            readonly name: string;
            readonly onClick: (record: unknown) => void;
          }[];
        }
      | undefined;

    return (
      <div>
        {rows.map(
          (row): ReactElement => (
            <div data-row={String(row.key)} key={String(row.key)}>
              {columns.map(
                (column): ReactElement => (
                  <span data-column={column.key} key={column.key}>
                    {String(row[column.dataIndex ?? ''] ?? '')}
                  </span>
                ),
              )}
              {(actions?.render(row) ?? []).map(
                (action): ReactElement => (
                  <button
                    key={action.name}
                    onClick={(): void => action.onClick(row)}
                    type="button"
                  >
                    {action.name}
                  </button>
                ),
              )}
            </div>
          ),
        )}
      </div>
    );
  };

  return {
    BaseCard: Passthrough,
    Filter: Passthrough,
    FilterArea: Passthrough,
    FilterLine: Passthrough,
    FormField: Passthrough,
    Input: (): ReactElement => <input />,
    Modal: (): null => null,
    PageHeader: Passthrough,
    Section: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <section>
        {props.contentHeader as ReactNode}
        {props.children as ReactNode}
      </section>
    ),
    SectionGroup: Passthrough,
    Table,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('./MemberTaskReassignModal', () => ({
  MemberTaskReassignModal: (
    props: Readonly<{
      member: MemberProfileRecord | null;
      onClose: () => void;
    }>,
  ): ReactElement | null =>
    props.member ? (
      <div data-reassign-member={props.member.memberId}>
        {props.member.name}
        <button onClick={props.onClose} type="button">
          關閉改派
        </button>
      </div>
    ) : null,
}));

jest.mock('@rytass/bpm-core-client', () => ({
  listMemberDirectoryPage: jest.fn(),
  resolveMembers: jest.fn(),
}));

jest.mock('@rytass/bpm-core-client/organization', () => ({
  listMemberships: jest.fn(),
  readOrganizationDashboard: jest.fn(),
  readResolvedManager: jest.fn(),
}));

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  listInactiveMembersWithOpenTasks: jest.fn(),
}));

const api = {
  listInactiveMembersWithOpenTasks:
    workflowApi.listInactiveMembersWithOpenTasks as jest.MockedFunction<
      typeof workflowApi.listInactiveMembersWithOpenTasks
    >,
  listMemberDirectoryPage: memberApi.listMemberDirectoryPage as jest.MockedFunction<
    typeof memberApi.listMemberDirectoryPage
  >,
  readOrganizationDashboard:
    organizationApi.readOrganizationDashboard as jest.MockedFunction<
      typeof organizationApi.readOrganizationDashboard
    >,
};

const goneMember: InactiveMemberWithOpenTasksRecord = {
  email: 'gone@example.internal',
  memberId: 'member-gone',
  name: '離職者',
  openTaskCount: 3,
};

describe('AdminUsersView deactivated members with open tasks', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api.listMemberDirectoryPage.mockResolvedValue({
      members: [
        {
          customFieldsJson: '{}',
          email: 'active@example.internal',
          memberId: 'member-active',
          name: '在職者',
        },
      ],
      totalCount: 1,
    } as Awaited<ReturnType<typeof memberApi.listMemberDirectoryPage>>);
    api.readOrganizationDashboard.mockResolvedValue({
      orgUnits: [],
      positions: [],
    } as unknown as Awaited<
      ReturnType<typeof organizationApi.readOrganizationDashboard>
    >);
    api.listInactiveMembersWithOpenTasks.mockResolvedValue([goneMember]);
  });

  afterEach((): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  async function renderView(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<AdminUsersView />);
    });
  }

  const inactiveSection = (): Element | null =>
    container.querySelector('[data-inactive-members]');

  async function click(button: HTMLButtonElement | undefined): Promise<void> {
    await act(async (): Promise<void> => {
      button?.click();
    });
  }

  const findButton = (
    scope: Element | null,
    text: string,
  ): HTMLButtonElement | undefined =>
    [...(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button): boolean => button.textContent === text,
    );

  it('lists each deactivated member with their open-task count', async (): Promise<void> => {
    await renderView();

    expect(container.textContent).toContain('已停用、仍有待簽的會員');
    expect(
      inactiveSection()?.querySelector(
        '[data-row="member-gone"] [data-column="openTaskCount"]',
      )?.textContent,
    ).toBe('3');
    expect(
      inactiveSection()?.querySelector('[data-row="member-active"]'),
    ).toBeNull();
  });

  it('opens the reassignment for that member and reloads the list when it closes', async (): Promise<void> => {
    await renderView();
    await click(findButton(inactiveSection(), '改派待辦'));

    expect(
      container.querySelector('[data-reassign-member="member-gone"]')
        ?.textContent,
    ).toContain('離職者');

    api.listInactiveMembersWithOpenTasks.mockResolvedValue([]);
    await click(findButton(container, '關閉改派'));

    expect(api.listInactiveMembersWithOpenTasks).toHaveBeenCalledTimes(2);
    expect(inactiveSection()).toBeNull();
  });

  it('keeps the latest reload when an earlier one answers late', async (): Promise<void> => {
    await renderView();

    let answerEarlierReload: (
      rows: readonly InactiveMemberWithOpenTasksRecord[],
    ) => void = (): void => undefined;

    api.listInactiveMembersWithOpenTasks.mockReturnValueOnce(
      new Promise((resolve): void => {
        answerEarlierReload = resolve;
      }),
    );
    await click(findButton(inactiveSection(), '改派待辦'));
    await click(findButton(container, '關閉改派'));

    api.listInactiveMembersWithOpenTasks.mockResolvedValueOnce([]);
    await click(findButton(inactiveSection(), '改派待辦'));
    await click(findButton(container, '關閉改派'));

    expect(inactiveSection()).toBeNull();

    await act(async (): Promise<void> => {
      answerEarlierReload([goneMember]);
    });

    expect(inactiveSection()).toBeNull();
  });

  it('shows nothing when no deactivated member holds an open task', async (): Promise<void> => {
    api.listInactiveMembersWithOpenTasks.mockResolvedValue([]);

    await renderView();

    expect(inactiveSection()).toBeNull();
    expect(container.textContent).not.toContain('已停用、仍有待簽的會員');
  });

  it('keeps the member directory when the list fails to load', async (): Promise<void> => {
    api.listInactiveMembersWithOpenTasks.mockRejectedValue(
      new Error('讀取失敗'),
    );

    await renderView();

    expect(inactiveSection()?.textContent).toContain('讀取失敗');
    expect(
      container.querySelector('[data-row="member-active"]'),
    ).not.toBeNull();
  });
});
