# 05 — CEL 條件機制

**CEL (Common Expression Language)** 是 BPMCore 用來儲存條件表達式的 DSL。
目前實作以 `cel-js` 為基礎，提供 expression parse、lint 與 runtime evaluate。
`cel-js` 為 ESM-only，於第一次評估時以 `require` 延遲載入；執行 CEL 需要 Node >=20.19 或 >=22.12。

重要現況：

- 已支援 CEL 字串儲存於 template version（發起權限）、workflow edge（條件）、
  節點 entry condition、approver resolver（`EXPRESSION`）與委派規則（scope condition）。
- 已在 publish / dry run / workflow runtime 使用 CEL lint/evaluate。
- lint 目前檢查四件事：空白、長度上限（2000 字元）、語法（`cel-js` parse），以及根識別字
  是否落在該使用點的白名單內（見 §5）。
- 目前沒有 context schema registry、靜態型別推導、步數上限（maxSteps）或自訂函式 registry；
  時間上限見下方「評估有時間預算」。
- 因此 lint 不保證引用的欄位一定存在於表單 schema，也不保證表達式回傳型別正確。
- 字串方法（`contains`、`startsWith`、`endsWith`、`matches`）在目前的 `cel-legacy`（`cel-js` 0.8.2）不存在，
  執行會得到 `EXPRESSION_TYPE_ERROR`。這些方法預期由 P1 之後的 `cel-v2`（`@marcbachmann/cel-js`）方言提供，尚未實測（待 P1 差異測試確認）；
  在那之前，字串比對請用 `==`、`in` 或列舉值。
- Runtime 錯誤只會對外回傳錯誤碼與 label（`EXPRESSION_SYNTAX_ERROR`、`EXPRESSION_MISSING_KEY`、
  `EXPRESSION_TYPE_ERROR`、`EXPRESSION_BUDGET_EXCEEDED`、`EXPRESSION_INVALID_RESULT`、`EXPRESSION_FUNCTION_FAILED`，見 ADR 22 §3.2），
  不回傳引擎原文，因此錯誤訊息與 log 不含 context 內的值。dry run 對 `EXPRESSION_MISSING_KEY` 另外附上缺少的
  key 名稱，但只限表達式裡（字串字面值以外）寫出來的識別字；用計算索引（`form.a[form.b]`）時引擎回報的是
  context 裡的值，這種情況不附名稱。
- 評估有時間預算：單次 100 ms、單次操作（一次交易或一次 dry run）累計 250 ms。預算耗盡會回傳
  `EXPRESSION_BUDGET_EXCEEDED`，不會回傳 `false`。2026-11-07 本機量測一般表達式每次約 0.2 ms（p99 低於 1 ms），
  之後 `runWithinTimeBudget` 改為重用同一個 vm context，每次約 0.05 ms，一次操作約可容納 4800 次一般評估（原本約 1200 次）。
  預算維持 ADR 初始值；量測摘要見 [Phase 23](./23-expression-functions-phases.md) P0。
- 結果會經過正規化：只接受 JSON 值（深度 32、節點 10000、約 64 KiB）；`undefined`、函式、Promise、
  class instance 與超出安全整數的數字會被拒絕（`EXPRESSION_INVALID_RESULT`）。例如 `form.constructor` 會被拒絕；
  `form.__proto__` 在 `cel-legacy` 會拿到 `Object.prototype` 本身，同樣被拒絕，不會變成空 map。
  map 字面值的 `{"__proto__": 1}` 在 `cel-legacy` 建 map 時就沒有成為 own key，結果是 `{}`，不會碰到原型；
  值是 map 的 `{"__proto__": form.x}` 則會換掉結果的原型而被拒絕。
  這只檢查最終結果：引擎在中間運算或字面值上已經四捨五入的精度損失，從結果無法偵測（例如 `9007199254740993 - 9007199254740992` 會得到 `0`）。
- map 字面值的值混用不同型別會失敗：`{"a": "x", "b": 2}` 在 `cel-legacy` 得到 `EXPRESSION_TYPE_ERROR`（`cel-js` 0.8.2 的限制，已實測）。
  整數與小數也算不同型別（`{"a": 1, "b": 2.5}` 一樣失敗）；值來自欄位時也一樣，所以 webhook payload 寫成
  `{"title": instance.title, "amount": form.amount}` 這種字串混數字的 map 會在執行時失敗。
  同型別的 map（全部字串、或全部數字）可以正常運作；list 可以混合型別（`["x", 2]` 正常）。
  `cel-v2` 是否支援混合型別尚未實測，在 P1 差異測試確認前不要依賴。
- 不支援 comprehension 巨集：`map`、`filter`、`exists`、`all`、`exists_one` 在 `cel-legacy` 都無法 parse，
  得到 `EXPRESSION_SYNTAX_ERROR`（已實測）。`has()` 與 `size()` 可以使用。
- 目前沒有函式 registry：表達式不能呼叫宿主函式，也沒有 AST lint；`cel-v2` 差異與方言欄位屬於 P1 之後的範圍。

---

## 1. 基本語法範例

```cel
form.amount > 1000000
form.region == 'TW'
form.amount > 100000 && initiator.org.code == 'FIN'
'manager' in initiator.roles
form.region in ['TW', 'JP', 'KR']
form.email == 'a@example.com'
form.amount >= 100000 && form.amount <= 1000000
lastDecision != null && lastDecision.action == 'RETURNED'
```

最後一行只能用在 sequence flow（edge）條件，見 §3。

---

## 2. 目前使用點與 context

實際可用的根識別字由呼叫端組出（見 `workflow-engine.service.ts` 的 `buildWorkflowExpressionContext`、
`buildInitiatorPolicyContext` 與 `delegation.service.ts` 的 `buildDelegationExpressionContext`），
並非由 central registry 推導。新增 CEL 使用點時，必須在對應 service 明確建立 context object，
並在發布／儲存時的 lint 白名單中加入該使用點允許的根識別字。

| 使用點                              | 可用根識別字                                              | 範例                                          |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| 發起權限（`initiatorPolicyCel`）    | `env`、`initiator`、`subject`（`subject` 為 `initiator` 的別名） | `'admin' in subject.roles`                    |
| 節點進入條件（`entryCondition`）    | `env`、`form`、`formData`、`initiator`、`instance`        | `form.amount > 1000000`                       |
| Sequence Flow 條件（edge）          | 同上，另加 `lastDecision`（未發佈，v0.16.2 之後） | `form.priority == 'urgent'`                   |
| Approver Resolver（`EXPRESSION`）   | `env`、`form`、`formData`、`initiator`、`instance`        | `form.region == 'JP' ? 'JP_HEAD' : 'TW_HEAD'` |
| 委派條件（`scopeConditionCel`）     | `env`、`form`、`formData`、`initiator`、`instance`、`principal` | `form.amount < 100000`                        |

補充：

- `initiator` 為發起當下的 member snapshot，並展開 `memberId`。`initiator.roles`、`initiator.org.code` 等欄位取決於宿主提供的 snapshot 內容。
- `instance` 在流程表達式中為 `id`、`state`、`templateId`、`templateVersionId`、`title`；
  委派條件的 `instance` 另外有 `nodeId`（被委派的任務所在節點）。
- `subject` 只有發起權限的 context 會提供（與 `initiator` 相同內容）；反過來，發起權限在案件建立前評估，
  沒有 `form`、`formData`、`instance`。發布 lint 依使用點分開白名單（見 §5），任一邊寫錯根識別字都會在發布時擋下
  （未發佈，v0.16.2 之後；之前的版本對所有非 edge 表達式共用同一份含 `subject` 的白名單，寫錯要到執行期才失敗）。
- `env` 只有 `now`（ISO 8601 字串）。
- 委派條件的 `principal` 只有 `memberId`。委派條件沒有 `subject`、`task`、`template` 根，
  要用模板時請改用 `instance.templateId`。

---

## 3. Shared Context Types

`libs/shared/src/lib/condition.ts`（經由 `@rytass/bpm-core-shared` 匯出）定義了下列型別。
**目前 `libs`、`apps` 內沒有任何執行期程式引用這些型別**；它們是前後端共用的形狀草稿，
不是 runtime 的 schema registry，也不會在 lint 或 evaluate 時被檢查。

```ts
export type ConditionContextType = 'INITIATOR_POLICY' | 'ENTRY_CONDITION' | 'FLOW_CONDITION' | 'APPROVER_RESOLVER' | 'FORM_FIELD_CONDITION' | 'DELEGATION_CONDITION';
```

| 型別                                                                  | 引用狀態     | 說明                                                                 |
| --------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `ConditionContextType`                                                | 未被引用     | 列出六個使用點名稱；與 §2 的使用點概念對應，但沒有任何程式依此分派。 |
| `SubjectContext`、`OrgContext`、`PositionContext`、`EnvContext`        | 未被引用     | 描述 `subject` 的形狀。實際 `initiator` snapshot 是宿主提供的 JSON，未依此型別建構或驗證。 |
| `InstanceContext`                                                     | 未被引用     | 形狀與流程表達式的 `instance`（不含 `nodeId`）一致。                  |
| `LastDecisionContext`                                                 | 未被引用     | 形狀與 engine 的 `readLastDecisionContext` 回傳值一致（見下）。       |

`LastDecisionContext` 的語意（有實際執行，只是型別本身未被引用；以下形狀與 edge 限定（未發佈，v0.16.2 之後））：

- 只在 **sequence flow 條件** 中可用；發布時若出現在其他位置會被 lint 擋下（見 §5）。
- 值為該 edge 來源節點上**最新一筆決策**（依 `decidedAt` 排序，跨該節點所有任務）。
- 來源節點尚無任何決策時為 `null`（例如 edge 從 start event 或尚未決策的節點出發），
  所以要寫成 `lastDecision != null && lastDecision.action == 'APPROVED'`。
- 欄位：`action`（`APPROVED` / `REJECTED` / `RETURNED` / `TRANSFERRED`，大寫）、`comment`、`decidedAt`（ISO 字串）、
  `decidedByMemberId`、`returnToNodeId`、`taskId`、`transferToMemberId`。
- dry run 同樣提供此值。

---

## 4. ConditionService 現況

`libs/bpm-core/src/lib/condition/condition.service.ts` 的 `ConditionService` 提供：

- `lintExpression(expression, label, options?)` / `lintExpressions(expressions, options?)`：
  回傳錯誤訊息陣列（空白、超過 `maxExpressionLength`（預設 2000）、語法錯誤、
  根識別字不在 `allowedRootIdentifiers` 內）。`has`、`size` 等 CEL 巨集與 `true`／`false`／`null`／`in` 不會被當成根識別字。
- `evaluateBoolean(expression, context, label)`：空白表達式視為 `true`；結果不是 boolean 時丟 `BadRequestException`。
- `evaluateValue(expression, context, label)`：回傳任意值；語法錯誤或執行期錯誤丟 `BadRequestException`（訊息前綴 `label`）。

目前尚未提供：

- 依使用點註冊 context schema。
- 根據 FormDefinitionVersion 推導 `form` 靜態型別。
- 自訂函式 registry。
- `timeoutMs` / `maxSteps` 的 CEL 層 runtime wrapper（流程層級的步數上限見 `docs/07` §9）。
- Monaco/IntelliSense 所需的可用變數 metadata API。

---

## 5. 發布、儲存與 Dry Run

**模板發布**（`template.service.ts` 的發布路徑）會對 workflow 內所有 CEL 做 lint：

- 發起權限（`initiatorPolicyCel`）使用白名單 `env`、`initiator`、`subject`。
- 節點表達式（entry condition、resolver `EXPRESSION`、webhook payload、`SET_FORM_FIELD` 的值）使用白名單
  `env`、`form`、`formData`、`initiator`、`instance`。
- edge 條件使用節點表達式的白名單，另加 `lastDecision`（未發佈，v0.16.2 之後）。
- 依使用點分開白名單是 v0.16.2 之後才有（未發佈）；之前發起權限與節點表達式共用
  `env`、`form`、`formData`、`initiator`、`instance`、`subject`。
- 因此 `lastDecision` 出現在 entry condition、resolver、webhook payload 或 `SET_FORM_FIELD` 的值時，發布會被擋下。

**委派規則儲存**（未發佈，v0.16.2 之後）（`delegation.service.ts` 的儲存路徑）對 `scopeConditionCel` 做 lint，白名單為
`env`、`form`、`formData`、`initiator`、`instance`、`principal`。不在白名單內的根識別字會讓儲存失敗。
已經存在的錯誤規則不會被改動；執行期評估時仍會拋出錯誤。

**Dry Run 與 workflow runtime** 在模擬或執行時 evaluate 條件。

這代表目前可以擋掉：語法錯誤、超長表達式、未知根識別字。
但不能完整保證：

- 欄位名稱一定存在於表單 schema。
- 表達式回傳型別一定符合使用點期待。
- resolver expression 一定能解析成實際存在的 member。

上述能力應視為後續強化項目，而不是目前已完成能力。

---

## 6. 後續可補能力（未實作）

| 項目                        | 目的                                                 |
| --------------------------- | ---------------------------------------------------- |
| Context schema registry     | 依使用點列出可用變數與型別。                         |
| Form schema type derivation | 從 FormDefinitionVersion 推導 `form` 欄位型別。      |
| Static checker              | 發布前檢查欄位存在性與回傳型別。                     |
| Custom function registry    | 統一註冊 `hasRole`、`isInOrg` 等 domain helper。     |
| Evaluate guard              | 補上 timeout / maxSteps 等 evaluate 防護（長度上限已實作）。 |
| Editor metadata API         | 支援 Monaco / autocomplete / inline lint。           |
