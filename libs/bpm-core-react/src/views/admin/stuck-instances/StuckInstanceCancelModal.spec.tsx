import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { StuckApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import { StuckInstanceCancelModal } from './StuckInstanceCancelModal';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'tight' },
  FormFieldLayout: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
}));

jest.mock('@mezzanine-ui/react', () => {
  const Container = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => <div>{props.children as ReactNode}</div>;
  const Input = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <input
      disabled={Boolean(props.disabled)}
      name={props.name as string}
      onChange={props.onChange as () => void}
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

  return {
    FormField: Container,
    Input,
    Modal,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  adminCancelApprovalInstance: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

const INSTANCE: StuckApprovalInstanceRecord = {
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
  pendingActorMemberIds: ['member-1'],
  taskId: 'task-1',
  templateId: 'template-1',
  templateName: '採購',
};

describe('StuckInstanceCancelModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api.adminCancelApprovalInstance.mockReset();
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(
    handlers: {
      readonly onCancelled?: () => void;
      readonly onClose?: () => void;
    } = {},
  ): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <StuckInstanceCancelModal
          instance={INSTANCE}
          onCancelled={handlers.onCancelled ?? jest.fn()}
          onClose={handlers.onClose ?? jest.fn()}
        />,
      );
    });
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

  function reasonInput(): HTMLInputElement {
    const found = container.querySelector('input');

    if (!found) {
      throw new Error('reason input was not rendered');
    }

    return found;
  }

  async function click(name: string): Promise<void> {
    await act(async (): Promise<void> => {
      button(name).click();
    });
  }

  async function typeReason(value: string): Promise<void> {
    await act(async (): Promise<void> => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;

      setValue?.call(reasonInput(), value);
      reasonInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('shows the case title and warns that the applicant is told the reason', async (): Promise<void> => {
    await render();

    expect(container.textContent).toContain('採購申請');
    expect(container.textContent).toContain(
      '撤銷後無法復原。申請人會收到站內通知，內容含撤銷理由。',
    );
  });

  it('cannot confirm without a reason, a blank one included', async (): Promise<void> => {
    await render();

    expect(button('確認撤銷').disabled).toBe(true);

    await typeReason('   ');

    expect(button('確認撤銷').disabled).toBe(true);

    await click('確認撤銷');

    expect(api.adminCancelApprovalInstance).not.toHaveBeenCalled();
  });

  it('sends the instance id and the trimmed reason, then reports the cancellation', async (): Promise<void> => {
    const onCancelled = jest.fn();

    api.adminCancelApprovalInstance.mockResolvedValue(undefined);
    await render({ onCancelled });
    await typeReason('  下一關設定有誤  ');
    await click('確認撤銷');

    expect(api.adminCancelApprovalInstance).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      reason: '下一關設定有誤',
    });
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('shows the error inside the window and stays open when cancelling fails', async (): Promise<void> => {
    const onCancelled = jest.fn();
    const onClose = jest.fn();

    api.adminCancelApprovalInstance.mockRejectedValue(
      new Error('Instance is already approved'),
    );
    await render({ onCancelled, onClose });
    await typeReason('重複送單');
    await click('確認撤銷');

    expect(container.textContent).toContain('Instance is already approved');
    expect(onCancelled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(button('確認撤銷').disabled).toBe(false);
  });

  describe('while the cancellation is in flight', (): void => {
    let finish: () => void;
    let onClose: jest.Mock;

    beforeEach(async (): Promise<void> => {
      finish = (): void => undefined;
      onClose = jest.fn();
      api.adminCancelApprovalInstance.mockImplementationOnce(
        (): Promise<void> =>
          new Promise((resolve): void => {
            finish = resolve;
          }),
      );
      await render({ onClose });
      await typeReason('重複送單');
      await click('確認撤銷');
    });

    afterEach(async (): Promise<void> => {
      await act(async (): Promise<void> => {
        finish();
      });
    });

    it('does not close through the cancel button or the dismiss path', async (): Promise<void> => {
      await click('取消');
      await click('dismiss');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('locks the confirm button and the reason', (): void => {
      expect(button('確認撤銷').disabled).toBe(true);
      expect(reasonInput().disabled).toBe(true);
    });

    it('closes again once the request has finished', async (): Promise<void> => {
      await act(async (): Promise<void> => {
        finish();
      });
      await click('取消');
      await click('dismiss');

      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
