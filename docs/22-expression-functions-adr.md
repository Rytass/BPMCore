# 22 — ADR：流程表達式與宿主函式（Expression Runtime）

- **狀態**：Accepted（2026-11-07 與產品擁有者確認，P5 的 `EXPRESSION` binding 納入範圍）
- **決策日期**：2026-11-07
- **實作狀態**：未開工；獨立安全修補與 P0 先行
- **適用範圍**：`ConditionService`、Workflow Engine、發布 lint、委派規則、表單 DataSource binding、
  知會 webhook binding、Template Designer、AI 助理、宿主函式註冊
- **交付規劃**：[23 — 流程表達式開發 Phase](./23-expression-functions-phases.md)
- **前置文件**：[05 — CEL 條件機制](./05-conditions-cel.md)
- **部分取代**：[ADR 14](./14-form-option-data-source-adr.md) §3.3、§8 與
  [ADR 18](./18-notify-webhook-adr.md) §7.6、§8 中「binding／payload 不支援 CEL」的條款，僅限 §3.7 定義的受限形式

## 1. 背景

設計者需要在流程關卡與資料來源上做字串判斷、數值計算與組字；部分邏輯必須呼叫宿主既有的領域規則。
目前關卡已有 CEL，但有三個缺口：

1. **表達力不足**：`cel-js` 0.8.2 不支援字串方法，而 `docs/05` 的範例還在使用。
2. **沒有執行防護**：表達式在主執行緒同步評估，沒有 timeout 或步數上限。
3. **錯誤訊息帶出完整 context**：引擎把 context 寫進錯誤訊息，`ConditionService` 再原文轉成 API 回應。
   2026-11-07 審查確認這沒有跨越現行讀取邊界（§3.10），但值可能流進 log 或日後新增的外部通道，仍應收斂。

### 1.1 實測（2026-11-07，本機 Node）

以下都是直接呼叫引擎的結果，尚未透過實際 API 端到端驗證。

| 項目 | `cel-js` 0.8.2（現行） | `@marcbachmann/cel-js` 8.0.0（候選） |
| --- | --- | --- |
| `form.email.contains('@')` | `Unknown method` | 正常 |
| `form.constructor`／`form.toString` | 讀得到函式，無法呼叫 | `No such key` |
| 引用不存在的欄位 | 訊息含完整 context JSON | `No such key: <key>` |
| 5 層巢狀 `map`、每層 30 元素 | 約 5,478 ms | 約 407 ms |
| 結構限制 | 無 | `maxAstNodes`、`maxDepth` 等（parse 階段） |
| 執行期預算 | 無 | README 未列出 |
| `form.amount + 1`（JS number） | 正常 | `no such overload`，需註冊混合運算子 |
| `form.price * 2` | 正常 | 同上；註冊 `+` 只解決 `+` |
| `has(x) ? 1 : 0` 的結果 | number | `bigint`，直接 `JSON.stringify` 會丟錯 |
| 非同步 handler | 不適用 | 回傳 `Promise`，型別系統不會擋 |
| `erp.band_v1(x)` 宣告 | 不適用 | `Unknown type: erp`，函式名稱不能帶命名空間 |

`vm.Script#runInContext({ timeout })` 實測能中斷兩個引擎的巢狀 `map`，也能中斷候選引擎 `matches`
的災難性回溯，約 100 ms 內回到呼叫端，單次額外成本約 68 µs。這是資源防護，**不是安全邊界**。

timeout 管不住回傳值的大小：候選引擎在 1 ms 內就產生序列化後約 180 MB 的結果（字串以參照共用，
只有序列化時才會展開）。

## 2. 決策驅動因素

1. 設計者能完成字串判斷、計算與組字，不需要改程式（需求 A）。
2. 需要領域邏輯或外部資料時，由宿主工程師以程式碼提供，設計者只能選用（需求 B）。
3. 設計者與 AI 助理寫的內容不得成為程式碼執行、SSRF 或憑證存取的途徑。
4. 表達式的輸出與錯誤不得把案件資料帶給**不具案件讀取資格**的對象，也不得經由 log、email、webhook
   離開 GraphQL 讀取閘門。`display: HIDE` 不是保密邊界（§3.10）。
5. 單一表達式不得明顯拖慢 API 或長時間佔住案件鎖。
6. 已發布版本與進行中案件的行為不得因升級而改變。
7. 能在發布前擋下的錯誤，不留到執行期才回滾簽核交易。

## 3. 決策

### 3.1 只提供宣告式表達式與宿主函式，不開放 JavaScript

| 誰寫 | 寫什麼 | 在哪裡跑 | 能做什麼 |
| --- | --- | --- | --- |
| 設計者／AI 助理 | CEL 表達式 | 後端 Expression Runtime | 讀 context、呼叫白名單函式 |
| 宿主工程師 | 同步純函式 | 後端，與宿主同信任層 | 領域計算，不做 I/O |
| 宿主工程師 | DataSource／webhook provider | 宿主程式碼，非同步 | 外部 I/O（ADR 14、18） |

設計者寫的 JavaScript 不在 server 或瀏覽器執行，也不引入 `vm2`、`isolated-vm`、QuickJS 等 JS 沙箱。
理由：server 端的逃逸等於 RCE，且與 provider 憑證同一程序；瀏覽器端等於 stored XSS。

瀏覽器不評估 CEL。編輯器的即時回饋來自 §3.8 的後端 API。現有 `visibleWhen`／`readonlyWhen` 維持
`form-rendering.ts` 的受限規則語法，不在本 ADR 範圍。

### 3.2 所有評估都經過單一 Expression Runtime

`ConditionService` 維持對外介面，內部改走 Runtime。任何使用點不得直接呼叫引擎。Runtime 依序執行：

1. **Parse 與結構限制**：expression 長度、AST 節點數、巢狀深度、comprehension 巢狀層數（§3.4）。
2. **輸入大小檢查**：dry run、preview 與 runtime query 的輸入必須先受 `@MaxLength` 限制。
3. **帶預算評估**：以固定腳本的 `vm.Script` 加 `timeout` 包住同步評估，模式同
   `text-field-pattern-test.ts`。逾時丟穩定錯誤碼，不回報 `false`：沒算完不等於條件不成立。
4. **輸出正規化**：見下。
5. **錯誤淨化**：見下。

**預算**：初始值為單次 100 ms、單次操作累計 250 ms，P0 以實際流程量測後定案。宿主可以調低，
也可以在硬上限內調高。

**輸出正規化**（bounded walker，不用 `JSON.stringify` 判斷大小）：

- 只接受 `null`、boolean、有限 number、string、陣列與 plain object。
- `bigint` 在安全整數範圍內轉成 number，超出範圍視為錯誤。
- function、`Promise`、class instance、`NaN`、`Infinity` 一律視為錯誤。
- 節點數與字串總長度有上限（初始值 64 KiB），超過就停止走訪並視為錯誤。
- 拒絕 `__proto__`、`constructor`、`prototype` 作為 object key。

**錯誤淨化**：

- 引擎訊息**一律不得**進入 `BadRequestException`、GraphQL 回應、活動紀錄或 log。
- 對外只有穩定錯誤碼加使用點 label：`EXPRESSION_SYNTAX_ERROR`、`EXPRESSION_MISSING_KEY`、
  `EXPRESSION_TYPE_ERROR`、`EXPRESSION_BUDGET_EXCEEDED`、`EXPRESSION_INVALID_RESULT`、
  `EXPRESSION_FUNCTION_FAILED`。
- 淨化採允許清單：只有能完整比對已知訊息樣式的錯誤，才能抽出 key 名稱；比對不到就只給錯誤碼。
- 僅 designer 的 dry run 與 preview 回傳 key 名稱；case runtime 只回傳錯誤碼與 label。
- 伺服器 log 只記 label、template version、錯誤碼與耗時，不記 expression 結果或 context。

### 3.3 以方言欄位隔離引擎升級

候選引擎對既有表達式並非完全相容（§1.1）。已發布版本與案件快照不可變，所以不做全域替換：

- `WorkflowDefinition` 新增選填的 `expressionDialect: 'cel-legacy' | 'cel-v2'`，缺少時視為 `cel-legacy`。
- 發起權限跟隨所屬版本的 workflow definition。
- 委派規則的 `scopeConditionCel` 新增方言欄位（migration，既有資料為 `cel-legacy`）。
- 案件依 snapshot 的方言評估，升級不影響進行中案件。
- 新模板預設 `cel-v2`；既有草稿由設計者明確升級，升級前跑差異檢查並列出行為不同的表達式。
- 兩個方言都走 §3.2 的 Runtime，舊方言也得到預算、輸出正規化與錯誤淨化。

`cel-v2` 註冊 `double` 與 `int` 的混合 `+ - * / %`（雙向），讓 `form.amount * 2` 符合設計者預期。
差異測試必須覆蓋 repo 內所有既有表達式樣式。候選引擎是否採用，以 P1 的差異測試結果為準；
不通過時保留 `cel-js`，只做防護與函式層。

### 3.4 發布 lint 改以 AST 判斷

現有 root identifier lint 與 `referencesFormField` 都靠 regex。`cel-v2` 改用 AST：

- **複雜度**：expression 2,000 字元、AST 200 節點、深度 32、comprehension 巢狀最多 2 層。
- **Root 白名單**：沿用 `docs/05` §2 的使用點白名單。評估時也要套用，dry run 不得略過。
- **computed key**：禁止 `form[...]`、`formData[...]`、`row[...]` 的非字串常值索引。實測
  `form["sec"+"ret"]` 能讀到值，而 regex 判斷不到依賴，這會讓欄位存取 lint 失準。
- **整體引用**：禁止把 `form`／`formData`／`initiator` 整個物件當值使用，例如 `string(form)`，
  以及 webhook payload 內的整包傳遞。每個值都必須能追溯到具名欄位。
- **型別與存在性**：以表單 schema 宣告 `form` 欄位型別，用 `env.check()` 檢查欄位、函式與回傳型別。
- **寫入目標**：`SET_FORM_FIELD.fieldPath` 必須指向 schema 宣告的欄位，且不得含
  `__proto__`、`constructor`、`prototype` 片段。
- **選填欄位**：引用選填欄位但沒有 `has()` 防護時發出警告。缺值會讓評估失敗並回滾。

舊方言維持現有 lint，再加上複雜度檢查；既有已發布版本不重新 lint。

### 3.5 宿主函式 Registry

比照 ADR 14 §3.1 的 registry 模式：core 定義 contract 與 injection token，宿主註冊。

```ts
export interface BPMExpressionFunction {
  readonly description: string;
  readonly handler: (...args: readonly BPMExpressionValue[]) => BPMExpressionValue;
  readonly label: string;
  readonly name: string; // 例：erp_costBand_v1
  readonly parameters: readonly BPMExpressionFunctionParameter[];
  readonly returnType: BPMExpressionValueType;
}
```

- **命名**：`^[a-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*_v[0-9]+$`，版本寫進名稱（候選引擎不支援帶點的宣告）。
- **只接受同步函式**：註冊時拒絕 `AsyncFunction`；執行時回傳 thenable 視為 `EXPRESSION_FUNCTION_FAILED`。
  評估發生在 DB transaction 內，需要 I/O 的邏輯必須走 provider。
- **不傳 auth context**：handler 只拿到引數。結果不得因呼叫者不同而不同，否則 dry run、preview 與
  正式評估會不一致，也會形成權限判斷被快照的問題。
- **引數隔離**：傳入前先做結構複製並 deep-freeze，避免 handler 改動 `formData`。
- **回傳驗證**：套用 §3.2 的正規化，並核對宣告的 `returnType`。
- **錯誤隔離**：handler 丟出的訊息不外傳，只記函式名稱與錯誤碼。
- **保留責任**：已發布版本引用的函式與版本，宿主必須保留；缺少時發布擋下，執行時 fail closed。
- **信任層級**：handler 是宿主程式碼，core 無法強制它不做 I/O。這是文件 contract，不是沙箱。

Core 內建函式僅限純計算：`round`、`floor`、`ceil`、`abs`、`min`、`max`、`trim`、`lower`、`upper`。
是否提供日期差等函式依 P3 需求確認。不提供取得目前時間以外的環境資訊。

### 3.6 關卡使用點

| 使用點 | 結果型別 | 評估失敗時 |
| --- | --- | --- |
| 發起權限 | boolean | 視為無法發起，回傳錯誤碼 |
| 進入條件、edge 條件 | boolean | 回滾並回傳錯誤碼；不得當成 `false` 走到其他分支 |
| 簽核人 `EXPRESSION` | member id 或陣列 | 回滾並回傳錯誤碼 |
| `SET_FORM_FIELD` | 符合目標欄位型別 | 回滾並回傳錯誤碼 |
| 委派條件 | boolean | 丟出錯誤碼並中止該次解析（`matchesRuleScope` 現有語意，不改成靜默略過） |
| 路徑 A `WEBHOOK` payload | JSON | 不擴充；維持 ADR 18 的既有 backlog |

**簽核人 `EXPRESSION` 是權限決策。** 設計者本來就能決定簽核人，但回傳的 id 來自表單值時，填表者
可能指定簽核人。lint 對「簽核人表達式直接引用 `form`」發出警告，並維持現有 member 解析驗證。

### 3.7 資料來源與 webhook 的 `EXPRESSION` binding（P5）

新增 binding 來源，只用於組參數，不用於處理 provider 回傳：

```ts
| {
    readonly expression: string;
    readonly kind: 'EXPRESSION';
  }
```

限制與理由：

- **Root 只允許 `form`、`row`。** 不提供 `env`、`initiator`、`instance`：search、resolve、submit
  必須算出相同結果，否則 `bindingHash` 會無故變動。身分由 `BPMAuthContext` 傳給 provider。
- **依賴由 AST 靜態取得**：循環檢查、刪欄影響分析與 `waitingForFieldKeys` 沿用現有機制。
- **只在後端評估**：瀏覽器送 values，後端依 snapshot 內的 binding 計算。瀏覽器不得送 expression。
- **結果型別**：只接受 `boolean | number | string | null`，並核對 parameter 型別。
- **不擴大授權**：瀏覽器控制的 values 會進入 expression，provider 仍必須把參數當不可信輸入，並自行做
  row-level authorization（ADR 14 §3.4）。
- **預算**：runtime query 每個欄位共用同一個操作預算，現有 `MAX_PARAMETER_BYTES` 照舊適用。
- **Webhook**：評估在 outbox 寫入前。失敗時記為該次投遞 `FAILED`，**不回滾簽核交易**，符合 ADR 18 §2。

**不做 provider 結果轉換。** `label` 會進入不可變的 snapshot，`value` 又是 resolve 的比對鍵，
由表達式轉換會讓 search 與 resolve 分歧。需要轉換時由宿主在 provider 內處理。

### 3.8 撰寫入口

- 表達式只能經由設計者權限的路徑寫入：模板草稿、發布、委派規則維持既有權限。
- **`dryRunApprovalWorkflow` 維持 `@BPMAuthenticated()`。** 產品擁有者要求盡量不動 API contract，而 dry run
  只評估呼叫者自己送的資料、不讀資料庫，收緊權限對資料保護沒有幫助。可用性由下述預算保護。
- **Dry run 預算涵蓋整次模擬。** 實測 8 個串接的閘道菱形（27 節點、5.8 KB JSON）同步阻塞約 20 秒，耗時在
  流程遍歷，不在單一表達式。因此：
  - 整次模擬放進 `vm` timeout，同時中斷遍歷與表達式。
  - 總 visit 上限作為確定性保護，避免記憶體隨路徑數膨脹。
  - 輸入大小超限或預算耗盡都回 `valid: false`，GraphQL schema 不變。
- 新增 `@BPMDesignerOnly()` 的 `previewExpression`：輸入 expression、使用點與樣本資料，只評估樣本，
  不讀真實案件。
- 新增 `@BPMDesignerOnly()` 的 `expressionCatalog`：回傳使用點、可用 root、函式 descriptor，供編輯器使用。
- **AI 助理**：工具繼續在瀏覽器執行，只能修改畫布。它寫的表達式走相同 lint，不得自動發布。
  提示注入能影響的範圍因此不超過設計者本人。

### 3.9 XSS 與輸出邊界

表達式的輸出一律是資料：

- React 以文字節點顯示；不得為表達式輸出使用 `dangerouslySetInnerHTML`、`srcDoc` 或 markdown 轉 HTML。
- 連結欄位繼續經過 `resolveFormFieldLink`。
- Email 維持 `text:`。新增 HTML email 或 rich text 前必須先補 context-aware escape，並重新審查
  Handlebars 的 `noEscape: true`。
- 表達式可能把使用者輸入送進 webhook，接收端要自行視為不可信資料。此項寫進宿主整合文件。
- `apps/client` 補上 CSP 與 `X-Content-Type-Options: nosniff`，作為縱深防禦，不作為本功能的前提。

### 3.10 欄位存取

**前提：現行系統沒有伺服器端的欄位可見性邊界。** `display: HIDE` 只影響畫面（`workflow.ts:336-340`、
ADR 20），任何案件可讀者都能經由 `formDataJson`、`initiatorMetadataSnapshotJson` 取得完整資料。
活動紀錄與案件共用同一道讀取閘門。本 ADR 不改變這點，也不得以「隱藏欄位不可見」作為安全前提。

因此隱藏欄位影響表達式結果，並不是新的洩漏面。UI 仍要讓依賴看得見，避免設計者誤以為 HIDE 有保密作用：

- 欄位與關卡總覽矩陣以 AST 依賴標示「此欄位被哪些表達式引用」。
- `SET_FORM_FIELD` 從隱藏欄位複製到可見欄位時，發布 lint 發出警告。

若產品要真正依欄位保密，必須另立 ADR，在伺服器端對 `formDataJson`、`activityLogs.payloadJson`、
`initiatorMetadataSnapshotJson` 依檢視者 redaction。這是 ADR 20 明確排除的範圍。

## 4. 威脅模型

| # | 威脅 | 攻擊者 | 緩解 | 驗證 |
| --- | --- | --- | --- | --- |
| T1 | 表達式逃逸成程式碼執行 | 設計者、提示注入 | 不執行 JS；AST 直譯器；root 與函式白名單 | prototype／constructor 探測測試 |
| T2 | CPU 耗盡 | 成員、設計者、填表者 | 整次 dry run 時間與 visit 預算；複雜度 lint；評估預算 | 串接閘道菱形、巢狀 `map`、災難性 `matches` 測試 |
| T3 | 記憶體或序列化炸彈 | 設計者、填表者 | 輸入上限；輸出 walker；AST 上限 | 字串共用炸彈測試 |
| T4 | 錯誤或輸出把 context 帶給非案件讀取者，或經 log、webhook 流出 | 外部接收端、日誌讀者 | §3.2 錯誤淨化與允許清單；P5 webhook 只送綁定參數 | 回應與 log 不含 context 值；讀取閘門測試 |
| T5 | 繞過欄位依賴判斷 | 設計者 | 禁 computed key 與整體引用 | AST lint 測試 |
| T6 | 填表者操縱路由或簽核人 | 填表者 | 後端評估；簽核人表達式警告；member 解析驗證 | 直接呼叫 mutation 測試 |
| T7 | 注入到 provider | 填表者 | 參數視為不可信；型別核對；provider contract | wrapper host provider 測試 |
| T8 | 宿主函式被濫用或行為不定 | 設計者 | 同步、無 auth context、引數凍結、回傳驗證 | registry 測試 |
| T9 | 儲存型 XSS | 填表者、設計者 | §3.9 輸出邊界；禁用不安全 sink 的 grep gate | 惡意 payload E2E |
| T10 | Prototype pollution | 設計者、填表者 | 路徑與 key 黑名單；輸出 walker | `__proto__` 寫入測試 |
| T11 | 預算誤判造成案件卡住 | 非惡意 | 預算保留餘裕；穩定錯誤碼；重試不改資料 | 負載下量測 |
| T12 | 引擎升級改變路由 | 非惡意 | 方言欄位；差異測試；snapshot 依方言評估 | 差異測試 |

**殘餘風險**：

- `vm` timeout 只涵蓋表達式評估，不涵蓋宿主 JS（例如流程遍歷），也不限制記憶體；只靠輸入、AST 與輸出上限間接控制。
- 大量併發請求仍可能佔滿事件迴圈，rate limiting 由宿主負責。
- 宿主函式的安全性取決於宿主程式碼。
- 候選引擎的 AST 直譯器是外部相依，需持續追蹤安全公告。

## 5. 發布前驗證不變式

發布、發布版本與 rollback 都必須通過：

1. 所有表達式通過語法、複雜度與 root 白名單檢查。
2. `cel-v2` 表達式沒有 computed key 與整體引用。
3. 引用的欄位存在且型別相容；引用的函式與版本已註冊。
4. 使用點的回傳型別正確。
5. `SET_FORM_FIELD.fieldPath` 指向已宣告欄位，且不含保留片段。
6. `EXPRESSION` binding 只使用允許的 root，且沒有依賴循環。

## 6. 相容性

- `expressionDialect` 為 additive；缺少時行為等同現況，但多了預算與淨化。
- **行為變更**：超過預算或大小上限的 dry run 回 `valid: false`。權限與 GraphQL schema 不變。
- **行為變更**：評估錯誤的訊息改為錯誤碼加 label。宿主若比對舊訊息文字需調整；`form-data-source`
  與 lint 的錯誤碼慣例已是如此。
- 舊方言表達式回傳 function 等非 JSON 值時由成功改為失敗。這只影響原本就無意義的表達式。
- 公開 API 變更時同步 `docs/api-reference.md`，並依 `CLAUDE.md` 的 release 流程發布。

## 7. 後果

**正面**：設計者能處理多數字串與計算需求；領域邏輯留在宿主；既有版本不變；錯誤外洩與 CPU 風險同時收斂。

**成本**：

- 一段時間內要維護兩個方言，且 UI、文件與測試都要區分。
- 宿主要為函式維護版本。
- AST lint 需要依賴候選引擎的 AST 形狀，升級引擎時要回歸。
- 每次評估多約 68 µs；預算參數需要量測與調整。

## 8. 未採用方案

- **設計者寫 JavaScript（server）**：`node:vm` 官方明言不是安全機制；`vm2` 持續出現逃逸；n8n
  CVE-2025-68613 是有編輯權限即可 RCE 的前例。
- **設計者寫 JavaScript（瀏覽器）**：等同 stored XSS，且跑在宿主 origin。
- **JS 沙箱（isolated-vm、QuickJS）**：技術上可隔離，但需求 A／B 用不到，營運與審查成本不成比例。
- **全域替換 CEL 引擎**：會改變已發布版本的行為，違反不可變原則。
- **在瀏覽器評估 CEL**：前後端會有兩份語意；即時回饋改由 preview API 提供。
- **`Worker` 隔離評估**：能硬中斷也能限記憶體，但現行評估點都是同步且在交易內，改動面大。
  只有在 `vm` timeout 量測不足時才重新評估。
- **provider 結果轉換表達式**：見 §3.7。

## 9. 不在範圍

- 任意 HTTP connector、Integration Catalog（ADR 14 §8 維持）。
- 路徑 A／C webhook 的 SSRF、明文 header 與交易內同步 HTTP（ADR 18 的 backlog）。2026-11-07 審查確認
  仍可利用，修補列在 [Phase 文件](./23-expression-functions-phases.md)的「獨立安全修補」，不依賴本功能。
  §3.7 的 webhook binding 只適用 ADR 18 的 registry 路徑，不擴充路徑 A／C。
- `visibleWhen`／`readonlyWhen` 支援完整 CEL。
- 表達式除錯器、逐步執行。
- rate limiting（宿主負責）。

## 10. 相關文件

- [05 — CEL 條件機制](./05-conditions-cel.md)
- [14 — ADR：表單選項 DataSource](./14-form-option-data-source-adr.md)
- [18 — ADR：知會節點 Webhook](./18-notify-webhook-adr.md)
- [23 — 流程表達式開發 Phase](./23-expression-functions-phases.md)
