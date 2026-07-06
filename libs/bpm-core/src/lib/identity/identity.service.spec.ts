import { Repository } from 'typeorm';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { IdentityService } from './identity.service';
import {
  BPMMemberBaseDirectory,
  BPMMemberBaseResolverAdapter,
  BPMMemberBaseSearchPage,
} from './member-base.adapter';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import { MemberResolver } from './member-resolver.interface';

interface DirectoryMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}

function createDirectoryMembers(count: number): readonly DirectoryMember[] {
  return Array.from({ length: count }, (_unused, index): DirectoryMember => {
    const id = `member-${String(index + 1).padStart(4, '0')}`;

    return { email: `${id}@example.internal`, id, name: id };
  });
}

function matchDirectoryMembers(
  members: readonly DirectoryMember[],
  searchText: string,
): readonly DirectoryMember[] {
  const normalized = searchText.trim().toLocaleLowerCase();

  if (!normalized) {
    return members;
  }

  return members.filter((member) =>
    [member.email, member.id, member.name].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

function createCacheRepository(): Repository<MemberMetadataCacheEntity> {
  return {
    find: jest.fn<Promise<MemberMetadataCacheEntity[]>, []>(() =>
      Promise.resolve([]),
    ),
    findOne: jest.fn(),
    save: jest.fn((entity: unknown): Promise<unknown> => Promise.resolve(entity)),
  } as unknown as Repository<MemberMetadataCacheEntity>;
}

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

  it('delegates real pagination and total counting to a searchMembersPaged directory', async (): Promise<void> => {
    const directoryMembers = createDirectoryMembers(1000);
    const searchMembers = jest.fn<
      Promise<readonly DirectoryMember[]>,
      [string]
    >((searchText) =>
      Promise.resolve(matchDirectoryMembers(directoryMembers, searchText)),
    );
    const searchMembersPaged = jest.fn<
      Promise<BPMMemberBaseSearchPage<DirectoryMember>>,
      [string, { readonly page: number; readonly pageSize: number }]
    >((searchText, options) => {
      const matched = matchDirectoryMembers(directoryMembers, searchText);
      const offset = (options.page - 1) * options.pageSize;

      return Promise.resolve({
        items: matched.slice(offset, offset + options.pageSize),
        total: matched.length,
      });
    });
    const directory: BPMMemberBaseDirectory<DirectoryMember> = {
      resolveMember: (memberId): Promise<DirectoryMember | null> =>
        Promise.resolve(
          directoryMembers.find((member) => member.id === memberId) ?? null,
        ),
      searchMembers,
      searchMembersPaged,
    };
    const resolver = new BPMMemberBaseResolverAdapter<DirectoryMember>(
      directory,
    );
    const service = new IdentityService(createCacheRepository(), resolver);

    const firstPage = await service.searchMembers('', {
      page: 1,
      pageSize: 50,
    });
    expect(firstPage).toHaveLength(50);
    expect(firstPage[0]?.memberId).toBe('member-0001');
    expect(firstPage[49]?.memberId).toBe('member-0050');

    const secondPage = await service.searchMembers('', {
      page: 2,
      pageSize: 50,
    });
    expect(secondPage).toHaveLength(50);
    expect(secondPage[0]?.memberId).toBe('member-0051');

    const lastPage = await service.searchMembers('', {
      page: 20,
      pageSize: 50,
    });
    expect(lastPage).toHaveLength(50);
    expect(lastPage[49]?.memberId).toBe('member-1000');

    await expect(service.countMembers('')).resolves.toBe(1000);

    // The full ~50-cap picker search must never back the listing page.
    expect(searchMembers).not.toHaveBeenCalled();
  });

  it('stays backwards-compatible when the directory only implements the ~50-cap search', async (): Promise<void> => {
    const directoryMembers = createDirectoryMembers(1000);
    const cappedSearch = jest.fn<
      Promise<readonly DirectoryMember[]>,
      [string]
    >((searchText) =>
      Promise.resolve(
        matchDirectoryMembers(directoryMembers, searchText).slice(0, 50),
      ),
    );
    const directory: BPMMemberBaseDirectory<DirectoryMember> = {
      resolveMember: (memberId): Promise<DirectoryMember | null> =>
        Promise.resolve(
          directoryMembers.find((member) => member.id === memberId) ?? null,
        ),
      searchMembers: cappedSearch,
    };
    const resolver = new BPMMemberBaseResolverAdapter<DirectoryMember>(
      directory,
    );

    expect(resolver.searchPaged).toBeUndefined();

    const service = new IdentityService(createCacheRepository(), resolver);

    const firstPage = await service.searchMembers('', {
      page: 1,
      pageSize: 50,
    });
    expect(firstPage).toHaveLength(50);

    // Pre-0.5.0 behavior: pages beyond the ~50 cap are empty rather than
    // throwing, and the total is capped by whatever `search` returned.
    const secondPage = await service.searchMembers('', {
      page: 2,
      pageSize: 50,
    });
    expect(secondPage).toHaveLength(0);

    await expect(service.countMembers('')).resolves.toBe(50);
  });

  it('backfills the per-id cache from a paged search, deduping ids and reusing existing rows', async (): Promise<void> => {
    // A page that repeats member-0001 — the backfill must collapse it to one row.
    const pageItems: readonly MemberMetadata[] = [
      readMemberMetadata('member-0001'),
      readMemberMetadata('member-0002'),
      readMemberMetadata('member-0001'),
    ];
    const existingRow = {
      expiresAt: new Date(Date.now() - 60_000),
      fetchedAt: new Date(Date.now() - 120_000),
      id: 'existing-cache-row',
      memberId: 'member-0001',
      metadata: readMemberMetadata('member-0001'),
    } as MemberMetadataCacheEntity;
    const find = jest.fn<Promise<MemberMetadataCacheEntity[]>, []>(() =>
      Promise.resolve([existingRow]),
    );
    const save = jest.fn(
      (entities: unknown): Promise<unknown> => Promise.resolve(entities),
    );
    const cacheRepository = {
      find,
      findOne: jest.fn(),
      save,
    } as unknown as Repository<MemberMetadataCacheEntity>;
    const resolver: MemberResolver = {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
      searchPaged: jest.fn(() =>
        Promise.resolve({ items: pageItems, total: 2 }),
      ),
    };
    const service = new IdentityService(cacheRepository, resolver);

    await service.searchMembers('', { page: 1, pageSize: 50 });

    expect(save).toHaveBeenCalledTimes(1);
    const savedEntities = save.mock.calls[0]?.[0] as MemberMetadataCacheEntity[];
    // Duplicate member-0001 collapsed → exactly two rows written.
    expect(savedEntities).toHaveLength(2);
    expect(savedEntities.map((entity) => entity.memberId)).toEqual([
      'member-0001',
      'member-0002',
    ]);
    // Existing row reused by id (update, not insert); the new id has none.
    expect(savedEntities[0]?.id).toBe('existing-cache-row');
    expect(savedEntities[1]?.id).toBeUndefined();
  });

  it('skips cache backfill entirely when a paged search returns no items', async (): Promise<void> => {
    const find = jest.fn<Promise<MemberMetadataCacheEntity[]>, []>(() =>
      Promise.resolve([]),
    );
    const save = jest.fn();
    const cacheRepository = {
      find,
      findOne: jest.fn(),
      save,
    } as unknown as Repository<MemberMetadataCacheEntity>;
    const resolver: MemberResolver = {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
      searchPaged: jest.fn(() => Promise.resolve({ items: [], total: 0 })),
    };
    const service = new IdentityService(cacheRepository, resolver);

    await expect(
      service.searchMembers('no-match', { page: 1, pageSize: 50 }),
    ).resolves.toEqual([]);

    expect(find).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
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
