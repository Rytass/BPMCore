import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';

/**
 * Pure designer edits for the free-text expressions the command layer has no
 * primitive for (Phase 23 P4): a node's entry condition and an edge's
 * hand-written CEL condition. The designer applies them through
 * `controller.replaceState`; the assistant cannot reach them (its toolset
 * offers `set_edge_condition`, the structured builder, instead).
 */

/** Nodes that may carry `entryCondition`. */
export function hasWorkflowEntryCondition(
  node: WorkflowNode,
): node is Extract<WorkflowNode, { type: 'serviceTask' | 'userTask' }> {
  return node.type === 'userTask' || node.type === 'serviceTask';
}

/** Sets (or, for blank text, removes) a node's entry condition. */
export function setWorkflowNodeEntryCondition(
  definition: WorkflowDefinition,
  nodeId: string,
  condition: string,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node): WorkflowNode => {
      if (node.id !== nodeId || !hasWorkflowEntryCondition(node)) {
        return node;
      }

      const rest = Object.fromEntries(
        Object.entries(node.data).filter(([key]) => key !== 'entryCondition'),
      );

      return {
        ...node,
        data: condition.trim() ? { ...rest, entryCondition: condition } : rest,
      } as WorkflowNode;
    }),
  };
}

/**
 * An edge whose condition was written by hand rather than by the structured
 * builder (field + operator + value).
 */
export function isWorkflowEdgeExpressionCondition(edge: WorkflowEdge): boolean {
  return Boolean(edge.data.condition?.trim()) && !edge.data.conditionFieldKey;
}

/**
 * Writes a hand-written condition on an edge, dropping the builder's
 * field / operator / value and the default flag (a conditional edge is not
 * the else path).
 */
export function setWorkflowEdgeExpressionCondition(
  definition: WorkflowDefinition,
  edgeId: string,
  condition: string,
): WorkflowDefinition {
  return {
    ...definition,
    edges: definition.edges.map((edge): WorkflowEdge => {
      if (edge.id !== edgeId) {
        return edge;
      }

      // The builder's field / operator / value and the default flag go;
      // nothing else lives on edge data.
      return {
        ...edge,
        data: { condition, isDefault: false, label: '自訂條件' },
      };
    }),
  };
}

/** The type of the node an edge leaves, for the `lastDecision` check. */
export function readWorkflowEdgeSourceNodeType(
  definition: WorkflowDefinition,
  edgeId: string,
): string | null {
  const edge = definition.edges.find((candidate) => candidate.id === edgeId);

  return (
    definition.nodes.find((node) => node.id === edge?.source)?.type ?? null
  );
}

/**
 * Fields a form edit would rename or delete while expressions still read
 * them (docs/24 §1): keys present before the edit, missing after it, and
 * referenced. Each comes with the labels of the expressions reading it.
 */
export function readRemovedExpressionFields(
  beforeFieldKeys: readonly string[],
  afterFieldKeys: readonly string[],
  references: ReadonlyMap<string, readonly string[]>,
): readonly { readonly fieldKey: string; readonly labels: readonly string[] }[] {
  const after = new Set(afterFieldKeys);

  return beforeFieldKeys
    .filter((fieldKey) => !after.has(fieldKey))
    .map((fieldKey) => ({ fieldKey, labels: references.get(fieldKey) ?? [] }))
    .filter((entry) => entry.labels.length > 0);
}

export type FormEditExpressionCheck =
  | { readonly kind: 'allowed' }
  | {
      readonly kind: 'blocked';
      readonly fields: readonly {
        readonly fieldKey: string;
        readonly labels: readonly string[];
      }[];
    }
  | { readonly kind: 'unverified'; readonly fieldKeys: readonly string[] };

/**
 * Whether a form edit may be applied (docs/24 §1: renaming or deleting a
 * field an expression reads is refused). An edit that removes no field needs
 * no answer from the backend. One that does is checked against the references
 * of the draft as it is now; when those cannot be had (analysis not run yet,
 * request failed, 403) the edit is refused as `unverified` rather than let
 * through — cel-legacy's publish lint does not check field existence, so this
 * is the only guard such a template has.
 */
export async function checkFormEditExpressionFields(
  beforeFieldKeys: readonly string[],
  afterFieldKeys: readonly string[],
  resolveReferences: () => Promise<ReadonlyMap<
    string,
    readonly string[]
  > | null>,
): Promise<FormEditExpressionCheck> {
  const after = new Set(afterFieldKeys);
  const removed = beforeFieldKeys.filter((fieldKey) => !after.has(fieldKey));

  if (removed.length === 0) {
    return { kind: 'allowed' };
  }

  const references = await resolveReferences();

  if (references === null) {
    return { kind: 'unverified', fieldKeys: removed };
  }

  const fields = readRemovedExpressionFields(
    beforeFieldKeys,
    afterFieldKeys,
    references,
  );

  return fields.length > 0 ? { kind: 'blocked', fields } : { kind: 'allowed' };
}
