import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isMemberFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export type MemberFieldOption = Readonly<{
  id: string;
  name: string;
  /**
   * Set when the field can be empty at submit time (optional, or hidden by a
   * visibility rule); the node then finds no approver. Still selectable — the
   * server decides at publish what it accepts.
   */
  warning?: string;
}>;

export type DynamicFormFieldChoice = Readonly<{
  /** What the picker offers; includes the stale stored key when there is one. */
  options: readonly MemberFieldOption[];
  /** Hint under the picker, or `null` when nothing needs saying. */
  problem: string | null;
  selected: MemberFieldOption | null;
}>;

export const NO_MEMBER_FIELD_HINT =
  '表單中沒有「人員選擇」欄位，請先到表單設計加入';

const STALE_FIELD_HINT =
  '原本指定的欄位已不在表單中，或已不是「人員選擇」欄位，請重新選擇。';

const OPTIONAL_FIELD_WARNING = '此欄位非必填，未填寫時此關會找不到簽核人';
const HIDDEN_FIELD_WARNING = '此欄位可能被條件隱藏，隱藏時此關會找不到簽核人';

function readMemberFieldWarning(
  field: FormFieldDefinition,
): string | undefined {
  const warnings = [
    ...(field.required ? [] : [OPTIONAL_FIELD_WARNING]),
    ...(field.visibleWhen?.trim() ? [HIDDEN_FIELD_WARNING] : []),
  ];

  return warnings.length > 0 ? warnings.join('；') : undefined;
}

function readMemberFieldNameSuffix(field: FormFieldDefinition): string {
  return `${field.required ? '' : '（非必填）'}${
    field.visibleWhen?.trim() ? '（可能被條件隱藏）' : ''
  }`;
}

/** Only member fields can feed a 依表單欄位指定 approver resolver. */
export function readMemberFieldOptions(
  schema: FormDefinitionSchema | null,
): readonly MemberFieldOption[] {
  return (schema?.fields ?? []).filter(isMemberFieldDefinition).map((field) => {
    const warning = readMemberFieldWarning(field);

    return {
      id: field.fieldKey,
      name: `${field.label} (${field.fieldKey})${readMemberFieldNameSuffix(field)}`,
      ...(warning ? { warning } : {}),
    };
  });
}

/**
 * The member-field picker for the 依表單欄位指定 resolver. A stored `formPath`
 * that no longer names a member field of the bound form (the form was switched
 * or edited, or the template came from the API) stays visible as its own
 * option together with a warning, instead of being cleared behind the user's
 * back — the resolver stays invalid until a real field is chosen.
 */
export function readDynamicFormFieldChoice(
  schema: FormDefinitionSchema | null,
  formPath: string,
): DynamicFormFieldChoice {
  const options = readMemberFieldOptions(schema);
  const matched = options.find((option) => option.id === formPath) ?? null;

  if (matched) {
    return { options, problem: matched.warning ?? null, selected: matched };
  }

  if (formPath.trim()) {
    const stale: MemberFieldOption = {
      id: formPath,
      name: `${formPath}（無效欄位）`,
    };

    return {
      options: [...options, stale],
      problem: STALE_FIELD_HINT,
      selected: stale,
    };
  }

  return {
    options,
    problem: options.length === 0 ? NO_MEMBER_FIELD_HINT : null,
    selected: null,
  };
}

/**
 * 依表單欄位：<label>; the field key when the form does not have it (any
 * more), and a marker when the key names something that is not a member field.
 */
export function readDynamicFormSummary(
  schema: FormDefinitionSchema | null,
  formPath: string,
): string {
  if (!formPath.trim()) {
    return '依表單欄位：未設定';
  }

  const field = schema?.fields.find(
    (candidate) => candidate.fieldKey === formPath,
  );

  if (field && !isMemberFieldDefinition(field)) {
    return `依表單欄位：${field.label || formPath}（非人員選擇欄位）`;
  }

  return `依表單欄位：${field?.label || formPath}`;
}
