import { MigrationInterface } from 'typeorm';
import { EnablePostgresExtensions0000000000001 } from './0000000000001-enable-postgres-extensions';
import { IdentityOrganizationFoundation0000000001000 } from './0000000001000-identity-organization-foundation';
import { FormBuilderFoundation0000000002000 } from './0000000002000-form-builder-foundation';
import { ApprovalTemplateFoundation0000000003000 } from './0000000003000-approval-template-foundation';
import { WorkflowEngineFoundation0000000004000 } from './0000000004000-workflow-engine-foundation';
import { DelegationRules0000000005000 } from './0000000005000-delegation-rules';
import { NotificationsSla0000000006000 } from './0000000006000-notifications-sla';
import { SignaturesAttachments0000000007000 } from './0000000007000-signatures-attachments';
import { ApprovalTemplateCategories0000000008000 } from './0000000008000-approval-template-categories';
import { TaskCandidates0000000009000 } from './0000000009000-task-candidates';
import { NotificationDeliveryState0000000010000 } from './0000000010000-notification-delivery-state';
import { RemoveAttachmentEncryptionKey0000000011000 } from './0000000011000-remove-attachment-encryption-key';
import { NotificationSlaIdempotency0000000012000 } from './0000000012000-notification-sla-idempotency';
import { WorkflowQueryIndexes0000000013000 } from './0000000013000-workflow-query-indexes';
import { NotificationResolution0000000014000 } from './0000000014000-notification-resolution';
import { BackfillStaleNotificationResolution0000000015000 } from './0000000015000-backfill-stale-notification-resolution';
import { ArchiveParallelFormDrafts0000000016000 } from './0000000016000-archive-parallel-form-drafts';
import { AdhocDirectives0000000017000 } from './0000000017000-adhoc-directives';
import { NotificationArchive0000000018000 } from './0000000018000-notification-archive';

export const BPM_CORE_MIGRATIONS: readonly (new () => MigrationInterface)[] = [
  EnablePostgresExtensions0000000000001,
  IdentityOrganizationFoundation0000000001000,
  FormBuilderFoundation0000000002000,
  ApprovalTemplateFoundation0000000003000,
  WorkflowEngineFoundation0000000004000,
  DelegationRules0000000005000,
  NotificationsSla0000000006000,
  SignaturesAttachments0000000007000,
  ApprovalTemplateCategories0000000008000,
  TaskCandidates0000000009000,
  NotificationDeliveryState0000000010000,
  RemoveAttachmentEncryptionKey0000000011000,
  NotificationSlaIdempotency0000000012000,
  WorkflowQueryIndexes0000000013000,
  NotificationResolution0000000014000,
  BackfillStaleNotificationResolution0000000015000,
  ArchiveParallelFormDrafts0000000016000,
  AdhocDirectives0000000017000,
  NotificationArchive0000000018000,
];

export * from './0000000000001-enable-postgres-extensions';
export * from './0000000001000-identity-organization-foundation';
export * from './0000000002000-form-builder-foundation';
export * from './0000000003000-approval-template-foundation';
export * from './0000000004000-workflow-engine-foundation';
export * from './0000000005000-delegation-rules';
export * from './0000000006000-notifications-sla';
export * from './0000000007000-signatures-attachments';
export * from './0000000008000-approval-template-categories';
export * from './0000000009000-task-candidates';
export * from './0000000010000-notification-delivery-state';
export * from './0000000011000-remove-attachment-encryption-key';
export * from './0000000012000-notification-sla-idempotency';
export * from './0000000013000-workflow-query-indexes';
export * from './0000000014000-notification-resolution';
export * from './0000000015000-backfill-stale-notification-resolution';
export * from './0000000016000-archive-parallel-form-drafts';
export * from './0000000017000-adhoc-directives';
export * from './0000000018000-notification-archive';
