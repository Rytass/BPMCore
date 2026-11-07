# 流程表達式 P0 + P1 細部設計：Runtime、預算、錯誤淨化與方言引擎

- **狀態**：DESIGN（2026-11-07 完成設計，尚未實作）
- **範圍**：[phases P0](../../../../../Repositories/BPMCore/docs/23-expression-functions-phases.md) 安全修補；P1 方言欄位與候選引擎 `cel-v2` 差異測試
- **權威依據**：[ADR 22](../../../../../Repositories/BPMCore/docs/22-expression-functions-adr.md) §3.2（Runtime 單一入口、預算、輸出 walker、錯誤碼）、§3.3（方言欄位）、§3.4（AST lint，僅 P2）
- **證據**：差異測試 `engine-spike/out/engine-diff.txt`（136 筆；SAME 87、DIFF 49）、`engine-spike/scripts/probe-*.mjs`、`jest-probe/`。以上皆在 repo 外的 `` 下。
- **本文件未修改任何 repo 檔案**，也未 commit、未啟動 dev server、未連線 production DB。

標記說明：**[已驗證]** 有 spike 或 probe 證據；**[設計]** 本文提出的決定，尚未實作；**[未驗證]** 尚無證據，列為 P0/P1 開工前要補的項目。

---

## 0. 結論摘要

1. **Runtime 切分**：不新增 Nest module。在既有 `ConditionModule` 內新增 `ExpressionRuntime` provider，`ConditionService` 保留全部既有公開方法並改為委派。理由是 `ConditionService` 已由 `libs/bpm-core/src/index.ts` 匯出並列於 `docs/api-reference.md`，改動公開面會破壞宿主。
2. **預算**：每次表達式評估以 `vm.Script` 的 `timeout` 為單次上限（100 ms）；每個「操作範圍」共用一個累計帳本（250 ms）。內層逾時已在 spike 驗證只中斷內層，外層 `runWithinTimeBudget` 的 2000 ms 上限與其穿透行為需 P0 測試覆蓋 [未驗證]。
3. **錯誤淨化**：對外只回 `EXPRESSION_*` 錯誤碼與 label。引擎原始訊息只在記憶體中依樣式比對；比對不到就不抽任何內容。已驗證 legacy 的 `MISSING_KEY` 訊息會整包輸出 context JSON（見 §6.2）。
4. **方言**：所有評估點（共 13 個呼叫點，見 §7）都必須帶入 `ExpressionDialect`，來源是該評估所屬的定義快照或規則，不是「目前」的草稿。
5. **引擎差異**：136 筆差異中，多數是加法（legacy 報錯、v8 支援新函式）或型別表示差異（bigint 對 number）。真正需要決定的有三類：`||`/`&&` 錯誤吸收、`has()` 遇缺失父層時改為報錯、跨型別數字比較（`1 == 1.0`、`2.0 in [1, 2]`）在未註冊 overload 時報錯。
6. **P1 gate 建議**：**有條件採用 `cel-v2`**，僅作為新的 opt-in 方言，既有定義與規則維持 `cel-legacy`。條件見 §17。若產品擁有者不接受 `||`/`&&` 吸收，則依 phases 的決策點停用 `cel-v2`。

---

## 1. 現況盤點（repo 事實）

### 1.1 `ConditionService` 現況 [已驗證，讀過原始碼]

- `libs/bpm-core/src/lib/condition/condition.service.ts`：`loadCelEngine` 以 `require('cel-js')` 延遲載入；`lintExpression` / `lintExpressions` 會解析一次；`evaluateBoolean` / `evaluateValue` 內部再解析一次（`evaluateValue` 的 lint 與評估是兩次 parse）。
- 評估行為：`return engine.evaluate(parseResult.cst, { ...context });` 包在 `try` 內，`catch` 以 `new BadRequestException(error instanceof Error ? \`${label}: ${error.message}\` : label)` 重拋。**這是目前把引擎原始訊息直接送出的點，P0 必須修。**
- `lintRootIdentifiers` 以 `CEL_KEYWORDS` 與 root 白名單檢查識別字。

### 1.2 `runWithinTimeBudget` 現況 [已驗證，讀過原始碼]

- `libs/bpm-core/src/lib/workflow-engine/time-budget.ts`：`RUN.runInContext(createContext({ run: work }), { timeout })`，把 `ERR_SCRIPT_EXECUTION_TIMEOUT` 轉為 `TimeBudgetExceededError`。
- 檔案註解已警告：中斷會略過 `catch` 與 `finally`。因此 P0 的回滾測試必須確認 `TimeBudgetExceededError` 從交易 callback 穿出時，TypeORM 會回滾（這件事由 `manager.transaction` 的 reject 路徑保證，仍需測試）。

### 1.3 呼叫點盤點 [已驗證，以 grep 行號為準]

| 位置 | 所在方法 | 用途 | 方言來源（設計） |
| --- | --- | --- | --- |
| workflow-engine.service.ts:773 | `submitApprovalInstance` | 案件送出評估 | 案件實例快照的定義版本 |
| :3206 | `dryRunApprovalWorkflow` | 引擎預熱 `evaluateBoolean('true')` | 草稿所屬定義 |
| :3224 | `dryRunApprovalWorkflow` catch | 目前直接傳 `error.message` | 改為只傳 code |
| :3302 | `simulateWorkflowPath` | 模擬路徑 | 草稿 |
| :3448 | `evaluateDryRunEdge` | 模擬邊 | 草稿 |
| :3598 | `readDryRunMemberIds` | 模擬簽核人解析 | 草稿 |
| :3944 | `listLaunchableApprovalTemplates` | 可發起範本過濾 | 已發布版本 |
| :4655 | `isNodeEntryConditionMet` | 節點進入條件 | 實例快照 |
| :4792 | `evaluateWorkflowEdge` | 邊條件 | 實例快照 |
| :4809 | `readLastDecisionContext` | 提供 `lastDecision` root（非評估點，為 context 來源） | 不適用 |
| :6818 | `resolveApproverMemberIds` | 簽核人表達式 | 實例快照 |
| :7947, :7988 | `executeServiceTask` | 服務節點條件與派送前評估 | 實例快照 |
| :8865, :8877 | `buildInitiatorPolicyContext` / `buildWorkflowExpressionContext` | context 組裝（root 來源） | 不適用 |
| :8932 | `buildDryRunExpressionContext` | 模擬用 context（含 `lastDecision`） | 不適用 |
| delegation.service.ts:491 | `matchesRuleScope` | 委派規則範圍 | 規則的 `expressionDialect` |
| delegation.service.ts:595 | create / normalize lint | 規則建立與正規化 | 請求值，預設 `cel-legacy` |
| template.service.ts:974–989 | publish lint | 發布前檢查（含 `lastDecision` 增補的邊 root） | 範本 `expressionDialect` |

**注意**：上表是 grep 結果。P0 開工前須再次執行 `grep -rn "evaluateBoolean\|evaluateValue\|lintExpression" libs apps` 完整確認，確保沒有遺漏。

### 1.4 種子資料的表達式 [已驗證]

- `apps/api/tools/reset-demo-data.ts` 內 CEL 字串只有一個：委派規則 `'form.systemName == "cloud-console"'`（約 L3237，`delegationRow` helper 約 L3766）。
- 工作流定義（約 L980–1240）沒有條件式。
- 因此種子本身不足以代表真實負載，見 §9。

### 1.5 前端產生的表達式樣式 [已驗證，讀過原始碼]

- `libs/bpm-core-client/src/lib/form/form-rendering.ts` L474–480：`form.${fieldKey} ${op} ${literal}`；字串 literal 以 `JSON.stringify`。
- `libs/shared/src/lib/workflow-graph.ts` `readFormFieldReference`（約 L2462）：`form.<key>` 或 `form[JSON.stringify(key)]`；多選為 `${ref} != null && "v" in ${ref}`；表格 IS_FILLED 為 `size(ref) > 0`；IS_EMPTY 為 `== null || ...`。
- 這些樣式都已在差異語料中覆蓋（見 §16 的 A、D、F 組）。

---

## 2. 決策：Runtime 切分與 `ConditionService` 的關係

**採用方案 A：同一 module 內的內部 provider。**

```
ConditionModule
 ├─ ConditionService      公開，既有方法不變；委派給 ExpressionRuntime
 └─ ExpressionRuntime     內部；選擇方言 adapter、套用預算、正規化輸出、淨化錯誤
      ├─ CelLegacyAdapter   包 cel-js 0.8.2
      └─ CelV2Adapter       包 @marcbachmann/cel-js 8.x（延遲載入）
```

- `ConditionService` 的每個既有方法新增可選的最後一個參數 `options?: ExpressionCallOptions`（`dialect`、`scope`）；未傳時為 `cel-legacy` 且無累計帳本，行為與現況相同（P0 之外的既有行為不變）。
- 不採用方案 B（新 `ExpressionModule`）。理由：會強迫所有 `ConditionModule` 消費者改 import，且 `docs/api-reference.md` 必須同步大量變動；P1 沒有必要。
- Repo 內 workflow engine 不直接 import adapter，只透過 `ConditionService`，方便 P0 單獨替換錯誤處理。

---

## 3. 型別與函式簽名

檔案都位於 `libs/bpm-core/src/lib/condition/`（新增）。

```ts
// expression-dialect.ts
export const EXPRESSION_DIALECTS = ['cel-legacy', 'cel-v2'] as const;
export type ExpressionDialect = (typeof EXPRESSION_DIALECTS)[number];
export const DEFAULT_EXPRESSION_DIALECT: ExpressionDialect = 'cel-legacy';
export const isExpressionDialect = (value: unknown): value is ExpressionDialect =>
  typeof value === 'string' && (EXPRESSION_DIALECTS as readonly string[]).includes(value);
```

```ts
// expression-errors.ts
export const EXPRESSION_ERROR_CODES = [
  'EXPRESSION_SYNTAX_ERROR',
  'EXPRESSION_MISSING_KEY',
  'EXPRESSION_TYPE_ERROR',
  'EXPRESSION_BUDGET_EXCEEDED',
  'EXPRESSION_INVALID_RESULT',
  'EXPRESSION_FUNCTION_FAILED',
] as const;
export type ExpressionErrorCode = (typeof EXPRESSION_ERROR_CODES)[number];

// 繼承 BadRequestException，維持既有 HTTP 400 語意。
// message 只有 `${label}: ${code}`，不含任何引擎訊息或 context 值。
export class ExpressionRuntimeError extends BadRequestException {
  constructor(
    readonly code: ExpressionErrorCode,
    readonly label: string,
  ) {
    super(`${label}: ${code}`);
  }
}
```

```ts
// expression-budget.ts
export interface ExpressionBudgetOptions {
  readonly perExpressionMs: number;   // 預設 100
  readonly cumulativeMs: number;      // 預設 250
}

export interface ExpressionBudget {
  /** 下一次評估可用的 timeout（取 min(perExpressionMs, 剩餘)）；剩餘 <= 0 時拋 EXPRESSION_BUDGET_EXCEEDED */
  nextTimeoutMs(): number;
  /** 記錄實際耗時（以 performance.now() 量測） */
  record(elapsedMs: number): void;
  readonly remainingMs: number;
}

export const createExpressionBudget: (options: ExpressionBudgetOptions) => ExpressionBudget;
```

```ts
// expression-runtime.ts
export type ExpressionMode = 'boolean' | 'value';

export interface ExpressionEvalRequest {
  readonly expression: string;
  readonly label: string;                 // 例：「流程條件」「委派範圍」；不得含 context 值
  readonly dialect: ExpressionDialect;
  readonly mode: ExpressionMode;
  readonly roots: Readonly<Record<string, unknown>>;   // 只放白名單 root
  readonly budget: ExpressionBudget;      // 呼叫端決定範圍（見 §4.2）
}

export interface ExpressionEngineAdapter {
  readonly dialect: ExpressionDialect;
  /** 解析一次；回傳可重複評估的 handle。P2 的 AST 檢查由 handle 取得。 */
  compile(expression: string): ExpressionHandle;   // 失敗拋 ExpressionRuntimeError(SYNTAX)
  /** 同步評估；timeoutMs 由 runWithinTimeBudget 強制 */
  evaluate(handle: ExpressionHandle, roots: Readonly<Record<string, unknown>>, timeoutMs: number): unknown;
}

export interface ExpressionHandle {
  readonly dialect: ExpressionDialect;
  readonly source: string;
  readonly native: unknown;   // adapter 內部物件，外部不得依賴
}

export class ExpressionRuntime {
  evaluate(request: ExpressionEvalRequest): JsonValue;   // mode=boolean 時保證回傳 boolean
  compile(expression: string, dialect: ExpressionDialect): ExpressionHandle;
}
```

```ts
// expression-result.walker.ts
export type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ExpressionResultLimits {
  readonly maxDepth: number;      // 32
  readonly maxNodes: number;      // 10_000
  readonly maxBytes: number;      // 64 * 1024，序列化後
}

/** 回傳全新、已凍結的 JSON 值；違規拋 EXPRESSION_INVALID_RESULT */
export const normalizeExpressionResult: (
  raw: unknown,
  label: string,
  limits?: ExpressionResultLimits,
) => JsonValue;
```

```ts
// condition.service.ts（公開面，新增可選參數）
export interface ExpressionCallOptions {
  readonly dialect?: ExpressionDialect;   // 預設 cel-legacy
  readonly budget?: ExpressionBudget;     // 預設：單次 100 ms、無累計
}

// 既有方法保留名稱與參數順序，只在最後追加 options
evaluateBoolean(expression: string, context: Record<string, unknown>, label: string, options?: ExpressionCallOptions): boolean;
evaluateValue(expression: string, context: Record<string, unknown>, label: string, options?: ExpressionCallOptions): JsonValue;
lintExpression(expression: string, options?: { dialect?: ExpressionDialect }): void;
lintExpressions(expressions: readonly string[], options?: { dialect?: ExpressionDialect }): void;
```

---

## 4. 預算：套用、巢狀與累計

### 4.1 單次預算 [已驗證 timeout 機制；預算值待量測]

- 每次 `adapter.evaluate` 透過 `runWithinTimeBudget(() => adapter.evaluate(...), budget.nextTimeoutMs())` 執行。
- 單次 100 ms 來自 ADR §3.2；§9 的量測決定是否保留。
- 逾時拋 `TimeBudgetExceededError`，`ExpressionRuntime` 轉為 `EXPRESSION_BUDGET_EXCEEDED`。

### 4.2 累計預算的範圍 [設計]

「單次操作」以**進入點**劃分，每個進入點建立一個 `ExpressionBudget`，並把它傳入之後所有評估：

| 進入點 | 累計帳本建立處 | 說明 |
| --- | --- | --- |
| `submitApprovalInstance` | 方法開頭，交易外 | 交易內所有 `evaluateWorkflowEdge` 共用；交易重試時重新建立 |
| `dryRunApprovalWorkflow` | 方法開頭 | 與外層 `DRY_RUN_TIME_BUDGET_MS = 2000` 並存（見 §4.3） |
| `listLaunchableApprovalTemplates` | 每個範本一個 | 避免一個壞範本拖垮整張清單 |
| `executeServiceTask` | 每次派送一個 | |
| delegation `matchesRuleScope` | 每次案件路由評估一個 | 同一案件所有規則共用，超過即視為不符合並記錄（不寫入訊息） |
| publish lint / create lint | 每次請求一個 | 只做靜態檢查，僅需單次上限 |

### 4.3 巢狀關係 [部分已驗證]

- 外層：dry run 的整次模擬 `runWithinTimeBudget(..., 2000)`。
- 內層：每個表達式的 `runWithinTimeBudget(..., min(100, remaining))`。
- **已驗證**：內層 vm `timeout` 能中斷內層表達式，中斷後外層 context 仍可繼續執行（`probe-budget2.mjs`，需要用語法 cel-js 可解析的 `range_list.map` 形式，`[..].map(...)` 會變成 parse 錯誤而非中斷）。
- **未驗證**：外層 2000 ms 在內層執行期間觸發時，`TimeBudgetExceededError` 是否穿透內層的 catch 而正確到達外層。這是 P0 測試 `dry-run-outer-budget.spec.ts` 必須覆蓋的項目。
- 設計規則：`ExpressionRuntime` 的 catch 只能轉換 `TimeBudgetExceededError` 與引擎錯誤；**不得**吞掉未知錯誤後回 `false`，以免外層預算的中斷被當成條件不符。

### 4.4 量測開銷 [已驗證]

- 每次 `vm.createContext` 約 182 us；重用 sandbox 約 36 us。
- 設計：`ExpressionRuntime` 持有單一重用 sandbox 的 `vm.Script` 與 context，每次評估只注入 `roots`。注意 sandbox 重用時 `roots` 必須是凍結副本，避免上一次評估的 mutation 殘留。
- ADR 寫的 68 us 與實測不符，見 §18。

---

## 5. 輸出正規化 walker [設計，部分已驗證]

`normalizeExpressionResult` 依序處理：

1. `bigint`：若在 `Number.MAX_SAFE_INTEGER` 範圍內轉為 `number`；超出則 `EXPRESSION_INVALID_RESULT`。已驗證 v8 整數回傳 bigint（C01–C03、A39、H01、G04、G06）。
2. `number`：必須 `Number.isFinite`；`Infinity` 與 `NaN` 拒絕。已驗證 v8 在註冊 double overload 後 `1.0 / 0` 會得到 `Infinity`（見 §16 B19）。
3. `string`、`boolean`、`null`：直接保留。
4. 陣列：只接受 `Array.isArray` 且不是 typed array；逐元素遞迴。
5. 物件：只接受 `Object.getPrototypeOf(v) === Object.prototype` 或 `null`；鍵名拒絕 `__proto__`、`constructor`、`prototype`。已驗證 legacy 會回傳 `form.constructor` 為 function（C06），v8 會回 MISSING_KEY。
6. 其他（function、symbol、undefined、thenable、class instance）：`EXPRESSION_INVALID_RESULT`。
7. 深度、節點數、序列化後位元組數超過 `ExpressionResultLimits` 即拒絕。
8. 輸出為新物件並 `Object.freeze` 遞迴凍結。

`mode === 'boolean'` 時 walker 之後再檢查 `typeof === 'boolean'`，否則 `EXPRESSION_TYPE_ERROR`（對應 legacy 的非布林結果，例如 H01 的 `true ? 1 : 2`）。

---

## 6. 錯誤淨化與代碼對應

### 6.1 原則

- 對外（HTTP、GraphQL、活動紀錄、通知、log）只出現 `EXPRESSION_*` 代碼與 `label`。
- 引擎訊息只在 `ExpressionRuntime` 內以樣式比對，比對到的類別映射成代碼；比對不到就丟棄，代碼為 `EXPRESSION_TYPE_ERROR`，**不抽取訊息中的任何片段**。
- Log 只記代碼、label、dialect、耗時，不記 expression 原文以外的任何 context 值。

### 6.2 已驗證的洩漏形態

- legacy：`Identifier "missing" not found in context: {"env":...,"form":{"amount":1500000,...}}`（D01、A29）。整包 context JSON 會進入錯誤訊息，這是 P0 的主要修補點。
- legacy：`Identifier "secret" not found in context: ...`（C13）同樣洩漏完整 context。
- v8：`No such key: <key>`、`index out of bounds, index 5 >= size 2`（A29、A34）。仍含有 key 名稱；設計上 key 名稱不視為值，但**不回傳給 API**，只保留於開發環境 log 的 debug 等級，且 P0 測試要驗證 API 回應不含 key 名稱。

### 6.3 映射表 [設計；樣式依據為 engine-diff.txt 原始訊息]

| 類別 | legacy 樣式 | cel-v2 樣式 | 代碼 |
| --- | --- | --- | --- |
| 語法錯誤 | `ERR[PARSE]`、`invalid_argument` | parse 錯誤、`ParseError` | `EXPRESSION_SYNTAX_ERROR` |
| 缺值 | `Identifier "..." not found`、`Cannot obtain` 於 null | `No such key`、`index out of bounds` | `EXPRESSION_MISSING_KEY` |
| 型別與 overload | `CelTypeError`、`Unknown method`、`Division by zero` | `no such overload`、`found no matching overload`、`NOT_BOOL` | `EXPRESSION_TYPE_ERROR` |
| 預算 | `TimeBudgetExceededError` | 同左 | `EXPRESSION_BUDGET_EXCEEDED` |
| 結果不合法 | walker 拋出 | 同左 | `EXPRESSION_INVALID_RESULT` |
| 宿主函式失敗 | P3 才有 | 同左 | `EXPRESSION_FUNCTION_FAILED` |
| 其他 | 不抽取訊息 | 不抽取訊息 | `EXPRESSION_TYPE_ERROR` |

備註：

- `Division by zero` 歸為 `EXPRESSION_TYPE_ERROR`，因為它是求值錯誤而非結果錯誤。這是設計選擇，產品擁有者可改（見 §20）。
- 「缺值」與「類型」的判定是字串樣式，必須以測試固定（§12 的 `expression-errors.spec.ts` 以 engine-diff 的原始樣本為 fixture）。
- spike 的 `classify()` 誤判過（例如 `invalid_argument: null` 被標成 PARSE），所以 P0 的映射不能沿用 spike 的 classify，須以 fixture 重寫。

### 6.4 HTTP 與 dry run 回應

- `dryRunApprovalWorkflow` L3224 的 catch 目前傳 `error.message`；改為只傳 `error.code`（`ExpressionRuntimeError`）或既有 `TimeBudgetExceededError` 的固定文字。
- `valid: false` 的語意不變（ADR §3.8），`@BPMAuthenticated` 不變。

---

## 7. 方言傳遞

### 7.1 規則

- 方言是**評估所屬定義或規則的屬性**，不是全域設定。
- 案件執行時方言來自實例建立時的定義快照；草稿與模擬用草稿的方言；範本發布時寫入版本快照。
- 任何未帶方言的呼叫一律視為 `cel-legacy`，這是 P1 gate「進行中案件在方言缺少時路由結果與升級前相同」的實作基礎。

### 7.2 傳遞路徑

- `ConditionService` 的所有公開方法都接受 `options.dialect`。
- `workflow-engine.service.ts` 內，`isNodeEntryConditionMet`、`evaluateWorkflowEdge`、`resolveApproverMemberIds`、`executeServiceTask` 都改為從 `ExpressionScope` 取得 dialect，而不是各自讀定義：

```ts
export interface ExpressionScope {
  readonly dialect: ExpressionDialect;
  readonly budget: ExpressionBudget;
}
```

- `ExpressionScope` 由進入點建立（§4.2），沿參數向下傳遞。**不使用** `AsyncLocalStorage`：這個 runtime 是同步評估，顯式參數較容易測，也避免 vm context 與非同步上下文的互動風險 [設計]。
- 代價：`evaluateWorkflowEdge` 等私有方法簽名會增加一個參數；這是 P1 的主要 diff 量。

### 7.3 讀取順序

1. 進入點讀取定義快照（`submit`）或草稿（`dryRun`）或已發布版本（`listLaunchable`）。
2. 由快照讀出 `expressionDialect`，缺值補 `cel-legacy`。
3. 建立 `ExpressionScope` 傳入。

---

## 8. 委派規則的方言欄位與 migration

### 8.1 Schema [設計]

- 在委派規則的實體（實體檔名待 P1 開工時確認 [未驗證]）新增欄位：`expression_dialect varchar(16) NOT NULL DEFAULT 'cel-legacy'`，加 CHECK 限制為 `EXPRESSION_DIALECTS`。
- 在 `WorkflowDefinition` 的版本快照同樣新增 `expression_dialect`，預設 `cel-legacy`。
- 共享型別 `libs/shared` 的對應型別新增可選欄位 `expressionDialect?: ExpressionDialect`，缺值視為 `cel-legacy`。

### 8.2 Migration [設計]

- `up`：加欄位，`DEFAULT 'cel-legacy'`，回填既有列（DEFAULT 已涵蓋，但仍顯式 `UPDATE ... WHERE expression_dialect IS NULL` 以防萬一）。
- `down`：`DROP COLUMN`。可回復，因為 `cel-v2` 在 down 前若有資料，需先由 `UPDATE ... SET expression_dialect = 'cel-legacy' WHERE expression_dialect = 'cel-v2'`，並在 migration 內拒絕有 `cel-v2` 列時的回復，改為要求先手動切回（防止靜默降級）。
- 不自動把既有列升級為 `cel-v2`。升級是有意的、由設計者透過 P4 的「模板方言升級流程」執行。

### 8.3 規則方言變更的流程 [設計]

- 建立新規則：請求可指定方言，預設 `cel-legacy`；建立時以該方言 lint。
- 既有規則變更方言：必須重新 lint 規則的所有表達式，且只能由 P4 的升級流程發起；本階段只提供 service 方法 `upgradeRuleDialect(id, target)`，不暴露到 GraphQL。
- 既有已發布版本的定義**不因為**設計者後來改了規則方言而被重新 lint（phases P2 的「既有已發布版本不被重新 lint」）。

---

## 9. 種子耗時量測方法

### 9.1 為什麼種子不夠 [已驗證]

種子只有一個 CEL 字串（§1.4）。用它量測的結果代表性極低，無法定案 100 ms。

### 9.2 方法 [設計]

1. 在 `ExpressionRuntime.evaluate` 加入 `performance.now()` 量測，只在 `NODE_ENV !== 'production'` 或設定 `BPM_EXPRESSION_TIMING=1` 時輸出聚合統計（不記錄 context，不記錄 expression 原文，只記 label 與 dialect）。
2. 量測語料分三組：
   - (a) 差異語料的全部 136 筆（engine-diff 的 corpus）。
   - (b) 前端產生的樣式（§1.5 的 `form.x op literal`、多選、表格 IS_FILLED），每種至少 100 個隨機欄位組合。
   - (c) `pnpm e2e:client` 的流程路徑中實際出現的表達式（由 `ExpressionRuntime` 收集，去重後保存為 fixture）。
3. 每組報告 p50、p99、max，分 warm（先呼叫一次 `evaluateBoolean('true')` 之後）與 cold。
4. 決策規則：單次預算 = max(100 ms, 3 × 組 (b)+(c) 的 p99)。若 p99 超過 30 ms，表示表達式本身有問題，應先查樣式而非拉高預算。
5. 量測在 `pnpm dev` 下進行，使用本機 develop DB（不連 production）。執行前依 CLAUDE.md 的 Dev Server 規定確認已由使用者啟動。

### 9.3 尚未量測 [未驗證]

ADR 的 5478 ms / 407 ms 與 spike 的 18313 ms / 2715 ms 不一致（§18）。本機數字未定案，須以 §9.2 的方法重新量。

---

## 10. 檔案清單

### 10.1 新增

| 路徑 | 內容 |
| --- | --- |
| `libs/bpm-core/src/lib/condition/expression-dialect.ts` | 方言型別與常數 |
| `libs/bpm-core/src/lib/condition/expression-errors.ts` | 錯誤碼與 `ExpressionRuntimeError` |
| `libs/bpm-core/src/lib/condition/expression-budget.ts` | 單次與累計預算 |
| `libs/bpm-core/src/lib/condition/expression-result.walker.ts` | 輸出正規化 |
| `libs/bpm-core/src/lib/condition/expression-runtime.ts` | runtime 與 adapter 介面 |
| `libs/bpm-core/src/lib/condition/adapters/cel-legacy.adapter.ts` | 包 cel-js 0.8.2 |
| `libs/bpm-core/src/lib/condition/adapters/cel-v2.adapter.ts` | 包 `@marcbachmann/cel-js`，延遲載入（P1） |
| `libs/bpm-core/src/lib/condition/testing/differential-corpus.ts` | 差異語料（可被 P2、P3 共用） |
| `libs/bpm-core/src/lib/condition/expression-errors.spec.ts` | 映射表 fixture 測試 |
| `libs/bpm-core/src/lib/condition/expression-result.walker.spec.ts` | walker 單元測試 |
| `libs/bpm-core/src/lib/condition/expression-budget.spec.ts` | 預算單元測試 |
| `libs/bpm-core/src/lib/condition/cel-differential.real-engine.spec.ts` | 真引擎差異測試（§13） |
| `libs/bpm-core/src/lib/workflow-engine/expression-rollback.spec.ts` | 巢狀 map 中斷與交易回滾（P0 gate） |
| `libs/bpm-core/src/lib/workflow-engine/dry-run-outer-budget.spec.ts` | 外層 2000 ms 穿透測試（P0） |
| `libs/bpm-core/src/lib/database/migrations/<timestamp>-expression-dialect.ts` | 方言欄位（P1，目錄與檔名慣例待確認 [未驗證]） |
| `libs/bpm-core/jest.real-engine.config.cts` | 真引擎 jest project（§13） |

### 10.2 修改

| 路徑 | 修改 |
| --- | --- |
| `libs/bpm-core/src/lib/condition/condition.service.ts` | 委派給 runtime；新增 `options`；移除 raw message 拋出 |
| `libs/bpm-core/src/lib/condition/condition.module.ts` | 註冊 `ExpressionRuntime` 與 adapter |
| `libs/bpm-core/src/lib/condition/index.ts` | 匯出新型別（`ExpressionDialect`、`ExpressionErrorCode`、`ExpressionCallOptions`） |
| `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts` | 進入點建立 `ExpressionScope`；dry run catch 改傳 code；私有評估方法加 scope 參數 |
| `libs/bpm-core/src/lib/delegation/delegation.service.ts` | `matchesRuleScope` 使用規則方言；create/normalize lint 傳方言；`readCurrentRules` 已有 manager 參數，確認其被傳入 |
| `libs/bpm-core/src/lib/template/template.service.ts` | publish lint 使用範本方言 |
| `libs/shared/src/lib/...`（定義型別的檔案，P1 開工時確認） | `expressionDialect?` |
| `libs/bpm-core/package.json` | 新增依賴 `@marcbachmann/cel-js`（§14） |
| `package.json`（root） | 同上，與 `cel-js` 並存 |
| `libs/bpm-core/jest.config.cts` | 保留既有 `^cel-js$` 映射，預設 project 不變 |
| `docs/05-conditions-cel.md` | P0：修正 `contains` 範例、補現況限制 |
| `docs/api-reference.md` | 同步所有 export 變動，更新「Last verified against」 |
| `docs/23-expression-functions-phases.md` | 狀態推進 |

### 10.3 不修改

- `apps/api/tools/reset-demo-data.ts`：P1 維持 `cel-legacy`，不改種子。
- `libs/bpm-core-client`、`libs/bpm-core-react`：P1 不改，方言 UI 屬 P4。

---

## 11. 資料流

```
進入點（submit / dryRun / listLaunchable / serviceTask / delegation / lint）
  │  1. 讀定義快照或規則 → dialect
  │  2. createExpressionBudget({100, 250}) → ExpressionScope
  ▼
ConditionService.evaluateBoolean(expr, roots, label, { dialect, budget })
  │  3. ExpressionRuntime.compile(expr, dialect)     ← 只解析一次
  │  4. budget.nextTimeoutMs()                        ← 剩餘 <= 0 → BUDGET_EXCEEDED
  │  5. runWithinTimeBudget(() => adapter.evaluate(handle, roots, t), t)
  │  6. normalizeExpressionResult(raw, label)         ← 拒絕非 JSON
  │  7. 型別檢查（boolean 模式）
  │  8. 例外 → 映射為 ExpressionRuntimeError（只保留 code 與 label）
  ▼
呼叫端：交易 callback 中拋出 → manager.transaction 回滾；活動紀錄只寫 code
```

錯誤路徑：任何步驟失敗都不寫入案件狀態、活動紀錄、通知內文或 log 的 context 值。

---

## 12. 測試清單

### 12.1 單元測試（沿用 jest 預設 project，cel-js 為 shim）

- `expression-errors.spec.ts`：以 engine-diff 原始樣本為 fixture，驗證每種樣式映射到正確代碼；未知訊息映射到 `EXPRESSION_TYPE_ERROR` 且輸出不含原訊息任何片段。
- `expression-result.walker.spec.ts`：bigint 正規化、NaN、Infinity、`__proto__` 鍵、深度 33、節點超限、64 KiB 超限、thenable、function、class instance、凍結後 mutation 拋錯。
- `expression-budget.spec.ts`：單次 min、累計耗盡後拒絕、記錄負值拒絕。
- `ConditionService` 既有測試維持通過（`cel-js-lazy-load.spec.ts` 的 `jest.mock('cel-js')` 計數測試不得退化）。

### 12.2 P0 gate 測試（workflow-engine）

- `missing key does not leak`：`form.missing` 的 API 回應與 log 不含 `form` 內任何值（以 seed 的實際 formData 值作為斷言字串）。
- `nested map interrupted`：`form.items.map(a, form.items.map(b, form.items.map(c, ...)))` 在預算內中斷，回傳 `EXPRESSION_BUDGET_EXCEEDED`，交易回滾，案件狀態不變。注意：此表達式需以 cel-js 可解析的 `range_list.map` 形式書寫。
- `constructor rejected`：`form.constructor`、`form.__proto__`、`form.toString` 回傳 `EXPRESSION_MISSING_KEY` 或 `EXPRESSION_INVALID_RESULT`，不回傳 function。
- `dry run outer budget`：外層 2000 ms 觸發時，回傳 `valid: false`，權限與 schema 不變。
- `webhook after commit`：既有 commit 後派送行為（已完成）的回歸測試。

### 12.3 P1 真引擎測試（`*.real-engine.spec.ts`，獨立 jest project，§13）

- 差異語料：每一筆都有期望分類（SAME／TYPE_ONLY／ADDITIVE／DECIDED／REJECT）。CI 失敗條件：任何未分類的 DIFF、或 `REJECT` 類樣式在 cel-v2 下通過。
- 混合數字 overload：`form.price * 2`、`2 + form.price`、`form.amount / 2` 等在 cel-v2 下與 legacy 結果一致。
- 跨型別比較：`1 == 1.0`、`2.0 in [1, 2]` 在註冊 overload 後與 legacy 一致。（需驗證註冊是否可行 [未驗證]）
- 「進行中案件方言缺少」：沒有方言欄位的快照，路由結果與 cel-legacy 完全相同。
- 方言 migration：up 後既有列為 `cel-legacy`；down 在存在 `cel-v2` 列時拒絕。

### 12.4 Live 驗證（`pnpm dev`，依 CLAUDE.md 由使用者啟動）

- 以實際 API 送出含缺值的案件，確認 HTTP 回應只有代碼與 label。
- 以實際 API 送出超長巢狀 map，確認回應在預算內，案件未前進。
- 以 dry run 送出相同表達式，確認 `valid: false`。
- 不啟動 dev server，不連 production DB。

---

## 13. Jest 策略（真引擎）

### 13.1 現況 [已驗證]

- `libs/bpm-core/jest.config.cts` 以 `moduleNameMapper` 把 `^cel-js$` 映到 `testing/cel-js.jest.ts`（JS eval shim）。預設 project 的所有測試拿到的是 shim，不是真引擎。
- `cel-js-list-behaviour.spec.ts` 用 `execFileSync` 啟動子程序跑真 cel-js，是既有先例。
- `.env.test` 設定 `NODE_OPTIONS=--experimental-vm-modules`，Nest 12 與 `@marcbachmann/cel-js` 都是 ESM。
- spike 驗證：在 `--experimental-vm-modules` 下，jest 可以 `require` 兩個 ESM 套件（`jest-probe/a.probe.spec.cjs`）。

### 13.2 設計 [設計]

- 新增獨立 jest project `real-engine`，設定檔 `libs/bpm-core/jest.real-engine.config.cts`，**不含** `^cel-js$` 映射，測試檔 pattern 為 `*.real-engine.spec.ts`。
- 預設 project 排除 `*.real-engine.spec.ts`，避免 shim 與真引擎混在同一 registry。
- 新增 nx target `test-real-engine`，`pnpm test` 也執行它；CI 必須跑。
- 不採用純子程序方案作為主要方式：子程序慢且難以共用 corpus。子程序只保留給需要隔離全域狀態的少數案例。
- 差異語料放在 `testing/differential-corpus.ts`，兩個 project 共用同一份資料，確保預設 project 的 shim 測試與真引擎測試期望一致。

### 13.3 風險 [未驗證]

- 真引擎 project 的 `transformIgnorePatterns` 需同時允許 `cel-js` 與 `@marcbachmann/cel-js`，目前只允許前者。
- 兩個 project 的 `ts-jest` 快取隔離需確認。

---

## 14. 套件依賴與 peer [設計，部分已驗證]

### 14.1 依賴

- 新增 `@marcbachmann/cel-js`（spike 版本 8.0.0）到 `libs/bpm-core/package.json` 的 `dependencies`，版本範圍建議 `^8.0.0`，以 lockfile 固定。
- `cel-js` 0.8.2 保留（legacy 仍需要）。
- **不加 peer dependency**。`@rytass/bpm-core-nestjs-module` 的 peer 清單不變，因為 CEL 引擎是 BPM 內部實作，宿主不需要知道。
- root `package.json` 不需要新增（workspace 依賴由 `libs/bpm-core` 持有）。若 root 已有 `cel-js`（現況有），需一併新增以保持一致 [設計]。

### 14.2 Node 版本與 require(esm) [未驗證，重要]

- `@marcbachmann/cel-js` 8.0.0 的 `engines` 要求 Node `>=20.19`；`cel-js` 0.8.2 要求 `>=18`。
- `ConditionService` 的評估是**同步**的，因此 cel-v2 的延遲載入只能用 `require()`。ESM 套件以 `require()` 載入需要 Node 20.19+ 或 22.12+ 的 require(esm) 支援。
- 必須先確認：(a) `libs/bpm-core` 的 build 輸出格式（CJS 或 ESM）；(b) 宿主與 `apps/api` 的 Dockerfile base image Node 版本；(c) 若宿主低於 20.19，cel-v2 必須以 feature flag 隱藏，不得拖垮 cel-legacy。
- 此項未在 spike 中驗證（spike 只在 Node v24.22.1 上執行）。

### 14.3 發版影響

- `bpm-core` 新增 runtime 依賴，依 CLAUDE.md 的 fixed version set 會連帶 bump 四個套件。P1 完成時須依 Releasing 章節的流程，先 `--dry-run` 並以精確版本發版。

---

## 15. 與其他 phase 的介面

| 對象 | 需要 P0／P1 提供 | 型別或函式 |
| --- | --- | --- |
| P2（AST lint） | `ExpressionHandle.native` 可取得 cel-v2 AST；legacy 仍走 regex | `ExpressionEngineAdapter.compile` |
| P2（schema 型別檢查） | cel-v2 的 `Environment` 可由外部注入 schema | `CelV2Adapter` 建構參數 `environmentFactory`（P1 預留，P2 填入） |
| P3（宿主函式） | `Environment.registerFunction` 的掛點；錯誤碼 `EXPRESSION_FUNCTION_FAILED` 已保留 | `ExpressionErrorCode`、adapter 的 `registerFunction` 方法（P1 預留空實作） |
| P4（preview／catalog） | 預覽需要與正式評估相同的 `ExpressionRuntime`，只是帳本獨立 | `ExpressionRuntime.evaluate` |
| P5（EXPRESSION binding） | 預算耗盡時回傳既有 `UNAVAILABLE` 語意；由 P5 的 adapter 映射 | `ExpressionBudget` 與 `EXPRESSION_BUDGET_EXCEEDED` |

P0 完成後，錯誤碼列表與 `ExpressionRuntimeError` 形狀視為穩定，之後不得在無 ADR 更新下改變。

---

## 16. 差異表與可接受性判定

差異來源：`engine-spike/out/engine-diff.txt`，136 筆（SAME 87、DIFF 49）。

**重要說明**：engine-diff 是在 v8 **未註冊**混合數字 overload 的情況下產生的。下列 `A17`、`A18`、`B05`–`B08`、`B10` 的 DIFF 是 overload 缺漏造成，已在 probe 中以 `env.registerOperator('dyn * int', ...)` 等註冊消除。其他 DIFF 不受此影響。最終數字以 P1 重跑為準。

判定標籤：**可接受**（加法或改善，對現有樣式無害）、**可接受·需補強**（需 P0／P1 程式碼配合）、**需決定**（產品或架構決定）、**不可接受**（不得上線）。

| 編號 | 項目 | legacy | cel-v2（spike） | 判定 | 說明 |
| --- | --- | --- | --- | --- | --- |
| A05、E11–E15 | `contains`、`startsWith`、`matches`、`substring`、`lowerAscii`、`size()` | 無此方法，報錯 | 支援 | 可接受 | 加法。`docs/05` 的 `contains` 範例會因此變成可用，但只限 cel-v2 |
| A22、D10、G07 | `null` 字面值 | 解析錯誤 | 支援 | 可接受 | 加法；legacy 原本就錯 |
| A17、A18、B05–B08、B10 | 混合 int／double 算術 | 支援 | 未註冊 overload 時報錯；註冊後等同 | 可接受·需補強 | P1 必須註冊 `dyn op int`、`int op dyn`（`+ - * / %`） |
| B13、F08 | `1 == 1.0`、`2.0 in [1, 2]` | 真 | 未註冊時報錯 | 可接受·需補強 | 不註冊就不可上線；註冊方式待驗證 [未驗證] |
| A39、C01–C03、G04、G06、H01 | 整數回傳型別 number 對 bigint | number | bigint | 可接受 | walker 正規化為 number；超出安全整數範圍拒絕 |
| B19 | 除以零 | 錯誤 `Division by zero` | 註冊 double overload 後得 `Infinity` | 可接受·需補強 | walker 拒絕非有限數；代碼 `EXPRESSION_TYPE_ERROR` |
| D12、D13、D18 | `missing == 1 \|\| amount > 0` | 缺值錯誤 | 吸收錯誤，回 true | **需決定** | 靜默改變路由：原本失敗的表達式變成成功。見 §17 條件 (b) |
| D14、D15 | `&&` 含缺值分支 | false 與錯誤 | `false && 錯誤` 兩者皆 false；`true && 錯誤` 仍需確認 | 需決定 | 同 D12，併入決定 (b) |
| D07、G03 | `has(form.missing.deeper)` | 回 false | 缺值錯誤 | **需決定** | 語意相反；P2 lint 需找出現有用法。見 §17 條件 (c) |
| C06–C08 | `form.constructor`、`toString`、`__proto__` | 回 function、空 map | MISSING_KEY | 可接受 | P0 本來就要擋；兩方言都必須經過 walker 與 root 檢查 |
| A29、A34、D01 | 缺值訊息洩漏 context | 整包 JSON | 短訊息 | 可接受 | 改善；legacy 也必須在 P0 淨化 |
| H02 | 三元條件非 bool | 回 1 | NOT_BOOL 錯誤 | 可接受 | legacy 行為不符 CEL 規格；repo 內無此樣式 [未以 grep 確認] |
| A32 | `form["hyphen-key"]` | 缺值 | 缺值 | 可接受 | 兩者皆 MISSING_KEY |
| A19–A21、A30、A36–A38 | size、in、exists、字串等既有樣式 | 相同 | 相同 | 可接受 | 無差異 |
| B18、E07、E16、F06 | 字串與數字的加法、比較、`in` | 錯誤 | 錯誤 | 可接受 | 兩者皆 TYPE_ERROR，只有訊息不同 |
| D03、D06、D17 | `!= null` 守衛樣式 | 相同 | 相同 | 可接受 | 前端產生的主要樣式不受影響 |
| I01 | 鏈式 `map(...).map(...).exists(...)` | 通過 | 錯誤 | **需重跑** | 可能與 overload 缺漏有關，未在 probe 中單獨確認 |
| I04、I06 | `filter(...).size()`、`matches` 組合 | 報錯 | 支援 | 可接受 | 加法 |
| C13 | `form["sec"+"ret"]` | 缺值 | 缺值 | 可接受 | 但 P2 lint 必須擋下（phases P2 的 gate） |

**統計**：屬「需決定」的共三組（`||`/`&&` 吸收、`has()` 缺值、其餘待 I01 重跑）。其餘皆為可接受或需補強。

---

## 17. P1 gate 建議

**建議：有條件採用 `cel-v2`，僅作為新的 opt-in 方言。既有定義與規則維持 `cel-legacy`。**

理由：

- 差異中大多數是加法，且 `cel-v2` 不會讓既有 `cel-legacy` 樣式改變結果，前提是方言欄位正確隔離。
- 真正的風險集中在三件事：`||`/`&&` 吸收、`has()` 語意、跨型別比較。三者都可以在 runtime 或 lint 層處理，不需要更換引擎。
- `cel-js` 0.8.2 的 `contains` 等缺口會持續存在。`@marcbachmann/cel-js` 有 schema check、AST 限制與 registerFunction，這些是 P2、P3 需要的能力。

**通過 P1 gate 的條件**（全部滿足才算通過）：

- (a) 混合數字與跨型別比較的 overload 已註冊，並在真引擎測試中與 legacy 一致。
- (b) **產品決定**：接受 `||`/`&&` 的錯誤吸收，或在 cel-v2 下以 lint 禁止「可能缺值的欄位引用出現在會被吸收的分支」。若兩者都不接受，依 phases 決策點**停用 `cel-v2`**，保留 `cel-js`。
- (c) **產品決定**：`has()` 遇缺失父層的語意。若採用 cel-v2 的報錯語意，必須在 P2 lint 找出所有現有 `has()` 巢狀用法並警告；若無，則停用。
- (d) 整數正規化與非有限數拒絕已由 walker 測試覆蓋。
- (e) I01 重跑結果已分類。
- (f) Node 版本與 require(esm) 已確認（§14.2）。

若 (b) 或 (c) 被拒絕，P1 結論改為**不採用**，進入 phases 的決策點：停用 `cel-v2`，保留 `cel-js`，繼續 P2 的舊方言可行部分與 P3。

---

## 18. 文件衝突（ADR 與 phases 對照實測）

1. **預算耗時**：ADR 寫 `createContext` 約 68 us；spike 實測約 182 us（每次新建 context），重用約 36 us。ADR 數字不成立，應更新。
2. **效能數字**：ADR 寫 5478 ms 與 407 ms；spike 在本機實測 18313 ms 與 2715 ms。兩者條件不同，ADR 未說明量測條件，建議 ADR 註明「量測環境」或改用 §9 的方法重量。
3. **`||` 吸收**：ADR 與 generator 註解假設 CEL 的 `||` 不吸收錯誤；v8 引擎吸收。此假設與 cel-v2 不一致，需在 ADR 更新或在 §17 (b) 決定後更新。
4. **AST 限制**：ADR §3.4 寫「AST 200 節點、深度 32」。cel-v2 的 `maxAstNodes`、`maxDepth` 可直接設定，但 comprehension 的巢狀深度不由 env limit 控制，需要自行 AST 走訪。ADR 未提及此點。
5. **`contains` 範例**：`docs/05-conditions-cel.md` 的 `contains` 範例在 legacy 報錯（A05）；P0 修正時需同步說明此限制僅適用於 legacy。

---

## 19. 未驗證事項清單

- 外層 2000 ms 預算穿透內層 catch（§4.3）。
- 跨型別數字比較的 overload 註冊是否可行（§16 B13、F08）。
- 整數超過 2^53 的行為（兩方言）。
- Node 20.19 以下與 22.x 的 require(esm)（§14.2）。
- `libs/bpm-core` build 輸出格式。
- 真引擎 jest project 的 transform 與快取（§13.3）。
- 委派規則與 `WorkflowDefinition` 快照實體檔名與 migration 目錄慣例。
- `libs/shared` 定義型別的確切檔案（P1 開工時確認）。
- `has()` 在現有 repo 生成樣式中的使用情況（需 grep）。
- 可選欄位缺值時前端生成樣式的實際行為（ADR 與 phases 的 P2 項目）。

---

## 20. 需產品擁有者決定的事項

1. **`||`/`&&` 錯誤吸收**（§17 (b)）：是否接受 cel-v2 的吸收語意，或要求以 lint 禁止高風險用法。這會影響 cel-v2 是否採用。
2. **`has()` 缺失父層**（§17 (c)）：是否接受 cel-v2 的報錯語意。
3. **預設方言**：新建定義與規則是否預設 `cel-v2`。本設計建議預設維持 `cel-legacy`，由設計者 opt-in。
4. **`Division by zero` 的代碼歸類**（§6.3）：歸為 `EXPRESSION_TYPE_ERROR`（本設計）或 `EXPRESSION_INVALID_RESULT`。
5. **整數超出安全範圍**（§5）：拒絕（本設計）或以字串回傳。
