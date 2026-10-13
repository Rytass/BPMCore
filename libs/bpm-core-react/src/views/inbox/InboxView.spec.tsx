import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { TaskRecord } from '@rytass/bpm-core-client/workflow';
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
    Button: Container,
    PageHeader: Container,
    Section: Container,
    SectionGroup: Container,
    Tab: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <div>
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
    TabItem: Container,
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
  listInboxTasks: jest.fn(),
  listTaskDecisions: jest.fn(),
  readApprovalInstance: jest.fn(),
  readApprovalInstanceCaseTitle: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

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
