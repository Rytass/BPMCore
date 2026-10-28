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

| 狀態          | 描述                                                                                   | 終態 |
| ------------- | -------------------------------------------------------------------------------------- | ---- |
| **DRAFT**     | 保留。目前引擎不會寫入此狀態（UI 的篩選選項會列出，但沒有實際資料），屬未實作的規劃   | ❌   |
| **RUNNING**   | 流程進行中                                                                             | ❌   |
| **APPROVED**  | 所有 token 走到 End                                                                    | ✅   |
| **REJECTED**  | 任一 task 拒絕（不可恢復）                                                             | ✅   |
| **RETURNED**  | 退回到發起節點（start event）後等待發起人重新送出；退回到其他節點時維持 RUNNING          | ❌   |
| **CANCELLED** | 發起人主動撤銷                                                                         | ✅   |
| **EXPIRED**   | 未發佈（v0.16.2 之後）。SLA 的 `TERMINATE_INSTANCE` 策略觸發；收尾與取消相同，但無 actor、不是人為撤銷（見 §6.2） | ✅   |

> 先前已被 SLA 終止的案件仍為 CANCELLED（舊資料不回填）。

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
   ┌──────────┼─────────────────────┐
   │          │                     │
   ▼          ▼                     ▼
COMPLETED  TRANSFERRED         CANCELLED
(decided)  (轉派他人，本 task    (instance cancelled、
            結束、新建一筆)      expired 或 returned 時
                                 開放中的 task 皆被結束)
```

> `TRANSFERRED` 的「本 task 結束、新建一筆」只適用 `SINGLE` 與 `SEQUENTIAL`。群組決策（`PARALLEL_ALL`／`PARALLEL_ANY`／`QUORUM`）
> 的持有人轉派不結束 task，只在原 task 上替換席位（見 §5.4；未發佈，v0.16.2 之後）。

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

節點的 `entryCondition` 在進入上面的 `switch` 之前先判定，且排在匯合就緒檢查
（`isNodeEntryReady`，多條入邊要等其他分支到齊）之後——所以有 2 條以上入邊的知會節點，
也是等入邊到齊後才判定 `entryCondition`。不成立就略過該節點（寫一筆
`TOKEN_ADVANCED` 活動，`payload: { skippedByEntryCondition: true, tokenId }`），
token 依節點類型處理：

- 一般節點：照常沿出邊前進，就像節點已執行完。
- 知會節點（`serviceTask` + `NOTIFY`）：**直接 consume token**，不往下走，跟它被觸發時
  一致。知會節點不得有出邊，所以略過時若去找出邊會讓整次送出失敗
  （`Workflow node <id> has no outgoing edge`）。活動 payload 多一個 `consumed: true`，
  不發站內通知、不排 webhook。略過後的流程完成判定與觸發時相同：沒有其他 ACTIVE／WAITING
  token 就完成 instance，還有其他分支開著就繼續 RUNNING。

---

## 3. Gateway 處理細節

### 3.1 Exclusive Gateway (XOR) Split

W6 runtime 會優先執行 `edge.data.condition` 的 CEL expression，並保留設計器產出的結構化條件欄位作為相容 fallback：

- `edge.data.condition`
- `edge.data.conditionFieldKey`
- `edge.data.conditionOperator`
- `edge.data.conditionValue`
- `edge.data.isDefault`

引擎會用 `env`、`form`／`formData`、`initiator`、`instance`（id、state、templateId、templateVersionId、title），加上 `lastDecision`（未發佈，v0.16.2 之後）
組成 CEL context。`lastDecision` 是 edge 來源節點上最新一筆決策（`LastDecisionContext`，形狀見 `docs/05` §3），
該節點尚無決策時為 `null`，所以條件要寫成 `lastDecision != null && …`。XOR 判斷第一條符合條件的 outgoing edge；若都不符合，會走 `isDefault`。

> 所有節點類型的 outgoing edge 都會先評估條件：條件成立的 edge 全部都會走（分叉），XOR 只取第一條。
> 下方示意程式只描述 XOR 的情況。

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
  throw new ConflictException(`Workflow node ${node.id} has no matching outgoing edge`); // 實際行為
}
```

### 3.2 Parallel Gateway (AND) Split

W6 MVP 不要求設計器使用 Parallel Gateway 節點。任何可輸出的節點只要有多條 outgoing edge，runtime 就會把目前 token consume，並為每條**條件成立（或無條件）**的 outgoing edge 建立一個 child `ACTIVE` token。這讓「一個簽核節點往後拉兩條線」可直接表達平行分支。

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

- `AND`（預設）：多條 incoming edge 都抵達後才觸發該節點。先抵達的 token 會暫時轉為 `WAITING`，
  但只有在「仍有其他存活的 token 可能抵達這個節點」時才等待；若已不可能再到達（例如另一分支已被
  XOR 排除），合併以已到達的 token 繼續，不會卡住。
- `OR`：任一 incoming edge 抵達就觸發該節點；其他仍可能抵達同一節點的 sibling branch 會被 consume，相關 pending task 會被標記為 `CANCELLED`。

實際行為對應 `workflow-engine.service.ts` 的 `isNodeEntryReady`。它是每個節點進入時的檢查，只對有 2 條以上入邊的節點生效，
且排在 `entryCondition` 判定之前（見 §2）。token 狀態只有 `ACTIVE`／`WAITING`／`CONSUMED` 三種，沒有 `WAITING_AT_JOIN`。

```typescript
function isNodeEntryReady(node, token) {
  if (incomingEdges(node).length < 2) return true;

  const arrived = tokensAt(node.id, status in [ACTIVE, WAITING]); // 含本顆 token

  if (node.data.triggerMode === 'OR') {
    cancelAlternativeTokens(node.id);     // sibling token consume，相關 pending task → CANCELLED
    consumeJoinedTokens(arrived.filter(t => t.id !== token.id));
    return true;
  }

  // AND：還有其他存活 token 可能抵達這個節點時才等待
  const mayStillArrive = otherLiveTokens.filter(t => hasPathToNode(t.currentNodeId, node.id));
  if (arrived.length < incomingEdges(node).length && mayStillArrive.length > 0) {
    setTokenStatus(token, 'WAITING');     // 等待；之後其他分支抵達時會重新檢查
    return false;
  }

  consumeJoinedTokens(arrived.filter(t => t.id !== token.id)); // 合併成這顆 token
  return true;                            // 合併後的 token 照常沿出邊前進
}
```

> 同一 instance 的所有處理都在同一個 transaction 內，並以 transaction 層級的 advisory lock 序列化（見 §10）。
> 本系統**沒有**使用 SERIALIZABLE 隔離等級，也沒有 row lock 作為 AND Join 的防護。

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

> 以下為示意，方法名稱不是實際 API；resolver 型別的完整定義見 `libs/shared/src/lib/workflow.ts` 的 `ApproverResolver`。
> 實際候選人解析入口為 `workflow-engine.service.ts` 內的候選人解析流程（`ORG_UNIT_*` 與 `POSITION` 由組織資料解析，見下方 §4.3 的順序說明）。

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
      return await walkManagerChain(context.initiator, resolver.minPositionLevel); // 示意；實作為 resolveOrgManagerChainCandidates

    case 'ORG_UNIT_MEMBER':
      // 指定組織單位（可選含子單位）底下的所有成員
      return await memberships.findByOrgUnit(resolver.orgUnitId, resolver.includeDescendants);

    case 'ORG_UNIT_POSITION':
      // 指定組織單位（可選含子單位）內、擔任指定職位的成員
      return await memberships.findByOrgUnitAndPosition(resolver.orgUnitId, resolver.positionId, resolver.includeDescendants);

    case 'ORG_UNIT_MANAGER':
      // 指定組織單位的主管（主管規則，見 organization 模組）
      return [await managerResolution.findManagerOfOrgUnit(resolver.orgUnitId, resolver.preferClosestOrgUnit)];

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
  （`effective_from`／`effective_to` 涵蓋今天；「今天」依根選項 `organizationTimeZone` 的日期，預設 `Asia/Taipei`）且有 `positionId` 的所有 membership 中最大的
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
     節點開了 `excludeInitiator` 且單據有代送人（§4.4）時，**代送人同樣被略過**：他不加入清單、
     也不算「達標的最後一關」，鏈繼續往上走，所以他是剛好達標的那位主管時，會改選他上面的下一位
     達標主管，而不是在事後把他濾掉、留下一條空鏈（略過他時不會更新「最後一位已加入的職等」）。
     沒開 `excludeInitiator` 的節點不略過任何人。
  6. 否則加入清單；若職等 `>= minPositionLevel` 就停止，這位主管是最後一關。
- **未達門檻**：鏈在出現達標主管之前就結束時，走 `fallback`，規則與 `ORG_MANAGER` 完全相同
  （`NONE`／未設定 → 丟 `ConflictException`；改派固定人未填 → 丟錯；固定人是申請人本人且未開
  `allowInitiatorSelfApproval` → 丟錯）。fallback 成功時把改派固定人放在清單**最後**一關；
  若他已在清單裡就不重複加入。
- **Publish 檢查**：`minPositionLevel` 必須是整數；`userTask` 的 `decisionPolicy` 必須是
  `SEQUENTIAL` 或 `PARALLEL_ALL`，否則第一位主管簽完就會讓節點結案。
- **代理人與轉簽對象的職等**：主管鏈解析完之後，代理與轉簽都不會再檢查職等，所以主管鏈節點多一條規則——
  **接手的人職等必須 `>=` 被他取代的那位成員**（不是固定門檻：鏈上本來就會有低於 `minPositionLevel`
  的主管，固定門檻會讓他們完全不能代理）。職等一律在動作當下用上面的〈職等來源〉現算；
  被取代的成員沒有職等（例如 `fallback` 固定人）就不設限。只對 `approverResolver.type === 'ORG_MANAGER_CHAIN'`
  的 user task 生效，其他節點的代理與轉簽行為不變。
  - **代理（建立任務與 `SEQUENTIAL` 輪到下一位時）**：照原本流程解析出代理人；若最終代理人與主管不同，
    且代理人沒有職等或職等較低，**這一關不套用代理、保留原主管**（`delegation_chain` 為空），
    也不沿代理鏈往下找別人。順序仍是：解析 → 代理（含職等檢查）→ 排除申請人 → 去重 → `whenEmpty`；
    被拒絕的代理人若剛好是申請人，因為代理沒有套用，主管不會因此被排除。
  - **為什麼沒套用要查得到**：不寫進 `delegation_chain`（時間軸與外送 payload 會把那裡的每一筆當成真的代理），
    也沒有新的 `ActivityLogEventTypeEnum` 值；改成在記錄該任務／候選人的 activity payload 加一個可選欄位
    `skippedDelegations`：`TASK_CREATED`（建立時，所有仍在任務上的成員被拒絕的代理——排除申請人之後、去重之前蒐集，所以只被去重擠掉的那一列仍有記錄，而申請人本人被移除的席位不會留下記錄；同一組主管與代理人只記一筆）與 `TASK_CANDIDATE_ACTIVATED`（輪到時重新解析被拒絕的那一筆；即使因代理人已在 task 上或代理路徑經過申請人而沿用原記下的值，被拒絕這件事仍會記錄），
    元素為 `{ principalMemberId, agentMemberId, reason: 'AGENT_POSITION_LEVEL_TOO_LOW', principalLevel, agentLevel }`
    （`agentLevel` 為 `null` 表示代理人沒有職等）。沒有被拒絕的代理時不會出現這個欄位。
  - **人工轉簽**（GraphQL `decideTask` 與宿主的 S2S 決策端點都走 `decideTask`）：被取代的成員是這位簽核人
    **原本的主管**——若他是代理人，就是 `delegation_chain` 的第一個 `from`，否則是本人。目標沒有職等或職等較低時，
    回 `ForbiddenException`：`簽核節點「{label}」需由職等 {N} 以上的成員簽核，不能轉簽給職等不足的成員`
    （`N` 為被取代者的職等）。臨時加簽／會簽的任務不受影響。
  - **SLA 升級（`ESCALATE`）不在此限**：它帶 `transferReason`，與 §4.4 的申請人轉交檢查相同，不經過這個檢查
    （Shuttle 等宿主沒有開啟 SLA 排程）。

#### 4.1.2 無主管時的改派（`fallback`）

> `POSITION` 備援與「未知備援類型守衛」**尚未發佈**（v0.16.2 之後才合入 main）；已發佈版本只有 `NONE` 與 `DIRECT`。

`ORG_MANAGER`、`ORG_UNIT_MANAGER`、`ORG_MANAGER_CHAIN` 找不到主管時，才會讀 `fallback`。
型別只有三種（`POSITION` 尚未發佈），都是窄版、不接受任意 resolver：

| `fallback.type` | 解析結果 | 申請人本人 |
| --- | --- | --- |
| `NONE`（或未設定） | 丟 `ConflictException`，流程停下來提示 | — |
| `DIRECT` | 固定一位會員 `memberId` | 除非 `allowInitiatorSelfApproval`，否則丟錯 |
| `POSITION` | 該職位**目前**的有效成員（規則同 `POSITION` 節點：組織時區的今天、有效期間內、主要職位優先、依 `effectiveFrom` 由新到舊） | 預設先過濾掉；除非 `allowInitiatorSelfApproval`，否則過濾後若沒人就丟錯 |

- `POSITION` 備援解析成 0 人（職位沒有任何有效成員）→ 與 `NONE` 相同，丟 `ConflictException`。
- `POSITION` 解析成多人時，這些人全部成為候選人，之後照節點自己的 `decisionPolicy` 處理
  （`PARALLEL_ANY` 任一人、`PARALLEL_ALL` 全部、`SEQUENTIAL` 依序）。
- `ORG_MANAGER_CHAIN` 的備援多人時，他們全部接在清單最後一關、與鏈上其他人一樣**全部要簽**
  （鏈節點的決策政策只允許 `SEQUENTIAL` 或 `PARALLEL_ALL`，不會出現「任一人即可」）。已在清單裡的人不重複加入。
- 解析後的每一位仍照原本流程經過代理（§4.2）、排除申請人（§4.4）與去重。

**版本相容與發佈順序（重要）**：

- **在途的案件不會換人。** 樣板定義在發起時凍結成快照，備援只在節點啟動時讀取一次；
  改了樣板的備援，只影響之後新發起的案件，已經在跑的案件沿用當時的快照。
- **所有 API replica 升級到支援 `POSITION` 的版本之前，不要發佈含 `POSITION` 備援的樣板。**
  舊引擎遇到它的反應取決於版本：
  - 含「未知備援類型守衛」的引擎（#90 起）會在節點啟動時丟出「此引擎版本不支援改派類型」的
    `ConflictException`（試跑則停在該節點並提示），不會默默改派；案件停在那一關，升級後可重新處理。
  - **更舊的引擎（v0.16.2 以前）沒有這道守衛**，會把它當成 `DIRECT` 讀取 `fallback.memberId`，
    在節點啟動時拋出 `TypeError`，試跑也只會顯示「請確認試跑時的申請人資料」這類誤導訊息。
  - 因此升級要分兩步：先讓所有 replica 至少跑到含守衛的版本，再部署支援 `POSITION` 的版本，
    最後才發佈用到 `POSITION` 備援的樣板。兩者在同一個版本一起上線時，「全部 replica 升級完成」
    就同時滿足兩個條件。

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
      // 防循環代理 (A 代給 B、B 代給 A)；實際丟 ConflictException（"Delegation cycle detected ..."）
      throw new ConflictException(`Delegation cycle detected for member ${current}`);
    }
    visited.add(current);

    // 1. 找此 principal 當下所有有效的代理規則（status ACTIVE、startAt 已到、endAt 未過）
    const rules = await delegationRules.findActive(current, env.now);

    // 2. 依優先序排序：priority 數字大者優先（與組織主管規則一致）；同 priority 時較早建立者優先
    const ordered = [...rules].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    // 3. 取第一條 scope 符合的規則；沒有則結束代理鏈
    const rule = ordered.find((r) => matchesScope(r, context));
    if (!rule) break;

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

| Scope 類型        | matchesScope() 邏輯                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `ALL`             | 永遠 true                                                                                 |
| `TEMPLATE_LIST`   | `instance.templateId`（即模板 id）在 `rule.scope_template_ids` 內                         |
| `CONDITION_BASED` | `ConditionService.evaluateBoolean(rule.scope_condition_cel, 委派 context) === true`；條件執行期錯誤會拋出 `BadRequestException` |

**實際行為與上方示意的差異（以程式為準）**：

- 排序是 `priority` DESC，同 priority 時 `createdAt` ASC（先建立者勝出）。委派規則的列表頁（後台）則是 `priority` DESC、`createdAt` DESC。
  兩者皆未發佈（v0.16.2 之後）；已發佈版本（實際為最早建立者優先：排序是 `createdAt` ASC 再 `priority` ASC，priority 只在建立時間相同時才比較），列表為 `createdAt` DESC 再 `priority` ASC。
  這與組織主管規則（manager resolution）一致：數字大者優先。
- 規則的 `priority` 預設 100；數字越大越優先，不是越小越優先。
- 找不到可用規則即結束代理鏈；代理鏈中若回到已經出現過的成員，丟 `ConflictException`。
  規則儲存時也會檢查不得形成循環（`assertNoActiveCycle`），所以正常資料不會走到這裡。
- **已停用的代理人（未發佈，PR #127）**：每一跳先把該 principal 當下有效、且 scope 符合這次案件的規則的代理人，一次交給宿主
  member resolver 的 `resolveInactive` 查詢；宿主回報已停用（離職、帳號停用）的代理人，其規則**略過**，
  改看下一條規則，都不適用時任務留在該 principal。scope 不符的規則不會拿去查詢，所以規則全都不適用的
  principal 不會因目錄故障而被擋下。每條規則的 scope 都會先求值；某條 scope 條件求值出錯時，只有在該規則正是
  要套用的那條（代理人在職、且排在它前面的規則都不適用）才讓派送失敗，與逐條求值時的結果相同。宿主沒實作 `resolveInactive`、或引擎沒有接 identity module 時，行為與以前相同。
  已指派給停用代理人的既有任務不會被收回。
- **同一節點一次查詢**：建立任務時（`delegateResolvedCandidates` → `DelegationService.resolveAssignees`），
  節點上所有候選人第一跳的代理人合併成**一次** `resolveInactive`；只有第二跳以後才各自再查。
- **目錄查詢失敗時擋下派送**：`resolveInactive` 拋錯，或 5 秒內沒有回應，就丟
  `ServiceUnavailableException`（503），訊息寫明是 member directory lookup（`resolveInactive`）失敗；涉及的代理人 id 與宿主回傳的錯誤只寫進 server log（`DelegationService` 的 error log），不回給呼叫端，避免外洩目錄位址等內部資訊；
  該次送件、推進或輪到下一位的交易整個 rollback，可在目錄恢復後重試。不會把任務交給無法確認在職的代理人，
  也不會在沒有紀錄的情況下留給 principal。代價是目錄故障期間，凡是節點上有人有適用這次案件的代理規則，該案件都無法派送。

**委派條件（`CONDITION_BASED`）的 CEL context**（`buildDelegationExpressionContext`）：

| 根識別字    | 內容                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| `env`       | `{ now }`（ISO 字串）                                                                      |
| `form`／`formData` | 任務所屬 instance 的表單資料（兩者相同）                                          |
| `initiator` | 申請人 snapshot，並展開 `memberId`                                                         |
| `instance`  | `{ id, nodeId, state, templateId, templateVersionId, title }`；`nodeId` 為被委派任務所在的節點 |
| `principal` | `{ memberId }`，即被代理的人                                                               |

沒有 `subject`、`task`、`template` 根識別字。儲存規則時會檢查根識別字（未發佈，v0.16.2 之後），只允許上述六個；
不合法的規則不會被儲存。已經存在的錯誤規則不會被改動，執行期評估時仍會拋錯。

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
  `{ assigneeMemberId, candidateMemberIds: [同一位], originalAssigneeMemberId, assignmentType, candidateMemberId, originalMemberId, sequence, previousMemberId, skippedDelegations?, tokenId }`（`skippedDelegations` 只在主管鏈節點拒絕了代理時出現，見 §4.1.1）。
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

**代送人（`submittedByMemberId`）**：單據可能不是申請人自己送出的——助理、或主管替下屬建單。
建單人若在申請人的主管鏈上，就會簽到自己建的單（權責分離規則：建單人不得核准自己建立的單）。
所以送簽指令（服務層 `submitApprovalInstance`）多了選填的 `submittedByMemberId`，
instance 會記錄它（`approval_instances.submitted_by_member_id`，GraphQL 欄位 `submittedByMemberId`）：

- GraphQL 的 `submitApprovalInstance` 一律帶**目前登入的人**，輸入型別沒有這個欄位，使用者偽造不了；
  只有服務層呼叫端能指定「由 X 代 Y 送出」。
- 沒傳（或 `null`）就等於 `initiatorMemberId`，行為與過去完全相同；傳入空字串或全空白會丟
  `BadRequestException('submittedByMemberId must be a non-empty string')`。
- 開了 `excludeInitiator` 的節點，下面各項**對代送人與對申請人套用完全相同的規則**（含代理路徑上任何一步）；
  `whenEmpty` 的處理也不變。代送人不是申請人本人時，錯誤訊息改用「申請人或代為送出此單的人／代送人」的版本。
- 舊資料的 `submitted_by_member_id` 是 `NULL`，一律視為「申請人自己送出」，不回填。
- `INSTANCE_STARTED` activity 的 payload 另帶 `submittedByMemberId`；代送人不是申請人時，再帶送出當下查到的
  代送人姓名 `submittedByName`。
- **代送人看得到單據**：代送人（與申請人不同時）可以讀這張單——單據詳情、時間軸、附件，
  以及「我送出的」（`SENT`）與一般可讀清單裡都找得到，助理才找得回自己送出的案件。
  **只有讀取**：重送（resubmit）與取消（cancel）仍然只有申請人本人能做，檢查沒有動。
  不相干的成員讀到的仍是 `Approval instance … was not found`。
- **申請人的通知會說明是誰代送**：單據完成時寄給申請人的 `INSTANCE_COMPLETED` 通知，內文在有代送人時
  多一句「（由 {代送人姓名} 代為送出）」，payload 另帶 `submittedByMemberId` 與組好的句子
  `submittedByNote`（內建模板 `{{submittedByNote}}` 取用它；自訂的 handlebars 模板也可以用）；
  申請人自己送出的單據內文與 payload 完全不變。姓名在**送出時、送出的 transaction 開始之前**經由主機的
  身分來源解析一次（與寄信取收件人 email 同一條路），記在 `INSTANCE_STARTED` 的 `submittedByName`；
  查不到、丟錯，或 2 秒內沒有回應都退回成員 id。單據完成時只讀這筆紀錄，不在核准的 transaction 內呼叫
  身分來源，避免主機回應慢時拖住核准並握著單據的鎖；沒有這筆紀錄的單據顯示成員 id。其他類型的通知（待簽、SLA、節點通知）收件人不是申請人，沒有改動。
- **前端顯示**：單據詳情標題下方的說明列在有代送人時多一段「由 {代送人} 代 {申請人} 送出」，時間軸的
  「案件已發起」那一筆也會有同一句。判斷「是否代送」的規則（`submittedByMemberId` 非空且不同於
  `initiatorMemberId`）集中在 `libs/bpm-core-react/src/views/instances/detail/submitted-by.ts`；
  姓名解析沿用頁面既有的成員資料載入，沒載入到的顯示成員 id。

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
    查主管時只取申請人最近的組織單位，並先排除申請人本人與代送人的主管規則再選最高優先序——
    申請人本人（或替他送出單據的主管）就是單位主管時，會落到上一層的主管，而不是又選回他自己。
  - `SKIP_NODE`：不建立任務，寫一筆 `TOKEN_ADVANCED` activity log
    （`payload: { skippedByInitiatorExclusion: true, tokenId }`），token 直接往下走。
    待處理的會簽 directive 留給下一個真正建立的 user task。
  - 一開始就解析不出任何人（與申請人無關）仍是原本的錯誤，不套用 `whenEmpty`。
- **轉交**：簽核人手動轉交（`decideTask` 的 `TRANSFERRED`）時，若目標是申請人本人，
  回 `ConflictException`；若目標是代送人（且不是申請人），同樣回 `ConflictException`
  （`簽核節點「…」不允許代送人簽核，不能將任務轉交給代為送出此單的人`）。
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
  升級對象仍可能是申請人或代送人。
- Dry run 沒有「代送人」輸入，所以不模擬代送人的排除。
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

- 拒絕決策必須附非空白的 comment，否則丟 `BadRequestException`（`Reject decision comment is required`）。
- 流程立即終止 → instance.state = `REJECTED`。其餘開放中的 token 與 task（含平行分支）一併結束，
  候選人一併關閉，並清除 pending 的 ad-hoc 指令（見 `docs/13` §6.2）。
- **「拒絕視同退回上一關」未實作（規劃中）**：目前模板沒有這個設定，拒絕一律終止整個流程。

### 5.3 退回

退回的範圍是**整個 instance**，不只是同一節點（對應 `returnInstanceToNode`）：

```typescript
async function handleReturn(task, targetNodeId) {
  // 1. 結束整個 instance 所有開放中的 runtime 狀態：
  //    ACTIVE／WAITING 的 token 全部 CONSUMED（含其他平行分支），
  //    PENDING／IN_PROGRESS 的 task 全部 CANCELLED，其候選人一併關閉
  await consumeOpenRuntimeState(task.instance_id, { taskStatus: 'CANCELLED' });

  // 2. 清除 pending 的會簽／加簽指令；階段通知依退回結果送出，結案通知保留
  await cancelPendingAdhocDirectives(task.instance_id, ['COUNTERSIGN', 'PRE_APPROVAL']);

  // 3. instance state：退回到 start event 為 RETURNED，退回到其他節點為 RUNNING
  // 4. 在退回目標節點建立新 token（ACTIVE），之後照常推進
  await tokens.create({
    instanceId: task.instance_id,
    currentNodeId: targetNodeId,
    status: 'ACTIVE',
  });
}
```

> 退回到其他節點時，整個流程會從該節點重新開始；其他分支的進行中工作都會被取消，不會保留。
> 「只取消同節點的 task」的做法**未採用**。

退回到發起節點（start event）後，instance 狀態為 RETURNED。發起人可：

- 編輯 form_data → 再次 submit → state 回 RUNNING
  （可選填一段重新送出說明 `comment`，上限 2000 個 UTF-16 code unit（即 JS 字串長度，以 trim 前的原始輸入計），trim 後寫入
  `INSTANCE_RESUBMITTED` activity log 的 payload，空白存為 `null`）
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

**群組階段例外**（未發佈，v0.16.2 之後）：決策政策為 `PARALLEL_ALL`、`PARALLEL_ANY` 或 `QUORUM` 時，持有人轉派走
`transferGroupSeat`：task 保持開啟、id 不變，只把轉派人的席位就地換成目標，其他席位維持原狀態，也不會被 supersede；
轉派人的決策與簽章仍記在這筆 task 上。`SINGLE` 與 `SEQUENTIAL` 照上方流程。

**管理員改派**（未發佈，v0.16.2 之後）：`reassignTask`／`reassignMemberTasks` 由管理員把開放中的席位就地移給另一位成員，
task id 不變、不寫決策與簽章，也不受節點 `allowTransfer` 限制（詳見 `docs/api-reference.md`）。

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

SLA 掃描器（`NotificationService.runSlaScan`）由 `NotificationSlaSchedulerService` 以 `setInterval` 定期執行，
預設每 60 秒（`slaScanIntervalMs`），由宿主選項 `slaSchedulerEnabled` 開關。掃描對象是 `PENDING`／`IN_PROGRESS`
且 `sla_due_at` 有值的 task。流程（示意）：

```typescript
// 每個掃描到的 task（已逾時）
async function handleOverdueTask(task) {
  const node = workflow.findNode(task.node_id);
  const policy = node.sla.onTimeout ?? 'REMIND'; // 'REMIND' | 'AUTO_APPROVE' | 'ESCALATE' | 'TERMINATE_INSTANCE'

  // 1. 先寫 SLA_OVERDUE 通知（同一 task／收件人只寫一次，有唯一索引防重）。
  //    已存在就直接結束：步驟 2、3 只在「首次建立通知」時執行，因此每個逾時 task 的動作至多執行一次
  const created = await notifications.createSlaNotificationOnce(task, 'SLA_OVERDUE');
  if (!created) return;

  // 2. 寫 SLA_TRIGGERED 活動紀錄（actor 為 null，trigger = 'OVERDUE'），在執行動作之前
  await activityLogs.create({ type: 'SLA_TRIGGERED', actor: null, payload: { onTimeout: policy, ... } });

  // 3. 宿主有啟用該策略才執行動作；未啟用時只有步驟 1、2（活動紀錄仍會寫入，但動作不會執行）
  //    預設：REMIND 啟用；AUTO_APPROVE／ESCALATE／TERMINATE_INSTANCE 預設關閉
  if (!isEnabledByHost(policy)) return;

  switch (policy) {
    case 'REMIND':
      break; // 僅步驟 1 的通知

    case 'AUTO_APPROVE':
      // 以 task 的 assignee（無則第一位 candidate，依 createdAt）名義決策，見下方說明
      await decideTask({ taskId, action: 'APPROVED', decidedByMemberId: actorId,
                         comment: 'SLA timeout auto-approved this task.' });
      break;

    case 'ESCALATE':
      // 若 delegation chain 已有 SLA_ESCALATION 步驟就跳過（防止逐層一路升到頂）
      if (hasSlaEscalationStep(task)) break;
      // 目標 = 以 actor 為起點往上 escalateLevelsUp 層（至少 1 層）的主管；找不到或等於 actor 就跳過
      const target = await resolveEscalationTarget(actorId, node.sla.escalateLevelsUp); // 示意，非實際 API
      if (!target || target === actorId) break;
      await decideTask({ taskId, action: 'TRANSFERRED', decidedByMemberId: actorId,
                         transferToMemberId: target, comment: 'SLA timeout escalated this task.' },
                       { transferReason: 'SLA_ESCALATION' });
      break;

    case 'TERMINATE_INSTANCE':
      // 結束案件，終態為 EXPIRED（不是 CANCELLED），無 actor
      await expireApprovalInstance({ instanceId, nodeId, taskId,
                                     comment: 'SLA timeout terminated this instance.' });
      break;
  }
}

// 預警（非逾時）：task 尚未逾時、且已超過 warningAt 比例時，寫一次 SLA_WARNING 通知與 SLA_TRIGGERED（trigger = 'WARNING'）
```

**AUTO_APPROVE 的稽核面（決策已定案，維持現況）**：系統並未以獨立的「系統 actor」決策，而是以 task 的 assignee
（無 assignee 時為 `task_candidates` 中 `createdAt` 最早的一位）名義呼叫 `decideTask`。因此：

- `task_decisions`、簽章（`signatures.signer_member_id`）與 `TASK_DECIDED` 活動紀錄都歸屬於該成員，看起來像他本人同意。
- 辨識方式：決策的 `comment` 為固定字串 `SLA timeout auto-approved this task.`，且同一 task 之前有一筆 `SLA_TRIGGERED`（`actor_member_id` 為 null）。
- 稽核時必須以這兩筆紀錄判斷是否為逾時自動同意，不能只看簽章人。

**ESCALATE 的細節**：升級目標不是 delegation rule 查到的，而是組織主管解析（`NotificationService.resolveEscalationTargetMemberId`，逐層呼叫 `OrganizationService.resolveManagerMemberId`，從 actor 往上
`escalateLevelsUp` 層，至少 1 層）。實際轉交走 `decideTask(TRANSFERRED)` 並帶 `transferReason: 'SLA_ESCALATION'`，
因此不受 §4.3 的申請人／代送人轉交檢查約束（見 §4.3 的「不涵蓋」）。

**TERMINATE_INSTANCE 的結果**（未發佈，v0.16.2 之後）：`expireApprovalInstance` 收尾與取消相同（token、task、候選人、通知 supersede、
ad-hoc 結案通知，標籤為「逾期終止」），案件終態為 `EXPIRED`，活動紀錄為 `INSTANCE_EXPIRED`（actor 為 null，帶逾期任務的 nodeId／taskId）。
若案件已經結束（另一個逾期任務先到、或已被人決策），原樣返回，不再動作。

### 6.3 SLA 預警（非逾時）

模板可設定 `sla.warningAt: 0.5`（0 到 1 之間的小數，代表時限的 50% 時提醒；不是字串 `'50%'`）。
未設定，或值小於等於 0、大於等於 1 時不預警。掃描器另一個條件分支處理，每個 task 只寫一次 `SLA_WARNING` 通知。
預警起點是 `sla_started_at`，沒有值時為 `created_at`；預警時間點是該起點與 `sla_due_at` 之間的線性比例。
工作日模式下這個比例是「跨越區間的日曆時間比例」，不是工作時數比例。

### 6.4 升級的冪等性

`ESCALATE` 透過轉派完成，而轉派會建立**新的 task**（沿用已逾期的 `sla_due_at`）。
因為 SLA 通知的去重鍵是 `(taskId, type, recipient)`，新 task 對新簽核人一定沒有既有通知，
若不設防就會每次掃描再升一層、一路升到組織頂端。

引擎因此在升級時於 delegation chain 寫入 `reason: 'SLA_ESCALATION'`，掃描器在執行
`ESCALATE` 前檢查該標記，有就跳過。標記隨 chain 傳給新 task，所以之後的手動轉派也不會
重新觸發；而退回重送產生的是新 token、新 task、空 chain，**可以**再次升級。

---

## 7. ABAC 評估點整理

| 何時評估                            | Context 內容（根識別字）                                                    | 失敗行為            |
| ----------------------------------- | -------------------------------------------------------------------------- | ------------------- |
| 發起時驗證 initiatorPolicyCel       | `env`、`initiator`（`subject` 為其別名）                                   | 條件為 false：拒絕 submit（`ConflictException`） |
| Form 欄位 visible/required/readonly | form (即時更新) + initiator（表單層評估，本文件未逐一查證執行位置）          | 隱藏/標示           |
| 節點 entryCondition                 | `env`、`form`、`formData`、`initiator`、`instance`                         | 條件為 false：跳過此節點（見 §2） |
| Edge condition                      | 同上，另加 `lastDecision`（見 `docs/05` §3；未發佈，v0.16.2 之後）                               | 不走此邊；沒有任何條件成立時走 default 邊，都沒有則丟 `ConflictException` |
| Approver resolver expression        | 同 entryCondition（無 `lastDecision`）                                     | 解出空集合 → 拋例外 |
| Delegation scopeConditionCel        | `env`、`form`、`formData`、`initiator`、`instance`（含 `nodeId`）、`principal` | 條件為 false：規則不適用；執行期錯誤：拋 `BadRequestException` |

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

核准完成時（`completeInstanceIfNoOpenRuntimeState`，state = `APPROVED`）會更新 instance 的 state 與 `completedAt`，
並建立 `INSTANCE_COMPLETED` 站內通知給申請人（`createInstanceCompletedNotification`）。

- 只有**核准完成**送出 `INSTANCE_COMPLETED`。拒絕（REJECTED）、取消（CANCELLED）、逾期終止（EXPIRED）都不送。
- 結案的 ad-hoc 結案通知（`COMPLETION_NOTIFY`，見 `docs/13` §5.2）則對四種終態都會派發。
- 通知的站內文案在有代送人時會註明「由 X 代為送出」（見 §4.4）。

---

## 9. 防呆與保護

| 風險                    | 對策                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| Token 處理進入無限迴圈  | 單次處理最多 500 步（`MAX_PROCESSING_STEPS`），超過丟 `ConflictException`（"exceeded maximum processing steps"）並回滾該交易；超限本身不寫入稽核紀錄 |
| AND Join race condition | 同 instance 以 transaction 層級 advisory lock 序列化（`pg_advisory_xact_lock`，見 §10）；未使用 SERIALIZABLE 或 row lock |
| 代理鏈無限遞迴          | visited Set 防循環                                                  |
| 重複決策                | task.status 檢查（PENDING/IN_PROGRESS 才能決策）                    |
| 重複提交（按鈕雙擊）    | 沒有通用的 idempotency key。宿主可在 submit 帶選用的 `businessKey`：同一樣板下相同業務鍵只能有一張簽核單（`approval_instances_business_key_key` 部分唯一索引，僅限有值的列），重複送出回 `ConflictException`，可用 `findApprovalInstanceByBusinessKey` 查回既有那張；不帶 `businessKey` 時沒有防重 |
| 流程定義動態被改        | Instance 用 workflow_snapshot，不查 versions 表                     |

---

## 10. 並發策略

- 一個 instance 的處理用 **transaction 層級的 PostgreSQL advisory lock**：`SELECT pg_advisory_xact_lock(hashtext(instance_id))`，
  在進行變更的交易開頭取得，交易結束（commit 或 rollback）時自動釋放，不需要手動 release。
- 同 instance 的多個事件序列化處理，避免 token 狀態混亂；決策、取消、逾期終止、ad-hoc 指令等變更入口都在交易內取得同一把鎖（`workflow-engine.service.ts` 中的 `pg_advisory_xact_lock` 呼叫）。
- 跨 instance 可平行（多 worker）。
- 本系統未使用 SERIALIZABLE 隔離等級。

```typescript
async function processInstance(instanceId) {
  await transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [instanceId]);
    // ... main loop（見 §2）
  }); // 交易結束時鎖自動釋放
}
```
