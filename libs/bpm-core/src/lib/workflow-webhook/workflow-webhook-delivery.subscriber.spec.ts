import { DataSource, QueryRunner } from 'typeorm';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';
import { WorkflowWebhookDeliverySubscriber } from './workflow-webhook-delivery.subscriber';

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function row(
  id: string,
  status = WorkflowWebhookDeliveryStatusEnum.PENDING,
): WorkflowWebhookDeliveryEntity {
  return Object.assign(new WorkflowWebhookDeliveryEntity(), { id, status });
}

function setup(): {
  readonly deliverByIds: jest.Mock;
  readonly subscriber: WorkflowWebhookDeliverySubscriber;
  readonly subscribers: unknown[];
} {
  const deliverByIds = jest.fn(async () => 0);
  const subscribers: unknown[] = [];
  const subscriber = new WorkflowWebhookDeliverySubscriber(
    { subscribers } as unknown as DataSource,
    { deliverByIds } as unknown as WorkflowWebhookDeliveryService,
  );

  return { deliverByIds, subscriber, subscribers };
}

describe('WorkflowWebhookDeliverySubscriber', () => {
  it('registers itself on the data source', () => {
    const { subscriber, subscribers } = setup();

    expect(subscribers).toEqual([subscriber]);
    expect(subscriber.listenTo()).toBe(WorkflowWebhookDeliveryEntity);
  });

  it('holds queued ids until the transaction commits, then kicks once', async () => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;

    subscriber.afterInsert({ entity: row('a'), queryRunner } as never);
    subscriber.afterInsert({ entity: row('b'), queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).not.toHaveBeenCalled();

    // TypeORM clears the flag after COMMIT and before broadcasting.
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledTimes(1);
    expect(deliverByIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('sends nothing for a transaction that rolled back', async () => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;

    subscriber.afterInsert({ entity: row('a'), queryRunner } as never);
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionRollback({ queryRunner } as never);
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).not.toHaveBeenCalled();
  });

  it('keeps separate transactions apart', async () => {
    const { deliverByIds, subscriber } = setup();
    const first = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;
    const second = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;

    subscriber.afterInsert({ entity: row('a'), queryRunner: first } as never);
    subscriber.afterInsert({ entity: row('b'), queryRunner: second } as never);
    second.isTransactionActive = false;
    subscriber.afterTransactionRollback({ queryRunner: second } as never);
    first.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner: first } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledWith(['a']);
  });

  it('kicks immediately outside a transaction and ignores rows already failed', async () => {
    const { deliverByIds, subscriber } = setup();

    subscriber.afterInsert({
      entity: row('failed', WorkflowWebhookDeliveryStatusEnum.FAILED),
      queryRunner: { isTransactionActive: false },
    } as never);
    subscriber.afterInsert({
      entity: row('a'),
      queryRunner: { isTransactionActive: false },
    } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledTimes(1);
    expect(deliverByIds).toHaveBeenCalledWith(['a']);
  });

  it('swallows a failed kick so the committing request is unaffected', async () => {
    const { deliverByIds, subscriber } = setup();

    deliverByIds.mockRejectedValueOnce(new Error('db down'));
    subscriber.afterInsert({
      entity: row('a'),
      queryRunner: { isTransactionActive: false },
    } as never);
    await flushImmediate();
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledTimes(1);
  });

  it('waits for the outer COMMIT when a savepoint is released first', async () => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;

    subscriber.afterInsert({ entity: row('outer'), queryRunner } as never);
    subscriber.afterInsert({ entity: row('inner'), queryRunner } as never);
    // RELEASE SAVEPOINT broadcasts a commit while the transaction stays open.
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).not.toHaveBeenCalled();

    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledWith(['outer', 'inner']);
  });

  it('keeps the outer ids when only a savepoint rolls back', async () => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = { isTransactionActive: true } as {
      isTransactionActive: boolean;
    } & QueryRunner;

    subscriber.afterInsert({ entity: row('outer'), queryRunner } as never);
    subscriber.afterTransactionRollback({ queryRunner } as never);
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledWith(['outer']);
  });
});
