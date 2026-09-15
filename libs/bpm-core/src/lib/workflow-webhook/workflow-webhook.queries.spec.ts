import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BPMDesignerGuard } from '../bpm-auth/bpm-auth.authorization';
import { resolveBPMWorkflowWebhookOptions } from './workflow-webhook-options';
import { WorkflowWebhookQueries } from './workflow-webhook.queries';
import { WorkflowWebhookService } from './workflow-webhook.service';
import { StaticBPMWorkflowWebhookRegistry } from './workflow-webhook.types';

const ENDPOINT = {
  buildRequest: async (): Promise<{ readonly url: string }> => ({
    url: 'https://erp.example.com/hooks/bpm',
  }),
  descriptor: {
    description: 'Creates the purchase order',
    key: 'erp.purchase-approved',
    label: 'ERP purchase order',
    parameters: [
      {
        description: 'Gross amount',
        key: 'amount',
        label: 'Amount',
        required: true,
        type: 'number' as const,
      },
    ],
    version: 2,
  },
};

function queries(): WorkflowWebhookQueries {
  return new WorkflowWebhookQueries(
    new WorkflowWebhookService(
      new StaticBPMWorkflowWebhookRegistry([
        ENDPOINT,
        {
          ...ENDPOINT,
          descriptor: {
            ...ENDPOINT.descriptor,
            deprecated: true,
            key: 'erp.legacy',
          },
        },
      ]),
      resolveBPMWorkflowWebhookOptions(),
    ),
  );
}

describe('WorkflowWebhookQueries', () => {
  it('is designer-only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WorkflowWebhookQueries),
    ).toContain(BPMDesignerGuard);
  });

  it('maps a descriptor to the catalog object', async () => {
    expect(await queries().workflowWebhookEndpoints()).toEqual([
      {
        deprecated: false,
        description: 'Creates the purchase order',
        key: 'erp.purchase-approved',
        label: 'ERP purchase order',
        parameters: [
          {
            description: 'Gross amount',
            key: 'amount',
            label: 'Amount',
            required: true,
            type: 'number',
          },
        ],
        source: 'REGISTRY',
        version: 2,
      },
    ]);
  });

  it('never exposes a URL, header or secret to the browser', async () => {
    const serialized = JSON.stringify(
      await queries().workflowWebhookEndpoints(true),
    );

    expect(serialized).not.toContain('erp.example.com');
    expect(serialized.toLowerCase()).not.toContain('url');
    expect(serialized.toLowerCase()).not.toContain('header');
    expect(serialized.toLowerCase()).not.toContain('secret');
  });

  it('hides deprecated endpoints unless the designer asks for them', async () => {
    expect(
      (await queries().workflowWebhookEndpoints()).map((entry) => entry.key),
    ).toEqual(['erp.purchase-approved']);
    expect(
      (await queries().workflowWebhookEndpoints(true)).map(
        (entry) => entry.key,
      ),
    ).toEqual(['erp.purchase-approved', 'erp.legacy']);
  });
});
