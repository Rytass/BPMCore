import {
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldOption,
} from '@rytass/bpm-core-shared/form';
import {
  ApproverResolver,
  ReturnBehavior,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { ObjectLiteral } from 'typeorm';
import { BPMAuthContext } from '../bpm-auth';
import { AttachmentService } from '../attachment/attachment.service';
import { BPMSlaScheduleService } from '../calendar/sla-schedule.service';
import { BPMWeekdayBusinessCalendar } from '../calendar/weekday-business-calendar';
import { ConditionService } from '../condition/condition.service';
import {
  DelegationResolution,
  DelegationService,
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
  TaskAssignmentTypeEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { WorkflowEngineService } from './workflow-engine.service';
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

    expect(instance.state).toBe(ApprovalInstanceStateEnum.RUNNING);
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
});

interface ServiceFixture {
  readonly managerQuery: jest.Mock<
    Promise<unknown>,
    [string, readonly unknown[]]
  >;
  readonly notificationService: Pick<
    NotificationService,
    | 'createAdhocWorkflowNotifications'
    | 'createInstanceCompletedNotification'
    | 'createServiceTaskNotifications'
    | 'createTaskAssignedNotification'
    | 'resolveTaskNotifications'
    | 'supersedeInstanceTaskNotifications'
  >;
  readonly notificationFind: jest.Mock<
    Promise<readonly NotificationEntity[]>,
    [Readonly<Record<string, unknown>>]
  >;
  readonly rootInstanceCount: jest.Mock<Promise<number>, []>;
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

function createServiceFixture({
  additionalProcessTasks = [],
  currentVersionId,
  delegationResolution,
  decisionTask,
  decisionToken,
  formDataSourceValueResolver,
  formSchema,
  formVersionStatus,
  instanceState,
  latestReturnActivity,
  processAdhocDirectives = [],
  processFormData,
  processFormDefinitionSnapshot,
  processManagerResolutions = [],
  processMemberships = [],
  processNotifications = [],
  processOrgUnits = [],
  processWorkflowSnapshot,
  rootInstanceUpdatedAt,
  serviceTaskDispatcher,
  templateIsActive = true,
  templateVersionStatus,
  transactionalInstanceUpdatedAt,
}: {
  readonly additionalProcessTasks?: readonly TaskEntity[];
  readonly currentVersionId: string | null;
  readonly delegationResolution?: DelegationResolution;
  readonly decisionTask?: TaskEntity;
  readonly decisionToken?: WorkflowTokenEntity;
  readonly formSchema?: FormDefinitionSchema;
  readonly formVersionStatus: FormDefinitionVersionStatusEnum;
  readonly instanceState?: ApprovalInstanceStateEnum;
  readonly latestReturnActivity?: ActivityLogEntity | null;
  readonly processAdhocDirectives?: readonly AdhocDirectiveEntity[];
  readonly processFormData?: Readonly<Record<string, unknown>>;
  readonly processFormDefinitionSnapshot?: Readonly<Record<string, unknown>>;
  readonly processManagerResolutions?: readonly ManagerResolutionEntity[];
  readonly processMemberships?: readonly MembershipEntity[];
  readonly processNotifications?: readonly NotificationEntity[];
  readonly processOrgUnits?: readonly OrgUnitEntity[];
  readonly processWorkflowSnapshot?: WorkflowDefinition;
  readonly rootInstanceUpdatedAt?: Date;
  readonly serviceTaskDispatcher?: BPMWorkflowServiceTaskDispatcher;
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
  let savedTasks: readonly TaskEntity[] = [];
  let savedTaskCandidates: readonly TaskCandidateEntity[] = [];
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
  const instanceRepository = createRepository<ApprovalInstanceEntity>({
    createQueryBuilder: jest.fn(() => rootInstanceQueryBuilder),
    find: rootInstanceFind,
    findOne: jest.fn(() =>
      Promise.resolve(
        createApprovalInstance({
          formData: processFormData,
          formDefinitionSnapshot: processFormDefinitionSnapshot,
          state: instanceState,
          updatedAt: rootInstanceUpdatedAt,
          workflowSnapshot: processWorkflowSnapshot,
        }),
      ),
    ),
  });
  const tokenRepository = createRepository<WorkflowTokenEntity>({});
  const taskRepository = createRepository<TaskEntity>({
    find: rootTaskFind,
  });
  const taskCandidateRepository = createRepository<TaskCandidateEntity>({
    find: jest.fn(() => Promise.resolve([])),
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
    find: jest.fn(() => Promise.resolve(processAdhocDirectiveRows)),
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
              Object.entries(options?.where ?? {}).every(
                ([key, value]) =>
                  // FindOperator values (e.g. In([...])) are treated as
                  // match-all to keep the mock simple.
                  typeof value === 'object' ||
                  directive[key as keyof AdhocDirectiveEntity] === value,
              ),
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
  const templateRepository = createRepository<ApprovalTemplateEntity>({
    findOne: jest.fn(() => Promise.resolve(template)),
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
          savedInstance ??
            createApprovalInstance({
              formData: processFormData,
              formDefinitionSnapshot: processFormDefinitionSnapshot,
              state: instanceState,
              updatedAt: transactionalInstanceUpdatedAt,
              workflowSnapshot: processWorkflowSnapshot,
            }),
        ),
      ),
      save: jest.fn((entity: ApprovalInstanceEntity) => {
        savedInstance = Object.assign(createApprovalInstance(), entity);

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
    find: jest.fn(() =>
      Promise.resolve([...processTokens].sort(compareTokenCreatedAt)),
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
    find: jest.fn(() => Promise.resolve(processTasks)),
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
            id: entity.id ?? 'task-candidate-1',
            memberId: entity.memberId ?? 'member-finance',
            originalMemberId: entity.originalMemberId ?? 'member-finance',
            sourceType: entity.sourceType ?? 'DIRECT',
            status: entity.status ?? TaskCandidateStatusEnum.PENDING,
            taskId: entity.taskId ?? 'task-1',
          }),
      ),
      find: jest.fn(() => Promise.resolve([])),
      save: jest.fn(
        (
          entityOrEntities: TaskCandidateEntity | TaskCandidateEntity[],
        ): Promise<TaskCandidateEntity | TaskCandidateEntity[]> => {
          savedTaskCandidates = [
            ...savedTaskCandidates,
            ...(Array.isArray(entityOrEntities)
              ? entityOrEntities
              : [entityOrEntities]),
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
    findOne: jest.fn(() => Promise.resolve(latestReturnActivity ?? null)),
    save: jest.fn(
      (
        entityOrEntities: ActivityLogEntity | ActivityLogEntity[],
      ): Promise<ActivityLogEntity | ActivityLogEntity[]> => {
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
    find: jest.fn(() => Promise.resolve(processMemberships)),
  });
  const transactionalManagerResolutionRepository =
    createRepository<ManagerResolutionEntity>({
      find: jest.fn(() => Promise.resolve(processManagerResolutions)),
    });
  const orgUnitQueryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(() => Promise.resolve(processOrgUnits)),
    where: jest.fn().mockReturnThis(),
  };
  const transactionalOrgUnitRepository = createRepository<OrgUnitEntity>({
    createQueryBuilder: jest.fn(() => orgUnitQueryBuilder),
    find: jest.fn(() => Promise.resolve(processOrgUnits)),
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
    rootInstanceCount,
    rootInstanceFind,
    rootInstanceQueryBuilder,
    rootTaskFind,
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
    ),
    notificationService,
  };
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

function createDynamicOptionFormSchema(): FormDefinitionSchema {
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
        required: true,
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
  formDefinitionSnapshot,
  formData,
  id,
  initiatorMemberId,
  state,
  title,
  updatedAt,
  workflowSnapshot,
}: {
  readonly formDefinitionSnapshot?: Readonly<Record<string, unknown>>;
  readonly formData?: Readonly<Record<string, unknown>>;
  readonly id?: string;
  readonly initiatorMemberId?: string;
  readonly state?: ApprovalInstanceStateEnum;
  readonly title?: string;
  readonly updatedAt?: Date;
  readonly workflowSnapshot?: WorkflowDefinition;
} = {}): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    completedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formData: formData ?? {},
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

function createTask(value: Partial<TaskEntity>): TaskEntity {
  return Object.assign(new TaskEntity(), {
    adhocDirectiveId: value.adhocDirectiveId ?? null,
    adhocOriginTaskId: value.adhocOriginTaskId ?? null,
    adhocType: value.adhocType ?? null,
    assigneeMemberId: value.assigneeMemberId ?? 'member-finance',
    completedAt: value.completedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    delegationChain: value.delegationChain ?? [],
    id: value.id ?? 'task-1',
    instanceId: value.instanceId ?? 'instance-1',
    isAdhoc: value.isAdhoc ?? false,
    nodeId: value.nodeId ?? 'task_finance',
    openedAt: value.openedAt ?? null,
    originalAssigneeMemberId:
      value.originalAssigneeMemberId ?? 'member-finance',
    slaDueAt: value.slaDueAt ?? null,
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

function createLinearUserTaskWorkflow({
  allowAddSigner = false,
  allowReject = true,
  allowTransfer = true,
  approverResolver = {
    memberIds: ['member-finance'],
    type: 'DIRECT',
  },
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
          decisionPolicy: { type: 'SINGLE' },
          label: '財務簽核',
          returnBehavior,
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

function createNotifyServiceTaskWorkflow(): WorkflowDefinition {
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

function createSetFormFieldServiceTaskWorkflow(): WorkflowDefinition {
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
            fieldPath: 'form.approvalLevel',
            type: 'SET_FORM_FIELD',
            value: '"主管簽核"',
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
}: {
  readonly highCondition?: string;
  readonly includeStructuredCondition?: boolean;
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
          ...(includeStructuredCondition
            ? {
                conditionFieldKey: 'amount',
                conditionOperator: 'GREATER_THAN' as const,
                conditionValue: '1000',
              }
            : {}),
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
