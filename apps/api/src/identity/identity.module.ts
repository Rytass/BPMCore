import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityQueries } from './identity.queries';
import { IdentityService } from './identity.service';
import { LocalMockMemberResolver } from './local-mock-member.resolver';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { MEMBER_RESOLVER } from './member-resolver.interface';

@Module({
  imports: [TypeOrmModule.forFeature([MemberMetadataCacheEntity])],
  providers: [
    IdentityQueries,
    IdentityService,
    LocalMockMemberResolver,
    {
      provide: MEMBER_RESOLVER,
      useExisting: LocalMockMemberResolver,
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
