# 20 — ADR：簽核人補填欄位（Approver-Filled Fields）

- **狀態**：Accepted（2026-10-21 與產品擁有者確認：§3.2 採方案 B、§3.3 保留節點級顯示設定並以欄位總覽矩陣設定、
  §3.4 同一路徑只能有一個補填節點、§5.2 舊鍵擋發布、V1 限制照 §3.4 接受；PR1 改名由本 repo 維護者推送至 #109）
- **決策日期**：2026-10-21
- **實作狀態**：PR1（引擎、API、發布檢查）以 [#109](https://github.com/Rytass/BPMCore/pull/109) 開出，
  尚未合併，且仍使用舊鍵 `fieldPermissions`（見 §5）；PR2（案件詳情補填 UI）、PR3（設計器設定面板）
  未開工（2026-10-21 查 origin 與作者 fork，皆無對應分支或 PR）
- **適用範圍**：Workflow Definition schema（userTask 節點）、Workflow Engine 送出／重送／`decideTask`、
  通知 payload、發布 lint、發起頁與案件詳情、Template Designer
- **交付規劃**：[21 — 簽核人補填欄位開發 Phase](./21-approver-filled-fields-phases.md)
- **前置決策**：[16 — ADR：表格欄位](./16-form-table-field-adr.md)（表格值形狀與驗證）、
  [18 — ADR：知會節點 Webhook](./18-notify-webhook-adr.md)（webhook 參數綁定）

## 1. 背景

宿主 Shuttle 的差旅費申請單需要「申請人填前半、區域財務在簽核關卡補填後半」：財務補填的
費用明細（表格）必須成為案件 `formData` 的一部分，被後續閘道讀到、被簽章涵蓋，不能存在 BPM 之外。

BPMCore 目前的狀況：

1. `UserTaskNodeData.fieldPermissions?: FieldPermission[]`（`{ fieldPath, visible, editable, required? }`）
   在 shared schema 中存在已久，但是**保留欄位、不生效**：引擎與所有畫面都不讀它
   （main 上 `libs/shared/src/lib/workflow.ts:62`、`docs/08-frontend-schema.md:132`）。
2. 設計器與 AI 助理都沒有寫入它的路徑；repo 內除了型別與文件沒有任何讀寫（2026-10-21 `git grep` 確認）。
3. 案件的 `formData` 只能在送出／重送時整包寫入；簽核人核准時無法寫入任何欄位。

PR #109 的做法是讓 `fieldPermissions[].editable` 由 server 強制執行。審查時浮現三個問題，促成本 ADR：

- 名稱叫「permissions」，但只有 `editable` 被強制；`visible: false` 仍只是顯示提示，查詢結果照樣含值。
- 舊鍵在既有資料中是「無效設定」，沿用同一個鍵會讓既有資料在升級後突然生效（§5.1）。
- 為了單一需求引入十多條發布限制，需要有一處記下為什麼、以及哪些組合刻意不支援。

## 2. 決策驅動因素

1. 補填值必須存在案件 `formData` 內，被簽章、活動紀錄、後續閘道與通知看見。
2. 只有「該關的簽核人、在核准時」能寫補填欄位；申請人與其他關不能寫，server 強制，不依賴前端。
3. 不得產生「案件卡死且只有工程師能解」的組合；能在發布時發現的，一律在發布時擋下。
4. 升級套件不得改變既有已發布版本與進行中案件的行為。
5. 名稱要讓設計者與 host 不會把顯示設定誤認為存取控制。
6. V1 範圍以 Shuttle 需求為準，但資料形狀要留出日後放寬的空間（§8）。

## 3. 決策

### 3.1 補填欄位模型

- **補填欄位**：在任一 userTask 節點被宣告為「本關補填」的表單頂層欄位。由流程定義靜態算出。
- **補填節點**：宣告某補填欄位的節點。一個欄位可由多個節點宣告。
- **寫入者**：只有補填節點的**非加簽**任務處理人，且只能在 `APPROVED` 時，透過 `decideTask` 的
  `formDataJson` 部分更新。轉簽、代理、管理員改派的接手者適用同一份節點設定。
- **申請人不能填**：GraphQL 送出與重送一律標為終端使用者送出，剝掉補填欄位；重送時以已存值蓋回。
  host 經 service 層可以預填。
- **核准時一律驗證**：補填節點的非加簽任務核准時，不論這次有沒有帶 `formDataJson`，都對合併後的資料
  做表格形狀、欄必填、`minRows` 與本關 `required` 驗證。
- **先存再簽章**：驗證通過且有鍵變動，先儲存並同步回 instance，再簽章與推進。簽章涵蓋補填值。
- **樂觀鎖**：`ApprovalInstance.formDataFingerprint`（穩定 stringify 後 sha256 的計算 getter，無 DB 欄位）。
  GraphQL 層帶 `formDataJson` 時必須帶 `expectedFormDataFingerprint`；service 層可省略，省略即不比對，
  後寫入者會覆蓋（host 自負，見 docs/08 §8.7）。
- **活動紀錄**：`TASK_DECIDED.payload.changedFieldKeys` 只記鍵名，不記值（host 可能把事件原樣轉給第三方）。
- **通知**：`TASK_ASSIGNED`／`TASK_TRANSFERRED` payload 帶旗標，表示該任務的節點有補填欄位，
  讓 host 推播時改成「開啟案件」而非一鍵同意。旗標名稱隨 §3.2 一併定案（#109 為 `requiresForm`，
  其語意是「有可填欄位」而非「有必填且未填」，建議改為能反映這個語意的名稱）。

上述行為已在 #109 實作並以單元測試與兩支 Playwright spec 驗證；本 ADR 不改變行為，只改名稱與 §3.3／§5 的範圍。

### 3.2 命名：以 `fieldAccess` 取代 `fieldPermissions`（採方案 B）

已決定**改名**（2026-10-21，產品擁有者選定「現在就把欄位改名，但需要考慮 migration」，並選定方案 B）。
改名同時解決 §5.1 的升級風險：新鍵在既有資料中不存在，舊鍵維持無效。

定案形狀：

```ts
interface UserTaskNodeData {
  /** 本節點對各表單欄位的顯示與補填設定。未列出的欄位依 §3.3 預設規則。 */
  readonly fieldAccess?: readonly FieldAccessEntry[];
}

interface FieldAccessEntry {
  /** 表單頂層 fieldKey；表格整張一起設定。 */
  readonly fieldKey: string;
  /** 在本節點的顯示設定。`HIDE` 只是顯示選項，不是權限邊界。 */
  readonly display: 'SHOW' | 'HIDE';
  /** 本節點簽核人核准時是否補填。`OPTIONAL`／`REQUIRED` 即宣告為補填欄位。 */
  readonly fill: 'NONE' | 'OPTIONAL' | 'REQUIRED';
}
```

對應的名稱調整：

| #109 名稱 | 改為 | 說明 |
| --- | --- | --- |
| `FieldPermission` | `FieldAccessEntry` | 舊型別保留為 `@deprecated`（§5.2） |
| `FieldAccess`（`resolveFieldAccess` 回傳） | `ResolvedFieldAccess` | 避免與 `fieldAccess` 設定混淆 |
| `readNodeFieldPermissions` | `readNodeFieldAccess` | |
| `readNodeEditableFieldKeys` | `readNodeFillableFieldKeys` | `fill !== 'NONE'` |
| `readNodeRequiredFieldKeys` | 不變 | `fill === 'REQUIRED'` |
| 通知 payload `requiresForm` | `hasFillableFields` | 語意是「節點有可補填欄位」，不是「有必填且未填」 |

驗證面的簡化：`fill: 'REQUIRED'` 而不可填、`fieldPath` 含 `.`／`[` 兩條 lint 因型別無法表達而移除；
`fill !== 'NONE'` 而 `display: 'HIDE'` 仍需 lint 擋下（補填欄位一定要讓填寫者看得到）。

以下為當時比較過的候選，保留作為紀錄。

**方案 A（未採用）：只描述補填，鍵名直述用途**

```ts
interface UserTaskNodeData {
  /** 本關簽核人核准時補填的表單頂層欄位。 */
  readonly approverFields?: readonly ApproverField[];
}

interface ApproverField {
  /** 表單頂層 fieldKey；表格整張一起宣告。 */
  readonly fieldKey: string;
  /** 本關核准前必須有值。預設 false。 */
  readonly required?: boolean;
}
```

- 沒有「權限」字眼，也沒有 `visible`，不會被誤認為存取控制。
- `fieldPath` 改為 `fieldKey`：V1 只收頂層鍵，與表單 schema 的 `fieldKey` 同名，省掉「不得含 `.`／`[`」這條 lint。
- 原本 `editable: true, visible: false`、`required: true, editable: false` 這類不合法組合在型別上無法表達，
  可刪除對應的兩條 lint。
- 顯示規則完全由「是否已揭露」決定（docs/08 §8.2 第 3、4 點），見 §3.3。

**方案 B（採用）：保留兩種概念，但各自正名**

```ts
interface FieldAccessEntry {
  readonly fieldKey: string;
  readonly display: 'SHOW' | 'HIDE';
  readonly fill: 'NONE' | 'OPTIONAL' | 'REQUIRED';
}
// UserTaskNodeData.fieldAccess?: readonly FieldAccessEntry[]
```

- 用列舉取代三個 boolean，同樣消除不合法組合；`display` 字面上就是顯示，不像權限。
- 保留 #109 的節點級顯示設定（`resolveFieldAccess` 第 1、2 點）。
- 「access」仍帶有存取控制的暗示，文件需持續說明 `HIDE` 不是權限邊界。

**方案 C（未採用）：最小改動**

保留 #109 的形狀，只把鍵改名為 `fieldRules`（或類似中性名稱），`visible` 改為 `displayed`。
改動最小，但不合法組合與對應 lint 都保留，名稱改善有限。

### 3.3 保留節點級顯示設定

決定保留（2026-10-21）。`resolveFieldAccess` 依序判斷，前者勝：

1. 檢視者在某節點有可處理的**非加簽**任務，且該節點 `fieldAccess` 列了這個欄位 ⇒ 照該筆
   `display`／`fill`（`fill !== 'NONE'` ⇒ 可編輯）。
2. 檢視者的任務是加簽任務，且該節點列了這個欄位 ⇒ 只取 `display`，一律不可編輯。
3. 補填欄位、未被第 1／2 點命中：已揭露 ⇒ 顯示唯讀；未揭露 ⇒ 不顯示。
4. 一般欄位、未被命中：顯示唯讀。

`display: 'HIDE'` 只影響 BPM 畫面，查詢結果仍含值，不得當作保密手段。設計器面板與文件都要寫明這一點
（PR3 的面板以「顯示」為標題，不用「權限」字眼）。

**設定介面以欄位為主軸**（2026-10-21 定案）。資料存在各節點，但設計者要回答的是「某個欄位在每一關長什麼樣」。
設計器以「欄位與關卡總覽」矩陣為唯一的設定介面：列為欄位、欄為依流程順序排列的 userTask 節點（最左為申請人，唯讀），
每格顯示明確設定或依上述規則推導出的結果，並逐列標出問題。節點面板只放摘要與開啟總覽的入口，不另做單節點設定畫面。
不同節點對同一欄位的顯示設定不同不算衝突：每個節點只決定自己的畫面。日後若有真的保密需求，以 server 端遮蔽另立 ADR。

已考慮的替代：V1 拿掉第 1、2 點，顯示完全由揭露狀態推導。未採用，因為產品擁有者希望設計者能控制
各關看到的欄位，而 #109 已有實作與測試。

### 3.4 V1 刻意不支援的組合（發布即擋）

| 組合 | 為什麼不支援 | 日後放寬方向 |
| --- | --- | --- |
| 補填節點用 `PARALLEL_ALL`／`QUORUM` | 多位簽核人同時補填同一欄位，誰的值為準沒有定義 | 每人各自的欄位（§8.2） |
| 補填節點設 `sla.onTimeout: 'AUTO_APPROVE'` | 自動核准每次都會被「一律驗證」擋下，SLA 實際上失效 | 自動核准改為「必填已有值才自動核准」 |
| 補填節點設 `excludeInitiator.whenEmpty: 'SKIP_NODE'` | 該關被跳過就沒人補填，案件卻照樣核准 | 無，請改用會指派到別人的選項 |
| `SET_FORM_FIELD` 寫補填欄位 | 繞過「只有補填節點簽核人能寫」 | 無 |
| 補填欄位是 DataSource 欄位、`file_upload`，或表格內含 DataSource 欄 | `decideTask` 不重解選項快照、不收附件 | 讓 decide 走與送出相同的快照與附件流程 |
| 補填欄位在表單層設 `required`／`requiredWhen`／`visibleWhen`／`readonlyWhen`／`hidden`／`defaultValue` | 表單層規則在送出時評估，此時補填欄位一定沒有值 | 無；必填改由節點宣告 |
| 節點 `required` 的補填欄位是 boolean | `false` 是有效答案，會被「為空」檢查擋下 | 改為「有被填過」語意 |
| DYNAMIC_FORM 的 `formPath` 指向補填欄位 | 兩邊檢查互相衝突，怎麼設都擋 | 無 |
| 同一個欄位在同一條流程路徑上有兩個以上補填節點 | 後填的會覆寫先填的值，簽章與責任歸屬不清 | 無；互斥分支（例如北區、南區財務各走一條）不受限。並行分支（parallelGateway 兩條分支）各自補填同一欄位視同同一路徑，會被擋 |
| 條件、閘道、resolver、NOTIFY 收件人等在補填之前讀補填欄位 | 該鍵不存在，CEL 讀缺鍵會在上一關核准的交易中丟錯，案件卡死 | 無；請調整流程順序 |
| **申請人欄位**的 `requiredWhen`／`visibleWhen`／`readonlyWhen` 引用補填欄位 | 送出時以缺值評估，規則靜默失效（`workflow-engine.service.ts` `evaluateFormConditionExpression`），client 與 server 的判斷依據也不同 | 無（2026-10-21 決定在 PR1 加入此檢查） |

另有兩項行為限制，不擋發布：

- `SEQUENTIAL` 節點每位候選人核准都驗，所以**第一位就必須填**。
- 表格補填是**整張可改**（增刪列、改任何欄）。需要「只填某幾欄」的 host 自行比對。

### 3.5 早讀檢查以圖可達性判斷

「補填之前不得讀補填欄位」以發布時的圖可達性判斷，不依賴 CEL 語意：

- 有 `entryCondition` 的補填節點可能被跳過，不算「已補填」。
- 並行 fork 之後 join 再讀，保守地擋下（圖看不出每條分支是否都經過補填節點）。
- 辨識以正則比對 `form.x`、`form["x"]`、`formData.x`；已知不認 raw／跳脫字串鍵與 `form.?x`，
  只會比實際更嚴，不會漏擋已認得的寫法。
- 不檢查 NOTIFY 的 webhook 參數綁定：讀到未填的補填欄位會讓該次 delivery `FAILED`，看得到、不卡單。
- lint 的 label 字串（如 `workflow.nodes.<id>.data.entryCondition`）應集中在 `libs/shared`，
  與 `WORKFLOW_LINT_MESSAGES` 一起由 server 與 client 共用，不在 client 重寫一份。

## 4. 發布前驗證不變式

一個能發布的範本版本必須同時滿足：

1. 每個補填宣告指向綁定表單的頂層欄位，且同一節點內不重複。
2. §3.4 表格中標為「發布即擋」的組合一個都不存在。
3. 對每個補填欄位，所有讀取它的運算式所在節點，都只能在至少經過一個無 `entryCondition` 的補填節點之後才可達。
4. 任何節點都不含舊鍵 `fieldPermissions`（§5.2）。
5. `fill !== 'NONE'` 的項目 `display` 必須是 `SHOW`。
6. 對每個補填欄位，任兩個補填節點不會在同一案件中都執行：兩者之間不存在一條從其一可達另一的路徑，且沒有任何 parallelGateway 分流把兩者分別送進不同分支（圖可達性判斷，與 §3.5 同一套；並行分支各自補填會互相覆寫，與 §3.5 同樣採保守判斷）。

## 5. 相容性與遷移

### 5.1 為什麼不能沿用舊鍵

引擎在送出與 `decideTask` 時讀的是 **instance 的 `workflowSnapshot`**（#109
`workflow-engine.service.ts:837`、`:1054`、`:1129`、`:1725`），不是範本目前版本。若沿用 `fieldPermissions`：

- 任何已發布版本或進行中案件的快照裡若留有 `editable: true`（過去是無效設定，可能是手改 JSON 或 host
  自行產生的定義），升級後會立刻生效：申請人送出的值被剝掉、簽核在補填關被「一律驗證」擋下。
- 已發布版本與案件快照是不可變紀錄，不應以 migration 改寫。

改用新鍵後，舊資料中的 `fieldPermissions` 維持無效，**不需要任何資料遷移**。

**前提：改名必須在 #109 合併或任何一次發版之前完成。** 一旦以舊鍵發版，舊鍵就承載了生效中的資料，
之後再改名就必須做真正的資料遷移（改寫快照或雙鍵相容讀取）。

### 5.2 舊鍵的處理

- **執行期**：引擎、shared helper 與畫面完全不讀 `fieldPermissions`。已發布版本與案件快照中的舊鍵保持原樣。
- **發布時**：草稿含 `fieldPermissions` 即擋發布，訊息指向 `fieldAccess`（2026-10-21 定案）。只影響尚未發布的
  草稿，避免設計者以為舊鍵仍然有效。未採用「只給警告」，因為 lint 目前沒有警告等級。
- **設計器**：開啟含舊鍵的草稿時，節點面板顯示提示並提供「移除舊設定」的動作（PR3），不自動轉換：
  舊資料從未生效，自動轉成 `fieldAccess` 等於替設計者打開一個他沒有確認過的功能。
- **型別**：`FieldPermission` 與 `UserTaskNodeData.fieldPermissions` 是 `@rytass/bpm-core-shared`
  的公開匯出（main `docs/api-reference.md:335`）。保留一個版本並標 `@deprecated`，下一個 breaking release 移除。
- **版本**：舊型別保留為 `@deprecated`、#109 的新名稱尚未發布過，所以 PR1 不是 breaking change，以 `feat` 提交即可。
  下一個移除 `FieldPermission` 的版本才帶 `BREAKING CHANGE:` footer（0.x 下解析為 minor）。

### 5.3 環境檢查

升級前可用以下查詢確認既有資料中是否有舊鍵（Rytass production 一律透過 `pgrytass`）：

```sql
SELECT 'template_version' AS source, count(*)
FROM approval_template_versions
WHERE workflow_definition::text LIKE '%"fieldPermissions"%'
UNION ALL
SELECT 'instance_snapshot', count(*)
FROM approval_instances
WHERE workflow_snapshot::text LIKE '%"fieldPermissions"%';
```

依 §5.1，即使查到資料也不需要改寫；查詢的用途是告知 host 哪些範本需要以新鍵重新設定並發布新版本。

### 5.4 其他相容性影響

- `decideTask` 取鎖後重讀 task，對**所有節點**生效：並行核准的輸家一律收到
  `ConflictException: Task <id> is not pending`。屬修正，但錯誤訊息是新的，需寫入 CHANGELOG。
- GraphQL 送出永遠視為終端使用者送出：host 若經 GraphQL 預填某欄位，該欄位被宣告為補填欄位後值會被丟棄。

## 6. 後果

### 正面

- 補填值成為案件資料的一部分，簽章、活動紀錄、後續閘道一致。
- 寫入權由 server 強制，不依賴 host 或前端自律。
- 會卡死案件的組合在發布時擋下，而不是在執行期才發現。
- 改名讓既有資料維持無效，升級不改變任何既有案件。

### 成本

- 發布檢查新增十多條規則與一套正則式早讀判斷，是後續最需要維護的部分。
- 「補填節點」是受限的特殊節點：不能多人決策、不能自動核准、表格只能整張可改。
- PR2 完成前，BPM 內建簽核畫面無法補填，只有 host 經 API 能用。
- 改名需要修改 #109 已完成的實作、測試與文件（docs/08 §8、api-reference）。

## 7. 未採用方案

### 7.1 沿用 `fieldPermissions` 並讓它生效（#109 原做法）

名稱誤導，且使既有無效資料在升級後生效（§5.1）。

### 7.2 補填值存在 BPM 之外，由 host 自行保存

不滿足驅動因素 1：簽章、閘道與活動紀錄看不到補填值。

### 7.3 以 `SET_FORM_FIELD` 系統節點代寫

系統節點沒有「誰」的概念，無法限制只有特定簽核人能寫，也無法做核准前驗證。

### 7.4 讓申請人在送出時填入、由簽核人覆寫

申請人送出的值會被當成財務的值，責任歸屬不清；且表單層必填規則會擋住發起。

### 7.5 節點級顯示設定作為保密手段

`visible: false` 只影響畫面，查詢結果仍含值。保密需求需要 server 端遮蔽，不在本 ADR 範圍。

## 8. V1 不在範圍

1. 表格欄級權限（只開放表格的某幾欄）。
2. 多人決策節點的補填（每位簽核人各自的欄位，或合併規則）。
3. server 端依檢視者遮蔽欄位值。
4. Dry Run 模擬補填（docs/04 已註明）。
5. 委派 `scopeConditionCel` 引用補填欄位的檢查（不在範本內，發布檢查管不到）。
6. 補填欄位作為 DataSource 或附件欄位。

## 9. 交付規劃

| 階段 | 內容 |
| --- | --- |
| PR1 | 引擎、API、發布檢查（#109），依本 ADR 改用 `fieldAccess`、加入申請人欄位規則檢查、label 集中到 shared |
| PR2 | 案件詳情：依 `resolveFieldAccess` 顯示欄位，補填節點簽核人在核准時輸入 |
| PR3 | 設計器：「欄位與關卡總覽」矩陣設定 `fieldAccess`，節點面板摘要，舊鍵提示 |

分階段 gate、E2E matrix 與狀態見 [21 — 簽核人補填欄位開發 Phase](./21-approver-filled-fields-phases.md)。
PR1 合併後、PR2 完成前若需要發版，release note 須註明「補填 UI 尚未提供，僅供 host 經 API 使用」。

## 10. 相關文件

- [08 — 前端工作流 JSON Schema](./08-frontend-schema.md) §8（行為細節、錯誤表、host 注意事項；#109 新增）
- [16 — ADR：表格欄位](./16-form-table-field-adr.md)
- [18 — ADR：知會節點 Webhook](./18-notify-webhook-adr.md)
- PR [#109](https://github.com/Rytass/BPMCore/pull/109)
