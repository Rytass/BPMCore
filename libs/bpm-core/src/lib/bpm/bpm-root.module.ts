import {
  DynamicModule,
  InjectionToken,
  Module,
  Provider,
  Type,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { AttachmentModule } from '../attachment/attachment.module';
import { AttachmentStorage } from '../attachment/attachment-storage.token';
import { BPMAuthModule } from '../bpm-auth/bpm-auth.module';
import {
  applyBPMResolverMetadata,
  BPMResolverMetadataFactory,
} from '../bpm-auth/bpm-resolver-metadata';
import { BPMAuthModuleOptions } from '../bpm-auth/bpm-auth.options';
import { BPMBusinessCalendar } from '../calendar/business-calendar.token';
import { CalendarModule } from '../calendar/calendar.module';
import { DelegationModule } from '../delegation/delegation.module';
import { FormModule } from '../form/form.module';
import {
  BPMFormDataSourceRegistry,
  FormDataSourceModule,
  FormDataSourceModuleOptions,
} from '../form-data-source';
import { IdentityModule } from '../identity/identity.module';
import { BPMMemberResolver } from '../identity/member-resolver.interface';
import { NotificationModule } from '../notification/notification.module';
import { NotificationOptionsModule } from '../notification/notification-options.module';
import { OrganizationModule } from '../organization/organization.module';
import { SignatureModule } from '../signature/signature.module';
import { TemplateModule } from '../template/template.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { BPMWorkflowServiceTaskDispatcher } from '../workflow-engine/workflow-service-task-dispatcher.token';
import {
  BPM_ROOT_OPTIONS,
  BPMRootOptionsModule,
  BPMRootRuntimeOptions,
} from './bpm-root-options';

type BPMModuleImport = DynamicModule | Type<unknown>;

/**
 * Wiring-time options common to `forRoot` and `forRootAsync`.
 *
 * Everything here is a Nest `Provider` or a routing/schema decision, i.e. a
 * value Nest must have while it builds the module graph, before any async
 * factory runs. Every one of them is optional, and each has a runtime twin on
 * {@link BPMRootRuntimeOptions} that a `forRootAsync` factory can supply
 * instead — prefer the runtime twin whenever the value needs a secret.
 */
interface BPMRootModuleWiringOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Host-provided storage adapter for BPM attachments, as a Nest provider.
   *
   * Runtime twin: {@link BPMRootRuntimeOptions.attachmentStorage}. When
   * neither is given, BPM stores attachments through
   * `@rytass/storages-adapter-local` under `.storage/attachments`.
   */
  readonly attachmentStorageProvider?: Provider<AttachmentStorage>;

  /**
   * Host-provided business calendar used by workflow nodes whose SLA opts into
   * `BUSINESS_DAY`, as a Nest provider.
   *
   * Runtime twin: {@link BPMRootRuntimeOptions.businessCalendar}, which is the
   * safer of the two — the modules listed in `imports` are also given to BPM's
   * `CalendarModule`, so a provider whose dependency chain reaches **back into
   * BPM** produces a DI cycle that Nest never reports. See
   * `CalendarModuleOptions.businessCalendarProvider` for what that failure
   * looks like.
   *
   * When neither is given, BPM falls back to a Monday–Friday calendar (see
   * `notificationSlaBusinessCalendarTimeZone`).
   */
  readonly businessCalendarProvider?: Provider<BPMBusinessCalendar>;

  /**
   * Host-provided registry containing versioned form option DataSources, as a
   * Nest provider.
   *
   * Runtime twin: {@link BPMRootRuntimeOptions.formDataSourceRegistry}. When
   * neither is given, BPM exposes an empty catalog.
   */
  readonly formDataSourceRegistryProvider?: Provider<BPMFormDataSourceRegistry>;

  /**
   * Host-provided member resolver, as a Nest provider.
   *
   * Runtime twin: {@link BPMRootRuntimeOptions.memberResolver}. When neither
   * is given, BPM resolves every member to its own id
   * (`DefaultBPMMemberResolver`) so the application still boots.
   */
  readonly memberResolverProvider?: Provider<BPMMemberResolver>;

  /**
   * Host-supplied factory that stamps the host's own route metadata onto every
   * BPM GraphQL handler.
   *
   * Needed when the host installs a **global** guard that judges routes by
   * metadata BPM knows nothing about. `@rytass/member-base-nestjs-module`
   * registers a `CasbinGuard` that rejects any route without
   * `@CheckPermission` metadata, so without this every BPM query and mutation
   * fails with `Route has no permission metadata` before BPM's own guards run.
   *
   * The factory is called once per handler at module wiring time, receives the
   * authority BPM itself requires (`admin`, `designer`, `authenticated`) plus
   * the resolver and method names, and returns the metadata to write. It has
   * no runtime twin: Nest writes handler metadata before any factory runs.
   */
  readonly resolverMetadataFactory?: BPMResolverMetadataFactory;

  /**
   * Host-provided dispatcher for executable workflow service tasks, as a Nest
   * provider.
   *
   * Runtime twin: {@link BPMRootRuntimeOptions.workflowServiceTaskDispatcher}.
   * When neither is given, BPM sends WEBHOOK service tasks with the built-in
   * `fetch` dispatcher.
   */
  readonly workflowServiceTaskDispatcherProvider?: Provider<BPMWorkflowServiceTaskDispatcher>;
}

/**
 * Synchronous configuration for {@link BPMRootModule.forRoot}.
 *
 * Every field is optional: `BPMRootModule.forRoot()` boots a working BPM with
 * local attachment storage, an id-passthrough member resolver, a Monday–Friday
 * calendar, an empty form DataSource catalog, in-app notifications on, and
 * email, webhooks and both schedulers off. Features are opted in from there.
 */
export interface BPMRootModuleOptions
  extends BPMRootModuleWiringOptions, BPMRootRuntimeOptions {}

/**
 * Asynchronous configuration for {@link BPMRootModule.forRootAsync}.
 *
 * `useFactory` supplies every runtime setting — secrets included — and is
 * resolved **exactly once** per application, then shared with all BPM modules
 * through {@link BPM_ROOT_OPTIONS}. The wiring-time fields inherited from
 * {@link BPMRootModuleWiringOptions}, plus `attachmentRoutePrefix` and
 * `identityRegisterResolvers` below, are the only ones that cannot come from
 * the factory; each of them either registers a Nest provider or decides a
 * route/schema shape that Nest reads before the factory runs.
 */
export interface BPMRootModuleAsyncOptions extends BPMRootModuleWiringOptions {
  /**
   * Controller mount path used by the BPM attachment endpoints.
   *
   * Set at module wiring time because Nest reads controller path metadata
   * synchronously when the application starts. Async factories cannot drive
   * this value; only static URL routing decisions should set it. Defaults to
   * `/attachments`.
   */
  readonly attachmentRoutePrefix?: string | null;

  /**
   * Whether BPM registers its identity GraphQL queries. See
   * `BPMRootIdentityOptions.identityRegisterResolvers`.
   *
   * Set at module wiring time, like `attachmentRoutePrefix`, because Nest
   * collects resolver providers while building the schema — before
   * `useFactory` has run. Defaults to registering them.
   */
  readonly identityRegisterResolvers?: boolean;

  /**
   * Providers injected into `useFactory`.
   *
   * This is typically used to read Vault-backed SMTP, webhook, and auth
   * settings before constructing the flattened BPM root options.
   */
  readonly inject?: readonly InjectionToken[];

  /**
   * Async factory returning BPM runtime options.
   *
   * The returned object intentionally keeps all BPM settings flat at the root
   * level, for example `authContextFactory`, `notificationEmailSmtpHost`, and
   * `notificationSlaSchedulerEnabled`, alongside ready instances such as
   * `memberResolver` and `attachmentStorage`.
   *
   * Optional: a host that wants BPM's defaults and configures nothing can call
   * `BPMRootModule.forRootAsync()` with no arguments at all.
   */
  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => BPMRootRuntimeOptions | Promise<BPMRootRuntimeOptions>;
}

/**
 * Aggregate entry point that wires every BPM domain module
 * (`BPMAuthModule`, `IdentityModule`, `OrganizationModule`, `FormModule`,
 * `TemplateModule`, `WorkflowEngineModule`, `DelegationModule`,
 * `NotificationModule`, `SignatureModule`, `AttachmentModule`) into a
 * NestJS host application.
 *
 * Hosts call `forRoot` or `forRootAsync` once from their root `AppModule`.
 * BPMCore does **not** own login, GraphQL setup, TypeORM bootstrap, or
 * a user table; the host supplies those. Every BPM option has a default, so
 * the smallest working wiring is `BPMRootModule.forRoot()`.
 *
 * ```ts
 * BPMRootModule.forRootAsync({
 *   imports: [VaultModule],
 *   inject: [VaultService],
 *   useFactory: async (vault: VaultService) => ({
 *     attachmentSignedUrlSecret: await vault.get('BPM_ATTACHMENT_SIGNING_SECRET'),
 *     authContextFactory: buildAuthContext,
 *     memberResolver: new HostMemberResolver(await vault.get('DIRECTORY_URL')),
 *   }),
 * })
 * ```
 */
@Module({})
export class BPMRootModule {
  /**
   * Synchronous configuration. Use this when every BPM option is known at
   * wiring time (no async secret loading needed).
   */
  static forRoot(options: BPMRootModuleOptions = {}): DynamicModule {
    if (options.resolverMetadataFactory) {
      applyBPMResolverMetadata(options.resolverMetadataFactory);
    }

    const featureModules = createBPMFeatureModules({
      ...options,
      optionsModule: BPMRootOptionsModule.forRoot(options),
    });

    return {
      exports: [...featureModules],
      imports: [...(options.imports ?? []), ...featureModules],
      module: BPMRootModule,
    };
  }

  /**
   * Async configuration. Use this when BPM options must be resolved at
   * runtime — typically when SMTP, webhook, signature, or identity secrets are
   * loaded from Vault / KMS / a host `ConfigService`.
   *
   * Routing- and schema-time decisions such as `attachmentRoutePrefix`,
   * `identityRegisterResolvers`, `resolverMetadataFactory` and the `*Provider`
   * fields are read from the top-level options object (not from the
   * `useFactory` return value), because Nest reads controller path metadata,
   * resolver metadata and provider tokens synchronously during application
   * bootstrap. Everything else belongs in `useFactory`.
   */
  static forRootAsync(options: BPMRootModuleAsyncOptions = {}): DynamicModule {
    if (options.resolverMetadataFactory) {
      applyBPMResolverMetadata(options.resolverMetadataFactory);
    }

    const featureModules = createBPMFeatureModules({
      ...options,
      optionsModule: BPMRootOptionsModule.forRootAsync({
        imports: options.imports,
        inject: options.inject,
        useFactory: options.useFactory,
      }),
    });

    return {
      exports: [...featureModules],
      imports: [...(options.imports ?? []), ...featureModules],
      module: BPMRootModule,
    };
  }
}

interface BPMRootWiring extends BPMRootModuleWiringOptions {
  readonly attachmentRoutePrefix?: string | null;
  readonly identityRegisterResolvers?: boolean;

  /**
   * The module publishing {@link BPM_ROOT_OPTIONS}: `forRoot` resolves the
   * options eagerly, `forRootAsync` from the host factory. Everything
   * downstream reads that one token, which is what keeps a host factory from
   * running once per consuming module.
   */
  readonly optionsModule: DynamicModule;
}

/**
 * Builds the BPM feature module graph.
 *
 * `forRoot` and `forRootAsync` share this single path: both publish
 * {@link BPM_ROOT_OPTIONS} first (eagerly or from the host factory) and every
 * option-consuming sub-module then injects that one token. Before this, each
 * sub-module took the host's `useFactory` and called it itself — five times
 * per boot — so a factory that *constructed* something handed a different
 * instance to each consumer.
 */
function createBPMFeatureModules(wiring: BPMRootWiring): BPMModuleImport[] {
  const inject: readonly InjectionToken[] = [BPM_ROOT_OPTIONS];
  const useFactory = (options: BPMRootRuntimeOptions): BPMRootRuntimeOptions =>
    options;

  return [
    wiring.optionsModule,
    NotificationOptionsModule.forRootAsync({ inject, useFactory }),
    CalendarModule.forRoot({
      businessCalendarProvider: wiring.businessCalendarProvider,
      imports: wiring.imports,
    }),
    BPMAuthModule.forRootAsync({
      inject,
      useFactory: (options: BPMRootRuntimeOptions): BPMAuthModuleOptions => ({
        contextFactory: options.authContextFactory,
      }),
    }),
    IdentityModule.forRootAsync({
      identityRegisterResolvers: wiring.identityRegisterResolvers,
      imports: wiring.imports,
      inject,
      memberResolverProvider: wiring.memberResolverProvider,
      useFactory,
    }),
    OrganizationModule,
    AttachmentModule.forRootAsync({
      attachmentRoutePrefix: wiring.attachmentRoutePrefix,
      imports: wiring.imports,
      inject,
      storageProvider: wiring.attachmentStorageProvider,
      useFactory,
    }),
    FormModule,
    FormDataSourceModule.forRoot({
      imports: wiring.imports,
      registryProvider: wiring.formDataSourceRegistryProvider,
    } satisfies FormDataSourceModuleOptions),
    TemplateModule,
    DelegationModule,
    NotificationModule,
    SignatureModule.forRootAsync({ inject, useFactory }),
    WorkflowEngineModule.forRoot({
      imports: wiring.imports,
      serviceTaskDispatcherProvider: wiring.workflowServiceTaskDispatcherProvider,
    }),
  ];
}
