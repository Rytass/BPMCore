import type { FormFieldValue } from '@rytass/bpm-core-shared/form';
import { readFormMemberIds } from '@rytass/bpm-core-shared/form';
import { formatMemberLabel } from '../../../lib/format-member-label';

/**
 * One pickable member, shaped for Mezzanine `AutoComplete` (`id` + `name`).
 * `unresolved` marks the placeholder written when a stored id has no profile,
 * so a real profile arriving later replaces it instead of the placeholder
 * sticking (the designer does the same for its approver list).
 */
export type MemberFieldOption = Readonly<{
  id: string;
  name: string;
  unresolved?: boolean;
}>;

export const UNKNOWN_MEMBER_NAME = '未知會員';

export function readMemberFieldOption(member: {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}): MemberFieldOption {
  return {
    id: member.memberId,
    name: formatMemberLabel(member.name, member.email),
  };
}

export function readUnresolvedMemberFieldOption(
  memberId: string,
): MemberFieldOption {
  return { id: memberId, name: UNKNOWN_MEMBER_NAME, unresolved: true };
}

/**
 * Adds `nextOptions` to `currentOptions`. A resolved option replaces an
 * unresolved placeholder with the same id; otherwise the first one seen wins.
 * Returns `currentOptions` itself when nothing changed, so state setters can
 * bail out of a re-render.
 */
export function mergeMemberFieldOptions(
  currentOptions: readonly MemberFieldOption[],
  nextOptions: readonly MemberFieldOption[],
): readonly MemberFieldOption[] {
  const resolvedById = new Map(
    nextOptions
      .filter((option) => !option.unresolved)
      .map((option) => [option.id, option] as const),
  );
  const currentIds = new Set(currentOptions.map((option) => option.id));
  const addedOptions = nextOptions.filter(
    (option, index) =>
      !currentIds.has(option.id) &&
      nextOptions.findIndex((candidate) => candidate.id === option.id) ===
        index,
  );
  const upgradedOptions = currentOptions.map(
    (option) =>
      (option.unresolved ? resolvedById.get(option.id) : undefined) ?? option,
  );
  const changed =
    addedOptions.length > 0 ||
    upgradedOptions.some((option, index) => option !== currentOptions[index]);

  return changed ? [...upgradedOptions, ...addedOptions] : currentOptions;
}

/** Ids in the stored value that no known option covers yet. */
export function readUnresolvedMemberIds(
  value: FormFieldValue | undefined,
  knownOptions: readonly MemberFieldOption[],
): readonly string[] {
  const knownIds = new Set(
    knownOptions
      .filter((option) => !option.unresolved)
      .map((option) => option.id),
  );

  return readFormMemberIds(value).filter((memberId) => !knownIds.has(memberId));
}

/**
 * The stored value as options, in stored order. An id with no known profile
 * still shows up (as 「未知會員」) so the filler can see and remove it.
 */
export function readSelectedMemberFieldOptions(
  value: FormFieldValue | undefined,
  knownOptions: readonly MemberFieldOption[],
): readonly MemberFieldOption[] {
  return readFormMemberIds(value).map(
    (memberId) =>
      knownOptions.find((option) => option.id === memberId) ??
      readUnresolvedMemberFieldOption(memberId),
  );
}

/**
 * What a picker change writes back. Nothing picked is `undefined`, the same as
 * every other optional field, so the renderer's own initial value (`[]` for a
 * multiple member field) is restored by `buildFormRendererValues`.
 */
export function readMemberFieldValue(
  selected: readonly MemberFieldOption[],
  multiple: boolean,
): FormFieldValue | undefined {
  if (selected.length === 0) {
    return undefined;
  }

  return multiple ? selected.map((option) => option.id) : selected[0]?.id;
}
