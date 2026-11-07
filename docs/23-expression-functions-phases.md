# 23 — 流程表達式開發 Phase

- **狀態**：IMPLEMENTING（2026-11-07 起；細部設計與契約見 [24](./24-expression-functions-detailed-design.md)）
- **規劃日期**：2026-11-07
- **權威決策**：[22 — ADR：流程表達式與宿主函式](./22-expression-functions-adr.md)
- **完成定義**：所有 Phase gate、安全測試、demo seed 場景、E2E matrix 與文件同步完成

每個 phase 可獨立 ship（typecheck／lint／test／build 全綠），phase 間依序相依。狀態機沿用
`PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，VERIFIED 由未參與實作的獨立 verifier 推進。

所有 UI 一律以 `@mezzanine-ui/react` 元件組合，不新增自建元件、不覆寫元件外觀。

## Phase 總覽

| Phase | 交付 | 相依 | 需先確認 | 狀態 |
| --- | --- | --- | --- | --- |
| P0 | 安全修補：錯誤淨化、評估預算、輸出正規化 | 獨立安全修補 | — | IMPLEMENTED（實機 gate 通過） |
| P1 | 方言欄位與候選引擎差異測試 | P0 | 引擎去留 | IMPLEMENTED（實機 gate 通過） |
| P2 | AST lint、欄位依賴、schema 型別檢查 | P1 | — | IMPLEMENTED（實機 gate 通過） |
| P3 | 宿主函式 Registry 與內建函式 | P2 | 內建函式清單 | IMPLEMENTED（P2 整合完成；實機 gate 通過） |
| P4 | 設計器：編輯器、preview、函式目錄、AI 助理 | P3 | UI 設計稿 | IMPLEMENTED（自動化測試通過；實機 gate 待驗） |
| P5 | DataSource／webhook 的 `EXPRESSION` binding | P4 | — | IMPLEMENTED（程式與測試完成；實機 gate 與 P4 整合待做） |

## 獨立安全修補（不依賴本功能，建議先做）

來源：2026-11-07 安全審查。這些是現有程式的問題，不必等 ADR 22 確認。

| 項目 | 位置 | 修法 |
| --- | --- | --- |
| Dry run 指數遍歷阻塞事件迴圈 | `workflow-engine.service.ts:3070` | 整次模擬加時間預算與 visit 上限；超過回 `valid: false`，權限與 schema 不變 |
| 交易內同步 webhook，可佔住案件鎖並耗盡連線池 | `workflow-engine.service.ts:2969`、`:7813`；`workflow-service-task-dispatcher.token.ts:28` | 派送移到交易 commit 之後；預設 dispatcher 加逾時；dispatcher 介面不變 |
| 交易內的委派規則與通知偏好另取連線，約 10 個併發決策就會讓連線池永久死結 | `delegation.service.ts`、`notification.service.ts` | 改走交易的 `EntityManager`；實機以 12 個併發案件驗證 |
| 先取鎖才檢查參與者；資料庫沒有逾時設定 | `workflow-engine.service.ts:968`、`:2188`；`database/typeorm.config.ts:44` | webhook 移出後不再有長時間持鎖，暫不改動；連線與鎖逾時建議由宿主設定 |
| 路徑 C ad-hoc webhook SSRF | `workflow-engine.service.ts:9729` | 套用 `isWorkflowWebhookUrlAllowed`；不接受呼叫者指定 headers；不回寫回應本文 |
| `/api/chat` 未驗證（信心 7/10，取決於 repo 外的部署設定） | `next/workflow-chat-route.ts:100` | 未啟用回 404；驗證 session；過濾 client 的 `system` 訊息；限制長度與輸出 token |

**Gate**：實機以慢速端點驗證案件操作不再被 webhook 卡住，其他案件與登入不受影響。

**狀態（2026-11-07）**：dry run、webhook、連線池三項已實作並通過實機 gate；SSRF 與 `/api/chat` 尚未處理。

## P0 — 安全修補

不新增功能，對既有已發布版本行為不變（錯誤訊息除外）。

**交付**：

- `ConditionService` 淨化引擎錯誤：對外只有錯誤碼與 label，比對不到已知樣式就不抽任何內容。
  這是 hardening：審查確認目前沒有跨越案件讀取邊界，目的是避免值流進 log 或外部通道。
- 檢查所有評估點，確認錯誤沒有另外寫進活動紀錄、通知或 log。
- dry run 評估時套用 root 白名單。
- Runtime 預算：固定腳本 `vm.Script` 加 `timeout`，同時支援單次與單次操作累計。
- 輸出正規化 walker。
- 修正 `docs/05-conditions-cel.md` 的 `contains` 範例，並補上現況限制。

**Gate**：

- 測試：缺欄位錯誤的回應與 log 不含 context 內任何值。
- 測試：巢狀 `map` 在預算內被中斷，回傳穩定錯誤碼，交易回滾，案件狀態不變。
- 測試：`form.constructor` 等非 JSON 結果被拒絕。
- 量測：現有 seed 流程的評估耗時，用來定案預算值。
- 實機：在 `pnpm dev` 下以實際 API 驗證上述錯誤回應與中斷行為。

**狀態（2026-11-07）**：IMPLEMENTED。程式、測試與實機 gate 完成；VERIFIED 待 P0–P5 整體獨立驗證。

| Gate | 結果 |
| --- | --- |
| 缺欄位不外流 | 真引擎測試：`form.missing` 得到 `EXPRESSION_MISSING_KEY`，錯誤、HTTP 回應與 log 都不含 context 值 |
| 預算中斷與回滾 | `cel-legacy` 不支援 `map` 巨集（P1 更正：只是不能對 list 字面值用，見 P1 段），巢狀 `map` 留到 P1 以 `cel-v2` 驗證。P0 以兩種方式代替：真引擎跑一個無巨集的耗時表達式（150 個 list 串接，不設預算約 680 ms），在 100 ms 被中斷、操作累計 250 ms 後一律拒絕；引擎層以不會自己結束的慢 adapter 驗證 `processInstance` 丟 `EXPRESSION_BUDGET_EXCEEDED`、交易回滾、案件沒有前進、`formData` 不變 |
| 非 JSON 結果 | 真引擎：`form.constructor`、`form.toString`、`form.__proto__`（`cel-legacy` 回傳 `Object.prototype` 本身）都得到 `EXPRESSION_INVALID_RESULT` |
| Dry run | 未知 root 不進引擎即回 `valid: false`；逾時與引擎錯誤只回 label 與錯誤碼 |
| 量測 | 見下 |
| 實機 | 通過（2026-11-07，`pnpm dev`＋develop schema，未參與實作的驗證者）：進入條件與邊條件的缺欄位、計算索引 `form.a[form.b]`、型別錯誤，GraphQL 回應只有 label 與 `EXPRESSION_*`，回應、dev log 與活動紀錄都不含表單內的秘密值；失敗後案件、任務、`formData` 與失敗前逐字相同；`cel-legacy` 150 個串接在 104 ms 中斷並回滾；dry run 的未知 root、缺欄位、逾時、未知方言都回 `valid: false` 且不含引擎原文 |

真引擎測試是獨立的 jest project（`libs/bpm-core/jest.real-engine.config.cts`、`*.real-engine.spec.ts`），
由 nx target `bpm-core:test-real-engine` 執行；`bpm-core:test` 相依它，所以 `pnpm test` 與 CI 都會跑。

**量測（2026-11-07，本機，`cel-js` 0.8.2）**：依 runtime 的實際路徑（parse 在預算外，評估包在每次新建的
`vm` context 內）各評估 2000 次。每次的計費時間 = `vm` 包裝 + 評估。

| 語料 | Node 24.22.1 p50／p99／max | Node 20.20.2 p50／p99／max |
| --- | --- | --- |
| seed 唯一的 CEL：委派規則 `form.systemName == "cloud-console"` | 0.24／0.67／2.8 ms | 0.21／0.57／2.5 ms |
| 補充：設計器產生的 15 種樣式與 docs/05 範例（各式中最差） | 0.29／0.92／5.2 ms | 0.19／0.82／8.9 ms |

- seed 只有這一個 CEL（另外兩個 `initiator.memberId`、`instance.title` 是 webhook 的 CONTEXT 路徑，不經引擎）；
  單次操作最多評估它一次，最壞累計約 2.8 ms。補充語料若一次操作評估 10 個，最壞累計 52 ms（Node 24）／89 ms（Node 20）。
- 計費時間幾乎都是 `vm.createContext`：單獨建立 context p50 約 0.13 ms，引擎本身評估只要 1–2 µs。
  max 是單次偶發值（推測為 GC 或 JIT，未逐一確認），p99 都低於 1 ms。
- 判斷：單次 100 ms 是 p99 的 100 倍以上，也高於 3 × p99（細部設計 §9.2 的規則）；累計 250 ms 可容納約 250 次
  一般評估。兩個數值都合理，**維持 ADR 初始值，不回寫 ADR**。
- 限制：seed 只有一個 CEL，代表性低；量測在閒置的開發機，不含負載。負載下的餘裕（ADR §4 的 T11）待實機 gate 一併觀察。

## P1 — 方言與引擎

**交付**：

- `expressionDialect` 型別、parse、snapshot 讀取；委派規則方言欄位與可回復的 migration。
- `cel-v2` 引擎載入（比照 `loadCelEngine` 的延遲載入）、混合數字運算子、bigint 正規化。
- 差異測試工具：同一批表達式與 context，比較兩個方言的結果與錯誤類別。

**Gate**：

- repo 內所有既有表達式樣式都有差異測試結果；差異逐項列在本文件並判定可接受與否。
- 進行中案件在方言缺少時，路由結果與升級前相同。
- **決策點**：差異不可接受時，停用 `cel-v2`，保留 `cel-js`，繼續 P2 的舊方言可行部分與 P3。

**狀態（2026-11-07）**：IMPLEMENTED。程式、測試與實機 gate 完成。沒有判定為不可接受的差異，
**保留 `cel-v2`**（決策點不觸發）；一筆有殘餘風險（P35），交給 P2 的 lint 處理，見下。

| Gate | 結果 |
| --- | --- |
| 所有既有樣式都有差異結果 | 141 筆（SEED 1、DOCS 33、DESIGNER 28、FIXTURE 34、PROBE 45；seed `apps/api/tools/reset-demo-data.ts` 只有一個表達式：流程的邊都是 `data: {}`，`initiator_policy_cel` 全為 null，只有委派規則寫了 `scope_condition_cel`），33 筆不同，逐筆列在下表。語料與每筆的實際結果釘在 `condition/expression-differential.corpus.ts`，由真引擎測試 `expression-differential.real-engine.spec.ts` 比對；新增或改變的差異會讓測試失敗 |
| 缺方言時路由不變 | 真引擎：141 筆不帶方言的結果逐筆等於 `cel-legacy`。引擎層：快照沒有 `expressionDialect` 時只走 cel-legacy adapter，兩種金額走到的節點與明確寫 `cel-legacy` 相同（`workflow-engine.service.spec.ts` 的 `expression dialect`）。委派規則沒有方言（migration 前的列）時同樣走 cel-legacy |
| 巢狀 `map` 在 `cel-v2` 被預算中斷（自 P0 移來） | 真引擎 cel-v2：四層 `map`、每層 60 個元素，超過 100 ms 預算後中斷並回 `EXPRESSION_BUDGET_EXCEEDED`（測試上限 1 s，留給負載高的機器），同一操作後續評估一律拒絕。引擎層（真 cel-v2，非替身）：`processInstance` 丟穩定錯誤碼、交易回滾、沒有任務、案件沒有寫入、`formData` 不變、錯誤不含 context 值 |
| `cel-v2` 支援混合型別 map | 確認：`{"a": "x", "b": 2, "c": [1, "y"]}` 得到 `{a: "x", b: 2, c: [1, "y"]}`（需 `homogeneousAggregateLiterals: false`，預設值會拒絕）；同一式在 `cel-legacy` 是 `EXPRESSION_TYPE_ERROR` |
| 實機 | 通過（2026-11-07）：`expressionDialect: "cel-v2"` 存入定義與案件 snapshot；cel-v2 委派規則的四層巢狀 `map` 在交易內 102 ms 中斷、回 `EXPRESSION_BUDGET_EXCEEDED` 並回滾，同時間其他帳號的登入與查詢正常；`contains` 與混合型別 map 在已發布 cel-v2 模板正常路由；seed 的 cel-legacy 委派規則（`cloud-console`）與缺方言模板路由不變；migration 30000 在 develop 跑過 up → revert → up。**限制**：發布 lint 仍以 `cel-legacy` 檢查根識別字，cel-v2 模板無法發布含巨集綁定名稱的式子（交 P2：發布 lint 傳入方言） |

**實作摘要**：

- 方言：`WorkflowDefinition.expressionDialect?`（shared 型別 `WorkflowExpressionDialect`）、`condition/expression-dialect.ts`
  的 `readExpressionDialect`。缺少＝`cel-legacy`；不認得的值在評估時 fail closed（`EXPRESSION_SYNTAX_ERROR`），但只在真的有表達式要評估時才讀方言：
  沒有發起權限、沒有進入條件的版本不受影響（升級前多出的欄位只會被忽略）。可發起清單遇到發起權限無法評估的方言，只排除該範本並記 warn，
  不讓整份清單失敗。`ConditionService` 的公開 API（`evaluateValue`、`lintExpression`、`prepareEngine`）收到不認得的方言同樣回
  `EXPRESSION_SYNTAX_ERROR`，不改用 cel-legacy。
  發布時擋下未知方言要改 `workflow-definition.validator.ts` 或發布 lint，兩者都不歸 P0／P1（docs/24 §3），交給 P2。
- 評估點：送出與可發起清單的發起權限讀所屬版本的 `workflowDefinition`；節點進入條件、邊條件、簽核人
  `EXPRESSION`、服務節點 payload 與 `SET_FORM_FIELD` 讀 `instance.workflowSnapshot`；dry run 讀草稿，並在預算前
  `prepareEngine(dialect)`；委派規則讀 `scopeConditionDialect`。方言就在評估點從快照讀出，不必經由參數層層傳遞。
- 委派規則：`delegation_rules.scope_condition_dialect`（migration `DelegationScopeConditionDialect0000000030000`，
  既有列為 `cel-legacy`，`down` 在有非 legacy 列時拒絕）；`CreateDelegationRuleInput.scopeConditionDialect` 可選，
  更新時沿用規則原本的方言。
- `cel-v2` adapter：`require` 延遲載入，compile 時載入（compile 在預算外）。環境：`unlistedVariablesAreDyn`、
  `homogeneousAggregateLiterals: false`、parse 期 AST 200 節點／深度 32；註冊雙向 `int`／`double` 的 `+ - * / %`
  （除數為零丟 `EXPRESSION_TYPE_ERROR`，`int` 超出安全範圍丟 `EXPRESSION_INVALID_RESULT`）與精確的 `int == double`。
  引擎錯誤只依 `code` 分類，不讀訊息；`bigint` 結果由既有 walker 正規化。
- Node 20.20.2 以 `require()` 載入 `@marcbachmann/cel-js` 8.0.0 成功（require(esm)）。lockfile 只新增這一個套件，
  沒有其他套件多出副本。

**差異逐項判定**（legacy → cel-v2；`ok:` 為結果，`err:` 為錯誤碼）：

| 編號 | 表達式 | legacy | cel-v2 | 判定 | 理由 |
| --- | --- | --- | --- | --- | --- |
| D06、F27 | `form.email.contains(...)` | `err:TYPE_ERROR` | `ok:true` | 可接受 | 加法；`docs/05` 的範例在 cel-v2 可用 |
| P24、P25 | `startsWith`、`matches` | `err:TYPE_ERROR` | `ok:true` | 可接受 | 加法 |
| F01、F11、P28 | `.size()` 方法、`filter(...).size()` | `err:TYPE_ERROR` | `ok:true` | 可接受 | 加法 |
| P26、P27 | `string(form.qty)`、`int(form.price)` | `err:TYPE_ERROR` | `ok:"3"`、`ok:2` | 可接受 | 加法 |
| P21 | `[1, 2].all(x, x > 0)` | `err:SYNTAX_ERROR` | `ok:true` | 可接受 | 加法：legacy 不能對 list 字面值用巨集 |
| P34 | `form.amount > 1 == true` | `err:SYNTAX_ERROR` | `ok:true` | 可接受 | 加法 |
| D33、P11 | 混合型別 map 字面值 | `err:TYPE_ERROR` | `ok:{...}` | 可接受 | 加法（P1 gate 確認項） |
| D20 | `has(form.missing.deeper)` | `ok:false` | `err:MISSING_KEY` | 可接受 | docs/24 §1 已定案；P2 發 `EXPR_HAS_NESTED_PARENT` 警告 |
| D21、P42 | `form.missing == 1 \|\| ...` | `err:MISSING_KEY` | `ok:true` | 可接受 | docs/24 §1 已定案（CEL 的 `\|\|` 吸收錯誤）；P2 發 `EXPR_OR_ABSORBS_ERROR` 警告 |
| P41 | `true \|\| form.missing == 1` | `err:MISSING_KEY` | `ok:true` | 可接受 | 同上；legacy 連左邊為 `true` 都不短路 |
| G14 | `form.nothing == null \|\| size(form.nothing) == 0`（表格 IS_EMPTY，值為 `null`） | `err:TYPE_ERROR` | `ok:true` | 可接受 | 改善：legacy 的 `\|\|` 不短路，設計器產生的式子遇到明確 `null` 會失敗 |
| G25、P39 | 字串字面值含 `\"`（設計器以 `JSON.stringify` 產生選項值） | `ok:false`、`ok:4` | `ok:true`、`ok:3` | 可接受 | legacy 的 bug：不解碼跳脫字元，`"x\"y"` 長度是 4。只影響含 `"` 或 `\` 的選項值；舊方言行為不變 |
| P06 | `3 / form.price` | `err:TYPE_ERROR` | `ok:1.2` | 可接受 | legacy 的 bug：把 `3` 當 uint，拒絕 uint / double |
| D30–D32 | `form.constructor`、`form.toString`、`form.__proto__` | `err:INVALID_RESULT` | `err:MISSING_KEY` | 可接受 | 兩者都失敗（fail closed），只有錯誤碼不同 |
| P43–P45 | map 字面值寫保留鍵：`{"constructor": 1}`、`{"__proto__": {...}}`、`{"a": 1, "prototype": 2}` | `err:INVALID_RESULT` | `ok:{}`、`ok:{}`、`ok:{"a":1}` | 可接受，**有殘餘風險** | 沒有原型污染：cel-v2 建 map 時就丟掉 `__proto__`／`constructor`／`prototype` 三個鍵（引擎的 `safeFromEntries`），walker 看不到，所以不是 fail closed，而是鍵被靜默丟棄；legacy 保留該鍵，由 walker 拒絕。鍵來自欄位值（`{form.k: 1}`）時同樣被丟棄。拒絕它需要 AST（docs/24 §2.5 歸 P2），交給 P2 lint |
| P08、P09 | `form.price / form.zero`、`form.price / 0.0` 作為結果 | `err:TYPE_ERROR` | `err:INVALID_RESULT` | 可接受 | 兩者都失敗；cel-v2 得到 `Infinity`，由 walker 拒絕 |
| P10 | `form.qty % form.qty`（兩邊都是表單數字） | `ok:0` | `err:TYPE_ERROR` | 可接受 | fail closed；ADR 只要求 `int`／`double` 混合，`double % double` 不在 CEL 規格內 |
| P02 | `2.0 in [1, 2]`（純字面值混合） | `ok:true` | `err:TYPE_ERROR` | 可接受 | fail closed。不註冊混合 `in`：實測註冊後 `form.qty in [1, 2.5]` 會因 overload 重疊在執行期失敗。表單值配字面值 list（P03 `form.qty in [1, 2, 3]`、P37 `form.qty in [1, 2.5]`）兩方言結果相同 |
| P04 | `7 / 2` | `ok:3.5` | `ok:3` | 可接受，列入升級差異檢查 | CEL 規格的整數除法，只在兩邊都是 `int`（字面值、`size()`）時發生；表單數字是 `double`，`form.qty / 2` 相同。P4 的升級差異檢查要列出 |
| P35 | `form.price / form.zero > 1` | `err:TYPE_ERROR` | `ok:true` | 可接受，**有殘餘風險** | 兩邊都是 `double` 時引擎內建 IEEE 除法（`Infinity`），無法覆寫（`registerOperator` 回 `already registered`）。結果會靜默影響路由。只影響明確選用 cel-v2 的定義；建議 P2 對「除數是欄位」發警告，並寫進設計者文件 |

**更正**：P0 的 gate 紀錄與本 phase 的任務說明都寫「`cel-legacy` 不支援 `map` 巨集」。P1 實測：`cel-js` 0.8.2
可以對**欄位**用 `map`／`exists`／`all`（`form.items.exists(row, ...)` 在兩方言結果相同，巢狀四層 `map` 也能跑），
只是不能對 list **字面值**用（`[1, 2].all(...)` parse 失敗），也沒有 `.size()` 方法。P0 以替代方式驗證中斷不受影響。

**交給後續 phase**：

- P2：發布時拒絕未知的 `expressionDialect`（validator 或發布 lint）。發布 lint（`template.service.ts`）仍以 `cel-legacy` 解析，需傳入定義的方言；`ConditionService.lintExpression`
  已接受 `dialect`。root 白名單在 cel-v2 下暫以文字掃描略過巨集綁定名稱與全域函式呼叫（`condition.service.ts`），
  P2 改為 AST。文字掃描把綁定名稱視為整條式子都可用，不限於該巨集內，所以 `[1].exists(lastDecision, true) && lastDecision.d != ""`
  在不允許 `lastDecision` 的使用點仍會通過 lint；評估時 `ConditionService.evaluateValue` 只把允許的 root 交給引擎，
  巨集外的名稱因此是 `EXPRESSION_MISSING_KEY`（真引擎測試釘住）。lint 的漏報由 P2 以 AST 修正。
- P2：cel-v2 map 字面值的保留鍵（P43–P45）在 lint 擋下。鍵來自欄位值（`{form.k: ...}`）時值要到執行期才知道，靜態 lint
  擋不了特定值；能做的是拒絕 map 的非字面鍵（比照 `EXPR_COMPUTED_KEY`）。
- P4：新模板預設 `cel-v2` 的建立入口（設計器、compose wizard、`EMPTY_WORKFLOW_DEFINITION` 沿用的空白定義都不帶方言，
  因此目前新建仍是 `cel-legacy`）；委派規則 UI 的方言選擇；升級差異檢查可直接使用 `runExpressionDifferential`。

## P2 — AST lint

**交付**：

- 複雜度、root、computed key、整體引用、`fieldPath` 保留片段檢查。
- 由表單 schema 宣告 `form` 欄位型別，以 `env.check()` 檢查存在性與回傳型別。
- `referencesFormField`、`referencesTableInternals` 等在 `cel-v2` 改用 AST；舊方言保留 regex。
- 選填欄位缺 `has()`、隱藏欄位複製到可見欄位、簽核人表達式引用 `form` 的警告。

**Gate**：

- 測試：`form["sec"+"ret"]`、`string(form)`、`__proto__` 路徑都在發布時被擋下。
- 測試：既有已發布版本不被重新 lint。
- 前後端 lint 訊息對應完整（`workflow-lint-errors.ts`）。

**狀態（2026-11-07）**：IMPLEMENTED（實機 gate 通過）。程式與測試完成，並已與 P3 整合（見 P3 段末「P2／P3 整合」）；
**實機 gate 未跑**（未在 dev server 上實際發布 cel-v2 模板），所以不是 VERIFIED。`pnpm nx run-many -t typecheck lint test -p shared bpm-core bpm-core-client bpm-core-react api` 通過
（修正獨立驗證發現的那一輪：第一次因 `workflow-engine.service.spec.ts` 的時間預算測試 `accepts a full table of valid values within the budget`
在並行負載下逾時而失敗，該檔本輪未動；同一指令重跑全數通過）。

| Gate | 結果 |
| --- | --- |
| `form["sec"+"ret"]`、`string(form)`、`__proto__` 在發布時被擋下 | 真引擎：`template.service.expression-lint.real-engine.spec.ts` 的 `Phase 23 P2 gate (cel-v2)` 以真 `ConditionService` 走 `publishApprovalTemplateVersion`，分別得到 `EXPR_COMPUTED_KEY`、`EXPR_WHOLE_FORM_REFERENCE form`、`EXPR_RESERVED_PATH_SEGMENT __proto__`；`SET_FORM_FIELD` 的 `fieldPath: "__proto__.polluted"` 同樣被擋，cel-legacy 定義也擋（`__proto__.polluted`、`items[0].constructor`） |
| 既有已發布版本不被重新 lint | 真引擎：rollback 一個發布時會被擋下的版本（computed key）照樣回到 PUBLISHED，`lintExpression`／`lintExpressions` 都沒有被呼叫。rollback 只檢查版本呼叫的宿主函式仍已註冊（`EXPR_FUNCTION_NOT_REGISTERED`），不重新 lint |
| 前後端訊息對應完整 | `workflow-lint-errors.expression.spec.ts`：每個 `EXPR_*` 碼（錯誤 12、警告 6）在 en 與 zh-TW 都翻譯成指名畫布位置的句子，有無 subject 皆然，譯文不含 `'; '` 也不含錯誤碼；未知方言那一行有翻譯 |
| 實機 | 通過（2026-11-07，`pnpm dev`＋develop，未參與實作的驗證者）：cel-v2 模板含 `exists` 巨集、userTask 出邊的 `lastDecision`、SET_FORM_FIELD 發布成功且路由正確；`form["sec"+"ret"]`、`string(form)`、`__proto__` 路徑與 fieldPath、entry condition 以巨集綁定 `lastDecision`、未知欄位、邊條件回字串、未知方言都被擋下，10 行 lint 經 `readWorkflowLintMessage` 都有中文訊息；既有已發布版本的發起與回滾不重新 lint，fork 出的新版本才 lint。設計器畫面上的顯示未以瀏覽器確認（P4 的 E2E 涵蓋）。**發現**：exclusiveGateway 出去的邊沒有決策可讀，`lastDecision` 恆為 null（docs/05 已記載的既有行為），lint 卻放行；寫成 `lastDecision.action == …` 會在執行期 `EXPRESSION_MISSING_KEY`，或被 `&&` 吸收而靜默走預設邊——交 P4 加 lint 警告 |

**實作摘要**：

- 共用契約：`libs/shared/src/lib/expression-usage-point.ts`，九個使用點與各自的 root 清單（docs/24 §2.3）、錯誤碼 12 個、警告碼 6 個
  （docs/24 §2.2 的 5 個，加上 P35 要的 `EXPR_DIVISOR_IS_FIELD`）、`<label>: <code>[ <subject>]` 行格式與解析；subject 只收識別字，
  所以使用者自訂的鍵帶不進 `'; '`。
- AST：`condition/expression-ast.ts` 讀兩種方言（cel-v2 走 `@marcbachmann/cel-js` 的 AST；cel-legacy 走 chevrotain CST），
  輸出 root、欄位路徑、computed key、保留片段、巨集巢狀深度、函式呼叫、`has()` 守衛、`||` 運算元與除數欄位。
  巨集綁定名稱只在該巨集內有效，`[1].exists(lastDecision, true) && lastDecision.d != ""` 在 `ENTRY_CONDITION` 回
  `EXPR_ROOT_NOT_ALLOWED lastDecision`。`cel.bind` **不**視為作用域：評估時的文字 root 掃描會拒絕 `cel`，lint 跟著拒絕，
  發布與評估一致。
- cel-v2 lint（`lintCelV2Expression`）：先做結構檢查（root、整體引用、computed key 含非字面值 map 鍵、保留鍵含 map 字面值、
  巢狀深度；200 節點上限交給 parse 期的 `limit_exceeded`），再查未知欄位與函式（宿主函式經
  `BPMExpressionFunctionRegistry.assertPublishable`，沒注入 registry 時退回 `BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES`；
  binding 使用點呼叫宿主函式是 `EXPR_FUNCTION_NOT_ALLOWED`），沒有錯誤時才用表單 schema 宣告的型別跑 `env.check()`。
  設計器常寫的 `== null`、`== ""`、`== []` 比較在型別檢查下會被拒，對應欄位降為 `dyn` 後重查（最多欄位數輪）。
  呼叫 env 尚未註冊之宿主函式的式子不跑型別檢查，交給 `EXPR_FUNCTION_NOT_REGISTERED`。
- 警告（只經 `ConditionService.lintExpressionIssues` 回傳，不擋發布）：除數是欄位（P35）、`has()` 巢狀路徑缺父層守衛（D20）、
  `||` 吸收錯誤（D21／P41／P42）、選填欄位未經 `has()`、隱藏欄位複製到可見欄位、簽核人表達式讀 `form`。
- 發布：`template.service.ts` 傳入定義的方言；`workflow-definition.validator.ts` 拒絕未知方言
  （`workflow.expressionDialect must be cel-legacy or cel-v2`）。cel-v2 的 `referencesFormField`／表格內部引用改走 AST，
  cel-legacy 保留 regex 與原本的 lint 行。NOTIFY 收件人表達式在 cel-v2 以 `APPROVER_RESOLVER` 使用點檢查。
- `SET_FORM_FIELD.fieldPath`：保留片段（`__proto__`、`constructor`、`prototype`）兩種方言都擋（ADR 22 §5 不變式 #5 不分方言，
  路徑也不是 CEL，docs/24 §1「舊方言沒有 AST」的理由套不上）；「指向已宣告欄位」只對 cel-v2；cel-legacy 不加此檢查
  （2026-11-07 整合定案，docs/24 §1：舊方言 lint 原則不變）。執行期寫入建立的是自有屬性，不會污染全域原型。
- cel-v2 的發布行與 preview 共用同一組錯誤碼：空白回 `EXPR_PARSE_FAILED`、超長回 `EXPR_COMPLEXITY_EXCEEDED`。cel-legacy 仍回
  `<label> must not be blank`／`must be N characters or fewer`；未知方言在 `lintExpression` 仍回 `<label>: EXPRESSION_SYNTAX_ERROR`
  （發布時已先被 validator 以 `workflow.expressionDialect must be cel-legacy or cel-v2` 擋下）。
- 使用點不是九個之一時（含 `toString`、`__proto__` 等原型鍵）不拿去索引：兩種方言都視為不允許任何 root、cel-v2 也不允許宿主函式，
  回 lint 結果而不丟 `TypeError`。P4 的 previewExpression 若從客戶端帶入使用點可直接依賴。
- 雙變數 comprehension（`form.items.all(i, v, v.qty > 0)`）的 `v` 會被報成 `EXPR_ROOT_NOT_ALLOWED v`：訊息不精確，但評估本來就拒絕
  這種寫法（`EXPRESSION_SYNTAX_ERROR`），lint 放行反而會發布每次都失敗的定義，所以維持 fail closed。
- 已知限制：評估時的 root 白名單仍是文字掃描（P0／P1 範圍）。
- **P3 必讀（硬性時序）**：`@marcbachmann/cel-js` 的 `clone()` 會把來源 env 的 registry 鎖住（`registry.js` 的 `#locked`），
  lint 的型別檢查第一次 clone 共用 env（`loadCelV2Environment()`）之後，再對它 `registerFunction` 會丟
  `Cannot modify frozen registry`；只做 parse 或評估不會凍結。所以 P3 的函式必須在建立共用 env 時（adapter 的
  `createEnvironment`）就註冊，或由 adapter 另外匯出 env factory 讓 lint 自建 base env。`expression-ast.shared-environment.real-engine.spec.ts`
  釘住了這個行為。

## P3 — 宿主函式

**交付**：

- `BPMExpressionFunction` contract、registry token、`BPMRootModule` 選項，未註冊時為空。
- 註冊驗證：命名、拒絕 async、參數與回傳型別。
- 引數複製與凍結、thenable 檢查、回傳驗證、錯誤隔離。
- 內建純函式。
- `apps/api` 示範函式，僅屬 wrapper host。
- 發布 lint 檢查函式與版本是否註冊。

**Gate**：

- 測試：async handler 註冊失敗；回傳 Promise 的 handler 評估失敗。
- 測試：handler 改動引數會丟錯，`formData` 不變。
- 測試：handler 訊息不出現在 API 回應。
- 測試：函式下架後，引用它的新版本無法發布，進行中案件 fail closed。
- `docs/api-reference.md` 同步。

**狀態（2026-11-07）**：IMPLEMENTED（實機 gate 通過）。registry、內建函式、兩個方言的評估接線與 `apps/api` 示範函式完成；
整合輪（見本段末「P2／P3 整合」）讓 `ConditionService` 注入 registry、發布 lint 與回滾經 `assertPublishable` 檢查，
端到端 gate 以真 cel-v2 adapter 通過。實機（2026-11-07）通過：`demo_costBand_v1`、`upper`、`round` 用在邊條件與 SET_FORM_FIELD，發布、發起、推進結果正確；移除該函式並重啟 api 後，停在評估前的案件回 `EXPRESSION_FUNCTION_FAILED`，案件、任務、token、`formData` 與推進前相同，發布新版本與回滾都被 `EXPR_FUNCTION_NOT_REGISTERED` 擋下；還原後同一案件可繼續推進。失敗回應與 log 不含表單秘密值。**發現**：api 重啟後第一次評估 `elapsedMs=90`，接近 100 ms 預算（熱路徑約 1 ms），部署後首筆案件有逾時風險——交下一波在開機時預熱引擎。handler 丟錯的訊息不外流只在引擎層測試驗證，實機未觸發。

| Gate | 結果 |
| --- | --- |
| async handler 註冊失敗 | `async`、generator、async generator handler 在註冊時被拒，`forRoot` 與 `forRootAsync` 都在開機時失敗（`bpm-root.module.boot.spec.ts`）。錯誤訊息寫出函式名與原因 |
| 回傳 Promise 評估失敗 | 真引擎兩方言：`EXPRESSION_FUNCTION_FAILED`。被拒的 native Promise 經內建的 `Promise.prototype.then` 掛上處理函式，不會變成 unhandled rejection，Promise 自己掛的 `then` 不會被呼叫；外來 thenable 不 adopt，評估中與評估後都不呼叫它的 `then`（獨立驗證發現：原本 `Promise.resolve(raw)` 會在評估結束後的 microtask 呼叫 `then`，不受預算限制，已修正） |
| 改動引數丟錯、`formData` 不變 | 真引擎兩方言：handler 寫入凍結的引數時丟 `TypeError`（測試讓 handler 先記下再重丟），評估得到 `EXPRESSION_FUNCTION_FAILED`，原 `formData` 與快照逐值相同 |
| handler 訊息不外流 | 真引擎兩方言：錯誤訊息只有 `entry: EXPRESSION_FUNCTION_FAILED`，`getResponse()` 與所有 log 都不含 handler 訊息；log 只有 `function=<name> code=… reason=…`。**整合後端到端**：`workflow-engine.service.spec.ts` 的 `host functions (Phase 23 P3 gate)` 以帶 registry 的 `ConditionService` 走 `processInstance`（真 cel-v2 adapter；該 jest project 只替換 cel-legacy 的 `cel-js`），handler 丟出含秘密字串與表單秘密值的錯誤，式子是 `erp_leaky_v1(...) == "HIGH" \|\| true`：`ExpressionRuntimeError` 的 message、`getResponse()`（GraphQL 回應的來源）與全部 Logger 輸出都不含兩者，結果是 `EXPRESSION_FUNCTION_FAILED`，交易回滾、案件不前進 |
| 下架後 fail closed | runtime 層：registry 少了某個 `…_vN` 函式時，引用它的式子在兩方言都得到 `EXPRESSION_FUNCTION_FAILED`，引擎不會執行，所以位置在不會走到的分支（`true \|\| f_v1(...)`）也一樣。**整合後**：引擎層 `processInstance` 對已發布版本（`true \|\| erp_band_v1(...)`）丟 `EXPRESSION_FUNCTION_FAILED`、交易回滾、沒有任務、案件沒寫入、token 沒越過 gateway；發布層（`template.service.expression-lint.real-engine.spec.ts` 的 `Phase 23 P3 gate`，同一個真 `StaticBPMExpressionFunctionRegistry` 同時交給 `TemplateService` 與 `ConditionService`）下架後發布新版本與回滾到引用它的版本都被 `EXPR_FUNCTION_NOT_REGISTERED erp_band_v1` 擋下，未下架時兩者都通過；回滾時 registry 丟含秘密字串的錯也只回固定碼 |
| registry 接線（整合） | `bpm-root.module.boot.spec.ts`：`forRoot` 與 `forRootAsync` 開機後，容器裡每一份 `ConditionService` 拿到的都是 `BPM_EXPRESSION_FUNCTION_REGISTRY` 那一份，並實際以 cel-v2 呼叫宿主函式成功 |
| async 判定不可繞過（整合） | 改看原型鏈（三個 intrinsic prototype，bound 函式亦同），tag 檢查保留給跨 realm；async、generator、async generator 各自設 own `Symbol.toStringTag = 'Function'` 仍被拒（`expression-function.registry.spec.ts`）。**整合驗證補強**：再以 `Object.setPrototypeOf(fn, Function.prototype)` 移走原型時兩項都會通過，現在先看 `node:util` 的 `types.isAsyncFunction`／`isGeneratorFunction`（引擎層的函式種類，改原型與 tag 都改不了，跨 realm 也有效），三種各自「改原型＋改 tag」都被拒。殘留：`util.types` 看不穿 `bind`，bound 的 async 函式再改原型與 tag 仍會被接受；它回傳 Promise，執行期的 thenable 檢查會判 `EXPRESSION_FUNCTION_FAILED`（fail closed；`condition.service.functions.real-engine.spec.ts` 兩方言釘住現況） |
| `docs/api-reference.md` 同步 | 完成 |

**實作摘要**：

- Registry：`StaticBPMExpressionFunctionRegistry`（內建 + 宿主，建構時驗證）、`EmptyBPMExpressionFunctionRegistry`（只有內建）、
  `BUILT_IN_EXPRESSION_FUNCTION_REGISTRY`。驗證：命名 regex、拒絕內建名稱與重名、拒絕以 `true`／`false`／`null` 開頭的名稱（`cel-js` 0.8.2 的 lexer 先把這段讀成關鍵字，cel-legacy 永遠呼叫不到；真引擎測試釘住）、拒絕 async／generator handler、
  參數與回傳型別在八種之內、參數名不重複、label／description／參數清單必填。錯誤是一般 `Error`，不新增錯誤碼。
  cel-v2 內建的全域函式名稱都沒有 `_vN` 後綴，所以命名 regex 也避開了與引擎內建衝突。
- 模組：`ExpressionFunctionModule`（global）提供 `BPM_EXPRESSION_FUNCTION_REGISTRY`；`BPMRootRuntimeOptions.expressionFunctions`
  與 wiring 選項 `expressionFunctionsProvider`（`BPM_EXPRESSION_FUNCTIONS`）**合併**，同名開機失敗。未註冊時只有內建。
- 內建九個函式：數值一律回 `double`（兩方言一致；cel-v2 靠 P1 的 `int == double` 與混合運算子比較與相加）；
  `round` 半數遠離零（`round(-2.5)` 為 `-3`）；`min`／`max` 恰好兩個參數；`lower`／`upper` 不讀 locale；
  全域 `trim(s)` 與 cel-v2 既有的 `s.trim()` 方法並存。真引擎測試確認 cel-v2 沒有同名的全域內建。
- 執行期（`condition/expression-function-invocation.ts`，兩方言共用）：引數經 walker 複製並深層凍結（cel-v2 的 `int` 轉成 number）；
  引數型別不符、非 JSON、超過 64 KiB 或個數不對是 `EXPRESSION_TYPE_ERROR`（呼叫端的型別錯誤，與引擎 overload 不符同碼）；
  handler 丟錯（包括 handler 自己丟 `ExpressionRuntimeError`）、回 thenable、回非 JSON 或型別不符是 `EXPRESSION_FUNCTION_FAILED`；
  handler 在評估內執行，耗時計入預算，跑不完會被中斷成 `EXPRESSION_BUDGET_EXCEEDED`。
- **函式失敗不被吸收**：cel-v2 的 `\|\|`、`&&`、`exists` 依 CEL 會吸收錯誤（docs/24 §1）。實測 `throws_v1(1) \|\| true` 在引擎裡得到 `true`，
  所以評估結束後只要有函式失敗，就整次改判 `EXPRESSION_FUNCTION_FAILED`。被短路而沒有執行的呼叫不算失敗。
- cel-v2 環境：base 環境（選項、限制、混合運算子）只建一次，每個 registry clone 一份再註冊函式，以 `WeakMap` 快取，建好後凍結。
  `loadCelV2Environment(registry?)` 給 P2 做 `env.check()`：`clone()` 後再 `registerVariable`。`int`／`double` 參數在簽名寫成 `dyn`
  （實測宣告 `double` 會拒絕 `f_v1(1000)`），由執行期檢查數字；其他型別由引擎的 overload 檢查。宣告 `int` 的回傳以 `bigint` 交給 cel-v2
  （實測回 JS number 時 `ret_v1(1) == 5` 是 `false`）。
- **cel-legacy 可以註冊函式**（真引擎實測）：`cel-js` 0.8.2 的 `evaluate` 第三個參數是函式表，全域呼叫會查它。兩方言都註冊同一份 registry。
  但 `condition.service.ts` 的 cel-legacy 文字 root 檢查會把函式名當成 root，只要使用點有白名單，呼叫在進引擎前就被擋成
  `EXPRESSION_SYNTAX_ERROR`（測試釘住現況）。**更正（整合驗證，2026-11-07）**：原文寫「正式路徑都有」白名單，不正確——
  workflow-engine 的正式評估點與 `delegation.service.ts` 只傳 `dialect`，見「P4／P5 交接」的 cel-legacy 函式條目。要讓 cel-legacy 真正可用，需 P2 調整該檢查；cel-legacy 沒有 AST，發布 lint 的函式檢查也要另想辦法
  （adapter 內已有讀 CST 全域呼叫名稱的小工具可參考）。
- `ExpressionRuntime.withFunctions(registry)` 依 registry 建立並快取 runtime；`new ExpressionRuntime()` 仍是只有內建的預設 adapter。
- `apps/api` 示範函式 `demo_costBand_v1(amount)`：`LOW`／`MEDIUM`／`HIGH`，只屬 wrapper host。

**交給後續 phase（P3 當時的紀錄；P2 項已在整合輪完成，見下）**：

- P2：`ConditionService` 以可選 DI 注入 `BPM_EXPRESSION_FUNCTION_REGISTRY` 並改用 `ExpressionRuntime.withFunctions(registry)`；
  lint 的 cel-v2 解析改用 `parseCelV2(expression, registry)`；發布與回滾呼叫 `assertPublishable`。之後補端到端 gate（API 回應不含 handler 訊息、
  進行中案件 fail closed 並回滾、下架後新版本無法發布）。
- P2：cel-legacy 是否開放函式（root 文字檢查、發布 lint）需要決定；未開放前，cel-legacy 的呼叫在正式路徑一律是 `EXPRESSION_SYNTAX_ERROR`。
  （**更正**：「正式路徑一律」不成立，見「P4／P5 交接」的 cel-legacy 函式條目。）
- 主線決定（契約偏離，獨立驗證指出）：
  1. docs/24 §2.1 寫「函式未註冊…一律 `EXPRESSION_FUNCTION_FAILED`」；實作只對 `…_vN` 形狀的名稱這樣判，其他未知名稱（如 `nope(1)`）維持引擎原本的 `EXPRESSION_TYPE_ERROR`。理由：差異語料與既有斷言不必變動，下架的宿主函式仍 fail closed。建議修訂 §2.1 的字面（「宿主函式形狀的名稱未註冊或下架」）。**已定案**，見 docs/24 §2.1（2026-11-07 整合定案）。
  2. docs/24 §1 接受 cel-v2 `||`／`&&` 吸收錯誤；實作在有函式失敗時整次改判 `EXPRESSION_FUNCTION_FAILED`（被短路而沒執行的呼叫不算）。這是 §1 的例外，只限函式失敗，偏向 fail closed；建議回寫 §1 或 ADR 22 §3.5。**已定案**，見 docs/24 §1 與 §2.1（2026-11-07 整合定案）。
- 既有問題（非本線引入）：`cel-js` 以一般物件查函式名，`constructor(1)` 會查到原型上的成員。帶白名單的呼叫端被 root 檢查擋下，walker 也會拒絕非 JSON 結果。
  **更正（整合驗證，2026-11-07）**：workflow-engine 的評估點不帶白名單，只靠發布 lint 擋；真引擎實測不帶白名單時
  `constructor(1)` 是 `EXPRESSION_INVALID_RESULT`（walker 拒絕），`toString()` 則回字串 `"[object Undefined]"`（不含案件資料）。

### P2／P3 整合（2026-11-07）

主線決定的契約寫回 docs/24（標「2026-11-07 整合定案」）：未知的非 `_vN` 名稱與引數型別／個數不符維持 `EXPRESSION_TYPE_ERROR`；
函式失敗不被 `||`／`&&`／`exists` 吸收；cel-legacy 的 `fieldPath` 只檢查保留片段；警告碼補 `EXPR_DIVISOR_IS_FIELD`；
P2 對 `condition.service.ts` 與 `libs/shared/src/index.ts` 的改動核可。

- `ConditionService`：`@Optional() @Inject(BPM_EXPRESSION_FUNCTION_REGISTRY)`，runtime 是 `ExpressionRuntime.withFunctions(registry)`；
  沒注入時是內建 registry，仍走共用的預設 adapter。`new ConditionService()` 照常可用（只有內建）。`prepareEngine` 在預算外建好
  該 registry 的 cel-v2 環境與 cel-legacy 函式表。lint 沒給 `functionRegistry`（或給 `null`）時用 service 的 registry。
- 型別檢查：cel-v2 lint 的解析與 `env.check()` 改用 `loadCelV2Environment(registry)` 的 clone，宿主函式的引數與回傳也被檢查
  （例：`ENTRY_CONDITION` 寫 `erp_band_v1(form.amount)` 得到 `EXPR_RESULT_TYPE_MISMATCH`）。只提供可用性（`assertPublishable`／`get`）
  的 registry 不拿來建環境。凍結時序：每個環境建立時就註冊完並凍結，之後只被 clone；
  `condition.service.functions.real-engine.spec.ts` 以 `jest.isolateModules` 從冷快取跑「先 lint 後評估」與「先評估後 lint」兩種順序，
  之後再開第二個 registry，都沒有 `Cannot modify frozen registry`。
- 函式名稱規則：`isRegistryFunctionName`（`_vN` 形狀或九個內建）是發布 lint、回滾檢查（`readUnavailableExpressionFunctions`）
  與執行期 `callsUnavailableFunction` 共用的一套。引擎原生函式不交給 `assertPublishable`；其他未知名稱 lint 直接回
  `EXPR_FUNCTION_NOT_REGISTERED`，執行期是 `EXPRESSION_TYPE_ERROR`。執行期也因此把「自訂 registry 少了內建函式」判成
  `EXPRESSION_FUNCTION_FAILED`（原本只看 `_vN`；標準 registry 一定含內建，行為不變）。
- registry 隔離：`get`／`list`／`assertPublishable` 丟錯或回傳不合形狀，lint 回固定碼，log 只有
  `code=EXPR_FUNCTION_NOT_REGISTERED reason=<固定字>`；以含秘密字串的錯誤測試 lint 行、`BadRequestException` 回應與 log。
- 委派：`scopeConditionCel` 以 `usagePoint: 'DELEGATION_CONDITION'` lint（保留原 root 白名單，兩者相同），cel-v2 規則必須回 bool，
  可呼叫 registry 的宿主函式。
- `runExpressionDifferential(testCase, service)` 本來就接受 `ConditionService`（預設仍是只有內建）；差異語料（141 筆）以帶 registry
  的 service 重跑，結果與釘住的值逐筆相同（`expression-differential.real-engine.spec.ts`）。
- 驗證：`pnpm nx run-many -t typecheck lint test build -p shared bpm-core bpm-core-client bpm-core-react api` 第一次即全數通過
  （shared 418、bpm-core-client 270、bpm-core 真引擎 9 個 suite／774、bpm-core-react 683、bpm-core 91 個 suite／1918、api 44 個測試；lint 0 錯誤，只有既有檔案的警告）。

**刻意改變的既有斷言**：`expression-function.real-engine.spec.ts` 的 `through ConditionService (built-ins only until P2 wires the registry)`
改寫為 `through ConditionService`：原本釘住 `ConditionService` 只有內建；改為帶 registry 時可呼叫宿主函式、沒有 registry 或下架時
`EXPRESSION_FUNCTION_FAILED`、非 `_vN` 未知名稱 `EXPRESSION_TYPE_ERROR`、handler 訊息不外流。內建在 cel-v2 可呼叫、cel-legacy 仍被
文字 root 檢查擋成 `EXPRESSION_SYNTAX_ERROR` 兩條保留。其餘既有斷言都沒有改。

### P4／P5 交接

- **實機 gate（主線）**：P2 與 P3 的實機都沒跑。在 `pnpm dev`＋develop 上：發布含巨集綁定名稱、`lastDecision`、`fieldPath` 的 cel-v2
  模板；發布含 computed key 與未知方言的定義並看設計器中文訊息；以 `apps/api` 的 `demo_costBand_v1` 發布、走案件、從宿主移除後確認
  進行中案件回 `EXPRESSION_FUNCTION_FAILED` 且回滾、新版本與回滾都被擋。
- **P4 preview／catalog**：`ConditionService.lintExpressionIssues` 已帶 registry（型別檢查含宿主函式），preview 直接呼叫即可；
  客戶端帶入的使用點不是九個之一時 fail closed。函式目錄用 `BPM_EXPRESSION_FUNCTION_REGISTRY.list()`；registry 是宿主程式碼，
  catalog 讀取也要比照 lint 隔離（丟錯或形狀不對時不回宿主訊息）。
- **P4 升級差異檢查**：`runExpressionDifferential(testCase, conditionService)` 要傳入注入的 service 才含宿主函式。cel-legacy 的函式呼叫
  在帶白名單的評估仍被文字 root 檢查擋下（`EXPRESSION_SYNTAX_ERROR`），差異檢查帶白名單時會把它列成差異；workflow-engine 的
  正式評估點不帶白名單（見下方 cel-legacy 函式條目）。
- **P4 新模板預設 cel-v2**：仍未做（建立入口不帶方言，見 P1 交接）。
- **cel-legacy 函式**：發布端未開放，執行期**沒有**全面擋下（整合驗證更正，2026-11-07；原文「正式路徑一律
  `EXPRESSION_SYNTAX_ERROR`」不正確）。實際行為：
  - 發布 lint：文字 root 檢查把函式名當成 root，`erp_band_v1(...)` 回 `references unsupported identifier erp_band_v1`；
    以巨集綁定同名的寫法（`form.tags.exists(erp_band_v1, true) && erp_band_v1(...)`）同樣被擋（cel-legacy 的掃描不略過綁定名稱）。
  - 評估：只有呼叫端帶 `allowedRootIdentifiers` 時才在進引擎前擋成 `EXPRESSION_SYNTAX_ERROR`。workflow-engine 的正式評估點
    （initiator policy、entryCondition、approver resolver、`SET_FORM_FIELD` 的 payload／value；`readExpressionDialectOptions` 只回
    `{ dialect }`）與 `delegation.service.ts` 的 `scopeConditionCel` 都只傳 `dialect`，所以 cel-legacy 式子會照樣呼叫注入 registry 的
    宿主函式（與內建）。只有沒經過現行發布 lint 的資料（lint 上線前已發布的版本、直接寫入 DB 的定義或委派規則）會走到。
  - 現況由 `condition.service.functions.real-engine.spec.ts` 的 `cel-legacy host function calls (current behaviour, not a design goal)` 釘住：
    只傳方言時 handler 被呼叫且結果為 `true`；帶白名單時 `EXPRESSION_SYNTAX_ERROR` 且 handler 未被呼叫；lint（直接呼叫與巨集同名兩種）回 unsupported identifier。
  - 待決（P4／P5，屬新決策）：要真正「不開放」，需在 workflow-engine 各評估點與委派補 `allowedRootIdentifiers`，或在 cel-legacy
    adapter 對 registry 函式呼叫一律 fail closed；後者會改變既有釘住的 cel-legacy 函式斷言（下架、`throws_v1(1) || true`、`has(...)`）。
    要開放則需改文字 root 檢查與 cel-legacy 的發布 lint。
- **P5 binding**：`DATA_SOURCE_BINDING`／`NOTIFY_WEBHOOK_BINDING` 只允許內建（`EXPR_FUNCTION_NOT_ALLOWED`）；binding 的評估與 lint
  要走注入 registry 的 `ConditionService`，不要另建 `new ConditionService()`，否則 lint 與評估看到的函式不一致。
- **registry 異常的隔離（整合驗證已處理，2026-11-07）**：原為已知限制——注入的 registry `list()`／`get()` 丟錯時，評估與
  `prepareEngine` 會把宿主的原始 `Error`（含訊息）往上丟，`get()` 回傳形狀不對時是原始 `TypeError`。現在
  `readExpressionFunctionTable` 是唯一讀 registry 的地方，`list()`／`get()` 丟錯，或回答形狀不對（不是陣列、名稱不是函式名形狀或重複、
  列出的名稱 `get` 回 `null` 或別的函式、沒有 handler、參數或回傳型別不在八種之內）時，兩方言的評估與 `prepareEngine` 都回
  `ExpressionRuntimeError('EXPRESSION_FUNCTION_FAILED')`（`prepareEngine` 的 label 是 `expressionFunctions`；依
  `readDryRunFailureMessage` 的對應，dry run 會顯示 `expressionFunctions: EXPRESSION_FUNCTION_FAILED`，原本是 `Dry run failed`——推得、未測）；log 只有 `code=EXPRESSION_FUNCTION_FAILED reason=registry-threw|registry-shape`，
  不含宿主訊息。cel-v2 在編譯時建環境，`ExpressionRuntime.compile` 把這個已分類的失敗同樣對應成 `ExpressionRuntimeError`；引擎本身
  載入失敗仍是設定錯誤，原樣往上丟。registry 壞掉時**所有**式子都 fail closed（含沒有函式呼叫的式子），與 lint 端一致。失敗不快取，
  下一次評估會重讀 registry；讀到的函式是凍結的副本。lint 端讀同一個 reader，所以 lint 時除了既有的
  `code=EXPR_FUNCTION_NOT_REGISTERED reason=…` 之外會多一行上述 log。驗證：`condition.service.functions.real-engine.spec.ts` 的
  `at evaluation and prepareEngine`（七種異常 × 兩方言評估 × 兩方言 `prepareEngine`，錯誤、`getResponse()` 與 log 都不含秘密字串）與
  `reads the registry again once it answers`。

## P4 — 設計器

**交付**：

- 表達式編輯欄位：語法與 lint 回饋、可用欄位與函式目錄。
- `previewExpression`、`expressionCatalog`（皆 `@BPMDesignerOnly()`）。
- 模板方言升級流程與差異提示。
- AI 助理工具與系統提示更新。
- 欄位總覽矩陣標示表達式依賴。

**Gate**：

- 實機：在設計器撰寫、preview、發布、發起案件，走完 `contains` 與宿主函式兩條路徑。
- 測試：非 designer 呼叫 preview 與 catalog 得到 403。
- E2E：表單填入 `<img src=x onerror=...>`，經表達式寫入欄位後，在案件詳情、通知抽屜都以文字顯示。
- `apps/client` 補 CSP 與 `nosniff`，驗證 PDF 預覽與 `form-pattern-worker` 的 blob worker 仍可運作。

### P4 實作結果（2026-11-07，待實機 gate）

- **設計器**：`ExpressionField`（Mezzanine Textarea＋Select 插入目錄＋Badge 狀態＋InlineMessage 發現，可選樣本試算）接上 E1 發起權限「自訂運算式」、E2 節點進入條件、E3 連線「進階：自訂運算式」（結構化建構器仍為預設）、E4 簽核人「以運算式指定」、E5 系統動作「寫入表單欄位」獨立編輯器（NOTIFY 選擇器不再能覆寫它）。瀏覽器只送文字，解析、lint、試算都在後端。
- **後端**（`template/`）：`previewExpression`、`expressionCatalog`、`analyzeWorkflowExpressions`、`previewWorkflowDialectUpgrade`，全部 `@BPMDesignerOnly()`（非 designer 403，有 guard 與存取測試）。分析與升級比對讀設計器送來的草稿，不寫入。catalog 隔離 `registry.list()` 失敗（`functionsAvailable: false`，固定 log code）。
- **方言**：新範本（後端 `createApprovalTemplate`、設計器 fallback、compose wizard）預設 `cel-v2`；既有範本保留方言。整份草稿升級前以 `runExpressionDifferential`（注入 `ConditionService`）在「欄位都有值／都沒填」兩組樣本比對，列出差異（P04 `7 / 2` 會列出），逾時（2 秒）時 `complete: false` 不能升級；確認後只改草稿，照常儲存。
- **委派**：client 讀寫 `scopeConditionDialect`，新規則送 `cel-v2`，列表顯示方言；後端預設仍為 `cel-legacy`。
- **欄位依賴**：欄位總覽矩陣標示「運算式引用 N」；設計器內編輯表單時，改名或刪除仍被運算式讀取的欄位會被擋下。比對基準是「上次套用的表單」（抽屜編輯的是另一份工作副本，取消或關閉即丟棄，發布也只送套用過的版本）；引用以套用當下的草稿向後端查詢，分析尚未回來、請求失敗或 403 時**拒絕**改名／刪除（fail closed）——cel-legacy 的發布 lint 不檢查欄位存在，這是它唯一的防線。（獨立驗證發現第二次編輯可繞過、分析缺席時放行，已修正。）
- **lint**：新增警告 `EXPR_LAST_DECISION_UNAVAILABLE`（非簽核節點出發的連線讀 `lastDecision`），由 P4 的 preview／analysis 產生。
- **AI 助理**：新增 `get_expression_catalog`、`preview_expression` 查詢工具；寫入運算式的工具呼叫先經後端 lint，ERROR 即拒絕，沒有注入 lint 也拒絕。工具呼叫改為依序執行，lint 期間畫布被改動則不套用。系統提示加入運算式規則（線上與離線共用）。
- **`/api/chat`**：未啟用回 404、可選 `authorize` 掛點（401）、過濾 client 的 `system` 訊息、限制請求大小（1 MiB）、訊息數（200）與輸出 token（4 096）。請求大小在讀取時就逐塊計算，沒有 `Content-Length` 的 chunked 請求超過上限即中止讀取，不會整包讀進記憶體。`apps/client` 尚未接 `authorize`。
- **CSP**：`apps/client/next.config.js` 的 `headers()` 送 `Content-Security-Policy-Report-Only`（非 nonce，保留 `worker-src 'self' blob:`，dev 才加 `'unsafe-eval'` 與 `ws://localhost:*`）與 `X-Content-Type-Options: nosniff`。`connect-src`／`img-src` 依 client 實際選端點的方式納入 API 來源：`NEXT_PUBLIC_API_URL` 與 `NEXT_PUBLIC_API_AUTH_URL`（`/auth/*`、`/attachments/*`，PDF 預覽的檔案來源）的 origin；沒設 API URL 時，以 host 為 `localhost`／`127.0.0.1` 的 `has` 規則加入 `http://localhost:17603`，與 build 模式無關（production build 在 localhost 上同樣連本機 API）。改成強制模式前仍要先看實機 violation 報告。
- **啟動預熱**：`ConditionService.onApplicationBootstrap` 預熱兩種引擎。冷啟動成本是每個 process 一次（引擎程式碼的載入與編譯），不是每份模組副本一次，所以只有 process 內第一次碰引擎才量得到。實測（jest 單檔、`--runInBand`、新 process）：不預熱時第一次評估 legacy 約 98–108 ms、v2 約 7–8 ms（獨立驗證者探針與舊版 spec 的數字）；改由開機預熱付這筆，`warmUp()` 本身 legacy 約 84–86 ms、v2 約 7 ms，之後第一次評估 legacy 0.2–0.3 ms、v2 0.5–0.6 ms。這筆成本移到開機，不在任何案件的評估預算內。（前一版回報的「預熱本身 1.2–2.3 ms」是在 process 已熱時量的，有誤；舊 spec 的冷熱比較在 `warmUp()` 為空函式時也會通過，已改為驗證預熱確實對兩種方言各做 parse、lint、evaluate。）
- **E2E**：`apps/client-e2e/specs/expression-xss-real.spec.ts` 已寫，未執行。案件詳情頁驗運算式寫入的 `copy`；通知抽屜驗案件標題中的另一段 HTML（簽核人的 TASK_ASSIGNED 內文引用標題）以文字顯示、不產生元素、不執行。**限制**：通知的 payload 不含表單資料（`notification.service.ts` 只放案件標題、節點名稱與 NOTIFY 樣板），運算式寫入的欄位值目前到不了通知抽屜，所以 Gate「經表達式寫入後在通知抽屜以文字顯示」的字面要求在現行產品上無從觸發；通知抽屜的檢查涵蓋的是使用者輸入經通知顯示的路徑。若之後讓通知樣板讀表單欄位，要補上這條。
- **未完成**：實機 gate（`contains` 與宿主函式兩條路徑、PDF 預覽與 `form-pattern-worker` 在 CSP 下的實機確認）、XSS E2E 的實際執行、NOTIFY recipients 運算式編輯（留 P5 評估）。

## P5 — `EXPRESSION` binding

2026-11-07 產品擁有者同意納入，部分取代 ADR 14、18 的相關條款（範圍見 ADR 22 §3.7）。

**交付**：

- shared 型別、schema 驗證、靜態依賴、循環檢查。
- `form-data-source.validation.ts` 單一實作內評估，search、resolve、submit 共用。
- webhook binding 失敗時記 `FAILED`，不回滾。
- Builder 綁定 UI。

**Gate**：

- 測試：search、resolve、submit 對相同輸入得到相同值與 `bindingHash`。
- 測試：瀏覽器送入的 expression 或 binding 被忽略。
- 測試：預算耗盡時回傳既有 `UNAVAILABLE` 語意，不寫入 instance。
- 實機：以 wrapper host 的 `demo.cost-centers` 驗證依賴欄位變更與重新送出。

**狀態（2026-11-07）**：IMPLEMENTED（程式與測試）。實機 gate 尚未跑；NOTIFY webhook 的 `EXPRESSION` 要等 P4 整合 shared 結構 lint 後才能發布。

- 評估：DataSource 的 `EXPRESSION` 在 `form-data-source.validation.ts` 的 `readBindingValues` 內評估，search、resolve、submit 共用同一個 evaluator（`form-data-source.expression.ts`）；
  一律 cel-v2、root `form`（表格欄另加 `row`）、只允許內建函式、走注入 registry 的 `ConditionService`。依賴欄位缺值時不呼叫引擎，回 WAITING 並指出缺的欄位。
  執行期 root 依位置收窄、與發布 lint 一致：只有表格欄帶列值（瀏覽器沒送時為空物件），頂層欄位不帶，`row` 不是 root；頂層欄位的已存 expression 若讀 `row`（繞過 lint 寫入）直接 `INVALID_BINDING`，不等待也不讀瀏覽器送的 `rowValuesJson`（獨立驗證發現，2026-11-07 修正）。
- 預算：每次 search、resolve、submit 各是一個 `runExpressionOperation`（submit 在引擎外層已有 operation 時共用），耗盡回既有 `FORM_DATA_SOURCE_TIMEOUT`，不新增錯誤碼，不寫 instance。
- `bindingHash` 只雜湊參數值，序列化位元組不變（golden fixture：`form-data-source.validation.hash.spec.ts`）。
- 未知的 binding 來源 kind 一律 `FORM_DATA_SOURCE_INVALID_BINDING`（以前會落到 `ROW_FIELD` 分支）；builder 顯示「不支援的來源」，不改寫它。
- 靜態依賴：`EXPRESSION` 讀到的 `form`／`row` 欄位計入循環檢查與 hidden 欄位規則；發布 lint 附 `EXPR_*` 行（`schema.fields[i](.columns[j]).dataSource.bindings[k].from.expression: <code>`）。
- Webhook：NOTIFY 的 `EXPRESSION` 在引擎交易內以獨立預算評估，失敗記 `FAILED`（`WEBHOOK_PARAMETER_INVALID`，細節只含錯誤碼），不回滾審批。
- 測試：`form-data-source.expression.real-engine.spec.ts`（三路徑一致、瀏覽器送入的 expression 被忽略、預算耗盡、lint、循環）、`workflow-webhook-expression.real-engine.spec.ts`、`workflow-engine.service.spec.ts`（TIMEOUT 時不寫 instance）。
- 示範：`pnpm demo:reset` 會建立「跨廠成本中心申請（表達式）」，`chargedCostCenter` 的 `plant` 參數以 `form.chargeTo == "OTHER" ? (form.plant == "TW01" ? "TW02" : "TW01") : form.plant` 綁定 `demo.cost-centers`。
- 整合待辦（P4 檔案）：`workflow-graph.ts` 的 NOTIFY 結構與 catalog lint 要認得 `EXPRESSION`；`template.service.ts` 要把 `conditionService` 傳給 `lintWorkflowWebhookTargets`；`workflow-lint-errors.ts` 的逐碼中文訊息供 builder 使用。
