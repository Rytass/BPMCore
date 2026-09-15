# 18 — ADR：知會節點 Webhook 管道

- **狀態**：Accepted
- **決策日期**：2026-09-15（2026-09-15 確認 Accepted，§預設值與「新增端點需改宿主程式」成本一併確認）
- **實作狀態**：P0–P5 VERIFIED（2026-09-15，皆含真實 wrapper host 驗證）；P6 進行中
- **適用範圍**：知會節點（`serviceTask` + `NOTIFY`）、Template Designer、Workflow Engine、
  BPM 宿主整合、案件詳情
- **交付規劃**：[19 — 知會節點 Webhook 開發 Phase](./19-notify-webhook-phases.md)

## 1. 背景

知會節點目前只替每位知會對象寫一筆站內通知。後端的 `NOTIFY` 動作型別允許
`IN_APP`／`EMAIL`，但 Template Designer 把 `channels` 寫死為 `['IN_APP']`，而且
型別刻意排除 `WEBHOOK`（`Exclude<NotificationChannel, 'WEBHOOK'>`）。

實際整合情境需要在流程走到某個點時通知**外部系統**，例如：

- 採購案核准後通知 ERP 建立採購單。
- 請假案送出後通知出勤系統預扣假別。
- 合約案到法務關卡時通知文件系統建立待審項目。

BPMCore 已有三條與 webhook 相關的路徑，但都不適合直接開放給流程設計者使用：

| 路徑                        | 目的端                   | 投遞方式                             | 主要問題                                                              |
| --------------------------- | ------------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| A. 系統節點 `WEBHOOK` 動作  | 模板 JSON 內的 URL       | 引擎交易內同步 `fetch`               | URL／headers 明文存模板並經 GraphQL 回傳；無逾時、無重試；設計器無 UI |
| B. 通知管道 `WEBHOOK`       | 宿主設定的單一全域 URL   | 通知 outbox + 排程器重試             | 每位收件人各送一次；無法依節點選不同目的端；排程器預設關閉            |
| C. Ad-hoc 指令 WEBHOOK 目標 | 執行時期由使用者輸入 URL | 引擎交易內同步，沿用 A 的 dispatcher | 任何候選人可指定內網 URL（SSRF）；headers 明文；無重試                |

A 與 C 的共同風險：

1. **SSRF**：沒有檢查 scheme、host 或 IP；預設 `fetch` 會跟隨 redirect，且回應 body 前
   500 字會寫進任何能讀案件的人都看得到的活動紀錄。
2. **憑證外洩**：headers 以明文存在 `workflow_definition`／`workflow_snapshot`／
   `target_value`，並透過 `workflowDefinitionJson`、`workflowSnapshotJson`、
   `targetValueJson` 回傳。
3. **同步 HTTP 卡住交易**：呼叫發生在 `pg_advisory_xact_lock` 與 DB 交易內且沒有逾時，
   外部服務緩慢會卡住案件鎖與連線池。
4. **commit 前的副作用**：webhook 已送出後若同一交易稍後失敗而回滾，使用者重試會重複
   發送，且 payload 沒有冪等鍵。

## 2. 決策驅動因素

1. 流程設計者能在知會節點上設定「同時通知哪些外部系統、帶哪些資料」，不需要改程式。
2. 目的端 URL、認證憑證、簽章金鑰不得出現在模板、案件快照、GraphQL 回應或瀏覽器。
3. Webhook 失敗不得阻斷或回滾流程；外部服務暫時故障時要自動重試。
4. 不得在 DB commit 前送出任何外部請求。
5. 接收端能以 BPM 提供的識別碼做冪等處理。
6. 發布 lint 能靜態判斷設定是否完整、參數型別是否相容。
7. 憑證輪替與端點 URL 變更要能套用到進行中的案件。
8. `@rytass/bpm-core-nestjs-module` 保持可嵌入，不耦合單一外部系統。

## 3. 決策

### 3.1 採用宿主註冊的 Webhook Endpoint Registry

比照 [ADR 14 §3.1](./14-form-option-data-source-adr.md) 的 DataSource Registry：
BPM core 定義 endpoint contract 與 registry injection token；真正的 URL、憑證、
headers、body 格式與簽章金鑰由宿主 provider 實作。

```ts
export interface BPMWorkflowWebhookEndpoint {
  readonly descriptor: BPMWorkflowWebhookEndpointDescriptor;

  /**
   * 在投遞當下呼叫，不在節點執行時呼叫。宿主在這裡讀取 Vault、組 Authorization
   * header、把 BPM 事件轉成對方系統要的 body。每次重試都會重新呼叫。
   */
  buildRequest(event: BPMWorkflowWebhookEvent): Promise<BPMWorkflowWebhookRequest>;
}

export interface BPMWorkflowWebhookEndpointDescriptor {
  readonly deprecated?: boolean;
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly parameters: readonly BPMWorkflowWebhookParameter[];
  readonly version: number;
}

export interface BPMWorkflowWebhookParameter {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: 'boolean' | 'json' | 'number' | 'string' | 'stringArray';
}

export interface BPMWorkflowWebhookRequest {
  /** 省略時送出 JSON 序列化的 event。 */
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** 省略時為 POST。 */
  readonly method?: 'PATCH' | 'POST' | 'PUT';
  /** 設定後 BPM 會加上簽章 headers（§3.6）。 */
  readonly signingSecret?: string;
  readonly timeoutMs?: number;
  readonly url: string;
}

export interface BPMWorkflowWebhookRegistry {
  get(key: string, version: number): BPMWorkflowWebhookEndpoint | null;
  list(): readonly BPMWorkflowWebhookEndpoint[];
}

export const BPM_WORKFLOW_WEBHOOK_REGISTRY = Symbol('BPM_WORKFLOW_WEBHOOK_REGISTRY');
```

同時提供 `EmptyBPMWorkflowWebhookRegistry` 與 `StaticBPMWorkflowWebhookRegistry`，
`BPMRootModule` 新增 `workflowWebhookRegistryProvider`（wiring time）與
`workflowWebhookRegistry`（runtime value）兩個 optional 選項，解析順序比照
`formDataSourceRegistry`。未註冊 registry 的宿主：Designer Catalog 為空、知會節點不顯示
Webhook 區塊，含 webhook 的模板不得發布。（實作註記：BPM 在宿主沒註冊時會注入空 registry，
視為「有來源但沒有端點」，因此發布時實際回報的是每個 target 的
`WORKFLOW_WEBHOOK_ENDPOINT_MISSING`；`WORKFLOW_WEBHOOK_REGISTRY_MISSING` 只在
`workflowWebhookTargetSources` 設為不含任何可用來源時出現。見 docs/19 P1 決策 #6。）

模板只保存 endpoint `key`、精確 `version` 與參數 bindings；**不得**保存 URL、HTTP
method、headers、token、簽章金鑰或任何可執行的請求模板。

設計時的資料流（往下傳的東西越來越少）：

```
┌──────────────────────────────────────────────┐
│ apps/api  (host backend)                     │
│   url / auth header / signing secret         │
│   read from Vault at delivery time           │
└──────────────────────────────────────────────┘
                         │  register(key, version, parameters[])
                         ▼
┌──────────────────────────────────────────────┐
│ BPM_WORKFLOW_WEBHOOK_REGISTRY                │
└──────────────────────────────────────────────┘
                         │  workflowWebhookEndpoints  (descriptor)
                         ▼
┌──────────────────────────────────────────────┐
│ Template designer   (browser)                │
│   pick endpoint + bind parameters            │
└──────────────────────────────────────────────┘
                         │  save draft / publish
                         ▼
┌──────────────────────────────────────────────┐
│ approval_template_versions.jsonb             │
│   endpoint { key, version }                  │
│   bindings [ FIELD | CONSTANT | CONTEXT ]    │
└──────────────────────────────────────────────┘
```

URL 與憑證只存在最上層的宿主程式；送到瀏覽器的只有端點描述；存進模板的只有 key、
版本與參數綁定。端點也可以改由 DB 維護，見 §3.13。

### 3.2 知會節點新增 `webhooks` 清單

依產品決定，webhook 放在知會節點內，而不是新的節點類型。`NOTIFY` 動作新增 optional
`webhooks`：

```ts
export interface NotifyWebhookTarget {
  readonly bindings: readonly NotifyWebhookBinding[];
  readonly endpoint: {
    readonly key: string;
    readonly version: number;
  };
  /** 節點內穩定識別碼，建立時產生、之後不變；用於冪等與活動紀錄。 */
  readonly id: string;
}

// ServiceAction 的 NOTIFY 分支
{
  readonly channels: readonly Exclude<NotificationChannel, 'WEBHOOK'>[];
  readonly recipients: ApproverResolver;
  readonly template?: string;
  readonly type: 'NOTIFY';
  readonly webhooks?: readonly NotifyWebhookTarget[];
}
```

不採用「把 `WEBHOOK` 加進 `channels`」的理由：

- `channels` 的語意是「每位收件人要從哪些管道收到」，一位收件人一筆通知列；webhook 是
  「每次節點執行送一次事件」，與收件人數量無關。
- 通知管道 `WEBHOOK`（路徑 B）已經代表「送到宿主全域 URL」，重複使用同一個值會讓兩種
  語意混在一起。

知會節點的完整性規則由「至少一位知會對象」改為**「至少一位知會對象或至少一個
webhook」**。為避免 `recipients` 改為 optional 帶來的型別破壞，`recipients` 維持必填；
只發 webhook 的節點寫入 `{ type: 'DIRECT', memberIds: [] }`，引擎遇到空的 DIRECT
resolver 時略過收件人解析與通知建立。

知會節點仍維持「非同步側支、不可接出線」的既有規則（`isAsyncNotifyServiceTask`）。

### 3.3 V1 binding 只接受欄位、常數與案件資訊

沿用 ADR 14 §3.3 的 binding 形狀，另外新增 `CONTEXT`：

```ts
export interface NotifyWebhookBinding {
  readonly from:
    | { readonly fieldKey: string; readonly kind: 'FIELD' }
    | {
        readonly kind: 'CONSTANT';
        readonly value: boolean | number | string | null;
      }
    | { readonly kind: 'CONTEXT'; readonly path: NotifyWebhookContextPath };
  readonly parameter: string;
}

export type NotifyWebhookContextPath = 'initiator.memberId' | 'instance.id' | 'instance.templateId' | 'instance.templateVersionId' | 'instance.title' | 'node.id' | 'node.label';
```

V1 不支援 CEL、模板字串或多欄位組字，理由同 ADR 14：直接 binding 讓發布 lint 能靜態
判斷欄位存在、型別相容、必要參數齊全；也避免 CEL 在執行時期出錯而回滾送出／簽核交易
（路徑 A 的 payload CEL 目前正有這個問題）。需要組字或換算時，由宿主在
`buildRequest()` 內處理。

**BPM 只送出有綁定的參數**，不附帶完整 `formData`，讓送出去的個資範圍由設計者明確
決定。

### 3.4 事件信封

BPM 在節點執行時組出事件，宿主的 `buildRequest()` 收到的就是它；宿主沒有自訂 `body` 時，
直接以 JSON 送出：

```ts
export interface BPMWorkflowWebhookEvent {
  /** 投遞識別碼，每筆 delivery 唯一，重試不變；接收端用於冪等。 */
  readonly deliveryId: string;
  readonly endpoint: { readonly key: string; readonly version: number };
  readonly eventType: 'workflow.notify';
  readonly instance: {
    readonly id: string;
    readonly templateId: string;
    readonly templateVersionId: string;
    readonly title: string;
  };
  readonly node: { readonly id: string; readonly label: string };
  /** 節點執行時間，不是投遞時間。 */
  readonly occurredAt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** 本次投遞是第幾次嘗試，從 1 開始。僅供宿主參考，不影響冪等。 */
  readonly attempt: number;
  readonly initiator: { readonly memberId: string };
}
```

### 3.5 採用 Transactional Outbox，commit 後才投遞

節點執行時**不發任何 HTTP 請求**，只在同一個引擎交易內：

1. 解析每個 webhook target 的 bindings，得到 `parameters`。
2. 為每個 target 寫一筆 `workflow_webhook_deliveries`（狀態 `PENDING`），把 event 凍結在
   row 上。
3. 在既有的 NOTIFY 活動紀錄 payload 加上 `webhookDeliveryIds`。

```
  engine transaction  (pg_advisory_xact_lock held)
  ┌──────────────────────────────────────────────────────────┐
  │ ┌────────────────────────────────────────────────────┐   │
  │ │ token reaches NOTIFY node                          │   │
  │ └────────────────────────────────────────────────────┘   │
  │                             │  resolve                   │
  │                             ▼                            │
  │ ┌────────────────────────────────────────────────────┐   │
  │ │ recipients -> notifications rows   (IN_APP/EMAIL)  │   │
  │ │ bindings   -> parameters { amount: 1200, ... }     │   │
  │ └────────────────────────────────────────────────────┘   │
  │                             │  write                     │
  │                             ▼                            │
  │ ┌────────────────────────────────────────────────────┐   │
  │ │ workflow_webhook_deliveries   status = PENDING     │   │
  │ │   event frozen: deliveryId, node, parameters       │   │
  │ └────────────────────────────────────────────────────┘   │
  │                             │                            │
  │                             ▼                            │
  │ ┌────────────────────────────────────────────────────┐   │
  │ │ consume token + activity log                       │   │
  │ │   TOKEN_ADVANCED { action: NOTIFY, deliveryIds }   │   │
  │ └────────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────┘
                               │  COMMIT
                               ▼
  no HTTP request has been sent up to this point
```

交易回滾時 delivery row 一併消失，因此不會有「webhook 已送出但案件沒有前進」的狀況。

新資料表不與 `notifications` 共用：通知列以收件人為單位（`recipient_member_id` 必填），
而且會出現在通知中心的查詢裡；webhook delivery 以事件為單位，只給管理者看。claim、
逾時包裝與退避計算抽成共用 helper，兩邊共用。

| 欄位                   | 型別          | 說明                                                |
| ---------------------- | ------------- | --------------------------------------------------- |
| `id`                   | `uuid`        | 即 `deliveryId`                                     |
| `instance_id`          | `uuid`        | FK → `approval_instances`                           |
| `node_id`              | `varchar`     | 知會節點 id                                         |
| `token_id`             | `uuid`        | 觸發的 token                                        |
| `target_id`            | `varchar`     | `NotifyWebhookTarget.id`                            |
| `endpoint_key`         | `varchar`     |                                                     |
| `endpoint_version`     | `int`         |                                                     |
| `event`                | `jsonb`       | 凍結的 `BPMWorkflowWebhookEvent`（`attempt` 除外）  |
| `status`               | `varchar`     | `PENDING`／`DELIVERY_IN_PROGRESS`／`SENT`／`FAILED` |
| `attempt_count`        | `int`         |                                                     |
| `next_retry_at`        | `timestamptz` | null 表示可立即投遞                                 |
| `last_attempt_at`      | `timestamptz` |                                                     |
| `last_response_status` | `int`         | null 表示沒有拿到 HTTP 回應                         |
| `last_error_code`      | `varchar`     | 見 §3.6 錯誤碼                                      |
| `last_error_detail`    | `text`        | 回應 body 前 500 字；僅管理者可讀                   |
| `sent_at`              | `timestamptz` |                                                     |
| `created_at`           | `timestamptz` |                                                     |

唯一鍵 `(token_id, target_id)`：同一個 token 重複執行同一節點時不會產生第二筆。
退回後以 `RESTART` 重新送出會產生新的 token，因此會再送一次；這是預期行為，事件本來
就又發生了一次。

**低延遲**：以 TypeORM subscriber 追蹤每個 query runner 在交易內新增的 delivery id，
交易 commit 後立即觸發一次投遞（不等待、失敗吞掉），rollback 則丟棄。這樣不必在每個
引擎入口各自記得觸發。**兜底**：`WorkflowWebhookDeliverySchedulerService` 以 `SKIP LOCKED` 定期
掃描 `PENDING` 與逾時未完成的 `DELIVERY_IN_PROGRESS`，多個 API 實例同時執行也不會重複
claim。排程器在 registry 至少有一個 endpoint 時預設啟用（與通知排程器預設關閉不同，
因為沒有排程器時失敗的 webhook 永遠不會重試）。

### 3.6 投遞語意

- **At-least-once**：接收端逾時但實際有處理成功時，BPM 會重送；接收端必須以
  `deliveryId` 冪等。不保證不同 delivery 之間的順序。
- **逾時**：`timeoutMs` 預設 10 秒、上限 30 秒，以 `AbortSignal` 實作。
- **不跟隨 redirect**：`redirect: 'manual'`，3xx 視為失敗（`WEBHOOK_REDIRECT`），避免
  宿主 URL 被導向內網。
- **重試分類**：

| 結果                         | 處理                  | `last_error_code`                    |
| ---------------------------- | --------------------- | ------------------------------------ |
| 2xx                          | `SENT`                | —                                    |
| 408、429、5xx                | 退避後重試            | `WEBHOOK_HTTP_<status>`              |
| 其他 4xx                     | 立即 `FAILED`，不重試 | `WEBHOOK_HTTP_<status>`              |
| 3xx                          | 立即 `FAILED`         | `WEBHOOK_REDIRECT`                   |
| 逾時／連線錯誤               | 退避後重試            | `WEBHOOK_TIMEOUT`／`WEBHOOK_NETWORK` |
| `buildRequest()` 丟出例外    | 退避後重試            | `WEBHOOK_BUILD_REQUEST_FAILED`       |
| endpoint 已從 registry 移除  | 立即 `FAILED`         | `WEBHOOK_ENDPOINT_MISSING`           |
| 端點來源查詢丟出例外         | 退避後重試            | `WEBHOOK_ENDPOINT_LOOKUP_FAILED`     |
| URL 不在白名單               | 立即 `FAILED`         | `WEBHOOK_URL_NOT_ALLOWED`            |
| 請求不合法（見下）           | 立即 `FAILED`         | `WEBHOOK_INVALID_REQUEST`            |
| BPM 內部非預期錯誤           | 退避後重試            | `WEBHOOK_INTERNAL_ERROR`             |
| 入列時參數型別不符或必填為空 | 入列即 `FAILED`       | `WEBHOOK_PARAMETER_INVALID`          |
| 入列時端點來源查詢丟出例外   | 入列即 `FAILED`       | `WEBHOOK_ENDPOINT_LOOKUP_FAILED`     |

入列時查詢失敗之所以直接 `FAILED` 而非 `PENDING`：參數要依端點宣告的型別解析並凍結，查詢
失敗時沒有可凍結的事件；投遞時的查詢失敗則會重試。

- **退避**：指數退避加 ±20% jitter，`base * 2^(attempt-1)`，套用 jitter 後再取上限，所以
  任何一次延遲都不超過上限；預設 base 30 秒、上限 1 小時、最多 6 次（約涵蓋 30 分鐘的對方
  停機）。重試時間從該次嘗試結束的時間起算。以 `BPMRootModule` 選項
  `workflowWebhookDelivery*` 調整。
- **拒絕送出的請求**：URL 非 http(s) 或帶帳密、method 不是 `POST`／`PUT`／`PATCH`、
  `buildRequest()` 回傳值沒有字串 `url`，一律 `WEBHOOK_INVALID_REQUEST` 直接失敗。
- **錯誤細節**：只保留宿主錯誤的種類與網路錯誤的系統代碼（如 `ECONNREFUSED`），不存可能
  含 URL 或 secret 的錯誤訊息；失敗回應 body 最多讀 4 KB、保留 500 字。
- **多個 worker**：每筆紀錄在自己的嘗試開始時重新蓋時間戳，回寫時以該時間戳為條件。
  遲到的結果不會覆寫已記錄的結果（例如 `SENT`）。
  單次嘗試超過 90 秒回收窗、或各實例時鐘偏差很大時，同一筆仍可能被送兩次——這是
  at-least-once 允許的範圍，接收端以 `deliveryId` 冪等。時間戳由應用端產生、精度到毫秒；
  若日後改用資料庫 `now()`（微秒精度），等值比對方式要一併調整。
- **可儲存性**：所有寫入 `last_error_detail` 的字串（回應 body、宿主錯誤種類、網路錯誤代碼）
  都先移除 NUL 字元，避免 PostgreSQL 拒寫導致紀錄無法記錄結果而被無限回收重送。
- **分段 claim 與並行**：一次最多 claim 5 筆並同時嘗試，這一段送完才 claim 下一段，直到
  累計達批量上限（預設 25）或沒有到期的紀錄。被 claim 的紀錄一定正在嘗試，不會持有 claim
  排隊，所以 90 秒回收窗只需涵蓋單次嘗試。一個逾時的接收端最多拖慢同一段的另外 4 筆，
  而不是整批（wrapper host 實測：逐筆投遞時，逾時 10 秒的端點曾讓同批的正常端點晚 10 秒送出）。
- **簽章**：`buildRequest()` 回傳 `signingSecret` 時，BPM 加上：
  - `x-bpm-delivery-id`：`deliveryId`
  - `x-bpm-timestamp`：送出當下（不是 claim 當下）的 Unix 秒數
  - `x-bpm-signature-sha256`：`HMAC-SHA256(secret, "<timestamp>.<body>")` 的 hex

  簽入 timestamp 讓接收端能拒絕過舊的請求以防重放。這與路徑 B 只簽 body 不同，差異寫入
  整合文件。

- **流程不受影響**：知會節點本來就是不可接出線的側支，投遞結果不改變案件狀態。

投遞與重試的資料流：

```
┌──────────────────────────────────────────────────────────┐
│ post-commit kick   (best effort, not awaited)            │
│ scheduler scan     (every N seconds, fallback)           │
└──────────────────────────────────────────────────────────┘
                              │  claim: UPDATE ... FOR UPDATE SKIP LOCKED
                              ▼
┌──────────────────────────────────────────────────────────┐
│ status = DELIVERY_IN_PROGRESS, attempt = n               │
└──────────────────────────────────────────────────────────┘
                              │  resolve request for this attempt
                              ▼
┌──────────────────────────────────────────────────────────┐
│ REGISTRY source: endpoint.buildRequest(event)            │
│ DATABASE source: stored url/headers + envelope body      │
│   credentials resolved NOW, not at enqueue time          │
└──────────────────────────────────────────────────────────┘
                              │  fetch: POST, timeout 10s, redirect: manual
                              ▼
┌──────────────────────────────────────────────────────────┐
│ x-bpm-delivery-id / x-bpm-timestamp                      │
│ x-bpm-signature-sha256 = HMAC(secret, ts + '.' + body)   │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────┬──────────────────┬────────────────────┐
│ 2xx              │ 408 429 5xx      │ 4xx / 3xx / err    │
│ status = SENT    │ backoff, retry   │ status = FAILED    │
└──────────────────┴──────────────────┴────────────────────┘
                             │  30s * 2^(n-1), cap 1h, max 6 tries
┌────────────────────────────┘
│
└──▶ back to claim
```

### 3.7 版本、快照與憑證輪替

- 模板發布後 immutable，案件建立時快照整份 `workflowSnapshot`，所以 endpoint
  `key`／`version` 與 bindings 對進行中的案件固定。
- **參數在入列時凍結**：`parameters` 依節點執行當下的 `formData` 解析並存入 delivery
  row，重試送出的內容一致，不受之後的退回編輯影響。
- **請求在投遞時解析**：URL、headers、簽章金鑰在每次投遞嘗試時才由 `buildRequest()`
  產生，宿主輪替憑證或搬移 URL 會立即套用到尚未送達的 delivery 與進行中的案件。
- **Endpoint 升版**：宿主改變參數契約時必須註冊新 `version`，舊版繼續保留到沒有模板
  使用為止；`deprecated: true` 讓設計器不再列出、但既有模板仍可投遞。
- **Endpoint 下架**：registry 找不到時，publish 會被擋；已入列的 delivery 以
  `WEBHOOK_ENDPOINT_MISSING` 標記失敗。

### 3.8 Designer Catalog

新增 GraphQL query `workflowWebhookEndpoints`（`@BPMDesignerOnly()`），只回傳 descriptor：
`key`、`version`、`label`、`description`、`parameters`、`deprecated`。**URL 與任何憑證
不會離開宿主後端**，因為 descriptor 本身就沒有這些欄位。

### 3.9 設計器 UX

知會節點面板在「知會對象」下方新增「Webhook」區塊（僅在 catalog 非空時顯示）：

- 「新增 Webhook」加入一個 target，選擇 endpoint（`Select`，顯示 `label`；同 key 多版本時
  顯示版本）。
- 依 endpoint 的 `parameters` 逐列顯示參數：來源類型（表單欄位／固定值／案件資訊）與值。
  表單欄位只列出型別相容的欄位；必填參數標示必填。
- 每個 target 可刪除；endpoint 切換時保留同名且型別相容的 binding，其餘清除。
- 節點卡片摘要：`知會 3 人 · Webhook 2 個`；只有 webhook 時不再顯示「未指定知會對象」。
- 知會對象改為非必填，但「知會對象」與「Webhook」至少要有一項，否則顯示
  「知會節點需要至少一位知會對象或一個 Webhook。」

實作時必須修正既有面板 `onChange` **整個覆寫 action** 的寫法（目前會把 `channels`
重設為 `['IN_APP']`），改為只更新異動的欄位，否則編輯知會對象會清掉 `webhooks`。
AI 助理的 `parseServiceAction` 同樣必須保留 `webhooks`。

試跑流程是純模擬、不寫 DB，不會送出 webhook；試跑步驟在知會節點上列出「將發送
Webhook：<endpoint label>」。

### 3.10 可觀測性與管理

- 節點執行：既有 `TOKEN_ADVANCED`（`action: 'NOTIFY'`）payload 加上
  `webhookDeliveryIds`。
- 投遞終局：寫入 `SERVICE_TASK_EXECUTED`／`SERVICE_TASK_FAILED` 活動紀錄，payload 為
  `{ action: 'NOTIFY_WEBHOOK', deliveryId, endpointKey, endpointVersion, status,
errorCode }`。**不含 URL 與回應 body**，因為活動紀錄對能讀案件的人都可見。中間的重試
  不寫活動紀錄，避免洗版。
- GraphQL：
  - `workflowWebhookDeliveries(instanceId)`（`@BPMAdminOnly()`）：列出 delivery 狀態、
    嘗試次數、最後錯誤碼與 detail。
  - `retryWorkflowWebhookDelivery(id)`（`@BPMAdminOnly()`）：將 `FAILED` 重設為
    `PENDING`、`attempt_count` 歸零；`deliveryId` 不變，接收端仍能冪等。只接受至少嘗試過
    一次的列：入列時就失敗（端點下架、查詢失敗、參數不合法）的列凍結的事件沒有通過參數
    檢查，重送會送出不符端點契約的內容，因此拒絕。
- 案件詳情：管理者看到「外部系統通知」區塊（狀態、嘗試次數、錯誤、重試按鈕）；一般
  使用者只在時間軸看到「已通知外部系統：<label>」或「通知外部系統失敗：<label>」。
  終局與重送活動紀錄的 payload 帶 `endpointLabel`（寫入當下的端點名稱，端點已下架時為
  `null`，前端改顯示 key），讓無權查 deliveries 的讀者也看得到名稱；錯誤碼不在時間軸顯示。
- 管理者重送另寫 `WEBHOOK_DELIVERY_RETRIED` 活動紀錄（操作者為該管理者，payload 帶
  前次錯誤碼），與狀態重設同一交易；時間軸顯示為「管理者重新傳送外部系統通知：<label>」
  （只表示已重新排入，結果仍以後續的「已通知／失敗」為準）。

### 3.11 安全

- 模板、快照、catalog、活動紀錄都不含 URL 與憑證；只有宿主後端與 delivery 投遞程式碼
  接觸得到。
- URL 由宿主程式碼決定，設計者無法指定任意目的端，從根本上排除路徑 A／C 的 SSRF 面。
- 不跟隨 redirect、有逾時、回應 body 只截斷存入管理者可讀的欄位。
- 只送出明確綁定的參數。
- `buildRequest()` 在 BPM 程序內執行，宿主要自行確保不把 secret 寫進 log。

資料邊界：

```
┌──────────────────────────────────┬──────────────────────────────────┐
│ stored in BPM (template, DB)     │ never leaves the host process    │
├──────────────────────────────────┼──────────────────────────────────┤
│ endpoint key + exact version     │ url            (REGISTRY source) │
│ parameter bindings               │ auth / Authorization header      │
│ resolved parameter values        │ signing secret                   │
│ deliveryId, attempt, status      │ response body (beyond 500 chars) │
│ last error code                  │                                  │
└──────────────────────────────────┴──────────────────────────────────┘

readable through GraphQL:
  workflowDefinitionJson / workflowSnapshotJson  -> left column only
  workflowWebhookEndpoints (designer)            -> key/label/params
  workflowWebhookDeliveries (admin only)         -> status + error code
```

`DATABASE` 來源的 URL 存在 BPM 的端點表，只有管理頁看得到；header 值與簽章金鑰一律
加密存放且永不回傳（§3.13）。

### 3.12 與既有 webhook 路徑的關係

- 路徑 A（系統節點 `WEBHOOK` 動作）與路徑 C（ad-hoc WEBHOOK 目標）本 ADR 不修改，但
  其 SSRF、明文憑證與同步 HTTP 問題另列入 backlog。長期方向是讓兩者也改走 registry 與
  outbox，並將路徑 A 的 inline URL 形式標為 deprecated。
- 路徑 B（通知管道 `WEBHOOK`）維持「宿主全域 URL」語意，不受影響。
- 既有 `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` 不用於本功能：它的介面沒有逾時、redirect
  與簽章語意，而且沿用它會讓宿主覆寫的 dispatcher 意外改變知會 webhook 的行為。

### 3.13 端點來源：程式註冊、DB 管理，與 URL 白名單

端點可以來自兩種來源，由 `BPMRootModule` 的 `workflowWebhookTargetSources` 決定，
兩者可並存：

| 來源       | 誰維護     | URL 存在哪             | 新增端點的代價   |
| ---------- | ---------- | ---------------------- | ---------------- |
| `REGISTRY` | 後端開發者 | 宿主程式碼／Vault      | 改程式並部署     |
| `DATABASE` | BPM 管理者 | BPM 的端點表（加密欄） | 後台填表，免部署 |

預設只有 `REGISTRY`，既有宿主升級後行為不變。

#### URL 白名單

`workflowWebhookAllowedUrlPatterns` 是一組允許的 URL 樣式，支援 `*`：

```
https://erp.example.com/hooks/bpm     完全比對
https://erp.example.com/hooks/*       路徑前綴，* 比對其餘任意字元
https://*.example.com/hooks/*         單層子網域（* 不跨 "."）
https://**.example.com/*              任意層子網域，也含 example.com 本身
http://localhost:17603/*              明寫才允許的本機目的地
*                                     任何公開 https 主機（等同 https://**/*）
```

規則：

1. 未寫 scheme 視為 `https`；`http` 只有在樣式明寫 `http://` 時才允許。
2. 預設拒絕以下位址，除非樣式明確寫出該 host；萬用字元 host（含單獨的 `*`）一律到不了：
   - IPv4：`0/8`、`10/8`、`127/8`、`100.64/10`、`169.254/16`、`172.16/12`、`192.0.0/24`、
     `192.0.2/24`、`192.168/16`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`224/4` 以上。
   - IPv6：`::`、`::1`、`fc00::/7`、`fe80::/10`、`fec0::/10`、`ff00::/8`。
   - 夾帶 IPv4 的 IPv6（`::ffff:0:0/96`、`::ffff:0:0:0/96`、`::/96`、`64:ff9b::/96`）依其
     內含的 IPv4 位址判斷。
   - `localhost` 與 `*.localhost`。
3. 比對發生在三個時機：儲存 DB 端點時、發布引用該端點的模板時、**每一次投遞前**。
   最後一道讓「端點存進去之後白名單才收緊」或 DB 被繞過直接改動的情況仍然擋得住。
4. `DATABASE` 來源必須設定非空白名單，否則該來源不啟用（fail closed）。
5. `REGISTRY` 來源預設不比對（URL 由程式碼決定，等同已經過 code review）；要一併
   套用就設 `workflowWebhookEnforceAllowlistForRegistry: true`。
6. DNS rebinding 防護（解析後再檢查 IP）不在 V1 範圍。

#### DB 端點表

`workflow_webhook_endpoints`：`key`、`version`、`label`、`description`、`url`、
`method`、`headers`、`signing_secret`、`parameters`、`is_active`、稽核欄位。

- `headers` 的值與 `signing_secret` 以 AES-256-GCM 加密存放，金鑰由宿主提供
  （`workflowWebhookSecretEncryptionKey`，建議走 Vault）。沒有金鑰就不能啟用
  `DATABASE` 來源。
- 兩者**永不回傳**：管理頁只顯示 header 的 key 與遮蔽值，secret 只能覆寫或輪替。
- 解密只發生在投遞當下。
- `key` 不得與 `REGISTRY` 已註冊的 key 衝突，儲存時就擋下並明確報錯。

#### 兩種來源在其他環節的差異

- **Catalog**：設計器的端點清單合併兩種來源，descriptor 多一個
  `source: 'REGISTRY' | 'DATABASE'`；兩者都不回傳 URL。
- **投遞**：`REGISTRY` 走宿主的 `buildRequest()`；`DATABASE` 由 BPM 依存好的
  url／method／headers 組請求，body 為標準事件信封。逾時、不跟隨 redirect、簽章、
  重試分類、outbox 語意兩者完全相同。
- **版本**：`DATABASE` 端點的 `version` 由管理者在**變更參數契約時**手動 +1；改 URL
  或 header 不需升版，因為模板綁的是 key 與版本，不是 URL。
- **停用**：停用的端點不可被新模板選用；既有模板投遞時以
  `WEBHOOK_ENDPOINT_DISABLED` 失敗，不會靜默丟棄。

#### 管理頁

`@BPMAdminOnly()` 的「Webhook 端點」頁：列表、新增、編輯、停用、輪替 secret、
查看最近投遞狀態，以及「測試送出」——送一筆 sample event 到該端點，同樣套用白名單與
簽章，並限制頻率。所有異動寫稽核紀錄（誰、何時、改了哪些欄位，值不入紀錄）。

這一段的交付排在 P6，P0 至 P5 先把 `REGISTRY` 來源做完（見
[19 — 開發 Phase](./19-notify-webhook-phases.md)）。

## 4. 發布前驗證不變式

模板發布時（後端 `lintWorkflowDefinition` 為權威，前端 `readWorkflowDefinitionIssue`
即時提示同一套規則）：

1. 知會節點至少有一位知會對象或一個 webhook target。
2. 含 webhook 的模板，宿主必須已註冊 registry。
3. 每個 target 的 `id` 在節點內唯一（trim 後比對）且非空；`endpoint.version` 為 1 到
   2147483647 的整數。
4. target、endpoint、binding 與 binding 來源只允許契約內的欄位；出現 `url`、`headers`、
   `secret` 等任何其他欄位一律拒絕，而不是忽略，確保模板不會夾帶目的端或憑證。
5. `endpoint.key`／`version` 必須存在於 registry，且未 `deprecated`（既有已發布版本
   不回溯檢查）。
6. 每個 `required` 參數都有 binding；binding 的 `parameter` 必須是 endpoint 宣告過的
   參數，且不得重複。
7. `FIELD` binding 指向的欄位存在於同版本表單，且型別相容：

| 參數型別      | 可綁定的欄位類型（`libs/shared/src/lib/form.ts`）                              |
| ------------- | ------------------------------------------------------------------------------ |
| `string`      | `text`、`textarea`、`date`、`datetime`、`radio`、單選 `select`／`autocomplete` |
| `number`      | `number`、`money`                                                              |
| `boolean`     | `boolean`                                                                      |
| `stringArray` | `checkbox`、複選 `select`／`autocomplete`                                      |
| `json`        | 任何欄位，含 `table` 與 `file_upload`                                          |

8. `CONSTANT` 的值型別與參數型別相容。
9. 單一節點 webhook target 上限 10 個。
10. `DATABASE` 來源的端點 URL 必須符合白名單，且端點為啟用狀態（§3.13）。

## 5. 相容性與版本策略

- `webhooks` 為 optional，既有模板 JSON 不需遷移。
- 知會節點完整性規則放寬（允許零位知會對象），不會讓既有可發布的模板變成不可發布。
- 新增資料表需要 migration；`BPMRootModule` 新增選項皆為 optional。
- 新增 GraphQL 型別與 query／mutation，不變更既有欄位；目前 0.x，以 `feat:` 發布即可。
- 所有新增 export 同步更新 `docs/api-reference.md`。

## 6. 後果

### 正面

- 流程設計者可以在知會節點上自行組合「通知哪些系統、帶哪些欄位」。
- 模板與瀏覽器完全不接觸目的端與憑證。
- Webhook 失敗不影響流程，暫時故障自動重試，永久失敗有管理介面可以手動重送。
- 接收端有穩定的 `deliveryId` 可做冪等，也有含 timestamp 的簽章可驗證來源。
- 憑證輪替即時生效，不被案件快照凍結。

### 成本

- `REGISTRY` 來源新增端點或變更參數契約需要改宿主程式並部署；要免部署就啟用
  `DATABASE` 來源（P6），代價是多一張表、加密金鑰管理與一套管理頁。
- 多一張資料表、一個排程器與一套管理 UI。
- At-least-once 語意要求接收端配合做冪等。
- 知會節點面板的語意變寬：同時負責「通知人」與「通知系統」。

## 7. 未採用方案

### 7.1 設計器直接填 URL／headers（強化路徑 A）

URL 與 token 會存進模板、快照並經 GraphQL 回傳給前端；只能靠 URL allowlist 緩解
SSRF，無法解決憑證外洩。與 ADR 14 §7.1 的否決理由相同。

### 7.2 只保留程式註冊一種來源

原本的決策是只做 `REGISTRY`，把「後台維護端點」列為未採納，理由是需要金鑰管理、
加密輪替、白名單、權限與稽核，且把 SSRF 防護責任移回 BPM。

2026-09-15 改為採納：不改程式就能新增端點是實際需求，代價（上述那些）以 §3.13 的
白名單、加密欄位、管理者權限與稽核紀錄承擔，並排在 `REGISTRY` 之後的 P6 交付。
兩種來源共用同一套 catalog、outbox、投遞與重試，差別只在請求怎麼組出來。

### 7.3 獨立的 Webhook 節點

語意較乾淨（知會通知人、Webhook 通知系統），也能做成可串接的節點。產品決定優先讓
知會節點一次完成兩件事。§3.1 至 §3.8 的 registry、binding、outbox 與投遞設計都與節點
形式無關，日後若要另外提供獨立節點，可直接沿用。

### 7.4 沿用 `channels: ['WEBHOOK']`

語意衝突，見 §3.2。

### 7.5 節點執行時同步送出

會在 DB 交易與案件鎖內等待外部服務，且 commit 前就產生副作用，見 §1 風險 3、4。

### 7.6 Payload 使用 CEL

執行時期錯誤會回滾送出或簽核交易，發布 lint 也無法完整驗證型別；V1 以 binding 取代，
複雜轉換交給宿主 `buildRequest()`。

## 8. V1 不在範圍

- 獨立 Webhook 節點、可串接並等待回應的同步 webhook。
- 將 webhook 回應寫回表單欄位。
- CEL 或模板字串 payload。
- 其他觸發時機（案件結案、退回、SLA 逾時）的 webhook；目前只有知會節點。
- AI 助理設定 webhook（V1 僅保證 AI 編輯知會節點時不會清掉既有 `webhooks`）。
- DNS rebinding 防護（§3.13 規則 6）。
- 以白名單管束既有的路徑 A／C（ad-hoc 執行時期 URL）；另列 backlog。
- 路徑 A／C 的安全修正（另列 backlog）。
- 非 HTTP 目的端（message queue 等）。

## 9. 相關文件

- [07 — 流程執行細節](./07-workflow-execution.md)
- [13 — Ad-hoc 臨時指令](./13-adhoc-directives.md)（路徑 C）
- [14 — ADR：表單選項 DataSource 架構](./14-form-option-data-source-adr.md)（registry 與
  binding 前例）
- [19 — 知會節點 Webhook 開發 Phase](./19-notify-webhook-phases.md)
- [Public API Reference](./api-reference.md)
