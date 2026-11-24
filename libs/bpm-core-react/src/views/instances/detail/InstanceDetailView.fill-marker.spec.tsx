import { act, forwardRef, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import * as workflowApi from '@rytass/bpm-core-client/workflow';
import type { InstanceFormSectionProps } from './sections/InstanceFormSection';
import { InstanceDetailView } from './InstanceDetailView';

// Only the fill-marker wiring of the page is under test here: every section
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

    return <span />;
  },
}));
jest.mock('@rytass/bpm-core-client/workflow', () => ({
  ...jest.requireActual('@rytass/bpm-core-client/workflow'),
  listAdhocDirectives: jest.fn(),
  listAttachments: jest.fn(),
  listWorkflowWebhookDeliveries: jest.fn(),
  readApprovalInstance: jest.fn(),
  readInstanceSignatures: jest.fn(),
  readRecallableTaskId: jest.fn(),
  resubmitApprovalInstance: jest.fn(),
}));

const formSectionProps: { current: InstanceFormSectionProps | null } = {
  current: null,
};
const api = workflowApi as jest.Mocked<typeof workflowApi>;

// Two nodes on mutually exclusive branches both fill `note`; the fallback is
// listed first in the definition.
const fillerNode = (id: string, label: string): unknown => ({
  data: {
    allowAddSigner: false,
    allowReject: true,
    allowTransfer: false,
    approverResolver: { memberIds: ['member-fin'], type: 'DIRECT' },
    decisionPolicy: { type: 'SINGLE' },
    fieldAccess: [{ display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' }],
    label,
    returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
  },
  id,
  position: { x: 0, y: 0 },
  type: 'userTask',
});

function runningInstance(): ApprovalInstanceRecord {
  return {
    formData: { reason: '出差' },
    formDefinitionSnapshot: { schema: null, uiSchema: null },
    id: 'instance-a',
    initiatorMemberId: 'member-001',
    startedAt: '2026-10-20T01:00:00.000Z',
    state: 'IN_PROGRESS',
    submittedByMemberId: 'member-001',
    title: '出差申請',
    workflowSnapshot: {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [
        fillerNode('station-finance-fallback', '站別財務（後備）'),
        fillerNode('station-finance-hsinchu', '新竹站別財務'),
      ],
    },
  } as unknown as ApprovalInstanceRecord;
}

describe('InstanceDetailView fill label markers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    formSectionProps.current = null;
    jest.clearAllMocks();
    api.listAdhocDirectives.mockResolvedValue([]);
    api.listAttachments.mockResolvedValue([]);
    api.listWorkflowWebhookDeliveries.mockResolvedValue([]);
    api.readRecallableTaskId.mockResolvedValue(null);
    api.readInstanceSignatures.mockResolvedValue({
      signatures: [],
      verification: null,
    } as unknown as Awaited<ReturnType<typeof api.readInstanceSignatures>>);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function renderCase(reachedNodeId: string | null): Promise<void> {
    api.readApprovalInstance.mockResolvedValue({
      activityLogs:
        reachedNodeId === null
          ? []
          : [
              {
                actorMemberId: null,
                createdAt: '2026-10-20T01:00:01.000Z',
                eventType: 'TASK_CREATED',
                id: 'log-1',
                nodeId: reachedNodeId,
                payloadJson: '{}',
                taskId: 'task-1',
              },
            ],
      instance: runningInstance(),
      tasks:
        reachedNodeId === null
          ? []
          : [
              {
                candidateMemberIds: ['member-fin'],
                id: 'task-1',
                instanceId: 'instance-a',
                isAdhoc: false,
                nodeId: reachedNodeId,
                status: 'PENDING',
              },
            ],
      workflowTokens: [],
    } as unknown as Awaited<ReturnType<typeof api.readApprovalInstance>>);
    await act(async (): Promise<void> => {
      root.render(<InstanceDetailView instanceId="instance-a" />);
    });
  }

  function markers(): Readonly<Record<string, string>> | undefined {
    if (!formSectionProps.current) {
      throw new Error('form section not rendered');
    }

    return formSectionProps.current.fieldLabelMarkers;
  }

  it('names the branch node the case reached', async (): Promise<void> => {
    await renderCase('station-finance-hsinchu');

    expect(markers()).toEqual({ note: '新竹站別財務補填' });
  });

  it('names the first filler before any of them is reached', async (): Promise<void> => {
    await renderCase(null);

    expect(markers()).toEqual({ note: '站別財務（後備）補填' });
  });
});
