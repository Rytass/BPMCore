'use client';

import {
  ChangeEvent,
  CSSProperties,
  forwardRef,
  ReactElement,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  AutoComplete,
  Button,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import {
  AdhocDirectiveRecord,
  AdhocPreApprovalRejectBehavior,
  ApprovalInstanceRecord,
  MemberProfileRecord,
  TaskRecord,
  cancelAdhocDirective,
  configureAdhocCompletionNotification,
  configureAdhocStageNotification,
  decideTask,
  requestAdhocCountersign,
  requestAdhocPreApproval,
  searchMembers,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';
import { BPMFormField } from '../../../../components/bpm-form-field';
import {
  MemberOption,
  TaskRow,
  canMemberActOnTask,
  readErrorMessage,
  readMemberDisplayText,
  readMemberOption,
  readMemberOptionFromValue,
  readNodeDisplayLabel,
  readReturnTargetOptions,
  readTaskAssigneeLabel,
  readTaskStatusLabel,
  readUniqueMemberOption,
} from './shared';

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

const SECTION_TABLE_STYLE: CSSProperties = {
  marginTop: 12,
};

const SECTION_SUBHEADING_STYLE: CSSProperties = {
  marginTop: 24,
};

function applyFullWidthTextareaHost(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }

  element.style.width = '100%';
}

/**
 * Imperative handle exposed by InstanceTasksSection via ref.
 * The container uses these to wire PageHeader action buttons to the
 * section's internal modal state without lifting state up.
 */
export type AdhocActionMode =
  | 'COMPLETION_NOTIFY'
  | 'COUNTERSIGN'
  | 'PRE_APPROVAL'
  | 'STAGE_NOTIFY';

export interface InstanceTasksSectionHandle {
  /** Whether a task action (decision) is currently in flight. */
  readonly deciding: boolean;
  /** Whether the current user has an actionable pending task. */
  readonly hasCurrentTask: boolean;
  /** Whether the current task's node allows a return action. */
  readonly canReturnCurrentTask: boolean;
  /** Whether the current task's node allows a reject action. */
  readonly canRejectCurrentTask: boolean;
  /** Whether the current task's node allows a transfer action. */
  readonly canTransferCurrentTask: boolean;
  /** Whether the current task's node allows ad-hoc countersign/pre-approval. */
  readonly canAddSignerCurrentTask: boolean;
  /** Opens the reject-reason modal. */
  openRejectModal(): void;
  /** Opens the return modal. */
  openReturnModal(): void;
  /** Opens the transfer modal. */
  openTransferModal(): void;
  /** Opens the ad-hoc action modal in the given mode. */
  openAdhocModal(mode: AdhocActionMode): void;
  /** Opens the approve-comment modal. */
  handleApprove(): void;
}

export interface InstanceTasksSectionProps {
  /** All tasks for this instance. */
  readonly tasks: readonly TaskRecord[];
  /** Ad-hoc directives recorded on this instance. */
  readonly adhocDirectives: readonly AdhocDirectiveRecord[];
  /** The loaded approval instance (used to read workflowSnapshot node labels). */
  readonly instance: ApprovalInstanceRecord | null;
  /** Member profiles indexed by memberId, for displaying assignee labels. */
  readonly memberProfilesById: ReadonlyMap<string, MemberProfileRecord>;
  /** The currently authenticated member's id. */
  readonly currentMemberId: string | null;
  /**
   * Called after any task decision action (approve / reject / return /
   * transfer) completes successfully. The container should refresh data.
   */
  readonly onChanged: () => void | Promise<void>;
}

const ADHOC_MODE_LABELS: Readonly<Record<AdhocActionMode, string>> = {
  COMPLETION_NOTIFY: '結案通知',
  COUNTERSIGN: '臨時會簽',
  PRE_APPROVAL: '臨時加簽',
  STAGE_NOTIFY: '階段完成通知',
};

const ADHOC_MODE_SUPPORTING_TEXT: Readonly<Record<AdhocActionMode, string>> = {
  COMPLETION_NOTIFY: '本張單到達結案狀態（核准 / 拒絕 / 取消）後，通知指定對象。',
  COUNTERSIGN: '指定對象會併入下一層簽核，下一層需所有人都完成才會繼續。',
  PRE_APPROVAL: '指定對象需先完成加簽，本階段才會往下一層繼續。',
  STAGE_NOTIFY: '本階段完成後（不論通過與否）通知指定對象。',
};

const ADHOC_ON_REJECT_OPTIONS: readonly {
  readonly id: AdhocPreApprovalRejectBehavior;
  readonly name: string;
}[] = [
  { id: 'REJECT_INSTANCE', name: '加簽拒絕時整單駁回' },
  { id: 'RETURN_TO_ORIGIN', name: '加簽拒絕時退回給我重新處理' },
];

const ADHOC_NOTIFY_TARGET_OPTIONS: readonly {
  readonly id: 'MEMBER' | 'WEBHOOK';
  readonly name: string;
}[] = [
  { id: 'MEMBER', name: '指定成員' },
  { id: 'WEBHOOK', name: 'Webhook' },
];

type AdhocDirectiveRow = Readonly<
  Record<string, unknown> &
    AdhocDirectiveRecord & {
      createdByLabel: string;
      key: string;
      targetLabel: string;
      typeLabel: string;
    }
>;

/**
 * Renders the tasks section of the approval instance detail page.
 * Contains the task table plus all decision action modals
 * (reject, return, transfer). Approve is also handled here via the
 * imperative handle exposed through the forwarded ref.
 */
export const InstanceTasksSection = forwardRef<
  InstanceTasksSectionHandle,
  InstanceTasksSectionProps
>(function InstanceTasksSection(
  {
    adhocDirectives,
    currentMemberId,
    instance,
    memberProfilesById,
    onChanged,
    tasks,
  }: InstanceTasksSectionProps,
  ref,
): ReactElement {
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approve modal — the comment is optional here, unlike the reject reason.
  // Approving used to submit straight from the header button, so the decision
  // comment could never be filled in even though the API has always taken one.
  const [approveComment, setApproveComment] = useState('');
  const [approveModalOpen, setApproveModalOpen] = useState(false);

  // Reject modal
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null);
  const [rejectReasonModalOpen, setRejectReasonModalOpen] = useState(false);

  // Return modal
  const [returnComment, setReturnComment] = useState('');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTargetNodeId, setReturnTargetNodeId] = useState<string | null>(null);

  // Transfer modal
  const [transferComment, setTransferComment] = useState('');
  const [transferMember, setTransferMember] = useState<MemberOption | null>(null);
  const [transferMemberLoading, setTransferMemberLoading] = useState(false);
  const [transferMemberOptions, setTransferMemberOptions] = useState<
    readonly MemberOption[]
  >([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);

  // Ad-hoc modal (countersign / pre-approval / stage & completion notify)
  const [adhocComment, setAdhocComment] = useState('');
  const [adhocMember, setAdhocMember] = useState<MemberOption | null>(null);
  const [adhocMemberLoading, setAdhocMemberLoading] = useState(false);
  const [adhocMemberOptions, setAdhocMemberOptions] = useState<
    readonly MemberOption[]
  >([]);
  const [adhocModalOpen, setAdhocModalOpen] = useState(false);
  const [adhocMode, setAdhocMode] = useState<AdhocActionMode>('COUNTERSIGN');
  const [adhocOnReject, setAdhocOnReject] =
    useState<AdhocPreApprovalRejectBehavior>('REJECT_INSTANCE');
  const [adhocSubmitting, setAdhocSubmitting] = useState(false);
  const [adhocTargetKind, setAdhocTargetKind] = useState<'MEMBER' | 'WEBHOOK'>(
    'MEMBER',
  );
  const [adhocWebhookUrl, setAdhocWebhookUrl] = useState('');

  const trimmedRejectReason = rejectReason.trim();
  const trimmedReturnComment = returnComment.trim();
  const trimmedTransferComment = transferComment.trim();

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
    () =>
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

  // Older workflow snapshots may not carry these fields. Preserve their
  // historical behaviour and only disable an action when it is explicitly
  // set to false.
  const canRejectCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.allowReject !== false;
  const canTransferCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.allowTransfer !== false;

  // Mirrors the engine rule so the approver is stopped in the modal instead of
  // by a server error after submitting.
  const returnCommentRequired =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.returnBehavior.requireComment === true;

  const canAddSignerCurrentTask =
    currentTaskNode?.type === 'userTask' &&
    currentTaskNode.data.allowAddSigner;

  const pendingAdhocDirectives = useMemo(
    (): readonly AdhocDirectiveRecord[] =>
      adhocDirectives.filter((directive) => directive.status === 'PENDING'),
    [adhocDirectives],
  );

  const selectedReturnTargetOption =
    returnTargetOptions.find((option) => option.id === returnTargetNodeId) ??
    returnTargetOptions[0] ??
    null;

  const taskRows = useMemo(
    (): TaskRow[] =>
      tasks.map((task) => ({
        ...task,
        assigneeLabel: readTaskAssigneeLabel(task, memberProfilesById),
        key: task.id,
        nodeLabel: `${readNodeDisplayLabel(
          task.nodeId,
          instance?.workflowSnapshot ?? null,
        )}${
          task.isAdhoc
            ? task.adhocType === 'COUNTERSIGN'
              ? '（臨時會簽）'
              : '（臨時加簽）'
            : ''
        }`,
        statusLabel: readTaskStatusLabel(task.status),
      })),
    [instance, memberProfilesById, tasks],
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

  const adhocDirectiveRows = useMemo(
    (): AdhocDirectiveRow[] =>
      pendingAdhocDirectives.map((directive) => ({
        ...directive,
        createdByLabel: readMemberDisplayText(
          directive.createdByMemberId,
          memberProfilesById,
        ),
        key: directive.id,
        targetLabel: readAdhocDirectiveTargetLabel(
          directive,
          memberProfilesById,
        ),
        typeLabel: ADHOC_MODE_LABELS[directive.type],
      })),
    [memberProfilesById, pendingAdhocDirectives],
  );

  const adhocDirectiveColumns = useMemo(
    (): TableColumn<AdhocDirectiveRow>[] => [
      {
        dataIndex: 'typeLabel',
        key: 'typeLabel',
        title: '類型',
        width: 180,
      },
      {
        key: 'targetLabel',
        render: (record: AdhocDirectiveRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.targetLabel}
          </Typography>
        ),
        title: '對象',
        width: 220,
      },
      {
        key: 'createdByLabel',
        render: (record: AdhocDirectiveRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.createdByLabel}
          </Typography>
        ),
        title: '設定者',
        width: 180,
      },
      {
        key: 'createdAt',
        render: (record: AdhocDirectiveRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.createdAt)}
          </Typography>
        ),
        title: '建立時間',
        width: 220,
      },
      {
        key: 'actions',
        render: (record: AdhocDirectiveRow): ReactElement =>
          record.createdByMemberId === currentMemberId ? (
            <Button
              disabled={adhocSubmitting}
              onClick={(): void =>
                void handleCancelAdhocDirective(record.id)
              }
              size="minor"
              variant="destructive-secondary"
            >
              撤回
            </Button>
          ) : (
            <></>
          ),
        title: '操作',
        width: 100,
      },
    ],
    [adhocSubmitting, currentMemberId],
  );

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
  }>): Promise<boolean> {
    if (!currentMemberId || !currentTask) {
      return false;
    }

    if (action === 'REJECTED' && !canRejectCurrentTask) {
      return false;
    }

    if (action === 'TRANSFERRED' && !canTransferCurrentTask) {
      return false;
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
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
      setDeciding(false);

      return false;
    }

    try {
      await onChanged();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeciding(false);
    }

    return true;
  }

  function openApproveModal(): void {
    if (!currentMemberId || !currentTask) {
      return;
    }

    setError(null);
    setApproveComment('');
    setApproveModalOpen(true);
  }

  function closeApproveModal(): void {
    if (deciding) {
      return;
    }

    setApproveModalOpen(false);
    setApproveComment('');
  }

  async function handleApproveConfirm(): Promise<void> {
    if (deciding) {
      return;
    }

    const succeeded = await handleDecision({
      action: 'APPROVED',
      comment: approveComment.trim() || null,
    });

    if (!succeeded) {
      return;
    }

    setApproveModalOpen(false);
    setApproveComment('');
  }

  function openRejectReasonModal(): void {
    if (!canRejectCurrentTask) {
      return;
    }

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
    if (!canTransferCurrentTask) {
      return;
    }

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
          .filter(
            (searchedMember) => searchedMember.memberId !== currentMemberId,
          )
          .map(readMemberOption),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setTransferMemberLoading(false);
    }
  }

  async function handleRejectConfirm(): Promise<void> {
    if (!canRejectCurrentTask) {
      return;
    }

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
    if (!canTransferCurrentTask) {
      return;
    }

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

  function resetAdhocModalState(): void {
    setAdhocComment('');
    setAdhocMember(null);
    setAdhocOnReject('REJECT_INSTANCE');
    setAdhocTargetKind('MEMBER');
    setAdhocWebhookUrl('');
  }

  function openAdhocModal(mode: AdhocActionMode): void {
    setAdhocMode(mode);
    resetAdhocModalState();
    setAdhocModalOpen(true);
    void handleSearchAdhocMembers('');
  }

  function closeAdhocModal(): void {
    if (adhocSubmitting) {
      return;
    }

    setAdhocModalOpen(false);
    resetAdhocModalState();
  }

  async function handleSearchAdhocMembers(searchText: string): Promise<void> {
    setAdhocMemberLoading(true);

    try {
      setAdhocMemberOptions(
        (await searchMembers(searchText)).map(readMemberOption),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setAdhocMemberLoading(false);
    }
  }

  async function handleAdhocConfirm(): Promise<void> {
    if (!currentTask) {
      return;
    }

    const isNotifyMode =
      adhocMode === 'STAGE_NOTIFY' || adhocMode === 'COMPLETION_NOTIFY';
    const useWebhookTarget = isNotifyMode && adhocTargetKind === 'WEBHOOK';
    const trimmedWebhookUrl = adhocWebhookUrl.trim();
    const selectedMember = adhocMember;

    if (useWebhookTarget && !trimmedWebhookUrl) {
      setError('請輸入 Webhook URL');

      return;
    }

    if (!useWebhookTarget && !selectedMember) {
      setError('請選擇對象成員');

      return;
    }

    const target =
      useWebhookTarget || !selectedMember
        ? { kind: 'WEBHOOK' as const, webhookUrl: trimmedWebhookUrl }
        : { kind: 'MEMBER' as const, memberIds: [selectedMember.id] };
    const trimmedAdhocComment = adhocComment.trim() || null;

    setAdhocSubmitting(true);
    setError(null);

    try {
      if (adhocMode === 'COUNTERSIGN') {
        await requestAdhocCountersign({
          comment: trimmedAdhocComment,
          target,
          taskId: currentTask.id,
        });
      } else if (adhocMode === 'PRE_APPROVAL') {
        await requestAdhocPreApproval({
          comment: trimmedAdhocComment,
          onReject: adhocOnReject,
          target,
          taskId: currentTask.id,
        });
      } else if (adhocMode === 'STAGE_NOTIFY') {
        await configureAdhocStageNotification({
          target,
          taskId: currentTask.id,
        });
      } else {
        await configureAdhocCompletionNotification({
          target,
          taskId: currentTask.id,
        });
      }

      setAdhocModalOpen(false);
      resetAdhocModalState();
      await onChanged();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setAdhocSubmitting(false);
    }
  }

  async function handleCancelAdhocDirective(directiveId: string): Promise<void> {
    setAdhocSubmitting(true);
    setError(null);

    try {
      await cancelAdhocDirective(directiveId);
      await onChanged();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setAdhocSubmitting(false);
    }
  }

  // Expose imperative handle so the container's PageHeader buttons can
  // trigger actions without lifting all modal state up.
  useImperativeHandle(
    ref,
    (): InstanceTasksSectionHandle => ({
      canAddSignerCurrentTask,
      canRejectCurrentTask,
      canReturnCurrentTask,
      canTransferCurrentTask,
      deciding,
      handleApprove: openApproveModal,
      hasCurrentTask: currentTask !== null,
      openAdhocModal,
      openRejectModal: openRejectReasonModal,
      openReturnModal,
      openTransferModal,
    }),
    [
      canAddSignerCurrentTask,
      canRejectCurrentTask,
      canReturnCurrentTask,
      canTransferCurrentTask,
      currentMemberId,
      currentTask,
      deciding,
    ],
  );

  const isAdhocNotifyMode =
    adhocMode === 'STAGE_NOTIFY' || adhocMode === 'COMPLETION_NOTIFY';
  const adhocConfirmDisabled =
    isAdhocNotifyMode && adhocTargetKind === 'WEBHOOK'
      ? !adhocWebhookUrl.trim()
      : !adhocMember;
  const selectedAdhocOnRejectOption =
    ADHOC_ON_REJECT_OPTIONS.find((option) => option.id === adhocOnReject) ??
    ADHOC_ON_REJECT_OPTIONS[0];
  const selectedAdhocNotifyTargetOption =
    ADHOC_NOTIFY_TARGET_OPTIONS.find(
      (option) => option.id === adhocTargetKind,
    ) ?? ADHOC_NOTIFY_TARGET_OPTIONS[0];

  return (
    <>
      <Typography component="h2" variant="h3">
        任務
      </Typography>
      {error ? (
        <Typography color="text-error" variant="body">
          {error}
        </Typography>
      ) : null}
      <div style={SECTION_TABLE_STYLE}>
        <Table columns={taskColumns} dataSource={taskRows} fullWidth />
      </div>

      {pendingAdhocDirectives.length > 0 ? (
        <>
          <Typography component="h3" style={SECTION_SUBHEADING_STYLE} variant="h3">
            待生效的臨時設定
          </Typography>
          <div style={SECTION_TABLE_STYLE}>
            <Table
              columns={adhocDirectiveColumns}
              dataSource={adhocDirectiveRows}
              fullWidth
            />
          </div>
        </>
      ) : null}

      {/* Approve modal — comment is optional, so the confirm button stays enabled */}
      <Modal
        cancelText="取消"
        confirmText="送出同意"
        loading={deciding}
        modalType="standard"
        onCancel={closeApproveModal}
        onClose={closeApproveModal}
        onConfirm={(): void => void handleApproveConfirm()}
        open={approveModalOpen}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText="可以留下同意的說明，內容會記錄在簽核歷程；不填也可以直接送出。"
        title="簽核意見"
      >
        {error ? (
          <Typography color="text-error" role="alert" variant="body">
            {error}
          </Typography>
        ) : null}
        <div style={REJECT_REASON_FORM_STYLE}>
          <BPMFormField label="簽核意見" name="approveComment">
            <Textarea
              autoFocus
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setApproveComment(event.target.value)
              }
              placeholder="選填，例如補充核准的條件或提醒事項"
              ref={applyFullWidthTextareaHost}
              resize="vertical"
              rows={4}
              style={REJECT_REASON_TEXTAREA_STYLE}
              value={approveComment}
            />
          </BPMFormField>
        </div>
      </Modal>

      {/* Reject modal */}
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

      {/* Transfer modal */}
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

      {/* Return modal */}
      <Modal
        cancelText="取消"
        confirmButtonProps={{
          disabled:
            !selectedReturnTargetOption ||
            (returnCommentRequired && !trimmedReturnComment),
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
          <BPMFormField
            hintText={
              returnCommentRequired ? '此關卡設定退回時必須填寫意見。' : undefined
            }
            label="退回說明"
            name="returnComment"
            required={returnCommentRequired}
          >
            <Textarea
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReturnComment(event.target.value)
              }
              placeholder={
                returnCommentRequired
                  ? '請說明退回原因'
                  : '可補充需要修改的內容'
              }
              ref={applyFullWidthTextareaHost}
              resize="vertical"
              rows={4}
              style={REJECT_REASON_TEXTAREA_STYLE}
              value={returnComment}
            />
          </BPMFormField>
        </div>
      </Modal>

      {/* Ad-hoc countersign / pre-approval / notify modal */}
      <Modal
        cancelText="取消"
        confirmButtonProps={{
          disabled: adhocConfirmDisabled,
        }}
        confirmText="送出"
        loading={adhocSubmitting}
        modalType="standard"
        onCancel={closeAdhocModal}
        onClose={closeAdhocModal}
        onConfirm={(): void => void handleAdhocConfirm()}
        open={adhocModalOpen}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText={ADHOC_MODE_SUPPORTING_TEXT[adhocMode]}
        title={ADHOC_MODE_LABELS[adhocMode]}
      >
        <div style={MODAL_FORM_STYLE}>
          {isAdhocNotifyMode ? (
            <BPMFormField label="通知時機" name="adhocNotifyMode" required>
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setAdhocMode(
                    option?.id === 'COMPLETION_NOTIFY'
                      ? 'COMPLETION_NOTIFY'
                      : 'STAGE_NOTIFY',
                  )
                }
                options={[
                  { id: 'STAGE_NOTIFY', name: ADHOC_MODE_LABELS.STAGE_NOTIFY },
                  {
                    id: 'COMPLETION_NOTIFY',
                    name: ADHOC_MODE_LABELS.COMPLETION_NOTIFY,
                  },
                ]}
                value={{
                  id: adhocMode,
                  name: ADHOC_MODE_LABELS[adhocMode],
                }}
              />
            </BPMFormField>
          ) : null}
          {isAdhocNotifyMode ? (
            <BPMFormField label="通知對象類型" name="adhocTargetKind" required>
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setAdhocTargetKind(
                    option?.id === 'WEBHOOK' ? 'WEBHOOK' : 'MEMBER',
                  )
                }
                options={[...ADHOC_NOTIFY_TARGET_OPTIONS]}
                value={selectedAdhocNotifyTargetOption}
              />
            </BPMFormField>
          ) : null}
          {isAdhocNotifyMode && adhocTargetKind === 'WEBHOOK' ? (
            <BPMFormField label="Webhook URL" name="adhocWebhookUrl" required>
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setAdhocWebhookUrl(event.target.value)
                }
                placeholder="https://example.com/webhook"
                value={adhocWebhookUrl}
              />
            </BPMFormField>
          ) : (
            <BPMFormField
              label={isAdhocNotifyMode ? '通知對象' : '簽核對象'}
              name="adhocMemberId"
              required
            >
              <AutoComplete
                asyncData
                disabledOptionsFilter
                emptyText="沒有符合的成員"
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  name: 'adhoc-member-search',
                  spellCheck: false,
                }}
                loading={adhocMemberLoading}
                loadingText="搜尋成員中..."
                mode="single"
                onChange={(option): void =>
                  setAdhocMember(readMemberOptionFromValue(option))
                }
                onSearch={handleSearchAdhocMembers}
                onSearchTextChange={(searchText): void =>
                  setAdhocMember(
                    readUniqueMemberOption(searchText, adhocMemberOptions),
                  )
                }
                onVisibilityChange={(open): void => {
                  if (open) {
                    void handleSearchAdhocMembers('');
                  }
                }}
                options={[...adhocMemberOptions]}
                placeholder="搜尋姓名或信箱"
                searchDebounceTime={300}
                value={adhocMember}
              />
            </BPMFormField>
          )}
          {adhocMode === 'PRE_APPROVAL' ? (
            <BPMFormField label="拒簽處理方式" name="adhocOnReject" required>
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setAdhocOnReject(
                    option?.id === 'RETURN_TO_ORIGIN'
                      ? 'RETURN_TO_ORIGIN'
                      : 'REJECT_INSTANCE',
                  )
                }
                options={[...ADHOC_ON_REJECT_OPTIONS]}
                value={selectedAdhocOnRejectOption}
              />
            </BPMFormField>
          ) : null}
          {!isAdhocNotifyMode ? (
            <BPMFormField label="說明" name="adhocComment">
              <Textarea
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setAdhocComment(event.target.value)
                }
                placeholder="可補充原因"
                ref={applyFullWidthTextareaHost}
                resize="vertical"
                rows={3}
                style={REJECT_REASON_TEXTAREA_STYLE}
                value={adhocComment}
              />
            </BPMFormField>
          ) : null}
        </div>
      </Modal>
    </>
  );
});

function readAdhocDirectiveTargetLabel(
  directive: AdhocDirectiveRecord,
  memberProfilesById: ReadonlyMap<string, MemberProfileRecord>,
): string {
  try {
    const value = JSON.parse(directive.targetValueJson) as {
      readonly memberIds?: readonly string[];
      readonly orgUnitId?: string;
      readonly positionId?: string;
      readonly webhookUrl?: string;
    };

    if (value.memberIds?.length) {
      return value.memberIds
        .map(
          (memberId) => readMemberDisplayText(memberId, memberProfilesById),
        )
        .join('、');
    }

    if (value.webhookUrl) {
      return value.webhookUrl;
    }

    if (value.positionId) {
      return `職位 ${value.positionId}`;
    }

    if (value.orgUnitId) {
      return `部門 ${value.orgUnitId}`;
    }
  } catch {
    // Fall through to the kind label below.
  }

  return directive.targetKind;
}
