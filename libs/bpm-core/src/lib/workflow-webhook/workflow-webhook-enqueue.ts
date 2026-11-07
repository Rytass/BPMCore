import {
  NotifyWebhookBinding,
  NotifyWebhookContextPath,
  NotifyWebhookTarget,
} from '@rytass/bpm-core-shared/workflow';
import {
  isNotifyWebhookValueCompatibleWithParameter,
  readNotifyWebhookStructureIssues,
} from '@rytass/bpm-core-shared/workflow-graph';
import {
  WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES,
  WorkflowWebhookDeliveryStatusEnum,
} from './workflow-webhook-delivery.enums';
import { WorkflowWebhookFrozenEvent } from './workflow-webhook-delivery.entity';
import { NotifyWebhookExpressionEvaluator } from './workflow-webhook-expression';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookParameter,
} from './workflow-webhook.types';

export interface WorkflowWebhookEnqueueContext {
  readonly instance: {
    readonly formData: Readonly<Record<string, unknown>>;
    readonly id: string;
    readonly initiatorMemberId: string;
    readonly templateId: string;
    readonly templateVersionId: string;
    readonly title: string;
  };
  readonly node: {
    readonly id: string;
    readonly label: string;
  };
  readonly occurredAt: Date;
  readonly tokenId: string;
}

/** The columns a queued delivery is created with. */
export interface WorkflowWebhookDeliveryDraft {
  readonly endpointKey: string;
  readonly endpointVersion: number;
  readonly event: WorkflowWebhookFrozenEvent;
  readonly instanceId: string;
  readonly lastErrorCode: string | null;
  readonly lastErrorDetail: string | null;
  readonly nodeId: string;
  readonly status: WorkflowWebhookDeliveryStatusEnum;
  readonly targetId: string;
  readonly tokenId: string;
}

/**
 * Turns a NOTIFY node's webhook targets into delivery rows (ADR 18 §3.5).
 *
 * Runs inside the engine transaction, so it must never throw for anything a
 * template or the submitted form can cause: a problem becomes a row that is
 * already `FAILED`, recorded and visible to an administrator, and the approval
 * that reached the node carries on. Parameters are resolved here, once, so
 * every retry sends exactly what the node saw.
 */
export async function buildWorkflowWebhookDeliveryDrafts({
  context,
  expressions,
  resolveEndpoint,
  targets,
}: {
  readonly context: WorkflowWebhookEnqueueContext;
  /**
   * Evaluates `EXPRESSION` sources (ADR 22 §3.7), one budget for the whole
   * node. Absent: an `EXPRESSION` binding cannot be evaluated and its target
   * is recorded `FAILED`.
   */
  readonly expressions?: NotifyWebhookExpressionEvaluator;
  readonly resolveEndpoint: (
    key: string,
    version: number,
  ) => Promise<BPMWorkflowWebhookEndpointEntry | null>;
  readonly targets: unknown;
}): Promise<readonly WorkflowWebhookDeliveryDraft[]> {
  const issues = readNotifyWebhookStructureIssues(targets);

  // The snapshot passed publish, so this only guards against a definition
  // written around the lint. A malformed list has nothing safe to deliver.
  if (
    !Array.isArray(targets) ||
    issues.some((issue) => issue.targetIndex === null)
  ) {
    return [];
  }

  const malformed = new Set(issues.map((issue) => issue.targetIndex));
  const wellFormed = (targets as readonly NotifyWebhookTarget[]).filter(
    (_target, index) => !malformed.has(index),
  );

  return Promise.all(
    wellFormed.map(async (target) => {
      // A host registry that throws must not roll back the approval that
      // reached this node; the row records the failure instead.
      const lookup = await resolveEndpoint(
        target.endpoint.key,
        target.endpoint.version,
      ).then(
        (value) => ({ entry: value, lookupFailed: false }),
        () => ({ entry: null, lookupFailed: true }),
      );
      const entry = lookup.entry;
      const parameters = entry
        ? resolveParameters(
            target.bindings,
            entry.endpoint.descriptor.parameters,
            context,
            expressions,
          )
        : { issue: null, values: {} };
      const failure = lookup.lookupFailed
        ? {
            code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_LOOKUP_FAILED,
            detail: `${target.endpoint.key}@${target.endpoint.version} could not be looked up`,
          }
        : !entry
          ? {
              code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_MISSING,
              detail: `${target.endpoint.key}@${target.endpoint.version} is not registered`,
            }
          : entry.endpoint.descriptor.disabled
            ? {
                code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.ENDPOINT_DISABLED,
                detail: `${target.endpoint.key}@${target.endpoint.version} is disabled`,
              }
            : parameters.issue
              ? {
                  code: WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES.PARAMETER_INVALID,
                  detail: parameters.issue,
                }
              : null;

      return {
        endpointKey: target.endpoint.key,
        endpointVersion: target.endpoint.version,
        event: {
          endpoint: {
            key: target.endpoint.key,
            version: target.endpoint.version,
          },
          initiator: { memberId: context.instance.initiatorMemberId },
          instance: {
            id: context.instance.id,
            templateId: context.instance.templateId,
            templateVersionId: context.instance.templateVersionId,
            title: context.instance.title,
          },
          node: { id: context.node.id, label: context.node.label },
          occurredAt: context.occurredAt.toISOString(),
          parameters: parameters.values,
        },
        instanceId: context.instance.id,
        lastErrorCode: failure?.code ?? null,
        lastErrorDetail: failure?.detail ?? null,
        nodeId: context.node.id,
        status: failure
          ? WorkflowWebhookDeliveryStatusEnum.FAILED
          : WorkflowWebhookDeliveryStatusEnum.PENDING,
        targetId: target.id,
        tokenId: context.tokenId,
      };
    }),
  );
}

type BindingValueOutcome =
  | { readonly issue: null; readonly value: unknown }
  | { readonly issue: string; readonly value: null };

function resolveParameters(
  bindings: readonly NotifyWebhookBinding[],
  declared: readonly BPMWorkflowWebhookParameter[],
  context: WorkflowWebhookEnqueueContext,
  expressions: NotifyWebhookExpressionEvaluator | undefined,
): {
  readonly issue: string | null;
  readonly values: Readonly<Record<string, unknown>>;
} {
  const outcomes = declared.flatMap((parameter) => {
    const binding = bindings.find(
      (candidate) => candidate.parameter === parameter.key,
    );

    return binding
      ? [
          {
            outcome: readBindingValue(binding, context, expressions),
            parameter,
          },
        ]
      : [];
  });
  const resolved = outcomes.map(({ outcome, parameter }) => ({
    parameter,
    value: outcome.value,
  }));
  // An expression that produced nothing fails the delivery like a value that
  // does not fit: recorded `WEBHOOK_PARAMETER_INVALID`, never a rollback.
  const expressionIssue =
    outcomes.find(({ outcome }) => outcome.issue !== null)?.outcome.issue ??
    null;
  const issue =
    expressionIssue ??
    declared
      .map((parameter): string | null => {
        const match = resolved.find(
          (candidate) => candidate.parameter.key === parameter.key,
        );
        const value = match?.value ?? null;

        if (parameter.required && value === null) {
          return `parameter "${parameter.key}" is required but resolved to no value`;
        }

        return match &&
          !isNotifyWebhookValueCompatibleWithParameter(value, parameter.type)
          ? `parameter "${parameter.key}" expects ${parameter.type}`
          : null;
      })
      .find((candidate): candidate is string => candidate !== null) ?? null;

  return {
    issue,
    values: Object.fromEntries(
      resolved.map(({ parameter, value }) => [parameter.key, value]),
    ),
  };
}

/**
 * The value one binding sends. Exhaustive: a source kind this version does not
 * know fails the delivery rather than being read as another kind.
 */
function readBindingValue(
  binding: NotifyWebhookBinding,
  context: WorkflowWebhookEnqueueContext,
  expressions: NotifyWebhookExpressionEvaluator | undefined,
): BindingValueOutcome {
  const from = binding.from;

  switch (from.kind) {
    case 'CONSTANT':
      return { issue: null, value: from.value };
    case 'FIELD':
      return {
        issue: null,
        value: Object.prototype.hasOwnProperty.call(
          context.instance.formData,
          from.fieldKey,
        )
          ? (context.instance.formData[from.fieldKey] ?? null)
          : null,
      };
    case 'CONTEXT':
      return { issue: null, value: readContextValue(from.path, context) };
    case 'EXPRESSION': {
      const outcome = expressions
        ? expressions.evaluate(from.expression, context.instance.formData)
        : ({ code: 'EXPRESSION_UNAVAILABLE', ok: false } as const);

      // Only the parameter key and the code: never the expression or a value.
      return outcome.ok
        ? { issue: null, value: outcome.value }
        : {
            issue: `parameter "${binding.parameter}" expression failed (${outcome.code})`,
            value: null,
          };
    }
    default:
      return rejectUnknownSource(binding.parameter, from);
  }
}

function rejectUnknownSource(
  parameter: string,
  from: never,
): BindingValueOutcome {
  void from;
  return {
    issue: `parameter "${parameter}" has an unsupported source`,
    value: null,
  };
}

function readContextValue(
  path: NotifyWebhookContextPath,
  context: WorkflowWebhookEnqueueContext,
): string {
  const values: Readonly<Record<NotifyWebhookContextPath, string>> = {
    'initiator.memberId': context.instance.initiatorMemberId,
    'instance.id': context.instance.id,
    'instance.templateId': context.instance.templateId,
    'instance.templateVersionId': context.instance.templateVersionId,
    'instance.title': context.instance.title,
    'node.id': context.node.id,
    'node.label': context.node.label,
  };

  return values[path];
}
