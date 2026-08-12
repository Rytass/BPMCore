import {
  BadRequestException,
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
  BPMFormDataSourceException,
  BPMFormDataSourceForbiddenException,
} from './form-data-source.errors';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSource,
  BPMFormDataSourceControl,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
  BPMFormDataSourceParameter,
  BPMFormDataSourceParameterType,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveFieldInput,
  BPMFormDataSourceSearchResult,
} from './form-data-source.types';

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

interface RuntimeSchemaContext {
  readonly schema: FormDefinitionSchema;
  readonly uiSchemaJson: string;
}

interface ResolvedBindingValues {
  readonly values: Readonly<Record<string, FormFieldValue>>;
  readonly missingParameters: readonly string[];
}

interface TimeoutMarker extends Error {
  readonly kind: 'FORM_DATA_SOURCE_TIMEOUT';
}

const MAX_PARAMETER_BYTES = 16_384;
const PROVIDER_TIMEOUT_MS = 5_000;
const SOURCE_CONTROLS: readonly BPMFormDataSourceControl[] = [
  'autocomplete',
  'checkbox',
  'radio',
  'select',
];
const PARAMETER_TYPES: readonly BPMFormDataSourceParameterType[] = [
  'BOOLEAN',
  'NUMBER',
  'STRING',
  'STRING_ARRAY',
];

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
    return this.registry.list().flatMap((source) =>
      this.readDescriptorErrors(source.descriptor).length === 0
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
          `${path} ${BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_VERSION_MISSING}`,
        ];
      }

      const descriptorErrors = this.readDescriptorErrors(source.descriptor);
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

  async searchFormFieldOptions(input: {
    readonly authContext: BPMAuthContext;
    readonly cursor: string | null;
    readonly field: FormOptionFieldDefinition;
    readonly formData: Readonly<Record<string, unknown>>;
    readonly searchText: string;
  }): Promise<BPMFormDataSourceOptionResult> {
    const field = this.readDynamicOptionField(input.field);
    const source = this.readSourceOrThrow(field.dataSource);
    this.assertControlSupported(field, source.descriptor);
    const bindings = this.readBindingValues(field, source.descriptor, input.formData);

    if (bindings.missingParameters.length > 0) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
      );
    }

    const searchText = input.searchText.trim();
    this.assertSearchRequest(source.descriptor, searchText, input.cursor);
    const result = await this.callProvider(
      source,
      'search',
      (signal): Promise<BPMFormDataSourceSearchResult> =>
        source.search({
          authContext: input.authContext,
          bindings: bindings.values,
          cursor: input.cursor,
          searchText,
          signal,
        }),
    );
    const options = this.validateSearchResult(result, source.descriptor);

    return {
      dataSourceKey: source.descriptor.key,
      dataSourceVersion: source.descriptor.version,
      nextCursor: this.readNextCursor(result, source.descriptor),
      options,
    };
  }

  async resolveFormFieldOptions(
    input: BPMFormDataSourceResolveFieldInput,
  ): Promise<readonly FormFieldOption[]> {
    const field = this.readDynamicOptionField(input.field);
    const source = this.readSourceOrThrow(field.dataSource);
    this.assertControlSupported(field, source.descriptor);
    const values = this.validateRequestedValues(
      input.values,
      source.descriptor.maximumResultCount,
    );
    const bindings = this.readBindingValues(
      field,
      source.descriptor,
      input.formData,
    );

    if (bindings.missingParameters.length > 0) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
      );
    }

    const result = await this.callProvider(
      source,
      'resolve',
      (signal): Promise<readonly FormFieldOption[]> =>
        source.resolve({
          authContext: input.authContext,
          bindings: bindings.values,
          signal,
          values,
        }),
    );
    const options = this.validateResolveResult(
      result,
      values,
      source.descriptor.maximumResultCount,
    );
    const optionByValue = new Map(
      options.map((option): readonly [string, FormFieldOption] => [
        option.value,
        option,
      ]),
    );

    return values.map((value) => optionByValue.get(value) as FormFieldOption);
  }

  private async readRuntimeSchema(
    input: BPMFormDataSourceRuntimeInput,
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

      return this.readPublishedFormSchema(templateVersion.formDefinitionVersionId);
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

    return this.parseSchema(JSON.stringify(version.schema), JSON.stringify(version.uiSchema));
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

    const code = Object.values(BPM_FORM_DATA_SOURCE_ERROR_CODES).find(
      (candidate) => errors.some((error) => error.includes(candidate)),
    );

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

  private readOptionField(
    schema: FormDefinitionSchema,
    fieldKey: string,
  ): FormOptionFieldDefinition {
    const field = schema.fields.find((candidate) => candidate.fieldKey === fieldKey);

    if (!field || !isFormOptionField(field)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.FIELD_NOT_DYNAMIC,
      );
    }

    return field;
  }

  private readDynamicOptionField(
    field: FormOptionFieldDefinition,
  ): FormDataSourceOptionFieldDefinition {
    if (!isFormDataSourceFieldDefinition(field)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.FIELD_NOT_DYNAMIC,
      );
    }

    return field;
  }

  private readSourceOrThrow(
    reference: FormDataSourceReference,
  ): BPMFormDataSource {
    const source = this.registry.get(reference.key, reference.version);

    if (!source) {
      const hasKey = this.registry
        .list()
        .some((candidate) => candidate.descriptor.key === reference.key);

      throw new BPMFormDataSourceException(
        hasKey
          ? BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_VERSION_MISSING
          : BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING,
      );
    }

    const descriptorErrors = this.readDescriptorErrors(source.descriptor);

    if (descriptorErrors.length > 0) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_DESCRIPTOR,
      );
    }

    return source;
  }

  private assertControlSupported(
    field: FormOptionFieldDefinition,
    descriptor: BPMFormDataSourceDescriptor,
  ): void {
    const control = field.type;

    if (!descriptor.supportedControls.includes(control)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL,
      );
    }

    if (
      (control === 'radio' || control === 'checkbox') &&
      (!descriptor.returnsCompleteList || descriptor.maximumResultCount > 50)
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL,
      );
    }
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

    if (descriptor.supportsSearch && searchText.length < descriptor.minimumSearchLength) {
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

  private readBindingValues(
    field: FormDataSourceOptionFieldDefinition,
    descriptor: BPMFormDataSourceDescriptor,
    formData: Readonly<Record<string, unknown>>,
  ): ResolvedBindingValues {
    const parameterByKey = new Map(
      descriptor.parameters.map((parameter): readonly [string, BPMFormDataSourceParameter] => [
        parameter.key,
        parameter,
      ]),
    );
    const bindingValues = field.dataSource.bindings.reduce<
      Readonly<Record<string, FormFieldValue>>
    >((values, binding) => {
      const parameter = parameterByKey.get(binding.parameter);

      if (!parameter) {
        throw new BPMFormDataSourceException(
          BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
        );
      }

      const nextValue =
        binding.from.kind === 'FIELD'
          ? readFormDataValue(formData[binding.from.fieldKey])
          : binding.from.value;

      if (typeof nextValue === 'undefined') {
        return values;
      }

      this.assertParameterValue(parameter, nextValue);

      return { ...values, [parameter.key]: nextValue };
    }, {});
    const missingParameters = descriptor.parameters
      .filter((parameter) => parameter.required)
      .filter((parameter) => !isPresentFormDataValue(bindingValues[parameter.key]))
      .map((parameter) => parameter.key);

    if (JSON.stringify(bindingValues).length > MAX_PARAMETER_BYTES) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.PARAMETER_LIMIT_EXCEEDED,
      );
    }

    return { missingParameters, values: bindingValues };
  }

  private assertParameterValue(
    parameter: BPMFormDataSourceParameter,
    value: FormFieldValue,
  ): void {
    const valid =
      (parameter.type === 'BOOLEAN' && typeof value === 'boolean') ||
      (parameter.type === 'NUMBER' && typeof value === 'number') ||
      (parameter.type === 'STRING' && typeof value === 'string') ||
      (parameter.type === 'STRING_ARRAY' && isStringArray(value)) ||
      value === null;

    if (!valid) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      );
    }
  }

  private validateRequestedValues(
    values: readonly string[],
    maximumResultCount: number,
  ): readonly string[] {
    if (
      values.length === 0 ||
      values.some((value) => !value.trim()) ||
      new Set(values).size !== values.length
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      );
    }

    if (values.length > maximumResultCount) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.RESULT_LIMIT_EXCEEDED,
      );
    }

    return [...values];
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

    return this.validateOptions(result.options);
  }

  private validateResolveResult(
    result: readonly FormFieldOption[],
    values: readonly string[],
    maximumResultCount: number,
  ): readonly FormFieldOption[] {
    if (!Array.isArray(result) || result.length > maximumResultCount) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    const options = this.validateOptions(result);
    const requestedValues = new Set(values);

    if (
      options.length !== values.length ||
      options.some((option) => !requestedValues.has(option.value))
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    return options;
  }

  private validateOptions(value: unknown): readonly FormFieldOption[] {
    if (!Array.isArray(value)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    const options = value.filter(isFormFieldOption);

    if (
      options.length !== value.length ||
      options.some((option) => !option.label.trim() || !option.value.trim()) ||
      new Set(options.map((option) => option.value)).size !== options.length
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
      );
    }

    return options;
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

  private async callProvider<TValue>(
    source: BPMFormDataSource,
    operation: 'resolve' | 'search',
    call: (signal: AbortSignal) => Promise<TValue>,
  ): Promise<TValue> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    try {
      const result = await Promise.race([
        call(controller.signal),
        new Promise<TValue>((_resolve, reject) => {
          timeoutId = setTimeout((): void => {
            controller.abort();
            const timeout = new Error('provider timeout') as TimeoutMarker;
            Object.assign(timeout, { kind: 'FORM_DATA_SOURCE_TIMEOUT' });
            reject(timeout);
          }, PROVIDER_TIMEOUT_MS);
        }),
      ]);

      this.logger.log(
        JSON.stringify({
          dataSourceKey: source.descriptor.key,
          dataSourceVersion: source.descriptor.version,
          durationMs: Date.now() - startedAt,
          operation,
          status: 'success',
        }),
      );

      return result;
    } catch (error: unknown) {
      const code = isTimeoutMarker(error)
        ? BPM_FORM_DATA_SOURCE_ERROR_CODES.TIMEOUT
        : BPM_FORM_DATA_SOURCE_ERROR_CODES.PROVIDER_FAILURE;
      this.logger.warn(
        JSON.stringify({
          dataSourceKey: source.descriptor.key,
          dataSourceVersion: source.descriptor.version,
          durationMs: Date.now() - startedAt,
          errorCode: code,
          operation,
          status: 'error',
        }),
      );
      throw new BPMFormDataSourceException(code);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private readDescriptorErrors(
    descriptor: BPMFormDataSourceDescriptor,
  ): readonly string[] {
    const descriptorValue: Readonly<Record<string, unknown>> = isRecord(
      descriptor,
    )
      ? descriptor
      : {};
    const parameters = Array.isArray(descriptorValue.parameters)
      ? descriptorValue.parameters
      : [];
    const supportedControls = Array.isArray(descriptorValue.supportedControls)
      ? descriptorValue.supportedControls
      : [];
    const version = descriptorValue.version;
    const maximumResultCount = descriptorValue.maximumResultCount;
    const pageSize = descriptorValue.pageSize;
    const minimumSearchLength = descriptorValue.minimumSearchLength;
    const errors = [
      ...(typeof descriptorValue.key === 'string' && descriptorValue.key.trim()
        ? []
        : ['descriptor.key is required']),
      ...(typeof descriptorValue.label === 'string' && descriptorValue.label.trim()
        ? []
        : ['descriptor.label is required']),
      ...(isPositiveInteger(version)
        ? []
        : ['descriptor.version must be a positive integer']),
      ...(isPositiveInteger(maximumResultCount)
        ? []
        : ['descriptor.maximumResultCount must be positive']),
      ...(isPositiveInteger(pageSize)
        ? []
        : ['descriptor.pageSize must be positive']),
      ...(isNonNegativeInteger(minimumSearchLength)
        ? []
        : ['descriptor.minimumSearchLength must be non-negative']),
      ...(typeof pageSize === 'number' &&
      typeof maximumResultCount === 'number' &&
      pageSize <= maximumResultCount
        ? []
        : ['descriptor.pageSize cannot exceed descriptor.maximumResultCount']),
      ...(descriptorValue.paginationMode === 'CURSOR' ||
      descriptorValue.paginationMode === 'NONE'
        ? []
        : ['descriptor.paginationMode is invalid']),
      ...(descriptorValue.revalidationPolicy === 'ALWAYS' ||
      descriptorValue.revalidationPolicy === 'WHEN_VALUE_OR_BINDINGS_CHANGE'
        ? []
        : ['descriptor.revalidationPolicy is invalid']),
      ...(Array.isArray(descriptorValue.parameters)
        ? []
        : ['descriptor.parameters must be an array']),
      ...(typeof descriptorValue.returnsCompleteList === 'boolean'
        ? []
        : ['descriptor.returnsCompleteList must be boolean']),
      ...(typeof descriptorValue.supportsSearch === 'boolean'
        ? []
        : ['descriptor.supportsSearch must be boolean']),
      ...(Array.isArray(descriptorValue.supportedControls) &&
      supportedControls.every((control) =>
        SOURCE_CONTROLS.includes(control as BPMFormDataSourceControl),
      )
        ? []
        : ['descriptor.supportedControls contains an invalid control']),
      ...(new Set(supportedControls).size === supportedControls.length
        ? []
        : ['descriptor.supportedControls contains duplicates']),
    ];
    const parameterErrors = Array.isArray(descriptorValue.parameters)
      ? parameters.flatMap((parameter, index) =>
          this.readParameterErrors(parameter, index),
        )
      : [];
    const parameterKeys = parameters.flatMap((parameter) =>
      isRecord(parameter) && typeof parameter.key === 'string'
        ? [parameter.key]
        : [],
    );
    const duplicateParameterKeys = Array.isArray(descriptorValue.parameters)
      ? [
          ...new Set(
            parameterKeys
              .filter((key, index, keys) => keys.indexOf(key) !== index),
          ),
        ]
      : [];
    const duplicateParameterErrors = duplicateParameterKeys.map(
      (key) => `descriptor.parameters.key is duplicated: ${key}`,
    );

    return [...errors, ...parameterErrors, ...duplicateParameterErrors];
  }

  private readParameterErrors(
    parameter: unknown,
    index: number,
  ): readonly string[] {
    const parameterValue = isRecord(parameter) ? parameter : {};

    return [
      ...(typeof parameterValue.key === 'string' && parameterValue.key.trim()
        ? []
        : [`descriptor.parameters[${index}].key is required`]),
      ...(typeof parameterValue.required === 'boolean'
        ? []
        : [`descriptor.parameters[${index}].required must be boolean`]),
      ...(PARAMETER_TYPES.includes(parameterValue.type as BPMFormDataSourceParameterType)
        ? []
        : [`descriptor.parameters[${index}].type is invalid`]),
    ];
  }

  private readControlErrors(
    field: FormDataSourceOptionFieldDefinition,
    descriptor: BPMFormDataSourceDescriptor,
    path: string,
  ): readonly string[] {
    const control = field.type;
    const errors = descriptor.supportedControls.includes(control)
      ? []
      : [`${path} ${BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL}`];

    return control === 'radio' || control === 'checkbox'
      ? descriptor.returnsCompleteList && descriptor.maximumResultCount <= 50
        ? errors
        : [
            ...errors,
            `${path} ${BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL}`,
          ]
      : errors;
  }

  private readBindingEnvironmentErrors(
    reference: FormDataSourceReference,
    descriptor: BPMFormDataSourceDescriptor,
    path: string,
  ): readonly string[] {
    const parameterKeys = new Set(descriptor.parameters.map((parameter) => parameter.key));
    const bindingKeys = new Set(reference.bindings.map((binding) => binding.parameter));
    const missingRequired = descriptor.parameters
      .filter((parameter) => parameter.required && !bindingKeys.has(parameter.key))
      .map((parameter) => `${path}.bindings missing required parameter: ${parameter.key}`);
    const unknownParameters = reference.bindings
      .filter((binding) => !parameterKeys.has(binding.parameter))
      .map((binding) => `${path}.bindings unknown parameter: ${binding.parameter}`);

    return [...missingRequired, ...unknownParameters];
  }
}

function isFormOptionField(field: FormFieldDefinition): field is FormOptionFieldDefinition {
  return (
    field.type === 'select' ||
    field.type === 'autocomplete' ||
    field.type === 'radio' ||
    field.type === 'checkbox'
  );
}

function isFormFieldOption(value: unknown): value is FormFieldOption {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.value === 'string'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: FormFieldValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readFormDataValue(value: unknown): FormFieldValue | undefined {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    isStringArrayValue(value)
  ) {
    return value;
  }

  if (typeof value === 'undefined') {
    return undefined;
  }

  throw new BPMFormDataSourceException(
    BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
  );
}

function isStringArrayValue(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPresentFormDataValue(value: FormFieldValue | undefined): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function readOptionalText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';

  return text || null;
}

function isTimeoutMarker(value: unknown): value is TimeoutMarker {
  return (
    value instanceof Error &&
    (value as Error & { readonly kind?: unknown }).kind ===
      'FORM_DATA_SOURCE_TIMEOUT'
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
