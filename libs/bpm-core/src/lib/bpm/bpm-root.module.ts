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
import { OrganizationModule } from '../organization/organization.module';
import { SignatureModule } from '../signature/signature.module';
import { TemplateModule } from '../template/template.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';

type BPMModuleImport = DynamicModule | Type<unknown>;

export interface BPMRootModuleOptions {
  readonly auth?: BPMAuthModuleOptions;
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
}

export interface BPMRootModuleAsyncFactoryOptions {
  readonly auth?: BPMAuthModuleOptions;
}

export interface BPMRootModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
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

        return rootOptions.auth ?? {};
      },
    };

    return {
      exports: [
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
    BPMAuthModule.forRoot(options.auth),
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
