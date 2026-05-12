import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityQueries } from './identity.queries';
import { IdentityService } from './identity.service';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { BPMMemberResolver } from './member-resolver.interface';

export interface IdentityModuleOptions {
  readonly memberResolverProvider: Provider<BPMMemberResolver>;
}

@Module({})
export class IdentityModule {
  static forRoot(options: IdentityModuleOptions): DynamicModule {
    const resolverProviders = createMemberResolverProviders(options);

    return {
      exports: [IdentityService],
      imports: [TypeOrmModule.forFeature([MemberMetadataCacheEntity])],
      module: IdentityModule,
      providers: [IdentityQueries, IdentityService, ...resolverProviders],
    };
  }
}

function createMemberResolverProviders(
  options: IdentityModuleOptions,
): readonly Provider[] {
  return [options.memberResolverProvider];
}
