import { DynamicModule, Global, InjectionToken, Module } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import {
  BPM_NOTIFICATION_OPTIONS,
  BPMRootNotificationOptions,
  resolveBPMNotificationOptions,
} from './notification-options';

export interface NotificationOptionsModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Providers injected into `useFactory`.
   *
   * Host applications usually use this to pass Vault or config services into
   * the flattened notification option factory.
   */
  readonly inject?: readonly InjectionToken[];

  /**
   * Async factory returning flattened notification options.
   *
   * The returned object uses root-level keys such as
   * `notificationEmailSmtpHost` and `notificationWebhookEnabled`.
   */
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMRootNotificationOptions | Promise<BPMRootNotificationOptions>;
}

@Global()
@Module({})
export class NotificationOptionsModule {
  static forRoot(options: BPMRootNotificationOptions = {}): DynamicModule {
    return {
      exports: [BPM_NOTIFICATION_OPTIONS],
      module: NotificationOptionsModule,
      providers: [
        {
          provide: BPM_NOTIFICATION_OPTIONS,
          useValue: resolveBPMNotificationOptions(options),
        },
      ],
    };
  }

  static forRootAsync(
    options: NotificationOptionsModuleAsyncOptions,
  ): DynamicModule {
    return {
      exports: [BPM_NOTIFICATION_OPTIONS],
      imports: options.imports,
      module: NotificationOptionsModule,
      providers: [
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_NOTIFICATION_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<ReturnType<typeof resolveBPMNotificationOptions>> =>
            resolveBPMNotificationOptions(await options.useFactory(...args)),
        },
      ],
    };
  }
}
