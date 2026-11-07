# P2 / P3 細部設計：AST lint 與宿主函式

- **狀態**：已實作，以 [docs/24](../24-expression-functions-detailed-design.md) 為準；錯誤碼以 docs/24 §2 為準
- **相依**：ADR 22（`docs/22-expression-functions-adr.md`）、Phase 文件（`docs/23-expression-functions-phases.md`）、P1 差異測試結果
- **範圍**：P2（AST lint、schema 型別、lint 訊息、方言並存、已發布版本）與 P3（宿主函式 registry、`BPMRootModule` 選項、註冊與回傳驗證、內建函式、`apps/api` 示範、發布 lint）
- **約束**：CEL only；dry run 維持 `@BPMAuthenticated()`；交易內一律使用傳入的 `EntityManager`，不另取連線；API contract 只增不減；UI 只用 `@mezzanine-ui/react`

本文件只做設計，未改動 repo 內任何檔案。引用的 `path:line` 已於 2026-11-07 重新 grep 核對；標註「待 spike」者尚未驗證，不可當作事實。

## 1. 現況（已核對的錨點）

| 項目 | 位置 | 現況 |
| --- | --- | --- |
| 表單欄位引用 regex | `libs/shared/src/lib/field-access-lint.ts:441`（`referencesFormField`），`:524` 使用 | 以字串樣式判斷，無法辨識 `form["sec"+"ret"]` 之類動態 key |
| 發布 lint 入口 | `libs/bpm-core/src/lib/template/template.service.ts:946`（`validatePublishableVersion`） | 內含 root 白名單檢查（`:985`、`:993`）、表格引用（`:999`）、簽核人已填欄位讀取（`:1022`） |
| 白名單常數 | `template.service.ts:98`（`WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS`） | 發布與 dry run 共用的 root 清單 |
| 發布流程 | `template.service.ts:747`（`publishVersion`），`:760` 呼叫 validate | 所有發布路徑都經過此處 |
| 回滾流程 | `template.service.ts:832`（`rollbackApprovalTemplateVersion`） | 本次讀取未見呼叫 validate，待 P2 決定（見 §2.8） |
| lint 訊息翻譯 | `libs/bpm-core-client/src/lib/template/workflow-lint-errors.ts:104`（`WORKFLOW_LINT_COPY`）、`:282`（`readWorkflowLintMessage`）、`:307`（`.split('; ')`）、`:359`（`readLinePattern`） | 以整行文字比對翻譯，依賴 `'; '` 分隔 |
| 共用 lint 訊息 | `libs/shared/src/lib/workflow-graph.ts:111`（`WORKFLOW_EXPRESSION_LABELS`）、`:138`（`WORKFLOW_LINT_MESSAGES`） | 文字即契約，改字要同步前端 |
| 結構化條件轉 CEL | `workflow-graph.ts:2342`（`readConditionExpression`） | 產生 `!= null`、`size()`、`in`、`form["key"]`，是 P2 AST 測試的主要樣本 |
| ConditionService 載入 | `libs/bpm-core/src/lib/condition/condition.service.ts:33`（`loadCelEngine`）、`:116-122`（parse 與 lint）、`:155-158`（evaluate 前 parse）、`:174`（`isParseFailure`）、`:178`（`lintRootIdentifiers`）、`:82`（`CEL_KEYWORDS`） | 以 regex 做 root 檢查，尚無 AST |
| jest 替身 | `libs/bpm-core/jest.config.cts:10`（`'^cel-js$'` 對應 testing stub）、`:12`（transformIgnorePatterns） | 替身只有 parse／evaluate，無 check、無 AST 節點 |
| 延遲載入預算 | `libs/bpm-core/src/lib/workflow-engine/time-budget.ts:4`（`TimeBudgetExceededError`）、`:27`（`runWithinTimeBudget`） | 需先載入引擎再包預算（spike 已確認） |
| 委派 lint | `libs/bpm-core/src/lib/delegation/delegation.service.ts:595-602`，`:629`（`DELEGATION_EXPRESSION_ROOT_IDENTIFIERS`） | 另一組 root 清單，P2 應合併為同一來源 |
| 流程引擎 CEL 呼叫 | `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts:563`（`ConditionService` 注入）、`:3176`（`dryRunApprovalWorkflow`）、`:8865`（`buildInitiatorPolicyContext`）、`:8877`（`buildWorkflowExpressionContext`）、`:8932`（`buildDryRunExpressionContext`） | dry run 與正式流程各自組 context，P3 需共用同一 registry |
| Registry 樣板 | `libs/bpm-core/src/lib/workflow-engine/workflow-service-task-dispatcher.token.ts:22`（`Symbol('BPM_WORKFLOW_SERVICE_TASK_DISPATCHER')`） | Symbol token + 預設 class 的既有模式 |
| Root options | `libs/bpm-core/src/lib/bpm/bpm-root-options.ts:137-138`（`BPM_ROOT_OPTIONS`）、`:167`（`BPMRootOptionsModule`） | 全域 options 發布點 |
| Root module | `libs/bpm-core/src/lib/bpm/bpm-root.module.ts:345`（`FormDataSourceModule.forRoot`） | 既有 registry 掛載範例 |
| 宿主入口 | `apps/api/src/app/app.module.ts:86`（`BPMRootModule.forRootAsync`） | `apps/api` 示範函式掛載點 |
| 委派 lint 方言 | `delegation.service.ts:595` | 與模板共用 `ConditionService.lintExpression`，`options.allowedRootIdentifiers` 傳入 |

### 1.1 Spike 結論（`lint-spike/scripts/*.mjs`，依賴僅裝在 `lint-spike/pkg`）

- `@marcbachmann/cel-js@8.0.0`（零依賴、ESM）：`env.parse` 回傳可見 AST，`env.check` 可做存在性與型別檢查。
- `registerVariable` 的型別名稱需白名單化：只可用基本型別與 `list(...)`；`list(map)`、`optional(string)`、`string?` 會在內部丟 `TypeError: Cannot read properties of undefined (reading 'convert')`。映射層必須以白名單轉換。
- 對 typed 欄位做 `check`，null 值在執行期會造成型別不符；因此執行期 env 應把表單欄位宣告為 `dyn`，靜態型別只用於 lint。
- `registerOperator` 要帶 `: type` 回傳後綴才能讓 mixed int／double 運算生效。cel-js 內建的比較運算子重複註冊會丟 `Operator overload already registered`，註冊必須先探測或只吞該訊息。
- `env.parse` 的 `ParseResult` 在型別錯誤時會丟 `EvaluationError`，因此一律先呼叫 `check()`。
- dyn 執行期實測（`dyn-runtime-probe.mjs`）：`form.amount * 2 > 1.0` 為 true；`form.note != null && form.note != ""` 在 null 時為 false；`form.items.all(x, x.qty > 0)` 在某列 qty 為 null 時丟 `no_such_overload`；`"A" in form.m` 在 m 為 null 時丟錯。結論：null 必須在表達式內自行守護。
- 限制的 `limit_exceeded` 與 parse 錯誤碼已記錄於 `limits-probe.mjs`；bench 成本見 `bench-env.mjs`。

## 2. P2 設計

### 2.1 AST lint（僅 `cel-v2`）

**決策**：`cel-v2` 模板走 AST lint；`cel-legacy` 保留現有 regex，不重寫。
**理由**：regex 無法辨識 computed key；AST 可直接判斷節點種類。

**模組**：新增 `libs/bpm-core/src/lib/condition/expression-ast-lint.ts`（純函式，不依賴 Nest）。

```ts
export type ExpressionLintCode =
  | 'EXPR_PARSE_FAILED'
  | 'EXPR_ROOT_NOT_ALLOWED'
  | 'EXPR_WHOLE_FORM_REFERENCE'
  | 'EXPR_COMPUTED_KEY'
  | 'EXPR_RESERVED_PATH_SEGMENT'
  | 'EXPR_COMPLEXITY_EXCEEDED'
  | 'EXPR_COMPREHENSION_NESTING'
  | 'EXPR_FIELD_UNKNOWN'
  | 'EXPR_FIELD_TYPE_MISMATCH'
  | 'EXPR_OPTIONAL_FIELD_WITHOUT_HAS';

export interface ExpressionLintIssue {
  readonly code: ExpressionLintCode;
  readonly label: string;        // 例如 "條件 2"，與既有 label 一致
  readonly fieldKey?: string;    // 只放表單欄位 key，不放值
}

export interface ExpressionAstLintOptions {
  readonly allowedRootIdentifiers: readonly string[];
  readonly formFields?: ReadonlyMap<string, ExpressionFieldSchema>;
  readonly maxNodes: number;              // 建議 400，待 P1 量測定案
  readonly maxComprehensionDepth: 2;      // 固定為 2
}

export function lintExpressionAst(
  expression: string,
  label: string,
  options: ExpressionAstLintOptions,
  engine: CelEngine,        // 由呼叫端傳入已載入的引擎，避免本模組自行 require
): readonly ExpressionLintIssue[];
```

**檢查順序與規則**：

1. `parse` 失敗 → `EXPR_PARSE_FAILED`，其餘檢查略過。
2. 走訪 AST，僅針對下列節點種類：`ident`、`member`（`.`）、`index`（`[]`）、`call` 與 `rcall`（成員函式）、`comprehension`。其他節點只計入節點數。
3. Root：`ident` 不在 `allowedRootIdentifiers` 且不在 CEL 保留字中 → `EXPR_ROOT_NOT_ALLOWED`。宣告為迴圈變數的 identifier（comprehension 的 iter var）不算 root。
4. 整體引用：`form` 以裸 `ident` 出現，且不是 `member` 或 `index` 的基底 → `EXPR_WHOLE_FORM_REFERENCE`（擋 `string(form)`、`form == x`、`[form]`）。
5. Computed key：`index` 的索引不是字面字串 → `EXPR_COMPUTED_KEY`（擋 `form["sec"+"ret"]`）。字面字串 key 的 `form["x"]` 允許。
6. 保留片段：`member` 或字面 index 的 key 為 `__proto__`、`constructor`、`prototype` → `EXPR_RESERVED_PATH_SEGMENT`。`fieldPath` 同規則。
7. 複雜度：節點數超過 `maxNodes` → `EXPR_COMPLEXITY_EXCEEDED`；comprehension 巢狀深度超過 2 → `EXPR_COMPREHENSION_NESTING`。
8. 欄位與型別：見 §2.2。

**不做的事**：不在 lint 階段執行表達式；不解析值。

### 2.2 Schema 到 env 的映射

**決策**：兩個 env 分開。
- **lint env**：`form` 各欄位依 schema 宣告型別，用於 `check()` 找出未知欄位與明顯型別錯誤。
- **runtime env**：`form` 全部欄位為 `dyn`，與 spike 結論一致，避免 null 值在執行期造成型別錯誤。

**映射**：新增 `libs/bpm-core/src/lib/condition/expression-field-types.ts`，白名單轉換：

| 表單欄位型別（`libs/shared/src/lib/form.ts`） | lint 型別 | 備註 |
| --- | --- | --- |
| text、textarea、select（single）、radio（single）、date（以字串儲存） | `string` | 依 form.ts 實際型別再核對 |
| number | `double` | 混合整數運算需要 `: double` 後綴 |
| checkbox（multiple）、select（multiple）、table 以外的多值欄位 | `list(string)` | `readFormFieldSelectionMode`（`form.ts:652`）決定單複選 |
| file_upload | `dyn` | 值為 attachment id 字串或陣列（`attachment.service.ts:561-590`） |
| table | `list(dyn)` | `FormTableCellValue` 含 null（`form.ts`） |
| 其他或未知 | `dyn` | 不得傳入 `optional(...)` 或 `string?` |

**規則**：型別名稱只能取自白名單；未知型別一律 `dyn`，不得拋錯。

**選填欄位**：lint 規則 `EXPR_OPTIONAL_FIELD_WITHOUT_HAS` 只作為警告（不擋發布）。條件為：欄位 `required: false`，且表達式直接讀取 `form.<key>`，未先以 `has(form.<key>)` 或 `form.<key> != null` 守護。

**隱藏欄位複製**：`fieldPath` 指向的欄位若在 schema 中標為隱藏，而表達式寫入可見欄位，列為警告。注意：本設計只定義警告的資料來源（schema 的 visibility），實際判斷規則待 P2 實作時以既有 `field-access-lint.ts` 的測試為準。

### 2.3 lint 訊息對應

**決策**：新增的 lint 訊息不得含 `'; '`，每個 code 在 `WORKFLOW_LINT_MESSAGES`（`workflow-graph.ts:138`）與 `WORKFLOW_LINT_COPY`（`workflow-lint-errors.ts:104`）各有一筆；`workflow-lint-errors.spec.ts` 逐一斷言。

**理由**：`readWorkflowLintMessage`（`workflow-lint-errors.ts:307`）以 `'; '` 切段，訊息內含該分隔字會被切壞；翻譯以整行 pattern 比對（`:359`），因此新訊息必須固定字串，不含動態值。

**格式**：`{label}：{固定句}`，例如 `條件 2：引用了不存在的表單欄位`。欄位 key 若需顯示，只能用 `fieldKey` 欄位在 UI 層組裝，不在後端訊息中串接，避免使用者自訂 key 含分隔字。

**前後端一致性**：P2 gate 要求 `workflow-lint-errors.spec.ts` 覆蓋所有新 code。

### 2.4 方言並存

- 方言欄位 `expressionDialect` 由 P1 定義，存於模板版本快照（`approval-template-version.entity.ts:32` 的 `workflowDefinition` 快照內），不另加欄位。
- lint 依版本的方言分派：`cel-v2` 走 AST（§2.1），`cel-legacy` 走既有 regex 路徑。
- `cel-v2` 的 lint 只在建立或發布新版本時執行，既有版本不重新 lint（Phase 文件 P2 gate）。
- 若 P1 判定引擎差異不可接受，本節全部停用，P2 只保留 `cel-legacy` 可行部分（regex 的 root 白名單與整體引用）。這是 Phase 文件 P1 的決策點，本設計以「P1 通過」為前提。

### 2.5 Root 白名單單一來源

**決策**：`WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS`（`template.service.ts:98`）與 `DELEGATION_EXPRESSION_ROOT_IDENTIFIERS`（`delegation.service.ts:629`）合併到 `libs/bpm-core/src/lib/condition/expression-roots.ts`。
**理由**：兩處各自維護，P3 加入函式後會漏改。
**影響**：只搬移常數，值不變；委派與模板的既有 lint 結果需由現有測試保證不變。

### 2.6 發布 lint 的整合點

在 `validatePublishableVersion`（`template.service.ts:946`）內，於 `lintApproverFilledFieldReads`（`:1022`）之後加入 `lintExpressionFunctionReferences`（P3，見 §3.6）與 AST lint 的分派。順序：先 AST lint，再函式引用檢查，最後既有檢查。錯誤合併為 `'; '` 分隔的字串，維持既有 API 形狀。

### 2.7 P2 的 interface（供 P3、P4 依賴）

- `lintExpressionAst`（§2.1）
- `ExpressionLintCode`（§2.1）
- `ExpressionFieldSchema` 與 `toExpressionFieldTypes`（§2.2）
- `expression-roots.ts` 匯出 `EXPRESSION_ROOT_IDENTIFIERS`

### 2.8 已發布版本與回滾

- 既有已發布版本不重新 lint（Phase 文件 P2 gate）。
- `rollbackApprovalTemplateVersion`（`template.service.ts:832`）**不重新 lint**，只重新啟用已發布的快照。
- **理由**：回滾的目標是已發布過的版本，重新 lint 可能讓一次緊急回滾失敗，這與發布時的檢查衝突。
- **P3 的安全網**：若回滾目標引用了已下架的宿主函式，執行期 fail closed（§3.5），案件狀態不變，並回 `FUNCTION_UNAVAILABLE`。
- 這是一項需要產品決定的取捨（見 decisionsNeeded）。

## 3. P3 設計

### 3.1 公開 contract

新增 `libs/shared/src/lib/expression-function.ts`（shared，因為 UI 目錄與 AI 工具會用到名稱與型別）。

```ts
export type ExpressionFunctionValueType = 'string' | 'double' | 'bool' | 'list' | 'map' | 'null';

export interface BPMExpressionFunctionParam {
  readonly name: string;
  readonly type: Exclude<ExpressionFunctionValueType, 'null'>;
}

export interface BPMExpressionFunction {
  readonly name: string;                       // 見 §3.2 命名規則
  readonly params: readonly BPMExpressionFunctionParam[];
  readonly returns: Exclude<ExpressionFunctionValueType, 'null'>;
  readonly description: string;                // 給設計器目錄用，不進 API 錯誤
  readonly handler: (args: readonly unknown[]) => unknown;
}
```

- `handler` 必須同步；不可為 `async` function，也不可回傳 thenable（§3.4）。
- `args` 為深複製並凍結後的值（§3.4）。
- `description` 只用於 UI 目錄（P4），不影響執行。

### 3.2 註冊驗證

註冊發生在 `BPMRootModule` 初始化時，失敗即丟錯讓應用啟動失敗（fail fast）。驗證於 `libs/bpm-core/src/lib/expression-function/expression-function.registry.ts`：

| 規則 | 錯誤碼（啟動期 `Error` 訊息，不回 API） |
| --- | --- |
| name 符合 `^[a-z][A-Za-z0-9]*$` | `FN_NAME_INVALID` |
| name 不與 cel-js 內建與 CEL 保留字重複 | `FN_NAME_RESERVED` |
| name 不與內建函式重複（§3.7） | `FN_NAME_DUPLICATE` |
| name 在 registry 內唯一 | `FN_NAME_DUPLICATE` |
| handler 不是 `AsyncFunction`（以 `Object.prototype.toString.call(fn) === '[object AsyncFunction]'` 判斷） | `FN_ASYNC_REJECTED` |
| `params` 與 `returns` 的型別在白名單內 | `FN_TYPE_INVALID` |
| `params.length` 不超過 4 | `FN_ARITY_INVALID` |

**待 spike**：cel-js 8 是否允許函式名稱含點（`acme.fx(...)`）。本設計先採純 lowerCamel 名稱，避免依賴此行為；若 spike 證實可行，再討論命名空間。

### 3.3 Registry token 與 BPMRootModule 選項

- Token：`export const BPM_EXPRESSION_FUNCTIONS = Symbol('BPM_EXPRESSION_FUNCTIONS');`，樣式比照 `workflow-service-task-dispatcher.token.ts:22`。
- 預設值：空陣列（未註冊時等同沒有宿主函式，對應 Phase 文件 P3「未註冊時為空」）。
- 選項：在 `BPMRootRuntimeOptions`（`bpm-root-options.ts`）新增可選欄位 `expressionFunctions?: readonly BPMExpressionFunction[]`，由 `BPMRootOptionsModule`（`:167`）發布到 `BPM_ROOT_OPTIONS`，並在 `bpm-root.module.ts` 的 runtime twin provider（約 `:88-100`）提供為 `BPM_EXPRESSION_FUNCTIONS`。
- 模組：`ExpressionFunctionModule`（`@Global`），匯出 `ExpressionFunctionRegistry`；`ConditionModule` 與 `WorkflowEngineModule`、`TemplateModule`、`DelegationModule` 都 import 它。
- 注入方式：`ConditionService` 的建構子新增 `@Optional() @Inject(EXPRESSION_FUNCTION_REGISTRY) registry?`，預設 `undefined` 時視為空 registry，讓約 30 個 spec 中的 `new ConditionService()` 維持可用（Phase 文件與 spike 的約束）。

### 3.4 引數複製、凍結與錯誤隔離

呼叫流程（於 `ConditionService` 的 evaluate 路徑，由 CEL 函式包裝器執行）：

1. 進入前：引數以 JSON-safe 規則複製（只允許 `string`、`number`（有限值）、`boolean`、`null`、陣列、普通物件；其他型別丟 `FUNCTION_ARG_INVALID`）。
2. 遞迴 `Object.freeze`。handler 若修改引數，在 strict mode 會丟 `TypeError`，映射為 `FUNCTION_FAILED`；`formData` 本身不受影響，因為傳入的是複製品。
3. 呼叫 `handler(args)`，同步取回結果。
4. 若結果是 thenable（`typeof r?.then === 'function'`）或 `Promise`，丟 `FUNCTION_RETURN_INVALID`。
5. 回傳值經 P0 的輸出正規化 walker 檢查，型別需符合 `returns`，否則丟 `FUNCTION_RETURN_INVALID`。
6. 任何 handler 拋錯：捕捉後只映射為 `FUNCTION_FAILED`，原始 message 與 stack 不進入 API 回應、活動紀錄、log（沿用 P0 的錯誤淨化規則）。
7. 整次評估在 P0 的時間預算內執行；超時沿用 `TimeBudgetExceededError`（`time-budget.ts:4`）。

### 3.5 Fail closed

- 評估遇到未註冊函式（例如已下架）：丟 `FUNCTION_UNAVAILABLE`，交易回滾，案件狀態不變。
- 這對應 Phase 文件 P3 gate「進行中案件 fail closed」。
- 錯誤對外只回穩定錯誤碼與 label，不含函式名稱以外的內容。

### 3.6 發布 lint：函式引用檢查

新增 `lintExpressionFunctionReferences(version, registry)`（放在 `template.service.ts` 附近或 `expression-ast-lint.ts` 匯出）：

- 走訪所有 `cel-v2` 表達式的 AST，收集 `call` 節點的函式名稱。
- 名稱不在 registry 且不在內建清單 → `FUNCTION_NOT_REGISTERED`，訊息為固定句 `條件 {n}：引用了未註冊的函式`（同 §2.3 規則，不含 `'; '`）。
- 只在發布新版本時執行（對應 Phase 文件 P3 gate：下架後引用它的新版本無法發布）。
- 不重新檢查既有已發布版本（見 §2.8）。

### 3.7 內建函式

- 內建函式與宿主函式共用 `BPMExpressionFunction` 形狀，但來源標記為 `builtin`，由 `expression-function/builtins.ts` 提供。
- 內建函式名稱保留，宿主不可覆寫（`FN_NAME_RESERVED`）。
- 候選清單（純函式，無 I/O）：待產品決定，見 decisionsNeeded。設計上限制為：無時間、無亂數、無 I/O，確保 dry run 與正式執行結果一致。

### 3.8 dry run 與正式流程共用 context

- `dryRunApprovalWorkflow`（`workflow-engine.service.ts:3176`）與正式流程分別由 `buildDryRunExpressionContext`（`:8932`）與 `buildWorkflowExpressionContext`（`:8877`）組 context。
- 函式注入點必須在 `ConditionService` 內，而非各 context builder，避免兩條路徑 registry 不一致。
- dry run 仍維持 `@BPMAuthenticated()`，不改權限裝飾器。
- dry run 使用傳入的 `EntityManager`，不另取連線。

### 3.9 apps/api 示範函式

- 位置：`apps/api/src/app/app.module.ts:86` 的 `BPMRootModule.forRootAsync` 傳入 `expressionFunctions`。
- 示範函式為純函式（例如字串正規化），僅屬 wrapper host，不進入 `libs/bpm-core`。
- 不得在 `libs/bpm-core` 內寫死任何宿主示範函式。

### 3.10 P3 的 interface（供 P4、P5 依賴）

- `BPMExpressionFunction`、`BPMExpressionFunctionParam`、`ExpressionFunctionValueType`（shared）
- `BPM_EXPRESSION_FUNCTIONS`（token）
- `ExpressionFunctionRegistry`（`list()`、`get(name)`、`assertPublishable(names)`）
- `BPMRootRuntimeOptions.expressionFunctions`
- 錯誤碼：`FUNCTION_UNAVAILABLE`、`FUNCTION_FAILED`、`FUNCTION_ARG_INVALID`、`FUNCTION_RETURN_INVALID`、`FUNCTION_NOT_REGISTERED`，以及啟動期的 `FN_*`

## 4. 錯誤碼總表

| 碼 | 階段 | 對外 | 說明 |
| --- | --- | --- | --- |
| `EXPR_PARSE_FAILED` | 發布 lint | 是（label） | parse 失敗 |
| `EXPR_ROOT_NOT_ALLOWED` | 發布 lint | 是（label） | root 不在白名單 |
| `EXPR_WHOLE_FORM_REFERENCE` | 發布 lint | 是（label） | `form` 整體引用 |
| `EXPR_COMPUTED_KEY` | 發布 lint | 是（label） | 非字面 key |
| `EXPR_RESERVED_PATH_SEGMENT` | 發布 lint | 是（label） | `__proto__` 等 |
| `EXPR_COMPLEXITY_EXCEEDED` | 發布 lint | 是（label） | 節點數超限 |
| `EXPR_COMPREHENSION_NESTING` | 發布 lint | 是（label） | 巢狀超過 2 |
| `EXPR_FIELD_UNKNOWN` | 發布 lint | 是（label，欄位 key 於 UI 組裝） | 欄位不存在 |
| `EXPR_FIELD_TYPE_MISMATCH` | 發布 lint | 是（label） | 型別不符 |
| `EXPR_OPTIONAL_FIELD_WITHOUT_HAS` | 發布 lint | 警告 | 選填欄位未守護 |
| `FUNCTION_NOT_REGISTERED` | 發布 lint | 是（label） | 函式未註冊 |
| `FUNCTION_UNAVAILABLE` | 執行期 | 是 | 下架後評估 |
| `FUNCTION_FAILED` | 執行期 | 是（無原始訊息） | handler 拋錯或改動引數 |
| `FUNCTION_ARG_INVALID` | 執行期 | 是 | 引數非 JSON-safe |
| `FUNCTION_RETURN_INVALID` | 執行期 | 是 | 回傳 thenable 或型別不符 |
| `FN_NAME_INVALID`、`FN_NAME_RESERVED`、`FN_NAME_DUPLICATE`、`FN_ASYNC_REJECTED`、`FN_TYPE_INVALID`、`FN_ARITY_INVALID` | 啟動期 | 否（啟動失敗） | 註冊驗證 |

## 5. 測試清單

### 5.1 單元測試（`libs/bpm-core`，jest，使用替身）

- `expression-ast-lint.spec.ts`：
  - `form["sec"+"ret"]` → `EXPR_COMPUTED_KEY`
  - `string(form)` → `EXPR_WHOLE_FORM_REFERENCE`
  - `form.__proto__.x`、`form["constructor"]` → `EXPR_RESERVED_PATH_SEGMENT`
  - `form["x"]`（字面 key）→ 通過
  - 巢狀 comprehension 深度 3 → `EXPR_COMPREHENSION_NESTING`
  - 節點數超過上限 → `EXPR_COMPLEXITY_EXCEEDED`
  - `readConditionExpression`（`workflow-graph.ts:2342`）產生的每種樣式 → 全部通過
- `expression-field-types.spec.ts`：白名單外型別名稱一律轉為 `dyn`；`optional(string)` 不會出現在輸出。
- `workflow-lint-errors.spec.ts`：每個新 code 有翻譯；訊息不含 `'; '`。
- `expression-function.registry.spec.ts`：§3.2 每條規則各一個 case。
- `expression-function.invoke.spec.ts`（§3.4）：
  - 引數改動 → `FUNCTION_FAILED`，`formData` 不變
  - handler 回傳 Promise → `FUNCTION_RETURN_INVALID`
  - handler 拋出含敏感字串的錯誤 → 對外訊息不含該字串
  - 回傳非 JSON-safe 值 → `FUNCTION_RETURN_INVALID`
- `template.service` 的發布 lint 測試：函式未註冊時新版本發布被擋；既有已發布版本不被重新 lint。
- `rollbackApprovalTemplateVersion` 測試：回滾不呼叫 lint（§2.8）。

### 5.2 真實引擎測試（獨立 jest project，不 mock cel-js）

- 目的：替身（`cel-js.jest.ts`）沒有 `check` 與 AST，因此 AST lint 與 `check` 的測試必須跑真實引擎。
- 設定：新增 jest project（例如 `jest.real-engine.config.cts`），不設 `moduleNameMapper`，並保留 `.env.test` 的 `--experimental-vm-modules`。
- 案例：
  - 以 `readConditionExpression` 產生的全部樣式跑 `check`，全部通過
  - 未知欄位 → `check` 報錯並映射為 `EXPR_FIELD_UNKNOWN`
  - 執行期 dyn env 下，null 欄位的 `form.items.all(x, x.qty > 0)` → 映射為評估錯誤並回穩定碼（非原始訊息）
  - 混合 int／double 運算 → 通過（`: double` 後綴）
  - 註冊宿主函式後，`check` 與 evaluate 都能呼叫

### 5.3 Live 測試（`pnpm dev` 下的實際 API，或 `pnpm e2e:client`）

- 發布含未註冊函式的模板 → API 回 `FUNCTION_NOT_REGISTERED`，版本狀態不變。
- 發起案件時 handler 拋錯 → 回 `FUNCTION_FAILED`，案件不建立。
- dry run 與正式發起對同一輸入得到相同的路由結果。
- 回滾到引用已下架函式的版本 → 執行期 `FUNCTION_UNAVAILABLE`，案件狀態不變。
- 以 `apps/api` 示範函式完成一條 `contains` 與宿主函式並存的路徑（P4 gate 會再延伸）。
- 注意：本機 dev server 由使用者手動啟動，agent 不得自行啟動；驗證時只能要求使用者啟動並確認。

## 6. 實作順序與檔案清單

| 順序 | 檔案 | 動作 |
| --- | --- | --- |
| 1 | `libs/bpm-core/src/lib/condition/expression-roots.ts` | 新增，合併 root 常數（§2.5） |
| 2 | `libs/bpm-core/src/lib/condition/expression-field-types.ts` | 新增，型別白名單（§2.2） |
| 3 | `libs/bpm-core/src/lib/condition/expression-ast-lint.ts` | 新增，AST lint（§2.1） |
| 4 | `libs/bpm-core/src/lib/condition/condition.service.ts` | 分派 `cel-v2` 走 AST；函式注入（§3.3） |
| 5 | `libs/bpm-core/src/lib/template/template.service.ts` | `validatePublishableVersion` 接線（§2.6、§3.6） |
| 6 | `libs/bpm-core/src/lib/delegation/delegation.service.ts` | 改用合併後的 root 常數 |
| 7 | `libs/shared/src/lib/field-access-lint.ts` | `cel-v2` 不再走 regex（`:441`、`:524` 保留給 legacy） |
| 8 | `libs/bpm-core-client/src/lib/template/workflow-lint-errors.ts` | 新 code 翻譯（§2.3） |
| 9 | `libs/shared/src/lib/workflow-graph.ts` | `WORKFLOW_LINT_MESSAGES` 新增（`:138`） |
| 10 | `libs/shared/src/lib/expression-function.ts` | 新增 contract（§3.1） |
| 11 | `libs/bpm-core/src/lib/expression-function/*` | 新增 registry、token、builtins、module（§3.2–3.7） |
| 12 | `libs/bpm-core/src/lib/bpm/bpm-root-options.ts`、`bpm-root.module.ts` | 新增選項與 provider（§3.3） |
| 13 | `apps/api/src/app/app.module.ts` | 示範函式（§3.9） |
| 14 | `docs/api-reference.md` | 同 commit 更新（CLAUDE.md 維護規則） |

## 7. 與 ADR／Phase 文件的對照

- **Phase P2 gate「`form["sec"+"ret"]`、`string(form)`、`__proto__` 路徑在發布時被擋下」**：與本設計一致（§2.1）。
- **Phase P2「既有已發布版本不被重新 lint」**：與 §2.8 一致，但回滾的行為需要產品確認（見 decisionsNeeded）。
- **Phase P3「未註冊時為空」**：與 §3.3 一致。
- **Phase P3「handler 改動引數會丟錯，formData 不變」**：本設計以複製與凍結實現（§3.4）。Strict mode 下寫入凍結物件會丟 `TypeError`，此行為待 spike 確認於 vm 內是否同樣成立。
- **ADR 22 §3.4、§3.5**：本次未重新逐段核對原文，本節的對應以 Phase 文件為準。若 ADR 與本設計有出入，以 ADR 為準並回報。
- **CLAUDE.md 的 `docs/api-reference.md` 維護規則**：本設計新增的 shared 與 bpm-core 匯出都需同 commit 更新該文件（§6 第 14 項）。

## 8. 尚待 spike 驗證的假設

1. cel-js 8 函式名稱是否允許點號（影響 §3.2 命名規則）。
2. vm 內 strict mode 寫入凍結物件是否丟 `TypeError`（影響 §3.4 第 2 點）。
3. `registerFunction` 的回傳型別後綴寫法是否與 `registerOperator` 相同（影響 §3.1 `returns` 的對應）。
4. `maxNodes` 的建議值 400 尚未以 repo 內最大的既有表達式量測。
