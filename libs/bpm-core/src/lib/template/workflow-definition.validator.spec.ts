import {
  EMPTY_WORKFLOW_DEFINITION,
  lintWorkflowDefinition,
} from './workflow-definition.validator';
import { WORKFLOW_LINT_MESSAGES } from '@rytass/bpm-core-shared/workflow-graph';
import {
  ApproverResolver,
  DecisionPolicy,
  ExcludeInitiatorConfig,
  ReturnBehavior,
  ServiceAction,
  SlaConfig,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';

describe('workflow definition validator', () => {
  it('accepts a linear start user task end workflow', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_task',
          source: 'start',
          target: 'task_manager',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_task_end',
          source: 'task_manager',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: true,
            approverResolver: {
              baseFromInitiator: true,
              levelsUp: 1,
              type: 'ORG_MANAGER',
            },
            decisionPolicy: { type: 'SINGLE' },
            label: '主管簽核',
            returnBehavior: {
              allowReturn: true,
              allowedTargets: 'INITIATOR',
            },
          },
          id: 'task_manager',
          position: { x: 300, y: 160 },
          type: 'userTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [],
    });
  });

  it('rejects unreachable nodes and missing end paths', (): void => {
    const workflow: WorkflowDefinition = {
      ...EMPTY_WORKFLOW_DEFINITION,
      edges: [],
      nodes: [
        ...EMPTY_WORKFLOW_DEFINITION.nodes,
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: ['member-001'], type: 'DIRECT' },
              type: 'NOTIFY',
            },
            label: '孤立節點',
          },
          id: 'orphan',
          position: { x: 300, y: 300 },
          type: 'serviceTask',
        },
      ],
    };
    const result = lintWorkflowDefinition(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'workflow.nodes.start does not have a path to an endEvent',
    );
    expect(result.errors).toContain(
      'workflow.nodes.orphan is not reachable from start',
    );
  });

  it('requires a default edge for exclusive gateway splits', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: { condition: 'form.amount > 1000' },
          id: 'edge_start_gateway',
          source: 'start',
          target: 'gateway',
          type: 'smoothstep',
        },
        {
          data: { condition: 'form.amount > 1000' },
          id: 'edge_gateway_end',
          source: 'gateway',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { direction: 'split', label: '金額判斷' },
          id: 'gateway',
          position: { x: 300, y: 160 },
          type: 'exclusiveGateway',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.gateway must include a default outgoing edge',
    );
  });

  it('allows direct user tasks with multiple candidate approvers', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_task',
          source: 'start',
          target: 'task_finance',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_task_end',
          source: 'task_finance',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: true,
            approverResolver: {
              memberIds: ['member-001', 'member-002'],
              type: 'DIRECT',
            },
            decisionPolicy: { type: 'SINGLE' },
            label: '財務簽核',
            returnBehavior: {
              allowReturn: true,
              allowedTargets: 'INITIATOR',
            },
          },
          id: 'task_finance',
          position: { x: 300, y: 160 },
          type: 'userTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toEqual([]);
  });

  it('rejects notify service tasks without recipients', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_notify',
          source: 'start',
          target: 'notify_team',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_notify_end',
          source: 'notify_team',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: [], type: 'DIRECT' },
              type: 'NOTIFY',
            },
            label: '知會團隊',
          },
          id: 'notify_team',
          position: { x: 300, y: 160 },
          type: 'serviceTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.notify_team.action.recipients.memberIds is required',
    );
  });

  it('rejects webhook service tasks without an endpoint URL', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_webhook',
          source: 'start',
          target: 'notify_external',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_webhook_end',
          source: 'notify_external',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            action: {
              type: 'WEBHOOK',
              url: '',
            },
            label: '通知外部系統',
          },
          id: 'notify_external',
          position: { x: 300, y: 160 },
          type: 'serviceTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.notify_external.action.url is required',
    );
  });

  it('rejects set-form-field service tasks without a target field path', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_set_field',
          source: 'start',
          target: 'set_form_field',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_set_field_end',
          source: 'set_form_field',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            action: {
              fieldPath: '',
              type: 'SET_FORM_FIELD',
              value: '"approved"',
            },
            label: '更新表單欄位',
          },
          id: 'set_form_field',
          position: { x: 300, y: 160 },
          type: 'serviceTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.set_form_field.action.fieldPath is required',
    );
  });

  it('allows notify service tasks to be async side branches without outgoing edges', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_end',
          source: 'start',
          target: 'end',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_start_notify',
          source: 'start',
          target: 'notify_team',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: ['member-001'], type: 'DIRECT' },
              type: 'NOTIFY',
            },
            label: '知會團隊',
          },
          id: 'notify_team',
          position: { x: 300, y: 240 },
          type: 'serviceTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [],
    });
  });

  it('rejects exclusive splits with fewer than two outgoing edges', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_gateway',
          source: 'start',
          target: 'gateway',
          type: 'smoothstep',
        },
        {
          data: { isDefault: true },
          id: 'edge_gateway_end',
          source: 'gateway',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { direction: 'split', label: '條件分支' },
          id: 'gateway',
          position: { x: 300, y: 160 },
          type: 'exclusiveGateway',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.gateway exclusive split requires at least two outgoing edges',
    );
  });

  it('rejects workflows with reachable cycles', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_task',
          source: 'start',
          target: 'task_manager',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_task_gateway',
          source: 'task_manager',
          target: 'gateway',
          type: 'smoothstep',
        },
        {
          data: { isDefault: true },
          id: 'edge_gateway_task',
          source: 'gateway',
          target: 'task_manager',
          type: 'smoothstep',
        },
        {
          data: { condition: 'form.amount <= 1000' },
          id: 'edge_gateway_end',
          source: 'gateway',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: true,
            approverResolver: {
              memberIds: ['member-001'],
              type: 'DIRECT',
            },
            decisionPolicy: { type: 'SINGLE' },
            label: '主管簽核',
            returnBehavior: { allowedTargets: 'PREVIOUS', allowReturn: true },
          },
          id: 'task_manager',
          position: { x: 300, y: 160 },
          type: 'userTask',
        },
        {
          data: { direction: 'split', label: '條件分支' },
          id: 'gateway',
          position: { x: 520, y: 160 },
          type: 'exclusiveGateway',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 740, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow contains a cycle involving node task_manager',
    );
  });

  it('rejects outgoing edges from notify service tasks', (): void => {
    const workflow: WorkflowDefinition = {
      edges: [
        {
          data: {},
          id: 'edge_start_notify',
          source: 'start',
          target: 'notify_team',
          type: 'smoothstep',
        },
        {
          data: {},
          id: 'edge_notify_end',
          source: 'notify_team',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: ['member-001'], type: 'DIRECT' },
              type: 'NOTIFY',
            },
            label: '知會團隊',
          },
          id: 'notify_team',
          position: { x: 300, y: 160 },
          type: 'serviceTask',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    };

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.edges.edge_notify_end.source cannot be a NOTIFY serviceTask',
    );
  });

  it('rejects an invalid SLA calendar mode, timeout action and duration', (): void => {
    const workflow = createUserTaskWorkflow({
      sla: {
        calendar: 'WORKING_DAY' as never,
        duration: '2 days',
        onTimeout: 'PING' as never,
      },
    });

    expect(lintWorkflowDefinition(workflow).errors).toEqual(
      expect.arrayContaining([
        'workflow.nodes.task_manager.sla.duration is not a valid ISO duration',
        'workflow.nodes.task_manager.sla.onTimeout is invalid',
        'workflow.nodes.task_manager.sla.calendar is invalid',
      ]),
    );
  });

  it('only warns about an out-of-range warningAt so existing templates stay publishable', (): void => {
    // Percentages stored as `75` instead of `0.75` exist in the wild; the SLA
    // scanner ignores them, so publication must not start failing.
    const workflow = createUserTaskWorkflow({
      sla: { duration: 'P2D', onTimeout: 'REMIND', warningAt: 75 },
    });

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [
        'workflow.nodes.task_manager.sla.warningAt must be between 0 and 1; the warning notification is skipped',
      ],
    });
  });

  it('rejects a COUNT quorum above the direct approvers the node resolves to', (): void => {
    // The task would gate on 3 approvals against 2 candidates forever, and an
    // ad-hoc signer opens a separate task rather than adding a candidate here.
    const workflow = createUserTaskWorkflow({
      approverResolver: { memberIds: ['m1', 'm2'], type: 'DIRECT' },
      decisionPolicy: { threshold: 3, thresholdType: 'COUNT', type: 'QUORUM' },
    });

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.task_manager.decisionPolicy.threshold exceeds the 2 approver(s) this node resolves to',
    );
  });

  it('accepts a COUNT quorum that the direct approvers can satisfy', (): void => {
    const workflow = createUserTaskWorkflow({
      approverResolver: { memberIds: ['m1', 'm2', 'm3'], type: 'DIRECT' },
      decisionPolicy: { threshold: 3, thresholdType: 'COUNT', type: 'QUORUM' },
    });

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [],
    });
  });

  it('leaves a COUNT quorum alone when the approver count is a runtime question', (): void => {
    // ORG_MANAGER may resolve to one manager, several, or none. Rejecting it
    // at publish time would fail templates that are in fact fine.
    const workflow = createUserTaskWorkflow({
      decisionPolicy: { threshold: 9, thresholdType: 'COUNT', type: 'QUORUM' },
    });

    expect(lintWorkflowDefinition(workflow).errors).toEqual([]);
  });

  it('never rejects a PERCENTAGE quorum, which cannot exceed the total', (): void => {
    const workflow = createUserTaskWorkflow({
      approverResolver: { memberIds: ['m1'], type: 'DIRECT' },
      decisionPolicy: {
        threshold: 100,
        thresholdType: 'PERCENTAGE',
        type: 'QUORUM',
      },
    });

    expect(lintWorkflowDefinition(workflow).errors).toEqual([]);
  });

  it('rejects a non-boolean requireComment', (): void => {
    const workflow = createUserTaskWorkflow({
      returnBehavior: {
        allowReturn: true,
        allowedTargets: 'INITIATOR',
        requireComment: 'yes' as never,
      },
    });

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.task_manager.returnBehavior.requireComment must be a boolean',
    );
  });

  it('rejects an excludeInitiator whose whenEmpty is not a known behaviour', (): void => {
    const workflow = createUserTaskWorkflow({
      excludeInitiator: { whenEmpty: 'IGNORE' as never },
    });

    expect(lintWorkflowDefinition(workflow).errors).toContain(
      'workflow.nodes.task_manager.excludeInitiator.whenEmpty is invalid',
    );
  });

  it.each(['FAIL', 'INITIATOR_MANAGER', 'SKIP_NODE'] as const)(
    'accepts excludeInitiator whenEmpty %s',
    (whenEmpty): void => {
      const workflow = createUserTaskWorkflow({
        excludeInitiator: { whenEmpty },
      });

      expect(lintWorkflowDefinition(workflow).errors).toEqual([]);
    },
  );

  it('accepts a business-day SLA without warnings', (): void => {
    const workflow = createUserTaskWorkflow({
      sla: { calendar: 'BUSINESS_DAY', duration: 'P2D', onTimeout: 'REMIND' },
    });

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [],
    });
  });

  it('warns when a business-day SLA mixes in an hour component', (): void => {
    const workflow = createUserTaskWorkflow({
      sla: { calendar: 'BUSINESS_DAY', duration: 'P1DT4H', onTimeout: 'REMIND' },
    });

    expect(lintWorkflowDefinition(workflow)).toEqual({
      errors: [],
      valid: true,
      warnings: [
        'workflow.nodes.task_manager.sla mixes BUSINESS_DAY with an hour/minute component; only the day part skips non-business days',
      ],
    });
  });

  describe('ORG_MANAGER_CHAIN approver resolver', (): void => {
    const chain = (
      overrides: Partial<
        Extract<ApproverResolver, { type: 'ORG_MANAGER_CHAIN' }>
      >,
    ): ApproverResolver => ({
      minPositionLevel: 3,
      type: 'ORG_MANAGER_CHAIN',
      ...overrides,
    });

    it('accepts an integer level with SEQUENTIAL or PARALLEL_ALL', (): void => {
      expect(
        lintWorkflowDefinition(
          createUserTaskWorkflow({
            approverResolver: chain({}),
            decisionPolicy: { type: 'SEQUENTIAL' },
          }),
        ).errors,
      ).toEqual([]);
      expect(
        lintWorkflowDefinition(
          createUserTaskWorkflow({
            approverResolver: chain({}),
            decisionPolicy: { type: 'PARALLEL_ALL' },
          }),
        ).errors,
      ).toEqual([]);
    });

    it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects a non-integer minPositionLevel (%s)',
      (minPositionLevel): void => {
        expect(
          lintWorkflowDefinition(
            createUserTaskWorkflow({
              approverResolver: chain({ minPositionLevel }),
              decisionPolicy: { type: 'SEQUENTIAL' },
            }),
          ).errors,
        ).toEqual([
          'workflow.nodes.task_manager.approverResolver.minPositionLevel is invalid',
        ]);
      },
    );

    it('rejects a DIRECT fallback with a blank member id', (): void => {
      expect(
        lintWorkflowDefinition(
          createUserTaskWorkflow({
            approverResolver: chain({
              fallback: { memberId: '  ', type: 'DIRECT' },
            }),
            decisionPolicy: { type: 'SEQUENTIAL' },
          }),
        ).errors,
      ).toEqual([
        'workflow.nodes.task_manager.approverResolver.fallback.memberId is required',
      ]);
    });

    it('rejects a POSITION fallback with a blank position id', (): void => {
      expect(
        lintWorkflowDefinition(
          createUserTaskWorkflow({
            approverResolver: chain({
              fallback: { positionId: '  ', type: 'POSITION' },
            }),
            decisionPolicy: { type: 'SEQUENTIAL' },
          }),
        ).errors,
      ).toEqual([
        'workflow.nodes.task_manager.approverResolver.fallback.positionId is required',
      ]);
    });

    it('accepts a POSITION fallback on an ORG_MANAGER_CHAIN node', (): void => {
      expect(
        lintWorkflowDefinition(
          createUserTaskWorkflow({
            approverResolver: chain({
              fallback: { positionId: 'position-cfo', type: 'POSITION' },
            }),
            decisionPolicy: { type: 'SEQUENTIAL' },
          }),
        ).errors,
      ).toEqual([]);
    });

    it.each([
      { type: 'SINGLE' },
      { type: 'PARALLEL_ANY' },
      { threshold: 2, thresholdType: 'COUNT', type: 'QUORUM' },
    ] as const)(
      'rejects a decision policy that lets one manager close the node (%j)',
      (decisionPolicy): void => {
        expect(
          lintWorkflowDefinition(
            createUserTaskWorkflow({
              approverResolver: chain({}),
              decisionPolicy,
            }),
          ).errors,
        ).toEqual([
          'workflow.nodes.task_manager.decisionPolicy must be SEQUENTIAL or PARALLEL_ALL when approverResolver is ORG_MANAGER_CHAIN',
        ]);
      },
    );

    it('reports a missing approverResolver instead of throwing', (): void => {
      const workflow = createUserTaskWorkflow({
        decisionPolicy: { type: 'SEQUENTIAL' },
      });
      const userTask = workflow.nodes.find((node) => node.id === 'task_manager');

      if (userTask?.type !== 'userTask') {
        throw new Error('fixture has no user task');
      }

      const { approverResolver: _omitted, ...dataWithoutResolver } =
        userTask.data;
      void _omitted;

      expect(
        lintWorkflowDefinition({
          ...workflow,
          nodes: workflow.nodes.map((node) =>
            node.id === 'task_manager'
              ? ({ ...node, data: dataWithoutResolver } as typeof node)
              : node,
          ),
        }).errors,
      ).toEqual(['workflow.nodes.task_manager.approverResolver is required']);
    });

    it('does not apply the decision policy rule to NOTIFY recipients', (): void => {
      const workflow: WorkflowDefinition = {
        ...EMPTY_WORKFLOW_DEFINITION,
        edges: [
          {
            data: {},
            id: 'edge_start_end',
            source: 'start',
            target: 'end',
            type: 'smoothstep',
          },
          {
            data: {},
            id: 'edge_start_notify',
            source: 'start',
            target: 'notify_chain',
            type: 'smoothstep',
          },
        ],
        nodes: [
          ...EMPTY_WORKFLOW_DEFINITION.nodes,
          {
            data: {
              action: {
                channels: ['IN_APP'],
                recipients: chain({}),
                type: 'NOTIFY',
              },
              label: '通知主管鏈',
            },
            id: 'notify_chain',
            position: { x: 300, y: 300 },
            type: 'serviceTask',
          },
        ],
      };

      expect(lintWorkflowDefinition(workflow)).toEqual({
        errors: [],
        valid: true,
        warnings: [],
      });
    });
  });

  describe('NOTIFY webhooks', (): void => {
    const ERP_WEBHOOK = {
      bindings: [
        {
          from: { fieldKey: 'amount', kind: 'FIELD' as const },
          parameter: 'amount',
        },
      ],
      endpoint: { key: 'erp.purchase-approved', version: 1 },
      id: 'webhook_erp',
    };

    function workflowWithNotify(action: unknown): WorkflowDefinition {
      return {
        ...EMPTY_WORKFLOW_DEFINITION,
        edges: [
          {
            data: {},
            id: 'edge_start_end',
            source: 'start',
            target: 'end',
            type: 'smoothstep',
          },
          {
            data: {},
            id: 'edge_start_notify',
            source: 'start',
            target: 'notify_erp',
            type: 'smoothstep',
          },
        ],
        nodes: [
          ...EMPTY_WORKFLOW_DEFINITION.nodes,
          {
            data: { action: action as ServiceAction, label: '通知 ERP' },
            id: 'notify_erp',
            position: { x: 300, y: 300 },
            type: 'serviceTask',
          },
        ],
      };
    }

    it('accepts a node that notifies only external systems', (): void => {
      expect(
        lintWorkflowDefinition(
          workflowWithNotify({
            channels: ['IN_APP'],
            recipients: { memberIds: [], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [ERP_WEBHOOK],
          }),
        ),
      ).toEqual({ errors: [], valid: true, warnings: [] });
    });

    it('still requires recipients when the webhook list is empty', (): void => {
      expect(
        lintWorkflowDefinition(
          workflowWithNotify({
            channels: ['IN_APP'],
            recipients: { memberIds: [], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [],
          }),
        ).errors,
      ).toEqual([
        'workflow.nodes.notify_erp.action.recipients.memberIds is required',
      ]);
    });

    it('keeps linting a misconfigured runtime resolver next to webhooks', (): void => {
      expect(
        lintWorkflowDefinition(
          workflowWithNotify({
            channels: ['IN_APP'],
            recipients: { positionId: '', type: 'POSITION' },
            type: 'NOTIFY',
            webhooks: [ERP_WEBHOOK],
          }),
        ).errors,
      ).toEqual([
        'workflow.nodes.notify_erp.action.recipients.positionId is required',
      ]);
    });

    it('reports structural webhook problems with their JSON path', (): void => {
      const result = lintWorkflowDefinition(
        workflowWithNotify({
          channels: ['IN_APP'],
          recipients: { memberIds: ['member-001'], type: 'DIRECT' },
          type: 'NOTIFY',
          webhooks: [
            ERP_WEBHOOK,
            {
              bindings: [
                { from: { kind: 'CONTEXT', path: 'formData' }, parameter: 'a' },
                { from: { kind: 'CONSTANT', value: 1 }, parameter: 'a' },
              ],
              endpoint: { key: ' ', version: 0 },
              id: 'webhook_erp',
            },
          ],
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'workflow.nodes.notify_erp.action.webhooks[1].id must be unique within the node',
        'workflow.nodes.notify_erp.action.webhooks[1].endpoint.key is required',
        'workflow.nodes.notify_erp.action.webhooks[1].endpoint.version must be an integer between 1 and 2147483647',
        'workflow.nodes.notify_erp.action.webhooks[1].bindings[0].from.path is not a supported context path',
        'workflow.nodes.notify_erp.action.webhooks[1].bindings[1].parameter "a" is bound more than once',
      ]);
    });

    it('rejects a URL or headers stored on a webhook target', (): void => {
      expect(
        lintWorkflowDefinition(
          workflowWithNotify({
            channels: ['IN_APP'],
            recipients: { memberIds: ['member-001'], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [
              {
                ...ERP_WEBHOOK,
                bindings: [
                  {
                    from: { fieldKey: 'amount', kind: 'FIELD', token: 'x' },
                    parameter: 'amount',
                  },
                ],
                endpoint: { key: 'erp', secret: 's3cr3t', version: 1 },
                url: 'https://erp.example.com/hook',
              },
            ],
          }),
        ).errors,
      ).toEqual([
        'workflow.nodes.notify_erp.action.webhooks[0].url is not allowed',
        'workflow.nodes.notify_erp.action.webhooks[0].endpoint.secret is not allowed',
        'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.token is not allowed',
      ]);
    });

    it('rejects a webhook list that is not an array', (): void => {
      expect(
        lintWorkflowDefinition(
          workflowWithNotify({
            channels: ['IN_APP'],
            recipients: { memberIds: ['member-001'], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: { key: 'erp' },
          }),
        ).errors,
      ).toEqual(['workflow.nodes.notify_erp.action.webhooks must be an array']);
    });
  });
});

function createUserTaskWorkflow({
  approverResolver = { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
  decisionPolicy = { type: 'SINGLE' },
  excludeInitiator,
  returnBehavior = { allowReturn: true, allowedTargets: 'INITIATOR' },
  sla,
}: {
  readonly approverResolver?: ApproverResolver;
  readonly decisionPolicy?: DecisionPolicy;
  readonly excludeInitiator?: ExcludeInitiatorConfig;
  readonly returnBehavior?: ReturnBehavior;
  readonly sla?: SlaConfig;
}): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task_manager',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_end',
        source: 'task_manager',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: true,
          approverResolver,
          decisionPolicy,
          label: '主管簽核',
          returnBehavior,
          ...(excludeInitiator ? { excludeInitiator } : {}),
          ...(sla ? { sla } : {}),
        },
        id: 'task_manager',
        position: { x: 300, y: 160 },
        type: 'userTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

describe('workflow definition validator: field access', (): void => {
  const TASK = 'task_fill';

  function workflowWithFieldAccess(
    taskData: Readonly<Record<string, unknown>>,
    serviceActions: readonly unknown[] = [],
  ): WorkflowDefinition {
    const serviceNodes = serviceActions.map((action, index) => ({
      data: { action, label: `系統 ${index}` },
      id: `service_${index}`,
      position: { x: 400, y: 160 },
      type: 'serviceTask',
    }));
    const chain = [TASK, ...serviceNodes.map((node) => node.id), 'end'];

    return {
      edges: [
        { data: {}, id: 'edge_start', source: 'start', target: TASK },
        ...chain.slice(0, -1).map((source, index) => ({
          data: {},
          id: `edge_${source}`,
          source,
          target: chain[index + 1],
        })),
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: {
            allowAddSigner: false,
            allowReject: true,
            allowTransfer: true,
            approverResolver: {
              baseFromInitiator: true,
              levelsUp: 1,
              type: 'ORG_MANAGER',
            },
            decisionPolicy: { type: 'SINGLE' },
            label: '財務補填',
            returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
            ...taskData,
          },
          id: TASK,
          position: { x: 300, y: 160 },
          type: 'userTask',
        },
        ...serviceNodes,
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    } as unknown as WorkflowDefinition;
  }

  const lintErrors = (
    taskData: Readonly<Record<string, unknown>>,
    serviceActions: readonly unknown[] = [],
  ): readonly string[] =>
    lintWorkflowDefinition(workflowWithFieldAccess(taskData, serviceActions))
      .errors;

  const FILL = { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' };

  it('accepts well-formed entries and a node without any', (): void => {
    expect(lintErrors({})).toEqual([]);
    expect(lintErrors({ fieldAccess: [] })).toEqual([]);
    expect(
      lintErrors({
        fieldAccess: [
          { ...FILL, fill: 'REQUIRED' },
          { display: 'HIDE', fieldKey: 'note', fill: 'NONE' },
          { display: 'SHOW', fieldKey: 'items', fill: 'NONE' },
        ],
      }),
    ).toEqual([]);
  });

  describe('fieldAccess is invalid', (): void => {
    const invalid = `workflow.nodes.${TASK}.fieldAccess is invalid`;

    it.each([
      ['not an array', 'amount'],
      ['null', null],
      ['an array holding null', [FILL, null]],
      ['an entry with an empty fieldKey', [{ ...FILL, fieldKey: '' }]],
      ['an entry whose fieldKey is only whitespace', [{ ...FILL, fieldKey: '  ' }]],
      ['an entry whose fieldKey is not a string', [{ ...FILL, fieldKey: 3 }]],
      ['an entry whose display is unknown', [{ ...FILL, display: 'VISIBLE' }]],
      ['an entry without display', [{ fieldKey: 'amount', fill: 'NONE' }]],
      ['an entry whose fill is unknown', [{ ...FILL, fill: 'YES' }]],
      ['an entry without fill', [{ display: 'SHOW', fieldKey: 'amount' }]],
      [
        'an entry in the deprecated fieldPermissions shape',
        [{ editable: true, fieldPath: 'amount', visible: true }],
      ],
      ['an entry that is not an object', ['amount']],
    ])('reports %s as a lint line and does not throw', (_name, value): void => {
      expect(lintErrors({ fieldAccess: value })).toEqual([invalid]);
    });

    it('skips the node’s other field access rules once it is invalid', (): void => {
      expect(
        lintErrors({
          decisionPolicy: { type: 'PARALLEL_ALL' },
          fieldAccess: [
            null,
            { display: 'HIDE', fieldKey: 'amount', fill: 'OPTIONAL' },
            { display: 'HIDE', fieldKey: 'amount', fill: 'OPTIONAL' },
          ],
          sla: { duration: 'PT1H', onTimeout: 'AUTO_APPROVE' },
        }),
      ).toEqual([invalid]);
    });
  });

  describe('the deprecated fieldPermissions key', (): void => {
    const legacy = WORKFLOW_LINT_MESSAGES.legacyFieldPermissions(TASK);

    it.each([
      ['an empty list', []],
      [
        'a list of entries',
        [{ editable: true, fieldPath: 'amount', visible: true }],
      ],
      ['a malformed value', 'amount'],
      ['null', null],
    ])('refuses a node that still carries %s', (_name, value): void => {
      expect(lintErrors({ fieldPermissions: value })).toEqual([legacy]);
    });

    it('accepts a node without the key', (): void => {
      expect(lintErrors({ fieldAccess: [FILL] })).toEqual([]);
    });

    it('still runs the node’s fieldAccess rules beside it', (): void => {
      expect(
        lintErrors({
          fieldAccess: [{ ...FILL, display: 'HIDE' }],
          fieldPermissions: [],
        }),
      ).toEqual([
        legacy,
        `workflow.nodes.${TASK}.fieldAccess cannot let a field be filled in while it is hidden: amount`,
      ]);
    });

    it('never reads the old entries as fillable fields', (): void => {
      // An editable old entry on a PARALLEL_ALL node would be refused if it
      // counted; only the legacy line is reported.
      expect(
        lintErrors({
          decisionPolicy: { type: 'PARALLEL_ALL' },
          fieldPermissions: [
            { editable: true, fieldPath: 'amount', visible: true },
          ],
        }),
      ).toEqual([legacy]);
    });
  });

  it('refuses a field listed more than once, reading the raw list', (): void => {
    // `readNodeFieldAccess` keeps the first entry per fieldKey, so a
    // duplicate check built on it would never see the second one.
    expect(
      lintErrors({
        fieldAccess: [
          FILL,
          { display: 'SHOW', fieldKey: 'note', fill: 'NONE' },
          { display: 'SHOW', fieldKey: 'amount', fill: 'NONE' },
          { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
        ],
      }),
    ).toEqual([
      `workflow.nodes.${TASK}.fieldAccess lists a field more than once: amount`,
    ]);
  });

  it('leaves a nested key to the publish check against the form', (): void => {
    // Only the form knows its top-level fields; `items.price` is reported as
    // unknown there (template.service.spec).
    expect(
      lintErrors({
        fieldAccess: [{ display: 'SHOW', fieldKey: 'items.price', fill: 'NONE' }],
      }),
    ).toEqual([]);
  });

  describe('a fillable field that is hidden', (): void => {
    it.each(['OPTIONAL', 'REQUIRED'])('refuses fill %s with HIDE', (fill): void => {
      expect(
        lintErrors({ fieldAccess: [{ ...FILL, display: 'HIDE', fill }] }),
      ).toEqual([
        `workflow.nodes.${TASK}.fieldAccess cannot let a field be filled in while it is hidden: amount`,
      ]);
    });

    it('accepts a hidden field nobody fills in and a shown fillable one', (): void => {
      expect(
        lintErrors({
          fieldAccess: [
            { display: 'HIDE', fieldKey: 'note', fill: 'NONE' },
            { ...FILL, fill: 'REQUIRED' },
          ],
        }),
      ).toEqual([]);
    });
  });

  describe('fillable fields on a node', (): void => {
    const fillable = { fieldAccess: [FILL] };
    const readOnly = {
      fieldAccess: [{ display: 'SHOW', fieldKey: 'amount', fill: 'NONE' }],
    };

    it.each<[string, DecisionPolicy]>([
      ['PARALLEL_ALL', { type: 'PARALLEL_ALL' }],
      [
        'QUORUM',
        { threshold: 1, thresholdType: 'COUNT', type: 'QUORUM' },
      ],
    ])('refuses them on a %s node', (_name, decisionPolicy): void => {
      expect(lintErrors({ ...fillable, decisionPolicy })).toEqual([
        `workflow.nodes.${TASK}.fieldAccess cannot make fields fillable on a PARALLEL_ALL or QUORUM node`,
      ]);
      expect(lintErrors({ ...readOnly, decisionPolicy })).toEqual([]);
    });

    it.each<DecisionPolicy>([
      { type: 'SINGLE' },
      { type: 'SEQUENTIAL' },
      { type: 'PARALLEL_ANY' },
    ])('accepts them on a %j node', (decisionPolicy): void => {
      expect(lintErrors({ ...fillable, decisionPolicy })).toEqual([]);
    });

    it('refuses AUTO_APPROVE on timeout', (): void => {
      const sla = { duration: 'PT1H', onTimeout: 'AUTO_APPROVE' };

      expect(lintErrors({ ...fillable, sla })).toEqual([
        `workflow.nodes.${TASK}.sla.onTimeout cannot be AUTO_APPROVE on a node with fillable fields`,
      ]);
      expect(lintErrors({ ...readOnly, sla })).toEqual([]);
      expect(
        lintErrors({
          ...fillable,
          sla: { duration: 'PT1H', onTimeout: 'REMIND' },
        }),
      ).toEqual([]);
    });

    it('refuses SKIP_NODE when no approver remains', (): void => {
      const excludeInitiator = { whenEmpty: 'SKIP_NODE' };

      expect(lintErrors({ ...fillable, excludeInitiator })).toEqual([
        `workflow.nodes.${TASK}.excludeInitiator.whenEmpty cannot be SKIP_NODE on a node with fillable fields`,
      ]);
      expect(lintErrors({ ...readOnly, excludeInitiator })).toEqual([]);
      expect(
        lintErrors({
          ...fillable,
          excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
        }),
      ).toEqual([]);
    });
  });

  describe('a system node writing an approver-filled field', (): void => {
    const setField = (fieldPath: string): unknown => ({
      fieldPath,
      type: 'SET_FORM_FIELD',
      value: '"x"',
    });
    const line = (fieldKey: string): string =>
      `workflow.nodes.service_0.action.fieldPath cannot write a field an approver fills in: ${fieldKey}`;

    it.each([
      ['amount', 'amount'],
      ['items.price', 'items'],
      ['items[0].price', 'items'],
    ])('refuses writing %s', (fieldPath, fieldKey): void => {
      expect(
        lintErrors(
          {
            fieldAccess: [
              FILL,
              { display: 'SHOW', fieldKey: 'items', fill: 'OPTIONAL' },
            ],
          },
          [setField(fieldPath)],
        ),
      ).toEqual([line(fieldKey)]);
    });

    it('accepts writing a field no approver fills in', (): void => {
      expect(
        lintErrors(
          {
            fieldAccess: [
              FILL,
              { display: 'SHOW', fieldKey: 'note', fill: 'NONE' },
            ],
          },
          [setField('note'), setField('title')],
        ),
      ).toEqual([]);
    });

    it('does not flag other service actions', (): void => {
      expect(
        lintErrors({ fieldAccess: [FILL] }, [
          { type: 'WEBHOOK', url: 'https://example.com/amount' },
        ]),
      ).toEqual([]);
    });
  });
});

describe('workflow definition validator: one fill node per path', (): void => {
  const userTask = (
    id: string,
    fill: 'NONE' | 'OPTIONAL' | 'REQUIRED',
  ): Readonly<Record<string, unknown>> => ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: { memberIds: ['member_finance'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess: [{ display: 'SHOW', fieldKey: 'approvedTotal', fill }],
      label: id,
      returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
    },
    id,
    position: { x: 300, y: 160 },
    type: 'userTask',
  });
  const node = (
    id: string,
    type: string,
    data: Readonly<Record<string, unknown>> = {},
  ): Readonly<Record<string, unknown>> => ({
    data: { label: id, ...data },
    id,
    position: { x: 0, y: 0 },
    type,
  });
  const edge = (
    source: string,
    target: string,
    data: Readonly<Record<string, unknown>> = {},
  ): Readonly<Record<string, unknown>> => ({
    data,
    id: `edge_${source}_${target}`,
    source,
    target,
  });
  const lintErrors = (
    nodes: readonly unknown[],
    edges: readonly unknown[],
  ): readonly string[] =>
    lintWorkflowDefinition({
      edges,
      meta: { schemaVersion: 1 },
      nodes: [
        node('start', 'startEvent'),
        ...nodes,
        node('end', 'endEvent', { endState: 'APPROVED' }),
      ],
    } as unknown as WorkflowDefinition).errors;
  const line = (first: string, second: string): string =>
    `formData.approvedTotal is filled in by both workflow.nodes.${first} and workflow.nodes.${second}, which lie on the same path`;

  it('refuses two fill nodes one after the other, once per pair', (): void => {
    expect(
      lintErrors(
        [userTask('regional', 'REQUIRED'), userTask('cfo', 'OPTIONAL')],
        [edge('start', 'regional'), edge('regional', 'cfo'), edge('cfo', 'end')],
      ),
    ).toEqual([line('regional', 'cfo')]);
  });

  it('names the pair in node order when the later node is listed first', (): void => {
    expect(
      lintErrors(
        [userTask('cfo', 'OPTIONAL'), userTask('regional', 'REQUIRED')],
        [edge('start', 'regional'), edge('regional', 'cfo'), edge('cfo', 'end')],
      ),
    ).toEqual([line('cfo', 'regional')]);
  });

  it('accepts one fill node and a later node that only shows the field', (): void => {
    expect(
      lintErrors(
        [userTask('regional', 'REQUIRED'), userTask('cfo', 'NONE')],
        [edge('start', 'regional'), edge('regional', 'cfo'), edge('cfo', 'end')],
      ),
    ).toEqual([]);
  });

  it('accepts fill nodes on mutually exclusive branches', (): void => {
    expect(
      lintErrors(
        [
          node('split', 'exclusiveGateway', { direction: 'split' }),
          userTask('north', 'REQUIRED'),
          userTask('south', 'REQUIRED'),
          node('merge', 'exclusiveGateway', { direction: 'join' }),
        ],
        [
          edge('start', 'split'),
          edge('split', 'north', { condition: 'form.region == "N"' }),
          edge('split', 'south', { isDefault: true }),
          edge('north', 'merge'),
          edge('south', 'merge'),
          edge('merge', 'end'),
        ],
      ),
    ).toEqual([]);
  });

  it('refuses a branch fill node followed by another after the merge', (): void => {
    expect(
      lintErrors(
        [
          node('split', 'exclusiveGateway', { direction: 'split' }),
          userTask('north', 'REQUIRED'),
          userTask('south', 'NONE'),
          node('merge', 'exclusiveGateway', { direction: 'join' }),
          userTask('cfo', 'OPTIONAL'),
        ],
        [
          edge('start', 'split'),
          edge('split', 'north', { condition: 'form.region == "N"' }),
          edge('split', 'south', { isDefault: true }),
          edge('north', 'merge'),
          edge('south', 'merge'),
          edge('merge', 'cfo'),
          edge('cfo', 'end'),
        ],
      ),
    ).toEqual([line('north', 'cfo')]);
  });

  // Both branches of a parallel split run, so the later approval would
  // overwrite the earlier one even though neither node reaches the other.
  it('refuses fill nodes on two parallel branches', (): void => {
    expect(
      lintErrors(
        [
          node('fork', 'parallelGateway', { direction: 'split' }),
          userTask('north', 'REQUIRED'),
          userTask('south', 'REQUIRED'),
          node('join', 'parallelGateway', { direction: 'join' }),
        ],
        [
          edge('start', 'fork'),
          edge('fork', 'north'),
          edge('fork', 'south'),
          edge('north', 'join'),
          edge('south', 'join'),
          edge('join', 'end'),
        ],
      ),
    ).toEqual([line('north', 'south')]);
  });

  it('refuses a parallel branch fill node beside a fill node on an exclusive branch of the other', (): void => {
    expect(
      lintErrors(
        [
          node('fork', 'parallelGateway', { direction: 'split' }),
          userTask('north', 'REQUIRED'),
          node('split', 'exclusiveGateway', { direction: 'split' }),
          userTask('south', 'REQUIRED'),
          userTask('east', 'NONE'),
          node('merge', 'exclusiveGateway', { direction: 'join' }),
          node('join', 'parallelGateway', { direction: 'join' }),
        ],
        [
          edge('start', 'fork'),
          edge('fork', 'north'),
          edge('fork', 'split'),
          edge('split', 'south', { condition: 'form.region == "S"' }),
          edge('split', 'east', { isDefault: true }),
          edge('south', 'merge'),
          edge('east', 'merge'),
          edge('merge', 'join'),
          edge('north', 'join'),
          edge('join', 'end'),
        ],
      ),
    ).toEqual([line('north', 'south')]);
  });

  it('accepts fill nodes on exclusive branches after a parallel join', (): void => {
    expect(
      lintErrors(
        [
          node('fork', 'parallelGateway', { direction: 'split' }),
          userTask('legal', 'NONE'),
          userTask('hr', 'NONE'),
          node('join', 'parallelGateway', { direction: 'join' }),
          node('split', 'exclusiveGateway', { direction: 'split' }),
          userTask('north', 'REQUIRED'),
          userTask('south', 'REQUIRED'),
          node('merge', 'exclusiveGateway', { direction: 'join' }),
        ],
        [
          edge('start', 'fork'),
          edge('fork', 'legal'),
          edge('fork', 'hr'),
          edge('legal', 'join'),
          edge('hr', 'join'),
          edge('join', 'split'),
          edge('split', 'north', { condition: 'form.region == "N"' }),
          edge('split', 'south', { isDefault: true }),
          edge('north', 'merge'),
          edge('south', 'merge'),
          edge('merge', 'end'),
        ],
      ),
    ).toEqual([]);
  });
});
