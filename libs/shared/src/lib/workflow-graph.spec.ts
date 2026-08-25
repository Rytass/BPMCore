import {
  isDecisionPolicyUnsatisfiable,
  readConditionExpression,
  readConditionOperatorIds,
  readDesignTimeApproverCount,
  readFallbackWorkflowDefinition,
  readWorkflowDefinitionIssue,
} from './workflow-graph';
import { FormFieldDefinition } from './form';
import {
  ApproverResolver,
  DecisionPolicy,
  WorkflowDefinition,
} from './workflow';

const THREE_MEMBERS: ApproverResolver = {
  memberIds: ['m1', 'm2', 'm3'],
  type: 'DIRECT',
};
const ONE_MANAGER: ApproverResolver = {
  baseFromInitiator: true,
  levelsUp: 1,
  type: 'ORG_MANAGER',
};

function quorum(threshold: number, thresholdType: 'COUNT' | 'PERCENTAGE' = 'COUNT'): DecisionPolicy {
  return { threshold, thresholdType, type: 'QUORUM' };
}

function definitionWithUserTask(
  approverResolver: ApproverResolver,
  decisionPolicy: DecisionPolicy,
): WorkflowDefinition {
  const fallback = readFallbackWorkflowDefinition();

  return {
    ...fallback,
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_end',
        source: 'task',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    nodes: [
      ...fallback.nodes,
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: true,
          approverResolver,
          decisionPolicy,
          label: '部門會簽',
          returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
        },
        id: 'task',
        position: { x: 300, y: 160 },
        type: 'userTask',
      },
    ],
  };
}

describe('readDesignTimeApproverCount', () => {
  it('counts the members a DIRECT resolver carries', () => {
    expect(readDesignTimeApproverCount(THREE_MEMBERS)).toBe(3);
  });

  it('reports an unknown count for every runtime-resolved strategy', () => {
    expect(readDesignTimeApproverCount(ONE_MANAGER)).toBeNull();
    expect(
      readDesignTimeApproverCount({ positionId: 'p1', type: 'POSITION' }),
    ).toBeNull();
  });
});

describe('isDecisionPolicyUnsatisfiable', () => {
  it('flags a COUNT quorum above the direct approver count', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(4), THREE_MEMBERS)).toBe(true);
  });

  it('accepts a COUNT quorum the direct approvers can meet', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(3), THREE_MEMBERS)).toBe(false);
  });

  it('never flags a runtime-resolved approver set', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(9), ONE_MANAGER)).toBe(false);
  });

  it('never flags PERCENTAGE, which cannot exceed the total', () => {
    expect(
      isDecisionPolicyUnsatisfiable(quorum(100, 'PERCENTAGE'), THREE_MEMBERS),
    ).toBe(false);
  });

  it('ignores the non-quorum policies and a missing policy', () => {
    expect(
      isDecisionPolicyUnsatisfiable({ type: 'PARALLEL_ALL' }, THREE_MEMBERS),
    ).toBe(false);
    expect(isDecisionPolicyUnsatisfiable(undefined, THREE_MEMBERS)).toBe(false);
  });
});

describe('readWorkflowDefinitionIssue', () => {
  it('reports the deadlocked node with both numbers', () => {
    const issue = readWorkflowDefinitionIssue(
      definitionWithUserTask(THREE_MEMBERS, quorum(5)),
    );

    expect(issue).toContain('部門會簽');
    expect(issue).toContain('5');
    expect(issue).toContain('3');
  });

  it('stays silent when the quorum is reachable', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithUserTask(THREE_MEMBERS, quorum(2)),
      ),
    ).toBeNull();
  });
});

describe('table field conditions', () => {
  const TABLE_FIELD: FormFieldDefinition = {
    columns: [
      { fieldKey: 'qty', label: 'Quantity', required: true, type: 'number' },
    ],
    fieldKey: 'items',
    label: 'Items',
    required: true,
    type: 'table',
  };
  const TEXT_FIELD: FormFieldDefinition = {
    fieldKey: 'note',
    label: 'Note',
    required: false,
    type: 'text',
  };

  it('offers only emptiness operators for a table', () => {
    expect(readConditionOperatorIds(TABLE_FIELD)).toEqual([
      'IS_FILLED',
      'IS_EMPTY',
    ]);
    expect(readConditionOperatorIds(TEXT_FIELD)).toEqual([
      'EQUALS',
      'NOT_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ]);
  });

  it('compiles table emptiness to a row count, not a string comparison', () => {
    expect(readConditionExpression(TABLE_FIELD, 'IS_FILLED', undefined)).toBe(
      'form.items != null && size(form.items) > 0',
    );
    expect(readConditionExpression(TABLE_FIELD, 'IS_EMPTY', undefined)).toBe(
      'form.items == null || size(form.items) == 0',
    );
    expect(readConditionExpression(TEXT_FIELD, 'IS_FILLED', undefined)).toBe(
      'form.note != null && form.note != ""',
    );
  });

  it('refuses to compile value operators against a table', () => {
    expect(readConditionExpression(TABLE_FIELD, 'EQUALS', '1')).toBeUndefined();
  });
});
