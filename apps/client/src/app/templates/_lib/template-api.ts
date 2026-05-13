import { FormDefinitionSchema } from '@bpm/shared/form';
import { WorkflowDefinition } from '@bpm/shared/workflow';
import { requestGraphQl } from '../../_lib/graphql-client';

export interface ApprovalTemplateRecord {
  readonly category: string | null;
  readonly categoryDetail: ApprovalTemplateCategoryRecord | null;
  readonly categoryId: string | null;
  readonly currentVersionId: string | null;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export type ApprovalTemplateListStatus = 'DRAFT' | 'PUBLISHED';
export type ApprovalTemplateCategoryStatus = 'ACTIVE' | 'ALL' | 'INACTIVE';

export interface ApprovalTemplateCategoryRecord {
  readonly createdAt: string;
  readonly description: string | null;
  readonly id: string;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface ApprovalTemplateVersionRecord {
  readonly archivedAt: string | null;
  readonly formDefinitionVersionId: string | null;
  readonly id: string;
  readonly initiatorPolicyCel: string | null;
  readonly notificationConfigJson: string | null;
  readonly publishedAt: string | null;
  readonly slaDefaultsJson: string | null;
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly updatedAt: string;
  readonly version: number;
  readonly workflowDefinition: WorkflowDefinition;
  readonly workflowDefinitionJson: string;
}

export interface FormDefinitionRecord {
  readonly currentVersionId: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface FormDefinitionVersionRecord {
  readonly formDefinitionId: string;
  readonly id: string;
  readonly publishedAt: string | null;
  readonly schema: FormDefinitionSchema;
  readonly schemaJson: string;
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly version: number;
}

export interface PublishedFormVersionOption {
  readonly formDefinitionId: string;
  readonly formName: string;
  readonly id: string;
  readonly label: string;
  readonly schema: FormDefinitionSchema;
  readonly version: number;
}

export interface MemberProfileRecord {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}

export interface WorkflowDryRunStepRecord {
  readonly assigneeMemberId: string | null;
  readonly edgeDefault: boolean | null;
  readonly edgeId: string | null;
  readonly edgeLabel: string | null;
  readonly edgeMatched: boolean | null;
  readonly edgeReason: string | null;
  readonly entryCondition: string | null;
  readonly entryConditionMatched: boolean | null;
  readonly id: string;
  readonly message: string;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly nodeType: string;
  readonly status: string;
}

export interface WorkflowDryRunResultRecord {
  readonly errors: readonly string[];
  readonly steps: readonly WorkflowDryRunStepRecord[];
  readonly valid: boolean;
}

export interface TemplateDesignerRecord {
  readonly formVersions: readonly PublishedFormVersionOption[];
  readonly template: ApprovalTemplateRecord;
  readonly versions: readonly ApprovalTemplateVersionRecord[];
}

export interface ApprovalTemplatesPage {
  readonly templates: readonly ApprovalTemplateRecord[];
  readonly totalCount: number;
}

export interface ApprovalTemplateCategoriesPage {
  readonly categories: readonly ApprovalTemplateCategoryRecord[];
  readonly totalCount: number;
}

interface ApprovalTemplatesQueryData {
  readonly approvalTemplates: readonly ApprovalTemplateRecord[];
}

interface ApprovalTemplatesPageQueryData extends ApprovalTemplatesQueryData {
  readonly approvalTemplateCount: number;
}

interface ApprovalTemplateCategoriesPageQueryData {
  readonly approvalTemplateCategories: readonly ApprovalTemplateCategoryRecord[];
  readonly approvalTemplateCategoryCount: number;
}

interface CreateApprovalTemplateMutationData {
  readonly createApprovalTemplate: Pick<ApprovalTemplateRecord, 'id'>;
}

interface CreateApprovalTemplateCategoryMutationData {
  readonly createApprovalTemplateCategory: ApprovalTemplateCategoryRecord;
}

interface DeleteApprovalTemplateCategoryMutationData {
  readonly deleteApprovalTemplateCategory: Pick<
    ApprovalTemplateCategoryRecord,
    'id'
  >;
}

interface UpdateApprovalTemplateCategoryMutationData {
  readonly updateApprovalTemplateCategory: ApprovalTemplateCategoryRecord;
}

interface TemplateDesignerQueryData {
  readonly approvalTemplate: ApprovalTemplateRecord;
  readonly approvalTemplateVersions: readonly VersionJsonRecord[];
  readonly formDefinitions: readonly FormDefinitionRecord[];
}

interface FormVersionsQueryData {
  readonly formDefinitionVersions: readonly FormDefinitionVersionRecord[];
}

interface MembersQueryData {
  readonly members: readonly MemberProfileRecord[];
}

interface SearchMembersQueryData {
  readonly searchMembers: readonly MemberProfileRecord[];
}

interface UpdateTemplateDraftMutationData {
  readonly updateApprovalTemplateDraft: VersionJsonRecord;
}

interface PublishTemplateVersionMutationData {
  readonly publishApprovalTemplateVersion: VersionJsonRecord;
}

interface RollbackTemplateVersionMutationData {
  readonly rollbackApprovalTemplateVersion: VersionJsonRecord;
}

interface ForkTemplateMutationData {
  readonly forkApprovalTemplate: VersionJsonRecord;
}

interface DryRunApprovalWorkflowMutationData {
  readonly dryRunApprovalWorkflow: WorkflowDryRunResultRecord;
}

interface VersionJsonRecord extends Omit<
  ApprovalTemplateVersionRecord,
  'workflowDefinition'
> {
  readonly workflowDefinitionJson: string;
}

export async function listApprovalTemplates(): Promise<
  readonly ApprovalTemplateRecord[]
> {
  const data = await requestGraphQl<ApprovalTemplatesQueryData>(
    `query ApprovalTemplates {
      approvalTemplates {
        category
        categoryId
        categoryDetail {
          id
          isActive
          name
        }
        currentVersionId
        description
        id
        name
        updatedAt
      }
    }`,
  );

  return data.approvalTemplates;
}

export async function listApprovalTemplatesPage({
  page,
  pageSize,
  searchText,
  status,
  categoryId,
}: {
  readonly categoryId?: string | null;
  readonly page: number;
  readonly pageSize: number;
  readonly searchText?: string;
  readonly status?: ApprovalTemplateListStatus | null;
}): Promise<ApprovalTemplatesPage> {
  const data = await requestGraphQl<ApprovalTemplatesPageQueryData>(
    `query ApprovalTemplatesPage(
      $page: Int
      $pageSize: Int
      $searchText: String
      $status: ApprovalTemplateListStatus
      $categoryId: String
    ) {
      approvalTemplates(
        categoryId: $categoryId
        page: $page
        pageSize: $pageSize
        searchText: $searchText
        status: $status
      ) {
        category
        categoryId
        categoryDetail {
          id
          isActive
          name
        }
        currentVersionId
        description
        id
        name
        updatedAt
      }
      approvalTemplateCount(
        categoryId: $categoryId
        searchText: $searchText
        status: $status
      )
    }`,
    {
      categoryId: categoryId ?? null,
      page,
      pageSize,
      searchText,
      status: status ?? null,
    },
  );

  return {
    templates: data.approvalTemplates,
    totalCount: data.approvalTemplateCount,
  };
}

export async function listApprovalTemplateCategoriesPage({
  page,
  pageSize,
  searchText,
  status,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly searchText?: string;
  readonly status?: ApprovalTemplateCategoryStatus | null;
}): Promise<ApprovalTemplateCategoriesPage> {
  const data = await requestGraphQl<ApprovalTemplateCategoriesPageQueryData>(
    `query ApprovalTemplateCategoriesPage(
      $page: Int
      $pageSize: Int
      $searchText: String
      $status: ApprovalTemplateCategoryStatus
    ) {
      approvalTemplateCategories(
        page: $page
        pageSize: $pageSize
        searchText: $searchText
        status: $status
      ) {
        createdAt
        description
        id
        isActive
        name
        sortOrder
        updatedAt
      }
      approvalTemplateCategoryCount(
        searchText: $searchText
        status: $status
      )
    }`,
    { page, pageSize, searchText, status: status ?? null },
  );

  return {
    categories: data.approvalTemplateCategories,
    totalCount: data.approvalTemplateCategoryCount,
  };
}

export async function createApprovalTemplate({
  categoryId,
  name,
}: {
  readonly categoryId: string | null;
  readonly name: string;
}): Promise<string> {
  const data = await requestGraphQl<CreateApprovalTemplateMutationData>(
    `mutation CreateApprovalTemplate($input: CreateApprovalTemplateInput!) {
      createApprovalTemplate(input: $input) {
        id
      }
    }`,
    {
      input: {
        category: null,
        categoryId,
        createdByMemberId: null,
        description: null,
        formDefinitionVersionId: null,
        name,
      },
    },
  );

  return data.createApprovalTemplate.id;
}

export async function createApprovalTemplateCategory({
  description,
  isActive,
  name,
  sortOrder,
}: {
  readonly description: string | null;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
}): Promise<ApprovalTemplateCategoryRecord> {
  const data = await requestGraphQl<CreateApprovalTemplateCategoryMutationData>(
    `mutation CreateApprovalTemplateCategory($input: CreateApprovalTemplateCategoryInput!) {
      createApprovalTemplateCategory(input: $input) {
        createdAt
        description
        id
        isActive
        name
        sortOrder
        updatedAt
      }
    }`,
    { input: { description, isActive, name, sortOrder } },
  );

  return data.createApprovalTemplateCategory;
}

export async function updateApprovalTemplateCategory({
  description,
  id,
  isActive,
  name,
  sortOrder,
}: {
  readonly description: string | null;
  readonly id: string;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
}): Promise<ApprovalTemplateCategoryRecord> {
  const data = await requestGraphQl<UpdateApprovalTemplateCategoryMutationData>(
    `mutation UpdateApprovalTemplateCategory($input: UpdateApprovalTemplateCategoryInput!) {
      updateApprovalTemplateCategory(input: $input) {
        createdAt
        description
        id
        isActive
        name
        sortOrder
        updatedAt
      }
    }`,
    { input: { description, id, isActive, name, sortOrder } },
  );

  return data.updateApprovalTemplateCategory;
}

export async function deleteApprovalTemplateCategory(
  id: string,
): Promise<void> {
  await requestGraphQl<DeleteApprovalTemplateCategoryMutationData>(
    `mutation DeleteApprovalTemplateCategory($id: String!) {
      deleteApprovalTemplateCategory(id: $id) {
        id
      }
    }`,
    { id },
  );
}

export async function readTemplateDesigner(
  templateId: string,
): Promise<TemplateDesignerRecord> {
  const data = await requestGraphQl<TemplateDesignerQueryData>(
    `query TemplateDesigner($id: String!) {
      approvalTemplate(id: $id) {
        category
        categoryId
        categoryDetail {
          id
          isActive
          name
        }
        currentVersionId
        description
        id
        name
        updatedAt
      }
      approvalTemplateVersions(templateId: $id) {
        archivedAt
        formDefinitionVersionId
        id
        initiatorPolicyCel
        notificationConfigJson
        publishedAt
        slaDefaultsJson
        status
        updatedAt
        version
        workflowDefinitionJson
      }
      formDefinitions {
        currentVersionId
        id
        name
        updatedAt
      }
    }`,
    { id: templateId },
  );
  const formVersionLists = await Promise.all(
    data.formDefinitions.map((definition) =>
      readFormDefinitionVersions(definition.id),
    ),
  );

  return {
    formVersions: data.formDefinitions.flatMap((definition, index) =>
      formVersionLists[index]
        .filter((version) => version.status === 'PUBLISHED')
        .map((version) => ({
          formDefinitionId: definition.id,
          formName: definition.name,
          id: version.id,
          label: `${definition.name} v${version.version}`,
          schema: version.schema,
          version: version.version,
        })),
    ),
    template: data.approvalTemplate,
    versions: data.approvalTemplateVersions.map(parseVersionJson),
  };
}

export async function searchPublishedFormVersionOptions(
  searchText: string,
): Promise<readonly PublishedFormVersionOption[]> {
  const data = await requestGraphQl<
    Pick<TemplateDesignerQueryData, 'formDefinitions'>
  >(
    `query PublishedFormVersionOptions {
      formDefinitions {
        currentVersionId
        id
        name
        updatedAt
      }
    }`,
  );
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();
  const matchedDefinitions = data.formDefinitions.filter((definition) =>
    normalizedSearchText
      ? definition.name.toLocaleLowerCase().includes(normalizedSearchText)
      : true,
  );
  const formVersionLists = await Promise.all(
    matchedDefinitions.map((definition) =>
      readFormDefinitionVersions(definition.id),
    ),
  );

  return matchedDefinitions.flatMap((definition, index) =>
    formVersionLists[index]
      .filter((version) => version.status === 'PUBLISHED')
      .map((version) => ({
        formDefinitionId: definition.id,
        formName: definition.name,
        id: version.id,
        label: `${definition.name} v${version.version}`,
        schema: version.schema,
        version: version.version,
      })),
  );
}

export async function resolveMemberOptions(
  memberIds: readonly string[],
): Promise<readonly MemberProfileRecord[]> {
  if (memberIds.length === 0) {
    return [];
  }

  const data = await requestGraphQl<MembersQueryData>(
    `query SelectedMembers($memberIds: [String!]!) {
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

export async function searchMemberOptions(
  searchText: string,
): Promise<readonly MemberProfileRecord[]> {
  const data = await requestGraphQl<SearchMembersQueryData>(
    `query MemberOptions($searchText: String!) {
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

export async function updateApprovalTemplateDraft({
  formDefinitionVersionId,
  initiatorPolicyCel,
  versionId,
  workflowDefinition,
}: {
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel: string | null;
  readonly versionId: string;
  readonly workflowDefinition: WorkflowDefinition;
}): Promise<ApprovalTemplateVersionRecord> {
  const data = await requestGraphQl<UpdateTemplateDraftMutationData>(
    `mutation UpdateApprovalTemplateDraft($input: UpdateApprovalTemplateDraftInput!) {
      updateApprovalTemplateDraft(input: $input) {
        archivedAt
        formDefinitionVersionId
        id
        initiatorPolicyCel
        notificationConfigJson
        publishedAt
        slaDefaultsJson
        status
        updatedAt
        version
        workflowDefinitionJson
      }
    }`,
    {
      input: {
        formDefinitionVersionId,
        initiatorPolicyCel,
        notificationConfigJson: null,
        slaDefaultsJson: null,
        versionId,
        workflowDefinitionJson: JSON.stringify(workflowDefinition),
      },
    },
  );

  return parseVersionJson(data.updateApprovalTemplateDraft);
}

export async function forkApprovalTemplate(
  templateId: string,
): Promise<ApprovalTemplateVersionRecord> {
  const data = await requestGraphQl<ForkTemplateMutationData>(
    `mutation ForkApprovalTemplate($templateId: String!) {
      forkApprovalTemplate(templateId: $templateId) {
        archivedAt
        formDefinitionVersionId
        id
        initiatorPolicyCel
        notificationConfigJson
        publishedAt
        slaDefaultsJson
        status
        updatedAt
        version
        workflowDefinitionJson
      }
    }`,
    { templateId },
  );

  return parseVersionJson(data.forkApprovalTemplate);
}

export async function publishApprovalTemplateVersion(
  versionId: string,
): Promise<ApprovalTemplateVersionRecord> {
  const data = await requestGraphQl<PublishTemplateVersionMutationData>(
    `mutation PublishApprovalTemplateVersion($versionId: String!) {
      publishApprovalTemplateVersion(versionId: $versionId) {
        archivedAt
        formDefinitionVersionId
        id
        initiatorPolicyCel
        notificationConfigJson
        publishedAt
        slaDefaultsJson
        status
        updatedAt
        version
        workflowDefinitionJson
      }
    }`,
    { versionId },
  );

  return parseVersionJson(data.publishApprovalTemplateVersion);
}

export async function rollbackApprovalTemplateVersion(
  versionId: string,
): Promise<ApprovalTemplateVersionRecord> {
  const data = await requestGraphQl<RollbackTemplateVersionMutationData>(
    `mutation RollbackApprovalTemplateVersion($versionId: String!) {
      rollbackApprovalTemplateVersion(versionId: $versionId) {
        archivedAt
        formDefinitionVersionId
        id
        initiatorPolicyCel
        notificationConfigJson
        publishedAt
        slaDefaultsJson
        status
        updatedAt
        version
        workflowDefinitionJson
      }
    }`,
    { versionId },
  );

  return parseVersionJson(data.rollbackApprovalTemplateVersion);
}

export async function dryRunApprovalWorkflow({
  formData,
  initiatorMemberId,
  initiatorMetadataSnapshot,
  workflowDefinition,
}: {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly initiatorMetadataSnapshot: Readonly<Record<string, unknown>> | null;
  readonly workflowDefinition: WorkflowDefinition;
}): Promise<WorkflowDryRunResultRecord> {
  const data = await requestGraphQl<DryRunApprovalWorkflowMutationData>(
    `mutation DryRunApprovalWorkflow($input: DryRunApprovalWorkflowInput!) {
      dryRunApprovalWorkflow(input: $input) {
        errors
        valid
        steps {
          assigneeMemberId
          edgeDefault
          edgeId
          edgeLabel
          edgeMatched
          edgeReason
          entryCondition
          entryConditionMatched
          id
          message
          nodeId
          nodeLabel
          nodeType
          status
        }
      }
    }`,
    {
      input: {
        formDataJson: JSON.stringify(formData),
        initiatorMemberId,
        initiatorMetadataSnapshotJson: initiatorMetadataSnapshot
          ? JSON.stringify(initiatorMetadataSnapshot)
          : null,
        workflowDefinitionJson: JSON.stringify(workflowDefinition),
      },
    },
  );

  return data.dryRunApprovalWorkflow;
}

async function readFormDefinitionVersions(
  formDefinitionId: string,
): Promise<readonly FormDefinitionVersionRecord[]> {
  const data = await requestGraphQl<FormVersionsQueryData>(
    `query FormVersions($formDefinitionId: String!) {
      formDefinitionVersions(formDefinitionId: $formDefinitionId) {
        formDefinitionId
        id
        publishedAt
        schemaJson
        status
        version
      }
    }`,
    { formDefinitionId },
  );

  return data.formDefinitionVersions.map((version) => ({
    ...version,
    schema: parseFormDefinitionSchema(version.schemaJson),
  }));
}

function parseVersionJson(
  version: VersionJsonRecord,
): ApprovalTemplateVersionRecord {
  return {
    ...version,
    workflowDefinition: JSON.parse(
      version.workflowDefinitionJson,
    ) as WorkflowDefinition,
  };
}

function parseFormDefinitionSchema(schemaJson: string): FormDefinitionSchema {
  return JSON.parse(schemaJson) as FormDefinitionSchema;
}
