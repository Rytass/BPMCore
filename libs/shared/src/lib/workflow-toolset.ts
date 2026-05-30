import { FormDefinitionSchema } from './form';
import {
  ApproverResolver,
  ReturnResubmitStrategy,
  ServiceAction,
  WorkflowEdge,
  WorkflowEdgeConditionOperator,
  WorkflowNode,
  WorkflowNodeTriggerMode,
} from './workflow';
import {
  CONDITION_OPERATOR_OPTIONS,
  WORKFLOW_NODE_TYPE_LABELS,
  isExclusiveGatewaySourceEdge,
  readWorkflowDefinitionIssue,
} from './workflow-graph';
import {
  WorkflowCommand,
  WorkflowCommandOptions,
  WorkflowCommandResult,
  WorkflowDesignerState,
  WorkflowMacroCommand,
  applyWorkflowCommand,
  applyWorkflowMacroCommand,
} from './workflow-command';

export type { AnyWorkflowCommand } from './workflow-command';

/**
 * The LLM-facing toolset for the template designer. It exposes every workflow
 * mutation as a provider-agnostic tool (JSON Schema input), plus read-only
 * query tools so the assistant can inspect the graph before acting.
 *
 * The same {@link applyWorkflowCommand} reducer powers both the React UI and
 * this toolset — an LLM driving these tools can do exactly what a user can do
 * on the canvas, node palette, and property form.
 *
 * Usage (Anthropic / AI SDK / OpenAI tool-calling are all compatible):
 *   1. Advertise `WORKFLOW_TOOLSET` to the model as its tools.
 *   2. On each tool call, run `executeWorkflowTool(state, name, input, opts)`.
 *   3. For mutations, persist `result.state`; if `result.effects.layout`, run
 *      dagre layout (in the React controller); return `snapshot` to the model.
 */

/** A minimal JSON Schema object (provider-agnostic tool input contract). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export type WorkflowToolKind = 'mutation' | 'macro' | 'query';

export interface WorkflowTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly kind: WorkflowToolKind;
}

// ── Reusable schema fragments ──────────────────────────────────────────────

const NODE_TYPE_ENUM = ['userTask', 'serviceTask', 'exclusiveGateway'] as const;
const TRIGGER_MODE_ENUM: readonly WorkflowNodeTriggerMode[] = ['AND', 'OR'];
const RESUBMIT_STRATEGY_ENUM: readonly ReturnResubmitStrategy[] = [
  'FROM_RETURN_POINT',
  'RESTART',
];
const CONDITION_OPERATOR_ENUM: readonly WorkflowEdgeConditionOperator[] =
  CONDITION_OPERATOR_OPTIONS.map((option) => option.id);

const APPROVER_RESOLVER_SCHEMA: JsonSchema = {
  description:
    '簽核人員解析策略，以 type 區分。DIRECT: { type, memberIds[] }；POSITION: { type, positionId }；' +
    'ORG_UNIT_MEMBER: { type, orgUnitId, includeDescendants? }；ORG_UNIT_POSITION: { type, orgUnitId, positionId, includeDescendants? }；' +
    'ORG_MANAGER: { type, baseFromInitiator, levelsUp, fallback? }；ORG_UNIT_MANAGER: { type, orgUnitId, fallback? }；' +
    'DYNAMIC_FORM: { type, formPath }；EXPRESSION: { type, expression }。',
  properties: {
    type: {
      enum: [
        'DIRECT',
        'POSITION',
        'ORG_UNIT_MEMBER',
        'ORG_UNIT_POSITION',
        'ORG_MANAGER',
        'ORG_UNIT_MANAGER',
        'DYNAMIC_FORM',
        'EXPRESSION',
      ],
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
};

const SERVICE_ACTION_SCHEMA: JsonSchema = {
  description:
    '系統節點動作，以 type 區分。NOTIFY: { type, channels[], recipients(ApproverResolver), template? }；' +
    'WEBHOOK: { type, url, headers?, payload? }；SET_FORM_FIELD: { type, fieldPath, value }。',
  properties: {
    type: { enum: ['NOTIFY', 'WEBHOOK', 'SET_FORM_FIELD'], type: 'string' },
  },
  required: ['type'],
  type: 'object',
};

function objectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[],
): JsonSchema {
  return { additionalProperties: false, properties, required, type: 'object' };
}

// ── Tool catalog ───────────────────────────────────────────────────────────

export const WORKFLOW_TOOLSET: readonly WorkflowTool[] = [
  {
    name: 'add_node',
    description:
      '在流程中新增一個節點（簽核/系統/條件分流）。可選擇插入錨點：anchorEdgeId 會把節點插入該連線中間；anchorAfterNodeId 會接在該節點之後；皆未指定時沿用目前選取或追加到末端。',
    inputSchema: objectSchema(
      {
        nodeType: { enum: [...NODE_TYPE_ENUM], type: 'string' },
        anchorEdgeId: { type: ['string', 'null'] },
        anchorAfterNodeId: { type: ['string', 'null'] },
      },
      ['nodeType'],
    ),
    kind: 'mutation',
  },
  {
    name: 'rename_node',
    description: '修改節點顯示名稱。',
    inputSchema: objectSchema(
      { nodeId: { type: 'string' }, label: { type: 'string' } },
      ['nodeId', 'label'],
    ),
    kind: 'mutation',
  },
  {
    name: 'delete_node',
    description: '刪除節點及其相連的連線（開始/結束節點不可刪除）。',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
    kind: 'mutation',
  },
  {
    name: 'set_node_trigger_mode',
    description:
      '設定節點觸發模式：AND=所有前置完成才觸發；OR=任一前置完成即觸發（僅多重輸入時有意義）。',
    inputSchema: objectSchema(
      {
        nodeId: { type: 'string' },
        triggerMode: { enum: [...TRIGGER_MODE_ENUM], type: 'string' },
      },
      ['nodeId', 'triggerMode'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_user_task_approver',
    description: '設定簽核節點的簽核人員解析策略（會將決策政策重設為 SINGLE）。',
    inputSchema: objectSchema(
      { nodeId: { type: 'string' }, approverResolver: APPROVER_RESOLVER_SCHEMA },
      ['nodeId', 'approverResolver'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_user_task_options',
    description:
      '設定簽核節點的選項開關與描述：是否允許駁回/轉簽/加簽，以及節點描述。只更新有提供的欄位。',
    inputSchema: objectSchema(
      {
        nodeId: { type: 'string' },
        allowReject: { type: 'boolean' },
        allowTransfer: { type: 'boolean' },
        allowAddSigner: { type: 'boolean' },
        description: { type: 'string' },
      },
      ['nodeId'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_user_task_return_resubmit_strategy',
    description:
      '設定簽核節點退回後的重送策略：RESTART=從頭重跑；FROM_RETURN_POINT=回到退回節點。',
    inputSchema: objectSchema(
      {
        nodeId: { type: 'string' },
        resubmitStrategy: { enum: [...RESUBMIT_STRATEGY_ENUM], type: 'string' },
      },
      ['nodeId', 'resubmitStrategy'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_service_action',
    description: '設定系統節點的動作（NOTIFY 知會 / WEBHOOK / SET_FORM_FIELD）。',
    inputSchema: objectSchema(
      { nodeId: { type: 'string' }, action: SERVICE_ACTION_SCHEMA },
      ['nodeId', 'action'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_end_state',
    description: '設定結束節點的最終狀態（APPROVED / REJECTED）。',
    inputSchema: objectSchema(
      {
        nodeId: { type: 'string' },
        endState: { enum: ['APPROVED', 'REJECTED'], type: 'string' },
      },
      ['nodeId', 'endState'],
    ),
    kind: 'mutation',
  },
  {
    name: 'connect_edge',
    description:
      '在兩個節點之間建立連線（source → target）。若 source 不可輸出或 target 不可輸入則拒絕。',
    inputSchema: objectSchema(
      { source: { type: 'string' }, target: { type: 'string' } },
      ['source', 'target'],
    ),
    kind: 'mutation',
  },
  {
    name: 'delete_edge',
    description: '刪除一條連線。',
    inputSchema: objectSchema({ edgeId: { type: 'string' } }, ['edgeId']),
    kind: 'mutation',
  },
  {
    name: 'set_edge_condition',
    description:
      '設定條件分流輸出連線的條件（依綁定表單欄位）。fieldKey 為表單欄位、operator 為比較運算子、value 為比較值；系統會自動編譯為 CEL 條件並產生標籤。需先綁定表單。',
    inputSchema: objectSchema(
      {
        edgeId: { type: 'string' },
        fieldKey: { type: ['string', 'null'] },
        operator: { enum: [...CONDITION_OPERATOR_ENUM, null], type: ['string', 'null'] },
        value: { type: ['string', 'null'] },
      },
      ['edgeId'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_edge_default',
    description:
      '將條件分流的某條輸出連線設為（或取消）預設路徑；設為預設時會自動取消同源其他連線的預設。',
    inputSchema: objectSchema(
      { edgeId: { type: 'string' }, isDefault: { type: 'boolean' } },
      ['edgeId', 'isDefault'],
    ),
    kind: 'mutation',
  },
  {
    name: 'set_initiator_policy_cel',
    description: '直接設定發起人政策的 CEL 條件式（傳 null 代表清除/不限制）。',
    inputSchema: objectSchema({ cel: { type: ['string', 'null'] } }, ['cel']),
    kind: 'mutation',
  },
  {
    name: 'auto_layout',
    description: '對整個流程套用自動排版（由前端 dagre 重新計算節點座標）。',
    inputSchema: objectSchema({}, []),
    kind: 'mutation',
  },
  // ── Macros ──
  {
    name: 'insert_approval_step',
    description:
      '高階：新增一個簽核節點並一次設定其簽核人員（可選 label 與插入錨點）。等同 add_node + set_user_task_approver。',
    inputSchema: objectSchema(
      {
        approverResolver: APPROVER_RESOLVER_SCHEMA,
        label: { type: 'string' },
        anchorEdgeId: { type: ['string', 'null'] },
        anchorAfterNodeId: { type: ['string', 'null'] },
      },
      ['approverResolver'],
    ),
    kind: 'macro',
  },
  {
    name: 'insert_notification',
    description:
      '高階：新增一個系統節點並一次設定其動作（可選 label 與插入錨點）。等同 add_node + set_service_action。',
    inputSchema: objectSchema(
      {
        action: SERVICE_ACTION_SCHEMA,
        label: { type: 'string' },
        anchorEdgeId: { type: ['string', 'null'] },
        anchorAfterNodeId: { type: ['string', 'null'] },
      },
      ['action'],
    ),
    kind: 'macro',
  },
  {
    name: 'insert_conditional_branch',
    description: '高階：新增一個條件分流節點（可選 label 與插入錨點）。',
    inputSchema: objectSchema(
      {
        label: { type: 'string' },
        anchorEdgeId: { type: ['string', 'null'] },
        anchorAfterNodeId: { type: ['string', 'null'] },
      },
      [],
    ),
    kind: 'macro',
  },
  // ── Queries ──
  {
    name: 'get_workflow_snapshot',
    description:
      '讀取目前流程的精簡快照：所有節點、連線、選取狀態、表單綁定、發起人政策、以及驗證問題。動作前應先呼叫以了解現況。',
    inputSchema: objectSchema({}, []),
    kind: 'query',
  },
  {
    name: 'describe_node_types',
    description: '取得可用節點型別與其資料結構說明。',
    inputSchema: objectSchema({}, []),
    kind: 'query',
  },
  {
    name: 'list_form_fields',
    description: '列出目前綁定表單的欄位（fieldKey、型別、標籤），供設定條件分流條件時參考。',
    inputSchema: objectSchema({}, []),
    kind: 'query',
  },
  {
    name: 'validate_workflow',
    description: '檢查目前流程設定是否完整，回傳問題描述（無問題則為 null）。',
    inputSchema: objectSchema({}, []),
    kind: 'query',
  },
];

/** Quick lookup of a tool definition by name. */
export const WORKFLOW_TOOL_BY_NAME: ReadonlyMap<string, WorkflowTool> = new Map(
  WORKFLOW_TOOLSET.map((tool) => [tool.name, tool]),
);

// ── Snapshot (LLM-readable view of state) ──────────────────────────────────

export interface WorkflowNodeSnapshot {
  readonly id: string;
  readonly type: WorkflowNode['type'];
  readonly typeLabel: string;
  readonly label: string;
  readonly summary: string;
}

export interface WorkflowEdgeSnapshot {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly isDefault: boolean;
  readonly conditionLabel: string | null;
  readonly condition: string | null;
}

export interface WorkflowSnapshot {
  readonly nodes: readonly WorkflowNodeSnapshot[];
  readonly edges: readonly WorkflowEdgeSnapshot[];
  readonly selectedNodeId: string | null;
  readonly selectedEdgeIds: readonly string[];
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel: string | null;
  readonly issue: string | null;
}

export function readWorkflowSnapshot(
  state: WorkflowDesignerState,
): WorkflowSnapshot {
  return {
    edges: state.definition.edges.map((edge) =>
      readEdgeSnapshot(edge, state.definition.nodes),
    ),
    formDefinitionVersionId: state.formDefinitionVersionId,
    initiatorPolicyCel: state.initiatorPolicyCel,
    issue: readWorkflowIssue(state),
    nodes: state.definition.nodes.map(readNodeSnapshot),
    selectedEdgeIds: state.selectedEdgeIds,
    selectedNodeId: state.selectedNodeId,
  };
}

function readWorkflowIssue(state: WorkflowDesignerState): string | null {
  return readWorkflowDefinitionIssue(state.definition);
}

function readNodeSnapshot(node: WorkflowNode): WorkflowNodeSnapshot {
  return {
    id: node.id,
    label: node.data.label,
    summary: readNodeSummary(node),
    type: node.type,
    typeLabel: WORKFLOW_NODE_TYPE_LABELS[node.type],
  };
}

function readNodeSummary(node: WorkflowNode): string {
  if (node.type === 'userTask') {
    return `簽核人=${node.data.approverResolver.type}；觸發=${node.data.triggerMode ?? 'AND'}`;
  }

  if (node.type === 'serviceTask') {
    return `動作=${node.data.action.type}`;
  }

  if (node.type === 'endEvent') {
    return `結束狀態=${node.data.endState ?? 'APPROVED'}`;
  }

  if (node.type === 'exclusiveGateway' || node.type === 'parallelGateway') {
    return `方向=${node.data.direction}`;
  }

  return '開始';
}

function readEdgeSnapshot(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): WorkflowEdgeSnapshot {
  return {
    condition: edge.data.condition ?? null,
    conditionLabel: edge.data.label ?? null,
    id: edge.id,
    isDefault: Boolean(
      edge.data.isDefault && isExclusiveGatewaySourceEdge(edge, nodes),
    ),
    source: edge.source,
    target: edge.target,
  };
}

// ── Tool execution ─────────────────────────────────────────────────────────

export type WorkflowToolResult =
  | {
      readonly ok: true;
      readonly kind: 'mutation' | 'macro';
      readonly result: WorkflowCommandResult;
      readonly snapshot: WorkflowSnapshot;
    }
  | { readonly ok: true; readonly kind: 'query'; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

export interface ExecuteWorkflowToolOptions extends WorkflowCommandOptions {
  /**
   * Resolves a form version id to its schema (host-managed). Required only if
   * a tool needs the bound form schema. Not used by the current toolset, which
   * compiles conditions against the already-bound `state.formSchema`.
   */
  readonly resolveFormSchema?: (
    formDefinitionVersionId: string,
  ) => FormDefinitionSchema | null;
}

/**
 * Execute a single LLM tool call against the designer state. Mutations and
 * macros return the new state + a fresh snapshot; queries return read-only data.
 */
export function executeWorkflowTool(
  state: WorkflowDesignerState,
  toolName: string,
  rawInput: unknown,
  options: ExecuteWorkflowToolOptions = {},
): WorkflowToolResult {
  const tool = WORKFLOW_TOOL_BY_NAME.get(toolName);

  if (!tool) {
    return { error: `未知的工具：${toolName}`, ok: false };
  }

  const input = isRecord(rawInput) ? rawInput : {};

  try {
    if (tool.kind === 'query') {
      return { data: runQueryTool(state, toolName), kind: 'query', ok: true };
    }

    if (tool.kind === 'macro') {
      const macro = buildMacroCommand(toolName, input);
      const result = applyWorkflowMacroCommand(state, macro, options);

      return finalizeMutation('macro', result);
    }

    const command = buildPrimitiveCommand(toolName, input);
    const result = applyWorkflowCommand(state, command, options);

    return finalizeMutation('mutation', result);
  } catch (error: unknown) {
    return { error: readToolError(error), ok: false };
  }
}

function finalizeMutation(
  kind: 'mutation' | 'macro',
  result: WorkflowCommandResult,
): WorkflowToolResult {
  if (result.error) {
    return { error: result.error, ok: false };
  }

  return {
    kind,
    ok: true,
    result,
    snapshot: readWorkflowSnapshot(result.state),
  };
}

function runQueryTool(
  state: WorkflowDesignerState,
  toolName: string,
): unknown {
  if (toolName === 'get_workflow_snapshot') {
    return readWorkflowSnapshot(state);
  }

  if (toolName === 'describe_node_types') {
    return readNodeTypeCatalog();
  }

  if (toolName === 'list_form_fields') {
    return readFormFieldCatalog(state.formSchema);
  }

  // validate_workflow
  return { issue: readWorkflowIssue(state) };
}

// ── Command builders (parse LLM input → typed command) ──────────────────────

function buildPrimitiveCommand(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): WorkflowCommand {
  switch (toolName) {
    case 'add_node':
      return {
        anchor: readAnchor(input),
        nodeType: readEnum(input, 'nodeType', NODE_TYPE_ENUM),
        type: 'addNode',
      };
    case 'rename_node':
      return {
        label: readString(input, 'label'),
        nodeId: readString(input, 'nodeId'),
        type: 'renameNode',
      };
    case 'delete_node':
      return { nodeId: readString(input, 'nodeId'), type: 'deleteNode' };
    case 'set_node_trigger_mode':
      return {
        nodeId: readString(input, 'nodeId'),
        triggerMode: readEnum(input, 'triggerMode', TRIGGER_MODE_ENUM),
        type: 'setNodeTriggerMode',
      };
    case 'set_user_task_approver':
      return {
        approverResolver: parseApproverResolver(input['approverResolver']),
        nodeId: readString(input, 'nodeId'),
        type: 'setUserTaskApprover',
      };
    case 'set_user_task_options':
      return {
        nodeId: readString(input, 'nodeId'),
        type: 'setUserTaskOptions',
        ...readOptionalBoolean(input, 'allowReject', 'allowReject'),
        ...readOptionalBoolean(input, 'allowTransfer', 'allowTransfer'),
        ...readOptionalBoolean(input, 'allowAddSigner', 'allowAddSigner'),
        ...readOptionalString(input, 'description', 'description'),
      };
    case 'set_user_task_return_resubmit_strategy':
      return {
        nodeId: readString(input, 'nodeId'),
        resubmitStrategy: readEnum(
          input,
          'resubmitStrategy',
          RESUBMIT_STRATEGY_ENUM,
        ),
        type: 'setUserTaskReturnResubmitStrategy',
      };
    case 'set_service_action':
      return {
        action: parseServiceAction(input['action']),
        nodeId: readString(input, 'nodeId'),
        type: 'setServiceAction',
      };
    case 'set_end_state':
      return {
        endState: readEnum(input, 'endState', ['APPROVED', 'REJECTED'] as const),
        nodeId: readString(input, 'nodeId'),
        type: 'setEndState',
      };
    case 'connect_edge':
      return {
        source: readString(input, 'source'),
        target: readString(input, 'target'),
        type: 'connectEdge',
      };
    case 'delete_edge':
      return { edgeId: readString(input, 'edgeId'), type: 'deleteEdge' };
    case 'set_edge_condition':
      return {
        edgeId: readString(input, 'edgeId'),
        type: 'setEdgeCondition',
        fieldKey: readNullableString(input, 'fieldKey'),
        operator: readNullableEnum(input, 'operator', CONDITION_OPERATOR_ENUM),
        value: readNullableString(input, 'value'),
      };
    case 'set_edge_default':
      return {
        edgeId: readString(input, 'edgeId'),
        isDefault: readBoolean(input, 'isDefault'),
        type: 'setEdgeDefault',
      };
    case 'set_initiator_policy_cel':
      return {
        cel: readNullableString(input, 'cel'),
        type: 'setInitiatorPolicyCel',
      };
    case 'auto_layout':
      return { type: 'autoLayout' };
    default:
      throw new Error(`工具 ${toolName} 尚未支援。`);
  }
}

function buildMacroCommand(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): WorkflowMacroCommand {
  if (toolName === 'insert_approval_step') {
    return {
      anchor: readAnchor(input),
      approverResolver: parseApproverResolver(input['approverResolver']),
      type: 'insertApprovalStep',
      ...readOptionalString(input, 'label', 'label'),
    };
  }

  if (toolName === 'insert_notification') {
    return {
      action: parseServiceAction(input['action']),
      anchor: readAnchor(input),
      type: 'insertNotification',
      ...readOptionalString(input, 'label', 'label'),
    };
  }

  return {
    anchor: readAnchor(input),
    type: 'insertConditionalBranch',
    ...readOptionalString(input, 'label', 'label'),
  };
}

// ── Static catalogs for query tools ─────────────────────────────────────────

function readNodeTypeCatalog(): unknown {
  return {
    nodeTypes: [
      {
        dataShape:
          'label, approverResolver, decisionPolicy, returnBehavior, allowReject, allowTransfer, allowAddSigner, triggerMode, sla?, notification?',
        label: WORKFLOW_NODE_TYPE_LABELS.userTask,
        type: 'userTask',
      },
      {
        dataShape: 'label, action(NOTIFY|WEBHOOK|SET_FORM_FIELD), triggerMode',
        label: WORKFLOW_NODE_TYPE_LABELS.serviceTask,
        type: 'serviceTask',
      },
      {
        dataShape: 'label, direction(split|join), triggerMode；輸出連線需設定條件',
        label: WORKFLOW_NODE_TYPE_LABELS.exclusiveGateway,
        type: 'exclusiveGateway',
      },
      {
        dataShape: 'label（系統內建，固定存在）',
        label: WORKFLOW_NODE_TYPE_LABELS.startEvent,
        type: 'startEvent',
      },
      {
        dataShape: 'label, endState(APPROVED|REJECTED)',
        label: WORKFLOW_NODE_TYPE_LABELS.endEvent,
        type: 'endEvent',
      },
    ],
  };
}

function readFormFieldCatalog(schema: FormDefinitionSchema | null): unknown {
  return {
    fields:
      schema?.fields.map((field) => ({
        fieldKey: field.fieldKey,
        label: field.label,
        required: field.required,
        type: field.type,
      })) ?? [],
    hasBoundForm: Boolean(schema),
  };
}

// ── Input parsing helpers (no `any`) ────────────────────────────────────────

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = input[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`參數 ${key} 必須為非空字串。`);
  }

  return value;
}

function readBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const value = input[key];

  if (typeof value !== 'boolean') {
    throw new Error(`參數 ${key} 必須為布林值。`);
  }

  return value;
}

function readEnum<T extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): T {
  const value = input[key];

  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`參數 ${key} 必須為：${allowed.join(' / ')}。`);
  }

  return value as T;
}

function readNullableString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = input[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`參數 ${key} 必須為字串或 null。`);
  }

  return value;
}

function readNullableEnum<T extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = input[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`參數 ${key} 必須為：${allowed.join(' / ')} 或 null。`);
  }

  return value as T;
}

function readOptionalBoolean<K extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  outKey: K,
): Readonly<Record<K, boolean>> | Record<string, never> {
  const value = input[key];

  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'boolean') {
    throw new Error(`參數 ${key} 必須為布林值。`);
  }

  return { [outKey]: value } as Readonly<Record<K, boolean>>;
}

function readOptionalString<K extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  outKey: K,
): Readonly<Record<K, string>> | Record<string, never> {
  const value = input[key];

  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string') {
    throw new Error(`參數 ${key} 必須為字串。`);
  }

  return { [outKey]: value } as Readonly<Record<K, string>>;
}

function readAnchor(
  input: Readonly<Record<string, unknown>>,
): { readonly edgeId?: string | null; readonly afterNodeId?: string | null } {
  return {
    afterNodeId: readNullableString(input, 'anchorAfterNodeId'),
    edgeId: readNullableString(input, 'anchorEdgeId'),
  };
}

function parseApproverResolver(value: unknown): ApproverResolver {
  if (!isRecord(value)) {
    throw new Error('approverResolver 必須為物件。');
  }

  const type = value['type'];

  if (typeof type !== 'string') {
    throw new Error('approverResolver.type 必須為字串。');
  }

  // Discriminant + required-key validation; the JSON Schema guides the model to
  // the right shape, so a structural cast after these checks is safe.
  const requiredKeysByType: Readonly<Record<string, readonly string[]>> = {
    DIRECT: ['memberIds'],
    DYNAMIC_FORM: ['formPath'],
    EXPRESSION: ['expression'],
    ORG_MANAGER: ['baseFromInitiator', 'levelsUp'],
    ORG_UNIT_MANAGER: ['orgUnitId'],
    ORG_UNIT_MEMBER: ['orgUnitId'],
    ORG_UNIT_POSITION: ['orgUnitId', 'positionId'],
    POSITION: ['positionId'],
  };
  const requiredKeys = requiredKeysByType[type];

  if (!requiredKeys) {
    throw new Error(`approverResolver.type 不支援：${type}。`);
  }

  const missingKey = requiredKeys.find((key) => value[key] === undefined);

  if (missingKey) {
    throw new Error(`approverResolver(${type}) 缺少必要欄位：${missingKey}。`);
  }

  return value as unknown as ApproverResolver;
}

function parseServiceAction(value: unknown): ServiceAction {
  if (!isRecord(value)) {
    throw new Error('action 必須為物件。');
  }

  const type = value['type'];
  const requiredKeysByType: Readonly<Record<string, readonly string[]>> = {
    NOTIFY: ['channels', 'recipients'],
    SET_FORM_FIELD: ['fieldPath', 'value'],
    WEBHOOK: ['url'],
  };
  const requiredKeys =
    typeof type === 'string' ? requiredKeysByType[type] : undefined;

  if (!requiredKeys) {
    throw new Error(`action.type 不支援：${String(type)}。`);
  }

  const missingKey = requiredKeys.find((key) => value[key] === undefined);

  if (missingKey) {
    throw new Error(`action(${type}) 缺少必要欄位：${missingKey}。`);
  }

  return value as unknown as ServiceAction;
}

function readToolError(error: unknown): string {
  return error instanceof Error ? error.message : '工具執行發生未知錯誤。';
}
