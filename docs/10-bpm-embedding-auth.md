# 10 — BPM 嵌入式模組與 Auth 設計

## 目標

BPMCore 的後端核心應可被其他 NestJS 系統直接引入。宿主系統在根
`AppModule` 引入 `BPMRootModule` 後，取得 BPM 表單、模板、流程引擎、
代理、通知、簽章與附件能力。

BPMCore 不擁有登入流程，也不發行 token。登入、JWT/session、refresh、
member-base 初始化、TypeORM、GraphQL 與 Vault 等基礎設施由宿主系統負責。

## 模組邊界

`BPMRootModule` 是可嵌入入口，負責組合 BPM domain modules。`forRoot` /
`forRootAsync` 回傳的 `DynamicModule` 內含 **11 個 child imports**：

```text
BPMRootModule
├── NotificationOptionsModule    ← 提供 BPM_NOTIFICATION_OPTIONS token 給其他模組注入
├── BPMAuthModule                ← @Global，提供 BPMAuthenticatedGuard / BPMAdminGuard / BPMDesignerGuard
├── IdentityModule
├── OrganizationModule
├── AttachmentModule             ← @Global，掛 AttachmentController
├── FormModule
├── TemplateModule
├── DelegationModule
├── NotificationModule
├── SignatureModule              ← @Global，註冊 SignatureService
└── WorkflowEngineModule
```

`NotificationOptionsModule` 是把 `BPMRootModuleOptions.notification*` 欄位
normalize 成 `BPM_NOTIFICATION_OPTIONS` provider 的中介模組；`NotificationModule`
和 `WorkflowEngineModule` 都會注入它。三個 `@Global()` 模組
（`BPMAuthModule` / `AttachmentModule` / `SignatureModule`）會把它們匯出的
guard 與 service 暴露到整個 host 而不需要 re-import。

`apps/api` 作為本 repo 的宿主範例，仍自行設定 Vault、TypeORM、
GraphQL 與登入/session，再引入 `BPMRootModule`。正式發佈時，外部系統只需
安裝 `@rytass/bpm-core-nestjs-module` 並在自己的 NestJS root module 內引入。

## Package Boundary

預計發佈的 npm package name：

```text
@rytass/bpm-core-nestjs-module
```

目前 monorepo 仍保留 `@bpm/core` TypeScript path alias 作為內部相容別名，
但宿主文件、範例與 `apps/api` host app 都應以
`@rytass/bpm-core-nestjs-module` 為準。

主要 public surface：

- `@rytass/bpm-core-nestjs-module`
- `@rytass/bpm-core-nestjs-module/attachment`
- `@rytass/bpm-core-nestjs-module/bpm-auth`
- `@rytass/bpm-core-nestjs-module/condition`
- `@rytass/bpm-core-nestjs-module/database`
- `@rytass/bpm-core-nestjs-module/delegation`
- `@rytass/bpm-core-nestjs-module/form`
- `@rytass/bpm-core-nestjs-module/identity`
- `@rytass/bpm-core-nestjs-module/migrations`
- `@rytass/bpm-core-nestjs-module/notification`
- `@rytass/bpm-core-nestjs-module/organization`
- `@rytass/bpm-core-nestjs-module/signature`
- `@rytass/bpm-core-nestjs-module/template`
- `@rytass/bpm-core-nestjs-module/workflow-engine`

## Auth Contract

BPM 內部只依賴 `BPMAuthContext`：

```ts
export interface BPMAuthContext {
  readonly memberId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}
```

宿主系統若使用 `@rytass/member-base-nestjs-module`，應以 adapter 將已驗證的
member-base user/session 轉成 `BPMAuthContext`。BPM resolver 與 service 不應直接
依賴 member-base 實作細節。

BPMCore 已提供 structural adapter helper，不直接硬依賴
`@rytass/member-base-nestjs-module` 的內部型別：

```ts
import { createBPMAuthContextFromMemberBaseMember, createBPMMemberBaseResolverProvider, BPM_MEMBER_RESOLVER } from '@rytass/bpm-core-nestjs-module';

const bpmAuthContext = createBPMAuthContextFromMemberBaseMember(memberBaseUser, {
  readCustomFields: (member) => ({ tenantId: member.tenantId }),
  readPermissions: (member) => member.permissions,
  readRoles: (member) => member.roles,
});
```

## Role / Permission Contract

`BPMAuthContext.roles` 與 `permissions` 是字串陣列，BPM 內部 guard 用「字串比對」決定使用者是不是 BPM admin 或 designer。宿主需要在自己的 adapter 中送入下列其中一個字串才能通過對應的 guard，否則 BPM resolver / mutation 會直接 `ForbiddenException`。

| 角色等級 | 通過條件（roles 或 permissions 任一即可）                                                                                       | 對應 Nest guard / decorator                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Admin    | `roles` 含 `BPM_ADMIN` ；或 `permissions` 含 `bpm:*` / `bpm:admin` / `bpm.admin` / `bpm:admin:*`                                | `BPMAdminGuard`、`@BPMAdminOnly()`、`isBPMAdmin(authContext)`                            |
| Designer | 同時含括 Admin；或 `roles` 含 `BPM_DESIGNER`；或 `permissions` 含 `bpm:design` / `bpm.design` / `bpm.form.design` / `bpm.template.design` / `bpm:form:design` / `bpm:template:design` | `BPMDesignerGuard`、`@BPMDesignerOnly()`、`isBPMDesigner(authContext)` |
| 一般已登入 | `BPMAuthContext.memberId` 非空                                                                                                | `BPMAuthenticatedGuard`、`@BPMAuthenticated()`                                          |

字串清單與行為來源：`libs/bpm-core/src/lib/bpm-auth/bpm-auth.authorization.ts`（admin/designer 集合）、`libs/bpm-core/src/lib/bpm-auth/bpm-auth.guard.ts`（一般已登入）。

宿主取得當前 `BPMAuthContext` / `memberId` 時，建議使用 `@rytass/bpm-core-nestjs-module` 提供的 param decorators，而不是再呼叫 `authContextFactory`：

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

`@BPMAdminOnly()` / `@BPMDesignerOnly()` 自動串接 `BPMAuthenticatedGuard`，宿主自己的 admin / template designer resolver 可以直接掛上，不必再額外加 `@BPMAuthenticated()`。

## Member Resolver Contract

BPM 延續外部 resolver pattern，只儲存 `member_id`，不擁有 user table：

```ts
export interface BPMMemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(memberIds: readonly string[]): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}
```

宿主系統必須提供 `BPM_MEMBER_RESOLVER` provider。BPMCore 不再提供 mock fallback；
本 repo 的測試帳號資料由 wrapper app `apps/api` 建立於資料庫
`api_test_members`，用來模擬外部系統的 member-base adapter。完整 staging/demo
情境 seed 也屬於 `apps/api/tools/reset-demo-data.ts`，不屬於
`@rytass/bpm-core-nestjs-module` 的模組責任。

## 宿主整合範例

```ts
@Module({
  imports: [
    MemberBaseModule.forRootAsync(...),
    TypeOrmModule.forRootAsync(...),
    GraphQLModule.forRoot(...),
    BPMRootModule.forRoot({
      authContextFactory: (context) => readBPMAuthContextFromHost(context),
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: HostMemberResolverAdapter,
      },
      formDataSourceRegistryProvider: {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useClass: HostFormDataSourceRegistry,
      },
      workflowServiceTaskDispatcherProvider: {
        provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
        useClass: HostWorkflowServiceTaskDispatcher,
      },
      attachmentStorageProvider: {
        provide: ATTACHMENT_STORAGE,
        useFactory: () => createHostStorageAdapter(),
      },
      notificationEmailEnabled: 'auto',
      notificationEmailSmtpHost: 'smtp.example.com',
      notificationEmailSmtpPort: 587,
      notificationEmailSmtpSecure: false,
      notificationEmailSmtpUsername: 'bpm@example.com',
      notificationEmailSmtpPassword: smtpPassword,
      notificationEmailFrom: 'BPM <bpm@example.com>',
      notificationWebhookEnabled: 'auto',
      notificationWebhookEndpointUrl: 'https://example.com/bpm/webhook',
      notificationWebhookSigningSecret: webhookSigningSecret,
      notificationDeliverySchedulerEnabled: false,
      notificationSlaSchedulerEnabled: false,
      notificationSlaTimeoutRemindEnabled: true,
      notificationSlaTimeoutAutoApproveEnabled: false,
      notificationSlaTimeoutEscalateEnabled: true,
      notificationSlaTimeoutTerminateInstanceEnabled: false,
    }),
  ],
})
export class AppModule {}
```

`HostWorkflowServiceTaskDispatcher` 是 wrapper app 的外部整合點。BPMCore 只定義
`BPMWorkflowServiceTaskDispatcher` contract；預設實作會直接以 `fetch` 對
`WEBHOOK` service task URL 發出 JSON `POST`。正式宿主若需要 request signing、
retry queue、tenant router、稽核紀錄或內部 integration bus，應透過
`workflowServiceTaskDispatcherProvider` 替換，而不是把外部整合細節放進
`@rytass/bpm-core-nestjs-module`。

`HostFormDataSourceRegistry` 同樣由宿主提供，並只從
`@rytass/bpm-core-nestjs-module` 的 public exports 取得 registry token 與 contract。
Schema 只保存已註冊來源的 key/version/bindings；URL、Header、Token、SQL 與查詢模板
不得進入 form schema。`apps/api` 的 `ApiFormDataSourceRegistry` 是 deterministic demo
fixture，資料表 `api_form_data_source_options` 的 ownership 留在 wrapper app。

## Domain Authorization

Authentication 只回答「誰登入」。BPM domain authorization 仍要在 BPM service
層執行，例如：

- task assignee 才能 approve / reject / transfer。
- instance initiator 才能 cancel / resubmit。
- template designer 才能 publish template。
- attachment preview/download 會檢查 uploader、initiator、直接/原始 assignee、
  candidate/original candidate，以及已決策者；目前 signed URL query 以
  authenticated `BPMAuthContext.memberId` 為準，不接受前端指定 reader。
- delegation admin 可管理所有代理；一般使用者只能管理自己的個人代理。
- `processApprovalInstance` 是 system/admin 操作；一般送出與簽核決策會在 service
  內部推進流程，不需要 client 額外呼叫。

## Attachment Storage Contract

附件儲存透過 `ATTACHMENT_STORAGE` provider 抽象化，型別相容
`@rytass/storages` 的 `Storage<Readonly<Record<string, unknown>>>`。

未設定時，`AttachmentModule` 會使用 `@rytass/storages-adapter-local`，路徑為
`.storage/attachments`。宿主系統可以在 `BPMRootModule` 直接替換：

```ts
import { ATTACHMENT_STORAGE, BPMRootModule } from '@rytass/bpm-core-nestjs-module';

BPMRootModule.forRoot({
  attachmentStorageProvider: {
    provide: ATTACHMENT_STORAGE,
    useFactory: () => createMinioOrS3StorageAdapter(),
  },
  authContextFactory,
  memberResolverProvider,
});
```

如果 storage adapter 需要 secret，可讓 `attachmentStorageProvider` 自己使用
`useFactory` / `inject`。BPMCore 只依賴 storage contract，不依賴特定雲端儲存。

`attachmentRoutePrefix` 同時控制兩件事：

1. BPM 在 `attachment.service.ts` 內建的 signed URL 路徑（`${publicBaseUrl}${routePrefix}/:id/download`）。
2. `AttachmentController` 在 Nest 內實際掛載的 controller path。`AttachmentModule.forRoot/forRootAsync` 會在執行時呼叫 `Reflect.defineMetadata(PATH_METADATA, ...)` 把 controller 的 `@Controller()` 路徑改成 `attachmentRoutePrefix`。

預設值是 `/attachments`，與 controller 的相對宣告 `@Controller('attachments')` 對齊；BPMCore 不再假設宿主使用 `setGlobalPrefix('api')`。如果宿主仍要把 BPM endpoint 對外公開成 `/api/attachments`，把 `attachmentRoutePrefix: '/api/attachments'` 設進 `BPMRootModule.forRoot` 即可，**不需要、也不應該再使用 NestJS 的 `setGlobalPrefix`**。

由於 Nest 是在 application bootstrap 同步讀 controller path metadata，`attachmentRoutePrefix` 必須在 wiring time 決定：

- `BPMRootModule.forRoot` 直接讀 `options.attachmentRoutePrefix`。
- `BPMRootModule.forRootAsync` 把 `attachmentRoutePrefix` 提升到 top-level 選項，**不是**從 `useFactory` 回傳值取得（async secret 也不應該驅動 URL 路由決策）。
- 同一個 process 只能有單一 BPM `attachmentRoutePrefix`；多 tenant / 多 host 共用一個 process 並不支援以不同 prefix 各自掛載。

若宿主換成 S3、MinIO 或 GCS 等 adapter，應同步設定 `attachmentStorageProviderId`，讓 `attachments.storage_provider` 記錄真實 adapter 標識，而不是預設的 `local`。

## Notification / Worker Contract

BPM 會建立 in-app notification records；email/webhook delivery 與 SLA scan 則應
由宿主明確決定在哪個 process 執行。`notificationDeliverySchedulerEnabled` 與
`notificationSlaSchedulerEnabled` 預設都是 `false`，避免多個 API replica 嵌入
`BPMRootModule` 後重複掃描。

若宿主要用既有寄信服務、queue、tenant router 或 event bus，應在
`BPMRootModule.forRoot({ imports: [...] })` 的 host import 裡提供
`BPM_NOTIFICATION_DISPATCHER`：

```ts
import { BPM_NOTIFICATION_DISPATCHER, type BPMNotificationDispatcher } from '@rytass/bpm-core-nestjs-module/notification';

@Injectable()
export class HostNotificationDispatcher implements BPMNotificationDispatcher {
  dispatch: BPMNotificationDispatcher['dispatch'] = async (notification, options) => {
    return queueNotification(notification, options);
  };
}
```

沒有提供 dispatcher 時，BPM 才會使用內建 SMTP 與 signed webhook delivery。
pending delivery 會用 DB claim 避免多 worker 重複處理；SLA 通知另有
idempotency index，但 production 仍建議使用單一 dedicated worker。

## Migration Contract

宿主應從 package 讀取 migration list，不要依賴 source glob：

```ts
import { BPM_CORE_MIGRATIONS } from '@rytass/bpm-core-nestjs-module/migrations';
```

`buildBPMDataSourceOptions()`、`buildDataSourceOptionsFromVaultEnv()` 與
`buildTypeOrmModuleOptions()` 都使用同一份 list，並保持 `migrationsRun: false`。
部署時應明確執行 migration。第一個 migration 會嘗試建立 `uuid-ossp` 與
`ltree`；若資料庫使用者不能 `CREATE EXTENSION`，DBA 必須先在目標 DB 建好 extension。
多 schema 宿主應以各自的 TypeORM `schema` 跑同一份 migration list。

## API Host App

已在 monorepo 內建立 `apps/api` 作為 NestJS 宿主範例。它不是 BPM domain 的放置處，
而是模擬外部系統如何引入 `BPMRootModule` 的 host app。理由：

- 可模擬真實宿主系統如何引入 `BPMRootModule`，比 standalone API 更接近套件使用情境。
- 可放一個 fake member-base adapter，驗證 BPM 不依賴 standalone mock。
- 可做 integration tests：宿主 `AppModule` 引入 BPM 後 GraphQL schema、resolver 與 auth context 都可運作。
- 可避免未來把 BPMCore 寫死在特定部署 shell。

目前 `apps/api` 已經：

- 自己設定 GraphQL / TypeORM / Vault。
- 提供 `ApiMemberResolver`。
- 提供 DB-backed test login/session API，並以 HTTP-only cookie 模擬 host session。
- 從 host session 建立 `BPMAuthContext`；目前不再保留 header impersonation fallback。
- 透過 `@rytass/bpm-core-nestjs-module` 引入 `BPMRootModule` 與 host-facing contracts。

`apps/api` 已經完全不使用 Nest `setGlobalPrefix`；所有 controller 都以 root 相對路徑掛載，sample endpoint 因此會出現在 host 根目錄下：

- `GET /auth/test-members`：列出可登入的 DB-backed 測試帳號。
- `POST /auth/login`：以 `{ identifier, password }` 登入；`identifier` 可用 member id 或 email，
  seeded test password 固定為 `demo`。
- `GET /auth/me`：讀取目前 session member。
- `POST /auth/logout`：清除 API session cookie。
- `GET /health`：apps/api 內建 health probe。
- `GET /attachments/:id/download`：BPM core attachment endpoint（路徑可由 `attachmentRoutePrefix` 覆寫）。
- `POST /graphql`：Apollo GraphQL endpoint。

宿主若要在自己的 deployment 用 `/api/` 之類 prefix，請改用 reverse proxy（nginx / Cloudflare / k8s ingress）做 path rewrite，**不**要回到 `setGlobalPrefix` — `BPMCore` 與 `apps/api` 的測試、e2e、`apps/client` URL resolver 都已假設 host root 直接服務 BPM 路徑。

`@rytass/bpm-core-nestjs-module` 現在是 monorepo 內的 package boundary，
host app 不再依賴舊的 standalone app project。public surface 以
`BPMRootModule`、`BPMAuthModule`、`BPMAuthContext`、`BPMMemberResolver`、
`BPM_MEMBER_RESOLVER`、`ATTACHMENT_STORAGE`、notification options 與 TypeORM
helper 為主。

後續 `apps/api` 應補：

- 用 e2e spec 驗證「未登入拒絕、登入可查 inbox、非 assignee 不可簽核」。
- production-like host 若需要完整帳密、RBAC、SSO lifecycle，可把 `apps/api`
  的 DB-backed 測試帳號 seed 換成真實 `@rytass/member-base-nestjs-module`
  host module；BPM core 已提供 adapter helper，仍只吃 host 提供的
  authenticated member 與 `BPMMemberResolver`。

這個 app 可以留在 repo 作為 embedding contract 的活文件，也能成為之後釋出
BPMCore package 前的防回歸測試。

## Frontend / Client Integration

`@rytass/bpm-core-client` 是與本後端模組配對的 framework-agnostic GraphQL / REST 客戶端 package，從 `apps/client` 抽離。Next.js、Vite、Remix、純 Node 服務都可直接使用，**不**依賴 React、Apollo、urql。

```
@rytass/bpm-core-nestjs-module  ← NestJS 後端 module（本文件）
@rytass/bpm-core-shared         ← 前後端共用型別
@rytass/bpm-core-client         ← 前端 GraphQL / REST 客戶端
```

`@rytass/bpm-core-client` public surface：

- 根 (`@rytass/bpm-core-client`): `requestGraphQl`、`readGraphQlEndpoint`、`readApiBaseUrl`、`loginApi` / `logoutApi` / `readApiCurrentMember` / `listApiTestMembers`、`resolveMembers` / `searchMembers`。
- `/organization`: org unit / position / membership / manager resolution 的查詢與 mutation。
- `/form`: form definition CRUD、版本管理、`form-rendering` schema parser。
- `/template`: approval template CRUD、category 管理、版本 publish / revert。
- `/workflow`: instance submit / decide / cancel、task / notification / attachment / signature 查詢。

預設 endpoint：

- localhost → `http://localhost:17603/graphql` + `http://localhost:17603/auth/*`。
- 其他 hostname → 同 origin `/graphql` 與 root-level `/auth/*`。
- 可以 `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_AUTH_URL` 覆寫。

完整使用範例與 React Query / SWR 範例見 `libs/bpm-core-client/README.md`。`apps/client` 已全面改用此 package，不再保留 `apps/client/src/app/_lib/*-api.ts` 內的 BPM 操作；hosts 部署自己的 Next.js client 時可以直接複製 `apps/client` 的 page 結構作為起手式。
