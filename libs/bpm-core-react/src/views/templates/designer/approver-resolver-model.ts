import {
  ApproverResolver,
  ApproverResolverFallback,
  isFallbackCapableApproverResolverType,
  readUnsupportedApproverResolverType,
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
import {
  readDynamicFormSummary,
  readFormMemberManagerSummary,
  readFormOrgUnitManagerSummary,
} from './dynamic-form-resolver-options';

export type ApproverResolverMode = Extract<
  ApproverResolver['type'],
  | 'DIRECT'
  | 'DYNAMIC_FORM'
  | 'NODE_ACTOR'
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
    { id: 'NODE_ACTOR', name: '依前面關卡的簽核者' },
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

export type NodeNameRecord = Readonly<{ id: string; name: string }>;

/**
 * The 簽核人 choices of the two sources that start from "someone": the person
 * the source names, or their manager one to three levels up. `value` 0 is the
 * person themselves; it is what the select stores for a source with no
 * manager level.
 */
export const FORM_MEMBER_SUBJECT_OPTIONS: readonly ManagerLevelOption[] = [
  { id: '0', name: '欄位裡的人', value: 0 },
  ...MANAGER_LEVEL_OPTIONS,
];
export const NODE_ACTOR_SUBJECT_OPTIONS: readonly ManagerLevelOption[] = [
  { id: '0', name: '關卡的簽核者', value: 0 },
  ...MANAGER_LEVEL_OPTIONS,
];

export type OrgUnitManagerSource = 'FIXED' | 'FORM_FIELD';

export const ORG_UNIT_SOURCE_OPTIONS: readonly Readonly<{
  id: OrgUnitManagerSource;
  name: string;
}>[] = [
  { id: 'FIXED', name: '固定組織' },
  { id: 'FORM_FIELD', name: '表單欄位' },
];

/**
 * The option for a stored level. A level this screen has no option for (a
 * hand-written or AI-written definition) is shown as itself rather than
 * mistaken for another one.
 */
export function readApproverSubjectOption(
  options: readonly ManagerLevelOption[],
  levelsUp: number,
): ManagerLevelOption {
  return (
    options.find((option) => option.value === levelsUp) ?? {
      id: String(levelsUp),
      name: `第 ${levelsUp} 層主管`,
      value: levelsUp,
    }
  );
}

/**
 * The option for the manager level a FORM_MEMBER_MANAGER / NODE_ACTOR_MANAGER
 * definition stores. Those types always name a manager, so a level below 1 (or
 * not a whole number) is a broken definition: it is shown as an invalid level
 * rather than as the option whose `value` happens to be 0 (本人). The stored
 * JSON is never touched by this read; the publish lint is what blocks it.
 */
export function readStoredManagerLevelOption(
  options: readonly ManagerLevelOption[],
  levelsUp: number,
): ManagerLevelOption {
  if (!Number.isInteger(levelsUp) || levelsUp < 1) {
    return {
      id: `invalid:${levelsUp}`,
      name: `第 ${levelsUp} 層主管（無效）`,
      value: levelsUp,
    };
  }

  return readApproverSubjectOption(options, levelsUp);
}

export function readApproverResolverMode(value: string): ApproverResolverMode {
  // The new sources share a screen option with the source they extend: 依表單
  // 欄位指定 holds the person's manager, 指定組織主管 the form-field org, and
  // 依前面關卡的簽核者 holds both of its 簽核人 choices.
  if (value === 'FORM_MEMBER_MANAGER') {
    return 'DYNAMIC_FORM';
  }

  if (value === 'FORM_ORG_UNIT_MANAGER') {
    return 'ORG_UNIT_MANAGER';
  }

  if (value === 'NODE_ACTOR_MANAGER') {
    return 'NODE_ACTOR';
  }

  return value === 'DYNAMIC_FORM' ||
    value === 'NODE_ACTOR' ||
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

  if (mode === 'NODE_ACTOR') {
    return { nodeIds: [], type: 'NODE_ACTOR' };
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

type FallbackCapableApproverResolver = Extract<
  ApproverResolver,
  { readonly fallback?: ApproverResolverFallback }
>;

// The shared table decides which types look a manager up; a type this build
// does not know is never one of them, so it passes through untouched.
function isFallbackCapableResolver(
  resolver: ApproverResolver,
): resolver is FallbackCapableApproverResolver {
  return isFallbackCapableApproverResolverType(resolver.type);
}

export function updateApproverResolverFallback(
  resolver: ApproverResolver,
  fallback: ApproverResolverFallback,
): ApproverResolver {
  if (isFallbackCapableResolver(resolver)) {
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

  if (isFallbackCapableResolver(resolver)) {
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
  nodes?: readonly NodeNameRecord[],
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

  if (resolver.type === 'FORM_MEMBER_MANAGER') {
    return readFormMemberManagerSummary(
      formSchema,
      resolver.formPath,
      readStoredManagerLevelOption(
        FORM_MEMBER_SUBJECT_OPTIONS,
        resolver.levelsUp,
      ).name,
    );
  }

  if (resolver.type === 'FORM_ORG_UNIT_MANAGER') {
    return readFormOrgUnitManagerSummary(formSchema, resolver.formPath);
  }

  if (resolver.type === 'NODE_ACTOR') {
    return `前面關卡的簽核者：${readStageSummary(resolver.nodeIds, nodes)}`;
  }

  if (resolver.type === 'NODE_ACTOR_MANAGER') {
    return `前面關卡簽核者的${
      readStoredManagerLevelOption(
        NODE_ACTOR_SUBJECT_OPTIONS,
        resolver.levelsUp,
      ).name
    }：${readStageSummary(resolver.nodeIds, nodes)}`;
  }

  if (resolver.type === 'EXPRESSION') {
    return '自訂表達式';
  }

  // A type saved by a newer BPMCore: say so rather than call it an expression.
  return readUnsupportedApproverSourceLabel(
    readUnsupportedApproverResolverType(resolver) ?? '',
  );
}

function readStageSummary(
  nodeIds: readonly string[],
  nodes: readonly NodeNameRecord[] | undefined,
): string {
  if (nodeIds.length === 0) {
    return '未指定關卡';
  }

  if (!nodes) {
    return `${nodeIds.length} 個關卡`;
  }

  const names = nodeIds.map(
    (nodeId) =>
      nodes.find((node) => node.id === nodeId)?.name ?? `${nodeId}（已不存在）`,
  );

  return names.length <= 2
    ? names.join('、')
    : `${names.slice(0, 2).join('、')} 等 ${names.length} 關`;
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
 * The one label for a resolver `type` this build does not know (a definition
 * saved by a newer BPMCore): the designer's read-only 簽核來源 entry, the node
 * summary and the compose review table all say it with this.
 */
export function readUnsupportedApproverSourceLabel(type: string): string {
  return `不支援的簽核來源（${type}）`;
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
    case 'FORM_MEMBER_MANAGER':
      return '表單欄位人員的主管';
    case 'FORM_ORG_UNIT_MANAGER':
      return '表單欄位組織的主管';
    case 'NODE_ACTOR':
      return '前面關卡的簽核者';
    case 'NODE_ACTOR_MANAGER':
      return '前面關卡簽核者的主管';
    default:
      return readUnsupportedApproverSourceLabel(
        readUnsupportedApproverResolverType(resolver) ?? '',
      );
  }
}

// ---------------------------------------------------------------------------
// Screen state <-> JSON for the sources that share a screen option.
// ---------------------------------------------------------------------------

type ManagerRule = Readonly<{
  fallback?: ApproverResolverFallback;
  preferClosestOrgUnit?: boolean;
}>;

/**
 * What the 簽核來源 panel edits. The three sources with two stored types each
 * (本人／主管, 固定組織／表單欄位) carry the screen's own choice instead of the
 * JSON type; every other known type is held as saved and edited field by
 * field, and a type this build does not know is held as saved, read-only.
 *
 * `levelsUp` is `null` for the 本人 choice (no manager level), otherwise the
 * stored level.
 */
export type ApproverResolverEditorState =
  | (Readonly<{
      formPath: string;
      levelsUp: number | null;
      mode: 'DYNAMIC_FORM';
    }> &
      ManagerRule)
  | (Readonly<{
      formPath: string;
      mode: 'ORG_UNIT_MANAGER';
      orgSource: OrgUnitManagerSource;
      orgUnitId: string;
      /**
       * Set by 固定組織 -> 表單欄位 when it turned 只取最近一層主管 on because the
       * stored resolver had no such key; going back to 固定組織 then removes the
       * key again instead of leaving a routing change on the node. Only the
       * switch itself sets it, so it is never read from a saved resolver.
       */
      preferClosestOrgUnitDefaulted?: true;
    }> &
      ManagerRule)
  | (Readonly<{
      levelsUp: number | null;
      mode: 'NODE_ACTOR';
      nodeIds: readonly string[];
    }> &
      ManagerRule)
  | Readonly<{ mode: 'AS_STORED'; resolver: ApproverResolver }>
  | Readonly<{
      mode: 'UNSUPPORTED';
      resolver: ApproverResolver;
      type: string;
    }>;

// Only the keys the definition actually has, so reading then building a saved
// resolver reproduces it exactly (no `undefined` keys, no invented defaults).
function readManagerRule(resolver: ManagerRule): ManagerRule {
  return {
    ...(resolver.fallback !== undefined ? { fallback: resolver.fallback } : {}),
    ...(resolver.preferClosestOrgUnit !== undefined
      ? { preferClosestOrgUnit: resolver.preferClosestOrgUnit }
      : {}),
  };
}

export function readApproverResolverEditorState(
  resolver: ApproverResolver,
): ApproverResolverEditorState {
  if (readUnsupportedApproverResolverType(resolver) !== null) {
    return { mode: 'UNSUPPORTED', resolver, type: resolver.type };
  }

  switch (resolver.type) {
    case 'DYNAMIC_FORM':
      return {
        formPath: resolver.formPath,
        levelsUp: null,
        mode: resolver.type,
      };
    case 'FORM_MEMBER_MANAGER':
      return {
        ...readManagerRule(resolver),
        formPath: resolver.formPath,
        levelsUp: resolver.levelsUp,
        mode: 'DYNAMIC_FORM',
      };
    case 'ORG_UNIT_MANAGER':
      return {
        ...readManagerRule(resolver),
        formPath: '',
        mode: resolver.type,
        orgSource: 'FIXED',
        orgUnitId: resolver.orgUnitId,
      };
    case 'FORM_ORG_UNIT_MANAGER':
      return {
        ...readManagerRule(resolver),
        formPath: resolver.formPath,
        mode: 'ORG_UNIT_MANAGER',
        orgSource: 'FORM_FIELD',
        orgUnitId: '',
      };
    case 'NODE_ACTOR':
      return { levelsUp: null, mode: resolver.type, nodeIds: resolver.nodeIds };
    case 'NODE_ACTOR_MANAGER':
      return {
        ...readManagerRule(resolver),
        levelsUp: resolver.levelsUp,
        mode: 'NODE_ACTOR',
        nodeIds: resolver.nodeIds,
      };
    default:
      return { mode: 'AS_STORED', resolver };
  }
}

/**
 * The JSON for a screen state. Only the fields that belong to the chosen type
 * are written, so a field left over from the choice the author switched away
 * from (the manager level after 回到欄位裡的人, the formPath after 改選固定組織)
 * never reaches the saved definition.
 */
export function buildApproverResolver(
  state: ApproverResolverEditorState,
): ApproverResolver {
  if (state.mode === 'AS_STORED' || state.mode === 'UNSUPPORTED') {
    return state.resolver;
  }

  if (state.mode === 'DYNAMIC_FORM') {
    return state.levelsUp === null
      ? { formPath: state.formPath, type: 'DYNAMIC_FORM' }
      : {
          ...readManagerRule(state),
          formPath: state.formPath,
          levelsUp: state.levelsUp,
          type: 'FORM_MEMBER_MANAGER',
        };
  }

  if (state.mode === 'ORG_UNIT_MANAGER') {
    return state.orgSource === 'FIXED'
      ? {
          ...readManagerRule(state),
          orgUnitId: state.orgUnitId,
          type: 'ORG_UNIT_MANAGER',
        }
      : {
          ...readManagerRule(state),
          formPath: state.formPath,
          type: 'FORM_ORG_UNIT_MANAGER',
        };
  }

  return state.levelsUp === null
    ? { nodeIds: state.nodeIds, type: 'NODE_ACTOR' }
    : {
        ...readManagerRule(state),
        levelsUp: state.levelsUp,
        nodeIds: state.nodeIds,
        type: 'NODE_ACTOR_MANAGER',
      };
}

/**
 * Applies the 簽核人 select: 0 is the person themselves, 1-3 their manager.
 * Sources with no such choice come back as the same state.
 */
export function withApproverSubject(
  state: ApproverResolverEditorState,
  value: number,
): ApproverResolverEditorState {
  if (state.mode === 'DYNAMIC_FORM' || state.mode === 'NODE_ACTOR') {
    return { ...state, levelsUp: value > 0 ? value : null };
  }

  return state;
}

/**
 * Applies the 組織 choice of 指定組織主管. A form-field org starts with 只取最近
 * 一層主管 on (SPEC 3.3) unless the author already chose; going back to a fixed
 * org removes that default again when the switch itself put it there, so the
 * round trip hands back the original resolver. Otherwise a fixed org keeps the
 * stored choice as it is.
 */
export function withOrgUnitSource(
  state: ApproverResolverEditorState,
  source: OrgUnitManagerSource,
): ApproverResolverEditorState {
  if (state.mode !== 'ORG_UNIT_MANAGER') {
    return state;
  }

  const { preferClosestOrgUnitDefaulted, ...rest } = state;

  if (source === 'FORM_FIELD') {
    return rest.preferClosestOrgUnit === undefined
      ? {
          ...rest,
          orgSource: source,
          preferClosestOrgUnit: true,
          preferClosestOrgUnitDefaulted: true,
        }
      : { ...rest, orgSource: source };
  }

  if (preferClosestOrgUnitDefaulted) {
    return {
      ...(rest.fallback !== undefined ? { fallback: rest.fallback } : {}),
      formPath: rest.formPath,
      mode: rest.mode,
      orgSource: source,
      orgUnitId: rest.orgUnitId,
    };
  }

  return { ...rest, orgSource: source };
}

/**
 * Whether `current` is still exactly what a 固定組織 -> 表單欄位 switch wrote
 * (`produced`), apart from the form field the author may have picked since. The
 * designer keeps the state's memory of the defaulted 只取最近一層主管 only while
 * this holds: an edit to anything else makes the stored value the author's.
 */
export function isDefaultedOrgUnitSwitch(
  current: ApproverResolver,
  produced: ApproverResolver,
): boolean {
  return (
    current.type === 'FORM_ORG_UNIT_MANAGER' &&
    produced.type === 'FORM_ORG_UNIT_MANAGER' &&
    JSON.stringify({ ...current, formPath: '' }) ===
      JSON.stringify({ ...produced, formPath: '' })
  );
}

// ---------------------------------------------------------------------------
// Screen gating: what the 簽核來源 panel may show and write.
// ---------------------------------------------------------------------------

/** The id of the read-only entry an unknown resolver type is shown as. */
export const UNSUPPORTED_APPROVER_SOURCE_OPTION_ID = 'UNSUPPORTED';

const UNSUPPORTED_APPROVER_SOURCE_HINT =
  '此引擎版本不支援這種簽核來源；這裡選擇其他簽核來源會覆寫原設定';

export type ApproverSourceChoice = Readonly<{
  /** Hint under the select, `null` when nothing needs saying. */
  hint: string | null;
  options: readonly Readonly<{ id: string; name: string }>[];
  selected: Readonly<{ id: string; name: string }>;
}>;

/**
 * The 簽核來源 select: the source options, plus, for a type this build does
 * not know, a read-only entry carrying its name that is the current value: it
 * is shown, never edited, and nothing is written unless the author explicitly
 * picks a different source (which replaces the stored one).
 * `readApproverResolverMode` would call such a type 指定會員.
 */
export function readApproverSourceChoice(
  state: ApproverResolverEditorState,
): ApproverSourceChoice {
  if (state.mode === 'UNSUPPORTED') {
    const selected = {
      id: UNSUPPORTED_APPROVER_SOURCE_OPTION_ID,
      name: readUnsupportedApproverSourceLabel(state.type),
    };

    return {
      hint: UNSUPPORTED_APPROVER_SOURCE_HINT,
      options: [...APPROVER_RESOLVER_MODE_OPTIONS, selected],
      selected,
    };
  }

  const modeId =
    state.mode === 'AS_STORED'
      ? readApproverResolverMode(state.resolver.type)
      : state.mode;

  return {
    hint: null,
    options: APPROVER_RESOLVER_MODE_OPTIONS,
    selected:
      APPROVER_RESOLVER_MODE_OPTIONS.find((option) => option.id === modeId) ??
      APPROVER_RESOLVER_MODE_OPTIONS[0],
  };
}

/**
 * The resolver a 簽核來源 pick produces, or `null` when the pick must change
 * nothing: no option, an id that is not an option (the read-only unsupported
 * entry included), or the source already stored. Re-picking the shown source
 * used to rebuild a clean default and wipe what the author had filled in.
 *
 * "Already stored" is the state's own mode, not the displayed option: an
 * EXPRESSION resolver is displayed as 指定會員 but is not one, so picking 指定會員
 * still switches it.
 */
export function readApproverSourcePick(
  resolver: ApproverResolver,
  optionId: string | null,
  positions: readonly PositionRecord[],
): ApproverResolver | null {
  if (
    optionId === null ||
    !APPROVER_RESOLVER_MODE_OPTIONS.some((option) => option.id === optionId)
  ) {
    return null;
  }

  const state = readApproverResolverEditorState(resolver);
  const storedId =
    state.mode === 'AS_STORED'
      ? state.resolver.type
      : state.mode === 'UNSUPPORTED'
        ? null
        : state.mode;

  return optionId === storedId
    ? null
    : readDefaultApproverResolver(optionId, positions);
}

export type ApproverSubjectChoice = Readonly<{
  /** The stored level is below 1 (or fractional): shown, not offered again. */
  invalid: boolean;
  options: readonly ManagerLevelOption[];
  selected: ManagerLevelOption;
}>;

/**
 * The 簽核人 select of ② and ③. A stored manager level the list has no option
 * for (invalid, or a level above 3) is appended so the select can show it.
 */
export function readApproverSubjectChoice(
  state: ApproverResolverEditorState,
): ApproverSubjectChoice | null {
  if (state.mode !== 'DYNAMIC_FORM' && state.mode !== 'NODE_ACTOR') {
    return null;
  }

  const options =
    state.mode === 'DYNAMIC_FORM'
      ? FORM_MEMBER_SUBJECT_OPTIONS
      : NODE_ACTOR_SUBJECT_OPTIONS;

  if (state.levelsUp === null) {
    return { invalid: false, options, selected: options[0] };
  }

  const selected = readStoredManagerLevelOption(options, state.levelsUp);

  return {
    invalid: selected.id.startsWith('invalid:'),
    options: options.some((option) => option.id === selected.id)
      ? options
      : [...options, selected],
    selected,
  };
}

/**
 * The state a 簽核人 pick produces, or `null` for a no-op (the shown choice
 * picked again, the invalid-level entry, an id that is not an option).
 */
export function readApproverSubjectPick(
  state: ApproverResolverEditorState,
  optionId: string | null,
): ApproverResolverEditorState | null {
  const choice = readApproverSubjectChoice(state);
  const picked = choice?.options.find((option) => option.id === optionId);

  if (
    !choice ||
    !picked ||
    picked.id.startsWith('invalid:') ||
    picked.id === choice.selected.id
  ) {
    return null;
  }

  return withApproverSubject(state, picked.value);
}

export type ApproverManagerRuleView = Readonly<{
  fallback: ApproverResolverFallback;
  preferClosestOrgUnit: boolean;
  /** 主管鏈 has no 只取最近一層主管. */
  showPreferClosestOrgUnit: boolean;
}>;

/**
 * The 只取最近一層主管 / 無主管時 pair of a resolver that looks a manager up,
 * `null` for one that does not (so 本人 shows neither).
 */
export function readApproverManagerRule(
  resolver: ApproverResolver,
): ApproverManagerRuleView | null {
  if (!isFallbackCapableResolver(resolver)) {
    return null;
  }

  return {
    fallback: resolver.fallback ?? { type: 'NONE' },
    preferClosestOrgUnit:
      'preferClosestOrgUnit' in resolver
        ? Boolean(resolver.preferClosestOrgUnit)
        : false,
    showPreferClosestOrgUnit: resolver.type !== 'ORG_MANAGER_CHAIN',
  };
}

export function withPreferClosestOrgUnit(
  resolver: ApproverResolver,
  preferClosestOrgUnit: boolean,
): ApproverResolver {
  if (
    !isFallbackCapableResolver(resolver) ||
    resolver.type === 'ORG_MANAGER_CHAIN'
  ) {
    return resolver;
  }

  return { ...resolver, preferClosestOrgUnit };
}
