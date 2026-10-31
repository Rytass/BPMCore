import {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { readNodeActorSourceIssues } from '@rytass/bpm-core-shared/workflow-graph';
import {
  NO_UPSTREAM_USER_TASK_HINT,
  readNodeActorGraphIssues,
  readNodeActorStageChoice,
} from './node-actor-resolver-options';

function taskNode(
  id: string,
  data: Readonly<Record<string, unknown>> = {},
): WorkflowNode {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['m1'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label: `關卡 ${id}`,
      returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      ...data,
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  } as WorkflowNode;
}

function plainNode(id: string, type: WorkflowNode['type']): WorkflowNode {
  return {
    data: { label: id },
    id,
    position: { x: 0, y: 0 },
    type,
  } as WorkflowNode;
}

function link(source: string, target: string): WorkflowEdge {
  return { data: {}, id: `${source}-${target}`, source, target };
}

function graph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowDefinition {
  return {
    edges: [...edges],
    meta: { schemaVersion: 1 },
    nodes: [...nodes],
  };
}

// start -> a -> b -> me -> after -> end, with `side` off the line and `svc` a
// service task between a and b.
const LINE = graph(
  [
    plainNode('start', 'startEvent'),
    taskNode('a'),
    plainNode('svc', 'serviceTask'),
    taskNode('b'),
    taskNode('me'),
    taskNode('after'),
    taskNode('side'),
    plainNode('end', 'endEvent'),
  ],
  [
    link('start', 'a'),
    link('a', 'svc'),
    link('svc', 'b'),
    link('b', 'me'),
    link('me', 'after'),
    link('after', 'end'),
    link('start', 'side'),
    link('side', 'end'),
  ],
);

describe('readNodeActorStageChoice', () => {
  it('lists the user tasks upstream of the node, in definition order, by label', () => {
    const choice = readNodeActorStageChoice(LINE, 'me', []);

    expect(choice.options).toEqual([
      { id: 'a', name: '關卡 a' },
      { id: 'b', name: '關卡 b' },
    ]);
    expect(choice.selected).toEqual([]);
  });

  it('leaves out the node itself, later nodes, off-path nodes and non-user-task nodes', () => {
    const ids = readNodeActorStageChoice(LINE, 'me', []).options.map(
      (option) => option.id,
    );

    expect(ids).not.toContain('me');
    expect(ids).not.toContain('after');
    expect(ids).not.toContain('side');
    expect(ids).not.toContain('svc');
    expect(ids).not.toContain('start');
  });

  it('leaves out a stage with an entry condition or 跳過此關', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        taskNode('plain'),
        taskNode('conditional', { entryCondition: 'form.x == 1' }),
        taskNode('skippable', {
          excludeInitiator: { whenEmpty: 'SKIP_NODE' },
        }),
        taskNode('fallsBack', {
          excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
        }),
        taskNode('blankCondition', { entryCondition: '   ' }),
        taskNode('me'),
        plainNode('end', 'endEvent'),
      ],
      [
        link('start', 'plain'),
        link('plain', 'conditional'),
        link('conditional', 'skippable'),
        link('skippable', 'fallsBack'),
        link('fallsBack', 'blankCondition'),
        link('blankCondition', 'me'),
        link('me', 'end'),
      ],
    );

    expect(
      readNodeActorStageChoice(definition, 'me', []).options.map(
        (option) => option.id,
      ),
    ).toEqual(['plain', 'fallsBack', 'blankCondition']);
  });

  it('offers both mutually exclusive branches (整組問題不逐一過濾)', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        plainNode('gw', 'exclusiveGateway'),
        taskNode('act3'),
        taskNode('act4'),
        taskNode('me'),
        plainNode('end', 'endEvent'),
      ],
      [
        link('start', 'gw'),
        link('gw', 'act3'),
        link('gw', 'act4'),
        link('act3', 'me'),
        link('act4', 'me'),
        link('me', 'end'),
      ],
    );

    expect(
      readNodeActorStageChoice(definition, 'me', ['act3']).options.map(
        (option) => option.id,
      ),
    ).toEqual(['act3', 'act4']);
  });

  it('reports the whole-group problems live for the selection', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        plainNode('gw', 'exclusiveGateway'),
        taskNode('act3'),
        taskNode('act4'),
        taskNode('me'),
        plainNode('end', 'endEvent'),
      ],
      [
        link('start', 'gw'),
        link('gw', 'act3'),
        link('gw', 'act4'),
        link('act3', 'me'),
        link('act4', 'me'),
        link('me', 'end'),
      ],
    );
    const onlyOne = readNodeActorStageChoice(definition, 'me', ['act3']);
    const both = readNodeActorStageChoice(definition, 'me', ['act3', 'act4']);

    expect(onlyOne.problems).toEqual(
      readNodeActorSourceIssues(definition, 'me', ['act3']),
    );
    expect(onlyOne.problems).toHaveLength(1);
    expect(onlyOne.problems[0]).toContain('不會經過所選的前面關卡');
    expect(both.problems).toEqual([]);
  });

  it('keeps a selected stage that no longer qualifies visible, with its problem', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        taskNode('a', { entryCondition: 'form.x == 1' }),
        taskNode('me'),
        plainNode('end', 'endEvent'),
      ],
      [link('start', 'a'), link('a', 'me'), link('me', 'end')],
    );
    const choice = readNodeActorStageChoice(definition, 'me', ['a']);

    expect(choice.options).toEqual([{ id: 'a', name: '關卡 a（無法使用）' }]);
    expect(choice.selected).toEqual([{ id: 'a', name: '關卡 a（無法使用）' }]);
    expect(choice.problems.join('')).toContain('設有進入條件');
  });

  it('keeps a deleted stage visible by id', () => {
    const choice = readNodeActorStageChoice(LINE, 'me', ['a', 'removed']);

    expect(choice.selected).toEqual([
      { id: 'a', name: '關卡 a' },
      { id: 'removed', name: 'removed（已不存在）' },
    ]);
    expect(choice.options.map((option) => option.id)).toEqual([
      'a',
      'b',
      'removed',
    ]);
    expect(choice.problems).toEqual(
      readNodeActorSourceIssues(LINE, 'me', ['a', 'removed']),
    );
  });

  it('says so when nothing upstream can be picked, and stays quiet on an empty pick otherwise', () => {
    const first = readNodeActorStageChoice(LINE, 'a', []);

    expect(first.options).toEqual([]);
    expect(first.problems).toEqual([NO_UPSTREAM_USER_TASK_HINT]);
    expect(readNodeActorStageChoice(LINE, 'me', []).problems).toEqual([]);
  });

  it('falls back to the node id when a stage has no label', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        taskNode('a', { label: '' }),
        taskNode('me'),
        plainNode('end', 'endEvent'),
      ],
      [link('start', 'a'), link('a', 'me'), link('me', 'end')],
    );

    expect(readNodeActorStageChoice(definition, 'me', []).options).toEqual([
      { id: 'a', name: 'a' },
    ]);
  });
});

describe('readNodeActorGraphIssues', () => {
  const nodeActorNode = (
    id: string,
    nodeIds: readonly string[],
    type: 'NODE_ACTOR' | 'NODE_ACTOR_MANAGER' = 'NODE_ACTOR',
  ): WorkflowNode =>
    taskNode(id, {
      approverResolver:
        type === 'NODE_ACTOR'
          ? { nodeIds, type }
          : { levelsUp: 1, nodeIds, type },
    });
  const lineWith = (me: WorkflowNode): WorkflowDefinition =>
    graph(
      [
        plainNode('start', 'startEvent'),
        taskNode('a'),
        me,
        plainNode('end', 'endEvent'),
      ],
      [link('start', 'a'), link('a', me.id), link(me.id, 'end')],
    );

  it('is empty when every prior-node source is sound', () => {
    expect(
      readNodeActorGraphIssues(lineWith(nodeActorNode('me', ['a']))),
    ).toEqual([]);
    expect(
      readNodeActorGraphIssues(
        lineWith(nodeActorNode('me', ['a'], 'NODE_ACTOR_MANAGER')),
      ),
    ).toEqual([]);
  });

  it('names the node and the problem for NODE_ACTOR and NODE_ACTOR_MANAGER nodes', () => {
    const issues = readNodeActorGraphIssues(
      lineWith(nodeActorNode('me', ['removed'])),
    );

    expect(issues).toEqual([
      '簽核節點「關卡 me」：簽核來源的前面關卡「removed」不存在。',
    ]);
    expect(
      readNodeActorGraphIssues(
        lineWith(nodeActorNode('me', ['removed'], 'NODE_ACTOR_MANAGER')),
      ),
    ).toHaveLength(1);
  });

  it('collects every problem line of a node, and of every such node', () => {
    const definition = graph(
      [
        plainNode('start', 'startEvent'),
        taskNode('a', { entryCondition: 'form.x == 1' }),
        nodeActorNode('me', ['a']),
        nodeActorNode('me2', ['me2']),
        plainNode('end', 'endEvent'),
      ],
      [
        link('start', 'a'),
        link('a', 'me'),
        link('me', 'me2'),
        link('me2', 'end'),
      ],
    );
    const issues = readNodeActorGraphIssues(definition);

    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(
      issues.some((issue) => issue.startsWith('簽核節點「關卡 me」：')),
    ).toBe(true);
    expect(
      issues.some((issue) => issue.startsWith('簽核節點「關卡 me2」：')),
    ).toBe(true);
  });

  it('ignores every other source, including an empty list (the resolver check owns that)', () => {
    expect(
      readNodeActorGraphIssues(
        lineWith(
          taskNode('me', {
            approverResolver: { memberIds: [], type: 'DIRECT' },
          }),
        ),
      ),
    ).toEqual([]);
    expect(readNodeActorGraphIssues(lineWith(nodeActorNode('me', [])))).toEqual(
      [],
    );
  });

  it('falls back to the node id for an unlabelled node', () => {
    const definition = lineWith(
      taskNode('me', {
        approverResolver: { nodeIds: ['removed'], type: 'NODE_ACTOR' },
        label: '',
      }),
    );

    expect(readNodeActorGraphIssues(definition)[0]).toMatch(
      /^簽核節點「me」：/u,
    );
  });
});
