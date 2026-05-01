import { Repository } from 'typeorm';
import { MemberMetadata } from '@bpm/shared';
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
      positionId: null,
      primaryOrgUnitId: null,
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
});
