# 24 — 流程表達式細部設計與實作契約

- **狀態**：IMPLEMENTING（2026-11-07 起）
- **權威決策**：[ADR 22](./22-expression-functions-adr.md)；交付與 gate 見 [Phase 23](./23-expression-functions-phases.md)
- **各線細部設計**：[P0–P1](./24-expression-design/p0-p1-runtime.md)、
  [P2–P3](./24-expression-design/p2-p3-lint-functions.md)、
  [P4](./24-expression-design/p4-designer.md)、[P5](./24-expression-design/p5-bindings.md)；
  差異實測原始結果在 [engine-diff.txt](./24-expression-design/engine-diff.txt)

**本文件優先於上述四份細部設計。** 它們是平行寫成的，彼此有衝突；衝突以這裡為準。
它們引用的行號可能已過期，實作前要重新核對。

## 1. 已定案的決定

| 問題 | 決定 | 理由 |
| --- | --- | --- |
| 採用 `@marcbachmann/cel-js` 8.0.0 | 採用，作為 `cel-v2` | 136 筆差異實測：87 筆相同，49 筆有差異；需決定的只有下面兩組 |
| `\|\|`／`&&` 吸收錯誤（D12–D15、D18） | 接受，符合 CEL 語意；方言升級的差異檢查要列出，lint 發警告 | 只影響明確選用 `cel-v2` 的定義，既有版本不變 |
| `has()` 遇缺失父層丟錯（D07、G03） | 接受；同上列入差異檢查，lint 發警告 | 同上 |
| 新模板預設方言 | `cel-v2`（ADR §3.3）；既有定義與規則維持 `cel-legacy` | 新模板沒有既有行為可破壞，設計者才用得到 `contains` |
| 舊方言的 lint | 不變，只加長度檢查 | 舊方言沒有 AST |
| 回滾的 lint | 不重新跑表達式 lint，只檢查引用的函式仍已註冊，缺少就拒絕 | 回滾是復原路徑；舊版本可能過不了後來收緊的規則。修訂 ADR §5 |
| Webhook `EXPRESSION` 求值時機 | 交易內帶預算求值 | 純 CPU、有上限，不會再長時間持鎖；要與 outbox 同交易寫入 |
| 宿主函式能否用在 binding | v1 只允許內建函式 | 之後放寬是 additive，反向則否 |
| 選填欄位沒有 `has()` | 只發警告，不擋發布 | ADR §3.4 |
| 欄位被 `EXPRESSION` 引用時改名或刪除 | 擋下並提示手動修改，不自動改寫 | 不改動使用者沒編輯的內容 |
| 邊條件 UI | 結構化建構器仍是預設，CEL 文字是「進階」入口 | 不改既有 UX |
| 方言升級粒度 | 整份草稿一起升級，先跑差異檢查（ADR §3.3） | 一份定義只有一個方言 |
| CSP | 非 nonce，先 `Content-Security-Policy-Report-Only`，保留 `worker-src blob:` | 縱深防禦，不作為功能前提；nonce 會迫使所有頁面動態渲染 |
| AI 助理寫表達式 | 可以，但寫入前要先通過 LINT | ADR §3.8 |
| `/api/chat` | 隨 P4 修補：未啟用回 404，加可選的 authorize 掛點 | P4 的 AI 工具不能建立在未驗證的路由上 |
| 大表格 binding 預算 | 超出就回既有 `UNAVAILABLE` 語意，不限制列數 | 先量測，有資料再調整 |
| UI 設計稿 | 沿用現有設計器版面，只用 Mezzanine 元件組合 | 沒有設計稿 |

Ad-hoc webhook SSRF 不在這輪範圍（見 Phase 23 獨立安全修補）。

## 2. 契約

### 2.1 Runtime 錯誤碼（對外唯一來源）

只有 ADR §3.2 這六個：`EXPRESSION_SYNTAX_ERROR`、`EXPRESSION_MISSING_KEY`、`EXPRESSION_TYPE_ERROR`、
`EXPRESSION_BUDGET_EXCEEDED`、`EXPRESSION_INVALID_RESULT`、`EXPRESSION_FUNCTION_FAILED`。

- 整數除以零：`EXPRESSION_TYPE_ERROR`。`cel-v2` 的 `double` 除以零依 CEL 標準得到 IEEE Infinity，引擎內建、無法覆寫（P1 實測）；比較運算會把它吸收成 boolean，所以由 P2 對「除數是欄位」發 lint 警告（P1 差異 P35，2026-11-07 定案）。超出安全整數範圍：`EXPRESSION_INVALID_RESULT`。
- 函式未註冊、下架、丟錯、回傳 thenable、回傳型別不符，一律 `EXPRESSION_FUNCTION_FAILED`。
- DataSource：不新增碼。預算耗盡對應 `FORM_DATA_SOURCE_TIMEOUT`，綁定型別不符對應既有 `INVALID_BINDING`。
- Webhook binding：沿用 `WEBHOOK_PARAMETER_INVALID`，記 `FAILED`，不回滾。

### 2.2 Lint 碼

發布、preview 的 LINT 模式、NOTIFY catalog 共用同一份，定義在 `@rytass/bpm-core-shared`：

`EXPR_PARSE_FAILED`、`EXPR_ROOT_NOT_ALLOWED`、`EXPR_WHOLE_FORM_REFERENCE`、`EXPR_COMPUTED_KEY`、
`EXPR_RESERVED_PATH_SEGMENT`、`EXPR_COMPLEXITY_EXCEEDED`、`EXPR_COMPREHENSION_NESTING`、`EXPR_FIELD_UNKNOWN`、
`EXPR_FIELD_TYPE_MISMATCH`、`EXPR_RESULT_TYPE_MISMATCH`、`EXPR_FUNCTION_NOT_REGISTERED`、`EXPR_FUNCTION_NOT_ALLOWED`。

警告碼：`EXPR_OPTIONAL_FIELD_WITHOUT_HAS`、`EXPR_OR_ABSORBS_ERROR`、`EXPR_HAS_NESTED_PARENT`、
`EXPR_APPROVER_READS_FORM`、`EXPR_HIDDEN_FIELD_COPIED`。

中文訊息只有一份，放在 `libs/bpm-core-client/src/lib/template/workflow-lint-errors.ts`。
訊息不得含 `; `。

### 2.3 根識別字（每個表面各一份，不做聯集）

定義在 `libs/shared/src/lib/expression-usage-point.ts`：

| 表面 | 根 |
| --- | --- |
| `INITIATOR_POLICY` | `env`、`initiator`、`subject` |
| `ENTRY_CONDITION`、`APPROVER_RESOLVER`、`SERVICE_FORM_FIELD_VALUE`、`WEBHOOK_PAYLOAD` | `env`、`form`、`formData`、`initiator`、`instance` |
| `FLOW_CONDITION` | 上一列加 `lastDecision` |
| `DELEGATION_CONDITION` | 上一列的五個加 `principal`，不含 `lastDecision` |
| `DATA_SOURCE_BINDING` | `form`、`row` |
| `NOTIFY_WEBHOOK_BINDING` | `form` |

### 2.4 方言儲存

- `WorkflowDefinition.meta` 的同層新增 JSON 欄位 `expressionDialect`，缺少視為 `cel-legacy`。沒有 migration。
- `delegation_rules.scope_condition_dialect` 是資料庫欄位，有可回復的 migration，既有資料 `cel-legacy`。
- `EXPRESSION` binding 沒有方言欄位，永遠是 `cel-v2`。

### 2.5 AST 與依賴

- 全部放在 `libs/bpm-core/src/lib/condition/expression-ast.ts`，由 P2 提供 `readExpressionReferences`。
- `libs/shared` 不得依賴任何 CEL 引擎，瀏覽器也不解析 CEL。
- 瀏覽器要知道依賴時由後端提供：`waitingForFieldKeys` 與 lint 結果。

### 2.6 宿主函式

依 ADR §3.5 的介面與命名（`handler(...args)`、`parameters`、`returnType`、`label`、`name` 含 `_vN`），
不採 P2–P3 細部設計裡的 `params`／`returns`／`handler(args)`。內建函式就是 ADR 列的九個，名稱保留，不帶版本後綴。
所有評估一律 strict mode；測試要斷言改動引數會丟 `TypeError`。

### 2.7 數值

以 ADR 為準：單次預算 100 ms、單次操作累計 250 ms、AST 200 節點、深度 32、comprehension 2 層、
輸出 64 KiB、整次 dry run 2 秒。要調整須附量測結果並回寫 ADR。

### 2.8 `EXPRESSION` binding 相容性

- `readBindingValues`、`readWaitingForFieldKeys` 等一律改成窮舉 `switch`；未知來源丟錯，不得落到 `ROW_FIELD`。
- `bindingHash` 序列化逐位元組不變，以 golden fixture 保證。
- 舊版前端讀到未知來源時不崩潰，欄位顯示不可用；四個套件是同一個固定版本組，正常不會混用。
- 發布 gate：`EXPRESSION` 必須通過 `cel-v2` lint，瀏覽器送來的定義一律忽略。

## 3. 分工與檔案歸屬

P0 → P1 依序，之後 P2 與 P3、P4 與 P5 各自平行。每個檔案同時只有一條線能寫：

| 線 | 擁有 |
| --- | --- |
| P0、P1 | `condition/`（除 `expression-ast.ts`）、`workflow-engine.service.ts` 的評估點與 dry run、`time-budget.ts`、delegation 方言、migration、jest 真引擎 project、`package.json` |
| P2 | `condition/expression-ast.ts`、`expression-usage-point.ts`、`template.service.ts` 的發布 lint、`workflow-lint-errors.ts` |
| P3 | 函式 registry、`bpm-root` 選項與 module、內建函式、`apps/api` 示範函式；`template.service.ts` 只由 P2 寫，P3 提供 `assertPublishable` 由 P2 呼叫 |
| P4 | `libs/bpm-core-react` 設計器、`previewExpression`／`expressionCatalog`、client、AI 助理、`/api/chat`、CSP |
| P5 | `form-data-source/`、`workflow-webhook/`、表單 Builder 綁定 UI；`workflow-graph.ts`、`workflow-lint-errors.ts` 由 P4 先合入後才可動 |

每條線共用的檔案（`docs/api-reference.md`、`docs/README.md`）由整合者合併。
