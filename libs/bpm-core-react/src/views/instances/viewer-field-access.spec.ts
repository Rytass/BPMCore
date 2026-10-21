import type {
  FieldAccessEntry,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared';
import type {
  ActivityLogRecord,
  ApprovalInstanceRecord,
  TaskRecord,
} from '@rytass/bpm-core-client/workflow';
import {
  readRevealedNodeIds,
  readViewerFieldAccess,
} from './viewer-field-access';

const userTask = (
  id: string,
  fieldAccess: readonly FieldAccessEntry[],
): WorkflowDefinition['nodes'][number] => ({
  data: {
    allowAddSigner: true,
    allowReject: true,
    allowTransfer: false,
    approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
    decisionPolicy: { type: 'SINGLE' },
    fieldAccess,
    label: id,
    returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
  },
  id,
  position: { x: 0, y: 0 },
  type: 'userTask',
});

// manager → finance (fills invoiceNo and financeItems) → director.
const DEFINITION: WorkflowDefinition = {
  edges: [],
  meta: { schemaVersion: 1 },
  nodes: [
    userTask('manager', []),
    userTask('finance', [
      { display: 'SHOW', fieldKey: 'invoiceNo', fill: 'REQUIRED' },
      { display: 'SHOW', fieldKey: 'financeItems', fill: 'OPTIONAL' },
      { display: 'HIDE', fieldKey: 'note', fill: 'NONE' },
    ]),
    userTask('director', []),
  ],
};

const INSTANCE = {
  formDefinitionSnapshot: {
    schema: {
      fields: [
        { fieldKey: 'title', label: '標題', required: true, type: 'text' },
        { fieldKey: 'note', label: '備註', required: false, type: 'text' },
        {
          fieldKey: 'invoiceNo',
          label: '發票號碼',
          required: false,
          type: 'text',
        },
        {
          columns: [
            { fieldKey: 'name', label: '品項', required: true, type: 'text' },
          ],
          fieldKey: 'financeItems',
          label: '財務明細',
          required: false,
          type: 'table',
        },
      ],
      schemaVersion: 1,
    },
  },
  workflowSnapshot: DEFINITION,
} as Pick<
  ApprovalInstanceRecord,
  'formDefinitionSnapshot' | 'workflowSnapshot'
>;

const task = (
  id: string,
  nodeId: string,
  overrides: Partial<TaskRecord> = {},
): TaskRecord =>
  ({
    id,
    isAdhoc: false,
    nodeId,
    status: 'COMPLETED',
    ...overrides,
  }) as TaskRecord;

const created = (
  taskId: string,
  payload: Readonly<Record<string, unknown>> = {},
): ActivityLogRecord => ({
  actorMemberId: null,
  createdAt: '2026-10-21T00:00:00.000Z',
  eventType: 'TASK_CREATED',
  id: `log-${taskId}`,
  nodeId: null,
  payloadJson: JSON.stringify(payload),
  taskId,
});

const READ_ONLY = { editable: false, visible: true };
const HIDDEN = { editable: false, visible: false };
const EDITABLE = { editable: true, visible: true };

describe('readRevealedNodeIds', () => {
  it("counts a node's own tasks but not an ad-hoc one", () => {
    const tasks = [
      task('t-manager', 'manager'),
      task('t-adhoc', 'finance', { isAdhoc: true }),
    ];

    expect([
      ...readRevealedNodeIds(
        [created('t-manager'), created('t-adhoc')],
        tasks,
      ),
    ]).toEqual(['manager']);
  });

  // The reopened task's log carries an adhocDirectiveId, yet it is the
  // node's own task (docs/08 §8.3).
  it('counts the task reopened after a refused pre-approval', () => {
    const tasks = [
      task('t-adhoc', 'finance', { isAdhoc: true }),
      task('t-reopened', 'finance'),
    ];
    const logs = [
      created('t-adhoc'),
      created('t-reopened', {
        adhocDirectiveId: 'directive-1',
        reopenedFromTaskId: 't-origin',
      }),
    ];

    expect([...readRevealedNodeIds(logs, tasks)]).toEqual(['finance']);
  });

  it('ignores other events and logs whose task is unknown', () => {
    const logs: readonly ActivityLogRecord[] = [
      { ...created('t-finance'), eventType: 'TOKEN_ADVANCED' },
      created('t-missing'),
      { ...created('t-finance'), taskId: null },
    ];

    expect(
      readRevealedNodeIds(logs, [task('t-finance', 'finance')]).size,
    ).toBe(0);
  });
});

describe('readViewerFieldAccess', () => {
  const beforeFinance = {
    activityLogs: [created('t-manager')],
    tasks: [task('t-manager', 'manager', { status: 'PENDING' })],
  };
  const atFinance = {
    activityLogs: [created('t-manager'), created('t-finance')],
    tasks: [
      task('t-manager', 'manager'),
      task('t-finance', 'finance', { status: 'PENDING' }),
    ],
  };

  it('hides approver-filled fields from the applicant until revealed', () => {
    expect(
      readViewerFieldAccess({
        ...beforeFinance,
        actingTask: null,
        instance: INSTANCE,
      }),
    ).toEqual({
      financeItems: HIDDEN,
      invoiceNo: HIDDEN,
      note: READ_ONLY,
      title: READ_ONLY,
    });
  });

  it('shows the applicant revealed fields read-only', () => {
    expect(
      readViewerFieldAccess({ ...atFinance, actingTask: null, instance: INSTANCE }),
    ).toEqual({
      financeItems: READ_ONLY,
      invoiceNo: READ_ONLY,
      note: READ_ONLY,
      title: READ_ONLY,
    });
  });

  it("lets the fill node's approver edit its fields, as configured", () => {
    expect(
      readViewerFieldAccess({
        ...atFinance,
        actingTask: atFinance.tasks[1],
        instance: INSTANCE,
      }),
    ).toEqual({
      financeItems: EDITABLE,
      invoiceNo: EDITABLE,
      note: HIDDEN,
      title: READ_ONLY,
    });
  });

  it('gives an ad-hoc signer at the fill node the display but no edit', () => {
    const adhoc = task('t-adhoc', 'finance', {
      isAdhoc: true,
      status: 'PENDING',
    });

    expect(
      readViewerFieldAccess({
        activityLogs: [...atFinance.activityLogs, created('t-adhoc')],
        actingTask: adhoc,
        instance: INSTANCE,
        tasks: [...atFinance.tasks, adhoc],
      }),
    ).toEqual({
      financeItems: READ_ONLY,
      invoiceNo: READ_ONLY,
      note: HIDDEN,
      title: READ_ONLY,
    });
  });

  it('shows a later approver the filled fields read-only', () => {
    const director = task('t-director', 'director', { status: 'PENDING' });

    expect(
      readViewerFieldAccess({
        activityLogs: [...atFinance.activityLogs, created('t-director')],
        actingTask: director,
        instance: INSTANCE,
        tasks: [task('t-manager', 'manager'), task('t-finance', 'finance'), director],
      }),
    ).toMatchObject({ financeItems: READ_ONLY, invoiceNo: READ_ONLY });
  });

  it('keeps fields revealed after a return sends the case back', () => {
    const managerAgain = task('t-manager-2', 'manager', { status: 'PENDING' });

    expect(
      readViewerFieldAccess({
        activityLogs: [...atFinance.activityLogs, created('t-manager-2')],
        actingTask: managerAgain,
        instance: INSTANCE,
        tasks: [
          task('t-manager', 'manager'),
          task('t-finance', 'finance', { status: 'CANCELLED' }),
          managerAgain,
        ],
      }),
    ).toMatchObject({ financeItems: READ_ONLY, invoiceNo: READ_ONLY });
  });

  it('lets the approver edit again on the task reopened after a refused pre-approval', () => {
    const reopened = task('t-reopened', 'finance', { status: 'PENDING' });

    expect(
      readViewerFieldAccess({
        activityLogs: [
          created('t-manager'),
          created('t-adhoc'),
          created('t-reopened', { adhocDirectiveId: 'directive-1' }),
        ],
        actingTask: reopened,
        instance: INSTANCE,
        tasks: [
          task('t-manager', 'manager'),
          task('t-adhoc', 'finance', { isAdhoc: true, status: 'COMPLETED' }),
          reopened,
        ],
      }),
    ).toMatchObject({ financeItems: EDITABLE, invoiceNo: EDITABLE });
  });

  it('reads no fields when the snapshot has no schema', () => {
    expect(
      readViewerFieldAccess({
        ...atFinance,
        actingTask: null,
        instance: { ...INSTANCE, formDefinitionSnapshot: {} },
      }),
    ).toEqual({});
  });
});
