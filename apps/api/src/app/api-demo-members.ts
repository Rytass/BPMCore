import type { MemberMetadata } from '@bpm/shared';

export interface ApiMemberProfile {
  readonly member: MemberMetadata;
  readonly password: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

export const API_DEMO_MEMBER_PROFILES: readonly ApiMemberProfile[] = [
  {
    member: {
      email: 'lin.ceo@example.internal',
      customFields: {},
      memberId: 'member-001',
      name: '林執行長',
      positionId: null,
      primaryOrgUnitId: 'BPM-HQ',
    },
    password: 'demo',
    permissions: ['bpm:*'],
    roles: ['BPM_ADMIN'],
  },
  {
    member: {
      email: 'chen.manager@example.internal',
      customFields: {},
      memberId: 'member-101',
      name: '陳財務主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'FIN-TW',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'wu.staff@example.internal',
      customFields: {},
      memberId: 'member-102',
      name: '吳財務專員',
      positionId: 'AP_SPECIALIST',
      primaryOrgUnitId: 'FIN-AP',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'li.accounting@example.internal',
      customFields: {},
      memberId: 'member-103',
      name: '李會計專員',
      positionId: 'FPNA_SPECIALIST',
      primaryOrgUnitId: 'FIN-FPA',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'huang.hr@example.internal',
      customFields: {},
      memberId: 'member-201',
      name: '黃人資主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'HR-TW',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'chang.sales@example.internal',
      customFields: {},
      memberId: 'member-301',
      name: '張業務主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'SALES-TW',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'hsu.it@example.internal',
      customFields: {},
      memberId: 'member-401',
      name: '許資訊主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'IT-TW',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
];

export function findApiMemberProfile(
  identifier: string,
): ApiMemberProfile | null {
  const normalizedIdentifier = identifier.trim().toLocaleLowerCase();

  if (!normalizedIdentifier) {
    return null;
  }

  return (
    API_DEMO_MEMBER_PROFILES.find(
      (profile) =>
        profile.member.memberId.toLocaleLowerCase() === normalizedIdentifier ||
        profile.member.email.toLocaleLowerCase() === normalizedIdentifier,
    ) ?? null
  );
}

export function findApiMemberProfileById(
  memberId: string,
): ApiMemberProfile | null {
  return (
    API_DEMO_MEMBER_PROFILES.find(
      (profile) => profile.member.memberId === memberId,
    ) ?? null
  );
}
