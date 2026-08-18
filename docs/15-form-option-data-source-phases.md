# 15 — 表單選項 DataSource 開發 Phase

- **狀態**：Phase 0–6 與 P6 full-suite gate 已完成；2026-08-16 完成第二輪獨立稽核修正，
  full suite 49/49 通過
- **規劃日期**：2026-08-11
- **權威決策**：[14 — ADR：表單選項 DataSource 架構](./14-form-option-data-source-adr.md)
- **完成定義**：所有 Phase gate、真實 wrapper-host journey 與文件同步完成

截至 2026-08-12，P0–P6 gates 已完成。P6 的 wrapper registry、deterministic seed、
GraphQL/DB golden path、package consumer wiring 與真實 Chrome golden path 均已驗證；
`pnpm demo:reset` 成功後，repository-wide `pnpm e2e:client --workers=1` 以 system Chrome
在 task-owned client/API（17612/17613）跑出 43 passed / 0 failed。最終
`pnpm typecheck`、`pnpm lint`、`pnpm test` 與 `pnpm build` 亦全部通過；unit suite 為
48 suites / 342 tests，lint 維持 0 errors 與 2 個既有 warnings。

2026-08-13 追加一輪獨立稽核與修正：釐清 `FORM_DATA_SOURCE_MISSING` 與
`FORM_DATA_SOURCE_VERSION_MISSING` 的使用時機、新增
`FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` 區分「選項失效」與「provider 違約」、
前端一律以對應訊息取代原始錯誤碼、未註冊 registry 的宿主不得發布或送出動態欄位、
`initiatorMemberId` 改為 optional（server 仍為權威來源），並讓 DataSource golden path
spec 預設執行而不再靜默跳過。稽核後 `pnpm e2e:client --workers=1` 在未設定任何
`E2E_*` 變數下仍為 43 passed / 0 failed、0 skipped。

2026-08-16 追加第二輪獨立稽核與修正，處理十四個實際會在畫面上出錯的問題：

1. **缺少 runtime resolve query**。ADR §3.9／§3.11 要求「stale → resolve →
   VALID/INVALID、逐項標示、禁止送出」，但 GraphQL surface 只有 catalog／preview／runtime
   search，前端無從確認值是否仍有效——實測改變 binding 後上游已無舊值，UI 仍報 VALID 且
   不擋送出。新增 `resolveFormFieldOptions`（authenticated）與
   `previewResolveFormFieldOptions`（Designer-only），回傳
   `BPMFormDataSourceResolveResult`；部分解不出來時以 `unresolvedValues` 回報而非 throw。
   submit／resubmit 的權威 resolve 維持全有全無不變。
2. **optional parameter 綁定鎖死控制項**。前端把任何指向空欄位的 FIELD binding 都當成
   必填。`BPMFormDataSourceOptionsResult` 新增 `waitingForFieldKeys`：缺必要參數時後端不再
   throw，而是回報該欄位清單且不呼叫 provider，前端改以它為權威。
3. **唯讀未填欄位誤報**。唯讀且未填值的動態欄位原本顯示「選項來源暫時無法使用。」與一個
   按了也沒用的重試鈕，改為靜默（`IDLE`）；重試鈕只在真有查詢可重下時出現。
4. **重複 helper 漂移**。`form-data-source.service.ts` 與
   `form-data-source-value-resolver.service.ts` 兩份 helper 已不一致（前者缺
   `Number.isFinite`、`isRecord` 未排除 array），`1e999` → `Infinity` 在 search 通過卻在
   submit 被拒。抽為 `form-data-source.validation.ts` 單一實作，採嚴格語意。
5. **source 下架時繞過 `ALWAYS` policy**。`FormDataSourceValueSnapshot` 新增 optional
   `revalidationPolicy`；registry 缺席時只有非 `ALWAYS` 才允許沿用 snapshot（舊 snapshot
   無此欄位時維持相容）。
6. **退回編輯的動態查詢從未成功過**。`InstanceFormSection` 同時傳 `instanceId` 與
   `templateId`，而 runtime context 規則是兩者恰好一個，因此畫面永遠顯示「沒有權限查詢
   此欄位的選項。」。既有 e2e 沒抓到，是因為它只驗證 snapshot label（不需要發查詢）。
   已改為只傳 `instanceId`。
7. **必填驗證接錯 handler**（由第二輪瀏覽器稽核發現）。`InstanceDetailView` 的
   `validateFormRendererValues` 長在 `handleCancelInstance` 而不是
   `handleResubmitInstance`，造成一體兩面的兩個錯誤：清空必填動態欄位後「重新送出」不被
   前端擋、請求真的送出並讓畫面吐出後端原始英文訊息
   （`Form data is missing required fields: ...`）；而「取消案件」卻被這段必填驗證誤擋，
   使用者無法取消自己的退回案件。DataSource 閘門
   （`isFormDataSourceFieldSubmissionBlocked`）的定義是 `hasValue && status !== 'VALID'`，
   值被清空後 `hasValue === false` 便不再擋，本該接手的必填檢查卻不在該路徑上。已把該
   區塊移到 `handleResubmitInstance`，順序比照 `InstanceNewView`：DataSource 閘門 →
   必填驗證 → 送出。
8. **三項由最終瀏覽器稽核提出的既有瑕疵**（非本輪迴歸，一併處理）。其一，非 UUID 的
   `instanceId`／`templateId` 會讓 Postgres 的
   `invalid input syntax for type uuid: ...` 原樣回到前端，洩漏資料庫引擎與欄位型別，
   違反 ADR §3.12；改為在 runtime context 查詢外層攔截非 `HttpException` 的底層錯誤，
   記錄後一律回 `FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN`（刻意拋出的 not-found／
   forbidden 仍原樣傳遞）。其二，超大 request body 回 HTTP 500 而非 413；
   `AllExceptionsFilter` 改為在非 `HttpException` 上讀取其自帶的有效 HTTP status
   （400–599）再 fallback 到 500。其三，在動態選項重新驗證中（`LOADING`／`STALE`）點送出
   會顯示「請先完成動態選項驗證。」，讀起來像永久失敗，實際只要等查詢回來再點一次即可；
   新增 `readFormDataSourceSubmissionBlockMessage()`，暫時性阻擋改顯示
   「選項驗證中，請稍候再送出。」，需要使用者處理的情況維持原文案。
9. **第三輪稽核提出的三項邊界收尾**。其一，`GET /attachments/:id/download` 缺 `token`
   query 時 `token.split('.')` 直接拋 TypeError，變成 500 並帶出
   `Cannot read properties of undefined (reading 'split')`；改為與「token 錯誤」走同一條
   `NotFoundException`，因為兩者都無法驗證，區分它們等於洩漏附件是否存在。其二，
   `AllExceptionsFilter.readHttpStatus` 原本採信例外自帶的任何 400–599 status，日後若引入
   HTTP client（axios 等）會把**上游服務**的狀態碼當成本 API 的回覆；收緊為只接受
   `http-errors` 慣例中 `expose === true` 的 4xx（Express body parser 正是這類），413 行為
   不變。其三，`app.module.ts` 未顯式設定 `includeStacktraceInErrorResponses`，
   Apollo 僅在 `NODE_ENV` 恰為 `production` 時關閉，staging 若非該值就會把絕對路徑與
   相依版本送到瀏覽器；已顯式設為 `false`。
10. **第四輪稽核提出的四項既有弱點**（皆非本輪迴歸，一併收掉）。其一，Apollo 會把未處理
    錯誤的 `message` 原樣透傳，`attachments(instanceId:"not-a-uuid")` 因此回
    `invalid input syntax for type uuid: ...`——第 8 項只修好 DataSource 那條路徑，其餘
    resolver 沒有同等保護；改在 `app.module.ts` 加 `formatError`，僅當
    `code === 'INTERNAL_SERVER_ERROR'` **且** `unwrapResolverError()` 不是 `HttpException`
    時才換成固定字串。**這個判斷是必要的**：Nest 的 `HttpException` 在 GraphQL 下 code 同樣
    是 `INTERNAL_SERVER_ERROR`，若只看 code 就替換，會把
    `FORM_DATA_SOURCE_*` 這類前端賴以顯示對應文案的穩定錯誤碼一併吃掉。其二，
    `uploadAttachment` 宣告 `@Max(10MB)`，但 Express 的 JSON body 預設上限 100KB、base64
    再膨脹 4/3，實際約 74KB 就被 413 擋下，契約與實作差兩個數量級；host 改用
    `app.useBodyParser('json'|'urlencoded', { limit: '16mb' })` 對齊（不直接 import
    `express`，它不是 `apps/api` 的依賴）。其三，附件簽名密鑰用到內建預設值時的警告原本只在
    `NODE_ENV === 'production'` 才發，NODE_ENV 沒設好的 staging 會靜默使用套件內公開常數當
    簽名密鑰；改為只在明確的 `development`／`test` 才靜音。其四，`AllExceptionsFilter` 與
    附件 token 守衛都沒有測試保護，補上 `all-exceptions.filter.spec.ts`（10 例，涵蓋
    `expose` 才採信、只收 4xx、`status` 優先於 `statusCode`、非整數與越界拒絕、GraphQL
    context rethrow）與 4 例壞 token 案例；unit suite 由 300 增為 318。

11. **第五輪稽核發現的 F-1**。第 10 項讓未處理錯誤的 message 一律變成
    `Internal server error` 之後，FormRenderer 的 fallback
    （`readFormDataSourceErrorMessage(...) ?? requestError.message`）就把這串英文原樣渲染到
    欄位上——`readFormDataSourceErrorMessage` 只認得 `FORM_DATA_SOURCE_*`，非 DataSource
    錯誤一律回 `null`。兩處 fallback 改為固定中文「選項來源暫時無法使用。」，並補上
    regression test。這是 commit 295de6a「stop showing raw DataSource error codes」
    尚未收尾的最後一角：該次處理了錯誤碼，沒處理非 DataSource 的原始訊息。

12. **AutoComplete 收到 `waitingForFieldKeys` 後鎖住輸入框**（第一輪瀏覽器稽核的
    FINDING 2，因報告延遲送達而最後處理）。AutoComplete 是唯一不做前置 gate 的控制項——
    其他控制項一載入就查詢，能在使用者作答前就知道要不要等；AutoComplete 只在輸入時才
    查詢，若也樂觀鎖住，綁到 optional parameter 的欄位會因無法輸入而永遠解不開。但原本
    收到 `waitingForFieldKeys` 後會 disable，此時使用者已經打了字，那段文字就卡在鎖住的
    輸入框裡既不能改也不能清。改為 AutoComplete 只有 `readonly` 才 disable，等待狀態改由
    狀態列呈現；其餘控制項行為不變。ADR §3.11 原本寫「所有動態 control 共用下列行為」而
    未標註例外，已補上說明。

同輪修正的測試工具地雷：`form-data-source-real.spec.ts` 的 `chooseOption()`／`openSelect()`
原本點 `.mzn-select-trigger` 的幾何中心。當 `multiple` select 帶有 chip 時，該點落在**第一個
chip 的關閉圖示**上——舊寫法會靜默移除一個已選值且不展開選單。兩者改為共用
`openSelectTrigger()`，改點 `.mzn-select-trigger__suffix-action-icon`（chevron）。

> 第一版修法改點「內層 input」是錯的，由稽核以 `document.elementFromPoint()` 反證：input 的
> bounding box 幾乎等於 trigger（310×36 vs 312×38），與幾何中心打在同一個像素，同樣被 chip
> 圖層蓋住，只是改為 Playwright interception timeout 而非默默刪值。真正的地雷也不是 `+N`
> overflow counter，而是可見 chip 的關閉鈕。

同時補上 AutoComplete 例外的回歸護欄（`FormRendererView.spec.tsx`）：斷言等待狀態下
AutoComplete 為 enabled、Select／Radio／Checkbox 為 disabled。該護欄以突變測試驗證過確實會
抓錯——把 `autoCompleteDisabled` 改回 `optionControlDisabled` 會讓它變紅。**前兩版護欄都是假的**：
AutoComplete 不做前置 gate，不先觸發搜尋就不存在等待狀態；且必須等回應被套用（欄位內出現
提示文字）而非等查詢發出，否則突變後照樣全綠。

13. **分頁來源的第二頁在 Select 上永遠選不到**（由第八輪稽核在複驗時挖出）。下拉選單只有在
    內容溢出時才會觸發 `onReachBottom`，而 `demo.cost-centers` 每頁 3 筆、恰好填滿選單
    （`clientHeight` 108 = `scrollHeight` 108），於是永遠不會捲動、`nextCursor` 永遠不被
    消費——TW01 底下的 004–008 在 Select 控制項中**完全無法選取**。這是典型的「首頁資料量
    小於視窗高度 ⇒ 無限捲動死鎖」，只要選單高度大於首頁筆數就會重演，等於 ADR §3.5 允諾的
    CURSOR 分頁在最主要的控制項上不可用。改為載入後若仍有 `nextCursor` 且累積筆數少於可捲動
    門檻（10）就自動續載，直到足以捲動或來源耗盡；並防住「回空頁卻仍給 cursor」的無限迴圈。
    Radio／Checkbox 走 `pageSize: 50` 的完整清單來源、AutoComplete 靠搜尋，都不受影響。

14. **每個動態欄位重複發出 4 次首頁查詢**（第九輪稽核在複驗時量到）。`useFormDataSourceField`
    的三處 effect／callback 相依項用了 `dynamicField` 的**物件識別**，而該物件由父層每次
    render 重建，於是同一次相依變動會重跑 4 次、前 3 次被 abort。改以內容簽章
    （`fieldKey` + `type` + `dataSource`）取代物件識別後，整段流程（開頁＋選廠別）降為 3 次。
    分佈才是重點：**相依變動本身已收斂到 1 次（理論最佳）**——稽核實測初次掛載 2 次、選
    廠別 1 次，之後每次相依變動（TW01 → TW02）都穩定為 1 次。ADR §3.12「保護上游」在穩態
    下已完全達成，殘留的只有一次性的掛載成本（來自 launch context 載入完成後的額外 render）。

同輪改進：client 各 query 與 `requestGraphQl()` 支援 optional `AbortSignal`；submit 的
provider 呼叫加並行上限 4；GraphQL input 全面加 `@MaxLength`；前端將可修正的錯誤
（如 `SEARCH_TOO_SHORT`）與「來源壞掉」分級，不再一律 `UNAVAILABLE`、也不再誤擋送出。

第二輪稽核後的驗證結果：

- `npx nx run-many -t test -p bpm-core shared bpm-core-client bpm-core-react --runInBand`：
  4 個 project 合計 43 suites / 415 tests 全通過（`bpm-core` 318、`bpm-core-client` 49、
  `shared` 31、`bpm-core-react` 17；先前版本誤把單一專案的數字當成總數）。
- `pnpm typecheck`：6 projects 全通過。
- `pnpm lint`：0 errors、2 個既有 warnings。
- `pnpm demo:reset` 後 `pnpm e2e:client --workers=1`（system Chrome，未設定任何 `E2E_*`
  變數，打 supervisor 管理的 17602／17603）：**50 passed / 0 failed**，即原本 43 項加上
  7 項新增的 DataSource 案例。

新增的 7 項 e2e 案例（`apps/client-e2e/specs/form-data-source-real.spec.ts`）：

| 案例                                       | 對應問題 |
|--------------------------------------------|----------|
| optional binding 未填仍可使用控制項        | 2        |
| optional binding 填值後選項收斂            | 2        |
| 切換 plant 後舊值轉 INVALID 並擋住重新送出 | 1、6     |
| 唯讀未填欄位不顯示錯誤                     | 3        |
| 清空必填動態欄位後阻擋重新送出             | 7        |
| 清空必填值時仍可取消退回案件               | 7        |
| 分頁來源第二頁的選項可被選取               | 13       |

## 1. 目標

在不破壞既有靜態表單與 primitive `FormFieldValue` contract 的前提下，交付由宿主後端
註冊、Template Designer 選用的選項 DataSource，並涵蓋：

- Select 單選／複選。
- AutoComplete 單選／複選。
- Radio 單選。
- Checkbox 複選。
- 依其他表單欄位建立 parameter bindings。
- Designer Catalog、Preview 與發布 lint。
- 發起、退回編輯、重新送出、唯讀歷史顯示。
- Server-side resolve、label snapshot 與 DataSource 版本鎖定。
- External NestJS wrapper host provider contract。

## 2. 交付原則

1. 每個 Phase 只交付一個可驗證的 contract slice；前一個 gate 未通過不得宣稱下一個
   Phase 完成。
2. Backend authorization、server-side resolve 與 snapshot 先於可對一般使用者開放的
   runtime UI。
3. Mocked Playwright 只作快速 UI regression；完成證據必須包含真實 API、GraphQL、DB 與
   browser interaction。
4. `apps/api` 只提供 wrapper-host registration 與 deterministic demo source；可重用領域
   行為放在 `libs/bpm-core`。
5. Mezzanine control 必須使用既有 `Select`、`AutoComplete`、Radio／Checkbox primitives，
   不重造互動元件或覆寫既有 UX 結構。
6. 任一 `libs/*/src/**` public surface 變更都要在同一 scope 更新
   `docs/api-reference.md` 與相應 package README／CHANGELOG。
7. 不在 Phase 中自動建立 cloud resource、Vault secret、部署、commit 或 push。

## 3. Phase 總覽

### Phase 0 — Contract Lock

**目的**：在改 code 前鎖定名稱、資料形狀、權限與相容策略。

**交付內容**：

- Review 並接受 ADR 14。
- 確認 public type 命名、GraphQL operation naming 與 error code namespace。
- 確認 `BPMRootModule` 使用單一 registry provider，而不是多重 Nest provider 陣列。
- 確認 `approval_instances.form_data_option_snapshot` 欄位名稱與 JSON contract。
- 確認 default revalidation policy 為 `WHEN_VALUE_OR_BINDINGS_CHANGE`。
- 確認 Radio／Checkbox V1 complete-list 上限為 50。
- 確認動態欄位 V1 不支援 default value 與 CEL binding。

**Gate P0**：

- ADR 沒有未標示的 open decision。
- Shared、NestJS、GraphQL、client、React 與 DB contract 能由同一組術語對應。
- Breaking／additive package impact 已明確標示。

### Phase 1 — Shared Schema、Normalization 與 Publish Lint

**目的**：先建立純資料 contract，讓所有後續層共用相同語意。

**主要範圍**：

- `libs/shared/src/lib/form.ts`
- `libs/bpm-core/src/lib/form/form-schema.validator.ts`
- `libs/bpm-core-client/src/lib/form/form-api.ts`
- `libs/bpm-core-client/src/lib/form/form-rendering.ts`
- 對應 Jest specs、package exports、README、CHANGELOG、`docs/api-reference.md`

**交付內容**：

- 新增 `autocomplete` field variant。
- Select／AutoComplete 新增 `mode`，舊資料 normalize 為 single。
- Radio／Checkbox 從原本的 select union 拆成具有固定 mode 的明確 definitions。
- 建立 `FormFieldOptionSource`、`FormDataSourceReference`、binding 與 snapshot shared types。
- 建立 pure normalization helpers，讓舊 schema 不需資料 migration。
- Structural lint：source XOR、mode/value type、binding shape、field reference、duplicate
  parameters、動態 default value prohibition。
- 建立 dependency graph 與 cycle detection。
- 保留舊靜態 `options` 行為與既有 schemaVersion 1 parsing。

**必要測試**：

- 舊 select／radio／checkbox schema 全部仍通過並產生原值。
- Select／AutoComplete single 與 multiple default normalization。
- `options`、`dataSource` 同時存在或同時缺少會失敗。
- 不存在 field binding、重複 parameter、自我依賴與多節點 cycle 會失敗。
- 靜態 multiple default value 型別正確；動態 default value 一律失敗。
- JSON parse/lint error path 能精確指出 field index、field key 與 binding。

**Gate P1**：

- shared、client、core focused unit tests 通過。
- 既有 form builder／renderer unit tests沒有 regression。
- `pnpm typecheck` 與 `pnpm lint` 通過。
- Public API Reference 與實際 exports 一致。

### Phase 2 — NestJS Registry 與 GraphQL Query Boundary

**目的**：建立安全、可嵌入且可由宿主替換的 DataSource runtime。

**主要範圍**：

- `libs/bpm-core/src/lib/form-data-source/**` 或 form domain 下等價模組
- `libs/bpm-core/src/lib/bpm/bpm-root.module.ts`
- `libs/bpm-core/src/lib/bpm-auth/**`
- `libs/bpm-core-client/src/lib/form/**`
- 對應 exports、specs、README 與 consumer quickstart

**交付內容**：

- `BPM_FORM_DATA_SOURCE_REGISTRY` injection token。
- `BPMFormDataSourceRegistry`、descriptor、search/resolve request/result contract。
- `BPMRootModule.forRoot()`／`forRootAsync()` optional registry provider wiring。
- 未註冊 registry 時的 empty catalog 與 stable unavailable error。
- Designer-only `formDataSources` query。
- Designer-only `previewFormFieldOptions` query。
- Authenticated `formFieldOptions` runtime query。
- Runtime query 由 published form version 或 instance snapshot 取得權威 reference。
- Launchability、instance readability 與 resubmit authorization checks。
- Stable error codes：source missing、version missing、unsupported control、waiting bindings、
  timeout、provider failure、invalid provider result。
- Timeout、search length、parameter size、page size 與 result count guard。
- Structured redacted logging；不得記完整 form values 或 secret。

**必要測試**：

- `forRoot`、`forRootAsync`、`useClass`、`useFactory`、`useExisting` host wiring。
- 沒有 registry 的既有 host 仍可 bootstrap。
- Designer 可讀 catalog／preview；一般 member 不可讀。
- 可發起者可查 published form field；不可發起者被拒絕。
- 可 resubmit instance 的 initiator 可查；無關 member 被拒絕。
- 瀏覽器偽造 key/version/bindings 不會改變 server authoritative reference。
- Provider timeout、throw、duplicate value、empty value、unexpected value、oversize result。
- Logs 與 GraphQL error 不含 URL、Header、raw bindings、SQL 或 upstream body。

**Gate P2**：

- Registry contract 可由一個獨立 Nest test host 實際注入並查詢。
- GraphQL success、permission、negative 與 provider failure tests 通過。
- `pnpm nx test bpm-core --runInBand`、typecheck、lint、build 通過。
- Consumer quickstart 能只靠 public package exports 完成 wiring。

### Phase 3 — Submission Resolve、Snapshot 與編輯一致性

**目的**：在 UI 開放動態選項前，先完成不可繞過的資料完整性保護。

**主要範圍**：

- `libs/bpm-core/src/lib/migrations/**`
- `libs/bpm-core/src/lib/workflow-engine/approval-instance.entity.ts`
- `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`
- Workflow GraphQL object/client records
- 對應 service、migration 與 workflow specs

**交付內容**：

- Migration：`form_data_option_snapshot jsonb NOT NULL DEFAULT '{}'`。
- Entity、GraphQL JSON accessor 與 client record exposure。
- Canonical binding serialization 與 SHA-256 `bindingHash`。
- Submit 時對所有有值的動態欄位做 server-side resolve。
- Resubmit 實作 `ALWAYS` 與 `WHEN_VALUE_OR_BINDINGS_CHANGE`。
- unchanged value + unchanged binding hash 可沿用符合 policy 的 snapshot。
- changed value／bindings 必須 resolve；部分成功不得寫入。
- clear value 移除 snapshot；multiple snapshot 維持 schema value order。
- Transaction boundary：外部 resolve 不持有 DB transaction；resolve 後進入 transaction
  lock／重讀並確認 instance revision、formData 與 authorization context 未變，再原子寫入
  formData/snapshot。失敗不留下半套資料。
- Read-only history 不需 registry 即能顯示保存 label。

**必要測試**：

- Migration up/down 與既有 row default。
- 單選／複選 snapshot 正確保存 value、label、source version、hash、timestamp。
- 偽造 value、缺少 value、disabled/deleted value、partial multiple resolve 被拒絕。
- `WHEN_VALUE_OR_BINDINGS_CHANGE`：完全未變時不呼叫 provider。
- value 未變但 dependency 改變時必須 resolve。
- `ALWAYS` 每次重新送出都 resolve。
- Provider unavailable 時，不需要 resolve 的 unchanged snapshot 可重新送出；需要 resolve 的
  submission 被拒絕且 instance 原資料不變。
- Resolve 後、transaction 寫入前 instance 已被其他 request 修改時，舊 resolve 結果不得
  覆蓋新資料。
- Source 下架後，舊 instance read-only label 仍可顯示。
- Static field submission behavior 不變。

**Gate P3**：

- Migration 與 workflow focused tests 通過。
- 直接 GraphQL mutation 無法繞過 dynamic option validation。
- Snapshot round-trip 經 GraphQL/client parse 後不遺失資料。
- `pnpm nx test bpm-core --runInBand`、typecheck、lint、build 通過。

### Phase 4 — Client Adapter 與 FormRenderer Controls

**目的**：完成一般使用者可操作的 async control，但維持 renderer transport boundary。

**主要範圍**：

- `libs/bpm-core-client/src/lib/form/**`
- `libs/bpm-core-react/src/views/forms/renderer/**`
- React DataSource adapter/provider/hooks
- 發起頁與 instance form section wiring
- 對應 client/react unit、component 與 mocked Playwright specs

**交付內容**：

- Client catalog、preview、runtime query wrappers。
- FormRenderer DataSource context／adapter contract。
- Shared option merge、selected hydration、paging、search 與 resolve state reducer。
- Select single／multiple。
- AutoComplete single／multiple，使用 Mezzanine `asyncData` 與預設 300ms debounce。
- Radio dynamic complete-list rendering。
- Checkbox dynamic complete-list rendering。
- `WAITING_FOR_DEPENDENCIES`、`LOADING`、`VALID`、`STALE`、`INVALID`、
  `UNAVAILABLE` UI。
- Abort/supersede 舊 request；舊 response 不可覆蓋新 query。
- Selected snapshot option 與分頁結果 immutable merge。
- Read-only instance 只讀 snapshot，不發 runtime query。
- 編輯時 query error、換頁、搜尋或 options refresh 都不得自動清除值。

**必要測試**：

- 四種 control 的 static regression 與 DataSource rendering。
- Select／AutoComplete single、multiple onChange value shape。
- AutoComplete debounce、minimum search length、loading、empty、retry。
- 快速變更 dependency／search text 時只採用最後 response。
- Selected value 不在目前 page 時仍顯示 snapshot label。
- Partial invalid multiple value 逐項標示並阻止提交。
- Read-only render 在 registry/API unavailable 時仍顯示 label，且 network call count 為零。
- 不可編輯／等待 dependency 的 control 使用正確 disabled/readOnly semantics。

**Gate P4**：

- client/react focused tests、typecheck、lint、build 通過。
- Mocked Playwright 能覆蓋 loading、empty、error、stale、invalid 與 race UI。
- 在實際 consumer page 點擊、輸入、搜尋、選取、清除及複選互動通過；不能只用 DOM
  existence 作證。

### Phase 5 — Form Builder Catalog、Bindings 與安全編輯

**目的**：讓 Template Designer 能以受控 UI 設定來源，而不接觸 transport detail。

**主要範圍**：

- `libs/bpm-core-react/src/views/forms/builder/FormBuilderView.tsx`
- Form Builder client/controller helpers
- Form publish lint integration
- Template compose embedded builder
- Builder tests與 Playwright specs

**交付內容**：

- 欄位新增清單加入 AutoComplete。
- Select／AutoComplete mode 設定。
- 四種 control 的「靜態選項／DataSource」來源切換。
- DataSource Catalog picker，只顯示支援目前 control 的來源與版本。
- Descriptor-driven parameter binding UI，只能選型別相容的表單欄位。
- 顯示 required/optional parameter、source capability、search behavior 與 revalidation policy；
  policy 唯讀。
- Designer Preview：使用目前 preview form values 查詢。
- Field key rename 自動更新 bindings。
- 刪除 dependency field 前顯示 affected fields 並要求確認。
- Source/control/mode 切換顯示資料失效 impact，不靜默丟棄設定。
- Dependency graph/cycle 與 environment lint 在 publish 前顯示 field-level error。
- Source version upgrade 採顯式選擇、重綁、preview、publish 流程。
- Missing registry version 保留原 JSON、顯示 unavailable，禁止發布新版本。

**必要測試**：

- Catalog 依 control capability 過濾。
- Radio／Checkbox 不顯示 searchable-only 或超過 50 筆的來源。
- 所有 parameter binding、缺少 required parameter、型別不相容與 cycle error。
- Rename、delete、source switch、mode switch 與 explicit version upgrade。
- Preview 使用目前填寫的 dependency value，且一般 member 無法直接呼叫 preview。
- Advanced JSON 編輯與 visual builder round-trip 不遺失 DataSource reference。
- Unsaved dirty guard 仍涵蓋 DataSource 設定變更。

**Gate P5**：

- Designer 能建立四種 control 的 dynamic field，完成 preview、lint、publish。
- Published schema 經 reload／version history round-trip 後完全相同。
- 實際 browser 驗證過來源切換、binding、preview、cycle error、publish blocking 與 dirty
  guard。
- static form builder 全部既有行為仍通過。

### Phase 6 — Wrapper Host、Seeded Golden Path 與文件收斂

**目的**：證明公開 package contract 可被真實宿主消費，並完成可重現交付證據。

**主要範圍**：

- `apps/api` wrapper-host DataSource registry/provider
- `apps/api/tools/reset-demo-data.ts`
- `apps/client-e2e/specs/**`
- Root/package README、consumer quickstart、data model、API reference、roadmap

**Deterministic host fixture**：

在 `apps/api` 建立 host-owned demo DataSource，例如 `demo.cost-centers@1`。來源資料由
wrapper app seed 擁有，不放進 reusable BPM domain。建議資料包含：

- `plant = TW01`：多筆有效成本中心。
- `plant = TW02`：另一組成本中心。
- 同 value 在不同 plant 下有效性不同的案例。
- 已停用 value，供失效編輯測試。
- 搜尋結果超過一頁，供 pagination／selected merge 測試。
- 至少一個 `ALWAYS` source 與一個 `WHEN_VALUE_OR_BINDINGS_CHANGE` source。

若新增 wrapper-host table，建立／reset ownership 必須留在 `apps/api`，不可放入
`BPM_CORE_MIGRATIONS`。

**交付內容**：

- `BPMRootModule` 真實 registry wiring。
- `pnpm demo:reset` 建立 deterministic host source data、dynamic form、published template
  及 returned instance editing scenario。
- Seeded real browser golden path。
- Wrapper integration、security、performance 與 read-only history coverage。
- 更新 ADR/Phase implementation status、`docs/06-data-model.md`、root/package README、
  consumer quickstart、API reference、roadmap 與 AGENTS Progress Notes。

**Gate P6**：

- 完成下節所有 E2E matrix。
- Repository-wide typecheck、lint、test、build 通過。
- `pnpm e2e:client` 從確認可重置的 develop seed 完整通過。
- 真實瀏覽器互動與 GraphQL/DB assertions 有可重現 evidence。
- External wrapper test app 或等價 Nest integration fixture 只使用 published exports。
- 沒有 debug script、暫存 fixture、secret、trace 或 test artifact 被誤納入交付。

## 4. E2E Suite Matrix

### 4.1 Environment／Migration／Seed

- API、GraphQL、Client reachability；bare GraphQL GET 回 `400` 可視為 endpoint reachable。
- Migration up/down 與既有 instance default snapshot。
- `pnpm demo:reset` 建立 registry fixture、動態表單、模板、returned instance 與 source data。
- Reset 後 source data、form schema、template version 與 instance snapshot ID 可穩定定位。

### 4.2 Form Builder Journey

- Designer 登入。
- 建立 plant 靜態欄位。
- 建立 Select single、Select multiple、AutoComplete single、AutoComplete multiple、Radio、
  Checkbox 六個 DataSource-backed cases。
- 選 `demo.cost-centers@1`，綁定 plant，執行 preview。
- 驗證 unsupported source 不可選、missing binding、cycle 與 missing provider version。
- 發布後 reload schema 與 version history，確認 key/version/bindings/mode 不漂移。

### 4.3 Launch／Submit Journey

- Requester 開啟 published template。
- 未填 plant 時 dependent controls disabled 並有說明。
- 選 plant 後 Select／Radio／Checkbox 載入完整或 bounded options。
- AutoComplete 輸入搜尋、等待 debounce、載入下一頁、單選與複選。
- 送出後用 GraphQL/DB 確認 primitive formData 與 option snapshot。
- 直接 GraphQL 偽造 value 必須被後端拒絕。

### 4.4 Return／Edit／Resubmit Journey

- Approver 退回案件，Requester 開啟編輯。
- API 查詢前立即看到 snapshot label。
- 不改 value/bindings 的 `WHEN_VALUE_OR_BINDINGS_CHANGE` 欄位沿用 snapshot。
- 改 plant 後既有 value 保留並成為 stale；resolve 有效時保留，無效時顯示錯誤並阻擋。
- Provider unavailable 時不自動清值；需要 resolve 的 submit 被阻擋且 DB 原資料不變。
- `ALWAYS` source 每次 resubmit 都呼叫 provider。
- 清除或替換選項後 snapshot 正確移除／更新。

### 4.5 Read-only History Journey

- DataSource provider 暫時 unavailable 或 registry 不再提供該版本。
- Initiator／approver 仍可在 instance detail 看見原 label。
- Read-only render 不呼叫 runtime option API。
- Unrelated member 仍無法讀 instance 或 option snapshot。

### 4.6 Wrapper Contract／Security／Performance

- Nest test host 使用 public `BPMRootModule`、registry token 與 contracts 成功 bootstrap。
- Designer permissions、launchability、readability、resubmit ownership 各有 allow/deny case。
- Form payload 無法傳入任意 URL、Header、key/version 或 binding override。
- Search/result/parameter limits、timeout 與 upstream error redaction。
- AutoComplete rapid input 不產生 stale render；request 數符合 debounce 預期。
- Bounded source 在 page size 與 response-time budget 內；Radio／Checkbox 超量來源被拒絕。

## 5. 現有 Spec 與新增 Spec 策略

優先擴充：

- `apps/client-e2e/specs/form-builder-w2.spec.ts`：快速 UI regression 與 Designer config。
- `apps/client-e2e/specs/workflow-linear-w5.spec.ts`：發起、退回、重新送出整合。
- `apps/client-e2e/specs/workspace-routes-seeded.spec.ts`：read-only snapshot smoke。

新增 seed-backed real-flow spec：

- `apps/client-e2e/specs/form-data-source-real.spec.ts`：真實 API、DB、registry、builder、launch、
  edit/resubmit、history golden path。

新增 wrapper integration fixture/spec：

- 驗證外部 Nest host 只透過 package public exports 註冊 DataSource。
- 不允許測試直接 import `libs/bpm-core/src/**` internal path。

## 5.1 已知限制與後續 backlog

以下由 2026-08-16 的六輪獨立稽核提出，經評估**不屬於 DataSource 這個題目**，未在本輪處理：

- **`skill-matrix-real.spec.ts:582` 的測試隔離問題**。該斷言要求 seed 通知
  `SLA 已逾期：鋁合金胚料採購` 出現在通知中心第一頁，而 `notification-drawer.tsx` 以
  `includeRead: true`、`PAGE_SIZE = 50` 取第一頁。每跑一次 e2e 就替 member-001 多累積數筆
  通知，累計超過 50 筆後該 seed 通知被擠到「載入更多」之後，斷言**必然**開始失敗（不是
  flaky，重跑不會過）。`pnpm demo:reset` 後即恢復，因此「full suite 49 passed」這個基準
  只在剛 reset 過的 DB 上成立。修法擇一：改以 seed 通知 id 篩選、改打
  `notifications(recipientMemberId, page/pageSize)` 直接斷言資料而非 UI 第一頁、或讓該
  spec 在 `beforeAll` 先歸檔測試自產的通知。
- **`admin-orgs.spec.ts:101`（org tree 拖放）偶發失敗**，屬 mouse 事件時序 flaky，單獨
  重跑會過。
- **`workflow-org-resolution-real.spec.ts:168`**：該 spec 會在單次執行內連續建立多個模板
  （`exhaustively creates templates`），再回模板列表用名稱定位剛建立的那一列。模板列表變長
  後新建的列會被擠出第一頁，於是
  `getByRole('row').filter({ hasText: '平行 AND 匯合 org-...' })` 等不到而 timeout。這是
  spec 自身的定位設計問題（**與 DataSource 無關**，該檔對 `dataSource`／`costCenter` 的
  grep 命中數為 0），在機器負載高、列表回應變慢時更容易暴露。修法方向：改以模板 id 定位、
  或建立後直接導向該模板頁面，而不是回列表用名稱找。
- **`adhoc-directives.spec.ts:370` 與 `skill-matrix-real.spec.ts:246`**：跑完整核准流程的
  重測試，在高機器負載下會出現 `已同意` 等狀態文字等不到的 timeout，單獨重跑即過。
  判定方式：`pnpm dev:ctl restart client` 後 `pnpm demo:reset` 再跑。實測一次：重啟前
  2 failed、重啟後 50 passed。
- **動態欄位在頁面首次掛載時會多發 1 次首頁查詢**（見上方第 14 項）。相依變動後的穩態已是
  1 次／次，只有掛載階段因 launch context 載入造成一次額外 render。影響小，屬 FormRenderer
  render 最佳化範疇。

## 6. 完成條件

此功能只有在下列條件全部成立時才可標記完成：

- ADR 14 的所有 invariants 有 code、test 或 runtime evidence。
- 四種 control 與所有 selection mode 都有正向、負向與編輯 coverage。
- GraphQL query/mutation 無法繞過 registry、authorization 或 server-side resolve。
- 真實 DB 保存 primitive value、source version、label snapshot 與 binding hash。
- 歷史案件在來源 unavailable 時仍可顯示，不會發 network query。
- Returned instance 編輯不會靜默清除值，stale／invalid／unavailable 行為已實際點擊驗證。
- Static options、existing forms、existing instances 與 package consumer 沒有 regression。
- Full checks 與 `pnpm e2e:client` 通過；mock-only evidence 不算完成。
- `docs/api-reference.md`、data model、embedding docs、quickstart、roadmap 與 package changelog
  均與實作一致。

## 7. 建議執行順序與平行界線

唯一主路徑：

1. P0 Contract Lock。
2. P1 Shared Schema／Lint。
3. P2 Registry／GraphQL。
4. P3 Submit／Snapshot。
5. P4 Renderer。
6. P5 Builder。
7. P6 Wrapper／E2E／Docs。

P2 完成 public contract 後可有限平行：

- Backend agent：P3 migration、resolve、snapshot。
- Frontend agent：P4 async state reducer 與 control component tests，但不得對一般使用者
  開放 runtime UI，直到 P3 gate 通過。
- Builder agent：P5 Catalog／binding UI，可使用 P2 preview API；publish integration 等 P1/P2
  gates 穩定後再接。

同一檔案 owner 必須單一，尤其：

- `libs/shared/src/lib/form.ts`
- `libs/bpm-core/src/lib/bpm/bpm-root.module.ts`
- `libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts`
- `libs/bpm-core-react/src/views/forms/builder/FormBuilderView.tsx`
- `docs/api-reference.md`

## 8. 執行驗證前置條件

本文件只規劃、不授權啟動或重置環境。實作驗證時先確認使用者已啟動服務：

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:17602
curl -s -o /dev/null -w '%{http_code}' http://localhost:17603/graphql
curl -s -o /dev/null -w '%{http_code}' http://localhost:17603/api/health
```

若要執行 deterministic full coverage，須先取得對 develop schema destructive reset 的明確
同意，再執行：

```bash
pnpm demo:reset
```

服務由使用者啟動為預設；若未找到有效服務，必須先詢問，不自行啟動。

### E2E 執行參數

`pnpm e2e:client` 預設打 `http://localhost:17602`（client）與 `http://localhost:17603`
（wrapper host API），DataSource golden path 不再需要額外變數即會執行。需要指向其他
主機時才覆寫：

| 變數                         | 預設值                       | 用途                            |
|------------------------------|------------------------------|---------------------------------|
| `E2E_BASE_URL`               | `http://localhost:17602`     | Playwright baseURL（client）    |
| `E2E_API_URL`                | `http://localhost:17603`     | wrapper host API                |
| `E2E_DATA_SOURCE_API_URL`    | 同 `E2E_API_URL`             | DataSource golden path 專用覆寫 |
| `PLAYWRIGHT_EXECUTABLE_PATH` | 無（用 Playwright chromium） | 改用 system Chrome 執行         |

若本機沒有安裝 Playwright chromium，以 system Chrome 執行：

```bash
PLAYWRIGHT_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  pnpm e2e:client --workers=1
```
