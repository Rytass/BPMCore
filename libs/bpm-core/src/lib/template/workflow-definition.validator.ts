import {
  ApproverResolver,
  ExcludeInitiatorConfig,
  ExcludeInitiatorWhenEmpty,
  FieldPermission,
  ServiceAction,
  SlaCalendarMode,
  SlaConfig,
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  readApproverFilledFieldKeys,
  readNodeEditableFieldKeys,
  readNodeFieldPermissions,
  readTopLevelFieldKey,
} from '@rytass/bpm-core-shared';
import {
  isDecisionPolicyUnsatisfiable,
  isNotifyRecipientsEmpty,
  NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX,
  NOTIFY_WEBHOOK_TARGET_LIMIT,
  NotifyWebhookStructureIssue,
  readDesignTimeApproverCount,
  isOrgManagerChainDecisionPolicyInvalid,
  readNotifyWebhookStructureIssues,
  readNotifyWebhookTargets,
  WORKFLOW_LINT_MESSAGES,
} from '@rytass/bpm-core-shared/workflow-graph';
import { parseIsoDurationParts } from '../common/iso-duration';

const SLA_TIMEOUT_ACTIONS: readonly SlaConfig['onTimeout'][] = [
  'REMIND',
  'AUTO_APPROVE',
  'ESCALATE',
  'TERMINATE_INSTANCE',
];

const EXCLUDE_INITIATOR_WHEN_EMPTY_VALUES: readonly ExcludeInitiatorWhenEmpty[] =
  ['FAIL', 'INITIATOR_MANAGER', 'SKIP_NODE'];

const SLA_CALENDAR_MODES: readonly SlaCalendarMode[] = [
  'CALENDAR',
  'BUSINESS_DAY',
];

export interface WorkflowDefinitionLintResult {
  readonly errors: readonly string[];
  readonly valid: boolean;
  readonly warnings: readonly string[];
}

export const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
  edges: [],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 80, y: 160 },
      type: 'startEvent',
    },
    {
      data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
      id: 'end',
      position: { x: 520, y: 160 },
      type: 'endEvent',
    },
  ],
};

export function parseWorkflowDefinitionJson(
  value: string | null | undefined,
): WorkflowDefinition {
  if (!value) {
    return EMPTY_WORKFLOW_DEFINITION;
  }

  const parsedValue = JSON.parse(value) as unknown;

  return parsedValue as WorkflowDefinition;
}

// The structural lines (blank node label in lintNodeShape, gateway edges,
// reachability, cycles, start/end count, NOTIFY outgoing edges) come from
// `WORKFLOW_LINT_MESSAGES`, which the designer also matches to translate them
// (`readWorkflowLintMessage` in `@rytass/bpm-core-client/template`). Write a
// new structural line there too, not inline here.
export function lintWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinitionLintResult {
  const basicErrors = lintBasicShape(definition);

  if (basicErrors.length) {
    return { errors: basicErrors, valid: false, warnings: [] };
  }

  const nodes = definition.nodes;
  const edges = definition.edges;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const startNodes = nodes.filter((node) => node.type === 'startEvent');
  const endNodes = nodes.filter((node) => node.type === 'endEvent');
  const topologyErrors = [
    ...(startNodes.length === 1
      ? []
      : [WORKFLOW_LINT_MESSAGES.startEventCount()]),
    ...(endNodes.length >= 1 ? [] : [WORKFLOW_LINT_MESSAGES.endEventMissing()]),
    ...lintEdges(edges, nodeIds),
    ...lintUserTaskNodes(nodes),
    ...lintServiceTaskNodes(nodes),
    ...lintApproverFilledFieldWrites(definition),
    ...lintAsyncNotifyOutgoingEdges(nodes, edges),
    ...lintExclusiveGateways(nodes, edges),
    ...lintParallelGateways(nodes, edges),
  ];

  if (topologyErrors.length) {
    return { errors: topologyErrors, valid: false, warnings: [] };
  }

  const startNode = startNodes[0];
  const reachabilityErrors = startNode
    ? lintReachability(nodes, edges, startNode.id)
    : [];
  const cycleErrors = startNode ? lintCycles(edges, startNode.id) : [];
  const errors = [...reachabilityErrors, ...cycleErrors];

  return {
    errors,
    valid: errors.length === 0,
    warnings: lintSlaWarnings(nodes),
  };
}

function lintBasicShape(definition: WorkflowDefinition): readonly string[] {
  const errors = [
    ...(definition?.meta?.schemaVersion === 1
      ? []
      : ['workflow.meta.schemaVersion must be 1']),
    ...(Array.isArray(definition?.nodes)
      ? []
      : ['workflow.nodes must be an array']),
    ...(Array.isArray(definition?.edges)
      ? []
      : ['workflow.edges must be an array']),
  ];

  if (errors.length) {
    return errors;
  }

  const nodeErrors = definition.nodes.flatMap((node, index) =>
    lintNodeShape(node, index),
  );
  const edgeErrors = definition.edges.flatMap((edge, index) =>
    lintEdgeShape(edge, index),
  );
  const duplicateNodeErrors = readDuplicateErrors(
    definition.nodes.map((node) => node.id),
    'workflow.nodes id is duplicated',
  );
  const duplicateEdgeErrors = readDuplicateErrors(
    definition.edges.map((edge) => edge.id),
    'workflow.edges id is duplicated',
  );

  return [
    ...nodeErrors,
    ...edgeErrors,
    ...duplicateNodeErrors,
    ...duplicateEdgeErrors,
  ];
}

function lintNodeShape(node: WorkflowNode, index: number): readonly string[] {
  const path = `workflow.nodes[${index}]`;

  return [
    ...(typeof node.id === 'string' && node.id.trim()
      ? []
      : [`${path}.id must be a non-empty string`]),
    ...(typeof node.type === 'string' && node.type.trim()
      ? []
      : [`${path}.type must be a non-empty string`]),
    ...(typeof node.data?.label === 'string' && node.data.label.trim()
      ? []
      : [WORKFLOW_LINT_MESSAGES.blankNodeLabel(index)]),
    ...(!node.data?.triggerMode ||
    node.data.triggerMode === 'AND' ||
    node.data.triggerMode === 'OR'
      ? []
      : [`${path}.data.triggerMode must be AND or OR`]),
    ...(typeof node.position?.x === 'number' &&
    typeof node.position?.y === 'number'
      ? []
      : [`${path}.position must include numeric x and y`]),
  ];
}

function lintEdgeShape(edge: WorkflowEdge, index: number): readonly string[] {
  const path = `workflow.edges[${index}]`;

  return [
    ...(typeof edge.id === 'string' && edge.id.trim()
      ? []
      : [`${path}.id must be a non-empty string`]),
    ...(typeof edge.source === 'string' && edge.source.trim()
      ? []
      : [`${path}.source must be a non-empty string`]),
    ...(typeof edge.target === 'string' && edge.target.trim()
      ? []
      : [`${path}.target must be a non-empty string`]),
  ];
}

function lintEdges(
  edges: readonly WorkflowEdge[],
  nodeIds: ReadonlySet<string>,
): readonly string[] {
  return edges.flatMap((edge) => [
    ...(nodeIds.has(edge.source)
      ? []
      : [`workflow.edges.${edge.id}.source does not match a node`]),
    ...(nodeIds.has(edge.target)
      ? []
      : [`workflow.edges.${edge.id}.target does not match a node`]),
  ]);
}

function lintUserTaskNodes(nodes: readonly WorkflowNode[]): readonly string[] {
  return nodes
    .filter((node): node is UserTaskNode => node.type === 'userTask')
    .flatMap((node) => {
      const data = node.data;

      return [
        ...lintApproverResolver(data.approverResolver, node.id),
        ...(data.decisionPolicy?.type
          ? []
          : [`workflow.nodes.${node.id}.decisionPolicy is required`]),
        // One manager's approval must not close a chain node, so only the
        // policies that wait for every candidate are allowed.
        ...(isOrgManagerChainDecisionPolicyInvalid(
          data.approverResolver,
          data.decisionPolicy,
        )
          ? [
              `workflow.nodes.${node.id}.decisionPolicy must be SEQUENTIAL or PARALLEL_ALL when approverResolver is ORG_MANAGER_CHAIN`,
            ]
          : []),
        // A COUNT quorum above the number of approvers the node can produce
        // deadlocks the task forever — the engine gates on
        // `completedCount >= threshold` and an ad-hoc signer opens a separate
        // task instead of adding a candidate here. Only DIRECT exposes its
        // count in the definition; everything else is a runtime question.
        ...(isDecisionPolicyUnsatisfiable(
          data.decisionPolicy,
          data.approverResolver,
        )
          ? [
              `workflow.nodes.${node.id}.decisionPolicy.threshold exceeds the ${readDesignTimeApproverCount(data.approverResolver)} approver(s) this node resolves to`,
            ]
          : []),
        ...(data.returnBehavior?.allowedTargets
          ? []
          : [`workflow.nodes.${node.id}.returnBehavior is required`]),
        ...(!data.returnBehavior?.resubmitStrategy ||
        data.returnBehavior.resubmitStrategy === 'RESTART' ||
        data.returnBehavior.resubmitStrategy === 'FROM_RETURN_POINT'
          ? []
          : [
              `workflow.nodes.${node.id}.returnBehavior.resubmitStrategy is invalid`,
            ]),
        ...(data.returnBehavior?.requireComment === undefined ||
        typeof data.returnBehavior.requireComment === 'boolean'
          ? []
          : [
              `workflow.nodes.${node.id}.returnBehavior.requireComment must be a boolean`,
            ]),
        ...lintExcludeInitiator(data.excludeInitiator, node.id),
        ...lintSlaConfig(data.sla, node.id),
        ...lintFieldPermissions(node),
      ];
    });
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldPermissionEntryValid(
  entry: unknown,
): entry is FieldPermission {
  return (
    isPlainRecord(entry) &&
    typeof entry['fieldPath'] === 'string' &&
    entry['fieldPath'].trim() !== '' &&
    typeof entry['visible'] === 'boolean' &&
    typeof entry['editable'] === 'boolean' &&
    (entry['required'] === undefined || typeof entry['required'] === 'boolean')
  );
}

/**
 * The shape and duplicate checks read the raw `fieldPermissions`:
 * `readNodeFieldPermissions` tolerates a bad draft by skipping malformed
 * entries and keeping the first entry per `fieldPath`, which is exactly what
 * these two checks have to see. Once the shape is reported, the node's other
 * field permission rules are skipped, since they would read a list the engine
 * is not going to honour anyway.
 */
function lintFieldPermissions(node: UserTaskNode): readonly string[] {
  const nodeId = node.id;
  const raw: unknown = node.data.fieldPermissions;

  if (raw === undefined) {
    return [];
  }

  const entries: readonly unknown[] | undefined = Array.isArray(raw)
    ? raw
    : undefined;

  if (entries === undefined || !entries.every(isFieldPermissionEntryValid)) {
    return [WORKFLOW_LINT_MESSAGES.fieldPermissionsInvalid(nodeId)];
  }

  const fieldPaths = entries.map((entry) => entry.fieldPath);
  const hasEditableField = readNodeEditableFieldKeys(node).size > 0;

  return [
    ...fieldPaths
      .filter((fieldPath, index) => fieldPaths.indexOf(fieldPath) !== index)
      .filter(
        (fieldPath, index, repeated) => repeated.indexOf(fieldPath) === index,
      )
      .map((fieldPath) =>
        WORKFLOW_LINT_MESSAGES.fieldPermissionDuplicate(nodeId, fieldPath),
      ),
    ...readNodeFieldPermissions(node).flatMap((permission) => [
      ...(permission.fieldPath.includes('.') ||
      permission.fieldPath.includes('[')
        ? [
            WORKFLOW_LINT_MESSAGES.fieldPermissionNestedPath(
              nodeId,
              permission.fieldPath,
            ),
          ]
        : []),
      ...(permission.editable && !permission.visible
        ? [
            WORKFLOW_LINT_MESSAGES.fieldPermissionEditableInvisible(
              nodeId,
              permission.fieldPath,
            ),
          ]
        : []),
      ...(permission.required && !permission.editable
        ? [
            WORKFLOW_LINT_MESSAGES.fieldPermissionRequiredNotEditable(
              nodeId,
              permission.fieldPath,
            ),
          ]
        : []),
    ]),
    ...(hasEditableField &&
    (node.data.decisionPolicy?.type === 'PARALLEL_ALL' ||
      node.data.decisionPolicy?.type === 'QUORUM')
      ? [WORKFLOW_LINT_MESSAGES.fieldPermissionGroupPolicy(nodeId)]
      : []),
    ...(hasEditableField && node.data.sla?.onTimeout === 'AUTO_APPROVE'
      ? [WORKFLOW_LINT_MESSAGES.fieldPermissionAutoApprove(nodeId)]
      : []),
    ...(hasEditableField &&
    node.data.excludeInitiator?.whenEmpty === 'SKIP_NODE'
      ? [WORKFLOW_LINT_MESSAGES.fieldPermissionSkipNode(nodeId)]
      : []),
  ];
}

/**
 * A field an approver fills in is empty until then, and the approver's value
 * is the one the case keeps. A system node writing it would either be
 * overwritten or overwrite the approver, so the two are kept apart.
 */
function lintApproverFilledFieldWrites(
  definition: WorkflowDefinition,
): readonly string[] {
  const approverFilled = readApproverFilledFieldKeys(definition);

  return definition.nodes
    .filter((node) => node.type === 'serviceTask')
    .flatMap((node) => {
      const action: unknown = node.data.action;
      const fieldPath = isPlainRecord(action) ? action['fieldPath'] : undefined;
      const fieldKey =
        isPlainRecord(action) &&
        action['type'] === 'SET_FORM_FIELD' &&
        typeof fieldPath === 'string'
          ? readTopLevelFieldKey(fieldPath)
          : undefined;

      return fieldKey !== undefined && approverFilled.has(fieldKey)
        ? [
            WORKFLOW_LINT_MESSAGES.setFormFieldApproverFilled(
              node.id,
              fieldKey,
            ),
          ]
        : [];
    });
}

function lintExcludeInitiator(
  config: ExcludeInitiatorConfig | undefined,
  nodeId: string,
): readonly string[] {
  if (config === undefined) {
    return [];
  }

  return EXCLUDE_INITIATOR_WHEN_EMPTY_VALUES.includes(config?.whenEmpty)
    ? []
    : [`workflow.nodes.${nodeId}.excludeInitiator.whenEmpty is invalid`];
}

function lintSlaConfig(
  sla: SlaConfig | undefined,
  nodeId: string,
): readonly string[] {
  if (!sla) {
    return [];
  }

  return [
    ...(parseIsoDurationParts(sla.duration ?? '')
      ? []
      : [`workflow.nodes.${nodeId}.sla.duration is not a valid ISO duration`]),
    ...(SLA_TIMEOUT_ACTIONS.includes(sla.onTimeout)
      ? []
      : [`workflow.nodes.${nodeId}.sla.onTimeout is invalid`]),
    ...(sla.calendar === undefined || SLA_CALENDAR_MODES.includes(sla.calendar)
      ? []
      : [`workflow.nodes.${nodeId}.sla.calendar is invalid`]),
  ];
}

function isSlaWarningAtUsable(sla: SlaConfig): boolean {
  return (
    sla.warningAt === undefined ||
    (typeof sla.warningAt === 'number' &&
      sla.warningAt > 0 &&
      sla.warningAt < 1)
  );
}

/**
 * `BUSINESS_DAY` only advances the duration's day component; any hour/minute
 * part is added as plain elapsed time afterwards and can therefore land outside
 * working hours. That is legal but rarely intended, so it surfaces as a
 * warning rather than blocking publication.
 */
function lintSlaWarnings(nodes: readonly WorkflowNode[]): readonly string[] {
  return nodes
    .filter((node) => node.type === 'userTask')
    .flatMap((node) => {
      const sla = node.data.sla;

      if (!sla) {
        return [];
      }

      const parts = parseIsoDurationParts(sla.duration ?? '');
      const mixesBusinessDayWithTime =
        sla.calendar === 'BUSINESS_DAY' && Boolean(parts) && parts?.timeMs !== 0;

      return [
        ...(mixesBusinessDayWithTime
          ? [
              `workflow.nodes.${node.id}.sla mixes BUSINESS_DAY with an hour/minute component; only the day part skips non-business days`,
            ]
          : []),
        // Deliberately a warning, not an error: the SLA scanner has always
        // ignored an out-of-range warningAt, so promoting it to an error would
        // block republishing templates that already carry one (for example a
        // percentage stored as `75` instead of `0.75`).
        ...(isSlaWarningAtUsable(sla)
          ? []
          : [
              `workflow.nodes.${node.id}.sla.warningAt must be between 0 and 1; the warning notification is skipped`,
            ]),
      ];
    });
}

function lintApproverResolver(
  resolver: ApproverResolver,
  nodeId: string,
): readonly string[] {
  if (!resolver?.type) {
    return [`workflow.nodes.${nodeId}.approverResolver is required`];
  }

  if (resolver.type === 'DIRECT' && resolver.memberIds.length === 0) {
    return [`workflow.nodes.${nodeId}.approverResolver.memberIds is required`];
  }

  if (resolver.type === 'POSITION' && !resolver.positionId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.positionId is required`];
  }

  if (resolver.type === 'ORG_UNIT_MEMBER' && !resolver.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.orgUnitId is required`];
  }

  if (
    resolver.type === 'ORG_UNIT_POSITION' &&
    (!resolver.orgUnitId.trim() || !resolver.positionId.trim())
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.orgUnitId and positionId are required`,
    ];
  }

  if (resolver.type === 'ORG_UNIT_MANAGER' && !resolver.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.orgUnitId is required`];
  }

  if (resolver.type === 'ORG_MANAGER' && resolver.levelsUp < 1) {
    return [`workflow.nodes.${nodeId}.approverResolver.levelsUp is invalid`];
  }

  if (
    resolver.type === 'ORG_MANAGER_CHAIN' &&
    !Number.isInteger(resolver.minPositionLevel)
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.minPositionLevel is invalid`,
    ];
  }

  if (
    (resolver.type === 'ORG_MANAGER' ||
      resolver.type === 'ORG_UNIT_MANAGER' ||
      resolver.type === 'ORG_MANAGER_CHAIN') &&
    resolver.fallback?.type === 'DIRECT' &&
    !resolver.fallback.memberId.trim()
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.fallback.memberId is required`,
    ];
  }

  // Like the POSITION node itself, existence is not checked here: the lint has
  // no position directory, and a position may legitimately be empty today.
  if (
    (resolver.type === 'ORG_MANAGER' ||
      resolver.type === 'ORG_UNIT_MANAGER' ||
      resolver.type === 'ORG_MANAGER_CHAIN') &&
    resolver.fallback?.type === 'POSITION' &&
    !resolver.fallback.positionId.trim()
  ) {
    return [
      `workflow.nodes.${nodeId}.approverResolver.fallback.positionId is required`,
    ];
  }

  if (resolver.type === 'DYNAMIC_FORM' && !resolver.formPath.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.formPath is required`];
  }

  if (resolver.type === 'EXPRESSION' && !resolver.expression.trim()) {
    return [`workflow.nodes.${nodeId}.approverResolver.expression is required`];
  }

  return [];
}

function lintServiceTaskNodes(
  nodes: readonly WorkflowNode[],
): readonly string[] {
  return nodes
    .filter((node) => node.type === 'serviceTask')
    .flatMap((node) => lintServiceAction(node.data.action, node.id));
}

function lintServiceAction(
  action: ServiceAction,
  nodeId: string,
): readonly string[] {
  if (!action?.type) {
    return [`workflow.nodes.${nodeId}.action is required`];
  }

  if (action.type === 'WEBHOOK' && !action.url.trim()) {
    return [`workflow.nodes.${nodeId}.action.url is required`];
  }

  if (action.type === 'SET_FORM_FIELD' && !action.fieldPath.trim()) {
    return [`workflow.nodes.${nodeId}.action.fieldPath is required`];
  }

  if (action.type === 'NOTIFY') {
    return lintNotifyAction(action, nodeId);
  }

  return [];
}

function lintNotifyAction(
  action: Extract<ServiceAction, { readonly type: 'NOTIFY' }>,
  nodeId: string,
): readonly string[] {
  const webhookErrors = readNotifyWebhookStructureIssues(action.webhooks).map(
    (issue) => formatNotifyWebhookIssue(issue, nodeId),
  );
  // A node may notify only external systems: an empty DIRECT resolver is
  // accepted once at least one webhook target is configured (ADR 18 §3.2).
  const recipientErrors =
    isNotifyRecipientsEmpty(action.recipients) &&
    readNotifyWebhookTargets(action).length > 0
      ? []
      : lintNotifyRecipients(action.recipients, nodeId);

  return [...recipientErrors, ...webhookErrors];
}

function formatNotifyWebhookIssue(
  issue: NotifyWebhookStructureIssue,
  nodeId: string,
): string {
  const webhooksPath = `workflow.nodes.${nodeId}.action.webhooks`;
  const targetPath =
    issue.targetIndex === null
      ? webhooksPath
      : `${webhooksPath}[${issue.targetIndex}]`;
  const bindingPath =
    issue.bindingIndex === null
      ? `${targetPath}.bindings`
      : `${targetPath}.bindings[${issue.bindingIndex}]`;

  switch (issue.code) {
    case 'WEBHOOKS_NOT_ARRAY':
      return `${webhooksPath} must be an array`;
    case 'TARGET_LIMIT_EXCEEDED':
      return `${webhooksPath} exceeds the limit of ${NOTIFY_WEBHOOK_TARGET_LIMIT} targets`;
    case 'TARGET_INVALID':
      return `${targetPath} must be an object`;
    case 'TARGET_ID_REQUIRED':
      return `${targetPath}.id is required`;
    case 'TARGET_ID_DUPLICATE':
      return `${targetPath}.id must be unique within the node`;
    case 'ENDPOINT_KEY_REQUIRED':
      return `${targetPath}.endpoint.key is required`;
    case 'ENDPOINT_VERSION_INVALID':
      return `${targetPath}.endpoint.version must be an integer between 1 and ${NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX}`;
    case 'BINDINGS_NOT_ARRAY':
      return `${targetPath}.bindings must be an array`;
    case 'BINDING_INVALID':
      return `${bindingPath} must be an object`;
    case 'BINDING_PARAMETER_REQUIRED':
      return `${bindingPath}.parameter is required`;
    case 'BINDING_PARAMETER_DUPLICATE':
      return `${bindingPath}.parameter "${issue.parameter ?? ''}" is bound more than once`;
    case 'BINDING_SOURCE_INVALID':
      return `${bindingPath}.from.kind must be FIELD, CONSTANT or CONTEXT`;
    case 'BINDING_FIELD_KEY_REQUIRED':
      return `${bindingPath}.from.fieldKey is required`;
    case 'BINDING_CONTEXT_PATH_INVALID':
      return `${bindingPath}.from.path is not a supported context path`;
    case 'BINDING_CONSTANT_INVALID':
      return `${bindingPath}.from.value must be a string, finite number, boolean or null`;
    case 'UNKNOWN_PROPERTY':
      return `${issue.bindingIndex === null ? targetPath : bindingPath}.${issue.property ?? ''} is not allowed`;
  }
}

function lintNotifyRecipients(
  recipients: ApproverResolver,
  nodeId: string,
): readonly string[] {
  if (!recipients?.type) {
    return [`workflow.nodes.${nodeId}.action.recipients is required`];
  }

  if (recipients.type === 'DIRECT' && recipients.memberIds.length === 0) {
    return [`workflow.nodes.${nodeId}.action.recipients.memberIds is required`];
  }

  if (recipients.type === 'POSITION' && !recipients.positionId.trim()) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.positionId is required`,
    ];
  }

  if (recipients.type === 'ORG_UNIT_MEMBER' && !recipients.orgUnitId.trim()) {
    return [`workflow.nodes.${nodeId}.action.recipients.orgUnitId is required`];
  }

  if (
    recipients.type === 'ORG_UNIT_POSITION' &&
    (!recipients.orgUnitId.trim() || !recipients.positionId.trim())
  ) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.orgUnitId and positionId are required`,
    ];
  }

  if (recipients.type === 'DYNAMIC_FORM' && !recipients.formPath.trim()) {
    return [`workflow.nodes.${nodeId}.action.recipients.formPath is required`];
  }

  if (recipients.type === 'EXPRESSION' && !recipients.expression.trim()) {
    return [
      `workflow.nodes.${nodeId}.action.recipients.expression is required`,
    ];
  }

  return [];
}

function lintAsyncNotifyOutgoingEdges(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  const asyncNotifyNodeIds = new Set(
    nodes
      .filter((node) => isAsyncNotifyServiceTask(node))
      .map((node) => node.id),
  );

  return edges
    .filter((edge) => asyncNotifyNodeIds.has(edge.source))
    .map((edge) => WORKFLOW_LINT_MESSAGES.notifyOutgoingEdge(edge.id));
}

function lintExclusiveGateways(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  return nodes
    .filter(
      (node) =>
        node.type === 'exclusiveGateway' && node.data.direction === 'split',
    )
    .flatMap((node) => {
      const outgoingEdges = edges.filter((edge) => edge.source === node.id);

      return [
        ...(outgoingEdges.length >= 2
          ? []
          : [WORKFLOW_LINT_MESSAGES.exclusiveSplitOutgoingEdges(node.id)]),
        ...(outgoingEdges.some((edge) => edge.data.isDefault)
          ? []
          : [WORKFLOW_LINT_MESSAGES.exclusiveSplitDefaultEdge(node.id)]),
      ];
    });
}

function lintParallelGateways(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): readonly string[] {
  return nodes
    .filter(
      (node) =>
        node.type === 'parallelGateway' && node.data.direction === 'join',
    )
    .flatMap((node) => {
      const incomingEdges = edges.filter((edge) => edge.target === node.id);

      return incomingEdges.length >= 2
        ? []
        : [WORKFLOW_LINT_MESSAGES.parallelJoinIncomingEdges(node.id)];
    });
}

function lintReachability(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): readonly string[] {
  const reachableNodeIds = readReachableNodeIds(edges, startNodeId);
  const unreachableErrors = nodes
    .filter((node) => !reachableNodeIds.has(node.id))
    .map((node) => WORKFLOW_LINT_MESSAGES.unreachableNode(node.id));
  const noEndPathErrors = nodes
    .filter(
      (node) =>
        node.type !== 'endEvent' &&
        !isAsyncNotifyServiceTask(node) &&
        !hasPathToEnd(node.id, nodes, edges, new Set<string>()),
    )
    .map((node) => WORKFLOW_LINT_MESSAGES.noPathToEnd(node.id));

  return [...unreachableErrors, ...noEndPathErrors];
}

function isAsyncNotifyServiceTask(node: WorkflowNode): boolean {
  return node.type === 'serviceTask' && node.data.action.type === 'NOTIFY';
}

function readReachableNodeIds(
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): ReadonlySet<string> {
  return visitReachableNodeIds(edges, [startNodeId], new Set([startNodeId]));
}

function visitReachableNodeIds(
  edges: readonly WorkflowEdge[],
  pendingNodeIds: readonly string[],
  visitedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentNodeId = pendingNodeIds[0];

  if (!currentNodeId) {
    return visitedNodeIds;
  }

  const remainingNodeIds = pendingNodeIds.slice(1);
  const nextNodeIds = edges
    .filter((edge) => edge.source === currentNodeId)
    .map((edge) => edge.target)
    .filter((nodeId) => !visitedNodeIds.has(nodeId));
  const nextVisitedNodeIds = new Set([...visitedNodeIds, ...nextNodeIds]);

  return visitReachableNodeIds(
    edges,
    [...remainingNodeIds, ...nextNodeIds],
    nextVisitedNodeIds,
  );
}

function hasPathToEnd(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  visited: ReadonlySet<string>,
): boolean {
  const node = nodes.find((candidate) => candidate.id === nodeId);

  if (!node || visited.has(nodeId)) {
    return false;
  }

  if (node.type === 'endEvent') {
    return true;
  }

  const nextVisited = new Set([...visited, nodeId]);

  return edges
    .filter((edge) => edge.source === nodeId)
    .some((edge) => hasPathToEnd(edge.target, nodes, edges, nextVisited));
}

function lintCycles(
  edges: readonly WorkflowEdge[],
  startNodeId: string,
): readonly string[] {
  const cyclicNodeIds = readCyclicNodeIds(edges, startNodeId, [], new Set());

  return [...cyclicNodeIds].map((nodeId) =>
    WORKFLOW_LINT_MESSAGES.cycle(nodeId),
  );
}

function readCyclicNodeIds(
  edges: readonly WorkflowEdge[],
  nodeId: string,
  path: readonly string[],
  visitedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (path.includes(nodeId)) {
    return new Set([nodeId]);
  }

  if (visitedNodeIds.has(nodeId)) {
    return new Set();
  }

  const nextVisitedNodeIds = new Set([...visitedNodeIds, nodeId]);
  const nextPath = [...path, nodeId];

  return edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) =>
      readCyclicNodeIds(edges, edge.target, nextPath, nextVisitedNodeIds),
    )
    .reduce<ReadonlySet<string>>(
      (currentNodeIds, nextNodeIds) =>
        new Set([...currentNodeIds, ...nextNodeIds]),
      new Set(),
    );
}

function readDuplicateErrors(
  values: readonly string[],
  message: string,
): readonly string[] {
  return values
    .filter((value, index) => values.indexOf(value) !== index)
    .filter((value, index, duplicates) => duplicates.indexOf(value) === index)
    .map((value) => `${message}: ${value}`);
}
