import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as clientApi from '@rytass/bpm-core-client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { StuckApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import { AdminStuckInstancesView } from './AdminStuckInstancesView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));
jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'tight' },
  FormFieldLayout: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
}));
jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <header>
      <h1>{props.title as string}</h1>
      {props.children as ReactNode}
    </header>
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  const Container = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => <div>{props.children as ReactNode}</div>;
  const Input = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <input
      name={props.name as string}
      onChange={props.onChange as () => void}
      value={props.value as string}
    />
  );
  const Modal = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement | null =>
    props.open ? (
      <div data-modal="">
        {props.children as ReactNode}
        <button onClick={props.onConfirm as () => void} type="button">
          {props.confirmText as string}
        </button>
      </div>
    ) : null;
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly key: string;
      readonly render: (row: unknown) => ReactNode;
    }[];
    const rows = props.dataSource as readonly { readonly key: string }[];
    const actions = props.actions as
      | {
          readonly render: (
            row: unknown,
          ) => readonly {
            readonly name: string;
            readonly onClick: () => void;
          }[];
        }
      | undefined;

    return (
      <div data-loading={String(props.loading)} data-table="">
        {rows.map((row): ReactElement => (
          <div data-row={row.key} key={row.key}>
            {columns.map((column): ReactElement => (
              <span data-column={column.key} key={column.key}>
                {column.render(row)}
              </span>
            ))}
            {(actions?.render(row) ?? []).map((action): ReactElement => (
              <button key={action.name} onClick={action.onClick} type="button">
                {action.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return {
    FormField: Container,
    Input,
    Modal,
    PageHeader: Container,
    Section: Container,
    SectionGroup: Container,
    Table,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('@rytass/bpm-core-client', () => ({
  resolveMembers: jest.fn(),
}));

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  adminCancelApprovalInstance: jest.fn(),
  listStuckApprovalInstances: jest.fn(),
}));

const members = clientApi as jest.Mocked<typeof clientApi>;
const api = workflowApi as jest.Mocked<typeof workflowApi>;

const STUCK: StuckApprovalInstanceRecord = {
  automatic: null,
  failedActorMemberId: 'member-1',
  failedAt: '2026-11-12T08:00:00.000Z',
  initiatorMemberId: 'member-9',
  instanceId: 'instance-1',
  instanceTitle: '採購申請',
  kind: 'DECISION',
  message: '找不到下一關的簽核人',
  nodeId: 'task_finance',
  nodeLabel: '財務審核',
  pendingActorMemberIds: ['member-1', 'member-2'],
  taskId: 'task-1',
  templateId: 'template-1',
  templateName: '採購',
};

const SLA: StuckApprovalInstanceRecord = {
  ...STUCK,
  automatic: 'SLA_AUTO_APPROVE',
  instanceId: 'instance-2',
  instanceTitle: '出差申請',
};

const RESUBMIT: StuckApprovalInstanceRecord = {
  ...STUCK,
  instanceId: 'instance-3',
  instanceTitle: '請購單',
  kind: 'RESUBMIT',
  nodeId: null,
  nodeLabel: null,
  pendingActorMemberIds: [],
  taskId: null,
};

describe('AdminStuckInstancesView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    members.resolveMembers.mockReset();
    api.listStuckApprovalInstances.mockReset();
    api.adminCancelApprovalInstance.mockReset();
    members.resolveMembers.mockResolvedValue([
      {
        customFieldsJson: '{}',
        email: 'a@example.com',
        memberId: 'member-1',
        name: '王小明',
      },
      {
        customFieldsJson: '{}',
        email: 'b@example.com',
        memberId: 'member-2',
        name: '李大華',
      },
    ]);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<AdminStuckInstancesView />);
    });
  }

  function cell(rowKey: string, column: string): string {
    return (
      container.querySelector(`[data-row="${rowKey}"] [data-column="${column}"]`)
        ?.textContent ?? ''
    );
  }

  function button(name: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name,
    );

    if (!found) {
      throw new Error(`button ${name} was not rendered`);
    }

    return found;
  }

  it('lists each stuck case with where it stuck, the reason and a 24-hour time', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([STUCK]);

    await render();

    expect(cell('instance-1', 'instanceTitle')).toBe('採購申請');
    expect(cell('instance-1', 'templateName')).toBe('採購');
    expect(cell('instance-1', 'stuckAt')).toBe('財務審核');
    expect(cell('instance-1', 'message')).toBe('找不到下一關的簽核人');
    expect(cell('instance-1', 'failedAt')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('names the member who failed and every member who has to press again', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([STUCK]);

    await render();

    expect(members.resolveMembers).toHaveBeenCalledWith(['member-1', 'member-2']);
    expect(cell('instance-1', 'failedActor')).toBe('王小明');
    expect(cell('instance-1', 'pendingActors')).toBe('王小明、李大華');
  });

  it('falls back to the member id when the directory cannot name a member', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([STUCK]);
    members.resolveMembers.mockRejectedValue(new Error('directory down'));

    await render();

    expect(cell('instance-1', 'failedActor')).toBe('member-1');
    expect(cell('instance-1', 'pendingActors')).toBe('member-1、member-2');
  });

  it('shows the system as the one that failed when the timeout auto-approval did', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([SLA]);

    await render();

    expect(cell('instance-2', 'failedActor')).toBe('系統逾時自動同意');
  });

  it('shows a failed resubmission as 退件後重送 and says when nobody can press', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([RESUBMIT]);

    await render();

    expect(cell('instance-3', 'stuckAt')).toBe('退件後重送');
    expect(cell('instance-3', 'pendingActors')).toBe('目前沒有人能按');
  });

  it('says so when no case is stuck', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockResolvedValue([]);

    await render();

    expect(container.textContent).toContain('目前沒有卡住的案件');
  });

  it('shows the table, loading, while the first listing is still on its way', async (): Promise<void> => {
    let resolveListing: (
      instances: readonly StuckApprovalInstanceRecord[],
    ) => void = (): void => undefined;

    api.listStuckApprovalInstances.mockReturnValue(
      new Promise<readonly StuckApprovalInstanceRecord[]>((resolve): void => {
        resolveListing = resolve;
      }),
    );

    await render();

    const table = container.querySelector('[data-table]');

    expect(table).not.toBeNull();
    expect(table?.getAttribute('data-loading')).toBe('true');
    expect(container.textContent).not.toContain('目前沒有卡住的案件');

    await act(async (): Promise<void> => {
      resolveListing([STUCK]);
    });

    expect(
      container.querySelector('[data-table]')?.getAttribute('data-loading'),
    ).toBe('false');
    expect(cell('instance-1', 'instanceTitle')).toBe('採購申請');
  });

  it('shows the error when the list cannot be loaded, not the empty message', async (): Promise<void> => {
    api.listStuckApprovalInstances.mockRejectedValue(new Error('Forbidden'));

    await render();

    expect(container.textContent).toContain('Forbidden');
    expect(container.textContent).not.toContain('目前沒有卡住的案件');
  });

  it('cancels a case from its row and reloads the list', async (): Promise<void> => {
    api.listStuckApprovalInstances
      .mockResolvedValueOnce([STUCK])
      .mockResolvedValueOnce([]);
    api.adminCancelApprovalInstance.mockResolvedValue(undefined);

    await render();
    await act(async (): Promise<void> => {
      button('撤銷').click();
    });

    expect(container.querySelector('[data-modal]')).not.toBeNull();

    await act(async (): Promise<void> => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      const input = container.querySelector('input') as HTMLInputElement;

      setValue?.call(input, '下一關設定有誤');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async (): Promise<void> => {
      button('確認撤銷').click();
    });

    expect(api.adminCancelApprovalInstance).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      reason: '下一關設定有誤',
    });
    expect(api.listStuckApprovalInstances).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-modal]')).toBeNull();
    expect(container.textContent).toContain('目前沒有卡住的案件');
  });
});
