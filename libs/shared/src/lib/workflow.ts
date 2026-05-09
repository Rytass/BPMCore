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
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
  readonly returnBehavior: ReturnBehavior;
  readonly sla?: SlaConfig;
}

export type ApproverResolver =
  | { readonly memberIds: readonly string[]; readonly type: 'DIRECT' }
  | { readonly positionId: string; readonly type: 'POSITION' }
  | {
      readonly baseFromInitiator: boolean;
      readonly levelsUp: number;
      readonly type: 'ORG_MANAGER';
    }
  | { readonly formPath: string; readonly type: 'DYNAMIC_FORM' }
  | { readonly expression: string; readonly type: 'EXPRESSION' };

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
  readonly resubmitStrategy?: ReturnResubmitStrategy;
}

export type ReturnResubmitStrategy = 'FROM_RETURN_POINT' | 'RESTART';

export interface SlaConfig {
  readonly duration: string;
  readonly escalateLevelsUp?: number;
  readonly onTimeout:
    | 'REMIND'
    | 'AUTO_APPROVE'
    | 'ESCALATE'
    | 'TERMINATE_INSTANCE';
  readonly warningAt?: number;
}

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
      readonly recipients: ApproverResolver;
      readonly template?: string;
      readonly type: 'NOTIFY';
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
