export interface WorkflowDefinition {
  readonly edges: readonly WorkflowEdge[];
  readonly meta: WorkflowDefinitionMeta;
  readonly nodes: readonly WorkflowNode[];
}

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
  readonly fieldAccess?: readonly FieldAccessEntry[];
  /**
   * @deprecated Never enforced and never read: use `fieldAccess`. A draft that
   * still carries this key cannot be published (`legacyFieldPermissions`).
   */
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
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
  | { readonly kind: 'CONTEXT'; readonly path: NotifyWebhookContextPath };

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
