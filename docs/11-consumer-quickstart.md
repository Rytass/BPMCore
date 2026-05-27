# 11 — Consumer Quickstart

把 `@rytass/bpm-core-nestjs-module`、`@rytass/bpm-core-client`、`@rytass/bpm-core-shared` 三個套件接到自己的專案的最短路徑。

本文件假設你已經有一個 PostgreSQL（含 `uuid-ossp` 與 `ltree` 擴充）、自己的 member directory，以及任何形式的 session / cookie 機制（BPMCore 不擁有登入流程）。

> 三個套件的角色：
> - **`@rytass/bpm-core-shared`** — 純 TypeScript 型別契約，前後端共用。
> - **`@rytass/bpm-core-nestjs-module`** — NestJS module，提供 BPM 後端 domain 行為。
> - **`@rytass/bpm-core-client`** — Framework-agnostic GraphQL/REST 客戶端，可從 Next.js、Vite、純 Node 使用。

---

## 0. TypeScript moduleResolution

三個套件都用 `package.json` 的 `exports` 欄位定義 subpath。**強烈建議** 消費端 tsconfig 使用 `node16` / `nodenext` / `bundler` 其中之一：

```jsonc
{
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16"
  }
}
```

若使用舊版 `moduleResolution: "node"`，三個套件都另外提供了 `typesVersions` fallback，subpath types 仍可解析；但這條路徑長期會被 TS 淘汰，新專案請直接用 modern resolution。

## A. NestJS 後端宿主

### 1. 安裝

```bash
pnpm add @rytass/bpm-core-nestjs-module @rytass/bpm-core-shared
pnpm add @nestjs/common @nestjs/core @nestjs/graphql @nestjs/typeorm graphql typeorm reflect-metadata
pnpm add @nestjs/apollo @apollo/server                # 若用 Apollo
pnpm add pg                                            # PostgreSQL 驅動
pnpm add @rytass/secret-adapter-vault-nestjs           # 可選：若用 Vault 管 DB 秘密
```

### 2. 最小 `AppModule`

```ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import {
  BPMRootModule,
  BPM_MEMBER_RESOLVER,
  type BPMAuthContext,
  type BPMMemberResolver,
  buildBPMDataSourceOptions,
} from '@rytass/bpm-core-nestjs-module';
import type { MemberMetadata } from '@rytass/bpm-core-shared';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// (1) Host-side member directory adapter — adapt to your auth source.
class HostMemberResolver implements BPMMemberResolver {
  async resolve(memberId: string): Promise<MemberMetadata> {
    // Hit your user directory or local DB here.
    return {
      memberId,
      email: `${memberId}@example.com`,
      name: memberId,
      customFields: {},
    };
  }

  async resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>> {
    const entries = await Promise.all(memberIds.map((id) => this.resolve(id)));
    return new Map(entries.map((m) => [m.memberId, m] as const));
  }
}

// (2) Read BPMAuthContext from your GraphQL context. Wire your auth/session
//     middleware so the request.bpmAuthContext is populated before GraphQL.
interface HostGqlContext {
  readonly bpmAuthContext?: BPMAuthContext | null;
}

function buildHostBPMAuthContext(
  context?: ExecutionContext,
): BPMAuthContext | null {
  if (!context) return null;
  const graphqlContext =
    GqlExecutionContext.create(context).getContext<HostGqlContext>();
  return graphqlContext.bpmAuthContext ?? null;
}

@Module({
  imports: [
    TypeOrmModule.forRoot(
      buildBPMDataSourceOptions({
        host: process.env.DB_HOST!,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER!,
        password: process.env.DB_PASS!,
        database: process.env.DB_NAME!,
        schema: process.env.DB_SCHEMA ?? 'public',
      }),
    ),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      path: '/graphql',
      context: async ({ req }: { readonly req: Request }) => ({
        // Plug your own session resolver here — read cookie, validate JWT, etc.
        bpmAuthContext: await readBPMAuthContextFromRequest(req),
      }),
    }),
    BPMRootModule.forRoot({
      authContextFactory: buildHostBPMAuthContext,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useClass: HostMemberResolver,
      },
      attachmentPublicBaseUrl: process.env.BPM_PUBLIC_BASE_URL,
      attachmentSignedUrlSecret: process.env.BPM_ATTACHMENT_SIGNING_SECRET,
      attachmentRoutePrefix: '/attachments', // controller will mount at this exact path
    }),
  ],
})
export class AppModule {}

async function readBPMAuthContextFromRequest(
  req: Request,
): Promise<BPMAuthContext | null> {
  // Replace with your real session decoding logic. Return null when not logged in.
  return null;
}
```

### 3. Bootstrap（**不要** 用 `setGlobalPrefix`）

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '@rytass/bpm-core-nestjs-module';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ credentials: true, origin: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );

  await app.listen(Number(process.env.PORT ?? 17603));
}

void bootstrap();
```

BPMCore 預期所有 controller 在 host 根路徑下提供 endpoint：

- `POST /graphql` — BPM GraphQL 操作
- `GET /attachments/:id/download` — BPM 簽名後的下載/預覽 URL

若要把這些放到 `/api/...` prefix，**設 `attachmentRoutePrefix: '/api/attachments'`** 並用 reverse proxy（Nginx / Cloudflare / k8s ingress）轉送 `/api/graphql` → `/graphql`。**不要** 用 NestJS `setGlobalPrefix`，這會與 BPMCore 假設衝突。

### 4. 跑 migrations（**必要，且只在 deploy 時跑一次**）

```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildBPMDataSourceOptions } from '@rytass/bpm-core-nestjs-module';

const dataSource = new DataSource(
  buildBPMDataSourceOptions({
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: process.env.DB_NAME!,
    schema: process.env.DB_SCHEMA ?? 'public',
  }),
);

await dataSource.initialize();
await dataSource.runMigrations();
await dataSource.destroy();
```

第一條 migration 會嘗試 `CREATE EXTENSION IF NOT EXISTS uuid-ossp, ltree`。若 DB user 沒有權限，請 DBA 先建好擴充。

### 5. Role / Permission 契約

宿主在建構 `BPMAuthContext` 時必須帶這些字串，BPM 內部 guard 才會放行：

| 等級 | `roles[]` | 或 `permissions[]` |
| --- | --- | --- |
| Admin | `BPM_ADMIN` | `bpm:*` / `bpm:admin` / `bpm.admin` / `bpm:admin:*` |
| Designer | `BPM_DESIGNER` | `bpm:design` / `bpm.design` / `bpm.form.design` / `bpm.template.design` / `bpm:form:design` / `bpm:template:design` |
| Authenticated | (任何 `memberId` 非空即可) | — |

完整對照表見 [`docs/10-bpm-embedding-auth.md`](./10-bpm-embedding-auth.md)。

---

## B. Next.js / React 前端

### 1. 安裝

```bash
pnpm add @rytass/bpm-core-client @rytass/bpm-core-shared
```

> `@rytass/bpm-core-client` 沒有 React peer dependency，純 `fetch`-based。

### 2. 環境變數（`.env.local`）

```bash
# 預設值會自動偵測：localhost → http://localhost:17603/graphql + /auth/*
# 部署環境通常省略這兩條，由 same-origin 解析。
NEXT_PUBLIC_API_URL=https://api.example.com/graphql
NEXT_PUBLIC_API_AUTH_URL=https://api.example.com   # /auth/* 的 base URL
```

### 3. 登入流程（Server Action 或 client component）

```ts
'use client';

import { loginApi, logoutApi, readApiCurrentMember } from '@rytass/bpm-core-client';
import { useState } from 'react';

export function LoginCard(): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  async function handleLogin(): Promise<void> {
    const member = await loginApi({ identifier, password });
    console.log('logged in as', member.email);
    // session cookie is now set by host; subsequent requestGraphQl calls authenticate automatically.
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleLogin(); }}>
      <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="member id" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button type="submit">Login</button>
    </form>
  );
}
```

### 4. 查 BPM 資料

```ts
'use client';

import { useEffect, useState } from 'react';
import { resolveMembers, type MemberProfileRecord } from '@rytass/bpm-core-client';
import { listApprovalInstances, type ApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';

export function MyInbox({ memberId }: { readonly memberId: string }): JSX.Element {
  const [instances, setInstances] = useState<readonly ApprovalInstanceRecord[]>([]);
  const [members, setMembers] = useState<readonly MemberProfileRecord[]>([]);

  useEffect(() => {
    void (async () => {
      const result = await listApprovalInstances({
        filter: { assigneeMemberId: memberId },
        pagination: { limit: 50, offset: 0 },
      });
      setInstances(result.instances);

      const initiatorIds = Array.from(
        new Set(result.instances.map((i) => i.initiatorMemberId)),
      );
      setMembers(await resolveMembers(initiatorIds));
    })();
  }, [memberId]);

  return (
    <ul>
      {instances.map((instance) => {
        const initiator = members.find((m) => m.memberId === instance.initiatorMemberId);
        return (
          <li key={instance.id}>
            #{instance.serialNumber} by {initiator?.name ?? instance.initiatorMemberId} — {instance.state}
          </li>
        );
      })}
    </ul>
  );
}
```

### 5. 搭配 React Query（推薦）

```ts
import { useQuery } from '@tanstack/react-query';
import { resolveMembers } from '@rytass/bpm-core-client';
import { listApprovalInstances } from '@rytass/bpm-core-client/workflow';

export function useMyInbox(memberId: string) {
  return useQuery({
    queryKey: ['inbox', memberId],
    queryFn: async () => {
      const inbox = await listApprovalInstances({
        filter: { assigneeMemberId: memberId },
        pagination: { limit: 50, offset: 0 },
      });
      const initiators = await resolveMembers(
        Array.from(new Set(inbox.instances.map((i) => i.initiatorMemberId))),
      );
      return { ...inbox, initiators };
    },
  });
}
```

### 6. Server Component / Server Action

```ts
// app/inbox/page.tsx (Server Component)
import { listApprovalInstances } from '@rytass/bpm-core-client/workflow';

export default async function InboxPage(): Promise<JSX.Element> {
  // requestGraphQl uses fetch which works on the Node side too. Pass NEXT_PUBLIC_API_URL
  // to force a specific endpoint, otherwise it defaults to same-origin /graphql.
  const result = await listApprovalInstances({ pagination: { limit: 20, offset: 0 } });
  return (
    <pre>{JSON.stringify(result.instances, null, 2)}</pre>
  );
}
```

> Server Component 要傳遞 cookie / session 時，需要在請求前手動把 host 的 cookie 帶上；或使用 `'use server'` Action + `cookies()` API 取出後 `fetch` 帶 `cookie` header。客戶端 component 自動帶 cookie 因為 `requestGraphQl` 用 `credentials: 'include'`。

---

## B+. 完整 fixture（可直接 copy-paste 編譯）

下面三段是「最小可編譯」的 valid 範例，型別欄位完全對應 `@rytass/bpm-core-shared` 0.1.0：

```ts
import type {
  FormDefinitionSchema,
  FormFieldDefinition,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';

// 注意：fieldKey（不是 name）、required 是必填、schemaVersion 必填
const sampleField: FormFieldDefinition = {
  type: 'text',
  fieldKey: 'subject',
  label: '主旨',
  required: true,
  placeholder: '請輸入',
};

const formSchema: FormDefinitionSchema = {
  fields: [sampleField],
  schemaVersion: 1,
};

const formUiSchema: FormUiSchema = {
  layout: [{ fieldKey: 'subject', width: 'FULL' }],
  schemaVersion: 1,
};
```

```ts
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';

// 注意：node.type 是 'startEvent' / 'endEvent' / 'userTask'，不是 'start' / 'end'
// 每個 node 必填 position 與 data.label；每個 edge 必填 data；WorkflowDefinition 必填 meta
const startNode: WorkflowNode = {
  id: 'start',
  type: 'startEvent',
  position: { x: 0, y: 0 },
  data: { label: '開始' },
};

const endNode: WorkflowNode = {
  id: 'end',
  type: 'endEvent',
  position: { x: 600, y: 0 },
  data: { label: '結束', endState: 'APPROVED' },
};

const edge: WorkflowEdge = {
  id: 'e1',
  source: 'start',
  target: 'end',
  data: {},
};

const workflow: WorkflowDefinition = {
  nodes: [startNode, endNode],
  edges: [edge],
  meta: { schemaVersion: 1 },
};
```

```ts
import type { MemberMetadata } from '@rytass/bpm-core-shared';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';

const member: MemberMetadata = {
  memberId: 'member-001',
  email: 'tester@example.com',
  name: 'Tester',
  customFields: { tenantId: 't-1' },
};

const authContext: BPMAuthContext = {
  memberId: member.memberId,
  metadata: { tenantId: 't-1' },
  // BPM_ADMIN role grants admin guards; see docs/10 for full table.
  roles: ['BPM_ADMIN'],
  permissions: [],
};
```

---

## C. 最低部署檢核表

啟用前確認：

- [ ] DB 有 `uuid-ossp` 與 `ltree` 擴充（或 DBA 已預建）
- [ ] 跑過 BPM migrations（不要靠 TypeORM `synchronize`）
- [ ] `BPMRootModule.forRoot` 設了 `attachmentSignedUrlSecret`（**不要** 用預設值 `bpm-core-local-attachment-url-key-v1`）
- [ ] 設了 `signatureKeyProvider`（**不要** 用預設 local key）
- [ ] 設了 `attachmentPublicBaseUrl` 對外的真實 origin
- [ ] 宿主沒呼叫 `setGlobalPrefix`
- [ ] `BPMAuthContext` 在 GraphQL context 內可被 `authContextFactory` 取到
- [ ] member resolver 不再回傳預設假資料
- [ ] 若要寄 email / webhook，設了 SMTP / webhook secret
- [ ] notification & SLA scheduler 只在單一 dedicated worker process 開（API replica 預設關閉）

更詳細的 contract 細節見 [`docs/10-bpm-embedding-auth.md`](./10-bpm-embedding-auth.md)。
