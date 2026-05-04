import { WorkflowDefinition } from '@bpm/shared/workflow';

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:17601/graphql';

export interface ApprovalTemplateRecord {
  readonly category: string | null;
  readonly currentVersionId: string | null;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
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
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly version: number;
}

export interface PublishedFormVersionOption {
  readonly formDefinitionId: string;
  readonly formName: string;
  readonly id: string;
  readonly label: string;
  readonly version: number;
}

export interface TemplateDesignerRecord {
  readonly formVersions: readonly PublishedFormVersionOption[];
  readonly template: ApprovalTemplateRecord;
  readonly versions: readonly ApprovalTemplateVersionRecord[];
}

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

interface ApprovalTemplatesQueryData {
  readonly approvalTemplates: readonly ApprovalTemplateRecord[];
}

interface CreateApprovalTemplateMutationData {
  readonly createApprovalTemplate: Pick<ApprovalTemplateRecord, 'id'>;
}

interface TemplateDesignerQueryData {
  readonly approvalTemplate: ApprovalTemplateRecord;
  readonly approvalTemplateVersions: readonly VersionJsonRecord[];
  readonly formDefinitions: readonly FormDefinitionRecord[];
}

interface FormVersionsQueryData {
  readonly formDefinitionVersions: readonly FormDefinitionVersionRecord[];
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

interface VersionJsonRecord
  extends Omit<ApprovalTemplateVersionRecord, 'workflowDefinition'> {
  readonly workflowDefinitionJson: string;
}

export async function listApprovalTemplates(): Promise<
  readonly ApprovalTemplateRecord[]
> {
  const data = await requestGraphQl<ApprovalTemplatesQueryData>(
    `query ApprovalTemplates {
      approvalTemplates {
        category
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

export async function createApprovalTemplate(name: string): Promise<string> {
  const data = await requestGraphQl<CreateApprovalTemplateMutationData>(
    `mutation CreateApprovalTemplate($input: CreateApprovalTemplateInput!) {
      createApprovalTemplate(input: $input) {
        id
      }
    }`,
    {
      input: {
        category: null,
        createdByMemberId: null,
        description: null,
        formDefinitionVersionId: null,
        name,
      },
    },
  );

  return data.createApprovalTemplate.id;
}

export async function readTemplateDesigner(
  templateId: string,
): Promise<TemplateDesignerRecord> {
  const data = await requestGraphQl<TemplateDesignerQueryData>(
    `query TemplateDesigner($id: String!) {
      approvalTemplate(id: $id) {
        category
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
          version: version.version,
        })),
    ),
    template: data.approvalTemplate,
    versions: data.approvalTemplateVersions.map(parseVersionJson),
  };
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

async function readFormDefinitionVersions(
  formDefinitionId: string,
): Promise<readonly FormDefinitionVersionRecord[]> {
  const data = await requestGraphQl<FormVersionsQueryData>(
    `query FormVersions($formDefinitionId: String!) {
      formDefinitionVersions(formDefinitionId: $formDefinitionId) {
        formDefinitionId
        id
        publishedAt
        status
        version
      }
    }`,
    { formDefinitionId },
  );

  return data.formDefinitionVersions;
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
