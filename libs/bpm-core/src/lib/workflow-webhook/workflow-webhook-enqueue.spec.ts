import { NotifyWebhookTarget } from '@rytass/bpm-core-shared/workflow';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import {
  buildWorkflowWebhookDeliveryDrafts,
  WorkflowWebhookEnqueueContext,
} from './workflow-webhook-enqueue';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookParameter,
} from './workflow-webhook.types';

const CONTEXT: WorkflowWebhookEnqueueContext = {
  instance: {
    formData: { amount: 1200, note: '', tags: ['a', 'b'] },
    id: 'instance-1',
    initiatorMemberId: 'member-102',
    templateId: 'template-1',
    templateVersionId: 'template-version-3',
    title: '採購申請',
  },
  node: { id: 'notify_erp', label: '通知 ERP' },
  occurredAt: new Date('2026-09-15T10:00:00.000Z'),
  tokenId: 'token-1',
};

function entry(
  parameters: readonly BPMWorkflowWebhookParameter[],
): BPMWorkflowWebhookEndpointEntry {
  return {
    endpoint: {
      buildRequest: async () => ({ url: 'https://erp.example.com/hooks' }),
      descriptor: { key: 'erp.po', label: 'ERP', parameters, version: 1 },
    },
    source: 'REGISTRY',
  };
}

function target(
  bindings: NotifyWebhookTarget['bindings'],
  id = 'webhook_erp',
): NotifyWebhookTarget {
  return { bindings, endpoint: { key: 'erp.po', version: 1 }, id };
}

describe('buildWorkflowWebhookDeliveryDrafts', () => {
  it('freezes the event with resolved parameters from every binding kind', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      resolveEndpoint: async () =>
        entry([
          { key: 'amount', label: 'Amount', required: true, type: 'number' },
          { key: 'caseTitle', label: 'Title', required: false, type: 'string' },
          { key: 'source', label: 'Source', required: false, type: 'string' },
          { key: 'tags', label: 'Tags', required: false, type: 'stringArray' },
        ]),
      targets: [
        target([
          { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
          {
            from: { kind: 'CONTEXT', path: 'instance.title' },
            parameter: 'caseTitle',
          },
          { from: { kind: 'CONSTANT', value: 'BPM' }, parameter: 'source' },
          { from: { fieldKey: 'tags', kind: 'FIELD' }, parameter: 'tags' },
        ]),
      ],
    });

    expect(draft).toEqual({
      endpointKey: 'erp.po',
      endpointVersion: 1,
      event: {
        endpoint: { key: 'erp.po', version: 1 },
        initiator: { memberId: 'member-102' },
        instance: {
          id: 'instance-1',
          templateId: 'template-1',
          templateVersionId: 'template-version-3',
          title: '採購申請',
        },
        node: { id: 'notify_erp', label: '通知 ERP' },
        occurredAt: '2026-09-15T10:00:00.000Z',
        parameters: {
          amount: 1200,
          caseTitle: '採購申請',
          source: 'BPM',
          tags: ['a', 'b'],
        },
      },
      instanceId: 'instance-1',
      lastErrorCode: null,
      lastErrorDetail: null,
      nodeId: 'notify_erp',
      status: WorkflowWebhookDeliveryStatusEnum.PENDING,
      targetId: 'webhook_erp',
      tokenId: 'token-1',
    });
  });

  it('never sends the whole form: only bound parameters are included', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      resolveEndpoint: async () =>
        entry([
          { key: 'amount', label: 'Amount', required: false, type: 'number' },
          { key: 'note', label: 'Note', required: false, type: 'string' },
        ]),
      targets: [
        target([
          { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
        ]),
      ],
    });

    expect(draft?.event.parameters).toEqual({ amount: 1200 });
  });

  it('queues an already-failed row when the endpoint has disappeared', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      resolveEndpoint: async () => null,
      targets: [target([])],
    });

    expect(draft).toMatchObject({
      lastErrorCode: 'WEBHOOK_ENDPOINT_MISSING',
      status: WorkflowWebhookDeliveryStatusEnum.FAILED,
    });
  });

  it('fails a required parameter that resolved to nothing instead of throwing', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: { ...CONTEXT, instance: { ...CONTEXT.instance, formData: {} } },
      resolveEndpoint: async () =>
        entry([
          { key: 'amount', label: 'Amount', required: true, type: 'number' },
        ]),
      targets: [
        target([
          { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
        ]),
      ],
    });

    expect(draft).toMatchObject({
      lastErrorCode: 'WEBHOOK_PARAMETER_INVALID',
      lastErrorDetail:
        'parameter "amount" is required but resolved to no value',
      status: WorkflowWebhookDeliveryStatusEnum.FAILED,
    });
  });

  it('fails a value whose runtime type no longer fits the parameter', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: {
        ...CONTEXT,
        instance: { ...CONTEXT.instance, formData: { amount: 'lots' } },
      },
      resolveEndpoint: async () =>
        entry([
          { key: 'amount', label: 'Amount', required: true, type: 'number' },
        ]),
      targets: [
        target([
          { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
        ]),
      ],
    });

    expect(draft).toMatchObject({
      lastErrorCode: 'WEBHOOK_PARAMETER_INVALID',
      lastErrorDetail: 'parameter "amount" expects number',
    });
  });

  it('does not read inherited properties off the form data', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: { ...CONTEXT, instance: { ...CONTEXT.instance, formData: {} } },
      resolveEndpoint: async () =>
        entry([{ key: 'p', label: 'P', required: false, type: 'json' }]),
      targets: [
        target([
          { from: { fieldKey: 'constructor', kind: 'FIELD' }, parameter: 'p' },
        ]),
      ],
    });

    expect(draft?.event.parameters).toEqual({ p: null });
  });

  it('skips malformed targets and a malformed list rather than throwing', async () => {
    await expect(
      buildWorkflowWebhookDeliveryDrafts({
        context: CONTEXT,
        resolveEndpoint: async () => entry([]),
        targets: 'nope',
      }),
    ).resolves.toEqual([]);

    const drafts = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      resolveEndpoint: async () => entry([]),
      targets: [
        { bindings: 'x', endpoint: { key: 'erp.po', version: 1 }, id: 'bad' },
        target([], 'good'),
      ],
    });

    expect(drafts.map((draft) => draft.targetId)).toEqual(['good']);
  });

  it('records a registry that throws instead of rolling back the approval', async () => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      resolveEndpoint: async () => {
        throw new Error('registry exploded');
      },
      targets: [target([])],
    });

    expect(draft).toMatchObject({
      lastErrorCode: 'WEBHOOK_ENDPOINT_LOOKUP_FAILED',
      status: WorkflowWebhookDeliveryStatusEnum.FAILED,
    });
  });
});
