import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberMetadata } from '@bpm/shared';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { MEMBER_RESOLVER, MemberResolver } from './member-resolver.interface';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MEMBER_PAGE = 1;
const DEFAULT_MEMBER_PAGE_SIZE = 10;
const MAX_MEMBER_PAGE_SIZE = 100;

interface SearchMembersOptions {
  readonly page?: number;
  readonly pageSize?: number;
}

const normalizePage = (page?: number): number =>
  Number.isInteger(page) && page !== undefined && page > 0
    ? page
    : DEFAULT_MEMBER_PAGE;

const normalizePageSize = (pageSize?: number): number => {
  if (!Number.isInteger(pageSize) || pageSize === undefined || pageSize <= 0) {
    return DEFAULT_MEMBER_PAGE_SIZE;
  }

  return Math.min(pageSize, MAX_MEMBER_PAGE_SIZE);
};

const paginateMembers = (
  members: readonly MemberMetadata[],
  options: SearchMembersOptions,
): readonly MemberMetadata[] => {
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const offset = (page - 1) * pageSize;

  return members.slice(offset, offset + pageSize);
};

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

  async countMembers(searchText: string): Promise<number> {
    const members = await this.searchAllMembers(searchText);

    return members.length;
  }

  async searchMembers(
    searchText: string,
    options: SearchMembersOptions = {},
  ): Promise<readonly MemberMetadata[]> {
    const members = await this.searchAllMembers(searchText);

    if (options.page === undefined && options.pageSize === undefined) {
      return members;
    }

    return paginateMembers(members, options);
  }

  private async searchAllMembers(
    searchText: string,
  ): Promise<readonly MemberMetadata[]> {
    if (this.memberResolver.search) {
      return this.memberResolver.search(searchText);
    }

    const normalizedSearchText = searchText.trim().toLocaleLowerCase();
    const cachedMembers = await this.listCachedMembers();

    return cachedMembers
      .map((member) => member.metadata)
      .filter((metadata) => {
        if (!normalizedSearchText) {
          return true;
        }

        return [metadata.email, metadata.memberId, metadata.name].some(
          (value) => value.toLocaleLowerCase().includes(normalizedSearchText),
        );
      });
  }
}
