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
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';

/**
 * Starts delivery the moment the transaction that queued it commits
 * (ADR 18 §3.5), without every engine entry point having to remember to.
 *
 * Inserted ids are held per query runner and released on commit; a rollback
 * drops them, which is exactly the guarantee the outbox exists for. The kick
 * is best effort and never awaited — the scheduler picks up anything it
 * misses.
 */
@Injectable()
export class WorkflowWebhookDeliverySubscriber implements EntitySubscriberInterface<WorkflowWebhookDeliveryEntity> {
  private readonly logger = new Logger(WorkflowWebhookDeliverySubscriber.name);
  private readonly pending = new WeakMap<QueryRunner, Set<string>>();

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly deliveryService: WorkflowWebhookDeliveryService,
  ) {
    // The documented way to register a Nest-managed subscriber; guarded so a
    // stand-in data source in tests does not break the module graph.
    if (Array.isArray(dataSource?.subscribers)) {
      dataSource.subscribers.push(this);
    }
  }

  listenTo(): typeof WorkflowWebhookDeliveryEntity {
    return WorkflowWebhookDeliveryEntity;
  }

  afterInsert(event: InsertEvent<WorkflowWebhookDeliveryEntity>): void {
    const row = event.entity;

    if (!row?.id || row.status !== WorkflowWebhookDeliveryStatusEnum.PENDING) {
      return;
    }

    if (!event.queryRunner?.isTransactionActive) {
      this.kick([row.id]);

      return;
    }

    const ids = this.pending.get(event.queryRunner) ?? new Set<string>();

    ids.add(row.id);
    this.pending.set(event.queryRunner, ids);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    // Releasing a savepoint broadcasts the same event while the outer
    // transaction is still open and its rows still invisible. Wait for the
    // real COMMIT, after which TypeORM has cleared `isTransactionActive`.
    if (event.queryRunner.isTransactionActive) {
      return;
    }

    const ids = this.pending.get(event.queryRunner);

    this.pending.delete(event.queryRunner);

    if (ids?.size) {
      this.kick([...ids]);
    }
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    // Rolling back to a savepoint leaves the outer transaction, and the rows
    // it queued outside that savepoint, intact. Kicking an id whose row the
    // savepoint discarded is harmless: the claim simply finds nothing.
    if (event.queryRunner.isTransactionActive) {
      return;
    }

    this.pending.delete(event.queryRunner);
  }

  private kick(ids: readonly string[]): void {
    setImmediate((): void => {
      this.deliveryService.deliverByIds(ids).catch((error: unknown): void => {
        this.logger.warn(
          `Immediate webhook delivery failed; the scheduler will retry: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }
}
