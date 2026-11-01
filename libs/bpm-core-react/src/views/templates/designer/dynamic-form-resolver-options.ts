import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isMemberFieldDefinition,
  isOrgUnitFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export type MemberFieldOption = Readonly<{
  id: string;
  name: string;
  /**
   * Set when the field can be empty at submit time (optional, hidden by a
   * visibility rule, or a store-only hidden field); the node would then find no
   * approver, so publishing refuses it. Still selectable, so the stored choice
   * stays visible until the form or the node is fixed.
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

export const NO_SINGLE_MEMBER_FIELD_HINT =
  '表單中沒有單選的「人員選擇」欄位，請先到表單設計加入';

export const NO_ORG_UNIT_FIELD_HINT =
  '表單中沒有「組織選擇」欄位，請先到表單設計加入';

const STALE_FIELD_HINT =
  '原本指定的欄位已不在表單中，或已不是「人員選擇」欄位，請重新選擇。';
const STALE_SINGLE_MEMBER_FIELD_HINT =
  '原本指定的欄位已不在表單中，或已不是單選的「人員選擇」欄位，請重新選擇。';
const STALE_ORG_UNIT_FIELD_HINT =
  '原本指定的欄位已不在表單中，或已不是「組織選擇」欄位，請重新選擇。';

const OPTIONAL_FIELD_WARNING = '此欄位非必填';
const HIDDEN_FIELD_WARNING = '此欄位可能被條件隱藏';
const STORE_ONLY_FIELD_WARNING = '此欄位為隱藏欄位，申請人無法填寫';
const UNPUBLISHABLE_SUFFIX =
  '，空白時此關會找不到人員，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏';
const ORG_UNPUBLISHABLE_SUFFIX =
  '，空白時此關會找不到組織主管，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏';

function readMemberFieldWarning(
  field: FormFieldDefinition,
  suffix: string = UNPUBLISHABLE_SUFFIX,
): string | undefined {
  const warnings = [
    ...(field.required ? [] : [OPTIONAL_FIELD_WARNING]),
    ...(field.visibleWhen?.trim() ? [HIDDEN_FIELD_WARNING] : []),
    ...(field.hidden ? [STORE_ONLY_FIELD_WARNING] : []),
  ];

  return warnings.length > 0 ? `${warnings.join('、')}${suffix}` : undefined;
}

function readMemberFieldNameSuffix(field: FormFieldDefinition): string {
  return `${field.required ? '' : '（非必填）'}${
    field.visibleWhen?.trim() ? '（可能被條件隱藏）' : ''
  }${field.hidden ? '（隱藏欄位）' : ''}`;
}

function readMemberFieldOption(field: FormFieldDefinition): MemberFieldOption {
  const warning = readMemberFieldWarning(field);

  return {
    id: field.fieldKey,
    name: `${field.label} (${field.fieldKey})${readMemberFieldNameSuffix(field)}`,
    ...(warning ? { warning } : {}),
  };
}

/** Only member fields can feed a 依表單欄位指定 approver resolver. */
export function readMemberFieldOptions(
  schema: FormDefinitionSchema | null,
): readonly MemberFieldOption[] {
  return (schema?.fields ?? [])
    .filter(isMemberFieldDefinition)
    .map(readMemberFieldOption);
}

function readFieldChoice(
  options: readonly MemberFieldOption[],
  formPath: string,
  hints: Readonly<{ empty: string; stale: string }>,
): DynamicFormFieldChoice {
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
      problem: hints.stale,
      selected: stale,
    };
  }

  return {
    options,
    problem: options.length === 0 ? hints.empty : null,
    selected: null,
  };
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
  return readFieldChoice(readMemberFieldOptions(schema), formPath, {
    empty: NO_MEMBER_FIELD_HINT,
    stale: STALE_FIELD_HINT,
  });
}

/**
 * Member fields a manager can be looked up from: one person per submission,
 * so a multi-select member field is not offered (SPEC 5.2). Same warnings as
 * {@link readMemberFieldOptions}.
 */
export function readSingleMemberFieldOptions(
  schema: FormDefinitionSchema | null,
): readonly MemberFieldOption[] {
  return (schema?.fields ?? [])
    .filter(isMemberFieldDefinition)
    .filter((field) => !field.multiple)
    .map(readMemberFieldOption);
}

/** The field picker for 簽核人 = 直屬／第二層／第三層主管 of a form person. */
export function readFormMemberManagerFieldChoice(
  schema: FormDefinitionSchema | null,
  formPath: string,
): DynamicFormFieldChoice {
  return readFieldChoice(readSingleMemberFieldOptions(schema), formPath, {
    empty: NO_SINGLE_MEMBER_FIELD_HINT,
    stale: STALE_SINGLE_MEMBER_FIELD_HINT,
  });
}

/**
 * Every 組織選擇 field of the form, optional or hidden ones included; the
 * ones that cannot be published carry the reason as `warning`, the way member
 * fields do.
 */
export function readOrgUnitFieldOptions(
  schema: FormDefinitionSchema | null,
): readonly MemberFieldOption[] {
  return (schema?.fields ?? [])
    .filter(isOrgUnitFieldDefinition)
    .map((field) => {
      const warning = readMemberFieldWarning(field, ORG_UNPUBLISHABLE_SUFFIX);

      return {
        id: field.fieldKey,
        name: `${field.label} (${field.fieldKey})${readMemberFieldNameSuffix(field)}`,
        ...(warning ? { warning } : {}),
      };
    });
}

/** The field picker for 組織 = 表單欄位 of 指定組織主管. */
export function readFormOrgUnitFieldChoice(
  schema: FormDefinitionSchema | null,
  formPath: string,
): DynamicFormFieldChoice {
  return readFieldChoice(readOrgUnitFieldOptions(schema), formPath, {
    empty: NO_ORG_UNIT_FIELD_HINT,
    stale: STALE_ORG_UNIT_FIELD_HINT,
  });
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

function readManagerFieldSummary(
  schema: FormDefinitionSchema | null,
  formPath: string,
  describe: (field: FormFieldDefinition | undefined, name: string) => string,
): string {
  if (!formPath.trim()) {
    return '依表單欄位：未設定';
  }

  const field = schema?.fields.find(
    (candidate) => candidate.fieldKey === formPath,
  );

  return describe(field, field?.label || formPath);
}

/**
 * 依表單欄位：<label>的<level>; marks a field that cannot feed a manager lookup
 * (not a member field, or one that takes several people).
 */
export function readFormMemberManagerSummary(
  schema: FormDefinitionSchema | null,
  formPath: string,
  levelName: string,
): string {
  return readManagerFieldSummary(schema, formPath, (field, name) => {
    if (field && !isMemberFieldDefinition(field)) {
      return `依表單欄位：${name}（非人員選擇欄位）`;
    }

    if (field && isMemberFieldDefinition(field) && field.multiple) {
      return `依表單欄位：${name}（需為單選人員欄位）`;
    }

    return `依表單欄位：${name}的${levelName}`;
  });
}

/** 依表單欄位：<label>所選組織的主管, with a marker for a non-org field. */
export function readFormOrgUnitManagerSummary(
  schema: FormDefinitionSchema | null,
  formPath: string,
): string {
  return readManagerFieldSummary(schema, formPath, (field, name) =>
    field && !isOrgUnitFieldDefinition(field)
      ? `依表單欄位：${name}（非組織選擇欄位）`
      : `依表單欄位：${name}所選組織的主管`,
  );
}
