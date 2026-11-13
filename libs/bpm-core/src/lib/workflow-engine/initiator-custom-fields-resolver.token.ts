import { InjectionToken } from '@nestjs/common';
import { BPMAuthContext } from '../bpm-auth';

/**
 * Why the engine is asking for `customFields`: a case being submitted, the
 * list of templates a member may start (`launchableApprovalTemplates`), or a
 * member reading the data-source options of one template's form before it is
 * submitted.
 */
export type BPMInitiatorCustomFieldsPurpose =
  'FORM_OPTIONS' | 'LAUNCHABLE_TEMPLATES' | 'SUBMISSION';

/**
 * What the engine tells the host while it builds an initiator snapshot.
 *
 * `defaultSnapshot` and `formData` are copies: changing them changes nothing
 * the engine keeps. `authContext` is the caller's own object, as it is for the
 * other host hooks, so treat it as read-only too.
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
   * The form data being submitted, which is the same data the case is created
   * with. When the submission comes from an end user (the GraphQL mutation),
   * the fields an approver fills in have already been dropped from it.
   * `null` for `LAUNCHABLE_TEMPLATES` and `FORM_OPTIONS`, which have no
   * submitted form.
   */
  readonly formData: Readonly<Record<string, unknown>> | null;

  /** The initiator the snapshot is for. */
  readonly memberId: string;

  readonly purpose: BPMInitiatorCustomFieldsPurpose;

  /**
   * The template being submitted, or whose options are read; `null` for
   * `LAUNCHABLE_TEMPLATES`.
   */
  readonly templateId: string | null;

  /**
   * The published version the case starts on, or whose options are read;
   * `null` for `LAUNCHABLE_TEMPLATES`.
   */
  readonly templateVersionId: string | null;
}

/**
 * Host hook that fills `customFields` of the initiator snapshot (the
 * `initiator.customFields.*` and `subject.customFields.*` an expression, an
 * initiator policy or an expression approver can read).
 *
 * The engine calls it when it builds the snapshot itself:
 *
 * - `SUBMISSION`: a case is submitted through the GraphQL
 *   `submitApprovalInstance` mutation, which never accepts a snapshot from the
 *   client, or a host calls `WorkflowEngineService.submitApprovalInstance`
 *   without `initiatorMetadataSnapshotJson`. A snapshot the caller passes in is
 *   stored as it is and this is not called.
 * - `LAUNCHABLE_TEMPLATES`: once per request for the list of templates a
 *   member may start, so an initiator policy that reads
 *   `initiator.customFields` is judged there as it will be at submission.
 *   There is no template and no form: `templateId`, `templateVersionId` and
 *   `formData` are `null`.
 *
 * - `FORM_OPTIONS`: a member reads the data-source options of a template's
 *   form by `templateId` (`formFieldOptions` / `resolveFormFieldOptions`)
 *   and the engine judges that one
 *   template's initiator policy. `templateId` and `templateVersionId` are set,
 *   `formData` is `null`. The snapshot is only judged, never stored.
 *
 * For `SUBMISSION` and `LAUNCHABLE_TEMPLATES` the answer must depend on the
 * initiator only, never on the template or the form: the list asks once for
 * every template, and a template it lists has to be one the member can then
 * submit. Return the same `customFields` for both.
 *
 * `FORM_OPTIONS` is the one purpose that may answer differently. It opens a
 * template's options and nothing else, so a template that only the host's
 * backend submits (an initiator policy such as
 * `has(initiator.customFields.hostSubmitted)`) can let members fill its form
 * while the launchable list and the GraphQL submission still turn them away.
 * Returning the submission answer here keeps the old behaviour: options are
 * open to exactly the members who may start the template.
 *
 * It decides `customFields` and nothing else: `memberId`, `orgUnitIds`,
 * `positionId`, `positionIds` and `primaryOrgUnitId` always come from the
 * engine, whatever is returned here.
 *
 * The snapshot is fixed at the moment the case is submitted. Resubmitting a
 * returned case does not call this again, and the dry run does not call it
 * either.
 */
export interface BPMInitiatorCustomFieldsResolver {
  /**
   * Resolves the `customFields` object for one initiator.
   *
   * Must return a plain, JSON-serializable object (`{}` for none). A return
   * value of any other shape, or a thrown error, fails the submission and no
   * case is created; a submission never falls back to `{}`. The launchable
   * template list does fall back: it judges the policies against `{}`, so a
   * template whose policy reads `initiator.customFields` is left out of it
   * until the resolver answers again.
   *
   * Return a value for every key a template reads: a key whose value is
   * `undefined` is dropped, and a condition that reads it then throws unless
   * the template guards the read with `has()`. What is returned is stored with
   * the case and can be read by anyone who can read the case, so it must not
   * hold secrets.
   *
   * Runs before the case is created and outside the engine transaction, so a
   * slow lookup does not hold a case lock. The engine waits for it 10 seconds
   * at most: past that the submission fails and no case is created (the list
   * falls back as above), and what the resolver settles with later is logged
   * and dropped.
   *
   * What the member sees on a failure is the engine's own message, never the
   * resolver's: a thrown error, running out of time and a value of the wrong
   * shape each answer 500 with a fixed message, and the cause is logged. Throw
   * an `HttpException` to give the member a message of your own; it is passed
   * on as it is.
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
