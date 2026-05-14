import {
  EMPTY_WORKFLOW_DEFINITION,
  lintWorkflowDefinition,
} from './workflow-definition.validator';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';

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
    });
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
});
