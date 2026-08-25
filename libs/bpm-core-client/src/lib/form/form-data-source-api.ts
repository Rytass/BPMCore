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
  /**
   * Field keys the host still needs before the source can be queried. The
   * server decides this — a binding pointing at an empty field is only
   * blocking when the bound parameter is required, and the browser never sees
   * the descriptor that says so.
   */
  readonly waitingForFieldKeys: readonly string[];
}

/**
 * Authoritative answer for a set of already-selected values.
 *
 * `unresolvedValues` is how a value that the upstream source no longer offers
 * is reported: the provider answered normally, it just cannot resolve those
 * values under the current bindings and auth context.
 */
export interface FormDataSourceResolveResultRecord {
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly options: readonly FormFieldOption[];
  readonly unresolvedValues: readonly string[];
  readonly waitingForFieldKeys: readonly string[];
}

export interface PreviewFormFieldOptionsInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  /**
   * The cells of the row a table column's query belongs to. Only a table cell
   * sends this; a `ROW_FIELD` binding reads its parameter from it, and its
   * absence is reported through `waitingForFieldKeys` (ADR 16 §3.5).
   */
  readonly rowValues?: Readonly<Record<string, FormFieldValue>>;
  readonly schema: FormDefinitionSchema;
  readonly searchText?: string | null;
  readonly signal?: AbortSignal;
  readonly uiSchema: FormUiSchema;
}

export interface RuntimeFormFieldOptionsInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  readonly instanceId?: string | null;
  /**
   * The cells of the row a table column's query belongs to. Only a table cell
   * sends this; a `ROW_FIELD` binding reads its parameter from it, and its
   * absence is reported through `waitingForFieldKeys` (ADR 16 §3.5).
   */
  readonly rowValues?: Readonly<Record<string, FormFieldValue>>;
  readonly searchText?: string | null;
  readonly signal?: AbortSignal;
  readonly templateId?: string | null;
}

export interface PreviewResolveFormFieldOptionsInput {
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  /**
   * The cells of the row a table column's query belongs to. Only a table cell
   * sends this; a `ROW_FIELD` binding reads its parameter from it, and its
   * absence is reported through `waitingForFieldKeys` (ADR 16 §3.5).
   */
  readonly rowValues?: Readonly<Record<string, FormFieldValue>>;
  readonly schema: FormDefinitionSchema;
  readonly signal?: AbortSignal;
  readonly uiSchema: FormUiSchema;
  readonly values: readonly string[];
}

export interface RuntimeResolveFormFieldOptionsInput {
  readonly fieldKey: string;
  readonly formData?: Readonly<Record<string, FormFieldValue>>;
  readonly instanceId?: string | null;
  /**
   * The cells of the row a table column's query belongs to. Only a table cell
   * sends this; a `ROW_FIELD` binding reads its parameter from it, and its
   * absence is reported through `waitingForFieldKeys` (ADR 16 §3.5).
   */
  readonly rowValues?: Readonly<Record<string, FormFieldValue>>;
  readonly signal?: AbortSignal;
  readonly templateId?: string | null;
  readonly values: readonly string[];
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

interface ResolveFormFieldOptionsQueryData {
  readonly resolveFormFieldOptions: FormDataSourceResolveResultRecord;
}

interface PreviewResolveFormFieldOptionsQueryData {
  readonly previewResolveFormFieldOptions: FormDataSourceResolveResultRecord;
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
  waitingForFieldKeys
`;

const RESOLVE_RESULT_FIELDS = `
  dataSourceKey
  dataSourceVersion
  options {
    label
    value
  }
  unresolvedValues
  waitingForFieldKeys
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
    { signal: input.signal },
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
    { signal: input.signal },
  );

  return data.formFieldOptions;
}

/**
 * Asks the host to confirm already-selected values for a Designer preview.
 */
export async function previewResolveFormFieldOptions(
  input: PreviewResolveFormFieldOptionsInput,
): Promise<FormDataSourceResolveResultRecord> {
  const data = await requestGraphQl<PreviewResolveFormFieldOptionsQueryData>(
    `query PreviewResolveFormFieldOptions($input: BPMPreviewResolveFormFieldOptionsInput!) {
      previewResolveFormFieldOptions(input: $input) { ${RESOLVE_RESULT_FIELDS} }
    }`,
    { input: serializePreviewResolveInput(input) },
    { signal: input.signal },
  );

  return data.previewResolveFormFieldOptions;
}

/**
 * Asks the host to confirm already-selected values for a runtime instance.
 *
 * This is the authority behind the `INVALID` field status: a value the source
 * no longer offers comes back in `unresolvedValues` instead of being papered
 * over by an option snapshot merged for display.
 */
export async function resolveFormFieldOptions(
  input: RuntimeResolveFormFieldOptionsInput,
): Promise<FormDataSourceResolveResultRecord> {
  const data = await requestGraphQl<ResolveFormFieldOptionsQueryData>(
    `query ResolveFormFieldOptions($input: BPMRuntimeResolveFormFieldOptionsInput!) {
      resolveFormFieldOptions(input: $input) { ${RESOLVE_RESULT_FIELDS} }
    }`,
    { input: serializeRuntimeResolveInput(input) },
    { signal: input.signal },
  );

  return data.resolveFormFieldOptions;
}

function serializePreviewInput(
  input: PreviewFormFieldOptionsInput,
): Readonly<Record<string, unknown>> {
  return {
    cursor: input.cursor ?? null,
    fieldKey: input.fieldKey,
    formDataJson: input.formData ? JSON.stringify(input.formData) : null,
    rowValuesJson: input.rowValues ? JSON.stringify(input.rowValues) : null,
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
    rowValuesJson: input.rowValues ? JSON.stringify(input.rowValues) : null,
    searchText: input.searchText ?? null,
    templateId: input.templateId ?? null,
  };
}

function serializePreviewResolveInput(
  input: PreviewResolveFormFieldOptionsInput,
): Readonly<Record<string, unknown>> {
  return {
    fieldKey: input.fieldKey,
    formDataJson: input.formData ? JSON.stringify(input.formData) : null,
    rowValuesJson: input.rowValues ? JSON.stringify(input.rowValues) : null,
    schemaJson: JSON.stringify(input.schema),
    uiSchemaJson: JSON.stringify(input.uiSchema),
    valuesJson: JSON.stringify(input.values),
  };
}

function serializeRuntimeResolveInput(
  input: RuntimeResolveFormFieldOptionsInput,
): Readonly<Record<string, unknown>> {
  return {
    fieldKey: input.fieldKey,
    formDataJson: input.formData ? JSON.stringify(input.formData) : null,
    instanceId: input.instanceId ?? null,
    rowValuesJson: input.rowValues ? JSON.stringify(input.rowValues) : null,
    templateId: input.templateId ?? null,
    valuesJson: JSON.stringify(input.values),
  };
}
