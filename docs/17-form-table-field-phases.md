# 17 — 表格欄位開發 Phase

- **狀態**：已確認（2026-08-25 ADR 16 Accepted）；P0 VERIFIED，P1 可啟動
- **規劃日期**：2026-08-24
- **權威決策**：[16 — ADR：表格欄位架構](./16-form-table-field-adr.md)
- **完成定義**：所有 Phase gate、demo seed 場景、repository-wide e2e 與文件同步完成

每個 phase 可獨立 ship（typecheck / lint / test / build 全綠），phase 間有嚴格順序
相依。狀態機沿用 `PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，
VERIFIED 由未參與實作的獨立 verifier 推進。

## Phase 總覽

| Phase | 交付                                      | 相依 | 狀態         |
| ----- | ----------------------------------------- | ---- | ------------ |
| P0    | Shared 契約 + 結構 lint + cel-js 驗證報告 | —    | VERIFIED     |
| P1    | 後端送出驗證 + runtime 韌性               | P0   | VERIFIED     |
| P2    | 前端靜態表格（Builder + Renderer）        | P1   | VERIFYING    |
| P3    | Cell 層級 DataSource（全鏈路）            | P2   | PLANNED      |
| P4    | E2E golden path + demo seed + 文件 + 發布 | P3   | PLANNED      |

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

**驗證狀態**：Gate 全綠（`pnpm typecheck` 6 專案、`pnpm lint` 0 error、
`nx run-many -t test --skip-nx-cache` 530 tests / 54 suites 全過）。另以 12 組惡意
schema 實測 lint（columns 非陣列、column 非物件、ROW_FIELD 自我引用、三層巢狀
table、`form["items"][0]` bracket 形式條件、`maxRows: 0`、無 maxRows 但
`minRows: 500`、column defaultValue 型別錯誤、column select 無 option source 等）
結果皆符合預期；同時確認「top-level fieldKey 與某 table 的 column key 同名」與
「兩張 table 使用相同 column key」維持合法（ADR §3.1 的命名空間分層）。
**獨立驗證（2026-08-25，未參與實作者）**：ADR §4 九條逐條核對，七條有直接對應
實作、一條（`FIELD` 指向 table 內部欄位）功能有擋但走通用訊息、一條（column
dataSource 環境 lint）確認屬 P3 例外；`docs/api-reference.md` 對 `form.ts` 全部
43 個 export 零遺漏；`FormFieldValue` 讀值點全掃無 crash 風險。驗證者以獨立的
15 組對抗性 schema 實測，結果與實作者的 12 組一致。Gate 於驗證者環境重跑亦全綠
（55 suites / 531 tests）。**必修項：0**。兩項非阻擋發現已分別記入 P1 scope
（`writeValueAtPath` 非 no-op）與下方建議清單。

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

**獨立驗證留下的非阻擋建議**

- `FIELD` binding 若寫的是某表格的 column key，目前落在通用訊息
  「does not match a schema field」而非專屬訊息。效果正確（仍被擋），純措辭；
  P2 做 builder binding UI 時順手改即可。另注意：column key 與某 top-level 純量
  欄位同名時，`FIELD` 會合法解析到該 top-level 欄位——這正是 ADR §3.4「FIELD 只
  指 top-level」的預期語意，不是漏洞。
- 「table 未出現在 uiSchema.layout」不會被擋。查證為既有行為：lint 從來只單向
  檢查 layout 項目必須對應到 schema 欄位，扁平欄位同樣不檢查反向覆蓋率，非本次
  引入的缺口。

## P1 — 後端送出驗證與 runtime 韌性

**Scope**

- `workflow-engine.service.ts`：`validateSubmittedFormData` 遞迴驗證 table
  （形狀、列數、未知 column key、逐列 required；錯誤訊息用 instance path）。
- Case title：`readFirstCaseTitleField` 跳過 table；`readFieldValueLabel` 對
  table 值顯示列數（client lib `workflow-api.ts`）。
- Runtime 防呆驗證：`workflow-condition-evaluator` 與 `readValueAtPath` 遇 table
  值安全回 `undefined`（P0 已核對屬實，只需補 unit test）；attachment 掃描
  `readAttachmentRefsFromFormData` 是通用遞迴，可安全走過 row record，補測即可
  （V1 無 file_upload column，需確認不誤判）。
  **`writeValueAtPath` 需改行為，不只是補測**：`writeNestedValue`
  （`workflow-engine.service.ts:5691-5717`）在中繼值不是 record 時用 `{}` 取代，
  因此 `SET_FORM_FIELD` 路徑若指向 `items.qty`，會把整個表格的列陣列覆寫成
  `{ qty: ... }`，不是 ADR §3.8 所述的 no-op。P0 的獨立驗證發現，lint 已擋下
  已發布模板走到這條路徑，但縱深防禦這一層要在 P1 補上。
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

**實作結果**（2026-08-25）

異動檔案：

- `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`：
  `validateSubmittedFormData` 把 table 從扁平的「missing required fields」清單移
  出，改走 `validateSubmittedTableValue` 逐條回報 instance path 錯誤（形狀、列
  數上下限、未知 column key、非 primitive cell、逐列 required）；
  `writeNestedValue` 在中繼值已是非 record 時改為 no-op；
  `evaluateFormConditionExpression` 對 table operand 直接回 fallback。
- `libs/bpm-core/src/lib/form/form-table-reference.ts`（新增，內部模組、不從
  package index 匯出）：`readTableFieldKeys`／`referencesTableInternals`／
  `isTableInternalFieldKey`。
- `libs/bpm-core/src/lib/form/form-schema.validator.ts`：改用上述共用 helper，
  移除本地的 `referencesTableInternals` 副本。
- `libs/bpm-core/src/lib/template/template.service.ts`：
  `validatePublishableVersion` 新增 `lintWorkflowTableReferences`，對所有 CEL
  運算式（含 `initiatorPolicyCel`、entry condition、approver expression、webhook
  payload、SET_FORM_FIELD value）與 edge structured condition 的
  `conditionFieldKey` 阻擋 table 內部 path。
- `libs/bpm-core-client/src/lib/form/form-rendering.ts`：
  `evaluateConditionExpression` 對 table operand 回 fallback（與後端同語意）。
- `libs/bpm-core-client/src/lib/workflow/workflow-api.ts`：
  `readFirstCaseTitleField` 跳過 table；`readFieldValueLabel` 對 table 回「N 列」。

新測試：`workflow-condition-evaluator.spec.ts`（新檔，6 例），以及
`workflow-engine.service.spec.ts`（16 例）、`template.service.spec.ts`（5 例）、
`attachment.service.spec.ts`（2 例）、`workflow-api.spec.ts`（2 例）、
`form-rendering.spec.ts`（3 例）的新增段落。獨立驗證後再補 5 例（見下）。

**Gate 結果**：`pnpm typecheck` 6 專案全過、`pnpm lint` 0 error（2 個既有
warning，位於 `attachment-options.ts:70` 與 `signature-options.ts:85`，皆不在
本次 diff 內）、`nx run-many -t test --skip-nx-cache` 6 專案 569 tests 全過
（P0 為 530）。`docs/api-reference.md` 不需更新——本 phase 沒有新增、移除或改名
任何 `libs/*/src/**` 的公開 export，`form-table-reference.ts` 刻意不從
`lib/form/index.ts` 匯出，比照 ADR 14 §3.7 的
`form-data-source.validation.ts`。（獨立驗證者已逐鏈確認此不變式成立。）

**獨立驗證（2026-08-25，未參與實作者）**：三個 gate 於驗證者環境 fresh 重跑
全綠；ADR 16 §3.7／§3.8／§4 逐條核對；30 組自備對抗性輸入實測（送出驗證 21、
前後端條件一致性 4、發布 lint 15、`writeNestedValue` 6、edge evaluator 8、
attachment 2）。**必修 3 項，已全數修復並複驗歸零**：

1. **CEL table-internals lint 的空白繞過**（`form-table-reference.ts`）：兩條
   regex 要求 `form` 與存取子緊鄰，`form ["items"][0].qty` 因此漏網。驗證者以
   真實 cel-js（非測試 shim）實證該式 parse 成功且求值為 `true`，而
   `ConditionService` 的 root-identifier lint 也放行（table key 藏在字串常值裡
   被 `stripStringLiterals` 抹掉，`qty` 前置字元是 `.` 被排除）——等於沒有任何
   一層擋得住一條可運作的 cell 條件。修法：`form` 之後補 `\s*`（兩條 regex）。
   新增 3 個 spec（spaced bracket、spaced dot、`itemsExtra` 前綴不誤擋）。
2. **`SET_FORM_FIELD` 的 bracket path 不是 no-op**
   （`workflow-engine.service.ts` `writeValueAtPath`）：`form.items[0].qty` 被
   `normalizeFormFieldPath` 切成 `["items[0]", "qty"]`，該鍵不存在於 formData，
   於是走「建立巢狀物件」分支，實測產出多餘的 top-level 鍵
   `"items[0]": { "qty": 99 }`。後果不只是髒資料：CEL context 從此多一個
   `form["items[0]"]`，且 `readValueAtPath('items[0].qty')` 會開始回傳值，
   DYNAMIC_FORM approver resolver 的安全性論證因此被破壞。修法：任一 segment
   含 `[` 或 `]` 即整體 no-op。新增 1 個 spec。
3. **required 檢查沿原型鏈取值**（同檔 `validateSubmittedTableRow`）：
   `constructor`／`toString`／`valueOf` 都符合 P0 的 column key 識別字規則，可
   合法發布；送出空列 `{}` 時 `row['constructor']` 取到 `Object` 建構子被判為
   有值，逐列 required 被靜默略過。未知 column key 檢查用 `Map` 所以安全，只有
   required 這一處用原始索引。修法：改用 `hasOwnProperty` 的 own-property 讀取
   （`readRowCellValue`）。新增 1 個 spec。

**一併採納的非阻擋建議**：edge structured condition 若對 table 使用比較運算子
（非 IS_FILLED／IS_EMPTY），原本會把列記錄 `String()` 成 `[object Object]` 做
字串比對，手寫或匯入的 workflowDefinition 可繞過 designer 的 operator 限制，
在**路由**上造成的後果比 form-level 條件更大。`workflow-condition-evaluator`
現對含非 primitive 元素的值一律回 `false`；多選字串陣列行為不變。

**驗證者留下的非阻擋觀察（記錄，不在 P1 處理）**

- attachment 掃描對表格記錄的 `formFieldPath` 是 `form.items.name`，不是 ADR
  §3.3 的 `form.items[1].name`。V1 無 `file_upload` column，目前只在「cell 存了
  UUID 形狀字串」這個既有限制下可達；若未來開放 cell 附件需改為 instance path。
- `isFormTableCellValue` 接受 `NaN`／`Infinity`。目前三個送出 call site 一律走
  `JSON.parse`，兩者穿不過 JSON 邊界，故不可達；若日後新增非 JSON 送出路徑需補
  `Number.isFinite`。
- `readFormDataCaseTitle` 在 uiSchema 只列出 table 時，會取用 layout 之外的第一
  個純量欄位當標題。行為符合本 phase 的意圖，僅記錄此為相對 P0 的語意變化。

**ADR 未載明而在 P1 自決的項目**（皆取最小、additive、可回退解）

1. **table 錯誤與扁平 required 錯誤分開拋出**：扁平欄位維持既有
   `Form data is missing required fields: <label>` 訊息一字不動（regression
   保護），table 另以 `'; '` 串接 instance path 錯誤。同一次送出若兩者都有，
   先報扁平那批。
2. **列形狀錯誤優先於列數錯誤**：某列不是物件或帶了未知 column 時，先只回報
   形狀問題，不再疊加 min/maxRows 訊息——列數在形狀壞掉時沒有意義。
3. **required 與 minRows 取較嚴格者**：`required: true` 且 `minRows` 未設或為
   0 時視為至少 1 列（ADR §3.1 的「至少一列」）；`minRows > 0` 但
   `required: false` 時 minRows 仍然生效。
4. **`writeNestedValue` 的 no-op 條件**：只在「中繼值已存在且不是 record」時
   no-op（陣列、字串、數字、boolean）。中繼值為 `undefined` 或 `null` 時維持
   既有的「建立巢狀物件」行為，避免動到與表格無關的既有 SET_FORM_FIELD 路徑。
   單段寫入（`fieldPath` 直接就是 table 的 fieldKey）維持原行為不變，屬 ADR
   未定義的範圍，記入下方待辦。
5. **form-level 條件遇 table operand 一律回 fallback**（前後端同步）：ADR §3.8
   只說明 lint 禁止引用 table 內部 path，未定義「條件直接以 table 欄位為
   operand」的求值語意。原本的行為是掉進多選欄位的字串比對分支，等於用列記錄
   跟字串比大小，會意外決定 visibility。回 fallback 表示「V1 不支援 table 作為
   form-level 條件 operand」，與 §7「Cell 層級的 workflow 條件 operand V1 不
   開放」同一方向。edge condition 那邊不受影響——它走 `size()` 版本的
   IS_FILLED／IS_EMPTY，語意正確（見附錄 A）。
6. **`readFieldValueLabel` 的 table 分支是縱深防禦**：`readFirstCaseTitleField`
   既然已跳過 table，該分支目前沒有可達的呼叫端（全 repo 只有 case title 一個
   caller）。仍依 ADR §3.8 實作並加註解，但不為此新增公開 export 來製造可測
   路徑。

**P1 期間確認、不改行為的項目**

- `workflow-condition-evaluator` 的 `IS_FILLED`／`IS_EMPTY` 對陣列本來就是看
  長度，table 語意天然正確；`conditionFieldKey` 是單層查表，`items.qty` 只會
  拿到 `undefined`，不會誤中。已補 6 個 unit test 鎖住。
- `readValueAtPath` 的 `isRecord` 已排除陣列，路徑穿過 table 值會回
  `undefined`（DYNAMIC_FORM approver resolver 因此安全）。
- `readAttachmentRefsFromFormData` 是通用遞迴，會安全走過列記錄；V1 無
  `file_upload` column，一般 cell 值不會被誤判為附件。已補 2 個 test。
  **既有限制（非本次引入）**：任何欄位若存了 UUID 形狀的字串，都會被掃描為
  附件 ref，扁平 text 欄位一直如此；表格只是多了一個同樣形狀的位置。

**待後續 phase 或 ADR 處理**

- `SET_FORM_FIELD` 的 `fieldPath` 直接指向 table 欄位本身（單段路徑）時，仍會
  用 CEL 求值結果整包覆寫該欄位的值。lint 不檢查 `fieldPath` 是否對得上
  schema，這在扁平欄位時代就是如此。要擋需要新增「fieldPath 必須對應 schema
  欄位且不得為 table」的發布期檢查，屬 ADR §7「`SET_FORM_FIELD` 指向 table
  內部」條目的延伸，記入 ADR Review Triggers 候選，不在 P1 擴大實作。
  （P1 已把多段與 bracket 路徑收成 no-op；剩下的只有這條單段覆寫。）
- `lintWorkflowTableReferences` 涵蓋所有 CEL 運算式與 edge structured
  `conditionFieldKey`，但**不涵蓋 `action.fieldPath`**——上一條的發布期檢查若要
  做，是同一個切入點。

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

**實作結果**（2026-08-25）

異動檔案：

- `libs/bpm-core-react/src/views/forms/builder/FormBuilderView.tsx`：
  **前置重構** —— `renderTextFieldSettings` 等 type-specific 設定函式改為
  `(field, commit)` 參數化（option 類另收 `requestChange`），刪掉六個
  `updateSelectedXxxField` closure；接著新增 `FIELD_TYPE_OPTIONS` 的「表格」、
  `renderTableFieldSettings`（min/maxRows、addRowLabel、column 清單 CRUD +
  Mezzanine `Table` 原生 `draggable` 排序 + 選取欄的型別專屬設定）、
  `PendingBuilderConfirmation` 新增 `remove-column`／`replace-column`。
- `libs/bpm-core-react/src/views/forms/renderer/FormRendererView.tsx`：
  `renderStaticControl` 從 `renderControl` 抽出供 cell 重用；新增
  `FormTableField`／`FormTableCell`（列 CRUD、min/maxRows 約束、readonly、
  cell instance path 作為 `data-form-field-key`、ephemeral row id）。
- `libs/bpm-core-client/src/lib/form/form-rendering.ts`：
  `buildFormRendererValues` 對 table 種出 `minRows` 列、
  `validateFormRendererValues` 遞迴 + instance path、新增
  `readFormTableCellPath`／`readFormTableRows`／`readFormTableRowBounds`／
  `createFormTableRow`。
- `libs/bpm-core-client/src/lib/form/form-api.ts`：`createFieldDefinition`
  支援 `table`、新增 `createTableColumnDefinition`。
- `libs/bpm-core-client/src/lib/form/form-data-source-builder.ts`：新增
  `renameFormTableColumnBindings`。
- `libs/bpm-core-react/src/views/instances/new/InstanceNewView.tsx` 與
  `.../detail/InstanceDetailView.tsx`：送出與驗證改用
  `buildFormRendererValues` 組出的值（見下方瀏覽器驗證發現 2）。
- `libs/bpm-core-react/jest.config.cts` +
  `src/testing/mezzanine-icons.jest.cjs`：ESM-only 的 `@mezzanine-ui/icons`
  在 CommonJS 測試環境載不進來，改以 stub 對應（比照 bpm-core 的 cel-js 先例）。

新測試：`FormBuilderView.spec.tsx`（新檔，13 例）、`FormRendererView.spec.tsx`
（+6 例）、`form-rendering.spec.ts`（+10 例）。

**Gate 結果**：`pnpm typecheck` 6 專案、`pnpm lint` 0 error、
`nx run-many -t test --skip-nx-cache` 6 專案全綠（bpm-core-react 36、
bpm-core-client 65）。`docs/api-reference.md` 已同步四個新 client export 與
`createTableColumnDefinition`、`renameFormTableColumnBindings`。

**重構的行為不變證明**：Builder 原本沒有任何 spec。先寫
`FormBuilderView.spec.tsx` 覆蓋文字／數字／boolean／靜態選項與欄位 key rename，
確認它對**重構前後的程式碼都通過**，再進行參數化重構——而不是重構完才補測試。

**真實瀏覽器互動驗證**（cswap 專用瀏覽器，develop DB）

實際走完：建立模板「表格欄位驗證 P2」→ 加入文字欄位與表格欄位 → 改 column key
與標題、切必填 → 新增第二欄並切換型別為「數字」（確認 Modal 出現後才寫入）→
預覽分頁新增／刪除列、逐 cell 編輯 → 發布 → 發起案件 → 空品項送出（逐 cell
必填訊息出現在該 cell 下方且焦點跳至該 cell）→ 補齊兩列後送出 → 詳情頁唯讀
表格（兩列、無新增／刪除動作、案件標題取第一個非表格欄位）。

同時確認：型別下拉只列出 ADR §3.10 允許的 8 種 column 型別；表格欄位自動以
FULL 寬度加入 layout；只剩一欄時「移除此欄」為 disabled。

**瀏覽器驗證抓到、單元測試沒抓到的兩個缺陷（皆已修復並補上會失敗的迴歸測試）**

1. **column key 只吃得到第一個字**：column 列的 React key 原本是
   `${tableKey}-${columnKey}`，也就是這一列正在編輯的值。打第一個字就換 key、
   整列重掛、焦點消失。改以位置為 key（與既有靜態選項表格一致）。spec 的 Table
   mock 原本忽略列的 `key`，因此測不到；一併改為沿用列的 `key`，該測試對舊
   實作確實會失敗。
2. **發起頁把看得見的表格判為「至少需要 1 列」**：`InstanceNewView` 自己持有
   `formValues`，在填寫者動手前是 `{}`，而 Renderer 顯示的是
   `buildFormRendererValues` 種出來的列。驗證看的是前者、畫面顯示的是後者。
   兩個 view 改為先組出值再驗證與送出——順帶修好「欄位 defaultValue 不會被送
   出」這個同源的既有問題。

**ADR 未載明而在 P2 自決的項目**（皆取最小、additive、可回退解）

1. **column key rename 不走確認 Modal**：ADR §3.9 把「改 column key」列為 Modal
   案例，但欄位 key 是逐字輸入的，每打一個字彈一次 Modal 無法使用；且 P2 的
   column 還不能綁 DataSource，改名沒有任何 `ROW_FIELD` binding 會失效，沒有
   可警示的破壞性。因此 rename 直接套用並同步 `ROW_FIELD` bindings（與 top-level
   fieldKey rename 的既有行為一致），Modal 保留給真正離散且破壞性的兩件事：
   刪除欄與切換欄型別。P3 讓 column 可綁 DataSource 後，若要對「改名會影響既有
   binding」再加提示，屆時可 additive 補上。
2. **切換 column 型別只保留身分與必填**：`fieldKey`／`label`／`required`／
   `description`／`placeholder` 留下，型別專屬設定（預設值、選項、數值範圍、
   長度）一律捨棄。留著會產生 lint 會擋、但原因看起來莫名其妙的 schema。
3. **cell 清空的儲存形式**：控制項回 `undefined` 時移除該 key（未填的 cell 就
   長這樣）；文字欄位清空得到的是 `''`，與扁平文字欄位一致，required 檢查照樣
   擋得住。
4. **P2 的 column 只支援靜態選項**：`renderTableFieldSettings` 傳給共用 option
   renderer 的 `requestChange` 目前直接套用而不彈 Modal，因為沒有 DataSource
   可切換。P3 接上 column DataSource 時換成真正的確認流程。

**ADR 與現實不符，已記錄（觸發 ADR §9 Review Trigger 候選）**

- ADR §3.9 寫「超寬表格由 Mezzanine `Table` `scroll` 處理」。實際上
  `TableScroll` 只有 `virtualized` 與 `y`（垂直），**沒有水平捲動選項**。P2 改以
  外層 `overflow-x: auto` 容器承接，不覆寫元件本身任何樣式。若未來要真正的
  凍結欄／水平捲動，需要 Mezzanine 端支援，屬 ADR §9 的重新檢視項目。

**P2 期間記錄、不在本 phase 處理**

- 唯讀模式的數字 cell 仍顯示 spinner 按鈕。這是扁平 `number` 欄位既有的 readonly
  呈現行為（`Input` 的 `readonly` 不隱藏 spinner），非表格引入，未一併更動。

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
