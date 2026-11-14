# 05 — CEL 條件機制

**CEL (Common Expression Language)** 是 BPMCore 儲存條件與運算式的 DSL。決策見
[ADR 22](./22-expression-functions-adr.md)，實作契約見 [docs/24](./24-expression-functions-detailed-design.md)，
各 Phase 的交付、gate 與實測結果見 [docs/23](./23-expression-functions-phases.md)。本文件描述程式現況。

> 本文件標「未發佈」的內容來自 Phase 23（P0–P5，分支 `feat/expression-runtime`），尚未包含在 v0.19.0。

---

## 1. 兩種方言

| 方言 | 引擎 | 誰用 |
| --- | --- | --- |
| `cel-legacy` | `cel-js` 0.8.2 | 沒有寫方言的既有模板、案件與委派規則 |
| `cel-v2`（未發佈） | `@marcbachmann/cel-js` 8.0.0 | 新模板、新委派規則、所有 `EXPRESSION` binding |

兩個引擎都是 ESM-only，第一次使用時以 `require` 延遲載入，需要 Node >=20.19 或 >=22.12。
`ConditionService` 在開機時（`onApplicationBootstrap`）預熱兩者，冷啟動成本不會落在第一筆案件的評估預算內。

### 1.1 方言存在哪裡

- **模板與案件**：`WorkflowDefinition.expressionDialect`（與 `meta` 同層的 JSON 欄位，沒有 migration）。**缺少＝`cel-legacy`**，
  這個缺省值永遠不會改，否則會改變進行中案件的路由。案件評估時讀發起當下的 `workflowSnapshot`，模板之後改方言不影響它。
- **新模板預設 `cel-v2`**：後端 `createApprovalTemplate`（`NEW_TEMPLATE_WORKFLOW_DEFINITION`）、設計器的空白定義與 compose wizard
  都帶 `cel-v2`。既有模板保留原本的方言。
- **委派規則**：資料庫欄位 `delegation_rules.scope_condition_dialect`（可回復的 migration，既有列為 `cel-legacy`）。
  `CreateDelegationRuleInput.scopeConditionDialect` 可選，後端缺省 `cel-legacy`，更新時沿用規則原本的方言；
  後台委派頁建立新規則時送 `cel-v2`，列表顯示方言。委派條件依規則自己的方言評估，與案件無關。
- **`EXPRESSION` binding**：沒有方言欄位，一律 `cel-v2`。
- 不認得的方言值：發布時 `workflow-definition.validator.ts` 擋下（`workflow.expressionDialect must be cel-legacy or cel-v2`）；
  評估時回 `EXPRESSION_SYNTAX_ERROR`，不會改用 `cel-legacy` 猜測。可發起清單遇到這種版本只排除該模板並記 warn。

### 1.2 升級方言

一份定義只有一個方言，升級以整份草稿為單位。設計器在升級前呼叫 `previewWorkflowDialectUpgrade`，以
`runExpressionDifferential` 在「欄位都有值」與「欄位都沒填」兩組樣本上比較兩個方言的結果，列出差異（例如 §4.2 的整數除法）。
比較超過 2 秒時回 `complete: false`，不能升級。確認後只改草稿，照常儲存與發布。

---

## 2. 使用點與根識別字

每個使用點有自己的根識別字清單，**不做聯集**。清單定義在 `libs/shared/src/lib/expression-usage-point.ts`
（`EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT`），發布 lint 與評估都依它。

| 使用點 | 位置 | 可用根識別字 |
| --- | --- | --- |
| `INITIATOR_POLICY` | 發起權限 `initiatorPolicyCel` | `env`、`initiator`、`subject` |
| `ENTRY_CONDITION` | 節點進入條件 | `env`、`form`、`formData`、`initiator`、`instance` |
| `APPROVER_RESOLVER` | 簽核人 `EXPRESSION`；cel-v2 的 NOTIFY 收件人運算式也以此檢查 | 同上 |
| `SERVICE_FORM_FIELD_VALUE` | 系統動作 `SET_FORM_FIELD` 的值 | 同上 |
| `WEBHOOK_PAYLOAD` | 服務節點 `WEBHOOK` 的 payload | 同上 |
| `FLOW_CONDITION` | 連線（edge）條件 | 同上，另加 `lastDecision` |
| `DELEGATION_CONDITION` | 委派規則 `scopeConditionCel` | `env`、`form`、`formData`、`initiator`、`instance`、`principal`（沒有 `lastDecision`） |
| `DATA_SOURCE_BINDING`（未發佈） | 選項來源參數的 `EXPRESSION` binding | `form`；表格欄另加 `row` |
| `NOTIFY_WEBHOOK_BINDING`（未發佈） | NOTIFY webhook 參數的 `EXPRESSION` binding | `form` |

各根的內容：

- `env` 只有 `now`（ISO 8601 字串）。
- `initiator` 是發起當下的 member snapshot，並展開 `memberId`；`initiator.roles`、`initiator.org.code` 等取決於宿主提供的內容。
  `subject` 只在發起權限提供，內容與 `initiator` 相同。發起權限在案件建立前評估，沒有 `form`、`formData`、`instance`。
  `initiator.customFields` 預設是 `{}`；宿主要放東西（例如申請人的站別、職等，或先算好的主管名單）有兩條路：
  自己呼叫 `submitApprovalInstance` 時帶完整快照，或註冊 `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER`，讓從 BPM 頁（GraphQL）開的單也有。
  後者的快照在送單那一刻定下，重送不重算；送單時評估的發起權限（`initiatorPolicyCel`）讀的是同一份。
  「可發起範本」列表每次請求也呼叫它一次（`purpose: 'LAUNCHABLE_TEMPLATES'`，沒有範本與表單，`templateId`、`templateVersionId`、`formData` 為 `null`），
  用同一份 `customFields` 評估每個範本的發起權限，所以 resolver 的結果只能依發起人決定，送單與列表要回一樣的值。
  發起頁以 `templateId` 查表單選項時另呼叫一次（`purpose: 'FORM_OPTIONS'`，帶該範本的 `templateId`、`templateVersionId`，`formData` 為 `null`），只評估該範本的發起權限。
  這是唯一可以回不同值的時機：只准宿主後端送審的範本（例如 `has(initiator.customFields.hostSubmitted)`）可以在這裡放行，讓成員查得到選項，但可發起列表與 GraphQL 送單照樣擋下；這份快照只用來判斷，不會存。
  列表呼叫失敗或逾時（10 秒）時不讓整份列表失敗，改用 `customFields: {}` 評估並記 warning：讀到 `initiator.customFields` 的範本會因缺鍵被排除，其他範本照常列出。
  送單則不降級：resolver 失敗、逾時或回傳格式不對，送單一律失敗、不建立案件（見 `docs/api-reference.md` 的 workflow-engine 段）。
  試跑不呼叫它。
  設計器試跑送的範例快照 `customFields` 是 `{}`，讀 `initiator.customFields` 的條件在試跑時的結果會跟實際送單不同。
  resolver 要對範本會讀的每個鍵都給值（值是 `undefined` 的鍵存進去時會被丟掉，之後讀它會丟 `EXPRESSION_MISSING_KEY`），或範本用 `has(initiator.customFields.<key>)` 保護。
  回傳值會存進案件，能讀案件的人都看得到，不要放機密。
- `form` 與 `formData` 相同，是案件的表單資料。
- `instance`：`id`、`state`、`templateId`、`templateVersionId`、`title`；委派條件另有 `nodeId`（被委派任務所在的節點）。
- `principal`：`{ memberId }`，即被代理的人。委派條件沒有 `subject`、`task`、`template`，要用模板請寫 `instance.templateId`。
- `lastDecision`：該 edge 來源節點上最新一筆決策（依 `decidedAt`，跨該節點所有任務）。來源節點沒有決策時是 `null`，
  所以要寫 `lastDecision != null && lastDecision.action == 'APPROVED'`。欄位：`action`（`APPROVED`／`REJECTED`／`RETURNED`／`TRANSFERRED`）、
  `comment`、`decidedAt`、`decidedByMemberId`、`returnToNodeId`、`taskId`、`transferToMemberId`。
  從閘道、服務節點或開始事件出發的連線永遠是 `null`，cel-v2 的 preview 會發 `EXPR_LAST_DECISION_UNAVAILABLE` 警告（§3.3）。
  dry run 同樣提供 `lastDecision`。
- binding 的 `form` 只帶運算式讀到的欄位；`row` 只在表格欄存在，頂層欄位的運算式讀 `row` 會被 lint 擋下，執行期也直接失敗。

context 由呼叫端組出（`workflow-engine.service.ts` 的 `buildWorkflowExpressionContext`、`buildInitiatorPolicyContext`，
`delegation.service.ts` 的 `buildDelegationExpressionContext`）。新增使用點時，要在對應 service 建立 context，並在
`expression-usage-point.ts` 加入它的根清單。評估時呼叫端只把該使用點允許的根交給引擎。`libs/shared/src/lib/condition.ts` 的 `ConditionContextType`、`SubjectContext`、
`InstanceContext`、`LastDecisionContext` 等型別目前沒有任何執行期程式引用，只是形狀草稿，不參與 lint 或評估。

### 2.1 範例

```cel
form.amount > 1000000
form.region in ['TW', 'JP', 'KR']
form.amount > 100000 && initiator.org.code == 'FIN'
'manager' in initiator.roles
lastDecision != null && lastDecision.action == 'RETURNED'
```

只有 `cel-v2` 可用：

```cel
form.email.contains('@example.com')
form.items.exists(row, row.qty > 10)
demo_costBand_v1(form.amount) == "HIGH"
trim(form.vendorName) + "／" + upper(form.paymentType)
```

`demo_costBand_v1` 是 `apps/api` 註冊的示範宿主函式，只存在於 wrapper host。

---

## 3. Lint

### 3.1 cel-legacy

舊方言沒有 AST，lint 原則不變，只檢查：

- 空白、長度上限（2000 字元）、語法（`cel-js` parse）。
- 根識別字：以文字掃描比對該使用點的清單。`has`、`size` 等巨集與 `true`、`false`、`null`、`in` 不算根。
  函式呼叫的名稱也會被當成根，所以 cel-legacy 的式子寫宿主函式會在發布時被擋下（`references unsupported identifier …`）。
- `SET_FORM_FIELD.fieldPath` 的保留片段（`__proto__`、`constructor`、`prototype`），不檢查欄位是否存在。

錯誤訊息格式是 `<label> must not be blank`、`must be N characters or fewer` 等既有字串。不檢查欄位存在性與回傳型別。

### 3.2 cel-v2（未發佈）

`ConditionService.lintExpression` 在 `cel-v2` 下走 AST（`condition/expression-ast.ts`），ERROR 以 `<label>: <code>[ <subject>]` 一行回傳，
`subject` 只會是識別字。順序：先做結構檢查，沒有錯誤才查欄位與函式，再用表單 schema 宣告的欄位型別跑 `env.check()`。
型別檢查用評估時同一個 registry 的環境，宿主函式的引數與回傳也一起檢查。

| 錯誤碼 | 擋下什麼 |
| --- | --- |
| `EXPR_PARSE_FAILED` | 空白或語法錯誤 |
| `EXPR_COMPLEXITY_EXCEEDED` | 超過 2000 字元、AST 超過 200 節點或深度 32 |
| `EXPR_COMPREHENSION_NESTING` | 巨集（`all`、`exists`、`exists_one`、`map`、`filter`）巢狀超過 2 層 |
| `EXPR_ROOT_NOT_ALLOWED` | 根不在該使用點清單內。巨集綁定的名稱只在該巨集內有效；`cel.bind` 不算作用域 |
| `EXPR_WHOLE_FORM_REFERENCE` | 整份引用 `form`，例如 `string(form)` |
| `EXPR_COMPUTED_KEY` | 計算出的鍵，例如 `form["sec" + "ret"]`，以及 map 字面值的非字面鍵 |
| `EXPR_RESERVED_PATH_SEGMENT` | 路徑、map 字面值鍵或 `fieldPath` 含 `__proto__`、`constructor`、`prototype` |
| `EXPR_FIELD_UNKNOWN` | 讀了表單沒有的欄位；`SET_FORM_FIELD.fieldPath` 必須指向已宣告欄位 |
| `EXPR_FIELD_TYPE_MISMATCH` | 欄位型別與用法不符，包括函式引數的型別明確不符（§3.4） |
| `EXPR_RESULT_TYPE_MISMATCH` | 結果型別與使用點不符，例如邊條件回字串 |
| `EXPR_FUNCTION_NOT_REGISTERED` | 呼叫的函式沒有註冊或已下架 |
| `EXPR_FUNCTION_NOT_ALLOWED` | binding 使用點呼叫宿主函式（只允許內建） |

設計器常寫的 `== null`、`== ""`、`== []` 比較在嚴格型別下會失敗，lint 會把對應欄位降成 `dyn` 再查一次。
降級作用於整個運算式，所以函式引數的比對（§3.4）對「就是那個欄位」的引數改用它的 schema 型別。
雙變數巨集（`form.items.all(i, v, …)`）回 `EXPR_ROOT_NOT_ALLOWED v`：評估本來就不支援，所以維持 fail closed。

### 3.3 警告（未發佈）

警告不擋發布，只由 `ConditionService.lintExpressionIssues` 與設計器的 preview、分析回傳。

| 警告碼 | 意思 |
| --- | --- |
| `EXPR_OPTIONAL_FIELD_WITHOUT_HAS` | 讀選填欄位，沒有先用 `has()` |
| `EXPR_OR_ABSORBS_ERROR` | `\|\|` 的一邊可能出錯，cel-v2 會吸收它（§4.2） |
| `EXPR_HAS_NESTED_PARENT` | `has()` 讀巢狀路徑，沒有先確認父層存在 |
| `EXPR_APPROVER_READS_FORM` | 簽核人運算式讀 `form` |
| `EXPR_HIDDEN_FIELD_COPIED` | 把隱藏欄位複製到可見欄位 |
| `EXPR_DIVISOR_IS_FIELD` | 除數是欄位；`double` 除以 0 在 cel-v2 得到 `Infinity`，比較時會靜默變成路由結果 |
| `EXPR_LAST_DECISION_UNAVAILABLE` | 從沒有決策的節點出發的連線讀 `lastDecision`；只由 preview 與 `analyzeWorkflowExpressions` 產生，發布 lint 不產生 |

錯誤碼與警告碼清單是 `@rytass/bpm-core-shared` 的 `EXPRESSION_LINT_ERROR_CODES`、`EXPRESSION_LINT_WARNING_CODES`。
中文與英文訊息只有一份，在 `libs/bpm-core-client/src/lib/template/workflow-lint-errors.ts`，訊息不含 `'; '`。

### 3.4 函式的檢查

- 只有 `…_vN` 形狀的名稱與九個內建名稱交給 registry 的 `assertPublishable`（`isRegistryFunctionName`）；`size`、`has`、`int`、`string`、
  `matches` 等引擎原生函式不交。其他未知名稱直接是 `EXPR_FUNCTION_NOT_REGISTERED`。
- 引數型別：引擎簽章把 `int`／`double` 參數登記成 `dyn`，`env.check()` 本身不會擋 `demo_costBand_v1(form.title)`。
  `env.check()` 通過後，lint 再逐一比對每個 registry 函式呼叫的引數型別與宣告（`findCelV2ArgumentTypeMismatch`），
  明確不符時回 `EXPR_FIELD_TYPE_MISMATCH`（引數只讀一個欄位時 subject 是欄位名）。例如 `demo_costBand_v1(form.title)`、
  `round(form.title)`、`demo_costBand_v1("1000")`、`demo_costBand_v1(null)` 都會被擋。引數型別是 `dyn`
  （表格列的 cell、沒有綁表單）時不擋，留給執行期。
  先判空再呼叫也一樣會擋：`form.title != null && demo_costBand_v1(form.title)` 的判空讓 `title` 在整個運算式降成 `dyn`（§3.2），
  所以引數若正好是被降級的欄位（`form.x`、`formData.x`、`form["x"]`），比對時改用它的 schema 型別。由降級欄位組成的其他引數
  （例如 `form.title + "x"`）仍以 check 給的型別比對，可能是 `dyn` 而留給執行期。
- registry 是宿主程式碼：`get`、`list`、`assertPublishable` 丟錯或回答形狀不對時，lint 只回固定碼，宿主訊息不進 lint 行也不進 log。

### 3.5 何時跑 lint

- **模板發布**：依定義的方言 lint 所有運算式，含 binding 與 NOTIFY 收件人。有 ERROR 就拒絕發布。
- **回滾**：不重跑運算式 lint（舊版本可能過不了後來收緊的規則），只檢查引用的函式仍已註冊，缺少就以 `EXPR_FUNCTION_NOT_REGISTERED` 拒絕。
  已發布的版本與進行中案件也不會被重新 lint。
- **委派規則儲存**：以 `DELEGATION_CONDITION` lint，cel-v2 規則必須回 bool。已存在的錯誤規則不會被改動，執行期評估時仍會失敗。
- **設計器**：preview 與分析即時回傳（§6）。
- **Dry run**：不跑 lint，評估時套用根清單；未知根、缺欄位、逾時、未知方言都回 `valid: false`，只帶 label 與錯誤碼。
  `EXPRESSION_MISSING_KEY` 另附缺少的 key 名稱，但只限式子裡（字串字面值以外）寫出來的識別字；用計算索引（`form.a[form.b]`）時
  引擎回報的是 context 裡的值，這種情況不附名稱。

---

## 4. 兩個方言的差異與限制

141 筆樣式的逐筆差異與判定在 [docs/23](./23-expression-functions-phases.md) P1；語料與結果釘在
`condition/expression-differential.corpus.ts`。以下是寫式子時需要知道的部分。

### 4.1 cel-legacy 的限制

| 寫法 | cel-legacy 的結果 |
| --- | --- |
| 字串方法 `contains`、`startsWith`、`endsWith`、`matches` | 不存在，`EXPRESSION_TYPE_ERROR`。請用 `==`、`in` 或列舉值 |
| `.size()` 方法 | 不存在；全域 `size(x)` 可用 |
| `string(form.qty)`、`int(form.price)` | 不存在，`EXPRESSION_TYPE_ERROR` |
| 對 list **字面值**用巨集：`[1, 2].all(x, x > 0)` | parse 失敗，`EXPRESSION_SYNTAX_ERROR`。對**欄位**用巨集可以：`form.items.exists(row, …)` 兩方言結果相同 |
| map 字面值混用型別：`{"a": "x", "b": 2}`、`{"a": 1, "b": 2.5}` | `EXPRESSION_TYPE_ERROR`。值來自欄位時也一樣，所以 webhook payload 寫 `{"title": instance.title, "amount": form.amount}` 會失敗。同型別的 map 與混合型別的 list 可以 |
| `\|\|` 不短路錯誤 | 一邊出錯整式就失敗，連 `true \|\| form.missing == 1` 也是；表格「為空」條件遇到明確 `null` 會失敗 |
| 字串字面值含 `\"` 或 `\\` | 不解碼跳脫字元，`"x\"y"` 長度是 4；設計器以 `JSON.stringify` 產生的選項值含 `"` 時比對會錯 |
| `3 / form.price` | 把 `3` 當 uint，`EXPRESSION_TYPE_ERROR` |
| `form.amount > 1 == true` | `EXPRESSION_SYNTAX_ERROR` |
| 宿主函式與內建函式 | 發布 lint 的文字根掃描把函式名當成根而擋下。執行期只傳方言的評估點不會擋，舊資料仍會呼叫到 registry（見 §8） |

### 4.2 cel-v2 要注意的行為

| 寫法 | cel-v2 的結果 | 處理 |
| --- | --- | --- |
| `form.missing == 1 \|\| …`、`&&` | 依 CEL 語意吸收一邊的錯誤 | `EXPR_OR_ABSORBS_ERROR` 警告；函式失敗例外，不被吸收（§5.2） |
| `has(form.missing.deeper)` | 父層缺少時 `EXPRESSION_MISSING_KEY`（cel-legacy 回 `false`） | `EXPR_HAS_NESTED_PARENT` 警告 |
| `7 / 2` | 整數除法得到 `3`（cel-legacy 是 `3.5`）。只在兩邊都是 `int`（字面值、`size()`）時發生；表單數字是 `double` | 升級差異檢查會列出 |
| `form.price / form.zero > 1` | `double` 除以 0 得到 `Infinity`，比較會變成 `true`；引擎內建，無法覆寫 | `EXPR_DIVISOR_IS_FIELD` 警告。整數除以 0 是 `EXPRESSION_TYPE_ERROR` |
| map 字面值寫 `__proto__`、`constructor`、`prototype` 鍵 | 引擎建 map 時丟掉這些鍵，不會污染原型 | lint 以 `EXPR_RESERVED_PATH_SEGMENT`／`EXPR_COMPUTED_KEY` 擋下 |
| `2.0 in [1, 2]`、`double % double` | `EXPRESSION_TYPE_ERROR` | fail closed |
| 混合型別 map `{"a": "x", "b": 2}` | 可以 | — |

---

## 5. 執行期

### 5.1 錯誤碼與錯誤淨化

對外只有六個錯誤碼，與 label 一起回傳：`EXPRESSION_SYNTAX_ERROR`、`EXPRESSION_MISSING_KEY`、`EXPRESSION_TYPE_ERROR`、
`EXPRESSION_BUDGET_EXCEEDED`、`EXPRESSION_INVALID_RESULT`、`EXPRESSION_FUNCTION_FAILED`。錯誤是 `ExpressionRuntimeError`
（繼承 `BadRequestException`）。引擎原文與 context 內的值不進錯誤、回應或 log；引擎錯誤只依 `code` 分類，不讀訊息。

- `ConditionService.evaluateBoolean`：空白式子視為 `true`（沒寫進入條件就照常進入）；結果不是 boolean 時丟 `EXPRESSION_TYPE_ERROR`。
  `evaluateValue` 回傳任意 JSON 值。
- 整數除以零：`EXPRESSION_TYPE_ERROR`。超出安全整數範圍：`EXPRESSION_INVALID_RESULT`。
- 未知的非 `_vN` 函式名稱（如 `nope(1)`）、函式引數型別或個數不符：`EXPRESSION_TYPE_ERROR`。

- 缺 key 的錯誤只在名稱是表達式自己寫出來的識別字時才帶 `keyName`；表達式裡只要有以識別字當索引的寫法
  （`form.rates[form.currency]`、`form.m[k]`），一律不帶，因為引擎回報的「缺的 key」可能是經索引讀到的值，
  而它可能剛好等於表達式裡寫過的名稱。只含字面值的索引（`form["a-b"]`、`["a", "b"]`）不受影響。

### 5.1.1 設計器條件與未填欄位（未發佈）

用戶端以 `JSON.stringify` 送出表單，沒碰過的選填欄位**沒有 key**（不是 `null`）。cel-legacy（cel-js 0.8.2）讀到缺的 key
會丟 `Identifier "x" not found`，`!= null` 擋不住，整張單送不出去。

- **設計器編出的條件**（`readConditionExpression`）對識別字 key（`form.x`）加上守衛：`has(form.x) && (form.x != null && …)`，
  右向巢狀，因為 cel-js 0.8.2 的 `||` 不短路、攤平的 `a && b && c` 只有第一個運算元短路。缺 key 與 `null` 視為未填：
  已填寫／等於／大小比較為 `false`，未填寫／不等於為 `true`。大小比較另把 `""` 視為未填；識別字 key 的多選欄位（勾選、多選下拉／搜尋）已填寫／未填寫也把 `""` 視為未填，與成員欄位一致。非識別字 key（`form["a-b"]`）
  無法用 `has()` 守衛，維持原本輸出。這些條件在兩種方言都通過發布 lint，求值結果一致
  （`designer-condition.cel-v2.real-engine.spec.ts`）。
- **已儲存的定義**不會重編，仍帶舊的 CEL。引擎照舊先求值存下來的 CEL；只有它丟 `EXPRESSION_MISSING_KEY` 或
  `EXPRESSION_TYPE_ERROR`、edge 帶有設計器的結構化欄位（`conditionFieldKey` ＋ `conditionOperator`），**且該欄位確實未填**時，
  才改由結構化欄位回答。缺 key 還要求缺的就是該欄位（`keyName` 等於 `conditionFieldKey`）：手改過、還讀了其他 key 的 CEL，
  缺的是那個 key 時照常失敗；型別錯誤不帶 key，欄位未填就退回，但每次記一筆 warn
  （`code=EDGE_STRUCTURED_FALLBACK edge=… field=… reason=EXPRESSION_TYPE_ERROR`，不含值），語意同上（只讀 `formData` 自身的 key）。CEL 能算出結果時一律採用，所以原本能走的路由不變（日期 `"" < "2026-01-01"`
  仍為 `true`）。這只對已發布的定義成立：模板重新存檔並發布後改用新編出的守衛條件，同一個 `""` 會變成 `false`；
  進行中的案件用的是發起當下的快照，不受影響。欄位已填卻仍缺 key 或型別錯誤，代表 CEL 本身有問題（例如手改過 CEL 但結構化欄位還留著，`form.amount > "abc"`），照常報錯；預算超限與函式失敗不會被吸收；沒有結構化欄位的手寫 CEL 照舊失敗。實際執行與試跑共用同一個判斷（`evaluateWithStructuredFallback`）。值是陣列時照舊直接用結構化欄位。

### 5.1.2 未填欄位當 null（`expressionMissingFormFieldsAsNull`，未發佈）

[ADR 27 §3](./27-host-integration-round-adr.md)。`BPMRootModule` 選項，預設關閉，整個 host 一起開。

- 開啟後，運算前依案件的表單快照補齊**頂層**欄位：一般欄位補 `null`，table 補 `[]`；已存在的 key 不動，table 列內的欄不補。
- 補的是運算用的副本，不寫回 `form_data`。
- 套用範圍：案件上的所有流程運算式（進入條件、閘道、指派運算式、WEBHOOK payload、`SET_FORM_FIELD`）、代理規則
  `scopeConditionCel`，以及帶了 `formSchemaJson` 的試跑。通知 webhook 與資料來源的 binding 不在範圍內，維持原本的
  「該次投遞 FAILED」與「WAITING」。

開啟後對未填欄位 `x` 的語意變化（兩種方言相同，`missing-form-fields.real-engine.spec.ts`）：

| 運算式           | 關閉             | 開啟                 |
| ---------------- | ---------------- | -------------------- |
| `has(form.x)`    | `false`          | `true`               |
| `form.x == null` | 缺 key 錯誤      | `true`               |
| `form.x > 5`     | 缺 key 錯誤      | 型別錯誤（仍失敗）   |

既有範本若以 `has(form.x)` 判斷「沒填」，開啟前要先改成 `form.x == null`。

注意：選項關閉時，`form.x != null` **擋不住**缺 key（cel-legacy 丟 `Identifier "x" not found`、cel-v2 丟
`EXPRESSION_MISSING_KEY`），只有 `has(form.x)` 擋得住。

### 5.2 宿主函式與內建函式（未發佈）

- **內建九個**（`BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES`，名稱不帶版本）：`abs`、`ceil`、`floor`、`round`、`min`、`max`、`lower`、`upper`、`trim`。
  數值一律回 `double`；`round` 半數遠離零（`round(-2.5)` 是 `-3`）；`min`／`max` 恰好兩個參數；`lower`／`upper` 不讀 locale；
  全域 `trim(s)` 與 cel-v2 的 `s.trim()` 方法並存。
- **宿主函式**：`BPMExpressionFunction`，欄位 `name`（必須符合 `BPM_EXPRESSION_FUNCTION_NAME_PATTERN`，以 `_vN` 結尾，例如 `erp_costBand_v1`）、
  `label`、`description`、`parameters`、`returnType`、`handler(...args)`。型別限八種（`bool`、`double`、`dyn`、`int`、`list`、`map`、`null`、`string`）。
  以 `BPMRootRuntimeOptions.expressionFunctions` 或 `expressionFunctionsProvider`（`BPM_EXPRESSION_FUNCTIONS`）註冊，兩者合併，
  同名、與內建同名、async／generator handler 都在開機時失敗。沒有註冊時只有內建。
- **執行**：所有評估是 strict mode；引數是深層凍結的副本，handler 改動引數會丟 `TypeError`，`formData` 不變。handler 在評估內執行，
  耗時計入預算。
- **失敗**：函式未註冊或已下架、handler 丟錯、回傳 thenable、回傳非 JSON 或型別不符，一律 `EXPRESSION_FUNCTION_FAILED`，
  handler 的訊息不外流。函式失敗不被 `||`、`&&`、`exists` 吸收：評估中只要有一次呼叫失敗，整次就判失敗；被短路而沒有執行的呼叫不算。
  registry 本身讀不到時，所有式子都回 `EXPRESSION_FUNCTION_FAILED`，失敗不快取。
- **下架**：從宿主移除函式後，引用它的新版本無法發布、也不能回滾到引用它的版本；進行中案件在評估時 fail closed 並回滾，補回後可以繼續推進。

### 5.3 預算與結果正規化

- **時間**：單一式子 100 ms，同一次操作（一個引擎交易、一次 dry run、可發起清單的一個模板、NOTIFY 的一次 enqueue）累計 250 ms。
  耗盡回 `EXPRESSION_BUDGET_EXCEEDED`，不會當成 `false`。parse 與引擎載入在預算外。
  2026-11-07 本機量測一般式子每次約 0.05 ms（重用 vm context 後），量測摘要見 docs/23 P0。
- **結構**：cel-v2 在 parse 時限制 AST 200 節點、深度 32；巨集巢狀最多 2 層由 lint 擋。整次 dry run 另有 2 秒上限。
- **結果**：只接受 JSON 值（深度 32、節點 10000、約 64 KiB）；`undefined`、函式、Promise、class instance、`Infinity` 與超出安全整數的數字
  回 `EXPRESSION_INVALID_RESULT`。例如 cel-legacy 的 `form.constructor` 被拒絕；`form.__proto__` 在 cel-legacy 拿到 `Object.prototype` 本身，
  同樣被拒絕。cel-legacy 的 map 字面值 `{"__proto__": 1}` 建 map 時沒有成為 own key，結果是 `{}`；值是 map 的 `{"__proto__": form.x}`
  會換掉結果的原型而被拒絕。這只檢查最終結果：
  引擎在中間運算已經損失的精度無法偵測（`9007199254740993 - 9007199254740992` 會得到 `0`）。

引擎在各評估點讀哪個方言、交易怎麼回滾，見 [docs/07](./07-workflow-execution.md) §9.2。

---

## 6. 設計器（未發佈）

- **`ExpressionField`**：Mezzanine 的 Textarea 加上插入目錄（Select）、狀態 Badge 與 InlineMessage 顯示 lint 發現，可選樣本試算。
  用在發起權限的「自訂運算式」、節點進入條件、連線的「進階：自訂運算式」（結構化建構器仍是預設）、簽核人「以運算式指定」、
  系統動作「寫入表單欄位」。NOTIFY webhook 參數與表單 Builder 的選項來源參數可以選「運算式」來源。
  插入選單下方逐行列出有說明的函式（「函式名稱（label）：description」），以純文字顯示。
- **瀏覽器不解析 CEL**：只送文字，解析、lint、試算都在後端；`libs/shared` 也不依賴任何 CEL 引擎。
- **後端 API**（全部 `@BPMDesignerOnly()`，非 designer 得到 403）：
  - `previewExpression`：依使用點、方言與表單版本 lint 一個式子；`mode: 'EVALUATE'` 且沒有 ERROR 時再以呼叫端送的樣本試算（不讀真實案件）。
    回傳只有碼。
  - `expressionCatalog`：該使用點可用的根、綁定表單的欄位與函式。registry 讀不到時 `functionsAvailable: false`，不回宿主訊息。
  - `analyzeWorkflowExpressions`：分析整份草稿的運算式與欄位引用，不寫入。
  - `previewWorkflowDialectUpgrade`：方言升級的差異檢查（§1.2）。
- **欄位依賴**：欄位總覽矩陣標示「運算式引用 N」。改名或刪除仍被運算式讀取的欄位會被擋下，不自動改寫；
  分析尚未回來、失敗或 403 時同樣拒絕（cel-legacy 的發布 lint 不檢查欄位存在，這是它唯一的防線）。
- **頁首**：模板的方言併在 ContentHeader 的 description，例如「草稿 v2 · 已發布 v1 · 運算式方言 cel-v2」。
- **AI 助理**：可以寫運算式，但寫入前一律先經後端 lint，有 ERROR 就拒絕。工具 `get_expression_catalog`、`preview_expression`。

---

## 7. `EXPRESSION` binding（未發佈）

DataSource 選項參數與 NOTIFY webhook 參數可以用 `{ kind: 'EXPRESSION', expression }` 綁定（ADR 22 §3.7）。

- 一律 `cel-v2`，只允許內建函式；瀏覽器送來的 expression 或 binding 一律忽略，以儲存的定義為準。
- 發布時必須通過 cel-v2 lint，錯誤行以 binding 位置為 label（`schema.fields[i](.columns[j]).dataSource.bindings[k].from.expression`）。
  運算式讀到的欄位計入循環檢查與 hidden 欄位規則。
- **DataSource**：search、resolve、submit 共用同一個 evaluator（`form-data-source.expression.ts`），結果與 `bindingHash` 相同；
  依賴欄位缺值時不呼叫引擎，回 WAITING 並列出缺的欄位（`waitingForFieldKeys`）。結果必須是字串、有限數字、布林或 `null`。
  預算耗盡回既有的 `FORM_DATA_SOURCE_TIMEOUT`，其他失敗回 `FORM_DATA_SOURCE_INVALID_BINDING`，不寫入 instance。
  依賴改變後，已選的舊值會用新的 binding 重新 resolve，查不到就回 `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED`；
  前端 renderer 在表單**任一欄位**變動約 300 ms 後重查（後端沒有提供依賴欄位清單，`waitingForFieldKeys` 只列缺值的欄位），
  並把失效的舊值標成「已選取的選項已失效，請重新選擇。」。
- **NOTIFY webhook**：在引擎交易內以獨立預算評估。失敗時 delivery 記 `FAILED`（`WEBHOOK_PARAMETER_INVALID`，細節只有錯誤碼），
  審批不回滾。
- 未知的 binding 來源 kind 一律 `FORM_DATA_SOURCE_INVALID_BINDING`，不會落到 `ROW_FIELD`。

---

## 8. 尚未處理的事

| 項目 | 現況 |
| --- | --- |
| cel-legacy 的函式呼叫要開放或關閉 | 待決。發布 lint 擋下，但 workflow-engine 各評估點與委派只傳方言、不傳根清單，沒經過現行發布 lint 的舊資料仍會呼叫到 registry。要關閉需在評估點補根清單，或讓 cel-legacy adapter 對 registry 函式一律 fail closed |
| 評估時的根清單檢查 | 仍是文字掃描，不是 AST；lint 端已是 AST |
| binding 呼叫宿主函式 | v1 只允許內建；放寬是 additive |
| 簽核人運算式保證解出存在的 member | 不保證；解出空集合時執行期拋例外 |
| 編輯器自動完成 | 沒有；目前是插入目錄與即時 lint |
| renderer 只在依賴欄位變動時重查 | 後端沒有提供依賴欄位清單，renderer 在整份表單變動時就重查。建議在 options 與 resolve 結果加 additive 的 `dependencyFieldKeys` |
