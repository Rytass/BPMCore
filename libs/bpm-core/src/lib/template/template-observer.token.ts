import { InjectionToken } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';

/**
 * Which host-facing template mutation produced the change. One event is emitted
 * per mutation, so a compose that also publishes reports `COMPOSED` with
 * `published: true` rather than two separate events.
 */
export enum BPMTemplateChangeActionEnum {
  COMPOSED = 'COMPOSED',
  VERSION_PUBLISHED = 'VERSION_PUBLISHED',
  VERSION_ROLLED_BACK = 'VERSION_ROLLED_BACK',
}

export interface BPMTemplateChangedEvent {
  /** Which mutation ran. */
  readonly action: BPMTemplateChangeActionEnum;
  /** The template as it stands after the change. */
  readonly template: ApprovalTemplateEntity;
  /** The version the mutation acted on, after the change. */
  readonly version: ApprovalTemplateVersionEntity;
  /**
   * The template's `currentVersionId` before the change, so a host can record
   * "v6 → v4" for a rollback. `null` when the template had no published
   * version yet; equal to `version.id` when the change did not move the
   * pointer (a `COMPOSED` that only saved a draft).
   */
  readonly previousVersionId: string | null;
  /**
   * Whether `version` is the template's published version as of this event.
   * Always `true` for `VERSION_PUBLISHED` and `VERSION_ROLLED_BACK`; follows
   * the `publish` flag for `COMPOSED`.
   */
  readonly published: boolean;
  /**
   * The member BPM was told performed the change, or `null` when the caller
   * supplied none. BPM does not authenticate this value — it is whatever the
   * host's resolver passed in.
   */
  readonly actorMemberId: string | null;
  /**
   * Present when the change was written inside a caller-supplied transaction,
   * in which case it is **not committed yet** — a host writing an audit row
   * should join this manager or defer until it commits. Absent when BPM owned
   * the transaction, which means the change is already committed.
   */
  readonly manager?: EntityManager;
}

/**
 * Observes approval-template changes, so a host can keep an audit trail of
 * "who changed the approval flow, and when".
 *
 * BPM registers `publishApprovalTemplateVersion`,
 * `rollbackApprovalTemplateVersion` and `composeApprovalTemplateWithForm` on
 * the same GraphQL schema as the host's own resolvers, and the embedded
 * `<WorkflowDesigner>` calls them directly. Without this hook the only way for
 * a host to learn that a template moved is to match those field names in an
 * interceptor, which couples the host to BPM's schema rather than to an
 * interface.
 *
 * Failures are swallowed by BPM: an observer must never fail the mutation that
 * produced the change.
 */
export interface BPMTemplateObserver {
  onTemplateChanged(event: BPMTemplateChangedEvent): Promise<void> | void;
}

export const BPM_TEMPLATE_OBSERVER: InjectionToken<BPMTemplateObserver> =
  Symbol('BPM_TEMPLATE_OBSERVER');
