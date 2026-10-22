import {
  FIELD_ACCESS_CHOICES,
  readFieldAccessChoice,
  readFieldAccessEntryForChoice,
  readFieldAccessMatrix,
} from './field-access-matrix';
import type { FormDefinitionSchema, FormFieldDefinition } from './form';
import type {
  FieldAccessEntry,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './workflow';

const userTask = (
  id: string,
  fieldAccess: readonly FieldAccessEntry[] = [],
  data: Readonly<Record<string, unknown>> = {},
): UserTaskNode =>
  ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess,
      label: `節點 ${id}`,
      returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      ...data,
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  }) as UserTaskNode;

const plainNode = (id: string, type: WorkflowNode['type']): WorkflowNode =>
  ({ data: { label: id }, id, position: { x: 0, y: 0 }, type }) as WorkflowNode;

const edge = (
  source: string,
  target: string,
  label?: string,
): WorkflowEdge => ({
  data: label === undefined ? {} : { label },
  id: `${source}-${target}`,
  source,
  target,
});

const fill = (
  fieldKey: string,
  mode: FieldAccessEntry['fill'] = 'REQUIRED',
): FieldAccessEntry => ({ display: 'SHOW', fieldKey, fill: mode });

const field = (
  fieldKey: string,
  type: FormFieldDefinition['type'] = 'text',
  extra: Readonly<Record<string, unknown>> = {},
): FormFieldDefinition =>
  ({
    fieldKey,
    label: fieldKey,
    required: false,
    type,
    ...extra,
  }) as FormFieldDefinition;

const schemaOf = (
  fields: readonly FormFieldDefinition[],
): FormDefinitionSchema => ({ fields: [...fields], schemaVersion: 1 });

const definitionOf = (
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowDefinition => ({
  edges: [...edges],
  meta: { schemaVersion: 1 },
  nodes: [...nodes],
});

// start → manager → finance → head, finance fills `financeNote` in and head
// hides `costCenter`; `manager` explicitly shows the approver-filled field.
const chain = definitionOf(
  [
    plainNode('start', 'startEvent'),
    userTask('head', [
      { display: 'HIDE', fieldKey: 'costCenter', fill: 'NONE' },
    ]),
    userTask('finance', [fill('financeNote', 'OPTIONAL')]),
    userTask('manager', [
      { display: 'SHOW', fieldKey: 'financeNote', fill: 'NONE' },
    ]),
    plainNode('end', 'endEvent'),
  ],
  [
    edge('start', 'manager'),
    edge('manager', 'finance'),
    edge('finance', 'head'),
    edge('head', 'end'),
  ],
);
const chainSchema = schemaOf([
  field('amount', 'number'),
  field('costCenter'),
  field('financeNote'),
]);

describe('readFieldAccessMatrix', () => {
  it('orders the columns by flow, not by definition order', () =>
    expect(
      readFieldAccessMatrix(chain, chainSchema).columns.map(
        ({ nodeId, stage }) => [stage, nodeId],
      ),
    ).toEqual([
      [1, 'manager'],
      [2, 'finance'],
      [3, 'head'],
    ]));

  it('falls back to definition order inside a loop', () =>
    expect(
      readFieldAccessMatrix(
        definitionOf(
          [userTask('b'), userTask('a')],
          [edge('a', 'b'), edge('b', 'a')],
        ),
        null,
      ).columns.map(({ nodeId }) => nodeId),
    ).toEqual(['b', 'a']));

  it('enters a loop where the flow does, ahead of what comes after it', () =>
    expect(
      readFieldAccessMatrix(
        definitionOf(
          [
            userTask('d'),
            plainNode('s', 'startEvent'),
            userTask('b'),
            userTask('c'),
            plainNode('e', 'endEvent'),
          ],
          [
            edge('s', 'b'),
            edge('b', 'c'),
            edge('c', 'b'),
            edge('c', 'd'),
            edge('d', 'e'),
          ],
        ),
        null,
      ).columns.map(({ nodeId }) => nodeId),
    ).toEqual(['b', 'c', 'd']));

  it('derives each default from where the field is filled in', () => {
    const matrix = readFieldAccessMatrix(chain, chainSchema);
    const read = (fieldKey: string): readonly string[] =>
      matrix.rows
        .find((row) => row.fieldKey === fieldKey)
        ?.cells.map(({ effective, reason }) => `${effective}/${reason}`) ?? [];

    expect(read('amount')).toEqual([
      'READ_ONLY/APPLICANT_FIELD',
      'READ_ONLY/APPLICANT_FIELD',
      'READ_ONLY/APPLICANT_FIELD',
    ]);
    expect(read('costCenter')).toEqual([
      'READ_ONLY/APPLICANT_FIELD',
      'READ_ONLY/APPLICANT_FIELD',
      'HIDDEN/EXPLICIT',
    ]);
    expect(read('financeNote')).toEqual([
      'READ_ONLY/EXPLICIT',
      'FILL_OPTIONAL/EXPLICIT',
      'READ_ONLY/FILLED_EARLIER',
    ]);
  });

  it('keeps an approver-filled field off the applicant and earlier nodes', () => {
    const matrix = readFieldAccessMatrix(
      definitionOf(
        [userTask('first'), userTask('second', [fill('x')])],
        [edge('first', 'second')],
      ),
      schemaOf([field('x')]),
    );

    expect(matrix.rows[0].applicant).toEqual({ effective: 'NOT_SHOWN' });
    expect(matrix.rows[0].fillNodeIds).toEqual(['second']);
    expect(matrix.rows[0].cells[0]).toMatchObject({
      choice: 'DEFAULT',
      effective: 'NOT_SHOWN',
      explicit: null,
      reason: 'NOT_YET_FILLED',
    });
  });

  it('notes a node that shows an approver-filled field before it is filled in', () =>
    expect(
      readFieldAccessMatrix(chain, chainSchema).rows.flatMap(
        (row) => row.notices,
      ),
    ).toEqual([
      {
        code: 'shownBeforeFilled',
        fieldKey: 'financeNote',
        nodeId: 'manager',
      },
    ]));

  it('disables the fill choices the field or the node cannot take', () => {
    const matrix = readFieldAccessMatrix(
      definitionOf(
        [
          userTask('single'),
          userTask('quorum', [], {
            decisionPolicy: { quorum: 2, type: 'QUORUM' },
          }),
        ],
        [edge('single', 'quorum')],
      ),
      schemaOf([
        field('text'),
        field('flag', 'boolean'),
        field('upload', 'file_upload'),
      ]),
    );
    const disabled = matrix.rows.map((row) =>
      row.cells.map((cell) => cell.disabledChoices),
    );

    expect(matrix.columns[1].fillConflicts).toEqual(['groupPolicy']);
    expect(disabled).toEqual([
      [[], ['FILL_OPTIONAL', 'FILL_REQUIRED']],
      [['FILL_REQUIRED'], ['FILL_OPTIONAL', 'FILL_REQUIRED']],
      [
        ['FILL_OPTIONAL', 'FILL_REQUIRED'],
        ['FILL_OPTIONAL', 'FILL_REQUIRED'],
      ],
    ]);
    expect(matrix.rows[2].fillBlockers.map(({ code }) => code)).toEqual([
      'approverFilledFieldFileUpload',
    ]);
  });

  it('places blocking issues on the fields and nodes they name', () => {
    const matrix = readFieldAccessMatrix(
      definitionOf(
        [
          userTask('a', [fill('x')], { fieldPermissions: {} }),
          userTask('b', [fill('x')]),
        ],
        [edge('a', 'b')],
      ),
      schemaOf([field('x'), field('y')]),
    );

    expect(matrix.issues.map(({ code }) => code)).toEqual([
      'legacyFieldPermissions',
      'approverFilledMultipleFillNodesOnPath',
    ]);
    expect(matrix.columns[0].issues.map(({ code }) => code)).toEqual([
      'legacyFieldPermissions',
    ]);
    expect(
      matrix.rows.map((row) => row.issues.map(({ code }) => code)),
    ).toEqual([['approverFilledMultipleFillNodesOnPath'], []]);
  });

  it('names the exclusive branch a node sits on', () =>
    expect(
      readFieldAccessMatrix(
        definitionOf(
          [
            plainNode('choice', 'exclusiveGateway'),
            userTask('north'),
            userTask('south'),
          ],
          [edge('choice', 'north', '北區'), edge('choice', 'south')],
        ),
        null,
      ).columns.map(({ branchLabel }) => branchLabel),
    ).toEqual(['北區', null]));

  it('has no rows without a form', () =>
    expect(readFieldAccessMatrix(chain, null).rows).toEqual([]));
});

describe('field access choices', () => {
  it('round-trips every choice through its entry', () =>
    expect(
      FIELD_ACCESS_CHOICES.map((choice) =>
        readFieldAccessChoice(readFieldAccessEntryForChoice('x', choice)),
      ),
    ).toEqual(FIELD_ACCESS_CHOICES));

  it('writes nothing for the default choice', () =>
    expect(readFieldAccessEntryForChoice('x', 'DEFAULT')).toBeNull());

  it('reads a hidden fill as the fill it asks for', () =>
    expect(
      readFieldAccessChoice({
        display: 'HIDE',
        fieldKey: 'x',
        fill: 'REQUIRED',
      }),
    ).toBe('FILL_REQUIRED'));
});
