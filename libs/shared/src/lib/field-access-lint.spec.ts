import {
  createWorkflowCoRunReader,
  readDefinitionFieldAccessIssues,
  readFormFieldAccessIssues,
  readFormFieldFillIssues,
  readNodeFieldAccessIssues,
  readReachableWorkflowNodeIds,
  readUserTaskFillConflicts,
  referencesFormField,
} from './field-access-lint';
import type { FormDefinitionSchema, FormFieldDefinition } from './form';
import type {
  FieldAccessEntry,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './workflow';
import { WORKFLOW_LINT_MESSAGES } from './workflow-graph';

const buildUserTask = (
  id: string,
  fieldAccess?: readonly FieldAccessEntry[],
  data: Readonly<Record<string, unknown>> = {},
): UserTaskNode =>
  ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label: id,
      returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      ...(fieldAccess === undefined ? {} : { fieldAccess }),
      ...data,
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  }) as UserTaskNode;

const buildNode = (id: string, type: WorkflowNode['type']): WorkflowNode =>
  ({
    data: { label: id },
    id,
    position: { x: 0, y: 0 },
    type,
  }) as WorkflowNode;

const edge = (source: string, target: string): WorkflowEdge => ({
  data: {},
  id: `${source}-${target}`,
  source,
  target,
});

const fill = (
  fieldKey: string,
  fillMode: FieldAccessEntry['fill'] = 'REQUIRED',
): FieldAccessEntry => ({ display: 'SHOW', fieldKey, fill: fillMode });

const definitionOf = (
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowDefinition => ({
  edges: [...edges],
  meta: { schemaVersion: 1 },
  nodes: [...nodes],
});

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

describe('readNodeFieldAccessIssues', () => {
  it('reports nothing for a node without field access', () =>
    expect(readNodeFieldAccessIssues(buildUserTask('a'))).toEqual([]));

  it('reports the legacy key before an invalid shape and stops there', () =>
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', undefined, {
          fieldAccess: [{ fieldKey: 'x' }],
          fieldPermissions: {},
        }),
      ).map(({ code, nodeIds }) => ({ code, nodeIds })),
    ).toEqual([
      { code: 'legacyFieldPermissions', nodeIds: ['a'] },
      { code: 'fieldAccessInvalid', nodeIds: ['a'] },
    ]));

  it('reports a duplicated field once and a hidden fill per entry', () =>
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [
          { display: 'HIDE', fieldKey: 'x', fill: 'OPTIONAL' },
          fill('x'),
          fill('x'),
        ]),
      ).map(({ code, fieldKeys }) => ({ code, fieldKeys })),
    ).toEqual([
      { code: 'fieldAccessDuplicate', fieldKeys: ['x'] },
      { code: 'fieldAccessFillHidden', fieldKeys: ['x'] },
    ]));

  it('reports the fill conflicts only when the node fills something in', () => {
    const conflicting = {
      decisionPolicy: { type: 'QUORUM' },
      excludeInitiator: { whenEmpty: 'SKIP_NODE' },
      sla: { onTimeout: 'AUTO_APPROVE' },
    };

    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [fill('x')], conflicting),
      ).map(({ code }) => code),
    ).toEqual([
      'fieldAccessGroupPolicy',
      'fieldAccessAutoApprove',
      'fieldAccessSkipNode',
    ]);
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [fill('x', 'NONE')], conflicting),
      ),
    ).toEqual([]);
  });

  it('carries the publish-lint line as its message', () =>
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [
          { display: 'HIDE', fieldKey: 'x', fill: 'REQUIRED' },
        ]),
      ).map(({ message }) => message),
    ).toEqual([WORKFLOW_LINT_MESSAGES.fieldAccessFillHidden('a', 'x')]));
});

describe('readUserTaskFillConflicts', () => {
  it('reads nothing off a single-approver node', () =>
    expect(readUserTaskFillConflicts(buildUserTask('a'))).toEqual([]));

  it('reads a parallel-all policy as a group policy', () =>
    expect(
      readUserTaskFillConflicts(
        buildUserTask('a', undefined, {
          decisionPolicy: { type: 'PARALLEL_ALL' },
        }),
      ),
    ).toEqual(['groupPolicy']));
});

describe('readReachableWorkflowNodeIds', () => {
  const edges = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'a'),
    edge('b', 'd'),
  ];

  it('walks a cycle without looping and includes the start', () =>
    expect([...readReachableWorkflowNodeIds(edges, ['a'])].sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]));

  it('does not enter a blocked node', () =>
    expect(
      [...readReachableWorkflowNodeIds(edges, ['a'], new Set(['c']))].sort(),
    ).toEqual(['a', 'b', 'd']));
});

describe('createWorkflowCoRunReader', () => {
  const nodes = [
    buildNode('start', 'startEvent'),
    buildNode('split', 'parallelGateway'),
    buildNode('left', 'userTask'),
    buildNode('right', 'userTask'),
    buildNode('choice', 'exclusiveGateway'),
    buildNode('yes', 'userTask'),
    buildNode('no', 'userTask'),
  ];
  const canBothRun = createWorkflowCoRunReader(
    definitionOf(nodes, [
      edge('start', 'split'),
      edge('split', 'left'),
      edge('split', 'right'),
      edge('left', 'choice'),
      edge('choice', 'yes'),
      edge('choice', 'no'),
    ]),
  );

  it('lets two nodes on one path both run', () =>
    expect(canBothRun('left', 'yes')).toBe(true));

  it('lets two parallel branches both run', () =>
    expect(canBothRun('left', 'right')).toBe(true));

  it('keeps two exclusive branches apart', () =>
    expect(canBothRun('yes', 'no')).toBe(false));
});

describe('readDefinitionFieldAccessIssues', () => {
  it('flags a system node writing an approver-filled field by its prefixed path', () =>
    expect(
      readDefinitionFieldAccessIssues(
        definitionOf(
          [
            buildUserTask('a', [fill('x')]),
            {
              data: {
                action: {
                  fieldPath: 'form.x.y',
                  type: 'SET_FORM_FIELD',
                  value: '1',
                },
                label: 'write',
                triggerMode: 'AND',
              },
              id: 'write',
              position: { x: 0, y: 0 },
              type: 'serviceTask',
            } as WorkflowNode,
          ],
          [edge('a', 'write')],
        ),
      ).map(({ code, fieldKeys, nodeIds }) => ({ code, fieldKeys, nodeIds })),
    ).toEqual([
      {
        code: 'setFormFieldApproverFilled',
        fieldKeys: ['x'],
        nodeIds: ['write'],
      },
    ]));

  it('flags two chained fill nodes of one field once, in node order', () =>
    expect(
      readDefinitionFieldAccessIssues(
        definitionOf(
          [buildUserTask('a', [fill('x')]), buildUserTask('b', [fill('x')])],
          [edge('a', 'b')],
        ),
      ).map(({ code, fieldKeys, nodeIds }) => ({ code, fieldKeys, nodeIds })),
    ).toEqual([
      {
        code: 'approverFilledMultipleFillNodesOnPath',
        fieldKeys: ['x'],
        nodeIds: ['a', 'b'],
      },
    ]));

  it('allows fill nodes of one field on exclusive branches', () =>
    expect(
      readDefinitionFieldAccessIssues(
        definitionOf(
          [
            buildNode('choice', 'exclusiveGateway'),
            buildUserTask('a', [fill('x')]),
            buildUserTask('b', [fill('x')]),
          ],
          [edge('choice', 'a'), edge('choice', 'b')],
        ),
      ),
    ).toEqual([]));
});

describe('readFormFieldFillIssues', () => {
  it('reports nothing for a plain field', () =>
    expect(readFormFieldFillIssues(field('x'))).toEqual([]));

  it('does not count required: false as a form rule', () =>
    expect(
      readFormFieldFillIssues(field('x', 'text', { hidden: false })),
    ).toEqual([]));

  it('reports a form rule and a file upload', () =>
    expect(
      readFormFieldFillIssues(
        field('x', 'file_upload', { required: true }),
      ).map(({ code, fieldKeys }) => ({ code, fieldKeys })),
    ).toEqual([
      { code: 'approverFilledFieldFormRule', fieldKeys: ['x'] },
      { code: 'approverFilledFieldFileUpload', fieldKeys: ['x'] },
    ]));
});

describe('referencesFormField', () => {
  it.each([
    ['form.x > 1', true],
    ['formData["x"] == 1', true],
    ['has(form . x.y)', true],
    ['form.xy > 1', false],
    ['myform.x > 1', false],
    ['a.form.x > 1', false],
  ])('reads %s as %s', (expression, expected) =>
    expect(referencesFormField(expression, 'x')).toBe(expected),
  );
});

describe('readFormFieldAccessIssues', () => {
  it('reports in publish-lint order: unknown, field, boolean, applicant rule', () =>
    expect(
      readFormFieldAccessIssues(
        definitionOf(
          [buildUserTask('a', [fill('missing'), fill('upload'), fill('flag')])],
          [],
        ),
        schemaOf([
          field('upload', 'file_upload'),
          field('flag', 'boolean'),
          field('total', 'number', { visibleWhen: 'form.flag == true' }),
        ]),
      ).map(({ code, fieldKeys, nodeIds }) => ({ code, fieldKeys, nodeIds })),
    ).toEqual([
      {
        code: 'fieldAccessUnknownField',
        fieldKeys: ['missing'],
        nodeIds: ['a'],
      },
      {
        code: 'approverFilledFieldFileUpload',
        fieldKeys: ['upload'],
        nodeIds: [],
      },
      {
        code: 'approverFilledRequiredBoolean',
        fieldKeys: ['flag'],
        nodeIds: ['a'],
      },
      {
        code: 'applicantRuleReadsApproverFilled',
        fieldKeys: ['total', 'flag'],
        nodeIds: [],
      },
    ]));

  it('reads every field key as unknown without a form', () =>
    expect(
      readFormFieldAccessIssues(
        definitionOf([buildUserTask('a', [fill('x')])], []),
        null,
      ).map(({ code }) => code),
    ).toEqual(['fieldAccessUnknownField']));
});

describe('a manager chain that may skip itself, on a node with fillable fields', () => {
  const chain = { minPositionLevel: 30, type: 'ORG_MANAGER_CHAIN' } as const;
  const skipping = { ...chain, skipWhenStartReached: true };
  const continuing = {
    ...chain,
    startFrom: { nodeId: 's', type: 'CHAIN_CONTINUATION' },
  };

  it.each([
    ['skipWhenStartReached', skipping],
    ['a continuation of another chain', continuing],
  ])('reads %s as a fill conflict', (_label, approverResolver) => {
    expect(
      readUserTaskFillConflicts(
        buildUserTask('a', undefined, { approverResolver }),
      ),
    ).toEqual(['managerChainReached']);
  });

  it.each([
    ['a plain chain', chain],
    ['a chain with the flag off', { ...chain, skipWhenStartReached: false }],
    ['a chain with a null flag', { ...chain, skipWhenStartReached: null }],
    [
      'a chain from a form field',
      { ...chain, startFrom: { formPath: 'p', type: 'FORM_MEMBER' } },
    ],
  ])('reads %s as no conflict (control)', (_label, approverResolver) => {
    expect(
      readUserTaskFillConflicts(
        buildUserTask('a', undefined, { approverResolver }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['skipWhenStartReached', skipping],
    ['a continuation of another chain', continuing],
  ])(
    'reports %s once the node fills a field in',
    (_label, approverResolver) => {
      expect(
        readNodeFieldAccessIssues(
          buildUserTask('a', [fill('x')], { approverResolver }),
        ),
      ).toEqual([
        {
          code: 'fieldAccessManagerChainReached',
          fieldKeys: [],
          message: WORKFLOW_LINT_MESSAGES.fieldAccessManagerChainReached('a'),
          nodeIds: ['a'],
        },
      ]);
    },
  );

  it('says nothing when the node fills nothing in', () => {
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [fill('x', 'NONE')], {
          approverResolver: skipping,
        }),
      ),
    ).toEqual([]);
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', undefined, { approverResolver: continuing }),
      ),
    ).toEqual([]);
  });

  it('says nothing about a plain chain that fills a field in (control)', () => {
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [fill('x')], { approverResolver: chain }),
      ),
    ).toEqual([]);
  });

  it('comes last among the fill conflicts', () => {
    expect(
      readNodeFieldAccessIssues(
        buildUserTask('a', [fill('x')], {
          approverResolver: skipping,
          decisionPolicy: { type: 'QUORUM' },
          excludeInitiator: { whenEmpty: 'SKIP_NODE' },
          sla: { onTimeout: 'AUTO_APPROVE' },
        }),
      ).map(({ code }) => code),
    ).toEqual([
      'fieldAccessGroupPolicy',
      'fieldAccessAutoApprove',
      'fieldAccessSkipNode',
      'fieldAccessManagerChainReached',
    ]);
  });

  it('words the publish-lint line', () => {
    expect(WORKFLOW_LINT_MESSAGES.fieldAccessManagerChainReached('n1')).toBe(
      'workflow.nodes.n1.approverResolver cannot set skipWhenStartReached or continue another chain on a node with fillable fields',
    );
  });
});
