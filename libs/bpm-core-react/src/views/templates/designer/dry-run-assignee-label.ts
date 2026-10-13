type NamedRecord = Readonly<{ id: string; name: string }>;

export type DryRunAssigneeDirectory = Readonly<{
  /** Display name of a real member id, or `null` when it is not known. */
  memberName: (memberId: string) => string | null;
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
    return `表單欄位「${ids[0]}」選的人（送出時依填寫內容決定）`;
  }

  if (kind === 'orgManagerChain' && ids.length === 1 && ids[0]) {
    return `主管鏈：簽到職等 ${ids[0]}（送出時依組織決定實際主管）`;
  }

  return directory.memberName(assignee) ?? assignee;
}
