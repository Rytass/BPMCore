import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import { InstanceDetailView } from './InstanceDetailView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Only the signer recall wiring of the page is under test here: every section
// is a stub, `Button` is a real button so it can be pressed and disabled, and
// the recall window and the tasks section are stubs whose handlers can be
// pressed. The window itself is covered by SignerRecallModal.spec.tsx.
jest.mock('@xyflow/react', () => ({
  Background: (): null => null,
  Controls: (): null => null,
  Handle: (): null => null,
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  ReactFlow: (): null => null,
}));
jest.mock('@xyflow/react/dist/style.css', () => ({}));
jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'TIGHT' },
  FormFieldLayout: { HORIZONTAL: 'HORIZONTAL' },
}));
jest.mock('@mezzanine-ui/core/table', () => ({}));
jest.mock('@mezzanine-ui/react', () => {
  function Passthrough(
    props: Readonly<{ children?: ReactNode }>,
  ): ReactElement {
    return <>{props.children}</>;
  }

  function Button(
    props: Readonly<{
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }>,
  ): ReactElement {
    return (
      <button
        disabled={Boolean(props.disabled)}
        onClick={props.onClick}
        type="button"
      >
        {props.children}
      </button>
    );
  }

  return new Proxy(
    {},
    {
      get: (_target, key): unknown =>
        key === '__esModule' ? true : key === 'Button' ? Button : Passthrough,
    },
  );
});
jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<{ children?: ReactNode }>): ReactElement => (
    <>{props.children}</>
  ),
}));
jest.mock('../../../lib/auth-provider', () => ({
  useAuth: (): unknown => ({
    member: { memberId: 'member-001', name: '申請人', roles: [] },
  }),
}));
jest.mock('../../../components/pdf-preview', () => ({
  PDFPreview: (): null => null,
}));
jest.mock('./sections/container-helpers', () => ({
  ...jest.requireActual('./sections/container-helpers'),
  readMemberProfilesForTimeline: jest.fn(() => Promise.resolve([])),
  readTaskDecisionsForTasks: jest.fn(() => Promise.resolve([])),
}));
jest.mock('./sections/InstanceAttachmentsSection', () => ({
  InstanceAttachmentsSection: (): null => null,
}));
jest.mock('./sections/InstanceSignaturesSection', () => ({
  InstanceSignaturesSection: (): null => null,
}));
jest.mock('./sections/InstanceHistorySection', () => ({
  InstanceHistorySection: (): null => null,
}));
jest.mock('./sections/InstanceWebhookDeliveriesSection', () => ({
  InstanceWebhookDeliveriesSection: (): null => null,
}));
jest.mock('./sections/InstanceTasksSection', () => ({
  // React 19 hands `ref` to a plain function component as a prop, so the
  // page's `ref={tasksSectionRef}` needs no `forwardRef` here.
  InstanceTasksSection: (
    props: Readonly<{ onChanged: () => void }>,
  ): ReactElement => (
    <button onClick={props.onChanged} type="button">
      stub-tasks-changed
    </button>
  ),
}));
jest.mock('./sections/InstanceFormSection', () => ({
  InstanceFormSection: (
    props: Readonly<{ error?: string | null }>,
  ): ReactElement => (
    <span data-error={props.error ?? ''} data-testid="form-section" />
  ),
}));
jest.mock('./SignerRecallModal', () => ({
  SignerRecallModal: (
    props: Readonly<{
      onClose: (refused: boolean) => void;
      onRecalled: () => void;
      taskId: string | null;
    }>,
  ): ReactElement | null =>
    props.taskId ? (
      <div data-task-id={props.taskId} data-testid="recall-window">
        <button onClick={props.onRecalled} type="button">
          stub-recalled
        </button>
        <button onClick={(): void => props.onClose(true)} type="button">
          stub-close-refused
        </button>
        <button onClick={(): void => props.onClose(false)} type="button">
          stub-close-quiet
        </button>
      </div>
    ) : null,
}));
jest.mock('@rytass/bpm-core-client/workflow', () => ({
  ...jest.requireActual('@rytass/bpm-core-client/workflow'),
  listAdhocDirectives: jest.fn(),
  listAttachments: jest.fn(),
  listWorkflowWebhookDeliveries: jest.fn(),
  readApprovalInstance: jest.fn(),
  readInstanceSignatures: jest.fn(),
  readRecallableTaskId: jest.fn(),
}));

const api = workflowApi as jest.Mocked<typeof workflowApi>;

function signedInstance(id: string): ApprovalInstanceRecord {
  return {
    formData: { reason: '出差' },
    formDefinitionSnapshot: { schema: null, uiSchema: null },
    id,
    initiatorMemberId: 'member-001',
    startedAt: '2026-10-20T01:00:00.000Z',
    state: 'RUNNING',
    submittedByMemberId: 'member-001',
    title: '出差申請',
    workflowSnapshot: { edges: [], nodes: [] },
  } as unknown as ApprovalInstanceRecord;
}

describe('InstanceDetailView signer recall', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Not `resetAllMocks`: that would also empty the helper stubs above.
    jest.clearAllMocks();
    api.readRecallableTaskId.mockReset();
    api.readApprovalInstance.mockImplementation(
      (id: string): ReturnType<typeof api.readApprovalInstance> =>
        Promise.resolve({
          activityLogs: [],
          instance: signedInstance(id),
          tasks: [],
          workflowTokens: [],
        } as unknown as Awaited<ReturnType<typeof api.readApprovalInstance>>),
    );
    api.listAdhocDirectives.mockResolvedValue([]);
    api.listAttachments.mockResolvedValue([]);
    api.listWorkflowWebhookDeliveries.mockResolvedValue([]);
    api.readInstanceSignatures.mockResolvedValue({
      signatures: [],
      verification: null,
    } as unknown as Awaited<ReturnType<typeof api.readInstanceSignatures>>);
    api.readRecallableTaskId.mockResolvedValue(null);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function renderCase(instanceId = 'instance-a'): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<InstanceDetailView instanceId={instanceId} />);
    });
  }

  function findButton(name: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(
      (candidate): boolean => candidate.textContent === name,
    );
  }

  function button(name: string): HTMLButtonElement {
    const found = findButton(name);

    if (!found) {
      throw new Error(`button ${name} was not rendered`);
    }

    return found;
  }

  async function click(name: string): Promise<void> {
    await act(async (): Promise<void> => {
      button(name).click();
    });
  }

  function recallWindow(): HTMLElement | null {
    return container.querySelector('[data-testid="recall-window"]');
  }

  it('offers the recall when the server names a task to take back', async (): Promise<void> => {
    api.readRecallableTaskId.mockResolvedValue('task-1');
    await renderCase();

    expect(findButton('取回重辦')).toBeDefined();
    expect(api.readRecallableTaskId).toHaveBeenCalledWith('instance-a');
  });

  it('does not offer the recall when there is nothing to take back', async (): Promise<void> => {
    await renderCase();

    expect(api.readRecallableTaskId).toHaveBeenCalledTimes(1);
    expect(findButton('取回重辦')).toBeUndefined();
  });

  it('hides the button and shows no error when the server does not know the query', async (): Promise<void> => {
    api.readRecallableTaskId.mockRejectedValue(
      new Error('Cannot query field "recallableTaskId" on type "Query"'),
    );
    await renderCase();

    expect(findButton('取回重辦')).toBeUndefined();
    expect(
      container
        .querySelector('[data-testid="form-section"]')
        ?.getAttribute('data-error'),
    ).toBe('');
    expect(container.textContent).not.toContain('recallableTaskId');
    expect(container.textContent).toContain('stub-tasks-changed');
  });

  it('shows the button as soon as an approval made in the tasks section can be taken back', async (): Promise<void> => {
    api.readRecallableTaskId
      .mockResolvedValueOnce(null)
      .mockResolvedValue('task-1');
    await renderCase();

    expect(findButton('取回重辦')).toBeUndefined();

    await click('stub-tasks-changed');

    expect(findButton('取回重辦')).toBeDefined();
  });

  it('opens the window for the task that was offered when the button was pressed', async (): Promise<void> => {
    api.readRecallableTaskId
      .mockResolvedValueOnce('task-1')
      .mockResolvedValue('task-2');
    await renderCase();

    expect(recallWindow()).toBeNull();

    await click('取回重辦');

    expect(recallWindow()?.getAttribute('data-task-id')).toBe('task-1');

    // A reload behind the window offers another task; the window keeps the
    // one that was pressed.
    await click('stub-tasks-changed');

    expect(recallWindow()?.getAttribute('data-task-id')).toBe('task-1');
  });

  it('closes the window and reloads, asking again what can be taken back, after a recall', async (): Promise<void> => {
    api.readRecallableTaskId
      .mockResolvedValueOnce('task-1')
      .mockResolvedValue(null);
    await renderCase();
    await click('取回重辦');
    await click('stub-recalled');

    expect(recallWindow()).toBeNull();
    expect(api.readApprovalInstance).toHaveBeenCalledTimes(2);
    expect(api.readRecallableTaskId).toHaveBeenCalledTimes(2);
    expect(findButton('取回重辦')).toBeUndefined();
  });

  it('reloads when the window is closed after a refusal', async (): Promise<void> => {
    api.readRecallableTaskId
      .mockResolvedValueOnce('task-1')
      .mockResolvedValue(null);
    await renderCase();
    await click('取回重辦');
    await click('stub-close-refused');

    expect(recallWindow()).toBeNull();
    expect(api.readApprovalInstance).toHaveBeenCalledTimes(2);
    expect(api.readRecallableTaskId).toHaveBeenCalledTimes(2);
    expect(findButton('取回重辦')).toBeUndefined();
  });

  it('only closes the window, without a reload, when nothing was refused', async (): Promise<void> => {
    api.readRecallableTaskId.mockResolvedValue('task-1');
    await renderCase();
    await click('取回重辦');
    await click('stub-close-quiet');

    expect(recallWindow()).toBeNull();
    expect(api.readApprovalInstance).toHaveBeenCalledTimes(1);
    expect(api.readRecallableTaskId).toHaveBeenCalledTimes(1);
    expect(findButton('取回重辦')).toBeDefined();
  });
});
