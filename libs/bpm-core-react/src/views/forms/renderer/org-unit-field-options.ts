import type { FormFieldValue } from '@rytass/bpm-core-shared/form';
import type { OrgUnitOptionRecord } from '@rytass/bpm-core-client/organization';

/**
 * One pickable organization unit, shaped for Mezzanine `AutoComplete` (`id` +
 * `name`). `unresolved` marks a placeholder written while the stored id has no
 * name yet (the id itself is shown) or when the server cannot give one
 * (「未知組織」), so a real name arriving later replaces the placeholder.
 */
export type OrgUnitFieldOption = Readonly<{
  id: string;
  name: string;
  unresolved?: boolean;
}>;

export const UNKNOWN_ORG_UNIT_NAME = '未知組織';
export const DELETED_ORG_UNIT_SUFFIX = '（已刪除）';

export function readOrgUnitFieldOption(
  record: OrgUnitOptionRecord,
): OrgUnitFieldOption {
  return {
    id: record.id,
    name: record.deleted
      ? `${record.name}${DELETED_ORG_UNIT_SUFFIX}`
      : record.name,
  };
}

/** The id stands in for the name until the lookup comes back. */
export function readPendingOrgUnitFieldOption(
  orgUnitId: string,
): OrgUnitFieldOption {
  return { id: orgUnitId, name: orgUnitId, unresolved: true };
}

export function readUnknownOrgUnitFieldOption(
  orgUnitId: string,
): OrgUnitFieldOption {
  return { id: orgUnitId, name: UNKNOWN_ORG_UNIT_NAME, unresolved: true };
}

function readStoredOrgUnitId(value: FormFieldValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isSameOrgUnitId(left: string, right: string): boolean {
  // The server lowercases the ids it is given and answers with the lowercase
  // form, so a stored id is matched without regard to case.
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * The stored value as an option. An id nobody has named yet shows as itself;
 * one the server could not name shows as 「未知組織」 (it is in `knownOptions` as
 * a placeholder), so the filler can still see and replace it.
 */
export function readSelectedOrgUnitFieldOption(
  value: FormFieldValue | undefined,
  knownOptions: readonly OrgUnitFieldOption[],
): OrgUnitFieldOption | null {
  const orgUnitId = readStoredOrgUnitId(value);

  if (orgUnitId === null) {
    return null;
  }

  return (
    knownOptions.find((option) => isSameOrgUnitId(option.id, orgUnitId)) ??
    readPendingOrgUnitFieldOption(orgUnitId)
  );
}

/**
 * The stored id that no known option covers yet, or `null`. An id the server
 * could not name is covered by its 「未知組織」 placeholder, so it is not asked
 * for again.
 */
export function readUnresolvedOrgUnitId(
  value: FormFieldValue | undefined,
  knownOptions: readonly OrgUnitFieldOption[],
): string | null {
  const orgUnitId = readStoredOrgUnitId(value);

  return orgUnitId !== null &&
    !knownOptions.some((option) => isSameOrgUnitId(option.id, orgUnitId))
    ? orgUnitId
    : null;
}

/**
 * Adds `nextOptions` to `currentOptions`. A named option replaces an unresolved
 * placeholder with the same id; otherwise the first one seen wins. Returns
 * `currentOptions` itself when nothing changed, so state setters can bail out
 * of a re-render.
 */
export function mergeOrgUnitFieldOptions(
  currentOptions: readonly OrgUnitFieldOption[],
  nextOptions: readonly OrgUnitFieldOption[],
): readonly OrgUnitFieldOption[] {
  const namedById = new Map(
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
      (option.unresolved ? namedById.get(option.id) : undefined) ?? option,
  );
  const changed =
    addedOptions.length > 0 ||
    upgradedOptions.some((option, index) => option !== currentOptions[index]);

  return changed ? [...upgradedOptions, ...addedOptions] : currentOptions;
}

/**
 * What a picker change writes back. Nothing picked is `undefined`, the same as
 * every other optional field.
 */
export function readOrgUnitFieldValue(
  selected: OrgUnitFieldOption | null,
): FormFieldValue | undefined {
  return selected ? selected.id : undefined;
}
