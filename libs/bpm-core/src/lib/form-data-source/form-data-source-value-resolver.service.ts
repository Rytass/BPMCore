import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshot,
  FormDataSourceValueSnapshots,
  FormFieldOption,
  FormFieldValue,
  TableFieldDefinition,
  isFormDataSourceFieldDefinition,
  isTableFieldDefinition,
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
  isRecord,
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
    // One work item per dynamic value to resolve, top-level fields and table
    // cells alike. Flattening first keeps the concurrency limit a per-submit
    // budget rather than a per-field one, so a 100-row table does not turn one
    // submit into a burst against the host (ADR 16 §3.6).
    const entries = await mapWithConcurrencyLimit(
      readDynamicResolutionTargets(input),
      MAX_CONCURRENT_PROVIDER_CALLS,
      async (
        target,
      ): Promise<readonly [string, FormDataSourceValueSnapshot] | null> => {
        const { field, rowValues, snapshotKey } = target;
        const values = readDynamicFieldValues(field, target.value);

        if (values.length === 0) {
          return null;
        }

        const previousSnapshot = input.previousSnapshots?.[snapshotKey];
        const valueUnchanged = isSameFieldValue(
          target.previousValue,
          target.value,
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
            return [snapshotKey, previousSnapshot];
          }

          throw new BPMFormDataSourceException(
            readMissingSourceCode(this.registry, field.dataSource.key),
          );
        }

        const { descriptor } = source;
        assertDescriptor(descriptor);
        assertControlSupported(field, descriptor);
        const bindings = readBindingValues(
          field,
          descriptor,
          input.formData,
          rowValues,
        );

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
            snapshotKey,
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
          rowValues,
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

        return [snapshotKey, snapshot];
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
      input.rowValues,
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
 * One dynamic value to resolve. A top-level field and a table cell differ only
 * in their snapshot key and whether they carry the row they belong to.
 */
interface DynamicResolutionTarget {
  readonly field: FormDataSourceOptionFieldDefinition;
  readonly previousValue: unknown;
  readonly rowValues?: Readonly<Record<string, unknown>>;
  readonly snapshotKey: string;
  readonly value: unknown;
}

/**
 * Flattens the schema into the values that need resolving. Cell snapshot keys
 * are instance paths (`<tableKey>[<i>].<columnKey>`, ADR 16 §3.6), so inserting
 * or deleting a row shifts the keys of everything after it and those cells
 * re-resolve. That is deliberate: better an extra provider call than one row's
 * snapshot vouching for another row's value.
 */
function readDynamicResolutionTargets(
  input: BPMFormDataSourceSnapshotResolutionInput,
): readonly DynamicResolutionTarget[] {
  return input.schema.fields.flatMap(
    (field): readonly DynamicResolutionTarget[] => {
      if (isTableFieldDefinition(field)) {
        return readTableResolutionTargets(field, input);
      }

      return isFormDataSourceFieldDefinition(field)
        ? [
            {
              field,
              previousValue: input.previousFormData?.[field.fieldKey],
              snapshotKey: field.fieldKey,
              value: input.formData[field.fieldKey],
            },
          ]
        : [];
    },
  );
}

function readTableResolutionTargets(
  field: TableFieldDefinition,
  input: BPMFormDataSourceSnapshotResolutionInput,
): readonly DynamicResolutionTarget[] {
  // `filter` cannot narrow here — a DataSource option field is not a subtype
  // of a table column (it also covers radio and checkbox) — so the guard runs
  // inside a `flatMap` instead.
  const dynamicColumns = field.columns.flatMap(
    (column): readonly FormDataSourceOptionFieldDefinition[] =>
      isFormDataSourceFieldDefinition(column) ? [column] : [],
  );

  if (dynamicColumns.length === 0) {
    return [];
  }

  const rows = readTableRows(input.formData[field.fieldKey]);
  const previousRows = readTableRows(input.previousFormData?.[field.fieldKey]);

  return rows.flatMap((row, rowIndex) =>
    dynamicColumns.map((column): DynamicResolutionTarget => ({
      field: column,
      previousValue: readOwnProperty(
        previousRows[rowIndex] ?? {},
        column.fieldKey,
      ),
      rowValues: row,
      snapshotKey: `${field.fieldKey}[${rowIndex}].${column.fieldKey}`,
      value: readOwnProperty(row, column.fieldKey),
    })),
  );
}

function readTableRows(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readOwnProperty(
  row: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
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
