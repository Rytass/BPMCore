import {
  DynamicModule,
  InjectionToken,
  Module,
  Provider,
  Type,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { AttachmentModule } from '../attachment/attachment.module';
import { BPMAuthModule } from '../bpm-auth/bpm-auth.module';
import {
  BPMAuthModuleAsyncOptions,
  BPMAuthModuleOptions,
} from '../bpm-auth/bpm-auth.options';
import { DelegationModule } from '../delegation/delegation.module';
import { FormModule } from '../form/form.module';
import { IdentityModule } from '../identity/identity.module';
import { BPMMemberResolver } from '../identity/member-resolver.interface';
import { NotificationModule } from '../notification/notification.module';
import { NotificationOptionsModule } from '../notification/notification-options.module';
import { BPMRootNotificationOptions } from '../notification/notification-options';
import { OrganizationModule } from '../organization/organization.module';
import { SignatureModule } from '../signature/signature.module';
import { TemplateModule } from '../template/template.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';

type BPMModuleImport = DynamicModule | Type<unknown>;

export interface BPMRootModuleOptions extends BPMRootNotificationOptions {
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
   * Host-provided member resolver provider.
   *
   * BPM uses this provider to resolve member metadata, organization identity,
   * display names, and approver candidates without coupling `@bpm/core` to a
   * specific external identity system.
   */
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
}

export interface BPMRootModuleAsyncFactoryOptions extends BPMRootNotificationOptions {
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
   * display names, and approver candidates without coupling `@bpm/core` to a
   * specific external identity system.
   */
  readonly memberResolverProvider: Provider<BPMMemberResolver>;

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

@Module({})
export class BPMRootModule {
  static forRoot(options: BPMRootModuleOptions): DynamicModule {
    return {
      exports: [...createBPMFeatureModules(options)],
      imports: createBPMFeatureModules(options),
      module: BPMRootModule,
    };
  }

  static forRootAsync(options: BPMRootModuleAsyncOptions): DynamicModule {
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
        BPMAuthModule,
        IdentityModule,
        OrganizationModule,
        AttachmentModule,
        FormModule,
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
        BPMAuthModule.forRootAsync(authOptions),
        IdentityModule.forRoot({
          memberResolverProvider: options.memberResolverProvider,
        }),
        OrganizationModule,
        AttachmentModule,
        FormModule,
        TemplateModule,
        DelegationModule,
        NotificationModule,
        SignatureModule,
        WorkflowEngineModule,
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
    BPMAuthModule.forRoot(createBPMAuthModuleOptions(options)),
    IdentityModule.forRoot({
      memberResolverProvider: options.memberResolverProvider,
    }),
    OrganizationModule,
    AttachmentModule,
    FormModule,
    TemplateModule,
    DelegationModule,
    NotificationModule,
    SignatureModule,
    WorkflowEngineModule,
  ];
}

function createBPMAuthModuleOptions(
  options: BPMRootModuleOptions | BPMRootModuleAsyncFactoryOptions,
): BPMAuthModuleOptions {
  return {
    contextFactory: options.authContextFactory,
  };
}
