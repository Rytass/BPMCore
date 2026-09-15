import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookBindingSource,
  NotifyWebhookContextPath,
  NotifyWebhookParameterType,
  NotifyWebhookTarget,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import {
  NotifyWebhookEndpointContract,
  isFormFieldCompatibleWithWebhookParameter,
  readNotifyWebhookCatalogIssueMessage,
  readNotifyWebhookStructureIssues,
  readNotifyWebhookTargetCatalogIssues,
  readNotifyWebhookTargets,
} from '@rytass/bpm-core-shared/workflow-graph';

export type NotifyWebhookBindingKind = NotifyWebhookBindingSource['kind'];

/** The catalog fields the designer reads; a subset of the client record. */
export interface NotifyWebhookDesignerEndpoint extends NotifyWebhookEndpointContract {
  readonly deprecated: boolean;
  readonly description: string | null;
  readonly key: string;
  readonly label: string;
  readonly parameters: readonly {
    readonly description: string | null;
    readonly key: string;
    readonly label: string;
    readonly required: boolean;
    readonly type: NotifyWebhookParameterType;
  }[];
  readonly version: number;
}

type DesignerParameter = NotifyWebhookDesignerEndpoint['parameters'][number];

export const NOTIFY_WEBHOOK_CONTEXT_PATH_LABELS: Readonly<
  Record<NotifyWebhookContextPath, string>
> = {
  'initiator.memberId': '發起人會員編號',
  'instance.id': '案件編號',
  'instance.templateId': '模板編號',
  'instance.templateVersionId': '模板版本編號',
  'instance.title': '案件主旨',
  'node.id': '節點編號',
  'node.label': '節點名稱',
};

export const NOTIFY_WEBHOOK_PARAMETER_TYPE_LABELS: Readonly<
  Record<NotifyWebhookParameterType, string>
> = {
  boolean: '是／否',
  json: 'JSON',
  number: '數字',
  string: '文字',
  stringArray: '文字清單',
};

export function readNotifyWebhookEndpointOptionId(endpoint: {
  readonly key: string;
  readonly version: number;
}): string {
  return `${endpoint.key}@${endpoint.version}`;
}

export function findNotifyWebhookEndpoint(
  endpoints: readonly NotifyWebhookDesignerEndpoint[],
  reference: { readonly key: string; readonly version: number },
): NotifyWebhookDesignerEndpoint | null {
  return (
    endpoints.find(
      (endpoint) =>
        endpoint.key === reference.key &&
        endpoint.version === reference.version,
    ) ?? null
  );
}

/**
 * The sources a parameter can take. A `CONTEXT` path is always a string, and
 * a `CONSTANT` cannot hold a list, so those are only offered where they fit.
 */
export function readNotifyWebhookBindingKinds(
  type: NotifyWebhookParameterType,
): readonly NotifyWebhookBindingKind[] {
  return [
    'FIELD',
    ...(type === 'stringArray' ? [] : (['CONSTANT'] as const)),
    ...(type === 'string' || type === 'json' ? (['CONTEXT'] as const) : []),
  ];
}

export function readCompatibleFormFields(
  formFields: readonly FormFieldDefinition[],
  type: NotifyWebhookParameterType,
): readonly FormFieldDefinition[] {
  return formFields.filter((field) =>
    isFormFieldCompatibleWithWebhookParameter(field, type),
  );
}

/** The value a binding starts with when its source kind is picked. */
export function createNotifyWebhookBindingSource(
  kind: NotifyWebhookBindingKind,
  parameter: DesignerParameter,
  formFields: readonly FormFieldDefinition[],
): NotifyWebhookBindingSource {
  if (kind === 'FIELD') {
    return {
      fieldKey:
        readCompatibleFormFields(formFields, parameter.type)[0]?.fieldKey ?? '',
      kind: 'FIELD',
    };
  }

  if (kind === 'CONTEXT') {
    return { kind: 'CONTEXT', path: 'instance.title' };
  }

  return {
    kind: 'CONSTANT',
    value:
      parameter.type === 'boolean'
        ? true
        : parameter.type === 'number'
          ? 0
          : '',
  };
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Reads a typed constant from a text input. A number parameter takes plain
 * decimals only (no `0x1f`, no exponent); anything else, including a number
 * still being typed such as `1.`, stays text so the publish check can point
 * at it instead of the input silently changing what was typed.
 */
export function readNotifyWebhookConstantValue(
  type: NotifyWebhookParameterType,
  raw: string,
): boolean | number | string | null {
  if (type !== 'number') {
    return raw;
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  return DECIMAL_PATTERN.test(trimmed) ? Number(trimmed) : raw;
}

/**
 * Whether the editor can render a node's `webhooks` at all. Parsed JSON is
 * saved as a draft without the structural lint, so a hand-edited list may
 * hold values the editor would throw on.
 */
export function isNotifyWebhookListEditable(webhooks: unknown): boolean {
  return !readNotifyWebhookStructureIssues(webhooks).some((issue) =>
    UNRENDERABLE_STRUCTURE_CODES.has(issue.code),
  );
}

const UNRENDERABLE_STRUCTURE_CODES: ReadonlySet<string> = new Set([
  'BINDING_INVALID',
  'BINDING_SOURCE_INVALID',
  'BINDINGS_NOT_ARRAY',
  'ENDPOINT_KEY_REQUIRED',
  'ENDPOINT_VERSION_INVALID',
  'TARGET_ID_REQUIRED',
  'TARGET_INVALID',
  'WEBHOOKS_NOT_ARRAY',
]);

/** Sets, or with `null` removes, the binding for one parameter. */
export function setNotifyWebhookBinding(
  target: NotifyWebhookTarget,
  parameter: string,
  from: NotifyWebhookBindingSource | null,
): NotifyWebhookTarget {
  const others = target.bindings.filter(
    (binding) => binding.parameter !== parameter,
  );
  const index = target.bindings.findIndex(
    (binding) => binding.parameter === parameter,
  );

  if (!from) {
    return { ...target, bindings: others };
  }

  const binding = { from, parameter };

  return {
    ...target,
    bindings:
      index === -1
        ? [...target.bindings, binding]
        : target.bindings.map((current, currentIndex) =>
            currentIndex === index ? binding : current,
          ),
  };
}

/**
 * Points a target at another endpoint, keeping the id (deliveries are keyed
 * by it) and every binding whose parameter the new endpoint still declares
 * with a type the bound value fits.
 */
export function switchNotifyWebhookEndpoint(
  target: NotifyWebhookTarget,
  endpoint: NotifyWebhookDesignerEndpoint,
  formFields: readonly FormFieldDefinition[],
): NotifyWebhookTarget {
  const bindings = target.bindings.filter((binding) => {
    const parameter = endpoint.parameters.find(
      (candidate) => candidate.key === binding.parameter,
    );

    return (
      parameter !== undefined &&
      !readNotifyWebhookTargetCatalogIssues({
        endpoint: {
          parameters: [{ ...parameter, required: false }],
        },
        formFields,
        target: { ...target, bindings: [binding] },
      }).length
    );
  });

  return {
    bindings,
    endpoint: { key: endpoint.key, version: endpoint.version },
    id: target.id,
  };
}

/**
 * The publish check the backend runs against the catalog, worded for the
 * designer. Only structurally valid targets are checked; shape problems are
 * already reported by the shared structural lint.
 */
export function readNotifyWebhookDesignerIssues({
  definition,
  endpoints,
  formFields,
}: {
  readonly definition: WorkflowDefinition;
  readonly endpoints: readonly NotifyWebhookDesignerEndpoint[];
  readonly formFields: readonly FormFieldDefinition[];
}): readonly string[] {
  return definition.nodes.flatMap((node) => {
    if (node.type !== 'serviceTask' || node.data.action.type !== 'NOTIFY') {
      return [];
    }

    const structureIssues = readNotifyWebhookStructureIssues(
      node.data.action.webhooks,
    );

    if (structureIssues.length) {
      return [];
    }

    return readNotifyWebhookTargets(node.data.action).flatMap(
      (target, targetIndex) => {
        const endpoint = findNotifyWebhookEndpoint(endpoints, target.endpoint);

        return readNotifyWebhookTargetCatalogIssues({
          endpoint,
          formFields,
          target,
        }).map((issue) =>
          readNotifyWebhookCatalogIssueMessage({
            endpointLabel:
              endpoint?.label ??
              readNotifyWebhookEndpointOptionId(target.endpoint),
            issue,
            nodeLabel: node.data.label,
            targetIndex,
          }),
        );
      },
    );
  });
}
