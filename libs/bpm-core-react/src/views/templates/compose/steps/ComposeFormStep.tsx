'use client';

import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { FormField, Input, Select, Typography } from '@mezzanine-ui/react';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { SelectValue } from '@mezzanine-ui/react/Select';
import type {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  ApprovalTemplateCategoryRecord,
  listApprovalTemplateCategoriesPage,
} from '@rytass/bpm-core-client/template';
import { FormBuilderView } from '../../../forms/builder';

const UNCATEGORIZED_OPTION: SelectValue = {
  id: 'UNCATEGORIZED',
  name: '未分類',
};

const CATEGORY_PAGE_SIZE = 100;

export interface ComposeFormStepProps {
  readonly name: string;
  readonly categoryId: string | null;
  readonly formSchema: FormDefinitionSchema;
  readonly formUiSchema: FormUiSchema;
  readonly onNameChange: (value: string) => void;
  readonly onCategoryIdChange: (value: string | null) => void;
  readonly onFormChange: (next: {
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
  }) => void;
}

export function ComposeFormStep({
  categoryId,
  formSchema,
  formUiSchema,
  name,
  onCategoryIdChange,
  onFormChange,
  onNameChange,
}: ComposeFormStepProps): ReactElement {
  const [categoryOptions, setCategoryOptions] = useState<
    readonly ApprovalTemplateCategoryRecord[]
  >([]);

  useEffect((): (() => void) => {
    let active = true;

    void (async (): Promise<void> => {
      try {
        const result = await listApprovalTemplateCategoriesPage({
          page: 1,
          pageSize: CATEGORY_PAGE_SIZE,
          searchText: '',
          status: 'ACTIVE',
        });

        if (active) {
          setCategoryOptions(result.categories);
        }
      } catch {
        if (active) {
          setCategoryOptions([]);
        }
      }
    })();

    return (): void => {
      active = false;
    };
  }, []);

  const selectOptions: SelectValue[] = [
    UNCATEGORIZED_OPTION,
    ...categoryOptions.map((category) => ({
      id: category.id,
      name: category.name,
    })),
  ];
  const selectedOption =
    selectOptions.find((option) => option.id === categoryId) ??
    UNCATEGORIZED_OPTION;

  return (
    <>
      <div style={BASICS_GRID_STYLE}>
        <FormField
          label="名稱"
          layout={FormFieldLayout.VERTICAL}
          name="composeName"
        >
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onNameChange(event.target.value)
            }
            placeholder="例如：請款簽核"
            value={name}
          />
        </FormField>
        <FormField
          label="分類（選填）"
          layout={FormFieldLayout.VERTICAL}
          name="composeCategory"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void =>
              onCategoryIdChange(
                option && option.id !== UNCATEGORIZED_OPTION.id
                  ? option.id
                  : null,
              )
            }
            options={selectOptions}
            placeholder="未分類"
            value={selectedOption}
          />
        </FormField>
      </div>
      <Typography color="text-neutral" variant="caption">
        先設計表單欄位，下一步的流程條件分流即可直接引用這些欄位。
      </Typography>
      <FormBuilderView
        onChange={onFormChange}
        value={{ schema: formSchema, uiSchema: formUiSchema }}
      />
    </>
  );
}

const BASICS_GRID_STYLE = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
} as const;
