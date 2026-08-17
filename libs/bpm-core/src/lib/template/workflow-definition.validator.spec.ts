import {
  EMPTY_WORKFLOW_DEFINITION,
  lintWorkflowDefinition,
} from './workflow-definition.validator';
import {
  ApproverResolver,
  DecisionPolicy,
  ReturnBehavior,
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
});

function createUserTaskWorkflow({
  approverResolver = { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
  decisionPolicy = { type: 'SINGLE' },
  returnBehavior = { allowReturn: true, allowedTargets: 'INITIATOR' },
  sla,
}: {
  readonly approverResolver?: ApproverResolver;
  readonly decisionPolicy?: DecisionPolicy;
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
