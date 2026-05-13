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
      customFields: { employeeNo: 'EMP-001', site: '台北總部' },
      memberId: 'member-001',
      name: '林執行長',
      positionId: 'CEO',
      primaryOrgUnitId: 'CEO-OFFICE',
    },
    password: 'demo',
    permissions: ['bpm:*'],
    roles: ['BPM_ADMIN'],
  },
  {
    member: {
      email: 'chen.cfo@example.internal',
      customFields: { employeeNo: 'EMP-101', site: '台北總部' },
      memberId: 'member-101',
      name: '陳財務長',
      positionId: 'VP',
      primaryOrgUnitId: 'FIN',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'wu.ap@example.internal',
      customFields: { employeeNo: 'EMP-102', site: '台北總部' },
      memberId: 'member-102',
      name: '吳應付帳款專員',
      positionId: 'FINANCE_SPECIALIST',
      primaryOrgUnitId: 'FIN-AP',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'li.fpna@example.internal',
      customFields: { employeeNo: 'EMP-103', site: '台北總部' },
      memberId: 'member-103',
      name: '李財務分析師',
      positionId: 'SENIOR_SPECIALIST',
      primaryOrgUnitId: 'FIN-FPNA',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'huang.hr@example.internal',
      customFields: { employeeNo: 'EMP-201', site: '台北總部' },
      memberId: 'member-201',
      name: '黃人資主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'HR',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'tsai.hr@example.internal',
      customFields: { employeeNo: 'EMP-202', site: '台北總部' },
      memberId: 'member-202',
      name: '蔡人資專員',
      positionId: 'HR_SPECIALIST',
      primaryOrgUnitId: 'HR',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'chang.sales@example.internal',
      customFields: { employeeNo: 'EMP-301', site: '台北總部' },
      memberId: 'member-301',
      name: '張業務主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'SALES',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'wang.ae@example.internal',
      customFields: { employeeNo: 'EMP-302', site: '台北總部' },
      memberId: 'member-302',
      name: '王客戶經理',
      positionId: 'ACCOUNT_EXECUTIVE',
      primaryOrgUnitId: 'SALES',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'lu.cs@example.internal',
      customFields: { employeeNo: 'EMP-303', site: '台北總部' },
      memberId: 'member-303',
      name: '盧客戶成功顧問',
      positionId: 'SENIOR_SPECIALIST',
      primaryOrgUnitId: 'CUSTOMER-SUCCESS',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'hsu.it@example.internal',
      customFields: { employeeNo: 'EMP-401', site: '台北總部' },
      memberId: 'member-401',
      name: '許資訊主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'IT',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'ko.it@example.internal',
      customFields: { employeeNo: 'EMP-402', site: '台北總部' },
      memberId: 'member-402',
      name: '柯系統工程師',
      positionId: 'IT_ENGINEER',
      primaryOrgUnitId: 'IT',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
  },
  {
    member: {
      email: 'sun.product@example.internal',
      customFields: { employeeNo: 'EMP-501', site: '台北總部' },
      memberId: 'member-501',
      name: '孫產品主管',
      positionId: 'DEPARTMENT_HEAD',
      primaryOrgUnitId: 'PRODUCT',
    },
    password: 'demo',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  },
  {
    member: {
      email: 'yang.pm@example.internal',
      customFields: { employeeNo: 'EMP-502', site: '台北總部' },
      memberId: 'member-502',
      name: '楊產品經理',
      positionId: 'PRODUCT_MANAGER',
      primaryOrgUnitId: 'PRODUCT',
    },
    password: 'demo',
    permissions: ['instance.create', 'instance.read'],
    roles: ['REQUESTER'],
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
