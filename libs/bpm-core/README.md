# @rytass/bpm-core-nestjs-module

Embeddable NestJS module for BPM approval workflows.

This package provides the backend BPM domain layer: GraphQL resolvers, TypeORM
entities, migrations, workflow execution, approval tasks, form definitions,
approval templates, organization/member lookup contracts, delegation,
notifications, SLA handling, attachments, and decision signatures.

It is designed to be embedded into a host NestJS application. The host
application owns runtime infrastructure such as GraphQL setup, TypeORM
connection setup, auth/session handling, Vault or secret loading, member
directory integration, storage adapters, and deployment.

## Package Status

Current version: `0.1.7`

The package is intended for NestJS backend hosts. It does not include the
Next.js backoffice UI and does not provide a production auth system by itself.

Frontend / cross-framework consumers should use
[`@rytass/bpm-core-client`](../bpm-core-client/README.md) for the GraphQL
transport, REST auth client, and pre-baked typed operations against this
backend module.

## Install

```bash
pnpm add @rytass/bpm-core-nestjs-module @rytass/bpm-core-shared
pnpm add @nestjs/common @nestjs/core @nestjs/graphql @nestjs/typeorm graphql typeorm reflect-metadata
pnpm add pg
```

**TypeScript moduleResolution**: prefer `node16`, `nodenext`, or `bundler` in
your `tsconfig.json` so the package's `exports` field is honored. Classic
`moduleResolution: "node"` also works through the `typesVersions` fallback
shipped with this package, but is on TypeScript's long-term deprecation
path — new hosts should opt in to modern resolution.

If your host uses Apollo GraphQL:

```bash
pnpm add @nestjs/apollo @apollo/server
```

If your host uses Vault-backed database settings:

```bash
pnpm add @rytass/secret-adapter-vault-nestjs
```

## Runtime Responsibilities

`@rytass/bpm-core-nestjs-module` owns BPM domain behavior.

Your host application must provide:

- A NestJS application runtime.
- A configured `GraphQLModule`.
- A configured TypeORM `DataSource` / `TypeOrmModule`.
- Auth/session/JWT logic.
- A `BPMAuthContext` bridge from the request execution context.
- A `BPM_MEMBER_RESOLVER` provider for member metadata lookup.
- Attachment storage configuration when local storage is not acceptable.
- A dedicated worker or host dispatcher when email/webhook/SLA work should not
  run inside API replicas.
- Production secrets for attachment URL signing, signatures, SMTP, webhook, and Vault.

The package intentionally stores member IDs instead of owning user accounts.
Member profiles, roles, permissions, and email addresses are resolved by the
host.

## Quick Start

The host must wire the same authenticated member into both GraphQL context and
`BPMRootModule`. BPM expects host root-level routing — do **not** call Nest's
`setGlobalPrefix()`. BPM controllers (notably `AttachmentController`) hardcode
relative paths and use `attachmentRoutePrefix` to mount themselves; if you
want a prefix in production URLs, set `attachmentRoutePrefix` or push the
prefix into a reverse proxy.

A minimal host module looks like this:

```ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { BPMRootModule, BPM_MEMBER_RESOLVER, buildTypeOrmModuleOptions } from '@rytass/bpm-core-nestjs-module';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import type { Request } from 'express';
import { buildBPMAuthContextFromExecutionContext } from './bpm-auth-context';
import { HostAuthModule } from './host-auth.module';
import { HostBPMMemberResolver } from './host-bpm-member.resolver';
import { HostSessionService } from './host-session.service';

@Module({
  imports: [
    HostAuthModule,
    VaultModule.forRoot({
      path: process.env.VAULT_PATH ?? 'bpm_core/develop',
    }),
    TypeOrmModule.forRootAsync({
      imports: [VaultModule],
      inject: [VaultService],
      useFactory: buildTypeOrmModuleOptions,
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [HostAuthModule],
      inject: [HostSessionService],
      useFactory: (sessionService: HostSessionService) => ({
        autoSchemaFile: true,
        context: async ({ req }: { readonly req?: Request }) => ({
          bpmAuthContext: await sessionService.readBPMAuthContextFromRequest(req),
          req,
        }),
        driver: ApolloDriver,
        path: '/graphql',
        sortSchema: true,
      }),
    }),
    BPMRootModule.forRoot({
      imports: [HostAuthModule],
      authContextFactory: buildBPMAuthContextFromExecutionContext,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: HostBPMMemberResolver,
      },
    }),
  ],
})
export class AppModule {}
```

## Auth Context

BPM guards and mutations need the current BPM member. The host may provide the
context in the GraphQL context object and expose it through
`authContextFactory`.

```ts
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';

interface HostGraphQLContext {
  readonly bpmAuthContext?: BPMAuthContext | null;
  readonly req?: {
    readonly bpmAuthContext?: BPMAuthContext | null;
  };
}

export function buildBPMAuthContextFromExecutionContext(context?: ExecutionContext): BPMAuthContext | null {
  if (!context) {
    return null;
  }

  const graphqlContext = GqlExecutionContext.create(context).getContext<HostGraphQLContext | undefined>();

  return graphqlContext?.bpmAuthContext ?? graphqlContext?.req?.bpmAuthContext ?? null;
}
```

`BPMAuthContext` shape:

```ts
export interface BPMAuthContext {
  readonly memberId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}
```

BPM also exports param decorators so host resolvers don't need to call
`authContextFactory` directly:

```ts
import {
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  type BPMAuthContext,
} from '@rytass/bpm-core-nestjs-module';

@Resolver()
class HostResolver {
  @Query(() => HostSummary)
  @BPMAuthenticated()
  hostSummary(
    @BPMCurrentAuthContext() auth: BPMAuthContext,
    @BPMCurrentMemberId() memberId: string,
  ): HostSummary {
    return buildHostSummary(auth, memberId);
  }
}
```

### Bring-your-own-host-auth (for hosts that already have auth)

The BPM React `<AuthProvider>` calls `POST /auth/login`, `GET /auth/me`,
and `POST /auth/logout` on the BPM API host and expects responses that
match the `ApiMember` shape (exported from `@rytass/bpm-core-client`):

```ts
interface ApiMember {
  readonly memberId: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly expiresAt: string; // ISO 8601
}
```

Status-code contract:

| Endpoint              | Success     | Failure                             |
| --------------------- | ----------- | ----------------------------------- |
| `POST /auth/login`    | `200` + `ApiMember` JSON      | `401` (bad credentials) / `400` (validation) |
| `GET /auth/me`        | `200` + `ApiMember` JSON      | `401` (no session — React client treats as anonymous, not error) |
| `POST /auth/logout`   | `204` (or `200` empty)        | `401` ignored |

Session lifetime is owned by the host. The React `<AuthProvider>`
relies on `credentials: 'include'` plus an HTTP-only cookie issued by
the host on successful login — BPM does **not** issue cookies itself.

Hosts that already have their own JWT / cookie auth have two integration
patterns:

#### Pattern A — Extend the host API surface

Add `/auth/login`, `/auth/me`, `/auth/logout` controllers to your
existing NestJS host. Internally those endpoints call the host's
existing auth service (e.g. `MemberBaseService.login()`) and emit the
`ApiMember` shape. This is the simplest integration when BPM and the
host run on the same origin. Example for a member-base host:

```ts
@Controller('auth')
export class HostAuthController {
  constructor(private readonly memberBase: MemberBaseService) {}

  @Post('login')
  async login(@Body() input: LoginInput, @Res({ passthrough: true }) res: Response): Promise<ApiMember> {
    const { member, accessToken, refreshToken } = await this.memberBase.login(input);
    // Set the host's existing HTTP-only cookies; the React client will
    // forward them on subsequent /auth/me and /graphql calls.
    res.cookie('access_token', accessToken, { httpOnly: true, sameSite: 'lax' });
    res.cookie('refresh_token', refreshToken, { httpOnly: true, sameSite: 'lax' });
    return projectMemberToApiMember(member);
  }

  @Get('me')
  async me(@Req() req: Request): Promise<ApiMember> {
    const member = await this.memberBase.resolveCurrentMember(req); // throws 401 if no cookie
    return projectMemberToApiMember(member);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
  }
}
```

The `projectMemberToApiMember` helper is host-specific — map your own
member shape to BPM's expectations, project Casbin roles into the BPM
role-literal strings (see "Mapping from a host RBAC system" below),
and compute `expiresAt` from the token TTL.

#### Pattern B — Run BPM on a separate auth host

When BPM lives on its own subdomain (e.g. `bpm.example.com`) separate
from the main app at `app.example.com`, you can run a thin wrapper
host that **only** owns the `/auth/*` endpoints and a session cookie
scoped to `*.example.com`. The BPM React client points at this
subdomain via `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_AUTH_URL`
(or `configureBPMClient` for server-side). The wrapper host
internally calls back to the main app to verify the user.

This pattern is heavier (cross-origin cookies, CORS) but lets the main
app stay completely decoupled from BPM's auth surface. Use it only
when a same-origin deployment is impossible.

#### Cross-host auth precedence

If the consumer wants the React client to skip the BPM auth entirely
and rely on the host's existing session check at the Next.js layer,
the simplest path is to **not mount `<AuthProvider>` from
`@rytass/bpm-core-react`** and instead implement a host-side
`useAuth()` shim that returns the host's session. This is rare — most
consumers find Pattern A simpler.

## Role and Permission Contract

BPM guards inspect `BPMAuthContext.roles` and `BPMAuthContext.permissions` with
exact-string matching. The host must inject one of the following strings to
clear admin / designer guards; otherwise BPM resolvers reject with
`ForbiddenException`.

| Tier             | Accepted roles or permissions                                                                                                                                                                                  | Guards / decorators / helpers                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Admin            | `roles: ['BPM_ADMIN']`; or `permissions` contains one of `bpm:*`, `bpm:admin`, `bpm.admin`, `bpm:admin:*`                                                                                                      | `BPMAdminGuard`, `@BPMAdminOnly()`, `isBPMAdmin(authContext)`                |
| Designer         | Includes admin; or `roles: ['BPM_DESIGNER']`; or `permissions` contains one of `bpm:design`, `bpm.design`, `bpm.form.design`, `bpm.template.design`, `bpm:form:design`, `bpm:template:design`                  | `BPMDesignerGuard`, `@BPMDesignerOnly()`, `isBPMDesigner(authContext)`       |
| Authenticated    | `BPMAuthContext.memberId` is non-empty                                                                                                                                                                         | `BPMAuthenticatedGuard`, `@BPMAuthenticated()`                               |

`@BPMAdminOnly()` and `@BPMDesignerOnly()` already chain
`BPMAuthenticatedGuard`. The host does not need to add `@BPMAuthenticated()`
on top of them.

### Mapping from a host RBAC system (e.g. Casbin)

BPM does not call the host's RBAC engine — it reads exact-string `roles`
and `permissions` arrays off `BPMAuthContext`. Hosts using Casbin /
Permify / OPA must **project their grouping policy** into the BPM
literals inside their `authContextFactory`. A worked Casbin example:

```ts
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { CASBIN_ENFORCER, type CasbinEnforcer } from '@your-host/auth';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';

const HOST_TO_BPM_ROLES: Readonly<Record<string, string>> = {
  approval_admin: 'BPM_ADMIN',
  approval_designer: 'BPM_DESIGNER',
};

@Injectable()
export class BPMAuthContextFactory {
  constructor(@Inject(CASBIN_ENFORCER) private readonly enforcer: CasbinEnforcer) {}

  async build(ctx: ExecutionContext): Promise<BPMAuthContext | null> {
    const req = GqlExecutionContext.create(ctx).getContext<{
      req?: { member?: { id: string; email: string; name: string } };
    }>().req;
    const member = req?.member;
    if (!member) return null;

    // 1. Look up the host's Casbin role assignments for this member.
    const hostRoles = await this.enforcer.getRolesForUser(member.id);

    // 2. Translate into BPM's exact-string literals. Unknown host roles
    //    do nothing — BPM only checks for the documented strings.
    const bpmRoles = hostRoles
      .map((r) => HOST_TO_BPM_ROLES[r])
      .filter((r): r is string => Boolean(r));

    return {
      memberId: member.id,
      email: member.email,
      name: member.name,
      roles: bpmRoles,
      permissions: [], // Host can also use `bpm:*` style permissions if preferred.
      metadata: {},
    };
  }
}
```

> The host owns the mapping table. Keep it in one place (a constant
> module or a database table) so adding a new BPM tier in a future
> BPMCore release becomes a one-line addition.

## Member Resolver

The package resolves display names, email addresses, and approver candidates
through `BPM_MEMBER_RESOLVER`.

For a member-base-like directory, prefer the package helper. It creates a Nest
provider without forcing BPM to depend on the host identity package:

```ts
import { Injectable, type InjectionToken, type Provider } from '@nestjs/common';
import { BPM_MEMBER_RESOLVER, type BPMMemberBaseDirectory, createBPMMemberBaseResolverProvider } from '@rytass/bpm-core-nestjs-module';

interface HostMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

@Injectable()
export class HostMemberDirectory implements BPMMemberBaseDirectory<HostMember> {
  async resolveMember(memberId: string): Promise<HostMember | null> {
    return findHostMember(memberId);
  }

  async searchMembers(searchText: string): Promise<readonly HostMember[]> {
    return searchHostMembers(searchText);
  }
}

export const HOST_MEMBER_DIRECTORY: InjectionToken<BPMMemberBaseDirectory<HostMember>> = Symbol('HOST_MEMBER_DIRECTORY');

export const hostMemberProviders: readonly Provider[] = [
  {
    provide: HOST_MEMBER_DIRECTORY,
    useClass: HostMemberDirectory,
  },
  createBPMMemberBaseResolverProvider({
    adapterOptions: {
      readEmail: (member): string => member.email,
      readMemberId: (member): string => member.id,
      readName: (member): string => member.name,
    },
    directoryToken: HOST_MEMBER_DIRECTORY,
    provide: BPM_MEMBER_RESOLVER,
  }),
];
```

Required resolver contract:

```ts
export interface BPMMemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(memberIds: readonly string[]): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}
```

## Organization Data Ownership

> **Read this before integrating BPM into a host that already has its own
> organization model.** The org-integration shape is **asymmetric** with
> member integration above — knowing which side owns what saves a day of
> source spelunking.

### Ownership claim

BPM is the **sole authority** for four organization tables:

| Table | Owns |
|---|---|
| `org_units` | Department / division / company nodes (typed by `OrgUnitType`) |
| `positions` | Job titles, with optional org-unit scoping |
| `memberships` | Member × org-unit × position relations (the join table that puts a member at a position inside a unit) |
| `manager_resolutions` | "Who is whose manager" rules (per-member, per-org-unit, or per-position scope), consumed by the `ORG_MANAGER` approver resolver |

There is **no** host-injectable `OrgUnitResolver` / `PositionResolver` /
`MembershipResolver` pattern, deliberately so. If you went looking for
the symmetric counterpart to `BPMMemberResolver`, stop now — it doesn't
exist, and the rest of this section explains why and what to do instead.

### Why no resolver

The BPM workflow engine reads the org graph on hot paths:

- **Approver routing** — every running instance evaluates `UserTaskNode`
  candidates (resolved via `DIRECT`, `POSITION`, `ORG_MANAGER`, or
  `CANDIDATE_GROUP`) against the current org snapshot. A `ParallelGateway`
  fanning out to "all managers in the IT division" may touch dozens of
  membership rows in one step.
- **Tree-diff commits** — `commitOrgUnitTreeDraft` writes batched moves
  inside a single transaction, with referential integrity against
  `memberships` and `manager_resolutions`. Round-tripping each lookup
  through a host adapter would make this prohibitively chatty.
- **Reporting** — admin dashboards aggregate counts across the full graph.

A read-through adapter would force the host to mirror BPM's tree
semantics (ltree paths, soft-delete masking, position-vs-org-unit join
shape) anyway. We chose to make BPM authoritative so the contract is one
direction only.

### Mirror pattern

Host applications that already maintain their own org structure should
**mirror their data into BPM** through the GraphQL mutations exposed by
`@rytass/bpm-core-client/organization`. Three rules keep this idempotent
and observable:

1. **`OrgUnit.code` is your natural key.** Every `createOrgUnit` /
   `createPosition` accepts a `code` field that you control. BPM enforces
   uniqueness; use your host's stable identifier here (e.g. an LDAP DN
   slug or a internal ERP code). On a re-sync, look up existing entities
   by `code` before deciding INSERT vs UPDATE.
2. **`metadata` is the host-FK stash.** Both `OrgUnit` and `Membership`
   carry an opaque `metadata` JSON object that BPM never introspects.
   Store your host's primary key here (e.g. `{ shuttleOrgUnitId: 12345 }`)
   so you can chase the back-pointer when reconciling.
3. **Soft delete via `deleteOrgUnit` / `deleteMembership` / `deleteManagerResolution`.** Deletes set
   `deletedAt` rather than removing rows. BPM's query layer hides
   soft-deleted rows automatically; reading `orgUnitCount()` will report
   the live count.
4. **Positions are intentionally not deletable.** There is no
   `deletePosition` mutation — positions are part of the historical
   record (every signed approval task references the assignee's position
   at sign time, so deleting a position would lose audit data). Retire a
   position by removing all active memberships referencing it; the
   position itself stays. Use `updatePosition({ id, name: 'retired-' + oldName, ... })`
   if you want a UI hint that a position is no longer in use.

### Worked example: idempotent sync

The example below uses only published exports from
`@rytass/bpm-core-client/organization`. It loads the entire BPM-side
state once via `readOrganizationDashboard()`, builds a `code → record`
index, then upserts each host node. Verified exports (all with flat
input shapes — no `{id, input: {...}}` wrapping):

- `readOrganizationDashboard({ orgUnitPageSize, orgUnitSearchText, ... })`
- `createOrgUnit({ code, name, type, parentId, metadataJson })`
- `updateOrgUnit({ id, code, name, type, parentId, metadataJson })`
- `deleteOrgUnit(id)` (soft-delete)
- `commitOrgUnitTreeDraft({ moves: { id, parentId, baseUpdatedAt }[] })` (transactional batch moves — each entry's `baseUpdatedAt` is the row's last-known `updatedAt`, used by BPM for optimistic-locking conflict detection)
- `createPosition` / `updatePosition` (key on `code`)
- `createMembership` / `updateMembership` (unique by `(memberId, orgUnitId, positionId)`)
- `createManagerResolution` / `updateManagerResolution`

```ts
import {
  readOrganizationDashboard,
  createOrgUnit,
  updateOrgUnit,
  type OrgUnitRecord,
} from '@rytass/bpm-core-client/organization';
import type { OrgUnitType } from '@rytass/bpm-core-shared';

interface HostOrgUnit {
  readonly hostId: string;          // e.g. ERP primary key — your host-FK
  readonly code: string;            // stable across sync runs
  readonly name: string;
  readonly type: OrgUnitType;       // 'company' | 'division' | 'department' | 'team'
  readonly parentCode: string | null;
}

async function syncOrgTree(
  hostNodes: readonly HostOrgUnit[],
): Promise<void> {
  // 1. Single round trip: load every existing BPM org unit, index by code.
  const dashboard = await readOrganizationDashboard({ orgUnitPageSize: null });
  const byCode = new Map<string, OrgUnitRecord>(
    dashboard.orgUnits.map((unit) => [unit.code, unit]),
  );

  // 2. Topo-sort by parent so a parent always exists before its child
  //    is upserted (createOrgUnit needs the parentId to be valid).
  const ordered = topoSortByParent(hostNodes);

  for (const host of ordered) {
    const parentId =
      host.parentCode != null ? (byCode.get(host.parentCode)?.id ?? null) : null;
    const metadataJson = JSON.stringify({ hostId: host.hostId });
    const existing = byCode.get(host.code);

    const saved = existing
      ? await updateOrgUnit({
          id: existing.id,
          code: host.code,
          name: host.name,
          type: host.type,
          parentId,
          metadataJson,
        })
      : await createOrgUnit({
          code: host.code,
          name: host.name,
          type: host.type,
          parentId,
          metadataJson,
        });

    byCode.set(saved.code, saved);
  }
}
```

The same pattern works for `Position` (key on `code`), `Membership`
(unique by `memberId × orgUnitId × positionId`), and
`ManagerResolution` (unique by scope shape + active flag). For bulk
tree-shape changes (multi-node moves under a single parent),
`commitOrgUnitTreeDraft` accepts the full draft in one transaction.

> **Atomicity caveat.** Only `commitOrgUnitTreeDraft` is transactional.
> Sequential `createMembership` / `createPosition` calls are independent
> mutations — if the 401st call in a batch of 500 fails, the prior 400
> stay committed. Wrap your sync loop in a "from-cursor" resume strategy
> if you need at-least-once semantics across crashes.

> **Programmatic base URL.** Server-side scripts that aren't running
> under Next.js (cron workers, one-off seeds) cannot rely on
> `NEXT_PUBLIC_API_URL` resolution — call `configureBPMClient({ baseUrl,
> fetch, headers })` from `@rytass/bpm-core-client` once at startup to
> point the transport at the right host and inject a session cookie or
> bearer token.

### What you do NOT mirror

Member identity itself stays in your host's user table — BPM reaches it
through `BPMMemberResolver` (see the previous section). Only the
**org structure** (who reports where, what unit they sit in, who manages
them) needs to live inside BPM.

## Root Module Configuration

Use `BPMRootModule.forRoot()` for static configuration or
`BPMRootModule.forRootAsync()` when values come from Vault, ConfigService, KMS,
or another secret provider.

```ts
BPMRootModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
  useFactory: (config: ConfigService) => ({
    authContextFactory: buildBPMAuthContextFromExecutionContext,
    attachmentPublicBaseUrl: config.getOrThrow<string>('BPM_API_PUBLIC_URL'),
    attachmentSignedUrlSecret: config.getOrThrow<string>('BPM_ATTACHMENT_SIGNING_SECRET'),
    attachmentSignedUrlTtlSeconds: 300,
    identityMemberMetadataCacheTtlMs: 300_000,
    notificationEmailEnabled: 'auto',
    notificationEmailFrom: config.get<string>('BPM_NOTIFICATION_FROM'),
    notificationEmailSmtpHost: config.get<string>('BPM_SMTP_HOST'),
    notificationEmailSmtpPassword: config.get<string>('BPM_SMTP_PASSWORD'),
    notificationEmailSmtpPort: Number(config.get<string>('BPM_SMTP_PORT')),
    notificationEmailSmtpSecure: false,
    notificationEmailSmtpUsername: config.get<string>('BPM_SMTP_USERNAME'),
    notificationWebhookEnabled: 'auto',
    notificationWebhookEndpointUrl: config.get<string>('BPM_WEBHOOK_URL'),
    notificationWebhookSigningSecret: config.get<string>('BPM_WEBHOOK_SIGNING_SECRET'),
    signatureCurrentKeyVersion: 1,
    signatureKeyProvider: {
      readKey: (keyVersion: number): string => config.getOrThrow<string>(`BPM_SIGNATURE_KEY_V${keyVersion}`),
    },
    signatureTimestampProvider: {
      createTimestampToken: ({ signedAt, signedPayloadHash }): Buffer => Buffer.from(JSON.stringify({ signedAt, signedPayloadHash }), 'utf8'),
    },
  }),
});
```

### Configuration Reference

| Option                                           | Default                        | Description                                                    |
| ------------------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `authContextFactory`                             | `undefined`                    | Reads `BPMAuthContext` from NestJS `ExecutionContext`.         |
| `memberResolverProvider`                         | required                       | Provider for `BPM_MEMBER_RESOLVER`.                            |
| `attachmentStorageProvider`                      | local `.storage/attachments`   | Host-provided `@rytass/storages` adapter.                      |
| `workflowServiceTaskDispatcherProvider`          | built-in `fetch` dispatcher    | Host provider for executable workflow `WEBHOOK` service tasks. |
| `attachmentRoutePrefix`                          | `/attachments`                 | Drives both the BPM signed URL path and the Nest controller mount path for `AttachmentController`. Must be set at module wiring time (see "Attachment Storage" below). |
| `attachmentStorageProviderId`                    | `local`                        | Value stored on attachment metadata for the active adapter.    |
| `attachmentPublicBaseUrl`                        | `http://localhost:17603`       | Public base URL for signed attachment URLs.                    |
| `attachmentSignedUrlSecret`                      | local development secret       | HMAC secret for signed attachment download/preview tokens.     |
| `attachmentSignedUrlTtlSeconds`                  | `300`                          | Signed attachment URL lifetime in seconds.                     |
| `identityMemberMetadataCacheTtlMs`               | `300000`                       | Member metadata cache TTL.                                     |
| `notificationInAppEnabled`                       | `true`                         | Enables in-app notification records.                           |
| `notificationEmailEnabled`                       | `auto`                         | Enables email when SMTP settings are complete.                 |
| `notificationEmailSmtpHost`                      | `null`                         | SMTP host.                                                     |
| `notificationEmailSmtpPort`                      | `null`                         | SMTP port.                                                     |
| `notificationEmailSmtpSecure`                    | `false`                        | `true` for implicit TLS, `false` for STARTTLS.                 |
| `notificationEmailSmtpUsername`                  | `null`                         | SMTP username.                                                 |
| `notificationEmailSmtpPassword`                  | `null`                         | SMTP password or app password.                                 |
| `notificationEmailFrom`                          | `null`                         | Email sender address.                                          |
| `notificationWebhookEnabled`                     | `auto`                         | Enables webhook when URL and signing secret are complete.      |
| `notificationWebhookEndpointUrl`                 | `null`                         | Default webhook endpoint URL.                                  |
| `notificationWebhookSigningSecret`               | `null`                         | HMAC secret for webhook payload signatures.                    |
| `notificationDeliverySchedulerEnabled`           | `false`                        | Runs pending email/webhook delivery loop in this process.      |
| `notificationDeliveryScanIntervalMs`             | `30000`                        | Delivery scheduler interval.                                   |
| `notificationDeliveryBatchSize`                  | `25`                           | Maximum pending notifications per delivery scan.               |
| `notificationDeliveryMaxAttempts`                | `3`                            | Attempts before a notification is marked failed.               |
| `notificationDeliveryRetryBaseDelayMs`           | `60000`                        | Base retry delay multiplied by attempt count.                  |
| `notificationSlaSchedulerEnabled`                | `false`                        | Runs automatic SLA scan loop in this process.                  |
| `notificationSlaScanIntervalMs`                  | `60000`                        | SLA scheduler interval.                                        |
| `notificationSlaTimeoutRemindEnabled`            | `true`                         | Enables SLA timeout `REMIND`.                                  |
| `notificationSlaTimeoutAutoApproveEnabled`       | `false`                        | Enables SLA timeout `AUTO_APPROVE`.                            |
| `notificationSlaTimeoutEscalateEnabled`          | `false`                        | Enables SLA timeout `ESCALATE`.                                |
| `notificationSlaTimeoutTerminateInstanceEnabled` | `false`                        | Enables SLA timeout `TERMINATE_INSTANCE`.                      |
| `notificationTemplateEngine`                     | `simple`                       | `simple` only — `handlebars` is reserved and currently rendered as `simple`. |
| `notificationDefaultChannels`                    | `[IN_APP]`                     | Fallback channels when a workflow node has no channel list.    |
| `notificationDefaultEmailDigestMode`             | `INSTANT`                      | Default digest mode for missing preferences.                   |
| `notificationDefaultInAppPreferenceEnabled`      | `true`                         | Default in-app preference for missing preferences.             |
| `notificationDefaultEmailPreferenceEnabled`      | `true`                         | Default email preference for missing preferences.              |
| `signatureCurrentKeyVersion`                     | `1`                            | Key version used for new signatures.                           |
| `signatureKeyProvider`                           | local development key provider | Host key provider for signing and verification.                |
| `signatureTimestampProvider`                     | mock timestamp provider        | Host timestamp token provider.                                 |

Production deployments should override all local development secrets.

## Database Setup

The package exports helpers for Vault-backed TypeORM setup:

```ts
import { TypeOrmModule } from '@nestjs/typeorm';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { buildTypeOrmModuleOptions } from '@rytass/bpm-core-nestjs-module';

TypeOrmModule.forRootAsync({
  imports: [VaultModule],
  inject: [VaultService],
  useFactory: buildTypeOrmModuleOptions,
});
```

Expected Vault keys:

| Key         | Description                |
| ----------- | -------------------------- |
| `DB_HOST`   | PostgreSQL host.           |
| `DB_PORT`   | PostgreSQL port, optional. |
| `DB_NAME`   | PostgreSQL database name.  |
| `DB_USER`   | PostgreSQL username.       |
| `DB_PASS`   | PostgreSQL password.       |
| `DB_SCHEMA` | PostgreSQL schema.         |

`buildTypeOrmModuleOptions` adds `autoLoadEntities: true` so the NestJS
`TypeOrmModule` picks up BPM entities through each domain module's
`TypeOrmModule.forFeature`. `buildBPMDataSourceOptions()` returns
`entities: []` because TypeORM CLI tooling reads entities from the host's own
glob; if you plan to run `typeorm migration:generate` or
`typeorm migration:show` from a script, attach BPM entities to the data
source yourself.

Use `buildBPMDataSourceOptions()` when your host already has database secrets
and does not want the Vault adapter:

```ts
import { buildBPMDataSourceOptions } from '@rytass/bpm-core-nestjs-module';

const dataSourceOptions = buildBPMDataSourceOptions({
  database: 'bpm_core',
  host: '127.0.0.1',
  password: 'secret',
  port: 5432,
  schema: 'bpm_core_staging',
  username: 'bpm_core_staging',
});
```

The local migration CLI helper can also read Vault directly from environment
variables:

```bash
VAULT_HOST=https://vault.example.com \
VAULT_ACCOUNT=your-account \
VAULT_PASSWORD=your-password \
VAULT_PATH=bpm_core/develop \
pnpm typeorm migration:run
```

Required environment variables for direct Vault loading:

| Variable         | Description                         |
| ---------------- | ----------------------------------- |
| `VAULT_HOST`     | Vault HTTP base URL.                |
| `VAULT_ACCOUNT`  | Vault userpass account.             |
| `VAULT_PASSWORD` | Vault userpass password.            |
| `VAULT_PATH`     | Vault KV path, defaults to develop. |

### Sharing a Postgres cluster with the host

Hosts that already run their own Postgres (and their own Vault path,
e.g. `shuttle/develop`) have three options for where BPM's 22 tables
live. Pick the one that matches your operational model:

| Option | When to use | Trade-off |
|---|---|---|
| **Same database, same schema (`public`)** | Tiny prototypes, monorepo dev | Table-name collision risk — BPM owns `org_units`, `positions`, etc., common names. Audit your host's tables before choosing. |
| **Same database, separate schema** (recommended) | Most production hosts | Clean isolation; pg_dump per-schema; one connection pool. Set `DB_SCHEMA=bpm_core` in BPM's Vault path. Host stays on its own schema (typically `public`). |
| **Separate database** | Hard multi-tenant or compliance boundary | Two pools; cross-schema joins impossible (BPM doesn't need them); migration runners stay completely independent. |

For option B (separate schema), the host's own TypeORM `forRoot()` and
BPM's `buildTypeOrmModuleOptions` create **two distinct connections**
to the same Postgres cluster with different `schema:` settings — that
is the cleanest separation Nest's TypeORM module supports.

Vault paths can be split independently: keep `shuttle/develop` for the
host and create `bpm_core/develop` for BPM secrets. BPM's helper reads
its own path; the host's auth module reads its own. They do not
interfere.

> **Schema migrations** are per-schema. Run BPM's migrations against
> the schema named in `DB_SCHEMA`; the host's migrations stay on its
> own schema. There is no cross-schema migration coordination.

## Migrations

This package ships TypeORM migrations under `src/lib/migrations`.

For this repository:

```bash
pnpm migration:run
```

For an external host, import the class list instead of relying on a repository
source glob:

```ts
import { BPM_CORE_MIGRATIONS } from '@rytass/bpm-core-nestjs-module/migrations';
```

`buildBPMDataSourceOptions()`, `buildDataSourceOptionsFromVaultEnv()`, and
`buildTypeOrmModuleOptions()` use this exported migration list. Runtime
`TypeOrmModule` setup still keeps `migrationsRun: false`; run migrations
explicitly during deploy.

The first migration attempts to create required PostgreSQL extensions
(`uuid-ossp`, `ltree`) if they do not exist. Hosts that cannot grant
`CREATE EXTENSION` should pre-provision those extensions in the target database
before running BPM migrations. Schema selection comes from the TypeORM `schema`
option, so multi-schema hosts should run the same migration list once per BPM
schema/user pair.

Do not enable `synchronize` in production.

## Attachment Storage

By default, attachments use local storage under `.storage/attachments`. For
production, provide an `@rytass/storages` compatible adapter:

```ts
BPMRootModule.forRoot({
  attachmentStorageProvider: {
    provide: ATTACHMENT_STORAGE,
    useFactory: (): AttachmentStorage => createYourStorageAdapter(),
  },
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

Signed attachment URLs are served by BPM's attachment controller. Configure
`attachmentPublicBaseUrl`, `attachmentRoutePrefix`,
`attachmentSignedUrlSecret`, and `attachmentSignedUrlTtlSeconds` for production.
Set `attachmentStorageProviderId` when replacing local storage so attachment
metadata does not incorrectly say `local`.

`attachmentRoutePrefix` controls two things at the same time:

1. The path BPM bakes into signed URLs
   (`${publicBaseUrl}${routePrefix}/:id/download`).
2. The Nest controller mount path. `AttachmentModule.forRoot` /
   `forRootAsync` call `Reflect.defineMetadata(PATH_METADATA, ...)` on
   `AttachmentController` so the controller actually serves on the same path
   the signed URL points to.

The default is `/attachments`, matching the BPM controller's relative
declaration. BPM no longer assumes the host calls `setGlobalPrefix('api')`;
do not enable `setGlobalPrefix` on a BPM host. To expose the attachment
endpoint under a different prefix, set `attachmentRoutePrefix` (for example
`/internal/bpm/attachments`) — BPM rewrites both the controller path and the
signed URL accordingly. Alternative URL shaping should happen at a reverse
proxy (Nginx, Cloudflare, k8s ingress), not via Nest globalPrefix.

Because Nest reads controller path metadata synchronously at application
bootstrap, `attachmentRoutePrefix` must be supplied at module wiring time:

- `BPMRootModule.forRoot` reads `options.attachmentRoutePrefix` directly.
- `BPMRootModule.forRootAsync` exposes `attachmentRoutePrefix` at the
  top-level (sibling of `useFactory`), not as part of the async factory
  return.
- A process can only mount BPM under a single prefix. Multi-tenant hosts that
  want different prefixes per tenant should run separate processes.

### Cross-origin authentication

Signed attachment URLs carry the auth **inside the URL** itself —
specifically a query-string signature derived from
`attachmentSignedUrlSecret` and `attachmentSignedUrlTtlSeconds`. The
browser does **not** send the session cookie to fetch the attachment;
BPM's controller verifies the signature instead.

This means:

- The attachment URL is safe to embed in `<img>` / `<a href>` /
  `<iframe>` tags across origins; CORS is not in the auth path.
- Anyone who possesses the URL (until TTL expiry) can fetch the file.
  Choose `attachmentSignedUrlTtlSeconds` short enough that a leaked URL
  expires before exploitation (we suggest **600s** in production).
- Hosts that need true cross-tenant isolation should keep
  `attachmentPublicBaseUrl` pointing at a CDN edge that enforces its own
  authz on top — BPM's signature is freshness, not authorization.

### Disabling the `/auth/test-members` endpoint in production

Hosts wired with the demo seed (typical for `pnpm demo:reset` /
`pnpm staging:reset`) expose `GET /auth/test-members` so the login form
shows a clickable list of fixture accounts. **Do not ship this in
production.** Two ways to keep it out:

1. The endpoint is **owned by the wrapper host**, not by BPM —
   `@rytass/bpm-core-nestjs-module` does not register it. Simply omit
   the wrapper module / controller that serves
   `/auth/test-members`. The reference implementation in BPMCore's
   `apps/api` only exposes it when `NODE_ENV !== 'production'`; copy
   that pattern in your own auth controller.
2. The browser-side `listApiTestMembers()` client function tolerates a
   `404` / `401` and returns an empty array, so removing the endpoint
   degrades gracefully — the login form simply hides the demo-account
   picker.

## Notifications and SLA

BPM creates in-app notifications by default. Email and webhook delivery are
disabled unless enough configuration is present or explicitly enabled.

The `auto` setting on `notificationEmailEnabled` only activates email delivery
when **all** of the following are non-empty strings:

- `notificationEmailSmtpHost`
- `notificationEmailSmtpPort`
- `notificationEmailSmtpUsername`
- `notificationEmailSmtpPassword`
- `notificationEmailFrom`

If any one of those is missing, email stays off even on `auto`. Webhook
`auto` requires both `notificationWebhookEndpointUrl` and
`notificationWebhookSigningSecret`.

`notificationTemplateEngine: 'handlebars'` is currently a reserved value; the
runtime template renderer still uses the built-in `simple` renderer regardless
of this setting. Leave it as `simple` until the Handlebars implementation is
wired.

Delivery and SLA schedulers are disabled by default. Enable them only in a
dedicated worker process or in a single-replica host that intentionally owns
background work:

```ts
BPMRootModule.forRoot({
  notificationDeliverySchedulerEnabled: true,
  notificationSlaSchedulerEnabled: true,
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

BPM claims pending delivery rows with `FOR UPDATE SKIP LOCKED` and records
SLA notifications with an idempotency index, but a dedicated worker is still
the recommended production topology.

Hosts can replace built-in SMTP and signed webhook dispatch by providing
`BPM_NOTIFICATION_DISPATCHER` from an imported host module. The dispatcher can
publish to an existing mail service, queue, tenant router, or event bus:

```ts
import { BPM_NOTIFICATION_DISPATCHER } from '@rytass/bpm-core-nestjs-module/notification';

@Module({
  providers: [
    {
      provide: BPM_NOTIFICATION_DISPATCHER,
      useClass: HostNotificationDispatcher,
    },
  ],
  exports: [BPM_NOTIFICATION_DISPATCHER],
})
export class HostNotificationModule {}
```

Workflow service tasks are a separate integration point from notification
delivery. `WEBHOOK` service-task nodes run inside the workflow engine and use
`BPM_WORKFLOW_SERVICE_TASK_DISPATCHER`. The default dispatcher sends a JSON
`POST` with `fetch`; wrapper apps can replace it when outbound workflow actions
must be signed, queued, audited, or routed through an internal integration
service.

`BPMRootModule.forRoot` / `forRootAsync` forward the host `imports` to the
internal `WorkflowEngineModule.forRoot`, so the dispatcher provider may use
`useFactory` plus `inject` to read host-side tokens such as Vault secrets or
shared integration bus instances. Providers do not have to live in a
`@Global()` module to be injectable from the dispatcher.

```ts
import { Injectable } from '@nestjs/common';
import {
  BPMRootModule,
  BPM_MEMBER_RESOLVER,
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  BPMWorkflowWebhookDispatchInput,
  BPMWorkflowWebhookDispatchResult,
} from '@rytass/bpm-core-nestjs-module';

interface IntegrationBusResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

interface IntegrationBus {
  enqueue(
    topic: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<IntegrationBusResult>;
}

@Injectable()
class HostWorkflowServiceTaskDispatcher implements BPMWorkflowServiceTaskDispatcher {
  constructor(private readonly integrationBus: IntegrationBus) {}

  async dispatchWebhook(
    input: BPMWorkflowWebhookDispatchInput,
  ): Promise<BPMWorkflowWebhookDispatchResult> {
    const result = await this.integrationBus.enqueue('bpm.workflow.webhook', {
      headers: input.headers ?? {},
      payload: input.payload,
      url: input.url,
    });

    return {
      ok: result.accepted,
      status: result.accepted ? 202 : null,
      error: result.accepted ? undefined : result.reason,
    };
  }
}

BPMRootModule.forRoot({
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
  workflowServiceTaskDispatcherProvider: {
    provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
    useClass: HostWorkflowServiceTaskDispatcher,
  },
});
```

SLA timeout actions that change workflow state are disabled by default:

- `AUTO_APPROVE`
- `ESCALATE`
- `TERMINATE_INSTANCE`

Enable them only after the host application's business policy is explicit.

## Signatures

Decision signatures use HMAC-SHA256 and are chained through the previous
signature hash. Production hosts should provide a durable key provider and real
timestamp provider:

```ts
BPMRootModule.forRoot({
  signatureCurrentKeyVersion: 2,
  signatureKeyProvider: {
    readKey: async (keyVersion: number): Promise<string | null> => readKeyFromKmsOrVault(keyVersion),
  },
  signatureTimestampProvider: {
    createTimestampToken: async ({ signedAt, signedPayloadHash }): Promise<Buffer> => requestTimestampTokenFromTsa({ signedAt, signedPayloadHash }),
  },
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

Keep old signature keys readable after rotation. Verification needs the key
version stored on each signature row.

Both `readKey` and `createTimestampToken` accept either a synchronous return
or a `Promise`; the example above uses async because production KMS / TSA
clients are typically network-bound. Returning a synchronous value is fine
for in-memory or local-file providers.

## GraphQL Surface

Importing `BPMRootModule` registers GraphQL resolvers for:

- Organization units, positions, memberships, manager resolution, and summary.
- Member profile lookup and member metadata cache inspection.
- Form definitions and form definition versions.
- Approval templates, template versions, categories, validation, and dry run.
- Workflow instances, tokens, tasks, task candidates, decisions, activity logs,
  submit/process/approve/return/cancel/resubmit operations.
- Delegation rule CRUD and transfer support.
- Notifications, unread counts, preferences, and read status.
- Attachments, signed download URLs, and signed preview URLs.
- Decision signatures and signature-chain verification.

The schema is generated by NestJS GraphQL code-first decorators. Configure the
host `GraphQLModule` with `autoSchemaFile` if you want NestJS to generate the
schema at runtime.

## Shared Types

Workflow, form, condition, identity, organization, and status contracts live in
`@rytass/bpm-core-shared`.

```ts
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import type { FormSchema } from '@rytass/bpm-core-shared/form';
```

Use shared contracts when building UI clients or host-side integration tests.

## Import Paths

The package root is the canonical import path for common host-facing APIs.
Stable feature subpaths are also published for narrower imports such as
migrations or notification dispatcher tokens.

```ts
import {
  AllExceptionsFilter,
  BPMAdminGuard,
  BPMAdminOnly,
  BPMAuthenticated,
  BPMAuthenticatedGuard,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  BPMDesignerGuard,
  BPMDesignerOnly,
  BPMRootModule,
  buildTypeOrmModuleOptions,
  createBPMMemberBaseResolverProvider,
} from '@rytass/bpm-core-nestjs-module';

import { BPM_CORE_MIGRATIONS } from '@rytass/bpm-core-nestjs-module/migrations';
import { BPM_NOTIFICATION_DISPATCHER } from '@rytass/bpm-core-nestjs-module/notification';
```

`AllExceptionsFilter` is the BPM-aware global exception filter the wrapper
app uses on its NestJS bootstrap; hosts that want consistent GraphQL/HTTP
error responses can call `app.useGlobalFilters(new AllExceptionsFilter())`.

Use root imports for module wiring, guards, options, and adapter helpers.
Feature subpaths are intended for narrow integration tokens or migration lists.
Do not treat internal domain services as the primary host API unless their
method contracts are explicitly documented.

Do not import from internal compiled paths such as
`@rytass/bpm-core-nestjs-module/src/lib/...`.

## Local Development

From this repository, use the wrapper app to run the backend and client:

```bash
pnpm install
pnpm demo:reset
pnpm api
pnpm client
```

`pnpm demo:reset` runs migrations before resetting and seeding develop data. Use
`pnpm migration:run` separately only when you need migrations without resetting
the wrapper-app seed scenario.

Default local service URLs:

- API: `http://localhost:17603`
- GraphQL: `http://localhost:17603/graphql`
- Client: `http://localhost:17602`

The normal local flow uses Vault-backed develop secrets. `docker compose` is not
required for local verification.

`pnpm demo:reset` is a repository wrapper-app command, not a package feature. It
resets the develop schema and seeds a Taiwan manufacturing scenario through
`apps/api/tools/reset-demo-data.ts`, including DB-backed test members in
`api_test_members`. Staging uses the same script through `pnpm staging:reset`
with `VAULT_PATH=bpm_core/staging`.

## Verification

Before publishing:

```bash
pnpm nx test bpm-core --runInBand
pnpm nx typecheck bpm-core
pnpm nx build bpm-core
```

Repository-wide checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Publishing Checklist

1. Confirm package metadata in `libs/bpm-core/package.json`.
2. Confirm `@rytass/bpm-core-shared` is published at the required version.
3. Run `pnpm nx build bpm-core`.
4. Inspect `dist/libs/bpm-core/package.json`.
5. Confirm `dist/libs/bpm-core/README.md` is present.
6. Confirm `src/index.ts` exports every intended public API.
7. Publish from the built package directory:

```bash
cd dist/libs/bpm-core
npm publish --access public
```

## Production Notes

- Replace all local fallback secrets before production.
- Use a production storage adapter instead of local filesystem storage.
- Keep old signature keys available for verification after key rotation.
- Keep in-process schedulers disabled in API replicas unless a dedicated worker
  is not available.
- Do not enable TypeORM `synchronize` in production.
- Ensure GraphQL auth context is available for protected operations.
- Run migrations before serving traffic with a new package version.

## License

MIT
