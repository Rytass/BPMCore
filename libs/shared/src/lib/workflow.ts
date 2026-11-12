export interface WorkflowDefinition {
  readonly edges: readonly WorkflowEdge[];
  /**
   * The expression language every expression in this definition is written
   * in (ADR 22 §3.3). Absent means `cel-legacy`, so definitions and case
   * snapshots saved before the field existed keep their behaviour.
   */
  readonly expressionDialect?: WorkflowExpressionDialect;
  readonly meta: WorkflowDefinitionMeta;
  readonly nodes: readonly WorkflowNode[];
}

/**
 * `cel-legacy` is `cel-js` 0.8.2; `cel-v2` is `@marcbachmann/cel-js` 8. Only
 * the name lives here: this package never loads an engine (docs/24 §2.5).
 */
export type WorkflowExpressionDialect = 'cel-legacy' | 'cel-v2';

export interface WorkflowDefinitionMeta {
  readonly diagramVersion?: string;
  readonly schemaVersion: 1;
}

export type WorkflowNode =
  | StartEventNode
  | EndEventNode
  | UserTaskNode
  | ServiceTaskNode
  | ExclusiveGatewayNode
  | ParallelGatewayNode;

export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export interface BaseNodeData {
  readonly label: string;
  readonly triggerMode?: WorkflowNodeTriggerMode;
}

export type WorkflowNodeTriggerMode = 'AND' | 'OR';

export interface BaseWorkflowNode<
  TType extends string,
  TData extends BaseNodeData,
> {
  readonly data: TData;
  readonly id: string;
  readonly position: NodePosition;
  readonly type: TType;
}

export type StartEventNode = BaseWorkflowNode<'startEvent', BaseNodeData>;

export type EndEventNode = BaseWorkflowNode<
  'endEvent',
  BaseNodeData & {
    readonly endState?: 'APPROVED' | 'REJECTED';
  }
>;

export type UserTaskNode = BaseWorkflowNode<'userTask', UserTaskNodeData>;

export interface UserTaskNodeData extends BaseNodeData {
  readonly allowAddSigner: boolean;
  readonly allowReject: boolean;
  readonly allowTransfer: boolean;
  readonly approverResolver: ApproverResolver;
  readonly decisionPolicy: DecisionPolicy;
  readonly description?: string;
  readonly entryCondition?: string;
  readonly excludeInitiator?: ExcludeInitiatorConfig;
  readonly excludeNodeActors?: ExcludeNodeActorsConfig;
  readonly fieldAccess?: readonly FieldAccessEntry[];
  /**
   * @deprecated Never enforced and never read: use `fieldAccess`. A draft that
   * still carries this key cannot be published (`legacyFieldPermissions`).
   */
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
  /**
   * Requires a non-empty comment whenever a person approves at this node.
   *
   * Omitted or `false` keeps today's behaviour where approving without a
   * comment is accepted. The engine validates this against the workflow
   * snapshot stored on the instance, so in-flight instances started before the
   * template opted in keep their original behaviour. Only a person's approval
   * is held to it: the SLA `AUTO_APPROVE` timeout never waits for a comment.
   */
  readonly requireApprovalComment?: boolean;
  readonly returnBehavior: ReturnBehavior;
  readonly sla?: SlaConfig;
}

/**
 * Separation of duties: when present, the member who submitted the instance
 * is never one of this node's approvers (a delegate acting for them counts
 * as them). Absent keeps today's behaviour.
 */
export interface ExcludeInitiatorConfig {
  /** What happens when no approver is left after the initiator is removed. */
  readonly whenEmpty: ExcludeInitiatorWhenEmpty;
}

export type ExcludeInitiatorWhenEmpty =
  | 'FAIL'
  | 'INITIATOR_MANAGER'
  | 'SKIP_NODE';

/**
 * Separation of duties between stages: when present, nobody who actually
 * approved one of `nodeIds` earlier in this instance may be one of this
 * node's approvers (a delegate acting for them counts as them, in either
 * direction). Absent keeps today's behaviour.
 *
 * "Who approved" is read the way `NODE_ACTOR` reads it: the most recent round
 * of each listed node, only real approvals (not an ad-hoc countersign and not
 * an SLA auto-approval), the delegate who actually approved rather than the
 * person the task was meant for, and the receiver of a transfer. Each listed
 * node is read on its own and the results are combined.
 *
 * Every listed node has to be a stage that always runs and always has a
 * person sign: the publish lint refuses a listed node with an entry condition,
 * a `SKIP_NODE` fallback or an SLA auto-approval, and one that some path to
 * this node does not pass (check each listed node on its own, not the list as
 * a whole). Without that, a return that restarts the instance could leave a
 * previous round's approver in the exclusion list. To exclude the approver of
 * a stage that only some cases run, put both stages on the same route with an
 * exclusive gateway.
 */
export interface ExcludeNodeActorsConfig {
  /** The earlier user task nodes whose approvers are kept out of this node. */
  readonly nodeIds: readonly string[];
  /** What happens when no approver is left after the exclusion. */
  readonly whenEmpty: ExcludeInitiatorWhenEmpty;
}

export type ApproverResolver =
  | { readonly memberIds: readonly string[]; readonly type: 'DIRECT' }
  | { readonly positionId: string; readonly type: 'POSITION' }
  | {
      readonly includeDescendants?: boolean;
      readonly orgUnitId: string;
      readonly type: 'ORG_UNIT_MEMBER';
    }
  | {
      readonly includeDescendants?: boolean;
      readonly orgUnitId: string;
      readonly positionId: string;
      readonly type: 'ORG_UNIT_POSITION';
    }
  | {
      readonly baseFromInitiator: boolean;
      readonly fallback?: ApproverResolverFallback;
      readonly levelsUp: number;
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'ORG_MANAGER';
    }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly orgUnitId: string;
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'ORG_UNIT_MANAGER';
    }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly minPositionLevel: number;
      /**
       * `true` skips the whole stage when the start person's own highest
       * position level (over every active membership) already reaches
       * `minPositionLevel`: nobody above them needs to sign. A start with no
       * position level, or no start at all, does not skip. Omitted, `false`
       * or `null` keeps today's behaviour. Cannot be combined with a
       * `CHAIN_CONTINUATION` start, and a notify node cannot use it. Older
       * engines ignore this key and run the stage as before.
       */
      readonly skipWhenStartReached?: boolean | null;
      /**
       * Whose manager the chain starts climbing from. Omitted (or
       * `INITIATOR`) keeps today's behaviour: the chain starts at the
       * initiator. Older engines ignore this key and start at the initiator.
       */
      readonly startFrom?: OrgManagerChainStart;
      /**
       * Managers below this position level are walked past without joining the
       * chain; the first manager at or above it starts the chain. Omitted
       * keeps today's behaviour: the first manager who has a position level
       * starts the chain. Must not exceed `minPositionLevel`. Older engines
       * ignore this key.
       */
      readonly startPositionLevel?: number;
      readonly type: 'ORG_MANAGER_CHAIN';
    }
  | { readonly formPath: string; readonly type: 'DYNAMIC_FORM' }
  | { readonly expression: string; readonly type: 'EXPRESSION' }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly formPath: string;
      readonly levelsUp: number;
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'FORM_MEMBER_MANAGER';
    }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly formPath: string;
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'FORM_ORG_UNIT_MANAGER';
    }
  | { readonly nodeIds: readonly string[]; readonly type: 'NODE_ACTOR' }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly levelsUp: number;
      readonly nodeIds: readonly string[];
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'NODE_ACTOR_MANAGER';
    };

export type ApproverResolverFallback =
  | { readonly type: 'NONE' }
  | {
      readonly allowInitiatorSelfApproval?: boolean;
      readonly memberId: string;
      readonly type: 'DIRECT';
    }
  | {
      /**
       * Members of this position, resolved the way a POSITION node resolves
       * them at the moment the node starts. Only the manager resolvers take
       * it: ORG_MANAGER, ORG_UNIT_MANAGER, ORG_MANAGER_CHAIN,
       * FORM_MEMBER_MANAGER, FORM_ORG_UNIT_MANAGER and NODE_ACTOR_MANAGER.
       * Older engines reject it at run time.
       */
      readonly allowInitiatorSelfApproval?: boolean;
      readonly positionId: string;
      readonly type: 'POSITION';
    };

// Keyed by the union so that adding a fallback type fails to compile until it
// is listed here: the engine and the designer both read this one table.
const KNOWN_APPROVER_FALLBACK_TYPES: Readonly<
  Record<ApproverResolverFallback['type'], true>
> = {
  DIRECT: true,
  NONE: true,
  POSITION: true,
};

/**
 * The fallback's type when this build does not know it (a definition saved by
 * a newer version), or `null` when it does. Takes a bare `type` so a newer
 * definition can be checked without the compiler having narrowed it away.
 * The engine refuses such a fallback at run time; the designer keeps it
 * untouched and shows it read-only.
 */
export function readUnsupportedApproverFallbackType(fallback: {
  readonly type: string;
}): string | null {
  return Object.prototype.hasOwnProperty.call(
    KNOWN_APPROVER_FALLBACK_TYPES,
    fallback.type,
  )
    ? null
    : fallback.type;
}

// Keyed by the union so that adding a resolver type fails to compile until it
// is listed here: the engine and the designer both read this one table.
const KNOWN_APPROVER_RESOLVER_TYPES: Readonly<
  Record<ApproverResolver['type'], true>
> = {
  DIRECT: true,
  DYNAMIC_FORM: true,
  EXPRESSION: true,
  FORM_MEMBER_MANAGER: true,
  FORM_ORG_UNIT_MANAGER: true,
  NODE_ACTOR: true,
  NODE_ACTOR_MANAGER: true,
  ORG_MANAGER: true,
  ORG_MANAGER_CHAIN: true,
  ORG_UNIT_MANAGER: true,
  ORG_UNIT_MEMBER: true,
  ORG_UNIT_POSITION: true,
  POSITION: true,
};

// A notify node's recipients are resolved without a running approval path, so
// the sources that need a form pick or earlier signers are not offered there.
const NOTIFY_RECIPIENT_RESOLVER_TYPES: Readonly<
  Record<Exclude<ApproverResolver['type'], NewApproverResolverType>, true>
> = {
  DIRECT: true,
  DYNAMIC_FORM: true,
  EXPRESSION: true,
  ORG_MANAGER: true,
  ORG_MANAGER_CHAIN: true,
  ORG_UNIT_MANAGER: true,
  ORG_UNIT_MEMBER: true,
  ORG_UNIT_POSITION: true,
  POSITION: true,
};

type NewApproverResolverType =
  | 'FORM_MEMBER_MANAGER'
  | 'FORM_ORG_UNIT_MANAGER'
  | 'NODE_ACTOR'
  | 'NODE_ACTOR_MANAGER';

// Resolvers that look a manager up, so "no manager" is a state they can reach.
const FALLBACK_CAPABLE_RESOLVER_TYPES: Readonly<
  Record<
    Extract<
      ApproverResolver,
      { readonly fallback?: ApproverResolverFallback }
    >['type'],
    true
  >
> = {
  FORM_MEMBER_MANAGER: true,
  FORM_ORG_UNIT_MANAGER: true,
  NODE_ACTOR_MANAGER: true,
  ORG_MANAGER: true,
  ORG_MANAGER_CHAIN: true,
  ORG_UNIT_MANAGER: true,
};

function hasOwnKey(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * The resolver's type when this build does not know it (a definition saved by
 * a newer version), or `null` when it does. Takes a bare `type` so a newer
 * definition can be checked without the compiler having narrowed it away.
 * The engine refuses such a resolver at run time instead of guessing; the
 * designer keeps it untouched and shows it read-only.
 */
export function readUnsupportedApproverResolverType(resolver: {
  readonly type: string;
}): string | null {
  return hasOwnKey(KNOWN_APPROVER_RESOLVER_TYPES, resolver.type)
    ? null
    : resolver.type;
}

/** Whether a notify node may use this resolver type for its recipients. */
export function isNotifyRecipientResolverType(type: string): boolean {
  return hasOwnKey(NOTIFY_RECIPIENT_RESOLVER_TYPES, type);
}

/** Whether a resolver of this type may carry a "no manager" fallback. */
export function isFallbackCapableApproverResolverType(type: string): boolean {
  return hasOwnKey(FALLBACK_CAPABLE_RESOLVER_TYPES, type);
}

/**
 * Whose manager an `ORG_MANAGER_CHAIN` starts climbing from. The start person
 * is never on the chain themselves: the chain begins at their direct manager,
 * as it does for the initiator.
 *
 * - `INITIATOR`: the person who submitted the instance (the default).
 * - `FORM_MEMBER`: the one person picked on the form field `formPath`.
 * - `NODE_ACTOR`: the one person who actually approved the earlier node(s)
 *   `nodeIds` (read the way `NODE_ACTOR` reads them).
 * - `CHAIN_CONTINUATION`: continue the earlier manager-chain stage `nodeId`.
 *   The chain climbs from that stage's start but only signs managers above the
 *   position level that stage actually reached; when that stage already
 *   reached this stage's `minPositionLevel`, this stage is skipped.
 */
export type OrgManagerChainStart =
  | { readonly type: 'INITIATOR' }
  | { readonly formPath: string; readonly type: 'FORM_MEMBER' }
  | { readonly nodeIds: readonly string[]; readonly type: 'NODE_ACTOR' }
  | { readonly nodeId: string; readonly type: 'CHAIN_CONTINUATION' };

// Keyed by the union so that adding a start type fails to compile until it is
// listed here: the engine, the publish lint and the designer read this table.
const KNOWN_ORG_MANAGER_CHAIN_START_TYPES: Readonly<
  Record<OrgManagerChainStart['type'], true>
> = {
  CHAIN_CONTINUATION: true,
  FORM_MEMBER: true,
  INITIATOR: true,
  NODE_ACTOR: true,
};

/** What a start with no type is called in a message instead of its type. */
const MISSING_ORG_MANAGER_CHAIN_START_TYPE_LABEL = '（缺少型別）';

/**
 * The start's type when this build does not know it (a definition saved by a
 * newer version), or `null` when it does. Takes a bare `type` so a newer
 * definition can be checked without the compiler having narrowed it away. The
 * engine refuses such a start at run time instead of climbing from the
 * initiator, which would route the case to the wrong people. A start whose
 * type is missing or not a string reads as unsupported too, named
 * `（缺少型別）`.
 */
export function readUnsupportedOrgManagerChainStartType(start: {
  readonly type: string;
}): string | null {
  const type: unknown = start.type;

  // A start with no usable type (raw JSON that nothing has linted) is still
  // unsupported; name it in words rather than printing `undefined`.
  if (typeof type !== 'string' || type === '') {
    return MISSING_ORG_MANAGER_CHAIN_START_TYPE_LABEL;
  }

  return hasOwnKey(KNOWN_ORG_MANAGER_CHAIN_START_TYPES, type) ? null : type;
}

type OrgManagerChainResolver = Extract<
  ApproverResolver,
  { readonly type: 'ORG_MANAGER_CHAIN' }
>;

/**
 * `true` when the chain starts at the initiator: `startFrom` is absent (an
 * explicit `null` counts as absent) or says `INITIATOR`.
 */
export function isOrgManagerChainStartedFromInitiator(
  resolver: Pick<OrgManagerChainResolver, 'startFrom'>,
): boolean {
  const startFrom: unknown = resolver.startFrom;

  return (
    startFrom === undefined ||
    startFrom === null ||
    (typeof startFrom === 'object' &&
      (startFrom as { readonly type?: unknown }).type === 'INITIATOR')
  );
}

/**
 * `true` when the chain continues an earlier manager-chain stage
 * (`startFrom.type` is `CHAIN_CONTINUATION`). The named stage is not read.
 */
export function isOrgManagerChainContinuation(
  resolver: Pick<OrgManagerChainResolver, 'startFrom'>,
): boolean {
  const startFrom: unknown = resolver.startFrom;

  return (
    typeof startFrom === 'object' &&
    startFrom !== null &&
    (startFrom as { readonly type?: unknown }).type === 'CHAIN_CONTINUATION'
  );
}

/**
 * `true` when the chain skips its whole stage once the start person's own
 * position level reaches `minPositionLevel`: `skipWhenStartReached` is exactly
 * `true`. Absent, `false`, `null` and anything else read as not skipping.
 */
export function isOrgManagerChainSkippingWhenStartReached(
  resolver: Pick<OrgManagerChainResolver, 'skipWhenStartReached'>,
): boolean {
  const skip: unknown = resolver.skipWhenStartReached;

  return skip === true;
}

/**
 * The position level below which managers are walked past, or `null` when the
 * chain has no start level (absent or `null`; anything that is not a finite
 * number is read as absent too, the publish lint refuses it).
 */
export function readOrgManagerChainStartPositionLevel(
  resolver: Pick<OrgManagerChainResolver, 'startPositionLevel'>,
): number | null {
  const level: unknown = resolver.startPositionLevel;

  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

/**
 * The chain's dry-run placeholder. The dry run cannot look the organisation
 * up, so it names what the runtime would resolve. Grammar, with `<from>` one
 * of `formMember` / `nodeActor` / `continue` and `<key>` the form path, the
 * node ids joined by `,` or the continued node id (it may itself hold a colon,
 * so it is always the last part):
 *
 *     orgManagerChain:<min>                      neither setting: as before
 *     orgManagerChain:<min>:<startLevel>         only startPositionLevel
 *     orgManagerChain:<min>:<startLevel>:<from>:<key>
 *                                                `<startLevel>` is empty when
 *                                                the chain has none
 *
 * A chain with `skipWhenStartReached: true` writes the kind
 * `orgManagerChainSkipReached` in place of `orgManagerChain`; every other part
 * is the same.
 *
 * Starting at the initiator is the same as not saying so, so an `INITIATOR`
 * start adds nothing.
 */
export function formatOrgManagerChainPlaceholder(
  resolver: Pick<
    OrgManagerChainResolver,
    'minPositionLevel' | 'startFrom' | 'startPositionLevel'
  > &
    Partial<Pick<OrgManagerChainResolver, 'skipWhenStartReached'>>,
): string {
  const kind =
    resolver.skipWhenStartReached === true
      ? 'orgManagerChainSkipReached'
      : 'orgManagerChain';
  const base = `${kind}:${resolver.minPositionLevel}`;
  const startLevel = readOrgManagerChainStartPositionLevel(resolver);
  const level = startLevel === null ? '' : String(startLevel);
  const startFrom = resolver.startFrom;

  if (startFrom?.type === 'FORM_MEMBER') {
    return `${base}:${level}:formMember:${startFrom.formPath}`;
  }

  if (startFrom?.type === 'NODE_ACTOR') {
    return `${base}:${level}:nodeActor:${startFrom.nodeIds.join(',')}`;
  }

  if (startFrom?.type === 'CHAIN_CONTINUATION') {
    return `${base}:${level}:continue:${startFrom.nodeId}`;
  }

  return startLevel === null ? base : `${base}:${level}`;
}

export interface OrgManagerChainPlaceholder {
  readonly minPositionLevel: number;
  /** Present, and `true`, only for the `orgManagerChainSkipReached` kind. */
  readonly skipWhenStartReached?: true;
  readonly startFrom:
    | { readonly formPath: string; readonly type: 'FORM_MEMBER' }
    | { readonly nodeIds: readonly string[]; readonly type: 'NODE_ACTOR' }
    | { readonly nodeId: string; readonly type: 'CHAIN_CONTINUATION' }
    | null;
  readonly startPositionLevel: number | null;
}

// A level is written with `String(level)`, so a fractional one (a draft the
// publish lint would refuse) must read back as written, not as "not a
// placeholder": the dry run would otherwise show the raw text for it.
const PLACEHOLDER_NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * The parts of a chain placeholder written by
 * {@link formatOrgManagerChainPlaceholder}, or `null` for any other text.
 *
 * The `nodeActor` key is the node ids joined by `,`, so a node id that itself
 * contains a comma cannot be read back (it comes back as two ids). The
 * designer and the engine only produce ids without commas; the format does
 * not escape them.
 */
export function parseOrgManagerChainPlaceholder(
  placeholder: string,
): OrgManagerChainPlaceholder | null {
  const [kind, min, level, from, ...keyParts] = placeholder.split(':');

  if (
    (kind !== 'orgManagerChain' && kind !== 'orgManagerChainSkipReached') ||
    !PLACEHOLDER_NUMBER_PATTERN.test(min ?? '')
  ) {
    return null;
  }

  const minPositionLevel = Number(min);
  const startPositionLevel =
    level === undefined || level === ''
      ? null
      : PLACEHOLDER_NUMBER_PATTERN.test(level)
        ? Number(level)
        : undefined;

  if (startPositionLevel === undefined) {
    return null;
  }

  // Only the skip kind carries the key, so every other placeholder reads back
  // with exactly the parts it always had.
  const skip =
    kind === 'orgManagerChainSkipReached'
      ? ({ skipWhenStartReached: true } as const)
      : {};

  if (from === undefined) {
    return level === ''
      ? null
      : { minPositionLevel, ...skip, startFrom: null, startPositionLevel };
  }

  const key = keyParts.join(':');

  if (level === undefined || key === '') {
    return null;
  }

  if (from === 'formMember') {
    return {
      minPositionLevel,
      ...skip,
      startFrom: { formPath: key, type: 'FORM_MEMBER' },
      startPositionLevel,
    };
  }

  if (from === 'continue') {
    return {
      minPositionLevel,
      ...skip,
      startFrom: { nodeId: key, type: 'CHAIN_CONTINUATION' },
      startPositionLevel,
    };
  }

  return from === 'nodeActor'
    ? {
        minPositionLevel,
        ...skip,
        startFrom: { nodeIds: key.split(','), type: 'NODE_ACTOR' },
        startPositionLevel,
      }
    : null;
}

export type DecisionPolicy =
  | { readonly type: 'SINGLE' }
  | { readonly type: 'SEQUENTIAL' }
  | { readonly type: 'PARALLEL_ALL' }
  | { readonly type: 'PARALLEL_ANY' }
  | {
      readonly threshold: number;
      readonly thresholdType: 'COUNT' | 'PERCENTAGE';
      readonly type: 'QUORUM';
    };

export interface ReturnBehavior {
  readonly allowReturn: boolean;
  readonly allowedTargets: 'PREVIOUS' | 'INITIATOR' | 'ANY';
  /**
   * Requires a non-empty comment on every return decision made at this node.
   *
   * Omitted or `false` keeps the pre-0.7.0 behaviour where returning without a
   * comment is accepted. The engine validates this against the workflow
   * snapshot stored on the instance, so in-flight instances started before the
   * template opted in keep their original behaviour.
   */
  readonly requireComment?: boolean;
  readonly resubmitStrategy?: ReturnResubmitStrategy;
}

export type ReturnResubmitStrategy = 'FROM_RETURN_POINT' | 'RESTART';

export interface SlaConfig {
  /**
   * Selects how {@link SlaConfig.duration} is advanced.
   *
   * `CALENDAR` (the default when omitted) adds the duration as elapsed wall
   * time. `BUSINESS_DAY` advances the `D` component across business days only,
   * skipping whatever the host-provided `BPMBusinessCalendar` reports as
   * non-business dates; any `T` component (hours/minutes/seconds) is then added
   * as plain elapsed time on top of the resolved business day.
   */
  readonly calendar?: SlaCalendarMode;
  readonly duration: string;
  readonly escalateLevelsUp?: number;
  readonly onTimeout:
    | 'REMIND'
    | 'AUTO_APPROVE'
    | 'ESCALATE'
    | 'TERMINATE_INSTANCE';
  readonly warningAt?: number;
}

export type SlaCalendarMode = 'CALENDAR' | 'BUSINESS_DAY';

export type FieldAccessDisplay = 'SHOW' | 'HIDE';

export type FieldAccessFill = 'NONE' | 'OPTIONAL' | 'REQUIRED';

/**
 * How one top-level form field behaves at a user task. A field with `fill`
 * other than `NONE` can be filled in only by the approver of a non-ad-hoc task
 * at this node, when approving; the server enforces it. `display: 'HIDE'` only
 * hides the field on screen, it is not a permission boundary.
 */
export interface FieldAccessEntry {
  readonly display: FieldAccessDisplay;
  readonly fieldKey: string;
  readonly fill: FieldAccessFill;
}

/**
 * @deprecated Reserved and never enforced: neither the engine nor any screen
 * reads `UserTaskNodeData.fieldPermissions`. Use `FieldAccessEntry`.
 */
export interface FieldPermission {
  readonly editable: boolean;
  readonly fieldPath: string;
  readonly visible: boolean;
}

export interface NotificationOverride {
  readonly channels?: readonly NotificationChannel[];
  readonly customTemplate?: string;
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'WEBHOOK';

export type ServiceTaskNode = BaseWorkflowNode<
  'serviceTask',
  BaseNodeData & {
    readonly action: ServiceAction;
    readonly entryCondition?: string;
  }
>;

export type ServiceAction =
  | {
      readonly channels: readonly Exclude<NotificationChannel, 'WEBHOOK'>[];
      /**
       * An empty `DIRECT` resolver is allowed only when `webhooks` is
       * non-empty: the node then notifies external systems and no member.
       */
      readonly recipients: ApproverResolver;
      readonly template?: string;
      readonly type: 'NOTIFY';
      /**
       * Host-registered webhook endpoints to call when the node runs (ADR 18).
       * Stores only the endpoint reference and parameter bindings — never a
       * URL, header or secret.
       */
      readonly webhooks?: readonly NotifyWebhookTarget[];
    }
  | {
      readonly headers?: Readonly<Record<string, string>>;
      readonly payload?: string;
      readonly type: 'WEBHOOK';
      readonly url: string;
    }
  | {
      readonly fieldPath: string;
      readonly type: 'SET_FORM_FIELD';
      readonly value: string;
    };

export interface NotifyWebhookTarget {
  readonly bindings: readonly NotifyWebhookBinding[];
  readonly endpoint: NotifyWebhookEndpointReference;
  /**
   * Stable within the node: generated once, never regenerated. The delivery
   * outbox keys idempotency on it, so editing a target must keep its id.
   */
  readonly id: string;
}

export interface NotifyWebhookEndpointReference {
  readonly key: string;
  readonly version: number;
}

export interface NotifyWebhookBinding {
  readonly from: NotifyWebhookBindingSource;
  readonly parameter: string;
}

export type NotifyWebhookBindingSource =
  | { readonly fieldKey: string; readonly kind: 'FIELD' }
  | {
      readonly kind: 'CONSTANT';
      readonly value: boolean | number | string | null;
    }
  | { readonly kind: 'CONTEXT'; readonly path: NotifyWebhookContextPath }
  | NotifyWebhookExpressionBindingSource;

/**
 * A webhook parameter computed by a cel-v2 expression over `form` (ADR 22
 * §3.7; NOTIFY has no row). Always cel-v2, built-in functions only, evaluated
 * by the backend inside the engine transaction with its own budget.
 *
 * The shared structural lint (`workflow-graph`) only checks that the
 * expression is a non-blank string: the browser never parses CEL. The
 * backend publish lint checks roots, fields, functions and the result type
 * against the endpoint parameter.
 */
export interface NotifyWebhookExpressionBindingSource {
  readonly expression: string;
  readonly kind: 'EXPRESSION';
}

export type NotifyWebhookContextPath =
  | 'initiator.memberId'
  | 'instance.id'
  | 'instance.templateId'
  | 'instance.templateVersionId'
  | 'instance.title'
  | 'node.id'
  | 'node.label';

export type NotifyWebhookParameterType =
  | 'boolean'
  | 'json'
  | 'number'
  | 'string'
  | 'stringArray';

export type ExclusiveGatewayNode = BaseWorkflowNode<
  'exclusiveGateway',
  BaseNodeData & {
    readonly direction: GatewayDirection;
  }
>;

export type ParallelGatewayNode = BaseWorkflowNode<
  'parallelGateway',
  BaseNodeData & {
    readonly direction: GatewayDirection;
  }
>;

export type GatewayDirection = 'split' | 'join';

export interface WorkflowEdge {
  readonly data: WorkflowEdgeData;
  readonly id: string;
  readonly source: string;
  readonly sourceHandle?: string | null;
  readonly target: string;
  readonly targetHandle?: string | null;
  readonly type?: 'smoothstep';
}

export interface WorkflowEdgeData {
  readonly condition?: string;
  readonly conditionFieldKey?: string;
  readonly conditionOperator?: WorkflowEdgeConditionOperator;
  readonly conditionValue?: string;
  readonly isDefault?: boolean;
  readonly label?: string;
}

export type WorkflowEdgeConditionOperator =
  | 'EQUALS'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUALS'
  | 'IS_EMPTY'
  | 'IS_FILLED'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUALS'
  | 'NOT_EQUALS';
