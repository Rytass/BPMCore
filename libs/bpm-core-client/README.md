# @rytass/bpm-core-client

Framework-agnostic TypeScript client for the BPM approval workflow GraphQL
surface published by
[`@rytass/bpm-core-nestjs-module`](https://www.npmjs.com/package/@rytass/bpm-core-nestjs-module).

This package contains:

- A tiny `fetch`-based GraphQL transport (`requestGraphQl`).
- Endpoint resolution helpers (`readGraphQlEndpoint`, `readApiBaseUrl`).
- The BPM host auth REST client (`loginApi`, `logoutApi`, `readApiCurrentMember`, `listApiTestMembers`).
- Pre-baked typed GraphQL operations for organization, member directory, form
  definition, approval template, workflow instance, task, notification,
  attachment, signature, and delegation flows.

It does **not** ship React components, hooks, or UI. Hosts can call the
functions directly from any framework (Next.js / Vite / Remix / plain Node).

## Package Status

Current version: `0.1.2`

The package intentionally stays framework-agnostic so it can be reused from
Next.js Server Components, Server Actions, plain React, or non-React
runtimes. There is no Apollo Client setup.

## Install

```bash
pnpm add @rytass/bpm-core-client @rytass/bpm-core-shared
```

`@rytass/bpm-core-shared` is a `peerDependency` and must be installed
alongside.

The browser bundle uses the standard Fetch API; Node 20+ also has `fetch`
built in. No `graphql` runtime package is required.

**TypeScript moduleResolution**: prefer `node16`, `nodenext`, or `bundler` in
your `tsconfig.json` so the package's `exports` field is honored. Classic
`moduleResolution: "node"` also works through the `typesVersions` fallback
shipped with this package, but is on TypeScript's long-term deprecation
path — new projects should opt in to modern resolution.

## Runtime Compatibility

> **TL;DR — the transport is isomorphic (always `fetch`), but session is
> browser-first.** Out of the box every function works in a browser tab.
> Server Components, Server Actions, Node CLIs, workers, and Edge Functions
> can also call the same functions, but the caller is responsible for
> resolving the endpoint to an absolute URL and for forwarding any
> session cookie.

### What is identical across runtimes

| Concern             | Behavior                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport           | Always `globalThis.fetch`. No `axios`, no `node-fetch`, no `cross-fetch`, no Apollo Link.                                                         |
| Serialization       | `Content-Type: application/json`; `POST { query, variables }`.                                                                                    |
| Error model         | Throws `Error` on non-2xx HTTP, on `payload.errors[]`, or on missing `data`.                                                                      |
| Type guarantees     | Every function returns a typed `Promise<T>` — return shape is identical regardless of where the call runs.                                        |

### What differs across runtimes

| Concern                | Browser                                                                                  | Node SSR / Server Component / CLI                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Default endpoint       | Same-origin `/graphql` resolves to `https://your-host/graphql`.                          | Same-origin `/graphql` **throws** `TypeError: Failed to parse URL`. Set `NEXT_PUBLIC_API_URL` to an absolute URL.                     |
| Session cookie         | `credentials: 'include'` automatically sends the HttpOnly cookie issued by `/auth/login`.| `fetch` has no cookie jar; the host must forward the incoming request's `Cookie` header manually.                                     |
| `loginApi()` storage   | Cookie lands in browser jar, persists across navigations.                                | Returned `Set-Cookie` header is dropped — caller must read and reuse it explicitly.                                                   |
| `window.location`      | Used to detect `localhost` for the dev fallback endpoint.                                | `typeof window === 'undefined'` → endpoint resolver returns `/graphql` (relative), which is invalid in Node unless overridden.        |

### Server Component / Server Action recipe

Next.js App Router server runtime needs two things: an absolute endpoint and
a way to relay the inbound `Cookie` header. The recommended pattern is to
set `NEXT_PUBLIC_API_URL` at build time and pass cookies via the underlying
`fetch` headers using a wrapper such as Next's `cookies()`:

```ts
// app/inbox/page.tsx — Server Component
import { cookies } from 'next/headers';

async function fetchInbox(): Promise<unknown> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${process.env.BPM_API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      query: 'query Ping { memberCount }',
    }),
  });
  return response.json();
}
```

> For SSR cases that need to call **many** typed functions, the cleanest
> long-term option is to add a `configureBPMClient({ fetch, endpoint })`
> hook so the typed wrappers can be reused. That is not yet shipped — if
> you need it, file an issue. Today, Server Component callers either talk
> to the host directly (as above) or proxy through a Route Handler that
> runs inside the consumer's browser session.

### Node CLI recipe

CLIs that drive BPM from outside a browser need both an absolute endpoint
and explicit session management. The auth REST client (`loginApi`,
`logoutApi`, `readApiCurrentMember`) returns typed bodies but does not
persist cookies in Node — capture them yourself:

```ts
// scripts/dump-running-instances.ts
import { listApprovalInstancesPage } from '@rytass/bpm-core-client/workflow';

process.env.NEXT_PUBLIC_API_URL ??= 'https://bpm.your-host.example/graphql';

// 1. Log in and capture the session cookie manually.
const loginResponse = await fetch(
  'https://bpm.your-host.example/auth/login',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'svc-bot', password: '...' }),
  },
);
const cookieJar = loginResponse.headers.get('set-cookie') ?? '';

// 2. Hand the cookie to subsequent fetches via a small fetch override.
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input, init = {}) =>
  originalFetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: cookieJar },
  })) as typeof fetch;

// 3. Call typed BPM functions as usual.
const { instances } = await listApprovalInstancesPage({
  view: 'ALL', state: 'RUNNING', page: 1, pageSize: 1000,
  searchText: '', templateId: null,
});
console.log(instances.length, 'running instances');
```

### Edge / Workers

Cloudflare Workers, Vercel Edge Functions, and similar V8-isolate runtimes
ship `fetch` natively and follow the **Node SSR** column above — no
default endpoint, no cookie jar. Treat them the same as Server Components.

## Endpoint Resolution

By default the client targets the same origin (no `/api` prefix) — see the
"Embedding & auth" section of `@rytass/bpm-core-nestjs-module`'s README for
the host-side contract. Endpoint resolution rules:

| Source                                          | Behavior                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `process.env.NEXT_PUBLIC_API_URL`               | If set, used as the GraphQL endpoint URL.                                  |
| `process.env.NEXT_PUBLIC_API_AUTH_URL`          | If set, used as the base URL for the REST `/auth/*` endpoints.             |
| Browser hostname `localhost` or `127.0.0.1`     | GraphQL defaults to `http://localhost:17603/graphql`.                      |
| Deployed hostname (anything else, or SSR)       | GraphQL defaults to same-origin `/graphql`; auth uses same-origin root.    |

```ts
import {
  loginApi,
  readApiCurrentMember,
  readApiBaseUrl,
  readGraphQlEndpoint,
  requestGraphQl,
} from '@rytass/bpm-core-client';

console.log(readGraphQlEndpoint());
console.log(readApiBaseUrl());

const member = await loginApi({ identifier: 'member-001', password: 'demo' });
const currentMember = await readApiCurrentMember();

interface PingQueryData {
  readonly memberCount: number;
}

const data = await requestGraphQl<PingQueryData>(`
  query Ping {
    memberCount
  }
`);
```

`requestGraphQl` always sends `credentials: 'include'`, so the HTTP-only
session cookie issued by the BPM host's `/auth/login` flows back automatically
on subsequent calls.

## Subpath Overview

| Import path                              | Contents                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@rytass/bpm-core-client`                | GraphQL transport, endpoint resolution, REST auth client, member directory queries.                    |
| `@rytass/bpm-core-client/organization`   | Org unit CRUD, position CRUD, membership CRUD, manager resolution.                                     |
| `@rytass/bpm-core-client/form`           | Form definition CRUD, form version management, schema parsing helpers (`form-rendering`).              |
| `@rytass/bpm-core-client/template`       | Approval template CRUD, category management, version publish/revert.                                   |
| `@rytass/bpm-core-client/workflow`       | Instance submit / decide / cancel, task queries, notification queries, attachment & signature reads.   |

Every subpath uses the same `requestGraphQl` transport from the root. Hosts
can mix and match — for example a read-only dashboard might only import
`workflow` queries, never reaching for `/organization` mutations.

## Organization Mirror Pattern (Important)

> **TL;DR:** BPM owns the org graph (`org_units`, `positions`,
> `memberships`, `manager_resolutions`). Hosts with their own org model
> mirror data **into** BPM via the `/organization` mutations rather than
> exposing a host-side resolver. See the
> "Organization Data Ownership" section of
> `@rytass/bpm-core-nestjs-module`'s README for the rationale.

The integration shape is **asymmetric** with `BPMMemberResolver`:
member identity stays in the host's user table and BPM reaches in via
the resolver token; the org structure lives in BPM and the host pushes
data in. Three rules keep the mirror idempotent:

1. **Use `code` as the natural key.** Both `OrgUnit` and `Position`
   carry a unique `code` you control. On every sync, look up by `code`
   before deciding INSERT vs UPDATE.
2. **Stash the host-FK in `metadata`.** Both entities carry an opaque
   `metadata` JSON BPM never introspects — store your host's primary
   key there to chase pointers back during reconciliation.
3. **Soft-delete via the `delete*` mutations.** They set `deletedAt`;
   live queries (`orgUnits`, `orgUnitCount`, etc.) filter soft-deleted
   rows automatically.

Quick wire-up using only this package's exports:

```ts
import {
  createOrgUnit,
  updateOrgUnit,
  orgUnits,
} from '@rytass/bpm-core-client/organization';

async function upsertOrgUnit(hostUnit: {
  code: string;
  name: string;
  type: 'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM';
  parentCode: string | null;
  hostId: string;
}): Promise<string> {
  const existing = (await orgUnits({ searchText: hostUnit.code })).find(
    (u) => u.code === hostUnit.code,
  );
  const parentId = hostUnit.parentCode
    ? (await orgUnits({ searchText: hostUnit.parentCode })).find(
        (u) => u.code === hostUnit.parentCode,
      )?.id ?? null
    : null;
  const metadataJson = JSON.stringify({ hostId: hostUnit.hostId });

  if (existing) {
    return (
      await updateOrgUnit({
        id: existing.id,
        input: { ...hostUnit, parentId, metadataJson },
      })
    ).id;
  }
  return (await createOrgUnit({ ...hostUnit, parentId, metadataJson })).id;
}
```

`createPosition`, `createMembership`, `updateMembership`, and
`createManagerResolution` follow the same pattern. For bulk tree moves
in one transaction, see `commitOrgUnitTreeDraft`.

## Auth REST Endpoints

The BPM wrapper-host exposes the following endpoints under the host root (no
`/api` prefix; do not enable Nest `setGlobalPrefix` on a BPM host):

| Method | Path                  | Function                                  |
| ------ | --------------------- | ----------------------------------------- |
| GET    | `/auth/test-members`  | `listApiTestMembers()`                    |
| POST   | `/auth/login`         | `loginApi({ identifier, password })`      |
| GET    | `/auth/me`            | `readApiCurrentMember()` (returns `null` on `401`) |
| POST   | `/auth/logout`        | `logoutApi()`                             |

If your production host names its auth endpoints differently, set
`NEXT_PUBLIC_API_AUTH_URL` so the client points at the right base URL, and
implement those paths server-side.

## GraphQL Operations

Each subpath exports typed wrapper functions over `requestGraphQl`. Records
returned from these functions match the BPM GraphQL schema field-by-field.
Examples:

```ts
import { resolveMembers, searchMembers } from '@rytass/bpm-core-client';
import {
  listApprovalInstances,
  decideTask,
  submitApprovalInstance,
} from '@rytass/bpm-core-client/workflow';
import { listApprovalTemplates } from '@rytass/bpm-core-client/template';
import { listFormDefinitions } from '@rytass/bpm-core-client/form';
import { listOrgUnits, listPositions } from '@rytass/bpm-core-client/organization';

const members = await resolveMembers(['member-001', 'member-002']);
const templates = await listApprovalTemplates({ status: 'PUBLISHED' });
const inbox = await listApprovalInstances({ assigneeMemberId: members[0]?.memberId ?? null });
```

The available operations track the BPM resolvers; consult the GraphQL schema
file generated by the host's `GraphQLModule` (`autoSchemaFile`) for the
authoritative list.

## React / Next.js Integration

The client is intentionally hookless. Hosts compose their own hook layer on
top — for example with React Query or SWR:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { resolveMembers } from '@rytass/bpm-core-client';

export function useMembers(memberIds: readonly string[]) {
  return useQuery({
    queryKey: ['members', memberIds],
    queryFn: () => resolveMembers(memberIds),
    enabled: memberIds.length > 0,
  });
}
```

For Next.js App Router Client Components the typed wrappers work
out of the box (same-origin endpoint, browser cookie jar). For Server
Components, Server Actions, Route Handlers, Edge runtimes, or plain Node
CLIs, see **[Runtime Compatibility](#runtime-compatibility)** — those
runtimes need an absolute endpoint and manual cookie forwarding.

## Local Development

From this monorepo the client is automatically available through the
`@rytass/bpm-core-client` TypeScript path alias; no `pnpm link` step is
required.

External consumers should run against a host built with
`@rytass/bpm-core-nestjs-module` (sample host: `apps/api` in this repo). The
sample host exposes:

- `http://localhost:17603/graphql`
- `http://localhost:17603/auth/*`
- `http://localhost:17603/attachments/:id/download`

## Verification

```bash
pnpm nx typecheck bpm-core-client
pnpm nx test bpm-core-client
pnpm nx build bpm-core-client
```

## License

MIT
