export type OrgUnitType = 'company' | 'division' | 'department' | 'team';

export type ManagerResolutionScopeType = 'MEMBER' | 'ORG_UNIT' | 'POSITION';

export interface OrgUnit {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly type: OrgUnitType;
  readonly path: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Position {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly level: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Membership {
  readonly id: string;
  readonly memberId: string;
  readonly orgUnitId: string;
  readonly positionId: string | null;
  readonly isPrimary: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface ManagerResolution {
  readonly id: string;
  readonly scopeType: ManagerResolutionScopeType;
  readonly scopeId: string;
  readonly managerMemberId: string;
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}
