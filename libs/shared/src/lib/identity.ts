export interface MemberMetadata {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  /**
   * Opaque host-shaped JSON. BPM stores the object verbatim, serializes
   * it back to GraphQL clients as `MemberProfile.customFieldsJson`, and
   * never introspects keys — anything the host puts here flows through
   * unchanged. Hosts using `createBPMMemberBaseResolverProvider` populate
   * this field via the `options.readCustomFields?.(member)` hook;
   * standalone `BPMMemberResolver` implementations return whatever shape
   * the consumer UI needs. Use it as a side channel for picker labels,
   * org context strings, avatar URLs, or any other host-specific
   * metadata that should appear in member-display UIs.
   */
  readonly customFields: Readonly<Record<string, unknown>>;
}

export interface MemberMetadataCacheEntry {
  readonly id: string;
  readonly memberId: string;
  readonly metadata: MemberMetadata;
  readonly fetchedAt: string;
  readonly expiresAt: string;
}
