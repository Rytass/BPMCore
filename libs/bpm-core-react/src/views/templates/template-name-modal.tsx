'use client';

import { ChangeEvent, ReactElement, useEffect, useState } from 'react';
import { Input, Modal, Select, Typography } from '@mezzanine-ui/react';
import { BPMFormField } from '../../components/bpm-form-field';

export interface TemplateCategoryOption {
  readonly categoryId: string | null;
  readonly id: string;
  readonly name: string;
}

interface TemplateNameModalProps {
  readonly confirmText: string;
  readonly categoryOptions: readonly TemplateCategoryOption[];
  readonly initialName: string;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly categoryId: string | null;
    readonly name: string;
  }) => Promise<void>;
  readonly open: boolean;
  readonly title: string;
}

export function TemplateNameModal({
  confirmText,
  categoryOptions,
  initialName,
  loading,
  onClose,
  onSubmit,
  open,
  title,
}: TemplateNameModalProps): ReactElement {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<TemplateCategoryOption>(
    categoryOptions[0] ?? UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION,
  );
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  useEffect((): void => {
    if (!open) {
      return;
    }

    setName(initialName);
    setCategory(categoryOptions[0] ?? UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION);
    setError(null);
  }, [categoryOptions, initialName, open]);

  async function handleConfirm(): Promise<void> {
    if (!trimmedName) {
      setError('請輸入模板名稱');
      return;
    }

    try {
      await onSubmit({ categoryId: category.categoryId, name: trimmedName });
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
      <BPMFormField label="模板名稱" name="templateName" required>
        <Input
          autoFocus
          fullWidth
          onChange={(event: ChangeEvent<HTMLInputElement>): void => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="例如：費用申請流程"
          value={name}
          variant="base"
        />
      </BPMFormField>
      <BPMFormField label="分類" name="templateCategory">
        <Select
          clearable={false}
          fullWidth
          onChange={(option): void => {
            setCategory(readCategoryOption(option, categoryOptions));
            setError(null);
          }}
          options={[...categoryOptions]}
          placeholder="選擇分類"
          value={category}
        />
      </BPMFormField>
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

export const UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION: TemplateCategoryOption = {
  categoryId: null,
  id: 'UNCATEGORIZED',
  name: '未分類',
};

function readCategoryOption(
  value: unknown,
  options: readonly TemplateCategoryOption[],
): TemplateCategoryOption {
  if (!isRecord(value)) {
    return UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION;
  }

  const id = typeof value.id === 'string' ? value.id : null;

  return (
    options.find((option) => option.id === id) ??
    UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
