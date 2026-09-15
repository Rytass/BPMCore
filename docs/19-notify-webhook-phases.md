# 19 — 知會節點 Webhook 開發 Phase

- **狀態**：P0、P1、P2、P3 VERIFIED（ADR 18 於 2026-09-15 Accepted）
- **規劃日期**：2026-09-15
- **權威決策**：[18 — ADR：知會節點 Webhook 管道](./18-notify-webhook-adr.md)
- **完成定義**：所有 Phase gate、wrapper-host golden path、repository-wide e2e 與文件同步完成

每個 phase 可獨立 ship（typecheck / lint / test / build 全綠）。狀態機沿用
`PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，VERIFIED 由未參與
實作的獨立 verifier 推進。

## Phase 總覽

| Phase | 交付                                                      | 相依   | 狀態     |
| ----- | --------------------------------------------------------- | ------ | -------- |
| P0    | Shared 契約、結構 lint、既有覆寫 action 問題修正          | —      | VERIFIED |
| P1    | Registry contract、Root 選項、Designer Catalog、發布 lint | P0     | VERIFIED |
| P2    | Outbox、引擎入列、投遞服務、排程器                        | P1     | VERIFIED |
| P3    | 管理查詢／重送、client SDK、案件詳情呈現                  | P2     | VERIFIED |
| P4    | 設計器知會節點 Webhook 面板                               | P1     | PLANNED  |
| P5    | Wrapper host、demo seed、E2E、文件與發布                  | P3、P4 | PLANNED  |
| P6    | DB 管理端點、加密欄位、管理頁、測試送出                   | P5     | PLANNED  |

```
 P0 ──▶ P1 ──┬──▶ P2 ──▶ P3 ──┐
             │                ├──▶ P5 ──▶ P6
             └──▶ P4 ─────────┘
```

P1 完成後，P2（後端）與 P4（前端）可平行進行；兩者只透過 P0 的 shared 型別與 P1 的
catalog GraphQL 契約耦合。

## P0 — Shared 契約與結構 lint

**Scope**

- `libs/shared/src/lib/workflow.ts`：新增 `NotifyWebhookTarget`、`NotifyWebhookBinding`、
  `NotifyWebhookContextPath`；`ServiceAction` 的 `NOTIFY` 分支加 optional `webhooks`。
- `libs/shared/src/lib/workflow-graph.ts`：
  - 知會節點完整性改為「知會對象或 webhook 至少一項」，訊息改為
    「知會節點需要至少一位知會對象或一個 Webhook。」
  - 一併修正既有問題：`incompleteNotifyNode` 以 `readServiceTaskMemberIds` 判斷，
    非 `DIRECT` resolver（職位、組織主管）會被誤判為未指定知會對象。
  - 新增結構規則（共用 `readNotifyWebhookStructureIssues`，前後端各自格式化訊息）：
    `webhooks` 必須是陣列、target 上限 10 個、target `id` 唯一且非空、`endpoint.key`
    非空、`version` 為正整數、binding `parameter` 非空且不重複、binding 來源形狀合法
    （`FIELD` 的 `fieldKey` 非空、`CONTEXT` 的 `path` 在允許清單內、`CONSTANT` 值為
    primitive 或 null）。
  - 「`FIELD` 指向的欄位存在且型別相容」需要表單 schema，兩個 lint 入口都拿不到，
    移到 P1 的發布驗證；P0 只提供共用判斷 helper
    `isFormFieldCompatibleWithWebhookParameter`。
  - 新增 helper：`createNotifyWebhookTarget`（產生穩定 `id`）、
    `readNotifyWebhookTargets`、`isNotifyRecipientsEmpty`。
- `libs/shared/src/lib/workflow-command.ts`：`applySetServiceAction` 在 NOTIFY → NOTIFY
  且新 action **沒有** `webhooks` 屬性時保留既有 `webhooks`；明確給 `webhooks: []` 才
  清除。設計器面板與 AI 助理的 `setServiceAction` 都經過這裡，一處修正即涵蓋兩條路徑，
  `workflow-toolset.ts` 不需修改（以 toolset spec 驗證）。
- `libs/bpm-core/src/lib/template/workflow-definition.validator.ts`：
  `lintServiceAction` 加入與前端一致、**不需 registry** 的結構規則；空的 DIRECT
  知會對象僅在有 webhook 時允許。
- `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`：NOTIFY 遇到空的
  DIRECT 知會對象時略過收件人解析與通知建立（原本丟 `ConflictException` 回滾交易）。
  P0 放寬 lint 後就能發布這種節點，引擎必須同 phase 處理，否則 P0 無法單獨出貨。
  `webhooks` 在 P2 之前不會被投遞。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test` 全綠；每條新規則至少一個正反向 unit test。
- 既有無 `webhooks` 的模板 fixture 經前後端 lint 結果與變更前一致（regression test），
  唯一差異是非 `DIRECT` 知會對象不再被誤判。
- 以職位 resolver 的知會節點實測發布前檢查不再誤報。
- `docs/api-reference.md` 同 commit 更新。

**實作結果**（2026-09-15）

異動檔案：`libs/shared/src/lib/workflow.ts`、`workflow-graph.ts`、`workflow-command.ts`，
`libs/bpm-core/src/lib/template/workflow-definition.validator.ts`、
`libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`，以及對應的五份 spec
（`workflow-graph`、`workflow-command`、`workflow-toolset`、
`workflow-definition.validator`、`workflow-engine.service`）與 `docs/api-reference.md`。

**驗證狀態**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全綠（數字見下方
獨立驗證修正後的重跑結果）。新增的保留 `webhooks` 測試與引擎空收件人測試都做過反向
驗證：暫時移除實作後對應測試失敗、還原後通過。真實 wrapper host 的瀏覽器／API 驗證見下方。

**獨立驗證第一輪（2026-09-15，未參與實作者）**：結論 NOT VERIFIED。shared 與
bpm-core 的實作、53 組前後端對抗輸入的判定一致性、`applySetServiceAction` 保留語意、
引擎略過條件皆確認無誤；必修項 1 項。

- **必修 1（已修正）**：`TemplateDesignerView.tsx` 內有一份 React lib 初次建立時複製的
  私有 `readWorkflowDefinitionIssue`，仍以 `readServiceTaskMemberIds(...).length === 0`
  判斷知會對象，且直接擋住「儲存草稿／試跑流程／發布」。shared 的修正因此在 UI 上完全
  沒生效。修正：shared 匯出 `readNotifyServiceTaskIssue`，設計器改用它；設計器私有的
  `readApproverResolverIssue`、`hasConfiguredConditionEdges` 與 shared 版（去空白後
  逐字相同）一併改為匯入 shared。
- **採納的非阻擋建議（已修正）**：
  1. `webhooks: undefined`（例如 spread 進來）也視為保留；原本以 `'webhooks' in next`
     判斷會清空，P4 面板容易踩到。
  2. `recipients` 為 null／缺 `type` 時，前端回傳訊息而非丟 TypeError。
  3. target、endpoint、binding、binding 來源拒絕契約外欄位（`url`、`headers`、
     `secret`…），守住 ADR §3.1「模板不存目的端與憑證」；ADR §4 新增第 4 條。
  4. `endpoint.version` 上限 2147483647，對齊 P2 outbox 的 `int` 欄位。
  5. target `id` 與 binding `parameter` 的唯一性改為 trim 後比對。
  6. toolset spec 斷言改為無條件執行，避免條件不成立時空過。
  7. `NOTIFY_WEBHOOK_CONTEXT_PATHS` 由 `Record<NotifyWebhookContextPath, true>` 推導，
     型別新增成員而清單漏列時編譯失敗。
- **未採納、改列 backlog**：見文末「範圍外，另列 backlog」第 8–10 條。
- **修正後重跑**：`pnpm typecheck`（6 專案）、`pnpm lint`（0 error，5 個既有 warning
  不在異動檔案）、`pnpm test`（shared 95、bpm-core 504、bpm-core-react 69、
  bpm-core-client 66、api 19，client 通過）、`pnpm build`（6 專案）全綠。

**獨立驗證第二輪（2026-09-15，同一位未參與實作者）**：結論 VERIFIED（程式碼範圍）。
必修 1 與採納項 1–7 逐條確認；再以 53 組對抗輸入（含 `JSON.parse` 產生的 own
`__proto__`、`constructor` 等 key、非法 `from.kind`、JSON 往返）比對前後端，沒有新的
crash 或分歧。追加採納兩項非阻擋建議：recipients 格式錯誤但已有 webhook 時改回報
「知會節點的知會對象設定格式錯誤。」；未知欄位檢查忽略值為 `undefined` 的 key（JSON
序列化會移除，否則設計器會比後端嚴格）。稀疏陣列漏檢（JSON 往返後後端仍會擋）不處理。
修正後 shared 97 項通過。

**真實環境驗證（2026-09-15，wrapper host `apps/api` + `apps/client`，非 mock）**

GraphQL（暫時模板 `TMP ADR18 P0 驗證`，驗證後已停用）：

| 情境                                      | 結果                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| 知會對象與 webhook 皆無 → 發布            | 擋下：`...action.recipients.memberIds is required`                     |
| webhook target 夾帶 `url` → 發布          | 擋下：`...action.webhooks[0].url is not allowed`                       |
| 職位知會對象 + 只有 webhook 的節點 → 發布 | 成功，已發布版本保留 `webhooks`                                        |
| 只有 webhook 的模板 → 發起案件            | 送出成功、案件 APPROVED、活動紀錄 `NOTIFY` 且 `recipientMemberIds: []` |

設計器（Chrome，真實登入 session）：

- 同時含職位知會節點與只有 webhook 的節點時，「儲存草稿／試跑流程／發布草稿」三顆
  按鈕皆可用，畫面無阻擋訊息——修正前這三顆會被舊訊息停用。
- 在面板為只有 webhook 的節點加入一位知會對象並儲存，`webhooks` 完整保留
  （`erp.purchase-approved` 與 `amount` binding 皆在）。此即覆寫問題的回歸測試。
- 由畫面按「發布草稿」成功發布 v3（含職位節點與 webhook 節點）。
- 已知外觀瑕疵重現：兩個節點卡片皆顯示「未指定知會對象」（僅顯示，不阻擋發布，P4 處理）。

**ADR 未載明而在 P0 自決的項目**

1. 結構檢查回傳 `NotifyWebhookStructureIssue` 問題碼，設計器（中文、給使用者）與後端
   lint（JSON path、給開發者）各自格式化，確保兩邊規則不會分岔。
2. `readNotifyRecipientsIssue` 逐條對齊後端 `lintNotifyRecipients`，不額外檢查
   `ORG_MANAGER`／`ORG_UNIT_MANAGER`，避免前端擋下後端可發布的模板。
3. 引擎只在「空 DIRECT **且** 有 webhook」時略過收件人解析；空 DIRECT 且沒有 webhook
   維持原本丟例外的行為（有測試守住），不放寬既有防線。
4. `CONSTANT` 值在結構層只檢查是否為 string／有限 number／boolean／null；與參數型別
   是否相容需要 registry，留在 P1。

## P1 — Registry contract、Root 選項與 Designer Catalog

**Scope**

- 新增 `libs/bpm-core/src/lib/workflow-webhook/`：
  - `workflow-webhook.types.ts`：ADR §3.1、§3.4 的 contract、
    `BPM_WORKFLOW_WEBHOOK_REGISTRY`、`EmptyBPMWorkflowWebhookRegistry`、
    `StaticBPMWorkflowWebhookRegistry`。
  - `workflow-webhook-registry.provider.ts`：解析順序比照 `form-data-source.provider.ts`。
  - `workflow-webhook-endpoint.object.ts`：GraphQL descriptor 型別（不含任何 URL 欄位）。
  - `workflow-webhook.queries.ts`：`workflowWebhookEndpoints`（`@BPMDesignerOnly()`），
    預設不回傳 `deprecated` endpoint，`includeDeprecated` 參數供載入既有模板時使用。
- `bpm-root-options.ts`／`bpm-root.module.ts`：新增 `workflowWebhookRegistryProvider`、
  `workflowWebhookRegistry`；確認兩份 `WorkflowEngineService` 都能取得同一個 registry
  （既有 dispatcher 有 Provider 選項只到一份的前例，要有 boot spec 覆蓋）。
- Registry 啟動檢查：同 `key` + `version` 重複、參數 key 重複時啟動失敗。
- **端點來源抽象**（ADR §3.13）：`BPMWorkflowWebhookEndpointSource` 介面與合併多來源的
  `CompositeWorkflowWebhookRegistry`；P1 只實作 `REGISTRY`，讓 P6 的 `DATABASE` 來源不必
  改動 catalog、發布 lint 與投遞。descriptor 加 `source` 欄位。
- **URL 白名單解析與比對**（純函式）：`workflowWebhookAllowedUrlPatterns` 的樣式解析、
  `*`／`**` 語意、scheme 規則、loopback 與私有網段預設拒絕。P1 只做解析、開機驗證樣式
  合法性與單元測試；實際攔截在 P2。
- `template.service.ts` 發布驗證：ADR §4 第 2、5、6、7、8 條（需要 registry 的規則）。
  錯誤碼：`WORKFLOW_WEBHOOK_REGISTRY_MISSING`、`WORKFLOW_WEBHOOK_ENDPOINT_MISSING`、
  `WORKFLOW_WEBHOOK_ENDPOINT_DEPRECATED`、`WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN`、
  `WORKFLOW_WEBHOOK_PARAMETER_REQUIRED`、`WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE`。

**Gate**

- 單元測試：registry 解析順序三種來源、重複註冊啟動失敗、catalog 權限（非 designer 403）、
  發布 lint 每個錯誤碼正反向。
- `bpm-root.module.boot.spec.ts` 覆蓋有／無 registry 兩種 boot。
- 以 GraphQL 實際查詢 catalog，確認回應中不存在 URL 或 header 相關欄位。
- `docs/api-reference.md` 同 commit 更新。

**實作結果**（2026-09-15）

新增 `libs/bpm-core/src/lib/workflow-webhook/`：`workflow-webhook.types.ts`（端點契約、
來源抽象、Empty／Static registry）、`workflow-webhook-allowlist.ts`（樣式解析與比對）、
`workflow-webhook-options.ts` 與 `-options.module.ts`（扁平選項、來源啟用規則）、
`workflow-webhook.service.ts`（多來源合併、開機時檢查 descriptor）、
`workflow-webhook.queries.ts`（designer-only catalog）、`workflow-webhook.validator.ts`
（需要 catalog 的發布規則）、`workflow-webhook.provider.ts`、`workflow-webhook.module.ts`、
`workflow-webhook.errors.ts`、`index.ts`。異動：`bpm-root-options.ts`、`bpm-root.module.ts`
（新增 `workflowWebhookRegistry` 與 `workflowWebhookRegistryProvider`，掛上兩個模組）、
`template.service.ts`（發布時串接 webhook lint）、`libs/bpm-core/src/index.ts`、
`libs/bpm-core/package.json` 與 `tsconfig.base.json`（新增 `/workflow-webhook` 子路徑）、
`docs/api-reference.md`。

新測試：`workflow-webhook-allowlist.spec.ts`（11）、`workflow-webhook-options.spec.ts`（6）、
`workflow-webhook.service.spec.ts`（8）、`workflow-webhook.validator.spec.ts`（10）、
`workflow-webhook.queries.spec.ts`（4），以及 `template.service.spec.ts` 的 5 個發布案例與
`bpm-root.module.boot.spec.ts` 的 registry 案例。

**驗證狀態**：`pnpm typecheck`（6 專案）、`pnpm lint`（0 error，5 個既有 warning）、
`pnpm test`（bpm-core 549、shared 97、bpm-core-react 69、bpm-core-client 66、api 19）、
`pnpm build`（6 專案）全綠。真實 wrapper host 驗證留到 P5（`apps/api` 目前還沒註冊
endpoint，屬 P5 scope）。

**ADR 未載明而在 P1 自決的項目**

1. 宿主面向的 `BPMWorkflowWebhookRegistry` 維持同步 `get`／`list`（宿主可直接給字面
   清單），非同步的 `BPMWorkflowWebhookEndpointSource` 只在內部使用，P6 的 DB 來源接在
   這一層。
2. 端點來源衝突以「來源順序先者勝」解決，避免 DB 端點蓋掉程式註冊的同名端點；P6 另在
   儲存時直接擋下衝突的 key。
3. `DATABASE` 缺白名單或缺金鑰時，從解析後的來源清單中移除而不是讓應用開不起來，並用
   `readDisabledWorkflowWebhookSourceReason` 產生原因字串給 log。
4. `TemplateService` 透過 `ModuleRef` 取得 `WorkflowWebhookService`，而不是建構子注入：
   `TemplateModule` 仍可獨立於 `BPMRootModule` 啟動，沒有 webhook 模組時視為「沒有端點
   來源」，引用端點的模板即被擋下。
5. `CONTEXT` binding 只允許填 `string` 或 `json` 參數（所有 context path 都解析為字串）。
6. 空的 registry 仍算「有來源」：發布時得到 `ENDPOINT_MISSING` 而不是
   `REGISTRY_MISSING`，兩者語意不同。

**獨立驗證第一輪（2026-09-15，未參與實作者）**：結論 NOT VERIFIED。catalog 不外洩（以真實
Apollo 驗 SDL、刻意查 `url`／`headers` 被 validation 拒絕）、designer 權限（未登入 401、
非 designer 403）、53 例白名單對抗輸入（十進位／十六進位／八進位 IPv4 經 WHATWG URL 正規化
後皆被擋）、38 例發布 lint、真實 `BPMRootModule` 圖中 `onModuleInit` 執行且服務只有一個
實例，皆確認無誤；必修 3 項，已全部修正：

- **必修 1**：草稿中格式錯誤的 `webhooks`（例如 `[42]`、`bindings: "x"`、缺 `from`）讓發布 lint
  丟 `TypeError`（500），連 P0 結構錯誤清單也被吞掉。修正：結構 lint 已回報問題的節點不再進入
  需要 catalog 的 lint；真實發布路徑補測試，確認得到 `BadRequestException` 與結構錯誤訊息。
- **必修 2**：`logDisabledSource` 沒有任何呼叫處，`DATABASE` 被移除時毫無 log。修正：移除該方法，
  改由 `WorkflowWebhookOptionsModule` 在解析選項時呼叫 `resolveAndReportWorkflowWebhookOptions`
  記錄原因（這裡同時拿得到原始輸入與解析結果）。
- **必修 3**：開機檢查只擋 `version >= 1`，`2147483648` 會讓整個 catalog 查詢因 GraphQL `Int`
  溢位而失敗。修正：上限改用 `NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX`。

採納的非阻擋建議（已修正）：required 參數不接受 `null` 常數；`isInternalHostname` 補上
IPv4-mapped IPv6、`192.0.0.0/24`、`198.18.0.0/15`、多播與保留網段（P2 會直接用到）；開機檢查補上
`parameters` 非陣列、不支援的參數型別、key 前後空白（與結構 lint 一致以 trim 比對）；GraphQL
`source`／`type` 改為註冊 enum；ADR 補寫單獨 `*` 與 `**` 含 apex 的語意；JSDoc 與 boot spec
補上「provider 優先於 runtime value」；boot spec 補上錯誤 registry 讓 `init()` 失敗。

移到 P2 gate：兩份 `WorkflowEngineService` 取得同一個投遞服務／registry 的 boot spec（驗證者
實測圖中確實有兩份引擎，P1 引擎尚未使用 registry）。

**獨立驗證第二輪（2026-09-15，同一位未參與實作者）**：結論 VERIFIED。3 項必修以第一輪的對抗
輸入在真實 `BPMRootModule` 圖重測皆已修正；`forRoot`／`forRootAsync` 在 6 種來源設定下 warn
次數正確；59 例白名單矩陣全數符合；GraphQL enum 以真實 Apollo 內省確認為 `ENUM` 且值與 TS
union 一致。追加採納三項非阻擋建議：

1. 發布 lint 改以 **target** 為單位跳過格式錯誤者，同節點其他 target 的型別錯誤不再被遮住。
2. `isInternalHostname` 改以完整解析 IPv6 後判斷：補上 IPv4-compatible `::/96`、SIIT
   `::ffff:0:0:0/96`、NAT64 `64:ff9b::/96`、site-local `fec0::/10`、多播 `ff00::/8`、無法解析
   的 IPv6 字面值，以及 TEST-NET 三段；ADR §3.13 規則 2 改為明列網段。
3. 開機檢查遇到缺 descriptor、key 或 label 不是字串時回報可讀訊息，不再丟 TypeError。

未採納：`127.0.0.1.nip.io` 這類 DNS rebinding（ADR §3.13 規則 6 明訂不在 V1）。

## P2 — Outbox、引擎入列與投遞

**Scope**

- Migration `0000000023000-workflow-webhook-deliveries.ts`：ADR §3.5 資料表、
  `(token_id, target_id)` 唯一鍵、`(status, next_retry_at)` 索引。
- `WorkflowWebhookDeliveryEntity`。
- 引擎 `executeServiceTask` NOTIFY 分支：
  - 空的 `DIRECT` resolver 略過收件人解析與通知建立。
  - 依 bindings 解析 `parameters`（`FIELD` 讀 `formData`、`CONTEXT` 讀案件與節點），
    寫入 delivery row；參數型別在執行時期再檢查一次，不符時該 target 直接寫成
    `FAILED`（`WEBHOOK_PARAMETER_INVALID`），**不丟例外、不回滾**。
  - `TOKEN_ADVANCED` payload 加 `webhookDeliveryIds`。
- Post-commit kick：`processInstance` 等交易邊界在 commit 成功後，對本次新增的 delivery
  id 觸發一次投遞，不 await、錯誤只記 log。
- 從 `NotificationDeliveryService` 抽出共用 outbox helper（`SKIP LOCKED` claim、
  `withDispatchTimeout`、退避計算），通知投遞行為不變。
- `WorkflowWebhookDeliveryService`：ADR §3.6 的逾時、`redirect: 'manual'`、簽章 headers、
  重試分類、指數退避 + jitter、終局活動紀錄（不含 URL 與回應 body）。
- **每次投遞前比對白名單**（ADR §3.13 規則 3）：不符者以 `WEBHOOK_URL_NOT_ALLOWED` 直接
  `FAILED`、不重試；`REGISTRY` 來源預設不比對，除非
  `workflowWebhookEnforceAllowlistForRegistry: true`。
- `WorkflowWebhookDeliverySchedulerService`：registry 非空時預設啟用；`NODE_ENV=test`
  不啟動。
- `BPMRootModule` 選項：`workflowWebhookDeliverySchedulerEnabled`、
  `workflowWebhookDeliveryScanIntervalMs`、`workflowWebhookDeliveryMaxAttempts`、
  `workflowWebhookDeliveryRetryBaseDelayMs`、`workflowWebhookDeliveryMaxRetryDelayMs`、
  `workflowWebhookDeliveryDefaultTimeoutMs`。

**Gate**

- 單元測試：
  - 白名單比對表：`*` 不跨 `.`、`**` 跨層、scheme 規則、明寫才放行的 localhost、私有
    網段預設拒絕、樣式非法時開機失敗。
  - 交易回滾後沒有 delivery row，也沒有發出任何 HTTP 請求。
  - 同一 token 重複處理只產生一筆 delivery。
  - 重試分類表每一列（2xx、408、429、5xx、其他 4xx、3xx、逾時、連線錯誤、
    `buildRequest` 例外、endpoint 移除）。
  - 簽章可被獨立的驗簽程式驗證；timestamp 被簽入。
  - 退避時間落在預期區間；達上限轉 `FAILED`。
  - 只有 webhook、沒有知會對象的節點不建立通知列。
  - 通知投遞既有 spec 在抽出共用 helper 後全數通過。
- 以本機接收端（見 P5 sink）實測：接收端先回 503 兩次再回 200，最終 `SENT` 且
  `deliveryId` 三次相同。
- 以兩個 API 實例同時跑排程器，確認同一 delivery 不會被重複投遞。
- boot spec：模組圖中兩份 `WorkflowEngineService` 都拿到同一個投遞服務與 registry（P1 驗證
  發現引擎有兩份實例的既有狀況）。
- 以接收端延遲 60 秒實測：簽核請求本身不被拖慢，delivery 以 `WEBHOOK_TIMEOUT` 重試。

**實作結果**（2026-09-15）

新增：`migrations/0000000023000-workflow-webhook-deliveries.ts`、`common/outbox.ts`（自
`notification-delivery.service.ts` 抽出 `readClaimedIds` 與 `withDispatchTimeout`，通知投遞
行為不變）、`workflow-webhook/` 下的 `workflow-webhook-delivery.entity.ts`、
`-delivery.enums.ts`、`-enqueue.ts`、`-delivery.service.ts`、`-delivery.subscriber.ts`、
`-delivery-scheduler.service.ts`。異動：`workflow-webhook-options.ts`（投遞設定）、
`workflow-webhook.module.ts`（註冊 entity、服務、subscriber、排程器）、
`workflow-engine.service.ts`（NOTIFY 分支入列並記錄 `webhookDeliveryIds`）、
`notification-delivery.service.ts`、`migrations/index.ts`、`docs/api-reference.md`。

新測試：`workflow-webhook-enqueue.spec.ts`（7）、`workflow-webhook-delivery.service.spec.ts`
（25，含 9 種 HTTP 狀態分類、opaque redirect、逾時、網路錯誤、`buildRequest` 例外、端點移除、
非 http(s) URL、白名單三情境、簽章可獨立驗證且宿主無法覆寫 `x-bpm-*`、耗盡轉 `FAILED`、
活動紀錄不含 URL 與回應 body、退避上下界、不 claim 終局或未到期的紀錄、入列時寫入預先
失敗的終局紀錄）、`workflow-webhook-delivery.subscriber.spec.ts`（6：commit 才觸發、rollback
丟棄、交易彼此隔離、非交易立即觸發、`FAILED` 不觸發、觸發失敗被吞掉）、
`workflow-webhook-delivery-scheduler.service.spec.ts`（4），`workflow-engine.service.spec.ts`
新增 2 個入列案例，`bpm-root.module.boot.spec.ts` 新增「每一份 `WorkflowEngineService`
都拿到同一個投遞服務」。

**驗證狀態**：`pnpm typecheck`（6 專案）、改動檔 eslint 無問題、`pnpm test`（bpm-core 604、
shared 97、bpm-core-react 69、bpm-core-client 66、api 19）全綠。

**獨立驗證第一輪（2026-09-15，未參與實作者）**：結論 NOT VERIFIED。Outbox 核心保證（交易內
不發 HTTP、commit 後才觸發、rollback 不留紀錄）以真實 TypeORM Broadcaster 實測成立，驗證者並
讀 `typeorm@0.3.31` 原始碼確認 `afterInsert` 時 id 已產生、commit／rollback 事件拿到同一個
query runner、初始化後加入的 subscriber 仍有效。必修 3 項，已全部修正：

- **必修 1**：一批 claim 的紀錄逐筆送出時，排在後面的紀錄會被另一個 worker 當成過期回收而重複
  投遞，回寫也不帶條件，後寫者會把 `SENT` 蓋掉。修正：每筆在自己的嘗試開始時以條件式 UPDATE
  重新蓋時間戳（不符即讓出），回寫也以該時間戳為條件、影響 0 列就放棄且不寫活動紀錄。
- **必修 2**：`buildRequest()` 同步丟例外或回傳 `undefined` 時，紀錄永久卡在
  `DELIVERY_IN_PROGRESS`。修正：以 `Promise.resolve().then()` 包裝、驗證回傳值形狀；端點查詢
  丟例外改為可重試的 `WEBHOOK_ENDPOINT_LOOKUP_FAILED`；其餘非預期錯誤記為
  `WEBHOOK_INTERNAL_ERROR` 重試，不再讓紀錄卡住。
- **必修 3**：`x-bpm-timestamp` 與 `nextRetryAt` 用的是 claim 時間。修正：簽章取送出當下、
  重試時間取該次結束當下（`readCurrentTime()`）。

採納的非阻擋建議（已修正）：巢狀交易時 subscriber 只在最外層 COMMIT／ROLLBACK 後才處理
（依 TypeORM 在廣播前清除 `isTransactionActive` 的行為）；URL 帶帳密與不允許的 method 直接
`INVALID_REQUEST`；錯誤細節不存可能含 URL／secret 的訊息；jitter 不超過上限；成功與 redirect
時丟棄 body、失敗時最多讀 4 KB；入列時清單層級的格式問題記 warn、registry 查詢丟例外記為
`FAILED` 而不回滾簽核；排程器開機時無法列出端點仍啟用；migration 補回 `instance_id` 外鍵
（`ON DELETE CASCADE`，ADR §3.5 表格原本就有）。

未採納、記錄於此：

- `(token_id, target_id)` 重複 insert 會丟 unique violation 讓整筆簽核回滾，而不是冪等略過。
  在 advisory lock 與同交易 consume token 的前提下不會發生；Gate「只產生一筆」是由唯一鍵
  保證、以回滾呈現。
- 排程器是否啟用只在開機時判斷；P6 的 `DATABASE` 來源若開機時為空，需在 P6 改為動態判斷
  （已列入 P6 scope）。

**獨立驗證第二輪（2026-09-15，同一位未參與實作者）**：第一輪 3 項必修逐條重跑確認已修正，
包含在真實 Postgres 語意下的時間戳等值比對（pg 寫入帶毫秒與時區、`postgres-date` 讀回，
0–999 ms 全數往返一致）、`repository.update` 的 `affected` 來自 `rowCount`、READ COMMITTED
下被併發改動的列回寫得到 0 列；巢狀 savepoint 情境以真實 Broadcaster 實測正確。新增必修
1 項，已修正：

- **R2-1**：接收端錯誤 body 含 NUL（0x00）時，PostgreSQL `text` 拒寫，`record()` 每次失敗，
  紀錄停在 `DELIVERY_IN_PROGRESS` 約 90 秒被回收重送，沒有上限。修正：寫入前移除 NUL，並補
  測試。

採納的非阻擋建議：ADR §3.6 表格補齊所有錯誤碼、「多個 worker」段改寫為精確語意（遲到結果
不覆寫；超過回收窗或時鐘偏差時仍可能重送，屬 at-least-once）；活動紀錄寫入失敗時不再誤報為
「結果未記錄」。未採納：入列時查詢失敗改寫 `PENDING`（沒有可凍結的參數，理由寫入 ADR）；
外鍵 `ON DELETE CASCADE` 與既有外鍵慣例不同，但沒有刪除案件的路徑，且已套用到 develop，
維持不變。

**獨立驗證第三輪（2026-09-15）**：結論 VERIFIED（程式碼範圍）。R2-1 以真實 socket 回 `61 00 62`
重跑確認；追加採納：所有 detail 來源集中在回寫時清除 NUL（宿主錯誤 `name` 含 NUL 也會卡住，
驗證者實測）、ADR 放錯段落的句子、api-reference 補述。

**真實環境驗證（2026-09-15，wrapper host `apps/api` + develop 資料庫）**

依使用者同意：在 develop 資料庫套用 `0000000023000`，並把 P5 的最小接收端與示範端點提前
加入 `apps/api`（`api-demo-webhooks.ts`、`api-demo-webhook-sink.controller.ts`，僅非
production 註冊）：`demo.purchase-approved`（回 200）、`demo.flaky`（每個 delivery 先回 503
兩次）、`demo.slow`（延遲 15 秒，超過預設逾時）。接收端以 `x-bpm-timestamp` 與重新序列化的
body 驗 HMAC，依 `deliveryId` 記錄每次收到的請求。

| 情境                                        | 結果                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 發起含三個 webhook 知會節點的案件           | 送出 740 ms、案件 APPROVED，三個節點活動紀錄帶 `webhookDeliveryIds`                                              |
| 正常端點                                    | 1.5 秒內送達、簽章有效，參數 `amount: 1200`（FIELD）與 `caseTitle`（CONTEXT）正確                                |
| 慢端點                                      | `WEBHOOK_TIMEOUT` 後排定重試，不影響送出耗時與其他端點                                                           |
| flaky 端點                                  | 503（立即）→ 503（+36 s）→ 200（+60 s），三次 `deliveryId` 相同、簽章皆有效，終局活動紀錄恰好 1 筆 `attempts: 3` |
| 交易內入列後丟錯（真實 Postgres + TypeORM） | 資料表 0 筆、未觸發投遞                                                                                          |
| 正常 commit                                 | commit 前 0 次觸發、commit 後觸發 1 次，觸發 id 與寫入 id 相同                                                   |
| 同一 token 同一 target 重複入列             | 被 `UQ_workflow_webhook_deliveries_token_target` 拒絕                                                            |
| 兩條獨立連線、批量 3 同時掃描               | A 7 筆、B 6 筆，每個 delivery 接收端只收到 1 次，全數 `SENT`                                                     |

**真實環境驗證發現並修正**：同一批依序投遞時，`demo.slow` 排在前面，讓同批的正常端點晚
10 秒才送出（隊頭阻塞；排程器一批 25 筆時最壞延遲數分鐘）。先改為一批最多 5 筆並行，修正後
正常端點 1.5 秒內送達。

**獨立驗證第四輪（並行差異）**：結論 VERIFIED。並行後所有權語意不變、同批內不會兩個 worker
取到同一列、單列丟例外不影響其他列、所有 detail 來源都經過 NUL 清除。驗證者指出：一次
claim 25 筆、5 筆並行時，排在後面的列持有 claim 排隊，第 11 列起排隊超過 90 秒會被其他
worker 接手（實測 25 列 A 送 10、B 接手 15，無重送），ADR「排隊的紀錄不會被誤判過期」因此
不成立。依其建議改為**分段 claim**：一次最多 claim 5 筆、送完再 claim 下一段，直到達批量
上限或沒有到期紀錄；被 claim 的列一定正在嘗試，回收窗只需涵蓋單次嘗試。補上「任何時刻持有
claim 的列不超過 5、並行峰值剛好 5」「單次掃描停在批量上限」「重複 id 只送一次」測試，並以
反向驗證（上限改為 6 時峰值測試失敗）確認。分段 claim 本身是驗證者提出的修法，未再送第五輪
程式碼審查。

**驗證過程的注意事項**：直接對共用資料庫呼叫 `deliverDue()` 的腳本，會一併 claim 資料庫中
其他已到期的紀錄（本次誤取 2 筆情境 A 的重試並送到錯誤的接收端）；flaky 的乾淨驗證因此
另開案件重做。之後的驗證腳本只用帶 id 的 `deliverByIds()`。

**Gate 狀態**：交易回滾不留紀錄、唯一鍵、503 兩次後成功且 `deliveryId` 不變、接收端延遲時
送出不被拖慢，皆已在真實環境完成（見上表）。「兩個 API 實例同時掃描」是以同一程序內兩條
獨立資料庫連線、各自的投遞服務實例模擬，驗證的是 `FOR UPDATE SKIP LOCKED` 的 claim 行為，
並非兩個獨立 API 程序。

**ADR 未載明而在 P2 自決的項目**

1. commit 後立即觸發改用 TypeORM subscriber（`afterInsert` 依 query runner 暫存、
   `afterTransactionCommit` 觸發、`afterTransactionRollback` 丟棄），而不是在每個引擎入口
   手動收集 id；ADR §3.5 已同步改寫。
2. 事件信封加入 `initiator.memberId`（ADR §3.4 已補），並額外送 `x-bpm-event` header。
3. 宿主在 `buildRequest()` 回傳的 `x-bpm-*` header 一律丟棄，確保接收端能信任 BPM 設定的值。
4. 入列時就能判定無法投遞的情況（端點已下架、參數在執行時期型別不符或 required 為空）
   直接寫成 `FAILED` 並同交易寫終局活動紀錄，不丟例外、不回滾簽核。
5. 逾時未回寫的 `DELIVERY_IN_PROGRESS` 在 90 秒（單次上限 30 秒 × 3）後可被重新 claim。
6. 排程器預設「有任何端點才啟用」，由 `workflowWebhookDeliverySchedulerEnabled` 明確覆寫；
   同一實例內掃描不重疊。
7. `WorkflowWebhookDeliveryEntity` 不是 GraphQL 型別；管理查詢在 P3 以專用物件輸出，避免
   `lastErrorDetail` 被一般使用者讀到。

## P3 — 管理查詢、重送與案件詳情

**Scope**

- GraphQL：`workflowWebhookDeliveries(instanceId)`、`retryWorkflowWebhookDelivery(id)`，
  皆 `@BPMAdminOnly()`。
- `libs/bpm-core-client`：對應的 typed API。
- `libs/bpm-core-react`：
  - 案件詳情新增「Webhook 投遞」區塊（僅管理者），顯示 endpoint label、狀態、嘗試次數、
    最後錯誤碼與 detail、`FAILED` 列的重送按鈕。以 Mezzanine `Section` + `Table`
    （`actions` 放重送）組合。
  - 時間軸將 `NOTIFY_WEBHOOK` 活動紀錄轉為「已通知外部系統：<label>」／
    「通知外部系統失敗：<label>」。

**Gate**

- 非管理者查詢 deliveries 回 403；非管理者畫面不出現區塊，也不出現錯誤 detail。
- 瀏覽器實測：讓 delivery 永久失敗 → 管理者按重送 → 接收端恢復後轉 `SENT`，時間軸
  出現對應紀錄。
- 重送後 `deliveryId` 不變。
- `docs/api-reference.md` 同 commit 更新。

**實作結果**（2026-09-15）

- 後端（`libs/bpm-core/src/lib/workflow-webhook/`）：
  - `WorkflowWebhookDeliveryResolver`（整個 resolver `@BPMAdminOnly()`）提供
    `workflowWebhookDeliveries(instanceId)` 與 `retryWorkflowWebhookDelivery(id)`。
  - `WorkflowWebhookDeliveryObject`（GraphQL `BPMWorkflowWebhookDelivery`）逐欄映射，
    不含凍結的 event、參數與 token id；`endpointLabel` 由目前的 registry 查詢。
  - `retryFailedDelivery`：同一交易內以 `status = FAILED AND attemptCount > 0` 為條件
    更新成 `PENDING`、`attemptCount` 0、`nextRetryAt` null，並寫 `WEBHOOK_DELIVERY_RETRIED`
    活動紀錄；其他狀態與入列時就失敗的列回 400、不存在回 404；label 在交易前查詢；
    commit 後 `setImmediate` 立即嘗試一次。
  - 終局活動紀錄與重送紀錄的 payload 加上 `endpointLabel`（`readEndpointLabel`，registry
    丟例外時為 `null`）。
- Client：`WorkflowWebhookDeliveryRecord`、`listWorkflowWebhookDeliveries`、
  `retryWorkflowWebhookDelivery`。
- React：
  - `isBPMAdminMember`（與後端 `isBPMAdmin` 同規則），`apps/client` 的 host layout 改用它，
    移除自己的副本。
  - `InstanceWebhookDeliveriesSection`：`Table` + `Badge`，嘗試過的 `FAILED` 列才有
    「重新傳送」，先開 `Modal` 確認；錯誤訊息顯示在區塊內。
  - `InstanceDetailView` 新增 `showWebhookDeliveries`；只有管理者才查 deliveries，查詢失敗
    （宿主未掛 webhook、權限判定不同）視為沒有資料，不影響頁面；沒有 delivery 時不顯示區塊。
    有 `PENDING`／`DELIVERY_IN_PROGRESS` 的列時每 3 秒只重讀 deliveries（最多 40 次），
    全部結束後整頁重新整理一次，讓時間軸帶出結果。
  - 時間軸：`NOTIFY_WEBHOOK` 的 `SERVICE_TASK_EXECUTED`／`SERVICE_TASK_FAILED` 與
    `WEBHOOK_DELIVERY_RETRIED` 列入歷程，失敗標為錯誤，不顯示錯誤碼。

**P3 自決的項目**

1. 區塊標題用「外部系統通知」而非「Webhook 投遞」，與時間軸用語一致。
2. 重送前以 Modal 確認：重送會對外部系統產生副作用。
3. 活動紀錄帶 `endpointLabel`，而不是前端再查 catalog：catalog 限設計者，一般讀者無權查。
4. 重送的時間軸標題為「管理者重新傳送外部系統通知：<label>」，只描述動作，不暗示已送達。

**真實環境驗證（2026-09-15，wrapper host `apps/api` + `apps/client` + develop 資料庫）**

| 情境                                          | 結果                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理者（member-001）開 P2 案件 `58511d6a`     | 區塊列出 3 筆：flaky／slow `失敗`（6 次、錯誤碼與 detail）、ok `已送達`；只有失敗列有「重新傳送」                                                                                              |
| 按重新傳送 → Modal 確認                       | 立即嘗試、狀態回 `等待傳送` 並顯示下次重試時間                                                                                                                                                 |
| 接收端                                        | 同一 `deliveryId` 收到 503（21:00:57）→ 503（21:01:39）→ 200（21:02:39），簽章皆有效                                                                                                           |
| 送達後                                        | 區塊顯示 `已送達`、3 次、錯誤清空、按鈕消失；時間軸新增重送紀錄（操作者為管理者；修正後標題為「管理者重新傳送外部系統通知：示範：先失敗兩次的接收端」）與「已通知外部系統：…」（操作者為系統） |
| P3 之前寫入的活動紀錄                         | 沒有 `endpointLabel`，時間軸改顯示 key（`demo.flaky`），失敗紅色標示                                                                                                                           |
| 審查修正後，重送 slow 失敗列、不重新整理      | 區塊自動由 `傳送中`（0 次）→ `等待傳送`（1 次、下次重試時間），時間軸出現「管理者重新傳送外部系統通知：示範：超過逾時的接收端」                                                                |
| 重送已送達的列（API）                         | `BAD_REQUEST`：`... is SENT; only FAILED deliveries can be retried`                                                                                                                            |
| 一般使用者（member-102）API                   | 查詢與重送皆 `FORBIDDEN`                                                                                                                                                                       |
| 一般使用者瀏覽器，開自己發起的案件 `79f7d293` | 不出現區塊與任何錯誤碼、前端未送出 deliveries 查詢；時間軸顯示「已通知外部系統：示範：採購核准通知 ERP」                                                                                       |

驗證用的 `79f7d293` 由 member-102 以同一個模板發起：暫時啟用模板、送出後立即停用回原狀。

**獨立驗證（2026-09-15）**：結論 PASS WITH FIXES，全部採納後修正：

| 等級  | 發現                                                                                                | 修正                                                                  |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| major | 入列時就失敗的列可被重送，缺參數／參數不合法的凍結事件會真的送出並變 `SENT`（驗證者以暫存測試重現） | 重送條件加 `attemptCount > 0`，並回明確的 400；前端不顯示按鈕；補測試 |
| minor | 「已重新通知外部系統」在重送當下並不成立，且不在 ADR 列出的兩種訊息內                               | 改為「管理者重新傳送外部系統通知」，ADR 補記                          |
| minor | `isBPMAdminMember` 少了 `?? []`，宿主 `/auth/me` 缺欄位時案件詳情整頁崩潰                           | 補回防禦                                                              |
| minor | 重送後畫面停在等待傳送，要手動重新整理                                                              | 有限次數輪詢                                                          |
| minor | 重送交易內查 label，DATABASE 來源時可能多占連線                                                     | 移到交易前                                                            |
| nit   | `readEndpointLabel` 在 fulfill handler 內丟例外時接不到                                             | 全段防禦，非字串一律 `null`；補測試                                   |

入列時就失敗的列被拒絕重送由單元測試涵蓋；develop 資料庫沒有現成的此類紀錄，未另做真實環境驗證。

未採納：非 UUID 參數回 Postgres 錯誤（整個 codebase 的 resolver 都未使用 `ParseUUIDPipe`，
維持一致）；後端英文錯誤訊息直接顯示給管理者（與其他管理頁一致）。

## P4 — 設計器知會節點 Webhook 面板

**Scope**

- `TemplateDesignerView.tsx` `renderServiceTaskPanel`：
  - 修正 `onChange` 整個覆寫 action 的寫法，改為只更新 `recipients`。
  - 知會對象改為非必填標示；新增「Webhook」區塊（catalog 為空時不顯示）。
  - Target 清單：endpoint `Select`、參數 binding 列（來源類型 + 值；表單欄位只列型別
    相容者）、刪除；切換 endpoint 時保留同名且相容的 binding。
  - 載入含 `deprecated` 或已下架 endpoint 的草稿時，顯示警告而不是清掉設定。
- 節點卡片摘要：`知會 N 人 · Webhook M 個`。知會對象為職位、組織、主管、表單欄位、
  運算式等執行時期才解析的類型時，顯示類型名稱而非「未指定知會對象」（P0 獨立驗證
  發現，`readServiceTaskMemberIds` 只認得 DIRECT）。
- 試跑流程步驟：知會節點列出將發送的 webhook。
- Designer catalog 以 `libs/bpm-core-client` 查詢，並比照 DataSource catalog 的快取與
  錯誤呈現。

**Gate**

- 瀏覽器實測（真實 wrapper host、非 mock）：
  - 新增知會節點 → 只設定 webhook、不選知會對象 → 可發布。
  - 設定 webhook 後再增刪知會對象 → webhook 設定仍在（覆寫問題的回歸測試）。
  - 必填參數未綁定 → 發布前檢查顯示對應訊息且無法發布。
  - `number` 參數的欄位下拉只列出 `number`／`money` 欄位。
  - 用 AI 助理修改該知會節點的知會對象 → webhook 設定仍在。
- UI 自查：各區塊使用正確的 Mezzanine 元件（`Section`、`Select`、`Table`、`Button`
  配置），不自建元件。

## P5 — Wrapper host、demo seed、E2E、文件與發布

**Scope**

- `apps/api`：
  - 註冊 `StaticBPMWorkflowWebhookRegistry`，至少兩個 demo endpoint（例如
    `demo.purchase-approved` v1、`demo.leave-submitted` v1），URL 指向同一 API 內的
    sink controller，簽章金鑰從 Vault 讀取。
  - Sink controller：驗證簽章、以 `deliveryId` 冪等記錄、可透過 query 參數模擬 503／
    延遲，僅在非 production 啟用。
- `pnpm demo:reset` seed：一個含「知會對象 + webhook」與一個「只有 webhook」知會節點的
  範本。
- E2E（`apps/client-e2e`）見下方矩陣。
- 文件：
  - `docs/api-reference.md`（總核對）、`docs/integration-guide.md` 與
    `docs/11-consumer-quickstart.md`（宿主如何註冊 endpoint、如何驗簽、冪等要求）。
  - `docs/07-workflow-execution.md`、`docs/08-frontend-schema.md` 補知會節點 webhook。
  - `docs/README.md` 索引加入 18、19。
  - 順手修正過期敘述：`docs/01-overview-and-decisions.md`、`docs/03-bpmn-engine.md`
    仍寫 WEBHOOK／SET_FORM_FIELD 為「schema 預留」。
  - ADR 18 狀態改為 Accepted 並回填實作狀態。
- 發布：`npx nx release --dry-run` 確認版本後由使用者執行 release。

**Gate**

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm e2e:client` 全綠。
- 獨立 verifier 逐條核對 ADR 18 §3、§4，並在瀏覽器重跑 golden path。

## P6 — DB 管理端點、加密欄位與管理頁

**Scope**（ADR §3.13）

- Migration `0000000024000-workflow-webhook-endpoints.ts`：`workflow_webhook_endpoints`
  表，`(key, version)` 唯一，`is_active` 索引。
- `WorkflowWebhookEndpointEntity` 與 `DatabaseWorkflowWebhookEndpointSource`，接上 P1 的
  來源抽象。
- 加密：AES-256-GCM 封裝 header 值與 `signing_secret`，金鑰來自
  `workflowWebhookSecretEncryptionKey`（Vault）。缺金鑰或缺白名單時 `DATABASE` 來源不
  啟用，並記錄明確原因。
- 儲存端驗證：URL 比對白名單、key 不得與 `REGISTRY` 衝突、參數 key 唯一、版本規則
  （改參數契約才升版）。
- GraphQL（`@BPMAdminOnly()`）：列表、建立、更新、停用、輪替 secret、測試送出；回應
  一律遮蔽 header 值與 secret。
- 稽核：端點異動寫入稽核紀錄（誰、何時、動了哪些欄位；值不入紀錄）。
- `libs/bpm-core-client` typed API 與 `libs/bpm-core-react`「Webhook 端點」管理頁
  （Mezzanine `Section` + `Table` + `Modal`，rowActions 放停用與輪替）。
- 設計器 catalog 顯示來源標籤，讓設計者分得出程式註冊與後台維護的端點。
- 投遞排程器改為動態判斷是否啟用：開機時沒有端點、之後在後台新增的端點也要有重試（P2
  驗證發現排程器只在開機時判斷）。

**Gate**

- 單元測試：加密往返、缺金鑰或缺白名單時來源不啟用、key 衝突擋下、停用端點不可被新
  模板選用、既有模板投遞得到 `WEBHOOK_ENDPOINT_DISABLED`。
- GraphQL 實測：任何查詢都拿不到 header 值與 secret（含錯誤訊息與 log）。
- 非管理者存取全部 403。
- 瀏覽器實測：後台新增端點 → 設計器立即可選 → 發起案件 → sink 收到事件且簽章正確。
- 白名單實測：不符白名單的 URL 無法儲存；先存好再收緊白名單，投遞以
  `WEBHOOK_URL_NOT_ALLOWED` 失敗。
- 測試送出：頻率限制生效，送出的是 sample event 而非真實案件資料。

## E2E Suite Matrix

| Journey             | 情境                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Designer            | 設定 webhook、綁定三種來源、只有 webhook 可發布、缺必填參數不可發布   |
| Designer 回歸       | 增刪知會對象與 AI 助理編輯後 webhook 設定保留                         |
| Runtime golden path | 發起 → 簽核 → 知會節點 → sink 收到簽章正確、參數正確的事件            |
| Runtime 重試        | sink 回 503 兩次後成功，`deliveryId` 不變、只記錄一次                 |
| Runtime 永久失敗    | sink 回 400 → `FAILED` → 管理者重送 → `SENT`                          |
| Runtime 不阻斷      | sink 延遲超過逾時，簽核操作正常完成、案件照常前進                     |
| 退回重送            | `RESTART` 後再次經過知會節點產生新 delivery                           |
| 權限                | 非管理者看不到 delivery 區塊與錯誤 detail；非 designer 查不到 catalog |
| 安全                | 模板 JSON、案件快照、catalog 回應、活動紀錄皆不含 URL 與 secret       |
| 端點管理（P6）      | 後台新增端點 → 設計器可選 → 投遞成功；白名單擋下不合法 URL            |

## 預設值

以下是 ADR 18 內選定的預設值，2026-09-15 確認採用：

| 項目                      | 預設                           |
| ------------------------- | ------------------------------ |
| 單次請求逾時              | 10 秒，上限 30 秒              |
| 最多嘗試次數              | 6 次                           |
| 退避                      | 30 秒起指數退避，上限 1 小時   |
| Webhook 排程器            | registry 非空時預設啟用        |
| 單一知會節點 webhook 上限 | 10 個                          |
| Delivery 明細與重送       | 僅 BPM 管理者                  |
| 一般使用者時間軸          | 顯示成功／失敗，不顯示錯誤細節 |

## 範圍外，另列 backlog

盤點既有 webhook 路徑時發現、但不在本計畫處理的問題：

1. 系統節點 `WEBHOOK` 動作（路徑 A）：URL／headers 明文存模板並經 GraphQL 回傳、交易內
   同步 HTTP 無逾時、commit 前副作用、payload CEL 執行錯誤會回滾送出／簽核交易。
2. 設計器編輯 `WEBHOOK` 系統節點時會被靜默轉成 NOTIFY 並刪除出線。
3. AI toolset `parseServiceAction` 對 `WEBHOOK` 動作丟棄 `headers`。
4. Ad-hoc WEBHOOK 目標（路徑 C）：任何候選人可指定內網 URL（`@IsUrl({ require_tld:
false })` 允許 localhost 與 IP）、headers 經 `targetValueJson` 明文回傳、無重試。
5. 預設 `DefaultWorkflowServiceTaskDispatcher` 跟隨 redirect，並把回應 body 前 500 字
   寫入所有案件讀者可見的活動紀錄。
6. 通知管道 `WEBHOOK`（路徑 B）在引擎交易內建立的列只靠排程器送出，而排程器預設關閉；
   每位收件人各送一次到同一全域 URL。
7. `notification-options.ts` JSDoc 說 `auto` 只需 secret，程式實際需要 URL 與 secret。
8. **設計器私有 `readWorkflowDefinitionIssue` 與 shared 版仍有規則漂移**（P0 驗證發現）：
   shared 版另有「會簽門檻人數無法達成」與「條件分流缺預設路徑」兩條，設計器版沒有。
   兩者後端發布時都會擋，但設計器目前允許儲存含這兩種問題的草稿。整份改用 shared 版會
   讓設計器也擋住「儲存草稿」，屬於行為變更，需產品決定後處理。
9. 形狀錯誤的知會對象 JSON 會讓 lint 丟 TypeError（既有問題，非 P0 回歸）：前端遇到
   `POSITION` 缺 `positionId`；後端遇到 DIRECT 缺 `memberIds` 或 `POSITION` 缺
   `positionId`。只能經由直接改 JSON 或 API 觸發。另有一處前端比後端嚴格：`memberIds` 為字串（非陣列）且
   沒有 webhook 時，前端拒絕、後端放行。
10. **通知管道的既有缺口**（釐清時確認，皆非 P0 造成）：Email 的主旨寫死在
    `notification-template.ts`（摘要信主旨也固定），只有內文可由節點 `template` 覆寫，
    且只有純文字沒有 HTML，要完全自訂必須由宿主提供 `BPM_NOTIFICATION_DISPATCHER` 接管
    寄送；站內通知沒有即時推播，前端無 SSE／WebSocket，未讀數只在載入與切換登入者時抓
    一次，宿主可用 `BPM_NOTIFICATION_OBSERVER` 自建 realtime 通道。
11. **發布路徑對形狀錯誤草稿的既有崩潰**（P1 驗證發現，`0deffad` 之前即存在）：`serviceTask`
    缺 `data`、`action: null`、`nodes` 不是陣列時，發布會先在 `readConditionExpressions` 或
    `definition.nodes.flatMap` 丟 TypeError（500）。存草稿只做 `JSON.parse` 不驗結構是根因。
12. **投遞沒有程序層級的並行上限**（P2 第四輪驗證建議）：每次 commit 觸發的投遞與排程器各自
    最多 5 筆並行，大量簽核同時 commit 時對外 HTTP 連線與資料庫連線池的壓力會放大。不在
    P2 加程序層級 semaphore，因為已 claim 的列若在 semaphore 前排隊，會重新引入「持有 claim
    排隊」的問題；需要時應改為先取得名額再 claim。
13. **P0 不可單獨發版**：P0 已允許發布含 webhook target 的模板，但 registry 檢查在 P1、
    投遞在 P2。P0 與 P1 至少要同一個 release 發出，release note 需註明 webhook 要到
    P2 才會實際送出。
