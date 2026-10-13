import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  listApprovalHistoryTasks,
  listApprovalInstances,
  listInboxTasks,
  readApprovalInstance,
  requestAdhocPreApproval,
  readFormDataCaseTitle,
  retryWorkflowWebhookDelivery,
  listWorkflowWebhookDeliveries,
} from './workflow-api';

interface CapturedRequest {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

function installFetchMock<TData>(payload: TData): {
  readonly capture: () => CapturedRequest;
  readonly restore: () => void;
} {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<
    Promise<Response>,
    [RequestInfo | URL, RequestInit?]
  >();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ data: payload }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
  );
  (global as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;

  return {
    capture: (): CapturedRequest => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1];
      return JSON.parse(String(init?.body ?? '{}')) as CapturedRequest;
    },
    restore: (): void => {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

describe('@rytass/bpm-core-client/workflow', () => {
  describe('listApprovalInstances', () => {
    it('issues the ApprovalInstances query with no variables', async (): Promise<void> => {
      const harness = installFetchMock({ approvalInstances: [] });
      try {
        const instances = await listApprovalInstances();
        const request = harness.capture();

        expect(request.query).toContain('query ApprovalInstances');
        expect(request.variables).toBeUndefined();
        expect(instances).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('readApprovalInstance', () => {
    it('passes id as a variable and unwraps the instance record', async (): Promise<void> => {
      const fixture = {
        approvalInstance: {
          completedAt: null,
          formDataJson: '{}',
          formDefinitionSnapshotJson: '{}',
          id: 'instance-1',
          initiatorMemberId: 'member-001',
          startedAt: '2026-05-26T00:00:00.000Z',
          state: 'RUNNING',
          templateId: 'template-1',
          templateVersionId: 'tv-1',
          title: 'Test instance',
          workflowSnapshotJson: '{}',
        },
        tasks: [],
        workflowTokens: [],
        activityLogs: [],
      };
      const harness = installFetchMock(fixture);
      try {
        const result = await readApprovalInstance('instance-1');
        const request = harness.capture();

        expect(request.query).toContain('query ApprovalInstance');
        expect(request.variables).toEqual({ id: 'instance-1' });
        expect(result.instance.id).toBe('instance-1');
        expect(result.tasks).toEqual([]);
        expect(result.workflowTokens).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('listInboxTasks', () => {
    it('passes assigneeMemberId as a variable and returns normalized tasks', async (): Promise<void> => {
      const harness = installFetchMock({
        inboxTasks: [
          {
            assigneeMemberId: 'member-001',
            assignmentType: 'DIRECT',
            candidateMemberIds: [],
            completedAt: null,
            createdAt: '2026-05-26T00:00:00.000Z',
            decisionPolicySnapshotJson: '{}',
            delegationChainJson: '[]',
            id: 'task-1',
            instanceId: 'instance-1',
            nodeId: 'node-1',
            openedAt: '2026-05-26T00:00:00.000Z',
            originalAssigneeMemberId: null,
            slaDueAt: null,
            status: 'OPEN',
            tokenId: 'token-1',
          },
        ],
      });
      try {
        const tasks = await listInboxTasks('member-001');
        const request = harness.capture();

        expect(request.query).toContain('inboxTasks(assigneeMemberId:');
        expect(request.variables).toEqual({ assigneeMemberId: 'member-001' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.assigneeMemberId).toBe('member-001');
      } finally {
        harness.restore();
      }
    });
  });

  describe('task node label', () => {
    const selectsNodeLabel = (query: string): boolean =>
      /\bnodeId\s+nodeLabel\b/.test(query);
    const task = {
      assigneeMemberId: 'member-001',
      id: 'task-1',
      nodeId: 'band-0',
      nodeLabel: '部門主管簽核',
    };

    it.each([
      [
        'readApprovalInstance',
        'tasks',
        async (): Promise<unknown> => readApprovalInstance('instance-1'),
        {
          approvalInstance: {
            formDataJson: '{}',
            formDefinitionSnapshotJson: '{}',
            id: 'instance-1',
            workflowSnapshotJson: '{}',
          },
          activityLogs: [],
          tasks: [task],
          workflowTokens: [],
        },
      ],
      [
        'listInboxTasks',
        'inboxTasks',
        async (): Promise<unknown> => listInboxTasks('member-001'),
        { inboxTasks: [task] },
      ],
      [
        'listApprovalHistoryTasks',
        'approvalHistoryTasks',
        async (): Promise<unknown> => listApprovalHistoryTasks('member-001'),
        { approvalHistoryTasks: [task] },
      ],
      [
        'requestAdhocPreApproval',
        'requestAdhocPreApproval',
        async (): Promise<unknown> =>
          requestAdhocPreApproval({
            onReject: 'REJECT_INSTANCE',
            target: { kind: 'MEMBER', memberIds: ['member-002'] },
            taskId: 'task-1',
          }),
        { requestAdhocPreApproval: task },
      ],
    ])(
      'selects nodeLabel next to nodeId in %s',
      async (_name, _field, call, payload): Promise<void> => {
        const harness = installFetchMock(payload);
        try {
          await call();

          expect(selectsNodeLabel(harness.capture().query)).toBe(true);
        } finally {
          harness.restore();
        }
      },
    );

    it('keeps nodeLabel on the normalized inbox records', async (): Promise<void> => {
      const harness = installFetchMock({ inboxTasks: [task] });
      try {
        const [first] = await listInboxTasks('member-001');

        expect(first?.nodeLabel).toBe('部門主管簽核');
      } finally {
        harness.restore();
      }
    });
  });

  describe('readFormDataCaseTitle', () => {
    const tableField: FormFieldDefinition = {
      columns: [
        { fieldKey: 'name', label: '品項', required: true, type: 'text' },
      ],
      fieldKey: 'items',
      label: '請購明細',
      required: true,
      type: 'table',
    };
    const textField: FormFieldDefinition = {
      fieldKey: 'reason',
      label: '事由',
      required: true,
      type: 'text',
    };

    // A row count is not a case title, so the table is skipped even when the
    // layout lists it first (ADR 16 §3.8).
    it('skips a table and titles the case with the first scalar field', (): void => {
      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { items: [{ name: 'Bolt' }], reason: '汰換' },
          schema: { fields: [tableField, textField], schemaVersion: 1 },
          uiSchema: {
            layout: [
              { fieldKey: 'items', width: 'FULL' },
              { fieldKey: 'reason', width: 'FULL' },
            ],
            schemaVersion: 1,
          },
        }),
      ).toBe('事由：汰換');
    });

    it('falls back when a table is the only field', (): void => {
      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { items: [{ name: 'Bolt' }] },
          schema: { fields: [tableField], schemaVersion: 1 },
          uiSchema: {
            layout: [{ fieldKey: 'items', width: 'FULL' }],
            schemaVersion: 1,
          },
        }),
      ).toBe('fallback');
    });
  });

  describe('workflow webhook deliveries', () => {
    const delivery = {
      attemptCount: 6,
      createdAt: '2026-09-15T10:00:00.000Z',
      endpointKey: 'demo.flaky',
      endpointLabel: '示範：不穩定',
      endpointVersion: 1,
      id: 'delivery-1',
      instanceId: 'instance-1',
      lastAttemptAt: '2026-09-15T10:05:00.000Z',
      lastErrorCode: 'WEBHOOK_HTTP_503',
      lastErrorDetail: 'unavailable',
      lastResponseStatus: 503,
      nextRetryAt: null,
      nodeId: 'notify',
      sentAt: null,
      status: 'FAILED',
      targetId: 'wh',
      updatedAt: '2026-09-15T10:05:00.000Z',
    };

    it("lists an instance's deliveries by id", async (): Promise<void> => {
      const harness = installFetchMock({
        workflowWebhookDeliveries: [delivery],
      });
      try {
        const deliveries = await listWorkflowWebhookDeliveries('instance-1');
        const request = harness.capture();

        expect(request.query).toContain('query WorkflowWebhookDeliveries');
        expect(request.query).toContain('endpointLabel');
        expect(request.variables).toEqual({ instanceId: 'instance-1' });
        expect(deliveries).toEqual([delivery]);
      } finally {
        harness.restore();
      }
    });

    it('answers an empty list when the host omits the field', async (): Promise<void> => {
      const harness = installFetchMock({});
      try {
        await expect(
          listWorkflowWebhookDeliveries('instance-1'),
        ).resolves.toEqual([]);
      } finally {
        harness.restore();
      }
    });

    it('retries a delivery and returns the re-queued row', async (): Promise<void> => {
      const queued = { ...delivery, attemptCount: 0, status: 'PENDING' };
      const harness = installFetchMock({
        retryWorkflowWebhookDelivery: queued,
      });
      try {
        const result = await retryWorkflowWebhookDelivery('delivery-1');
        const request = harness.capture();

        expect(request.query).toContain(
          'mutation RetryWorkflowWebhookDelivery',
        );
        expect(request.variables).toEqual({ id: 'delivery-1' });
        expect(result).toEqual(queued);
      } finally {
        harness.restore();
      }
    });
  });
});
