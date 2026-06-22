# 13 — Ad-hoc Directives（臨時指令）

> 盤點來源：對照 `libs/bpm-core`、`libs/bpm-core-client`、`libs/bpm-core-react`
> 之實作整理。本文件描述「在流程執行期間，由當前簽核人臨時加入」的四種
> 指令：臨時會簽、臨時加簽、階段通知、結案通知。

Ad-hoc 指令是**執行期（runtime）**能力，不在模板設計階段定義。它讓正在處理
任務的簽核人，在不修改模板的前提下，臨時把其他人拉進簽核、或設定通知，藉此
覆蓋模板未預期的真實情境（例如「這張單我想加會法務」「結案後通知申請人主管」）。

與模板層的固定流程相比，ad-hoc 指令具有以下特性：

- 由**當前任務的簽核人**發起，不是發起人、也不是管理員專屬。
- 綁定在某個**原始任務（origin task）**與其節點上，效果範圍受該任務生命週期約束。
- 兩種「簽核型」指令（會簽 / 加簽）受節點旗標 `allowAddSigner` 門控；兩種
  「通知型」指令（階段 / 結案）不受此門控，任何簽核人皆可設定。

---

## 1. 四種指令一覽

| 指令類型            | 中文        | 效果                                                  | 受 `allowAddSigner` 門控 | 可撤回 | Webhook 目標 |
| ------------------- | ----------- | ----------------------------------------------------- | ------------------------ | ------ | ------------ |
| `COUNTERSIGN`       | 臨時會簽    | 在**下一個**簽核關卡注入一個並行任務                  | 是                       | 是     | 否           |
| `PRE_APPROVAL`      | 臨時加簽    | 在**當前**關卡立即注入一個阻塞任務，先簽完才續行      | 是                       | 否     | 否           |
| `STAGE_NOTIFY`      | 階段通知    | 當前關卡結束（核准/拒絕/退回）時通知指定對象          | 否                       | 是     | 是           |
| `COMPLETION_NOTIFY` | 結案通知    | 案件進入終態（核准/拒絕/取消）時通知指定對象          | 否                       | 是     | 是           |

「簽核型」（COUNTERSIGN / PRE_APPROVAL）會**產生 task、影響流程路徑**；
「通知型」（STAGE_NOTIFY / COMPLETION_NOTIFY）**只發通知，不影響流程**。

> 名稱對照：程式碼 enum 為 `AdhocDirectiveTypeEnum`，定義於
> `libs/bpm-core/src/lib/workflow-engine/adhoc.enums.ts`。

---

## 2. 啟用前提與權限

所有 ad-hoc 指令進入引擎前都經過同一組前置驗證
（`WorkflowEngineService.loadAdhocOperationContext`）：

1. `taskId` 對應的 task 必須存在。
2. 對該案件取 `pg_advisory_xact_lock`，序列化同案件的並發操作。
3. Task 狀態必須為 `PENDING` 或 `IN_PROGRESS`。
4. **呼叫者必須是該 task 的 assignee，或其有效候選人（candidate group 成員）**。
5. 案件狀態必須為 `RUNNING`。
6. 節點型別必須為 `userTask`。
7. 僅「簽核型」指令額外要求 `node.data.allowAddSigner === true`，否則拋
   `ForbiddenException`（錯誤訊息含節點 label）。

```
                       發起 ad-hoc 指令
                              |
                              v
            +-----------------------------------+
            | loadAdhocOperationContext 前置驗證 |   <- 共用閘門
            +-----------------------------------+
              | task PENDING/IN_PROGRESS?
              | caller = assignee/candidate?
              | instance RUNNING? node = userTask?
              |
       +------+-------------------------+
       |                                |
       v (簽核型)                        v (通知型)
  allowAddSigner == true?          直接放行
  否 -> ForbiddenException
```

- `allowAddSigner` 是節點層級布林值，定義於 `UserTaskNodeData`
  （`libs/shared/src/lib/workflow.ts`），設計器預設 `false`。模板設計者需在
  簽核節點明確開啟「允許加簽 / 會簽」，該節點的簽核人才能使用兩種簽核型指令。
- 通知型指令不需 `allowAddSigner`，但仍需通過前 6 項前置驗證。
- 候選人發起時，其候選狀態須仍為 `PENDING` / `CLAIMED`；若該候選人已對任務做過決策，
  或呼叫者完全不符 assignee / 候選人，引擎擲 `ConflictException`（屬步驟 4 的隱含邊界）。

---

## 3. 指令狀態機

```
                +-----------+   觸發（注入 task / 發出通知）   +-----------+
  建立 ───────▶ |  PENDING  | ──────────────────────────────▶ | CONSUMED  |
  (COUNTERSIGN/ +-----------+                                  +-----------+
   STAGE_NOTIFY/      |
   COMPLETION_NOTIFY) | 撤回 / 流程 reject/return/cancel 清除
                      v
                +-----------+
                | CANCELLED |
                +-----------+

  PRE_APPROVAL：建立時即直接進入 CONSUMED（立刻產生 task），不經過 PENDING。
```

| 狀態        | 語意                                            | 可否撤回                  |
| ----------- | ----------------------------------------------- | ------------------------- |
| `PENDING`   | 已登記、等待觸發（會簽待下一關、通知待時機到）  | 可（限建立者本人）        |
| `CONSUMED`  | 效果已發生（task 已產生 / 通知已送出）          | 否                        |
| `CANCELLED` | 已撤回，或被流程的 reject / return / cancel 清除 | —                         |

> `PRE_APPROVAL` 因為建立即 `CONSUMED`，**無法經由 `cancelAdhocDirective` 撤回**。
> 它的「反悔」途徑是在加簽任務上做決策（見 §5.2）。

---

## 4. 簽核型指令詳細流程

### 4.1 COUNTERSIGN（臨時會簽）— 注入到「下一關」

情境：當前簽核人同意往下走，但希望在**下一個簽核關卡**多拉一個人一起並行簽核。

```
  當前任務 T0 (node A)            下一關卡 (node B)
       |                              |
   發起 COUNTERSIGN                   |
       |  directive = PENDING         |
       |  （此時不產生 task）          |
       v                              |
   T0 核准, token 推進 ──────────────▶ 建立 B 的正常 task
                                      + spawnCountersignTasksForNode：
                                        掃出 PENDING 的 COUNTERSIGN，
                                        為每個 directive 注入並行 task
                                        directive -> CONSUMED
                                      |
                                      v
                              B 正常 task 與會簽 task 並行
                              兩者皆完成後 token 才推進
```

- 建立時只寫入 directive（`PENDING`），**不立即產生任務**；記錄
  `ADHOC_DIRECTIVE_CREATED` activity log。
- token 推進到下一個 userTask 並建立正常 task 之後，引擎呼叫
  `spawnCountersignTasksForNode`，把所有 `PENDING` 的 COUNTERSIGN 注入為**並行
  task**，directive 轉為 `CONSUMED`。
- 會簽 task 的決策政策固定為 `SINGLE`。它與該節點原有任務並存，引擎以
  `hasOpenTasksForTokenNode` 判斷：**同一 token / 節點下只要還有未完成任務，
  token 維持 `WAITING`、不推進**，直到全部完成。
- 若會簽對象解析失敗（例如職位查無人），directive 轉 `CANCELLED` 並記錄
  `ADHOC_DIRECTIVE_CANCELLED`，**不阻塞主流程**。

### 4.2 PRE_APPROVAL（臨時加簽）— 阻塞「當前關」

情境：當前簽核人在簽核前，想先請某人預先審查；該人簽完前，自己這關不往下走。

```
  當前任務 T0 (node A) — 簽核人發起 PRE_APPROVAL
       |
       |  directive 立即 CONSUMED
       |  立即在 node A 建立阻塞 task T0' （指派給加簽對象）
       v
   node A 下 T0 與 T0' 並存 -> token WAITING（不推進）
       |
       +--- 加簽人在 T0' 上決策 ---+
       |                           |
   APPROVED                    REJECTED
       |                           |
   T0' 完成                    依 directive.onReject 分流：
   待 T0 也完成後                - REJECT_INSTANCE -> 整單駁回
   token 才推進                  - RETURN_TO_ORIGIN -> 退回原簽核人
```

- 建立時 directive 直接 `CONSUMED`，並立即在**當前節點**產生阻塞 task，回傳值
  是新產生的 `TaskEntity`（非 directive）。
- 阻塞語意同會簽：基於 `hasOpenTasksForTokenNode`，當前 token 在所有任務
  （含加簽 task）完成前不推進。
- **加簽人拒絕時**（`handleAdhocPreApprovalRejection`），依建立時指定的
  `onReject`：
  - `REJECT_INSTANCE`：走一般 `rejectInstance`，整張單駁回。
  - `RETURN_TO_ORIGIN`：退回原簽核人重新處理 —
    - 原始 task 仍開啟：通知原簽核人，記錄 `ADHOC_PRE_APPROVAL_RETURNED`，
      不重複開 task。
    - 原始 task 已完成但原 assignee 仍在：**重新建立一個指派給原簽核人的新
      task**，讓他重新決策。
    - 找不到有效原簽核人：退回機制無法套用，fall back 到一般拒絕路徑。

---

## 5. 通知型指令詳細流程

通知型指令只發通知、不產生 task、不影響流程路徑。建立後為 `PENDING`，等時機
到才 `CONSUMED`。

### 5.1 STAGE_NOTIFY（階段通知）

- 觸發時機：**該指令所綁定節點（`originNodeId`）結束時**。三種結束情境都會觸發：
  - 該關卡核准、token 推進前（outcome `APPROVED`）。
  - 案件在該關卡被拒絕（outcome `REJECTED`）。
  - 案件在該關卡被退回（outcome `RETURNED`）。
- 通知文案：`案件「{標題}」的階段「{節點名稱}」已{通過/拒絕/退回}。`（outcome label 為
  通過 / 拒絕 / 退回；核准情境的 label 是「通過」而非「核准」）
- 觸發後 directive 轉 `CONSUMED`。
- 範圍限定 `originNodeId` 相符的指令；其他節點設定的階段通知不受影響。

### 5.2 COMPLETION_NOTIFY（結案通知）

- 觸發時機：**案件進入終態**。三種終態（核准 / 拒絕 / 取消）皆觸發，對應引擎中數個派發點：
  - 自然核准完成（`completeInstanceIfNoOpenRuntimeState` 設定 `APPROVED`）。
  - End Event 收斂為終態（`APPROVED` 或 `REJECTED`）。
  - 案件被拒絕（`rejectInstance`）。
  - 案件被取消（cancel）。
- 通知文案：`案件「{標題}」已結案（{終態}）。`（終態 label 為 核准 / 拒絕 / 取消）
- 範圍為**整個案件**（不限 `originNodeId`）；觸發後 directive 轉 `CONSUMED`。

---

## 6. 撤回與自動清除

### 6.1 手動撤回 — `cancelAdhocDirective`

- 條件：`directive.status === 'PENDING'` 且 `directive.createdByMemberId ===
  呼叫者`。只有**建立者本人**能撤回自己登記、尚未生效的指令。
- 效果：`status -> CANCELLED`，記錄 `ADHOC_DIRECTIVE_CANCELLED` activity log。
- 因 `PRE_APPROVAL` 建立即 `CONSUMED`，**不適用**此撤回。

### 6.2 流程事件自動清除 — `cancelPendingAdhocDirectives`

當案件發生狀態轉移時，引擎自動把仍 `PENDING` 的指令清成 `CANCELLED`，避免殘留
指令在不合理的時點被觸發：

| 流程事件   | 清除範圍                                            |
| ---------- | --------------------------------------------------- |
| 案件取消   | 全部類型的 `PENDING` 指令                           |
| 案件拒絕   | 全部類型的 `PENDING` 指令                           |
| 案件退回   | 僅 `COUNTERSIGN` / `PRE_APPROVAL`（保留兩種通知型） |

> 退回時保留通知型指令，是因為退回後流程仍可能再次跑到原節點或最終結案，階段 /
> 結案通知仍有意義；但會簽 / 加簽綁定的關卡語意已被打斷，故一併清除。

---

## 7. 通知與 Webhook 投遞

- 通知型指令、以及簽核型指令產生 task 時的指派通知，都走既有
  NotificationModule（見 `docs/07`、`docs/10`）。
- 目標為**成員 / 職位 / 組織成員**時：先以 `resolveApproverResolver` 解析出
  收件成員，再建立 in-app（及依偏好的 email）通知。
- 目標為 **Webhook**（僅通知型可用）時：透過 ad-hoc webhook 投遞，成功 / 失敗
  各記錄 `SERVICE_TASK_EXECUTED` / `SERVICE_TASK_FAILED` activity log，payload
  含 `{ action: 'ADHOC_WEBHOOK', directiveId, ok, status, url }`（失敗時另帶 `error`）。
- 目標為**成員 / 職位 / 組織**時，若收件人解析失敗，亦記 `SERVICE_TASK_FAILED`，但
  payload `action` 為 `'ADHOC_NOTIFY'`（含 `directiveId`、`error`），與 webhook 路徑區分。
- **通知失敗不阻塞流程**：投遞錯誤僅記 `SERVICE_TASK_FAILED`，directive 與流程
  狀態不受影響。

---

## 8. 資料模型

### 8.1 `task_adhoc_directives`（`AdhocDirectiveEntity`）

由 migration `0000000017000-adhoc-directives` 建立。

| 欄位                   | 型別                              | Null | 說明                                            |
| ---------------------- | --------------------------------- | ---- | ----------------------------------------------- |
| `id`                   | `uuid` (PK, `gen_random_uuid()`)  | 否   | 主鍵                                            |
| `instance_id`          | `uuid`                            | 否   | 所屬案件                                        |
| `origin_task_id`       | `uuid`                            | 否   | 觸發此指令的原始 task                           |
| `origin_node_id`       | `text`                            | 否   | 觸發此指令的原始節點                            |
| `created_by_member_id` | `text`                            | 否   | 建立者（即發起的簽核人）                        |
| `type`                 | `text` (`AdhocDirectiveType`)     | 否   | 指令類型                                        |
| `target_kind`          | `text` (`AdhocTargetKind`)        | 否   | 目標種類                                        |
| `target_value`         | `jsonb`                           | 否   | 多型目標值（成員 / 職位 / 組織 / webhook）      |
| `on_reject`            | `text` (`AdhocPreApprovalReject…`)| 是   | 僅 `PRE_APPROVAL` 填入                          |
| `channels`             | `jsonb` (`NotificationChannel[]`) | 是   | 通知頻道，null 時視為 `IN_APP`                  |
| `comment`              | `text`                            | 是   | 備註說明                                        |
| `status`               | `text`，預設 `'PENDING'`          | 否   | 指令狀態                                        |
| `consumed_at`          | `timestamptz`                     | 是   | 生效時間戳                                      |
| `created_at`           | `timestamptz`，預設 `now()`       | 否   | 建立時間                                        |

- 索引：`IDX_adhoc_directives_pending` — partial index ON `(instance_id, type)`
  WHERE `status = 'PENDING'`，優化「撈待生效指令」查詢。
- 設計上**不設外鍵約束**，避免跨表 cascade 複雜度。
- `channels` 在 DB 層無預設值（純 nullable）；「null 視為 `IN_APP`」是應用層語意，非 DB default。
- entity 另以 computed GraphQL field `targetValueJson`（`String`）對外暴露 `target_value` 的
  JSON 字串形式，供 client 解析（見 §10）；它非資料庫欄位。

### 8.2 `tasks` 表的 ad-hoc 擴充欄位

| 欄位                    | 型別                          | Null | 說明                                   |
| ----------------------- | ----------------------------- | ---- | -------------------------------------- |
| `is_adhoc`              | `boolean`，預設 `false`       | 否   | 是否為 ad-hoc 產生的任務               |
| `adhoc_type`            | `text` (`AdhocDirectiveType`) | 是   | 僅 ad-hoc task：`COUNTERSIGN`/`PRE_APPROVAL` |
| `adhoc_origin_task_id`  | `uuid`                        | 是   | 觸發此 ad-hoc task 的原始 task         |
| `adhoc_directive_id`    | `uuid`                        | 是   | 對應的 directive id                    |

### 8.3 列舉型別（`adhoc.enums.ts`）

```
AdhocDirectiveType          = COUNTERSIGN | PRE_APPROVAL | STAGE_NOTIFY | COMPLETION_NOTIFY
AdhocDirectiveStatus        = PENDING | CONSUMED | CANCELLED
AdhocTargetKind             = MEMBER | ORG_UNIT_MEMBER | POSITION | WEBHOOK
AdhocPreApprovalRejectBehavior = REJECT_INSTANCE | RETURN_TO_ORIGIN
```

---

## 9. GraphQL API

Resolver（`workflow-engine.mutations.ts` / `.queries.ts`）整體套用
`@BPMAuthenticated()`；呼叫者身份由 `@BPMCurrentMemberId()` 自動注入，**無額外
AdminOnly guard** — 授權完全由 §2 的前置驗證（assignee/candidate + allowAddSigner）
把關。

### 9.1 Mutations

| Mutation                             | 主要參數                                                              | 回傳               |
| ------------------------------------ | -------------------------------------------------------------------- | ------------------ |
| `requestAdhocCountersign`            | `taskId: ID!`, `target: AdhocTargetInput!`, `comment: String`        | `AdhocDirective`   |
| `requestAdhocPreApproval`            | `taskId: ID!`, `target: AdhocTargetInput!`, `onReject: AdhocPreApprovalRejectBehavior!`, `comment: String` | `Task`（新任務）   |
| `configureAdhocStageNotification`    | `taskId: ID!`, `input: AdhocNotificationInput!`                      | `AdhocDirective`   |
| `configureAdhocCompletionNotification` | `taskId: ID!`, `input: AdhocNotificationInput!`                    | `AdhocDirective`   |
| `cancelAdhocDirective`               | `directiveId: ID!`                                                    | `AdhocDirective`   |

> `requestAdhocPreApproval` 回傳的是新產生的阻塞 **task**，不是 directive。

### 9.2 Query

| Query             | 參數                  | 回傳                | 備註                                      |
| ----------------- | --------------------- | ------------------- | ----------------------------------------- |
| `adhocDirectives` | `instanceId: String!` | `[AdhocDirective]`  | 依 `createdAt ASC`；需通過案件 read-scope |

### 9.3 Input 型別

`AdhocTargetInput`（`dto/adhoc-target.input.ts`）：

| 欄位                 | 型別        | 用於                                  |
| -------------------- | ----------- | ------------------------------------- |
| `kind`               | `AdhocTargetKind!` | 必填，決定其餘欄位                |
| `memberIds`          | `[String]`  | `kind = MEMBER`                       |
| `positionId`         | `String`    | `kind = POSITION`                     |
| `orgUnitId`          | `String`    | `kind = ORG_UNIT_MEMBER`              |
| `includeDescendants` | `Boolean`   | 搭配 `ORG_UNIT_MEMBER`                |
| `webhookUrl`         | `String`    | `kind = WEBHOOK`（通知型專用）        |
| `webhookHeadersJson` | `String`    | `kind = WEBHOOK` 的額外 header（JSON）|

`AdhocNotificationInput`（`dto/adhoc-notification.input.ts`）：`target:
AdhocTargetInput!` + `channels: [NotificationChannel]`（可選）。

---

## 10. Client SDK 介接

`@rytass/bpm-core-client`（subpath `/workflow`，`workflow-api.ts`）提供對應方法：

```ts
import {
  requestAdhocCountersign,
  requestAdhocPreApproval,
  configureAdhocStageNotification,
  configureAdhocCompletionNotification,
  cancelAdhocDirective,
  listAdhocDirectives,
} from '@rytass/bpm-core-client/workflow';

// 臨時會簽：在下一關加入 member-007 並行簽核
await requestAdhocCountersign({
  taskId,
  target: { kind: 'MEMBER', memberIds: ['member-007'] },
  comment: '加會法務',
});

// 臨時加簽：當前關卡先請主管預審，拒簽則退回給我
const blockingTask = await requestAdhocPreApproval({
  taskId,
  target: { kind: 'POSITION', positionId: 'position-legal-lead' },
  onReject: 'RETURN_TO_ORIGIN',
});

// 結案通知：案件結案後打 webhook 給外部系統
await configureAdhocCompletionNotification({
  taskId,
  target: {
    kind: 'WEBHOOK',
    webhookUrl: 'https://erp.example.com/hooks/bpm',
    webhookHeaders: { 'X-Token': 'secret' },
  },
});

// 列出某案件全部臨時指令（含已生效 / 已撤回）
const directives = await listAdhocDirectives(instanceId);

// 撤回尚未生效（PENDING）的指令
await cancelAdhocDirective(directiveId);
```

SDK 型別重點：

- `AdhocTargetOptions` 的 `webhookHeaders` 接受 `Record<string, string>` 物件，
  內部會序列化為 GraphQL 的 `webhookHeadersJson`。
- `AdhocDirectiveRecord.targetValueJson` 為 JSON 字串，消費端自行 parse。
- `requestAdhocPreApproval` 回傳 `TaskRecord`，其餘 mutation 回傳
  `AdhocDirectiveRecord`。
- `requestAdhocPreApproval` 的 `onReject`（`AdhocPreApprovalRejectBehavior`）為**必填**；
  `requestAdhocCountersign` / `requestAdhocPreApproval` 皆可帶可選 `comment`。
- 兩個通知方法（`configureAdhocStageNotification` /
  `configureAdhocCompletionNotification`）接受可選 `channels`（`NotificationChannel[]`）；
  省略時由後端套用預設 `IN_APP`。

---

## 11. 前端 UI 操作流程

主要實作於 `libs/bpm-core-react` 的案件詳情頁：

- `views/instances/detail/InstanceDetailView.tsx` — PageHeader 動作按鈕。
- `views/instances/detail/sections/InstanceTasksSection.tsx` — ad-hoc modal 與
  「待生效的臨時設定」表格。

操作路徑：

1. 進入有「當前任務（指派給我）」的案件詳情頁。
2. PageHeader 依門控顯示按鈕（三個按鈕的共同前提是**存在指派給我的當前任務**，
   無 currentTask 時皆不顯示）：
   - 節點 `allowAddSigner = true`：顯示「會簽」「加簽」「通知設定」。
   - 節點 `allowAddSigner = false`：只顯示「通知設定」。
3. 點按鈕開啟單一 ad-hoc modal（依模式切換欄位）：
   - 會簽 / 加簽：成員 AutoComplete + 說明；加簽額外有「拒簽處理方式」
     （`REJECT_INSTANCE` / `RETURN_TO_ORIGIN`）。
   - 通知設定：是兩種通知型共用的單一入口，於 modal 內的「通知時機」Select 切換
     （「階段完成通知」/「結案通知」）；另有「通知對象類型」（「指定成員」/「Webhook」）。
     通知型 modal 無「說明」欄位。
4. 已登記、尚未生效的指令列在任務表下方的「**待生效的臨時設定**」子表格，欄位
   為類型 / 對象 / 設定者 / 建立時間 / 操作；建立者本人可在此按「撤回」。
5. 會簽 / 加簽產生的 task 會顯示在任務表中，節點名稱後標注「（臨時會簽）」或
   「（臨時加簽）」。

---

## 12. 與其他機制的互動

- **決策政策**：會簽 / 加簽 task 的 `decisionPolicySnapshot` 固定為 `SINGLE`，
  與原節點的決策政策獨立計算；但是否推進取決於「同 token/節點下所有任務皆完成」。
- **委派代理（Delegation）**：ad-hoc task 建立時同樣套用 delegation 解析鏈，
  指派目標可能被代理規則改派（見 `docs/07`）。
- **數位簽章**：ad-hoc task 上的決策與一般決策一致，納入簽章鏈。
- **Activity Log**：完整記錄 `ADHOC_DIRECTIVE_CREATED`、`ADHOC_DIRECTIVE_CANCELLED`、
  `ADHOC_PRE_APPROVAL_RETURNED`；ad-hoc task 產生時（會簽 / 加簽注入、退回重開）另寫
  `TASK_CREATED`；通知投遞依目標記 `SERVICE_TASK_EXECUTED` / `SERVICE_TASK_FAILED`
  （webhook `action: 'ADHOC_WEBHOOK'`、成員 / 職位 / 組織 `action: 'ADHOC_NOTIFY'`）。

---

## 13. 設計限制與注意事項

- 會簽 / 加簽僅能用於 `userTask` 且節點 `allowAddSigner = true`；模板設計者未開
  該旗標時，簽核人無法臨時加人。
- Webhook 目標**只能用於通知型**指令；會簽 / 加簽指定 Webhook 會被拒絕（沒有
  「webhook 簽核」的概念）。
- `PRE_APPROVAL` 一旦建立即生效、不可撤回；要反悔只能在加簽任務上決策。
- 自動清除規則使退回（return）保留通知型、清除簽核型指令，設計上是刻意取捨，
  介接方若依賴退回後仍保留會簽，需注意此行為。
- 通知投遞為 best-effort，失敗不影響流程；需要可靠投遞的整合應改用 Service Task
  WEBHOOK + 既有通知投遞排程的 retry 機制。
