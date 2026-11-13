# 27 — ADR：宿主深度整合能力（生命週期事件、決策前檢查、宿主管理範本等九項）

- **狀態**：Proposed（2026-11-13）
- **提出日期**：2026-11-13；裁決 2026-11-13，逐題結果見 §12
- **基準版本**：四套件 0.22.0（`8990d251`）。本文件的行號都以此為準
- **交付規劃**：[28 — 宿主深度整合開發 Phase](./28-host-integration-round-phases.md)
- **需求來源**：有 host 把請款類流程的表單與簽核完全放在 BPM Core，為了 BPM Core 不支援的功能寫了不少 workaround：monkey-patch 引擎私有方法、直接用 SQL 讀 BPM Core 的資料表、自建去重表與每 10 分鐘的補償對帳。本 ADR 把其中屬於「任何深度整合的 host 都會遇到」的九項收回 BPM Core，以**函式庫**的角度設計，不以單一 host 的需求為限
- **交付方式**：九項放在同一個 PR、一次發版（預定 `0.23.0`，見 §11）

---

## 0. 總覽

| #   | 主題             | 一句話                                               | 對外新增                                                  |
| --- | ---------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| 1   | 案件生命週期事件 | commit 後才通知 host，失敗會重試，並保留可重送的紀錄 | `BPM_INSTANCE_EVENT_OBSERVER`、`approval_instance_events` |
| 2   | 決策前宿主檢查   | 送件、重送、決策前由 host 檢查或擋下，有逾時         | `BPM_INSTANCE_GUARD`、`instanceGuardTimeoutMs`            |
| 3   | 未填欄位當 null  | 表達式讀不到未填欄位時當 null，不報錯（opt-in）      | `expressionMissingFormFieldsAsNull`                       |
| 4   | 簽核者補填放寬   | boolean 可必填、可補填資料來源欄、table 可逐欄補填   | `FieldAccessEntry.columns`                                |
| 5   | 宿主限定發起     | 範本可宣告只能由 host 後端送件                       | `launchMode: HOST_ONLY`、`initiatorCustomFields`          |
| 6   | 範本業務 key     | host 用穩定的 key 認得自己的範本                     | `approval_templates.key`                                  |
| 7   | 待辦依範本篩選   | inbox 與歷程可依範本篩選                             | `templateIds`、`templateKey` 參數                         |
| 8   | 動態來源預設值   | 沒有欄位依賴的資料來源欄可設預設值                   | —                                                         |
| 9   | 宿主管理的範本   | 程式維護的範本預設不出現在範本與表單清單             | `hostManaged`、`includeHostManaged`                       |

本次**不做**：

- 範本與表單的寫入鎖定（§9.4，F10）。
- 把 activity log 擴充成事件來源（§1.3）。
- 補填附件欄位（§4.2）。

---

## 1. 案件生命週期事件

### 1.1 現況

- 程式內的 observer 只有兩個：
  - `BPM_TEMPLATE_OBSERVER`：只管範本變更。
  - `BPM_NOTIFICATION_OBSERVER`：在通知列寫入時同步呼叫。
    - 案件完成、駁回、退回時會寫一筆站內通知，所以 host 確實收得到這幾個時點。
    - 但事件帶有 `manager` 時代表資料**還沒 commit**（`notification-observer.token.ts` 的 JSDoc）。
    - 失敗只記 log，不重試、不補送。
    - 語意是「發給某收件人的一筆通知」，不是案件事件。
- `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` 只負責送 HTTP。WEBHOOK 服務節點等 commit 後才送，但沒有 outbox，也不重試。
- 真正有 outbox 的只有 NOTIFY 節點 webhook（ADR 18）：
  - 表：`workflow_webhook_deliveries`。
  - 用 `FOR UPDATE SKIP LOCKED` 認領，會重試。
  - ADR 18 §8 把「結案、退回、SLA 逾時等觸發時機」列為 V1 不做。
- host 的實際做法：
  - 在流程尾端放一個 NOTIFY 節點，把它的 webhook 當成「核准完成」事件。
  - 自建去重表，加上每 10 分鐘一次的對帳。
  - 對帳時解析 activity log 的 `TOKEN_ADVANCED` payload，推斷流程是否走到該節點。
  - 另一套整合則每 10 秒直接用 SQL 輪詢 `activity_logs`。
  - 兩者都綁死 BPM Core 的內部 payload 格式與表結構。

### 1.2 決定（F1）

採 **transactional outbox**：

- 事件列在**狀態轉換的同一個交易內**寫入 `approval_instance_events`，所以「資料 commit 了，事件就一定在」。
- 投遞到 host 的 observer 是 commit 之後的另一個動作，失敗會重試；超過上限標為 FAILED，可查詢、可手動重送。
- observer 與 outbox 一次做完，不分階段。

```
 engine transaction                                  after commit / scheduler
┌──────────────────────────────┐    commit    ┌───────────────────────────────┐
│ state change                 │─────────────▶│ claim PENDING (SKIP LOCKED)   │
│ insert approval_instance_    │              │ observer.onInstanceEvent(e)   │
│   events (status PENDING)    │              │ ok   -> DELIVERED             │
└──────────────────────────────┘              │ fail -> retry / FAILED        │
                                              └───────────────────────────────┘
```

| 項目                | 決定                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token               | `BPM_INSTANCE_EVENT_OBSERVER`，介面 `BPMInstanceEventObserver { onInstanceEvent(event): Promise<void> \| void }`                                                              |
| 啟用條件            | 有提供 observer 才寫事件列（F1-b，採建議值）。沒有 observer 的 host 不會多出一張持續成長的表                                                                                  |
| 投遞語意            | **at-least-once**。host 以 `event.id` 去重。這和 NOTIFY webhook 的語意相同                                                                                                    |
| 順序                | **同一案件依 `seq` 依序投遞**：某案件還有更早的 PENDING 事件時，不認領它後面的事件。不同案件之間不保證順序（F1-c，採建議值）                                                  |
| FAILED 是否阻擋後續 | 不阻擋。事件達重試上限標為 FAILED 後，同案件後續事件照常投遞；FAILED 列留給管理 API 處理                                                                                      |
| 觸發投遞            | commit 後由 subscriber 立即認領一次，另有排程器定期掃描。做法比照 `workflow-webhook-delivery.subscriber.ts` 與 `workflow-webhook-delivery-scheduler.service.ts`，含多副本安全 |
| 重試                | 指數退避，次數與間隔可設定，預設與 NOTIFY webhook 相同                                                                                                                        |
| 保留期              | DELIVERED 列保留 `retentionDays`（預設 30）後由排程刪除；FAILED 列不自動刪除                                                                                                  |
| 管理 API            | `approvalInstanceEvents(status, instanceId, page)` 查詢、`retryApprovalInstanceEvent(id)` 重送，權限比照 webhook delivery 的管理 resolver                                     |
| host 自帶交易       | 事件列寫在 host 傳入的 `manager` 交易裡，隨 host 一起 commit 或回滾；投遞由排程器掃到後進行。不需要額外的 commit hook                                                         |

### 1.3 事件類型

| `type`                      | 時點                                                                                                     | 主要欄位                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| `INSTANCE_SUBMITTED`        | 送件成功                                                                                                 | `actorMemberId`           |
| `INSTANCE_RESUBMITTED`      | 退回後重送成功                                                                                           | `actorMemberId`           |
| `NODE_ACTIVATED`            | token 進入使用者任務節點，且任務已建立（F1-d：「到達某節點」定義為任務建立時；被進入條件略過的節點不發） | `nodeId`、`taskIds`       |
| `INSTANCE_APPROVED`         | 案件結束為 APPROVED（兩條路徑：`completeInstanceIfNoOpenRuntimeState`、`completeTokenAtEndNode`）        | —                         |
| `INSTANCE_REJECTED`         | 駁回                                                                                                     | `actorMemberId`           |
| `INSTANCE_RETURNED`         | 退回                                                                                                     | `nodeId`、`actorMemberId` |
| `INSTANCE_CANCELLED`        | 撤銷                                                                                                     | `actorMemberId`           |
| `INSTANCE_EXPIRED`          | 逾期結案                                                                                                 | —                         |
| `TASK_AUTO_DECISION_FAILED` | SLA 自動同意被決策前檢查擋下或逾時（§2.4）                                                               | `taskId`、`reason`        |

所有事件共有欄位：`id`、`seq`、`type`、`instanceId`、`templateId`、`templateKey`（§6，可為 null）、`templateVersionId`、`instanceState`、`occurredAt`。

**事件不帶 `formData`**。host 需要時依 `instanceId` 讀取，以免事件列變成第二份表單資料。

- **不採 activity log 當事件來源**：它的 `seq` 由 identity 在 insert 時配號，晚 commit 的列會讓「`seq > 游標`」的補送漏掉資料；核准路徑之一也不寫活動紀錄。改用獨立的 outbox 表，比修補 activity log 的語意單純。
- **既有行為不變**：`BPM_NOTIFICATION_OBSERVER` 與 NOTIFY webhook 照舊。

### 1.4 對 host 的影響

前述「NOTIFY 節點加對帳」與「直接輪詢 `activity_logs`」都可以改成註冊一個 observer。

---

## 2. 決策前宿主檢查

### 2.1 現況

- `decideTask` 從頭到尾在同一筆交易內。它先取 `pg_advisory_xact_lock`，再依序：讀 task 與 instance、做動作檢查、比對 fingerprint、合併 formData、驗證補填欄位、簽章，最後推進流程。
- 送件與重送同樣沒有任何 host 介入點。
- host 的實際做法：
  - 用全域 interceptor 攔 GraphQL 的 `decideTask` 與自己的 S2S 入口，每一關重算金額與核決層級。
  - 但 SLA 自動同意直接呼叫 service（`notification.service.ts` 的逾時動作），一定繞過這個 interceptor。其他直接呼叫 service 的模組也會繞過。
  - 檢查在交易外執行，檢查完到決策之間有競態空窗。

### 2.2 決定（F2、F12）

| 項目      | 決定                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token     | `BPM_INSTANCE_GUARD`，介面 `BPMInstanceGuard { check(input): Promise<readonly BPMInstanceGuardIssue[]> }`                                                                                                                                                      |
| 涵蓋路徑  | 送件、重送、決策三條路徑，GraphQL 與 service 直接呼叫都會經過                                                                                                                                                                                                  |
| 位置      | **交易內**，取鎖之後。決策路徑放在比對 fingerprint 並合併補填值之後、`validateFilledFormFields` 之後；送件與重送放在表單驗證之後、建立 token 之前                                                                                                              |
| 輸入      | `kind`（`SUBMIT` \| `RESUBMIT` \| `DECIDE`）、`instance`（送件時為即將寫入的值）、`templateVersion`、合併後的 `formData`、`changedFieldKeys`、`task` 與 `node`（DECIDE 才有）、`action`（DECIDE 才有）、`actorMemberId`、`automatic`、`authContext`、`manager` |
| 輸出      | issue 清單，空清單代表通過。**不允許回傳 patch**，否則會繞過補填權限與簽章涵蓋範圍                                                                                                                                                                             |
| 錯誤格式  | 非空清單回 400，沿用 `createFormDataBadRequest` 的 `formDataErrors`。`FormDataIssue.reason` 新增 `HOST_RULE`；`FormDataIssue` 新增選填的 `code`，放 host 自訂的錯誤碼；`path` 指向欄位，或用空字串表示整張單                                                   |
| 逾時      | `BPMRootModule` 選項 `instanceGuardTimeoutMs`，預設 **5000**（F12 採建議值）。逾時視為**拒絕**（fail closed），交易回滾，回 503，錯誤碼 `BPM_INSTANCE_GUARD_TIMEOUT`                                                                                           |
| 例外      | `check` 丟出 `HttpException` 時原樣往外拋；其他錯誤也視為拒絕，回 503                                                                                                                                                                                          |
| `manager` | 讓 host 在同一個交易快照內讀資料。JSDoc 會寫明**不得寫入**：寫入會隨決策一起 commit 或回滾，而且逾時後無法撤回                                                                                                                                                 |

### 2.3 逾時的限制

逾時後引擎不再等待結果，但 JavaScript 無法中斷 host 那邊還在執行的 Promise。host 若已經做了外部寫入，例如呼叫 ERP，要自己處理冪等。JSDoc 與 [10 — 嵌入式模組](./10-bpm-embedding-auth.md) 都會寫明這點。

### 2.4 SLA 自動同意（F3）

- `input.automatic === true` 時由 host 決定擋或放（F3）。
- 被擋下或逾時都視為「自動同意失敗」：
  - 任務維持開啟。
  - 寫入 `TASK_AUTO_DECISION_FAILED` 事件（§1.3），讓 host 收得到。
  - SLA 逾時動作本來只在逾期通知第一次建立時執行一次，本 ADR 不改這個行為。
- PR #155 若先合併，同時寫入它的 `ADVANCE_FAILED` 活動紀錄。兩個機制不衝突：一個給管理員畫面，一個給 host 程式。

---

## 3. 未填欄位當 null

### 3.1 現況

- 三個 context 建立點都直接把原始 `instance.formData` 放進 `form`，不依 schema 補 key：
  - 主流程：`buildWorkflowExpressionContext`。
  - 代理：`delegation.service.ts`。
  - 試跑：dry-run。
- 缺 key 就報錯是**文件明載的語意**：
  - ADR 22 寫「缺值會讓評估失敗並回滾」。
  - lint `EXPR_OPTIONAL_FIELD_WITHOUT_HAS` 引導作者用 `has()`。
  - 0.20.1 只讓設計器產生的邊條件改用結構化欄位作答，手寫 CEL 刻意維持報錯。
- 各評估點目前的行為：
  - 會報錯：節點進入條件、指派運算式、WEBHOOK payload、SET_FORM_FIELD、代理規則 `scopeConditionCel`。
  - 不會讓單據失敗：通知 webhook bindings（缺值只把該次投遞記為 FAILED）、資料來源 bindings（缺值回 WAITING）。

### 3.2 決定（F4）

| 項目         | 決定                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 開關         | `BPMRootModule` 選項 `expressionMissingFormFieldsAsNull`，預設 `false`，整個 host 一起開（F4）                                       |
| 補法         | 在三個 context 建立點，依案件的 `form_definition_snapshot` 補齊**頂層**欄位：一般欄位補 `null`，table 補 `[]`。已存在的 key 一律不動 |
| table 內的欄 | 不補（F4-b，採建議值）。列的形狀由 table 驗證負責，補了反而會讓 `row.x` 的 `has()` 語意跟著改變                                      |
| 只影響運算   | 補的是運算用的副本，不寫回 `form_data`。SET_FORM_FIELD 寫回的仍是原始資料                                                            |
| 試跑         | 套用同一個開關，避免試跑與實際執行結果不一致                                                                                         |

### 3.3 語意變更（必讀）

開啟後，對未填欄位而言：

- `has(form.x)` 從 `false` 變成 `true`。
- `form.x == null` 從報錯變成 `true`。
- `form.x > 5` 從「缺 key」錯誤變成型別錯誤，仍會報錯。0.20.1 的結構化欄位作答仍會接手設計器建出的邊。

既有範本若用 `has(form.x)` 判斷「沒填」，開啟後行為會改變，所以只能 opt-in。選項的 JSDoc、[05 — CEL 條件](./05-conditions-cel.md) 都會列出這張對照，並建議開啟後改用 `form.x == null`。

另外修正 p2-p3 lint 文件的矛盾：它把 `form.x != null` 當成守衛，但這個寫法在選項關閉時擋不住缺 key。

---

## 4. 簽核者補填放寬

ADR 20 §3.4 與 §8 把以下三點列為延後項目，不是拒絕。本次三點都做（F6），共用同一套寫入路徑。

### 4.1 (c) boolean 可設必填

- **現況**：lint `approverFilledRequiredBoolean` 擋下。ADR 20 的理由是「`false` 會被當成空值擋下」，但程式碼的 `isFormDataValueEmpty` 並不把 `false` 當空，兩者矛盾。實際的問題是補填 UI 只送有變動的值，所以沒碰過的開關會是 `undefined`，被必填檢查擋下。
- **語意**：必填等於「這個 key 必須被明確寫過」，`true` 和 `false` 都算。引擎現有判斷不用改。
- **改動**：
  - 拿掉這條 lint 與矩陣的停用。
  - 補填 UI 對必填 boolean 送出時帶上畫面上的值。
  - 修正 ADR 20 §3.4 的理由文字。

### 4.2 (b) 可補填資料來源欄位

- **現況**：
  - 被擋的 lint：`approverFilledFieldDataSource`、`approverFilledTableDataSourceColumn`。
  - `decideTask` 不重新解析選項，也不寫 `formDataOptionSnapshot`。補填的值不但沒有顯示名稱快照，也沒驗證是不是合法選項。
- **做法**：仿重送路徑，抽出 `prepareDecisionFormDataOptions`：
  1. **鎖外**：以**簽核人**的 authContext 解析補填欄位的選項，並以既有快照做增量合併。
  2. **鎖內**：比對 fingerprint，確認案件沒有被改過，再一併寫入 `formData` 與 `formDataOptionSnapshot`。
  3. 解析不到的值回 `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED`，和送件時相同。
- **附件**（`file_upload`）不在本次範圍。

### 4.3 (a) table 逐欄補填

**設定**：table 的 `FieldAccessEntry` 新增選填的 `columns`：

```ts
interface FieldAccessEntry {
  readonly display: FieldAccessDisplay; // existing
  readonly fieldKey: string; // existing
  readonly fill: FieldAccessFill; // existing: 'NONE' | 'OPTIONAL' | 'REQUIRED'
  readonly columns?: readonly {
    readonly columnKey: string;
    readonly fill: Exclude<FieldAccessFill, 'NONE'>;
  }[];
}
```

- 沒有 `columns`：維持現行的整張可改。舊範本不受影響。
- 有 `columns`：進入**逐欄模式**。

**列結構鎖定**（取代 row id）：逐欄模式下，補填者**不能新增、刪除或重排列**，只能改指定欄的格子。

- 待簽期間案件持有鎖，申請人也不能改表單，所以「第 n 列」在這次補填中是穩定的身分，不需要 row id。
- 伺服器在**鎖內**從已存的列逐格合併：只取 payload 中允許的欄，其他格一律沿用已存值。不信任前端送回的整張表，因為經 service 呼叫的 host 不一定帶 fingerprint。
- 列數或列序不一致時，回 `FORM_FIELD_ACCESS_TABLE_ROWS_LOCKED`。
- **放棄的能力**：補填者不能增刪列。需要「補填者新增明細列」的情境，仍用沒有 `columns` 的整張可改。
- **不採的替代案**：由引擎產生穩定的 row id。好處是能支援補填者增刪列；代價是舊的表格值沒有 id，要處理相容，而且 row id 會出現在 `form_data` 裡，所有讀表格的 host 都要認得它。需要時可在後續版本加上。

**與 (b) 的交集**：逐欄模式允許補填有資料來源的欄（例如逐列選會計科目），解析流程同 §4.2，以 `ROW_FIELD` 綁定取同列的值。

**「同一路徑一個欄位只能有一個補填節點」**：

- 逐欄模式下改以 `(fieldKey, columnKey)` 為單位判斷。不同節點可以各自補同一張 table 的不同欄。
- 整張可改的 table 仍以整張為單位。
- 頂層欄位的規則不變，ADR 20 §3.4 的理由仍然成立。

**設計器**：補填矩陣在 table 列下展開各欄，可個別勾選。

---

## 5. 宿主限定發起

### 5.1 現況

- host 用 `initiatorPolicyCel = has(initiator.customFields.hostSubmitted)` 的慣例限制發起，並在 service 送件時自己組一份完整的發起人快照。這樣有兩個問題：
  - 慣例只存在於 host 端，`has()` 裡的名稱拼錯就會無聲失效，設計器也看不出這個範本有限制。
  - host 要自己組快照，就得複製引擎產生預設快照的邏輯。有 host 已經有 5 份這樣的複本，引擎一改就會悄悄跟不上。
- `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER` 補不了這個洞：
  - host 自帶快照時，引擎不會呼叫 resolver。
  - 契約要求 SUBMISSION 與 LAUNCHABLE_TEMPLATES 回相同的值，所以 resolver 分辨不出「host 送」和「GraphQL 送」。
- `resubmitApprovalInstance` 不評估發起權限，而且收下整份新的 formData。退回後，申請人可以從 BPM 畫面改資料重送，繞過 host 自己的驗證。
- 0.22.0 的 PR #157 已經處理「草稿階段查選項」（`FORM_OPTIONS` purpose 與 `isInitiatorPolicyMet`）。

### 5.2 決定（F5）

| 項目             | 決定                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 欄位             | `approval_template_versions.launch_mode`：`OPEN`（預設）\| `HOST_ONLY`。和 `initiator_policy_cel` 放在同一層，也就是**版本層級**，隨版本發布                                                                                                    |
| GraphQL 送件     | `submitApprovalInstance`（`endUserSubmission: true`）遇到 `HOST_ONLY` 回 403                                                                                                                                                                    |
| GraphQL 重送     | 重送 mutation 已經帶 `endUserSubmission: true`（`workflow-engine.mutations.ts:157`），改為遇到 `HOST_ONLY` 回 403。判斷依據是**案件所屬版本**的 `launch_mode`                                                                                   |
| service 直接呼叫 | 照常可用，不受 `launch_mode` 限制                                                                                                                                                                                                               |
| 可發起清單       | `HOST_ONLY` 的範本不列出                                                                                                                                                                                                                        |
| 查選項           | 不受 `launch_mode` 影響，仍走 #157 的 `isInitiatorPolicyMet`。host 自己的新增頁需要查選項                                                                                                                                                       |
| 切換後的舊案件   | 案件綁定送件時的版本，新版本改成 `HOST_ONLY` 不影響舊版本已退回的案件，反之亦然                                                                                                                                                                 |
| 快照參數         | service 的 `submitApprovalInstance` 新增 `initiatorCustomFields?: Record<string, unknown>`：引擎照常產生預設快照、呼叫 resolver，再把這份欄位合併在 `customFields` 上（host 給的值優先）。和 `initiatorMetadataSnapshotJson` 互斥，同時給回 400 |

有了 `HOST_ONLY`，host 不用再靠 `hostSubmitted` 慣例。`initiatorPolicyCel` 回到「誰有資格發起」的原本用途。

---

## 6. 範本業務 key

### 6.1 現況

- 範本 id 本來就穩定，發布只換版本，`currentVersionId` 也已經能找到目前版本。
- 缺的是「host 可宣告的身分」：host 程式發布的範本，host 要能認出「這是我發的」。
- 目前 host 自建登錄表，記錄 `templateId → host key`，用來分流與過濾列表。

### 6.2 決定（F7）

| 項目           | 決定                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 欄位           | `approval_templates.key`，nullable                                                                                                              |
| 格式           | `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`                                                                                                            |
| 唯一           | partial unique index `WHERE key IS NOT NULL AND deleted_at IS NULL`：只在未刪除的範本之間唯一，刪除後 key 可以重用（F7）                        |
| 設定           | `createApprovalTemplate`、`updateApprovalTemplate`、compose 皆可帶 `key`                                                                        |
| compose upsert | `composeApprovalTemplateWithForm` 沒帶 `templateId`、但帶了 `templateKey` 時：找得到同 key 的範本，就在該範本下發新版本；找不到則新建並寫入 key |
| 查詢           | `approvalTemplateByKey(key)`                                                                                                                    |
| 篩選           | `approvalInstances` 系列（含 count、pageInfo）與待辦、歷程（§7）都接受 `templateKey`（F7-b，採建議值）                                          |

---

## 7. 待辦依範本篩選

0.22.0 起 `inboxTasks`／`inboxTaskCount`／`approvalHistoryTasks`／`approvalHistoryTaskCount` 可以分頁（PR #156），但不能依範本篩選。host 目前是撈回全部、在記憶體裡比對「一組已發布範本 id」。

**決定**：

- 上述四個查詢新增 `templateIds: [String!]` 與 `templateKey: String`，兩者同時給時取交集。
- 待辦清單與 count 共用同一次 open-task 讀取（#156 的 `readSharedOpenInboxTasks`），篩選套在共用結果上，再分頁與計數。
- 儀表板計數那條路徑不受影響。
- 歷程是一句 SQL，篩選直接加進 where 條件。

---

## 8. 動態資料來源欄位允許預設值

- **現況**：`form-schema.validator.ts` 拒絕在有 `dataSource` 的欄位設 `defaultValue`。ADR 14 §3.5 的理由是：不同填寫者與 bindings 可能讓設計時選的預設值失效。
- **可以放寬的原因**：送件時伺服器會權威解析所有資料來源欄，值不在選項內就整筆擋下，顯示名稱也以解析結果為準。因此「預設值必須在選項內」與「名稱從哪來」已經被送件流程保證。
- **決定**：
  - 只有在資料來源的 bindings **沒有 `FIELD`／`EXPRESSION` 依賴**時才放寬，例如只有 `CONSTANT`，或沒有 bindings。有依賴時，預設值可能在依賴欄位填好前就失效，維持拒絕。
  - 發布時用 preview 解析預設值。解析不到只發**警告**，不擋發布，因為選項可能依填寫者而不同。
  - 渲染端把帶入的預設值當成「待解析」，主動解析出顯示名稱；解析不到時標示為無效值。
  - 設計器在欄位切換到資料來源時不再清掉預設值，只在有依賴時清除並提示。

---

## 9. 宿主管理的範本

### 9.1 現況

- 範本與表單都**沒有**刪除用的 mutation。所謂「誤刪」，實際上是停用（`deactivateApprovalTemplate`），或改草稿、發布、回滾、fork。這些 mutation 只有 `@BPMDesignerOnly()` 保護。
- host 用程式發布的範本會出現在範本管理頁和表單清單。host 只能在表單描述寫「請勿刪除欄位」來提醒。
- 每次 compose 沒帶 `formDefinitionId` 都會多出一份表單，表單清單會越積越多。

### 9.2 命名（F9）

採 `hostManaged`（DB 欄位 `host_managed`），查詢參數用 `includeHostManaged`。

- **意思是**：這個範本或表單的**定義由 host 程式維護**，BPM Core 的管理畫面預設不顯示它。
- **它不是**：
  - 發起限制：那是 §5 的 `launchMode`。兩者各自獨立，可以任意組合。
  - 權限或鎖定：見 §9.4。
- **不叫 `systemOnly`**：`system` 容易被讀成「系統管理員」，`only` 容易被讀成「只能由系統發起」，會和 `launchMode: HOST_ONLY` 混淆。
- 本節的說明會原樣寫進 entity、GraphQL 欄位與參數的 description，以及 API reference。

### 9.3 決定

| 項目     | 決定                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 欄位     | `approval_templates.host_managed`、`form_definitions.host_managed`，`boolean NOT NULL DEFAULT false`                                                                     |
| 設定     | 只能從 service 與 compose 的輸入設定。GraphQL 只公開唯讀欄位 `hostManaged`。compose 時表單繼承範本的值                                                                   |
| 預設排除 | `approvalTemplates`、`approvalTemplateCount`、`formDefinitions`、`formDefinitionCount` 預設不回傳 `hostManaged = true` 的資料；帶 `includeHostManaged: true` 才回傳      |
| 不受影響 | 依 id 查詢（`approvalTemplate`、`formDefinition`、版本查詢）、`approvalTemplateByKey`、`launchableApprovalTemplates`（由 `launchMode` 與發起政策決定）、案件與待辦的查詢 |
| 前端     | client SDK 與 React 的五處範本清單（範本管理頁、表單清單、案件列表的範本篩選、兩個代理設定頁的範本選擇器）**都不帶** `includeHostManaged`（F11）                         |

### 9.4 已知後果（F10、F11）

- **只做隱藏，不做鎖定**（F10）：知道 id 或帶 `includeHostManaged` 的人，仍可停用、改版或回滾這些範本。
- **全部清單一律隱藏**（F11）：
  - 使用者在案件列表**無法**以範本篩選這類案件。案件本身照常列出，只有篩選選單沒有這個選項。
  - 使用者與管理員在代理設定頁**無法**選擇這類範本，所以不能用 UI 建立「只代理某個 host 管理範本」的規則。不限範本的代理規則照常生效。
  - 已存在、指向這類範本的代理規則，畫面以依 id 查詢顯示範本名稱，不會變成空白或裸 id。
- 需要這些能力的 host，可以在自己的頁面帶 `includeHostManaged: true` 呼叫 client SDK。

---

## 10. 資料庫與相容性

### 10.1 Migration

一支 migration `0000000032000-host-integration-round.ts`：

- `approval_templates`：新增 `key text NULL`、`host_managed boolean NOT NULL DEFAULT false`，以及 key 的 partial unique index。
- `form_definitions`：新增 `host_managed boolean NOT NULL DEFAULT false`。
- `approval_template_versions`：新增 `launch_mode text NOT NULL DEFAULT 'OPEN'`，加上 CHECK。
- 新表 `approval_instance_events`：
  - 欄位：`id uuid`、`seq bigint identity`、`instance_id`、`type`、`payload jsonb`、`status`、`attempt_count`、`next_attempt_at`、`claimed_at`、`delivered_at`、`last_error`、`occurred_at`。
  - 索引：`(status, next_attempt_at)`、`(instance_id, seq)`。

全部是新增，預設值即現行行為，可以回滾（`down` 刪除新欄位與新表）。

### 10.2 相容性

| 變更                                    | 影響                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `FormDataIssue.reason` 新增 `HOST_RULE` | 對 reason 做窮舉的 host 需要補一個 case。屬破壞性變更，commit 以 `BREAKING CHANGE:` 註記 |
| 清單預設排除 `hostManaged`              | 既有資料全為 `false`，行為不變                                                           |
| 新的 `BPMRootModule` 選項與 token       | 全部選填，不提供時行為不變                                                               |
| `FormDataIssue.code`                    | 新增選填欄位，不影響既有讀取端                                                           |
| `FieldAccessEntry.columns`              | 選填；舊的發布快照沒有這個欄位，等同整張可改                                             |
| `expressionMissingFormFieldsAsNull`     | 預設關閉                                                                                 |

---

## 11. 交付與發版

- 九項在同一個 PR，依 [28](./28-host-integration-round-phases.md) 的階段順序拆成多個 atomic commit。
- 發版前跑 `/review` 稽核，修到沒有中、高嚴重度問題。
- **一次發版**：
  - 版本用**確切值** `0.23.0`，不要用 `minor` 這類關鍵字。0.x 會把關鍵字降一級，見 CLAUDE.md「Releasing」。
  - 先 dry-run 同一個指令再執行。
  - 合併與發版需要另外取得同意。
- 本 PR 會改到 `decideTask`、`resubmitApprovalInstance` 與交易邊界。開啟中的 #153、#154、#155 也改到同一段程式，誰後合併誰就要解衝突。

---

## 12. 裁決紀錄

編號全程唯一。「採建議值」表示該子題沒有逐字回覆，暫依建議執行，審閱本 ADR 時可推翻。

| #    | 題目                         | 結果                                                                  | 備註                    |
| ---- | ---------------------------- | --------------------------------------------------------------------- | ----------------------- |
| F1   | 生命週期事件範圍             | observer 加 outbox，一次做完                                          | 2026-11-13              |
| F1-b | 沒有 observer 時是否寫事件列 | 不寫                                                                  | 採建議值                |
| F1-c | 投遞順序                     | 同案件依序，跨案件不保證                                              | 採建議值                |
| F1-d | 「到達某節點」的定義         | 任務建立時發 `NODE_ACTIVATED`                                         | 採建議值                |
| F2   | 決策前檢查的位置與路徑       | 交易內，涵蓋送件、重送、決策，有逾時參數                              | 2026-11-13              |
| F3   | SLA 自動同意被擋             | 由 hook 依 `automatic` 決定；被擋或逾時發 `TASK_AUTO_DECISION_FAILED` | 事件部分採建議值        |
| F4   | 未填欄位當 null 的開關層級   | 模組選項，整個 host 一起開                                            | 2026-11-13              |
| F4-b | table 內的欄是否補 null      | 不補                                                                  | 採建議值                |
| F5   | 宿主限定發起                 | 一級旗標 `launchMode: HOST_ONLY`，版本層級                            | 層級採建議值            |
| F6   | table 逐欄補填               | 本次做；以鎖定列結構取代 row id                                       | 列結構鎖定為本 ADR 提案 |
| F7   | key 唯一範圍                 | 只在未刪除的範本間唯一                                                | 2026-11-13              |
| F7-b | key 是否連動待辦與案件篩選   | 連動                                                                  | 採建議值                |
| F9   | 宿主管理旗標命名             | `hostManaged`／`includeHostManaged`，文件與註解要說明清楚             | 2026-11-13              |
| F10  | 只隱藏還是加鎖定             | 只隱藏                                                                | 2026-11-13              |
| F11  | 案件篩選與代理選擇器是否列出 | 不列出，全部清單一律隱藏                                              | 2026-11-13              |
| F12  | 決策前檢查逾時               | 拒絕（fail closed），預設 5 秒                                        | 秒數採建議值            |
| F13  | 交付方式                     | 先 ADR，單一 PR、一次發版，發版前 `/review`                           | 2026-11-13              |

---

## 13. 驗證方式

- 單元測試與 `test-real-engine` 涵蓋每一項的正反情境，詳見 [28](./28-host-integration-round-phases.md) 的 gate。
- 含 migration 的驗證在**本機 Postgres** 進行（repo 的 `docker-compose.yml`），不在共用的 develop schema 執行，避免 review 改動 migration 後，develop 留下對不上的紀錄。
- 瀏覽器實測：
  - 補填（boolean、資料來源、table 逐欄）。
  - 範本與表單清單的隱藏。
  - 動態來源預設值。
  - 宿主限定範本：可發起清單與送件被拒。
