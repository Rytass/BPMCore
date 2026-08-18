import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshot,
  FormDataSourceValueSnapshots,
  FormFieldOption,
  FormFieldValue,
  isFormDataSourceFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
} from './form-data-source.errors';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveFieldInput,
  BPMFormDataSourceSnapshotResolutionInput,
  BPMFormDataSourceValueResolver,
} from './form-data-source.types';
import {
  assertControlSupported,
  assertDescriptor,
  callProvider,
  readBindingValues,
  readDynamicOptionField,
  readMissingSourceCode,
  readOrderedResolvedOptions,
  readSourceOrThrow,
  validateRequestedValues,
  validateResolveResult,
} from './form-data-source.validation';

/**
 * Submitting a form with ten dynamic fields used to open ten provider calls at
 * once, each with its own five-second budget. Bounding them keeps a single
 * submit from becoming a burst against the host's upstream systems.
 */
const MAX_CONCURRENT_PROVIDER_CALLS = 4;

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
    const entries = await mapWithConcurrencyLimit(
      input.schema.fields,
      MAX_CONCURRENT_PROVIDER_CALLS,
      async (
        field,
      ): Promise<readonly [string, FormDataSourceValueSnapshot] | null> => {
        if (!isFormDataSourceFieldDefinition(field)) {
          return null;
        }

        const values = readDynamicFieldValues(
          field,
          input.formData[field.fieldKey],
        );

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
          // Without the descriptor the snapshot's own record of the policy is
          // the only evidence left. An `ALWAYS` source is exactly the kind that
          // must not be carried forward unverified — headcount, contracts,
          // anything whose validity is the point of the check. A snapshot
          // written before the field existed keeps the old reuse behaviour so
          // returned instances stay resubmittable.
          if (
            !input.revalidateAll &&
            previousSnapshot &&
            previousSnapshot.revalidationPolicy !== 'ALWAYS' &&
            valueUnchanged &&
            previousSnapshot.dataSourceKey === field.dataSource.key &&
            previousSnapshot.dataSourceVersion === field.dataSource.version
          ) {
            return [field.fieldKey, previousSnapshot];
          }

          throw new BPMFormDataSourceException(
            readMissingSourceCode(this.registry, field.dataSource.key),
          );
        }

        const { descriptor } = source;
        assertDescriptor(descriptor);
        assertControlSupported(field, descriptor);
        const bindings = readBindingValues(field, descriptor, input.formData);

        if (bindings.missingParameters.length > 0) {
          throw new BPMFormDataSourceException(
            BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
          );
        }

        const bindingHash = hashBindings(descriptor, bindings.values);
        const canReuseSnapshot =
          !input.revalidateAll &&
          descriptor.revalidationPolicy === 'WHEN_VALUE_OR_BINDINGS_CHANGE' &&
          previousSnapshot?.dataSourceKey === descriptor.key &&
          previousSnapshot.dataSourceVersion === descriptor.version &&
          previousSnapshot.bindingHash === bindingHash &&
          valueUnchanged;

        if (canReuseSnapshot && previousSnapshot) {
          // Stamp the policy while the descriptor is still readable, so a
          // snapshot written before this field existed stops being ambiguous
          // the moment it is carried forward.
          return [
            field.fieldKey,
            {
              ...previousSnapshot,
              revalidationPolicy: descriptor.revalidationPolicy,
            },
          ];
        }

        const options = await this.resolveFormFieldOptions({
          authContext: input.authContext,
          field,
          formData: input.formData,
          values,
        });
        const snapshot: FormDataSourceValueSnapshot = {
          bindingHash,
          dataSourceKey: descriptor.key,
          dataSourceVersion: descriptor.version,
          options,
          revalidationPolicy: descriptor.revalidationPolicy,
          validatedAt: new Date().toISOString(),
        };

        return [field.fieldKey, snapshot];
      },
    );

    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, FormDataSourceValueSnapshot] =>
          entry !== null,
      ),
    );
  }

  /**
   * The authoritative resolve behind submit and resubmit: all requested values
   * come back or the whole call fails with `VALUE_NOT_RESOLVED`. The read-only
   * resolve query reports partial results instead, and must never share this
   * path — a half-resolved field cannot be written into an instance.
   */
  async resolveFormFieldOptions(
    input: BPMFormDataSourceResolveFieldInput,
  ): Promise<readonly FormFieldOption[]> {
    const field = readDynamicOptionField(input.field);
    const source = readSourceOrThrow(this.registry, field.dataSource);
    assertControlSupported(field, source.descriptor);
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
      throw new BPMFormDataSourceException(
        BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
      );
    }

    const result = await callProvider({
      call: (signal): Promise<readonly FormFieldOption[]> =>
        source.resolve({
          authContext: input.authContext,
          bindings: bindings.values,
          signal,
          values,
        }),
      logger: this.logger,
      operation: 'resolve',
      source,
    });
    const options = validateResolveResult(
      result,
      values,
      source.descriptor.maximumResultCount,
    );

    return readOrderedResolvedOptions(options, values);
  }
}

/**
 * Runs `map` over `items` with at most `limit` calls in flight, keeping the
 * result order. The first rejection propagates unchanged and stops any work
 * that has not started, so one failing field does not drag the rest of the
 * form's providers along with it.
 */
async function mapWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  map: (item: TItem) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const pending = items
    .map((item, index): readonly [number, TItem] => [index, item])
    [Symbol.iterator]();
  const results = new Map<number, TResult>();
  // A shared abort signal is the flag that tells the other workers to stop
  // pulling once one of them has failed.
  const failure = new AbortController();

  const runWorker = async (): Promise<void> => {
    for (const [index, item] of pending) {
      if (failure.signal.aborted) {
        return;
      }

      try {
        results.set(index, await map(item));
      } catch (error: unknown) {
        failure.abort();
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );

  return items.map((_item, index) => results.get(index) as TResult);
}

function readDynamicFieldValues(
  field: FormDataSourceOptionFieldDefinition,
  value: unknown,
): readonly string[] {
  const mode = readFormFieldSelectionMode(field);

  if (value === null || typeof value === 'undefined') {
    return [];
  }

  // `''` clears a single field; on a multiple field it is an illegal shape that
  // must be rejected rather than silently treated as "nothing selected".
  if (value === '' && mode !== 'multiple') {
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
