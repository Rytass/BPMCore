import { InjectionToken, Provider } from '@nestjs/common';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { BPMAuthContext } from '../bpm-auth';
import {
  BPMMemberResolver,
  BPMMemberSearchPage,
  BPMMemberSearchPageOptions,
} from './member-resolver.interface';

/**
 * Structural contract a host identity backend should implement (or a thin
 * adapter wrap) so BPM can be plugged into any `member-base`-style
 * directory without coupling `@rytass/bpm-core-nestjs-module` to a
 * specific identity package.
 *
 * `TMember` is the host's own member shape; the adapter walks it through
 * {@link BPMMemberBaseAdapterOptions} field readers.
 */
export interface BPMMemberBaseDirectory<TMember> {
  readonly resolveMember: (memberId: string) => Promise<TMember | null>;
  readonly resolveMembers?: (
    memberIds: readonly string[],
  ) => Promise<readonly TMember[]>;
  readonly searchMembers?: (searchText: string) => Promise<readonly TMember[]>;
  /**
   * Optional paged directory search. Implement this (in addition to, or
   * instead of, `searchMembers`) to let BPM page through a directory
   * larger than `searchMembers`' member-picker cap and report an
   * accurate total on the admin members list. `page` is 1-based and
   * already normalized/clamped by BPM. Return the requested slice as
   * `items` and the full match count as `total`. When omitted, the
   * adapter's `searchPaged` stays `undefined` and BPM falls back to the
   * `searchMembers`-and-slice path.
   */
  readonly searchMembersPaged?: (
    searchText: string,
    options: BPMMemberSearchPageOptions,
  ) => Promise<BPMMemberBaseSearchPage<TMember>>;
}

/**
 * Host-shaped page returned by
 * {@link BPMMemberBaseDirectory.searchMembersPaged}. The adapter maps
 * each `TMember` in `items` through the field readers into
 * {@link MemberMetadata} and forwards `total` unchanged.
 */
export interface BPMMemberBaseSearchPage<TMember> {
  readonly items: readonly TMember[];
  readonly total: number;
}

/**
 * Per-host field readers that tell the adapter how to extract canonical
 * BPM fields out of the host's `TMember`. Each reader is optional;
 * sensible defaults are inferred when the host uses common conventions
 * (`memberId` / `id` / `sub` for the member id, `email` for the email,
 * `name` / `displayName` for the name, etc.).
 *
 * Provide `readPermissions` and `readRoles` if you want BPM's
 * `BPMAdminGuard` / `BPMDesignerGuard` to receive the host's RBAC
 * strings; otherwise the resolved `BPMAuthContext` will carry empty
 * arrays.
 */
export interface BPMMemberBaseAdapterOptions<TMember> {
  readonly readCustomFields?: (
    member: TMember,
  ) => Readonly<Record<string, unknown>>;
  readonly readEmail?: (member: TMember) => string | null;
  readonly readMemberId?: (member: TMember) => string | null;
  readonly readName?: (member: TMember) => string | null;
  readonly readPermissions?: (member: TMember) => readonly string[];
  readonly readRoles?: (member: TMember) => readonly string[];
}

export interface BPMMemberBaseResolverProviderOptions<TMember> {
  readonly adapterOptions?: BPMMemberBaseAdapterOptions<TMember>;
  readonly directoryToken: InjectionToken<BPMMemberBaseDirectory<TMember>>;
  readonly provide: InjectionToken<BPMMemberResolver>;
}

export class BPMMemberBaseResolverAdapter<TMember>
  implements BPMMemberResolver
{
  /**
   * Present only when the wrapped directory implements
   * `searchMembersPaged`. Left `undefined` otherwise so `IdentityService`
   * capability detection falls back to the `search`-and-slice path,
   * preserving pre-0.5.0 behavior.
   */
  readonly searchPaged?: (
    searchText: string,
    options: BPMMemberSearchPageOptions,
  ) => Promise<BPMMemberSearchPage>;

  constructor(
    private readonly directory: BPMMemberBaseDirectory<TMember>,
    private readonly options: BPMMemberBaseAdapterOptions<TMember> = {},
  ) {
    const searchMembersPaged = directory.searchMembersPaged;

    if (searchMembersPaged) {
      this.searchPaged = async (
        searchText: string,
        pageOptions: BPMMemberSearchPageOptions,
      ): Promise<BPMMemberSearchPage> => {
        const page = await searchMembersPaged(searchText, pageOptions);

        return {
          items: page.items.map((member): MemberMetadata =>
            readMemberMetadataFromMemberBaseMember(member, this.options),
          ),
          total: page.total,
        };
      };
    }
  }

  async resolve(memberId: string): Promise<MemberMetadata> {
    const member = await this.directory.resolveMember(memberId);

    if (!member) {
      throw new Error(`member-base member ${memberId} was not found`);
    }

    return readMemberMetadataFromMemberBaseMember(member, this.options);
  }

  async resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>> {
    const members = this.directory.resolveMembers
      ? await this.directory.resolveMembers(memberIds)
      : await Promise.all(
          memberIds.map((memberId): Promise<TMember | null> =>
            this.directory.resolveMember(memberId),
          ),
        );

    return members
      .filter((member): member is TMember => Boolean(member))
      .map((member): MemberMetadata =>
        readMemberMetadataFromMemberBaseMember(member, this.options),
      )
      .reduce<ReadonlyMap<string, MemberMetadata>>(
        (metadataByMemberId, metadata): ReadonlyMap<string, MemberMetadata> =>
          new Map(metadataByMemberId).set(metadata.memberId, metadata),
        new Map(),
      );
  }

  async search(searchText: string): Promise<readonly MemberMetadata[]> {
    if (!this.directory.searchMembers) {
      return [];
    }

    return (await this.directory.searchMembers(searchText)).map(
      (member): MemberMetadata =>
        readMemberMetadataFromMemberBaseMember(member, this.options),
    );
  }
}

/**
 * Helper for hosts that already hold an authenticated `TMember` (for
 * example from `@rytass/member-base-nestjs-module`) and want to project it
 * into a {@link BPMAuthContext} without writing the boilerplate by hand.
 *
 * Returns `null` when the input is nullish or when the member is missing
 * an id — never throws. Pair this with `BPMRootModuleOptions.authContextFactory`
 * so BPM resolvers receive the projected context on every request.
 *
 * @example
 * ```ts
 * const bpmAuth = createBPMAuthContextFromMemberBaseMember(memberBaseUser, {
 *   readRoles: (m) => m.roles,
 *   readPermissions: (m) => m.permissions,
 *   readCustomFields: (m) => ({ tenantId: m.tenantId }),
 * });
 * ```
 */
export function createBPMAuthContextFromMemberBaseMember<TMember>(
  member: TMember | null | undefined,
  options: BPMMemberBaseAdapterOptions<TMember> = {},
): BPMAuthContext | null {
  if (!member) {
    return null;
  }

  const memberId = readMemberId(member, options);

  return memberId
    ? {
        memberId,
        metadata: options.readCustomFields?.(member) ?? {},
        permissions: options.readPermissions?.(member) ?? [],
        roles: options.readRoles?.(member) ?? [],
      }
    : null;
}

/**
 * Builds a Nest `Provider` that adapts a host-provided
 * {@link BPMMemberBaseDirectory} into a {@link BPMMemberResolver}, then
 * registers it under the host-chosen injection token (typically
 * {@link BPM_MEMBER_RESOLVER}).
 *
 * Pass the result inside `BPMRootModuleOptions.memberResolverProvider`.
 *
 * @example
 * ```ts
 * BPMRootModule.forRoot({
 *   memberResolverProvider: createBPMMemberBaseResolverProvider({
 *     provide: BPM_MEMBER_RESOLVER,
 *     directoryToken: HOST_MEMBER_DIRECTORY,
 *     adapterOptions: {
 *       readEmail: (m) => m.email,
 *       readName: (m) => m.name,
 *     },
 *   }),
 *   // ...
 * });
 * ```
 */
export function createBPMMemberBaseResolverProvider<TMember>({
  adapterOptions,
  directoryToken,
  provide,
}: BPMMemberBaseResolverProviderOptions<TMember>): Provider<BPMMemberResolver> {
  return {
    inject: [directoryToken],
    provide,
    useFactory: (
      directory: BPMMemberBaseDirectory<TMember>,
    ): BPMMemberResolver =>
      new BPMMemberBaseResolverAdapter(directory, adapterOptions),
  };
}

export function readMemberMetadataFromMemberBaseMember<TMember>(
  member: TMember,
  options: BPMMemberBaseAdapterOptions<TMember> = {},
): MemberMetadata {
  const memberId = readMemberId(member, options);

  if (!memberId) {
    throw new Error('member-base member id is required for BPM integration');
  }

  return {
    customFields: options.readCustomFields?.(member) ?? {},
    email: readMemberEmail(member, options) ?? '',
    memberId,
    name: readMemberName(member, options) ?? memberId,
  };
}

function readMemberId<TMember>(
  member: TMember,
  options: BPMMemberBaseAdapterOptions<TMember>,
): string | null {
  return (
    normalizeText(options.readMemberId?.(member)) ??
    readStringProperty(member, 'memberId') ??
    readStringProperty(member, 'id') ??
    readStringProperty(member, 'sub')
  );
}

function readMemberEmail<TMember>(
  member: TMember,
  options: BPMMemberBaseAdapterOptions<TMember>,
): string | null {
  return normalizeText(options.readEmail?.(member)) ?? readStringProperty(member, 'email');
}

function readMemberName<TMember>(
  member: TMember,
  options: BPMMemberBaseAdapterOptions<TMember>,
): string | null {
  return (
    normalizeText(options.readName?.(member)) ??
    readStringProperty(member, 'name') ??
    readStringProperty(member, 'displayName') ??
    readMemberEmail(member, options)
  );
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return normalizeText(value[key]);
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
