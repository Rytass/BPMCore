# 06 — 資料模型 (ER)

> 資料庫：PostgreSQL。所有 ID 為 `uuid`（除非另註）。
> JSON 類型統一用 `jsonb`。
> 時間欄位統一 `timestamptz`。
> 以下欄位與索引以 `libs/bpm-core/src/lib/**/*.entity.ts` 與 `libs/bpm-core/src/lib/migrations/` 為準；
> 遷移的實際執行順序以 package 匯出的 `BPM_CORE_MIGRATIONS` 為準。

## 表清單

| 領域            | 表                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `member_metadata_cache`                                                                                                                                             |
| Organization    | `org_units`, `positions`, `memberships`, `manager_resolutions`                                                                                                      |
| Delegation      | `delegation_rules`                                                                                                                                                  |
| Form            | `form_definitions`, `form_definition_versions`                                                                                                                      |
| Template        | `approval_templates`, `approval_template_versions`, `approval_template_categories`                                                                                  |
| Workflow Engine | `approval_instances`, `workflow_tokens`, `tasks`, `task_candidates`, `task_decisions`, `task_adhoc_directives`（見 `docs/13` §8）                                    |
| Audit           | `activity_logs`                                                                                                                                                     |
| Attachment      | `attachments`                                                                                                                                                       |
| Signature       | `signatures`                                                                                                                                                        |
| Notification    | `notifications`, `notification_preferences`                                                                                                                         |
| Webhook         | `workflow_webhook_endpoints`, `workflow_webhook_endpoint_audits`, `workflow_webhook_deliveries`                                                                     |

> Wrapper host-owned fixture table：`apps/api` 的 `api_form_data_source_options` 保存
> deterministic demo DataSource rows，建立、truncate 與 seed 都由 `apps/api` 負責，
> 不屬於 `libs/bpm-core` 或 `BPM_CORE_MIGRATIONS`。

---

## 1. Identity

### `member_metadata_cache`

> 系統不存 user，只快取外部 resolver 的回傳值（`MemberMetadataCacheEntity`）。

```
id                  uuid PK
member_id           text UNIQUE   -- 外部系統的會員 ID
metadata            jsonb         -- MemberMetadata：memberId, name, email, customFields
fetched_at          timestamptz
expires_at          timestamptz   -- TTL 預設 5 分鐘（identityOptions.memberMetadataCacheTtlMs）
```

> 也可用 Redis 做（Postgres 表方便除錯，但效率不如 Redis）。MVP 先用 Postgres。

---

## 2. Organization

### `org_units`

```
id                  uuid PK
parent_id           uuid FK → org_units.id (nullable)
code                text             -- 業務代碼，如 FIN-TW-01；未刪除的列中唯一（見下方索引）
name                text
type                text             -- OrgUnitTypeEnum：company / division / department / team
path                ltree            -- materialized path (PG ltree extension)
metadata            jsonb            -- cost_center, location, ...
deleted_at          timestamptz      -- soft delete（DeleteDateColumn）
created_at          timestamptz
updated_at          timestamptz

INDEX (parent_id)                                    -- idx_org_units_parent_id
INDEX path GIST                                      -- idx_org_units_path_gist
INDEX (deleted_at) WHERE deleted_at IS NULL          -- idx_org_units_not_deleted
UNIQUE INDEX org_units_code_active_key (code) WHERE deleted_at IS NULL
```

> `code` 原先為整表 UNIQUE；migration `0000000022000` 改為只在未刪除列上唯一，已刪除的組織單位不佔用代碼。

### `positions`

```
id                  uuid PK
code                text UNIQUE
name                text
level               int             -- 職等（數字越大越高階）
metadata            jsonb
created_at          timestamptz
updated_at          timestamptz
```

### `memberships`

```
id                  uuid PK
member_id           text             -- 外部系統 ID
org_unit_id         uuid FK → org_units.id
position_id         uuid FK → positions.id (nullable)
is_primary          boolean DEFAULT false
effective_from      date
effective_to        date (nullable)
created_at          timestamptz
updated_at          timestamptz

INDEX (member_id)                                    -- idx_memberships_member_id
INDEX (org_unit_id)                                  -- idx_memberships_org_unit_id
UNIQUE (member_id, org_unit_id, position_id, effective_from)  -- uq_memberships_effective
```

### `manager_resolutions`

> 「簽核主管」獨立於組織樹的 parent。沒有 `updated_at`。

```
id                  uuid PK
scope_type          text             -- 'MEMBER' | 'ORG_UNIT' | 'POSITION'
scope_id            text             -- member_id / org_unit_id / position_id
manager_member_id   text
priority            int              -- 數字大者優先；同 priority 時依建立時間決定
effective_from      date
effective_to        date (nullable)
created_at          timestamptz

INDEX (scope_type, scope_id)                         -- idx_manager_resolutions_scope
```

---

## 3. Delegation

### `delegation_rules`

```
id                       uuid PK
principal_member_id      text                 -- 被代理者
agent_member_id          text                 -- 代理人
scope_type               text                 -- 'ALL' | 'TEMPLATE_LIST' | 'CONDITION_BASED'
scope_template_ids       uuid[] NOT NULL DEFAULT '{}'   -- scope_type = TEMPLATE_LIST 時
scope_condition_cel      text (nullable)      -- scope_type = CONDITION_BASED 時
priority                 int DEFAULT 100      -- 數字大者優先；同 priority 時較早建立者優先（未發佈，v0.16.2 之後；已發佈版本（實際為最早建立者優先：排序是 `createdAt` ASC 再 `priority` ASC，priority 只在建立時間相同時才比較））
start_at                 timestamptz
end_at                   timestamptz (nullable)
requires_confirmation    boolean DEFAULT false
status                   text                 -- 'ACTIVE' | 'REVOKED' | 'EXPIRED'
created_at               timestamptz
updated_at               timestamptz
created_by_member_id     text (nullable)
revoked_at               timestamptz (nullable)
revoked_by_member_id     text (nullable)

INDEX (principal_member_id, status, start_at, end_at) -- IDX_delegation_rules_principal_status
INDEX (agent_member_id)                               -- IDX_delegation_rules_agent
```

---

## 4. Form

### `form_definitions`

```
id                          uuid PK
name                        text
description                 text (nullable)
current_version_id          uuid FK → form_definition_versions.id (nullable)
deleted_at                  timestamptz (nullable)   -- DeleteDateColumn
created_at                  timestamptz
updated_at                  timestamptz
created_by_member_id        text (nullable)

INDEX (deleted_at) WHERE deleted_at IS NULL          -- idx_form_definitions_not_deleted
```

### `form_definition_versions`

```
id                          uuid PK
form_definition_id          uuid FK → form_definitions.id
version                     int
status                      text                  -- 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
schema                      jsonb                 -- 欄位定義
ui_schema                   jsonb                 -- 排版/顯示
published_at                timestamptz (nullable)
published_by_member_id      text (nullable)
archived_at                 timestamptz (nullable)
created_at                  timestamptz
updated_at                  timestamptz

UNIQUE (form_definition_id, version)                 -- uq_form_definition_versions_version
INDEX (form_definition_id, status)                   -- idx_form_definition_versions_definition_status
```

---

## 5. Template

### `approval_templates`

```
id                          uuid PK
name                        text
description                 text (nullable)
category                    text (nullable)       -- 舊版字串分類，保留相容；新寫入以 category_id 為準
category_id                 uuid FK → approval_template_categories.id (nullable)
current_version_id          uuid FK → approval_template_versions.id (nullable)
is_active                   boolean DEFAULT true
deleted_at                  timestamptz (nullable)   -- DeleteDateColumn
created_at                  timestamptz
updated_at                  timestamptz
created_by_member_id        text (nullable)

INDEX (deleted_at) WHERE deleted_at IS NULL          -- idx_approval_templates_not_deleted
INDEX (category_id)                                  -- idx_approval_templates_category_id
INDEX (is_active)                                    -- idx_approval_templates_is_active
```

### `approval_template_categories`

```
id                          uuid PK
name                        text
description                 text (nullable)
is_active                   boolean DEFAULT true
sort_order                  int DEFAULT 0
created_at                  timestamptz
updated_at                  timestamptz

INDEX (is_active, sort_order, name)                  -- idx_approval_template_categories_active_sort
```

### `approval_template_versions`

```
id                              uuid PK
template_id                     uuid FK → approval_templates.id
version                         int
status                          text                 -- 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
workflow_definition             jsonb                -- React Flow nodes + edges
form_definition_version_id      uuid FK → form_definition_versions.id (nullable)
initiator_policy_cel            text (nullable)      -- 發起權限 CEL（見 docs/05）
notification_config             jsonb (nullable)
sla_defaults                    jsonb (nullable)
published_at                    timestamptz (nullable)
published_by_member_id          text (nullable)
archived_at                     timestamptz (nullable)
created_at                      timestamptz
updated_at                      timestamptz

UNIQUE (template_id, version)                        -- uq_approval_template_versions_version
INDEX (template_id, status)                          -- idx_approval_template_versions_template_status
```

---

## 6. Workflow Engine

### `approval_instances`

```
id                                  uuid PK
template_id                         uuid FK → approval_templates.id
template_version_id                 uuid FK → approval_template_versions.id
initiator_member_id                 text
initiator_metadata_snapshot         jsonb        -- 發起當下的 metadata 快照
submitted_by_member_id              text (nullable) -- 代為送出的人；NULL 或等於 initiator_member_id ＝ 申請人自己送出
workflow_snapshot                   jsonb        -- 流程定義快照
form_definition_snapshot            jsonb        -- 表單定義快照
form_data                           jsonb        -- 使用者填寫
form_data_option_snapshot           jsonb        -- 動態選項 label/source/hash snapshot
state                               text         -- RUNNING/APPROVED/REJECTED/CANCELLED/RETURNED/EXPIRED（EXPIRED 由 SLA 終止寫入，未發佈，v0.16.2 之後；DRAFT 保留，目前引擎不寫入）
title                               text         -- 自動產生（從 form_data 取一個欄位 or 模板名）
business_key                        text (nullable) -- 宿主單據對應鍵；僅服務層送簽可帶，GraphQL 不可設
started_at                          timestamptz
completed_at                        timestamptz (nullable)
created_at                          timestamptz
updated_at                          timestamptz

INDEX (initiator_member_id, state)                   -- idx_approval_instances_initiator_state
INDEX (template_id, state)                           -- idx_approval_instances_template_state
INDEX (state, started_at)                            -- idx_approval_instances_state_started
INDEX (submitted_by_member_id, created_at DESC)      -- IDX_approval_instances_submitted_by_created_desc；「我送出的」清單用
INDEX (created_at DESC)                              -- IDX_approval_instances_created_desc
INDEX (state, created_at DESC)                       -- IDX_approval_instances_state_created_desc
INDEX (template_id, created_at DESC)                 -- IDX_approval_instances_template_created_desc
INDEX (initiator_member_id, created_at DESC)         -- IDX_approval_instances_initiator_created_desc
GIN (lower(title) gin_trgm_ops)                      -- IDX_approval_instances_title_trgm
GIN (lower(initiator_member_id) gin_trgm_ops)        -- IDX_approval_instances_initiator_trgm
UNIQUE INDEX approval_instances_business_key_key (template_id, business_key)
  WHERE business_key IS NOT NULL   -- 同範本內唯一；不看 state，CANCELLED／REJECTED 仍佔著鍵
```

`business_key` 的規則（trim、200 字上限、重複時的 ConflictException、查詢方法）見
[api-reference — Business key](./api-reference.md#business-key-host-document--instance)。

`form_data_option_snapshot` 的 key 是 field key；每筆 snapshot 保存 primitive value
對應的 label、DataSource key/version、binding hash 與 validation timestamp。唯讀歷史
畫面只依這份 instance snapshot 顯示，不需要重新呼叫宿主 DataSource。

#### `form_data` 與 snapshot 的表格欄位形狀

`table` 欄位（[16 — 表格欄位 ADR](./16-form-table-field-adr.md)）是**唯一**值不是
primitive 的欄位型別：它的值是**列陣列**，每一列是一筆以 column key 為鍵的
record，cell 值維持與扁平欄位相同的 primitive contract。列**不落地任何 row id**
——陣列順序即顯示順序，前端編輯期的 row id 是 ephemeral 的，不寫入資料。

```jsonc
// approval_instances.form_data
{
  "purpose": "產線耗材補充",          // 扁平欄位，形狀一如既往
  "items": [                          // table 欄位：列陣列
    { "plant": "TW01", "costCenter": "CC-TW01-001", "quantity": 120 },
    { "plant": "TW02", "costCenter": "CC-TW02-002", "quantity": 40 }
  ]
}
```

表格內的動態 column 逐 cell 產生 snapshot，key 是 **instance path**
`<tableKey>[<i>].<columnKey>`；`form_data_option_snapshot` 的型別與欄位一個位元
都沒變，只是 key 的形式擴充，因此**不需要 migration**：

```jsonc
// approval_instances.form_data_option_snapshot
{
  "items[0].costCenter": { "dataSourceKey": "demo.cost-centers", "dataSourceVersion": 1,
    "options": [{ "label": "TW01 成本中心 001", "value": "CC-TW01-001" }],
    "bindingHash": "…", "revalidationPolicy": "WHEN_VALUE_OR_BINDINGS_CHANGE",
    "validatedAt": "2026-05-21T04:30:00.000Z" },
  "items[1].costCenter": { "dataSourceKey": "demo.cost-centers", "dataSourceVersion": 1,
    "options": [{ "label": "TW02 成本中心 002", "value": "CC-TW02-002" }], "…": "…" }
}
```

插入或刪除列會讓其後每個 cell 落到「原本屬於別列」的 key 上——**key 本身仍然對得
上，不構成保護**。真正擋住誤用的是重用條件的另外兩項：舊值是從 `previousFormData`
**同索引**的那一列讀出來的，binding hash 則以該列當下的值重算，位移後兩者都會跟
「原本在這個位置的列」比對而不相符，於是該 cell 重新 resolve。只有值與每個 binding
都完全相同才會沿用，那種情況下沿用與重打 provider 等價。**不要因為 key 帶了列索引
就移除舊值或 hash 比對**——那才是 A 列 snapshot 去背書 B 列值的路徑。

`title` 取值時會**跳過** table 欄位——列數不是好標題，改取第一個非表格欄位。

### `workflow_tokens`

> 每顆 token 是引擎執行的最小單位。`status` 只有 `ACTIVE`、`WAITING`、`CONSUMED` 三種。
> 沒有 `updated_at`。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
current_node_id             text                  -- node id in workflow_snapshot
status                      text                  -- 'ACTIVE' | 'WAITING' | 'CONSUMED'
parent_token_id             uuid (nullable)       -- 從哪一顆分裂出來（分叉時）
created_at                  timestamptz
consumed_at                 timestamptz (nullable)

INDEX (instance_id, status)                          -- idx_workflow_tokens_instance_status
```

### `tasks`

> 沒有 `updated_at`。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
token_id                    uuid FK → workflow_tokens.id
node_id                     text                  -- 對應的 user task 節點 id
original_assignee_member_id text (nullable)       -- resolver 解出的原始 assignee
assignee_member_id          text (nullable)       -- 套用 delegation 後的實際 assignee
assignment_type             text DEFAULT 'DIRECT_MEMBER' -- 'DIRECT_MEMBER' | 'CANDIDATE_GROUP'
decision_policy_snapshot    jsonb DEFAULT '{"type":"SINGLE"}'  -- 建立時的決策政策快照
delegation_chain            jsonb                 -- 代理鏈紀錄 [{from, to, ruleId, reason}]
status                      text                  -- 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'TRANSFERRED' | 'CANCELLED'
sla_due_at                  timestamptz (nullable)
sla_started_at              timestamptz (nullable) -- 目前 SLA 視窗的起點；SEQUENTIAL 輪到下一位時重設，NULL 表示從 created_at 起算
is_adhoc                    boolean DEFAULT false
adhoc_type                  text (nullable)       -- 'COUNTERSIGN' | 'PRE_APPROVAL'（僅 ad-hoc task）
adhoc_origin_task_id        uuid (nullable)
adhoc_directive_id          uuid (nullable)
created_at                  timestamptz
opened_at                   timestamptz (nullable)
completed_at                timestamptz (nullable)

INDEX (assignee_member_id, status)                   -- idx_tasks_assignee_status
INDEX (instance_id, node_id)                         -- idx_tasks_instance_node
INDEX (instance_id, assignee_member_id) WHERE assignee_member_id IS NOT NULL      -- IDX_tasks_instance_assignee_read
INDEX (instance_id, original_assignee_member_id) WHERE original_assignee_member_id IS NOT NULL -- IDX_tasks_instance_original_assignee_read
INDEX (sla_due_at) WHERE sla_due_at IS NOT NULL AND status IN ('PENDING','IN_PROGRESS')  -- idx_tasks_sla_due
```

### `task_candidates`

> Candidate-group task 的候選簽核人。單一 member 決策後，其餘候選會關閉。
> `SEQUENTIAL`（依序簽核）的 task 以 `sequence` 排定順序，輪到的人 `PENDING`、其餘 `WAITING`，
> 詳見 `07-workflow-execution.md` §4.3。沒有 `updated_at`。

```
id                          uuid PK
task_id                     uuid FK → tasks.id ON DELETE CASCADE
member_id                   text
original_member_id          text
source_type                 text                  -- 解出此候選人的 resolver 型別（見下），或 EXCLUDE_INITIATOR_MANAGER
delegation_chain            jsonb
sequence                    integer (nullable)    -- SEQUENTIAL task 內的簽核順序（0 起算）；其他 task 與舊資料為 NULL
status                      text                  -- PENDING / CLAIMED / COMPLETED / CANCELLED / TRANSFERRED / SUPERSEDED / WAITING（SEQUENTIAL 尚未輪到）
claimed_at                  timestamptz (nullable)
decided_at                  timestamptz (nullable)
created_at                  timestamptz

UNIQUE INDEX (task_id, member_id)                    -- idx_task_candidates_task_member
INDEX (member_id, status)                            -- idx_task_candidates_member_status
INDEX (task_id)                                      -- idx_task_candidates_task
INDEX (member_id, task_id)                           -- IDX_task_candidates_member_task
INDEX (original_member_id, task_id)                  -- IDX_task_candidates_original_member_task
```

`source_type` 的值為 `ApproverResolver['type']`（`DIRECT`、`POSITION`、`ORG_UNIT_MEMBER`、`ORG_UNIT_POSITION`、
`ORG_UNIT_MANAGER`、`ORG_MANAGER`、`ORG_MANAGER_CHAIN`、`DYNAMIC_FORM`、`EXPRESSION`），
另有 `EXCLUDE_INITIATOR_MANAGER`（申請人被排除後改派其主管，見 `docs/07` §4.4）。
ad-hoc 會簽時解析出的候選人同樣記錄其 resolver 型別。

### `task_decisions`

> Task 決策可能不只一次（被退回又重新派發），每次決策一筆紀錄。

```
id                          uuid PK
task_id                     uuid FK → tasks.id
decided_by_member_id        text
action                      text          -- 'APPROVED' | 'REJECTED' | 'RETURNED' | 'TRANSFERRED'
comment                     text (nullable) -- REJECTED 必填（見 docs/07 §5.2）
return_to_node_id           text (nullable) -- action = RETURNED 時
transfer_to_member_id       text (nullable) -- action = TRANSFERRED 時
signature_id                uuid FK → signatures.id (nullable)
decided_at                  timestamptz

INDEX (task_id)                                      -- idx_task_decisions_task
INDEX (decided_by_member_id, decided_at)             -- idx_task_decisions_decider
INDEX (decided_by_member_id, task_id)                -- IDX_task_decisions_decider_task
```

ad-hoc 指令（`task_adhoc_directives`）的結構見 `docs/13` §8.1。

---

## 7. Audit

### `activity_logs`

> Append-only。記錄所有重要事件（人為決策、系統事件如 token advance、SLA 觸發、案件逾期終止等）。
> 事件類型見 `workflow-engine.enums.ts` 的 `ActivityLogEventTypeEnum`。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
event_type                  text          -- 例：INSTANCE_STARTED / TOKEN_ADVANCED / TASK_CREATED / TASK_DECIDED / TASK_CANDIDATE_ACTIVATED / SLA_TRIGGERED / INSTANCE_EXPIRED（未發佈，v0.16.2 之後）/ ...
actor_member_id             text (nullable)  -- null = 系統事件（如 SLA 逾時、逾期終止）
node_id                     text (nullable)
task_id                     uuid (nullable)
payload                     jsonb         -- 事件特定資料
created_at                  timestamptz

INDEX (instance_id, created_at)                      -- idx_activity_logs_instance_created
INDEX (actor_member_id, created_at)                  -- idx_activity_logs_actor_created
```

---

## 8. Attachment

### `attachments`

> 沒有 `updated_at`。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id (nullable)
task_id                     uuid FK → tasks.id (nullable)
form_field_path             text (nullable)   -- 對應表單的哪個欄位（如 form.attachments[0]）
uploader_member_id          text
filename                    text              -- 原檔名
mime_type                   text
size_bytes                  bigint
storage_provider            text              -- adapter 標識，目前預設 'local'
storage_key                 text              -- storage adapter key
checksum_sha256             text
created_at                  timestamptz

INDEX (instance_id)                                  -- IDX_attachments_instance
INDEX (task_id)                                      -- IDX_attachments_task
```

---

## 9. Signature

### `signatures`

> 沒有 `updated_at`。鏈式簽章的規則與簽章標的見 `docs/02` §8。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
task_id                     uuid FK → tasks.id (nullable)
signer_member_id            text
algorithm                   text                  -- 'HMAC-SHA256'
signed_payload              jsonb                 -- 被簽章的內容（action、comment、decidedAt、formDataHash、instanceId、nodeId、taskId、signerMemberId 等）
signed_payload_hash         text                  -- signed_payload 穩定字串化後的 SHA-256
signature                   text                  -- HMAC-SHA256(key[key_version], signed_payload_hash) 的 base64
key_version                 int                   -- 平台金鑰版本（支援輪替）
previous_signature_hash     text (nullable)       -- 鏈式簽章：同 instance 上一筆的 signed_payload_hash
timestamp_token             bytea (nullable)      -- 時戳 token（由宿主 timestampProvider 提供，可為 null）
signed_at                   timestamptz

INDEX (instance_id, signed_at)                       -- IDX_signatures_instance_signed_at
INDEX (signer_member_id, signed_at)                  -- IDX_signatures_signer_signed_at
```

---

## 10. Notification

### `notifications`

> 沒有 `updated_at`。

```
id                          uuid PK
recipient_member_id         text
channel                     text          -- 'IN_APP' | 'EMAIL' | 'WEBHOOK'
type                        text          -- NotificationTypeEnum：'TASK_ASSIGNED' | 'TASK_TRANSFERRED' | 'SLA_WARNING' | 'SLA_OVERDUE' | 'INSTANCE_COMPLETED' | 'WORKFLOW_NOTIFICATION'
instance_id                 uuid (nullable)
task_id                     uuid (nullable)
title                       text          -- 已渲染標題，供 in-app/email/webhook 共用
body                        text          -- 已渲染內文，供 in-app/email/webhook 共用
payload                     jsonb         -- 渲染用資料
status                      text          -- 'PENDING' | 'DELIVERY_IN_PROGRESS' | 'SENT' | 'FAILED' | 'READ'
resolution                  text (nullable) -- 'APPROVED' | 'REJECTED' | 'RETURNED' | 'TRANSFERRED' | 'SUPERSEDED'（待辦類通知的結案狀態）
resolved_at                 timestamptz (nullable)
sent_at                     timestamptz (nullable)
read_at                     timestamptz (nullable)
archived_at                 timestamptz (nullable)
silenced                    boolean DEFAULT false
attempt_count               int DEFAULT 0
last_attempt_at             timestamptz (nullable)
next_retry_at               timestamptz (nullable)
delivery_error              text (nullable)
delivered_at                timestamptz (nullable)
delivery_target             text (nullable)
created_at                  timestamptz

INDEX (recipient_member_id, status, created_at)      -- IDX_notifications_recipient_status_created
INDEX (status) WHERE status = 'PENDING'              -- IDX_notifications_pending
INDEX (status, next_retry_at, created_at) WHERE status = 'PENDING'  -- IDX_notifications_pending_delivery
INDEX (task_id, type, channel) WHERE task_id IS NOT NULL             -- IDX_notifications_task_type_channel
INDEX (recipient_member_id, instance_id) WHERE instance_id IS NOT NULL  -- IDX_notifications_recipient_instance
INDEX (task_id, recipient_member_id) WHERE resolution IS NULL AND task_id IS NOT NULL  -- IDX_notifications_open_task
INDEX (recipient_member_id, created_at) WHERE archived_at IS NULL   -- IDX_notifications_recipient_active
UNIQUE (task_id, recipient_member_id, type, channel)
  WHERE task_id IS NOT NULL AND type IN ('SLA_WARNING', 'SLA_OVERDUE')  -- UQ_notifications_sla_once
```

### `notification_preferences`

```
member_id                   text PK
in_app_enabled              boolean DEFAULT true
email_enabled               boolean DEFAULT true
email_digest_mode           text         -- 'INSTANT' | 'DAILY'
quiet_hours_start           time (nullable)
quiet_hours_end             time (nullable)
updated_at                  timestamptz
```

---

## 11. Webhook

以下三表屬於 workflow webhook 子系統（`workflow-webhook-*.entity.ts`）。

### `workflow_webhook_endpoints`

```
id                          uuid PK
key                         text
version                     int
label                       text
description                 text (nullable)
parameters                  jsonb DEFAULT '[]'
url                         text
method                      text DEFAULT 'POST'
encrypted_headers           text (nullable)
encrypted_signing_secret    text (nullable)
timeout_ms                  int (nullable)
is_active                   boolean DEFAULT true
deprecated                  boolean DEFAULT false
secret_rotated_at           timestamptz (nullable)
created_by_member_id        text (nullable)
updated_by_member_id        text (nullable)
created_at                  timestamptz
updated_at                  timestamptz

UNIQUE (key, version)                                -- UQ_workflow_webhook_endpoints_key_version
INDEX (is_active)                                    -- IDX_workflow_webhook_endpoints_active
```

### `workflow_webhook_endpoint_audits`

```
id                          uuid PK
endpoint_id                 uuid
action                      text
changed_fields              jsonb DEFAULT '[]'
actor_member_id             text (nullable)
created_at                  timestamptz

INDEX (endpoint_id, created_at)                      -- IDX_workflow_webhook_endpoint_audits_endpoint
```

### `workflow_webhook_deliveries`

```
id                          uuid PK
instance_id                 uuid
node_id                     text
token_id                    uuid
target_id                   text
endpoint_key                text
endpoint_version            int
event                       jsonb                 -- 凍結的事件內容
status                      text
attempt_count               int DEFAULT 0
next_retry_at               timestamptz (nullable)
last_attempt_at             timestamptz (nullable)
last_response_status        int (nullable)
last_error_code             text (nullable)
last_error_detail           text (nullable)
sent_at                     timestamptz (nullable)
created_at                  timestamptz
updated_at                  timestamptz

UNIQUE (token_id, target_id)                         -- UQ_workflow_webhook_deliveries_token_target
INDEX (instance_id, created_at)                      -- IDX_workflow_webhook_deliveries_instance
INDEX (status, next_retry_at, created_at)              -- IDX_workflow_webhook_deliveries_pending
```

---

## 12. ER 關聯圖（簡化）

```
                                     ┌─────────────────────────┐
                                     │  approval_templates     │
                                     └────────────┬────────────┘
                                                  │ 1
                                                  │ has many
                                                  ▼ N
                                     ┌─────────────────────────────┐
                                     │ approval_template_versions  │
                                     └────────────┬────────────────┘
                                                  │ 1
              ┌───────────────────────────────────┴─────────────┐
              │ binds (form version)                            │ creates
              ▼                                                 ▼ N
   ┌──────────────────────────┐                ┌──────────────────────────┐
   │ form_definition_versions │                │   approval_instances     │
   └──────────────────────────┘                └────────────┬─────────────┘
              ▲                                              │ 1
              │ belongs_to                                   ├──────┐
              │                                              │      │
   ┌──────────┴───────────┐                                  ▼ N    ▼ N
   │   form_definitions   │                          ┌────────────┐ ┌────────────┐
   └──────────────────────┘                          │   tokens   │ │   tasks    │
                                                     └────────────┘ └─────┬──────┘
                                                                          │ 1
                                                                          │ has many
                                                                          ▼ N
                                                                    ┌────────────────┐
                                                                    │ task_decisions │
                                                                    └────────────────┘

   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │   org_units  │────│ memberships  │────│ (member_id)  │
   └──────────────┘    └──────────────┘    └──────────────┘

   ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ delegation_rules│ │ activity_logs│ │ signatures   │ │ attachments  │
   └─────────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 13. 重要索引與查詢

### 個人 Inbox 查詢

```sql
SELECT t.*, i.title FROM tasks t
JOIN approval_instances i ON i.id = t.instance_id
WHERE t.assignee_member_id = $1
  AND t.status IN ('PENDING', 'IN_PROGRESS')
ORDER BY t.sla_due_at NULLS LAST, t.created_at;
```

索引：`tasks (assignee_member_id, status)`

### SLA 掃描（示意）

掃描器以 `status IN ('PENDING','IN_PROGRESS')` 且 `sla_due_at` 有值的 task 為對象，
依 `sla_due_at` 判斷逾時與預警（實際實作見 `docs/07` §6.2）。
對應索引：`tasks (sla_due_at) WHERE sla_due_at IS NOT NULL AND status IN ('PENDING','IN_PROGRESS')`。

### 主管展開查詢

查詢「我下面所有的 instance」用 `org_units.path` ltree 操作（`@>` 包含關係）。

---

## 14. Migration 順序（提示）

實際順序以 `libs/bpm-core/src/lib/migrations/` 的檔名數字與 package 匯出的 `BPM_CORE_MIGRATIONS` 為準。
外部宿主應從 `@rytass/bpm-core-nestjs-module/migrations` 匯入 class list，而不是使用 source glob。

| 編號 | 內容（摘要）                                                                  |
| ---- | ----------------------------------------------------------------------------- |
| 0000000000001 | PostgreSQL extensions：`uuid-ossp`、`ltree`、`pg_trgm`（其餘 migration 的前提；`pg_trgm` 的檢查未發佈，v0.16.2 之後） |
| 0001 | 組織與身分基礎：`org_units`、`positions`、`memberships`、`manager_resolutions`、`member_metadata_cache` |
| 0002 | 表單：`form_definitions`、`form_definition_versions`                           |
| 0003 | 模板：`approval_templates`、`approval_template_versions`                       |
| 0004 | 流程引擎：`approval_instances`、`workflow_tokens`、`tasks`、`task_decisions`、`activity_logs` |
| 0005 | 委派：`delegation_rules`                                                       |
| 0006 | 通知與 SLA：`notifications`、`notification_preferences`                        |
| 0007 | 簽章與附件：`signatures`、`attachments`                                        |
| 0008 | 模板分類：`approval_template_categories`                                       |
| 0009 | 候選人：`task_candidates`                                                      |
| 0010–0021 | 通知投遞狀態、SLA 冪等索引、查詢索引（0013 會建立 `pg_trgm` 擴充）、通知結案／封存／靜音、表單選項快照等     |
| 0017 | ad-hoc 指令：`task_adhoc_directives` 與 `tasks` 的 ad-hoc 欄位（見 `docs/13`） |
| 0022 | `org_units.code` 改為未刪除列唯一                                              |
| 0023–0024 | workflow webhook：deliveries、endpoints                                      |
| 0025 | `task_candidates.sequence`、`tasks.sla_started_at`（SEQUENTIAL）               |
| 0026 | `approval_instances.business_key`                                              |
| 0027 | `approval_instances.submitted_by_member_id`                                    |
