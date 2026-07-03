'use client';

import {
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
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
  Panel,
  Position,
  ReactFlow,
  ReactFlowInstance,
  applyNodeChanges,
} from '@xyflow/react';
// xyflow v12 ships no runtime style injection — without this stylesheet every
// `.react-flow__node` computes `position: static` and the graph collapses into
// a document-flow stack. Bundled into the extracted css so hosts need nothing.
import '@xyflow/react/dist/style.css';
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
  childCount: number;
  code: string;
  collapsed: boolean;
  deleted: boolean;
  isEditing: boolean;
  isSyntheticRoot: boolean;
  name: string;
  onCreateChild: (parentId: string | null) => void;
  onEdit: (orgUnitId: string) => void;
  onToggleCollapse: (nodeId: string) => void;
  orgUnitId: string | null;
  parentLabel: string;
  path: string;
  typeLabel: string;
}>;

type OrgUnitTreeNode = Node<OrgUnitTreeFlowData, 'orgUnit'>;
type OrgUnitTreeEdge = Edge<Record<string, never>>;
type OrgUnitTreeFlowInstance = ReactFlowInstance<
  OrgUnitTreeNode,
  OrgUnitTreeEdge
>;

type OrgUnitTreeFlowElements = Readonly<{
  bounds: Readonly<{ height: number; width: number }>;
  edges: readonly OrgUnitTreeEdge[];
  nodes: readonly OrgUnitTreeNode[];
  rootCenter: Readonly<{ x: number; y: number }>;
}>;

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

// Zoom bounds for the ReactFlow canvas. `minZoom` is computed per layout so
// that fitView can shrink a very wide/tall tree enough to reveal the whole
// graph; a fixed minZoom (e.g. 0.25) leaves huge trees clipped off-screen.
const ORG_TREE_MAX_ZOOM = 1.4;
const ORG_TREE_BASE_MIN_ZOOM = 0.25;
// Absolute lowest zoom; keeps even an extremely wide tree (tens of thousands of
// px across) fully fittable while never reaching 0.
const ORG_TREE_MIN_ZOOM_FLOOR = 0.005;
// Reference viewport side (px) the fit-all zoom should still work in; minZoom is
// derived as reference / longest-graph-side, clamped between the floor and base.
// A small reference keeps fitView from being clamped on narrow viewports.
const ORG_TREE_MIN_ZOOM_REFERENCE = 250;
// Above this node count the MiniMap turns into an unreadable black block and
// adds render cost, so it is hidden for large trees.
const ORG_TREE_MINIMAP_MAX_NODES = 80;

// Initial viewport strategy. A very wide/deep tree fitted to the whole graph
// collapses into an unreadable thin line at ~0.05 zoom, so instead of fitView
// we open large trees at a readable zoom anchored on the root node and let the
// user pan/zoom. Small trees still open with fitView.
const ORG_TREE_READABLE_ZOOM = 0.85;
// If fitView would land at or above this zoom the tree is small enough to open
// fully; below it we switch to the readable-anchored-on-root strategy.
const ORG_TREE_FIT_READABLE_MIN_ZOOM = 0.7;
// Reference viewport used to estimate the fitView zoom before the canvas is
// measured (the real canvas is ~1000-1400 x 520-720).
const ORG_TREE_VIEWPORT_REF_WIDTH = 1200;
const ORG_TREE_VIEWPORT_REF_HEIGHT = 600;
// Vertical distance between ranks. The dagre default (50) leaves no edge
// corridor once a card grows past its declared height (the card scss is
// min-height and the action buttons wrap to a second row), so cards sat on the
// next rank's connection lines. 96 keeps a readable corridor even before the
// measured-size relayout below has run.
const ORG_TREE_RANK_SEPARATION = 96;

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
  // Trees open fully expanded — collapsing is a per-user action via the node
  // toggles or the collapse-all shortcut, never a default.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // Real rendered card heights reported by ReactFlow. Cards are min-height in
  // the scss and grow when the action buttons wrap (or in editing mode), so
  // the layout re-runs with these measurements to keep ranks from overlapping.
  const [measuredHeights, setMeasuredHeights] = useState<
    ReadonlyMap<string, number>
  >(() => new Map<string, number>());
  const [flowNodes, setFlowNodes] = useState<readonly OrgUnitTreeNode[]>([]);
  const flowInstanceRef = useRef<OrgUnitTreeFlowInstance | null>(null);
  const pendingFocusNodeIdRef = useRef<string | null>(null);

  const handleToggleCollapse = useCallback((nodeId: string): void => {
    pendingFocusNodeIdRef.current = nodeId;
    setCollapsedIds((current) => {
      const next = new Set(current);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });
  }, []);

  const handleExpandAll = useCallback((): void => {
    pendingFocusNodeIdRef.current = ORG_TREE_ROOT_ID;
    setCollapsedIds(new Set<string>());
  }, []);

  const handleCollapseAll = useCallback((): void => {
    pendingFocusNodeIdRef.current = ORG_TREE_ROOT_ID;
    setCollapsedIds(() => {
      // Collapse every node that has children except the synthetic root, so
      // the tree folds down to the root plus the top-level org units. Uses the
      // current draft hierarchy so editing-mode reparents are respected.
      const childrenMap = buildOrgUnitChildrenMap(orgUnits, parentDraft);

      return new Set(
        [...childrenMap.keys()].filter((id) => id !== ORG_TREE_ROOT_ID),
      );
    });
  }, [orgUnits, parentDraft]);

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
    (): OrgUnitTreeFlowElements =>
      createOrgUnitTreeFlowElements({
        collapsedIds,
        isEditing,
        measuredHeights,
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
        onToggleCollapse: handleToggleCollapse,
        orgUnits,
        orgUnitsById,
        parentDraft,
        selectedOrgUnitId,
      }),
    [
      collapsedIds,
      handleToggleCollapse,
      isEditing,
      measuredHeights,
      onCreateChild,
      onCreateRoot,
      onEditOrgUnit,
      orgUnits,
      orgUnitsById,
      parentDraft,
      selectedOrgUnitId,
    ],
  );
  const flowElementsRef = useRef(flowElements);
  flowElementsRef.current = flowElements;
  const hasDraftChanges = draftChanges.length > 0;
  const minZoom = useMemo((): number => {
    const largestSide = Math.max(
      flowElements.bounds.width,
      flowElements.bounds.height,
    );

    if (largestSide <= 0) {
      return ORG_TREE_BASE_MIN_ZOOM;
    }

    return Math.min(
      ORG_TREE_BASE_MIN_ZOOM,
      Math.max(
        ORG_TREE_MIN_ZOOM_FLOOR,
        ORG_TREE_MIN_ZOOM_REFERENCE / largestSide,
      ),
    );
  }, [flowElements.bounds.height, flowElements.bounds.width]);
  const showMiniMap = orgUnits.length <= ORG_TREE_MINIMAP_MAX_NODES;

  const applyInitialViewport = useCallback((): void => {
    const instance = flowInstanceRef.current;

    if (!instance) {
      return;
    }

    const { bounds, rootCenter } = flowElementsRef.current;
    const widthZoom =
      bounds.width > 0
        ? ORG_TREE_VIEWPORT_REF_WIDTH / bounds.width
        : Number.POSITIVE_INFINITY;
    const heightZoom =
      bounds.height > 0
        ? ORG_TREE_VIEWPORT_REF_HEIGHT / bounds.height
        : Number.POSITIVE_INFINITY;
    const estimatedFitZoom = Math.min(widthZoom, heightZoom);

    if (
      !Number.isFinite(estimatedFitZoom) ||
      estimatedFitZoom >= ORG_TREE_FIT_READABLE_MIN_ZOOM
    ) {
      instance.fitView({ padding: 0.18 });
      return;
    }

    // Anchor on the root at a readable zoom. The synthetic root is horizontally
    // centered over the layout, and the vertical anchor keeps the top ranks in
    // view (or vertically centers the graph when it is shorter than the
    // viewport) instead of centering on the root's own row only.
    const halfViewportHeight =
      ORG_TREE_VIEWPORT_REF_HEIGHT / (2 * ORG_TREE_READABLE_ZOOM);

    instance.setCenter(
      rootCenter.x,
      Math.min(bounds.height / 2, halfViewportHeight),
      {
        duration: 0,
        zoom: ORG_TREE_READABLE_ZOOM,
      },
    );
  }, []);

  const handleFlowInit = useCallback(
    (instance: OrgUnitTreeFlowInstance): void => {
      flowInstanceRef.current = instance;
      applyInitialViewport();
    },
    [applyInitialViewport],
  );

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
    const nextParentDraft = createOrgUnitParentDraftMap(orgUnits);

    setParentDraft(nextParentDraft);
    setCollapsedIds(new Set<string>());
    setMeasuredHeights(new Map<string, number>());
    setSelectedOrgUnitId(null);
    setDraftMessage(null);
    setIsEditing(false);
  }, [orgUnits]);

  useEffect((): void => {
    setFlowNodes(flowElements.nodes);
  }, [flowElements.nodes]);

  // Apply the opening viewport once per dataset load: fitView for small trees,
  // but a readable zoom anchored on the root node for large/very-wide trees so
  // they do not collapse into an unreadable line. Runs on dataset changes only
  // (not on collapse/selection) so the user's own pan/zoom is preserved.
  useEffect((): (() => void) => {
    if (typeof window === 'undefined') {
      return (): void => undefined;
    }

    const frame = window.requestAnimationFrame((): void => {
      applyInitialViewport();
    });

    return (): void => window.cancelAnimationFrame(frame);
  }, [applyInitialViewport, orgUnits]);

  // A collapse/expand re-runs the dagre layout and every node shifts, so
  // re-center on the node the user toggled (keeping their zoom) — otherwise the
  // toggled subtree can land entirely off-screen and the click looks dead.
  useEffect((): void => {
    const focusNodeId = pendingFocusNodeIdRef.current;

    if (!focusNodeId) {
      return;
    }

    pendingFocusNodeIdRef.current = null;

    const instance = flowInstanceRef.current;
    const focusNode = flowElements.nodes.find(
      (node) => node.id === focusNodeId,
    );

    if (!instance || !focusNode) {
      return;
    }

    instance.setCenter(
      focusNode.position.x + (focusNode.width ?? ORG_TREE_NODE_WIDTH) / 2,
      focusNode.position.y +
        (focusNode.initialHeight ?? ORG_TREE_NODE_HEIGHT) / 2,
      { duration: 200, zoom: instance.getZoom() },
    );
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
      // Collect the real rendered card heights so the dagre layout can re-run
      // with them. The update is guarded to actual differences, otherwise the
      // dimension events fired after every relayout would loop forever.
      const dimensionChanges = changes.filter(
        (change) => change.type === 'dimensions' && change.dimensions,
      );

      if (dimensionChanges.length > 0) {
        setMeasuredHeights((current) => {
          const next = new Map(current);
          const changed = dimensionChanges.reduce((didChange, change) => {
            if (change.type !== 'dimensions' || !change.dimensions) {
              return didChange;
            }

            const height = Math.ceil(change.dimensions.height);

            if (Math.abs((next.get(change.id) ?? 0) - height) <= 1) {
              return didChange;
            }

            next.set(change.id, height);

            return true;
          }, false);

          return changed ? next : current;
        });
      }

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
          fitViewOptions={{ minZoom, padding: 0.18 }}
          isValidConnection={(connection): boolean =>
            isOrgTreeConnectionValid(
              { source: connection.source, target: connection.target },
              parentDraft,
            )
          }
          maxZoom={ORG_TREE_MAX_ZOOM}
          minZoom={minZoom}
          nodeTypes={orgUnitTreeNodeTypes}
          nodes={[...flowNodes]}
          nodesConnectable={isEditing}
          nodesDraggable={isEditing}
          onConnect={handleConnect}
          onInit={handleFlowInit}
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
          {/* `nopan` for the same reason as the node action row: without it a
              real mouse click with slight jitter becomes a pan gesture and the
              click never reaches the buttons. */}
          <Panel
            className={`${styles.orgTreePanel} nopan nodrag`}
            position="top-right"
          >
            <Button
              onClick={handleExpandAll}
              size="sub"
              variant="base-secondary"
            >
              全部展開
            </Button>
            <Button
              onClick={handleCollapseAll}
              size="sub"
              variant="base-secondary"
            >
              全部收合
            </Button>
          </Panel>
          {showMiniMap ? <MiniMap pannable zoomable /> : null}
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
      {/* `nopan` keeps the pane's d3-zoom from capturing pointerdown on the
          buttons: without it a real mouse click with ≥1px of jitter becomes a
          pan gesture and d3 suppresses the click before it reaches onClick. */}
      <div className={`${styles.orgTreeNodeActions} nodrag nopan`}>
        {data.childCount > 0 ? (
          <Button
            onClick={(event): void => {
              event.stopPropagation();
              data.onToggleCollapse(data.orgUnitId ?? ORG_TREE_ROOT_ID);
            }}
            size="sub"
            variant="base-secondary"
          >
            {data.collapsed
              ? `展開 (${data.childCount})`
              : `收合 (${data.childCount})`}
          </Button>
        ) : null}
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

function buildOrgUnitChildrenMap(
  orgUnits: readonly OrgUnitRecord[],
  parentDraft: OrgUnitParentDraftMap,
): ReadonlyMap<string, readonly string[]> {
  const childrenMap = new Map<string, readonly string[]>();

  orgUnits.forEach((orgUnit): void => {
    const parentKey = parentDraft.get(orgUnit.id) ?? ORG_TREE_ROOT_ID;

    childrenMap.set(parentKey, [
      ...(childrenMap.get(parentKey) ?? []),
      orgUnit.id,
    ]);
  });

  return childrenMap;
}

function collectVisibleOrgUnitIds({
  childrenMap,
  collapsedIds,
}: {
  readonly childrenMap: ReadonlyMap<string, readonly string[]>;
  readonly collapsedIds: ReadonlySet<string>;
}): ReadonlySet<string> {
  const visible = new Set<string>();

  const visit = (nodeId: string): void => {
    if (collapsedIds.has(nodeId)) {
      return;
    }

    (childrenMap.get(nodeId) ?? []).forEach((childId): void => {
      visible.add(childId);
      visit(childId);
    });
  };

  visit(ORG_TREE_ROOT_ID);

  return visible;
}

function createOrgUnitTreeFlowElements({
  collapsedIds,
  isEditing,
  measuredHeights,
  onCreateChild,
  onEditOrgUnit,
  onToggleCollapse,
  orgUnits,
  orgUnitsById,
  parentDraft,
  selectedOrgUnitId,
}: {
  readonly collapsedIds: ReadonlySet<string>;
  readonly isEditing: boolean;
  readonly measuredHeights: ReadonlyMap<string, number>;
  readonly onCreateChild: (parentId: string | null) => void;
  readonly onEditOrgUnit: (orgUnitId: string) => void;
  readonly onToggleCollapse: (nodeId: string) => void;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly orgUnitsById: ReadonlyMap<string, OrgUnitRecord>;
  readonly parentDraft: OrgUnitParentDraftMap;
  readonly selectedOrgUnitId: string | null;
}): OrgUnitTreeFlowElements {
  const childrenMap = buildOrgUnitChildrenMap(orgUnits, parentDraft);
  const visibleIds = collectVisibleOrgUnitIds({ childrenMap, collapsedIds });
  const visibleOrgUnits = orgUnits.filter((orgUnit) =>
    visibleIds.has(orgUnit.id),
  );
  const readChildCount = (nodeId: string): number =>
    childrenMap.get(nodeId)?.length ?? 0;
  // Cards are min-height in the scss and grow with wrapped action buttons, so
  // the declared constants only cover the first paint; once ReactFlow reports
  // real dimensions the layout uses those.
  const readLayoutHeight = (nodeId: string, declaredHeight: number): number =>
    Math.max(declaredHeight, measuredHeights.get(nodeId) ?? 0);

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    marginx: 36,
    marginy: 36,
    nodesep: 44,
    rankdir: 'TB',
    ranksep: ORG_TREE_RANK_SEPARATION,
  });
  graph.setNode(ORG_TREE_ROOT_ID, {
    height: readLayoutHeight(ORG_TREE_ROOT_ID, ORG_TREE_ROOT_HEIGHT),
    width: ORG_TREE_ROOT_WIDTH,
  });
  visibleOrgUnits.forEach((orgUnit): void => {
    graph.setNode(orgUnit.id, {
      height: readLayoutHeight(orgUnit.id, ORG_TREE_NODE_HEIGHT),
      width: ORG_TREE_NODE_WIDTH,
    });
  });
  visibleOrgUnits.forEach((orgUnit): void => {
    const parentId = parentDraft.get(orgUnit.id) ?? null;
    graph.setEdge(parentId ?? ORG_TREE_ROOT_ID, orgUnit.id);
  });
  dagre.layout(graph);

  const graphLabel = graph.graph();
  const bounds = {
    height: graphLabel.height ?? 0,
    width: graphLabel.width ?? 0,
  };
  const rootGraphNode = graph.node(ORG_TREE_ROOT_ID) as
    | Readonly<{ x: number; y: number }>
    | undefined;
  // Dagre's alignment pass can shove the synthetic root to the far edge of an
  // asymmetric layout (measured x=3326 on a 4030px-wide real tree), which both
  // looks broken and puts a root-anchored viewport over empty margin, so the
  // root is re-centered over the whole layout width.
  const rootCenter = {
    x: bounds.width > 0 ? bounds.width / 2 : (rootGraphNode?.x ?? 0),
    y: rootGraphNode?.y ?? 0,
  };

  const positionedRootNode = createOrgUnitTreeNode({
    data: {
      changed: false,
      childCount: readChildCount(ORG_TREE_ROOT_ID),
      code: ORG_TREE_ROOT_ID,
      collapsed: collapsedIds.has(ORG_TREE_ROOT_ID),
      deleted: false,
      isEditing,
      isSyntheticRoot: true,
      name: '組織根節點',
      onCreateChild,
      onEdit: onEditOrgUnit,
      onToggleCollapse,
      orgUnitId: null,
      parentLabel: '',
      path: '',
      typeLabel: '',
    },
    graph,
    height: readLayoutHeight(ORG_TREE_ROOT_ID, ORG_TREE_ROOT_HEIGHT),
    id: ORG_TREE_ROOT_ID,
    selected: selectedOrgUnitId === null,
    width: ORG_TREE_ROOT_WIDTH,
  });
  const rootNode: OrgUnitTreeNode = {
    ...positionedRootNode,
    position: {
      x: rootCenter.x - ORG_TREE_ROOT_WIDTH / 2,
      y:
        rootCenter.y -
        readLayoutHeight(ORG_TREE_ROOT_ID, ORG_TREE_ROOT_HEIGHT) / 2,
    },
  };
  const orgNodes = visibleOrgUnits.map((orgUnit): OrgUnitTreeNode => {
    const parentId = parentDraft.get(orgUnit.id) ?? null;
    const parentLabel = readOrgUnitName(parentId, orgUnitsById);

    return createOrgUnitTreeNode({
      data: {
        changed: parentId !== orgUnit.parentId,
        childCount: readChildCount(orgUnit.id),
        code: orgUnit.code,
        collapsed: collapsedIds.has(orgUnit.id),
        deleted: Boolean(orgUnit.deletedAt),
        isEditing,
        isSyntheticRoot: false,
        name: orgUnit.name,
        onCreateChild,
        onEdit: onEditOrgUnit,
        onToggleCollapse,
        orgUnitId: orgUnit.id,
        parentLabel,
        path: orgUnit.path,
        typeLabel: readOrgUnitTypeLabel(orgUnit.type),
      },
      graph,
      height: readLayoutHeight(orgUnit.id, ORG_TREE_NODE_HEIGHT),
      id: orgUnit.id,
      selected: selectedOrgUnitId === orgUnit.id,
      width: ORG_TREE_NODE_WIDTH,
    });
  });
  const edges = visibleOrgUnits.map((orgUnit): OrgUnitTreeEdge => {
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
    bounds,
    edges,
    nodes: [rootNode, ...orgNodes],
    rootCenter,
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

  // No explicit `height`: in xyflow v12 it becomes an inline style that would
  // clamp the wrapper to the declared value, so the card could never grow with
  // its content and the measured dimensions would always echo the declaration.
  // `initialHeight` only seeds the pre-measure pass.
  return {
    data,
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
    y:
      node.position.y +
      (node.measured?.height ?? node.initialHeight ?? ORG_TREE_NODE_HEIGHT) /
        2,
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
