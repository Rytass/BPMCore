export interface MemberMetadata {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  readonly customFields: Readonly<Record<string, unknown>>;
}

export interface MemberMetadataCacheEntry {
  readonly id: string;
  readonly memberId: string;
  readonly metadata: MemberMetadata;
  readonly fetchedAt: string;
  readonly expiresAt: string;
}
