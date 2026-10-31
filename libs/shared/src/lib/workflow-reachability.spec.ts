import * as fieldAccessLint from './field-access-lint';
import {
  isOnOwnParallelBranch,
  readReachableWorkflowNodeIds,
  readWorkflowParallelBranchSets,
} from './workflow-reachability';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './workflow';

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

const definitionOf = (
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowDefinition => ({
  edges: [...edges],
  meta: { schemaVersion: 1 },
  nodes: [...nodes],
});

// start -> split -> (left | right) -> join -> after, plus left -> leftNext
const PARALLEL = definitionOf(
  [
    buildNode('start', 'startEvent'),
    buildNode('split', 'parallelGateway'),
    buildNode('left', 'userTask'),
    buildNode('leftNext', 'userTask'),
    buildNode('right', 'userTask'),
    buildNode('join', 'parallelGateway'),
    buildNode('after', 'userTask'),
  ],
  [
    edge('start', 'split'),
    edge('split', 'left'),
    edge('split', 'right'),
    edge('left', 'leftNext'),
    edge('leftNext', 'join'),
    edge('right', 'join'),
    edge('join', 'after'),
  ],
);

describe('workflow-reachability', () => {
  it('re-exports the same functions from field-access-lint', () => {
    expect(fieldAccessLint.readReachableWorkflowNodeIds).toBe(
      readReachableWorkflowNodeIds,
    );
    expect(fieldAccessLint.readWorkflowParallelBranchSets).toBe(
      readWorkflowParallelBranchSets,
    );
    expect(fieldAccessLint.isOnOwnParallelBranch).toBe(isOnOwnParallelBranch);
  });

  describe('readWorkflowParallelBranchSets', () => {
    it('gives one reachable set per outgoing edge of a split, in edge order', () => {
      const [branches] = readWorkflowParallelBranchSets(PARALLEL);

      expect(branches.map((branch) => [...branch].sort())).toEqual([
        ['after', 'join', 'left', 'leftNext'],
        ['after', 'join', 'right'],
      ]);
    });

    it('ignores a split with fewer than two branches and non-parallel gateways', () => {
      const lonely = definitionOf(
        [
          buildNode('s', 'startEvent'),
          buildNode('split', 'parallelGateway'),
          buildNode('x', 'userTask'),
          buildNode('choice', 'exclusiveGateway'),
          buildNode('y', 'userTask'),
          buildNode('z', 'userTask'),
        ],
        [
          edge('s', 'split'),
          edge('split', 'x'),
          edge('s', 'choice'),
          edge('choice', 'y'),
          edge('choice', 'z'),
        ],
      );

      expect(readWorkflowParallelBranchSets(lonely)).toEqual([]);
    });
  });

  describe('isOnOwnParallelBranch', () => {
    const [branches] = readWorkflowParallelBranchSets(PARALLEL);

    it('is true for nodes that live only on different branches', () => {
      expect(isOnOwnParallelBranch(branches, 'left', 'right')).toBe(true);
      expect(isOnOwnParallelBranch(branches, 'right', 'leftNext')).toBe(true);
    });

    it('is false for two nodes in a row on one branch', () => {
      expect(isOnOwnParallelBranch(branches, 'left', 'leftNext')).toBe(false);
    });

    it('is false when one node lies after the join, which every branch reaches', () => {
      expect(isOnOwnParallelBranch(branches, 'left', 'after')).toBe(false);
      expect(isOnOwnParallelBranch(branches, 'join', 'after')).toBe(false);
    });
  });
});
