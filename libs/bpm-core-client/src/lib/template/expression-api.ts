import type {
  ExpressionLintCode,
  ExpressionLintSeverity,
  ExpressionUsagePoint,
} from '@rytass/bpm-core-shared';
import type {
  WorkflowDefinition,
  WorkflowExpressionDialect,
} from '@rytass/bpm-core-shared/workflow';
import { GraphQlRequestOptions, requestGraphQl } from '../graphql-client';

/**
 * Typed client for the designer's expression tools (Phase 23 P4, ADR 22
 * §3.8). The browser never parses or evaluates an expression: every answer
 * here comes from the backend, which lints with the same engine and function
 * registry as publish. All four operations are designer-only (403 otherwise).
 */

/** One lint finding. `code` is `EXPR_*`; `label` names where it sits. */
export interface ExpressionIssueRecord {
  readonly code: ExpressionLintCode;
  readonly label: string;
  readonly severity: ExpressionLintSeverity;
  readonly subject: string | null;
}

export interface ExpressionEvaluationRecord {
  /** One of the six `EXPRESSION_*` runtime codes when `outcome` is `ERROR`. */
  readonly errorCode: string | null;
  readonly outcome: 'ERROR' | 'OK';
  readonly resultJson: string | null;
  readonly resultType: string | null;
}

export interface ExpressionPreviewRecord {
  readonly evaluation: ExpressionEvaluationRecord | null;
  readonly issues: readonly ExpressionIssueRecord[];
  /** No error-severity finding (warnings allowed). */
  readonly valid: boolean;
}

export type ExpressionPreviewMode = 'EVALUATE' | 'LINT';

export interface PreviewExpressionInput {
  readonly dialect?: WorkflowExpressionDialect | null;
  /** FLOW_CONDITION: the type of the node the edge leaves. */
  readonly edgeSourceNodeType?: string | null;
  readonly expression: string;
  readonly formDefinitionVersionId?: string | null;
  readonly mode: ExpressionPreviewMode;
  /** EVALUATE: sample roots, e.g. `{ form: { amount: 10 } }`. Never stored. */
  readonly sampleContext?: Readonly<Record<string, unknown>> | null;
  /** SERVICE_FORM_FIELD_VALUE: the field the value is written to. */
  readonly targetFieldKey?: string | null;
  readonly usagePoint: ExpressionUsagePoint;
}

export interface ExpressionCatalogFieldRecord {
  readonly fieldKey: string;
  readonly fieldType: string;
  readonly label: string;
  /** What to insert, e.g. `form.amount`. */
  readonly path: string;
  readonly required: boolean;
}

export interface ExpressionCatalogFunctionRecord {
  readonly builtIn: boolean;
  readonly description: string;
  readonly label: string;
  readonly name: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
  }[];
  readonly returnType: string;
}

export interface ExpressionCatalogRecord {
  readonly fields: readonly ExpressionCatalogFieldRecord[];
  readonly functions: readonly ExpressionCatalogFunctionRecord[];
  /** `false` when the host registry could not be read; `functions` is empty then. */
  readonly functionsAvailable: boolean;
  readonly roots: readonly string[];
  readonly usagePoint: string;
}

export interface WorkflowExpressionAnalysisRecord {
  /** Top-level form fields the expression reads. */
  readonly fieldKeys: readonly string[];
  /** Findings in the definition's dialect, warnings included. */
  readonly issues: readonly ExpressionIssueRecord[];
  readonly label: string;
  readonly usagePoint: string;
}

export interface WorkflowExpressionsRecord {
  readonly dialect: string;
  readonly expressions: readonly WorkflowExpressionAnalysisRecord[];
}

export interface WorkflowDialectDifferenceRecord {
  readonly label: string;
  /** `ok:<json>` or `err:<code>`. */
  readonly legacyOutcome: string;
  /** `FILLED` (every field has a value) or `EMPTY` (none has). */
  readonly sample: string;
  readonly usagePoint: string;
  readonly v2Outcome: string;
}

export interface WorkflowDialectUpgradePreviewRecord {
  readonly checkedCount: number;
  /** `false`: the check ran out of time; do not upgrade on it. */
  readonly complete: boolean;
  readonly currentDialect: string;
  readonly differences: readonly WorkflowDialectDifferenceRecord[];
  readonly expressionCount: number;
  /** What the cel-v2 lint would report after the upgrade. */
  readonly v2Issues: readonly ExpressionIssueRecord[];
}

/** The designer's current draft, saved or not. */
export interface WorkflowExpressionsDraft {
  readonly formDefinitionVersionId: string | null;
  readonly initiatorPolicyCel: string | null;
  readonly workflowDefinition: WorkflowDefinition;
}

const ISSUE_FIELDS = `code
        label
        severity
        subject`;

export async function previewExpression(
  input: PreviewExpressionInput,
  options?: GraphQlRequestOptions,
): Promise<ExpressionPreviewRecord> {
  const data = await requestGraphQl<{
    readonly previewExpression: ExpressionPreviewRecord;
  }>(
    `query PreviewExpression($input: BPMPreviewExpressionInput!) {
      previewExpression(input: $input) {
        valid
        issues {
          ${ISSUE_FIELDS}
        }
        evaluation {
          errorCode
          outcome
          resultJson
          resultType
        }
      }
    }`,
    {
      input: {
        dialect: input.dialect ?? null,
        edgeSourceNodeType: input.edgeSourceNodeType ?? null,
        expression: input.expression,
        formDefinitionVersionId: input.formDefinitionVersionId ?? null,
        mode: input.mode,
        sampleContextJson:
          input.mode === 'EVALUATE' && input.sampleContext
            ? JSON.stringify(input.sampleContext)
            : null,
        targetFieldKey: input.targetFieldKey ?? null,
        usagePoint: input.usagePoint,
      },
    },
    options,
  );

  return data.previewExpression;
}

export async function readExpressionCatalog(
  input: Readonly<{
    formDefinitionVersionId?: string | null;
    usagePoint: ExpressionUsagePoint;
  }>,
  options?: GraphQlRequestOptions,
): Promise<ExpressionCatalogRecord> {
  const data = await requestGraphQl<{
    readonly expressionCatalog: ExpressionCatalogRecord;
  }>(
    `query ExpressionCatalog($input: BPMExpressionCatalogInput!) {
      expressionCatalog(input: $input) {
        usagePoint
        roots
        functionsAvailable
        fields {
          fieldKey
          fieldType
          label
          path
          required
        }
        functions {
          builtIn
          description
          label
          name
          returnType
          parameters {
            name
            type
          }
        }
      }
    }`,
    {
      input: {
        formDefinitionVersionId: input.formDefinitionVersionId ?? null,
        usagePoint: input.usagePoint,
      },
    },
    options,
  );

  return data.expressionCatalog;
}

const toDraftInput = (
  draft: WorkflowExpressionsDraft,
): Readonly<Record<string, unknown>> => ({
  formDefinitionVersionId: draft.formDefinitionVersionId,
  initiatorPolicyCel: draft.initiatorPolicyCel,
  workflowDefinitionJson: JSON.stringify(draft.workflowDefinition),
});

export async function analyzeWorkflowExpressions(
  draft: WorkflowExpressionsDraft,
  options?: GraphQlRequestOptions,
): Promise<WorkflowExpressionsRecord> {
  const data = await requestGraphQl<{
    readonly analyzeWorkflowExpressions: WorkflowExpressionsRecord;
  }>(
    `query AnalyzeWorkflowExpressions($input: BPMWorkflowExpressionsInput!) {
      analyzeWorkflowExpressions(input: $input) {
        dialect
        expressions {
          fieldKeys
          label
          usagePoint
          issues {
            ${ISSUE_FIELDS}
          }
        }
      }
    }`,
    { input: toDraftInput(draft) },
    options,
  );

  return data.analyzeWorkflowExpressions;
}

export async function previewWorkflowDialectUpgrade(
  draft: WorkflowExpressionsDraft,
  options?: GraphQlRequestOptions,
): Promise<WorkflowDialectUpgradePreviewRecord> {
  const data = await requestGraphQl<{
    readonly previewWorkflowDialectUpgrade: WorkflowDialectUpgradePreviewRecord;
  }>(
    `query PreviewWorkflowDialectUpgrade($input: BPMWorkflowExpressionsInput!) {
      previewWorkflowDialectUpgrade(input: $input) {
        checkedCount
        complete
        currentDialect
        expressionCount
        differences {
          label
          legacyOutcome
          sample
          usagePoint
          v2Outcome
        }
        v2Issues {
          ${ISSUE_FIELDS}
        }
      }
    }`,
    { input: toDraftInput(draft) },
    options,
  );

  return data.previewWorkflowDialectUpgrade;
}

/**
 * The form fields that expressions of a draft read, each with the labels of
 * the expressions that read it: what blocks renaming or deleting a field
 * (docs/24 §1) and what the field matrix shows.
 */
export function readExpressionFieldReferences(
  analysis: WorkflowExpressionsRecord | null,
): ReadonlyMap<string, readonly string[]> {
  return (analysis?.expressions ?? []).reduce<
    ReadonlyMap<string, readonly string[]>
  >(
    (references, entry) =>
      entry.fieldKeys.reduce<ReadonlyMap<string, readonly string[]>>(
        (current, fieldKey) =>
          new Map([
            ...current,
            [fieldKey, [...(current.get(fieldKey) ?? []), entry.label]],
          ]),
        references,
      ),
    new Map(),
  );
}
