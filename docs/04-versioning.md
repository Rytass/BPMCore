# 04 — 模板版本機制

## 核心原則

1. **修改 = 新版本**：已發布的版本不可改，永遠 fork 出新版
2. **最新版為預設**：發起新簽核時抓 current_version
3. **可回退**：管理者可指定 current 指回舊版
4. **Instance 鎖定**：每個簽核 instance 鎖死建立時的版本，不受版本變更影響

> 同樣機制適用於 **Form Definition**（表單定義也是版本化的）。

---

## 1. 資料結構

### ApprovalTemplate（邏輯實體）

```
ApprovalTemplate
├── id (穩定不變)
├── name
├── description
├── category
├── current_version_id  ← 指向「目前生效」的版本
└── created_at
```

> 實際 entity 另有 `category_id`、`is_active`（停用旗標）、`deleted_at`（見上文 3.6）等欄位，以 `approval-template.entity.ts` 為準。

### ApprovalTemplateVersion（版本實體）

```
ApprovalTemplateVersion
├── id
├── template_id
├── version (1, 2, 3, ...)
├── status (DRAFT / PUBLISHED / ARCHIVED)
├── workflow_definition (JSONB, BPMN 子集)
├── form_definition_version_id (綁定的表單版本)
├── initiator_policy_cel (TEXT, 發起權限 CEL 表達式)
├── notification_config (JSONB)
├── sla_defaults (JSONB)
├── published_at
├── published_by_member_id
├── archived_at
└── created_at
```

`form_definition_version_id` 採用 **完全綁定**：模板版本的所屬表單版本一旦發布即凍結，不會因為表單更新而改變。

---

## 2. 版本狀態流轉

```
                       ┌──────────────────┐
                       │      DRAFT       │  ← 初次建立
                       └────────┬─────────┘
                                │ publish()
                                ▼
                       ┌──────────────────┐
            ┌──────────│    PUBLISHED     │
            │          └────────┬─────────┘
            │                   │
   rollback│ (current 歸檔、目標版本重新發布)│ 有人 publish 新版
            │                   ▼
            │          ┌──────────────────┐
            └─────────▶│     ARCHIVED     │
                       └──────────────────┘
```

| 狀態          | 描述               | 可發起新 instance    | 可被 instance 引用  |
| ------------- | ------------------ | -------------------- | ------------------- |
| **DRAFT**     | 編輯中             | ❌                   | ❌                  |
| **PUBLISHED** | 唯一一個是 current | ✅（如果是 current） | ✅                  |
| **ARCHIVED**  | 曾發布過的歷史版本 | ❌                   | ✅（歷史 instance） |

**關鍵不變式**：在任意時間點，一個 template 最多只有一個 PUBLISHED 版本（即 current）。

**單一 DRAFT 規則**：同一個 template 同時最多只有一個 DRAFT 版本。此規則目前由應用層檢查實現
（`forkApprovalTemplate` 在已存在 DRAFT 時回 `ConflictException`），資料庫層沒有 partial unique index，
因此併發建立時理論上仍可能破壞此不變式。一個 template 可以同時有一個 DRAFT 與一個 PUBLISHED（current）。

> 以下操作對應的實作位於 `libs/bpm-core/src/lib/template/template.service.ts`；GraphQL mutation 名稱為實際 API。
> 本節描述的是目前程式行為，與早期設計不同處以「實際行為」標示。

---

## 3. 操作行為

### 3.1 新增模板

`createApprovalTemplate` mutation（`template.mutations.ts`）：

```
createApprovalTemplate
→ 建立 ApprovalTemplate (current_version_id = NULL, is_active = true)
→ 同時建立 v1 (status = DRAFT，workflow_definition 為空的起始結構)
→ 回傳 template
```

### 3.2 編輯（必為 DRAFT）

`updateApprovalTemplateDraft(input: UpdateApprovalTemplateDraftInput)` mutation，**不是 REST PATCH**：

```
- 僅允許 status = DRAFT 的版本被編輯；其他狀態回 ConflictException（409）
- 不做 optimistic locking：沒有版本號或 updated_at 比對，後寫入者覆蓋先寫入者（last write wins）
```

### 3.3 從現有版本 fork 新版

`forkApprovalTemplate(templateId: ID)` mutation，**不是 REST `POST /templates/{id}/versions`**：

```
- 來源是 template 的 current 版本；沒有 current（尚未發布過）時以空的起始結構建立
- 新版號 = max(version) + 1
- status = DRAFT
- 已存在 DRAFT 時回 ConflictException，不會建立第二個 DRAFT
- 此操作不影響 current
- 目前只能從 current 版本 fork；沒有「從任意 ARCHIVED 版本複製到新 DRAFT」的 API
```

設計器的儲存行為：編輯 current 版本時，不會在開啟時自動 fork；按「儲存」時若沒有既有 DRAFT 才會呼叫 `forkApprovalTemplate`，
之後照常以 `updateApprovalTemplateDraft` 寫入。

### 3.4 發布

`publishApprovalTemplateVersion(versionId: ID, publishedByMemberId: ID)` mutation（發布者以登入身分為準）：

```
1. 驗證該版本為 DRAFT；否則 ConflictException
2. 發布驗證（不修改任何狀態；失敗回 BadRequestException）：
   - 必須綁定表單版本，且該表單版本為 PUBLISHED
   - 流程結構 lint（唯一 Start、連通性、XOR 出邊、cycle detector 等）
   - CEL parse/lint：非 edge 條件的根識別字白名單；edge 條件另允許 lastDecision
   - 表單欄位引用、人員欄位引用、知會節點 webhook 端點（存在、未停用、參數綁定與型別）
3. 事務內：template 已停用（is_active = false）時回 ConflictException
4. 若 template 已有 current PUBLISHED 版本：
     - 該版本 status → ARCHIVED
     - archived_at = now()
5. 此版本 status → PUBLISHED
6. published_at = now(), published_by_member_id = 發布者
7. template.current_version_id = 此版本.id
```

### 3.5 回退

`rollbackApprovalTemplateVersion(versionId: ID)` mutation，**不是 REST `POST /templates/{id}/rollback?targetVersionId=`**：

```
1. target 版本不得為 DRAFT（否則 ConflictException）；目前不要求 target 為 ARCHIVED，
   target 即為 current 時等同重設為 current（仍會寫入）
2. template 已停用時回 ConflictException
3. 若 target 不是 current：原 current PUBLISHED 版本 status → ARCHIVED（archived_at = now()）
4. target status → PUBLISHED（archived_at 清空）
5. template.current_version_id = target.id
```

回退**不會**重新執行發布驗證，也不檢查 target 綁定的表單版本目前是否仍為 PUBLISHED。
目前 target 也可以是歷史上任何非 DRAFT 版本，不限於 ARCHIVED。

> 回退**不影響進行中的 instance**，僅影響「之後發起的新 instance」會用哪個版本。

### 3.6 刪除（軟刪除）— 未實作

**目前沒有刪除模板的 API**（無 `deleteApprovalTemplate` mutation，`DELETE /templates/{id}` 也不存在）。
`approval_templates` 有 `deleted_at` 欄位（TypeORM `@DeleteDateColumn`），相關查詢也會過濾它，
但目前沒有任何 API 寫入此欄位。要讓模板不可再發起，目前的做法是 `deactivateApprovalTemplate`（停用，`is_active = false`）。

以下為規劃中的設計，尚未實作：

```
- template.deleted_at = now()
- 所有版本維持原狀（歷史 instance 仍可引用）
- 不可被列出 / 不可發起新 instance
```

（`deleteApprovalTemplateCategory` 是類別的刪除，與模板無關；類別仍被模板引用時會拒絕刪除。）

---

## 4. Instance 與版本的綁定

### 4.1 Schema

```
ApprovalInstance
├── id
├── template_id            ← 邏輯模板
├── template_version_id    ← 鎖定的版本（不可變）
├── workflow_snapshot      ← 流程定義 JSONB 快照
├── form_definition_snapshot  ← 表單定義快照
├── initiator_metadata_snapshot ← 發起人 metadata 快照
└── ...
```

### 4.2 為什麼 instance 同時需要 `template_version_id` 與 `*_snapshot`？

| 欄位                  | 用途                                                          |
| --------------------- | ------------------------------------------------------------- |
| `template_version_id` | 強引用，可關聯查詢「哪些 instance 用了某個版本」              |
| `workflow_snapshot`   | 自我封閉的不可變副本，**即使 version 表的紀錄被誤刪也能恢復** |

**儲存策略**：

- `workflow_snapshot` 與 `form_definition_snapshot` 用 JSONB
- 可額外加 `snapshot_hash` 欄位，相同內容指向同一份內容（Postgres 不直接支援 dedup，但可在 application 層管理一張 `WorkflowSnapshot` 表去重）

### 4.3 發起時的處理

```
submitApprovalInstance mutation（GraphQL，不是 REST `POST /instances`）
{ templateId, formData }

引擎：
  1. 抓 template.current_version_id
  2. 讀取該版本的 workflow_definition + form_definition_version
  3. 評估 initiator_policy_cel (CEL) → 確認當前 user 有發起權限
  4. 驗證 formData 符合 form_definition 的 schema
  5. 解析 initiator metadata（呼叫 MemberResolver）
  6. 建立 instance 並 snapshot:
     - template_version_id
     - workflow_snapshot = 完整流程 JSON
     - form_definition_snapshot = 完整表單 schema
     - initiator_metadata_snapshot = 發起人當下 metadata
     - form_data = 使用者填寫的內容
  7. 在 Start Event 建立第一顆 token
  8. 觸發引擎 advance
```

---

## 5. 表單版本同樣處理

| FormDefinition      | FormDefinitionVersion             |
| ------------------- | --------------------------------- |
| 邏輯實體（穩定 ID） | 版本實體                          |
| current_version_id  | status (DRAFT/PUBLISHED/ARCHIVED) |
|                     | schema (JSONB)                    |
|                     | ui_schema (JSONB)                 |
|                     | published_at                      |

> 模板版本綁定的是 `form_definition_version_id`，不是 `form_definition_id`。即使表單後續更新，已發布的模板版本不受影響。

---

## 6. UI 行為

### 模板列表頁

- 顯示每個模板的 current version 資訊
- 可看版本歷程（v1 → v2 → v3 ...）
- 標示哪個是 current、哪些是 archived

### 模板設計器

- 開啟 current published 版本時不會自動 fork；按「儲存」或「發布」且沒有既有 DRAFT 時，才以 current 為來源 fork 新 DRAFT（見 3.3）。
- 目前沒有「從任意 archived 版本複製到新 DRAFT」的功能。
- DRAFT 才能編輯

### 版本管理頁（`/templates/[id]/versions`）

- 列出所有版本（版本號、狀態、表單版本、發布時間、更新時間）。
- **未實作**：任兩個版本的差異比對（diff）。
- **未實作**：從 archived 版本複製內容到新 DRAFT（fork 只來自 current）。
- **回退（Rollback）按鈕**目前顯示在所有非 DRAFT 列（包含 current 本身），DRAFT 列停用；它並非只在 archived 版本可見。

---

## 7. 例外處理

| 情境                               | 處理                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| 多人同時編輯同一個 DRAFT           | **未實作** optimistic locking；後寫入者覆蓋先寫入者（規劃：版本號或 updated_at 衝突偵測） |
| 發布時靜態分析失敗                 | 回傳錯誤，不修改任何狀態                                                                  |
| 已發布版本要修正 typo              | 仍須 fork 新版本 → 編輯 → 發布（不允許就地修改）                                          |
| Form 還是 DRAFT 但 Template 想發布 | 阻擋發布（綁定的 form 必須是 PUBLISHED）                                                  |
| 系統清理舊 archived 版本           | **不允許**（除非該版本沒有任何 instance 引用）                                            |

---

## 8. 模板的 Dry Run

模板發布前可以 Dry Run：

1. 給定假的 initiator + 表單值
2. 引擎執行流程模擬（純記憶體，不寫 DB）
3. 顯示會走的路徑、會派發給哪些人、預期 SLA
4. 用於驗證流程設計正確性

Dry Run 已在 W7 完成，設計器會呼叫後端 `dryRunApprovalWorkflow` mutation 顯示
模擬路徑與派發結果。Dry Run 尚未模擬節點補填欄位（`fieldPermissions`）；後續仍可加強統計與更完整的 lint 診斷。
