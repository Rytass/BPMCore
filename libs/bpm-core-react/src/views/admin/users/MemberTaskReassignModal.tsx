'use client';

import {
  ChangeEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
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

interface PreviewState {
  readonly inputKey: string;
  readonly results: readonly TaskReassignmentResultRecord[];
}

/**
 * A committed run keeps the titles it was started with: the task list reloads
 * right after, and a member whose every task moved no longer lists any of them.
 */
interface CommittedState {
  readonly results: readonly TaskReassignmentResultRecord[];
  readonly titleById: ReadonlyMap<string, string>;
}

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
  const [target, setTarget] = useState<MemberOption | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [committed, setCommitted] = useState<CommittedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const inputKey = `${target?.id ?? ''}|${trimmedReason}`;
  const previewIsCurrent = preview !== null && preview.inputKey === inputKey;
  const canConfirm =
    preview !== null &&
    previewIsCurrent &&
    preview.results.some((result) => result.outcome === 'WOULD_REASSIGN');

  const loadTasks = useCallback(async (memberId: string): Promise<void> => {
    setTasksLoading(true);

    try {
      setTasks(await listMemberOpenTasks(memberId));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect((): void => {
    setTarget(null);
    setReason('');
    setPreview(null);
    setCommitted(null);
    setError(null);

    if (!member) {
      setTasks([]);

      return;
    }

    void loadTasks(member.memberId);
  }, [member, loadTasks]);

  const titleById = useMemo(
    (): ReadonlyMap<string, string> =>
      new Map(tasks.map((task) => [task.taskId, task.instanceTitle])),
    [tasks],
  );

  async function runReassignment(dryRun: boolean): Promise<void> {
    if (!member || !target || !trimmedReason) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const outcomes = await reassignMemberTasks({
        dryRun,
        fromMemberId: member.memberId,
        reason: trimmedReason,
        toMemberId: target.id,
      });

      if (dryRun) {
        setPreview({ inputKey, results: outcomes });
        setCommitted(null);
      } else {
        setCommitted({ results: outcomes, titleById });
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
    const shownResults = committed?.results ?? preview?.results ?? [];
    const shownTitleById = committed?.titleById ?? titleById;

    return shownResults.map((result) => ({
      instanceTitle: shownTitleById.get(result.taskId) ?? result.taskId,
      key: result.taskId,
      message: result.message,
      outcomeLabel: readOutcomeLabel(result.outcome),
    }));
  }, [committed, preview, titleById]);

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

  return (
    <Modal
      cancelText="關閉"
      confirmButtonProps={{ disabled: !canConfirm || busy }}
      confirmText="確認改派"
      loading={busy}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
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
            <Table
              columns={taskColumns}
              dataSource={tasks.map((task): TaskRow => ({
                ...task,
                key: task.taskId,
              }))}
              fullWidth
              loading={tasksLoading}
            />
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
                  busy || !target || !trimmedReason || tasks.length === 0
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
