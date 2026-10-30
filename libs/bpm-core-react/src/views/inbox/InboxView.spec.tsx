import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type {
  ApprovalInstanceRecord,
  TaskDecisionRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../lib/format-date-time';
import { InboxView } from './InboxView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mockCurrentMemberId = 'member-001';

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
    member: { memberId: mockCurrentMemberId },
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

  // The returned list is a side list; losing it must not take the tasks down.
  it('still lists the pending tasks when the returned cases fail to load', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([task({ id: 'task-1' })]);
    api.listApprovalInstancesPage.mockRejectedValue(new Error('boom'));

    await renderInbox();

    expect(container.querySelector('[data-row="task-1"]')).not.toBeNull();
    expect(returnedSection()).toBeNull();
    expect(container.textContent).not.toContain('boom');
  });

  it('hides only the returned list when its rows cannot be read', async (): Promise<void> => {
    api.listInboxTasks.mockResolvedValue([task({ id: 'task-1' })]);
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage([returnedInstance({ id: 'instance-r1' })]),
    );
    api.readApprovalInstanceCaseTitle.mockImplementation((): string => {
      throw new Error('bad snapshot');
    });

    await renderInbox();

    expect(container.querySelector('[data-row="task-1"]')).not.toBeNull();
    expect(returnedSection()).toBeNull();
    expect(container.textContent).not.toContain('bad snapshot');
  });

  // A full page of 100 with more behind it, as the server pages them.
  const fullPage = (initiatorMemberId: string): ApprovalInstanceRecord[] =>
    Array.from(
      { length: 100 },
      (_, index): ApprovalInstanceRecord =>
        returnedInstance({ id: `instance-${index}`, initiatorMemberId }),
    );

  it('says where to find the rest when there are more than it lists', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage(fullPage('member-001'), 101),
    );

    await renderInbox();

    expect(api.listApprovalInstancesPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );
    expect(returnedSection()?.textContent).toContain(
      '你發起的案件被退回，請修改後重新送出。可能還有其他被退回的案件，請到「我發起的」查看。',
    );
  });

  // The member's own returned cases may all sit past a first page filled with
  // cases filed for someone else; the pointer must still show.
  it('points to the rest when the first page holds none of the member\'s own cases', async (): Promise<void> => {
    api.listApprovalInstancesPage.mockResolvedValue(
      returnedPage(fullPage('member-boss'), 101),
    );

    await renderInbox();

    expect(returnedSection()?.textContent).toBe(
      '前 100 筆被退回的案件中沒有你發起的，可能還有其他被退回的案件，請到「我發起的」查看。',
    );
    expect(returnedSection()?.querySelectorAll('[data-row]')).toHaveLength(0);
  });

  // The total also counts cases filed for someone else, which are dropped
  // here; only a total above what the page fetched means anything was left
  // out.
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

describe('InboxView own decision', () => {
  const CHIEF = 'member-chief';
  const MANAGER = 'member-manager';
  const DIRECTOR = 'member-director';
  const DECISION_LABELS: Readonly<Record<string, string>> = {
    APPROVED: '同意',
    REJECTED: '拒絕',
    TRANSFERRED: '轉派',
  };

  interface Signing {
    readonly action: TaskDecisionRecord['action'];
    readonly comment: string | null;
    readonly memberId: string;
  }

  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
    api.listInboxTasks.mockResolvedValue([]);
    api.listApprovalInstancesPage.mockResolvedValue(returnedPage([]));
    api.readApprovalInstance.mockRejectedValue(new Error('not needed'));
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
    mockCurrentMemberId = 'member-001';
  });

  function decision(
    taskId: string,
    signing: Signing,
    order: number,
  ): TaskDecisionRecord {
    return {
      ...signing,
      decidedAt: `2026-10-30T01:0${order}:00.000Z`,
      decidedByMemberId: signing.memberId,
      id: `${taskId}-${order}`,
      returnToNodeId: null,
      signatureId: null,
      taskId,
      transferToMemberId: null,
    } as unknown as TaskDecisionRecord;
  }

  function cell(taskId: string, column: string): string | undefined {
    return (
      container.querySelector(`[data-row="${taskId}"] [data-column="${column}"]`)
        ?.textContent ?? undefined
    );
  }

  async function openHistoryAs(
    memberId: string,
    taskRecord: TaskRecord,
    decisions: readonly TaskDecisionRecord[],
    tab: 'history' | 'tracking' = 'history',
  ): Promise<void> {
    mockCurrentMemberId = memberId;
    api.listApprovalHistoryTasks.mockResolvedValue([taskRecord]);
    api.listTaskDecisions.mockImplementation(
      async (taskId: string): Promise<readonly TaskDecisionRecord[]> =>
        decisions.filter((item): boolean => item.taskId === taskId),
    );

    await act(async (): Promise<void> => {
      root.render(<InboxView />);
    });
    await act(async (): Promise<void> => {
      container
        .querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)
        ?.click();
    });
  }

  const chains: readonly {
    readonly name: string;
    readonly shared: boolean;
    readonly signings: readonly Signing[];
  }[] = [
    {
      name: 'a shared task where everyone wrote',
      shared: true,
      signings: [
        { action: 'APPROVED', comment: '課長意見', memberId: CHIEF },
        { action: 'APPROVED', comment: '經理意見', memberId: MANAGER },
        { action: 'APPROVED', comment: '協理意見', memberId: DIRECTOR },
      ],
    },
    {
      name: 'a shared task where the last signer wrote nothing',
      shared: true,
      signings: [
        { action: 'APPROVED', comment: '課長意見', memberId: CHIEF },
        { action: 'APPROVED', comment: '經理意見', memberId: MANAGER },
        { action: 'APPROVED', comment: null, memberId: DIRECTOR },
      ],
    },
    {
      name: 'a shared task the last signer rejected',
      shared: true,
      signings: [
        { action: 'APPROVED', comment: null, memberId: CHIEF },
        { action: 'APPROVED', comment: null, memberId: MANAGER },
        { action: 'REJECTED', comment: '退回重填', memberId: DIRECTOR },
      ],
    },
    {
      name: 'separate tasks where everyone wrote',
      shared: false,
      signings: [
        { action: 'APPROVED', comment: '課長意見', memberId: CHIEF },
        { action: 'APPROVED', comment: '經理意見', memberId: MANAGER },
        { action: 'APPROVED', comment: '協理意見', memberId: DIRECTOR },
      ],
    },
    {
      name: 'separate tasks the last signer rejected',
      shared: false,
      signings: [
        { action: 'APPROVED', comment: null, memberId: CHIEF },
        { action: 'APPROVED', comment: null, memberId: MANAGER },
        { action: 'REJECTED', comment: '退回重填', memberId: DIRECTOR },
      ],
    },
  ];

  it.each(
    chains.flatMap((chain) =>
      chain.signings.map(
        (signing, index) =>
          [`${chain.name}`, signing.memberId, chain, index] as const,
      ),
    ),
  )(
    'on %s, shows %s their own row',
    async (_name, memberId, chain, index): Promise<void> => {
      const readTaskId = (order: number): string =>
        chain.shared ? 'task-shared' : `task-${order}`;
      const taskId = readTaskId(index);
      const signing = chain.signings[index];
      const decisions = chain.signings.map((item, order) =>
        decision(readTaskId(order), item, order + 1),
      );

      // completedAt differs from every decision time, so a fallback to it
      // cannot pass for the signer's own time.
      await openHistoryAs(
        memberId,
        task({
          completedAt: '2026-10-30T05:00:00.000Z',
          id: taskId,
          status: 'COMPLETED',
        }),
        decisions,
      );

      expect(cell(taskId, '決議')).toBe(DECISION_LABELS[signing.action]);
      expect(cell(taskId, '意見')).toBe(signing.comment ?? '-');
      expect(cell(taskId, '簽核時間')).toBe(
        formatDateTime(decisions[index].decidedAt),
      );
    },
  );

  it('shows the same own decision on the tracking tab', async (): Promise<void> => {
    api.readApprovalInstance.mockResolvedValue({
      instance: { state: 'RUNNING' },
    } as Awaited<ReturnType<typeof workflowApi.readApprovalInstance>>);
    api.readApprovalInstanceCaseTitle.mockReturnValue('案件');

    await openHistoryAs(
      CHIEF,
      task({ id: 'task-shared', status: 'IN_PROGRESS' }),
      [
        decision(
          'task-shared',
          { action: 'APPROVED', comment: '課長意見', memberId: CHIEF },
          1,
        ),
        decision(
          'task-shared',
          { action: 'REJECTED', comment: '退回重填', memberId: MANAGER },
          2,
        ),
      ],
      'tracking',
    );

    expect(cell('task-shared', '決議')).toBe('同意');
    expect(cell('task-shared', '意見')).toBe('課長意見');
  });

  it('shows a delegate the decision they made for the original assignee', async (): Promise<void> => {
    // decideTask records whoever acted, and a delegated task is assigned to
    // the delegate with the principal kept in originalAssigneeMemberId.
    await openHistoryAs(
      'member-delegate',
      task({
        assigneeMemberId: 'member-delegate',
        id: 'task-shared',
        originalAssigneeMemberId: CHIEF,
        status: 'COMPLETED',
      }),
      [
        decision(
          'task-shared',
          {
            action: 'APPROVED',
            comment: '代理意見',
            memberId: 'member-delegate',
          },
          1,
        ),
        decision(
          'task-shared',
          { action: 'APPROVED', comment: '經理意見', memberId: MANAGER },
          2,
        ),
      ],
    );

    expect(cell('task-shared', '意見')).toBe('代理意見');
  });

  it('keeps a signer on their approval after a later signer transferred the task', async (): Promise<void> => {
    await openHistoryAs(
      CHIEF,
      task({ id: 'task-shared', status: 'TRANSFERRED' }),
      [
        decision(
          'task-shared',
          { action: 'APPROVED', comment: '課長意見', memberId: CHIEF },
          1,
        ),
        decision(
          'task-shared',
          { action: 'TRANSFERRED', comment: '轉給副理', memberId: MANAGER },
          2,
        ),
      ],
    );

    expect(cell('task-shared', '決議')).toBe('同意');
    expect(cell('task-shared', '意見')).toBe('課長意見');
  });

  it('shows the latest of a member\'s own decisions on a task', async (): Promise<void> => {
    // A seat transferred away and back leaves the member two decisions.
    await openHistoryAs(
      CHIEF,
      task({ id: 'task-shared', status: 'COMPLETED' }),
      [
        decision(
          'task-shared',
          { action: 'TRANSFERRED', comment: '先轉出', memberId: CHIEF },
          1,
        ),
        decision(
          'task-shared',
          { action: 'APPROVED', comment: '收回後同意', memberId: CHIEF },
          2,
        ),
        decision(
          'task-shared',
          { action: 'APPROVED', comment: '經理意見', memberId: MANAGER },
          3,
        ),
      ],
    );

    expect(cell('task-shared', '決議')).toBe('同意');
    expect(cell('task-shared', '意見')).toBe('收回後同意');
  });

  it('shows no one else\'s decision to a member who has none on the task', async (): Promise<void> => {
    await openHistoryAs(
      CHIEF,
      task({ id: 'task-shared', status: 'COMPLETED' }),
      [
        decision(
          'task-shared',
          { action: 'REJECTED', comment: '退回重填', memberId: MANAGER },
          1,
        ),
      ],
    );

    expect(cell('task-shared', '決議')).toBe('未記錄');
    expect(cell('task-shared', '意見')).toBe('-');
  });
});
