import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type {
  NotifyWebhookExpressionBindingSource,
  NotifyWebhookParameterType,
} from '@rytass/bpm-core-shared/workflow';
import { EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT } from '@rytass/bpm-core-shared';
import type { ConditionService } from '../condition/condition.service';
import {
  createExpressionBudget,
  type ExpressionBudget,
} from '../condition/expression-budget';
import { ExpressionRuntimeError } from '../condition/expression-errors';
import {
  callsOnlyBuiltInExpressionFunctions,
  EXPRESSION_BINDING_DIALECT,
  ExpressionBindingValue,
  isExpressionBindingValue,
  readExpressionBindingDependencies,
  readExpressionBindingResultType,
} from '../form-data-source/form-data-source.expression';

/*
 * `EXPRESSION` sources of NOTIFY webhook bindings (ADR 22 §3.7). NOTIFY has no
 * row: the only root is `form`. Evaluated inside the engine transaction,
 * before the outbox row is written, with a budget of its own so the gateway
 * conditions of the same transaction keep theirs.
 */

/** NOTIFY binding roots: `form` only. */
const NOTIFY_WEBHOOK_BINDING_ROOTS: readonly string[] =
  EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT.NOTIFY_WEBHOOK_BINDING;

const EXPRESSION_SOURCE_PROPERTIES: readonly string[] = ['expression', 'kind'];

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A well-formed `EXPRESSION` source: a non-blank expression and nothing else. */
export function isNotifyWebhookExpressionSource(
  value: unknown,
): value is NotifyWebhookExpressionBindingSource {
  return (
    isRecord(value) &&
    value.kind === 'EXPRESSION' &&
    typeof value.expression === 'string' &&
    value.expression.trim().length > 0 &&
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .every((key) => EXPRESSION_SOURCE_PROPERTIES.includes(key))
  );
}

/**
 * Why an `EXPRESSION` binding produced no value. Never engine text or a value.
 *
 * Six of these are the runtime contract codes (docs/24 §2.1). The seventh,
 * `EXPRESSION_UNAVAILABLE`, is internal and deliberately not one of them: it
 * means no expression was evaluated at all, because the host wired no
 * `ConditionService` (a configuration error, not an expression's failure).
 * None of the six fits that: `EXPRESSION_FUNCTION_FAILED` would blame a
 * function nobody called, `EXPRESSION_SYNTAX_ERROR` an expression that is
 * fine. It never leaves BPM as an error code; it only appears in the
 * delivery's `lastErrorDetail` (`parameter "<key>" expression failed
 * (EXPRESSION_UNAVAILABLE)`), which is recorded as `FAILED` with
 * `WEBHOOK_PARAMETER_INVALID` like every other binding failure (§2.1).
 */
export type NotifyWebhookExpressionFailure =
  | 'EXPRESSION_BUDGET_EXCEEDED'
  | 'EXPRESSION_FUNCTION_FAILED'
  | 'EXPRESSION_INVALID_RESULT'
  | 'EXPRESSION_MISSING_KEY'
  | 'EXPRESSION_SYNTAX_ERROR'
  | 'EXPRESSION_TYPE_ERROR'
  | 'EXPRESSION_UNAVAILABLE';

export type NotifyWebhookExpressionOutcome =
  | { readonly ok: true; readonly value: ExpressionBindingValue }
  | { readonly code: NotifyWebhookExpressionFailure; readonly ok: false };

/** Evaluates the `EXPRESSION` sources of one NOTIFY node's webhooks. */
export interface NotifyWebhookExpressionEvaluator {
  evaluate(
    expression: string,
    formData: Readonly<Record<string, unknown>>,
  ): NotifyWebhookExpressionOutcome;
}

const failure = (
  code: NotifyWebhookExpressionFailure,
): NotifyWebhookExpressionOutcome => ({ code, ok: false });

/**
 * One evaluator per enqueue: every `EXPRESSION` binding of the node's targets
 * shares one budget, separate from the transaction's own operation budget. It
 * never throws: a failure is an outcome the caller records as a `FAILED`
 * delivery (`WEBHOOK_PARAMETER_INVALID`), and the approval goes on.
 *
 * `conditionService` must be the injected one (the host's function registry);
 * without it every expression is `EXPRESSION_UNAVAILABLE`.
 */
export function createNotifyWebhookExpressionEvaluator(
  conditionService: ConditionService | null | undefined,
  budget: ExpressionBudget = createExpressionBudget(),
): NotifyWebhookExpressionEvaluator {
  return {
    evaluate(expression, formData): NotifyWebhookExpressionOutcome {
      if (!conditionService) {
        return failure('EXPRESSION_UNAVAILABLE');
      }

      const dependencies = readExpressionBindingDependencies(expression);

      if (
        dependencies === null ||
        dependencies.rowColumnKeys.length > 0 ||
        !callsOnlyBuiltInExpressionFunctions(expression)
      ) {
        return failure('EXPRESSION_SYNTAX_ERROR');
      }

      const form = Object.fromEntries(
        dependencies.formFieldKeys
          .filter((key) => Object.prototype.hasOwnProperty.call(formData, key))
          .map((key): readonly [string, unknown] => [key, formData[key]]),
      );

      try {
        const value = conditionService.evaluateValue(
          expression,
          { form },
          'webhook.binding',
          {
            allowedRootIdentifiers: NOTIFY_WEBHOOK_BINDING_ROOTS,
            budget,
            dialect: EXPRESSION_BINDING_DIALECT,
          },
        );

        return isExpressionBindingValue(value)
          ? { ok: true, value }
          : failure('EXPRESSION_INVALID_RESULT');
      } catch (error: unknown) {
        return failure(
          error instanceof ExpressionRuntimeError
            ? error.code
            : 'EXPRESSION_TYPE_ERROR',
        );
      }
    },
  };
}

/** CEL base types each webhook parameter type accepts from an expression. */
const ACCEPTED_RESULT_TYPES: Readonly<
  Record<NotifyWebhookParameterType, readonly string[] | null>
> = {
  boolean: ['bool'],
  // A json parameter takes any scalar the expression produces.
  json: null,
  number: ['double', 'int', 'uint'],
  string: ['string'],
  // ADR 22 §3.7: an expression yields a scalar, never a list.
  stringArray: [],
};

const isResultTypeAccepted = (
  type: string | null,
  parameterType: NotifyWebhookParameterType,
): boolean => {
  const accepted = ACCEPTED_RESULT_TYPES[parameterType];

  if (accepted === null) {
    return true;
  }

  if (accepted.length === 0) {
    return false;
  }

  if (type === null) {
    return true;
  }

  const base = type.split('<')[0].trim();

  return base === 'dyn' || base === 'null_type' || accepted.includes(base);
};

/**
 * The publish lint of one `EXPRESSION` webhook binding: the cel-v2 lint of
 * `NOTIFY_WEBHOOK_BINDING` (only `form`, built-in functions only, the bound
 * form's fields and types), then a result that fits the parameter
 * (`EXPR_RESULT_TYPE_MISMATCH`; a `stringArray` parameter never fits).
 * Lines are `<label>: <code>[ <subject>]`.
 */
export function lintNotifyWebhookExpressionBinding(input: {
  readonly conditionService: Pick<ConditionService, 'lintExpression'> | null | undefined;
  readonly expression: string;
  readonly formSchema: FormDefinitionSchema;
  readonly label: string;
  readonly parameterType: NotifyWebhookParameterType | null;
}): readonly string[] {
  if (!input.conditionService) {
    return [
      `${input.label} cannot be checked: no ConditionService is available`,
    ];
  }

  const expression = input.expression.trim();
  const lintErrors = input.conditionService.lintExpression(
    expression,
    input.label,
    {
      dialect: EXPRESSION_BINDING_DIALECT,
      formSchema: input.formSchema,
      usagePoint: 'NOTIFY_WEBHOOK_BINDING',
    },
  );

  if (lintErrors.length > 0 || input.parameterType === null) {
    return lintErrors;
  }

  return isResultTypeAccepted(
    readExpressionBindingResultType(expression, input.formSchema, null),
    input.parameterType,
  )
    ? []
    : [`${input.label}: EXPR_RESULT_TYPE_MISMATCH`];
}
