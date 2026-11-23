import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowEdgeData,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  isIncompleteConditionEdge,
  readDesignerWorkflowIssue,
  readEdgeCanvasLabel,
} from './designer-workflow-issue';

/** `undefined` leaves `direction` out, as a definition that skipped the type would. */
type DirectionInput = 'join' | 'merge' | 'split' | undefined;

type GatewayType = 'exclusiveGateway' | 'parallelGateway';

const MISSING_CONDITION_ISSUE = '條件分流的每條輸出連線都需要先設定條件。';

const POSITION = { x: 0, y: 0 } as const;

function gatewayNode(
  type: GatewayType,
  direction: DirectionInput,
): WorkflowNode {
  return {
    data: {
      ...(direction === undefined ? {} : { direction }),
      label: '閘道',
      triggerMode: 'AND',
    },
    id: 'gw',
    position: POSITION,
    type,
  } as unknown as WorkflowNode;
}

/** start → gw → end (→ end2 when the gateway has a second outgoing edge). */
function gatewayDefinition(
  type: GatewayType,
  direction: DirectionInput,
  outgoing: readonly WorkflowEdgeData[],
): WorkflowDefinition {
  return {
    edges: [
      { data: {}, id: 'e0', source: 'start', target: 'gw' },
      ...outgoing.map((data, index): WorkflowEdge => ({
        data,
        id: `e${index + 1}`,
        source: 'gw',
        target: index === 0 ? 'end' : `end${index + 1}`,
      })),
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: POSITION,
        type: 'startEvent',
      },
      gatewayNode(type, direction),
      ...outgoing.map((_data, index): WorkflowNode => ({
        data: {
          endState: 'APPROVED',
          label: '完成',
          triggerMode: 'AND',
        },
        id: index === 0 ? 'end' : `end${index + 1}`,
        position: POSITION,
        type: 'endEvent',
      })),
    ],
  };
}

function readEdge(
  definition: WorkflowDefinition,
  edgeId: string,
): WorkflowEdge {
  const edge = definition.edges.find((candidate) => candidate.id === edgeId);

  if (!edge) {
    throw new Error(`fixture has no edge ${edgeId}`);
  }

  return edge;
}

describe('readDesignerWorkflowIssue — exclusive gateway outgoing edges', () => {
  it.each<
    readonly [
      string,
      string,
      DirectionInput,
      readonly WorkflowEdgeData[],
      string | null,
    ]
  >([
    [
      'R1',
      'split, one edge with no condition',
      'split',
      [{}],
      MISSING_CONDITION_ISSUE,
    ],
    [
      'R2',
      'join, two edges with no condition',
      'join',
      [{}, {}],
      MISSING_CONDITION_ISSUE,
    ],
    [
      'R3',
      'split, every edge has a condition, no default (the designer still saves it)',
      'split',
      [{ condition: 'form.amount > 100' }, { condition: 'form.amount <= 100' }],
      null,
    ],
    [
      'R8',
      'missing direction, two edges with no condition',
      undefined,
      [{}, {}],
      MISSING_CONDITION_ISSUE,
    ],
  ])('%s — %s', (_id, _name, direction, outgoing, expected) => {
    expect(
      readDesignerWorkflowIssue(
        gatewayDefinition('exclusiveGateway', direction, outgoing),
      ),
    ).toBe(expected);
  });
});

describe('readEdgeCanvasLabel', () => {
  it.each<
    readonly [
      string,
      string,
      GatewayType,
      DirectionInput,
      readonly WorkflowEdgeData[],
      string,
      string | undefined,
    ]
  >([
    [
      'R4a',
      'an edge with its own label',
      'exclusiveGateway',
      'split',
      [{ label: '金額>10萬' }],
      'e1',
      '金額>10萬',
    ],
    [
      'R4b',
      'split, no label, no condition',
      'exclusiveGateway',
      'split',
      [{}],
      'e1',
      '請設定條件',
    ],
    [
      'R4c',
      'join, one edge, the default',
      'exclusiveGateway',
      'join',
      [{ isDefault: true }],
      'e1',
      '其他情況',
    ],
    [
      'R4d',
      'join, one edge with a condition and no label',
      'exclusiveGateway',
      'join',
      [{ condition: 'form.amount > 100' }],
      'e1',
      '請設定條件',
    ],
    [
      'R4e',
      'an edge leaving a parallel gateway',
      'parallelGateway',
      'split',
      [{}],
      'e1',
      '同時進行',
    ],
    [
      'R4f',
      'a plain edge, not leaving a gateway',
      'exclusiveGateway',
      'split',
      [{}],
      'e0',
      undefined,
    ],
    [
      'R9d',
      'missing direction, two edges with no condition',
      'exclusiveGateway',
      undefined,
      [{}, {}],
      'e1',
      '請設定條件',
    ],
  ])('%s — %s', (_id, _name, type, direction, outgoing, edgeId, expected) => {
    const definition = gatewayDefinition(type, direction, outgoing);

    expect(readEdgeCanvasLabel(readEdge(definition, edgeId), definition)).toBe(
      expected,
    );
  });
});

describe('isIncompleteConditionEdge', () => {
  it.each<
    readonly [
      string,
      string,
      DirectionInput,
      readonly WorkflowEdgeData[],
      boolean,
    ]
  >([
    ['R5a', 'split, no condition', 'split', [{}], true],
    ['R5b', 'split, the default', 'split', [{ isDefault: true }], false],
    [
      'R5c',
      'split, has a condition',
      'split',
      [{ condition: 'form.amount > 100' }],
      false,
    ],
    ['R5d', 'join, two edges with no condition', 'join', [{}, {}], true],
  ])('%s — %s', (_id, _name, direction, outgoing, expected) => {
    const definition = gatewayDefinition(
      'exclusiveGateway',
      direction,
      outgoing,
    );

    expect(
      isIncompleteConditionEdge(readEdge(definition, 'e1'), definition),
    ).toBe(expected);
  });
});
