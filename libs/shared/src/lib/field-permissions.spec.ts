import {
  isFormDataValueEmpty,
  omitFormDataKeys,
  overlayStoredFormDataKeys,
  readApproverFilledFieldKeys,
  readNodeEditableFieldKeys,
  readNodeRequiredFieldKeys,
  readRevealedFieldKeys,
  readTopLevelFieldKey,
  resolveFieldAccess,
} from './field-permissions';
import type {
  FieldPermission,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowNode,
} from './workflow';

const FORM_FIELD_KEYS: readonly string[] = [
  'amount',
  'financeItems',
  'note',
  'headRemark',
];

const buildUserTask = (
  id: string,
  fieldPermissions?: readonly FieldPermission[],
): UserTaskNode => ({
  data: {
    allowAddSigner: false,
    allowReject: true,
    allowTransfer: false,
    approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
    decisionPolicy: { type: 'SINGLE' },
    label: id,
    returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
    ...(fieldPermissions === undefined ? {} : { fieldPermissions }),
  },
  id,
  position: { x: 0, y: 0 },
  type: 'userTask',
});

const nodeWith = (data: Readonly<Record<string, unknown>>): UserTaskNode => {
  const base = buildUserTask('task_x');

  return { ...base, data: { ...base.data, ...data } } as UserTaskNode;
};

const startNode: WorkflowNode = {
  data: { label: 'start' },
  id: 'start',
  position: { x: 0, y: 0 },
  type: 'startEvent',
};

const def: WorkflowDefinition = {
  edges: [],
  meta: { schemaVersion: 1 },
  nodes: [
    startNode,
    buildUserTask('task_manager'),
    buildUserTask('task_finance', [
      {
        editable: true,
        fieldPath: 'financeItems',
        required: true,
        visible: true,
      },
      { editable: false, fieldPath: 'note', visible: false },
    ]),
    buildUserTask('task_head', [
      { editable: true, fieldPath: 'headRemark', visible: true },
    ]),
  ],
};

const access = (
  overrides: Partial<Parameters<typeof resolveFieldAccess>[0]>,
): ReturnType<typeof resolveFieldAccess> =>
  resolveFieldAccess({
    definition: def,
    fieldKeys: FORM_FIELD_KEYS,
    isAdhocTask: false,
    nodeId: null,
    revealedFieldKeys: new Set<string>(),
    ...overrides,
  });

describe('field permission readers', () => {
  it('collects approver-filled keys across every user task', () =>
    expect([...readApproverFilledFieldKeys(def)].sort()).toEqual([
      'financeItems',
      'headRemark',
    ]));

  it('reads editable and required keys of one node', () => {
    const finance = def.nodes.find(
      (node): node is UserTaskNode => node.id === 'task_finance',
    ) as UserTaskNode;

    expect([...readNodeEditableFieldKeys(finance)]).toEqual(['financeItems']);
    expect([...readNodeRequiredFieldKeys(finance)]).toEqual(['financeItems']);
  });

  it('does not treat editable without required as required', () => {
    const head = def.nodes.find(
      (node): node is UserTaskNode => node.id === 'task_head',
    ) as UserTaskNode;

    expect([...readNodeRequiredFieldKeys(head)]).toEqual([]);
  });

  it('tolerates a malformed fieldPermissions entry', () =>
    expect(
      readNodeEditableFieldKeys(nodeWith({ fieldPermissions: 'oops' })).size,
    ).toBe(0));

  it('skips entries without a fieldPath string', () =>
    expect([
      ...readNodeEditableFieldKeys(
        nodeWith({
          fieldPermissions: [
            null,
            { editable: true },
            { editable: true, fieldPath: 'x', visible: true },
          ],
        }),
      ),
    ]).toEqual(['x']));

  it('ignores node ids that are not user tasks when revealing', () =>
    expect(readRevealedFieldKeys(def, ['start', 'missing']).size).toBe(0));
});

describe('resolveFieldAccess', () => {
  it('hides an unrevealed approver-filled field outside its node', () =>
    expect(access({ nodeId: 'task_manager' })['financeItems']).toEqual({
      editable: false,
      visible: false,
    }));

  it('shows a revealed approver-filled field read-only to the applicant', () => {
    const result = access({
      revealedFieldKeys: readRevealedFieldKeys(def, ['task_finance']),
    });

    expect(result['financeItems']).toEqual({ editable: false, visible: true });
    expect(result['headRemark']).toEqual({ editable: false, visible: false });
  });

  it('lets the filling node edit', () =>
    expect(access({ nodeId: 'task_finance' })['financeItems']).toEqual({
      editable: true,
      visible: true,
    }));

  it('never lets an ad-hoc task edit', () =>
    expect(
      access({ isAdhocTask: true, nodeId: 'task_finance' })['financeItems'],
    ).toEqual({ editable: false, visible: true }));

  it('keeps an ad-hoc task to the node visibility', () =>
    expect(
      access({ isAdhocTask: true, nodeId: 'task_finance' })['note'],
    ).toEqual({ editable: false, visible: false }));

  it('honours visible:false listed on the node', () =>
    expect(access({ nodeId: 'task_finance' })['note']).toEqual({
      editable: false,
      visible: false,
    }));

  it('leaves ordinary fields read-only everywhere', () =>
    expect(access({ nodeId: 'task_finance' })['amount']).toEqual({
      editable: false,
      visible: true,
    }));

  it('answers every requested field key and nothing else', () =>
    expect(Object.keys(access({ nodeId: 'task_head' })).sort()).toEqual(
      [...FORM_FIELD_KEYS].sort(),
    ));
});

describe('form data key helpers', () => {
  it('omits the given keys without mutating the input', () => {
    const source = { a: 1, b: 2 };

    expect(omitFormDataKeys(source, new Set(['b']))).toEqual({ a: 1 });
    expect(source).toEqual({ a: 1, b: 2 });
  });

  it('overlays stored values and drops keys the store lacks', () =>
    expect(
      overlayStoredFormDataKeys(
        { a: 1, financeItems: [], flag: false },
        { financeItems: [{ seq: 1 }] },
        new Set(['financeItems', 'flag']),
      ),
    ).toEqual({ a: 1, financeItems: [{ seq: 1 }] }));

  it('does not read stored keys off the prototype', () =>
    expect(
      overlayStoredFormDataKeys(
        { constructor: 'x' },
        {},
        new Set(['constructor']),
      ),
    ).toEqual({}));

  it.each([
    [undefined, true],
    [null, true],
    ['', true],
    ['   ', true],
    [[], true],
    [false, false],
    [0, false],
    [NaN, false],
    [{}, false],
    ['a', false],
  ])('isFormDataValueEmpty(%p) is %p', (value, expected) =>
    expect(isFormDataValueEmpty(value)).toBe(expected),
  );
});

describe('readTopLevelFieldKey', () => {
  it.each([
    ['amount', 'amount'],
    ['items.price', 'items'],
    ['items[0]', 'items'],
    ['items[0].price', 'items'],
    ['', ''],
  ])('reads %j as %j', (fieldPath, expected) => {
    expect(readTopLevelFieldKey(fieldPath)).toBe(expected);
  });
});
