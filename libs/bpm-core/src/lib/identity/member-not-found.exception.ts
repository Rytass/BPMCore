/**
 * Thrown by `BPMMemberResolver.resolve(memberId)` when the host's user
 * directory has no entry for the requested id. BPM surfaces the error
 * as a GraphQL `errors[]` entry on whichever query triggered the
 * lookup; the caller receives a structured response rather than a
 * synthetic placeholder member.
 *
 * Note: `BPMMemberResolver.resolveMany(ids)` has the **opposite**
 * contract — unknown ids are silently omitted from the returned `Map`.
 * Use this exception only inside the single-id `resolve` path.
 *
 * Hosts may throw any `Error` subclass; this class is provided as a
 * recommended default so error messages stay consistent in BPM's logs.
 */
export class MemberNotFoundException extends Error {
  readonly memberId: string;

  constructor(memberId: string, message?: string) {
    super(message ?? `BPM member not found: ${memberId}`);
    this.name = 'MemberNotFoundException';
    this.memberId = memberId;
  }
}
