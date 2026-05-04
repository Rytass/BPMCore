'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Background,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlow,
  applyNodeChanges,
  Connection,
} from '@xyflow/react';
import * as dagre from 'dagre';
import {
  Button,
  FormField,
  Input,
  Layout,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';
import {
  CheckedIcon,
  DotGridIcon,
  PlusIcon,
  SaveIcon,
} from '@mezzanine-ui/icons';
import {
  DecisionPolicy,
  GatewayDirection,
  ServiceAction,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@bpm/shared/workflow';
import { renderAppNavigation } from '../../../app-navigation';
import {
  ApprovalTemplateVersionRecord,
  forkApprovalTemplate,
  publishApprovalTemplateVersion,
  readTemplateDesigner,
  TemplateDesignerRecord,
  updateApprovalTemplateDraft,
} from '../../_lib/template-api';

type DesignerTab = 'workflow' | 'edge';
type FlowNodeData = Readonly<{
  label: string;
  nodeKind: WorkflowNode['type'];
}>;
type FlowNode = Node<FlowNodeData, WorkflowNode['type']>;
type FlowEdgeData = Readonly<{
  condition?: string;
  isDefault?: boolean;
  label?: string;
}>;
type FlowEdge = Edge<FlowEdgeData>;
type NodePaletteType =
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'serviceTask'
  | 'userTask';
type SimpleDecisionPolicyType = Extract<
  DecisionPolicy['type'],
  'PARALLEL_ALL' | 'SEQUENTIAL' | 'SINGLE'
>;

const WORKSPACE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const HEADER_ACTIONS_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
};

const TWO_COLUMN_STYLE: CSSProperties = {
  alignItems: 'start',
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'minmax(0, 1fr) 360px',
};

const FLOW_CANVAS_STYLE: CSSProperties = {
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 6,
  height: 620,
  minWidth: 0,
  overflow: 'hidden',
};

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const FORM_STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const NODE_STYLE: CSSProperties = {
  background: 'var(--mzn-color-bg-surface)',
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 6,
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
  minWidth: 132,
  padding: '10px 12px',
  textAlign: 'center',
};

const GATEWAY_NODE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  borderRadius: 2,
  transform: 'rotate(45deg)',
};

const GATEWAY_LABEL_STYLE: CSSProperties = {
  display: 'block',
  transform: 'rotate(-45deg)',
};

const NODE_TYPE_LABELS: Readonly<Record<WorkflowNode['type'], string>> = {
  endEvent: '結束',
  exclusiveGateway: 'XOR',
  parallelGateway: 'AND',
  serviceTask: '系統',
  startEvent: '開始',
  userTask: '簽核',
};

const PALETTE: readonly {
  readonly label: string;
  readonly type: NodePaletteType;
}[] = [
  { label: '簽核節點', type: 'userTask' },
  { label: '知會節點', type: 'serviceTask' },
  { label: 'XOR Gateway', type: 'exclusiveGateway' },
  { label: 'AND Gateway', type: 'parallelGateway' },
];
const DECISION_POLICY_OPTIONS: readonly {
  readonly id: SimpleDecisionPolicyType;
  readonly name: string;
}[] = [
  { id: 'SINGLE', name: '單人簽核' },
  { id: 'SEQUENTIAL', name: '依序簽核' },
  { id: 'PARALLEL_ALL', name: '全數同意' },
];
const GATEWAY_DIRECTION_OPTIONS: readonly {
  readonly id: GatewayDirection;
  readonly name: string;
}[] = [
  { id: 'split', name: '分流' },
  { id: 'join', name: '合流' },
];

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
  const [activeTab, setActiveTab] = useState<DesignerTab>('workflow');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('start');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect((): void => {
    void refreshDesigner();
  }, [templateId]);

  const selectedNode = useMemo(
    (): WorkflowNode | null =>
      workflowDefinition.nodes.find((node) => node.id === selectedNodeId) ??
      workflowDefinition.nodes[0] ??
      null,
    [selectedNodeId, workflowDefinition.nodes],
  );
  const selectedEdge = useMemo(
    (): WorkflowEdge | null =>
      workflowDefinition.edges.find((edge) => edge.id === selectedEdgeId) ??
      workflowDefinition.edges[0] ??
      null,
    [selectedEdgeId, workflowDefinition.edges],
  );
  const flowNodes = useMemo(
    (): FlowNode[] => workflowDefinition.nodes.map(readFlowNode),
    [workflowDefinition.nodes],
  );
  const flowEdges = useMemo(
    (): FlowEdge[] => workflowDefinition.edges.map(readFlowEdge),
    [workflowDefinition.edges],
  );
  const formVersionOptions = useMemo(
    (): readonly { readonly id: string; readonly name: string }[] =>
      (record?.formVersions ?? []).map((option) => ({
        id: option.id,
        name: option.label,
      })),
    [record?.formVersions],
  );
  const edgeOptions = useMemo(
    (): readonly { readonly id: string; readonly name: string }[] =>
      workflowDefinition.edges.map((edge) => ({
        id: edge.id,
        name: readEdgeLabel(edge),
      })),
    [workflowDefinition.edges],
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
      setWorkflowDefinition(
        sourceVersion?.workflowDefinition ?? readFallbackWorkflowDefinition(),
      );
      setFormDefinitionVersionId(
        sourceVersion?.formDefinitionVersionId ??
          nextRecord.formVersions[0]?.id ??
          null,
      );
      setInitiatorPolicyCel(sourceVersion?.initiatorPolicyCel ?? null);
      setSelectedNodeId(
        sourceVersion?.workflowDefinition.nodes[0]?.id ?? 'start',
      );
      setSelectedEdgeId(sourceVersion?.workflowDefinition.edges[0]?.id ?? null);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft(): Promise<ApprovalTemplateVersionRecord> {
    setSaving(true);
    setError(null);

    try {
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
    if (!connection.source || !connection.target) {
      return;
    }

    const nextEdge: WorkflowEdge = {
      data: {},
      id: `edge_${connection.source}_${connection.target}_${Date.now()}`,
      source: connection.source,
      target: connection.target,
      type: 'smoothstep',
    };

    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      edges: [...currentDefinition.edges, nextEdge],
    }));
    setSelectedEdgeId(nextEdge.id);
  }

  function addWorkflowNode(type: NodePaletteType): void {
    const nodeIndex =
      workflowDefinition.nodes.filter((node) => node.type === type).length + 1;
    const node = createWorkflowNode(type, nodeIndex);
    const previousEdge = workflowDefinition.edges.find(
      (edge) => edge.source === 'start' && edge.target === 'end',
    );
    const nextEdges = previousEdge
      ? [
          ...workflowDefinition.edges.filter(
            (edge) => edge.id !== previousEdge.id,
          ),
          {
            data: {},
            id: `edge_start_${node.id}`,
            source: 'start',
            target: node.id,
            type: 'smoothstep' as const,
          },
          {
            data: {},
            id: `edge_${node.id}_end`,
            source: node.id,
            target: 'end',
            type: 'smoothstep' as const,
          },
        ]
      : workflowDefinition.edges;

    setWorkflowDefinition({
      ...workflowDefinition,
      edges: nextEdges,
      nodes: [...workflowDefinition.nodes, node],
    });
    setSelectedNodeId(node.id);
  }

  function updateSelectedNodeLabel(label: string): void {
    if (!selectedNode) {
      return;
    }

    updateNode(selectedNode.id, (node) => renameWorkflowNode(node, label));
  }

  function updateUserTaskResolver(value: string): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    const memberIds = value
      .split(/[\n,]/u)
      .map((memberId) => memberId.trim())
      .filter(Boolean);

    updateNode(selectedNode.id, (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              approverResolver: {
                memberIds,
                type: 'DIRECT',
              },
            },
          }
        : node,
    );
  }

  function updateUserTaskDecisionPolicy(type: SimpleDecisionPolicyType): void {
    if (!selectedNode || selectedNode.type !== 'userTask') {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      node.type === 'userTask'
        ? {
            ...node,
            data: {
              ...node.data,
              decisionPolicy: { type },
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

  function updateGatewayDirection(direction: GatewayDirection): void {
    if (
      !selectedNode ||
      (selectedNode.type !== 'exclusiveGateway' &&
        selectedNode.type !== 'parallelGateway')
    ) {
      return;
    }

    updateNode(selectedNode.id, (node) =>
      node.type === 'exclusiveGateway' || node.type === 'parallelGateway'
        ? {
            ...node,
            data: {
              ...node.data,
              direction,
            },
          }
        : node,
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

  function updateSelectedEdge(
    updater: (edge: WorkflowEdge) => WorkflowEdge,
  ): void {
    const targetEdge = selectedEdge;

    if (!targetEdge) {
      return;
    }

    setWorkflowDefinition((currentDefinition) => ({
      ...currentDefinition,
      edges: currentDefinition.edges.map((edge) =>
        edge.id === targetEdge.id ? updater(edge) : edge,
      ),
    }));
  }

  function applyAutoLayout(): void {
    setWorkflowDefinition((currentDefinition) =>
      layoutWorkflowDefinition(currentDefinition),
    );
  }

  return (
    <Layout>
      {renderAppNavigation('/templates')}

      <Layout.Main>
        <SectionGroup>
          <Section>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <Typography component="h1" variant="h2">
                  {record?.template.name ?? '流程設計器'}
                </Typography>
                <Typography color="text-neutral" variant="body">
                  {draft ? `草稿 v${draft.version}` : '尚未建立草稿'} ·
                  {record?.template.currentVersionId
                    ? ' 已發布版本'
                    : ' 尚未發布'}
                </Typography>
              </div>
              <div style={HEADER_ACTIONS_STYLE}>
                <Button
                  onClick={(): void => router.push('/templates')}
                  variant="base-secondary"
                >
                  返回列表
                </Button>
                <Button
                  disabled={saving}
                  icon={SaveIcon}
                  iconType="leading"
                  onClick={(): void => void handleSaveDraft()}
                  variant="base-secondary"
                >
                  儲存草稿
                </Button>
                <Button
                  disabled={saving}
                  icon={CheckedIcon}
                  iconType="leading"
                  onClick={(): void => void handlePublish()}
                  variant="base-primary"
                >
                  發布版本
                </Button>
              </div>
            </div>
          </Section>

          <Section>
            <div style={WORKSPACE_STYLE}>
              {error ? (
                <Typography color="text-error" variant="body">
                  {error}
                </Typography>
              ) : null}
              <div style={FORM_STACK_STYLE}>
                <FormField
                  density={FormFieldDensity.WIDE}
                  fullWidth
                  label="綁定表單版本"
                  layout={FormFieldLayout.STRETCH}
                  name="formDefinitionVersionId"
                  required
                >
                  <Select
                    disabled={loading}
                    fullWidth
                    onChange={(option): void =>
                      setFormDefinitionVersionId(option?.id ?? null)
                    }
                    options={[...formVersionOptions]}
                    placeholder="選擇已發布表單版本"
                    value={readSelectOption(
                      formVersionOptions,
                      formDefinitionVersionId,
                    )}
                  />
                </FormField>
                <FormField
                  density={FormFieldDensity.WIDE}
                  fullWidth
                  label="發起權限 CEL"
                  layout={FormFieldLayout.STRETCH}
                  name="initiatorPolicyCel"
                >
                  <Input
                    fullWidth
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      setInitiatorPolicyCel(event.target.value || null)
                    }
                    placeholder="例如：subject.org.code == 'HQ'"
                    value={initiatorPolicyCel ?? ''}
                    variant="base"
                  />
                </FormField>
              </div>
              <Tab
                activeKey={activeTab}
                onChange={(key): void => setActiveTab(key as DesignerTab)}
                size="sub"
              >
                <TabItem key="workflow">流程</TabItem>
                <TabItem key="edge">連線</TabItem>
              </Tab>

              {activeTab === 'workflow' ? (
                <div style={TWO_COLUMN_STYLE}>
                  <div style={FLOW_CANVAS_STYLE}>
                    <ReactFlow
                      edges={flowEdges}
                      fitView
                      nodeTypes={nodeTypes}
                      nodes={flowNodes}
                      onConnect={handleConnect}
                      onNodeClick={(_, node): void =>
                        setSelectedNodeId(node.id)
                      }
                      onNodesChange={handleNodeChanges}
                    >
                      <Background />
                      <Controls />
                      <MiniMap />
                    </ReactFlow>
                  </div>
                  <div style={PANEL_STYLE}>
                    <Typography component="h2" variant="h3">
                      流程工具
                    </Typography>
                    <div style={BUTTON_ROW_STYLE}>
                      {PALETTE.map((item) => (
                        <Button
                          icon={PlusIcon}
                          iconType="leading"
                          key={item.type}
                          onClick={(): void => addWorkflowNode(item.type)}
                          size="sub"
                          variant="base-secondary"
                        >
                          {item.label}
                        </Button>
                      ))}
                      <Button
                        icon={DotGridIcon}
                        iconType="leading"
                        onClick={applyAutoLayout}
                        size="sub"
                        variant="base-secondary"
                      >
                        自動排版
                      </Button>
                    </div>
                    {selectedNode ? renderNodePanel(selectedNode) : null}
                  </div>
                </div>
              ) : (
                renderEdgePanel(selectedEdge, edgeOptions)
              )}
            </div>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );

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
        {node.type === 'userTask' ? renderUserTaskPanel(node) : null}
        {node.type === 'serviceTask' ? renderServiceTaskPanel(node) : null}
        {node.type === 'exclusiveGateway' || node.type === 'parallelGateway'
          ? renderGatewayPanel(node)
          : null}
      </div>
    );
  }

  function renderUserTaskPanel(
    node: Extract<WorkflowNode, { type: 'userTask' }>,
  ): ReactElement {
    const resolver = node.data.approverResolver;
    const memberIds =
      resolver.type === 'DIRECT' ? resolver.memberIds.join('\n') : '';

    return (
      <>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="簽核者 member id"
          layout={FormFieldLayout.STRETCH}
          name="memberIds"
          required
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateUserTaskResolver(event.target.value)
            }
            placeholder="member-001"
            value={memberIds}
            variant="base"
          />
        </FormField>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="簽核策略"
          layout={FormFieldLayout.STRETCH}
          name="decisionPolicy"
          required
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void =>
              updateUserTaskDecisionPolicy(
                (option?.id as SimpleDecisionPolicyType | undefined) ??
                  'SINGLE',
              )
            }
            options={[...DECISION_POLICY_OPTIONS]}
            value={readSelectOption(
              DECISION_POLICY_OPTIONS,
              node.data.decisionPolicy.type,
            )}
          />
        </FormField>
      </>
    );
  }

  function renderServiceTaskPanel(
    node: Extract<WorkflowNode, { type: 'serviceTask' }>,
  ): ReactElement {
    return (
      <FormField
        density={FormFieldDensity.WIDE}
        fullWidth
        label="知會對象 member id"
        layout={FormFieldLayout.STRETCH}
        name="notifyMemberId"
      >
        <Input
          fullWidth
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            updateServiceAction({
              channels: ['IN_APP'],
              recipients: {
                memberIds: event.target.value
                  .split(/[\n,]/u)
                  .map((memberId) => memberId.trim())
                  .filter(Boolean),
                type: 'DIRECT',
              },
              type: 'NOTIFY',
            })
          }
          value={readServiceTaskMemberIds(node.data.action).join('\n')}
          variant="base"
        />
      </FormField>
    );
  }

  function renderGatewayPanel(
    node: Extract<
      WorkflowNode,
      { type: 'exclusiveGateway' | 'parallelGateway' }
    >,
  ): ReactElement {
    return (
      <FormField
        density={FormFieldDensity.WIDE}
        fullWidth
        label="Gateway 方向"
        layout={FormFieldLayout.STRETCH}
        name="gatewayDirection"
        required
      >
        <Select
          clearable={false}
          fullWidth
          onChange={(option): void =>
            updateGatewayDirection(option?.id === 'join' ? 'join' : 'split')
          }
          options={[...GATEWAY_DIRECTION_OPTIONS]}
          value={readSelectOption(
            GATEWAY_DIRECTION_OPTIONS,
            node.data.direction,
          )}
        />
      </FormField>
    );
  }

  function renderEdgePanel(
    edge: WorkflowEdge | null,
    options: readonly { readonly id: string; readonly name: string }[],
  ): ReactElement {
    if (!edge) {
      return (
        <Typography color="text-neutral" variant="body">
          目前沒有連線。
        </Typography>
      );
    }

    return (
      <div style={FORM_STACK_STYLE}>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="連線"
          layout={FormFieldLayout.STRETCH}
          name="edgeId"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void =>
              setSelectedEdgeId(option?.id ?? edge.id)
            }
            options={[...options]}
            value={readSelectOption(options, edge.id)}
          />
        </FormField>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="顯示文字"
          layout={FormFieldLayout.STRETCH}
          name="edgeLabel"
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedEdge((currentEdge) => ({
                ...currentEdge,
                data: {
                  ...currentEdge.data,
                  label: event.target.value || undefined,
                },
              }))
            }
            value={edge.data.label ?? ''}
            variant="base"
          />
        </FormField>
        <FormField
          density={FormFieldDensity.WIDE}
          fullWidth
          label="條件 CEL"
          layout={FormFieldLayout.STRETCH}
          name="edgeCondition"
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              updateSelectedEdge((currentEdge) => ({
                ...currentEdge,
                data: {
                  ...currentEdge.data,
                  condition: event.target.value || undefined,
                },
              }))
            }
            placeholder="例如：form.amount > 1000"
            value={edge.data.condition ?? ''}
            variant="base"
          />
        </FormField>
        <Toggle
          checked={Boolean(edge.data.isDefault)}
          label="設為 default flow"
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            updateSelectedEdge((currentEdge) => ({
              ...currentEdge,
              data: {
                ...currentEdge.data,
                isDefault: event.target.checked,
              },
            }))
          }
        />
      </div>
    );
  }
}

function WorkflowNodeCard({ data, type }: NodeProps<FlowNode>): ReactElement {
  const isGateway = type === 'exclusiveGateway' || type === 'parallelGateway';

  return (
    <div style={isGateway ? GATEWAY_NODE_STYLE : NODE_STYLE}>
      <Handle position={Position.Left} type="target" />
      <Typography
        component="span"
        style={isGateway ? GATEWAY_LABEL_STYLE : undefined}
        variant="label-primary"
      >
        {data.label}
      </Typography>
      <Typography
        color="text-neutral"
        component="span"
        display="block"
        style={isGateway ? GATEWAY_LABEL_STYLE : undefined}
        variant="caption"
      >
        {NODE_TYPE_LABELS[data.nodeKind]}
      </Typography>
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function readFlowNode(node: WorkflowNode): FlowNode {
  return {
    data: {
      label: node.data.label,
      nodeKind: node.type,
    },
    id: node.id,
    position: node.position,
    type: node.type,
  };
}

function readFlowEdge(edge: WorkflowEdge): FlowEdge {
  return {
    data: edge.data,
    id: edge.id,
    label: edge.data.label,
    source: edge.source,
    target: edge.target,
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
        },
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
      },
      type,
    };
  }

  return {
    ...base,
    data: {
      direction: 'split',
      label: type === 'exclusiveGateway' ? `XOR ${index}` : `AND ${index}`,
    },
    type,
  };
}

function readFallbackWorkflowDefinition(): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_end',
        source: 'start',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 560, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function layoutWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: 120 });
  definition.nodes.forEach((node): void => {
    graph.setNode(node.id, { height: 64, width: 160 });
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
              x: positionedNode.x - 80,
              y: positionedNode.y - 32,
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

function readEdgeLabel(edge: WorkflowEdge): string {
  return edge.data.label ?? `${edge.source} → ${edge.target}`;
}

function readServiceTaskMemberIds(action: ServiceAction): readonly string[] {
  return action.type === 'NOTIFY' && action.recipients.type === 'DIRECT'
    ? action.recipients.memberIds
    : [];
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
