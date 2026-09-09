import { DynamicModule, Global, InjectionToken, Module } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { BPMRootAttachmentOptions } from '../attachment/attachment-options';
import { AttachmentStorage } from '../attachment/attachment-storage.token';
import { BPMAuthModuleOptions } from '../bpm-auth/bpm-auth.options';
import { BPMBusinessCalendar } from '../calendar/business-calendar.token';
import { BPMFormDataSourceRegistry } from '../form-data-source/form-data-source.types';
import { BPMRootIdentityOptions } from '../identity/identity-options';
import { BPMMemberResolver } from '../identity/member-resolver.interface';
import { BPMRootNotificationOptions } from '../notification/notification-options';
import { BPMRootSignatureOptions } from '../signature/signature-options';
import { BPMWorkflowServiceTaskDispatcher } from '../workflow-engine/workflow-service-task-dispatcher.token';

/**
 * Every BPM setting that can be decided at **runtime**, i.e. after the host's
 * secrets have been read.
 *
 * This is exactly what a `BPMRootModule.forRootAsync` `useFactory` returns, and
 * it is also embedded in the synchronous `BPMRootModuleOptions`, so a host can
 * move a setting between `forRoot` and `forRootAsync` without reshaping it.
 *
 * Every field is optional. A host that supplies none still boots: BPM falls
 * back to a local attachment store, an id-passthrough member resolver, a
 * Monday–Friday business calendar, an empty form DataSource catalog, and a
 * `fetch`-based webhook dispatcher, with in-app notifications on and email,
 * webhook, and both schedulers off. Features are opted **in** from there.
 *
 * Two settings deliberately do **not** live here, because Nest reads them
 * while building routes and the GraphQL schema — before any async factory has
 * run: `attachmentRoutePrefix` and `identityRegisterResolvers`. They are
 * accepted at the top level of the `forRootAsync` options object instead.
 */
export interface BPMRootRuntimeOptions
  extends
    BPMRootAttachmentOptions,
    BPMRootIdentityOptions,
    BPMRootNotificationOptions,
    BPMRootSignatureOptions {
  /**
   * Storage adapter for BPM attachments, as a ready instance.
   *
   * Any `@rytass/storages` compatible adapter (MinIO, S3, GCS) fits. Prefer
   * this over `attachmentStorageProvider` when the adapter needs a secret:
   * the instance is built inside the async factory, where the secret is
   * already in hand. When omitted, BPM writes to `.storage/attachments`
   * through `@rytass/storages-adapter-local`.
   */
  readonly attachmentStorage?: AttachmentStorage;

  /**
   * Factory that resolves the current BPM auth context from NestJS execution
   * context.
   *
   * BPM guards, GraphQL decorators, and domain services use this callback to
   * identify the current member and organization context. It is only needed
   * when the host does **not** already put a `bpmAuthContext` on the
   * GraphQL/HTTP context — BPM reads that first and falls back to this.
   */
  readonly authContextFactory?: BPMAuthModuleOptions['contextFactory'];

  /**
   * Business calendar for workflow nodes whose SLA opts into `BUSINESS_DAY`,
   * as a ready instance.
   *
   * BPMCore ships no national holiday data; when omitted, BPM falls back to a
   * Monday–Friday calendar in `notificationSlaBusinessCalendarTimeZone`.
   *
   * Supplying the calendar here rather than through
   * `businessCalendarProvider` also sidesteps that option's DI-cycle footgun:
   * the instance is constructed by the host's own factory, so its dependency
   * chain never runs through BPM's module context.
   */
  readonly businessCalendar?: BPMBusinessCalendar;

  /**
   * Versioned form option DataSource catalog, as a ready instance. When
   * omitted, BPM exposes an empty catalog.
   */
  readonly formDataSourceRegistry?: BPMFormDataSourceRegistry;

  /**
   * Host identity source, as a ready instance.
   *
   * When omitted, BPM resolves every member to its own id
   * (`DefaultBPMMemberResolver`): screens keep working, but display names are
   * raw ids and member emails are empty.
   */
  readonly memberResolver?: BPMMemberResolver;

  /**
   * Dispatcher for executable workflow service tasks, as a ready instance.
   * Replace the default `fetch` dispatcher to add auth headers, request
   * signing, retry queues, or an outbound integration bus.
   */
  readonly workflowServiceTaskDispatcher?: BPMWorkflowServiceTaskDispatcher;
}

/**
 * @deprecated Use {@link BPMRootRuntimeOptions}. Kept as a
 * backwards-compatible alias for hosts that named the `forRootAsync` factory
 * return type explicitly.
 */
export type BPMRootModuleAsyncFactoryOptions = BPMRootRuntimeOptions;

/**
 * Injection token carrying the **resolved** {@link BPMRootRuntimeOptions}.
 *
 * BPM resolves the host's `useFactory` exactly once and publishes the result
 * under this token, so every BPM sub-module reads one coherent object. Before
 * this token existed each sub-module called the host factory itself — five
 * times per boot — which made a factory that constructs instances (a member
 * resolver, a storage adapter) quietly produce a different instance per
 * consumer.
 *
 * Host code may inject it too, but it is primarily BPM's own plumbing.
 */
export const BPM_ROOT_OPTIONS: InjectionToken<BPMRootRuntimeOptions> = Symbol(
  'BPM_ROOT_OPTIONS',
);

export interface BPMRootOptionsModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Providers injected into `useFactory`, typically a Vault or config service.
   */
  readonly inject?: readonly InjectionToken[];

  /**
   * Async factory returning the flattened BPM runtime options. Optional — a
   * host that only needs defaults can omit it entirely.
   */
  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => BPMRootRuntimeOptions | Promise<BPMRootRuntimeOptions>;
}

/**
 * Publishes the resolved BPM runtime options under {@link BPM_ROOT_OPTIONS}.
 *
 * Global so that every BPM sub-module — and any host provider that wants to
 * read what BPM ended up with — can inject the token without threading an
 * import through each feature module.
 */
@Global()
@Module({})
export class BPMRootOptionsModule {
  static forRoot(options: BPMRootRuntimeOptions = {}): DynamicModule {
    return {
      exports: [BPM_ROOT_OPTIONS],
      module: BPMRootOptionsModule,
      providers: [
        {
          provide: BPM_ROOT_OPTIONS,
          useValue: options,
        },
      ],
    };
  }

  static forRootAsync(
    options: BPMRootOptionsModuleAsyncOptions = {},
  ): DynamicModule {
    const useFactory = options.useFactory;

    return {
      exports: [BPM_ROOT_OPTIONS],
      imports: options.imports ? [...options.imports] : [],
      module: BPMRootOptionsModule,
      providers: [
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_ROOT_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<BPMRootRuntimeOptions> =>
            useFactory ? await useFactory(...args) : {},
        },
      ],
    };
  }
}
