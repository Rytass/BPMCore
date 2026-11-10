'use client';

import type { ReactElement } from 'react';
import {
  DateRangePicker,
  DateTimeRangePicker,
  Filter,
  FormField,
  Input,
  Select,
  type FilterProps,
} from '@mezzanine-ui/react';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import {
  formatDatePickerValue,
  formatDateTimePickerValue,
} from '@rytass/bpm-core-client/form';
import type { FilterableFieldPath } from '@rytass/bpm-core-shared';
import {
  EMPTY_FIELD_FILTER_DRAFT,
  isDecimalText,
  readFieldFilterControl,
  type FieldFilterDraft,
  type FieldFilterDrafts,
} from './approval-instance-field-filters';

export type FieldFilterDraftChange = (
  path: string,
  draft: FieldFilterDraft,
) => void;

type SelectChoice = Readonly<{ id: string; name: string }>;

const BOOLEAN_CHOICES: readonly SelectChoice[] = [
  { id: 'true', name: '是' },
  { id: 'false', name: '否' },
];

/**
 * One list-page `Filter` per condition the template's filterable fields need.
 * A number field yields two (lower and upper bound) because Mezzanine has no
 * number range control. Returned as elements so the caller can place them
 * directly inside `FilterLine`, which only accepts `Filter` children.
 */
export function readFieldFilterElements(
  paths: readonly FilterableFieldPath[],
  drafts: FieldFilterDrafts,
  onDraftChange: FieldFilterDraftChange,
): readonly ReactElement<FilterProps>[] {
  return paths.flatMap((item): readonly ReactElement<FilterProps>[] => {
    const draft = drafts[item.path] ?? EMPTY_FIELD_FILTER_DRAFT;
    const change = (next: FieldFilterDraft): void => {
      onDraftChange(item.path, next);
    };
    const control = readFieldFilterControl(item);

    if (control.kind === 'number-range') {
      return [
        renderFilter(
          `${item.path}:from`,
          `${item.label}（下限）`,
          <Input
            fullWidth
            onChange={(event): void => {
              change({ ...draft, from: event.target.value });
            }}
            placeholder={`${item.label}：下限`}
            size="sub"
            value={draft.from}
            variant="base"
          />,
          readNumberHint(draft.from),
        ),
        renderFilter(
          `${item.path}:to`,
          `${item.label}（上限）`,
          <Input
            fullWidth
            onChange={(event): void => {
              change({ ...draft, to: event.target.value });
            }}
            placeholder={`${item.label}：上限`}
            size="sub"
            value={draft.to}
            variant="base"
          />,
          readNumberHint(draft.to),
        ),
      ];
    }

    return [
      renderFilter(
        item.path,
        item.label,
        renderControl(item, draft, change, item.label),
        control.kind === 'id-in' ? '多個成員以逗號分隔' : undefined,
      ),
    ];
  });
}

function renderFilter(
  key: string,
  label: string,
  control: ReactElement,
  hintText?: string,
): ReactElement<FilterProps> {
  return (
    <Filter key={key} span={2}>
      <FormField
        fullWidth
        hintText={hintText}
        layout={FormFieldLayout.VERTICAL}
        label={label}
        name={`fieldFilter-${key}`}
      >
        {control}
      </FormField>
    </Filter>
  );
}

function readNumberHint(value: string): string | undefined {
  return !value || isDecimalText(value) ? undefined : '請輸入數字';
}

function renderControl(
  item: FilterableFieldPath,
  draft: FieldFilterDraft,
  change: (next: FieldFilterDraft) => void,
  label: string,
): ReactElement {
  // The list page hides FormField labels to keep its filter rows compact, so
  // each control names its field in the placeholder, as the state filter does.
  const control = readFieldFilterControl(item);

  if (control.kind === 'option-in') {
    const choices = control.options.map((option): SelectChoice => ({
      id: option.value,
      name: option.label,
    }));

    return (
      <Select
        clearable
        fullWidth
        mode="multiple"
        onChange={(selected: readonly SelectChoice[]): void => {
          change({ ...draft, values: selected.map((option) => option.id) });
        }}
        options={[...choices]}
        placeholder={`${label}：全部`}
        size="sub"
        value={choices.filter((choice) => draft.values.includes(choice.id))}
      />
    );
  }

  if (control.kind === 'boolean') {
    const selected = BOOLEAN_CHOICES.find((choice) =>
      draft.values.includes(choice.id),
    );

    return (
      <Select
        clearable
        fullWidth
        onChange={(option: SelectChoice | null): void => {
          change({ ...draft, values: option ? [option.id] : [] });
        }}
        options={[...BOOLEAN_CHOICES]}
        placeholder={`${label}：全部`}
        size="sub"
        value={selected ?? null}
      />
    );
  }

  if (control.kind === 'date-range') {
    return (
      <DateRangePicker
        clearable
        fullWidth
        inputFromPlaceholder={`${label}：起`}
        inputToPlaceholder="迄"
        onChange={(target?: readonly (string | undefined)[]): void => {
          change({
            ...draft,
            from: formatDatePickerValue(target?.[0]) ?? '',
            to: formatDatePickerValue(target?.[1]) ?? '',
          });
        }}
        size="sub"
        value={draft.from && draft.to ? [draft.from, draft.to] : []}
      />
    );
  }

  if (control.kind === 'datetime-range') {
    return (
      <DateTimeRangePicker
        clearable
        fullWidth
        onChange={(value): void => {
          change({
            ...draft,
            from: formatDateTimePickerValue(value[0]) ?? '',
            to: formatDateTimePickerValue(value[1]) ?? '',
          });
        }}
        size="sub"
        value={[draft.from || undefined, draft.to || undefined]}
      />
    );
  }

  if (control.kind === 'id-in') {
    return (
      <Input
        fullWidth
        onChange={(event): void => {
          change({ ...draft, text: event.target.value });
        }}
        placeholder={`${label}：成員 ID`}
        size="sub"
        value={draft.text}
        variant="base"
      />
    );
  }

  // contains (text, textarea and data-source options)
  return (
    <Input
      fullWidth
      onChange={(event): void => {
        change({ ...draft, text: event.target.value });
      }}
      placeholder={`${label}：包含`}
      size="sub"
      value={draft.text}
      variant="base"
    />
  );
}
