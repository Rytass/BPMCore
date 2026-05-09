'use client';

import {
  ChangeEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import * as dagre from 'dagre';
import {
  AutoComplete,
  Button,
  FormField,
  Icon,
  Input,
  Layout,
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
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';
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
  FormFieldOption,
} from '@bpm/shared/form';
import {
  ServiceAction,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowEdgeConditionOperator,
  WorkflowEdgeData,
  WorkflowNode,
  WorkflowNodeTriggerMode,
  ReturnResubmitStrategy,
} from '@bpm/shared/workflow';
import { renderAppNavigation } from '../../../app-navigation';
import {
  ApprovalTemplateVersionRecord,
  WorkflowDryRunResultRecord,
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
} from '../../_lib/template-api';

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
type InitiatorPolicyMode = 'ALL' | 'CUSTOM' | 'NONE' | 'ORG' | 'ROLE';
type InitiatorPolicyDraft = Readonly<{
  mode: InitiatorPolicyMode;
  value: string;
}>;
type InitiatorPolicyModeOption = Readonly<{
  id: InitiatorPolicyMode;
  name: string;
}>;
type InitiatorPolicyValueOption = Readonly<{
  id: string;
  name: string;
}>;
type ReturnResubmitStrategyOption = Readonly<{
  id: ReturnResubmitStrategy;
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
  { id: 'ROLE', name: '指定角色' },
  { id: 'ORG', name: '指定組織代碼' },
];
const INITIATOR_POLICY_CUSTOM_OPTION: InitiatorPolicyModeOption = {
  id: 'CUSTOM',
  name: '既有自訂規則',
};
const INITIATOR_ROLE_OPTIONS: readonly InitiatorPolicyValueOption[] = [
  { id: 'manager', name: 'manager' },
  { id: 'finance', name: 'finance' },
  { id: 'IT', name: 'IT' },
];
const INITIATOR_ORG_OPTIONS: readonly InitiatorPolicyValueOption[] = [
  { id: 'HQ', name: 'HQ' },
  { id: 'BPM-HQ', name: 'BPM-HQ' },
  { id: 'FIN-TW', name: 'FIN-TW' },
];
const DRY_RUN_MEMBER_ID = 'member-001';

const nodeTypes: NodeTypes = {
  endEvent: WorkflowNodeCard,
  exclusiveGateway: WorkflowNodeCard,
  parallelGateway: WorkflowNodeCard,
  serviceTask: WorkflowNodeCard,
  startEvent: WorkflowNodeCard,
  userTask: WorkflowNodeCard,
};

export default function TemplateDesignerPage(): ReactElement {
  const params = useParams<{ readonly id: string }>();
  const router = useRouter();
  const templateId = params.id;
  const [record, setRecord] = useState<TemplateDesignerRecord | null>(null);
  const [draft, setDraft] = useState<ApprovalTemplateVersionRecord | null>(
    null,
  );
  const [workflowDefinition, setWorkflowDefinition] =
    useState<WorkflowDefinition>(readFallbackWorkflowDefinition());
  const [formDefinitionVersionId, setFormDefinitionVersionId] = useState<
    string | null
  >(null);
  const [initiatorPolicyCel, setInitiatorPolicyCel] = useState<string | null>(
    null,
  );
  const [initiatorPolicyModeDraft, setInitiatorPolicyModeDraft] =
    useState<Exclude<InitiatorPolicyMode, 'CUSTOM'> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('start');
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<readonly string[]>([]);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formVersionLoading, setFormVersionLoading] = useState(false);
  const [formVersionOptions, setFormVersionOptions] = useState<
    readonly FormVersionSelectOption[]
  >([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberOptions, setMemberOptions] = useState<
    readonly MemberSelectOption[]
  >([]);
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunFormDataJson, setDryRunFormDataJson] = useState('{}');
  const [dryRunResult, setDryRunResult] =
    useState<WorkflowDryRunResultRecord | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [flowViewport, setFlowViewport] = useState<Viewport | undefined>(
    undefined,
  );
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);

  useEffect((): void => {
    void refreshDesigner();
  }, [templateId]);

  useEffect((): void => {
    void resolveWorkflowMemberOptions(workflowDefinition);
  }, [workflowDefinition, memberOptions]);

  useEffect((): void => {
    setWorkflowDefinition((currentDefinition) =>
      normalizeDesignerWorkflowDefinition(currentDefinition),
    );
  }, [workflowDefinition.edges, workflowDefinition.nodes]);

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
    const selectedNodeIdToRemove =
      selectedNode && isWorkflowNodeRemovable(selectedNode)
        ? selectedNode.id
        : null;

    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      edges: currentDefinition.edges.filter(
        (edge) =>
          !selectedEdgeIds.includes(edge.id) &&
          edge.source !== selectedNodeIdToRemove &&
          edge.target !== selectedNodeIdToRemove,
      ),
      nodes: selectedNodeIdToRemove
        ? currentDefinition.nodes.filter(
            (node) => node.id !== selectedNodeIdToRemove,
          )
        : currentDefinition.nodes,
    }));
    setSelectedEdgeIds([]);
    setEditingEdgeId(null);

    if (selectedNodeIdToRemove) {
      setSelectedNodeId('start');
    }
  }, [selectedEdgeIds, selectedNode]);

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
      readInitiatorPolicyUiDraft(initiatorPolicyCel, initiatorPolicyModeDraft),
    [initiatorPolicyCel, initiatorPolicyModeDraft],
  );
  const flowNodes = useMemo(
    (): FlowNode[] =>
      workflowDefinition.nodes.map((node) =>
        readFlowNode(
          node,
          memberOptions,
          node.id === selectedNodeId,
          initiatorPolicyDraft,
        ),
      ),
    [
      initiatorPolicyDraft,
      memberOptions,
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

  async function refreshDesigner(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const nextRecord = await readTemplateDesigner(templateId);
      const nextDraft =
        nextRecord.versions.find((version) => version.status === 'DRAFT') ??
        null;
      const sourceVersion = nextDraft ?? nextRecord.versions[0] ?? null;

      setRecord(nextRecord);
      setDraft(nextDraft);
      setFormVersionOptions(
        readFormVersionSelectOptions(nextRecord.formVersions),
      );
      setWorkflowDefinition(
        sourceVersion?.workflowDefinition ?? readFallbackWorkflowDefinition(),
      );
      setFormDefinitionVersionId(
        sourceVersion?.formDefinitionVersionId ??
          nextRecord.formVersions[0]?.id ??
          null,
      );
      setInitiatorPolicyCel(sourceVersion?.initiatorPolicyCel ?? null);
      setInitiatorPolicyModeDraft(
        sourceVersion &&
          !nextRecord.template.currentVersionId &&
          !sourceVersion.initiatorPolicyCel &&
          isEmptyDesignerWorkflowDefinition(sourceVersion.workflowDefinition)
          ? 'NONE'
          : null,
      );
      setSelectedNodeId(
        sourceVersion?.workflowDefinition.nodes[0]?.id ?? 'start',
      );
      setSelectedEdgeIds([]);
      setEditingEdgeId(null);
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

  async function handleSaveDraft(): Promise<ApprovalTemplateVersionRecord> {
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

      const targetDraft = draft ?? (await forkApprovalTemplate(templateId));
      const nextDraft = await updateApprovalTemplateDraft({
        formDefinitionVersionId,
        initiatorPolicyCel,
        versionId: targetDraft.id,
        workflowDefinition,
      });

      setDraft(nextDraft);
      await refreshDesigner();

      return nextDraft;
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const savedDraft = await handleSaveDraft();
      await publishApprovalTemplateVersion(savedDraft.id);
      await refreshDesigner();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
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
        initiatorMetadataSnapshot: {
          customFields: {},
          managerMemberId: 'member-002',
          memberId: DRY_RUN_MEMBER_ID,
          orgCode: 'HQ',
          roles: ['manager'],
        },
        workflowDefinition,
      });

      setDryRunResult(result);
    } catch (requestError: unknown) {
      setDryRunError(readErrorMessage(requestError));
    } finally {
      setDryRunRunning(false);
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
    if (!isWorkflowConnectionValid(connection, workflowDefinition.nodes)) {
      return;
    }

    const shouldOpenConditionSettings = workflowDefinition.nodes.some(
      (node) =>
        node.id === connection.source && node.type === 'exclusiveGateway',
    );
    const nextEdge = createWorkflowEdge(
      connection.source,
      connection.target,
      {},
    );

    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      edges: [...currentDefinition.edges, nextEdge],
    }));
    setSelectedNodeId(null);
    setSelectedEdgeIds([nextEdge.id]);
    setEditingEdgeId(shouldOpenConditionSettings ? nextEdge.id : null);
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
    const nodeIndex = readNextWorkflowNodeIndex(workflowDefinition.nodes, type);
    const node = createWorkflowNode(type, nodeIndex);
    const inserted = insertWorkflowNodeIntoDefinition({
      definition: workflowDefinition,
      node,
      selectedEdgeId: selectedEdgeIds.length === 1 ? selectedEdgeIds[0] : null,
      selectedNodeId,
    });
    const nextDefinition = layoutWorkflowDefinition(inserted.definition);
    const nextViewport = readWorkflowViewport(
      nextDefinition,
      flowCanvasRef.current,
    );

    setWorkflowDefinition(nextDefinition);
    setSelectedNodeId(inserted.selectedNodeId);
    setSelectedEdgeIds(inserted.selectedEdgeIds);
    setEditingEdgeId(inserted.editingEdgeId);

    if (nextViewport) {
      setFlowViewport(nextViewport);
    }
  }

  function updateSelectedNodeLabel(label: string): void {
    if (!selectedNode) {
      return;
    }

    updateNode(selectedNode.id, (node) => renameWorkflowNode(node, label));
  }

  function updateUserTaskResolver(memberId: string | null): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              approverResolver: {
                memberIds: memberId ? [memberId] : [],
                type: 'DIRECT',
              },
              decisionPolicy: { type: 'SINGLE' },
            },
          }
        : node,
    );
  }

  function updateUserTaskReturnResubmitStrategy(
    resubmitStrategy: ReturnResubmitStrategy,
  ): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              returnBehavior: {
                ...node.data.returnBehavior,
                resubmitStrategy,
              },
            },
          }
        : node,
    );
  }

  function updateServiceAction(action: ServiceAction): void {
    if (!selectedNode || selectedNode.type !== 'serviceTask') {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      node.type === 'serviceTask'
        ? {
            ...node,
            data: {
              ...node.data,
              action,
            },
          }
        : node,
    );
  }

  function updateInitiatorPolicyDraft(
    mode: Exclude<InitiatorPolicyMode, 'ALL' | 'CUSTOM'>,
    value: string,
  ): void {
    setInitiatorPolicyModeDraft(mode);
    setInitiatorPolicyCel(readInitiatorPolicyCel({ mode, value }));
  }

  function updateSelectedNodeTriggerMode(
    triggerMode: WorkflowNodeTriggerMode,
  ): void {
    if (!selectedNode || selectedNode.type === 'startEvent') {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      applyWorkflowNodeTriggerMode(node, triggerMode),
    );
  }

  function updateNode(
    nodeId: string,
    updater: (node: WorkflowNode) => WorkflowNode,
  ): void {
    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      nodes: currentDefinition.nodes.map((node) =>
        node.id === nodeId ? updater(node) : node,
      ),
    }));
  }

  function updateWorkflowEdge(
    edgeId: string,
    updater: (edge: WorkflowEdge) => WorkflowEdge,
  ): void {
    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      edges: currentDefinition.edges.map((edge) =>
        edge.id === edgeId ? updater(edge) : edge,
      ),
    }));
  }

  function updateSelectedEdgeDefault(edgeId: string, checked: boolean): void {
    setWorkflowDefinition((currentDefinition) => {
      const targetEdge = currentDefinition.edges.find(
        (edge) => edge.id === edgeId,
      );

      if (!targetEdge) {
        return currentDefinition;
      }

      return {
        ...currentDefinition,
        edges: currentDefinition.edges.map((edge) => {
          if (
            checked &&
            edge.source === targetEdge.source &&
            edge.id !== targetEdge.id &&
            isExclusiveGatewaySourceEdge(edge, currentDefinition.nodes)
          ) {
            return {
              ...edge,
              data: {
                ...edge.data,
                isDefault: false,
              },
            };
          }

          return edge.id === targetEdge.id
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  isDefault: checked,
                },
              }
            : edge;
        }),
      };
    });
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
    const schema = selectedFormVersionOption?.schema ?? null;

    updateWorkflowEdge(edgeId, (currentEdge) => {
      const nextFieldKey =
        fieldKey ?? currentEdge.data.conditionFieldKey ?? null;
      const field = readConditionField(schema, nextFieldKey);
      const nextOperator = readNextConditionOperator(
        field,
        operator ?? currentEdge.data.conditionOperator ?? null,
      );
      const nextValue = readNextConditionValue(
        field,
        nextOperator,
        value ?? currentEdge.data.conditionValue ?? null,
      );
      const nextLabel = readConditionLabel(field, nextOperator, nextValue);

      return {
        ...currentEdge,
        data: {
          ...currentEdge.data,
          condition: readConditionExpression(field, nextOperator, nextValue),
          conditionFieldKey: field?.fieldKey,
          conditionOperator: nextOperator,
          conditionValue: nextValue,
          isDefault: false,
          label: nextLabel,
        },
      };
    });
  }

  function applyAutoLayout(): void {
    const nextDefinition = layoutWorkflowDefinition(workflowDefinition);
    const nextViewport = readWorkflowViewport(
      nextDefinition,
      flowCanvasRef.current,
    );

    setWorkflowDefinition(nextDefinition);

    if (nextViewport) {
      setFlowViewport(nextViewport);
    }
  }

  return (
    <Layout>
      {renderAppNavigation('/templates')}

      <Layout.Main>
        <style>{SIDE_PANEL_GLOBAL_STYLE}</style>
        <PageHeader>
          <ContentHeader
            description={`${draft ? `草稿 v${draft.version}` : '尚未建立草稿'} ·${
              record?.template.currentVersionId ? ' 已發布版本' : ' 尚未發布'
            }`}
            onBackClick={(): void => router.push('/templates')}
            title={record?.template.name ?? '流程設計器'}
          >
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
            <Button
              disabled={
                saving ||
                !draft ||
                Boolean(workflowIssue) ||
                Boolean(initiatorPolicyIssue)
              }
              icon={CheckedIcon}
              iconType="leading"
              onClick={(): void => void handlePublish()}
              variant="base-primary"
            >
              發布版本
            </Button>
          </ContentHeader>
        </PageHeader>

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
              <div style={FORM_STACK_STYLE}>
                <FormField
                  density={FormFieldDensity.WIDE}
                  fullWidth
                  hintText={
                    formVersionBindingLocked
                      ? '已設定條件分流條件。請先移除所有條件，才能更換綁定表單版本。'
                      : undefined
                  }
                  label="綁定表單版本"
                  layout={FormFieldLayout.STRETCH}
                  name="formDefinitionVersionId"
                  required
                >
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
                </FormField>
              </div>
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
        {renderDryRunModal()}
      </Layout.Main>
    </Layout>
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
          <FormField
            density={FormFieldDensity.WIDE}
            fullWidth
            label="表單資料 JSON"
            layout={FormFieldLayout.STRETCH}
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
          </FormField>
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
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="顯示名稱"
          layout={FormFieldLayout.STRETCH}
          name="nodeLabel"
          required
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedNodeLabel(event.target.value)
            }
            value={node.data.label}
            variant="base"
          />
        </FormField>
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
    // TODO: Replace these addable local options with server-controlled async role/org autocomplete when ABAC directory APIs are implemented.
    const roleOptions = readInitiatorPolicyValueOptions(
      INITIATOR_ROLE_OPTIONS,
      initiatorPolicyDraft.mode === 'ROLE' ? initiatorPolicyDraft.value : '',
    );
    const orgOptions = readInitiatorPolicyValueOptions(
      INITIATOR_ORG_OPTIONS,
      initiatorPolicyDraft.mode === 'ORG' ? initiatorPolicyDraft.value : '',
    );

    return (
      <>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          hintText={
            initiatorPolicyDraft.mode === 'CUSTOM'
              ? '這是舊版表達式規則；切換成標準選項後會改由 UI 管理。'
              : undefined
          }
          label="發起權限"
          layout={FormFieldLayout.STRETCH}
          name="initiatorPolicyMode"
          required
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void => {
              const mode = readInitiatorPolicyMode(option?.id ?? null);

              setInitiatorPolicyModeDraft(mode === 'ALL' ? null : mode);
              setInitiatorPolicyCel(
                readInitiatorPolicyCel({ mode, value: '' }),
              );
            }}
            options={policyModeOptions}
            placeholder="選擇誰可以發起"
            value={readSelectOption(
              policyModeOptions,
              initiatorPolicyDraft.mode,
            )}
          />
        </FormField>
        {initiatorPolicyDraft.mode === 'ROLE' ? (
          <FormField
            density={FormFieldDensity.WIDE}
            fullWidth
            label="角色代碼"
            layout={FormFieldLayout.STRETCH}
            name="initiatorRole"
            required
          >
            <AutoComplete
              addable
              createActionTextTemplate='使用 "{text}"'
              emptyText="沒有符合的角色"
              inputProps={{
                autoCapitalize: 'none',
                autoCorrect: 'off',
                name: 'workflow-initiator-role',
                spellCheck: false,
              }}
              mode="single"
              onChange={(option): void =>
                updateInitiatorPolicyDraft('ROLE', option?.id ?? '')
              }
              onInsert={insertFreeTextOption}
              options={[...roleOptions]}
              placeholder="例如：manager"
              value={readSelectOption(roleOptions, initiatorPolicyDraft.value)}
            />
          </FormField>
        ) : null}
        {initiatorPolicyDraft.mode === 'ORG' ? (
          <FormField
            density={FormFieldDensity.WIDE}
            fullWidth
            label="組織代碼"
            layout={FormFieldLayout.STRETCH}
            name="initiatorOrgCode"
            required
          >
            <AutoComplete
              addable
              createActionTextTemplate='使用 "{text}"'
              emptyText="沒有符合的組織代碼"
              inputProps={{
                autoCapitalize: 'none',
                autoCorrect: 'off',
                name: 'workflow-initiator-org-code',
                spellCheck: false,
              }}
              mode="single"
              onChange={(option): void =>
                updateInitiatorPolicyDraft('ORG', option?.id ?? '')
              }
              onInsert={insertFreeTextOption}
              options={[...orgOptions]}
              placeholder="例如：HQ"
              value={readSelectOption(orgOptions, initiatorPolicyDraft.value)}
            />
          </FormField>
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
      <FormField
        density={FormFieldDensity.WIDE}
        fullWidth
        hintText={
          triggerModeLocked
            ? '需要至少兩條前置連線，才可切換為任一前置完成。'
            : incomingEdgeCount > 1
              ? `${incomingEdgeCount} 條前置連線會依此規則觸發。`
              : '只有一條前置連線時，兩種設定效果相同。'
        }
        label="前置條件"
        layout={FormFieldLayout.STRETCH}
        name="triggerMode"
        required
      >
        <Select
          clearable={false}
          fullWidth
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
      </FormField>
    );
  }

  function renderUserTaskPanel(
    node: Extract<WorkflowNode, { type: 'userTask' }>,
  ): ReactElement {
    const resolver = node.data.approverResolver;
    const selectedMember =
      resolver.type === 'DIRECT'
        ? readPrimaryMemberOption(resolver.memberIds, memberOptions)
        : null;
    const resubmitStrategy =
      node.data.returnBehavior.resubmitStrategy ?? 'RESTART';

    return (
      <>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="簽核者"
          layout={FormFieldLayout.STRETCH}
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
            mode="single"
            onChange={(option): void =>
              updateUserTaskResolver(option?.id ?? null)
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
            value={selectedMember}
          />
        </FormField>
        {node.data.returnBehavior.allowReturn ? (
          <FormField
            density={FormFieldDensity.WIDE}
            fullWidth
            hintText="退回發起人後，重新送出時要從流程開始重跑，或直接回到退回的簽核節點。"
            label="重送策略"
            layout={FormFieldLayout.STRETCH}
            name="returnResubmitStrategy"
            required
          >
            <Select
              clearable={false}
              fullWidth
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
          </FormField>
        ) : null}
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
      <FormField
        density={FormFieldDensity.WIDE}
        fullWidth
        label="知會對象"
        layout={FormFieldLayout.STRETCH}
        name="notifyMemberIds"
        required
      >
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
      </FormField>
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
            <FormField
              density={FormFieldDensity.WIDE}
              fullWidth
              label="條件欄位"
              layout={FormFieldLayout.HORIZONTAL}
              name="edgeConditionField"
              required
            >
              <Select
                clearable={false}
                fullWidth
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
            </FormField>
            <FormField
              density={FormFieldDensity.WIDE}
              fullWidth
              label="條件判斷"
              layout={FormFieldLayout.HORIZONTAL}
              name="edgeConditionOperator"
              required
            >
              <Select
                clearable={false}
                fullWidth
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
            </FormField>
            {selectedConditionOperator &&
            shouldConditionOperatorUseValue(selectedConditionOperator.id) ? (
              <FormField
                density={FormFieldDensity.WIDE}
                fullWidth
                label="條件值"
                layout={FormFieldLayout.HORIZONTAL}
                name="edgeConditionValue"
                required
              >
                {conditionValueOptions.length > 0 ? (
                  <Select
                    clearable={false}
                    fullWidth
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
                    fullWidth
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
              </FormField>
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
  selected: boolean,
  initiatorPolicyDraft: InitiatorPolicyDraft,
): FlowNode {
  const dimensions = readWorkflowNodeDimensions(node);

  return {
    data: {
      approverLines: readNodeApproverLines(node, memberOptions),
      approverSummary: readNodeApproverSummary(node, memberOptions),
      hasInput: isWorkflowNodeInputConnectable(node),
      hasOutput: isWorkflowNodeOutputConnectable(node),
      initiatorPolicySummary:
        node.type === 'startEvent'
          ? readInitiatorPolicySummary(initiatorPolicyDraft)
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

function renameWorkflowNode(node: WorkflowNode, label: string): WorkflowNode {
  if (node.type === 'startEvent') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'endEvent') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'userTask') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'serviceTask') {
    return { ...node, data: { ...node.data, label } };
  }

  if (node.type === 'exclusiveGateway') {
    return { ...node, data: { ...node.data, label } };
  }

  return { ...node, data: { ...node.data, label } };
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
  return normalizeSingleIncomingTriggerModes(
    removeAsyncNotifyOutgoingEdges(definition),
  );
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

function createWorkflowNode(
  type: NodePaletteType,
  index: number,
): WorkflowNode {
  const id = `${type}_${index}`;
  const base = {
    id,
    position: { x: 260 + index * 48, y: 120 + index * 42 },
  };

  if (type === 'userTask') {
    return {
      ...base,
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: true,
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        decisionPolicy: { type: 'SINGLE' },
        label: `簽核節點 ${index}`,
        returnBehavior: {
          allowReturn: true,
          allowedTargets: 'INITIATOR',
          resubmitStrategy: 'RESTART',
        },
        triggerMode: 'AND',
      },
      type,
    };
  }

  if (type === 'serviceTask') {
    return {
      ...base,
      data: {
        action: {
          channels: ['IN_APP'],
          recipients: { memberIds: ['member-001'], type: 'DIRECT' },
          type: 'NOTIFY',
        },
        label: `知會節點 ${index}`,
        triggerMode: 'AND',
      },
      type,
    };
  }

  return {
    ...base,
    data: {
      direction: 'split',
      label: `條件分流 ${index}`,
      triggerMode: 'AND',
    },
    type,
  };
}

function readNextWorkflowNodeIndex(
  nodes: readonly WorkflowNode[],
  type: NodePaletteType,
): number {
  const usedIndexes = new Set(
    nodes
      .filter((node) => node.type === type)
      .map((node) => Number(node.id.replace(`${type}_`, '')))
      .filter((index) => Number.isInteger(index) && index > 0),
  );

  return (
    Array.from({ length: nodes.length + 1 }, (_, index) => index + 1).find(
      (index) => !usedIndexes.has(index),
    ) ?? nodes.length + 1
  );
}

function insertWorkflowNodeIntoDefinition({
  definition,
  node,
  selectedEdgeId,
  selectedNodeId,
}: {
  readonly definition: WorkflowDefinition;
  readonly node: WorkflowNode;
  readonly selectedEdgeId: string | null;
  readonly selectedNodeId: string | null;
}): Readonly<{
  definition: WorkflowDefinition;
  editingEdgeId: string | null;
  selectedEdgeIds: readonly string[];
  selectedNodeId: string | null;
}> {
  const selectedEdge = selectedEdgeId
    ? (definition.edges.find((edge) => edge.id === selectedEdgeId) ?? null)
    : null;
  const selectedNode = selectedNodeId
    ? (definition.nodes.find((candidate) => candidate.id === selectedNodeId) ??
      null)
    : null;

  if (selectedEdge) {
    return insertWorkflowNodeAtEdge(definition, node, selectedEdge);
  }

  if (selectedNode) {
    return insertWorkflowNodeAfterNode(definition, node, selectedNode);
  }

  return {
    definition: { ...definition, nodes: [...definition.nodes, node] },
    editingEdgeId: null,
    selectedEdgeIds: [],
    selectedNodeId: node.id,
  };
}

function insertWorkflowNodeAtEdge(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  edge: WorkflowEdge,
): Readonly<{
  definition: WorkflowDefinition;
  editingEdgeId: string | null;
  selectedEdgeIds: readonly string[];
  selectedNodeId: string | null;
}> {
  if (!isWorkflowNodeInputConnectable(node)) {
    return {
      definition,
      editingEdgeId: null,
      selectedEdgeIds: [edge.id],
      selectedNodeId: null,
    };
  }

  if (!isWorkflowNodeOutputConnectable(node)) {
    const incomingEdge = createWorkflowEdge(edge.source, node.id, {});

    return {
      definition: {
        ...definition,
        edges: [...definition.edges, incomingEdge],
        nodes: [...definition.nodes, node],
      },
      editingEdgeId: null,
      selectedEdgeIds: [],
      selectedNodeId: node.id,
    };
  }

  const incomingEdge = createWorkflowEdge(edge.source, node.id, edge.data);
  const outgoingEdge = createWorkflowEdge(
    node.id,
    edge.target,
    readInsertedOutgoingEdgeData(node, edge),
  );
  const shouldEditOutgoingEdge = isExclusiveGatewaySourceEdge(outgoingEdge, [
    ...definition.nodes,
    node,
  ]);

  return {
    definition: {
      ...definition,
      edges: definition.edges.flatMap((currentEdge) =>
        currentEdge.id === edge.id
          ? [incomingEdge, outgoingEdge]
          : [currentEdge],
      ),
      nodes: [...definition.nodes, node],
    },
    editingEdgeId: shouldEditOutgoingEdge ? outgoingEdge.id : null,
    selectedEdgeIds: shouldEditOutgoingEdge ? [outgoingEdge.id] : [],
    selectedNodeId: shouldEditOutgoingEdge ? null : node.id,
  };
}

function insertWorkflowNodeAfterNode(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  sourceNode: WorkflowNode,
): Readonly<{
  definition: WorkflowDefinition;
  editingEdgeId: string | null;
  selectedEdgeIds: readonly string[];
  selectedNodeId: string | null;
}> {
  if (!isWorkflowNodeOutputConnectable(sourceNode)) {
    return {
      definition: { ...definition, nodes: [...definition.nodes, node] },
      editingEdgeId: null,
      selectedEdgeIds: [],
      selectedNodeId: node.id,
    };
  }

  const firstOutgoingEdge =
    definition.edges.find((edge) => edge.source === sourceNode.id) ?? null;

  if (firstOutgoingEdge && isWorkflowNodeOutputConnectable(node)) {
    return insertWorkflowNodeAtEdge(definition, node, firstOutgoingEdge);
  }

  const endNode = definition.nodes.find(
    (candidate) => candidate.type === 'endEvent',
  );

  if (
    endNode &&
    sourceNode.id !== endNode.id &&
    isWorkflowNodeOutputConnectable(node)
  ) {
    const incomingEdge = createWorkflowEdge(sourceNode.id, node.id, {});
    const outgoingEdge = createWorkflowEdge(
      node.id,
      endNode.id,
      readInsertedOutgoingEdgeData(node, incomingEdge),
    );
    const shouldEditOutgoingEdge = isExclusiveGatewaySourceEdge(outgoingEdge, [
      ...definition.nodes,
      node,
    ]);

    return {
      definition: {
        ...definition,
        edges: [...definition.edges, incomingEdge, outgoingEdge],
        nodes: [...definition.nodes, node],
      },
      editingEdgeId: shouldEditOutgoingEdge ? outgoingEdge.id : null,
      selectedEdgeIds: shouldEditOutgoingEdge ? [outgoingEdge.id] : [],
      selectedNodeId: shouldEditOutgoingEdge ? null : node.id,
    };
  }

  const incomingEdge = createWorkflowEdge(sourceNode.id, node.id, {});

  return {
    definition: {
      ...definition,
      edges: [...definition.edges, incomingEdge],
      nodes: [...definition.nodes, node],
    },
    editingEdgeId: null,
    selectedEdgeIds: [],
    selectedNodeId: node.id,
  };
}

function createWorkflowEdge(
  source: string,
  target: string,
  data: WorkflowEdgeData,
): WorkflowEdge {
  return {
    data,
    id: `edge_${source}_${target}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    source,
    sourceHandle: WORKFLOW_OUTPUT_HANDLE_ID,
    target,
    targetHandle: WORKFLOW_INPUT_HANDLE_ID,
    type: 'smoothstep',
  };
}

function readInsertedOutgoingEdgeData(
  node: WorkflowNode,
  _replacedEdge: WorkflowEdge,
): WorkflowEdgeData {
  if (node.type === 'exclusiveGateway') {
    return { isDefault: true, label: '其他情況' };
  }

  return {};
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

function readInitiatorPolicyMode(
  value: string | null,
): Exclude<InitiatorPolicyMode, 'CUSTOM'> {
  if (value === 'ROLE' || value === 'ORG' || value === 'NONE') {
    return value;
  }

  return 'ALL';
}

function readInitiatorPolicyValueOptions(
  options: readonly InitiatorPolicyValueOption[],
  value: string,
): readonly InitiatorPolicyValueOption[] {
  const trimmedValue = value.trim();

  return trimmedValue && !options.some((option) => option.id === trimmedValue)
    ? [{ id: trimmedValue, name: trimmedValue }, ...options]
    : options;
}

function insertFreeTextOption(
  text: string,
  currentOptions: InitiatorPolicyValueOption[],
): InitiatorPolicyValueOption[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return currentOptions;
  }

  return currentOptions.some((option) => option.id === trimmedText)
    ? currentOptions
    : [{ id: trimmedText, name: trimmedText }, ...currentOptions];
}

function readInitiatorPolicyDraft(
  initiatorPolicyCel: string | null,
): InitiatorPolicyDraft {
  const expression = initiatorPolicyCel?.trim();

  if (!expression) {
    return { mode: 'ALL', value: '' };
  }

  const roleValue = readCelStringOperand(
    expression,
    /^(.+) in subject\.roles$/u,
  );

  if (roleValue !== null) {
    return { mode: 'ROLE', value: roleValue };
  }

  const orgValue = readCelStringOperand(
    expression,
    /^subject\.org\.code == (.+)$/u,
  );

  if (orgValue !== null) {
    return { mode: 'ORG', value: orgValue };
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
    : { mode: modeDraft, value: '' };
}

function readInitiatorPolicyIssue(
  policyDraft: InitiatorPolicyDraft,
): string | null {
  if (policyDraft.mode === 'NONE') {
    return '發起權限需要選擇誰可以發起。';
  }

  if (policyDraft.mode === 'ROLE' && !policyDraft.value.trim()) {
    return '指定角色發起時，需要填寫角色代碼。';
  }

  if (policyDraft.mode === 'ORG' && !policyDraft.value.trim()) {
    return '指定組織發起時，需要填寫組織代碼。';
  }

  return null;
}

function readCelStringOperand(
  expression: string,
  pattern: RegExp,
): string | null {
  const match = expression.match(pattern);
  const literal = match?.[1]?.trim();

  if (!literal) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(literal) as unknown;

    return typeof parsedValue === 'string' ? parsedValue : null;
  } catch {
    const singleQuotedValue = literal.match(/^'([^']*)'$/u)?.[1];

    return singleQuotedValue ?? null;
  }
}

function readInitiatorPolicyCel(
  draft: Readonly<{
    mode: Exclude<InitiatorPolicyMode, 'CUSTOM'>;
    value: string;
  }>,
): string | null {
  const value = draft.value.trim();

  if (draft.mode === 'ALL' || draft.mode === 'NONE') {
    return null;
  }

  if (!value) {
    return null;
  }

  if (draft.mode === 'ROLE') {
    return `${JSON.stringify(value)} in subject.roles`;
  }

  return `subject.org.code == ${JSON.stringify(value)}`;
}

function readInitiatorPolicySummary(policyDraft: InitiatorPolicyDraft): string {
  if (policyDraft.mode === 'NONE') {
    return '未設定';
  }

  if (policyDraft.mode === 'ROLE') {
    return policyDraft.value ? `角色：${policyDraft.value}` : '指定角色';
  }

  if (policyDraft.mode === 'ORG') {
    return policyDraft.value ? `組織：${policyDraft.value}` : '指定組織';
  }

  if (policyDraft.mode === 'CUSTOM') {
    return '既有自訂規則';
  }

  return '所有人';
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
    name: option.email,
  }));
}

function readFallbackMemberSelectOption(memberId: string): MemberSelectOption {
  return {
    displayName: memberId,
    email: memberId,
    id: memberId,
    memberId,
    name: memberId,
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

function readPrimaryMemberOption(
  memberIds: readonly string[],
  memberOptions: readonly MemberSelectOption[],
): MemberSelectOption | null {
  const memberId = memberIds[0];

  return memberId ? readMemberSelectOption(memberOptions, memberId) : null;
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
): string | null {
  if (node.type === 'userTask') {
    return node.data.approverResolver.type === 'DIRECT'
      ? readMemberEmailSummary(
          node.data.approverResolver.memberIds,
          memberOptions,
          '未指定簽核者',
        )
      : null;
  }

  return null;
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
        (memberId) => readMemberSelectOption(memberOptions, memberId).email,
      );
}

function readMemberEmailSummary(
  memberIds: readonly string[],
  memberOptions: readonly MemberSelectOption[],
  emptyLabel: string,
): string {
  const memberLabels = memberIds.map(
    (memberId) => readMemberSelectOption(memberOptions, memberId).email,
  );

  if (memberLabels.length === 0) {
    return emptyLabel;
  }

  if (memberLabels.length <= 2) {
    return memberLabels.join('、');
  }

  return `${memberLabels.slice(0, 2).join('、')} 等 ${memberLabels.length} 人`;
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

  if (incompleteNotifyNode) {
    return '知會節點需要至少一位知會對象。';
  }

  if (incompleteConditionEdge) {
    return '條件分流的每條輸出連線都需要先設定條件。';
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

function readNextConditionOperator(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | null,
): WorkflowEdgeConditionOperator | undefined {
  if (!field) {
    return undefined;
  }

  const operatorIds = readConditionOperatorIds(field);

  return operator && operatorIds.includes(operator) ? operator : operatorIds[0];
}

function readNextConditionValue(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | null,
): string | undefined {
  if (!field || !operator || !shouldConditionOperatorUseValue(operator)) {
    return undefined;
  }

  const valueOptions = readConditionValueOptions(field);

  if (valueOptions.length === 0) {
    return value ?? undefined;
  }

  return valueOptions.some((option) => option.id === value)
    ? (value ?? undefined)
    : valueOptions[0]?.id;
}

function shouldConditionOperatorUseValue(
  operator: WorkflowEdgeConditionOperator,
): boolean {
  return CONDITION_OPERATORS_REQUIRING_VALUE.includes(operator);
}

function readConditionLabel(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | undefined,
): string | undefined {
  if (!field || !operator) {
    return undefined;
  }

  const operatorLabel = readConditionOperatorLabel(operator);

  if (!shouldConditionOperatorUseValue(operator)) {
    return `${field.label} ${operatorLabel}`;
  }

  if (!value) {
    return undefined;
  }

  return `${field.label} ${operatorLabel} ${readConditionValueLabel(
    field,
    value,
  )}`;
}

function readConditionOperatorLabel(
  operator: WorkflowEdgeConditionOperator,
): string {
  return (
    CONDITION_OPERATOR_OPTIONS.find((option) => option.id === operator)?.name ??
    operator
  );
}

function readConditionValueLabel(
  field: FormFieldDefinition,
  value: string,
): string {
  if (field.type === 'boolean') {
    return value === 'true' ? '是' : '否';
  }

  if (
    field.type === 'checkbox' ||
    field.type === 'radio' ||
    field.type === 'select'
  ) {
    return readFormFieldOption(field.options, value)?.label ?? value;
  }

  return value;
}

function readFormFieldOption(
  options: readonly FormFieldOption[],
  value: string,
): FormFieldOption | null {
  return options.find((option) => option.value === value) ?? null;
}

function readConditionExpression(
  field: FormFieldDefinition | null,
  operator: WorkflowEdgeConditionOperator | undefined,
  value: string | undefined,
): string | undefined {
  if (!field || !operator) {
    return undefined;
  }

  const fieldReference = readFormFieldReference(field.fieldKey);

  if (operator === 'IS_FILLED') {
    return `${fieldReference} != null && ${fieldReference} != ""`;
  }

  if (operator === 'IS_EMPTY') {
    return `${fieldReference} == null || ${fieldReference} == ""`;
  }

  if (!value) {
    return undefined;
  }

  return `${fieldReference} ${readConditionExpressionOperator(
    operator,
  )} ${readConditionExpressionValue(field, value)}`;
}

function readFormFieldReference(fieldKey: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(fieldKey)
    ? `form.${fieldKey}`
    : `form[${JSON.stringify(fieldKey)}]`;
}

function readConditionExpressionOperator(
  operator: WorkflowEdgeConditionOperator,
): string {
  if (operator === 'EQUALS') {
    return '==';
  }

  if (operator === 'NOT_EQUALS') {
    return '!=';
  }

  if (operator === 'GREATER_THAN') {
    return '>';
  }

  if (operator === 'GREATER_THAN_OR_EQUALS') {
    return '>=';
  }

  if (operator === 'LESS_THAN') {
    return '<';
  }

  return '<=';
}

function readConditionExpressionValue(
  field: FormFieldDefinition,
  value: string,
): string {
  if (field.type === 'boolean') {
    return value === 'true' ? 'true' : 'false';
  }

  if (field.type === 'money' || field.type === 'number') {
    return Number.isFinite(Number(value)) ? value : JSON.stringify(value);
  }

  return JSON.stringify(value);
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
