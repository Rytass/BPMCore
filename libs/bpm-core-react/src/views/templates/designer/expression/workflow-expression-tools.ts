import type {
  WorkflowDesignerState,
  WorkflowExpressionFinding,
  WorkflowExpressionRequest,
  WorkflowExpressionTools,
} from '@rytass/bpm-core-shared';
import {
  ExpressionPreviewRecord,
  PreviewExpressionInput,
  previewExpression,
  readExpressionCatalog,
  readExpressionIssueMessage,
} from '@rytass/bpm-core-client/template';

/** The client calls the tools make; injectable for tests. */
export interface WorkflowExpressionToolsApi {
  readonly preview: (
    input: PreviewExpressionInput,
  ) => Promise<ExpressionPreviewRecord>;
  readonly readCatalog: typeof readExpressionCatalog;
}

const DEFAULT_API: WorkflowExpressionToolsApi = {
  preview: (input): Promise<ExpressionPreviewRecord> => previewExpression(input),
  readCatalog: readExpressionCatalog,
};

const toPreviewInput = (
  state: WorkflowDesignerState,
  request: WorkflowExpressionRequest,
): Omit<PreviewExpressionInput, 'mode'> => ({
  dialect: request.dialect,
  edgeSourceNodeType: request.edgeSourceNodeType,
  expression: request.expression,
  formDefinitionVersionId: state.formDefinitionVersionId,
  targetFieldKey: request.targetFieldKey,
  usagePoint: request.usagePoint,
});

/**
 * The assistant's expression tools (Phase 23 P4, ADR 22 §3.8), backed by the
 * designer-only GraphQL operations. Every answer comes from the backend; the
 * browser neither parses nor evaluates CEL. Findings are written as designer
 * sentences so the model can relay them to the user.
 */
export function createWorkflowExpressionTools(
  state: WorkflowDesignerState,
  api: WorkflowExpressionToolsApi = DEFAULT_API,
): WorkflowExpressionTools {
  return {
    catalog: (usagePoint): Promise<unknown> =>
      api.readCatalog({
        formDefinitionVersionId: state.formDefinitionVersionId,
        usagePoint,
      }),
    evaluate: async (request, sample): Promise<unknown> => {
      const preview = await api.preview({
        ...toPreviewInput(state, request),
        mode: 'EVALUATE',
        sampleContext: sample,
      });

      return preview.evaluation;
    },
    lint: async (request): Promise<readonly WorkflowExpressionFinding[]> => {
      const preview = await api.preview({
        ...toPreviewInput(state, request),
        mode: 'LINT',
      });

      return preview.issues.map(
        (issue): WorkflowExpressionFinding => ({
          code: issue.code,
          message: readExpressionIssueMessage(issue, state.definition),
          severity: issue.severity,
        }),
      );
    },
  };
}
