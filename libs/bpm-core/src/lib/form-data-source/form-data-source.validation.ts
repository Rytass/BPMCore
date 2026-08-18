import { Logger } from '@nestjs/common';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceReference,
  FormFieldOption,
  FormFieldValue,
  FormOptionFieldDefinition,
  isFormDataSourceFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
} from './form-data-source.errors';
import {
  BPMFormDataSource,
  BPMFormDataSourceControl,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceParameter,
  BPMFormDataSourceParameterType,
  BPMFormDataSourceRegistry,
} from './form-data-source.types';

/**
 * Shared guards for the two entry points into a host DataSource — the read-only
 * query service and the authoritative submit-time value resolver. Both used to
 * carry their own copy of every helper below and had already drifted apart
 * (one rejected non-finite numbers and array form data, the other did not), so
 * a search could accept a binding value that submit then refused. Keep this the
 * single implementation; it is internal and deliberately not re-exported from
 * the package index.
 */

export interface ResolvedBindingValues {
  readonly missingParameters: readonly string[];
  readonly values: Readonly<Record<string, FormFieldValue>>;
}

interface TimeoutMarker extends Error {
  readonly kind: 'FORM_DATA_SOURCE_TIMEOUT';
}

export const MAX_PARAMETER_BYTES = 16_384;
export const PROVIDER_TIMEOUT_MS = 5_000;

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

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFormFieldOption(value: unknown): value is FormFieldOption {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.value === 'string'
  );
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * `Infinity` and `NaN` survive `typeof value === 'number'` but not
 * `JSON.stringify`, which turns them into `null`. Rejecting them here keeps a
 * provider from being handed a null it never declared a parameter for.
 */
export function readFormDataValue(value: unknown): FormFieldValue | undefined {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'string' ||
    isStringArray(value)
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

export function isPresentFormDataValue(
  value: FormFieldValue | undefined,
): boolean {
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

export function assertParameterValue(
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

export function readBindingValues(
  field: FormDataSourceOptionFieldDefinition,
  descriptor: BPMFormDataSourceDescriptor,
  formData: Readonly<Record<string, unknown>>,
): ResolvedBindingValues {
  const parameterByKey = new Map(
    descriptor.parameters.map(
      (parameter): readonly [string, BPMFormDataSourceParameter] => [
        parameter.key,
        parameter,
      ],
    ),
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

/**
 * Names the fields the filler still has to complete before a query can run.
 * The renderer cannot derive this itself — it has no descriptor, so it cannot
 * tell a required parameter from an optional one and would disable a control
 * forever over an unfilled field bound to an optional parameter.
 *
 * A required parameter that no binding feeds, or one fed by a constant the
 * schema left empty, is a schema defect nobody can fix by typing, so it stays
 * an `INVALID_BINDING` rather than an endless wait.
 */
export function readWaitingForFieldKeys(
  field: FormDataSourceOptionFieldDefinition,
  missingParameters: readonly string[],
): readonly string[] {
  if (missingParameters.length === 0) {
    return [];
  }

  const missing = new Set(missingParameters);
  const waitingBindings = field.dataSource.bindings.filter((binding) =>
    missing.has(binding.parameter),
  );
  const coveredParameters = new Set(
    waitingBindings.map((binding) => binding.parameter),
  );
  const fieldKeys = waitingBindings.flatMap((binding) =>
    binding.from.kind === 'FIELD' ? [binding.from.fieldKey] : [],
  );

  if (
    coveredParameters.size !== missing.size ||
    fieldKeys.length !== waitingBindings.length
  ) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
    );
  }

  return [...new Set(fieldKeys)];
}

export function validateRequestedValues(
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

export function validateOptions(value: unknown): readonly FormFieldOption[] {
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

/**
 * Enforces only the provider's side of the contract: well-formed options, no
 * duplicates, nothing the caller never asked for. Whether every requested value
 * came back is the caller's decision, because the read-only resolve query
 * reports the gap while submit must reject the whole batch.
 */
export function readProviderResolvedOptions(
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

  // A value the caller never asked for is a provider contract breach.
  if (options.some((option) => !requestedValues.has(option.value))) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_PROVIDER_RESULT,
    );
  }

  return options;
}

/**
 * The all-or-nothing rule that guards everything written into an instance:
 * a value the provider no longer offers fails the whole resolve.
 */
export function validateResolveResult(
  result: unknown,
  values: readonly string[],
  maximumResultCount: number,
): readonly FormFieldOption[] {
  const options = readProviderResolvedOptions(
    result,
    values,
    maximumResultCount,
  );

  // Every requested value resolved to exactly one option, or the submitted
  // value is simply no longer selectable — that is a user-facing failure.
  if (options.length !== values.length) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.VALUE_NOT_RESOLVED,
    );
  }

  return options;
}

export function readOrderedResolvedOptions(
  options: readonly FormFieldOption[],
  values: readonly string[],
): readonly FormFieldOption[] {
  const optionByValue = new Map(
    options.map((option): readonly [string, FormFieldOption] => [
      option.value,
      option,
    ]),
  );

  return values.flatMap((value) => {
    const option = optionByValue.get(value);

    return option ? [option] : [];
  });
}

export function readUnresolvedValues(
  options: readonly FormFieldOption[],
  values: readonly string[],
): readonly string[] {
  const resolvedValues = new Set(options.map((option) => option.value));

  return values.filter((value) => !resolvedValues.has(value));
}

export function readDynamicOptionField(
  field: FormOptionFieldDefinition,
): FormDataSourceOptionFieldDefinition {
  if (!isFormDataSourceFieldDefinition(field)) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.FIELD_NOT_DYNAMIC,
    );
  }

  return field;
}

export function assertControlSupported(
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

/**
 * A key the host never registered and a key whose requested version was
 * dropped are different operational problems, so they keep distinct codes:
 * the first tells the designer the source is gone, the second that only this
 * version is.
 */
export function readMissingSourceCode(
  registry: BPMFormDataSourceRegistry,
  key: string,
):
  | typeof BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING
  | typeof BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_VERSION_MISSING {
  const hasKey = registry.list().some((candidate) => {
    const descriptor = isRecord(candidate) && isRecord(candidate.descriptor)
      ? candidate.descriptor
      : null;

    return descriptor?.key === key;
  });

  return hasKey
    ? BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_VERSION_MISSING
    : BPM_FORM_DATA_SOURCE_ERROR_CODES.DATA_SOURCE_MISSING;
}

export function readSourceOrThrow(
  registry: BPMFormDataSourceRegistry,
  reference: FormDataSourceReference,
): BPMFormDataSource {
  const source = registry.get(reference.key, reference.version);

  if (!source) {
    throw new BPMFormDataSourceException(
      readMissingSourceCode(registry, reference.key),
    );
  }

  assertDescriptor(source.descriptor);

  return source;
}

export function assertDescriptor(
  descriptor: BPMFormDataSourceDescriptor,
): void {
  if (readDescriptorErrors(descriptor).length > 0) {
    throw new BPMFormDataSourceException(
      BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  }
}

export function readDescriptorErrors(
  descriptor: BPMFormDataSourceDescriptor,
): readonly string[] {
  const descriptorValue: Readonly<Record<string, unknown>> = isRecord(descriptor)
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
        readParameterErrors(parameter, index),
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
          parameterKeys.filter((key, index, keys) => keys.indexOf(key) !== index),
        ),
      ]
    : [];
  const duplicateParameterErrors = duplicateParameterKeys.map(
    (key) => `descriptor.parameters.key is duplicated: ${key}`,
  );

  return [...errors, ...parameterErrors, ...duplicateParameterErrors];
}

function readParameterErrors(
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
    ...(PARAMETER_TYPES.includes(
      parameterValue.type as BPMFormDataSourceParameterType,
    )
      ? []
      : [`descriptor.parameters[${index}].type is invalid`]),
  ];
}

export async function callProvider<TValue>(input: {
  readonly call: (signal: AbortSignal) => Promise<TValue>;
  readonly logger: Logger;
  readonly operation: 'resolve' | 'search';
  readonly source: BPMFormDataSource;
}): Promise<TValue> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      input.call(controller.signal),
      new Promise<TValue>((_resolve, reject) => {
        timeoutId = setTimeout((): void => {
          controller.abort();
          const timeout = new Error('provider timeout') as TimeoutMarker;
          Object.assign(timeout, { kind: 'FORM_DATA_SOURCE_TIMEOUT' });
          reject(timeout);
        }, PROVIDER_TIMEOUT_MS);
      }),
    ]);

    input.logger.log(
      JSON.stringify({
        dataSourceKey: input.source.descriptor.key,
        dataSourceVersion: input.source.descriptor.version,
        durationMs: Date.now() - startedAt,
        operation: input.operation,
        status: 'success',
      }),
    );

    return result;
  } catch (error: unknown) {
    const code = isTimeoutMarker(error)
      ? BPM_FORM_DATA_SOURCE_ERROR_CODES.TIMEOUT
      : BPM_FORM_DATA_SOURCE_ERROR_CODES.PROVIDER_FAILURE;
    input.logger.warn(
      JSON.stringify({
        dataSourceKey: input.source.descriptor.key,
        dataSourceVersion: input.source.descriptor.version,
        durationMs: Date.now() - startedAt,
        errorCode: code,
        operation: input.operation,
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

function isTimeoutMarker(value: unknown): value is TimeoutMarker {
  return (
    value instanceof Error &&
    (value as Error & { readonly kind?: unknown }).kind ===
      'FORM_DATA_SOURCE_TIMEOUT'
  );
}
