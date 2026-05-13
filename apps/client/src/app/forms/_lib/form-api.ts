import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormUiSchema,
} from '@bpm/shared/form';
import { requestGraphQl } from '../../_lib/graphql-client';

export interface FormDefinitionRecord {
  readonly currentVersionId: string | null;
  readonly currentVersionCreatedAt: string | null;
  readonly currentVersionNumber: number | null;
  readonly currentVersionPublishedAt: string | null;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export type FormDefinitionListStatus = 'DRAFT' | 'PUBLISHED';

export interface FormDefinitionVersionRecord {
  readonly id: string;
  readonly publishedAt: string | null;
  readonly schema: FormDefinitionSchema;
  readonly schemaJson: string;
  readonly status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  readonly uiSchema: FormUiSchema;
  readonly uiSchemaJson: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface FormBuilderRecord {
  readonly definition: FormDefinitionRecord;
  readonly versions: readonly FormDefinitionVersionRecord[];
}

export interface FormSchemaLintResult {
  readonly errors: readonly string[];
  readonly valid: boolean;
}

interface FormDefinitionsQueryData {
  readonly formDefinitions: readonly FormDefinitionRecord[];
}

interface FormDefinitionsPageQueryData extends FormDefinitionsQueryData {
  readonly formDefinitionCount: number;
}

interface CreateFormDefinitionMutationData {
  readonly createFormDefinition: Pick<FormDefinitionRecord, 'id'>;
}

interface UpdateFormDefinitionMutationData {
  readonly updateFormDefinition: FormDefinitionRecord;
}

interface FormBuilderQueryData {
  readonly formDefinition: FormDefinitionRecord;
  readonly formDefinitionVersions: readonly VersionJsonRecord[];
}

interface VersionJsonRecord extends Omit<
  FormDefinitionVersionRecord,
  'schema' | 'uiSchema'
> {
  readonly schemaJson: string;
  readonly uiSchemaJson: string;
}

interface UpdateDraftMutationData {
  readonly updateFormDefinitionDraft: VersionJsonRecord;
}

interface PublishVersionMutationData {
  readonly publishFormDefinitionVersion: VersionJsonRecord;
}

interface ForkFormDefinitionMutationData {
  readonly forkFormDefinition: VersionJsonRecord;
}

interface LintFormSchemaQueryData {
  readonly lintFormSchema: FormSchemaLintResult;
}

export async function listFormDefinitions(): Promise<
  readonly FormDefinitionRecord[]
> {
  const data = await requestGraphQl<FormDefinitionsQueryData>(
    `query FormDefinitions {
      formDefinitions {
        currentVersionCreatedAt
        currentVersionId
        currentVersionNumber
        currentVersionPublishedAt
        description
        id
        name
        updatedAt
      }
    }`,
  );

  return data.formDefinitions;
}

export async function listFormDefinitionsPage({
  page,
  pageSize,
  status,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: FormDefinitionListStatus | null;
}): Promise<{
  readonly forms: readonly FormDefinitionRecord[];
  readonly totalCount: number;
}> {
  const data = await requestGraphQl<FormDefinitionsPageQueryData>(
    `query FormDefinitionsPage(
      $page: Int!
      $pageSize: Int!
      $status: FormDefinitionListStatus
    ) {
      formDefinitions(page: $page, pageSize: $pageSize, status: $status) {
        currentVersionCreatedAt
        currentVersionId
        currentVersionNumber
        currentVersionPublishedAt
        description
        id
        name
        updatedAt
      }
      formDefinitionCount(status: $status)
    }`,
    { page, pageSize, status: status ?? null },
  );

  return {
    forms: data.formDefinitions,
    totalCount: data.formDefinitionCount,
  };
}

export async function createFormDefinition(name: string): Promise<string> {
  const data = await requestGraphQl<CreateFormDefinitionMutationData>(
    `mutation CreateFormDefinition($input: CreateFormDefinitionInput!) {
      createFormDefinition(input: $input) {
        id
      }
    }`,
    {
      input: {
        createdByMemberId: null,
        description: null,
        name,
        schemaJson: null,
        uiSchemaJson: null,
      },
    },
  );

  return data.createFormDefinition.id;
}

export async function updateFormDefinition(
  id: string,
  name: string,
): Promise<FormDefinitionRecord> {
  const data = await requestGraphQl<UpdateFormDefinitionMutationData>(
    `mutation UpdateFormDefinition($input: UpdateFormDefinitionInput!) {
      updateFormDefinition(input: $input) {
        currentVersionCreatedAt
        currentVersionId
        currentVersionNumber
        currentVersionPublishedAt
        description
        id
        name
        updatedAt
      }
    }`,
    {
      input: {
        description: null,
        id,
        name,
      },
    },
  );

  return data.updateFormDefinition;
}

export async function readFormBuilder(
  formDefinitionId: string,
): Promise<FormBuilderRecord> {
  const data = await requestGraphQl<FormBuilderQueryData>(
    `query FormBuilder($id: String!) {
      formDefinition(id: $id) {
        currentVersionCreatedAt
        currentVersionId
        currentVersionNumber
        currentVersionPublishedAt
        description
        id
        name
        updatedAt
      }
      formDefinitionVersions(formDefinitionId: $id) {
        id
        publishedAt
        schemaJson
        status
        uiSchemaJson
        updatedAt
        version
      }
    }`,
    { id: formDefinitionId },
  );

  return {
    definition: data.formDefinition,
    versions: data.formDefinitionVersions.map(parseVersionJson),
  };
}

export async function updateFormDefinitionDraft(
  versionId: string,
  schema: FormDefinitionSchema,
  uiSchema: FormUiSchema,
): Promise<FormDefinitionVersionRecord> {
  const data = await requestGraphQl<UpdateDraftMutationData>(
    `mutation UpdateFormDefinitionDraft($input: UpdateFormDefinitionDraftInput!) {
      updateFormDefinitionDraft(input: $input) {
        id
        publishedAt
        schemaJson
        status
        uiSchemaJson
        updatedAt
        version
      }
    }`,
    {
      input: {
        schemaJson: JSON.stringify(schema),
        uiSchemaJson: JSON.stringify(uiSchema),
        versionId,
      },
    },
  );

  return parseVersionJson(data.updateFormDefinitionDraft);
}

export async function publishFormDefinitionVersion(
  versionId: string,
): Promise<FormDefinitionVersionRecord> {
  const data = await requestGraphQl<PublishVersionMutationData>(
    `mutation PublishFormDefinitionVersion($versionId: String!) {
      publishFormDefinitionVersion(versionId: $versionId) {
        id
        publishedAt
        schemaJson
        status
        uiSchemaJson
        updatedAt
        version
      }
    }`,
    { versionId },
  );

  return parseVersionJson(data.publishFormDefinitionVersion);
}

export async function forkFormDefinition(
  formDefinitionId: string,
): Promise<FormDefinitionVersionRecord> {
  const data = await requestGraphQl<ForkFormDefinitionMutationData>(
    `mutation ForkFormDefinition($formDefinitionId: String!) {
      forkFormDefinition(formDefinitionId: $formDefinitionId) {
        id
        publishedAt
        schemaJson
        status
        uiSchemaJson
        updatedAt
        version
      }
    }`,
    { formDefinitionId },
  );

  return parseVersionJson(data.forkFormDefinition);
}

export async function lintFormSchema(
  schema: FormDefinitionSchema,
  uiSchema: FormUiSchema,
): Promise<FormSchemaLintResult> {
  const data = await requestGraphQl<LintFormSchemaQueryData>(
    `query LintFormSchema($input: LintFormSchemaInput!) {
      lintFormSchema(input: $input) {
        errors
        valid
      }
    }`,
    {
      input: {
        schemaJson: JSON.stringify(schema),
        uiSchemaJson: JSON.stringify(uiSchema),
      },
    },
  );

  return data.lintFormSchema;
}

export function createFieldDefinition(
  type: FormFieldDefinition['type'],
  index: number,
): FormFieldDefinition {
  const fieldKey = `${type}_${index}`;
  const base = {
    fieldKey,
    label: readDefaultFieldLabel(type, index),
    required: false,
    type,
  };

  if (type === 'select' || type === 'radio' || type === 'checkbox') {
    return {
      ...base,
      options: [
        { label: '選項 A', value: 'option_a' },
        { label: '選項 B', value: 'option_b' },
      ],
      type,
    };
  }

  if (type === 'file_upload') {
    return {
      ...base,
      maxFiles: 1,
      type,
    };
  }

  return base as FormFieldDefinition;
}

function parseVersionJson(
  version: VersionJsonRecord,
): FormDefinitionVersionRecord {
  return {
    ...version,
    schema: JSON.parse(version.schemaJson) as FormDefinitionSchema,
    uiSchema: JSON.parse(version.uiSchemaJson) as FormUiSchema,
  };
}

function readDefaultFieldLabel(
  type: FormFieldDefinition['type'],
  index: number,
): string {
  const labels: Readonly<Record<FormFieldDefinition['type'], string>> = {
    boolean: '開關',
    checkbox: '複選',
    date: '日期',
    datetime: '日期時間',
    file_upload: '附件',
    money: '金額',
    number: '數字',
    radio: '單選',
    select: '下拉選單',
    text: '文字',
    textarea: '長文字',
  };

  return `${labels[type]} ${index}`;
}
