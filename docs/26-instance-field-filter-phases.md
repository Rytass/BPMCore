# 26 — 簽核實例欄位篩選開發 Phase

- **狀態**：P0–P3 IMPLEMENTED（2026-11-11，本機 develop 端對端操作通過，待獨立 verifier）；P4 PLANNED
- **規劃日期**：2026-11-10；依 ADR 25 的裁決（2026-11-11）改寫
- **權威決策**：[25 — ADR：簽核實例依表單欄位篩選與排序](./25-instance-field-filter-adr.md)（Accepted）
- **完成定義**：P0–P4 全部 VERIFIED，且請款範本的驗收情境（§驗收情境）在 wrapper host 實際操作通過；`docs/api-reference.md` 同步更新。

每個 phase 可獨立 ship（`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠）。狀態機沿用
`PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，VERIFIED 由未參與實作的獨立 verifier 推進。

## Phase 總覽

| Phase | 交付 | 相依 | 狀態 |
| --- | --- | --- | --- |
| P0 | 現況測試：送出型別檢查與各型別的實際儲存格式；api-reference 版本行更正 | — | IMPLEMENTED |
| P1 | `filterable` 宣告、lint、啟用檢查（歷史型別與舊資料）、四路徑寫入型別檢查 | P0 | IMPLEMENTED |
| P2 | 查詢：GIN migration、條件編譯器（內部介面）、權限擴充點、sort、service 與 GraphQL | P1 | IMPLEMENTED |
| P3 | Client SDK、設計器勾選與錯誤提示、列表篩選面板、api-reference 同步 | P2 | IMPLEMENTED |
| P4 | 1 萬筆效能實測、wrapper host 驗收 | P3 | PLANNED |

```
 P0 ──▶ P1 ──▶ P2 ──▶ P3 ──▶ P4 ──▶ 驗收（wrapper host）
```

---

## P0 — 現況測試

**Scope**

- 以測試記錄 `validateSubmittedFormData` 現況：對 `hidden` 與非 hidden 的 `number`、`money`、`date`、`datetime`、`boolean` 欄位送入錯誤型別、空字串、`null`，記錄實際行為。只記錄，不改程式。
- 查證 client（`libs/bpm-core-react` 的表單元件）對每個可篩選型別實際寫入的格式（數字是 number 還是字串、日期格式、datetime 是否含時區），定案 ADR 25 §6 的正規格式表。
- 查證 W4 `SET_FORM_FIELD` 是否有任何型別檢查。
- 更正 `docs/api-reference.md` 頂部 "Last verified against"，並補上 `listApprovalInstancesPage` 漏列的 `templateId`。

**Gate**

- 現況測試結果與正規格式表寫回 ADR 25 §1.5 與 §6（同 commit）。

---

## P1 — 宣告、啟用檢查與寫入型別檢查

**Scope**

- `libs/shared/src/lib/form.ts`：頂層欄位與 `TableColumnDefinition` 新增 `filterable?: boolean`；新增型別允許清單 helper（ADR §5.2）與「值是否符合型別」純函式（ADR §5.4 的判定表、§6 的正規格式）。前後端共用。
- `form-schema.validator.ts` lint：型別不在允許清單 → 拒絕；保留字 `submittedAt`、`updatedAt`、`completedAt` → 拒絕。
- 啟用檢查（ADR §5.4），同時用於**草稿儲存**與**發布**：
  - 歷史型別一致：與範本所有有實例的已發布版本比對同路徑型別。
  - 舊資料型別正確：掃描該範本實例在該路徑的值（table 欄位掃每一列）。
  - 錯誤結構化回傳：欄位路徑、衝突版本與型別、不符筆數、前若干筆實例 id 與實際值，以及「改用新 fieldKey」的建議。
- 寫入型別檢查（ADR §6）：W1–W4 套用同一函式，只檢查目前版本的可篩選欄位，不符即拒絕寫入。

**Gate**

- 每條 lint 與判定規則有正向與反向 unit test；判定表的每一列（不存在、`null`、`""`、型別不符）各一個測試。
- 既有無 `filterable` 的表單 fixture，lint 與送出行為和變更前完全一致（regression test）。
- 啟用檢查整合測試：
  - v1 `amount` 為 text、v2 改 money 並勾選 → 草稿儲存與發布皆被拒，訊息指出 v1。
  - 型別相同但舊實例有 `"abc"` → 被拒，訊息含筆數與實例 id。
  - 舊實例只有 `null`、`""` 或缺值 → 通過。
  - 改用新 key → 通過。
- 寫入檢查：W1–W4 各一個「可篩選欄位型別錯 → 拒絕」與「非可篩選欄位型別錯 → 照舊接受」的測試。

---

## P2 — 查詢

**Scope**

- Migration：獨立一支，交易內以 `CREATE INDEX IF NOT EXISTS` 建 `form_data` 的 GIN（`jsonb_path_ops`）索引；不宣告 `transaction`（TypeORM `'all'` 模式會拒絕整批，見 ADR §10）。
- 內部介面：
  - `ApprovalInstanceFieldFilterCompiler`：把 `fieldFilters` 與 `sort` 轉為 SQL 片段（ADR §7.7）。v1 實作為 jsonb；不匯出。
  - `ApprovalInstanceFilterableFieldPolicy`：回傳檢視者可用的可篩選欄位；v1 回傳目前版本全部可篩選欄位；不匯出（ADR §8.2）。
- `workflow-engine.service.ts`：
  - `ListApprovalInstancesOptions` 改為 export，新增 `fieldFilters`、`sort`。
  - 運算子與型別對照、多值任一命中、沒有值不符合任何條件（ADR §7.2）。
  - 名稱搜尋：資料來源選項比對快照；靜態選項先比對所有有實例的版本的定義再轉為 value（ADR §7.3）。
  - table 欄位：同一 table 的條件合併為同一列的 EXISTS（ADR §7.4）。
  - 排序：頂層可篩選欄位與 `submittedAt`／`updatedAt`／`completedAt`；NULL 依 PostgreSQL 預設；附加 `id` 次序鍵（ADR §7.5、§7.6）。
  - `templateId` 必填規則與未宣告欄位的拒絕（ADR §7.1）。
  - 三個列表 query 共用同一條件建構函式；分頁改 `.offset()/.limit()`。
- 驗證 `updated_at` 的更新時機：逐一測 submit、decideTask（含會簽節點中途核准）、resubmit、`SET_FORM_FIELD`、reject、return、cancel、complete，列出會與不會更新的動作，寫入 api-reference。
- `workflow-engine.queries.ts`：三個 query 新增參數與 input／enum 型別（ADR §11.1）。

**Gate**

- 權限矩陣測試（§E2E 矩陣 E11、E12）：每種角色的結果等於「可見實例」與「篩選結果」的交集；只改不可見實例的值時，count 不變。
- 型別防禦測試：直接在 DB 塞入髒值（繞過寫入檢查），查詢不報錯，該筆視為不符合／NULL。
- 參數化測試：篩選值含 `'`、`%`、`_`、`\`、jsonpath 特殊字元，結果正確且無注入。
- count、list、pageInfo 對同一條件總數一致。
- 分頁穩定性：值相同的多筆資料連續翻頁，重複與遺漏皆為 0。
- `EXPLAIN` 確認 `EQUALS`／`IN` 條件走 GIN 索引。
- GraphQL 端以實際 HTTP 請求驗證。

---

## P3 — Client SDK、設計器與列表篩選面板

**Scope**

- `libs/bpm-core-client`：`ApprovalInstancesPageInput` 新增 `fieldFilters`、`sort`；新增公開型別（ADR §11.3）。
- 設計器（`libs/bpm-core-react`）：
  - 頂層欄位與 table 欄位的「可篩選」勾選框。
  - 勾選框旁說明：勾選後 key 與型別不能再改；HIDE／hidden 不是保密手段。
  - 草稿儲存時的啟用檢查錯誤，明確顯示在該欄位旁（衝突版本、不符筆數與實例 id、改用新 key 的建議）。
- 列表頁：依範本目前版本的可篩選欄位動態產生篩選控件與排序選項（含三個時間欄位）。以 Mezzanine UI 元件組合實作，不自建元件。
- `docs/api-reference.md`：依 ADR §11.4 更新全部受影響列。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠。
- 設計器在 wrapper host 實際操作：勾選觸發啟用檢查錯誤時，錯誤顯示在欄位旁且內容完整；改用新 key 後可儲存與發布。
- 列表篩選與排序在 wrapper host 實際操作通過（見 §驗收情境）。**不得只憑 typecheck 與測試即宣告完成。**

---

## P4 — 效能實測與驗收

**Scope**

- 在 develop 或獨立 schema 產生單一範本 1 萬筆合成實例（含 table 欄位，每筆 5–20 列）。
- 依 §E2E 矩陣 S1–S5 執行查詢，記錄 `EXPLAIN (ANALYZE, BUFFERS)` 與 p95（每情境至少 200 次，暖快取與冷快取各一組），量測包含 GraphQL 序列化。
- 量測結果寫回 ADR 25 §9（取代「未實測」）。

**Gate**

- S1–S4 的 p95 < 300 ms。
- 未達標不得放寬門檻：依 ADR 25 §4.3 另開 ADR 評估投影表。

---

## E2E 驗收矩陣

| 編號 | 情境 | 階段 | 角色 | 期望 |
| --- | --- | --- | --- | --- |
| E1 | vendor EQUALS（廠商 id） | P2、P3 | 管理員 | 只回傳該廠商實例；走 GIN |
| E2 | vendor CONTAINS（廠商名稱片段） | P2、P3 | 管理員 | 命中選項快照，大小寫不敏感 |
| E3 | amountTwd RANGE（只給下界） | P2、P3 | 管理員 | 只回傳下界以上 |
| E4 | amountTwd RANGE（上下界） | P2、P3 | 申請人（SENT） | 只含自己送出的實例 |
| E5 | applyDate RANGE | P2、P3 | 簽核人（任務可見） | 只含任務可見實例 |
| E6 | companyCode EQUALS、requestType IN | P2、P3 | 管理員 | AND 組合正確 |
| E7 | demandDept（org_unit）EQUALS | P2、P3 | 管理員 | 依組織 id 篩選 |
| E8 | 排序 applyDate DESC、amountTwd ASC | P2、P3 | 管理員 | 正確；NULL 依 PostgreSQL 預設；相同值依 id 穩定 |
| E9 | 排序 submittedAt、updatedAt、completedAt | P2、P3 | 管理員 | 正確；未完成實例的 completedAt 為 NULL |
| E10 | table：items.sku EQUALS 且 items.qty RANGE | P2、P3 | 管理員 | 只回傳「同一列」兩條件皆成立的實例 |
| E11 | 無關人員以 amountTwd 區間篩選 | P2 | 無關人員 | 結果與不可見實例的值無關 |
| E12 | count、list、pageInfo 對同條件 | P2 | 管理員 | 總數一致 |
| E13 | 未指定 templateId 但有 fieldFilters | P2 | 任一 | BadRequest |
| E14 | 篩選未宣告 filterable 的欄位 | P2 | 任一 | 拒絕，訊息無存在性資訊 |
| E15 | 歷史版本型別不同時勾選 | P1、P3 | 範本設計者 | 草稿儲存即報錯，指出衝突版本 |
| E16 | 舊資料有髒值時勾選 | P1、P3 | 範本設計者 | 報錯，列出筆數與實例 id，建議改用新 key |
| E17 | 可篩選欄位送入錯誤型別（W1–W4） | P1 | 申請人、簽核人、流程 | 拒絕寫入 |
| S1 | vendor EQUALS + amountTwd RANGE，applyDate DESC | P4 | 管理員 | p95 < 300 ms |
| S2 | vendor IN + amountTwd RANGE + applyDate RANGE，amountTwd ASC | P4 | 申請人（SENT） | p95 < 300 ms |
| S3 | companyCode + requestType，submittedAt DESC | P4 | CC 檢視者 | p95 < 300 ms |
| S4 | vendor CONTAINS（名稱），updatedAt DESC | P4 | 簽核人 | p95 < 300 ms |
| S5 | S1 的最後一頁 | P4 | 管理員 | 記錄延遲，不設門檻 |

## 驗收情境（請款範本）

範本欄位：

- `vendor`：autocomplete（接資料來源），值為廠商 id，可篩選（E1、E2）
- `amountTwd`：money，`hidden`，可篩選（E3、E4）
- `applyDate`：date，可篩選（E5、E8）
- `companyCode`、`requestType`：select，可篩選（E6）
- `demandDept`：org_unit，可篩選（E7）
- `items`：table，其中 `sku`（text）與 `qty`（number）可篩選（E10）

通過條件：E1–E17 全數通過，P4 的效能門檻達成，並在 wrapper host 實際操作一次。

---

## 風險與緩解

| 風險 | 影響 | 緩解 |
| --- | --- | --- |
| 某條寫入路徑漏做型別檢查 | 髒值默默不符合，篩選結果錯誤 | P1 gate 逐路徑測試；P2 型別防禦測試確保查詢不報錯 |
| 正規儲存格式與 client 現況不符 | 正常送出被拒 | P0 先查證 client 實際格式再定案 |
| `updated_at` 語意不一致 | 「最後更新」排序不如預期 | P2 逐一驗證並寫入 api-reference |
| 效能未達標 | 上線延後 | P4 實測；未達標依 ADR §4.3 另開 ADR，不放寬門檻 |
| 名稱快照與現況不同 | 使用者誤解搜尋結果 | 使用說明明寫快照語意 |
| 需求方以為 HIDE 是保密 | 誤用 | 設計器說明與文件明寫 |

---

## 不在本 Phase 範圍（另案）

見 ADR 25 §13：resubmit 不檢查 initiatorPolicyCel、完成後沒有寫回 API、沒有完成生命週期 webhook、fieldAccess 只作用於頂層欄位、實例草稿、所有欄位的送出型別檢查。
