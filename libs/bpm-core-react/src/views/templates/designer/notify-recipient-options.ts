import {
  ApproverResolver,
  ServiceAction,
  isNotifyRecipientResolverType,
} from '@rytass/bpm-core-shared/workflow';
import { PositionRecord } from '@rytass/bpm-core-client/organization';
import {
  APPROVER_RESOLVER_MODE_OPTIONS,
  ApproverResolverMode,
  ApproverResolverModeOption,
  ApproverSubjectChoice,
  OrgUnitManagerSource,
  buildApproverResolver,
  readApproverResolverEditorState,
  readApproverSubjectChoice,
  readApproverSubjectPick,
  readDefaultApproverResolver,
  withOrgUnitSource,
} from './approver-resolver-model';

/**
 * The 知會對象 sources the designer can edit, keyed by the screen option the
 * 簽核來源 select uses for the same source: 依表單欄位指定 holds the person in
 * the field or their manager (DYNAMIC_FORM / FORM_MEMBER_MANAGER), 指定組織主管
 * a fixed or a form-field organization (ORG_UNIT_MANAGER /
 * FORM_ORG_UNIT_MANAGER), 依前面關卡的簽核者 the earlier signer or their manager
 * (NODE_ACTOR / NODE_ACTOR_MANAGER). The engine accepts more for a notify node
 * (`isNotifyRecipientResolverType`): 發起人主管, 主管鏈 and 運算式 stay readable
 * and are kept as saved, but the designer does not edit them.
 */
export type NotifyRecipientMode = Extract<
  ApproverResolverMode,
  | 'DIRECT'
  | 'DYNAMIC_FORM'
  | 'NODE_ACTOR'
  | 'ORG_UNIT_MANAGER'
  | 'ORG_UNIT_MEMBER'
  | 'ORG_UNIT_POSITION'
  | 'POSITION'
>;

const NOTIFY_RECIPIENT_EDITABLE_TYPES: Readonly<
  Record<NotifyRecipientMode, true>
> = {
  DIRECT: true,
  DYNAMIC_FORM: true,
  NODE_ACTOR: true,
  ORG_UNIT_MANAGER: true,
  ORG_UNIT_MEMBER: true,
  ORG_UNIT_POSITION: true,
  POSITION: true,
};

export function isNotifyRecipientEditableType(
  type: string,
): type is NotifyRecipientMode {
  return Object.prototype.hasOwnProperty.call(
    NOTIFY_RECIPIENT_EDITABLE_TYPES,
    type,
  );
}

/**
 * The editable sources, worded exactly as the 簽核來源 select words them so
 * the two panels never name one source two ways.
 */
export const NOTIFY_RECIPIENT_MODE_OPTIONS: readonly ApproverResolverModeOption[] =
  APPROVER_RESOLVER_MODE_OPTIONS.filter((option) =>
    isNotifyRecipientEditableType(option.id),
  );

/**
 * The 關卡 picker's hint for a notify node's 依前面關卡的簽核者, while the
 * selection has no problem to report: the 簽核來源 hint, worded for 知會對象.
 */
export const NOTIFY_NODE_ACTOR_STAGE_HINT =
  '知會對象取自你選的前面關卡實際簽核的人；可複選，整組要涵蓋每條路徑。複選多個關卡時，取最近實際走到的那一關的簽核人，不是全部關卡的簽核人。';

/** The id of the read-only entry a source the designer does not edit is shown as. */
export const READ_ONLY_NOTIFY_RECIPIENT_OPTION_ID = 'READ_ONLY';

function readReadOnlyNotifyRecipientName(type: string): string {
  switch (type) {
    case 'ORG_MANAGER':
      return '發起人主管';
    case 'ORG_MANAGER_CHAIN':
      return '主管鏈（簽到指定職等）';
    case 'EXPRESSION':
      return '運算式';
    default:
      return type;
  }
}

const READ_ONLY_NOTIFY_RECIPIENT_HINT =
  '這種知會來源只能在範本 JSON 設定；這裡選擇其他來源會覆寫原設定。';
const UNSUPPORTED_NOTIFY_RECIPIENT_HINT =
  '知會節點不支援這種來源，儲存前必須改選其他來源；這裡選擇其他來源會覆寫原設定。';

/** The recipients of a notify action; the empty 指定會員 when it has none. */
export const EMPTY_NOTIFY_RECIPIENTS: ApproverResolver = {
  memberIds: [],
  type: 'DIRECT',
};

/**
 * A notify action's recipients, or the empty 指定會員 for an action that is
 * not a notify yet (the panel is also what turns one into a notify) or that
 * carries no readable recipients (raw JSON that has not been linted).
 */
export function readNotifyRecipients(action: ServiceAction): ApproverResolver {
  return action.type === 'NOTIFY' && action.recipients?.type
    ? action.recipients
    : EMPTY_NOTIFY_RECIPIENTS;
}

export type NotifyRecipientSourceChoice = Readonly<{
  /** Hint under the select, `null` when nothing needs saying. */
  hint: string | null;
  options: readonly Readonly<{ id: string; name: string }>[];
  /** `true` when the stored source is not one the designer edits. */
  readOnly: boolean;
  selected: Readonly<{ id: string; name: string }>;
}>;

/**
 * The screen option a stored source is shown as, or `null` when the designer
 * does not edit it (發起人主管, 主管鏈, 運算式, or a type this build does not
 * know). The edited sources that store two JSON types share one option, the
 * way the 簽核來源 select does it.
 */
function readStoredNotifyMode(
  recipients: ApproverResolver,
): NotifyRecipientMode | null {
  const state = readApproverResolverEditorState(recipients);

  if (state.mode === 'UNSUPPORTED') {
    return null;
  }

  const id = state.mode === 'AS_STORED' ? state.resolver.type : state.mode;

  return isNotifyRecipientEditableType(id) ? id : null;
}

/**
 * The 知會對象來源 select. A stored source the designer does not edit
 * (發起人主管, 主管鏈, 運算式, or one a newer BPMCore saved) is shown as a
 * read-only entry that is the current value: nothing is written unless the
 * author explicitly picks another source.
 */
export function readNotifyRecipientSourceChoice(
  recipients: ApproverResolver,
): NotifyRecipientSourceChoice {
  const storedMode = readStoredNotifyMode(recipients);
  const editable = NOTIFY_RECIPIENT_MODE_OPTIONS.find(
    (option) => option.id === storedMode,
  );

  if (editable) {
    return {
      hint: null,
      options: NOTIFY_RECIPIENT_MODE_OPTIONS,
      readOnly: false,
      selected: editable,
    };
  }

  const known = isNotifyRecipientResolverType(recipients.type);
  const selected = {
    id: READ_ONLY_NOTIFY_RECIPIENT_OPTION_ID,
    name: known
      ? readReadOnlyNotifyRecipientName(recipients.type)
      : `不支援的知會來源（${recipients.type}）`,
  };

  return {
    hint: known
      ? READ_ONLY_NOTIFY_RECIPIENT_HINT
      : UNSUPPORTED_NOTIFY_RECIPIENT_HINT,
    options: [...NOTIFY_RECIPIENT_MODE_OPTIONS, selected],
    readOnly: true,
    selected,
  };
}

/**
 * The recipients a 知會對象來源 pick produces, or `null` when the pick must
 * change nothing: no option, an id that is not an editable source (the
 * read-only entry included), or the source already stored. Re-picking the
 * shown source would otherwise rebuild a clean default and wipe what the
 * author had filled in. "Already stored" is the screen option, so a
 * FORM_MEMBER_MANAGER under 依表單欄位指定 is not rebuilt either.
 */
export function readNotifyRecipientSourcePick(
  recipients: ApproverResolver,
  optionId: string | null,
  positions: readonly PositionRecord[],
): ApproverResolver | null {
  if (optionId === null || !isNotifyRecipientEditableType(optionId)) {
    return null;
  }

  return optionId === readStoredNotifyMode(recipients)
    ? null
    : readDefaultApproverResolver(optionId, positions);
}

/**
 * The action with new recipients. Only the recipients change: channels,
 * template and webhooks belong to the same action and survive. An action that
 * is not a notify yet becomes one with the default channel.
 */
export function withNotifyRecipients(
  action: ServiceAction,
  recipients: ApproverResolver,
): ServiceAction {
  return action.type === 'NOTIFY'
    ? { ...action, recipients }
    : { channels: ['IN_APP'], recipients, type: 'NOTIFY' };
}

type OrgScopedRecipients = Extract<
  ApproverResolver,
  { readonly type: 'ORG_UNIT_MEMBER' | 'ORG_UNIT_POSITION' }
>;

function readIncludeDescendantsKey(
  recipients: OrgScopedRecipients,
): Readonly<{ includeDescendants?: boolean }> {
  return recipients.includeDescendants === undefined
    ? {}
    : { includeDescendants: recipients.includeDescendants };
}

/**
 * Picks the organization. 組織特定職位 clears its position (it may not belong
 * to the new organization); 指定組織主管 goes through the approver editor
 * state so its 無主管時 and 只取最近一層主管 settings survive.
 */
export function withNotifyOrgUnit(
  recipients: ApproverResolver,
  orgUnitId: string,
): ApproverResolver {
  if (recipients.type === 'ORG_UNIT_MEMBER') {
    return {
      ...readIncludeDescendantsKey(recipients),
      orgUnitId,
      type: 'ORG_UNIT_MEMBER',
    };
  }

  if (recipients.type === 'ORG_UNIT_POSITION') {
    return {
      ...readIncludeDescendantsKey(recipients),
      orgUnitId,
      positionId: '',
      type: 'ORG_UNIT_POSITION',
    };
  }

  if (recipients.type === 'ORG_UNIT_MANAGER') {
    const state = readApproverResolverEditorState(recipients);

    return state.mode === 'ORG_UNIT_MANAGER'
      ? buildApproverResolver({ ...state, orgUnitId })
      : recipients;
  }

  return recipients;
}

/**
 * Switches 包含下層 of 組織任一人 or 組織特定職位; the latter clears its
 * position, the way the 簽核來源 panel does, because the positions on offer
 * change with the scope.
 */
export function withNotifyIncludeDescendants(
  recipients: ApproverResolver,
  includeDescendants: boolean,
): ApproverResolver {
  if (recipients.type === 'ORG_UNIT_MEMBER') {
    return { ...recipients, includeDescendants };
  }

  if (recipients.type === 'ORG_UNIT_POSITION') {
    return { ...recipients, includeDescendants, positionId: '' };
  }

  return recipients;
}

/** Picks the position of 指定職位 or 組織特定職位. */
export function withNotifyPosition(
  recipients: ApproverResolver,
  positionId: string,
): ApproverResolver {
  if (recipients.type === 'POSITION') {
    return { positionId, type: 'POSITION' };
  }

  if (recipients.type === 'ORG_UNIT_POSITION') {
    return { ...recipients, positionId };
  }

  return recipients;
}

/**
 * Picks the form field of 依表單欄位指定 (the person in it, or their manager)
 * or of 指定組織主管 with the 表單欄位 organization. A source with no form field
 * is returned as it is.
 */
export function withNotifyFormPath(
  recipients: ApproverResolver,
  formPath: string,
): ApproverResolver {
  const state = readApproverResolverEditorState(recipients);

  if (state.mode === 'DYNAMIC_FORM') {
    return buildApproverResolver({ ...state, formPath });
  }

  return state.mode === 'ORG_UNIT_MANAGER' && state.orgSource === 'FORM_FIELD'
    ? buildApproverResolver({ ...state, formPath })
    : recipients;
}

/**
 * Switches the 組織 of 指定組織主管 between 固定組織 and 表單欄位, the way the
 * 簽核來源 panel does (a form-field organization starts with 只取最近一層主管
 * on). Any other source is returned as it is.
 */
export function withNotifyOrgSource(
  recipients: ApproverResolver,
  source: OrgUnitManagerSource,
): ApproverResolver {
  const state = readApproverResolverEditorState(recipients);

  return state.mode === 'ORG_UNIT_MANAGER' && state.orgSource !== source
    ? buildApproverResolver(withOrgUnitSource(state, source))
    : recipients;
}

/** Picks the earlier stages of 依前面關卡的簽核者. */
export function withNotifyNodeIds(
  recipients: ApproverResolver,
  nodeIds: readonly string[],
): ApproverResolver {
  const state = readApproverResolverEditorState(recipients);

  return state.mode === 'NODE_ACTOR'
    ? buildApproverResolver({ ...state, nodeIds })
    : recipients;
}

/**
 * The 知會對象 select of 依表單欄位指定 and 依前面關卡的簽核者: the person
 * themselves or their manager one to three levels up. `null` for a source
 * with no such choice.
 */
export function readNotifySubjectChoice(
  recipients: ApproverResolver,
): ApproverSubjectChoice | null {
  return readApproverSubjectChoice(readApproverResolverEditorState(recipients));
}

/**
 * The recipients a 知會對象 pick produces, or `null` for a no-op (the shown
 * choice picked again, the invalid-level entry, an id that is not an option).
 */
export function readNotifySubjectPick(
  recipients: ApproverResolver,
  optionId: string | null,
): ApproverResolver | null {
  const next = readApproverSubjectPick(
    readApproverResolverEditorState(recipients),
    optionId,
  );

  return next ? buildApproverResolver(next) : null;
}
