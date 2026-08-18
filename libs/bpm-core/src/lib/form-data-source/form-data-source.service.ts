import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldValue,
  FormOptionFieldDefinition,
  FormDataSourceOptionFieldDefinition,
  FormDataSourceReference,
  isFormDataSourceFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { Repository } from 'typeorm';
import { BPMAuthContext } from '../bpm-auth';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { parseAndValidateFormSchemas } from '../form/form-schema.validator';
import { ApprovalInstanceStateEnum } from '../workflow-engine/workflow-engine.enums';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceErrorCode,
  BPMFormDataSourceException,
  BPMFormDataSourceForbiddenException,
} from './form-data-source.errors';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSource,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveResult,
  BPMFormDataSourceSearchResult,
} from './form-data-source.types';
import {
  assertControlSupported,
  callProvider,
  isRecord,
  isStringArray,
  readBindingValues,
  readDescriptorErrors,
  readDynamicOptionField,
  readMissingSourceCode,
  readOrderedResolvedOptions,
  readProviderResolvedOptions,
  readSourceOrThrow,
  readUnresolvedValues,
  readWaitingForFieldKeys,
  validateOptions,
  validateRequestedValues,
} from './form-data-source.validation';

export interface BPMFormDataSourcePreviewInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formDataJson?: string | null;
  readonly schemaJson: string;
  readonly searchText?: string | null;
  readonly uiSchemaJson?: string | null;
}

export interface BPMFormDataSourceRuntimeInput {
  readonly cursor?: string | null;
  readonly fieldKey: string;
  readonly formDataJson?: string | null;
  readonly instanceId?: string | null;
  readonly searchText?: string | null;
  readonly templateId?: string | null;
}

export interface BPMFormDataSourcePreviewResolveInput {
  readonly fieldKey: string;
  readonly formDataJson?: string | null;
  readonly schemaJson: string;
  readonly uiSchemaJson?: string | null;
  readonly valuesJson: string;
}

export interface BPMFormDataSourceRuntimeResolveInput {
  readonly fieldKey: string;
  readonly formDataJson?: string | null;
  readonly instanceId?: string | null;
  readonly templateId?: string | null;
  readonly valuesJson: string;
}

interface RuntimeSchemaContext {
  readonly schema: FormDefinitionSchema;
  readonly uiSchemaJson: string;
}

@Injectable()
export class FormDataSourceService {
  private readonly logger = new Logger(FormDataSourceService.name);

  constructor(
    @Inject(BPM_FORM_DATA_SOURCE_REGISTRY)
    private readonly registry: BPMFormDataSourceRegistry,
    @InjectRepository(ApprovalTemplateVersionEntity)
    private readonly approvalTemplateVersionRepository: Repository<ApprovalTemplateVersionEntity>,
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly workflowEngineService: WorkflowEngineService,
  ) {}

  listDescriptors(): readonly BPMFormDataSourceDescriptor[] {
    return this.registry
      .list()
      .flatMap((source) =>
        readDescriptorErrors(source.descriptor).length === 0
          ? [source.descriptor]
          : [],
      );
  }

  lintDefinitionSchemaEnvironment(
    schema: FormDefinitionSchema,
  ): readonly string[] {
    return schema.fields.flatMap((field, index) => {
      if (!isFormDataSourceFieldDefinition(field)) {
        return [];
      }

      const path = `schema.fields[${index}].dataSource`;
      const source = this.registry.get(
        field.dataSource.key,
        field.dataSource.version,
      );

      if (!source) {
        return [
          `${path} ${readMissingSourceCode(this.registry, field.dataSource.key)}`,
        ];
      }

      const descriptorErrors = readDescriptorErrors(source.descriptor);
      const controlErrors = this.readControlErrors(
        field,
        source.descriptor,
        path,
      );
      const bindingErrors = this.readBindingEnvironmentErrors(
        field.dataSource,
        source.descriptor,
        path,
      );

      return [...descriptorErrors, ...controlErrors, ...bindingErrors];
    });
  }

  async previewFormFieldOptions(
    input: BPMFormDataSourcePreviewInput,
    authContext: BPMAuthContext,
  ): Promise<BPMFormDataSourceOptionResult> {
    const { schema } = this.parseSchema(input.schemaJson, input.uiSchemaJson);
    this.assertEnvironmentSchema(schema);
    const field = this.readOptionField(schema, input.fieldKey);
    const formData = this.parseFormData(input.formDataJson);

    return this.searchFormFieldOptions({
      authContext,
      cursor: input.cursor ?? null,
      field,
      formData,
      searchText: input.searchText ?? '',
    });
  }

  async formFieldOptions(
    input: BPMFormDataSourceRuntimeInput,
    authContext: BPMAuthContext,
  ): Promise<BPMFormDataSourceOptionResult> {
    const context = await this.readRuntimeSchema(input, authContext);
    const field = this.readOptionField(context.schema, input.fieldKey);
    const formData = this.parseFormData(input.formDataJson);

    return this.searchFormFieldOptions({
      authContext,
      cursor: input.cursor ?? null,
      field,
      formData,
      searchText: input.searchText ?? '',
    });
  }

  async previewResolveFormFieldOptionValues(
    input: BPMFormDataSourcePreviewResolveInput,
    authContext: BPMAuthContext,
  ): Promise<BPMFormDataSourceResolveResult> {
    const { schema } = this.parseSchema(input.schemaJson, input.uiSchemaJson);
    this.assertEnvironmentSchema(schema);
    const field = this.readOptionField(schema, input.fieldKey);

    return this.reportFormFieldOptionValues({
      authContext,
      field,
      formData: this.parseFormData(input.formDataJson),
      values: this.parseValues(input.valuesJson),
    });
  }

  async resolveFormFieldOptionValues(
    input: BPMFormDataSourceRuntimeResolveInput,
    authContext: BPMAuthContext,
  ): Promise<BPMFormDataSourceResolveResult> {
    const context = await this.readRuntimeSchema(input, authContext);
    const field = this.readOptionField(context.schema, input.fieldKey);

    return this.reportFormFieldOptionValues({
      authContext,
      field,
      formData: this.parseFormData(input.formDataJson),
      values: this.parseValues(input.valuesJson),
    });
  }

  async searchFormFieldOptions(input: {
    readonly authContext: BPMAuthContext;
    readonly cursor: string | null;
    readonly field: FormOptionFieldDefinition;
    readonly formData: Readonly<Record<string, unknown>>;
    readonly searchText: string;
  }): Promise<BPMFormDataSourceOptionResult> {
    const field = readDynamicOptionField(input.field);
    const source = readSourceOrThrow(this.registry, field.dataSource);
    assertControlSupported(field, source.descriptor);
    const bindings = readBindingValues(
      field,
      source.descriptor,
      input.formData,
    );

    // Waiting on a dependency is a state, not a failure: the caller needs the
    // field names to prompt for, and an error carries none of them.
    if (bindings.missingParameters.length > 0) {
      return {
        dataSourceKey: source.descriptor.key,
        dataSourceVersion: source.descriptor.version,
        nextCursor: null,
        options: [],
        waitingForFieldKeys: readWaitingForFieldKeys(
          field,
          bindings.missingParameters,
        ),
      };
    }

    const searchText = input.searchText.trim();
    this.assertSearchRequest(source.descriptor, searchText, input.cursor);
    const result = await callProvider({
      call: (signal): Promise<BPMFormDataSourceSearchResult> =>
        source.search({
          authContext: input.authContext,
          bindings: bindings.values,
          cursor: input.cursor,
          searchText,
          signal,
        }),
      logger: this.logger,
      operation: 'search',
      source,
    });
    const options = this.validateSearchResult(result, source.descriptor);

    return {
      dataSourceKey: source.descriptor.key,
      dataSourceVersion: source.descriptor.version,
      nextCursor: this.readNextCursor(result, source.descriptor),
      options,
      waitingForFieldKeys: [],
    };
  }

  /**
   * Read-only value check for the renderer. A value the provider no longer
   * offers is reported in `unresolvedValues` rather than thrown, because the
   * field has to show which of several selected options went dead. Provider
   * contract breaches and transport failures still throw.
   */
  private async reportFormFieldOptionValues(input: {
    readonly authContext: BPMAuthContext;
    readonly field: FormOptionFieldDefinition;
    readonly formData: Readonly<Record<string, unknown>>;
    readonly values: readonly string[];
  }): Promise<BPMFormDataSourceResolveResult> {
    const field = readDynamicOptionField(input.field);
    const source = readSourceOrThrow(this.registry, field.dataSource);
    assertControlSupported(field, source.descriptor);

    // Nothing selected means nothing to check; asking the provider anyway would
    // be a request for the empty set.
    if (input.values.length === 0) {
      return {
        dataSourceKey: source.descriptor.key,
        dataSourceVersion: source.descriptor.version,
        options: [],
        unresolvedValues: [],
        waitingForFieldKeys: [],
      };
    }

    const values = validateRequestedValues(
      input.values,
      source.descriptor.maximumResultCount,
    );
    const bindings = readBindingValues(
      field,
      source.descriptor,
      input.formData,
    );

    if (bindings.missingParameters.length > 0) {
      return {
        dataSourceKey: source.descriptor.key,
        dataSourceVersion: source.descriptor.version,
        options: [],
        unresolvedValues: [],
        waitingForFieldKeys: readWaitingForFieldKeys(
          field,
          bindings.missingParameters,
        ),
      };
    }

    const result = await this.callResolve(
      source,
      input.authContext,
      bindings.values,
      values,
    );
    const options = readProviderResolvedOptions(
      result,
      values,
      source.descriptor.maximumResultCount,
    );

    return {
      dataSourceKey: source.descriptor.key,
      dataSourceVersion: source.descriptor.version,
      options: readOrderedResolvedOptions(options, values),
      unresolvedValues: readUnresolvedValues(options, values),
      waitingForFieldKeys: [],
    };
  }

  private callResolve(
    source: BPMFormDataSource,
    authContext: BPMAuthContext,
    bindings: Readonly<Record<string, FormFieldValue>>,
    values: readonly string[],
  ): Promise<readonly FormFieldOption[]> {
    return callProvider({
      call: (signal): Promise<readonly FormFieldOption[]> =>
        source.resolve({ authContext, bindings, signal, values }),
      logger: this.logger,
      operation: 'resolve',
      source,
    });
  }

  /**
   * Wraps the runtime context lookup so a failure from the storage layer never
   * reaches the caller verbatim. An id that is not a UUID, for instance, comes
   * back from Postgres as `invalid input syntax for type uuid: ...`, which
   * hands out the database engine and column type; ADR §3.12 requires a stable
   * code instead. Deliberate `HttpException`s — the not-found and forbidden
   * answers this method is built to give — pass straight through.
   */
  private async readRuntimeSchema(
    input: {
      readonly instanceId?: string | null;
      readonly templateId?: string | null;
    },
    authContext: BPMAuthContext,
  ): Promise<RuntimeSchemaContext> {
    try {
      return await this.readRuntimeSchemaContext(input, authContext);
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.warn(
        JSON.stringify({
          errorCode: BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
          operation: 'runtimeContext',
          status: 'error',
        }),
      );

      throw new BPMFormDataSourceForbiddenException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
      );
    }
  }

  private async readRuntimeSchemaContext(
    input: {
      readonly instanceId?: string | null;
      readonly templateId?: string | null;
    },
    authContext: BPMAuthContext,
  ): Promise<RuntimeSchemaContext> {
    const templateId = readOptionalText(input.templateId);
    const instanceId = readOptionalText(input.instanceId);

    if (Boolean(templateId) === Boolean(instanceId)) {
      throw new BPMFormDataSourceForbiddenException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
      );
    }

    if (templateId) {
      const launchableTemplates =
        await this.workflowEngineService.listLaunchableApprovalTemplates(
          authContext.memberId,
        );
      const template = launchableTemplates.find(
        (candidate) => candidate.id === templateId,
      );

      if (!template?.currentVersionId) {
        throw new BPMFormDataSourceForbiddenException(
          BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
        );
      }

      const templateVersion =
        await this.approvalTemplateVersionRepository.findOne({
          where: {
            id: template.currentVersionId,
            status: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          },
        });

      if (!templateVersion?.formDefinitionVersionId) {
        throw new BPMFormDataSourceForbiddenException(
          BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
        );
      }

      return this.readPublishedFormSchema(
        templateVersion.formDefinitionVersionId,
      );
    }

    const instance = await this.workflowEngineService.getApprovalInstance(
      instanceId as string,
      authContext,
    );

    if (
      instance.initiatorMemberId !== authContext.memberId ||
      instance.state !== ApprovalInstanceStateEnum.RETURNED
    ) {
      throw new BPMFormDataSourceForbiddenException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
      );
    }

    const snapshot = instance.formDefinitionSnapshot;
    const schema = isRecord(snapshot.schema) ? snapshot.schema : null;
    const uiSchema = isRecord(snapshot.uiSchema) ? snapshot.uiSchema : null;

    if (!schema || !uiSchema) {
      throw new BPMFormDataSourceForbiddenException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
      );
    }

    return this.parseSchema(JSON.stringify(schema), JSON.stringify(uiSchema));
  }

  private async readPublishedFormSchema(
    formDefinitionVersionId: string,
  ): Promise<RuntimeSchemaContext> {
    const version = await this.formDefinitionVersionRepository.findOne({
      where: {
        id: formDefinitionVersionId,
        status: FormDefinitionVersionStatusEnum.PUBLISHED,
      },
    });

    if (!version) {
      throw new BPMFormDataSourceForbiddenException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
      );
    }

    return this.parseSchema(
      JSON.stringify(version.schema),
      JSON.stringify(version.uiSchema),
    );
  }

  private parseSchema(
    schemaJson: string,
    uiSchemaJson: string | null | undefined,
  ): RuntimeSchemaContext {
    try {
      const parsed = parseAndValidateFormSchemas(schemaJson, uiSchemaJson);

      return {
        schema: parsed.schema,
        uiSchemaJson: JSON.stringify(parsed.uiSchema),
      };
    } catch {
      throw new BadRequestException('Form DataSource schema is invalid');
    }
  }

  private assertEnvironmentSchema(schema: FormDefinitionSchema): void {
    const errors = this.lintDefinitionSchemaEnvironment(schema);

    if (errors.length === 0) {
      return;
    }

    // Report the code of the FIRST error that carries one, deciding by line
    // shape: the emitted `<path>.dataSource <CODE>` form, else a binding line
    // whose code is implied rather than written (its prose quotes a
    // designer-chosen name that must never be read as a code), else the
    // descriptor fallback. Scanning the code list with `includes()` instead
    // made the answer depend on enum declaration order and would misfire the
    // day one code becomes a substring of another.
    const [code] = errors.flatMap((error) => {
      const candidate = readLintLineErrorCode(error);

      return candidate ? [candidate] : readBindingLintErrorCode(error);
    });

    throw new BPMFormDataSourceException(
      code ?? BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  }

  private parseFormData(
    formDataJson: string | null | undefined,
  ): Readonly<Record<string, unknown>> {
    if (!formDataJson?.trim()) {
      return {};
    }

    try {
      const value = JSON.parse(formDataJson) as unknown;

      if (isRecord(value)) {
        return value;
      }
    } catch {
      // The stable error below deliberately hides parser details.
    }

    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    );
  }

  private parseValues(valuesJson: string): readonly string[] {
    try {
      const value = JSON.parse(valuesJson) as unknown;

      if (isStringArray(value)) {
        return value;
      }
    } catch {
      // The stable error below deliberately hides parser details.
    }

    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    );
  }

  private readOptionField(
    schema: FormDefinitionSchema,
    fieldKey: string,
  ): FormOptionFieldDefinition {
    const field = schema.fields.find(
      (candidate) => candidate.fieldKey === fieldKey,
    );

    if (!field || !isFormOptionField(field)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.FIELD_NOT_DYNAMIC,
      );
    }

    return field;
  }

  private assertSearchRequest(
    descriptor: BPMFormDataSourceDescriptor,
    searchText: string,
    cursor: string | null,
  ): void {
    if (!descriptor.supportsSearch && searchText) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.SEARCH_NOT_SUPPORTED,
      );
    }

    if (
      descriptor.supportsSearch &&
      searchText.length > 0 &&
      searchText.length < descriptor.minimumSearchLength
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.SEARCH_TOO_SHORT,
      );
    }

    if (cursor && descriptor.paginationMode === 'NONE') {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      );
    }
  }

  private validateSearchResult(
    result: BPMFormDataSourceSearchResult,
    descriptor: BPMFormDataSourceDescriptor,
  ): readonly FormFieldOption[] {
    if (!isRecord(result) || !Array.isArray(result.options)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    if (
      result.options.length > descriptor.pageSize ||
      result.options.length > descriptor.maximumResultCount
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RESULT_LIMIT_EXCEEDED,
      );
    }

    return validateOptions(result.options);
  }

  private readNextCursor(
    result: BPMFormDataSourceSearchResult,
    descriptor: BPMFormDataSourceDescriptor,
  ): string | null {
    const nextCursor = result.nextCursor ?? null;

    if (
      (nextCursor !== null && typeof nextCursor !== 'string') ||
      (descriptor.paginationMode === 'NONE' && nextCursor !== null)
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    return nextCursor;
  }

  private readControlErrors(
    field: FormDataSourceOptionFieldDefinition,
    descriptor: BPMFormDataSourceDescriptor,
    path: string,
  ): readonly string[] {
    const control = field.type;
    const declaresControl = descriptor.supportedControls.includes(control);
    const allowsCompleteList =
      control !== 'radio' && control !== 'checkbox'
        ? true
        : descriptor.returnsCompleteList && descriptor.maximumResultCount <= 50;

    // Both checks fail the same control for the same reason, so report the code
    // once instead of repeating it in the field-level error list.
    return declaresControl && allowsCompleteList
      ? []
      : [`${path} ${BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL}`];
  }

  private readBindingEnvironmentErrors(
    reference: FormDataSourceReference,
    descriptor: BPMFormDataSourceDescriptor,
    path: string,
  ): readonly string[] {
    const parameterKeys = new Set(
      descriptor.parameters.map((parameter) => parameter.key),
    );
    const bindingKeys = new Set(
      reference.bindings.map((binding) => binding.parameter),
    );
    const missingRequired = descriptor.parameters
      .filter(
        (parameter) => parameter.required && !bindingKeys.has(parameter.key),
      )
      .map(
        (parameter) =>
          `${path}.bindings missing required parameter: ${parameter.key}`,
      );
    const unknownParameters = reference.bindings
      .filter((binding) => !parameterKeys.has(binding.parameter))
      .map((binding) => `${path}.bindings unknown parameter: ${binding.parameter}`);

    return [...missingRequired, ...unknownParameters];
  }
}

function isFormOptionField(
  field: FormFieldDefinition,
): field is FormOptionFieldDefinition {
  return (
    field.type === 'select' ||
    field.type === 'autocomplete' ||
    field.type === 'radio' ||
    field.type === 'checkbox'
  );
}

function readOptionalText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';

  return text || null;
}

/**
 * Matches only the code-bearing lint shape `<path>.dataSource <CODE>`. Reading
 * the trailing token alone would misreport prose such as
 * `...bindings unknown parameter: FORM_DATA_SOURCE_TIMEOUT`, where the code-like
 * text is a parameter name — chosen by the host in its descriptor, or by the
 * designer in a binding — rather than an error code.
 */
const LINT_LINE_CODE_PATTERN = /^\S+\.dataSource (FORM_DATA_SOURCE_[A-Z_]+)$/u;

/**
 * Binding lint lines stay prose because they quote a parameter name chosen by
 * the host or the designer, so their code is derived from the line shape
 * instead of being appended
 * to the text — appending it would put a raw code back on the designer's lint
 * panel, which the client formatter deliberately never rewrites inside prose.
 *
 * Without this the preview would fall back to `INVALID_DESCRIPTOR` ("contact
 * your administrator") for a binding the designer can fix themselves.
 */
const LINT_BINDING_LINE_PATTERN = /^schema\.fields\[\d+\]\.dataSource\.bindings /u;

function readBindingLintErrorCode(
  error: string,
): readonly BPMFormDataSourceErrorCode[] {
  return LINT_BINDING_LINE_PATTERN.test(error)
    ? [BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING]
    : [];
}

function readLintLineErrorCode(
  error: string,
): BPMFormDataSourceErrorCode | null {
  const candidate = LINT_LINE_CODE_PATTERN.exec(error)?.[1];

  return candidate && isFormDataSourceErrorCode(candidate) ? candidate : null;
}

function isFormDataSourceErrorCode(
  value: string,
): value is BPMFormDataSourceErrorCode {
  return (
    Object.values(BPM_FORM_DATA_SOURCE_ERROR_CODES) as readonly string[]
  ).includes(value);
}
