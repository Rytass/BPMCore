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
| P2 | AST lint、欄位依賴、schema 型別檢查 | P1 | — | IMPLEMENTED（實機 gate 未跑） |
| P3 | 宿主函式 Registry 與內建函式 | P2 | 內建函式清單 | PLANNED |
| P4 | 設計器：編輯器、preview、函式目錄、AI 助理 | P3 | UI 設計稿 | PLANNED |
| P5 | DataSource／webhook 的 `EXPRESSION` binding | P4 | — | PLANNED |

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

**狀態（2026-11-07）**：IMPLEMENTED。程式與測試完成；**實機 gate 未跑**（未在 dev server 上實際發布 cel-v2 模板），
所以不是 VERIFIED。`pnpm nx run-many -t typecheck lint test -p shared bpm-core bpm-core-client bpm-core-react api` 通過
（修正獨立驗證發現的那一輪：第一次因 `workflow-engine.service.spec.ts` 的時間預算測試 `accepts a full table of valid values within the budget`
在並行負載下逾時而失敗，該檔本輪未動；同一指令重跑全數通過）。

| Gate | 結果 |
| --- | --- |
| `form["sec"+"ret"]`、`string(form)`、`__proto__` 在發布時被擋下 | 真引擎：`template.service.expression-lint.real-engine.spec.ts` 的 `Phase 23 P2 gate (cel-v2)` 以真 `ConditionService` 走 `publishApprovalTemplateVersion`，分別得到 `EXPR_COMPUTED_KEY`、`EXPR_WHOLE_FORM_REFERENCE form`、`EXPR_RESERVED_PATH_SEGMENT __proto__`；`SET_FORM_FIELD` 的 `fieldPath: "__proto__.polluted"` 同樣被擋，cel-legacy 定義也擋（`__proto__.polluted`、`items[0].constructor`） |
| 既有已發布版本不被重新 lint | 真引擎：rollback 一個發布時會被擋下的版本（computed key）照樣回到 PUBLISHED，`lintExpression`／`lintExpressions` 都沒有被呼叫。rollback 只檢查版本呼叫的宿主函式仍已註冊（`EXPR_FUNCTION_NOT_REGISTERED`），不重新 lint |
| 前後端訊息對應完整 | `workflow-lint-errors.expression.spec.ts`：每個 `EXPR_*` 碼（錯誤 12、警告 6）在 en 與 zh-TW 都翻譯成指名畫布位置的句子，有無 subject 皆然，譯文不含 `'; '` 也不含錯誤碼；未知方言那一行有翻譯 |
| 實機 | **未跑**：本輪不得啟動 dev server。待補：在 develop 發布一份 cel-v2 模板（含巨集綁定名稱、`lastDecision`、`fieldPath`），確認通過；再發布含 computed key 與未知方言的定義，確認設計器顯示中文訊息 |

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
  路徑也不是 CEL，docs/24 §1「舊方言沒有 AST」的理由套不上）；「指向已宣告欄位」只對 cel-v2，cel-legacy 是否也要擋待整合者決定
  （舊版 fork 後重新發布可能寫到表單已移除的欄位）。執行期寫入建立的是自有屬性，不會污染全域原型。
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
