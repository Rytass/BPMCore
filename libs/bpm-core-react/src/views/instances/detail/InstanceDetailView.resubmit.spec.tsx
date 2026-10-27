import { act, forwardRef, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { InstanceFormSectionProps } from './sections/InstanceFormSection';
import { InstanceDetailView } from './InstanceDetailView';

// Only the resubmission wiring of the page is under test here: every section
// is a stub, and the form section stub exposes the props the page passes it.
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

  return new Proxy(
    {},
    {
      get: (_target, key): unknown =>
        key === '__esModule' ? true : Passthrough,
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
  InstanceTasksSection: forwardRef((): null => null),
}));
jest.mock('./sections/InstanceFormSection', () => ({
  InstanceFormSection: (props: InstanceFormSectionProps): ReactElement => {
    formSectionProps.current = props;

    return <span data-comment={props.resubmitComment ?? ''} />;
  },
}));
jest.mock('@rytass/bpm-core-client/workflow', () => ({
  ...jest.requireActual('@rytass/bpm-core-client/workflow'),
  listAdhocDirectives: jest.fn(),
  listAttachments: jest.fn(),
  listWorkflowWebhookDeliveries: jest.fn(),
  readApprovalInstance: jest.fn(),
  readInstanceSignatures: jest.fn(),
  resubmitApprovalInstance: jest.fn(),
}));

const formSectionProps: { current: InstanceFormSectionProps | null } = {
  current: null,
};
const api = workflowApi as jest.Mocked<typeof workflowApi>;

function returnedInstance(id: string): ApprovalInstanceRecord {
  return {
    formData: { reason: '出差' },
    formDefinitionSnapshot: { schema: null, uiSchema: null },
    id,
    initiatorMemberId: 'member-001',
    startedAt: '2026-10-20T01:00:00.000Z',
    state: 'RETURNED',
    submittedByMemberId: 'member-001',
    title: '出差申請',
    workflowSnapshot: { edges: [], nodes: [] },
  } as unknown as ApprovalInstanceRecord;
}

describe('InstanceDetailView resubmission comment', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    formSectionProps.current = null;
    jest.clearAllMocks();
    api.readApprovalInstance.mockImplementation((id: string) =>
      Promise.resolve({
        activityLogs: [],
        instance: returnedInstance(id),
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
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function renderCase(instanceId: string): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<InstanceDetailView instanceId={instanceId} />);
    });
  }

  function formSection(): InstanceFormSectionProps {
    if (!formSectionProps.current) {
      throw new Error('form section not rendered');
    }

    return formSectionProps.current;
  }

  async function typeAndResubmit(comment: string): Promise<void> {
    act((): void => formSection().onResubmitCommentChange?.(comment));
    await act(async (): Promise<void> => {
      formSection().onResubmitInstance();
    });
  }

  it('sends the comment with the resubmission and clears it afterwards', async (): Promise<void> => {
    api.resubmitApprovalInstance.mockResolvedValue(undefined);
    await renderCase('instance-a');

    expect(formSection().canResubmitInstance).toBe(true);

    await typeAndResubmit('已補上報價單');

    expect(api.resubmitApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: '已補上報價單',
        instanceId: 'instance-a',
      }),
    );
    expect(formSection().resubmitComment).toBe('');
  });

  it('keeps the comment when the resubmission fails', async (): Promise<void> => {
    api.resubmitApprovalInstance.mockRejectedValue(new Error('server down'));
    await renderCase('instance-a');

    await typeAndResubmit('已補上報價單');

    expect(formSection().resubmitComment).toBe('已補上報價單');
  });

  it('does not carry a draft over to another case', async (): Promise<void> => {
    await renderCase('instance-a');
    act((): void => formSection().onResubmitCommentChange?.('A 的說明'));
    await renderCase('instance-b');

    expect(formSection().resubmitComment).toBe('');
  });
});
