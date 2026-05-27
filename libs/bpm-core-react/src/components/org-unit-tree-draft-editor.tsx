'use client';

import {
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  Background,
  Connection,
  ConnectionMode,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  NodeTypes,
  OnNodeDrag,
  OnNodesChange,
  Position,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react';
import * as dagre from 'dagre';
import { Button, Typography } from '@mezzanine-ui/react';
import { EditIcon, PlusIcon } from '@mezzanine-ui/icons';
import type { OrgUnitRecord, OrgUnitType } from '@rytass/bpm-core-client/organization';
import {
  OrgUnitHierarchyDraftChange,
  OrgUnitParentDraftMap,
  assignOrgUnitDraftParent,
  createOrgUnitParentDraftMap,
  readOrgUnitHierarchyDraftChanges,
  readOrgUnitParentValidationMessage,
} from '../lib/org-tree-draft';
import styles from './org-unit-tree-draft-editor.module.scss';

type OrgUnitTreeFlowData = Readonly<{
  changed: boolean;
  code: string;
  deleted: boolean;
  isEditing: boolean;
  isSyntheticRoot: boolean;
  name: string;
  onCreateChild: (parentId: string | null) => void;
  onEdit: (orgUnitId: string) => void;
  orgUnitId: string | null;
  parentLabel: string;
  path: string;
  typeLabel: string;
}>;

type OrgUnitTreeNode = Node<OrgUnitTreeFlowData, 'orgUnit'>;
type OrgUnitTreeEdge = Edge<Record<string, never>>;

export type OrgUnitTreeDraftEditorHandle = Readonly<{
  cancelEditing: () => void;
  saveDraft: () => Promise<void>;
  startEditing: () => void;
}>;

export type OrgUnitTreeDraftEditorState = Readonly<{
  hasDraftChanges: boolean;
  isEditing: boolean;
}>;

type OrgUnitTreeDraftEditorProps = Readonly<{
  onCreateChild: (parentId: string) => void;
  onCreateRoot: () => void;
  onEditOrgUnit: (orgUnit: OrgUnitRecord) => void;
  onSaveDraft?: (
    changes: readonly OrgUnitHierarchyDraftChange[],
  ) => Promise<void>;
  onStateChange: (state: OrgUnitTreeDraftEditorState) => void;
  orgUnits: readonly OrgUnitRecord[];
  saving: boolean;
}>;

const ORG_TREE_ROOT_ID = '__org-tree-root__';
const ORG_TREE_NODE_WIDTH = 232;
const ORG_TREE_NODE_HEIGHT = 118;
const ORG_TREE_ROOT_WIDTH = 232;
const ORG_TREE_ROOT_HEIGHT = 86;
const ORG_TREE_DROP_DISTANCE = 320;

const ORG_UNIT_TYPE_LABELS: Readonly<Record<Uppercase<OrgUnitType>, string>> = {
  COMPANY: '公司',
  DEPARTMENT: '部門',
  DIVISION: '事業群',
  TEAM: '小組',
};

const orgUnitTreeNodeTypes: NodeTypes = {
  orgUnit: OrgUnitTreeNodeCard,
};

export const OrgUnitTreeDraftEditor = forwardRef<
  OrgUnitTreeDraftEditorHandle,
  OrgUnitTreeDraftEditorProps
>(function OrgUnitTreeDraftEditor(
  {
    onCreateChild,
    onCreateRoot,
    onEditOrgUnit,
    onSaveDraft,
    onStateChange,
    orgUnits,
  },
  ref,
): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [selectedOrgUnitId, setSelectedOrgUnitId] = useState<string | null>(
    null,
  );
  const [parentDraft, setParentDraft] = useState<OrgUnitParentDraftMap>(() =>
    createOrgUnitParentDraftMap(orgUnits),
  );
  const [flowNodes, setFlowNodes] = useState<readonly OrgUnitTreeNode[]>([]);

  const orgUnitsById = useMemo(
    (): ReadonlyMap<string, OrgUnitRecord> =>
      new Map(orgUnits.map((orgUnit) => [orgUnit.id, orgUnit])),
    [orgUnits],
  );
  const draftChanges = useMemo(
    (): readonly OrgUnitHierarchyDraftChange[] =>
      readOrgUnitHierarchyDraftChanges({ orgUnits, parentDraft }),
    [orgUnits, parentDraft],
  );
  const flowElements = useMemo(
    (): Readonly<{
      edges: readonly OrgUnitTreeEdge[];
      nodes: readonly OrgUnitTreeNode[];
    }> =>
      createOrgUnitTreeFlowElements({
        isEditing,
        onCreateChild: (parentId): void => {
          if (parentId) {
            onCreateChild(parentId);
          } else {
            onCreateRoot();
          }
        },
        onEditOrgUnit: (orgUnitId): void => {
          const orgUnit = orgUnitsById.get(orgUnitId);

          if (orgUnit) {
            onEditOrgUnit(orgUnit);
          }
        },
        orgUnits,
        orgUnitsById,
        parentDraft,
        selectedOrgUnitId,
      }),
    [
      isEditing,
      onCreateChild,
      onCreateRoot,
      onEditOrgUnit,
      orgUnits,
      orgUnitsById,
      parentDraft,
      selectedOrgUnitId,
    ],
  );
  const hasDraftChanges = draftChanges.length > 0;

  useImperativeHandle(
    ref,
    (): OrgUnitTreeDraftEditorHandle => ({
      cancelEditing,
      saveDraft,
      startEditing,
    }),
  );

  useEffect((): void => {
    onStateChange({ hasDraftChanges, isEditing });
  }, [hasDraftChanges, isEditing, onStateChange]);

  useEffect((): void => {
    setParentDraft(createOrgUnitParentDraftMap(orgUnits));
    setSelectedOrgUnitId(null);
    setDraftMessage(null);
    setIsEditing(false);
  }, [orgUnits]);

  useEffect((): void => {
    setFlowNodes(flowElements.nodes);
  }, [flowElements.nodes]);

  const assignDraftParent = useCallback(
    (orgUnitId: string, parentId: string | null): void => {
      setParentDraft((currentDraft) => {
        const result = assignOrgUnitDraftParent({
          orgUnitId,
          parentDraft: currentDraft,
          parentId,
        });

        setDraftMessage(result.message);

        return result.parentDraft;
      });
    },
    [],
  );

  const handleConnect = useCallback(
    (connection: Connection): void => {
      if (!isEditing || !connection.target || !connection.source) {
        return;
      }

      const nextParentId =
        connection.source === ORG_TREE_ROOT_ID ? null : connection.source;

      if (connection.target === ORG_TREE_ROOT_ID) {
        setDraftMessage('根節點不能搬移到其他節點下。');
        return;
      }

      assignDraftParent(connection.target, nextParentId);
    },
    [assignDraftParent, isEditing],
  );

  const handleNodeChanges = useCallback<OnNodesChange<OrgUnitTreeNode>>(
    (changes): void => {
      if (!isEditing) {
        return;
      }

      setFlowNodes((currentNodes) =>
        applyNodeChanges(changes, [...currentNodes]),
      );
    },
    [isEditing],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<OrgUnitTreeNode>>(
    (event, node, nodes): void => {
      if (!isEditing || node.id === ORG_TREE_ROOT_ID) {
        return;
      }

      const nearestParent =
        readNearestParentNodeIdFromPointer(event, node.id) ??
        readNearestParentNodeId(node, nodes);

      if (nearestParent === undefined) {
        setDraftMessage('拖曳到目標父節點附近，或從父節點拉線到子節點。');
        return;
      }

      assignDraftParent(
        node.id,
        nearestParent === ORG_TREE_ROOT_ID ? null : nearestParent,
      );
    },
    [assignDraftParent, isEditing],
  );

  function startEditing(): void {
    setIsEditing(true);
    setParentDraft(createOrgUnitParentDraftMap(orgUnits));
    setDraftMessage('已進入編輯模式，拖曳節點或拉線只會更新前端草稿。');
  }

  function cancelEditing(): void {
    setIsEditing(false);
    setParentDraft(createOrgUnitParentDraftMap(orgUnits));
    setDraftMessage('已取消草稿變更。');
  }

  async function saveDraft(): Promise<void> {
    if (!onSaveDraft) {
      setDraftMessage('批次儲存 API 尚未接上，草稿仍保留在前端。');
      return;
    }

    await onSaveDraft(draftChanges);
    setIsEditing(false);
    setDraftMessage('組織樹草稿已儲存。');
  }

  return (
    <div className={styles.orgTreeEditor}>
      <div className={styles.orgTreeSummary}>
        <Typography color="text-neutral" variant="caption">
          {draftMessage ??
            (hasDraftChanges
              ? `目前有 ${draftChanges.length} 筆父子關係草稿變更。`
              : '目前沒有草稿變更。')}
        </Typography>
        {hasDraftChanges ? (
          <ul className={styles.orgTreeChangeList}>
            {draftChanges.map((change) => (
              <li key={change.orgUnitId}>
                {readOrgUnitName(change.orgUnitId, orgUnitsById)}
                {'：'}
                {readOrgUnitName(change.previousParentId, orgUnitsById)}
                {' -> '}
                {readOrgUnitName(change.parentId, orgUnitsById)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className={styles.orgTreeCanvas}>
        <ReactFlow
          connectionMode={ConnectionMode.Strict}
          edges={[...flowElements.edges]}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          isValidConnection={(connection): boolean =>
            isOrgTreeConnectionValid(
              { source: connection.source, target: connection.target },
              parentDraft,
            )
          }
          maxZoom={1.4}
          minZoom={0.25}
          nodeTypes={orgUnitTreeNodeTypes}
          nodes={[...flowNodes]}
          nodesConnectable={isEditing}
          nodesDraggable={isEditing}
          onConnect={handleConnect}
          onNodeClick={(_, node): void => {
            setSelectedOrgUnitId(node.id === ORG_TREE_ROOT_ID ? null : node.id);
          }}
          onNodeDoubleClick={(_, node): void => {
            if (node.id !== ORG_TREE_ROOT_ID) {
              const orgUnit = orgUnitsById.get(node.id);

              if (orgUnit) {
                onEditOrgUnit(orgUnit);
              }
            }
          }}
          onNodeDragStop={handleNodeDragStop}
          onNodesChange={handleNodeChanges}
          onPaneClick={(): void => setSelectedOrgUnitId(null)}
          panOnDrag
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
});

function OrgUnitTreeNodeCard({
  data,
  selected,
}: NodeProps<OrgUnitTreeNode>): ReactElement {
  return (
    <div
      className={[
        styles.orgTreeNode,
        data.isSyntheticRoot ? styles.orgTreeNodeRoot : '',
        data.changed ? styles.orgTreeNodeChanged : '',
        data.deleted ? styles.orgTreeNodeDeleted : '',
        selected ? styles.orgTreeNodeSelected : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {data.isSyntheticRoot ? null : (
        <Handle
          id="target"
          isConnectable={data.isEditing}
          position={Position.Top}
          type="target"
        />
      )}
      <Handle
        id="source"
        isConnectable={data.isEditing}
        position={Position.Bottom}
        type="source"
      />
      <div className={styles.orgTreeNodeHeader}>
        <Typography
          component="span"
          ellipsis
          title={data.name}
          variant="label-primary"
        >
          {data.name}
        </Typography>
        {data.changed ? (
          <span className={styles.orgTreeNodeBadge}>草稿</span>
        ) : null}
      </div>
      <Typography
        color="text-neutral"
        component="span"
        ellipsis
        title={data.code}
        variant="caption"
      >
        {data.isSyntheticRoot
          ? '根節點容器'
          : `${data.typeLabel} · ${data.code}`}
      </Typography>
      {data.isSyntheticRoot ? null : (
        <Typography
          color="text-neutral"
          component="span"
          ellipsis
          title={data.parentLabel}
          variant="caption"
        >
          上層：{data.parentLabel}
        </Typography>
      )}
      <div className={styles.orgTreeNodeActions}>
        {data.isSyntheticRoot ? (
          <Button
            icon={PlusIcon}
            iconType="leading"
            onClick={(): void => data.onCreateChild(null)}
            size="sub"
            variant="base-secondary"
          >
            新增根節點
          </Button>
        ) : (
          <>
            <Button
              icon={EditIcon}
              iconType="leading"
              onClick={(): void => {
                if (data.orgUnitId) {
                  data.onEdit(data.orgUnitId);
                }
              }}
              size="sub"
              variant="base-secondary"
            >
              編輯
            </Button>
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={(): void => data.onCreateChild(data.orgUnitId)}
              size="sub"
              variant="base-secondary"
            >
              新增子節點
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function createOrgUnitTreeFlowElements({
  isEditing,
  onCreateChild,
  onEditOrgUnit,
  orgUnits,
  orgUnitsById,
  parentDraft,
  selectedOrgUnitId,
}: {
  readonly isEditing: boolean;
  readonly onCreateChild: (parentId: string | null) => void;
  readonly onEditOrgUnit: (orgUnitId: string) => void;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly orgUnitsById: ReadonlyMap<string, OrgUnitRecord>;
  readonly parentDraft: OrgUnitParentDraftMap;
  readonly selectedOrgUnitId: string | null;
}): Readonly<{
  edges: readonly OrgUnitTreeEdge[];
  nodes: readonly OrgUnitTreeNode[];
}> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ marginx: 36, marginy: 36, nodesep: 44, rankdir: 'TB' });
  graph.setNode(ORG_TREE_ROOT_ID, {
    height: ORG_TREE_ROOT_HEIGHT,
    width: ORG_TREE_ROOT_WIDTH,
  });
  orgUnits.forEach((orgUnit): void => {
    graph.setNode(orgUnit.id, {
      height: ORG_TREE_NODE_HEIGHT,
      width: ORG_TREE_NODE_WIDTH,
    });
  });
  orgUnits.forEach((orgUnit): void => {
    const parentId = parentDraft.get(orgUnit.id) ?? null;
    graph.setEdge(parentId ?? ORG_TREE_ROOT_ID, orgUnit.id);
  });
  dagre.layout(graph);

  const rootNode = createOrgUnitTreeNode({
    data: {
      changed: false,
      code: ORG_TREE_ROOT_ID,
      deleted: false,
      isEditing,
      isSyntheticRoot: true,
      name: '組織根節點',
      onCreateChild,
      onEdit: onEditOrgUnit,
      orgUnitId: null,
      parentLabel: '',
      path: '',
      typeLabel: '',
    },
    graph,
    height: ORG_TREE_ROOT_HEIGHT,
    id: ORG_TREE_ROOT_ID,
    selected: selectedOrgUnitId === null,
    width: ORG_TREE_ROOT_WIDTH,
  });
  const orgNodes = orgUnits.map((orgUnit): OrgUnitTreeNode => {
    const parentId = parentDraft.get(orgUnit.id) ?? null;
    const parentLabel = readOrgUnitName(parentId, orgUnitsById);

    return createOrgUnitTreeNode({
      data: {
        changed: parentId !== orgUnit.parentId,
        code: orgUnit.code,
        deleted: Boolean(orgUnit.deletedAt),
        isEditing,
        isSyntheticRoot: false,
        name: orgUnit.name,
        onCreateChild,
        onEdit: onEditOrgUnit,
        orgUnitId: orgUnit.id,
        parentLabel,
        path: orgUnit.path,
        typeLabel: readOrgUnitTypeLabel(orgUnit.type),
      },
      graph,
      height: ORG_TREE_NODE_HEIGHT,
      id: orgUnit.id,
      selected: selectedOrgUnitId === orgUnit.id,
      width: ORG_TREE_NODE_WIDTH,
    });
  });
  const edges = orgUnits.map((orgUnit): OrgUnitTreeEdge => {
    const parentId = parentDraft.get(orgUnit.id) ?? null;
    const changed = parentId !== orgUnit.parentId;

    return {
      animated: isEditing && changed,
      data: {},
      id: `org-tree-edge-${parentId ?? 'root'}-${orgUnit.id}`,
      source: parentId ?? ORG_TREE_ROOT_ID,
      sourceHandle: 'source',
      style: changed
        ? { stroke: 'var(--mzn-color-primary, #0057ff)', strokeWidth: 2 }
        : undefined,
      target: orgUnit.id,
      targetHandle: 'target',
      type: 'smoothstep',
    };
  });

  return {
    edges,
    nodes: [rootNode, ...orgNodes],
  };
}

function createOrgUnitTreeNode({
  data,
  graph,
  height,
  id,
  selected,
  width,
}: {
  readonly data: OrgUnitTreeFlowData;
  readonly graph: dagre.graphlib.Graph;
  readonly height: number;
  readonly id: string;
  readonly selected: boolean;
  readonly width: number;
}): OrgUnitTreeNode {
  const positionedNode = graph.node(id) as
    | Readonly<{ x: number; y: number }>
    | undefined;

  return {
    data,
    height,
    id,
    initialHeight: height,
    initialWidth: width,
    position: positionedNode
      ? {
          x: positionedNode.x - width / 2,
          y: positionedNode.y - height / 2,
        }
      : { x: 0, y: 0 },
    selected,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    type: 'orgUnit',
    width,
  };
}

function readNearestParentNodeId(
  draggedNode: OrgUnitTreeNode,
  nodes: readonly OrgUnitTreeNode[],
): string | undefined {
  const draggedCenter = readNodeCenter(draggedNode);
  const candidates = nodes
    .filter((node) => node.id !== draggedNode.id)
    .map(
      (node): Readonly<{ distance: number; id: string }> => ({
        distance: readDistance(draggedCenter, readNodeCenter(node)),
        id: node.id,
      }),
    )
    .filter((candidate) => candidate.distance <= ORG_TREE_DROP_DISTANCE)
    .sort((left, right) => left.distance - right.distance);

  return candidates[0]?.id;
}

function readNearestParentNodeIdFromPointer(
  event: unknown,
  draggedNodeId: string,
): string | undefined {
  const point = readPointerPoint(event);

  if (!point) {
    return undefined;
  }

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]'),
  )
    .map((element): Readonly<{ distance: number; id: string }> | null => {
      const id = element.dataset['id'];

      if (!id || id === draggedNodeId) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      return {
        distance: readDistance(point, center),
        id,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is Readonly<{ distance: number; id: string }> =>
        Boolean(candidate),
    )
    .filter((candidate) => candidate.distance <= ORG_TREE_DROP_DISTANCE)
    .sort((left, right) => left.distance - right.distance);

  return candidates[0]?.id;
}

function readPointerPoint(
  event: unknown,
): Readonly<{ x: number; y: number }> | null {
  if (!isPointerEventLike(event)) {
    return null;
  }

  return { x: event.clientX, y: event.clientY };
}

function isPointerEventLike(
  event: unknown,
): event is Readonly<{ clientX: number; clientY: number }> {
  return (
    typeof event === 'object' &&
    event !== null &&
    'clientX' in event &&
    'clientY' in event &&
    typeof event.clientX === 'number' &&
    typeof event.clientY === 'number'
  );
}

function readNodeCenter(
  node: OrgUnitTreeNode,
): Readonly<{ x: number; y: number }> {
  return {
    x: node.position.x + (node.width ?? ORG_TREE_NODE_WIDTH) / 2,
    y: node.position.y + (node.height ?? ORG_TREE_NODE_HEIGHT) / 2,
  };
}

function readDistance(
  source: Readonly<{ x: number; y: number }>,
  target: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(source.x - target.x, source.y - target.y);
}

function isOrgTreeConnectionValid(
  connection: Readonly<{ source: string | null; target: string | null }>,
  parentDraft: OrgUnitParentDraftMap,
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }

  if (connection.target === ORG_TREE_ROOT_ID) {
    return false;
  }

  return (
    readOrgUnitParentValidationMessage({
      orgUnitId: connection.target,
      parentDraft,
      parentId:
        connection.source === ORG_TREE_ROOT_ID ? null : connection.source,
    }) === null
  );
}

function readOrgUnitName(
  orgUnitId: string | null,
  orgUnitsById: ReadonlyMap<string, OrgUnitRecord>,
): string {
  if (!orgUnitId) {
    return '根節點';
  }

  const orgUnit = orgUnitsById.get(orgUnitId);

  return orgUnit ? `${orgUnit.name} · ${orgUnit.code}` : '未知組織';
}

function readOrgUnitTypeLabel(type: OrgUnitType): string {
  const normalizedType = type.toUpperCase() as Uppercase<OrgUnitType>;

  return ORG_UNIT_TYPE_LABELS[normalizedType] ?? '未知類型';
}
