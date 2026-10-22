import {
  FieldAccessIssue,
  readDefinitionFieldAccessIssues,
  readFormFieldAccessIssues,
  readFormFieldFillIssues,
  readNodeFieldAccessIssues,
  readReachableWorkflowNodeIds,
  readUserTaskFillConflicts,
  UserTaskFillConflict,
} from './field-access-lint';
import { readNodeFieldAccess, readNodeFillableFieldKeys } from './field-access';
import type { FormDefinitionSchema, FormFieldDefinition } from './form';
import type {
  FieldAccessEntry,
  FieldAccessFill,
  UserTaskNode,
  WorkflowDefinition,
} from './workflow';

/**
 * What a cell of the field access matrix offers. `DEFAULT` writes nothing for
 * the node, so the field falls back to the derived value; the other four each
 * stand for one `FieldAccessEntry` (`fill` other than `NONE` is always shown,
 * since a hidden fill cannot be published).
 */
export type FieldAccessChoice =
  'DEFAULT' | 'FILL_OPTIONAL' | 'FILL_REQUIRED' | 'HIDE' | 'SHOW';

export const FIELD_ACCESS_CHOICES: readonly FieldAccessChoice[] = [
  'DEFAULT',
  'SHOW',
  'HIDE',
  'FILL_OPTIONAL',
  'FILL_REQUIRED',
];

/**
 * What a viewer at one place in the flow gets for a field. `FILL` is the
 * applicant's own field; `NOT_SHOWN` is an approver-filled field nobody has
 * filled in yet, which BPM leaves off the screen; `HIDDEN` is a node that
 * chose to hide the field (display only, never a permission).
 */
export type FieldAccessEffective =
  | 'FILL'
  | 'FILL_OPTIONAL'
  | 'FILL_REQUIRED'
  | 'HIDDEN'
  | 'NOT_SHOWN'
  | 'READ_ONLY';

/**
 * Why a cell reads the way it does: the node lists the field (`EXPLICIT`), an
 * ordinary field every node sees read-only (`APPLICANT_FIELD`), an
 * approver-filled field a fill node before this one has filled in
 * (`FILLED_EARLIER`), or one no such node has yet (`NOT_YET_FILLED`).
 */
export type FieldAccessCellReason =
  'APPLICANT_FIELD' | 'EXPLICIT' | 'FILLED_EARLIER' | 'NOT_YET_FILLED';

/** A hint the matrix shows that does not block publishing. */
export interface FieldAccessNotice {
  readonly code: 'shownBeforeFilled';
  readonly fieldKey: string;
  readonly nodeId: string;
}

export interface FieldAccessMatrixColumn {
  /**
   * The label of the edge from an exclusive gateway straight into the node,
   * so nodes on mutually exclusive branches can say which branch they are on.
   */
  readonly branchLabel: string | null;
  /** Why the node cannot let its approver fill fields in. */
  readonly fillConflicts: readonly UserTaskFillConflict[];
  /** Node-level issues: the legacy key, an invalid list, fill conflicts. */
  readonly issues: readonly FieldAccessIssue[];
  readonly label: string;
  readonly nodeId: string;
  /** 1-based position among the user tasks, in flow order (關卡 N). */
  readonly stage: number;
}

export interface FieldAccessMatrixCell {
  readonly choice: FieldAccessChoice;
  /** The fill choices this cell cannot take, for the node or the field. */
  readonly disabledChoices: readonly FieldAccessChoice[];
  readonly effective: FieldAccessEffective;
  readonly explicit: FieldAccessEntry | null;
  readonly nodeId: string;
  readonly reason: FieldAccessCellReason;
}

export interface FieldAccessMatrixRow {
  readonly applicant: {
    readonly effective: Extract<FieldAccessEffective, 'FILL' | 'NOT_SHOWN'>;
  };
  /** One per column, in column order. */
  readonly cells: readonly FieldAccessMatrixCell[];
  readonly field: FormFieldDefinition;
  readonly fieldKey: string;
  /** Why the form will not let an approver fill this field in. */
  readonly fillBlockers: readonly FieldAccessIssue[];
  /** The user tasks that fill this field in, in column order. */
  readonly fillNodeIds: readonly string[];
  /** Publish-blocking issues that name this field. */
  readonly issues: readonly FieldAccessIssue[];
  readonly notices: readonly FieldAccessNotice[];
}

export interface FieldAccessMatrix {
  readonly columns: readonly FieldAccessMatrixColumn[];
  /**
   * Every publish-blocking field access issue of the definition, the same set
   * the publish lint reports apart from its early-read rule, in lint order.
   */
  readonly issues: readonly FieldAccessIssue[];
  readonly rows: readonly FieldAccessMatrixRow[];
}

const FILL_CHOICES: readonly FieldAccessChoice[] = [
  'FILL_OPTIONAL',
  'FILL_REQUIRED',
];

export function readFieldAccessChoice(
  entry: FieldAccessEntry | null,
): FieldAccessChoice {
  if (entry === null) {
    return 'DEFAULT';
  }

  if (entry.fill === 'REQUIRED') {
    return 'FILL_REQUIRED';
  }

  if (entry.fill === 'OPTIONAL') {
    return 'FILL_OPTIONAL';
  }

  return entry.display === 'HIDE' ? 'HIDE' : 'SHOW';
}

const CHOICE_FILLS: Readonly<
  Record<Exclude<FieldAccessChoice, 'DEFAULT'>, FieldAccessFill>
> = {
  FILL_OPTIONAL: 'OPTIONAL',
  FILL_REQUIRED: 'REQUIRED',
  HIDE: 'NONE',
  SHOW: 'NONE',
};

/** The entry a choice writes for the field, or `null` for `DEFAULT`. */
export function readFieldAccessEntryForChoice(
  fieldKey: string,
  choice: FieldAccessChoice,
): FieldAccessEntry | null {
  return choice === 'DEFAULT'
    ? null
    : {
        display: choice === 'HIDE' ? 'HIDE' : 'SHOW',
        fieldKey,
        fill: CHOICE_FILLS[choice],
      };
}

/**
 * The user tasks in flow order: a topological walk from the nodes nothing
 * leads into, ties broken by definition order. A cycle (a loop back for
 * rework) has no topological order, so the walk then takes the earliest
 * remaining node, in definition order, that a placed node leads into —
 * entering the loop where the flow does — and carries on.
 */
function readFlowOrderedUserTasks(
  definition: WorkflowDefinition,
): readonly UserTaskNode[] {
  const nodeIds = definition.nodes.map((node) => node.id);
  const known = new Set(nodeIds);
  const edges = definition.edges.filter(
    (edge) =>
      known.has(edge.source) &&
      known.has(edge.target) &&
      edge.source !== edge.target,
  );
  const walk = (
    remaining: readonly string[],
    ordered: readonly string[],
  ): readonly string[] => {
    if (remaining.length === 0) {
      return ordered;
    }

    const left = new Set(remaining);
    const placed = new Set(ordered);
    const next =
      remaining.find(
        (nodeId) =>
          !edges.some(
            (edge) => edge.target === nodeId && left.has(edge.source),
          ),
      ) ??
      remaining.find((nodeId) =>
        edges.some((edge) => edge.target === nodeId && placed.has(edge.source)),
      ) ??
      remaining[0];

    return walk(
      remaining.filter((nodeId) => nodeId !== next),
      [...ordered, next],
    );
  };
  const order = walk([...new Set(nodeIds)], []);
  const userTasks = definition.nodes.filter(
    (node): node is UserTaskNode => node.type === 'userTask',
  );
  const firstById = new Map(
    [...userTasks]
      .reverse()
      .map((node): [string, UserTaskNode] => [node.id, node]),
  );

  return order.flatMap((nodeId) => {
    const node = firstById.get(nodeId);

    return node === undefined ? [] : [node];
  });
}

function readBranchLabel(
  definition: WorkflowDefinition,
  nodeId: string,
): string | null {
  const gatewayIds = new Set(
    definition.nodes
      .filter((node) => node.type === 'exclusiveGateway')
      .map((node) => node.id),
  );
  const label = definition.edges
    .filter((edge) => edge.target === nodeId && gatewayIds.has(edge.source))
    .map((edge) => edge.data?.label?.trim() ?? '')
    .find((value) => value !== '');

  return label ?? null;
}

function readExplicitEffective(entry: FieldAccessEntry): FieldAccessEffective {
  if (entry.fill === 'REQUIRED') {
    return 'FILL_REQUIRED';
  }

  if (entry.fill === 'OPTIONAL') {
    return 'FILL_OPTIONAL';
  }

  return entry.display === 'HIDE' ? 'HIDDEN' : 'READ_ONLY';
}

/**
 * The designer's field access matrix: one row per top-level form field, one
 * column per user task in flow order, and in each cell the node's explicit
 * entry or, without one, what the engine's `resolveFieldAccess` would give a
 * viewer at that node.
 *
 * The engine reveals an approver-filled field once a fill node has produced a
 * task in the case; at design time that reads as "a fill node earlier in the
 * column order reaches this one". A fill node on another branch, or one only
 * reached by looping back, does not count, so the cell shows the more
 * cautious `NOT_SHOWN`.
 *
 * The issues come from the same `field-access-lint` rules the publish lint
 * runs, so the matrix and publishing never disagree; only the early-read rule
 * (`approverFilledFieldReadEarly`), which reads every node's expressions, is
 * left to publishing.
 */
export function readFieldAccessMatrix(
  definition: WorkflowDefinition,
  schema: FormDefinitionSchema | null,
): FieldAccessMatrix {
  const userTasks = readFlowOrderedUserTasks(definition);
  const issues: readonly FieldAccessIssue[] = [
    ...definition.nodes
      .filter((node): node is UserTaskNode => node.type === 'userTask')
      .flatMap((node) => readNodeFieldAccessIssues(node)),
    ...readDefinitionFieldAccessIssues(definition),
    ...readFormFieldAccessIssues(definition, schema),
  ];
  const columns = userTasks.map((node, index): FieldAccessMatrixColumn => ({
    branchLabel: readBranchLabel(definition, node.id),
    fillConflicts: readUserTaskFillConflicts(node),
    issues: readNodeFieldAccessIssues(node).filter(
      (issue) => issue.fieldKeys.length === 0,
    ),
    label: node.data.label,
    nodeId: node.id,
    stage: index + 1,
  }));
  const reachable = new Map(
    userTasks.map((node): [string, ReadonlySet<string>] => [
      node.id,
      readReachableWorkflowNodeIds(definition.edges, [node.id]),
    ]),
  );
  const accessByNode = new Map(
    userTasks.map((node): [string, ReadonlyMap<string, FieldAccessEntry>] => [
      node.id,
      new Map(
        readNodeFieldAccess(node).map((entry): [string, FieldAccessEntry] => [
          entry.fieldKey,
          entry,
        ]),
      ),
    ]),
  );
  const indexById = new Map(
    userTasks.map((node, index): [string, number] => [node.id, index]),
  );
  const isFilledBefore = (
    fillNodeIds: readonly string[],
    nodeIndex: number,
  ): boolean =>
    fillNodeIds.some((fillNodeId) => {
      const fillIndex = indexById.get(fillNodeId) ?? -1;

      return (
        fillIndex < nodeIndex &&
        (reachable.get(fillNodeId)?.has(userTasks[nodeIndex].id) ?? false)
      );
    });

  const rows = (schema?.fields ?? []).map((field): FieldAccessMatrixRow => {
    const { fieldKey } = field;
    const fillNodeIds = userTasks
      .filter((node) => readNodeFillableFieldKeys(node).has(fieldKey))
      .map((node) => node.id);
    const isApproverFilled = fillNodeIds.length > 0;
    const fillBlockers = readFormFieldFillIssues(field);
    const fieldDisabledChoices: readonly FieldAccessChoice[] =
      fillBlockers.length > 0
        ? FILL_CHOICES
        : field.type === 'boolean'
          ? ['FILL_REQUIRED']
          : [];
    const cells = userTasks.map((node, index): FieldAccessMatrixCell => {
      const explicit = accessByNode.get(node.id)?.get(fieldKey) ?? null;
      const filledBefore = isFilledBefore(fillNodeIds, index);
      const reason: FieldAccessCellReason =
        explicit !== null
          ? 'EXPLICIT'
          : !isApproverFilled
            ? 'APPLICANT_FIELD'
            : filledBefore
              ? 'FILLED_EARLIER'
              : 'NOT_YET_FILLED';

      return {
        choice: readFieldAccessChoice(explicit),
        disabledChoices:
          columns[index].fillConflicts.length > 0
            ? FILL_CHOICES
            : fieldDisabledChoices,
        effective:
          explicit !== null
            ? readExplicitEffective(explicit)
            : reason === 'NOT_YET_FILLED'
              ? 'NOT_SHOWN'
              : 'READ_ONLY',
        explicit,
        nodeId: node.id,
        reason,
      };
    });

    return {
      applicant: { effective: isApproverFilled ? 'NOT_SHOWN' : 'FILL' },
      cells,
      field,
      fieldKey,
      fillBlockers,
      fillNodeIds,
      issues: issues.filter((issue) => issue.fieldKeys.includes(fieldKey)),
      notices: cells
        .filter(
          (cell, index) =>
            isApproverFilled &&
            cell.effective === 'READ_ONLY' &&
            cell.reason === 'EXPLICIT' &&
            !isFilledBefore(fillNodeIds, index),
        )
        .map((cell): FieldAccessNotice => ({
          code: 'shownBeforeFilled',
          fieldKey,
          nodeId: cell.nodeId,
        })),
    };
  });

  return { columns, issues, rows };
}
