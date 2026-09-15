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

### 2a. 最小設定與非同步設定

`BPMRootModule` 的每一個選項都有預設值，所以最小可運作的接法是 **完全不帶參數**：

```typescript
BPMRootModule.forRoot(); // 或 BPMRootModule.forRootAsync();
```

這樣會得到：本機檔案系統附件儲存、把 member 解析成自身 id 的 `DefaultBPMMemberResolver`、
週一～週五行事曆、空的表單 DataSource 目錄、`fetch` webhook dispatcher，站內通知開啟，
email／webhook／兩個排程器關閉。功能一律由 host 自行 opt-in。

上面 2. 的寫法只是「一次把常用項目都填好」的樣子，不是必填清單。實務上要補的通常只有兩件：
`bpmAuthContext`（沒有的話所有需登入的操作都會 401）與正式環境的
`attachmentSignedUrlSecret`（`NODE_ENV=production` 未設會直接讓程式起不來）。

祕密要從 Vault／KMS 讀時用 `forRootAsync`。**除了必須在 wiring 期決定的少數幾個之外，
所有選項都能從 `useFactory` 回傳**，包含直接回傳做好的實例：

```typescript
BPMRootModule.forRootAsync({
  imports: [VaultModule],
  inject: [VaultService],
  useFactory: async (vault: VaultService) => ({
    attachmentPublicBaseUrl: await vault.get('BPM_API_PUBLIC_URL'),
    attachmentSignedUrlSecret: await vault.get('BPM_ATTACHMENT_SIGNING_SECRET'),
    authContextFactory: buildHostBPMAuthContext,

    // 直接給實例，不必自己組 Nest provider —— 祕密此時已經在手上。
    memberResolver: new HostMemberResolver(await vault.get('DIRECTORY_URL')),
    attachmentStorage: new S3Storage({ key: await vault.get('S3_KEY') }),
    businessCalendar: new HostBusinessCalendar(),
    formDataSourceRegistry: new HostFormDataSourceRegistry(),
    workflowServiceTaskDispatcher: new HostWebhookDispatcher(
      await vault.get('WEBHOOK_SIGNING_KEY'),
    ),
  }),
});
```

`useFactory` 本身也是選用的——只要 defaults 就夠，`forRootAsync()` 可以完全不帶參數。

BPM 會把 `useFactory` **求值一次**，結果發布在 `BPM_ROOT_OPTIONS` token 上供所有 BPM
子模組共用。這正是上面能安全回傳實例的原因：先前每個子模組各自呼叫 host 工廠（一次開機五次），
一個會 `new` 東西的工廠會讓每個消費端拿到不同實例。

只有這些不能放進 `useFactory`，因為 Nest 在工廠執行前就已讀取它們來建立路由、schema 與
handler metadata：

| 選項 | 為什麼是 wiring 期 |
| --- | --- |
| `attachmentRoutePrefix` | Nest 開機時同步讀 controller path metadata |
| `identityRegisterResolvers` | Nest 在建 schema 時就收集 resolver provider |
| `resolverMetadataFactory` | handler metadata 在任何工廠執行前就寫好 |
| `imports` / `inject` | 建構 module graph 本身所需 |
| 各 `*Provider`（`memberResolverProvider` 等） | Nest provider 定義；需要祕密時改用上表的實例版本 |

### 2b. 工作日 SLA 行事曆（選用）

節點 SLA 設 `calendar: 'BUSINESS_DAY'` 時，期限的「日」只會跨工作日。工作日由 host 決定
—— BPMCore **不內建任何國別假日資料**。不注入時退回內建的週一～週五行事曆
（時區以 `notificationSlaBusinessCalendarTimeZone` 設定，預設 `UTC`）。

需要國定假日與補班日時，實作 `BPMBusinessCalendar` 並註冊：

```typescript
import { Injectable } from '@nestjs/common';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from '@rytass/bpm-core-nestjs-module';

@Injectable()
export class HostBusinessCalendar implements BPMBusinessCalendar {
  // BPM converts each instant to a local date in this zone before asking.
  readonly timeZone = 'Asia/Taipei';

  constructor(private readonly calendarRepository: HostCalendarRepository) {}

  // `localDate` is 'YYYY-MM-DD'. Return true for make-up working Saturdays and
  // false for public holidays — both directions matter.
  async isBusinessDay(localDate: string): Promise<boolean> {
    return this.calendarRepository.isWorkingDay(localDate);
  }
}
```

```typescript
BPMRootModule.forRoot({
  // 匯出 HostCalendarRepository 的 module 要放進 imports，
  // 否則 useClass / useFactory 解析不到相依。
  imports: [HostCalendarModule],
  businessCalendarProvider: {
    provide: BPM_BUSINESS_CALENDAR,
    useClass: HostBusinessCalendar,
  },
});
```

`forRootAsync` 用同一個 key；此 provider 於 module wiring 時決定，需要祕密或 repository 時
在 provider 內用 `useFactory` / `inject`。

需要祕密時更建議改回傳實例（`businessCalendar`，見 2a）：實例由 host 自己的工廠建構，
連帶避開下面那個 provider 版本才有的 DI 循環陷阱。

`BPMRootModule` 的 `imports` 會一併傳進 `CalendarModule`，所以 calendar provider 的相依
不需要靠 host 端的 `@Global()` module 才解析得到。

### 2c. 知會節點 Webhook 端點（選用）

知會節點除了站內通知，還能把指定的表單欄位與案件資訊送到外部系統（ADR 18）。設計者在流程
設計器裡只能**選擇宿主註冊的端點**並綁定參數，不會看到、也不能輸入 URL、header 或金鑰；
這些都留在宿主程式碼裡。

**1. 註冊端點。** `BPMWorkflowWebhookRegistry` 是同步的 `get` / `list`，可以直接是一份清單
（或用 `StaticBPMWorkflowWebhookRegistry`）：

```typescript
import { BPM_WORKFLOW_WEBHOOK_REGISTRY, BPMWorkflowWebhookEndpoint, StaticBPMWorkflowWebhookRegistry } from '@rytass/bpm-core-nestjs-module';

function createErpPurchaseEndpoint(vault: VaultService): BPMWorkflowWebhookEndpoint {
  return {
    descriptor: {
      key: 'erp.purchase-approved', // 模板以 key + version 引用
      version: 1, // 參數契約改變時才升版；舊版本留著，讓進行中的案件照常投遞
      label: '採購核准通知 ERP', // 設計器、案件時間軸顯示的名稱
      parameters: [
        { key: 'amount', label: '金額', required: true, type: 'number' },
        { key: 'caseTitle', label: '案件標題', required: false, type: 'string' },
      ],
    },
    // 每次嘗試都呼叫一次：輪替後的金鑰或搬家後的 URL 對已排隊的投遞也會生效。
    buildRequest: async (event) => ({
      url: 'https://erp.example.com/hooks/bpm/purchase-approved',
      headers: { authorization: `Bearer ${await vault.get('ERP_TOKEN')}` },
      signingSecret: await vault.get('ERP_WEBHOOK_SIGNING_SECRET'),
      // body 省略時 BPM 送 JSON.stringify(event)；method 省略時 POST；timeoutMs 上限 30 秒。
    }),
  };
}

BPMRootModule.forRoot({
  imports: [VaultModule],
  workflowWebhookRegistryProvider: {
    provide: BPM_WORKFLOW_WEBHOOK_REGISTRY,
    inject: [VaultService],
    useFactory: (vault: VaultService) => new StaticBPMWorkflowWebhookRegistry([createErpPurchaseEndpoint(vault)]),
  },
});
```

不需要注入時可直接給實例：`workflowWebhookRegistry: new StaticBPMWorkflowWebhookRegistry([...])`
（`forRootAsync` 的 `useFactory` 也能回傳）。開機時 BPM 會檢查每個 descriptor（key、版本、參數
格式），不合法會直接讓程式起不來。

**2. 事件內容。** `buildRequest(event)` 拿到、也是預設 body 的事件：

```json
{
  "eventType": "workflow.notify",
  "deliveryId": "3f0c…",
  "attempt": 1,
  "endpoint": { "key": "erp.purchase-approved", "version": 1 },
  "instance": { "id": "…", "templateId": "…", "templateVersionId": "…", "title": "採購申請" },
  "initiator": { "memberId": "member-102" },
  "node": { "id": "notify_erp", "label": "通知 ERP" },
  "occurredAt": "2026-09-15T10:00:00.000Z",
  "parameters": { "amount": 1200, "caseTitle": "採購申請" }
}
```

`parameters` 只包含模板明確綁定的參數，不會送出整份表單。參數在知會節點抵達時就解析並凍結，
所有重試送出的內容相同。

BPM 固定加上 `x-bpm-delivery-id`、`x-bpm-event`；有 `signingSecret` 時再加上
`x-bpm-timestamp`（送出當下的 Unix 秒）與
`x-bpm-signature-sha256 = hex(HMAC-SHA256(secret, "<timestamp>.<body>"))`。宿主回傳的
`x-bpm-*` header 一律被丟棄。

**3. 接收端要做的事。**

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function isBPMWebhookSignatureValid(rawBody: string, headers: Headers, secret: string): boolean {
  const timestamp = headers.get('x-bpm-timestamp');
  const signature = headers.get('x-bpm-signature-sha256');

  if (!timestamp || !signature) return false;
  // 拒絕太舊的請求以防重放，例如 5 分鐘
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'));
  const received = Buffer.from(signature);

  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

- **用原始 body 驗簽**，不要先 parse 再 stringify（自訂 `body` 時兩者不一定相同）。
- **以 `deliveryId` 冪等**：重試、管理者重送都沿用同一個 id，接收端必須把重複的 id 當成已處理。
- 2xx 表示收到。`408`、`429`、`5xx`、逾時與網路錯誤會以指數退避重試（預設 30 秒起、±20%
  抖動、單次上限 1 小時、總共最多嘗試 6 次，即首次加 5 次重試）；其他 `4xx`、`3xx`（BPM 不
  跟隨 redirect）直接失敗。至少嘗試過一次而失敗的投遞，可由 BPM 管理者在案件詳情的「外部系統
  通知」區塊重送；入列時就失敗的（端點不存在、參數不合法）不能重送。
- 請求沒有自訂 `content-type` 時，BPM 補上 `content-type: application/json`。

**4. 投遞與排程。** 投遞一律在簽核交易 commit 之後進行，外部系統變慢或失敗都不會拖慢或回滾
簽核。重試由排程器處理：有註冊任何端點時預設啟用，可用 `workflowWebhookDeliverySchedulerEnabled`
明確開關（多個 API replica 同時掃描是安全的，claim 使用 `FOR UPDATE SKIP LOCKED`）。其餘可調
選項：`workflowWebhookDeliveryScanIntervalMs`、`workflowWebhookDeliveryBatchSize`、
`workflowWebhookDeliveryMaxAttempts`、`workflowWebhookDeliveryRetryBaseDelayMs`、
`workflowWebhookDeliveryMaxRetryDelayMs`、`workflowWebhookDeliveryDefaultTimeoutMs`。

**5. 發布檢查。** 發布模板時 BPM 會檢查每個 webhook：端點存在且未停用、必填參數都有綁定、
綁定的表單欄位存在且型別相容。設計器在發布前會顯示同一套規則的訊息。沒有註冊任何端點來源的
宿主，含 webhook 的模板無法發布。

程式註冊的端點預設不比對白名單，因為 URL 已經過程式碼審查。若要一併限制，設定
`workflowWebhookAllowedUrlPatterns`（例如 `https://*.example.com/hooks/**`）並開啟
`workflowWebhookEnforceAllowlistForRegistry`：這是全域開關，會套用到**所有**程式註冊的
端點，每次嘗試前比對，不符合的以 `WEBHOOK_URL_NOT_ALLOWED` 失敗。規則：`*` 比對單一 host
層級、`**` 比對多層（含頂層網域本身）、單獨一個 `*` 等於任何公開的 https 位址；**含萬用字元的
host 永遠不會比對到 loopback、私有網段或內部 IP**，內網或 localhost 端點必須在樣式中寫出明確的
host 才會放行，開啟前請先確認既有端點都在清單內。

**6. 後台維護的端點（選用）。** 不想每新增一個端點就改程式、重新部署時，可以讓 BPM 管理者在
「Webhook 端點」管理頁（`/admin/webhook-endpoints`，`@rytass/bpm-core-react/pages/admin/webhook-endpoints`）
維護端點。這個來源預設關閉，必須三項同時設定才會啟用，缺任何一項時開機會記錄原因並維持關閉：

```typescript
BPMRootModule.forRootAsync({
  imports: [VaultModule],
  inject: [VaultService],
  useFactory: async (vault: VaultService) => ({
    workflowWebhookTargetSources: ['REGISTRY', 'DATABASE'], // 同 key 時程式註冊者優先
    // 後台端點的 URL 一律比對白名單（儲存時與每次投遞前）；空清單代表不啟用
    workflowWebhookAllowedUrlPatterns: ['https://*.partner.example.com/hooks/**'],
    // 32 bytes，64 個 hex 字元或 base64；格式錯誤開機失敗
    workflowWebhookSecretEncryptionKey: await vault.get('BPM_WEBHOOK_SECRET_ENCRYPTION_KEY'),
  }),
});
```

- 要跑 migration `0000000024000`（新增 `workflow_webhook_endpoints` 與
  `workflow_webhook_endpoint_audits`）。
- header 值與簽章金鑰以 AES-256-GCM 加密存放，**只寫不讀**：管理頁與 GraphQL 只回 header 名稱
  與「是否已設定金鑰」。遺失加密金鑰等於遺失這些值，請與資料庫分開備份；更換金鑰需重新輸入
  所有端點的 header 與金鑰。
- 白名單在三個時機比對：儲存端點時、發布引用它的模板時、每次投遞前；收緊白名單後，不符的端點
  會讓發布被擋、已排隊的投遞以 `WEBHOOK_URL_NOT_ALLOWED` 失敗。
- URL 改到其他主機時必須同時重新輸入 headers，避免既有 header 值被送往新主機。
- 規則：key 不能與程式註冊的端點相同；同一版本的參數契約（鍵、型別、必填）不能修改，要改請
  「建立新版本」；停用的端點不會再出現在設計器，既有模板的投遞以 `WEBHOOK_ENDPOINT_DISABLED`
  失敗，含它的模板無法再發布。
- 測試送出使用範例事件（不含任何真實案件資料），每個端點每 10 秒一次、10 分鐘最多 5 次；限制是
  每個 API 程序各自計算。
- 每次建立、更新、停用／啟用、輪替金鑰、測試送出都寫入稽核紀錄，只記錄欄位名稱與操作者。
- 有啟用資料庫來源時，重試排程器一律啟用，後台之後新增的端點也會被重試。

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
# 若要連 UI 一起拿（含 20 個內建頁面）：
pnpm add @rytass/bpm-core-react @mezzanine-ui/react @mezzanine-ui/icons
```

> `@rytass/bpm-core-client` 沒有 React peer dependency，純 `fetch`-based。

> **Next.js + pnpm strict 必修**：若有裝 `@rytass/bpm-core-react`，`next.config.js` 必須加 `transpilePackages: ['@rytass/bpm-core-react']`，否則 Turbopack 無法解析 lib 內部對 `@rytass/bpm-core-client/workflow` 等 subpath 的 transitive peer-dep 引用，build 會炸 `Module not found`。
>
> ```js
> module.exports = {
>   reactStrictMode: true,
>   transpilePackages: ['@rytass/bpm-core-react'],
> };
> ```

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
- [ ] 知會節點 webhook：端點 `buildRequest()` 從祕密管理讀 URL／token／`signingSecret`，接收端以原始 body 驗簽並以 `deliveryId` 冪等
- [ ] notification & SLA scheduler 只在單一 dedicated worker process 開（API replica 預設關閉）

更詳細的 contract 細節見 [`docs/10-bpm-embedding-auth.md`](./10-bpm-embedding-auth.md)。
