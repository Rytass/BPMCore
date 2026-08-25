import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  listApprovalInstances,
  listInboxTasks,
  readApprovalInstance,
  readFormDataCaseTitle,
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

});
