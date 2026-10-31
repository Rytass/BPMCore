import {
  ApproverResolver,
  ApproverResolverFallback,
} from '@rytass/bpm-core-shared/workflow';
import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import {
  OrgUnitOption,
  PositionOption,
  readOrgUnitOption,
  readPositionOption,
} from '../../../components/admin-picker-options';
import { readDefaultMinPositionLevel } from './position-level-options';
import { readDynamicFormSummary } from './dynamic-form-resolver-options';

export type ApproverResolverMode = Extract<
  ApproverResolver['type'],
  | 'DIRECT'
  | 'DYNAMIC_FORM'
  | 'ORG_MANAGER'
  | 'ORG_MANAGER_CHAIN'
  | 'ORG_UNIT_MANAGER'
  | 'ORG_UNIT_MEMBER'
  | 'ORG_UNIT_POSITION'
  | 'POSITION'
>;

export type ApproverResolverModeOption = Readonly<{
  id: ApproverResolverMode;
  name: string;
}>;

export type ManagerLevelOption = Readonly<{
  id: string;
  name: string;
  value: number;
}>;

export type MemberSelectOption = Readonly<{
  displayName: string;
  email: string;
  id: string;
  memberId: string;
  name: string;
  /**
   * Set on the placeholder written when a member's profile could not be
   * fetched. Marking it explicitly lets {@link mergeMemberOptions} replace the
   * placeholder once the real profile turns up, instead of the "未知會員"
   * sentinel sticking for the rest of the session.
   */
  unresolved?: boolean;
}>;

export const APPROVER_RESOLVER_MODE_OPTIONS: readonly ApproverResolverModeOption[] =
  [
    { id: 'DIRECT', name: '指定會員' },
    { id: 'DYNAMIC_FORM', name: '依表單欄位指定' },
    { id: 'ORG_MANAGER', name: '發起人主管' },
    { id: 'ORG_MANAGER_CHAIN', name: '主管鏈（簽到指定職等）' },
    { id: 'ORG_UNIT_MANAGER', name: '指定組織主管' },
    { id: 'ORG_UNIT_MEMBER', name: '組織任一人' },
    { id: 'ORG_UNIT_POSITION', name: '組織特定職位' },
    { id: 'POSITION', name: '指定職位' },
  ];

export const MANAGER_LEVEL_OPTIONS: readonly ManagerLevelOption[] = [
  { id: '1', name: '直屬主管', value: 1 },
  { id: '2', name: '第二層主管', value: 2 },
  { id: '3', name: '第三層主管', value: 3 },
];

export function readApproverResolverMode(value: string): ApproverResolverMode {
  return value === 'DYNAMIC_FORM' ||
    value === 'ORG_MANAGER' ||
    value === 'ORG_MANAGER_CHAIN' ||
    value === 'ORG_UNIT_MANAGER' ||
    value === 'ORG_UNIT_MEMBER' ||
    value === 'ORG_UNIT_POSITION' ||
    value === 'POSITION'
    ? value
    : 'DIRECT';
}

export function readDefaultApproverResolver(
  value: string | null,
  positions: readonly PositionRecord[],
): ApproverResolver {
  const mode = readApproverResolverMode(value ?? 'DIRECT');

  if (mode === 'DYNAMIC_FORM') {
    return { formPath: '', type: 'DYNAMIC_FORM' };
  }

  if (mode === 'ORG_MANAGER') {
    return { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' };
  }

  if (mode === 'ORG_MANAGER_CHAIN') {
    return {
      minPositionLevel: readDefaultMinPositionLevel(positions),
      type: 'ORG_MANAGER_CHAIN',
    };
  }

  if (mode === 'ORG_UNIT_MANAGER') {
    return { orgUnitId: '', type: 'ORG_UNIT_MANAGER' };
  }

  if (mode === 'ORG_UNIT_MEMBER') {
    return {
      includeDescendants: false,
      orgUnitId: '',
      type: 'ORG_UNIT_MEMBER',
    };
  }

  if (mode === 'ORG_UNIT_POSITION') {
    return {
      includeDescendants: false,
      orgUnitId: '',
      positionId: '',
      type: 'ORG_UNIT_POSITION',
    };
  }

  if (mode === 'POSITION') {
    return { positionId: '', type: 'POSITION' };
  }

  return { memberIds: [], type: 'DIRECT' };
}

export function updateApproverResolverFallback(
  resolver: ApproverResolver,
  fallback: ApproverResolverFallback,
): ApproverResolver {
  if (
    resolver.type === 'ORG_MANAGER' ||
    resolver.type === 'ORG_MANAGER_CHAIN'
  ) {
    return { ...resolver, fallback };
  }

  if (resolver.type === 'ORG_UNIT_MANAGER') {
    return { ...resolver, fallback };
  }

  return resolver;
}

export function readManagerLevelOption(levelsUp: number): ManagerLevelOption {
  return (
    MANAGER_LEVEL_OPTIONS.find((option) => option.value === levelsUp) ??
    MANAGER_LEVEL_OPTIONS[0]
  );
}

export function readManagerLevelOptionById(
  id: string | null,
): ManagerLevelOption {
  return (
    MANAGER_LEVEL_OPTIONS.find((option) => option.id === id) ??
    MANAGER_LEVEL_OPTIONS[0]
  );
}

/**
 * Every member id a resolver names outright, so the designer can pre-fetch
 * their display names on load.
 *
 * The manager resolvers' `DIRECT` fallback ("固定改派") counts: it is a member
 * the author picked and the property form renders it through
 * `readMemberSelectOption`, which falls back to the "未知會員" sentinel for any
 * id it cannot find. Leaving it out meant a saved fallback always rendered as
 * 未知會員 until an unrelated search happened to return that member.
 */
export function readApproverResolverMemberIds(
  resolver: ApproverResolver,
): readonly string[] {
  if (resolver.type === 'DIRECT') {
    return resolver.memberIds;
  }

  if (
    resolver.type === 'ORG_MANAGER' ||
    resolver.type === 'ORG_MANAGER_CHAIN' ||
    resolver.type === 'ORG_UNIT_MANAGER'
  ) {
    return resolver.fallback?.type === 'DIRECT' && resolver.fallback.memberId
      ? [resolver.fallback.memberId]
      : [];
  }

  return [];
}

export function readApproverResolverSummary(
  resolver: ApproverResolver,
  memberOptions: readonly MemberSelectOption[],
  orgUnits: readonly OrgUnitRecord[],
  positions: readonly PositionRecord[],
  formSchema: FormDefinitionSchema | null,
): string {
  if (resolver.type === 'DIRECT') {
    return readMemberEmailSummary(
      resolver.memberIds,
      memberOptions,
      '未指定簽核者',
    );
  }

  if (resolver.type === 'ORG_MANAGER') {
    return readManagerLevelOption(resolver.levelsUp).name;
  }

  if (resolver.type === 'ORG_MANAGER_CHAIN') {
    return `主管鏈：簽到職等 ${resolver.minPositionLevel}`;
  }

  if (resolver.type === 'ORG_UNIT_MANAGER') {
    return `組織主管：${readOrgUnitDisplayName(orgUnits, resolver.orgUnitId)}`;
  }

  if (resolver.type === 'ORG_UNIT_MEMBER') {
    return `組織任一人：${readOrgUnitDisplayName(orgUnits, resolver.orgUnitId)}`;
  }

  if (resolver.type === 'ORG_UNIT_POSITION') {
    return `組織職位：${readOrgUnitDisplayName(
      orgUnits,
      resolver.orgUnitId,
    )} / ${readPositionDisplayName(positions, resolver.positionId)}`;
  }

  if (resolver.type === 'POSITION') {
    return `職位：${readPositionDisplayName(positions, resolver.positionId)}`;
  }

  if (resolver.type === 'DYNAMIC_FORM') {
    return readDynamicFormSummary(formSchema, resolver.formPath);
  }

  return '自訂表達式';
}

export function readMemberEmailSummary(
  memberIds: readonly string[],
  memberOptions: readonly MemberSelectOption[],
  emptyLabel: string,
): string {
  const memberLabels = memberIds.map(
    (memberId) => readMemberSelectOption(memberOptions, memberId).name,
  );

  if (memberLabels.length === 0) {
    return emptyLabel;
  }

  if (memberLabels.length <= 2) {
    return memberLabels.join('、');
  }

  return `${memberLabels.slice(0, 2).join('、')} 等 ${memberLabels.length} 人`;
}

export function readOrgUnitDisplayName(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
): string {
  return readSelectedOrgUnitOption(orgUnits, orgUnitId)?.name ?? '未指定組織';
}

export function readPositionDisplayName(
  positions: readonly PositionRecord[],
  positionId: string,
): string {
  return (
    readSelectedPositionOption(positions, positionId)?.name ?? '未指定職位'
  );
}

export function readSelectedOrgUnitOption(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
): OrgUnitOption | null {
  const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);

  return orgUnit ? readOrgUnitOption(orgUnit) : null;
}

export function readSelectedPositionOption(
  positions: readonly PositionRecord[],
  positionId: string,
): PositionOption | null {
  const position = positions.find((candidate) => candidate.id === positionId);

  return position ? readPositionOption(position) : null;
}

export function readMemberSelectOption(
  options: readonly MemberSelectOption[],
  memberId: string,
): MemberSelectOption {
  return (
    options.find((option) => option.memberId === memberId) ??
    readFallbackMemberSelectOption(memberId)
  );
}

export function readFallbackMemberSelectOption(
  memberId: string,
): MemberSelectOption {
  return {
    displayName: '未知會員',
    email: '',
    id: memberId,
    memberId,
    name: '未知會員',
    unresolved: true,
  };
}

/**
 * The short 簽核方式 label the compose review table shows for a user task.
 */
export function readApproverResolverDetail(resolver: ApproverResolver): string {
  switch (resolver.type) {
    case 'DIRECT':
      return '指定成員';
    case 'POSITION':
      return '指定職位';
    case 'ORG_UNIT_MEMBER':
      return '單位成員';
    case 'ORG_UNIT_POSITION':
      return '單位職位';
    case 'ORG_MANAGER':
      return '主管';
    case 'ORG_MANAGER_CHAIN':
      return '主管鏈';
    case 'ORG_UNIT_MANAGER':
      return '單位主管';
    case 'DYNAMIC_FORM':
      return '依表單欄位指定';
    case 'EXPRESSION':
      return '運算式';
    default:
      return '簽核人';
  }
}
