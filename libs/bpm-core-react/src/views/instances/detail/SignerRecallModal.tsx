'use client';

import { ChangeEvent, ReactElement, useEffect, useRef, useState } from 'react';
import { Input, Modal, Typography } from '@mezzanine-ui/react';
import { readRequestErrorCode } from '@rytass/bpm-core-client';
import { recallTaskApproval } from '@rytass/bpm-core-client/workflow';
import {
  SIGNER_RECALL_ERROR_CODES,
  type SignerRecallErrorCode,
} from '@rytass/bpm-core-shared/status';
import { BPMFormField } from '../../../components/bpm-form-field';

/**
 * Shown for any failure the table below cannot name: a network error, an old
 * server, or a code a newer server added.
 */
const GENERIC_FAILURE_MESSAGE = '取回失敗，請重新整理後再試。';

/**
 * What the signer reads when the server refuses a recall. The server's own
 * `message` is English prose for logs, so it is never shown; the code picks
 * the sentence here. `Record` over the code union makes a code the shared
 * package adds a compile error until it gets a sentence.
 */
const REFUSAL_MESSAGES: Readonly<Record<SignerRecallErrorCode, string>> = {
  [SIGNER_RECALL_ERROR_CODES.DISABLED]: '目前沒有開放取回重辦。',
  [SIGNER_RECALL_ERROR_CODES.NOT_THE_SIGNER]: '只有按下同意的本人可以取回。',
  [SIGNER_RECALL_ERROR_CODES.ALREADY_RECALLED]: '這個同意已經取回過了。',
  [SIGNER_RECALL_ERROR_CODES.NOT_A_PERSONAL_APPROVAL]:
    '這筆同意是系統自動完成的，不是你親自按下的，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.INSTANCE_NOT_RUNNING]:
    '這張單已經不在簽核中，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL]:
    '這一關不是靠你這個同意就結束的，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.DELEGATED_SEAT]:
    '這筆是你代理別人簽的（或由系統自動轉給你），無法取回。',
  [SIGNER_RECALL_ERROR_CODES.STAGE_NOTIFY_SENT]:
    '這一關的「階段完成通知」已經寄出，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_ACTED]:
    '下一關已經有人處理了，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_NOT_SINGLE]:
    '你同意後，流程不是單純走到下一關等人簽（例如同時發出知會、流程分成平行分支，或下一關有人加簽），無法取回。',
  [SIGNER_RECALL_ERROR_CODES.PASSED_SERVICE_TASK]:
    '你同意後，流程已經過知會節點，那裡執行的動作無法撤回，無法取回。',
  [SIGNER_RECALL_ERROR_CODES.PASSED_JOIN]:
    '你同意後，流程已經和其他平行分支會合，無法取回。',
};

type RecallOutcome =
  | { readonly recalled: true }
  | { readonly recalled: false; readonly requestError: unknown };

function isKnownRefusalCode(code: string): code is SignerRecallErrorCode {
  return Object.prototype.hasOwnProperty.call(REFUSAL_MESSAGES, code);
}

/**
 * Confirmation window for taking back the approval the signed-in member just
 * gave. The window calls the mutation itself, so the instance page only learns
 * the outcome: `onRecalled` on success, and on close whether the server
 * refused at any point (`onClose(true)`), in which case the page reloads so a
 * recall that is no longer possible stops being offered.
 */
export function SignerRecallModal({
  onClose,
  onRecalled,
  taskId,
}: {
  /** The approval being taken back; `null` keeps the window closed. */
  readonly taskId: string | null;
  /** The recall went through; the host closes the window and reloads. */
  readonly onRecalled: () => void;
  /**
   * The window was closed. `refused` is true when any attempt failed, so the
   * host reloads; false when nothing was sent and closing needs no reload.
   */
  readonly onClose: (refused: boolean) => void;
}): ReactElement {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // `busy` only reaches the handler after a re-render; a second press that
  // lands before it would send a second recall.
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Any failed attempt, a code-less one included: the page reloads on close.
  const [refused, setRefused] = useState(false);
  // The server judged this approval not recallable. Pressing again would only
  // return the same code, so the confirm button stays off.
  const [refusedByCode, setRefusedByCode] = useState(false);
  // The task the window is showing right now, readable from a request that
  // settles after a re-render: a result for a task that is no longer on screen
  // must not be written onto the one that is.
  const shownTaskIdRef = useRef(taskId);

  // A different approval starts from a blank window, the refused flags too:
  // otherwise the last approval's refusal would make this one's close report
  // `onClose(true)`.
  useEffect((): void => {
    shownTaskIdRef.current = taskId;
    setComment('');
    setError(null);
    setRefused(false);
    setRefusedByCode(false);
    setBusy(false);
    busyRef.current = false;
  }, [taskId]);

  // While the request is in flight every close path is a no-op: the cancel
  // button, Esc, the backdrop and the corner X all end up here.
  const handleClose = (): void => {
    if (busy) {
      return;
    }

    onClose(refused);
  };

  async function handleConfirm(): Promise<void> {
    if (!taskId || busyRef.current || refusedByCode) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);

    const sentTaskId = taskId;
    const outcome = await recallTaskApproval({
      comment: comment.trim(),
      taskId: sentTaskId,
    }).then(
      (): RecallOutcome => ({ recalled: true }),
      (requestError: unknown): RecallOutcome => ({
        recalled: false,
        requestError,
      }),
    );

    // The window moved on to another task while this one was in flight. That
    // task's own state was already reset, and its busy flag may be set by its
    // own request, so this late result touches nothing.
    if (shownTaskIdRef.current !== sentTaskId) {
      return;
    }

    busyRef.current = false;
    setBusy(false);

    if (outcome.recalled) {
      onRecalled();

      return;
    }

    const code = readRequestErrorCode(outcome.requestError);

    setRefused(true);
    setRefusedByCode(code !== null);
    setError(
      code !== null && isKnownRefusalCode(code)
        ? REFUSAL_MESSAGES[code]
        : GENERIC_FAILURE_MESSAGE,
    );
  }

  return (
    <Modal
      cancelText="先不要"
      confirmButtonProps={{ disabled: busy || refusedByCode }}
      confirmText="確認取回"
      loading={busy}
      modalType="standard"
      onCancel={handleClose}
      onClose={handleClose}
      onConfirm={(): void => {
        void handleConfirm();
      }}
      open={Boolean(taskId)}
      showModalFooter
      showModalHeader
      size="regular"
      title="取回重辦"
    >
      {taskId ? (
        <div style={BODY_STYLE}>
          <Typography variant="body">
            取回後，下一關的待簽任務會取消，這張單會回到你這一關重新簽核。已寄出的通知無法收回。
          </Typography>
          {error ? (
            <Typography color="text-error" role="alert" variant="body">
              {error}
            </Typography>
          ) : null}
          <BPMFormField label="取回原因（選填）" name="signerRecallComment">
            <Input
              {...(busy ? { disabled: true as const } : {})}
              fullWidth
              name="signerRecallComment"
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                setComment(event.target.value);
              }}
              placeholder="例如：附件放錯了，要重新確認"
              value={comment}
            />
          </BPMFormField>
        </div>
      ) : null}
    </Modal>
  );
}

const BODY_STYLE = {
  display: 'grid',
  gap: 16,
} as const;
