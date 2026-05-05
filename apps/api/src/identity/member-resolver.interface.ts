import { MemberMetadata } from '@bpm/shared';

export const MEMBER_RESOLVER = Symbol('MEMBER_RESOLVER');

export interface MemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(memberIds: readonly string[]): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}
