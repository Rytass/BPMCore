'use client';

import {
  ChangeEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Input, Modal, Table, Typography } from '@mezzanine-ui/react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import type { MemberProfileRecord } from '@rytass/bpm-core-client';
import {
  listMemberOpenTasks,
  type MemberOpenTaskRecord,
  reassignMemberTasks,
  type TaskReassignmentResultRecord,
} from '@rytass/bpm-core-client/workflow';
import { BPMFormField } from '../../../components/bpm-form-field';
import { MemberOption, MemberPicker } from '../../../components/admin-pickers';
import styles from './users.module.scss';

type TaskRow = Readonly<
  Record<string, unknown> &
    MemberOpenTaskRecord & {
      key: string;
    }
>;

type ResultRow = Readonly<
  Record<string, unknown> & {
    instanceTitle: string;
    key: string;
    message: string | null;
    outcomeLabel: string;
  }
>;

/**
 * Both states keep what was sent and the titles it was sent with: the server
 * skips an id the member no longer holds (no result row for it), and a commit
 * reloads the task list, so neither can be recovered from the current list.
 */
interface PreviewState {
  readonly inputKey: string;
  readonly results: readonly TaskReassignmentResultRecord[];
  readonly sentTaskIds: readonly string[];
  readonly titleById: ReadonlyMap<string, string>;
}

interface CommittedState {
  readonly results: readonly TaskReassignmentResultRecord[];
  readonly sentTaskIds: readonly string[];
  readonly titleById: ReadonlyMap<string, string>;
}

const TASK_GONE_LABEL = '已不在此人的待辦中';

/**
 * Administrator reassignment of a member's open tasks. Lists what the member
 * holds, takes a target and a reason, previews every task's outcome (dry run),
 * and only then commits. Confirm stays disabled until the preview matches the
 * current target and reason. Replacing a seat is not a decision: no signature
 * is written, and the task keeps its id.
 */
export function MemberTaskReassignModal({
  member,
  onClose,
}: {
  readonly member: MemberProfileRecord | null;
  readonly onClose: () => void;
}): ReactElement {
  const [tasks, setTasks] = useState<readonly MemberOpenTaskRecord[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([]);
  const [target, setTarget] = useState<MemberOption | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [committed, setCommitted] = useState<CommittedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ids to send are the checked ones that the current list still holds, so
  // a stale check (other member, reloaded list) never reaches the server.
  const selectedIds = useMemo((): readonly string[] => {
    const checked = new Set(checkedIds);

    return tasks
      .filter((task) => checked.has(task.taskId))
      .map((task) => task.taskId);
  }, [tasks, checkedIds]);
  const selectionKey = [...selectedIds].sort().join(',');
  const trimmedReason = reason.trim();
  const inputKey = `${target?.id ?? ''}|${trimmedReason}|${selectionKey}`;
  const previewIsCurrent = preview !== null && preview.inputKey === inputKey;
  const canConfirm =
    preview !== null &&
    previewIsCurrent &&
    selectedIds.length > 0 &&
    preview.results.some((result) => result.outcome === 'WOULD_REASSIGN');

  // Only the latest request may write: switching members while an earlier
  // listing is in flight must not let its late answer replace the current one.
  const latestRequestRef = useRef(0);

  const loadTasks = useCallback(async (memberId: string): Promise<void> => {
    const request = latestRequestRef.current + 1;

    latestRequestRef.current = request;
    setTasksLoading(true);

    try {
      const loaded = await listMemberOpenTasks(memberId);

      if (latestRequestRef.current === request) {
        setTasks(loaded);
        setCheckedIds(loaded.map((task) => task.taskId));
      }
    } catch (requestError: unknown) {
      if (latestRequestRef.current === request) {
        setError(readErrorMessage(requestError));
      }
    } finally {
      if (latestRequestRef.current === request) {
        setTasksLoading(false);
      }
    }
  }, []);

  useEffect((): void => {
    setTarget(null);
    setReason('');
    setPreview(null);
    setCommitted(null);
    setError(null);

    if (!member) {
      latestRequestRef.current += 1;
      setTasks([]);
      setTasksLoading(false);

      return;
    }

    setTasks([]);
    // Only clears; selecting everything again happens inside loadTasks (its
    // latest-request guard), once the new member's list has arrived.
    setCheckedIds([]);
    void loadTasks(member.memberId);
  }, [member, loadTasks]);

  const titleById = useMemo(
    (): ReadonlyMap<string, string> =>
      new Map(tasks.map((task) => [task.taskId, task.instanceTitle])),
    [tasks],
  );

  async function runReassignment(dryRun: boolean): Promise<void> {
    if (!member || !target || !trimmedReason || selectedIds.length === 0) {
      return;
    }

    // Snapshot at click time: the request, the preview key and the titles all
    // describe the same selection even if the list reloads while we wait.
    const sentTaskIds = selectedIds;
    const sentTitleById = titleById;

    setBusy(true);
    setError(null);

    try {
      const outcomes = await reassignMemberTasks({
        dryRun,
        fromMemberId: member.memberId,
        reason: trimmedReason,
        taskIds: sentTaskIds,
        toMemberId: target.id,
      });

      if (dryRun) {
        setPreview({
          inputKey,
          results: outcomes,
          sentTaskIds,
          titleById: sentTitleById,
        });
        setCommitted(null);
      } else {
        setCommitted({
          results: outcomes,
          sentTaskIds,
          titleById: sentTitleById,
        });
        setPreview(null);
        await loadTasks(member.memberId);
      }
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const shownResultRows = useMemo((): ResultRow[] => {
    const shown = committed ?? preview;

    if (!shown) {
      return [];
    }

    const returnedIds = new Set(shown.results.map((result) => result.taskId));
    const returnedRows = shown.results.map(
      (result): ResultRow => ({
        instanceTitle: shown.titleById.get(result.taskId) ?? result.taskId,
        key: result.taskId,
        message: result.message,
        outcomeLabel: readOutcomeLabel(result.outcome),
      }),
    );
    // Sent but not answered: the member no longer holds it, so the server
    // returns no row. Show it instead of letting the selection silently shrink.
    const goneRows = shown.sentTaskIds
      .filter((taskId) => !returnedIds.has(taskId))
      .map(
        (taskId): ResultRow => ({
          instanceTitle: shown.titleById.get(taskId) ?? taskId,
          key: `gone:${taskId}`,
          message: null,
          outcomeLabel: TASK_GONE_LABEL,
        }),
      );

    return [...returnedRows, ...goneRows];
  }, [committed, preview]);

  const taskColumns = useMemo(
    (): TableColumn<TaskRow>[] => [
      {
        dataIndex: 'instanceTitle',
        key: 'instanceTitle',
        title: '案件',
        width: 220,
      },
      {
        dataIndex: 'nodeLabel',
        key: 'nodeLabel',
        title: '節點',
        width: 160,
      },
      {
        key: 'memberRole',
        render: (record: TaskRow): string =>
          record.memberRole === 'ASSIGNEE' ? '指派人' : '會簽候選人',
        title: '身分',
        width: 120,
      },
    ],
    [],
  );
  const resultColumns = useMemo(
    (): TableColumn<ResultRow>[] => [
      {
        dataIndex: 'instanceTitle',
        key: 'instanceTitle',
        title: '案件',
        width: 220,
      },
      {
        dataIndex: 'outcomeLabel',
        key: 'outcomeLabel',
        title: '結果',
        width: 100,
      },
      {
        dataIndex: 'message',
        key: 'message',
        title: '說明',
        width: 160,
      },
    ],
    [],
  );

  // The backdrop hides the member table, so closing is the only way `member`
  // changes. While a request is in flight every close path is a no-op, which
  // closes the window where a late answer writes into another member's view.
  const handleClose = (): void => {
    if (busy) {
      return;
    }

    onClose();
  };

  return (
    <Modal
      cancelText="關閉"
      confirmButtonProps={{ disabled: !canConfirm || busy }}
      confirmText="確認改派"
      loading={busy}
      modalType="standard"
      onCancel={handleClose}
      onClose={handleClose}
      onConfirm={(): void => {
        void runReassignment(false);
      }}
      open={Boolean(member)}
      showModalFooter
      showModalHeader
      size="regular"
      title={member ? `改派待辦：${member.name}` : '改派待辦'}
    >
      {member ? (
        <div className={styles.detailFields}>
          <Typography variant="body">
            改派會保留任務編號，但不產生簽核紀錄；原簽核人的待辦會結案為已轉交，
            接手人會收到新的待辦通知。
          </Typography>
          {error ? (
            <Typography color="text-error" variant="body">
              {error}
            </Typography>
          ) : null}
          {tasks.length ? (
            <>
              <Typography color="text-neutral" variant="caption">
                {`已選 ${selectedIds.length}／${tasks.length} 筆`}
              </Typography>
              <Table
                columns={taskColumns}
                dataSource={tasks.map((task): TaskRow => ({
                  ...task,
                  key: task.taskId,
                }))}
                fullWidth
                loading={tasksLoading}
                rowSelection={{
                  hideSelectAll: busy,
                  mode: 'checkbox',
                  onChange: (selectedRowKeys: string[]): void => {
                    if (busy) {
                      return;
                    }

                    setCheckedIds(selectedRowKeys);
                    setPreview(null);
                    setCommitted(null);
                  },
                  selectedRowKeys: [...selectedIds],
                }}
              />
            </>
          ) : (
            <Typography color="text-neutral" variant="body">
              {tasksLoading ? '載入待辦中…' : '此成員目前沒有待簽任務。'}
            </Typography>
          )}
          <BPMFormField label="接手人" name="reassignTarget">
            <MemberPicker
              name="reassignTarget"
              onChange={(option): void => {
                setTarget(option);
                setPreview(null);
                setCommitted(null);
              }}
              placeholder="搜尋接手人姓名或信箱"
              value={target}
            />
          </BPMFormField>
          <BPMFormField label="改派原因" name="reassignReason">
            <Input
              fullWidth
              name="reassignReason"
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                setReason(event.target.value);
                setPreview(null);
                setCommitted(null);
              }}
              placeholder="例如：原簽核人已離職"
              value={reason}
            />
          </BPMFormField>
          <div className={styles.membershipList}>
            <Typography color="text-neutral" variant="caption">
              先按「預覽」確認每筆任務的結果，確認無誤後再按「確認改派」。
            </Typography>
            <div>
              <Button
                disabled={
                  busy ||
                  !target ||
                  !trimmedReason ||
                  selectedIds.length === 0
                }
                onClick={(): void => {
                  void runReassignment(true);
                }}
                variant="base-secondary"
              >
                預覽
              </Button>
            </div>
          </div>
          {shownResultRows.length ? (
            <Table
              columns={resultColumns}
              dataSource={shownResultRows}
              fullWidth
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function readOutcomeLabel(
  outcome: TaskReassignmentResultRecord['outcome'],
): string {
  if (outcome === 'WOULD_REASSIGN') {
    return '會改派';
  }

  if (outcome === 'REASSIGNED') {
    return '已改派';
  }

  return '會被拒';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '改派待辦失敗。';
}
