import {
  DynamicModule,
  Global,
  Module,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';
import { InstanceEventDeliverySchedulerService } from './instance-event.delivery-scheduler.service';
import { InstanceEventDeliverySubscriber } from './instance-event.delivery.subscriber';
import {
  BPM_INSTANCE_EVENT_OBSERVER,
  BPMInstanceEventObserver,
} from './instance-event.token';
import { InstanceEventService } from './instance-event.service';

export interface InstanceEventModuleOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly observerProvider?: Provider<BPMInstanceEventObserver>;
}

@Global()
@Module({})
export class InstanceEventModule {
  /**
   * `BPM_INSTANCE_EVENT_OBSERVER` is exported only when `observerProvider` is
   * given. Exporting an unprovided token makes Nest fail with
   * `UnknownExportException`.
   */
  static forRoot(options: InstanceEventModuleOptions = {}): DynamicModule {
    const observerProviders: readonly Provider[] = options.observerProvider
      ? [options.observerProvider]
      : [];
    const observerExports: readonly (typeof BPM_INSTANCE_EVENT_OBSERVER)[] =
      options.observerProvider ? [BPM_INSTANCE_EVENT_OBSERVER] : [];

    return {
      exports: [InstanceEventService, ...observerExports],
      global: true,
      imports: [
        ...(options.imports ?? []),
        TypeOrmModule.forFeature([ApprovalInstanceEventEntity]),
      ],
      module: InstanceEventModule,
      providers: [
        ...observerProviders,
        InstanceEventService,
        InstanceEventDeliveryService,
        InstanceEventDeliverySubscriber,
        InstanceEventDeliverySchedulerService,
      ],
    };
  }
}
