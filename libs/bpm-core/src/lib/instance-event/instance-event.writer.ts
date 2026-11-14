import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventService } from './instance-event.service';
import type {
  BPMInstanceEventSnapshot,
  BPMInstanceEventType,
  BPMInstanceEventTypePayloads,
} from './instance-event.types';

/**
 * Writes outbox rows inside the caller's transaction (ADR 27 §1.2). Rows are
 * written only when a host observer is bound; otherwise this is a no-op and
 * the engine behaves as it did in 0.22.0.
 *
 * Uses `save` rather than `insert` so the TypeORM `afterInsert` event fires
 * and the delivery subscriber can stage the new id for after-commit delivery.
 */
@Injectable()
export class InstanceEventWriter {
  constructor(private readonly events: InstanceEventService) {}

  /**
   * Whether a host observer is bound. Callers use this to skip building a
   * snapshot (for example a template lookup) when no row would be written.
   */
  get enabled(): boolean {
    return this.events.enabled;
  }

  async record<K extends BPMInstanceEventType>(
    manager: EntityManager,
    instanceId: string,
    snapshot: BPMInstanceEventSnapshot,
    type: K,
    fields: BPMInstanceEventTypePayloads[K],
  ): Promise<void> {
    if (!this.events.enabled) {
      return;
    }

    const repository = manager.getRepository(ApprovalInstanceEventEntity);
    const row = repository.create({
      instanceId,
      payload: { ...snapshot, ...fields },
      type,
    });

    await repository.save(row);
  }
}
