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
          await executeServiceAction(node, token); // 目前只執行 NOTIFY
          advanceTokenToNext(token);
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
  const assignee = candidates[0];

  assert(assignee, 'User Task must resolve one primary approver');

  await createTask({ token, assignee });
}
```

設計器語意是「一個 User Task 代表一位主要簽核責任人」。多人簽核不放在同一個節點內用 `DecisionPolicy` 表示，而是拆成多個 User Task 節點與連線。

例如：

```text
A -> B -> D
A -> C -> D
```

- D 設定 `triggerMode: 'AND'`：B 與 C 都完成後才進入 D。
- D 設定 `triggerMode: 'OR'`：B 或 C 任一完成即可進入 D。

每個建立 task 前都要呼叫 `applyDelegation` 替換 assignee。`decisionPolicy` 保留為相容欄位，設計器固定寫入 `{ type: 'SINGLE' }`。

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
sla_due_at = task.created_at + node.sla.duration;
```

可選用「工作時間」（排除週末/假日）— MVP 用日曆時間。

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
        // 升級給上級主管
        const escalateTo = await managerResolution.findManager(
          task.assignee_member_id, 1
        );
        await handleTransfer(task, escalateTo);
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
