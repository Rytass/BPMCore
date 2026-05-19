# 05 — CEL 條件機制

**CEL (Common Expression Language)** 是 BPMCore 用來儲存條件表達式的 DSL。
目前實作以 `cel-js` 為基礎，提供 expression parse、lint 與 runtime evaluate。

重要現況：

- 已支援 CEL 字串儲存於 template version、workflow edge、entry condition、
  initiator policy、resolver expression 等位置。
- 已在 publish / dry run / workflow runtime 使用 CEL lint/evaluate。
- 目前沒有 context schema registry、靜態型別推導、timeout/maxSteps sandbox
  wrapper、或自訂函式 registry。
- 因此目前 lint 主要保證語法與 `cel-js` 可解析性，不保證引用欄位一定存在或型別
  完全正確。

---

## 1. 基本語法範例

```cel
form.amount > 1000000
form.region == 'TW'
form.amount > 100000 && initiator.org.code == 'FIN'
'manager' in initiator.roles
form.region in ['TW', 'JP', 'KR']
form.email.contains('@example.com')
form.amount >= 100000 && form.amount <= 1000000
```

---

## 2. 目前使用點

| 使用點             | Context 來源                              | 範例                                          |
| ------------------ | ----------------------------------------- | --------------------------------------------- |
| 發起權限           | `subject`                                 | `'admin' in subject.roles`                    |
| 節點進入條件       | `form`, `initiator`, `instance`           | `form.amount > 1000000`                       |
| Sequence Flow 條件 | `form`, `initiator`, `instance`           | `form.priority == 'urgent'`                   |
| Approver Resolver  | `form`, `initiator`, `instance`           | `form.region == 'JP' ? 'JP_HEAD' : 'TW_HEAD'` |
| Delegation 條件    | `subject`, `task`, `instance`, `template` | `instance.amount < 100000`                    |

實際可用 context 由呼叫端組出，並非由 central registry 推導。新增 CEL 使用點時，
必須在對應 service 明確建立 context object。

---

## 3. Shared Context Types

`libs/shared/src/lib/condition.ts` 定義了 BPMCore 共用的 context shape，例如：

```ts
export type ConditionContextType = 'INITIATOR_POLICY' | 'ENTRY_CONDITION' | 'FLOW_CONDITION' | 'APPROVER_RESOLVER' | 'FORM_FIELD_CONDITION' | 'DELEGATION_CONDITION';
```

這些型別是前後端共用契約，並不是目前 runtime 的 schema registry。現階段若 CEL
表達式引用不存在欄位，可能在 runtime evaluate 時才反映為 false 或錯誤。

---

## 4. Condition Module 現況

目前 `ConditionService` 提供：

- `parse(expression)`：解析 CEL expression。
- `lint(expression)`：回傳 lint 結果與錯誤訊息。
- `evaluate(expression, context)`：以給定 context 執行 expression。

目前尚未提供：

- 依使用點註冊 context schema。
- 根據 FormDefinitionVersion 推導 `form` 靜態型別。
- 自訂函式 registry。
- `timeoutMs` / `maxSteps` 的額外 runtime wrapper。
- Monaco/IntelliSense 所需的可用變數 metadata API。

---

## 5. 發布與 Dry Run

模板發布時，後端會檢查 workflow definition 內可找到的 CEL expression 是否可 lint。
Dry Run 與 workflow runtime 會在流程模擬/執行時 evaluate 條件。

這代表目前可以擋掉語法錯誤，但不能完整保證：

- 欄位名稱一定存在於表單 schema。
- 表達式回傳型別一定符合使用點期待。
- resolver expression 一定能解析成實際存在的 member。

上述能力應視為後續強化項目，而不是目前已完成能力。

---

## 6. 後續可補能力

| 項目                        | 目的                                                 |
| --------------------------- | ---------------------------------------------------- |
| Context schema registry     | 依使用點列出可用變數與型別。                         |
| Form schema type derivation | 從 FormDefinitionVersion 推導 `form` 欄位型別。      |
| Static checker              | 發布前檢查欄位存在性與回傳型別。                     |
| Custom function registry    | 統一註冊 `hasRole`、`isInOrg` 等 domain helper。     |
| Evaluate guard              | 補上 timeout / maxSteps / expression length policy。 |
| Editor metadata API         | 支援 Monaco / autocomplete / inline lint。           |
