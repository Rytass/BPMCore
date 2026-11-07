import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * GraphQL shapes of the designer's expression tools (Phase 23 P4, ADR 22
 * §3.8): `previewExpression`, `expressionCatalog`, `analyzeWorkflowExpressions`
 * and `previewWorkflowDialectUpgrade`. Every one is designer-only and reads
 * only what the caller sends plus the bound form version; nothing here reads
 * a case. Issues carry codes, never engine or host text (ADR 22 §3.2).
 */

/** The expression length the runtime and the lint accept (docs/24 §2.7). */
export const MAX_PREVIEW_EXPRESSION_LENGTH = 2_000;
/** A sample context is a handful of roots, not a case (form-data-source precedent). */
export const MAX_PREVIEW_SAMPLE_CONTEXT_JSON_LENGTH = 8_192;
/** The same ceiling the dry run puts on a definition it is sent. */
export const MAX_DESIGNER_WORKFLOW_DEFINITION_JSON_LENGTH = 1_048_576;
const MAX_IDENTIFIER_LENGTH = 128;

export const EXPRESSION_PREVIEW_MODES = ['EVALUATE', 'LINT'] as const;
export type ExpressionPreviewMode = (typeof EXPRESSION_PREVIEW_MODES)[number];

@InputType('BPMPreviewExpressionInput')
export class PreviewExpressionInput {
  @Field()
  @IsString()
  @MaxLength(MAX_PREVIEW_EXPRESSION_LENGTH)
  expression!: string;

  /** One of the nine use points; anything else is linted as allowing no root. */
  @Field()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  usagePoint!: string;

  @Field(() => String, {
    description: 'LINT (no evaluation) or EVALUATE (lint, then evaluate the sample).',
  })
  @IsIn(EXPRESSION_PREVIEW_MODES)
  mode!: ExpressionPreviewMode;

  @Field(() => String, {
    description: 'cel-legacy (default) or cel-v2: the dialect of the definition or rule the expression belongs to.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  dialect?: string | null;

  @Field(() => ID, {
    description: 'The form version whose fields and types the lint checks against.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId?: string | null;

  @Field(() => String, {
    description: 'SERVICE_FORM_FIELD_VALUE only: the field the value is written to.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  targetFieldKey?: string | null;

  @Field(() => String, {
    description: 'FLOW_CONDITION only: the type of the node the edge leaves.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  edgeSourceNodeType?: string | null;

  @Field(() => String, {
    description: 'EVALUATE only: a JSON object of sample roots. Never stored.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PREVIEW_SAMPLE_CONTEXT_JSON_LENGTH)
  sampleContextJson?: string | null;
}

@InputType('BPMExpressionCatalogInput')
export class ExpressionCatalogInput {
  @Field()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  usagePoint!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId?: string | null;
}

/**
 * The designer's current, possibly unsaved, draft. Analysed read-only; the
 * saved version is what publish lints.
 */
@InputType('BPMWorkflowExpressionsInput')
export class WorkflowExpressionsInput {
  @Field()
  @IsString()
  @MaxLength(MAX_DESIGNER_WORKFLOW_DEFINITION_JSON_LENGTH)
  workflowDefinitionJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PREVIEW_EXPRESSION_LENGTH)
  initiatorPolicyCel?: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId?: string | null;
}

@ObjectType('BPMExpressionIssue')
export class ExpressionIssueObject {
  @Field({ description: 'An EXPR_* lint code (docs/24 §2.2).' })
  code!: string;

  @Field({ description: 'Where the expression sits, as the publish lint names it.' })
  label!: string;

  @Field({ description: 'ERROR refuses a publish; WARNING does not.' })
  severity!: string;

  @Field(() => String, {
    description: 'The field, root or function the issue names: an identifier from the expression, or null.',
    nullable: true,
  })
  subject!: string | null;
}

@ObjectType('BPMExpressionEvaluation')
export class ExpressionEvaluationObject {
  @Field({ description: 'OK or ERROR.' })
  outcome!: string;

  @Field(() => String, { nullable: true })
  resultJson!: string | null;

  @Field(() => String, {
    description: 'null, bool, number, string, list or map.',
    nullable: true,
  })
  resultType!: string | null;

  @Field(() => String, {
    description: 'One of the six EXPRESSION_* runtime codes when outcome is ERROR.',
    nullable: true,
  })
  errorCode!: string | null;
}

@ObjectType('BPMExpressionPreview')
export class ExpressionPreviewObject {
  @Field({ description: 'No ERROR issue (warnings allowed).' })
  valid!: boolean;

  @Field(() => [ExpressionIssueObject])
  issues!: readonly ExpressionIssueObject[];

  @Field(() => ExpressionEvaluationObject, {
    description: 'EVALUATE only, and only when the lint has no error.',
    nullable: true,
  })
  evaluation!: ExpressionEvaluationObject | null;
}

@ObjectType('BPMExpressionCatalogField')
export class ExpressionCatalogFieldObject {
  @Field({ description: 'The path to write, e.g. form.amount.' })
  path!: string;

  @Field()
  fieldKey!: string;

  @Field({ description: 'The form field type (text, number, …).' })
  fieldType!: string;

  @Field()
  label!: string;

  @Field()
  required!: boolean;
}

@ObjectType('BPMExpressionCatalogFunctionParameter')
export class ExpressionCatalogFunctionParameterObject {
  @Field()
  name!: string;

  @Field()
  type!: string;
}

@ObjectType('BPMExpressionCatalogFunction')
export class ExpressionCatalogFunctionObject {
  @Field()
  builtIn!: boolean;

  @Field()
  description!: string;

  @Field()
  label!: string;

  @Field()
  name!: string;

  @Field(() => [ExpressionCatalogFunctionParameterObject])
  parameters!: readonly ExpressionCatalogFunctionParameterObject[];

  @Field()
  returnType!: string;
}

@ObjectType('BPMExpressionCatalog')
export class ExpressionCatalogObject {
  @Field()
  usagePoint!: string;

  @Field(() => [String], { description: 'The roots this use point may read.' })
  roots!: readonly string[];

  @Field(() => [ExpressionCatalogFieldObject])
  fields!: readonly ExpressionCatalogFieldObject[];

  @Field(() => [ExpressionCatalogFunctionObject])
  functions!: readonly ExpressionCatalogFunctionObject[];

  @Field({
    description: 'false when the host function registry could not be read; functions then lists nothing.',
  })
  functionsAvailable!: boolean;
}

@ObjectType('BPMWorkflowExpressionAnalysis')
export class WorkflowExpressionAnalysisObject {
  @Field()
  label!: string;

  @Field()
  usagePoint!: string;

  @Field(() => [String], {
    description: 'Top-level form fields the expression reads.',
  })
  fieldKeys!: readonly string[];

  @Field(() => [ExpressionIssueObject], {
    description: 'Lint findings, warnings included, in the definition dialect.',
  })
  issues!: readonly ExpressionIssueObject[];
}

@ObjectType('BPMWorkflowExpressions')
export class WorkflowExpressionsObject {
  @Field()
  dialect!: string;

  @Field(() => [WorkflowExpressionAnalysisObject])
  expressions!: readonly WorkflowExpressionAnalysisObject[];
}

@ObjectType('BPMWorkflowDialectDifference')
export class WorkflowDialectDifferenceObject {
  @Field()
  label!: string;

  @Field()
  usagePoint!: string;

  @Field({ description: 'Which sample showed it: FILLED or EMPTY.' })
  sample!: string;

  @Field({ description: 'ok:<json> or err:<code> under cel-legacy.' })
  legacyOutcome!: string;

  @Field({ description: 'ok:<json> or err:<code> under cel-v2.' })
  v2Outcome!: string;
}

@ObjectType('BPMWorkflowDialectUpgradePreview')
export class WorkflowDialectUpgradePreviewObject {
  @Field({ description: 'The dialect the draft is in now.' })
  currentDialect!: string;

  @Field({
    description: 'false when the check ran out of time before every expression was compared; do not upgrade then.',
  })
  complete!: boolean;

  @Field(() => Int)
  checkedCount!: number;

  @Field(() => Int)
  expressionCount!: number;

  @Field(() => [WorkflowDialectDifferenceObject])
  differences!: readonly WorkflowDialectDifferenceObject[];

  @Field(() => [ExpressionIssueObject], {
    description: 'What the cel-v2 lint would report once upgraded, warnings included.',
  })
  v2Issues!: readonly ExpressionIssueObject[];
}
