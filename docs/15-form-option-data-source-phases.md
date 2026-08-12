# 15 — 表單選項 DataSource 開發 Phase

- **狀態**：Phase 0–6 code 已實作；P6 full-suite gate 待收斂
- **規劃日期**：2026-08-11
- **權威決策**：[14 — ADR：表單選項 DataSource 架構](./14-form-option-data-source-adr.md)
- **完成定義**：所有 Phase gate、真實 wrapper-host journey 與文件同步完成

截至 2026-08-12，P0–P5 gates 已完成，P6 的 wrapper registry、deterministic seed、
GraphQL/DB golden path、package consumer wiring 與真實 Chrome golden path 已完成。新增
DataSource real spec 單獨通過；repository-wide `pnpm e2e:client` 在 system Chrome、
單 worker 下為 33 passed / 10 failed，失敗集中在非本次 DataSource 的 ad-hoc／notification／
skill-matrix／legacy designer／workspace seeded journey；目前不將這些 failure 直接判定為
既有，故 P6 尚保留為未全綠 gate，不宣稱整體完成。

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
