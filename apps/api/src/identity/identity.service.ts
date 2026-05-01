import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberMetadata } from '@bpm/shared';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import {
  MEMBER_RESOLVER,
  MemberResolver,
} from './member-resolver.interface';

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(MemberMetadataCacheEntity)
    private readonly cacheRepository: Repository<MemberMetadataCacheEntity>,
    @Inject(MEMBER_RESOLVER)
    private readonly memberResolver: MemberResolver,
  ) {}

  async resolveMember(memberId: string): Promise<MemberMetadata> {
    const now = new Date();
    const cached = await this.cacheRepository.findOne({ where: { memberId } });

    if (cached && cached.expiresAt > now) {
      return cached.metadata;
    }

    const metadata = await this.memberResolver.resolve(memberId);
    const fetchedAt = now;
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const cacheEntity = cached ?? new MemberMetadataCacheEntity();
    cacheEntity.fetchedAt = fetchedAt;
    cacheEntity.expiresAt = expiresAt;
    cacheEntity.memberId = memberId;
    cacheEntity.metadata = metadata;

    await this.cacheRepository.save(cacheEntity);

    return metadata;
  }

  async resolveMembers(
    memberIds: readonly string[],
  ): Promise<readonly MemberMetadata[]> {
    const uniqueMemberIds = [...new Set(memberIds)];
    const resolved = await Promise.all(
      uniqueMemberIds.map((memberId) => this.resolveMember(memberId)),
    );
    const byId = new Map(
      resolved.map((metadata): readonly [string, MemberMetadata] => [
        metadata.memberId,
        metadata,
      ]),
    );

    return memberIds
      .map((memberId) => byId.get(memberId))
      .filter((metadata): metadata is MemberMetadata => Boolean(metadata));
  }

  async listCachedMembers(): Promise<readonly MemberMetadataCacheEntity[]> {
    return this.cacheRepository.find({ order: { memberId: 'ASC' } });
  }
}
