import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  ManagerResolutionScopeTypeEnum,
  OrganizationService,
  OrgUnitTypeEnum,
} from '@bpm/core/organization';

type DemoOrgUnitCode =
  | 'BPM-HQ'
  | 'FIN-AP'
  | 'FIN-FPA'
  | 'FIN-TW'
  | 'HR-TW'
  | 'IT-TW'
  | 'SALES-TW';

type DemoPositionCode =
  | 'AP_SPECIALIST'
  | 'CEO'
  | 'DEPARTMENT_HEAD'
  | 'FPNA_SPECIALIST'
  | 'SENIOR_SPECIALIST'
  | 'TEAM_LEAD';

interface DemoOrgUnitSeed {
  readonly code: DemoOrgUnitCode;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly parentCode: DemoOrgUnitCode | null;
  readonly type: OrgUnitTypeEnum;
}

interface DemoPositionSeed {
  readonly code: DemoPositionCode;
  readonly level: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
}

interface DemoMembershipSeed {
  readonly memberId: string;
  readonly orgUnitCode: DemoOrgUnitCode;
  readonly positionCode: DemoPositionCode;
}

interface DemoManagerResolutionSeed {
  readonly managerMemberId: string;
  readonly priority: number;
  readonly scopeCode: DemoOrgUnitCode | DemoPositionCode | string;
  readonly scopeType: ManagerResolutionScopeTypeEnum;
}

const EFFECTIVE_FROM = '2026-01-01';

const DEMO_ORG_UNITS: readonly DemoOrgUnitSeed[] = [
  {
    code: 'BPM-HQ',
    metadata: {
      costCenter: 'HQ-000',
      location: 'Taipei HQ',
      note: 'Demo host company root for BPM approval scenarios.',
    },
    name: 'Rytass 總管理處',
    parentCode: null,
    type: OrgUnitTypeEnum.COMPANY,
  },
  {
    code: 'FIN-TW',
    metadata: {
      costCenter: 'FIN-100',
      location: 'Taipei',
      note: 'Owns reimbursement, payment, and budget approvals.',
    },
    name: '財務部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
  {
    code: 'FIN-AP',
    metadata: {
      costCenter: 'FIN-110',
      location: 'Taipei',
      note: 'Accounts payable team for vendor invoice review.',
    },
    name: '應付帳款組',
    parentCode: 'FIN-TW',
    type: OrgUnitTypeEnum.TEAM,
  },
  {
    code: 'FIN-FPA',
    metadata: {
      costCenter: 'FIN-120',
      location: 'Taipei',
      note: 'Budget control and financial planning team.',
    },
    name: '預算分析組',
    parentCode: 'FIN-TW',
    type: OrgUnitTypeEnum.TEAM,
  },
  {
    code: 'HR-TW',
    metadata: {
      costCenter: 'HR-200',
      location: 'Taipei',
      note: 'Personnel, onboarding, and internal policy approvals.',
    },
    name: '人資行政部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
  {
    code: 'SALES-TW',
    metadata: {
      costCenter: 'SAL-300',
      location: 'Taipei',
      note: 'Customer proposal and discount approval owner.',
    },
    name: '業務營運部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
  {
    code: 'IT-TW',
    metadata: {
      costCenter: 'IT-400',
      location: 'Taipei',
      note: 'Internal systems, access, and infrastructure approvals.',
    },
    name: '資訊平台部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
];

const DEMO_POSITIONS: readonly DemoPositionSeed[] = [
  {
    code: 'CEO',
    level: 100,
    metadata: { approvalLimit: 'unlimited' },
    name: '執行長',
  },
  {
    code: 'DEPARTMENT_HEAD',
    level: 80,
    metadata: { approvalLimit: 500000 },
    name: '部門主管',
  },
  {
    code: 'TEAM_LEAD',
    level: 60,
    metadata: { approvalLimit: 150000 },
    name: '組長',
  },
  {
    code: 'SENIOR_SPECIALIST',
    level: 45,
    metadata: { approvalLimit: 50000 },
    name: '資深專員',
  },
  {
    code: 'AP_SPECIALIST',
    level: 40,
    metadata: { approvalLimit: 30000 },
    name: '應付帳款專員',
  },
  {
    code: 'FPNA_SPECIALIST',
    level: 40,
    metadata: { approvalLimit: 30000 },
    name: '預算分析專員',
  },
];

const DEMO_MEMBERSHIPS: readonly DemoMembershipSeed[] = [
  {
    memberId: 'member-001',
    orgUnitCode: 'BPM-HQ',
    positionCode: 'CEO',
  },
  {
    memberId: 'member-101',
    orgUnitCode: 'FIN-TW',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    memberId: 'member-102',
    orgUnitCode: 'FIN-AP',
    positionCode: 'AP_SPECIALIST',
  },
  {
    memberId: 'member-103',
    orgUnitCode: 'FIN-FPA',
    positionCode: 'FPNA_SPECIALIST',
  },
  {
    memberId: 'member-201',
    orgUnitCode: 'HR-TW',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    memberId: 'member-301',
    orgUnitCode: 'SALES-TW',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    memberId: 'member-401',
    orgUnitCode: 'IT-TW',
    positionCode: 'DEPARTMENT_HEAD',
  },
];

const DEMO_MANAGER_RESOLUTIONS: readonly DemoManagerResolutionSeed[] = [
  {
    managerMemberId: 'member-001',
    priority: 90,
    scopeCode: 'FIN-TW',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-101',
    priority: 120,
    scopeCode: 'FIN-AP',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-101',
    priority: 120,
    scopeCode: 'FIN-FPA',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-001',
    priority: 90,
    scopeCode: 'HR-TW',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-001',
    priority: 90,
    scopeCode: 'SALES-TW',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-001',
    priority: 90,
    scopeCode: 'IT-TW',
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
  },
  {
    managerMemberId: 'member-001',
    priority: 80,
    scopeCode: 'DEPARTMENT_HEAD',
    scopeType: ManagerResolutionScopeTypeEnum.POSITION,
  },
  {
    managerMemberId: 'member-101',
    priority: 200,
    scopeCode: 'member-102',
    scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
  },
];

@Injectable()
export class ApiDemoOrganizationSeedService
  implements OnApplicationBootstrap
{
  constructor(private readonly organizationService: OrganizationService) {}

  async onApplicationBootstrap(): Promise<void> {
    const summary = await this.organizationService.readOrganizationSummary();
    const hasOrganizationData = [
      summary.managerResolutionCount,
      summary.membershipCount,
      summary.orgUnitCount,
      summary.positionCount,
    ].some((count) => count > 0);

    if (hasOrganizationData) {
      return;
    }

    await this.seedDemoOrganization();
  }

  private async seedDemoOrganization(): Promise<void> {
    const orgUnitIdsByCode = await this.createOrgUnits();
    const positionIdsByCode = await this.createPositions();

    await Promise.all(
      DEMO_MEMBERSHIPS.map((membership) =>
        this.organizationService.createMembership({
          effectiveFrom: EFFECTIVE_FROM,
          effectiveTo: null,
          isPrimary: true,
          memberId: membership.memberId,
          orgUnitId: readRequiredMapValue(
            orgUnitIdsByCode,
            membership.orgUnitCode,
          ),
          positionId: readRequiredMapValue(
            positionIdsByCode,
            membership.positionCode,
          ),
        }),
      ),
    );

    await Promise.all(
      DEMO_MANAGER_RESOLUTIONS.map((resolution) =>
        this.organizationService.createManagerResolution({
          effectiveFrom: EFFECTIVE_FROM,
          effectiveTo: null,
          managerMemberId: resolution.managerMemberId,
          priority: resolution.priority,
          scopeId: this.readResolutionScopeId(
            resolution,
            orgUnitIdsByCode,
            positionIdsByCode,
          ),
          scopeType: resolution.scopeType,
        }),
      ),
    );
  }

  private async createOrgUnits(): Promise<
    ReadonlyMap<DemoOrgUnitCode, string>
  > {
    return DEMO_ORG_UNITS.reduce(
      async (
        mapPromise,
        seed,
      ): Promise<ReadonlyMap<DemoOrgUnitCode, string>> => {
        const idsByCode = await mapPromise;
        const created = await this.organizationService.createOrgUnit({
          code: seed.code,
          metadataJson: JSON.stringify(seed.metadata),
          name: seed.name,
          parentId: seed.parentCode
            ? readRequiredMapValue(idsByCode, seed.parentCode)
            : null,
          type: seed.type,
        });

        return new Map([...idsByCode, [seed.code, created.id]]);
      },
      Promise.resolve(new Map<DemoOrgUnitCode, string>()),
    );
  }

  private async createPositions(): Promise<
    ReadonlyMap<DemoPositionCode, string>
  > {
    const entries = await Promise.all(
      DEMO_POSITIONS.map(async (seed): Promise<readonly [DemoPositionCode, string]> => {
        const created = await this.organizationService.createPosition({
          code: seed.code,
          level: seed.level,
          metadataJson: JSON.stringify(seed.metadata),
          name: seed.name,
        });

        return [seed.code, created.id];
      }),
    );

    return new Map(entries);
  }

  private readResolutionScopeId(
    resolution: DemoManagerResolutionSeed,
    orgUnitIdsByCode: ReadonlyMap<DemoOrgUnitCode, string>,
    positionIdsByCode: ReadonlyMap<DemoPositionCode, string>,
  ): string {
    if (resolution.scopeType === ManagerResolutionScopeTypeEnum.ORG_UNIT) {
      return readRequiredMapValue(
        orgUnitIdsByCode,
        resolution.scopeCode as DemoOrgUnitCode,
      );
    }

    if (resolution.scopeType === ManagerResolutionScopeTypeEnum.POSITION) {
      return readRequiredMapValue(
        positionIdsByCode,
        resolution.scopeCode as DemoPositionCode,
      );
    }

    return resolution.scopeCode;
  }
}

function readRequiredMapValue<TKey extends string>(
  map: ReadonlyMap<TKey, string>,
  key: TKey,
): string {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Missing demo organization seed id for ${key}`);
  }

  return value;
}
