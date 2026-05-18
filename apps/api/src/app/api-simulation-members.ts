import { createHash } from 'node:crypto';

export interface ApiSimulationMemberSeed {
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly orgUnitCode: string;
  readonly password: string;
  readonly permissions: readonly string[];
  readonly positionCode: string;
  readonly roles: readonly string[];
}

export const API_SIMULATION_MEMBER_SEEDS: readonly ApiSimulationMemberSeed[] = [
  simulationMember({
    email: 'lin.ceo@example.internal',
    memberId: 'member-001',
    name: '林總經理',
    orgUnitCode: 'CEO-OFFICE',
    permissions: ['bpm:*'],
    positionCode: 'CEO',
    roles: ['BPM_ADMIN'],
  }),
  simulationMember({
    email: 'chen.cfo@example.internal',
    memberId: 'member-101',
    name: '陳財務經理',
    orgUnitCode: 'FIN',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    positionCode: 'VP',
    roles: ['APPROVER'],
  }),
  simulationMember({
    email: 'wu.ap@example.internal',
    memberId: 'member-102',
    name: '吳採購專員',
    orgUnitCode: 'FIN-AP',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'FINANCE_SPECIALIST',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'li.fpna@example.internal',
    memberId: 'member-103',
    name: '李成本會計',
    orgUnitCode: 'FIN-FPNA',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'SENIOR_SPECIALIST',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'huang.hr@example.internal',
    memberId: 'member-201',
    name: '黃人資主管',
    orgUnitCode: 'HR',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    positionCode: 'DEPARTMENT_HEAD',
    roles: ['APPROVER'],
  }),
  simulationMember({
    email: 'tsai.hr@example.internal',
    memberId: 'member-202',
    name: '蔡人資專員',
    orgUnitCode: 'HR',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'HR_SPECIALIST',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'chang.sales@example.internal',
    memberId: 'member-301',
    name: '張業務經理',
    orgUnitCode: 'SALES',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    positionCode: 'DEPARTMENT_HEAD',
    roles: ['APPROVER'],
  }),
  simulationMember({
    email: 'wang.ae@example.internal',
    memberId: 'member-302',
    name: '王國內業務',
    orgUnitCode: 'SALES',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'ACCOUNT_EXECUTIVE',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'lu.cs@example.internal',
    memberId: 'member-303',
    name: '盧品保工程師',
    orgUnitCode: 'CUSTOMER-SUCCESS',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'SENIOR_SPECIALIST',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'hsu.it@example.internal',
    memberId: 'member-401',
    name: '許資訊主管',
    orgUnitCode: 'IT',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    positionCode: 'DEPARTMENT_HEAD',
    roles: ['APPROVER'],
  }),
  simulationMember({
    email: 'ko.it@example.internal',
    memberId: 'member-402',
    name: '柯系統工程師',
    orgUnitCode: 'IT',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'IT_ENGINEER',
    roles: ['REQUESTER'],
  }),
  simulationMember({
    email: 'sun.product@example.internal',
    memberId: 'member-501',
    name: '孫製造部主管',
    orgUnitCode: 'PRODUCT',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    positionCode: 'DEPARTMENT_HEAD',
    roles: ['APPROVER'],
  }),
  simulationMember({
    email: 'yang.pm@example.internal',
    memberId: 'member-502',
    name: '楊生管專員',
    orgUnitCode: 'PRODUCT',
    permissions: ['instance.create', 'instance.read'],
    positionCode: 'PRODUCT_MANAGER',
    roles: ['REQUESTER'],
  }),
];

export function createApiTestMemberPasswordHash(password: string): string {
  const digest = createHash('sha256').update(password).digest('hex');

  return `sha256$${digest}`;
}

function simulationMember(
  seed: Omit<ApiSimulationMemberSeed, 'customFields' | 'password'>,
): ApiSimulationMemberSeed {
  return {
    ...seed,
    customFields: {
      employeeNo: seed.memberId.replace('member-', 'EMP-'),
      site: '台中總廠',
    },
    password: 'demo',
  };
}
