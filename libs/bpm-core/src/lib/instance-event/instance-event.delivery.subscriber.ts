import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';

/**
 * Starts delivery of a lifecycle event the moment the transaction that wrote
 * it commits (ADR 27 §1.3), without every engine entry point having to
 * remember to.
 *
 * Inserted ids are held per query runner and released on commit; a rollback
 * drops them, so an event whose state change was rolled back is never
 * delivered. The kick is best effort and never awaited: the scheduler
 * releases anything it misses.
 */
@Injectable()
export class InstanceEventDeliverySubscriber implements EntitySubscriberInterface<ApprovalInstanceEventEntity> {
  private readonly logger = new Logger(InstanceEventDeliverySubscriber.name);
  private readonly pending = new WeakMap<QueryRunner, readonly string[]>();

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly deliveryService: InstanceEventDeliveryService,
  ) {
    // The documented way to register a Nest-managed subscriber; guarded so a
    // stand-in data source in tests does not break the module graph.
    if (Array.isArray(dataSource?.subscribers)) {
      dataSource.subscribers.push(this);
    }
  }

  listenTo(): typeof ApprovalInstanceEventEntity {
    return ApprovalInstanceEventEntity;
  }

  afterInsert(event: InsertEvent<ApprovalInstanceEventEntity>): void {
    const row = event.entity;

    if (!row?.id || row.status !== 'PENDING') {
      return;
    }

    if (!event.queryRunner?.isTransactionActive) {
      this.kick([row.id]);

      return;
    }

    const queued = this.pending.get(event.queryRunner) ?? [];

    this.pending.set(event.queryRunner, [...queued, row.id]);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    // Releasing a savepoint broadcasts the same event while the outer
    // transaction is still open and its rows still invisible. Wait for the
    // real COMMIT, after which TypeORM has cleared `isTransactionActive`.
    if (event.queryRunner.isTransactionActive) {
      return;
    }

    const ids = this.pending.get(event.queryRunner) ?? [];

    this.pending.delete(event.queryRunner);

    if (ids.length > 0) {
      this.kick(ids);
    }
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    // Rolling back to a savepoint leaves the outer transaction, and the rows
    // it queued outside that savepoint, intact.
    if (event.queryRunner.isTransactionActive) {
      return;
    }

    this.pending.delete(event.queryRunner);
  }

  private kick(ids: readonly string[]): void {
    setImmediate((): void => {
      this.deliveryService
        .deliverByIds([...new Set(ids)])
        .catch((error: unknown): void => {
          this.logger.warn(
            `Immediate instance event delivery failed; the scheduler will retry: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    });
  }
}
