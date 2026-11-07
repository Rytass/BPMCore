import { Args, Query, Resolver } from '@nestjs/graphql';
import { BPMDesignerOnly } from '../bpm-auth';
import {
  ExpressionCatalogInput,
  ExpressionCatalogObject,
  ExpressionPreviewObject,
  PreviewExpressionInput,
  WorkflowDialectUpgradePreviewObject,
  WorkflowExpressionsInput,
  WorkflowExpressionsObject,
} from './dto/expression-designer.dto';
import { ExpressionDesignerService } from './expression-designer.service';

/**
 * The designer's expression reads (ADR 22 §3.8). Designer-only: a member
 * without the designer permission gets 403 from the guard, before anything is
 * parsed. None of them writes; the draft is saved through
 * `updateApprovalTemplateDraft` as before.
 */
@Resolver()
@BPMDesignerOnly()
export class ExpressionDesignerQueries {
  constructor(
    private readonly expressionDesignerService: ExpressionDesignerService,
  ) {}

  @Query(() => ExpressionPreviewObject)
  previewExpression(
    @Args('input') input: PreviewExpressionInput,
  ): Promise<ExpressionPreviewObject> {
    return this.expressionDesignerService.previewExpression(input);
  }

  @Query(() => ExpressionCatalogObject)
  expressionCatalog(
    @Args('input') input: ExpressionCatalogInput,
  ): Promise<ExpressionCatalogObject> {
    return this.expressionDesignerService.expressionCatalog(input);
  }

  @Query(() => WorkflowExpressionsObject)
  analyzeWorkflowExpressions(
    @Args('input') input: WorkflowExpressionsInput,
  ): Promise<WorkflowExpressionsObject> {
    return this.expressionDesignerService.analyzeWorkflowExpressions(input);
  }

  @Query(() => WorkflowDialectUpgradePreviewObject)
  previewWorkflowDialectUpgrade(
    @Args('input') input: WorkflowExpressionsInput,
  ): Promise<WorkflowDialectUpgradePreviewObject> {
    return this.expressionDesignerService.previewWorkflowDialectUpgrade(input);
  }
}
