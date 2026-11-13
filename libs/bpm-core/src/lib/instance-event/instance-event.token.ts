import { InjectionToken } from '@nestjs/common';
import type { BPMInstanceEvent } from './instance-event.types';

/**
 * Host hook that receives approval instance lifecycle events (ADR 27 §1).
 *
 * Delivery is at-least-once and runs after the state change has committed. A
 * redelivered event carries the same `event.id`, so the host dedupes on it.
 * Events of one instance arrive in `seq` order; events of different instances
 * have no ordering guarantee. A thrown error is retried with backoff and the
 * event is marked FAILED after the retry limit.
 */
export interface BPMInstanceEventObserver {
  onInstanceEvent(event: BPMInstanceEvent): Promise<void> | void;
}

/**
 * Optional host binding for {@link BPMInstanceEventObserver}. Without an
 * observer, the engine writes no event rows at all.
 */
export const BPM_INSTANCE_EVENT_OBSERVER: InjectionToken<BPMInstanceEventObserver> =
  Symbol('BPM_INSTANCE_EVENT_OBSERVER');
