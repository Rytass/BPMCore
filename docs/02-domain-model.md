# 02 — 領域模型

系統可拆成 10 個高內聚的領域，對應到 NestJS 的 module 劃分。

---

## 1. Identity（身份）

> 系統不存 user 詳細資料，只存 member_id。Metadata 由外部 SSO / HR 系統解析。

| 實體                       | 職責                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| **Member**                 | 僅儲存 member_id（外部來源），與系統內各表的 FK                        |
| **MemberMetadataSnapshot** | Instance 發起時記錄 initiator metadata（防止外部資料變動影響歷史紀錄） |
| **MemberResolver**         | Adapter interface，呼叫外部系統取得即時 metadata                       |
| **MemberMetadataCache**    | PostgreSQL-backed resolver 快取，避免每次列表或簽核都打外部系統        |

```typescript
interface MemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(memberIds: string[]): Promise<Map<string, MemberMetadata>>;
}

interface MemberMetadata {
  memberId: string;
  name: string;
  email: string;
  primaryOrgUnitId: string;
  positionId: string;
  customFields: Record<string, unknown>;
}
```

**快取策略**：目前使用 `member_metadata_cache` PostgreSQL 表 + TTL（預設 5 分鐘）。
這讓列表、歷程、候選人顯示名稱與 email 可重用 resolver 結果，同時仍由宿主
`BPM_MEMBER_RESOLVER` 決定外部 member 的真實來源。

---

## 2. Organization（組織）

| 實體                  | 職責                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| **OrgUnit**           | 組織節點，樹狀（`parent_id` + `path`）                                         |
| **Position**          | 職位定義                                                                       |
| **Membership**        | Member × OrgUnit × Position；含 `is_primary`、生效期間（一個 member 可有多個） |
| **ManagerResolution** | 簽核主管表（**獨立於組織主管**）                                               |

**關鍵原則**：

- 主管不一定等於組織樹 parent → 「組織關係」與「簽核關係」解耦
- 組織節點軟刪除（`deleted_at`），不可實刪（歷史 instance 仍引用）

---

## 3. Delegation（代理）

| 維度      | 說明                                                      |
| --------- | --------------------------------------------------------- |
| **scope** | `ALL` / `TEMPLATE_LIST` / `CONDITION_BASED`（CEL 表達式） |
| **時間**  | start_at / end_at                                         |
| **層級**  | 規則代理（事先設定）+ 任務級轉派（即時手動）              |
| **稽核**  | `original_assignee` 一定保留，與 `delegated_to` 並存      |

詳見 [07 — 流程執行](./07-workflow-execution.md) 中 Delegation 解析順序。

---

## 4. Form（表單定義）

| 實體                      | 職責                          |
| ------------------------- | ----------------------------- |
| **FormDefinition**        | 邏輯表單，穩定 ID             |
| **FormDefinitionVersion** | 表單版本（schema + uiSchema） |

### 欄位類型

| 類別 | 類型                                                 |
| ---- | ---------------------------------------------------- |
| 基本 | text、number、date、datetime、boolean                |
| 選擇 | select / radio / checkbox（含動態資料源）            |
| 進階 | file_upload、signature_pad、table、sub_form、address |
| 系統 | org_picker、user_picker、money（含幣別）             |
| 動態 | calculated_field（公式）、reference_field（查主檔）  |

### 條件邏輯

每個欄位可帶以下條件（CEL 表達式）：

- 顯示 / 隱藏
- 必填
- 唯讀

### 資料來源

- 靜態選項
- 組織 / 人員選擇器（呼叫 Identity / Organization）
- 外部 API（透過 Adapter）
- 主檔查詢

---

## 5. Approval Template（簽核模板）

| 實體                        | 職責                                           |
| --------------------------- | ---------------------------------------------- |
| **ApprovalTemplate**        | 邏輯模板，穩定 ID                              |
| **ApprovalTemplateVersion** | 模板版本（流程定義 + 表單版本綁定 + 發起權限） |

詳見 [04 — 模板版本機制](./04-versioning.md)。

### 模板包含的內容

- 名稱、分類
- **發起權限** (CEL 表達式)
- 繫結的 **FormDefinitionVersion**
- **WorkflowDefinition**（流程圖，BPMN 子集）
- 通知策略
- SLA 預設值

---

## 6. Workflow Engine（流程引擎）

| 實體                 | 職責                                    |
| -------------------- | --------------------------------------- |
| **ApprovalInstance** | 一次簽核發起；快照 template / form 版本 |
| **WorkflowToken**    | Token，沿流程線移動的最小執行單位       |
| **Task**             | 簽核任務，派給特定簽核者                |
| **ActivityLog**      | append-only 稽核軌跡                    |

詳見 [07 — 流程執行](./07-workflow-execution.md)。

---

## 7. Condition（條件評估）

| 實體                      | 職責                               |
| ------------------------- | ---------------------------------- |
| **CelEvaluator**          | CEL 表達式評估器                   |
| **ContextSchemaRegistry** | 註冊每個應用點當下可存取的變數型別 |

詳見 [05 — CEL 條件機制](./05-conditions-cel.md)。

---

## 8. Signature（數位簽章 — L1）

| 實體                | 職責                                              |
| ------------------- | ------------------------------------------------- |
| **Signature**       | 簽章紀錄（`signed_payload_hash` + 演算法 + 時戳） |
| **HmacSigner**      | 使用平台 HMAC 金鑰簽章                            |
| **TimestampClient** | RFC 3161 時戳取得                                 |

簽章標的（會被 hash）：

- `instance_id + node_id + decision + form_data_snapshot_hash + timestamp`
- 鏈式簽章：每筆簽章包含前一筆的 hash（防竄改）

---

## 9. Attachment（附件）

| 實體                  | 職責                                    |
| --------------------- | --------------------------------------- |
| **Attachment**        | 附件 metadata + 儲存路徑                |
| **AttachmentStorage** | 可替換的 `@rytass/storages` adapter     |
| **PdfPreviewService** | 提供 signed URL 給前端 `react-pdf` 渲染 |

**儲存**：

- 預設使用 `@rytass/storages-adapter-local`
- 宿主可透過 `BPMRootModule.attachmentStorageProvider` 替換成 MinIO / S3 / GCS 等 adapter
- signed URL 的 public base URL、route prefix、TTL 與 storage provider metadata
  都可由 `BPMRootModule` root options 設定
- `attachments.filename` 保留原檔名供 UI 顯示；實際儲存路徑使用 attachment id
  作為目錄並清理檔名字元，例如 `${id}/${sanitizeFilename(filename)}`
- 下載走後端代理 + 短期 signed URL

---

## 10. Notification（通知）

| 通道               | 用途               |
| ------------------ | ------------------ |
| in-app             | 必選               |
| email              | 預設               |
| webhook            | 給其他內部系統訂閱 |
| IM (Slack / Teams) | 後期擴充           |

**目前已實作觸發點**：

- 任務派發
- SLA 預警
- SLA 逾時

流程完成、退回、拒絕、模板發布通知屬於後續可補事件，不是目前 runtime 會送出的
notification。

**彙總策略**：可選即時 / 每日摘要（個人化設定）。

---

## 領域間關係圖

```
                 ┌──────────────┐
                 │   Identity   │ (member_id only, 外部 resolve)
                 └──────┬───────┘
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Organization │ │  Delegation  │ │   Template   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       │                │         ┌──────┴───────┐
       │                │         │              │
       │                │         ▼              ▼
       │                │   ┌──────────┐  ┌──────────────┐
       │                │   │   Form   │  │ Workflow Def │
       │                │   └──────────┘  └──────┬───────┘
       │                │                        │
       └────────────────┴────────────────────────┤
                                                 ▼
                                        ┌────────────────┐
                                        │ Workflow Engine│
                                        │  (Instance,    │
                                        │   Token, Task) │
                                        └───────┬────────┘
                                                │
            ┌───────────────────┬───────────────┼───────────────┬─────────────┐
            ▼                   ▼               ▼               ▼             ▼
     ┌────────────┐      ┌────────────┐  ┌────────────┐  ┌────────────┐ ┌──────┐
     │  Signature │      │ Notification│ │ Attachment │  │ Condition  │ │Audit │
     └────────────┘      └────────────┘  └────────────┘  └────────────┘ └──────┘
```
