import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshot,
  FormDataSourceValueSnapshots,
  FormFieldOption,
  FormFieldValue,
  FormOptionFieldDefinition,
  isFormDataSourceFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
} from './form-data-source.errors';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSource,
  BPMFormDataSourceControl,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceParameter,
  BPMFormDataSourceParameterType,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveFieldInput,
  BPMFormDataSourceSnapshotResolutionInput,
  BPMFormDataSourceValueResolver,
} from './form-data-source.types';

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
export class FormDataSourceValueResolverService
  implements BPMFormDataSourceValueResolver
{
  private readonly logger = new Logger(FormDataSourceValueResolverService.name);

  constructor(
    @Inject(BPM_FORM_DATA_SOURCE_REGISTRY)
    private readonly registry: BPMFormDataSourceRegistry,
  ) {}

  async resolveFormDataOptionSnapshots(
    input: BPMFormDataSourceSnapshotResolutionInput,
  ): Promise<FormDataSourceValueSnapshots> {
    const entries = await Promise.all(
      input.schema.fields.map(async (field): Promise<readonly [string, FormDataSourceValueSnapshot] | null> => {
        if (!isFormDataSourceFieldDefinition(field)) {
          return null;
        }

        const values = readDynamicFieldValues(field, input.formData[field.fieldKey]);

        if (values.length === 0) {
          return null;
        }

        const previousSnapshot = input.previousSnapshots?.[field.fieldKey];
        const valueUnchanged = isSameFieldValue(
          input.previousFormData?.[field.fieldKey],
          input.formData[field.fieldKey],
        );
        const source = this.registry.get(
          field.dataSource.key,
          field.dataSource.version,
        );

        if (!source) {
          if (
            !input.revalidateAll &&
            previousSnapshot &&
            valueUnchanged &&
            previousSnapshot.dataSourceKey === field.dataSource.key &&
            previousSnapshot.dataSourceVersion === field.dataSource.version
          ) {
            return [field.fieldKey, previousSnapshot];
          }

          throw this.createSourceMissingException(field.dataSource.key);
        }

        this.assertDescriptor(source.descriptor);
        this.assertControlSupported(field, source.descriptor);
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

        const bindingHash = hashBindings(
          source.descriptor,
          bindings.values,
        );
        const canReuseSnapshot =
          !input.revalidateAll &&
          source.descriptor.revalidationPolicy ===
            'WHEN_VALUE_OR_BINDINGS_CHANGE' &&
          previousSnapshot?.dataSourceKey === source.descriptor.key &&
          previousSnapshot.dataSourceVersion === source.descriptor.version &&
          previousSnapshot.bindingHash === bindingHash &&
          valueUnchanged;

        if (canReuseSnapshot && previousSnapshot) {
          return [field.fieldKey, previousSnapshot];
        }

        const options = await this.resolveFormFieldOptions({
          authContext: input.authContext,
          field,
          formData: input.formData,
          values,
        });
        const snapshot: FormDataSourceValueSnapshot = {
          bindingHash,
          dataSourceKey: source.descriptor.key,
          dataSourceVersion: source.descriptor.version,
          options,
          validatedAt: new Date().toISOString(),
        };

        return [field.fieldKey, snapshot];
      }),
    );

    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, FormDataSourceValueSnapshot] =>
          entry !== null,
      ),
    );
  }

  async resolveFormFieldOptions(
    input: BPMFormDataSourceResolveFieldInput,
  ): Promise<readonly FormFieldOption[]> {
    const field = this.readDynamicOptionField(input.field);
    const source = this.readSourceOrThrow(field.dataSource);
    this.assertControlSupported(field, source.descriptor);
    const values = validateRequestedValues(
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
      (signal): Promise<readonly FormFieldOption[]> =>
        source.resolve({
          authContext: input.authContext,
          bindings: bindings.values,
          signal,
          values,
        }),
    );
    const options = validateResolveResult(
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
    reference: FormDataSourceOptionFieldDefinition['dataSource'],
  ): BPMFormDataSource {
    const source = this.registry.get(reference.key, reference.version);

    if (!source) {
      throw this.createSourceMissingException(reference.key);
    }

    this.assertDescriptor(source.descriptor);

    return source;
  }

  private createSourceMissingException(
    key: string,
  ): BPMFormDataSourceException {
    const hasKey = this.registry
      .list()
      .some((candidate) => {
        const candidateRecord = isRecord(candidate) ? candidate : null;
        const descriptor =
          candidateRecord && isRecord(candidateRecord.descriptor)
            ? candidateRecord.descriptor
            : null;

        return descriptor?.key === key;
      });

    return new BPMFormDataSourceException(
      hasKey
        ? BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_VERSION_MISSING
        : BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING,
    );
  }

  private assertDescriptor(descriptor: BPMFormDataSourceDescriptor): void {
    const valid =
      typeof descriptor.key === 'string' &&
      descriptor.key.trim().length > 0 &&
      typeof descriptor.label === 'string' &&
      descriptor.label.trim().length > 0 &&
      isPositiveInteger(descriptor.version) &&
      isPositiveInteger(descriptor.maximumResultCount) &&
      isPositiveInteger(descriptor.pageSize) &&
      isNonNegativeInteger(descriptor.minimumSearchLength) &&
      descriptor.pageSize <= descriptor.maximumResultCount &&
      (descriptor.paginationMode === 'CURSOR' ||
        descriptor.paginationMode === 'NONE') &&
      (descriptor.revalidationPolicy === 'ALWAYS' ||
        descriptor.revalidationPolicy === 'WHEN_VALUE_OR_BINDINGS_CHANGE') &&
      typeof descriptor.returnsCompleteList === 'boolean' &&
      typeof descriptor.supportsSearch === 'boolean' &&
      Array.isArray(descriptor.parameters) &&
      Array.isArray(descriptor.supportedControls) &&
      descriptor.supportedControls.every((control) =>
        SOURCE_CONTROLS.includes(control),
      ) &&
      descriptor.parameters.every((parameter) =>
        isValidParameter(parameter),
      ) &&
      new Set(descriptor.parameters.map((parameter) => parameter.key)).size ===
        descriptor.parameters.length &&
      new Set(descriptor.supportedControls).size ===
        descriptor.supportedControls.length;

    if (!valid) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_DESCRIPTOR,
      );
    }
  }

  private assertControlSupported(
    field: FormOptionFieldDefinition,
    descriptor: BPMFormDataSourceDescriptor,
  ): void {
    if (!descriptor.supportedControls.includes(field.type)) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL,
      );
    }

    if (
      (field.type === 'radio' || field.type === 'checkbox') &&
      (!descriptor.returnsCompleteList || descriptor.maximumResultCount > 50)
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.UNSUPPORTED_CONTROL,
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

      assertParameterValue(parameter, nextValue);

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

  private async callProvider<TValue>(
    source: BPMFormDataSource,
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
          operation: 'resolve',
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
          operation: 'resolve',
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
}

function readDynamicFieldValues(
  field: FormDataSourceOptionFieldDefinition,
  value: unknown,
): readonly string[] {
  const mode = readFormFieldSelectionMode(field);

  if (value === null || typeof value === 'undefined' || value === '') {
    return [];
  }

  if (mode === 'multiple') {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string' || !item.trim()) ||
      new Set(value).size !== value.length
    ) {
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      );
    }

    return [...value];
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    );
  }

  return [value];
}

function validateRequestedValues(
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

function validateResolveResult(
  result: unknown,
  values: readonly string[],
  maximumResultCount: number,
): readonly FormFieldOption[] {
  if (!Array.isArray(result) || result.length > maximumResultCount) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
    );
  }

  const options = validateOptions(result);
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

function validateOptions(value: unknown): readonly FormFieldOption[] {
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

function assertParameterValue(
  parameter: BPMFormDataSourceParameter,
  value: FormFieldValue,
): void {
  const valid =
    (parameter.type === 'BOOLEAN' && typeof value === 'boolean') ||
    (parameter.type === 'NUMBER' &&
      typeof value === 'number' &&
      Number.isFinite(value)) ||
    (parameter.type === 'STRING' && typeof value === 'string') ||
    (parameter.type === 'STRING_ARRAY' && isStringArray(value)) ||
    value === null;

  if (!valid) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    );
  }
}

function readFormDataValue(value: unknown): FormFieldValue | undefined {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
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

function hashBindings(
  descriptor: BPMFormDataSourceDescriptor,
  values: Readonly<Record<string, FormFieldValue>>,
): string {
  const orderedValues = descriptor.parameters.map((parameter) => [
    parameter.key,
    values[parameter.key] ?? null,
  ]);

  return createHash('sha256')
    .update(
      JSON.stringify({
        dataSourceKey: descriptor.key,
        dataSourceVersion: descriptor.version,
        values: orderedValues,
      }),
    )
    .digest('hex');
}

function isSameFieldValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isFormFieldOption(value: unknown): value is FormFieldOption {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.value === 'string'
  );
}

function isValidParameter(value: unknown): value is BPMFormDataSourceParameter {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    value.key.trim().length > 0 &&
    typeof value.required === 'boolean' &&
    PARAMETER_TYPES.includes(value.type as BPMFormDataSourceParameterType)
  );
}

function isStringArray(value: FormFieldValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringArrayValue(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
