import { isUUID } from 'class-validator';
import {
  isFormDataValueEmpty,
  MemberMetadata,
  omitFormDataKeys,
  overlayStoredFormDataKeys,
  readApproverFilledFieldKeys,
  readNodeFillableFieldKeys,
  readNodeRequiredFieldKeys,
  readFilterableFieldPaths,
  readFilterableValueProblems,
  type ApprovalInstanceFieldFilter,
  type ApprovalInstanceSort,
  type FilterableValueProblem,
  isApprovalInstanceSortTimeField,
} from '@rytass/bpm-core-shared';
import {
  FORM_TABLE_MAX_ROWS,
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  NumberFieldDefinition,
  TableColumnDefinition,
  TableFieldDefinition,
  isFormDataSourceFieldDefinition,
  isFormTableCellValue,
  isTableFieldDefinition,
  readFormFieldSelectionMode,
  readTextFieldValueIssue,
  TextFieldPatternTest,
} from '@rytass/bpm-core-shared/form';
import {
  WorkflowDefinition,
  WorkflowEdge,
  DecisionPolicy,
  WorkflowNode,
  UserTaskNode,
  ServiceTaskNode,
  ApproverResolver,
  ApproverResolverFallback,
  formatOrgManagerChainPlaceholder,
  isNotifyRecipientResolverType,
  isOrgManagerChainStartedFromInitiator,
  readOrgManagerChainStartPositionLevel,
  readUnsupportedApproverFallbackType,
  readUnsupportedApproverResolverType,
  readUnsupportedOrgManagerChainStartType,
  ReturnResubmitStrategy,
} from '@rytass/bpm-core-shared/workflow';
import {
  isAsyncNotifyServiceTask,
  isNotifyRecipientsEmpty,
  readNotifyWebhookTargets,
  readSelectableReturnTargetNodeIds,
} from '@rytass/bpm-core-shared/workflow-graph';
import { WorkflowWebhookDeliveryService } from '../workflow-webhook/workflow-webhook-delivery.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  EntityManager,
  In,
  IsNull,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { AttachmentService } from '../attachment/attachment.service';
import { readFileUploadValueIds } from '../attachment/file-upload-value-ids';
import {
  DelegationResolution,
  DelegationService,
  DelegationStep,
} from '../delegation/delegation.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
} from '../form-data-source/form-data-source.errors';
import { readSubmittedMemberValueErrors } from '../form/form-member-value.validator';
import {
  createFormDataBadRequest,
  createFormDataIssue,
  readCellIssueLocation,
  readFieldIssueLocation,
  readFormDataIssueMessage,
  readRowIssueLocation,
  type FormDataIssueLocation,
} from '../form/form-data-issue';
import type { FormDataIssue } from '@rytass/bpm-core-shared/form';
import {
  isSubmittableOrgUnitValue,
  readSubmittedOrgUnitValueErrors,
} from '../form/form-org-unit-value.validator';
import { BPM_FORM_DATA_SOURCE_VALUE_RESOLVER } from '../form-data-source/form-data-source.types';
import type { BPMFormDataSourceValueResolver } from '../form-data-source/form-data-source.types';
import { BPMSlaScheduleService } from '../calendar/sla-schedule.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationEntity } from '../notification/notification.entity';
import {
  NotificationChannelEnum,
  NotificationResolutionEnum,
} from '../notification/notification.enums';
import { SignatureService } from '../signature/signature.service';
import {
  ConditionService,
  type ExpressionCallOptions,
} from '../condition/condition.service';
import { BPMAuthContext } from '../bpm-auth';
import { ManagerResolutionEntity } from '../organization/manager-resolution.entity';
import { MembershipEntity } from '../organization/membership.entity';
import { OrgUnitEntity } from '../organization/org-unit.entity';
import { PositionEntity } from '../organization/position.entity';
import { ManagerResolutionScopeTypeEnum } from '../organization/organization.enums';
import {
  formatDateOnlyInTimeZone,
  resolveBPMOrganizationTimeZone,
} from '../organization/organization-time-zone';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { DecideTaskInput } from './dto/decide-task.input';
import { DryRunApprovalWorkflowInput } from './dto/dry-run-approval-workflow.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import {
  AdhocDirectiveStatusEnum,
  AdhocDirectiveTypeEnum,
  AdhocPreApprovalRejectBehaviorEnum,
  AdhocTargetKindEnum,
} from './adhoc.enums';
import { AdhocTargetInput } from './dto/adhoc-target.input';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import {
  ApprovalInstanceFieldFilterCompiler,
  readStaticOptionsByPath,
  type CompiledApprovalInstanceFieldFilters,
  type CompiledApprovalInstanceOrder,
} from './approval-instance-field-filter.compiler';
import { ApprovalInstanceFilterableFieldPolicy } from './approval-instance-filterable-field.policy';
import {
  createTimedTextFieldPatternTest,
  TextFieldPatternTimeoutError,
} from './text-field-pattern-test';
import {
  computeFormDataFingerprint,
  computeStableValueFingerprint,
} from './form-data-fingerprint';
import { readDistinctSubmitterMemberId } from './instance-submitter';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceListViewEnum,
  ApprovalInstanceStateEnum,
  MemberTaskRoleEnum,
  TaskAssignmentTypeEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskReassignmentErrorCodeEnum,
  TaskReassignmentOutcomeEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { evaluateWorkflowEdgeCondition } from './workflow-condition-evaluator';
import { isEmptyWorkflowValue, readOwnFormValue } from './workflow-form-value';
import {
  WorkflowDryRunResultObject,
  WorkflowDryRunStepObject,
} from './workflow-dry-run.object';
import { runWithinTimeBudget, TimeBudgetExceededError } from './time-budget';
import { runExpressionOperation } from '../condition/expression-budget';
import { ExpressionRuntimeError } from '../condition/expression-errors';
import {
  isExpressionDialect,
  readWorkflowExpressionDialect,
} from '../condition/expression-dialect';
import {
  BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
  BPMInitiatorCustomFieldsInput,
  BPMInitiatorCustomFieldsPurpose,
  BPMInitiatorCustomFieldsResolver,
} from './initiator-custom-fields-resolver.token';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  BPMWorkflowWebhookDispatchResult,
  DefaultWorkflowServiceTaskDispatcher,
} from './workflow-service-task-dispatcher.token';
import { WorkflowTokenEntity } from './workflow-token.entity';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';

/**
 * `initiatorMemberId` is optional on the GraphQL inputs because the resolver
 * derives it from the authenticated member, but the engine still requires it:
 * these aliases keep that obligation on the caller instead of re-checking it.
 */
type SubmitApprovalInstanceCommand = SubmitApprovalInstanceInput & {
  readonly initiatorMemberId: string;
  /**
   * The host document this instance stands for, unique within the template.
   * Service-level only: it is not on the GraphQL input, and the mutation
   * always passes `null`, so an end user can never claim a key.
   */
  readonly businessKey?: string | null;
  /**
   * Service layer only: the GraphQL mutation always fills it with the
   * authenticated member and the input type does not expose it. Absent means
   * the initiator submitted the document themselves.
   */
  readonly submittedByMemberId?: string | null;
  /**
   * Set only by the GraphQL mutation, never by the DTO, so an end user cannot
   * bring it along. The service then keeps the fields an approver fills in
   * out of the submission; a host calling the service directly leaves it
   * unset and may prefill them.
   */
  readonly endUserSubmission?: boolean;
};

type ResubmitApprovalInstanceCommand = ResubmitApprovalInstanceInput & {
  readonly initiatorMemberId: string;
  /** See `SubmitApprovalInstanceCommand.endUserSubmission`. */
  readonly endUserSubmission?: boolean;
};

const MAX_DRY_RUN_INPUT_LENGTH = 1_048_576;
const MAX_DRY_RUN_VISITS = 10_000;
const DRY_RUN_TIME_BUDGET_MS = 2_000;
const DRY_RUN_TOO_COMPLEX_MESSAGE =
  '流程或條件的運算量過大，無法完成試跑，請減少連續的閘道分支或簡化條件';
const MAX_PROCESSING_STEPS = 500;
export const MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH = 200;
const APPROVAL_INSTANCE_BUSINESS_KEY_INDEX =
  'approval_instances_business_key_key';
// Guards ORG_MANAGER_CHAIN against misconfigured manager rules that never end.
const ORG_MANAGER_CHAIN_MAX_HOPS = 20;
const DEFAULT_APPROVAL_HISTORY_TASK_LIMIT = 50;
const SYSTEM_DRY_RUN_INSTANCE_ID = 'dry-run-instance';
// How long a submission waits for the host's initiator `customFields`
// resolver. The case is not created when it runs out (the snapshot never falls
// back to `{}`), so this bounds how long a member stares at a spinner when the
// host's lookup hangs; it is shorter than the 30 s webhook budget because a
// person is waiting on this one.
const INITIATOR_CUSTOM_FIELDS_RESOLVER_TIMEOUT_MS = 10_000;
const INITIATOR_CUSTOM_FIELDS_TIMEOUT_MESSAGE =
  '無法取得發起人的自訂欄位（逾時），這次申請沒有送出；請稍後再試或聯絡系統管理者';
const INITIATOR_CUSTOM_FIELDS_FAILED_MESSAGE =
  '無法取得發起人的自訂欄位，這次申請沒有送出；請稍後再試或聯絡系統管理者';
const INITIATOR_CUSTOM_FIELDS_INVALID_MESSAGE =
  '無法取得發起人的自訂欄位（回傳格式不正確），這次申請沒有送出；請聯絡系統管理者';
// The dry run checks each expression against the roots its use point may read,
// as publish does. Keep these in step with `WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS`
// in template.service.ts; P2 moves both to one place.
const DRY_RUN_WORKFLOW_ROOT_IDENTIFIERS: readonly string[] = [
  'env',
  'form',
  'formData',
  'initiator',
  'instance',
];
const DRY_RUN_EDGE_ROOT_IDENTIFIERS: readonly string[] = [
  ...DRY_RUN_WORKFLOW_ROOT_IDENTIFIERS,
  'lastDecision',
];

type ExpressionDialectSource =
  { readonly expressionDialect?: unknown } | null | undefined;

const hasExpressionText = (
  expression: string | null | undefined,
): expression is string =>
  typeof expression === 'string' && expression.trim() !== '';

/**
 * Whether a definition's dialect can be read: missing (`cel-legacy`) or one
 * this version knows. Never throws, unlike `readWorkflowExpressionDialect`.
 */
const isReadableExpressionDialect = (
  definition: ExpressionDialectSource,
): boolean => {
  const dialect = definition?.expressionDialect;

  return (
    dialect === undefined || dialect === null || isExpressionDialect(dialect)
  );
};

/**
 * Options for evaluating an expression that may be blank. The dialect is read
 * only when there is an expression: an unknown dialect is refused because the
 * expression cannot be evaluated as its author tested it, and a blank one is
 * never evaluated at all. Publishing does not check the field yet (Phase 23
 * P2), so reading it eagerly would turn a stray field on a version with no
 * expressions into an error, where before dialects existed it was ignored.
 */
const readExpressionDialectOptions = (
  expression: string | null | undefined,
  definition: ExpressionDialectSource,
): ExpressionCallOptions =>
  hasExpressionText(expression)
    ? { dialect: readWorkflowExpressionDialect(definition) }
    : {};

/** A webhook whose payload is settled and which waits for its transaction. */
interface DeferredWebhookDispatch {
  readonly instanceId: string;
  readonly readActivityLog: (
    result: BPMWorkflowWebhookDispatchResult,
  ) => DeepPartial<ActivityLogEntity>;
  readonly send: () => Promise<BPMWorkflowWebhookDispatchResult>;
}

interface DryRunSimulationInput {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly initiatorMetadataSnapshot: Readonly<Record<string, unknown>>;
  readonly workflowDefinition: WorkflowDefinition;
}

interface DryRunAssignment {
  readonly assigneeMemberId: string | null;
  // Set only when the initiator exclusion changed how the step ends.
  readonly message: string | null;
  readonly outcome: 'SKIPPED' | 'STOPPED' | null;
}

// Who a resolver is looking for: approvers of a task, or the recipients of a
// notification. Only the wording of the "nobody found" errors differs.
type ResolvedSubject = '簽核人' | '通知對象';

interface DryRunOutgoing {
  readonly edges: readonly WorkflowEdge[];
  // Set when the node cannot route any further and its branch ends here.
  readonly stopMessage: string | null;
}

interface DryRunPathInput extends DryRunSimulationInput {
  readonly chargeVisit: () => void;
  readonly depth: number;
  readonly incomingEdge: WorkflowEdge | null;
  readonly lastDecision: Readonly<Record<string, unknown>> | null;
  readonly nodeId: string;
  readonly steps: readonly WorkflowDryRunStepObject[];
  readonly visitedNodeIds: ReadonlySet<string>;
}

/**
 * Delegation-chain reason recorded for an approver-initiated transfer, as
 * opposed to {@link SLA_ESCALATION_DELEGATION_REASON}.
 */
export const MANUAL_TRANSFER_DELEGATION_REASON = 'MANUAL_TRANSFER';

/**
 * Delegation-chain reason for a seat an administrator moved to another member
 * (see {@link WorkflowEngineService.reassignTask}). The step's `actorMemberId`
 * names the administrator and `comment` carries the reason they typed.
 */
export const ADMIN_REASSIGN_DELEGATION_REASON = 'ADMIN_REASSIGN';

const TASK_REASSIGNMENT_MESSAGES: Readonly<
  Record<TaskReassignmentErrorCodeEnum, string>
> = {
  [TaskReassignmentErrorCodeEnum.INSTANCE_NOT_RUNNING]: '案件已不在進行中',
  [TaskReassignmentErrorCodeEnum.REASON_REQUIRED]: '必須填寫改派原因',
  [TaskReassignmentErrorCodeEnum.SOURCE_NOT_ON_TASK]:
    '來源成員已不在此任務的待簽名單上',
  [TaskReassignmentErrorCodeEnum.TARGET_ALREADY_DECIDED]:
    '接手人已對此任務簽過核',
  [TaskReassignmentErrorCodeEnum.TARGET_ALREADY_ON_TASK]:
    '接手人已在此任務的待簽名單上',
  [TaskReassignmentErrorCodeEnum.TARGET_GRADE_TOO_LOW]:
    '接手人職等不足，不能取代此簽核位置',
  [TaskReassignmentErrorCodeEnum.TARGET_IS_EXCLUDED_NODE_ACTOR]:
    '此節點不允許與前面關卡的簽核者為同一人，接手人不能是前面關卡的簽核者',
  [TaskReassignmentErrorCodeEnum.TARGET_IS_INITIATOR]:
    '此節點不允許申請人自簽，接手人不能是申請人',
  [TaskReassignmentErrorCodeEnum.TARGET_IS_SUBMITTER]:
    '此節點不允許代送人簽核，接手人不能是代為送出此單的人',
  [TaskReassignmentErrorCodeEnum.TARGET_SAME_AS_SOURCE]: '接手人與原簽核人相同',
  [TaskReassignmentErrorCodeEnum.TASK_NOT_OPEN]: '任務已不在待簽狀態',
  [TaskReassignmentErrorCodeEnum.UNEXPECTED_ERROR]: '改派時發生非預期錯誤',
};

/** Statuses in which a candidate row still holds a seat on the task. */
const OPEN_SEAT_STATUSES: readonly TaskCandidateStatusEnum[] = [
  TaskCandidateStatusEnum.PENDING,
  TaskCandidateStatusEnum.CLAIMED,
  TaskCandidateStatusEnum.WAITING,
];

/** Closed row states that a member can be moved back into (one row per member per task). */
const REUSABLE_SEAT_STATUSES: readonly TaskCandidateStatusEnum[] = [
  TaskCandidateStatusEnum.CANCELLED,
  TaskCandidateStatusEnum.SUPERSEDED,
  TaskCandidateStatusEnum.TRANSFERRED,
];

const OPEN_TASK_STATUSES: readonly TaskStatusEnum[] = [
  TaskStatusEnum.PENDING,
  TaskStatusEnum.IN_PROGRESS,
];

interface TaskReassignmentPlan {
  readonly instance: ApprovalInstanceEntity;
  readonly node: UserTaskNode;
  readonly reusableRow: TaskCandidateEntity | null;
  readonly sourceRow: TaskCandidateEntity | null;
  readonly task: TaskEntity;
}

interface TaskSeatReplacement {
  readonly assigneeMoved: boolean;
  /** Status of the target's new seat, or null when the source had no candidate row. */
  readonly seatStatus: TaskCandidateStatusEnum | null;
  readonly task: TaskEntity;
}

function buildTaskReassignmentResult(
  task: Pick<TaskEntity, 'id' | 'instanceId' | 'nodeId'>,
  outcome: TaskReassignmentOutcomeEnum,
  errorCode: TaskReassignmentErrorCodeEnum | null,
): TaskReassignmentResult {
  return {
    errorCode,
    instanceId: task.instanceId,
    message: errorCode ? TASK_REASSIGNMENT_MESSAGES[errorCode] : null,
    nodeId: task.nodeId,
    outcome,
    taskId: task.id,
  };
}

/** A refused reassignment: raised while planning, before anything is written. */
class TaskReassignmentRejectedError extends Error {
  readonly errorCode: TaskReassignmentErrorCodeEnum;

  constructor(errorCode: TaskReassignmentErrorCodeEnum) {
    super(TASK_REASSIGNMENT_MESSAGES[errorCode]);
    this.errorCode = errorCode;
  }
}

export interface TaskReassignmentResult {
  readonly errorCode: TaskReassignmentErrorCodeEnum | null;
  readonly instanceId: string;
  readonly message: string | null;
  readonly nodeId: string;
  readonly outcome: TaskReassignmentOutcomeEnum;
  readonly taskId: string;
}

export interface ReassignTaskOptions {
  readonly actorMemberId: string;
  readonly dryRun?: boolean | null;
  readonly fromMemberId: string;
  readonly reason: string;
  readonly toMemberId: string;
}

export interface MemberOpenTaskRecord {
  readonly candidateStatus: TaskCandidateStatusEnum | null;
  readonly createdAt: Date;
  readonly decisionPolicyType: string;
  readonly businessKey: string | null;
  readonly instanceId: string;
  readonly instanceTitle: string;
  readonly memberRole: MemberTaskRoleEnum;
  readonly nodeId: string;
  readonly nodeLabel: string | null;
  readonly slaDueAt: Date | null;
  readonly taskId: string;
  readonly templateId: string;
  readonly templateName: string | null;
}

/** The administrator screens are in Traditional Chinese: names sort by stroke count. */
const INACTIVE_MEMBER_NAME_LOCALE = 'zh-Hant-TW';

/**
 * How many deactivated members have their open tasks counted at once. Each
 * count is a few queries, so an unbounded fan-out would put one query in
 * flight per member, and claim that many pool connections at the same time, on
 * every load of the member screen.
 */
const INACTIVE_MEMBER_COUNT_CONCURRENCY = 5;

/** Paging of a member's task list; both absent means unpaged. */
export interface TaskListPageOptions {
  /** 1-based; defaults to 1 once paging is asked for. */
  readonly page?: number;
  /** Defaults to 20, at most 100, once paging is asked for. */
  readonly pageSize?: number;
}

/** Options of {@link WorkflowEngineService.listApprovalHistoryTasks}. */
export interface ApprovalHistoryTaskListOptions extends TaskListPageOptions {
  /** Only tasks of instances in this state. */
  readonly instanceState?: ApprovalInstanceStateEnum;
}

/** A deactivated member who still holds open tasks, for the reassignment screen. */
export interface InactiveMemberOpenTasksRecord {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  /** Same count as {@link WorkflowEngineService.listMemberOpenTasks} returns rows. */
  readonly openTaskCount: number;
}

/**
 * Engine-internal decision knobs that are deliberately kept out of
 * {@link DecideTaskInput} so they never reach the GraphQL schema.
 */
/** Input of {@link WorkflowEngineService.expireApprovalInstance}. */
export interface ExpireApprovalInstanceCommand {
  readonly comment?: string | null;
  readonly instanceId: string;
  /** The overdue task's node and the task itself, for the activity record. */
  readonly nodeId?: string | null;
  readonly taskId?: string | null;
}

export interface DecideTaskOptions {
  /**
   * Set when the engine itself, not a person, made this decision. An approval
   * marked `'SLA_AUTO_APPROVE'` is written to the TASK_DECIDED activity
   * payload as `automatic`, so a later `NODE_ACTOR` / `NODE_ACTOR_MANAGER`
   * node can tell a timeout from someone who actually signed.
   */
  readonly automatic?: 'SLA_AUTO_APPROVE';
  /**
   * Reason stamped on the delegation-chain step when the decision is a
   * transfer. Defaults to {@link MANUAL_TRANSFER_DELEGATION_REASON}.
   */
  readonly transferReason?: string;
}

interface ReturnedInstanceContext {
  readonly resubmitStrategy: ReturnResubmitStrategy;
  readonly returnedFromNodeId: string;
  readonly returnToNodeId: string;
}

interface ResubmitFormDataOptionsPreparation {
  readonly formDataOptionSnapshot: FormDataSourceValueSnapshots;
  readonly instance: ApprovalInstanceEntity;
}

// Candidates that replaced an excluded initiator's own seat come from the
// initiator's manager rather than from the node's resolver.
type CandidateSourceType =
  ApproverResolver['type'] | 'EXCLUDE_INITIATOR_MANAGER';

interface ResolvedApproverCandidate {
  readonly memberId: string;
  readonly sourceType: CandidateSourceType;
}

/**
 * A delegation that was resolved for a manager-chain candidate but not applied
 * because the delegate's grade is below the grade of the member they would
 * replace. Recorded on the activity payload (not in `delegationChain`, which
 * consumers read as a real delegation).
 */
interface SkippedDelegation {
  readonly agentLevel: number | null;
  readonly agentMemberId: string;
  readonly principalLevel: number;
  readonly principalMemberId: string;
  readonly reason: 'AGENT_POSITION_LEVEL_TOO_LOW';
}

interface RuntimeTaskCandidate {
  readonly delegationChain: readonly DelegationStep[];
  readonly memberId: string;
  readonly originalMemberId: string;
  readonly skippedDelegation?: SkippedDelegation;
  readonly sourceType: CandidateSourceType;
}

interface GradeGatedDelegation extends DelegationResolution {
  readonly skippedDelegation?: SkippedDelegation;
}

interface ResolvedRuntimeTaskCandidates {
  readonly candidates: readonly RuntimeTaskCandidate[];
  // Collected before the initiator filter and the dedupe, so a refusal on a row
  // those drop is still on record.
  readonly skippedDelegations: readonly SkippedDelegation[];
}

// A node whose approvers were all kept out and that is configured to be
// skipped instead of failing: which of its two exclusion rules decided it.
interface SkippedRuntimeTask {
  readonly skippedBy: 'INITIATOR' | 'NODE_ACTORS';
}

// Everyone one node keeps out of its approvers, kept per rule because each
// rule has its own `whenEmpty`.
interface NodeExclusions {
  readonly initiatorMemberIds: readonly string[];
  readonly memberIds: readonly string[];
  readonly nodeActorMemberIds: readonly string[];
}

type AdhocTargetValue = {
  readonly includeDescendants?: boolean;
  readonly kind: AdhocTargetKindEnum;
  readonly memberIds?: readonly string[];
  readonly orgUnitId?: string;
  readonly positionId?: string;
  readonly webhookHeaders?: Readonly<Record<string, string>>;
  readonly webhookUrl?: string;
};

type AdhocStageOutcome = 'APPROVED' | 'REJECTED' | 'RETURNED';

interface AdhocOperationContext {
  readonly instance: ApprovalInstanceEntity;
  readonly node: UserTaskNode;
  readonly task: TaskEntity;
}

export interface ListApprovalInstancesOptions {
  /** ADR 25 §7: conditions on form fields. Needs `templateId` when not empty. */
  readonly fieldFilters?: readonly ApprovalInstanceFieldFilter[];
  readonly page?: number;
  readonly pageSize?: number;
  readonly searchText?: string;
  /** ADR 25 §7.5: sort keys in order; the list always ends with `id`. */
  readonly sort?: readonly ApprovalInstanceSort[];
  readonly state?: readonly ApprovalInstanceStateEnum[];
  readonly templateId?: string;
  readonly view?: ApprovalInstanceListViewEnum;
}

interface FilteredApprovalInstanceQuery {
  readonly orderBy: readonly CompiledApprovalInstanceOrder[];
  readonly queryBuilder: SelectQueryBuilder<ApprovalInstanceEntity>;
}

interface WorkflowDashboardSummaryOptions {
  readonly from?: Date;
  readonly to?: Date;
}

type WorkflowReadScope = BPMAuthContext;
type FormConditionOperator =
  | 'equals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'notEquals';

const WORKFLOW_READ_ALL_PERMISSIONS = new Set([
  'bpm:*',
  'bpm.workflow.read_all',
  'bpm:workflow:read_all',
  'workflow.read_all',
]);

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);
  /** In-flight inbox reads by member; see `readSharedOpenInboxTasks`. */
  private readonly openInboxReadsInFlight = new Map<
    string,
    Promise<readonly TaskEntity[]>
  >();
  private readonly approvalInstanceFieldFilterCompiler =
    new ApprovalInstanceFieldFilterCompiler();
  private readonly approvalInstanceFilterableFieldPolicy =
    new ApprovalInstanceFilterableFieldPolicy();

  constructor(
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(WorkflowTokenEntity)
    private readonly workflowTokenRepository: Repository<WorkflowTokenEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @InjectRepository(TaskCandidateEntity)
    private readonly taskCandidateRepository: Repository<TaskCandidateEntity>,
    @InjectRepository(TaskDecisionEntity)
    private readonly taskDecisionRepository: Repository<TaskDecisionEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
    @InjectRepository(AdhocDirectiveEntity)
    private readonly adhocDirectiveRepository: Repository<AdhocDirectiveEntity>,
    @InjectRepository(ApprovalTemplateEntity)
    private readonly approvalTemplateRepository: Repository<ApprovalTemplateEntity>,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly approvalTemplateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly attachmentService: AttachmentService,
    private readonly conditionService: ConditionService,
    private readonly delegationService: DelegationService,
    private readonly notificationService: NotificationService,
    private readonly signatureService: SignatureService,
    private readonly slaScheduleService: BPMSlaScheduleService,
    @Optional()
    @Inject(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER)
    injectedServiceTaskDispatcher?: BPMWorkflowServiceTaskDispatcher,
    @Optional()
    @Inject(BPM_FORM_DATA_SOURCE_VALUE_RESOLVER)
    private readonly formDataSourceValueResolver?: BPMFormDataSourceValueResolver,
    @Optional()
    @Inject(BPM_ROOT_OPTIONS)
    rootOptions?: BPMRootRuntimeOptions,
    @Optional()
    private readonly webhookDeliveryService?: WorkflowWebhookDeliveryService,
    @Optional()
    @Inject(BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER)
    injectedInitiatorCustomFieldsResolver?: BPMInitiatorCustomFieldsResolver,
  ) {
    // A binding under the token wins: that is either the host's own provider
    // or `workflowServiceTaskDispatcherProvider`, both of them deliberate. The
    // runtime instance from `BPMRootModule`'s async factory comes next.
    //
    // Resolving it here rather than registering a default provider is what
    // keeps a host that binds the token from its own global module working —
    // a module-local default would shadow that binding, silently sending
    // WEBHOOK service tasks through the built-in `fetch` dispatcher instead of
    // the host's signing or queueing one.
    this.serviceTaskDispatcher =
      injectedServiceTaskDispatcher ??
      rootOptions?.workflowServiceTaskDispatcher ??
      new DefaultWorkflowServiceTaskDispatcher();
    // Resolved like the dispatcher above, for the same reason: a binding the
    // host made under the token wins, then the runtime instance, and with
    // neither the snapshot's `customFields` stays `{}`.
    this.initiatorCustomFieldsResolver =
      injectedInitiatorCustomFieldsResolver ??
      rootOptions?.initiatorCustomFieldsResolver ??
      null;
    this.organizationTimeZone = resolveBPMOrganizationTimeZone(
      rootOptions?.organizationTimeZone,
    );
  }

  private readonly serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher;

  private readonly initiatorCustomFieldsResolver: BPMInitiatorCustomFieldsResolver | null;

  /** Webhooks each open engine transaction will send once it has committed. */
  private readonly deferredWebhookDispatches = new WeakMap<
    EntityManager,
    DeferredWebhookDispatch[]
  >();

  private readonly organizationTimeZone: string;

  /**
   * Today's date as the organization sees it (`organizationTimeZone`), for
   * comparing against the date-only `effectiveFrom` / `effectiveTo` of
   * memberships and manager resolutions. Not for timestamp columns, which are
   * compared as instants.
   */
  private readOrganizationToday(): string {
    return formatDateOnlyInTimeZone(new Date(), this.organizationTimeZone);
  }

  /**
   * Opens an engine transaction whose webhooks wait for its commit. A webhook
   * sent from inside would hold the case lock and a pooled connection for as
   * long as the far end takes to answer, so a slow endpoint could stall the
   * case and then, a connection at a time, the whole API. A transaction that
   * rolls back sends nothing.
   *
   * The caller still waits for the sends, so the outcome is in the activity log
   * by the time a mutation returns, as it always has been.
   */
  private async runEngineTransaction<TResult>(
    work: (manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    // Mutable on purpose: every step of the transaction appends to it, and
    // threading it through each of them would change a dozen signatures.
    const dispatches: DeferredWebhookDispatch[] = [];
    // One transaction is one operation: its evaluations share one budget.
    const result = await runExpressionOperation(() =>
      this.approvalInstanceRepository.manager.transaction(
        (manager): Promise<TResult> => {
          this.deferredWebhookDispatches.set(manager, dispatches);

          return work(manager);
        },
      ),
    );

    await dispatches.reduce<Promise<void>>(async (previous, dispatch) => {
      await previous;
      await this.sendCommittedWebhook(dispatch);
    }, Promise.resolve());

    return result;
  }

  /**
   * Queues a webhook for after the commit. A manager this service did not open
   * has no queue and no commit it can see, so that webhook goes out on the spot
   * rather than being dropped.
   */
  private async dispatchWebhookAfterCommit(
    manager: EntityManager,
    dispatch: DeferredWebhookDispatch,
  ): Promise<void> {
    const queue = this.deferredWebhookDispatches.get(manager);

    if (queue) {
      queue.push(dispatch);

      return;
    }

    const activityRepository = manager.getRepository(ActivityLogEntity);
    const result = await dispatch.send();

    await activityRepository.save(
      activityRepository.create(dispatch.readActivityLog(result)),
    );
  }

  /**
   * The transaction has committed and the mutation has succeeded, so nothing
   * here may fail it: a result that cannot be recorded is only logged.
   */
  private async sendCommittedWebhook(
    dispatch: DeferredWebhookDispatch,
  ): Promise<void> {
    try {
      const result = await dispatch.send();

      await this.activityLogRepository.save(
        this.activityLogRepository.create(dispatch.readActivityLog(result)),
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not record a webhook result for instance ${dispatch.instanceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async submitApprovalInstance(
    input: SubmitApprovalInstanceCommand,
    authContext?: BPMAuthContext,
  ): Promise<ApprovalInstanceEntity> {
    const submitAuthContext =
      authContext ?? createWorkflowAuthContext(input.initiatorMemberId);

    if (
      input.submittedByMemberId !== undefined &&
      input.submittedByMemberId !== null &&
      (typeof input.submittedByMemberId !== 'string' ||
        input.submittedByMemberId.trim() === '')
    ) {
      throw new BadRequestException(
        'submittedByMemberId must be a non-empty string',
      );
    }

    const submittedFormData = parseJsonObject(
      input.formDataJson,
      'formDataJson',
    );
    const businessKey = normalizeBusinessKey(input.businessKey);
    const submittedByMemberId =
      input.submittedByMemberId ?? input.initiatorMemberId;
    const template = await this.getTemplateOrThrow(input.templateId);

    if (!template.isActive) {
      throw new ConflictException('Approval template is deactivated');
    }

    if (!template.currentVersionId) {
      throw new ConflictException(
        'Approval template does not have a published version',
      );
    }

    const templateVersion = await this.getPublishedTemplateVersionOrThrow(
      template.currentVersionId,
    );
    const formDefinitionVersion = await this.getPublishedFormVersionOrThrow(
      templateVersion.formDefinitionVersionId,
    );
    // The fields an approver fills in belong to the approval, not the
    // application: an end user's value for one is dropped (it would otherwise
    // be an unreviewed value the approver has to overwrite), while a host
    // calling the service directly may prefill them. They are only shape
    // checked here; required and row minimums wait for the node that fills
    // them. Read off the version the instance is bound to, not the template's
    // latest, so a publish in between cannot change what is stripped.
    const deferredFieldKeys = readApproverFilledFieldKeys(
      templateVersion.workflowDefinition,
    );
    const formData =
      input.endUserSubmission === true
        ? omitFormDataKeys(submittedFormData, deferredFieldKeys)
        : submittedFormData;
    validateSubmittedFormData(formDefinitionVersion.schema, formData, {
      deferredFieldKeys,
    });
    // Checked against the bound version's schema before any data source is
    // called, so a bad value is refused cheaply. The transaction below
    // confirms under the template lock that this version is still current
    // (ADR 25 §15), which is what makes this schema the one in force.
    assertFilterableFormDataValues(formDefinitionVersion.schema, formData);
    const formDataOptionSnapshot = await this.resolveFormDataOptionSnapshots({
      authContext: submitAuthContext,
      formData,
      revalidateAll: true,
      schema: formDefinitionVersion.schema,
    });
    const initiatorMetadataSnapshot = input.initiatorMetadataSnapshotJson
      ? parseJsonObject(
          input.initiatorMetadataSnapshotJson,
          'initiatorMetadataSnapshotJson',
        )
      : await this.buildInitiatorMetadataSnapshot({
          authContext: submitAuthContext,
          memberId: input.initiatorMemberId,
          submission: {
            formData,
            templateId: template.id,
            templateVersionId: templateVersion.id,
          },
        });

    if (
      !this.conditionService.evaluateBoolean(
        templateVersion.initiatorPolicyCel,
        buildInitiatorPolicyContext(initiatorMetadataSnapshot),
        'initiatorPolicyCel',
        // The policy is written in its version's dialect (ADR 22 §3.3).
        readExpressionDialectOptions(
          templateVersion.initiatorPolicyCel,
          templateVersion.workflowDefinition,
        ),
      )
    ) {
      throw new ConflictException(
        'Current member is not allowed to start this approval template',
      );
    }

    // Named here, before the transaction, so the completion notice that later
    // says "由 X 代為送出" reads it from the started activity instead of
    // asking the identity source while an approval holds the instance's locks.
    const submittedByName =
      submittedByMemberId === input.initiatorMemberId
        ? null
        : await this.notificationService.readMemberDisplayName(
            submittedByMemberId,
          );
    const startedAt = new Date();
    const startNode = templateVersion.workflowDefinition.nodes.find(
      (node) => node.type === 'startEvent',
    );

    if (!startNode) {
      throw new BadRequestException(
        'Published workflow does not include a startEvent',
      );
    }

    return this.runEngineTransaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        // ADR 25 §6 and §15: take FOR SHARE on the template row, so a publish,
        // deactivation or edit cannot commit between this point and the
        // insert, then re-check under the lock what was read before it. The
        // filterable check above used the version read then; it holds only
        // while that version is still the current one.
        const lockedTemplate = await manager
          .getRepository(ApprovalTemplateEntity)
          .findOne({
            lock: { mode: 'pessimistic_read' },
            where: { deletedAt: IsNull(), id: template.id },
          });

        if (!lockedTemplate) {
          throw new NotFoundException(
            `Approval template ${template.id} was not found`,
          );
        }

        if (!lockedTemplate.isActive) {
          throw new ConflictException('Approval template is deactivated');
        }

        if (lockedTemplate.currentVersionId !== templateVersion.id) {
          throw new ConflictException(
            '範本在送出期間發布了新版本，這次申請沒有送出；請重新整理頁面後再送出',
          );
        }

        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const tokenRepository = manager.getRepository(WorkflowTokenEntity);
        const activityRepository = manager.getRepository(ActivityLogEntity);
        const instance = await instanceRepository.save(
          instanceRepository.create({
            completedAt: null,
            formData,
            formDataOptionSnapshot,
            formDefinitionSnapshot: {
              formDefinitionVersionId: formDefinitionVersion.id,
              schema: formDefinitionVersion.schema,
              uiSchema: formDefinitionVersion.uiSchema,
              version: formDefinitionVersion.version,
            },
            businessKey,
            initiatorMemberId: input.initiatorMemberId,
            initiatorMetadataSnapshot,
            startedAt,
            state: ApprovalInstanceStateEnum.RUNNING,
            submittedByMemberId,
            templateId: template.id,
            templateVersionId: templateVersion.id,
            title: input.title?.trim() || template.name,
            workflowSnapshot: templateVersion.workflowDefinition,
          }),
        );
        await this.attachmentService.bindFormDataAttachmentsToInstance(
          manager,
          {
            formData,
            instanceId: instance.id,
            schema: formDefinitionVersion.schema,
          },
        );
        const token = await tokenRepository.save(
          tokenRepository.create({
            consumedAt: null,
            currentNodeId: startNode.id,
            instanceId: instance.id,
            parentTokenId: null,
            status: WorkflowTokenStatusEnum.ACTIVE,
          }),
        );

        await activityRepository.save([
          activityRepository.create({
            actorMemberId: input.initiatorMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_STARTED,
            instanceId: instance.id,
            nodeId: startNode.id,
            payload: {
              submittedByMemberId,
              ...(submittedByName === null ? {} : { submittedByName }),
              templateId: template.id,
              templateVersionId: templateVersion.id,
            },
            taskId: null,
          }),
          activityRepository.create({
            actorMemberId: null,
            eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
            instanceId: instance.id,
            nodeId: startNode.id,
            payload: {
              tokenId: token.id,
            },
            taskId: null,
          }),
        ]);
        await this.processRunningInstance(manager, instance);

        return instance;
      },
    ).catch((error: unknown): never =>
      // The insert decides, not a pre-check: two concurrent submits would both
      // pass a check, and only the unique index sees them as one.
      throwBusinessKeyConflictOrRethrow(error, businessKey),
    );
  }

  /**
   * The instance a host submitted for `businessKey` on `templateId`, whatever
   * its state (a cancelled or rejected instance still holds its key), or
   * `null`. The key is trimmed the way submit trims it, so a lookup finds what
   * a submit stored.
   */
  async findApprovalInstanceByBusinessKey(
    templateId: string,
    businessKey: string,
  ): Promise<ApprovalInstanceEntity | null> {
    const normalizedKey = businessKey.trim();

    // A template id that is not a uuid cannot match a row, and handing it to
    // Postgres would raise 22P02 (a 500) instead of "not found".
    if (
      !isUUID(templateId) ||
      normalizedKey === '' ||
      countCodePoints(normalizedKey) > MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH
    ) {
      return null;
    }

    return this.approvalInstanceRepository.findOne({
      where: { businessKey: normalizedKey, templateId },
    });
  }

  private async resolveFormDataOptionSnapshots({
    authContext,
    formData,
    previousFormData,
    previousSnapshots,
    revalidateAll,
    schema,
  }: {
    readonly authContext: BPMAuthContext;
    readonly formData: Readonly<Record<string, unknown>>;
    readonly previousFormData?: Readonly<Record<string, unknown>>;
    readonly previousSnapshots?: FormDataSourceValueSnapshots;
    readonly revalidateAll?: boolean;
    readonly schema: FormDefinitionSchema;
  }): Promise<FormDataSourceValueSnapshots> {
    if (!this.formDataSourceValueResolver) {
      assertNoUnresolvableDynamicValues(schema, formData);

      return previousSnapshots ?? {};
    }

    return this.formDataSourceValueResolver.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      previousFormData,
      previousSnapshots,
      revalidateAll,
      schema,
    });
  }

  private async prepareResubmitFormDataOptions(
    input: ResubmitApprovalInstanceCommand,
    submittedFormData: Readonly<Record<string, unknown>>,
    authContext: BPMAuthContext,
  ): Promise<ResubmitFormDataOptionsPreparation> {
    const instance = await this.approvalInstanceRepository.findOne({
      where: { id: input.instanceId },
    });

    if (!instance) {
      throw new NotFoundException(
        `Approval instance ${input.instanceId} was not found`,
      );
    }

    if (instance.initiatorMemberId !== input.initiatorMemberId) {
      throw new ConflictException(
        `Approval instance ${instance.id} can only be resubmitted by its initiator`,
      );
    }

    if (instance.state !== ApprovalInstanceStateEnum.RETURNED) {
      throw new ConflictException(
        `Approval instance ${instance.id} is not returned`,
      );
    }

    const template = await this.getTemplateOrThrow(instance.templateId);

    if (!template.isActive) {
      throw new ConflictException('Approval template is deactivated');
    }

    const schema = readFormDefinitionSnapshotSchema(
      instance.formDefinitionSnapshot,
    );
    const deferredFieldKeys = readApproverFilledFieldKeys(
      instance.workflowSnapshot,
    );
    // Same overlay as inside the lock, so the options resolved here are for
    // the form data that is actually saved.
    const formData =
      input.endUserSubmission === true
        ? overlayStoredFormDataKeys(
            submittedFormData,
            instance.formData,
            deferredFieldKeys,
          )
        : submittedFormData;
    validateSubmittedFormData(schema, formData, { deferredFieldKeys });
    await this.assertCurrentFilterableFormDataValues(
      instance.templateId,
      formData,
    );
    const formDataOptionSnapshot = await this.resolveFormDataOptionSnapshots({
      authContext,
      formData,
      previousFormData: instance.formData,
      previousSnapshots: instance.formDataOptionSnapshot ?? {},
      schema,
    });

    return { formDataOptionSnapshot, instance };
  }

  async processInstance(instanceId: string): Promise<void> {
    await this.runEngineTransaction(async (manager): Promise<void> => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        instanceId,
      ]);

      const instance = await manager
        .getRepository(ApprovalInstanceEntity)
        .findOne({ where: { id: instanceId } });

      if (!instance) {
        throw new NotFoundException(
          `Approval instance ${instanceId} was not found`,
        );
      }

      await manager.getRepository(ActivityLogEntity).save(
        manager.getRepository(ActivityLogEntity).create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
          instanceId,
          nodeId: null,
          payload: {
            state: instance.state,
          },
          taskId: null,
        }),
      );

      if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
        return;
      }

      await this.processRunningInstance(manager, instance);
    });
  }

  async decideTask(
    input: DecideTaskInput,
    options: DecideTaskOptions = {},
  ): Promise<TaskDecisionEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<TaskDecisionEntity> => {
        const taskRepository = manager.getRepository(TaskEntity);
        const taskCandidateRepository =
          manager.getRepository(TaskCandidateEntity);
        const taskDecisionRepository =
          manager.getRepository(TaskDecisionEntity);
        const activityRepository = manager.getRepository(ActivityLogEntity);
        const tokenRepository = manager.getRepository(WorkflowTokenEntity);
        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const taskBeforeLock = await taskRepository.findOne({
          where: { id: input.taskId },
        });

        if (!taskBeforeLock) {
          throw new NotFoundException(`Task ${input.taskId} was not found`);
        }

        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          taskBeforeLock.instanceId,
        ]);

        // Read again now that the lock is ours: a decision that held it first
        // may have completed this task since the read above, and everything
        // below must judge the task as it is now, not as it was.
        const task = await taskRepository.findOne({
          where: { id: input.taskId },
        });

        if (!task) {
          throw new NotFoundException(`Task ${input.taskId} was not found`);
        }

        if (
          task.status !== TaskStatusEnum.PENDING &&
          task.status !== TaskStatusEnum.IN_PROGRESS
        ) {
          throw new ConflictException(`Task ${task.id} is not pending`);
        }

        const { actorCandidate, taskCandidates } =
          await this.readTaskActorContext(
            manager,
            task,
            input.decidedByMemberId,
          );

        if (
          input.action !== TaskDecisionActionEnum.APPROVED &&
          input.action !== TaskDecisionActionEnum.REJECTED &&
          input.action !== TaskDecisionActionEnum.RETURNED &&
          input.action !== TaskDecisionActionEnum.TRANSFERRED
        ) {
          throw new ConflictException(
            `Task decision action ${input.action} is not supported yet`,
          );
        }
        const decisionComment = input.comment?.trim() || null;

        if (
          input.action === TaskDecisionActionEnum.REJECTED &&
          !decisionComment
        ) {
          throw new BadRequestException('Reject decision comment is required');
        }
        const transferToMemberId = input.transferToMemberId?.trim() || null;

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          !transferToMemberId
        ) {
          throw new BadRequestException('Transfer target member is required');
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          transferToMemberId === input.decidedByMemberId
        ) {
          throw new ConflictException(
            'Transfer target must be a different member',
          );
        }

        // "Sent" means not null and not undefined, so '{}' counts.
        const sentFormDataJson = input.formDataJson ?? null;

        if (
          sentFormDataJson !== null &&
          input.action !== TaskDecisionActionEnum.APPROVED
        ) {
          throw new BadRequestException(
            'formDataJson can only be sent with an APPROVED decision',
          );
        }

        const filledFormData =
          sentFormDataJson === null
            ? null
            : parseJsonObject(sentFormDataJson, 'formDataJson');

        const instance = await instanceRepository.findOne({
          where: { id: task.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${task.instanceId} was not found`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          transferToMemberId !== null &&
          isGroupDecisionPolicy(readDecisionPolicySnapshot(task)) &&
          taskCandidates.some(
            (candidate) =>
              candidate.memberId === transferToMemberId &&
              OPEN_SEAT_STATUSES.includes(candidate.status),
          )
        ) {
          throw new ConflictException(
            'Transfer target already holds an open seat on this task',
          );
        }

        // A member who has decided keeps a COMPLETED row, and the database
        // allows one row per (task, member): moving a seat to them would hit
        // that index instead of answering why. Mirrors TARGET_ALREADY_DECIDED
        // on the administrator reassignment.
        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          transferToMemberId !== null &&
          isGroupDecisionPolicy(readDecisionPolicySnapshot(task)) &&
          taskCandidates.some(
            (candidate) =>
              candidate.memberId === transferToMemberId &&
              candidate.status === TaskCandidateStatusEnum.COMPLETED,
          )
        ) {
          throw new ConflictException(
            'Transfer target has already decided this task',
          );
        }

        if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not running`,
          );
        }

        const taskNode = readWorkflowNodeOrThrow(
          instance.workflowSnapshot,
          task.nodeId,
        );

        if (taskNode.type !== 'userTask') {
          throw new ConflictException(
            `Task ${task.id} is not bound to a user task node`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.REJECTED &&
          taskNode.data.allowReject === false
        ) {
          throw new ForbiddenException(
            `Workflow node ${task.nodeId} does not allow rejection`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          taskNode.data.allowTransfer === false
        ) {
          throw new ForbiddenException(
            `Workflow node ${task.nodeId} does not allow transfer`,
          );
        }

        // Only guards a human picking the target; SLA escalation passes a
        // `transferReason` and is deliberately left alone.
        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          isInitiatorExcluded(taskNode) &&
          transferToMemberId === instance.initiatorMemberId
        ) {
          throw new ConflictException(
            `簽核節點「${taskNode.data.label}」不允許申請人自簽，不能將任務轉交給申請人本人`,
          );
        }

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          isInitiatorExcluded(taskNode) &&
          transferToMemberId !== null &&
          transferToMemberId === readDistinctSubmitterMemberId(instance)
        ) {
          throw new ConflictException(
            `簽核節點「${taskNode.data.label}」不允許代送人簽核，不能將任務轉交給代為送出此單的人`,
          );
        }

        // `excludeNodeActors`: the same carve-out, the same refusal. A human
        // may not hand the seat to someone who signed one of the listed stages.
        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          isNodeActorsExcluded(taskNode) &&
          transferToMemberId !== null &&
          (await this.isExcludedNodeActorTarget(
            manager,
            instance,
            taskNode,
            transferToMemberId,
          ))
        ) {
          throw new ConflictException(
            `簽核節點「${taskNode.data.label}」不允許與前面關卡的簽核者為同一人，不能將任務轉交給前面${readNodeActorNodeNames(instance, readExcludedNodeActorNodeIds(taskNode))}的簽核者`,
          );
        }

        // Same carve-out: a human picking the target on a manager-chain node
        // must pick someone at least as senior as the member being replaced.
        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          options.transferReason === undefined &&
          transferToMemberId !== null &&
          !task.isAdhoc &&
          isOrgManagerChainNode(taskNode)
        ) {
          await this.assertTransferTargetGrade(manager, {
            actorMemberId: input.decidedByMemberId,
            delegationChain:
              actorCandidate?.delegationChain ?? task.delegationChain,
            label: taskNode.data.label,
            targetMemberId: transferToMemberId,
          });
        }

        const returnToNodeId =
          input.action === TaskDecisionActionEnum.RETURNED
            ? readReturnTargetNodeId(
                instance.workflowSnapshot,
                task.nodeId,
                input.returnToNodeId,
              )
            : null;

        // Read from the instance snapshot, not the live template: templates
        // that turn `requireComment` on later must not retroactively block
        // in-flight instances started against the previous version.
        if (
          input.action === TaskDecisionActionEnum.RETURNED &&
          !decisionComment &&
          isReturnCommentRequired(instance.workflowSnapshot, task.nodeId)
        ) {
          throw new BadRequestException(
            '此節點要求退回時填寫意見，請輸入意見後再退回。',
          );
        }

        // Same snapshot rule as the return check above. Only a person's
        // approval is held to it: an engine-made approval (the SLA
        // `AUTO_APPROVE` timeout) carries `options.automatic` and must never
        // stall waiting for a comment nobody is there to write. A person's
        // approval of an ad-hoc task counts too: it runs on the main node.
        if (
          input.action === TaskDecisionActionEnum.APPROVED &&
          options.automatic === undefined &&
          !decisionComment &&
          taskNode.data.requireApprovalComment === true
        ) {
          throw new BadRequestException(
            '此節點要求同意時填寫意見，請輸入意見後再同意。',
          );
        }

        if (filledFormData !== null && task.isAdhoc) {
          throw new ForbiddenException(
            `Ad-hoc task ${task.id} cannot fill in form fields`,
          );
        }

        if (filledFormData !== null) {
          const fillableFieldKeys = readNodeFillableFieldKeys(taskNode);
          const refusedFieldKeys = Object.keys(filledFormData).filter(
            (fieldKey) => !fillableFieldKeys.has(fieldKey),
          );

          if (refusedFieldKeys.length > 0) {
            throw new ForbiddenException(
              `Workflow node ${task.nodeId} does not let approvers fill in: ${refusedFieldKeys.join(', ')}`,
            );
          }
        }

        const expectedFormDataFingerprint =
          input.expectedFormDataFingerprint ?? null;

        if (
          expectedFormDataFingerprint !== null &&
          expectedFormDataFingerprint !==
            computeFormDataFingerprint(instance.formData)
        ) {
          throw new ConflictException(
            `Approval instance ${instance.id} form data changed; refresh and retry`,
          );
        }

        // Only keys whose value really changes are written and reported. A key
        // the form data does not have yet counts as changed even when the new
        // value is null.
        const changedFieldKeys =
          filledFormData === null
            ? []
            : Object.keys(filledFormData)
                .filter(
                  (fieldKey) =>
                    !Object.prototype.hasOwnProperty.call(
                      instance.formData,
                      fieldKey,
                    ) ||
                    computeStableValueFingerprint(filledFormData[fieldKey]) !==
                      computeStableValueFingerprint(
                        instance.formData[fieldKey],
                      ),
                )
                .sort();

        const mergedFormData = { ...instance.formData, ...filledFormData };

        // Every approval at a node that lets its approver fill in fields is
        // held to those fields, whether or not this request sent any: the host
        // may have pre-filled a table the approver then leaves as is.
        if (input.action === TaskDecisionActionEnum.APPROVED && !task.isAdhoc) {
          const nodeFillableFieldKeys = readNodeFillableFieldKeys(taskNode);

          if (nodeFillableFieldKeys.size > 0) {
            validateFilledFormFields(
              readFormDefinitionSnapshotSchema(instance.formDefinitionSnapshot),
              mergedFormData,
              nodeFillableFieldKeys,
              readNodeRequiredFieldKeys(taskNode),
            );
          }
        }

        if (filledFormData !== null && changedFieldKeys.length > 0) {
          await this.assertCurrentFilterableFormDataValues(
            instance.templateId,
            mergedFormData,
            manager,
          );

          // Merged into the shared `instance` before it is signed and before
          // the token moves on: the signature must cover the filled values, a
          // gateway after this node must route on them, and an end node saves
          // this same object, which would write the old values back.
          const savedInstance = await instanceRepository.save({
            ...instance,
            formData: mergedFormData,
          });

          Object.assign(instance, savedInstance);
        }

        const decidedAt = new Date();
        const claimedTask = await taskRepository.save({
          ...task,
          assigneeMemberId: task.assigneeMemberId ?? input.decidedByMemberId,
          openedAt: task.openedAt ?? decidedAt,
          originalAssigneeMemberId:
            task.originalAssigneeMemberId ??
            actorCandidate?.originalMemberId ??
            input.decidedByMemberId,
          status: TaskStatusEnum.IN_PROGRESS,
        });
        const claimedCandidate = actorCandidate
          ? await taskCandidateRepository.save({
              ...actorCandidate,
              claimedAt: actorCandidate.claimedAt ?? decidedAt,
              status: TaskCandidateStatusEnum.CLAIMED,
            })
          : null;
        const signature = await this.signatureService.signTaskDecision(
          manager,
          {
            action: input.action,
            comment: decisionComment,
            decidedAt,
            instance,
            returnToNodeId,
            signerMemberId: input.decidedByMemberId,
            task: claimedTask,
            transferToMemberId,
          },
        );
        const decision = await taskDecisionRepository.save(
          taskDecisionRepository.create({
            action: input.action,
            comment: decisionComment,
            decidedAt,
            decidedByMemberId: input.decidedByMemberId,
            returnToNodeId,
            signatureId: signature.id,
            taskId: task.id,
            transferToMemberId,
          }),
        );

        if (
          input.action === TaskDecisionActionEnum.TRANSFERRED &&
          transferToMemberId !== null &&
          isGroupDecisionPolicy(readDecisionPolicySnapshot(claimedTask))
        ) {
          await this.transferGroupSeat(manager, {
            actorCandidate: claimedCandidate,
            decidedAt,
            decision,
            instance,
            node: taskNode,
            reusableRow:
              taskCandidates.find(
                (candidate) =>
                  candidate.memberId === transferToMemberId &&
                  REUSABLE_SEAT_STATUSES.includes(candidate.status),
              ) ?? null,
            signature,
            task: claimedTask,
            taskBeforeClaim: task,
            toMemberId: transferToMemberId,
            transferReason:
              options.transferReason ?? MANUAL_TRANSFER_DELEGATION_REASON,
          });

          return decision;
        }

        if (input.action === TaskDecisionActionEnum.TRANSFERRED) {
          await this.transferTask(
            manager,
            instance,
            claimedTask,
            decision,
            signature,
            transferToMemberId,
            decisionComment,
            decidedAt,
            claimedCandidate,
            options.transferReason ?? MANUAL_TRANSFER_DELEGATION_REASON,
          );

          await this.notificationService.resolveTaskNotifications({
            actingMemberId: input.decidedByMemberId,
            manager,
            resolution: NotificationResolutionEnum.TRANSFERRED,
            supersedeOthers: true,
            taskId: claimedTask.id,
          });

          return decision;
        }

        const nextCandidateRows = await this.markTaskCandidateDecision({
          action: input.action,
          candidate: claimedCandidate,
          candidates: taskCandidates,
          decidedAt,
          manager,
          task: claimedTask,
        });
        const shouldCompleteTask = shouldCompleteTaskAfterDecision({
          action: input.action,
          candidates: nextCandidateRows,
          decisionPolicy: readDecisionPolicySnapshot(claimedTask),
        });
        const completedTask = shouldCompleteTask
          ? await taskRepository.save({
              ...claimedTask,
              completedAt: decidedAt,
              status: TaskStatusEnum.COMPLETED,
            })
          : await taskRepository.save({
              ...claimedTask,
              status: TaskStatusEnum.IN_PROGRESS,
            });

        await activityRepository.save(
          activityRepository.create({
            actorMemberId: input.decidedByMemberId,
            eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
            instanceId: instance.id,
            nodeId: claimedTask.nodeId,
            payload: {
              action: input.action,
              comment: decisionComment,
              decisionId: decision.id,
              signatureId: signature.id,
              signedPayloadHash: signature.signedPayloadHash,
              // Absent for a person's decision, so "who actually signed" can
              // tell the engine's own timeout approvals apart.
              ...(options.automatic ? { automatic: options.automatic } : {}),
              // Keys only: this payload is forwarded to hosts, and the values
              // can be tax IDs or amounts.
              ...(changedFieldKeys.length > 0 ? { changedFieldKeys } : {}),
            },
            taskId: completedTask.id,
          }),
        );

        // Resolve the recipient's "待簽" notification so its inline 同意/拒絕
        // actions disappear once the task is decided. When the task has ended
        // (rejected / returned, or an approval that completed it), every other
        // candidate's notification is superseded too; a non-completing approval
        // on a multi-approver task leaves the remaining approvers' open.
        const taskEnded =
          input.action !== TaskDecisionActionEnum.APPROVED ||
          shouldCompleteTask;

        await this.notificationService.resolveTaskNotifications({
          actingMemberId: input.decidedByMemberId,
          manager,
          resolution: mapDecisionToResolution(input.action),
          supersedeOthers: taskEnded,
          taskId: completedTask.id,
        });

        if (
          input.action === TaskDecisionActionEnum.APPROVED &&
          !shouldCompleteTask
        ) {
          await this.activateNextSequentialCandidate({
            candidates: nextCandidateRows,
            instance,
            manager,
            node: taskNode,
            previousMemberId: input.decidedByMemberId,
            task: completedTask,
          });
        }

        if (
          input.action === TaskDecisionActionEnum.APPROVED &&
          shouldCompleteTask
        ) {
          // Ad-hoc gate: the token may only advance once every task bound to
          // this token+node (the original task plus any ad-hoc countersign /
          // pre-approval tasks) has reached a terminal state. Nodes without
          // ad-hoc tasks keep the original single-task behaviour.
          if (
            await this.hasOpenTasksForTokenNode(
              manager,
              claimedTask.tokenId,
              claimedTask.nodeId,
            )
          ) {
            return decision;
          }

          const token = await tokenRepository.findOne({
            where: { id: claimedTask.tokenId },
          });

          if (!token) {
            throw new NotFoundException(
              `Workflow token ${claimedTask.tokenId} was not found`,
            );
          }

          if (token.status !== WorkflowTokenStatusEnum.WAITING) {
            throw new ConflictException(
              `Workflow token ${token.id} is not waiting for a task decision`,
            );
          }

          const activeToken = await tokenRepository.save({
            ...token,
            consumedAt: null,
            status: WorkflowTokenStatusEnum.ACTIVE,
          });

          await this.dispatchAdhocStageNotifications(
            manager,
            instance,
            claimedTask.nodeId,
            'APPROVED',
          );
          await this.advanceTokenToOutgoingNodes(
            manager,
            instance,
            activeToken,
            readWorkflowNodeOrThrow(
              instance.workflowSnapshot,
              claimedTask.nodeId,
            ),
          );
          await this.processRunningInstance(manager, instance);

          return decision;
        }

        if (input.action === TaskDecisionActionEnum.APPROVED) {
          return decision;
        }

        if (input.action === TaskDecisionActionEnum.RETURNED) {
          await this.returnInstanceToNode(
            manager,
            instance,
            completedTask,
            returnToNodeId,
            decidedAt,
          );

          return decision;
        }

        if (
          await this.handleAdhocPreApprovalRejection(
            manager,
            instance,
            completedTask,
            decidedAt,
            decisionComment,
          )
        ) {
          return decision;
        }

        await this.rejectInstance(manager, instance, completedTask, decidedAt);

        return decision;
      },
    );
  }

  async cancelApprovalInstance(
    input: CancelApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          input.instanceId,
        ]);

        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const instance = await instanceRepository.findOne({
          where: { id: input.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${input.instanceId} was not found`,
          );
        }

        if (instance.initiatorMemberId !== input.cancelledByMemberId) {
          throw new ConflictException(
            `Approval instance ${instance.id} can only be cancelled by its initiator`,
          );
        }

        if (
          instance.state !== ApprovalInstanceStateEnum.RUNNING &&
          instance.state !== ApprovalInstanceStateEnum.RETURNED
        ) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not cancellable`,
          );
        }

        const cancelledInstance = await this.closeInstance(
          manager,
          instance,
          ApprovalInstanceStateEnum.CANCELLED,
        );

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: input.cancelledByMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_CANCELLED,
            instanceId: instance.id,
            nodeId: null,
            payload: {
              comment: input.comment?.trim() || null,
            },
            taskId: null,
          }),
        );

        return cancelledInstance;
      },
    );
  }

  /**
   * Ends a running or returned instance because a task on it ran past its SLA
   * with `onTimeout: 'TERMINATE_INSTANCE'`. It closes the instance exactly as
   * a cancellation does, but lands in `EXPIRED` and is recorded with no actor:
   * nobody chose to end it. An instance that is already closed — another
   * overdue task of it got here first, or someone decided it meanwhile — is
   * returned unchanged.
   */
  async expireApprovalInstance(
    input: ExpireApprovalInstanceCommand,
  ): Promise<ApprovalInstanceEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          input.instanceId,
        ]);

        const instance = await manager
          .getRepository(ApprovalInstanceEntity)
          .findOne({ where: { id: input.instanceId } });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${input.instanceId} was not found`,
          );
        }

        if (
          instance.state !== ApprovalInstanceStateEnum.RUNNING &&
          instance.state !== ApprovalInstanceStateEnum.RETURNED
        ) {
          return instance;
        }

        const expiredInstance = await this.closeInstance(
          manager,
          instance,
          ApprovalInstanceStateEnum.EXPIRED,
        );

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: null,
            eventType: ActivityLogEventTypeEnum.INSTANCE_EXPIRED,
            instanceId: instance.id,
            nodeId: input.nodeId ?? null,
            payload: {
              comment: input.comment?.trim() || null,
            },
            taskId: input.taskId ?? null,
          }),
        );

        return expiredInstance;
      },
    );
  }

  // Shared ending of a cancellation and an SLA expiry: everything open on the
  // instance is closed, its task notifications are superseded, ad-hoc
  // completion notices go out with the final state, and what is still pending
  // is dropped. The caller records who (if anyone) ended it.
  private async closeInstance(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    finalState:
      ApprovalInstanceStateEnum.CANCELLED | ApprovalInstanceStateEnum.EXPIRED,
  ): Promise<ApprovalInstanceEntity> {
    const closedAt = new Date();

    await this.consumeOpenRuntimeState(
      manager,
      instance,
      closedAt,
      TaskStatusEnum.CANCELLED,
    );
    await this.notificationService.supersedeInstanceTaskNotifications({
      instanceId: instance.id,
      manager,
    });
    // Same prototype-preserving reason as `cancelAdhocDirective`: this
    // entity is returned to the resolver and `ApprovalInstance` exposes
    // five getter-backed JSON fields.
    const closedInstance = await manager
      .getRepository(ApprovalInstanceEntity)
      .save(
        Object.assign(new ApprovalInstanceEntity(), instance, {
          completedAt: closedAt,
          state: finalState,
        }),
      );

    await this.dispatchAdhocCompletionNotifications(
      manager,
      closedInstance,
      finalState,
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, null);

    return closedInstance;
  }

  async resubmitApprovalInstance(
    input: ResubmitApprovalInstanceCommand,
    authContext?: BPMAuthContext,
  ): Promise<ApprovalInstanceEntity> {
    const submittedFormData = parseJsonObject(
      input.formDataJson,
      'formDataJson',
    );
    const preparation = this.formDataSourceValueResolver
      ? await this.prepareResubmitFormDataOptions(
          input,
          submittedFormData,
          authContext ?? createWorkflowAuthContext(input.initiatorMemberId),
        )
      : null;

    return this.runEngineTransaction(
      async (manager): Promise<ApprovalInstanceEntity> => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          input.instanceId,
        ]);

        const instanceRepository = manager.getRepository(
          ApprovalInstanceEntity,
        );
        const instance = await instanceRepository.findOne({
          where: { id: input.instanceId },
        });

        if (!instance) {
          throw new NotFoundException(
            `Approval instance ${input.instanceId} was not found`,
          );
        }

        if (instance.initiatorMemberId !== input.initiatorMemberId) {
          throw new ConflictException(
            `Approval instance ${instance.id} can only be resubmitted by its initiator`,
          );
        }

        if (instance.state !== ApprovalInstanceStateEnum.RETURNED) {
          throw new ConflictException(
            `Approval instance ${instance.id} is not returned`,
          );
        }

        const template = await this.getTemplateOrThrow(instance.templateId);

        if (!template.isActive) {
          throw new ConflictException('Approval template is deactivated');
        }

        if (
          preparation &&
          !isSameApprovalInstanceRevision(preparation.instance, instance)
        ) {
          throw new ConflictException(
            'Approval instance changed while options were resolving; refresh and retry',
          );
        }

        const resubmitSchema = readFormDefinitionSnapshotSchema(
          instance.formDefinitionSnapshot,
        );
        const deferredFieldKeys = readApproverFilledFieldKeys(
          instance.workflowSnapshot,
        );
        // An end user gets back the value an approver already filled in, and
        // loses a key the stored data never had: the renderer seeds `false`,
        // `[]` and empty rows for every field, none of which an approver wrote.
        const formData =
          input.endUserSubmission === true
            ? overlayStoredFormDataKeys(
                submittedFormData,
                instance.formData,
                deferredFieldKeys,
              )
            : submittedFormData;
        validateSubmittedFormData(resubmitSchema, formData, {
          deferredFieldKeys,
        });
        await this.assertCurrentFilterableFormDataValues(
          instance.templateId,
          formData,
          manager,
        );

        if (!preparation) {
          assertNoUnresolvableDynamicValues(resubmitSchema, formData);
        }

        const resubmittedInstance = await instanceRepository.save({
          ...instance,
          completedAt: null,
          formData,
          formDataOptionSnapshot:
            preparation?.formDataOptionSnapshot ??
            // Without a resolver every remaining dynamic value was rejected
            // above, so only cleared fields can reach here — drop their
            // snapshots instead of keeping a label for a value that is gone.
            readSnapshotForPresentValues(
              resubmitSchema,
              formData,
              instance.formDataOptionSnapshot,
            ),
          state: ApprovalInstanceStateEnum.RUNNING,
          title: input.title?.trim() || instance.title,
        });
        await this.attachmentService.bindFormDataAttachmentsToInstance(
          manager,
          {
            formData,
            instanceId: instance.id,
            schema: resubmitSchema,
          },
        );
        // A file the applicant removed from a field leaves the instance too,
        // so its attachment list matches the form it was resubmitted with.
        await this.attachmentService.releaseUnreferencedFormAttachments(
          manager,
          {
            formData,
            instanceId: instance.id,
            schema: resubmitSchema,
          },
        );
        const returnedContext = await this.readLatestReturnedInstanceContext(
          manager,
          instance.id,
        );
        const runtimeInstance =
          returnedContext?.resubmitStrategy === 'FROM_RETURN_POINT'
            ? await this.resumeReturnedInstanceFromReturnPoint(
                manager,
                resubmittedInstance,
                returnedContext,
                new Date(),
              )
            : resubmittedInstance;

        await manager.getRepository(ActivityLogEntity).save(
          manager.getRepository(ActivityLogEntity).create({
            actorMemberId: input.initiatorMemberId,
            eventType: ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
            instanceId: instance.id,
            nodeId: null,
            payload: {
              comment: input.comment?.trim() || null,
              resubmitStrategy: returnedContext?.resubmitStrategy ?? 'RESTART',
            },
            taskId: null,
          }),
        );
        await this.processRunningInstance(manager, runtimeInstance);

        const refreshedInstance = await instanceRepository.findOne({
          where: { id: instance.id },
        });

        if (!refreshedInstance) {
          throw new NotFoundException(
            `Approval instance ${instance.id} was not found after resubmit`,
          );
        }

        return refreshedInstance;
      },
    );
  }

  async requestAdhocCountersign({
    comment,
    requestedByMemberId,
    target,
    taskId,
  }: {
    readonly comment?: string | null;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
  }): Promise<AdhocDirectiveEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const { instance, node, task } = await this.loadAdhocOperationContext(
          manager,
          taskId,
          requestedByMemberId,
          { requireAllowAddSigner: true },
        );
        const targetValue = buildAdhocTargetValue(target);

        // Rejects WEBHOOK targets — countersigners must be members.
        buildAdhocApproverResolver(targetValue);

        // The countersign task is only created when a later user task is
        // reached, against that node's own setting. This checks the target
        // against the node being decided now, as an early rejection for the
        // common case; it is not a guarantee about the node it attaches to.
        if (hasSeatExclusion(node)) {
          await this.resolveAdhocTaskCandidates(
            manager,
            instance,
            node,
            '臨時會簽',
            targetValue,
          );
        }

        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.save(
          directiveRepository.create({
            channels: null,
            comment: comment?.trim() || null,
            consumedAt: null,
            createdByMemberId: requestedByMemberId,
            instanceId: instance.id,
            onReject: null,
            originNodeId: task.nodeId,
            originTaskId: task.id,
            status: AdhocDirectiveStatusEnum.PENDING,
            targetKind: targetValue.kind,
            targetValue: { ...targetValue },
            type: AdhocDirectiveTypeEnum.COUNTERSIGN,
          }),
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          directive,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
          requestedByMemberId,
          { nodeLabel: node.data.label },
        );

        return directive;
      },
    );
  }

  async requestAdhocPreApproval({
    comment,
    onReject,
    requestedByMemberId,
    target,
    taskId,
  }: {
    readonly comment?: string | null;
    readonly onReject: AdhocPreApprovalRejectBehaviorEnum;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
  }): Promise<TaskEntity> {
    return this.runEngineTransaction(async (manager): Promise<TaskEntity> => {
      const { instance, node, task } = await this.loadAdhocOperationContext(
        manager,
        taskId,
        requestedByMemberId,
        { requireAllowAddSigner: true },
      );
      const targetValue = buildAdhocTargetValue(target);

      // Rejects WEBHOOK targets — pre-approvers must be members.
      buildAdhocApproverResolver(targetValue);

      const now = new Date();
      const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
      const directive = await directiveRepository.save(
        directiveRepository.create({
          channels: null,
          comment: comment?.trim() || null,
          consumedAt: now,
          createdByMemberId: requestedByMemberId,
          instanceId: instance.id,
          onReject,
          originNodeId: task.nodeId,
          originTaskId: task.id,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          targetKind: targetValue.kind,
          targetValue: { ...targetValue },
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      );
      const adhocTask = await this.createAdhocTaskForDirective(
        manager,
        instance,
        task.tokenId,
        node,
        directive,
        now,
      );

      await this.recordAdhocDirectiveActivity(
        manager,
        directive,
        ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
        requestedByMemberId,
        { adhocTaskId: adhocTask.id, nodeLabel: node.data.label, onReject },
      );

      return adhocTask;
    });
  }

  async configureAdhocNotification({
    channels,
    requestedByMemberId,
    target,
    taskId,
    type,
  }: {
    readonly channels?: readonly NotificationChannelEnum[] | null;
    readonly requestedByMemberId: string;
    readonly target: AdhocTargetInput;
    readonly taskId: string;
    readonly type:
      | AdhocDirectiveTypeEnum.COMPLETION_NOTIFY
      | AdhocDirectiveTypeEnum.STAGE_NOTIFY;
  }): Promise<AdhocDirectiveEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const { instance, node, task } = await this.loadAdhocOperationContext(
          manager,
          taskId,
          requestedByMemberId,
          { requireAllowAddSigner: false },
        );
        const targetValue = buildAdhocTargetValue(target);
        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.save(
          directiveRepository.create({
            channels: channels?.length ? [...channels] : null,
            comment: null,
            consumedAt: null,
            createdByMemberId: requestedByMemberId,
            instanceId: instance.id,
            onReject: null,
            originNodeId: task.nodeId,
            originTaskId: task.id,
            status: AdhocDirectiveStatusEnum.PENDING,
            targetKind: targetValue.kind,
            targetValue: { ...targetValue },
            type,
          }),
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          directive,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CREATED,
          requestedByMemberId,
          { nodeLabel: node.data.label },
        );

        return directive;
      },
    );
  }

  async cancelAdhocDirective({
    cancelledByMemberId,
    directiveId,
  }: {
    readonly cancelledByMemberId: string;
    readonly directiveId: string;
  }): Promise<AdhocDirectiveEntity> {
    return this.runEngineTransaction(
      async (manager): Promise<AdhocDirectiveEntity> => {
        const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
        const directive = await directiveRepository.findOne({
          where: { id: directiveId },
        });

        if (!directive) {
          throw new NotFoundException(
            `Ad-hoc directive ${directiveId} was not found`,
          );
        }

        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          directive.instanceId,
        ]);

        if (directive.createdByMemberId !== cancelledByMemberId) {
          throw new ConflictException(
            `Ad-hoc directive ${directive.id} can only be cancelled by its creator`,
          );
        }

        if (directive.status !== AdhocDirectiveStatusEnum.PENDING) {
          throw new ConflictException(
            `Ad-hoc directive ${directive.id} is not pending`,
          );
        }

        // Assigning onto a fresh entity keeps the prototype, so the row handed
        // back to the resolver still carries the getters the GraphQL schema
        // exposes (e.g. `targetValueJson`). Spreading it into a plain object
        // drops them, and the mutation then fails with an opaque
        // INTERNAL_SERVER_ERROR *after* the cancellation has been committed.
        const cancelledDirective = await directiveRepository.save(
          Object.assign(new AdhocDirectiveEntity(), directive, {
            status: AdhocDirectiveStatusEnum.CANCELLED,
          }),
        );

        await this.recordAdhocDirectiveActivity(
          manager,
          cancelledDirective,
          ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CANCELLED,
          cancelledByMemberId,
        );

        return cancelledDirective;
      },
    );
  }

  async listAdhocDirectives(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly AdhocDirectiveEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.adhocDirectiveRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  private async readTaskActorContext(
    manager: EntityManager,
    task: TaskEntity,
    actingMemberId: string,
  ): Promise<{
    readonly actorCandidate: TaskCandidateEntity | null;
    readonly taskCandidates: readonly TaskCandidateEntity[];
  }> {
    const taskCandidates = await manager
      .getRepository(TaskCandidateEntity)
      .find({ where: { taskId: task.id } });
    const actorCandidate =
      taskCandidates.find(
        (candidate) => candidate.memberId === actingMemberId,
      ) ?? null;
    const isDirectAssignee = task.assigneeMemberId === actingMemberId;

    if (!isDirectAssignee && !actorCandidate) {
      throw new ConflictException(
        `Task ${task.id} is assigned to another member`,
      );
    }

    if (actorCandidate?.status === TaskCandidateStatusEnum.WAITING) {
      throw new ConflictException(
        `Task ${task.id} is not this member's turn yet`,
      );
    }

    if (
      actorCandidate &&
      actorCandidate.status !== TaskCandidateStatusEnum.PENDING &&
      actorCandidate.status !== TaskCandidateStatusEnum.CLAIMED
    ) {
      throw new ConflictException(
        `Task ${task.id} was already decided by this member`,
      );
    }

    return { actorCandidate, taskCandidates };
  }

  private async loadAdhocOperationContext(
    manager: EntityManager,
    taskId: string,
    actingMemberId: string,
    options: { readonly requireAllowAddSigner: boolean },
  ): Promise<AdhocOperationContext> {
    const task = await manager
      .getRepository(TaskEntity)
      .findOne({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      task.instanceId,
    ]);

    if (
      task.status !== TaskStatusEnum.PENDING &&
      task.status !== TaskStatusEnum.IN_PROGRESS
    ) {
      throw new ConflictException(`Task ${task.id} is not pending`);
    }

    await this.readTaskActorContext(manager, task, actingMemberId);

    const instance = await manager
      .getRepository(ApprovalInstanceEntity)
      .findOne({ where: { id: task.instanceId } });

    if (!instance) {
      throw new NotFoundException(
        `Approval instance ${task.instanceId} was not found`,
      );
    }

    if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
      throw new ConflictException(
        `Approval instance ${instance.id} is not running`,
      );
    }

    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      task.nodeId,
    );

    if (node.type !== 'userTask') {
      throw new ConflictException(
        `Task ${task.id} is not bound to a user task node`,
      );
    }

    if (options.requireAllowAddSigner && !node.data.allowAddSigner) {
      throw new ForbiddenException(
        `簽核節點「${node.data.label}」does not allow ad-hoc signers`,
      );
    }

    return { instance, node, task };
  }

  private async recordAdhocDirectiveActivity(
    manager: EntityManager,
    directive: AdhocDirectiveEntity,
    eventType: ActivityLogEventTypeEnum,
    actorMemberId: string | null,
    extraPayload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await activityRepository.save(
      activityRepository.create({
        actorMemberId,
        eventType,
        instanceId: directive.instanceId,
        nodeId: directive.originNodeId,
        payload: {
          ...extraPayload,
          directiveId: directive.id,
          directiveStatus: directive.status,
          directiveType: directive.type,
          targetKind: directive.targetKind,
        },
        taskId: directive.originTaskId,
      }),
    );
  }

  private async createAdhocTaskForDirective(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    tokenId: string,
    node: UserTaskNode,
    directive: AdhocDirectiveEntity,
    now: Date,
  ): Promise<TaskEntity> {
    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const label =
      directive.type === AdhocDirectiveTypeEnum.COUNTERSIGN
        ? '臨時會簽'
        : '臨時加簽';
    const candidates = await this.resolveAdhocTaskCandidates(
      manager,
      instance,
      node,
      label,
      readAdhocTargetValue(directive),
    );
    const primaryCandidate = candidates[0];
    const task = await taskRepository.save(
      taskRepository.create({
        adhocDirectiveId: directive.id,
        adhocOriginTaskId: directive.originTaskId,
        adhocType: directive.type,
        assigneeMemberId:
          candidates.length === 1 ? primaryCandidate.memberId : null,
        assignmentType:
          candidates.length === 1
            ? TaskAssignmentTypeEnum.DIRECT_MEMBER
            : TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        completedAt: null,
        createdAt: now,
        // One resolved person is `SINGLE`, which is what this has always been.
        // Several mean a countersign in the sense the UI promises — 下一層需
        // 所有人都完成才會繼續 — so every candidate has to decide before the
        // task closes. Until now a multi-person target produced a single
        // `SINGLE` task, and whoever opened it first decided for the whole
        // group while the task vanished from everybody else's inbox.
        // Rejection is unaffected: `shouldCompleteTaskAfterDecision` closes
        // the task on any non-approval whatever the policy, and that rejection
        // then rejects the instance.
        decisionPolicySnapshot:
          candidates.length === 1
            ? { type: 'SINGLE' }
            : { type: 'PARALLEL_ALL' },
        delegationChain:
          candidates.length === 1 ? primaryCandidate.delegationChain : [],
        instanceId: instance.id,
        isAdhoc: true,
        nodeId: node.id,
        openedAt: null,
        originalAssigneeMemberId:
          candidates.length === 1 ? primaryCandidate.originalMemberId : null,
        slaDueAt: null,
        status: TaskStatusEnum.PENDING,
        tokenId,
      }),
    );
    const savedCandidates = await taskCandidateRepository.save(
      candidates.map((candidate) =>
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: now,
          decidedAt: null,
          delegationChain: candidate.delegationChain,
          memberId: candidate.memberId,
          originalMemberId: candidate.originalMemberId,
          sourceType: candidate.sourceType,
          status: TaskCandidateStatusEnum.PENDING,
          taskId: task.id,
        }),
      ),
    );
    task.candidateMemberIds = savedCandidates.map(
      (candidate) => candidate.memberId,
    );
    task.openCandidateMemberIds = task.candidateMemberIds;
    task.nodeLabel = readWorkflowNodeLabel(instance.workflowSnapshot, node.id);

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: directive.createdByMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          adhocDirectiveId: directive.id,
          adhocType: directive.type,
          assigneeMemberId: task.assigneeMemberId,
          assignmentType: task.assignmentType,
          candidateMemberIds: savedCandidates.map(
            (candidate) => candidate.memberId,
          ),
          originTaskId: directive.originTaskId,
          tokenId,
        },
        taskId: task.id,
      }),
    );
    await savedCandidates.reduce<Promise<void>>(
      async (previous, candidate): Promise<void> => {
        await previous;
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: Object.assign(new TaskEntity(), task, {
            assigneeMemberId: candidate.memberId,
            delegationChain: candidate.delegationChain,
            originalAssigneeMemberId: candidate.originalMemberId,
          }),
        });
      },
      Promise.resolve(),
    );

    return task;
  }

  private async resolveAdhocTaskCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
    label: string,
    targetValue: AdhocTargetValue,
  ): Promise<readonly RuntimeTaskCandidate[]> {
    const exclusions = await this.readNodeExclusions(manager, instance, node);
    const resolvedCandidates = await this.resolveApproverResolver(
      manager,
      instance,
      buildAdhocApproverResolver(targetValue),
      `${label}「${node.data.label}」`,
      '簽核人',
      exclusions.memberIds,
    );
    // Ad-hoc approvers are picked by a person, not walked up a manager chain,
    // so the chain's grade rule does not apply to them.
    const delegatedCandidates = await this.delegateResolvedCandidates(
      manager,
      instance,
      node.id,
      resolvedCandidates,
      false,
    );
    const candidates = selectNodeCandidates(
      delegatedCandidates,
      hasSeatExclusion(node),
      exclusions.memberIds,
    );

    if (candidates.length > 0) {
      return candidates;
    }

    if (delegatedCandidates.length === 0) {
      throw new ConflictException(
        `${label}「${node.data.label}」 did not resolve to any member id`,
      );
    }

    // The initiator rule runs first: only when it alone left somebody is the
    // earlier-stage rule the one that emptied the list.
    throw new ConflictException(
      isEmptiedByInitiatorRule(node, delegatedCandidates, exclusions)
        ? readDistinctSubmitterMemberId(instance) === null
          ? `${label}「${node.data.label}」 無法建立任務：指定對象只有申請人本人，此節點不允許申請人簽核。`
          : `${label}「${node.data.label}」 無法建立任務：指定對象只有申請人或代為送出此單的人，此節點不允許申請人或代送人簽核。`
        : `${label}「${node.data.label}」 無法建立任務：指定對象只有前面${readNodeActorNodeNames(instance, readExcludedNodeActorNodeIds(node))}的簽核者，此節點不允許與前面關卡的簽核者為同一人。`,
    );
  }

  private async spawnCountersignTasksForNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: UserTaskNode,
    now: Date,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.COUNTERSIGN,
      },
    });

    if (directives.length === 0) {
      return;
    }

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;

        try {
          await this.createAdhocTaskForDirective(
            manager,
            instance,
            token.id,
            node,
            directive,
            now,
          );
          await directiveRepository.save({
            ...directive,
            consumedAt: now,
            status: AdhocDirectiveStatusEnum.CONSUMED,
          });
        } catch (error: unknown) {
          // A countersign target that no longer resolves must not block the
          // main flow — cancel the directive and record the failure.
          await directiveRepository.save({
            ...directive,
            status: AdhocDirectiveStatusEnum.CANCELLED,
          });
          await this.recordAdhocDirectiveActivity(
            manager,
            directive,
            ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CANCELLED,
            null,
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Countersign target resolution failed',
            },
          );
        }
      },
      Promise.resolve(),
    );
  }

  private async hasOpenTasksForTokenNode(
    manager: EntityManager,
    tokenId: string,
    nodeId: string,
  ): Promise<boolean> {
    const tasks = await manager.getRepository(TaskEntity).find({
      where: { nodeId, tokenId },
    });

    return tasks.some(
      (task) =>
        task.tokenId === tokenId &&
        task.nodeId === nodeId &&
        (task.status === TaskStatusEnum.PENDING ||
          task.status === TaskStatusEnum.IN_PROGRESS),
    );
  }

  private async handleAdhocPreApprovalRejection(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    decidedAt: Date,
    decisionComment: string | null,
  ): Promise<boolean> {
    if (
      !task.isAdhoc ||
      task.adhocType !== AdhocDirectiveTypeEnum.PRE_APPROVAL ||
      !task.adhocDirectiveId
    ) {
      return false;
    }

    const directive = await manager
      .getRepository(AdhocDirectiveEntity)
      .findOne({ where: { id: task.adhocDirectiveId } });

    if (
      directive?.onReject !==
      AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN
    ) {
      return false;
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const adhocOriginTask = task.adhocOriginTaskId
      ? await taskRepository.findOne({ where: { id: task.adhocOriginTaskId } })
      : null;
    // transferTask re-points an open pre-approval when its origin is
    // transferred, but a pre-approval whose origin was transferred by a release
    // that did not do that yet still points at the TRANSFERRED row, and so does
    // the pointer on `task` when a transfer commits after decideTask read it
    // and before it took the instance lock. Following the transfer here hands
    // the decision to whoever holds the stage now in both cases.
    const originTask = adhocOriginTask
      ? await this.readTransferSuccessorTask(manager, adhocOriginTask)
      : null;
    const originTaskIsOpen =
      originTask?.status === TaskStatusEnum.PENDING ||
      originTask?.status === TaskStatusEnum.IN_PROGRESS;

    // Safety: when there is nobody to hand the decision back to (origin task
    // missing, or already closed without a resolvable assignee), fall back to
    // the default rejection path instead of leaving the token stuck WAITING
    // with no open task.
    if (!originTask || (!originTaskIsOpen && !originTask.assigneeMemberId)) {
      return false;
    }

    const originCandidates =
      readDecisionPolicySnapshot(originTask).type === 'SEQUENTIAL'
        ? await taskCandidateRepository.find({
            where: { taskId: originTask.id },
          })
        : [];
    const isSequentialOrigin = isOrderedSequentialTask(
      originTask,
      originCandidates,
    );
    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      task.nodeId,
    );

    if (!originTaskIsOpen && originTask.assigneeMemberId) {
      // The origin approver already decided — reopen a fresh decision task so
      // the stage can be re-decided after the rejected pre-approval. A
      // SEQUENTIAL task's assignee rotates and ends on the last signer, so it
      // goes back to whoever asked for the pre-approval instead.
      const requesterCandidate = isSequentialOrigin
        ? await this.readSequentialRequesterCandidate(
            manager,
            originTask,
            originCandidates,
            directive.createdByMemberId,
          )
        : undefined;
      // A sequential origin always reopens for the requester, even when the
      // successor of a transferred task has no row for them.
      const reopenedAssigneeMemberId = isSequentialOrigin
        ? directive.createdByMemberId
        : originTask.assigneeMemberId;
      const reopenedOriginalMemberId = isSequentialOrigin
        ? (requesterCandidate?.originalMemberId ?? directive.createdByMemberId)
        : originTask.originalAssigneeMemberId;
      const reopenedDelegationChain = isSequentialOrigin
        ? (requesterCandidate?.delegationChain ?? [])
        : originTask.delegationChain;
      const reopenedTask = await taskRepository.save(
        taskRepository.create({
          assigneeMemberId: reopenedAssigneeMemberId,
          assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
          completedAt: null,
          createdAt: decidedAt,
          decisionPolicySnapshot: { type: 'SINGLE' },
          delegationChain: reopenedDelegationChain,
          instanceId: instance.id,
          nodeId: originTask.nodeId,
          openedAt: null,
          originalAssigneeMemberId: reopenedOriginalMemberId,
          slaDueAt: null,
          status: TaskStatusEnum.PENDING,
          tokenId: originTask.tokenId,
        }),
      );

      await taskCandidateRepository.save(
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: decidedAt,
          decidedAt: null,
          delegationChain: reopenedDelegationChain,
          memberId: reopenedAssigneeMemberId,
          originalMemberId:
            reopenedOriginalMemberId ?? reopenedAssigneeMemberId,
          sourceType: 'DIRECT',
          status: TaskCandidateStatusEnum.PENDING,
          taskId: reopenedTask.id,
        }),
      );
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: task.assigneeMemberId,
          eventType: ActivityLogEventTypeEnum.TASK_CREATED,
          instanceId: instance.id,
          nodeId: originTask.nodeId,
          payload: {
            adhocDirectiveId: directive.id,
            assigneeMemberId: reopenedAssigneeMemberId,
            reopenedFromTaskId: originTask.id,
            rejectedAdhocTaskId: task.id,
            tokenId: originTask.tokenId,
          },
          taskId: reopenedTask.id,
        }),
      );

      if (node.type === 'userTask') {
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: reopenedTask,
        });
      }
    }

    // On a SEQUENTIAL task the requester has already signed and the task has
    // moved on to the next signer, so they are told as well. On any other task
    // the requester is the origin holder (or handed the stage away by a
    // transfer) and only whoever holds the task now is told.
    const recipientMemberIds = uniqueTexts([
      ...(isSequentialOrigin ? [directive.createdByMemberId] : []),
      ...(await this.readOpenTaskRecipientMemberIds(manager, originTask)),
    ]);

    if (recipientMemberIds.length > 0) {
      await this.notificationService.createAdhocWorkflowNotifications({
        channels: null,
        instance,
        manager,
        message: `案件「${instance.title}」的臨時加簽已被拒絕${
          decisionComment ? `：${decisionComment}` : '。'
        }`,
        payload: {
          adhocTaskId: task.id,
          directiveId: directive.id,
          nodeId: task.nodeId,
          originTaskId: originTask.id,
          type: 'PRE_APPROVAL_RETURNED',
        },
        recipientMemberIds,
      });
    }

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.ADHOC_PRE_APPROVAL_RETURNED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          comment: decisionComment,
          directiveId: directive.id,
          originTaskId: originTask.id,
          rejectedAdhocTaskId: task.id,
        },
        taskId: task.id,
      }),
    );

    return true;
  }

  /**
   * Follows a TRANSFERRED task to the task that replaced it, repeatedly, and
   * returns the last one reached. A transfer leaves no pointer on either task
   * row; the link is the `transferredFromTaskId` in the payload of the
   * TASK_CREATED activity written for the replacement. When the trail stops
   * (no such activity, or its task is gone) the last task reached is returned,
   * so a caller sees the transferred row exactly as it did before.
   */
  private async readTransferSuccessorTask(
    manager: EntityManager,
    task: TaskEntity,
  ): Promise<TaskEntity> {
    if (task.status !== TaskStatusEnum.TRANSFERRED) {
      return task;
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const taskCreatedActivities = await manager
      .getRepository(ActivityLogEntity)
      .find({
        where: {
          eventType: ActivityLogEventTypeEnum.TASK_CREATED,
          instanceId: task.instanceId,
          nodeId: task.nodeId,
        },
      });
    const successorTaskIdByTransferredTaskId = new Map<string, string>(
      taskCreatedActivities.flatMap(
        (activity): readonly (readonly [string, string])[] => {
          const transferredFromTaskId =
            activity.payload['transferredFromTaskId'];

          return typeof transferredFromTaskId === 'string' && activity.taskId
            ? [[transferredFromTaskId, activity.taskId]]
            : [];
        },
      ),
    );
    const followTransfer = async (
      currentTask: TaskEntity,
      visitedTaskIds: ReadonlySet<string>,
    ): Promise<TaskEntity> => {
      const successorTaskId =
        currentTask.status === TaskStatusEnum.TRANSFERRED
          ? successorTaskIdByTransferredTaskId.get(currentTask.id)
          : undefined;

      if (!successorTaskId || visitedTaskIds.has(successorTaskId)) {
        return currentTask;
      }

      const successorTask = await taskRepository.findOne({
        where: { id: successorTaskId },
      });

      return successorTask
        ? followTransfer(
            successorTask,
            new Set([...visitedTaskIds, successorTaskId]),
          )
        : currentTask;
    };

    return followTransfer(task, new Set([task.id]));
  }

  /**
   * The requester's candidate row on a SEQUENTIAL origin task. A task that was
   * transferred mid-order continues as a replacement that carries only the
   * candidates still to sign, so a requester who already signed is found on an
   * earlier task of the transfer chain instead.
   */
  private async readSequentialRequesterCandidate(
    manager: EntityManager,
    originTask: TaskEntity,
    originCandidates: readonly TaskCandidateEntity[],
    requesterMemberId: string,
  ): Promise<TaskCandidateEntity | undefined> {
    const ownCandidate = originCandidates.find(
      (candidate) => candidate.memberId === requesterMemberId,
    );

    if (ownCandidate) {
      return ownCandidate;
    }

    const taskCreatedActivities = await manager
      .getRepository(ActivityLogEntity)
      .find({
        where: {
          eventType: ActivityLogEventTypeEnum.TASK_CREATED,
          instanceId: originTask.instanceId,
          nodeId: originTask.nodeId,
        },
      });
    const transferredFromTaskIdByTaskId = new Map<string, string>(
      taskCreatedActivities.flatMap(
        (activity): readonly (readonly [string, string])[] => {
          const transferredFromTaskId =
            activity.payload['transferredFromTaskId'];

          return typeof transferredFromTaskId === 'string' && activity.taskId
            ? [[activity.taskId, transferredFromTaskId]]
            : [];
        },
      ),
    );
    const searchEarlierTasks = async (
      currentTaskId: string,
      visitedTaskIds: ReadonlySet<string>,
    ): Promise<TaskCandidateEntity | undefined> => {
      const earlierTaskId = transferredFromTaskIdByTaskId.get(currentTaskId);

      if (!earlierTaskId || visitedTaskIds.has(earlierTaskId)) {
        return undefined;
      }

      const earlierCandidate = (
        await manager
          .getRepository(TaskCandidateEntity)
          .find({ where: { taskId: earlierTaskId } })
      ).find((candidate) => candidate.memberId === requesterMemberId);

      return (
        earlierCandidate ??
        searchEarlierTasks(
          earlierTaskId,
          new Set([...visitedTaskIds, earlierTaskId]),
        )
      );
    };

    return searchEarlierTasks(originTask.id, new Set([originTask.id]));
  }

  private async readOpenTaskRecipientMemberIds(
    manager: EntityManager,
    task: TaskEntity,
  ): Promise<readonly string[]> {
    if (task.assigneeMemberId) {
      return [task.assigneeMemberId];
    }

    const candidates = await manager
      .getRepository(TaskCandidateEntity)
      .find({ where: { taskId: task.id } });

    return uniqueTexts(
      candidates
        .filter(
          (candidate) =>
            candidate.status === TaskCandidateStatusEnum.PENDING ||
            candidate.status === TaskCandidateStatusEnum.CLAIMED,
        )
        .map((candidate) => candidate.memberId),
    );
  }

  private async dispatchAdhocStageNotifications(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeId: string,
    outcome: AdhocStageOutcome,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        originNodeId: nodeId,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
      },
    });

    if (directives.length === 0) {
      return;
    }

    const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, nodeId);
    const nodeLabel = node.data.label;
    const outcomeLabel = readAdhocStageOutcomeLabel(outcome);
    const consumedAt = new Date();

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;
        await this.dispatchAdhocDirectiveNotification(
          manager,
          instance,
          directive,
          `案件「${instance.title}」的階段「${nodeLabel}」已${outcomeLabel}。`,
          {
            nodeId,
            nodeLabel,
            outcome,
            type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
          },
        );
        await directiveRepository.save({
          ...directive,
          consumedAt,
          status: AdhocDirectiveStatusEnum.CONSUMED,
        });
      },
      Promise.resolve(),
    );
  }

  private async dispatchAdhocCompletionNotifications(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    finalState: ApprovalInstanceStateEnum,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      order: { createdAt: 'ASC' },
      where: {
        instanceId: instance.id,
        status: AdhocDirectiveStatusEnum.PENDING,
        type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
      },
    });

    if (directives.length === 0) {
      return;
    }

    const finalStateLabel = readInstanceFinalStateLabel(finalState);
    const consumedAt = new Date();

    await directives.reduce<Promise<void>>(
      async (previous, directive): Promise<void> => {
        await previous;
        await this.dispatchAdhocDirectiveNotification(
          manager,
          instance,
          directive,
          `案件「${instance.title}」已結案（${finalStateLabel}）。`,
          {
            finalState,
            type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
          },
        );
        await directiveRepository.save({
          ...directive,
          consumedAt,
          status: AdhocDirectiveStatusEnum.CONSUMED,
        });
      },
      Promise.resolve(),
    );
  }

  private async dispatchAdhocDirectiveNotification(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    directive: AdhocDirectiveEntity,
    message: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const targetValue = readAdhocTargetValue(directive);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    if (targetValue.kind === AdhocTargetKindEnum.WEBHOOK) {
      const webhookPayload = {
        ...payload,
        instanceId: instance.id,
        instanceTitle: instance.title,
        message,
        triggeredAt: new Date().toISOString(),
      };

      await this.dispatchWebhookAfterCommit(manager, {
        instanceId: instance.id,
        readActivityLog: (result) => ({
          actorMemberId: null,
          eventType: result.ok
            ? ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED
            : ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: directive.originNodeId,
          payload: {
            action: 'ADHOC_WEBHOOK',
            directiveId: directive.id,
            error: result.error,
            ok: result.ok,
            status: result.status,
            url: targetValue.webhookUrl,
          },
          taskId: null,
        }),
        send: () =>
          executeAdhocWebhookDispatch(
            this.serviceTaskDispatcher,
            targetValue,
            webhookPayload,
          ),
      });

      return;
    }

    try {
      const recipients = await this.resolveApproverResolver(
        manager,
        instance,
        buildAdhocApproverResolver(targetValue),
        '臨時通知對象',
        '通知對象',
      );

      await this.notificationService.createAdhocWorkflowNotifications({
        channels: directive.channels,
        instance,
        manager,
        message,
        payload: { ...payload, directiveId: directive.id },
        recipientMemberIds: recipients.map((recipient) => recipient.memberId),
      });
    } catch (error: unknown) {
      // Notification target resolution must never block the workflow
      // transition that triggered it — record the failure instead.
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: directive.originNodeId,
          payload: {
            action: 'ADHOC_NOTIFY',
            directiveId: directive.id,
            error:
              error instanceof Error
                ? error.message
                : 'Ad-hoc notification dispatch failed',
          },
          taskId: null,
        }),
      );
    }
  }

  private async cancelPendingAdhocDirectives(
    manager: EntityManager,
    instanceId: string,
    types: readonly AdhocDirectiveTypeEnum[] | null,
  ): Promise<void> {
    const directiveRepository = manager.getRepository(AdhocDirectiveEntity);
    const directives = await directiveRepository.find({
      where: {
        instanceId,
        status: AdhocDirectiveStatusEnum.PENDING,
        ...(types ? { type: In([...types]) } : {}),
      },
    });

    if (directives.length === 0) {
      return;
    }

    await directiveRepository.save(
      directives.map((directive) => ({
        ...directive,
        status: AdhocDirectiveStatusEnum.CANCELLED,
      })),
    );
  }

  dryRunApprovalWorkflow(
    input: DryRunApprovalWorkflowInput,
  ): WorkflowDryRunResultObject {
    // Checked first: parsing happens outside the time budget below.
    if (
      [
        input.workflowDefinitionJson,
        input.formDataJson,
        input.initiatorMetadataSnapshotJson ?? '',
      ].some((json) => json.length > MAX_DRY_RUN_INPUT_LENGTH)
    ) {
      return createFailedDryRunResult(
        '試跑資料過大，請縮小流程或測試資料後再試',
      );
    }

    const workflowDefinition = parseWorkflowDefinition(
      input.workflowDefinitionJson,
    );
    const formData = parseJsonObject(input.formDataJson, 'formDataJson');
    // The snapshot here is the caller's own sample (the designer always sends
    // one) or a bare `{ customFields: {}, memberId }`. It is not the one a real
    // submission builds, and a dry run has no template version to hand the
    // host's `customFields` resolver, so that resolver is not called.
    const initiatorMetadataSnapshot = input.initiatorMetadataSnapshotJson
      ? parseJsonObject(
          input.initiatorMetadataSnapshotJson,
          'initiatorMetadataSnapshotJson',
        )
      : readDefaultInitiatorMetadataSnapshot(input.initiatorMemberId);

    try {
      // The CEL engine loads outside the budget so an interrupt can never land
      // halfway through loading a module.
      this.conditionService.prepareEngine(
        readWorkflowExpressionDialect(workflowDefinition),
      );

      // The outer budget bounds the whole walk, and the operation budget
      // bounds the expressions inside it. Both are charged to this dry run only.
      return Object.assign(new WorkflowDryRunResultObject(), {
        errors: [],
        steps: runExpressionOperation(() =>
          runWithinTimeBudget(
            () =>
              this.simulateWorkflow({
                formData,
                initiatorMemberId: input.initiatorMemberId,
                initiatorMetadataSnapshot,
                workflowDefinition,
              }),
            DRY_RUN_TIME_BUDGET_MS,
          ),
        ),
        valid: true,
      });
    } catch (error: unknown) {
      return createFailedDryRunResult(readDryRunFailureMessage(error));
    }
  }

  private simulateWorkflow(
    input: DryRunSimulationInput,
  ): readonly WorkflowDryRunStepObject[] {
    const startNode = input.workflowDefinition.nodes.find(
      (node) => node.type === 'startEvent',
    );

    if (!startNode) {
      throw new BadRequestException('Workflow does not include a startEvent');
    }

    // Every branch re-walks whatever follows it, so a chain of gateways doubles
    // the work at each one while the depth limit never trips. Closure state
    // because all the branches of one dry run share this one count.
    let visits = 0;

    return this.simulateWorkflowPath({
      ...input,
      chargeVisit: (): void => {
        visits += 1;

        if (visits > MAX_DRY_RUN_VISITS) {
          throw new ConflictException(DRY_RUN_TOO_COMPLEX_MESSAGE);
        }
      },
      depth: 0,
      incomingEdge: null,
      lastDecision: null,
      nodeId: startNode.id,
      steps: [],
      visitedNodeIds: new Set(),
    });
  }

  private simulateWorkflowPath(
    input: DryRunPathInput,
  ): readonly WorkflowDryRunStepObject[] {
    if (input.depth > MAX_PROCESSING_STEPS) {
      throw new ConflictException('Dry run exceeded maximum processing steps');
    }

    input.chargeVisit();

    const node = readWorkflowNodeOrThrow(
      input.workflowDefinition,
      input.nodeId,
    );
    const visitKey = `${input.nodeId}:${input.incomingEdge?.id ?? 'start'}`;
    const entryCondition = readNodeEntryCondition(node);

    if (input.visitedNodeIds.has(visitKey)) {
      return [
        ...input.steps,
        createDryRunStep({
          assigneeMemberId: null,
          edge: input.incomingEdge,
          edgeMatched: null,
          edgeReason: null,
          entryCondition,
          entryConditionMet: null,
          message: '偵測到循環路徑，已停止此分支。',
          node,
          status: 'STOPPED',
          stepIndex: input.steps.length,
        }),
      ];
    }

    const nextVisitedNodeIds = new Set([...input.visitedNodeIds, visitKey]);
    const entryConditionMet = this.conditionService.evaluateBoolean(
      entryCondition,
      buildDryRunExpressionContext(input, input.lastDecision),
      `workflow.nodes.${node.id}.data.entryCondition`,
      {
        allowedRootIdentifiers: DRY_RUN_WORKFLOW_ROOT_IDENTIFIERS,
        dialect: readWorkflowExpressionDialect(input.workflowDefinition),
      },
    );
    const assignment =
      entryConditionMet && node.type === 'userTask'
        ? this.resolveDryRunAssignment(input, node)
        : null;
    const assigneeMemberId = assignment?.assigneeMemberId ?? null;
    const skippedByExclusion = assignment?.outcome === 'SKIPPED';
    const stoppedByAssignment = assignment?.outcome === 'STOPPED';
    const nextLastDecision =
      entryConditionMet && node.type === 'userTask' && !skippedByExclusion
        ? {
            action: TaskDecisionActionEnum.APPROVED,
            assigneeMemberId,
            nodeId: node.id,
          }
        : input.lastDecision;
    // A node that stops on its assignment, an asynchronous NOTIFY node (at
    // runtime it consumes its token and never advances) and an end event do
    // not route any further.
    const routes =
      !stoppedByAssignment &&
      !isAsyncNotifyServiceTask(node) &&
      node.type !== 'endEvent';
    const outgoing: DryRunOutgoing = routes
      ? this.readDryRunOutgoing(
          input,
          node,
          nextLastDecision,
          entryConditionMet && !skippedByExclusion,
        )
      : { edges: [], stopMessage: null };
    const nextSteps = [
      ...input.steps,
      createDryRunStep({
        assigneeMemberId,
        edge: input.incomingEdge,
        edgeMatched: input.incomingEdge ? true : null,
        edgeReason: readDryRunEdgeReason(input.incomingEdge),
        entryCondition,
        entryConditionMet,
        message: readDryRunStepResultMessage(
          assignment?.message ?? null,
          outgoing.stopMessage,
          readDryRunStepMessage(node, entryConditionMet),
          !entryConditionMet || skippedByExclusion,
        ),
        node,
        status:
          outgoing.stopMessage === null
            ? (assignment?.outcome ??
              readDryRunStepStatus(node, entryConditionMet))
            : 'STOPPED',
        stepIndex: input.steps.length,
      }),
    ];

    return outgoing.edges.reduce(
      (steps, edge) =>
        this.simulateWorkflowPath({
          ...input,
          depth: input.depth + 1,
          incomingEdge: edge,
          lastDecision: nextLastDecision,
          nodeId: edge.target,
          steps,
          visitedNodeIds: nextVisitedNodeIds,
        }),
      nextSteps,
    );
  }

  /**
   * The edges a dry-run step continues along. A node a designer has left
   * unfinished (nothing drawn out of it, or no branch of a gateway taken) ends
   * its branch with a readable message instead of failing the whole dry run.
   */
  private readDryRunOutgoing(
    input: DryRunSimulationInput,
    node: WorkflowNode,
    lastDecision: Readonly<Record<string, unknown>> | null,
    evaluatesConditions: boolean,
  ): DryRunOutgoing {
    const nodeName = readDryRunNodeName(node);
    const outgoingEdges = input.workflowDefinition.edges.filter(
      (edge) => edge.source === node.id,
    );

    if (outgoingEdges.length === 0) {
      return {
        edges: [],
        stopMessage: `節點「${nodeName}」沒有連到下一個節點，請在流程設計器為此節點接上連線`,
      };
    }

    if (!evaluatesConditions) {
      return { edges: outgoingEdges, stopMessage: null };
    }

    const conditionalEdges = outgoingEdges.filter(
      (edge) => !edge.data.isDefault && edgeHasCondition(edge),
    );

    if (conditionalEdges.length === 0) {
      return { edges: outgoingEdges, stopMessage: null };
    }

    const matchingEdges = conditionalEdges.filter((edge) =>
      this.evaluateDryRunEdge(input, edge, lastDecision),
    );

    if (matchingEdges.length > 0) {
      return {
        edges:
          node.type === 'exclusiveGateway' ? [matchingEdges[0]] : matchingEdges,
        stopMessage: null,
      };
    }

    const defaultEdges = outgoingEdges.filter((edge) => edge.data.isDefault);

    if (defaultEdges.length > 0) {
      return {
        edges:
          node.type === 'exclusiveGateway' ? [defaultEdges[0]] : defaultEdges,
        stopMessage: null,
      };
    }

    return {
      edges: [],
      stopMessage: `節點「${nodeName}」的連出線條件都不符合，且沒有設定預設路徑，請檢查連出線的條件或補上預設路徑`,
    };
  }

  private evaluateDryRunEdge(
    input: DryRunSimulationInput,
    edge: WorkflowEdge,
    lastDecision: Readonly<Record<string, unknown>> | null,
  ): boolean {
    const expression = readEvaluableEdgeExpression(edge, input.formData);

    if (!expression) {
      return evaluateWorkflowEdgeCondition(edge, { formData: input.formData });
    }

    return evaluateWithStructuredFallback(
      edge,
      input.formData,
      (message: string): void => this.logger.warn(`dry-run ${message}`),
      (): boolean =>
        this.conditionService.evaluateBoolean(
          expression,
          buildDryRunExpressionContext(input, lastDecision),
          `workflow.edges.${edge.id}.data.condition`,
          {
            allowedRootIdentifiers: DRY_RUN_EDGE_ROOT_IDENTIFIERS,
            dialect: readWorkflowExpressionDialect(input.workflowDefinition),
          },
        ),
    );
  }

  /**
   * The dry-run assignee of a user task. Only resolvers whose dry run yields
   * real member ids (DIRECT, DYNAMIC_FORM, EXPRESSION and ORG_MANAGER, which
   * reads the initiator snapshot) can be checked against the initiator; the
   * others resolve to placeholders and are left as they are.
   */
  private resolveDryRunAssignment(
    input: DryRunSimulationInput,
    node: UserTaskNode,
  ): DryRunAssignment {
    const resolver = node.data.approverResolver;
    const excludeInitiator = node.data.excludeInitiator;
    const unsupportedType = readUnsupportedApproverResolverType(resolver);

    // A source from a newer engine cannot be simulated. Say so and end the
    // branch instead of showing its type name as if it were a person.
    if (unsupportedType !== null) {
      return {
        assigneeMemberId: null,
        message: `簽核節點「${readDryRunNodeName(node)}」此引擎版本不支援簽核人來源「${unsupportedType}」，請升級 BPMCore 後再試`,
        outcome: 'STOPPED',
      };
    }

    // Same for a manager chain whose start a newer engine wrote.
    const unsupportedStartType =
      resolver.type === 'ORG_MANAGER_CHAIN' &&
      !isOrgManagerChainStartedFromInitiator(resolver)
        ? readUnsupportedOrgManagerChainStartType(
            resolver.startFrom as { readonly type: string },
          )
        : null;

    if (unsupportedStartType !== null) {
      return {
        assigneeMemberId: null,
        message: `簽核節點「${readDryRunNodeName(node)}」此引擎版本不支援主管鏈起點「${unsupportedStartType}」，請升級 BPMCore 後再試`,
        outcome: 'STOPPED',
      };
    }

    const memberIds = this.readDryRunMemberIds(
      input,
      resolver,
      `workflow.nodes.${node.id}.data.approverResolver`,
    );

    if (memberIds === null) {
      return {
        assigneeMemberId: readDryRunPlaceholderAssignee(resolver),
        message: null,
        outcome: null,
      };
    }

    // Nobody to ask yet — typically a node whose approver has not been chosen.
    // The branch ends here and says which node needs attention, rather than
    // failing the whole dry run.
    if (memberIds.length === 0) {
      return {
        assigneeMemberId: null,
        message: readDryRunUnresolvedApproverMessage(
          resolver,
          readDryRunNodeName(node),
          input.initiatorMemberId,
        ),
        outcome: 'STOPPED',
      };
    }

    if (!excludeInitiator || !memberIds.includes(input.initiatorMemberId)) {
      return {
        assigneeMemberId: memberIds[0],
        message: null,
        outcome: null,
      };
    }

    const remainingMemberId = memberIds.find(
      (memberId) => memberId !== input.initiatorMemberId,
    );

    if (remainingMemberId !== undefined) {
      return {
        assigneeMemberId: remainingMemberId,
        message: null,
        outcome: null,
      };
    }

    if (excludeInitiator.whenEmpty === 'SKIP_NODE') {
      return {
        assigneeMemberId: null,
        message: '簽核人只有申請人本人，依設定略過節點。',
        outcome: 'SKIPPED',
      };
    }

    // Level 1 is the initiator when they head their unit; like the runtime,
    // fall through to the next level of the snapshot's manager chain.
    const managerMemberId =
      excludeInitiator.whenEmpty === 'INITIATOR_MANAGER'
        ? [1, 2]
            .map((levelsUp) =>
              readManagerMemberIdFromInitiatorSnapshot(
                input.initiatorMetadataSnapshot,
                levelsUp,
              ),
            )
            .find(
              (memberId): memberId is string =>
                typeof memberId === 'string' &&
                memberId.trim() !== '' &&
                memberId.trim() !== input.initiatorMemberId,
            )
        : undefined;

    if (managerMemberId !== undefined) {
      return {
        assigneeMemberId: managerMemberId.trim(),
        message: null,
        outcome: null,
      };
    }

    return {
      assigneeMemberId: null,
      message:
        excludeInitiator.whenEmpty === 'INITIATOR_MANAGER'
          ? '簽核人只有申請人本人，此節點不允許申請人自簽，且找不到申請人的主管可改派。'
          : '簽核人只有申請人本人，此節點不允許申請人自簽。',
      outcome: 'STOPPED',
    };
  }

  /**
   * The member ids a dry run resolves for a user task: an empty list when the
   * resolver names nobody, `null` for resolvers that only resolve to a
   * placeholder in a dry run.
   */
  private readDryRunMemberIds(
    input: DryRunSimulationInput,
    resolver: ApproverResolver,
    label: string,
  ): readonly string[] | null {
    if (resolver.type === 'DIRECT') {
      return findMemberIdsInValue(resolver.memberIds);
    }

    if (resolver.type === 'DYNAMIC_FORM') {
      return findMemberIdsInValue(
        readValueAtPath(input.formData, resolver.formPath),
      );
    }

    if (resolver.type === 'EXPRESSION') {
      return findMemberIdsInValue(
        this.conditionService.evaluateValue(
          resolver.expression,
          buildDryRunExpressionContext(input, null),
          `${label}.expression`,
          {
            allowedRootIdentifiers: DRY_RUN_WORKFLOW_ROOT_IDENTIFIERS,
            dialect: readWorkflowExpressionDialect(input.workflowDefinition),
          },
        ),
      );
    }

    if (resolver.type === 'ORG_MANAGER') {
      const managerMemberIds = findMemberIdsInValue(
        readManagerMemberIdFromInitiatorSnapshot(
          input.initiatorMetadataSnapshot,
          resolver.levelsUp,
        ),
      );

      return managerMemberIds.length > 0
        ? managerMemberIds
        : readDryRunFallbackMemberIds(input, resolver.fallback);
    }

    // The form pick, the unit's rules and an earlier node's outcome are not
    // known before the instance runs: these stand in as placeholders.
    return null;
  }

  async getApprovalInstance(
    id: string,
    scope?: WorkflowReadScope,
  ): Promise<ApprovalInstanceEntity> {
    const instance = await this.approvalInstanceRepository.findOne({
      where: { id },
    });

    if (!instance) {
      throw new NotFoundException(`Approval instance ${id} was not found`);
    }

    if (
      scope &&
      !canReadAllWorkflows(scope) &&
      !(await this.isApprovalInstanceReadableByMember(instance, scope.memberId))
    ) {
      throw new NotFoundException(`Approval instance ${id} was not found`);
    }

    return instance;
  }

  /**
   * ADR 25 §6: a value written to a filterable field must fit its type, on
   * every path that writes form data. The fields checked are the ones the
   * template's *current* version marks filterable, not the instance's own
   * snapshot: an older instance can be re-filled, resubmitted or written by a
   * service task after a newer version enabled filtering on a field, and the
   * enable check (ADR 25 §5.4) guarantees the type is the same in every version
   * that holds instances, so the current definition judges the old value too.
   */
  private async assertCurrentFilterableFormDataValues(
    templateId: string,
    formData: Readonly<Record<string, unknown>>,
    manager?: EntityManager,
    serviceNodeLabel?: string,
  ): Promise<void> {
    const schema = await this.readCurrentFormSchema(templateId, manager);

    assertFilterableFormDataValues(schema, formData, serviceNodeLabel);
  }

  /** The form schema of the template's current version, or `null` when there is none. */
  private async readCurrentFormSchema(
    templateId: string,
    manager?: EntityManager,
  ): Promise<FormDefinitionSchema | null> {
    // Inside a write transaction the template row is taken FOR SHARE (ADR 25
    // §15): a publish, compose or rollback needs FOR UPDATE on the same row, so
    // the current version read here cannot change before the write commits.
    const template = manager
      ? await manager.getRepository(ApprovalTemplateEntity).findOne({
          lock: { mode: 'pessimistic_read' },
          where: { id: templateId },
        })
      : await this.approvalTemplateRepository.findOne({
          where: { id: templateId },
        });

    if (!template?.currentVersionId) {
      return null;
    }

    const versions = manager
      ? manager.getRepository(ApprovalTemplateVersionEntity)
      : this.approvalTemplateVersionRepository;
    const version = await versions.findOne({
      where: { id: template.currentVersionId },
    });

    if (!version?.formDefinitionVersionId) {
      return null;
    }

    const formVersions = manager
      ? manager.getRepository(FormDefinitionVersionEntity)
      : this.formDefinitionVersionRepository;
    const formVersion = await formVersions.findOne({
      where: { id: version.formDefinitionVersionId },
    });

    return formVersion?.schema ?? null;
  }

  async listApprovalInstances(
    scope?: WorkflowReadScope,
    options: ListApprovalInstancesOptions = {},
  ): Promise<readonly ApprovalInstanceEntity[]> {
    const query = await this.createFilteredApprovalInstanceQuery(
      scope,
      options,
    );

    if (!query) {
      return [];
    }

    const { orderBy, queryBuilder } = query;

    orderBy.forEach((order, index): void => {
      if (index === 0) {
        queryBuilder.orderBy(order.sql, order.direction);
      } else {
        queryBuilder.addOrderBy(order.sql, order.direction);
      }
    });

    if (shouldPaginateList(options)) {
      queryBuilder
        .offset(readPageOffset(options.page, options.pageSize))
        .limit(normalizePageSize(options.pageSize));
    }

    return queryBuilder.getMany();
  }

  async countApprovalInstances(
    scope?: WorkflowReadScope,
    options: Omit<
      ListApprovalInstancesOptions,
      'page' | 'pageSize' | 'sort'
    > = {},
  ): Promise<number> {
    const query = await this.createFilteredApprovalInstanceQuery(
      scope,
      options,
    );

    return query ? query.queryBuilder.getCount() : 0;
  }

  async readApprovalInstancePageInfo(
    scope?: WorkflowReadScope,
    options: ListApprovalInstancesOptions = {},
  ): Promise<{
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly page: number;
    readonly pageSize: number;
    readonly totalCount: number;
    readonly totalPages: number;
  }> {
    const totalCount = await this.countApprovalInstances(scope, options);
    const page = normalizePage(options.page);
    const pageSize = normalizePageSize(options.pageSize);
    const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

    return {
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      page,
      pageSize,
      totalCount,
      totalPages,
    };
  }

  private async createFilteredApprovalInstanceQuery(
    scope?: WorkflowReadScope,
    options: ListApprovalInstancesOptions = {},
  ): Promise<FilteredApprovalInstanceQuery | null> {
    const queryBuilder =
      this.approvalInstanceRepository.createQueryBuilder('approvalInstance');
    const hasReadableInstances = this.applyReadableInstanceFilter(
      queryBuilder,
      scope,
      options,
    );

    if (!hasReadableInstances) {
      return null;
    }

    const templateId = normalizeText(options.templateId);

    if (options.state?.length) {
      queryBuilder.andWhere('"approvalInstance"."state" IN (:...states)', {
        states: [...options.state],
      });
    }

    if (templateId) {
      queryBuilder.andWhere('"approvalInstance"."template_id" = :templateId', {
        templateId,
      });
    }

    applyApprovalInstanceSearchFilter(queryBuilder, options.searchText);

    const compiled = await this.compileApprovalInstanceFieldQuery(
      scope,
      templateId,
      options,
    );

    compiled.conditions.forEach((condition): void => {
      queryBuilder.andWhere(condition.sql, condition.parameters);
    });
    queryBuilder.setParameters(
      compiled.orderBy.reduce<Readonly<Record<string, unknown>>>(
        (all, order) => ({ ...all, ...order.parameters }),
        {},
      ),
    );

    return { orderBy: compiled.orderBy, queryBuilder };
  }

  /**
   * The WHERE conditions and sort keys of the field filters and sort on the
   * approval-instance list (ADR 25 §7). The template's current schema is read,
   * and the static option lists of every version holding instances, only when
   * a condition or a non-time sort key needs them.
   */
  private async compileApprovalInstanceFieldQuery(
    scope: WorkflowReadScope | undefined,
    templateId: string | null,
    options: ListApprovalInstancesOptions,
  ): Promise<CompiledApprovalInstanceFieldFilters> {
    const fieldFilters = options.fieldFilters ?? [];
    const sort = options.sort ?? [];
    const needsSchema =
      fieldFilters.length > 0 ||
      sort.some((item) => !isApprovalInstanceSortTimeField(item.field));

    if (needsSchema && !templateId) {
      throw new BadRequestException('篩選或排序表單欄位時需要指定簽核範本');
    }

    const schema =
      needsSchema && templateId
        ? await this.readCurrentFormSchema(templateId)
        : null;
    // Only a name search (CONTAINS) reads option names; other conditions and
    // sort keys need the current schema alone.
    const needsOptionNames = fieldFilters.some(
      (filter) => filter.operator === 'CONTAINS',
    );
    const staticOptionsByPath =
      needsOptionNames && templateId
        ? await this.readStaticOptionsByPathForTemplate(templateId, schema)
        : readStaticOptionsByPath([]);

    return this.approvalInstanceFieldFilterCompiler.compile({
      alias: 'approvalInstance',
      fieldFilters,
      paths:
        this.approvalInstanceFilterableFieldPolicy.readFilterableFieldPaths(
          scope,
          schema,
        ),
      sort,
      staticOptionsByPath,
    });
  }

  /**
   * Static option lists by field path, across the current schema and the form
   * version of every template version that holds instances (ADR 25 §7.3): a
   * CONTAINS on a retired option still matches its name.
   */
  private async readStaticOptionsByPathForTemplate(
    templateId: string,
    currentSchema: FormDefinitionSchema | null,
  ): Promise<ReturnType<typeof readStaticOptionsByPath>> {
    const held = await this.approvalInstanceRepository
      .createQueryBuilder('approvalInstance')
      .select('DISTINCT "approvalInstance"."template_version_id"', 'id')
      .where('"approvalInstance"."template_id" = :templateId', { templateId })
      .getRawMany<{ readonly id: string }>();
    const templateVersions =
      held.length === 0
        ? []
        : await this.approvalTemplateVersionRepository.find({
            where: { id: In(held.map((row) => row.id)) },
          });
    const formVersionIds = templateVersions
      .map((version) => version.formDefinitionVersionId)
      .filter((id): id is string => id !== null);
    const formVersions =
      formVersionIds.length === 0
        ? []
        : await this.formDefinitionVersionRepository.find({
            where: { id: In(formVersionIds) },
          });

    return readStaticOptionsByPath([
      currentSchema,
      ...formVersions.map((version) => version.schema),
    ]);
  }

  private applyReadableInstanceFilter(
    queryBuilder: SelectQueryBuilder<ApprovalInstanceEntity>,
    scope: WorkflowReadScope | undefined,
    options: Omit<ListApprovalInstancesOptions, 'page' | 'pageSize'>,
  ): boolean {
    if (!scope) {
      return true;
    }

    const view = options.view ?? ApprovalInstanceListViewEnum.ALL;

    if (view === ApprovalInstanceListViewEnum.SENT) {
      // The assistant who filed on someone's behalf finds it here too.
      queryBuilder.andWhere(
        `(
          "approvalInstance"."initiator_member_id" = :readableMemberId
          OR "approvalInstance"."submitted_by_member_id" = :readableMemberId
        )`,
        {
          readableMemberId: scope.memberId,
        },
      );

      return true;
    }

    if (view === ApprovalInstanceListViewEnum.CC) {
      queryBuilder.andWhere(
        `
          EXISTS (
            SELECT 1
            FROM "notifications" "readableNotification"
            WHERE "readableNotification"."instance_id" = "approvalInstance"."id"
              AND "readableNotification"."recipient_member_id" = :readableMemberId
          )
        `,
        {
          readableMemberId: scope.memberId,
        },
      );

      return true;
    }

    if (canReadAllWorkflows(scope)) {
      return true;
    }

    queryBuilder.andWhere(
      `
        (
          "approvalInstance"."initiator_member_id" = :readableMemberId
          OR "approvalInstance"."submitted_by_member_id" = :readableMemberId
          OR EXISTS (
            SELECT 1
            FROM "tasks" "readableTask"
            WHERE "readableTask"."instance_id" = "approvalInstance"."id"
              AND (
                "readableTask"."assignee_member_id" = :readableMemberId
                OR "readableTask"."original_assignee_member_id" = :readableMemberId
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "task_candidates" "readableCandidate"
            INNER JOIN "tasks" "readableCandidateTask"
              ON "readableCandidateTask"."id" = "readableCandidate"."task_id"
            WHERE "readableCandidateTask"."instance_id" = "approvalInstance"."id"
              AND (
                "readableCandidate"."member_id" = :readableMemberId
                OR "readableCandidate"."original_member_id" = :readableMemberId
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "task_decisions" "readableDecision"
            INNER JOIN "tasks" "readableDecisionTask"
              ON "readableDecisionTask"."id" = "readableDecision"."task_id"
            WHERE "readableDecisionTask"."instance_id" = "approvalInstance"."id"
              AND "readableDecision"."decided_by_member_id" = :readableMemberId
          )
        )
      `,
      {
        readableMemberId: scope.memberId,
      },
    );

    return true;
  }

  async readWorkflowDashboardSummary(
    scope?: WorkflowReadScope,
    options: WorkflowDashboardSummaryOptions = {},
  ): Promise<{
    readonly activeInstanceCount: number;
    readonly completedInstanceCount: number;
    readonly overdueTaskCount: number;
    readonly pendingTaskCount: number;
    readonly rejectedInstanceCount: number;
    readonly totalInstanceCount: number;
  }> {
    const instances = (
      await this.listApprovalInstances(scope, {
        view: ApprovalInstanceListViewEnum.ALL,
      })
    ).filter((instance) => isInstanceWithinRange(instance, options));
    const instanceIds = instances.map((instance) => instance.id);
    // The task counters answer "what is waiting on me", not "what is open on
    // the instances I can see": a member who can read an instance as initiator,
    // reader or administrator is not thereby the one who has to act on it. So
    // they count the member's own inbox, narrowed to the instances in range.
    // Without a scope there is no member to speak for, and the counters keep
    // describing every open task.
    const openTasks = await this.readDashboardOpenTasks(scope, instanceIds);
    const now = Date.now();

    return {
      activeInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.RUNNING,
      ).length,
      completedInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.APPROVED,
      ).length,
      overdueTaskCount: openTasks.filter(
        (task) => task.slaDueAt && task.slaDueAt.getTime() <= now,
      ).length,
      pendingTaskCount: openTasks.length,
      rejectedInstanceCount: instances.filter(
        (instance) => instance.state === ApprovalInstanceStateEnum.REJECTED,
      ).length,
      totalInstanceCount: instances.length,
    };
  }

  private async readDashboardOpenTasks(
    scope: WorkflowReadScope | undefined,
    instanceIds: readonly string[],
  ): Promise<readonly TaskEntity[]> {
    if (!instanceIds.length) {
      return [];
    }

    if (scope) {
      const instanceIdSet = new Set(instanceIds);

      return (await this.readOpenInboxTasks(scope.memberId)).filter((task) =>
        instanceIdSet.has(task.instanceId),
      );
    }

    return this.taskRepository.find({
      where: {
        instanceId: In(instanceIds),
        status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
      },
    });
  }

  /**
   * The active templates `memberId` may start now. `authContext` is handed to
   * the host's initiator `customFields` resolver; a host calling this without
   * one gets a bare context for the member, as a submission does.
   */
  async listLaunchableApprovalTemplates(
    memberId: string,
    authContext?: BPMAuthContext,
  ): Promise<readonly ApprovalTemplateEntity[]> {
    const templates = await this.approvalTemplateRepository.find({
      order: { updatedAt: 'DESC' },
      where: { isActive: true },
    });
    const currentVersionIds = templates
      .map((template) => template.currentVersionId)
      .filter((versionId): versionId is string => Boolean(versionId));

    if (!currentVersionIds.length) {
      return [];
    }

    const versions = await this.approvalTemplateVersionRepository.find({
      where: {
        id: In(currentVersionIds),
        status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      },
    });
    const versionById = new Map(
      versions.map(
        (version): readonly [string, ApprovalTemplateVersionEntity] => [
          version.id,
          version,
        ],
      ),
    );
    // Built like a submission's, so a policy that reads
    // `initiator.customFields` is judged here against what the host's resolver
    // returns for this member. The resolver depends on the initiator only, so
    // it is called once for the whole list, not once per template. When it
    // fails, the list is judged against `customFields: {}` instead of failing
    // (see `buildInitiatorMetadataSnapshot`).
    const initiatorMetadataSnapshot = await this.buildInitiatorMetadataSnapshot(
      {
        authContext: authContext ?? createWorkflowAuthContext(memberId),
        memberId,
        submission: null,
      },
    );

    return templates.filter((template) =>
      this.isInitiatorPolicyMet(
        template,
        template.currentVersionId
          ? (versionById.get(template.currentVersionId) ?? null)
          : null,
        initiatorMetadataSnapshot,
        'launchable templates',
      ),
    );
  }

  /**
   * The published version whose form `memberId` may read data-source options
   * for when starting `templateId`, or `null` when they may not.
   *
   * It applies the same checks as {@link listLaunchableApprovalTemplates} to
   * that one template, but asks the host's initiator `customFields` resolver
   * with `purpose: 'FORM_OPTIONS'` and the template and version ids. A host can
   * therefore open a template's options to members who may not submit it
   * themselves — a template only the host's backend submits — without the
   * template appearing in their launchable list. The snapshot is used for this
   * judgement only and is never stored. A resolver failure judges against
   * `customFields: {}`, as the list does, so a policy that reads
   * `initiator.customFields` then fails closed.
   */
  async readFormOptionsTemplateVersion(
    templateId: string,
    memberId: string,
    authContext?: BPMAuthContext,
  ): Promise<ApprovalTemplateVersionEntity | null> {
    const template = await this.approvalTemplateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template?.currentVersionId) {
      return null;
    }

    const currentVersion = await this.approvalTemplateVersionRepository.findOne(
      {
        where: {
          id: template.currentVersionId,
          status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        },
      },
    );

    if (!currentVersion?.formDefinitionVersionId) {
      return null;
    }

    const initiatorMetadataSnapshot = await this.buildInitiatorMetadataSnapshot(
      {
        authContext: authContext ?? createWorkflowAuthContext(memberId),
        formOptions: {
          templateId: template.id,
          templateVersionId: currentVersion.id,
        },
        memberId,
        submission: null,
      },
    );

    return this.isInitiatorPolicyMet(
      template,
      currentVersion,
      initiatorMetadataSnapshot,
      'form options',
    )
      ? currentVersion
      : null;
  }

  /**
   * Whether `template`'s current published version lets the member described
   * by `initiatorMetadataSnapshot` start it: the launchable list and the form
   * options check share this, so the two cannot drift apart. `scope` only
   * names the caller in the log.
   */
  private isInitiatorPolicyMet(
    template: ApprovalTemplateEntity,
    currentVersion: ApprovalTemplateVersionEntity | null,
    initiatorMetadataSnapshot: Readonly<Record<string, unknown>>,
    scope: 'form options' | 'launchable templates',
  ): boolean {
    if (!currentVersion?.formDefinitionVersionId) {
      return false;
    }

    // A policy in a dialect this version does not know cannot be evaluated,
    // so the template is not launchable (fail closed), but only that one:
    // publishing does not check the field yet (Phase 23 P2), and one such
    // version must not break the list for every member.
    if (
      hasExpressionText(currentVersion.initiatorPolicyCel) &&
      !isReadableExpressionDialect(currentVersion.workflowDefinition)
    ) {
      this.logger.warn(
        `template=${template.id} version=${currentVersion.id} left out of ${scope}: unknown expression dialect`,
      );

      return false;
    }

    // Each template is its own operation, so one slow template cannot use
    // up the allowance of the rest of the list. A policy that throws (for
    // example a missing `initiator.customFields.*` key, because the resolver
    // did not return it, or failed and the list fell back to `{}`) is also
    // only that template's problem: it is left out, and the error code is
    // logged, never the values.
    try {
      return runExpressionOperation(() =>
        this.conditionService.evaluateBoolean(
          currentVersion.initiatorPolicyCel,
          buildInitiatorPolicyContext(initiatorMetadataSnapshot),
          'initiatorPolicyCel',
          readExpressionDialectOptions(
            currentVersion.initiatorPolicyCel,
            currentVersion.workflowDefinition,
          ),
        ),
      );
    } catch (error: unknown) {
      const reason =
        error instanceof ExpressionRuntimeError ? error.code : 'UNEXPECTED';

      this.logger.warn(
        `template=${template.id} version=${currentVersion.id} left out of ${scope}: initiatorPolicyCel failed (${reason})`,
      );

      return false;
    }
  }

  async listWorkflowTokens(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly WorkflowTokenEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.workflowTokenRepository.find({
      order: { createdAt: 'ASC' },
      where: { instanceId },
    });
  }

  async listTasks(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.attachTaskCandidateSummaries(
      await this.taskRepository.find({
        order: { createdAt: 'ASC' },
        where: { instanceId },
      }),
    );
  }

  /**
   * The member's open tasks, newest first. Without `page` / `pageSize` every
   * one is returned, as before paging existed. The page is cut from the same
   * {@link readOpenInboxTasks} result the dashboard counters read, so the list,
   * {@link countInboxTasks} and the counters cannot disagree; only the page is
   * given its candidate summaries.
   */
  async listInboxTasks(
    assigneeMemberId: string,
    options: TaskListPageOptions = {},
  ): Promise<readonly TaskEntity[]> {
    const openTasks = await this.readSharedOpenInboxTasks(assigneeMemberId);

    if (!isTaskListPaged(options)) {
      return this.attachTaskCandidateSummaries(openTasks);
    }

    const offset = readPageOffset(options.page, options.pageSize);

    return this.attachTaskCandidateSummaries(
      openTasks.slice(offset, offset + normalizePageSize(options.pageSize)),
    );
  }

  /** How many tasks {@link listInboxTasks} pages through. */
  async countInboxTasks(assigneeMemberId: string): Promise<number> {
    return (await this.readSharedOpenInboxTasks(assigneeMemberId)).length;
  }

  /**
   * {@link readOpenInboxTasks} for the inbox list and its count, joining a
   * read for the same member that is still in flight. The client asks for
   * `inboxTasks` and `inboxTaskCount` in one request and GraphQL resolves the
   * two side by side, so this turns two identical reads into one. An entry
   * lives only until its read settles: nothing is cached across requests, and
   * a read that started earlier is never served once it has finished.
   */
  private readSharedOpenInboxTasks(
    assigneeMemberId: string,
  ): Promise<readonly TaskEntity[]> {
    const inFlight = this.openInboxReadsInFlight.get(assigneeMemberId);

    if (inFlight) {
      return inFlight;
    }

    const read = this.readOpenInboxTasks(assigneeMemberId).finally((): void => {
      this.openInboxReadsInFlight.delete(assigneeMemberId);
    });

    this.openInboxReadsInFlight.set(assigneeMemberId, read);

    return read;
  }

  /**
   * The open tasks that are this member's own to act on — the single
   * definition behind both the inbox list and the dashboard counters, so the
   * two can never disagree. A task is theirs when it is assigned to them, or
   * when they hold a PENDING or CLAIMED candidate row on it. A sequential
   * chain's later candidates sit in WAITING until it is their turn, so a task
   * that has not reached them is not theirs yet.
   */
  private async readOpenInboxTasks(
    assigneeMemberId: string,
    candidateStatuses: readonly TaskCandidateStatusEnum[] = [
      TaskCandidateStatusEnum.PENDING,
      TaskCandidateStatusEnum.CLAIMED,
    ],
  ): Promise<readonly TaskEntity[]> {
    const directTasks = await this.taskRepository.find({
      order: { createdAt: 'DESC' },
      where: [
        {
          assigneeMemberId,
          status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
        },
      ],
    });
    const candidateRows = await this.taskCandidateRepository.find({
      where: {
        memberId: assigneeMemberId,
        status: In(candidateStatuses),
      },
    });
    const candidateTasks = candidateRows.length
      ? await this.taskRepository.find({
          order: { createdAt: 'DESC' },
          where: {
            id: In(candidateRows.map((candidate) => candidate.taskId)),
            status: In([TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS]),
          },
        })
      : [];
    const openTasks = uniqueTasksById([...directTasks, ...candidateTasks]);
    // Deciding on a group task writes the decider into `assigneeMemberId`, so
    // a task that stays open for the others — a `PARALLEL_ALL` countersign —
    // keeps matching `directTasks` for somebody who has already voted. Their
    // own candidate row is the authority: once it is COMPLETED the task is no
    // longer theirs to act on, and opening it again only raises "was already
    // decided by this member".
    //
    // Scoped to the tasks already in hand: unscoped it would load every row
    // this member has ever settled, on every inbox load. TRANSFERRED is not
    // among the statuses because transferring sets the task itself to
    // TRANSFERRED, which both queries above already exclude.
    const settledCandidateRows = openTasks.length
      ? await this.taskCandidateRepository.find({
          where: {
            memberId: assigneeMemberId,
            status: TaskCandidateStatusEnum.COMPLETED,
            taskId: In(openTasks.map((task) => task.id)),
          },
        })
      : [];
    const settledTaskIds = new Set(
      settledCandidateRows.map((candidate) => candidate.taskId),
    );

    return openTasks.filter((task) => !settledTaskIds.has(task.id));
  }

  /**
   * The tasks this member has acted on, most recently acted on first: tasks
   * assigned to them that are COMPLETED, and tasks on which their own
   * candidate row is COMPLETED. The latter needs no status on the task: a
   * countersign still waiting on somebody else already carries their vote, and
   * the inbox has stopped showing it to them.
   *
   * "Acted on" is their candidate row's `decided_at`, else the task's
   * `completed_at`, else its `created_at`; ties fall back to the task id so no
   * row moves between pages. Paged in SQL. Without `page` / `pageSize` the
   * latest {@link DEFAULT_APPROVAL_HISTORY_TASK_LIMIT} are returned, as before
   * paging existed. `instanceState` keeps only tasks of instances in that
   * state (RUNNING for "acted on, not finished").
   */
  async listApprovalHistoryTasks(
    assigneeMemberId: string,
    options: ApprovalHistoryTaskListOptions = {},
  ): Promise<readonly TaskEntity[]> {
    const paged = isTaskListPaged(options);
    const tasks = await this.createApprovalHistoryTaskQuery(
      assigneeMemberId,
      options.instanceState,
    )
      .orderBy(this.readApprovalHistoryActedAtExpression(), 'DESC')
      .addOrderBy('"task"."id"', 'DESC')
      .offset(paged ? readPageOffset(options.page, options.pageSize) : 0)
      .limit(
        paged
          ? normalizePageSize(options.pageSize)
          : DEFAULT_APPROVAL_HISTORY_TASK_LIMIT,
      )
      .getMany();

    return this.attachTaskCandidateSummaries(tasks);
  }

  /** How many tasks {@link listApprovalHistoryTasks} pages through. */
  async countApprovalHistoryTasks(
    assigneeMemberId: string,
    options: Pick<ApprovalHistoryTaskListOptions, 'instanceState'> = {},
  ): Promise<number> {
    return this.createApprovalHistoryTaskQuery(
      assigneeMemberId,
      options.instanceState,
    ).getCount();
  }

  /** The rows of {@link listApprovalHistoryTasks}, unordered and unpaged. */
  private createApprovalHistoryTaskQuery(
    assigneeMemberId: string,
    instanceState: ApprovalInstanceStateEnum | undefined,
  ): SelectQueryBuilder<TaskEntity> {
    const candidateTable = this.readQualifiedTableName(
      this.taskCandidateRepository,
    );
    const queryBuilder = this.taskRepository
      .createQueryBuilder('task')
      .andWhere(
        `
          (
            (
              "task"."assignee_member_id" = :historyMemberId
              AND "task"."status" = :historyTaskStatus
            )
            OR EXISTS (
              SELECT 1
              FROM ${candidateTable} "historyCandidate"
              WHERE "historyCandidate"."task_id" = "task"."id"
                AND "historyCandidate"."member_id" = :historyMemberId
                AND "historyCandidate"."status" = :historyCandidateStatus
            )
          )
        `,
        {
          historyCandidateStatus: TaskCandidateStatusEnum.COMPLETED,
          historyMemberId: assigneeMemberId,
          historyTaskStatus: TaskStatusEnum.COMPLETED,
        },
      );

    if (instanceState) {
      queryBuilder.andWhere(
        `
          EXISTS (
            SELECT 1
            FROM ${this.readQualifiedTableName(this.approvalInstanceRepository)} "historyInstance"
            WHERE "historyInstance"."id" = "task"."instance_id"
              AND "historyInstance"."state" = :historyInstanceState
          )
        `,
        { historyInstanceState: instanceState },
      );
    }

    return queryBuilder;
  }

  /** When the member acted on a history task; see {@link listApprovalHistoryTasks}. */
  private readApprovalHistoryActedAtExpression(): string {
    const candidateTable = this.readQualifiedTableName(
      this.taskCandidateRepository,
    );

    return `COALESCE(
      (
        SELECT MAX("actedCandidate"."decided_at")
        FROM ${candidateTable} "actedCandidate"
        WHERE "actedCandidate"."task_id" = "task"."id"
          AND "actedCandidate"."member_id" = :historyMemberId
          AND "actedCandidate"."status" = :historyCandidateStatus
      ),
      "task"."completed_at",
      "task"."created_at"
    )`;
  }

  async listTaskDecisions(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskDecisionEntity[]> {
    await this.assertTaskReadable(taskId, scope);

    return this.taskDecisionRepository.find({
      order: { decidedAt: 'ASC' },
      where: { taskId },
    });
  }

  async listTaskCandidates(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly TaskCandidateEntity[]> {
    await this.assertTaskReadable(taskId, scope);

    return this.taskCandidateRepository.find({
      order: {
        sequence: { direction: 'ASC', nulls: 'LAST' },
        createdAt: 'ASC',
        id: 'ASC',
      },
      where: { taskId },
    });
  }

  private async attachTaskCandidateSummaries(
    tasks: readonly TaskEntity[],
  ): Promise<readonly TaskEntity[]> {
    if (!tasks.length) {
      return tasks;
    }

    const candidates = await this.taskCandidateRepository.find({
      order: {
        sequence: { direction: 'ASC', nulls: 'LAST' },
        createdAt: 'ASC',
        id: 'ASC',
      },
      where: { taskId: In(tasks.map((task) => task.id)) },
    });
    const candidatesByTaskId = candidates.reduce<
      ReadonlyMap<string, readonly string[]>
    >((currentMap, candidate) => {
      const nextMap = new Map(currentMap);
      const memberIds = nextMap.get(candidate.taskId) ?? [];

      nextMap.set(candidate.taskId, [...memberIds, candidate.memberId]);

      return nextMap;
    }, new Map<string, readonly string[]>());

    const openCandidatesByTaskId = candidates
      .filter(
        (candidate) =>
          candidate.status === TaskCandidateStatusEnum.PENDING ||
          candidate.status === TaskCandidateStatusEnum.CLAIMED,
      )
      .reduce<ReadonlyMap<string, readonly string[]>>(
        (currentMap, candidate) => {
          const nextMap = new Map(currentMap);

          nextMap.set(candidate.taskId, [
            ...(nextMap.get(candidate.taskId) ?? []),
            candidate.memberId,
          ]);

          return nextMap;
        },
        new Map<string, readonly string[]>(),
      );

    const nodeSummaries = await this.readTaskNodeSummaries(tasks);

    return tasks.map((task) => {
      const nodeSummary = nodeSummaries.get(
        readNodeLabelKey(task.instanceId, task.nodeId),
      );

      return Object.assign(new TaskEntity(), task, {
        candidateMemberIds: candidatesByTaskId.get(task.id) ?? [],
        hasFillableFields:
          !task.isAdhoc && (nodeSummary?.hasFillableFields ?? false),
        nodeLabel: nodeSummary?.label ?? null,
        openCandidateMemberIds: openCandidatesByTaskId.get(task.id) ?? [],
      });
    });
  }

  /**
   * The display names of the nodes a page of tasks sits on, and whether each
   * is a user task that lets its approver fill in fields, keyed by
   * {@link readNodeLabelKey}. One query for the whole page, and Postgres picks
   * the labels out of the snapshots: a workflow snapshot is a whole workflow
   * definition, and every inbox, history and instance task list runs this, so
   * shipping the snapshots to the app just to read one string each would cost
   * page size × snapshot size on every refresh. A missing instance or node, a
   * snapshot without a `nodes` array, and a blank or non-string label all
   * leave the task without a label, as `readWorkflowNodeLabel` does. Only the
   * node's `fieldAccess` leaves the database for the fill flag, which
   * `readNodeFillableFieldKeys` then reads as tolerantly as the engine does.
   */
  private async readTaskNodeSummaries(
    tasks: readonly TaskEntity[],
  ): Promise<
    ReadonlyMap<
      string,
      { readonly hasFillableFields: boolean; readonly label: string | null }
    >
  > {
    // The table as the entity reads it, so a configured `schema` is honoured
    // here exactly as it is by every repository read of the instance.
    const { metadata } = this.approvalInstanceRepository;
    const { driver } = this.approvalInstanceRepository.manager.connection;
    const instanceTable = [metadata.schema, metadata.tableName]
      .filter((part): part is string => Boolean(part))
      .map((part) => driver.escape(part))
      .join('.');
    const rows = await this.approvalInstanceRepository.query<
      readonly {
        readonly fieldAccess: unknown;
        readonly instanceId: string;
        readonly label: string | null;
        readonly nodeId: string;
        readonly nodeType: string | null;
      }[]
    >(
      `SELECT instance.id AS "instanceId",
              node->>'id' AS "nodeId",
              node->>'type' AS "nodeType",
              node->'data'->'fieldAccess' AS "fieldAccess",
              CASE WHEN jsonb_typeof(node->'data'->'label') = 'string'
                   THEN node->'data'->>'label' END AS "label"
         FROM ${instanceTable} AS instance
        CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(instance.workflow_snapshot->'nodes') = 'array'
                   THEN instance.workflow_snapshot->'nodes'
                   ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS entry(node, position)
        WHERE instance.id = ANY($1::uuid[])
          AND node->>'id' = ANY($2::text[])
        ORDER BY entry.position DESC`,
      [
        [...new Set(tasks.map((task) => task.instanceId))],
        [...new Set(tasks.map((task) => task.nodeId))],
      ],
    );

    // Rows come last node first, so the first node with a given id wins, as
    // `find` does everywhere else that reads a snapshot node by id.
    return new Map(
      rows.map((row) => [
        readNodeLabelKey(row.instanceId, row.nodeId),
        {
          hasFillableFields:
            row.nodeType === 'userTask' &&
            readNodeFillableFieldKeys({
              data: { fieldAccess: row.fieldAccess },
            } as UserTaskNode).size > 0,
          label:
            typeof row.label === 'string' && row.label.trim()
              ? row.label
              : null,
        },
      ]),
    );
  }

  private async readDefaultInitiatorMetadataSnapshot(
    memberId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const today = this.readOrganizationToday();
    const memberships = (
      await this.approvalInstanceRepository.manager
        .getRepository(MembershipEntity)
        .find({ where: { memberId } })
    )
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership);
    const primaryMembership = memberships[0] ?? null;
    const positionIds = uniqueTexts(
      memberships
        .map((membership) => membership.positionId)
        .filter((positionId): positionId is string => Boolean(positionId)),
    );

    return {
      customFields: {},
      memberId,
      orgUnitIds: uniqueTexts(
        memberships.map((membership) => membership.orgUnitId),
      ),
      positionId: primaryMembership?.positionId ?? null,
      positionIds,
      primaryOrgUnitId: primaryMembership?.orgUnitId ?? null,
    };
  }

  /**
   * The initiator snapshot the engine builds itself: what it knows of the
   * initiator, with `customFields` filled by the host's resolver when there is
   * one. Without a resolver this is exactly the default snapshot
   * (`customFields` is `{}`). A submission (`submission` set) stores it and
   * judges the initiator policy with it; the launchable template list
   * (`submission: null`) only judges the policies with it, so both see the same
   * `customFields` for the same member.
   *
   * Only `customFields` comes from the host. The other keys are the engine's
   * and are written back after the resolver returns, so nothing it does can
   * change who the initiator is. The resolver gets copies of the snapshot and
   * of the form data for the same reason; `authContext` is the caller's own
   * object, as every other host hook receives it.
   *
   * The two callers treat a resolver failure (an error, a bad value, the
   * timeout) differently, on purpose:
   *
   * - A submission fails, and no case is created. Its snapshot is stored and
   *   routes the case from then on, so carrying on with `{}` would start a
   *   case on data the host never gave. It runs before the engine
   *   transaction, so a failure leaves nothing behind and a slow lookup holds
   *   no lock.
   * - The list, and the form options check, carry on with `customFields: {}`
   *   and log a warning: one failing lookup must not take the whole list
   *   away. That fails closed: a
   *   policy that reads `initiator.customFields` then throws on the missing key
   *   and the list's per-template catch leaves that template out, while a
   *   template whose policy does not read it is listed as usual. Submitting is
   *   still judged against the resolver's real answer.
   */
  private async buildInitiatorMetadataSnapshot({
    authContext,
    formOptions = null,
    memberId,
    submission,
  }: {
    readonly authContext: BPMAuthContext;
    /** Set for the form options check; the list leaves both out. */
    readonly formOptions?: {
      readonly templateId: string;
      readonly templateVersionId: string;
    } | null;
    readonly memberId: string;
    readonly submission: {
      readonly formData: Readonly<Record<string, unknown>>;
      readonly templateId: string;
      readonly templateVersionId: string;
    } | null;
  }): Promise<Readonly<Record<string, unknown>>> {
    const defaultSnapshot =
      await this.readDefaultInitiatorMetadataSnapshot(memberId);

    if (!this.initiatorCustomFieldsResolver) {
      return defaultSnapshot;
    }

    // The template the resolver is asked about: the one being submitted, or
    // the one whose options are read. The list asks about none.
    const template = submission ?? formOptions;
    const input: BPMInitiatorCustomFieldsInput = {
      authContext,
      defaultSnapshot: cloneJsonObject(defaultSnapshot),
      formData: submission ? cloneJsonObject(submission.formData) : null,
      memberId,
      purpose: readInitiatorCustomFieldsPurpose({ formOptions, submission }),
      templateId: template?.templateId ?? null,
      templateVersionId: template?.templateVersionId ?? null,
    };

    if (submission) {
      return {
        ...defaultSnapshot,
        customFields: await this.resolveInitiatorCustomFields(
          this.initiatorCustomFieldsResolver,
          input,
        ),
      };
    }

    try {
      return {
        ...defaultSnapshot,
        customFields: await this.resolveInitiatorCustomFields(
          this.initiatorCustomFieldsResolver,
          input,
        ),
      };
    } catch (error: unknown) {
      this.logger.warn(
        `${
          formOptions
            ? `Form options for template=${formOptions.templateId}`
            : 'Launchable templates'
        } judged with customFields {}: the initiator customFields resolver failed (${
          error instanceof HttpException ? error.getStatus() : 'UNEXPECTED'
        })`,
      );

      return defaultSnapshot;
    }
  }

  /**
   * Calls the host's initiator `customFields` resolver within
   * {@link INITIATOR_CUSTOM_FIELDS_RESOLVER_TIMEOUT_MS} and returns what it
   * gave as the object the snapshot keeps.
   *
   * Every failure becomes an `InternalServerErrorException` with a message
   * meant for the member, and the cause goes to the log only, so nothing of
   * the host's lookup reaches the client: running out of time, an error that
   * is not an `HttpException`, and a value that is not a plain JSON object. An
   * `HttpException` the resolver throws is passed on as it is, because the
   * host chose that answer for the member.
   *
   * A resolver that settles after the time has run out is not waited for; what
   * it settles with is logged and dropped, so a late rejection is never left
   * unhandled.
   */
  private async resolveInitiatorCustomFields(
    resolver: BPMInitiatorCustomFieldsResolver,
    input: BPMInitiatorCustomFieldsInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const subject =
      input.purpose === 'LAUNCHABLE_TEMPLATES'
        ? 'launchable templates'
        : `${input.purpose === 'FORM_OPTIONS' ? 'form options ' : ''}template=${input.templateId} version=${input.templateVersionId}`;
    const outcome = await settleWithin(
      new Promise<unknown>((resolve: (value: unknown) => void): void => {
        resolve(resolver.resolveCustomFields(input));
      }),
      INITIATOR_CUSTOM_FIELDS_RESOLVER_TIMEOUT_MS,
      (late: SettledOutcome): void => {
        this.logger.warn(
          `Initiator customFields resolver settled after the ${INITIATOR_CUSTOM_FIELDS_RESOLVER_TIMEOUT_MS} ms timeout (${subject}); ${
            late.status === 'fulfilled'
              ? 'its value was dropped'
              : `its error was dropped: ${describeRejection(late.reason)}`
          }`,
        );
      },
    );

    if (outcome.status === 'timeout') {
      this.logger.error(
        `Initiator customFields resolver timed out after ${INITIATOR_CUSTOM_FIELDS_RESOLVER_TIMEOUT_MS} ms (${subject})`,
      );

      throw new InternalServerErrorException(
        INITIATOR_CUSTOM_FIELDS_TIMEOUT_MESSAGE,
      );
    }

    if (outcome.status === 'rejected') {
      if (outcome.reason instanceof HttpException) {
        throw outcome.reason;
      }

      this.logger.error(
        `Initiator customFields resolver failed (${subject}): ${describeRejection(outcome.reason)}`,
        outcome.reason instanceof Error ? outcome.reason.stack : undefined,
      );

      throw new InternalServerErrorException(
        INITIATOR_CUSTOM_FIELDS_FAILED_MESSAGE,
      );
    }

    const customFields = readResolvedInitiatorCustomFields(outcome.value);

    if (!customFields.ok) {
      this.logger.error(
        `Initiator customFields resolver returned an unusable value (${subject}): ${customFields.problem}`,
      );

      throw new InternalServerErrorException(
        INITIATOR_CUSTOM_FIELDS_INVALID_MESSAGE,
      );
    }

    return customFields.value;
  }

  async listActivityLogs(
    instanceId: string,
    scope?: WorkflowReadScope,
  ): Promise<readonly ActivityLogEntity[]> {
    await this.getApprovalInstance(instanceId, scope);

    return this.activityLogRepository.find({
      order: { seq: 'ASC' },
      where: { instanceId },
    });
  }

  private async assertTaskReadable(
    taskId: string,
    scope?: WorkflowReadScope,
  ): Promise<TaskEntity> {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    await this.getApprovalInstance(task.instanceId, scope);

    return task;
  }

  private async isApprovalInstanceReadableByMember(
    instance: ApprovalInstanceEntity,
    memberId: string,
  ): Promise<boolean> {
    // The member who filed the document on the applicant's behalf can read it
    // back; resubmit and cancel stay with the initiator.
    if (
      instance.initiatorMemberId === memberId ||
      readDistinctSubmitterMemberId(instance) === memberId
    ) {
      return true;
    }

    const tasks = await this.taskRepository.find({
      where: { instanceId: instance.id },
    });

    if (tasks.some((task) => isTaskRelatedToMember(task, memberId))) {
      return true;
    }

    const taskIds = tasks.map((task) => task.id);

    if (!taskIds.length) {
      return false;
    }

    const candidates = await this.taskCandidateRepository.find({
      where: { taskId: In(taskIds) },
    });

    if (
      candidates.some(
        (candidate) =>
          candidate.memberId === memberId ||
          candidate.originalMemberId === memberId,
      )
    ) {
      return true;
    }

    const decisions = await this.taskDecisionRepository.find({
      where: { taskId: In(taskIds) },
    });

    if (decisions.some((decision) => decision.decidedByMemberId === memberId)) {
      return true;
    }

    // Members who received any notification for this instance (e.g. ad-hoc
    // stage / completion notify recipients, CC'd service-task recipients) may
    // open the instance they were notified about.
    const notification = await this.notificationRepository.findOne({
      where: { instanceId: instance.id, recipientMemberId: memberId },
    });

    return Boolean(notification);
  }

  private async processActiveToken(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
  ): Promise<void> {
    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      token.currentNodeId,
    );

    if (!(await this.isNodeEntryReady(manager, instance, token, node))) {
      return;
    }

    if (!this.isNodeEntryConditionMet(instance, node)) {
      await this.skipNodeByEntryCondition(manager, instance, token, node);

      return;
    }

    if (node.type === 'startEvent') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    if (node.type === 'endEvent') {
      await this.completeTokenAtEndNode(manager, instance, token, node);

      return;
    }

    if (node.type === 'userTask') {
      await this.createUserTaskForToken(manager, instance, token, node);

      return;
    }

    if (node.type === 'serviceTask') {
      await this.executeServiceTask(manager, instance, token, node);

      return;
    }

    if (node.type === 'exclusiveGateway') {
      await this.processExclusiveGateway(manager, instance, token, node);

      return;
    }

    if (node.type === 'parallelGateway') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    return;
  }

  private async processRunningInstance(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
  ): Promise<void> {
    for (let step = 0; step < MAX_PROCESSING_STEPS; step += 1) {
      const token = await manager.getRepository(WorkflowTokenEntity).findOne({
        order: { createdAt: 'ASC' },
        where: {
          instanceId: instance.id,
          status: WorkflowTokenStatusEnum.ACTIVE,
        },
      });

      if (!token) {
        await this.completeInstanceIfNoOpenRuntimeState(manager, instance);

        return;
      }

      await this.processActiveToken(manager, instance, token);
    }

    throw new ConflictException(
      `Approval instance ${instance.id} exceeded maximum processing steps`,
    );
  }

  private async completeInstanceIfNoOpenRuntimeState(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
  ): Promise<void> {
    if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
      return;
    }

    // Both open statuses, not just WAITING. Today this is reached only from
    // `processRunningInstance`, whose loop has already established that no
    // ACTIVE token remains, so the extra status changes no current behaviour —
    // but nothing enforces that invariant, and a second caller arriving
    // without it would complete a case while somebody still had a task open.
    const openTokens = await manager.getRepository(WorkflowTokenEntity).find({
      where: {
        instanceId: instance.id,
        status: In([
          WorkflowTokenStatusEnum.ACTIVE,
          WorkflowTokenStatusEnum.WAITING,
        ]),
      },
    });

    if (openTokens.length > 0) {
      return;
    }

    const completedAt = new Date();
    // Update the tracked entity in place instead of saving a copy of it. The
    // caller still holds this object and may return it — `submitApprovalInstance`
    // hands it straight back to the resolver — so writing a copy left the
    // mutation reporting `RUNNING` with a null `completedAt` on a case the same
    // transaction had already committed as `APPROVED`. Assigning in place also
    // preserves whatever the caller handed in, so an entity stays an entity
    // and its getter-backed `*Json` fields survive. It cannot upgrade a plain
    // object, and the resubmit and return paths do pass a plain copy of their
    // own — a separate problem this does not fix.
    const completedInstance = await manager
      .getRepository(ApprovalInstanceEntity)
      .save(
        Object.assign(instance, {
          completedAt,
          state: ApprovalInstanceStateEnum.APPROVED,
        }),
      );

    await this.notificationService.createInstanceCompletedNotification({
      instance: completedInstance,
      manager,
    });
    await this.dispatchAdhocCompletionNotifications(
      manager,
      completedInstance,
      ApprovalInstanceStateEnum.APPROVED,
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, null);
  }

  private async isNodeEntryReady(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<boolean> {
    if (node.type === 'startEvent') {
      return true;
    }

    const incomingEdges = readIncomingEdges(instance.workflowSnapshot, node.id);

    if (incomingEdges.length < 2) {
      return true;
    }

    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const activeOrWaitingTokens = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
      (candidate) =>
        candidate.currentNodeId === node.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING),
    );
    const arrivedTokens = activeOrWaitingTokens.some(
      (candidate) => candidate.id === token.id,
    )
      ? activeOrWaitingTokens
      : [...activeOrWaitingTokens, token];

    if ((node.data.triggerMode ?? 'AND') === 'OR') {
      await this.cancelAlternativeTokensForOrTrigger(
        manager,
        instance,
        token,
        node.id,
      );
      await this.consumeJoinedTokens(
        manager,
        arrivedTokens.filter((candidate) => candidate.id !== token.id),
      );

      return true;
    }

    const pendingTokensThatMayReachNode = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
      (candidate) =>
        candidate.id !== token.id &&
        !arrivedTokens.some(
          (arrivedToken) => arrivedToken.id === candidate.id,
        ) &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING) &&
        hasPathToNode(
          instance.workflowSnapshot,
          candidate.currentNodeId,
          node.id,
        ),
    );

    if (
      arrivedTokens.length < incomingEdges.length &&
      pendingTokensThatMayReachNode.length > 0
    ) {
      await tokenRepository.save({
        ...token,
        status: WorkflowTokenStatusEnum.WAITING,
      });
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            arrivedCount: arrivedTokens.length,
            requiredCount: incomingEdges.length,
            tokenId: token.id,
            triggerMode: 'AND',
          },
          taskId: null,
        }),
      );

      return false;
    }

    await this.consumeJoinedTokens(
      manager,
      arrivedTokens.filter((candidate) => candidate.id !== token.id),
    );

    return true;
  }

  private async advanceTokenToOutgoingNodes(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<void> {
    const edges = await this.readAvailableOutgoingEdges(
      manager,
      instance,
      node,
    );

    if (edges.length === 1) {
      await this.advanceTokenAlongEdge(
        manager,
        instance,
        token,
        node,
        edges[0],
      );

      return;
    }

    await this.forkTokenAlongEdges(manager, instance, token, node, edges);
  }

  private isNodeEntryConditionMet(
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
  ): boolean {
    const entryCondition = readNodeEntryCondition(node);

    return this.conditionService.evaluateBoolean(
      entryCondition,
      buildWorkflowExpressionContext(instance),
      `workflow.nodes.${node.id}.data.entryCondition`,
      readExpressionDialectOptions(entryCondition, instance.workflowSnapshot),
    );
  }

  private async skipNodeByEntryCondition(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
  ): Promise<void> {
    await this.skipNode(manager, instance, token, node, {
      skippedByEntryCondition: true,
    });
  }

  private async skipNodeByInitiatorExclusion(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    skippedBy: SkippedRuntimeTask['skippedBy'] = 'INITIATOR',
  ): Promise<void> {
    await this.skipNode(
      manager,
      instance,
      token,
      node,
      skippedBy === 'NODE_ACTORS'
        ? { skippedByNodeActorExclusion: true }
        : { skippedByInitiatorExclusion: true },
    );
  }

  private async skipNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    reason: Readonly<Record<string, true>>,
  ): Promise<void> {
    // A NOTIFY node is an asynchronous branch that may not have an outgoing
    // edge, so a skipped one ends its branch exactly as an executed one does:
    // the token is consumed instead of advanced (advancing would throw "has no
    // outgoing edge" and fail the whole submission). Instance completion is
    // evaluated by `processRunningInstance` once no ACTIVE token remains.
    const consumesToken = isAsyncNotifyServiceTask(node);

    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          ...reason,
          ...(consumesToken ? { consumed: true } : {}),
          tokenId: token.id,
        },
        taskId: null,
      }),
    );

    if (consumesToken) {
      await this.consumeToken(manager, token);

      return;
    }

    await this.advanceTokenToOutgoingNodes(manager, instance, token, node);
  }

  private async consumeToken(
    manager: EntityManager,
    token: WorkflowTokenEntity,
  ): Promise<void> {
    await manager.getRepository(WorkflowTokenEntity).save({
      ...token,
      consumedAt: new Date(),
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
  }

  private async readAvailableOutgoingEdges(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
  ): Promise<readonly WorkflowEdge[]> {
    const outgoingEdges = readOutgoingEdgesOrThrow(
      instance.workflowSnapshot,
      node.id,
    );
    const conditionalEdges = outgoingEdges.filter(
      (edge) => !edge.data.isDefault && edgeHasCondition(edge),
    );

    if (conditionalEdges.length === 0) {
      return outgoingEdges;
    }

    const matchingEdges = (
      await Promise.all(
        conditionalEdges.map(async (edge): Promise<WorkflowEdge | null> =>
          (await this.evaluateWorkflowEdge(manager, instance, node, edge))
            ? edge
            : null,
        ),
      )
    ).filter((edge): edge is WorkflowEdge => edge !== null);

    if (matchingEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [matchingEdges[0]]
        : matchingEdges;
    }

    const defaultEdges = outgoingEdges.filter((edge) => edge.data.isDefault);

    if (defaultEdges.length > 0) {
      return node.type === 'exclusiveGateway'
        ? [defaultEdges[0]]
        : defaultEdges;
    }

    throw new ConflictException(
      `Workflow node ${node.id} has no matching outgoing edge`,
    );
  }

  private async evaluateWorkflowEdge(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: WorkflowNode,
    edge: WorkflowEdge,
  ): Promise<boolean> {
    const expression = readEvaluableEdgeExpression(edge, instance.formData);

    if (!expression) {
      return evaluateWorkflowEdgeCondition(edge, {
        formData: instance.formData,
      });
    }

    const context = {
      ...buildWorkflowExpressionContext(instance),
      lastDecision: await this.readLastDecisionContext(
        manager,
        instance.id,
        node.id,
      ),
    };

    return evaluateWithStructuredFallback(
      edge,
      instance.formData,
      (message: string): void =>
        this.logger.warn(`instance=${instance.id} ${message}`),
      (): boolean =>
        this.conditionService.evaluateBoolean(
          expression,
          context,
          `workflow.edges.${edge.id}.data.condition`,
          { dialect: readWorkflowExpressionDialect(instance.workflowSnapshot) },
        ),
    );
  }

  private async readLastDecisionContext(
    manager: EntityManager,
    instanceId: string,
    nodeId: string,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    const tasks = await manager.getRepository(TaskEntity).find({
      where: { instanceId, nodeId },
    });
    const taskIds = tasks.map((task) => task.id);

    if (taskIds.length === 0) {
      return null;
    }

    const decision = (
      await manager.getRepository(TaskDecisionEntity).find({
        order: { decidedAt: 'DESC' },
        where: { taskId: In(taskIds) },
      })
    )[0];

    if (!decision) {
      return null;
    }

    return {
      action: decision.action,
      comment: decision.comment,
      decidedAt: decision.decidedAt.toISOString(),
      decidedByMemberId: decision.decidedByMemberId,
      returnToNodeId: decision.returnToNodeId,
      taskId: decision.taskId,
      transferToMemberId: decision.transferToMemberId,
    };
  }

  private async advanceTokenAlongEdge(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    edge: WorkflowEdge,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const nextToken = await tokenRepository.save({
      ...token,
      currentNodeId: edge.target,
    });

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: edge.target,
        payload: {
          edgeId: edge.id,
          fromNodeId: node.id,
          tokenId: nextToken.id,
          toNodeId: edge.target,
        },
        taskId: null,
      }),
    );
  }

  private async forkTokenAlongEdges(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: WorkflowNode,
    edges: readonly WorkflowEdge[],
  ): Promise<void> {
    const forkedAt = new Date();
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await tokenRepository.save({
      ...token,
      consumedAt: forkedAt,
      status: WorkflowTokenStatusEnum.CONSUMED,
    });

    const childTokens = await tokenRepository.save(
      edges.map((edge) =>
        tokenRepository.create({
          consumedAt: null,
          currentNodeId: edge.target,
          instanceId: instance.id,
          parentTokenId: token.id,
          status: WorkflowTokenStatusEnum.ACTIVE,
        }),
      ),
    );

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          edgeIds: edges.map((edge) => edge.id),
          fromNodeId: node.id,
          tokenId: token.id,
          toNodeIds: edges.map((edge) => edge.target),
        },
        taskId: null,
      }),
      ...childTokens.map((childToken, index) =>
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
          instanceId: instance.id,
          nodeId: childToken.currentNodeId,
          payload: {
            edgeId: edges[index]?.id,
            parentTokenId: token.id,
            tokenId: childToken.id,
          },
          taskId: null,
        }),
      ),
    ]);
  }

  private async completeTokenAtEndNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: Extract<WorkflowNode, { readonly type: 'endEvent' }>,
  ): Promise<void> {
    const completedAt = new Date();
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const endState = node.data.endState ?? 'APPROVED';
    const instanceState =
      endState === 'REJECTED'
        ? ApprovalInstanceStateEnum.REJECTED
        : ApprovalInstanceStateEnum.APPROVED;

    await tokenRepository.save({
      ...token,
      consumedAt: completedAt,
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    const hasOpenToken = (
      await tokenRepository.find({
        where: { instanceId: instance.id },
      })
    ).some(
      (candidate) =>
        candidate.id !== token.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING),
    );

    if (!hasOpenToken) {
      // Update the tracked entity in place. Saving a copy left the caller's
      // `instance.state` on `RUNNING`, so the `state !== RUNNING` guard in
      // `completeInstanceIfNoOpenRuntimeState` did not short-circuit and a
      // *second* completion ran on the way out of `processRunningInstance`:
      // a duplicate completion notification on every approved case, and — far
      // worse — an `endState: 'REJECTED'` row overwritten with `APPROVED`
      // immediately after it had been committed.
      const completedInstance = await instanceRepository.save(
        Object.assign(instance, { completedAt, state: instanceState }),
      );

      if (instanceState === ApprovalInstanceStateEnum.APPROVED) {
        await this.notificationService.createInstanceCompletedNotification({
          instance: completedInstance,
          manager,
        });
      }

      await this.dispatchAdhocCompletionNotifications(
        manager,
        completedInstance,
        instanceState,
      );
      await this.cancelPendingAdhocDirectives(manager, instance.id, null);
    }
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          endState,
          instanceState,
          tokenId: token.id,
        },
        taskId: null,
      }),
    );
  }

  private async createUserTaskForToken(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: UserTaskNode,
  ): Promise<void> {
    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const existingTask = await taskRepository.findOne({
      where: {
        isAdhoc: false,
        nodeId: node.id,
        tokenId: token.id,
      },
    });

    if (existingTask) {
      await tokenRepository.save({
        ...token,
        status: WorkflowTokenStatusEnum.WAITING,
      });

      return;
    }

    const resolvedCandidates = await this.resolveRuntimeTaskCandidates(
      manager,
      instance,
      node,
    );

    // Everyone left was kept out and the node asks to be skipped in that case:
    // no task, the token moves on. Pending countersign directives stay
    // pending for the next user task that actually gets created.
    if ('skippedBy' in resolvedCandidates) {
      await this.skipNodeByInitiatorExclusion(
        manager,
        instance,
        token,
        node,
        resolvedCandidates.skippedBy,
      );

      return;
    }

    const { candidates, skippedDelegations } = resolvedCandidates;

    const primaryCandidate = candidates[0];
    // Legacy snapshots may carry no policy at all; they behave as before.
    const decisionPolicy: DecisionPolicy | undefined = node.data.decisionPolicy;
    const isSequential =
      decisionPolicy?.type === 'SEQUENTIAL' && candidates.length > 1;
    // A sequential task is held by exactly one candidate at a time, so it
    // carries that candidate as its assignee from the start.
    const assignedCandidate =
      candidates.length === 1 || isSequential ? primaryCandidate : null;
    const now = new Date();
    const slaDueAt = await this.slaScheduleService.resolveTaskSlaDueAt({
      node,
      now,
    });
    const task = await taskRepository.save(
      taskRepository.create({
        assigneeMemberId: assignedCandidate?.memberId ?? null,
        assignmentType:
          candidates.length === 1
            ? TaskAssignmentTypeEnum.DIRECT_MEMBER
            : TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        completedAt: null,
        createdAt: now,
        decisionPolicySnapshot: hasSeatExclusion(node)
          ? capDecisionPolicyToCandidateCount(decisionPolicy, candidates.length)
          : decisionPolicy,
        delegationChain: assignedCandidate?.delegationChain ?? [],
        instanceId: instance.id,
        nodeId: node.id,
        openedAt: null,
        originalAssigneeMemberId: assignedCandidate?.originalMemberId ?? null,
        slaDueAt,
        status: TaskStatusEnum.PENDING,
        tokenId: token.id,
      }),
    );
    const savedCandidates = await taskCandidateRepository.save(
      candidates.map((candidate, index) =>
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: now,
          decidedAt: null,
          delegationChain: candidate.delegationChain,
          memberId: candidate.memberId,
          originalMemberId: candidate.originalMemberId,
          sequence: isSequential ? index : null,
          sourceType: candidate.sourceType,
          status:
            isSequential && index > 0
              ? TaskCandidateStatusEnum.WAITING
              : TaskCandidateStatusEnum.PENDING,
          taskId: task.id,
        }),
      ),
    );
    // Display summary of everyone on the task, including the ones whose turn
    // has not come; who may act now is `status`, not membership of this list.
    task.candidateMemberIds = savedCandidates.map(
      (candidate) => candidate.memberId,
    );
    const singleCandidate =
      savedCandidates.length === 1 ? savedCandidates[0] : null;
    const openCandidates = savedCandidates.filter(
      (candidate) => candidate.status === TaskCandidateStatusEnum.PENDING,
    );
    task.openCandidateMemberIds = openCandidates.map(
      (candidate) => candidate.memberId,
    );
    task.hasFillableFields = readNodeFillableFieldKeys(node).size > 0;

    await tokenRepository.save({
      ...token,
      status: WorkflowTokenStatusEnum.WAITING,
    });
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          assignmentType: task.assignmentType,
          assigneeMemberId:
            (isSequential ? openCandidates[0] : singleCandidate)?.memberId ??
            null,
          candidateMemberIds: openCandidates.map(
            (candidate) => candidate.memberId,
          ),
          originalAssigneeMemberId:
            (isSequential ? openCandidates[0] : singleCandidate)
              ?.originalMemberId ?? null,
          ...(isSequential
            ? {
                sequentialCandidateMemberIds: savedCandidates.map(
                  (candidate) => candidate.memberId,
                ),
              }
            : {}),
          ...(skippedDelegations.length > 0 ? { skippedDelegations } : {}),
          tokenId: token.id,
        },
        taskId: task.id,
      }),
    );
    await openCandidates.reduce<Promise<void>>(
      async (previous, candidate): Promise<void> => {
        await previous;
        await this.notificationService.createTaskAssignedNotification({
          instance,
          manager,
          node,
          task: Object.assign(new TaskEntity(), task, {
            assigneeMemberId: candidate.memberId,
            delegationChain: candidate.delegationChain,
            originalAssigneeMemberId: candidate.originalMemberId,
          }),
        });
      },
      Promise.resolve(),
    );

    // Pending ad-hoc countersign directives attach to the next user task
    // created after they were requested — spawn their parallel tasks now.
    await this.spawnCountersignTasksForNode(
      manager,
      instance,
      token,
      node,
      now,
    );
  }

  /**
   * Hands a SEQUENTIAL task to the lowest-`sequence` candidate still WAITING.
   * A task without a WAITING candidate (every other policy, and SEQUENTIAL
   * tasks created before candidates were ordered) is left alone.
   */
  private async activateNextSequentialCandidate({
    candidates,
    instance,
    manager,
    node,
    previousMemberId,
    task,
  }: {
    readonly candidates: readonly TaskCandidateEntity[];
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
    readonly node: UserTaskNode;
    readonly previousMemberId: string;
    readonly task: TaskEntity;
  }): Promise<void> {
    if (readDecisionPolicySnapshot(task).type !== 'SEQUENTIAL') {
      return;
    }

    const nextCandidate = [...candidates]
      .filter(
        (candidate) =>
          candidate.status === TaskCandidateStatusEnum.WAITING &&
          candidate.sequence !== null,
      )
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))[0];

    if (!nextCandidate) {
      return;
    }

    const now = new Date();
    // Delegation was resolved when the task was created; the candidate may have
    // gained a delegate while waiting, so resolve it again for the new turn.
    const { skippedDelegation, ...delegation } =
      await this.resolveActivationDelegation({
        candidate: nextCandidate,
        candidates,
        excludedMemberIds: (
          await this.readNodeExclusions(manager, instance, node)
        ).memberIds,
        gradeGated: isGradeGatedCandidate(node, nextCandidate.sourceType),
        instance,
        manager,
        nodeId: task.nodeId,
      });
    const activatedCandidate = await manager
      .getRepository(TaskCandidateEntity)
      .save(
        Object.assign(new TaskCandidateEntity(), nextCandidate, delegation, {
          status: TaskCandidateStatusEnum.PENDING,
        }),
      );
    const activatedTask = await manager.getRepository(TaskEntity).save({
      ...task,
      assigneeMemberId: activatedCandidate.memberId,
      delegationChain: activatedCandidate.delegationChain,
      openedAt: null,
      originalAssigneeMemberId: activatedCandidate.originalMemberId,
      // The new holder gets the node's full SLA window, not what is left of
      // the previous holder's; the warning is measured from this moment.
      slaDueAt: await this.slaScheduleService.resolveTaskSlaDueAt({
        node,
        now,
      }),
      slaStartedAt: now,
      status: TaskStatusEnum.PENDING,
    });

    const activityRepository = manager.getRepository(ActivityLogEntity);

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        // Carries the same recipient fields as TASK_CREATED so a consumer can
        // route this event exactly like a task assignment.
        payload: {
          assigneeMemberId: activatedCandidate.memberId,
          assignmentType: activatedTask.assignmentType,
          candidateMemberId: activatedCandidate.memberId,
          candidateMemberIds: [activatedCandidate.memberId],
          originalAssigneeMemberId: activatedCandidate.originalMemberId,
          originalMemberId: activatedCandidate.originalMemberId,
          previousMemberId,
          sequence: activatedCandidate.sequence,
          ...(skippedDelegation
            ? { skippedDelegations: [skippedDelegation] }
            : {}),
          tokenId: task.tokenId,
        },
        taskId: task.id,
      }),
    );
    await this.notificationService.createTaskAssignedNotification({
      instance,
      manager,
      node,
      task: activatedTask,
    });
  }

  /**
   * Re-resolves the delegation of a candidate whose turn has come. When the
   * delegate already holds another candidate row on the task, the stored values
   * are kept: (task_id, member_id) is unique, and that member signs from the
   * row they already have. On a node that keeps members out (the initiator and
   * submitter, or the approvers of earlier stages) the stored values are kept
   * as well when the new delegation path would run through one of them:
   * creation already filtered such paths out, and a delegation added while the
   * candidate waited must not bring them back.
   */
  private async resolveActivationDelegation({
    candidate,
    candidates,
    excludedMemberIds,
    gradeGated,
    instance,
    manager,
    nodeId,
  }: {
    readonly candidate: TaskCandidateEntity;
    readonly candidates: readonly TaskCandidateEntity[];
    readonly excludedMemberIds: readonly string[];
    readonly gradeGated: boolean;
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
    readonly nodeId: string;
  }): Promise<{
    readonly delegationChain: TaskCandidateEntity['delegationChain'];
    readonly memberId: string;
    readonly skippedDelegation?: SkippedDelegation;
  }> {
    const stored = {
      delegationChain: candidate.delegationChain,
      memberId: candidate.memberId,
    };
    const { skippedDelegation, ...resolution } = await this.resolveDelegation(
      manager,
      candidate.originalMemberId,
      this.buildDelegationContext(instance, nodeId),
      gradeGated,
    );
    const collides = candidates.some(
      (other) =>
        other.id !== candidate.id &&
        other.memberId === resolution.finalAssigneeMemberId,
    );

    if (
      collides ||
      isExcludedMemberOnCandidatePath(
        {
          delegationChain: resolution.delegationChain,
          memberId: resolution.finalAssigneeMemberId,
          originalMemberId: candidate.originalMemberId,
        },
        excludedMemberIds,
      )
    ) {
      // The refusal happened even though the stored values are kept.
      return { ...stored, ...(skippedDelegation ? { skippedDelegation } : {}) };
    }

    return {
      delegationChain: resolution.delegationChain,
      memberId: resolution.finalAssigneeMemberId,
      ...(skippedDelegation ? { skippedDelegation } : {}),
    };
  }

  private async markTaskCandidateDecision({
    action,
    candidate,
    candidates,
    decidedAt,
    manager,
    task,
  }: {
    readonly action: TaskDecisionActionEnum;
    readonly candidate: TaskCandidateEntity | null;
    readonly candidates: readonly TaskCandidateEntity[];
    readonly decidedAt: Date;
    readonly manager: EntityManager;
    readonly task: TaskEntity;
  }): Promise<readonly TaskCandidateEntity[]> {
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);

    if (!candidate && candidates.length === 0 && task.assigneeMemberId) {
      const legacyCandidate = await taskCandidateRepository.save(
        taskCandidateRepository.create({
          claimedAt: task.openedAt ?? decidedAt,
          createdAt: task.createdAt,
          decidedAt,
          delegationChain: task.delegationChain,
          memberId: task.assigneeMemberId,
          originalMemberId:
            task.originalAssigneeMemberId ?? task.assigneeMemberId,
          sourceType: 'DIRECT',
          status: TaskCandidateStatusEnum.COMPLETED,
          taskId: task.id,
        }),
      );

      return [legacyCandidate];
    }

    const completedCandidate = candidate
      ? Object.assign(new TaskCandidateEntity(), candidate, {
          claimedAt: candidate.claimedAt ?? decidedAt,
          decidedAt,
          status: TaskCandidateStatusEnum.COMPLETED,
        })
      : null;
    const decisionPolicy = readDecisionPolicySnapshot(task);
    const shouldCancelOpenCandidates =
      action !== TaskDecisionActionEnum.APPROVED ||
      decisionPolicy.type === 'SINGLE' ||
      decisionPolicy.type === 'PARALLEL_ANY';
    const nextCandidates = candidates.map((currentCandidate) => {
      if (currentCandidate.id === completedCandidate?.id) {
        return completedCandidate;
      }

      if (
        shouldCancelOpenCandidates &&
        (currentCandidate.status === TaskCandidateStatusEnum.PENDING ||
          currentCandidate.status === TaskCandidateStatusEnum.CLAIMED ||
          currentCandidate.status === TaskCandidateStatusEnum.WAITING)
      ) {
        return Object.assign(new TaskCandidateEntity(), currentCandidate, {
          decidedAt,
          status: TaskCandidateStatusEnum.CANCELLED,
        });
      }

      return currentCandidate;
    });

    if (nextCandidates.length > 0) {
      await taskCandidateRepository.save(nextCandidates);
    }

    return nextCandidates;
  }

  private async transferTask(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    decision: TaskDecisionEntity,
    signature: { readonly id: string; readonly signedPayloadHash: string },
    transferToMemberId: string | null,
    decisionComment: string | null,
    decidedAt: Date,
    actorCandidate: TaskCandidateEntity | null,
    transferReason: string,
  ): Promise<void> {
    if (!transferToMemberId) {
      throw new BadRequestException('Transfer target member is required');
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const taskCandidateRepository = manager.getRepository(TaskCandidateEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const transferringMemberId = task.assigneeMemberId;

    if (!transferringMemberId) {
      throw new ConflictException('Task must be claimed before transfer');
    }

    const nextDelegationChain: readonly DelegationStep[] = [
      ...readDelegationSteps(task.delegationChain),
      {
        from: transferringMemberId,
        reason: transferReason,
        ruleId: null,
        to: transferToMemberId,
      },
    ];
    const transferredTask = await taskRepository.save({
      ...task,
      completedAt: decidedAt,
      delegationChain: nextDelegationChain,
      status: TaskStatusEnum.TRANSFERRED,
    });
    // Candidates still waiting for their turn move with the task; without this
    // the replacement SINGLE task would silently drop them from the chain.
    // A waiting candidate who is also the transfer target takes the active slot
    // and is not asked a second time later in the order.
    const waitingCandidates =
      readDecisionPolicySnapshot(task).type === 'SEQUENTIAL' &&
      actorCandidate?.sequence != null
        ? (await taskCandidateRepository.find({ where: { taskId: task.id } }))
            .filter(
              (candidate) =>
                candidate.status === TaskCandidateStatusEnum.WAITING,
            )
            .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
        : [];
    const isSequentialTransfer = waitingCandidates.length > 0;
    const carriedCandidates = waitingCandidates.filter(
      (candidate) => candidate.memberId !== transferToMemberId,
    );
    const nextTask = await taskRepository.save(
      taskRepository.create({
        // A transferred ad-hoc task stays the same ad-hoc task for its new
        // holder: the pre-approval rejection path (RETURN_TO_ORIGIN) reads these
        // off the task being decided, so without them a rejection after a
        // transfer rejected the whole instance instead.
        adhocDirectiveId: task.adhocDirectiveId,
        adhocOriginTaskId: task.adhocOriginTaskId,
        adhocType: task.adhocType,
        assigneeMemberId: transferToMemberId,
        assignmentType: isSequentialTransfer
          ? task.assignmentType
          : TaskAssignmentTypeEnum.DIRECT_MEMBER,
        completedAt: null,
        decisionPolicySnapshot: isSequentialTransfer
          ? task.decisionPolicySnapshot
          : { type: 'SINGLE' },
        delegationChain: nextDelegationChain,
        instanceId: task.instanceId,
        isAdhoc: task.isAdhoc,
        nodeId: task.nodeId,
        openedAt: null,
        originalAssigneeMemberId: task.originalAssigneeMemberId,
        slaDueAt: task.slaDueAt,
        status: TaskStatusEnum.PENDING,
        tokenId: task.tokenId,
      }),
    );
    // A pre-approval the previous holder requested still points at the task
    // being transferred. Its RETURN_TO_ORIGIN rejection hands the decision back
    // through adhocOriginTaskId, so leaving it on the TRANSFERRED row reopened
    // a task for the member who had just transferred the stage away. Only open
    // pre-approvals move; closed ones keep pointing at the task they ran
    // against, and countersign tasks keep agreeing with directive.originTaskId
    // because nothing reads their pointer. A pre-approval is always created on
    // the origin task's instance and node, so those narrow the lookup to the
    // idx_tasks_instance_node index (adhoc_origin_task_id has none).
    const openPreApprovalsOnTransferredTask = (
      await taskRepository.find({
        where: {
          adhocOriginTaskId: task.id,
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          instanceId: task.instanceId,
          nodeId: task.nodeId,
        },
      })
    ).filter(
      (adhocTask) =>
        adhocTask.status === TaskStatusEnum.PENDING ||
        adhocTask.status === TaskStatusEnum.IN_PROGRESS,
    );

    if (openPreApprovalsOnTransferredTask.length > 0) {
      await taskRepository.save(
        openPreApprovalsOnTransferredTask.map((adhocTask): TaskEntity =>
          Object.assign(new TaskEntity(), adhocTask, {
            adhocOriginTaskId: nextTask.id,
          }),
        ),
      );
    }

    await taskCandidateRepository.save([
      ...(actorCandidate
        ? [
            taskCandidateRepository.create({
              ...actorCandidate,
              decidedAt,
              status: TaskCandidateStatusEnum.TRANSFERRED,
            }),
          ]
        : []),
      taskCandidateRepository.create({
        claimedAt: null,
        createdAt: decidedAt,
        decidedAt: null,
        delegationChain: nextDelegationChain,
        memberId: transferToMemberId,
        originalMemberId: task.originalAssigneeMemberId ?? transferToMemberId,
        sequence: isSequentialTransfer
          ? (actorCandidate?.sequence ?? null)
          : null,
        sourceType: 'DIRECT',
        status: TaskCandidateStatusEnum.PENDING,
        taskId: nextTask.id,
      }),
      ...carriedCandidates.map((candidate) =>
        taskCandidateRepository.create({
          claimedAt: null,
          createdAt: candidate.createdAt,
          decidedAt: null,
          delegationChain: candidate.delegationChain,
          memberId: candidate.memberId,
          originalMemberId: candidate.originalMemberId,
          sequence: candidate.sequence,
          sourceType: candidate.sourceType,
          status: TaskCandidateStatusEnum.WAITING,
          taskId: nextTask.id,
        }),
      ),
      ...waitingCandidates.map((candidate): TaskCandidateEntity =>
        Object.assign(new TaskCandidateEntity(), candidate, {
          status: TaskCandidateStatusEnum.SUPERSEDED,
        }),
      ),
    ]);

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          action: TaskDecisionActionEnum.TRANSFERRED,
          comment: decisionComment,
          decisionId: decision.id,
          signatureId: signature.id,
          signedPayloadHash: signature.signedPayloadHash,
          transferToMemberId,
        },
        taskId: transferredTask.id,
      }),
      activityRepository.create({
        actorMemberId: transferringMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          assigneeMemberId: transferToMemberId,
          ...(isSequentialTransfer
            ? { candidateMemberIds: [transferToMemberId] }
            : {}),
          delegationChain: nextDelegationChain,
          originalAssigneeMemberId: task.originalAssigneeMemberId,
          ...(isSequentialTransfer
            ? {
                sequentialCandidateMemberIds: [
                  transferToMemberId,
                  ...carriedCandidates.map((candidate) => candidate.memberId),
                ],
              }
            : {}),
          tokenId: task.tokenId,
          transferredFromTaskId: task.id,
        },
        taskId: nextTask.id,
      }),
    ]);
    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      task.nodeId,
    );

    if (node.type === 'userTask') {
      await this.notificationService.createTaskAssignedNotification({
        instance,
        manager,
        node,
        task: nextTask,
        transferred: true,
      });
    }
  }

  /**
   * Administrator reassignment of one open task, moved in place: the task keeps
   * its id, decision policy, SLA and every other seat. Only `fromMemberId`'s
   * seat (and the assignee field, when it is theirs) moves to `toMemberId`.
   *
   * This is not a decision by the holder: it writes no TaskDecision and no
   * signature. It is recorded as a TASK_REASSIGNED activity and an
   * {@link ADMIN_REASSIGN_DELEGATION_REASON} delegation step.
   *
   * Unlike the holder's transfer, the target is NOT run through the delegation
   * rules (a rule for `toMemberId` does not apply). The initiator and submitter
   * exclusions and the grade check of ORG_MANAGER_CHAIN nodes still do.
   *
   * A refused reassignment is reported as `REJECTED` with an error code. When
   * `dryRun` is off, a refusal is thrown as a ConflictException whose message
   * carries that code.
   */
  async reassignTask(
    taskId: string,
    options: ReassignTaskOptions,
  ): Promise<TaskReassignmentResult> {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    const result = await this.executeTaskReassignment(task, options);

    if (
      result.outcome === TaskReassignmentOutcomeEnum.REJECTED &&
      !options.dryRun
    ) {
      throw new ConflictException(
        `[${result.errorCode}] ${result.message ?? ''}`.trim(),
      );
    }

    return result;
  }

  /**
   * Runs {@link reassignTask} for every open task `fromMemberId` holds, each in
   * its own transaction, and reports one result per task. A failing task does
   * not stop the others: a refusal is a REJECTED result, and an unexpected
   * error is reported as REJECTED with UNEXPECTED_ERROR for that task alone.
   */
  async reassignMemberTasks(
    options: ReassignTaskOptions,
  ): Promise<readonly TaskReassignmentResult[]> {
    const held = await this.readRunningMemberTasks(options.fromMemberId);

    return held.reduce<Promise<readonly TaskReassignmentResult[]>>(
      async (
        previous,
        { task },
      ): Promise<readonly TaskReassignmentResult[]> => {
        const results = await previous;
        const result = await this.executeTaskReassignment(task, options).catch(
          (error: unknown): TaskReassignmentResult => {
            this.logger.warn(
              `Reassigning task ${task.id} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );

            return buildTaskReassignmentResult(
              task,
              TaskReassignmentOutcomeEnum.REJECTED,
              TaskReassignmentErrorCodeEnum.UNEXPECTED_ERROR,
            );
          },
        );

        return [...results, result];
      },
      Promise.resolve([]),
    );
  }

  /**
   * The open tasks a member holds, for the administrator's reassignment screen.
   * Same definition as the inbox, plus WAITING sequential seats, restricted to
   * RUNNING instances.
   */
  async listMemberOpenTasks(
    memberId: string,
  ): Promise<readonly MemberOpenTaskRecord[]> {
    const held = await this.readRunningMemberTasks(memberId);

    if (!held.length) {
      return [];
    }

    const tasks = await this.attachTaskCandidateSummaries(
      held.map(({ task }) => task),
    );
    const openRows = await this.taskCandidateRepository.find({
      where: {
        memberId,
        status: In(OPEN_SEAT_STATUSES),
        taskId: In(tasks.map((task) => task.id)),
      },
    });
    // One query for every template, not one per template: the listing opens
    // each time an administrator opens the reassignment screen.
    const templates = await this.approvalTemplateRepository.find({
      where: {
        id: In([...new Set(held.map(({ instance }) => instance.templateId))]),
      },
    });
    const templateNameById = new Map(
      templates.map((template): readonly [string, string] => [
        template.id,
        template.name,
      ]),
    );
    const openRowByTaskId = new Map(
      openRows.map((row): readonly [string, TaskCandidateEntity] => [
        row.taskId,
        row,
      ]),
    );
    const summaryByTaskId = new Map(
      tasks.map((summary): readonly [string, (typeof tasks)[number]] => [
        summary.id,
        summary,
      ]),
    );

    return held.map(({ instance, task }): MemberOpenTaskRecord => {
      const row = openRowByTaskId.get(task.id);
      const summary = summaryByTaskId.get(task.id);

      return {
        candidateStatus: row?.status ?? null,
        createdAt: task.createdAt,
        decisionPolicyType: readDecisionPolicySnapshot(task).type,
        businessKey: instance.businessKey,
        instanceId: instance.id,
        instanceTitle: instance.title,
        memberRole: row
          ? MemberTaskRoleEnum.CANDIDATE
          : MemberTaskRoleEnum.ASSIGNEE,
        nodeId: task.nodeId,
        nodeLabel: summary?.nodeLabel ?? null,
        slaDueAt: task.slaDueAt,
        taskId: task.id,
        templateId: instance.templateId,
        templateName: templateNameById.get(instance.templateId) ?? null,
      };
    });
  }

  /**
   * Deactivated members who still hold open tasks, so an administrator can find
   * them: a deactivated member no longer shows up in the member search.
   *
   * BPM cannot tell a deactivated member from an id it never knew, so the host
   * names them: `resolveInactiveMembers` gets every member id that holds an open
   * seat and returns the ones it knows but has deactivated. The count per member
   * is the {@link listMemberOpenTasks} count, and members left with none are
   * dropped.
   */
  async listInactiveMembersWithOpenTasks(
    resolveInactiveMembers: (
      memberIds: readonly string[],
    ) => Promise<readonly MemberMetadata[]>,
  ): Promise<readonly InactiveMemberOpenTasksRecord[]> {
    const holderIds = await this.readOpenSeatHolderMemberIds();

    if (!holderIds.length) {
      return [];
    }

    const holderIdSet = new Set(holderIds);
    // Only the ids it was asked about are counted, each once: a member the
    // host adds would only cost task queries before the count dropped it.
    const inactiveMembers = [
      ...new Map(
        (await resolveInactiveMembers(holderIds))
          .filter((member): boolean => holderIdSet.has(member.memberId))
          .map((member): [string, MemberMetadata] => [member.memberId, member]),
      ).values(),
    ];
    const counted = await chunkArray(
      inactiveMembers,
      INACTIVE_MEMBER_COUNT_CONCURRENCY,
    ).reduce(
      async (
        previous: Promise<readonly InactiveMemberOpenTasksRecord[]>,
        batch,
      ): Promise<readonly InactiveMemberOpenTasksRecord[]> => [
        ...(await previous),
        ...(await Promise.all(
          batch.map(async (member): Promise<InactiveMemberOpenTasksRecord> => ({
            email: member.email,
            memberId: member.memberId,
            name: member.name,
            openTaskCount: (await this.readRunningMemberTasks(member.memberId))
              .length,
          })),
        )),
      ],
      Promise.resolve([]),
    );

    return counted
      .filter((record): boolean => record.openTaskCount > 0)
      .sort(
        (left, right): number =>
          left.name.localeCompare(right.name, INACTIVE_MEMBER_NAME_LOCALE) ||
          // Namesakes are common; the id keeps their order stable.
          (left.memberId < right.memberId
            ? -1
            : left.memberId > right.memberId
              ? 1
              : 0),
      );
  }

  /**
   * Every member id that may hold an open seat on a RUNNING instance: the
   * assignee of an open task, or an open candidate row on one. Still a
   * superset (a countersign voter who already decided stays the assignee);
   * callers count with {@link readRunningMemberTasks}, which drops those.
   *
   * One query that returns only the distinct holder ids, never a row per
   * task or seat: the member screen loads it every time.
   */
  private async readOpenSeatHolderMemberIds(): Promise<readonly string[]> {
    const taskTable = this.readQualifiedTableName(this.taskRepository);
    const candidateTable = this.readQualifiedTableName(
      this.taskCandidateRepository,
    );
    const instanceTable = this.readQualifiedTableName(
      this.approvalInstanceRepository,
    );
    const rows = await this.approvalInstanceRepository.query<
      readonly { readonly memberId: string }[]
    >(
      `SELECT holder.member_id AS "memberId"
         FROM (
               SELECT task.assignee_member_id AS member_id
                 FROM ${taskTable} AS task
                 JOIN ${instanceTable} AS instance
                   ON instance.id = task.instance_id
                WHERE task.status = ANY($1::text[])
                  AND task.assignee_member_id IS NOT NULL
                  AND instance.state = $2
               UNION
               SELECT candidate.member_id
                 FROM ${candidateTable} AS candidate
                 JOIN ${taskTable} AS task ON task.id = candidate.task_id
                 JOIN ${instanceTable} AS instance
                   ON instance.id = task.instance_id
                WHERE candidate.status = ANY($3::text[])
                  AND task.status = ANY($1::text[])
                  AND instance.state = $2
              ) AS holder`,
      [
        [TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS],
        ApprovalInstanceStateEnum.RUNNING,
        [...OPEN_SEAT_STATUSES],
      ],
    );

    // Sorted here, not in SQL: the default JS order (UTF-16 code units),
    // whatever the DB collation.
    return rows.map((row): string => row.memberId).sort();
  }

  /** `schema.table` of a repository's entity, escaped for raw SQL. */
  private readQualifiedTableName<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
  ): string {
    const { driver } = this.approvalInstanceRepository.manager.connection;

    return [repository.metadata.schema, repository.metadata.tableName]
      .filter((part): part is string => Boolean(part))
      .map((part): string => driver.escape(part))
      .join('.');
  }

  /**
   * The open tasks `memberId` holds on RUNNING instances, with the instance
   * each belongs to. The instance filter is applied here, not only in the query.
   */
  private async readRunningMemberTasks(memberId: string): Promise<
    readonly {
      readonly instance: ApprovalInstanceEntity;
      readonly task: TaskEntity;
    }[]
  > {
    const tasks = await this.readOpenInboxTasks(memberId, OPEN_SEAT_STATUSES);

    if (!tasks.length) {
      return [];
    }

    const instances = await this.approvalInstanceRepository.find({
      where: { id: In([...new Set(tasks.map((task) => task.instanceId))]) },
    });
    const runningById = new Map(
      instances
        .filter(
          (instance) => instance.state === ApprovalInstanceStateEnum.RUNNING,
        )
        .map((instance): readonly [string, ApprovalInstanceEntity] => [
          instance.id,
          instance,
        ]),
    );

    return tasks.flatMap((task) => {
      const instance = runningById.get(task.instanceId);

      return instance ? [{ instance, task }] : [];
    });
  }

  private async executeTaskReassignment(
    preRead: TaskEntity,
    options: ReassignTaskOptions,
  ): Promise<TaskReassignmentResult> {
    return this.runEngineTransaction(
      async (manager): Promise<TaskReassignmentResult> => {
        try {
          const plan = await this.planTaskReassignment(
            manager,
            preRead.id,
            options,
          );

          if (options.dryRun) {
            return buildTaskReassignmentResult(
              preRead,
              TaskReassignmentOutcomeEnum.WOULD_REASSIGN,
              null,
            );
          }

          await this.applyTaskReassignment(manager, plan, options);

          return buildTaskReassignmentResult(
            preRead,
            TaskReassignmentOutcomeEnum.REASSIGNED,
            null,
          );
        } catch (error) {
          // Planning writes nothing, so a refusal commits no change.
          if (error instanceof TaskReassignmentRejectedError) {
            return buildTaskReassignmentResult(
              preRead,
              TaskReassignmentOutcomeEnum.REJECTED,
              error.errorCode,
            );
          }

          throw error;
        }
      },
    );
  }

  /**
   * Checks every rule of an administrator reassignment under the instance lock,
   * against the rows as they are now. Writes nothing; a refusal throws
   * {@link TaskReassignmentRejectedError}.
   */
  private async planTaskReassignment(
    manager: EntityManager,
    taskId: string,
    options: ReassignTaskOptions,
  ): Promise<TaskReassignmentPlan> {
    const fromMemberId = options.fromMemberId;
    const toMemberId = options.toMemberId;

    if (!options.reason.trim()) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.REASON_REQUIRED,
      );
    }

    if (fromMemberId === toMemberId) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TARGET_SAME_AS_SOURCE,
      );
    }

    const taskRepository = manager.getRepository(TaskEntity);
    const unlockedTask = await taskRepository.findOne({
      where: { id: taskId },
    });

    if (!unlockedTask) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TASK_NOT_OPEN,
      );
    }

    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      unlockedTask.instanceId,
    ]);

    // Read again under the lock: the task may have been decided or moved while
    // this request waited for it.
    const task = await taskRepository.findOne({ where: { id: taskId } });

    if (!task || !OPEN_TASK_STATUSES.includes(task.status)) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TASK_NOT_OPEN,
      );
    }

    const instance = await manager
      .getRepository(ApprovalInstanceEntity)
      .findOne({ where: { id: task.instanceId } });

    if (!instance || instance.state !== ApprovalInstanceStateEnum.RUNNING) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.INSTANCE_NOT_RUNNING,
      );
    }

    const node = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      task.nodeId,
    );

    if (node.type !== 'userTask') {
      throw new ConflictException(
        `Task ${task.id} is not bound to a user task node`,
      );
    }

    const candidates = await manager
      .getRepository(TaskCandidateEntity)
      .find({ where: { taskId: task.id } });
    const sourceRow =
      candidates.find(
        (candidate) =>
          candidate.memberId === fromMemberId &&
          OPEN_SEAT_STATUSES.includes(candidate.status),
      ) ?? null;
    // A holder with no candidate row at all is the assignee of a direct task.
    // Anyone with a row that is not open (COMPLETED, TRANSFERRED, ...) no
    // longer has a seat, so they are refused even when they are the assignee.
    const sourceHasAnyRow = candidates.some(
      (candidate) => candidate.memberId === fromMemberId,
    );

    if (
      !sourceRow &&
      !(task.assigneeMemberId === fromMemberId && !sourceHasAnyRow)
    ) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.SOURCE_NOT_ON_TASK,
      );
    }

    const targetRows = candidates.filter(
      (candidate) => candidate.memberId === toMemberId,
    );
    const targetDecisions = await manager
      .getRepository(TaskDecisionEntity)
      .find({ where: { decidedByMemberId: toMemberId, taskId: task.id } });

    // Checked before "already on task": a member who has decided here may
    // still be the assignee field, and the decided reason is the useful one.
    if (
      targetDecisions.length > 0 ||
      targetRows.some(
        (candidate) => candidate.status === TaskCandidateStatusEnum.COMPLETED,
      )
    ) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TARGET_ALREADY_DECIDED,
      );
    }

    if (
      task.assigneeMemberId === toMemberId ||
      targetRows.some((candidate) =>
        OPEN_SEAT_STATUSES.includes(candidate.status),
      )
    ) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TARGET_ALREADY_ON_TASK,
      );
    }

    if (isInitiatorExcluded(node)) {
      if (toMemberId === instance.initiatorMemberId) {
        throw new TaskReassignmentRejectedError(
          TaskReassignmentErrorCodeEnum.TARGET_IS_INITIATOR,
        );
      }

      if (toMemberId === readDistinctSubmitterMemberId(instance)) {
        throw new TaskReassignmentRejectedError(
          TaskReassignmentErrorCodeEnum.TARGET_IS_SUBMITTER,
        );
      }
    }

    if (
      isNodeActorsExcluded(node) &&
      (await this.isExcludedNodeActorTarget(
        manager,
        instance,
        node,
        toMemberId,
      ))
    ) {
      throw new TaskReassignmentRejectedError(
        TaskReassignmentErrorCodeEnum.TARGET_IS_EXCLUDED_NODE_ACTOR,
      );
    }

    if (!task.isAdhoc && isOrgManagerChainNode(node)) {
      const requiredGrade = await this.readTransferTargetRequiredGrade(
        manager,
        {
          actorMemberId: fromMemberId,
          delegationChain: sourceRow?.delegationChain ?? task.delegationChain,
          targetMemberId: toMemberId,
        },
      );

      if (requiredGrade !== null) {
        throw new TaskReassignmentRejectedError(
          TaskReassignmentErrorCodeEnum.TARGET_GRADE_TOO_LOW,
        );
      }
    }

    return {
      instance,
      node,
      reusableRow:
        targetRows.find((candidate) =>
          REUSABLE_SEAT_STATUSES.includes(candidate.status),
        ) ?? null,
      sourceRow,
      task,
    };
  }

  private async applyTaskReassignment(
    manager: EntityManager,
    plan: TaskReassignmentPlan,
    options: ReassignTaskOptions,
  ): Promise<void> {
    const decidedAt = new Date();
    const reason = options.reason.trim();
    const step: DelegationStep = {
      actorMemberId: options.actorMemberId,
      comment: reason,
      from: options.fromMemberId,
      reason: ADMIN_REASSIGN_DELEGATION_REASON,
      ruleId: null,
      to: options.toMemberId,
    };
    const seat = await this.replaceOpenSeat(manager, {
      decidedAt,
      fromMemberId: options.fromMemberId,
      reusableRow: plan.reusableRow,
      sourceRow: plan.sourceRow,
      step,
      task: plan.task,
      toMemberId: options.toMemberId,
    });
    const activityRepository = manager.getRepository(ActivityLogEntity);

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: options.actorMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_REASSIGNED,
        instanceId: plan.instance.id,
        nodeId: plan.task.nodeId,
        payload: {
          actorMemberId: options.actorMemberId,
          assigneeChanged: seat.assigneeMoved,
          candidateStatus: plan.sourceRow?.status ?? null,
          fromMemberId: options.fromMemberId,
          reason,
          sequence: plan.sourceRow?.sequence ?? null,
          toMemberId: options.toMemberId,
        },
        taskId: plan.task.id,
      }),
    );

    await this.notifySeatReplaced(manager, {
      fromMemberId: options.fromMemberId,
      instance: plan.instance,
      node: plan.node,
      seat,
      toMemberId: options.toMemberId,
    });
  }

  /**
   * A holder's transfer of their seat on a group stage (PARALLEL_ALL,
   * PARALLEL_ANY, QUORUM). The stage stays open: the transferring seat moves
   * to the target in place, the other seats keep their state, and the task
   * keeps its id. Unlike transferTask, no replacement SINGLE task is created
   * and the other voters are not superseded. The transferring member's
   * decision and signature are kept on the task.
   */
  private async transferGroupSeat(
    manager: EntityManager,
    {
      actorCandidate,
      decidedAt,
      decision,
      instance,
      node,
      reusableRow,
      signature,
      task,
      taskBeforeClaim,
      toMemberId,
      transferReason,
    }: {
      readonly actorCandidate: TaskCandidateEntity | null;
      readonly decidedAt: Date;
      readonly decision: TaskDecisionEntity;
      readonly instance: ApprovalInstanceEntity;
      readonly node: UserTaskNode;
      readonly reusableRow: TaskCandidateEntity | null;
      readonly signature: {
        readonly id: string;
        readonly signedPayloadHash: string;
      };
      readonly task: TaskEntity;
      readonly taskBeforeClaim: TaskEntity;
      readonly toMemberId: string;
      readonly transferReason: string;
    },
  ): Promise<void> {
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const fromMemberId = decision.decidedByMemberId;
    // decideTask claims the task for whoever decides, writing them into the
    // task-level assignee. A seat transfer is not a claim of the whole stage:
    // put the task-level holder back first, so the seat replacement only moves
    // the assignee, the delegation chain and openedAt when the transferring
    // member really held the task.
    const unclaimedTask = await manager.getRepository(TaskEntity).save(
      Object.assign(new TaskEntity(), task, {
        assigneeMemberId: taskBeforeClaim.assigneeMemberId,
        openedAt: taskBeforeClaim.openedAt,
        originalAssigneeMemberId: taskBeforeClaim.originalAssigneeMemberId,
      }),
    );
    const seat = await this.replaceOpenSeat(manager, {
      decidedAt,
      fromMemberId,
      reusableRow,
      sourceRow: actorCandidate,
      step: {
        from: fromMemberId,
        reason: transferReason,
        ruleId: null,
        to: toMemberId,
      },
      task: unclaimedTask,
      toMemberId,
    });

    await activityRepository.save(
      activityRepository.create({
        actorMemberId: fromMemberId,
        eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          action: TaskDecisionActionEnum.TRANSFERRED,
          comment: decision.comment,
          decisionId: decision.id,
          signatureId: signature.id,
          signedPayloadHash: signature.signedPayloadHash,
          transferToMemberId: toMemberId,
        },
        taskId: task.id,
      }),
    );

    await this.notifySeatReplaced(manager, {
      fromMemberId,
      instance,
      node,
      seat,
      toMemberId,
    });
  }

  /**
   * Moves one open seat from `fromMemberId` to `toMemberId` on the same task.
   *
   * With a source candidate row: that row is marked TRANSFERRED, and the target
   * takes a row with the same sequence, source type and original member. A
   * WAITING seat stays WAITING; anything else becomes PENDING. A closed row the
   * target already has (CANCELLED, SUPERSEDED, TRANSFERRED) is reused, because
   * the database allows one row per (task, member).
   *
   * Without one (a direct assignee with no candidate row) only the assignee
   * field moves. When the source is the assignee, the assignee moves too and
   * the step is appended to the task's chain.
   */
  private async replaceOpenSeat(
    manager: EntityManager,
    {
      decidedAt,
      fromMemberId,
      reusableRow,
      sourceRow,
      step,
      task,
      toMemberId,
    }: {
      readonly decidedAt: Date;
      readonly fromMemberId: string;
      readonly reusableRow: TaskCandidateEntity | null;
      readonly sourceRow: TaskCandidateEntity | null;
      readonly step: DelegationStep;
      readonly task: TaskEntity;
      readonly toMemberId: string;
    },
  ): Promise<TaskSeatReplacement> {
    const taskRepository = manager.getRepository(TaskEntity);
    const candidateRepository = manager.getRepository(TaskCandidateEntity);
    const assigneeMoved = task.assigneeMemberId === fromMemberId;

    if (sourceRow) {
      await candidateRepository.save(
        Object.assign(new TaskCandidateEntity(), sourceRow, {
          decidedAt,
          status: TaskCandidateStatusEnum.TRANSFERRED,
        }),
      );
    }

    const seatStatus = sourceRow
      ? sourceRow.status === TaskCandidateStatusEnum.WAITING
        ? TaskCandidateStatusEnum.WAITING
        : TaskCandidateStatusEnum.PENDING
      : null;

    if (sourceRow) {
      const seat = {
        claimedAt: null,
        decidedAt: null,
        delegationChain: [
          ...readDelegationSteps(sourceRow.delegationChain),
          step,
        ],
        memberId: toMemberId,
        originalMemberId: sourceRow.originalMemberId,
        sequence: sourceRow.sequence,
        sourceType: sourceRow.sourceType,
        status: seatStatus ?? TaskCandidateStatusEnum.PENDING,
      };

      if (reusableRow) {
        await candidateRepository.save(
          Object.assign(new TaskCandidateEntity(), reusableRow, seat),
        );
      } else {
        await candidateRepository.save(
          candidateRepository.create({ ...seat, taskId: task.id }),
        );
      }
    }

    const nextTask = assigneeMoved
      ? await taskRepository.save(
          Object.assign(new TaskEntity(), task, {
            assigneeMemberId: toMemberId,
            delegationChain: [
              ...readDelegationSteps(task.delegationChain),
              step,
            ],
            openedAt: null,
          }),
        )
      : task;

    return { assigneeMoved, seatStatus, task: nextTask };
  }

  /**
   * Notifications for a replaced seat: the member who gave it up is resolved as
   * TRANSFERRED (their notifications on this task only), and the member who
   * takes it is notified now if the seat is active. A WAITING seat notifies
   * when its turn comes, through the normal sequential activation.
   */
  private async notifySeatReplaced(
    manager: EntityManager,
    {
      fromMemberId,
      instance,
      node,
      seat,
      toMemberId,
    }: {
      readonly fromMemberId: string;
      readonly instance: ApprovalInstanceEntity;
      readonly node: UserTaskNode;
      readonly seat: TaskSeatReplacement;
      readonly toMemberId: string;
    },
  ): Promise<void> {
    await this.notificationService.resolveTaskNotifications({
      actingMemberId: fromMemberId,
      manager,
      resolution: NotificationResolutionEnum.TRANSFERRED,
      supersedeOthers: false,
      taskId: seat.task.id,
    });

    const isActive =
      seat.seatStatus === null ||
      seat.seatStatus === TaskCandidateStatusEnum.PENDING;

    if (!isActive) {
      return;
    }

    await this.notificationService.createTaskAssignedNotification({
      instance,
      manager,
      node,
      task: Object.assign(new TaskEntity(), seat.task, {
        assigneeMemberId: toMemberId,
      }),
      transferred: true,
    });
  }

  /**
   * Resolves who gets the node's task. A {@link SkippedRuntimeTask} means the
   * node asked to be skipped (`excludeInitiator.whenEmpty` or
   * `excludeNodeActors.whenEmpty` = SKIP_NODE) because everyone left was kept
   * out: the sole caller creates no task and advances the token instead.
   *
   * With both exclusions set the initiator rule runs first. When it alone
   * leaves nobody, `excludeInitiator.whenEmpty` decides; when it leaves
   * somebody and the earlier-stage rule then removes them all,
   * `excludeNodeActors.whenEmpty` decides.
   */
  private async resolveRuntimeTaskCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
  ): Promise<ResolvedRuntimeTaskCandidates | SkippedRuntimeTask> {
    const label = `簽核節點「${node.data.label}」`;
    const exclusions = await this.readNodeExclusions(manager, instance, node);
    const resolvedCandidates = await this.resolveApproverResolver(
      manager,
      instance,
      node.data.approverResolver,
      label,
      '簽核人',
      exclusions.memberIds,
    );
    const delegatedCandidates = await this.delegateResolvedCandidates(
      manager,
      instance,
      node.id,
      resolvedCandidates,
      isOrgManagerChainNode(node),
    );
    const hasExclusion = hasSeatExclusion(node);
    const hasSubmitter = readDistinctSubmitterMemberId(instance) !== null;
    const uniqueCandidates = selectNodeCandidates(
      delegatedCandidates,
      hasExclusion,
      exclusions.memberIds,
    );

    if (uniqueCandidates.length > 0) {
      return {
        candidates: uniqueCandidates,
        skippedDelegations: collectSkippedDelegations(
          delegatedCandidates,
          hasExclusion,
          exclusions.memberIds,
        ),
      };
    }

    // Only excluded people were left — what the node does about it is
    // configured. Nothing resolved to begin with is the ordinary failure below.
    if (!hasExclusion || delegatedCandidates.length === 0) {
      throw new ConflictException(`${label} did not resolve to any member id`);
    }

    const emptiedByInitiator = isEmptiedByInitiatorRule(
      node,
      delegatedCandidates,
      exclusions,
    );
    const whenEmpty = emptiedByInitiator
      ? node.data.excludeInitiator?.whenEmpty
      : node.data.excludeNodeActors?.whenEmpty;

    if (whenEmpty === 'SKIP_NODE') {
      return { skippedBy: emptiedByInitiator ? 'INITIATOR' : 'NODE_ACTORS' };
    }

    if (whenEmpty === 'INITIATOR_MANAGER') {
      const managerCandidates = await this.resolveInitiatorManagerReplacements(
        manager,
        instance,
        node,
        exclusions.memberIds,
      );

      if (managerCandidates.candidates.length > 0) {
        return managerCandidates;
      }

      throw new ConflictException(
        !emptiedByInitiator
          ? `${label} 無法建立待簽任務：解析出的簽核人只剩前面${readNodeActorNodeNames(instance, readExcludedNodeActorNodeIds(node))}的簽核者，此節點不允許與前面關卡的簽核者為同一人，且找不到申請人的主管可改派。`
          : hasSubmitter
            ? `${label} 無法建立待簽任務：解析出的簽核人只剩申請人或代為送出此單的人，此節點不允許申請人或代送人簽核，且找不到申請人的主管可改派。`
            : `${label} 無法建立待簽任務：解析出的簽核人只剩申請人本人，此節點不允許申請人自簽，且找不到申請人的主管可改派。`,
      );
    }

    throw new ConflictException(
      !emptiedByInitiator
        ? `${label} 無法建立待簽任務：解析出的簽核人只剩前面${readNodeActorNodeNames(instance, readExcludedNodeActorNodeIds(node))}的簽核者（含委派後的代理人），此節點不允許與前面關卡的簽核者為同一人。`
        : hasSubmitter
          ? `${label} 無法建立待簽任務：解析出的簽核人只剩申請人或代為送出此單的人（含委派後的代理人），且此節點不允許申請人或代送人簽核。`
          : `${label} 無法建立待簽任務：解析出的簽核人只剩申請人本人（含委派後的代理人），且此節點不允許申請人自簽。`,
    );
  }

  /**
   * Everyone `node` keeps out of its approvers, per rule: the initiator and
   * the submitter for `excludeInitiator`, and everyone who actually approved
   * one of the listed earlier stages for `excludeNodeActors`. Read through
   * `manager` so an approval written earlier in this transaction counts.
   */
  private async readNodeExclusions(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
  ): Promise<NodeExclusions> {
    const initiatorMemberIds = isInitiatorExcluded(node)
      ? readInitiatorAndSubmitter(instance)
      : [];
    const nodeActorMemberIds = isNodeActorsExcluded(node)
      ? await this.readExcludedNodeActorMemberIds(
          manager,
          instance,
          readExcludedNodeActorNodeIds(node),
        )
      : [];

    return {
      initiatorMemberIds,
      memberIds: uniqueTexts([...initiatorMemberIds, ...nodeActorMemberIds]),
      nodeActorMemberIds,
    };
  }

  /**
   * The people who approved any of `nodeIds`, each listed node read on its own
   * with the `NODE_ACTOR` rules ({@link readNodeActorMemberIds}) and the
   * results combined. A source reads only the most recent of its listed nodes;
   * an exclusion must cover every listed node, so it asks one node at a time.
   *
   * There is no round boundary here: a node's newest batch is what counts. The
   * publish lint makes that the right batch, since every listed node runs and
   * is signed by a person on every path to this node (a return to the start
   * runs it again; a return to a stage below it leaves its earlier approval
   * standing, and the exclusion with it).
   */
  private async readExcludedNodeActorMemberIds(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeIds: readonly string[],
  ): Promise<readonly string[]> {
    const groups = await Promise.all(
      nodeIds.map(async (nodeId): Promise<readonly string[]> => {
        const approvals = await this.readNodeActorApprovals(manager, instance, [
          nodeId,
        ]);
        const principalMemberIds = await this.readApprovalPrincipalMemberIds(
          manager,
          approvals,
        );

        return [
          ...approvals.map((decision) => decision.decidedByMemberId),
          ...principalMemberIds,
        ];
      }),
    );

    return uniqueTexts(groups.flat());
  }

  /**
   * Whether `targetMemberId` may not take a seat on `node` under
   * `excludeNodeActors`, checked the way task creation checks a candidate: the
   * target is one of the excluded members, or one end of a delegation between
   * the target and an excluded member is on the path. A delegation is read in
   * both directions, since the target may be the delegate of an excluded
   * member, or delegate an excluded member's seat onward.
   */
  private async isExcludedNodeActorTarget(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
    targetMemberId: string,
  ): Promise<boolean> {
    const excludedMemberIds = await this.readExcludedNodeActorMemberIds(
      manager,
      instance,
      readExcludedNodeActorNodeIds(node),
    );

    if (excludedMemberIds.includes(targetMemberId)) {
      return true;
    }

    if (excludedMemberIds.length === 0) {
      return false;
    }

    const context = this.buildDelegationContext(instance, node.id);
    const gradeGated = isOrgManagerChainNode(node);
    const ownDelegation = await this.resolveDelegation(
      manager,
      targetMemberId,
      context,
      gradeGated,
    );

    if (
      isExcludedMemberOnCandidatePath(
        {
          delegationChain: ownDelegation.delegationChain,
          memberId: ownDelegation.finalAssigneeMemberId,
          originalMemberId: targetMemberId,
        },
        excludedMemberIds,
      )
    ) {
      return true;
    }

    const excludedSeats = await Promise.all(
      excludedMemberIds.map(async (memberId): Promise<boolean> => {
        const delegation = await this.resolveDelegation(
          manager,
          memberId,
          context,
          gradeGated,
        );

        return isExcludedMemberOnCandidatePath(
          {
            delegationChain: delegation.delegationChain,
            memberId: delegation.finalAssigneeMemberId,
            originalMemberId: memberId,
          },
          [targetMemberId],
        );
      }),
    );

    return excludedSeats.some((routesToTarget) => routesToTarget);
  }

  /**
   * The principals the approvals stand for: a delegate who approved counts as
   * the member who delegated to them, read from the candidate row each approval
   * was signed on (see {@link readRuleDelegatorMemberIds}).
   */
  private async readApprovalPrincipalMemberIds(
    manager: EntityManager,
    approvals: readonly TaskDecisionEntity[],
  ): Promise<readonly string[]> {
    if (approvals.length === 0) {
      return [];
    }

    const candidates = await manager.getRepository(TaskCandidateEntity).find({
      where: {
        taskId: In(uniqueTexts(approvals.map((decision) => decision.taskId))),
      },
    });

    return uniqueTexts(
      approvals.flatMap((decision) =>
        candidates
          .filter(
            (candidate) =>
              candidate.taskId === decision.taskId &&
              candidate.memberId === decision.decidedByMemberId,
          )
          .flatMap(readRuleDelegatorMemberIds),
      ),
    );
  }

  private async resolveInitiatorManagerReplacements(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    node: UserTaskNode,
    excludedMemberIds: readonly string[],
  ): Promise<ResolvedRuntimeTaskCandidates> {
    // Whoever the node keeps out is also kept out of the replacements: the
    // initiator and the submitter always (even when only `excludeNodeActors`
    // asked for this replacement), plus the earlier-stage approvers.
    const replacementExcludedMemberIds = uniqueTexts([
      ...readInitiatorAndSubmitter(instance),
      ...excludedMemberIds,
    ]);
    // The initiator's own direct manager: the closest org unit only. The
    // initiator himself (a unit head) and the member who submitted for him are
    // skipped before the tier is chosen, so resolution falls through to the
    // next tier instead of ending on either of them.
    const managerMemberIds = await this.resolveDirectManagerMemberIds(
      manager,
      instance.initiatorMemberId,
      this.readOrganizationToday(),
      true,
      replacementExcludedMemberIds,
    );
    const delegatedCandidates = await this.delegateResolvedCandidates(
      manager,
      instance,
      node.id,
      managerMemberIds.map((memberId) => ({
        memberId,
        sourceType: 'EXCLUDE_INITIATOR_MANAGER',
      })),
      isOrgManagerChainNode(node),
    );

    return {
      candidates: selectNodeCandidates(
        delegatedCandidates,
        true,
        replacementExcludedMemberIds,
      ),
      skippedDelegations: collectSkippedDelegations(
        delegatedCandidates,
        true,
        replacementExcludedMemberIds,
      ),
    };
  }

  private buildDelegationContext(
    instance: ApprovalInstanceEntity,
    nodeId: string,
  ): Parameters<DelegationService['resolveAssignee']>[1] {
    return {
      formData: instance.formData,
      initiatorMemberId: instance.initiatorMemberId,
      initiatorMetadataSnapshot: instance.initiatorMetadataSnapshot,
      instanceId: instance.id,
      nodeId,
      state: instance.state,
      templateId: instance.templateId,
      templateVersionId: instance.templateVersionId,
      title: instance.title,
    };
  }

  // Not deduplicated: a node that excludes the initiator filters first, so a
  // first-seen entry that must be dropped cannot shadow a legitimate one.
  private async delegateResolvedCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeId: string,
    resolvedCandidates: readonly ResolvedApproverCandidate[],
    gradeGated: boolean,
  ): Promise<readonly RuntimeTaskCandidate[]> {
    // One batch for the node, so the host directory is asked once for every
    // candidate's delegation agents rather than once per candidate.
    const resolutions = await this.delegationService.resolveAssignees(
      resolvedCandidates.map((candidate) => candidate.memberId),
      { ...this.buildDelegationContext(instance, nodeId), manager },
    );
    const resolved = resolvedCandidates.map((candidate, index) => ({
      candidate,
      resolution: resolutions[index],
    }));
    // One batch of grade lookups for the whole node, not two per delegate.
    const levels = gradeGated
      ? await this.readMemberPositionLevels(
          manager,
          resolved.flatMap(({ candidate, resolution }) =>
            readGradeGateMemberIds(candidate.memberId, resolution),
          ),
          this.readOrganizationToday(),
        )
      : new Map<string, number | null>();

    return resolved.map(({ candidate, resolution }): RuntimeTaskCandidate => {
      const { skippedDelegation, ...delegationResolution } = applyGradeGate(
        candidate.memberId,
        resolution,
        gradeGated,
        levels,
      );

      return {
        delegationChain: delegationResolution.delegationChain,
        memberId: delegationResolution.finalAssigneeMemberId,
        originalMemberId: candidate.memberId,
        ...(skippedDelegation ? { skippedDelegation } : {}),
        sourceType: candidate.sourceType,
      };
    });
  }

  /** One member's delegation, grade-gated as {@link applyGradeGate} says. */
  private async resolveDelegation(
    manager: EntityManager,
    principalMemberId: string,
    context: Parameters<DelegationService['resolveAssignee']>[1],
    gradeGated: boolean,
  ): Promise<GradeGatedDelegation> {
    const resolution = await this.delegationService.resolveAssignee(
      principalMemberId,
      { ...context, manager },
    );
    const memberIds = gradeGated
      ? readGradeGateMemberIds(principalMemberId, resolution)
      : [];
    const levels =
      memberIds.length > 0
        ? await this.readMemberPositionLevels(
            manager,
            memberIds,
            this.readOrganizationToday(),
          )
        : new Map<string, number | null>();

    return applyGradeGate(principalMemberId, resolution, gradeGated, levels);
  }

  /**
   * Manual transfer on a manager-chain node: the target must hold at least the
   * grade of the member being replaced, i.e. the original principal of the
   * deciding candidate (the first hop of its delegation chain when it was
   * delegated, otherwise the actor). No grade on the principal means no
   * constraint.
   */
  private async assertTransferTargetGrade(
    manager: EntityManager,
    args: {
      readonly actorMemberId: string;
      readonly delegationChain: readonly Readonly<Record<string, unknown>>[];
      readonly label: string;
      readonly targetMemberId: string;
    },
  ): Promise<void> {
    const requiredLevel = await this.readTransferTargetRequiredGrade(
      manager,
      args,
    );

    if (requiredLevel !== null) {
      throw new ForbiddenException(
        `簽核節點「${args.label}」需由職等 ${requiredLevel} 以上的成員簽核，不能轉簽給職等不足的成員`,
      );
    }
  }

  /**
   * The grade a transfer target must reach, or `null` when the target passes.
   * Seniority is measured from the member being replaced: the first delegator
   * on their chain, or that member themselves. Shared by the user transfer
   * (which throws) and the administrator reassignment (which reports).
   */
  private async readTransferTargetRequiredGrade(
    manager: EntityManager,
    {
      actorMemberId,
      delegationChain,
      targetMemberId,
    }: {
      readonly actorMemberId: string;
      readonly delegationChain: readonly Readonly<Record<string, unknown>>[];
      readonly targetMemberId: string;
    },
  ): Promise<number | null> {
    const principalMemberId =
      readDelegationSteps(delegationChain)[0]?.from ?? actorMemberId;
    const date = this.readOrganizationToday();
    const requiredLevel = await this.readMemberPositionLevel(
      manager,
      principalMemberId,
      date,
    );

    if (requiredLevel === null) {
      return null;
    }

    const targetLevel = await this.readMemberPositionLevel(
      manager,
      targetMemberId,
      date,
    );

    return targetLevel === null || targetLevel < requiredLevel
      ? requiredLevel
      : null;
  }

  private async resolveApproverResolver(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: ApproverResolver,
    label: string,
    subject: ResolvedSubject = '簽核人',
    skippedChainMemberIds: readonly string[] = [],
  ): Promise<readonly ResolvedApproverCandidate[]> {
    const memberIds = await this.resolveApproverMemberIds(
      manager,
      instance,
      resolver,
      label,
      subject,
      skippedChainMemberIds,
    );

    return memberIds.map((memberId) => ({
      memberId,
      sourceType: resolver.type,
    }));
  }

  /** The member ids `resolver` routes to; every source type, one branch each. */
  private async resolveApproverMemberIds(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: ApproverResolver,
    label: string,
    subject: ResolvedSubject,
    skippedChainMemberIds: readonly string[],
  ): Promise<readonly string[]> {
    if (resolver.type === 'DIRECT') {
      return readMemberIdsFromValue(resolver.memberIds, label, subject);
    }

    if (resolver.type === 'DYNAMIC_FORM') {
      return readMemberIdsFromValue(
        readValueAtPath(instance.formData, resolver.formPath),
        label,
        subject,
        `依表單欄位「${resolver.formPath}」`,
      );
    }

    if (resolver.type === 'EXPRESSION') {
      return readMemberIdsFromValue(
        this.conditionService.evaluateValue(
          resolver.expression,
          buildWorkflowExpressionContext(instance),
          `${label}.expression`,
          { dialect: readWorkflowExpressionDialect(instance.workflowSnapshot) },
        ),
        label,
        subject,
        '依運算式',
      );
    }

    if (resolver.type === 'POSITION') {
      return this.resolvePositionCandidates(
        manager,
        resolver.positionId,
        label,
        subject,
      );
    }

    if (resolver.type === 'ORG_UNIT_MEMBER') {
      return this.resolveOrgUnitMemberCandidates(
        manager,
        resolver.orgUnitId,
        Boolean(resolver.includeDescendants),
        label,
        subject,
      );
    }

    if (resolver.type === 'ORG_UNIT_POSITION') {
      return this.resolveOrgUnitPositionCandidates(
        manager,
        resolver.orgUnitId,
        resolver.positionId,
        Boolean(resolver.includeDescendants),
        label,
        subject,
      );
    }

    if (resolver.type === 'ORG_UNIT_MANAGER') {
      return this.resolveOrgUnitManagerCandidates(
        manager,
        instance,
        resolver.orgUnitId,
        resolver.fallback,
        label,
        resolver.preferClosestOrgUnit === true,
        subject,
      );
    }

    if (resolver.type === 'ORG_MANAGER_CHAIN') {
      return this.resolveOrgManagerChainCandidates(
        manager,
        instance,
        resolver,
        label,
        subject,
        skippedChainMemberIds,
      );
    }

    if (resolver.type === 'ORG_MANAGER') {
      return this.resolveInitiatorManagerCandidates(
        manager,
        instance,
        resolver.levelsUp,
        resolver.fallback,
        label,
        resolver.preferClosestOrgUnit === true,
        subject,
      );
    }

    if (resolver.type === 'FORM_MEMBER_MANAGER') {
      return this.resolveFormMemberManagerCandidates(
        manager,
        instance,
        resolver,
        label,
        subject,
      );
    }

    if (resolver.type === 'FORM_ORG_UNIT_MANAGER') {
      return this.resolveFormOrgUnitManagerCandidates(
        manager,
        instance,
        resolver,
        label,
        subject,
      );
    }

    if (resolver.type === 'NODE_ACTOR') {
      return this.resolveNodeActorCandidates(
        manager,
        instance,
        resolver,
        label,
        subject,
      );
    }

    if (resolver.type === 'NODE_ACTOR_MANAGER') {
      return this.resolveNodeActorManagerCandidates(
        manager,
        instance,
        resolver,
        label,
        subject,
      );
    }

    // A template saved by a newer engine can carry an approver source this
    // engine does not know. Refuse it by name instead of quietly resolving it
    // as the initiator's manager, which would route the task to the wrong
    // person. That holds as well for a source a newer shared package knows
    // and this engine does not route yet, so the type is named either way.
    const unresolvedType = (resolver as { readonly type: string }).type;

    throw new ConflictException(
      `${label} 無法建立${subject === '通知對象' ? '通知' : '待簽任務'}：此引擎版本不支援簽核人來源「${unresolvedType}」。請升級 BPMCore 後再發佈或執行此流程。`,
    );
  }

  /**
   * FORM_MEMBER_MANAGER: the manager of the one person picked on the form.
   * The picked person is the starting point and is kept out of every level's
   * result, so a unit head who is picked is handed to the tier above instead
   * of coming back as his own manager.
   */
  private async resolveFormMemberManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'FORM_MEMBER_MANAGER' }>,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const source = `依表單欄位「${resolver.formPath}」`;
    const pickedMemberIds = readMemberIdsFromValue(
      readValueAtPath(instance.formData, resolver.formPath),
      label,
      subject,
      source,
    );

    // Picking one silently would route the document by accident.
    if (pickedMemberIds.length > 1) {
      throw new ConflictException(`${label} ${source}只能選一位人員`);
    }

    const levelsUp = readManagerLevelsUp(resolver.levelsUp);
    const managerMemberIds = await this.resolveManagerMemberIdsExcludingSubject(
      manager,
      pickedMemberIds[0],
      levelsUp,
      resolver.preferClosestOrgUnit === true,
    );

    if (managerMemberIds.length > 0) {
      return managerMemberIds;
    }

    return this.resolveFallbackAssignees(
      manager,
      instance,
      resolver.fallback,
      label,
      subject,
      `找不到表單欄位「${resolver.formPath}」所選人員的第 ${levelsUp} 層主管`,
    );
  }

  /**
   * FORM_ORG_UNIT_MANAGER: the manager of the organisation unit picked on the
   * form, through the same rules as a fixed ORG_UNIT_MANAGER. A deleted unit
   * resolves to nobody and takes the "no manager" path.
   */
  private async resolveFormOrgUnitManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'FORM_ORG_UNIT_MANAGER' }>,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const orgUnitValue = readValueAtPath(instance.formData, resolver.formPath);

    // A value that is not a uuid would reach the uuid column of the org unit
    // lookup and surface as a database error instead of this refusal.
    if (
      typeof orgUnitValue !== 'string' ||
      !isSubmittableOrgUnitValue(orgUnitValue)
    ) {
      throw new ConflictException(
        `${label} 依表單欄位「${resolver.formPath}」找不到所選組織`,
      );
    }

    return this.resolveOrgUnitManagerCandidates(
      manager,
      instance,
      orgUnitValue.trim(),
      resolver.fallback,
      label,
      resolver.preferClosestOrgUnit === true,
      subject,
    );
  }

  /**
   * NODE_ACTOR: the people who actually approved the listed earlier nodes.
   * A node nobody approved (never ran, cancelled, or approved only by the SLA
   * timeout) is an error rather than an empty list: handing the task to
   * nobody would stall the instance without saying why.
   */
  private async resolveNodeActorCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'NODE_ACTOR' }>,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const actorMemberIds = await this.readNodeActorMemberIds(
      manager,
      instance,
      resolver.nodeIds,
    );

    if (actorMemberIds.length === 0) {
      throw new ConflictException(
        `${label} 找不到${subject}：${readNodeActorNodeNames(instance, resolver.nodeIds)}沒有實際同意的簽核紀錄`,
      );
    }

    return actorMemberIds;
  }

  /**
   * NODE_ACTOR_MANAGER: the managers `levelsUp` tiers above each person who
   * actually approved the listed nodes, as one set. An approver without a
   * manager is skipped; the fallback runs only when nobody is left.
   */
  private async resolveNodeActorManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'NODE_ACTOR_MANAGER' }>,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const levelsUp = readManagerLevelsUp(resolver.levelsUp);
    const actorMemberIds = await this.readNodeActorMemberIds(
      manager,
      instance,
      resolver.nodeIds,
    );
    const managerGroups = await Promise.all(
      actorMemberIds.map((actorMemberId) =>
        this.resolveManagerMemberIdsExcludingSubject(
          manager,
          actorMemberId,
          levelsUp,
          resolver.preferClosestOrgUnit === true,
        ),
      ),
    );
    const managerMemberIds = uniqueTexts(managerGroups.flat());

    if (managerMemberIds.length > 0) {
      return managerMemberIds;
    }

    return this.resolveFallbackAssignees(
      manager,
      instance,
      resolver.fallback,
      label,
      subject,
      actorMemberIds.length === 0
        ? `${readNodeActorNodeNames(instance, resolver.nodeIds)}沒有實際同意的簽核紀錄`
        : `找不到前面關卡實際簽核人的第 ${levelsUp} 層主管`,
    );
  }

  /**
   * The people who approved the most recent batch of tasks among `nodeIds`,
   * earliest decision first, each once. Read through `manager` so an approval
   * written earlier in the same transaction (the one that is advancing the
   * instance right now) is visible.
   *
   * A batch is the non-ad-hoc tasks of one node on one token: a token never
   * passes a node twice (a return opens a new token, a transfer's replacement
   * task keeps the token), so a later round is a later batch. Tasks created in
   * the same transaction share a `created_at`, so every (node, token) tied for
   * newest counts as one batch. An older batch is never used in place of a
   * newest one nobody approved. Ad-hoc approvals, approvals on cancelled
   * tasks and approvals the SLA timeout made do not count.
   */
  private async readNodeActorMemberIds(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeIds: readonly string[],
  ): Promise<readonly string[]> {
    const approvals = await this.readNodeActorApprovals(
      manager,
      instance,
      nodeIds,
    );

    return uniqueTexts(approvals.map((decision) => decision.decidedByMemberId));
  }

  /**
   * The real approvals (earliest first) of the most recent batch among
   * `nodeIds`: the rows {@link readNodeActorMemberIds} reads the approvers from.
   * Kept as decisions so the exclusion can also reach each decision's task.
   */
  private async readNodeActorApprovals(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    nodeIds: readonly string[],
  ): Promise<readonly TaskDecisionEntity[]> {
    const tasks = await manager.getRepository(TaskEntity).find({
      where: {
        instanceId: instance.id,
        isAdhoc: false,
        nodeId: In([...nodeIds]),
      },
    });

    if (tasks.length === 0) {
      return [];
    }

    const newestCreatedAt = Math.max(
      ...tasks.map((task) => task.createdAt.getTime()),
    );
    const newestTasks = tasks.filter(
      (task) => task.createdAt.getTime() === newestCreatedAt,
    );
    const batchTaskIds = tasks
      .filter(
        (task) =>
          task.status !== TaskStatusEnum.CANCELLED &&
          newestTasks.some(
            (newest) =>
              newest.nodeId === task.nodeId && newest.tokenId === task.tokenId,
          ),
      )
      .map((task) => task.id);

    if (batchTaskIds.length === 0) {
      return [];
    }

    const [decisions, decidedLogs] = await Promise.all([
      manager.getRepository(TaskDecisionEntity).find({
        where: {
          action: TaskDecisionActionEnum.APPROVED,
          taskId: In(batchTaskIds),
        },
      }),
      manager.getRepository(ActivityLogEntity).find({
        where: {
          eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
          instanceId: instance.id,
          taskId: In(batchTaskIds),
        },
      }),
    ]);
    const automaticDecisionIds = new Set(
      decidedLogs
        .filter((log) => log.payload['automatic'] === SLA_AUTO_APPROVE_MARK)
        .map((log) => log.payload['decisionId']),
    );

    return [...decisions]
      .filter((decision) => !automaticDecisionIds.has(decision.id))
      .sort(
        (first, second) =>
          first.decidedAt.getTime() - second.decidedAt.getTime(),
      );
  }

  private async resolvePositionCandidates(
    manager: EntityManager,
    positionId: string,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const memberIds = await this.readActivePositionMemberIds(
      manager,
      positionId,
    );

    if (!memberIds.length) {
      throw new ConflictException(
        `${label} 找不到${subject}：職位「${await this.readPositionName(manager, positionId)}」目前沒有任何有效成員`,
      );
    }

    return memberIds;
  }

  /**
   * The members who hold the position today (organisation time zone) within
   * their effective period. Primary memberships come first, then the most
   * recently started. Empty when nobody holds it; never throws.
   */
  private async readActivePositionMemberIds(
    manager: EntityManager,
    positionId: string,
  ): Promise<readonly string[]> {
    const today = this.readOrganizationToday();
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { positionId },
    });
    const activeMemberships = memberships
      .filter(
        (membership) =>
          membership.effectiveFrom <= today &&
          (!membership.effectiveTo || membership.effectiveTo >= today),
      )
      .sort((first, second) => {
        if (first.isPrimary !== second.isPrimary) {
          return first.isPrimary ? -1 : 1;
        }

        return second.effectiveFrom.localeCompare(first.effectiveFrom);
      });

    return uniqueTexts(
      activeMemberships.map((membership) => membership.memberId),
    );
  }

  private async resolveInitiatorManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    levelsUp: number,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    preferClosestOrgUnit: boolean,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const normalizedLevelsUp = Math.max(Math.trunc(levelsUp), 1);
    const resolvedManagerMemberIds =
      await this.resolveManagerMemberIdsFromOrganization(
        manager,
        instance.initiatorMemberId,
        normalizedLevelsUp,
        preferClosestOrgUnit,
      );

    if (resolvedManagerMemberIds.length) {
      return resolvedManagerMemberIds;
    }

    return this.resolveFallbackAssignees(
      manager,
      instance,
      fallback,
      label,
      subject,
      `找不到發起人的第 ${normalizedLevelsUp} 層主管`,
    );
  }

  /**
   * Walks up a manager chain, nearest manager first, until a manager whose
   * position level reaches `minPositionLevel` is added. The chain starts at
   * the initiator unless `startFrom` names someone else, and the start person
   * is never on it: the walk begins at their direct manager. The list is
   * returned nearest manager first. Members in `skippedMemberIds` are walked
   * past without joining the chain or counting as the stopping point, and so
   * are managers below `startPositionLevel`, until the first one at or above
   * it starts the chain.
   */
  private async resolveOrgManagerChainCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'ORG_MANAGER_CHAIN' }>,
    label: string,
    subject: ResolvedSubject,
    skippedMemberIds: readonly string[],
  ): Promise<readonly string[]> {
    const { fallback, minPositionLevel } = resolver;
    const startPositionLevel = readOrgManagerChainStartPositionLevel(resolver);
    const start = await this.resolveOrgManagerChainStart(
      manager,
      instance,
      resolver,
      label,
      subject,
    );

    // Nobody to climb from: the same "no manager" path as a chain whose walk
    // finds nobody, so the fallback decides.
    if (start.memberId === null) {
      return this.resolveFallbackAssignees(
        manager,
        instance,
        fallback,
        label,
        subject,
        start.missingReason,
      );
    }

    const date = this.readOrganizationToday();
    const visitedMemberIds = new Set<string>([start.memberId]);
    const chain: string[] = [];
    let currentMemberId = start.memberId;
    let lastAddedLevel: number | null = null;

    for (let hop = 0; hop < ORG_MANAGER_CHAIN_MAX_HOPS; hop += 1) {
      // A chain is a single path, so it always uses closest-org-unit semantics
      // (merging ancestor-unit rules could only produce ties). The member is
      // excluded from his own candidates: a unit head belongs to the unit he
      // heads, so without this his unit rule would name himself and the walk
      // could never climb past him.
      const directManagerMemberIds = await this.resolveDirectManagerMemberIds(
        manager,
        currentMemberId,
        date,
        true,
        [currentMemberId],
      );

      if (directManagerMemberIds.length === 0) {
        break;
      }

      if (directManagerMemberIds.length > 1) {
        // Picking one silently would route the document by accident.
        throw new ConflictException(
          `${label} 無法沿主管鏈簽核：成員 ${currentMemberId} 的主管規則在同一優先順序出現多位主管（${directManagerMemberIds.join('、')}），無法決定簽核路徑。請聯絡流程管理員調整主管規則。`,
        );
      }

      const [managerMemberId] = directManagerMemberIds;

      if (visitedMemberIds.has(managerMemberId)) {
        break;
      }

      visitedMemberIds.add(managerMemberId);
      currentMemberId = managerMemberId;

      // A member the node keeps out (the person who filed the document) is
      // climbed through, not stopped at: filtering him after the walk would
      // lose the chain when he is the manager that reaches the level.
      if (skippedMemberIds.includes(managerMemberId)) {
        continue;
      }

      const level = await this.readMemberPositionLevel(
        manager,
        managerMemberId,
        date,
      );

      if (
        level === null ||
        (lastAddedLevel !== null && level <= lastAddedLevel)
      ) {
        continue;
      }

      // Below the start level a manager is walked past like one without a
      // position: he neither joins the chain nor raises the bar the next
      // manager has to clear. Every manager added after the first is above
      // the last one added, so this only ever holds before the chain starts.
      if (startPositionLevel !== null && level < startPositionLevel) {
        continue;
      }

      chain.push(managerMemberId);
      lastAddedLevel = level;

      if (level >= minPositionLevel) {
        return chain;
      }
    }

    // A position fallback can name several holders. They all join the last
    // tier, so they all have to sign, the same as every other chain member.
    const fallbackMemberIds = await this.resolveFallbackAssignees(
      manager,
      instance,
      fallback,
      label,
      subject,
      chain.length === 0 && startPositionLevel !== null
        ? `${start.description}沿主管鏈找不到職等達 ${startPositionLevel} 的主管（起始職等 ${startPositionLevel}、簽到職等 ${minPositionLevel}）`
        : `${start.description}沿主管鏈找不到職等達 ${minPositionLevel} 的主管`,
    );

    return uniqueTexts([...chain, ...fallbackMemberIds]);
  }

  /**
   * Whose manager an `ORG_MANAGER_CHAIN` starts from. `memberId` is `null`
   * when the start names nobody (an empty form field, an earlier stage nobody
   * approved), with `missingReason` saying why; `description` is the lead-in
   * of the "no manager reaches the level" reason, empty for the initiator so
   * a chain without a start keeps today's wording.
   *
   * A start that picks more than one person is refused rather than guessed,
   * the same as a manager rule that names several managers at one priority.
   */
  private async resolveOrgManagerChainStart(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    resolver: Extract<ApproverResolver, { type: 'ORG_MANAGER_CHAIN' }>,
    label: string,
    subject: ResolvedSubject,
  ): Promise<{
    readonly description: string;
    readonly memberId: string | null;
    readonly missingReason: string;
  }> {
    if (isOrgManagerChainStartedFromInitiator(resolver)) {
      return {
        description: '',
        memberId: instance.initiatorMemberId,
        missingReason: '',
      };
    }

    // `INITIATOR` (and an absent start) was answered above.
    const startFrom = resolver.startFrom as Exclude<
      NonNullable<typeof resolver.startFrom>,
      { readonly type: 'INITIATOR' }
    >;
    const unsupportedType = readUnsupportedOrgManagerChainStartType(
      startFrom as { readonly type: string },
    );
    const failure =
      subject === '通知對象' ? '無法建立通知' : '無法建立待簽任務';

    // A template saved by a newer engine can carry a start this engine does
    // not know. Refuse it by name instead of climbing from the initiator,
    // which would route the task to the wrong people.
    if (unsupportedType !== null) {
      throw new ConflictException(
        `${label} ${failure}：此引擎版本不支援主管鏈起點「${unsupportedType}」。請升級 BPMCore 後再發佈或執行此流程。`,
      );
    }

    // A notify node has no earlier stage and no form pick the publish lint
    // would have checked; one that reaches here anyway is refused.
    if (subject === '通知對象') {
      throw new ConflictException(
        `${label} ${failure}：知會節點的主管鏈只能從發起人開始。`,
      );
    }

    if (startFrom.type === 'FORM_MEMBER') {
      const source = `依表單欄位「${startFrom.formPath}」`;
      const pickedMemberIds = findMemberIdsInValue(
        readValueAtPath(instance.formData, startFrom.formPath),
      );

      // Picking one silently would route the document by accident.
      if (pickedMemberIds.length > 1) {
        throw new ConflictException(`${label} ${source}只能選一位人員`);
      }

      return {
        description: `從表單欄位「${startFrom.formPath}」所選人員起算，`,
        memberId: pickedMemberIds[0] ?? null,
        missingReason: `表單欄位「${startFrom.formPath}」沒有選人員`,
      };
    }

    const nodeNames = readNodeActorNodeNames(instance, startFrom.nodeIds);
    const actorMemberIds = await this.readNodeActorMemberIds(
      manager,
      instance,
      startFrom.nodeIds,
    );

    if (actorMemberIds.length > 1) {
      throw new ConflictException(
        `${label} 無法沿主管鏈簽核：${nodeNames}有多位實際簽核人（${actorMemberIds.join('、')}），無法決定從誰的主管開始。請改選只有一位簽核人的關卡。`,
      );
    }

    return {
      description: `從${nodeNames}的簽核者起算，`,
      memberId: actorMemberIds[0] ?? null,
      missingReason: `${nodeNames}沒有實際同意的簽核紀錄`,
    };
  }

  /** Highest position level over the member's active memberships, or `null`. */
  private async readMemberPositionLevel(
    manager: EntityManager,
    memberId: string,
    date: string,
  ): Promise<number | null> {
    return (
      (await this.readMemberPositionLevels(manager, [memberId], date)).get(
        memberId,
      ) ?? null
    );
  }

  /**
   * {@link readMemberPositionLevel} for several members in two queries: every
   * requested member is in the map, `null` when they hold no graded position.
   */
  private async readMemberPositionLevels(
    manager: EntityManager,
    memberIds: readonly string[],
    date: string,
  ): Promise<ReadonlyMap<string, number | null>> {
    const uniqueMemberIds = uniqueTexts(memberIds);

    if (uniqueMemberIds.length === 0) {
      return new Map();
    }

    const memberships = (
      await manager.getRepository(MembershipEntity).find({
        where: { memberId: In([...uniqueMemberIds]) },
      })
    ).filter(
      (membership) =>
        Boolean(membership.positionId) && isDateRangeActive(membership, date),
    );
    const positionIds = uniqueTexts(
      memberships.map((membership) => membership.positionId ?? ''),
    );
    const positions =
      positionIds.length === 0
        ? []
        : await manager.getRepository(PositionEntity).find({
            where: { id: In([...positionIds]) },
          });
    const levelByPositionId = new Map(
      positions.map((position) => [position.id, position.level]),
    );

    return new Map(
      uniqueMemberIds.map((memberId) => {
        const levels = memberships
          .filter((membership) => membership.memberId === memberId)
          .flatMap((membership) => {
            const level = levelByPositionId.get(membership.positionId ?? '');

            return level === undefined ? [] : [level];
          });

        return [memberId, levels.length === 0 ? null : Math.max(...levels)];
      }),
    );
  }

  /**
   * Every member a manager resolver's fallback yields. A `DIRECT` or `NONE`
   * fallback yields at most one; a `POSITION` fallback yields the position's
   * current holders, minus the initiator unless the fallback allows self
   * approval. Failure throws, as the single-member path does.
   */
  private async resolveFallbackAssignees(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    subject: ResolvedSubject,
    failureReason: string,
  ): Promise<readonly string[]> {
    if (fallback?.type !== 'POSITION') {
      return [
        this.resolveFallbackAssignee(
          instance,
          fallback,
          label,
          subject,
          failureReason,
        ),
      ];
    }

    const failure =
      subject === '通知對象' ? '無法建立通知' : '無法建立待簽任務';

    if (!fallback.positionId.trim()) {
      throw new ConflictException(`${label} ${failure}：改派職位未設定。`);
    }

    const holderMemberIds = await this.readActivePositionMemberIds(
      manager,
      fallback.positionId,
    );

    if (holderMemberIds.length === 0) {
      throw new ConflictException(
        `${label} ${failure}：${failureReason}，且改派職位「${await this.readPositionName(manager, fallback.positionId)}」目前沒有任何有效成員。請聯絡流程管理員調整主管規則或模板 fallback。`,
      );
    }

    const assignees = fallback.allowInitiatorSelfApproval
      ? holderMemberIds
      : holderMemberIds.filter(
          (memberId) => memberId !== instance.initiatorMemberId,
        );

    if (assignees.length === 0) {
      throw new ConflictException(
        `${label} ${failure}：${failureReason}，且改派職位的有效成員只有申請人本人，此節點未允許申請人自簽。`,
      );
    }

    return assignees;
  }

  private resolveFallbackAssignee(
    instance: ApprovalInstanceEntity,
    fallback:
      | Exclude<ApproverResolverFallback, { readonly type: 'POSITION' }>
      | undefined,
    label: string,
    subject: ResolvedSubject,
    failureReason: string,
  ): string {
    const failure =
      subject === '通知對象' ? '無法建立通知' : '無法建立待簽任務';

    if (!fallback || fallback.type === 'NONE') {
      throw new ConflictException(
        `${label} ${failure}：${failureReason}，且未設定改派固定人。請聯絡流程管理員調整主管規則或模板 fallback。`,
      );
    }

    // A template saved by a newer engine can carry a fallback type this
    // engine does not know. Refuse it by name instead of reading `memberId`
    // off a shape it does not have, which surfaced as an opaque TypeError.
    const unsupportedType = readUnsupportedApproverFallbackType(fallback);

    if (unsupportedType !== null) {
      throw new ConflictException(
        `${label} ${failure}：${failureReason}，且此引擎版本不支援改派類型「${unsupportedType}」。請升級 BPMCore 後再發佈或執行此流程。`,
      );
    }

    if (!fallback.memberId.trim()) {
      throw new ConflictException(`${label} ${failure}：改派固定人未設定。`);
    }

    if (
      fallback.memberId === instance.initiatorMemberId &&
      !fallback.allowInitiatorSelfApproval
    ) {
      throw new ConflictException(
        `${label} ${failure}：改派固定人是申請人本人，且此節點未允許申請人自簽。`,
      );
    }

    return fallback.memberId;
  }

  private async resolveManagerMemberIdsFromOrganization(
    manager: EntityManager,
    memberId: string,
    levelsUp: number,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    return this.resolveManagerMemberIdsAtLevel(
      manager,
      memberId,
      this.readOrganizationToday(),
      levelsUp,
      preferClosestOrgUnit,
    );
  }

  private async resolveManagerMemberIdsAtLevel(
    manager: EntityManager,
    memberId: string,
    date: string,
    remainingLevels: number,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const directManagerMemberIds = await this.resolveDirectManagerMemberIds(
      manager,
      memberId,
      date,
      preferClosestOrgUnit,
    );

    if (remainingLevels <= 1 || directManagerMemberIds.length === 0) {
      return directManagerMemberIds;
    }

    const nextLevelGroups = await Promise.all(
      directManagerMemberIds.map((managerMemberId) =>
        this.resolveManagerMemberIdsAtLevel(
          manager,
          managerMemberId,
          date,
          remainingLevels - 1,
          preferClosestOrgUnit,
        ),
      ),
    );

    return uniqueTexts(nextLevelGroups.flat());
  }

  /**
   * The managers `levelsUp` tiers above `startMemberId`. Every tier is looked
   * up with the person it starts from excluded (as the manager chain does), so
   * a unit head falls through to the tier above, and anyone already walked
   * past — the starting person included — counts as nobody, so a pair of
   * mutual managers cannot loop back. Nobody at any tier returns `[]`; the
   * caller applies its own fallback.
   */
  private async resolveManagerMemberIdsExcludingSubject(
    manager: EntityManager,
    startMemberId: string,
    levelsUp: number,
    preferClosestOrgUnit: boolean,
  ): Promise<readonly string[]> {
    const date = this.readOrganizationToday();
    let walkedMemberIds: readonly string[] = [startMemberId];
    let currentMemberIds: readonly string[] = [startMemberId];

    for (let level = 0; level < levelsUp; level += 1) {
      const managerGroups = await Promise.all(
        currentMemberIds.map((memberId) =>
          this.resolveDirectManagerMemberIds(
            manager,
            memberId,
            date,
            preferClosestOrgUnit,
            [memberId],
          ),
        ),
      );
      const nextMemberIds = uniqueTexts(managerGroups.flat()).filter(
        (memberId) => !walkedMemberIds.includes(memberId),
      );

      if (nextMemberIds.length === 0) {
        return [];
      }

      walkedMemberIds = [...walkedMemberIds, ...nextMemberIds];
      currentMemberIds = nextMemberIds;
    }

    return currentMemberIds;
  }

  private async resolveDirectManagerMemberIds(
    manager: EntityManager,
    memberId: string,
    date: string,
    preferClosestOrgUnit: boolean,
    excludedManagerMemberIds: readonly string[] = [],
  ): Promise<readonly string[]> {
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { memberId },
    });
    const activeMemberships = memberships.filter((membership) =>
      isDateRangeActive(membership, date),
    );
    const directOrgUnitIds = activeMemberships.map(
      (membership) => membership.orgUnitId,
    );
    const positionIds = activeMemberships
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId));
    const orgUnits = await this.readOrgUnitAndAncestors(
      manager,
      directOrgUnitIds,
    );
    const candidatePairs = [
      { scopeId: memberId, scopeType: ManagerResolutionScopeTypeEnum.MEMBER },
      ...orgUnits.map((orgUnit) => ({
        scopeId: orgUnit.id,
        scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
      })),
      ...positionIds.map((scopeId) => ({
        scopeId,
        scopeType: ManagerResolutionScopeTypeEnum.POSITION,
      })),
    ];

    return this.resolveManagerResolutionCandidates(
      manager,
      candidatePairs,
      date,
      readOrgUnitDepthMap(orgUnits),
      preferClosestOrgUnit,
      excludedManagerMemberIds,
    );
  }

  private async resolveOrgUnitManagerCandidates(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    orgUnitId: string,
    fallback: ApproverResolverFallback | undefined,
    label: string,
    preferClosestOrgUnit: boolean,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const date = this.readOrganizationToday();
    const orgUnits = await this.readOrgUnitAndAncestors(manager, [orgUnitId]);
    const managerMemberIds = await this.resolveManagerResolutionCandidates(
      manager,
      orgUnits.map((orgUnit) => ({
        scopeId: orgUnit.id,
        scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
      })),
      date,
      readOrgUnitDepthMap(orgUnits),
      preferClosestOrgUnit,
    );

    if (!managerMemberIds.length) {
      return this.resolveFallbackAssignees(
        manager,
        instance,
        fallback,
        label,
        subject,
        `找不到指定組織的主管規則`,
      );
    }

    return managerMemberIds;
  }

  private async readOrgUnitAndAncestors(
    manager: EntityManager,
    orgUnitIds: readonly string[],
  ): Promise<readonly OrgUnitEntity[]> {
    if (!orgUnitIds.length) {
      return [];
    }

    const orgUnitRepository = manager.getRepository(OrgUnitEntity);
    const directOrgUnits = await orgUnitRepository.find({
      where: { deletedAt: IsNull(), id: In([...orgUnitIds]) },
    });
    const ancestorGroups = await Promise.all(
      directOrgUnits.map((orgUnit) =>
        orgUnitRepository
          .createQueryBuilder('orgUnit')
          .where('orgUnit.deleted_at IS NULL')
          .andWhere('orgUnit.path @> :path', { path: orgUnit.path })
          .getMany(),
      ),
    );
    const byId = new Map(
      [...directOrgUnits, ...ancestorGroups.flat()].map(
        (orgUnit): readonly [string, OrgUnitEntity] => [orgUnit.id, orgUnit],
      ),
    );

    return [...byId.values()];
  }

  private async resolveManagerResolutionCandidates(
    manager: EntityManager,
    candidatePairs: readonly {
      readonly scopeId: string;
      readonly scopeType: ManagerResolutionScopeTypeEnum;
    }[],
    date: string,
    orgUnitDepths: ReadonlyMap<string, number>,
    preferClosestOrgUnit: boolean,
    excludedManagerMemberIds: readonly string[] = [],
  ): Promise<readonly string[]> {
    const scopeIds = candidatePairs.map((pair) => pair.scopeId);

    if (!scopeIds.length) {
      return [];
    }

    const resolutions = await manager
      .getRepository(ManagerResolutionEntity)
      .find({
        where: {
          scopeId: In([...scopeIds]),
          scopeType: In([
            ManagerResolutionScopeTypeEnum.MEMBER,
            ManagerResolutionScopeTypeEnum.ORG_UNIT,
            ManagerResolutionScopeTypeEnum.POSITION,
          ]),
        },
      });
    const depthLookup = preferClosestOrgUnit ? orgUnitDepths : undefined;
    const active = resolutions
      .filter((resolution) =>
        candidatePairs.some(
          (pair) =>
            pair.scopeId === resolution.scopeId &&
            pair.scopeType === resolution.scopeType,
        ),
      )
      .filter((resolution) => isDateRangeActive(resolution, date))
      // Dropped before the top-priority tier is chosen, so resolution falls
      // through to the next tier instead of ending on the excluded member.
      .filter(
        (resolution) =>
          !excludedManagerMemberIds.includes(resolution.managerMemberId),
      )
      .sort((left, right) =>
        compareManagerResolution(left, right, depthLookup),
      );

    return uniqueTexts(
      readTopPriorityResolutions(active, depthLookup).map(
        (resolution) => resolution.managerMemberId,
      ),
    );
  }

  private async resolveOrgUnitMemberCandidates(
    manager: EntityManager,
    orgUnitId: string,
    includeDescendants: boolean,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const scope = await this.readOrgUnitScope(
      manager,
      orgUnitId,
      includeDescendants,
    );

    if (!scope) {
      throw new ConflictException(
        readMissingOrgUnitMessage(label, subject, orgUnitId),
      );
    }

    const today = this.readOrganizationToday();
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { orgUnitId: In([...scope.orgUnitIds]) },
    });
    const memberIds = memberships
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership)
      .map((membership) => membership.memberId);

    if (memberIds.length === 0) {
      throw new ConflictException(
        `${label} 找不到${subject}：組織「${scope.name}」目前沒有任何有效成員，請先將人員加入該組織`,
      );
    }

    return uniqueTexts(memberIds);
  }

  private async resolveOrgUnitPositionCandidates(
    manager: EntityManager,
    orgUnitId: string,
    positionId: string,
    includeDescendants: boolean,
    label: string,
    subject: ResolvedSubject,
  ): Promise<readonly string[]> {
    const scope = await this.readOrgUnitScope(
      manager,
      orgUnitId,
      includeDescendants,
    );

    if (!scope) {
      throw new ConflictException(
        readMissingOrgUnitMessage(label, subject, orgUnitId),
      );
    }

    const today = this.readOrganizationToday();
    const memberships = await manager.getRepository(MembershipEntity).find({
      where: { orgUnitId: In([...scope.orgUnitIds]), positionId },
    });
    const memberIds = memberships
      .filter((membership) => isDateRangeActive(membership, today))
      .sort(compareMembership)
      .map((membership) => membership.memberId);

    if (memberIds.length === 0) {
      throw new ConflictException(
        `${label} 找不到${subject}：組織「${scope.name}」的職位「${await this.readPositionName(manager, positionId)}」目前沒有任何有效成員`,
      );
    }

    return uniqueTexts(memberIds);
  }

  // Names only make an error readable, so a row that has gone missing falls
  // back to its id instead of hiding the real problem.
  private async readPositionName(
    manager: EntityManager,
    positionId: string,
  ): Promise<string> {
    const position = await manager
      .getRepository(PositionEntity)
      .findOne({ where: { id: positionId } });

    return position?.name ?? positionId;
  }

  /** The org unit's name and the ids it covers, or `null` once it is gone. */
  private async readOrgUnitScope(
    manager: EntityManager,
    orgUnitId: string,
    includeDescendants: boolean,
  ): Promise<{
    readonly name: string;
    readonly orgUnitIds: readonly string[];
  } | null> {
    const orgUnitRepository = manager.getRepository(OrgUnitEntity);
    const orgUnit = await orgUnitRepository.findOne({
      where: { deletedAt: IsNull(), id: orgUnitId },
    });

    if (!orgUnit) {
      return null;
    }

    if (!includeDescendants) {
      return { name: orgUnit.name, orgUnitIds: [orgUnit.id] };
    }

    const descendants = await orgUnitRepository
      .createQueryBuilder('orgUnit')
      .where('orgUnit.deleted_at IS NULL')
      .andWhere('orgUnit.path <@ :path', { path: orgUnit.path })
      .getMany();

    return {
      name: orgUnit.name,
      orgUnitIds: uniqueTexts([
        orgUnit.id,
        ...descendants.map((unit) => unit.id),
      ]),
    };
  }

  private async processExclusiveGateway(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: Extract<WorkflowNode, { readonly type: 'exclusiveGateway' }>,
  ): Promise<void> {
    if (node.data.direction !== 'split') {
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    const edge = (
      await this.readAvailableOutgoingEdges(manager, instance, node)
    )[0];

    await this.advanceTokenAlongEdge(manager, instance, token, node, edge);
  }

  private async executeServiceTask(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    node: ServiceTaskNode,
  ): Promise<void> {
    const activityRepository = manager.getRepository(ActivityLogEntity);
    const action = node.data.action;

    if (action.type === 'WEBHOOK') {
      const payload =
        typeof action.payload === 'string' && action.payload.trim()
          ? this.conditionService.evaluateValue(
              action.payload,
              buildWorkflowExpressionContext(instance),
              `workflow.nodes.${node.id}.data.action.payload`,
              {
                dialect: readWorkflowExpressionDialect(
                  instance.workflowSnapshot,
                ),
              },
            )
          : {
              instance: buildWorkflowExpressionContext(instance).instance,
              triggeredAt: new Date().toISOString(),
            };
      await this.dispatchWebhookAfterCommit(manager, {
        instanceId: instance.id,
        readActivityLog: (result) => ({
          actorMemberId: null,
          eventType: result.ok
            ? ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED
            : ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            action: 'WEBHOOK',
            error: result.error,
            ok: result.ok,
            status: result.status,
            tokenId: token.id,
            url: action.url,
          },
          taskId: null,
        }),
        send: () =>
          executeWebhookServiceAction(
            this.serviceTaskDispatcher,
            action,
            payload,
          ),
      });
      await this.advanceTokenToOutgoingNodes(manager, instance, token, node);

      return;
    }

    if (action.type === 'SET_FORM_FIELD') {
      const value = this.conditionService.evaluateValue(
        action.value,
        buildWorkflowExpressionContext(instance),
        `workflow.nodes.${node.id}.data.action.value`,
        { dialect: readWorkflowExpressionDialect(instance.workflowSnapshot) },
      );

      assertServiceTaskFieldValue(
        instance.formDefinitionSnapshot,
        action.fieldPath,
        value,
        node.data.label,
      );

      const updatedFormData = writeValueAtPath(
        instance.formData,
        action.fieldPath,
        value,
      );

      await this.assertCurrentFilterableFormDataValues(
        instance.templateId,
        updatedFormData,
        manager,
        node.data.label,
      );
      // A service task runs inside this transaction, so it cannot call a host
      // provider to re-resolve the label. Rather than leave the previous
      // option snapshot describing a value that no longer exists, drop it: the
      // history view then shows the raw value instead of a wrong label.
      const staleSnapshotFieldKey = readDataSourceFieldKeyAtPath(
        instance.formDefinitionSnapshot,
        action.fieldPath,
      );
      const updatedOptionSnapshot = staleSnapshotFieldKey
        ? readSnapshotWithoutField(
            instance.formDataOptionSnapshot,
            staleSnapshotFieldKey,
          )
        : instance.formDataOptionSnapshot;
      const updatedInstance = await manager
        .getRepository(ApprovalInstanceEntity)
        .save({
          ...instance,
          formData: updatedFormData,
          formDataOptionSnapshot: updatedOptionSnapshot,
        });

      Object.assign(instance, updatedInstance);
      await activityRepository.save(
        activityRepository.create({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED,
          instanceId: instance.id,
          nodeId: node.id,
          payload: {
            action: 'SET_FORM_FIELD',
            clearedOptionSnapshot: staleSnapshotFieldKey ?? null,
            fieldPath: action.fieldPath,
            tokenId: token.id,
          },
          taskId: null,
        }),
      );
      await this.advanceTokenToOutgoingNodes(
        manager,
        updatedInstance,
        token,
        node,
      );

      return;
    }

    // The sources that read the form or an earlier node's outcome are not
    // offered to a notify node (the publish lint refuses them); a definition
    // that reaches here with one anyway is refused by name. A type this
    // engine does not know is left to the resolver's own refusal below.
    if (
      readUnsupportedApproverResolverType(action.recipients) === null &&
      !isNotifyRecipientResolverType(action.recipients.type)
    ) {
      throw new ConflictException(
        `知會節點「${node.data.label}」不能使用簽核人來源「${action.recipients.type}」當收件人，請改用指定人員、職位、組織或主管`,
      );
    }

    // A webhook-only NOTIFY node names nobody. Resolving its empty DIRECT
    // resolver would throw and roll back the submit or decision that reached
    // it, so skip member resolution; webhooks are delivered separately.
    const recipients =
      isNotifyRecipientsEmpty(action.recipients) &&
      readNotifyWebhookTargets(action).length > 0
        ? []
        : await this.resolveApproverResolver(
            manager,
            instance,
            action.recipients,
            `知會節點「${node.data.label}」`,
            '通知對象',
          );
    const recipientMemberIds = uniqueTexts(
      recipients.map((recipient) => recipient.memberId),
    );

    await this.notificationService.createServiceTaskNotifications({
      instance,
      manager,
      node,
      recipientMemberIds,
    });

    // Queued in this transaction and sent only after it commits (ADR 18
    // §3.5). Without the webhook module there is nothing to queue into; the
    // publish lint already refuses a template that references an endpoint
    // in that case.
    const webhookDeliveryIds =
      this.webhookDeliveryService && readNotifyWebhookTargets(action).length > 0
        ? await this.webhookDeliveryService.enqueueNotifyWebhooks(
            manager,
            {
              instance: {
                formData: instance.formData,
                id: instance.id,
                initiatorMemberId: instance.initiatorMemberId,
                templateId: instance.templateId,
                templateVersionId: instance.templateVersionId,
                title: instance.title,
              },
              node: { id: node.id, label: node.data.label },
              occurredAt: new Date(),
              tokenId: token.id,
            },
            action.webhooks,
          )
        : [];

    await this.consumeToken(manager, token);
    await activityRepository.save(
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: node.id,
        payload: {
          action: 'NOTIFY',
          recipientMemberIds,
          tokenId: token.id,
          ...(webhookDeliveryIds.length ? { webhookDeliveryIds } : {}),
        },
        taskId: null,
      }),
    );
  }

  private async rejectInstance(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    rejectedAt: Date,
  ): Promise<void> {
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);

    // Dispatch pending ad-hoc notifications for the rejecting node before the
    // remaining directives are cancelled by the terminal cleanup below.
    await this.dispatchAdhocStageNotifications(
      manager,
      instance,
      task.nodeId,
      'REJECTED',
    );

    // Consume open tokens and cancel any still-open tasks (parallel branches,
    // ad-hoc countersign / pre-approval tasks) so nothing actionable lingers
    // on a rejected instance.
    await this.consumeOpenRuntimeState(
      manager,
      instance,
      rejectedAt,
      TaskStatusEnum.CANCELLED,
    );
    await this.notificationService.supersedeInstanceTaskNotifications({
      instanceId: instance.id,
      manager,
    });

    const rejectedInstance = await instanceRepository.save({
      ...instance,
      completedAt: rejectedAt,
      state: ApprovalInstanceStateEnum.REJECTED,
    });
    await this.dispatchAdhocCompletionNotifications(
      manager,
      rejectedInstance,
      ApprovalInstanceStateEnum.REJECTED,
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, null);
    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          action: 'REJECTED',
          taskId: task.id,
        },
        taskId: task.id,
      }),
    );
  }

  private async returnInstanceToNode(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    task: TaskEntity,
    returnToNodeId: string | null,
    returnedAt: Date,
  ): Promise<void> {
    if (!returnToNodeId) {
      throw new ConflictException('Return target node is required');
    }

    const targetNode = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      returnToNodeId,
    );
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const instanceRepository = manager.getRepository(ApprovalInstanceEntity);
    const activityRepository = manager.getRepository(ActivityLogEntity);

    // The returning node's stage has ended (outcome: RETURNED) — dispatch its
    // pending ad-hoc stage notifications, then drop flow-affecting ad-hoc
    // directives so they cannot replay after the return/resubmit cycle.
    await this.dispatchAdhocStageNotifications(
      manager,
      instance,
      task.nodeId,
      'RETURNED',
    );
    await this.cancelPendingAdhocDirectives(manager, instance.id, [
      AdhocDirectiveTypeEnum.COUNTERSIGN,
      AdhocDirectiveTypeEnum.PRE_APPROVAL,
    ]);
    await this.consumeOpenRuntimeState(
      manager,
      instance,
      returnedAt,
      TaskStatusEnum.CANCELLED,
    );

    const returnedInstance = await instanceRepository.save({
      ...instance,
      completedAt: null,
      state:
        targetNode.type === 'startEvent'
          ? ApprovalInstanceStateEnum.RETURNED
          : ApprovalInstanceStateEnum.RUNNING,
    });
    const resubmitStrategy = readReturnResubmitStrategy(task, instance);
    const returnToken = await tokenRepository.save(
      tokenRepository.create({
        consumedAt: null,
        currentNodeId: targetNode.id,
        instanceId: instance.id,
        parentTokenId: null,
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
    );

    await activityRepository.save([
      activityRepository.create({
        actorMemberId: task.assigneeMemberId,
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          resubmitStrategy,
          returnedFromNodeId: task.nodeId,
          returnToNodeId: targetNode.id,
          taskId: task.id,
        },
        taskId: task.id,
      }),
      activityRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
        instanceId: instance.id,
        nodeId: targetNode.id,
        payload: {
          returnedFromNodeId: task.nodeId,
          tokenId: returnToken.id,
        },
        taskId: null,
      }),
    ]);

    if (returnedInstance.state === ApprovalInstanceStateEnum.RUNNING) {
      await this.processRunningInstance(manager, returnedInstance);
    }
  }

  private async readLatestReturnedInstanceContext(
    manager: EntityManager,
    instanceId: string,
  ): Promise<ReturnedInstanceContext | null> {
    const activity = await manager.getRepository(ActivityLogEntity).findOne({
      order: { seq: 'DESC' },
      where: {
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        instanceId,
      },
    });

    if (!activity) {
      return null;
    }

    const returnToNodeId = readStringPayloadValue(
      activity.payload,
      'returnToNodeId',
    );
    const returnedFromNodeId =
      readStringPayloadValue(activity.payload, 'returnedFromNodeId') ??
      activity.nodeId;

    if (!returnToNodeId || !returnedFromNodeId) {
      return null;
    }

    return {
      resubmitStrategy: readReturnResubmitStrategyFromPayload(activity.payload),
      returnedFromNodeId,
      returnToNodeId,
    };
  }

  private async resumeReturnedInstanceFromReturnPoint(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    context: ReturnedInstanceContext,
    resubmittedAt: Date,
  ): Promise<ApprovalInstanceEntity> {
    const targetNode = readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      context.returnToNodeId,
    );

    if (targetNode.type !== 'startEvent') {
      return instance;
    }

    readWorkflowNodeOrThrow(
      instance.workflowSnapshot,
      context.returnedFromNodeId,
    );

    await this.consumeOpenRuntimeState(
      manager,
      instance,
      resubmittedAt,
      TaskStatusEnum.CANCELLED,
    );

    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const returnPointToken = await tokenRepository.save(
      tokenRepository.create({
        consumedAt: null,
        currentNodeId: context.returnedFromNodeId,
        instanceId: instance.id,
        parentTokenId: null,
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
    );

    await manager.getRepository(ActivityLogEntity).save(
      manager.getRepository(ActivityLogEntity).create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
        instanceId: instance.id,
        nodeId: context.returnedFromNodeId,
        payload: {
          resubmitStrategy: context.resubmitStrategy,
          resumedFromNodeId: context.returnToNodeId,
          tokenId: returnPointToken.id,
        },
        taskId: null,
      }),
    );

    return instance;
  }

  private async consumeOpenRuntimeState(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    consumedAt: Date,
    taskStatus: TaskStatusEnum,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const taskRepository = manager.getRepository(TaskEntity);
    const tokens = await tokenRepository.find({
      where: { instanceId: instance.id },
    });
    const openTokens = tokens.filter(
      (token) =>
        token.status === WorkflowTokenStatusEnum.ACTIVE ||
        token.status === WorkflowTokenStatusEnum.WAITING,
    );
    const tasks = await taskRepository.find({
      where: { instanceId: instance.id },
    });
    const openTasks = tasks.filter(
      (task) =>
        task.status === TaskStatusEnum.PENDING ||
        task.status === TaskStatusEnum.IN_PROGRESS,
    );

    if (openTokens.length > 0) {
      await tokenRepository.save(
        openTokens.map((token): WorkflowTokenEntity => ({
          ...token,
          consumedAt,
          status: WorkflowTokenStatusEnum.CONSUMED,
        })),
      );
    }

    if (openTasks.length > 0) {
      await taskRepository.save(
        openTasks.map((openTask): TaskEntity =>
          Object.assign(new TaskEntity(), openTask, {
            completedAt: consumedAt,
            status: taskStatus,
          }),
        ),
      );
      await this.closeTaskCandidates(
        manager,
        openTasks.map((task) => task.id),
        readCandidateStatusForClosedTask(taskStatus),
      );
    }
  }

  private async consumeJoinedTokens(
    manager: EntityManager,
    tokens: readonly WorkflowTokenEntity[],
  ): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    const consumedAt = new Date();

    await manager.getRepository(WorkflowTokenEntity).save(
      tokens.map((token): WorkflowTokenEntity => ({
        ...token,
        consumedAt,
        status: WorkflowTokenStatusEnum.CONSUMED,
      })),
    );
  }

  private async cancelAlternativeTokensForOrTrigger(
    manager: EntityManager,
    instance: ApprovalInstanceEntity,
    token: WorkflowTokenEntity,
    targetNodeId: string,
  ): Promise<void> {
    const tokenRepository = manager.getRepository(WorkflowTokenEntity);
    const taskRepository = manager.getRepository(TaskEntity);
    const consumedAt = new Date();
    const tokens = await tokenRepository.find({
      where: { instanceId: instance.id },
    });
    const alternativeTokens = tokens.filter(
      (candidate) =>
        candidate.id !== token.id &&
        (candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
          candidate.status === WorkflowTokenStatusEnum.WAITING) &&
        hasPathToNode(
          instance.workflowSnapshot,
          candidate.currentNodeId,
          targetNodeId,
        ),
    );

    if (alternativeTokens.length === 0) {
      return;
    }

    const alternativeTokenIds = alternativeTokens.map(
      (candidate) => candidate.id,
    );
    const cancellableTasks = (
      await taskRepository.find({
        where: { instanceId: instance.id },
      })
    ).filter(
      (task) =>
        alternativeTokenIds.includes(task.tokenId) &&
        (task.status === TaskStatusEnum.PENDING ||
          task.status === TaskStatusEnum.IN_PROGRESS),
    );

    await tokenRepository.save(
      alternativeTokens.map((candidate): WorkflowTokenEntity => ({
        ...candidate,
        consumedAt,
        status: WorkflowTokenStatusEnum.CONSUMED,
      })),
    );

    if (cancellableTasks.length) {
      await taskRepository.save(
        cancellableTasks.map((task): TaskEntity =>
          Object.assign(new TaskEntity(), task, {
            completedAt: consumedAt,
            status: TaskStatusEnum.CANCELLED,
          }),
        ),
      );
      await this.closeTaskCandidates(
        manager,
        cancellableTasks.map((task) => task.id),
        TaskCandidateStatusEnum.SUPERSEDED,
      );
    }
  }

  private async closeTaskCandidates(
    manager: EntityManager,
    taskIds: readonly string[],
    status: TaskCandidateStatusEnum,
  ): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    const candidateRepository = manager.getRepository(TaskCandidateEntity);
    const candidates = (
      await candidateRepository.find({ where: { taskId: In([...taskIds]) } })
    ).filter(
      (candidate) =>
        candidate.status === TaskCandidateStatusEnum.PENDING ||
        candidate.status === TaskCandidateStatusEnum.CLAIMED ||
        candidate.status === TaskCandidateStatusEnum.WAITING,
    );

    if (candidates.length === 0) {
      return;
    }

    await candidateRepository.save(
      candidates.map((candidate): TaskCandidateEntity =>
        Object.assign(new TaskCandidateEntity(), candidate, { status }),
      ),
    );
  }

  private async getTemplateOrThrow(
    templateId: string,
  ): Promise<ApprovalTemplateEntity> {
    const template = await this.approvalTemplateRepository.findOne({
      where: { deletedAt: IsNull(), id: templateId },
    });

    if (!template) {
      throw new NotFoundException(
        `Approval template ${templateId} was not found`,
      );
    }

    return template;
  }

  private async getPublishedTemplateVersionOrThrow(
    versionId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    const version = await this.approvalTemplateVersionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(
        `Approval template version ${versionId} was not found`,
      );
    }

    if (version.status !== ApprovalTemplateVersionStatusEnum.PUBLISHED) {
      throw new ConflictException(
        'Approval template current version must be published',
      );
    }

    return version;
  }

  private async getPublishedFormVersionOrThrow(
    versionId: string | null,
  ): Promise<FormDefinitionVersionEntity> {
    if (!versionId) {
      throw new ConflictException(
        'Approval template version does not bind a form version',
      );
    }

    const version = await this.formDefinitionVersionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(
        `Form definition version ${versionId} was not found`,
      );
    }

    if (version.status !== FormDefinitionVersionStatusEnum.PUBLISHED) {
      throw new ConflictException(
        'Approval template must bind a published form version',
      );
    }

    return version;
  }
}

function parseJsonObject(
  value: string,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (isRecord(parsedValue)) {
      return parsedValue;
    }

    throw new BadRequestException(`${label} must be a JSON object`);
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException(
      error instanceof Error ? error.message : `${label} is invalid JSON`,
    );
  }
}

function readDefaultInitiatorMetadataSnapshot(
  memberId: string,
): Readonly<Record<string, unknown>> {
  return {
    customFields: {},
    memberId,
  };
}

function cloneJsonObject(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Which caller is building an initiator snapshot, as the resolver is told. */
function readInitiatorCustomFieldsPurpose({
  formOptions,
  submission,
}: Readonly<{
  formOptions: object | null;
  submission: object | null;
}>): BPMInitiatorCustomFieldsPurpose {
  if (submission) {
    return 'SUBMISSION';
  }

  return formOptions ? 'FORM_OPTIONS' : 'LAUNCHABLE_TEMPLATES';
}

/**
 * What a host's initiator `customFields` resolver returned, as the object the
 * snapshot keeps: a plain object that survives JSON, which is also how it is
 * stored, so the policy evaluated at submit and the conditions evaluated later
 * read the same values. Anything else is a bug in the host's resolver; the
 * caller fails the submission with it rather than replacing it by `{}`, and
 * `problem` is for the log only.
 *
 * The check runs on the round-tripped value too, because an object's `toJSON`
 * can turn it into something that is not an object. A key whose value is
 * `undefined` does not survive the round trip either, so it is not in the
 * stored snapshot.
 */
function readResolvedInitiatorCustomFields(
  value: unknown,
):
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly problem: string } {
  if (!isPlainObjectValue(value)) {
    return { ok: false, problem: 'not a plain object' };
  }

  const roundTripped = ((): unknown => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return undefined;
    }
  })();

  if (roundTripped === undefined) {
    return { ok: false, problem: 'not JSON-serializable' };
  }

  if (!isPlainObjectValue(roundTripped)) {
    return { ok: false, problem: 'not a plain object once serialized' };
  }

  return { ok: true, value: roundTripped };
}

type SettledOutcome =
  | { readonly status: 'fulfilled'; readonly value: unknown }
  | { readonly status: 'rejected'; readonly reason: unknown };

/**
 * Waits for `promise` at most `timeoutMs`. The timer is cleared as soon as
 * either side wins. Once the time has run out, whatever `promise` settles with
 * later goes to `onLateSettle` and nowhere else, so a late rejection is
 * handled rather than left to surface as an unhandled rejection.
 */
function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
  onLateSettle: (outcome: SettledOutcome) => void,
): Promise<SettledOutcome | { readonly status: 'timeout' }> {
  return new Promise(
    (
      resolve: (
        outcome: SettledOutcome | { readonly status: 'timeout' },
      ) => void,
    ): void => {
      const state = { timedOut: false };
      const timer = setTimeout((): void => {
        state.timedOut = true;
        resolve({ status: 'timeout' });
      }, timeoutMs);
      const settle = (outcome: SettledOutcome): void => {
        if (state.timedOut) {
          onLateSettle(outcome);

          return;
        }

        clearTimeout(timer);
        resolve(outcome);
      };

      promise.then(
        (value: unknown): void => settle({ status: 'fulfilled', value }),
        (reason: unknown): void => settle({ status: 'rejected', reason }),
      );
    },
  );
}

function describeRejection(reason: unknown): string {
  return reason instanceof Error
    ? `${reason.name}: ${reason.message}`
    : String(reason);
}

function isPlainObjectValue(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function createWorkflowAuthContext(memberId: string): BPMAuthContext {
  return {
    memberId,
    metadata: {},
    permissions: [],
    roles: [],
  };
}

function isSameApprovalInstanceRevision(
  left: ApprovalInstanceEntity,
  right: ApprovalInstanceEntity,
): boolean {
  return (
    readApprovalInstanceRevision(left) ===
      readApprovalInstanceRevision(right) &&
    JSON.stringify(left.formData) === JSON.stringify(right.formData)
  );
}

/**
 * Returns the field key a service-task `fieldPath` writes into when that field
 * is DataSource-backed, else `null`. Only the first path segment can name a
 * form field; deeper segments address inside its value.
 */
/**
 * Reads defensively: a service task must keep running even when the instance
 * carries a snapshot this version cannot parse, so an unreadable schema simply
 * means "no snapshot to invalidate" rather than a failed workflow step.
 */
function readDataSourceFieldKeyAtPath(
  snapshot: Readonly<Record<string, unknown>>,
  fieldPath: string,
): string | null {
  const schema = snapshot?.schema;

  // Deliberately looser than `isFormDefinitionSchema`: one malformed sibling
  // entry must not stop a valid dynamic field from having its stale snapshot
  // pruned. Each entry is record-guarded below instead.
  if (!isRecord(schema) || !Array.isArray(schema.fields)) {
    return null;
  }

  // Reuse the writer's normalization so an optional `form.`/`formData.` prefix
  // resolves to the same field the value is written into.
  const [fieldKey] = normalizeFormFieldPath(fieldPath);

  if (!fieldKey) {
    return null;
  }

  // A corrupt snapshot can hold non-object entries: read them defensively
  // rather than letting a service task throw.
  const field = schema.fields.find(
    (candidate) => isRecord(candidate) && candidate.fieldKey === fieldKey,
  );

  return field && isFormDataSourceFieldDefinition(field)
    ? field.fieldKey
    : null;
}

/**
 * Refuses form data whose filterable fields hold a value of the wrong type
 * (ADR 25 §6). The list query reads these values with type guards, so a wrong
 * value would silently fall out of every filter; refusing the write is what
 * keeps filter results trustworthy.
 */
function assertFilterableFormDataValues(
  schema: FormDefinitionSchema | null,
  formData: Readonly<Record<string, unknown>>,
  serviceNodeLabel?: string,
): void {
  const problems = readFilterableValueProblems(
    readFilterableFieldPaths(schema),
    formData,
  );

  if (problems.length === 0) {
    return;
  }

  const issues = problems.map((problem) =>
    createFormDataIssue(
      readFilterableProblemLocation(schema, problem),
      'TYPE',
      `必須是${problem.expected}`,
    ),
  );
  const details = readFormDataIssueMessage(issues);

  throw createFormDataBadRequest(
    serviceNodeLabel
      ? `系統節點「${serviceNodeLabel}」要寫入的表單值不符合可篩選欄位的型別（${details}），這次操作沒有生效；請聯絡流程管理者修正此節點的寫入值`
      : `可篩選欄位的值型別不正確：${details}`,
    issues,
  );
}

/** Where a filterable problem sits: a field, a table row, or one cell of a row. */
function readFilterableProblemLocation(
  schema: FormDefinitionSchema | null,
  problem: FilterableValueProblem,
): FormDataIssueLocation {
  const [tableKey, columnKey] = problem.path.split('.');
  const table = schema?.fields.find(
    (field) => field.fieldKey === tableKey && isTableFieldDefinition(field),
  );
  const column =
    table && isTableFieldDefinition(table) && columnKey !== undefined
      ? table.columns.find((candidate) => candidate.fieldKey === columnKey)
      : undefined;

  if (table && isTableFieldDefinition(table)) {
    if (problem.rowIndex === null) {
      return readFieldIssueLocation(table);
    }

    const rowLocation = readRowIssueLocation(table, problem.rowIndex);

    return column ? readCellIssueLocation(rowLocation, column) : rowLocation;
  }

  const field = schema?.fields.find(
    (candidate) => candidate.fieldKey === problem.path,
  );

  if (field) {
    return readFieldIssueLocation(field);
  }

  // Not in the schema (the check and this lookup read the same schema, so
  // this is defensive): still address it the way FormDataIssue.path promises,
  // `table[i].col` for a row value rather than the dotted filter path.
  const row = `${tableKey}[${problem.rowIndex}]`;
  const path =
    problem.rowIndex === null
      ? problem.path
      : columnKey === undefined
        ? row
        : `${row}.${columnKey}`;

  return { path, ref: `欄位「${path}」` };
}

/**
 * Holds a `SET_FORM_FIELD` write to the rules the form applies to a filler —
 * text length and format, and the shape of a member or organization-unit value
 * — so a service task cannot store what the field would have refused. A member
 * value matters past the write: a `DYNAMIC_FORM` resolver or a manager chain
 * starting from the field reads it later, and an array on a single-member
 * field would make that node refuse inside a later decision, which then
 * cannot commit. Breaking them throws, which rolls back the submit or decision
 * that reached the node: the value is never half-written, and the node's value
 * has to be corrected. Only a top-level field can carry those rules — the
 * writer ignores an indexed path, and a nested record path names no field —
 * and an unreadable snapshot is left alone, as in
 * `readDataSourceFieldKeyAtPath`.
 */
function assertServiceTaskFieldValue(
  snapshot: Readonly<Record<string, unknown>>,
  fieldPath: string,
  value: unknown,
  nodeLabel: string,
): void {
  const schema = snapshot?.schema;
  const segments = normalizeFormFieldPath(fieldPath);

  if (!isFormDefinitionSchema(schema) || segments.length !== 1) {
    return;
  }

  const field = schema.fields.find(
    (candidate) => candidate.fieldKey === segments[0],
  );
  const written = { [segments[0]]: value };
  const errors = field
    ? [
        ...readSubmittedTextValueErrors(field, value, {
          testPattern: createTimedTextFieldPatternTest(),
        }),
        ...readSubmittedMemberValueErrors([field], written),
        ...readSubmittedOrgUnitValueErrors([field], written),
      ]
    : [];

  if (!field || errors.length === 0) {
    return;
  }

  throw createFormDataBadRequest(
    `系統節點「${nodeLabel}」要寫入的值不符合欄位規則（${readFormDataIssueMessage(errors)}），` +
      `這次操作沒有生效；請聯絡流程管理者修正此節點的寫入值`,
    errors,
  );
}

function readSnapshotWithoutField(
  snapshots: FormDataSourceValueSnapshots | null | undefined,
  fieldKey: string,
): FormDataSourceValueSnapshots {
  return Object.fromEntries(
    Object.entries(snapshots ?? {}).filter(([key]) => key !== fieldKey),
  );
}

/**
 * Keeps only the snapshots whose field still carries a value, so clearing a
 * dynamic option also removes the label recorded for it.
 */
function readSnapshotForPresentValues(
  schema: FormDefinitionSchema,
  formData: Readonly<Record<string, unknown>>,
  snapshots: FormDataSourceValueSnapshots | null | undefined,
): FormDataSourceValueSnapshots {
  return Object.fromEntries(
    Object.entries(snapshots ?? {}).filter(([fieldKey]) =>
      schema.fields.some(
        (field) =>
          isRecord(field) &&
          field.fieldKey === fieldKey &&
          isFormDataSourceFieldDefinition(field) &&
          hasPresentDynamicValue(field, formData[fieldKey]),
      ),
    ),
  );
}

/**
 * Only a value the field's own selection mode can represent counts as cleared:
 * an empty array clears a `multiple` field, but on a `single` field it is an
 * illegal value that must still reach validation rather than silently drop the
 * option snapshot.
 */
function hasPresentDynamicValue(
  field: FormDataSourceOptionFieldDefinition,
  value: unknown,
): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  // Only a shape the field's mode can actually hold counts as cleared: `''`
  // clears a single field, `[]` clears a multiple one. The other combinations
  // are illegal values that must still reach validation instead of silently
  // dropping the option snapshot.
  return readFormFieldSelectionMode(field) === 'multiple'
    ? !Array.isArray(value) || value.length > 0
    : value !== '';
}

/**
 * Hosts without a DataSource registry keep working for static forms, but a
 * dynamic value they cannot re-resolve must never reach the database: nothing
 * downstream could tell whether the browser made the value up.
 */
function assertNoUnresolvableDynamicValues(
  schema: FormDefinitionSchema,
  formData: Readonly<Record<string, unknown>>,
): void {
  // A malformed snapshot can hold non-object entries; skip them rather than
  // throwing a TypeError out of a submit or resubmit.
  const hasDynamicValue = schema.fields.some(
    (field) =>
      isRecord(field) &&
      isFormDataSourceFieldDefinition(field) &&
      hasPresentDynamicValue(field, formData[field.fieldKey]),
  );

  if (hasDynamicValue) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING,
    );
  }
}

function readApprovalInstanceRevision(
  instance: ApprovalInstanceEntity,
): string {
  return instance.updatedAt instanceof Date
    ? instance.updatedAt.toISOString()
    : String(instance.updatedAt ?? '');
}

function parseWorkflowDefinition(value: string): WorkflowDefinition {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (
      isRecord(parsedValue) &&
      Array.isArray(parsedValue.nodes) &&
      Array.isArray(parsedValue.edges) &&
      isRecord(parsedValue.meta)
    ) {
      return parsedValue as unknown as WorkflowDefinition;
    }

    throw new BadRequestException(
      'workflowDefinitionJson must be a workflow definition object',
    );
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException(
      error instanceof Error
        ? error.message
        : 'workflowDefinitionJson is invalid JSON',
    );
  }
}

function buildInitiatorPolicyContext(
  initiatorMetadataSnapshot: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    initiator: initiatorMetadataSnapshot,
    subject: initiatorMetadataSnapshot,
  };
}

function buildWorkflowExpressionContext(
  instance: ApprovalInstanceEntity,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    form: instance.formData,
    formData: instance.formData,
    initiator: {
      ...instance.initiatorMetadataSnapshot,
      memberId: instance.initiatorMemberId,
    },
    instance: {
      id: instance.id,
      state: instance.state,
      templateId: instance.templateId,
      templateVersionId: instance.templateVersionId,
      title: instance.title,
    },
  };
}

function readDelegationSteps(
  value: readonly Readonly<Record<string, unknown>>[],
): readonly DelegationStep[] {
  return value
    .map((step): DelegationStep | null => {
      const from = readStringValue(step.from);
      const to = readStringValue(step.to);
      const reason = readStringValue(step.reason);

      if (!from || !to || !reason) {
        return null;
      }

      const actorMemberId = readStringValue(step.actorMemberId);
      const comment = readStringValue(step.comment);

      return {
        from,
        ...(actorMemberId ? { actorMemberId } : {}),
        ...(comment ? { comment } : {}),
        reason,
        ruleId: readStringValue(step.ruleId),
        to,
      };
    })
    .filter((step): step is DelegationStep => step !== null);
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function buildDryRunExpressionContext(
  input: DryRunSimulationInput,
  lastDecision: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    form: input.formData,
    formData: input.formData,
    initiator: {
      ...input.initiatorMetadataSnapshot,
      memberId: input.initiatorMemberId,
    },
    instance: {
      id: SYSTEM_DRY_RUN_INSTANCE_ID,
      state: ApprovalInstanceStateEnum.RUNNING,
      title: 'Dry Run',
    },
    lastDecision,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The members whose grades decide a grade-gated delegation: none when the
// delegation leaves the seat with its principal.
function readGradeGateMemberIds(
  principalMemberId: string,
  resolution: DelegationResolution,
): readonly string[] {
  return resolution.finalAssigneeMemberId === principalMemberId
    ? []
    : [principalMemberId, resolution.finalAssigneeMemberId];
}

/**
 * On a manager-chain node the delegate must hold at least the grade of the
 * member they replace: anything lower is not applied, the member stays and
 * the refused delegation is returned so it can be recorded. Resolution does
 * not walk further down the delegation chain once it has been refused. A
 * member without a grade (or a delegate that stays the member) is never
 * constrained. `levels` holds the grades of `readGradeGateMemberIds`.
 */
function applyGradeGate(
  principalMemberId: string,
  resolution: DelegationResolution,
  gradeGated: boolean,
  levels: ReadonlyMap<string, number | null>,
): GradeGatedDelegation {
  if (!gradeGated || resolution.finalAssigneeMemberId === principalMemberId) {
    return resolution;
  }

  const principalLevel = levels.get(principalMemberId) ?? null;

  if (principalLevel === null) {
    return resolution;
  }

  const agentLevel = levels.get(resolution.finalAssigneeMemberId) ?? null;

  if (agentLevel !== null && agentLevel >= principalLevel) {
    return resolution;
  }

  return {
    delegationChain: [],
    finalAssigneeMemberId: principalMemberId,
    skippedDelegation: {
      agentLevel,
      agentMemberId: resolution.finalAssigneeMemberId,
      principalLevel,
      principalMemberId,
      reason: 'AGENT_POSITION_LEVEL_TOO_LOW',
    },
  };
}

function readNodeLabelKey(instanceId: string, nodeId: string): string {
  return `${instanceId}\u0000${nodeId}`;
}

/**
 * The node's display name from an instance's workflow snapshot, or `null`
 * when the instance or node is missing, or the node carries no usable label
 * (older snapshots).
 */
function readWorkflowNodeLabel(
  workflow: WorkflowDefinition | undefined,
  nodeId: string,
): string | null {
  const label = workflow?.nodes.find((candidate) => candidate.id === nodeId)
    ?.data.label;

  return typeof label === 'string' && label.trim() ? label : null;
}

/** A stored `levelsUp` as a whole number of tiers, at least one. */
function readManagerLevelsUp(levelsUp: number): number {
  return Number.isFinite(levelsUp) ? Math.max(Math.trunc(levelsUp), 1) : 1;
}

const SLA_AUTO_APPROVE_MARK: NonNullable<DecideTaskOptions['automatic']> =
  'SLA_AUTO_APPROVE';

/** 關卡「名稱」(、關卡「名稱」…) for an error line; a missing node shows its id. */
function readNodeActorNodeNames(
  instance: ApprovalInstanceEntity,
  nodeIds: readonly string[],
): string {
  return nodeIds
    .map(
      (nodeId) =>
        `關卡「${readWorkflowNodeLabel(instance.workflowSnapshot, nodeId) ?? nodeId}」`,
    )
    .join('、');
}

function readWorkflowNodeOrThrow(
  workflow: WorkflowDefinition,
  nodeId: string,
): WorkflowNode {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new ConflictException(`Workflow node ${nodeId} was not found`);
  }

  return node;
}

function readOutgoingEdgesOrThrow(
  workflow: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdge[] {
  const edges = workflow.edges.filter((edge) => edge.source === nodeId);

  if (edges.length === 0) {
    throw new ConflictException(`Workflow node ${nodeId} has no outgoing edge`);
  }

  return edges;
}

function readIncomingEdges(
  workflow: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdge[] {
  return workflow.edges.filter((edge) => edge.target === nodeId);
}

function hasPathToNode(
  workflow: WorkflowDefinition,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  return visitPathToNode(workflow, sourceNodeId, targetNodeId, new Set());
}

function visitPathToNode(
  workflow: WorkflowDefinition,
  sourceNodeId: string,
  targetNodeId: string,
  visitedNodeIds: ReadonlySet<string>,
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }

  if (visitedNodeIds.has(sourceNodeId)) {
    return false;
  }

  const nextVisitedNodeIds = new Set([...visitedNodeIds, sourceNodeId]);

  return workflow.edges
    .filter((edge) => edge.source === sourceNodeId)
    .some((edge) =>
      visitPathToNode(workflow, edge.target, targetNodeId, nextVisitedNodeIds),
    );
}

function readReturnTargetNodeId(
  workflow: WorkflowDefinition,
  currentNodeId: string,
  requestedNodeId?: string | null,
): string {
  const currentNode = readWorkflowNodeOrThrow(workflow, currentNodeId);

  if (currentNode.type !== 'userTask') {
    throw new ConflictException(
      `Workflow node ${currentNodeId} does not support return decisions`,
    );
  }

  if (!currentNode.data.returnBehavior.allowReturn) {
    throw new ConflictException(
      `User task ${currentNodeId} does not allow return decisions`,
    );
  }

  const trimmedRequestedNodeId = requestedNodeId?.trim() || null;
  const defaultTargetNodeId = readDefaultReturnTargetNodeId(
    workflow,
    currentNode,
  );

  if (currentNode.data.returnBehavior.allowedTargets === 'ANY') {
    if (!trimmedRequestedNodeId) {
      throw new BadRequestException('returnToNodeId is required');
    }

    readWorkflowNodeOrThrow(workflow, trimmedRequestedNodeId);

    // Only the applicant or a stage the case can already have passed: every
    // other node would skip ahead, re-run a gateway, or — the end event —
    // approve the case outright.
    if (
      !readSelectableReturnTargetNodeIds(workflow, currentNodeId).includes(
        trimmedRequestedNodeId,
      )
    ) {
      throw new ConflictException(
        `User task ${currentNodeId} can only return to the applicant or an earlier user task, not ${trimmedRequestedNodeId}`,
      );
    }

    return trimmedRequestedNodeId;
  }

  if (
    trimmedRequestedNodeId &&
    trimmedRequestedNodeId !== defaultTargetNodeId
  ) {
    throw new ConflictException(
      `User task ${currentNodeId} can only return to ${defaultTargetNodeId}`,
    );
  }

  return defaultTargetNodeId;
}

function readDefaultReturnTargetNodeId(
  workflow: WorkflowDefinition,
  currentNode: UserTaskNode,
): string {
  if (currentNode.data.returnBehavior.allowedTargets === 'INITIATOR') {
    const startNode = workflow.nodes.find((node) => node.type === 'startEvent');

    if (!startNode) {
      throw new ConflictException('Workflow does not include a startEvent');
    }

    return startNode.id;
  }

  const previousNodeId = readIncomingEdges(workflow, currentNode.id)[0]?.source;

  if (!previousNodeId) {
    throw new ConflictException(
      `User task ${currentNode.id} does not have a previous node to return to`,
    );
  }

  return previousNodeId;
}

function isReturnCommentRequired(
  workflow: WorkflowDefinition,
  nodeId: string,
): boolean {
  const node = readWorkflowNodeOrThrow(workflow, nodeId);

  return (
    node.type === 'userTask' && node.data.returnBehavior.requireComment === true
  );
}

function readReturnResubmitStrategy(
  task: TaskEntity,
  instance: ApprovalInstanceEntity,
): ReturnResubmitStrategy {
  const node = readWorkflowNodeOrThrow(instance.workflowSnapshot, task.nodeId);

  if (node.type !== 'userTask') {
    return 'RESTART';
  }

  return node.data.returnBehavior.resubmitStrategy ?? 'RESTART';
}

function readReturnResubmitStrategyFromPayload(
  payload: Readonly<Record<string, unknown>>,
): ReturnResubmitStrategy {
  return payload.resubmitStrategy === 'FROM_RETURN_POINT'
    ? 'FROM_RETURN_POINT'
    : 'RESTART';
}

function readStringPayloadValue(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = payload[key];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNodeEntryCondition(node: WorkflowNode): string | null {
  if (node.type === 'userTask' || node.type === 'serviceTask') {
    return node.data.entryCondition?.trim() || null;
  }

  return null;
}

/**
 * The stored CEL an edge is evaluated by, or `null` when its structured fields
 * answer directly: no CEL, or a designer-built edge whose value is a list
 * (`evaluateWorkflowEdgeCondition` reads a list as contains / does not contain
 * and an empty list as empty, which the stored CEL of older definitions did
 * not).
 */
function readEvaluableEdgeExpression(
  edge: WorkflowEdge,
  formData: Readonly<Record<string, unknown>>,
): string | null {
  const expression = edge.data.condition?.trim();
  const fieldKey = edge.data.conditionFieldKey;
  const listValued = Boolean(
    fieldKey &&
    edge.data.conditionOperator &&
    Array.isArray(readOwnFormValue(formData, fieldKey)),
  );

  return expression && !listValued ? expression : null;
}

/**
 * Evaluates an edge's stored CEL and, only when it fails because the edge's
 * own field is unfilled, answers from the structured fields instead. The one
 * place both the actual run and the designer dry run decide that, so the two
 * cannot drift apart.
 *
 * Published definitions and in-flight instances keep the CEL they were
 * stored with, and that CEL throws for an optional field left untouched: the
 * key is absent (`Identifier "agent" not found`), or an ordered comparison
 * meets `null` or `""` (`null > 5`, `"" > 5`). Only then does the structured
 * evaluator answer, reading the value as unfilled (`EQUALS` and the ordered
 * comparisons false, `NOT_EQUALS` and `IS_EMPTY` true, `IS_FILLED` false).
 *
 * - `EXPRESSION_MISSING_KEY` falls back only when the missing key *is* the
 *   edge's field. A CEL edited by hand to also read another key
 *   (`form.agent != null && initiator.department == "X"`) fails as written
 *   when that other key is missing, even if the edge's field is unfilled.
 * - `EXPRESSION_TYPE_ERROR` carries no key, so it falls back whenever the
 *   edge's field is unfilled, and each such fallback is logged (`warn`, no
 *   values) so an unrelated type error answered this way stays traceable.
 * - Everything else is rethrown: a stored CEL that evaluates keeps its
 *   result, so no route that worked before changes; an error while the
 *   edge's field is filled points at the CEL itself; a hand-written CEL has
 *   no structured fields; a budget overrun or a function failure is never
 *   absorbed.
 */
function evaluateWithStructuredFallback(
  edge: WorkflowEdge,
  formData: Readonly<Record<string, unknown>>,
  warn: (message: string) => void,
  evaluate: () => boolean,
): boolean {
  try {
    return evaluate();
  } catch (error: unknown) {
    const fieldKey = edge.data.conditionFieldKey;

    if (
      !fieldKey ||
      !edge.data.conditionOperator ||
      !(error instanceof ExpressionRuntimeError) ||
      !isEmptyWorkflowValue(readOwnFormValue(formData, fieldKey))
    ) {
      throw error;
    }

    if (error.code === 'EXPRESSION_MISSING_KEY' && error.keyName === fieldKey) {
      return evaluateWorkflowEdgeCondition(edge, { formData });
    }

    if (error.code === 'EXPRESSION_TYPE_ERROR') {
      warn(
        `code=EDGE_STRUCTURED_FALLBACK edge=${edge.id} field=${fieldKey} reason=EXPRESSION_TYPE_ERROR`,
      );

      return evaluateWorkflowEdgeCondition(edge, { formData });
    }

    throw error;
  }
}

function edgeHasCondition(edge: WorkflowEdge): boolean {
  return Boolean(
    edge.data.condition?.trim() ||
    (edge.data.conditionFieldKey && edge.data.conditionOperator),
  );
}

function readMissingOrgUnitMessage(
  label: string,
  subject: ResolvedSubject,
  orgUnitId: string,
): string {
  return `${label} 找不到${subject}：組織（${orgUnitId}）已不存在，請在流程設計器重新選擇組織`;
}

function findMemberIdsInValue(value: unknown): readonly string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    return uniqueTexts(
      value
        .filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' && Boolean(candidate.trim()),
        )
        .map((candidate) => candidate.trim()),
    );
  }

  return [];
}

function readMemberIdsFromValue(
  value: unknown,
  label: string,
  subject: ResolvedSubject = '簽核人',
  source = '',
): readonly string[] {
  const memberIds = findMemberIdsInValue(value);

  if (memberIds.length === 0) {
    throw new ConflictException(`${label} ${source}找不到${subject}`);
  }

  return memberIds;
}

function uniqueTexts(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function uniqueRuntimeCandidates(
  candidates: readonly RuntimeTaskCandidate[],
): readonly RuntimeTaskCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.memberId)) {
      return false;
    }

    seen.add(candidate.memberId);

    return true;
  });
}

// A task signs in order only when its snapshot says so and its candidates carry
// a sequence; a SEQUENTIAL task from before ordering existed behaves as before.
function isOrderedSequentialTask(
  task: TaskEntity,
  candidates: readonly TaskCandidateEntity[],
): boolean {
  return (
    readDecisionPolicySnapshot(task).type === 'SEQUENTIAL' &&
    candidates.some((candidate) => candidate.sequence !== null)
  );
}

// Every read of the setting goes through here so an explicit `null` behaves
// exactly like an absent setting.
function isInitiatorExcluded(node: UserTaskNode): boolean {
  return Boolean(node.data.excludeInitiator);
}

// Same rule for the earlier-stage exclusion: an explicit `null` is absent.
function isNodeActorsExcluded(node: UserTaskNode): boolean {
  return Boolean(node.data.excludeNodeActors);
}

// Whether the node keeps anyone out of its approvers at all.
function hasSeatExclusion(node: UserTaskNode): boolean {
  return isInitiatorExcluded(node) || isNodeActorsExcluded(node);
}

function readExcludedNodeActorNodeIds(node: UserTaskNode): readonly string[] {
  return node.data.excludeNodeActors?.nodeIds ?? [];
}

// With both rules set the initiator rule runs first, so the earlier-stage rule
// is the one that emptied the list only when the initiator rule alone left
// somebody. Without `excludeInitiator` the earlier-stage rule is always it.
function isEmptiedByInitiatorRule(
  node: UserTaskNode,
  delegatedCandidates: readonly RuntimeTaskCandidate[],
  exclusions: NodeExclusions,
): boolean {
  return (
    isInitiatorExcluded(node) &&
    selectNodeCandidates(
      delegatedCandidates,
      true,
      exclusions.initiatorMemberIds,
    ).length === 0
  );
}

// Everyone a node that excludes the initiator keeps out of its approvers: the
// applicant and, when someone filed the document for them, that person too
// (authority rule: the creator must not approve what they created).
function readInitiatorAndSubmitter(
  instance: Pick<
    ApprovalInstanceEntity,
    'initiatorMemberId' | 'submittedByMemberId'
  >,
): readonly string[] {
  const submitterMemberId = readDistinctSubmitterMemberId(instance);

  return submitterMemberId === null
    ? [instance.initiatorMemberId]
    : [instance.initiatorMemberId, submitterMemberId];
}

function isOrgManagerChainNode(node: UserTaskNode): boolean {
  return node.data.approverResolver.type === 'ORG_MANAGER_CHAIN';
}

// Candidates of a manager-chain node that came from the chain (or replaced the
// excluded initiator's seat); ad-hoc approvers are chosen by a person instead.
function isGradeGatedCandidate(
  node: UserTaskNode,
  sourceType: string | null | undefined,
): boolean {
  return (
    isOrgManagerChainNode(node) &&
    (sourceType === 'ORG_MANAGER_CHAIN' ||
      sourceType === 'EXCLUDE_INITIATOR_MANAGER')
  );
}

// Source of the additive `skippedDelegations` payload field (absent when
// nothing was refused, so existing payloads stay byte-identical). One record
// per principal and delegate pair.
function collectSkippedDelegations(
  delegatedCandidates: readonly RuntimeTaskCandidate[],
  excludeInitiator: boolean,
  excludedMemberIds: readonly string[],
): readonly SkippedDelegation[] {
  const seen = new Set<string>();

  return delegatedCandidates.flatMap((candidate) => {
    const skipped = candidate.skippedDelegation;

    // A seat the initiator filter removes is not on the task, so a refusal on
    // it has nothing to report. Rows only the dedupe drops are still on it.
    if (
      !skipped ||
      (excludeInitiator &&
        isExcludedMemberOnCandidatePath(candidate, excludedMemberIds))
    ) {
      return [];
    }

    const key = `${skipped.principalMemberId}\u0000${skipped.agentMemberId}`;

    if (seen.has(key)) {
      return [];
    }

    seen.add(key);

    return [skipped];
  });
}

// The members a rule delegation stands for on a candidate row a person
// approved: the delegators of the trailing run of rule steps (`ruleId` set).
// A transfer step carries no rule and is not a delegation, so when one sits on
// the chain the original assignee is not a delegator and is left out. A chain
// of rule steps only also names the original assignee.
function readRuleDelegatorMemberIds(
  candidate: Pick<TaskCandidateEntity, 'delegationChain' | 'originalMemberId'>,
): readonly string[] {
  const steps = readDelegationSteps(candidate.delegationChain);
  const trailingRuleCount = [...steps]
    .reverse()
    .findIndex((step) => step.ruleId === null);
  const ruleSteps =
    trailingRuleCount === -1
      ? steps
      : steps.slice(steps.length - trailingRuleCount);

  if (ruleSteps.length === 0) {
    return [];
  }

  return [
    ...(trailingRuleCount === -1 ? [candidate.originalMemberId] : []),
    ...ruleSteps.map((step) => step.from),
  ];
}

// A delegate acting for the initiator is still the initiator approving their
// own document, so the initiator anywhere on the delegation path (the
// pre-delegation member, any hop, or the final assignee) drops the candidate.
// The submitter is held to exactly the same rule.
function isExcludedMemberOnCandidatePath(
  candidate: Pick<
    RuntimeTaskCandidate,
    'delegationChain' | 'memberId' | 'originalMemberId'
  >,
  excludedMemberIds: readonly string[],
): boolean {
  return excludedMemberIds.some(
    (excludedMemberId) =>
      candidate.memberId === excludedMemberId ||
      candidate.originalMemberId === excludedMemberId ||
      candidate.delegationChain.some(
        (step) =>
          step.from === excludedMemberId || step.to === excludedMemberId,
      ),
  );
}

// The initiator filter runs on the delegated list before the dedupe, so a
// legitimate approver is never shadowed by an excluded entry for the same
// final assignee. Without the exclusion this is the plain dedupe.
function selectNodeCandidates(
  delegatedCandidates: readonly RuntimeTaskCandidate[],
  excludeInitiator: boolean,
  excludedMemberIds: readonly string[],
): readonly RuntimeTaskCandidate[] {
  return uniqueRuntimeCandidates(
    excludeInitiator
      ? delegatedCandidates.filter(
          (candidate) =>
            !isExcludedMemberOnCandidatePath(candidate, excludedMemberIds),
        )
      : delegatedCandidates,
  );
}

// A COUNT threshold above the people left would never be reached once the
// initiator is gone, so it is capped at who remains ("everyone else").
// PERCENTAGE is computed from the actual candidate count and needs nothing.
function capDecisionPolicyToCandidateCount(
  policy: DecisionPolicy | undefined,
  candidateCount: number,
): DecisionPolicy | undefined {
  return policy?.type === 'QUORUM' &&
    policy.thresholdType === 'COUNT' &&
    policy.threshold > candidateCount
    ? { ...policy, threshold: Math.max(candidateCount, 1) }
    : policy;
}

/** Splits `items` into consecutive runs of at most `size`. */
function chunkArray<T>(
  items: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  return Array.from(
    { length: Math.ceil(items.length / size) },
    (_, index): readonly T[] => items.slice(index * size, (index + 1) * size),
  );
}

function uniqueTasksById(tasks: readonly TaskEntity[]): readonly TaskEntity[] {
  const seen = new Set<string>();

  return tasks.filter((task) => {
    if (seen.has(task.id)) {
      return false;
    }

    seen.add(task.id);

    return true;
  });
}

function normalizeText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPageOffset(
  page: number | null | undefined,
  pageSize: number | null | undefined,
): number {
  const normalizedPageSize = normalizePageSize(pageSize);

  return (normalizePage(page) - 1) * normalizedPageSize;
}

function isTaskListPaged(options: TaskListPageOptions): boolean {
  return options.page !== undefined || options.pageSize !== undefined;
}

function shouldPaginateList(options: ListApprovalInstancesOptions): boolean {
  return (
    typeof options.page !== 'undefined' ||
    typeof options.pageSize !== 'undefined'
  );
}

function normalizePage(value: number | null | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function normalizePageSize(value: number | null | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return 20;
  }

  return Math.min(Number(value), 100);
}

function applyApprovalInstanceSearchFilter(
  queryBuilder: SelectQueryBuilder<ApprovalInstanceEntity>,
  searchTextValue: string | null | undefined,
): void {
  const searchText = normalizeText(searchTextValue)?.toLocaleLowerCase();

  if (!searchText) {
    return;
  }

  queryBuilder.andWhere(
    [
      '(',
      'LOWER("approvalInstance"."title") LIKE :approvalInstanceSearchText',
      'OR LOWER("approvalInstance"."initiator_member_id") LIKE :approvalInstanceSearchText',
      'OR LOWER(CAST("approvalInstance"."id" AS text)) LIKE :approvalInstanceSearchText',
      ')',
    ].join(' '),
    {
      approvalInstanceSearchText: `%${escapeLikePattern(searchText)}%`,
    },
  );
}

function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/%/gu, '\\%')
    .replace(/_/gu, '\\_');
}

function isInstanceWithinRange(
  instance: ApprovalInstanceEntity,
  options: WorkflowDashboardSummaryOptions,
): boolean {
  const fromTime = options.from?.getTime() ?? null;
  const toTime = options.to?.getTime() ?? null;
  const candidateTime = (
    instance.completedAt ??
    instance.startedAt ??
    instance.createdAt
  ).getTime();

  return (
    (fromTime === null || candidateTime >= fromTime) &&
    (toTime === null || candidateTime <= toTime)
  );
}

function readDecisionPolicySnapshot(task: TaskEntity): DecisionPolicy {
  const value = task.decisionPolicySnapshot;

  if (
    isRecord(value) &&
    typeof value.type === 'string' &&
    (value.type === 'SINGLE' ||
      value.type === 'SEQUENTIAL' ||
      value.type === 'PARALLEL_ALL' ||
      value.type === 'PARALLEL_ANY')
  ) {
    return { type: value.type };
  }

  if (
    isRecord(value) &&
    value.type === 'QUORUM' &&
    typeof value.threshold === 'number' &&
    (value.thresholdType === 'COUNT' || value.thresholdType === 'PERCENTAGE')
  ) {
    return {
      threshold: value.threshold,
      thresholdType: value.thresholdType,
      type: 'QUORUM',
    };
  }

  return { type: 'SINGLE' };
}

/**
 * Stages where several seats decide together. A holder's transfer on one of
 * them moves that seat in place; SINGLE and SEQUENTIAL keep the replacement
 * task path.
 */
function isGroupDecisionPolicy(policy: DecisionPolicy): boolean {
  return (
    policy.type === 'PARALLEL_ALL' ||
    policy.type === 'PARALLEL_ANY' ||
    policy.type === 'QUORUM'
  );
}

/** Candidate states in which the seat is no longer part of the task. */
const SEAT_LEFT_STATUSES: readonly TaskCandidateStatusEnum[] = [
  TaskCandidateStatusEnum.CANCELLED,
  TaskCandidateStatusEnum.SUPERSEDED,
  TaskCandidateStatusEnum.TRANSFERRED,
];

function shouldCompleteTaskAfterDecision({
  action,
  candidates,
  decisionPolicy,
}: {
  readonly action: TaskDecisionActionEnum;
  readonly candidates: readonly TaskCandidateEntity[];
  readonly decisionPolicy: DecisionPolicy;
}): boolean {
  if (action !== TaskDecisionActionEnum.APPROVED) {
    return true;
  }

  if (
    decisionPolicy.type === 'SINGLE' ||
    decisionPolicy.type === 'PARALLEL_ANY'
  ) {
    return true;
  }

  const completedCount = candidates.filter(
    (candidate) => candidate.status === TaskCandidateStatusEnum.COMPLETED,
  ).length;
  // A seat that has left the task (transferred away, cancelled, superseded)
  // no longer belongs to the stage. Counting it kept a PARALLEL_ALL or
  // SEQUENTIAL stage from ever reaching "every seat decided" once a seat had
  // been reassigned.
  const totalCount = Math.max(
    candidates.filter(
      (candidate) => !SEAT_LEFT_STATUSES.includes(candidate.status),
    ).length,
    1,
  );

  if (
    decisionPolicy.type === 'PARALLEL_ALL' ||
    decisionPolicy.type === 'SEQUENTIAL'
  ) {
    return completedCount >= totalCount;
  }

  const threshold =
    decisionPolicy.thresholdType === 'PERCENTAGE'
      ? Math.ceil((totalCount * decisionPolicy.threshold) / 100)
      : decisionPolicy.threshold;

  return completedCount >= Math.max(threshold, 1);
}

function readValueAtPath(
  value: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  return path
    .split('.')
    .filter((segment) => segment.trim())
    .reduce<unknown>((currentValue, segment) => {
      if (!isRecord(currentValue)) {
        return undefined;
      }

      return currentValue[segment];
    }, value);
}

function writeValueAtPath(
  value: Readonly<Record<string, unknown>>,
  path: string,
  nextValue: unknown,
): Readonly<Record<string, unknown>> {
  const segments = normalizeFormFieldPath(path);

  if (segments.length === 0) {
    return value;
  }

  // An index step is not understood by this writer — `items[0].qty` splits into
  // the literal segment `items[0]`, which would be created as a brand new
  // top-level key rather than reaching the row. That is not the no-op ADR 16
  // §3.8 asks for: it pollutes `formData` (and therefore the CEL context) with
  // a key no schema declares, and makes `readValueAtPath` start answering for
  // a path it should never resolve.
  if (segments.some((segment) => /[[\]]/u.test(segment))) {
    return value;
  }

  return writeNestedValue(value, segments, nextValue);
}

function writeNestedValue(
  value: Readonly<Record<string, unknown>>,
  segments: readonly string[],
  nextValue: unknown,
): Readonly<Record<string, unknown>> {
  const [currentSegment, ...remainingSegments] = segments;

  if (!currentSegment) {
    return value;
  }

  if (remainingSegments.length === 0) {
    return { ...value, [currentSegment]: nextValue };
  }

  const currentValue = value[currentSegment];

  // Descending through something that already holds a non-record value must be
  // a no-op, not an overwrite. `items.qty` against a table would otherwise
  // replace the whole row array with `{ qty: ... }`; the same guard protects a
  // scalar from being swallowed by a nested write (ADR 16 §3.8).
  if (
    typeof currentValue !== 'undefined' &&
    currentValue !== null &&
    !isRecord(currentValue)
  ) {
    return value;
  }

  const nestedValue = isRecord(currentValue) ? currentValue : {};

  return {
    ...value,
    [currentSegment]: writeNestedValue(
      nestedValue,
      remainingSegments,
      nextValue,
    ),
  };
}

function normalizeFormFieldPath(path: string): readonly string[] {
  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments[0] === 'form' || segments[0] === 'formData') {
    return segments.slice(1);
  }

  return segments;
}

/**
 * The message a failed dry run shows its caller. Only the fixed budget text, an
 * HTTP exception's own message, or an expression error's label and code reach
 * this point. Any other error is replaced with a generic message, since its text
 * may carry engine or context details.
 */
function readDryRunFailureMessage(error: unknown): string {
  if (error instanceof TimeBudgetExceededError) {
    return DRY_RUN_TOO_COMPLEX_MESSAGE;
  }

  if (error instanceof ExpressionRuntimeError) {
    return error.keyName
      ? `${error.message}（找不到「${error.keyName}」）`
      : error.message;
  }

  if (error instanceof HttpException) {
    return error.message;
  }

  return 'Dry run failed';
}

function createFailedDryRunResult(message: string): WorkflowDryRunResultObject {
  return Object.assign(new WorkflowDryRunResultObject(), {
    errors: [message],
    steps: [],
    valid: false,
  });
}

async function executeWebhookServiceAction(
  serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher,
  action: Extract<
    ServiceTaskNode['data']['action'],
    { readonly type: 'WEBHOOK' }
  >,
  payload: unknown,
): Promise<BPMWorkflowWebhookDispatchResult> {
  try {
    return await serviceTaskDispatcher.dispatchWebhook({
      headers: action.headers,
      payload,
      url: action.url,
    });
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : 'Unknown webhook error',
      ok: false,
      status: null,
    };
  }
}

async function executeAdhocWebhookDispatch(
  serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher,
  target: AdhocTargetValue,
  payload: unknown,
): Promise<BPMWorkflowWebhookDispatchResult> {
  if (!target.webhookUrl) {
    return { error: 'Webhook URL is missing', ok: false, status: null };
  }

  try {
    return await serviceTaskDispatcher.dispatchWebhook({
      headers: target.webhookHeaders,
      payload,
      url: target.webhookUrl,
    });
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : 'Unknown webhook error',
      ok: false,
      status: null,
    };
  }
}

function buildAdhocTargetValue(input: AdhocTargetInput): AdhocTargetValue {
  if (input.kind === AdhocTargetKindEnum.MEMBER) {
    const memberIds = uniqueTexts([...(input.memberIds ?? [])]);

    if (memberIds.length === 0) {
      throw new BadRequestException(
        'memberIds is required for a MEMBER ad-hoc target',
      );
    }

    return { kind: input.kind, memberIds };
  }

  if (input.kind === AdhocTargetKindEnum.POSITION) {
    const positionId = input.positionId?.trim();

    if (!positionId) {
      throw new BadRequestException(
        'positionId is required for a POSITION ad-hoc target',
      );
    }

    return { kind: input.kind, positionId };
  }

  if (input.kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    const orgUnitId = input.orgUnitId?.trim();

    if (!orgUnitId) {
      throw new BadRequestException(
        'orgUnitId is required for an ORG_UNIT_MEMBER ad-hoc target',
      );
    }

    return {
      includeDescendants: Boolean(input.includeDescendants),
      kind: input.kind,
      orgUnitId,
    };
  }

  const webhookUrl = input.webhookUrl?.trim();

  if (!webhookUrl) {
    throw new BadRequestException(
      'webhookUrl is required for a WEBHOOK ad-hoc target',
    );
  }

  return {
    kind: input.kind,
    webhookHeaders: input.webhookHeadersJson
      ? parseAdhocWebhookHeaders(input.webhookHeadersJson)
      : undefined,
    webhookUrl,
  };
}

function parseAdhocWebhookHeaders(
  json: string,
): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(json);

    if (!isRecord(parsed)) {
      throw new BadRequestException(
        'webhookHeadersJson must be a JSON object of string values',
      );
    }

    return Object.entries(parsed).reduce<Readonly<Record<string, string>>>(
      (accumulator, [key, value]) => ({
        ...accumulator,
        ...(typeof value === 'string' ? { [key]: value } : {}),
      }),
      {},
    );
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException('webhookHeadersJson is not valid JSON');
  }
}

function readAdhocTargetValue(
  directive: AdhocDirectiveEntity,
): AdhocTargetValue {
  const value = directive.targetValue;
  const kind = directive.targetKind;

  if (kind === AdhocTargetKindEnum.MEMBER) {
    return {
      kind,
      memberIds: Array.isArray(value.memberIds)
        ? value.memberIds.filter(
            (memberId): memberId is string => typeof memberId === 'string',
          )
        : [],
    };
  }

  if (kind === AdhocTargetKindEnum.POSITION) {
    return {
      kind,
      positionId: typeof value.positionId === 'string' ? value.positionId : '',
    };
  }

  if (kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    return {
      includeDescendants: Boolean(value.includeDescendants),
      kind,
      orgUnitId: typeof value.orgUnitId === 'string' ? value.orgUnitId : '',
    };
  }

  return {
    kind,
    webhookHeaders: isRecord(value.webhookHeaders)
      ? Object.entries(value.webhookHeaders).reduce<
          Readonly<Record<string, string>>
        >(
          (accumulator, [key, headerValue]) => ({
            ...accumulator,
            ...(typeof headerValue === 'string' ? { [key]: headerValue } : {}),
          }),
          {},
        )
      : undefined,
    webhookUrl: typeof value.webhookUrl === 'string' ? value.webhookUrl : '',
  };
}

function buildAdhocApproverResolver(
  target: AdhocTargetValue,
): ApproverResolver {
  if (target.kind === AdhocTargetKindEnum.MEMBER) {
    return { memberIds: target.memberIds ?? [], type: 'DIRECT' };
  }

  if (target.kind === AdhocTargetKindEnum.POSITION) {
    return { positionId: target.positionId ?? '', type: 'POSITION' };
  }

  if (target.kind === AdhocTargetKindEnum.ORG_UNIT_MEMBER) {
    return {
      includeDescendants: target.includeDescendants,
      orgUnitId: target.orgUnitId ?? '',
      type: 'ORG_UNIT_MEMBER',
    };
  }

  throw new BadRequestException(
    'WEBHOOK ad-hoc targets cannot be used as approvers',
  );
}

function readAdhocStageOutcomeLabel(outcome: AdhocStageOutcome): string {
  if (outcome === 'APPROVED') {
    return '通過';
  }

  if (outcome === 'REJECTED') {
    return '拒絕';
  }

  return '退回';
}

function readInstanceFinalStateLabel(
  finalState: ApprovalInstanceStateEnum,
): string {
  if (finalState === ApprovalInstanceStateEnum.APPROVED) {
    return '核准';
  }

  if (finalState === ApprovalInstanceStateEnum.REJECTED) {
    return '拒絕';
  }

  if (finalState === ApprovalInstanceStateEnum.EXPIRED) {
    return '逾期終止';
  }

  return '取消';
}

function readManagerMemberIdFromInitiatorSnapshot(
  initiatorMetadataSnapshot: Readonly<Record<string, unknown>>,
  levelsUp: number,
): unknown {
  const managerChain = initiatorMetadataSnapshot.managerChain;

  if (Array.isArray(managerChain)) {
    return managerChain[Math.max(levelsUp - 1, 0)];
  }

  const managerMemberIds = initiatorMetadataSnapshot.managerMemberIds;

  if (Array.isArray(managerMemberIds)) {
    return managerMemberIds[Math.max(levelsUp - 1, 0)];
  }

  const customFields = initiatorMetadataSnapshot.customFields;

  // An empty `customFields` object must not swallow the top-level fallback:
  // callers commonly send `{ customFields: {}, managerMemberId: '...' }`, and
  // returning early there resolves no approver at all.
  if (isRecord(customFields) && customFields.managerMemberId !== undefined) {
    return customFields.managerMemberId;
  }

  return initiatorMetadataSnapshot.managerMemberId;
}

function isDateRangeActive(
  value: Pick<
    MembershipEntity | ManagerResolutionEntity,
    'effectiveFrom' | 'effectiveTo'
  >,
  date: string,
): boolean {
  return (
    value.effectiveFrom <= date &&
    (!value.effectiveTo || value.effectiveTo >= date)
  );
}

/**
 * Manager resolutions are sorted by priority and then by scope specificity, so
 * every entry below the winning tier is a lower-precedence fallback that must
 * not join the approver list — a company-wide catch-all rule would otherwise be
 * appended to every member's direct manager. The organization module already
 * resolves managers this way (`OrganizationService.resolveManagerMemberId`
 * returns `active[0]`); this keeps the workflow engine consistent with it.
 *
 * Ties on the winning tier are preserved so a step can still be shared by
 * several managers of equal precedence.
 *
 * When `orgUnitDepths` is provided and the winning scope is ORG_UNIT, only the
 * deepest org units on the winning tier are kept so that ancestor-level
 * catch-all rules do not dilute the approver list. This is opt-in via the
 * resolver's `preferClosestOrgUnit` flag because org-tree depth does not always
 * reflect authority (e.g. project offices attached to executive roles).
 */
function readTopPriorityResolutions(
  resolutions: readonly ManagerResolutionEntity[],
  orgUnitDepths?: ReadonlyMap<string, number>,
): readonly ManagerResolutionEntity[] {
  const [top] = resolutions;

  if (!top) {
    return [];
  }

  const sameTier = resolutions.filter(
    (resolution) =>
      resolution.priority === top.priority &&
      resolution.scopeType === top.scopeType,
  );

  if (
    orgUnitDepths &&
    top.scopeType === ManagerResolutionScopeTypeEnum.ORG_UNIT
  ) {
    const maxDepth = Math.max(
      ...sameTier.map(
        (resolution) => orgUnitDepths.get(resolution.scopeId) ?? 0,
      ),
    );

    return sameTier.filter(
      (resolution) => (orgUnitDepths.get(resolution.scopeId) ?? 0) === maxDepth,
    );
  }

  return sameTier;
}

function compareManagerResolution(
  left: ManagerResolutionEntity,
  right: ManagerResolutionEntity,
  orgUnitDepths?: ReadonlyMap<string, number>,
): number {
  const priorityDiff = right.priority - left.priority;

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const scopeRankDiff =
    readManagerResolutionScopeRank(right.scopeType) -
    readManagerResolutionScopeRank(left.scopeType);

  if (scopeRankDiff !== 0) {
    return scopeRankDiff;
  }

  if (orgUnitDepths) {
    const depthDiff =
      (orgUnitDepths.get(right.scopeId) ?? 0) -
      (orgUnitDepths.get(left.scopeId) ?? 0);

    if (depthDiff !== 0) {
      return depthDiff;
    }
  }

  return right.effectiveFrom.localeCompare(left.effectiveFrom);
}

function readOrgUnitDepthMap(
  orgUnits: readonly OrgUnitEntity[],
): ReadonlyMap<string, number> {
  return new Map(
    orgUnits.map((orgUnit) => [orgUnit.id, orgUnit.path.split('.').length]),
  );
}

function readManagerResolutionScopeRank(
  scopeType: ManagerResolutionScopeTypeEnum,
): number {
  const ranks: Readonly<Record<ManagerResolutionScopeTypeEnum, number>> = {
    [ManagerResolutionScopeTypeEnum.MEMBER]: 3,
    [ManagerResolutionScopeTypeEnum.ORG_UNIT]: 2,
    [ManagerResolutionScopeTypeEnum.POSITION]: 1,
  };

  return ranks[scopeType];
}

function compareMembership(
  left: MembershipEntity,
  right: MembershipEntity,
): number {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  return right.effectiveFrom.localeCompare(left.effectiveFrom);
}

function canReadAllWorkflows(scope: WorkflowReadScope): boolean {
  return (
    scope.roles.includes('BPM_ADMIN') ||
    scope.permissions.some((permission) =>
      WORKFLOW_READ_ALL_PERMISSIONS.has(permission),
    )
  );
}

function isTaskRelatedToMember(task: TaskEntity, memberId: string): boolean {
  return (
    task.assigneeMemberId === memberId ||
    task.originalAssigneeMemberId === memberId
  );
}

function readCandidateStatusForClosedTask(
  taskStatus: TaskStatusEnum,
): TaskCandidateStatusEnum {
  if (taskStatus === TaskStatusEnum.TRANSFERRED) {
    return TaskCandidateStatusEnum.TRANSFERRED;
  }

  if (taskStatus === TaskStatusEnum.COMPLETED) {
    return TaskCandidateStatusEnum.COMPLETED;
  }

  return TaskCandidateStatusEnum.CANCELLED;
}

/**
 * `deferredFieldKeys` are fields an approver fills in later: they are checked
 * for shape (a table is an array of well-formed rows, a member value is a
 * member id, an org unit value is an organization unit id) but never for
 * being present, so an empty one cannot block a submission that has nobody to
 * fill it yet.
 */
function validateSubmittedFormData(
  schema: FormDefinitionSchema,
  formData: Readonly<Record<string, unknown>>,
  options: { readonly deferredFieldKeys?: ReadonlySet<string> } = {},
): void {
  const deferredFieldKeys = options.deferredFieldKeys ?? new Set<string>();
  const testPattern = createTimedTextFieldPatternTest();
  const visibleFields = schema.fields.filter((field) =>
    isSubmittedFormFieldVisible(field, schema.fields, formData),
  );
  // Tables answer "is this filled?" by row count and report per-row problems
  // with an instance path, so they get their own pass instead of the flat
  // "missing required fields" list (ADR 16 §3.7).
  const missingFields = visibleFields.filter(
    (field) =>
      !isTableFieldDefinition(field) &&
      !deferredFieldKeys.has(field.fieldKey) &&
      isSubmittedFormFieldRequired(field, schema.fields, formData) &&
      !isSubmittedFieldValuePresent(formData[field.fieldKey]),
  );

  throwFirstFormDataFieldError({
    missingFields,
    // A field an approver fills in later is held to its rules when they fill
    // it, not here: the applicant cannot see or change it, so only its type is
    // checked, the same as a table nobody fills in.
    readTextErrors: () => [
      ...visibleFields.flatMap((field) =>
        readSubmittedTextValueErrors(field, formData[field.fieldKey], {
          shapeOnly: deferredFieldKeys.has(field.fieldKey),
          testPattern,
        }),
      ),
      // A field nobody can fill in right now — hidden (store-only), or one
      // whose `visibleWhen` is false — keeps its submitted value, so its value
      // is checked for its type. Only the type: its length and format apply
      // once the field is shown and the filler can correct it.
      ...schema.fields
        .filter((field) => !visibleFields.includes(field))
        .flatMap((field) =>
          readSubmittedTextValueErrors(field, formData[field.fieldKey], {
            shapeOnly: true,
            testPattern,
          }),
        ),
    ],
    // A `DYNAMIC_FORM` resolver reads a member value whether or not its field
    // is visible, so a hidden field still holding a value must be well-formed
    // too. Whether a hidden field is *required* stays a visibility question
    // above.
    readMemberErrors: () =>
      readSubmittedMemberValueErrors(
        schema.fields.filter(
          (field) =>
            visibleFields.includes(field) ||
            isSubmittedFieldValuePresent(formData[field.fieldKey]),
        ),
        formData,
      ),
    // A `FORM_ORG_UNIT_MANAGER` resolver reads the unit whether or not its
    // field is visible, so a hidden field still holding a value is checked too.
    readOrgUnitErrors: () =>
      readSubmittedOrgUnitValueErrors(
        schema.fields.filter(
          (field) =>
            visibleFields.includes(field) ||
            isSubmittedFieldValuePresent(formData[field.fieldKey]),
        ),
        formData,
      ),
    readTableErrors: () => [
      ...visibleFields
        .filter(isTableFieldDefinition)
        .flatMap((field) =>
          validateSubmittedTableValue(
            field,
            formData[field.fieldKey],
            isSubmittedFormFieldRequired(field, schema.fields, formData),
            testPattern,
            deferredFieldKeys.has(field.fieldKey),
          ),
        ),
      // A hidden table is not "visible", but its stored value still has to be
      // a well-formed table under the row cap: only the required / minimum
      // checks are skipped, since nobody can fill the table in.
      ...schema.fields
        .filter(isTableFieldDefinition)
        .filter((field) => field.hidden === true)
        .flatMap((field) =>
          validateSubmittedTableValue(
            field,
            formData[field.fieldKey],
            false,
            testPattern,
            true,
          ),
        ),
    ],
    // Every `file_upload` field, shown or not: the submit binds the files of
    // each one to the case, so a cap only the visible ones obey could be
    // stepped around by sending files in a hidden field.
    readFileUploadErrors: () =>
      readSubmittedFileUploadErrors(schema.fields, formData),
  });
}

/**
 * A `file_upload` field holding more files than its `maxFiles`. The renderer
 * stops at the cap, but nothing kept a caller that writes the form data itself
 * from going past it. On a resubmit the value lists the files kept from the
 * returned case and the ones uploaded since, so both count, as they do in the
 * renderer. Each distinct non-empty id in the value is one file: the binding
 * attaches an id once however often it repeats, so a repeat is not a second
 * file. A field without `maxFiles` takes any number, as it does in the
 * renderer.
 */
function readSubmittedFileUploadErrors(
  fields: readonly FormFieldDefinition[],
  formData: Readonly<Record<string, unknown>>,
): readonly FormDataIssue[] {
  return fields.flatMap((field): readonly FormDataIssue[] => {
    if (field.type !== 'file_upload' || typeof field.maxFiles !== 'number') {
      return [];
    }

    const fileCount = countFileUploadValueIds(
      readRowCellValue(formData, field.fieldKey),
    );

    return fileCount > field.maxFiles
      ? [
          createFormDataIssue(
            readFieldIssueLocation(field),
            'MAX_FILES',
            `最多 ${field.maxFiles} 個檔案`,
            field.maxFiles,
          ),
        ]
      : [];
  });
}

/**
 * The distinct files a `file_upload` value names. The ids are read by the same
 * helper the attachment binding uses, and collapsed the way the binding
 * collapses them (one attachment per id).
 */
function countFileUploadValueIds(value: unknown): number {
  return new Set(readFileUploadValueIds(value)).size;
}

/**
 * What an approval at a node has to leave behind: every field the node lets the
 * approver fill in is well-formed (a table is an array of well-formed rows with
 * its required columns and minimum rows, a member value is a member id, an
 * org unit value is an organization unit id) and
 * every one the node marks `required` is present. The messages are the submit
 * ones: a host tells the two entry points apart by which call it made.
 */
function validateFilledFormFields(
  schema: FormDefinitionSchema,
  formData: Readonly<Record<string, unknown>>,
  fieldKeys: ReadonlySet<string>,
  requiredFieldKeys: ReadonlySet<string>,
): void {
  const fields = schema.fields.filter((field) => fieldKeys.has(field.fieldKey));
  const testPattern = createTimedTextFieldPatternTest();

  // `readRowCellValue` is used below as an own-property reader for top-level
  // form keys: a key like `constructor` must not read off the prototype chain.
  throwFirstFormDataFieldError({
    // Tables answer by row count, so like submit they stay out of this list.
    missingFields: fields.filter(
      (field) =>
        !isTableFieldDefinition(field) &&
        requiredFieldKeys.has(field.fieldKey) &&
        isFormDataValueEmpty(readRowCellValue(formData, field.fieldKey)),
    ),
    readTextErrors: () =>
      fields.flatMap((field) =>
        readSubmittedTextValueErrors(
          field,
          readRowCellValue(formData, field.fieldKey),
          { testPattern },
        ),
      ),
    readMemberErrors: () => readSubmittedMemberValueErrors(fields, formData),
    readOrgUnitErrors: () => readSubmittedOrgUnitValueErrors(fields, formData),
    readTableErrors: () =>
      fields
        .filter(isTableFieldDefinition)
        .flatMap((field) =>
          validateSubmittedTableValue(
            field,
            readRowCellValue(formData, field.fieldKey),
            requiredFieldKeys.has(field.fieldKey),
            testPattern,
          ),
        ),
  });
}

/**
 * The shared tail of submit and approver-fill validation: a missing required
 * field wins over a text value breaking its length or format rule, which wins
 * over a malformed member value, which wins over a malformed org unit value,
 * which wins over a table problem, which wins over a `file_upload` field
 * holding more files than it allows, and the later checks are only evaluated
 * when the earlier ones pass. The refusal carries every issue of the winning
 * check. Its message is those issues' sentences joined, except for missing
 * required fields, which keep the one-line summary `缺少必填欄位：A, B` that
 * submitters read; each issue there still says `欄位「A」為必填`. A client
 * that places errors on fields reads the issues, not the message.
 */
function throwFirstFormDataFieldError({
  missingFields,
  readFileUploadErrors = (): readonly FormDataIssue[] => [],
  readMemberErrors,
  readOrgUnitErrors,
  readTableErrors,
  readTextErrors,
}: {
  readonly missingFields: readonly FormFieldDefinition[];
  // Optional: an approver cannot be given a `file_upload` field to fill in
  // (workflow lint `approverFilledFieldFileUpload`), so only submit passes it.
  readonly readFileUploadErrors?: () => readonly FormDataIssue[];
  readonly readMemberErrors: () => readonly FormDataIssue[];
  readonly readOrgUnitErrors: () => readonly FormDataIssue[];
  readonly readTableErrors: () => readonly FormDataIssue[];
  readonly readTextErrors: () => readonly FormDataIssue[];
}): void {
  if (missingFields.length > 0) {
    throw createFormDataBadRequest(
      `缺少必填欄位：${missingFields
        .map((field) => field.label || field.fieldKey)
        .join(', ')}`,
      missingFields.map((field) =>
        createFormDataIssue(
          readFieldIssueLocation(field),
          'REQUIRED',
          '為必填',
        ),
      ),
    );
  }

  // Each check runs only when every earlier one passed, so a later check's
  // work is never done for a request that is already refused.
  const winning = [
    readTextErrors,
    readMemberErrors,
    readOrgUnitErrors,
    readTableErrors,
    readFileUploadErrors,
  ].reduce<readonly FormDataIssue[]>(
    (found, check) => (found.length > 0 ? found : check()),
    [],
  );

  if (winning.length > 0) {
    throw createFormDataBadRequest(readFormDataIssueMessage(winning), winning);
  }
}

/**
 * Authoritative shape, row-count and per-row required checks for one table
 * value (ADR 16 §3.7), plus the length and format rules of text columns, which
 * the flat text fields share. `minimum` / `maximum` stay a frontend hint.
 */
function validateSubmittedTableValue(
  field: TableFieldDefinition,
  value: unknown,
  required: boolean,
  testPattern: TextFieldPatternTest,
  shapeOnly = false,
): readonly FormDataIssue[] {
  const location = readFieldIssueLocation(field);

  if (typeof value === 'undefined' || value === null) {
    if (shapeOnly) {
      return [];
    }

    if (required || readTableMinRows(field) > 0) {
      const rows = readTableRequiredRowCount(field);

      return [
        createFormDataIssue(location, 'MIN_ROWS', `至少需要 ${rows} 列`, rows),
      ];
    }

    return [];
  }

  if (!Array.isArray(value)) {
    return [createFormDataIssue(location, 'TYPE', '必須是表格列的清單')];
  }

  // Too many rows is refused before any row is checked: the rows a submitter
  // sends would otherwise decide how many cells the text patterns run on.
  const maxRows = readTableMaxRows(field);

  if (value.length > maxRows) {
    return [
      createFormDataIssue(location, 'MAX_ROWS', `最多 ${maxRows} 列`, maxRows),
    ];
  }

  const rowErrors = value.flatMap((row, index) =>
    validateSubmittedTableRow(
      field,
      row,
      readRowIssueLocation(field, index),
      testPattern,
      shapeOnly,
    ),
  );

  // A malformed row cannot be counted against the minimum meaningfully; report
  // the shape problem first so the submitter fixes the real cause.
  if (rowErrors.length > 0) {
    return rowErrors;
  }

  return validateSubmittedTableRowCount(
    field,
    value.length,
    required,
    location,
    shapeOnly,
  );
}

/** The minimum only: the maximum is refused before any row is checked. */
function validateSubmittedTableRowCount(
  field: TableFieldDefinition,
  rowCount: number,
  required: boolean,
  location: FormDataIssueLocation,
  shapeOnly = false,
): readonly FormDataIssue[] {
  const minRows = shapeOnly
    ? 0
    : required
      ? Math.max(readTableMinRows(field), 1)
      : readTableMinRows(field);

  return rowCount < minRows
    ? [
        createFormDataIssue(
          location,
          'MIN_ROWS',
          `至少需要 ${minRows} 列`,
          minRows,
        ),
      ]
    : [];
}

function validateSubmittedTableRow(
  field: TableFieldDefinition,
  row: unknown,
  location: FormDataIssueLocation,
  testPattern: TextFieldPatternTest,
  shapeOnly = false,
): readonly FormDataIssue[] {
  if (!isRecord(row)) {
    return [createFormDataIssue(location, 'TYPE', '必須是物件')];
  }

  const columnsByKey = new Map(
    field.columns.map((column) => [column.fieldKey, column]),
  );
  const unknownKeyErrors = Object.keys(row)
    .filter((columnKey) => !columnsByKey.has(columnKey))
    .map((columnKey) =>
      createFormDataIssue(
        location,
        'UNKNOWN_COLUMN',
        `含有不屬於此表格的欄位「${columnKey}」`,
      ),
    );
  const cellErrors = Object.entries(row)
    .filter(
      ([columnKey, cellValue]) =>
        columnsByKey.has(columnKey) && !isFormTableCellValue(cellValue),
    )
    .map(([columnKey]) =>
      createFormDataIssue(
        readCellIssueLocation(
          location,
          columnsByKey.get(columnKey) ?? { fieldKey: columnKey },
        ),
        'TYPE',
        '不是有效的值',
      ),
    );
  const requiredErrors = shapeOnly
    ? []
    : field.columns
        .filter(
          (column) =>
            isSubmittedTableColumnRequired(column) &&
            !isSubmittedFieldValuePresent(
              readRowCellValue(row, column.fieldKey),
            ),
        )
        .map((column) =>
          createFormDataIssue(
            readCellIssueLocation(location, column),
            'REQUIRED',
            '為必填',
          ),
        );
  // A shape-only pass covers a table nobody fills in, so the filler-facing
  // rules do not apply to it, the same as the required check above; only a
  // cell of the wrong type is still refused.
  const textErrors = field.columns.flatMap((column) =>
    readSubmittedTextValueErrors(
      column,
      readRowCellValue(row, column.fieldKey),
      {
        location: readCellIssueLocation(location, column),
        shapeOnly,
        testPattern,
      },
    ),
  );

  return [...unknownKeyErrors, ...cellErrors, ...requiredErrors, ...textErrors];
}

/**
 * The server half of the text length and format rules: the same
 * `readTextFieldValueIssue` the renderer runs before it lets the filler send,
 * so a crafted request cannot store what the form would have refused — a
 * number or an array sent for a text field with rules included. `shapeOnly`
 * keeps only that type check, for a value nobody fills in at this step, and
 * does not run the pattern at all. `testPattern` is the validation pass's
 * timed pattern test (see `createTimedTextFieldPatternTest`); once its time
 * budget is spent, a value is reported as not checked rather than as a
 * format error.
 */
function readSubmittedTextValueErrors(
  field: FormFieldDefinition,
  value: unknown,
  {
    location = readFieldIssueLocation(field),
    shapeOnly = false,
    testPattern,
  }: {
    readonly location?: FormDataIssueLocation;
    readonly shapeOnly?: boolean;
    readonly testPattern: TextFieldPatternTest;
  },
): readonly FormDataIssue[] {
  if (field.type !== 'text' && field.type !== 'textarea') {
    return [];
  }

  const readIssue = ():
    ReturnType<typeof readTextFieldValueIssue> | 'timeout' => {
    try {
      return readTextFieldValueIssue(field, value, {
        testPattern: shapeOnly ? (): boolean => true : testPattern,
      });
    } catch (error) {
      if (error instanceof TextFieldPatternTimeoutError) {
        return 'timeout';
      }

      throw error;
    }
  };
  const issue = readIssue();

  if (issue === 'timeout') {
    return [
      createFormDataIssue(
        location,
        'PATTERN_TIMEOUT',
        '無法在時限內完成格式檢查',
      ),
    ];
  }

  if (!issue || (shapeOnly && issue.kind !== 'type')) {
    return [];
  }

  if (issue.kind === 'type') {
    return [createFormDataIssue(location, 'TYPE', '必須是文字')];
  }

  if (issue.kind === 'minLength') {
    return [
      createFormDataIssue(
        location,
        'MIN_LENGTH',
        `至少需要 ${issue.limit} 個字`,
        issue.limit,
      ),
    ];
  }

  if (issue.kind === 'maxLength') {
    return [
      createFormDataIssue(
        location,
        'MAX_LENGTH',
        `最多 ${issue.limit} 個字`,
        issue.limit,
      ),
    ];
  }

  return [createFormDataIssue(location, 'PATTERN', '格式不正確')];
}

/**
 * Own-property read. `constructor`, `toString` and friends all satisfy the
 * column key identifier rule, so a plain index would walk the prototype chain
 * and report an empty row as filled.
 */
function readRowCellValue(
  row: Readonly<Record<string, unknown>>,
  columnKey: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(row, columnKey)
    ? row[columnKey]
    : undefined;
}

/**
 * Columns carry no `requiredWhen`: row-scoped conditions are out of scope for
 * V1 and the structural lint rejects them (ADR 16 §3.1).
 */
function isSubmittedTableColumnRequired(
  column: TableColumnDefinition,
): boolean {
  return column.required === true;
}

function readTableMinRows(field: TableFieldDefinition): number {
  return typeof field.minRows === 'number' ? field.minRows : 0;
}

function readTableMaxRows(field: TableFieldDefinition): number {
  return typeof field.maxRows === 'number'
    ? field.maxRows
    : FORM_TABLE_MAX_ROWS;
}

function readTableRequiredRowCount(field: TableFieldDefinition): number {
  return Math.max(readTableMinRows(field), 1);
}

function readFormDefinitionSnapshotSchema(
  snapshot: Readonly<Record<string, unknown>>,
): FormDefinitionSchema {
  const schema = snapshot.schema;

  if (isFormDefinitionSchema(schema)) {
    return schema;
  }

  throw new BadRequestException('Approval instance form schema is invalid');
}

function isFormDefinitionSchema(value: unknown): value is FormDefinitionSchema {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.fields) &&
    // Every reader below dereferences `field.fieldKey`; requiring records here
    // turns a corrupt snapshot into a controlled 400 instead of a TypeError.
    value.fields.every((field) => isRecord(field))
  );
}

function isSubmittedFormFieldVisible(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  // A hidden (store-only) field is never shown, so nobody can fill it in:
  // treat it like a false `visibleWhen`. Its submitted value is still kept.
  if (field.hidden) {
    return false;
  }

  return field.visibleWhen
    ? evaluateFormConditionExpression(field.visibleWhen, fields, values, true)
    : true;
}

function isSubmittedFormFieldRequired(
  field: FormFieldDefinition,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  return (
    field.required ||
    Boolean(
      field.requiredWhen
        ? evaluateFormConditionExpression(
            field.requiredWhen,
            fields,
            values,
            false,
          )
        : false,
    )
  );
}

function evaluateFormConditionExpression(
  expression: string,
  fields: readonly FormFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
  fallback: boolean,
): boolean {
  const rule = parseFormConditionRule(expression);

  if (!rule) {
    return fallback;
  }

  const field = fields.find(
    (candidate) => candidate.fieldKey === rule.fieldKey,
  );

  if (!field) {
    return fallback;
  }

  // A table value is a list of rows; comparing it with `==` / `>` has no
  // meaning, and the structural lint already rejects cell-level references.
  // Falling back keeps a table operand from silently deciding visibility
  // through a string comparison against row records (ADR 16 §3.8).
  if (isTableFieldDefinition(field)) {
    return fallback;
  }

  return evaluateFormConditionRule(rule, field, values[field.fieldKey]);
}

function parseFormConditionRule(expression: string): {
  readonly fieldKey: string;
  readonly operator: FormConditionOperator;
  readonly value: string;
} | null {
  const match = expression
    .trim()
    .match(/^form\.([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u);

  if (!match) {
    return null;
  }

  const operator = readFormConditionOperatorFromSymbol(match[2]);

  if (!operator) {
    return null;
  }

  return {
    fieldKey: match[1],
    operator,
    value: parseFormConditionLiteral(match[3]),
  };
}

function evaluateFormConditionRule(
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
  field: FormFieldDefinition,
  value: unknown,
): boolean {
  if (Array.isArray(value)) {
    return evaluateArrayFormCondition(value, rule);
  }

  if (field.type === 'boolean') {
    return compareFormConditionValues(
      value === true ? 'true' : 'false',
      rule.value,
      rule.operator,
    );
  }

  if (isNumberFormField(field)) {
    return compareNumericFormCondition(value, rule);
  }

  return compareFormConditionValues(
    typeof value === 'undefined' || value === null ? '' : String(value),
    rule.value,
    rule.operator,
  );
}

function evaluateArrayFormCondition(
  value: readonly unknown[],
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
): boolean {
  const stringValues = value.filter(
    (entry): entry is string => typeof entry === 'string',
  );

  if (rule.operator === 'equals') {
    return stringValues.includes(rule.value);
  }

  if (rule.operator === 'notEquals') {
    return !stringValues.includes(rule.value);
  }

  return false;
}

function compareNumericFormCondition(
  value: unknown,
  rule: {
    readonly operator: FormConditionOperator;
    readonly value: string;
  },
): boolean {
  const actualValue = typeof value === 'number' ? value : Number(value);
  const expectedValue = Number(rule.value);

  if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) {
    return false;
  }

  return compareFormConditionValues(actualValue, expectedValue, rule.operator);
}

function compareFormConditionValues(
  actualValue: number | string,
  expectedValue: number | string,
  operator: FormConditionOperator,
): boolean {
  if (operator === 'equals') {
    return actualValue === expectedValue;
  }

  if (operator === 'notEquals') {
    return actualValue !== expectedValue;
  }

  if (operator === 'greaterThan') {
    return actualValue > expectedValue;
  }

  if (operator === 'greaterThanOrEqual') {
    return actualValue >= expectedValue;
  }

  if (operator === 'lessThan') {
    return actualValue < expectedValue;
  }

  return actualValue <= expectedValue;
}

function readFormConditionOperatorFromSymbol(
  symbol: string | undefined,
): FormConditionOperator | null {
  const operators: Readonly<Record<string, FormConditionOperator>> = {
    '!=': 'notEquals',
    '<': 'lessThan',
    '<=': 'lessThanOrEqual',
    '==': 'equals',
    '>': 'greaterThan',
    '>=': 'greaterThanOrEqual',
  };

  return symbol ? (operators[symbol] ?? null) : null;
}

function parseFormConditionLiteral(value: string): string {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function isSubmittedFieldValuePresent(value: unknown): boolean {
  return !isFormDataValueEmpty(value);
}

function isNumberFormField(
  field: FormFieldDefinition,
): field is NumberFieldDefinition {
  return field.type === 'number' || field.type === 'money';
}

// A node that is skipped and then has nowhere to go keeps saying why it was
// skipped, then why the branch ends; any other node just says why it ends.
function readDryRunStepResultMessage(
  assignmentMessage: string | null,
  stopMessage: string | null,
  defaultMessage: string,
  skipped: boolean,
): string {
  const message = assignmentMessage ?? defaultMessage;

  if (stopMessage === null) {
    return message;
  }

  return skipped ? `${endSentence(message)}${stopMessage}` : stopMessage;
}

// The skip reason and the stop reason are two sentences; a reason that does not
// already end in full-stop punctuation gets one so they do not run together.
function endSentence(message: string): string {
  return /[。！？.!?]$/.test(message) ? message : `${message}。`;
}

type DryRunFallbackProblem =
  | 'NOT_SET'
  | 'BLANK_MEMBER'
  | 'BLANK_POSITION'
  | 'IS_INITIATOR'
  | 'UNSUPPORTED';

// Why a manager resolver's fixed fallback cannot take over when the initiator
// has no manager, or `null` when it can: like the runtime, it must exist, name
// a member, and not be the initiator unless the node allows self-approval.
function readDryRunFallbackProblem(
  initiatorMemberId: string,
  fallback: ApproverResolverFallback | undefined,
): DryRunFallbackProblem | null {
  if (fallback && readUnsupportedApproverFallbackType(fallback) !== null) {
    return 'UNSUPPORTED';
  }

  if (fallback?.type === 'POSITION') {
    // The holders are only known at run time, so the dry run cannot tell
    // whether the position is empty; it only rules out a blank position.
    return fallback.positionId.trim() === '' ? 'BLANK_POSITION' : null;
  }

  if (!fallback || fallback.type !== 'DIRECT') {
    return 'NOT_SET';
  }

  const memberId = fallback.memberId.trim();

  if (memberId === '') {
    return 'BLANK_MEMBER';
  }

  return memberId === initiatorMemberId && !fallback.allowInitiatorSelfApproval
    ? 'IS_INITIATOR'
    : null;
}

function readDryRunFallbackMemberIds(
  input: DryRunSimulationInput,
  fallback: ApproverResolverFallback | undefined,
): readonly string[] {
  if (readDryRunFallbackProblem(input.initiatorMemberId, fallback) !== null) {
    return [];
  }

  if (fallback?.type === 'DIRECT') {
    return [fallback.memberId.trim()];
  }

  // Same placeholder a POSITION node gets in a dry run; the label names it.
  return fallback?.type === 'POSITION'
    ? [`position:${fallback.positionId.trim()}`]
    : [];
}

function readDryRunNodeName(node: WorkflowNode): string {
  return node.data.label?.trim() || node.id;
}

// The dry run cannot look the organisation up, so these resolvers stand in
// with a placeholder that names what the runtime would resolve.
function readDryRunPlaceholderAssignee(resolver: ApproverResolver): string {
  if (resolver.type === 'POSITION') {
    return `position:${resolver.positionId}`;
  }

  if (resolver.type === 'ORG_UNIT_MEMBER') {
    return `orgUnitMember:${resolver.orgUnitId}`;
  }

  if (resolver.type === 'ORG_UNIT_POSITION') {
    return `orgUnitPosition:${resolver.orgUnitId}:${resolver.positionId}`;
  }

  if (resolver.type === 'ORG_UNIT_MANAGER') {
    return `orgUnitManager:${resolver.orgUnitId}`;
  }

  if (resolver.type === 'FORM_MEMBER_MANAGER') {
    return `formMemberManager:${resolver.formPath}:${resolver.levelsUp}`;
  }

  if (resolver.type === 'FORM_ORG_UNIT_MANAGER') {
    return `formOrgUnitManager:${resolver.formPath}`;
  }

  if (resolver.type === 'NODE_ACTOR') {
    return `nodeActor:${resolver.nodeIds.join(',')}`;
  }

  if (resolver.type === 'NODE_ACTOR_MANAGER') {
    return `nodeActorManager:${resolver.nodeIds.join(',')}:${resolver.levelsUp}`;
  }

  return resolver.type === 'ORG_MANAGER_CHAIN'
    ? formatOrgManagerChainPlaceholder(resolver)
    : resolver.type;
}

function readDryRunUnresolvedApproverMessage(
  resolver: ApproverResolver,
  nodeName: string,
  initiatorMemberId: string,
): string {
  if (resolver.type === 'DIRECT') {
    return `簽核節點「${nodeName}」尚未選擇簽核人，請在流程設計器點選此節點設定簽核人`;
  }

  if (resolver.type === 'DYNAMIC_FORM') {
    return `簽核節點「${nodeName}」依表單欄位找不到簽核人，請確認試跑資料中該欄位有填人員`;
  }

  if (resolver.type === 'EXPRESSION') {
    return `簽核節點「${nodeName}」依運算式找不到簽核人，請確認運算式的結果`;
  }

  const fallbackProblem =
    resolver.type === 'ORG_MANAGER'
      ? readDryRunFallbackProblem(initiatorMemberId, resolver.fallback)
      : null;

  if (fallbackProblem === 'BLANK_MEMBER') {
    return `簽核節點「${nodeName}」找不到主管，且改派固定人未設定`;
  }

  if (fallbackProblem === 'IS_INITIATOR') {
    return `簽核節點「${nodeName}」找不到主管，且改派固定人是申請人本人，此節點未允許申請人自簽`;
  }

  if (fallbackProblem === 'BLANK_POSITION') {
    return `簽核節點「${nodeName}」找不到主管，且改派職位未設定`;
  }

  if (fallbackProblem === 'UNSUPPORTED') {
    return `簽核節點「${nodeName}」找不到主管，且此引擎版本不支援該改派設定，請升級 BPMCore 後再試`;
  }

  return `簽核節點「${nodeName}」依申請人的組織找不到主管，請確認試跑時的申請人資料`;
}

function createDryRunStep(input: {
  readonly assigneeMemberId: string | null;
  readonly edge: WorkflowEdge | null;
  readonly edgeMatched: boolean | null;
  readonly edgeReason: string | null;
  readonly entryCondition: string | null;
  readonly entryConditionMet: boolean | null;
  readonly message: string;
  readonly node: WorkflowNode;
  readonly status: string;
  readonly stepIndex: number;
}): WorkflowDryRunStepObject {
  return Object.assign(new WorkflowDryRunStepObject(), {
    assigneeMemberId: input.assigneeMemberId,
    edgeDefault: input.edge ? Boolean(input.edge.data.isDefault) : null,
    edgeId: input.edge?.id ?? null,
    edgeLabel: input.edge ? readDryRunEdgeLabel(input.edge) : null,
    edgeMatched: input.edgeMatched,
    edgeReason: input.edgeReason,
    entryCondition: input.entryCondition,
    entryConditionMatched: input.entryConditionMet,
    id: `dry-run-step-${input.stepIndex + 1}`,
    message: input.message,
    nodeId: input.node.id,
    nodeLabel: input.node.data.label,
    nodeType: input.node.type,
    status: input.status,
  });
}

function readDryRunEdgeLabel(edge: WorkflowEdge): string {
  return edge.data.label?.trim() || edge.id;
}

function readDryRunEdgeReason(edge: WorkflowEdge | null): string | null {
  if (!edge) {
    return null;
  }

  if (edge.data.isDefault) {
    return '其他條件不符合時採用預設路徑。';
  }

  const expression = edge.data.condition?.trim();

  if (expression) {
    return `條件成立：${expression}`;
  }

  if (edge.data.conditionFieldKey && edge.data.conditionOperator) {
    return `條件成立：${edge.data.conditionFieldKey} ${edge.data.conditionOperator}${
      edge.data.conditionValue ? ` ${edge.data.conditionValue}` : ''
    }`;
  }

  return '無條件路徑。';
}

function readDryRunStepStatus(
  node: WorkflowNode,
  entryConditionMet: boolean,
): string {
  if (!entryConditionMet) {
    return 'SKIPPED';
  }

  if (node.type === 'userTask') {
    return 'WAITING';
  }

  if (node.type === 'endEvent') {
    return 'COMPLETED';
  }

  return 'PASSED';
}

function readDryRunStepMessage(
  node: WorkflowNode,
  entryConditionMet: boolean,
): string {
  if (!entryConditionMet) {
    return '進入條件不符合，略過節點。';
  }

  if (node.type === 'userTask') {
    return '將建立待簽任務。';
  }

  if (node.type === 'endEvent') {
    return `流程結束：${node.data.endState ?? 'APPROVED'}`;
  }

  if (isAsyncNotifyServiceTask(node)) {
    return '將發送知會，此分支不會繼續往下。';
  }

  return '節點條件通過。';
}

function mapDecisionToResolution(
  action: TaskDecisionActionEnum,
): NotificationResolutionEnum {
  switch (action) {
    case TaskDecisionActionEnum.APPROVED:
      return NotificationResolutionEnum.APPROVED;
    case TaskDecisionActionEnum.REJECTED:
      return NotificationResolutionEnum.REJECTED;
    case TaskDecisionActionEnum.RETURNED:
      return NotificationResolutionEnum.RETURNED;
    case TaskDecisionActionEnum.TRANSFERRED:
      return NotificationResolutionEnum.TRANSFERRED;
  }
}

// The limit is stated in characters, so a character outside the BMP counts
// once rather than as its two UTF-16 code units.
function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function normalizeBusinessKey(
  businessKey: string | null | undefined,
): string | null {
  const trimmed = businessKey?.trim() ?? '';

  if (trimmed === '') {
    return null;
  }

  if (countCodePoints(trimmed) > MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH) {
    throw new BadRequestException(
      `業務鍵長度不可超過 ${MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH} 個字元`,
    );
  }

  return trimmed;
}

/**
 * Turns Postgres rejecting a duplicate (template, business key) into a
 * Conflict. Any other failure, including other unique violations inside the
 * same transaction, surfaces as it is.
 */
function throwBusinessKeyConflictOrRethrow(
  error: unknown,
  businessKey: string | null,
): never {
  const { code, constraint, driverError } = (error ?? {}) as {
    readonly code?: unknown;
    readonly constraint?: unknown;
    readonly driverError?: {
      readonly code?: unknown;
      readonly constraint?: unknown;
    };
  };

  if (
    businessKey !== null &&
    (code ?? driverError?.code) === '23505' &&
    (constraint ?? driverError?.constraint) ===
      APPROVAL_INSTANCE_BUSINESS_KEY_INDEX
  ) {
    throw new ConflictException(
      `此範本已有相同業務鍵（${businessKey}）的簽核單`,
    );
  }

  throw error;
}
