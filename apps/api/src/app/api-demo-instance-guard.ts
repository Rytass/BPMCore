import type {
  BPMInstanceGuard,
  BPMInstanceGuardInput,
  BPMInstanceGuardIssue,
} from '@rytass/bpm-core-nestjs-module';

/*
 * Demo pre-decision guard for the wrapper app (ADR 27 §2). It exists to show
 * how a host wires `instanceGuard` and to let the back office see a host
 * refusal; it is not part of `@rytass/bpm-core-nestjs-module`.
 *
 * It refuses a submit, resubmit or decision whenever a top-level text value of
 * the form contains the marker below, so nothing an ordinary demo flow types
 * is ever refused. It never reads or writes through `input.manager`.
 */

/** The text that makes the demo guard refuse the operation. */
export const API_DEMO_INSTANCE_GUARD_MARKER = '[guard-block]';

export const API_DEMO_INSTANCE_GUARD_CODE = 'DEMO_GUARD_MARKER';

export const apiDemoInstanceGuard: BPMInstanceGuard = {
  check: async (
    input: BPMInstanceGuardInput,
  ): Promise<readonly BPMInstanceGuardIssue[]> =>
    Object.entries(input.formData)
      .filter(
        ([, value]): boolean =>
          typeof value === 'string' &&
          value.includes(API_DEMO_INSTANCE_GUARD_MARKER),
      )
      .map(([fieldKey]): BPMInstanceGuardIssue => ({
        code: API_DEMO_INSTANCE_GUARD_CODE,
        message: `示範宿主規則：欄位內容含有 ${API_DEMO_INSTANCE_GUARD_MARKER}，宿主系統拒絕這次操作。`,
        path: fieldKey,
        reason: 'HOST_RULE',
      })),
};

/**
 * The demo guard is wired outside production only, matching the demo webhook
 * endpoints.
 */
export function readApiDemoInstanceGuard(
  nodeEnv: string | undefined,
): BPMInstanceGuard | undefined {
  return nodeEnv === 'production' ? undefined : apiDemoInstanceGuard;
}
