import { isBPMAdminMember } from './use-bpm-member';

jest.mock('./auth-provider', () => ({ useAuth: jest.fn() }));

describe('isBPMAdminMember', () => {
  it('matches the server rule: the BPM_ADMIN role or an administrator permission', () => {
    expect(isBPMAdminMember(null)).toBe(false);
    expect(isBPMAdminMember({ permissions: [], roles: ['BPM_ADMIN'] })).toBe(
      true,
    );
    expect(isBPMAdminMember({ permissions: ['bpm:admin:*'], roles: [] })).toBe(
      true,
    );
    expect(
      isBPMAdminMember({ permissions: ['bpm:design'], roles: ['REQUESTER'] }),
    ).toBe(false);
  });
});
