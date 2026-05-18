import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  ManagerResolutionScopeTypeEnum,
  OrganizationService,
  OrgUnitTypeEnum,
} from '@rytass/bpm-core-nestjs-module/organization';
import { DataSource, QueryRunner } from 'typeorm';
import {
  API_SIMULATION_MEMBER_SEEDS,
  createApiTestMemberPasswordHash,
} from './api-simulation-members';
import { ensureApiTestMemberTable } from './api-test-member-schema';

type SimulationOrgUnitCode =
  | 'BPM-HQ'
  | 'FIN-AP'
  | 'FIN-FPA'
  | 'FIN-TW'
  | 'HR-TW'
  | 'IT-TW'
  | 'SALES-TW';

type SimulationPositionCode =
  | 'AP_SPECIALIST'
  | 'CEO'
  | 'DEPARTMENT_HEAD'
  | 'FPNA_SPECIALIST'
  | 'SENIOR_SPECIALIST'
  | 'TEAM_LEAD';

interface SimulationOrgUnitSeed {
  readonly code: SimulationOrgUnitCode;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly parentCode: SimulationOrgUnitCode | null;
  readonly type: OrgUnitTypeEnum;
}

interface SimulationPositionSeed {
  readonly code: SimulationPositionCode;
  readonly level: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
}

interface SimulationMembershipSeed {
  readonly memberId: string;
  readonly orgUnitCode: SimulationOrgUnitCode;
  readonly positionCode: SimulationPositionCode;
}

interface SimulationManagerResolutionSeed {
  readonly managerMemberId: string;
  readonly priority: number;
  readonly scopeCode: SimulationOrgUnitCode | SimulationPositionCode | string;
  readonly scopeType: ManagerResolutionScopeTypeEnum;
}

const EFFECTIVE_FROM = '2026-01-01';

const SIMULATION_ORG_UNITS: readonly SimulationOrgUnitSeed[] = [
  {
    code: 'BPM-HQ',
    metadata: {
      costCenter: 'GM-000',
      location: 'Taichung Plant',
      note: 'Simulation host manufacturing company root for BPM approval scenarios.',
    },
    name: '瑞和精密工業股份有限公司',
    parentCode: null,
    type: OrgUnitTypeEnum.COMPANY,
  },
  {
    code: 'FIN-TW',
    metadata: {
      costCenter: 'FIN-100',
      location: 'Taichung Plant',
      note: 'Owns payable, payment, and budget approvals.',
    },
    name: '財務管理部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
  {
    code: 'FIN-AP',
    metadata: {
      costCenter: 'PUR-210',
      location: 'Taichung Plant',
      note: 'Purchasing and accounts payable team for vendor invoice review.',
    },
    name: '採購與應付帳款課',
    parentCode: 'FIN-TW',
    type: OrgUnitTypeEnum.TEAM,
  },
  {
    code: 'FIN-FPA',
    metadata: {
      costCenter: 'COST-120',
      location: 'Taichung Plant',
      note: 'Cost accounting and production budget control team.',
    },
    name: '成本會計課',
    parentCode: 'FIN-TW',
    type: OrgUnitTypeEnum.TEAM,
  },
  {
    code: 'HR-TW',
    metadata: {
      costCenter: 'HR-200',
      location: 'Taichung Plant',
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
      location: 'Taipei Office',
      note: 'Customer quotation and price exception approval owner.',
    },
    name: '業務管理部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
  {
    code: 'IT-TW',
    metadata: {
      costCenter: 'IT-400',
      location: 'Taichung Plant',
      note: 'MES, ERP, internal systems, and infrastructure approvals.',
    },
    name: '資訊與製造系統部',
    parentCode: 'BPM-HQ',
    type: OrgUnitTypeEnum.DEPARTMENT,
  },
];

const SIMULATION_POSITIONS: readonly SimulationPositionSeed[] = [
  {
    code: 'CEO',
    level: 100,
    metadata: { approvalLimit: 'unlimited' },
    name: '總經理',
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
    name: '採購專員',
  },
  {
    code: 'FPNA_SPECIALIST',
    level: 40,
    metadata: { approvalLimit: 30000 },
    name: '成本會計專員',
  },
];

const SIMULATION_MEMBERSHIPS: readonly SimulationMembershipSeed[] = [
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

const SIMULATION_MANAGER_RESOLUTIONS: readonly SimulationManagerResolutionSeed[] =
  [
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
export class ApiSimulationSeedService implements OnApplicationBootstrap {
  constructor(
    private readonly dataSource: DataSource,
    private readonly organizationService: OrganizationService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedApiTestMembers();

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

    await this.seedSimulationOrganization();
  }

  private async seedApiTestMembers(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      await ensureApiTestMemberTable(queryRunner);
      await API_SIMULATION_MEMBER_SEEDS.reduce(
        async (previous, member): Promise<void> => {
          await previous;
          await upsertApiTestMember(queryRunner, member);
        },
        Promise.resolve(),
      );
    } finally {
      await queryRunner.release();
    }
  }

  private async seedSimulationOrganization(): Promise<void> {
    const orgUnitIdsByCode = await this.createOrgUnits();
    const positionIdsByCode = await this.createPositions();

    await Promise.all(
      SIMULATION_MEMBERSHIPS.map((membership) =>
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
      SIMULATION_MANAGER_RESOLUTIONS.map((resolution) =>
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
    ReadonlyMap<SimulationOrgUnitCode, string>
  > {
    return SIMULATION_ORG_UNITS.reduce(
      async (
        mapPromise,
        seed,
      ): Promise<ReadonlyMap<SimulationOrgUnitCode, string>> => {
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
      Promise.resolve(new Map<SimulationOrgUnitCode, string>()),
    );
  }

  private async createPositions(): Promise<
    ReadonlyMap<SimulationPositionCode, string>
  > {
    const entries = await Promise.all(
      SIMULATION_POSITIONS.map(
        async (seed): Promise<readonly [SimulationPositionCode, string]> => {
          const created = await this.organizationService.createPosition({
            code: seed.code,
            level: seed.level,
            metadataJson: JSON.stringify(seed.metadata),
            name: seed.name,
          });

          return [seed.code, created.id];
        },
      ),
    );

    return new Map(entries);
  }

  private readResolutionScopeId(
    resolution: SimulationManagerResolutionSeed,
    orgUnitIdsByCode: ReadonlyMap<SimulationOrgUnitCode, string>,
    positionIdsByCode: ReadonlyMap<SimulationPositionCode, string>,
  ): string {
    if (resolution.scopeType === ManagerResolutionScopeTypeEnum.ORG_UNIT) {
      return readRequiredMapValue(
        orgUnitIdsByCode,
        resolution.scopeCode as SimulationOrgUnitCode,
      );
    }

    if (resolution.scopeType === ManagerResolutionScopeTypeEnum.POSITION) {
      return readRequiredMapValue(
        positionIdsByCode,
        resolution.scopeCode as SimulationPositionCode,
      );
    }

    return resolution.scopeCode;
  }
}

async function upsertApiTestMember(
  queryRunner: QueryRunner,
  member: (typeof API_SIMULATION_MEMBER_SEEDS)[number],
): Promise<void> {
  await queryRunner.query(
    `
      INSERT INTO api_test_members (
        member_id,
        email,
        name,
        password_hash,
        roles,
        permissions,
        custom_fields
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
      ON CONFLICT (member_id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        roles = EXCLUDED.roles,
        permissions = EXCLUDED.permissions,
        custom_fields = EXCLUDED.custom_fields,
        updated_at = now()
    `,
    [
      member.memberId,
      member.email,
      member.name,
      createApiTestMemberPasswordHash(member.password),
      JSON.stringify(member.roles),
      JSON.stringify(member.permissions),
      JSON.stringify(member.customFields),
    ],
  );
}

function readRequiredMapValue<TKey extends string>(
  map: ReadonlyMap<TKey, string>,
  key: TKey,
): string {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Missing simulation organization seed id for ${key}`);
  }

  return value;
}
