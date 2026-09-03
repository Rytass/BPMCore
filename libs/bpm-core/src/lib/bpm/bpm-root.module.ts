import {
  DynamicModule,
  InjectionToken,
  Module,
  Provider,
  Type,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { BPMRootAttachmentOptions } from '../attachment/attachment-options';
import { AttachmentModule } from '../attachment/attachment.module';
import { AttachmentStorage } from '../attachment/attachment-storage.token';
import { BPMAuthModule } from '../bpm-auth/bpm-auth.module';
import {
  applyBPMResolverMetadata,
  BPMResolverMetadataFactory,
} from '../bpm-auth/bpm-resolver-metadata';
import {
  BPMAuthModuleAsyncOptions,
  BPMAuthModuleOptions,
} from '../bpm-auth/bpm-auth.options';
import { BPMBusinessCalendar } from '../calendar/business-calendar.token';
import { CalendarModule } from '../calendar/calendar.module';
import { DelegationModule } from '../delegation/delegation.module';
import { FormModule } from '../form/form.module';
import {
  BPMFormDataSourceRegistry,
  FormDataSourceModule,
  FormDataSourceModuleOptions,
} from '../form-data-source';
import { BPMRootIdentityOptions } from '../identity/identity-options';
import { IdentityModule } from '../identity/identity.module';
import { BPMMemberResolver } from '../identity/member-resolver.interface';
import { NotificationModule } from '../notification/notification.module';
import { NotificationOptionsModule } from '../notification/notification-options.module';
import { BPMRootNotificationOptions } from '../notification/notification-options';
import { OrganizationModule } from '../organization/organization.module';
import { BPMRootSignatureOptions } from '../signature/signature-options';
import { SignatureModule } from '../signature/signature.module';
import { TemplateModule } from '../template/template.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { BPMWorkflowServiceTaskDispatcher } from '../workflow-engine/workflow-service-task-dispatcher.token';

type BPMModuleImport = DynamicModule | Type<unknown>;

export interface BPMRootModuleOptions
  extends
    Pick<ModuleMetadata, 'imports'>,
    BPMRootAttachmentOptions,
    BPMRootIdentityOptions,
    BPMRootNotificationOptions,
    BPMRootSignatureOptions {
  /**
   * Host-provided storage adapter for BPM attachments.
   *
   * When omitted, BPM stores attachments through the local
   * `@rytass/storages-adapter-local` adapter under `.storage/attachments`.
   * Hosts can replace this provider with any `@rytass/storages` compatible
   * adapter such as MinIO, S3, or GCS.
   */
  readonly attachmentStorageProvider?: Provider<AttachmentStorage>;

  /**
   * Factory that resolves the current BPM auth context from NestJS execution
   * context.
   *
   * BPM guards, GraphQL decorators, and domain services use this callback to
   * identify the current member and organization context. When omitted, BPM
   * operations that require authentication will not receive a host session.
   */
  readonly authContextFactory?: BPMAuthModuleOptions['contextFactory'];

  /**
   * Host-provided business calendar used by workflow nodes whose SLA opts into
   * `BUSINESS_DAY`.
   *
   * BPMCore ships no national holiday data. When omitted, BPM falls back to a
   * Monday–Friday calendar (see `notificationSlaBusinessCalendarTimeZone`);
   * hosts that need national holidays or make-up working days register their
   * own `BPM_BUSINESS_CALENDAR` provider here.
   *
   * The modules listed in `imports` are also given to BPM's `CalendarModule`
   * so this provider can reach host services. A provider whose dependency
   * chain reaches **back into BPM** therefore produces a DI cycle that Nest
   * never reports — see `CalendarModuleOptions.businessCalendarProvider` for
   * what that failure looks like.
   */
  readonly businessCalendarProvider?: Provider<BPMBusinessCalendar>;

  /**
   * Host-provided registry containing versioned form option DataSources.
   *
   * The registry is a single provider so a published form reference always
   * resolves against one coherent catalog. When omitted, BPM exposes an
   * empty catalog and keeps existing hosts bootstrap-compatible.
   */
  readonly formDataSourceRegistryProvider?: Provider<BPMFormDataSourceRegistry>;

  /**
   * Host-provided member resolver provider.
   *
   * BPM uses this provider to resolve member metadata, organization identity,
   * display names, and approver candidates without coupling
   * `@rytass/bpm-core-nestjs-module` to a specific external identity system.
   */
  readonly memberResolverProvider: Provider<BPMMemberResolver>;

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
   * the resolver and method names, and returns the metadata to write. See
   * `BPMResolverMetadataFactory`.
   */
  readonly resolverMetadataFactory?: BPMResolverMetadataFactory;

  /**
   * Host-provided dispatcher for executable workflow service tasks.
   *
   * When omitted, BPM sends WEBHOOK service tasks with the built-in `fetch`
   * dispatcher. Wrapper apps can replace this provider to add auth headers,
   * request signing, retry queues, or an outbound integration bus.
   */
  readonly workflowServiceTaskDispatcherProvider?: Provider<BPMWorkflowServiceTaskDispatcher>;
}

export interface BPMRootModuleAsyncFactoryOptions
  extends
    BPMRootAttachmentOptions,
    BPMRootIdentityOptions,
    BPMRootNotificationOptions,
    BPMRootSignatureOptions {
  /**
   * Factory that resolves the current BPM auth context from NestJS execution
   * context.
   *
   * BPM guards, GraphQL decorators, and domain services use this callback to
   * identify the current member and organization context. When omitted, BPM
   * operations that require authentication will not receive a host session.
   */
  readonly authContextFactory?: BPMAuthModuleOptions['contextFactory'];
}

export interface BPMRootModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
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
   * Host-provided storage adapter for BPM attachments.
   *
   * This provider is static at module wiring time. If secrets are required,
   * use a Nest provider with `useFactory` / `inject` here.
   */
  readonly attachmentStorageProvider?: Provider<AttachmentStorage>;

  /**
   * Host-provided business calendar for `BUSINESS_DAY` SLAs.
   *
   * This provider is static at module wiring time. If secrets or a repository
   * are required, use a Nest provider with `useFactory` / `inject` here.
   *
   * Its dependency chain must not reach back into BPM: the modules listed in
   * `imports` are forwarded to BPM's `CalendarModule`, and a cycle there stops
   * the application booting with no exception and exit code `0`. See
   * `CalendarModuleOptions.businessCalendarProvider`.
   */
  readonly businessCalendarProvider?: Provider<BPMBusinessCalendar>;

  /**
   * Host-provided versioned form option DataSource registry. This provider is
   * static at module wiring time; secrets and repositories can be injected
   * through its Nest `useFactory`, `useClass`, or `useExisting` definition.
   */
  readonly formDataSourceRegistryProvider?: Provider<BPMFormDataSourceRegistry>;

  /**
   * Whether BPM registers its identity GraphQL queries. See
   * `BPMRootIdentityOptions.identityRegisterResolvers`.
   *
   * Set at module wiring time, like `attachmentRoutePrefix`, because Nest
   * collects resolver providers while building the schema — before the
   * `useFactory` below has run.
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
   * Host-provided member resolver provider.
   *
   * BPM uses this provider to resolve member metadata, organization identity,
   * display names, and approver candidates without coupling
   * `@rytass/bpm-core-nestjs-module` to a specific external identity system.
   */
  readonly memberResolverProvider: Provider<BPMMemberResolver>;

  /**
   * Host-supplied factory that stamps the host's own route metadata onto every
   * BPM GraphQL handler. See
   * `BPMRootModuleOptions.resolverMetadataFactory`.
   *
   * Read at module wiring time rather than from `useFactory`, because Nest
   * builds the resolver metadata before any async factory has run.
   */
  readonly resolverMetadataFactory?: BPMResolverMetadataFactory;

  /**
   * Host-provided dispatcher for executable workflow service tasks.
   *
   * This provider is static at module wiring time. If secrets are required,
   * use a Nest provider with `useFactory` / `inject` here.
   */
  readonly workflowServiceTaskDispatcherProvider?: Provider<BPMWorkflowServiceTaskDispatcher>;

  /**
   * Async factory returning BPM root options.
   *
   * The returned object intentionally keeps all BPM settings flat at the root
   * level, for example `authContextFactory`, `notificationEmailSmtpHost`, and
   * `notificationSlaSchedulerEnabled`.
   */
  readonly useFactory: (
    ...args: readonly unknown[]
  ) =>
    | BPMRootModuleAsyncFactoryOptions
    | Promise<BPMRootModuleAsyncFactoryOptions>;
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
 * Vault loading — those remain the host's responsibility. See the
 * package README sections "Embedding & auth", "Organization data
 * ownership", and "Consumer quickstart" for the full contract.
 *
 * The host must avoid Nest's `app.setGlobalPrefix(...)`; BPM controllers
 * mount at relative paths driven by their respective options (notably
 * `attachmentRoutePrefix`).
 *
 * @example
 * ```ts
 * BPMRootModule.forRoot({
 *   authContextFactory: readBPMAuthContextFromGqlContext,
 *   memberResolverProvider: {
 *     provide: BPM_MEMBER_RESOLVER,
 *     useClass: HostMemberResolver,
 *   },
 *   attachmentPublicBaseUrl: process.env.BPM_PUBLIC_BASE_URL,
 *   attachmentSignedUrlSecret: process.env.BPM_ATTACHMENT_SIGNING_SECRET,
 * });
 * ```
 */
@Module({})
export class BPMRootModule {
  /**
   * Static configuration. Use this when all BPM options are known at module
   * wiring time (no async secret loading needed).
   */
  static forRoot(options: BPMRootModuleOptions): DynamicModule {
    if (options.resolverMetadataFactory) {
      applyBPMResolverMetadata(options.resolverMetadataFactory);
    }

    const featureModules = createBPMFeatureModules(options);

    return {
      exports: [...featureModules],
      imports: [...(options.imports ?? []), ...featureModules],
      module: BPMRootModule,
    };
  }

  /**
   * Async configuration. Use this when BPM options must be resolved at
   * runtime — typically when SMTP, webhook, or signature secrets are
   * loaded from Vault / KMS / a host `ConfigService`.
   *
   * Routing-time decisions such as `attachmentRoutePrefix`,
   * `memberResolverProvider`, `attachmentStorageProvider`, and
   * `workflowServiceTaskDispatcherProvider` are read from the top-level
   * options object (not from the `useFactory` return value), because
   * Nest reads controller path metadata and provider tokens synchronously
   * during application bootstrap.
   */
  static forRootAsync(options: BPMRootModuleAsyncOptions): DynamicModule {
    if (options.resolverMetadataFactory) {
      applyBPMResolverMetadata(options.resolverMetadataFactory);
    }

    const authOptions: BPMAuthModuleAsyncOptions = {
      imports: options.imports,
      inject: options.inject,
      useFactory: async (
        ...args: readonly unknown[]
      ): Promise<BPMAuthModuleOptions> => {
        const rootOptions = await options.useFactory(...args);

        return createBPMAuthModuleOptions(rootOptions);
      },
    };

    return {
      exports: [
        NotificationOptionsModule,
        CalendarModule,
        BPMAuthModule,
        IdentityModule,
        OrganizationModule,
        AttachmentModule,
        FormModule,
        FormDataSourceModule,
        TemplateModule,
        DelegationModule,
        NotificationModule,
        SignatureModule,
        WorkflowEngineModule,
      ],
      imports: [
        NotificationOptionsModule.forRootAsync({
          imports: options.imports,
          inject: options.inject,
          useFactory: options.useFactory,
        }),
        CalendarModule.forRoot({
          businessCalendarProvider: options.businessCalendarProvider,
          imports: options.imports,
        }),
        BPMAuthModule.forRootAsync(authOptions),
        IdentityModule.forRootAsync({
          identityRegisterResolvers: options.identityRegisterResolvers,
          imports: options.imports,
          inject: options.inject,
          memberResolverProvider: options.memberResolverProvider,
          useFactory: options.useFactory,
        }),
        OrganizationModule,
        AttachmentModule.forRootAsync({
          attachmentRoutePrefix: options.attachmentRoutePrefix,
          imports: options.imports,
          inject: options.inject,
          storageProvider: options.attachmentStorageProvider,
          useFactory: options.useFactory,
        }),
        FormModule,
        FormDataSourceModule.forRoot({
          imports: options.imports,
          registryProvider: options.formDataSourceRegistryProvider,
        } satisfies FormDataSourceModuleOptions),
        TemplateModule,
        DelegationModule,
        NotificationModule,
        SignatureModule.forRootAsync({
          imports: options.imports,
          inject: options.inject,
          useFactory: options.useFactory,
        }),
        WorkflowEngineModule.forRoot({
          imports: options.imports,
          serviceTaskDispatcherProvider:
            options.workflowServiceTaskDispatcherProvider,
        }),
      ],
      module: BPMRootModule,
    };
  }
}

function createBPMFeatureModules(
  options: BPMRootModuleOptions,
): BPMModuleImport[] {
  return [
    NotificationOptionsModule.forRoot(options),
    CalendarModule.forRoot({
      businessCalendarProvider: options.businessCalendarProvider,
      imports: options.imports,
    }),
    BPMAuthModule.forRoot(createBPMAuthModuleOptions(options)),
    IdentityModule.forRoot({
      ...options,
      imports: options.imports,
      memberResolverProvider: options.memberResolverProvider,
    }),
    OrganizationModule,
    AttachmentModule.forRoot({
      ...options,
      imports: options.imports,
      storageProvider: options.attachmentStorageProvider,
    }),
    FormModule,
    FormDataSourceModule.forRoot({
      imports: options.imports,
      registryProvider: options.formDataSourceRegistryProvider,
    } satisfies FormDataSourceModuleOptions),
    TemplateModule,
    DelegationModule,
    NotificationModule,
    SignatureModule.forRoot(options),
    WorkflowEngineModule.forRoot({
      imports: options.imports,
      serviceTaskDispatcherProvider:
        options.workflowServiceTaskDispatcherProvider,
    }),
  ];
}

function createBPMAuthModuleOptions(
  options: BPMRootModuleOptions | BPMRootModuleAsyncFactoryOptions,
): BPMAuthModuleOptions {
  return {
    contextFactory: options.authContextFactory,
  };
}
