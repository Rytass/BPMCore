import { ApiMemberResolver } from './api-member.resolver';

describe('ApiMemberResolver', () => {
  const resolver = new ApiMemberResolver();

  it('resolves known demo members', async (): Promise<void> => {
    await expect(resolver.resolve('member-001')).resolves.toMatchObject({
      email: 'lin.ceo@example.internal',
      memberId: 'member-001',
      name: '林執行長',
    });
  });

  it('searches demo members by email or member id', async (): Promise<void> => {
    await expect(resolver.search('cfo')).resolves.toEqual([
      expect.objectContaining({ memberId: 'member-101' }),
    ]);
  });
});
