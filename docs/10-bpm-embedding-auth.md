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
- `@rytass/bpm-core-nestjs-module/database`
- `@rytass/bpm-core-nestjs-module/identity`
- `@rytass/bpm-core-nestjs-module/notification`
- `@rytass/bpm-core-nestjs-module/organization`

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
import {
  createBPMAuthContextFromMemberBaseMember,
  createBPMMemberBaseResolverProvider,
  BPM_MEMBER_RESOLVER,
} from '@rytass/bpm-core-nestjs-module';

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
本 repo 的 demo member 資料只存在於 `apps/api`，用來模擬外部系統的
member-base adapter。

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
- attachment preview/download 要檢查 uploader、initiator、assignee 或 admin。
- delegation admin 可管理所有代理；一般使用者只能管理自己的個人代理。

## Attachment Storage Contract

附件儲存透過 `ATTACHMENT_STORAGE` provider 抽象化，型別相容
`@rytass/storages` 的 `Storage<Readonly<Record<string, unknown>>>`。

未設定時，`AttachmentModule` 會使用 `@rytass/storages-adapter-local`，路徑為
`.storage/attachments`。宿主系統可以在 `BPMRootModule` 直接替換：

```ts
import {
  ATTACHMENT_STORAGE,
  BPMRootModule,
} from '@rytass/bpm-core-nestjs-module';

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
- 提供 local demo login/session API，並以 HTTP-only cookie 模擬 host session。
- 從 host session 建立 `BPMAuthContext`；目前不再保留 header impersonation fallback。
- 透過 `@rytass/bpm-core-nestjs-module` 引入 `BPMRootModule` 與 host-facing contracts。

API auth endpoints：

- `GET /api/auth/demo-members`：列出可登入的 local demo members。
- `POST /api/auth/login`：以 `{ identifier, password }` 登入；`identifier` 可用 member id 或 email，
  demo password 固定為 `demo`。
- `GET /api/auth/me`：讀取目前 session member。
- `POST /api/auth/logout`：清除 API session cookie。

`@rytass/bpm-core-nestjs-module` 現在是 monorepo 內的 package boundary，
host app 不再依賴舊的 standalone app project。public surface 以
`BPMRootModule`、`BPMAuthModule`、`BPMAuthContext`、`BPMMemberResolver`、
`BPM_MEMBER_RESOLVER`、`ATTACHMENT_STORAGE`、notification options 與 TypeORM
helper 為主。

後續 `apps/api` 應補：

- 用 e2e spec 驗證「未登入拒絕、登入可查 inbox、非 assignee 不可簽核」。
- 將 `apps/api` 的 local demo auth fixtures 換成真實
  `@rytass/member-base-nestjs-module` host module，並為 staging 建立真實測試帳號
  seed；BPM core 已提供 adapter helper，仍只吃 host 提供的 authenticated member 與
  `BPMMemberResolver`。

這個 app 可以留在 repo 作為 embedding contract 的活文件，也能成為之後釋出
BPMCore package 前的防回歸測試。
