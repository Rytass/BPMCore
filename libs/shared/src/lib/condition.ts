import { ApprovalInstanceState, TaskDecisionAction } from './status';

export type ConditionContextType =
  | 'INITIATOR_POLICY'
  | 'ENTRY_CONDITION'
  | 'FLOW_CONDITION'
  | 'APPROVER_RESOLVER'
  | 'FORM_FIELD_CONDITION'
  | 'DELEGATION_CONDITION';

export interface SubjectContext {
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly org: OrgContext;
  readonly position: PositionContext;
  readonly roles: readonly string[];
}

export interface OrgContext {
  readonly code: string;
  readonly costCenter?: string;
  readonly id: string;
  readonly location?: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: readonly string[];
  readonly type: string;
}

export interface PositionContext {
  readonly code: string;
  readonly id: string;
  readonly level: number;
  readonly name: string;
}

export interface EnvContext {
  readonly now: string;
}

// `instance` as the engine builds it for workflow expressions.
export interface InstanceContext {
  readonly id: string;
  readonly state: ApprovalInstanceState;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly title: string;
}

// `lastDecision` in an edge condition: the newest decision recorded on the
// node the edge leaves. It is `null` until that node has a decision — for
// example on an edge leaving a gateway or the start node — so guard it with
// `lastDecision != null && …`.
export interface LastDecisionContext {
  readonly action: TaskDecisionAction;
  readonly comment: string | null;
  readonly decidedAt: string;
  readonly decidedByMemberId: string;
  readonly returnToNodeId: string | null;
  readonly taskId: string;
  readonly transferToMemberId: string | null;
}
