import { InjectionToken } from '@nestjs/common';
import type { WorkflowNode } from '@rytass/bpm-core-shared';
import type { EntityManager } from 'typeorm';
import type { BPMAuthContext } from '../bpm-auth';
import type { ApprovalInstanceEntity } from './approval-instance.entity';
import type { TaskEntity } from './task.entity';
import type { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';

/**
 * Which engine path is asking the guard: a case being submitted, a returned
 * case being resubmitted, or a task being decided.
 */
export type BPMInstanceGuardKind = 'DECIDE' | 'RESUBMIT' | 'SUBMIT';

/**
 * What the engine hands the guard. The guard runs inside the engine
 * transaction, after the case lock is taken, so every value here is the state
 * the engine is about to commit.
 *
 * Treat every object as read-only. The guard decides, it does not write:
 * whatever it writes through `manager` is committed or rolled back together
 * with the decision, and a timed-out guard cannot take it back.
 */
export interface BPMInstanceGuardInput {
  /** The member who triggered the path, or `null` for a system action. */
  readonly actorMemberId: string | null;

  /**
   * Set only for a decision made by the engine itself (SLA auto-approve). The
   * guard may treat it differently, for example to skip an approver-facing
   * rule. `null` for every other decision.
   */
  readonly automatic: 'SLA_AUTO_APPROVE' | null;

  /** The caller's auth context, when the path has one. */
  readonly authContext: BPMAuthContext | null;

  /** The decision action (`APPROVE`, `REJECT`, ...). `null` unless `kind` is `DECIDE`. */
  readonly action: string | null;

  /**
   * The keys of `formData` the request changed, sorted. For `SUBMIT` every
   * submitted key counts; for `RESUBMIT` the keys whose value differs from the
   * stored form data, including keys the resubmission drops; for `DECIDE` the
   * approver-filled fields whose value really changes.
   */
  readonly changedFieldKeys: readonly string[];

  /**
   * The case as it will be committed. For `SUBMIT` this is the entity the
   * engine has just built and not yet saved (no `id` yet).
   */
  readonly instance: Readonly<ApprovalInstanceEntity>;

  readonly kind: BPMInstanceGuardKind;

  /** The merged form data the case will hold after this path. */
  readonly formData: Readonly<Record<string, unknown>>;

  /** The node being decided. `null` unless `kind` is `DECIDE`. */
  readonly node: WorkflowNode | null;

  /** The task being decided. `null` unless `kind` is `DECIDE`. */
  readonly task: Readonly<TaskEntity> | null;

  /** The published template version the case runs on. */
  readonly templateVersion: Readonly<ApprovalTemplateVersionEntity>;

  /**
   * The engine's transaction manager, for reads that must see the same
   * snapshot the decision is made on. Do not write through it (see above).
   */
  readonly manager: EntityManager;
}

/**
 * One rule the guard refuses on. A non-empty list is returned to the caller as
 * a 400 `createFormDataBadRequest` carrying `formDataErrors`.
 *
 * - `path` is the form field the rule is about, or `''` for the whole case.
 * - `reason` is always `HOST_RULE` for guard issues.
 * - `code` is an optional host error code, passed through unchanged.
 *
 * A guard returns issues only. It cannot return a patch to `formData`: a
 * patch would bypass the approver-fill permissions and the signature coverage.
 */
export interface BPMInstanceGuardIssue {
  readonly code?: string;
  readonly message: string;
  readonly path: string;
  readonly reason: 'HOST_RULE';
}

/**
 * Host hook that can refuse a case before the engine commits a state change.
 *
 * The engine calls `check` on three paths: submit, resubmit and decide. It is
 * called inside the transaction, so a refusal rolls the whole change back. An
 * empty array means pass; a non-empty array becomes a 400. A thrown
 * `HttpException` is returned to the caller unchanged; any other error and a
 * timeout become a 503 (`BPM_INSTANCE_GUARD_FAILED` /
 * `BPM_INSTANCE_GUARD_TIMEOUT`). The default timeout is 5000 ms
 * (`instanceGuardTimeoutMs`).
 *
 * Keep `check` fast and side-effect free. A call that is still running when
 * the timeout fires keeps running; if it has external side effects, the host
 * must make them idempotent itself.
 */
export interface BPMInstanceGuard {
  check(
    input: BPMInstanceGuardInput,
  ): Promise<readonly BPMInstanceGuardIssue[]>;
}

/**
 * Optional host binding for {@link BPMInstanceGuard}. Without one, the three
 * engine paths behave exactly as before the guard existed.
 */
export const BPM_INSTANCE_GUARD: InjectionToken<BPMInstanceGuard> = Symbol(
  'BPM_INSTANCE_GUARD',
);
