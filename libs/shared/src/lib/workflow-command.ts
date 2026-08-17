import { FormDefinitionSchema } from './form';
import {
  ApproverResolver,
  DecisionPolicy,
  ReturnResubmitStrategy,
  ServiceAction,
  SlaConfig,
  WorkflowDefinition,
  WorkflowEdgeConditionOperator,
  WorkflowNodeTriggerMode,
} from './workflow';
import {
  NodePaletteType,
  WorkflowEdgeIdFactory,
  createWorkflowEdge,
  createWorkflowNode,
  defaultWorkflowEdgeId,
  insertWorkflowNodeIntoDefinition,
  isExclusiveGatewaySourceEdge,
  isWorkflowConnectionValid,
  isWorkflowNodeRemovable,
  normalizeDesignerWorkflowDefinition,
  readConditionExpression,
  readConditionField,
  readConditionLabel,
  readNextConditionOperator,
  readNextConditionValue,
  readNextWorkflowNodeIndex,
  readWorkflowDefinitionIssue,
  renameWorkflowNode,
  applyWorkflowNodeTriggerMode,
  WORKFLOW_OUTPUT_HANDLE_ID,
  WORKFLOW_INPUT_HANDLE_ID,
} from './workflow-graph';

/**
 * The serialisable command layer that the template designer — and the LLM
 * assistant — drive the workflow through. Every mutation a user can perform on
 * the canvas, node palette, or property form is expressed as one of these
 * commands, and {@link applyWorkflowCommand} is the single pure reducer that
 * applies them. The React controller and the LLM tool runtime both dispatch the
 * exact same commands, guaranteeing the assistant can do anything a user can.
 */

/** Everything the reducer needs as the single source of truth. */
export interface WorkflowDesignerState {
  /** Form schema bound to the template; needed to compile edge conditions. */
  readonly formSchema: FormDefinitionSchema | null;
  readonly definition: WorkflowDefinition;
  readonly editingEdgeId: string | null;
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel: string | null;
  readonly selectedEdgeIds: readonly string[];
  readonly selectedNodeId: string | null;
}

/** Where a newly added node should be wired in. */
export interface WorkflowNodeAnchor {
  /** Insert the node onto this edge, splitting it. */
  readonly edgeId?: string | null;
  /** Insert the node after this node. */
  readonly afterNodeId?: string | null;
}

export type WorkflowCommand =
  // ── Node primitives ──
  | {
      readonly type: 'addNode';
      readonly nodeType: NodePaletteType;
      readonly anchor?: WorkflowNodeAnchor;
    }
  | { readonly type: 'renameNode'; readonly nodeId: string; readonly label: string }
  | { readonly type: 'deleteNode'; readonly nodeId: string }
  | {
      readonly type: 'setNodeTriggerMode';
      readonly nodeId: string;
      readonly triggerMode: WorkflowNodeTriggerMode;
    }
  | {
      readonly type: 'setUserTaskApprover';
      readonly nodeId: string;
      readonly approverResolver: ApproverResolver;
    }
  | {
      readonly type: 'setUserTaskReturnResubmitStrategy';
      readonly nodeId: string;
      readonly resubmitStrategy: ReturnResubmitStrategy;
    }
  | {
      readonly type: 'setUserTaskReturnRequireComment';
      readonly nodeId: string;
      readonly requireComment: boolean;
    }
  | {
      /** Replaces the node SLA outright; `null` removes the SLA entirely. */
      readonly type: 'setUserTaskSla';
      readonly nodeId: string;
      readonly sla: SlaConfig | null;
    }
  | {
      /** Replaces how many of the resolved approvers have to decide. */
      readonly type: 'setUserTaskDecisionPolicy';
      readonly nodeId: string;
      readonly decisionPolicy: DecisionPolicy;
    }
  | {
      readonly type: 'setUserTaskOptions';
      readonly nodeId: string;
      readonly allowAddSigner?: boolean;
      readonly allowReject?: boolean;
      readonly allowTransfer?: boolean;
      readonly description?: string;
    }
  | {
      readonly type: 'setServiceAction';
      readonly nodeId: string;
      readonly action: ServiceAction;
    }
  | {
      readonly type: 'setEndState';
      readonly nodeId: string;
      readonly endState: 'APPROVED' | 'REJECTED';
    }
  // ── Edge primitives ──
  | {
      readonly type: 'connectEdge';
      readonly source: string;
      readonly target: string;
    }
  | { readonly type: 'deleteEdge'; readonly edgeId: string }
  | {
      readonly type: 'setEdgeCondition';
      readonly edgeId: string;
      readonly fieldKey?: string | null;
      readonly operator?: WorkflowEdgeConditionOperator | null;
      readonly value?: string | null;
    }
  | {
      readonly type: 'setEdgeDefault';
      readonly edgeId: string;
      readonly isDefault: boolean;
    }
  // ── Form / policy ──
  | {
      readonly type: 'bindForm';
      readonly formDefinitionVersionId: string | null;
      readonly formSchema: FormDefinitionSchema | null;
    }
  | {
      readonly type: 'setInitiatorPolicyCel';
      readonly cel: string | null;
    }
  // ── Selection ──
  | { readonly type: 'selectNode'; readonly nodeId: string | null }
  | { readonly type: 'selectEdges'; readonly edgeIds: readonly string[] }
  // ── Layout ──
  | { readonly type: 'autoLayout' };

/** High-level intents that fold into a sequence of primitive commands. */
export type WorkflowMacroCommand =
  | {
      readonly type: 'insertApprovalStep';
      readonly approverResolver: ApproverResolver;
      readonly label?: string;
      readonly anchor?: WorkflowNodeAnchor;
    }
  | {
      readonly type: 'insertNotification';
      readonly action: ServiceAction;
      readonly label?: string;
      readonly anchor?: WorkflowNodeAnchor;
    }
  | {
      readonly type: 'insertConditionalBranch';
      readonly label?: string;
      readonly anchor?: WorkflowNodeAnchor;
    };

export type AnyWorkflowCommand = WorkflowCommand | WorkflowMacroCommand;

/** Side-effect hints for the React controller (pixel layout/viewport). */
export interface WorkflowCommandEffects {
  /** Topology changed — controller should re-run dagre layout + viewport. */
  readonly layout: boolean;
}

export interface WorkflowCommandResult {
  readonly state: WorkflowDesignerState;
  /** Whether the command actually changed state. */
  readonly changed: boolean;
  /** Human-facing reason the command was a no-op / rejected, else null. */
  readonly error: string | null;
  /** Post-apply validation issue (same text the Save button uses), else null. */
  readonly issue: string | null;
  readonly effects: WorkflowCommandEffects;
}

export interface WorkflowCommandOptions {
  /** Injectable edge id factory for deterministic runs (tests, replay). */
  readonly createEdgeId?: WorkflowEdgeIdFactory;
}

const NO_EFFECTS: WorkflowCommandEffects = { layout: false };
const LAYOUT_EFFECTS: WorkflowCommandEffects = { layout: true };

function finalize(
  state: WorkflowDesignerState,
  changed: boolean,
  effects: WorkflowCommandEffects,
  error: string | null = null,
): WorkflowCommandResult {
  return {
    changed,
    effects,
    error,
    issue: readWorkflowDefinitionIssue(state.definition),
    state,
  };
}

function reject(
  state: WorkflowDesignerState,
  error: string,
): WorkflowCommandResult {
  return finalize(state, false, NO_EFFECTS, error);
}

/**
 * Apply a single primitive command. Pure: same input → same output (given a
 * deterministic edge id factory). Topology-changing commands set
 * `effects.layout` so the controller can run dagre afterwards.
 */
export function applyWorkflowCommand(
  state: WorkflowDesignerState,
  command: WorkflowCommand,
  options: WorkflowCommandOptions = {},
): WorkflowCommandResult {
  const createEdgeId = options.createEdgeId ?? defaultWorkflowEdgeId;

  switch (command.type) {
    case 'addNode':
      return applyAddNode(state, command, createEdgeId);
    case 'renameNode':
      return applyRenameNode(state, command);
    case 'deleteNode':
      return applyDeleteNode(state, command);
    case 'setNodeTriggerMode':
      return applySetNodeTriggerMode(state, command);
    case 'setUserTaskApprover':
      return applySetUserTaskApprover(state, command);
    case 'setUserTaskReturnResubmitStrategy':
      return applySetUserTaskReturnResubmitStrategy(state, command);
    case 'setUserTaskReturnRequireComment':
      return applySetUserTaskReturnRequireComment(state, command);
    case 'setUserTaskSla':
      return applySetUserTaskSla(state, command);
    case 'setUserTaskDecisionPolicy':
      return applySetUserTaskDecisionPolicy(state, command);
    case 'setUserTaskOptions':
      return applySetUserTaskOptions(state, command);
    case 'setServiceAction':
      return applySetServiceAction(state, command);
    case 'setEndState':
      return applySetEndState(state, command);
    case 'connectEdge':
      return applyConnectEdge(state, command, createEdgeId);
    case 'deleteEdge':
      return applyDeleteEdge(state, command);
    case 'setEdgeCondition':
      return applySetEdgeCondition(state, command);
    case 'setEdgeDefault':
      return applySetEdgeDefault(state, command);
    case 'bindForm':
      return applyBindForm(state, command);
    case 'setInitiatorPolicyCel':
      return applySetInitiatorPolicyCel(state, command);
    case 'selectNode':
      return finalize(
        { ...state, selectedNodeId: command.nodeId, selectedEdgeIds: [] },
        true,
        NO_EFFECTS,
      );
    case 'selectEdges':
      return finalize(
        { ...state, selectedEdgeIds: command.edgeIds, selectedNodeId: null },
        true,
        NO_EFFECTS,
      );
    case 'autoLayout':
      return finalize(state, true, LAYOUT_EFFECTS);
    default:
      return assertNever(command);
  }
}

/**
 * Apply a high-level macro by expanding it into primitive commands. The added
 * node's id is deterministic (`<nodeType>_<nextIndex>`), so follow-up commands
 * can target it without depending on the post-insert selection.
 */
export function applyWorkflowMacroCommand(
  state: WorkflowDesignerState,
  command: WorkflowMacroCommand,
  options: WorkflowCommandOptions = {},
): WorkflowCommandResult {
  return applyWorkflowCommands(
    state,
    expandMacroCommand(state, command),
    options,
  );
}

/** Apply a batch of primitive commands in order, threading state. */
export function applyWorkflowCommands(
  state: WorkflowDesignerState,
  commands: readonly WorkflowCommand[],
  options: WorkflowCommandOptions = {},
): WorkflowCommandResult {
  return commands.reduce<WorkflowCommandResult>(
    (accumulator, command) => {
      const next = applyWorkflowCommand(accumulator.state, command, options);

      return {
        ...next,
        changed: accumulator.changed || next.changed,
        effects: {
          layout: accumulator.effects.layout || next.effects.layout,
        },
        // Keep the first hard error encountered.
        error: accumulator.error ?? next.error,
      };
    },
    finalize(state, false, NO_EFFECTS),
  );
}

/**
 * Expand a high-level macro into the primitive command sequence that realises
 * it. The next node id is derived from the same deterministic rule
 * {@link applyAddNode} uses, so post-add commands can target it directly.
 */
export function expandMacroCommand(
  state: WorkflowDesignerState,
  command: WorkflowMacroCommand,
): readonly WorkflowCommand[] {
  if (command.type === 'insertApprovalStep') {
    const nodeId = readNextWorkflowNodeId(state, 'userTask');

    return [
      { type: 'addNode', nodeType: 'userTask', anchor: command.anchor },
      {
        type: 'setUserTaskApprover',
        nodeId,
        approverResolver: command.approverResolver,
      },
      ...(command.label === undefined
        ? []
        : [{ type: 'renameNode', nodeId, label: command.label } as const]),
    ];
  }

  if (command.type === 'insertNotification') {
    const nodeId = readNextWorkflowNodeId(state, 'serviceTask');

    return [
      { type: 'addNode', nodeType: 'serviceTask', anchor: command.anchor },
      { type: 'setServiceAction', nodeId, action: command.action },
      ...(command.label === undefined
        ? []
        : [{ type: 'renameNode', nodeId, label: command.label } as const]),
    ];
  }

  const nodeId = readNextWorkflowNodeId(state, 'exclusiveGateway');

  return [
    { type: 'addNode', nodeType: 'exclusiveGateway', anchor: command.anchor },
    ...(command.label === undefined
      ? []
      : [{ type: 'renameNode', nodeId, label: command.label } as const]),
  ];
}

/** The id {@link applyAddNode} will assign to the next node of this type. */
function readNextWorkflowNodeId(
  state: WorkflowDesignerState,
  nodeType: NodePaletteType,
): string {
  return `${nodeType}_${readNextWorkflowNodeIndex(
    state.definition.nodes,
    nodeType,
  )}`;
}

// ── Node command handlers ──────────────────────────────────────────────────

function applyAddNode(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'addNode' }>,
  createEdgeId: WorkflowEdgeIdFactory,
): WorkflowCommandResult {
  const nodeIndex = readNextWorkflowNodeIndex(
    state.definition.nodes,
    command.nodeType,
  );
  const node = createWorkflowNode(command.nodeType, nodeIndex);
  const selectedEdgeId =
    command.anchor?.edgeId ??
    (state.selectedEdgeIds.length === 1 ? state.selectedEdgeIds[0] : null);
  const selectedNodeId =
    command.anchor?.afterNodeId ??
    (command.anchor?.edgeId ? null : state.selectedNodeId);
  const inserted = insertWorkflowNodeIntoDefinition({
    createId: createEdgeId,
    definition: state.definition,
    node,
    selectedEdgeId,
    selectedNodeId,
  });

  return finalize(
    {
      ...state,
      definition: normalizeDesignerWorkflowDefinition(inserted.definition),
      editingEdgeId: inserted.editingEdgeId,
      selectedEdgeIds: inserted.selectedEdgeIds,
      selectedNodeId: inserted.selectedNodeId,
    },
    true,
    LAYOUT_EFFECTS,
  );
}

function applyRenameNode(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'renameNode' }>,
): WorkflowCommandResult {
  return mapNode(state, command.nodeId, (node) =>
    renameWorkflowNode(node, command.label),
  );
}

function applyDeleteNode(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'deleteNode' }>,
): WorkflowCommandResult {
  const node = state.definition.nodes.find(
    (candidate) => candidate.id === command.nodeId,
  );

  if (!node) {
    return reject(state, `找不到節點：${command.nodeId}`);
  }

  if (!isWorkflowNodeRemovable(node)) {
    return reject(state, '開始與結束節點無法刪除。');
  }

  const definition = normalizeDesignerWorkflowDefinition({
    ...state.definition,
    edges: state.definition.edges.filter(
      (edge) => edge.source !== node.id && edge.target !== node.id,
    ),
    nodes: state.definition.nodes.filter(
      (candidate) => candidate.id !== node.id,
    ),
  });

  // Deleting preserves the remaining nodes' manual positions (matches the
  // original designer); tidying is an explicit `autoLayout` step.
  return finalize(
    {
      ...state,
      definition,
      editingEdgeId: null,
      selectedEdgeIds: [],
      selectedNodeId: 'start',
    },
    true,
    NO_EFFECTS,
  );
}

function applySetNodeTriggerMode(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setNodeTriggerMode' }>,
): WorkflowCommandResult {
  const node = state.definition.nodes.find((n) => n.id === command.nodeId);

  if (node?.type === 'startEvent') {
    return reject(state, '開始節點沒有觸發模式。');
  }

  return mapNode(state, command.nodeId, (target) =>
    applyWorkflowNodeTriggerMode(target, command.triggerMode),
  );
}

function applySetUserTaskApprover(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setUserTaskApprover' }>,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              approverResolver: command.approverResolver,
              decisionPolicy: { type: 'SINGLE' },
            },
          }
        : node,
    'userTask',
  );
}

function applySetUserTaskReturnResubmitStrategy(
  state: WorkflowDesignerState,
  command: Extract<
    WorkflowCommand,
    { type: 'setUserTaskReturnResubmitStrategy' }
  >,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              returnBehavior: {
                ...node.data.returnBehavior,
                resubmitStrategy: command.resubmitStrategy,
              },
            },
          }
        : node,
    'userTask',
  );
}

/** Returns a copy of `value` without `key`, leaving the input untouched. */
function omitKey<TValue extends object, TKey extends keyof TValue & string>(
  value: TValue,
  key: TKey,
): Omit<TValue, TKey> {
  return Object.fromEntries(
    Object.entries(value).filter(([entryKey]) => entryKey !== key),
  ) as Omit<TValue, TKey>;
}

function applySetUserTaskReturnRequireComment(
  state: WorkflowDesignerState,
  command: Extract<
    WorkflowCommand,
    { type: 'setUserTaskReturnRequireComment' }
  >,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              returnBehavior: {
                ...node.data.returnBehavior,
                requireComment: command.requireComment,
              },
            },
          }
        : node,
    'userTask',
  );
}

function applySetUserTaskDecisionPolicy(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setUserTaskDecisionPolicy' }>,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) => {
      if (node.type !== 'userTask') {
        return node;
      }

      return {
        ...node,
        data: { ...node.data, decisionPolicy: command.decisionPolicy },
      };
    },
    'userTask',
  );
}

function applySetUserTaskSla(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setUserTaskSla' }>,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) => {
      if (node.type !== 'userTask') {
        return node;
      }

      if (!command.sla) {
        // Drop the key entirely rather than storing `undefined`, so the saved
        // definition JSON stays clean for templates that never used an SLA.
        return { ...node, data: omitKey(node.data, 'sla') };
      }

      return { ...node, data: { ...node.data, sla: command.sla } };
    },
    'userTask',
  );
}

function applySetUserTaskOptions(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setUserTaskOptions' }>,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              ...(command.allowAddSigner === undefined
                ? {}
                : { allowAddSigner: command.allowAddSigner }),
              ...(command.allowReject === undefined
                ? {}
                : { allowReject: command.allowReject }),
              ...(command.allowTransfer === undefined
                ? {}
                : { allowTransfer: command.allowTransfer }),
              ...(command.description === undefined
                ? {}
                : { description: command.description }),
            },
          }
        : node,
    'userTask',
  );
}

function applySetServiceAction(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setServiceAction' }>,
): WorkflowCommandResult {
  const result = mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'serviceTask'
        ? { ...node, data: { ...node.data, action: command.action } }
        : node,
    'serviceTask',
  );

  if (!result.changed) {
    return result;
  }

  // Switching a service task to async NOTIFY drops its outgoing edges
  // (normalizeDesignerWorkflowDefinition). The original designer did not
  // relayout here, so neither do we — positions are preserved.
  return finalize(
    {
      ...result.state,
      definition: normalizeDesignerWorkflowDefinition(result.state.definition),
    },
    true,
    NO_EFFECTS,
  );
}

function applySetEndState(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setEndState' }>,
): WorkflowCommandResult {
  return mapNode(
    state,
    command.nodeId,
    (node) =>
      node.type === 'endEvent'
        ? { ...node, data: { ...node.data, endState: command.endState } }
        : node,
    'endEvent',
  );
}

// ── Edge command handlers ──────────────────────────────────────────────────

function applyConnectEdge(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'connectEdge' }>,
  createEdgeId: WorkflowEdgeIdFactory,
): WorkflowCommandResult {
  const connection = {
    source: command.source,
    sourceHandle: WORKFLOW_OUTPUT_HANDLE_ID,
    target: command.target,
    targetHandle: WORKFLOW_INPUT_HANDLE_ID,
  };

  if (!isWorkflowConnectionValid(connection, state.definition.nodes)) {
    return reject(
      state,
      `無法連線：${command.source} → ${command.target}（來源/目標不可連接或不存在）。`,
    );
  }

  const shouldOpenConditionSettings = state.definition.nodes.some(
    (node) => node.id === command.source && node.type === 'exclusiveGateway',
  );
  const nextEdge = createWorkflowEdge(
    command.source,
    command.target,
    {},
    createEdgeId,
  );
  const definition = normalizeDesignerWorkflowDefinition({
    ...state.definition,
    edges: [...state.definition.edges, nextEdge],
  });

  // Connecting two already-positioned nodes preserves their manual layout
  // (matches the original designer); the LLM/user can call `autoLayout` to tidy.
  return finalize(
    {
      ...state,
      definition,
      editingEdgeId: shouldOpenConditionSettings ? nextEdge.id : null,
      selectedEdgeIds: [nextEdge.id],
      selectedNodeId: null,
    },
    true,
    NO_EFFECTS,
  );
}

function applyDeleteEdge(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'deleteEdge' }>,
): WorkflowCommandResult {
  if (!state.definition.edges.some((edge) => edge.id === command.edgeId)) {
    return reject(state, `找不到連線：${command.edgeId}`);
  }

  const definition = normalizeDesignerWorkflowDefinition({
    ...state.definition,
    edges: state.definition.edges.filter(
      (edge) => edge.id !== command.edgeId,
    ),
  });

  return finalize(
    {
      ...state,
      definition,
      editingEdgeId:
        state.editingEdgeId === command.edgeId ? null : state.editingEdgeId,
      selectedEdgeIds: state.selectedEdgeIds.filter(
        (edgeId) => edgeId !== command.edgeId,
      ),
    },
    true,
    NO_EFFECTS,
  );
}

function applySetEdgeCondition(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setEdgeCondition' }>,
): WorkflowCommandResult {
  const targetEdge = state.definition.edges.find(
    (edge) => edge.id === command.edgeId,
  );

  if (!targetEdge) {
    return reject(state, `找不到連線：${command.edgeId}`);
  }

  const schema = state.formSchema;
  const nextFieldKey =
    command.fieldKey ?? targetEdge.data.conditionFieldKey ?? null;
  const field = readConditionField(schema, nextFieldKey);
  const nextOperator = readNextConditionOperator(
    field,
    command.operator ?? targetEdge.data.conditionOperator ?? null,
  );
  const nextValue = readNextConditionValue(
    field,
    nextOperator,
    command.value ?? targetEdge.data.conditionValue ?? null,
  );
  const nextLabel = readConditionLabel(field, nextOperator, nextValue);

  const definition = {
    ...state.definition,
    edges: state.definition.edges.map((edge) =>
      edge.id === command.edgeId
        ? {
            ...edge,
            data: {
              ...edge.data,
              condition: readConditionExpression(field, nextOperator, nextValue),
              conditionFieldKey: field?.fieldKey,
              conditionOperator: nextOperator,
              conditionValue: nextValue,
              isDefault: false,
              label: nextLabel,
            },
          }
        : edge,
    ),
  };

  return finalize({ ...state, definition }, true, NO_EFFECTS);
}

function applySetEdgeDefault(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setEdgeDefault' }>,
): WorkflowCommandResult {
  const targetEdge = state.definition.edges.find(
    (edge) => edge.id === command.edgeId,
  );

  if (!targetEdge) {
    return reject(state, `找不到連線：${command.edgeId}`);
  }

  const definition = {
    ...state.definition,
    edges: state.definition.edges.map((edge) => {
      if (
        command.isDefault &&
        edge.source === targetEdge.source &&
        edge.id !== targetEdge.id &&
        isExclusiveGatewaySourceEdge(edge, state.definition.nodes)
      ) {
        return { ...edge, data: { ...edge.data, isDefault: false } };
      }

      if (edge.id !== targetEdge.id) {
        return edge;
      }

      // Becoming the default ("其他情況") means it carries no condition; clear
      // any stale condition so the edge reads cleanly as the else path.
      return command.isDefault
        ? {
            ...edge,
            data: {
              ...edge.data,
              condition: undefined,
              conditionFieldKey: undefined,
              conditionOperator: undefined,
              conditionValue: undefined,
              isDefault: true,
              label: undefined,
            },
          }
        : { ...edge, data: { ...edge.data, isDefault: false } };
    }),
  };

  return finalize({ ...state, definition }, true, NO_EFFECTS);
}

// ── Form / policy handlers ─────────────────────────────────────────────────

function applyBindForm(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'bindForm' }>,
): WorkflowCommandResult {
  return finalize(
    {
      ...state,
      formDefinitionVersionId: command.formDefinitionVersionId,
      formSchema: command.formSchema,
    },
    true,
    NO_EFFECTS,
  );
}

function applySetInitiatorPolicyCel(
  state: WorkflowDesignerState,
  command: Extract<WorkflowCommand, { type: 'setInitiatorPolicyCel' }>,
): WorkflowCommandResult {
  return finalize(
    { ...state, initiatorPolicyCel: command.cel },
    true,
    NO_EFFECTS,
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mapNode(
  state: WorkflowDesignerState,
  nodeId: string,
  updater: (
    node: WorkflowDefinition['nodes'][number],
  ) => WorkflowDefinition['nodes'][number],
  expectedType?: WorkflowDefinition['nodes'][number]['type'],
): WorkflowCommandResult {
  const node = state.definition.nodes.find(
    (candidate) => candidate.id === nodeId,
  );

  if (!node) {
    return reject(state, `找不到節點：${nodeId}`);
  }

  if (expectedType && node.type !== expectedType) {
    return reject(
      state,
      `節點 ${nodeId} 的型別為 ${node.type}，預期為 ${expectedType}。`,
    );
  }

  const definition = {
    ...state.definition,
    nodes: state.definition.nodes.map((candidate) =>
      candidate.id === nodeId ? updater(candidate) : candidate,
    ),
  };

  return finalize({ ...state, definition }, true, NO_EFFECTS);
}

function assertNever(command: never): never {
  throw new Error(
    `未支援的 workflow command：${JSON.stringify(command)}`,
  );
}
