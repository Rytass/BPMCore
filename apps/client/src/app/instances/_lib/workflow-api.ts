import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  FormUiSchema,
  SelectFieldDefinition,
} from '@bpm/shared/form';
import { WorkflowDefinition } from '@bpm/shared/workflow';

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:17601/graphql';

export const CURRENT_MEMBER_ID = 'member-001';

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
  readonly assigneeMemberId: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly delegationChainJson: string;
  readonly id: string;
  readonly instanceId: string;
  readonly nodeId: string;
  readonly openedAt: string | null;
  readonly originalAssigneeMemberId: string;
  readonly slaDueAt: string | null;
  readonly status: TaskStatus;
  readonly tokenId: string;
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
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly createdAt: string;
  readonly id: string;
  readonly instanceId: string | null;
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

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

interface ApprovalInstancesQueryData {
  readonly approvalInstances: readonly InstanceJsonRecord[];
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

interface MembersQueryData {
  readonly members: readonly MemberProfileRecord[];
}

interface SearchMembersQueryData {
  readonly searchMembers: readonly MemberProfileRecord[];
}

interface DelegationRulesQueryData {
  readonly delegationRules: readonly DelegationRuleRecord[];
}

interface NotificationsQueryData {
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
  readonly markNotificationRead: NotificationRecord;
}

interface UpdateNotificationPreferenceMutationData {
  readonly updateNotificationPreference: NotificationPreferenceRecord;
}

interface SubmitApprovalInstanceMutationData {
  readonly submitApprovalInstance: Pick<ApprovalInstanceRecord, 'id'>;
}

interface ProcessApprovalInstanceMutationData {
  readonly processApprovalInstance: boolean;
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
}

interface LaunchTemplatesQueryData {
  readonly approvalTemplates: readonly (ApprovalTemplateRecord & {
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
      approvalTemplates {
        currentVersionId
        id
        name
        updatedAt
      }
    }`,
  );
  const versionLists = await Promise.all(
    templateData.approvalTemplates.map((template) =>
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

  return templateData.approvalTemplates.flatMap((template, index) => {
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
        completedAt
        createdAt
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
    tasks: data.tasks,
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
        completedAt
        createdAt
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

  return data.inboxTasks;
}

export async function listApprovalHistoryTasks(
  assigneeMemberId: string,
): Promise<readonly TaskRecord[]> {
  const data = await requestGraphQl<ApprovalHistoryTasksQueryData>(
    `query ApprovalHistoryTasks($assigneeMemberId: String!) {
      approvalHistoryTasks(assigneeMemberId: $assigneeMemberId) {
        assigneeMemberId
        completedAt
        createdAt
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

  return data.approvalHistoryTasks;
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
        taskId
        transferToMemberId
      }
    }`,
    { taskId },
  );

  return data.taskDecisions;
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
  recipientMemberId,
}: {
  readonly includeRead?: boolean;
  readonly recipientMemberId: string;
}): Promise<{
  readonly notifications: readonly NotificationRecord[];
  readonly unreadCount: number;
}> {
  const data = await requestGraphQl<NotificationsQueryData>(
    `query Notifications($recipientMemberId: String!, $includeRead: Boolean) {
      notifications(
        includeRead: $includeRead
        recipientMemberId: $recipientMemberId
      ) {
        body
        channel
        createdAt
        id
        instanceId
        payloadJson
        readAt
        recipientMemberId
        sentAt
        status
        taskId
        title
        type
      }
      unreadNotificationCount(recipientMemberId: $recipientMemberId)
    }`,
    { includeRead, recipientMemberId },
  );

  return {
    notifications: data.notifications,
    unreadCount: data.unreadNotificationCount,
  };
}

export async function markNotificationRead({
  id,
  readerMemberId,
}: {
  readonly id: string;
  readonly readerMemberId: string;
}): Promise<NotificationRecord> {
  const data = await requestGraphQl<MarkNotificationReadMutationData>(
    `mutation MarkNotificationRead($id: String!, $readerMemberId: String) {
      markNotificationRead(id: $id, readerMemberId: $readerMemberId) {
        body
        channel
        createdAt
        id
        instanceId
        payloadJson
        readAt
        recipientMemberId
        sentAt
        status
        taskId
        title
        type
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
  const data =
    await requestGraphQl<UpdateNotificationPreferenceMutationData>(
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

export async function processApprovalInstance(
  instanceId: string,
): Promise<boolean> {
  const data = await requestGraphQl<ProcessApprovalInstanceMutationData>(
    `mutation ProcessApprovalInstance($instanceId: String!) {
      processApprovalInstance(instanceId: $instanceId)
    }`,
    { instanceId },
  );

  return data.processApprovalInstance;
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

async function requestGraphQl<TData>(
  query: string,
  variables?: Readonly<Record<string, unknown>>,
): Promise<TData> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    body: JSON.stringify({ query, variables }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GraphQlResponse<TData>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
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
