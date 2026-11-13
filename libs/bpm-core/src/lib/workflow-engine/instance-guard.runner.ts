import {
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FormDataIssue } from '@rytass/bpm-core-shared/form';
import {
  createFormDataBadRequest,
  readFormDataIssueMessage,
} from '../form/form-data-issue';
import type {
  BPMInstanceGuard,
  BPMInstanceGuardInput,
  BPMInstanceGuardIssue,
} from './instance-guard.token';

/** Default for `instanceGuardTimeoutMs` (ADR 27 §2.2). */
export const BPM_INSTANCE_GUARD_DEFAULT_TIMEOUT_MS = 5000;

export const BPM_INSTANCE_GUARD_TIMEOUT_CODE = 'BPM_INSTANCE_GUARD_TIMEOUT';
export const BPM_INSTANCE_GUARD_FAILED_CODE = 'BPM_INSTANCE_GUARD_FAILED';

/**
 * Every error the guard path raises: the 400 for refused issues, the 503 for a
 * timeout or a failing guard, and an `HttpException` the host threw itself.
 * Lets a caller tell a guard refusal apart from any other failure without
 * matching on messages.
 */
const instanceGuardErrors: WeakSet<object> = new WeakSet<object>();

function markInstanceGuardError<TError extends object>(error: TError): TError {
  instanceGuardErrors.add(error);

  return error;
}

export function isInstanceGuardError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    ? instanceGuardErrors.has(error)
    : false;
}

function createGuardUnavailable(
  code: string,
  message: string,
): ServiceUnavailableException {
  return markInstanceGuardError(
    new ServiceUnavailableException({
      code,
      error: 'Service Unavailable',
      message,
      statusCode: 503,
    }),
  );
}

function isGuardIssue(value: unknown): value is BPMInstanceGuardIssue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const issue = value as Readonly<Record<string, unknown>>;

  return (
    typeof issue.message === 'string' &&
    typeof issue.path === 'string' &&
    issue.reason === 'HOST_RULE' &&
    (issue.code === undefined || typeof issue.code === 'string')
  );
}

function readIssueFormDataErrors(
  issues: readonly BPMInstanceGuardIssue[],
): readonly FormDataIssue[] {
  return issues.map(
    (issue: BPMInstanceGuardIssue): FormDataIssue => ({
      message: issue.message,
      path: issue.path,
      reason: issue.reason,
      ...(issue.code === undefined ? {} : { code: issue.code }),
    }),
  );
}

/**
 * Runs the host guard for one engine path and throws if the path must stop.
 *
 * Returns normally only when the guard answered with an empty list in time.
 * Call it inside the engine transaction, after the case lock is taken, so a
 * throw rolls the whole change back.
 *
 * - non-empty issues: 400 `createFormDataBadRequest`
 * - no answer within `timeoutMs`: 503 `BPM_INSTANCE_GUARD_TIMEOUT` (fail closed)
 * - a thrown `HttpException`: rethrown unchanged
 * - any other error, or a malformed answer: 503 `BPM_INSTANCE_GUARD_FAILED`
 */
export async function runInstanceGuard(
  guard: BPMInstanceGuard,
  input: BPMInstanceGuardInput,
  timeoutMs: number,
): Promise<void> {
  const timeoutError = markInstanceGuardError(
    new Error(`BPM_INSTANCE_GUARD_TIMEOUT_${timeoutMs}MS`),
  );
  let timer: NodeJS.Timeout | undefined;

  let issues: readonly BPMInstanceGuardIssue[];

  try {
    issues = await Promise.race([
      Promise.resolve().then((): Promise<readonly BPMInstanceGuardIssue[]> =>
        guard.check(input),
      ),
      new Promise<never>((_resolve, reject): void => {
        timer = setTimeout((): void => {
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } catch (error: unknown) {
    if (error === timeoutError) {
      throw createGuardUnavailable(
        BPM_INSTANCE_GUARD_TIMEOUT_CODE,
        `Instance guard did not answer within ${timeoutMs} ms`,
      );
    }

    if (error instanceof HttpException) {
      markInstanceGuardError(error);

      throw error;
    }

    throw createGuardUnavailable(
      BPM_INSTANCE_GUARD_FAILED_CODE,
      'Instance guard failed',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(issues) || !issues.every(isGuardIssue)) {
    throw createGuardUnavailable(
      BPM_INSTANCE_GUARD_FAILED_CODE,
      'Instance guard returned an answer of the wrong shape',
    );
  }

  if (issues.length === 0) {
    return;
  }

  const formDataErrors = readIssueFormDataErrors(issues);

  throw markInstanceGuardError(
    createFormDataBadRequest(
      readFormDataIssueMessage(formDataErrors),
      formDataErrors,
    ),
  );
}
