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
        <button onClick={props.onClose as () => void} type="button">
          dismiss
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
    const rowSelection = props.rowSelection as
      | {
          readonly hideSelectAll?: boolean;
          readonly onChange: (
            keys: string[],
            row: null,
            rows: unknown[],
          ) => void;
          readonly selectedRowKeys: readonly string[];
        }
      | undefined;

    return (
      <div>
        {rowSelection && !rowSelection.hideSelectAll ? (
          <input
            checked={rows.every((row) =>
              rowSelection.selectedRowKeys.includes(String(row.key)),
            )}
            data-select-all="true"
            onChange={(): void =>
              rowSelection.onChange(
                rowSelection.selectedRowKeys.length === rows.length
                  ? []
                  : rows.map((row) => String(row.key)),
                null,
                [],
              )
            }
            type="checkbox"
          />
        ) : null}
        {rows.map((row): ReactElement => (
          <div data-table-row-key={String(row.key)} key={String(row.key)}>
            {rowSelection ? (
              <input
                checked={rowSelection.selectedRowKeys.includes(
                  String(row.key),
                )}
                data-row-key={String(row.key)}
                onChange={(): void =>
                  rowSelection.onChange(
                    rowSelection.selectedRowKeys.includes(String(row.key))
                      ? rowSelection.selectedRowKeys.filter(
                          (key) => key !== String(row.key),
                        )
                      : [...rowSelection.selectedRowKeys, String(row.key)],
                    null,
                    [],
                  )
                }
                type="checkbox"
              />
            ) : null}
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

const TASK_2: MemberOpenTaskRecord = {
  ...TASK,
  instanceId: 'instance-2',
  instanceTitle: '出差申請',
  taskId: 'task-2',
};

const TASK_3: MemberOpenTaskRecord = {
  ...TASK,
  instanceId: 'instance-3',
  instanceTitle: '請購單',
  taskId: 'task-3',
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

const WOULD_REASSIGN_2: TaskReassignmentResultRecord = {
  ...WOULD_REASSIGN,
  instanceId: 'instance-2',
  taskId: 'task-2',
};

describe('MemberTaskReassignModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce values; reset so a test
    // that fails midway cannot leak unused answers into the next one.
    api.listMemberOpenTasks.mockReset();
    api.reassignMemberTasks.mockReset();
    api.listMemberOpenTasks.mockResolvedValue([TASK]);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(onClose: () => void = jest.fn()): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <MemberTaskReassignModal member={MEMBER} onClose={onClose} />,
      );
    });
  }

  function rowCheckbox(taskId: string): HTMLInputElement {
    const checkbox = container.querySelector<HTMLInputElement>(
      `input[data-row-key="${taskId}"]`,
    );

    if (!checkbox) {
      throw new Error(`Row checkbox "${taskId}" was not rendered`);
    }

    return checkbox;
  }

  function selectAllCheckbox(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>(
      'input[data-select-all="true"]',
    );
  }

  function goneRow(): HTMLElement {
    const row = Array.from(
      container.querySelectorAll<HTMLElement>('[data-table-row-key]'),
    ).find((candidate) =>
      (candidate.textContent ?? '').includes('已不在此人的待辦中'),
    );

    if (!row) {
      throw new Error('The "gone" result row was not rendered');
    }

    return row;
  }

  async function toggleRow(taskId: string): Promise<void> {
    await act(async (): Promise<void> => {
      rowCheckbox(taskId).click();
    });
  }

  // Sorted copy: the order of `taskIds` is not part of the contract.
  function sentTaskIds(callIndex: number): string[] {
    const input = api.reassignMemberTasks.mock.calls[callIndex]?.[0];

    return [...(input?.taskIds ?? [])].sort();
  }

  async function chooseTargetAndReason(): Promise<void> {
    await clickButton('選接手人');
    typeReason('離職');
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
      .mockResolvedValueOnce([
        {
          ...TASK,
          instanceTitle: '另一位的案件',
          taskId: 'other-1',
        },
        {
          ...TASK,
          instanceTitle: '另一位的第二張案件',
          taskId: 'other-2',
        },
      ]);

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
      taskIds: ['task-1'],
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
      taskIds: ['task-1'],
      toMemberId: 'member-to',
    });
    expect(api.listMemberOpenTasks).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('已改派');
    expect(container.textContent).toContain('採購申請');
    expect(container.textContent).not.toContain('task-1');
  });

  describe('choosing which tasks to reassign', (): void => {
    const THREE = [TASK, TASK_2, TASK_3];

    it('selects every task by default and sends all of them', async (): Promise<void> => {
      api.listMemberOpenTasks.mockResolvedValueOnce(THREE);
      api.reassignMemberTasks.mockResolvedValueOnce([]);
      await render();
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(sentTaskIds(0)).toEqual(['task-1', 'task-2', 'task-3']);
      expect(container.textContent).toContain('已選 3／3 筆');
    });

    it('sends only the checked tasks when one is unchecked', async (): Promise<void> => {
      api.listMemberOpenTasks.mockResolvedValueOnce(THREE);
      api.reassignMemberTasks.mockResolvedValueOnce([]);
      await render();
      await toggleRow('task-2');
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(sentTaskIds(0)).toEqual(['task-1', 'task-3']);
      expect(container.textContent).toContain('已選 2／3 筆');
    });

    it('disables preview and confirm when nothing is checked', async (): Promise<void> => {
      api.listMemberOpenTasks.mockResolvedValueOnce(THREE);
      api.reassignMemberTasks.mockResolvedValueOnce([WOULD_REASSIGN]);
      await render();
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(findButton('確認改派').disabled).toBe(false);

      await toggleRow('task-1');
      await toggleRow('task-2');
      await toggleRow('task-3');

      expect(container.textContent).toContain('已選 0／3 筆');
      expect(findButton('預覽').disabled).toBe(true);
      expect(findButton('確認改派').disabled).toBe(true);
    });

    it('clears the preview when the selection changes, and previews again after it is restored', async (): Promise<void> => {
      api.listMemberOpenTasks.mockResolvedValueOnce(THREE);
      api.reassignMemberTasks
        .mockResolvedValueOnce([WOULD_REASSIGN])
        .mockResolvedValueOnce([WOULD_REASSIGN]);
      await render();
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(findButton('確認改派').disabled).toBe(false);

      await toggleRow('task-3');

      expect(findButton('確認改派').disabled).toBe(true);

      await toggleRow('task-3');

      expect(findButton('確認改派').disabled).toBe(true);

      await clickButton('預覽');

      expect(api.reassignMemberTasks).toHaveBeenCalledTimes(2);
      expect(findButton('確認改派').disabled).toBe(false);
    });

    it('lists a sent task that did not come back, with the title it was sent with', async (): Promise<void> => {
      // task-3 stays unchecked: two ids are sent, only task-1 is answered.
      api.listMemberOpenTasks
        .mockResolvedValueOnce(THREE)
        .mockResolvedValueOnce([]);
      api.reassignMemberTasks
        .mockResolvedValueOnce([WOULD_REASSIGN])
        .mockResolvedValueOnce([REASSIGNED]);
      await render();
      await toggleRow('task-3');
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(sentTaskIds(0)).toEqual(['task-1', 'task-2']);
      // Scoped to the "gone" row: the title is also in the task table above,
      // so a page-wide check would pass even if the row fell back to the id.
      expect(goneRow().textContent).toContain('出差申請');
      expect(container.textContent).not.toContain('task-2');

      // Commit path: the reloaded list is empty, so the title can only come
      // from the snapshot taken when the request was sent.
      await clickButton('確認改派');

      expect(sentTaskIds(1)).toEqual(['task-1', 'task-2']);
      expect(container.textContent).toContain('已改派');
      expect(container.textContent).toContain('已不在此人的待辦中');
      expect(container.textContent).toContain('出差申請');
      expect(container.textContent).not.toContain('task-2');
    });

    it('selects the reloaded list again after a commit and sends all of it next time', async (): Promise<void> => {
      api.listMemberOpenTasks
        .mockResolvedValueOnce(THREE)
        .mockResolvedValueOnce([TASK_2, TASK_3]);
      api.reassignMemberTasks
        .mockResolvedValueOnce([WOULD_REASSIGN])
        .mockResolvedValueOnce([REASSIGNED])
        .mockResolvedValueOnce([WOULD_REASSIGN_2]);
      await render();
      await toggleRow('task-2');
      await toggleRow('task-3');
      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(container.textContent).toContain('已選 1／3 筆');

      await clickButton('確認改派');

      expect(container.textContent).toContain('已選 2／2 筆');

      await clickButton('預覽');

      expect(sentTaskIds(2)).toEqual(['task-2', 'task-3']);
    });

    it('selects the other member tasks after switching members', async (): Promise<void> => {
      const OTHER: MemberProfileRecord = {
        ...MEMBER,
        memberId: 'member-other',
        name: '另一位',
      };

      api.listMemberOpenTasks
        .mockResolvedValueOnce(THREE)
        .mockResolvedValueOnce([
          { ...TASK, taskId: 'other-1' },
          { ...TASK, taskId: 'other-2' },
        ]);
      api.reassignMemberTasks.mockResolvedValueOnce([]);
      await render();
      await act(async (): Promise<void> => {
        root.render(
          <MemberTaskReassignModal member={OTHER} onClose={jest.fn()} />,
        );
      });

      expect(container.textContent).toContain('已選 2／2 筆');

      await chooseTargetAndReason();
      await clickButton('預覽');

      expect(sentTaskIds(0)).toEqual(['other-1', 'other-2']);
    });

    describe('while a request is in flight', (): void => {
      let finish: (results: TaskReassignmentResultRecord[]) => void;
      let onClose: jest.Mock;

      beforeEach(async (): Promise<void> => {
        finish = (): void => undefined;
        onClose = jest.fn();
        api.listMemberOpenTasks.mockResolvedValueOnce(THREE);
        api.reassignMemberTasks.mockImplementationOnce(
          (): Promise<TaskReassignmentResultRecord[]> =>
            new Promise((resolve): void => {
              finish = resolve;
            }),
        );
        await render(onClose);
        await chooseTargetAndReason();
        await clickButton('預覽');
      });

      afterEach(async (): Promise<void> => {
        await act(async (): Promise<void> => {
          finish([]);
        });
      });

      it('does not close through the cancel button or the dismiss path', async (): Promise<void> => {
        await clickButton('關閉');
        await clickButton('dismiss');

        expect(onClose).not.toHaveBeenCalled();
      });

      it('hides select-all and ignores row changes', async (): Promise<void> => {
        expect(selectAllCheckbox()).toBeNull();

        await toggleRow('task-1');

        expect(container.textContent).toContain('已選 3／3 筆');
      });

      it('closes again once the request has finished', async (): Promise<void> => {
        await act(async (): Promise<void> => {
          finish([]);
        });
        await clickButton('關閉');
        await clickButton('dismiss');

        expect(selectAllCheckbox()).not.toBeNull();
        expect(onClose).toHaveBeenCalledTimes(2);
      });
    });
  });
});
