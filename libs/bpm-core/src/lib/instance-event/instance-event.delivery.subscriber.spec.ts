import type { DataSource, QueryRunner } from 'typeorm';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventDeliverySubscriber } from './instance-event.delivery.subscriber';
import type { InstanceEventDeliveryService } from './instance-event.delivery.service';

function flushImmediate(): Promise<void> {
  return new Promise((resolve): void => {
    setImmediate(resolve);
  });
}

function row(id: string, status = 'PENDING'): ApprovalInstanceEventEntity {
  return Object.assign(new ApprovalInstanceEventEntity(), { id, status });
}

function transaction(
  active: boolean,
): { isTransactionActive: boolean } & QueryRunner {
  return { isTransactionActive: active } as {
    isTransactionActive: boolean;
  } & QueryRunner;
}

function setup(): {
  readonly deliverByIds: jest.Mock;
  readonly subscriber: InstanceEventDeliverySubscriber;
  readonly subscribers: unknown[];
} {
  const deliverByIds = jest.fn((): Promise<number> => Promise.resolve(0));
  const subscribers: unknown[] = [];
  const subscriber = new InstanceEventDeliverySubscriber(
    { subscribers } as unknown as DataSource,
    { deliverByIds } as unknown as InstanceEventDeliveryService,
  );

  return { deliverByIds, subscriber, subscribers };
}

describe('InstanceEventDeliverySubscriber', (): void => {
  it('registers itself on the data source', (): void => {
    const { subscriber, subscribers } = setup();

    expect(subscribers).toEqual([subscriber]);
    expect(subscriber.listenTo()).toBe(ApprovalInstanceEventEntity);
  });

  it('holds queued ids until the transaction commits, then kicks once', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = transaction(true);

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

  it('sends nothing for a transaction that rolled back', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = transaction(true);

    subscriber.afterInsert({ entity: row('a'), queryRunner } as never);
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionRollback({ queryRunner } as never);
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).not.toHaveBeenCalled();
  });

  it('keeps separate transactions apart', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();
    const first = transaction(true);
    const second = transaction(true);

    subscriber.afterInsert({ entity: row('a'), queryRunner: first } as never);
    subscriber.afterInsert({ entity: row('b'), queryRunner: second } as never);
    second.isTransactionActive = false;
    subscriber.afterTransactionRollback({ queryRunner: second } as never);
    first.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner: first } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledWith(['a']);
  });

  it('kicks immediately outside a transaction and ignores rows that are not pending', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();

    subscriber.afterInsert({
      entity: row('delivered', 'DELIVERED'),
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

  it('swallows a failed kick so the committing request is unaffected', async (): Promise<void> => {
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

  it('waits for the outer COMMIT when a savepoint is released first', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = transaction(true);

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

  it('keeps the outer ids when only a savepoint rolls back', async (): Promise<void> => {
    const { deliverByIds, subscriber } = setup();
    const queryRunner = transaction(true);

    subscriber.afterInsert({ entity: row('outer'), queryRunner } as never);
    subscriber.afterTransactionRollback({ queryRunner } as never);
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flushImmediate();

    expect(deliverByIds).toHaveBeenCalledWith(['outer']);
  });
});
