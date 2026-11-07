import {
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT,
} from '@rytass/bpm-core-shared';
import {
  FormDataSourceReference,
  FormDefinitionSchema,
  FormFieldDefinition,
  FormFieldValue,
  TableColumnDefinition,
} from '@rytass/bpm-core-shared/form';
import { loadCelV2Environment } from '../condition/adapters/cel-v2.adapter';
import type { ConditionService } from '../condition/condition.service';
import {
  readExpressionFieldType,
  readExpressionHostFunctionNames,
  readExpressionReferences,
  RESERVED_PATH_SEGMENTS,
} from '../condition/expression-ast';
import type { ExpressionBudget } from '../condition/expression-budget';
// Type only: the validation module imports this one for its values.
import type { FormDataSourceBindingPosition } from './form-data-source.validation';
import { ExpressionRuntimeError } from '../condition/expression-errors';
import {
  BPM_FORM_DATA_SOURCE_ERROR_CODES,
  BPMFormDataSourceException,
} from './form-data-source.errors';
import type {
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceParameterType,
} from './form-data-source.types';

/*
 * `EXPRESSION` binding sources (ADR 22 §3.7, docs/24 §2.8). One evaluator is
 * shared by search, resolve and submit through `readBindingValues`, so the
 * three paths cannot compute different parameter values for the same input.
 *
 * An `EXPRESSION` binding is always cel-v2 and may only call the built-in
 * functions. It is evaluated from the stored schema; nothing the browser sends
 * is ever read as an expression.
 */

/** The binding dialect: there is no field for it (docs/24 §2.4). */
export const EXPRESSION_BINDING_DIALECT = 'cel-v2' as const;

/** The roots a DataSource binding may read: `form`, and `row` in a table column. */
const DATA_SOURCE_BINDING_ROOTS: readonly string[] =
  EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT.DATA_SOURCE_BINDING;

/** The roots a top-level field's binding may read: `form` only. */
const TOP_LEVEL_BINDING_ROOTS: readonly string[] = ['form'];

const BUILT_IN_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
);

/**
 * The fields an expression reads, from its AST. `formFieldKeys` are top-level
 * form keys (`form.<key>`), `rowColumnKeys` sibling column keys (`row.<key>`).
 */
export interface ExpressionBindingDependencies {
  readonly formFieldKeys: readonly string[];
  readonly rowColumnKeys: readonly string[];
}

/**
 * The static dependencies of a binding expression, or `null` when they cannot
 * be known: it does not parse, reads a root other than `form` and `row`, uses
 * a root as a whole value, or indexes with a computed key. The publish lint
 * refuses each of those; reaching one at run time means the schema was written
 * around it, and the caller fails closed.
 */
export function readExpressionBindingDependencies(
  expression: string,
): ExpressionBindingDependencies | null {
  const parsed = readExpressionReferences(
    expression.trim(),
    EXPRESSION_BINDING_DIALECT,
  );

  if (parsed.status !== 'OK') {
    return null;
  }

  const { references } = parsed;

  if (
    references.roots.some((root) => !DATA_SOURCE_BINDING_ROOTS.includes(root)) ||
    references.wholeRootReferences.length > 0 ||
    references.computedKeys.length > 0 ||
    references.reservedSegments.length > 0
  ) {
    return null;
  }

  const rowColumnKeys = [
    ...new Set(
      references.fieldPaths
        .filter((path) => path.root === 'row' && path.segments.length > 0)
        .map((path) => path.segments[0]),
    ),
  ];
  const formFieldKeys = [
    ...new Set(
      references.fieldPaths
        .filter((path) => path.root === 'form' && path.segments.length > 0)
        .map((path) => path.segments[0]),
    ),
  ];

  return { formFieldKeys, rowColumnKeys };
}

/**
 * Whether the expression calls only cel-v2's own functions and the nine
 * built-ins (docs/24 §1: no host functions in a binding in v1). `false` for an
 * expression that cannot be read.
 */
export function callsOnlyBuiltInExpressionFunctions(
  expression: string,
): boolean {
  const names = readExpressionHostFunctionNames(
    expression.trim(),
    EXPRESSION_BINDING_DIALECT,
  );

  return names !== null && names.every((name) => BUILT_IN_FUNCTION_NAMES.has(name));
}

/** A value an `EXPRESSION` binding may produce (ADR 22 §3.7). */
export type ExpressionBindingValue = boolean | number | string | null;

export function isExpressionBindingValue(
  value: unknown,
): value is ExpressionBindingValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Evaluates `EXPRESSION` binding sources for one operation. `undefined` means
 * a dependency has no value yet: the binding then reads as missing, exactly
 * like an empty `FIELD`, and is reported through `waitingForFieldKeys` rather
 * than evaluated (a missing key would only fail).
 */
export interface FormDataSourceExpressionEvaluator {
  evaluate(input: {
    readonly expression: string;
    readonly formData: Readonly<Record<string, unknown>>;
    readonly isPresent: (value: unknown) => boolean;
    /**
     * Where the field sits: a top-level field's expression may read `form`
     * only, a table column's `form` and `row` (docs/24 §2.3, §2.8).
     */
    readonly position: FormDataSourceBindingPosition;
  }): ExpressionBindingValue | undefined;
}

export interface FormDataSourceExpressionEvaluatorOptions {
  /**
   * The operation's budget. Absent: the evaluation joins the operation it runs
   * in (`runExpressionOperation`), or gets a single-expression budget.
   */
  readonly budget?: ExpressionBudget;
  /**
   * The injected `ConditionService`, which evaluates with the host's function
   * registry (docs/23 P4／P5 交接). Never a `new ConditionService()`: lint and
   * evaluation must see the same functions. Absent: every expression binding
   * fails closed as `INVALID_BINDING`.
   */
  readonly conditionService: ConditionService | null | undefined;
}

const EXPRESSION_BINDING_LABEL = 'dataSource.binding';

const invalidBinding = (): BPMFormDataSourceException =>
  new BPMFormDataSourceException(
    BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
  );

/**
 * Picks own properties only: a field may be named `constructor`, and a plain
 * index would hand the engine a function off the prototype.
 */
function pickOwnValues(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key): readonly [string, unknown] => [key, source[key]]),
  );
}

export function createFormDataSourceExpressionEvaluator(
  options: FormDataSourceExpressionEvaluatorOptions,
): FormDataSourceExpressionEvaluator {
  return {
    evaluate({
      expression,
      formData,
      isPresent,
      position,
    }): ExpressionBindingValue | undefined {
      const conditionService = options.conditionService;

      if (!conditionService || typeof expression !== 'string') {
        throw invalidBinding();
      }

      const dependencies = readExpressionBindingDependencies(expression);

      if (
        dependencies === null ||
        !callsOnlyBuiltInExpressionFunctions(expression)
      ) {
        throw invalidBinding();
      }

      // Roots by position (docs/24 §2.8), mirroring the publish lint: only a
      // table column has a row, so at the top level `row` is not a root at
      // all. A top-level field whose stored expression reads `row` was
      // written around the lint and fails closed instead of waiting forever.
      const rowValues =
        position.kind === 'TABLE_COLUMN' ? position.rowValues : undefined;
      const allowedRootIdentifiers =
        position.kind === 'TABLE_COLUMN'
          ? DATA_SOURCE_BINDING_ROOTS
          : TOP_LEVEL_BINDING_ROOTS;

      if (position.kind === 'TOP_LEVEL' && dependencies.rowColumnKeys.length > 0) {
        throw invalidBinding();
      }

      const form = pickOwnValues(formData, dependencies.formFieldKeys);
      const row = rowValues
        ? pickOwnValues(rowValues, dependencies.rowColumnKeys)
        : undefined;
      const waiting =
        dependencies.formFieldKeys.some((key) => !isPresent(form[key])) ||
        (dependencies.rowColumnKeys.length > 0 &&
          (!row ||
            dependencies.rowColumnKeys.some((key) => !isPresent(row[key]))));

      if (waiting) {
        return undefined;
      }

      const value = ((): unknown => {
        try {
          return conditionService.evaluateValue(
            expression,
            row ? { form, row } : { form },
            EXPRESSION_BINDING_LABEL,
            {
              allowedRootIdentifiers,
              ...(options.budget ? { budget: options.budget } : {}),
              dialect: EXPRESSION_BINDING_DIALECT,
            },
          );
        } catch (error: unknown) {
          // Out of budget keeps the source's existing UNAVAILABLE meaning;
          // anything else the expression did wrong is a binding that does not
          // work (docs/24 §2.1: no new DataSource code). The engine's text
          // never leaves: only the code is read.
          throw new BPMFormDataSourceException(
            error instanceof ExpressionRuntimeError &&
              error.code === 'EXPRESSION_BUDGET_EXCEEDED'
              ? BPM_FORM_DATA_SOURCE_ERROR_CODES.TIMEOUT
              : BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
          );
        }
      })();

      if (!isExpressionBindingValue(value)) {
        throw invalidBinding();
      }

      return value satisfies FormFieldValue;
    },
  };
}

// ------------------------------------------------------------- publish lint --

/** CEL base types a parameter of each type accepts from an expression. */
const ACCEPTED_RESULT_TYPES: Readonly<
  Record<BPMFormDataSourceParameterType, readonly string[]>
> = {
  BOOLEAN: ['bool'],
  NUMBER: ['double', 'int', 'uint'],
  STRING: ['string'],
  // ADR 22 §3.7: an expression yields a scalar, never a list.
  STRING_ARRAY: [],
};

const readSchemaVariable = (
  fields: readonly FormFieldDefinition[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    fields
      .filter(
        (field) =>
          typeof field?.fieldKey === 'string' &&
          !RESERVED_PATH_SEGMENTS.has(field.fieldKey),
      )
      .map((field): readonly [string, string] => [
        field.fieldKey,
        readExpressionFieldType(field),
      ]),
  );

/**
 * The CEL type the expression evaluates to, read with `form` (and `row`) at
 * their schema types, then untyped; `null` when neither check passes or the
 * engine cannot say. Only built-ins can appear here (host functions are
 * refused first), so the built-ins environment is the right one.
 */
export function readExpressionBindingResultType(
  expression: string,
  schema: FormDefinitionSchema,
  columns: readonly TableColumnDefinition[] | null,
): string | null {
  const check = (typed: boolean): string | null => {
    try {
      const environment = loadCelV2Environment().clone();

      if (typed) {
        environment.registerVariable({
          name: 'form',
          schema: readSchemaVariable(schema.fields),
        });

        if (columns) {
          environment.registerVariable({
            name: 'row',
            schema: readSchemaVariable(columns),
          });
        }
      }

      const result = environment.parse(expression).check();

      return result.valid && typeof result.type === 'string'
        ? result.type
        : null;
    } catch {
      return null;
    }
  };

  return check(true) ?? check(false);
}

const isResultTypeAccepted = (
  type: string | null,
  parameterType: BPMFormDataSourceParameterType,
): boolean => {
  if (parameterType === 'STRING_ARRAY') {
    return false;
  }

  if (type === null) {
    return true;
  }

  const base = type.split('<')[0].trim();

  return (
    base === 'dyn' ||
    base === 'null_type' ||
    ACCEPTED_RESULT_TYPES[parameterType].includes(base)
  );
};

export interface LintExpressionBindingsInput {
  /** The table's columns when the field is a column, `null` for a top-level field. */
  readonly columns: readonly TableColumnDefinition[] | null;
  readonly conditionService: ConditionService | null | undefined;
  readonly descriptor: BPMFormDataSourceDescriptor;
  /** `schema.fields[i](.columns[j]).dataSource` */
  readonly path: string;
  readonly reference: FormDataSourceReference;
  readonly schema: FormDefinitionSchema;
}

/**
 * The publish lint of a field's `EXPRESSION` bindings (docs/24 §2.8): each
 * one must pass the cel-v2 lint of `DATA_SOURCE_BINDING` — roots by position
 * (`form`; `form` and `row` in a table column), built-in functions only
 * (`EXPR_FUNCTION_NOT_ALLOWED`), the bound form's fields and types — read only
 * sibling columns through `row`, and produce a value of the parameter's type
 * (`EXPR_RESULT_TYPE_MISMATCH`; a `STRING_ARRAY` parameter never fits).
 *
 * Lines are `<path>.bindings[<i>].from.expression: <code>[ <subject>]`. Lint
 * and evaluation share the injected `ConditionService`; without one the
 * binding cannot be checked and the line says so.
 */
export function lintExpressionBindings(
  input: LintExpressionBindingsInput,
): readonly string[] {
  const parameterTypes = new Map(
    input.descriptor.parameters.map(
      (parameter): readonly [string, BPMFormDataSourceParameterType] => [
        parameter.key,
        parameter.type,
      ],
    ),
  );

  return input.reference.bindings.flatMap((binding, index): readonly string[] => {
    if (binding.from.kind !== 'EXPRESSION') {
      return [];
    }

    const label = `${input.path}.bindings[${index}].from.expression`;
    const expression =
      typeof binding.from.expression === 'string'
        ? binding.from.expression.trim()
        : '';

    if (!input.conditionService) {
      return [
        `${input.path}.bindings expression cannot be checked: no ConditionService is available`,
      ];
    }

    const lintErrors = input.conditionService.lintExpression(
      expression,
      label,
      {
        allowedRootIdentifiers: input.columns
          ? DATA_SOURCE_BINDING_ROOTS
          : TOP_LEVEL_BINDING_ROOTS,
        dialect: EXPRESSION_BINDING_DIALECT,
        formSchema: input.schema,
        usagePoint: 'DATA_SOURCE_BINDING',
      },
    );

    if (lintErrors.length > 0) {
      return lintErrors;
    }

    const dependencies = readExpressionBindingDependencies(expression);
    const columnKeys = new Set(
      (input.columns ?? []).map((column) => column.fieldKey),
    );
    const unknownColumns = (dependencies?.rowColumnKeys ?? []).filter(
      (key) => !columnKeys.has(key),
    );

    if (dependencies === null) {
      return [`${label}: EXPR_PARSE_FAILED`];
    }

    if (unknownColumns.length > 0) {
      return unknownColumns.map((key) => `${label}: EXPR_FIELD_UNKNOWN ${key}`);
    }

    const parameterType = parameterTypes.get(binding.parameter);

    // An unknown parameter is reported by the binding lint already.
    return parameterType &&
      !isResultTypeAccepted(
        readExpressionBindingResultType(expression, input.schema, input.columns),
        parameterType,
      )
      ? [`${label}: EXPR_RESULT_TYPE_MISMATCH`]
      : [];
  });
}
