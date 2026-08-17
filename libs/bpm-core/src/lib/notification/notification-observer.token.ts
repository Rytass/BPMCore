import { InjectionToken } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { NotificationEntity } from './notification.entity';

export interface BPMNotificationsCreatedEvent {
  /**
   * Every row written by one `createNotifications` call — a single engine
   * event can produce several (one per enabled channel). Hosts get the batch
   * rather than a call per row so they can push once.
   */
  readonly notifications: readonly NotificationEntity[];
  /**
   * Present when the rows were written inside a caller-supplied transaction,
   * in which case they are **not committed yet**. A host pushing a realtime
   * event should defer until this manager's transaction commits; announcing a
   * notification that then rolls back is worse than announcing it late.
   *
   * Absent when BPM owned the write, which means the rows are already
   * committed and can be pushed immediately.
   */
  readonly manager?: EntityManager;
}

/**
 * Observes notification rows as they are created, for every channel —
 * including `IN_APP`, which never reaches
 * {@link ./notification-dispatcher.token#BPMNotificationDispatcher} because it
 * has no delivery step.
 *
 * This exists so a host can drive a realtime channel (SSE / WebSocket) off the
 * same rows BPM writes. Without it the only options are polling the table or
 * putting a trigger on it, both of which reach around the module.
 *
 * Failures are swallowed by BPM: an observer must never fail the engine
 * transaction that produced the notification.
 */
export interface BPMNotificationObserver {
  onNotificationsCreated(
    event: BPMNotificationsCreatedEvent,
  ): Promise<void> | void;
}

export const BPM_NOTIFICATION_OBSERVER: InjectionToken<BPMNotificationObserver> =
  Symbol('BPM_NOTIFICATION_OBSERVER');
