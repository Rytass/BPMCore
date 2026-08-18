import {
  FormDefinitionSchema,
  FormDataSourceValueSnapshots,
  FormFieldDefinition,
  FormFieldValue,
  FormUiSchema,
  FormStaticOptionFieldDefinition,
  isFormStaticOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { requestGraphQl } from '../graphql-client';

export type ApprovalInstanceState =
  | 'APPROVED'
  | 'CANCELLED'
  | 'DRAFT'
  | 'EXPIRED'
  | 'REJECTED'
  | 'RETURNED'
  | 'RUNNING';

export type TaskStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'PENDING'
  | 'TRANSFERRED';

export type TaskAssignmentType = 'CANDIDATE_GROUP' | 'DIRECT_MEMBER';

export type TaskDecisionAction =
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'TRANSFERRED';

export type AdhocDirectiveType =
  | 'COMPLETION_NOTIFY'
  | 'COUNTERSIGN'
  | 'PRE_APPROVAL'
  | 'STAGE_NOTIFY';

export type AdhocDirectiveStatus = 'CANCELLED' | 'CONSUMED' | 'PENDING';

export type AdhocTargetKind =
  | 'MEMBER'
  | 'ORG_UNIT_MEMBER'
  | 'POSITION'
  | 'WEBHOOK';

export type AdhocPreApprovalRejectBehavior =
  | 'REJECT_INSTANCE'
  | 'RETURN_TO_ORIGIN';

/**
 * Polymorphic target of an ad-hoc directive. Set exactly the fields matching
 * `kind`:
 *
 * - `MEMBER` → `memberIds`
 * - `POSITION` → `positionId`
 * - `ORG_UNIT_MEMBER` → `orgUnitId` (+ optional `includeDescendants`)
 * - `WEBHOOK` → `webhookUrl` (+ optional `webhookHeaders`); only valid for
 *   the notification directives, never as countersign / pre-approval signers.
 */
export interface AdhocTargetOptions {
  readonly includeDescendants?: boolean;
  readonly kind: AdhocTargetKind;
  readonly memberIds?: readonly string[];
  readonly orgUnitId?: string;
  readonly positionId?: string;
  readonly webhookHeaders?: Readonly<Record<string, string>>;
  readonly webhookUrl?: string;
}

/**
 * An instance-scoped ad-hoc directive recorded by a stage approver. Directives
 * never modify the workflow template — they only affect the single approval
 * instance they were created on. `status` lifecycle: `PENDING` (waiting for
 * its trigger) → `CONSUMED` (effect applied / notification sent) or
 * `CANCELLED` (withdrawn, or dropped by a return / reject / cancel).
 */
export interface AdhocDirectiveRecord {
  readonly channels: readonly NotificationChannel[] | null;
  readonly comment: string | null;
  readonly consumedAt: string | null;
  readonly createdAt: string;
  readonly createdByMemberId: string;
  readonly id: string;
  readonly instanceId: string;
  readonly onReject: AdhocPreApprovalRejectBehavior | null;
  readonly originNodeId: string;
  readonly originTaskId: string;
  readonly status: AdhocDirectiveStatus;
  readonly targetKind: AdhocTargetKind;
  readonly targetValueJson: string;
  readonly type: AdhocDirectiveType;
}

export interface ApprovalInstanceRecord {
  readonly completedAt: string | null;
  readonly formData: WorkflowFormData;
  readonly formDataJson: string;
  readonly formDataOptionSnapshot: FormDataSourceValueSnapshots;
  readonly formDataOptionSnapshotJson: string;
  readonly formDefinitionSnapshot: FormDefinitionSnapshot;
  readonly formDefinitionSnapshotJson: string;
  readonly id: string;
  readonly initiatorMemberId: string;
  readonly startedAt: string;
  readonly state: ApprovalInstanceState;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly title: string;
  readonly workflowSnapshot: WorkflowDefinition;
  readonly workflowSnapshotJson: string;
}

export interface FormDefinitionSnapshot {
  readonly formDefinitionVersionId?: string;
  readonly schema?: FormDefinitionSchema;
  readonly uiSchema?: FormUiSchema;
  readonly version?: number;
}

export type WorkflowFormData = Readonly<
  Record<string, FormFieldValue | undefined>
>;

export interface TaskRecord {
  readonly adhocDirectiveId: string | null;
  readonly adhocOriginTaskId: string | null;
  readonly adhocType: AdhocDirectiveType | null;
  readonly assigneeMemberId: string | null;
  readonly assignmentType: TaskAssignmentType;
  readonly candidateMemberIds: readonly string[];
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly decisionPolicySnapshotJson: string;
  readonly delegationChainJson: string;
  readonly id: string;
  readonly instanceId: string;
  readonly isAdhoc: boolean;
  readonly nodeId: string;
  readonly openedAt: string | null;
  readonly originalAssigneeMemberId: string | null;
  readonly slaDueAt: string | null;
  readonly status: TaskStatus;
  readonly tokenId: string;
}

export interface TaskCandidateRecord {
  readonly claimedAt: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly delegationChainJson: string;
  readonly id: string;
  readonly memberId: string;
  readonly originalMemberId: string;
  readonly sourceType: string;
  readonly status: string;
  readonly taskId: string;
}

export interface WorkflowTokenRecord {
  readonly consumedAt: string | null;
  readonly createdAt: string;
  readonly currentNodeId: string;
  readonly id: string;
  readonly instanceId: string;
  readonly parentTokenId: string | null;
  readonly status: 'ACTIVE' | 'CONSUMED' | 'WAITING';
}

export interface TaskDecisionRecord {
  readonly action: TaskDecisionAction;
  readonly comment: string | null;
  readonly decidedAt: string;
  readonly decidedByMemberId: string;
  readonly id: string;
  readonly returnToNodeId: string | null;
  readonly signatureId: string | null;
  readonly taskId: string;
  readonly transferToMemberId: string | null;
}

export interface ActivityLogRecord {
  readonly actorMemberId: string | null;
  readonly createdAt: string;
  readonly eventType: string;
  readonly id: string;
  readonly nodeId: string | null;
  readonly payloadJson: string;
  readonly taskId: string | null;
}

export interface MemberProfileRecord {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}

export interface MemberDirectoryPage {
  readonly members: readonly MemberProfileRecord[];
  readonly totalCount: number;
}

export type DelegationScopeType = 'ALL' | 'CONDITION_BASED' | 'TEMPLATE_LIST';

export type DelegationRuleStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export type NotificationChannel = 'EMAIL' | 'IN_APP' | 'WEBHOOK';

export type NotificationDigestMode = 'DAILY' | 'INSTANT';

export type NotificationStatus = 'FAILED' | 'PENDING' | 'READ' | 'SENT';

export type NotificationType =
  | 'INSTANCE_COMPLETED'
  | 'SLA_OVERDUE'
  | 'SLA_WARNING'
  | 'TASK_ASSIGNED'
  | 'TASK_TRANSFERRED';

export type NotificationResolution =
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'SUPERSEDED'
  | 'TRANSFERRED';

export interface NotificationRecord {
  /**
   * Whether the recipient can still act on this notification (an unresolved
   * task assignment). Server-derived; drives the inline 同意/拒絕 actions.
   */
  readonly actionable: boolean;
  /** When the recipient archived it; `null` while it stays in the live list. */
  readonly archivedAt: string | null;
  readonly attemptCount: number;
  readonly allowReject: boolean | null;
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly deliveryError: string | null;
  readonly deliveryTarget: string | null;
  readonly id: string;
  readonly instanceId: string | null;
  readonly lastAttemptAt: string | null;
  readonly nextRetryAt: string | null;
  readonly payloadJson: string;
  readonly readAt: string | null;
  readonly recipientMemberId: string;
  /** How an actionable notification was resolved; `null` while still open. */
  readonly resolution: NotificationResolution | null;
  readonly resolvedAt: string | null;
  readonly sentAt: string | null;
  /**
   * Recorded but deliberately not announced — the recipient turned in-app
   * notifications off, or it arrived inside their quiet hours. It belongs in
   * the list; what it must not get is a toast or a push.
   */
  readonly silenced: boolean;
  readonly status: NotificationStatus;
  readonly taskId: string | null;
  readonly title: string;
  readonly type: NotificationType;
}

export interface NotificationPreferenceRecord {
  readonly emailDigestMode: NotificationDigestMode;
  readonly emailEnabled: boolean;
  readonly inAppEnabled: boolean;
  readonly memberId: string;
  readonly quietHoursEnd: string | null;
  readonly quietHoursStart: string | null;
  readonly updatedAt: string;
}

export interface DelegationRuleRecord {
  readonly agentMemberId: string;
  readonly createdAt: string;
  readonly createdByMemberId: string | null;
  readonly endAt: string | null;
  readonly id: string;
  readonly principalMemberId: string;
  readonly priority: number;
  readonly requiresConfirmation: boolean;
  readonly revokedAt: string | null;
  readonly revokedByMemberId: string | null;
  readonly scopeConditionCel: string | null;
  readonly scopeTemplateIds: readonly string[];
  readonly scopeType: DelegationScopeType;
  readonly startAt: string;
  readonly status: DelegationRuleStatus;
  readonly updatedAt: string;
}

export interface AttachmentRecord {
  readonly checksumSha256: string;
  readonly createdAt: string;
  readonly filename: string;
  readonly formFieldPath: string | null;
  readonly id: string;
  readonly instanceId: string | null;
  readonly mimeType: string;
  readonly sizeBytes: string;
  readonly storageKey: string;
  readonly storageProvider: string;
  readonly taskId: string | null;
  readonly uploaderMemberId: string;
}

export interface SignatureRecord {
  readonly algorithm: string;
  readonly id: string;
  readonly instanceId: string;
  readonly keyVersion: number;
  readonly previousSignatureHash: string | null;
  readonly signature: string;
  readonly signedAt: string;
  readonly signedPayloadHash: string;
  readonly signedPayloadJson: string;
  readonly signerMemberId: string;
  readonly taskId: string | null;
  readonly timestampTokenBase64: string | null;
}

export interface SignatureVerificationRecord {
  readonly checkedCount: number;
  readonly errors: readonly string[];
  readonly instanceId: string;
  readonly valid: boolean;
}

export interface ApprovalTemplateRecord {
  readonly currentVersionId: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt?: string;
}

export interface ApprovalTemplateVersionRecord {
  readonly formDefinitionVersionId: string | null;
  readonly id: string;
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly version: number;
}

export interface LaunchContext {
  readonly formVersion: {
    readonly id: string;
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
    readonly version: number;
  };
  readonly template: ApprovalTemplateRecord;
  readonly templateVersion: ApprovalTemplateVersionRecord;
}

export interface LaunchableTemplateRecord {
  readonly currentVersionId: string;
  readonly formDefinitionVersionId: string;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type ApprovalInstanceView = 'ALL' | 'CC' | 'SENT';

export interface ApprovalInstancesPageInput {
  readonly page: number;
  readonly pageSize: number;
  readonly searchText: string | null;
  readonly state: ApprovalInstanceState | null;
  readonly templateId: string | null;
  readonly view: ApprovalInstanceView;
}

export interface ApprovalInstancesPageResult {
  readonly instances: readonly ApprovalInstanceRecord[];
  readonly pageInfo: ApprovalInstancePageInfoRecord;
  readonly totalCount: number;
}

export interface ApprovalInstancePageInfoRecord {
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly totalPages: number;
}

export interface WorkflowDashboardSummaryRecord {
  readonly activeInstanceCount: number;
  readonly completedInstanceCount: number;
  readonly overdueTaskCount: number;
  readonly pendingTaskCount: number;
  readonly rejectedInstanceCount: number;
  readonly totalInstanceCount: number;
  readonly unreadNotificationCount: number;
}

interface ApprovalInstancesQueryData {
  readonly approvalInstances: readonly InstanceJsonRecord[];
}

interface ApprovalInstancePageInfoQueryData {
  readonly approvalInstancePageInfo: ApprovalInstancePageInfoRecord;
}

interface WorkflowDashboardSummaryQueryData {
  readonly workflowDashboardSummary: Omit<
    WorkflowDashboardSummaryRecord,
    'unreadNotificationCount'
  >;
}

interface ApprovalInstanceQueryData {
  readonly approvalInstance: InstanceJsonRecord;
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly tasks: readonly TaskRecord[];
  readonly workflowTokens: readonly WorkflowTokenRecord[];
}

interface InboxTasksQueryData {
  readonly inboxTasks: readonly TaskRecord[];
}

interface ApprovalHistoryTasksQueryData {
  readonly approvalHistoryTasks: readonly TaskRecord[];
}

interface TaskDecisionsQueryData {
  readonly taskDecisions: readonly TaskDecisionRecord[];
}

interface AttachmentsQueryData {
  readonly attachments: readonly AttachmentRecord[];
}

interface AttachmentDownloadUrlQueryData {
  readonly attachmentDownloadUrl: string;
}

interface AttachmentPreviewUrlQueryData {
  readonly attachmentPreviewUrl: string;
}

interface SignaturesQueryData {
  readonly signatures: readonly SignatureRecord[];
  readonly verifySignatureChain: SignatureVerificationRecord;
}

interface UploadAttachmentMutationData {
  readonly uploadAttachment: AttachmentRecord;
}

interface MembersQueryData {
  readonly members: readonly MemberProfileRecord[];
}

interface SearchMembersQueryData {
  readonly searchMembers: readonly MemberProfileRecord[];
}

interface MemberDirectoryPageQueryData {
  readonly memberCount: number;
  readonly searchMembers: readonly MemberProfileRecord[];
}

interface DelegationRulesQueryData {
  readonly delegationRules: readonly DelegationRuleRecord[];
}

interface DelegationRulesPageQueryData extends DelegationRulesQueryData {
  readonly delegationRuleCount: number;
}

interface NotificationsQueryData {
  readonly notificationCount: number;
  readonly notifications: readonly NotificationRecord[];
  readonly unreadNotificationCount: number;
}

interface NotificationPreferenceQueryData {
  readonly notificationPreference: NotificationPreferenceRecord;
}

interface CreateDelegationRuleMutationData {
  readonly createDelegationRule: DelegationRuleRecord;
}

interface RevokeDelegationRuleMutationData {
  readonly revokeDelegationRule: DelegationRuleRecord;
}

interface MarkNotificationReadMutationData {
  readonly markNotificationRead: Pick<
    NotificationRecord,
    'id' | 'readAt' | 'status'
  >;
}

interface UpdateNotificationPreferenceMutationData {
  readonly updateNotificationPreference: NotificationPreferenceRecord;
}

interface SubmitApprovalInstanceMutationData {
  readonly submitApprovalInstance: Pick<ApprovalInstanceRecord, 'id'>;
}

interface DecideTaskMutationData {
  readonly decideTask: TaskDecisionRecord;
}

interface CancelApprovalInstanceMutationData {
  readonly cancelApprovalInstance: Pick<ApprovalInstanceRecord, 'id' | 'state'>;
}

interface ResubmitApprovalInstanceMutationData {
  readonly resubmitApprovalInstance: Pick<
    ApprovalInstanceRecord,
    'id' | 'state'
  >;
}

interface LaunchTemplateQueryData {
  readonly approvalTemplate: ApprovalTemplateRecord & {
    readonly updatedAt: string;
  };
  readonly approvalTemplateVersions: readonly ApprovalTemplateVersionRecord[];
  readonly launchableApprovalTemplates?: readonly (ApprovalTemplateRecord & {
    readonly updatedAt: string;
  })[];
}

interface LaunchTemplatesQueryData {
  readonly approvalTemplates?: readonly (ApprovalTemplateRecord & {
    readonly updatedAt: string;
  })[];
  readonly launchableApprovalTemplates?: readonly (ApprovalTemplateRecord & {
    readonly updatedAt: string;
  })[];
}

interface LaunchTemplateVersionsQueryData {
  readonly approvalTemplateVersions: readonly ApprovalTemplateVersionRecord[];
}

interface LaunchFormVersionQueryData {
  readonly formDefinitionVersion: {
    readonly id: string;
    readonly schemaJson: string;
    readonly uiSchemaJson: string;
    readonly version: number;
  };
}

interface InstanceJsonRecord extends Omit<
  ApprovalInstanceRecord,
  | 'formData'
  | 'formDataOptionSnapshot'
  | 'formDataOptionSnapshotJson'
  | 'formDefinitionSnapshot'
  | 'workflowSnapshot'
> {
  readonly formDataJson: string;
  readonly formDataOptionSnapshotJson?: string;
  readonly formDefinitionSnapshotJson: string;
  readonly workflowSnapshotJson: string;
}

export async function listApprovalInstances(): Promise<
  readonly ApprovalInstanceRecord[]
> {
  const data = await requestGraphQl<ApprovalInstancesQueryData>(
    `query ApprovalInstances {
      approvalInstances {
        completedAt
        formDataJson
        formDataOptionSnapshotJson
        formDefinitionSnapshotJson
        id
        initiatorMemberId
        startedAt
        state
        templateId
        templateVersionId
        title
        workflowSnapshotJson
      }
    }`,
  );

  return data.approvalInstances.map(parseInstanceJson);
}

export async function listApprovalInstancesPage({
  page,
  pageSize,
  searchText,
  state,
  templateId,
  view,
}: ApprovalInstancesPageInput): Promise<ApprovalInstancesPageResult> {
  const variables = {
    page,
    pageSize,
    searchText: searchText?.trim() || null,
    state: state ? [state] : null,
    templateId: templateId?.trim() || null,
    view,
  };
  const [pageData, pageInfoData] = await Promise.all([
    requestGraphQl<ApprovalInstancesQueryData>(
      `query ApprovalInstancesPage(
        $view: ApprovalInstanceListView
        $searchText: String
        $state: [ApprovalInstanceState!]
        $templateId: String
        $page: Int
        $pageSize: Int
      ) {
        approvalInstances(
          view: $view
          searchText: $searchText
          state: $state
          templateId: $templateId
          page: $page
          pageSize: $pageSize
        ) {
          completedAt
          formDataJson
          formDataOptionSnapshotJson
          formDefinitionSnapshotJson
          id
          initiatorMemberId
          startedAt
          state
          templateId
          templateVersionId
          title
          workflowSnapshotJson
        }
      }`,
      variables,
    ),
    requestGraphQl<ApprovalInstancePageInfoQueryData>(
      `query ApprovalInstancePageInfo(
        $view: ApprovalInstanceListView
        $searchText: String
        $state: [ApprovalInstanceState!]
        $templateId: String
        $page: Int
        $pageSize: Int
      ) {
        approvalInstancePageInfo(
          view: $view
          searchText: $searchText
          state: $state
          templateId: $templateId
          page: $page
          pageSize: $pageSize
        ) {
          hasNextPage
          hasPreviousPage
          page
          pageSize
          totalCount
          totalPages
        }
      }`,
      variables,
    ),
  ]);
  const pageInfo = pageInfoData.approvalInstancePageInfo;

  return {
    instances: pageData.approvalInstances.map(parseInstanceJson),
    pageInfo,
    totalCount: pageInfo.totalCount,
  };
}

export async function readLaunchContext(
  templateId: string,
): Promise<LaunchContext> {
  const templateData = await requestGraphQl<LaunchTemplateQueryData>(
    `query LaunchTemplate($id: String!) {
      approvalTemplate(id: $id) {
        currentVersionId
        id
        name
      }
      approvalTemplateVersions(templateId: $id) {
        formDefinitionVersionId
        id
        status
        version
      }
      launchableApprovalTemplates {
        currentVersionId
        id
        name
        updatedAt
      }
    }`,
    { id: templateId },
  );
  const templateVersion = templateData.approvalTemplateVersions.find(
    (version) => version.id === templateData.approvalTemplate.currentVersionId,
  );

  if (!templateVersion || templateVersion.status !== 'PUBLISHED') {
    throw new Error('模板尚未發布，無法發起簽核。');
  }

  if (!templateVersion.formDefinitionVersionId) {
    throw new Error('模板尚未綁定表單版本，無法發起簽核。');
  }

  const launchableApprovalTemplates =
    templateData.launchableApprovalTemplates ?? [templateData.approvalTemplate];

  if (
    !launchableApprovalTemplates.some((template) => template.id === templateId)
  ) {
    throw new Error('目前登入者沒有此模板的發起權限。');
  }

  const formData = await requestGraphQl<LaunchFormVersionQueryData>(
    `query LaunchFormVersion($id: String!) {
      formDefinitionVersion(id: $id) {
        id
        schemaJson
        uiSchemaJson
        version
      }
    }`,
    { id: templateVersion.formDefinitionVersionId },
  );

  return {
    formVersion: {
      id: formData.formDefinitionVersion.id,
      schema: JSON.parse(
        formData.formDefinitionVersion.schemaJson,
      ) as FormDefinitionSchema,
      uiSchema: JSON.parse(
        formData.formDefinitionVersion.uiSchemaJson,
      ) as FormUiSchema,
      version: formData.formDefinitionVersion.version,
    },
    template: templateData.approvalTemplate,
    templateVersion,
  };
}

export async function listLaunchableTemplates(): Promise<
  readonly LaunchableTemplateRecord[]
> {
  const templateData = await requestGraphQl<LaunchTemplatesQueryData>(
    `query ApprovalTemplates {
      launchableApprovalTemplates {
        currentVersionId
        id
        name
        updatedAt
      }
    }`,
  );
  const launchableApprovalTemplates =
    templateData.launchableApprovalTemplates ??
    templateData.approvalTemplates ??
    [];
  const versionLists = await Promise.all(
    launchableApprovalTemplates.map((template) =>
      requestGraphQl<LaunchTemplateVersionsQueryData>(
        `query LaunchTemplateVersions($templateId: String!) {
          approvalTemplateVersions(templateId: $templateId) {
            formDefinitionVersionId
            id
            status
            version
          }
        }`,
        { templateId: template.id },
      ),
    ),
  );

  return launchableApprovalTemplates.flatMap((template, index) => {
    const currentVersion = versionLists[index]?.approvalTemplateVersions.find(
      (version) => version.id === template.currentVersionId,
    );

    return currentVersion?.status === 'PUBLISHED' &&
      currentVersion.formDefinitionVersionId
      ? [
          {
            currentVersionId: currentVersion.id,
            formDefinitionVersionId: currentVersion.formDefinitionVersionId,
            id: template.id,
            name: template.name,
            updatedAt: template.updatedAt,
            version: currentVersion.version,
          },
        ]
      : [];
  });
}

export async function readApprovalInstance(instanceId: string): Promise<{
  readonly activityLogs: readonly ActivityLogRecord[];
  readonly instance: ApprovalInstanceRecord;
  readonly tasks: readonly TaskRecord[];
  readonly workflowTokens: readonly WorkflowTokenRecord[];
}> {
  const data = await requestGraphQl<ApprovalInstanceQueryData>(
    `query ApprovalInstance($id: String!) {
      approvalInstance(id: $id) {
        completedAt
        formDataJson
        formDataOptionSnapshotJson
        formDefinitionSnapshotJson
        id
        initiatorMemberId
        startedAt
        state
        templateId
        templateVersionId
        title
        workflowSnapshotJson
      }
      tasks(instanceId: $id) {
        adhocDirectiveId
        adhocOriginTaskId
        adhocType
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
        isAdhoc
        nodeId
        openedAt
        originalAssigneeMemberId
        slaDueAt
        status
        tokenId
      }
      workflowTokens(instanceId: $id) {
        consumedAt
        createdAt
        currentNodeId
        id
        instanceId
        parentTokenId
        status
      }
      activityLogs(instanceId: $id) {
        actorMemberId
        createdAt
        eventType
        id
        nodeId
        payloadJson
        taskId
      }
    }`,
    { id: instanceId },
  );

  return {
    activityLogs: data.activityLogs,
    instance: parseInstanceJson(data.approvalInstance),
    tasks: normalizeTaskRecords(data.tasks),
    workflowTokens: data.workflowTokens,
  };
}

export async function listInboxTasks(
  assigneeMemberId: string,
): Promise<readonly TaskRecord[]> {
  const data = await requestGraphQl<InboxTasksQueryData>(
    `query InboxTasks($assigneeMemberId: String!) {
      inboxTasks(assigneeMemberId: $assigneeMemberId) {
        adhocDirectiveId
        adhocOriginTaskId
        adhocType
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
        isAdhoc
        nodeId
        openedAt
        originalAssigneeMemberId
        slaDueAt
        status
        tokenId
      }
    }`,
    { assigneeMemberId },
  );

  return normalizeTaskRecords(data.inboxTasks);
}

export async function listApprovalHistoryTasks(
  assigneeMemberId: string,
): Promise<readonly TaskRecord[]> {
  const data = await requestGraphQl<ApprovalHistoryTasksQueryData>(
    `query ApprovalHistoryTasks($assigneeMemberId: String!) {
      approvalHistoryTasks(assigneeMemberId: $assigneeMemberId) {
        adhocDirectiveId
        adhocOriginTaskId
        adhocType
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
        isAdhoc
        nodeId
        openedAt
        originalAssigneeMemberId
        slaDueAt
        status
        tokenId
      }
    }`,
    { assigneeMemberId },
  );

  return normalizeTaskRecords(data.approvalHistoryTasks);
}

export async function readWorkflowDashboardSummary({
  currentMemberId,
  from,
  to,
}: {
  readonly currentMemberId: string;
  readonly from: string | null;
  readonly to: string | null;
}): Promise<WorkflowDashboardSummaryRecord> {
  const [summaryData, notificationResult] = await Promise.all([
    requestGraphQl<WorkflowDashboardSummaryQueryData>(
      `query WorkflowDashboardSummary($from: DateTime, $to: DateTime) {
        workflowDashboardSummary(from: $from, to: $to) {
          activeInstanceCount
          completedInstanceCount
          overdueTaskCount
          pendingTaskCount
          rejectedInstanceCount
          totalInstanceCount
        }
      }`,
      { from, to },
    ),
    listNotifications({
      includeRead: true,
      page: 1,
      pageSize: 1,
      recipientMemberId: currentMemberId,
    }),
  ]);

  return {
    ...summaryData.workflowDashboardSummary,
    unreadNotificationCount: notificationResult.unreadCount,
  };
}

function normalizeTaskRecords(
  tasks: readonly TaskRecord[],
): readonly TaskRecord[] {
  return tasks.map((task) => ({
    ...task,
    adhocDirectiveId: task.adhocDirectiveId ?? null,
    adhocOriginTaskId: task.adhocOriginTaskId ?? null,
    adhocType: task.adhocType ?? null,
    assignmentType: task.assignmentType ?? 'DIRECT_MEMBER',
    candidateMemberIds: task.candidateMemberIds ?? [],
    decisionPolicySnapshotJson:
      task.decisionPolicySnapshotJson ?? JSON.stringify({ type: 'SINGLE' }),
    isAdhoc: task.isAdhoc ?? false,
  }));
}

export async function listTaskDecisions(
  taskId: string,
): Promise<readonly TaskDecisionRecord[]> {
  const data = await requestGraphQl<TaskDecisionsQueryData>(
    `query TaskDecisions($taskId: String!) {
      taskDecisions(taskId: $taskId) {
        action
        comment
        decidedAt
        decidedByMemberId
        id
        returnToNodeId
        signatureId
        taskId
        transferToMemberId
      }
    }`,
    { taskId },
  );

  return data.taskDecisions;
}

export async function listAttachments(
  instanceId: string,
): Promise<readonly AttachmentRecord[]> {
  const data = await requestGraphQl<AttachmentsQueryData>(
    `query InstanceAttachments($instanceId: String!) {
      attachments(instanceId: $instanceId) {
        checksumSha256
        createdAt
        filename
        formFieldPath
        id
        instanceId
        mimeType
        sizeBytes
        storageKey
        storageProvider
        taskId
        uploaderMemberId
      }
    }`,
    { instanceId },
  );

  return data.attachments ?? [];
}

export async function uploadAttachment({
  file,
  formFieldPath,
}: {
  readonly file: File;
  readonly formFieldPath: string;
}): Promise<AttachmentRecord> {
  const contentBase64 = await readFileBase64(file);
  const checksumSha256 = await hashFileSha256(file);
  const data = await requestGraphQl<UploadAttachmentMutationData>(
    `mutation UploadAttachment($input: UploadAttachmentInput!) {
      uploadAttachment(input: $input) {
        checksumSha256
        createdAt
        filename
        formFieldPath
        id
        instanceId
        mimeType
        sizeBytes
        storageKey
        storageProvider
        taskId
        uploaderMemberId
      }
    }`,
    {
      input: {
        checksumSha256,
        contentBase64,
        filename: file.name,
        formFieldPath,
        instanceId: null,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        taskId: null,
      },
    },
  );

  return data.uploadAttachment;
}

export async function readAttachmentDownloadUrl({
  id,
}: {
  readonly id: string;
}): Promise<string> {
  const data = await requestGraphQl<AttachmentDownloadUrlQueryData>(
    `query AttachmentDownloadUrl($id: String!) {
      attachmentDownloadUrl(id: $id)
    }`,
    { id },
  );

  return data.attachmentDownloadUrl;
}

export async function readAttachmentPreviewUrl({
  id,
}: {
  readonly id: string;
}): Promise<string> {
  const data = await requestGraphQl<AttachmentPreviewUrlQueryData>(
    `query AttachmentPreviewUrl($id: String!) {
      attachmentPreviewUrl(id: $id)
    }`,
    { id },
  );

  return data.attachmentPreviewUrl;
}

export async function readInstanceSignatures(instanceId: string): Promise<{
  readonly signatures: readonly SignatureRecord[];
  readonly verification: SignatureVerificationRecord;
}> {
  const data = await requestGraphQl<SignaturesQueryData>(
    `query InstanceSignatures($instanceId: String!) {
      signatures(instanceId: $instanceId) {
        algorithm
        id
        instanceId
        keyVersion
        previousSignatureHash
        signature
        signedAt
        signedPayloadHash
        signedPayloadJson
        signerMemberId
        taskId
        timestampTokenBase64
      }
      verifySignatureChain(instanceId: $instanceId) {
        checkedCount
        errors
        instanceId
        valid
      }
    }`,
    { instanceId },
  );

  return {
    signatures: data.signatures ?? [],
    verification: data.verifySignatureChain ?? {
      checkedCount: 0,
      errors: [],
      instanceId,
      valid: true,
    },
  };
}

export async function resolveMemberProfiles(
  memberIds: readonly string[],
): Promise<readonly MemberProfileRecord[]> {
  if (memberIds.length === 0) {
    return [];
  }

  const data = await requestGraphQl<MembersQueryData>(
    `query InstanceMembers($memberIds: [String!]!) {
      members(memberIds: $memberIds) {
        email
        memberId
        name
      }
    }`,
    { memberIds },
  );

  return data.members;
}

export async function searchMembers(
  searchText: string,
): Promise<readonly MemberProfileRecord[]> {
  const data = await requestGraphQl<SearchMembersQueryData>(
    `query SearchMembers($searchText: String!) {
      searchMembers(searchText: $searchText) {
        email
        memberId
        name
      }
    }`,
    { searchText },
  );

  return data.searchMembers;
}

export async function listMemberDirectoryPage({
  page,
  pageSize,
  searchText = '',
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly searchText?: string;
}): Promise<MemberDirectoryPage> {
  const data = await requestGraphQl<MemberDirectoryPageQueryData>(
    `query MemberDirectoryPage($page: Int, $pageSize: Int, $searchText: String!) {
      searchMembers(page: $page, pageSize: $pageSize, searchText: $searchText) {
        email
        memberId
        name
      }
      memberCount(searchText: $searchText)
    }`,
    { page, pageSize, searchText },
  );

  return {
    members: data.searchMembers,
    totalCount: data.memberCount,
  };
}

export async function listDelegationRules({
  includeInactive = true,
  principalMemberId = null,
}: {
  readonly includeInactive?: boolean;
  readonly principalMemberId?: string | null;
} = {}): Promise<readonly DelegationRuleRecord[]> {
  const data = await requestGraphQl<DelegationRulesQueryData>(
    `query DelegationRules($includeInactive: Boolean, $principalMemberId: String) {
      delegationRules(
        includeInactive: $includeInactive
        principalMemberId: $principalMemberId
      ) {
        agentMemberId
        createdAt
        createdByMemberId
        endAt
        id
        principalMemberId
        priority
        requiresConfirmation
        revokedAt
        revokedByMemberId
        scopeConditionCel
        scopeTemplateIds
        scopeType
        startAt
        status
        updatedAt
      }
    }`,
    { includeInactive, principalMemberId },
  );

  return data.delegationRules;
}

export async function listDelegationRulesPage({
  agentMemberId = null,
  includeInactive = true,
  page = 1,
  pageSize = 10,
  principalMemberId = null,
  scopeType = null,
  status = null,
}: {
  readonly agentMemberId?: string | null;
  readonly includeInactive?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  readonly principalMemberId?: string | null;
  readonly scopeType?: DelegationScopeType | null;
  readonly status?: DelegationRuleStatus | null;
} = {}): Promise<{
  readonly rules: readonly DelegationRuleRecord[];
  readonly totalCount: number;
}> {
  const data = await requestGraphQl<DelegationRulesPageQueryData>(
    `query DelegationRulesPage(
      $includeInactive: Boolean
      $page: Int
      $pageSize: Int
      $principalMemberId: String
      $agentMemberId: String
      $scopeType: DelegationScopeType
      $status: DelegationRuleStatus
    ) {
      delegationRules(
        agentMemberId: $agentMemberId
        includeInactive: $includeInactive
        page: $page
        pageSize: $pageSize
        principalMemberId: $principalMemberId
        scopeType: $scopeType
        status: $status
      ) {
        agentMemberId
        createdAt
        createdByMemberId
        endAt
        id
        principalMemberId
        priority
        requiresConfirmation
        revokedAt
        revokedByMemberId
        scopeConditionCel
        scopeTemplateIds
        scopeType
        startAt
        status
        updatedAt
      }
      delegationRuleCount(
        agentMemberId: $agentMemberId
        includeInactive: $includeInactive
        principalMemberId: $principalMemberId
        scopeType: $scopeType
        status: $status
      )
    }`,
    {
      agentMemberId,
      includeInactive,
      page,
      pageSize,
      principalMemberId,
      scopeType,
      status,
    },
  );

  return {
    rules: data.delegationRules,
    totalCount: data.delegationRuleCount,
  };
}

export async function createDelegationRule(input: {
  readonly agentMemberId: string;
  readonly createdByMemberId: string | null;
  readonly endAt: string | null;
  readonly principalMemberId: string;
  readonly priority: number;
  readonly requiresConfirmation: boolean;
  readonly scopeConditionCel: string | null;
  readonly scopeTemplateIds: readonly string[];
  readonly scopeType: DelegationScopeType;
  readonly startAt: string | null;
}): Promise<DelegationRuleRecord> {
  const data = await requestGraphQl<CreateDelegationRuleMutationData>(
    `mutation CreateDelegationRule($input: CreateDelegationRuleInput!) {
      createDelegationRule(input: $input) {
        agentMemberId
        createdAt
        createdByMemberId
        endAt
        id
        principalMemberId
        priority
        requiresConfirmation
        revokedAt
        revokedByMemberId
        scopeConditionCel
        scopeTemplateIds
        scopeType
        startAt
        status
        updatedAt
      }
    }`,
    { input },
  );

  return data.createDelegationRule;
}

export async function revokeDelegationRule({
  id,
  revokedByMemberId,
}: {
  readonly id: string;
  readonly revokedByMemberId: string | null;
}): Promise<DelegationRuleRecord> {
  const data = await requestGraphQl<RevokeDelegationRuleMutationData>(
    `mutation RevokeDelegationRule($id: String!, $revokedByMemberId: String) {
      revokeDelegationRule(id: $id, revokedByMemberId: $revokedByMemberId) {
        agentMemberId
        createdAt
        createdByMemberId
        endAt
        id
        principalMemberId
        priority
        requiresConfirmation
        revokedAt
        revokedByMemberId
        scopeConditionCel
        scopeTemplateIds
        scopeType
        startAt
        status
        updatedAt
      }
    }`,
    { id, revokedByMemberId },
  );

  return data.revokeDelegationRule;
}

export async function listNotifications({
  includeArchived = false,
  includeRead = true,
  page = 1,
  pageSize = 10,
  recipientMemberId,
}: {
  readonly includeArchived?: boolean;
  readonly includeRead?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  readonly recipientMemberId: string;
}): Promise<{
  readonly notifications: readonly NotificationRecord[];
  readonly totalCount: number;
  readonly unreadCount: number;
}> {
  const data = await requestGraphQl<NotificationsQueryData>(
    `query Notifications(
      $recipientMemberId: String!
      $includeRead: Boolean
      $includeArchived: Boolean
      $page: Int
      $pageSize: Int
    ) {
      notifications(
        includeArchived: $includeArchived
        includeRead: $includeRead
        page: $page
        pageSize: $pageSize
        recipientMemberId: $recipientMemberId
      ) {
        actionable
        allowReject
        archivedAt
        attemptCount
        body
        channel
        createdAt
        deliveredAt
        deliveryError
        deliveryTarget
        id
        instanceId
        lastAttemptAt
        nextRetryAt
        payloadJson
        readAt
        recipientMemberId
        resolution
        resolvedAt
        sentAt
        silenced
        status
        taskId
        title
        type
      }
      notificationCount(
        includeArchived: $includeArchived
        includeRead: $includeRead
        recipientMemberId: $recipientMemberId
      )
      unreadNotificationCount(recipientMemberId: $recipientMemberId)
    }`,
    { includeArchived, includeRead, page, pageSize, recipientMemberId },
  );

  return {
    notifications: data.notifications,
    totalCount: data.notificationCount,
    unreadCount: data.unreadNotificationCount,
  };
}

export async function readUnreadNotificationCount(
  recipientMemberId: string,
): Promise<number> {
  const data = await requestGraphQl<{
    readonly unreadNotificationCount: number;
  }>(
    `query UnreadNotificationCount($recipientMemberId: String!) {
      unreadNotificationCount(recipientMemberId: $recipientMemberId)
    }`,
    { recipientMemberId },
  );

  return data.unreadNotificationCount;
}

export async function markNotificationRead({
  id,
  readerMemberId,
}: {
  readonly id: string;
  readonly readerMemberId: string;
}): Promise<Pick<NotificationRecord, 'id' | 'readAt' | 'status'>> {
  const data = await requestGraphQl<MarkNotificationReadMutationData>(
    `mutation MarkNotificationRead($id: String!, $readerMemberId: String) {
      markNotificationRead(id: $id, readerMemberId: $readerMemberId) {
        id
        readAt
        status
      }
    }`,
    { id, readerMemberId },
  );

  return data.markNotificationRead;
}

export async function markAllNotificationsRead({
  recipientMemberId,
}: {
  readonly recipientMemberId: string;
}): Promise<number> {
  const data = await requestGraphQl<{
    readonly markAllNotificationsRead: number;
  }>(
    `mutation MarkAllNotificationsRead($recipientMemberId: String) {
      markAllNotificationsRead(recipientMemberId: $recipientMemberId)
    }`,
    { recipientMemberId },
  );

  return data.markAllNotificationsRead;
}

export async function archiveNotifications({
  ids,
}: {
  readonly ids: readonly string[];
}): Promise<number> {
  const data = await requestGraphQl<{
    readonly archiveNotifications: number;
  }>(
    `mutation ArchiveNotifications($ids: [String!]!) {
      archiveNotifications(ids: $ids)
    }`,
    { ids },
  );

  return data.archiveNotifications;
}

export async function unarchiveNotifications({
  ids,
}: {
  readonly ids: readonly string[];
}): Promise<number> {
  const data = await requestGraphQl<{
    readonly unarchiveNotifications: number;
  }>(
    `mutation UnarchiveNotifications($ids: [String!]!) {
      unarchiveNotifications(ids: $ids)
    }`,
    { ids },
  );

  return data.unarchiveNotifications;
}

export async function readNotificationPreference(
  memberId: string,
): Promise<NotificationPreferenceRecord> {
  const data = await requestGraphQl<NotificationPreferenceQueryData>(
    `query NotificationPreference($memberId: String!) {
      notificationPreference(memberId: $memberId) {
        emailDigestMode
        emailEnabled
        inAppEnabled
        memberId
        quietHoursEnd
        quietHoursStart
        updatedAt
      }
    }`,
    { memberId },
  );

  return data.notificationPreference;
}

export async function updateNotificationPreference(input: {
  readonly emailDigestMode: NotificationDigestMode;
  readonly emailEnabled: boolean;
  readonly inAppEnabled: boolean;
  readonly memberId: string;
  readonly quietHoursEnd: string | null;
  readonly quietHoursStart: string | null;
}): Promise<NotificationPreferenceRecord> {
  const data = await requestGraphQl<UpdateNotificationPreferenceMutationData>(
    `mutation UpdateNotificationPreference($input: UpdateNotificationPreferenceInput!) {
        updateNotificationPreference(input: $input) {
          emailDigestMode
          emailEnabled
          inAppEnabled
          memberId
          quietHoursEnd
          quietHoursStart
          updatedAt
        }
      }`,
    { input },
  );

  return data.updateNotificationPreference;
}

export async function submitApprovalInstance({
  formData,
  initiatorMemberId,
  templateId,
  title,
}: {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly templateId: string;
  readonly title: string | null;
}): Promise<string> {
  const data = await requestGraphQl<SubmitApprovalInstanceMutationData>(
    `mutation SubmitApprovalInstance($input: SubmitApprovalInstanceInput!) {
      submitApprovalInstance(input: $input) {
        id
      }
    }`,
    {
      input: {
        formDataJson: JSON.stringify(formData),
        initiatorMemberId,
        initiatorMetadataSnapshotJson: null,
        templateId,
        title,
      },
    },
  );

  return data.submitApprovalInstance.id;
}

export async function decideTask({
  action,
  comment,
  decidedByMemberId,
  returnToNodeId = null,
  taskId,
  transferToMemberId = null,
}: {
  readonly action: TaskDecisionAction;
  readonly comment: string | null;
  readonly decidedByMemberId: string;
  readonly returnToNodeId?: string | null;
  readonly taskId: string;
  readonly transferToMemberId?: string | null;
}): Promise<TaskDecisionRecord> {
  const data = await requestGraphQl<DecideTaskMutationData>(
    `mutation DecideTask($input: DecideTaskInput!) {
      decideTask(input: $input) {
        action
        comment
        decidedAt
        decidedByMemberId
        id
        returnToNodeId
        signatureId
        taskId
        transferToMemberId
      }
    }`,
    {
      input: {
        action,
        comment,
        decidedByMemberId,
        returnToNodeId,
        taskId,
        transferToMemberId,
      },
    },
  );

  return data.decideTask;
}

export async function cancelApprovalInstance({
  cancelledByMemberId,
  comment,
  instanceId,
}: {
  readonly cancelledByMemberId: string;
  readonly comment: string | null;
  readonly instanceId: string;
}): Promise<void> {
  await requestGraphQl<CancelApprovalInstanceMutationData>(
    `mutation CancelApprovalInstance($input: CancelApprovalInstanceInput!) {
      cancelApprovalInstance(input: $input) {
        id
        state
      }
    }`,
    {
      input: {
        cancelledByMemberId,
        comment,
        instanceId,
      },
    },
  );
}

export async function resubmitApprovalInstance({
  formData,
  initiatorMemberId,
  instanceId,
  title,
}: {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly instanceId: string;
  readonly title: string | null;
}): Promise<void> {
  await requestGraphQl<ResubmitApprovalInstanceMutationData>(
    `mutation ResubmitApprovalInstance($input: ResubmitApprovalInstanceInput!) {
      resubmitApprovalInstance(input: $input) {
        id
        state
      }
    }`,
    {
      input: {
        formDataJson: JSON.stringify(formData),
        initiatorMemberId,
        instanceId,
        title,
      },
    },
  );
}

const ADHOC_DIRECTIVE_FIELDS = `
  channels
  comment
  consumedAt
  createdAt
  createdByMemberId
  id
  instanceId
  onReject
  originNodeId
  originTaskId
  status
  targetKind
  targetValueJson
  type
`;

const ADHOC_TASK_FIELDS = `
  adhocDirectiveId
  adhocOriginTaskId
  adhocType
  assigneeMemberId
  assignmentType
  candidateMemberIds
  completedAt
  createdAt
  decisionPolicySnapshotJson
  delegationChainJson
  id
  instanceId
  isAdhoc
  nodeId
  openedAt
  originalAssigneeMemberId
  slaDueAt
  status
  tokenId
`;

interface RequestAdhocCountersignMutationData {
  readonly requestAdhocCountersign: AdhocDirectiveRecord;
}

interface RequestAdhocPreApprovalMutationData {
  readonly requestAdhocPreApproval: TaskRecord;
}

interface ConfigureAdhocStageNotificationMutationData {
  readonly configureAdhocStageNotification: AdhocDirectiveRecord;
}

interface ConfigureAdhocCompletionNotificationMutationData {
  readonly configureAdhocCompletionNotification: AdhocDirectiveRecord;
}

interface CancelAdhocDirectiveMutationData {
  readonly cancelAdhocDirective: AdhocDirectiveRecord;
}

interface AdhocDirectivesQueryData {
  readonly adhocDirectives: readonly AdhocDirectiveRecord[];
}

function buildAdhocTargetInput(
  target: AdhocTargetOptions,
): Readonly<Record<string, unknown>> {
  return {
    includeDescendants: target.includeDescendants ?? null,
    kind: target.kind,
    memberIds: target.memberIds ? [...target.memberIds] : null,
    orgUnitId: target.orgUnitId ?? null,
    positionId: target.positionId ?? null,
    webhookHeadersJson: target.webhookHeaders
      ? JSON.stringify(target.webhookHeaders)
      : null,
    webhookUrl: target.webhookUrl ?? null,
  };
}

/**
 * Ad-hoc countersign (臨時會簽): asks the given target to co-sign the NEXT
 * stage of this instance. When the next user task is created, a parallel
 * ad-hoc task is spawned for the target, and the flow only advances past
 * that stage once BOTH the original task and every countersign task are
 * approved. A countersigner's rejection rejects the whole instance.
 *
 * Only the current task's assignee/candidate may call this, and only on
 * nodes whose template sets `allowAddSigner: true`. Returns the recorded
 * directive (`PENDING` until the next user task consumes it; withdrawable
 * via {@link cancelAdhocDirective} while pending). Never alters the
 * workflow template.
 */
export async function requestAdhocCountersign({
  comment = null,
  target,
  taskId,
}: {
  readonly comment?: string | null;
  readonly target: AdhocTargetOptions;
  readonly taskId: string;
}): Promise<AdhocDirectiveRecord> {
  const data = await requestGraphQl<RequestAdhocCountersignMutationData>(
    `mutation RequestAdhocCountersign($taskId: ID!, $target: AdhocTargetInput!, $comment: String) {
      requestAdhocCountersign(taskId: $taskId, target: $target, comment: $comment) {
        ${ADHOC_DIRECTIVE_FIELDS}
      }
    }`,
    { comment, target: buildAdhocTargetInput(target), taskId },
  );

  return data.requestAdhocCountersign;
}

/**
 * Ad-hoc pre-approval (臨時加簽): immediately spawns a blocking ad-hoc task
 * for the given target on the CURRENT stage. Even after the original
 * approver approves, the flow stays on this stage until the pre-approver
 * also approves. `onReject` decides what happens when the pre-approver
 * rejects: `REJECT_INSTANCE` rejects the whole instance;
 * `RETURN_TO_ORIGIN` hands the decision back to the original approver
 * (re-opening their task if they had already approved).
 *
 * Only the current task's assignee/candidate may call this, and only on
 * nodes whose template sets `allowAddSigner: true`. Returns the spawned
 * ad-hoc task. Never alters the workflow template.
 */
export async function requestAdhocPreApproval({
  comment = null,
  onReject,
  target,
  taskId,
}: {
  readonly comment?: string | null;
  readonly onReject: AdhocPreApprovalRejectBehavior;
  readonly target: AdhocTargetOptions;
  readonly taskId: string;
}): Promise<TaskRecord> {
  const data = await requestGraphQl<RequestAdhocPreApprovalMutationData>(
    `mutation RequestAdhocPreApproval($taskId: ID!, $target: AdhocTargetInput!, $onReject: AdhocPreApprovalRejectBehavior!, $comment: String) {
      requestAdhocPreApproval(taskId: $taskId, target: $target, onReject: $onReject, comment: $comment) {
        ${ADHOC_TASK_FIELDS}
      }
    }`,
    {
      comment,
      onReject,
      target: buildAdhocTargetInput(target),
      taskId,
    },
  );

  return data.requestAdhocPreApproval;
}

/**
 * Ad-hoc stage notification (臨時階段通知): notifies the target once the
 * CURRENT stage ends — regardless of outcome (approved, rejected, or
 * returned). Targets may be members, a position, an org unit, or a webhook
 * URL. `channels` defaults to in-app notification.
 *
 * Available to the current task's assignee/candidate on any user-task node
 * (no `allowAddSigner` requirement). Returns the recorded directive
 * (withdrawable via {@link cancelAdhocDirective} while pending). Never
 * alters the workflow template.
 */
export async function configureAdhocStageNotification({
  channels = null,
  target,
  taskId,
}: {
  readonly channels?: readonly NotificationChannel[] | null;
  readonly target: AdhocTargetOptions;
  readonly taskId: string;
}): Promise<AdhocDirectiveRecord> {
  const data =
    await requestGraphQl<ConfigureAdhocStageNotificationMutationData>(
      `mutation ConfigureAdhocStageNotification($taskId: ID!, $input: AdhocNotificationInput!) {
        configureAdhocStageNotification(taskId: $taskId, input: $input) {
          ${ADHOC_DIRECTIVE_FIELDS}
        }
      }`,
      {
        input: {
          channels: channels ? [...channels] : null,
          target: buildAdhocTargetInput(target),
        },
        taskId,
      },
    );

  return data.configureAdhocStageNotification;
}

/**
 * Ad-hoc completion notification (臨時完成通知): notifies the target once
 * the WHOLE instance reaches a terminal state (`APPROVED`, `REJECTED`, or
 * `CANCELLED`). Targets may be members, a position, an org unit, or a
 * webhook URL. `channels` defaults to in-app notification.
 *
 * Available to the current task's assignee/candidate on any user-task node
 * (no `allowAddSigner` requirement). Returns the recorded directive
 * (withdrawable via {@link cancelAdhocDirective} while pending). Never
 * alters the workflow template.
 */
export async function configureAdhocCompletionNotification({
  channels = null,
  target,
  taskId,
}: {
  readonly channels?: readonly NotificationChannel[] | null;
  readonly target: AdhocTargetOptions;
  readonly taskId: string;
}): Promise<AdhocDirectiveRecord> {
  const data =
    await requestGraphQl<ConfigureAdhocCompletionNotificationMutationData>(
      `mutation ConfigureAdhocCompletionNotification($taskId: ID!, $input: AdhocNotificationInput!) {
        configureAdhocCompletionNotification(taskId: $taskId, input: $input) {
          ${ADHOC_DIRECTIVE_FIELDS}
        }
      }`,
      {
        input: {
          channels: channels ? [...channels] : null,
          target: buildAdhocTargetInput(target),
        },
        taskId,
      },
    );

  return data.configureAdhocCompletionNotification;
}

/**
 * Withdraws a still-`PENDING` ad-hoc directive (countersign / stage-notify /
 * completion-notify) before it takes effect. Only the directive's creator
 * may withdraw it; pre-approval directives are consumed immediately on
 * creation and therefore cannot be withdrawn.
 */
export async function cancelAdhocDirective(
  directiveId: string,
): Promise<AdhocDirectiveRecord> {
  const data = await requestGraphQl<CancelAdhocDirectiveMutationData>(
    `mutation CancelAdhocDirective($directiveId: ID!) {
      cancelAdhocDirective(directiveId: $directiveId) {
        ${ADHOC_DIRECTIVE_FIELDS}
      }
    }`,
    { directiveId },
  );

  return data.cancelAdhocDirective;
}

/**
 * Lists every ad-hoc directive recorded on one approval instance, ordered by
 * creation time. Use the `status` field to find directives that are still
 * pending (withdrawable) versus already consumed or cancelled.
 */
export async function listAdhocDirectives(
  instanceId: string,
): Promise<readonly AdhocDirectiveRecord[]> {
  const data = await requestGraphQl<AdhocDirectivesQueryData>(
    `query AdhocDirectives($instanceId: String!) {
      adhocDirectives(instanceId: $instanceId) {
        ${ADHOC_DIRECTIVE_FIELDS}
      }
    }`,
    { instanceId },
  );

  // Tolerate hosts (and test mocks) whose GraphQL layer does not answer the
  // adhocDirectives query yet.
  return data.adhocDirectives ?? [];
}

export function readApprovalInstanceCaseTitle(
  instance: ApprovalInstanceRecord,
): string {
  return readFormDataCaseTitle({
    fallbackTitle: instance.title || instance.id,
    formData: instance.formData,
    schema: instance.formDefinitionSnapshot.schema ?? null,
    uiSchema: instance.formDefinitionSnapshot.uiSchema ?? null,
  });
}

export function readFormDataCaseTitle({
  fallbackTitle,
  formData,
  schema,
  uiSchema,
}: {
  readonly fallbackTitle: string;
  readonly formData: WorkflowFormData;
  readonly schema: FormDefinitionSchema | null;
  readonly uiSchema: FormUiSchema | null;
}): string {
  const firstField = readFirstCaseTitleField(schema, uiSchema);

  if (!firstField) {
    return fallbackTitle;
  }

  const valueLabel = readFieldValueLabel(
    firstField,
    formData[firstField.fieldKey],
  );

  return valueLabel ? `${firstField.label}：${valueLabel}` : fallbackTitle;
}

function parseInstanceJson(record: InstanceJsonRecord): ApprovalInstanceRecord {
  return {
    ...record,
    formData: JSON.parse(record.formDataJson) as WorkflowFormData,
    formDataOptionSnapshotJson: record.formDataOptionSnapshotJson ?? '{}',
    formDataOptionSnapshot: JSON.parse(
      record.formDataOptionSnapshotJson ?? '{}',
    ) as FormDataSourceValueSnapshots,
    formDefinitionSnapshot: JSON.parse(
      record.formDefinitionSnapshotJson,
    ) as FormDefinitionSnapshot,
    workflowSnapshot: JSON.parse(
      record.workflowSnapshotJson,
    ) as WorkflowDefinition,
  };
}

async function readFileBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks = Array.from(
    { length: Math.ceil(bytes.length / chunkSize) },
    (_, index): string =>
      String.fromCharCode(
        ...bytes.slice(index * chunkSize, (index + 1) * chunkSize),
      ),
  );

  return btoa(chunks.join(''));
}

async function hashFileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  const bytes = Array.from(new Uint8Array(digest));

  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readFirstCaseTitleField(
  schema: FormDefinitionSchema | null,
  uiSchema: FormUiSchema | null,
): FormFieldDefinition | null {
  if (!schema?.fields.length) {
    return null;
  }

  const fieldsByKey = new Map(
    schema.fields.map((field) => [field.fieldKey, field]),
  );
  const firstLayoutField = uiSchema?.layout
    .map((layoutItem) => fieldsByKey.get(layoutItem.fieldKey) ?? null)
    .find((field): field is FormFieldDefinition => Boolean(field));

  return firstLayoutField ?? schema.fields[0] ?? null;
}

function readFieldValueLabel(
  field: FormFieldDefinition,
  value: FormFieldValue | undefined,
): string | null {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return readArrayFieldValueLabel(field, value);
  }

  if (field.type === 'boolean') {
    return value === true ? '是' : '否';
  }

  if (isSelectFieldDefinition(field) && typeof value === 'string') {
    return readSelectOptionLabel(field, value);
  }

  const valueLabel = String(value).trim();

  return valueLabel || null;
}

function readArrayFieldValueLabel(
  field: FormFieldDefinition,
  value: readonly string[],
): string | null {
  const labels = isSelectFieldDefinition(field)
    ? value.map((item) => readSelectOptionLabel(field, item))
    : value;
  const label = labels.filter((item) => item.trim()).join('、');

  return label || null;
}

function readSelectOptionLabel(
  field: FormStaticOptionFieldDefinition,
  value: string,
): string {
  return (
    field.options.find((option) => option.value === value)?.label ?? value
  ).trim();
}

function isSelectFieldDefinition(
  field: FormFieldDefinition,
): field is FormStaticOptionFieldDefinition {
  return isFormStaticOptionFieldDefinition(field);
}
