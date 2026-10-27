import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  decideTask,
  listApprovalHistoryTasks,
  listApprovalInstances,
  listApprovalInstancesPage,
  listInboxTasks,
  listMemberOpenTasks,
  reassignMemberTasks,
  reassignTask,
  readApprovalInstance,
  requestAdhocPreApproval,
  resubmitApprovalInstance,
  readFormDataCaseTitle,
  retryWorkflowWebhookDelivery,
  listWorkflowWebhookDeliveries,
  readLaunchContext,
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
        expect(request.query).toContain('submittedByMemberId');
        expect(request.variables).toBeUndefined();
        expect(instances).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('listApprovalInstancesPage', () => {
    it('selects submittedByMemberId on the paged list too', async (): Promise<void> => {
      const originalFetch = global.fetch;
      const queries: string[] = [];

      (global as { fetch: typeof fetch }).fetch = jest.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          queries.push(
            (JSON.parse(String(init?.body)) as { query: string }).query,
          );

          return new Response(
            JSON.stringify({
              data: {
                approvalInstancePageInfo: {
                  hasNextPage: false,
                  hasPreviousPage: false,
                  page: 1,
                  pageSize: 10,
                  totalCount: 0,
                  totalPages: 1,
                },
                approvalInstances: [],
              },
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            },
          );
        },
      ) as unknown as typeof fetch;

      try {
        await listApprovalInstancesPage({
          page: 1,
          pageSize: 10,
          searchText: null,
          state: null,
          templateId: null,
          view: 'SENT',
        });

        const listQuery = queries.find((query) =>
          query.includes('query ApprovalInstancesPage('),
        );

        expect(listQuery).toContain('submittedByMemberId');
      } finally {
        (global as { fetch: typeof fetch }).fetch = originalFetch;
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
          submittedByMemberId: 'member-assistant',
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
        expect(request.query).toContain('submittedByMemberId');
        expect(request.variables).toEqual({ id: 'instance-1' });
        expect(result.instance.id).toBe('instance-1');
        expect(result.instance.submittedByMemberId).toBe('member-assistant');
        expect(result.tasks).toEqual([]);
        expect(result.workflowTokens).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('form data fingerprint', () => {
    it('reads the form data fingerprint with an instance', async (): Promise<void> => {
      const harness = installFetchMock({
        approvalInstance: {
          formDataFingerprint: 'fingerprint-1',
          formDataJson: '{}',
          formDefinitionSnapshotJson: '{}',
          id: 'instance-1',
          workflowSnapshotJson: '{}',
        },
        activityLogs: [],
        tasks: [],
        workflowTokens: [],
      });
      try {
        const result = await readApprovalInstance('instance-1');
        const request = harness.capture();

        expect(request.query).toContain('formDataFingerprint');
        expect(result.instance.formDataFingerprint).toBe('fingerprint-1');
      } finally {
        harness.restore();
      }
    });
  });

  describe('resubmitApprovalInstance comment', () => {
    const base = {
      formData: { amount: 10 },
      initiatorMemberId: 'member-001',
      instanceId: 'instance-1',
      title: null,
    };
    const result = { resubmitApprovalInstance: { id: 'instance-1', state: 'RUNNING' } };

    it('sends the comment the applicant wrote', async (): Promise<void> => {
      const harness = installFetchMock(result);
      try {
        await resubmitApprovalInstance({ ...base, comment: '已補上報價單' });

        const input = harness.capture().variables?.['input'] as Record<
          string,
          unknown
        >;

        expect(input).toEqual({
          comment: '已補上報價單',
          formDataJson: '{"amount":10}',
          initiatorMemberId: 'member-001',
          instanceId: 'instance-1',
          title: null,
        });
      } finally {
        harness.restore();
      }
    });

    // Leaving the key out keeps the request valid against a server that
    // predates the field.
    it.each([
      ['no comment is given', undefined],
      ['the comment is null', null],
      ['the comment is blank', '   '],
    ])(
      'omits comment when %s',
      async (_label, comment): Promise<void> => {
        const harness = installFetchMock(result);
        try {
          await resubmitApprovalInstance({ ...base, comment });

          const input = harness.capture().variables?.['input'] as Record<
            string,
            unknown
          >;

          expect(Object.keys(input).sort()).toEqual([
            'formDataJson',
            'initiatorMemberId',
            'instanceId',
            'title',
          ]);
        } finally {
          harness.restore();
        }
      },
    );
  });

  describe('decideTask fill', () => {
    const decision = {
      action: 'APPROVED',
      comment: null,
      decidedAt: '2026-05-26T00:00:00.000Z',
      decidedByMemberId: 'member-001',
      id: 'decision-1',
      returnToNodeId: null,
      signatureId: 'signature-1',
      taskId: 'task-1',
      transferToMemberId: null,
    };
    const base = {
      action: 'APPROVED' as const,
      comment: null,
      decidedByMemberId: 'member-001',
      taskId: 'task-1',
    };

    it('sends filled form data and the fingerprint with a decision', async (): Promise<void> => {
      const harness = installFetchMock({ decideTask: decision });
      try {
        await decideTask({
          ...base,
          fill: {
            expectedFormDataFingerprint: 'fingerprint-1',
            formData: { amount: 10, note: 'ok' },
          },
        });

        const input = harness.capture().variables?.['input'] as Record<
          string,
          unknown
        >;

        expect(input['formDataJson']).toBe('{"amount":10,"note":"ok"}');
        expect(input['expectedFormDataFingerprint']).toBe('fingerprint-1');
        expect(input['taskId']).toBe('task-1');
      } finally {
        harness.restore();
      }
    });

    it.each([
      ['no fill is given', undefined],
      ['fill is null', null],
      [
        'fill.formData is empty',
        { expectedFormDataFingerprint: 'fingerprint-1', formData: {} },
      ],
    ])(
      'omits formDataJson and the fingerprint when %s',
      async (_label, fill): Promise<void> => {
        const harness = installFetchMock({ decideTask: decision });
        try {
          await decideTask({ ...base, fill });

          const input = harness.capture().variables?.['input'] as Record<
            string,
            unknown
          >;

          expect(Object.keys(input)).not.toContain('formDataJson');
          expect(Object.keys(input)).not.toContain(
            'expectedFormDataFingerprint',
          );
          expect(input['taskId']).toBe('task-1');
        } finally {
          harness.restore();
        }
      },
    );
  });

  describe('readLaunchContext', () => {
    it('reads the current version workflow definition into the launch context', async (): Promise<void> => {
      const originalFetch = global.fetch;
      const queries: { query: string; variables?: Record<string, unknown> }[] =
        [];
      const definition = {
        edges: [],
        nodes: [{ id: 'start', type: 'start' }],
      };

      (global as { fetch: typeof fetch }).fetch = jest.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            query: string;
            variables?: Record<string, unknown>;
          };

          queries.push(body);

          const data = body.query.includes('query LaunchTemplate(')
            ? {
                approvalTemplate: {
                  currentVersionId: 'tv-1',
                  id: 'template-1',
                  name: 'Template',
                },
                approvalTemplateVersions: [
                  {
                    formDefinitionVersionId: 'fv-1',
                    id: 'tv-1',
                    status: 'PUBLISHED',
                    version: 3,
                  },
                ],
                launchableApprovalTemplates: [
                  {
                    currentVersionId: 'tv-1',
                    id: 'template-1',
                    name: 'Template',
                    updatedAt: '2026-05-26T00:00:00.000Z',
                  },
                ],
              }
            : {
                approvalTemplateVersion: {
                  workflowDefinitionJson: JSON.stringify(definition),
                },
                formDefinitionVersion: {
                  id: 'fv-1',
                  schemaJson: '{"fields":[]}',
                  uiSchemaJson: '{}',
                  version: 2,
                },
              };

          return new Response(JSON.stringify({ data }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          });
        },
      ) as unknown as typeof fetch;

      try {
        const context = await readLaunchContext('template-1');
        const formQuery = queries.find((request) =>
          request.query.includes('query LaunchFormVersion('),
        );

        expect(formQuery?.query).toContain('approvalTemplateVersion(id:');
        expect(formQuery?.query).toContain('workflowDefinitionJson');
        expect(formQuery?.variables).toEqual({
          formVersionId: 'fv-1',
          templateVersionId: 'tv-1',
        });
        expect(context.templateVersion.id).toBe('tv-1');
        expect(context.templateVersion.workflowDefinition).toEqual(definition);
      } finally {
        (global as { fetch: typeof fetch }).fetch = originalFetch;
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
        async (): Promise<unknown> => listInboxTasks('member-001'),
        { inboxTasks: [task] },
      ],
      [
        'listApprovalHistoryTasks',
        async (): Promise<unknown> => listApprovalHistoryTasks('member-001'),
        { approvalHistoryTasks: [task] },
      ],
      [
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
      async (_name, call, payload): Promise<void> => {
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

  describe('administrator task reassignment', () => {
    it('lists a member open tasks with the member id as a variable', async (): Promise<void> => {
      const harness = installFetchMock({ memberOpenTasks: [] });
      try {
        const rows = await listMemberOpenTasks('member-from');
        const request = harness.capture();

        expect(request.query).toContain('query MemberOpenTasks');
        expect(request.query).toContain('memberRole');
        expect(request.variables).toEqual({ memberId: 'member-from' });
        expect(rows).toEqual([]);
      } finally {
        harness.restore();
      }
    });

    it('sends a single reassignment with dryRun off unless asked', async (): Promise<void> => {
      const result = {
        errorCode: null,
        instanceId: 'instance-1',
        message: null,
        nodeId: 'task_finance',
        outcome: 'REASSIGNED',
        taskId: 'task-1',
      };
      const harness = installFetchMock({ reassignTask: result });
      try {
        const returned = await reassignTask({
          fromMemberId: 'member-from',
          reason: '離職',
          taskId: 'task-1',
          toMemberId: 'member-to',
        });
        const request = harness.capture();

        expect(request.query).toContain('mutation ReassignTask');
        expect(request.variables).toEqual({
          input: {
            dryRun: false,
            fromMemberId: 'member-from',
            reason: '離職',
            taskId: 'task-1',
            toMemberId: 'member-to',
          },
        });
        expect(returned).toEqual(result);
      } finally {
        harness.restore();
      }
    });

    it('returns one result per task for a member-wide reassignment preview', async (): Promise<void> => {
      const results = [
        {
          errorCode: 'TARGET_ALREADY_ON_TASK',
          instanceId: 'instance-1',
          message: '接手人已在此任務的待簽名單上',
          nodeId: 'task_finance',
          outcome: 'REJECTED',
          taskId: 'task-2',
        },
      ];
      const harness = installFetchMock({ reassignMemberTasks: results });
      try {
        const returned = await reassignMemberTasks({
          dryRun: true,
          fromMemberId: 'member-from',
          reason: '離職',
          toMemberId: 'member-to',
        });
        const request = harness.capture();

        expect(request.query).toContain('mutation ReassignMemberTasks');
        expect(request.variables).toEqual({
          input: {
            dryRun: true,
            fromMemberId: 'member-from',
            reason: '離職',
            toMemberId: 'member-to',
          },
        });
        expect(returned).toEqual(results);
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

    it('never titles a case with a hidden field', (): void => {
      const hiddenField: FormFieldDefinition = {
        fieldKey: 'sourceDocId',
        hidden: true,
        label: '來源單據',
        required: false,
        type: 'text',
      };

      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { reason: '汰換', sourceDocId: 'PO-1' },
          schema: { fields: [hiddenField, textField], schemaVersion: 1 },
          uiSchema: {
            layout: [
              { fieldKey: 'sourceDocId', width: 'FULL' },
              { fieldKey: 'reason', width: 'FULL' },
            ],
            schemaVersion: 1,
          },
        }),
      ).toBe('事由：汰換');
      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { sourceDocId: 'PO-1' },
          schema: { fields: [hiddenField], schemaVersion: 1 },
          uiSchema: null,
        }),
      ).toBe('fallback');
    });

    // A member field stores raw member ids, which must never reach an inbox or
    // case list as a title.
    it('skips a member field and titles the case with the next field', (): void => {
      const memberField: FormFieldDefinition = {
        fieldKey: 'reviewer',
        label: '人員選擇',
        required: true,
        type: 'member',
      };

      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { reason: '汰換', reviewer: 'member-uuid-1' },
          schema: { fields: [memberField, textField], schemaVersion: 1 },
          uiSchema: {
            layout: [
              { fieldKey: 'reviewer', width: 'FULL' },
              { fieldKey: 'reason', width: 'FULL' },
            ],
            schemaVersion: 1,
          },
        }),
      ).toBe('事由：汰換');
    });

    it('falls back when a member field is the only field', (): void => {
      expect(
        readFormDataCaseTitle({
          fallbackTitle: 'fallback',
          formData: { reviewer: 'member-uuid-1' },
          schema: {
            fields: [
              {
                fieldKey: 'reviewer',
                label: '人員選擇',
                required: true,
                type: 'member',
              },
            ],
            schemaVersion: 1,
          },
          uiSchema: null,
        }),
      ).toBe('fallback');
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
