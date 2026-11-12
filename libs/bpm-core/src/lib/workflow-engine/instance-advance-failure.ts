import type { HttpException } from '@nestjs/common';

/** Which public operation tried to move the instance on. */
export type InstanceAdvanceFailureKind = 'DECISION' | 'RESUBMIT';

/** What the `ADVANCE_FAILED` activity row says about the attempt. */
export interface InstanceAdvanceFailureContext {
  readonly action: 'APPROVED' | 'RETURNED' | null;
  /** The person who acted; for an SLA timeout, the member it acted as. */
  readonly actorMemberId: string;
  readonly automatic: 'SLA_AUTO_APPROVE' | null;
  readonly instanceId: string;
  readonly kind: InstanceAdvanceFailureKind;
  /** The node the decision was made on; `null` for a resubmission. */
  readonly nodeId: string | null;
  /** The decided task; `null` for a resubmission. */
  readonly taskId: string | null;
}

/**
 * Carries a failed attempt to move an instance on from the call site that saw
 * it, through the rolled-back transaction, to the public method that records
 * it. It exists only for that trip: the public method records it and throws
 * {@link InstanceAdvanceFailure.originalError} instead, so no caller ever sees
 * this class. Deliberately not exported from the library index.
 */
export class InstanceAdvanceFailure extends Error {
  readonly context: InstanceAdvanceFailureContext;

  readonly originalError: HttpException;

  constructor(
    originalError: HttpException,
    context: InstanceAdvanceFailureContext,
  ) {
    super(originalError.message);

    this.name = 'InstanceAdvanceFailure';
    this.context = context;
    this.originalError = originalError;
  }
}
