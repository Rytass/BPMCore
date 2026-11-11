import { BadRequestException } from '@nestjs/common';
import type {
  FormDataIssue,
  FormDataIssueReason,
} from '@rytass/bpm-core-shared/form';

/**
 * Where a refused value sits: `path` is the machine address the form renderer
 * keys its errors by (`note`, `items[1]`, `items[1].qty`); `ref` is the Chinese
 * name a person reads in the message (`欄位「備註」`, `「請購明細」第 2 列的「數量」`).
 */
export interface FormDataIssueLocation {
  readonly path: string;
  readonly ref: string;
}

interface NamedFormKey {
  readonly fieldKey: string;
  readonly label?: string;
}

export function readFieldIssueLocation(
  field: NamedFormKey,
): FormDataIssueLocation {
  return {
    path: field.fieldKey,
    ref: `欄位「${field.label || field.fieldKey}」`,
  };
}

/** A table row, numbered from 0 in `path` and from 1 in `ref`, as the user reads it. */
export function readRowIssueLocation(
  table: NamedFormKey,
  index: number,
): FormDataIssueLocation {
  return {
    path: `${table.fieldKey}[${index}]`,
    ref: `「${table.label || table.fieldKey}」第 ${index + 1} 列`,
  };
}

export function readCellIssueLocation(
  row: FormDataIssueLocation,
  column: NamedFormKey,
): FormDataIssueLocation {
  return {
    path: `${row.path}.${column.fieldKey}`,
    ref: `${row.ref}的「${column.label || column.fieldKey}」`,
  };
}

/**
 * One refused value. `text` is the rule as a sentence without its subject
 * (`為必填`, `至少需要 2 個字`); the message is the location's `ref` followed by it.
 */
export function createFormDataIssue(
  location: FormDataIssueLocation,
  reason: FormDataIssueReason,
  text: string,
  limit?: number,
): FormDataIssue {
  return {
    message: `${location.ref}${text}`,
    path: location.path,
    reason,
    ...(limit === undefined ? {} : { limit }),
  };
}

/**
 * The 400 a refused form write answers with. `message` stays the Chinese
 * sentence older callers read; `formDataErrors` is the same refusal as data.
 * The body is spelled out in full because Nest uses an object body as-is,
 * and the GraphQL error's `extensions.originalError` is that body.
 */
export function createFormDataBadRequest(
  message: string,
  formDataErrors: readonly FormDataIssue[],
): BadRequestException {
  return new BadRequestException({
    error: 'Bad Request',
    formDataErrors,
    message,
    statusCode: 400,
  });
}

/** The issues' sentences joined, as the refusal message reads them. */
export function readFormDataIssueMessage(
  issues: readonly FormDataIssue[],
): string {
  return issues.map((issue) => issue.message).join('；');
}
