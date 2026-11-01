type NamedRecord = Readonly<{ id: string; name: string }>;

const MANAGER_LEVEL_NAMES: Readonly<Record<number, string>> = {
  1: '直屬主管',
  2: '第二層主管',
  3: '第三層主管',
};

function managerLevelName(level: number): string {
  return MANAGER_LEVEL_NAMES[level] ?? `第 ${level} 層主管`;
}

type FormFieldRecord = Readonly<{ fieldKey: string; label: string }>;

export type DryRunAssigneeDirectory = Readonly<{
  /** Fields of the schema the dry run samples, to name a member placeholder. */
  formFields: readonly FormFieldRecord[];
  /** Display name of a real member id, or `null` when it is not known. */
  memberName: (memberId: string) => string | null;
  /** Nodes of the workflow, to name the stages a `nodeActor:` placeholder lists. */
  nodes: readonly NamedRecord[];
  orgUnits: readonly NamedRecord[];
  positions: readonly NamedRecord[];
}>;

/**
 * The dry run cannot know who a position / org-unit / manager-chain resolver
 * would pick (that depends on the submitter and the directory at submit
 * time), so the engine reports a `<kind>:<ids>` placeholder instead of a
 * member id. This turns each placeholder into a sentence a template author can
 * read; a real member id becomes the member's name, and anything else is
 * returned untouched so an unexpected value stays visible.
 *
 * The placeholder shapes mirror `resolveDryRunAssigneeMemberId` in the engine.
 */
export function readDryRunAssigneeLabel(
  assignee: string,
  directory: DryRunAssigneeDirectory,
): string {
  const [kind, ...ids] = assignee.split(':');
  const orgUnitName = (id: string): string =>
    directory.orgUnits.find((orgUnit) => orgUnit.id === id)?.name ?? id;
  const positionName = (id: string): string =>
    directory.positions.find((position) => position.id === id)?.name ?? id;
  const formFieldName = (fieldKey: string): string =>
    directory.formFields.find((field) => field.fieldKey === fieldKey)?.label ||
    fieldKey;
  const nodeNames = (idList: string): string =>
    idList
      .split(',')
      .map((id) => directory.nodes.find((node) => node.id === id)?.name ?? id)
      .join('、');

  if (kind === 'position' && ids.length === 1 && ids[0]) {
    return `職位：${positionName(ids[0])}（送出時依當下人員決定）`;
  }

  if (kind === 'orgUnitMember' && ids.length === 1 && ids[0]) {
    return `組織任一人：${orgUnitName(ids[0])}`;
  }

  if (kind === 'orgUnitPosition' && ids.length === 2 && ids[0] && ids[1]) {
    return `組織職位：${orgUnitName(ids[0])}／${positionName(ids[1])}`;
  }

  if (kind === 'orgUnitManager' && ids.length === 1 && ids[0]) {
    return `組織主管：${orgUnitName(ids[0])}`;
  }

  // The dry-run sample for a member field (`readDryRunFormMemberPlaceholder`).
  if (kind === 'formMember' && ids.length === 1 && ids[0]) {
    return `表單欄位「${formFieldName(ids[0])}」選的人（送出時依填寫內容決定）`;
  }

  if (kind === 'orgManagerChain' && ids.length === 1 && ids[0]) {
    return `主管鏈：簽到職等 ${ids[0]}（送出時依組織決定實際主管）`;
  }

  // The four placeholders of the form-field and prior-stage sources
  // (`readDryRunPlaceholderAssignee` in the engine). A form key or node id may
  // itself hold a colon, so the level is the last segment and the rest is the
  // key / id list.
  const rest = ids.join(':');
  const levelSplit = rest.lastIndexOf(':');
  const leading = levelSplit > 0 ? rest.slice(0, levelSplit) : '';
  const level =
    levelSplit > 0 ? Number(rest.slice(levelSplit + 1)) : Number.NaN;
  const hasLevel = leading !== '' && Number.isInteger(level) && level >= 1;

  if (kind === 'formMemberManager' && hasLevel) {
    return `表單欄位「${formFieldName(leading)}」選的人的${managerLevelName(level)}（送出時依填寫內容與組織決定）`;
  }

  if (kind === 'formOrgUnitManager' && rest) {
    return `表單欄位「${formFieldName(rest)}」所選組織的主管（送出時依填寫內容決定）`;
  }

  if (kind === 'nodeActor' && rest) {
    return `前面關卡「${nodeNames(rest)}」的簽核者（送出時依實際簽核者決定）`;
  }

  if (kind === 'nodeActorManager' && hasLevel) {
    return `前面關卡「${nodeNames(leading)}」簽核者的${managerLevelName(level)}（送出時依實際簽核者決定）`;
  }

  return directory.memberName(assignee) ?? assignee;
}
