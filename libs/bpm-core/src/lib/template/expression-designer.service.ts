import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  allowsHostExpressionFunctions,
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT,
  ExpressionLintIssue,
  ExpressionUsagePoint,
  isExpressionUsagePoint,
  readExpressionLintSeverity,
} from '@rytass/bpm-core-shared';
import type {
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  hasWorkflowLastDecision,
  WORKFLOW_EXPRESSION_LABELS,
} from '@rytass/bpm-core-shared/workflow-graph';
import { Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import {
  DEFAULT_EXPRESSION_DIALECT,
  ExpressionDialect,
  isExpressionDialect,
} from '../condition/expression-dialect';
import { ExpressionRuntimeError } from '../condition/expression-errors';
import { createExpressionBudget } from '../condition/expression-budget';
import {
  ExpressionDifferentialResult,
  runExpressionDifferential,
} from '../condition/expression-differential';
import { readExpressionReferences } from '../condition/expression-ast';
import { readExpressionFunctionTable } from '../condition/expression-function-invocation';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from '../expression-function/expression-function.registry';
import {
  BPM_EXPRESSION_FUNCTION_REGISTRY,
  type BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import {
  ExpressionCatalogFieldObject,
  ExpressionCatalogFunctionObject,
  ExpressionCatalogInput,
  ExpressionCatalogObject,
  ExpressionEvaluationObject,
  ExpressionIssueObject,
  ExpressionPreviewObject,
  MAX_PREVIEW_SAMPLE_CONTEXT_JSON_LENGTH,
  PreviewExpressionInput,
  WorkflowDialectDifferenceObject,
  WorkflowDialectUpgradePreviewObject,
  WorkflowExpressionAnalysisObject,
  WorkflowExpressionsInput,
  WorkflowExpressionsObject,
} from './dto/expression-designer.dto';
import {
  readUsagePointExpressions,
  UsagePointExpression,
} from './template.service';

/** The label preview findings carry: the caller knows where the field sits. */
export const EXPRESSION_PREVIEW_LABEL = 'expression';

/**
 * Wall-clock ceiling for one dialect upgrade check, the same as a whole dry
 * run (docs/24 §2.7). Each comparison is still bounded by the single
 * evaluation budget; past the ceiling the rest are not compared and the
 * result says so (`complete: false`).
 */
export const DIALECT_UPGRADE_CHECK_TIME_LIMIT_MS = 2_000;

/** More expressions than any real definition holds; refused, not truncated. */
export const MAX_DESIGNER_EXPRESSIONS = 500;

const BUILT_IN_NAMES: ReadonlySet<string> = new Set(
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
);

const SAMPLE_NOW = '2026-01-01T00:00:00.000Z';

const SAMPLE_MEMBER: Readonly<Record<string, unknown>> = {
  memberId: 'member-sample',
  orgUnitIds: ['org-unit-sample'],
  positionIds: ['position-sample'],
  roles: ['member'],
};

/** A sample decision, for edges that leave an approval node. */
const SAMPLE_DECISION: Readonly<Record<string, unknown>> = {
  action: 'APPROVE',
  comment: null,
  decidedAt: SAMPLE_NOW,
  decidedByMemberId: 'member-sample',
  returnToNodeId: null,
  taskId: 'task-sample',
  transferToMemberId: null,
};

type DialectUpgradeSample = 'EMPTY' | 'FILLED';

/**
 * The designer's expression tools (Phase 23 P4, ADR 22 §3.8). The browser
 * never parses or evaluates an expression (ADR 22 §3.1): it asks this
 * service, which lints with the same `ConditionService` (and so the same
 * function registry) the publish lint and the engine use.
 */
@Injectable()
export class ExpressionDesignerService {
  private readonly logger = new Logger(ExpressionDesignerService.name);
  private readonly functionRegistry: BPMExpressionFunctionRegistry;

  constructor(
    @InjectRepository(FormDefinitionVersionEntity)
    private readonly formDefinitionVersionRepository: Repository<FormDefinitionVersionEntity>,
    private readonly conditionService: ConditionService,
    @Optional()
    @Inject(BPM_EXPRESSION_FUNCTION_REGISTRY)
    functionRegistry?: BPMExpressionFunctionRegistry | null,
  ) {
    this.functionRegistry =
      functionRegistry ?? BUILT_IN_EXPRESSION_FUNCTION_REGISTRY;
  }

  /**
   * Lints one expression and, in EVALUATE mode, evaluates it against the
   * sample the caller sent (never a real case). Findings and the runtime
   * error are codes only.
   */
  async previewExpression(
    input: PreviewExpressionInput,
  ): Promise<ExpressionPreviewObject> {
    const dialect = readRequestDialect(input.dialect);
    const usagePoint = input.usagePoint;
    const formSchema = await this.readFormSchema(input.formDefinitionVersionId);
    const targetField =
      typeof input.targetFieldKey === 'string'
        ? (readSchemaField(formSchema, input.targetFieldKey) ?? null)
        : null;
    const issues = [
      ...this.conditionService.lintExpressionIssues(
        input.expression,
        EXPRESSION_PREVIEW_LABEL,
        {
          dialect,
          formSchema,
          targetField,
          usagePoint: usagePoint as ExpressionUsagePoint,
        },
      ),
      ...readLastDecisionIssues(
        input.expression,
        EXPRESSION_PREVIEW_LABEL,
        usagePoint,
        input.edgeSourceNodeType ?? null,
        dialect,
      ),
    ];
    const valid = issues.every((issue) => issue.severity !== 'ERROR');

    return {
      evaluation:
        input.mode === 'EVALUATE' && valid
          ? this.evaluateSample(input, dialect)
          : null,
      issues: issues.map(toIssueObject),
      valid,
    };
  }

  /**
   * What an expression at this use point may use: its roots, the bound
   * form's fields and the functions. The registry is host code: a throw or a
   * malformed answer lists no function and says so, never its message.
   */
  async expressionCatalog(
    input: ExpressionCatalogInput,
  ): Promise<ExpressionCatalogObject> {
    const usagePoint = isExpressionUsagePoint(input.usagePoint)
      ? input.usagePoint
      : null;
    const roots = usagePoint
      ? EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT[usagePoint]
      : [];
    const formSchema = roots.includes('form')
      ? await this.readFormSchema(input.formDefinitionVersionId)
      : null;
    const functions = usagePoint ? this.readCatalogFunctions(usagePoint) : null;

    return {
      fields: readCatalogFields(formSchema),
      functions: functions ?? [],
      functionsAvailable: functions !== null,
      roots: [...roots],
      usagePoint: input.usagePoint,
    };
  }

  /**
   * Every expression of the designer's draft with the form fields it reads
   * and its lint findings, warnings included: what the field matrix shows as
   * dependencies, what blocks renaming or deleting a referenced field, and
   * where the designer shows warnings the publish lint does not return.
   */
  async analyzeWorkflowExpressions(
    input: WorkflowExpressionsInput,
  ): Promise<WorkflowExpressionsObject> {
    const definition = parseDefinition(input.workflowDefinitionJson);
    const dialect = readDefinitionDialect(definition);
    const formSchema = await this.readFormSchema(input.formDefinitionVersionId);
    const expressions = readDesignerExpressions(
      definition,
      input.initiatorPolicyCel ?? null,
    );
    const sourceTypes = readEdgeSourceTypes(definition);

    return {
      dialect: dialect ?? 'unknown',
      expressions: expressions.map(
        (entry): WorkflowExpressionAnalysisObject => ({
          fieldKeys: readReferencedFieldKeys(
            entry.expression,
            dialect ?? DEFAULT_EXPRESSION_DIALECT,
            formSchema,
          ),
          issues:
            dialect === null
              ? []
              : this.lintEntry(entry, dialect, formSchema, sourceTypes).map(
                  toIssueObject,
                ),
          label: entry.label,
          usagePoint: entry.usagePoint,
        }),
      ),
    };
  }

  /**
   * The check a draft goes through before it moves to cel-v2 (ADR 22 §3.3):
   * every expression evaluated under both dialects
   * (`runExpressionDifferential`, with the injected `ConditionService`, so
   * host functions are callable) on two samples built from the bound form —
   * every field filled, and every field missing — and every finding the
   * cel-v2 lint would report. Nothing is saved; the designer upgrades the
   * draft itself once the designer confirmed.
   */
  async previewWorkflowDialectUpgrade(
    input: WorkflowExpressionsInput,
  ): Promise<WorkflowDialectUpgradePreviewObject> {
    const definition = parseDefinition(input.workflowDefinitionJson);
    const currentDialect = readDefinitionDialect(definition);
    const formSchema = await this.readFormSchema(input.formDefinitionVersionId);
    const expressions = readDesignerExpressions(
      definition,
      input.initiatorPolicyCel ?? null,
    );
    const sourceTypes = readEdgeSourceTypes(definition);
    const deadline = Date.now() + DIALECT_UPGRADE_CHECK_TIME_LIMIT_MS;

    // Load both engines and this registry's environments outside the time
    // limit, so the first comparison does not pay for module loading.
    this.conditionService.prepareEngine('cel-legacy');
    this.conditionService.prepareEngine('cel-v2');

    const compared = expressions.reduce<{
      readonly checkedCount: number;
      readonly differences: readonly WorkflowDialectDifferenceObject[];
      readonly stopped: boolean;
    }>(
      (state, entry) => {
        if (state.stopped || Date.now() > deadline) {
          return { ...state, stopped: true };
        }

        return {
          checkedCount: state.checkedCount + 1,
          differences: [
            ...state.differences,
            ...this.compareDialects(entry, formSchema, sourceTypes),
          ],
          stopped: false,
        };
      },
      { checkedCount: 0, differences: [], stopped: false },
    );

    return {
      checkedCount: compared.checkedCount,
      complete: !compared.stopped,
      currentDialect: currentDialect ?? 'unknown',
      differences: compared.differences,
      expressionCount: expressions.length,
      v2Issues: expressions.flatMap((entry) =>
        this.lintEntry(entry, 'cel-v2', formSchema, sourceTypes).map(
          toIssueObject,
        ),
      ),
    };
  }

  private lintEntry(
    entry: UsagePointExpression,
    dialect: ExpressionDialect,
    formSchema: FormDefinitionSchema | null,
    sourceTypes: ReadonlyMap<string, string>,
  ): readonly ExpressionLintIssue[] {
    return [
      ...this.conditionService.lintExpressionIssues(
        entry.expression,
        entry.label,
        {
          dialect,
          formSchema,
          targetField:
            entry.targetFieldKey === null
              ? null
              : (readSchemaField(formSchema, entry.targetFieldKey) ?? null),
          usagePoint: entry.usagePoint,
        },
      ),
      ...readLastDecisionIssues(
        entry.expression,
        entry.label,
        entry.usagePoint,
        sourceTypes.get(entry.label) ?? null,
        dialect,
      ),
    ];
  }

  private compareDialects(
    entry: UsagePointExpression,
    formSchema: FormDefinitionSchema | null,
    sourceTypes: ReadonlyMap<string, string>,
  ): readonly WorkflowDialectDifferenceObject[] {
    const expression = entry.expression?.trim();

    if (!expression) {
      return [];
    }

    const samples: readonly DialectUpgradeSample[] = ['FILLED', 'EMPTY'];
    const firstDifference = samples
      .map(
        (sample): readonly [DialectUpgradeSample, ExpressionDifferentialResult] => [
          sample,
          runExpressionDifferential(
            {
              context: buildSampleContext(
                entry.usagePoint,
                formSchema,
                sample,
                sourceTypes.get(entry.label) ?? null,
              ),
              expression,
            },
            this.conditionService,
          ),
        ],
      )
      .find(([, result]) => !result.same);

    return firstDifference
      ? [
          {
            label: entry.label,
            legacyOutcome: firstDifference[1].legacy,
            sample: firstDifference[0],
            usagePoint: entry.usagePoint,
            v2Outcome: firstDifference[1].v2,
          },
        ]
      : [];
  }

  private evaluateSample(
    input: PreviewExpressionInput,
    dialect: ExpressionDialect,
  ): ExpressionEvaluationObject {
    const sample = parseSampleContext(input.sampleContextJson ?? null);
    const usagePoint = isExpressionUsagePoint(input.usagePoint)
      ? input.usagePoint
      : null;

    if (usagePoint === null) {
      return evaluationError('EXPRESSION_SYNTAX_ERROR');
    }

    // Outside the budget: loading the engine is not the expression's time.
    this.conditionService.prepareEngine(dialect);

    try {
      const value = this.conditionService.evaluateValue(
        input.expression,
        sample,
        EXPRESSION_PREVIEW_LABEL,
        {
          allowedRootIdentifiers:
            EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT[usagePoint],
          budget: createExpressionBudget(),
          dialect,
        },
      );

      return {
        errorCode: null,
        outcome: 'OK',
        resultJson: JSON.stringify(value),
        resultType: readResultType(value),
      };
    } catch (error: unknown) {
      if (error instanceof ExpressionRuntimeError) {
        return evaluationError(error.code);
      }

      // Not a runtime outcome: a bug. Its text may hold the sample, so it is
      // neither returned nor logged.
      this.logger.error('code=EXPRESSION_PREVIEW_FAILED');

      throw new InternalServerErrorException('Expression preview failed');
    }
  }

  private readCatalogFunctions(
    usagePoint: ExpressionUsagePoint,
  ): readonly ExpressionCatalogFunctionObject[] | null {
    try {
      const allowsHost = allowsHostExpressionFunctions(usagePoint);

      return readExpressionFunctionTable(this.functionRegistry)
        .functions.filter((fn) => allowsHost || BUILT_IN_NAMES.has(fn.name))
        .map(
          (fn): ExpressionCatalogFunctionObject => ({
            builtIn: BUILT_IN_NAMES.has(fn.name),
            description: fn.description,
            label: fn.label,
            name: fn.name,
            parameters: fn.parameters.map((parameter) => ({
              name: parameter.name,
              type: parameter.type,
            })),
            returnType: fn.returnType,
          }),
        );
    } catch {
      // `readExpressionFunctionTable` already logged a fixed reason; the
      // host's message is not kept.
      this.logger.warn('code=EXPRESSION_CATALOG_UNAVAILABLE reason=registry');

      return null;
    }
  }

  private async readFormSchema(
    formDefinitionVersionId: string | null | undefined,
  ): Promise<FormDefinitionSchema | null> {
    if (!formDefinitionVersionId) {
      return null;
    }

    const formVersion = await this.formDefinitionVersionRepository.findOne({
      where: { id: formDefinitionVersionId },
    });

    if (!formVersion) {
      throw new NotFoundException(
        `Form definition version ${formDefinitionVersionId} was not found`,
      );
    }

    return formVersion.schema ?? null;
  }
}

function toIssueObject(issue: ExpressionLintIssue): ExpressionIssueObject {
  return {
    code: issue.code,
    label: issue.label,
    severity: issue.severity,
    subject: issue.subject ?? null,
  };
}

function evaluationError(code: string): ExpressionEvaluationObject {
  return { errorCode: code, outcome: 'ERROR', resultJson: null, resultType: null };
}

/** A dialect the caller names; absent is `cel-legacy`, unknown is refused. */
function readRequestDialect(value: string | null | undefined): ExpressionDialect {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_EXPRESSION_DIALECT;
  }

  if (!isExpressionDialect(value)) {
    throw new BadRequestException('dialect must be cel-legacy or cel-v2');
  }

  return value;
}

/** The definition's dialect, or `null` for one this version does not know. */
function readDefinitionDialect(
  definition: WorkflowDefinition,
): ExpressionDialect | null {
  const value: unknown = definition.expressionDialect;

  if (value === undefined || value === null) {
    return DEFAULT_EXPRESSION_DIALECT;
  }

  return isExpressionDialect(value) ? value : null;
}

function parseDefinition(json: string): WorkflowDefinition {
  try {
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as WorkflowDefinition;
    }
  } catch {
    // Falls through to the fixed message: the parser's own text echoes input.
  }

  throw new BadRequestException('workflowDefinitionJson must be a JSON object');
}

/**
 * The expressions the designer analyses: the publish reader's list, capped.
 * Blank ones are kept (the lint reports them) but compare as nothing.
 */
function readDesignerExpressions(
  definition: WorkflowDefinition,
  initiatorPolicyCel: string | null,
): readonly UsagePointExpression[] {
  const expressions = readUsagePointExpressions(
    definition,
    initiatorPolicyCel,
  ).filter(
    (entry) => entry.expression !== null && entry.expression !== undefined,
  );

  if (expressions.length > MAX_DESIGNER_EXPRESSIONS) {
    throw new BadRequestException(
      `A workflow definition may hold at most ${MAX_DESIGNER_EXPRESSIONS} expressions`,
    );
  }

  return expressions;
}

/** Edge condition label → type of the node the edge leaves. */
function readEdgeSourceTypes(
  definition: WorkflowDefinition,
): ReadonlyMap<string, string> {
  const nodes: readonly WorkflowNode[] = Array.isArray(definition.nodes)
    ? definition.nodes
    : [];
  const edges: readonly WorkflowEdge[] = Array.isArray(definition.edges)
    ? definition.edges
    : [];
  const nodeTypes = new Map(
    nodes
      .filter(
        (node) =>
          typeof node?.id === 'string' && typeof node?.type === 'string',
      )
      .map((node): readonly [string, string] => [node.id, node.type]),
  );

  return new Map(
    edges
      .filter(
        (edge) =>
          typeof edge?.id === 'string' &&
          typeof edge?.source === 'string' &&
          nodeTypes.has(edge.source),
      )
      .map((edge): readonly [string, string] => [
        WORKFLOW_EXPRESSION_LABELS.edgeCondition(edge.id),
        nodeTypes.get(edge.source) ?? '',
      ]),
  );
}

/**
 * `EXPR_LAST_DECISION_UNAVAILABLE`: an edge condition that reads
 * `lastDecision` where the source node records no decision. Read from the
 * AST; a cel-legacy expression the reader cannot walk falls back to a word
 * match outside string literals, like the old dialect's other lint.
 */
export function readLastDecisionIssues(
  expression: string | null | undefined,
  label: string,
  usagePoint: string,
  edgeSourceNodeType: string | null,
  dialect: ExpressionDialect,
): readonly ExpressionLintIssue[] {
  const trimmed = expression?.trim();

  if (
    usagePoint !== 'FLOW_CONDITION' ||
    edgeSourceNodeType === null ||
    hasWorkflowLastDecision(edgeSourceNodeType) ||
    !trimmed
  ) {
    return [];
  }

  const result = readExpressionReferences(trimmed, dialect);
  const readsLastDecision =
    result.status === 'OK'
      ? result.references.roots.includes('lastDecision')
      : result.status === 'UNAVAILABLE' &&
        /(^|[^A-Za-z0-9_.])lastDecision\b/u.test(stripStringLiterals(trimmed));

  return readsLastDecision
    ? [
        {
          code: 'EXPR_LAST_DECISION_UNAVAILABLE',
          label,
          severity: readExpressionLintSeverity('EXPR_LAST_DECISION_UNAVAILABLE'),
        },
      ]
    : [];
}

/**
 * The top-level form fields an expression reads. cel-v2 and a walkable
 * cel-legacy expression answer from the AST; otherwise each declared field is
 * matched as a word after `form.`/`formData.` outside string literals.
 */
function readReferencedFieldKeys(
  expression: string | null | undefined,
  dialect: ExpressionDialect,
  formSchema: FormDefinitionSchema | null,
): readonly string[] {
  const trimmed = expression?.trim();

  if (!trimmed) {
    return [];
  }

  const result = readExpressionReferences(trimmed, dialect);

  if (result.status === 'OK') {
    return result.references.formFieldKeys;
  }

  const stripped = stripStringLiterals(trimmed);

  return (formSchema?.fields ?? [])
    .map((field) => field.fieldKey)
    .filter((fieldKey) =>
      new RegExp(
        `(^|[^A-Za-z0-9_.])(form|formData)\\.${escapeRegExp(fieldKey)}(?![A-Za-z0-9_])`,
        'u',
      ).test(stripped),
    );
}

function stripStringLiterals(expression: string): string {
  return expression.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/gu, '""');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function readSchemaField(
  formSchema: FormDefinitionSchema | null,
  fieldKey: string,
): FormFieldDefinition | undefined {
  return (formSchema?.fields ?? []).find((field) => field.fieldKey === fieldKey);
}

function readCatalogFields(
  formSchema: FormDefinitionSchema | null,
): readonly ExpressionCatalogFieldObject[] {
  return (Array.isArray(formSchema?.fields) ? formSchema.fields : [])
    .filter(
      (field) =>
        typeof field?.fieldKey === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(field.fieldKey),
    )
    .map(
      (field): ExpressionCatalogFieldObject => ({
        fieldKey: field.fieldKey,
        fieldType: field.type,
        label: typeof field.label === 'string' ? field.label : field.fieldKey,
        path: `form.${field.fieldKey}`,
        required: field.required === true,
      }),
    );
}

function parseSampleContext(
  json: string | null,
): Readonly<Record<string, unknown>> {
  if (json === null || json === '') {
    return {};
  }

  if (json.length > MAX_PREVIEW_SAMPLE_CONTEXT_JSON_LENGTH) {
    throw new BadRequestException('sampleContextJson is too long');
  }

  try {
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  } catch {
    // Falls through: the parser's message echoes the input.
  }

  throw new BadRequestException('sampleContextJson must be a JSON object');
}

function readResultType(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'list';
  }

  switch (typeof value) {
    case 'boolean':
      return 'bool';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    default:
      return 'map';
  }
}

/** A typed sample value for one field, so number and text compare as such. */
function readSampleFieldValue(field: FormFieldDefinition): unknown {
  switch (field.type) {
    case 'number':
    case 'money':
      return 7;
    case 'boolean':
      return true;
    case 'date':
      return '2026-01-01';
    case 'datetime':
      return SAMPLE_NOW;
    case 'checkbox':
      return ['sample'];
    case 'member':
      return field.multiple === true ? ['member-sample'] : 'member-sample';
    case 'table':
    case 'file_upload':
      return [];
    default:
      return 'sample';
  }
}

/**
 * The context one comparison runs on. FILLED gives every declared field a
 * typed value and an edge leaving an approval node a decision; EMPTY leaves
 * the form empty and `lastDecision` null, which is where `has()` and `||`
 * differ (docs/24 §1).
 */
function buildSampleContext(
  usagePoint: ExpressionUsagePoint,
  formSchema: FormDefinitionSchema | null,
  sample: DialectUpgradeSample,
  edgeSourceNodeType: string | null,
): Readonly<Record<string, unknown>> {
  const form: Readonly<Record<string, unknown>> =
    sample === 'FILLED'
      ? Object.fromEntries(
          (formSchema?.fields ?? []).map((field): readonly [string, unknown] => [
            field.fieldKey,
            readSampleFieldValue(field),
          ]),
        )
      : {};
  const env = { now: SAMPLE_NOW };

  if (usagePoint === 'INITIATOR_POLICY') {
    return { env, initiator: SAMPLE_MEMBER, subject: SAMPLE_MEMBER };
  }

  return {
    env,
    form,
    formData: form,
    initiator: SAMPLE_MEMBER,
    instance: {
      id: 'instance-sample',
      state: 'IN_PROGRESS',
      templateId: 'template-sample',
      templateVersionId: 'template-version-sample',
      title: 'sample',
    },
    lastDecision:
      sample === 'FILLED' &&
      edgeSourceNodeType !== null &&
      hasWorkflowLastDecision(edgeSourceNodeType)
        ? SAMPLE_DECISION
        : null,
    principal: SAMPLE_MEMBER,
  };
}
