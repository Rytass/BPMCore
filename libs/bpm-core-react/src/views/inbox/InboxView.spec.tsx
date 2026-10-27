import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type {
  ApprovalInstanceRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import { InboxView } from './InboxView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));
jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <header>{props.children as ReactNode}</header>
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  const Container = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => <div>{props.children as ReactNode}</div>;
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly dataIndex?: string;
      readonly key: string;
      readonly render?: (row: unknown) => ReactNode;
      readonly title: string;
    }[];
    const rows = props.dataSource as readonly Record<string, unknown>[];

    return (
      <div>
        {rows.map((row): ReactElement => (
          <div data-row={row['key'] as string} key={row['key'] as string}>
            {columns.map((column): ReactElement => (
              <span data-column={column.title} key={column.key}>
                {column.render
                  ? column.render(row)
                  : (row[column.dataIndex ?? column.key] as ReactNode)}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return {
    Badge: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.text as ReactNode}</span>
    ),
    Button: Container,
    PageHeader: Container,
    Section: Container,
    SectionGroup: Container,
    Tab: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <div>
        {props.children as ReactNode}
        {['tracking', 'history'].map(
          (tab): ReactElement => (
            <button
              data-tab={tab}
              key={tab}
              onClick={(): void =>
                (props.onChange as (key: string) => void)(tab)
              }
              type="button"
            />
          ),
        )}
      </div>
    ),
    TabItem: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <div data-badge-count={String(props.badgeCount ?? '')}>
        {props.children as ReactNode}
      </div>
    ),
    Table,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('../../lib/auth-provider', () => ({
  useAuth: (): { readonly member: { readonly memberId: string } } => ({
    member: { memberId: 'member-001' },
  }),
}));
jest.mock('../../lib/router-adapter', () => ({
  useRouterAdapter: (): { readonly push: jest.Mock } => ({ push: jest.fn() }),
}));
jest.mock('../../lib/routes-config', () => ({
  useBPMRoutes: (): Readonly<Record<string, unknown>> => ({}),
}));
jest.mock('@rytass/bpm-core-client/workflow', () => ({
  listApprovalHistoryTasks: jest.fn(),
  listApprovalInstancesPage: jest.fn(),
  listInboxTasks: jest.fn(),
  listTaskDecisions: jest.fn(),
  readApprovalInstance: jest.fn(),
  readApprovalInstanceCaseTitle: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

function returnedInstance(
  value: Partial<ApprovalInstanceRecord>,
): ApprovalInstanceRecord {
  return {
    id: 'instance-r1',
    initiatorMemberId: 'member-001',
    startedAt: '2026-10-20T01:00:00.000Z',
    state: 'RETURNED',
    submittedByMemberId: 'member-001',
    title: '出差申請',
    ...value,
  } as ApprovalInstanceRecord;
}

function returnedPage(
  instances: readonly ApprovalInstanceRecord[],
  totalCount: number = instances.length,
): Awaited<ReturnType<typeof workflowApi.listApprovalInstancesPage>> {
  return {
    instances,
    totalCount,
  } as Awaited<ReturnType<typeof workflowApi.listApprovalInstancesPage>>;
}

function task(value: Partial<TaskRecord>): TaskRecord {
  return {
    adhocDirectiveId: null,
    adhocOriginTaskId: null,
    adhocType: null,
    assigneeMemberId: 'member-001',
    assignmentType: 'DIRECT_MEMBER',
    candidateMemberIds: [],
    completedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    decisionPolicySnapshotJson: '{}',
    delegationChainJson: '[]',
    id: 'task-1',
    instanceId: 'instance-1',
    isAdhoc: false,
    nodeId: 'band-0',
    openedAt: null,
    originalAssigneeMemberId: null,
    slaDueAt: null,
    status: 'PENDING',
    tokenId: 'token-1',
    ...value,
  };
}

describe('InboxView node column', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
    api.readApprovalInstance.mockRejectedValue(new Error('not needed'));
    api.listTaskDecisions.mockResolvedValue([]);
    api.listApprovalHistoryTasks.mockResolvedValue([]);
    api.listApprovalInstancesPage.mockResolvedValue(returnedPage([]));
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  const nodeCell = (taskId: string): string | undefined =>
    container.querySelector(`[data-row="${taskId}"] [data-column="節點"]`)
      ?.textContent ?? undefined;

  async function renderInbox(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<InboxView />);
    });
  }

  async function openTab(tab: 'history' | 'tracking'): Promise<void> {
    await act(async (): Promise<void> => {
      container
        .querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)
        ?.click();
    });
  }

  const historyTasks = [
    task({ id: 'task-1', nodeLabel: '部門主管簽核', status: 'COMPLETED' }),
    task({
      id: 'task-2',
      nodeId: 'band-1',
      nodeLabel: null,
      status: 'COMPLETED',
    }),
  ];

  it('shows the node name in the pending tab and falls back to the id', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([
      task({ id: 'task-1', nodeLabel: '部門主管簽核' }),
      task({ id: 'task-2', nodeId: 'band-1', nodeLabel: null }),
    ]);

    await renderInbox();

    expect(nodeCell('task-1')).toBe('部門主管簽核');
    expect(nodeCell('task-2')).toBe('band-1');
  });

  it('flags pending tasks whose node lets the approver fill in fields', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([
      task({ hasFillableFields: true, id: 'task-1' }),
      task({ hasFillableFields: false, id: 'task-2' }),
    ]);

    await renderInbox();

    const fillCell = (taskId: string): string | undefined =>
      container.querySelector(`[data-row="${taskId}"] [data-column="補填"]`)
        ?.textContent ?? undefined;

    expect(fillCell('task-1')).toBe('需補填');
    expect(fillCell('task-2')).toBe('');
  });

  it('shows the node name in the history tab and falls back to the id', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([]);
    api.listApprovalHistoryTasks.mockResolvedValue(historyTasks);

    await renderInbox();
    await openTab('history');

    expect(nodeCell('task-1')).toBe('部門主管簽核');
    expect(nodeCell('task-2')).toBe('band-1');
  });

  it('shows the node name in the tracking tab', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([]);
    api.listApprovalHistoryTasks.mockResolvedValue(historyTasks);
    api.readApprovalInstance.mockResolvedValue({
      instance: { state: 'RUNNING' },
    } as Awaited<ReturnType<typeof workflowApi.readApprovalInstance>>);
    api.readApprovalInstanceCaseTitle.mockReturnValue('案件');

    await renderInbox();
    await openTab('tracking');

    expect(nodeCell('task-1')).toBe('部門主管簽核');
    expect(nodeCell('task-2')).toBe('band-1');
  });
});

describe('InboxView returned cases', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
    api.listInboxTasks.mockResolvedValue([]);
    api.listApprovalHistoryTasks.mockResolvedValue([]);
    api.listTaskDecisions.mockResolvedValue([]);
    api.readApprovalInstance.mockRejectedValue(new Error('not needed'));
    api.readApprovalInstanceCaseTitle.mockImplementation(
      (instance): string => instance.title ?? instance.id,
    );
    api.listApprovalInstancesPage.mockResolvedValue(returnedPage([]));
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function renderInbox(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<InboxView />);
    });
  }

  const returnedSection = (): Element | null =>
    container.querySelector('[data-returned-instances]');

  it('lists the returned cases the member started', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([returnedInstance({ id: 'instance-r1' })]),
    );

    await renderInbox();

    expect(api.listApprovalInstancesPage).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'RETURNED', view: 'SENT' }),
    );
    expect(returnedSection()?.textContent).toContain('被退回待重送');
    expect(
      returnedSection()?.querySelector(
        '[data-row="instance-r1"] [data-column="案件"]',
      )?.textContent,
    ).toBe('出差申請');
  });

  // SENT also lists what an assistant filed for someone else, and only the
  // initiator may resubmit.
  it('leaves out returned cases someone else started', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([
        returnedInstance({ id: 'instance-mine' }),
        returnedInstance({
          id: 'instance-filed-for-boss',
          initiatorMemberId: 'member-boss',
        }),
      ]),
    );

    await renderInbox();

    expect(
      returnedSection()?.querySelector('[data-row="instance-mine"]'),
    ).not.toBeNull();
    expect(
      returnedSection()?.querySelector('[data-row="instance-filed-for-boss"]'),
    ).toBeNull();
  });

  it('shows the returned cases only on the pending tab', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([returnedInstance({ id: 'instance-r1' })]),
    );

    await renderInbox();

    expect(returnedSection()).not.toBeNull();

    await act(async (): Promise<void> => {
      container
        .querySelector<HTMLButtonElement>('[data-tab="tracking"]')
        ?.click();
    });

    expect(returnedSection()).toBeNull();
  });

  it('shows nothing when no case is returned', async (): Promise<void> => {
    await renderInbox();

    expect(returnedSection()).toBeNull();
  });

  // Returned cases are not tasks, so the pending count stays the task count.
  it('keeps returned cases out of the pending count', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([task({ id: 'task-1' })]);
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([
        returnedInstance({ id: 'instance-r1' }),
        returnedInstance({ id: 'instance-r2' }),
      ]),
    );

    await renderInbox();

    expect(
      container.querySelector('[data-badge-count]')?.getAttribute(
        'data-badge-count',
      ),
    ).toBe('1');
    expect(returnedSection()?.querySelectorAll('[data-row]')).toHaveLength(2);
  });

  it('says where to find the rest when there are more than it lists', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([returnedInstance({ id: 'instance-r1' })], 101),
    );

    await renderInbox();

    expect(returnedSection()?.textContent).toContain('我發起的');
  });

  // The total also counts cases filed for someone else, which are dropped
  // here; only a full page means anything was left out.
  it('does not mention the rest when everything is listed', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([
        returnedInstance({ id: 'instance-r1' }),
        returnedInstance({
          id: 'instance-filed-for-boss',
          initiatorMemberId: 'member-boss',
        }),
      ]),
    );

    await renderInbox();

    expect(returnedSection()?.textContent).not.toContain('我發起的');
  });
});
