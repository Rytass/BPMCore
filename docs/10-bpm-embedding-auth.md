# 10 — BPM 嵌入式模組與 Auth 設計

## 目標

BPMCore 的後端核心應可被其他 NestJS 系統直接引入。宿主系統在根
`AppModule` 引入 `BPMRootModule` 後，取得 BPM 表單、模板、流程引擎、
代理、通知、簽章與附件能力。

BPMCore 不擁有登入流程，也不發行 token。登入、JWT/session、refresh、
member-base 初始化、TypeORM、GraphQL 與 Vault 等基礎設施由宿主系統負責。

## 模組邊界

`BPMRootModule` 是可嵌入入口，負責組合 BPM domain modules：

```text
BPMRootModule
├── BPMAuthModule
├── IdentityModule
├── OrganizationModule
├── FormModule
├── TemplateModule
├── WorkflowEngineModule
├── DelegationModule
├── NotificationModule
├── SignatureModule
└── AttachmentModule
```

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

Signed attachment URL 的 host 路徑可由 `attachmentRoutePrefix` 設定，預設為
`/api/attachments`。若宿主換成 S3、MinIO 或 GCS 等 adapter，應同步設定
`attachmentStorageProviderId`，讓 `attachments.storage_provider` 記錄真實 adapter
標識，而不是預設的 `local`。

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

API auth endpoints：

- `GET /api/auth/test-members`：列出可登入的 DB-backed 測試帳號。
- `POST /api/auth/login`：以 `{ identifier, password }` 登入；`identifier` 可用 member id 或 email，
  seeded test password 固定為 `demo`。
- `GET /api/auth/me`：讀取目前 session member。
- `POST /api/auth/logout`：清除 API session cookie。

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
