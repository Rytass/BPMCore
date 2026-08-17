import {
  FormDefinitionSchema,
  FormFieldOption,
  FormFieldValue,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import { requestGraphQl } from '../graphql-client';

export type FormDataSourceControl =
  | 'autocomplete'
  | 'checkbox'
  | 'radio'
  | 'select';

export type FormDataSourceParameterType =
  | 'BOOLEAN'
  | 'NUMBER'
  | 'STRING'
  | 'STRING_ARRAY';

export type FormDataSourceRevalidationPolicy =
  | 'ALWAYS'
  | 'WHEN_VALUE_OR_BINDINGS_CHANGE';

export interface FormDataSourceParameterRecord {
  readonly key: string;
  readonly label: string | null;
  readonly required: boolean;
  readonly type: FormDataSourceParameterType;
}

export interface FormDataSourceDescriptorRecord {
  readonly description: string | null;
  readonly key: string;
  readonly label: string;
  readonly maximumResultCount: number;
  readonly minimumSearchLength: number;
  readonly pageSize: number;
  readonly paginationMode: 'CURSOR' | 'NONE';
  readonly parameters: readonly FormDataSourceParameterRecord[];
  readonly revalidationPolicy: FormDataSourceRevalidationPolicy;
  readonly returnsCompleteList: boolean;
  readonly supportedControls: readonly FormDataSourceControl[];
  readonly supportsSearch: boolean;
  readonly version: number;
}

export interface FormDataSourceOptionsResultRecord {
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly nextCursor: string | null;
  readonly options: readonly FormFieldOption[];
}

export interface PreviewFormFieldOptionsInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  readonly schema: FormDefinitionSchema;
  readonly searchText?: string | null;
  readonly uiSchema: FormUiSchema;
}

export interface RuntimeFormFieldOptionsInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  readonly instanceId?: string | null;
  readonly searchText?: string | null;
  readonly templateId?: string | null;
}

interface FormDataSourcesQueryData {
  readonly formDataSources: readonly FormDataSourceDescriptorRecord[];
}

interface FormFieldOptionsQueryData {
  readonly formFieldOptions: FormDataSourceOptionsResultRecord;
}

interface PreviewFormFieldOptionsQueryData {
  readonly previewFormFieldOptions: FormDataSourceOptionsResultRecord;
}

const DESCRIPTOR_FIELDS = `
  description
  key
  label
  maximumResultCount
  minimumSearchLength
  pageSize
  paginationMode
  parameters {
    key
    label
    required
    type
  }
  revalidationPolicy
  returnsCompleteList
  supportedControls
  supportsSearch
  version
`;

const OPTION_RESULT_FIELDS = `
  dataSourceKey
  dataSourceVersion
  nextCursor
  options {
    label
    value
  }
`;

export async function listFormDataSources(): Promise<
  readonly FormDataSourceDescriptorRecord[]
> {
  const data = await requestGraphQl<FormDataSourcesQueryData>(
    `query FormDataSources { formDataSources { ${DESCRIPTOR_FIELDS} } }`,
  );

  return data.formDataSources;
}

export async function previewFormFieldOptions(
  input: PreviewFormFieldOptionsInput,
): Promise<FormDataSourceOptionsResultRecord> {
  const data = await requestGraphQl<PreviewFormFieldOptionsQueryData>(
    `query PreviewFormFieldOptions($input: BPMPreviewFormFieldOptionsInput!) {
      previewFormFieldOptions(input: $input) { ${OPTION_RESULT_FIELDS} }
    }`,
    { input: serializePreviewInput(input) },
  );

  return data.previewFormFieldOptions;
}

export async function readFormFieldOptions(
  input: RuntimeFormFieldOptionsInput,
): Promise<FormDataSourceOptionsResultRecord> {
  const data = await requestGraphQl<FormFieldOptionsQueryData>(
    `query FormFieldOptions($input: BPMRuntimeFormFieldOptionsInput!) {
      formFieldOptions(input: $input) { ${OPTION_RESULT_FIELDS} }
    }`,
    { input: serializeRuntimeInput(input) },
  );

  return data.formFieldOptions;
}

function serializePreviewInput(
  input: PreviewFormFieldOptionsInput,
): Readonly<Record<string, unknown>> {
  return {
    cursor: input.cursor ?? null,
    fieldKey: input.fieldKey,
    formDataJson: input.formData ? JSON.stringify(input.formData) : null,
    schemaJson: JSON.stringify(input.schema),
    searchText: input.searchText ?? null,
    uiSchemaJson: JSON.stringify(input.uiSchema),
  };
}

function serializeRuntimeInput(
  input: RuntimeFormFieldOptionsInput,
): Readonly<Record<string, unknown>> {
  return {
    cursor: input.cursor ?? null,
    fieldKey: input.fieldKey,
    formDataJson: input.formData ? JSON.stringify(input.formData) : null,
    instanceId: input.instanceId ?? null,
    searchText: input.searchText ?? null,
    templateId: input.templateId ?? null,
  };
}
