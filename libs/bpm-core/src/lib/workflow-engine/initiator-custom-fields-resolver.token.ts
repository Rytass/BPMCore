import { InjectionToken } from '@nestjs/common';
import { BPMAuthContext } from '../bpm-auth';

/**
 * What the engine tells the host while it builds an initiator snapshot.
 *
 * Everything here is a copy: changing it changes nothing the engine keeps.
 */
export interface BPMInitiatorCustomFieldsInput {
  /** Who is signed in when the case is started through the engine. */
  readonly authContext: BPMAuthContext;

  /**
   * The snapshot the engine built from its own data (`customFields` is `{}`):
   * `memberId`, `orgUnitIds`, `positionId`, `positionIds`, `primaryOrgUnitId`.
   * Read-only context for deciding what to add; none of it can be replaced.
   */
  readonly defaultSnapshot: Readonly<Record<string, unknown>>;

  /**
   * The form data being submitted, after the fields an approver fills in were
   * dropped (the same data the case is created with).
   */
  readonly formData: Readonly<Record<string, unknown>>;

  /** The initiator the snapshot is for. */
  readonly memberId: string;

  readonly templateId: string;

  /** The published version the case starts on. */
  readonly templateVersionId: string;
}

/**
 * Host hook that fills `customFields` of the initiator snapshot (the
 * `initiator.customFields.*` and `subject.customFields.*` an expression, an
 * initiator policy or an expression approver can read).
 *
 * The engine calls it only when it builds the snapshot itself: when a case is
 * submitted through the GraphQL `submitApprovalInstance` mutation, which never
 * accepts a snapshot from the client, or when a host calls
 * `WorkflowEngineService.submitApprovalInstance` without
 * `initiatorMetadataSnapshotJson`. A snapshot the caller passes in is stored as
 * it is and this is not called.
 *
 * It decides `customFields` and nothing else: `memberId`, `orgUnitIds`,
 * `positionId`, `positionIds` and `primaryOrgUnitId` always come from the
 * engine, whatever is returned here.
 *
 * The snapshot is fixed at the moment the case is submitted. Resubmitting a
 * returned case does not call this again, and the dry run and the launchable
 * template list do not call it either.
 */
export interface BPMInitiatorCustomFieldsResolver {
  /**
   * Resolves the `customFields` object for one submission.
   *
   * Must return a plain, JSON-serializable object (`{}` for none). A return
   * value of any other shape, or a thrown error, fails the submission and no
   * case is created; the engine never falls back to `{}`.
   *
   * Runs before the case is created and outside the engine transaction, so a
   * slow lookup does not hold a case lock.
   */
  resolveCustomFields(
    input: BPMInitiatorCustomFieldsInput,
  ): Promise<Readonly<Record<string, unknown>>>;
}

/**
 * Optional host binding for {@link BPMInitiatorCustomFieldsResolver}. Without
 * one, `customFields` of an engine-built snapshot is `{}`.
 */
export const BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER: InjectionToken<BPMInitiatorCustomFieldsResolver> =
  Symbol('BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER');
