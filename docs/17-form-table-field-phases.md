# 17 — 表格欄位開發 Phase

- **狀態**：已確認（2026-08-25 ADR 16 Accepted）；P0–P4 全數 VERIFIED
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
| P2    | 前端靜態表格（Builder + Renderer）        | P1   | VERIFIED     |
| P3    | Cell 層級 DataSource（全鏈路）            | P2   | VERIFIED     |
| P4    | E2E golden path + demo seed + 文件 + 發布 | P3   | VERIFIED     |

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

新測試：`FormBuilderView.spec.tsx`（新檔，16 例）、`InstanceNewView.spec.tsx`
（新檔，3 例）、`FormRendererView.spec.tsx`（+6 例）、`form-rendering.spec.ts`
（+11 例）。

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

**獨立驗證（2026-08-25，未參與實作者）**：三個 gate 於驗證者環境 fresh 重跑全綠
（56 suites / 598 tests）；ADR §3.1／§3.3／§3.4／§3.7／§3.9／§3.10 逐條核對；
41 組自備對抗性輸入實測（`buildFormRendererValues` 8、
`validateFormRendererValues` 12、純函式邊界 9、Renderer 實際掛載 12）；
api-reference 六個新 export 逐一對照無遺漏；Mezzanine 守則（零 className 覆寫、
樣式只在自建容器上、`Table` 本身無覆寫、背景色用 design token）通過。驗證者並以
`git archive` 到 /tmp 的唯讀方式複驗了「重構前後同一份 spec 都通過」的宣稱屬實。
**必修 2 項，已全數修復並複驗歸零**：

1. **Builder 可替 column 綁 DataSource，Renderer 卻渲染成純文字輸入框**：column
   共用 `renderOptionFieldSettings` 時一併拿到了「選項來源」下拉。只要宿主註冊過
   相容來源，設計者就能把 column 切成 DataSource 且不彈確認直接寫入；該 schema
   **還擋不住發布**——結構 lint 接受合法的 column dataSource，而環境 lint
   `lintDefinitionSchemaEnvironment` 只走 top-level、不下探 columns（正是本文件
   P3 scope 已載明待補的那條）。填寫時該欄落到 `renderStaticControl` 的 fallback
   變成自由文字輸入，值會未經 resolve 就進 `formData` 且沒有 snapshot。修法：
   `renderTypeSpecificSettings` 新增 `supportsDataSource` 參數，column 傳
   `false` 即不渲染選項來源列；已由手寫 JSON 帶進來的 column dataSource 原樣保留
   並顯示明確提示（比照 ADR 14 §3.10 的 unavailable 處理）。新增 2 個 spec。
2. **前端必填檢查沿原型鏈讀 cell**：與 P1 後端修過的同一類問題——
   `constructor`／`toString` 是合法 column key，`row[columnKey]` 對空列會取到
   `Object` 而被判為有值，導致前端放行、後端以難懂訊息拒收。修法：改用
   `hasOwnProperty` 的 own-property 讀取（`readFormTableCellValue`），與後端
   `readRowCellValue` 及 renderer 的 `readTableCellValue` 一致。新增 1 個 spec。

**一併採納的非阻擋建議**

- 驗證者指出「發起頁送出可見表格」這個瀏覽器發現的缺陷**沒有守門測試**——當時
  新增的 spec 只測 `form-rendering.ts` 的純函式，而修復動的是兩個 view。已新增
  `InstanceNewView.spec.tsx`（掛載真實 view + 真實 Renderer，完全不編輯就送出），
  並實測該組測試對修復前的程式碼確實失敗 2 例。
- `applyRemoveTableColumn` 改為依 index 刪除：編輯過程中兩欄可能暫時同名，依 key
  過濾會一次刪掉兩欄。
- `FormRendererView.spec.tsx` 的 Table mock 改為沿用列的 `key`，讓 ephemeral row
  id 機制（P3 的 per-cell DataSource 狀態鍵）在測試中真的被走到。

**驗證者留下的非阻擋觀察（記錄，不在 P2 處理）**

- `minRows > maxRows` 會做出鎖死的表單（新增與刪除同時 disabled），發布 lint 已擋。
  **P4 更正**：builder 兩個輸入互相夾擠（`clampOptionalNumber`），UI 上重現不了，
  只有手寫或匯入 schema 能達成；原本記為「builder 輸入過程中可暫時達成」是誤記。
- `renameFormDataSourceFieldBindings` 不下探 table columns，top-level 欄位改名時
  column 的 `FIELD` binding 不會同步。P2 因 column 不開放 DataSource 而無害，
  **P3 接上時必須一併處理**。
- 前端對畸形 table 值（字串／物件／未知 column key）靜默放行，後端明確拒收。正常
  操作產不出這種值，退回編輯載入舊資料時前端不會提示。深度取捨，記錄即可。

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
4. **P2 的 column 只支援靜態選項**：`renderTypeSpecificSettings` 對 column 傳
   `supportsDataSource: false`，選項來源下拉不渲染；傳給共用 option renderer 的
   `requestChange` 直接套用而不彈 Modal，因為 P2 只有「選擇模式」會走到它，切換
   模式僅轉換預設值。P3 接上 column DataSource 時同時開啟下拉與真正的確認流程。

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

**實作結果**（2026-08-25）

異動檔案：

- `libs/bpm-core/src/lib/form-data-source/form-data-source.validation.ts`：
  `readBindingValues` 新增 optional `rowValues`，`ROW_FIELD` 從該列讀值；
  `readWaitingForFieldKeys` 對 `ROW_FIELD` 回報 column key；binding 讀值一律
  走 own-property（`constructor` 也是合法 key）。
- `libs/bpm-core/src/lib/form-data-source/form-data-source.service.ts`：
  `readOptionField` 接受 `<tableKey>.<columnKey>` schema path（**top-level 查表
  優先**）、四個 input 加 optional `rowValuesJson`、`parseRowValues`、
  `lintDefinitionSchemaEnvironment` 遞迴進 `field.columns`。
- `libs/bpm-core/src/lib/form-data-source/form-data-source.queries.ts`：四個
  GraphQL input 加 `rowValuesJson`（`@MaxLength(8192)`）。
- `libs/bpm-core/src/lib/form-data-source/form-data-source-value-resolver.service.ts`：
  `readDynamicResolutionTargets` 把 schema 攤平成「每個待 resolve 的動態值」
  一個工作項，snapshot key 用 instance path，bindingHash 因 `rowValues` 進入
  binding values 而自動納入同列值。
- `libs/bpm-core/src/lib/form-data-source/form-data-source.types.ts`：
  `BPMFormDataSourceResolveFieldInput` 加 optional `rowValues`。
- `libs/bpm-core-client/src/lib/form/form-data-source-api.ts`：四個 input 加
  optional `rowValues` 並序列化為 `rowValuesJson`。
- `libs/bpm-core-client/src/lib/form/form-data-source-builder.ts`：
  `FormDataSourceBindingValueKind` 擴充為含 `'ROW_FIELD'`、
  `readFormDataSourceBindingValueKind` 直接回傳 kind、新增
  `readCompatibleFormTableColumnBindingFields`；
  `renameFormDataSourceFieldBindings` 改為會下探 table columns。
- `libs/bpm-core-client/src/lib/form/form-data-source-state.ts`：
  `readMissingFormDataSourceDependencies` 支援 `ROW_FIELD`。
- `libs/bpm-core-react/src/views/forms/renderer/form-data-source-field.ts`：
  `UseFormDataSourceFieldInput` 新增 `fieldPath`／`snapshotKey`／`row`
  （`UseFormDataSourceFieldRow`），cell 與 top-level 共用同一個 hook 實作。
- `libs/bpm-core-react/src/views/forms/renderer/FormRendererView.tsx`：
  `FormTableCell` 接上 `useFormDataSourceField`（以 ephemeral row id 為
  React key）、cell 級狀態訊息與重試、卸載時撤回送出阻擋。
- `libs/bpm-core-react/src/views/forms/builder/FormBuilderView.tsx`：
  `DataSourceBindingScope` 讓 binding 編輯器同時服務 top-level 與 column；
  column 的「選項來源」下拉開放，binding 來源多一組「同列：〈欄〉」。

新測試：`form-data-source.service.spec.ts`（+6）、
`form-data-source-value-resolver.service.spec.ts`（+7）、
`FormBuilderView.spec.tsx`（+3 新增、1 筆改寫——P2 的「column 無 picker」改為
「有 picker」）。獨立驗證後再補 4 例（見下）。

**Gate 結果**：`pnpm typecheck` 6 專案、`pnpm lint` 0 error、
`nx run-many -t test --skip-nx-cache` 6 專案全綠。`docs/api-reference.md` 已同步
`readCompatibleFormTableColumnBindingFields`、`UseFormDataSourceFieldRow`、
`FormDataSourceBindingValueKind` 的 `ROW_FIELD`、四個 client input 的
`rowValues`、四個 service input 的 `rowValuesJson` 與 schema path、
`BPMFormDataSourceResolveFieldInput.rowValues`。

**獨立驗證（2026-08-25，未參與實作者）**：三個 gate 於驗證者環境 fresh 重跑全綠
（57 suites / 621 tests）；ADR 16 §3.3／§3.4／§3.5／§3.6／§3.7／§3.9 與 ADR 14
§3.7 逐條核對；63 組自備對抗性輸入實測（`fieldKey` 解析 7、`rowValuesJson` 11、
binding 讀值 10、送出 resolve 15、環境 lint 7、client builder 6、結構 lint 7），
並以 GraphQL introspection 確認四個 input 都有 `rowValuesJson`、實打
`previewFormFieldOptions(fieldKey: "items.costCenter")` 取得權威 label。
**單一模組不變式獲驗證者確認成立**（全 repo 只有一份 `readBindingValues`／
`readWaitingForFieldKeys`，`rowValues` 是加在參數上；渲染端 cell 與 top-level
共用 `renderControl` 與 `useFormDataSourceField`）。api-reference 對照無遺漏。
**必修 1 項，已修復並複驗歸零**：

- **column 的 binding 環境 lint 錯誤碼降級為 `INVALID_DESCRIPTOR`**：
  `LINT_BINDING_LINE_PATTERN` 只認得 `schema.fields[n].dataSource.bindings `，
  P3 新產生的 `schema.fields[n].columns[m].dataSource.bindings ` 匹配不到，於是
  落到 fallback。使用者可見後果是 designer 明明自己漏綁參數，卻看到「請聯絡
  系統管理員」而非「請重新確認表單內容」——而該常數上方的註解正好寫著這個
  pattern 存在的唯一理由就是防止這件事。直接違反 ADR §3.7「與 top-level 完全
  同一套實作」。修法：pattern 加上 optional 的 `(?:\.columns\[\d+\])?`。

**一併採納的非阻擋建議**

1. **參數鍵側也改 own-property 讀取**：`readBindingValues` 的 `missingParameters`
   與 `hashBindings` 原本直接索引 `values[parameter.key]`。宿主 descriptor 若有
   名為 `constructor` 的必要參數且無 binding 餵，會被誤判為已滿足而**帶著缺失的
   必要參數去打 provider**。docs 先前寫的「binding 讀值一律走 own-property」原本
   只在 formData／rowValues 側成立，宣稱範圍過大——現已兩側皆是。
2. **`handleRemoveField` 的影響清單下探 column**：P3 開放 column 綁 top-level
   欄位後，刪除該欄位的確認 Modal 會漏報受影響的 column，留下懸空 binding
   直到發布才被擋。現以 `items.costCenter` 形式一併列出。
3. **`readTableRows` 不再壓縮非 record 列**：原本 `filter(isRecord)` 會讓其後所有
   列的 snapshot key 前移一格。實務上 `validateSubmittedFormData` 會先擋下，但
   索引正確性不該依賴外部呼叫順序。

**單一模組不變式（ADR 14 §3.7）**：search 與 submit resolve 仍共用
`form-data-source.validation.ts` 的同一份 `readBindingValues`；`rowValues` 是加
在該函式的參數上，兩條入口只是各自把值傳進去，沒有出現第二套 ROW_FIELD 讀值。

**真實瀏覽器互動驗證**（cswap 專用瀏覽器，develop DB）

以 `demo.cost-centers`（required `plant` 參數）建立含
`ROW_FIELD → plant` 的動態 column 模板並發布，實際走完：

1. 發起頁初始列的成本中心 cell **disabled 並顯示「請先填寫相依欄位。」** ——
   後端 `waitingForFieldKeys` 回報的是 column key，前端正確解讀。
2. 第 1 列選 TW01 後該 cell 立即可用，選單只列 TW01 的 9 筆。
3. 新增第 2 列：**第 2 列回到等待狀態，第 1 列已選值不受影響**；第 2 列選 TW02
   後只列 TW02 的 5 筆 —— 每列各自查詢、狀態互不干擾。
4. 送出成功；DB 內 `form_data_option_snapshot` 的 key 確為
   `items[0].costCenter`／`items[1].costCenter`，各自帶自己那列的權威 label。
5. 另建一份可退回的模板 → 簽核者退回 → 退回編輯頁**兩列的值與 snapshot label
   全數保留**、成本中心不需重選；新增第 3 列時只有該列進入等待狀態。
6. 第 3 列選 TW01 → 成本中心即刻載入 → 重新送出成功，snapshot 重建為三筆
   instance path，第 3 列拿到 `TW01 成本中心 003` 的權威 label。

同時以 API 直接驗證 runtime query：帶 `rowValuesJson` 回傳該廠選項、
不帶時回 `waitingForFieldKeys: ["plant"]`。

**ADR 未載明而在 P3 自決的項目**（皆取最小、additive、可回退解）

1. **`fieldKey` 解析順序**：先查 top-level 精確比對，找不到才拆
   `<tableKey>.<columnKey>`。top-level fieldKey 不受識別字 regex 約束、可能含
   `.`，必須維持它勝出，否則既有表單會被新語法搶走。已補 spec。
2. **`rowValuesJson` 的「缺席」與「空物件」不同義**：缺席代表呼叫端沒送列值
   （ROW_FIELD 視為缺值 → `waitingForFieldKeys`）；`{}` 代表列存在但該 cell 未
   填，語意相同但保留區分，讓未來要分辨「新列」與「空列」時不需改 API。
3. **併發上限維持 4，但改為每次送出的總預算**：先攤平成工作項再套上限，100 列
   × 多動態欄不會放大成 100 倍突發流量（ADR §3.6 明示「整份表單的總限制」）。
4. **binding picker 的 row 選項加 `__ROW_FIELD__:` 前綴**：column key 與
   top-level fieldKey 可能同名（ADR §3.1 的命名空間分層），不加前綴無法還原
   使用者選的是哪一種來源。
5. **cell 卸載時回報 `IDLE`**：刪除某列後，該列 cell 的舊狀態不得繼續擋住送出。
6. **column 的選項來源與選擇模式變更不彈 Modal**：沿用 P2 的決定，確認 Modal
   只留給刪除欄與切換欄型別這兩個離散且破壞性的動作。

## P4 — E2E、demo seed、文件與發布

**Scope**

- `apps/api` demo seed 新增含表格欄位（靜態 + 動態 column）的模板場景，
  `pnpm demo:reset` 可重現。
- Playwright golden path：發起填寫（含動態 cell）→ 送出 → 詳情唯讀 → 退回案件
  編輯重送。**範圍界定**：spec 從 demo seed 已發布的模板與已退回的案件出發，
  不重跑 builder 設計／發布與「退回」動作本身——前者由 P2 的 builder 測試與
  ADR §4 發布不變式覆蓋，後者由既有簽核 e2e 覆蓋，在此重跑只是重複成本。
- 文件同步：`docs/README.md` 索引、`docs/06-data-model.md`（formData／snapshot
  形狀補述）、`docs/api-reference.md` 終檢、ADR 16 狀態改
  `Accepted (implemented YYYY-MM-DD)`。
- `npx nx release --dry-run` 確認四套件 minor 對齊後發布。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠；
  `pnpm e2e:client --workers=1` 全綠（0 skipped）。
- 獨立 verifier 以 fresh session 走完 golden path 並簽署 VERIFIED。

**實作結果**（2026-08-25）

異動檔案：

- `apps/api/tools/reset-demo-data.ts`：新增 `請購明細申請（表格）` 模板場景——
  表單 `TABLE_PURCHASE_FORM_SCHEMA` 的表格混合靜態 column（廠別 select、品項
  text、數量 number、急件 boolean）與一個 `ROW_FIELD → plant` 的動態 column
  （`demo.cost-centers@1`），加上一筆 `RETURNED` 案件，兩列分屬 TW01／TW02，
  snapshot 以 instance path 逐 cell 落地（新 helper
  `createTableCellOptionSnapshot` 依該列 plant 算 bindingHash）。
- `apps/client-e2e/specs/form-table-field-real.spec.ts`（新增）：Playwright golden
  path 兩例——逐列填寫並送出（含每列獨立等待、跨列選項不互相污染、snapshot key
  為 instance path、case title 跳過 table、唯讀歷史全程沒有向宿主查任何選項就把
  每個 cell 的 label 顯示出來），以及退回編輯後重新送出（未動的列不丟值）。
- `docs/06-data-model.md`：補述 `form_data` 的表格列陣列形狀與
  `form_data_option_snapshot` 的 instance path key（含「為何列位移要重 resolve」）。
- `libs/bpm-core-react/src/views/forms/renderer/FormRendererView.tsx`：表格欄位
  不再套用單欄版面的 `maxWidth`，捲動容器內側加上依欄數推算的寬度下限（必修 3）。
- `libs/bpm-core/src/lib/form-data-source/form-data-source-value-resolver.service.ts`：
  更正 `readDynamicResolutionTargets` 的註解——擋住跨列誤用的是同索引舊值與
  bindingHash，不是 key 本身（必修 6，純註解，無行為變更）。
- `docs/16-form-table-field-adr.md`：狀態改
  `Accepted (implemented 2026-08-25)`，VERIFIED 與否改以本檔 Phase 總覽為準；
  §3.6 snapshot fail-safe 機制更正；§3.9 加上 P4 版面補正；§9 補四條 Review
  Trigger 並更正凍結欄與多段路徑兩處陳述。
- `docs/api-reference.md`：頂端「Last verified against」改為 2026-08-25／pending
  `v0.12.0`；補述 `renameFormDataSourceFieldBindings` 會下探 table columns、
  `createFieldDefinition` 支援 `'table'`、`readFormDataCaseTitle` 跳過 table。

**Gate 結果**（第二輪，UI 修正後重跑）

| 項目 | 結果 |
| ---------------------------------- | ------------------------------------------ |
| `pnpm typecheck`                   | 6 專案全綠                                  |
| `pnpm lint`                        | 0 error（2 個既有 warning，非本次引入）      |
| `nx run-many -t test --skip-nx-cache` | 6 專案全綠（627 tests）                   |
| `pnpm build`                       | 6 專案全綠                                  |
| `pnpm demo:reset`                  | exit 0，seed 可重現                         |
| `pnpm e2e:client --workers=1`      | **64 passed / 0 skipped**（第二輪驗證者實跑） |
| `npx nx release --dry-run`         | 解析為 **minor → 0.12.0**，四套件同步寫入   |

`nx release --dry-run` 另確認：changelog 依 `useCommitScope: false` 正確吃到本次
所有 `feat`／`fix` commit，四個 package manifest 都寫入 `0.12.0`，tag 為
`v0.12.0`。**未執行** version／tag／publish。

**e2e 實際執行方式（重要）**

本機 Playwright 的 chromium 下載殘缺（`chromium-1217` 只有 448 KB），
`npx playwright install chromium` 在此網路環境實質停滯。但
`apps/client-e2e/playwright.config.ts` 本來就支援 `PLAYWRIGHT_EXECUTABLE_PATH`，
指向系統既有的 Chrome 即可跑：

```bash
pnpm demo:reset          # spec 依賴表格 seed 場景，且不可重入
PLAYWRIGHT_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx playwright test -c apps/client-e2e/playwright.config.ts \
  specs/form-table-field-real.spec.ts --workers=1
```

完整 e2e 套件不是每次都綠：第二輪驗證者第一次跑到 63 passed / 1 failed，失敗在
`skill-matrix-real.spec.ts:407` 的 `waitForURL` 逾時（該表單沒有表格欄位，與本次
修正無關，單跑該 spec 3 passed），`pnpm demo:reset` 後重跑即 64 passed。表格 spec
本身也觀察到 1/14 的 flake（測試 2 送出到 `quantity` 仍是 120），已在
`fillCell` 與「重新送出」之間補上明確等待條件。

**demo seed 實測**：`pnpm demo:reset` 後以 API 確認新案件
`60000000-0000-4000-8000-000000000011` 狀態為 `RETURNED`、標題取第一個非表格欄位
（`請購事由：產線耗材補充`）、`formData.items` 為兩列 record、
`form_data_option_snapshot` 的 key 為 `items[0].costCenter`／`items[1].costCenter`；
再以 initiator 身分實打 `resubmitApprovalInstance`，走完逐 cell 權威 resolve 後
狀態轉為 `RUNNING`。驗證後已再次 `pnpm demo:reset` 還原。

**獨立驗證（第二輪）：七項必修 6 CLOSED／1 PARTIAL，程式面必修 0**

第二輪驗證者（未參與第一輪修正）重跑六道 gate 全綠（627 tests、dry-run 0.12.0），
並實跑完整 `pnpm e2e:client --workers=1`（64 passed / 0 skipped）。逐項判定：

- 必修 1、3、4、5、6、7 **CLOSED**，各附獨立量測或實打證據。其中必修 3 以「在同一
  頁面還原修正前形狀」對照量測，確認溢出 +31px → −12px、每個 chevron 都命中自己
  那格；並逐一實測四個 `FormRenderer` 呼叫端（含非 singleColumn 的 HALF/THIRD 版型
  與唯讀詳情頁），**無回歸**。必修 6 以「刪掉第一列後重送」實打證明 key 確實撞上舊
  snapshot、該 cell 仍重新 resolve（`validatedAt` 更新、options 換成 TW02）。
- 必修 2 **PARTIAL**：表格 spec 累計 14 次跑出 1 次 flake（測試 2 送出時 `quantity`
  仍是 120）。已在 `fillCell` 與「重新送出」之間補上明確等待條件並重跑通過。
- 新增三項文件必修（A/B/C），均為「文件把 floor 的作用寫得比實測更強」，已於本節
  與 ADR §3.9 更正：真正消除溢出的是「表格不吃 480 單欄上限」，floor 是欄數更多時
  的防禦而非成因；自決事項 7 的「最小值」理由改為可讀性餘裕，並補記「欄數少時反而
  多出水平捲動」的代價。
- 回歸測試有效性經第三方以 `moduleNameMapper` 換模組驗證：對修正前檔案失敗於
  `Expected "480px"`，移除 floor 則失敗於 `Expected "376px"`——兩個不變量各自獨立
  被鎖住。

**獨立驗證（第一輪）：退回，7 項必修**

驗證者（未參與實作）以 fresh session 重跑五道 gate 全綠，並額外做了：45 組對抗性
輸入實打 ADR §4 九條發布不變式（全數被擋、反向對照正確放行）、11 組送出驗證惡意
輸入（全數被擋）、bindingHash 逐位元核對 seed 與後端 `hashBindings` 一致、
GraphQL introspection 確認四支 input 都有 `rowValuesJson`、api-reference 對
`git diff` 的公開符號盤點（零遺漏）。**後端安全邊界與發布準備兩層簽 PASS、必修 0
項。**P4 本身被退回，關鍵是驗證者用 `PLAYWRIGHT_EXECUTABLE_PATH` 把 e2e 跑了起來
——結果是 **1 failed / 1 passed**，而不是原本記錄的「未執行」。

七項必修與處置：

| # | 必修項 | 處置 |
| - | ------------------------------------------------ | -------------------------------------- |
| 1 | ADR 狀態行宣稱 P0–P4 全數 VERIFIED，事實不成立     | ADR 狀態改以本檔 Phase 總覽為準（`9643190`／文件 commit） |
| 2 | e2e 測試 1 實跑失敗（不是未執行）                  | 修正後重跑 **2 passed**，本節 Gate 表更正 |
| 3 | 表格在發起頁被壓成 325px，控制項溢出疊到鄰欄       | 真實 UI 缺陷，程式修正 `0ca798f`        |
| 4 | 唯讀 select 的 label 不是 text node，斷言必定失敗  | 改用 `toHaveValue`（`2cf8235`）         |
| 5 | offline 區塊的 `route.abort()` 是死碼，且丟掉唯一的離線證明 | 改回「收集 request 後斷言為空」（`2cf8235`） |
| 6 | `docs/06` 與 ADR 把 snapshot fail-safe 的機制寫錯  | 三處（含程式註解）改為「同索引舊值 + bindingHash」 |
| 7 | ADR §9 兩處與現實不符（凍結欄、多段路徑 no-op 條件）| 依實測改寫                              |

**必修 3 的根因與修法**（唯一一項程式缺陷）

`InstanceNewView` 對 `FormRenderer` 傳 `singleColumn` + `maxWidth={480}`，該上限
原本套在 grid 容器上，表格也一起被夾。而 Mezzanine `Table` 會撐滿容器，所以
`overflow-x: auto` 容器**不會真的捲動**（修正前容器 `clientWidth` 與 `scrollWidth`
同為 325），欄寬被壓到 53px，cell 內的 select trigger 溢出自己的 `<td>` 31px 並
蓋住**前一欄**的下拉箭頭——後繪製的鄰欄控制項疊在前一欄上方，因此點不開的是
`items[0].plant` 而不是 costCenter，e2e 卡在這裡 30 秒逾時。

修法兩件事，都在 `FormRendererView.tsx`：`maxWidth` 改為逐欄位套用並跳過 table
欄位；捲動容器內側加一層「欄數 × 160px（＋列動作欄 56px）」的寬度下限。修正後實
測（Desktop Chrome 1280 寬）：

| 量測項 | 修正前 | 修正後 |
| ------------------------------ | ------ | ------ |
| 表格寬度                        | 345    | 856（= 5×160+56） |
| 捲動容器 clientWidth／scrollWidth | 325／325 | 640／856（真的會捲） |
| `items[0].plant` 的 `<td>` 寬   | 53     | 160    |
| 控制項溢出自身 `<td>` 的最大值   | +31px  | −12px（都在格內） |
| `items[0].plant` chevron 的命中元素 | 鄰欄 costCenter 的 `.mzn-text-field` | chevron 自身 |

**兩項修改的個別貢獻**（第二輪驗證者拆開量測）：真正消除溢出的是「表格不套 480
單欄上限」——只保留這一項、不加 floor 時，表格 640、每欄 117px、最大溢出 −12px，
已經不溢出。floor 的作用是把欄寬拉到 160 並讓容器真的水平捲動，屬欄數更多時的
防禦，不是本次缺陷的成因。

容器仍停在 640，那是 Mezzanine `.mzn-form-field__data-entry` 自己的上限；依
CLAUDE.md「不可覆寫改造元件外觀結構」不去動它，表格在其內水平捲動。

回歸測試 `FormRendererView.spec.tsx`「keeps the single-column cap off the table
and floors its width per column」已驗證對修正前的檔案會失敗（`Expected "480px",
Received ""`）。

**自決事項（ADR 未規範，取最小可逆選項）**

7. **每欄寬度下限 160px、列動作欄 56px**：160 不是「不溢出的最小值」——實測 117px
   欄寬就已經不溢出（−12px）；160 取的是可讀性餘裕（欄名與多數 cell 值不被壓到只剩
   幾十 px），56 比照列動作欄既有寬度。**已知代價**：採 160 後，本來放得進 640 容器
   的 5 欄表格變成必須水平捲動（856 > 640）；欄數少時這是純粹的損失，欄數多時才有
   收益。取固定值而非依欄型別推算，是因為後者要維護一張型別對照表，收益不明顯而且
   更難回退。要回退只需調整 `TABLE_COLUMN_MIN_WIDTH`，不影響溢出修正本身。

**非阻擋觀察（記錄，不在 P4 處理）**

- 窄欄下 cell 內容會被截斷且無 tooltip（160px 欄寬時 `scrollWidth` 126 >
  `clientWidth` 90，讀不到完整成本中心名稱）。已列入 ADR §9 Review Trigger——
  三種修法都會動到已驗證的唯讀渲染，不在 V1 範圍。
- `RowFieldValues` 在 barrel 未外洩（`lib/form-data-source/index.ts` 不 export
  `.validation`），但 `form-data-source.service.d.ts` 因 public method 參數而結構性
  引用它，消費端可用 `Parameters<…>` 取到；展開後即
  `Readonly<Record<string, unknown>>`，無實質風險。若要維持「內部」語意，可把該
  參數改寫成內聯型別。
- P1 待辦（`SET_FORM_FIELD` 單段 fieldPath、`action.fieldPath` 未納入 lint、
  attachment 掃描非 instance path、`isFormTableCellValue` 接受 `NaN`／`Infinity`、
  `readFormDataCaseTitle` 取 layout 外欄位）、P2 待辦（唯讀 number cell 仍有
  spinner、前端對畸形 table 值靜默放行）與 P3 六條自決事項，經第一輪驗證者逐條
  對程式碼確認**仍然成立**，維持原記錄。P2 記的
  「`renameFormDataSourceFieldBindings` 不下探 columns」已由 P3 收掉。

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
