'use client';

import { ChangeEvent, ReactElement, useEffect, useState } from 'react';
import { Input, Modal, Typography } from '@mezzanine-ui/react';
import {
  adminCancelApprovalInstance,
  type StuckApprovalInstanceRecord,
} from '@rytass/bpm-core-client/workflow';
import { BPMFormField } from '../../../components/bpm-form-field';

/**
 * Administrator cancellation of one stuck approval instance. The reason is
 * required (trimmed) and goes to the applicant as an in-app notification, so
 * the window says so before the administrator confirms. Cancelling cannot be
 * undone.
 */
export function StuckInstanceCancelModal({
  instance,
  onCancelled,
  onClose,
}: {
  readonly instance: StuckApprovalInstanceRecord | null;
  /** The cancellation went through; the host closes the window and reloads. */
  readonly onCancelled: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();

  // A different instance starts from a blank window.
  const instanceId = instance?.instanceId ?? null;

  useEffect((): void => {
    setReason('');
    setError(null);
    setBusy(false);
  }, [instanceId]);

  // While the request is in flight every close path is a no-op: the cancel
  // button, Esc, the backdrop and the corner X all end up here.
  const handleClose = (): void => {
    if (busy) {
      return;
    }

    onClose();
  };

  async function handleConfirm(): Promise<void> {
    if (!instance || !trimmedReason || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    const succeeded = await adminCancelApprovalInstance({
      instanceId: instance.instanceId,
      reason: trimmedReason,
    }).then(
      (): boolean => true,
      (requestError: unknown): boolean => {
        setError(readErrorMessage(requestError));

        return false;
      },
    );

    setBusy(false);

    if (succeeded) {
      onCancelled();
    }
  }

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !trimmedReason || busy }}
      confirmText="確認撤銷"
      loading={busy}
      modalType="standard"
      onCancel={handleClose}
      onClose={handleClose}
      onConfirm={(): void => {
        void handleConfirm();
      }}
      open={Boolean(instance)}
      showModalFooter
      showModalHeader
      size="regular"
      title="撤銷卡住的案件"
    >
      {instance ? (
        <div style={BODY_STYLE}>
          <Typography variant="body">案件：{instance.instanceTitle}</Typography>
          <Typography color="text-neutral" variant="body">
            撤銷後無法復原。申請人會收到站內通知，內容含撤銷理由。
          </Typography>
          {error ? (
            <Typography color="text-error" variant="body">
              {error}
            </Typography>
          ) : null}
          <BPMFormField label="撤銷理由（必填）" name="stuckCancelReason">
            <Input
              {...(busy ? { disabled: true as const } : {})}
              fullWidth
              name="stuckCancelReason"
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                setReason(event.target.value);
              }}
              placeholder="例如：下一關簽核人設定有誤，請重新送單"
              value={reason}
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '撤銷案件失敗。';
}
