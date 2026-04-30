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

export interface InstanceContext {
  readonly id: string;
  readonly startedAt: string;
  readonly templateId: string;
  readonly templateVersion: number;
}

export interface LastDecisionContext {
  readonly action: 'approved' | 'rejected' | 'returned';
  readonly comment: string;
  readonly decidedAt: string;
  readonly decidedBy: SubjectContext;
  readonly nodeId: string;
  readonly taskId: string;
}
