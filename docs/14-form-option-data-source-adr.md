# 14 — ADR：表單選項 DataSource 架構

- **狀態**：Accepted
- **決策日期**：2026-08-11
- **實作狀態**：Planned，尚未進入程式實作
- **適用範圍**：Form Builder、FormRenderer、案件發起、案件退回編輯與重新送出、BPM 宿主整合
- **交付規劃**：[15 — 表單選項 DataSource 開發 Phase](./15-form-option-data-source-phases.md)

## 1. 背景

目前 `select`、`radio`、`checkbox` 欄位只接受寫在 Form Definition Schema
中的靜態 `options`。FormRenderer 直接使用該清單，後端發布 lint 也要求選項至少
一筆。案件送出與重新送出雖會依表單 schema 驗證必填條件，但不會向選項來源確認
送入的 value 是否存在或仍可使用。

實際整合情境需要讓 Template Designer 根據其他表單欄位查詢宿主系統資料，例如：

- 依工廠查詢成本中心。
- 依公司別查詢供應商。
- 依產品線查詢專案或合約。
- 依申請日期與組織查詢可用預算科目。

這些來源可能需要宿主憑證、權限過濾、分頁、搜尋、逾時控制與稽核。如果把 URL、
Header、Token 或查詢模板直接存進表單 schema，會讓瀏覽器持有整合細節，也會造成
SSRF、憑證外洩、越權查詢及歷史案件顯示漂移。

## 2. 決策驅動因素

本 ADR 優先滿足下列要求：

1. DataSource 由宿主後端開發者註冊，Template Designer 只能選擇已註冊來源。
2. Select 與 AutoComplete 都支援單選、複選。
3. Radio 與 Checkbox 也可使用 DataSource；Radio 固定單選，Checkbox 固定複選。
4. 查詢參數可直接綁定其他表單欄位。
5. 表單版本與既有案件不因 DataSource 升版或下架而改變顯示內容。
6. 案件編輯不因背景查詢或暫時性 API 錯誤自動遺失既有值。
7. 瀏覽器送入的 value 必須能在後端被重新解析及驗證。
8. `@rytass/bpm-core-nestjs-module` 保持可嵌入，不耦合單一 ERP、資料庫或 HTTP API。

## 3. 決策

### 3.1 採用宿主註冊的 DataSource Registry

BPM core 定義 DataSource contract 與 registry injection token；真正的 API URL、資料庫
查詢、憑證、Header、簽章及領域授權由宿主 provider 實作。

`BPMRootModule` 新增 optional host provider wiring。未註冊 registry 的既有宿主仍能
使用全部靜態選項功能，但 Designer Catalog 為空，動態欄位顯示 unavailable。

表單 schema 只保存：

- DataSource `key`。
- 精確 `version`。
- 參數與表單欄位的 bindings。
- 欄位控制項與 selection mode。

表單 schema 不得保存：

- 任意 URL 或 HTTP method。
- Authorization Header、API Token 或其他 secret。
- 可執行 SQL、GraphQL、JSONPath 或字串插值查詢模板。
- 可由瀏覽器偽造的 member／organization authorization context。

### 3.2 四種選項控制項共用 Option Source

V1 的控制項能力如下：

- `select`：`single` 或 `multiple`；靜態或 DataSource。
- `autocomplete`：`single` 或 `multiple`；靜態或 DataSource。
- `radio`：固定 `single`；靜態或 DataSource。
- `checkbox`：固定 `multiple`；靜態或 DataSource。

為保持舊 schema 相容，既有 `options` 不改名；`options` 與 `dataSource` 為互斥 union。
舊 `select` 沒有 `mode` 時視為 `single`。`autocomplete` 沒有 `mode` 時也視為
`single`。

規劃中的 shared contract：

```ts
export type FormFieldOptionSource =
  | {
      readonly dataSource?: never;
      readonly options: readonly FormFieldOption[];
    }
  | {
      readonly dataSource: FormDataSourceReference;
      readonly options?: never;
    };

export type FormSelectionMode = 'multiple' | 'single';

export type SelectFieldDefinition = BaseFormFieldDefinition<'select'> &
  FormFieldOptionSource & {
    readonly mode?: FormSelectionMode;
  };

export type AutoCompleteFieldDefinition = BaseFormFieldDefinition<'autocomplete'> &
  FormFieldOptionSource & {
    readonly mode?: FormSelectionMode;
  };

export type RadioFieldDefinition = BaseFormFieldDefinition<'radio'> & FormFieldOptionSource;

export type CheckboxFieldDefinition = BaseFormFieldDefinition<'checkbox'> & FormFieldOptionSource;
```

欄位值維持目前的 primitive contract：

- single：`string | null | undefined`。
- multiple：`readonly string[] | null | undefined`。

不把表單值改成 `{ value, label }`，避免破壞 CEL、workflow routing、case title、host
integration 與既有 instance JSON。

### 3.3 V1 binding 只接受直接欄位與常數

規劃中的 schema reference：

```ts
export interface FormDataSourceReference {
  readonly bindings: readonly FormDataSourceBinding[];
  readonly key: string;
  readonly version: number;
}

export interface FormDataSourceBinding {
  readonly from:
    | {
        readonly fieldKey: string;
        readonly kind: 'FIELD';
      }
    | {
        readonly kind: 'CONSTANT';
        readonly value: boolean | number | string | null;
      };
  readonly parameter: string;
}
```

搜尋文字不透過 binding 傳入，而是 DataSource request 的獨立 `searchText`。目前登入者
及其 roles、permissions、metadata 由後端 `BPMAuthContext` 提供，不是表單參數。

V1 不支援 CEL、模板字串、運算式或多欄位組字。直接 binding 讓發布 lint 能靜態判斷：

- 來源欄位是否存在。
- 參數是否存在且型別相容。
- 必要參數是否都有綁定。
- DataSource 相依圖是否有 cycle。
- 刪除或改名欄位會影響哪些下游欄位。

### 3.4 DataSource contract 同時提供 search 與 resolve

每個宿主 DataSource 都要提供 descriptor、`search()` 與 `resolve()`：

```ts
export interface BPMFormDataSource {
  readonly descriptor: BPMFormDataSourceDescriptor;

  resolve(request: BPMFormDataSourceResolveRequest): Promise<readonly FormFieldOption[]>;

  search(request: BPMFormDataSourceSearchRequest): Promise<BPMFormDataSourceSearchResult>;
}

export interface BPMFormDataSourceDescriptor {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly maximumResultCount: number;
  readonly minimumSearchLength: number;
  readonly pageSize: number;
  readonly paginationMode: 'CURSOR' | 'NONE';
  readonly parameters: readonly BPMFormDataSourceParameter[];
  readonly revalidationPolicy: 'ALWAYS' | 'WHEN_VALUE_OR_BINDINGS_CHANGE';
  readonly returnsCompleteList: boolean;
  readonly supportedControls: readonly ('autocomplete' | 'checkbox' | 'radio' | 'select')[];
  readonly supportsSearch: boolean;
  readonly version: number;
}
```

`search()` 負責取得候選清單；`resolve()` 依 value 取得權威 label 並確認該 value 在目前
bindings 與 auth context 下可用。

DataSource request 必須包含由 server 解析的 `BPMAuthContext`。Provider 對外部資料仍負責
領域授權，BPM 的 authenticated guard 不能取代來源端的 row-level authorization。

### 3.5 DataSource capability 限制控制項

Designer 只能選擇 descriptor 宣告支援該控制項的來源。

Radio 與 Checkbox 必須一次顯示完整集合，因此只有同時符合下列條件的 DataSource 才能
使用：

- `returnsCompleteList = true`。
- `supportedControls` 包含目標控制項。
- `maximumResultCount <= 50`，V1 固定此上限。

Select 可使用 bounded list 或分頁來源。AutoComplete 可使用搜尋來源，並以 provider
descriptor 的 minimum search length、page size 與 result limit 保護上游服務。若來源需要
大量搜尋，不應偽裝成 Radio／Checkbox。

動態來源的 default value 不納入 V1，因為不同填寫者及 bindings 可能讓設計時選到的預設
值失效。靜態選項維持既有 default value 行為。

### 3.6 分離 Designer Catalog、Designer Preview 與 Runtime Query

規劃中的 GraphQL surface 分成三種用途：

1. `formDataSources`：Designer-only，回傳可選 descriptor，不回傳 secret 或 transport
   details。
2. `previewFormFieldOptions`：Designer-only，測試尚未發布的設定；後端先做 structural、
   registry 與 binding validation，再呼叫已註冊 provider。
3. `formFieldOptions`：authenticated runtime query；前端只提供 context id、field key、
   form values、search text 與 cursor。

Runtime query 必須從權威資料取得 DataSource reference：

- 發起頁：以 published form version／launch context 為準，並檢查目前使用者可發起該
  template。
- 退回編輯：以 instance 的 form definition snapshot 為準，並檢查目前使用者可讀且可
  resubmit 該 instance。
- 唯讀案件：不呼叫 Runtime Query，只讀案件 snapshot。

Runtime API 不接受瀏覽器直接送入任意 DataSource key、version 或 binding definition。

### 3.7 送出時由後端做權威 resolve

前端載入過某個 option 不代表它在送出時仍有效。`submitApprovalInstance` 與
`resubmitApprovalInstance` 必須在寫入 instance 前，對需要驗證的動態欄位呼叫
`resolve()`。外部 I/O 不可持有長時間 DB transaction：service 先讀取 immutable form
version 或 instance revision、在 transaction 外完成 bounded resolve，再進入 transaction
重新 lock／讀取並確認 revision、formData 與 authorization context 未變，最後才寫入
formData 與 snapshot。若重讀結果已改變，整次操作失敗並要求 client refresh，不使用舊
resolve 結果。

驗證規則：

- single value 必須 resolve 到完全相同的一筆 value。
- multiple values 必須全部 resolve；部分成功仍視為失敗。
- 重複 value、空 value、provider 回傳未請求 value 或超量結果視為 provider contract
  error。
- clear value 時移除該欄位的 option snapshot。
- resolve 失敗時不建立或更新 instance，不接受瀏覽器提供的 label 作為 fallback。

### 3.8 案件另存動態選項顯示快照

`approval_instances` 規劃新增 `form_data_option_snapshot jsonb NOT NULL DEFAULT '{}'`。
只有 DataSource-backed 欄位需要寫入；靜態選項已存在 immutable form schema snapshot。

規劃中的 snapshot contract：

```ts
export interface FormDataSourceValueSnapshot {
  readonly bindingHash: string;
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly options: readonly FormFieldOption[];
  readonly validatedAt: string;
}

export type FormDataSourceValueSnapshots = Readonly<Record<string, FormDataSourceValueSnapshot>>;
```

`bindingHash` 由後端將該欄位實際使用的 binding values canonicalize 後計算。資料庫不需要
為了重新驗證而保存完整參數副本，避免複製敏感表單內容。

歷史唯讀顯示一律使用 option snapshot，不向外部 API 查詢。DataSource 改 label、升版或
下架都不能改變既有案件畫面。

### 3.9 編輯與重新送出採用不自動清除原則

退回案件開啟編輯時：

1. 立即以 instance `formData` 與 `formDataOptionSnapshot` 顯示既有值。
2. 既有 snapshot option 必須合併進 control options；它不需要出現在目前搜尋頁。
3. 背景查詢、切頁、重新搜尋或 API error 不得自動刪除已選 value。
4. 使用者明確選新值或清除時才更新 form value。

重新送出時依 provider 的 revalidation policy 判斷：

- `ALWAYS`：每次重新送出都 resolve。
- `WHEN_VALUE_OR_BINDINGS_CHANGE`：value 與重新計算的 `bindingHash` 都沒變時，沿用既有
  snapshot；任一變更時必須 resolve。

預設 policy 為 `WHEN_VALUE_OR_BINDINGS_CHANGE`。人員有效性、庫存、合約或其他要求即時
有效性的來源，由宿主註冊為 `ALWAYS`。Template Designer 不得降低 policy。

當 value 或 bindings 已變更：

- UI 狀態先變成 `STALE`，保留舊值與 label。
- resolve 有效時更新 label、binding hash 與 `validatedAt`。
- resolve 確認無效時顯示 `INVALID`，保留舊 label 供使用者辨識，但禁止送出。
- API 暫時無法連線時顯示 `UNAVAILABLE`，不清除值；需要 resolve 的案件仍禁止送出。

規劃中的 field status：

```ts
export type FormDataSourceFieldStatus = 'IDLE' | 'WAITING_FOR_DEPENDENCIES' | 'LOADING' | 'VALID' | 'STALE' | 'INVALID' | 'UNAVAILABLE';
```

### 3.10 表單定義編輯遵循既有版本模型

Form Definition 的已發布版本仍為 immutable。Designer 修改 DataSource reference、binding、
control 或 mode 時，產生並發布新的 Form Definition Version；既有 instance 保持建立時
snapshot。

Builder 必須提供以下保護：

- 修改被其他欄位 binding 引用的 `fieldKey` 時，同步更新引用。
- 刪除被引用欄位前，列出受影響欄位並要求確認。
- 切換靜態／DataSource、變更來源、版本或 single／multiple 時，清楚說明會失效的預設值
  或 preview value，不靜默丟棄。
- DataSource 升版是顯式操作：選新版本、重綁參數、測試查詢、通過 lint 後發布。
- registry 缺少 referenced key/version 時，既有 schema 原文保留並顯示 unavailable；不得
  用其他版本假代。新版本發布必須阻擋。

宿主有責任在仍有 published form 或可編輯 instance 引用時保留對應 provider version。

### 3.11 查詢、競態與錯誤 UX

所有動態 control 共用下列行為：

- 必要 binding 尚未有值：disabled，顯示「請先填寫〈欄位〉」。
- 載入中：顯示 Mezzanine loading state。
- 查詢成功但無資料：顯示 empty state。
- 查詢失敗：顯示 inline error 與重試；不得偽裝成 empty state。
- AutoComplete 使用 Mezzanine async search，預設 300ms debounce。
- 新 request 取消或 supersede 舊 request；較舊 response 不得覆蓋新結果。
- 分頁或搜尋結果要與目前 selected options immutable merge。
- multiple resolve 有任一 value 失效時，欄位整體為 invalid，並逐項標示失效選項。

### 3.12 安全與可觀測性

Core 與 host provider 必須共同落實：

- Runtime query 與 submit/resubmit 使用 server-derived `BPMAuthContext`。
- Designer Catalog／Preview 受 Designer permission 保護。
- Runtime context 檢查 launchability 或 instance readability／resubmit ownership。
- 每次 query／resolve 設 timeout、page size、result count、search length 與 parameter size
  上限。
- Log 只記 source key、version、operation、duration、result count、status/error code；不記
  完整 bindings、search text、form values、credential 或 option payload。
- Generic core cache 預設不跨 request 快取 DataSource result。Provider 可依自身授權與
  freshness contract 實作 cache。
- Error message 對前端提供穩定錯誤碼，不暴露上游 URL、Header、SQL 或 response body。

## 4. 發布前驗證不變式

Form schema publish 必須同時通過兩層驗證：

1. **結構 lint**：純 schema 檢查，可在 shared/core test 中執行。
2. **環境 lint**：查詢目前宿主 registry，確認 key/version、capability、parameters 與
   bindings。

必須阻擋發布的案例：

- `options` 與 `dataSource` 同時存在或同時缺少。
- selection mode 與 default value 型別不符。
- DataSource 或精確版本未註冊。
- control 不在 `supportedControls`。
- Radio／Checkbox 來源不是 bounded complete list。
- binding parameter 不存在、重複、缺少或型別不相容。
- binding 指向不存在欄位或形成 dependency cycle。
- 動態欄位在 V1 設定 default value。

## 5. 相容性與版本策略

- 現有 schemaVersion 1 文件仍有效；新增欄位採 additive parsing，不要求批次資料 migration。
- 舊 `select` 預設 single，舊 `radio`／`checkbox` 繼續使用靜態 options。
- `FormFieldValue` 的 primitive union 不變。
- 新增 `autocomplete` variant 與公開 contracts 仍屬 package API 變更，實作時依 release
  policy 升版並同步 `docs/api-reference.md`。
- `approval_instances` 新欄位需要可回復的 TypeORM migration，既有 rows 使用空 object。
- 舊 instance 沒有 option snapshot 時只會包含靜態 schema；若未來匯入舊式動態資料，
  不可捏造 label，必須顯示 raw value 或明確 unavailable。

## 6. 後果

### 正面

- Secret 與 transport detail 不進瀏覽器或表單 schema。
- Host 能以 Nest provider 接 ERP、資料庫、內部 API 或 integration bus。
- 發布、查詢與送出各有明確 authorization boundary。
- primitive form values 維持既有 workflow/CEL 相容性。
- 歷史案件顯示不依賴外部服務可用性。
- 編輯時不會因非同步查詢靜默遺失資料。

### 成本

- 需要 registry、GraphQL surface、migration、server-side resolve 與 builder catalog。
- DataSource provider 版本在仍被引用期間需要營運維護。
- Radio／Checkbox 必須限制資料量，不能共用所有 searchable source。
- `ALWAYS` 來源的可用性會直接影響案件送出與重新送出。
- Builder 必須管理 dependency graph、來源能力與 schema edit impact。

## 7. 未採用方案

### 7.1 表單 schema 直接保存 URL／Header／查詢模板

未採用。它會暴露 secret 與 transport detail，增加 SSRF、注入、越權及環境漂移風險。

### 7.2 瀏覽器直接呼叫外部 API

未採用。瀏覽器無法安全持有 credential，也不能作為送出時權威驗證來源。

### 7.3 只在前端驗證 value

未採用。GraphQL mutation 可被直接呼叫，且查詢到送出之間存在 TOCTOU。

### 7.4 將 `{ value, label }` 直接存入 formData

未採用。這會改變條件式、workflow runtime、case title 與 host consumer 的資料 contract。

### 7.5 DataSource 自動使用 registry 最新版本

未採用。已發布表單與歷史案件不能因 host provider 部署而漂移。

### 7.6 依賴欄位變更後立即清除下游值

未採用。非同步失敗或使用者誤觸會造成不可恢復的表單資料遺失。改採 stale、resolve、
invalid 與明確重新選擇流程。

## 8. V1 不在範圍

- 讓 Designer 建立任意 HTTP connector。
- Secret 管理 UI。
- CEL／JSONPath／模板字串 parameter binding。
- DataSource result 的跨 request 通用 cache。
- 動態選項 default value。
- 離線編輯或 optimistic submit。
- 以 label 或其他非 value 欄位作為 workflow condition operand。

若未來要讓非工程人員建立任意 API 整合，應另立 Integration Catalog／Connector Builder
ADR；不能把該能力塞進 Form Definition Schema。

## 9. 相關文件

- [04 — 模板版本機制](./04-versioning.md)
- [06 — 資料模型](./06-data-model.md)
- [09 — 開發路線圖](./09-roadmap.md)
- [10 — BPM 嵌入式模組與 Auth 設計](./10-bpm-embedding-auth.md)
- [15 — 表單選項 DataSource 開發 Phase](./15-form-option-data-source-phases.md)
- [Public API Reference](./api-reference.md)
