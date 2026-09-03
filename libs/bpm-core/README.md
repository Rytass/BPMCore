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

Form Definition parsing accepts the additive static/DataSource option-source
shape and performs structural publish lint for source XOR, selection mode,
direct bindings, duplicate parameters, field references, dependency cycles,
and dynamic default-value prohibition. Hosts can register versioned DataSources
through `BPMRootModule`; the runtime validates bindings, bounds provider calls,
and keeps transport details and credentials out of form JSON.

## Package Status

Current version: `0.1.10`

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

```ts
function projectMemberToApiMember(member: HostMember): ApiMember {
  return {
    memberId: member.id,
    email: member.email ?? '',         // ApiMember.email is `string`, not `string | null`
    name: member.name,
    roles: projectHostRolesToBPMRoles(member.roles), // [] if no admin/designer claim
    permissions: [],                   // optional — return [] if not used
    expiresAt: new Date(Date.now() + JWT_TTL_MS).toISOString(),
  };
}
```

Response status contract that BPM's React client expects:

| Endpoint | Success | Auth fail | Validation fail |
|---|---|---|---|
| `POST /auth/login` | `200` + `ApiMember` JSON, set HTTP-only cookie | `401` | `400` |
| `GET /auth/me` | `200` + `ApiMember` JSON | `401` (client treats as anonymous, **not error**) | n/a |
| `POST /auth/logout` | `204` (or `200` with empty body) | `401` ignored — client clears local state anyway | n/a |

`roles` and `permissions` MUST be arrays (use `[]` for no claim), not
`null` or `undefined` — the React client's `member.roles.includes(...)`
checks would crash otherwise.

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

### Machine-to-machine authentication

Server-side scripts (org seeds, cron workers, integration tests) call
`configureBPMClient` to set the GraphQL base URL and optional default
headers, then must establish a session. Three patterns work:

#### Pattern 1 — Service member + login flow (recommended)

Create a dedicated BPM admin member (e.g. `bpm-sync@svc.example.com`),
store its credentials in Vault, and let the script call `loginApi`
during bootstrap. The login response sets an HTTP-only session cookie
that subsequent `requestGraphQl` calls automatically include.

```ts
import { configureBPMClient, loginApi } from '@rytass/bpm-core-client';

async function bootstrap(): Promise<void> {
  configureBPMClient({
    baseUrl: process.env.BPM_API_URL ?? 'http://localhost:17603',
    fetch: globalThis.fetch,
  });
  await loginApi({
    identifier: process.env.BPM_SYNC_IDENTIFIER!,
    password: process.env.BPM_SYNC_PASSWORD!,
  });
  // Subsequent calls to readOrganizationDashboard / createOrgUnit / etc.
  // automatically forward the session cookie.
}
```

Caveats: `globalThis.fetch` on Node 20+ does **not** maintain a cookie
jar across calls by default — set up one of:

- `undici`'s `Agent` with `cookies` enabled, then `setGlobalDispatcher(agent)`
- the `tough-cookie` + `node-fetch-cookies` pairing
- BPM's `configureBPMClient({ fetch: cookieAwareFetch })` injection

Without a cookie jar, the login succeeds but no subsequent call carries
the session. Most production deployments already use `undici` with
cookie support; verify before shipping.

#### Pattern 2 — Service token header (when supported by host)

If your wrapper host issues a long-lived service token (e.g. a JWT
signed with a known shared secret), pass it through
`configureBPMClient`'s `headers`:

```ts
configureBPMClient({
  baseUrl: process.env.BPM_API_URL!,
  headers: { Authorization: `Bearer ${process.env.BPM_SERVICE_TOKEN!}` },
});
```

### Dynamic form option DataSources

The host owns the actual ERP, database, or integration-bus implementation. It
registers one versioned catalog provider; a form stores only the source key,
version, and field/constant bindings:

```ts
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPM_MEMBER_RESOLVER,
  BPMRootModule,
} from '@rytass/bpm-core-nestjs-module';
import { HostFormDataSourceRegistry } from './host-form-data-source.registry';

BPMRootModule.forRoot({
  formDataSourceRegistryProvider: {
    provide: BPM_FORM_DATA_SOURCE_REGISTRY,
    useClass: HostFormDataSourceRegistry,
  },
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

`formDataSources`, `previewFormFieldOptions` and
`previewResolveFormFieldOptions` are designer-only GraphQL queries.
`formFieldOptions` and `resolveFormFieldOptions` are authenticated runtime
queries whose source reference comes from the server's published form version
or returned-instance snapshot; each requires exactly one of `templateId` or
`instanceId`. Missing registry versions, unsupported controls, incomplete
bindings, provider failures, and over-limit results return stable DataSource
error codes.

The two `*Resolve*` queries are read-only: they confirm already-selected values
and report the ones the source can no longer account for in `unresolvedValues`
instead of failing, so a renderer can mark dead options individually. When a
required parameter still has no value, an option or resolve result comes back
with `waitingForFieldKeys` naming the fields to fill and no provider call is
made — only the server knows which bound parameters are required.

On submit, the engine resolves every selected DataSource-backed value on the
server and stores the returned labels, source version, binding hash, and
validation timestamp in `approval_instances.form_data_option_snapshot`. A
resubmit resolves outside the database transaction, then rechecks the
instance revision under the transaction lock before writing form data and its
snapshot atomically. This keeps historical labels readable even when a host
later removes a registry version, while changed bindings or an `ALWAYS`
revalidation policy still require a live provider call.

The repository wrapper host demonstrates the contract with
`ApiFormDataSourceRegistry` and the seeded `demo.cost-centers@1` family. Its
database table and reset ownership remain in `apps/api`; an external host should
replace that provider through `BPMRootModule.forRoot()` and keep its own source
data and authorization rules outside the BPM package.

This requires the wrapper host's auth middleware to honor `Authorization`
headers (member-base hosts can be configured to do so via
`authStrategy: 'jwt'` in addition to `cookieMode: true`).

#### Pattern 3 — Direct cookie injection (testing only)

For integration tests where you've already obtained a session cookie
out-of-band (e.g. from a Playwright fixture), pass it raw:

```ts
configureBPMClient({
  baseUrl: 'http://localhost:17603',
  headers: { Cookie: 'access_token=<jwt>; refresh_token=<jwt>' },
});
```

Do not use this in production scripts — cookies expire and the script
must handle refresh, which means you actually want Pattern 1.

### Coexisting with a host's existing `<AuthProvider>`

Many host applications (Shuttle, custom admin panels) already mount
their own `<AuthProvider>` at the root of the Next.js tree. BPM's
`<AuthProvider>` (mounted indirectly via `<BPMNextProviders>`) is a
**separate context** that only tracks BPM session state. The two do
not conflict — they coexist as parallel React contexts:

```tsx
// app/layout.tsx — host's root layout (untouched)
import { HostAuthProvider } from '@your-host/auth';

export default function RootLayout({ children }) {
  return (
    <html><body>
      <HostAuthProvider>{children}</HostAuthProvider>
    </body></html>
  );
}

// app/operations/approval/layout.tsx — BPM sub-tree
'use client';
import { BPMNextProviders } from '@rytass/bpm-core-react/next';

export default function ApprovalLayout({ children }) {
  return (
    <BPMNextProviders loginPath="/login">
      {children}
    </BPMNextProviders>
  );
}
```

Rules of thumb:

- **Scope `<BPMNextProviders>` to the BPM sub-tree** — never put it at
  the root. Otherwise every host page goes through BPM's auth gate,
  which redirects unauthenticated users to BPM's `/login`.
- **BPM auth and host auth share the cookie jar** when same-origin.
  If `<BPMNextProviders loginPath="/login">` and the host's auth share
  `/login`, the same login form can satisfy both — implement the host
  login endpoint to also satisfy `/auth/login` from BPM's contract.
- **Do not import `<AuthProvider>` from `@rytass/bpm-core-react`
  directly** if you've already mounted `<BPMNextProviders>` —
  double-wrapping creates redundant `/auth/me` polls.

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
      roles: bpmRoles,
      permissions: [], // Host can also use `bpm:*` style permissions if preferred.
      // The BPMAuthContext shape does NOT include name/email — those are
      // surfaced through BPMMemberResolver instead. If you want them
      // available to downstream resolvers without an extra resolver call,
      // stash them in `metadata` (BPM passes it through unchanged).
      metadata: { name: member.name, email: member.email },
    };
  }
}
```

> **`BPMAuthContext` shape**: `{ memberId, roles, permissions, metadata }`
> — exactly four fields. The host's `name` / `email` are not part of the
> contract; resolvers call `BPMMemberResolver.resolve(memberId)` when
> they need display data.

> The host owns the mapping table. Keep it in one place (a constant
> module or a database table) so adding a new BPM tier in a future
> BPMCore release becomes a one-line addition.

### Coexisting with a host global guard

`APP_GUARD`-registered guards run **before** BPM's own. A guard that decides
by route metadata therefore judges BPM's resolvers by metadata BPM never
writes — and `@rytass/member-base-nestjs-module`'s `CasbinGuard` rejects any
route without `@CheckPermission`:

```json
{ "errors": [{ "message": "Route has no permission metadata",
               "path": ["orgUnits"],
               "extensions": { "code": "FORBIDDEN" } }] }
```

Every BPM query and mutation fails this way, before BPM's guards run at all.
BPM cannot import the host's decorator, and a decorator cannot read module
options — it runs when the class is defined. So BPM's resolvers register
themselves, and `resolverMetadataFactory` replays your factory over them at
module wiring time:

```ts
import { PERMISSION_METADATA_KEY } from '@rytass/member-base-nestjs-module';
import { BPMRootModule, type BPMResolverMetadataFactory } from '@rytass/bpm-core-nestjs-module';

const HOST_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  admin: ['bpm:admin'],
  authenticated: ['bpm:use'],
  designer: ['bpm:design'],
};

const resolverMetadataFactory: BPMResolverMetadataFactory = ({ access }) => ({
  [PERMISSION_METADATA_KEY]: HOST_PERMISSIONS[access],
});

BPMRootModule.forRoot({ resolverMetadataFactory, /* ... */ });
```

The factory is called once per handler and receives `{ access, resolverName,
methodName }`. `access` is the authority BPM's own guards require —
`'admin'`, `'designer'`, or `'authenticated'` — so the common case is one
lookup table rather than a per-operation list. `methodName` is also the
GraphQL field name (`orgUnits`, `createOrgUnit`, `member`) when a handful of
operations need finer grants. Returning `null` leaves a handler untouched.

The returned record is written onto the prototype method, which is exactly
what Nest hands a guard as `context.getHandler()`; BPM's own guards still run
afterwards, so both permission models apply.

`listBPMResolverHandlers()` prints every handler the factory will be offered,
which is the quickest way to build the mapping table:

```ts
import { listBPMResolverHandlers } from '@rytass/bpm-core-nestjs-module';

console.table([...listBPMResolverHandlers()]);
```

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
  createBPMMemberBaseResolverProvider<HostMember>({
    // ^^^^^^^^^^^^ explicit generic is recommended — without it,
    // TS infers `unknown` for the adapter callbacks below and you get
    // "Parameter 'member' implicitly has an 'any' type" errors.
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
2. **`metadataJson` is write-only.** The mutations
   (`createOrgUnit`/`updateOrgUnit`/`createPosition`/`updatePosition`)
   accept a `metadataJson` string that BPM stores verbatim. **However**,
   `OrgUnitRecord` and `PositionRecord` returned by
   `readOrganizationDashboard` do NOT include the metadata field —
   it's intentionally hidden so the JSON blob doesn't bloat every
   pagination payload. **For reconciliation, always key on `code`**
   (which IS returned). Treat `metadataJson` as a debugging/audit
   stash, not a live FK pointer.
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
- `createPosition({ code, name, level, metadataJson })` — `level` (1+) controls hierarchy weight (higher = more senior, used by manager-resolution priority sort); `metadataJson` is required (pass `'{}'` if unused)
- `updatePosition({ id, code, name, level, metadataJson })` — every field except `id` is `T | null`; pass `null` to leave a field unchanged
- `createMembership({ memberId, orgUnitId, positionId, isPrimary, effectiveFrom, effectiveTo })` — `positionId` and `effectiveTo` accept `null`; `effectiveFrom` is an ISO timestamp string. Uniqueness key is `(memberId, orgUnitId, positionId)`
- `updateMembership({ id, orgUnitId, positionId, isPrimary, effectiveFrom, effectiveTo })` — every field except `id` is `T | null`
- `createManagerResolution({ scopeType, scopeId, managerMemberId, priority, effectiveFrom, effectiveTo })` — `scopeType` is `'MEMBER' | 'ORG_UNIT' | 'POSITION'`; `priority` orders the resolver chain (lower number = checked first)
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
  readonly type: OrgUnitType;       // 'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM'
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
| `resolverMetadataFactory`                        | `undefined`                    | Stamps the host's own route metadata onto every BPM GraphQL handler. Required when the host installs a global metadata-driven guard — see "Coexisting with a host global guard". |
| `attachmentStorageProvider`                      | local `.storage/attachments`   | Host-provided `@rytass/storages` adapter.                      |
| `workflowServiceTaskDispatcherProvider`          | built-in `fetch` dispatcher    | Host provider for executable workflow `WEBHOOK` service tasks. |
| `businessCalendarProvider`                       | Monday–Friday calendar         | Host provider for `BPM_BUSINESS_CALENDAR`, used by `BUSINESS_DAY` SLAs. BPMCore ships no holiday data. |
| `formDataSourceRegistryProvider`                 | Empty catalog                  | Single host provider for versioned Select / AutoComplete / Radio / Checkbox DataSources. |
| `attachmentRoutePrefix`                          | `/attachments`                 | Drives both the BPM signed URL path and the Nest controller mount path for `AttachmentController`. Must be set at module wiring time (see "Attachment Storage" below). |
| `attachmentStorageProviderId`                    | `local`                        | Value stored on attachment metadata for the active adapter.    |
| `attachmentPublicBaseUrl`                        | `http://localhost:17603`       | Public base URL for signed attachment URLs.                    |
| `attachmentSignedUrlSecret`                      | local development secret       | HMAC secret for signed attachment download/preview tokens. Under `NODE_ENV=production` BPM refuses to start while this is unset. |
| `attachmentAllowInsecureSignedUrlSecret`         | `false`                        | Opt-in that lets a `NODE_ENV=production` process boot on the built-in development secret anyway. Only for throwaway environments — the value is published in this package. |
| `attachmentSignedUrlTtlSeconds`                  | `300`                          | Signed attachment URL lifetime in seconds.                     |
| `identityMemberMetadataCacheTtlMs`               | `300000`                       | Member metadata cache TTL.                                     |
| `identityRegisterResolvers`                      | `true`                         | Set to `false` when the host already publishes `member` / `members` / `memberCount` / `searchMembers` GraphQL queries. `IdentityService` stays available either way. |
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
| `notificationSlaBusinessCalendarTimeZone`        | `UTC`                          | IANA zone for the built-in weekday calendar. Ignored when `businessCalendarProvider` is set. |
| `notificationSlaTimeoutRemindEnabled`            | `true`                         | Enables SLA timeout `REMIND`.                                  |
| `notificationSlaTimeoutAutoApproveEnabled`       | `false`                        | Enables SLA timeout `AUTO_APPROVE`.                            |
| `notificationSlaTimeoutEscalateEnabled`          | `false`                        | Enables SLA timeout `ESCALATE`.                                |
| `notificationSlaTimeoutTerminateInstanceEnabled` | `false`                        | Enables SLA timeout `TERMINATE_INSTANCE`.                      |
| `notificationTemplateEngine`                     | `simple`                       | `simple` only — `handlebars` is reserved and currently rendered as `simple`. |
| `notificationDefaultChannels`                    | `[IN_APP]`                     | Fallback channels when a workflow node has no channel list.    |
| `notificationDefaultEmailDigestMode`             | `INSTANT`                      | Default digest mode for missing preferences.                   |
| `notificationDefaultInAppPreferenceEnabled`      | `true`                         | Default in-app preference for missing preferences.             |
| `notificationDefaultEmailPreferenceEnabled`      | `true`                         | Default email preference for missing preferences.              |
| `notificationQuietHoursTimeZone`                 | registered calendar's zone     | IANA zone the members' `quietHoursStart` / `quietHoursEnd` are read in. Falls back to `BPM_BUSINESS_CALENDAR.timeZone`, then `UTC`. |
| `notificationEmailDigestHour`                    | `9`                            | Local hour a `DAILY` recipient's held email is flushed.        |
| `signatureCurrentKeyVersion`                     | `1`                            | Key version used for new signatures.                           |
| `signatureKeyProvider`                           | local development key provider | Host key provider for signing and verification.                |
| `signatureTimestampProvider`                     | mock timestamp provider        | Host timestamp token provider.                                 |

Production deployments should override all local development secrets.

### Mounting a single domain module

`BPMRootModule` is the supported entry point and the only one that wires the
whole product. A host that wants **one** BPM domain — most often organization
data, with no workflow, forms, or notifications — can import that domain
module on its own. These are self-contained: they declare their own
`TypeOrmModule.forFeature` and their services inject nothing but `DataSource`
and repositories.

```ts
import { Module } from '@nestjs/common';
import { OrganizationModule, OrganizationService } from '@rytass/bpm-core-nestjs-module';

@Module({ imports: [OrganizationModule] })
export class HostOrganizationModule {}
```

| Module               | Self-contained | Notes                                                                |
| -------------------- | -------------- | -------------------------------------------------------------------- |
| `OrganizationModule` | yes            | Org units, positions, memberships, manager resolution. Mounted alone, `deletePosition` silently skips its approval-template and ad-hoc-directive reference checks (it logs when it does) — those tables are not in the schema. |
| `FormModule`         | yes            | Form definitions and versions.                                        |
| `TemplateModule`     | yes            | Approval templates, versions, categories.                             |
| `ConditionModule`    | yes            | CEL lint and evaluation only.                                         |
| `IdentityModule`     | no             | Needs `memberResolverProvider`; use `IdentityModule.forRoot(...)`.     |
| `AttachmentModule`   | no             | Needs storage and signed-URL options; use `AttachmentModule.forRoot(...)`. |

What you still owe them:

- **Migrations.** `BPM_CORE_MIGRATIONS` is one list for the whole package; a
  single-module host still runs all of it, and still needs the extensions in
  "Database prerequisites" below.
- **Auth.** A domain module imported directly does not bring `BPMAuthModule`,
  so `@BPMAdminOnly()` on its resolvers has no auth context accessor to
  inject. Either import `BPMAuthModule.forRoot({ contextFactory })` alongside
  it, or use the domain **service** and publish your own GraphQL surface.

The domain services (`OrganizationService` and friends) are the stable part of
this arrangement; a module's internal wiring is not. If you are here because
`BPMRootModule` collides with your schema, `identityRegisterResolvers` and
`resolverMetadataFactory` usually let you keep the supported entry point.

### Testing a host that depends on BPM

BPM loads `cel-js` — ESM-only, with a `chevrotain` dependency whose exports
map `jest-resolve` cannot follow — lazily, on the first CEL expression it
parses. Importing anything from the package root does not reach it, so a host
jest suite needs no `moduleNameMapper` entry and no stub.

A suite that *does* exercise conditions (template validation, workflow
transitions) will load `cel-js` for real. If your jest version cannot resolve
it, map it to a stub of your own:

```ts
// jest.config.ts
moduleNameMapper: { '^cel-js$': '<rootDir>/test/cel-js.stub.ts' },
```

## Database Setup

### Database prerequisites

BPM's first migration enables two PostgreSQL extensions — `uuid-ossp` for
`uuid_generate_v4()` defaults and `ltree` for the org unit `path` column:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";
```

`CREATE EXTENSION` needs the CREATE privilege **on the database**, which a
least-privilege application role normally does not have — including on Rytass
platforms, where that privilege is revoked by convention. Have a superuser,
the database owner, or `rds_superuser` run the two statements once before the
first migration run.

If the extensions are already installed, the migration detects them and skips
the statements, so a least-privilege role can run migrations normally. If they
are missing and the role cannot create them, the migration stops with the SQL
above and who needs to run it, rather than a bare `42501`.

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

Concrete wiring:

```ts
// apps/api/src/app/app.module.ts
@Module({
  imports: [
    // Host's existing TypeORM connection (default name, host's schema).
    TypeOrmModule.forRootAsync({
      imports: [HostVaultModule],
      inject: [HostVaultService],
      useFactory: (vault) => buildHostDataSourceOptions(vault),  // schema: 'public'
    }),
    // BPM's own connection (named, separate schema, separate Vault path).
    TypeOrmModule.forRootAsync({
      name: 'bpm',                              // <-- distinct connection name
      imports: [BPMVaultModule],
      inject: [BPMVaultService],
      useFactory: buildTypeOrmModuleOptions,    // reads DB_SCHEMA=bpm_core from Vault
    }),
    // Hand BPM the connection name so its repositories bind to the right pool.
    BPMRootModule.forRootAsync({
      typeormConnectionName: 'bpm',
      // ...
    }),
  ],
})
```

If the host runs only one Vault path (e.g. `shuttle/develop`) and you
want to keep secrets there, expose `bpm_core/*` keys under the host
path with a prefix and provide a custom factory that reads them — BPM
doesn't require its own Vault path, only that the secrets are
available to `buildTypeOrmModuleOptions`.

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
- Form option DataSource catalog, designer preview, authenticated runtime option
  queries, and read-only value-resolve queries for both preview and runtime.
- Approval templates, template versions, categories, validation, and dry run.
- Workflow instances, tokens, tasks, task candidates, decisions, activity logs,
  submit/process/approve/return/cancel/resubmit operations.
- Ad-hoc directives — see [Ad-hoc Directives](#ad-hoc-directives) below.
- Delegation rule CRUD and transfer support.
- Notifications, unread counts, preferences, and read status.
- Attachments, signed download URLs, and signed preview URLs.
- Decision signatures and signature-chain verification.

The schema is generated by NestJS GraphQL code-first decorators. Configure the
host `GraphQLModule` with `autoSchemaFile` if you want NestJS to generate the
schema at runtime.

## Ad-hoc Directives

Stage approvers can attach **instance-scoped** directives to the single
approval instance they are deciding — the workflow template is never
modified. Four directive types exist (`AdhocDirectiveTypeEnum`):

| Type | Trigger | Effect |
|---|---|---|
| `COUNTERSIGN` | Next user task is created | Spawns a parallel ad-hoc task for the target on that stage. The token only advances once the original task **and** every countersign task are approved; a countersigner's rejection rejects the instance. |
| `PRE_APPROVAL` | Immediately | Spawns a blocking ad-hoc task on the current stage. `onReject` (`AdhocPreApprovalRejectBehaviorEnum`) chooses `REJECT_INSTANCE` (whole instance rejected) or `RETURN_TO_ORIGIN` (decision handed back to the original approver, re-opening their task if needed). |
| `STAGE_NOTIFY` | Current stage ends (approved / rejected / returned) | Notifies the target — members through `NotificationService`, webhooks through `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER`. |
| `COMPLETION_NOTIFY` | Instance reaches `APPROVED` / `REJECTED` / `CANCELLED` | Same delivery as `STAGE_NOTIFY`. |

GraphQL surface: mutations `requestAdhocCountersign(taskId, target, comment?)`,
`requestAdhocPreApproval(taskId, target, onReject, comment?)`,
`configureAdhocStageNotification(taskId, input)`,
`configureAdhocCompletionNotification(taskId, input)`,
`cancelAdhocDirective(directiveId)`; query `adhocDirectives(instanceId)`.
Every mutation acts as the current auth-context member, who must be the
task's assignee or candidate.

Behavioral contract:

- Countersign / pre-approval are gated by the node's
  `UserTaskNodeData.allowAddSigner` flag (template designers opt nodes in);
  the notification directives have no gate.
- `AdhocTargetInput` is polymorphic: `kind` = `MEMBER` (`memberIds`),
  `POSITION` (`positionId`), `ORG_UNIT_MEMBER` (`orgUnitId`,
  `includeDescendants?`), or `WEBHOOK` (`webhookUrl`,
  `webhookHeadersJson?` — notifications only). Member-style signers run
  through the same delegation pipeline as template-resolved approvers.
- Directive lifecycle (`AdhocDirectiveStatusEnum`): `PENDING` → `CONSUMED`
  when the effect applies, or `CANCELLED` when withdrawn by its creator or
  dropped by a return / reject / cancel of the instance. Returned instances
  do not replay flow-affecting directives after resubmission.
- Notification recipients gain read access to the instance they were
  notified about.
- Storage: `AdhocDirectiveEntity` (`task_adhoc_directives` table) plus
  ad-hoc columns on `tasks`, created by migration
  `AdhocDirectives0000000017000` — included in `BPM_CORE_MIGRATIONS`, so
  hosts running the bundled migrations pick it up automatically.

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

- **BREAKING (upgrade note).** Replace all local fallback secrets before
  production. Under `NODE_ENV=production`, `attachmentSignedUrlSecret` is now
  enforced: BPM refuses to start rather than sign attachment URLs with the
  value published in this package. `BPMRootModule` mounts `AttachmentModule`
  unconditionally, so this applies **even to a host that never serves
  attachments** — an existing production deployment that never set the secret
  will fail to boot after upgrading. Set the secret, or set
  `attachmentAllowInsecureSignedUrlSecret: true` to acknowledge that the
  signing key is public and boot anyway. Never set that flag on anything
  serving real attachments.
- Use a production storage adapter instead of local filesystem storage.
- Keep old signature keys available for verification after key rotation.
- Keep in-process schedulers disabled in API replicas unless a dedicated worker
  is not available.
- Do not enable TypeORM `synchronize` in production.
- Ensure GraphQL auth context is available for protected operations.
- Run migrations before serving traffic with a new package version, and
  install the PostgreSQL extensions listed under "Database prerequisites"
  once, with a privileged role, before the first run.

## License

MIT
