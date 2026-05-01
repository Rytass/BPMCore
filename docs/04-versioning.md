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
   rollback│ (只剩此版時)       │ 有人 publish 新版
            │                   ▼
            │          ┌──────────────────┐
            └─────────▶│     ARCHIVED     │
                       └──────────────────┘
```

| 狀態 | 描述 | 可發起新 instance | 可被 instance 引用 |
|---|---|---|---|
| **DRAFT** | 編輯中 | ❌ | ❌ |
| **PUBLISHED** | 唯一一個是 current | ✅（如果是 current） | ✅ |
| **ARCHIVED** | 曾發布過的歷史版本 | ❌ | ✅（歷史 instance） |

**關鍵不變式**：在任意時間點，一個 template 最多只有一個 PUBLISHED 版本（即 current）。

---

## 3. 操作行為

### 3.1 新增模板

```
POST /templates
→ 建立 ApprovalTemplate (current_version_id = NULL)
→ 同時建立 v1 (status = DRAFT)
→ 回傳 template + v1
```

### 3.2 編輯（必為 DRAFT）

```
PATCH /templates/{id}/versions/{versionId}
- 僅允許 status = DRAFT 的版本被編輯
- PUBLISHED / ARCHIVED 不可編輯
```

### 3.3 從現有版本 fork 新版

```
POST /templates/{id}/versions
- 從 current_version_id 複製內容
- 新版號 = max(version) + 1
- status = DRAFT
- 此操作不影響 current
```

### 3.4 發布

```
POST /templates/{id}/versions/{versionId}/publish

事務內：
  1. 驗證該版本為 DRAFT
  2. 執行靜態分析（流程結構合法性、CEL 表達式型別檢查）
  3. 若 template 已有 current PUBLISHED 版本：
     - 該版本 status → ARCHIVED
     - archived_at = now()
  4. 此版本 status → PUBLISHED
  5. published_at = now(), published_by_member_id = current user
  6. template.current_version_id = 此版本.id
```

### 3.5 回退

```
POST /templates/{id}/rollback?targetVersionId=xxx

事務內：
  1. 驗證 targetVersion 為 ARCHIVED
  2. current PUBLISHED 版本 status → ARCHIVED
  3. targetVersion status → PUBLISHED
  4. template.current_version_id = targetVersion.id
```

> 回退**不影響進行中的 instance**，僅影響「之後發起的新 instance」會用哪個版本。

### 3.6 刪除（軟刪除）

```
DELETE /templates/{id}
- template.deleted_at = now()
- 所有版本維持原狀（歷史 instance 仍可引用）
- 不可被列出 / 不可發起新 instance
```

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

| 欄位 | 用途 |
|---|---|
| `template_version_id` | 強引用，可關聯查詢「哪些 instance 用了某個版本」 |
| `workflow_snapshot` | 自我封閉的不可變副本，**即使 version 表的紀錄被誤刪也能恢復** |

**儲存策略**：
- `workflow_snapshot` 與 `form_definition_snapshot` 用 JSONB
- 可額外加 `snapshot_hash` 欄位，相同內容指向同一份內容（Postgres 不直接支援 dedup，但可在 application 層管理一張 `WorkflowSnapshot` 表去重）

### 4.3 發起時的處理

```
POST /instances
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

| FormDefinition | FormDefinitionVersion |
|---|---|
| 邏輯實體（穩定 ID） | 版本實體 |
| current_version_id | status (DRAFT/PUBLISHED/ARCHIVED) |
| | schema (JSONB) |
| | ui_schema (JSONB) |
| | published_at |

> 模板版本綁定的是 `form_definition_version_id`，不是 `form_definition_id`。即使表單後續更新，已發布的模板版本不受影響。

---

## 6. UI 行為

### 模板列表頁
- 顯示每個模板的 current version 資訊
- 可看版本歷程（v1 → v2 → v3 ...）
- 標示哪個是 current、哪些是 archived

### 模板設計器
- 開啟 current published 版本 → 自動 fork 新 DRAFT 版本（提示使用者）
- 也可直接從 archived 版本 fork（複製其內容到新 DRAFT）
- DRAFT 才能編輯

### 版本管理頁
- 列出所有版本
- 可比對任兩個版本的差異（diff）
- 可從 archived 版本複製內容到新 DRAFT
- **回退按鈕**只在 archived 版本可見

---

## 7. 例外處理

| 情境 | 處理 |
|---|---|
| 多人同時編輯同一個 DRAFT | Optimistic locking（版本號或 updated_at 衝突偵測）|
| 發布時靜態分析失敗 | 回傳錯誤，不修改任何狀態 |
| 已發布版本要修正 typo | 仍須 fork 新版本 → 編輯 → 發布（不允許就地修改） |
| Form 還是 DRAFT 但 Template 想發布 | 阻擋發布（綁定的 form 必須是 PUBLISHED） |
| 系統清理舊 archived 版本 | **不允許**（除非該版本沒有任何 instance 引用） |

---

## 8. 模板的 Dry Run

模板發布前可以 Dry Run：
1. 給定假的 initiator + 表單值
2. 引擎執行流程模擬（純記憶體，不寫 DB）
3. 顯示會走的路徑、會派發給哪些人、預期 SLA
4. 用於驗證流程設計正確性

詳見 [09 — 開發路線圖](./09-roadmap.md) M4 規劃。
