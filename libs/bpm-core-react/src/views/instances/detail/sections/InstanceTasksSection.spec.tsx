import { act, createRef, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  decideTask,
  type ApprovalInstanceRecord,
  type TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import {
  InstanceTasksSection,
  type InstanceTasksSectionHandle,
} from './InstanceTasksSection';

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

  const Badge = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <span data-badge={String(props.variant)}>{String(props.text)}</span>
  );
  const Description = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => (
    <div data-description={String(props.title)}>
      {props.children as ReactNode}
    </div>
  );
  // Renders only while open, with a button standing in for its confirm.
  const Modal = (props: Readonly<Record<string, unknown>>): ReactElement | null =>
    props.open === true ? (
      <div data-modal={String(props.title)}>
        {props.children as ReactNode}
        <button
          data-modal-confirm={String(props.title)}
          onClick={props.onConfirm as () => void}
          type="button"
        />
      </div>
    ) : null;
  const mocks: Readonly<Record<string, unknown>> = {
    Badge,
    Description,
    Modal,
    Table,
  };

  return new Proxy(mocks, {
    get: (target, key): unknown =>
      typeof key === 'string' && key in target
        ? target[key]
        : key === '__esModule'
          ? true
          : Container,
  });
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

describe('InstanceTasksSection approver fill', () => {
  let container: HTMLDivElement;
  let root: Root;

  const fillInstance = {
    id: 'instance-1',
    workflowSnapshot: {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: {
            allowReject: true,
            fieldAccess: [
              { display: 'SHOW', fieldKey: 'invoiceNo', fill: 'REQUIRED' },
              { display: 'SHOW', fieldKey: 'items', fill: 'OPTIONAL' },
            ],
            label: '財務',
            returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
          },
          id: 'band-0',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
      ],
    },
  } as unknown as ApprovalInstanceRecord;
  const fill = {
    expectedFormDataFingerprint: 'fp-1',
    formData: { invoiceNo: 'INV-9', items: undefined },
    summary: [{ fieldKey: 'invoiceNo', label: '發票號碼', text: 'INV-9' }],
  };

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.mocked(decideTask).mockReset();
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(
    tasks: readonly TaskRecord[],
    onFillApproveError: (message: string) => boolean = jest.fn(() => false),
  ): Promise<React.RefObject<InstanceTasksSectionHandle | null>> {
    const ref = createRef<InstanceTasksSectionHandle>();

    await act(async (): Promise<void> => {
      root.render(
        <InstanceTasksSection
          adhocDirectives={[]}
          currentMemberId="member-001"
          fill={fill}
          instance={fillInstance}
          memberProfilesById={new Map()}
          onChanged={jest.fn()}
          onFillApproveError={onFillApproveError}
          ref={ref}
          tasks={tasks}
        />,
      );
    });

    return ref;
  }

  async function approve(
    ref: React.RefObject<InstanceTasksSectionHandle | null>,
  ): Promise<void> {
    await act(async (): Promise<void> => {
      ref.current?.handleApprove();
    });
    await act(async (): Promise<void> => {
      container
        .querySelector<HTMLButtonElement>('[data-modal-confirm="簽核意見"]')
        ?.click();
    });
  }

  const fillCell = (taskId: string): string | null =>
    container.querySelector(`[data-row="${taskId}"] [data-column="補填"]`)
      ?.textContent ?? null;

  it('marks open tasks at a fill node, but not ad-hoc or closed ones', async (): Promise<void> => {
    await render([
      task({ id: 'task-1' }),
      task({ id: 'task-2', isAdhoc: true, adhocType: 'COUNTERSIGN' }),
      task({ id: 'task-3', status: 'COMPLETED' }),
    ]);

    expect(fillCell('task-1')).toBe('需補填 2 欄');
    expect(fillCell('task-2')).toBe('');
    expect(fillCell('task-3')).toBe('');
  });

  it('lists the fill in the approve dialog and sends it with the approval', async (): Promise<void> => {
    jest.mocked(decideTask).mockResolvedValue(
      {} as Awaited<ReturnType<typeof decideTask>>,
    );
    const ref = await render([task({ id: 'task-1' })]);

    await act(async (): Promise<void> => {
      ref.current?.handleApprove();
    });

    expect(
      container.querySelector('[data-description="發票號碼"]')?.textContent,
    ).toBe('INV-9');

    await approve(ref);

    expect(decideTask).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVED',
        fill: {
          expectedFormDataFingerprint: 'fp-1',
          formData: fill.formData,
        },
        taskId: 'task-1',
      }),
    );
  });

  it('never sends a fill from an ad-hoc task', async (): Promise<void> => {
    jest.mocked(decideTask).mockResolvedValue(
      {} as Awaited<ReturnType<typeof decideTask>>,
    );
    const ref = await render([
      task({ adhocType: 'COUNTERSIGN', id: 'task-1', isAdhoc: true }),
    ]);

    await approve(ref);

    expect(decideTask).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPROVED', fill: null }),
    );
  });

  it('closes the dialog when the container takes the error', async (): Promise<void> => {
    const message =
      'Approval instance instance-1 form data changed; refresh and retry';
    const onFillApproveError = jest.fn(() => true);

    jest.mocked(decideTask).mockRejectedValue(new Error(message));
    const ref = await render([task({ id: 'task-1' })], onFillApproveError);

    await approve(ref);

    expect(onFillApproveError).toHaveBeenCalledWith(message);
    expect(container.querySelector('[data-modal="簽核意見"]')).toBeNull();
  });

  it('keeps the dialog open with the message when the container does not', async (): Promise<void> => {
    jest.mocked(decideTask).mockRejectedValue(new Error('Task task-1 is not pending'));
    const ref = await render([task({ id: 'task-1' })]);

    await approve(ref);

    expect(
      container.querySelector('[data-modal="簽核意見"]')?.textContent,
    ).toContain('Task task-1 is not pending');
  });
});
