import { Injectable, Provider } from '@nestjs/common';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from './member-resolver.interface';

/**
 * Built-in {@link BPMMemberResolver} used when the host registers none.
 *
 * BPM only ever knows `memberId` strings, so a host that has not wired its own
 * identity system still needs *something* to answer "what is this member
 * called?". This resolver answers with the id itself: every BPM screen keeps
 * working, member pickers fall back to id-only entry, and nothing throws.
 *
 * It is a placeholder, not an identity system — names are raw ids and emails
 * are empty, so email notifications addressed through it go nowhere. Hosts
 * replace it through `BPMRootModuleOptions.memberResolver` (an instance, also
 * available from the `forRootAsync` factory) or `memberResolverProvider` (a
 * Nest provider) as soon as they have a real member directory.
 *
 * Using it outside `development` / `test` logs one warning at construction —
 * the same tier as the built-in attachment signing key — because a staging or
 * production host showing raw UUIDs in every approval history is a wiring
 * mistake, not a deliberate configuration.
 */
@Injectable()
export class DefaultBPMMemberResolver implements BPMMemberResolver {
  constructor() {
    if (
      process.env.NODE_ENV !== 'development' &&
      process.env.NODE_ENV !== 'test'
    ) {
      console.warn(
        '[@rytass/bpm-core-nestjs-module] no member resolver is registered, so BPM is resolving every member to its own id — display names show raw ids and member emails are empty. Set BPMRootModuleOptions.memberResolver (or memberResolverProvider) to the host identity source.',
      );
    }
  }

  async resolve(memberId: string): Promise<MemberMetadata> {
    return createPlaceholderMemberMetadata(memberId);
  }

  async resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>> {
    return new Map(
      memberIds.map((memberId: string): readonly [string, MemberMetadata] => [
        memberId,
        createPlaceholderMemberMetadata(memberId),
      ]),
    );
  }
}

/**
 * The placeholder profile BPM shows for a member it cannot name.
 *
 * `resolveMany` deliberately answers for **every** requested id rather than
 * omitting unknown ones: this resolver has no directory to check against, so
 * omitting would render every member as deleted/anonymized instead of showing
 * the id the caller already has.
 */
function createPlaceholderMemberMetadata(memberId: string): MemberMetadata {
  return {
    customFields: {},
    email: '',
    memberId,
    name: memberId,
  };
}

/**
 * Default member resolver used when the host registers none.
 *
 * Prefers a resolver handed to `BPMRootModule` as a runtime value
 * (`memberResolver`, which a `forRootAsync` factory can build once its
 * directory client is configured) and otherwise falls back to
 * {@link DefaultBPMMemberResolver}.
 *
 * `BPM_ROOT_OPTIONS` is injected optionally so `IdentityModule` still resolves
 * when it is used on its own, outside `BPMRootModule`.
 */
export const defaultMemberResolverProvider: Provider<BPMMemberResolver> = {
  inject: [{ optional: true, token: BPM_ROOT_OPTIONS }],
  provide: BPM_MEMBER_RESOLVER,
  useFactory: (
    rootOptions: BPMRootRuntimeOptions | undefined,
  ): BPMMemberResolver =>
    rootOptions?.memberResolver ?? new DefaultBPMMemberResolver(),
};
