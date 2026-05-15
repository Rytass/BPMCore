import { Repository } from 'typeorm';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { IdentityService } from './identity.service';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { MemberResolver } from './member-resolver.interface';

describe('IdentityService', () => {
  it('returns fresh cache entries without calling resolver', async (): Promise<void> => {
    const cachedMetadata: MemberMetadata = {
      customFields: {},
      email: 'cached@example.internal',
      memberId: 'member-1',
      name: 'Cached Member',
    };
    const cacheRepository = {
      findOne: jest.fn<Promise<MemberMetadataCacheEntity | null>, []>(() =>
        Promise.resolve({
          expiresAt: new Date(Date.now() + 60_000),
          fetchedAt: new Date(),
          id: 'cache-1',
          memberId: 'member-1',
          metadata: cachedMetadata,
        }),
      ),
      save: jest.fn(),
    } as unknown as Repository<MemberMetadataCacheEntity>;
    const resolver: MemberResolver = {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
    };
    const service = new IdentityService(cacheRepository, resolver);

    await expect(service.resolveMember('member-1')).resolves.toEqual(
      cachedMetadata,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('paginates member search results while keeping a full count', async (): Promise<void> => {
    const members: readonly MemberMetadata[] = [
      readMemberMetadata('member-1'),
      readMemberMetadata('member-2'),
      readMemberMetadata('member-3'),
    ];
    const cacheRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as Repository<MemberMetadataCacheEntity>;
    const resolver: MemberResolver = {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
      search: jest.fn<Promise<readonly MemberMetadata[]>, [string]>(() =>
        Promise.resolve(members),
      ),
    };
    const service = new IdentityService(cacheRepository, resolver);

    await expect(
      service.searchMembers('', { page: 2, pageSize: 2 }),
    ).resolves.toEqual([members[2]]);
    await expect(service.countMembers('')).resolves.toBe(3);
  });

  it('uses configured member metadata cache TTL for refreshed members', async (): Promise<void> => {
    const cacheRepository = {
      findOne: jest.fn<Promise<MemberMetadataCacheEntity | null>, []>(() =>
        Promise.resolve(null),
      ),
      save: jest.fn(
        (
          entity: MemberMetadataCacheEntity,
        ): Promise<MemberMetadataCacheEntity> => Promise.resolve(entity),
      ),
    } as unknown as Repository<MemberMetadataCacheEntity> & {
      readonly save: jest.Mock;
    };
    const resolver: MemberResolver = {
      resolve: jest.fn<Promise<MemberMetadata>, [string]>((memberId) =>
        Promise.resolve(readMemberMetadata(memberId)),
      ),
      resolveMany: jest.fn(),
    };
    const service = new IdentityService(cacheRepository, resolver, {
      memberMetadataCacheTtlMs: 1_000,
    });

    await service.resolveMember('member-1');

    const savedEntity = cacheRepository.save.mock
      .calls[0]?.[0] as MemberMetadataCacheEntity;
    expect(
      savedEntity.expiresAt.getTime() - savedEntity.fetchedAt.getTime(),
    ).toBe(1_000);
  });
});

function readMemberMetadata(memberId: string): MemberMetadata {
  return {
    customFields: {},
    email: `${memberId}@example.internal`,
    memberId,
    name: memberId,
  };
}
