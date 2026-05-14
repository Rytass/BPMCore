import { InjectionToken, Provider } from '@nestjs/common';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { BPMAuthContext } from '../bpm-auth';
import { BPMMemberResolver } from './member-resolver.interface';

export interface BPMMemberBaseDirectory<TMember> {
  readonly resolveMember: (memberId: string) => Promise<TMember | null>;
  readonly resolveMembers?: (
    memberIds: readonly string[],
  ) => Promise<readonly TMember[]>;
  readonly searchMembers?: (searchText: string) => Promise<readonly TMember[]>;
}

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
  constructor(
    private readonly directory: BPMMemberBaseDirectory<TMember>,
    private readonly options: BPMMemberBaseAdapterOptions<TMember> = {},
  ) {}

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
