# 16 — ADR：表格欄位（Table Field）架構

- **狀態**：Accepted（2026-08-25 與產品擁有者確認，含 §3.10 column 型別排除項與
  maxRows 100 上限；implementation underway as Phase P0–P4，not yet implemented）
- **決策日期**：2026-08-24（規劃日）
- **適用範圍**：Form Definition Schema、Form Builder、FormRenderer、案件發起／退回編輯／
  重新送出、workflow 條件、DataSource 整合
- **交付規劃**：[17 — 表格欄位開發 Phase](./17-form-table-field-phases.md)
- **前置決策**：[14 — ADR：表單選項 DataSource 架構](./14-form-option-data-source-adr.md)

## 1. 背景

目前 `FormDefinitionSchema` 是**嚴格扁平**的欄位陣列（`libs/shared/src/lib/form.ts:1-4`），
值契約 `FormFieldValue = boolean | number | string | readonly string[] | null`
（`form.ts:30-35`）不允許 object 或 array-of-object。整個 codebase 沒有任何巢狀表單概念：
渲染鏈非遞迴、驗證與條件系統都假設 `form.<fieldKey>` 單層索引、DataSource binding 與
option snapshot 都以 top-level `fieldKey` 為唯一鍵。

實際簽核情境大量需要「多行多欄」輸入：請購明細（品項／數量／單價）、報支明細
（科目／金額／說明）、出差同行人員清單等。這類資料的本質是**同構列的集合**：設計者
在設計期定義一組欄（column schema），填寫者在執行期動態新增／刪除列。

需求同時要求：欄（column）要能沿用既有欄位型別的能力——包含選單欄位綁定
[14 — DataSource ADR](./14-form-option-data-source-adr.md) 建立的動態選項來源，且參數
binding 要能引用**同一列**的其他欄（例：第 3 列選了「工廠」，同列「成本中心」選單
依該列工廠過濾）。

## 2. 決策驅動因素

1. 設計者能在 Form Builder 定義表格欄位的 column schema，column 沿用既有欄位型別
   的設定能力（label、必填、選項、DataSource binding）。
2. 填寫者能動態新增／刪除列，列數受設計者設定的上下限約束。
3. Column 選單支援靜態 options 與已註冊 DataSource，binding 可引用同列欄位與
   top-level 欄位。
4. 既有案件的表格資料（含動態選項 label）在來源升版／下架後顯示不漂移——沿用
   ADR 14 的 snapshot 模型。
5. 送出值必須能在後端被完整重新驗證（形狀、列數、必填、動態值 resolve）。
6. 不破壞既有扁平欄位的任何 contract：`FormFieldValue` 對既有型別維持 primitive、
   CEL context、case title、host integration 與既有 instance JSON 都不受影響。
7. 不新增資料表、不做批次資料 migration：schema 與值都繼續存進既有 jsonb 欄位。

## 3. 決策

### 3.1 新增 `table` 欄位型別，column 重用既有欄位定義

`FormFieldDefinition` union（`form.ts:6-15`）新增 `TableFieldDefinition`：

```ts
export type TableColumnDefinition =
  | TextFieldDefinition        // 僅 'text'；'textarea' 不開放（見 §3.10）
  | NumberFieldDefinition      // 'number' | 'money'
  | DateFieldDefinition        // 'date' | 'datetime'
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | BooleanFieldDefinition;

export type TableFieldDefinition = BaseFormFieldDefinition<'table'> & {
  readonly addRowLabel?: string;
  readonly columns: readonly TableColumnDefinition[];
  readonly maxRows?: number; // 1..100；未設定視為 100
  readonly minRows?: number; // 0..maxRows；未設定視為 0
};
```

- Column **直接重用既有欄位定義型別**，`fieldKey` 在表格內即 column key。這讓
  option source（靜態／DataSource 互斥 union）、`mode`、`min/max` 等設定能力
  零成本繼承，type guard 與正規化函式可遞迴套用。
- Column key 命名空間**只在該表格內**：column key 與 top-level fieldKey 不互相
  衝突，唯一性檢查分兩層（top-level 全域唯一；column 於所屬表格內唯一）。
- `table` 欄位的 `required: true` 語意為「至少一列」（與 `minRows` 取較嚴格者）。
- V1 限制（結構 lint 強制，理由見 §3.10 與 §8）：
  - 不允許巢狀 table（column 型別集合不含 `table`）。
  - Column 不允許 `visibleWhen` / `requiredWhen` / `readonlyWhen`（row-scoped 條件
    語意未定義）。
  - `table` 欄位本身不允許 `defaultValue`；初始列由 `minRows` × column
    `defaultValue` 產生。
  - `maxRows` 硬上限 100（配合既有 `formDataJson` 65,536 bytes 的 GraphQL input
    上限；ADR 14 §3.12）。

### 3.2 值契約：primitive 維持不變，僅 table 值為列陣列

```ts
export type FormTableCellValue = boolean | number | string | readonly string[] | null;
export type FormTableRowValue = Readonly<Record<string, FormTableCellValue>>;

export type FormFieldValue = FormTableCellValue | readonly FormTableRowValue[];
```

- 既有 9 種欄位的值形狀**一個位元都不變**；只有 `table` 欄位的值是
  `FormTableRowValue[]`。cell 值維持 primitive contract，因此 ADR 14「不存
  `{ value, label }`」的決策對 cell 同樣成立。
- 列**不落地任何 row id**：`formData` 內的列是純 record，順序即顯示順序。前端
  編輯期的 React key 與 DataSource 狀態使用 ephemeral row id，不寫入資料。
- 後端送出驗證拒絕：非陣列、陣列元素非 plain record、record 內含未知 column
  key、cell 值非 primitive。

### 3.3 路徑定名（canonical path forms）

| 用途 | 形式 | 例 |
| ------------------------------------ | ---------------------------- | ------------------- |
| Schema 定位（設計期、DataSource API）| `<tableKey>.<columnKey>`     | `items.costCenter`  |
| 值／錯誤／快照定位（instance 期）    | `<tableKey>[<i>].<columnKey>`| `items[2].costCenter` |
| CEL 引用                             | `form.<tableKey>`（list）    | `size(form.items)`  |

- 為讓 path 可解析，`table` 的 fieldKey 與所有 column key 必須符合
  `/^[A-Za-z_][A-Za-z0-9_]*$/u`（結構 lint 強制）。這與既有
  `readFormFieldReference`（`libs/shared/src/lib/workflow-graph.ts:1096-1101`）的
  簡單識別字規則一致；top-level 非 table 欄位維持現行寬鬆規則不變。
- 前端錯誤 map（`Record<string, string>`）與 DOM 聚焦屬性
  `data-form-field-key` 直接沿用，只是 key 擴充為 instance path 形式。

### 3.4 Column DataSource：binding 新增 ROW_FIELD kind

`FormDataSourceBinding.from`（`form.ts:61-75`）新增第三種來源：

```ts
export type FormDataSourceBindingSource =
  | { readonly fieldKey: string; readonly kind: 'FIELD' }        // top-level 欄位（既有）
  | { readonly kind: 'CONSTANT'; readonly value: boolean | number | string | null } // 既有
  | { readonly columnKey: string; readonly kind: 'ROW_FIELD' };  // 同列 column（新增）
```

- `ROW_FIELD` **只允許出現在 table column 的 dataSource** 內；top-level 欄位的
  binding 使用它是結構 lint 錯誤。
- `FIELD` 維持只指向 top-level 欄位；**不允許指向任何 table 內部欄位**——跨列
  引用（「所有列的某欄」）沒有單值語意，V1 不定義。
- 依賴圖檢查（`form-schema.validator.ts:642-698`）擴充為兩層：top-level 欄位間
  的既有圖，加上每個表格內 column 間的 row-scoped 圖（`ROW_FIELD` 邊）與
  column → top-level（`FIELD` 邊）；任一層 cycle 都阻擋發布。
- DataSource descriptor **不新增 control 種類**：column 的 select／autocomplete
  沿用 descriptor `supportedControls` 中既有的 `'select'` / `'autocomplete'`
  能力宣告與相容性規則（bounded list、分頁、搜尋限制同 ADR 14 §3.5）。

### 3.5 Search／Resolve API：以 schema path 定位 cell，rowValues 獨立傳遞

既有 4 支 preview／runtime query 與 2 支 resolve query（ADR 14 §3.6）**不新增
endpoint**，input 做 additive 擴充：

- `fieldKey` 接受 `<tableKey>.<columnKey>` schema path；後端據此在 schema 內定位
  column definition。
- 新增 optional `rowValuesJson: string`（`@MaxLength(8192)`）：該列目前的
  cell 值 record。`ROW_FIELD` binding 從 rowValues 取值，`FIELD` binding 照舊從
  `formDataJson` 的 top-level 取值。
- 未提供 `rowValuesJson` 而 column 有 `ROW_FIELD` binding 時，視同該依賴欄位
  缺值——由 `waitingForFieldKeys` 回報（值為 column key），不 throw，與 ADR 14
  §3.9 的語意一致。
- 授權模型不變：runtime context 仍是恰好 `templateId` 或 `instanceId` 其一，
  瀏覽器仍不得送入任意 DataSource key／version／binding definition。

### 3.6 送出時逐 cell 權威 resolve，snapshot key 擴充為 instance path

`resolveFormDataOptionSnapshots`（`form-data-source-value-resolver.service.ts:55-168`）
擴充為同時迭代 top-level 動態欄位與每個表格的每列動態 cell：

- Snapshot map 型別 `FormDataSourceValueSnapshots`（`form.ts:131-133`）**不變**，
  key 擴充為 `<tableKey>[<i>].<columnKey>`。`approval_instances.form_data_option_snapshot`
  jsonb 欄位照用，**不需要 migration**。
- `bindingHash` 計算納入 row-scoped binding values；全有全無、provider contract
  檢查、錯誤碼（`FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` 等）完全沿用 ADR 14 §3.7。
- Provider 呼叫併發上限 4 是**整份表單**的總限制，表格列數不放大突發流量；一張
  100 列 × 多動態欄的表單送出耗時會上升，屬接受的成本（見 §6）。
- 列插入／刪除造成 index 位移時，位移列的 snapshot key 對不上舊 snapshot，重送
  會觸發該列重新 resolve。這是刻意的 fail-safe：寧可多打 provider，也不把 A 列
  的 snapshot 拿去背書 B 列的值。
- 唯讀歷史顯示一律讀 snapshot，不打外部 API（同 ADR 14 §3.8）。

### 3.7 驗證分層

**結構 lint**（`form-schema.validator.ts`，新增 `lintTableField` 並遞迴重用既有
per-type lint）：

- `SUPPORTED_FIELD_TYPES` 加入 `'table'`；column 型別必須在 §3.1 允許集合內。
- Column key 唯一（表格內）且符合識別字 regex；table fieldKey 同樣受 regex 約束。
- `0 <= minRows <= maxRows <= 100`；`columns` 非空。
- §3.1 列出的 V1 禁用項（巢狀 table、column 條件式、table defaultValue）。
- Column option source 遞迴套用既有 option lint；`ROW_FIELD` 規則與兩層依賴圖
  （§3.4）。
- uiSchema：table 欄位的 layout width 必須為 `FULL`。

**環境 lint**（發布時，`lintDefinitionSchemaEnvironment`）：column dataSource 的
registry key/version、control 相容性、參數齊備檢查與 top-level 完全同一套實作。

**送出驗證**（`validateSubmittedFormData`，`workflow-engine.service.ts:6161-6182`）：

- 值形狀（§3.2）、列數上下限、`required` ≥ 1 列。
- 每列的 required column 逐列檢查，錯誤訊息以 instance path 指名
  （`formData.items[2].qty is required`）。
- 深度驗證維持與 top-level 相同的哲學：只驗 required／形狀／列數，min/max/length
  等仍屬前端提示層（現況即如此），不在本 ADR 加深。

**前端驗證**（`validateFormRendererValues`，
`libs/bpm-core-client/src/lib/form/form-rendering.ts:76-106`）：遞迴進表格，
errors key 用 instance path，`firstInvalidFieldKey` 可為 cell path，聚焦沿用
`data-form-field-key` 機制。

### 3.8 條件與 workflow 整合採最小開放

- **邊條件／structured condition UI**：`readConditionOperatorIds`
  （`workflow-graph.ts:915-943`）對 `table` 只回 `IS_FILLED` / `IS_EMPTY`
  （語意：列數 > 0／= 0），與 `file_upload` 同級。cell 層級 operand V1 不開放。
- **CEL**：`form.<tableKey>` 在 expression context 中是 list of map（context 建構
  `workflow-engine.service.ts:5179-5200` 直接掛整包 formData，天然支援）。cel-js
  對 list macro（`size()`、`exists()`）的實際支援度於 Phase 0 驗證並記錄；V1
  不在 designer 提供產生此類 CEL 的 UI。
- **`visibleWhen` 等表單內條件**：前端與後端的 condition regex
  （`form-rendering.ts:186`、`workflow-engine.service.ts:6267`）本就解析不了
  bracket path；lint 明確禁止條件式引用 table 內部 path，不依賴 parser 失敗作為
  防線。
- **`SET_FORM_FIELD` / `DYNAMIC_FORM` path**：V1 不支援指向 table 內部
  （`readValueAtPath` / `writeValueAtPath`，`workflow-engine.service.ts:5662-5718`
  不支援陣列索引；遇 table 值安全回 undefined／no-op）。列入 §8。
- **Case title**：`readFirstCaseTitleField` 跳過 table 欄位；列表摘要
  `readFieldValueLabel` 對 table 顯示列數（如「3 列」）。

### 3.9 前端：Builder 與 Renderer

**Form Builder**（`FormBuilderView.tsx`）：

- `FIELD_TYPE_OPTIONS` 新增「表格」；新增 `renderTableFieldSettings`：column
  清單（新增／刪除／拖曳排序，沿用 `renderFieldOptionsTable` :2257 的
  Mezzanine `Table` + inline 編輯先例），選取 column 後顯示該 column 的型別
  專屬設定。
- **前置重構**：既有 `renderTextFieldSettings` 等 type-specific 設定函式是綁定
  「目前選取 top-level 欄位」的 closure，必須先抽成接受
  `(field, updateField)` 參數的共用函式，才能同時服務 top-level 與 column 設定，
  避免整套設定 UI 複製兩份。
- 破壞性變更沿用既有確認 Modal 模式（`PendingBuilderConfirmation`）：刪 column、
  改 column key（同步 rename 該表格內 `ROW_FIELD` bindings，比照
  `renameFormDataSourceFieldBindings`）、切換 column 型別。

**FormRenderer**（`FormRendererView.tsx`）：

- `renderControl` 新增 `table` 分支 → 新 `FormTableField` 元件：Mezzanine
  `Table`，`TableColumn.render` 逐 cell 渲染 `FormTableCell`；`TableActions`
  刪列；表格下方「新增一列」按鈕（`addRowLabel` 可覆寫文案）；列數達
  `maxRows` 時按鈕 disabled，低於 `minRows` 時刪除 disabled。
- 動態 column 的 cell 各自持有 `useFormDataSourceField` 狀態（以 ephemeral row
  id + column key 為狀態 key），`waitingForFieldKeys`、`STALE`／`INVALID`／
  `UNAVAILABLE`、AbortSignal、merge snapshot options 等行為全部沿用 ADR 14
  §3.9／§3.11 的既有 hook 語意；退回編輯的「不自動清除」原則對 cell 同樣成立。
- 送出阻擋：`isFormDataSourceFieldSubmissionBlocked` 聚合所有 cell 狀態；任一
  cell 非 VALID（有值時）即阻擋，訊息指名列與欄。
- 唯讀模式：同一元件 `readonly` 渲染，動態 cell 以 snapshot label 顯示。
- 效能邊界：cell hook 數 = 列數 × 動態 column 數，上限 100 列由 lint 保證；
  超寬表格由 Mezzanine `Table` `scroll` 處理，不另做虛擬化（V1）。

### 3.10 相容性與版本策略

- `schemaVersion` 維持 `1`：新增 union 成員是 additive parsing，舊 schema 與舊
  instance JSON 原樣有效，不做批次 migration。
- **不新增任何資料表與欄位**：schema 存於 `form_definition_versions.schema`
  jsonb、值存於 `approval_instances.form_data` jsonb、快照存於既有
  `form_data_option_snapshot` jsonb。
- GraphQL 維持 stringified JSON 慣例，僅 DataSource input 增加 optional 欄位
  （§3.5），為 additive schema 變更。
- `TableFieldDefinition`、`FormTableRowValue`、`ROW_FIELD` 等公開 contract 屬
  package API 變更：四套件依 release policy 同步 minor 升版，`docs/api-reference.md`
  同 commit 更新。
- Column 型別集合刻意排除：`textarea`（cell 內多行輸入以 `text` 承接）、
  `radio` / `checkbox`（cell 空間不適合展開整組，語意由 `select` 的
  single/multiple mode 完整覆蓋，且 select 才有 DataSource 分頁能力）、
  `file_upload`（列生命週期 × 附件 ref 生命週期的交互另需設計）。三者都可在
  後續版本 additive 開放，不構成 breaking change。

## 4. 發布前驗證不變式

必須阻擋發布的案例（在 ADR 14 §4 清單之上新增）：

- `table` 的 `columns` 為空、含不支援型別、或含巢狀 `table`。
- Column key 重複、或 table fieldKey／column key 不符識別字 regex。
- `minRows > maxRows`、`maxRows > 100`、或負值。
- Column 帶 `visibleWhen` / `requiredWhen` / `readonlyWhen`；table 帶 `defaultValue`。
- `ROW_FIELD` 出現在 top-level 欄位、指向不存在的 column、或形成 row-scoped cycle。
- `FIELD` binding 指向 table 內部欄位。
- 條件式（visibleWhen 等／edge structured condition）引用 table 內部 path。
- Table layout width 非 `FULL`。
- Column dataSource 未通過既有 registry／capability／binding 環境 lint。

## 5. 後果

### 正面

- 表格資料與動態選項獲得與扁平欄位同級的：版本 immutability、snapshot 顯示
  穩定性、後端權威驗證、退回編輯不丟值語意。
- 零 DB migration、零資料 backfill；舊宿主升級只需升 package。
- Column 重用既有欄位定義，設定能力與 lint 規則不出現第二套實作。
- 值維持 primitive-in-rows，CEL、host consumer 與既有 instance 資料 contract
  不受影響。

### 成本

- `FormFieldValue` 放寬為 union 含列陣列後，所有讀值端（renderer、validator、
  resolver、case title、attachment 掃描）都要顯式處理新形狀——這是本功能最大
  的橫切面成本，以 Phase 0 的型別擴張 + 編譯錯誤驅動全面盤點。
- FormBuilderView 需先做 type-settings 重構才能複用設定面板，該檔已 2,705 行，
  重構本身需要獨立驗證。
- 多列 × 多動態欄的送出 resolve 時間上升（併發上限 4 不變）。
- 送出驗證錯誤與 DataSource 狀態的 UI 呈現複雜度顯著上升（per-cell 定位）。

## 6. 未採用方案

### 6.1 獨立資料表儲存列資料（正規化子表）

未採用。破壞「instance 是 immutable jsonb snapshot」的既有模型，帶來 join、
migration 與 host 整合成本，卻沒有換到任何查詢需求（BPM 案件不做跨案件的列級
查詢）。

### 6.2 通用 Nested Form／Group 容器先行

未採用。需求的核心是「同構列集合」，表格語意（列數上下限、逐列驗證、逐列
DataSource scope）比通用容器明確得多。單一 object 巢狀（group/section）沒有
「列」概念，另立 ADR 再議；本 ADR 的 path 定名（§3.3）為其預留了語法空間。

### 6.3 Row id 落入 formData

未採用。污染 CEL context、case title、host consumer 讀到的資料形狀；列的識別
需求只存在於前端編輯期，ephemeral id 已足夠。

### 6.4 Snapshot 改為巢狀結構（per-table map）

未採用。`FormDataSourceValueSnapshots` 維持單層 map 只擴充 key 形式，型別、
migration、既有讀取端全部不動；巢狀結構要改型別與所有讀取端，卻只換到美觀。

### 6.5 DataSource descriptor 新增 `table` control

未採用。Cell 內實際渲染的仍是 select／autocomplete，provider 的能力宣告不因
「被放進表格」而不同；新增 control 會迫使所有既有 provider 改 descriptor 才能
被 column 使用。

### 6.6 每列展開式編輯（expandable row）作為 V1 唯一互動

未採用為預設。inline cell 編輯是表格輸入的主流心智模型；Mezzanine `Table` 的
`expandable.expandedRowRender` 保留為未來「column 數過多」情境的增強選項。

## 7. V1 不在範圍

- 巢狀 table、group/section 容器。
- `textarea`、`radio`、`checkbox`、`file_upload` 作為 column 型別。
- Column 層級條件式（row-scoped `visibleWhen` 等）。
- 彙總列（SUM／AVG footer）與跨列驗證（如 column 值唯一性）。
- Cell 層級的 workflow 條件 operand、designer 產生 row-path CEL 的 UI。
- `SET_FORM_FIELD` / `DYNAMIC_FORM` 指向 table 內部 path。
- CSV 貼上／匯入、欄位凍結、虛擬捲動。
- 表格欄位的 `defaultValue`（預填列）。

## 8. 相關文件

- [04 — 模板版本機制](./04-versioning.md)
- [05 — CEL 條件機制](./05-conditions-cel.md)
- [06 — 資料模型](./06-data-model.md)
- [14 — 表單選項 DataSource ADR](./14-form-option-data-source-adr.md)
- [17 — 表格欄位開發 Phase](./17-form-table-field-phases.md)
- [Public API Reference](./api-reference.md)

## 9. Review Triggers

下列情況需重新檢視本決策：

- 出現「單一 object 巢狀（group）」需求——§3.3 path 語法與 §6.2 的切分要重新對齊。
- `formDataJson` 65,536 bytes 上限或 `maxRows <= 100` 在真實宿主不敷使用。
- cel-js 驗證（Phase 0）發現 list of map 在條件評估有不可接受的限制。
- 宿主要求 cell 級 `file_upload` 或跨列彙總進入 workflow 條件。
- FormBuilderView 重構後仍無法以單一實作服務 top-level 與 column 設定。
