import { MemberMetadata } from '@bpm/shared';

export const BPM_MEMBER_RESOLVER = Symbol('BPM_MEMBER_RESOLVER');

export const MEMBER_RESOLVER = BPM_MEMBER_RESOLVER;

export interface BPMMemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}

export type MemberResolver = BPMMemberResolver;
