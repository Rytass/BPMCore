# 06 — 資料模型 (ER)

> 資料庫：PostgreSQL。所有 ID 為 `uuid`（除非另註）。
> JSON 類型統一用 `jsonb`。
> 時間欄位統一 `timestamptz`。

## 表清單

| 領域            | 表                                                                                  |
| --------------- | ----------------------------------------------------------------------------------- |
| Identity        | `member_metadata_cache`                                                             |
| Organization    | `org_units`, `positions`, `memberships`, `manager_resolutions`                      |
| Delegation      | `delegation_rules`                                                                  |
| Form            | `form_definitions`, `form_definition_versions`                                      |
| Template        | `approval_templates`, `approval_template_versions`, `approval_template_categories`   |
| Workflow Engine | `approval_instances`, `workflow_tokens`, `tasks`, `task_candidates`, `task_decisions` |
| Audit           | `activity_logs`                                                                     |
| Attachment      | `attachments`                                                                       |
| Signature       | `signatures`                                                                        |
| Notification    | `notifications`, `notification_preferences`                                         |

---

## 1. Identity

### `member_metadata_cache`

> 系統不存 user，只快取外部 resolver 的回傳值。

```
id                  uuid PK
member_id           text UNIQUE   -- 外部系統的會員 ID
metadata            jsonb         -- name, email, primaryOrgUnitId, ...
fetched_at          timestamptz
expires_at          timestamptz
```

> 也可用 Redis 做（Postgres 表方便除錯，但效率不如 Redis）。MVP 先用 Postgres。

---

## 2. Organization

### `org_units`

```
id                  uuid PK
parent_id           uuid FK → org_units.id (nullable)
code                text UNIQUE      -- 業務代碼，如 FIN-TW-01
name                text
type                text             -- company / division / department / team
path                ltree            -- materialized path (PG ltree extension)
metadata            jsonb            -- cost_center, location, ...
deleted_at          timestamptz      -- soft delete
created_at          timestamptz
updated_at          timestamptz

INDEX (parent_id)
INDEX path GIST
INDEX (deleted_at) WHERE deleted_at IS NULL
```

### `positions`

```
id                  uuid PK
code                text UNIQUE
name                text
level               int             -- 職等
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

INDEX (member_id)
INDEX (org_unit_id)
UNIQUE (member_id, org_unit_id, position_id, effective_from)
```

### `manager_resolutions`

> 「簽核主管」獨立於組織樹的 parent。

```
id                  uuid PK
scope_type          text             -- 'MEMBER' | 'ORG_UNIT' | 'POSITION'
scope_id            text             -- member_id / org_unit_id / position_id
manager_member_id   text
priority            int              -- 多筆規則時的優先序
effective_from      date
effective_to        date (nullable)
created_at          timestamptz

INDEX (scope_type, scope_id)
```

---

## 3. Delegation

### `delegation_rules`

```
id                       uuid PK
principal_member_id      text                 -- 被代理者
agent_member_id          text                 -- 代理人
scope_type               text                 -- 'ALL' | 'TEMPLATE_LIST' | 'CONDITION_BASED'
scope_template_ids       uuid[]               -- scope_type = TEMPLATE_LIST 時
scope_condition_cel      text                 -- scope_type = CONDITION_BASED 時
start_at                 timestamptz
end_at                   timestamptz
requires_confirmation    boolean DEFAULT false
status                   text                 -- 'ACTIVE' | 'REVOKED' | 'EXPIRED'
created_at               timestamptz
created_by_member_id     text

INDEX (principal_member_id, status)
INDEX (start_at, end_at)
```

---

## 4. Form

### `form_definitions`

```
id                          uuid PK
name                        text
description                 text
current_version_id          uuid FK → form_definition_versions.id (nullable)
deleted_at                  timestamptz
created_at                  timestamptz
created_by_member_id        text
```

### `form_definition_versions`

```
id                          uuid PK
form_definition_id          uuid FK → form_definitions.id
version                     int
status                      text                  -- 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
schema                      jsonb                 -- 欄位定義
ui_schema                   jsonb                 -- 排版/顯示
published_at                timestamptz
published_by_member_id      text
archived_at                 timestamptz
created_at                  timestamptz

UNIQUE (form_definition_id, version)
INDEX (form_definition_id, status)
```

---

## 5. Template

### `approval_templates`

```
id                          uuid PK
name                        text
description                 text
category                    text
current_version_id          uuid FK → approval_template_versions.id (nullable)
deleted_at                  timestamptz
created_at                  timestamptz
created_by_member_id        text
```

### `approval_template_versions`

```
id                              uuid PK
template_id                     uuid FK → approval_templates.id
version                         int
status                          text                 -- 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
workflow_definition             jsonb                -- React Flow nodes + edges
form_definition_version_id      uuid FK → form_definition_versions.id
initiator_policy_cel            text                 -- 發起權限 CEL
notification_config             jsonb
sla_defaults                    jsonb
published_at                    timestamptz
published_by_member_id          text
archived_at                     timestamptz
created_at                      timestamptz

UNIQUE (template_id, version)
INDEX (template_id, status)
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
workflow_snapshot                   jsonb        -- 流程定義快照
form_definition_snapshot            jsonb        -- 表單定義快照
form_data                           jsonb        -- 使用者填寫
state                               text         -- DRAFT/RUNNING/APPROVED/REJECTED/CANCELLED/RETURNED/EXPIRED
title                               text         -- 自動產生（從 form_data 取一個欄位 or 模板名）
started_at                          timestamptz
completed_at                        timestamptz (nullable)
created_at                          timestamptz

INDEX (initiator_member_id, state)
INDEX (template_id, state)
INDEX (state, started_at)
```

### `workflow_tokens`

> 每顆 token 是引擎執行的最小單位。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
current_node_id             text                  -- node id in workflow_snapshot
status                      text                  -- 'ACTIVE' | 'WAITING' | 'CONSUMED'
parent_token_id             uuid (nullable)       -- 從哪一顆分裂出來（AND Split）
created_at                  timestamptz
consumed_at                 timestamptz (nullable)

INDEX (instance_id, status)
```

### `tasks`

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
token_id                    uuid FK → workflow_tokens.id
node_id                     text                  -- 對應的 user task 節點 id
original_assignee_member_id text                  -- resolver 解出的原始 assignee
assignee_member_id          text                  -- 套用 delegation 後的實際 assignee
delegation_chain            jsonb                 -- 代理鏈紀錄 [{from, to, ruleId}]
status                      text                  -- 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'TRANSFERRED' | 'CANCELLED'
sla_due_at                  timestamptz (nullable)
created_at                  timestamptz
opened_at                   timestamptz (nullable)
completed_at                timestamptz (nullable)

INDEX (assignee_member_id, status)
INDEX (instance_id, node_id)
INDEX (sla_due_at) WHERE sla_due_at IS NOT NULL AND status IN ('PENDING','IN_PROGRESS')
```

### `task_decisions`

> Task 決策可能不只一次（被退回又重新派發），每次決策一筆紀錄。

```
id                          uuid PK
task_id                     uuid FK → tasks.id
decided_by_member_id        text
action                      text          -- 'APPROVED' | 'REJECTED' | 'RETURNED' | 'TRANSFERRED'
comment                     text
return_to_node_id           text (nullable) -- action = RETURNED 時
transfer_to_member_id       text (nullable) -- action = TRANSFERRED 時
signature_id                uuid FK → signatures.id (nullable)
decided_at                  timestamptz

INDEX (task_id)
INDEX (decided_by_member_id, decided_at)
```

---

## 7. Audit

### `activity_logs`

> Append-only。記錄所有重要事件（人為決策、系統事件如 token advance、SLA 升級）。

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
event_type                  text          -- INSTANCE_STARTED / TOKEN_ADVANCED / TASK_CREATED / TASK_DECIDED / SLA_TRIGGERED / ...
actor_member_id             text (nullable)  -- null = 系統事件
node_id                     text (nullable)
task_id                     uuid (nullable)
payload                     jsonb         -- 事件特定資料
created_at                  timestamptz

INDEX (instance_id, created_at)
INDEX (actor_member_id, created_at)
```

---

## 8. Attachment

### `attachments`

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

INDEX (instance_id)
INDEX (task_id)
```

---

## 9. Signature

### `signatures`

```
id                          uuid PK
instance_id                 uuid FK → approval_instances.id
task_id                     uuid FK → tasks.id (nullable)  -- 系統簽章可能無 task
signer_member_id            text
algorithm                   text                  -- 'HMAC-SHA256'
signed_payload              jsonb                 -- 被簽章的內容（instance_id + node_id + decision + form_data_hash + ...）
signed_payload_hash         text                  -- payload SHA256
signature                   text                  -- HMAC 結果（base64）
key_version                 int                   -- 平台金鑰版本（支援輪替）
previous_signature_hash     text (nullable)       -- 鏈式簽章
timestamp_token             bytea (nullable)      -- RFC 3161 TSA token
signed_at                   timestamptz

INDEX (instance_id)
INDEX (signer_member_id, signed_at)
```

---

## 10. Notification

### `notifications`

```
id                          uuid PK
recipient_member_id         text
channel                     text          -- 'IN_APP' | 'EMAIL' | 'WEBHOOK'
type                        text          -- 'TASK_ASSIGNED' | 'SLA_WARNING' | 'INSTANCE_COMPLETED' | ...
instance_id                 uuid (nullable)
task_id                     uuid (nullable)
payload                     jsonb         -- 渲染用資料
status                      text          -- 'PENDING' | 'SENT' | 'FAILED' | 'READ'
sent_at                     timestamptz (nullable)
read_at                     timestamptz (nullable)
attempt_count               int DEFAULT 0
last_attempt_at             timestamptz (nullable)
next_retry_at               timestamptz (nullable)
delivery_error              text (nullable)
delivered_at                timestamptz (nullable)
delivery_target             text (nullable)
created_at                  timestamptz

INDEX (recipient_member_id, status, created_at)
INDEX (status) WHERE status = 'PENDING'
INDEX (status, next_retry_at, created_at)
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

## 11. ER 關聯圖（簡化）

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

## 12. 重要索引與查詢

### 個人 Inbox 查詢

```sql
SELECT t.*, i.title FROM tasks t
JOIN approval_instances i ON i.id = t.instance_id
WHERE t.assignee_member_id = $1
  AND t.status IN ('PENDING', 'IN_PROGRESS')
ORDER BY t.sla_due_at NULLS LAST, t.created_at;
```

索引：`tasks (assignee_member_id, status)`

### SLA 掃描（cron 每分鐘）

```sql
SELECT id FROM tasks
WHERE status IN ('PENDING', 'IN_PROGRESS')
  AND sla_due_at < now()
LIMIT 100;
```

索引：`tasks (sla_due_at) WHERE status IN ('PENDING','IN_PROGRESS')`

### 主管展開查詢

查詢「我下面所有的 instance」用 `org_units.path` ltree 操作（`@>` 包含關係）。

---

## 13. Migration 順序（提示）

1. extensions: `uuid-ossp`, `ltree`
2. organization: `org_units`, `positions`, `memberships`, `manager_resolutions`
3. identity: `member_metadata_cache`
4. delegation: `delegation_rules`
5. form: `form_definitions`, `form_definition_versions`
6. template: `approval_templates`, `approval_template_versions`
7. workflow: `approval_instances`, `workflow_tokens`, `tasks`, `task_decisions`
8. signature: `signatures`
9. attachment: `attachments`
10. audit: `activity_logs`
11. notification: `notifications`, `notification_preferences`
