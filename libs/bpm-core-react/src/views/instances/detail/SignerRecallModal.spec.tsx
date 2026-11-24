import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import { BPMGraphQLRequestError } from '@rytass/bpm-core-client';
import { SIGNER_RECALL_ERROR_CODES } from '@rytass/bpm-core-shared/status';
import { SignerRecallModal } from './SignerRecallModal';

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
      // The real Input spreads `inputProps` onto its native <input> too.
      {...(props.inputProps as Readonly<Record<string, unknown>> | undefined)}
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
      <span role={props.role as string | undefined}>
        {props.children as ReactNode}
      </span>
    ),
  };
});

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  recallTaskApproval: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

const GENERIC_MESSAGE = '取回失敗，請重新整理後再試。';

function refusal(code: string, message: string): BPMGraphQLRequestError {
  return new BPMGraphQLRequestError(message, [], code);
}

describe('SignerRecallModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api.recallTaskApproval.mockReset();
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(
    handlers: {
      readonly onClose?: (refused: boolean) => void;
      readonly onRecalled?: () => void;
      readonly taskId?: string | null;
    } = {},
  ): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <SignerRecallModal
          onClose={handlers.onClose ?? jest.fn()}
          onRecalled={handlers.onRecalled ?? jest.fn()}
          taskId={handlers.taskId === undefined ? 'task-1' : handlers.taskId}
        />,
      );
    });
  }

  function button(name: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (candidate): boolean => candidate.textContent === name,
    );

    if (!found) {
      throw new Error(`button ${name} was not rendered`);
    }

    return found;
  }

  function commentInput(): HTMLInputElement {
    const found = container.querySelector('input');

    if (!found) {
      throw new Error('comment input was not rendered');
    }

    return found;
  }

  // The error line, or null when there is none. The window marks it
  // `role="alert"`, so these tests find it without depending on where it sits
  // or on any particular sentence.
  function errorText(): string | null {
    return container.querySelector('[role="alert"]')?.textContent ?? null;
  }

  async function click(name: string): Promise<void> {
    await act(async (): Promise<void> => {
      button(name).click();
    });
  }

  async function typeComment(value: string): Promise<void> {
    await act(async (): Promise<void> => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;

      setValue?.call(commentInput(), value);
      commentInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('renders nothing while there is no task to recall', async (): Promise<void> => {
    await render({ taskId: null });

    expect(container.textContent).toBe('');
  });

  it('explains what a recall does before it is confirmed', async (): Promise<void> => {
    await render();

    expect(container.textContent).toContain(
      '取回後，下一關的待簽任務會取消，這張單會回到你這一關重新簽核。已寄出的通知無法收回。',
    );
  });

  it('caps the reason at the length the server accepts', async (): Promise<void> => {
    await render();

    expect(commentInput().maxLength).toBe(2000);
  });

  it('sends the task id and the reason, then reports the recall', async (): Promise<void> => {
    const onRecalled = jest.fn();

    api.recallTaskApproval.mockResolvedValue(undefined);
    await render({ onRecalled });
    await typeComment('附件放錯了');
    await click('確認取回');

    expect(api.recallTaskApproval).toHaveBeenCalledWith({
      comment: '附件放錯了',
      taskId: 'task-1',
    });
    expect(onRecalled).toHaveBeenCalledTimes(1);
  });

  it('recalls without a reason, since the reason is optional', async (): Promise<void> => {
    api.recallTaskApproval.mockResolvedValue(undefined);
    await render();

    expect(button('確認取回').disabled).toBe(false);

    await click('確認取回');

    expect(api.recallTaskApproval).toHaveBeenCalledWith({
      comment: '',
      taskId: 'task-1',
    });
  });

  it('sends one recall when confirm is pressed twice before it re-renders', async (): Promise<void> => {
    api.recallTaskApproval.mockResolvedValue(undefined);
    await render();
    await act(async (): Promise<void> => {
      button('確認取回').click();
      button('確認取回').click();
    });

    expect(api.recallTaskApproval).toHaveBeenCalledTimes(1);
  });

  it('closes without a reload when nothing was refused', async (): Promise<void> => {
    const onClose = jest.fn();

    await render({ onClose });
    await click('先不要');
    await click('dismiss');

    expect(onClose.mock.calls).toEqual([[false], [false]]);
  });

  describe('when the server refuses with a code', (): void => {
    let onClose: jest.Mock;
    let onRecalled: jest.Mock;

    beforeEach(async (): Promise<void> => {
      onClose = jest.fn();
      onRecalled = jest.fn();
      api.recallTaskApproval.mockRejectedValue(
        refusal(
          SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_ACTED,
          'The next stage has already been acted on',
        ),
      );
      await render({ onClose, onRecalled });
      await click('確認取回');
    });

    it('shows a Chinese sentence for the code, never the server message or the code', (): void => {
      // A sentence of its own, not the fallback one.
      expect(errorText()).toMatch(/[\u4e00-\u9fff]/);
      expect(errorText()).not.toBe(GENERIC_MESSAGE);
      expect(container.textContent).not.toContain('The next stage');
      expect(container.textContent).not.toContain('SIGNER_RECALL');
      expect(container.textContent).not.toContain('[');
      expect(container.textContent).not.toContain(']');
    });

    it('stays open and turns the confirm button off', async (): Promise<void> => {
      expect(onClose).not.toHaveBeenCalled();
      expect(onRecalled).not.toHaveBeenCalled();
      expect(button('確認取回').disabled).toBe(true);

      await click('確認取回');

      expect(api.recallTaskApproval).toHaveBeenCalledTimes(1);
    });

    it('tells the page to reload once the window is closed', async (): Promise<void> => {
      await click('先不要');

      expect(onClose).toHaveBeenCalledWith(true);
    });
  });

  it('has a sentence for every code the server can refuse with', async (): Promise<void> => {
    const codes = Object.values(SIGNER_RECALL_ERROR_CODES);

    expect(codes).toHaveLength(12);

    const sentences = new Set<string>();

    for (const code of codes) {
      api.recallTaskApproval.mockReset();
      api.recallTaskApproval.mockRejectedValue(refusal(code, 'English prose'));
      // A fresh task id each round starts from a blank window.
      await render({ taskId: `task-${code}` });
      await click('確認取回');

      const message = errorText();

      expect(message).not.toBeNull();
      expect(message).not.toBe(GENERIC_MESSAGE);
      expect(container.textContent).not.toContain(GENERIC_MESSAGE);
      expect(container.textContent).not.toContain('English prose');
      // The server named this approval as not recallable, so pressing the
      // confirm button again would only bring the same code back.
      expect(button('確認取回').disabled).toBe(true);
      sentences.add(message ?? '');
    }

    // Every code reads differently: no two share a sentence by accident.
    expect(sentences.size).toBe(12);
  });

  it('treats a code it does not know as a refusal all the same', async (): Promise<void> => {
    const onClose = jest.fn();

    api.recallTaskApproval.mockRejectedValue(
      refusal('SIGNER_RECALL_SOMETHING_NEW', 'A code from a newer server'),
    );
    await render({ onClose });
    await click('確認取回');

    expect(container.textContent).toContain(GENERIC_MESSAGE);
    expect(container.textContent).not.toContain('newer server');
    expect(button('確認取回').disabled).toBe(true);

    await click('先不要');

    expect(onClose).toHaveBeenCalledWith(true);
  });

  describe('when the failure carries no code', (): void => {
    let onClose: jest.Mock;

    beforeEach(async (): Promise<void> => {
      onClose = jest.fn();
      api.recallTaskApproval.mockRejectedValue(new Error('Failed to fetch'));
      await render({ onClose });
      await click('確認取回');
    });

    it('shows the generic sentence and keeps the confirm button usable', (): void => {
      expect(container.textContent).toContain(GENERIC_MESSAGE);
      expect(container.textContent).not.toContain('Failed to fetch');
      expect(button('確認取回').disabled).toBe(false);
    });

    it('can be retried', async (): Promise<void> => {
      await click('確認取回');

      expect(api.recallTaskApproval).toHaveBeenCalledTimes(2);
    });

    it('still tells the page to reload once the window is closed', async (): Promise<void> => {
      await click('先不要');

      expect(onClose).toHaveBeenCalledWith(true);
    });
  });

  it('starts blank for another task after a refusal, flags included', async (): Promise<void> => {
    const onClose = jest.fn();

    api.recallTaskApproval.mockRejectedValue(
      refusal(SIGNER_RECALL_ERROR_CODES.PASSED_JOIN, 'Passed a join'),
    );
    await render({ onClose, taskId: 'task-a' });
    await typeComment('A 的原因');
    await click('確認取回');

    expect(button('確認取回').disabled).toBe(true);

    await render({ onClose, taskId: 'task-b' });

    expect(commentInput().value).toBe('');
    expect(errorText()).toBeNull();
    expect(button('確認取回').disabled).toBe(false);

    await click('先不要');

    expect(onClose).toHaveBeenCalledWith(false);
  });

  // A result for a task that is no longer on screen must not land on the one
  // that is.
  describe('when the window moves to another task while a recall is in flight', (): void => {
    let settle: (outcome: 'recalled' | Error) => void;
    let onClose: jest.Mock;
    let onRecalled: jest.Mock;

    beforeEach(async (): Promise<void> => {
      onClose = jest.fn();
      onRecalled = jest.fn();
      settle = (): void => undefined;
      api.recallTaskApproval.mockImplementationOnce(
        (): Promise<void> =>
          new Promise((resolve, reject): void => {
            settle = (outcome): void =>
              outcome === 'recalled' ? resolve() : reject(outcome);
          }),
      );
      await render({ onClose, onRecalled, taskId: 'task-a' });
      await click('確認取回');
      await render({ onClose, onRecalled, taskId: 'task-b' });
    });

    it('does not carry a refusal of the first task onto the second', async (): Promise<void> => {
      await act(async (): Promise<void> => {
        settle(refusal(SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_ACTED, 'Acted on'));
      });

      expect(errorText()).toBeNull();
      expect(button('確認取回').disabled).toBe(false);

      await click('先不要');

      expect(onClose).toHaveBeenCalledWith(false);
      expect(onRecalled).not.toHaveBeenCalled();
    });

    it('does not report the recall of the first task as a recall of the second', async (): Promise<void> => {
      await act(async (): Promise<void> => {
        settle('recalled');
      });

      expect(onRecalled).not.toHaveBeenCalled();
      expect(errorText()).toBeNull();
      expect(button('確認取回').disabled).toBe(false);
    });

    it('lets the second task send its own recall', async (): Promise<void> => {
      api.recallTaskApproval.mockResolvedValue(undefined);
      await act(async (): Promise<void> => {
        settle(new Error('Failed to fetch'));
      });
      await click('確認取回');

      expect(api.recallTaskApproval).toHaveBeenLastCalledWith({
        comment: '',
        taskId: 'task-b',
      });
      expect(onRecalled).toHaveBeenCalledTimes(1);
    });
  });

  describe('while the recall is in flight', (): void => {
    let finish: () => void;
    let onClose: jest.Mock;

    beforeEach(async (): Promise<void> => {
      finish = (): void => undefined;
      onClose = jest.fn();
      api.recallTaskApproval.mockImplementationOnce(
        (): Promise<void> =>
          new Promise((resolve): void => {
            finish = resolve;
          }),
      );
      await render({ onClose });
      await click('確認取回');
    });

    afterEach(async (): Promise<void> => {
      await act(async (): Promise<void> => {
        finish();
      });
    });

    it('does not close through the cancel button or the dismiss path', async (): Promise<void> => {
      await click('先不要');
      await click('dismiss');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('locks the confirm button and the reason', (): void => {
      expect(button('確認取回').disabled).toBe(true);
      expect(commentInput().disabled).toBe(true);
    });
  });
});
