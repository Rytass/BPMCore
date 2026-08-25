# 17 — 表格欄位開發 Phase

- **狀態**：已確認（2026-08-25 ADR 16 Accepted）；P0 已實作，P1 可啟動
- **規劃日期**：2026-08-24
- **權威決策**：[16 — ADR：表格欄位架構](./16-form-table-field-adr.md)
- **完成定義**：所有 Phase gate、demo seed 場景、repository-wide e2e 與文件同步完成

每個 phase 可獨立 ship（typecheck / lint / test / build 全綠），phase 間有嚴格順序
相依。狀態機沿用 `PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，
VERIFIED 由未參與實作的獨立 verifier 推進。

## Phase 總覽

| Phase | 交付                                      | 相依 | 狀態        |
| ----- | ----------------------------------------- | ---- | ----------- |
| P0    | Shared 契約 + 結構 lint + cel-js 驗證報告 | —    | IMPLEMENTED |
| P1    | 後端送出驗證 + runtime 韌性               | P0   | PLANNED     |
| P2    | 前端靜態表格（Builder + Renderer）        | P1   | PLANNED     |
| P3    | Cell 層級 DataSource（全鏈路）            | P2   | PLANNED     |
| P4    | E2E golden path + demo seed + 文件 + 發布 | P3   | PLANNED     |

## P0 — Shared 契約與結構 lint

**Scope**

- `libs/shared/src/lib/form.ts`：`TableFieldDefinition`、`TableColumnDefinition`、
  `FormTableCellValue`／`FormTableRowValue`、`FormFieldValue` 擴張、
  `FormDataSourceBindingSource` 加 `ROW_FIELD`、type guards
  （`isTableFieldDefinition` 等）、`normalizeFormDefinitionSchema` 遞迴正規化
  column（含 select/autocomplete `mode` 補值）。
- `libs/shared/src/lib/workflow-graph.ts`：`readConditionOperatorIds` 對 `table`
  只回 IS_FILLED/IS_EMPTY；`readFormFieldReference` 維持對 table 回
  `form.<tableKey>`。
- `libs/bpm-core/src/lib/form/form-schema.validator.ts`：`SUPPORTED_FIELD_TYPES`
  加 `'table'`、新增 `lintTableField`（遞迴重用既有 per-type lint）、column key
  regex 與唯一性、minRows/maxRows 邊界、V1 禁用項（ADR §4 全清單）、兩層依賴圖
  （row-scoped + cross-level）、uiSchema table 必須 FULL。
- **cel-js list 行為驗證**：以 unit test 實證 `form.<tableKey>`（list of map）在
  `evaluateBoolean` 下的 `size()`／`exists()`／索引行為，結論寫入本文件附錄；
  若有不可接受限制，觸發 ADR Review Trigger。
- `FormFieldValue` 型別擴張引出的**全 repo 編譯錯誤盤點**：本 phase 一併修至
  typecheck 全綠（允許以顯式「table 值不適用於此路徑」的 narrow/guard 收斂，
  行為變更留給 P1/P2）。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test` 全綠；新增 lint 規則每條至少一個
  正反向 unit test。
- 舊 schema fixture（無 table）經 normalize + lint 結果與變更前完全一致
  （regression test）。
- `docs/api-reference.md` 同 commit 更新（shared 新 export）。

**實作結果**（2026-08-25）

異動檔案：`libs/shared/src/lib/form.ts`、`libs/shared/src/lib/workflow-graph.ts`、
`libs/bpm-core/src/lib/form/form-schema.validator.ts`、
`libs/bpm-core/src/lib/condition/condition.service.ts`，加上型別收斂的
`form-data-source.validation.ts`、`form-data-source-builder.ts`、`form-api.ts`、
`form-data-source-state.ts`、`FormBuilderView.tsx`、`FormRendererView.tsx`、
`form-data-source-field.ts`。新測試：`libs/shared/src/lib/form.spec.ts`、
`cel-js-list-behaviour.spec.ts`，以及 validator／workflow-graph／condition 三份
既有 spec 的新增段落。

**ADR 未載明而在 P0 自決的項目**（皆取最小、additive、可回退解）

1. `TableFieldDefinition.defaultValue` 型別為 `never`：ADR §3.1 已規定 lint 禁止，
   型別層一併封死可在編譯期擋掉，不需額外執行期成本。
2. `FIELD` binding 指向 table 欄位本身（非內部 column）一律拒絕：list 值無法充當
   scalar 參數，ADR §4 只列了「指向 table 內部欄位」，此處取同一理由的嚴格解。
3. 依賴圖節點加 `top:` / `col:` 前綴：top-level fieldKey 不受識別字 regex 約束，
   可能含 `.`，不加前綴會與 `<tableKey>.<columnKey>` 節點名相撞。錯誤訊息輸出前
   去前綴，既有訊息格式完全不變。
4. `readConditionExpression` 對 table 產生 `size()` 版本的 IS_FILLED／IS_EMPTY，
   並在 `ConditionService` 的識別字白名單加入 `size`（比照既有的 `has` macro）：
   沿用扁平欄位的 `!= ""` 會把 0 列表格判為已填（附錄 A 實測），與 ADR §3.8 的
   「列數 > 0」語意相反。value 類 operator 對 table 回 `undefined`，不產生表達式。
5. 條件式引用 table 內部 path 的阻擋，本 phase 只做 form schema 這一半
   （`visibleWhen`／`requiredWhen`／`readonlyWhen`）；edge structured condition 那一半
   在 workflow 發布路徑，維持 P1 範圍。
6. `FormFieldValue` 放寬引出的收斂一律為顯式 narrow，不改行為：ROW_FIELD 在
   top-level resolve 路徑視同缺值（P3 才接 rowValues）、builder binding kind 對
   ROW_FIELD 回 `null`、`readStringArrayValue`／`readSelectedValues` 加元素型別檢查
   以避免把列記錄當字串處理。

## P1 — 後端送出驗證與 runtime 韌性

**Scope**

- `workflow-engine.service.ts`：`validateSubmittedFormData` 遞迴驗證 table
  （形狀、列數、未知 column key、逐列 required；錯誤訊息用 instance path）。
- Case title：`readFirstCaseTitleField` 跳過 table；`readFieldValueLabel` 對
  table 值顯示列數（client lib `workflow-api.ts`）。
- Runtime 防呆驗證（unit test 實證，不改行為）：`workflow-condition-evaluator`
  與 `readValueAtPath`／`writeValueAtPath` 遇 table 值安全 no-op；attachment
  掃描 `readAttachmentRefsFromFormData` 對 row record 的遞迴行為確認（V1 無
  file_upload column，需確認不誤判）。
- 條件 lint：發布時擋下引用 table 內部 path 的 edge structured condition
  （ADR §3.8）。form schema 側的 `visibleWhen`／`requiredWhen`／`readonlyWhen`
  已於 P0 完成，本 phase 只補 workflow 發布路徑那一半。
- P0 發現待處理：`form-rendering.ts` 的 `evaluateConditionRule` 對陣列值一律走
  `evaluateArrayCondition`（字串比對），table 值會落進去做無意義比較，需明確
  定義前端條件遇 table 值的行為（現況不會 crash）。

**Gate**

- 送出／重新送出對合法與非法 table formData 的 service-level 測試
  （含 min/maxRows、未知 key、非 record 列）。
- 既有扁平表單的送出行為 regression 全綠。

## P2 — 前端靜態表格（Builder + Renderer）

**Scope**

- **前置重構**：`FormBuilderView.tsx` type-specific 設定函式抽為
  `(field, updateField)` 參數化共用實作（行為不變，先以既有 spec + 手動驗證
  鎖定）。
- Builder：`FIELD_TYPE_OPTIONS` 加「表格」、`renderTableFieldSettings`
  （column 清單 CRUD + 拖曳排序 + 選取 column 顯示型別設定）、column key
  rename 的 `ROW_FIELD` binding 同步、破壞性變更確認 Modal、
  `createFieldDefinition`／`readDefaultFieldLabel` 加 table。
- Renderer：`FormTableField`／`FormTableCell` 元件（靜態 column 型別全支援）、
  新增／刪除列與 min/maxRows UI 約束、readonly 模式、
  `readInitialFormRendererValue`（minRows × column defaults）、
  `isFormRendererFieldValuePresent`、`validateFormRendererValues` 遞迴 +
  instance path errors + `focusFormRendererField` 聚焦 cell。
- Preview 分頁與 InstanceNewView／InstanceDetailView（唯讀）串接。

**Gate**

- `FormRendererView.spec` 與 builder spec 覆蓋：新增列、刪除列、必填逐列驗證、
  readonly 呈現。
- **真實瀏覽器互動驗證**（依開發守則）：在 client host 實際建立含表格的表單、
  發起案件填寫並送出、詳情頁唯讀檢視。
- `docs/api-reference.md` 同 commit 更新（react 套件新 export／props）。

## P3 — Cell 層級 DataSource

**Scope**

- `form-data-source.validation.ts`：schema path 定位 column、`ROW_FIELD` 讀值
  （rowValues）、`waitingForFieldKeys` 回報 column key；search 與 submit resolve
  繼續共用同一實作（ADR 14 §3.7 的單一模組不變式）。
- `form-data-source.service.ts` + `form-data-source.queries.ts`：input 加
  optional `rowValuesJson`（`@MaxLength(8192)`）、`fieldKey` 接受
  `<tableKey>.<columnKey>`；環境 lint 涵蓋 column dataSource。
- `form-data-source-value-resolver.service.ts`：迭代 table rows 逐 cell
  resolve，snapshot key 用 instance path，bindingHash 納入 row-scoped values。
- Client lib：`form-data-source-api.ts` 傳 rowValues、
  `form-data-source-builder.ts` column binding 相容性（含 ROW_FIELD 候選 =
  同表格其他 column）。
- Renderer：`FormTableCell` 接 `useFormDataSourceField`（ephemeral row id 為
  狀態 key）、cell 級 STALE/INVALID/UNAVAILABLE 呈現、送出阻擋聚合、退回編輯
  snapshot merge 與「不自動清除」語意。
- Builder：column 的 DataSource 選擇與參數綁定 UI（binding 來源多一組
  「同列欄位」）。
- P0 留下的 ROW_FIELD 暫時解需在此收掉：`form-data-source.validation.ts` 目前把
  ROW_FIELD 視同缺值、`readFormDataSourceBindingValueKind()` 對 ROW_FIELD 回
  `null`、`useFormDataSourceField` 的 refresh signature 只放 columnKey；三者都要
  換成真正的 rowValues 讀取。`FormDataSourceBindingValueKind` 屆時需擴充為含
  `'ROW_FIELD'`（公開型別變更）。

**Gate**

- Search／resolve 對 ROW_FIELD 的 unit + service 測試（含 rowValues 缺席 →
  waitingForFieldKeys、cycle lint、`FIELD` 指向 table 內部被拒）。
- 送出 resolve 的 snapshot key／bindingHash 測試（含列位移後強制重 resolve）。
- 真實瀏覽器驗證：同列連動選單（工廠 → 成本中心）、退回編輯不丟值。

## P4 — E2E、demo seed、文件與發布

**Scope**

- `apps/api` demo seed 新增含表格欄位（靜態 + 動態 column）的模板場景，
  `pnpm demo:reset` 可重現。
- Playwright golden path：設計表格 → 發布 → 發起填寫（含動態 cell）→ 送出 →
  詳情唯讀 → 退回 → 編輯重送。
- 文件同步：`docs/README.md` 索引、`docs/06-data-model.md`（formData／snapshot
  形狀補述）、`docs/api-reference.md` 終檢、ADR 16 狀態改
  `Accepted (implemented YYYY-MM-DD)`。
- `npx nx release --dry-run` 確認四套件 minor 對齊後發布。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠；
  `pnpm e2e:client --workers=1` 全綠（0 skipped）。
- 獨立 verifier 以 fresh session 走完 golden path 並簽署 VERIFIED。

## 附錄 A — cel-js list 行為驗證結論

實測環境：`cel-js@0.8.2`，context 形狀與 runtime 相同
（`form: instance.formData`，`form.items` 為 list of map）。證據落在
`libs/bpm-core/src/lib/condition/cel-js-list-behaviour.spec.ts`。

| 表達式                                    | 結果   | 說明                                   |
| ----------------------------------------- | ------ | -------------------------------------- |
| `size(form.items)`                        | 可用   | 全域 macro，回傳列數                   |
| `form.items.size()`                       | 不支援 | 丟 `Unknown method: size`              |
| `form.items[0].qty`                       | 可用   | 索引 + 欄位存取正常                    |
| `form.items[5].qty`（越界）               | 丟例外 | 非回 null，會讓條件評估失敗            |
| `form.items[0].missing`（不存在的 column）| 丟例外 | 同上，不是 null-safe                   |
| `form.items.exists(r, r.qty > 2)`         | 可用   | `all`／`filter`／`map` 同樣可評估      |
| `has(form.items)`                         | 可用   | —                                      |
| `form.empty != null && form.empty != ""`  | `true` | **0 列被判為已填**                     |

**結論**

1. 「列數 > 0／= 0」語意可以實作，但必須用 `size()`，不能沿用扁平欄位的
   `!= ""` 比較——空 list 既不是 null 也不等於 `""`，會把 0 列表格判為已填。
   因此 `readConditionExpression` 對 table 產生
   `form.X != null && size(form.X) > 0` 與 `form.X == null || size(form.X) == 0`。
2. `size(null)` 會丟例外，故必須保留 null 守衛；formData 缺 key 時同樣丟例外，
   但這是既有扁平欄位就有的行為（context 直接掛 `instance.formData`，未補 null），
   不是表格新增的問題。
3. Comprehension macro（`exists` 等）在引擎層可用，但
   `ConditionService.lintRootIdentifiers` 會把 macro 的迴圈變數判為未知識別字而
   擋下，因此目前無法出現在已發布模板中。V1 本來就不提供產生這類 CEL 的 UI
   （ADR §3.8），故**不觸發 Review Trigger**；未來若要開放 cell 級條件，需一併
   放寬識別字白名單。
4. **不可接受的限制：無**。ADR §9 第三條 Review Trigger 不觸發。

**附帶發現（範圍外，記錄供後續 phase 處理）**

- `libs/bpm-core/jest.config.cts` 用 `moduleNameMapper` 把 `cel-js` 換成
  `src/lib/testing/cel-js.jest.ts`（`Function` + `with` 的 JS eval shim），因為真
  套件是 ESM-only、CommonJS 測試環境載不進來。這代表 **`ConditionService` 的既有
  測試驗的是 JS 語意而非 CEL 語意**，兩者確有分歧（JS 的 `[] != ""` 為 false、
  `size()` 未定義）。本 phase 以子行程跑真套件取得證據，未改動該 shim；若 P1 要
  對 table 值做條件評估的行為測試，需先處理這個測試替身的保真度問題。
