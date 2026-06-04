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
  Modal,
  Select,
  Table,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import {
  ApprovalInstanceRecord,
  MemberProfileRecord,
  TaskRecord,
  decideTask,
  searchMembers,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';
import { BPMFormField } from '../../../../components/bpm-form-field';
import {
  MemberOption,
  TaskRow,
  canMemberActOnTask,
  readErrorMessage,
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
export interface InstanceTasksSectionHandle {
  /** Whether a task action (decision) is currently in flight. */
  readonly deciding: boolean;
  /** Whether the current user has an actionable pending task. */
  readonly hasCurrentTask: boolean;
  /** Whether the current task's node allows a return action. */
  readonly canReturnCurrentTask: boolean;
  /** Opens the reject-reason modal. */
  openRejectModal(): void;
  /** Opens the return modal. */
  openReturnModal(): void;
  /** Opens the transfer modal. */
  openTransferModal(): void;
  /** Submits an APPROVED decision immediately (no modal needed). */
  handleApprove(): void;
}

export interface InstanceTasksSectionProps {
  /** All tasks for this instance. */
  readonly tasks: readonly TaskRecord[];
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
        nodeLabel: readNodeDisplayLabel(
          task.nodeId,
          instance?.workflowSnapshot ?? null,
        ),
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
      await onChanged();
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

  // Expose imperative handle so the container's PageHeader buttons can
  // trigger actions without lifting all modal state up.
  useImperativeHandle(
    ref,
    (): InstanceTasksSectionHandle => ({
      canReturnCurrentTask,
      deciding,
      handleApprove: (): void => {
        void handleDecision({ action: 'APPROVED', comment: null });
      },
      hasCurrentTask: currentTask !== null,
      openRejectModal: openRejectReasonModal,
      openReturnModal,
      openTransferModal,
    }),
    [canReturnCurrentTask, currentTask, deciding],
  );

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
      <Table columns={taskColumns} dataSource={taskRows} fullWidth />

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
    </>
  );
});
