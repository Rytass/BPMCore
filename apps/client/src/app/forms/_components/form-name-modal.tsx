'use client';

import { ChangeEvent, ReactElement, useEffect, useState } from 'react';
import { FormField, Input, Modal, Typography } from '@mezzanine-ui/react';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';

interface FormNameModalProps {
  readonly confirmText: string;
  readonly initialName: string;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => Promise<void>;
  readonly open: boolean;
  readonly title: string;
}

export function FormNameModal({
  confirmText,
  initialName,
  loading,
  onClose,
  onSubmit,
  open,
  title,
}: FormNameModalProps): ReactElement {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  useEffect((): void => {
    if (!open) {
      return;
    }

    setName(initialName);
    setError(null);
  }, [initialName, open]);

  async function handleConfirm(): Promise<void> {
    if (!trimmedName) {
      setError('請輸入表單名稱');
      return;
    }

    try {
      await onSubmit(trimmedName);
    } catch (submitError: unknown) {
      setError(readErrorMessage(submitError));
    }
  }

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !trimmedName }}
      confirmText={confirmText}
      loading={loading}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void => void handleConfirm()}
      open={open}
      showModalFooter
      showModalHeader
      size="narrow"
      title={title}
    >
      <FormField
        density={FormFieldDensity.WIDE}
        fullWidth
        label="表單名稱"
        layout={FormFieldLayout.STRETCH}
        name="formName"
        required
      >
        <Input
          autoFocus
          fullWidth
          onChange={(event: ChangeEvent<HTMLInputElement>): void => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="例如：費用申請單"
          value={name}
          variant="base"
        />
      </FormField>
      {error ? (
        <Typography color="text-error" variant="body">
          {error}
        </Typography>
      ) : null}
    </Modal>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
