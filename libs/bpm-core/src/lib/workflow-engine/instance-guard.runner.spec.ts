import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BPM_INSTANCE_GUARD_FAILED_CODE,
  BPM_INSTANCE_GUARD_TIMEOUT_CODE,
  isInstanceGuardError,
  runInstanceGuard,
} from './instance-guard.runner';
import type {
  BPMInstanceGuard,
  BPMInstanceGuardInput,
  BPMInstanceGuardIssue,
} from './instance-guard.token';

const input = {
  action: null,
  actorMemberId: 'member-1',
  authContext: null,
  automatic: null,
  changedFieldKeys: [],
  formData: {},
  instance: {},
  kind: 'SUBMIT',
  manager: {},
  node: null,
  task: null,
  templateVersion: {},
} as unknown as BPMInstanceGuardInput;

function guardAnswering(
  answer: () => Promise<unknown>,
): BPMInstanceGuard {
  return {
    check: (): Promise<readonly BPMInstanceGuardIssue[]> =>
      answer() as Promise<readonly BPMInstanceGuardIssue[]>,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }

  throw new Error('expected the guard to throw');
}

describe('runInstanceGuard', () => {
  it('returns normally when the guard answers with no issues', async () => {
    await expect(
      runInstanceGuard(guardAnswering(async () => []), input, 1000),
    ).resolves.toBeUndefined();
  });

  it('refuses with a 400 carrying HOST_RULE formDataErrors', async () => {
    const guard = guardAnswering(async () => [
      {
        code: 'AMOUNT_OVER_LIMIT',
        message: '金額超過上限',
        path: 'amount',
        reason: 'HOST_RULE',
      },
      { message: '整筆需補件', path: '', reason: 'HOST_RULE' },
    ]);

    const error = await captureError(runInstanceGuard(guard, input, 1000));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(isInstanceGuardError(error)).toBe(true);
    expect(error).toMatchObject({
      response: {
        error: 'Bad Request',
        formDataErrors: [
          {
            code: 'AMOUNT_OVER_LIMIT',
            message: '金額超過上限',
            path: 'amount',
            reason: 'HOST_RULE',
          },
          { message: '整筆需補件', path: '', reason: 'HOST_RULE' },
        ],
        statusCode: 400,
      },
    });
  });

  it('fails closed with 503 BPM_INSTANCE_GUARD_TIMEOUT when the guard is slow', async () => {
    const guard = guardAnswering(
      () => new Promise<never>(() => undefined),
    );

    const error = await captureError(runInstanceGuard(guard, input, 20));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(isInstanceGuardError(error)).toBe(true);
    expect(error).toMatchObject({
      response: {
        code: BPM_INSTANCE_GUARD_TIMEOUT_CODE,
        statusCode: 503,
      },
    });
  });

  it('turns an unexpected guard error into 503 BPM_INSTANCE_GUARD_FAILED', async () => {
    const guard = guardAnswering(async () => {
      throw new Error('database is gone');
    });

    const error = await captureError(runInstanceGuard(guard, input, 1000));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(isInstanceGuardError(error)).toBe(true);
    expect(error).toMatchObject({
      response: { code: BPM_INSTANCE_GUARD_FAILED_CODE, statusCode: 503 },
    });
  });

  it('turns a synchronous throw from check into 503 BPM_INSTANCE_GUARD_FAILED', async () => {
    const guard: BPMInstanceGuard = {
      check: (): Promise<readonly BPMInstanceGuardIssue[]> => {
        throw new Error('sync failure');
      },
    };

    const error = await captureError(runInstanceGuard(guard, input, 1000));

    expect(error).toMatchObject({
      response: { code: BPM_INSTANCE_GUARD_FAILED_CODE },
    });
  });

  it('rethrows an HttpException the host threw, unchanged and marked', async () => {
    const hostError = new BadRequestException('host says no');
    const guard = guardAnswering(async () => {
      throw hostError;
    });

    const error = await captureError(runInstanceGuard(guard, input, 1000));

    expect(error).toBe(hostError);
    expect(isInstanceGuardError(error)).toBe(true);
  });

  it.each([
    ['a non-array answer', { issues: [] }],
    ['an array with a malformed item', [{ message: 'x' }]],
    ['an item with the wrong reason', [{ message: 'x', path: '', reason: 'OTHER' }]],
    ['an item with a non-string code', [{ code: 1, message: 'x', path: '', reason: 'HOST_RULE' }]],
  ])(
    'treats %s as 503 BPM_INSTANCE_GUARD_FAILED',
    async (_label: string, answer: unknown) => {
      const guard = guardAnswering(async () => answer);

      const error = await captureError(runInstanceGuard(guard, input, 1000));

      expect(error).toMatchObject({
        response: { code: BPM_INSTANCE_GUARD_FAILED_CODE, statusCode: 503 },
      });
    },
  );

  it('does not mark an ordinary error as a guard error', () => {
    expect(isInstanceGuardError(new Error('plain'))).toBe(false);
    expect(isInstanceGuardError(undefined)).toBe(false);
  });
});
