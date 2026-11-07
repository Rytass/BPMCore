/**
 * Where an expression is evaluated, and so what it may read (docs/24 §2.3).
 * Each use point has its own root list; they are deliberately not merged.
 */
export const EXPRESSION_USAGE_POINTS = [
  'INITIATOR_POLICY',
  'ENTRY_CONDITION',
  'FLOW_CONDITION',
  'APPROVER_RESOLVER',
  'SERVICE_FORM_FIELD_VALUE',
  'WEBHOOK_PAYLOAD',
  'DELEGATION_CONDITION',
  'DATA_SOURCE_BINDING',
  'NOTIFY_WEBHOOK_BINDING',
] as const;

export type ExpressionUsagePoint = (typeof EXPRESSION_USAGE_POINTS)[number];

const INSTANCE_ROOTS = [
  'env',
  'form',
  'formData',
  'initiator',
  'instance',
] as const;

/**
 * The root identifiers each use point evaluates with. Mirrors what the engine
 * hands over at each point (workflow-engine `buildInitiatorPolicyContext`,
 * `buildWorkflowExpressionContext`, the edge `lastDecision`, the delegation
 * `principal`), so the lint refuses exactly what could only fail at run time.
 */
export const EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT: Readonly<
  Record<ExpressionUsagePoint, readonly string[]>
> = {
  APPROVER_RESOLVER: INSTANCE_ROOTS,
  DATA_SOURCE_BINDING: ['form', 'row'],
  DELEGATION_CONDITION: [...INSTANCE_ROOTS, 'principal'],
  ENTRY_CONDITION: INSTANCE_ROOTS,
  FLOW_CONDITION: [...INSTANCE_ROOTS, 'lastDecision'],
  INITIATOR_POLICY: ['env', 'initiator', 'subject'],
  NOTIFY_WEBHOOK_BINDING: ['form'],
  SERVICE_FORM_FIELD_VALUE: INSTANCE_ROOTS,
  WEBHOOK_PAYLOAD: INSTANCE_ROOTS,
};

/**
 * Use points that may only call the built-in functions (docs/24 §1: bindings
 * get host functions later, if ever; widening is additive, narrowing is not).
 */
export const EXPRESSION_USAGE_POINTS_WITHOUT_HOST_FUNCTIONS: readonly ExpressionUsagePoint[] =
  ['DATA_SOURCE_BINDING', 'NOTIFY_WEBHOOK_BINDING'];

export const isExpressionUsagePoint = (
  value: unknown,
): value is ExpressionUsagePoint =>
  typeof value === 'string' &&
  (EXPRESSION_USAGE_POINTS as readonly string[]).includes(value);

export const allowsHostExpressionFunctions = (
  usagePoint: ExpressionUsagePoint,
): boolean =>
  !EXPRESSION_USAGE_POINTS_WITHOUT_HOST_FUNCTIONS.includes(usagePoint);

/**
 * Lint findings that refuse a publish (docs/24 §2.2). Publish, the preview's
 * LINT mode and the NOTIFY catalog share this one list.
 */
export const EXPRESSION_LINT_ERROR_CODES = [
  'EXPR_PARSE_FAILED',
  'EXPR_ROOT_NOT_ALLOWED',
  'EXPR_WHOLE_FORM_REFERENCE',
  'EXPR_COMPUTED_KEY',
  'EXPR_RESERVED_PATH_SEGMENT',
  'EXPR_COMPLEXITY_EXCEEDED',
  'EXPR_COMPREHENSION_NESTING',
  'EXPR_FIELD_UNKNOWN',
  'EXPR_FIELD_TYPE_MISMATCH',
  'EXPR_RESULT_TYPE_MISMATCH',
  'EXPR_FUNCTION_NOT_REGISTERED',
  'EXPR_FUNCTION_NOT_ALLOWED',
] as const;

/**
 * Lint findings that only warn. `EXPR_DIVISOR_IS_FIELD` is the warning
 * docs/24 §2.1 asks for (a `double` divided by a zero field is `Infinity` in
 * cel-v2, which a comparison quietly turns into a routing decision; P1 P35).
 * `EXPR_LAST_DECISION_UNAVAILABLE` is an edge condition that reads
 * `lastDecision` on an edge leaving a node without tasks (a gateway, a
 * service task, the start): no decision is made there, so it is always
 * `null` at run time (Phase 23 P2 live finding, P4).
 */
export const EXPRESSION_LINT_WARNING_CODES = [
  'EXPR_OPTIONAL_FIELD_WITHOUT_HAS',
  'EXPR_OR_ABSORBS_ERROR',
  'EXPR_HAS_NESTED_PARENT',
  'EXPR_APPROVER_READS_FORM',
  'EXPR_HIDDEN_FIELD_COPIED',
  'EXPR_DIVISOR_IS_FIELD',
  'EXPR_LAST_DECISION_UNAVAILABLE',
] as const;

export type ExpressionLintErrorCode =
  (typeof EXPRESSION_LINT_ERROR_CODES)[number];

export type ExpressionLintWarningCode =
  (typeof EXPRESSION_LINT_WARNING_CODES)[number];

export type ExpressionLintCode =
  ExpressionLintErrorCode | ExpressionLintWarningCode;

export type ExpressionLintSeverity = 'ERROR' | 'WARNING';

/**
 * One finding. `subject` names what the finding is about (a field key, a
 * root, a function) and is only ever an identifier: anything else is dropped
 * when the line is written, so a user-chosen key can never carry the `'; '`
 * the publish lint joins lines with.
 */
export interface ExpressionLintIssue {
  readonly code: ExpressionLintCode;
  readonly label: string;
  readonly severity: ExpressionLintSeverity;
  readonly subject?: string;
}

export const EXPRESSION_LINT_SUBJECT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const EXPRESSION_LINT_CODES: readonly string[] = [
  ...EXPRESSION_LINT_ERROR_CODES,
  ...EXPRESSION_LINT_WARNING_CODES,
];

export const isExpressionLintCode = (
  value: unknown,
): value is ExpressionLintCode =>
  typeof value === 'string' && EXPRESSION_LINT_CODES.includes(value);

export const readExpressionLintSeverity = (
  code: ExpressionLintCode,
): ExpressionLintSeverity =>
  (EXPRESSION_LINT_WARNING_CODES as readonly string[]).includes(code)
    ? 'WARNING'
    : 'ERROR';

/**
 * The publish-lint line for a finding: `<label>: <code>` or
 * `<label>: <code> <subject>`. The designer parses it back with
 * {@link parseExpressionLintLine} to show its own copy.
 */
export const formatExpressionLintIssue = (
  issue: ExpressionLintIssue,
): string =>
  issue.subject !== undefined &&
  EXPRESSION_LINT_SUBJECT_PATTERN.test(issue.subject)
    ? `${issue.label}: ${issue.code} ${issue.subject}`
    : `${issue.label}: ${issue.code}`;

export interface ParsedExpressionLintLine {
  readonly code: ExpressionLintCode;
  readonly label: string;
  readonly subject: string | null;
}

const EXPRESSION_LINT_LINE_PATTERN =
  /^(.+): (EXPR_[A-Z_]+)(?: ([A-Za-z_][A-Za-z0-9_]*))?$/u;

/** The parts of a line {@link formatExpressionLintIssue} wrote, or `null`. */
export const parseExpressionLintLine = (
  line: string,
): ParsedExpressionLintLine | null => {
  const match = EXPRESSION_LINT_LINE_PATTERN.exec(line);

  if (!match || !isExpressionLintCode(match[2])) {
    return null;
  }

  return {
    code: match[2],
    label: match[1],
    subject: match[3] ?? null,
  };
};

/**
 * The publish-lint line for a definition whose `expressionDialect` this
 * version does not know (Phase 23 P2). Shared so the designer can match it.
 */
export const UNKNOWN_EXPRESSION_DIALECT_LINT_MESSAGE =
  'workflow.expressionDialect must be cel-legacy or cel-v2';
