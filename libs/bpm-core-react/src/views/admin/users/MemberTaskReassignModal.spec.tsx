import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MemberProfileRecord } from '@rytass/bpm-core-client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type {
  MemberOpenTaskRecord,
  TaskReassignmentResultRecord,
} from '@rytass/bpm-core-client/workflow';
import { MemberTaskReassignModal } from './MemberTaskReassignModal';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));

jest.mock('@mezzanine-ui/react', () => {
  const Button = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <button
      disabled={Boolean(props.disabled)}
      onClick={props.onClick as () => void}
      type="button"
    >
      {props.children as ReactNode}
    </button>
  );
  const Input = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <input
      name={props.name as string}
      onChange={props.onChange as () => void}
      placeholder={props.placeholder as string}
      value={props.value as string}
    />
  );
  const Modal = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement | null => {
    const confirmButtonProps = (props.confirmButtonProps ?? {}) as {
      readonly disabled?: boolean;
    };

    return props.open ? (
      <div>
        {props.children as ReactNode}
        <button
          disabled={Boolean(confirmButtonProps.disabled)}
          onClick={props.onConfirm as () => void}
          type="button"
        >
          {props.confirmText as string}
        </button>
        <button onClick={props.onCancel as () => void} type="button">
          {props.cancelText as string}
        </button>
      </div>
    ) : null;
  };
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly key: string;
      readonly dataIndex?: string;
      readonly render?: (row: unknown) => ReactNode;
    }[];
    const rows = props.dataSource as readonly Readonly<
      Record<string, unknown>
    >[];

    return (
      <div>
        {rows.map((row): ReactElement => (
          <div key={String(row.key)}>
            {columns.map((column): ReactElement => (
              <span key={column.key}>
                {column.render
                  ? column.render(row)
                  : String(row[column.dataIndex ?? ''] ?? '')}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return {
    Button,
    Input,
    Modal,
    Table,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('../../../components/bpm-form-field', () => ({
  BPMFormField: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <div>{props.children as ReactNode}</div>
  ),
}));

jest.mock('../../../components/admin-pickers', () => ({
  MemberPicker: (
    props: Readonly<{ onChange: (option: unknown) => void }>,
  ): ReactElement => (
    <button
      onClick={(): void =>
        props.onChange({
          email: 'to@example.com',
          id: 'member-to',
          name: '接手人',
        })
      }
      type="button"
    >
      選接手人
    </button>
  ),
}));

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  listMemberOpenTasks: jest.fn(),
  reassignMemberTasks: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

const MEMBER: MemberProfileRecord = {
  customFieldsJson: '{}',
  email: 'from@example.com',
  memberId: 'member-from',
  name: '離職者',
};

const TASK: MemberOpenTaskRecord = {
  businessKey: 'PO-1',
  candidateStatus: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  decisionPolicyType: 'SINGLE',
  instanceId: 'instance-1',
  instanceTitle: '採購申請',
  memberRole: 'ASSIGNEE',
  nodeId: 'task_finance',
  nodeLabel: '財務簽核',
  slaDueAt: null,
  taskId: 'task-1',
  templateId: 'template-1',
  templateName: '採購',
};

const WOULD_REASSIGN: TaskReassignmentResultRecord = {
  errorCode: null,
  instanceId: 'instance-1',
  message: null,
  nodeId: 'task_finance',
  outcome: 'WOULD_REASSIGN',
  taskId: 'task-1',
};

const REASSIGNED: TaskReassignmentResultRecord = {
  ...WOULD_REASSIGN,
  outcome: 'REASSIGNED',
};

describe('MemberTaskReassignModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
    api.listMemberOpenTasks.mockResolvedValue([TASK]);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <MemberTaskReassignModal member={MEMBER} onClose={jest.fn()} />,
      );
    });
  }

  function findButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === text,
    );

    if (!button) {
      throw new Error(`Button "${text}" was not rendered`);
    }

    return button;
  }

  async function clickButton(text: string): Promise<void> {
    await act(async (): Promise<void> => {
      findButton(text).click();
    });
  }

  function typeReason(value: string): void {
    const input = container.querySelector(
      'input[name="reassignReason"]',
    ) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    act((): void => {
      setValue?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('lists the member open tasks once opened', async (): Promise<void> => {
    await render();

    expect(api.listMemberOpenTasks).toHaveBeenCalledWith('member-from');
    expect(container.textContent).toContain('採購申請');
  });

  it('ignores a late listing of the member shown before', async (): Promise<void> => {
    let answerFirst: (tasks: MemberOpenTaskRecord[]) => void = (): void =>
      undefined;
    const OTHER: MemberProfileRecord = {
      ...MEMBER,
      memberId: 'member-other',
      name: '另一位',
    };

    api.listMemberOpenTasks
      .mockImplementationOnce(
        (): Promise<MemberOpenTaskRecord[]> =>
          new Promise((resolve): void => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ ...TASK, instanceTitle: '另一位的案件' }]);

    await act(async (): Promise<void> => {
      root.render(
        <MemberTaskReassignModal member={MEMBER} onClose={jest.fn()} />,
      );
    });
    await act(async (): Promise<void> => {
      root.render(
        <MemberTaskReassignModal member={OTHER} onClose={jest.fn()} />,
      );
    });
    await act(async (): Promise<void> => {
      answerFirst([TASK]);
    });

    expect(container.textContent).toContain('另一位的案件');
    expect(container.textContent).not.toContain('採購申請');
  });

  it('keeps confirm disabled until a preview matches the current target and reason', async (): Promise<void> => {
    api.reassignMemberTasks.mockResolvedValueOnce([WOULD_REASSIGN]);
    await render();

    expect(findButton('確認改派').disabled).toBe(true);

    await clickButton('選接手人');
    typeReason('離職');
    await clickButton('預覽');

    expect(api.reassignMemberTasks).toHaveBeenCalledWith({
      dryRun: true,
      fromMemberId: 'member-from',
      reason: '離職',
      toMemberId: 'member-to',
    });
    expect(findButton('確認改派').disabled).toBe(false);

    typeReason('離職，另案');

    expect(findButton('確認改派').disabled).toBe(true);
  });

  it('commits the previewed reassignment and shows the result', async (): Promise<void> => {
    // After the commit the member holds nothing, so the reloaded list is empty;
    // the result rows must still name the case, not fall back to task ids.
    api.listMemberOpenTasks
      .mockResolvedValueOnce([TASK])
      .mockResolvedValueOnce([]);
    api.reassignMemberTasks
      .mockResolvedValueOnce([WOULD_REASSIGN])
      .mockResolvedValueOnce([REASSIGNED]);
    await render();

    await clickButton('選接手人');
    typeReason('離職');
    await clickButton('預覽');
    await clickButton('確認改派');

    expect(api.reassignMemberTasks).toHaveBeenLastCalledWith({
      dryRun: false,
      fromMemberId: 'member-from',
      reason: '離職',
      toMemberId: 'member-to',
    });
    expect(api.listMemberOpenTasks).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('已改派');
    expect(container.textContent).toContain('採購申請');
    expect(container.textContent).not.toContain('task-1');
  });
});
