import {
  ApproverResolver,
  ServiceAction,
  WorkflowNode,
  isNotifyRecipientResolverType,
} from '@rytass/bpm-core-shared/workflow';
import { PositionRecord } from '@rytass/bpm-core-client/organization';
import {
  APPROVER_RESOLVER_MODE_OPTIONS,
  ApproverResolverModeOption,
  buildApproverResolver,
  readApproverResolverEditorState,
  readDefaultApproverResolver,
} from './approver-resolver-model';

/**
 * The 知會對象 sources the designer can edit. The engine accepts more for a
 * notify node (`isNotifyRecipientResolverType`): 發起人主管, 主管鏈 and 運算式
 * stay readable and are kept as saved, but the designer does not edit them.
 *
 * Keyed by the JSON `type`, not by the approver panel's screen option: that
 * option folds FORM_MEMBER_MANAGER into 依表單欄位指定 and
 * FORM_ORG_UNIT_MANAGER into 指定組織主管, neither of which a notify node
 * may use.
 */
export type NotifyRecipientMode = Extract<
  ApproverResolver['type'],
  | 'DIRECT'
  | 'DYNAMIC_FORM'
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
 * The 知會對象來源 select. A stored source the designer does not edit
 * (發起人主管, 主管鏈, 運算式, one a notify node may not use, or one a newer
 * BPMCore saved) is shown as a read-only entry that is the current value:
 * nothing is written unless the author explicitly picks another source.
 */
export function readNotifyRecipientSourceChoice(
  recipients: ApproverResolver,
): NotifyRecipientSourceChoice {
  const editable = NOTIFY_RECIPIENT_MODE_OPTIONS.find(
    (option) => option.id === recipients.type,
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
 * author had filled in.
 */
export function readNotifyRecipientSourcePick(
  recipients: ApproverResolver,
  optionId: string | null,
  positions: readonly PositionRecord[],
): ApproverResolver | null {
  if (optionId === null || !isNotifyRecipientEditableType(optionId)) {
    return null;
  }

  return optionId === recipients.type
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

/** Picks the member field of 依表單欄位指定 (the person in the field only). */
export function withNotifyFormPath(
  recipients: ApproverResolver,
  formPath: string,
): ApproverResolver {
  if (recipients.type !== 'DYNAMIC_FORM') {
    return recipients;
  }

  const state = readApproverResolverEditorState(recipients);

  return state.mode === 'DYNAMIC_FORM'
    ? buildApproverResolver({ ...state, formPath })
    : recipients;
}

/**
 * What the designer alone checks before a notify node can be saved, on top of
 * `readNotifyServiceTaskIssue`: 指定組織主管 with no organization chosen.
 * The shared check and the publish lint do not look at it, and the engine
 * cannot resolve a manager without an organization.
 */
export function readNotifyRecipientsDesignerIssue(
  node: WorkflowNode,
): string | null {
  if (node.type !== 'serviceTask') {
    return null;
  }

  const action = node.data.action;

  if (action.type !== 'NOTIFY') {
    return null;
  }

  const recipients = action.recipients;

  return recipients?.type === 'ORG_UNIT_MANAGER' &&
    !recipients.orgUnitId.trim()
    ? '知會節點需要指定組織。'
    : null;
}
