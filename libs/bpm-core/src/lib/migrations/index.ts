import { MigrationInterface } from 'typeorm';
import { EnablePostgresExtensions2026043000000 } from './0000000000000-enable-postgres-extensions';
import { IdentityOrganizationFoundation2026043001000 } from './0000000001000-identity-organization-foundation';
import { FormBuilderFoundation2026050202000 } from './0000000002000-form-builder-foundation';
import { ApprovalTemplateFoundation2026050403000 } from './0000000003000-approval-template-foundation';
import { WorkflowEngineFoundation2026050404000 } from './0000000004000-workflow-engine-foundation';
import { DelegationRules0000000005000 } from './0000000005000-delegation-rules';
import { NotificationsSla0000000006000 } from './0000000006000-notifications-sla';
import { SignaturesAttachments0000000007000 } from './0000000007000-signatures-attachments';
import { ApprovalTemplateCategories2026051208000 } from './0000000008000-approval-template-categories';
import { TaskCandidates2026051309000 } from './0000000009000-task-candidates';
import { NotificationDeliveryState0000000010000 } from './0000000010000-notification-delivery-state';
import { RemoveAttachmentEncryptionKey0000000011000 } from './0000000011000-remove-attachment-encryption-key';

export const BPM_CORE_MIGRATIONS: readonly (new () => MigrationInterface)[] = [
  EnablePostgresExtensions2026043000000,
  IdentityOrganizationFoundation2026043001000,
  FormBuilderFoundation2026050202000,
  ApprovalTemplateFoundation2026050403000,
  WorkflowEngineFoundation2026050404000,
  DelegationRules0000000005000,
  NotificationsSla0000000006000,
  SignaturesAttachments0000000007000,
  ApprovalTemplateCategories2026051208000,
  TaskCandidates2026051309000,
  NotificationDeliveryState0000000010000,
  RemoveAttachmentEncryptionKey0000000011000,
];

export * from './0000000000000-enable-postgres-extensions';
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
