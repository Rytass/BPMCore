import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookTarget,
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  NotifyWebhookCatalogIssue,
  readNotifyWebhookStructureIssues,
  readNotifyWebhookTargetCatalogIssues,
  readNotifyWebhookTargets,
} from '@rytass/bpm-core-shared/workflow-graph';
import type { ConditionService } from '../condition/condition.service';
import { BPM_WORKFLOW_WEBHOOK_ERROR_CODES } from './workflow-webhook.errors';
import {
  isNotifyWebhookExpressionSource,
  lintNotifyWebhookExpressionBinding,
} from './workflow-webhook-expression';
import { BPMWorkflowWebhookEndpointEntry } from './workflow-webhook.types';

export interface LintWorkflowWebhookTargetsInput {
  /**
   * Lints `EXPRESSION` bindings (ADR 22 §3.7) with the host's function
   * registry: pass the injected `ConditionService`. Without it a target that
   * has one cannot publish.
   */
  readonly conditionService?: Pick<ConditionService, 'lintExpression'> | null;
  readonly definition: WorkflowDefinition;
  readonly formSchema: FormDefinitionSchema;
  readonly hasEndpointSources: boolean;
  readonly resolveEndpoint: (
    key: string,
    version: number,
  ) => Promise<BPMWorkflowWebhookEndpointEntry | null>;
  /**
   * Whether an endpoint's current URL is inside the allowlist (ADR 18 §3.13
   * rule 3). Omitted: not checked at publish, only before each delivery.
   */
  readonly isEndpointUrlAllowed?: (
    entry: BPMWorkflowWebhookEndpointEntry,
  ) => Promise<boolean>;
}

/**
 * The publish rules that need the endpoint catalog and the bound form
 * (ADR 18 §4, items 2 and 5–8). The registry-independent shape rules run
 * earlier, in the shared structural lint.
 */
export async function lintWorkflowWebhookTargets(
  input: LintWorkflowWebhookTargetsInput,
): Promise<readonly string[]> {
  const nodes = input.definition.nodes.filter(
    (node): node is Extract<WorkflowNode, { type: 'serviceTask' }> =>
      node.type === 'serviceTask' &&
      readNotifyWebhookTargets(node.data.action).length > 0,
  );

  if (!nodes.length) {
    return [];
  }

  if (!input.hasEndpointSources) {
    return nodes.map(
      (node) =>
        `workflow.nodes.${node.id}.action.webhooks cannot be published: no webhook endpoint source is configured (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.REGISTRY_MISSING})`,
    );
  }

  const results = await Promise.all(
    nodes.flatMap((node) => {
      const webhooks =
        node.data.action.type === 'NOTIFY' ? node.data.action.webhooks : [];
      const issues = readNotifyWebhookStructureIssues(webhooks);

      // A list-level problem (not an array, over the limit) leaves no target
      // worth resolving. Otherwise only the malformed targets are skipped:
      // the shared structural lint already reports them, and reading parsed
      // JSON nobody validated would throw instead of adding to that list.
      if (issues.some((issue) => issue.targetIndex === null)) {
        return [];
      }

      const malformedTargets = new Set(
        issues.map((issue) => issue.targetIndex),
      );

      return readNotifyWebhookTargets(node.data.action).flatMap(
        (target, targetIndex) =>
          malformedTargets.has(targetIndex)
            ? []
            : [
                lintTarget({
                  conditionService: input.conditionService,
                  formSchema: input.formSchema,
                  isEndpointUrlAllowed: input.isEndpointUrlAllowed,
                  nodeId: node.id,
                  resolveEndpoint: input.resolveEndpoint,
                  target,
                  targetIndex,
                }),
              ],
      );
    }),
  );

  return results.flat();
}

async function lintTarget({
  conditionService,
  formSchema,
  isEndpointUrlAllowed,
  nodeId,
  resolveEndpoint,
  target,
  targetIndex,
}: {
  readonly conditionService: LintWorkflowWebhookTargetsInput['conditionService'];
  readonly formSchema: FormDefinitionSchema;
  readonly isEndpointUrlAllowed?: LintWorkflowWebhookTargetsInput['isEndpointUrlAllowed'];
  readonly nodeId: string;
  readonly resolveEndpoint: LintWorkflowWebhookTargetsInput['resolveEndpoint'];
  readonly target: NotifyWebhookTarget;
  readonly targetIndex: number;
}): Promise<readonly string[]> {
  const entry = await resolveEndpoint(
    target.endpoint.key,
    target.endpoint.version,
  );

  const path = `workflow.nodes.${nodeId}.action.webhooks[${targetIndex}]`;
  const endpoint = entry?.endpoint.descriptor ?? null;
  const catalogIssues = [
    // The shared rules check everything but the expression itself (an unknown
    // or missing parameter included); the expression is linted below.
    ...readNotifyWebhookTargetCatalogIssues({
      endpoint,
      formFields: formSchema.fields,
      target,
    }).map((issue) => readCatalogIssueMessage(issue, target, path)),
    // Only against an endpoint that is there and in use: a missing,
    // disabled or deprecated one is the only issue its target reports.
    ...(endpoint && !endpoint.disabled && !endpoint.deprecated
      ? target.bindings.flatMap((binding, bindingIndex): readonly string[] => {
          const from = binding.from;

          return isNotifyWebhookExpressionSource(from)
            ? lintNotifyWebhookExpressionBinding({
                conditionService,
                expression: from.expression,
                formSchema,
                label: `${path}.bindings[${bindingIndex}].from.expression`,
                parameterType:
                  endpoint.parameters.find(
                    (parameter) => parameter.key === binding.parameter,
                  )?.type ?? null,
              })
            : [];
        })
      : []),
  ];

  // A saved endpoint whose URL a tightened allowlist no longer covers would
  // fail every delivery; say so now rather than after the case runs.
  const urlAllowed =
    !entry || catalogIssues.length || !isEndpointUrlAllowed
      ? true
      : await isEndpointUrlAllowed(entry);

  return [
    ...catalogIssues,
    ...(urlAllowed
      ? []
      : [
          `${path}.endpoint ${target.endpoint.key}@${target.endpoint.version} calls a URL outside workflowWebhookAllowedUrlPatterns (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.URL_NOT_ALLOWED})`,
        ]),
  ];
}

/** The developer-facing, path-style wording of the shared catalog rules. */
function readCatalogIssueMessage(
  issue: NotifyWebhookCatalogIssue,
  target: NotifyWebhookTarget,
  path: string,
): string {
  const endpoint = `${target.endpoint.key}@${target.endpoint.version}`;
  const bindingPath = `${path}.bindings[${issue.bindingIndex ?? 0}]`;
  const parameter = issue.parameter ?? '';
  const codes = BPM_WORKFLOW_WEBHOOK_ERROR_CODES;

  switch (issue.code) {
    case 'ENDPOINT_MISSING':
      return `${path}.endpoint ${endpoint} is not registered (${codes.ENDPOINT_MISSING})`;
    case 'ENDPOINT_DEPRECATED':
      return `${path}.endpoint ${endpoint} is deprecated (${codes.ENDPOINT_DEPRECATED})`;
    case 'ENDPOINT_DISABLED':
      return `${path}.endpoint ${endpoint} is disabled (${codes.ENDPOINT_DISABLED})`;
    case 'PARAMETER_REQUIRED':
      return `${path}.bindings is missing required parameter "${parameter}" (${codes.PARAMETER_REQUIRED})`;
    case 'PARAMETER_UNKNOWN':
      return `${bindingPath}.parameter "${parameter}" is not declared by the endpoint (${codes.PARAMETER_UNKNOWN})`;
    case 'FIELD_MISSING':
      return `${bindingPath}.from.fieldKey "${issue.fieldKey ?? ''}" does not match a schema field (${codes.BINDING_INCOMPATIBLE})`;
    case 'FIELD_INCOMPATIBLE':
      return `${bindingPath}.from.fieldKey "${issue.fieldKey ?? ''}" (${issue.fieldType ?? ''}) cannot fill parameter "${parameter}" (${issue.parameterType ?? ''}) (${codes.BINDING_INCOMPATIBLE})`;
    case 'CONSTANT_REQUIRED_NULL':
      return `${bindingPath}.from.value cannot be null for required parameter "${parameter}" (${codes.BINDING_INCOMPATIBLE})`;
    case 'CONSTANT_INCOMPATIBLE':
      return `${bindingPath}.from.value does not fit parameter "${parameter}" (${issue.parameterType ?? ''}) (${codes.BINDING_INCOMPATIBLE})`;
    case 'CONTEXT_INCOMPATIBLE':
      return `${bindingPath}.from.path is a string and cannot fill parameter "${parameter}" (${issue.parameterType ?? ''}) (${codes.BINDING_INCOMPATIBLE})`;
  }
}
