import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormDataSourceFieldDefinition,
  isTableFieldDefinition,
} from './form';
import {
  readApproverFilledFieldKeys,
  readFormFieldPathTopLevelKey,
  readNodeFieldAccess,
  readNodeFillableFieldKeys,
} from './field-access';
import type {
  FieldAccessDisplay,
  FieldAccessEntry,
  FieldAccessFill,
  UserTaskNode,
  WorkflowDefinition,
} from './workflow';
import {
  APPLICANT_FIELD_CONDITION_RULES,
  APPROVER_FILLED_FORM_RULES,
  WORKFLOW_LINT_MESSAGES,
} from './workflow-graph';
import {
  isOnOwnParallelBranch,
  readReachableWorkflowNodeIds,
  readWorkflowParallelBranchSets,
} from './workflow-reachability';

// The graph walks live in a leaf module so `workflow-graph` can use them too
// (it cannot import this file: this file reads its constants at load time).
export {
  isOnOwnParallelBranch,
  readReachableWorkflowNodeIds,
  readWorkflowParallelBranchSets,
};

/**
 * The field access rules (ADR 20 §4) as structured issues. The publish lint
 * turns each into its `message` line, and the designer's field access matrix
 * places it on the fields and nodes it names, so the two read one rule set.
 * `lintApproverFilledFieldReads` (a condition reading a field before anybody
 * filled it in) stays in the backend: it needs the expression sources of
 * every node, which the matrix does not show.
 */
export type FieldAccessIssueCode =
  | 'applicantRuleReadsApproverFilled'
  | 'approverFilledFieldDataSource'
  | 'approverFilledFieldFileUpload'
  | 'approverFilledFieldFormRule'
  | 'approverFilledMultipleFillNodesOnPath'
  | 'approverFilledRequiredBoolean'
  | 'approverFilledTableDataSourceColumn'
  | 'fieldAccessAutoApprove'
  | 'fieldAccessDuplicate'
  | 'fieldAccessFillHidden'
  | 'fieldAccessGroupPolicy'
  | 'fieldAccessInvalid'
  | 'fieldAccessSkipNode'
  | 'fieldAccessUnknownField'
  | 'legacyFieldPermissions'
  | 'setFormFieldApproverFilled';

export interface FieldAccessIssue {
  readonly code: FieldAccessIssueCode;
  /** The top-level fields the issue is about, the offending one first. */
  readonly fieldKeys: readonly string[];
  /** The publish-lint line, from `WORKFLOW_LINT_MESSAGES`. */
  readonly message: string;
  /** The nodes the issue is about, in definition order where there are two. */
  readonly nodeIds: readonly string[];
}

/**
 * Why a user task node cannot let its approver fill fields in: a decision
 * shared by several approvers (`PARALLEL_ALL` / `QUORUM`) has no single
 * filler, and a node that can approve or skip itself would pass without
 * anybody filling anything in.
 */
export type UserTaskFillConflict = 'autoApprove' | 'groupPolicy' | 'skipNode';

export function readUserTaskFillConflicts(
  node: UserTaskNode,
): readonly UserTaskFillConflict[] {
  return [
    ...(node.data.decisionPolicy?.type === 'PARALLEL_ALL' ||
    node.data.decisionPolicy?.type === 'QUORUM'
      ? (['groupPolicy'] as const)
      : []),
    ...(node.data.sla?.onTimeout === 'AUTO_APPROVE'
      ? (['autoApprove'] as const)
      : []),
    ...(node.data.excludeInitiator?.whenEmpty === 'SKIP_NODE'
      ? (['skipNode'] as const)
      : []),
  ];
}

const FILL_CONFLICT_ISSUES: Readonly<
  Record<
    UserTaskFillConflict,
    {
      readonly code: FieldAccessIssueCode;
      readonly message: (nodeId: string) => string;
    }
  >
> = {
  autoApprove: {
    code: 'fieldAccessAutoApprove',
    message: WORKFLOW_LINT_MESSAGES.fieldAccessAutoApprove,
  },
  groupPolicy: {
    code: 'fieldAccessGroupPolicy',
    message: WORKFLOW_LINT_MESSAGES.fieldAccessGroupPolicy,
  },
  skipNode: {
    code: 'fieldAccessSkipNode',
    message: WORKFLOW_LINT_MESSAGES.fieldAccessSkipNode,
  },
};

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const FIELD_ACCESS_DISPLAYS: readonly FieldAccessDisplay[] = [
  'SHOW',
  'HIDE',
];

export const FIELD_ACCESS_FILLS: readonly FieldAccessFill[] = [
  'NONE',
  'OPTIONAL',
  'REQUIRED',
];

/**
 * Whether a stored entry is one the publish lint accepts. Stricter than
 * `readNodeFieldAccess`, which the engine reads with: a blank `fieldKey`
 * passes there and fails here, so writers check with this one.
 */
export function isFieldAccessEntryValid(
  entry: unknown,
): entry is FieldAccessEntry {
  return (
    isPlainRecord(entry) &&
    typeof entry['fieldKey'] === 'string' &&
    entry['fieldKey'].trim() !== '' &&
    FIELD_ACCESS_DISPLAYS.some((display) => display === entry['display']) &&
    FIELD_ACCESS_FILLS.some((fill) => fill === entry['fill'])
  );
}

/**
 * One user task node's issues, in publish-lint order: the deprecated
 * `fieldPermissions` key first, then its `fieldAccess`.
 *
 * `fieldPermissions` was reserved and never enforced, so whatever a draft
 * holds there means nothing. Rather than read it as `fieldAccess` (which would
 * suddenly enforce a shape nobody tested) or drop it silently, a draft that
 * still carries the key cannot be published until it is removed.
 *
 * The shape and duplicate checks read the raw `fieldAccess`:
 * `readNodeFieldAccess` tolerates a bad draft by skipping malformed entries
 * and keeping the first entry per `fieldKey`, which is exactly what these two
 * checks have to see. Once the shape is reported, the node's other field
 * access rules are skipped, since they would read a list the engine is not
 * going to honour anyway. Whether each `fieldKey` names a top-level field of
 * the form is checked against the form (`readFormFieldAccessIssues`).
 */
export function readNodeFieldAccessIssues(
  node: UserTaskNode,
): readonly FieldAccessIssue[] {
  const nodeId = node.id;
  const legacy: unknown = node.data.fieldPermissions;
  const legacyIssues: readonly FieldAccessIssue[] =
    legacy === undefined
      ? []
      : [
          {
            code: 'legacyFieldPermissions',
            fieldKeys: [],
            message: WORKFLOW_LINT_MESSAGES.legacyFieldPermissions(nodeId),
            nodeIds: [nodeId],
          },
        ];
  const raw: unknown = node.data.fieldAccess;

  if (raw === undefined) {
    return legacyIssues;
  }

  const entries: readonly unknown[] | undefined = Array.isArray(raw)
    ? raw
    : undefined;

  if (entries === undefined || !entries.every(isFieldAccessEntryValid)) {
    return [
      ...legacyIssues,
      {
        code: 'fieldAccessInvalid',
        fieldKeys: [],
        message: WORKFLOW_LINT_MESSAGES.fieldAccessInvalid(nodeId),
        nodeIds: [nodeId],
      },
    ];
  }

  const fieldKeys = entries.map((entry) => entry.fieldKey);
  const hasFillableField = readNodeFillableFieldKeys(node).size > 0;

  return [
    ...legacyIssues,
    ...fieldKeys
      .filter((fieldKey, index) => fieldKeys.indexOf(fieldKey) !== index)
      .filter(
        (fieldKey, index, repeated) => repeated.indexOf(fieldKey) === index,
      )
      .map((fieldKey): FieldAccessIssue => ({
        code: 'fieldAccessDuplicate',
        fieldKeys: [fieldKey],
        message: WORKFLOW_LINT_MESSAGES.fieldAccessDuplicate(nodeId, fieldKey),
        nodeIds: [nodeId],
      })),
    ...readNodeFieldAccess(node)
      .filter((entry) => entry.fill !== 'NONE' && entry.display === 'HIDE')
      .map((entry): FieldAccessIssue => ({
        code: 'fieldAccessFillHidden',
        fieldKeys: [entry.fieldKey],
        message: WORKFLOW_LINT_MESSAGES.fieldAccessFillHidden(
          nodeId,
          entry.fieldKey,
        ),
        nodeIds: [nodeId],
      })),
    ...(hasFillableField ? readUserTaskFillConflicts(node) : []).map(
      (conflict): FieldAccessIssue => ({
        code: FILL_CONFLICT_ISSUES[conflict].code,
        fieldKeys: [],
        message: FILL_CONFLICT_ISSUES[conflict].message(nodeId),
        nodeIds: [nodeId],
      }),
    ),
  ];
}

/**
 * Whether two nodes can both run in one case: one reaches the other, or a
 * parallel split sends each down a branch of its own (reachable from one
 * outgoing edge of the split but not from another, and the other way round).
 * Nodes on mutually exclusive branches never both run, and neither do two
 * nodes that both lie after the join, which every branch reaches alike. The
 * graph may hold a cycle, which the reachability walk copes with.
 */
export function createWorkflowCoRunReader(
  definition: WorkflowDefinition,
): (nodeId: string, otherNodeId: string) => boolean {
  const reachableCache = new Map<string, ReadonlySet<string>>();
  const readReachable = (nodeId: string): ReadonlySet<string> => {
    const cached = reachableCache.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    const reachable = readReachableWorkflowNodeIds(definition.edges, [nodeId]);

    reachableCache.set(nodeId, reachable);

    return reachable;
  };
  const parallelBranches = readWorkflowParallelBranchSets(
    definition,
    readReachable,
  );

  return (nodeId, otherNodeId) =>
    readReachable(nodeId).has(otherNodeId) ||
    readReachable(otherNodeId).has(nodeId) ||
    parallelBranches.some((branches) =>
      isOnOwnParallelBranch(branches, nodeId, otherNodeId),
    );
}

/**
 * The issues read from the whole definition, in publish-lint order: a system
 * node writing an approver-filled field, then two fill nodes of one field
 * that can both run in one case.
 *
 * A field an approver fills in is empty until then, and the approver's value
 * is the one the case keeps. A system node writing it would either be
 * overwritten or overwrite the approver, so the two are kept apart.
 *
 * One field, one filler per run: when two nodes that fill the same field in
 * can both run in one case (`createWorkflowCoRunReader`), the later one
 * overwrites the earlier and the signed value no longer tells who answered.
 * Fill nodes on mutually exclusive branches (one per region, say) stay
 * allowed. Reported once per field and pair, in node order.
 */
export function readDefinitionFieldAccessIssues(
  definition: WorkflowDefinition,
): readonly FieldAccessIssue[] {
  const approverFilled = readApproverFilledFieldKeys(definition);
  const writeIssues = definition.nodes
    .filter((node) => node.type === 'serviceTask')
    .flatMap((node): readonly FieldAccessIssue[] => {
      const action: unknown = node.data.action;
      const fieldPath = isPlainRecord(action) ? action['fieldPath'] : undefined;
      const fieldKey =
        isPlainRecord(action) &&
        action['type'] === 'SET_FORM_FIELD' &&
        typeof fieldPath === 'string'
          ? readFormFieldPathTopLevelKey(fieldPath)
          : undefined;

      return fieldKey !== undefined && approverFilled.has(fieldKey)
        ? [
            {
              code: 'setFormFieldApproverFilled',
              fieldKeys: [fieldKey],
              message: WORKFLOW_LINT_MESSAGES.setFormFieldApproverFilled(
                node.id,
                fieldKey,
              ),
              nodeIds: [node.id],
            },
          ]
        : [];
    });
  const userTasks = definition.nodes.filter(
    (node): node is UserTaskNode => node.type === 'userTask',
  );
  const canBothRun = createWorkflowCoRunReader(definition);
  const pathIssues = [...approverFilled].flatMap((fieldKey) => {
    const fillNodeIds = [
      ...new Set(
        userTasks
          .filter((node) => readNodeFillableFieldKeys(node).has(fieldKey))
          .map((node) => node.id),
      ),
    ];

    return fillNodeIds.flatMap((nodeId, index) =>
      fillNodeIds
        .slice(index + 1)
        .filter((otherNodeId) => canBothRun(nodeId, otherNodeId))
        .map((otherNodeId): FieldAccessIssue => ({
          code: 'approverFilledMultipleFillNodesOnPath',
          fieldKeys: [fieldKey],
          message: WORKFLOW_LINT_MESSAGES.approverFilledMultipleFillNodesOnPath(
            fieldKey,
            nodeId,
            otherNodeId,
          ),
          nodeIds: [nodeId, otherNodeId],
        })),
    );
  });

  return [...writeIssues, ...pathIssues];
}

/**
 * Why a form field cannot be one an approver fills in, as the issues the
 * publish lint reports once it is: a form-level rule (`required` / `hidden`
 * set to `true`, the others set at all — `required: false` and
 * `hidden: false`, what the form editor writes for "off", are not rules), a
 * data source, a file upload, or a table with a data-source column. Empty
 * when the field can be filled in.
 */
export function readFormFieldFillIssues(
  field: FormFieldDefinition,
): readonly FieldAccessIssue[] {
  const { fieldKey } = field;
  const issue = (
    code: FieldAccessIssueCode,
    message: string,
  ): FieldAccessIssue => ({
    code,
    fieldKeys: [fieldKey],
    message,
    nodeIds: [],
  });

  return [
    ...APPROVER_FILLED_FORM_RULES.filter((rule): boolean =>
      rule === 'required' || rule === 'hidden'
        ? field[rule] === true
        : field[rule] !== undefined,
    ).map((rule) =>
      issue(
        'approverFilledFieldFormRule',
        WORKFLOW_LINT_MESSAGES.approverFilledFieldFormRule(fieldKey, rule),
      ),
    ),
    ...(isFormDataSourceFieldDefinition(field)
      ? [
          issue(
            'approverFilledFieldDataSource',
            WORKFLOW_LINT_MESSAGES.approverFilledFieldDataSource(fieldKey),
          ),
        ]
      : []),
    ...(field.type === 'file_upload'
      ? [
          issue(
            'approverFilledFieldFileUpload',
            WORKFLOW_LINT_MESSAGES.approverFilledFieldFileUpload(fieldKey),
          ),
        ]
      : []),
    ...(isTableFieldDefinition(field) &&
    field.columns.some(isFormDataSourceFieldDefinition)
      ? [
          issue(
            'approverFilledTableDataSourceColumn',
            WORKFLOW_LINT_MESSAGES.approverFilledTableDataSourceColumn(
              fieldKey,
            ),
          ),
        ]
      : []),
  ];
}

/**
 * True when a CEL expression reads the top-level form field `fieldKey` —
 * `form.x`, `formData.x`, `form["x"]`, or any of those with `form . x` spacing
 * or a deeper step after it (`form.x.y`, `form.x[0]`). `has(form.x)` counts.
 *
 * The root has to be a bare `form` / `formData`: `myform.x` and `a.form.x` are
 * somebody else's `x`. The key has to end there: `form.xy` is another field.
 * `form` and `formData` are the two allowed root identifiers that carry the
 * form data (`WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS`). A string literal that
 * merely spells `form.x` counts too: a false hit only makes the publish lint
 * stricter.
 */
export function referencesFormField(
  expression: string,
  fieldKey: string,
): boolean {
  const escapedKey = fieldKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // Not preceded by an identifier character or a dot, so `myform` and
  // `a.form` do not pass for the root.
  const root = '(?<![\\p{L}\\p{N}_.])(?:formData|form)\\s*';

  return [
    new RegExp(`${root}\\.\\s*${escapedKey}(?![\\p{L}\\p{N}_])`, 'u'),
    new RegExp(`${root}\\[\\s*["']${escapedKey}["']\\s*\\]`, 'u'),
  ].some((pattern) => pattern.test(expression));
}

/**
 * The issues read against the form the definition is bound to, in
 * publish-lint order: a `fieldKey` that is not a top-level field of the form,
 * an approver-filled field the form will not let anybody fill in
 * (`readFormFieldFillIssues`, once per field however many nodes fill it in),
 * `fill: 'REQUIRED'` on a boolean (`false` is an answer, so required can never
 * fail), and an applicant's rule that reads an approver-filled field — the
 * rule is evaluated against the submitted form, where that field is still
 * empty, and the evaluation silently compares against nothing.
 */
export function readFormFieldAccessIssues(
  definition: WorkflowDefinition,
  schema: FormDefinitionSchema | null,
): readonly FieldAccessIssue[] {
  const fieldsByKey = new Map(
    (schema?.fields ?? []).map(
      (field): readonly [string, FormFieldDefinition] => [
        field.fieldKey,
        field,
      ],
    ),
  );
  const userTasks = definition.nodes.filter(
    (node): node is UserTaskNode => node.type === 'userTask',
  );
  const unknownFieldIssues = userTasks.flatMap(
    (node): readonly FieldAccessIssue[] =>
      readNodeFieldAccess(node)
        .filter(({ fieldKey }): boolean => !fieldsByKey.has(fieldKey))
        .map(({ fieldKey }) => ({
          code: 'fieldAccessUnknownField',
          fieldKeys: [fieldKey],
          message: WORKFLOW_LINT_MESSAGES.fieldAccessUnknownField(
            node.id,
            fieldKey,
          ),
          nodeIds: [node.id],
        })),
  );
  const requiredBooleanIssues = userTasks.flatMap(
    (node): readonly FieldAccessIssue[] =>
      readNodeFieldAccess(node)
        .filter(
          ({ fieldKey, fill }): boolean =>
            fill === 'REQUIRED' &&
            fieldsByKey.get(fieldKey)?.type === 'boolean',
        )
        .map(({ fieldKey }) => ({
          code: 'approverFilledRequiredBoolean',
          fieldKeys: [fieldKey],
          message: WORKFLOW_LINT_MESSAGES.approverFilledRequiredBoolean(
            node.id,
            fieldKey,
          ),
          nodeIds: [node.id],
        })),
  );
  const approverFilled = readApproverFilledFieldKeys(definition);
  const applicantRuleIssues = (schema?.fields ?? [])
    .filter((field): boolean => !approverFilled.has(field.fieldKey))
    .flatMap((field): readonly FieldAccessIssue[] =>
      APPLICANT_FIELD_CONDITION_RULES.flatMap(
        (rule): readonly FieldAccessIssue[] => {
          const expression: unknown = field[rule];

          return typeof expression === 'string'
            ? [...approverFilled]
                .filter((fieldKey): boolean =>
                  referencesFormField(expression, fieldKey),
                )
                .map((fieldKey) => ({
                  code: 'applicantRuleReadsApproverFilled',
                  fieldKeys: [field.fieldKey, fieldKey],
                  message:
                    WORKFLOW_LINT_MESSAGES.applicantRuleReadsApproverFilled(
                      field.fieldKey,
                      rule,
                      fieldKey,
                    ),
                  nodeIds: [],
                }))
            : [];
        },
      ),
    );
  const fieldIssues = [...approverFilled].flatMap(
    (fieldKey): readonly FieldAccessIssue[] => {
      const field = fieldsByKey.get(fieldKey);

      return field === undefined ? [] : readFormFieldFillIssues(field);
    },
  );

  return [
    ...unknownFieldIssues,
    ...fieldIssues,
    ...requiredBooleanIssues,
    ...applicantRuleIssues,
  ];
}
