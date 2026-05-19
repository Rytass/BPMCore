import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  FormUiSchema,
  SelectFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { requestGraphQl } from '../../_lib/graphql-client';

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

export interface ApprovalInstanceRecord {
  readonly completedAt: string | null;
  readonly formData: WorkflowFormData;
  readonly formDataJson: string;
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
  readonly assigneeMemberId: string | null;
  readonly assignmentType: TaskAssignmentType;
  readonly candidateMemberIds: readonly string[];
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly decisionPolicySnapshotJson: string;
  readonly delegationChainJson: string;
  readonly id: string;
  readonly instanceId: string;
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

export interface NotificationRecord {
  readonly attemptCount: number;
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
  readonly sentAt: string | null;
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
  'formData' | 'formDefinitionSnapshot' | 'workflowSnapshot'
> {
  readonly formDataJson: string;
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
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
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
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
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
        assigneeMemberId
        assignmentType
        candidateMemberIds
        completedAt
        createdAt
        decisionPolicySnapshotJson
        delegationChainJson
        id
        instanceId
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
    assignmentType: task.assignmentType ?? 'DIRECT_MEMBER',
    candidateMemberIds: task.candidateMemberIds ?? [],
    decisionPolicySnapshotJson:
      task.decisionPolicySnapshotJson ?? JSON.stringify({ type: 'SINGLE' }),
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
  includeRead = true,
  page = 1,
  pageSize = 10,
  recipientMemberId,
}: {
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
      $page: Int
      $pageSize: Int
    ) {
      notifications(
        includeRead: $includeRead
        page: $page
        pageSize: $pageSize
        recipientMemberId: $recipientMemberId
      ) {
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
        sentAt
        status
        taskId
        title
        type
      }
      notificationCount(
        includeRead: $includeRead
        recipientMemberId: $recipientMemberId
      )
      unreadNotificationCount(recipientMemberId: $recipientMemberId)
    }`,
    { includeRead, page, pageSize, recipientMemberId },
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
  field: SelectFieldDefinition,
  value: string,
): string {
  return (
    field.options.find((option) => option.value === value)?.label ?? value
  ).trim();
}

function isSelectFieldDefinition(
  field: FormFieldDefinition,
): field is SelectFieldDefinition {
  return (
    field.type === 'select' ||
    field.type === 'radio' ||
    field.type === 'checkbox'
  );
}
