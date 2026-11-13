import {
  isFormDataValueEmpty,
  omitFormDataKeys,
  overlayStoredFormDataKeys,
  readApproverFilledFieldKeys,
  readNodeFieldAccess,
  readNodeFillUnits,
  readNodeFillableFieldKeys,
  readNodeRequiredFieldKeys,
  readRevealedFieldKeys,
  readFormFieldPathTopLevelKey,
  readTopLevelFieldKey,
  resolveFieldAccess,
} from './field-access';
import type {
  FieldAccessEntry,
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
  fieldAccess?: readonly FieldAccessEntry[],
): UserTaskNode => ({
  data: {
    allowAddSigner: false,
    allowReject: true,
    allowTransfer: false,
    approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
    decisionPolicy: { type: 'SINGLE' },
    label: id,
    returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
    ...(fieldAccess === undefined ? {} : { fieldAccess }),
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
      { display: 'SHOW', fieldKey: 'financeItems', fill: 'REQUIRED' },
      { display: 'HIDE', fieldKey: 'note', fill: 'NONE' },
    ]),
    buildUserTask('task_head', [
      { display: 'SHOW', fieldKey: 'headRemark', fill: 'OPTIONAL' },
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

describe('field access readers', () => {
  it('collects approver-filled keys across every user task', () =>
    expect([...readApproverFilledFieldKeys(def)].sort()).toEqual([
      'financeItems',
      'headRemark',
    ]));

  it('reads fillable and required keys of one node', () => {
    const finance = def.nodes.find(
      (node): node is UserTaskNode => node.id === 'task_finance',
    ) as UserTaskNode;

    expect([...readNodeFillableFieldKeys(finance)]).toEqual(['financeItems']);
    expect([...readNodeRequiredFieldKeys(finance)]).toEqual(['financeItems']);
  });

  it('does not treat an optional fill as required', () => {
    const head = def.nodes.find(
      (node): node is UserTaskNode => node.id === 'task_head',
    ) as UserTaskNode;

    expect([...readNodeRequiredFieldKeys(head)]).toEqual([]);
  });

  it('tolerates a malformed fieldAccess value', () =>
    expect(
      readNodeFillableFieldKeys(nodeWith({ fieldAccess: 'oops' })).size,
    ).toBe(0));

  it('skips entries without a fieldKey string', () =>
    expect([
      ...readNodeFillableFieldKeys(
        nodeWith({
          fieldAccess: [
            null,
            { fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: '', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'x', fill: 'OPTIONAL' },
          ],
        }),
      ),
    ]).toEqual(['x']));

  it('lets the first entry for a fieldKey win over a later fillable one', () => {
    const node = nodeWith({
      fieldAccess: [
        { display: 'SHOW', fieldKey: 'x', fill: 'NONE' },
        { display: 'SHOW', fieldKey: 'x', fill: 'REQUIRED' },
      ],
    });

    expect(readNodeFillableFieldKeys(node).size).toBe(0);
    expect(readNodeFieldAccess(node)).toHaveLength(1);
  });

  it.each([undefined, 'YES', 'optional', true])(
    'reads the unknown fill %p as NONE',
    (fill) =>
      expect(
        readNodeFieldAccess(
          nodeWith({ fieldAccess: [{ display: 'SHOW', fieldKey: 'x', fill }] }),
        ).map((entry) => entry.fill),
      ).toEqual(['NONE']),
  );

  it.each([undefined, 'hide', false])(
    'reads the unknown display %p as SHOW',
    (display) =>
      expect(
        readNodeFieldAccess(
          nodeWith({ fieldAccess: [{ display, fieldKey: 'x', fill: 'NONE' }] }),
        ).map((entry) => entry.display),
      ).toEqual(['SHOW']),
  );

  it('never reads the legacy fieldPermissions key', () => {
    const node = nodeWith({
      fieldPermissions: [
        { editable: true, fieldPath: 'x', required: true, visible: false },
      ],
    });

    expect(readNodeFieldAccess(node)).toEqual([]);
    expect(readNodeFillableFieldKeys(node).size).toBe(0);
    expect(readNodeRequiredFieldKeys(node).size).toBe(0);
    expect(
      readApproverFilledFieldKeys({
        edges: [],
        meta: { schemaVersion: 1 },
        nodes: [startNode, node],
      }).size,
    ).toBe(0);
  });

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

  it('honours display HIDE listed on the node', () =>
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

describe('table column fill readers (ADR 27 §4(a))', () => {
  const columnDefinition = (
    fieldAccess: readonly FieldAccessEntry[],
  ): WorkflowDefinition => ({
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [buildUserTask('task_col', fieldAccess)],
  });

  const columnNode = (columns: unknown, fill: unknown = 'NONE') =>
    nodeWith({
      fieldAccess: [{ columns, display: 'SHOW', fieldKey: 'items', fill }],
    });

  it('reads columns on an entry and keeps whole-field entries unchanged', () => {
    const entries = readNodeFieldAccess(
      buildUserTask('t', [
        {
          columns: [
            { columnKey: 'note', fill: 'REQUIRED' },
            { columnKey: 'price', fill: 'OPTIONAL' },
          ],
          display: 'SHOW',
          fieldKey: 'items',
          fill: 'NONE',
        },
        { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
      ]),
    );

    expect(entries[0]).toEqual({
      columns: [
        { columnKey: 'note', fill: 'REQUIRED' },
        { columnKey: 'price', fill: 'OPTIONAL' },
      ],
      display: 'SHOW',
      fieldKey: 'items',
      fill: 'NONE',
    });
    expect(entries[1]).not.toHaveProperty('columns');
  });

  it('skips malformed columns and lets the first duplicate columnKey win', () => {
    const [entry] = readNodeFieldAccess(
      columnNode([
        null,
        { columnKey: '', fill: 'REQUIRED' },
        { columnKey: 'bad', fill: 'NONE' },
        { columnKey: 'note', fill: 'OPTIONAL' },
        { columnKey: 'note', fill: 'REQUIRED' },
      ]),
    );

    expect(entry.columns).toEqual([{ columnKey: 'note', fill: 'OPTIONAL' }]);
  });

  it('treats a non-array columns value as no column mode', () => {
    const [entry] = readNodeFieldAccess(columnNode('note', 'REQUIRED'));

    expect(entry).not.toHaveProperty('columns');
    expect(entry.fill).toBe('REQUIRED');
  });

  it('keeps column mode when every column was malformed (fail closed)', () => {
    const node = columnNode([{ columnKey: 'x', fill: 'WRONG' }], 'REQUIRED');

    expect(readNodeFillUnits(node)).toEqual([]);
    expect(readNodeFillableFieldKeys(node)).toEqual(new Set());
  });

  it('gives one unit per open column and ignores the entry fill', () => {
    const node = buildUserTask('t', [
      {
        columns: [
          { columnKey: 'note', fill: 'REQUIRED' },
          { columnKey: 'price', fill: 'OPTIONAL' },
        ],
        display: 'SHOW',
        fieldKey: 'items',
        fill: 'REQUIRED',
      },
    ]);

    expect(readNodeFillUnits(node)).toEqual([
      { columnKey: 'note', fieldKey: 'items', fill: 'REQUIRED' },
      { columnKey: 'price', fieldKey: 'items', fill: 'OPTIONAL' },
    ]);
    expect(readNodeFillableFieldKeys(node)).toEqual(new Set(['items']));
    expect(readNodeRequiredFieldKeys(node)).toEqual(new Set());
  });

  it('gives a whole-field unit with a null columnKey', () => {
    expect(
      readNodeFillUnits(
        buildUserTask('t', [
          { display: 'SHOW', fieldKey: 'amount', fill: 'REQUIRED' },
          { display: 'SHOW', fieldKey: 'note', fill: 'NONE' },
        ]),
      ),
    ).toEqual([{ columnKey: null, fieldKey: 'amount', fill: 'REQUIRED' }]);
  });

  it('lets the node that fills a column edit the table', () => {
    const definition = columnDefinition([
      {
        columns: [{ columnKey: 'price', fill: 'REQUIRED' }],
        display: 'SHOW',
        fieldKey: 'items',
        fill: 'NONE',
      },
    ]);

    expect(
      resolveFieldAccess({
        definition,
        fieldKeys: ['items'],
        isAdhocTask: false,
        nodeId: 'task_col',
        revealedFieldKeys: new Set(),
      }),
    ).toEqual({ items: { editable: true, visible: true } });
    expect(
      resolveFieldAccess({
        definition,
        fieldKeys: ['items'],
        isAdhocTask: true,
        nodeId: 'task_col',
        revealedFieldKeys: new Set(),
      }),
    ).toEqual({ items: { editable: false, visible: true } });
  });
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

describe('readFormFieldPathTopLevelKey', () => {
  it.each([
    ['amount', 'amount'],
    ['form.amount', 'amount'],
    ['formData.items[0].price', 'items'],
    [' form . items ', 'items'],
    ['form', ''],
  ])('reads %j as %j', (fieldPath, expected) => {
    expect(readFormFieldPathTopLevelKey(fieldPath)).toBe(expected);
  });
});
