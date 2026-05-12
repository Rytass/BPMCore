import { requestGraphQl } from '../../_lib/graphql-client';

export type OrgUnitType = 'company' | 'department' | 'division' | 'team';
export type ManagerResolutionScopeType = 'MEMBER' | 'ORG_UNIT' | 'POSITION';

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
  readonly managerResolutions: readonly ManagerResolutionRecord[];
  readonly memberships: readonly MembershipRecord[];
  readonly organizationSummary: OrganizationSummaryRecord;
  readonly orgUnits: readonly OrgUnitRecord[];
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

export async function readOrganizationDashboard(): Promise<OrganizationDashboardQueryData> {
  return requestGraphQl<OrganizationDashboardQueryData>(
    `query AdminOrganizationDashboard {
      organizationSummary {
        managerResolutionCount
        membershipCount
        orgUnitCount
        positionCount
      }
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
      positions {
        code
        createdAt
        id
        level
        name
        updatedAt
      }
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
