'use client';

import {
  ChangeEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouterAdapter } from '../../../lib/router-adapter';
import type { WorkflowDirectory } from '@rytass/bpm-core-shared';
import { useWorkflowDesignerController } from './use-workflow-designer-controller';
import { WorkflowChatDrawer } from './workflow-chat-drawer';
import { FormBuilderView } from '../../forms/builder/FormBuilderView';
import { useBPMRoutes } from '../../../lib/routes-config';
import {
  Background,
  ControlButton,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  NodeTypes,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  Connection,
  ConnectionMode,
  getViewportForBounds,
  type Handle as FlowHandle,
  type Viewport,
} from '@xyflow/react';
// xyflow v12 ships no runtime style injection — the stylesheet must be bundled
// or every ReactFlow surface renders unpositioned. See org-unit-tree-draft-editor.
import '@xyflow/react/dist/style.css';
import * as dagre from 'dagre';
import {
  AutoComplete,
  Button,
  Icon,
  Input,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Textarea,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import Drawer from '@mezzanine-ui/react/Drawer';
import {
  CheckedIcon,
  DotGridIcon,
  EyeIcon,
  FilterIcon,
  MailIcon,
  SaveIcon,
  TrashIcon,
  UserIcon,
  type IconDefinition,
} from '@mezzanine-ui/icons';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  ApproverResolver,
  ApproverResolverFallback,
  DecisionPolicy,
  ServiceAction,
  SlaCalendarMode,
  SlaConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowEdgeConditionOperator,
  WorkflowEdgeData,
  WorkflowNode,
  WorkflowNodeTriggerMode,
  ReturnResubmitStrategy,
} from '@rytass/bpm-core-shared/workflow';
import {
  DEFAULT_QUORUM_THRESHOLD,
  DEFAULT_SLA_CONFIG,
  SLA_CALENDAR_MODE_OPTIONS,
  SLA_DURATION_UNIT_OPTIONS,
  SLA_TIMEOUT_ACTION_OPTIONS,
  SlaDurationParts,
  SlaDurationUnit,
  composeQuorumThreshold,
  composeSlaDuration,
  readSlaDurationParts,
} from '@rytass/bpm-core-shared/workflow-graph';
import { readFormBuilder } from '@rytass/bpm-core-client/form';
import {
  OrgUnitOption,
  OrgUnitPicker,
  PositionOption,
  PositionPicker,
  readOrgUnitOption,
  readPositionOption,
} from '../../../components/admin-pickers';
import { BPMFormField } from '../../../components/bpm-form-field';
import {
  OrgUnitRecord,
  MembershipRecord,
  PositionRecord,
  readOrganizationDashboard,
} from '@rytass/bpm-core-client/organization';
import {
  ApprovalTemplateVersionRecord,
  WorkflowDryRunResultRecord,
  composeApprovalTemplateWithForm,
  dryRunApprovalWorkflow,
  forkApprovalTemplate,
  MemberProfileRecord,
  publishApprovalTemplateVersion,
  PublishedFormVersionOption,
  readTemplateDesigner,
  resolveMemberOptions,
  searchMemberOptions,
  searchPublishedFormVersionOptions,
  TemplateDesignerRecord,
  updateApprovalTemplateDraft,
} from '@rytass/bpm-core-client/template';

type FlowNodeData = Readonly<{
  approverLines: readonly string[] | null;
  approverSummary: string | null;
  hasInput: boolean;
  hasOutput: boolean;
  initiatorPolicySummary: string | null;
  label: string;
  nodeKind: WorkflowNode['type'];
}>;
type FlowNode = Node<FlowNodeData, WorkflowNode['type']>;
type FlowNodeHandle = Omit<FlowHandle, 'nodeId'>;
type FlowEdgeData = Readonly<WorkflowEdgeData>;
type FlowEdge = Edge<FlowEdgeData>;
type NodePaletteType = 'exclusiveGateway' | 'serviceTask' | 'userTask';
type FormVersionSelectOption = Readonly<{
  formDefinitionId: string;
  formName: string;
  id: string;
  name: string;
  schema: FormDefinitionSchema;
}>;
type ConditionFieldOption = Readonly<{
  fieldType: FormFieldDefinition['type'];
  id: string;
  name: string;
}>;
type ConditionOperatorOption = Readonly<{
  id: WorkflowEdgeConditionOperator;
  name: string;
}>;
type ConditionValueOption = Readonly<{
  id: string;
  name: string;
}>;
type MemberSelectOption = Readonly<{
  displayName: string;
  email: string;
  id: string;
  memberId: string;
  name: string;
}>;
type InitiatorPolicyMode =
  | 'ALL'
  | 'CUSTOM'
  | 'NONE'
  | 'ORG_UNIT'
  | 'ORG_UNIT_POSITION';
type InitiatorPolicyDraft = Readonly<{
  includeDescendants?: boolean;
  mode: InitiatorPolicyMode;
  orgUnitId?: string;
  positionId?: string;
  value: string;
}>;
type InitiatorPolicyModeOption = Readonly<{
  id: InitiatorPolicyMode;
  name: string;
}>;
type ReturnResubmitStrategyOption = Readonly<{
  id: ReturnResubmitStrategy;
  name: string;
}>;
type ApproverResolverMode = Extract<
  ApproverResolver['type'],
  | 'DIRECT'
  | 'ORG_MANAGER'
  | 'ORG_UNIT_MANAGER'
  | 'ORG_UNIT_MEMBER'
  | 'ORG_UNIT_POSITION'
  | 'POSITION'
>;
type ApproverResolverModeOption = Readonly<{
  id: ApproverResolverMode;
  name: string;
}>;
type ManagerLevelOption = Readonly<{
  id: string;
  name: string;
  value: number;
}>;
type DecisionPolicyOption = Readonly<{
  id: DecisionPolicy['type'];
  name: string;
}>;
type QuorumThresholdTypeOption = Readonly<{
  id: 'COUNT' | 'PERCENTAGE';
  name: string;
}>;
type ApproverFallbackMode = 'DIRECT' | 'NONE';
type ApproverFallbackModeOption = Readonly<{
  id: ApproverFallbackMode;
  name: string;
}>;
type WorkflowConnectionCandidate = Readonly<{
  source?: string | null;
  sourceHandle?: string | null;
  target?: string | null;
  targetHandle?: string | null;
}>;

const WORKSPACE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const TWO_COLUMN_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'minmax(0, 1fr) 420px',
};

const FLOW_CANVAS_STYLE: CSSProperties = {
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 6,
  height: 620,
  minWidth: 0,
  overflow: 'hidden',
};

const SELECTION_DELETE_CONTROL_BUTTON_STYLE: CSSProperties = {
  alignItems: 'center',
  boxSizing: 'border-box',
  color: 'var(--mzn-color-text-error)',
  display: 'flex',
  height: 26,
  justifyContent: 'center',
  lineHeight: 0,
  padding: 0,
  width: 26,
};

const SELECTION_DELETE_CONTROL_ICON_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  width: '100%',
};

const SIDE_PANEL_CLASS_NAME = 'workflow-designer-side-panel';
const SIDE_PANEL_FORM_LABEL_WIDTH = 96;
const SIDE_PANEL_GLOBAL_STYLE = `
.${SIDE_PANEL_CLASS_NAME} .mzn-form-field--stretch .mzn-form-field__label-area,
.${SIDE_PANEL_CLASS_NAME} .mzn-form-field--horizontal .mzn-form-field__label-area {
  flex: 0 0 ${SIDE_PANEL_FORM_LABEL_WIDTH}px;
  width: ${SIDE_PANEL_FORM_LABEL_WIDTH}px;
}

.${SIDE_PANEL_CLASS_NAME} .mzn-form-field--stretch .mzn-form-field__data-entry,
.${SIDE_PANEL_CLASS_NAME} .mzn-form-field--horizontal .mzn-form-field__data-entry {
  min-width: 0;
}
`;

const CONDITION_EDGE_COLOR = '#2563eb';
const DEFAULT_EDGE_COLOR = '#64748b';
const INCOMPLETE_CONDITION_EDGE_COLOR = 'var(--mzn-color-text-error, #dc2626)';
const SELECTED_EDGE_GLOW_FILTER =
  'drop-shadow(0 0 3px rgba(0, 87, 255, 0.85)) drop-shadow(0 0 9px rgba(0, 87, 255, 0.36))';
const FLOW_CANVAS_GLOBAL_STYLE = `
.workflow-selection-delete-control.react-flow__controls-button {
  align-items: center !important;
  display: flex !important;
  height: 26px !important;
  justify-content: center !important;
  padding: 0 !important;
  width: 26px !important;
}

.workflow-selection-delete-control .mzn-icon {
  align-items: center;
  display: flex;
  justify-content: center;
}

.workflow-selection-delete-control .mzn-icon svg {
  height: 16px !important;
  max-height: none !important;
  max-width: none !important;
  width: 16px !important;
}

.workflow-edge--selected .react-flow__edge-path,
.react-flow__edge-path.workflow-edge--selected {
  filter: ${SELECTED_EDGE_GLOW_FILTER};
  opacity: 1 !important;
  stroke: ${DEFAULT_EDGE_COLOR} !important;
  stroke-opacity: 1 !important;
  stroke-width: 1.5px !important;
}

.workflow-edge--selected {
  --xy-edge-stroke: ${DEFAULT_EDGE_COLOR};
  --xy-edge-stroke-selected: ${DEFAULT_EDGE_COLOR};
  --xy-edge-stroke-width: 1.5px;
}

`;

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const FORM_STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const DRY_RUN_RESULT_STYLE: CSSProperties = {
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 6,
  display: 'grid',
  gap: 8,
  maxHeight: 360,
  overflow: 'auto',
  padding: 12,
};

const DRY_RUN_STEP_STYLE: CSSProperties = {
  borderBottom: '1px solid var(--mzn-color-border-neutral)',
  display: 'grid',
  gap: 4,
  padding: '0 0 8px',
};

const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

// Keep the form-version dropdown and the "編輯表單" button on a single line
// (dropdown grows, button hugs the right) to save vertical space.
const FORM_BIND_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
};

const FORM_BIND_FIELD_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
};

const FORM_BIND_BUTTON_STYLE: CSSProperties = {
  flex: '0 0 auto',
};

const TOOL_GROUP_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const NODE_STYLE: CSSProperties = {
  alignContent: 'center',
  background: 'var(--mzn-color-bg-surface)',
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 6,
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
  boxSizing: 'border-box',
  display: 'grid',
  gap: 4,
  height: '100%',
  minWidth: 132,
  overflow: 'visible',
  padding: '10px 12px',
  textAlign: 'center',
  width: '100%',
};
const SELECTED_NODE_BOX_SHADOW =
  '0 8px 20px rgba(15, 23, 42, 0.08), 0 0 0 1px var(--mzn-color-primary, #0057ff), 0 0 10px rgba(0, 87, 255, 0.3)';
const FLOW_NODE_INITIAL_HEIGHT = 64;
const FLOW_NODE_INITIAL_WIDTH = 160;
const FLOW_NODE_ADDITIONAL_LINE_HEIGHT = 20;
const GATEWAY_NODE_INITIAL_HEIGHT = 64;
const GATEWAY_NODE_INITIAL_WIDTH = 180;

const GATEWAY_NODE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
};

const EXCLUSIVE_GATEWAY_NODE_STYLE: CSSProperties = {
  ...GATEWAY_NODE_STYLE,
  background: '#eff6ff',
  border: '1px solid #2563eb',
};

const PARALLEL_GATEWAY_NODE_STYLE: CSSProperties = {
  ...GATEWAY_NODE_STYLE,
  background: '#f0fdfa',
  border: '1px solid #0f766e',
};

const USER_TASK_NODE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  background: '#ffffff',
};

const START_NODE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  background: '#ecfdf3',
  border: '1px solid #2f855a',
};

const END_NODE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  background: '#fff4ed',
  border: '1px solid #c2410c',
};

const NODE_TEXT_STYLE: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  minWidth: 0,
};

const NODE_PRIMARY_LABELS_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0,
};

const WORKFLOW_INPUT_HANDLE_ID = 'input';
const WORKFLOW_OUTPUT_HANDLE_ID = 'output';

const NODE_TYPE_LABELS: Readonly<Record<WorkflowNode['type'], string>> = {
  endEvent: '結束',
  exclusiveGateway: '條件分流',
  parallelGateway: '並行處理',
  serviceTask: '系統',
  startEvent: '開始',
  userTask: '簽核',
};

const ACTION_NODE_PALETTE: readonly {
  readonly icon: IconDefinition;
  readonly label: string;
  readonly type: Extract<NodePaletteType, 'serviceTask' | 'userTask'>;
}[] = [
  { icon: UserIcon, label: '簽核節點', type: 'userTask' },
  { icon: MailIcon, label: '知會節點', type: 'serviceTask' },
];
const FLOW_CONTROL_PALETTE: readonly {
  readonly icon: IconDefinition;
  readonly label: string;
  readonly type: Extract<NodePaletteType, 'exclusiveGateway'>;
}[] = [{ icon: FilterIcon, label: '條件分流', type: 'exclusiveGateway' }];
const NODE_TRIGGER_MODE_OPTIONS: readonly {
  readonly id: WorkflowNodeTriggerMode;
  readonly name: string;
}[] = [
  { id: 'AND', name: '全部前置完成' },
  { id: 'OR', name: '任一前置完成' },
];
const RETURN_RESUBMIT_STRATEGY_OPTIONS: readonly ReturnResubmitStrategyOption[] =
  [
    { id: 'RESTART', name: '重新送出後從開始重跑' },
    { id: 'FROM_RETURN_POINT', name: '重新送出後回到退回節點' },
  ];
const SLA_WARNING_AT_OPTIONS: readonly {
  readonly id: string;
  readonly name: string;
  readonly value: number | null;
}[] = [
  { id: 'NONE', name: '不提醒', value: null },
  { id: '0.5', name: '過半時提醒', value: 0.5 },
  { id: '0.75', name: '剩四分之一時提醒', value: 0.75 },
  { id: '0.9', name: '剩十分之一時提醒', value: 0.9 },
];
const APPROVER_RESOLVER_MODE_OPTIONS: readonly ApproverResolverModeOption[] = [
  { id: 'DIRECT', name: '指定會員' },
  { id: 'ORG_MANAGER', name: '發起人主管' },
  { id: 'ORG_UNIT_MANAGER', name: '指定組織主管' },
  { id: 'ORG_UNIT_MEMBER', name: '組織任一人' },
  { id: 'ORG_UNIT_POSITION', name: '組織特定職位' },
  { id: 'POSITION', name: '指定職位' },
];
// `SEQUENTIAL` is intentionally absent: the engine treats it exactly like
// `PARALLEL_ALL` (`workflow-engine.service.ts` resolves both to
// `completedCount >= totalCount`), so offering it would promise a queued
// hand-off that does not exist. Templates that already carry it stay readable
// through `readDecisionPolicyOption`.
const DECISION_POLICY_OPTIONS: readonly DecisionPolicyOption[] = [
  { id: 'SINGLE', name: '單人簽核' },
  { id: 'PARALLEL_ANY', name: '任一人同意' },
  { id: 'PARALLEL_ALL', name: '全部同意' },
  { id: 'QUORUM', name: '達到指定門檻' },
];
const QUORUM_THRESHOLD_TYPE_OPTIONS: readonly QuorumThresholdTypeOption[] = [
  { id: 'COUNT', name: '人數' },
  { id: 'PERCENTAGE', name: '百分比' },
];
const MANAGER_LEVEL_OPTIONS: readonly ManagerLevelOption[] = [
  { id: '1', name: '直屬主管', value: 1 },
  { id: '2', name: '第二層主管', value: 2 },
  { id: '3', name: '第三層主管', value: 3 },
];
const APPROVER_FALLBACK_MODE_OPTIONS: readonly ApproverFallbackModeOption[] = [
  { id: 'NONE', name: '停止流程並提示' },
  { id: 'DIRECT', name: '固定改派' },
];
const CONDITION_OPERATOR_OPTIONS: readonly ConditionOperatorOption[] = [
  { id: 'EQUALS', name: '等於' },
  { id: 'NOT_EQUALS', name: '不等於' },
  { id: 'GREATER_THAN', name: '大於' },
  { id: 'GREATER_THAN_OR_EQUALS', name: '大於等於' },
  { id: 'LESS_THAN', name: '小於' },
  { id: 'LESS_THAN_OR_EQUALS', name: '小於等於' },
  { id: 'IS_FILLED', name: '已填寫' },
  { id: 'IS_EMPTY', name: '未填寫' },
];
const CONDITION_OPERATORS_REQUIRING_VALUE: readonly WorkflowEdgeConditionOperator[] =
  [
    'EQUALS',
    'GREATER_THAN',
    'GREATER_THAN_OR_EQUALS',
    'LESS_THAN',
    'LESS_THAN_OR_EQUALS',
    'NOT_EQUALS',
  ];
const INITIATOR_POLICY_MODE_OPTIONS: readonly InitiatorPolicyModeOption[] = [
  { id: 'NONE', name: '未設定' },
  { id: 'ALL', name: '所有人' },
  { id: 'ORG_UNIT', name: '指定組織' },
  { id: 'ORG_UNIT_POSITION', name: '指定組織職位' },
];
const INITIATOR_POLICY_CUSTOM_OPTION: InitiatorPolicyModeOption = {
  id: 'CUSTOM',
  name: '既有自訂規則',
};
const DRY_RUN_MEMBER_ID = 'member-001';

const FORM_EDIT_DRAWER_BODY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const FORM_EDIT_DRAWER_CONTENT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const FORM_EDIT_DRAWER_FOOTER_STYLE: CSSProperties = {
  borderTop: '1px solid var(--mzn-color-border-neutral)',
  display: 'flex',
  gap: 8,
  paddingTop: 12,
};

const FORM_EDIT_EMPTY_SCHEMA: FormDefinitionSchema = {
  fields: [],
  schemaVersion: 1,
};

const FORM_EDIT_EMPTY_UI_SCHEMA: FormUiSchema = {
  layout: [],
  schemaVersion: 1,
};

type FormDraft = Readonly<{
  schema: FormDefinitionSchema;
  uiSchema: FormUiSchema;
}>;

const nodeTypes: NodeTypes = {
  endEvent: WorkflowNodeCard,
  exclusiveGateway: WorkflowNodeCard,
  parallelGateway: WorkflowNodeCard,
  serviceTask: WorkflowNodeCard,
  startEvent: WorkflowNodeCard,
  userTask: WorkflowNodeCard,
};

export interface TemplateDesignerViewProps {
  /**
   * Template id to load. Required in non-embedded mode; unused in embedded mode.
   */
  readonly templateId?: string;
  /**
   * When `true`, the component operates in embedded / wizard mode:
   * - No `readTemplateDesigner` call (no templateId needed).
   * - Only org data is loaded for approver pickers.
   * - PageHeader / ContentHeader, form-version binding, and dry-run are hidden.
   * - The AI assistant, when `showAiAssistant` is set, is offered through a
   *   button in the side "流程工具" panel (the PageHeader button it normally
   *   lives in is hidden here), and drives the same embedded canvas.
   * - Mutations flow out via `onWorkflowChange` / `onInitiatorPolicyChange`
   *   rather than save-draft / publish actions.
   * Default `false`.
   */
  readonly embedded?: boolean;
  /**
   * In embedded mode: the formSchema used for condition-edge compilation,
   * injected from outside (e.g. the wizard already knows the form). Replaces
   * the "bind form version" picker. Pass `null` to clear.
   */
  readonly formSchemaOverride?: FormDefinitionSchema | null;
  /**
   * In embedded mode: the initial workflow definition to seed the canvas.
   * Falls back to an empty start→end workflow when omitted.
   */
  readonly initialWorkflowDefinition?: WorkflowDefinition;
  /**
   * In embedded mode: the initial initiator-policy CEL expression.
   * Falls back to `null` (no policy) when omitted.
   */
  readonly initialInitiatorPolicyCel?: string | null;
  /**
   * In embedded mode: called whenever the workflow definition changes so the
   * host can persist the current canvas state.
   */
  readonly onWorkflowChange?: (definition: WorkflowDefinition) => void;
  /**
   * In embedded mode: called whenever the initiator-policy CEL changes.
   */
  readonly onInitiatorPolicyChange?: (cel: string | null) => void;
  /**
   * Render the "試跑流程" (dry-run) button at all. Default `true`. Hosts can
   * pass `false` to hide it (e.g. deployments that don't expose dry-run).
   * Has no effect in embedded mode, where the PageHeader is hidden entirely.
   */
  readonly showDryRun?: boolean;
  /**
   * Render the AI assistant toggle at all. Default `false` — the feature is
   * hidden unless the host opts in (e.g. a deployment that has it configured).
   */
  readonly showAiAssistant?: boolean;
  /**
   * Whether the LLM backend is configured (e.g. the host has an API key set).
   * Default `true`. When `false`, the toggle is shown but disabled and labelled
   * as not configured — a placeholder rather than a broken feature.
   */
  readonly aiAssistantAvailable?: boolean;
}

/** Resolve a React SetStateAction against the current value (no `any`). */
function resolveSetStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === 'function'
    ? (action as (previous: T) => T)(current)
    : action;
}

export function TemplateDesignerView({
  aiAssistantAvailable = true,
  embedded = false,
  formSchemaOverride,
  initialInitiatorPolicyCel,
  initialWorkflowDefinition,
  onInitiatorPolicyChange,
  onWorkflowChange,
  showAiAssistant = false,
  showDryRun = true,
  templateId,
}: TemplateDesignerViewProps): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const [record, setRecord] = useState<TemplateDesignerRecord | null>(null);
  const [draft, setDraft] = useState<ApprovalTemplateVersionRecord | null>(
    null,
  );
  const [loadedDesignerSnapshot, setLoadedDesignerSnapshot] = useState('');
  const [initiatorPolicyModeDraft, setInitiatorPolicyModeDraft] =
    useState<Exclude<InitiatorPolicyMode, 'CUSTOM'> | null>(null);
  const [initiatorPolicyDraftOverride, setInitiatorPolicyDraftOverride] =
    useState<InitiatorPolicyDraft | null>(null);
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const [flowViewport, setFlowViewport] = useState<Viewport | undefined>(
    undefined,
  );

  // Org/position data is loaded further down; mirror it into refs so the stable
  // `directory` object below always reads the latest without re-creation.
  const orgUnitsRef = useRef<readonly OrgUnitRecord[]>([]);
  const positionsRef = useRef<readonly PositionRecord[]>([]);
  // Backs the assistant's member/org lookup query tools (search_members /
  // list_org_units / list_positions) — host data, injected into the toolset.
  const directory = useMemo<WorkflowDirectory>(
    () => ({
      listOrgUnits: async () =>
        orgUnitsRef.current.map((unit) => ({ id: unit.id, name: unit.name })),
      listPositions: async () =>
        positionsRef.current.map((position) => ({
          id: position.id,
          name: position.name,
        })),
      searchMembers: async (query) =>
        readMemberSelectOptions(await searchMemberOptions(query)).map(
          (member) => ({
            email: member.email,
            id: member.memberId,
            name: member.name,
          }),
        ),
    }),
    [],
  );

  // The pure command reducer (shared with the LLM toolset) owns the workflow
  // graph, selection, form binding, and initiator policy. Every logical
  // mutation flows through `controller.dispatch`; the dagre layout + viewport
  // are injected here so the pure layer stays free of DOM concerns.
  const controller = useWorkflowDesignerController({
    directory,
    initialState: {
      definition:
        embedded && initialWorkflowDefinition != null
          ? normalizeDesignerWorkflowDefinition(initialWorkflowDefinition)
          : readFallbackWorkflowDefinition(),
      editingEdgeId: null,
      formDefinitionVersionId: null,
      formSchema: null,
      initiatorPolicyCel:
        embedded && initialInitiatorPolicyCel !== undefined
          ? initialInitiatorPolicyCel
          : null,
      selectedEdgeIds: [],
      selectedNodeId:
        embedded && initialWorkflowDefinition != null
          ? (initialWorkflowDefinition.nodes[0]?.id ?? 'start')
          : 'start',
    },
    layout: layoutWorkflowDefinition,
    onLayout: (definition): void => {
      const nextViewport = readWorkflowViewport(
        definition,
        flowCanvasRef.current,
      );

      if (nextViewport) {
        setFlowViewport(nextViewport);
      }
    },
  });
  const workflowDefinition = controller.state.definition;
  const formDefinitionVersionId = controller.state.formDefinitionVersionId;
  const initiatorPolicyCel = controller.state.initiatorPolicyCel;
  const selectedNodeId = controller.state.selectedNodeId;
  const selectedEdgeIds = controller.state.selectedEdgeIds;
  const editingEdgeId = controller.state.editingEdgeId;
  const setWorkflowDefinition = (
    action: SetStateAction<WorkflowDefinition>,
  ): void =>
    controller.replaceState((current) => ({
      ...current,
      definition: resolveSetStateAction(action, current.definition),
    }));
  const setFormDefinitionVersionId = (
    action: SetStateAction<string | null>,
  ): void =>
    controller.replaceState((current) => ({
      ...current,
      formDefinitionVersionId: resolveSetStateAction(
        action,
        current.formDefinitionVersionId,
      ),
    }));
  const setInitiatorPolicyCel = (action: SetStateAction<string | null>): void =>
    controller.replaceState((current) => ({
      ...current,
      initiatorPolicyCel: resolveSetStateAction(
        action,
        current.initiatorPolicyCel,
      ),
    }));
  const setSelectedNodeId = (action: SetStateAction<string | null>): void =>
    controller.replaceState((current) => ({
      ...current,
      selectedNodeId: resolveSetStateAction(action, current.selectedNodeId),
    }));
  const setSelectedEdgeIds = (
    action: SetStateAction<readonly string[]>,
  ): void =>
    controller.replaceState((current) => ({
      ...current,
      selectedEdgeIds: resolveSetStateAction(action, current.selectedEdgeIds),
    }));
  const setEditingEdgeId = (action: SetStateAction<string | null>): void =>
    controller.replaceState((current) => ({
      ...current,
      editingEdgeId: resolveSetStateAction(action, current.editingEdgeId),
    }));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formVersionLoading, setFormVersionLoading] = useState(false);
  const [formVersionOptions, setFormVersionOptions] = useState<
    readonly FormVersionSelectOption[]
  >([]);
  const currentDesignerSnapshot = useMemo(
    (): string =>
      JSON.stringify({
        formDefinitionVersionId,
        initiatorPolicyCel,
        workflowDefinition,
      }),
    [formDefinitionVersionId, initiatorPolicyCel, workflowDefinition],
  );
  const hasUnsavedChanges =
    Boolean(loadedDesignerSnapshot) &&
    currentDesignerSnapshot !== loadedDesignerSnapshot;
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberOptions, setMemberOptions] = useState<
    readonly MemberSelectOption[]
  >([]);
  const [orgUnits, setOrgUnits] = useState<readonly OrgUnitRecord[]>([]);
  const [positions, setPositions] = useState<readonly PositionRecord[]>([]);
  const [memberships, setMemberships] = useState<readonly MembershipRecord[]>(
    [],
  );
  // Keep the directory's refs pointed at the latest loaded org data.
  orgUnitsRef.current = orgUnits;
  positionsRef.current = positions;
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunFormDataJson, setDryRunFormDataJson] = useState('{}');
  const [dryRunResult, setDryRunResult] =
    useState<WorkflowDryRunResultRecord | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [formEditOpen, setFormEditOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<FormDraft | null>(null);
  const [formDraftDirty, setFormDraftDirty] = useState(false);
  const [formDraftLoading, setFormDraftLoading] = useState(false);
  const publishButtonText =
    hasUnsavedChanges || formDraftDirty
      ? '保存並發布'
      : draft
        ? '發布草稿'
        : '已發布';

  useEffect((): void => {
    if (embedded) {
      void loadOrganizationData();
    } else {
      void refreshDesigner();
    }
  }, [embedded, templateId]);

  useEffect((): (() => void) => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return (): void => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useEffect((): void => {
    void resolveWorkflowMemberOptions(workflowDefinition);
  }, [workflowDefinition, memberOptions]);

  useEffect((): void => {
    setWorkflowDefinition((currentDefinition) =>
      normalizeDesignerWorkflowDefinition(currentDefinition),
    );
  }, [workflowDefinition.edges, workflowDefinition.nodes]);

  function handleBackToTemplates(): void {
    if (
      hasUnsavedChanges &&
      !window.confirm('目前有尚未儲存的流程草稿，確定要離開嗎？')
    ) {
      return;
    }

    router.push(routes.templates());
  }

  const selectedNode = useMemo(
    (): WorkflowNode | null =>
      workflowDefinition.nodes.find((node) => node.id === selectedNodeId) ??
      null,
    [selectedNodeId, workflowDefinition.nodes],
  );
  const selectedNodeCanDelete = selectedNode
    ? isWorkflowNodeRemovable(selectedNode)
    : false;
  const hasDeletableSelection =
    selectedEdgeIds.length > 0 || selectedNodeCanDelete;
  const removeSelectedWorkflowElements = useCallback((): void => {
    // Remove the selected edges first, then the selected node (which also drops
    // any edges still attached to it and resets selection). Both flow through
    // the same reducer the LLM toolset uses.
    controller
      .getState()
      .selectedEdgeIds.forEach((edgeId) =>
        controller.dispatch({ edgeId, type: 'deleteEdge' }),
      );

    if (selectedNode && isWorkflowNodeRemovable(selectedNode)) {
      controller.dispatch({ nodeId: selectedNode.id, type: 'deleteNode' });
    }
  }, [controller, selectedNode]);

  useEffect((): (() => void) | undefined => {
    if (!hasDeletableSelection) {
      return undefined;
    }

    function handleDeleteSelectedElements(event: KeyboardEvent): void {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      removeSelectedWorkflowElements();
    }

    window.addEventListener('keydown', handleDeleteSelectedElements);

    return (): void => {
      window.removeEventListener('keydown', handleDeleteSelectedElements);
    };
  }, [hasDeletableSelection, removeSelectedWorkflowElements]);

  const editingEdge = useMemo(
    (): WorkflowEdge | null =>
      workflowDefinition.edges.find((edge) => edge.id === editingEdgeId) ??
      null,
    [editingEdgeId, workflowDefinition.edges],
  );
  const selectedEdge = useMemo(
    (): WorkflowEdge | null =>
      selectedEdgeIds.length === 1
        ? (workflowDefinition.edges.find(
            (edge) => edge.id === selectedEdgeIds[0],
          ) ?? null)
        : null,
    [selectedEdgeIds, workflowDefinition.edges],
  );
  const selectedEdges = useMemo(
    (): readonly WorkflowEdge[] =>
      selectedEdgeIds
        .map(
          (edgeId) =>
            workflowDefinition.edges.find((edge) => edge.id === edgeId) ?? null,
        )
        .filter((edge): edge is WorkflowEdge => Boolean(edge)),
    [selectedEdgeIds, workflowDefinition.edges],
  );
  const initiatorPolicyDraft = useMemo(
    (): InitiatorPolicyDraft =>
      initiatorPolicyDraftOverride ??
      readInitiatorPolicyUiDraft(initiatorPolicyCel, initiatorPolicyModeDraft),
    [
      initiatorPolicyCel,
      initiatorPolicyDraftOverride,
      initiatorPolicyModeDraft,
    ],
  );
  const flowNodes = useMemo(
    (): FlowNode[] =>
      workflowDefinition.nodes.map((node) =>
        readFlowNode(
          node,
          memberOptions,
          orgUnits,
          positions,
          node.id === selectedNodeId,
          initiatorPolicyDraft,
        ),
      ),
    [
      initiatorPolicyDraft,
      memberOptions,
      orgUnits,
      positions,
      selectedNodeId,
      workflowDefinition.nodes,
    ],
  );
  const flowEdges = useMemo(
    (): FlowEdge[] =>
      workflowDefinition.edges.map((edge) =>
        readFlowEdge(
          edge,
          workflowDefinition.nodes,
          selectedEdgeIds.includes(edge.id),
        ),
      ),
    [selectedEdgeIds, workflowDefinition.edges, workflowDefinition.nodes],
  );

  const selectedFormVersionOption = useMemo(
    (): FormVersionSelectOption | null =>
      readSelectOption(formVersionOptions, formDefinitionVersionId) ??
      readSelectOption(
        readFormVersionSelectOptions(record?.formVersions ?? []),
        formDefinitionVersionId,
      ),
    [formDefinitionVersionId, formVersionOptions, record?.formVersions],
  );
  const visibleFormVersionOptions = useMemo(
    (): readonly FormVersionSelectOption[] =>
      mergeSelectedOption(formVersionOptions, selectedFormVersionOption),
    [formVersionOptions, selectedFormVersionOption],
  );
  const selectedFormSchema = selectedFormVersionOption?.schema ?? null;

  // Keep the reducer's form schema in sync with the effective schema source:
  // - embedded mode: driven by `formSchemaOverride` (wizard owns the form).
  // - non-embedded mode: driven by the selected published form version.
  const effectiveFormSchema: FormDefinitionSchema | null = embedded
    ? (formSchemaOverride ?? null)
    : selectedFormSchema;

  useEffect((): void => {
    if (controller.getState().formSchema !== effectiveFormSchema) {
      controller.replaceState((current) => ({
        ...current,
        formSchema: effectiveFormSchema,
      }));
    }
  }, [controller, effectiveFormSchema]);
  const workflowIssue = useMemo(
    (): string | null => readWorkflowDefinitionIssue(workflowDefinition),
    [workflowDefinition],
  );
  const formVersionBindingLocked = useMemo(
    (): boolean => hasConfiguredConditionEdges(workflowDefinition),
    [workflowDefinition],
  );
  const initiatorPolicyIssue = useMemo(
    (): string | null => readInitiatorPolicyIssue(initiatorPolicyDraft),
    [initiatorPolicyDraft],
  );

  // Embedded mode: propagate workflow / initiatorPolicy changes to the host.
  useEffect((): void => {
    if (embedded) {
      onWorkflowChange?.(workflowDefinition);
    }
    // onWorkflowChange is intentionally omitted from deps — we only track the
    // value change, not the callback identity.
  }, [embedded, workflowDefinition]);

  useEffect((): void => {
    if (embedded) {
      onInitiatorPolicyChange?.(initiatorPolicyCel);
    }
  }, [embedded, initiatorPolicyCel]);

  /**
   * Embedded mode: load only the organisation data needed for approver pickers.
   * Does not touch the workflow / form-version / snapshot state.
   */
  async function loadOrganizationData(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const organizationDashboard = await readOrganizationDashboard();

      setOrgUnits(organizationDashboard.orgUnits);
      setPositions(organizationDashboard.positions);
      setMemberships(organizationDashboard.memberships);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Non-embedded mode: load both the template record and the organisation data,
   * then seed the controller with the draft / latest version.
   */
  async function refreshDesigner(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [nextRecord, organizationDashboard] = await Promise.all([
        readTemplateDesigner(templateId as string),
        readOrganizationDashboard(),
      ]);
      const nextDraft =
        nextRecord.versions.find((version) => version.status === 'DRAFT') ??
        null;
      const sourceVersion = nextDraft ?? nextRecord.versions[0] ?? null;

      setRecord(nextRecord);
      setDraft(nextDraft);
      setOrgUnits(organizationDashboard.orgUnits);
      setPositions(organizationDashboard.positions);
      setMemberships(organizationDashboard.memberships);
      setFormVersionOptions(
        readFormVersionSelectOptions(nextRecord.formVersions),
      );
      const nextWorkflowDefinition =
        normalizeDesignerWorkflowDefinition(
          sourceVersion?.workflowDefinition ?? readFallbackWorkflowDefinition(),
        );
      const nextFormDefinitionVersionId =
        sourceVersion?.formDefinitionVersionId ??
        nextRecord.formVersions[0]?.id ??
        null;
      const nextInitiatorPolicyCel = sourceVersion?.initiatorPolicyCel ?? null;

      setWorkflowDefinition(nextWorkflowDefinition);
      setFormDefinitionVersionId(nextFormDefinitionVersionId);
      setInitiatorPolicyCel(nextInitiatorPolicyCel);
      setLoadedDesignerSnapshot(
        JSON.stringify({
          formDefinitionVersionId: nextFormDefinitionVersionId,
          initiatorPolicyCel: nextInitiatorPolicyCel,
          workflowDefinition: nextWorkflowDefinition,
        }),
      );
      setInitiatorPolicyModeDraft(
        sourceVersion &&
          !nextRecord.template.currentVersionId &&
          !sourceVersion.initiatorPolicyCel &&
          isEmptyDesignerWorkflowDefinition(sourceVersion.workflowDefinition)
          ? 'NONE'
          : null,
      );
      setInitiatorPolicyDraftOverride(null);
      setSelectedNodeId(
        sourceVersion?.workflowDefinition.nodes[0]?.id ?? 'start',
      );
      setSelectedEdgeIds([]);
      setEditingEdgeId(null);
      // Reset form draft so next open of the drawer reloads the latest version.
      setFormDraft(null);
      setFormDraftDirty(false);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearchFormVersions(searchText: string): Promise<void> {
    setFormVersionLoading(true);
    setError(null);

    try {
      const options = await searchPublishedFormVersionOptions(searchText);
      setFormVersionOptions(
        mergeSelectedOption(
          readFormVersionSelectOptions(options),
          selectedFormVersionOption,
        ),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setFormVersionLoading(false);
    }
  }

  async function handleSearchMembers(searchText: string): Promise<void> {
    setMemberLoading(true);
    setError(null);

    try {
      const options = await searchMemberOptions(searchText);
      setMemberOptions((currentOptions) =>
        mergeMemberOptions(currentOptions, readMemberSelectOptions(options)),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setMemberLoading(false);
    }
  }

  async function resolveWorkflowMemberOptions(
    definition: WorkflowDefinition,
  ): Promise<void> {
    const memberIds = readWorkflowDirectMemberIds(definition);
    const missingMemberIds = memberIds.filter(
      (memberId) =>
        !memberOptions.some((option) => option.memberId === memberId),
    );

    if (missingMemberIds.length === 0) {
      return;
    }

    try {
      const options = await resolveMemberOptions(missingMemberIds);
      setMemberOptions((currentOptions) =>
        mergeMemberOptions(currentOptions, readMemberSelectOptions(options)),
      );
    } catch {
      setMemberOptions((currentOptions) =>
        mergeMemberOptions(
          currentOptions,
          missingMemberIds.map(readFallbackMemberSelectOption),
        ),
      );
    }
  }

  async function commitDesigner(publish: boolean): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const validationIssue = readWorkflowDefinitionIssue(workflowDefinition);
      const policyIssue = readInitiatorPolicyIssue(initiatorPolicyDraft);

      if (validationIssue || policyIssue) {
        const issue = validationIssue ?? policyIssue ?? '流程設定未完成';

        setError(issue);
        throw new Error(issue);
      }

      if (formDraftDirty && formDraft !== null) {
        await composeApprovalTemplateWithForm({
          category: record?.template.category ?? null,
          categoryId: record?.template.categoryId ?? null,
          formDefinitionId: selectedFormVersionOption?.formDefinitionId ?? null,
          formDescription: null,
          formName:
            selectedFormVersionOption?.formName ??
            record?.template.name ??
            '表單',
          initiatorPolicyCel,
          notificationConfig: null,
          publish,
          schema: formDraft.schema,
          slaDefaults: null,
          templateDescription: null,
          templateId: templateId ?? null,
          templateName: record?.template.name ?? '模板',
          uiSchema: formDraft.uiSchema,
          workflowDefinition,
        });
        setFormDraftDirty(false);
        setFormDraft(null);
        await refreshDesigner();
      } else {
        const targetDraft =
          draft ?? (await forkApprovalTemplate(templateId as string));

        const nextDraft = await updateApprovalTemplateDraft({
          formDefinitionVersionId,
          initiatorPolicyCel,
          versionId: targetDraft.id,
          workflowDefinition,
        });

        setDraft(nextDraft);

        if (publish) {
          await publishApprovalTemplateVersion(nextDraft.id);
        }

        await refreshDesigner();
      }
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft(): Promise<void> {
    await commitDesigner(false);
  }

  async function handlePublish(): Promise<void> {
    await commitDesigner(true);
  }

  function openDryRunModal(): void {
    setDryRunFormDataJson(
      JSON.stringify(
        readDryRunSampleFormData(selectedFormVersionOption),
        null,
        2,
      ),
    );
    setDryRunResult(null);
    setDryRunError(null);
    setDryRunModalOpen(true);
  }

  function closeDryRunModal(): void {
    if (dryRunRunning) {
      return;
    }

    setDryRunModalOpen(false);
  }

  async function handleDryRun(): Promise<void> {
    setDryRunRunning(true);
    setDryRunError(null);
    setDryRunResult(null);

    try {
      const formData = parseDryRunFormData(dryRunFormDataJson);
      const result = await dryRunApprovalWorkflow({
        formData,
        initiatorMemberId: DRY_RUN_MEMBER_ID,
        initiatorMetadataSnapshot: readDryRunInitiatorMetadataSnapshot(
          DRY_RUN_MEMBER_ID,
          memberships,
        ),
        workflowDefinition,
      });

      setDryRunResult(result);
    } catch (requestError: unknown) {
      setDryRunError(readErrorMessage(requestError));
    } finally {
      setDryRunRunning(false);
    }
  }

  async function openFormEditDrawer(): Promise<void> {
    setFormEditOpen(true);

    if (formDraft !== null) {
      return;
    }

    const boundFormDefinitionId =
      selectedFormVersionOption?.formDefinitionId ?? null;

    if (!boundFormDefinitionId) {
      setFormDraft({
        schema: FORM_EDIT_EMPTY_SCHEMA,
        uiSchema: FORM_EDIT_EMPTY_UI_SCHEMA,
      });

      return;
    }

    setFormDraftLoading(true);

    try {
      const builderRecord = await readFormBuilder(boundFormDefinitionId);
      const draftVersion =
        builderRecord.versions.find((v) => v.status === 'DRAFT') ??
        builderRecord.versions.find(
          (v) => v.id === builderRecord.definition.currentVersionId,
        ) ??
        builderRecord.versions[0] ??
        null;

      setFormDraft({
        schema: draftVersion?.schema ?? FORM_EDIT_EMPTY_SCHEMA,
        uiSchema: draftVersion?.uiSchema ?? FORM_EDIT_EMPTY_UI_SCHEMA,
      });
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setFormDraftLoading(false);
    }
  }

  function handleNodeChanges(
    changes: Parameters<typeof applyNodeChanges>[0],
  ): void {
    const nextFlowNodes = applyNodeChanges(changes, flowNodes);

    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      nodes: currentDefinition.nodes.map((node) => {
        const flowNode = nextFlowNodes.find(
          (candidate) => candidate.id === node.id,
        );

        return flowNode ? { ...node, position: flowNode.position } : node;
      }),
    }));
  }

  function handleConnect(connection: Connection): void {
    if (
      !isWorkflowConnectionValid(connection, workflowDefinition.nodes) ||
      !connection.source ||
      !connection.target
    ) {
      return;
    }

    controller.dispatch({
      source: connection.source,
      target: connection.target,
      type: 'connectEdge',
    });
  }

  function handleEdgeClick(event: ReactMouseEvent, edge: FlowEdge): void {
    event.stopPropagation();

    setSelectedEdgeIds((currentEdgeIds) =>
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleSelectedEdgeId(currentEdgeIds, edge.id)
        : [edge.id],
    );
    setSelectedNodeId(null);
  }

  function closeEdgeSettingsModal(): void {
    setEditingEdgeId(null);
  }

  function addWorkflowNode(type: NodePaletteType): void {
    // The reducer derives the insertion anchor from the current selection and
    // flags `effects.layout`, so the controller re-runs dagre + viewport.
    controller.dispatch({ nodeType: type, type: 'addNode' });
  }

  function updateSelectedNodeLabel(label: string): void {
    if (!selectedNode) {
      return;
    }

    controller.dispatch({ label, nodeId: selectedNode.id, type: 'renameNode' });
  }

  function updateUserTaskResolver(approverResolver: ApproverResolver): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    const nodeId = selectedNode.id;
    const decisionPolicy = selectedNode.data.decisionPolicy;

    controller.dispatch({
      approverResolver,
      nodeId,
      type: 'setUserTaskApprover',
    });

    // `applySetUserTaskApprover` (libs/shared/workflow-command.ts) hard-resets
    // decisionPolicy to SINGLE on every approver change — a documented
    // upstream contract (see the `set_user_task_approver` tool description)
    // that other callers depend on, so it stays as-is. Now that the policy is
    // author-visible on this branch, silently reverting it to SINGLE here
    // would read as data loss; re-apply whatever non-default policy the node
    // already had.
    if (decisionPolicy && decisionPolicy.type !== 'SINGLE') {
      controller.dispatch({
        decisionPolicy,
        nodeId,
        type: 'setUserTaskDecisionPolicy',
      });
    }
  }

  function updateUserTaskReturnResubmitStrategy(
    resubmitStrategy: ReturnResubmitStrategy,
  ): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    controller.dispatch({
      nodeId: selectedNode.id,
      resubmitStrategy,
      type: 'setUserTaskReturnResubmitStrategy',
    });
  }

  function updateUserTaskReturnRequireComment(requireComment: boolean): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    controller.dispatch({
      nodeId: selectedNode.id,
      requireComment,
      type: 'setUserTaskReturnRequireComment',
    });
  }

  function updateUserTaskSla(sla: SlaConfig | null): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    controller.dispatch({
      nodeId: selectedNode.id,
      sla,
      type: 'setUserTaskSla',
    });
  }

  function updateUserTaskDecisionPolicy(decisionPolicy: DecisionPolicy): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    // Every `BPMFormField` that writes a `QUORUM` policy — the threshold
    // input, and the `quorumThresholdType` switch which carries the existing
    // `threshold` across unchanged when only the type toggles — funnels
    // through this one function. Re-sanitising `threshold` here, rather than
    // trusting each call site to have clamped it against the *new*
    // `thresholdType`, is what stops a `COUNT` value entered while
    // unbounded (e.g. 500) from surviving a switch to `PERCENTAGE` and
    // becoming an unreachable engine threshold; it also means a future
    // caller of this function does not need to remember to clamp on its own.
    const sanitisedDecisionPolicy: DecisionPolicy =
      decisionPolicy.type === 'QUORUM'
        ? {
            ...decisionPolicy,
            threshold: composeQuorumThreshold(
              decisionPolicy.threshold,
              decisionPolicy.thresholdType,
            ),
          }
        : decisionPolicy;

    controller.dispatch({
      decisionPolicy: sanitisedDecisionPolicy,
      nodeId: selectedNode.id,
      type: 'setUserTaskDecisionPolicy',
    });
  }

  function updateUserTaskOptions(
    options: Readonly<{
      allowAddSigner?: boolean;
      allowReject?: boolean;
      allowTransfer?: boolean;
    }>,
  ): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    controller.dispatch({
      ...options,
      nodeId: selectedNode.id,
      type: 'setUserTaskOptions',
    });
  }

  function updateServiceAction(action: ServiceAction): void {
    if (!selectedNode || selectedNode.type !== 'serviceTask') {
      return;
    }

    controller.dispatch({
      action,
      nodeId: selectedNode.id,
      type: 'setServiceAction',
    });
  }

  function updateInitiatorPolicyDraft(
    draft: InitiatorPolicyDraft,
  ): void {
    setInitiatorPolicyDraftOverride(
      draft.mode === 'ALL' || draft.mode === 'CUSTOM' ? null : draft,
    );
    setInitiatorPolicyModeDraft(
      draft.mode === 'ALL' || draft.mode === 'CUSTOM' ? null : draft.mode,
    );
    setInitiatorPolicyCel(readInitiatorPolicyCel(draft, orgUnits));
  }

  function updateSelectedNodeTriggerMode(
    triggerMode: WorkflowNodeTriggerMode,
  ): void {
    if (!selectedNode || selectedNode.type === 'startEvent') {
      return;
    }

    controller.dispatch({
      nodeId: selectedNode.id,
      triggerMode,
      type: 'setNodeTriggerMode',
    });
  }

  function updateSelectedEdgeDefault(edgeId: string, checked: boolean): void {
    controller.dispatch({ edgeId, isDefault: checked, type: 'setEdgeDefault' });
  }

  function updateSelectedEdgeConditionState({
    edgeId,
    fieldKey,
    operator,
    value,
  }: {
    readonly edgeId: string;
    readonly fieldKey?: string | null;
    readonly operator?: WorkflowEdgeConditionOperator | null;
    readonly value?: string | null;
  }): void {
    // The reducer compiles the condition against the synced `formSchema`.
    controller.dispatch({
      edgeId,
      fieldKey,
      operator,
      type: 'setEdgeCondition',
      value,
    });
  }

  function applyAutoLayout(): void {
    controller.dispatch({ type: 'autoLayout' });
  }

  return (
    <>
        <style>{SIDE_PANEL_GLOBAL_STYLE}</style>
        {!embedded ? (
          <PageHeader>
            <ContentHeader
              description={`${draft ? `草稿 v${draft.version}` : '尚未建立草稿'} ·${
                record?.template.currentVersionId ? ' 已發布版本' : ' 尚未發布'
              }`}
              onBackClick={handleBackToTemplates}
              title={record?.template.name ?? '流程設計器'}
            >
              {showAiAssistant ? (
                <Button
                  disabled={!aiAssistantAvailable}
                  onClick={(): void => setChatOpen((current) => !current)}
                  variant={chatOpen ? 'base-primary' : 'base-secondary'}
                >
                  {aiAssistantAvailable ? 'AI 助理' : 'AI 助理（未設定）'}
                </Button>
              ) : null}
              <Button
                aria-label="儲存草稿"
                disabled={
                  saving ||
                  Boolean(workflowIssue) ||
                  Boolean(initiatorPolicyIssue)
                }
                icon={SaveIcon}
                iconType="icon-only"
                onClick={(): void => void handleSaveDraft()}
                variant="base-secondary"
              >
                儲存草稿
              </Button>
              {showDryRun ? (
                <Button
                  disabled={
                    loading ||
                    Boolean(workflowIssue) ||
                    Boolean(initiatorPolicyIssue)
                  }
                  icon={EyeIcon}
                  iconType="leading"
                  onClick={openDryRunModal}
                  variant="base-secondary"
                >
                  試跑流程
                </Button>
              ) : null}
              <Button
                disabled={
                  saving ||
                  (!draft && !hasUnsavedChanges && !formDraftDirty) ||
                  Boolean(workflowIssue) ||
                  Boolean(initiatorPolicyIssue)
                }
                icon={CheckedIcon}
                iconType="leading"
                onClick={(): void => void handlePublish()}
                variant="base-primary"
              >
                {publishButtonText}
              </Button>
            </ContentHeader>
          </PageHeader>
        ) : null}

        <SectionGroup>
          <Section>
            <div style={WORKSPACE_STYLE}>
              {error ? (
                <Typography color="text-error" variant="body">
                  {error}
                </Typography>
              ) : null}
              {workflowIssue ? (
                <Typography color="text-error" variant="body">
                  {workflowIssue}
                </Typography>
              ) : null}
              {initiatorPolicyIssue ? (
                <Typography color="text-error" variant="body">
                  {initiatorPolicyIssue}
                </Typography>
              ) : null}
              {!embedded ? (
                <div style={FORM_STACK_STYLE}>
                  <BPMFormField
                    hintText={
                      formVersionBindingLocked
                        ? '已設定條件分流條件。請先移除所有條件，才能更換綁定表單版本。'
                        : undefined
                    }
                    label="綁定表單版本"
                    name="formDefinitionVersionId"
                    required
                  >
                    <div style={FORM_BIND_ROW_STYLE}>
                      <div style={FORM_BIND_FIELD_STYLE}>
                        <AutoComplete
                          asyncData
                          disabled={loading || formVersionBindingLocked}
                          disabledOptionsFilter
                          emptyText="沒有符合的已發布表單版本"
                          isForceClearable={
                            Boolean(formDefinitionVersionId) &&
                            !formVersionBindingLocked
                          }
                          loading={formVersionLoading}
                          loadingText="搜尋表單版本中..."
                          mode="single"
                          onChange={(option): void => {
                            if (!formVersionBindingLocked) {
                              setFormDefinitionVersionId(option?.id ?? null);
                            }
                          }}
                          onClear={(): void => {
                            if (!formVersionBindingLocked) {
                              setFormDefinitionVersionId(null);
                            }
                          }}
                          onSearch={handleSearchFormVersions}
                          onVisibilityChange={(open): void => {
                            if (open && !formVersionBindingLocked) {
                              void handleSearchFormVersions('');
                            }
                          }}
                          options={[...visibleFormVersionOptions]}
                          placeholder="選擇已發布表單版本"
                          searchDebounceTime={300}
                          value={selectedFormVersionOption}
                        />
                      </div>
                      <Button
                        disabled={loading}
                        onClick={(): void => {
                          void openFormEditDrawer();
                        }}
                        style={FORM_BIND_BUTTON_STYLE}
                        variant="base-secondary"
                      >
                        編輯表單
                      </Button>
                    </div>
                  </BPMFormField>
                </div>
              ) : null}
              <div style={TWO_COLUMN_STYLE}>
                <div ref={flowCanvasRef} style={FLOW_CANVAS_STYLE}>
                  <ReactFlow
                    connectionMode={ConnectionMode.Strict}
                    edges={flowEdges}
                    fitView
                    isValidConnection={(connection): boolean =>
                      isWorkflowConnectionValid(
                        connection,
                        workflowDefinition.nodes,
                      )
                    }
                    nodeTypes={nodeTypes}
                    nodes={flowNodes}
                    deleteKeyCode={null}
                    multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                    onConnect={handleConnect}
                    onEdgeClick={handleEdgeClick}
                    onNodeClick={(_, node): void => {
                      setSelectedNodeId(node.id);
                      setSelectedEdgeIds([]);
                    }}
                    onNodesChange={handleNodeChanges}
                    onPaneClick={(): void => {
                      setSelectedNodeId(null);
                      setSelectedEdgeIds([]);
                    }}
                    onViewportChange={setFlowViewport}
                    viewport={flowViewport}
                  >
                    <Background />
                    <style>{FLOW_CANVAS_GLOBAL_STYLE}</style>
                    <Controls>
                      {hasDeletableSelection ? (
                        <ControlButton
                          aria-label="刪除選取項目"
                          className="workflow-selection-delete-control"
                          onClick={removeSelectedWorkflowElements}
                          style={SELECTION_DELETE_CONTROL_BUTTON_STYLE}
                          title="刪除選取項目"
                        >
                          <span style={SELECTION_DELETE_CONTROL_ICON_STYLE}>
                            <Icon color="error" icon={TrashIcon} size={16} />
                          </span>
                        </ControlButton>
                      ) : null}
                    </Controls>
                    <AutoLayoutPanel onApplyAutoLayout={applyAutoLayout} />
                    <MiniMap />
                  </ReactFlow>
                </div>
                <div className={SIDE_PANEL_CLASS_NAME} style={PANEL_STYLE}>
                  <Typography component="h2" variant="h3">
                    流程工具
                  </Typography>
                  {embedded && showAiAssistant ? (
                    <div style={TOOL_GROUP_STYLE}>
                      <Typography color="text-neutral" variant="caption">
                        AI 協助
                      </Typography>
                      <div style={BUTTON_ROW_STYLE}>
                        <Button
                          disabled={!aiAssistantAvailable}
                          onClick={(): void =>
                            setChatOpen((current) => !current)
                          }
                          size="sub"
                          variant={chatOpen ? 'base-primary' : 'base-secondary'}
                        >
                          {aiAssistantAvailable
                            ? 'AI 助理'
                            : 'AI 助理（未設定）'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div style={TOOL_GROUP_STYLE}>
                    <Typography color="text-neutral" variant="caption">
                      動作節點
                    </Typography>
                    <div style={BUTTON_ROW_STYLE}>
                      {ACTION_NODE_PALETTE.map((item) => (
                        <Button
                          icon={item.icon}
                          iconType="leading"
                          key={item.type}
                          onClick={(): void => addWorkflowNode(item.type)}
                          size="sub"
                          variant="base-secondary"
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div style={TOOL_GROUP_STYLE}>
                    <Typography color="text-neutral" variant="caption">
                      流程控制
                    </Typography>
                    <div style={BUTTON_ROW_STYLE}>
                      {FLOW_CONTROL_PALETTE.map((item) => (
                        <Button
                          icon={item.icon}
                          iconType="leading"
                          key={item.type}
                          onClick={(): void => addWorkflowNode(item.type)}
                          size="sub"
                          variant="base-secondary"
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {selectedEdges.length > 1
                    ? renderSelectedEdgesPanel(selectedEdges)
                    : null}
                  {selectedEdges.length === 1 && selectedEdge
                    ? renderEdgePanel(selectedEdge)
                    : null}
                  {selectedEdges.length === 0 && selectedNode
                    ? renderNodePanel(selectedNode)
                    : null}
                </div>
              </div>
            </div>
          </Section>
        </SectionGroup>
        {renderEdgeSettingsModal(editingEdge)}
        {!embedded && showDryRun ? renderDryRunModal() : null}
        {showAiAssistant && aiAssistantAvailable ? (
          <WorkflowChatDrawer
            controller={controller}
            onClose={(): void => setChatOpen(false)}
            open={chatOpen}
          />
        ) : null}
        {!embedded ? (
          <Drawer
            headerTitle="編輯表單"
            isHeaderDisplay
            onClose={(): void => setFormEditOpen(false)}
            open={formEditOpen}
            size="wide"
          >
            <div style={FORM_EDIT_DRAWER_BODY_STYLE}>
              <div style={FORM_EDIT_DRAWER_CONTENT_STYLE}>
                {formDraftLoading ? (
                  <Typography color="text-neutral" variant="body">
                    載入中…
                  </Typography>
                ) : (
                  <FormBuilderView
                    onChange={(next): void => {
                      setFormDraft(next);
                    }}
                    value={
                      formDraft ?? {
                        schema: FORM_EDIT_EMPTY_SCHEMA,
                        uiSchema: FORM_EDIT_EMPTY_UI_SCHEMA,
                      }
                    }
                  />
                )}
              </div>
              <div style={FORM_EDIT_DRAWER_FOOTER_STYLE}>
                <Button
                  disabled={formDraftLoading}
                  onClick={(): void => {
                    if (formDraft !== null) {
                      setFormDraftDirty(true);
                      controller.replaceState((current) => ({
                        ...current,
                        formSchema: formDraft.schema,
                      }));
                    }

                    setFormEditOpen(false);
                  }}
                  variant="base-primary"
                >
                  套用
                </Button>
                <Button
                  onClick={(): void => setFormEditOpen(false)}
                  variant="base-secondary"
                >
                  取消
                </Button>
              </div>
            </div>
          </Drawer>
        ) : null}
      </>
  );

  function renderDryRunModal(): ReactElement {
    return (
      <Modal
        cancelText="關閉"
        confirmText="執行試跑"
        loading={dryRunRunning}
        modalType="standard"
        onCancel={closeDryRunModal}
        onClose={closeDryRunModal}
        onConfirm={(): void => void handleDryRun()}
        open={dryRunModalOpen}
        showModalFooter
        showModalHeader
        size="wide"
        supportingText={`使用 ${DRY_RUN_MEMBER_ID} 與範例表單資料模擬目前畫布流程，不會建立案件。`}
        title="試跑流程"
      >
        <div style={FORM_STACK_STYLE}>
          <BPMFormField
            label="表單資料 JSON"
            name="dryRunFormDataJson"
            required
          >
            <Textarea
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setDryRunFormDataJson(event.target.value)
              }
              resize="vertical"
              rows={8}
              value={dryRunFormDataJson}
            />
          </BPMFormField>
          {dryRunError ? (
            <Typography color="text-error" variant="body">
              {dryRunError}
            </Typography>
          ) : null}
          {dryRunResult ? (
            <div style={DRY_RUN_RESULT_STYLE}>
              <Typography
                color={dryRunResult.valid ? 'text-success' : 'text-error'}
                variant="label-primary-highlight"
              >
                {dryRunResult.valid ? '試跑通過' : '試跑失敗'}
              </Typography>
              {dryRunResult.errors.map((resultError) => (
                <Typography color="text-error" key={resultError} variant="body">
                  {resultError}
                </Typography>
              ))}
              {dryRunResult.steps.map((step) => (
                <div key={step.id} style={DRY_RUN_STEP_STYLE}>
                  <Typography variant="label-primary-highlight">
                    {step.nodeLabel} · {readDryRunStatusLabel(step.status)}
                  </Typography>
                  <Typography color="text-neutral" variant="caption">
                    {readWorkflowNodeTypeLabel(step.nodeType)}
                    {step.assigneeMemberId
                      ? ` · 處理者：${step.assigneeMemberId}`
                      : ''}
                    {step.edgeLabel ? ` · 來源線段：${step.edgeLabel}` : ''}
                  </Typography>
                  {step.edgeReason ? (
                    <Typography color="text-neutral" variant="caption">
                      {step.edgeReason}
                    </Typography>
                  ) : null}
                  {step.entryCondition ? (
                    <Typography color="text-neutral" variant="caption">
                      進入條件：
                      {step.entryConditionMatched ? '符合' : '不符合'} ·{' '}
                      {step.entryCondition}
                    </Typography>
                  ) : null}
                  <Typography color="text-neutral" variant="body">
                    {step.message}
                  </Typography>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  function renderNodePanel(node: WorkflowNode): ReactElement {
    return (
      <div style={FORM_STACK_STYLE}>
        <Typography component="h2" variant="h3">
          節點屬性
        </Typography>
        <Typography color="text-neutral" variant="body">
          {NODE_TYPE_LABELS[node.type]} · {node.id}
        </Typography>
        <BPMFormField label="顯示名稱" name="nodeLabel" required>
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedNodeLabel(event.target.value)
            }
            value={node.data.label}
            variant="base"
          />
        </BPMFormField>
        {node.type === 'startEvent' ? renderStartEventPanel() : null}
        {node.type !== 'startEvent' ? renderNodeTriggerModePanel(node) : null}
        {node.type === 'userTask' ? renderUserTaskPanel(node) : null}
        {node.type === 'serviceTask' ? renderServiceTaskPanel(node) : null}
      </div>
    );
  }

  function renderStartEventPanel(): ReactElement {
    const policyModeOptions =
      initiatorPolicyDraft.mode === 'CUSTOM'
        ? [...INITIATOR_POLICY_MODE_OPTIONS, INITIATOR_POLICY_CUSTOM_OPTION]
        : [...INITIATOR_POLICY_MODE_OPTIONS];
    const selectedInitiatorOrgUnit =
      initiatorPolicyDraft.mode === 'ORG_UNIT' ||
      initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION'
        ? readSelectedOrgUnitOption(
            orgUnits,
            initiatorPolicyDraft.orgUnitId ?? '',
          )
        : null;
    const selectedInitiatorPosition =
      initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION'
        ? readSelectedPositionOption(
            positions,
            initiatorPolicyDraft.positionId ?? '',
          )
        : null;
    const initiatorScopedPositions =
      initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION'
        ? readOrgScopedPositions({
            includeDescendants: Boolean(
              initiatorPolicyDraft.includeDescendants,
            ),
            memberships,
            orgUnitId: initiatorPolicyDraft.orgUnitId ?? '',
            orgUnits,
            positions,
          })
        : [];

    return (
      <>
        <BPMFormField
          hintText={
            initiatorPolicyDraft.mode === 'CUSTOM'
              ? '這是舊版表達式規則；切換成標準選項後會改由 UI 管理。'
              : undefined
          }
          label="發起權限"
          name="initiatorPolicyMode"
          required
        >
          <Select
            clearable={false}
            onChange={(option): void => {
              if (option?.id === 'CUSTOM') {
                setInitiatorPolicyModeDraft(null);
                setInitiatorPolicyDraftOverride(null);

                return;
              }

              const mode = readInitiatorPolicyMode(option?.id ?? null);
              const draft = readDefaultInitiatorPolicyDraft(mode);

              setInitiatorPolicyModeDraft(mode === 'ALL' ? null : mode);
              setInitiatorPolicyDraftOverride(mode === 'ALL' ? null : draft);
              setInitiatorPolicyCel(
                readInitiatorPolicyCel(draft, orgUnits),
              );
            }}
            options={policyModeOptions}
            placeholder="選擇誰可以發起"
            value={readSelectOption(
              policyModeOptions,
              initiatorPolicyDraft.mode,
            )}
          />
        </BPMFormField>
        {initiatorPolicyDraft.mode === 'ORG_UNIT' ||
        initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION' ? (
          <BPMFormField label="組織" name="initiatorOrgUnitId" required>
            <OrgUnitPicker
              name="initiatorOrgUnitId"
              onChange={(option): void =>
                updateInitiatorPolicyDraft({
                  ...initiatorPolicyDraft,
                  orgUnitId: option?.id ?? '',
                  positionId: '',
                  value: option?.id ?? '',
                })
              }
              orgUnits={orgUnits}
              placeholder="選擇組織"
              value={selectedInitiatorOrgUnit}
            />
          </BPMFormField>
        ) : null}
        {initiatorPolicyDraft.mode === 'ORG_UNIT' ||
        initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION' ? (
          <BPMFormField label="包含下層" name="initiatorIncludeDescendants">
            <Toggle
              checked={Boolean(initiatorPolicyDraft.includeDescendants)}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateInitiatorPolicyDraft({
                  ...initiatorPolicyDraft,
                  includeDescendants: event.target.checked,
                  ...(initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION'
                    ? { positionId: '' }
                    : {}),
                })
              }
            />
          </BPMFormField>
        ) : null}
        {initiatorPolicyDraft.mode === 'ORG_UNIT_POSITION' ? (
          <BPMFormField label="職位" name="initiatorPositionId" required>
            <PositionPicker
              disabled={!initiatorPolicyDraft.orgUnitId?.trim()}
              name="initiatorPositionId"
              onChange={(option): void =>
                updateInitiatorPolicyDraft({
                  ...initiatorPolicyDraft,
                  positionId: option?.id ?? '',
                })
              }
              placeholder={
                initiatorPolicyDraft.orgUnitId?.trim()
                  ? '選擇職位'
                  : '請先選擇組織'
              }
              positions={initiatorScopedPositions}
              value={selectedInitiatorPosition}
            />
          </BPMFormField>
        ) : null}
      </>
    );
  }

  function renderNodeTriggerModePanel(
    node: Exclude<WorkflowNode, { type: 'startEvent' }>,
  ): ReactElement {
    const incomingEdgeCount = workflowDefinition.edges.filter(
      (edge) => edge.target === node.id,
    ).length;
    const triggerModeLocked = incomingEdgeCount < 2;
    const triggerMode = triggerModeLocked
      ? 'AND'
      : (node.data.triggerMode ?? 'AND');

    return (
      <BPMFormField
        hintText={
          triggerModeLocked
            ? '需要至少兩條前置連線，才可切換為任一前置完成。'
            : incomingEdgeCount > 1
              ? `${incomingEdgeCount} 條前置連線會依此規則觸發。`
              : '只有一條前置連線時，兩種設定效果相同。'
        }
        label="前置條件"
        name="triggerMode"
        required
      >
        <Select
          clearable={false}
          onChange={(option): void =>
            triggerModeLocked
              ? undefined
              : updateSelectedNodeTriggerMode(
                  readWorkflowNodeTriggerMode(option?.id ?? null),
                )
          }
          options={[...NODE_TRIGGER_MODE_OPTIONS]}
          readOnly={triggerModeLocked}
          value={readSelectOption(NODE_TRIGGER_MODE_OPTIONS, triggerMode)}
        />
      </BPMFormField>
    );
  }

  function renderUserTaskPanel(
    node: Extract<WorkflowNode, { type: 'userTask' }>,
  ): ReactElement {
    const resolver = node.data.approverResolver;
    const resolverMode = readApproverResolverMode(resolver.type);
    const selectedMembers =
      resolver.type === 'DIRECT'
        ? resolver.memberIds.map((memberId) =>
            readMemberSelectOption(memberOptions, memberId),
          )
        : [];
    const selectedOrgUnit =
      resolver.type === 'ORG_UNIT_MANAGER' ||
      resolver.type === 'ORG_UNIT_MEMBER' ||
      resolver.type === 'ORG_UNIT_POSITION'
        ? readSelectedOrgUnitOption(orgUnits, resolver.orgUnitId)
        : null;
    const selectedPosition =
      resolver.type === 'POSITION' || resolver.type === 'ORG_UNIT_POSITION'
        ? readSelectedPositionOption(positions, resolver.positionId)
        : null;
    const orgScopedPositions =
      resolver.type === 'ORG_UNIT_POSITION'
        ? readOrgScopedPositions({
            includeDescendants: Boolean(resolver.includeDescendants),
            memberships,
            orgUnitId: resolver.orgUnitId,
            orgUnits,
            positions,
          })
        : [];
    const selectedManagerLevel =
      resolver.type === 'ORG_MANAGER'
        ? readManagerLevelOption(resolver.levelsUp)
        : MANAGER_LEVEL_OPTIONS[0];
    const fallback =
      resolver.type === 'ORG_MANAGER' || resolver.type === 'ORG_UNIT_MANAGER'
        ? (resolver.fallback ?? { type: 'NONE' as const })
        : { type: 'NONE' as const };
    const fallbackMember =
      fallback.type === 'DIRECT'
        ? readMemberSelectOption(memberOptions, fallback.memberId)
        : null;
    const resubmitStrategy =
      node.data.returnBehavior.resubmitStrategy ?? 'RESTART';
    const sla = node.data.sla ?? null;
    // A hand-authored or AI-authored template may carry a mixed duration such
    // as `P1DT4H`, which this form cannot represent. Keep it visible and
    // read-only rather than silently rewriting it.
    const slaDurationParts = sla ? readSlaDurationParts(sla.duration) : null;
    const slaDurationUnit = slaDurationParts?.unit ?? 'DAY';
    const slaWarningAtOption = readSlaWarningAtOption(sla?.warningAt ?? null);
    const slaEscalateLevel = readManagerLevelOption(
      sla?.escalateLevelsUp ?? 1,
    );
    // The schema types `decisionPolicy` as required, but templates authored
    // before the field existed carry no such key at runtime, so every read goes
    // through helpers that tolerate `undefined` — same stance as
    // `readDecisionPolicyHint`.
    const decisionPolicyType = readDecisionPolicyType(node.data.decisionPolicy);
    const quorum = readQuorumParts(node.data.decisionPolicy);

    return (
      <>
        <BPMFormField label="簽核來源" name="approverResolverType" required>
          <Select
            clearable={false}
            onChange={(option): void =>
              updateUserTaskResolver(
                readDefaultApproverResolver(option?.id ?? null),
              )
            }
            options={[...APPROVER_RESOLVER_MODE_OPTIONS]}
            value={readSelectOption(
              APPROVER_RESOLVER_MODE_OPTIONS,
              resolverMode,
            )}
          />
        </BPMFormField>
        {resolver.type === 'DIRECT' ? (
          <BPMFormField
            hintText={readDecisionPolicyHint(node.data.decisionPolicy)}
            label="簽核者"
            name="memberId"
            required
          >
            <AutoComplete
              asyncData
              disabledOptionsFilter
              emptyText="沒有符合的成員"
              inputProps={{
                autoCapitalize: 'none',
                autoCorrect: 'off',
                name: 'workflow-approver-search',
                spellCheck: false,
              }}
              loading={memberLoading}
              loadingText="搜尋成員中..."
              mode="multiple"
              onChange={(options): void =>
                updateUserTaskResolver({
                  memberIds: options.map((option) => option.id),
                  type: 'DIRECT',
                })
              }
              onSearch={handleSearchMembers}
              onVisibilityChange={(open): void => {
                if (open) {
                  void handleSearchMembers('');
                }
              }}
              options={[...memberOptions]}
              placeholder="搜尋姓名或信箱"
              searchDebounceTime={300}
              value={selectedMembers}
            />
          </BPMFormField>
        ) : null}
        {resolver.type === 'ORG_MANAGER' ? (
          <BPMFormField
            hintText="依發起人的有效會員歸屬與主管解析規則決定簽核人。"
            label="主管層級"
            name="managerLevelsUp"
            required
          >
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskResolver({
                  baseFromInitiator: true,
                  levelsUp: readManagerLevelOptionById(option?.id ?? null)
                    .value,
                  type: 'ORG_MANAGER',
                })
              }
              options={[...MANAGER_LEVEL_OPTIONS]}
              value={selectedManagerLevel}
            />
          </BPMFormField>
        ) : null}
        {resolver.type === 'ORG_UNIT_MANAGER' ||
        resolver.type === 'ORG_UNIT_MEMBER' ||
        resolver.type === 'ORG_UNIT_POSITION' ? (
          <BPMFormField
            hintText={
              resolver.type === 'ORG_UNIT_MANAGER'
                ? '依指定組織或其上層的主管解析規則決定簽核人。'
                : '依指定組織目前有效會員歸屬建立候選簽核人。'
            }
            label="組織"
            name="orgUnitId"
            required
          >
            <OrgUnitPicker
              name="orgUnitId"
              onChange={(option): void =>
                updateUserTaskResolver(
                  resolver.type === 'ORG_UNIT_MEMBER'
                    ? {
                        includeDescendants: resolver.includeDescendants,
                        orgUnitId: option?.id ?? '',
                        type: 'ORG_UNIT_MEMBER',
                      }
                    : resolver.type === 'ORG_UNIT_POSITION'
                      ? {
                          includeDescendants: resolver.includeDescendants,
                          orgUnitId: option?.id ?? '',
                          positionId: '',
                          type: 'ORG_UNIT_POSITION',
                        }
                      : {
                          fallback: resolver.fallback,
                          orgUnitId: option?.id ?? '',
                          type: 'ORG_UNIT_MANAGER',
                        },
                )
              }
              orgUnits={orgUnits}
              placeholder="選擇組織"
              value={selectedOrgUnit}
            />
          </BPMFormField>
        ) : null}
        {resolver.type === 'ORG_MANAGER' ||
        resolver.type === 'ORG_UNIT_MANAGER' ? (
          <>
            <BPMFormField
              hintText="開啟後只取離該員最近一層的主管規則；掛在上層單位、涵蓋範圍較大的規則不會再一併加入簽核人。"
              label="只取最近一層主管"
              name="preferClosestOrgUnit"
            >
              <Toggle
                checked={Boolean(resolver.preferClosestOrgUnit)}
                inputProps={{
                  id: 'preferClosestOrgUnit',
                  name: 'preferClosestOrgUnit',
                }}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  updateUserTaskResolver({
                    ...resolver,
                    preferClosestOrgUnit: event.target.checked,
                  })
                }
              />
            </BPMFormField>
            <BPMFormField
              hintText="預設會停止流程並提示；若設定固定人，找不到主管時會改派給該會員。"
              label="無主管時"
              name="approverFallbackMode"
              required
            >
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateUserTaskResolver(
                    updateApproverResolverFallback(
                      resolver,
                      readApproverFallbackMode(option?.id ?? null) === 'DIRECT'
                        ? { memberId: '', type: 'DIRECT' }
                        : { type: 'NONE' },
                    ),
                  )
                }
                options={[...APPROVER_FALLBACK_MODE_OPTIONS]}
                value={readSelectOption(
                  APPROVER_FALLBACK_MODE_OPTIONS,
                  fallback.type,
                )}
              />
            </BPMFormField>
            {fallback.type === 'DIRECT' ? (
              <>
                <BPMFormField
                  label="改派人員"
                  name="approverFallbackMemberId"
                  required
                >
                  <AutoComplete
                    asyncData
                    disabledOptionsFilter
                    emptyText="沒有符合的成員"
                    inputProps={{
                      autoCapitalize: 'none',
                      autoCorrect: 'off',
                      name: 'workflow-approver-fallback-search',
                      spellCheck: false,
                    }}
                    loading={memberLoading}
                    loadingText="搜尋成員中..."
                    mode="single"
                    onChange={(option): void =>
                      updateUserTaskResolver(
                        updateApproverResolverFallback(resolver, {
                          allowInitiatorSelfApproval:
                            fallback.allowInitiatorSelfApproval,
                          memberId: option?.id ?? '',
                          type: 'DIRECT',
                        }),
                      )
                    }
                    onSearch={handleSearchMembers}
                    onVisibilityChange={(open): void => {
                      if (open) {
                        void handleSearchMembers('');
                      }
                    }}
                    options={[...memberOptions]}
                    placeholder="搜尋姓名或信箱"
                    searchDebounceTime={300}
                    value={fallbackMember}
                  />
                </BPMFormField>
                <BPMFormField
                  hintText="預設禁止申請人簽自己的案件；只有此流程允許自簽時才開啟。"
                  label="允許自簽"
                  name="allowInitiatorSelfApproval"
                >
                  <Toggle
                    checked={Boolean(fallback.allowInitiatorSelfApproval)}
                    inputProps={{
                      id: 'allowInitiatorSelfApproval',
                      name: 'allowInitiatorSelfApproval',
                    }}
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      updateUserTaskResolver(
                        updateApproverResolverFallback(resolver, {
                          allowInitiatorSelfApproval: event.target.checked,
                          memberId: fallback.memberId,
                          type: 'DIRECT',
                        }),
                      )
                    }
                  />
                </BPMFormField>
              </>
            ) : null}
          </>
        ) : null}
        {resolver.type === 'ORG_UNIT_MEMBER' ||
        resolver.type === 'ORG_UNIT_POSITION' ? (
          <BPMFormField label="包含下層" name="includeDescendants">
            <Toggle
              checked={Boolean(resolver.includeDescendants)}
              inputProps={{
                id: 'includeDescendants',
                name: 'includeDescendants',
              }}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateUserTaskResolver({
                  ...resolver,
                  includeDescendants: event.target.checked,
                  ...(resolver.type === 'ORG_UNIT_POSITION'
                    ? { positionId: '' }
                    : {}),
                })
              }
            />
          </BPMFormField>
        ) : null}
        {resolver.type === 'POSITION' ? (
          <BPMFormField
            hintText="指派給目前有效歸屬中擁有此職位的會員；主要歸屬優先。"
            label="職位"
            name="positionId"
            required
          >
            <PositionPicker
              name="positionId"
              onChange={(option): void =>
                updateUserTaskResolver({
                  positionId: option?.id ?? '',
                  type: 'POSITION',
                })
              }
              placeholder="選擇職位"
              positions={positions}
              value={selectedPosition}
            />
          </BPMFormField>
        ) : null}
        {resolver.type === 'ORG_UNIT_POSITION' ? (
          <BPMFormField
            hintText="只納入指定組織範圍內擁有此職位的有效會員。"
            label="職位"
            name="orgUnitPositionId"
            required
          >
            <PositionPicker
              disabled={!resolver.orgUnitId.trim()}
              name="orgUnitPositionId"
              onChange={(option): void =>
                updateUserTaskResolver({
                  includeDescendants: resolver.includeDescendants,
                  orgUnitId: resolver.orgUnitId,
                  positionId: option?.id ?? '',
                  type: 'ORG_UNIT_POSITION',
                })
              }
              placeholder={
                resolver.orgUnitId.trim() ? '選擇職位' : '請先選擇組織'
              }
              positions={orgScopedPositions}
              value={selectedPosition}
            />
          </BPMFormField>
        ) : null}
        <BPMFormField
          hintText="決定這一關要幾位簽核者同意才會通過；單人簽核與任一人同意的效果完全相同，皆為其中一人同意即通過。"
          label="決策方式"
          name="decisionPolicy"
          required
        >
          <Select
            clearable={false}
            onChange={(option): void =>
              updateUserTaskDecisionPolicy(
                readDecisionPolicyFromOptionId(
                  option?.id ?? null,
                  node.data.decisionPolicy,
                ),
              )
            }
            options={[...DECISION_POLICY_OPTIONS]}
            value={readDecisionPolicyOption(decisionPolicyType)}
          />
        </BPMFormField>
        {decisionPolicyType === 'QUORUM' ? (
          <>
            <BPMFormField
              label="門檻計算方式"
              name="quorumThresholdType"
              required
            >
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateUserTaskDecisionPolicy({
                    threshold: quorum.threshold,
                    thresholdType: readQuorumThresholdType(option?.id ?? null),
                    type: 'QUORUM',
                  })
                }
                options={[...QUORUM_THRESHOLD_TYPE_OPTIONS]}
                value={readSelectOption(
                  QUORUM_THRESHOLD_TYPE_OPTIONS,
                  quorum.thresholdType,
                )}
              />
            </BPMFormField>
            <BPMFormField
              hintText={
                quorum.thresholdType === 'PERCENTAGE'
                  ? '達到簽核者總數的這個百分比即通過，換算人數時無條件進位；超過 100 的輸入會自動夾至 100。'
                  : '達到這個同意人數即通過；門檻超過實際簽核者人數時，這一關將永遠無法通過，請勿設定超過實際簽核者人數。'
              }
              label={
                quorum.thresholdType === 'PERCENTAGE'
                  ? '門檻百分比'
                  : '門檻人數'
              }
              name="quorumThreshold"
              required
            >
              <Input
                id="quorumThreshold"
                inputProps={
                  quorum.thresholdType === 'PERCENTAGE'
                    ? { max: 100, min: 1 }
                    : { min: 1 }
                }
                inputType="number"
                name="quorumThreshold"
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  updateUserTaskDecisionPolicy({
                    threshold: composeQuorumThreshold(
                      Number(event.target.value),
                      quorum.thresholdType,
                    ),
                    thresholdType: quorum.thresholdType,
                    type: 'QUORUM',
                  })
                }
                value={String(quorum.threshold)}
                variant="base"
              />
            </BPMFormField>
          </>
        ) : null}
        {node.data.returnBehavior.allowReturn ? (
          <BPMFormField
            hintText="退回發起人後，重新送出時要從流程開始重跑，或直接回到退回的簽核節點。"
            label="重送策略"
            name="returnResubmitStrategy"
            required
          >
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskReturnResubmitStrategy(
                  readReturnResubmitStrategy(option?.id ?? null),
                )
              }
              options={[...RETURN_RESUBMIT_STRATEGY_OPTIONS]}
              value={readSelectOption(
                RETURN_RESUBMIT_STRATEGY_OPTIONS,
                resubmitStrategy,
              )}
            />
          </BPMFormField>
        ) : null}
        {node.data.returnBehavior.allowReturn ? (
          <BPMFormField
            hintText="開啟後，簽核者按下退回時必須填寫意見，未填寫會被擋下。"
            label="退回時意見必填"
            name="returnRequireComment"
          >
            <Toggle
              checked={node.data.returnBehavior.requireComment === true}
              // FormField renders `<label htmlFor={name}>`, so the control needs
              // the matching id for the label to be clickable.
              inputProps={{
                id: 'returnRequireComment',
                name: 'returnRequireComment',
              }}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateUserTaskReturnRequireComment(event.target.checked)
              }
            />
          </BPMFormField>
        ) : null}
        <BPMFormField
          hintText="開啟後可設定簽核期限，逾時將依下方設定處理。"
          label="啟用時效"
          name="slaEnabled"
        >
          <Toggle
            checked={Boolean(sla)}
            inputProps={{ id: 'slaEnabled', name: 'slaEnabled' }}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateUserTaskSla(
                event.target.checked ? DEFAULT_SLA_CONFIG : null,
              )
            }
          />
        </BPMFormField>
        {sla && !slaDurationParts ? (
          <BPMFormField
            hintText="此期限混用了日與時，無法在表單中編輯。請改以單一單位設定，或透過 API 維護。"
            label="時效期限"
            name="slaDurationRaw"
          >
            <Input disabled value={sla.duration} variant="base" />
          </BPMFormField>
        ) : null}
        {sla && slaDurationParts ? (
          <>
            <BPMFormField label="時效期限" name="slaDurationValue" required>
              <Input
                id="slaDurationValue"
                inputProps={{ min: 1 }}
                inputType="number"
                name="slaDurationValue"
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  updateUserTaskSla(
                    withSlaDuration(sla, {
                      unit: slaDurationUnit,
                      value: Number(event.target.value),
                    }),
                  )
                }
                value={String(slaDurationParts.value)}
                variant="base"
              />
            </BPMFormField>
            <BPMFormField label="期限單位" name="slaDurationUnit" required>
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateUserTaskSla(
                    withSlaDuration(sla, {
                      unit: readSlaDurationUnit(option?.id ?? null),
                      value: slaDurationParts.value,
                    }),
                  )
                }
                options={[...SLA_DURATION_UNIT_OPTIONS]}
                value={readSelectOption(
                  SLA_DURATION_UNIT_OPTIONS,
                  slaDurationUnit,
                )}
              />
            </BPMFormField>
          </>
        ) : null}
        {sla && slaDurationUnit === 'DAY' ? (
          <BPMFormField
            hintText="工作日會跳過週末與行事曆上的假日，補班日仍計為工作日；行事曆由系統管理者設定。"
            label="計算方式"
            name="slaCalendar"
            required
          >
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskSla({
                  ...sla,
                  calendar: readSlaCalendarMode(option?.id ?? null),
                })
              }
              options={[...SLA_CALENDAR_MODE_OPTIONS]}
              value={readSelectOption(
                SLA_CALENDAR_MODE_OPTIONS,
                sla.calendar ?? 'CALENDAR',
              )}
            />
          </BPMFormField>
        ) : null}
        {sla ? (
          <BPMFormField label="逾時處理" name="slaOnTimeout" required>
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskSla(
                  withSlaTimeoutAction(
                    sla,
                    readSlaTimeoutAction(option?.id ?? null),
                  ),
                )
              }
              options={[...SLA_TIMEOUT_ACTION_OPTIONS]}
              value={readSelectOption(
                SLA_TIMEOUT_ACTION_OPTIONS,
                sla.onTimeout,
              )}
            />
          </BPMFormField>
        ) : null}
        {sla?.onTimeout === 'ESCALATE' ? (
          <BPMFormField
            hintText="逾時後改派給簽核者的上層主管，只會升級一次。"
            label="升級層級"
            name="slaEscalateLevelsUp"
            required
          >
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskSla({
                  ...sla,
                  escalateLevelsUp: readManagerLevelOptionById(
                    option?.id ?? null,
                  ).value,
                })
              }
              options={[...MANAGER_LEVEL_OPTIONS]}
              value={slaEscalateLevel}
            />
          </BPMFormField>
        ) : null}
        {sla ? (
          <BPMFormField
            hintText="在期限到達前先送出一次提醒。"
            label="預警提醒"
            name="slaWarningAt"
          >
            <Select
              clearable={false}
              onChange={(option): void =>
                updateUserTaskSla(
                  withSlaWarningAt(
                    sla,
                    readSlaWarningAtOptionById(option?.id ?? null).value,
                  ),
                )
              }
              options={[...SLA_WARNING_AT_OPTIONS]}
              value={slaWarningAtOption}
            />
          </BPMFormField>
        ) : null}
        <BPMFormField
          hintText="關閉後，簽核者在此關卡看不到「拒絕」按鈕。"
          label="允許拒絕"
          name="allowReject"
        >
          <Toggle
            checked={node.data.allowReject}
            inputProps={{ id: 'allowReject', name: 'allowReject' }}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateUserTaskOptions({ allowReject: event.target.checked })
            }
          />
        </BPMFormField>
        <BPMFormField
          hintText="關閉後，簽核者無法把此關卡的任務轉派給其他人。"
          label="允許轉派"
          name="allowTransfer"
        >
          <Toggle
            checked={node.data.allowTransfer}
            inputProps={{ id: 'allowTransfer', name: 'allowTransfer' }}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateUserTaskOptions({ allowTransfer: event.target.checked })
            }
          />
        </BPMFormField>
        <BPMFormField
          hintText="開啟後，簽核者可在此關卡臨時加入其他簽核人；會簽為平行處理，加簽則需等加入者簽完才往下。"
          label="允許加簽"
          name="allowAddSigner"
        >
          <Toggle
            checked={node.data.allowAddSigner}
            inputProps={{ id: 'allowAddSigner', name: 'allowAddSigner' }}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateUserTaskOptions({ allowAddSigner: event.target.checked })
            }
          />
        </BPMFormField>
      </>
    );
  }

  function renderServiceTaskPanel(
    node: Extract<WorkflowNode, { type: 'serviceTask' }>,
  ): ReactElement {
    const selectedMembers = readServiceTaskMemberIds(node.data.action).map(
      (memberId) => readMemberSelectOption(memberOptions, memberId),
    );

    return (
      <BPMFormField label="知會對象" name="notifyMemberIds" required>
        <AutoComplete
          asyncData
          disabledOptionsFilter
          emptyText="沒有符合的成員"
          loading={memberLoading}
          loadingText="搜尋成員中..."
          mode="multiple"
          onChange={(options): void =>
            updateServiceAction({
              channels: ['IN_APP'],
              recipients: {
                memberIds: options.map((option) => option.id),
                type: 'DIRECT',
              },
              type: 'NOTIFY',
            })
          }
          onSearch={handleSearchMembers}
          onVisibilityChange={(open): void => {
            if (open) {
              void handleSearchMembers('');
            }
          }}
          options={[...memberOptions]}
          overflowStrategy="wrap"
          placeholder="搜尋姓名或信箱"
          searchDebounceTime={300}
          value={[...selectedMembers]}
        />
      </BPMFormField>
    );
  }

  function renderSelectedEdgesPanel(
    edges: readonly WorkflowEdge[],
  ): ReactElement {
    return (
      <div style={FORM_STACK_STYLE}>
        <Typography component="h2" variant="h3">
          已選取線段
        </Typography>
        <Typography color="text-neutral" variant="body">
          已選取 {edges.length} 條線段，可使用 Delete 或控制面板刪除。
        </Typography>
      </div>
    );
  }

  function renderEdgePanel(edge: WorkflowEdge): ReactElement {
    const isConditionPath = isExclusiveGatewaySourceEdge(
      edge,
      workflowDefinition.nodes,
    );

    return (
      <div style={FORM_STACK_STYLE}>
        <Typography component="h2" variant="h3">
          {isConditionPath ? '條件設定' : '線段屬性'}
        </Typography>
        <Typography color="text-neutral" variant="body">
          {edge.source} → {edge.target}
        </Typography>
        {isConditionPath ? (
          renderConditionEdgeSettingsForm(edge)
        ) : (
          <Typography color="text-neutral" variant="body">
            這條線會直接把流程送到下一個節點。
          </Typography>
        )}
      </div>
    );
  }

  function renderEdgeSettingsModal(
    edge: WorkflowEdge | null,
  ): ReactElement | null {
    if (!edge) {
      return null;
    }

    const isConditionPath = isExclusiveGatewaySourceEdge(
      edge,
      workflowDefinition.nodes,
    );

    if (!isConditionPath) {
      return null;
    }

    return (
      <Modal
        cancelText="取消"
        confirmButtonProps={{
          disabled: !edge.data.isDefault && !edge.data.condition,
        }}
        confirmText="完成"
        modalType="standard"
        onCancel={closeEdgeSettingsModal}
        onClose={closeEdgeSettingsModal}
        onConfirm={closeEdgeSettingsModal}
        open={Boolean(editingEdgeId)}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText="條件分流的輸出連線需要指定條件，條件會直接顯示在線上。"
        title="條件設定"
      >
        {renderConditionEdgeSettingsForm(edge)}
      </Modal>
    );
  }

  function renderConditionEdgeSettingsForm(edge: WorkflowEdge): ReactElement {
    const pathLabelPreview = readEdgeCanvasLabel(
      edge,
      workflowDefinition.nodes,
    );
    const conditionFieldOptions = readConditionFieldOptions(
      selectedFormVersionOption?.schema ?? null,
    );
    const selectedConditionField = readConditionField(
      selectedFormVersionOption?.schema ?? null,
      edge.data.conditionFieldKey ?? null,
    );
    const conditionOperatorOptions = readConditionOperatorOptions(
      selectedConditionField,
    );
    const conditionValueOptions = readConditionValueOptions(
      selectedConditionField,
    );
    const selectedConditionOperator = readSelectOption(
      conditionOperatorOptions,
      edge.data.conditionOperator ?? null,
    );
    const pathLabelIsIncomplete = !edge.data.isDefault && !edge.data.condition;

    return (
      <div style={FORM_STACK_STYLE}>
        <Typography color="text-neutral" variant="body">
          畫布上的這條線目前會顯示「
          <span
            style={{
              color: pathLabelIsIncomplete
                ? INCOMPLETE_CONDITION_EDGE_COLOR
                : undefined,
            }}
          >
            {pathLabelPreview ?? '請設定條件'}
          </span>
          」。
        </Typography>
        <Toggle
          checked={Boolean(edge.data.isDefault)}
          label="其他情況走這條"
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            updateSelectedEdgeDefault(edge.id, event.target.checked)
          }
        />
        {edge.data.isDefault ? (
          <Typography color="text-neutral" variant="body">
            其他條件都不符合時，流程會走這條線。
          </Typography>
        ) : (
          <>
            {!selectedFormVersionOption ? (
              <Typography color="text-neutral" variant="body">
                請先綁定表單版本，才能選擇條件欄位。
              </Typography>
            ) : null}
            <BPMFormField label="條件欄位" name="edgeConditionField" required>
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateSelectedEdgeConditionState({
                    edgeId: edge.id,
                    fieldKey: option?.id ?? null,
                    operator: null,
                    value: null,
                  })
                }
                options={[...conditionFieldOptions]}
                placeholder="選擇條件欄位"
                value={readSelectOption(
                  conditionFieldOptions,
                  edge.data.conditionFieldKey ?? null,
                )}
              />
            </BPMFormField>
            <BPMFormField
              label="條件判斷"
              name="edgeConditionOperator"
              required
            >
              <Select
                clearable={false}
                onChange={(option): void =>
                  updateSelectedEdgeConditionState({
                    edgeId: edge.id,
                    operator: readConditionOperator(option?.id ?? null),
                    value: null,
                  })
                }
                options={[...conditionOperatorOptions]}
                placeholder="選擇判斷方式"
                value={selectedConditionOperator}
              />
            </BPMFormField>
            {selectedConditionOperator &&
            shouldConditionOperatorUseValue(selectedConditionOperator.id) ? (
              <BPMFormField label="條件值" name="edgeConditionValue" required>
                {conditionValueOptions.length > 0 ? (
                  <Select
                    clearable={false}
                    onChange={(option): void =>
                      updateSelectedEdgeConditionState({
                        edgeId: edge.id,
                        value: option?.id ?? null,
                      })
                    }
                    options={[...conditionValueOptions]}
                    placeholder="選擇條件值"
                    value={readSelectOption(
                      conditionValueOptions,
                      edge.data.conditionValue ?? null,
                    )}
                  />
                ) : (
                  <Input
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      updateSelectedEdgeConditionState({
                        edgeId: edge.id,
                        value: event.target.value,
                      })
                    }
                    placeholder="輸入要比對的值"
                    value={edge.data.conditionValue ?? ''}
                    variant="base"
                  />
                )}
              </BPMFormField>
            ) : null}
          </>
        )}
      </div>
    );
  }
}

function AutoLayoutPanel({
  onApplyAutoLayout,
}: {
  readonly onApplyAutoLayout: () => void;
}): ReactElement {
  function handleAutoLayout(): void {
    onApplyAutoLayout();
  }

  return (
    <Panel position="top-right">
      <Button
        icon={DotGridIcon}
        iconType="leading"
        onClick={handleAutoLayout}
        size="sub"
        variant="base-secondary"
      >
        自動排版
      </Button>
    </Panel>
  );
}

function WorkflowNodeCard({
  data,
  selected,
  type,
}: NodeProps<FlowNode>): ReactElement {
  const primaryLabels = data.approverLines ?? [
    data.approverSummary ?? data.label,
  ];
  const secondaryLabel = readWorkflowNodeSecondaryLabel(data);
  const nodeStyle = readWorkflowNodeCardStyle(type, selected);

  return (
    <div style={nodeStyle}>
      {renderWorkflowNodeHandles(data)}
      <div style={NODE_PRIMARY_LABELS_STYLE}>
        {primaryLabels.map((primaryLabel, index) => (
          <Typography
            component="span"
            ellipsis
            key={`${primaryLabel}_${index}`}
            style={NODE_TEXT_STYLE}
            title={primaryLabel}
            variant="label-primary"
          >
            {primaryLabel}
          </Typography>
        ))}
      </div>
      <Typography
        color="text-neutral"
        component="span"
        ellipsis
        style={NODE_TEXT_STYLE}
        title={secondaryLabel}
        variant="caption"
      >
        {secondaryLabel}
      </Typography>
    </div>
  );
}

function readWorkflowNodeSecondaryLabel(data: FlowNodeData): string {
  if (data.nodeKind === 'startEvent') {
    return data.initiatorPolicySummary ?? '所有人';
  }

  if (data.approverSummary || data.approverLines) {
    return data.label;
  }

  if (data.nodeKind === 'exclusiveGateway') {
    return '條件在線上';
  }

  if (data.nodeKind === 'parallelGateway') {
    return '多條路徑同時進行';
  }

  return NODE_TYPE_LABELS[data.nodeKind];
}

function readWorkflowNodeCardStyle(
  type: WorkflowNode['type'],
  selected: boolean,
): CSSProperties {
  const baseStyle = readWorkflowNodeBaseCardStyle(type);

  return selected
    ? {
        ...baseStyle,
        border: '1px solid var(--mzn-color-primary, #0057ff)',
        boxShadow: SELECTED_NODE_BOX_SHADOW,
      }
    : baseStyle;
}

function readWorkflowNodeBaseCardStyle(
  type: WorkflowNode['type'],
): CSSProperties {
  if (type === 'exclusiveGateway') {
    return EXCLUSIVE_GATEWAY_NODE_STYLE;
  }

  if (type === 'parallelGateway') {
    return PARALLEL_GATEWAY_NODE_STYLE;
  }

  if (type === 'startEvent') {
    return START_NODE_STYLE;
  }

  if (type === 'endEvent') {
    return END_NODE_STYLE;
  }

  if (type === 'userTask') {
    return USER_TASK_NODE_STYLE;
  }

  return NODE_STYLE;
}

function renderWorkflowNodeHandles(
  data: FlowNodeData,
): ReactElement | readonly ReactElement[] | null {
  if (!data.hasInput && data.hasOutput) {
    return (
      <Handle
        id={WORKFLOW_OUTPUT_HANDLE_ID}
        position={Position.Right}
        type="source"
      />
    );
  }

  if (data.hasInput && !data.hasOutput) {
    return (
      <Handle
        id={WORKFLOW_INPUT_HANDLE_ID}
        position={Position.Left}
        type="target"
      />
    );
  }

  if (!data.hasInput && !data.hasOutput) {
    return null;
  }

  return [
    <Handle
      id={WORKFLOW_INPUT_HANDLE_ID}
      key="target"
      position={Position.Left}
      type="target"
    />,
    <Handle
      id={WORKFLOW_OUTPUT_HANDLE_ID}
      key="source"
      position={Position.Right}
      type="source"
    />,
  ];
}

function readFlowNode(
  node: WorkflowNode,
  memberOptions: readonly MemberSelectOption[],
  orgUnits: readonly OrgUnitRecord[],
  positions: readonly PositionRecord[],
  selected: boolean,
  initiatorPolicyDraft: InitiatorPolicyDraft,
): FlowNode {
  const dimensions = readWorkflowNodeDimensions(node);

  return {
    data: {
      approverLines: readNodeApproverLines(node, memberOptions),
      approverSummary: readNodeApproverSummary(
        node,
        memberOptions,
        orgUnits,
        positions,
      ),
      hasInput: isWorkflowNodeInputConnectable(node),
      hasOutput: isWorkflowNodeOutputConnectable(node),
      initiatorPolicySummary:
        node.type === 'startEvent'
          ? readInitiatorPolicySummary(
              initiatorPolicyDraft,
              orgUnits,
              positions,
            )
          : null,
      label: node.data.label,
      nodeKind: node.type,
    },
    height: dimensions.height,
    handles: readFlowNodeHandles(node),
    id: node.id,
    initialHeight: dimensions.height,
    initialWidth: dimensions.width,
    position: node.position,
    selected,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    type: node.type,
    width: dimensions.width,
  };
}

function readWorkflowNodeDimensions(
  node: WorkflowNode,
): Readonly<{ height: number; width: number }> {
  if (node.type === 'exclusiveGateway' || node.type === 'parallelGateway') {
    return {
      height: GATEWAY_NODE_INITIAL_HEIGHT,
      width: GATEWAY_NODE_INITIAL_WIDTH,
    };
  }

  if (node.type === 'serviceTask') {
    const memberCount = Math.max(
      1,
      readServiceTaskMemberIds(node.data.action).length,
    );

    return {
      height:
        FLOW_NODE_INITIAL_HEIGHT +
        (memberCount - 1) * FLOW_NODE_ADDITIONAL_LINE_HEIGHT,
      width: FLOW_NODE_INITIAL_WIDTH,
    };
  }

  return {
    height: FLOW_NODE_INITIAL_HEIGHT,
    width: FLOW_NODE_INITIAL_WIDTH,
  };
}

function readFlowNodeHandles(node: WorkflowNode): FlowNodeHandle[] {
  const dimensions = readWorkflowNodeDimensions(node);

  return [
    ...(isWorkflowNodeInputConnectable(node)
      ? [readTargetFlowNodeHandle(dimensions)]
      : []),
    ...(isWorkflowNodeOutputConnectable(node)
      ? [readSourceFlowNodeHandle(dimensions)]
      : []),
  ];
}

function readTargetFlowNodeHandle({
  height,
}: Readonly<{ height: number; width: number }>): FlowNodeHandle {
  const handleSize = 9;
  const centeredHandleY = height / 2 - handleSize / 2;

  return {
    height: handleSize,
    id: WORKFLOW_INPUT_HANDLE_ID,
    position: Position.Left,
    type: 'target',
    width: handleSize,
    x: -handleSize / 2,
    y: centeredHandleY,
  };
}

function readSourceFlowNodeHandle({
  height,
  width,
}: Readonly<{ height: number; width: number }>): FlowNodeHandle {
  const handleSize = 9;
  const centeredHandleY = height / 2 - handleSize / 2;

  return {
    height: handleSize,
    id: WORKFLOW_OUTPUT_HANDLE_ID,
    position: Position.Right,
    type: 'source',
    width: handleSize,
    x: width - handleSize / 2,
    y: centeredHandleY,
  };
}

function readFlowEdge(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
  selected: boolean,
): FlowEdge {
  const label = readEdgeCanvasLabel(edge, nodes);
  const isConditionEdge = isExclusiveGatewaySourceEdge(edge, nodes);
  const isIncompleteConditionEdge =
    isConditionEdge && !edge.data.isDefault && !edge.data.condition;
  const labelColor = isIncompleteConditionEdge
    ? INCOMPLETE_CONDITION_EDGE_COLOR
    : isConditionEdge
      ? CONDITION_EDGE_COLOR
      : '#475569';
  const labelBackgroundColor = isIncompleteConditionEdge
    ? '#fef2f2'
    : isConditionEdge
      ? '#eff6ff'
      : '#ffffff';
  const labelBorderColor = isIncompleteConditionEdge
    ? INCOMPLETE_CONDITION_EDGE_COLOR
    : isConditionEdge
      ? CONDITION_EDGE_COLOR
      : DEFAULT_EDGE_COLOR;

  return {
    className: selected ? 'workflow-edge--selected' : undefined,
    data: edge.data,
    id: edge.id,
    label,
    labelBgBorderRadius: 6,
    labelBgPadding: [8, 4],
    labelBgStyle: {
      fill: labelBackgroundColor,
      stroke: labelBorderColor,
      strokeWidth: 1,
    },
    labelShowBg: Boolean(label),
    labelStyle: {
      fill: labelColor,
      fontSize: 12,
      fontWeight: 600,
    },
    selected,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    style: {
      filter: selected ? SELECTED_EDGE_GLOW_FILTER : undefined,
      opacity: 1,
      stroke: DEFAULT_EDGE_COLOR,
      strokeOpacity: 1,
      strokeWidth: 1.5,
    },
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: edge.type ?? 'smoothstep',
  };
}

function applyWorkflowNodeTriggerMode(
  node: WorkflowNode,
  triggerMode: WorkflowNodeTriggerMode,
): WorkflowNode {
  if (node.type === 'startEvent') {
    return node;
  }

  if (node.type === 'endEvent') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'userTask') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'serviceTask') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  if (node.type === 'exclusiveGateway') {
    return { ...node, data: { ...node.data, triggerMode } };
  }

  return { ...node, data: { ...node.data, triggerMode } };
}

function normalizeDesignerWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const withoutAsyncNotifyEdges = removeAsyncNotifyOutgoingEdges(definition);

  return normalizeSingleIncomingTriggerModes(
    normalizeUserTaskPolicies(withoutAsyncNotifyEdges),
  );
}

function normalizeUserTaskPolicies(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const nodes = definition.nodes.map((node) => {
    if (node.type !== 'userTask') {
      return node;
    }

    const allowAddSigner = node.data.allowAddSigner ?? false;
    const allowReject = node.data.allowReject ?? true;
    const allowTransfer = node.data.allowTransfer ?? true;
    // The schema types `decisionPolicy` as required, but templates authored
    // before the field existed carry no such key at runtime (see
    // `readDecisionPolicyType`). Only the read side tolerated that until now,
    // so the field stayed permanently blank-but-required in the publish
    // validator (`decisionPolicy is required`). Write the same default here,
    // and only when it is actually missing — an already-set policy (whatever
    // its value) must not be touched.
    const decisionPolicyIsMissing = !node.data.decisionPolicy;

    if (
      node.data.allowAddSigner === allowAddSigner &&
      node.data.allowReject === allowReject &&
      node.data.allowTransfer === allowTransfer &&
      !decisionPolicyIsMissing
    ) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        allowAddSigner,
        allowReject,
        allowTransfer,
        decisionPolicy: node.data.decisionPolicy ?? { type: 'SINGLE' },
      },
    };
  });

  const hasNodeChanges = nodes.some(
    (node, index) => node !== definition.nodes[index],
  );

  return hasNodeChanges ? { ...definition, nodes } : definition;
}

function removeAsyncNotifyOutgoingEdges(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const asyncNotifyNodeIds = new Set(
    definition.nodes
      .filter((node) => isAsyncNotifyServiceTask(node))
      .map((node) => node.id),
  );
  const edges = definition.edges.filter(
    (edge) => !asyncNotifyNodeIds.has(edge.source),
  );

  return edges.length === definition.edges.length
    ? definition
    : { ...definition, edges };
}

function normalizeSingleIncomingTriggerModes(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const incomingEdgeCounts = definition.edges.reduce<Record<string, number>>(
    (counts, edge) => ({
      ...counts,
      [edge.target]: (counts[edge.target] ?? 0) + 1,
    }),
    {},
  );
  const nodes = definition.nodes.map((node) => {
    if (node.type === 'startEvent') {
      return node;
    }

    const incomingEdgeCount = incomingEdgeCounts[node.id] ?? 0;

    return incomingEdgeCount < 2 && node.data.triggerMode !== 'AND'
      ? applyWorkflowNodeTriggerMode(node, 'AND')
      : node;
  });
  const hasNodeChanges = nodes.some(
    (node, index) => node !== definition.nodes[index],
  );

  return hasNodeChanges ? { ...definition, nodes } : definition;
}

function readFallbackWorkflowDefinition(): WorkflowDefinition {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
        id: 'end',
        position: { x: 560, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function isEmptyDesignerWorkflowDefinition(
  definition: WorkflowDefinition,
): boolean {
  return (
    definition.edges.length === 0 &&
    definition.nodes.length === 2 &&
    definition.nodes.some((node) => node.type === 'startEvent') &&
    definition.nodes.some((node) => node.type === 'endEvent')
  );
}

function layoutWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: 120 });
  definition.nodes.forEach((node): void => {
    graph.setNode(node.id, readWorkflowNodeDimensions(node));
  });
  definition.edges.forEach((edge): void => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const positionedNode = graph.node(node.id) as
        | { readonly x: number; readonly y: number }
        | undefined;

      return positionedNode
        ? {
            ...node,
            position: {
              x: positionedNode.x - readWorkflowNodeDimensions(node).width / 2,
              y: positionedNode.y - readWorkflowNodeDimensions(node).height / 2,
            },
          }
        : node;
    }),
  };
}

function readSelectOption<TOption extends { readonly id: string }>(
  options: readonly TOption[],
  id: string | null,
): TOption | null {
  return id ? (options.find((option) => option.id === id) ?? null) : null;
}

function readWorkflowNodeTriggerMode(
  value: string | null,
): WorkflowNodeTriggerMode {
  return value === 'OR' ? 'OR' : 'AND';
}

function readReturnResubmitStrategy(
  value: string | null,
): ReturnResubmitStrategy {
  return value === 'FROM_RETURN_POINT' ? 'FROM_RETURN_POINT' : 'RESTART';
}

function readDecisionPolicyHint(policy: DecisionPolicy | undefined): string {
  if (!policy || policy.type === 'SINGLE' || policy.type === 'PARALLEL_ANY') {
    return '可指定多位；多位時所有人都會收到待辦，任一人同意即可通過。';
  }

  if (policy.type === 'PARALLEL_ALL') {
    return '可指定多位；多位時所有人都會收到待辦，全部同意後才會通過。';
  }

  if (policy.type === 'SEQUENTIAL') {
    return '可指定多位；所有人會同時收到待辦，需全部同意後才會通過。';
  }

  const thresholdUnit =
    policy.thresholdType === 'PERCENTAGE' ? '%' : ' 位簽核者';

  return `可指定多位；需達到 ${policy.threshold}${thresholdUnit} 才會通過。`;
}

function readDecisionPolicyType(
  policy: DecisionPolicy | undefined,
): DecisionPolicy['type'] {
  return policy?.type ?? 'SINGLE';
}

function readDecisionPolicyOption(
  type: DecisionPolicy['type'],
): DecisionPolicyOption {
  const option = DECISION_POLICY_OPTIONS.find((item) => item.id === type);

  if (option) {
    return option;
  }

  // `SEQUENTIAL` is not offered in the dropdown, but templates authored
  // through the API may already carry it — the AI assistant cannot produce
  // it: its toolset (`workflow-toolset.ts`) has no decision-policy tool at
  // all. The engine treats `SEQUENTIAL` exactly like `PARALLEL_ALL`
  // (simultaneous notification, everyone must agree), so label it that way
  // instead of implying a queued hand-off that does not exist.
  if (type === 'SEQUENTIAL') {
    return { id: type, name: '全部同意（既有設定）' };
  }

  // Any other stored value falls outside `DecisionPolicy['type']`'s own
  // union — it can only have come from an untyped source (API payload, an
  // older schema) this form was never told about. Echo it verbatim instead
  // of mislabelling it as a specific known policy.
  return { id: type, name: `未知決策方式（${type}）` };
}

function readDecisionPolicyFromOptionId(
  id: string | null,
  current: DecisionPolicy | undefined,
): DecisionPolicy {
  if (id === 'QUORUM') {
    // Re-picking the option the node already uses must not discard the
    // threshold the user typed.
    return current?.type === 'QUORUM'
      ? current
      : {
          threshold: DEFAULT_QUORUM_THRESHOLD,
          thresholdType: 'COUNT',
          type: 'QUORUM',
        };
  }

  if (id === 'PARALLEL_ALL' || id === 'PARALLEL_ANY' || id === 'SEQUENTIAL') {
    return { type: id };
  }

  return { type: 'SINGLE' };
}

/**
 * Reads the quorum controls' state out of a stored policy.
 *
 * `threshold` and `thresholdType` get the same tolerance the rest of this read
 * path already grants `type` (see `readDecisionPolicyType` /
 * `readDecisionPolicyOption`): the publish validator only checks
 * `decisionPolicy?.type`, so an API-authored template can store a bare
 * `{ type: 'QUORUM' }`. Trusting the declared types there would put
 * `String(undefined)` into the number input (rendering blank, with the field
 * silently unusable) and would write `thresholdType: undefined` straight back
 * into the policy on the next threshold keystroke.
 *
 * Only the *shape* is repaired here — a stored out-of-range value (e.g. a
 * `PERCENTAGE` threshold of 500 written before `composeQuorumThreshold` capped
 * it) is shown as-is, so the panel never displays a number that differs from
 * what is actually stored.
 */
function readQuorumParts(policy: DecisionPolicy | undefined): Readonly<{
  threshold: number;
  thresholdType: 'COUNT' | 'PERCENTAGE';
}> {
  if (policy?.type !== 'QUORUM') {
    return { threshold: DEFAULT_QUORUM_THRESHOLD, thresholdType: 'COUNT' };
  }

  return {
    threshold: Number.isFinite(policy.threshold)
      ? policy.threshold
      : DEFAULT_QUORUM_THRESHOLD,
    thresholdType: readQuorumThresholdType(policy.thresholdType ?? null),
  };
}

function readQuorumThresholdType(value: string | null): 'COUNT' | 'PERCENTAGE' {
  return value === 'PERCENTAGE' ? 'PERCENTAGE' : 'COUNT';
}

function readSlaDurationUnit(value: string | null): SlaDurationUnit {
  return value === 'HOUR' ? 'HOUR' : 'DAY';
}

function readSlaCalendarMode(value: string | null): SlaCalendarMode {
  return value === 'BUSINESS_DAY' ? 'BUSINESS_DAY' : 'CALENDAR';
}

function readSlaTimeoutAction(value: string | null): SlaConfig['onTimeout'] {
  return (
    SLA_TIMEOUT_ACTION_OPTIONS.find((option) => option.id === value)?.id ??
    'REMIND'
  );
}

function readSlaWarningAtOption(
  value: number | null,
): (typeof SLA_WARNING_AT_OPTIONS)[number] {
  return (
    SLA_WARNING_AT_OPTIONS.find((option) => option.value === value) ??
    SLA_WARNING_AT_OPTIONS[0]
  );
}

function readSlaWarningAtOptionById(
  id: string | null,
): (typeof SLA_WARNING_AT_OPTIONS)[number] {
  return (
    SLA_WARNING_AT_OPTIONS.find((option) => option.id === id) ??
    SLA_WARNING_AT_OPTIONS[0]
  );
}

/**
 * Rewrites the SLA duration, dropping `BUSINESS_DAY` when the unit is no
 * longer days — a business calendar only advances whole days, so keeping the
 * mode on an hour-based SLA would claim a behaviour the engine does not apply.
 */
function withSlaDuration(sla: SlaConfig, parts: SlaDurationParts): SlaConfig {
  const value = Number.isFinite(parts.value) ? Math.trunc(parts.value) : 1;
  const duration = composeSlaDuration({ unit: parts.unit, value });

  return {
    ...sla,
    calendar: parts.unit === 'DAY' ? (sla.calendar ?? 'CALENDAR') : 'CALENDAR',
    duration,
  };
}

/** Keeps `escalateLevelsUp` only while the timeout action is `ESCALATE`. */
function withSlaTimeoutAction(
  sla: SlaConfig,
  onTimeout: SlaConfig['onTimeout'],
): SlaConfig {
  return onTimeout === 'ESCALATE'
    ? { ...sla, escalateLevelsUp: sla.escalateLevelsUp ?? 1, onTimeout }
    : { ...omitSlaKey(sla, 'escalateLevelsUp'), onTimeout };
}

function withSlaWarningAt(sla: SlaConfig, warningAt: number | null): SlaConfig {
  return warningAt === null
    ? omitSlaKey(sla, 'warningAt')
    : { ...sla, warningAt };
}

/**
 * Drops an optional SLA key rather than storing `undefined`, keeping the saved
 * workflow definition JSON free of dead settings.
 */
function omitSlaKey(
  sla: SlaConfig,
  key: 'escalateLevelsUp' | 'warningAt',
): SlaConfig {
  return Object.fromEntries(
    Object.entries(sla).filter(([entryKey]) => entryKey !== key),
  ) as SlaConfig;
}

function readApproverResolverMode(value: string): ApproverResolverMode {
  return value === 'ORG_MANAGER' ||
    value === 'ORG_UNIT_MANAGER' ||
    value === 'ORG_UNIT_MEMBER' ||
    value === 'ORG_UNIT_POSITION' ||
    value === 'POSITION'
    ? value
    : 'DIRECT';
}

function readDefaultApproverResolver(value: string | null): ApproverResolver {
  const mode = readApproverResolverMode(value ?? 'DIRECT');

  if (mode === 'ORG_MANAGER') {
    return { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' };
  }

  if (mode === 'ORG_UNIT_MANAGER') {
    return { orgUnitId: '', type: 'ORG_UNIT_MANAGER' };
  }

  if (mode === 'ORG_UNIT_MEMBER') {
    return {
      includeDescendants: false,
      orgUnitId: '',
      type: 'ORG_UNIT_MEMBER',
    };
  }

  if (mode === 'ORG_UNIT_POSITION') {
    return {
      includeDescendants: false,
      orgUnitId: '',
      positionId: '',
      type: 'ORG_UNIT_POSITION',
    };
  }

  if (mode === 'POSITION') {
    return { positionId: '', type: 'POSITION' };
  }

  return { memberIds: [], type: 'DIRECT' };
}

function readApproverFallbackMode(value: string | null): ApproverFallbackMode {
  return value === 'DIRECT' ? 'DIRECT' : 'NONE';
}

function updateApproverResolverFallback(
  resolver: ApproverResolver,
  fallback: ApproverResolverFallback,
): ApproverResolver {
  if (resolver.type === 'ORG_MANAGER') {
    return { ...resolver, fallback };
  }

  if (resolver.type === 'ORG_UNIT_MANAGER') {
    return { ...resolver, fallback };
  }

  return resolver;
}

function readManagerLevelOption(levelsUp: number): ManagerLevelOption {
  return (
    MANAGER_LEVEL_OPTIONS.find((option) => option.value === levelsUp) ??
    MANAGER_LEVEL_OPTIONS[0]
  );
}

function readManagerLevelOptionById(id: string | null): ManagerLevelOption {
  return (
    MANAGER_LEVEL_OPTIONS.find((option) => option.id === id) ??
    MANAGER_LEVEL_OPTIONS[0]
  );
}

function readInitiatorPolicyMode(
  value: string | null,
): Exclude<InitiatorPolicyMode, 'CUSTOM'> {
  if (
    value === 'ORG_UNIT' ||
    value === 'ORG_UNIT_POSITION' ||
    value === 'NONE'
  ) {
    return value;
  }

  return 'ALL';
}

function readInitiatorPolicyDraft(
  initiatorPolicyCel: string | null,
): InitiatorPolicyDraft {
  const expression = initiatorPolicyCel?.trim();

  if (!expression) {
    return { mode: 'ALL', value: '' };
  }

  const orgUnitIds = readCelStringListOperands(
    expression,
    /"([^"]+)" in subject\.orgUnitIds/gu,
  );
  const positionIds = readCelStringListOperands(
    expression,
    /"([^"]+)" in subject\.positionIds/gu,
  );

  if (orgUnitIds.length > 0 && positionIds.length > 0) {
    return {
      includeDescendants: orgUnitIds.length > 1,
      mode: 'ORG_UNIT_POSITION',
      orgUnitId: orgUnitIds[0],
      positionId: positionIds[0],
      value: orgUnitIds[0] ?? '',
    };
  }

  if (orgUnitIds.length > 0) {
    return {
      includeDescendants: orgUnitIds.length > 1,
      mode: 'ORG_UNIT',
      orgUnitId: orgUnitIds[0],
      value: orgUnitIds[0] ?? '',
    };
  }

  return { mode: 'CUSTOM', value: expression };
}

function readInitiatorPolicyUiDraft(
  initiatorPolicyCel: string | null,
  modeDraft: Exclude<InitiatorPolicyMode, 'CUSTOM'> | null,
): InitiatorPolicyDraft {
  const persistedDraft = readInitiatorPolicyDraft(initiatorPolicyCel);

  if (!modeDraft || modeDraft === 'ALL' || modeDraft === 'NONE') {
    return modeDraft === 'ALL' || modeDraft === 'NONE'
      ? { mode: modeDraft, value: '' }
      : persistedDraft;
  }

  return persistedDraft.mode === modeDraft
    ? persistedDraft
    : readDefaultInitiatorPolicyDraft(modeDraft);
}

function readInitiatorPolicyIssue(
  policyDraft: InitiatorPolicyDraft,
): string | null {
  if (policyDraft.mode === 'NONE') {
    return '發起權限需要選擇誰可以發起。';
  }

  if (
    (policyDraft.mode === 'ORG_UNIT' ||
      policyDraft.mode === 'ORG_UNIT_POSITION') &&
    !policyDraft.orgUnitId?.trim()
  ) {
    return '指定組織發起時，需要選擇組織。';
  }

  if (
    policyDraft.mode === 'ORG_UNIT_POSITION' &&
    !policyDraft.positionId?.trim()
  ) {
    return '指定組織職位發起時，需要選擇職位。';
  }

  return null;
}

function readCelStringListOperands(
  expression: string,
  pattern: RegExp,
): readonly string[] {
  return [...expression.matchAll(pattern)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function readInitiatorPolicyCel(
  draft: InitiatorPolicyDraft,
  orgUnits: readonly OrgUnitRecord[],
): string | null {
  if (draft.mode === 'ALL' || draft.mode === 'NONE') {
    return null;
  }

  const orgUnitId = draft.orgUnitId?.trim() ?? '';

  if (!orgUnitId) {
    return null;
  }

  const orgUnitIds = readOrgUnitScopeIds(
    orgUnits,
    orgUnitId,
    Boolean(draft.includeDescendants),
  );
  const orgUnitExpression = orgUnitIds
    .map((id) => `${JSON.stringify(id)} in subject.orgUnitIds`)
    .join(' || ');

  if (draft.mode === 'ORG_UNIT') {
    return orgUnitExpression ? `(${orgUnitExpression})` : null;
  }

  const positionId = draft.positionId?.trim() ?? '';

  if (!positionId) {
    return null;
  }

  return orgUnitExpression
    ? `(${orgUnitExpression}) && ${JSON.stringify(positionId)} in subject.positionIds`
    : null;
}

function readInitiatorPolicySummary(
  policyDraft: InitiatorPolicyDraft,
  orgUnits: readonly OrgUnitRecord[],
  positions: readonly PositionRecord[],
): string {
  if (policyDraft.mode === 'NONE') {
    return '未設定';
  }

  if (policyDraft.mode === 'ORG_UNIT') {
    return policyDraft.orgUnitId
      ? `組織：${readOrgUnitDisplayName(orgUnits, policyDraft.orgUnitId)}`
      : '指定組織';
  }

  if (policyDraft.mode === 'ORG_UNIT_POSITION') {
    return policyDraft.orgUnitId && policyDraft.positionId
      ? `組織職位：${readOrgUnitDisplayName(
          orgUnits,
          policyDraft.orgUnitId,
        )} / ${readPositionDisplayName(positions, policyDraft.positionId)}`
      : '指定組織職位';
  }

  if (policyDraft.mode === 'CUSTOM') {
    return '既有自訂規則';
  }

  return '所有人';
}

function readDefaultInitiatorPolicyDraft(
  mode: Exclude<InitiatorPolicyMode, 'CUSTOM'>,
): InitiatorPolicyDraft {
  return {
    includeDescendants: true,
    mode,
    orgUnitId: '',
    positionId: '',
    value: '',
  };
}

function isWorkflowConnectionValid(
  connection: WorkflowConnectionCandidate,
  nodes: readonly WorkflowNode[],
): boolean {
  const sourceNode = connection.source
    ? (nodes.find((node) => node.id === connection.source) ?? null)
    : null;
  const targetNode = connection.target
    ? (nodes.find((node) => node.id === connection.target) ?? null)
    : null;

  return (
    Boolean(sourceNode) &&
    Boolean(targetNode) &&
    connection.source !== connection.target &&
    connection.sourceHandle === WORKFLOW_OUTPUT_HANDLE_ID &&
    connection.targetHandle === WORKFLOW_INPUT_HANDLE_ID &&
    Boolean(sourceNode && isWorkflowNodeOutputConnectable(sourceNode)) &&
    Boolean(targetNode && isWorkflowNodeInputConnectable(targetNode))
  );
}

function toggleSelectedEdgeId(
  edgeIds: readonly string[],
  edgeId: string,
): readonly string[] {
  return edgeIds.includes(edgeId)
    ? edgeIds.filter((currentEdgeId) => currentEdgeId !== edgeId)
    : [...edgeIds, edgeId];
}

function isWorkflowNodeRemovable(node: WorkflowNode): boolean {
  return node.type !== 'startEvent' && node.type !== 'endEvent';
}

function isWorkflowNodeInputConnectable(node: WorkflowNode): boolean {
  return node.type !== 'startEvent';
}

function isWorkflowNodeOutputConnectable(node: WorkflowNode): boolean {
  return node.type !== 'endEvent' && !isAsyncNotifyServiceTask(node);
}

function isAsyncNotifyServiceTask(node: WorkflowNode): boolean {
  return node.type === 'serviceTask' && node.data.action.type === 'NOTIFY';
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

function readFormVersionSelectOptions(
  options: readonly PublishedFormVersionOption[],
): readonly FormVersionSelectOption[] {
  return options.map((option) => ({
    formDefinitionId: option.formDefinitionId,
    formName: option.formName,
    id: option.id,
    name: `${option.formName} ｜ v${option.version}`,
    schema: option.schema,
  }));
}

function readDryRunSampleFormData(
  option: FormVersionSelectOption | null,
): Readonly<Record<string, unknown>> {
  return (option?.schema.fields ?? []).reduce<
    Readonly<Record<string, unknown>>
  >(
    (formData, field) => ({
      ...formData,
      [field.fieldKey]: readDryRunSampleFieldValue(field),
    }),
    {},
  );
}

function readDryRunSampleFieldValue(field: FormFieldDefinition): unknown {
  if (field.type === 'number') {
    return 1000;
  }

  if (field.type === 'boolean') {
    return true;
  }

  if (field.type === 'select') {
    return field.options[0]?.value ?? '';
  }

  if (field.type === 'checkbox') {
    return field.options[0] ? [field.options[0].value] : [];
  }

  if (field.type === 'date') {
    return '2026-05-08';
  }

  if (field.type === 'datetime') {
    return '2026-05-08T09:00:00+08:00';
  }

  return field.placeholder ?? field.label;
}

function parseDryRunFormData(value: string): Readonly<Record<string, unknown>> {
  const parsedValue = JSON.parse(value) as unknown;

  if (!isRecord(parsedValue)) {
    throw new Error('表單資料 JSON 必須是物件。');
  }

  return parsedValue;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDryRunStatusLabel(status: string): string {
  if (status === 'COMPLETED') {
    return '完成';
  }

  if (status === 'PASSED') {
    return '通過';
  }

  if (status === 'SKIPPED') {
    return '略過';
  }

  if (status === 'STOPPED') {
    return '已停止';
  }

  if (status === 'WAITING') {
    return '將等待簽核';
  }

  return status;
}

function readWorkflowNodeTypeLabel(nodeType: string): string {
  return nodeType in NODE_TYPE_LABELS
    ? NODE_TYPE_LABELS[nodeType as WorkflowNode['type']]
    : nodeType;
}

function mergeSelectedOption(
  options: readonly FormVersionSelectOption[],
  selectedOption: FormVersionSelectOption | null,
): readonly FormVersionSelectOption[] {
  return selectedOption &&
    !options.some((option) => option.id === selectedOption.id)
    ? [selectedOption, ...options]
    : options;
}

function readMemberSelectOptions(
  options: readonly MemberProfileRecord[],
): readonly MemberSelectOption[] {
  return options.map((option) => ({
    displayName: option.name,
    email: option.email,
    id: option.memberId,
    memberId: option.memberId,
    name: formatMemberDisplayName(option.name, option.email),
  }));
}

function readFallbackMemberSelectOption(memberId: string): MemberSelectOption {
  return {
    displayName: '未知會員',
    email: '',
    id: memberId,
    memberId,
    name: '未知會員',
  };
}

function readMemberSelectOption(
  options: readonly MemberSelectOption[],
  memberId: string,
): MemberSelectOption {
  return (
    options.find((option) => option.memberId === memberId) ??
    readFallbackMemberSelectOption(memberId)
  );
}

function readSelectedOrgUnitOption(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
): OrgUnitOption | null {
  const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);

  return orgUnit ? readOrgUnitOption(orgUnit) : null;
}

function readSelectedPositionOption(
  positions: readonly PositionRecord[],
  positionId: string,
): PositionOption | null {
  const position = positions.find((candidate) => candidate.id === positionId);

  return position ? readPositionOption(position) : null;
}

function readOrgUnitDisplayName(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
): string {
  return readSelectedOrgUnitOption(orgUnits, orgUnitId)?.name ?? '未指定組織';
}

function readPositionDisplayName(
  positions: readonly PositionRecord[],
  positionId: string,
): string {
  return (
    readSelectedPositionOption(positions, positionId)?.name ?? '未指定職位'
  );
}

function readDryRunInitiatorMetadataSnapshot(
  memberId: string,
  memberships: readonly MembershipRecord[],
): Readonly<Record<string, unknown>> {
  const today = readTodayDateOnlyString();
  const activeMemberships = memberships.filter(
    (membership) =>
      membership.memberId === memberId &&
      isMembershipActiveOn(membership, today),
  );
  const primaryMembership = activeMemberships.reduce<MembershipRecord | null>(
    (currentPrimary, membership) =>
      currentPrimary &&
      compareMembershipRecord(currentPrimary, membership) <= 0
        ? currentPrimary
        : membership,
    null,
  );

  return {
    customFields: {},
    managerMemberId: 'member-002',
    memberId,
    orgCode: 'HQ',
    orgUnitIds: readUniqueTexts(
      activeMemberships.map((membership) => membership.orgUnitId),
    ),
    positionId: primaryMembership?.positionId ?? null,
    positionIds: readUniqueTexts(
      activeMemberships.map((membership) => membership.positionId),
    ),
    primaryOrgUnitId: primaryMembership?.orgUnitId ?? null,
    roles: ['manager'],
  };
}

function readTodayDateOnlyString(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMembershipActiveOn(
  membership: MembershipRecord,
  date: string,
): boolean {
  return (
    membership.effectiveFrom <= date &&
    (!membership.effectiveTo || membership.effectiveTo >= date)
  );
}

function compareMembershipRecord(
  left: MembershipRecord,
  right: MembershipRecord,
): number {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  return right.effectiveFrom.localeCompare(left.effectiveFrom);
}

function readUniqueTexts(
  values: readonly (string | null | undefined)[],
): readonly string[] {
  return values.reduce<readonly string[]>(
    (currentValues, value) =>
      value && !currentValues.includes(value)
        ? [...currentValues, value]
        : currentValues,
    [],
  );
}

function readOrgScopedPositions({
  includeDescendants,
  memberships,
  orgUnitId,
  orgUnits,
  positions,
}: {
  readonly includeDescendants: boolean;
  readonly memberships: readonly MembershipRecord[];
  readonly orgUnitId: string;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly positions: readonly PositionRecord[];
}): readonly PositionRecord[] {
  const orgUnitIds = new Set(
    readOrgUnitScopeIds(orgUnits, orgUnitId, includeDescendants),
  );
  const positionIds = new Set(
    memberships
      .filter((membership) => orgUnitIds.has(membership.orgUnitId))
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId)),
  );

  return positions.filter((position) => positionIds.has(position.id));
}

function readOrgUnitScopeIds(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
  includeDescendants: boolean,
): readonly string[] {
  const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);

  if (!orgUnit) {
    return orgUnitId.trim() ? [orgUnitId] : [];
  }

  if (!includeDescendants) {
    return [orgUnit.id];
  }

  return orgUnits
    .filter(
      (candidate) =>
        candidate.id === orgUnit.id ||
        candidate.path.startsWith(`${orgUnit.path}.`),
    )
    .map((candidate) => candidate.id);
}

function mergeMemberOptions(
  currentOptions: readonly MemberSelectOption[],
  nextOptions: readonly MemberSelectOption[],
): readonly MemberSelectOption[] {
  const currentOptionIds = new Set(
    currentOptions.map((option) => option.memberId),
  );
  const newOptions = nextOptions.filter(
    (option) => !currentOptionIds.has(option.memberId),
  );

  return [...currentOptions, ...newOptions];
}

function readWorkflowDirectMemberIds(
  definition: WorkflowDefinition,
): readonly string[] {
  return [
    ...new Set(
      definition.nodes.flatMap((node) => {
        if (node.type === 'userTask') {
          return node.data.approverResolver.type === 'DIRECT'
            ? node.data.approverResolver.memberIds
            : [];
        }

        if (node.type === 'serviceTask') {
          return readServiceTaskMemberIds(node.data.action);
        }

        return [];
      }),
    ),
  ];
}

function readNodeApproverSummary(
  node: WorkflowNode,
  memberOptions: readonly MemberSelectOption[],
  orgUnits: readonly OrgUnitRecord[],
  positions: readonly PositionRecord[],
): string | null {
  if (node.type === 'userTask') {
    return readApproverResolverSummary(
      node.data.approverResolver,
      memberOptions,
      orgUnits,
      positions,
    );
  }

  return null;
}

function readApproverResolverSummary(
  resolver: ApproverResolver,
  memberOptions: readonly MemberSelectOption[],
  orgUnits: readonly OrgUnitRecord[],
  positions: readonly PositionRecord[],
): string {
  if (resolver.type === 'DIRECT') {
    return readMemberEmailSummary(
      resolver.memberIds,
      memberOptions,
      '未指定簽核者',
    );
  }

  if (resolver.type === 'ORG_MANAGER') {
    return readManagerLevelOption(resolver.levelsUp).name;
  }

  if (resolver.type === 'ORG_UNIT_MANAGER') {
    return `組織主管：${readOrgUnitDisplayName(orgUnits, resolver.orgUnitId)}`;
  }

  if (resolver.type === 'ORG_UNIT_MEMBER') {
    return `組織任一人：${readOrgUnitDisplayName(orgUnits, resolver.orgUnitId)}`;
  }

  if (resolver.type === 'ORG_UNIT_POSITION') {
    return `組織職位：${readOrgUnitDisplayName(
      orgUnits,
      resolver.orgUnitId,
    )} / ${readPositionDisplayName(positions, resolver.positionId)}`;
  }

  if (resolver.type === 'POSITION') {
    return `職位：${readPositionDisplayName(positions, resolver.positionId)}`;
  }

  if (resolver.type === 'DYNAMIC_FORM') {
    return `表單欄位：${resolver.formPath || '未設定'}`;
  }

  return '自訂表達式';
}

function readNodeApproverLines(
  node: WorkflowNode,
  memberOptions: readonly MemberSelectOption[],
): readonly string[] | null {
  if (node.type !== 'serviceTask') {
    return null;
  }

  const memberIds = readServiceTaskMemberIds(node.data.action);

  return memberIds.length === 0
    ? ['未指定知會對象']
    : memberIds.map(
        (memberId) => readMemberSelectOption(memberOptions, memberId).name,
      );
}

function readMemberEmailSummary(
  memberIds: readonly string[],
  memberOptions: readonly MemberSelectOption[],
  emptyLabel: string,
): string {
  const memberLabels = memberIds.map(
    (memberId) => readMemberSelectOption(memberOptions, memberId).name,
  );

  if (memberLabels.length === 0) {
    return emptyLabel;
  }

  if (memberLabels.length <= 2) {
    return memberLabels.join('、');
  }

  return `${memberLabels.slice(0, 2).join('、')} 等 ${memberLabels.length} 人`;
}

function formatMemberDisplayName(name: string, email: string): string {
  return `${name} (${email})`;
}

function readWorkflowViewport(
  definition: WorkflowDefinition,
  canvasElement: HTMLDivElement | null,
): Viewport | null {
  const canvasRect = canvasElement?.getBoundingClientRect();

  if (!canvasRect || definition.nodes.length === 0) {
    return null;
  }

  const bounds = definition.nodes.reduce(
    (currentBounds, node) => {
      const dimensions = readWorkflowNodeDimensions(node);

      return {
        maxX: Math.max(currentBounds.maxX, node.position.x + dimensions.width),
        maxY: Math.max(currentBounds.maxY, node.position.y + dimensions.height),
        minX: Math.min(currentBounds.minX, node.position.x),
        minY: Math.min(currentBounds.minY, node.position.y),
      };
    },
    {
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
    },
  );

  return getViewportForBounds(
    {
      height: bounds.maxY - bounds.minY,
      width: bounds.maxX - bounds.minX,
      x: bounds.minX,
      y: bounds.minY,
    },
    canvasRect.width,
    canvasRect.height,
    0.1,
    1,
    0.2,
  );
}

function readWorkflowDefinitionIssue(
  definition: WorkflowDefinition,
): string | null {
  const incompleteUserTaskNode = definition.nodes.find(
    (node) =>
      node.type === 'userTask' &&
      Boolean(readApproverResolverIssue(node.data.approverResolver)),
  );
  const incompleteNotifyNode = definition.nodes.find(
    (node) =>
      node.type === 'serviceTask' &&
      node.data.action.type === 'NOTIFY' &&
      readServiceTaskMemberIds(node.data.action).length === 0,
  );
  const incompleteConditionEdge = definition.edges.find(
    (edge) =>
      isExclusiveGatewaySourceEdge(edge, definition.nodes) &&
      !edge.data.isDefault &&
      !edge.data.condition,
  );

  if (incompleteUserTaskNode && incompleteUserTaskNode.type === 'userTask') {
    return readApproverResolverIssue(
      incompleteUserTaskNode.data.approverResolver,
    );
  }

  if (incompleteNotifyNode) {
    return '知會節點需要至少一位知會對象。';
  }

  if (incompleteConditionEdge) {
    return '條件分流的每條輸出連線都需要先設定條件。';
  }

  return null;
}

function readApproverResolverIssue(resolver: ApproverResolver): string | null {
  if (resolver.type === 'DIRECT' && resolver.memberIds.length === 0) {
    return '簽核節點需要指定簽核會員。';
  }

  if (resolver.type === 'ORG_MANAGER' && resolver.levelsUp < 1) {
    return '簽核節點需要指定有效的主管層級。';
  }

  if (resolver.type === 'ORG_UNIT_MANAGER' && !resolver.orgUnitId.trim()) {
    return '簽核節點需要指定組織。';
  }

  if (resolver.type === 'ORG_UNIT_MEMBER' && !resolver.orgUnitId.trim()) {
    return '簽核節點需要指定組織。';
  }

  if (
    resolver.type === 'ORG_UNIT_POSITION' &&
    (!resolver.orgUnitId.trim() || !resolver.positionId.trim())
  ) {
    return '簽核節點需要指定組織與職位。';
  }

  if (
    (resolver.type === 'ORG_MANAGER' || resolver.type === 'ORG_UNIT_MANAGER') &&
    resolver.fallback?.type === 'DIRECT' &&
    !resolver.fallback.memberId.trim()
  ) {
    return '簽核節點需要指定改派固定人。';
  }

  if (resolver.type === 'POSITION' && !resolver.positionId.trim()) {
    return '簽核節點需要指定職位。';
  }

  return null;
}

function hasConfiguredConditionEdges(definition: WorkflowDefinition): boolean {
  return definition.edges.some(
    (edge) =>
      isExclusiveGatewaySourceEdge(edge, definition.nodes) &&
      Boolean(
        edge.data.condition ||
        edge.data.conditionFieldKey ||
        edge.data.conditionOperator ||
        edge.data.conditionValue,
      ),
  );
}

function readConditionFieldOptions(
  schema: FormDefinitionSchema | null,
): readonly ConditionFieldOption[] {
  return (
    schema?.fields.map((field) => ({
      fieldType: field.type,
      id: field.fieldKey,
      name: `${field.label} (${field.fieldKey})`,
    })) ?? []
  );
}

function readConditionField(
  schema: FormDefinitionSchema | null,
  fieldKey: string | null,
): FormFieldDefinition | null {
  return fieldKey
    ? (schema?.fields.find((field) => field.fieldKey === fieldKey) ?? null)
    : null;
}

function readConditionOperatorOptions(
  field: FormFieldDefinition | null,
): readonly ConditionOperatorOption[] {
  if (!field) {
    return [];
  }

  const operatorIds = readConditionOperatorIds(field);

  return CONDITION_OPERATOR_OPTIONS.filter((option) =>
    operatorIds.includes(option.id),
  );
}

function readConditionOperator(
  value: string | null,
): WorkflowEdgeConditionOperator | null {
  return CONDITION_OPERATOR_OPTIONS.some((option) => option.id === value)
    ? (value as WorkflowEdgeConditionOperator)
    : null;
}

function readConditionOperatorIds(
  field: FormFieldDefinition,
): readonly WorkflowEdgeConditionOperator[] {
  if (field.type === 'file_upload') {
    return ['IS_FILLED', 'IS_EMPTY'];
  }

  if (field.type === 'boolean') {
    return ['EQUALS', 'NOT_EQUALS', 'IS_FILLED', 'IS_EMPTY'];
  }

  if (
    field.type === 'date' ||
    field.type === 'datetime' ||
    field.type === 'money' ||
    field.type === 'number'
  ) {
    return [
      'EQUALS',
      'NOT_EQUALS',
      'GREATER_THAN',
      'GREATER_THAN_OR_EQUALS',
      'LESS_THAN',
      'LESS_THAN_OR_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ];
  }

  return ['EQUALS', 'NOT_EQUALS', 'IS_FILLED', 'IS_EMPTY'];
}

function readConditionValueOptions(
  field: FormFieldDefinition | null,
): readonly ConditionValueOption[] {
  if (!field) {
    return [];
  }

  if (field.type === 'boolean') {
    return [
      { id: 'true', name: '是' },
      { id: 'false', name: '否' },
    ];
  }

  if (
    field.type === 'checkbox' ||
    field.type === 'radio' ||
    field.type === 'select'
  ) {
    return field.options.map((option) => ({
      id: option.value,
      name: option.label,
    }));
  }

  return [];
}

function shouldConditionOperatorUseValue(
  operator: WorkflowEdgeConditionOperator,
): boolean {
  return CONDITION_OPERATORS_REQUIRING_VALUE.includes(operator);
}

function readEdgeCanvasLabel(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): string | undefined {
  if (edge.data.label) {
    return edge.data.label;
  }

  if (isExclusiveGatewaySourceEdge(edge, nodes)) {
    return readExclusiveGatewayPathLabel(edge);
  }

  if (isParallelGatewaySourceEdge(edge, nodes)) {
    return '同時進行';
  }

  return undefined;
}

function readExclusiveGatewayPathLabel(edge: WorkflowEdge): string {
  if (edge.data.isDefault) {
    return '其他情況';
  }

  return '請設定條件';
}

function isExclusiveGatewaySourceEdge(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): boolean {
  return nodes.some(
    (node) => node.id === edge.source && node.type === 'exclusiveGateway',
  );
}

function isParallelGatewaySourceEdge(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
): boolean {
  return nodes.some(
    (node) => node.id === edge.source && node.type === 'parallelGateway',
  );
}

function readServiceTaskMemberIds(action: ServiceAction): readonly string[] {
  return action.type === 'NOTIFY' && action.recipients.type === 'DIRECT'
    ? action.recipients.memberIds
    : [];
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
