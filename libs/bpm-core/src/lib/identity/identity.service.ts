import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import {
  BPM_IDENTITY_OPTIONS,
  BPMResolvedIdentityOptions,
  DEFAULT_BPM_IDENTITY_OPTIONS,
} from './identity-options';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { MEMBER_RESOLVER, MemberResolver } from './member-resolver.interface';

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
    @Optional()
    @Inject(BPM_IDENTITY_OPTIONS)
    private readonly identityOptions: BPMResolvedIdentityOptions = DEFAULT_BPM_IDENTITY_OPTIONS,
  ) {}

  async resolveMember(memberId: string): Promise<MemberMetadata> {
    const now = new Date();
    const cached = await this.cacheRepository.findOne({ where: { memberId } });

    if (cached && cached.expiresAt > now) {
      return cached.metadata;
    }

    const metadata = await this.memberResolver.resolve(memberId);
    const fetchedAt = now;
    const expiresAt = new Date(
      now.getTime() + this.identityOptions.memberMetadataCacheTtlMs,
    );

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
    const uniqueMemberIds = [...new Set(memberIds)].filter(
      (memberId) => memberId.length > 0,
    );

    if (uniqueMemberIds.length === 0) {
      return [];
    }

    const now = new Date();
    const cachedRows = await this.cacheRepository.find({
      where: { memberId: In([...uniqueMemberIds]) },
    });
    const cacheEntityByMemberId = new Map(
      cachedRows.map((row): readonly [string, MemberMetadataCacheEntity] => [
        row.memberId,
        row,
      ]),
    );
    const metadataByMemberId = new Map<string, MemberMetadata>();
    const staleMemberIds: string[] = [];

    for (const memberId of uniqueMemberIds) {
      const cached = cacheEntityByMemberId.get(memberId);

      if (cached && cached.expiresAt > now) {
        metadataByMemberId.set(memberId, cached.metadata);
      } else {
        staleMemberIds.push(memberId);
      }
    }

    if (staleMemberIds.length > 0) {
      const resolvedMap =
        await this.memberResolver.resolveMany(staleMemberIds);
      const expiresAt = new Date(
        now.getTime() + this.identityOptions.memberMetadataCacheTtlMs,
      );
      const entitiesToSave: MemberMetadataCacheEntity[] = [];

      for (const memberId of staleMemberIds) {
        const metadata = resolvedMap.get(memberId);

        if (!metadata) {
          continue;
        }

        const cacheEntity =
          cacheEntityByMemberId.get(memberId) ??
          new MemberMetadataCacheEntity();

        cacheEntity.memberId = memberId;
        cacheEntity.metadata = metadata;
        cacheEntity.fetchedAt = now;
        cacheEntity.expiresAt = expiresAt;

        entitiesToSave.push(cacheEntity);
        metadataByMemberId.set(memberId, metadata);
      }

      if (entitiesToSave.length > 0) {
        await this.cacheRepository.save(entitiesToSave);
      }
    }

    return memberIds
      .map((memberId) => metadataByMemberId.get(memberId))
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
