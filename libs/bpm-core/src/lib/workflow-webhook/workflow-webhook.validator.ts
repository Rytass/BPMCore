import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookBinding,
  NotifyWebhookTarget,
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  isFormFieldCompatibleWithWebhookParameter,
  isNotifyWebhookValueCompatibleWithParameter,
  readNotifyWebhookTargets,
} from '@rytass/bpm-core-shared/workflow-graph';
import { BPM_WORKFLOW_WEBHOOK_ERROR_CODES } from './workflow-webhook.errors';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookParameter,
} from './workflow-webhook.types';

export interface LintWorkflowWebhookTargetsInput {
  readonly definition: WorkflowDefinition;
  readonly formSchema: FormDefinitionSchema;
  readonly hasEndpointSources: boolean;
  readonly resolveEndpoint: (
    key: string,
    version: number,
  ) => Promise<BPMWorkflowWebhookEndpointEntry | null>;
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
    nodes.flatMap((node) =>
      readNotifyWebhookTargets(node.data.action).map((target, targetIndex) =>
        lintTarget({
          formSchema: input.formSchema,
          nodeId: node.id,
          resolveEndpoint: input.resolveEndpoint,
          target,
          targetIndex,
        }),
      ),
    ),
  );

  return results.flat();
}

async function lintTarget({
  formSchema,
  nodeId,
  resolveEndpoint,
  target,
  targetIndex,
}: {
  readonly formSchema: FormDefinitionSchema;
  readonly nodeId: string;
  readonly resolveEndpoint: LintWorkflowWebhookTargetsInput['resolveEndpoint'];
  readonly target: NotifyWebhookTarget;
  readonly targetIndex: number;
}): Promise<readonly string[]> {
  const path = `workflow.nodes.${nodeId}.action.webhooks[${targetIndex}]`;
  const entry = await resolveEndpoint(
    target.endpoint.key,
    target.endpoint.version,
  );

  if (!entry) {
    return [
      `${path}.endpoint ${target.endpoint.key}@${target.endpoint.version} is not registered (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_MISSING})`,
    ];
  }

  const descriptor = entry.endpoint.descriptor;

  if (descriptor.deprecated) {
    return [
      `${path}.endpoint ${target.endpoint.key}@${target.endpoint.version} is deprecated (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.ENDPOINT_DEPRECATED})`,
    ];
  }

  const boundParameters = new Set(
    target.bindings.map((binding) => binding.parameter),
  );

  return [
    ...descriptor.parameters.flatMap((parameter) =>
      parameter.required && !boundParameters.has(parameter.key)
        ? [
            `${path}.bindings is missing required parameter "${parameter.key}" (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.PARAMETER_REQUIRED})`,
          ]
        : [],
    ),
    ...target.bindings.flatMap((binding, bindingIndex) =>
      lintBinding({
        binding,
        bindingIndex,
        formSchema,
        parameters: descriptor.parameters,
        path,
      }),
    ),
  ];
}

function lintBinding({
  binding,
  bindingIndex,
  formSchema,
  parameters,
  path,
}: {
  readonly binding: NotifyWebhookBinding;
  readonly bindingIndex: number;
  readonly formSchema: FormDefinitionSchema;
  readonly parameters: readonly BPMWorkflowWebhookParameter[];
  readonly path: string;
}): readonly string[] {
  const bindingPath = `${path}.bindings[${bindingIndex}]`;
  const from = binding.from;
  const parameter = parameters.find(
    (candidate) => candidate.key === binding.parameter,
  );

  if (!parameter) {
    return [
      `${bindingPath}.parameter "${binding.parameter}" is not declared by the endpoint (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.PARAMETER_UNKNOWN})`,
    ];
  }

  if (from.kind === 'FIELD') {
    const field = formSchema.fields.find(
      (candidate) => candidate.fieldKey === from.fieldKey,
    );

    if (!field) {
      return [
        `${bindingPath}.from.fieldKey "${from.fieldKey}" does not match a schema field (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.BINDING_INCOMPATIBLE})`,
      ];
    }

    return isFormFieldCompatibleWithWebhookParameter(field, parameter.type)
      ? []
      : [
          `${bindingPath}.from.fieldKey "${from.fieldKey}" (${field.type}) cannot fill parameter "${parameter.key}" (${parameter.type}) (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.BINDING_INCOMPATIBLE})`,
        ];
  }

  if (from.kind === 'CONSTANT') {
    return isNotifyWebhookValueCompatibleWithParameter(
      from.value,
      parameter.type,
    )
      ? []
      : [
          `${bindingPath}.from.value does not fit parameter "${parameter.key}" (${parameter.type}) (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.BINDING_INCOMPATIBLE})`,
        ];
  }

  // Every CONTEXT path resolves to a string, so anything but a string or an
  // opaque json parameter is a mistake the author should see at publish.
  return parameter.type === 'string' || parameter.type === 'json'
    ? []
    : [
        `${bindingPath}.from.path is a string and cannot fill parameter "${parameter.key}" (${parameter.type}) (${BPM_WORKFLOW_WEBHOOK_ERROR_CODES.BINDING_INCOMPATIBLE})`,
      ];
}
