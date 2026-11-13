import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  FormDataSourceOptionFieldDefinition,
  FormDataSourceValueSnapshot,
  FormDataSourceValueSnapshots,
  FormFieldOption,
  TableFieldDefinition,
  isFormDataSourceFieldDefinition,
  isTableFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import { ConditionService } from '../condition/condition.service';
import { runExpressionOperation } from '../condition/expression-budget';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
  BPMFormDataSourceValueNotResolvedException,
} from './form-data-source.errors';
import {
  FormDataIssueLocation,
  readCellIssueLocation,
  readFieldIssueLocation,
  readRowIssueLocation,
} from '../form/form-data-issue';
import { createFormDataSourceExpressionEvaluator } from './form-data-source.expression';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveFieldInput,
  BPMFormDataSourceSnapshotResolutionInput,
  BPMFormDataSourceValueResolver,
} from './form-data-source.types';
import {
  assertControlSupported,
  assertDescriptor,
  callProvider,
  createTableColumnBindingPosition,
  FormDataSourceBindingPosition,
  isRecord,
  readBindingHash,
  readBindingValues,
  readDynamicOptionField,
  readMissingSourceCode,
  readOrderedResolvedOptions,
  readSourceOrThrow,
  TOP_LEVEL_BINDING_POSITION,
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
    // Evaluates `EXPRESSION` bindings with the host's function registry, the
    // same service the publish lint uses. Optional so a host that builds this
    // resolver by hand keeps working; without it an `EXPRESSION` binding
    // fails closed as `INVALID_BINDING`.
    // An explicit token: the `| null` union is emitted as `Object` in the
    // constructor metadata, which Nest would look up, not find, and (being
    // optional) silently inject as `undefined`.
    @Optional()
    @Inject(ConditionService)
    private readonly conditionService?: ConditionService | null,
  ) {}

  /**
   * One submit is one expression operation: every `EXPRESSION` binding of
   * every field and table row shares one cumulative budget (ADR 22 §3.2,
   * §3.7). Running out is `FORM_DATA_SOURCE_TIMEOUT`, thrown before the
   * engine opens its transaction, so no instance is written.
   */
  resolveFormDataOptionSnapshots(
    input: BPMFormDataSourceSnapshotResolutionInput,
  ): Promise<FormDataSourceValueSnapshots> {
    return runExpressionOperation(() =>
      this.resolveFormDataOptionSnapshotsInOperation(input),
    );
  }

  private async resolveFormDataOptionSnapshotsInOperation(
    input: BPMFormDataSourceSnapshotResolutionInput,
  ): Promise<FormDataSourceValueSnapshots> {
    const expressions = createFormDataSourceExpressionEvaluator({
      conditionService: this.conditionService,
    });
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
        const { field, position, snapshotKey } = target;
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
          position,
          expressions,
        );

        if (bindings.missingParameters.length > 0) {
          throw new BPMFormDataSourceException(
            BPM_FORM_DATA_SOURCE_ERROR_CODES.WAITING_FOR_DEPENDENCIES,
          );
        }

        const bindingHash = readBindingHash(descriptor, bindings.values);
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

        const options = await locateValueNotResolved(
          target.location,
          () =>
            this.resolveFieldOptionsAt(
              {
                authContext: input.authContext,
                field,
                formData: input.formData,
                values,
              },
              position,
            ),
        );
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
  resolveFormFieldOptions(
    input: BPMFormDataSourceResolveFieldInput,
  ): Promise<readonly FormFieldOption[]> {
    // The public contract (`BPMFormDataSourceResolveFieldInput`): only a table
    // cell carries `rowValues`. This is the one place that reads the position
    // from it; the submit path above passes the schema's own position.
    return this.resolveFieldOptionsAt(
      input,
      input.rowValues
        ? createTableColumnBindingPosition(input.rowValues)
        : TOP_LEVEL_BINDING_POSITION,
    );
  }

  private resolveFieldOptionsAt(
    input: Omit<BPMFormDataSourceResolveFieldInput, 'rowValues'>,
    position: FormDataSourceBindingPosition,
  ): Promise<readonly FormFieldOption[]> {
    // Joins the submit's operation when called from it, so a field's
    // expressions are not given a second budget.
    return runExpressionOperation(() =>
      this.resolveFormFieldOptionsInOperation(input, position),
    );
  }

  private async resolveFormFieldOptionsInOperation(
    input: Omit<BPMFormDataSourceResolveFieldInput, 'rowValues'>,
    position: FormDataSourceBindingPosition,
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
      position,
      createFormDataSourceExpressionEvaluator({
        conditionService: this.conditionService,
      }),
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
  /**
   * Where the value sits in the form, for the decide path's `formDataErrors`
   * (ADR 27 §4.2). Table cells use the original row index, not a filtered one.
   */
  readonly location: FormDataIssueLocation;
  /** From the schema walk: a table cell carries its row, a field none. */
  readonly position: FormDataSourceBindingPosition;
  readonly previousValue: unknown;
  readonly snapshotKey: string;
  readonly value: unknown;
}

/**
 * Flattens the schema into the values that need resolving. Cell snapshot keys
 * are instance paths (`<tableKey>[<i>].<columnKey>`, ADR 16 §3.6), so inserting
 * or deleting a row shifts every later cell onto the key of the row that used
 * to sit there. The key alone is therefore no protection — it still matches.
 * What protects the shifted cell is that `previousValue` is read from the row
 * at the *same index* in the previous form data and the binding hash is
 * recomputed from the row's current values: after a shift both are compared
 * against the row that used to be there, so they disagree and the cell
 * re-resolves. Reuse survives only when the value and every binding are
 * identical, which makes it indistinguishable from a fresh resolve. Do not
 * drop either comparison on the assumption that the key is doing this work.
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
              location: readFieldIssueLocation(field),
              position: TOP_LEVEL_BINDING_POSITION,
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
    row
      ? dynamicColumns.map((column): DynamicResolutionTarget => ({
          field: column,
          location: readCellIssueLocation(
            readRowIssueLocation(field, rowIndex),
            column,
          ),
          position: createTableColumnBindingPosition(row),
          previousValue: readOwnProperty(
            previousRows[rowIndex] ?? {},
            column.fieldKey,
          ),
          snapshotKey: `${field.fieldKey}[${rowIndex}].${column.fieldKey}`,
          value: readOwnProperty(row, column.fieldKey),
        }))
      : [],
  );
}

/**
 * Tags a `VALUE_NOT_RESOLVED` refusal with the field or cell it came from, so
 * the decide path can answer with `formDataErrors` instead of a bare code. Every
 * other failure passes through unchanged.
 */
async function locateValueNotResolved(
  location: FormDataIssueLocation,
  resolve: () => Promise<readonly FormFieldOption[]>,
): Promise<readonly FormFieldOption[]> {
  try {
    return await resolve();
  } catch (error: unknown) {
    if (
      error instanceof BPMFormDataSourceException &&
      error.code === BPM_FORM_DATA_SOURCE_ERROR_CODES.VALUE_NOT_RESOLVED
    ) {
      throw new BPMFormDataSourceValueNotResolvedException(location);
    }

    throw error;
  }
}

/**
 * Keeps position, so a malformed row does not shift every snapshot key after
 * it. `validateSubmittedFormData` rejects a non-record row before this runs,
 * but the index must not depend on that ordering to stay correct.
 */
function readTableRows(
  value: unknown,
): readonly (Readonly<Record<string, unknown>> | null)[] {
  return Array.isArray(value) ? value.map((row) => (isRecord(row) ? row : null)) : [];
}

/**
 * Own-property read. Both a column key and a host parameter key may be
 * `constructor` or `toString`; a plain index would pick one off the prototype.
 */
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

function isSameFieldValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
