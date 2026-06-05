'use client';

import {
  CSSProperties,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from '@xyflow/react';
import * as dagre from 'dagre';
import {
  Button,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import {
  CheckedIcon,
  DangerousOutlineIcon,
  NotificationUnreadIcon,
  PlusIcon,
  RefreshCcwIcon,
  ShareIcon,
  UserIcon,
} from '@mezzanine-ui/icons';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  focusFormRendererField,
  validateFormRendererValues,
} from '@rytass/bpm-core-client/form';
import {
  ActivityLogRecord,
  AdhocDirectiveRecord,
  AttachmentRecord,
  ApprovalInstanceRecord,
  MemberProfileRecord,
  SignatureRecord,
  SignatureVerificationRecord,
  cancelApprovalInstance,
  listAdhocDirectives,
  listAttachments,
  readApprovalInstance,
  readAttachmentDownloadUrl,
  readAttachmentPreviewUrl,
  readInstanceSignatures,
  resubmitApprovalInstance,
  TaskDecisionRecord,
  TaskRecord,
  WorkflowFormData,
  WorkflowTokenRecord,
  uploadAttachment,
} from '@rytass/bpm-core-client/workflow';
import { BPMFormField } from '../../../components/bpm-form-field';
import { formatDateTime } from '../../../lib/format-date-time';
import { useAuth } from '../../../lib/auth-provider';
import { PDFPreview } from '../../../components/pdf-preview';
import {
  canMemberActOnTask,
  readErrorMessage,
  readInstanceStateLabel,
  readLatestTaskDecisionsByTaskId,
  readMemberProfilesForTimeline,
  readNodeRuntimeState,
  readTaskDecisionsForTasks,
} from './sections/container-helpers';
import { InstanceFormSection } from './sections/InstanceFormSection';
import { InstanceAttachmentsSection } from './sections/InstanceAttachmentsSection';
import {
  InstanceTasksSection,
  type InstanceTasksSectionHandle,
} from './sections/InstanceTasksSection';
import { InstanceSignaturesSection } from './sections/InstanceSignaturesSection';
import { InstanceHistorySection } from './sections/InstanceHistorySection';

const FLOW_NODE_LAYOUT_WIDTH = 184;
const FLOW_NODE_LAYOUT_HEIGHT = 96;

const FLOW_MODAL_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const FLOW_CANVAS_STYLE: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  height: 'min(64vh, 620px)',
  minHeight: 440,
  overflow: 'hidden',
  width: 'min(80vw, 1040px)',
};

const NODE_STYLE: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.08)',
  display: 'grid',
  gap: 6,
  minHeight: 82,
  padding: 12,
  width: 184,
};

const NODE_STATUS_STYLE: CSSProperties = {
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  justifySelf: 'start',
  lineHeight: '18px',
  padding: '0 8px',
};

const NODE_SECONDARY_STYLE: CSSProperties = {
  color: '#64748b',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const NODE_HANDLE_STYLE: CSSProperties = {
  opacity: 0,
};

const EDGE_SUMMARY_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const EDGE_SUMMARY_ITEM_STYLE: CSSProperties = {
  alignItems: 'center',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  color: '#334155',
  display: 'inline-flex',
  fontSize: 12,
  fontWeight: 600,
  gap: 6,
  lineHeight: '20px',
  padding: '4px 8px',
};

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const READONLY_FLOW_NODE_TYPES = {
  workflowRuntime: WorkflowRuntimeNodeCard,
};

type RuntimeTone =
  | 'cancelled'
  | 'completed'
  | 'current'
  | 'neutral'
  | 'waiting';

interface RuntimeNodeData extends Record<string, unknown> {
  readonly kindLabel: string;
  readonly label: string;
  readonly secondaryLabel: string;
  readonly statusLabel: string;
  readonly tone: RuntimeTone;
}

type RuntimeFlowNode = FlowNode<RuntimeNodeData, 'workflowRuntime'>;
type RuntimeFlowEdge = FlowEdge<
  Readonly<Record<string, unknown>>,
  'smoothstep'
>;

export interface InstanceDetailViewProps {
  /** Approval instance id (Next.js `params.id` resolved by the page shim). */
  readonly instanceId: string;
  /** Show the form snapshot section (default: true). */
  readonly showForm?: boolean;
  /** Show the attachments section (default: true). */
  readonly showAttachments?: boolean;
  /** Show the tasks section (default: true). */
  readonly showTasks?: boolean;
  /** Show the signatures section (default: true). */
  readonly showSignatures?: boolean;
  /** Show the history section (default: true). */
  readonly showHistory?: boolean;
}

/**
 * Framework-agnostic view for the BPM approval instance detail page.
 * Mechanical port of `apps/client/src/app/instances/[id]/page.tsx`. The
 * `instanceId` is provided by the host page wrapper (typically resolved
 * from `params.id` in the Next.js Server Component shim).
 */
export function InstanceDetailView({
  instanceId,
  showAttachments = true,
  showForm = true,
  showHistory = true,
  showSignatures = true,
  showTasks = true,
}: InstanceDetailViewProps): ReactElement {
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [activityLogs, setActivityLogs] = useState<
    readonly ActivityLogRecord[]
  >([]);
  const [instance, setInstance] = useState<ApprovalInstanceRecord | null>(null);
  const [taskDecisions, setTaskDecisions] = useState<
    readonly TaskDecisionRecord[]
  >([]);
  const [attachments, setAttachments] = useState<readonly AttachmentRecord[]>(
    [],
  );
  const [signatures, setSignatures] = useState<readonly SignatureRecord[]>([]);
  const [signatureVerification, setSignatureVerification] =
    useState<SignatureVerificationRecord | null>(null);
  const [tasks, setTasks] = useState<readonly TaskRecord[]>([]);
  const [workflowTokens, setWorkflowTokens] = useState<
    readonly WorkflowTokenRecord[]
  >([]);
  const [memberProfiles, setMemberProfiles] = useState<
    readonly MemberProfileRecord[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [cancelComment, setCancelComment] = useState('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [resubmitFormErrors, setResubmitFormErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [resubmitFormData, setResubmitFormData] = useState<WorkflowFormData>(
    {},
  );
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [adhocDirectives, setAdhocDirectives] = useState<
    readonly AdhocDirectiveRecord[]
  >([]);

  const trimmedCancelComment = cancelComment.trim();

  // Ref to the TasksSection imperative handle, used by PageHeader buttons.
  const tasksSectionRef = useRef<InstanceTasksSectionHandle>(null);

  useEffect((): void => {
    void refreshInstance();
  }, [currentMemberId, instanceId]);

  useEffect((): void => {
    setResubmitFormData(instance?.formData ?? {});
  }, [instance]);

  // Derived from tasks (needed for PageHeader actions — read from ref for
  // deciding/hasCurrentTask, but we need these synchronously for rendering).
  const currentTask = useMemo(
    (): TaskRecord | null =>
      tasks.find(
        (task) =>
          canMemberActOnTask(task, currentMemberId) &&
          (task.status === 'PENDING' || task.status === 'IN_PROGRESS'),
      ) ?? null,
    [currentMemberId, tasks],
  );
  const currentTaskNode = useMemo(
    (): WorkflowNode | null =>
      currentTask && instance
        ? (instance.workflowSnapshot.nodes.find(
            (node) => node.id === currentTask.nodeId,
          ) ?? null)
        : null,
    [currentTask, instance],
  );
  const canReturnCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.returnBehavior.allowReturn;
  const canAddSignerCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.allowAddSigner;
  const canCancelInstance = Boolean(
    instance &&
      instance.initiatorMemberId === currentMemberId &&
      (instance.state === 'RUNNING' || instance.state === 'RETURNED'),
  );
  const canResubmitInstance = Boolean(
    instance &&
      instance.initiatorMemberId === currentMemberId &&
      instance.state === 'RETURNED',
  );
  const memberProfilesById = useMemo(
    (): ReadonlyMap<string, MemberProfileRecord> =>
      new Map(memberProfiles.map((profile) => [profile.memberId, profile])),
    [memberProfiles],
  );
  const taskDecisionsByTaskId = useMemo(
    (): ReadonlyMap<string, TaskDecisionRecord> =>
      readLatestTaskDecisionsByTaskId(taskDecisions),
    [taskDecisions],
  );
  const signaturesById = useMemo(
    (): ReadonlyMap<string, SignatureRecord> =>
      new Map(signatures.map((signature) => [signature.id, signature])),
    [signatures],
  );
  const layoutedWorkflowSnapshot = useMemo(
    (): WorkflowDefinition | null =>
      instance
        ? layoutRuntimeWorkflowDefinition(instance.workflowSnapshot)
        : null,
    [instance],
  );
  const flowNodes = useMemo(
    (): RuntimeFlowNode[] =>
      instance && layoutedWorkflowSnapshot
        ? readRuntimeFlowNodes(
            layoutedWorkflowSnapshot,
            tasks,
            workflowTokens,
            instance.state,
          )
        : [],
    [instance, layoutedWorkflowSnapshot, tasks, workflowTokens],
  );
  const flowEdges = useMemo(
    (): RuntimeFlowEdge[] =>
      layoutedWorkflowSnapshot
        ? readRuntimeFlowEdges(layoutedWorkflowSnapshot)
        : [],
    [layoutedWorkflowSnapshot],
  );
  const edgeSummaries = useMemo(
    (): readonly string[] =>
      instance ? readEdgeSummaries(instance.workflowSnapshot) : [],
    [instance],
  );

  async function refreshInstance(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const nextRecord = await readApprovalInstance(instanceId);
      setActivityLogs(nextRecord.activityLogs);
      setInstance(nextRecord.instance);
      setTasks(nextRecord.tasks);
      setWorkflowTokens(nextRecord.workflowTokens);
      const [
        nextTaskDecisions,
        nextMemberProfiles,
        nextAttachments,
        nextSignatures,
        nextAdhocDirectives,
      ] = await Promise.all([
        readTaskDecisionsForTasks(nextRecord.tasks),
        readMemberProfilesForTimeline(nextRecord),
        listAttachments(nextRecord.instance.id),
        readInstanceSignatures(nextRecord.instance.id),
        listAdhocDirectives(nextRecord.instance.id),
      ]);
      setTaskDecisions(nextTaskDecisions);
      setMemberProfiles(nextMemberProfiles);
      setAttachments(nextAttachments);
      setSignatures(nextSignatures.signatures);
      setSignatureVerification(nextSignatures.verification);
      setAdhocDirectives(nextAdhocDirectives);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadAttachment(
    field: FormFieldDefinition,
    file: File,
  ): Promise<{ readonly id: string }> {
    if (!currentMemberId) {
      throw new Error('尚未登入，無法上傳附件');
    }

    const attachment = await uploadAttachment({
      file,
      formFieldPath: `form.${field.fieldKey}`,
    });

    return { id: attachment.id };
  }

  async function handleDownloadAttachment(
    attachment: AttachmentRecord,
  ): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    const url = await readAttachmentDownloadUrl({
      id: attachment.id,
    });

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handlePreviewAttachment(
    attachment: AttachmentRecord,
  ): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    const url = await readAttachmentPreviewUrl({
      id: attachment.id,
    });

    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }

  async function handleCancelInstance(): Promise<void> {
    if (!currentMemberId || !instance || !canCancelInstance) {
      return;
    }

    setDeciding(true);
    setError(null);
    setResubmitFormErrors({});

    if (
      instance.formDefinitionSnapshot.schema &&
      instance.formDefinitionSnapshot.uiSchema
    ) {
      const validation = validateFormRendererValues({
        schema: instance.formDefinitionSnapshot.schema,
        uiSchema: instance.formDefinitionSnapshot.uiSchema,
        values: resubmitFormData,
      });

      if (!validation.valid) {
        setResubmitFormErrors(validation.errors);
        setError('請先補齊必填欄位。');

        if (validation.firstInvalidFieldKey) {
          focusFormRendererField(validation.firstInvalidFieldKey);
        }

        setDeciding(false);

        return;
      }
    }

    try {
      await cancelApprovalInstance({
        cancelledByMemberId: currentMemberId,
        comment: trimmedCancelComment || null,
        instanceId: instance.id,
      });
      setCancelComment('');
      setCancelModalOpen(false);
      await refreshInstance();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeciding(false);
    }
  }

  async function handleResubmitInstance(): Promise<void> {
    if (!currentMemberId || !instance || !canResubmitInstance) {
      return;
    }

    setDeciding(true);
    setError(null);

    try {
      await resubmitApprovalInstance({
        formData: resubmitFormData,
        initiatorMemberId: currentMemberId,
        instanceId: instance.id,
        title: instance.title,
      });
      await refreshInstance();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeciding(false);
    }
  }

  // Derive deciding/canReturn for the PageHeader from the ref handle
  // (falls back to local state for cancel/other actions).
  const taskSectionDeciding = tasksSectionRef.current?.deciding ?? false;
  const combinedDeciding = deciding || taskSectionDeciding;

  return (
    <>
      <PageHeader>
        <ContentHeader
          description={
            instance
              ? `${readInstanceStateLabel(instance.state)} · ${formatDateTime(
                  instance.startedAt,
                )}`
              : '載入案件內容。'
          }
          title={instance?.title ?? '簽核案件'}
        >
          {instance ? (
            <Button
              aria-label="查看流程圖"
              icon={ShareIcon}
              iconType="icon-only"
              onClick={(): void => setWorkflowModalOpen(true)}
              title="查看流程圖"
              variant="base-secondary"
            >
              流程圖
            </Button>
          ) : null}
          {canCancelInstance ? (
            <Button
              disabled={combinedDeciding}
              icon={DangerousOutlineIcon}
              iconType="leading"
              onClick={(): void => setCancelModalOpen(true)}
              variant="destructive-secondary"
            >
              取消案件
            </Button>
          ) : null}
          {currentTask ? (
            <>
              {canAddSignerCurrentTask ? (
                <>
                  <Button
                    disabled={combinedDeciding}
                    icon={PlusIcon}
                    iconType="leading"
                    onClick={(): void =>
                      tasksSectionRef.current?.openAdhocModal('COUNTERSIGN')
                    }
                    variant="base-secondary"
                  >
                    會簽
                  </Button>
                  <Button
                    disabled={combinedDeciding}
                    icon={PlusIcon}
                    iconType="leading"
                    onClick={(): void =>
                      tasksSectionRef.current?.openAdhocModal('PRE_APPROVAL')
                    }
                    variant="base-secondary"
                  >
                    加簽
                  </Button>
                </>
              ) : null}
              <Button
                disabled={combinedDeciding}
                icon={NotificationUnreadIcon}
                iconType="leading"
                onClick={(): void =>
                  tasksSectionRef.current?.openAdhocModal('STAGE_NOTIFY')
                }
                variant="base-secondary"
              >
                通知設定
              </Button>
              {canReturnCurrentTask ? (
                <Button
                  disabled={combinedDeciding}
                  icon={RefreshCcwIcon}
                  iconType="leading"
                  onClick={(): void => tasksSectionRef.current?.openReturnModal()}
                  variant="base-secondary"
                >
                  退回
                </Button>
              ) : null}
              <Button
                disabled={combinedDeciding}
                icon={UserIcon}
                iconType="leading"
                onClick={(): void => tasksSectionRef.current?.openTransferModal()}
                variant="base-secondary"
              >
                轉派
              </Button>
              <Button
                disabled={combinedDeciding}
                icon={DangerousOutlineIcon}
                iconType="leading"
                onClick={(): void => tasksSectionRef.current?.openRejectModal()}
                variant="destructive-secondary"
              >
                拒絕
              </Button>
              <Button
                disabled={combinedDeciding}
                icon={CheckedIcon}
                iconType="leading"
                onClick={(): void => tasksSectionRef.current?.handleApprove()}
                variant="base-primary"
              >
                同意
              </Button>
            </>
          ) : null}
        </ContentHeader>
      </PageHeader>

      <SectionGroup>
        {showForm ? (
          <Section>
            <InstanceFormSection
              canResubmitInstance={canResubmitInstance}
              deciding={deciding}
              error={error}
              instance={instance}
              loading={loading}
              onResubmitFormChange={(values): void => {
                setResubmitFormData(values);
                setResubmitFormErrors({});
              }}
              onResubmitInstance={(): void => void handleResubmitInstance()}
              onUploadAttachment={handleUploadAttachment}
              resubmitFormData={resubmitFormData}
              resubmitFormErrors={resubmitFormErrors}
            />
          </Section>
        ) : null}

        {showAttachments ? (
          <Section>
            <InstanceAttachmentsSection
              attachments={attachments}
              onDownload={(attachment): void => {
                void handleDownloadAttachment(attachment);
              }}
              onPreview={(attachment): void => {
                void handlePreviewAttachment(attachment);
              }}
            />
          </Section>
        ) : null}

        {showTasks ? (
          <Section>
            <InstanceTasksSection
              adhocDirectives={adhocDirectives}
              currentMemberId={currentMemberId}
              instance={instance}
              memberProfilesById={memberProfilesById}
              onChanged={refreshInstance}
              ref={tasksSectionRef}
              tasks={tasks}
            />
          </Section>
        ) : null}

        {showSignatures ? (
          <Section>
            <InstanceSignaturesSection
              signatureVerification={signatureVerification}
              signatures={signatures}
            />
          </Section>
        ) : null}

        {showHistory ? (
          <Section>
            <InstanceHistorySection
              activityLogs={activityLogs}
              instanceState={instance?.state ?? 'RUNNING'}
              memberProfilesById={memberProfilesById}
              signatureVerification={signatureVerification}
              signaturesById={signaturesById}
              taskDecisionsByTaskId={taskDecisionsByTaskId}
              tasks={tasks}
              workflowSnapshot={instance?.workflowSnapshot ?? null}
              workflowTokens={workflowTokens}
            />
          </Section>
        ) : null}
      </SectionGroup>

      {/* Workflow flow modal */}
      {instance ? (
        <Modal
          modalType="standard"
          onClose={(): void => setWorkflowModalOpen(false)}
          open={workflowModalOpen}
          showModalHeader
          size="wide"
          supportingText={`${readInstanceStateLabel(
            instance.state,
          )} · ${formatDateTime(instance.startedAt)}`}
          title="流程圖"
        >
          <div style={FLOW_MODAL_BODY_STYLE}>
            <div style={FLOW_CANVAS_STYLE}>
              <ReactFlow
                edges={flowEdges}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                maxZoom={1.2}
                minZoom={0.2}
                nodes={flowNodes}
                nodesDraggable={false}
                nodesFocusable={false}
                nodeTypes={READONLY_FLOW_NODE_TYPES}
                panOnDrag
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            {edgeSummaries.length > 0 ? (
              <div style={EDGE_SUMMARY_STYLE}>
                {edgeSummaries.map((summary) => (
                  <span key={summary} style={EDGE_SUMMARY_ITEM_STYLE}>
                    {summary}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* PDF preview modal */}
      <Modal
        modalType="standard"
        onClose={(): void => {
          setPreviewAttachment(null);
          setPreviewUrl(null);
        }}
        open={Boolean(previewAttachment && previewUrl)}
        showModalHeader
        size="wide"
        supportingText={previewAttachment?.filename ?? undefined}
        title="PDF 預覽"
      >
        {previewUrl ? (
          <PDFPreview
            filename={previewAttachment?.filename ?? 'PDF 預覽'}
            fileUrl={previewUrl}
            onDownload={
              previewAttachment
                ? (): void => void handleDownloadAttachment(previewAttachment)
                : undefined
            }
          />
        ) : null}
      </Modal>

      {/* Cancel instance modal */}
      <Modal
        cancelText="保留案件"
        confirmButtonProps={{ variant: 'destructive-primary' }}
        confirmText="確認取消"
        loading={deciding}
        modalStatusType="error"
        modalType="standard"
        onCancel={(): void => setCancelModalOpen(false)}
        onClose={(): void => setCancelModalOpen(false)}
        onConfirm={(): void => void handleCancelInstance()}
        open={cancelModalOpen}
        showModalFooter
        showModalHeader
        supportingText="取消後會關閉目前待簽任務與候選簽核人。"
        title="取消案件"
      >
        <div style={SECTION_BODY_STYLE}>
          <Typography variant="body">
            確定要取消「{instance?.title ?? ''}」嗎？
          </Typography>
          <BPMFormField label="取消原因" name="cancelComment">
            <Textarea
              onChange={(event): void =>
                setCancelComment(event.target.value)
              }
              placeholder="可填寫取消原因"
              resize="vertical"
              rows={3}
              value={cancelComment}
            />
          </BPMFormField>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Container-local helper functions (flow canvas, labels)
// ---------------------------------------------------------------------------

function readEdgeLabel(edge: WorkflowDefinition['edges'][number]): string {
  if (edge.data.label) {
    return edge.data.label;
  }

  if (edge.data.isDefault) {
    return '其他情況';
  }

  return edge.data.condition ?? '';
}

function readEdgeSummaries(workflow: WorkflowDefinition): readonly string[] {
  return workflow.edges
    .map(readEdgeLabel)
    .filter((label) => label.trim().length > 0);
}

function readNodeKindLabel(type: WorkflowNode['type']): string {
  if (type === 'startEvent') return '開始';
  if (type === 'endEvent') return '完成';
  if (type === 'userTask') return '簽核節點';
  if (type === 'serviceTask') return '知會節點';
  if (type === 'exclusiveGateway') return '條件分流';

  return '平行處理';
}

function readRuntimeFlowNodes(
  workflow: WorkflowDefinition,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: string,
): RuntimeFlowNode[] {
  return workflow.nodes.map((node): RuntimeFlowNode => {
    const state = readNodeRuntimeState(node, tasks, tokens, instanceState);

    return {
      data: {
        kindLabel: readNodeKindLabel(node.type),
        label: node.data.label,
        secondaryLabel: state.secondaryLabel,
        statusLabel: state.statusLabel,
        tone: state.tone,
      },
      id: node.id,
      position: node.position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      type: 'workflowRuntime',
    };
  });
}

function layoutRuntimeWorkflowDefinition(
  workflow: WorkflowDefinition,
): WorkflowDefinition {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    nodesep: 56,
    rankdir: 'LR',
    ranksep: 120,
  });
  workflow.nodes.forEach((node): void => {
    graph.setNode(node.id, {
      height: FLOW_NODE_LAYOUT_HEIGHT,
      width: FLOW_NODE_LAYOUT_WIDTH,
    });
  });
  workflow.edges.forEach((edge): void => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return {
    ...workflow,
    nodes: workflow.nodes.map((node): WorkflowNode => {
      const positionedNode = graph.node(node.id) as
        | { readonly x: number; readonly y: number }
        | undefined;

      return positionedNode
        ? {
            ...node,
            position: {
              x: positionedNode.x - FLOW_NODE_LAYOUT_WIDTH / 2,
              y: positionedNode.y - FLOW_NODE_LAYOUT_HEIGHT / 2,
            },
          }
        : node;
    }),
  };
}

function readRuntimeFlowEdges(workflow: WorkflowDefinition): RuntimeFlowEdge[] {
  return workflow.edges.map((edge): RuntimeFlowEdge => {
    const label = readEdgeLabel(edge);

    return {
      animated: false,
      id: edge.id,
      label,
      labelBgBorderRadius: 6,
      labelBgPadding: [8, 4],
      labelBgStyle: {
        fill: edge.data.isDefault ? '#f8fafc' : '#eff6ff',
        stroke: edge.data.isDefault ? '#64748b' : '#2563eb',
        strokeWidth: 1,
      },
      labelShowBg: Boolean(label),
      labelStyle: {
        fill: edge.data.isDefault ? '#475569' : '#2563eb',
        fontSize: 12,
        fontWeight: 600,
      },
      source: edge.source,
      style: {
        stroke: '#475569',
        strokeWidth: 1.5,
      },
      target: edge.target,
      type: edge.type ?? 'smoothstep',
    };
  });
}

function readNodeStyle(tone: RuntimeTone): CSSProperties {
  if (tone === 'current') {
    return {
      ...NODE_STYLE,
      border: '1px solid var(--mzn-color-primary, #0057ff)',
      boxShadow: '0 0 0 3px rgba(0, 87, 255, 0.14)',
    };
  }

  if (tone === 'completed') {
    return {
      ...NODE_STYLE,
      border: '1px solid #16a34a',
    };
  }

  if (tone === 'cancelled') {
    return {
      ...NODE_STYLE,
      border: '1px solid #dc2626',
      opacity: 0.72,
    };
  }

  if (tone === 'waiting') {
    return {
      ...NODE_STYLE,
      border: '1px dashed #64748b',
    };
  }

  return NODE_STYLE;
}

function readNodeStatusStyle(tone: RuntimeTone): CSSProperties {
  const baseStyle = NODE_STATUS_STYLE;

  if (tone === 'current') {
    return { ...baseStyle, background: '#eff6ff', color: '#2563eb' };
  }

  if (tone === 'completed') {
    return { ...baseStyle, background: '#f0fdf4', color: '#15803d' };
  }

  if (tone === 'cancelled') {
    return { ...baseStyle, background: '#fef2f2', color: '#dc2626' };
  }

  if (tone === 'waiting') {
    return { ...baseStyle, background: '#f8fafc', color: '#475569' };
  }

  return { ...baseStyle, background: '#f1f5f9', color: '#64748b' };
}

function WorkflowRuntimeNodeCard({
  data,
}: NodeProps<RuntimeFlowNode>): ReactElement {
  return (
    <div style={readNodeStyle(data.tone)}>
      <Handle
        isConnectable={false}
        position={Position.Left}
        style={NODE_HANDLE_STYLE}
        type="target"
      />
      <Typography
        component="span"
        ellipsis
        title={data.label}
        variant="label-primary"
      >
        {data.label}
      </Typography>
      <span style={readNodeStatusStyle(data.tone)}>{data.statusLabel}</span>
      <span title={data.secondaryLabel} style={NODE_SECONDARY_STYLE}>
        {data.secondaryLabel || data.kindLabel}
      </span>
      <Handle
        isConnectable={false}
        position={Position.Right}
        style={NODE_HANDLE_STYLE}
        type="source"
      />
    </div>
  );
}
