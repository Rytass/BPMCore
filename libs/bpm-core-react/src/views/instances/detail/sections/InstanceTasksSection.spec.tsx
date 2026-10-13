import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ApprovalInstanceRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import { InstanceTasksSection } from './InstanceTasksSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));
jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'tight' },
  FormFieldLayout: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
}));

// Everything this section imports from Mezzanine is a pass-through container
// except the table, which renders each column the way the real one would.
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

  return new Proxy(
    { Table },
    {
      get: (target, key): unknown =>
        key === 'Table'
          ? target.Table
          : key === '__esModule'
            ? true
            : Container,
    },
  );
});

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  cancelAdhocDirective: jest.fn(),
  configureAdhocCompletionNotification: jest.fn(),
  configureAdhocStageNotification: jest.fn(),
  decideTask: jest.fn(),
  requestAdhocCountersign: jest.fn(),
  requestAdhocPreApproval: jest.fn(),
  searchMembers: jest.fn(),
}));

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

function instanceWithLabels(
  labels: Readonly<Record<string, string>>,
): ApprovalInstanceRecord {
  return {
    id: 'instance-1',
    workflowSnapshot: {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: Object.entries(labels).map(([id, label]) => ({
        data: { label },
        id,
        position: { x: 0, y: 0 },
        type: 'userTask',
      })),
    },
  } as unknown as ApprovalInstanceRecord;
}

describe('InstanceTasksSection node column', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(
    tasks: readonly TaskRecord[],
    instance: ApprovalInstanceRecord,
  ): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <InstanceTasksSection
          adhocDirectives={[]}
          currentMemberId="member-009"
          instance={instance}
          memberProfilesById={new Map()}
          onChanged={jest.fn()}
          tasks={tasks}
        />,
      );
    });
  }

  const nodeCell = (taskId: string): string | undefined =>
    container.querySelector(`[data-row="${taskId}"] [data-column="節點"]`)
      ?.textContent ?? undefined;

  it('names the node from the snapshot and marks ad-hoc tasks', async (): Promise<void> => {
    await render(
      [
        task({ id: 'task-1' }),
        task({
          adhocType: 'COUNTERSIGN',
          id: 'task-2',
          isAdhoc: true,
        }),
      ],
      instanceWithLabels({ 'band-0': '部門主管簽核' }),
    );

    expect(nodeCell('task-1')).toBe('部門主管簽核');
    expect(nodeCell('task-2')).toBe('部門主管簽核（臨時會簽）');
  });

  // Behaviour change from the shared ad-hoc marker helper: a blank snapshot
  // label used to render as an empty cell, it now shows the node id.
  it('shows the node id when the snapshot label is blank', async (): Promise<void> => {
    await render(
      [task({ id: 'task-1' })],
      instanceWithLabels({ 'band-0': '  ' }),
    );

    expect(nodeCell('task-1')).toBe('band-0');
  });
});
