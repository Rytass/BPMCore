import type { OrgUnitRecord } from '@rytass/bpm-core-client/organization';

export type OrgUnitParentDraftMap = ReadonlyMap<string, string | null>;

export type OrgUnitHierarchyDraftChange = Readonly<{
  orgUnitId: string;
  parentId: string | null;
  previousParentId: string | null;
}>;

export type OrgUnitParentAssignmentResult = Readonly<{
  message: string;
  parentDraft: OrgUnitParentDraftMap;
  status: 'INVALID' | 'UNCHANGED' | 'UPDATED';
}>;

export function createOrgUnitParentDraftMap(
  orgUnits: readonly OrgUnitRecord[],
): OrgUnitParentDraftMap {
  return new Map(
    orgUnits.map((orgUnit): readonly [string, string | null] => [
      orgUnit.id,
      orgUnit.parentId,
    ]),
  );
}

export function assignOrgUnitDraftParent({
  orgUnitId,
  parentDraft,
  parentId,
}: {
  readonly orgUnitId: string;
  readonly parentDraft: OrgUnitParentDraftMap;
  readonly parentId: string | null;
}): OrgUnitParentAssignmentResult {
  const normalizedParentId = parentId === orgUnitId ? orgUnitId : parentId;
  const validationMessage = readOrgUnitParentValidationMessage({
    orgUnitId,
    parentDraft,
    parentId: normalizedParentId,
  });

  if (validationMessage) {
    return {
      message: validationMessage,
      parentDraft,
      status: 'INVALID',
    };
  }

  if ((parentDraft.get(orgUnitId) ?? null) === normalizedParentId) {
    return {
      message: '父子關係沒有變更。',
      parentDraft,
      status: 'UNCHANGED',
    };
  }

  const nextDraft = new Map(parentDraft);
  nextDraft.set(orgUnitId, normalizedParentId);

  return {
    message: normalizedParentId ? '已暫存新的上層組織。' : '已暫存為根節點。',
    parentDraft: nextDraft,
    status: 'UPDATED',
  };
}

export function readOrgUnitHierarchyDraftChanges({
  orgUnits,
  parentDraft,
}: {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly parentDraft: OrgUnitParentDraftMap;
}): readonly OrgUnitHierarchyDraftChange[] {
  return orgUnits
    .map((orgUnit): OrgUnitHierarchyDraftChange | null => {
      const parentId = parentDraft.get(orgUnit.id) ?? null;

      return parentId === orgUnit.parentId
        ? null
        : {
            orgUnitId: orgUnit.id,
            parentId,
            previousParentId: orgUnit.parentId,
          };
    })
    .filter((change): change is OrgUnitHierarchyDraftChange => Boolean(change));
}

export function readOrgUnitParentValidationMessage({
  orgUnitId,
  parentDraft,
  parentId,
}: {
  readonly orgUnitId: string;
  readonly parentDraft: OrgUnitParentDraftMap;
  readonly parentId: string | null;
}): string | null {
  if (!parentDraft.has(orgUnitId)) {
    return '找不到要搬移的組織節點。';
  }

  if (!parentId) {
    return null;
  }

  if (!parentDraft.has(parentId)) {
    return '找不到新的上層組織。';
  }

  if (parentId === orgUnitId) {
    return '組織不可成為自己的上層。';
  }

  return createsOrgUnitParentCycle({ orgUnitId, parentDraft, parentId })
    ? '不可搬移到自己的下層組織。'
    : null;
}

function createsOrgUnitParentCycle({
  orgUnitId,
  parentDraft,
  parentId,
}: {
  readonly orgUnitId: string;
  readonly parentDraft: OrgUnitParentDraftMap;
  readonly parentId: string;
}): boolean {
  const visitedIds = new Set<string>();
  let currentParentId: string | null = parentId;

  while (currentParentId) {
    if (currentParentId === orgUnitId || visitedIds.has(currentParentId)) {
      return true;
    }

    visitedIds.add(currentParentId);
    currentParentId = parentDraft.get(currentParentId) ?? null;
  }

  return false;
}
