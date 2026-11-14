import type { InstanceEventDeliveryService } from './instance-event.delivery.service';
import { InstanceEventDeliverySchedulerService } from './instance-event.delivery-scheduler.service';
import type { InstanceEventService } from './instance-event.service';

function setup(enabled: boolean): {
  readonly deliverDue: jest.Mock;
  readonly purgeDelivered: jest.Mock;
  readonly scheduler: InstanceEventDeliverySchedulerService;
} {
  const deliverDue = jest.fn((): Promise<number> => Promise.resolve(0));
  const purgeDelivered = jest.fn((): Promise<number> => Promise.resolve(0));
  const scheduler = new InstanceEventDeliverySchedulerService(
    { deliverDue, purgeDelivered } as unknown as InstanceEventDeliveryService,
    {
      delivery: { scanIntervalMs: 1_000 },
      enabled,
    } as unknown as InstanceEventService,
  );

  return { deliverDue, purgeDelivered, scheduler };
}

describe('InstanceEventDeliverySchedulerService', (): void => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach((): void => {
    // Jest sets NODE_ENV=test, which the scheduler treats as "no timer".
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
  });

  afterEach((): void => {
    jest.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('starts no timer when no observer is bound', (): void => {
    const { deliverDue, scheduler } = setup(false);

    scheduler.onApplicationBootstrap();
    jest.advanceTimersByTime(5_000);

    expect(deliverDue).not.toHaveBeenCalled();
  });

  it('starts no timer under NODE_ENV=test', (): void => {
    process.env.NODE_ENV = 'test';
    const { deliverDue, scheduler } = setup(true);

    scheduler.onApplicationBootstrap();
    jest.advanceTimersByTime(5_000);

    expect(deliverDue).not.toHaveBeenCalled();
  });

  it('scans on each interval tick and stops on shutdown', async (): Promise<void> => {
    const { deliverDue, scheduler } = setup(true);

    scheduler.onApplicationBootstrap();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(deliverDue).toHaveBeenCalledTimes(1);

    scheduler.onApplicationShutdown();
    jest.advanceTimersByTime(5_000);

    expect(deliverDue).toHaveBeenCalledTimes(1);
  });

  it('does not overlap scans while one is still running', async (): Promise<void> => {
    const { deliverDue, scheduler } = setup(true);
    let finish: (value: number) => void = (): void => undefined;

    deliverDue.mockImplementationOnce(
      (): Promise<number> =>
        new Promise((resolve): void => {
          finish = resolve;
        }),
    );

    const first = scheduler.scan();
    await scheduler.scan();

    expect(deliverDue).toHaveBeenCalledTimes(1);

    finish(0);
    await first;
    await scheduler.scan();

    expect(deliverDue).toHaveBeenCalledTimes(2);
  });

  it('runs the retention sweep at most once per hour', async (): Promise<void> => {
    const { purgeDelivered, scheduler } = setup(true);

    await scheduler.scan();
    await scheduler.scan();

    expect(purgeDelivered).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3_600_000);
    await scheduler.scan();

    expect(purgeDelivered).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed scan and clears the guard for the next one', async (): Promise<void> => {
    const { deliverDue, scheduler } = setup(true);

    deliverDue.mockRejectedValueOnce(new Error('db down'));

    await expect(scheduler.scan()).resolves.toBeUndefined();
    await scheduler.scan();

    expect(deliverDue).toHaveBeenCalledTimes(2);
  });
});
