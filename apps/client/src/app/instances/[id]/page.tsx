'use client';

import {
  ChangeEvent,
  CSSProperties,
  Fragment,
  RefCallback,
  ReactElement,
  forwardRef,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useParams } from 'next/navigation';
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
  AutoComplete,
  Button,
  Layout,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Stepper,
  Table,
  Textarea,
  Tooltip,
  Typography,
  type StepProps,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { stepClasses } from '@mezzanine-ui/core/stepper';
import {
  CheckedIcon,
  DangerousOutlineIcon,
  DownloadIcon,
  FileSearchIcon,
  RefreshCcwIcon,
  ShareIcon,
  UserIcon,
} from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import { WorkflowDefinition, WorkflowNode } from '@rytass/bpm-core-shared/workflow';
import { BPMFormField } from '../../_components/bpm-form-field';
import { formatDateTime } from '../../_lib/date-time';
import { useAuth } from '../../auth-provider';
import { renderAppNavigation } from '../../app-navigation';
import { FormRenderer } from '../../forms/_components/form-renderer';
import { PDFPreview } from '../_components/pdf-preview';
import {
  ActivityLogRecord,
  AttachmentRecord,
  ApprovalInstanceRecord,
  MemberProfileRecord,
  SignatureRecord,
  SignatureVerificationRecord,
  cancelApprovalInstance,
  decideTask,
  listAttachments,
  listTaskDecisions,
  readApprovalInstance,
  readAttachmentDownloadUrl,
  readAttachmentPreviewUrl,
  readInstanceSignatures,
  resubmitApprovalInstance,
  resolveMemberProfiles,
  searchMembers,
  TaskDecisionRecord,
  TaskRecord,
  WorkflowFormData,
  WorkflowTokenRecord,
  uploadAttachment,
} from '../_lib/workflow-api';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const FLOW_NODE_LAYOUT_WIDTH = 184;
const FLOW_NODE_LAYOUT_HEIGHT = 96;

const FLOW_MODAL_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const REJECT_REASON_FORM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  width: '100%',
};

const REJECT_REASON_TEXTAREA_STYLE: CSSProperties = {
  minWidth: '100%',
  width: '100%',
};

const MODAL_FORM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  width: '100%',
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

const HISTORY_MEMBER_NAME_STYLE: CSSProperties = {
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
};

const HISTORY_DANGER_TEXT_STYLE: CSSProperties = {
  color: 'var(--mzn-color-text-error)',
};

function applyFullWidthTextareaHost(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }

  element.style.width = '100%';
}

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

type TaskRow = Readonly<
  Record<string, unknown> &
    TaskRecord & {
      assigneeLabel: string;
      key: string;
      nodeLabel: string;
      statusLabel: string;
    }
>;

type AttachmentRow = Readonly<
  Record<string, unknown> & {
    attachment: AttachmentRecord;
    createdAt: string;
    filename: string;
    id: string;
    key: string;
    mimeType: string;
    sizeLabel: string;
  }
>;

type SignatureRow = Readonly<
  Record<string, unknown> & {
    algorithm: string;
    hashLabel: string;
    key: string;
    keyVersion: number;
    signedAtLabel: string;
    signerMemberId: string;
  }
>;

type MemberOption = Readonly<{
  email: string | null;
  id: string;
  name: string;
}>;

interface ActivityStepRecord {
  readonly descriptionParts: readonly ActivityStepDescriptionPart[];
  readonly error: boolean;
  readonly forcePending?: boolean;
  readonly id: string;
  readonly title: string;
}

type ActivityStepDescriptionPart =
  | Readonly<{ text: string; type: 'text' }>
  | Readonly<{ text: string; type: 'dangerText' }>
  | Readonly<{
      email: string | null;
      label: string;
      memberId: string | null;
      prefix: string;
      type: 'member';
    }>;

export default function ApprovalInstancePage(): ReactElement {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;
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
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(
    null,
  );
  const [rejectReasonModalOpen, setRejectReasonModalOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTargetNodeId, setReturnTargetNodeId] = useState<string | null>(
    null,
  );
  const [transferComment, setTransferComment] = useState('');
  const [transferMember, setTransferMember] = useState<MemberOption | null>(
    null,
  );
  const [transferMemberLoading, setTransferMemberLoading] = useState(false);
  const [transferMemberOptions, setTransferMemberOptions] = useState<
    readonly MemberOption[]
  >([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [resubmitFormData, setResubmitFormData] = useState<WorkflowFormData>(
    {},
  );
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const trimmedRejectReason = rejectReason.trim();
  const trimmedReturnComment = returnComment.trim();
  const trimmedTransferComment = transferComment.trim();

  useEffect((): void => {
    void refreshInstance();
  }, [currentMemberId, instanceId]);

  useEffect((): void => {
    setResubmitFormData(instance?.formData ?? {});
  }, [instance]);

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
  const returnTargetOptions = useMemo(
    (): readonly { readonly id: string; readonly name: string }[] =>
      currentTaskNode && instance
        ? readReturnTargetOptions(instance.workflowSnapshot, currentTaskNode)
        : [],
    [currentTaskNode, instance],
  );
  const canReturnCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.returnBehavior.allowReturn;
  const selectedReturnTargetOption =
    returnTargetOptions.find((option) => option.id === returnTargetNodeId) ??
    returnTargetOptions[0] ??
    null;
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
  const taskRows = useMemo(
    (): TaskRow[] =>
      tasks.map((task) => ({
        ...task,
        assigneeLabel: readTaskAssigneeLabel(task),
        key: task.id,
        nodeLabel: readNodeDisplayLabel(
          task.nodeId,
          instance?.workflowSnapshot ?? null,
        ),
        statusLabel: readTaskStatusLabel(task.status),
      })),
    [instance, tasks],
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
  const activitySteps = useMemo(
    (): ActivityStepRecord[] =>
      readActivityStepRecords(
        activityLogs,
        tasks,
        workflowTokens,
        instance?.workflowSnapshot ?? null,
        instance?.state ?? 'RUNNING',
        memberProfilesById,
        taskDecisionsByTaskId,
        signaturesById,
        signatureVerification,
      ),
    [
      activityLogs,
      instance,
      memberProfilesById,
      signatureVerification,
      signaturesById,
      taskDecisionsByTaskId,
      tasks,
      workflowTokens,
    ],
  );
  const currentActivityStep = useMemo(
    (): number => readCurrentActivityStep(activitySteps),
    [activitySteps],
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
  const taskColumns = useMemo(
    (): TableColumn<TaskRow>[] => [
      { dataIndex: 'nodeLabel', key: 'nodeLabel', title: '節點', width: 180 },
      {
        key: 'assigneeMemberId',
        title: '處理者',
        render: (record: TaskRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.assigneeLabel}
          </Typography>
        ),
        width: 180,
      },
      {
        dataIndex: 'statusLabel',
        key: 'statusLabel',
        title: '狀態',
        width: 120,
      },
      {
        key: 'createdAt',
        render: (record: TaskRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.createdAt)}
          </Typography>
        ),
        title: '建立時間',
        width: 220,
      },
    ],
    [],
  );
  const attachmentRows = useMemo(
    (): AttachmentRow[] =>
      attachments.map((attachment) => ({
        attachment,
        createdAt: attachment.createdAt,
        filename: attachment.filename,
        id: attachment.id,
        key: attachment.id,
        mimeType: attachment.mimeType,
        sizeLabel: formatFileSize(Number(attachment.sizeBytes)),
      })),
    [attachments],
  );
  const attachmentColumns = useMemo(
    (): TableColumn<AttachmentRow>[] => [
      { dataIndex: 'filename', key: 'filename', title: '檔名', width: 260 },
      { dataIndex: 'mimeType', key: 'mimeType', title: '類型', width: 180 },
      { dataIndex: 'sizeLabel', key: 'sizeLabel', title: '大小', width: 120 },
      {
        key: 'createdAt',
        render: (record: AttachmentRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.createdAt)}
          </Typography>
        ),
        title: '上傳時間',
        width: 220,
      },
    ],
    [],
  );
  const attachmentActions = useMemo(
    (): TableActions<AttachmentRow> => ({
      render: (record): ReturnType<TableActions<AttachmentRow>['render']> => [
        ...(record.mimeType === 'application/pdf'
          ? [
              {
                icon: FileSearchIcon,
                iconType: 'leading' as const,
                name: '預覽',
                onClick: (): void => {
                  void handlePreviewAttachment(record.attachment);
                },
              },
            ]
          : []),
        {
          icon: DownloadIcon,
          iconType: 'leading',
          name: '下載',
          onClick: (): void => {
            void handleDownloadAttachment(record.attachment);
          },
        },
      ],
      variant: 'base-secondary',
      width: 160,
    }),
    [],
  );
  const signatureRows = useMemo(
    (): SignatureRow[] =>
      signatures.map((signature) => ({
        algorithm: signature.algorithm,
        hashLabel: readShortHash(signature.signedPayloadHash),
        key: signature.id,
        keyVersion: signature.keyVersion,
        signedAtLabel: formatDateTime(signature.signedAt),
        signerMemberId: signature.signerMemberId,
      })),
    [signatures],
  );
  const signatureColumns = useMemo(
    (): TableColumn<SignatureRow>[] => [
      {
        dataIndex: 'signerMemberId',
        key: 'signerMemberId',
        title: '簽章者',
        width: 160,
      },
      { dataIndex: 'algorithm', key: 'algorithm', title: '演算法', width: 150 },
      {
        dataIndex: 'keyVersion',
        key: 'keyVersion',
        title: 'Key 版本',
        width: 100,
      },
      {
        dataIndex: 'hashLabel',
        key: 'hashLabel',
        title: 'Payload Hash',
        width: 180,
      },
      {
        dataIndex: 'signedAtLabel',
        key: 'signedAtLabel',
        title: '簽章時間',
        width: 220,
      },
    ],
    [],
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
      ] = await Promise.all([
        readTaskDecisionsForTasks(nextRecord.tasks),
        readMemberProfilesForTimeline(nextRecord),
        listAttachments(nextRecord.instance.id),
        readInstanceSignatures(nextRecord.instance.id),
      ]);
      setTaskDecisions(nextTaskDecisions);
      setMemberProfiles(nextMemberProfiles);
      setAttachments(nextAttachments);
      setSignatures(nextSignatures.signatures);
      setSignatureVerification(nextSignatures.verification);
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

  async function handleDecision({
    action,
    comment,
    returnToNodeId = null,
    transferToMemberId = null,
  }: Readonly<{
    action: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'TRANSFERRED';
    comment: string | null;
    returnToNodeId?: string | null;
    transferToMemberId?: string | null;
  }>): Promise<void> {
    if (!currentMemberId || !currentTask) {
      return;
    }

    setDeciding(true);
    setError(null);

    try {
      await decideTask({
        action,
        comment,
        decidedByMemberId: currentMemberId,
        returnToNodeId,
        taskId: currentTask.id,
        transferToMemberId,
      });
      setRejectReasonModalOpen(false);
      setReturnModalOpen(false);
      setTransferModalOpen(false);
      setRejectReason('');
      setReturnComment('');
      setTransferComment('');
      setTransferMember(null);
      setReturnTargetNodeId(null);
      setRejectReasonError(null);
      await refreshInstance();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeciding(false);
    }
  }

  function openRejectReasonModal(): void {
    setRejectReason('');
    setRejectReasonError(null);
    setRejectReasonModalOpen(true);
  }

  function closeRejectReasonModal(): void {
    if (deciding) {
      return;
    }

    setRejectReasonModalOpen(false);
    setRejectReason('');
    setRejectReasonError(null);
  }

  function openReturnModal(): void {
    setReturnComment('');
    setReturnTargetNodeId(returnTargetOptions[0]?.id ?? null);
    setReturnModalOpen(true);
  }

  function closeReturnModal(): void {
    if (deciding) {
      return;
    }

    setReturnModalOpen(false);
    setReturnComment('');
    setReturnTargetNodeId(null);
  }

  function openTransferModal(): void {
    setTransferComment('');
    setTransferMember(null);
    setTransferModalOpen(true);
    void handleSearchTransferMembers('');
  }

  function closeTransferModal(): void {
    if (deciding) {
      return;
    }

    setTransferModalOpen(false);
    setTransferComment('');
    setTransferMember(null);
  }

  async function handleSearchTransferMembers(
    searchText: string,
  ): Promise<void> {
    setTransferMemberLoading(true);

    try {
      setTransferMemberOptions(
        (await searchMembers(searchText))
          .filter((member) => member.memberId !== currentMemberId)
          .map(readMemberOption),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setTransferMemberLoading(false);
    }
  }

  async function handleRejectConfirm(): Promise<void> {
    if (!trimmedRejectReason) {
      setRejectReasonError('請輸入拒絕原因');
      return;
    }

    await handleDecision({
      action: 'REJECTED',
      comment: trimmedRejectReason,
    });
  }

  async function handleTransferConfirm(): Promise<void> {
    if (!transferMember) {
      setError('請選擇轉派對象');
      return;
    }

    await handleDecision({
      action: 'TRANSFERRED',
      comment: trimmedTransferComment || null,
      transferToMemberId: transferMember.id,
    });
  }

  async function handleReturnConfirm(): Promise<void> {
    await handleDecision({
      action: 'RETURNED',
      comment: trimmedReturnComment || null,
      returnToNodeId: selectedReturnTargetOption?.id ?? null,
    });
  }

  async function handleCancelInstance(): Promise<void> {
    if (!currentMemberId || !instance || !canCancelInstance) {
      return;
    }

    setDeciding(true);
    setError(null);

    try {
      await cancelApprovalInstance({
        cancelledByMemberId: currentMemberId,
        comment: null,
        instanceId: instance.id,
      });
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

  return (
    <Layout>
      {renderAppNavigation('/inbox')}

      <Layout.Main>
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
                disabled={deciding}
                icon={DangerousOutlineIcon}
                iconType="leading"
                onClick={(): void => void handleCancelInstance()}
                variant="destructive-secondary"
              >
                取消案件
              </Button>
            ) : null}
            {currentTask ? (
              <>
                {canReturnCurrentTask ? (
                  <Button
                    disabled={deciding}
                    icon={RefreshCcwIcon}
                    iconType="leading"
                    onClick={openReturnModal}
                    variant="base-secondary"
                  >
                    退回
                  </Button>
                ) : null}
                <Button
                  disabled={deciding}
                  icon={UserIcon}
                  iconType="leading"
                  onClick={openTransferModal}
                  variant="base-secondary"
                >
                  轉派
                </Button>
                <Button
                  disabled={deciding}
                  icon={DangerousOutlineIcon}
                  iconType="leading"
                  onClick={openRejectReasonModal}
                  variant="destructive-secondary"
                >
                  拒絕
                </Button>
                <Button
                  disabled={deciding}
                  icon={CheckedIcon}
                  iconType="leading"
                  onClick={(): void =>
                    void handleDecision({ action: 'APPROVED', comment: null })
                  }
                  variant="base-primary"
                >
                  同意
                </Button>
              </>
            ) : null}
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            <div style={SECTION_BODY_STYLE}>
              {error ? (
                <Typography color="text-error" variant="body">
                  {error}
                </Typography>
              ) : null}
              {loading ? (
                <Typography color="text-neutral" variant="body">
                  載入中...
                </Typography>
              ) : null}
              {instance?.formDefinitionSnapshot.schema &&
              instance.formDefinitionSnapshot.uiSchema ? (
                <>
                  <FormRenderer
                    onChange={setResubmitFormData}
                    onUploadAttachment={
                      canResubmitInstance ? handleUploadAttachment : undefined
                    }
                    readonly={!canResubmitInstance}
                    schema={instance.formDefinitionSnapshot.schema}
                    uiSchema={instance.formDefinitionSnapshot.uiSchema}
                    value={
                      canResubmitInstance ? resubmitFormData : instance.formData
                    }
                  />
                  {canResubmitInstance ? (
                    <div style={BUTTON_ROW_STYLE}>
                      <Button
                        disabled={deciding}
                        icon={RefreshCcwIcon}
                        iconType="leading"
                        onClick={(): void => void handleResubmitInstance()}
                        variant="base-primary"
                      >
                        重新送出
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Typography color="text-neutral" variant="body">
                  此案件沒有可顯示的表單快照。
                </Typography>
              )}
            </div>
          </Section>

          <Section>
            <div style={SECTION_BODY_STYLE}>
              <Typography component="h2" variant="h3">
                附件
              </Typography>
              {attachmentRows.length > 0 ? (
                <Table
                  actions={attachmentActions}
                  columns={attachmentColumns}
                  dataSource={attachmentRows}
                  fullWidth
                />
              ) : (
                <Typography color="text-neutral" variant="body">
                  此案件沒有附件。
                </Typography>
              )}
            </div>
          </Section>

          <Section>
            <Typography component="h2" variant="h3">
              任務
            </Typography>
            <Table columns={taskColumns} dataSource={taskRows} fullWidth />
          </Section>

          <Section>
            <div style={SECTION_BODY_STYLE}>
              <Typography component="h2" variant="h3">
                簽章
              </Typography>
              <Typography
                color={
                  signatureVerification?.valid ? 'text-success' : 'text-error'
                }
                variant="body"
              >
                {signatureVerification
                  ? signatureVerification.valid
                    ? `簽章鏈已驗證，共 ${signatureVerification.checkedCount} 筆。`
                    : `簽章鏈驗證失敗：${signatureVerification.errors.join('、')}`
                  : '尚無簽章紀錄。'}
              </Typography>
              {signatureRows.length > 0 ? (
                <Table
                  columns={signatureColumns}
                  dataSource={signatureRows}
                  fullWidth
                />
              ) : null}
            </div>
          </Section>

          <Section>
            <div style={SECTION_BODY_STYLE}>
              <Typography component="h2" variant="h3">
                歷程
              </Typography>
              {activitySteps.length > 0 ? (
                <Stepper
                  currentStep={currentActivityStep}
                  orientation="vertical"
                  type="dot"
                >
                  {activitySteps.map((activityStep) => (
                    <ActivityHistoryStep
                      descriptionParts={activityStep.descriptionParts}
                      error={activityStep.error}
                      forcePending={activityStep.forcePending}
                      key={activityStep.id}
                      title={activityStep.title}
                    />
                  ))}
                </Stepper>
              ) : (
                <Typography color="text-neutral" variant="body">
                  尚無歷程紀錄。
                </Typography>
              )}
            </div>
          </Section>
        </SectionGroup>

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
        <Modal
          cancelText="取消"
          confirmButtonProps={{
            disabled: !trimmedRejectReason,
            variant: 'destructive-primary',
          }}
          confirmText="送出拒絕"
          loading={deciding}
          modalStatusType="error"
          modalType="standard"
          onCancel={closeRejectReasonModal}
          onClose={closeRejectReasonModal}
          onConfirm={(): void => void handleRejectConfirm()}
          open={rejectReasonModalOpen}
          showModalFooter
          showModalHeader
          size="regular"
          supportingText="拒絕案件時必須留下原因，供發起人與後續追蹤查看。"
          title="拒絕原因"
        >
          <div style={REJECT_REASON_FORM_STYLE}>
            <BPMFormField label="拒絕原因" name="rejectReason" required>
              <Textarea
                autoFocus
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
                  setRejectReason(event.target.value);
                  setRejectReasonError(null);
                }}
                placeholder="請說明拒絕原因"
                ref={applyFullWidthTextareaHost}
                resize="vertical"
                rows={4}
                style={REJECT_REASON_TEXTAREA_STYLE}
                type={rejectReasonError ? 'error' : 'default'}
                value={rejectReason}
              />
            </BPMFormField>
            {rejectReasonError ? (
              <Typography color="text-error" variant="body">
                {rejectReasonError}
              </Typography>
            ) : null}
          </div>
        </Modal>
        <Modal
          cancelText="取消"
          confirmButtonProps={{
            disabled: !transferMember,
          }}
          confirmText="送出轉派"
          loading={deciding}
          modalType="standard"
          onCancel={closeTransferModal}
          onClose={closeTransferModal}
          onConfirm={(): void => void handleTransferConfirm()}
          open={transferModalOpen}
          showModalFooter
          showModalHeader
          size="regular"
          supportingText="轉派後，原任務會保留轉派紀錄，新的待簽任務會指派給指定成員。"
          title="轉派簽核"
        >
          <div style={MODAL_FORM_STYLE}>
            <BPMFormField label="轉派對象" name="transferToMemberId" required>
              <AutoComplete
                asyncData
                disabledOptionsFilter
                emptyText="沒有符合的成員"
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  name: 'transfer-member-search',
                  spellCheck: false,
                }}
                loading={transferMemberLoading}
                loadingText="搜尋成員中..."
                mode="single"
                onChange={(option): void =>
                  setTransferMember(readMemberOptionFromValue(option))
                }
                onSearch={handleSearchTransferMembers}
                onSearchTextChange={(searchText): void =>
                  setTransferMember(
                    readUniqueMemberOption(searchText, transferMemberOptions),
                  )
                }
                onVisibilityChange={(open): void => {
                  if (open) {
                    void handleSearchTransferMembers('');
                  }
                }}
                options={[...transferMemberOptions]}
                placeholder="搜尋姓名或信箱"
                searchDebounceTime={300}
                value={transferMember}
              />
            </BPMFormField>
            <BPMFormField label="轉派說明" name="transferComment">
              <Textarea
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setTransferComment(event.target.value)
                }
                placeholder="可補充轉派原因"
                ref={applyFullWidthTextareaHost}
                resize="vertical"
                rows={4}
                style={REJECT_REASON_TEXTAREA_STYLE}
                value={transferComment}
              />
            </BPMFormField>
          </div>
        </Modal>
        <Modal
          cancelText="取消"
          confirmButtonProps={{
            disabled: !selectedReturnTargetOption,
          }}
          confirmText="送出退回"
          loading={deciding}
          modalType="standard"
          onCancel={closeReturnModal}
          onClose={closeReturnModal}
          onConfirm={(): void => void handleReturnConfirm()}
          open={returnModalOpen}
          showModalFooter
          showModalHeader
          size="regular"
          supportingText="退回後，流程會回到指定節點並等待重新處理。"
          title="退回簽核"
        >
          <div style={MODAL_FORM_STYLE}>
            <BPMFormField label="退回節點" name="returnTargetNodeId" required>
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setReturnTargetNodeId(option?.id ?? null)
                }
                options={[...returnTargetOptions]}
                placeholder="選擇退回節點"
                value={selectedReturnTargetOption}
              />
            </BPMFormField>
            <BPMFormField label="退回說明" name="returnComment">
              <Textarea
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setReturnComment(event.target.value)
                }
                placeholder="可補充需要修改的內容"
                ref={applyFullWidthTextareaHost}
                resize="vertical"
                rows={4}
                style={REJECT_REASON_TEXTAREA_STYLE}
                value={returnComment}
              />
            </BPMFormField>
          </div>
        </Modal>
      </Layout.Main>
    </Layout>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '-';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function readShortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 12)}...` : hash;
}

function joinClassNames(
  ...classNames: readonly (string | null | undefined)[]
): string {
  return classNames
    .filter((className): className is string =>
      isPresentText(className ?? null),
    )
    .join(' ');
}

interface ActivityHistoryStepProps extends StepProps {
  readonly descriptionParts: readonly ActivityStepDescriptionPart[];
  readonly forcePending?: boolean;
}

const ActivityHistoryStep = forwardRef<
  HTMLDivElement,
  ActivityHistoryStepProps
>(function ActivityHistoryStep(
  {
    className,
    descriptionParts,
    error,
    forcePending = false,
    index = 0,
    orientation,
    status = 'pending',
    title,
    type = 'number',
    ...rest
  },
  ref,
): ReactElement {
  const displayStatus = forcePending ? 'pending' : status;

  return (
    <div
      {...rest}
      className={joinClassNames(
        stepClasses.host,
        type === 'dot' ? stepClasses.dot : null,
        error && displayStatus !== 'processing' ? stepClasses.error : null,
        orientation === 'horizontal' ? stepClasses.horizontal : null,
        type === 'number' ? stepClasses.number : null,
        displayStatus === 'pending' ? stepClasses.pending : null,
        displayStatus === 'processing' ? stepClasses.processing : null,
        error && displayStatus === 'processing'
          ? stepClasses.processingError
          : null,
        !error && displayStatus === 'succeeded' ? stepClasses.succeeded : null,
        orientation === 'vertical' ? stepClasses.vertical : null,
        className,
      )}
      ref={ref}
    >
      {type === 'dot' ? (
        <span
          className={joinClassNames(
            stepClasses.statusIndicator,
            stepClasses.statusIndicatorDot,
          )}
        />
      ) : (
        <span className={stepClasses.statusIndicator}>{index + 1}</span>
      )}
      <div className={stepClasses.textContainer}>
        <Typography
          className={stepClasses.title}
          variant="label-primary-highlight"
        >
          {title}
          <span className={stepClasses.titleConnectLine} />
        </Typography>
        {descriptionParts.length > 0 ? (
          <Typography className={stepClasses.description} variant="caption">
            {descriptionParts.map((part, partIndex) => (
              <Fragment key={`${part.type}-${partIndex}`}>
                {partIndex > 0 ? ' · ' : null}
                {renderActivityDescriptionPart(part)}
              </Fragment>
            ))}
          </Typography>
        ) : null}
      </div>
    </div>
  );
});

function renderActivityDescriptionPart(
  part: ActivityStepDescriptionPart,
): ReactElement | string {
  if (part.type === 'text') {
    return part.text;
  }

  if (part.type === 'dangerText') {
    return <span style={HISTORY_DANGER_TEXT_STYLE}>{part.text}</span>;
  }

  if (!part.email) {
    return `${part.prefix}：${part.label}`;
  }

  return (
    <>
      {part.prefix}：
      <Tooltip title={part.email}>
        {({ onMouseEnter, onMouseLeave, ref }): ReactElement => (
          <span
            data-testid={
              part.memberId ? `member-tooltip-${part.memberId}` : undefined
            }
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            ref={ref as RefCallback<HTMLSpanElement>}
            style={HISTORY_MEMBER_NAME_STYLE}
          >
            {part.label}
          </span>
        )}
      </Tooltip>
    </>
  );
}

async function readMemberProfilesForTimeline({
  activityLogs,
  tasks,
}: {
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly tasks: readonly TaskRecord[];
}): Promise<readonly MemberProfileRecord[]> {
  const memberIds = [
    ...new Set(
      [
        ...activityLogs.map((activityLog) => activityLog.actorMemberId),
        ...tasks.map((task) => task.assigneeMemberId),
        ...tasks.map((task) => task.originalAssigneeMemberId),
        ...tasks.flatMap((task) => task.candidateMemberIds),
        ...tasks.flatMap((task) =>
          readDelegationChain(task.delegationChainJson).flatMap((step) => [
            step.from,
            step.to,
          ]),
        ),
      ].filter(isPresentText),
    ),
  ];

  try {
    return await resolveMemberProfiles(memberIds);
  } catch {
    return [];
  }
}

async function readTaskDecisionsForTasks(
  tasks: readonly TaskRecord[],
): Promise<readonly TaskDecisionRecord[]> {
  const decisionLists = await Promise.all(
    tasks.map((task) => listTaskDecisions(task.id)),
  );

  return decisionLists.flat();
}

function readLatestTaskDecisionsByTaskId(
  taskDecisions: readonly TaskDecisionRecord[],
): ReadonlyMap<string, TaskDecisionRecord> {
  return taskDecisions.reduce<ReadonlyMap<string, TaskDecisionRecord>>(
    (decisionsByTaskId, decision) => {
      const currentDecision = decisionsByTaskId.get(decision.taskId);
      const nextDecision =
        !currentDecision ||
        new Date(decision.decidedAt).getTime() >
          new Date(currentDecision.decidedAt).getTime()
          ? decision
          : currentDecision;

      return new Map(decisionsByTaskId).set(decision.taskId, nextDecision);
    },
    new Map(),
  );
}

function readActivityStepRecords(
  activityLogs: readonly ActivityLogRecord[],
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  workflow: WorkflowDefinition | null,
  instanceState: ApprovalInstanceRecord['state'],
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
  taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  signatureVerification: SignatureVerificationRecord | null,
): ActivityStepRecord[] {
  const historySteps = activityLogs
    .filter(isUserMeaningfulActivity)
    .map((activityLog): ActivityStepRecord => {
      const payload = readActivityPayload(activityLog);
      const nodeLabel = readActivityNodeLabel(activityLog.nodeId, workflow);
      const descriptionParts = [
        readTextDescriptionPart(
          nodeLabel ? `節點：${nodeLabel}` : '節點：全流程',
        ),
        readMemberDescriptionPart(
          '操作者',
          activityLog.actorMemberId,
          memberProfilesById,
          '系統',
        ),
        readTextDescriptionPart(
          `時間：${formatActivityDateTime(activityLog.createdAt)}`,
        ),
        ...readActivityDetailParts(
          activityLog,
          payload,
          workflow,
          taskDecisionsByTaskId,
          signaturesById,
          signatureVerification,
        ),
      ].filter(isActivityDescriptionPart);

      return {
        descriptionParts,
        error: isActivityError(activityLog, payload),
        id: activityLog.id,
        title: readActivityEventLabel(activityLog.eventType, payload),
      };
    });
  const pendingTaskSteps = tasks.filter(isPendingTask).map(
    (task): ActivityStepRecord => ({
      descriptionParts: [
        readTextDescriptionPart(
          `節點：${readNodeDisplayLabel(task.nodeId, workflow)}`,
        ),
        readMemberDescriptionPart(
          '處理者',
          task.assigneeMemberId,
          memberProfilesById,
          '未指定',
        ),
        readTextDescriptionPart(
          `建立時間：${formatActivityDateTime(task.createdAt)}`,
        ),
      ].filter(isActivityDescriptionPart),
      error: false,
      id: `pending-task-${task.id}`,
      title: task.status === 'IN_PROGRESS' ? '簽核處理中' : '等待簽核處理',
    }),
  );
  const representedNodeIds = new Set(
    [
      ...activityLogs
        .filter(isUserMeaningfulActivity)
        .map((activityLog) => activityLog.nodeId),
      ...tasks.map((task) => task.nodeId),
    ].filter(isPresentText),
  );
  const futureNodeSteps = workflow
    ? readFutureTimelineNodes(
        workflow,
        tasks,
        tokens,
        instanceState,
        representedNodeIds,
      ).map(
        (node): ActivityStepRecord => ({
          descriptionParts: [
            readTextDescriptionPart(
              `${readNodeKindLabel(node.type)} · 尚未抵達`,
            ),
          ].filter(isActivityDescriptionPart),
          error: false,
          forcePending: true,
          id: `future-node-${node.id}`,
          title: readFutureNodeStepTitle(node),
        }),
      )
    : [];

  return [...historySteps, ...pendingTaskSteps, ...futureNodeSteps];
}

function readTextDescriptionPart(
  text: string | null,
): ActivityStepDescriptionPart | null {
  return isPresentText(text) ? { text, type: 'text' } : null;
}

function readDangerTextDescriptionPart(
  text: string | null,
): ActivityStepDescriptionPart | null {
  return isPresentText(text) ? { text, type: 'dangerText' } : null;
}

function readMemberDescriptionPart(
  prefix: string,
  memberId: string | null,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
  fallbackLabel: string,
): ActivityStepDescriptionPart {
  const profile = memberId ? memberProfilesById.get(memberId) : null;

  return {
    email: profile?.email ?? null,
    label: profile?.name ?? fallbackLabel,
    memberId,
    prefix,
    type: 'member',
  };
}

function isActivityDescriptionPart(
  part: ActivityStepDescriptionPart | null,
): part is ActivityStepDescriptionPart {
  return Boolean(part);
}

function readCurrentActivityStep(
  activitySteps: readonly ActivityStepRecord[],
): number {
  const firstPendingStepIndex = activitySteps.findIndex(
    (activityStep) =>
      activityStep.id.startsWith('pending-task-') ||
      activityStep.id.startsWith('future-node-'),
  );

  return firstPendingStepIndex === -1
    ? activitySteps.length
    : firstPendingStepIndex;
}

function isUserMeaningfulActivity(activityLog: ActivityLogRecord): boolean {
  return (
    activityLog.eventType === 'INSTANCE_STARTED' ||
    activityLog.eventType === 'TASK_DECIDED' ||
    activityLog.eventType === 'SLA_TRIGGERED'
  );
}

function isFutureTimelineNode(
  node: WorkflowNode,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: ApprovalInstanceRecord['state'],
  representedNodeIds: ReadonlySet<string>,
): boolean {
  if (node.type === 'startEvent' || representedNodeIds.has(node.id)) {
    return false;
  }

  if (instanceState === 'REJECTED') {
    return true;
  }

  const state = readNodeRuntimeState(node, tasks, tokens, instanceState);

  return state.tone === 'neutral' || state.tone === 'waiting';
}

function readFutureTimelineNodes(
  workflow: WorkflowDefinition,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: ApprovalInstanceRecord['state'],
  representedNodeIds: ReadonlySet<string>,
): readonly WorkflowNode[] {
  if (instanceState !== 'RUNNING' && instanceState !== 'REJECTED') {
    return [];
  }

  const futureNodes = workflow.nodes.filter((node) =>
    isFutureTimelineNode(
      node,
      tasks,
      tokens,
      instanceState,
      representedNodeIds,
    ),
  );
  const reachableDistances = readReachableFutureNodeDistances(
    workflow,
    futureNodes,
    tasks,
    tokens,
    representedNodeIds,
  );
  const originalNodeIndexes = new Map(
    workflow.nodes.map((node, index) => [node.id, index]),
  );

  return futureNodes
    .filter((node) => reachableDistances.has(node.id))
    .sort((left, right) => {
      const leftDistance = reachableDistances.get(left.id) ?? 0;
      const rightDistance = reachableDistances.get(right.id) ?? 0;

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (left.position.x !== right.position.x) {
        return left.position.x - right.position.x;
      }

      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y;
      }

      return (
        (originalNodeIndexes.get(left.id) ?? 0) -
        (originalNodeIndexes.get(right.id) ?? 0)
      );
    });
}

function readReachableFutureNodeDistances(
  workflow: WorkflowDefinition,
  futureNodes: readonly WorkflowNode[],
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  representedNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const futureNodeIds = new Set(futureNodes.map((node) => node.id));
  const outgoingNodeIds = workflow.edges.reduce<
    ReadonlyMap<string, readonly string[]>
  >((groups, edge) => {
    const nextTargets = [...(groups.get(edge.source) ?? []), edge.target];

    return new Map(groups).set(edge.source, nextTargets);
  }, new Map());
  const frontierNodeIds = readFutureTimelineFrontierNodeIds(
    workflow,
    tasks,
    tokens,
    representedNodeIds,
  );

  return frontierNodeIds.reduce<ReadonlyMap<string, number>>(
    (distances, nodeId) =>
      mergeFutureNodeDistances(
        distances,
        readFutureNodeDistancesFrom(nodeId, outgoingNodeIds, futureNodeIds),
      ),
    new Map(),
  );
}

function readFutureTimelineFrontierNodeIds(
  workflow: WorkflowDefinition,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  representedNodeIds: ReadonlySet<string>,
): readonly string[] {
  const tokenNodeIds = tokens
    .filter((token) => token.status === 'ACTIVE' || token.status === 'WAITING')
    .map((token) => token.currentNodeId);
  const pendingTaskNodeIds = tasks
    .filter(isPendingTask)
    .map((task) => task.nodeId);
  const representedFrontierNodeIds = workflow.nodes
    .filter((node) => representedNodeIds.has(node.id))
    .map((node) => node.id);
  const activeFrontierNodeIds = [
    ...new Set([
      ...tokenNodeIds,
      ...pendingTaskNodeIds,
      ...representedFrontierNodeIds,
    ]),
  ];
  const startNodeIds = workflow.nodes
    .filter((node) => node.type === 'startEvent')
    .map((node) => node.id);

  return activeFrontierNodeIds.length > 0
    ? activeFrontierNodeIds
    : startNodeIds;
}

function readFutureNodeDistancesFrom(
  startNodeId: string,
  outgoingNodeIds: ReadonlyMap<string, readonly string[]>,
  futureNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const initialQueue: readonly {
    readonly distance: number;
    readonly nodeId: string;
  }[] = [{ distance: 0, nodeId: startNodeId }];

  return walkFutureNodeDistances(initialQueue, outgoingNodeIds, futureNodeIds);
}

function walkFutureNodeDistances(
  queue: readonly { readonly distance: number; readonly nodeId: string }[],
  outgoingNodeIds: ReadonlyMap<string, readonly string[]>,
  futureNodeIds: ReadonlySet<string>,
  visitedNodeIds: ReadonlySet<string> = new Set(),
  distances: ReadonlyMap<string, number> = new Map(),
): ReadonlyMap<string, number> {
  const [current, ...restQueue] = queue;

  if (!current) {
    return distances;
  }

  if (visitedNodeIds.has(current.nodeId)) {
    return walkFutureNodeDistances(
      restQueue,
      outgoingNodeIds,
      futureNodeIds,
      visitedNodeIds,
      distances,
    );
  }

  const nextVisitedNodeIds = new Set(visitedNodeIds).add(current.nodeId);
  const nextDistances = futureNodeIds.has(current.nodeId)
    ? new Map(distances).set(
        current.nodeId,
        Math.min(
          distances.get(current.nodeId) ?? current.distance,
          current.distance,
        ),
      )
    : distances;
  const nextQueue = [
    ...restQueue,
    ...(outgoingNodeIds.get(current.nodeId) ?? []).map((nodeId) => ({
      distance: current.distance + 1,
      nodeId,
    })),
  ];

  return walkFutureNodeDistances(
    nextQueue,
    outgoingNodeIds,
    futureNodeIds,
    nextVisitedNodeIds,
    nextDistances,
  );
}

function mergeFutureNodeDistances(
  currentDistances: ReadonlyMap<string, number>,
  nextDistances: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  return [...nextDistances.entries()].reduce<ReadonlyMap<string, number>>(
    (mergedDistances, [nodeId, distance]) =>
      new Map(mergedDistances).set(
        nodeId,
        Math.min(mergedDistances.get(nodeId) ?? distance, distance),
      ),
    currentDistances,
  );
}

function readFutureNodeStepTitle(node: WorkflowNode): string {
  if (node.type === 'userTask') {
    return `未來簽核：${node.data.label}`;
  }

  if (node.type === 'serviceTask') {
    return `未來知會：${node.data.label}`;
  }

  if (node.type === 'exclusiveGateway') {
    return `未來分流：${node.data.label}`;
  }

  if (node.type === 'parallelGateway') {
    return `未來匯合：${node.data.label}`;
  }

  if (node.type === 'endEvent') {
    return `流程完成：${node.data.label}`;
  }

  return `未來節點：${node.data.label}`;
}

function readActivityPayload(
  activityLog: ActivityLogRecord,
): Readonly<Record<string, unknown>> {
  try {
    const payload = JSON.parse(activityLog.payloadJson) as unknown;

    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

function readActivityEventLabel(
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  if (eventType === 'INSTANCE_STARTED') {
    return '案件已發起';
  }

  if (eventType === 'TOKEN_CREATED') {
    return '流程路徑已建立';
  }

  if (eventType === 'ENGINE_PROCESS_REQUESTED') {
    return '流程引擎已處理';
  }

  if (eventType === 'TOKEN_ADVANCED') {
    return '流程已前進';
  }

  if (eventType === 'TASK_CREATED') {
    return '待簽任務已建立';
  }

  if (eventType === 'TASK_DECIDED') {
    return readTaskDecisionEventLabel(readStringField(payload, 'action'));
  }

  if (eventType === 'SLA_TRIGGERED') {
    return '時限提醒已觸發';
  }

  return eventType;
}

function readTaskDecisionEventLabel(action: string | null): string {
  if (action === 'APPROVED') {
    return '已同意';
  }

  if (action === 'REJECTED') {
    return '已拒絕';
  }

  if (action === 'RETURNED') {
    return '已退回';
  }

  if (action === 'TRANSFERRED') {
    return '已轉派';
  }

  return '簽核已決議';
}

function readActivityDetail(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowDefinition | null,
): string | null {
  if (activityLog.eventType === 'TASK_CREATED') {
    const assigneeMemberId = readStringField(payload, 'assigneeMemberId');
    const originalAssigneeMemberId = readStringField(
      payload,
      'originalAssigneeMemberId',
    );

    if (!assigneeMemberId) {
      const candidateMemberIds = readStringArrayField(
        payload,
        'candidateMemberIds',
      );

      return candidateMemberIds.length
        ? `候選簽核人：${candidateMemberIds.join('、')}`
        : null;
    }

    return originalAssigneeMemberId &&
      originalAssigneeMemberId !== assigneeMemberId
      ? `待簽人：${assigneeMemberId}（原簽核人：${originalAssigneeMemberId}）`
      : `待簽人：${assigneeMemberId}`;
  }

  if (activityLog.eventType === 'TASK_DECIDED') {
    const action = readStringField(payload, 'action');
    const comment = readStringField(payload, 'comment');
    const decisionLabel = action
      ? `決議：${readTaskDecisionActionLabel(action)}`
      : null;

    const transferToMemberId = readStringField(payload, 'transferToMemberId');

    return action === 'REJECTED' && comment
      ? [decisionLabel, `拒絕原因：${comment}`]
          .filter(isPresentText)
          .join(' · ')
      : action === 'TRANSFERRED'
        ? [decisionLabel, `轉派給：${transferToMemberId ?? '-'}`]
            .filter(isPresentText)
            .join(' · ')
        : decisionLabel;
  }

  if (activityLog.eventType === 'TOKEN_ADVANCED') {
    const action = readStringField(payload, 'action');

    if (action) {
      return `流程結果：${readTaskDecisionActionLabel(action)}`;
    }

    const arrivedCount = readNumberField(payload, 'arrivedCount');
    const requiredCount = readNumberField(payload, 'requiredCount');

    if (arrivedCount !== null && requiredCount !== null) {
      return `等待匯合：${arrivedCount}/${requiredCount}`;
    }

    const fromNodeId = readStringField(payload, 'fromNodeId');
    const toNodeId = readStringField(payload, 'toNodeId');

    if (fromNodeId && toNodeId) {
      return `由 ${readNodeDisplayLabel(fromNodeId, workflow)} 前進至 ${readNodeDisplayLabel(toNodeId, workflow)}`;
    }
  }

  if (activityLog.eventType === 'ENGINE_PROCESS_REQUESTED') {
    const state = readStringField(payload, 'state');

    return state ? `案件狀態：${readInstanceStateLabel(state)}` : null;
  }

  return null;
}

function readActivityDetailParts(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowDefinition | null,
  taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  signatureVerification: SignatureVerificationRecord | null,
): readonly ActivityStepDescriptionPart[] {
  if (activityLog.eventType !== 'TASK_DECIDED') {
    return [
      readTextDescriptionPart(
        readActivityDetail(activityLog, payload, workflow),
      ),
    ].filter(isActivityDescriptionPart);
  }

  const taskDecision = activityLog.taskId
    ? taskDecisionsByTaskId.get(activityLog.taskId)
    : null;
  const action =
    readStringField(payload, 'action') ?? taskDecision?.action ?? null;
  const comment =
    readStringField(payload, 'comment') ?? taskDecision?.comment ?? null;
  const transferToMemberId =
    readStringField(payload, 'transferToMemberId') ??
    taskDecision?.transferToMemberId ??
    null;
  const signatureId =
    readStringField(payload, 'signatureId') ??
    taskDecision?.signatureId ??
    null;
  const signature = signatureId ? signaturesById.get(signatureId) : null;
  const decisionLabel = action
    ? `決議：${readTaskDecisionActionLabel(action)}`
    : null;

  return [
    readTextDescriptionPart(decisionLabel),
    action === 'REJECTED'
      ? readDangerTextDescriptionPart(`拒絕原因：${comment ?? '-'}`)
      : null,
    action === 'RETURNED'
      ? readTextDescriptionPart(`退回說明：${comment ?? '-'}`)
      : null,
    action === 'TRANSFERRED'
      ? readTextDescriptionPart(`轉派給：${transferToMemberId ?? '-'}`)
      : null,
    action === 'TRANSFERRED'
      ? readTextDescriptionPart(`轉派說明：${comment ?? '-'}`)
      : null,
    signature
      ? readTextDescriptionPart(
          signatureVerification?.valid
            ? `簽章：已驗證（${readShortHash(signature.signedPayloadHash)}）`
            : `簽章：待檢查（${readShortHash(signature.signedPayloadHash)}）`,
        )
      : null,
  ].filter(isActivityDescriptionPart);
}

function readActivityNodeLabel(
  nodeId: string | null,
  workflow: WorkflowDefinition | null,
): string | null {
  return nodeId ? readNodeDisplayLabel(nodeId, workflow) : null;
}

function readNodeDisplayLabel(
  nodeId: string,
  workflow: WorkflowDefinition | null,
): string {
  return (
    workflow?.nodes.find((node) => node.id === nodeId)?.data.label ?? nodeId
  );
}

function readReturnTargetOptions(
  workflow: WorkflowDefinition,
  node: WorkflowNode,
): readonly { readonly id: string; readonly name: string }[] {
  if (node.type !== 'userTask' || !node.data.returnBehavior.allowReturn) {
    return [];
  }

  if (node.data.returnBehavior.allowedTargets === 'ANY') {
    return workflow.nodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        id: candidate.id,
        name: `${candidate.data.label}（${readNodeKindLabel(candidate.type)}）`,
      }));
  }

  const targetNodeId =
    node.data.returnBehavior.allowedTargets === 'INITIATOR'
      ? workflow.nodes.find((candidate) => candidate.type === 'startEvent')?.id
      : workflow.edges.find((edge) => edge.target === node.id)?.source;
  const targetNode = workflow.nodes.find(
    (candidate) => candidate.id === targetNodeId,
  );

  return targetNode
    ? [
        {
          id: targetNode.id,
          name: `${targetNode.data.label}（${readNodeKindLabel(
            targetNode.type,
          )}）`,
        },
      ]
    : [];
}

function readTaskDecisionActionLabel(action: string): string {
  if (action === 'APPROVED') {
    return '同意';
  }

  if (action === 'REJECTED') {
    return '拒絕';
  }

  if (action === 'RETURNED') {
    return '退回';
  }

  if (action === 'TRANSFERRED') {
    return '轉派';
  }

  return action;
}

function readTaskStatusLabel(status: TaskRecord['status']): string {
  if (status === 'PENDING') {
    return '待處理';
  }

  if (status === 'IN_PROGRESS') {
    return '處理中';
  }

  if (status === 'COMPLETED') {
    return '已完成';
  }

  if (status === 'CANCELLED') {
    return '已取消';
  }

  if (status === 'TRANSFERRED') {
    return '已轉派';
  }

  return status;
}

function readTaskAssigneeLabel(task: TaskRecord): string {
  const delegationChain = readDelegationChain(task.delegationChainJson);

  if (!task.assigneeMemberId) {
    return task.candidateMemberIds.length
      ? `候選 ${task.candidateMemberIds.join('、')}`
      : '未指定';
  }

  if (
    delegationChain.length === 0 ||
    task.originalAssigneeMemberId === task.assigneeMemberId
  ) {
    return task.assigneeMemberId;
  }

  return `${task.assigneeMemberId}（原：${task.originalAssigneeMemberId}）`;
}

function canMemberActOnTask(
  task: TaskRecord,
  memberId: string | null,
): boolean {
  if (!memberId) {
    return false;
  }

  return (
    task.assigneeMemberId === memberId ||
    task.candidateMemberIds.includes(memberId)
  );
}

function readInstanceStateLabel(state: string): string {
  if (state === 'APPROVED') {
    return '已同意';
  }

  if (state === 'CANCELLED') {
    return '已取消';
  }

  if (state === 'DRAFT') {
    return '草稿';
  }

  if (state === 'EXPIRED') {
    return '已逾期';
  }

  if (state === 'REJECTED') {
    return '已拒絕';
  }

  if (state === 'RETURNED') {
    return '已退回';
  }

  if (state === 'RUNNING') {
    return '進行中';
  }

  return state;
}

function isActivityError(
  activityLog: ActivityLogRecord,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return (
    activityLog.eventType === 'SLA_TRIGGERED' ||
    readStringField(payload, 'action') === 'REJECTED' ||
    readStringField(payload, 'instanceState') === 'REJECTED'
  );
}

function formatActivityDateTime(value: string): string {
  return formatDateTime(value);
}

function readStringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];

  return typeof value === 'string' ? value : null;
}

function readStringArrayField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readMemberOption(member: MemberProfileRecord): MemberOption {
  return {
    email: member.email,
    id: member.memberId,
    name: `${member.name} · ${member.email}`,
  };
}

function readMemberOptionFromValue(value: unknown): MemberOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const email = value.email;
  const id = value.id;
  const name = value.name;

  return typeof id === 'string' && typeof name === 'string'
    ? { email: typeof email === 'string' ? email : null, id, name }
    : null;
}

function readUniqueMemberOption(
  searchText: string,
  options: readonly MemberOption[],
): MemberOption | null {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return null;
  }

  const matches = options.filter((option) =>
    [option.id, option.name, option.email ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearchText),
    ),
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

interface DelegationChainStep {
  readonly from: string;
  readonly reason: string;
  readonly ruleId: string | null;
  readonly to: string;
}

function readDelegationChain(value: string): readonly DelegationChainStep[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed
          .map((item): DelegationChainStep | null =>
            isRecord(item) ? readDelegationChainStep(item) : null,
          )
          .filter((item): item is DelegationChainStep => item !== null)
      : [];
  } catch {
    return [];
  }
}

function readDelegationChainStep(
  item: Readonly<Record<string, unknown>>,
): DelegationChainStep | null {
  const from = readStringField(item, 'from');
  const to = readStringField(item, 'to');
  const reason = readStringField(item, 'reason');

  if (!from || !to || !reason) {
    return null;
  }

  return {
    from,
    reason,
    ruleId: readStringField(item, 'ruleId'),
    to,
  };
}

function readNumberField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = record[key];

  return typeof value === 'number' ? value : null;
}

function isPresentText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPendingTask(task: TaskRecord): boolean {
  return task.status === 'PENDING' || task.status === 'IN_PROGRESS';
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

function readNodeRuntimeState(
  node: WorkflowNode,
  tasks: readonly TaskRecord[],
  tokens: readonly WorkflowTokenRecord[],
  instanceState: string,
): Readonly<{
  secondaryLabel: string;
  statusLabel: string;
  tone: RuntimeTone;
}> {
  const nodeTasks = tasks.filter((task) => task.nodeId === node.id);
  const pendingTask = nodeTasks.find(
    (task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS',
  );
  const cancelledTask = nodeTasks.find((task) => task.status === 'CANCELLED');
  const completedTask = nodeTasks.find((task) => task.status === 'COMPLETED');
  const nodeTokens = tokens.filter((token) => token.currentNodeId === node.id);
  const activeToken = nodeTokens.find((token) => token.status === 'ACTIVE');
  const waitingToken = nodeTokens.find((token) => token.status === 'WAITING');

  if (pendingTask) {
    return {
      secondaryLabel: `處理者 ${readTaskAssigneeLabel(pendingTask)}`,
      statusLabel: '待處理',
      tone: 'current',
    };
  }

  if (cancelledTask) {
    return {
      secondaryLabel: `已取消 ${readTaskAssigneeLabel(cancelledTask)}`,
      statusLabel: '已取消',
      tone: 'cancelled',
    };
  }

  if (completedTask) {
    return {
      secondaryLabel: `已完成 ${readTaskAssigneeLabel(completedTask)}`,
      statusLabel: '已完成',
      tone: 'completed',
    };
  }

  if (activeToken) {
    return {
      secondaryLabel: `token ${activeToken.id}`,
      statusLabel: '執行中',
      tone: 'current',
    };
  }

  if (waitingToken) {
    return {
      secondaryLabel: `token ${waitingToken.id}`,
      statusLabel: '等待前置',
      tone: 'waiting',
    };
  }

  if (node.type === 'startEvent') {
    return {
      secondaryLabel: '流程已發起',
      statusLabel: '已發起',
      tone: 'completed',
    };
  }

  if (node.type === 'endEvent' && instanceState !== 'RUNNING') {
    return {
      secondaryLabel: instanceState,
      statusLabel: instanceState === 'REJECTED' ? '已拒絕' : '已完成',
      tone: instanceState === 'REJECTED' ? 'cancelled' : 'completed',
    };
  }

  return {
    secondaryLabel: readNodeKindLabel(node.type),
    statusLabel: '未抵達',
    tone: 'neutral',
  };
}

function readNodeKindLabel(type: WorkflowNode['type']): string {
  if (type === 'startEvent') {
    return '開始';
  }

  if (type === 'endEvent') {
    return '完成';
  }

  if (type === 'userTask') {
    return '簽核節點';
  }

  if (type === 'serviceTask') {
    return '知會節點';
  }

  if (type === 'exclusiveGateway') {
    return '條件分流';
  }

  return '平行處理';
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
