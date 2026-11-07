# P5 細部設計：`EXPRESSION` binding（DataSource 與 webhook）

- **狀態**：DESIGN（本文件為設計，尚未實作；未修改 repo 任何檔案）
- **權威文件**：[ADR 22 §3.7](../../../../../../Repositories/BPMCore/docs/22-expression-functions-adr.md)、[Phase 23 P5](../../../../../../Repositories/BPMCore/docs/23-expression-functions-phases.md)
- **部分取代**：ADR 14（DataSource binding 來源）、ADR 18（webhook binding 的「不支援 CEL」條款），僅限 §3.7 定義的受限形式
- **相依**：P0（錯誤淨化、輸出正規化、預算）、P1（`cel-v2` 引擎與差異測試 lane）、P2（AST helper、依賴抽取、型別推論）、P3（host function，僅純函式）、P4（表達式編輯器元件、`previewExpression`、`expressionCatalog`）
- 路徑格式：現有程式陳述附 `路徑:行號`；行號取自前一輪實際讀取的內容，實作時請再核對。

---

## 1. 範圍與不做的事

做：

1. `EXPRESSION` 成為 DataSource binding 與 NOTIFY webhook binding 的第三種（新增於 FIELD、CONSTANT、ROW_FIELD／CONTEXT 之外）來源。
2. 求值只在後端，於 `form-data-source.validation.ts` 的單一實作內完成，search、resolve、submit 共用。
3. 靜態依賴由 AST 取得，接入既有的循環檢查、隱藏依賴檢查與 `waitingForFieldKeys`。
4. webhook binding 失敗記為該次投遞 `FAILED`（沿用 `WEBHOOK_PARAMETER_INVALID`），不回滾交易。
5. Builder 與 NOTIFY 設計器的綁定 UI，使用 P4 的表達式編輯器元件。

不做：

- provider 結果轉換（ADR §3.7「不做 provider 結果轉換」）。
- 瀏覽器端執行表達式、瀏覽器送入 expression 或 binding 定義。
- 新增錯誤碼（見 §5，能沿用的全部沿用）。
- 自動改寫 rename 後的表達式文字（見 §9 決策項）。

---

## 2. 型別與 schema（`libs/shared`）

### 2.1 DataSource binding

檔案：`libs/shared/src/lib/form.ts`（`FormDataSourceBindingSource` 位於 :98–111，現為 FIELD、CONSTANT、ROW_FIELD 三種）。

```ts
export type FormDataSourceBindingSource =
  | /* 既有 FIELD / CONSTANT / ROW_FIELD 不變 */
  | {
      readonly kind: 'EXPRESSION';
      /** CEL 子集，dialect 固定為 cel-v2（見 §3.4）。 */
      readonly expression: string;
    };
```

- root 不由欄位宣告，由位置決定：
  - 頂層欄位的 binding：只允許 `form`。
  - table column 的 binding：允許 `form` 與 `row`。
  - 其他 root（`env`、`initiator`、`instance` 等）一律在 lint 擋下（ADR §3.7）。
- `FormDataSourceBinding`（`form.ts:112`）的 `from` 型別跟著擴充，不需新增欄位。
- `FormDataSourceValueSnapshot`（`form.ts:155–169`）不變。`bindingHash` 的輸入是「求值後的參數值」，見 §4.3。

### 2.2 NOTIFY webhook binding

檔案：`libs/shared/src/lib/workflow.ts`（`NotifyWebhookBindingSource` 位於 :422–428）。

```ts
export type NotifyWebhookBindingSource =
  | /* 既有 FIELD / CONSTANT / CONTEXT 不變 */
  | {
      readonly kind: 'EXPRESSION';
      readonly expression: string;
    };
```

- NOTIFY 沒有 row，允許的 root 只有 `form`。這是對 ADR §3.7「root 為 form、row」的解讀（見 §10 adrConflicts）。
- 不允許 `CONTEXT` 路徑與 EXPRESSION 混用語意；`CONTEXT` 維持原本的 path 白名單。

### 2.3 結構檢查與 catalog issue

檔案：`libs/shared/src/lib/workflow-graph.ts`。

- `readNotifyWebhookStructureIssues`（:1594）：新增 `kind === 'EXPRESSION'` 分支，檢查 expression 字串非空、長度與複雜度（呼叫 P2 lint）。
- `isNotifyWebhookValueCompatibleWithParameter`（:1673）與 `isFormFieldCompatibleWithWebhookParameter`（:1629）：EXPRESSION 的型別相容性使用 P2 的 `inferExpressionValueType`（§3.2）。推不出確定型別時回傳 `unknown`，lint 報錯（見下）。
- `readNotifyWebhookTargetCatalogIssues`（:1743）與 binding 結構檢查（:1940–1952）：新增下列 issue code：

| issue code | 意義 | 對應訊息碼 |
| --- | --- | --- |
| `EXPRESSION_INVALID` | 語法、複雜度或 lint 失敗 | `BINDING_INCOMPATIBLE` |
| `EXPRESSION_ROOT_NOT_ALLOWED` | 使用了不允許的 root（含 NOTIFY 的 `row`） | `BINDING_INCOMPATIBLE` |
| `EXPRESSION_INCOMPATIBLE` | 推論型別與參數型別不符，或型別未知 | `BINDING_INCOMPATIBLE` |

- `readCatalogIssueMessage`（`libs/bpm-core/src/lib/workflow-webhook/workflow-webhook.validator.ts:152–173`）是沒有 default 的窮舉 switch，新增 issue code 後 typecheck 會強制補上分支。三個新 case 都要補。
- 前端對應：`workflow-lint-errors.ts`（P2 已要求前後端對應完整）。

### 2.4 DataSource 型別擴充

檔案：`libs/bpm-core/src/lib/form-data-source/form-data-source.types.ts`。

- `BPMFormDataSourceParameterType`（:16–20）不變。
- Search、Resolve 的 `bindings: Readonly<Record<string, FormFieldValue>>`（:49–67）維持不變，因為瀏覽器送進來的是參數值，不是 binding 定義。
- `BPMFormDataSourceResolveFieldInput`（:150–161，含 `rowValues`）與 `BPMFormDataSourceSnapshotResolutionInput`（:163–170）不變。

### 2.5 client 型別

`libs/bpm-core-client/src/lib/form/form-data-source-builder.ts` 與 `libs/bpm-core-react` 內的 `FormDataSourceBindingValueKind`（`docs/api-reference.md:650` 所列 `'CONSTANT' | 'FIELD' | 'ROW_FIELD'`）加入 `'EXPRESSION'`。

---

## 3. 求值（`libs/bpm-core` 後端）

### 3.1 單一實作位置

所有求值放在 `libs/bpm-core/src/lib/form-data-source/form-data-source.validation.ts` 的 `readBindingValues`（:169–239）。search（`form-data-source.service.ts:254–311`）、resolve（`readFormFieldOptions` 與 `resolveFormFieldOptions`）、submit（`form-data-source-value-resolver.service.ts:58–175`）都經過這個函式，所以 EXPRESSION 只需在這裡加一個分支。

webhook 不經過 DataSource 路徑，而是在 `workflow-webhook-enqueue.ts` 的 `readBindingValue`（:206–226）加分支。兩者共用同一個純函式 `evaluateExpressionBinding`（§3.3），但預算範圍不同（§3.5）。

### 3.2 P2 提供的介面（P5 依賴）

P5 不自己解析 CEL。需要 P2 提供下列純函式，放在 `libs/shared`（不依賴 cel-js，client 與 server 都能用）：

```ts
// libs/shared/src/lib/expression/expression-references.ts（P2 交付，P5 使用）
export interface ExpressionReferences {
  readonly roots: ReadonlySet<'form' | 'row'>;
  readonly formFieldKeys: readonly string[];   // 靜態抽出的 form.<key>
  readonly rowColumnKeys: readonly string[];   // 靜態抽出的 row.<key>
  readonly dynamicAccess: boolean;              // computed key、整體引用、無法靜態判定
}
export function readExpressionReferences(expression: string): ExpressionReferences;

// 推論回傳型別；無法確定時為 'unknown'
export type ExpressionValueType = 'boolean' | 'number' | 'string' | 'null' | 'unknown';
export function inferExpressionValueType(
  expression: string,
  schema: FormSchemaTypeEnv, // P2 由表單 schema 建立的欄位型別環境
): ExpressionValueType;
```

- `dynamicAccess === true` 時，發布 lint 直接拒絕（P2 gate 已有 `form["sec"+"ret"]` 等案例）。P5 不再另做一套判斷。
- P5 依賴 P2 的 AST helper。P2 尚未實作，所以 P5 的實作順序必須排在 P2 之後；本設計不替 P2 決定 AST 的內部結構。

### 3.3 評估函式

```ts
// libs/bpm-core/src/lib/form-data-source/form-data-source.expression.ts（新檔）
export interface ExpressionBindingScope {
  readonly form: Readonly<Record<string, FormFieldValue>>;
  readonly row?: Readonly<Record<string, FormFieldValue>>; // 僅 table column 才有
}

export type ExpressionBindingResult =
  | { readonly kind: 'VALUE'; readonly value: boolean | number | string | null }
  | { readonly kind: 'WAITING'; readonly waitingForFieldKeys: readonly string[] };

export function evaluateExpressionBinding(input: {
  readonly expression: string;
  readonly scope: ExpressionBindingScope;
  readonly budget: ExpressionBudget;   // §3.5
}): ExpressionBindingResult;
```

流程：

1. 以 `readExpressionReferences` 取得依賴。
2. 依賴的 form 欄位缺值（與 `readMissingFormDataSourceDependencies` 的語意一致，見 §6.2）或 `row` 缺 rowValues，回傳 `WAITING`，**不呼叫引擎**。這樣避開 CEL 的 `no such key` 錯誤，也不需要 `has()` 包裝。
3. 依賴齊全才以 P1 的 `cel-v2` 引擎求值（同步、包在 `runWithinTimeBudget` 內）。
4. 結果交給 P0 的輸出正規化 `normalizeExpressionOutput`（§3.6）；非純量或 bigint 的處理在那裡定義。
5. 再核對結果型別與參數型別，不符則丟 `INVALID_BINDING`。

### 3.4 dialect

EXPRESSION 是新功能，**只用 `cel-v2`**，不使用 `cel-js`。理由：`cel-js` 的 jest 替身（`libs/bpm-core/src/lib/testing/cel-js.jest.ts`）無法代表真實語意，且舊方言的差異清單（P1）尚未定案。

若 P1 的決策點停用 `cel-v2`，P5 整體延後（見 §9 決策項 3）。

### 3.5 預算

依 ADR §3.2、§3.7：

- 單次求值上限 100ms，`timeout` 由 `runWithinTimeBudget`（`libs/bpm-core/src/lib/workflow-engine/time-budget.ts:27–42`）強制。
- 累計上限 250ms，是**單次操作**（一次 search、一次 resolve、一次 submit、或一次 webhook 投遞草稿）內所有 EXPRESSION binding 的總和。

```ts
export interface ExpressionBudget {
  /** 剩餘毫秒數；每次求值後扣除實際耗時。 */
  remainingMs: number;
}
export function createExpressionBudget(totalMs: number): ExpressionBudget;
```

- 每個操作建立一個 `ExpressionBudget`，由 validation 模組的呼叫端傳入，所有欄位與所有表格列共用。
- `remainingMs <= 0` 時丟 `FORM_DATA_SOURCE_TIMEOUT`。
- **表格的風險**：submit 對表格會展開為「列數 × EXPRESSION binding 數」次求值（`readTableResolutionTargets`，`form-data-source-value-resolver.service.ts:276–309`）。若每列都求值，250ms 很可能在中等大小的表格就被耗盡，整張表單變成 UNAVAILABLE。
  - 實作前必須量測：以 `demo.cost-centers` 的表格與一組 50 列的合成資料，量每次 cel-v2 求值的耗時。
  - 若量測結果超出預算，列為決策項（§9-4），而不是在實作中悄悄調大預算。
- 預算值的定案依 P0 的量測結果，不在這裡寫死。

### 3.6 輸出正規化（P0 介面）

P0 提供：

```ts
// P0 交付
export function normalizeExpressionOutput(value: unknown): boolean | number | string | null; // 其他型別丟錯
```

- bigint 在 P0/P1 的正規化中轉為 number（溢位時丟錯）。`1` 與 `1.0` 必須正規化成同一個值，否則 hash 三條路徑會分歧（§4.3）。
- 物件、陣列、函式、`form.constructor` 等結果一律丟錯。

---

## 4. 三條路徑的一致性

### 4.1 共用點

`readBindingValues`（:169–239）是 search、resolve、submit 的共同值產生點。EXPRESSION 的求值只發生在這裡。

### 4.2 瀏覽器輸入被忽略

- search、resolve 的請求（`form-data-source.queries.ts`、`form-data-source.service.ts:254–311`）接受的是參數值，不接受 expression。
- 求值時 expression 來源是**儲存的定義**：
  - 已發布版本：讀取 `readRuntimeSchemaContext`（`form-data-source.service.ts:438–513`）回傳的 schema。
  - 草稿：只在 `previewFormFieldOptions` 與 `previewResolveFormFieldOptions` 使用，這兩個 query 已標 `@BPMDesignerOnly()`（`form-data-source.queries.ts:313–337`，`form-data-source.service.ts:184`）。
- 因此，preview 才會用到 designer 送來的 schema，runtime 永遠不用。這一條是 gate「瀏覽器送入的 expression 被忽略」的依據。

### 4.3 bindingHash

現況：

- `hashBindings`（`form-data-source-value-resolver.service.ts:413–431`）是私有函式，只被 value-resolver 內部使用。
- search 路徑目前沒有計算 hash（`form-data-source.service.ts:254–311`），所以 search 的結果沒有 hash 可比對。

設計：

1. 把 `hashBindings` 搬到 `form-data-source.validation.ts`，改名為 `readBindingHash`，並 export。
2. **序列化格式逐位元組不變**：`JSON.stringify({ dataSourceKey, dataSourceVersion, values: orderedValues })`，`orderedValues` 的順序沿用 `descriptor.parameters` 的順序，缺值補 `null`。
   - 理由：既有快照的 `bindingHash` 都是用這個格式算出來的。格式一動，所有既有快照在 resubmit 時的 reuse 條件（`value-resolver.service.ts:128–134`）都會失敗，變成大量重新驗證。
   - 測試：加一組 golden fixture，搬移前後同一組輸入的 hash 必須相同（§7.1）。
3. hash 只計算**求值後的參數值**，不計算 expression 文字。理由與 FIELD 只 hash 值、不 hash fieldKey 一致。expression 文字改了但結果不變時，不應觸發重新驗證。
4. search 路徑也要算 hash，但**不放進 search 的回應**。做法：在 `readBindingValues` 的輸出之後呼叫 `readBindingHash`，用於 search 內部比對；回應 DTO 不變，避免 API contract 變動。
5. EXPRESSION 的值進 hash 前必須已經過 `normalizeExpressionOutput`（§3.6）。否則 `JSON.stringify` 遇到 bigint 會丟 TypeError。

### 4.4 三條路徑的比對點

測試在 `readBindingValues` 的輸出接點比對：同一組 form 值，search、resolve、submit 產生的 `values` 與 `bindingHash` 完全相同。

### 4.5 submit 與 resubmit

- submit 的快照解析（`workflow-engine.service.ts:756–762`，`revalidateAll` 為 true，且在交易外）：求值失敗在交易開始前就丟錯，案件不會寫入（gate：預算耗盡不寫入 instance）。
- resubmit（`prepareResubmitFormDataOptions`，`workflow-engine.service.ts:946–1006`）：`canReuseSnapshot` 條件不變（`value-resolver.service.ts:128–134`）。EXPRESSION 的結果改變時，`bindingHash` 改變，自動重新驗證。

---

## 5. 錯誤碼

**原則：能沿用就不新增。**

| 情境 | 錯誤碼 | 語意來源 |
| --- | --- | --- |
| 依賴欄位缺值 | 不是錯誤，回傳 `WAITING` | `waitingForFieldKeys`（ADR 16 §3.5 語意，與 ROW_FIELD 缺 rowValues 相同） |
| 累計或單次預算耗盡 | `FORM_DATA_SOURCE_TIMEOUT` | `form-data-source.errors.ts:3–26`；client 的 `FORM_DATA_SOURCE_TIMEOUT` 對應 UNAVAILABLE（`form-data-source-errors.ts:15–32`） |
| 結果型別不符、非純量、求值丟其他錯誤 | `INVALID_BINDING` | 既有 code，fail closed |
| webhook binding 求值失敗 | 投遞列 `FAILED`，錯誤碼 `WEBHOOK_PARAMETER_INVALID` | `workflow-webhook-delivery.enums.ts:19–34` |

- 不新增 DataSource 錯誤碼。若實作時真的需要（例如要區分「表達式語法錯」與「型別不符」），新增時必須同時改四處：server `form-data-source.errors.ts`、client `form-data-source-errors.ts` 的封閉清單（:15–32）與 zh、en 訊息（:37–96），以及 `docs/api-reference.md`。
- 淨化：錯誤訊息只含錯誤碼與 label，不含 expression 原文、不含 form 值（P0 的規則，ADR §3.2）。
- 既有 `lintExpression`（`condition.service.ts:95`）、`evaluateBoolean`（:125）、`evaluateValue`（:143）的錯誤原文未淨化，屬 P0，P5 不沿用其錯誤字串。

---

## 6. 依賴、循環檢查與 lint

### 6.1 發布期 lint（`libs/bpm-core/src/lib/form/form-schema.validator.ts`）

- `lintDataSourceBinding`（:651–702）：新增 EXPRESSION 分支。
  - 允許的位置：頂層欄位與 table column。
  - root 白名單：頂層欄位只允許 `form`；table column 允許 `form` 與 `row`（見 §2.1）。
  - `dynamicAccess` 為 true 時拒絕（§3.2）。
  - 推論型別與參數型別不符時拒絕（`inferExpressionValueType`）。
  - 既有 ROW_FIELD「只能放在 table column」的檢查（:682–690）保持不變。
- `lintFieldDependencyGraph`（:1105–1118）、`readFieldDependencyEntries`（:1173–1212）、`readColumnDependencyNode`（:1214–1227）、`readBindingSources`（:1229–1238）：把 EXPRESSION 的 `formFieldKeys` 加為依賴邊。table column 的 `rowColumnKeys` 加為 column 的依賴邊。
- `lintHiddenDataSourceDependencies`（:1126–1171）：EXPRESSION 引用的隱藏欄位同樣要被檢查。

### 6.2 缺值判定的一致性

- 「依賴缺值」的定義必須與 `readMissingFormDataSourceDependencies`（client 的 `form-data-source-field.ts`，`docs/api-reference.md:632` 所列）一致。
- 建議由同一個 shared 函式提供，server 與 client 共用，避免兩邊判定不同而出現 client 顯示可用、server 回 WAITING 的狀況。
- 空字串、null、空陣列視為缺值，與現有 FIELD 規則相同。

### 6.3 循環檢查

EXPRESSION 的依賴邊加入既有圖後，循環檢查會自動涵蓋。「靜態依賴完整」的前提是 P2 已擋下整體引用與動態存取，這一點寫進 P5 的測試清單（§7.1）。

### 6.4 rename 與 delete

- `renameFormDataSourceFieldBindings`（`libs/bpm-core-client/src/lib/form/form-data-source-builder.ts:122–150`）與 `readFormDataSourceFieldDependencyKeys`（:211–217）只處理 FIELD。
- `renameFormTableColumnBindings`（:176–209）只處理 ROW_FIELD。
- 這些函式不會改寫 EXPRESSION 的文字。**P5 的預設做法**：被 EXPRESSION 引用的欄位在 rename 時擋下（回傳 lint 錯誤），刪除時也回報依賴錯誤，直到使用者手動修改表達式。自動改寫的做法列為決策項（§9-1）。
- NOTIFY 的 rename 也要同樣處理，需確認 `workflow-graph.ts` 內是否已有欄位改名的入口（未讀取，列為實作前要查證的項目）。

---

## 7. 測試清單

### 7.1 單元（jest，使用既有替身，只驗證管線）

- `readBindingHash` golden fixture：搬移前後同一組輸入的 hash 相同（最重要，防止既有快照全部失效）。
- `readBindingValues`：EXPRESSION 的 VALUE、WAITING、丟錯三種路徑。
- search、resolve、submit 對相同輸入得到相同 `values` 與 `bindingHash`（gate）。
- 瀏覽器送入的 expression 或 binding 定義被忽略：送入帶 expression 的請求，結果與不帶時相同（gate）。
- 預算耗盡：丟 `FORM_DATA_SOURCE_TIMEOUT`，且 submit 的 instance 不寫入（gate）。
- table column 的 `row` root：rowValues 缺省時回傳 WAITING，與 ROW_FIELD 一致。
- `normalizeExpressionOutput` 對 bigint、物件、函式、`form.constructor` 丟錯。
- lint：root 不允許的情況（頂層欄位用 `row`、NOTIFY 用 `row`）、`dynamicAccess`、型別不符、循環依賴（EXPRESSION 邊）、隱藏欄位依賴。
- webhook 的 `readCatalogIssueMessage` 三個新 case 的訊息。
- client：`dataSourceRefreshSignature`（`form-data-source-field.ts:175–196`）與 `bindingsChanged`（:226–253）對 EXPRESSION 的依賴欄位變更會改變 signature；`waitsForDependencies`（:276–283）對缺值依賴為 true。
- client：`renameFormDataSourceFieldBindings` 在被 EXPRESSION 引用時回傳錯誤。

### 7.2 真引擎 lane

- 不走 `cel-js.jest.ts` 替身，使用 P1 交付的真引擎 lane（`cel-v2`）。
- 內容：
  - 每個 P5 範例表達式（含 `form.x == "a" ? 1 : 2`、字串串接、數字運算）在真引擎的結果。
  - 預算中斷：巢狀迴圈在 100ms 內被中斷，丟 `FORM_DATA_SOURCE_TIMEOUT`，不殘留 vm 狀態。
  - 暖機：第一次求值前已完成引擎載入（P0 的暖機），避免 timeout 時跳過 catch 與 finally（`time-budget.ts`）。
- 測試檔命名與執行方式依 P1 的 lane，不在本設計內另立。

### 7.3 整合（真 DB，`libs/bpm-core` 內的 service 測試）

- submit 預算耗盡：在交易開始前失敗，`workflow_instance` 無新列、狀態不變。
- NOTIFY webhook binding 失敗：案件狀態已更新（不回滾），投遞列為 `FAILED`、錯誤碼 `WEBHOOK_PARAMETER_INVALID`，且寫入終態 activity。
- NOTIFY webhook 的預算與閘道條件預算分開：webhook 耗盡時，同一交易內的閘道條件仍能求值。

### 7.4 實機（wrapper host，`pnpm dev`）

依 gate：以 `demo.cost-centers` 驗證依賴欄位變更與重新送出。步驟見 §8。

---

## 8. demo.cost-centers 實機驗證

前提：`pnpm demo:reset`（CLAUDE.md 規定本機情境測試前使用）；`pnpm dev` 由使用者自行啟動，agent 不得自行啟動 dev server。改完程式後以 `pnpm dev:ctl restart api` 重啟。

資料來源：

- `apps/api/src/app/api-form-data-source.ts:41`：`createCostCenterSeeds('demo.cost-centers', 1)`。
- `apps/api/tools/reset-demo-data.ts`：`demo.cost-centers` 相關表單定義在 :381–463（欄位 `costCenterSelectSingle`、`costCenterSelectMultiple`、`costCenterAutocompleteSingle`、`costCenterRadio` 等），`demo.cost-centers` 的 submit 模板在 :946 附近。
- **未確認項目**：`createCostCenterSeeds` 內 `demo.cost-centers` 的參數清單（參數 key 與型別）未讀取。實作前需先讀該函式，確定可綁定的參數名稱，才能寫出具體的 EXPRESSION。

步驟（設計草案）：

1. 在 wrapper host 的 demo 模板新增一個 EXPRESSION binding 欄位（例如 `costCenterExpressionSingle`），表達式依賴 `costCategory` 之類的既有欄位。新增位置在 `reset-demo-data.ts` 的 seed 內，不改既有欄位。
2. 開啟表單，選定 costCategory 並選出 cost center。
3. 修改 costCategory：預期該欄位變成 `WAITING_FOR_DEPENDENCIES`，選項清空或不可用，不應立即發出 resolve 請求。
4. 選定新的 costCategory：預期 search 回傳新選項，且欄位不再是 STALE。
5. 送出：預期 submit 走 revalidate 路徑，`bindingHash` 與舊快照不同。
6. 只改依賴的 expression 文字但結果不變時：預期 resubmit 不重新驗證（reuse 成立）。
7. 故意讓表達式超出預算（例如用大表格）：預期 UI 顯示 UNAVAILABLE，案件未建立。

**注意**：第 5、6 步需要在 DB 查快照，應只用 local DB，不得連 production（`pgrytass` 規則）。

---

## 9. 決策項

### 9.1 只有產品擁有者能決定

1. **rename 或 delete 被 EXPRESSION 引用的欄位**：預設做法是擋下並提示手動修改；另一個選項是自動改寫表達式文字。自動改寫會改動使用者沒有直接編輯的內容，因此預設擋下。
2. **host function 能否用在 DataSource 與 webhook 的 binding 內**：ADR §3.7 沒有提及。本設計的 v1 只允許 P3 的純內建函式；允許 host function 會擴大授權與提示注入的影響面。
3. **若 P1 停用 `cel-v2`**：P5 整體延後，還是改用受限的 `cel-js` 子集？本設計建議延後。
4. **大表格的預算**：若 §3.5 的量測顯示 50 列以上就會超出 250ms，是否直接限制 EXPRESSION binding 只能用在列數上限以下的表格，還是接受 UNAVAILABLE？
5. **demo 模板**：是否在 `demo.cost-centers` 加一個 EXPRESSION 欄位？會影響其他依賴這個模板的 E2E，屬產品與測試範圍的取捨。

### 9.2 工程決策（已在本設計定案，列出供審查）

- 依賴來源選 (a)：AST helper 放在 `libs/shared`，client 與 server 共用，不持久化 `dependsOn`。理由：發布 lint 與 client 都能即時算出，不需要額外的快照欄位。
- 新 binding 只用 `cel-v2`。
- 缺值不呼叫引擎，直接 WAITING。
- 預算每個操作一份，webhook 與 DataSource 分開。

---

## 10. 與其他 phase 的介面

| 來源 phase | 介面 | P5 用途 |
| --- | --- | --- |
| P0 | `normalizeExpressionOutput(value): boolean \| number \| string \| null` | 求值結果正規化，hash 前必經 |
| P0 | 暖機載入函式（引擎先載入） | 避免 timeout 跳過 catch 與 finally |
| P0 | 錯誤淨化規則 | 錯誤訊息不含 expression 與 form 值 |
| P1 | `cel-v2` 引擎載入與同步求值 | `evaluateExpressionBinding` 內部呼叫 |
| P1 | 真引擎測試 lane | §7.2 |
| P2 | `readExpressionReferences(expression): ExpressionReferences` | 依賴抽取、循環、隱藏依賴、WAITING 判定 |
| P2 | `inferExpressionValueType(expression, schema): ExpressionValueType` | 型別相容性 lint |
| P2 | `FormSchemaTypeEnv` | 由表單 schema 建立的型別環境 |
| P3 | 內建純函式 registry | v1 允許的函式範圍（§9-2） |
| P4 | 表達式編輯器元件（Mezzanine 組合） | Builder 與 NOTIFY 設計器的 EXPRESSION 輸入 |
| P4 | `previewExpression`、`expressionCatalog`（皆 `@BPMDesignerOnly()`） | 設計器提示；P5 不新增 query |

P5 對外不新增 GraphQL query。`previewFormFieldOptions` 與 `previewResolveFormFieldOptions` 已經是 `@BPMDesignerOnly()`（`form-data-source.queries.ts:313–337`），EXPRESSION 的 preview 直接沿用。

---

## 11. 既有資料相容性

- 既有模板與快照：沒有 EXPRESSION 的定義，行為與 hash 完全不變（golden fixture 保證，§7.1）。
- 舊版前端遇到 `kind: 'EXPRESSION'`：未知來源。本設計要求 EXPRESSION 只能出現在草稿，不能發布到仍有舊版前端在用的版本。實作前需確認 `libs/bpm-core-react` 的 `readFormDataSourceBinding` 與 `readCompatibleFormDataSourceBindingFields` 對未知 kind 的處理。
- 發布後的模板：版本內容不可變（既有規則），EXPRESSION 不回寫進已發布版本。
- 資料庫：binding 以 JSON 儲存在定義內，**不需要 migration**。

---

## 12. 文件同步（CLAUDE.md 不變條件）

同一個 commit 必須更新：

- `docs/api-reference.md`：
  - `FormDataSourceBindingSource`（:339）說明加入 EXPRESSION。
  - `FormDataSourceBindingValueKind`（:650）加入 `'EXPRESSION'`。
  - `readMissingFormDataSourceDependencies()`（:632）說明補充 EXPRESSION 的依賴。
  - 新 export：`readBindingHash`（若對外 export）、`evaluateExpressionBinding`（若對外 export）、`createExpressionBudget`。
  - 「Last verified against」版本號依 nx release 規則，不手動改 `package.json` 的 version。
- `docs/22-expression-functions-adr.md` 與 `docs/23-expression-functions-phases.md`：P5 狀態推進時同步。
- ADR 14、18 的部分取代條款：依 docs governance 另行標註。

---

## 13. 實作檔案清單（預計，不是本次改動）

新增：

- `libs/shared/src/lib/expression/expression-references.ts`（P2 交付，P5 只使用）
- `libs/bpm-core/src/lib/form-data-source/form-data-source.expression.ts`
- `libs/bpm-core/src/lib/form-data-source/form-data-source.expression.spec.ts`
- `libs/bpm-core/src/lib/form-data-source/form-data-source.validation.hash.spec.ts`（golden fixture）

修改：

- `libs/shared/src/lib/form.ts`（:98–111、:112）
- `libs/shared/src/lib/workflow.ts`（:422–428）
- `libs/shared/src/lib/workflow-graph.ts`（:1594、:1629、:1673、:1743、:1940–1952）
- `libs/bpm-core/src/lib/form-data-source/form-data-source.validation.ts`（:169–239，新增 `readBindingHash` export）
- `libs/bpm-core/src/lib/form-data-source/form-data-source-value-resolver.service.ts`（:413–431 搬出；:58–175、:276–309 接入）
- `libs/bpm-core/src/lib/form-data-source/form-data-source.service.ts`（:254–311 search 內算 hash；:438–513 不變）
- `libs/bpm-core/src/lib/form-data-source/form-data-source.types.ts`（binding 型別，若需要）
- `libs/bpm-core/src/lib/form-data-source/form-data-source.errors.ts`（:3–26，預設不改）
- `libs/bpm-core/src/lib/form/form-schema.validator.ts`（:651–702、:1105–1118、:1126–1171、:1173–1212、:1214–1227、:1229–1238）
- `libs/bpm-core/src/lib/workflow-webhook/workflow-webhook-enqueue.ts`（:162–204、:206–226）
- `libs/bpm-core/src/lib/workflow-webhook/workflow-webhook.validator.ts`（:152–173，新 case）
- `libs/bpm-core/src/lib/workflow-webhook/workflow-webhook-delivery.enums.ts`（預設不改）
- `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`（:756–762、:915–944、:946–1006 的 snapshot 呼叫需確認，預設不改；NOTIFY 分支 :8099–8115 不變）
- `libs/bpm-core-client/src/lib/form/form-data-source-builder.ts`（:122–150、:176–209、:211–217）
- `libs/bpm-core-client/src/lib/form/form-data-source-errors.ts`（預設不改）
- `libs/bpm-core-client/src/lib/form/workflow-lint-errors.ts`（新 issue code 的訊息）
- `libs/bpm-core-react/src/views/forms/renderer/form-data-source-field.ts`（:175–196、:226–253、:276–283）
- `libs/bpm-core-react/src/views/forms/builder/FormBuilderView.tsx`（EXPRESSION 綁定 UI）
- `libs/bpm-core-react/src/views/templates/designer/NotifyWebhookTargetsEditor.tsx`（EXPRESSION 來源）
- `libs/bpm-core-react/src/views/templates/designer/notify-webhook-designer.ts`（序列化與驗證）
- `apps/api/tools/reset-demo-data.ts`（§8 demo 欄位，需先確認參數清單）
- `docs/api-reference.md`（§12）

---

## 14. 未讀取、實作前必須查證的項目

- `createCostCenterSeeds` 的參數清單（§8）。
- `workflow-graph.ts` 內欄位 rename 的入口是否涵蓋 NOTIFY（§6.4）。
- `libs/bpm-core-react` 對未知 binding kind 的處理（§11）。
- `workflow-webhook.validator.ts` 的其餘分支（:1–140）與 `workflow-webhook-enqueue.ts` 的 buildWorkflowWebhookDeliveryDrafts（:60–160）的失敗路徑，確認 EXPRESSION 的 try/catch 放的位置正確。
- `form-data-source-state.ts` 與 `form-data-source-api.ts`（未在 `libs/bpm-core-react/src/views/forms/renderer/` 找到，位置待確認）。
