import {
  DynamicModule,
  InjectionToken,
  Module,
  Provider,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityQueries } from './identity.queries';
import { IdentityService } from './identity.service';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { BPMMemberResolver } from './member-resolver.interface';
import {
  BPM_IDENTITY_OPTIONS,
  BPMRootIdentityOptions,
  resolveBPMIdentityOptions,
} from './identity-options';

export interface IdentityModuleOptions extends BPMRootIdentityOptions {
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
}

export interface IdentityModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMRootIdentityOptions | Promise<BPMRootIdentityOptions>;
}

@Module({})
export class IdentityModule {
  static forRoot(options: IdentityModuleOptions): DynamicModule {
    const resolverProviders = createMemberResolverProviders(options);

    return {
      exports: [IdentityService],
      imports: [TypeOrmModule.forFeature([MemberMetadataCacheEntity])],
      module: IdentityModule,
      providers: [
        IdentityQueries,
        IdentityService,
        ...resolverProviders,
        createIdentityOptionsProvider(options),
      ],
    };
  }

  static forRootAsync(options: IdentityModuleAsyncOptions): DynamicModule {
    const resolverProviders = createMemberResolverProviders(options);

    return {
      exports: [IdentityService],
      imports: [
        ...(options.imports ?? []),
        TypeOrmModule.forFeature([MemberMetadataCacheEntity]),
      ],
      module: IdentityModule,
      providers: [
        IdentityQueries,
        IdentityService,
        ...resolverProviders,
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_IDENTITY_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<ReturnType<typeof resolveBPMIdentityOptions>> =>
            resolveBPMIdentityOptions(await options.useFactory(...args)),
        },
      ],
    };
  }
}

function createMemberResolverProviders(
  options: IdentityModuleOptions,
): readonly Provider[] {
  return [options.memberResolverProvider];
}

function createIdentityOptionsProvider(
  options: BPMRootIdentityOptions = {},
): Provider {
  return {
    provide: BPM_IDENTITY_OPTIONS,
    useValue: resolveBPMIdentityOptions(options),
  };
}
