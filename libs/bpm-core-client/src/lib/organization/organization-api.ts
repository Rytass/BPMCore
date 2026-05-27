import { requestGraphQl } from '../graphql-client';
import type {
  OrgUnitType,
  ManagerResolutionScopeType,
} from '@rytass/bpm-core-shared';

/**
 * Re-exported from `@rytass/bpm-core-shared` for consumer convenience —
 * the single source of truth lives there. Both import paths produce
 * the same TypeScript type, so consumers may pick whichever subpath
 * they already import from elsewhere.
 */
export type { OrgUnitType, ManagerResolutionScopeType };

export interface OrgUnitRecord {
  readonly code: string;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly type: OrgUnitType;
  readonly updatedAt: string;
}

export interface PositionRecord {
  readonly code: string;
  readonly createdAt: string;
  readonly id: string;
  readonly level: number;
  readonly name: string;
  readonly updatedAt: string;
}

export interface MembershipRecord {
  readonly createdAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly id: string;
  readonly isPrimary: boolean;
  readonly memberId: string;
  readonly orgUnitId: string;
  readonly positionId: string | null;
  readonly updatedAt: string;
}

export interface ManagerResolutionRecord {
  readonly createdAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly id: string;
  readonly managerMemberId: string;
  readonly priority: number;
  readonly scopeId: string;
  readonly scopeType: ManagerResolutionScopeType;
}

export interface OrganizationSummaryRecord {
  readonly managerResolutionCount: number;
  readonly membershipCount: number;
  readonly orgUnitCount: number;
  readonly positionCount: number;
}

export interface ResolvedManagerRecord {
  readonly managerMemberId: string | null;
  readonly memberId: string;
}

interface OrganizationDashboardQueryData {
  readonly filteredManagerResolutions: readonly ManagerResolutionRecord[];
  readonly filteredMemberships: readonly MembershipRecord[];
  readonly filteredOrgUnits: readonly OrgUnitRecord[];
  readonly filteredPositions: readonly PositionRecord[];
  readonly managerResolutionCount: number;
  readonly managerResolutions: readonly ManagerResolutionRecord[];
  readonly membershipCount: number;
  readonly memberships: readonly MembershipRecord[];
  readonly organizationSummary: OrganizationSummaryRecord;
  readonly orgUnitCount: number;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly positionCount: number;
  readonly positions: readonly PositionRecord[];
}

interface MembershipsQueryData {
  readonly memberships: readonly MembershipRecord[];
}

interface ManagerResolutionsQueryData {
  readonly managerResolutions: readonly ManagerResolutionRecord[];
}

interface ResolvedManagerQueryData {
  readonly resolvedManager: ResolvedManagerRecord;
}

interface CreateOrgUnitMutationData {
  readonly createOrgUnit: OrgUnitRecord;
}

interface UpdateOrgUnitMutationData {
  readonly updateOrgUnit: OrgUnitRecord;
}

interface DeleteOrgUnitMutationData {
  readonly deleteOrgUnit: boolean;
}

interface CommitOrgUnitTreeDraftMutationData {
  readonly commitOrgUnitTreeDraft: {
    readonly orgUnits: readonly OrgUnitRecord[];
  };
}

interface CreatePositionMutationData {
  readonly createPosition: PositionRecord;
}

interface UpdatePositionMutationData {
  readonly updatePosition: PositionRecord;
}

interface CreateMembershipMutationData {
  readonly createMembership: MembershipRecord;
}

interface UpdateMembershipMutationData {
  readonly updateMembership: MembershipRecord;
}

interface DeleteMembershipMutationData {
  readonly deleteMembership: boolean;
}

interface CreateManagerResolutionMutationData {
  readonly createManagerResolution: ManagerResolutionRecord;
}

interface UpdateManagerResolutionMutationData {
  readonly updateManagerResolution: ManagerResolutionRecord;
}

interface DeleteManagerResolutionMutationData {
  readonly deleteManagerResolution: boolean;
}

export async function readOrganizationDashboard({
  managerActiveOnly = false,
  managerPage = 1,
  managerPageSize = null,
  managerScopeType = null,
  membershipActiveOnly = false,
  membershipOrgUnitId = null,
  membershipPage = 1,
  membershipPageSize = null,
  membershipPositionId = null,
  orgUnitPage = 1,
  orgUnitPageSize = null,
  orgUnitSearchText = null,
  orgUnitType = null,
  positionPage = 1,
  positionPageSize = null,
  positionSearchText = null,
}: {
  readonly managerActiveOnly?: boolean;
  readonly managerPage?: number;
  readonly managerPageSize?: number | null;
  readonly managerScopeType?: ManagerResolutionScopeType | null;
  readonly membershipActiveOnly?: boolean;
  readonly membershipOrgUnitId?: string | null;
  readonly membershipPage?: number;
  readonly membershipPageSize?: number | null;
  readonly membershipPositionId?: string | null;
  readonly orgUnitPage?: number;
  readonly orgUnitPageSize?: number | null;
  readonly orgUnitSearchText?: string | null;
  readonly orgUnitType?: OrgUnitType | null;
  readonly positionPage?: number;
  readonly positionPageSize?: number | null;
  readonly positionSearchText?: string | null;
} = {}): Promise<OrganizationDashboardQueryData> {
  return requestGraphQl<OrganizationDashboardQueryData>(
    `query AdminOrganizationDashboard(
      $managerActiveOnly: Boolean
      $managerPage: Int
      $managerPageSize: Int
      $managerScopeType: ManagerResolutionScopeType
      $membershipActiveOnly: Boolean
      $membershipOrgUnitId: String
      $membershipPage: Int
      $membershipPageSize: Int
      $membershipPositionId: String
      $orgUnitPage: Int
      $orgUnitPageSize: Int
      $orgUnitSearchText: String
      $orgUnitType: OrgUnitType
      $positionPage: Int
      $positionPageSize: Int
      $positionSearchText: String
    ) {
      organizationSummary {
        managerResolutionCount
        membershipCount
        orgUnitCount
        positionCount
      }
      filteredOrgUnits: orgUnits(
        page: $orgUnitPage
        pageSize: $orgUnitPageSize
        searchText: $orgUnitSearchText
        type: $orgUnitType
      ) {
        code
        createdAt
        deletedAt
        id
        name
        parentId
        path
        type
        updatedAt
      }
      orgUnitCount(
        searchText: $orgUnitSearchText
        type: $orgUnitType
      )
      orgUnits {
        code
        createdAt
        deletedAt
        id
        name
        parentId
        path
        type
        updatedAt
      }
      filteredPositions: positions(
        page: $positionPage
        pageSize: $positionPageSize
        searchText: $positionSearchText
      ) {
        code
        createdAt
        id
        level
        name
        updatedAt
      }
      positionCount(searchText: $positionSearchText)
      positions {
        code
        createdAt
        id
        level
        name
        updatedAt
      }
      filteredMemberships: memberships(
        activeOnly: $membershipActiveOnly
        orgUnitId: $membershipOrgUnitId
        page: $membershipPage
        pageSize: $membershipPageSize
        positionId: $membershipPositionId
      ) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        isPrimary
        memberId
        orgUnitId
        positionId
        updatedAt
      }
      membershipCount(
        activeOnly: $membershipActiveOnly
        orgUnitId: $membershipOrgUnitId
        positionId: $membershipPositionId
      )
      memberships {
        createdAt
        effectiveFrom
        effectiveTo
        id
        isPrimary
        memberId
        orgUnitId
        positionId
        updatedAt
      }
      filteredManagerResolutions: managerResolutions(
        activeOnly: $managerActiveOnly
        page: $managerPage
        pageSize: $managerPageSize
        scopeType: $managerScopeType
      ) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        managerMemberId
        priority
        scopeId
        scopeType
      }
      managerResolutionCount(
        activeOnly: $managerActiveOnly
        scopeType: $managerScopeType
      )
      managerResolutions {
        createdAt
        effectiveFrom
        effectiveTo
        id
        managerMemberId
        priority
        scopeId
        scopeType
      }
    }`,
    {
      managerActiveOnly,
      managerPage,
      managerPageSize,
      managerScopeType,
      membershipActiveOnly,
      membershipOrgUnitId,
      membershipPage,
      membershipPageSize,
      membershipPositionId,
      orgUnitPage,
      orgUnitPageSize,
      orgUnitSearchText,
      orgUnitType,
      positionPage,
      positionPageSize,
      positionSearchText,
    },
  );
}

export async function listMemberships({
  activeOnly = false,
  memberId = null,
  orgUnitId = null,
}: {
  readonly activeOnly?: boolean;
  readonly memberId?: string | null;
  readonly orgUnitId?: string | null;
} = {}): Promise<readonly MembershipRecord[]> {
  const data = await requestGraphQl<MembershipsQueryData>(
    `query AdminMemberships(
      $activeOnly: Boolean
      $memberId: String
      $orgUnitId: String
    ) {
      memberships(
        activeOnly: $activeOnly
        memberId: $memberId
        orgUnitId: $orgUnitId
      ) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        isPrimary
        memberId
        orgUnitId
        positionId
        updatedAt
      }
    }`,
    { activeOnly, memberId, orgUnitId },
  );

  return data.memberships;
}

export async function listManagerResolutions({
  activeOnly = false,
  scopeId = null,
  scopeType = null,
}: {
  readonly activeOnly?: boolean;
  readonly scopeId?: string | null;
  readonly scopeType?: ManagerResolutionScopeType | null;
} = {}): Promise<readonly ManagerResolutionRecord[]> {
  const data = await requestGraphQl<ManagerResolutionsQueryData>(
    `query AdminManagerResolutions(
      $activeOnly: Boolean
      $scopeId: String
      $scopeType: ManagerResolutionScopeType
    ) {
      managerResolutions(
        activeOnly: $activeOnly
        scopeId: $scopeId
        scopeType: $scopeType
      ) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        managerMemberId
        priority
        scopeId
        scopeType
      }
    }`,
    { activeOnly, scopeId, scopeType },
  );

  return data.managerResolutions;
}

export async function readResolvedManager(
  memberId: string,
): Promise<ResolvedManagerRecord> {
  const data = await requestGraphQl<ResolvedManagerQueryData>(
    `query AdminResolvedManager($memberId: String!) {
      resolvedManager(memberId: $memberId) {
        managerMemberId
        memberId
      }
    }`,
    { memberId },
  );

  return data.resolvedManager;
}

export async function createOrgUnit(input: {
  readonly code: string;
  readonly metadataJson: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly type: OrgUnitType;
}): Promise<OrgUnitRecord> {
  const data = await requestGraphQl<CreateOrgUnitMutationData>(
    `mutation AdminCreateOrgUnit($input: CreateOrgUnitInput!) {
      createOrgUnit(input: $input) {
        code
        createdAt
        deletedAt
        id
        name
        parentId
        path
        type
        updatedAt
      }
    }`,
    { input },
  );

  return data.createOrgUnit;
}

export async function updateOrgUnit(input: {
  readonly code: string | null;
  readonly id: string;
  readonly metadataJson: string | null;
  readonly name: string | null;
  readonly parentId: string | null;
  readonly type: OrgUnitType | null;
}): Promise<OrgUnitRecord> {
  const data = await requestGraphQl<UpdateOrgUnitMutationData>(
    `mutation AdminUpdateOrgUnit($input: UpdateOrgUnitInput!) {
      updateOrgUnit(input: $input) {
        code
        createdAt
        deletedAt
        id
        name
        parentId
        path
        type
        updatedAt
      }
    }`,
    { input },
  );

  return data.updateOrgUnit;
}

export async function deleteOrgUnit(id: string): Promise<boolean> {
  const data = await requestGraphQl<DeleteOrgUnitMutationData>(
    `mutation AdminDeleteOrgUnit($id: String!) {
      deleteOrgUnit(id: $id)
    }`,
    { id },
  );

  return data.deleteOrgUnit;
}

export async function commitOrgUnitTreeDraft(input: {
  readonly moves: readonly {
    readonly baseUpdatedAt: string;
    readonly id: string;
    readonly parentId: string | null;
  }[];
}): Promise<readonly OrgUnitRecord[]> {
  const data = await requestGraphQl<CommitOrgUnitTreeDraftMutationData>(
    `mutation AdminCommitOrgUnitTreeDraft($input: CommitOrgUnitTreeDraftInput!) {
      commitOrgUnitTreeDraft(input: $input) {
        orgUnits {
          code
          createdAt
          deletedAt
          id
          name
          parentId
          path
          type
          updatedAt
        }
      }
    }`,
    { input },
  );

  return data.commitOrgUnitTreeDraft.orgUnits;
}

export async function createPosition(input: {
  readonly code: string;
  readonly level: number;
  readonly metadataJson: string;
  readonly name: string;
}): Promise<PositionRecord> {
  const data = await requestGraphQl<CreatePositionMutationData>(
    `mutation AdminCreatePosition($input: CreatePositionInput!) {
      createPosition(input: $input) {
        code
        createdAt
        id
        level
        name
        updatedAt
      }
    }`,
    { input },
  );

  return data.createPosition;
}

export async function updatePosition(input: {
  readonly code: string | null;
  readonly id: string;
  readonly level: number | null;
  readonly metadataJson: string | null;
  readonly name: string | null;
}): Promise<PositionRecord> {
  const data = await requestGraphQl<UpdatePositionMutationData>(
    `mutation AdminUpdatePosition($input: UpdatePositionInput!) {
      updatePosition(input: $input) {
        code
        createdAt
        id
        level
        name
        updatedAt
      }
    }`,
    { input },
  );

  return data.updatePosition;
}

export async function createMembership(input: {
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isPrimary: boolean;
  readonly memberId: string;
  readonly orgUnitId: string;
  readonly positionId: string | null;
}): Promise<MembershipRecord> {
  const data = await requestGraphQl<CreateMembershipMutationData>(
    `mutation AdminCreateMembership($input: CreateMembershipInput!) {
      createMembership(input: $input) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        isPrimary
        memberId
        orgUnitId
        positionId
        updatedAt
      }
    }`,
    { input },
  );

  return data.createMembership;
}

export async function updateMembership(input: {
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly id: string;
  readonly isPrimary: boolean | null;
  readonly orgUnitId: string | null;
  readonly positionId: string | null;
}): Promise<MembershipRecord> {
  const data = await requestGraphQl<UpdateMembershipMutationData>(
    `mutation AdminUpdateMembership($input: UpdateMembershipInput!) {
      updateMembership(input: $input) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        isPrimary
        memberId
        orgUnitId
        positionId
        updatedAt
      }
    }`,
    { input },
  );

  return data.updateMembership;
}

export async function deleteMembership(id: string): Promise<boolean> {
  const data = await requestGraphQl<DeleteMembershipMutationData>(
    `mutation AdminDeleteMembership($id: String!) {
      deleteMembership(id: $id)
    }`,
    { id },
  );

  return data.deleteMembership;
}

export async function createManagerResolution(input: {
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly managerMemberId: string;
  readonly priority: number;
  readonly scopeId: string;
  readonly scopeType: ManagerResolutionScopeType;
}): Promise<ManagerResolutionRecord> {
  const data = await requestGraphQl<CreateManagerResolutionMutationData>(
    `mutation AdminCreateManagerResolution(
      $input: CreateManagerResolutionInput!
    ) {
      createManagerResolution(input: $input) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        managerMemberId
        priority
        scopeId
        scopeType
      }
    }`,
    { input },
  );

  return data.createManagerResolution;
}

export async function updateManagerResolution(input: {
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly id: string;
  readonly managerMemberId: string | null;
  readonly priority: number | null;
  readonly scopeId: string | null;
  readonly scopeType: ManagerResolutionScopeType | null;
}): Promise<ManagerResolutionRecord> {
  const data = await requestGraphQl<UpdateManagerResolutionMutationData>(
    `mutation AdminUpdateManagerResolution(
      $input: UpdateManagerResolutionInput!
    ) {
      updateManagerResolution(input: $input) {
        createdAt
        effectiveFrom
        effectiveTo
        id
        managerMemberId
        priority
        scopeId
        scopeType
      }
    }`,
    { input },
  );

  return data.updateManagerResolution;
}

export async function deleteManagerResolution(id: string): Promise<boolean> {
  const data = await requestGraphQl<DeleteManagerResolutionMutationData>(
    `mutation AdminDeleteManagerResolution($id: String!) {
      deleteManagerResolution(id: $id)
    }`,
    { id },
  );

  return data.deleteManagerResolution;
}
