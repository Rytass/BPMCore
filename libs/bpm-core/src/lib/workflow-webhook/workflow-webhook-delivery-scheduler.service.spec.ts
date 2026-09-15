import { WorkflowWebhookDeliverySchedulerService } from './workflow-webhook-delivery-scheduler.service';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';
import { resolveBPMWorkflowWebhookOptions } from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';

function scheduler({
  endpoints,
  hasSources = true,
  schedulerEnabled,
}: {
  readonly endpoints: number;
  readonly hasSources?: boolean;
  readonly schedulerEnabled?: boolean;
}): {
  readonly deliverDue: jest.Mock;
  readonly service: WorkflowWebhookDeliverySchedulerService;
} {
  const deliverDue = jest.fn(async () => 0);
  const options = resolveBPMWorkflowWebhookOptions({
    workflowWebhookDeliverySchedulerEnabled: schedulerEnabled,
  });

  return {
    deliverDue,
    service: new WorkflowWebhookDeliverySchedulerService(
      { deliverDue } as unknown as WorkflowWebhookDeliveryService,
      {
        hasEndpointSources: () => hasSources,
        listEndpoints: async () => Array.from({ length: endpoints }),
        readOptions: () => options,
      } as unknown as WorkflowWebhookService,
    ),
  };
}

describe('WorkflowWebhookDeliverySchedulerService', () => {
  it('turns itself on when an endpoint is registered and nothing says otherwise', async () => {
    expect(await scheduler({ endpoints: 1 }).service.isEnabled()).toBe(true);
    expect(await scheduler({ endpoints: 0 }).service.isEnabled()).toBe(false);
    expect(
      await scheduler({ endpoints: 1, hasSources: false }).service.isEnabled(),
    ).toBe(false);
  });

  it('respects an explicit setting either way', async () => {
    expect(
      await scheduler({
        endpoints: 1,
        schedulerEnabled: false,
      }).service.isEnabled(),
    ).toBe(false);
    expect(
      await scheduler({
        endpoints: 0,
        schedulerEnabled: true,
      }).service.isEnabled(),
    ).toBe(true);
  });

  it('does not start a scan while the previous one is still running', async () => {
    const { deliverDue, service } = scheduler({ endpoints: 1 });
    let release: () => void = () => undefined;

    deliverDue.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );

    const first = service.scan();

    await service.scan();
    expect(deliverDue).toHaveBeenCalledTimes(1);

    release();
    await first;
    await service.scan();
    expect(deliverDue).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a failed scan', async () => {
    const { deliverDue, service } = scheduler({ endpoints: 1 });

    deliverDue.mockRejectedValueOnce(new Error('db down'));

    await expect(service.scan()).resolves.toBeUndefined();
    await service.scan();
    expect(deliverDue).toHaveBeenCalledTimes(2);
  });

  it('runs anyway when the endpoints cannot be listed at boot', async () => {
    const options = resolveBPMWorkflowWebhookOptions();
    const service = new WorkflowWebhookDeliverySchedulerService(
      { deliverDue: jest.fn() } as unknown as WorkflowWebhookDeliveryService,
      {
        hasEndpointSources: () => true,
        listEndpoints: async () => {
          throw new Error('db down');
        },
        readOptions: () => options,
      } as unknown as WorkflowWebhookService,
    );

    expect(await service.isEnabled()).toBe(true);
  });
});
