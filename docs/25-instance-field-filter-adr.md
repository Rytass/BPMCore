# 25 — ADR：簽核實例依表單欄位篩選與排序

- **狀態**：Accepted（2026-11-11）
- **提出日期**：2026-11-10；裁決 2026-11-10 至 2026-11-11，逐題結果見 §12
- **基準版本**：`libs/bpm-core` 等四套件 0.20.1（`2341952 chore(release): publish v0.20.1`）
- **適用範圍**：`listApprovalInstances` / `countApprovalInstances` / `approvalInstancePageInfo`（service、GraphQL、client SDK）、表單 schema 的欄位宣告、範本草稿與發布檢查、實例寫入時的型別檢查、`approval_instances.form_data` 的 GIN 索引
- **交付規劃**：[26 — 實例欄位篩選開發 Phase](./26-instance-field-filter-phases.md)
- **需求來源**：有 host 把請款類流程的表單與簽核完全放在 BPM Core、不另建業務表，列表頁因此需要依表單欄位篩選與排序；報支、零用金、差旅費等流程預期沿用同一模式。本 ADR 以**函式庫**的角度設計，不以單一 host 的需求為限。

本文件的現況敘述都已對照 `src` 原始碼查證；查證結果與需求方說法不符之處集中於 §14。

---

## 1. 背景與現況

### 1.1 現有列表查詢能做什麼

`listApprovalInstances`（service）與 GraphQL `approvalInstances`，目前只接受以下條件：

| 條件 | 來源 | 實際行為 |
| --- | --- | --- |
| `view` | `ApprovalInstanceListViewEnum` | `SENT`、`CC`、`ALL`，決定可見範圍（見 §8） |
| `state` | `ApprovalInstanceStateEnum[]` | `"approval_instances"."state" IN (...)` |
| `templateId` | string | `"template_id" = :templateId` |
| `searchText` | string | 只比對 `title`、`initiator_member_id`、`id`（三者 `LIKE` 不分大小寫） |
| `page` / `pageSize` | int | `skip/take` |

- 沒有任何 `formData` 條件。`searchText` 不搜表單欄位，也不搜發起人姓名（`initiator_member_id` 存的是 member id）。
- 排序固定為 `"created_at" DESC`，沒有次序鍵。`created_at` 相同的列在分頁時順序不穩定，這是**既有缺陷**，本 ADR 一併修正（§7.6）。
- `countApprovalInstances` 與 `approvalInstancePageInfo` 共用 `createFilteredApprovalInstanceQueryBuilder`（`workflow-engine.service.ts` ~3798），條件必須同步加。
- `ListApprovalInstancesOptions` 是 `workflow-engine.service.ts` 內的非 export interface，host 無法引用其型別。

### 1.2 資料的儲存形狀

`approval_instances` 一個實例一列，與表單有關的是三個 jsonb 欄位：

| 欄位 | 內容 |
| --- | --- |
| `form_data` | `fieldKey → value` 的純值。select／autocomplete 存**值**；member 單選存 member id、多選存陣列；checkbox 是字串陣列；table 存 row 陣列（每列為 `columnKey → value` 物件，上限 `FORM_TABLE_MAX_ROWS = 100`） |
| `form_definition_snapshot` | 送出當時的整份表單定義（含欄位型別與靜態選項的名稱） |
| `form_data_option_snapshot` | `FormDataSourceValueSnapshots`（`form.ts:202`），接資料來源的選項之顯示名稱。**只含被選中的選項**：`form-data-source.service.ts` 以 `readOrderedResolvedOptions(options, values)` 只解析送出的值 |

- 時間欄位：`started_at`（送出時設定，重送時因 `...instance` spread 保留原值）、`completed_at`（可為 NULL）、`created_at`、`updated_at`（TypeORM `@UpdateDateColumn`，該列任何一次 save 都會更新）。
- 現有索引都在 `created_at`、`state`、`template_id`、`title`（trigram）、`initiator_member_id`（trigram）上；**`form_data` 沒有任何索引**。
- `pg_trgm` 已是必要條件：`0000000013000-workflow-query-indexes.ts` 第一行即 `CREATE EXTENSION IF NOT EXISTS "pg_trgm"`。
- 範本有 `current_version_id`；版本狀態為 `DRAFT`／`PUBLISHED`／`ARCHIVED`。範本版本以 `form_definition_version_id` 指向**表單定義版本**；表單定義是獨立實體，API 允許不同範本指向同一個表單版本。
- fieldKey 規則為 `^[A-Za-z_][A-Za-z0-9_]*$`（`form.ts:660`），不可能含 `.`。
- table 欄位可用型別：`text`、`number`、`money`、`date`、`datetime`、`select`、`autocomplete`、`boolean`（`TABLE_COLUMN_FIELD_TYPES`），且 table 欄位不得接資料來源（`field-access-lint.ts` ~416），因此 table 內的選項只有靜態選項，沒有選項快照。
- `hidden?: boolean` 是**任何欄位都能設定的旗標**，不是欄位型別。`hidden` 欄位的值照存進 `form_data`，填寫者看不到。

### 1.3 寫入 `form_data` 的路徑（已逐一查證）

| # | 路徑 | src 行號 | 會改變 formData | 現有送出檢查 |
| --- | --- | --- | --- | --- |
| W1 | `submitApprovalInstance`（送出） | ~819、~882 | 是 | `validateSubmittedFormData` |
| W2 | `decideTask` 且 APPROVED 帶 `formDataJson`（簽核人補填） | ~1066、~1415–1440 | 是 | `validateSubmittedFormData`（含 `deferredFieldKeys`） |
| W3 | `resubmitApprovalInstance`（退回後重送） | ~1958–1969 | 是 | `validateSubmittedFormData` |
| W4 | `SET_FORM_FIELD` 服務動作（流程內寫欄位） | ~8151 | 是 | P1 查證 |

`reject`、`return`、`complete`、`close`、`cancel` 以 spread 保存既有 `formData`，不改變內容。

### 1.4 fieldAccess 與實例可見性（權限的前提）

- 實例可見性：`applyReadableInstanceFilter`（~3850–3930）。`SENT` 看 `initiator` 或 `submitted_by`；`CC` 看 `notifications.recipient`；其他情況為 `canReadAllWorkflows(scope)` 或以下任一：發起人、送件人、任務的 assignee／original assignee、候選人、有 decision 的人。
- **`display: HIDE` 與 `hidden` 都不是權限邊界**：ADR 20 第 157、298 行與 `form.ts:24–28` 明文。`approvalInstances`、`approvalInstance` 等 query 把**整份** `formDataJson` 回傳給所有能讀該實例的人，引擎內沒有依欄位遮蔽的程式。
- **結論**：「能讀實例」就等於「能讀全部 formData」。

### 1.5 送出時的型別檢查現況

- `validateSubmittedFormData`（~10440）對 `hidden` 欄位不做 `visibleWhen` 判斷，其值經 `readSubmittedTextValueErrors` 檢查文字規則。
- **P0 查證結果**：送出時**不檢查** `number`／`money`／`date`／`datetime`／選項類欄位的值型別，只檢查 `required` 與文字規則；API 直接送入 `"abc"` 當金額會被存下。client 端（`libs/bpm-core-client` 的 `form-rendering.ts`）寫入的形狀為：數字為 JSON number、`date` 為 `YYYY-MM-DD`、`datetime` 為 `Date#toISOString()`（UTC、毫秒、`Z`）、單選為字串、多選為字串陣列。§6 的正規格式以此為準。

---

## 2. 目標與非目標

### 2.1 目標

1. 表單設計者可逐欄宣告 `filterable: true`（頂層欄位與 table 底下的欄位皆可）；只有宣告過的欄位能篩選或排序。
2. 三個列表 query 支援 `fieldFilters`（AND 組合，必須指定 `templateId`）；`approvalInstances` 與 `approvalInstancePageInfo` 支援 `sort`。
3. 篩選與排序的結果落在呼叫者原本可見的實例範圍內，不產生推測不可見實例的側通道。
4. 篩選結果可信：可篩選欄位的值在每條寫入路徑都經型別檢查；宣告時若舊資料或歷史版本與型別不一致，拒絕啟用。
5. **效能範圍**：單一範本 1 萬筆實例以內，2–3 個條件加排序的分頁查詢 p95 < 300 ms（§9）。超出此範圍的 host 有明確的升級路徑，且對外 API 不變（§4.3）。

### 2.2 非目標（本 ADR 不處理）

- 任何對 `formData` 的伺服器端遮蔽（§8.2；本 ADR 只預留內部擴充點）。
- 全文檢索。文字比對以「包含」（大小寫不敏感的子字串）為上限。
- 以 table 底下的欄位排序（§7.5）。
- 草稿、完成生命週期 webhook、寫回 metadata API、resubmit 的 initiatorPolicyCel 修正（§13，另案）。

---

## 3. 設計摘要

```
 表單定義版本
   └─ 欄位 filterable: true（頂層或 table 欄位）
         │  勾選時（草稿儲存）與發布時：
         │   - 歷史版本同 key 型別一致？    否 → 拒絕
         │   - 舊實例的值符合型別？         否 → 拒絕
         ▼
 寫入（W1–W4）：可篩選欄位做型別檢查，不符即拒絕寫入
         ▼
 approval_instances.form_data (jsonb)  ── GIN (jsonb_path_ops)
         ▼
 查詢：既有可見範圍 → template_id → fieldFilters（AND）
       → sort（+ id 次序鍵）→ page / pageSize
```

核心決策：

1. **宣告**：表單設計者逐欄勾選（§5）。判斷能不能篩，只看範本目前版本的宣告。
2. **儲存**：不建新表。直接查 `form_data`，只加一條整欄 GIN 索引（§4）。
3. **正確性**：可篩選欄位的值在寫入時強制型別檢查；啟用前檢查歷史版本型別與舊資料，任一不符即拒絕並在介面明確提示（§5.4、§6）。
4. **權限**：篩選只能收窄既有可見範圍；不做欄位級遮蔽，但預留內部擴充點（§8）。
5. **語意**：等於／不等於／在清單內／範圍／包含五種運算子；table 底下多個條件必須在同一列成立；排序可用可篩選欄位與三個時間欄位，NULL 依 PostgreSQL 預設，一律附加 `id` 次序鍵（§7）。

---

## 4. 儲存與索引

### 4.1 決策：直接查 `form_data`，只加整欄 GIN

```sql
CREATE INDEX IF NOT EXISTS "IDX_approval_instances_form_data_gin"
  ON "approval_instances" USING gin ("form_data" jsonb_path_ops);
```

- 「等於」「在清單內」轉為 `form_data @> $1::jsonb`（參數由程式組成 JSON），走這條 GIN 索引；多選陣列與 table 列陣列的包含判斷也成立。
- 「範圍」「包含」與排序不建索引。查詢先以 `template_id`（既有索引）與可見範圍縮小到單一範本，再逐列計算。
- 依據：提出需求的 host 預期單一範本每年不超過 1000 張；§2.1 的效能範圍定為 1 萬筆。

### 4.2 為什麼不採用其他方案

| 方案 | 不採用的理由 |
| --- | --- |
| A. 類型化投影表（每實例每欄位一列） | 對本效能範圍過重：四條寫入路徑的雙寫一致性、上線回填、多一張大表。保留為 §4.3 的升級路徑 |
| B. 每欄位一條表達式索引（如 `((form_data->>'amountTwd')::numeric)`） | 範本在後台發布，索引只能由函式庫在**執行期**建立與刪除：`CREATE INDEX CONCURRENTLY` 不能在發布交易內執行，需另做背景工作；host 的資料庫帳號需有建索引權限；這些索引不在任何 migration 之內，host 對整個 schema 跑 TypeORM `migration:generate` 時可能被視為多餘而產生 DROP（未實證，但足以構成風險）。**給多個 host 用的函式庫不在執行期改 host 的 schema** |

### 4.3 升級路徑（給資料量超出效能範圍的 host）

- 查詢條件的產生收在一個**內部介面**（例如 `ApprovalInstanceFieldFilterCompiler`）之後，v1 的實作是 §7 的 jsonb SQL。
- 不對外匯出，不進 `docs/api-reference.md`。
- 若日後某 host 超出 §2.1 的範圍，可另開 ADR 以投影表實作同一介面；對外 GraphQL、service 選項與 client SDK 不變。
- `docs/api-reference.md` 的列表 query 說明需寫明 v1 的效能範圍。

---

## 5. 宣告規則

### 5.1 宣告位置與誰決定

- 欄位定義新增 `filterable?: boolean`（預設 `false`），由**表單設計者逐欄勾選**。頂層欄位與 table 的欄位定義（`TableColumnDefinition`）皆可宣告。
- 共用同一表單版本的範本，可篩選宣告必然相同；要不同的宣告，就各自建表單版本。
- 判斷某欄位能不能篩，**只看範本目前版本**（`current_version_id`）所指表單版本的宣告。取消勾選只是 API 不再接受該欄位，資料本身不變，重新勾選立即可用。

### 5.2 允許的型別

| 位置 | 允許 | 不允許 |
| --- | --- | --- |
| 頂層 | `text`、`textarea`、`number`、`money`、`date`、`datetime`、`select`、`autocomplete`、`radio`、`checkbox`、`boolean`、`member`、`org_unit` | `file_upload`、`table` 本身 |
| table 欄位 | `text`、`number`、`money`、`date`、`datetime`、`select`、`autocomplete`、`boolean`（即 `TABLE_COLUMN_FIELD_TYPES` 全部） | — |

- `hidden` 欄位可以宣告可篩選；`hidden` 只是畫面旗標。
- 保留字：`submittedAt`、`updatedAt`、`completedAt` 不得作為可篩選欄位的 fieldKey（排序欄位會用到）。

### 5.3 欄位路徑

- 頂層欄位以 fieldKey 指稱，例如 `amountTwd`。
- table 的欄位以 `<tableKey>.<columnKey>` 指稱，例如 `items.price`。因 fieldKey 不含 `.`，路徑沒有歧義。只支援一層（table 不可巢狀）。

### 5.4 啟用檢查（勾選時與發布時）

某欄位在新版本中為可篩選時，必須同時通過兩項檢查，否則**拒絕**：

1. **歷史型別一致**：這個範本所有**有實例的已發布版本**中，同路徑的欄位型別必須與新版本相同。不只比較前一版；只要歷史上任何一版型別不同，該欄位就不能啟用篩選。
2. **舊資料型別正確**：這個範本既有實例中，該路徑的值必須符合型別。判定規則：

   | 值 | 判定 |
   | --- | --- |
   | 欄位不存在、`null` | 沒有值，通過 |
   | `number`／`money`／`date`／`datetime` 欄位存了空字串 `""` | 沒有值，通過 |
   | 其他型別不符（例如金額存 `"abc"`、日期存 `"11/3"`） | 髒值，拒絕 |

兩個執行時點（發布、compose 與回滾的檢查，在取得範本列 `FOR UPDATE` 之後、同一交易內執行，§15）：

- **勾選當下**：設計器呼叫唯讀 query `filterableFieldIssues(templateId, formDefinitionId, schemaJson)` 取得問題清單，在勾選框旁明確顯示錯誤。草稿儲存**不阻擋**——草稿不影響任何實例，擋在草稿會讓設計者無法先存再改。
- **發布時**：伺服器再檢查一次，作為最終依據（防止繞過設計器直接呼叫 API）。掛點為範本服務的版本發布（一般發布與「表單＋流程一次建立」的 compose 共用）與**回滾**——回滾會讓舊版本成為目前版本，同樣要通過檢查。不通過回 `ConflictException`，訊息逐條列出問題。
- 設計器「儲存草稿」會把表單存成**已發布**的表單定義版本——範本版本只能綁定已發布的表單版本（既有設計）。這不影響本節的保證：送出、寫入檢查（§6）與列表篩選都讀**範本現行版本所綁的表單版本**，範本發布被拒時現行版本與其表單不變，衝突的欄位對任何案件都不生效；其他範本改綁這個表單版本時，同樣在它自己的發布時點受檢查。
- 判定邏輯是 `@rytass/bpm-core-shared` 的純函式 `readFilterableFieldIssues`，前後端共用，訊息由 `describeFilterableFieldIssue` 產生。

錯誤訊息必須明確且給出路：

- 歷史型別衝突：指出衝突的版本號與當時的型別。
- 舊資料不符：列出筆數、前若干筆實例 id（table 附列號）與預期型別。**不列實際值**：設計者不一定能讀那些實例，而 schema 由設計者自己送出，若回傳實際值，任何 key 都能被「宣告為可篩選」來讀出存值。僅剩的資訊是「該 key 的舊值是否符合某型別」與筆數，設計者本就能定義表單要收什麼資料，視為可接受。
- 兩者都提示解法：**改用新的 fieldKey 再勾選可篩選**（舊實例在新 key 上即為「沒有值」，篩選時不符合、排序時依 §7.6 排列，行為可預期）。舊實例的表單值目前沒有 API 可修改，故不提示「修正資料」。

設計器的勾選框旁另需說明：

- 勾選後，此欄位的 key 與型別在之後的版本不能再改。
- HIDE／hidden 不是保密手段。

---

## 6. 寫入時的型別檢查

- **只對可篩選欄位**強制型別檢查；未宣告的欄位維持現狀，不影響任何現有 host（現在沒有任何範本有可篩選欄位）。「所有欄位一律檢查」屬破壞性變更，另案處理。
- 四條寫入路徑（W1–W4，§1.3）都必須套用同一個檢查函式，不符即拒絕寫入。W4 `SET_FORM_FIELD` 是流程內部寫入，同樣適用。
- 檢查依據為**範本目前版本**的可篩選路徑（F3）：送出用送出當下的表單版本；補填、重送與 `SET_FORM_FIELD` 讀範本目前版本，因為查詢也以目前版本解讀。
- **檢查在寫入交易內，且在取鎖之後執行**（§15）：W1 送出在交易內對範本列取 `FOR SHARE`，確認範本目前版本仍是送出時綁定的版本（否則回 `ConflictException`），再檢查並寫入；W2–W4 在各自的寫入交易內、實例 advisory lock 之後取同一把 `FOR SHARE`，再以目前版本檢查。交易外的預檢（W3 重送）只做提早拒絕，不作為依據。
- 各型別的正規儲存格式（依 §1.5 的 P0 查證定案）：

  | 型別 | 正規格式 |
  | --- | --- |
  | `number`、`money` | JSON number |
  | `date` | 字串 `YYYY-MM-DD` |
  | `datetime` | `Date#toISOString()` 形狀：`YYYY-MM-DDTHH:mm:ss.sssZ`（UTC） |
  | `select`、`autocomplete`、`radio`、`text`、`textarea` | 字串 |
  | `checkbox`、多選 | 字串陣列（單選類欄位也接受字串陣列，`[]` 為沒有值） |
  | `boolean` | JSON boolean |
  | `member`、`org_unit` | id 字串（member 多選為字串陣列） |

- 空值（`null`、不存在，以及數字／日期欄位的 `""`）依既有 `required` 規則處理，不屬型別錯誤。

---

## 7. 查詢語意

### 7.1 前提

- 使用 `fieldFilters` 或 `sort`（時間欄位除外）時**必須指定 `templateId`**，否則 `BadRequestException`。
- `fieldKey` 不是目前版本的可篩選欄位 → 拒絕，錯誤訊息不透露該欄位是否存在。
- 所有 `fieldFilters` 之間為 AND。同一路徑可出現多次（例如範圍兩端分開傳），服務端合併為同一條件。

### 7.2 運算子與型別

| 運算子 | 意思 | 適用型別 |
| --- | --- | --- |
| `EQUALS` | 等於 | 全部可篩選型別（`textarea` 除外） |
| `NOT_EQUALS` | 不等於 | 同上（`boolean` 除外） |
| `IN` | 在清單內 | 文字、選項、member、org_unit、數字 |
| `RANGE` | 介於 `from`～`to`（含兩端，可只給一端） | `number`、`money`、`date`、`datetime` |
| `CONTAINS` | 包含片段，不分大小寫 | `text`、`textarea`、`select`、`autocomplete`、`radio`、`checkbox` |

- `boolean` 只支援 `EQUALS`；`textarea` 只支援 `CONTAINS`。
- 多值欄位（`checkbox`、多選 select／autocomplete／member）：`IN` 與 `EQUALS` 為**任一值命中即符合**；`NOT_EQUALS` 為「沒有任何一個值等於」。
- 沒有值的實例不符合任何條件，包含 `NOT_EQUALS`。
- 數字、金額、日期的條件值一律以**字串**傳遞（金額為十進位字串，日期為 `YYYY-MM-DD` 或 ISO 8601），不用 `Float`，避免精度問題。

### 7.3 用選項的顯示名稱搜尋

`CONTAINS` 用在選項型欄位時，同時比對**值**與**顯示名稱**，任一命中即符合：

| 選項來源 | 名稱在哪 | 做法 |
| --- | --- | --- |
| 接資料來源 | 每筆實例的 `form_data_option_snapshot`（只含被選中的選項） | 比對該欄位快照中 `options[*].label` |
| 靜態選項（頂層或 table） | 表單定義 | 查詢前先以名稱比對這個範本**所有有實例的版本**的選項定義，得出符合的 value 集合，再以 `@>` 比對（可走 GIN） |

名稱是**送出當時**的快照，選項改名後，舊實例仍以舊名稱被搜到。此語意需寫入使用說明。

### 7.4 table 底下的欄位

- 篩選語意為「**任一列符合**」。
- 同一 table 的多個條件，必須在**同一列**同時成立。例：`items.sku EQUALS A1` 且 `items.qty RANGE from 10`，表示「有一列 sku 為 A1 且數量 ≥ 10」。
- 不同 table、或 table 與頂層欄位的條件之間，照常 AND。

### 7.5 排序

- 可排序：頂層可篩選欄位，以及三個時間欄位：

  | 排序欄位 | 對應 | 語意 |
  | --- | --- | --- |
  | `submittedAt` | `started_at` | 首次送出時間，重送不變 |
  | `updatedAt` | `updated_at` | 案件那一列最後一次被寫入的時間。哪些動作會更新它，P2 逐一驗證並寫入 api-reference（例如會簽節點中途有人核准、只改任務列時可能不更新） |
  | `completedAt` | `completed_at` | 完成時間，未完成為 NULL |

- 時間欄位排序不需要 `templateId`。
- **不能**以 table 底下的欄位排序。需要時，由 host 把彙總值（最大、最小、總和）寫進一個頂層 hidden 欄位，再對它排序。
- 未指定 `sort` 時維持既有預設：`created_at DESC`。

### 7.6 NULL 與次序鍵

- NULL 依 **PostgreSQL 預設**：升冪時排最後，降冪時排最前。
- 排序欄位值不是預期型別時視為 NULL（依 §5.4 與 §6，可篩選欄位不應出現這種值；此為防禦）。
- 一律附加 `id` 為最終次序鍵（方向同最後一個排序欄位），修正 §1.1 的分頁不穩定缺陷。

### 7.7 SQL 形狀與安全

- **日期不在 SQL 轉型**：`date` 與 `datetime` 的正規格式（§6）本身可依字串順序比較，範圍與排序直接比較文字，不做 `::date`／`::timestamptz` 轉型，因此不會因非法日期（如 `2026-02-30`）讓查詢報錯；格式不符的值以正規表示式排除，視為沒有值。條件值同樣先正規化為正規格式再傳入。
- **選項與成員的兩種形狀**：同一欄位的值可能是字串或字串陣列，`EQUALS`／`IN` 對每個值組成兩個包含條件，以 `OR` 連接（`form_data @> {"k":"v"}` 或 `form_data @> {"k":["v"]}`），兩者都走 GIN。
- **值一律以參數傳遞**，不拼進 SQL 或 jsonpath 字串。路徑只能來自已驗證的 fieldKey（符合 `^[A-Za-z_][A-Za-z0-9_]*$`）。
- 型別轉換一律包在 `CASE WHEN jsonb_typeof(...) = '<type>' THEN ... END` 中，確保髒值不會讓查詢報錯；不依賴 `AND` 的短路順序（PostgreSQL 不保證）。
- `CONTAINS` 的 `%`、`_`、`\` 需跳脫後再以 `ILIKE` 比對。
- 形狀示意（實際由 §4.3 的內部介面產生）：

```sql
SELECT ai.id
FROM approval_instances ai
WHERE ai.template_id = $templateId
  AND <既有可見範圍子句>
  -- EQUALS／IN：可走 GIN
  AND ai.form_data @> $vendorJson::jsonb
  -- RANGE：逐列計算，型別防禦
  AND CASE WHEN jsonb_typeof(ai.form_data -> 'amountTwd') = 'number'
           THEN (ai.form_data ->> 'amountTwd')::numeric END
      BETWEEN $amountFrom AND $amountTo
  -- table 同一列多條件
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(ai.form_data -> 'items') = 'array'
           THEN ai.form_data -> 'items' ELSE '[]'::jsonb END) r
    WHERE r ->> 'sku' = $sku
      AND CASE WHEN jsonb_typeof(r -> 'qty') = 'number'
               THEN (r ->> 'qty')::numeric END >= $qtyFrom)
ORDER BY CASE WHEN ai.form_data ->> 'applyDate' ~ '^\d{4}-\d{2}-\d{2}$'
              THEN ai.form_data ->> 'applyDate' END DESC,
         ai.id DESC
LIMIT $pageSize OFFSET $offset;
```

- 分頁維持 `page`／`pageSize`（OFFSET）。改用 `.offset()/.limit()` 並明確寫次序鍵，避免 TypeORM `.skip()/.take()` 的兩段查詢行為。
- `listApprovalInstances`、`countApprovalInstances`、`approvalInstancePageInfo` 共用同一條件建構函式，三者算出的數量必須一致。

---

## 8. 權限

### 8.1 原則

1. 所有 `fieldFilters` 與 `sort` 都在 `applyReadableInstanceFilter` 之後套用，不得改寫、略過或放寬可見範圍。
2. 不可見實例從不參與比對，也不影響結果數量，因此不產生側通道。
3. v1「能篩某欄位」等於「能讀該實例」，因為讀取面本來就回傳整份 formData（§1.4）。

| 情境 | 結果 |
| --- | --- |
| 呼叫者能讀實例 | 進入候選集，篩選與排序生效 |
| 呼叫者不能讀實例 | 不進候選集；不影響任何結果或數量 |
| `canReadAllWorkflows` | 候選集為全部實例 |
| 欄位在某節點 `display: HIDE`，或為 `hidden` | 照常可篩 |

### 8.2 不做欄位遮蔽，但預留擴充點

- v1 **不做**伺服器端欄位遮蔽。文件與設計器明寫 HIDE／hidden 不是保密手段。
- 若日後做遮蔽（伺服器依檢視者拿掉某些欄位的值），篩選也必須同時禁止以看不到的欄位當條件；否則可用範圍篩選反覆試探，推出被遮蔽的值。
- 為此，篩選條件產生前先呼叫內部介面「這位檢視者可以用哪些欄位篩」（例如 `ApprovalInstanceFilterableFieldPolicy`）。v1 的實作回傳目前版本全部可篩選欄位，行為與沒有此介面相同。不對外匯出。日後做遮蔽時替換實作即可，對外 API 不變。

---

## 9. 效能

- **範圍**：單一範本 1 萬筆實例以內，2–3 個條件加排序的分頁查詢 p95 < 300 ms。
- **狀態**：**未實測**，所有判斷皆為分析，P4 以實測取代。2026-11-11 第一次實測因量測機器長時間高負載而作廢、P4 擱置（見 Phase 26 §P4），數字未採用。
- 主要成本依序：
  1. 可見範圍的 EXISTS 子句（非管理員）。
  2. count 與 list 各查一次（client 端 `Promise.all` 並行）。
  3. 列表回應帶完整範本快照與 formData，序列化時間需計入 p95。
  4. 「範圍」與排序對單一範本的實例逐列計算；在 1 萬筆內預期可接受，P4 實測確認。
- 實測未達標時，不放寬門檻，依 §4.3 另開 ADR 評估投影表。

---

## 10. Migration

- 新增一支 migration，只建 §4.1 的 GIN 索引，以一般的 `CREATE INDEX IF NOT EXISTS` 在 migration 交易內建立。
- **原裁決 F10（非交易、`CONCURRENTLY`）不可行**：TypeORM 的 `migrationsTransactionMode` 預設為 `'all'`，在此模式下只要任何一支 migration 宣告 `transaction` 屬性，整批就拋 `ForbiddenTransactionModeOverrideError`（`typeorm/migration/MigrationExecutor.js`）。函式庫無法要求每個 host 改成 `'each'`，否則升級即失敗。
- 代價：建索引期間 `approval_instances` 會被鎖住寫入。在 §9 的效能範圍內只需數秒；實例量大的 host 可在升級**前**自行執行 `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_approval_instances_form_data_gin" ON "approval_instances" USING gin ("form_data" jsonb_path_ops);`，migration 遇到同名索引會跳過。`docs/api-reference.md` 的 migration 說明寫明此作法。
- 不新增資料表、不新增欄位、不需回填。

---

## 11. API 變更

### 11.1 GraphQL SDL（草案）

```graphql
enum ApprovalInstanceFieldFilterOperator {
  EQUALS
  NOT_EQUALS
  IN
  RANGE
  CONTAINS
}

input ApprovalInstanceFieldFilterInput {
  "頂層 fieldKey，或 table 欄位路徑 <tableKey>.<columnKey>"
  fieldKey: String!
  operator: ApprovalInstanceFieldFilterOperator!
  "EQUALS、NOT_EQUALS、IN、CONTAINS 使用；EQUALS／NOT_EQUALS／CONTAINS 只取第一個元素"
  values: [String!]
  "RANGE 的下界（含）；數值為十進位字串，日期為 YYYY-MM-DD 或 ISO 8601"
  from: String
  "RANGE 的上界（含）"
  to: String
}

enum ApprovalInstanceSortDirection {
  ASC
  DESC
}

input ApprovalInstanceSortInput {
  "頂層可篩選欄位的 fieldKey，或 submittedAt、updatedAt、completedAt"
  field: String!
  direction: ApprovalInstanceSortDirection = DESC
}

type Query {
  approvalInstances(
    view: ApprovalInstanceListView
    searchText: String
    state: [ApprovalInstanceState!]
    templateId: String
    page: Int
    pageSize: Int
    fieldFilters: [ApprovalInstanceFieldFilterInput!]
    sort: [ApprovalInstanceSortInput!]
  ): [ApprovalInstance!]!

  approvalInstanceCount(
    view: ApprovalInstanceListView
    searchText: String
    state: [ApprovalInstanceState!]
    templateId: String
    fieldFilters: [ApprovalInstanceFieldFilterInput!]
  ): Int!

  approvalInstancePageInfo(
    view: ApprovalInstanceListView
    searchText: String
    state: [ApprovalInstanceState!]
    templateId: String
    page: Int
    pageSize: Int
    fieldFilters: [ApprovalInstanceFieldFilterInput!]
    sort: [ApprovalInstanceSortInput!]
  ): ApprovalInstancePageInfo!
}
```

- 新增參數皆為可選，既有呼叫不受影響。

### 11.2 Service 選項型別（草案）

```ts
export type ApprovalInstanceFieldFilterOperator =
  | 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'RANGE' | 'CONTAINS';

export interface ApprovalInstanceFieldFilter {
  readonly fieldKey: string;
  readonly operator: ApprovalInstanceFieldFilterOperator;
  readonly values?: readonly string[];
  readonly from?: string;
  readonly to?: string;
}

export interface ApprovalInstanceSort {
  readonly field: string;
  readonly direction?: 'ASC' | 'DESC';
}

// 既有 interface，改為 export，並加入以下兩欄
export interface ListApprovalInstancesOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly searchText?: string;
  readonly state?: readonly ApprovalInstanceStateEnum[];
  readonly templateId?: string;
  readonly view?: ApprovalInstanceListViewEnum;
  readonly fieldFilters?: readonly ApprovalInstanceFieldFilter[];
  readonly sort?: readonly ApprovalInstanceSort[];
}
```

- `countApprovalInstances` 的選項型別為 `Omit<ListApprovalInstancesOptions, 'page' | 'pageSize' | 'sort'>`。
- §4.3 的 `ApprovalInstanceFieldFilterCompiler` 與 §8.2 的 `ApprovalInstanceFilterableFieldPolicy` 為內部介面，不匯出。

### 11.3 Client SDK

`libs/bpm-core-client/src/lib/workflow/workflow-api.ts`：

- `ApprovalInstancesPageInput` 新增 `fieldFilters?` 與 `sort?`。
- `listApprovalInstancesPage` 的 GraphQL 變數與查詢字串同步擴充。
- 新增公開型別 `ApprovalInstanceFieldFilter`、`ApprovalInstanceSort`、`ApprovalInstanceFieldFilterOperator`。

### 11.4 `docs/api-reference.md` 受影響項目

| 項目 | 套件 | 動作 |
| --- | --- | --- |
| `listApprovalInstancesPage` 列 | bpm-core-client | 補上既有的 `templateId`，新增 `fieldFilters`、`sort` |
| GraphQL 三個列表 query | bpm-core | 新增參數說明、v1 效能範圍、`updatedAt` 的更新時機 |
| `ListApprovalInstancesOptions` | bpm-core | 由非 export 改為 export |
| `ApprovalInstanceFieldFilter`、`ApprovalInstanceSort` 等 | bpm-core、bpm-core-client | 新增 |
| `filterable` 欄位屬性與型別允許清單 helper | shared | 新增 |
| GIN 索引 migration | bpm-core | 新增，註明非交易 migration |
| 文件頂部 "Last verified against" | 全部 | 更新為當時版本（目前文件仍寫 0.19.0） |

---

## 12. 裁決紀錄

討論以 F 編號進行（括號內為本文件 Proposed 版的原題號）。

| 編號 | 題目 | 決定 |
| --- | --- | --- |
| F1 | 誰決定哪些欄位可篩選 | 表單設計者逐欄勾選 |
| F2 | 儲存方式 | 直接查 `form_data`，只加整欄 GIN；不建投影表、不建逐欄表達式索引（依據：單一範本每年 < 1000 張） |
| F3 | 以哪個版本的宣告為準（Q17） | 範本目前版本 |
| F4 | 共用表單版本的範本 | 宣告必然相同，可接受 |
| F5 | 型別鎖定範圍（Q3） | 與所有有實例的已發布版本比對，型別不同即不能啟用 |
| F6 | 寫入時型別檢查（Q11） | 只檢查可篩選欄位；勾選前檢查歷史版本 |
| F7 | 第一期型別（Q13） | 需求方的 10 種加 `boolean`、`textarea`；不含 `file_upload` |
| F8 | hidden 能否可篩選（Q5） | 可以 |
| F9 | 大量資料的升級路徑 | 文件寫明效能範圍；查詢條件產生收在內部介面後 |
| F10 | 索引 migration（Q15） | 原決定為獨立、非交易、`CONCURRENTLY`；實作時查證 TypeORM 不允許（§10），改為交易內一般建立，大量資料的 host 先自行以 `CONCURRENTLY` 建同名索引 |
| F11 | 伺服器端保密（Q4） | 不做 |
| F12 | 遮蔽擴充點（Q18） | 預留內部介面 |
| F13 | 名稱搜尋（Q2） | 支援，同時比對值與名稱；名稱為送出當時快照 |
| F14 | 「送出時間」（Q6） | 首次送出 `started_at` |
| F14-1 | 「最後更新」排序 | 用既有 `updated_at`，P2 驗證更新時機 |
| F15 | 分頁（Q7） | 維持 page／pageSize |
| F16 | 多選 IN（Q8） | 任一值命中即符合 |
| F17 | 金額傳輸（Q9） | 十進位字串 |
| F18 | NULL 排序（Q12） | PostgreSQL 預設（升冪排最後、降冪排最前） |
| F20 | table 欄位篩選 | 第一期就做，語意為任一列符合 |
| F21 | table 多條件 | 必須在同一列成立 |
| F22 | table 欄位排序 | 不支援 |
| F23 | 舊資料型別不符 | 拒絕啟用，介面明確提示 |
| F24 | 數字／日期欄位的空字串 | 視為沒有值 |
| F25 | 完成時間排序 | 開放 `completedAt` |

因 F2 而作廢：原 Q1（投影範圍）、Q10（回填方式）、Q14（`pg_trgm` 原本即必要條件）、Q16（回填觸發）。

---

## 13. 另案缺口（只評估，不設計）

| 順序 | 缺口 | 查證結果 | 證據（src） | 建議優先序 |
| --- | --- | --- | --- | --- |
| 1 | `resubmitApprovalInstance` 不檢查 initiatorPolicyCel | **屬實**。submit 有檢查並以 `ConflictException` 拒絕；resubmit 無此檢查，但仍呼叫 `validateSubmittedFormData`（~1958） | submit ~840–850；resubmit ~1879–2020 | **高**（內控） |
| 2 | 完成後沒有讓 host 寫回 metadata 或外部參照的 API | **屬實**。`SET_FORM_FIELD` 是流程內部的服務動作，不是 host API | `workflow-engine.mutations.ts` 的 `@Mutation` 清單 | **高**（整合阻斷） |
| 3 | 沒有「實例完成」生命週期 webhook；完成通知寫死 IN_APP | **屬實**。webhook（ADR 18）只掛在 NOTIFY 節點 | `notification.service.ts` ~754–765 | 中高 |
| 4 | fieldAccess 只作用於頂層欄位 | **屬實** | `field-access.ts`、`field-access-lint.ts` | 中 |
| 5 | 實例沒有草稿 | **基本屬實**：`ApprovalInstanceStateEnum.DRAFT` 已存在並註冊於 GraphQL，但沒有任何寫入路徑 | `workflow-engine.enums.ts` 第 6 行 | 低中 |
| 6 | 所有欄位（非僅可篩選欄位）於送出時強制型別檢查 | F6 的延伸；屬破壞性變更，需附 release note | §6 | 中 |

---

## 14. 與需求方說法不符、需要更正的地方

| 需求方說法 | 查證結果 |
| --- | --- |
| 0.19.0 的 `listApprovalInstances` 只有 templateId／state／searchText／view | 基準版本已是 0.20.1。現有參數還有 `page`、`pageSize`；`view` 是 `SENT`／`CC`／`ALL` 的列舉 |
| searchText 只搜 title、發起人與 id | 屬實，但「發起人」實為 `initiator_member_id`（member id），不是姓名 |
| `ListApprovalInstancesOptions` | 存在，但為非 export 的 interface |
| 列表查詢只有兩個 query | 實際有三個：`approvalInstances`、`approvalInstanceCount`、`approvalInstancePageInfo` |
| `listApprovalInstancesPage` 的參數 | client 另有 `templateId` 參數，`docs/api-reference.md` 漏列 |
| `hidden` 是一種欄位型別 | 錯誤。`hidden` 是任何欄位都可設定的布林旗標 |
| `hostSubmitted` 範本 | 整個 repo 不存在此名稱 |
| 「實例沒有草稿」 | 基本正確，但 `DRAFT` 列舉成員已存在 |
| 完成通知行號 `notification.service.js:461` | dist 行號；src 為 `notification.service.ts` ~754–765，結論成立 |
| 欄位在節點上 `HIDE` 即不可見 | 僅影響畫面，API 回傳的 `formData` 仍含該值 |
| `docs/api-reference.md` 的版本 | 文件頂部寫 0.19.0，應更新 |

---

## 15. 風險

- **型別檢查是篩選正確性的唯一防線**：jsonb 方案下，型別錯的值會默默不符合。緩解：§5.4 啟用檢查加上 §6 的四路徑寫入檢查；P1 gate 逐路徑測試。
- **`updated_at` 的更新時機不一致**：某些簽核動作可能不寫案件列。緩解：P2 逐一驗證並寫入 api-reference，不承諾未驗證的語意。
- **靜態選項的名稱比對範圍**：需掃這個範本所有有實例的版本的定義，版本多時成本上升。緩解：只讀版本清單與表單定義，P4 量測。
- **效能數字未實測**：P4 實測前不對外承諾 p95。
- **名稱快照不回溯**：需由採用的 host 確認業務上可接受，並寫入使用說明。
- **舊資料無法修正**：§5.4 拒絕後唯一出路是改用新 key；若之後新增「寫回表單值」的 API（§13 第 2 點），可再提供修正路徑。
- **發布與寫入的併發（已處理）**：原本啟用檢查（§5.4）與寫入檢查（§6）之間沒有鎖。發布交易讀完舊資料、尚未 commit 時，若另一個請求用舊版本送出案件，且某欄位在舊版本不是可篩選，就會寫入一筆新版本認定為型別錯誤的值；此後這筆案件在該欄位的篩選中被視為沒有值，且不再受檢。影響是單筆案件被篩選漏掉、不會報錯。現行做法：
  - **發布、compose、回滾**：在交易內先對 `approval_templates` 該列取 `FOR UPDATE`（TypeORM `pessimistic_write`），啟用檢查在取鎖之後、同一交易內執行；發布在取鎖後才重讀草稿版本與其表單綁定，檢查的是提交 commit 時的內容。
  - **W1–W4**：在各自的寫入交易內對同一列取 `FOR SHARE`（`pessimistic_read`），並以取鎖後的範本目前版本 schema 檢查。W1 的檢查已從交易外移入寫入交易，取鎖後若範本目前版本已不是送出時綁定的版本，回 `ConflictException` 請重送。
  - **範本的啟用、停用與基本資料編輯**：同樣在交易內先取 `FOR UPDATE`，取鎖後才讀整筆範本並存回。這幾條路徑會把讀到的整個 entity 存回；若在鎖外讀取，發布在讀與存之間 commit 時，TypeORM 會把讀到的舊 `currentVersionId` 當成變更寫回，蓋掉剛發布的版本。取鎖後讀到的是最新已 commit 的列，發布則等編輯結束。
  - **選列鎖、不選 advisory lock**：範本列鎖直接表達「範本的版本狀態」，且不與實例的 `pg_advisory_xact_lock(hashtext(instanceId))` 共用鍵空間（hashtext 可能碰撞）。
  - **鎖順序**：實例 advisory lock → 範本列鎖。發布、compose、回滾只取範本列鎖、不取實例鎖；W 路徑從不寫 `approval_templates`，因此不會出現 `FOR SHARE` 升級成 `FOR UPDATE` 的死鎖，也不會與發布形成環狀等待。
  - **驗證**：單元測試以 mock 斷言鎖的模式與「鎖先於檢查」的順序（`template.service.spec.ts`、`workflow-engine.service.spec.ts`）。repo 沒有整合測試基礎設施，另於 develop DB 手動驗證（2026-11-11）：以 psql 持有範本列 `FOR UPDATE` 數秒，同時送件（W1）或停用範本，兩者都等到鎖釋放才繼續，之後依取鎖後的狀態處理。
