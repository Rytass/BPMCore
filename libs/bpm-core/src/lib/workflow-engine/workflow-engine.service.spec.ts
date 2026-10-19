import {
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldOption,
  TableFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import {
  ApproverResolver,
  DecisionPolicy,
  ExcludeInitiatorConfig,
  ReturnBehavior,
  ServiceAction,
  WorkflowDefinition,
  WorkflowEdgeConditionOperator,
} from '@rytass/bpm-core-shared/workflow';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkflowWebhookDeliveryService } from '../workflow-webhook/workflow-webhook-delivery.service';
import { FindOperator, In, ObjectLiteral } from 'typeorm';
import { BPMAuthContext } from '../bpm-auth';
import { BPMRootRuntimeOptions } from '../bpm/bpm-root-options';
import { AttachmentService } from '../attachment/attachment.service';
import { BPMSlaScheduleService } from '../calendar/sla-schedule.service';
import { BPMWeekdayBusinessCalendar } from '../calendar/weekday-business-calendar';
import { ConditionService } from '../condition/condition.service';
import {
  DelegationResolution,
  DelegationService,
  DelegationStep,
} from '../delegation/delegation.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { BPMFormDataSourceValueResolver } from '../form-data-source';
import { NotificationEntity } from '../notification/notification.entity';
import {
  NotificationResolutionEnum,
  SLA_ESCALATION_DELEGATION_REASON,
} from '../notification/notification.enums';
import { NotificationService } from '../notification/notification.service';
import { ManagerResolutionEntity } from '../organization/manager-resolution.entity';
import { MembershipEntity } from '../organization/membership.entity';
import { OrgUnitEntity } from '../organization/org-unit.entity';
import { PositionEntity } from '../organization/position.entity';
import {
  ManagerResolutionScopeTypeEnum,
  OrgUnitTypeEnum,
} from '../organization/organization.enums';
import { SignatureEntity } from '../signature/signature.entity';
import { SignatureService } from '../signature/signature.service';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import {
  AdhocDirectiveStatusEnum,
  AdhocDirectiveTypeEnum,
  AdhocPreApprovalRejectBehaviorEnum,
  AdhocTargetKindEnum,
} from './adhoc.enums';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceListViewEnum,
  ApprovalInstanceStateEnum,
  MemberTaskRoleEnum,
  TaskAssignmentTypeEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskReassignmentErrorCodeEnum,
  TaskReassignmentOutcomeEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import {
  ADMIN_REASSIGN_DELEGATION_REASON,
  TaskReassignmentResult,
  WorkflowEngineService,
} from './workflow-engine.service';
import { BPMWorkflowServiceTaskDispatcher } from './workflow-service-task-dispatcher.token';
import { WorkflowTokenEntity } from './workflow-token.entity';

describe('WorkflowEngineService', () => {
  it('submits an approval instance with snapshots, start token, and activity logs', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const instance = await fixture.service.submitApprovalInstance({
      formDataJson: '{"amount":1000}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: '{"memberId":"member-001","roles":["IT"]}',
      templateId: 'template-1',
      title: null,
    });

    // This fixture leaves `processWorkflowSnapshot` unset, so the token
    // repository tracks nothing and `processRunningInstance` finds no active
    // token on its first pass: the case completes through the empty-token
    // branch, in the same transaction as the submit. What the mutation returns
    // has to agree with what was committed — this asserted `RUNNING` with a
    // null `completedAt` for as long as the completion saved a *copy* of the
    // instance instead of the object the caller holds, showing the initiator a
    // case still awaiting approval until they reloaded.
    expect(instance.state).toBe(ApprovalInstanceStateEnum.APPROVED);
    expect(instance.completedAt).not.toBeNull();
    expect(fixture.savedInstance?.state).toBe(
      ApprovalInstanceStateEnum.APPROVED,
    );
    expect(instance.workflowSnapshot.nodes[0]?.id).toBe('start');
    expect(instance.formDefinitionSnapshot).toMatchObject({
      formDefinitionVersionId: 'form-version-1',
      version: 1,
    });
    expect(instance.formData).toEqual({ amount: 1000 });
    expect(fixture.savedToken).toMatchObject({
      currentNodeId: 'start',
      instanceId: 'instance-1',
      status: WorkflowTokenStatusEnum.ACTIVE,
    });
    expect(fixture.savedActivityLogs.map((log) => log.eventType)).toEqual([
      ActivityLogEventTypeEnum.INSTANCE_STARTED,
      ActivityLogEventTypeEnum.TOKEN_CREATED,
    ]);
  });

  it('resolves dynamic options before saving a submitted instance', async (): Promise<void> => {
    const snapshots: FormDataSourceValueSnapshots = {
      costCenter: {
        bindingHash: 'binding-hash-1',
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        options: [{ label: 'Cost center TPE', value: 'CC-001' }],
        validatedAt: '2026-08-12T09:00:00.000Z',
      },
    };
    const resolver = createValueResolver(snapshots);
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createDynamicOptionFormSchema(),
      formDataSourceValueResolver: resolver,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const authContext = createAuthContext('member-001');

    const instance = await fixture.service.submitApprovalInstance(
      {
        formDataJson: '{"costCenter":"CC-001","plant":"TPE"}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: null,
      },
      authContext,
    );

    expect(resolver.resolveFormDataOptionSnapshots).toHaveBeenCalledWith({
      authContext,
      formData: { costCenter: 'CC-001', plant: 'TPE' },
      revalidateAll: true,
      schema: createDynamicOptionFormSchema(),
    });
    expect(instance.formDataOptionSnapshot).toEqual(snapshots);
  });

  it('refuses a dynamic option value when the host registered no resolver', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createDynamicOptionFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"costCenter":"CC-001","plant":"TPE"}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: null,
      }),
    ).rejects.toMatchObject({ code: 'FORM_DATA_SOURCE_MISSING' });
  });

  it('still accepts a static submission when the host registered no resolver', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const instance = await fixture.service.submitApprovalInstance({
      formDataJson: '{"amount":1000}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      templateId: 'template-1',
      title: null,
    });

    expect(instance.formDataOptionSnapshot).toEqual({});
  });

  it('resolves dynamic options before resubmitting a returned instance', async (): Promise<void> => {
    const snapshots: FormDataSourceValueSnapshots = {
      costCenter: {
        bindingHash: 'binding-hash-2',
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        options: [{ label: 'Cost center HKG', value: 'CC-002' }],
        validatedAt: '2026-08-12T09:00:00.000Z',
      },
    };
    const resolver = createValueResolver(snapshots);
    const formSchema = createDynamicOptionFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema,
      formDataSourceValueResolver: resolver,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const authContext = createAuthContext('member-001');

    const resubmittedInstance = await fixture.service.resubmitApprovalInstance(
      {
        formDataJson: '{"costCenter":"CC-002","plant":"HKG"}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: 'Updated request',
      },
      authContext,
    );

    expect(resolver.resolveFormDataOptionSnapshots).toHaveBeenCalledWith({
      authContext,
      formData: { costCenter: 'CC-002', plant: 'HKG' },
      previousFormData: { costCenter: 'CC-001', plant: 'TPE' },
      previousSnapshots: {},
      schema: formSchema,
    });
    expect(fixture.savedInstance).toMatchObject({
      formDataOptionSnapshot: snapshots,
      state: ApprovalInstanceStateEnum.APPROVED,
    });
    expect(resubmittedInstance.formDataJson).toBe(
      '{"costCenter":"CC-002","plant":"HKG"}',
    );
    expect(resubmittedInstance.formDataOptionSnapshotJson).toBe(
      JSON.stringify(snapshots),
    );
  });

  it('removes the option snapshot when a resubmit clears a dynamic value', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema({
      dynamicFieldRequired: false,
    });
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      processOptionSnapshot: {
        costCenter: {
          bindingHash: 'binding-hash-1',
          dataSourceKey: 'demo.cost-centers',
          dataSourceVersion: 1,
          options: [{ label: 'Cost center TPE', value: 'CC-001' }],
          validatedAt: '2026-08-12T09:00:00.000Z',
        },
      },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.resubmitApprovalInstance({
      formDataJson: '{"costCenter":null,"plant":"TPE"}',
      initiatorMemberId: 'member-001',
      instanceId: 'instance-1',
      title: null,
    });

    expect(fixture.savedInstance?.formDataOptionSnapshot).toEqual({});
  });

  it('does not treat an array on a single-select as a cleared value', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema({
      dynamicFieldRequired: false,
    });
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"costCenter":[],"plant":"TPE"}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: null,
      }),
    ).rejects.toMatchObject({ code: 'FORM_DATA_SOURCE_MISSING' });
  });

  it('does not treat an empty string on a multiple field as a cleared value', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema({
      dynamicFieldMode: 'multiple',
      dynamicFieldRequired: false,
    });
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { costCenter: ['CC-001'], plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"costCenter":"","plant":"TPE"}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: null,
      }),
    ).rejects.toMatchObject({ code: 'FORM_DATA_SOURCE_MISSING' });
  });

  it('resubmits with a controlled error when the instance schema is malformed', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { amount: 1000 },
      processFormDefinitionSnapshot: {
        schema: { fields: [null], schemaVersion: 1 },
      },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    // A corrupt snapshot must surface as a controlled 400, never a TypeError.
    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"amount":1200}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: null,
      }),
    ).rejects.toThrow('Approval instance form schema is invalid');
  });

  it('rejects a resubmit when the instance changes while options resolve', async (): Promise<void> => {
    const resolver = createValueResolver({});
    const formSchema = createDynamicOptionFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema,
      formDataSourceValueResolver: resolver,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      rootInstanceUpdatedAt: new Date('2026-08-12T09:00:00.000Z'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      transactionalInstanceUpdatedAt: new Date('2026-08-12T09:00:01.000Z'),
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"costCenter":"CC-002","plant":"HKG"}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: 'Updated request',
      }),
    ).rejects.toThrow(
      'Approval instance changed while options were resolving; refresh and retry',
    );
    expect(fixture.savedInstance).toBeNull();
  });

  it('builds initiator metadata from active memberships when submit omits a snapshot', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processMemberships: [
        createMembership({
          id: 'membership-sales',
          isPrimary: true,
          orgUnitId: 'org-sales',
          positionId: 'position-manager',
        }),
        createMembership({
          id: 'membership-ops',
          isPrimary: false,
          orgUnitId: 'org-ops',
          positionId: 'position-staff',
        }),
        createMembership({
          effectiveTo: '2026-01-31',
          id: 'membership-ended',
          orgUnitId: 'org-ended',
          positionId: 'position-ended',
        }),
      ],
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.submitApprovalInstance({
      formDataJson: '{"amount":1000}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      templateId: 'template-1',
      title: null,
    });

    expect(fixture.savedInstance?.initiatorMetadataSnapshot).toMatchObject({
      memberId: 'member-001',
      orgUnitIds: ['org-sales', 'org-ops'],
      positionId: 'position-manager',
      positionIds: ['position-manager', 'position-staff'],
      primaryOrgUnitId: 'org-sales',
    });
  });

  describe('business key', () => {
    const TEMPLATE_UUID = '3f1c2a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e';
    const submitWithBusinessKey = (
      fixture: ServiceFixture,
      businessKey?: string | null,
    ): Promise<ApprovalInstanceEntity> =>
      fixture.service.submitApprovalInstance({
        businessKey,
        formDataJson: '{"amount":1000}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: null,
      });
    const createPublishedFixture = (
      options: Partial<Parameters<typeof createServiceFixture>[0]> = {},
    ): ServiceFixture =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        ...options,
      });

    it('stores the trimmed business key on the submitted instance', async (): Promise<void> => {
      const fixture = createPublishedFixture();

      const instance = await submitWithBusinessKey(fixture, '  PO-2026-001 ');

      expect(instance.businessKey).toBe('PO-2026-001');
      expect(fixture.savedInstance?.businessKey).toBe('PO-2026-001');
    });

    it.each([undefined, null, '', '   '])(
      'stores no business key for %p',
      async (businessKey): Promise<void> => {
        const fixture = createPublishedFixture();

        await submitWithBusinessKey(fixture, businessKey);

        expect(fixture.savedInstance?.businessKey).toBeNull();
      },
    );

    it('accepts a business key at the length limit and rejects one beyond it', async (): Promise<void> => {
      const accepted = createPublishedFixture();
      const rejected = createPublishedFixture();

      await submitWithBusinessKey(accepted, 'k'.repeat(200));

      expect(accepted.savedInstance?.businessKey).toHaveLength(200);

      await expect(
        submitWithBusinessKey(rejected, 'k'.repeat(201)),
      ).rejects.toThrow(BadRequestException);
      expect(rejected.savedInstance).toBeNull();
    });

    it('counts the length limit in characters, not UTF-16 code units', async (): Promise<void> => {
      // Each emoji is two UTF-16 code units but one character.
      const atLimit = '😀'.repeat(200);
      const accepted = createPublishedFixture();
      const rejected = createPublishedFixture();

      await submitWithBusinessKey(accepted, atLimit);

      expect(accepted.savedInstance?.businessKey).toBe(atLimit);

      await expect(
        submitWithBusinessKey(rejected, `${atLimit}😀`),
      ).rejects.toThrow(BadRequestException);
    });

    it('looks up a business key that is at the character limit', async (): Promise<void> => {
      const fixture = createPublishedFixture();
      const atLimit = '😀'.repeat(200);

      await fixture.service.findApprovalInstanceByBusinessKey(
        TEMPLATE_UUID,
        atLimit,
      );

      expect(fixture.rootInstanceFindOne).toHaveBeenCalledTimes(1);
    });

    it('turns a duplicate (template, business key) into a Conflict', async (): Promise<void> => {
      const fixture = createPublishedFixture({
        instanceSaveError: Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'approval_instances_business_key_key',
        }),
      });

      await expect(submitWithBusinessKey(fixture, ' PO-1 ')).rejects.toThrow(
        new ConflictException('此範本已有相同業務鍵（PO-1）的簽核單'),
      );
    });

    it('finds the violation on the driver error TypeORM wraps', async (): Promise<void> => {
      const fixture = createPublishedFixture({
        instanceSaveError: Object.assign(new Error('query failed'), {
          driverError: {
            code: '23505',
            constraint: 'approval_instances_business_key_key',
          },
        }),
      });

      await expect(submitWithBusinessKey(fixture, 'PO-1')).rejects.toThrow(
        '此範本已有相同業務鍵（PO-1）的簽核單',
      );
    });

    it('leaves other unique violations and failures untouched', async (): Promise<void> => {
      const otherViolation = Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'some_other_unique_index',
      });
      const fixture = createPublishedFixture({
        instanceSaveError: otherViolation,
      });

      await expect(submitWithBusinessKey(fixture, 'PO-1')).rejects.toBe(
        otherViolation,
      );
    });

    it('does not read a violation as a business key conflict when no key was sent', async (): Promise<void> => {
      const violation = Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'approval_instances_business_key_key',
      });
      const fixture = createPublishedFixture({ instanceSaveError: violation });

      await expect(submitWithBusinessKey(fixture, null)).rejects.toBe(
        violation,
      );
    });

    it('keeps the business key when a returned instance is resubmitted', async (): Promise<void> => {
      const fixture = createPublishedFixture({
        instanceState: ApprovalInstanceStateEnum.RETURNED,
        processBusinessKey: 'PO-2026-001',
        processFormData: { amount: 1000 },
      });

      const resubmitted = await fixture.service.resubmitApprovalInstance({
        formDataJson: '{"amount":2000}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: null,
      });

      expect(resubmitted.businessKey).toBe('PO-2026-001');
      expect(fixture.savedInstance?.businessKey).toBe('PO-2026-001');
    });

    it('keeps the business key when an instance is cancelled', async (): Promise<void> => {
      const fixture = createPublishedFixture({
        processBusinessKey: 'PO-2026-001',
        processFormData: { amount: 1200 },
        processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      });

      const cancelled = await fixture.service.cancelApprovalInstance({
        cancelledByMemberId: 'member-001',
        comment: null,
        instanceId: 'instance-1',
      });

      expect(cancelled.state).toBe(ApprovalInstanceStateEnum.CANCELLED);
      expect(cancelled.businessKey).toBe('PO-2026-001');
    });

    it('looks an instance up by template and trimmed business key', async (): Promise<void> => {
      const fixture = createPublishedFixture({
        processBusinessKey: 'PO-2026-001',
      });

      const found = await fixture.service.findApprovalInstanceByBusinessKey(
        TEMPLATE_UUID,
        ' PO-2026-001 ',
      );

      expect(found?.businessKey).toBe('PO-2026-001');
      expect(fixture.rootInstanceFindOne).toHaveBeenCalledWith({
        where: { businessKey: 'PO-2026-001', templateId: TEMPLATE_UUID },
      });
    });

    it('returns null when no instance has the business key', async (): Promise<void> => {
      const fixture = createPublishedFixture();

      fixture.rootInstanceFindOne.mockResolvedValueOnce(null);

      await expect(
        fixture.service.findApprovalInstanceByBusinessKey(
          TEMPLATE_UUID,
          'PO-404',
        ),
      ).resolves.toBeNull();
    });

    it('returns null without querying when the template id is not a uuid', async (): Promise<void> => {
      const fixture = createPublishedFixture();

      await expect(
        fixture.service.findApprovalInstanceByBusinessKey(
          'template-1',
          'PO-1',
        ),
      ).resolves.toBeNull();
      expect(fixture.rootInstanceFindOne).not.toHaveBeenCalled();
    });

    it('does not query for a blank or over-long business key', async (): Promise<void> => {
      const fixture = createPublishedFixture();

      await expect(
        fixture.service.findApprovalInstanceByBusinessKey(TEMPLATE_UUID, '  '),
      ).resolves.toBeNull();
      await expect(
        fixture.service.findApprovalInstanceByBusinessKey(
          TEMPLATE_UUID,
          'k'.repeat(201),
        ),
      ).resolves.toBeNull();
      expect(fixture.rootInstanceFindOne).not.toHaveBeenCalled();
    });
  });

  it('rejects submit when the template has no published current version', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: null,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Approval template does not have a published version');
  });

  it('rejects submit when the template is deactivated', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateIsActive: false,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"amount":1000}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Approval template is deactivated');
  });

  it('rejects resubmit when the template is deactivated', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      templateIsActive: false,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"amount":1000}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Approval template is deactivated');
  });

  it('rejects submit when required form fields are missing', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createRequiredReasonFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Form data is missing required fields: 事由');
  });

  it('requires conditional fields only when their condition is visible and required', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createConditionalAttachmentFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"needsAttachment":false}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).resolves.toMatchObject({ id: 'instance-1' });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"needsAttachment":true}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Form data is missing required fields: 附件');
  });

  it('does not require a hidden field and keeps its submitted value', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: {
        fields: [
          { fieldKey: 'reason', label: '事由', required: false, type: 'text' },
          // `required: true` is rejected by the schema lint; the engine still
          // treats a hidden field as not visible, so it can never be "missing".
          {
            fieldKey: 'sourceDocId',
            hidden: true,
            label: '來源單據',
            required: true,
            type: 'text',
          },
        ],
        schemaVersion: 1,
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"reason":"r"}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).resolves.toMatchObject({ id: 'instance-1' });

    const withValue = await fixture.service.submitApprovalInstance({
      formDataJson: '{"reason":"r","sourceDocId":"PO-1"}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      templateId: 'template-1',
      title: 'Request',
    });

    expect(withValue.formDataJson).toBe('{"reason":"r","sourceDocId":"PO-1"}');
  });

  describe('hidden table field', () => {
    const submit = (
      hiddenSchema: FormDefinitionSchema,
      formDataJson: string,
    ): Promise<unknown> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formSchema: hiddenSchema,
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      }).service.submitApprovalInstance({
        formDataJson,
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      });

    it('still rejects a value that is not an array of rows', async (): Promise<void> => {
      await expect(
        submit(
          createTableFormSchema({ hidden: true }),
          '{"items":{"name":"Bolt"}}',
        ),
      ).rejects.toThrow('formData.items must be an array of rows');
    });

    it('still rejects a malformed row and rows over maxRows', async (): Promise<void> => {
      await expect(
        submit(createTableFormSchema({ hidden: true }), '{"items":["junk"]}'),
      ).rejects.toThrow('formData.items[0] must be an object');
      await expect(
        submit(
          createTableFormSchema({ hidden: true, maxRows: 1 }),
          '{"items":[{"name":"a","qty":1},{"name":"b","qty":2}]}',
        ),
      ).rejects.toThrow('formData.items must include at most 1 row(s)');
    });

    it('is not required even when declared required', async (): Promise<void> => {
      await expect(
        submit(createTableFormSchema({ hidden: true, required: true }), '{}'),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });

    it('needs no minimum rows', async (): Promise<void> => {
      await expect(
        submit(createTableFormSchema({ hidden: true, minRows: 2 }), '{}'),
      ).resolves.toMatchObject({ id: 'instance-1' });
      await expect(
        submit(
          createTableFormSchema({ hidden: true, minRows: 2 }),
          '{"items":[{"name":"a","qty":1}]}',
        ),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });

    it('needs no per-column required cells', async (): Promise<void> => {
      await expect(
        submit(
          createTableFormSchema({ hidden: true }),
          '{"items":[{"tags":["a"]}]}',
        ),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });

    // Hidden wins over visibleWhen: a false condition only makes an ordinary
    // table skip its checks, a hidden one is still held to its shape.
    it('is still shape-checked when visibleWhen is false', async (): Promise<void> => {
      const schema: FormDefinitionSchema = {
        fields: [
          {
            fieldKey: 'needsItems',
            label: '需要明細',
            required: false,
            type: 'boolean',
          },
          {
            columns: createTableColumns(),
            fieldKey: 'items',
            hidden: true,
            label: '請購明細',
            maxRows: 1,
            required: false,
            type: 'table',
            visibleWhen: 'form.needsItems == true',
          },
        ],
        schemaVersion: 1,
      };

      await expect(
        submit(schema, '{"needsItems":false,"items":{"name":"Bolt"}}'),
      ).rejects.toThrow('formData.items must be an array of rows');
      await expect(
        submit(
          schema,
          '{"needsItems":false,"items":[{"name":"a","qty":1},{"name":"b","qty":2}]}',
        ),
      ).rejects.toThrow('formData.items must include at most 1 row(s)');
      await expect(
        submit(schema, '{"needsItems":false}'),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });
  });

  // The DYNAMIC_FORM publish lint relies on this: a required, always-visible
  // member field cannot reach the engine without at least one member id.
  it('never accepts a required member field that names nobody', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: {
        fields: [
          { fieldKey: 'owner', label: '負責人', required: true, type: 'member' },
          {
            fieldKey: 'reviewers',
            label: '審閱者',
            multiple: true,
            required: true,
            type: 'member',
          },
        ],
        schemaVersion: 1,
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const submit = (formData: Readonly<Record<string, unknown>>): Promise<unknown> =>
      fixture.service.submitApprovalInstance({
        formDataJson: JSON.stringify(formData),
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      });

    await expect(submit({ owner: '', reviewers: ['m2'] })).rejects.toThrow(
      'Form data is missing required fields: 負責人',
    );
    await expect(submit({ owner: '  ', reviewers: ['m2'] })).rejects.toThrow(
      'Form data is missing required fields: 負責人',
    );
    await expect(submit({ owner: 'm1', reviewers: [] })).rejects.toThrow(
      'Form data is missing required fields: 審閱者',
    );
    await expect(submit({ owner: 'm1', reviewers: [''] })).rejects.toThrow(
      'formData.reviewers must be an array of member ids',
    );
    await expect(
      submit({ owner: 'm1', reviewers: ['m2'] }),
    ).resolves.toMatchObject({ id: 'instance-1' });
  });

  it('rejects a submitted member value that is not a member id (or an array of ids when multiple)', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: {
        fields: [
          {
            fieldKey: 'owner',
            label: '負責人',
            required: false,
            type: 'member',
          },
          {
            fieldKey: 'reviewers',
            label: '審閱者',
            multiple: true,
            required: false,
            type: 'member',
          },
        ],
        schemaVersion: 1,
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const submit = (formData: Readonly<Record<string, unknown>>): Promise<unknown> =>
      fixture.service.submitApprovalInstance({
        formDataJson: JSON.stringify(formData),
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      });

    await expect(submit({ owner: ['member-002'] })).rejects.toThrow(
      'formData.owner must be a member id',
    );
    await expect(
      submit({ owner: 'member-002', reviewers: ['member-003', 7] }),
    ).rejects.toThrow('formData.reviewers must be an array of member ids');
    await expect(
      submit({ owner: 'member-002', reviewers: ['member-003', 'member-004'] }),
    ).resolves.toMatchObject({ id: 'instance-1' });
  });

  it('shape-checks a hidden member field that still holds a value', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: {
        fields: [
          {
            fieldKey: 'needsReviewer',
            label: '需要審核人',
            required: false,
            type: 'boolean',
          },
          {
            fieldKey: 'reviewer',
            label: '審核人',
            required: true,
            type: 'member',
            visibleWhen: 'form.needsReviewer == true',
          },
        ],
        schemaVersion: 1,
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const submit = (formData: Readonly<Record<string, unknown>>): Promise<unknown> =>
      fixture.service.submitApprovalInstance({
        formDataJson: JSON.stringify(formData),
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      });

    await expect(
      submit({ needsReviewer: false, reviewer: 7 }),
    ).rejects.toThrow('formData.reviewer must be a member id');
    // A hidden field that is blank / absent is not required and not checked.
    await expect(
      submit({ needsReviewer: false, reviewer: '' }),
    ).resolves.toMatchObject({ id: 'instance-1' });
  });

  it('rejects resubmit when returned instance form data is missing required fields', async (): Promise<void> => {
    const formSchema = createRequiredReasonFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormDefinitionSnapshot: { schema: formSchema },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Form data is missing required fields: 事由');
  });

  it('accepts a table submission that satisfies shape, row bounds and per-row required columns', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const instance = await fixture.service.submitApprovalInstance({
      formDataJson:
        '{"items":[{"name":"Bolt","qty":3,"tags":["a"]},{"name":"Nut","qty":1}]}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      templateId: 'template-1',
      title: 'Request',
    });

    expect(instance.formData).toEqual({
      items: [
        { name: 'Bolt', qty: 3, tags: ['a'] },
        { name: 'Nut', qty: 1 },
      ],
    });
  });

  it('rejects a table value that is not an array of rows', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":{"name":"Bolt"}}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must be an array of rows');
  });

  it('rejects a table row that is not an object', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{"name":"Bolt","qty":1},["Nut"]]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[1] must be an object');
  });

  it('rejects a table row carrying a key that is not a column', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{"name":"Bolt","qty":1,"secret":"x"}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[0].secret is not a table column');
  });

  it('rejects a cell value that is not a primitive', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{"name":{"nested":true},"qty":1}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[0].name is not a valid cell value');
  });

  it('names the row and column of a missing required cell', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{"name":"Bolt","qty":3},{"name":"Nut"}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[1].qty is required');
  });

  // `constructor` and `toString` satisfy the column key identifier rule, so a
  // plain `row[columnKey]` read walked the prototype chain and reported an
  // empty row as filled.
  it('does not read a required cell off the row prototype', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: {
        fields: [
          {
            columns: [
              {
                fieldKey: 'constructor',
                label: '建構',
                required: true,
                type: 'text',
              },
              {
                fieldKey: 'toString',
                label: '字串',
                required: true,
                type: 'text',
              },
            ],
            fieldKey: 'items',
            label: '明細',
            required: false,
            type: 'table',
          },
        ],
        schemaVersion: 1,
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[0].constructor is required');
  });

  it('rejects a required table submitted with no rows', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema({ required: true }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at least 1 row(s)');
  });

  it('rejects a required table that is absent from the submitted data', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema({ required: true }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at least 1 row(s)');
  });

  it('enforces minRows even when the table itself is optional', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema({ minRows: 2 }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"items":[{"name":"Bolt","qty":1}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at least 2 row(s)');
  });

  it('rejects a table submitted with more rows than maxRows', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema({ maxRows: 2 }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson:
          '{"items":[{"name":"a","qty":1},{"name":"b","qty":2},{"name":"c","qty":3}]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at most 2 row(s)');
  });

  it('caps rows at the hard ceiling when the table declares no maxRows', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      name: `item-${index}`,
      qty: 1,
    }));

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: JSON.stringify({ items: rows }),
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at most 100 row(s)');
  });

  it('skips table validation for a table hidden by its visibility condition', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formSchema: createConditionalTableFormSchema(),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"needsItems":false}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).resolves.toMatchObject({ id: 'instance-1' });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{"needsItems":true}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items must include at least 1 row(s)');
  });

  it('validates table form data on resubmit as well', async (): Promise<void> => {
    const formSchema = createTableFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      processFormDefinitionSnapshot: { schema: formSchema },
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.resubmitApprovalInstance({
        formDataJson: '{"items":[{"name":"Bolt"}]}',
        initiatorMemberId: 'member-001',
        instanceId: 'instance-1',
        title: 'Request',
      }),
    ).rejects.toThrow('formData.items[0].qty is required');
  });

  it('leaves a table untouched when a set-form-field task addresses a cell path', async (): Promise<void> => {
    const formSchema = createTableFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { items: [{ name: 'Bolt', qty: 3 }] },
      processFormDefinitionSnapshot: { schema: formSchema },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.items.qty',
        value: '99',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    // A `{}` substitution would have replaced the row array with `{ qty: 99 }`.
    expect(fixture.savedInstance).toMatchObject({
      formData: { items: [{ name: 'Bolt', qty: 3 }] },
    });
  });

  // `items[0].qty` splits into the literal segment `items[0]`, which used to be
  // created as a brand new top-level key — polluting the CEL context and making
  // `readValueAtPath` start answering for a path it must never resolve.
  it('leaves form data untouched when a set-form-field path indexes a row', async (): Promise<void> => {
    const formSchema = createTableFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { items: [{ name: 'Bolt', qty: 3 }] },
      processFormDefinitionSnapshot: { schema: formSchema },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.items[0].qty',
        value: '99',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance?.formData).toEqual({
      items: [{ name: 'Bolt', qty: 3 }],
    });
  });

  it('leaves a scalar untouched when a set-form-field task writes through it', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.amount.currency',
        value: '"TWD"',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance).toMatchObject({ formData: { amount: 1200 } });
  });

  it('still creates a nested object when a set-form-field task writes to an absent path', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.audit.level',
        value: '"L2"',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance).toMatchObject({
      formData: { amount: 1200, audit: { level: 'L2' } },
    });
  });

  it('uses an advisory lock when processing an instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['instance-1'],
    );
    expect(fixture.savedProcessLog?.eventType).toBe(
      ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
    );
  });

  it('advances a start token and creates a direct user task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedProcessToken).toMatchObject({
      currentNodeId: 'task_finance',
      status: WorkflowTokenStatusEnum.WAITING,
    });
    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-finance',
        instanceId: 'instance-1',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
    ]);
    expect(fixture.savedSingleActivityLogs.map((log) => log.eventType)).toEqual(
      [
        ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
        ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        ActivityLogEventTypeEnum.TASK_CREATED,
      ],
    );
    expect(
      fixture.notificationService.createTaskAssignedNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: expect.objectContaining({ id: 'instance-1' }),
        node: expect.objectContaining({ id: 'task_finance' }),
        task: expect.objectContaining({ assigneeMemberId: 'member-finance' }),
      }),
    );
  });

  it('sets task SLA due time from user task SLA config', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        slaDuration: 'PT2H',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]?.slaDueAt).toBeInstanceOf(Date);
  });

  it('creates notifications from notify service task recipients', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createNotifyServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.notificationService.createServiceTaskNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: expect.objectContaining({ id: 'instance-1' }),
        node: expect.objectContaining({ id: 'notify_finance' }),
        recipientMemberIds: ['member-finance', 'member-admin'],
      }),
    );
    expect(fixture.savedSingleActivityLogs.at(-1)).toMatchObject({
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      payload: expect.objectContaining({
        action: 'NOTIFY',
        recipientMemberIds: ['member-finance', 'member-admin'],
      }),
    });
  });

  it('queues notify webhooks in the engine transaction and records their ids', async (): Promise<void> => {
    const enqueueNotifyWebhooks = jest.fn(
      async (): Promise<readonly string[]> => ['delivery-1'],
    );
    const webhooks = [
      {
        bindings: [],
        endpoint: { key: 'erp.purchase-approved', version: 1 },
        id: 'webhook_erp',
      },
    ];
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createNotifyServiceTaskWorkflow({
        recipients: { memberIds: [], type: 'DIRECT' },
        webhooks,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      webhookDeliveryService: {
        enqueueNotifyWebhooks,
      } as unknown as WorkflowWebhookDeliveryService,
    });

    await fixture.service.processInstance('instance-1');

    expect(enqueueNotifyWebhooks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instance: expect.objectContaining({ id: 'instance-1' }),
        node: { id: 'notify_finance', label: '財務知會' },
        tokenId: expect.any(String),
      }),
      webhooks,
    );
    expect(fixture.savedSingleActivityLogs.at(-1)).toMatchObject({
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      payload: expect.objectContaining({
        action: 'NOTIFY',
        webhookDeliveryIds: ['delivery-1'],
      }),
    });
  });

  it('does not touch webhook delivery for a notify node without webhooks', async (): Promise<void> => {
    const enqueueNotifyWebhooks = jest.fn();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createNotifyServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      webhookDeliveryService: {
        enqueueNotifyWebhooks,
      } as unknown as WorkflowWebhookDeliveryService,
    });

    await fixture.service.processInstance('instance-1');

    expect(enqueueNotifyWebhooks).not.toHaveBeenCalled();
    expect(fixture.savedSingleActivityLogs.at(-1)?.payload).not.toHaveProperty(
      'webhookDeliveryIds',
    );
  });

  it('skips member resolution for a webhook-only notify node', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createNotifyServiceTaskWorkflow({
        recipients: { memberIds: [], type: 'DIRECT' },
        webhooks: [
          {
            bindings: [],
            endpoint: { key: 'erp.purchase-approved', version: 1 },
            id: 'webhook_erp',
          },
        ],
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.notificationService.createServiceTaskNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ recipientMemberIds: [] }),
    );
    expect(fixture.savedSingleActivityLogs.at(-1)).toMatchObject({
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      payload: expect.objectContaining({
        action: 'NOTIFY',
        recipientMemberIds: [],
      }),
    });
  });

  it('still fails a notify node that names nobody and has no webhooks', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createNotifyServiceTaskWorkflow({
        recipients: { memberIds: [], type: 'DIRECT' },
        webhooks: [],
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '知會節點「財務知會」 找不到通知對象',
    );
  });

  describe('NOTIFY node skipped by its entry condition', (): void => {
    const skippedFormData = { amount: 100 };
    const matchedFormData = { amount: 5000 };

    it('consumes the token instead of demanding an outgoing edge and sends nothing', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: skippedFormData,
        processWorkflowSnapshot: createEntryConditionNotifyWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.notificationService.createServiceTaskNotifications,
      ).not.toHaveBeenCalled();
      expect(fixture.savedWorkflowTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            consumedAt: expect.any(Date),
            currentNodeId: 'notify_finance',
            status: WorkflowTokenStatusEnum.CONSUMED,
          }),
        ]),
      );

      const skipLog = fixture.savedSingleActivityLogs.find(
        (log) =>
          log.nodeId === 'notify_finance' &&
          log.payload?.skippedByEntryCondition === true,
      );

      expect(skipLog).toMatchObject({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        payload: {
          consumed: true,
          skippedByEntryCondition: true,
          tokenId: expect.any(String),
        },
        taskId: null,
      });
      expect(skipLog?.payload).not.toHaveProperty('action');
    });

    it('completes the instance when the skipped notify was its only remaining branch', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: skippedFormData,
        processWorkflowSnapshot: createEntryConditionNotifyWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedInstance).toMatchObject({
        completedAt: expect.any(Date),
        state: ApprovalInstanceStateEnum.APPROVED,
      });
    });

    it('keeps the instance running while another branch is still open', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: skippedFormData,
        processWorkflowSnapshot: createEntryConditionNotifyWorkflow({
          withApprovalBranch: true,
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks).toEqual([
        expect.objectContaining({
          nodeId: 'task_a',
          status: TaskStatusEnum.PENDING,
        }),
      ]);
      expect(fixture.savedInstance?.state).not.toBe(
        ApprovalInstanceStateEnum.APPROVED,
      );
      expect(fixture.savedWorkflowTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currentNodeId: 'notify_finance',
            status: WorkflowTokenStatusEnum.CONSUMED,
          }),
          expect.objectContaining({
            currentNodeId: 'task_a',
            status: WorkflowTokenStatusEnum.WAITING,
          }),
        ]),
      );
    });

    it('still sends the notification when the entry condition holds', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: matchedFormData,
        processWorkflowSnapshot: createEntryConditionNotifyWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.notificationService.createServiceTaskNotifications,
      ).toHaveBeenCalledTimes(1);

      const notifyLog = fixture.savedSingleActivityLogs.find(
        (log) =>
          log.nodeId === 'notify_finance' && log.payload?.action === 'NOTIFY',
      );

      expect(notifyLog?.payload).toMatchObject({ action: 'NOTIFY' });
      expect(notifyLog?.payload).not.toHaveProperty('skippedByEntryCondition');
      expect(notifyLog?.payload).not.toHaveProperty('consumed');
    });

    it('still advances a skipped non-NOTIFY service task along its outgoing edge', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: skippedFormData,
        processWorkflowSnapshot: createEntryConditionWebhookWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      await fixture.service.processInstance('instance-1');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) =>
            log.nodeId === 'webhook_erp' &&
            log.payload?.skippedByEntryCondition === true,
        )?.payload,
      ).toEqual({
        skippedByEntryCondition: true,
        tokenId: expect.any(String),
      });
      expect(fixture.savedWorkflowTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currentNodeId: 'end',
            status: WorkflowTokenStatusEnum.CONSUMED,
          }),
        ]),
      );
      expect(fixture.savedInstance).toMatchObject({
        state: ApprovalInstanceStateEnum.APPROVED,
      });

      fetchSpy.mockRestore();
    });

    it('lets a parallel split proceed to its AND join when one branch is a skipped NOTIFY', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: skippedFormData,
        processWorkflowSnapshot: createSplitWithSkippedNotifyWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      const taskA = readTaskByNodeId(fixture.savedTasks, 'task_a');
      const taskB = readTaskByNodeId(fixture.savedTasks, 'task_b');

      expect(
        fixture.savedWorkflowTokens.find(
          (token) => token.currentNodeId === 'notify_finance',
        ),
      ).toMatchObject({ status: WorkflowTokenStatusEnum.CONSUMED });
      expect(fixture.savedInstance?.state).not.toBe(
        ApprovalInstanceStateEnum.APPROVED,
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: null,
        decidedByMemberId: taskA.assigneeMemberId ?? '',
        taskId: taskA.id,
      });

      expect(fixture.savedInstance?.state).not.toBe(
        ApprovalInstanceStateEnum.APPROVED,
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: null,
        decidedByMemberId: taskB.assigneeMemberId ?? '',
        taskId: taskB.id,
      });

      expect(
        fixture.savedTasks.some((task) => task.nodeId === 'task_final'),
      ).toBe(true);
      expect(
        fixture.savedWorkflowTokens.filter(
          (token) =>
            token.status === WorkflowTokenStatusEnum.ACTIVE ||
            token.status === WorkflowTokenStatusEnum.WAITING,
        ),
      ).toEqual([
        expect.objectContaining({ currentNodeId: 'task_final' }),
      ]);
    });

    it('records a skipped step and ends the dry run branch at a NOTIFY node whose entry condition fails', (): void => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      const result = fixture.service.dryRunApprovalWorkflow({
        formDataJson: JSON.stringify(skippedFormData),
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        workflowDefinitionJson: JSON.stringify(
          createEntryConditionNotifyWorkflow({ withApprovalBranch: true }),
        ),
      });

      expect(result.errors).toEqual([]);
      expect(
        result.steps.map((step) => [step.nodeId, step.status]),
      ).toEqual([
        ['start', 'PASSED'],
        ['notify_finance', 'SKIPPED'],
        ['task_a', 'WAITING'],
        ['end', 'COMPLETED'],
      ]);
    });
  });

  it('records webhook failures and continues processing', async (): Promise<void> => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('remote failure', { status: 500 }));
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createWebhookServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/workflow-hook',
      expect.objectContaining({
        body: expect.stringContaining('"title":"費用申請"'),
        method: 'POST',
      }),
    );
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
        payload: expect.objectContaining({
          action: 'WEBHOOK',
          ok: false,
          status: 500,
        }),
      }),
    );
    expect(fixture.savedInstance).toMatchObject({
      completedAt: expect.any(Date),
      state: ApprovalInstanceStateEnum.APPROVED,
    });

    fetchSpy.mockRestore();
  });

  it('uses the injected workflow service task dispatcher for webhook nodes', async (): Promise<void> => {
    const serviceTaskDispatcher: BPMWorkflowServiceTaskDispatcher = {
      dispatchWebhook: jest.fn(() =>
        Promise.resolve({ ok: true, status: 202 }),
      ),
    };
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1000 },
      processWorkflowSnapshot: createWebhookServiceTaskWorkflow(),
      serviceTaskDispatcher,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(serviceTaskDispatcher.dispatchWebhook).toHaveBeenCalledWith({
      headers: undefined,
      payload: { amount: 1000, title: '費用申請' },
      url: 'https://example.test/workflow-hook',
    });
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED,
        payload: expect.objectContaining({
          action: 'WEBHOOK',
          ok: true,
          status: 202,
        }),
      }),
    );
  });

  it('updates form data from set-form-field service tasks', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED,
        payload: expect.objectContaining({
          action: 'SET_FORM_FIELD',
          fieldPath: 'form.approvalLevel',
        }),
      }),
    );
    expect(fixture.savedInstance).toMatchObject({
      formData: { amount: 1200, approvalLevel: '主管簽核' },
      state: ApprovalInstanceStateEnum.APPROVED,
    });
  });

  it('drops a stale option snapshot when a service task overwrites a dynamic field', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      processOptionSnapshot: {
        costCenter: {
          bindingHash: 'binding-hash-1',
          dataSourceKey: 'demo.cost-centers',
          dataSourceVersion: 1,
          options: [{ label: 'Cost center TPE', value: 'CC-001' }],
          validatedAt: '2026-08-12T09:00:00.000Z',
        },
      },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.costCenter',
        value: '"CC-999"',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    // Keeping the old snapshot would label CC-999 as "Cost center TPE".
    // `toEqual` matters here: `toMatchObject({})` passes for any object.
    expect(fixture.savedInstance?.formDataOptionSnapshot).toEqual({});
    expect(fixture.savedInstance).toMatchObject({
      formData: { costCenter: 'CC-999', plant: 'TPE' },
    });
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'SET_FORM_FIELD',
          clearedOptionSnapshot: 'costCenter',
        }),
      }),
    );
  });

  it('runs a service task on an instance whose form snapshot cannot be parsed', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processFormDefinitionSnapshot: { schema: 'not-a-schema' },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance).toMatchObject({
      formData: { amount: 1200, approvalLevel: '主管簽核' },
      state: ApprovalInstanceStateEnum.APPROVED,
    });
  });

  it('still prunes a valid dynamic field beside a malformed sibling entry', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema();
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: {
        schema: { ...formSchema, fields: [null, ...formSchema.fields] },
      },
      processOptionSnapshot: {
        costCenter: {
          bindingHash: 'binding-hash-1',
          dataSourceKey: 'demo.cost-centers',
          dataSourceVersion: 1,
          options: [{ label: 'Cost center TPE', value: 'CC-001' }],
          validatedAt: '2026-08-12T09:00:00.000Z',
        },
      },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.costCenter',
        value: '"CC-999"',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance?.formDataOptionSnapshot).toEqual({});
  });

  it('survives a snapshot whose field list holds malformed entries', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processFormDefinitionSnapshot: {
        schema: { fields: [null, 'nonsense'], schemaVersion: 1 },
      },
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance).toMatchObject({
      formData: { amount: 1200, approvalLevel: '主管簽核' },
      state: ApprovalInstanceStateEnum.APPROVED,
    });
  });

  it('keeps option snapshots when a service task writes a static field', async (): Promise<void> => {
    const formSchema = createDynamicOptionFormSchema();
    const snapshot = {
      costCenter: {
        bindingHash: 'binding-hash-1',
        dataSourceKey: 'demo.cost-centers',
        dataSourceVersion: 1,
        options: [{ label: 'Cost center TPE', value: 'CC-001' }],
        validatedAt: '2026-08-12T09:00:00.000Z',
      },
    };
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { costCenter: 'CC-001', plant: 'TPE' },
      processFormDefinitionSnapshot: { schema: formSchema },
      processOptionSnapshot: snapshot,
      processWorkflowSnapshot: createSetFormFieldServiceTaskWorkflow({
        fieldPath: 'form.plant',
        value: '"HKG"',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedInstance?.formDataOptionSnapshot).toEqual(snapshot);
  });

  it('resolves a user task assignee from a selected position', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processMemberships: [
        createMembership({
          isPrimary: true,
          memberId: 'member-position-owner',
          positionId: 'position-finance',
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          positionId: 'position-finance',
          type: 'POSITION',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-position-owner',
      originalAssigneeMemberId: 'member-position-owner',
    });
  });

  it('resolves a user task assignee from the initiator organization manager', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          managerMemberId: 'member-manager',
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({
          id: 'org-finance',
          path: 'org.finance',
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-manager',
      originalAssigneeMemberId: 'member-manager',
    });
  });

  describe('organization time zone', () => {
    // 01:00 on 2026-10-14 in Asia/Taipei, still 2026-10-13 in UTC.
    const taipeiEarlyMorning = new Date('2026-10-13T17:00:00.000Z');

    afterEach((): void => {
      jest.useRealTimers();
    });

    const useClock = (now: Date): void => {
      // Only `Date` is faked: the fixture awaits real promises.
      jest.useFakeTimers({
        doNotFake: [
          'cancelAnimationFrame',
          'cancelIdleCallback',
          'clearImmediate',
          'clearInterval',
          'clearTimeout',
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'requestAnimationFrame',
          'requestIdleCallback',
          'setImmediate',
          'setInterval',
          'setTimeout',
        ],
        now,
      });
    };

    const createPositionFixture = (
      rootOptions?: BPMRootRuntimeOptions,
    ): ReturnType<typeof createServiceFixture> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processMemberships: [
          createMembership({
            effectiveFrom: '2026-10-14',
            isPrimary: true,
            memberId: 'member-position-owner',
            positionId: 'position-finance',
          }),
        ],
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            positionId: 'position-finance',
            type: 'POSITION',
          },
        }),
        rootOptions,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

    const createManagerFixture = (
      rootOptions?: BPMRootRuntimeOptions,
    ): ReturnType<typeof createServiceFixture> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processManagerResolutions: [
          createManagerResolution({
            effectiveFrom: '2026-10-14',
            managerMemberId: 'member-manager',
            scopeId: 'org-finance',
            scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
          }),
        ],
        processMemberships: [
          createMembership({
            memberId: 'member-001',
            orgUnitId: 'org-finance',
          }),
        ],
        processOrgUnits: [
          createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
        ],
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
        rootOptions,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

    it('uses a membership effective today from local midnight by default', async (): Promise<void> => {
      useClock(taipeiEarlyMorning);
      const fixture = createPositionFixture();

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-position-owner',
      });
    });

    it('reads the UTC date for a membership when the zone is UTC', async (): Promise<void> => {
      useClock(taipeiEarlyMorning);
      const fixture = createPositionFixture({ organizationTimeZone: 'UTC' });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('目前沒有任何有效成員');
      expect(fixture.savedTasks).toHaveLength(0);
    });

    it('uses a manager rule effective today from local midnight by default', async (): Promise<void> => {
      useClock(taipeiEarlyMorning);
      const fixture = createManagerFixture();

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-manager',
      });
    });

    it('reads the UTC date for a manager rule when the zone is UTC', async (): Promise<void> => {
      useClock(taipeiEarlyMorning);
      const fixture = createManagerFixture({ organizationTimeZone: 'UTC' });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('找不到發起人的第 1 層主管');
      expect(fixture.savedTasks).toHaveLength(0);
    });

    describe('ORG_MANAGER_CHAIN', () => {
      const createChainFixture = (
        rootOptions?: BPMRootRuntimeOptions,
      ): ReturnType<typeof createServiceFixture> =>
        createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          ...createManagerChainOrg({
            grades: { 'member-m1': 3 },
            links: [],
          }),
          processManagerResolutions: [
            createManagerResolution({
              effectiveFrom: '2026-10-14',
              managerMemberId: 'member-m1',
              scopeId: 'member-001',
              scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
            }),
          ],
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            approverResolver: {
              minPositionLevel: 3,
              type: 'ORG_MANAGER_CHAIN',
            },
            decisionPolicy: { type: 'SEQUENTIAL' },
          }),
          rootOptions,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

      it('walks a manager rule effective today from local midnight by default', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = createChainFixture();

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-m1']);
      });

      it('does not walk that rule yet when the zone is UTC', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = createChainFixture({ organizationTimeZone: 'UTC' });

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow(ConflictException);
        expect(fixture.savedTaskCandidates).toHaveLength(0);
      });
    });

    describe('org-unit resolvers and the initiator manager', () => {
      const createOrgUnitFixture = (
        approverResolver: ApproverResolver,
        rootOptions?: BPMRootRuntimeOptions,
        excludeInitiator?: ExcludeInitiatorConfig,
      ): ReturnType<typeof createServiceFixture> =>
        createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          processManagerResolutions: [
            createManagerResolution({
              effectiveFrom: '2026-10-14',
              managerMemberId: 'member-manager',
              scopeId: 'org-finance',
              scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
            }),
          ],
          processMemberships: [
            createMembership({
              effectiveFrom: '2026-10-14',
              id: 'membership-owner',
              memberId: 'member-owner',
              orgUnitId: 'org-ops',
              positionId: 'position-finance',
            }),
            createMembership({
              id: 'membership-initiator',
              memberId: 'member-001',
              orgUnitId: 'org-finance',
            }),
          ],
          processOrgUnits: [
            createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
            createOrgUnit({ code: 'OPS', id: 'org-ops', path: 'org.ops' }),
          ],
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            approverResolver,
            excludeInitiator,
          }),
          rootOptions,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

      const cases: readonly [string, ApproverResolver, string, string][] = [
        [
          'ORG_UNIT_MEMBER',
          { orgUnitId: 'org-ops', type: 'ORG_UNIT_MEMBER' },
          'member-owner',
          '組織「財務部」目前沒有任何有效成員',
        ],
        [
          'ORG_UNIT_POSITION',
          {
            orgUnitId: 'org-ops',
            positionId: 'position-finance',
            type: 'ORG_UNIT_POSITION',
          },
          'member-owner',
          '組織「財務部」的職位「position-finance」目前沒有任何有效成員',
        ],
        [
          'ORG_UNIT_MANAGER',
          { orgUnitId: 'org-finance', type: 'ORG_UNIT_MANAGER' },
          'member-manager',
          '找不到指定組織的主管規則',
        ],
      ];

      it.each(cases)(
        '%s uses a rule effective today from local midnight by default',
        async (_name, resolver, assignee): Promise<void> => {
          useClock(taipeiEarlyMorning);
          const fixture = createOrgUnitFixture(resolver);

          await fixture.service.processInstance('instance-1');

          expect(fixture.savedTasks[0]).toMatchObject({
            assigneeMemberId: assignee,
          });
        },
      );

      it.each(cases)(
        '%s does not use that rule yet when the zone is UTC',
        async (_name, resolver, _assignee, failure): Promise<void> => {
          useClock(taipeiEarlyMorning);
          const fixture = createOrgUnitFixture(resolver, {
            organizationTimeZone: 'UTC',
          });

          await expect(
            fixture.service.processInstance('instance-1'),
          ).rejects.toThrow(failure);
          expect(fixture.savedTasks).toEqual([]);
        },
      );

      it('hands an excluded initiator to the manager whose rule is effective today', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = createOrgUnitFixture(
          { memberIds: ['member-001'], type: 'DIRECT' },
          undefined,
          { whenEmpty: 'INITIATOR_MANAGER' },
        );

        await fixture.service.processInstance('instance-1');

        expect(fixture.savedTasks[0]).toMatchObject({
          assigneeMemberId: 'member-manager',
        });
      });

      it('finds no initiator manager before the rule is effective when the zone is UTC', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = createOrgUnitFixture(
          { memberIds: ['member-001'], type: 'DIRECT' },
          { organizationTimeZone: 'UTC' },
          { whenEmpty: 'INITIATOR_MANAGER' },
        );

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow('找不到申請人的主管可改派');
      });
    });

    describe('default initiator snapshot', () => {
      const submitWithoutSnapshot = async (
        rootOptions?: BPMRootRuntimeOptions,
      ): Promise<ReturnType<typeof createServiceFixture>> => {
        const fixture = createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          processMemberships: [
            createMembership({
              effectiveFrom: '2026-10-14',
              id: 'membership-sales',
              isPrimary: true,
              orgUnitId: 'org-sales',
              positionId: 'position-manager',
            }),
          ],
          rootOptions,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

        await fixture.service.submitApprovalInstance({
          formDataJson: '{"amount":1000}',
          initiatorMemberId: 'member-001',
          initiatorMetadataSnapshotJson: null,
          templateId: 'template-1',
          title: null,
        });

        return fixture;
      };

      it('includes a membership effective today from local midnight by default', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = await submitWithoutSnapshot();

        expect(fixture.savedInstance?.initiatorMetadataSnapshot).toMatchObject({
          orgUnitIds: ['org-sales'],
          positionId: 'position-manager',
        });
      });

      it('leaves that membership out when the zone is UTC', async (): Promise<void> => {
        useClock(taipeiEarlyMorning);
        const fixture = await submitWithoutSnapshot({
          organizationTimeZone: 'UTC',
        });

        expect(fixture.savedInstance?.initiatorMetadataSnapshot).toMatchObject({
          orgUnitIds: [],
          positionId: null,
        });
      });
    });

    it('rejects an unknown zone when the engine is created', (): void => {
      expect(() =>
        createPositionFixture({ organizationTimeZone: 'Mars/Olympus_Mons' }),
      ).toThrow('organizationTimeZone');
    });
  });

  it('ignores lower-priority manager rules inherited from ancestor org units', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          priority: 10,
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-finance',
          managerMemberId: 'member-manager',
          priority: 100,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-manager',
    });
    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-manager']);
  });

  it('keeps every manager rule that ties on the winning tier', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance-a',
          managerMemberId: 'member-manager-a',
          priority: 100,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-finance-b',
          managerMemberId: 'member-manager-b',
          priority: 100,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          priority: 10,
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId).sort(),
    ).toEqual(['member-manager-a', 'member-manager-b']);
  });

  it('keeps both org-unit tiers when preferClosestOrgUnit is not set', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance',
          managerMemberId: 'member-manager',
          priority: 100,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          priority: 100,
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId).sort(),
    ).toEqual(['member-ceo', 'member-manager']);
  });

  it('keeps only the deepest org unit when preferClosestOrgUnit is enabled', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance',
          managerMemberId: 'member-manager',
          priority: 100,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          priority: 100,
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          preferClosestOrgUnit: true,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-manager']);
  });

  it('keeps sibling org units at the same depth when preferClosestOrgUnit is enabled', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance-a',
          managerMemberId: 'member-manager-a',
          priority: 100,
          scopeId: 'org-finance-a',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-finance-b',
          managerMemberId: 'member-manager-b',
          priority: 100,
          scopeId: 'org-finance-b',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          priority: 100,
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance-a',
        }),
        createMembership({
          memberId: 'member-001',
          orgUnitId: 'org-finance-b',
        }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance-a', path: 'org.finance_a' }),
        createOrgUnit({ id: 'org-finance-b', path: 'org.finance_b' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          preferClosestOrgUnit: true,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId).sort(),
    ).toEqual(['member-manager-a', 'member-manager-b']);
  });

  it('stops with a clear error when the initiator manager cannot be resolved', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '簽核節點「財務簽核」 無法建立待簽任務：找不到發起人的第 1 層主管，且未設定改派固定人。',
    );
  });

  it('uses a fixed fallback assignee when the initiator manager cannot be resolved', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          fallback: {
            memberId: 'member-admin',
            type: 'DIRECT',
          },
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-admin',
      originalAssigneeMemberId: 'member-admin',
    });
  });

  it('rejects self fallback unless the workflow explicitly allows initiator self approval', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          fallback: {
            memberId: 'member-001',
            type: 'DIRECT',
          },
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '改派固定人是申請人本人',
    );
  });

  describe('POSITION fallback', () => {
    const createPositionFallbackFixture = ({
      approverResolver,
      decisionPolicy = { type: 'PARALLEL_ANY' },
      delegationResolution,
      memberships,
    }: {
      readonly approverResolver?: ApproverResolver;
      readonly decisionPolicy?: DecisionPolicy;
      readonly delegationResolution?: Parameters<
        typeof createServiceFixture
      >[0]['delegationResolution'];
      readonly memberships: readonly MembershipEntity[];
    }): ReturnType<typeof createServiceFixture> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        delegationResolution,
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processMemberships: memberships,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: approverResolver ?? {
            baseFromInitiator: true,
            fallback: { positionId: 'position-fallback', type: 'POSITION' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
          decisionPolicy,
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    const holder = (
      value: Partial<MembershipEntity> & { readonly memberId: string },
    ): MembershipEntity =>
      createMembership({
        positionId: 'position-fallback',
        ...value,
      });
    const readCandidateMemberIds = (
      fixture: ReturnType<typeof createServiceFixture>,
    ): readonly string[] =>
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId);

    it('uses the sole holder of the position as the approver', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        decisionPolicy: { type: 'SINGLE' },
        memberships: [holder({ id: 'h1', memberId: 'member-holder' })],
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-holder',
        originalAssigneeMemberId: 'member-holder',
      });
    });

    it('makes every holder a candidate and lets the node policy decide', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        decisionPolicy: { type: 'PARALLEL_ALL' },
        memberships: [
          holder({ id: 'h1', memberId: 'member-holder-a' }),
          holder({ id: 'h2', memberId: 'member-holder-b' }),
        ],
      });

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-holder-a',
        'member-holder-b',
      ]);
    });

    it('orders holders with the primary membership first, then the most recent start', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        decisionPolicy: { type: 'PARALLEL_ANY' },
        memberships: [
          holder({
            effectiveFrom: '2026-01-01',
            id: 'h-old',
            memberId: 'member-old',
          }),
          holder({
            effectiveFrom: '2026-03-01',
            id: 'h-new',
            memberId: 'member-new',
          }),
          holder({
            effectiveFrom: '2026-02-01',
            id: 'h-primary',
            isPrimary: true,
            memberId: 'member-primary',
          }),
        ],
      });

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-primary',
        'member-new',
        'member-old',
      ]);
    });

    it('ignores holders whose membership is not effective today', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        decisionPolicy: { type: 'SINGLE' },
        memberships: [
          holder({
            effectiveTo: '2026-02-01',
            id: 'h-expired',
            memberId: 'member-expired',
          }),
          holder({
            effectiveFrom: '2099-01-01',
            id: 'h-future',
            memberId: 'member-future',
          }),
          holder({ id: 'h-active', memberId: 'member-active' }),
        ],
      });

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual(['member-active']);
    });

    it('rejects when the position has no active holder, the same way NONE does', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        memberships: [],
      });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow(
        '且改派職位「position-fallback」目前沒有任何有效成員。請聯絡流程管理員調整主管規則或模板 fallback。',
      );
      expect(fixture.savedTasks).toEqual([]);
    });

    it('filters out the initiator by default and keeps the other holders', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        memberships: [
          holder({ id: 'h-self', memberId: 'member-001' }),
          holder({ id: 'h-other', memberId: 'member-other' }),
        ],
      });

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual(['member-other']);
    });

    it('rejects when the only holder is the initiator and self approval is not allowed', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        memberships: [holder({ id: 'h-self', memberId: 'member-001' })],
      });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow(
        '改派職位的有效成員只有申請人本人，此節點未允許申請人自簽',
      );
      expect(fixture.savedTasks).toEqual([]);
    });

    it('keeps the initiator when the position fallback allows self approval', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        approverResolver: {
          baseFromInitiator: true,
          fallback: {
            allowInitiatorSelfApproval: true,
            positionId: 'position-fallback',
            type: 'POSITION',
          },
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
        decisionPolicy: { type: 'SINGLE' },
        memberships: [holder({ id: 'h-self', memberId: 'member-001' })],
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-001',
      });
    });

    it('applies delegation to the resolved holder through the usual pipeline', async (): Promise<void> => {
      const fixture = createPositionFallbackFixture({
        decisionPolicy: { type: 'SINGLE' },
        delegationResolution: {
          delegationChain: [
            {
              from: 'member-holder',
              reason: 'ALL',
              ruleId: 'delegation-rule-1',
              to: 'member-deputy',
            },
          ],
          finalAssigneeMemberId: 'member-deputy',
        },
        memberships: [holder({ id: 'h1', memberId: 'member-holder' })],
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-deputy',
        originalAssigneeMemberId: 'member-holder',
      });
    });

    it('works for ORG_UNIT_MANAGER when the unit has no manager rule', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processMemberships: [holder({ id: 'h1', memberId: 'member-holder' })],
        processOrgUnits: [createOrgUnit({ id: 'org-finance' })],
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            fallback: { positionId: 'position-fallback', type: 'POSITION' },
            orgUnitId: 'org-finance',
            type: 'ORG_UNIT_MANAGER',
          },
          decisionPolicy: { type: 'SINGLE' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-holder',
      });
    });

    const createChainFixtureForPositionFallback = (
      holderMemberIds: readonly string[],
    ): ReturnType<typeof createServiceFixture> => {
      const org = createManagerChainOrg({
        extraMemberships: holderMemberIds.map((memberId, index) =>
          holder({ id: `h-${index}`, memberId }),
        ),
        grades: { 'member-m1': 1, 'member-m2': 2 },
        links: [
          ['member-001', 'member-m1'],
          ['member-m1', 'member-m2'],
        ],
      });

      return createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        ...org,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            fallback: { positionId: 'position-fallback', type: 'POSITION' },
            minPositionLevel: 3,
            type: 'ORG_MANAGER_CHAIN',
          },
          decisionPolicy: { type: 'SEQUENTIAL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    };

    it('appends every holder to an ORG_MANAGER_CHAIN that ends below the level', async (): Promise<void> => {
      const fixture = createChainFixtureForPositionFallback([
        'member-holder-a',
        'member-holder-b',
      ]);

      await fixture.service.processInstance('instance-1');

      // The walk ends at member-m2 (below level 3); both holders close the chain.
      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
        'member-holder-a',
        'member-holder-b',
      ]);
    });

    it('does not duplicate a chain member who also holds the fallback position', async (): Promise<void> => {
      const fixture = createChainFixtureForPositionFallback([
        'member-m2',
        'member-holder-b',
      ]);

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
        'member-holder-b',
      ]);
    });
  });

  it('refuses a fallback type this engine does not know with an upgrade hint instead of a TypeError', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          // A definition saved by a newer engine: this engine has no such type.
          fallback: { type: 'FUTURE_KIND' } as unknown as {
            readonly type: 'NONE';
          },
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '此引擎版本不支援改派類型「FUTURE_KIND」',
    );
  });

  it('allows self fallback only when the workflow explicitly allows initiator self approval', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          baseFromInitiator: true,
          fallback: {
            allowInitiatorSelfApproval: true,
            memberId: 'member-001',
            type: 'DIRECT',
          },
          levelsUp: 1,
          type: 'ORG_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-001',
      originalAssigneeMemberId: 'member-001',
    });
  });

  it('drops the initiator from a multi-person user task when excludeInitiator is set', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          memberIds: ['member-001', 'member-other'],
          type: 'DIRECT',
        },
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-other',
      originalAssigneeMemberId: 'member-other',
    });
    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-other']);
  });

  it('keeps the initiator as a candidate when excludeInitiator is not set', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          memberIds: ['member-001', 'member-other'],
          type: 'DIRECT',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-001', 'member-other']);
  });

  it('excludes an approver whose delegate is the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      delegationResolution: {
        delegationChain: [
          {
            from: 'member-finance',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-001',
          },
        ],
        finalAssigneeMemberId: 'member-001',
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '簽核節點「財務簽核」 無法建立待簽任務：解析出的簽核人只剩申請人本人',
    );
    expect(fixture.savedTasks).toEqual([]);
  });

  it('excludes the initiator even when the initiator delegated their seat to someone else', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      delegationResolution: {
        delegationChain: [
          {
            from: 'member-001',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-101',
          },
        ],
        finalAssigneeMemberId: 'member-101',
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '此節點不允許申請人自簽',
    );
    expect(fixture.savedTasks).toEqual([]);
  });

  it('keeps a delegate for the initiator when excludeInitiator is not set', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      delegationResolution: {
        delegationChain: [
          {
            from: 'member-001',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-101',
          },
        ],
        finalAssigneeMemberId: 'member-101',
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-101',
      originalAssigneeMemberId: 'member-001',
    });
  });

  it('fails the node when only the initiator is left and whenEmpty is FAIL', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '簽核節點「財務簽核」 無法建立待簽任務：解析出的簽核人只剩申請人本人（含委派後的代理人），且此節點不允許申請人自簽。',
    );
    expect(fixture.savedTasks).toEqual([]);
  });

  it('hands the task to the initiator manager when whenEmpty is INITIATOR_MANAGER', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          managerMemberId: 'member-manager',
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({ memberId: 'member-001', orgUnitId: 'org-finance' }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-manager',
      originalAssigneeMemberId: 'member-manager',
    });
    expect(fixture.savedTaskCandidates).toEqual([
      expect.objectContaining({
        memberId: 'member-manager',
        sourceType: 'EXCLUDE_INITIATOR_MANAGER',
      }),
    ]);
  });

  it('fails when whenEmpty is INITIATOR_MANAGER and the initiator has no manager', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '找不到申請人的主管可改派',
    );
    expect(fixture.savedTasks).toEqual([]);
  });

  it('skips the node and creates the next task when whenEmpty is SKIP_NODE', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createExcludeInitiatorTwoStepWorkflow({
        whenEmpty: 'SKIP_NODE',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-next',
        nodeId: 'task_next',
      }),
    ]);

    const skipLog = fixture.savedSingleActivityLogs.find(
      (log) => log.payload?.skippedByInitiatorExclusion === true,
    );

    expect(skipLog).toMatchObject({
      actorMemberId: null,
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      nodeId: 'task_finance',
      payload: { skippedByInitiatorExclusion: true, tokenId: 'token-1' },
      taskId: null,
    });
    expect(skipLog?.payload).not.toHaveProperty('action');
  });

  it.each([
    ['initiator first', ['member-001', 'member-x']],
    ['initiator last', ['member-x', 'member-001']],
  ])(
    'keeps the legitimate approver when the initiator delegates to them (%s)',
    async (_order, memberIds): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        delegationResolutionByMember: {
          'member-001': {
            delegationChain: [
              {
                from: 'member-001',
                reason: 'ALL',
                ruleId: 'delegation-rule-1',
                to: 'member-x',
              },
            ],
            finalAssigneeMemberId: 'member-x',
          },
        },
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: { memberIds, type: 'DIRECT' },
          excludeInitiator: { whenEmpty: 'FAIL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-x',
        originalAssigneeMemberId: 'member-x',
      });
      expect(
        fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
      ).toEqual(['member-x']);
    },
  );

  it('drops a candidate whose delegation chain passes through the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      delegationResolution: {
        delegationChain: [
          {
            from: 'member-a',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-001',
          },
          {
            from: 'member-001',
            reason: 'ALL',
            ruleId: 'delegation-rule-2',
            to: 'member-b',
          },
        ],
        finalAssigneeMemberId: 'member-b',
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-a'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(fixture.service.processInstance('instance-1')).rejects.toThrow(
      '此節點不允許申請人自簽',
    );
    expect(fixture.savedTasks).toEqual([]);
  });

  it('caps a COUNT quorum at the approvers left so the task can still complete', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          memberIds: ['member-001', 'member-x'],
          type: 'DIRECT',
        },
        decisionPolicy: {
          threshold: 2,
          thresholdType: 'COUNT',
          type: 'QUORUM',
        },
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0].decisionPolicySnapshot).toEqual({
      threshold: 1,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-x',
      taskId: fixture.savedTasks[0].id,
    });

    // `savedTasks` records every save; the last one for the task is its state.
    const taskId = fixture.savedTasks[0].id;

    expect(
      fixture.savedTasks.filter((task) => task.id === taskId).slice(-1)[0],
    ).toMatchObject({ status: TaskStatusEnum.COMPLETED });
  });

  it('keeps the configured quorum when the node does not exclude the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          memberIds: ['member-001', 'member-x'],
          type: 'DIRECT',
        },
        decisionPolicy: {
          threshold: 2,
          thresholdType: 'COUNT',
          type: 'QUORUM',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0].decisionPolicySnapshot).toEqual({
      threshold: 2,
      thresholdType: 'COUNT',
      type: 'QUORUM',
    });
  });

  it('hands a unit head initiator to the next tier up instead of failing', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance',
          managerMemberId: 'member-001',
          // Outranks the parent unit's rule, so only excluding the initiator
          // before the top-priority tier is chosen reaches the next tier up.
          priority: 10,
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({ memberId: 'member-001', orgUnitId: 'org-finance' }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-ceo',
    });
    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-ceo']);
  });

  it('hands an ordinary initiator to the closest unit manager only', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          id: 'manager-resolution-finance',
          managerMemberId: 'member-manager',
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
        createManagerResolution({
          id: 'manager-resolution-company',
          managerMemberId: 'member-ceo',
          scopeId: 'org-company',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processMemberships: [
        createMembership({ memberId: 'member-001', orgUnitId: 'org-finance' }),
      ],
      processOrgUnits: [
        createOrgUnit({ id: 'org-company', path: 'org' }),
        createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
        excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-manager',
    });
    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-manager']);
  });

  it('treats a null excludeInitiator exactly like an absent one', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: withNodeData(
        createLinearUserTaskWorkflow({
          approverResolver: {
            memberIds: ['member-001', 'member-x'],
            type: 'DIRECT',
          },
        }),
        'task_finance',
        { excludeInitiator: null },
      ),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
    ).toEqual(['member-001', 'member-x']);
  });

  it('creates the task of an excluding node that has no decision policy', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: withNodeData(
        createLinearUserTaskWorkflow({
          approverResolver: {
            memberIds: ['member-001', 'member-x'],
            type: 'DIRECT',
          },
          excludeInitiator: { whenEmpty: 'FAIL' },
        }),
        'task_finance',
        { decisionPolicy: undefined },
      ),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-x',
    });
  });

  it('allows an SLA escalation to transfer to the initiator on an excluding node', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask(
      {
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: null,
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
        transferToMemberId: 'member-001',
      },
      { transferReason: SLA_ESCALATION_DELEGATION_REASON },
    );

    expect(
      fixture.savedTasks.some((task) => task.assigneeMemberId === 'member-001'),
    ).toBe(true);
  });

  it('filters a countersign spawned onto a later excluding node and cancels the directive', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionToken: createWorkflowToken({
        currentNodeId: 'start',
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-seed-1',
          originNodeId: 'task_origin',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-001'],
          },
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks.filter((task) => task.isAdhoc)).toEqual([]);
    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({ nodeId: 'task_finance' }),
    ]);
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        id: 'directive-seed-1',
        status: AdhocDirectiveStatusEnum.CANCELLED,
      }),
    );
  });

  it('leaves a pending countersign directive for the next real task when a node is skipped', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-seed-1',
          originNodeId: 'task_origin',
          status: AdhocDirectiveStatusEnum.PENDING,
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createExcludeInitiatorTwoStepWorkflow({
        whenEmpty: 'SKIP_NODE',
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTasks.filter((task) => task.nodeId === 'task_finance'),
    ).toEqual([]);
    expect(
      fixture.savedTasks.find((task) => task.isAdhoc),
    ).toMatchObject({
      adhocDirectiveId: 'directive-seed-1',
      nodeId: 'task_next',
    });
  });

  it('resolves a user task assignee from a selected organization manager', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processManagerResolutions: [
        createManagerResolution({
          managerMemberId: 'member-org-manager',
          scopeId: 'org-finance',
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        }),
      ],
      processOrgUnits: [
        createOrgUnit({
          id: 'org-finance',
          path: 'org.finance',
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        approverResolver: {
          orgUnitId: 'org-finance',
          type: 'ORG_UNIT_MANAGER',
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks[0]).toMatchObject({
      assigneeMemberId: 'member-org-manager',
      originalAssigneeMemberId: 'member-org-manager',
    });
  });

  describe('submitter exclusion (submittedByMemberId)', () => {
    const SUBMITTER = 'member-assistant';
    const delegateTo = (from: string, to: string): DelegationResolution => ({
      delegationChain: [
        { from, reason: 'ALL', ruleId: 'delegation-rule-submitter', to },
      ],
      finalAssigneeMemberId: to,
    });
    const createFiledFixture = (
      options: Partial<Parameters<typeof createServiceFixture>[0]> & {
        readonly excludeInitiator?: ExcludeInitiatorConfig;
        readonly memberIds?: readonly string[];
      } = {},
    ): ReturnType<typeof createServiceFixture> => {
      const { excludeInitiator, memberIds, ...fixtureOptions } = options;

      return createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            memberIds: memberIds ?? ['member-finance'],
            type: 'DIRECT',
          },
          excludeInitiator,
        }),
        submittedByMemberId: SUBMITTER,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        ...fixtureOptions,
      });
    };

    describe('submitting', () => {
      it('records who filed the document and says so on the started activity', async (): Promise<void> => {
        const fixture = createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

        const instance = await fixture.service.submitApprovalInstance({
          formDataJson: '{}',
          initiatorMemberId: 'member-001',
          initiatorMetadataSnapshotJson: '{}',
          submittedByMemberId: SUBMITTER,
          templateId: 'template-1',
          title: null,
        });

        expect(instance.initiatorMemberId).toBe('member-001');
        expect(instance.submittedByMemberId).toBe(SUBMITTER);
        expect(
          fixture.savedActivityLogs.find(
            (log) =>
              log.eventType === ActivityLogEventTypeEnum.INSTANCE_STARTED,
          )?.payload,
        ).toMatchObject({
          submittedByMemberId: SUBMITTER,
          submittedByName: `name-of-${SUBMITTER}`,
        });
      });

      it('records no submitter name when the initiator submits themselves', async (): Promise<void> => {
        const fixture = createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

        await fixture.service.submitApprovalInstance({
          formDataJson: '{}',
          initiatorMemberId: 'member-001',
          initiatorMetadataSnapshotJson: '{}',
          submittedByMemberId: 'member-001',
          templateId: 'template-1',
          title: null,
        });

        expect(
          fixture.notificationService.readMemberDisplayName,
        ).not.toHaveBeenCalled();
        expect(
          fixture.savedActivityLogs.find(
            (log) =>
              log.eventType === ActivityLogEventTypeEnum.INSTANCE_STARTED,
          )?.payload,
        ).not.toHaveProperty('submittedByName');
      });

      it.each([
        ['absent', undefined],
        ['null', null],
      ])(
        'records the initiator as the submitter when submittedByMemberId is %s',
        async (_label, submittedByMemberId): Promise<void> => {
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });

          const instance = await fixture.service.submitApprovalInstance({
            formDataJson: '{}',
            initiatorMemberId: 'member-001',
            initiatorMetadataSnapshotJson: '{}',
            submittedByMemberId,
            templateId: 'template-1',
            title: null,
          });

          expect(instance.submittedByMemberId).toBe('member-001');
        },
      );

      it.each([[''], ['   ']])(
        'rejects a blank submittedByMemberId (%j)',
        async (submittedByMemberId): Promise<void> => {
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });

          await expect(
            fixture.service.submitApprovalInstance({
              formDataJson: '{}',
              initiatorMemberId: 'member-001',
              initiatorMetadataSnapshotJson: '{}',
              submittedByMemberId,
              templateId: 'template-1',
              title: null,
            }),
          ).rejects.toThrow('submittedByMemberId must be a non-empty string');
          expect(fixture.savedInstance).toBeNull();
        },
      );
    });

    describe('creating tasks', () => {
      it('drops the submitter from a multi-person node', async (): Promise<void> => {
        const fixture = createFiledFixture({
          excludeInitiator: { whenEmpty: 'FAIL' },
          memberIds: [SUBMITTER, 'member-other'],
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-other']);
      });

      it('keeps the submitter when the node does not exclude the initiator', async (): Promise<void> => {
        const fixture = createFiledFixture({
          memberIds: [SUBMITTER, 'member-other'],
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual([SUBMITTER, 'member-other']);
      });

      it('treats a row without a submitter exactly as before', async (): Promise<void> => {
        const fixture = createFiledFixture({
          excludeInitiator: { whenEmpty: 'FAIL' },
          memberIds: [SUBMITTER, 'member-other'],
          submittedByMemberId: null,
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual([SUBMITTER, 'member-other']);
      });

      it('drops an approver whose delegate is the submitter', async (): Promise<void> => {
        const fixture = createFiledFixture({
          delegationResolutionByMember: {
            'member-finance': delegateTo('member-finance', SUBMITTER),
          },
          excludeInitiator: { whenEmpty: 'FAIL' },
        });

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow(
          '簽核節點「財務簽核」 無法建立待簽任務：解析出的簽核人只剩申請人或代為送出此單的人（含委派後的代理人），且此節點不允許申請人或代送人簽核。',
        );
        expect(fixture.savedTasks).toEqual([]);
      });

      it('drops a candidate whose delegation chain passes through the submitter', async (): Promise<void> => {
        const fixture = createFiledFixture({
          delegationResolutionByMember: {
            'member-finance': {
              delegationChain: [
                {
                  from: 'member-finance',
                  reason: 'ALL',
                  ruleId: 'delegation-rule-1',
                  to: SUBMITTER,
                },
                {
                  from: SUBMITTER,
                  reason: 'ALL',
                  ruleId: 'delegation-rule-2',
                  to: 'member-b',
                },
              ],
              finalAssigneeMemberId: 'member-b',
            },
          },
          excludeInitiator: { whenEmpty: 'FAIL' },
        });

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow('此節點不允許申請人或代送人簽核');
      });

      it('still drops the initiator on an instance that has a submitter', async (): Promise<void> => {
        const fixture = createFiledFixture({
          excludeInitiator: { whenEmpty: 'FAIL' },
          memberIds: ['member-001', 'member-other'],
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-other']);
      });

      it('keeps the legitimate approver when the submitter delegates to them', async (): Promise<void> => {
        const fixture = createFiledFixture({
          delegationResolutionByMember: {
            [SUBMITTER]: delegateTo(SUBMITTER, 'member-x'),
          },
          excludeInitiator: { whenEmpty: 'FAIL' },
          memberIds: [SUBMITTER, 'member-x'],
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-x']);
      });

      it('skips the node when only the submitter is left and whenEmpty is SKIP_NODE', async (): Promise<void> => {
        const fixture = createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          processWorkflowSnapshot: createExcludeInitiatorTwoStepWorkflow(
            { whenEmpty: 'SKIP_NODE' },
            SUBMITTER,
          ),
          submittedByMemberId: SUBMITTER,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });

        await fixture.service.processInstance('instance-1');

        expect(fixture.savedTasks).toEqual([
          expect.objectContaining({ nodeId: 'task_next' }),
        ]);
      });

      it('hands the task to the initiator manager when only the submitter is left and whenEmpty is INITIATOR_MANAGER', async (): Promise<void> => {
        const fixture = createFiledFixture({
          excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
          memberIds: [SUBMITTER],
          processManagerResolutions: [
            createManagerResolution({
              managerMemberId: 'member-manager',
              scopeId: 'org-finance',
              scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
            }),
          ],
          processMemberships: [
            createMembership({
              memberId: 'member-001',
              orgUnitId: 'org-finance',
            }),
          ],
          processOrgUnits: [
            createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
          ],
        });

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-manager']);
      });

      const createManagerSubmittedFixture = (
        withNextTier: boolean,
      ): ReturnType<typeof createServiceFixture> =>
        createFiledFixture({
          excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
          memberIds: ['member-001'],
          processManagerResolutions: [
            createManagerResolution({
              id: 'manager-resolution-finance',
              managerMemberId: SUBMITTER,
              scopeId: 'org-finance',
              scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
            }),
            ...(withNextTier
              ? [
                  createManagerResolution({
                    id: 'manager-resolution-company',
                    managerMemberId: 'member-ceo',
                    scopeId: 'org-company',
                    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
                  }),
                ]
              : []),
          ],
          processMemberships: [
            createMembership({
              memberId: 'member-001',
              orgUnitId: 'org-finance',
            }),
          ],
          processOrgUnits: [
            createOrgUnit({ id: 'org-company', path: 'org' }),
            createOrgUnit({ id: 'org-finance', path: 'org.finance' }),
          ],
        });

      it('moves the replacement to the next tier when the submitter is the initiator manager', async (): Promise<void> => {
        // The manager filing for a subordinate is dropped before the tier is
        // chosen, exactly like a unit-head initiator, so the parent unit's
        // manager is tried instead of resolving the submitter again.
        const fixture = createManagerSubmittedFixture(true);

        await fixture.service.processInstance('instance-1');

        expect(
          fixture.savedTaskCandidates.map((candidate) => candidate.memberId),
        ).toEqual(['member-ceo']);
      });

      it('fails with the existing message when no tier is left past the submitter', async (): Promise<void> => {
        const fixture = createManagerSubmittedFixture(false);

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow(
          '解析出的簽核人只剩申請人或代為送出此單的人，此節點不允許申請人或代送人簽核，且找不到申請人的主管可改派。',
        );
        expect(fixture.savedTasks).toEqual([]);
      });
    });

    describe('transferring a task', () => {
      const createTransferFixture = (
        excludeInitiator?: ExcludeInitiatorConfig,
      ): ReturnType<typeof createServiceFixture> =>
        createServiceFixture({
          currentVersionId: 'template-version-1',
          decisionTask: createTask({
            assigneeMemberId: 'member-finance',
            nodeId: 'task_finance',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
          decisionToken: createWorkflowToken({
            currentNodeId: 'task_finance',
            status: WorkflowTokenStatusEnum.WAITING,
          }),
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            excludeInitiator,
          }),
          submittedByMemberId: SUBMITTER,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });
      const transferTo = (
        fixture: ReturnType<typeof createServiceFixture>,
        transferToMemberId: string,
        options?: Parameters<typeof fixture.service.decideTask>[1],
      ): Promise<unknown> =>
        fixture.service.decideTask(
          {
            action: TaskDecisionActionEnum.TRANSFERRED,
            comment: null,
            decidedByMemberId: 'member-finance',
            taskId: 'task-1',
            transferToMemberId,
          },
          options,
        );

      it('refuses to hand the task to the submitter with the new message', async (): Promise<void> => {
        const fixture = createTransferFixture({ whenEmpty: 'FAIL' });
        const attempt = transferTo(fixture, SUBMITTER);

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(
          '簽核節點「財務簽核」不允許代送人簽核，不能將任務轉交給代為送出此單的人',
        );
      });

      it('keeps the existing message for the initiator on an instance that has a submitter', async (): Promise<void> => {
        const fixture = createTransferFixture({ whenEmpty: 'FAIL' });
        const attempt = transferTo(fixture, 'member-001');

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(
          '簽核節點「財務簽核」不允許申請人自簽，不能將任務轉交給申請人本人',
        );
      });

      it('allows handing the task to the submitter when the node does not exclude the initiator', async (): Promise<void> => {
        const fixture = createTransferFixture();

        await transferTo(fixture, SUBMITTER);

        expect(
          fixture.savedTasks.some(
            (task) => task.assigneeMemberId === SUBMITTER,
          ),
        ).toBe(true);
      });

      it('leaves an SLA escalation alone', async (): Promise<void> => {
        const fixture = createTransferFixture({ whenEmpty: 'FAIL' });

        await transferTo(fixture, SUBMITTER, {
          transferReason: SLA_ESCALATION_DELEGATION_REASON,
        });

        expect(
          fixture.savedTasks.some(
            (task) => task.assigneeMemberId === SUBMITTER,
          ),
        ).toBe(true);
      });
    });

    describe('activating a sequential candidate', () => {
      const lateDelegation = (
        fixture: ReturnType<typeof createServiceFixture>,
        to: string,
      ): void => {
        fixture.delegationService.resolveAssignee.mockImplementation(
          (memberId: string): Promise<DelegationResolution> =>
            Promise.resolve(
              memberId === 'member-b'
                ? delegateTo('member-b', to)
                : { delegationChain: [], finalAssigneeMemberId: memberId },
            ),
        );
      };
      const approveFirst = (
        fixture: ReturnType<typeof createServiceFixture>,
      ): Promise<unknown> =>
        fixture.service.decideTask({
          action: TaskDecisionActionEnum.APPROVED,
          comment: '同意',
          decidedByMemberId: 'member-a',
          taskId: 'task-seq',
        });

      it('keeps the stored member when a late delegation would route a waiting candidate to the submitter', async (): Promise<void> => {
        const fixture = createSequentialDecisionFixture({
          excludeInitiator: { whenEmpty: 'FAIL' },
          submittedByMemberId: SUBMITTER,
        });

        lateDelegation(fixture, SUBMITTER);
        await approveFirst(fixture);

        expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
          assigneeMemberId: 'member-b',
          delegationChain: [],
        });
      });

      it('still applies a late delegation to the submitter on a node that does not exclude the initiator', async (): Promise<void> => {
        const fixture = createSequentialDecisionFixture({
          submittedByMemberId: SUBMITTER,
        });

        lateDelegation(fixture, SUBMITTER);
        await approveFirst(fixture);

        expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
          assigneeMemberId: SUBMITTER,
        });
      });
    });

    describe('ad-hoc targets', () => {
      const createAdhocFixture = (
        options: Partial<Parameters<typeof createServiceFixture>[0]> = {},
      ): ReturnType<typeof createServiceFixture> =>
        createServiceFixture({
          currentVersionId: 'template-version-1',
          decisionTask: createTask({
            nodeId: 'task_finance',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
          decisionToken: createWorkflowToken({
            currentNodeId: 'task_finance',
            status: WorkflowTokenStatusEnum.WAITING,
          }),
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            allowAddSigner: true,
            excludeInitiator: { whenEmpty: 'FAIL' },
          }),
          submittedByMemberId: SUBMITTER,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          ...options,
        });
      const request = (
        memberIds: readonly string[],
      ): Parameters<
        ReturnType<
          typeof createServiceFixture
        >['service']['requestAdhocPreApproval']
      >[0] => ({
        comment: null,
        onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
        requestedByMemberId: 'member-finance',
        target: { kind: AdhocTargetKindEnum.MEMBER, memberIds },
        taskId: 'task-1',
      });

      it('rejects a pre-approval whose only target is the submitter', async (): Promise<void> => {
        const fixture = createAdhocFixture();

        await expect(
          fixture.service.requestAdhocPreApproval(request([SUBMITTER])),
        ).rejects.toThrow(
          '指定對象只有申請人或代為送出此單的人，此節點不允許申請人或代送人簽核',
        );
      });

      it('keeps the legitimate pre-approval target next to the submitter', async (): Promise<void> => {
        const fixture = createAdhocFixture();

        const task = await fixture.service.requestAdhocPreApproval(
          request([SUBMITTER, 'member-x']),
        );

        expect(task).toMatchObject({ assigneeMemberId: 'member-x' });
      });

      it('rejects a pre-approval whose target delegates to the submitter', async (): Promise<void> => {
        const fixture = createAdhocFixture({
          delegationResolutionByMember: {
            'member-x': delegateTo('member-x', SUBMITTER),
          },
        });

        await expect(
          fixture.service.requestAdhocPreApproval(request(['member-x'])),
        ).rejects.toThrow('此節點不允許申請人或代送人簽核');
      });

      it('rejects a countersign request whose only target is the submitter', async (): Promise<void> => {
        const fixture = createAdhocFixture();

        await expect(
          fixture.service.requestAdhocCountersign({
            comment: null,
            requestedByMemberId: 'member-finance',
            target: {
              kind: AdhocTargetKindEnum.MEMBER,
              memberIds: [SUBMITTER],
            },
            taskId: 'task-1',
          }),
        ).rejects.toThrow('指定對象只有申請人或代為送出此單的人');
        expect(fixture.savedAdhocDirectives).toEqual([]);
      });

      it('allows a pre-approval for the submitter when the node does not exclude the initiator', async (): Promise<void> => {
        const fixture = createAdhocFixture({
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            allowAddSigner: true,
          }),
        });

        const task = await fixture.service.requestAdhocPreApproval(
          request([SUBMITTER]),
        );

        expect(task).toMatchObject({ assigneeMemberId: SUBMITTER });
      });
    });

    describe('ORG_MANAGER_CHAIN walk', () => {
      const createFiledChainFixture = ({
        excludesInitiator = true,
        fallback,
        minPositionLevel = 50,
        org,
        submittedByMemberId = 'member-m',
      }: {
        readonly excludesInitiator?: boolean;
        readonly fallback?: Extract<
          ApproverResolver,
          { type: 'ORG_MANAGER_CHAIN' }
        >['fallback'];
        readonly minPositionLevel?: number;
        readonly org: ReturnType<typeof createManagerChainOrg>;
        readonly submittedByMemberId?: string | null;
      }): ReturnType<typeof createServiceFixture> =>
        createServiceFixture({
          currentVersionId: 'template-version-1',
          formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
          ...org,
          processWorkflowSnapshot: createLinearUserTaskWorkflow({
            approverResolver: {
              ...(fallback ? { fallback } : {}),
              minPositionLevel,
              type: 'ORG_MANAGER_CHAIN',
            },
            decisionPolicy: { type: 'SEQUENTIAL' },
            excludeInitiator: excludesInitiator
              ? { whenEmpty: 'FAIL' }
              : undefined,
          }),
          submittedByMemberId,
          templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
        });
      const readMemberIds = (
        fixture: ReturnType<typeof createServiceFixture>,
      ): readonly string[] =>
        fixture.savedTaskCandidates.map((candidate) => candidate.memberId);

      it('climbs past the submitter when he is the manager who reaches the level', async (): Promise<void> => {
        // Filtering him after the walk would leave the chain empty; the next
        // hop above him has the same grade, which only counts because he never
        // became the chain's last level.
        const fixture = createFiledChainFixture({
          org: createManagerChainOrg({
            grades: { 'member-gm': 50, 'member-m': 50 },
            links: [
              ['member-001', 'member-m'],
              ['member-m', 'member-gm'],
            ],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-gm']);
      });

      it('keeps the managers below the submitter and signs the one above him', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          org: createManagerChainOrg({
            grades: { 'member-a': 30, 'member-gm': 50, 'member-m': 50 },
            links: [
              ['member-001', 'member-a'],
              ['member-a', 'member-m'],
              ['member-m', 'member-gm'],
            ],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-a', 'member-gm']);
      });

      it('leaves a submitter below the level out of the chain without ending the walk there', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          org: createManagerChainOrg({
            grades: { 'member-gm': 50, 'member-m': 20 },
            links: [
              ['member-001', 'member-m'],
              ['member-m', 'member-gm'],
            ],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-gm']);
      });

      it('falls back when nobody above the submitter reaches the level', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          fallback: { memberId: 'member-admin', type: 'DIRECT' },
          org: createManagerChainOrg({
            grades: { 'member-m': 50 },
            links: [['member-001', 'member-m']],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-admin']);
      });

      it('rejects when nobody above the submitter reaches the level and there is no fallback', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          org: createManagerChainOrg({
            grades: { 'member-m': 50 },
            links: [['member-001', 'member-m']],
          }),
        });

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow('沿主管鏈找不到職等達 50 的主管，且未設定改派固定人');
        expect(fixture.savedTaskCandidates).toHaveLength(0);
      });

      it('applies whenEmpty when the fallback is the submitter', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          fallback: { memberId: 'member-m', type: 'DIRECT' },
          org: createManagerChainOrg({
            grades: { 'member-m': 10 },
            links: [['member-001', 'member-m']],
          }),
        });

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow('此節點不允許申請人或代送人簽核');
      });

      it('does not loop when the chain comes back round to the submitter', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          fallback: { memberId: 'member-admin', type: 'DIRECT' },
          org: createManagerChainOrg({
            grades: { 'member-a': 10, 'member-m': 20 },
            links: [
              ['member-001', 'member-m'],
              ['member-m', 'member-a'],
              ['member-a', 'member-m'],
            ],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-a', 'member-admin']);
      });

      it('keeps the submitter in the chain on a node that does not exclude the initiator', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          excludesInitiator: false,
          org: createManagerChainOrg({
            grades: { 'member-gm': 50, 'member-m': 50 },
            links: [
              ['member-001', 'member-m'],
              ['member-m', 'member-gm'],
            ],
          }),
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-m']);
      });

      it('walks exactly as before when there is no submitter on the row', async (): Promise<void> => {
        const fixture = createFiledChainFixture({
          org: createManagerChainOrg({
            grades: { 'member-gm': 50, 'member-m': 50 },
            links: [
              ['member-001', 'member-m'],
              ['member-m', 'member-gm'],
            ],
          }),
          submittedByMemberId: null,
        });

        await fixture.service.processInstance('instance-1');

        expect(readMemberIds(fixture)).toEqual(['member-m']);
      });
    });
  });

  describe('ORG_MANAGER_CHAIN approver resolver', () => {
    const createChainFixture = (
      org: ReturnType<typeof createManagerChainOrg>,
      resolver: Partial<
        Extract<ApproverResolver, { type: 'ORG_MANAGER_CHAIN' }>
      > = {},
    ): ReturnType<typeof createServiceFixture> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        ...org,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            minPositionLevel: 3,
            type: 'ORG_MANAGER_CHAIN',
            ...resolver,
          },
          decisionPolicy: { type: 'SEQUENTIAL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    const readCandidateMemberIds = (
      fixture: ReturnType<typeof createServiceFixture>,
    ): readonly string[] =>
      fixture.savedTaskCandidates.map((candidate) => candidate.memberId);

    it('creates candidates nearest manager first up to the required level', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2, 'member-m3': 3 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
            ['member-m2', 'member-m3'],
          ],
        }),
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
        'member-m3',
      ]);
    });

    it('opens only the nearest manager and keeps the rest waiting in chain order', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2, 'member-m3': 3 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
            ['member-m2', 'member-m3'],
          ],
        }),
      );

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.savedTaskCandidates.map((candidate) => ({
          memberId: candidate.memberId,
          sequence: candidate.sequence,
          status: candidate.status,
        })),
      ).toEqual([
        {
          memberId: 'member-m1',
          sequence: 0,
          status: TaskCandidateStatusEnum.PENDING,
        },
        {
          memberId: 'member-m2',
          sequence: 1,
          status: TaskCandidateStatusEnum.WAITING,
        },
        {
          memberId: 'member-m3',
          sequence: 2,
          status: TaskCandidateStatusEnum.WAITING,
        },
      ]);
      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-m1',
        decisionPolicySnapshot: { type: 'SEQUENTIAL' },
      });
    });

    it('hands the task up to the next manager when the nearest one approves', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        decisionTask: createTask({
          assigneeMemberId: 'member-m1',
          assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
          candidateMemberIds: ['member-m1', 'member-m2', 'member-m3'],
          decisionPolicySnapshot: { type: 'SEQUENTIAL' },
          id: 'task-chain',
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-m1',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
        decisionToken: createWorkflowToken({
          currentNodeId: 'task_finance',
          status: WorkflowTokenStatusEnum.WAITING,
        }),
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processTaskCandidates: ['member-m1', 'member-m2', 'member-m3'].map(
          (memberId, index) =>
            createTaskCandidate({
              id: `candidate-${memberId.slice(-2)}`,
              memberId,
              sequence: index,
              status:
                index === 0
                  ? TaskCandidateStatusEnum.PENDING
                  : TaskCandidateStatusEnum.WAITING,
              taskId: 'task-chain',
            }),
        ),
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: { minPositionLevel: 3, type: 'ORG_MANAGER_CHAIN' },
          decisionPolicy: { type: 'SEQUENTIAL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-m1',
        taskId: 'task-chain',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-chain')).toEqual({
        'member-m1': TaskCandidateStatusEnum.COMPLETED,
        'member-m2': TaskCandidateStatusEnum.PENDING,
        'member-m3': TaskCandidateStatusEnum.WAITING,
      });
      expect(readLatestTask(fixture, 'task-chain')).toMatchObject({
        assigneeMemberId: 'member-m2',
        status: TaskStatusEnum.PENDING,
      });
    });

    it('stops at the first manager that already reaches the level', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 3, 'member-m2': 4 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
          ],
        }),
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual(['member-m1']);
    });

    it('passes through managers without a position and managers not senior to the last one added', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: {
            'member-m1': 2,
            'member-m2': null,
            'member-m3': 2,
            'member-m4': 1,
            'member-m5': 3,
          },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
            ['member-m2', 'member-m3'],
            ['member-m3', 'member-m4'],
            ['member-m4', 'member-m5'],
          ],
        }),
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m5',
      ]);
    });

    it('uses the highest level among the manager active memberships and ignores inactive ones', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          extraMemberships: [
            createMembership({
              effectiveTo: '2026-02-01',
              id: 'membership-m1-expired',
              memberId: 'member-m1',
              positionId: 'position-9',
            }),
            createMembership({
              id: 'membership-m2-second',
              memberId: 'member-m2',
              positionId: 'position-3',
            }),
          ],
          extraPositionLevels: [3, 9],
          grades: { 'member-m1': 1, 'member-m2': 2 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
          ],
        }),
      );

      await fixture.service.processInstance('instance-1');

      // Counting the expired level 9 would stop the walk at member-m1.
      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
      ]);
    });

    it('rejects when the chain ends below the level and no fallback is set', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
          ],
        }),
      );

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('沿主管鏈找不到職等達 3 的主管，且未設定改派固定人');
      expect(fixture.savedTaskCandidates).toHaveLength(0);
    });

    it('appends the fallback assignee last when the chain ends below the level', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
          ],
        }),
        { fallback: { memberId: 'member-admin', type: 'DIRECT' } },
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
        'member-admin',
      ]);
    });

    it('does not duplicate a fallback that is already on the chain', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
          ],
        }),
        { fallback: { memberId: 'member-m1', type: 'DIRECT' } },
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
      ]);
    });

    it('keeps the initiator self-approval guard on the fallback', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({ grades: {}, links: [] }),
        { fallback: { memberId: 'member-001', type: 'DIRECT' } },
      );

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('改派固定人是申請人本人');
    });

    it('throws instead of choosing when manager rules tie at a hop', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1a': 1, 'member-m1b': 3 },
          links: [
            ['member-001', 'member-m1a'],
            ['member-001', 'member-m1b'],
          ],
        }),
      );

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('主管規則在同一優先順序出現多位主管');
      expect(fixture.savedTaskCandidates).toHaveLength(0);
    });

    it('stops walking when the manager rules form a cycle', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          grades: { 'member-m1': 1, 'member-m2': 2 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-m2'],
            ['member-m2', 'member-m1'],
          ],
        }),
        { fallback: { memberId: 'member-admin', type: 'DIRECT' } },
      );

      await fixture.service.processInstance('instance-1');

      expect(readCandidateMemberIds(fixture)).toEqual([
        'member-m1',
        'member-m2',
        'member-admin',
      ]);
    });

    it('treats a manager rule that leads back to the initiator as the end of the chain', async (): Promise<void> => {
      const fixture = createChainFixture(
        createManagerChainOrg({
          // The initiator would reach the level itself, but is never a step.
          grades: { 'member-001': 3, 'member-m1': 1 },
          links: [
            ['member-001', 'member-m1'],
            ['member-m1', 'member-001'],
          ],
        }),
      );

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('沿主管鏈找不到職等達 3 的主管');
    });

    describe('org-unit scope manager rules', () => {
      // company (org) > finance (org.finance) > ap (org.finance.ap), each unit
      // headed by one member. The head belongs to the unit he heads, so his own
      // unit rule names himself.
      const UNITS = [
        createOrgUnit({ code: 'CO', id: 'org-company', path: 'org' }),
        createOrgUnit({ code: 'FIN', id: 'org-finance', path: 'org.finance' }),
        createOrgUnit({ code: 'AP', id: 'org-ap', path: 'org.finance.ap' }),
      ];
      const unitRule = (
        orgUnitId: string,
        managerMemberId: string,
      ): ManagerResolutionEntity =>
        createManagerResolution({
          id: `manager-resolution-${orgUnitId}`,
          managerMemberId,
          priority: 100,
          scopeId: orgUnitId,
          scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
        });
      const placeMember = (
        memberId: string,
        orgUnitId: string,
        level: number | null,
      ): MembershipEntity =>
        createMembership({
          id: `membership-${memberId}`,
          memberId,
          orgUnitId,
          positionId: level === null ? null : `position-${level}`,
        });
      const createUnitOrg = ({
        extraRules = [],
        initiatorHeadsAp,
      }: {
        readonly extraRules?: readonly ManagerResolutionEntity[];
        readonly initiatorHeadsAp: boolean;
      }): ReturnType<typeof createManagerChainOrg> => ({
        processManagerResolutions: [
          unitRule('org-ap', initiatorHeadsAp ? 'member-001' : 'member-head-ap'),
          unitRule('org-finance', 'member-head-fin'),
          unitRule('org-company', 'member-head-co'),
          ...extraRules,
        ],
        processMemberships: [
          placeMember('member-001', 'org-ap', null),
          placeMember('member-head-ap', 'org-ap', 1),
          placeMember('member-head-fin', 'org-finance', 2),
          placeMember('member-head-co', 'org-company', 3),
          placeMember('member-vp', 'org-company', 3),
        ],
        processOrgUnits: UNITS,
        processPositions: [1, 2, 3].map((level) => createPosition({ level })),
      });

      it('climbs through the unit heads when the initiator is a plain member', async (): Promise<void> => {
        const fixture = createChainFixture(
          createUnitOrg({ initiatorHeadsAp: false }),
        );

        await fixture.service.processInstance('instance-1');

        expect(readCandidateMemberIds(fixture)).toEqual([
          'member-head-ap',
          'member-head-fin',
          'member-head-co',
        ]);
      });

      it('reaches the parent unit manager when the initiator heads his own unit', async (): Promise<void> => {
        const fixture = createChainFixture(
          createUnitOrg({ initiatorHeadsAp: true }),
        );

        await fixture.service.processInstance('instance-1');

        expect(readCandidateMemberIds(fixture)).toEqual([
          'member-head-fin',
          'member-head-co',
        ]);
      });

      it('lets a member-scope rule take over a hop beside org-unit rules', async (): Promise<void> => {
        const fixture = createChainFixture(
          createUnitOrg({
            extraRules: [
              createManagerResolution({
                id: 'manager-resolution-head-fin',
                managerMemberId: 'member-vp',
                priority: 100,
                scopeId: 'member-head-fin',
                scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
              }),
            ],
            initiatorHeadsAp: false,
          }),
        );

        await fixture.service.processInstance('instance-1');

        expect(readCandidateMemberIds(fixture)).toEqual([
          'member-head-ap',
          'member-head-fin',
          'member-vp',
        ]);
      });
    });

    describe('hop limit', () => {
      // member-h1 .. member-h25, where member-hN has position level N.
      const buildLongChain = (
        minPositionLevel: number,
      ): ReturnType<typeof createServiceFixture> => {
        const members = Array.from(
          { length: 25 },
          (_, index) => `member-h${index + 1}`,
        );

        return createChainFixture(
          createManagerChainOrg({
            grades: Object.fromEntries(
              members.map((memberId, index) => [memberId, index + 1]),
            ),
            links: [
              ['member-001', members[0]],
              ...members
                .slice(1)
                .map((memberId, index): readonly [string, string] => [
                  members[index],
                  memberId,
                ]),
            ],
          }),
          { minPositionLevel },
        );
      };

      it('resolves a chain that reaches the level exactly on the 20th hop', async (): Promise<void> => {
        const fixture = buildLongChain(20);

        await fixture.service.processInstance('instance-1');

        expect(readCandidateMemberIds(fixture)).toHaveLength(20);
        expect(readCandidateMemberIds(fixture).at(-1)).toBe('member-h20');
      });

      it('treats a chain that only reaches the level on the 21st hop as ended', async (): Promise<void> => {
        const fixture = buildLongChain(21);

        await expect(
          fixture.service.processInstance('instance-1'),
        ).rejects.toThrow('沿主管鏈找不到職等達 21 的主管');
      });
    });

    describe('grade of a delegate or transfer target', () => {
      const GRADES = {
        'agent-equal': 2,
        'agent-high': 3,
        'agent-low': 1,
        'agent-none': null,
        'member-001': 1,
        'member-m1': 1,
        'member-m2': 2,
      } as const;
      const CHAIN_LINKS: readonly (readonly [string, string])[] = [
        ['member-001', 'member-m1'],
        ['member-m1', 'member-m2'],
      ];
      const delegateMember = (
        fixture: ReturnType<typeof createServiceFixture>,
        principal: string,
        agent: string,
      ): void => {
        fixture.delegationService.resolveAssignee.mockImplementation(
          (memberId: string): Promise<DelegationResolution> =>
            Promise.resolve(
              memberId === principal
                ? {
                    delegationChain: [
                      {
                        from: principal,
                        reason: 'ALL',
                        ruleId: 'delegation-rule-grade',
                        to: agent,
                      },
                    ],
                    finalAssigneeMemberId: agent,
                  }
                : { delegationChain: [], finalAssigneeMemberId: memberId },
            ),
        );
      };
      const readTaskCreatedPayload = (
        fixture: ReturnType<typeof createServiceFixture>,
      ): Readonly<Record<string, unknown>> | undefined =>
        fixture.savedSingleActivityLogs.find(
          (log) => log.eventType === ActivityLogEventTypeEnum.TASK_CREATED,
        )?.payload;
      const createGradedChainFixture = (
        resolver: Partial<
          Extract<ApproverResolver, { type: 'ORG_MANAGER_CHAIN' }>
        > = {},
      ): ReturnType<typeof createServiceFixture> =>
        createChainFixture(
          createManagerChainOrg({ grades: GRADES, links: CHAIN_LINKS }),
          { minPositionLevel: 2, ...resolver },
        );

      describe('delegation when the task is created', () => {
        it('applies a delegation to a delegate of a higher grade', async (): Promise<void> => {
          const fixture = createGradedChainFixture();

          delegateMember(fixture, 'member-m2', 'agent-high');
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual([
            'member-m1',
            'agent-high',
          ]);
          expect(readTaskCreatedPayload(fixture)).not.toHaveProperty(
            'skippedDelegations',
          );
        });

        it('reads the grades of every delegated seat on the node in one batch', async (): Promise<void> => {
          const fixture = createGradedChainFixture();

          fixture.delegationService.resolveAssignee.mockImplementation(
            (memberId: string): Promise<DelegationResolution> =>
              Promise.resolve({
                delegationChain: [],
                finalAssigneeMemberId:
                  memberId === 'member-m1'
                    ? 'agent-high'
                    : memberId === 'member-m2'
                      ? 'agent-low'
                      : memberId,
              }),
          );
          await fixture.service.processInstance('instance-1');

          // The member ids of each membership lookup made by member id list.
          const memberIdLists = jest
            .mocked(fixture.membershipFind)
            .mock.calls.flatMap(([options]): readonly (readonly string[])[] => {
              const where: unknown = options?.where;
              const memberId: unknown =
                typeof where === 'object' && where !== null
                  ? (where as Readonly<Record<string, unknown>>)['memberId']
                  : undefined;
              const value: unknown =
                memberId instanceof FindOperator ? memberId.value : undefined;

              return Array.isArray(value)
                ? [value.filter((id): id is string => typeof id === 'string')]
                : [];
            });
          const gradeLookups = memberIdLists.filter((memberIds) =>
            memberIds.includes('agent-low'),
          );

          expect(gradeLookups).toHaveLength(1);
          expect([...(gradeLookups[0] ?? [])].sort()).toEqual([
            'agent-high',
            'agent-low',
            'member-m1',
            'member-m2',
          ]);
          expect(readCandidateMemberIds(fixture)).toEqual([
            'agent-high',
            'member-m2',
          ]);
        });

        it('applies a delegation to a delegate of the same grade', async (): Promise<void> => {
          const fixture = createGradedChainFixture();

          delegateMember(fixture, 'member-m2', 'agent-equal');
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual([
            'member-m1',
            'agent-equal',
          ]);
        });

        it('keeps the member and records why when the delegate has a lower grade', async (): Promise<void> => {
          const fixture = createGradedChainFixture();

          delegateMember(fixture, 'member-m2', 'agent-low');
          await fixture.service.processInstance('instance-1');

          expect(
            fixture.savedTaskCandidates.map((candidate) => ({
              delegationChain: candidate.delegationChain,
              memberId: candidate.memberId,
              originalMemberId: candidate.originalMemberId,
            })),
          ).toEqual([
            {
              delegationChain: [],
              memberId: 'member-m1',
              originalMemberId: 'member-m1',
            },
            {
              delegationChain: [],
              memberId: 'member-m2',
              originalMemberId: 'member-m2',
            },
          ]);
          expect(readTaskCreatedPayload(fixture)).toMatchObject({
            skippedDelegations: [
              {
                agentLevel: 1,
                agentMemberId: 'agent-low',
                principalLevel: 2,
                principalMemberId: 'member-m2',
                reason: 'AGENT_POSITION_LEVEL_TOO_LOW',
              },
            ],
          });
          expect(readTaskCreatedPayload(fixture)).not.toHaveProperty(
            'delegationChain',
          );
        });

        it('keeps the member when the delegate holds no position', async (): Promise<void> => {
          const fixture = createGradedChainFixture();

          delegateMember(fixture, 'member-m2', 'agent-none');
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual([
            'member-m1',
            'member-m2',
          ]);
          expect(readTaskCreatedPayload(fixture)).toMatchObject({
            skippedDelegations: [
              { agentLevel: null, agentMemberId: 'agent-none' },
            ],
          });
        });

        it('leaves the delegation alone when the replaced member has no grade', async (): Promise<void> => {
          // member-admin is the fallback and holds no position at all.
          const fixture = createChainFixture(
            createManagerChainOrg({
              grades: { ...GRADES, 'member-admin': null },
              links: CHAIN_LINKS,
            }),
            {
              fallback: { memberId: 'member-admin', type: 'DIRECT' },
              minPositionLevel: 3,
            },
          );

          delegateMember(fixture, 'member-admin', 'agent-low');
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual([
            'member-m1',
            'member-m2',
            'agent-low',
          ]);
          expect(readTaskCreatedPayload(fixture)).not.toHaveProperty(
            'skippedDelegations',
          );
        });

        it('does not apply the rule on a node that is not a manager chain', async (): Promise<void> => {
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({ grades: GRADES, links: CHAIN_LINKS }),
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              approverResolver: { memberIds: ['member-m2'], type: 'DIRECT' },
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });

          delegateMember(fixture, 'member-m2', 'agent-low');
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual(['agent-low']);
          expect(readTaskCreatedPayload(fixture)).not.toHaveProperty(
            'skippedDelegations',
          );
        });

        it('keeps the record of a refused delegation on a row the dedupe drops', async (): Promise<void> => {
          // member-m1 delegates to member-m2 (allowed), and member-m2's own
          // delegation to agent-low is refused. Both rows now end on member-m2,
          // so the dedupe keeps the first and drops the row that carried the
          // refusal; the record has to survive that.
          const fixture = createGradedChainFixture();

          fixture.delegationService.resolveAssignee.mockImplementation(
            (memberId: string): Promise<DelegationResolution> =>
              Promise.resolve(
                memberId === 'member-m1'
                  ? {
                      delegationChain: [
                        {
                          from: 'member-m1',
                          reason: 'ALL',
                          ruleId: 'delegation-rule-up',
                          to: 'member-m2',
                        },
                      ],
                      finalAssigneeMemberId: 'member-m2',
                    }
                  : memberId === 'member-m2'
                    ? {
                        delegationChain: [
                          {
                            from: 'member-m2',
                            reason: 'ALL',
                            ruleId: 'delegation-rule-down',
                            to: 'agent-low',
                          },
                        ],
                        finalAssigneeMemberId: 'agent-low',
                      }
                    : { delegationChain: [], finalAssigneeMemberId: memberId },
              ),
          );
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual(['member-m2']);
          expect(readTaskCreatedPayload(fixture)).toMatchObject({
            skippedDelegations: [
              {
                agentMemberId: 'agent-low',
                principalMemberId: 'member-m2',
              },
            ],
          });
        });

        it('does not gate the delegation of an ad-hoc approver on a manager-chain node', async (): Promise<void> => {
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            decisionTask: createTask({
              nodeId: 'task_finance',
              status: TaskStatusEnum.PENDING,
              tokenId: 'token-1',
            }),
            decisionToken: createWorkflowToken({
              currentNodeId: 'task_finance',
              status: WorkflowTokenStatusEnum.WAITING,
            }),
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({
              grades: { ...GRADES, 'member-d': 2 },
              links: CHAIN_LINKS,
            }),
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              allowAddSigner: true,
              approverResolver: {
                minPositionLevel: 2,
                type: 'ORG_MANAGER_CHAIN',
              },
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });

          delegateMember(fixture, 'member-d', 'agent-low');

          const adhocTask = await fixture.service.requestAdhocPreApproval({
            comment: '請先確認預算',
            onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
            requestedByMemberId: 'member-finance',
            target: {
              kind: AdhocTargetKindEnum.MEMBER,
              memberIds: ['member-d'],
            },
            taskId: 'task-1',
          });

          expect(adhocTask).toMatchObject({ assigneeMemberId: 'agent-low' });
        });

        it('gates the delegation of the initiator manager who replaces an excluded initiator', async (): Promise<void> => {
          // The chain ends at member-m1 (grade 2), who delegates to the
          // initiator (grade 2, allowed) and so drops out. The initiator's
          // manager is then member-m1 again, this time delegating to a grade 1
          // member, which the grade rule refuses.
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({
              grades: { ...GRADES, 'member-001': 2, 'member-m1': 2 },
              links: CHAIN_LINKS,
            }),
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              approverResolver: {
                minPositionLevel: 2,
                type: 'ORG_MANAGER_CHAIN',
              },
              excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });
          const toResolution = (
            principal: string,
            agent: string,
          ): DelegationResolution => ({
            delegationChain: [
              {
                from: principal,
                reason: 'ALL',
                ruleId: 'delegation-rule-grade',
                to: agent,
              },
            ],
            finalAssigneeMemberId: agent,
          });

          fixture.delegationService.resolveAssignee
            .mockImplementationOnce(
              (): Promise<DelegationResolution> =>
                Promise.resolve(toResolution('member-m1', 'member-001')),
            )
            .mockImplementation(
              (memberId: string): Promise<DelegationResolution> =>
                Promise.resolve(
                  memberId === 'member-m1'
                    ? toResolution('member-m1', 'agent-low')
                    : { delegationChain: [], finalAssigneeMemberId: memberId },
                ),
            );
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual(['member-m1']);
          expect(readTaskCreatedPayload(fixture)).toMatchObject({
            skippedDelegations: [
              { agentMemberId: 'agent-low', principalMemberId: 'member-m1' },
            ],
          });
        });

        it('records no refusal for the initiator seat an excluding node removes', async (): Promise<void> => {
          // The chain ends below the level, so the fallback (the initiator, who
          // may approve his own request there) is appended last, then removed
          // by the exclusion. His refused delegation is not on the task; the
          // refusal for member-m2, who is, still is.
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({ grades: GRADES, links: CHAIN_LINKS }),
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              approverResolver: {
                fallback: {
                  allowInitiatorSelfApproval: true,
                  memberId: 'member-001',
                  type: 'DIRECT',
                },
                minPositionLevel: 3,
                type: 'ORG_MANAGER_CHAIN',
              },
              decisionPolicy: { type: 'SEQUENTIAL' },
              excludeInitiator: { whenEmpty: 'FAIL' },
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });
          const agents: Readonly<Record<string, string>> = {
            'member-001': 'agent-none',
            'member-m2': 'agent-low',
          };

          fixture.delegationService.resolveAssignee.mockImplementation(
            (memberId: string): Promise<DelegationResolution> =>
              Promise.resolve(
                agents[memberId]
                  ? {
                      delegationChain: [
                        {
                          from: memberId,
                          reason: 'ALL',
                          ruleId: 'delegation-rule-grade',
                          to: agents[memberId],
                        },
                      ],
                      finalAssigneeMemberId: agents[memberId],
                    }
                  : { delegationChain: [], finalAssigneeMemberId: memberId },
              ),
          );
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual([
            'member-m1',
            'member-m2',
          ]);
          expect(
            readTaskCreatedPayload(fixture)?.['skippedDelegations'],
          ).toEqual([
            {
              agentLevel: 1,
              agentMemberId: 'agent-low',
              principalLevel: 2,
              principalMemberId: 'member-m2',
              reason: 'AGENT_POSITION_LEVEL_TOO_LOW',
            },
          ]);
        });

        it('reports only the refusals of the replacement once the initiator manager takes over', async (): Promise<void> => {
          // First pass: member-m1 delegates to the initiator (applied, dropped)
          // and the initiator fallback seat is refused a delegation (dropped);
          // nothing is left, so the initiator's manager (member-m1 again)
          // replaces them and gets a refused delegation of his own. Only that
          // one belongs on the task.
          const fixture = createServiceFixture({
            currentVersionId: 'template-version-1',
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({
              grades: { ...GRADES, 'member-001': 2, 'member-m1': 2 },
              links: [['member-001', 'member-m1']],
            }),
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              approverResolver: {
                fallback: {
                  allowInitiatorSelfApproval: true,
                  memberId: 'member-001',
                  type: 'DIRECT',
                },
                minPositionLevel: 3,
                type: 'ORG_MANAGER_CHAIN',
              },
              decisionPolicy: { type: 'SEQUENTIAL' },
              excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });
          let managerCalls = 0;
          const delegate = (
            principal: string,
            agent: string,
          ): DelegationResolution => ({
            delegationChain: [
              {
                from: principal,
                reason: 'ALL',
                ruleId: 'delegation-rule-grade',
                to: agent,
              },
            ],
            finalAssigneeMemberId: agent,
          });

          fixture.delegationService.resolveAssignee.mockImplementation(
            (memberId: string): Promise<DelegationResolution> => {
              if (memberId === 'member-m1') {
                managerCalls += 1;

                return Promise.resolve(
                  managerCalls === 1
                    ? delegate('member-m1', 'member-001')
                    : delegate('member-m1', 'agent-low'),
                );
              }

              return Promise.resolve(
                memberId === 'member-001'
                  ? delegate('member-001', 'agent-none')
                  : { delegationChain: [], finalAssigneeMemberId: memberId },
              );
            },
          );
          await fixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(fixture)).toEqual(['member-m1']);
          expect(
            readTaskCreatedPayload(fixture)?.['skippedDelegations'],
          ).toEqual([
            {
              agentLevel: 1,
              agentMemberId: 'agent-low',
              principalLevel: 2,
              principalMemberId: 'member-m1',
              reason: 'AGENT_POSITION_LEVEL_TOO_LOW',
            },
          ]);
        });

        it('does not bring a delegation through the initiator back as a path', async (): Promise<void> => {
          // member-001 (grade 1) is the initiator of a node that excludes him.
          const createExcludingFixture = (
            minPositionLevel: number,
          ): ReturnType<typeof createServiceFixture> =>
            createServiceFixture({
              currentVersionId: 'template-version-1',
              formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
              ...createManagerChainOrg({ grades: GRADES, links: CHAIN_LINKS }),
              processWorkflowSnapshot: createLinearUserTaskWorkflow({
                approverResolver: {
                  minPositionLevel,
                  type: 'ORG_MANAGER_CHAIN',
                },
                decisionPolicy: { type: 'SEQUENTIAL' },
                excludeInitiator: { whenEmpty: 'FAIL' },
              }),
              templateVersionStatus:
                ApprovalTemplateVersionStatusEnum.PUBLISHED,
            });
          // A grade 2 manager delegating to him is refused by the grade rule,
          // so the manager stays and the path never touches the initiator.
          const lowFixture = createExcludingFixture(2);

          delegateMember(lowFixture, 'member-m2', 'member-001');
          await lowFixture.service.processInstance('instance-1');

          expect(readCandidateMemberIds(lowFixture)).toEqual([
            'member-m1',
            'member-m2',
          ]);

          // A grade 1 manager delegating to him passes the grade rule, and the
          // initiator exclusion still drops that path as before.
          const equalFixture = createExcludingFixture(1);

          delegateMember(equalFixture, 'member-m1', 'member-001');
          await expect(
            equalFixture.service.processInstance('instance-1'),
          ).rejects.toThrow('只剩申請人本人');
        });
      });

      describe('delegation when a waiting candidate is activated', () => {
        const createActivationFixture = (
          resolver: ApproverResolver = {
            minPositionLevel: 3,
            type: 'ORG_MANAGER_CHAIN',
          },
        ): ServiceFixture =>
          createSequentialDecisionFixture({
            approverResolver: resolver,
            ...createManagerChainOrg({
              grades: {
                'agent-high': 3,
                'agent-low': 1,
                'member-a': 2,
                'member-b': 2,
                'member-c': 3,
              },
              links: [],
            }),
          });
        const approveFirst = (fixture: ServiceFixture): Promise<unknown> =>
          fixture.service.decideTask({
            action: TaskDecisionActionEnum.APPROVED,
            comment: '同意',
            decidedByMemberId: 'member-a',
            taskId: 'task-seq',
          });
        const readActivatedPayload = (
          fixture: ServiceFixture,
        ): Readonly<Record<string, unknown>> | undefined =>
          fixture.savedSingleActivityLogs.find(
            (log) =>
              log.eventType ===
              ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
          )?.payload;

        it('applies a late delegation to a delegate of an equal or higher grade', async (): Promise<void> => {
          const fixture = createActivationFixture();

          delegateMember(fixture, 'member-b', 'agent-high');
          await approveFirst(fixture);

          expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
            assigneeMemberId: 'agent-high',
            originalAssigneeMemberId: 'member-b',
          });
          expect(readActivatedPayload(fixture)).not.toHaveProperty(
            'skippedDelegations',
          );
        });

        it('keeps the member and records why when the late delegate has a lower grade', async (): Promise<void> => {
          const fixture = createActivationFixture();

          delegateMember(fixture, 'member-b', 'agent-low');
          await approveFirst(fixture);

          expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
            assigneeMemberId: 'member-b',
            delegationChain: [],
            originalAssigneeMemberId: 'member-b',
          });
          expect(readActivatedPayload(fixture)).toMatchObject({
            assigneeMemberId: 'member-b',
            skippedDelegations: [
              {
                agentLevel: 1,
                agentMemberId: 'agent-low',
                principalLevel: 2,
                principalMemberId: 'member-b',
                reason: 'AGENT_POSITION_LEVEL_TOO_LOW',
              },
            ],
          });
        });

        it('still records a refused late delegation when the stored member is kept', async (): Promise<void> => {
          // member-b sits on the task through member-x; member-c is a candidate
          // through member-b. Resolving member-b again lands on member-b, who
          // already holds another row, so the stored values are kept; the
          // refusal of the lower-grade delegate still happened.
          const fixture = createSequentialDecisionFixture({
            approverResolver: {
              minPositionLevel: 3,
              type: 'ORG_MANAGER_CHAIN',
            },
            candidateOverrides: {
              'member-b': { memberId: 'member-x', originalMemberId: 'member-b' },
              'member-c': { memberId: 'member-b', originalMemberId: 'member-c' },
            },
            ...createManagerChainOrg({
              grades: { 'agent-low': 1, 'member-a': 2, 'member-b': 2 },
              links: [],
            }),
          });

          delegateMember(fixture, 'member-b', 'agent-low');
          await approveFirst(fixture);

          expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
            assigneeMemberId: 'member-x',
            delegationChain: [],
          });
          expect(readActivatedPayload(fixture)).toMatchObject({
            assigneeMemberId: 'member-x',
            skippedDelegations: [
              {
                agentMemberId: 'agent-low',
                principalLevel: 2,
                principalMemberId: 'member-b',
              },
            ],
          });
        });

        it('does not apply the rule on a node that is not a manager chain', async (): Promise<void> => {
          const fixture = createActivationFixture({
            memberIds: ['member-a', 'member-b', 'member-c'],
            type: 'DIRECT',
          });

          delegateMember(fixture, 'member-b', 'agent-low');
          await approveFirst(fixture);

          expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
            assigneeMemberId: 'agent-low',
          });
          expect(readActivatedPayload(fixture)).not.toHaveProperty(
            'skippedDelegations',
          );
        });
      });

      describe('manual transfer', () => {
        const createTransferFixture = ({
          assigneeMemberId = 'member-m2',
          candidates,
          decisionPolicy = { type: 'SINGLE' },
          delegationChain = [],
          grades = GRADES,
          resolver = { minPositionLevel: 2, type: 'ORG_MANAGER_CHAIN' },
          task = {},
        }: {
          readonly assigneeMemberId?: string | null;
          readonly candidates?: readonly TaskCandidateEntity[];
          readonly decisionPolicy?: DecisionPolicy;
          readonly delegationChain?: readonly DelegationStep[];
          readonly grades?: Readonly<Record<string, number | null>>;
          readonly resolver?: ApproverResolver;
          readonly task?: Partial<TaskEntity>;
        } = {}): ServiceFixture =>
          createServiceFixture({
            currentVersionId: 'template-version-1',
            decisionTask: createTask({
              assigneeMemberId,
              delegationChain,
              nodeId: 'task_finance',
              originalAssigneeMemberId: 'member-m2',
              status: TaskStatusEnum.PENDING,
              tokenId: 'token-1',
              ...task,
            }),
            decisionToken: createWorkflowToken({
              currentNodeId: 'task_finance',
              status: WorkflowTokenStatusEnum.WAITING,
            }),
            formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
            ...createManagerChainOrg({ grades, links: [] }),
            processTaskCandidates: candidates,
            processWorkflowSnapshot: createLinearUserTaskWorkflow({
              approverResolver: resolver,
              decisionPolicy,
            }),
            templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
          });
        const transferTo = (
          fixture: ServiceFixture,
          transferToMemberId: string,
          decidedByMemberId = 'member-m2',
          options: { readonly transferReason?: string } = {},
        ): Promise<unknown> =>
          fixture.service.decideTask(
            {
              action: TaskDecisionActionEnum.TRANSFERRED,
              comment: null,
              decidedByMemberId,
              taskId: 'task-1',
              transferToMemberId,
            },
            options,
          );
        const GRADE_MESSAGE =
          '簽核節點「財務簽核」需由職等 2 以上的成員簽核，不能轉簽給職等不足的成員';

        it('rejects a transfer to a lower grade with the grade message', async (): Promise<void> => {
          const fixture = createTransferFixture();

          await expect(transferTo(fixture, 'agent-low')).rejects.toThrow(
            ForbiddenException,
          );
          await expect(transferTo(fixture, 'agent-low')).rejects.toThrow(
            GRADE_MESSAGE,
          );
        });

        it('rejects a transfer to a member without a position', async (): Promise<void> => {
          const fixture = createTransferFixture();

          await expect(transferTo(fixture, 'agent-none')).rejects.toThrow(
            GRADE_MESSAGE,
          );
        });

        it('allows a transfer to an equal or higher grade', async (): Promise<void> => {
          const equalFixture = createTransferFixture();
          const highFixture = createTransferFixture();

          await expect(
            transferTo(equalFixture, 'agent-equal'),
          ).resolves.toBeDefined();
          await expect(
            transferTo(highFixture, 'agent-high'),
          ).resolves.toBeDefined();
        });

        it('allows a transfer when the member being replaced has no grade', async (): Promise<void> => {
          const fixture = createTransferFixture({
            grades: { ...GRADES, 'member-m2': null },
          });

          await expect(transferTo(fixture, 'agent-low')).resolves.toBeDefined();
        });

        it('measures a transfer by a delegate against the member they act for', async (): Promise<void> => {
          // member-m2 (grade 2) delegated to agent-high (grade 3), who now
          // holds the task. Handing it to a grade 2 member is fine because the
          // member being replaced is member-m2, not the delegate.
          const delegationChain: readonly DelegationStep[] = [
            {
              from: 'member-m2',
              reason: 'ALL',
              ruleId: 'delegation-rule-grade',
              to: 'agent-high',
            },
          ];
          const allowed = createTransferFixture({
            assigneeMemberId: 'agent-high',
            delegationChain,
          });
          const refused = createTransferFixture({
            assigneeMemberId: 'agent-high',
            delegationChain,
          });

          await expect(
            transferTo(allowed, 'agent-equal', 'agent-high'),
          ).resolves.toBeDefined();
          await expect(
            transferTo(refused, 'agent-low', 'agent-high'),
          ).rejects.toThrow(GRADE_MESSAGE);
        });

        it('does not apply the rule on a node that is not a manager chain', async (): Promise<void> => {
          const fixture = createTransferFixture({
            resolver: { memberIds: ['member-m2'], type: 'DIRECT' },
          });

          await expect(transferTo(fixture, 'agent-low')).resolves.toBeDefined();
        });

        it('reads the principal from the deciding candidate row, not only from the task', async (): Promise<void> => {
          // A parallel task keeps no delegation chain of its own; the one that
          // matters is on the row of the candidate who is deciding. agent-high
          // (grade 3) acts for member-m2 (grade 2), so a grade 2 target is
          // fine and a grade 1 target is not. Measured against the actor, the
          // grade 2 target would have been refused.
          const createCandidateFixture = (): ServiceFixture =>
            createTransferFixture({
              assigneeMemberId: null,
              candidates: [
                createTaskCandidate({
                  delegationChain: [
                    {
                      from: 'member-m2',
                      reason: 'ALL',
                      ruleId: 'delegation-rule-grade',
                      to: 'agent-high',
                    },
                  ],
                  id: 'candidate-delegated',
                  memberId: 'agent-high',
                  originalMemberId: 'member-m2',
                  sourceType: 'ORG_MANAGER_CHAIN',
                  taskId: 'task-1',
                }),
                createTaskCandidate({
                  id: 'candidate-m1',
                  memberId: 'member-m1',
                  sourceType: 'ORG_MANAGER_CHAIN',
                  taskId: 'task-1',
                }),
              ],
              decisionPolicy: { type: 'PARALLEL_ALL' },
              task: {
                assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
                candidateMemberIds: ['agent-high', 'member-m1'],
                decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
              },
            });

          await expect(
            transferTo(createCandidateFixture(), 'agent-equal', 'agent-high'),
          ).resolves.toBeDefined();
          await expect(
            transferTo(createCandidateFixture(), 'agent-low', 'agent-high'),
          ).rejects.toThrow(GRADE_MESSAGE);
        });

        it('measures a delegated sequential candidate against the member they act for', async (): Promise<void> => {
          // member-b (grade 2) holds the second seat for member-orig (grade 3).
          const createSequentialTransferFixture = (): ServiceFixture =>
            createSequentialDecisionFixture({
              activeIndex: 1,
              approverResolver: {
                minPositionLevel: 3,
                type: 'ORG_MANAGER_CHAIN',
              },
              candidateOverrides: {
                'member-b': {
                  delegationChain: [
                    {
                      from: 'member-orig',
                      reason: 'ALL',
                      ruleId: 'delegation-rule-grade',
                      to: 'member-b',
                    },
                  ],
                  originalMemberId: 'member-orig',
                },
              },
              ...createManagerChainOrg({
                grades: {
                  'agent-equal': 2,
                  'agent-high': 3,
                  'member-a': 2,
                  'member-b': 2,
                  'member-c': 3,
                  'member-orig': 3,
                },
                links: [],
              }),
            });
          const transferFrom = (
            fixture: ServiceFixture,
            transferToMemberId: string,
          ): Promise<unknown> =>
            fixture.service.decideTask({
              action: TaskDecisionActionEnum.TRANSFERRED,
              comment: null,
              decidedByMemberId: 'member-b',
              taskId: 'task-seq',
              transferToMemberId,
            });

          await expect(
            transferFrom(createSequentialTransferFixture(), 'agent-equal'),
          ).rejects.toThrow(
            '簽核節點「財務簽核」需由職等 3 以上的成員簽核，不能轉簽給職等不足的成員',
          );
          await expect(
            transferFrom(createSequentialTransferFixture(), 'agent-high'),
          ).resolves.toBeDefined();
        });

        it('does not check the grade of an ad-hoc task transfer', async (): Promise<void> => {
          const fixture = createTransferFixture({
            task: {
              adhocDirectiveId: 'directive-seed-1',
              adhocOriginTaskId: 'task-origin',
              adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
              isAdhoc: true,
            },
          });

          await expect(transferTo(fixture, 'agent-low')).resolves.toBeDefined();
        });

        it('leaves an SLA escalation alone', async (): Promise<void> => {
          const fixture = createTransferFixture();

          await expect(
            transferTo(fixture, 'agent-low', 'member-m2', {
              transferReason: SLA_ESCALATION_DELEGATION_REASON,
            }),
          ).resolves.toBeDefined();
        });
      });
    });
  });

  it('applies delegation when creating a user task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      delegationResolution: {
        delegationChain: [
          {
            from: 'member-finance',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-101',
          },
        ],
        finalAssigneeMemberId: 'member-101',
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-101',
        delegationChain: [
          {
            from: 'member-finance',
            reason: 'ALL',
            ruleId: 'delegation-rule-1',
            to: 'member-101',
          },
        ],
        originalAssigneeMemberId: 'member-finance',
      }),
    ]);
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        payload: expect.objectContaining({
          assigneeMemberId: 'member-101',
          originalAssigneeMemberId: 'member-finance',
        }),
      }),
    );
  });

  it('approves a task and completes the linear instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '同意',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '同意',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });
    expect(fixture.savedProcessToken).toMatchObject({
      currentNodeId: 'end',
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    expect(fixture.savedInstance).toMatchObject({
      completedAt: expect.any(Date),
      state: ApprovalInstanceStateEnum.APPROVED,
    });
    expect(
      fixture.notificationService.createInstanceCompletedNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: expect.objectContaining({
          id: 'instance-1',
          state: ApprovalInstanceStateEnum.APPROVED,
        }),
      }),
    );
    // Exactly once. The end node used to save a copy of the instance, leaving
    // the caller's `state` on RUNNING, so the completion guard on the way out
    // of `processRunningInstance` did not short-circuit and completed the case
    // a second time — notifying the initiator twice.
    expect(
      fixture.notificationService.createInstanceCompletedNotification,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.notificationService.resolveTaskNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: NotificationResolutionEnum.APPROVED,
        supersedeOthers: true,
      }),
    );
  });

  it('requires a rejection comment before rejecting a task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '   ',
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
      }),
    ).rejects.toThrow('Reject decision comment is required');
  });

  it('requires a return comment when the node opts into requireComment', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        returnBehavior: {
          allowReturn: true,
          allowedTargets: 'INITIATOR',
          requireComment: true,
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.RETURNED,
        comment: '   ',
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
      }),
    ).rejects.toThrow(
      'Return decision comment is required by workflow node task_finance',
    );
  });

  it('blocks rejection when the workflow node disables it', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowReject: false,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '不符合條件',
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
      }),
    ).rejects.toThrow('Workflow node task_finance does not allow rejection');
  });

  it('blocks transfer when the workflow node disables it', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowTransfer: false,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: null,
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
        transferToMemberId: 'member-manager',
      }),
    ).rejects.toThrow('Workflow node task_finance does not allow transfer');
  });

  it('rejects transferring a task to the initiator when the node excludes the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: null,
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
        transferToMemberId: 'member-001',
      }),
    ).rejects.toThrow('不能將任務轉交給申請人本人');
  });

  it('allows transferring a task to the initiator when the node does not exclude the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-001',
    });

    expect(
      fixture.savedTasks.some((task) => task.assigneeMemberId === 'member-001'),
    ).toBe(true);
  });

  it('accepts a return with a comment when requireComment is on', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        returnBehavior: {
          allowReturn: true,
          allowedTargets: 'INITIATOR',
          requireComment: true,
        },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.RETURNED,
      comment: '請補上發票影本',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision.action).toBe(TaskDecisionActionEnum.RETURNED);
    expect(decision.comment).toBe('請補上發票影本');
  });

  it('still allows an empty return comment when requireComment is not set', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.RETURNED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision.action).toBe(TaskDecisionActionEnum.RETURNED);
    expect(decision.comment).toBeNull();
  });

  it('stamps a manual transfer reason on the delegation chain', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-manager',
    });

    const transferredTask = fixture.savedTasks.find(
      (task) => task.assigneeMemberId === 'member-manager',
    );

    expect(transferredTask?.delegationChain).toEqual([
      {
        from: 'member-finance',
        reason: 'MANUAL_TRANSFER',
        ruleId: null,
        to: 'member-manager',
      },
    ]);
  });

  it('stamps the SLA escalation reason when the timeout hook drives the transfer', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowTransfer: false,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask(
      {
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: null,
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
        transferToMemberId: 'member-manager',
      },
      { transferReason: SLA_ESCALATION_DELEGATION_REASON },
    );

    const transferredTask = fixture.savedTasks.find(
      (task) => task.assigneeMemberId === 'member-manager',
    );

    expect(transferredTask?.delegationChain).toEqual([
      {
        from: 'member-finance',
        reason: 'SLA_ESCALATION',
        ruleId: null,
        to: 'member-manager',
      },
    ]);
  });

  it('rejects a task with a rejection comment', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '  資料不足，請補件  ',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '資料不足，請補件',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
        payload: expect.objectContaining({
          action: TaskDecisionActionEnum.REJECTED,
          comment: '資料不足，請補件',
        }),
      }),
    );
    expect(fixture.savedInstance).toMatchObject({
      completedAt: expect.any(Date),
      state: ApprovalInstanceStateEnum.REJECTED,
    });
    expect(
      fixture.notificationService.resolveTaskNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: NotificationResolutionEnum.REJECTED,
        supersedeOthers: true,
      }),
    );
  });

  it('transfers a task without advancing the token', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: '請改由財務主管處理',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-101',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.TRANSFERRED,
      transferToMemberId: 'member-101',
    });
    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-1',
          status: TaskStatusEnum.TRANSFERRED,
        }),
        expect.objectContaining({
          assigneeMemberId: 'member-101',
          delegationChain: [
            {
              from: 'member-finance',
              reason: 'MANUAL_TRANSFER',
              ruleId: null,
              to: 'member-101',
            },
          ],
          isAdhoc: false,
          originalAssigneeMemberId: 'member-finance',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ]),
    );
    expect(fixture.savedProcessToken).toBeNull();
    expect(fixture.savedActivityLogs.map((log) => log.eventType)).toEqual([
      ActivityLogEventTypeEnum.TASK_DECIDED,
      ActivityLogEventTypeEnum.TASK_CREATED,
    ]);
    expect(
      fixture.notificationService.resolveTaskNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: NotificationResolutionEnum.TRANSFERRED,
        supersedeOthers: true,
      }),
    );
  });

  it('keeps the ad-hoc fields when an ad-hoc task is transferred', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        adhocDirectiveId: 'directive-seed-1',
        adhocOriginTaskId: 'task-origin',
        adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        assigneeMemberId: 'member-finance',
        isAdhoc: true,
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-101',
    });

    // The replacement is still the pre-approval: the pre-approval rejection
    // path reads adhocType / adhocDirectiveId / adhocOriginTaskId off it, and
    // hosts read isAdhoc to tell it from the node's own task.
    expect(
      fixture.savedTasks.find((task) => task.assigneeMemberId === 'member-101'),
    ).toMatchObject({
      adhocDirectiveId: 'directive-seed-1',
      adhocOriginTaskId: 'task-origin',
      adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
      isAdhoc: true,
      status: TaskStatusEnum.PENDING,
    });
  });

  it('lets a cast vote reach history before the countersign finishes', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: [
        createTaskCandidate({
          id: 'candidate-d',
          memberId: 'member-d',
          status: TaskCandidateStatusEnum.COMPLETED,
          taskId: 'task-90',
        }),
      ],
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    // The root task query is a plain stub, so it is given the matcher here:
    // asserting on rows is only meaningful if the stub actually answers the
    // question it was asked.
    fixture.rootTaskFind.mockImplementation((options) =>
      Promise.resolve(
        [
          createTask({
            assigneeMemberId: 'member-d',
            assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
            candidateMemberIds: ['member-d', 'member-e'],
            decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
            id: 'task-90',
            status: TaskStatusEnum.IN_PROGRESS,
          }),
        ].filter((task) =>
          matchesFindWhere(
            task,
            options.where as Readonly<Record<string, unknown>>,
          ),
        ),
      ),
    );

    // The task is still open for member-e, so the direct branch — which asks
    // for COMPLETED tasks assigned to this member — returns nothing. Only the
    // candidate branch can surface it, and it does so because the member's own
    // candidate row is COMPLETED. Requiring the task itself to be COMPLETED
    // hid their vote for as long as the countersign waited on somebody else,
    // by which time the inbox has correctly stopped showing it to them.
    await expect(
      fixture.service.listApprovalHistoryTasks('member-d'),
    ).resolves.toMatchObject([{ id: 'task-90' }]);
  });

  it('drops a task from the inbox once this member has decided it', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: [
        createTaskCandidate({
          id: 'candidate-d',
          memberId: 'member-d',
          status: TaskCandidateStatusEnum.COMPLETED,
          taskId: 'task-90',
        }),
        createTaskCandidate({
          id: 'candidate-e',
          memberId: 'member-e',
          status: TaskCandidateStatusEnum.PENDING,
          taskId: 'task-90',
        }),
      ],
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    fixture.rootTaskFind.mockResolvedValue([
      createTask({
        // Deciding on a group task writes the decider here, which is what kept
        // the task in their inbox after they had already voted.
        assigneeMemberId: 'member-d',
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        candidateMemberIds: ['member-d', 'member-e'],
        decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
        id: 'task-90',
        status: TaskStatusEnum.IN_PROGRESS,
      }),
    ]);

    // member-d has voted and cannot act again — opening it raises "was already
    // decided by this member" — while the task is legitimately still open for
    // member-e.
    await expect(fixture.service.listInboxTasks('member-d')).resolves.toEqual(
      [],
    );
    await expect(
      fixture.service.listInboxTasks('member-e'),
    ).resolves.toMatchObject([{ id: 'task-90' }]);
  });

  it('lists pending inbox tasks by assignee', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listInboxTasks('member-finance');

    expect(fixture.rootTaskFind).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      where: [
        {
          assigneeMemberId: 'member-finance',
          status: expect.any(Object),
        },
      ],
    });
  });

  describe('workflow dashboard summary', (): void => {
    // A sequential chain on instance-1 (member-a already approved, member-b
    // holds it, member-c is still WAITING), plus member-a's own direct tasks
    // on instance-2 and instance-3, plus a task of the administrator's.
    const past = new Date('2020-01-01T00:00:00.000Z');
    const future = new Date('2999-01-01T00:00:00.000Z');
    const dashboardTasks = [
      createTask({
        assigneeMemberId: 'member-b',
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        id: 'task-chain',
        instanceId: 'instance-1',
        slaDueAt: past,
      }),
      createTask({
        assigneeMemberId: 'member-a',
        id: 'task-a-2',
        instanceId: 'instance-2',
        slaDueAt: past,
      }),
      createTask({
        assigneeMemberId: 'member-a',
        id: 'task-a-3',
        instanceId: 'instance-3',
        slaDueAt: future,
        status: TaskStatusEnum.IN_PROGRESS,
      }),
      // A PARALLEL_ALL countersign: member-d has voted (the decider is written
      // into the task's assignee), member-e is still to vote and member-f has
      // claimed it.
      createTask({
        assigneeMemberId: 'member-d',
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
        id: 'task-parallel',
        instanceId: 'instance-3',
        status: TaskStatusEnum.IN_PROGRESS,
      }),
      createTask({
        assigneeMemberId: 'member-admin',
        id: 'task-admin-4',
        instanceId: 'instance-4',
        slaDueAt: past,
      }),
    ];
    const dashboardCandidates = [
      createTaskCandidate({
        id: 'candidate-a',
        memberId: 'member-a',
        sequence: 0,
        status: TaskCandidateStatusEnum.COMPLETED,
        taskId: 'task-chain',
      }),
      createTaskCandidate({
        id: 'candidate-b',
        memberId: 'member-b',
        sequence: 1,
        status: TaskCandidateStatusEnum.PENDING,
        taskId: 'task-chain',
      }),
      createTaskCandidate({
        id: 'candidate-c',
        memberId: 'member-c',
        sequence: 2,
        status: TaskCandidateStatusEnum.WAITING,
        taskId: 'task-chain',
      }),
      createTaskCandidate({
        id: 'candidate-d',
        memberId: 'member-d',
        status: TaskCandidateStatusEnum.COMPLETED,
        taskId: 'task-parallel',
      }),
      createTaskCandidate({
        id: 'candidate-e',
        memberId: 'member-e',
        status: TaskCandidateStatusEnum.PENDING,
        taskId: 'task-parallel',
      }),
      createTaskCandidate({
        id: 'candidate-f',
        memberId: 'member-f',
        status: TaskCandidateStatusEnum.CLAIMED,
        taskId: 'task-parallel',
      }),
    ];

    function createDashboardFixture(): ServiceFixture {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processTaskCandidates: dashboardCandidates,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      // The administrator reads all four instances; anyone else goes through
      // the readable-instance filter (the `readableMemberId` condition), which
      // here leaves out instance-4. Whatever the member can read, the counters
      // still have to be personal.
      let readableFilterApplied = false;

      fixture.rootInstanceQueryBuilder.andWhere.mockImplementation((sql) => {
        readableFilterApplied =
          readableFilterApplied || sql.includes(':readableMemberId');

        return fixture.rootInstanceQueryBuilder;
      });
      fixture.rootInstanceQueryBuilder.getMany.mockImplementation(() => {
        const ids = readableFilterApplied
          ? ['instance-1', 'instance-2', 'instance-3']
          : ['instance-1', 'instance-2', 'instance-3', 'instance-4'];

        readableFilterApplied = false;

        return Promise.resolve(ids.map((id) => createApprovalInstance({ id })));
      });
      fixture.rootTaskFind.mockImplementation((options) => {
        const where = options.where as
          | Readonly<Record<string, unknown>>
          | readonly Readonly<Record<string, unknown>>[];
        const clauses = Array.isArray(where) ? where : [where];

        return Promise.resolve(
          dashboardTasks.filter((task) =>
            clauses.some((clause) => matchesFindWhere(task, clause)),
          ),
        );
      });

      return fixture;
    }

    it('counts only the tasks that are the member\'s own to act on', async (): Promise<void> => {
      const fixture = createDashboardFixture();

      await expect(
        fixture.service.readWorkflowDashboardSummary(
          createAuthContext('member-a'),
        ),
      ).resolves.toMatchObject({
        overdueTaskCount: 1,
        pendingTaskCount: 2,
        totalInstanceCount: 3,
      });
      // The chain's current holder has the one task, and it is past due.
      await expect(
        fixture.service.readWorkflowDashboardSummary(
          createAuthContext('member-b'),
        ),
      ).resolves.toMatchObject({ overdueTaskCount: 1, pendingTaskCount: 1 });
      // A WAITING candidate has not been reached yet: nothing is theirs.
      await expect(
        fixture.service.readWorkflowDashboardSummary(
          createAuthContext('member-c'),
        ),
      ).resolves.toMatchObject({ overdueTaskCount: 0, pendingTaskCount: 0 });
    });

    it('matches the length of the same member\'s inbox', async (): Promise<void> => {
      const fixture = createDashboardFixture();

      // One at a time: the fixture's readable-instance flag is shared state.
      await ['member-a', 'member-b', 'member-c'].reduce(
        async (previous, memberId): Promise<void> => {
          await previous;

          const summary = await fixture.service.readWorkflowDashboardSummary(
            createAuthContext(memberId),
          );

          expect(summary.pendingTaskCount).toBe(
            (await fixture.service.listInboxTasks(memberId)).length,
          );
        },
        Promise.resolve(),
      );
    });

    it('does not count a countersign the member has already voted on, but counts one still waiting on them or claimed by them', async (): Promise<void> => {
      const fixture = createDashboardFixture();
      const read = async (
        memberId: string,
      ): Promise<readonly [number, number]> => [
        (
          await fixture.service.readWorkflowDashboardSummary(
            createAuthContext(memberId),
          )
        ).pendingTaskCount,
        (await fixture.service.listInboxTasks(memberId)).length,
      ];

      // member-d is still the task's assignee, but their own candidate row is
      // COMPLETED: it is no longer theirs, dashboard and inbox alike.
      await expect(read('member-d')).resolves.toEqual([0, 0]);
      await expect(read('member-e')).resolves.toEqual([1, 1]);
      await expect(read('member-f')).resolves.toEqual([1, 1]);
    });

    it('does not count other people\'s tasks for an administrator who can read every instance', async (): Promise<void> => {
      const fixture = createDashboardFixture();

      // The administrator reads all four instances, the requester only three,
      // so the role changes what is in range...
      await expect(
        fixture.service.readWorkflowDashboardSummary({
          ...createAuthContext('member-admin'),
          roles: ['BPM_ADMIN'],
        }),
      ).resolves.toMatchObject({
        overdueTaskCount: 1,
        pendingTaskCount: 1,
        totalInstanceCount: 4,
      });
      // ...but not whose tasks are counted: the administrator's own one only.
      await expect(
        fixture.service.readWorkflowDashboardSummary({
          ...createAuthContext('member-a'),
          roles: ['BPM_ADMIN'],
        }),
      ).resolves.toMatchObject({
        overdueTaskCount: 1,
        pendingTaskCount: 2,
        totalInstanceCount: 4,
      });
      await expect(
        fixture.service.readWorkflowDashboardSummary(
          createAuthContext('member-admin'),
        ),
      ).resolves.toMatchObject({ totalInstanceCount: 3 });
    });

    it('leaves the task counters out of an instance range the member\'s tasks are not in', async (): Promise<void> => {
      const fixture = createDashboardFixture();

      // instance-3 is out of range, instance-1 is in range but not theirs.
      fixture.rootInstanceQueryBuilder.getMany.mockResolvedValue([
        createApprovalInstance({ id: 'instance-1' }),
        createApprovalInstance({ id: 'instance-2' }),
      ]);

      await expect(
        fixture.service.readWorkflowDashboardSummary(
          createAuthContext('member-a'),
        ),
      ).resolves.toMatchObject({ overdueTaskCount: 1, pendingTaskCount: 1 });
    });
  });

  it('lists completed approval history tasks by assignee', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listApprovalHistoryTasks('member-finance');

    expect(fixture.rootTaskFind).toHaveBeenCalledWith({
      order: { completedAt: 'DESC', createdAt: 'DESC' },
      take: 50,
      where: {
        assigneeMemberId: 'member-finance',
        status: TaskStatusEnum.COMPLETED,
      },
    });
  });

  it('counts and pages filtered approval instances without loading an unpaged list in the client', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const instances = [
      createApprovalInstance({
        id: 'purchase-1',
        title: '採購請款 A',
      }),
      createApprovalInstance({
        id: 'purchase-2',
        title: '採購請款 B',
      }),
      createApprovalInstance({
        id: 'leave-1',
        title: '請假申請',
      }),
    ];

    fixture.rootInstanceFind.mockResolvedValue(instances);
    fixture.rootInstanceQueryBuilder.getMany.mockResolvedValue([instances[0]]);
    fixture.rootInstanceCount.mockResolvedValue(2);

    await expect(
      fixture.service.listApprovalInstances(undefined, {
        page: 1,
        pageSize: 1,
        searchText: '採購',
        view: ApprovalInstanceListViewEnum.ALL,
      }),
    ).resolves.toEqual([instances[0]]);
    await expect(
      fixture.service.countApprovalInstances(undefined, {
        searchText: '採購',
        view: ApprovalInstanceListViewEnum.ALL,
      }),
    ).resolves.toBe(2);
    await expect(
      fixture.service.readApprovalInstancePageInfo(undefined, {
        page: 1,
        pageSize: 1,
        searchText: '採購',
        view: ApprovalInstanceListViewEnum.ALL,
      }),
    ).resolves.toEqual({
      hasNextPage: true,
      hasPreviousPage: false,
      page: 1,
      pageSize: 1,
      totalCount: 2,
      totalPages: 2,
    });
    expect(fixture.rootInstanceQueryBuilder.skip).toHaveBeenCalledWith(0);
    expect(fixture.rootInstanceQueryBuilder.take).toHaveBeenCalledWith(1);
    expect(fixture.rootInstanceQueryBuilder.getMany).toHaveBeenCalledTimes(1);
    expect(fixture.rootInstanceCount).toHaveBeenCalledTimes(2);
  });

  it('filters readable approval instances with SQL EXISTS conditions instead of loading readable id lists', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listApprovalInstances(
      createAuthContext('member-finance'),
      {
        page: 1,
        pageSize: 20,
        view: ApprovalInstanceListViewEnum.ALL,
      },
    );

    expect(fixture.rootInstanceQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('FROM "task_candidates"'),
      { readableMemberId: 'member-finance' },
    );
    expect(fixture.rootInstanceQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('FROM "task_decisions"'),
      { readableMemberId: 'member-finance' },
    );
    expect(fixture.rootTaskFind).not.toHaveBeenCalled();
    expect(fixture.notificationFind).not.toHaveBeenCalled();
  });

  it('filters CC approval instances with a notification EXISTS condition', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listApprovalInstances(
      createAuthContext('member-finance'),
      {
        view: ApprovalInstanceListViewEnum.CC,
      },
    );

    expect(fixture.rootInstanceQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('FROM "notifications"'),
      { readableMemberId: 'member-finance' },
    );
    expect(fixture.notificationFind).not.toHaveBeenCalled();
  });

  it('routes an exclusive gateway through the first matching condition', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-high',
        nodeId: 'task_high',
        status: TaskStatusEnum.PENDING,
      }),
    ]);
  });

  it('completes an exclusive gateway branch after the selected task is approved', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const taskHigh = readTaskByNodeId(fixture.savedTasks, 'task_high');

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskHigh.assigneeMemberId ?? '',
      taskId: taskHigh.id,
    });

    expect(fixture.savedInstance).toMatchObject({
      state: ApprovalInstanceStateEnum.APPROVED,
    });
    expect(fixture.savedWorkflowTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentNodeId: 'end',
          status: WorkflowTokenStatusEnum.CONSUMED,
        }),
      ]),
    );
  });

  it('routes an exclusive gateway through the default edge when no condition matches', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-default',
        nodeId: 'task_default',
        status: TaskStatusEnum.PENDING,
      }),
    ]);
  });

  it('routes an exclusive gateway with a pure CEL edge expression', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow({
        highCondition:
          'form.amount > 1000 && initiator.memberId == "member-001"',
        includeStructuredCondition: false,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-high',
        nodeId: 'task_high',
        status: TaskStatusEnum.PENDING,
      }),
    ]);
  });

  describe('a multiple-selection condition saved with single-value CEL', (): void => {
    // Definitions saved before the designer compiled multiple-selection fields
    // with list semantics: the CEL compares the whole list to one option, so it
    // is never true for `["urgent"]`. The structured fields saved beside it are
    // what the edge means.
    const legacyWorkflow = (
      operator: WorkflowEdgeConditionOperator,
      condition: string,
    ): WorkflowDefinition =>
      createExclusiveGatewayWorkflow({
        highCondition: condition,
        structuredCondition: {
          conditionFieldKey: 'tags',
          conditionOperator: operator,
          ...(operator === 'IS_FILLED' ? {} : { conditionValue: 'urgent' }),
        },
      });
    const processWith = async (
      workflow: WorkflowDefinition,
      formData: Readonly<Record<string, unknown>>,
    ): Promise<string | undefined> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: formData,
        processWorkflowSnapshot: workflow,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      return fixture.savedTasks[0]?.nodeId;
    };

    it.each([
      ['EQUALS', 'form.tags == "urgent"', ['urgent', 'vip'], 'task_high'],
      ['EQUALS', 'form.tags == "urgent"', ['vip'], 'task_default'],
      ['NOT_EQUALS', 'form.tags != "urgent"', ['urgent'], 'task_default'],
      ['NOT_EQUALS', 'form.tags != "urgent"', ['vip'], 'task_high'],
      ['IS_FILLED', 'form.tags != null && form.tags != ""', [], 'task_default'],
      [
        'IS_FILLED',
        'form.tags != null && form.tags != ""',
        ['vip'],
        'task_high',
      ],
    ] as const)(
      'routes %s (%s) on %j to %s',
      async (operator, condition, tags, expectedNodeId): Promise<void> => {
        await expect(
          processWith(legacyWorkflow(operator, condition), { tags }),
        ).resolves.toBe(expectedNodeId);
      },
    );

    // cel-js does not treat an array built in the jest VM realm as a list, so
    // the legacy CEL does not reproduce its production answer here. These pin
    // the precedence instead: a CEL that answers the opposite way must lose to
    // the structured fields whenever the value is a list.
    it.each([
      ['false', ['urgent'], 'task_high'],
      ['true', ['vip'], 'task_default'],
    ] as const)(
      'ignores a CEL of %s for a list value %j and routes to %s',
      async (condition, tags, expectedNodeId): Promise<void> => {
        await expect(
          processWith(legacyWorkflow('EQUALS', condition), { tags }),
        ).resolves.toBe(expectedNodeId);
      },
    );

    it('reports the dry run match from the structured condition', (): void => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      const result = fixture.service.dryRunApprovalWorkflow({
        formDataJson: '{"tags":["urgent"]}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        workflowDefinitionJson: JSON.stringify(
          legacyWorkflow('EQUALS', 'false'),
        ),
      });

      expect(result.valid).toBe(true);
      expect(result.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            edgeMatched: true,
            nodeId: 'task_high',
          }),
        ]),
      );
    });

    it('still evaluates the CEL when the value is not a list', async (): Promise<void> => {
      // The CEL and the structured fields disagree here, so the route shows
      // which one ran: only the CEL matches "urgent".
      await expect(
        processWith(
          createExclusiveGatewayWorkflow({
            highCondition: 'form.tags == "urgent"',
            structuredCondition: {
              conditionFieldKey: 'tags',
              conditionOperator: 'EQUALS',
              conditionValue: 'vip',
            },
          }),
          { tags: 'urgent' },
        ),
      ).resolves.toBe('task_high');
    });

    it('still evaluates a CEL edge with no structured fields', async (): Promise<void> => {
      // With no structured fields the structured evaluator answers false, so
      // reaching task_high means the CEL ran. (List operators such as `in` are
      // not usable here: cel-js does not recognise an array built in the jest
      // VM realm as a list.)
      await expect(
        processWith(
          createExclusiveGatewayWorkflow({
            highCondition: 'form.tags != null',
            includeStructuredCondition: false,
          }),
          { tags: ['urgent'] },
        ),
      ).resolves.toBe('task_high');
    });
  });

  it('reports dry run edge labels, default routing, and entry condition results', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{"amount":500}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(createExclusiveGatewayWorkflow()),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeDefault: true,
          edgeLabel: '其他情況',
          edgeMatched: true,
          edgeReason: '其他條件不符合時採用預設路徑。',
          nodeId: 'task_default',
          status: 'WAITING',
        }),
      ]),
    );
  });

  it('reports a dry run step as skipped when the initiator is the only approver and the node skips', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(
        createExcludeInitiatorTwoStepWorkflow({ whenEmpty: 'SKIP_NODE' }),
      ),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: null,
          nodeId: 'task_finance',
          status: 'SKIPPED',
        }),
        expect.objectContaining({
          assigneeMemberId: 'member-next',
          nodeId: 'task_next',
          status: 'WAITING',
        }),
      ]),
    );
  });

  it('stops a dry run branch when the initiator is the only approver and whenEmpty is FAIL', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(
        createExcludeInitiatorTwoStepWorkflow({ whenEmpty: 'FAIL' }),
      ),
    });

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'task_finance',
          status: 'STOPPED',
        }),
      ]),
    );
    expect(result.steps.map((step) => step.nodeId)).not.toContain('task_next');
  });

  it('uses the snapshot manager in a dry run when whenEmpty is INITIATOR_MANAGER', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: JSON.stringify({
        managerMemberId: 'member-manager',
      }),
      workflowDefinitionJson: JSON.stringify(
        createExcludeInitiatorTwoStepWorkflow({
          whenEmpty: 'INITIATOR_MANAGER',
        }),
      ),
    });

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-manager',
          nodeId: 'task_finance',
          status: 'WAITING',
        }),
      ]),
    );
  });

  it('reflects the exclusion in a dry run when the snapshot manager is the initiator', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: JSON.stringify({
        managerMemberId: 'member-001',
      }),
      workflowDefinitionJson: JSON.stringify(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
          excludeInitiator: { whenEmpty: 'SKIP_NODE' },
        }),
      ),
    });

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: null,
          nodeId: 'task_finance',
          status: 'SKIPPED',
        }),
      ]),
    );
  });

  it('hands a unit head initiator to the next manager level in a dry run', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: JSON.stringify({
        managerChain: ['member-001', 'member-ceo'],
      }),
      workflowDefinitionJson: JSON.stringify(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
          excludeInitiator: { whenEmpty: 'INITIATOR_MANAGER' },
        }),
      ),
    });

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-ceo',
          nodeId: 'task_finance',
          status: 'WAITING',
        }),
      ]),
    );
  });

  it('ends a dry run branch at a NOTIFY node instead of demanding an outgoing edge', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    const workflow: WorkflowDefinition = {
      edges: [
        { data: {}, id: 'edge_start_notify', source: 'start', target: 'notify', type: 'smoothstep' },
        { data: {}, id: 'edge_start_end', source: 'start', target: 'end', type: 'smoothstep' },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        { data: { label: '開始' }, id: 'start', position: { x: 0, y: 0 }, type: 'startEvent' },
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: [], type: 'DIRECT' },
              type: 'NOTIFY',
              webhooks: [{ bindings: [], endpoint: { key: 'erp.po', version: 1 }, id: 'wh' }],
            },
            label: '通知 ERP',
          },
          id: 'notify',
          position: { x: 200, y: 100 },
          type: 'serviceTask',
        },
        { data: { endState: 'APPROVED', label: '完成' }, id: 'end', position: { x: 400, y: 0 }, type: 'endEvent' },
      ],
    } as WorkflowDefinition;

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(workflow),
    });

    expect(result.errors).toEqual([]);
    expect(result.steps.map((step) => [step.nodeId, step.message])).toEqual([
      ['start', '節點條件通過。'],
      ['notify', '將發送知會，此分支不會繼續往下。'],
      ['end', '流程結束：APPROVED'],
    ]);
  });

  it('falls back to the top-level manager id when custom fields carry none', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: JSON.stringify({
        customFields: {},
        managerMemberId: 'member-manager',
        memberId: 'member-001',
      }),
      workflowDefinitionJson: JSON.stringify(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      ),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-manager',
          nodeId: 'task_finance',
        }),
      ]),
    );
  });

  it('prefers the manager id carried by custom fields', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: JSON.stringify({
        customFields: { managerMemberId: 'member-custom' },
        managerMemberId: 'member-manager',
        memberId: 'member-001',
      }),
      workflowDefinitionJson: JSON.stringify(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      ),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-custom',
          nodeId: 'task_finance',
        }),
      ]),
    );
  });

  it('reports dry run matches for pure CEL edge expressions', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{"amount":1500}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(
        createExclusiveGatewayWorkflow({
          highCondition:
            'form.amount > 1000 && initiator.memberId == "member-001"',
          includeStructuredCondition: false,
        }),
      ),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeDefault: false,
          edgeLabel: '金額大於 1000',
          edgeMatched: true,
          edgeReason:
            '條件成立：form.amount > 1000 && initiator.memberId == "member-001"',
          nodeId: 'task_high',
          status: 'WAITING',
        }),
      ]),
    );
  });

  describe('dry run with an approver that cannot be resolved', (): void => {
    const runDryRun = (
      workflow: WorkflowDefinition,
      options: {
        readonly formDataJson?: string;
        readonly initiatorMetadataSnapshotJson?: string | null;
      } = {},
    ): ReturnType<WorkflowEngineService['dryRunApprovalWorkflow']> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      }).service.dryRunApprovalWorkflow({
        formDataJson: options.formDataJson ?? '{}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson:
          options.initiatorMetadataSnapshotJson ?? null,
        workflowDefinitionJson: JSON.stringify(workflow),
      });

    it('stops at a DIRECT node with nobody chosen and names it by label', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: { memberIds: [], type: 'DIRECT' },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.steps).toEqual([
        expect.objectContaining({ nodeId: 'start', status: 'PASSED' }),
        expect.objectContaining({
          assigneeMemberId: null,
          message:
            '簽核節點「財務簽核」尚未選擇簽核人，請在流程設計器點選此節點設定簽核人',
          nodeId: 'task_finance',
          status: 'STOPPED',
        }),
      ]);
    });

    it('keeps the steps before the unassigned node and ends only that branch', (): void => {
      const result = runDryRun(
        withNodeData(
          createExcludeInitiatorTwoStepWorkflow({
            whenEmpty: 'INITIATOR_MANAGER',
          }),
          'task_next',
          { approverResolver: { memberIds: [], type: 'DIRECT' } },
        ),
        {
          initiatorMetadataSnapshotJson: JSON.stringify({
            managerMemberId: 'member-manager',
          }),
        },
      );

      expect(result.valid).toBe(true);
      expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
        ['start', 'PASSED'],
        ['task_finance', 'WAITING'],
        ['task_next', 'STOPPED'],
      ]);
      expect(result.steps[2].message).toBe(
        '簽核節點「下一關」尚未選擇簽核人，請在流程設計器點選此節點設定簽核人',
      );
    });

    it('stops an unassigned node even when it excludes the initiator', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: { memberIds: [], type: 'DIRECT' },
          excludeInitiator: { whenEmpty: 'FAIL' },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核節點「財務簽核」尚未選擇簽核人，請在流程設計器點選此節點設定簽核人',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('stops a DYNAMIC_FORM node whose form field is empty', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: { formPath: 'approver', type: 'DYNAMIC_FORM' },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核節點「財務簽核」依表單欄位找不到簽核人，請確認試跑資料中該欄位有填人員',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('stops an EXPRESSION node whose expression yields nobody', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: { expression: '[]', type: 'EXPRESSION' },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message: '簽核節點「財務簽核」依運算式找不到簽核人，請確認運算式的結果',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('stops an ORG_MANAGER node when the initiator snapshot names no manager', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核節點「財務簽核」依申請人的組織找不到主管，請確認試跑時的申請人資料',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('stops at an exclusive gateway when no branch matches and there is no default', (): void => {
      const workflow = createExclusiveGatewayWorkflow();
      const result = runDryRun(
        {
          ...workflow,
          edges: workflow.edges.filter(
            (edge) => edge.id !== 'edge_gateway_default',
          ),
        },
        { formDataJson: '{"amount":500}' },
      );

      expect(result.valid).toBe(true);
      expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
        ['start', 'PASSED'],
        ['gateway_amount', 'STOPPED'],
      ]);
      expect(result.steps[1].message).toBe(
        '節點「金額分流」的連出線條件都不符合，且沒有設定預設路徑，請檢查連出線的條件或補上預設路徑',
      );
    });

    it('stops at a node that has no outgoing edge', (): void => {
      const workflow = createLinearUserTaskWorkflow();
      const result = runDryRun({
        ...workflow,
        edges: workflow.edges.filter((edge) => edge.id !== 'edge_task_end'),
      });

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message:
          '節點「財務簽核」沒有連到下一個節點，請在流程設計器為此節點接上連線',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('keeps saying why a skipped node was skipped when it also has no outgoing edge', (): void => {
      const workflow = createExcludeInitiatorTwoStepWorkflow({
        whenEmpty: 'SKIP_NODE',
      });
      const result = runDryRun({
        ...workflow,
        edges: workflow.edges.filter((edge) => edge.id !== 'edge_task_next'),
      });

      expect(result.valid).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核人只有申請人本人，依設定略過節點。節點「財務簽核」沒有連到下一個節點，請在流程設計器為此節點接上連線',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('uses a fixed fallback when the initiator snapshot names no manager', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { memberId: 'member-fallback', type: 'DIRECT' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.valid).toBe(true);
      expect(
        result.steps.find((step) => step.nodeId === 'task_finance'),
      ).toMatchObject({
        assigneeMemberId: 'member-fallback',
        status: 'WAITING',
      });
    });

    it('does not fall back to the initiator unless the node allows self-approval', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { memberId: 'member-001', type: 'DIRECT' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核節點「財務簽核」找不到主管，且改派固定人是申請人本人，此節點未允許申請人自簽',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('explains an unsupported fallback type in the dry run instead of blaming the org chart', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { type: 'FUTURE_KIND' } as unknown as {
              readonly type: 'NONE';
            },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.steps.at(-1)).toMatchObject({
        message:
          '簽核節點「財務簽核」找不到主管，且此引擎版本不支援該改派設定，請升級 BPMCore 後再試',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('says the fallback member is not set when a manager fallback names nobody', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { memberId: '  ', type: 'DIRECT' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.steps.at(-1)).toMatchObject({
        message: '簽核節點「財務簽核」找不到主管，且改派固定人未設定',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('shows a POSITION fallback the way a POSITION node is shown in a dry run', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { positionId: 'position-cfo', type: 'POSITION' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(
        result.steps.find((step) => step.nodeId === 'task_finance'),
      ).toMatchObject({
        assigneeMemberId: 'position:position-cfo',
        status: 'WAITING',
      });
    });

    it('says the POSITION fallback is not set when its position id is blank', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: {
            baseFromInitiator: true,
            fallback: { positionId: '  ', type: 'POSITION' },
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
      );

      expect(result.steps.at(-1)).toMatchObject({
        message: '簽核節點「財務簽核」找不到主管，且改派職位未設定',
        nodeId: 'task_finance',
        status: 'STOPPED',
      });
    });

    it('keeps a placeholder assignee for resolvers that need the organisation', (): void => {
      const result = runDryRun(
        createLinearUserTaskWorkflow({
          approverResolver: { positionId: 'position-cfo', type: 'POSITION' },
        }),
      );

      expect(
        result.steps.find((step) => step.nodeId === 'task_finance'),
      ).toMatchObject({
        assigneeMemberId: 'position:position-cfo',
        status: 'WAITING',
      });
    });

    it('keeps running a sibling branch after another branch is stopped', (): void => {
      const result = runDryRun(
        withNodeData(createParallelApprovalWorkflow('AND'), 'task_a', {
          approverResolver: { memberIds: [], type: 'DIRECT' },
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 'task_a', status: 'STOPPED' }),
          expect.objectContaining({ nodeId: 'task_b', status: 'WAITING' }),
        ]),
      );
    });
  });

  describe('runtime approver resolution errors name the org and the position', (): void => {
    const processWith = (
      approverResolver: ApproverResolver,
      options: {
        readonly processOrgUnits?: readonly OrgUnitEntity[];
        readonly processPositions?: readonly PositionEntity[];
      },
    ): Promise<void> =>
      createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processOrgUnits: options.processOrgUnits,
        processPositions: options.processPositions,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver,
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      }).service.processInstance('instance-1');

    it('names the organisation when ORG_UNIT_MEMBER finds no active member', async (): Promise<void> => {
      const attempt = processWith(
        { orgUnitId: 'org-empty', type: 'ORG_UNIT_MEMBER' },
        {
          processOrgUnits: [
            createOrgUnit({
              id: 'org-empty',
              name: '空組織',
              path: 'org.empty',
            }),
          ],
        },
      );

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        '簽核節點「財務簽核」 找不到簽核人：組織「空組織」目前沒有任何有效成員，請先將人員加入該組織',
      );
    });

    it('names the position when POSITION finds no active member', async (): Promise<void> => {
      const attempt = processWith(
        { positionId: 'position-cfo', type: 'POSITION' },
        {
          processPositions: [
            createPosition({ id: 'position-cfo', name: '財務長' }),
          ],
        },
      );

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        '簽核節點「財務簽核」 找不到簽核人：職位「財務長」目前沒有任何有效成員',
      );
    });

    it('falls back to the id when the position row is missing', async (): Promise<void> => {
      await expect(
        processWith({ positionId: 'position-gone', type: 'POSITION' }, {}),
      ).rejects.toThrow('職位「position-gone」目前沒有任何有效成員');
    });

    it('names the organisation and the position when ORG_UNIT_POSITION finds no active member', async (): Promise<void> => {
      const attempt = processWith(
        {
          orgUnitId: 'org-empty',
          positionId: 'position-cfo',
          type: 'ORG_UNIT_POSITION',
        },
        {
          processOrgUnits: [
            createOrgUnit({
              id: 'org-empty',
              name: '空組織',
              path: 'org.empty',
            }),
          ],
          processPositions: [
            createPosition({ id: 'position-cfo', name: '財務長' }),
          ],
        },
      );

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        '簽核節點「財務簽核」 找不到簽核人：組織「空組織」的職位「財務長」目前沒有任何有效成員',
      );
    });

    it('reports an empty DYNAMIC_FORM field as no approver found', async (): Promise<void> => {
      await expect(
        processWith({ formPath: 'approver', type: 'DYNAMIC_FORM' }, {}),
      ).rejects.toThrow(
        '簽核節點「財務簽核」 依表單欄位「approver」找不到簽核人',
      );
    });

    it('names the expression as the source when an EXPRESSION resolver yields nobody', async (): Promise<void> => {
      await expect(
        processWith({ expression: '[]', type: 'EXPRESSION' }, {}),
      ).rejects.toThrow('簽核節點「財務簽核」 依運算式找不到簽核人');
    });

    it('reports an empty DIRECT resolver as no approver found', async (): Promise<void> => {
      await expect(
        processWith({ memberIds: [], type: 'DIRECT' }, {}),
      ).rejects.toThrow(/^簽核節點「財務簽核」 找不到簽核人$/);
    });

    it('says the organisation no longer exists when ORG_UNIT_MEMBER points at a missing org unit', async (): Promise<void> => {
      const attempt = processWith(
        { orgUnitId: 'org-gone', type: 'ORG_UNIT_MEMBER' },
        {},
      );

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        '簽核節點「財務簽核」 找不到簽核人：組織（org-gone）已不存在，請在流程設計器重新選擇組織',
      );
    });

    it('says the organisation no longer exists when ORG_UNIT_POSITION points at a missing org unit', async (): Promise<void> => {
      await expect(
        processWith(
          {
            orgUnitId: 'org-gone',
            positionId: 'position-cfo',
            type: 'ORG_UNIT_POSITION',
          },
          {},
        ),
      ).rejects.toThrow('組織（org-gone）已不存在');
    });

    it('reads the org unit once when it reports an empty organisation', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processOrgUnits: [
          createOrgUnit({ id: 'org-empty', name: '空組織', path: 'org.empty' }),
        ],
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: { orgUnitId: 'org-empty', type: 'ORG_UNIT_MEMBER' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow('組織「空組織」');
      expect(fixture.orgUnitFindOne).toHaveBeenCalledTimes(1);
    });

    it('does not look up names when the position resolves', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processMemberships: [
          createMembership({
            isPrimary: true,
            memberId: 'member-position-owner',
            positionId: 'position-finance',
          }),
        ],
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            positionId: 'position-finance',
            type: 'POSITION',
          },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(fixture.positionFindOne).not.toHaveBeenCalled();
    });

    it('words a notify recipient resolved through the manager chain as 通知, not 待簽任務', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createNotifyServiceTaskWorkflow({
          recipients: {
            baseFromInitiator: true,
            levelsUp: 1,
            type: 'ORG_MANAGER',
          },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await expect(
        fixture.service.processInstance('instance-1'),
      ).rejects.toThrow(
        '知會節點「財務知會」 無法建立通知：找不到發起人的第 1 層主管，且未設定改派固定人',
      );
    });

    it('keeps 待簽任務 wording when a task approver has no manager', async (): Promise<void> => {
      await expect(
        processWith(
          { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
          {},
        ),
      ).rejects.toThrow('無法建立待簽任務：找不到發起人的第 1 層主管');
    });
  });

  it('resubmits returned instances from the return point when configured', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      latestReturnActivity: createActivityLog({
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        nodeId: 'task_finance',
        payload: {
          resubmitStrategy: 'FROM_RETURN_POINT',
          returnedFromNodeId: 'task_finance',
          returnToNodeId: 'start',
          taskId: 'task-1',
        },
      }),
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.resubmitApprovalInstance({
      formDataJson: '{"amount":1200}',
      initiatorMemberId: 'member-001',
      instanceId: 'instance-1',
      title: null,
    });

    expect(fixture.savedWorkflowTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentNodeId: 'task_finance',
          status: WorkflowTokenStatusEnum.WAITING,
        }),
      ]),
    );
    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'task_finance',
          status: TaskStatusEnum.PENDING,
        }),
      ]),
    );
    expect(fixture.savedSingleActivityLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
          payload: { resubmitStrategy: 'FROM_RETURN_POINT' },
        }),
      ]),
    );
  });

  it('forks a token across multiple outgoing edges and creates parallel tasks', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('AND'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTasks.map((task) => ({
        assigneeMemberId: task.assigneeMemberId,
        nodeId: task.nodeId,
        status: task.status,
      })),
    ).toEqual([
      {
        assigneeMemberId: 'member-a',
        nodeId: 'task_a',
        status: TaskStatusEnum.PENDING,
      },
      {
        assigneeMemberId: 'member-b',
        nodeId: 'task_b',
        status: TaskStatusEnum.PENDING,
      },
    ]);
  });

  it('waits for every incoming branch before triggering an AND predecessor node', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('AND'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const taskA = readTaskByNodeId(fixture.savedTasks, 'task_a');
    const taskB = readTaskByNodeId(fixture.savedTasks, 'task_b');

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskA.assigneeMemberId ?? '',
      taskId: taskA.id,
    });

    expect(
      fixture.savedTasks.some((task) => task.nodeId === 'task_final'),
    ).toBe(false);
    expect(
      fixture.savedWorkflowTokens.some(
        (token) =>
          token.currentNodeId === 'task_final' &&
          token.status === WorkflowTokenStatusEnum.WAITING,
      ),
    ).toBe(true);

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskB.assigneeMemberId ?? '',
      taskId: taskB.id,
    });

    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-final',
          nodeId: 'task_final',
          status: TaskStatusEnum.PENDING,
        }),
      ]),
    );
  });

  it('triggers an OR predecessor node from the first completed branch and cancels alternatives', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('OR'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const taskA = readTaskByNodeId(fixture.savedTasks, 'task_a');
    const taskB = readTaskByNodeId(fixture.savedTasks, 'task_b');

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskA.assigneeMemberId ?? '',
      taskId: taskA.id,
    });

    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-final',
          nodeId: 'task_final',
          status: TaskStatusEnum.PENDING,
        }),
        expect.objectContaining({
          id: taskB.id,
          nodeId: 'task_b',
          status: TaskStatusEnum.CANCELLED,
        }),
      ]),
    );
  });

  it('allows an instance initiator to read the approval instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.getApprovalInstance(
        'instance-1',
        createAuthContext('member-001'),
      ),
    ).resolves.toMatchObject({ id: 'instance-1' });
  });

  it('allows a related task assignee to read the approval instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    fixture.rootTaskFind.mockResolvedValueOnce([
      createTask({ assigneeMemberId: 'member-202' }),
    ]);

    await expect(
      fixture.service.getApprovalInstance(
        'instance-1',
        createAuthContext('member-202'),
      ),
    ).resolves.toMatchObject({ id: 'instance-1' });
  });

  it('hides an approval instance from unrelated members', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.getApprovalInstance(
        'instance-1',
        createAuthContext('member-unrelated'),
      ),
    ).rejects.toThrow('Approval instance instance-1 was not found');
  });

  describe('reading an instance filed on the applicant behalf', () => {
    function createFiledForFixture(): ReturnType<typeof createServiceFixture> {
      return createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        submittedByMemberId: 'member-assistant',
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });
    }

    it('lets the member who submitted for the applicant read the instance', async (): Promise<void> => {
      const fixture = createFiledForFixture();

      await expect(
        fixture.service.getApprovalInstance(
          'instance-1',
          createAuthContext('member-assistant'),
        ),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });

    it('still hides it from an unrelated member', async (): Promise<void> => {
      const fixture = createFiledForFixture();

      await expect(
        fixture.service.getApprovalInstance(
          'instance-1',
          createAuthContext('member-unrelated'),
        ),
      ).rejects.toThrow('Approval instance instance-1 was not found');
    });

    it('does not let the applicant lose access when they also submitted it', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        submittedByMemberId: 'member-001',
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await expect(
        fixture.service.getApprovalInstance(
          'instance-1',
          createAuthContext('member-001'),
        ),
      ).resolves.toMatchObject({ id: 'instance-1' });
    });

    it('lists what an assistant filed in the SENT view and the ordinary readable view', async (): Promise<void> => {
      const fixture = createFiledForFixture();

      await fixture.service.listApprovalInstances(
        createAuthContext('member-assistant'),
        { view: ApprovalInstanceListViewEnum.SENT },
      );
      await fixture.service.listApprovalInstances(
        createAuthContext('member-assistant'),
        { view: ApprovalInstanceListViewEnum.ALL },
      );

      const filters = fixture.rootInstanceQueryBuilder.andWhere.mock.calls.filter(
        ([sql]) => String(sql).includes('"initiator_member_id"'),
      );

      expect(filters).toHaveLength(2);
      filters.forEach(([sql, params]) => {
        expect(String(sql)).toContain(
          '"approvalInstance"."submitted_by_member_id" = :readableMemberId',
        );
        // The placeholder is bound to the signed-in member, not to a literal.
        expect(params).toEqual({ readableMemberId: 'member-assistant' });
      });
    });

    it('keeps resubmit and cancel with the applicant', async (): Promise<void> => {
      const fixture = createFiledForFixture();

      await expect(
        fixture.service.cancelApprovalInstance({
          cancelledByMemberId: 'member-assistant',
          comment: null,
          instanceId: 'instance-1',
        }),
      ).rejects.toThrow('can only be cancelled by its initiator');
    });
  });

  it('rejects ad-hoc countersign requests when the node disallows added signers', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.requestAdhocCountersign({
        requestedByMemberId: 'member-finance',
        target: {
          kind: AdhocTargetKindEnum.MEMBER,
          memberIds: ['member-d'],
        },
        taskId: 'task-1',
      }),
    ).rejects.toThrow('does not allow ad-hoc signers');
  });

  it('creates a blocking ad-hoc pre-approval task on the current node', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const adhocTask = await fixture.service.requestAdhocPreApproval({
      comment: '請先確認預算',
      onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
      requestedByMemberId: 'member-finance',
      target: {
        kind: AdhocTargetKindEnum.MEMBER,
        memberIds: ['member-d'],
      },
      taskId: 'task-1',
    });

    expect(adhocTask).toMatchObject({
      adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
      assigneeMemberId: 'member-d',
      isAdhoc: true,
      nodeId: 'task_finance',
      // The node it was spawned on — clients add the 臨時加簽 marker themselves.
      nodeLabel: '財務簽核',
      status: TaskStatusEnum.PENDING,
      tokenId: 'token-1',
    });
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
        status: AdhocDirectiveStatusEnum.CONSUMED,
        type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
      }),
    );
    expect(
      fixture.notificationService.createTaskAssignedNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ assigneeMemberId: 'member-d' }),
      }),
    );
  });

  it('gives an ad-hoc pre-approval task the same nodeLabel a list would, null for a blank label', async (): Promise<void> => {
    const workflow = createLinearUserTaskWorkflow({ allowAddSigner: true });
    const blankLabelWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 'task_finance'
          ? ({ ...node, data: { ...node.data, label: '  ' } } as typeof node)
          : node,
      ),
    };
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: blankLabelWorkflow,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const adhocTask = await fixture.service.requestAdhocPreApproval({
      onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
      requestedByMemberId: 'member-finance',
      target: {
        kind: AdhocTargetKindEnum.MEMBER,
        memberIds: ['member-d'],
      },
      taskId: 'task-1',
    });

    fixture.rootInstanceFind.mockResolvedValue([
      createApprovalInstance({ workflowSnapshot: blankLabelWorkflow }),
    ]);
    fixture.rootTaskFind.mockResolvedValue([
      createTask({ id: 'task-listed', nodeId: 'task_finance' }),
    ]);

    const [listed] = await fixture.service.listInboxTasks('member-finance');

    expect(adhocTask.nodeLabel).toBeNull();
    expect(listed?.nodeLabel).toBe(adhocTask.nodeLabel);
  });

  it('rejects an ad-hoc pre-approval whose only target is the initiator when the node excludes the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.requestAdhocPreApproval({
        comment: null,
        onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
        requestedByMemberId: 'member-finance',
        target: {
          kind: AdhocTargetKindEnum.MEMBER,
          memberIds: ['member-001'],
        },
        taskId: 'task-1',
      }),
    ).rejects.toThrow('指定對象只有申請人本人');
  });

  it('keeps the legitimate ad-hoc target when the initiator listed first delegates to them', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      delegationResolutionByMember: {
        'member-001': {
          delegationChain: [
            {
              from: 'member-001',
              reason: 'ALL',
              ruleId: 'delegation-rule-1',
              to: 'member-x',
            },
          ],
          finalAssigneeMemberId: 'member-x',
        },
      },
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const adhocTask = await fixture.service.requestAdhocPreApproval({
      comment: null,
      onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
      requestedByMemberId: 'member-finance',
      target: {
        kind: AdhocTargetKindEnum.MEMBER,
        memberIds: ['member-001', 'member-x'],
      },
      taskId: 'task-1',
    });

    expect(adhocTask).toMatchObject({ assigneeMemberId: 'member-x' });
  });

  it('rejects an ad-hoc countersign request whose only target is the initiator when the node excludes the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
        excludeInitiator: { whenEmpty: 'FAIL' },
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.requestAdhocCountersign({
        comment: null,
        requestedByMemberId: 'member-finance',
        target: {
          kind: AdhocTargetKindEnum.MEMBER,
          memberIds: ['member-001'],
        },
        taskId: 'task-1',
      }),
    ).rejects.toThrow('指定對象只有申請人本人');
    expect(fixture.savedAdhocDirectives).toEqual([]);
  });

  it('allows an ad-hoc pre-approval for the initiator when the node does not exclude the initiator', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const adhocTask = await fixture.service.requestAdhocPreApproval({
      comment: null,
      onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
      requestedByMemberId: 'member-finance',
      target: {
        kind: AdhocTargetKindEnum.MEMBER,
        memberIds: ['member-001'],
      },
      taskId: 'task-1',
    });

    expect(adhocTask).toMatchObject({ assigneeMemberId: 'member-001' });
  });

  it('holds the token until every ad-hoc task on the node is approved', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    // The origin task completed but the ad-hoc pre-approval is still open —
    // the token must not advance and the instance must stay running.
    expect(fixture.savedProcessToken).toBeNull();
    expect(fixture.savedInstance).toBeNull();

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(fixture.savedProcessToken).toMatchObject({
      currentNodeId: 'end',
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    expect(fixture.savedInstance).toMatchObject({
      state: ApprovalInstanceStateEnum.APPROVED,
    });
  });

  it('spawns a parallel countersign task when the next user task is created', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionToken: createWorkflowToken({
        currentNodeId: 'start',
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-seed-1',
          originNodeId: 'task_origin',
          status: AdhocDirectiveStatusEnum.PENDING,
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const mainTask = fixture.savedTasks.find(
      (task) => !task.isAdhoc && task.nodeId === 'task_finance',
    );
    const countersignTask = fixture.savedTasks.find(
      (task) =>
        task.isAdhoc && task.adhocType === AdhocDirectiveTypeEnum.COUNTERSIGN,
    );

    expect(mainTask).toMatchObject({
      assigneeMemberId: 'member-finance',
      status: TaskStatusEnum.PENDING,
    });
    expect(countersignTask).toMatchObject({
      adhocDirectiveId: 'directive-seed-1',
      assigneeMemberId: 'member-d',
      nodeId: 'task_finance',
      status: TaskStatusEnum.PENDING,
    });
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        id: 'directive-seed-1',
        status: AdhocDirectiveStatusEnum.CONSUMED,
      }),
    );
  });

  it('needs every candidate of a multi-person ad-hoc countersign', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionToken: createWorkflowToken({
        currentNodeId: 'start',
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-seed-1',
          originNodeId: 'task_origin',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-d', 'member-e'],
          },
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const countersignTask = fixture.savedTasks.find(
      (task) =>
        task.isAdhoc && task.adhocType === AdhocDirectiveTypeEnum.COUNTERSIGN,
    );

    // The picker offers several people and the UI promises 下一層需所有人都完
    // 成才會繼續. On a `SINGLE` policy the first person to open the task
    // decided for the whole group and it vanished from the other inboxes.
    expect(countersignTask).toMatchObject({
      assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
      decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
    });
    expect(
      fixture.savedTaskCandidates
        .filter((candidate) => candidate.taskId === countersignTask?.id)
        .map((candidate) => candidate.memberId)
        .sort(),
    ).toEqual(['member-d', 'member-e']);
  });

  it('leaves a one-person ad-hoc countersign on the single-decision policy', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionToken: createWorkflowToken({
        currentNodeId: 'start',
        status: WorkflowTokenStatusEnum.ACTIVE,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-seed-1',
          originNodeId: 'task_origin',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-d'],
          },
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    // One person is the pre-existing behaviour and stays untouched: there is
    // nobody else for `PARALLEL_ALL` to wait for.
    expect(
      fixture.savedTasks.find(
        (task) =>
          task.isAdhoc && task.adhocType === AdhocDirectiveTypeEnum.COUNTERSIGN,
      ),
    ).toMatchObject({
      assigneeMemberId: 'member-d',
      assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
      decisionPolicySnapshot: { type: 'SINGLE' },
    });
  });

  it('keeps a multi-person countersign open until the last candidate approves', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          id: 'task-1',
          nodeId: 'task_finance',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        adhocDirectiveId: 'directive-seed-1',
        adhocOriginTaskId: 'task-1',
        adhocType: AdhocDirectiveTypeEnum.COUNTERSIGN,
        assigneeMemberId: null,
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        candidateMemberIds: ['member-d', 'member-e'],
        decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
        id: 'task-90',
        isAdhoc: true,
        nodeId: 'task_finance',
        originalAssigneeMemberId: null,
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: [
        createTaskCandidate({
          id: 'candidate-d',
          memberId: 'member-d',
          taskId: 'task-90',
        }),
        createTaskCandidate({
          id: 'candidate-e',
          memberId: 'member-e',
          taskId: 'task-90',
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '第一位同意',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    // The task stays open and member-e's candidate row is untouched: this is
    // the whole point of the policy. Under `SINGLE` the task closed here and
    // disappeared from member-e's inbox without them ever seeing it.
    expect(
      fixture.savedTasks.filter((task) => task.id === 'task-90').pop()?.status,
    ).toBe(TaskStatusEnum.IN_PROGRESS);
    expect(
      fixture.savedTaskCandidates
        .filter((candidate) => candidate.id === 'candidate-e')
        .pop()?.status,
    ).not.toBe(TaskCandidateStatusEnum.CANCELLED);

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '第二位同意',
      decidedByMemberId: 'member-e',
      taskId: 'task-90',
    });

    expect(
      fixture.savedTasks.filter((task) => task.id === 'task-90').pop()?.status,
    ).toBe(TaskStatusEnum.COMPLETED);
  });

  it('rejects the whole case when one countersigner rejects', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          id: 'task-1',
          nodeId: 'task_finance',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        adhocDirectiveId: 'directive-seed-1',
        adhocOriginTaskId: 'task-1',
        adhocType: AdhocDirectiveTypeEnum.COUNTERSIGN,
        assigneeMemberId: null,
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        candidateMemberIds: ['member-d', 'member-e'],
        decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
        id: 'task-90',
        isAdhoc: true,
        nodeId: 'task_finance',
        originalAssigneeMemberId: null,
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: [
        createTaskCandidate({
          id: 'candidate-d',
          memberId: 'member-d',
          taskId: 'task-90',
        }),
        createTaskCandidate({
          id: 'candidate-e',
          memberId: 'member-e',
          taskId: 'task-90',
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '金額有誤',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    // A rejection closes the task whatever the policy says, and the instance
    // follows it down. Waiting for the other countersigners would leave a case
    // that has already been refused sitting in their inboxes.
    expect(
      fixture.savedTasks.filter((task) => task.id === 'task-90').pop()?.status,
    ).toBe(TaskStatusEnum.COMPLETED);
    expect(fixture.savedInstance?.state).toBe(
      ApprovalInstanceStateEnum.REJECTED,
    );
  });

  it('returns a rejected ad-hoc pre-approval to the origin approver without rejecting the instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          id: 'directive-seed-1',
          onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.REJECTED,
      taskId: 'task-90',
    });
    // RETURN_TO_ORIGIN must not reject the instance.
    expect(fixture.savedInstance).toBeNull();
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientMemberIds: ['member-finance'],
      }),
    );
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.ADHOC_PRE_APPROVAL_RETURNED,
      }),
    );
  });

  it('reopens a rejected pre-approval for the origin assignee on a non-sequential task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        status: TaskStatusEnum.COMPLETED,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          createdByMemberId: 'member-requester',
          id: 'directive-seed-1',
          onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    const reopened = readTaskAssignedTo(fixture, 'member-finance');

    expect(reopened).toMatchObject({
      assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
      decisionPolicySnapshot: { type: 'SINGLE' },
    });
    expect(
      fixture.savedTasks.some(
        (task) => task.assigneeMemberId === 'member-requester',
      ),
    ).toBe(false);
  });

  it('returns a rejected pre-approval to whoever holds the origin task after a transfer', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          id: 'directive-seed-1',
          onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    // The origin approver hands the stage to member-101 while the
    // pre-approval they requested is still open.
    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-101',
    });

    const replacementTask = fixture.savedTasks.find(
      (task) => task.assigneeMemberId === 'member-101',
    );

    expect(replacementTask?.id).toBeDefined();

    const savedTaskCountBeforeRejection = fixture.savedTasks.length;

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    // Returned to the current holder: no fresh task reopened for the member
    // who transferred the stage away, and the instance is not rejected.
    expect(
      fixture.savedTasks
        .slice(savedTaskCountBeforeRejection)
        .filter(
          (task) =>
            task.assigneeMemberId === 'member-finance' &&
            task.status === TaskStatusEnum.PENDING,
        ),
    ).toEqual([]);
    expect(fixture.savedInstance).toBeNull();
    // The open pre-approval was moved onto the replacement task when the stage
    // was transferred, so the rejection resolves the current holder from it.
    expect(
      fixture.savedTasks.filter((task) => task.id === 'task-90').pop(),
    ).toMatchObject({ adhocOriginTaskId: replacementTask?.id });
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          adhocTaskId: 'task-90',
          originTaskId: replacementTask?.id,
          type: 'PRE_APPROVAL_RETURNED',
        }),
        recipientMemberIds: ['member-101'],
      }),
    );
  });

  it('keeps a closed pre-approval pointing at the task it ran against when that task is transferred', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          completedAt: new Date('2026-05-04T09:30:00.000Z'),
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.COMPLETED,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          id: 'directive-seed-1',
          onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-101',
    });

    expect(
      fixture.savedTasks.some((task) => task.assigneeMemberId === 'member-101'),
    ).toBe(true);
    // The completed pre-approval is not re-saved, so its pointer is untouched.
    expect(fixture.savedTasks.filter((task) => task.id === 'task-90')).toEqual(
      [],
    );
  });

  it('leaves an open countersign task pointing at the task that triggered it when that task is transferred', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.COUNTERSIGN,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        assigneeMemberId: 'member-finance',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          id: 'directive-seed-1',
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.TRANSFERRED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
      transferToMemberId: 'member-101',
    });

    expect(
      fixture.savedTasks.some((task) => task.assigneeMemberId === 'member-101'),
    ).toBe(true);
    // Only pre-approvals follow a transfer; the countersign task is not
    // re-saved, so it keeps agreeing with directive.originTaskId.
    expect(fixture.savedTasks.filter((task) => task.id === 'task-90')).toEqual(
      [],
    );
  });

  it('returns a rejected pre-approval to the current holder when its pointer still names a transferred task', async (): Promise<void> => {
    const fixture = createStalePreApprovalOriginFixture({
      processActivityLogs: [createTransferTaskCreatedLog('task-1', 'task-50')],
      replacementTasks: [
        createTask({
          assigneeMemberId: 'member-101',
          id: 'task-50',
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-finance',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    // The holder's task is still open, so nothing is reopened — least of all
    // for the member who transferred the stage away.
    expect(
      fixture.savedTasks.filter((task) => task.id !== 'task-90'),
    ).toEqual([]);
    expect(fixture.savedInstance).toBeNull();
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          adhocTaskId: 'task-90',
          originTaskId: 'task-50',
          type: 'PRE_APPROVAL_RETURNED',
        }),
        recipientMemberIds: ['member-101'],
      }),
    );
  });

  it('follows a stale pre-approval pointer across repeated transfers', async (): Promise<void> => {
    const fixture = createStalePreApprovalOriginFixture({
      processActivityLogs: [
        createTransferTaskCreatedLog('task-1', 'task-50'),
        createTransferTaskCreatedLog('task-50', 'task-51'),
      ],
      replacementTasks: [
        createTask({
          assigneeMemberId: 'member-101',
          completedAt: new Date('2026-05-04T09:20:00.000Z'),
          id: 'task-50',
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-finance',
          status: TaskStatusEnum.TRANSFERRED,
          tokenId: 'token-1',
        }),
        createTask({
          assigneeMemberId: 'member-102',
          id: 'task-51',
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-finance',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(
      fixture.savedTasks.filter((task) => task.id !== 'task-90'),
    ).toEqual([]);
    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ originTaskId: 'task-51' }),
        recipientMemberIds: ['member-102'],
      }),
    );
  });

  it('reopens the stage for the member the transfer went to when that member already decided', async (): Promise<void> => {
    const fixture = createStalePreApprovalOriginFixture({
      processActivityLogs: [createTransferTaskCreatedLog('task-1', 'task-50')],
      replacementTasks: [
        createTask({
          assigneeMemberId: 'member-101',
          completedAt: new Date('2026-05-04T09:20:00.000Z'),
          id: 'task-50',
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-finance',
          status: TaskStatusEnum.COMPLETED,
          tokenId: 'token-1',
        }),
      ],
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(
      fixture.savedTasks
        .filter((task) => task.status === TaskStatusEnum.PENDING)
        .map((task) => task.assigneeMemberId),
    ).toEqual(['member-101']);
  });

  it('keeps reopening for the transferring member when the transfer left no trail to follow', async (): Promise<void> => {
    const fixture = createStalePreApprovalOriginFixture({
      processActivityLogs: [],
      replacementTasks: [],
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '需要更多資訊',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(
      fixture.savedTasks
        .filter((task) => task.status === TaskStatusEnum.PENDING)
        .map((task) => task.assigneeMemberId),
    ).toEqual(['member-finance']);
    expect(fixture.savedInstance).toBeNull();
  });

  it('rejects the whole instance when an ad-hoc pre-approval is rejected with REJECT_INSTANCE', async (): Promise<void> => {
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          adhocDirectiveId: 'directive-seed-1',
          adhocOriginTaskId: 'task-1',
          adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          assigneeMemberId: 'member-d',
          id: 'task-90',
          isAdhoc: true,
          nodeId: 'task_finance',
          originalAssigneeMemberId: 'member-d',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-1',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          consumedAt: new Date('2026-05-04T09:00:00.000Z'),
          id: 'directive-seed-1',
          onReject: AdhocPreApprovalRejectBehaviorEnum.REJECT_INSTANCE,
          status: AdhocDirectiveStatusEnum.CONSUMED,
          type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowAddSigner: true,
      }),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '不同意',
      decidedByMemberId: 'member-d',
      taskId: 'task-90',
    });

    expect(fixture.savedInstance).toMatchObject({
      state: ApprovalInstanceStateEnum.REJECTED,
    });
  });

  it('dispatches an ad-hoc stage notification when the stage is approved', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-stage-1',
          originNodeId: 'task_finance',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-x'],
          },
          type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ outcome: 'APPROVED' }),
        recipientMemberIds: ['member-x'],
      }),
    );
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        id: 'directive-stage-1',
        status: AdhocDirectiveStatusEnum.CONSUMED,
      }),
    );
  });

  it('returns a cancelled ad-hoc directive that still resolves its GraphQL getters', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          createdByMemberId: 'member-finance',
          id: 'directive-cancel-1',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-x'],
          },
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const cancelled = await fixture.service.cancelAdhocDirective({
      cancelledByMemberId: 'member-finance',
      directiveId: 'directive-cancel-1',
    });

    expect(cancelled.status).toBe(AdhocDirectiveStatusEnum.CANCELLED);
    // `targetValueJson` is a non-nullable GraphQL field backed by a prototype
    // getter, so the resolver only survives if the saved value is still an
    // entity instance. Spreading the row into a plain object drops the getter
    // and the mutation fails with an opaque INTERNAL_SERVER_ERROR *after* the
    // cancellation has already been written, which reads to the approver as
    // "the withdraw failed" even though it succeeded.
    expect(cancelled).toBeInstanceOf(AdhocDirectiveEntity);
    expect(cancelled.targetValueJson).toBe(
      JSON.stringify({
        kind: AdhocTargetKindEnum.MEMBER,
        memberIds: ['member-x'],
      }),
    );
  });

  it('does not complete a case while a token still waits on a task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    // A token parked on a user task is WAITING, not ACTIVE, and the completion
    // has to see it as open — otherwise a case nobody has approved is approved
    // the moment the engine next runs over it.
    expect(fixture.savedInstance?.state).not.toBe(
      ApprovalInstanceStateEnum.APPROVED,
    );
  });

  it('keeps a rejected end state instead of completing the case again', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createRejectingEndEventWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    // The end node commits REJECTED. While it saved a *copy* of the instance
    // the caller's `state` stayed on RUNNING, so the guard in
    // `completeInstanceIfNoOpenRuntimeState` did not short-circuit and a
    // second completion overwrote the committed row with APPROVED — a
    // rejected case silently became an approved one.
    expect(fixture.savedInstance?.state).toBe(
      ApprovalInstanceStateEnum.REJECTED,
    );
    // A rejected case sends no completion notification at all; the second
    // completion sent one, because it always ran as an approval.
    expect(
      fixture.notificationService.createInstanceCompletedNotification,
    ).not.toHaveBeenCalled();
  });

  it('returns a cancelled instance that still resolves its GraphQL getters', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1200 },
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const cancelled = await fixture.service.cancelApprovalInstance({
      cancelledByMemberId: 'member-001',
      comment: null,
      instanceId: 'instance-1',
    });

    expect(cancelled.state).toBe(ApprovalInstanceStateEnum.CANCELLED);
    // `ApprovalInstance` exposes five getter-backed JSON fields, all of them
    // non-nullable. Spreading the row into a plain object drops every one, so
    // the withdrawal is committed and the mutation still fails with an opaque
    // INTERNAL_SERVER_ERROR — the initiator sees "cancel failed" on a case
    // that is already cancelled.
    expect(cancelled).toBeInstanceOf(ApprovalInstanceEntity);
    expect(cancelled.formDataJson).toBe(JSON.stringify({ amount: 1200 }));
  });

  describe('expiring an instance on an SLA timeout', (): void => {
    const readLogs = (
      fixture: ServiceFixture,
    ): readonly ActivityLogEntity[] => [
      ...fixture.savedActivityLogs,
      ...fixture.savedSingleActivityLogs,
    ];

    it('ends the instance as EXPIRED with no actor', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processFormData: { amount: 1200 },
        processWorkflowSnapshot: createLinearUserTaskWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      const expired = await fixture.service.expireApprovalInstance({
        comment: 'SLA timeout terminated this instance.',
        instanceId: 'instance-1',
        nodeId: 'task_finance',
        taskId: 'task-1',
      });

      // The SLA path used to cancel the instance in the initiator's name, so
      // the record said the initiator withdrew a case they never touched.
      expect(expired.state).toBe(ApprovalInstanceStateEnum.EXPIRED);
      expect(expired).toBeInstanceOf(ApprovalInstanceEntity);
      expect(readLogs(fixture)).toContainEqual(
        expect.objectContaining({
          actorMemberId: null,
          eventType: ActivityLogEventTypeEnum.INSTANCE_EXPIRED,
          nodeId: 'task_finance',
          taskId: 'task-1',
        }),
      );
      expect(
        readLogs(fixture).some(
          (log) => log.eventType === ActivityLogEventTypeEnum.INSTANCE_CANCELLED,
        ),
      ).toBe(false);
    });

    it('leaves an instance that is already closed alone', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        instanceState: ApprovalInstanceStateEnum.APPROVED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow(),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      const result = await fixture.service.expireApprovalInstance({
        instanceId: 'instance-1',
      });

      expect(result.state).toBe(ApprovalInstanceStateEnum.APPROVED);
      expect(readLogs(fixture)).toEqual([]);
    });
  });

  it('dispatches ad-hoc completion notifications on reject and cancels pending flow directives', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-completion-1',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetValue: {
            kind: AdhocTargetKindEnum.MEMBER,
            memberIds: ['member-x'],
          },
          type: AdhocDirectiveTypeEnum.COMPLETION_NOTIFY,
        }),
        createAdhocDirective({
          id: 'directive-countersign-1',
          status: AdhocDirectiveStatusEnum.PENDING,
          type: AdhocDirectiveTypeEnum.COUNTERSIGN,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '資料不足',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(
      fixture.notificationService.createAdhocWorkflowNotifications,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          finalState: ApprovalInstanceStateEnum.REJECTED,
        }),
        recipientMemberIds: ['member-x'],
      }),
    );
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        id: 'directive-completion-1',
        status: AdhocDirectiveStatusEnum.CONSUMED,
      }),
    );
    expect(fixture.savedAdhocDirectives).toContainEqual(
      expect.objectContaining({
        id: 'directive-countersign-1',
        status: AdhocDirectiveStatusEnum.CANCELLED,
      }),
    );
  });

  it('records ad-hoc webhook notification failures without blocking the decision', async (): Promise<void> => {
    const failingDispatcher: BPMWorkflowServiceTaskDispatcher = {
      dispatchWebhook: jest.fn(() =>
        Promise.reject(new Error('webhook unreachable')),
      ),
    };
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-webhook-1',
          originNodeId: 'task_finance',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetKind: AdhocTargetKindEnum.WEBHOOK,
          targetValue: {
            kind: AdhocTargetKindEnum.WEBHOOK,
            webhookUrl: 'https://example.com/hook',
          },
          type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      serviceTaskDispatcher: failingDispatcher,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(fixture.savedInstance).toMatchObject({
      state: ApprovalInstanceStateEnum.APPROVED,
    });
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
        payload: expect.objectContaining({
          action: 'ADHOC_WEBHOOK',
          directiveId: 'directive-webhook-1',
        }),
      }),
    );
  });

  it('words an ad-hoc notification that finds nobody as 通知對象, not 簽核人', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processAdhocDirectives: [
        createAdhocDirective({
          id: 'directive-notify-1',
          originNodeId: 'task_finance',
          status: AdhocDirectiveStatusEnum.PENDING,
          targetKind: AdhocTargetKindEnum.MEMBER,
          targetValue: { kind: AdhocTargetKindEnum.MEMBER, memberIds: [] },
          type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
        }),
      ],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.SERVICE_TASK_FAILED,
        payload: expect.objectContaining({
          action: 'ADHOC_NOTIFY',
          error: '臨時通知對象 找不到通知對象',
        }),
      }),
    );
  });

  describe('SEQUENTIAL decision policy', () => {
    it('creates the task for the first candidate only and keeps the rest waiting', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            memberIds: ['member-a', 'member-b', 'member-c'],
            type: 'DIRECT',
          },
          decisionPolicy: { type: 'SEQUENTIAL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.savedTaskCandidates.map((candidate) => ({
          memberId: candidate.memberId,
          sequence: candidate.sequence,
          status: candidate.status,
        })),
      ).toEqual([
        {
          memberId: 'member-a',
          sequence: 0,
          status: TaskCandidateStatusEnum.PENDING,
        },
        {
          memberId: 'member-b',
          sequence: 1,
          status: TaskCandidateStatusEnum.WAITING,
        },
        {
          memberId: 'member-c',
          sequence: 2,
          status: TaskCandidateStatusEnum.WAITING,
        },
      ]);
      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-a',
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        originalAssigneeMemberId: 'member-a',
      });
      // Consumers that notify "everyone on this task" read `candidateMemberIds`,
      // so it must name only the member whose turn it is.
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) => log.eventType === ActivityLogEventTypeEnum.TASK_CREATED,
        )?.payload,
      ).toEqual({
        assigneeMemberId: 'member-a',
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        candidateMemberIds: ['member-a'],
        originalAssigneeMemberId: 'member-a',
        sequentialCandidateMemberIds: ['member-a', 'member-b', 'member-c'],
        tokenId: 'token-1',
      });
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledTimes(1);
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ assigneeMemberId: 'member-a' }),
        }),
      );

      answerTaskQueriesFromSavedTasks(fixture);

      await expect(fixture.service.listInboxTasks('member-b')).resolves.toEqual(
        [],
      );
      await expect(
        fixture.service.listInboxTasks('member-a'),
      ).resolves.toHaveLength(1);
    });

    it('hands the task to the next candidate on each approval and completes after the last', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.WAITING,
      });
      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b',
        openedAt: null,
        originalAssigneeMemberId: 'member-b',
        status: TaskStatusEnum.PENDING,
      });
      // The previous holder's due date was in the past; the new holder gets a
      // fresh window from the node's SLA.
      expect(
        readLatestTask(fixture, 'task-seq')?.slaDueAt?.getTime(),
      ).toBeGreaterThan(Date.now());
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        ),
      ).toMatchObject({
        actorMemberId: null,
        nodeId: 'task_finance',
        // The same recipient fields TASK_CREATED carries, so a consumer can
        // route "your turn" exactly like an assignment.
        payload: {
          assigneeMemberId: 'member-b',
          assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
          candidateMemberId: 'member-b',
          candidateMemberIds: ['member-b'],
          originalAssigneeMemberId: 'member-b',
          originalMemberId: 'member-b',
          previousMemberId: 'member-a',
          sequence: 1,
          tokenId: 'token-1',
        },
        taskId: 'task-seq',
      });
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledTimes(1);
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ assigneeMemberId: 'member-b' }),
        }),
      );
      expect(
        fixture.notificationService.resolveTaskNotifications,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          actingMemberId: 'member-a',
          supersedeOthers: false,
        }),
      );
      expect(fixture.savedProcessToken).toBeNull();
      expect(fixture.savedInstance).toBeNull();

      answerTaskQueriesFromSavedTasks(fixture);

      await expect(
        fixture.service.listInboxTasks('member-b'),
      ).resolves.toHaveLength(1);
      await expect(fixture.service.listInboxTasks('member-a')).resolves.toEqual(
        [],
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-b',
        taskId: 'task-seq',
      });

      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-c',
        status: TaskStatusEnum.PENDING,
      });
      expect(fixture.savedProcessToken).toBeNull();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-c',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.COMPLETED,
        'member-c': TaskCandidateStatusEnum.COMPLETED,
      });
      expect(readLatestTask(fixture, 'task-seq')?.status).toBe(
        TaskStatusEnum.COMPLETED,
      );
      expect(fixture.savedProcessToken).toMatchObject({
        currentNodeId: 'end',
        status: WorkflowTokenStatusEnum.CONSUMED,
      });
      expect(fixture.savedInstance).toMatchObject({
        state: ApprovalInstanceStateEnum.APPROVED,
      });
    });

    it('refuses a candidate whose turn has not come', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      const attempt = fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '搶先同意',
        decidedByMemberId: 'member-b',
        taskId: 'task-seq',
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow("not this member's turn yet");
      expect(fixture.savedDecision).toBeNull();
    });

    it('closes the waiting candidates when the active one rejects', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '金額有誤',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.CANCELLED,
        'member-c': TaskCandidateStatusEnum.CANCELLED,
      });
      expect(readLatestTask(fixture, 'task-seq')?.status).toBe(
        TaskStatusEnum.COMPLETED,
      );
      expect(fixture.savedInstance).toMatchObject({
        state: ApprovalInstanceStateEnum.REJECTED,
      });
      expect(
        fixture.savedSingleActivityLogs.some(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        ),
      ).toBe(false);
    });

    it('closes the waiting candidates when the active one returns the case', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.RETURNED,
        comment: '請補件',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.CANCELLED,
        'member-c': TaskCandidateStatusEnum.CANCELLED,
      });
      expect(fixture.savedInstance).toMatchObject({
        state: ApprovalInstanceStateEnum.RETURNED,
      });
    });

    it('closes the waiting candidates when the case is cancelled', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.cancelApprovalInstance({
        cancelledByMemberId: 'member-001',
        comment: null,
        instanceId: 'instance-1',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.CANCELLED,
        'member-b': TaskCandidateStatusEnum.CANCELLED,
        'member-c': TaskCandidateStatusEnum.CANCELLED,
      });
    });

    it('carries the waiting candidates over when the active one transfers', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: '請代簽',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
        transferToMemberId: 'member-x',
      });

      const replacement = readTaskAssignedTo(fixture, 'member-x');

      expect(replacement).toMatchObject({
        assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
        decisionPolicySnapshot: { type: 'SEQUENTIAL' },
        status: TaskStatusEnum.PENDING,
      });
      expect(readLatestCandidateStatuses(fixture, replacement.id)).toEqual({
        'member-b': TaskCandidateStatusEnum.WAITING,
        'member-c': TaskCandidateStatusEnum.WAITING,
        'member-x': TaskCandidateStatusEnum.PENDING,
      });
      expect(
        readLatestCandidates(fixture, replacement.id).map(
          (candidate) => candidate.sequence,
        ),
      ).toEqual([0, 1, 2]);
      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.TRANSFERRED,
        'member-b': TaskCandidateStatusEnum.SUPERSEDED,
        'member-c': TaskCandidateStatusEnum.SUPERSEDED,
      });
      expect(
        fixture.savedActivityLogs.find(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CREATED &&
            log.taskId === replacement.id,
        )?.payload,
      ).toMatchObject({
        assigneeMemberId: 'member-x',
        candidateMemberIds: ['member-x'],
        sequentialCandidateMemberIds: ['member-x', 'member-b', 'member-c'],
        transferredFromTaskId: 'task-seq',
      });

      // The replacement keeps walking the chain: the transferee signs in a's
      // place and b is next.
      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-x',
        taskId: replacement.id,
      });

      expect(readLatestTask(fixture, replacement.id)).toMatchObject({
        assigneeMemberId: 'member-b',
        status: TaskStatusEnum.PENDING,
      });
      expect(readLatestCandidateStatuses(fixture, replacement.id)).toEqual({
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.WAITING,
        'member-x': TaskCandidateStatusEnum.COMPLETED,
      });
    });

    it('does not ask a later candidate twice when the task is transferred to them', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: '請主管代簽',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
        transferToMemberId: 'member-b',
      });

      const replacement = readTaskAssignedTo(fixture, 'member-b');

      expect(readLatestCandidateStatuses(fixture, replacement.id)).toEqual({
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.WAITING,
      });
      expect(
        fixture.savedActivityLogs.find(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CREATED &&
            log.taskId === replacement.id,
        )?.payload,
      ).toMatchObject({
        sequentialCandidateMemberIds: ['member-b', 'member-c'],
      });
    });

    it('keeps the old behaviour for a SEQUENTIAL task created before candidates were ordered', async (): Promise<void> => {
      const fixture = createLegacySequentialFixture();

      // Any order, and the task stays open until both have approved.
      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-b',
        taskId: 'task-legacy',
      });

      expect(readLatestTask(fixture, 'task-legacy')?.status).toBe(
        TaskStatusEnum.IN_PROGRESS,
      );
      expect(readLatestCandidateStatuses(fixture, 'task-legacy')).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
        'member-b': TaskCandidateStatusEnum.COMPLETED,
      });
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).not.toHaveBeenCalled();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-legacy',
      });

      expect(readLatestTask(fixture, 'task-legacy')?.status).toBe(
        TaskStatusEnum.COMPLETED,
      );
      expect(
        fixture.savedSingleActivityLogs.some(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        ),
      ).toBe(false);
    });

    it('starts a fresh SLA window for the activated candidate', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();
      const before = Date.now();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      const activated = readLatestTask(fixture, 'task-seq');

      expect(activated?.slaStartedAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(activated?.slaStartedAt?.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(activated?.slaDueAt?.getTime()).toBeGreaterThan(
        activated?.slaStartedAt?.getTime() ?? Infinity,
      );
    });

    it('applies a delegation created after the task when the candidate is activated', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();
      const delegationChain = [
        {
          from: 'member-b',
          reason: 'ALL',
          ruleId: 'delegation-rule-late',
          to: 'member-b-delegate',
        },
      ];

      fixture.delegationService.resolveAssignee.mockImplementation(
        (memberId: string): Promise<DelegationResolution> =>
          Promise.resolve(
            memberId === 'member-b'
              ? { delegationChain, finalAssigneeMemberId: 'member-b-delegate' }
              : { delegationChain: [], finalAssigneeMemberId: memberId },
          ),
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(
        readLatestCandidates(fixture, 'task-seq').find(
          (candidate) => candidate.id === 'candidate-b',
        ),
      ).toMatchObject({
        delegationChain,
        memberId: 'member-b-delegate',
        originalMemberId: 'member-b',
        status: TaskCandidateStatusEnum.PENDING,
      });
      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b-delegate',
        delegationChain,
        originalAssigneeMemberId: 'member-b',
      });
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            assigneeMemberId: 'member-b-delegate',
          }),
        }),
      );
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        )?.payload,
      ).toMatchObject({
        assigneeMemberId: 'member-b-delegate',
        candidateMemberIds: ['member-b-delegate'],
        originalAssigneeMemberId: 'member-b',
      });
    });

    it('keeps the stored member when the delegate already holds another candidate row', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      // member-b now delegates to member-c, who is also a candidate on the
      // task; (task_id, member_id) is unique, so b must stay as stored.
      fixture.delegationService.resolveAssignee.mockImplementation(
        (memberId: string): Promise<DelegationResolution> =>
          Promise.resolve(
            memberId === 'member-b'
              ? {
                  delegationChain: [
                    {
                      from: 'member-b',
                      reason: 'ALL',
                      ruleId: 'delegation-rule-collide',
                      to: 'member-c',
                    },
                  ],
                  finalAssigneeMemberId: 'member-c',
                }
              : { delegationChain: [], finalAssigneeMemberId: memberId },
          ),
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.WAITING,
      });
      expect(
        readLatestCandidates(fixture, 'task-seq').find(
          (candidate) => candidate.id === 'candidate-b',
        )?.delegationChain,
      ).toEqual([]);
      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b',
        delegationChain: [],
      });
    });

    it('keeps the stored member when a late delegation would route a waiting candidate to the initiator on an excluding node', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({
        excludeInitiator: { whenEmpty: 'FAIL' },
      });

      // member-b delegated to the initiator (member-001) after the task was
      // created; creation would have dropped that path, so activation must too.
      fixture.delegationService.resolveAssignee.mockImplementation(
        (memberId: string): Promise<DelegationResolution> =>
          Promise.resolve(
            memberId === 'member-b'
              ? {
                  delegationChain: [
                    {
                      from: 'member-b',
                      reason: 'ALL',
                      ruleId: 'delegation-rule-initiator',
                      to: 'member-001',
                    },
                  ],
                  finalAssigneeMemberId: 'member-001',
                }
              : { delegationChain: [], finalAssigneeMemberId: memberId },
          ),
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b',
        delegationChain: [],
      });
      expect(
        readLatestCandidates(fixture, 'task-seq').find(
          (candidate) => candidate.id === 'candidate-b',
        ),
      ).toMatchObject({
        delegationChain: [],
        memberId: 'member-b',
        status: TaskCandidateStatusEnum.PENDING,
      });
    });

    it('still applies a late delegation to someone else on an excluding node', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({
        excludeInitiator: { whenEmpty: 'FAIL' },
      });

      fixture.delegationService.resolveAssignee.mockImplementation(
        (memberId: string): Promise<DelegationResolution> =>
          Promise.resolve(
            memberId === 'member-b'
              ? {
                  delegationChain: [
                    {
                      from: 'member-b',
                      reason: 'ALL',
                      ruleId: 'delegation-rule-other',
                      to: 'member-b-delegate',
                    },
                  ],
                  finalAssigneeMemberId: 'member-b-delegate',
                }
              : { delegationChain: [], finalAssigneeMemberId: memberId },
          ),
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b-delegate',
      });
    });

    it('carries the waiting candidates over when an SLA escalation transfers the active one', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      // The SLA scan drives this through decideTask exactly like this.
      await fixture.service.decideTask(
        {
          action: TaskDecisionActionEnum.TRANSFERRED,
          comment: 'SLA timeout escalated this task.',
          decidedByMemberId: 'member-a',
          taskId: 'task-seq',
          transferToMemberId: 'member-manager',
        },
        { transferReason: SLA_ESCALATION_DELEGATION_REASON },
      );

      const replacement = readTaskAssignedTo(fixture, 'member-manager');

      expect(replacement).toMatchObject({
        decisionPolicySnapshot: { type: 'SEQUENTIAL' },
      });
      expect(replacement.delegationChain).toEqual([
        {
          from: 'member-a',
          reason: SLA_ESCALATION_DELEGATION_REASON,
          ruleId: null,
          to: 'member-manager',
        },
      ]);
      expect(readLatestCandidateStatuses(fixture, replacement.id)).toEqual({
        'member-b': TaskCandidateStatusEnum.WAITING,
        'member-c': TaskCandidateStatusEnum.WAITING,
        'member-manager': TaskCandidateStatusEnum.PENDING,
      });
    });

    it('activates the next candidate when an SLA auto-approval decides for the active one', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: 'SLA timeout auto-approved this task.',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestCandidateStatuses(fixture, 'task-seq')).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.WAITING,
      });
      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-b',
        status: TaskStatusEnum.PENDING,
      });
      expect(
        fixture.savedSingleActivityLogs.some(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        ),
      ).toBe(true);
    });

    it('hands the replacement a SINGLE task when the last candidate transfers', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({ activeIndex: 2 });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: '請代簽',
        decidedByMemberId: 'member-c',
        taskId: 'task-seq',
        transferToMemberId: 'member-x',
      });

      const replacement = readTaskAssignedTo(fixture, 'member-x');

      expect(replacement).toMatchObject({
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
        decisionPolicySnapshot: { type: 'SINGLE' },
      });
      expect(
        readLatestCandidates(fixture, replacement.id).map((candidate) => ({
          memberId: candidate.memberId,
          sequence: candidate.sequence,
        })),
      ).toEqual([{ memberId: 'member-x', sequence: null }]);
    });

    it('keeps a transfer SINGLE on a SEQUENTIAL task created before candidates were ordered', async (): Promise<void> => {
      const fixture = createLegacySequentialFixture();

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: '請代簽',
        decidedByMemberId: 'member-a',
        taskId: 'task-legacy',
        transferToMemberId: 'member-x',
      });

      const replacement = readTaskAssignedTo(fixture, 'member-x');

      expect(replacement).toMatchObject({
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
        decisionPolicySnapshot: { type: 'SINGLE' },
      });
      expect(
        readLatestCandidates(fixture, replacement.id).map(
          (candidate) => candidate.sequence,
        ),
      ).toEqual([null]);
    });

    it('leaves a one-candidate SEQUENTIAL task unordered and never activates anyone', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: { memberIds: ['member-a'], type: 'DIRECT' },
          decisionPolicy: { type: 'SEQUENTIAL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.savedTaskCandidates.map((candidate) => ({
          memberId: candidate.memberId,
          sequence: candidate.sequence,
          status: candidate.status,
        })),
      ).toEqual([
        {
          memberId: 'member-a',
          sequence: null,
          status: TaskCandidateStatusEnum.PENDING,
        },
      ]);
      expect(fixture.savedTasks[0]).toMatchObject({
        assigneeMemberId: 'member-a',
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
      });
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) => log.eventType === ActivityLogEventTypeEnum.TASK_CREATED,
        )?.payload,
      ).not.toHaveProperty('sequentialCandidateMemberIds');

      const taskId = fixture.savedTasks[0]?.id ?? '';

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId,
      });

      expect(readLatestTask(fixture, taskId)?.status).toBe(
        TaskStatusEnum.COMPLETED,
      );
      expect(
        fixture.savedSingleActivityLogs.some(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED,
        ),
      ).toBe(false);
    });

    it('tells the requester, not only the next signer, when a pre-approval is returned after the task moved on', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({
        additionalProcessTasks: [
          createTask({
            adhocDirectiveId: 'directive-seed-1',
            adhocOriginTaskId: 'task-seq',
            adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
            assigneeMemberId: 'member-p',
            id: 'task-pre',
            isAdhoc: true,
            nodeId: 'task_finance',
            originalAssigneeMemberId: 'member-p',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
        ],
        processAdhocDirectives: [
          createAdhocDirective({
            consumedAt: new Date('2026-05-04T09:00:00.000Z'),
            createdByMemberId: 'member-a',
            id: 'directive-seed-1',
            onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
            status: AdhocDirectiveStatusEnum.CONSUMED,
            type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          }),
        ],
      });

      // Nothing stops the active signer approving while their pre-approval is
      // open (the same is true of a single-approver task); the token is held
      // back, and the task moves on to member-b.
      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });

      expect(readLatestTask(fixture, 'task-seq')?.assigneeMemberId).toBe(
        'member-b',
      );

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '需要更多資訊',
        decidedByMemberId: 'member-p',
        taskId: 'task-pre',
      });

      expect(
        fixture.notificationService.createAdhocWorkflowNotifications,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientMemberIds: ['member-a', 'member-b'],
        }),
      );
    });

    it('reopens a rejected pre-approval for its requester after a mid-order transfer', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({
        additionalProcessTasks: [
          createTask({
            adhocDirectiveId: 'directive-seed-1',
            adhocOriginTaskId: 'task-seq',
            adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
            assigneeMemberId: 'member-p',
            id: 'task-pre',
            isAdhoc: true,
            nodeId: 'task_finance',
            originalAssigneeMemberId: 'member-p',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
        ],
        processAdhocDirectives: [
          createAdhocDirective({
            consumedAt: new Date('2026-05-04T09:00:00.000Z'),
            createdByMemberId: 'member-a',
            id: 'directive-seed-1',
            onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
            status: AdhocDirectiveStatusEnum.CONSUMED,
            type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          }),
        ],
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-a',
        taskId: 'task-seq',
      });
      // member-b hands the stage to member-x with member-c still waiting; the
      // replacement carries no row for member-a, who already signed.
      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: null,
        decidedByMemberId: 'member-b',
        taskId: 'task-seq',
        transferToMemberId: 'member-x',
      });

      const replacement = readTaskAssignedTo(fixture, 'member-x');

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-x',
        taskId: replacement.id,
      });
      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: '同意',
        decidedByMemberId: 'member-c',
        taskId: replacement.id,
      });

      expect(readLatestTask(fixture, replacement.id)).toMatchObject({
        assigneeMemberId: 'member-c',
        status: TaskStatusEnum.COMPLETED,
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '需要更多資訊',
        decidedByMemberId: 'member-p',
        taskId: 'task-pre',
      });

      expect(readTaskAssignedTo(fixture, 'member-a')).toMatchObject({
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
        decisionPolicySnapshot: { type: 'SINGLE' },
        originalAssigneeMemberId: 'member-a',
      });
      expect(
        readLatestRows(fixture.savedTasks).some(
          (task) =>
            task.assigneeMemberId === 'member-c' &&
            task.status === TaskStatusEnum.PENDING,
        ),
      ).toBe(false);
    });

    it('does not tell the requester of a legacy SEQUENTIAL task, which has no order to move on in', async (): Promise<void> => {
      const fixture = createLegacySequentialFixture({
        additionalProcessTasks: [
          createTask({
            adhocDirectiveId: 'directive-seed-1',
            adhocOriginTaskId: 'task-legacy',
            adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
            assigneeMemberId: 'member-p',
            id: 'task-pre',
            isAdhoc: true,
            nodeId: 'task_finance',
            originalAssigneeMemberId: 'member-p',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
        ],
        processAdhocDirectives: [
          createAdhocDirective({
            consumedAt: new Date('2026-05-04T09:00:00.000Z'),
            createdByMemberId: 'member-requester',
            id: 'directive-seed-1',
            onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
            status: AdhocDirectiveStatusEnum.CONSUMED,
            type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          }),
        ],
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '需要更多資訊',
        decidedByMemberId: 'member-p',
        taskId: 'task-pre',
      });

      expect(
        fixture.notificationService.createAdhocWorkflowNotifications,
      ).toHaveBeenCalledTimes(1);
      expect(
        fixture.notificationService.createAdhocWorkflowNotifications,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientMemberIds: expect.not.arrayContaining(['member-requester']),
        }),
      );
    });

    it('reopens a rejected pre-approval for its requester, not for the last signer', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture({
        additionalProcessTasks: [
          createTask({
            adhocDirectiveId: 'directive-seed-1',
            adhocOriginTaskId: 'task-seq',
            adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
            assigneeMemberId: 'member-p',
            id: 'task-pre',
            isAdhoc: true,
            nodeId: 'task_finance',
            originalAssigneeMemberId: 'member-p',
            status: TaskStatusEnum.PENDING,
            tokenId: 'token-1',
          }),
        ],
        processAdhocDirectives: [
          createAdhocDirective({
            consumedAt: new Date('2026-05-04T09:00:00.000Z'),
            createdByMemberId: 'member-a',
            id: 'directive-seed-1',
            onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
            status: AdhocDirectiveStatusEnum.CONSUMED,
            type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
          }),
        ],
      });

      // a, b and c all approve while the pre-approval is open; the task
      // completes and the open pre-approval holds the token.
      await ['member-a', 'member-b', 'member-c'].reduce<Promise<void>>(
        async (previous, memberId): Promise<void> => {
          await previous;
          await fixture.service.decideTask({
            action: TaskDecisionActionEnum.APPROVED,
            comment: '同意',
            decidedByMemberId: memberId,
            taskId: 'task-seq',
          });
        },
        Promise.resolve(),
      );

      expect(readLatestTask(fixture, 'task-seq')).toMatchObject({
        assigneeMemberId: 'member-c',
        status: TaskStatusEnum.COMPLETED,
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '需要更多資訊',
        decidedByMemberId: 'member-p',
        taskId: 'task-pre',
      });

      const reopened = readTaskAssignedTo(fixture, 'member-a');

      expect(reopened).toMatchObject({
        assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
        decisionPolicySnapshot: { type: 'SINGLE' },
        originalAssigneeMemberId: 'member-a',
      });
      expect(readLatestCandidateStatuses(fixture, reopened.id)).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
      });
      expect(
        fixture.savedTasks.some(
          (task) =>
            task.id !== 'task-seq' &&
            task.assigneeMemberId === 'member-c' &&
            task.status === TaskStatusEnum.PENDING,
        ),
      ).toBe(false);
    });

    it('still creates every PARALLEL_ALL candidate at once', async (): Promise<void> => {
      const fixture = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processWorkflowSnapshot: createLinearUserTaskWorkflow({
          approverResolver: {
            memberIds: ['member-a', 'member-b', 'member-c'],
            type: 'DIRECT',
          },
          decisionPolicy: { type: 'PARALLEL_ALL' },
        }),
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      await fixture.service.processInstance('instance-1');

      expect(
        fixture.savedTaskCandidates.map((candidate) => ({
          memberId: candidate.memberId,
          sequence: candidate.sequence,
          status: candidate.status,
        })),
      ).toEqual(
        ['member-a', 'member-b', 'member-c'].map((memberId) => ({
          memberId,
          sequence: null,
          status: TaskCandidateStatusEnum.PENDING,
        })),
      );
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) => log.eventType === ActivityLogEventTypeEnum.TASK_CREATED,
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          candidateMemberIds: ['member-a', 'member-b', 'member-c'],
        }),
      );
      expect(
        fixture.savedSingleActivityLogs.find(
          (log) => log.eventType === ActivityLogEventTypeEnum.TASK_CREATED,
        )?.payload,
      ).not.toHaveProperty('sequentialCandidateMemberIds');
      expect(
        fixture.notificationService.createTaskAssignedNotification,
      ).toHaveBeenCalledTimes(3);
    });

    it('reads candidates in signing order, unordered ones last', async (): Promise<void> => {
      const fixture = createSequentialDecisionFixture();

      fixture.rootTaskFind.mockResolvedValue([createTask({ id: 'task-seq' })]);

      await fixture.service.listTaskCandidates('task-seq');
      await fixture.service.listTasks('instance-1');

      const orders = fixture.taskCandidateFind.mock.calls.map(([options]) =>
        Object.entries(
          (options as { readonly order?: Readonly<Record<string, unknown>> })
            .order ?? {},
        ),
      );

      // Key order is the sort priority, so it is asserted as an array.
      expect(orders).toEqual([
        [
          ['sequence', { direction: 'ASC', nulls: 'LAST' }],
          ['createdAt', 'ASC'],
          ['id', 'ASC'],
        ],
        [
          ['sequence', { direction: 'ASC', nulls: 'LAST' }],
          ['createdAt', 'ASC'],
          ['id', 'ASC'],
        ],
      ]);
    });

    it('reports who may act now as openCandidateMemberIds on the task summary', async (): Promise<void> => {
      const sequential = createSequentialDecisionFixture();

      sequential.rootTaskFind.mockResolvedValue([
        createTask({ id: 'task-seq' }),
      ]);

      const [sequentialTask] = await sequential.service.listTasks('instance-1');

      // Everyone stays in the display summary; only the active candidate may act.
      expect(sequentialTask?.candidateMemberIds).toEqual([
        'member-a',
        'member-b',
        'member-c',
      ]);
      expect(sequentialTask?.openCandidateMemberIds).toEqual(['member-a']);

      const parallel = createServiceFixture({
        currentVersionId: 'template-version-1',
        formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
        processTaskCandidates: [
          createTaskCandidate({
            id: 'candidate-a',
            memberId: 'member-a',
            taskId: 'task-par',
          }),
          createTaskCandidate({
            id: 'candidate-b',
            memberId: 'member-b',
            status: TaskCandidateStatusEnum.COMPLETED,
            taskId: 'task-par',
          }),
          createTaskCandidate({
            id: 'candidate-c',
            memberId: 'member-c',
            status: TaskCandidateStatusEnum.CLAIMED,
            taskId: 'task-par',
          }),
        ],
        templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      });

      parallel.rootTaskFind.mockResolvedValue([
        createTask({
          decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
          id: 'task-par',
        }),
      ]);

      const [parallelTask] = await parallel.service.listTasks('instance-1');

      // A candidate who already decided is no longer open; a claimed one is.
      expect(parallelTask?.candidateMemberIds).toEqual([
        'member-a',
        'member-b',
        'member-c',
      ]);
      expect(parallelTask?.openCandidateMemberIds).toEqual([
        'member-a',
        'member-c',
      ]);
    });
  });
});

describe('administrator task reassignment', (): void => {
  const ADMIN_MEMBER_ID = 'admin-001';
  const REASON = '原簽核人離職';

  // Seeds are read back merged with what the engine saved: the fixture only
  // answers `find` from rows it has seen, and a seat that did not move is not
  // among the saved rows.
  // A single-entity save is recorded apart from an array save in the fixture.
  const writtenActivityLogs = (
    fixture: ServiceFixture,
  ): readonly ActivityLogEntity[] => [
    ...fixture.savedActivityLogs,
    ...fixture.savedSingleActivityLogs,
  ];

  const readSeatRows = (
    fixture: ServiceFixture,
    seeds: readonly TaskCandidateEntity[],
  ): readonly TaskCandidateEntity[] =>
    readLatestRows([...seeds, ...fixture.savedTaskCandidates]);

  const readTaskState = (
    fixture: ServiceFixture,
    seed: TaskEntity,
  ): TaskEntity => {
    const task = readLatestRows([seed, ...fixture.savedTasks]).find(
      (row) => row.id === seed.id,
    );

    if (!task) {
      throw new Error(`Task ${seed.id} was not found`);
    }

    return task;
  };

  const readStatusByMember = (
    fixture: ServiceFixture,
    seeds: readonly TaskCandidateEntity[],
  ): Readonly<Record<string, TaskCandidateStatusEnum>> =>
    Object.fromEntries(
      readSeatRows(fixture, seeds).map((row) => [row.memberId, row.status]),
    );

  // Answers the root task `find` (inbox, member listing) from the seeded tasks
  // plus the rows the engine saved, `where` clause included.
  const answerTaskQueriesFromSeeds = (
    fixture: ServiceFixture,
    seeds: readonly TaskEntity[],
  ): void => {
    fixture.rootTaskFind.mockImplementation((options) => {
      const where = options.where as
        | Readonly<Record<string, unknown>>
        | readonly Readonly<Record<string, unknown>>[];
      const clauses = Array.isArray(where) ? where : [where];

      return Promise.resolve(
        readLatestRows([...seeds, ...fixture.savedTasks]).filter((task) =>
          clauses.some((clause) => matchesFindWhere(task, clause)),
        ),
      );
    });
  };

  const createOpenTaskFixture = ({
    allowTransfer,
    assigneeMemberId = null,
    candidates = [],
    decisionPolicy = { type: 'SINGLE' },
    excludeInitiator,
    grades,
    instanceState,
    resolver = { memberIds: ['member-from'], type: 'DIRECT' },
    submittedByMemberId,
    task = {},
  }: {
    readonly allowTransfer?: boolean;
    readonly assigneeMemberId?: string | null;
    readonly candidates?: readonly TaskCandidateEntity[];
    readonly decisionPolicy?: DecisionPolicy;
    readonly excludeInitiator?: ExcludeInitiatorConfig;
    readonly grades?: Readonly<Record<string, number | null>>;
    readonly instanceState?: ApprovalInstanceStateEnum;
    readonly resolver?: ApproverResolver;
    readonly submittedByMemberId?: string | null;
    readonly task?: Partial<TaskEntity>;
  } = {}): { readonly fixture: ServiceFixture; readonly seed: TaskEntity } => {
    const seed = createTask({
      assigneeMemberId,
      decisionPolicySnapshot: decisionPolicy,
      id: 'task-1',
      nodeId: 'task_finance',
      originalAssigneeMemberId: 'member-from',
      status: TaskStatusEnum.PENDING,
      tokenId: 'token-1',
      ...task,
    });
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: seed,
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState,
      processTaskCandidates: candidates,
      processWorkflowSnapshot: createLinearUserTaskWorkflow({
        allowTransfer,
        approverResolver: resolver,
        decisionPolicy,
        excludeInitiator,
      }),
      submittedByMemberId,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
      ...(grades ? createManagerChainOrg({ grades, links: [] }) : {}),
    });

    return { fixture, seed };
  };

  const reassign = (
    fixture: ServiceFixture,
    options: {
      readonly dryRun?: boolean;
      readonly fromMemberId: string;
      readonly reason?: string;
      readonly toMemberId: string;
    },
    taskId = 'task-1',
  ): Promise<TaskReassignmentResult> =>
    fixture.service.reassignTask(taskId, {
      actorMemberId: ADMIN_MEMBER_ID,
      reason: REASON,
      ...options,
    });

  it('moves a SINGLE task from its assignee in place, with no decision and no signature', async (): Promise<void> => {
    const { fixture, seed } = createOpenTaskFixture({
      assigneeMemberId: 'member-from',
    });

    const result = await reassign(fixture, {
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(result).toEqual({
      errorCode: null,
      instanceId: 'instance-1',
      message: null,
      nodeId: 'task_finance',
      outcome: TaskReassignmentOutcomeEnum.REASSIGNED,
      taskId: 'task-1',
    });
    expect(readTaskState(fixture, seed)).toMatchObject({
      assigneeMemberId: 'member-to',
      decisionPolicySnapshot: { type: 'SINGLE' },
      id: 'task-1',
      openedAt: null,
      originalAssigneeMemberId: 'member-from',
      slaDueAt: null,
      status: TaskStatusEnum.PENDING,
    });
    expect(readTaskState(fixture, seed).delegationChain).toEqual([
      {
        actorMemberId: ADMIN_MEMBER_ID,
        comment: REASON,
        from: 'member-from',
        reason: ADMIN_REASSIGN_DELEGATION_REASON,
        ruleId: null,
        to: 'member-to',
      },
    ]);
    expect(fixture.savedDecision).toBeNull();
    expect(fixture.savedTaskCandidates).toEqual([]);
    expect(fixture.savedTasks.map((task) => task.id)).toEqual(['task-1']);
    expect(writtenActivityLogs(fixture)).toContainEqual(
      expect.objectContaining({
        actorMemberId: ADMIN_MEMBER_ID,
        eventType: ActivityLogEventTypeEnum.TASK_REASSIGNED,
        payload: expect.objectContaining({
          actorMemberId: ADMIN_MEMBER_ID,
          fromMemberId: 'member-from',
          reason: REASON,
          toMemberId: 'member-to',
        }) as unknown,
        taskId: 'task-1',
      }),
    );
  });

  it('moves a task on a node that forbids holder transfers', async (): Promise<void> => {
    // allowTransfer limits what a holder does with their own task. The
    // administrator path exists for holders who are gone, so it must not strand
    // the task on them.
    const { fixture, seed } = createOpenTaskFixture({
      allowTransfer: false,
      assigneeMemberId: 'member-from',
    });

    const result = await reassign(fixture, {
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(result.outcome).toBe(TaskReassignmentOutcomeEnum.REASSIGNED);
    expect(readTaskState(fixture, seed).assigneeMemberId).toBe('member-to');
  });

  it('moves a non-assignee candidate seat and leaves the assignee alone', async (): Promise<void> => {
    const seeds = [
      createTaskCandidate({ id: 'cand-from', memberId: 'member-from' }),
    ];
    const { fixture, seed } = createOpenTaskFixture({ candidates: seeds });

    await reassign(fixture, {
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(readStatusByMember(fixture, seeds)).toEqual({
      'member-from': TaskCandidateStatusEnum.TRANSFERRED,
      'member-to': TaskCandidateStatusEnum.PENDING,
    });
    expect(readTaskState(fixture, seed)).toMatchObject({
      assigneeMemberId: null,
      delegationChain: [],
    });
    expect(
      readSeatRows(fixture, seeds).find((row) => row.memberId === 'member-to')
        ?.delegationChain,
    ).toEqual([
      expect.objectContaining({
        from: 'member-from',
        reason: ADMIN_REASSIGN_DELEGATION_REASON,
        to: 'member-to',
      }),
    ]);
    expect(fixture.savedDecision).toBeNull();
  });

  it('replaces only the reassigned member in a PARALLEL_ALL stage and keeps the threshold', async (): Promise<void> => {
    const seeds = [
      createTaskCandidate({ id: 'cand-a', memberId: 'member-a' }),
      createTaskCandidate({ id: 'cand-b', memberId: 'member-b' }),
      createTaskCandidate({ id: 'cand-c', memberId: 'member-c' }),
    ];
    const { fixture } = createOpenTaskFixture({
      candidates: seeds,
      decisionPolicy: { type: 'PARALLEL_ALL' },
      task: { assigneeMemberId: null },
    });

    await reassign(fixture, {
      fromMemberId: 'member-b',
      toMemberId: 'member-d',
    });

    expect(readStatusByMember(fixture, seeds)).toEqual({
      'member-a': TaskCandidateStatusEnum.PENDING,
      'member-b': TaskCandidateStatusEnum.TRANSFERRED,
      'member-c': TaskCandidateStatusEnum.PENDING,
      'member-d': TaskCandidateStatusEnum.PENDING,
    });

    const decide = (memberId: string): Promise<unknown> =>
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: null,
        decidedByMemberId: memberId,
        taskId: 'task-1',
      });

    await decide('member-a');
    await decide('member-c');

    expect(
      readLatestRows(fixture.savedTasks).find((task) => task.id === 'task-1')
        ?.status,
    ).not.toBe(TaskStatusEnum.COMPLETED);

    await decide('member-d');

    expect(
      readLatestRows(fixture.savedTasks).find((task) => task.id === 'task-1'),
    ).toMatchObject({
      decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
      status: TaskStatusEnum.COMPLETED,
    });
  });

  it('keeps the other PARALLEL_ANY candidates open and still cancels them on the first approval', async (): Promise<void> => {
    const seeds = [
      createTaskCandidate({ id: 'cand-a', memberId: 'member-a' }),
      createTaskCandidate({ id: 'cand-b', memberId: 'member-b' }),
    ];
    const { fixture } = createOpenTaskFixture({
      candidates: seeds,
      decisionPolicy: { type: 'PARALLEL_ANY' },
    });

    await reassign(fixture, {
      fromMemberId: 'member-b',
      toMemberId: 'member-c',
    });

    expect(readStatusByMember(fixture, seeds)).toEqual({
      'member-a': TaskCandidateStatusEnum.PENDING,
      'member-b': TaskCandidateStatusEnum.TRANSFERRED,
      'member-c': TaskCandidateStatusEnum.PENDING,
    });

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: 'member-c',
      taskId: 'task-1',
    });

    expect(readStatusByMember(fixture, seeds)).toEqual({
      'member-a': TaskCandidateStatusEnum.CANCELLED,
      'member-b': TaskCandidateStatusEnum.TRANSFERRED,
      'member-c': TaskCandidateStatusEnum.COMPLETED,
    });
  });

  it('counts the replacement toward a QUORUM threshold', async (): Promise<void> => {
    const seeds = [
      createTaskCandidate({ id: 'cand-a', memberId: 'member-a' }),
      createTaskCandidate({ id: 'cand-b', memberId: 'member-b' }),
      createTaskCandidate({ id: 'cand-c', memberId: 'member-c' }),
    ];
    const { fixture } = createOpenTaskFixture({
      candidates: seeds,
      decisionPolicy: {
        threshold: 2,
        thresholdType: 'COUNT',
        type: 'QUORUM',
      },
    });

    await reassign(fixture, {
      fromMemberId: 'member-c',
      toMemberId: 'member-d',
    });

    expect(readStatusByMember(fixture, seeds)).toEqual({
      'member-a': TaskCandidateStatusEnum.PENDING,
      'member-b': TaskCandidateStatusEnum.PENDING,
      'member-c': TaskCandidateStatusEnum.TRANSFERRED,
      'member-d': TaskCandidateStatusEnum.PENDING,
    });

    const decide = (memberId: string): Promise<unknown> =>
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: null,
        decidedByMemberId: memberId,
        taskId: 'task-1',
      });

    await decide('member-a');
    expect(
      readLatestRows(fixture.savedTasks).find((task) => task.id === 'task-1')
        ?.status,
    ).not.toBe(TaskStatusEnum.COMPLETED);

    await decide('member-d');
    expect(
      readLatestRows(fixture.savedTasks).find((task) => task.id === 'task-1')
        ?.status,
    ).toBe(TaskStatusEnum.COMPLETED);
  });

  it('keeps a WAITING SEQUENTIAL seat in its place and activates a replacement for the current seat', async (): Promise<void> => {
    const seeds = [
      createTaskCandidate({
        id: 'cand-a',
        memberId: 'member-a',
        sequence: 0,
        status: TaskCandidateStatusEnum.COMPLETED,
      }),
      createTaskCandidate({
        id: 'cand-b',
        memberId: 'member-b',
        sequence: 1,
        status: TaskCandidateStatusEnum.PENDING,
      }),
      createTaskCandidate({
        id: 'cand-c',
        memberId: 'member-c',
        sequence: 2,
        status: TaskCandidateStatusEnum.WAITING,
      }),
    ];
    const { fixture, seed } = createOpenTaskFixture({
      assigneeMemberId: 'member-b',
      candidates: seeds,
      decisionPolicy: { type: 'SEQUENTIAL' },
    });

    await reassign(fixture, {
      fromMemberId: 'member-c',
      toMemberId: 'member-d',
    });

    expect(
      readSeatRows(fixture, seeds).find((row) => row.memberId === 'member-d'),
    ).toMatchObject({
      sequence: 2,
      status: TaskCandidateStatusEnum.WAITING,
    });
    expect(readStatusByMember(fixture, seeds)).toMatchObject({
      'member-a': TaskCandidateStatusEnum.COMPLETED,
      'member-b': TaskCandidateStatusEnum.PENDING,
      'member-c': TaskCandidateStatusEnum.TRANSFERRED,
    });

    await reassign(fixture, {
      fromMemberId: 'member-b',
      toMemberId: 'member-e',
    });

    expect(
      readSeatRows(fixture, seeds).find((row) => row.memberId === 'member-e'),
    ).toMatchObject({
      sequence: 1,
      status: TaskCandidateStatusEnum.PENDING,
    });
    expect(readTaskState(fixture, seed)).toMatchObject({
      assigneeMemberId: 'member-e',
    });
    expect(
      fixture.notificationService.createTaskAssignedNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          assigneeMemberId: 'member-e',
        }) as unknown,
        transferred: true,
      }),
    );
  });

  it.each([
    {
      code: TaskReassignmentErrorCodeEnum.REASON_REQUIRED,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({ assigneeMemberId: 'member-from' }),
      options: {
        fromMemberId: 'member-from',
        reason: '   ',
        toMemberId: 'member-to',
      },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_SAME_AS_SOURCE,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({ assigneeMemberId: 'member-from' }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-from' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.SOURCE_NOT_ON_TASK,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({ assigneeMemberId: 'member-other' }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-to' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_ALREADY_ON_TASK,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          candidates: [
            createTaskCandidate({ id: 'cand-to', memberId: 'member-to' }),
          ],
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-to' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_ALREADY_DECIDED,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          candidates: [
            createTaskCandidate({
              id: 'cand-to',
              memberId: 'member-to',
              status: TaskCandidateStatusEnum.COMPLETED,
            }),
          ],
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-to' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_IS_INITIATOR,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          excludeInitiator: { whenEmpty: 'FAIL' },
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-001' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_IS_SUBMITTER,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          excludeInitiator: { whenEmpty: 'FAIL' },
          submittedByMemberId: 'member-proxy',
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-proxy' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TARGET_GRADE_TOO_LOW,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          grades: { 'member-from': 2, 'member-low': 1 },
          resolver: { minPositionLevel: 2, type: 'ORG_MANAGER_CHAIN' },
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-low' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.TASK_NOT_OPEN,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          task: { status: TaskStatusEnum.COMPLETED },
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-to' },
    },
    {
      code: TaskReassignmentErrorCodeEnum.INSTANCE_NOT_RUNNING,
      build: (): ReturnType<typeof createOpenTaskFixture> =>
        createOpenTaskFixture({
          assigneeMemberId: 'member-from',
          instanceState: ApprovalInstanceStateEnum.RETURNED,
        }),
      options: { fromMemberId: 'member-from', toMemberId: 'member-to' },
    },
  ])(
    'refuses with $code and writes nothing',
    async ({ build, code, options }): Promise<void> => {
      const { fixture } = build();

      const dryRunResult = await reassign(fixture, {
        ...options,
        dryRun: true,
      });

      expect(dryRunResult).toMatchObject({
        errorCode: code,
        outcome: TaskReassignmentOutcomeEnum.REJECTED,
      });
      await expect(reassign(fixture, options)).rejects.toThrow(
        ConflictException,
      );
      await expect(reassign(fixture, options)).rejects.toThrow(`[${code}]`);
      expect(fixture.savedTasks).toEqual([]);
      expect(fixture.savedTaskCandidates).toEqual([]);
      expect(writtenActivityLogs(fixture)).toEqual([]);
    },
  );

  it('reports what would happen under dryRun and writes nothing', async (): Promise<void> => {
    const { fixture } = createOpenTaskFixture({
      assigneeMemberId: 'member-from',
    });

    const result = await reassign(fixture, {
      dryRun: true,
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(result).toMatchObject({
      errorCode: null,
      outcome: TaskReassignmentOutcomeEnum.WOULD_REASSIGN,
    });
    expect(fixture.savedTasks).toEqual([]);
    expect(fixture.savedTaskCandidates).toEqual([]);
    expect(writtenActivityLogs(fixture)).toEqual([]);
    expect(fixture.savedDecision).toBeNull();
    expect(
      fixture.notificationService.createTaskAssignedNotification,
    ).not.toHaveBeenCalled();
  });

  it('reports each task of a member and lets one refusal stand alone', async (): Promise<void> => {
    const task1 = createTask({
      assigneeMemberId: 'member-from',
      id: 'task-1',
      nodeId: 'task_finance',
    });
    const task2 = createTask({
      assigneeMemberId: null,
      decisionPolicySnapshot: { type: 'PARALLEL_ALL' },
      id: 'task-2',
      nodeId: 'task_finance',
    });
    const task3 = createTask({
      assigneeMemberId: 'member-from',
      id: 'task-3',
      nodeId: 'task_finance',
    });
    const task2Seats = [
      createTaskCandidate({
        id: 'cand-2-from',
        memberId: 'member-from',
        taskId: 'task-2',
      }),
      createTaskCandidate({
        id: 'cand-2-to',
        memberId: 'member-to',
        taskId: 'task-2',
      }),
    ];
    const fixture = createServiceFixture({
      additionalProcessTasks: [task2, task3],
      currentVersionId: 'template-version-1',
      decisionTask: task1,
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: task2Seats,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    answerTaskQueriesFromSeeds(fixture, [task1, task2, task3]);

    const results = await fixture.service.reassignMemberTasks({
      actorMemberId: ADMIN_MEMBER_ID,
      fromMemberId: 'member-from',
      reason: REASON,
      toMemberId: 'member-to',
    });

    expect(
      results
        .map((result) => ({
          errorCode: result.errorCode,
          outcome: result.outcome,
          taskId: result.taskId,
        }))
        .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    ).toEqual([
      {
        errorCode: null,
        outcome: TaskReassignmentOutcomeEnum.REASSIGNED,
        taskId: 'task-1',
      },
      {
        errorCode: TaskReassignmentErrorCodeEnum.TARGET_ALREADY_ON_TASK,
        outcome: TaskReassignmentOutcomeEnum.REJECTED,
        taskId: 'task-2',
      },
      {
        errorCode: null,
        outcome: TaskReassignmentOutcomeEnum.REASSIGNED,
        taskId: 'task-3',
      },
    ]);
    expect(readTaskState(fixture, task1).assigneeMemberId).toBe('member-to');
    expect(readTaskState(fixture, task3).assigneeMemberId).toBe('member-to');
    expect(readStatusByMember(fixture, task2Seats)).toEqual({
      'member-from': TaskCandidateStatusEnum.PENDING,
      'member-to': TaskCandidateStatusEnum.PENDING,
    });
  });

  it('moves a task out of the old holder inbox and into the new holder inbox', async (): Promise<void> => {
    const seed = createTask({
      assigneeMemberId: 'member-from',
      id: 'task-1',
      nodeId: 'task_finance',
    });
    const { fixture } = createOpenTaskFixture({
      assigneeMemberId: 'member-from',
    });
    answerTaskQueriesFromSeeds(fixture, [seed]);

    expect(
      (await fixture.service.listInboxTasks('member-from')).map(
        (task) => task.id,
      ),
    ).toEqual(['task-1']);

    await reassign(fixture, {
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(
      (await fixture.service.listInboxTasks('member-from')).map(
        (task) => task.id,
      ),
    ).toEqual([]);
    expect(
      (await fixture.service.listInboxTasks('member-to')).map(
        (task) => task.id,
      ),
    ).toEqual(['task-1']);
  });

  it('lists a member open seats, labelled as assignee or candidate, and skips instances that are no longer running', async (): Promise<void> => {
    const seed = createTask({
      assigneeMemberId: 'member-from',
      id: 'task-1',
      nodeId: 'task_finance',
    });
    const candidateSeed = createTaskCandidate({
      id: 'cand-2',
      memberId: 'member-from',
      taskId: 'task-2',
    });
    const fixture = createServiceFixture({
      additionalProcessTasks: [
        createTask({
          assigneeMemberId: null,
          id: 'task-2',
          nodeId: 'task_finance',
        }),
      ],
      currentVersionId: 'template-version-1',
      decisionTask: seed,
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processTaskCandidates: [candidateSeed],
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });
    answerTaskQueriesFromSeeds(fixture, [
      seed,
      createTask({
        assigneeMemberId: null,
        id: 'task-2',
        nodeId: 'task_finance',
      }),
    ]);

    fixture.rootInstanceFind.mockResolvedValue([
      createApprovalInstance({
        workflowSnapshot: createLinearUserTaskWorkflow(),
      }),
    ]);

    const rows = await fixture.service.listMemberOpenTasks('member-from');

    expect(
      rows.map((row) => ({
        candidateStatus: row.candidateStatus,
        memberRole: row.memberRole,
        taskId: row.taskId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          candidateStatus: null,
          memberRole: MemberTaskRoleEnum.ASSIGNEE,
          taskId: 'task-1',
        },
        {
          candidateStatus: TaskCandidateStatusEnum.PENDING,
          memberRole: MemberTaskRoleEnum.CANDIDATE,
          taskId: 'task-2',
        },
      ]),
    );
    expect(rows[0]).toMatchObject({
      decisionPolicyType: 'SINGLE',
      nodeLabel: '財務簽核',
    });

    fixture.rootInstanceFind.mockResolvedValue([]);

    await expect(
      fixture.service.listMemberOpenTasks('member-from'),
    ).resolves.toEqual([]);
  });

  it('reads the template names of every listed task in one query', async (): Promise<void> => {
    const { fixture, seed } = createOpenTaskFixture({
      assigneeMemberId: 'member-from',
    });
    const other = createTask({
      assigneeMemberId: 'member-from',
      id: 'task-2',
      instanceId: 'instance-2',
      nodeId: 'task_finance',
    });

    answerTaskQueriesFromSeeds(fixture, [seed, other]);
    fixture.rootInstanceFind.mockResolvedValue([
      createApprovalInstance({
        workflowSnapshot: createLinearUserTaskWorkflow(),
      }),
      Object.assign(
        createApprovalInstance({
          workflowSnapshot: createLinearUserTaskWorkflow(),
        }),
        { id: 'instance-2', templateId: 'template-2' },
      ),
    ]);
    fixture.templateFind.mockResolvedValue([
      Object.assign(createTemplate('template-version-1', true), {
        id: 'template-1',
        name: '費用申請',
      }),
      Object.assign(createTemplate('template-version-2', true), {
        id: 'template-2',
        name: '採購申請',
      }),
    ]);
    fixture.templateFindOne.mockClear();

    const rows = await fixture.service.listMemberOpenTasks('member-from');

    expect(fixture.templateFind).toHaveBeenCalledTimes(1);
    expect(fixture.templateFindOne).not.toHaveBeenCalled();
    expect(
      Object.fromEntries(rows.map((row) => [row.taskId, row.templateName])),
    ).toEqual({ 'task-1': '費用申請', 'task-2': '採購申請' });
  });

  it('records the reassignment in the activity log with the administrator as actor', async (): Promise<void> => {
    const { fixture } = createOpenTaskFixture({
      assigneeMemberId: 'member-from',
    });

    await reassign(fixture, {
      fromMemberId: 'member-from',
      toMemberId: 'member-to',
    });

    expect(
      writtenActivityLogs(fixture).filter(
        (log) => log.eventType === ActivityLogEventTypeEnum.TASK_REASSIGNED,
      ),
    ).toHaveLength(1);
    expect(
      writtenActivityLogs(fixture).some(
        (log) => log.eventType === ActivityLogEventTypeEnum.TASK_DECIDED,
      ),
    ).toBe(false);
  });
  describe('holder transfer of a group decision stage', (): void => {
    const transfer = (
      fixture: ServiceFixture,
      fromMemberId: string,
      toMemberId: string,
    ): Promise<unknown> =>
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: '交給同事處理',
        decidedByMemberId: fromMemberId,
        taskId: 'task-1',
        transferToMemberId: toMemberId,
      });

    const readOpenTaskStatus = (
      fixture: ServiceFixture,
    ): TaskStatusEnum | undefined =>
      readLatestRows(fixture.savedTasks).find((task) => task.id === 'task-1')
        ?.status;

    const seedsFor = (): readonly TaskCandidateEntity[] => [
      createTaskCandidate({ id: 'cand-a', memberId: 'member-a' }),
      createTaskCandidate({ id: 'cand-b', memberId: 'member-b' }),
      createTaskCandidate({ id: 'cand-c', memberId: 'member-c' }),
    ];

    it('rejects a holder transfer to a member who already holds an open seat', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: { type: 'PARALLEL_ALL' },
        task: { assigneeMemberId: null },
      });

      await expect(transfer(fixture, 'member-b', 'member-c')).rejects.toThrow(
        'Transfer target already holds an open seat on this task',
      );
      expect(readStatusByMember(fixture, seeds)).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.PENDING,
      });
    });

    it('rejects a holder transfer to a member who has already decided', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: { type: 'PARALLEL_ALL' },
        task: { assigneeMemberId: null },
      });

      await fixture.service.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: null,
        decidedByMemberId: 'member-a',
        taskId: 'task-1',
      });

      await expect(transfer(fixture, 'member-b', 'member-a')).rejects.toThrow(
        'Transfer target has already decided this task',
      );
      expect(readStatusByMember(fixture, seeds)).toEqual({
        'member-a': TaskCandidateStatusEnum.COMPLETED,
        'member-b': TaskCandidateStatusEnum.PENDING,
        'member-c': TaskCandidateStatusEnum.PENDING,
      });
    });

    it('leaves the task-level assignee, delegation chain and openedAt untouched', async (): Promise<void> => {
      const { fixture } = createOpenTaskFixture({
        candidates: seedsFor(),
        decisionPolicy: { type: 'PARALLEL_ALL' },
        task: { assigneeMemberId: null, openedAt: null },
      });

      await transfer(fixture, 'member-b', 'member-d');

      const latest = readLatestRows(fixture.savedTasks).find(
        (task) => task.id === 'task-1',
      );

      expect(latest?.assigneeMemberId).toBeNull();
      expect(latest?.openedAt).toBeNull();
      expect(latest?.delegationChain ?? []).toEqual([]);
    });

    it('keeps a PARALLEL_ALL stage open and moves only the transferring seat', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: { type: 'PARALLEL_ALL' },
        task: { assigneeMemberId: null },
      });

      await transfer(fixture, 'member-b', 'member-d');

      expect(readOpenTaskStatus(fixture)).not.toBe(TaskStatusEnum.TRANSFERRED);
      expect(readOpenTaskStatus(fixture)).not.toBe(TaskStatusEnum.COMPLETED);
      expect(
        readLatestRows(fixture.savedTasks).filter(
          (task) => task.id !== 'task-1',
        ),
      ).toEqual([]);
      expect(readStatusByMember(fixture, seeds)).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
        'member-b': TaskCandidateStatusEnum.TRANSFERRED,
        'member-c': TaskCandidateStatusEnum.PENDING,
        'member-d': TaskCandidateStatusEnum.PENDING,
      });
    });

    it('keeps the transfer on the same task and still needs every remaining approver of PARALLEL_ALL', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: { type: 'PARALLEL_ALL' },
        task: { assigneeMemberId: null },
      });

      await transfer(fixture, 'member-b', 'member-d');

      const decide = (memberId: string): Promise<unknown> =>
        fixture.service.decideTask({
          action: TaskDecisionActionEnum.APPROVED,
          comment: null,
          decidedByMemberId: memberId,
          taskId: 'task-1',
        });

      await decide('member-a');
      await decide('member-c');

      expect(readOpenTaskStatus(fixture)).not.toBe(TaskStatusEnum.COMPLETED);

      await decide('member-d');

      expect(readOpenTaskStatus(fixture)).toBe(TaskStatusEnum.COMPLETED);
    });

    it('keeps the other PARALLEL_ANY candidates open after a holder transfer', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: { type: 'PARALLEL_ANY' },
        task: { assigneeMemberId: null },
      });

      await transfer(fixture, 'member-b', 'member-d');

      expect(readOpenTaskStatus(fixture)).not.toBe(TaskStatusEnum.TRANSFERRED);
      expect(
        readLatestRows(fixture.savedTasks).filter(
          (task) => task.id !== 'task-1',
        ),
      ).toEqual([]);
      expect(readStatusByMember(fixture, seeds)).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
        'member-b': TaskCandidateStatusEnum.TRANSFERRED,
        'member-c': TaskCandidateStatusEnum.PENDING,
        'member-d': TaskCandidateStatusEnum.PENDING,
      });
    });

    it('keeps a QUORUM stage open and moves only the transferring seat', async (): Promise<void> => {
      const seeds = seedsFor();
      const { fixture } = createOpenTaskFixture({
        candidates: seeds,
        decisionPolicy: {
          threshold: 2,
          thresholdType: 'COUNT',
          type: 'QUORUM',
        },
        task: { assigneeMemberId: null },
      });

      await transfer(fixture, 'member-b', 'member-d');

      expect(readOpenTaskStatus(fixture)).not.toBe(TaskStatusEnum.TRANSFERRED);
      expect(
        readLatestRows(fixture.savedTasks).filter(
          (task) => task.id !== 'task-1',
        ),
      ).toEqual([]);
      expect(readStatusByMember(fixture, seeds)).toEqual({
        'member-a': TaskCandidateStatusEnum.PENDING,
        'member-b': TaskCandidateStatusEnum.TRANSFERRED,
        'member-c': TaskCandidateStatusEnum.PENDING,
        'member-d': TaskCandidateStatusEnum.PENDING,
      });
    });
  });
});

describe('WorkflowEngineService task node labels', () => {
  function createLabelFixture(): ReturnType<typeof createServiceFixture> {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    fixture.rootInstanceFind.mockResolvedValue([
      createApprovalInstance({
        id: 'instance-1',
        workflowSnapshot: createLinearUserTaskWorkflow(),
      }),
      createApprovalInstance({
        id: 'instance-2',
        workflowSnapshot: {
          edges: [],
          meta: { schemaVersion: 1 },
          nodes: [
            createUserTaskNode('band-0', '部門主管簽核', 'member-finance', 0, 0),
          ],
        },
      }),
    ]);
    fixture.rootTaskFind.mockResolvedValue([
      createTask({ id: 'task-a', instanceId: 'instance-1' }),
      createTask({ id: 'task-b', instanceId: 'instance-2', nodeId: 'band-0' }),
      createTask({ id: 'task-c', instanceId: 'instance-1', nodeId: 'gone' }),
      createTask({ id: 'task-d', instanceId: 'missing-instance' }),
    ]);

    return fixture;
  }

  it('reads nodeLabel from each instance snapshot, null when the node or instance is unknown', async (): Promise<void> => {
    const fixture = createLabelFixture();

    const tasks = await fixture.service.listInboxTasks('member-finance');

    expect(
      Object.fromEntries(tasks.map((task) => [task.id, task.nodeLabel])),
    ).toEqual({
      'task-a': '財務簽核',
      'task-b': '部門主管簽核',
      'task-c': null,
      'task-d': null,
    });
  });

  it('reads the labels for a whole task list in one query, without loading the snapshots', async (): Promise<void> => {
    const fixture = createLabelFixture();

    await fixture.service.listInboxTasks('member-finance');

    expect(fixture.rootInstanceNodeLabelQuery).toHaveBeenCalledTimes(1);
    expect(fixture.rootInstanceNodeLabelQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM "bpm"."approval_instances" AS instance'),
      [
        ['instance-1', 'instance-2', 'missing-instance'],
        ['task_finance', 'band-0', 'gone'],
      ],
    );
    expect(fixture.rootInstanceFind).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ workflowSnapshot: true }),
      }),
    );
  });

  it('gives an ad-hoc task in a list the plain label of the node it sits on', async (): Promise<void> => {
    const fixture = createLabelFixture();

    fixture.rootTaskFind.mockResolvedValue([
      createTask({
        adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        id: 'task-adhoc',
        instanceId: 'instance-1',
        isAdhoc: true,
        nodeId: 'task_finance',
      }),
    ]);

    const [task] = await fixture.service.listInboxTasks('member-finance');

    // No 臨時加簽 wording on the server; clients add it from isAdhoc/adhocType.
    expect(task?.nodeLabel).toBe('財務簽核');
  });

  it('labels approval history tasks too', async (): Promise<void> => {
    const fixture = createLabelFixture();

    const tasks = await fixture.service.listApprovalHistoryTasks('member-finance');

    expect(tasks.find((task) => task.id === 'task-b')?.nodeLabel).toBe(
      '部門主管簽核',
    );
    expect(fixture.rootInstanceNodeLabelQuery).toHaveBeenCalledTimes(1);
  });

  it('labels the tasks of an instance', async (): Promise<void> => {
    const fixture = createLabelFixture();

    fixture.rootTaskFind.mockResolvedValue([
      createTask({ id: 'task-a', instanceId: 'instance-1' }),
    ]);

    const [task] = await fixture.service.listTasks('instance-1');

    expect(task?.nodeLabel).toBe('財務簽核');
  });
});

interface ServiceFixture {
  readonly managerQuery: jest.Mock<
    Promise<unknown>,
    [string, readonly unknown[]]
  >;
  readonly orgUnitFindOne: import('typeorm').Repository<OrgUnitEntity>['findOne'];
  readonly positionFindOne: import('typeorm').Repository<PositionEntity>['findOne'];
  readonly delegationService: {
    readonly resolveAssignee: jest.Mock<
      Promise<DelegationResolution>,
      [string]
    >;
  };
  readonly notificationService: Pick<
    NotificationService,
    | 'createAdhocWorkflowNotifications'
    | 'createInstanceCompletedNotification'
    | 'createServiceTaskNotifications'
    | 'createTaskAssignedNotification'
    | 'readMemberDisplayName'
    | 'resolveTaskNotifications'
    | 'supersedeInstanceTaskNotifications'
  >;
  readonly notificationFind: jest.Mock<
    Promise<readonly NotificationEntity[]>,
    [Readonly<Record<string, unknown>>]
  >;
  readonly rootInstanceCount: jest.Mock<Promise<number>, []>;
  readonly membershipFind: import('typeorm').Repository<MembershipEntity>['find'];
  readonly rootInstanceNodeLabelQuery: jest.Mock<
    Promise<readonly Readonly<Record<string, unknown>>[]>,
    [string, readonly [readonly string[], readonly string[]]]
  >;
  readonly rootInstanceFindOne: jest.Mock<
    Promise<ApprovalInstanceEntity | null>,
    [Readonly<Record<string, unknown>>?]
  >;
  readonly rootInstanceFind: jest.Mock<
    Promise<readonly ApprovalInstanceEntity[]>,
    [Readonly<Record<string, unknown>>?]
  >;
  readonly rootInstanceQueryBuilder: ApprovalInstanceQueryBuilderMock;
  readonly rootTaskFind: jest.Mock<
    Promise<readonly TaskEntity[]>,
    [Readonly<Record<string, unknown>>]
  >;
  readonly savedDecision: TaskDecisionEntity | null;
  readonly savedActivityLogs: readonly ActivityLogEntity[];
  readonly savedInstance: ApprovalInstanceEntity | null;
  readonly savedAdhocDirectives: readonly AdhocDirectiveEntity[];
  readonly savedProcessLog: ActivityLogEntity | null;
  readonly savedProcessToken: WorkflowTokenEntity | null;
  readonly savedSingleActivityLogs: readonly ActivityLogEntity[];
  readonly savedTaskCandidates: readonly TaskCandidateEntity[];
  readonly savedTasks: readonly TaskEntity[];
  readonly savedWorkflowTokens: readonly WorkflowTokenEntity[];
  readonly savedToken: WorkflowTokenEntity | null;
  readonly service: WorkflowEngineService;
  readonly templateFind: jest.Mock<
    Promise<readonly ApprovalTemplateEntity[]>,
    [Readonly<Record<string, unknown>>?]
  >;
  readonly templateFindOne: jest.Mock;
  readonly taskCandidateFind: jest.Mock<
    Promise<readonly TaskCandidateEntity[]>,
    [Readonly<{ where?: Readonly<Record<string, unknown>> }>?]
  >;
}

interface ApprovalInstanceQueryBuilderMock {
  readonly andWhere: jest.Mock<
    ApprovalInstanceQueryBuilderMock,
    [string, Readonly<Record<string, unknown>>?]
  >;
  readonly getCount: jest.Mock<Promise<number>, []>;
  readonly getMany: jest.Mock<Promise<readonly ApprovalInstanceEntity[]>, []>;
  readonly orderBy: jest.Mock<
    ApprovalInstanceQueryBuilderMock,
    [string, 'ASC' | 'DESC']
  >;
  readonly skip: jest.Mock<ApprovalInstanceQueryBuilderMock, [number]>;
  readonly take: jest.Mock<ApprovalInstanceQueryBuilderMock, [number]>;
}

interface OrgUnitQueryBuilderMock {
  readonly andWhere: jest.Mock<
    OrgUnitQueryBuilderMock,
    [string, { readonly path?: string }?]
  >;
  readonly getMany: jest.Mock<Promise<readonly OrgUnitEntity[]>, []>;
  readonly where: jest.Mock<OrgUnitQueryBuilderMock, []>;
}

function createServiceFixture({
  additionalProcessTasks = [],
  currentVersionId,
  delegationResolution,
  delegationResolutionByMember = {},
  decisionTask,
  decisionToken,
  formDataSourceValueResolver,
  formSchema,
  formVersionStatus,
  instanceSaveError,
  instanceState,
  latestReturnActivity,
  processActivityLogs = [],
  processAdhocDirectives = [],
  processBusinessKey,
  processTaskCandidates = [],
  processFormData,
  processFormDefinitionSnapshot,
  processOptionSnapshot,
  processManagerResolutions = [],
  processMemberships = [],
  processNotifications = [],
  processOrgUnits = [],
  processPositions = [],
  processWorkflowSnapshot,
  rootInstanceUpdatedAt,
  rootOptions,
  serviceTaskDispatcher,
  submittedByMemberId,
  templateIsActive = true,
  templateVersionStatus,
  transactionalInstanceUpdatedAt,
  webhookDeliveryService,
}: {
  readonly additionalProcessTasks?: readonly TaskEntity[];
  readonly currentVersionId: string | null;
  readonly delegationResolution?: DelegationResolution;
  // Per-member delegation, taking precedence over `delegationResolution`.
  readonly delegationResolutionByMember?: Readonly<
    Record<string, DelegationResolution>
  >;
  readonly decisionTask?: TaskEntity;
  readonly decisionToken?: WorkflowTokenEntity;
  readonly formSchema?: FormDefinitionSchema;
  readonly formVersionStatus: FormDefinitionVersionStatusEnum;
  // Makes the instance insert fail, the way the database would on a clash.
  readonly instanceSaveError?: Error;
  readonly instanceState?: ApprovalInstanceStateEnum;
  readonly latestReturnActivity?: ActivityLogEntity | null;
  readonly processActivityLogs?: readonly ActivityLogEntity[];
  readonly processAdhocDirectives?: readonly AdhocDirectiveEntity[];
  readonly processBusinessKey?: string;
  readonly processTaskCandidates?: readonly TaskCandidateEntity[];
  readonly processFormData?: Readonly<Record<string, unknown>>;
  readonly processFormDefinitionSnapshot?: Readonly<Record<string, unknown>>;
  readonly processManagerResolutions?: readonly ManagerResolutionEntity[];
  readonly processMemberships?: readonly MembershipEntity[];
  readonly processNotifications?: readonly NotificationEntity[];
  readonly processOptionSnapshot?: FormDataSourceValueSnapshots;
  readonly processOrgUnits?: readonly OrgUnitEntity[];
  readonly processPositions?: readonly PositionEntity[];
  readonly processWorkflowSnapshot?: WorkflowDefinition;
  readonly webhookDeliveryService?: WorkflowWebhookDeliveryService;
  readonly rootInstanceUpdatedAt?: Date;
  readonly rootOptions?: BPMRootRuntimeOptions;
  readonly serviceTaskDispatcher?: BPMWorkflowServiceTaskDispatcher;
  // The person who filed the processed instance; unset reads like a row
  // written before the column existed (the initiator submitted it).
  readonly submittedByMemberId?: string | null;
  readonly templateIsActive?: boolean;
  readonly templateVersionStatus: ApprovalTemplateVersionStatusEnum;
  readonly transactionalInstanceUpdatedAt?: Date;
  readonly formDataSourceValueResolver?: BPMFormDataSourceValueResolver;
}): ServiceFixture {
  let savedToken: WorkflowTokenEntity | null = null;
  let tokenSequence = 1;
  let taskSequence = 1;
  let processTokens: readonly WorkflowTokenEntity[] = processWorkflowSnapshot
    ? [
        decisionToken ??
          createWorkflowToken({
            currentNodeId: 'start',
            status: WorkflowTokenStatusEnum.ACTIVE,
          }),
      ]
    : [];
  let processTasks: readonly TaskEntity[] = [
    ...(decisionTask ? [decisionTask] : []),
    ...additionalProcessTasks,
  ];
  let savedProcessToken: WorkflowTokenEntity | null = null;
  let savedDecision: TaskDecisionEntity | null = null;
  let savedInstance: ApprovalInstanceEntity | null = null;
  let savedProcessLog: ActivityLogEntity | null = null;
  let savedActivityLogs: readonly ActivityLogEntity[] = [];
  let savedSingleActivityLogs: readonly ActivityLogEntity[] = [];
  let storedActivityLogs: readonly ActivityLogEntity[] = processActivityLogs;
  let savedTasks: readonly TaskEntity[] = [];
  let savedTaskCandidates: readonly TaskCandidateEntity[] = [];
  let processTaskCandidateRows: readonly TaskCandidateEntity[] = [
    ...processTaskCandidates,
  ];
  let taskCandidateSequence = 0;
  const template = createTemplate(currentVersionId, templateIsActive);
  const templateVersion = createTemplateVersion(templateVersionStatus);
  const formVersion = createFormVersion(formVersionStatus, formSchema);
  const rootInstanceFind = jest.fn<
    Promise<readonly ApprovalInstanceEntity[]>,
    [Readonly<Record<string, unknown>>?]
  >(() => Promise.resolve([createApprovalInstance()]));
  const rootInstanceCount = jest.fn<Promise<number>, []>(() =>
    rootInstanceFind().then((instances) => instances.length),
  );
  const rootInstanceQueryBuilder = createApprovalInstanceQueryBuilderMock(
    rootInstanceFind,
    rootInstanceCount,
  );
  const rootTaskFind = jest.fn<
    Promise<readonly TaskEntity[]>,
    [Readonly<Record<string, unknown>>]
  >(() => Promise.resolve([]));
  const rootInstanceFindOne = jest.fn<
    Promise<ApprovalInstanceEntity | null>,
    [Readonly<Record<string, unknown>>?]
  >(() =>
    Promise.resolve(
      createApprovalInstance({
        businessKey: processBusinessKey,
        formData: processFormData,
        formDataOptionSnapshot: processOptionSnapshot,
        formDefinitionSnapshot: processFormDefinitionSnapshot,
        state: instanceState,
        submittedByMemberId,
        updatedAt: rootInstanceUpdatedAt,
        workflowSnapshot: processWorkflowSnapshot,
      }),
    ),
  );
  const rootInstanceNodeLabelQuery = jest.fn(
    async (
      _sql: string,
      [instanceIds, nodeIds]: readonly [readonly string[], readonly string[]],
    ): Promise<readonly Readonly<Record<string, unknown>>[]> =>
      (await rootInstanceFind())
        .filter((instance) => instanceIds.includes(instance.id))
        .flatMap((instance) =>
          (instance.workflowSnapshot?.nodes ?? [])
            .filter((node) => nodeIds.includes(node.id))
            .map((node) => ({
              instanceId: instance.id,
              label:
                typeof node.data.label === 'string' ? node.data.label : null,
              nodeId: node.id,
            })),
        ),
  );
  const instanceRepository = createRepository<ApprovalInstanceEntity>({
    createQueryBuilder: jest.fn(() => rootInstanceQueryBuilder),
    find: rootInstanceFind,
    findOne: rootInstanceFindOne,
    metadata: { schema: 'bpm', tableName: 'approval_instances' },
    // Stands in for the jsonb node-label query (`readTaskNodeLabels`): the
    // label of each requested node, read from the instances `find` knows.
    query: rootInstanceNodeLabelQuery,
  });
  const tokenRepository = createRepository<WorkflowTokenEntity>({});
  const taskRepository = createRepository<TaskEntity>({
    find: rootTaskFind,
    findOne: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<{ id?: string }> }>,
      ): Promise<TaskEntity | null> =>
        Promise.resolve(
          processTasks.find((task) => task.id === options?.where?.id) ?? null,
        ),
    ),
  });
  const taskCandidateFind = jest.fn(
    (
      options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
    ): Promise<readonly TaskCandidateEntity[]> =>
      Promise.resolve(
        processTaskCandidateRows.filter((candidate) =>
          matchesFindWhere(candidate, options?.where),
        ),
      ),
  );
  const taskCandidateRepository = createRepository<TaskCandidateEntity>({
    find: taskCandidateFind,
  });
  const taskDecisionRepository = createRepository<TaskDecisionEntity>({
    find: jest.fn(() => Promise.resolve([])),
  });
  const notificationFind = jest.fn<
    Promise<readonly NotificationEntity[]>,
    [Readonly<Record<string, unknown>>]
  >(() => Promise.resolve(processNotifications));
  const notificationRepository = createRepository<NotificationEntity>({
    find: notificationFind,
  });
  const activityLogRepository = createRepository<ActivityLogEntity>({});
  let processAdhocDirectiveRows: readonly AdhocDirectiveEntity[] = [
    ...processAdhocDirectives,
  ];
  let directiveSequence = 0;
  const adhocDirectiveRepository = createRepository<AdhocDirectiveEntity>({
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly AdhocDirectiveEntity[]> =>
        Promise.resolve(
          processAdhocDirectiveRows
            .filter((directive) => matchesFindWhere(directive, options?.where))
            .sort(
              (left, right) =>
                left.createdAt.getTime() - right.createdAt.getTime(),
            ),
        ),
    ),
  });
  const transactionalAdhocDirectiveRepository =
    createRepository<AdhocDirectiveEntity>({
      create: jest.fn(
        (entity: Partial<AdhocDirectiveEntity>): AdhocDirectiveEntity =>
          Object.assign(new AdhocDirectiveEntity(), entity),
      ),
      find: jest.fn(
        (
          options?: Readonly<{
            where?: Readonly<Record<string, unknown>>;
          }>,
        ): Promise<readonly AdhocDirectiveEntity[]> =>
          Promise.resolve(
            processAdhocDirectiveRows.filter((directive) =>
              matchesFindWhere(directive, options?.where),
            ),
          ),
      ),
     findOne: jest.fn(
        (
          options?: Readonly<{ where?: Readonly<{ id?: string }> }>,
        ): Promise<AdhocDirectiveEntity | null> =>
          Promise.resolve(
            processAdhocDirectiveRows.find(
              (directive) => directive.id === options?.where?.id,
            ) ?? null,
          ),
      ),
      save: jest.fn(
        (
          entityOrEntities: AdhocDirectiveEntity | AdhocDirectiveEntity[],
        ): Promise<AdhocDirectiveEntity | AdhocDirectiveEntity[]> => {
          const entities = Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities];
          const entitiesWithIds = entities.map((entity) => {
            if (entity.id) {
              return entity;
            }

            directiveSequence += 1;

            return Object.assign(new AdhocDirectiveEntity(), entity, {
              id: `directive-${directiveSequence}`,
            });
          });
          const entityIds = new Set(
            entitiesWithIds.map((entity) => entity.id),
          );

          processAdhocDirectiveRows = [
            ...processAdhocDirectiveRows.filter(
              (directive) => !entityIds.has(directive.id),
            ),
            ...entitiesWithIds,
          ];

          return Promise.resolve(
            Array.isArray(entityOrEntities)
              ? entitiesWithIds
              : (entitiesWithIds[0] ?? entityOrEntities),
          );
        },
      ),
    });
  const delegationService = {
    resolveAssignee: jest.fn(
      (assigneeMemberId: string): Promise<DelegationResolution> =>
        Promise.resolve(
          delegationResolutionByMember[assigneeMemberId] ??
            delegationResolution ?? {
              delegationChain: [],
              finalAssigneeMemberId: assigneeMemberId,
            },
        ),
    ),
  };
  const notificationService = {
    createAdhocWorkflowNotifications: jest.fn(() => Promise.resolve([])),
    createInstanceCompletedNotification: jest.fn(() => Promise.resolve([])),
    createServiceTaskNotifications: jest.fn(() => Promise.resolve([])),
    createTaskAssignedNotification: jest.fn(() => Promise.resolve([])),
    readMemberDisplayName: jest.fn((memberId: string) =>
      Promise.resolve(`name-of-${memberId}`),
    ),
    resolveTaskNotifications: jest.fn(() => Promise.resolve()),
    supersedeInstanceTaskNotifications: jest.fn(() => Promise.resolve()),
  };
  const attachmentService = {
    bindFormDataAttachmentsToInstance: jest.fn(() => Promise.resolve()),
  };
  const signatureService = {
    signTaskDecision: jest.fn(() =>
      Promise.resolve(
        Object.assign(new SignatureEntity(), {
          id: 'signature-1',
          signedPayloadHash: 'signed-payload-hash-1',
        }),
      ),
    ),
  };
  const templateFind = jest.fn<
    Promise<readonly ApprovalTemplateEntity[]>,
    [Readonly<Record<string, unknown>>?]
  >(() => Promise.resolve([template]));
  const templateFindOne = jest.fn(() => Promise.resolve(template));
  const templateRepository = createRepository<ApprovalTemplateEntity>({
    find: templateFind,
    findOne: templateFindOne,
  });
  const templateVersionRepository =
    createRepository<ApprovalTemplateVersionEntity>({
      findOne: jest.fn(() => Promise.resolve(templateVersion)),
    });
  const formVersionRepository = createRepository<FormDefinitionVersionEntity>({
    findOne: jest.fn(() => Promise.resolve(formVersion)),
  });
  const transactionalInstanceRepository =
    createRepository<ApprovalInstanceEntity>({
      create: jest.fn(
        (entity: Partial<ApprovalInstanceEntity>): ApprovalInstanceEntity =>
          Object.assign(createApprovalInstance(), entity),
      ),
      findOne: jest.fn(() =>
        Promise.resolve(
          // A row read back from the database is an entity whatever shape the
          // caller last handed to `save`, so it is rehydrated here. Only
          // `save` reports the shape it was actually given.
          savedInstance
            ? Object.assign(createApprovalInstance(), savedInstance)
            : createApprovalInstance({
                businessKey: processBusinessKey,
                formData: processFormData,
                formDataOptionSnapshot: processOptionSnapshot,
                formDefinitionSnapshot: processFormDefinitionSnapshot,
                state: instanceState,
                submittedByMemberId,
                updatedAt: transactionalInstanceUpdatedAt,
                workflowSnapshot: processWorkflowSnapshot,
              }),
        ),
      ),
      save: jest.fn((entity: ApprovalInstanceEntity) => {
        if (instanceSaveError) {
          return Promise.reject(instanceSaveError);
        }

        // The saved row keeps the prototype it arrived with. Rebuilding it as
        // `Object.assign(createApprovalInstance(), entity)` handed back an
        // entity even when the caller had spread the row into a plain object,
        // which hid exactly the regression the cancel paths guard against:
        // the getter-backed `*Json` fields the GraphQL schema exposes live on
        // the prototype, so a plain object fails the mutation at resolve time.
        savedInstance = Object.assign(
          Object.create(
            Object.getPrototypeOf(entity) as object,
          ) as ApprovalInstanceEntity,
          createApprovalInstance(),
          entity,
        );

        return Promise.resolve(savedInstance);
      }),
    });
  const transactionalTokenRepository = createRepository<WorkflowTokenEntity>({
    create: jest.fn(
      (entity: Partial<WorkflowTokenEntity>): WorkflowTokenEntity => ({
        consumedAt: null,
        createdAt: new Date('2026-05-04T09:00:00.000Z'),
        currentNodeId: entity.currentNodeId ?? 'start',
        id: entity.id ?? `token-${(tokenSequence += 1)}`,
        instanceId: entity.instanceId ?? 'instance-1',
        parentTokenId: entity.parentTokenId ?? null,
        status: entity.status ?? WorkflowTokenStatusEnum.ACTIVE,
      }),
    ),
    save: jest.fn(
      (
        entityOrEntities: WorkflowTokenEntity | WorkflowTokenEntity[],
      ): Promise<WorkflowTokenEntity | WorkflowTokenEntity[]> => {
        if (processWorkflowSnapshot) {
          const entities = Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities];
          const entitiesWithIds = entities.map((entity) => {
            const token = { ...entity };

            if (!token.id) {
              tokenSequence += 1;

              return { ...token, id: `token-${tokenSequence}` };
            }

            if (/^token-\d+$/u.test(token.id)) {
              const idNumber = Number(token.id.replace('token-', ''));

              tokenSequence = Math.max(tokenSequence, idNumber);
            }

            return token;
          });
          const entityIds = new Set(entitiesWithIds.map((entity) => entity.id));

          processTokens = [
            ...processTokens.filter((token) => !entityIds.has(token.id)),
            ...entitiesWithIds,
          ];
          savedProcessToken =
            entitiesWithIds[entitiesWithIds.length - 1] ?? null;

          return Promise.resolve(
            Array.isArray(entityOrEntities)
              ? entitiesWithIds
              : (entitiesWithIds[0] ?? entityOrEntities),
          );
        } else {
          savedToken = entityOrEntities as WorkflowTokenEntity;
        }

        return Promise.resolve(entityOrEntities);
      },
    ),
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly WorkflowTokenEntity[]> =>
        Promise.resolve(
          processTokens
            .filter((token) => matchesFindWhere(token, options?.where))
            .sort(compareTokenCreatedAt),
        ),
    ),
    findOne: jest.fn(
      (
        options?: Readonly<{
          where?: Readonly<{ id?: string }>;
        }>,
      ) =>
        Promise.resolve(
          options?.where?.id
            ? (processTokens.find((token) => token.id === options.where?.id) ??
                null)
            : (processTokens
                .filter(
                  (token) => token.status === WorkflowTokenStatusEnum.ACTIVE,
                )
                .sort(compareTokenCreatedAt)[0] ?? null),
        ),
    ),
  });
  const transactionalTaskRepository = createRepository<TaskEntity>({
    create: jest.fn(
      (entity: Partial<TaskEntity>): TaskEntity =>
        Object.assign(new TaskEntity(), {
          adhocDirectiveId: entity.adhocDirectiveId ?? null,
          adhocOriginTaskId: entity.adhocOriginTaskId ?? null,
          adhocType: entity.adhocType ?? null,
          isAdhoc: entity.isAdhoc ?? false,
          assigneeMemberId: entity.assigneeMemberId ?? 'member-finance',
          assignmentType:
            entity.assignmentType ?? TaskAssignmentTypeEnum.DIRECT_MEMBER,
          completedAt: entity.completedAt ?? null,
          createdAt: new Date('2026-05-04T09:00:00.000Z'),
          delegationChain: entity.delegationChain ?? [],
          id: entity.id ?? `task-${(taskSequence += 1)}`,
          instanceId: entity.instanceId ?? 'instance-1',
          nodeId: entity.nodeId ?? 'task_finance',
          openedAt: entity.openedAt ?? null,
          originalAssigneeMemberId:
            entity.originalAssigneeMemberId ?? 'member-finance',
          decisionPolicySnapshot: entity.decisionPolicySnapshot ?? {
            type: 'SINGLE',
          },
          slaDueAt: entity.slaDueAt ?? null,
          status: entity.status ?? TaskStatusEnum.PENDING,
          tokenId: entity.tokenId ?? 'token-1',
        }),
    ),
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly TaskEntity[]> =>
        Promise.resolve(
          processTasks.filter((task) => matchesFindWhere(task, options?.where)),
        ),
    ),
    findOne: jest.fn(
      (
        options?: Readonly<{
          where?: Readonly<{ id?: string; nodeId?: string; tokenId?: string }>;
        }>,
      ) =>
        Promise.resolve(
          options?.where?.id
            ? (processTasks.find((task) => task.id === options.where?.id) ??
                null)
            : options?.where?.tokenId
              ? (processTasks.find(
                  (task) =>
                    task.tokenId === options.where?.tokenId &&
                    (!options.where?.nodeId ||
                      task.nodeId === options.where.nodeId),
                ) ?? null)
              : null,
        ),
    ),
    save: jest.fn(
      (
        entityOrEntities: TaskEntity | TaskEntity[],
      ): Promise<TaskEntity | TaskEntity[]> => {
        const entities = Array.isArray(entityOrEntities)
          ? entityOrEntities
          : [entityOrEntities];
        const entitiesWithIds = entities.map((entity) => {
          const task = Object.assign(new TaskEntity(), entity);

          if (!task.id) {
            taskSequence += 1;

            return Object.assign(new TaskEntity(), task, {
              id: `task-${taskSequence}`,
            });
          }

          if (/^task-\d+$/u.test(task.id)) {
            const idNumber = Number(task.id.replace('task-', ''));

            taskSequence = Math.max(taskSequence, idNumber);
          }

          return task;
        });
        const entityIds = new Set(entitiesWithIds.map((entity) => entity.id));

        processTasks = [
          ...processTasks.filter((task) => !entityIds.has(task.id)),
          ...entitiesWithIds,
        ];
        savedTasks = [...savedTasks, ...entitiesWithIds];

        return Promise.resolve(
          Array.isArray(entityOrEntities)
            ? entitiesWithIds
            : (entitiesWithIds[0] ?? entityOrEntities),
        );
      },
    ),
  });
  const transactionalTaskCandidateRepository =
    createRepository<TaskCandidateEntity>({
      create: jest.fn(
        (entity: Partial<TaskCandidateEntity>): TaskCandidateEntity =>
          Object.assign(new TaskCandidateEntity(), {
            claimedAt: entity.claimedAt ?? null,
            createdAt: entity.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
            decidedAt: entity.decidedAt ?? null,
            delegationChain: entity.delegationChain ?? [],
            // A per-row id, not a constant: a multi-candidate task compares
            // candidates by id when it marks one decided, so a shared id would
            // make every candidate look like the one that just decided.
            id: entity.id ?? `task-candidate-${(taskCandidateSequence += 1)}`,
            memberId: entity.memberId ?? 'member-finance',
            originalMemberId: entity.originalMemberId ?? 'member-finance',
            sequence: entity.sequence ?? null,
            sourceType: entity.sourceType ?? 'DIRECT',
            status: entity.status ?? TaskCandidateStatusEnum.PENDING,
            taskId: entity.taskId ?? 'task-1',
          }),
      ),
      find: jest.fn(
        (
          options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
        ): Promise<readonly TaskCandidateEntity[]> =>
          Promise.resolve(
            processTaskCandidateRows.filter((candidate) =>
              matchesFindWhere(candidate, options?.where),
            ),
          ),
      ),
      save: jest.fn(
        (
          entityOrEntities: TaskCandidateEntity | TaskCandidateEntity[],
        ): Promise<TaskCandidateEntity | TaskCandidateEntity[]> => {
          const entities = Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities];

          savedTaskCandidates = [...savedTaskCandidates, ...entities];

          const writtenIds = new Set(entities.map((entity) => entity.id));

          // Saved rows are readable again, so a second decision on the same
          // task sees what the first one wrote.
          processTaskCandidateRows = [
            ...processTaskCandidateRows.filter(
              (candidate) => !writtenIds.has(candidate.id),
            ),
            ...entities,
          ];

          return Promise.resolve(entityOrEntities);
        },
      ),
    });
  const transactionalTaskDecisionRepository =
    createRepository<TaskDecisionEntity>({
      create: jest.fn(
        (entity: Partial<TaskDecisionEntity>): TaskDecisionEntity =>
          Object.assign(new TaskDecisionEntity(), {
            action: entity.action ?? TaskDecisionActionEnum.APPROVED,
            comment: entity.comment ?? null,
            decidedAt: entity.decidedAt ?? new Date('2026-05-04T09:00:00.000Z'),
            decidedByMemberId: entity.decidedByMemberId ?? 'member-finance',
            id: entity.id ?? 'decision-1',
            returnToNodeId: entity.returnToNodeId ?? null,
            signatureId: entity.signatureId ?? null,
            taskId: entity.taskId ?? 'task-1',
            transferToMemberId: entity.transferToMemberId ?? null,
          }),
      ),
      // Saved decisions are not kept for reads here. The reassignment check on
      // the target sees none, and the COMPLETED-row case covers the refusal.
      find: jest.fn(() => Promise.resolve([])),
      save: jest.fn((entity: TaskDecisionEntity) => {
        savedDecision = entity;

        return Promise.resolve(entity);
      }),
    });
  const transactionalActivityRepository = createRepository<ActivityLogEntity>({
    create: jest.fn(
      (entity: Partial<ActivityLogEntity>): ActivityLogEntity =>
        Object.assign(new ActivityLogEntity(), {
          actorMemberId: entity.actorMemberId ?? null,
          createdAt: new Date('2026-05-04T09:00:00.000Z'),
          eventType:
            entity.eventType ??
            ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
          id: entity.id ?? 'activity-log',
          instanceId: entity.instanceId ?? 'instance-1',
          nodeId: entity.nodeId ?? null,
          payload: entity.payload ?? {},
          taskId: entity.taskId ?? null,
        }),
    ),
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly ActivityLogEntity[]> =>
        Promise.resolve(
          storedActivityLogs.filter((activityLog) =>
            matchesFindWhere(activityLog, options?.where),
          ),
        ),
    ),
    findOne: jest.fn(() => Promise.resolve(latestReturnActivity ?? null)),
    save: jest.fn(
      (
        entityOrEntities: ActivityLogEntity | ActivityLogEntity[],
      ): Promise<ActivityLogEntity | ActivityLogEntity[]> => {
        storedActivityLogs = [
          ...storedActivityLogs,
          ...(Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities]),
        ];

        if (Array.isArray(entityOrEntities)) {
          savedActivityLogs = [...entityOrEntities];

          return Promise.resolve(entityOrEntities);
        }

        savedProcessLog = entityOrEntities;
        savedSingleActivityLogs = [
          ...savedSingleActivityLogs,
          entityOrEntities,
        ];

        return Promise.resolve(entityOrEntities);
      },
    ),
  });
  const transactionalMembershipRepository = createRepository<MembershipEntity>({
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly MembershipEntity[]> =>
        Promise.resolve(
          processMemberships.filter((membership) =>
            matchesFindWhere(membership, options?.where),
          ),
        ),
    ),
  });
  const transactionalManagerResolutionRepository =
    createRepository<ManagerResolutionEntity>({
      find: jest.fn(
        (
          options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
        ): Promise<readonly ManagerResolutionEntity[]> =>
          Promise.resolve(
            processManagerResolutions.filter((resolution) =>
              matchesFindWhere(resolution, options?.where),
            ),
          ),
      ),
    });
  // Mirrors `orgUnit.path @> :path`: a unit sees only itself and its ancestors.
  const createOrgUnitQueryBuilder = (): OrgUnitQueryBuilderMock => {
    let path: string | null = null;
    const builder: OrgUnitQueryBuilderMock = {
      andWhere: jest.fn(
        (_condition: string, parameters?: { readonly path?: string }) => {
          path = parameters?.path ?? path;

          return builder;
        },
      ),
      getMany: jest.fn(() =>
        Promise.resolve(
          path === null
            ? processOrgUnits
            : processOrgUnits.filter(
                (orgUnit) =>
                  path === orgUnit.path ||
                  (path as string).startsWith(`${orgUnit.path}.`),
              ),
        ),
      ),
      where: jest.fn(() => builder),
    };

    return builder;
  };
  const transactionalOrgUnitRepository = createRepository<OrgUnitEntity>({
    createQueryBuilder: jest.fn(() => createOrgUnitQueryBuilder()),
    findOne: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<OrgUnitEntity | null> =>
        Promise.resolve(
          processOrgUnits.find((orgUnit) =>
            matchesFindWhere(orgUnit, options?.where),
          ) ?? null,
        ),
    ),
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly OrgUnitEntity[]> =>
        Promise.resolve(
          processOrgUnits.filter((orgUnit) =>
            matchesFindWhere(orgUnit, options?.where),
          ),
        ),
    ),
  });
  const transactionalPositionRepository = createRepository<PositionEntity>({
    findOne: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<PositionEntity | null> =>
        Promise.resolve(
          processPositions.find((position) =>
            matchesFindWhere(position, options?.where),
          ) ?? null,
        ),
    ),
    find: jest.fn(
      (
        options?: Readonly<{ where?: Readonly<Record<string, unknown>> }>,
      ): Promise<readonly PositionEntity[]> =>
        Promise.resolve(
          processPositions.filter((position) =>
            matchesFindWhere(position, options?.where),
          ),
        ),
    ),
  });
  const managerQuery = jest.fn<Promise<unknown>, [string, readonly unknown[]]>(
    () => Promise.resolve([]),
  );
  const transactionManager = {
    getRepository: jest.fn((target: unknown): unknown => {
      if (target === ApprovalInstanceEntity) {
        return transactionalInstanceRepository;
      }

      if (target === WorkflowTokenEntity) {
        return transactionalTokenRepository;
      }

      if (target === ActivityLogEntity) {
        return transactionalActivityRepository;
      }

      if (target === TaskEntity) {
        return transactionalTaskRepository;
      }

      if (target === TaskCandidateEntity) {
        return transactionalTaskCandidateRepository;
      }

      if (target === TaskDecisionEntity) {
        return transactionalTaskDecisionRepository;
      }

      if (target === NotificationEntity) {
        return notificationRepository;
      }

      if (target === MembershipEntity) {
        return transactionalMembershipRepository;
      }

      if (target === ManagerResolutionEntity) {
        return transactionalManagerResolutionRepository;
      }

      if (target === OrgUnitEntity) {
        return transactionalOrgUnitRepository;
      }

      if (target === PositionEntity) {
        return transactionalPositionRepository;
      }

      if (target === AdhocDirectiveEntity) {
        return transactionalAdhocDirectiveRepository;
      }

      return createRepository<ObjectLiteral>({});
    }),
    query: managerQuery,
  };
  const transaction = jest.fn(
    <TResult>(
      callback: (manager: typeof transactionManager) => Promise<TResult>,
    ) => callback(transactionManager),
  );
  Object.assign(instanceRepository, {
    manager: {
      connection: { driver: { escape: (name: string) => `"${name}"` } },
      getRepository: jest.fn((target: unknown): unknown => {
        if (target === MembershipEntity) {
          return transactionalMembershipRepository;
        }

        return createRepository<ObjectLiteral>({});
      }),
      transaction,
    },
  });

  return {
    managerQuery,
    notificationFind,
    orgUnitFindOne: transactionalOrgUnitRepository.findOne,
    positionFindOne: transactionalPositionRepository.findOne,
    rootInstanceCount,
    rootInstanceFind,
    rootInstanceFindOne,
    rootInstanceNodeLabelQuery,
    membershipFind: transactionalMembershipRepository.find,
    rootInstanceQueryBuilder,
    rootTaskFind,
    templateFind,
    templateFindOne,
    get savedAdhocDirectives(): readonly AdhocDirectiveEntity[] {
      return processAdhocDirectiveRows;
    },
    get savedDecision(): TaskDecisionEntity | null {
      return savedDecision;
    },
    get savedActivityLogs(): readonly ActivityLogEntity[] {
      return savedActivityLogs;
    },
    get savedInstance(): ApprovalInstanceEntity | null {
      return savedInstance;
    },
    get savedProcessLog(): ActivityLogEntity | null {
      return savedProcessLog;
    },
    get savedProcessToken(): WorkflowTokenEntity | null {
      return savedProcessToken;
    },
    get savedSingleActivityLogs(): readonly ActivityLogEntity[] {
      return savedSingleActivityLogs;
    },
    get savedTaskCandidates(): readonly TaskCandidateEntity[] {
      return savedTaskCandidates;
    },
    get savedTasks(): readonly TaskEntity[] {
      return savedTasks;
    },
    get savedWorkflowTokens(): readonly WorkflowTokenEntity[] {
      return processTokens;
    },
    get savedToken(): WorkflowTokenEntity | null {
      return savedToken;
    },
    taskCandidateFind,
    delegationService,
    service: new WorkflowEngineService(
      instanceRepository,
      tokenRepository,
      taskRepository,
      taskCandidateRepository,
      taskDecisionRepository,
      notificationRepository,
      activityLogRepository,
      adhocDirectiveRepository,
      templateRepository,
      templateVersionRepository,
      formVersionRepository,
      attachmentService as unknown as AttachmentService,
      new ConditionService(),
      delegationService as unknown as DelegationService,
      notificationService as unknown as NotificationService,
      signatureService as unknown as SignatureService,
      new BPMSlaScheduleService(new BPMWeekdayBusinessCalendar('UTC')),
      serviceTaskDispatcher,
      formDataSourceValueResolver,
      rootOptions,
      webhookDeliveryService,
    ),
    notificationService,
  };
}

/**
 * Applies a `find({ where })` clause the way the database would.
 *
 * A mock that ignores `where` answers questions it was never asked, and the
 * caller believes it. That is not hypothetical: the token repository's `find`
 * used to return consumed tokens to a query for WAITING ones, which hid an
 * end node completing a case twice — overwriting a committed REJECTED row
 * with APPROVED.
 *
 * `In` and `IsNull` are implemented for real because this service leans on
 * them for the inbox, history and open-task queries; treating those as
 * match-all would leave the very queries a user sees unguarded. Any other
 * operator stays match-all rather than being half-implemented.
 */
function matchesFindWhere<TEntity extends ObjectLiteral>(
  row: TEntity,
  where?: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => {
    if (value instanceof FindOperator) {
      if (value.type === 'in') {
        return (value.value as readonly unknown[]).includes(row[key]);
      }

      if (value.type === 'isNull') {
        return row[key] === null || row[key] === undefined;
      }

      return true;
    }

    return row[key] === value;
  });
}

function createRepository<TEntity extends ObjectLiteral>(
  value: Readonly<Record<string, unknown>>,
): jest.Mocked<Partial<import('typeorm').Repository<TEntity>>> &
  import('typeorm').Repository<TEntity> {
  return value as unknown as jest.Mocked<
    Partial<import('typeorm').Repository<TEntity>>
  > &
    import('typeorm').Repository<TEntity>;
}

function createApprovalInstanceQueryBuilderMock(
  rootInstanceFind: jest.Mock<
    Promise<readonly ApprovalInstanceEntity[]>,
    [Readonly<Record<string, unknown>>?]
  >,
  rootInstanceCount: jest.Mock<Promise<number>, []>,
): ApprovalInstanceQueryBuilderMock {
  const queryBuilder: ApprovalInstanceQueryBuilderMock = {
    andWhere: jest.fn<
      ApprovalInstanceQueryBuilderMock,
      [string, Readonly<Record<string, unknown>>?]
    >((): ApprovalInstanceQueryBuilderMock => queryBuilder),
    getCount: rootInstanceCount,
    getMany: jest.fn(() => rootInstanceFind()),
    orderBy: jest.fn<
      ApprovalInstanceQueryBuilderMock,
      [string, 'ASC' | 'DESC']
    >((): ApprovalInstanceQueryBuilderMock => queryBuilder),
    skip: jest.fn<ApprovalInstanceQueryBuilderMock, [number]>(
      (): ApprovalInstanceQueryBuilderMock => queryBuilder,
    ),
    take: jest.fn<ApprovalInstanceQueryBuilderMock, [number]>(
      (): ApprovalInstanceQueryBuilderMock => queryBuilder,
    ),
  };

  return queryBuilder;
}

function createTemplate(
  currentVersionId: string | null,
  isActive: boolean,
): ApprovalTemplateEntity {
  return {
    category: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    createdByMemberId: null,
    currentVersionId,
    deletedAt: null,
    description: null,
    id: 'template-1',
    isActive,
    name: '費用申請',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
  };
}

function createTemplateVersion(
  status: ApprovalTemplateVersionStatusEnum,
): ApprovalTemplateVersionEntity {
  return {
    archivedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formDefinitionVersionId: 'form-version-1',
    id: 'template-version-1',
    initiatorPolicyCel: null,
    notificationConfig: null,
    notificationConfigJson: null,
    publishedAt: new Date('2026-05-04T09:00:00.000Z'),
    publishedByMemberId: null,
    slaDefaults: null,
    slaDefaultsJson: null,
    status,
    templateId: 'template-1',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    version: 1,
    workflowDefinition: {
      edges: [
        {
          data: {},
          id: 'edge_start_end',
          source: 'start',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    },
    workflowDefinitionJson: '',
  };
}

function createFormVersion(
  status: FormDefinitionVersionStatusEnum,
  schema: FormDefinitionSchema = { fields: [], schemaVersion: 1 },
): FormDefinitionVersionEntity {
  return {
    archivedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formDefinitionId: 'form-1',
    id: 'form-version-1',
    publishedAt: new Date('2026-05-04T09:00:00.000Z'),
    publishedByMemberId: null,
    schema,
    schemaJson: '',
    status,
    uiSchema: {
      layout: [],
      schemaVersion: 1,
    },
    uiSchemaJson: '',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    version: 1,
  };
}

function createValueResolver(
  snapshots: FormDataSourceValueSnapshots,
): BPMFormDataSourceValueResolver {
  return {
    resolveFormDataOptionSnapshots: jest.fn(() =>
      Promise.resolve(snapshots),
    ),
    resolveFormFieldOptions: jest.fn(() =>
      Promise.resolve([] as readonly FormFieldOption[]),
    ),
  };
}

function createDynamicOptionFormSchema({
  dynamicFieldMode,
  dynamicFieldRequired = true,
}: {
  readonly dynamicFieldMode?: 'multiple' | 'single';
  readonly dynamicFieldRequired?: boolean;
} = {}): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'plant',
        label: 'Plant',
        required: true,
        type: 'text',
      },
      {
        dataSource: {
          bindings: [
            {
              from: { fieldKey: 'plant', kind: 'FIELD' },
              parameter: 'plant',
            },
          ],
          key: 'demo.cost-centers',
          version: 1,
        },
        fieldKey: 'costCenter',
        label: 'Cost center',
        ...(dynamicFieldMode ? { mode: dynamicFieldMode } : {}),
        required: dynamicFieldRequired,
        type: 'select',
      },
    ],
    schemaVersion: 1,
  };
}

function createRequiredReasonFormSchema(): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'reason',
        label: '事由',
        required: true,
        type: 'text',
      },
    ],
    schemaVersion: 1,
  };
}

function createTableColumns(): TableFieldDefinition['columns'] {
  return [
    { fieldKey: 'name', label: '品項', required: true, type: 'text' },
    { fieldKey: 'qty', label: '數量', required: true, type: 'number' },
    {
      fieldKey: 'tags',
      label: '標籤',
      mode: 'multiple',
      options: [{ label: 'A', value: 'a' }],
      required: false,
      type: 'select',
    },
  ];
}

function createTableFormSchema({
  hidden,
  maxRows,
  minRows,
  required = false,
}: {
  readonly hidden?: boolean;
  readonly maxRows?: number;
  readonly minRows?: number;
  readonly required?: boolean;
} = {}): FormDefinitionSchema {
  return {
    fields: [
      {
        columns: createTableColumns(),
        fieldKey: 'items',
        ...(typeof hidden === 'boolean' ? { hidden } : {}),
        label: '請購明細',
        ...(typeof maxRows === 'number' ? { maxRows } : {}),
        ...(typeof minRows === 'number' ? { minRows } : {}),
        required,
        type: 'table',
      },
    ],
    schemaVersion: 1,
  };
}

function createConditionalTableFormSchema(): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'needsItems',
        label: '需要明細',
        required: false,
        type: 'boolean',
      },
      {
        columns: createTableColumns(),
        fieldKey: 'items',
        label: '請購明細',
        required: true,
        type: 'table',
        visibleWhen: 'form.needsItems == true',
      },
    ],
    schemaVersion: 1,
  };
}

function createConditionalAttachmentFormSchema(): FormDefinitionSchema {
  return {
    fields: [
      {
        fieldKey: 'needsAttachment',
        label: '需要附件',
        required: false,
        type: 'boolean',
      },
      {
        fieldKey: 'attachments',
        label: '附件',
        required: false,
        requiredWhen: 'form.needsAttachment == true',
        type: 'file_upload',
      },
    ],
    schemaVersion: 1,
  };
}

function createApprovalInstance({
  businessKey,
  formDataOptionSnapshot,
  formDefinitionSnapshot,
  formData,
  id,
  initiatorMemberId,
  state,
  submittedByMemberId,
  title,
  updatedAt,
  workflowSnapshot,
}: {
  readonly businessKey?: string;
  readonly formDataOptionSnapshot?: FormDataSourceValueSnapshots;
  readonly formDefinitionSnapshot?: Readonly<Record<string, unknown>>;
  readonly formData?: Readonly<Record<string, unknown>>;
  readonly id?: string;
  readonly initiatorMemberId?: string;
  readonly state?: ApprovalInstanceStateEnum;
  readonly submittedByMemberId?: string | null;
  readonly title?: string;
  readonly updatedAt?: Date;
  readonly workflowSnapshot?: WorkflowDefinition;
} = {}): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    businessKey: businessKey ?? null,
    completedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formData: formData ?? {},
    formDataOptionSnapshot: formDataOptionSnapshot ?? {},
    formDefinitionSnapshot: formDefinitionSnapshot ?? {
      schema: {
        fields: [],
        schemaVersion: 1,
      },
    },
    id: id ?? 'instance-1',
    initiatorMemberId: initiatorMemberId ?? 'member-001',
    initiatorMetadataSnapshot: {},
    startedAt: new Date('2026-05-04T09:00:00.000Z'),
    state: state ?? ApprovalInstanceStateEnum.RUNNING,
    submittedByMemberId: submittedByMemberId ?? null,
    templateId: 'template-1',
    templateVersionId: 'template-version-1',
    title: title ?? '費用申請',
    updatedAt: updatedAt ?? new Date('2026-05-04T09:00:00.000Z'),
    workflowSnapshot: workflowSnapshot ?? {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    },
  });
}

function createActivityLog(
  value: Partial<ActivityLogEntity>,
): ActivityLogEntity {
  return Object.assign(new ActivityLogEntity(), {
    actorMemberId: value.actorMemberId ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    eventType:
      value.eventType ?? ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
    id: value.id ?? 'activity-log',
    instanceId: value.instanceId ?? 'instance-1',
    nodeId: value.nodeId ?? null,
    payload: value.payload ?? {},
    taskId: value.taskId ?? null,
  });
}

function compareTokenCreatedAt(
  left: WorkflowTokenEntity,
  right: WorkflowTokenEntity,
): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function createWorkflowToken(
  value: Partial<WorkflowTokenEntity>,
): WorkflowTokenEntity {
  return {
    consumedAt: value.consumedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    currentNodeId: value.currentNodeId ?? 'start',
    id: value.id ?? 'token-1',
    instanceId: value.instanceId ?? 'instance-1',
    parentTokenId: value.parentTokenId ?? null,
    status: value.status ?? WorkflowTokenStatusEnum.ACTIVE,
  };
}

/**
 * A RETURN_TO_ORIGIN pre-approval (task-90) whose pointer was left on task-1
 * after task-1 was transferred — what a release that did not re-point open
 * pre-approvals on transfer leaves behind.
 */
function createStalePreApprovalOriginFixture({
  processActivityLogs,
  replacementTasks,
}: {
  readonly processActivityLogs: readonly ActivityLogEntity[];
  readonly replacementTasks: readonly TaskEntity[];
}): ReturnType<typeof createServiceFixture> {
  return createServiceFixture({
    additionalProcessTasks: [
      ...replacementTasks,
      createTask({
        adhocDirectiveId: 'directive-seed-1',
        adhocOriginTaskId: 'task-1',
        adhocType: AdhocDirectiveTypeEnum.PRE_APPROVAL,
        assigneeMemberId: 'member-d',
        id: 'task-90',
        isAdhoc: true,
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-d',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
    ],
    currentVersionId: 'template-version-1',
    decisionTask: createTask({
      assigneeMemberId: 'member-finance',
      completedAt: new Date('2026-05-04T09:10:00.000Z'),
      nodeId: 'task_finance',
      originalAssigneeMemberId: 'member-finance',
      status: TaskStatusEnum.TRANSFERRED,
      tokenId: 'token-1',
    }),
    decisionToken: createWorkflowToken({
      currentNodeId: 'task_finance',
      status: WorkflowTokenStatusEnum.WAITING,
    }),
    formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
    processActivityLogs,
    processAdhocDirectives: [
      createAdhocDirective({
        consumedAt: new Date('2026-05-04T09:00:00.000Z'),
        id: 'directive-seed-1',
        onReject: AdhocPreApprovalRejectBehaviorEnum.RETURN_TO_ORIGIN,
        status: AdhocDirectiveStatusEnum.CONSUMED,
        type: AdhocDirectiveTypeEnum.PRE_APPROVAL,
      }),
    ],
    processWorkflowSnapshot: createLinearUserTaskWorkflow({
      allowAddSigner: true,
    }),
    templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
  });
}

function createTransferTaskCreatedLog(
  transferredFromTaskId: string,
  taskId: string,
): ActivityLogEntity {
  return createActivityLog({
    eventType: ActivityLogEventTypeEnum.TASK_CREATED,
    id: `activity-log-${taskId}`,
    nodeId: 'task_finance',
    payload: { transferredFromTaskId },
    taskId,
  });
}

function createTaskCandidate(
  value: Partial<TaskCandidateEntity>,
): TaskCandidateEntity {
  return Object.assign(new TaskCandidateEntity(), {
    claimedAt: value.claimedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    decidedAt: value.decidedAt ?? null,
    delegationChain: value.delegationChain ?? [],
    id: value.id ?? 'task-candidate-seed-1',
    memberId: value.memberId ?? 'member-finance',
    originalMemberId: value.originalMemberId ?? value.memberId ?? 'member-finance',
    sequence: value.sequence ?? null,
    sourceType: value.sourceType ?? 'DIRECT',
    status: value.status ?? TaskCandidateStatusEnum.PENDING,
    taskId: value.taskId ?? 'task-1',
  });
}

function createTask(value: Partial<TaskEntity>): TaskEntity {
  return Object.assign(new TaskEntity(), {
    adhocDirectiveId: value.adhocDirectiveId ?? null,
    adhocOriginTaskId: value.adhocOriginTaskId ?? null,
    adhocType: value.adhocType ?? null,
    assigneeMemberId:
      value.assigneeMemberId === null
        ? null
        : (value.assigneeMemberId ?? 'member-finance'),
    assignmentType:
      value.assignmentType ?? TaskAssignmentTypeEnum.DIRECT_MEMBER,
    candidateMemberIds: value.candidateMemberIds ?? [],
    decisionPolicySnapshot: value.decisionPolicySnapshot ?? { type: 'SINGLE' },
    completedAt: value.completedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    delegationChain: value.delegationChain ?? [],
    id: value.id ?? 'task-1',
    instanceId: value.instanceId ?? 'instance-1',
    isAdhoc: value.isAdhoc ?? false,
    nodeId: value.nodeId ?? 'task_finance',
    openedAt: value.openedAt ?? null,
    originalAssigneeMemberId:
      value.originalAssigneeMemberId === null
        ? null
        : (value.originalAssigneeMemberId ?? 'member-finance'),
    slaDueAt: value.slaDueAt ?? null,
    slaStartedAt: value.slaStartedAt ?? null,
    status: value.status ?? TaskStatusEnum.PENDING,
    tokenId: value.tokenId ?? 'token-1',
  });
}

function createAdhocDirective(
  value: Partial<AdhocDirectiveEntity>,
): AdhocDirectiveEntity {
  return Object.assign(new AdhocDirectiveEntity(), {
    channels: value.channels ?? null,
    comment: value.comment ?? null,
    consumedAt: value.consumedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    createdByMemberId: value.createdByMemberId ?? 'member-finance',
    id: value.id ?? 'directive-seed-1',
    instanceId: value.instanceId ?? 'instance-1',
    onReject: value.onReject ?? null,
    originNodeId: value.originNodeId ?? 'task_finance',
    originTaskId: value.originTaskId ?? 'task-1',
    status: value.status ?? AdhocDirectiveStatusEnum.PENDING,
    targetKind: value.targetKind ?? AdhocTargetKindEnum.MEMBER,
    targetValue: value.targetValue ?? {
      kind: AdhocTargetKindEnum.MEMBER,
      memberIds: ['member-d'],
    },
    type: value.type ?? AdhocDirectiveTypeEnum.COUNTERSIGN,
  });
}

function createAuthContext(memberId: string): BPMAuthContext {
  return {
    memberId,
    metadata: {},
    permissions: ['instance.read'],
    roles: ['REQUESTER'],
  };
}

function createMembership(value: Partial<MembershipEntity>): MembershipEntity {
  return Object.assign(new MembershipEntity(), {
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    effectiveFrom: value.effectiveFrom ?? '2026-01-01',
    effectiveTo: value.effectiveTo ?? null,
    id: value.id ?? 'membership-1',
    isPrimary: value.isPrimary ?? false,
    memberId: value.memberId ?? 'member-001',
    orgUnitId: value.orgUnitId ?? 'org-finance',
    positionId: value.positionId ?? null,
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
  });
}

function createManagerResolution(
  value: Partial<ManagerResolutionEntity>,
): ManagerResolutionEntity {
  return Object.assign(new ManagerResolutionEntity(), {
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    effectiveFrom: value.effectiveFrom ?? '2026-01-01',
    effectiveTo: value.effectiveTo ?? null,
    id: value.id ?? 'manager-resolution-1',
    managerMemberId: value.managerMemberId ?? 'member-manager',
    priority: value.priority ?? 0,
    scopeId: value.scopeId ?? 'org-finance',
    scopeType: value.scopeType ?? ManagerResolutionScopeTypeEnum.ORG_UNIT,
  });
}

function createOrgUnit(value: Partial<OrgUnitEntity>): OrgUnitEntity {
  return Object.assign(new OrgUnitEntity(), {
    code: value.code ?? 'FIN',
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    deletedAt: value.deletedAt ?? null,
    id: value.id ?? 'org-finance',
    metadata: value.metadata ?? {},
    name: value.name ?? '財務部',
    parentId: value.parentId ?? null,
    path: value.path ?? 'org.finance',
    type: value.type ?? OrgUnitTypeEnum.DEPARTMENT,
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
  });
}

// Overlays raw node data, for shapes the typed builders refuse (a persisted
// `null`, a legacy node missing a field).
function withNodeData(
  workflow: WorkflowDefinition,
  nodeId: string,
  patch: Readonly<Record<string, unknown>>,
): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
    ),
  } as WorkflowDefinition;
}

function createPosition(value: Partial<PositionEntity>): PositionEntity {
  return Object.assign(new PositionEntity(), {
    code: value.code ?? `position-${value.level ?? 1}`,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    id: value.id ?? `position-${value.level ?? 1}`,
    level: value.level ?? 1,
    metadata: {},
    name: value.name ?? `職等 ${value.level ?? 1}`,
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
  });
}

/**
 * Builds the org data for an ORG_MANAGER_CHAIN walk: one MEMBER-scope manager
 * rule per `[member, manager]` link, plus one position membership per graded
 * member. A `null` grade means the member has no position at all.
 */
function createManagerChainOrg({
  extraMemberships = [],
  extraPositionLevels = [],
  grades,
  links,
}: {
  readonly extraMemberships?: readonly MembershipEntity[];
  readonly extraPositionLevels?: readonly number[];
  readonly grades: Readonly<Record<string, number | null>>;
  readonly links: readonly (readonly [string, string])[];
}): Pick<
  Parameters<typeof createServiceFixture>[0],
  | 'processManagerResolutions'
  | 'processMemberships'
  | 'processOrgUnits'
  | 'processPositions'
> {
  const gradedMembers = Object.entries(grades);

  return {
    processManagerResolutions: links.map(([memberId, managerMemberId]) =>
      createManagerResolution({
        id: `manager-resolution-${memberId}-${managerMemberId}`,
        managerMemberId,
        scopeId: memberId,
        scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
      }),
    ),
    processMemberships: [
      ...gradedMembers.map(([memberId, level]) =>
        createMembership({
          id: `membership-${memberId}`,
          memberId,
          orgUnitId: 'org-finance',
          positionId: level === null ? null : `position-${level}`,
        }),
      ),
      ...extraMemberships,
    ],
    processOrgUnits: [createOrgUnit({ id: 'org-finance' })],
    processPositions: [
      ...new Set([
        ...Object.values(grades).filter(
          (level): level is number => level !== null,
        ),
        ...extraPositionLevels,
      ]),
    ].map((level) => createPosition({ level })),
  };
}

function createLinearUserTaskWorkflow({
  allowAddSigner = false,
  allowReject = true,
  allowTransfer = true,
  approverResolver = {
    memberIds: ['member-finance'],
    type: 'DIRECT',
  },
  decisionPolicy = { type: 'SINGLE' },
  excludeInitiator,
  returnBehavior = {
    allowReturn: false,
    allowedTargets: 'PREVIOUS',
  },
  slaDuration = null,
}: {
  readonly allowAddSigner?: boolean;
  readonly allowReject?: boolean;
  readonly allowTransfer?: boolean;
  readonly approverResolver?: ApproverResolver;
  readonly decisionPolicy?: DecisionPolicy;
  readonly excludeInitiator?: ExcludeInitiatorConfig;
  readonly returnBehavior?: ReturnBehavior;
  readonly slaDuration?: string | null;
} = {}): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task_finance',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_end',
        source: 'task_finance',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          allowAddSigner,
          allowReject,
          allowTransfer,
          approverResolver,
          decisionPolicy,
          label: '財務簽核',
          returnBehavior,
          ...(excludeInitiator ? { excludeInitiator } : {}),
          ...(slaDuration
            ? {
                sla: {
                  duration: slaDuration,
                  onTimeout: 'REMIND' as const,
                  warningAt: 0.5,
                },
              }
            : {}),
        },
        id: 'task_finance',
        position: { x: 300, y: 160 },
        type: 'userTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

// start -> task_finance (initiator-only approver, excludeInitiator) ->
// task_next -> end, to observe what the next node does after a skip.
function createExcludeInitiatorTwoStepWorkflow(
  excludeInitiator: ExcludeInitiatorConfig,
  firstApproverMemberId = 'member-001',
): WorkflowDefinition {
  const linear = createLinearUserTaskWorkflow({
    approverResolver: { memberIds: [firstApproverMemberId], type: 'DIRECT' },
    excludeInitiator,
  });

  return {
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task_finance',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_next',
        source: 'task_finance',
        target: 'task_next',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_next_end',
        source: 'task_next',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: linear.meta,
    nodes: [
      ...linear.nodes.filter((node) => node.id !== 'end'),
      createUserTaskNode('task_next', '下一關', 'member-next', 520, 160),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 740, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createRejectingEndEventWorkflow(): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_end',
        source: 'start',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { endState: 'REJECTED', label: '否決' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createNotifyServiceTaskWorkflow(
  actionOverride: Partial<
    Extract<ServiceAction, { readonly type: 'NOTIFY' }>
  > = {},
): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_notify',
        source: 'start',
        target: 'notify_finance',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: {
              memberIds: ['member-finance', 'member-admin'],
              type: 'DIRECT',
            },
            template: '請留意案件 {{instanceTitle}}。',
            type: 'NOTIFY',
            ...actionOverride,
          },
          label: '財務知會',
        },
        id: 'notify_finance',
        position: { x: 300, y: 160 },
        type: 'serviceTask',
      },
    ],
  };
}

function createEntryConditionNotifyWorkflow({
  withApprovalBranch = false,
}: {
  readonly withApprovalBranch?: boolean;
} = {}): WorkflowDefinition {
  const base = createNotifyServiceTaskWorkflow();
  const notifyNode = base.nodes.find((node) => node.id === 'notify_finance');

  if (notifyNode?.type !== 'serviceTask') {
    throw new Error('notify_finance fixture node was not found');
  }

  const conditionedNotifyNode = {
    ...notifyNode,
    data: { ...notifyNode.data, entryCondition: 'form.amount > 1000' },
  };
  const edge = (
    id: string,
    source: string,
    target: string,
  ): WorkflowDefinition['edges'][number] => ({
    data: {},
    id,
    source,
    target,
    type: 'smoothstep',
  });
  const endNode: WorkflowDefinition['nodes'][number] = {
    data: { endState: 'APPROVED', label: '完成' },
    id: 'end',
    position: { x: 520, y: 80 },
    type: 'endEvent',
  };
  const startNode = base.nodes.find((node) => node.id === 'start');

  if (!startNode) {
    throw new Error('start fixture node was not found');
  }

  return {
    edges: [
      edge('edge_start_notify', 'start', 'notify_finance'),
      ...(withApprovalBranch
        ? [
            edge('edge_start_a', 'start', 'task_a'),
            edge('edge_a_end', 'task_a', 'end'),
          ]
        : []),
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      startNode,
      conditionedNotifyNode,
      ...(withApprovalBranch
        ? [
            createUserTaskNode('task_a', 'A 簽核', 'member-a', 300, 80),
            endNode,
          ]
        : []),
    ],
  };
}

// start -> parallel split -> { skipped NOTIFY (terminal), task_a, task_b },
// with task_a and task_b joining at task_final. The NOTIFY has no outgoing
// edge, so it can never feed the join.
function createSplitWithSkippedNotifyWorkflow(): WorkflowDefinition {
  const notify = createEntryConditionNotifyWorkflow().nodes.find(
    (node) => node.id === 'notify_finance',
  );

  if (!notify) {
    throw new Error('notify_finance fixture node was not found');
  }

  const edge = (
    id: string,
    source: string,
    target: string,
  ): WorkflowDefinition['edges'][number] => ({
    data: {},
    id,
    source,
    target,
    type: 'smoothstep',
  });

  return {
    edges: [
      edge('edge_start_split', 'start', 'split'),
      edge('edge_split_notify', 'split', 'notify_finance'),
      edge('edge_split_a', 'split', 'task_a'),
      edge('edge_split_b', 'split', 'task_b'),
      edge('edge_a_final', 'task_a', 'task_final'),
      edge('edge_b_final', 'task_b', 'task_final'),
      edge('edge_final_end', 'task_final', 'end'),
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 0, y: 160 },
        type: 'startEvent',
      },
      {
        data: { direction: 'split', label: '分流' },
        id: 'split',
        position: { x: 160, y: 160 },
        type: 'parallelGateway',
      },
      notify,
      createUserTaskNode('task_a', 'A 簽核', 'member-a', 300, 80),
      createUserTaskNode('task_b', 'B 簽核', 'member-b', 300, 240),
      createUserTaskNode('task_final', '彙整簽核', 'member-final', 520, 160),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 740, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createEntryConditionWebhookWorkflow(): WorkflowDefinition {
  const base = createWebhookServiceTaskWorkflow();

  return {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === 'webhook_erp' && node.type === 'serviceTask'
        ? {
            ...node,
            data: { ...node.data, entryCondition: 'form.amount > 1000' },
          }
        : node,
    ),
  };
}

function createWebhookServiceTaskWorkflow(): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_webhook',
        source: 'start',
        target: 'webhook_erp',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_webhook_end',
        source: 'webhook_erp',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          action: {
            payload: '{ title: instance.title, amount: form.amount }',
            type: 'WEBHOOK',
            url: 'https://example.test/workflow-hook',
          },
          label: '同步 ERP',
        },
        id: 'webhook_erp',
        position: { x: 300, y: 160 },
        type: 'serviceTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createSetFormFieldServiceTaskWorkflow({
  fieldPath = 'form.approvalLevel',
  value = '"主管簽核"',
}: {
  readonly fieldPath?: string;
  readonly value?: string;
} = {}): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_set_field',
        source: 'start',
        target: 'set_approval_level',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_set_field_end',
        source: 'set_approval_level',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          action: {
            fieldPath,
            type: 'SET_FORM_FIELD',
            value,
          },
          label: '設定簽核層級',
        },
        id: 'set_approval_level',
        position: { x: 300, y: 160 },
        type: 'serviceTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createExclusiveGatewayWorkflow({
  highCondition = 'form.amount > 1000',
  includeStructuredCondition = true,
  structuredCondition = {
    conditionFieldKey: 'amount',
    conditionOperator: 'GREATER_THAN',
    conditionValue: '1000',
  },
}: {
  readonly highCondition?: string;
  readonly includeStructuredCondition?: boolean;
  readonly structuredCondition?: Readonly<{
    conditionFieldKey: string;
    conditionOperator: WorkflowEdgeConditionOperator;
    conditionValue?: string;
  }>;
} = {}): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_gateway',
        source: 'start',
        target: 'gateway_amount',
        type: 'smoothstep',
      },
      {
        data: {
          condition: highCondition,
          ...(includeStructuredCondition ? structuredCondition : {}),
          label: '金額大於 1000',
        },
        id: 'edge_gateway_high',
        source: 'gateway_amount',
        target: 'task_high',
        type: 'smoothstep',
      },
      {
        data: { isDefault: true, label: '其他情況' },
        id: 'edge_gateway_default',
        source: 'gateway_amount',
        target: 'task_default',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_high_end',
        source: 'task_high',
        target: 'end',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_default_end',
        source: 'task_default',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { direction: 'split', label: '金額分流', triggerMode: 'AND' },
        id: 'gateway_amount',
        position: { x: 260, y: 160 },
        type: 'exclusiveGateway',
      },
      createUserTaskNode('task_high', '高額簽核', 'member-high', 440, 80),
      createUserTaskNode(
        'task_default',
        '一般簽核',
        'member-default',
        440,
        240,
      ),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 660, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createParallelApprovalWorkflow(
  finalTriggerMode: 'AND' | 'OR',
): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_a',
        source: 'start',
        target: 'task_a',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_start_b',
        source: 'start',
        target: 'task_b',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_a_final',
        source: 'task_a',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_b_final',
        source: 'task_b',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_final_end',
        source: 'task_final',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      createUserTaskNode('task_a', 'A 簽核', 'member-a', 300, 80),
      createUserTaskNode('task_b', 'B 簽核', 'member-b', 300, 240),
      createUserTaskNode(
        'task_final',
        '彙整簽核',
        'member-final',
        520,
        160,
        finalTriggerMode,
      ),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 740, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createUserTaskNode(
  id: string,
  label: string,
  memberId: string,
  x: number,
  y: number,
  triggerMode: 'AND' | 'OR' = 'AND',
): WorkflowDefinition['nodes'][number] {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: {
        memberIds: [memberId],
        type: 'DIRECT',
      },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior: {
        allowReturn: false,
        allowedTargets: 'PREVIOUS',
      },
      triggerMode,
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function readTaskByNodeId(
  tasks: readonly TaskEntity[],
  nodeId: string,
): TaskEntity {
  const task = tasks.find((candidate) => candidate.nodeId === nodeId);

  if (!task) {
    throw new Error(`Task for node ${nodeId} was not found`);
  }

  return task;
}

function createSequentialDecisionFixture({
  activeIndex = 0,
  additionalProcessTasks,
  approverResolver,
  candidateOverrides = {},
  excludeInitiator,
  processAdhocDirectives,
  submittedByMemberId,
  processMemberships,
  processPositions,
}: {
  readonly activeIndex?: number;
  readonly additionalProcessTasks?: readonly TaskEntity[];
  readonly approverResolver?: ApproverResolver;
  readonly candidateOverrides?: Readonly<
    Record<string, Partial<TaskCandidateEntity>>
  >;
  readonly excludeInitiator?: ExcludeInitiatorConfig;
  readonly processAdhocDirectives?: readonly AdhocDirectiveEntity[];
  readonly submittedByMemberId?: string | null;
  readonly processMemberships?: readonly MembershipEntity[];
  readonly processPositions?: readonly PositionEntity[];
} = {}): ServiceFixture {
  const memberIds = ['member-a', 'member-b', 'member-c'];

  return createServiceFixture({
    additionalProcessTasks,
    currentVersionId: 'template-version-1',
    decisionTask: createTask({
      assigneeMemberId: memberIds[activeIndex],
      assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
      candidateMemberIds: memberIds,
      decisionPolicySnapshot: { type: 'SEQUENTIAL' },
      id: 'task-seq',
      nodeId: 'task_finance',
      originalAssigneeMemberId: memberIds[activeIndex],
      slaDueAt: new Date('2026-05-04T11:00:00.000Z'),
      status: TaskStatusEnum.PENDING,
      tokenId: 'token-1',
    }),
    decisionToken: createWorkflowToken({
      currentNodeId: 'task_finance',
      status: WorkflowTokenStatusEnum.WAITING,
    }),
    formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
    processAdhocDirectives,
    processMemberships,
    processPositions,
    processTaskCandidates: memberIds.map((memberId, index) =>
      createTaskCandidate({
        id: `candidate-${memberId.slice(-1)}`,
        memberId,
        sequence: index,
        sourceType: approverResolver?.type,
        ...candidateOverrides[memberId],
        status:
          index < activeIndex
            ? TaskCandidateStatusEnum.COMPLETED
            : index === activeIndex
              ? TaskCandidateStatusEnum.PENDING
              : TaskCandidateStatusEnum.WAITING,
        taskId: 'task-seq',
      }),
    ),
    processWorkflowSnapshot: createLinearUserTaskWorkflow({
      approverResolver,
      decisionPolicy: { type: 'SEQUENTIAL' },
      excludeInitiator,
      returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
      slaDuration: 'PT2H',
    }),
    submittedByMemberId,
    templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
  });
}

/** A SEQUENTIAL task from before candidates were ordered (no sequence). */
function createLegacySequentialFixture({
  additionalProcessTasks,
  processAdhocDirectives,
}: {
  readonly additionalProcessTasks?: readonly TaskEntity[];
  readonly processAdhocDirectives?: readonly AdhocDirectiveEntity[];
} = {}): ServiceFixture {
  return createServiceFixture({
    additionalProcessTasks,
    currentVersionId: 'template-version-1',
    decisionTask: createTask({
      assigneeMemberId: null,
      assignmentType: TaskAssignmentTypeEnum.CANDIDATE_GROUP,
      decisionPolicySnapshot: { type: 'SEQUENTIAL' },
      id: 'task-legacy',
      nodeId: 'task_finance',
      originalAssigneeMemberId: null,
      status: TaskStatusEnum.PENDING,
      tokenId: 'token-1',
    }),
    decisionToken: createWorkflowToken({
      currentNodeId: 'task_finance',
      status: WorkflowTokenStatusEnum.WAITING,
    }),
    formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
    processAdhocDirectives,
    processTaskCandidates: [
      createTaskCandidate({
        id: 'candidate-a',
        memberId: 'member-a',
        taskId: 'task-legacy',
      }),
      createTaskCandidate({
        id: 'candidate-b',
        memberId: 'member-b',
        taskId: 'task-legacy',
      }),
    ],
    processWorkflowSnapshot: createLinearUserTaskWorkflow({
      decisionPolicy: { type: 'SEQUENTIAL' },
    }),
    templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
  });
}

/** Last write per row wins, in the order each row first appeared. */
function readLatestRows<TRow extends { readonly id: string }>(
  rows: readonly TRow[],
): readonly TRow[] {
  return [
    ...new Map(rows.map((row): [string, TRow] => [row.id, row])).values(),
  ];
}

function readLatestTask(
  fixture: ServiceFixture,
  taskId: string,
): TaskEntity | undefined {
  return readLatestRows(fixture.savedTasks).find((task) => task.id === taskId);
}

function readTaskAssignedTo(
  fixture: ServiceFixture,
  memberId: string,
): TaskEntity {
  const task = readLatestRows(fixture.savedTasks).find(
    (candidate) =>
      candidate.assigneeMemberId === memberId &&
      candidate.status === TaskStatusEnum.PENDING,
  );

  if (!task) {
    throw new Error(`No pending task is assigned to ${memberId}`);
  }

  return task;
}

function readLatestCandidates(
  fixture: ServiceFixture,
  taskId: string,
): readonly TaskCandidateEntity[] {
  return readLatestRows(
    fixture.savedTaskCandidates.filter(
      (candidate) => candidate.taskId === taskId,
    ),
  );
}

function readLatestCandidateStatuses(
  fixture: ServiceFixture,
  taskId: string,
): Readonly<Record<string, TaskCandidateStatusEnum>> {
  return Object.fromEntries(
    readLatestCandidates(fixture, taskId).map((candidate) => [
      candidate.memberId,
      candidate.status,
    ]),
  );
}

/**
 * The root task query is a plain stub; this makes it answer from the rows the
 * engine has written, `where` clause included, so an inbox assertion is about
 * what the engine saved and not about what the test hard-coded.
 */
function answerTaskQueriesFromSavedTasks(fixture: ServiceFixture): void {
  fixture.rootTaskFind.mockImplementation((options) => {
    const where = options.where as
      | Readonly<Record<string, unknown>>
      | readonly Readonly<Record<string, unknown>>[];
    const clauses = Array.isArray(where) ? where : [where];

    return Promise.resolve(
      readLatestRows(fixture.savedTasks).filter((task) =>
        clauses.some((clause) => matchesFindWhere(task, clause)),
      ),
    );
  });
}
