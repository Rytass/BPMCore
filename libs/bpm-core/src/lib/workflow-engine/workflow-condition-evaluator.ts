import {
  WorkflowEdge,
  WorkflowEdgeConditionOperator,
} from '@rytass/bpm-core-shared/workflow';

export type WorkflowConditionContext = Readonly<{
  formData: Readonly<Record<string, unknown>>;
}>;

export function evaluateWorkflowEdgeCondition(
  edge: WorkflowEdge,
  context: WorkflowConditionContext,
): boolean {
  const fieldKey = edge.data.conditionFieldKey;
  const operator = edge.data.conditionOperator;

  if (!fieldKey || !operator) {
    return false;
  }

  const actualValue = context.formData[fieldKey];

  if (operator === 'IS_FILLED') {
    return !isEmptyWorkflowValue(actualValue);
  }

  if (operator === 'IS_EMPTY') {
    return isEmptyWorkflowValue(actualValue);
  }

  const expectedValue = edge.data.conditionValue;

  if (typeof expectedValue === 'undefined') {
    return false;
  }

  return compareWorkflowValues(actualValue, operator, expectedValue);
}

function compareWorkflowValues(
  actualValue: unknown,
  operator: WorkflowEdgeConditionOperator,
  expectedValue: string,
): boolean {
  if (Array.isArray(actualValue)) {
    return compareArrayValue(actualValue, operator, expectedValue);
  }

  if (operator === 'EQUALS') {
    return normalizeWorkflowValue(actualValue) ===
      normalizeExpectedValue(actualValue, expectedValue);
  }

  if (operator === 'NOT_EQUALS') {
    return normalizeWorkflowValue(actualValue) !==
      normalizeExpectedValue(actualValue, expectedValue);
  }

  return compareOrderedValue(actualValue, operator, expectedValue);
}

function compareArrayValue(
  actualValue: readonly unknown[],
  operator: WorkflowEdgeConditionOperator,
  expectedValue: string,
): boolean {
  const includesExpectedValue = actualValue
    .map((value) => normalizeWorkflowValue(value))
    .includes(expectedValue);

  if (operator === 'EQUALS') {
    return includesExpectedValue;
  }

  if (operator === 'NOT_EQUALS') {
    return !includesExpectedValue;
  }

  return false;
}

function compareOrderedValue(
  actualValue: unknown,
  operator: WorkflowEdgeConditionOperator,
  expectedValue: string,
): boolean {
  const actualNumber = readFiniteNumber(actualValue);
  const expectedNumber = readFiniteNumber(expectedValue);
  const actualComparable =
    actualNumber !== null ? actualNumber : normalizeWorkflowValue(actualValue);
  const expectedComparable =
    actualNumber !== null && expectedNumber !== null
      ? expectedNumber
      : expectedValue;

  if (operator === 'GREATER_THAN') {
    return actualComparable > expectedComparable;
  }

  if (operator === 'GREATER_THAN_OR_EQUALS') {
    return actualComparable >= expectedComparable;
  }

  if (operator === 'LESS_THAN') {
    return actualComparable < expectedComparable;
  }

  if (operator === 'LESS_THAN_OR_EQUALS') {
    return actualComparable <= expectedComparable;
  }

  return false;
}

function isEmptyWorkflowValue(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return typeof value === 'string' ? value.trim() === '' : false;
}

function normalizeWorkflowValue(value: unknown): string | number | boolean {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value ?? '');
}

function normalizeExpectedValue(
  actualValue: unknown,
  expectedValue: string,
): string | number | boolean {
  if (typeof actualValue === 'boolean') {
    return expectedValue === 'true';
  }

  if (typeof actualValue === 'number') {
    const expectedNumber = Number(expectedValue);

    return Number.isFinite(expectedNumber) ? expectedNumber : expectedValue;
  }

  return expectedValue;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}
