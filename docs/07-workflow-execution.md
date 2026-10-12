# 07 — 流程執行細節

本文件描述引擎 runtime 如何處理 instance、token、task、resolver、delegation、SLA。

---

## 1. 狀態機

### 1.1 Instance 狀態

```
                        ┌────────┐
                        │ DRAFT  │  發起人尚未提交
                        └────┬───┘
                             │ submit()
                             ▼
                       ┌──────────┐
              ┌────────│ RUNNING  │────────┐
              │        └─────┬────┘        │
              │              │             │
              │              │             │
       cancel│         all tokens     SLA 終止策略
              │         consumed via       │
              │              │             │
              ▼              ▼             ▼
      ┌────────────┐  ┌────────────┐ ┌────────────┐
      │ CANCELLED  │  │  APPROVED  │ │  EXPIRED   │
      └────────────┘  └────────────┘ └────────────┘

         RUNNING ─── 任一 task 拒絕 ───▶ REJECTED
         RUNNING ─── 退回到發起人 ───▶ RETURNED ─── resubmit ───▶ RUNNING
```

| 狀態          | 描述                           | 終態 |
| ------------- | ------------------------------ | ---- |
| **DRAFT**     | 暫存（可選功能）               | ❌   |
| **RUNNING**   | 流程進行中                     | ❌   |
| **APPROVED**  | 所有 token 走到 End            | ✅   |
| **REJECTED**  | 任一 task 拒絕（不可恢復）     | ✅   |
| **RETURNED**  | 退回到發起人（可重編輯後再送） | ❌   |
| **CANCELLED** | 發起人主動撤銷                 | ✅   |
| **EXPIRED**   | SLA 終止策略觸發               | ✅   |

### 1.2 Token 狀態

```
        created
           │
           ▼
      ┌─────────┐
      │ ACTIVE  │  ← 待引擎處理（剛抵達某節點）
      └────┬────┘
           │ 進入 user task
           ▼
      ┌─────────┐
      │ WAITING │  ← 等待 task 完成
      └────┬────┘
           │ task 完成 → engine 重新接管
           ▼
      ┌─────────┐
      │ ACTIVE  │  ← 繼續往下移動
      └────┬────┘
           │ 抵達 End 或被 AND Join 合併
           ▼
      ┌─────────┐
      │CONSUMED │  終態
      └─────────┘
```

### 1.3 Task 狀態

```
       ┌──────────┐
       │ PENDING  │  剛建立，未被開啟
       └────┬─────┘
            │ assignee opens it
            ▼
       ┌──────────────┐
       │ IN_PROGRESS  │
       └──────┬───────┘
              │
   ┌──────────┼─────────────────────┬──────────────────┐
   │          │                     │                  │
   ▼          ▼                     ▼                  ▼
COMPLETED  TRANSFERRED         CANCELLED         (timeout 處理)
(decided)  (轉派他人，本 task    (instance              ↓
            結束、新建一筆)      cancelled)         依模板策略
```

---

## 2. Token 引擎主迴圈

引擎以 **事件驅動** 方式運作：

| 觸發                         | 動作                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `submitInstance()`           | 在 Start Event 建立 token，加入 advance queue           |
| `decideTask(taskId, action)` | task 完成 → 對應 token 從 WAITING → ACTIVE → 加入 queue |
| Cron (每分鐘)                | 檢查 SLA 到期 task → 觸發 boundary timer event          |
| `cancelInstance()`           | 終止所有 active/waiting token，instance → CANCELLED     |

主迴圈虛擬碼：

```typescript
async function processInstance(instanceId: string): Promise<void> {
  await transaction(async () => {
    while (true) {
      const token = await fetchOneActiveToken(instanceId);
      if (!token) break;

      const node = workflow.findNode(token.currentNodeId);

      switch (node.type) {
        case 'startEvent':
          advanceTokenToNext(token);
          break;

        case 'endEvent':
          consumeToken(token);
          break;

        case 'userTask':
          await createTasksForNode(node, token); // 解析 approver + delegation
          markTokenWaiting(token);
          break;

        case 'serviceTask':
          await executeServiceAction(node, token);
          if (node.data.action.type === 'NOTIFY') {
            // 站內／email 通知 + 在同一交易寫入 webhook outbox，commit 後才投遞；
            // 知會節點是非同步分支，consume token 不往下走。
            consumeToken(token);
          } else {
            // 系統節點的 WEBHOOK／SET_FORM_FIELD 動作執行完照常前進。
            advanceTokenToNext(token);
          }
          break;

        case 'exclusiveGateway':
          handleExclusiveGateway(node, token); // 走第一條 true 的邊
          break;

        case 'parallelGateway':
          if (node.gatewayDirection === 'split') {
            handleParallelSplit(node, token); // 一顆變多顆
          } else {
            handleParallelJoin(node, token); // 等所有入邊到齊
          }
          break;
      }
    }

    // 流程完成判定
    await checkInstanceCompletion(instanceId);
  });
}
```

---

## 3. Gateway 處理細節

### 3.1 Exclusive Gateway (XOR) Split

W6 runtime 會優先執行 `edge.data.condition` 的 CEL expression，並保留設計器產出的結構化條件欄位作為相容 fallback：

- `edge.data.condition`
- `edge.data.conditionFieldKey`
- `edge.data.conditionOperator`
- `edge.data.conditionValue`
- `edge.data.isDefault`

引擎會用 instance 的 `formData`、initiator snapshot、instance metadata 與上一個節點的 latest decision 組成 CEL context，判斷第一條符合條件的 outgoing edge；若都不符合，會走 `isDefault`。

```typescript
function handleExclusiveGateway(node, token) {
  const outgoing = workflow.outgoingEdges(node.id);
  const conditional = outgoing.filter((e) => e.data.condition);
  const defaultEdge = outgoing.find((e) => e.data.isDefault);

  for (const edge of conditional) {
    if (cel.evaluate(edge.data.condition, buildFlowContext(token))) {
      moveTokenToNode(token, edge.target);
      return;
    }
  }
  if (defaultEdge) {
    moveTokenToNode(token, defaultEdge.target);
    return;
  }
  throw new EngineError('XOR has no matching edge and no default flow');
}
```

### 3.2 Parallel Gateway (AND) Split

W6 MVP 不要求設計器使用 Parallel Gateway 節點。任何可輸出的節點只要有多條 outgoing edge，runtime 就會把目前 token consume，並為每條 outgoing edge 建立一個 child `ACTIVE` token。這讓「一個簽核節點往後拉兩條線」可直接表達平行分支。

```typescript
function handleParallelSplit(node, token) {
  const outgoing = workflow.outgoingEdges(node.id);

  consumeToken(token); // 原 token 消滅
  for (const edge of outgoing) {
    createToken({
      instanceId: token.instanceId,
      currentNodeId: edge.target,
      parentTokenId: token.id,
      status: 'ACTIVE',
    });
  }
}
```

### 3.3 Parallel Gateway (AND) Join

W6 runtime 將 join 語意放在目標節點的 `data.triggerMode`，而不是要求額外的 join gateway：

- `AND`：多條 incoming edge 都抵達後才觸發該節點；先抵達的 token 會暫時轉為 `WAITING`。
- `OR`：任一 incoming edge 抵達就觸發該節點；其他仍可能抵達同一節點的 sibling branch 會被 consume，相關 pending task 會被標記為 `CANCELLED`。

```typescript
function handleParallelJoin(node, token) {
  const incoming = workflow.incomingEdges(node.id);
  const arrivedTokens = await fetchTokensAtNode(node.id, instanceId);

  if (arrivedTokens.length < incoming.length) {
    // 還沒到齊，把這顆 token 「掛」在這個節點等
    setTokenStatus(token, 'WAITING_AT_JOIN');
    return;
  }

  // 全部到齊：合併成一顆
  for (const t of arrivedTokens) consumeToken(t);
  const outgoing = workflow.outgoingEdges(node.id);
  for (const edge of outgoing) {
    createToken({
      instanceId,
      currentNodeId: edge.target,
      status: 'ACTIVE',
    });
  }
}
```

> AND Join 須避免 race condition：用 row lock + serializable transaction。

---

## 4. Approver Resolver

User Task 抵達時要決定「派給誰」。流程如下：

```
node.approverResolver
        │
        ▼
┌───────────────────────────┐
│ 解析候選 member_ids        │
│ (DIRECT/POSITION/         │
│  ORG_MANAGER/             │
│  DYNAMIC_FORM/EXPRESSION) │
└──────────┬────────────────┘
           │
           ▼
┌───────────────────────────┐
│ 套用 Delegation 規則       │
│ → 替換為 agent             │
│ → 紀錄 delegation_chain    │
└──────────┬────────────────┘
           │
           ▼
┌───────────────────────────┐
│ 建立單一簽核 task          │
│ → 一個 User Task 一位責任人 │
└──────────┬────────────────┘
           │
           ▼
      建立 task
       發通知
```

### 4.1 候選人解析

```typescript
async function resolveApprovers(
  resolver: ApproverResolver,
  context: ResolverContext, // form, initiator, instance
): Promise<string[]> {
  switch (resolver.type) {
    case 'DIRECT':
      return resolver.memberIds;

    case 'POSITION':
      // 該職位當前的所有持有者
      return await memberships.findByPosition(resolver.positionId);

    case 'ORG_MANAGER':
      // 從 initiator 的 org_unit 向上走 N 層後的 manager
      return [await managerResolution.findManager(context.initiator.org.id, resolver.levelsUp)];

    case 'ORG_MANAGER_CHAIN':
      // 沿主管鏈往上，直到某位主管的職等達 minPositionLevel（規則見 §4.1.1）
      return await walkManagerChain(context.initiator, resolver.minPositionLevel);

    case 'DYNAMIC_FORM':
      // 從表單欄位（user_picker / org_picker）取
      return extractFromFormPath(context.form, resolver.formPath);

    case 'EXPRESSION':
      // CEL 評估，回傳 member_id 或 member_id[]
      const result = await cel.evaluate(resolver.expression, context);
      return Array.isArray(result) ? result : [result];
  }
}
```

#### 4.1.1 `ORG_MANAGER_CHAIN`：沿主管鏈簽到職等門檻

`ORG_MANAGER` 的 `levelsUp` 是固定層數；`ORG_MANAGER_CHAIN` 則是從申請人開始一層一層往上找
主管，讓每一位主管都要簽，直到某位主管的**職等**達到 `minPositionLevel` 為止，所以簽幾關取決於
組織圖，不是模板寫死。resolver 回傳的是**有順序**的 member id 清單（最近的主管在最前面）。
搭配 `SEQUENTIAL`（建議）時，主管鏈**由近到遠依序簽**：先只開給最近的主管，他核准後才輪到
下一位（規則見 §4.3 的〈`SEQUENTIAL`：依序簽核〉）；搭配 `PARALLEL_ALL` 則所有主管同時收到待辦、全部同意才通過。
設計器把節點改成主管鏈時，若原本的決策方式會讓一位主管簽完就結案，會自動改成 `SEQUENTIAL`。

- **職等來源**：`PositionEntity.level`（數字越大越高階）。一位主管的職等 = 他**目前有效**
  （`effective_from`／`effective_to` 涵蓋今天）且有 `positionId` 的所有 membership 中最大的
  `level`；沒有這種 membership 就是「沒有職等」。
- **每一層怎麼走**：用跟 `ORG_MANAGER` 同一套主管規則（`resolveDirectManagerMemberIds`）找目前這個人的
  直屬主管，但有兩點不同：一律採「只取最近一層」語意（主鏈只有一條路徑，合併上層單位的規則只會
  造成平手，所以沒有 `preferClosestOrgUnit` 設定）；以及解析時**先排除這個人自己**再選最高優先順序，
  因為單位主管本身也屬於他所管的單位，不排除的話他的單位規則會指回他自己，鏈就爬不上去
  （發起人本身是單位主管時，第一層也會直接取上層單位的主管）。
  1. 找不到主管 → 鏈走完了，仍未達門檻（見下方「未達門檻」）。
  2. 同一層有多位主管（主管規則在最高優先順序平手）→ **丟 `ConflictException`**，不會默默挑一位；
     要由流程管理員調整主管規則。
  3. 這位主管已經走過（含申請人本人，也就是主管規則繞成圈）→ 視為鏈走完。
  4. 最多走 20 層（`ORG_MANAGER_CHAIN_MAX_HOPS`），超過視為鏈走完，防止設定錯誤的資料無限往上走。
  5. **略過（不加入清單、繼續往上走）**：這位主管沒有職等，或職等 **不高於** 清單中最後一位
     已加入的主管。申請人本人永遠不會被加入。
  6. 否則加入清單；若職等 `>= minPositionLevel` 就停止，這位主管是最後一關。
- **未達門檻**：鏈在出現達標主管之前就結束時，走 `fallback`，規則與 `ORG_MANAGER` 完全相同
  （`NONE`／未設定 → 丟 `ConflictException`；改派固定人未填 → 丟錯；固定人是申請人本人且未開
  `allowInitiatorSelfApproval` → 丟錯）。fallback 成功時把改派固定人放在清單**最後**一關；
  若他已在清單裡就不重複加入。
- **Publish 檢查**：`minPositionLevel` 必須是整數；`userTask` 的 `decisionPolicy` 必須是
  `SEQUENTIAL` 或 `PARALLEL_ALL`，否則第一位主管簽完就會讓節點結案。

### 4.2 Delegation 解析順序（**重要**）

```typescript
async function applyDelegation(
  originalAssigneeId: string,
  context: DelegationContext, // task + instance + template + env
): Promise<{ finalAssignee: string; chain: DelegationStep[] }> {
  const visited = new Set<string>();
  const chain: DelegationStep[] = [];
  let current = originalAssigneeId;

  while (true) {
    if (visited.has(current)) {
      // 防循環代理 (A 代給 B、B 代給 A)
      throw new EngineError('Delegation cycle detected');
    }
    visited.add(current);

    // 1. 找此 principal 當下所有 ACTIVE 的代理規則
    const rules = await delegationRules.findActive(current, env.now);

    // 2. 過濾符合 scope 的規則（依 priority 排序）
    const applicable = rules.filter((r) => matchesScope(r, context)).sort((a, b) => a.priority - b.priority);

    if (applicable.length === 0) break;

    // 3. 取最高優先序（多筆規則時取一）
    const rule = applicable[0];

    chain.push({
      from: current,
      to: rule.agent_member_id,
      ruleId: rule.id,
      reason: rule.scope_type,
    });

    current = rule.agent_member_id;
    // 繼續迴圈：代理人本人也可能有代理規則（例：B 又休假代給 C）
  }

  return { finalAssignee: current, chain };
}
```

| Scope 類型        | matchesScope() 邏輯                                        |
| ----------------- | ---------------------------------------------------------- |
| `ALL`             | 永遠 true                                                  |
| `TEMPLATE_LIST`   | `template_id in rule.scope_template_ids`                   |
| `CONDITION_BASED` | `cel.evaluate(rule.scope_condition_cel, context) === true` |

### 4.3 User Task 派工

```typescript
async function createTasksForNode(node, token) {
  const candidates = await resolveApprovers(node.approverResolver, ctx);
  assert(candidates.length > 0, 'User Task must resolve one approver');

  await createTask({
    candidates,
    decisionPolicy: node.decisionPolicy,
    token,
  });
}
```

一個 User Task 可以由 direct resolver 指定多位候選簽核者；runtime 會將候選者與
`decisionPolicy` 一起寫入 task snapshot。`SINGLE`／`PARALLEL_ANY` 任一人同意
即可完成，`PARALLEL_ALL`／`SEQUENTIAL` 需全部同意，`QUORUM` 則依門檻完成。

#### `SEQUENTIAL`：依序簽核

> **行為變更**：在此之前 `SEQUENTIAL` 與 `PARALLEL_ALL` 完全相同（所有候選人同時收到待辦、
> 全部同意才完成）。現在 `SEQUENTIAL` 才真正代表「一位簽完、下一位才輪到」。

- **順序**：候選人的順序就是 approver resolver 回傳的順序（套用代理、去重之後），
  寫入 `task_candidates.sequence`（0 起算）。`DIRECT`／`DYNAMIC_FORM`／`EXPRESSION` 的順序由
  流程作者控制（`memberIds` 陣列、表單欄位值、運算式結果的順序）。由組織資料解析的 resolver
  （`POSITION`、`ORG_UNIT_*`、`ORG_MANAGER`）回傳的成員順序不是為簽核順序設計的，不要依賴它。
- **建立 task**：只有 `sequence = 0` 的候選人是 `PENDING`，其餘為 `WAITING`（還沒輪到）。
  task 的 `assignee_member_id`／`original_assignee_member_id`／`delegation_chain` 一律是目前輪到的那位，
  `assignment_type` 仍是 `CANDIDATE_GROUP`。`WAITING` 的人不會有待辦、也收不到通知；
  他們若在輪到前嘗試決策，會得到 `ConflictException`（`not this member's turn yet`）。
- **同意**：該位候選人 → `COMPLETED`，`sequence` 最小的 `WAITING` 候選人 → `PENDING`，
  task 回到 `PENDING`（`opened_at` 清空）、assignee 換成新的一位，`sla_due_at` 依節點 SLA 重新計算
  （新的一位拿到完整的 SLA 時間），並把這個時間點記在 `tasks.sla_started_at`：SLA 預警
  （`warningAt`）從 `sla_started_at` 起算，沒有這個值（一般 task、舊資料）才從 `created_at` 起算。
  同時寫入 `TASK_CANDIDATE_ACTIVATED` activity log 並通知新的一位。token 仍停在該節點等待。
- **代理**：代理關係在建立 task 時只解析了第一位；輪到某位候選人時，會用他的 `original_member_id`
  重新解析一次代理，結果寫回該候選人（`member_id`、`delegation_chain`）與 task 的 assignee。
  若重新解析出的代理人在這個 task 上已經有另一列候選人（`(task_id, member_id)` 唯一），
  就保留原本記下的值，不再代理。
- **完成**：所有候選人（含 `WAITING`）都 `COMPLETED` 才完成 task，token 才往下走。
- **拒絕／退回**：與以往一樣，任何一位拒絕或退回即處理整個 instance；尚在 `WAITING` 的候選人與
  其他未決候選人一併關閉（`CANCELLED`；instance 被取消時同樣處理）。
- **轉簽**：目前輪到的人轉簽給 X 時，只要後面還有 `WAITING` 的候選人，替換 task 就沿用 `SEQUENTIAL` 與 `CANDIDATE_GROUP`；
  若轉簽者是最後一位（後面已經沒有 `WAITING`），替換 task 是 `SINGLE`／`DIRECT_MEMBER`、`sequence` 為 `NULL`
  （與舊資料的 `SEQUENTIAL` task 轉簽相同）。沿用時，
  X 取代轉簽者的位置（`PENDING`、同一個 `sequence`），其餘 `WAITING` 候選人原樣複製到新 task，
  舊 task 的 `WAITING` 候選人標為 `SUPERSEDED`。若 X 本來就排在後面，X 只簽一次（取代目前這一位，
  後面那個位置不再重複詢問）。SLA 升級逾時使用同一條轉簽路徑，行為相同。
- **`TASK_CREATED` payload**：`assigneeMemberId` 與 `candidateMemberIds` 只有目前輪到的那位
  （讓「通知這個 task 所有人」的消費端不會提前通知還沒輪到的人）；完整順序放在新增的
  `sequentialCandidateMemberIds`。
- **`TASK_CANDIDATE_ACTIVATED` payload**（`actorMemberId` 為 `null`）：
  `{ assigneeMemberId, candidateMemberIds: [同一位], originalAssigneeMemberId, assignmentType, candidateMemberId, originalMemberId, sequence, previousMemberId, tokenId }`。
  前四個欄位與 `TASK_CREATED` 的收件人欄位同名同義，其餘是這個事件專屬。
- **給事件消費端（BREAKING）**：SEQUENTIAL task 的 `TASK_CREATED` 只點名第一位簽核人；
  **`TASK_CANDIDATE_ACTIVATED` 才是「現在輪到這位」的訊號**，必須和 `TASK_CREATED` 用同一套
  收件人邏輯（待辦、通知、webhook、外部系統）處理。只訂閱 `TASK_CREATED` 的消費端，
  第二位之後的簽核人永遠不會被通知。
- **回滾**：`down()` 會先把 `WAITING` 候選人改回 `PENDING`（退回「全部同時簽」），再移除
  `sequence` 與 `sla_started_at`；沒有 `sequence`，`WAITING` 的人永遠不會被啟動，task 會卡死。
  **只回滾程式、不跑 migration `down()` 時，必須自己執行同一句**：
  `UPDATE task_candidates SET status = 'PENDING' WHERE status = 'WAITING';`
  這些候選人當初並沒有收到通知，UPDATE 之後他們只會在自己的待辦清單看到這個 task。
- **舊資料**：此變更前建立的 `SEQUENTIAL` task，候選人全是 `PENDING`、`sequence` 為 `NULL`，
  **沒有 backfill**，繼續照舊行為（不分先後、全部同意才完成）。只有 `decisionPolicy.type = 'SEQUENTIAL'`
  且候選人有 `sequence` 的 task 才走依序流程；只有一位候選人時沒有差別。
- **不在範圍**：ad-hoc task 永遠不是 sequential；dry run 不變；`PARALLEL_*`／`QUORUM` 不變。

例如：

```text
A -> B -> D
A -> C -> D
```

- D 設定 `triggerMode: 'AND'`：B 與 C 都完成後才進入 D。
- D 設定 `triggerMode: 'OR'`：B 或 C 任一完成即可進入 D。

每個建立 task 前都要呼叫 `applyDelegation` 替換 assignee。`decisionPolicy` 保留為相容欄位，設計器固定寫入 `{ type: 'SINGLE' }`。

### 4.4 排除申請人（`excludeInitiator`）

User Task 節點設定 `excludeInitiator: { whenEmpty }` 後，送出單據的人
（`instance.initiatorMemberId`）不能是該節點的簽核人。沒有設定時完全沿用 4.3 的行為；
runtime 讀的是 `instance.workflowSnapshot`，所以模板之後才開啟此設定時，已經在跑的
instance 不受影響。

- **建立待簽任務**：先解析、再套用 delegation，然後移除申請人出現在其代理路徑上的候選人
  （代理前的 `originalMemberId`、`delegationChain` 中任何一步的 `from`／`to`，或代理後的
  `memberId`）——代理人替申請人簽，等於申請人自己簽。這一步在「沒有任何候選人」的檢查之前，
  而且在同一個 `memberId` 的去重之前：申請人把席位代理給名單中另一位簽核人時，
  那位簽核人自己的那一筆不會被申請人的那一筆蓋掉。
- **COUNT 門檻**：排除申請人後剩下的人數低於 `QUORUM` 的 COUNT 門檻時，該 task 的
  `decisionPolicySnapshot` 會把門檻降到剩下的人數（「兩人要同意」變成「其餘的人都要同意」），
  否則任務永遠無法完成。PERCENTAGE 由實際候選人數計算，不需處理。`INITIATOR_MANAGER` 改派的名單同樣適用。
- **移除後沒有人時**依 `whenEmpty`：
  - `FAIL`：丟出 `ConflictException`，不建立任務。
  - `INITIATOR_MANAGER`：改派申請人的直屬主管（同樣套 delegation、同樣排除申請人），
    候選人的 `sourceType` 為 `EXCLUDE_INITIATOR_MANAGER`；找不到主管同樣丟 `ConflictException`。
    查主管時只取申請人最近的組織單位，並先排除申請人本人的主管規則再選最高優先序——
    申請人本人就是單位主管時，會落到上一層的主管，而不是又選回自己。
  - `SKIP_NODE`：不建立任務，寫一筆 `TOKEN_ADVANCED` activity log
    （`payload: { skippedByInitiatorExclusion: true, tokenId }`），token 直接往下走。
    待處理的會簽 directive 留給下一個真正建立的 user task。
  - 一開始就解析不出任何人（與申請人無關）仍是原本的錯誤，不套用 `whenEmpty`。
- **轉交**：簽核人手動轉交（`decideTask` 的 `TRANSFERRED`）時，若目標是申請人本人，
  回 `ConflictException`。
- **臨時加簽／會簽**：建立任務時套用同一個過濾，指定對象只剩申請人時回
  `ConflictException`。臨時加簽是當場建立任務所以當場擋；臨時會簽的任務要到之後某個 user task
  建立時才產生，且以「那個節點」自己的設定為準（失敗會取消 directive，不阻塞主流程）。
  送出會簽要求時另依「目前正在決策的節點」做一次提前檢查，只是常見情況的早期拒絕，
  不保證任務最後掛上的節點也會通過。
- **Dry run**：只有 dry run 能解析成真實 member id 的 resolver（`DIRECT`／`DYNAMIC_FORM`／`EXPRESSION`，
  以及讀申請人 snapshot 的 `ORG_MANAGER`）才會比對申請人；`SKIP_NODE` 回報該步驟 `SKIPPED`，`FAIL`（或找不到主管）回報 `STOPPED` 並帶說明，
  `INITIATOR_MANAGER` 取申請人 snapshot 中的主管。

**不涵蓋**：

- SLA 升級（`ESCALATE`）選出的轉交對象——它帶 `transferReason`，不經過上面的轉交檢查，
  升級對象仍可能是申請人。
- 設定開啟之前就已啟動的 instance（節點讀的是啟動時的 snapshot）。
- 其餘組織推導型 resolver（`POSITION`／`ORG_UNIT_*` 等）在 dry run 中的比對（dry run 只回傳佔位字串）；
  它們在實際建立任務時仍會被過濾。

---

## 5. Task 決策處理

```typescript
async function decideTask(taskId, action: 'APPROVED'|'REJECTED'|'RETURNED'|'TRANSFERRED', payload) {
  await transaction(async () => {
    const task = await tasks.findByIdLocked(taskId);
    assert(task.status === 'PENDING' || task.status === 'IN_PROGRESS');

    // 1. 數位簽章
    const signature = await signature.sign({
      instanceId: task.instance_id,
      taskId: task.id,
      action,
      formDataHash: hashFormData(task.instance_id),
      signerMemberId: currentUser.memberId,
      previousSignatureHash: await getLastSignatureHash(task.instance_id),
    });

    // 2. 紀錄 task_decision
    await taskDecisions.create({
      taskId, action, comment: payload.comment,
      decidedByMemberId: currentUser.memberId,
      signatureId: signature.id,
      ...
    });

    // 3. 寫 activity log
    await activityLogs.create({ type: 'TASK_DECIDED', ... });

    // 4. 處理 action
    switch (action) {
      case 'APPROVED':
        await handleApproval(task);
        break;
      case 'REJECTED':
        await handleRejection(task);
        break;
      case 'RETURNED':
        await handleReturn(task, payload.returnToNodeId);
        break;
      case 'TRANSFERRED':
        await handleTransfer(task, payload.transferToMemberId);
        break;
    }

    // 5. Trigger engine processing
    await processInstance(task.instance_id);
  });
}
```

### 5.1 User Task 完成判定（同意 case）

```typescript
async function handleApproval(task) {
  await tasks.update(task.id, { status: 'COMPLETED' });

  // 一個 User Task 只有一個主要簽核 task；完成後 token 交回引擎推進。
  await tokens.update(task.token_id, { status: 'ACTIVE' });
}
```

多前置節點的等待邏輯不在 User Task 內處理，而在下一個節點的 `triggerMode` 判定：

- `AND`：所有 incoming predecessor node 都完成後才啟動。
- `OR`：任一 incoming predecessor node 完成即可啟動。

### 5.2 拒絕

依模板設定：

- **預設**：流程立即終止 → instance.state = REJECTED
- 可設「拒絕視同退回上一關」（少見，模板可選）

### 5.3 退回

```typescript
async function handleReturn(task, targetNodeId) {
  // 1. 終結當前 token
  await tokens.update(task.token_id, { status: 'CONSUMED' });

  // 2. 取消同節點其他 pending tasks
  await cancelSiblingTasks(task);

  // 3. 在退回目標節點建立新 token
  await tokens.create({
    instanceId: task.instance_id,
    currentNodeId: targetNodeId,
    status: 'ACTIVE',
  });

  // 4. instance state → RETURNED (若退回到發起人) or 保持 RUNNING
  if (targetNodeId === workflow.startNode.id) {
    await instances.update(task.instance_id, { state: 'RETURNED' });
  }
}
```

退回到發起人後，instance 狀態為 RETURNED。發起人可：

- 編輯 form_data → 再次 submit → state 回 RUNNING
- 主動撤銷 → state = CANCELLED

重新提交策略由節點的 `returnBehavior.resubmitStrategy` 決定：

- `RESTART`：預設策略，發起人重新送出後從 Start 重跑。
- `FROM_RETURN_POINT`：發起人重新送出後，直接回到原本執行退回的簽核節點。

節點另可設定 `returnBehavior.requireComment: true`，此時退回決議必須帶非空意見，
否則引擎回 `BadRequestException`。判斷讀的是 **instance 的 workflow snapshot**，
因此模板事後才打開此開關，不會影響已在途的案件。省略此欄位等同 `false`。

### 5.4 轉派

```typescript
async function handleTransfer(task, transferToMemberId) {
  // 1. 原 task → TRANSFERRED
  await tasks.update(task.id, { status: 'TRANSFERRED' });

  // 2. 建新 task，attach 到同個 token
  await createTask({
    instanceId: task.instance_id,
    tokenId: task.token_id,
    nodeId: task.node_id,
    originalAssigneeMemberId: task.original_assignee_member_id,
    assigneeMemberId: transferToMemberId,
    delegationChain: [
      ...task.delegation_chain,
      { from: task.assignee_member_id, to: transferToMemberId, ruleId: null, reason: 'MANUAL_TRANSFER' }
    ],
    ...
  });
}
```

---

## 6. SLA 與 Boundary Timer Event

### 6.1 計算 due_at

Task 建立時：

```typescript
sla_due_at = await slaScheduleService.resolveTaskSlaDueAt({ node, now });
```

`node.sla.calendar` 決定期限怎麼推進：

| 模式                      | 語意                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `CALENDAR`（省略時預設）   | `now + duration`，純日曆時間，與 0.7.0 之前完全相同                   |
| `BUSINESS_DAY`            | duration 的**日**部分只跨工作日；時/分部分之後以日曆時間相加          |

工作日由 host 注入的 `BPMBusinessCalendar` 決定（`timeZone` + `isBusinessDay(localDate)`），
BPMCore 不內建任何國別假日資料；未注入時退回內建的週一～週五行事曆。演算法從建立時刻的
本地日期往後逐日走，每遇到一個工作日扣一天，扣完為止，**起算當日不計**——因此「1 個工作日」
永遠落在下一個工作日的同一時刻，不論案件是週一還是週六送出。

由於 `BUSINESS_DAY` 只影響日部分，把它與時/分混用（例 `P1DT4H`）時模板 linter 會發 warning。

### 6.2 SLA 掃描器

```typescript
// Cron 每分鐘
async function scanSlaBreaches() {
  const overdueTasks = await tasks.findOverdue(env.now);

  for (const task of overdueTasks) {
    const node = workflow.findNode(task.node_id);
    const policy = node.sla.onTimeout;  // 'REMIND' | 'AUTO_APPROVE' | 'ESCALATE' | 'TERMINATE_INSTANCE'

    switch (policy) {
      case 'REMIND':
        await notifications.sendSlaWarning(task);
        break;

      case 'AUTO_APPROVE':
        // 等同有人按了同意（系統作為 actor）
        await decideTask(task.id, 'APPROVED', { systemActor: true });
        break;

      case 'ESCALATE':
        // 升級給上級主管；delegation chain 已有 SLA_ESCALATION 步驟就跳過
        if (hasSlaEscalationStep(task)) break;
        const escalateTo = await managerResolution.findManager(
          task.assignee_member_id, node.sla.escalateLevelsUp ?? 1
        );
        await handleTransfer(task, escalateTo, 'SLA_ESCALATION');
        break;

      case 'TERMINATE_INSTANCE':
        await cancelInstance(task.instance_id, 'SLA_TIMEOUT');
        break;
    }

    await activityLogs.create({ type: 'SLA_TRIGGERED', ... });
  }
}
```

### 6.3 SLA 預警（非逾時）

模板可設定 `sla.warningAt: '50%'`（時限的 50% 時就提醒）。掃描器另一個條件分支處理。
預警時間點是 `created_at` 與 `sla_due_at` 之間的線性比例；工作日模式下這個比例是
「跨越區間的日曆時間比例」，不是工作時數比例。

### 6.4 升級的冪等性

`ESCALATE` 透過轉派完成，而轉派會建立**新的 task**（沿用已逾期的 `sla_due_at`）。
因為 SLA 通知的去重鍵是 `(taskId, type, recipient)`，新 task 對新簽核人一定沒有既有通知，
若不設防就會每次掃描再升一層、一路升到組織頂端。

引擎因此在升級時於 delegation chain 寫入 `reason: 'SLA_ESCALATION'`，掃描器在執行
`ESCALATE` 前檢查該標記，有就跳過。標記隨 chain 傳給新 task，所以之後的手動轉派也不會
重新觸發；而退回重送產生的是新 token、新 task、空 chain，**可以**再次升級。

---

## 7. ABAC 評估點整理

| 何時評估                            | Context 內容                               | 失敗行為            |
| ----------------------------------- | ------------------------------------------ | ------------------- |
| 發起時驗證 initiator policy         | subject + env                              | 拒絕 submit         |
| Form 欄位 visible/required/readonly | form (即時更新) + initiator                | 隱藏/標示           |
| 節點 entryCondition                 | form + initiator + instance                | 跳過此節點          |
| Edge condition                      | form + initiator + instance + lastDecision | 不走此邊            |
| Approver resolver expression        | form + initiator + instance                | 解出空集合 → 拋例外 |
| Delegation scope_condition_cel      | subject + task + instance + template       | 規則不適用          |

---

## 8. 流程完成判定

```typescript
async function checkInstanceCompletion(instanceId) {
  const activeTokens = await tokens.findActiveOrWaiting(instanceId);
  if (activeTokens.length === 0) {
    // 所有 token 已 CONSUMED 且都正常結束
    await instances.update(instanceId, {
      state: 'APPROVED',
      completedAt: env.now,
    });
  }
}
```

目前 runtime 完成 instance 時只更新 instance state / completedAt。`INSTANCE_COMPLETED`
notification type 與 template 已保留，但尚未在 completion path 送出。

---

## 9. 防呆與保護

| 風險                    | 對策                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| Token 處理進入無限迴圈  | 單次 processInstance 最多處理 N 步（例：500），超過拋例外並寫 audit |
| AND Join race condition | DB row lock + serializable txn                                      |
| 代理鏈無限遞迴          | visited Set 防循環                                                  |
| 重複決策                | task.status 檢查（PENDING/IN_PROGRESS 才能決策）                    |
| 重複提交（按鈕雙擊）    | submit 時帶 client_idempotency_key                                  |
| 流程定義動態被改        | Instance 用 workflow_snapshot，不查 versions 表                     |

---

## 10. 並發策略

- 一個 instance 的處理用 **DB advisory lock**（key = instance_id 的 hash）
- 同 instance 的多個事件序列化處理，避免 token 狀態混亂
- 跨 instance 可平行（多 worker）

```typescript
async function processInstance(instanceId) {
  await db.acquireAdvisoryLock(hashOf(instanceId));
  try {
    // ... main loop
  } finally {
    await db.releaseAdvisoryLock(hashOf(instanceId));
  }
}
```
