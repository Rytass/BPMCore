import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_INSTANCE_EVENT_OBSERVER,
  BPMInstanceEventObserver,
} from './instance-event.token';

/**
 * Holds the host observer for instance lifecycle events. `observer` is `null`
 * when the host bound none; the engine then writes no outbox rows.
 *
 * Resolution: the Nest provider (`BPM_INSTANCE_EVENT_OBSERVER`) wins over the
 * runtime option `BPMRootRuntimeOptions.instanceEventObserver`.
 */
@Injectable()
export class InstanceEventService {
  readonly observer: BPMInstanceEventObserver | null;

  constructor(
    @Optional()
    @Inject(BPM_INSTANCE_EVENT_OBSERVER)
    injectedObserver: BPMInstanceEventObserver | undefined,
    @Optional()
    @Inject(BPM_ROOT_OPTIONS)
    rootOptions: BPMRootRuntimeOptions | undefined,
  ) {
    this.observer =
      injectedObserver ?? rootOptions?.instanceEventObserver ?? null;
  }

  get enabled(): boolean {
    return this.observer !== null;
  }
}
