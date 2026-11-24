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
| **CANCELLED** | 發起人主動撤銷；管理員也可以撤銷（未發佈，見 `adminCancelApprovalInstance`）           | ✅   |
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
            // 例外：SET_FORM_FIELD 寫入的值不符合文字欄位的長度或格式規則時拋 400，
            // 觸發這一步的送出或簽核整筆回滾（WEBHOOK 失敗則只記 SERVICE_TASK_FAILED）。
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

邊條件以案件 `workflowSnapshot.expressionDialect` 的方言評估（缺少＝`cel-legacy`），不讀模板目前的版本；評估失敗不會當成
「不成立」而改走 default 邊，而是整個交易回滾（見 §9.2）。

唯一的例外（未發佈）：設計器建的邊（帶 `conditionFieldKey` ＋ `conditionOperator`）存下的 CEL 丟 `EXPRESSION_MISSING_KEY`
或 `EXPRESSION_TYPE_ERROR`，**且該欄位確實未填**（沒有 key、`null`、`""`、只有空白、空陣列）時，改由結構化欄位回答（缺 key 還要求缺的就是該欄位；型別錯誤退回時記一筆 warn），
未填的欄位讀作不符合（不等於／未填寫為 `true`，其餘為 `false`）。這是給沒碰過的選填欄位用的：舊定義的 CEL 讀不到 key 就丟例外。
CEL 能算出結果時一律採用；欄位已填卻仍出錯、手寫 CEL、預算超限、函式失敗都照常回滾。實際執行與 dry run 共用同一個判斷，
規則細節見 `docs/05` §5.1.1。

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
      // 沿主管鏈往上，直到某位主管的職等達 minPositionLevel（規則見 §4.1.1）；
      // 起點預設是 initiator，可用 startFrom 換成表單選的人或前面關卡的簽核者
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
- **起點（`startFrom`，可省略）**：鏈預設從申請人開始，`startFrom` 可以換成別人。起點本人**不在鏈上**
  （跟申請人一樣，從他的直屬主管開始爬），並先放進「已走過」名單。三種起點：
  - `{ type: 'INITIATOR' }`：申請人，等同省略。
  - `{ type: 'FORM_MEMBER', formPath }`：表單欄位 `formPath` 選的那一位人員，口徑同 `FORM_MEMBER_MANAGER`。
  - `{ type: 'NODE_ACTOR', nodeIds }`：前面指定關卡**實際按同意**的那一位，口徑同 `NODE_ACTOR`
    （代理人簽的算代理人；退回重簽取最新一輪；逾時自動核准、臨時加簽、已取消的任務不算）。

  起點必須是**一個人**：欄位選了多位、或指定關卡實際簽核的人不只一位，丟 `ConflictException`，
  不會默默挑一位（跟「同一層有多位主管」同一個原則）。起點沒有人（欄位是空的、指定關卡沒有同意紀錄）
  時走 `fallback`，原因文字會說明找不到起點；沒設 `fallback` 就丟錯，跟沒有主管同一條路。
  `excludeInitiator` 的略過照舊適用：申請人與代送人出現在別人的鏈上時一樣穿過不停；沒開
  `excludeInitiator` 時，申請人出現在鏈上就是一位普通的主管——起點不是申請人時，鏈可能爬到申請人本人，
  要防自簽就得開 `excludeInitiator`。`excludeInitiator`／`excludeNodeActors` 的
  `whenEmpty: 'INITIATOR_MANAGER'` 改派的永遠是**申請人**的直屬主管，不是起點那一位的主管。
- **起始職等（`startPositionLevel`，可省略）**：職等**低於**它的主管穿過不簽——不加入清單、不當停點、
  也不影響「最後一位已加入的職等」；第一位職等 `>=` 它的主管才開始加入，之後規則與上面相同。
  省略時第一位有職等的主管就開始簽。整條鏈都沒有人達到起始職等時走 `fallback`，原因文字寫出
  起始職等與簽到的職等。例：`startPositionLevel: 20`、`minPositionLevel: 30` 會略過職等 10 的課長，
  從職等 20 的主管簽到職等 30。
- **接續起點（`startFrom: { type: 'CHAIN_CONTINUATION', nodeId }`）**：簽核常見「主管鏈簽到某一級 → 插入別的關卡
  （例如人資會簽）→ 再接回主管鏈往上簽到核准者」。接續起點讓後面這一關知道前面那一關（下稱「前一段」S，本關稱 T 關）
  實際簽到哪一級：本關從 S 的起點往上走，**只簽比 S 實際已簽到的職等更高的主管**；S 已經有人簽到本關
  `minPositionLevel` 時，本關整關略過。
  - **起點**：用 S 自己的起點設定解析（`INITIATOR` 或 `NODE_ACTOR`），本關的鏈與 S 的鏈走同一條線。S 沒有起點
    （例如 S 的 `NODE_ACTOR` 起點找不到人）時，本關走自己的 `fallback`，原因文字沿用 S 的「找不到起點」；
    但這只在本關沒被略過時成立：略過判斷先跑，S 走 fallback 交給 40 職等的人同意、本關 `minPositionLevel` 是 40 時，
    T＝40，本關直接略過，不會走 `fallback`。
  - **怎麼算 T（S 已簽到的職等）**：讀 S 最新一批「真的同意」的紀錄（口徑同 `NODE_ACTOR`：最新一輪、不含臨時加簽、
    **不含 SLA 自動同意**），取其中**實際按同意的人**（含代理人、轉簽接手人；不算該席位原本的人）在**各自同意當天**的
    最高職等。日期用組織時區的日期（與「今天」同一個算法，不是 UTC 日期），所以簽完之後才升遷不會墊高 T；
    但職位本身的 `level` 沒有歷史，改職位的職等會影響已簽的紀錄，而且 host 調職要用「舊的 membership 設截止日、
    另開一筆」才查得到當天的職位。S 這一輪沒人真的同意（例如全是被自動同意）時，T＝null。
  - **S 被略過時 T＝null**：S 最近一次是被 `skipWhenStartReached` 略過（比 ActivityLog 的 `seq`：S 最新的
    `skippedByManagerChainReached` 略過紀錄比最新一筆非臨時任務的 `TASK_CREATED` 新），就不讀 S 上一輪的舊紀錄，
    T＝null。T＝null 時本關與一般主管鏈完全相同（同職等的主管仍會簽）。
  - **略過條件**：T 不是 null、而且 T `>=` 本關的 `minPositionLevel`，本關整關略過。
  - **走鏈**：沒略過時，從起點的直屬主管往上走，**職等 `<=` T 的主管穿過不簽**（等於把 T 當成「最後一位已加入的職等」）；
    本關的 `startPositionLevel`、`excludeInitiator`、`excludeNodeActors`、`fallback` 照常作用，走到頂、去重、
    多位主管丟 `ConflictException` 的規則與訊息都不變。只走一次，共用 `ORG_MANAGER_CHAIN_MAX_HOPS`。
  - **限制**：S 本身不能是接續型（不支援多段串接）；S 的起點只能是 `INITIATOR`／`NODE_ACTOR`（`FORM_MEMBER`
    退回重送時表單欄位可以被改掉，起點會換人而 T 仍是舊那個人鏈上的紀錄）；本關的 `minPositionLevel` 必須高於 S 的；
    本關不能設 `whenEmpty: 'INITIATOR_MANAGER'`（改派申請人直屬主管會無視 T）。T 的保證範圍是「本關被略過時，
    一定有人在那一輪真的按同意、而且當時職等已達本關的簽到職等」，**不保證那個人在申請人的直屬線上**：職等更高的
    代理人代簽、S 走到頂時的 `fallback` 人員、S 的 `INITIATOR_MANAGER` 改派，都會把 T 墊高。
- **略過條件旗標（`skipWhenStartReached`，布林，可省略）**：設 `true` 時，起點本人在**所有在職職務裡的最高職等**
  （執行當下現算）已經 `>=` `minPositionLevel`，本關整關略過，不建任務。起點沒有職等、或沒有起點時不略過，照
  上面的規則走。省略、`false`、`null` 與以前相同。不能與 `CHAIN_CONTINUATION` 同時設。
  - **略過紀錄**：兩種新設定的略過都不建任務、token 往下走（與 `SKIP_NODE` 同一條路：待生效的臨時加簽順延到下一個
    真正建任務的關卡；退回目標是被略過的關卡時 token 直接往下走），`TOKEN_ADVANCED` 的 payload 是
    `{ skippedByManagerChainReached: true, tokenId }`，**不含** `skippedByInitiatorExclusion`／
    `skippedByNodeActorExclusion`。
  - **只在建立簽核任務時有效**：接續與略過旗標需要「接續上下文」（起點、T、是否略過），由建立簽核任務時算出並傳給
    主管鏈解析；其他入口（知會收件人等）看到這兩個設定卻沒有上下文，會丟 `ConflictException` 指名拒絕，不會當成一般
    主管鏈算。臨時加簽、改派、轉簽的職等門檻、`SEQUENTIAL` 逐位推進不產生也不重新解析主管鏈，不受影響；試跑與設計器、
    AI 工具組支援（見下）。
  - **例：用人申請**（單位主管 `ORG_MANAGER_CHAIN { minPositionLevel: 30, skipWhenStartReached: true }` → 人資會簽
    → 核准 `ORG_MANAGER_CHAIN { minPositionLevel: 40, startFrom: { type: 'CHAIN_CONTINUATION', nodeId: '單位主管' } }`）。
    職等：10 課、20 部、30 處、40 營運長、50 總經理。

    | 申請人＝ | 往上依序                                 | 單位主管       | 核准                                        |
    | -------- | ---------------------------------------- | -------------- | ------------------------------------------- |
    | 部級     | 處級 → 營運長                            | 處級           | 營運長（T＝30）                             |
    | 部級     | 營運長（沒有處級）                       | 營運長         | 略過（T＝40）                               |
    | 部級     | 營運長（沒有處級），營運長逾時被自動同意 | 營運長（自動） | 營運長（T＝null，自動同意不算）             |
    | 處級     | 營運長                                   | 略過           | 營運長（T＝null）                           |
    | 處級     | 處級（同職等主管）→ 營運長               | 略過           | 處級、營運長（T＝null，與今天的主管鏈相同） |
    | 部級     | 處級 → 總經理（沒有營運長）              | 處級           | 總經理                                      |
    | 營運長   | 總經理                                   | 略過           | 總經理                                      |

    第五列若希望核准只找營運長以上，核准關另設 `startPositionLevel: 40` 即可。
- **知會節點**：`NOTIFY.recipients` 也可以用主管鏈，但只能從申請人開始（知會沒有前面的關卡，也不讀表單的人）：
  `startFrom` 只能省略或 `INITIATOR`（`CHAIN_CONTINUATION` 也不行），其他起點 publish 會被擋，執行時也會被拒絕。`startPositionLevel` 可用，`skipWhenStartReached` 不可用。
- **設計器**：選「主管鏈（簽到指定職等）」時多「從誰的主管開始」與「從職等幾開始簽」兩個設定（見
  `08-frontend-schema.md`）；起點的關卡選單不列可能有多位簽核人的關卡，知會節點不開放起點設定。起點多一個選項「接續前面某一段主管鏈」
  （「接續哪一關」只列通過接續來源檢查的上游主管鏈關卡），另有開關「起點本人已達簽到職等時略過此關」；兩者互斥，
  已選接續時開關停用，已開開關時接續選項的名稱會加上「（已勾選略過，不能同時使用）」。
- **讀的是案件上的快照**：引擎永遠讀案件的 `workflowSnapshot`，所以改了範本不會影響進行中的案件，
  進行中的案件也不會因升級而改變行為。兩個欄位都省略時，行為與錯誤訊息跟以前逐字相同。
- **相容性**：舊版引擎不認得這兩個欄位，會**安靜地照申請人起算**。升級到支援的版本之前，不要發佈用了
  這兩個設定的範本。本版引擎遇到自己不認得的 `startFrom` 類型（更新版本存的範本）會直接拒絕並指名，
  不會改從申請人起算。
  - `CHAIN_CONTINUATION` 是新的起點類型：支援 `startFrom` 但不認得它的引擎會指名拒絕，不會算錯。
  - `skipWhenStartReached` 是新欄位：不認得它的引擎會**安靜地忽略**、照舊執行（前一段可能多簽一位）。
    ⇒ 先升引擎，再發布用了新設定的範本。
  - 沒用新設定時，行為、錯誤訊息、試跑佔位字與以前逐字相同。
  - `NodeActorSourceSkipReason` 多一個成員 `managerChainReached`；下游若用
    `Record<NodeActorSourceSkipReason, …>` 做窮舉會編譯失敗。
- **Publish 檢查**：`minPositionLevel` 必須是整數；`userTask` 的 `decisionPolicy` 必須是
  `SEQUENTIAL` 或 `PARALLEL_ALL`，否則第一位主管簽完就會讓節點結案。另外：`startPositionLevel`
  必須是整數且不可高於 `minPositionLevel`；`startFrom` 的類型要認得、`FORM_MEMBER` 要有 `formPath`、
  `NODE_ACTOR` 要有 `nodeIds`；`FORM_MEMBER` 指到的欄位必須是**必填、永遠顯示、單選的人員欄位**
  （規則同 `FORM_MEMBER_MANAGER`）；`NODE_ACTOR` 指到的關卡必須存在、是簽核關卡、在這個節點的上游、
  不能被跳過、不在平行分支的不同路線上（規則同 `NODE_ACTOR`，用同一個 `readNodeActorSourceIssues`）；
  另外 `NODE_ACTOR` 起點指到的每個關卡都必須只會有一位實際簽核人：`decisionPolicy` 是 `PARALLEL_ALL`、
  `SEQUENTIAL`、`COUNT` 門檻大於 1 的 `QUORUM` 或任何百分比門檻的 `QUORUM` 就擋（除非該關卡只列了一位
  `DIRECT` 成員），因為最後一位簽核人按同意時引擎無法決定從誰起算，而那個 `ConflictException` 會丟在
  他自己的同意交易裡，使那次同意永遠無法 commit，範本改了也救不了進行中的案件。`NODE_ACTOR`／
  `NODE_ACTOR_MANAGER` 本身不受這條限制（它們取所有簽核人）。引擎執行時的 Conflict 保留給繞過 publish 檢查的舊資料。
  接續與略過旗標另有：`skipWhenStartReached` 必須是布林或 `null`；接續起點必須帶非空的 `nodeId`；兩者不能同時設；
  本關 `minPositionLevel` 必須高於 S 的；本關不能設 `excludeInitiator`／`excludeNodeActors` 的
  `whenEmpty: 'INITIATOR_MANAGER'`；知會節點兩者都不能用；S 必須存在、是 `userTask`、簽核來源是
  `ORG_MANAGER_CHAIN`、本身不是接續型、起點是 `INITIATOR`／`NODE_ACTOR`，且在本關上游、從開始到本關的每條路徑都經過它
  （`readChainContinuationSourceIssues`）；S 不能有 `entryCondition`、`SKIP_NODE`、`skipNodeByNodeActors` 的略過
  （這些情況下 S 這一輪沒跑，讀到的是上一輪的紀錄），但**放行** SLA 自動同意（不算進 T）與 `skipWhenStartReached`
  （讀略過紀錄）。可能被略過的關卡（設了 `skipWhenStartReached` 或起點是接續型）不能有可由簽核人補填的欄位，也不能當
  `NODE_ACTOR`／`NODE_ACTOR_MANAGER`／`startFrom: NODE_ACTOR` 的來源（略過原因
  `managerChainReached`）；`excludeNodeActors` 預設同樣不能列，host 開啟 `excludeNodeActorsAllowSkippableStages` 時才可以（§4.5：最近一次被略過就不排除任何人）。覆蓋與上游只在發布時檢查；引擎執行時只重做形狀、S 的型別與來源、S 不是接續型、S 的起點
  不是 `FORM_MEMBER`、本關職等高於 S，與不在知會節點，不合就 `ConflictException` 指名。
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
    （部分宿主沒有開啟 SLA 排程）。

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

沒有 `subject`、`task`、`template` 根識別字。儲存規則時會檢查根識別字，只允許上述六個；
不合法的規則不會被儲存。已經存在的錯誤規則不會被改動，執行期評估時仍會拋錯。

**委派條件的方言**（未發佈，Phase 23 P1）：規則自己帶 `scopeConditionDialect`（資料庫欄位 `delegation_rules.scope_condition_dialect`，
migration `DelegationScopeConditionDialect0000000030000` 把既有列設為 `cel-legacy`）。評估時讀規則本身的方言，與案件或模板的方言無關。
`CreateDelegationRuleInput.scopeConditionDialect` 可選，後端缺省是 `cel-legacy`，更新時沿用規則原本的方言；後台委派頁建立新規則時送 `cel-v2`。
儲存時以 `DELEGATION_CONDITION` 使用點 lint，cel-v2 規則必須回 bool，可以呼叫已註冊的宿主函式。

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

### 4.5 排除前面關卡的簽核者（`excludeNodeActors`）

職務分離的另一半：「信管審核」與「會計審核」不能是同一人。User Task 節點設定
`excludeNodeActors: { nodeIds, whenEmpty }` 後，**實際簽核過 `nodeIds` 所列前面關卡的人**
不能是這個節點的簽核人。省略此設定就完全沿用 4.3 的行為；runtime 讀的是
`instance.workflowSnapshot`，所以範本之後才開啟時，已經在跑的 instance 不受影響。

- **誰算「那一關的簽核者」**：與 `NODE_ACTOR`（§4.1）同一套讀法（`readNodeActorMemberIds`）：該關**最近一批**
  任務裡實際按下同意的人；不含加簽（ad-hoc）、不含取消的任務、不含 SLA 自動核准；代理人替人簽的，取實際按同意的
  代理人，**連同其委託人一起排除**（委託人是代理鏈上以規則代理委派出去的人；轉簽的轉出人不算，原指派人只在整條鏈都是規則代理時才算）；轉簽的，含接手並按同意的人。**差別有兩處**：
  - `NODE_ACTOR` 列了多個關卡時只取「最近實際走到的那一關」，排除則是**每個關卡各讀各的最近一次，再合併**——
    「不能與信管和資安兩關同一人」兩關都要排除。
  - **該關最近一次經過時是被略過的，就算沒人簽，不排除任何人**（`skippedByEntryCondition`（進入條件不成立）／
    `skippedByInitiatorExclusion`／`skippedByNodeActorExclusion`／`skippedByManagerChainReached` 其中一種），
    即使它更早一次有人簽過。`NODE_ACTOR` 沒有這一條，因為它要取一個簽核人，所以仍要求來源關一定有人簽。
    「最近一次」不等於「這一輪」：該關最近一次經過時有建任務，就照上面的讀法排除那一批實際核准的人；那一批沒人實簽
    （例如逾時自動核准）就是空的，不會退回去讀更早的批。
- **來源關必須是每條路徑都會經過的關卡（發布時檢查）；host 開啟 `excludeNodeActorsAllowSkippableStages` 時，也可以是有條件、可能被略過的關卡**：引擎讀的是來源關
  「最近一次」經過時的結果，沒有輪次邊界。最近一次被略過就當沒人簽（見上一條），所以來源關這一輪沒走到
  （進入條件不成立、被略過）時，不會讀到更早一次的簽核者；每個來源關各自都要通過位置檢查（見下方「發布檢查」）。
  能列：有進入條件（例：代墊款類別才走信管）、設了 `SKIP_NODE`、逾時自動核准、主管鏈起點已達就略過。
  不在每條路徑上的來源關仍不支援（走了別的分支時，這一輪沒經過那一關，會讀到更早一次的簽核者）：把那一關留在主線上、改設進入條件，
  或用分流把兩關放在同一條路線上。
- **退回重送**：來源關重跑時，讀的是它最近一次的結果，所以來源關重簽換成別人，排除的是新的簽核者，不是舊的。
  退回到來源關**下游**（`FROM_RETURN_POINT`）時，來源關不會重跑，**沿用它最近一次的結果**：最近一次有人簽，
  重送後本節點照樣排除他；最近一次是被略過，重送後仍不排除任何人。
- **建立待簽任務**：與 `excludeInitiator` 同一個步驟與順序：先解析、再套用 delegation，然後移除排除名單出現在
  其代理路徑上的候選人（代理前的 `originalMemberId`、`delegationChain` 任何一步的 `from`／`to`、或代理後的
  `memberId`）——被排除者把席位代理給別人，那個代理人也不能簽；候選人的代理人是被排除者，同樣拿掉。
  `ORG_MANAGER_CHAIN` 的走訪會越過被排除者往上，不會停在他身上。COUNT 門檻同樣降到剩下的人數。
- **兩個排除設定同時開**：兩組名單取聯集（申請人與代送人＋前面關卡的簽核者）。排除後沒有人時，先套用
  `excludeInitiator`；**只靠它就已經沒人**時看 `excludeInitiator.whenEmpty`，**它之後還剩人、被
  `excludeNodeActors` 排光**時看 `excludeNodeActors.whenEmpty`。
- **移除後沒有人時**依 `whenEmpty`，三個值與 §4.4 相同：
  - `FAIL`：丟出 `ConflictException`，不建立任務（訊息見下）。
  - `INITIATOR_MANAGER`：改派申請人的直屬主管；替補出來的人同樣不能是申請人、代送人或被排除的簽核者
    （查主管時越過他們往上一層）。找不到就丟 `ConflictException`。
  - `SKIP_NODE`：不建立任務，寫一筆 `TOKEN_ADVANCED` activity log
    （`payload: { skippedByNodeActorExclusion: true, tokenId }`；由 `excludeInitiator` 引起的仍是
    `skippedByInitiatorExclusion`），token 直接往下走。
  - 一開始就解析不出任何人仍是原本的錯誤，不套用 `whenEmpty`。
- **後門一起關**：
  - **手動轉簽**（`decideTask` 的 `TRANSFERRED`，含群組席位轉簽）：目標是被排除者，或目標與被排除者之間有代理關係（目標是被排除者的代理人，或目標把席位代理給被排除者，兩端任一在名單上）時回 `ConflictException`。
  - **臨時加簽／會簽**：指定對象只剩被排除者時回 `ConflictException`（時機同 §4.4）。
  - **依序簽（`SEQUENTIAL`）輪到下一位**：重新解析代理時，若新的代理路徑會經過被排除者，沿用建立時存下的值。
  - **管理員改派**（`reassignTask`／`reassignMemberTasks`）：接手人是被排除者時回報
    `TARGET_IS_EXCLUDED_NODE_ACTOR`，與 `TARGET_IS_INITIATOR` 並列；接手人與被排除者的代理關係同樣適用（判斷與手動轉簽相同）。
  - **SLA 升級轉派**（帶 `transferReason`）：與 `excludeInitiator` 一樣**不檢查**。
- **發布檢查**：`nodeIds` 非空、不重複、不含本節點、每一個都存在且是 userTask。之後**每一個來源關各自**要通過
  （不是「列表合起來蓋住每條路徑」就算過）。**預設**來源關要通過與 `NODE_ACTOR` 同一套的來源規則：
  - 不可能被跳過或沒人實簽：沒有進入條件、`excludeInitiator.whenEmpty` 與 `excludeNodeActors.whenEmpty` 不是
    `SKIP_NODE`、沒有逾時自動核准（`sla.onTimeout: 'AUTO_APPROVE'`）、主管鏈沒設起點已達就略過
    （`readNodeActorSourceSkipReasons` 的五種原因）；
  - 從 start 不經過這一個來源關就走得到本節點 ⇒ 擋（涵蓋所有分流與「任一分支到達即觸發」的合流；涵蓋判斷把平行閘道當成互斥閘道看）；
  - 在本節點的上游（有路徑走到本節點）。

  **host 可放寬**：`BPMRootModule` 設 `excludeNodeActorsAllowSkippableStages: true` 時，不套用第一條，可能被跳過的
  來源關也能發布（被跳過時不排除任何人，見上方「誰算那一關的簽核者」）。代價是職責分離變鬆：上一輪簽過被跳過
  關卡的人，這一輪可以簽本節點。預設不開，所以升級後行為不變。開啟的 host 要把同值傳給 `TemplateDesignerView`／
  `TemplateComposeWizardView` 的 `excludeNodeActorsAllowSkippableStages`（頁面 shim 讀
  `BPM_EXCLUDE_NODE_ACTORS_ALLOW_SKIPPABLE_STAGES=true`）。只有發布時讀這個選項，已發布的範本不會重新檢查。
  shared 的 `readExcludeNodeActorsIssues` 本身也預設嚴格（第四個參數 `allowSkippableStages: true` 才放寬），
  所以只把 shared 升到新版、引擎仍是舊版時，舊引擎的發布檢查照樣擋下它讀錯的範本。

  `whenEmpty` 必須是三個值之一；本節點有可由簽核人補填的欄位時不能選 `SKIP_NODE`。**不另外套用** `NODE_ACTOR`
  「兩個來源不能在平行分支的不同路線上」那一條；但平行分支上的來源關目前仍會被上面的涵蓋規則擋下
  （涵蓋判斷把平行閘道當成互斥閘道看，與 `NODE_ACTOR` 是同一個限制），要改成先後串接。
  與 `NODE_ACTOR` 的差別：措辭（訊息講「排除」）、逐一檢查，以及 host 可放寬「不可能被跳過或沒人實簽」那一半
  （`NODE_ACTOR` 一律擋）；涵蓋與上游兩條是同一份程式（共用的位置檢查）。
- **Dry run**：前面關卡誰簽，在試跑時不知道，所以不模擬這個排除，也不會因它停止；只有同時開的
  `excludeInitiator` 照 §4.4 的規則試跑。

新的錯誤訊息（下游若做翻譯表請一併加入；`{節點}` 是簽核節點名稱，`{關卡}` 形如 `關卡「信管審核」`，多個以「、」連接）：

- `簽核節點「{節點}」 無法建立待簽任務：解析出的簽核人只剩前面{關卡}的簽核者（含委派後的代理人），此節點不允許與前面關卡的簽核者為同一人。`
- `簽核節點「{節點}」 無法建立待簽任務：解析出的簽核人只剩前面{關卡}的簽核者，此節點不允許與前面關卡的簽核者為同一人，且找不到申請人的主管可改派。`
- `{臨時加簽／臨時會簽}「{節點}」 無法建立任務：指定對象只有前面{關卡}的簽核者，此節點不允許與前面關卡的簽核者為同一人。`
- `簽核節點「{節點}」不允許與前面關卡的簽核者為同一人，不能將任務轉交給前面{關卡}的簽核者`
- 管理員改派 `TARGET_IS_EXCLUDED_NODE_ACTOR`：`此節點不允許與前面關卡的簽核者為同一人，接手人不能是前面關卡的簽核者`

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

節點也可設定 `requireApprovalComment: true`（designer：核准時意見必填），此時**人**按同意時
必須帶非空白意見，否則引擎回 `BadRequestException`
（「此節點要求同意時填寫意見，請輸入意見後再同意。」）。同樣讀 instance 的
workflow snapshot，模板事後才打開不影響在途案件；省略等同 `false`。加簽任務（臨時會簽、
臨時加簽）掛在主節點上，簽核人同樣受此限制；SLA 逾時自動同意（`AUTO_APPROVE`）是系統動作，
不要求意見。

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

`reassignMemberTasks` 可帶選填的 `taskIds`，只改派指定的那幾張；不帶（或 `null`）就是此人手上全部的開放待辦，跟原本一致。
`taskIds` 為空陣列時，service 直接丟 `BadRequestException`、不讀也不寫任何東西（不靠 `ValidationPipe`），絕不會被當成「全部」。
`taskIds` 裡不在此人手上的 id（已被處理、案件已結束、不存在）不產生結果列也不丟錯，其他張照常處理。
先升 server，再升畫面：新畫面搭舊 server 時，帶 `taskIds` 的請求會被 GraphQL 拒絕（未知欄位）。

### 5.5 往下走失敗的記錄

未發佈（v0.21.4 之後）。決策或重送在「往下一關」這一步失敗時（例如下一關解析不出簽核人），整筆交易回滾，
決策失敗時 task 仍開著；重送失敗時案件仍是退回狀態。為了讓管理員看得到卡住的案件，失敗會另記一筆 `ADVANCE_FAILED` 活動紀錄。

- **三個包裝點**，都包在公開方法的呼叫端，不包進 `processRunningInstance`／`returnInstanceToNode` 內部
  （送單與管理員重跑也呼叫它們，必須維持丟出原本的錯誤類別）：
  1. `decideTask` 同意後，從讀 token 到 `processRunningInstance` 這一段（`kind: 'DECISION'`、`action: 'APPROVED'`）；
  2. `decideTask` 退回時的 `returnInstanceToNode`（`kind: 'DECISION'`、`action: 'RETURNED'`）；
  3. `resubmitApprovalInstance` 的 `processRunningInstance`（`kind: 'RESUBMIT'`）。
- **只記狀態碼 < 500 的 `HttpException`**。5xx 通常重試就會好，一般 `Error` 可能帶 SQL，兩者都照舊丟出、不寫入。
- **交易外另寫一筆**：包裝點把錯誤包成內部的 `InstanceAdvanceFailure`，交易回滾後由 `decideTask`／`resubmitApprovalInstance`
  在 `runEngineTransaction` 外面接住，另開一筆交易，先取 `pg_advisory_xact_lock(hashtext(instanceId))`，去重後寫入，
  最後把原始錯誤原封不動丟回去；`InstanceAdvanceFailure` 不會離開公開方法。寫入本身失敗只記 logger 警告，不蓋掉原始錯誤。
  payload 有 `kind`、`taskId`、`nodeId`、`action`、`automatic`（逾時自動同意為 `'SLA_AUTO_APPROVE'`，否則 `null`）、`message`；
  `actorMemberId` 是操作者，逾時自動同意那一類是系統代選的持有人，並不是他按的。
- **去重**：同一案件已有一筆「尚未解決」、種類相同且 `message` 相同的紀錄，就不再寫。`DECISION` 的鍵是 task＋操作者＋action
  （會簽時不同的人各留一筆）；`RESUBMIT` 一個案件只有一個鍵。同一個人換了失敗原因就是新消息，會再寫一筆。
- **「尚未解決」的判定**（不看 `TASK_DECIDED`，會簽時前面的人已提交過）：
  - `DECISION`：該 task 仍是開著的，而且案件仍是 `RUNNING`。task 完成、被退回取消、案件終止，或一般 task 被轉簽（原 task 變
    `TRANSFERRED`，另開新 task），都算已解決；轉簽後先從清單消失，新持有人若再失敗會寫一筆新紀錄、重新出現。
  - `RESUBMIT`：案件仍是 `RETURNED`，而且之後沒有 `INSTANCE_RESUBMITTED`。
  - 一個案件只取最新一筆未解決的紀錄，列在 `stuckApprovalInstances`（管理員專用）。一律分頁：`page` 預設 1、`pageSize`
    預設 20、上限 100；總數由 `stuckApprovalInstanceCount` 提供。
- **未涵蓋**：
  - 往下走時丟出一般 `Error`（快照畸形的 `TypeError`、host 掛進來的 provider 丟的錯）也會讓案件卡住，但不會被記錄。
  - 運算式時間預算超支（`EXPRESSION_BUDGET_EXCEEDED`）是 400，所以會被記成卡住；時間預算算的是實際經過時間，
    主機負載高時也可能觸發，那時其實只是暫時性錯誤。
  - 群組任務只要有人投過票（包括不讓任務完成的那一票），`assigneeMemberId` 就會被設成投票的人，之後 SLA 自動同意代選到的就是
    這個已投過票的人，在驗證階段被拒。這是既有行為，失敗發生在包裝點之前，所以不會被記錄，也不會出現在清單上。

### 5.6 取回重辦（簽核者取回）

模組選項 `signerRecallEnabled` 開著時，簽核人最近一次的**人工核准**，如果讓自己那一關結束、token 單線走到下一個人工關卡，
而且之後沒有任何人做任何決定、也沒有發生下方白名單以外的事，簽核人就可以取回。取回後，下一關的任務取消，
取回者那一關重新開一張**只給取回者本人**的任務。選項預設 `false`（見 `docs/11-consumer-quickstart.md` §2f）。

入口：mutation `recallTaskApproval(input: RecallTaskApprovalInput!)`（取回者一律是登入者，不從 input 讀）、
query `recallableTaskId(instanceId)`（回目前可取回的任務 id 或 `null`，前端用它決定要不要顯示按鈕）、
service 方法 `WorkflowEngineService.recallTaskApproval`／`readRecallableTaskId`。
下面的「准不准」判斷在 `signer-recall-planner.ts`，是引擎內部的函式，不是公開 API。

本節的記號：

- `M`：取回者核准的那一關。`X`：取回者在 M 的任務。`D`：X 上那一筆核准決策。
- `T`：承載這次核准的 token。`N`：T 現在停的節點（下一關）。
- `s0`：D 的 `TASK_DECIDED` 活動紀錄的 `seq`，用 `payload.decisionId === D.id` 找。

#### 5.6.1 准不准：檢查順序

planner 依下表順序檢查，第一條不過就回它的碼；全部通過才回一份取回計畫（X、D、s0、T、N、要取消的任務 id、要照抄的候選人列）。
拒絕時的碼都以 `SIGNER_RECALL_` 開頭（例如 `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` 的完整值是
`SIGNER_RECALL_STAGE_NOT_SETTLED_BY_THIS_APPROVAL`），常數是 shared 套件 `status` subpath 的 `SIGNER_RECALL_ERROR_CODES`。

| 順序 | 檢查 | 不過時回的碼 | 為什麼 |
| --- | --- | --- | --- |
| 1 | R0：呼叫端傳入的 `enabled` 為真（service 建構時以 `signerRecallEnabled === true` 算出） | `DISABLED` | 預設關。開關共三道，見 §5.6.5 |
| 2 | 單一核准：X 上的決策**恰有一筆 APPROVED（即 D），其餘全部是 TRANSFERRED** | `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` | 群組席位轉簽會把轉出者的 `TRANSFERRED` 決策留在同一張任務上，它不是票，所以放行。「其餘全是 TRANSFERRED」擋的是 REJECTED／RETURNED 與 APPROVED 並存的任務；引擎產生不出這種狀態（非同意的決定會立刻結束本關），所以它只是縱深。沒有 D 就無法往下判，所以這條不能整條拿掉 |
| 3 | R1：`D.decidedByMemberId` 是發出取回的人 | `NOT_THE_SIGNER` | 只有簽的那個人能取回。代理人代簽時 D 是代理人，本人取回會被這條擋 |
| 4 | R12：X 沒有被取回過，也就是沒有 `eventType = TASK_RECALLED` 且 `taskId = X` 的紀錄 | `ALREADY_RECALLED` | 連按兩次時給正確的說法。`taskId = X` 不能省：取回、重簽、再取回時，案件上已有前一輪 X 的 `TASK_RECALLED`，新一輪的 X 是另一張任務 |
| 5 | R2：找得到 s0，而且那筆紀錄沒有 `payload.automatic` | `NOT_A_PERSONAL_APPROVAL` | SLA 自動核准用系統代選的真人 id 寫決策，只能靠 `automatic` 分辨。找不到 s0（例如舊資料沒帶 `decisionId`）就無法證明是人工核准，所以擋 |
| 6 | R3：案件狀態是 `RUNNING` | `INSTANCE_NOT_RUNNING` | 結案、取消、逾期、退回申請人都不准 |
| 7 | R4a：`X.status === COMPLETED` | `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` | 依序簽或會簽時，取回者核准後本關可能還沒結束 |
| 8 | R4b：(T, M) 上所有非臨時任務（含 X，以及因轉簽而變 `TRANSFERRED` 的前身任務）的決策，除了 D 以外沒有任何 `APPROVED` | `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` | 依序簽的最後一席被轉簽或 SLA 升級時，前幾票留在已 `TRANSFERRED` 的原任務上，而排除名單（`excludeNodeActors`）讀的是 (節點, token) 這一整批。只看 X 的話，取回後新 token 的一批只剩取回者，前幾位就從排除名單消失 |
| 9 | R5：X 不是臨時任務，而且 (T, M) 上沒有任何臨時任務（不論狀態） | `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` | 臨時任務有自己的放行閘門，取回只重建主任務。終態的臨時任務其實不會讓任何票被遺忘，仍擋是保守的做法 |
| 10 | R11：X 上有取回者本人的候選人列：`memberId === D.decidedByMemberId` 而且 `status === COMPLETED` | `STAGE_NOT_SETTLED_BY_THIS_APPROVAL` | 重建座位要照抄這一列。正常情況核准時一定有；鍵用 `D.decidedByMemberId`，不用傳進來的 memberId，代理代簽時候選人列存的是代理人 |
| 11 | R13：取回者那一列的**原始** `delegationChain` 是空的，或鏈尾是已知的手動轉移 | `DELEGATED_SEAT` | 放行名單與理由見 §5.6.3 |
| 12 | R14：M 上沒有「這次核准時送出的」階段通知：同案件、`originNodeId = M`、`type = STAGE_NOTIFY`、`status = CONSUMED`、`consumedAt >= D.decidedAt` 的臨時指令不存在 | `STAGE_NOTIFY_SENT` | 見 §5.6.7 |
| 13 | R6：案件上 `seq > s0` 的活動紀錄，全部落在白名單內（§5.6.2） | `NEXT_STAGE_ACTED` | 白名單外一律擋（fail closed）：上游以後新增的事件類型，自動算成「有人動過」 |
| 14 | R7：整張單開著（`ACTIVE`／`WAITING`）的 token 只有 T；T 是 `WAITING`；N 不是 M；N 在案件快照裡找得到而且是 userTask | `NEXT_STAGE_NOT_SINGLE` | 也擋：M 在平行分支上而兄弟還開著、T 停在 AND 匯流等人、T 已因分流被 consume、T 走到結束 |
| 15 | R8：整張單開著（`PENDING`／`IN_PROGRESS`）的任務只有一張：非臨時、`tokenId = T`、`nodeId = N` | `NEXT_STAGE_NOT_SINGLE` | 擋 N 正在臨時加簽：會簽在 N 建任務時就生出臨時任務，它的 `TASK_CREATED` 在白名單內，所以靠這條擋 |
| 16 | R9：T 經過的節點（含 N，扣掉 M）沒有 serviceTask；在快照裡找不到的節點也當不准 | `PASSED_SERVICE_TASK` | WEBHOOK 已送出、撤不回，而且它的結果紀錄在 commit 之後才寫，不能靠紀錄判斷；`SET_FORM_FIELD` 改過表單，取回不還原。知會節點（`NOTIFY`）不會出現在 T 的路徑上：它不能接出線，只能是從某一關岔出去的側支，所以 M 後面接知會時 T 已因分流被 consume，由 R7 先擋。被跳過的服務任務其實沒有副作用，仍擋是保守的做法 |
| 17 | R10：`T.parentTokenId === null`，或 T 經過的節點（含 N）都沒有兩條以上的入邊 | `PASSED_JOIN` | 子 token 走過匯流點時，兄弟已被 consume、不留紀錄；OR 匯流還會取消別條分支的任務，取回救不回來。同分支內的互斥匯合也會被擋 |

**T 經過的節點**：`seq > s0`、`payload.tokenId === T` 的 `TOKEN_ADVANCED` 紀錄裡出現的 `nodeId`、`payload.fromNodeId`、`payload.toNodeId`，扣掉 M。

**為什麼只看 `seq > s0` 是安全的**：activity log 的 `seq` 由資料庫在 insert 時配號，晚 commit 的列可能拿到較小的號，
所以「`seq > 游標`」一般會漏資料。這裡不會因此放行：

- 會改動 N 的入口都先拿同一把案件鎖（見 §10）。D 的交易持有這把鎖直到 commit，所以這些入口一定在 D commit 之後才 insert，配到的 `seq` 一定大於 s0。
- 不拿案件鎖的寫入點有：`SLA_TRIGGERED`、NOTIFY 背景投遞的結果、管理員重送、commit 之後才寫的 WEBHOOK 服務任務結果與臨時 webhook 通知結果。
  它們可能拿到小於 s0 的號而被漏看；但這些紀錄要嘛在白名單內，要嘛是 T 路上的 WEBHOOK 結果、由 R9 涵蓋。漏看它們不會讓結論從「擋」變成「准」。
- 比較 `seq` 一律轉成 BigInt。

**讀取方式**：planner 的讀取只用等值條件與 `In`，時間與 `seq` 的比較都在程式裡做。每一支查詢都帶 `instanceId`，或帶一個只屬於這張單的 id
（任務、token、決策）；`nodeId`／`originNodeId` 是範本節點 id，同範本的每張單都一樣，不能單獨當條件。

#### 5.6.2 R6 白名單

`seq > s0` 的紀錄只有下列幾種可以出現。每一項都是「它發生了，也不代表有人對下一關做了決定」：

| 紀錄 | 條件 | 為什麼安全 |
| --- | --- | --- |
| `TOKEN_ADVANCED`、`TOKEN_CREATED`、`TASK_CREATED` | 無 | 純移動紀錄；結構另由 R7～R10 判 |
| `SLA_TRIGGERED` | 無 | 只是提醒。逾時動作若是自動核准或升級，會另寫 `TASK_DECIDED`；終止案件由 R3 擋 |
| `ENGINE_PROCESS_REQUESTED` | 無 | 管理員重跑，不是決定 |
| `ADVANCE_FAILED` | 無 | 那次決定已經回滾，這筆紀錄是唯一的痕跡，任務仍開著，沒有人做過決定。副作用：取回會取消 N 的任務，而卡住清單只列「失敗紀錄的任務還開著」的案件，所以那張單取回後會從卡住清單消失 |
| `SERVICE_TASK_EXECUTED`、`SERVICE_TASK_FAILED` | `payload.action` 是 `ADHOC_WEBHOOK` 或 `ADHOC_NOTIFY`，不限節點 | 這兩種紀錄只來自階段通知或結案通知的投遞。階段通知只在決定、駁回、退回時發，結案通知只在結案時發；對應的決定本身會寫 `TASK_DECIDED`，結案由 R3 擋。所以較早關卡的通知晚到，不代表有人動過下一關。M 自己這次的階段通知由 R14 處理 |
| `SERVICE_TASK_EXECUTED`、`SERVICE_TASK_FAILED`、`WEBHOOK_DELIVERY_RETRIED` | `payload.action === 'NOTIFY_WEBHOOK'`，不限節點 | NOTIFY 節點的投遞結果，背景投遞在重試結束後才寫；管理員重送寫 `WEBHOOK_DELIVERY_RETRIED`，所以這一列不看 actor。T 路上若有 NOTIFY 節點，R9 另外擋 |
| `SERVICE_TASK_EXECUTED`、`SERVICE_TASK_FAILED` | `payload.action === 'WEBHOOK'`，而且 `nodeId` 不是 null、也不在 T 經過的節點裡 | M 之前的 WEBHOOK 服務任務，結果在 commit 之後才寫，對方回應慢時會晚於 s0 落地；它是較早的副作用，不是決定。T 路上的由 R9 擋。`nodeId` 是 null 的一律擋（fail closed） |
| `ADHOC_DIRECTIVE_CANCELLED` | `actorMemberId` 是 null | 寫這筆、actor 為 null 的只有一處：N 建任務時會簽對象解析失敗。建立者自己取消的那一處一定帶 actor，所以能安全辨認 |
| `ADHOC_DIRECTIVE_CANCELLED` | `actorMemberId` 是取回者本人，而且 `payload.directiveType === 'COMPLETION_NOTIFY'` | 核准之後取回者手上還可能 `PENDING` 的指令只剩結案通知（自己的會簽在 N 建任務時已被消耗，自己的階段通知在核准時已消耗）。取消它不牽涉 N |

白名單外的典型例子，全部會被擋：

- `TASK_DECIDED`：任何決定，含轉簽、SLA 自動核准與升級。
- `TASK_CANDIDATE_ACTIVATED`、`TASK_REASSIGNED`（管理員改派）。
- `ADHOC_DIRECTIVE_CREATED`：任何人在 s0 之後下的臨時指令，包括 N 的持有人只下通知指令。
- 其他人（含 N 的持有人）取消指令的 `ADHOC_DIRECTIVE_CANCELLED`；取回者取消非結案通知的指令。
- `TASK_RECALLED`、`INSTANCE_*`。
- `SET_FORM_FIELD` 的 `SERVICE_TASK_EXECUTED`；T 路上 WEBHOOK 的結果。

#### 5.6.3 R13 的放行名單與 fail closed

取回者那一列的候選人鏈，**放行只有兩種**：

1. 鏈是陣列而且長度為 0。
2. 鏈是陣列，最後一個元素 L 是非 null、非陣列的物件，而且同時滿足：
   - `L.reason` 是字串，而且嚴格等於 `MANUAL_TRANSFER`（整張轉簽與座位轉簽在 host 沒傳 `transferReason` 時用它）
     或 `ADMIN_REASSIGN`（管理員改派）。不 trim，大小寫須完全相同。
   - `L.ruleId` 是 null 或缺這個鍵。`ruleId: ''` 不算 null，擋。
   - `L.to` 嚴格等於 `D.decidedByMemberId`（R1 通過後就是取回者）。

其餘一律回 `DELEGATED_SEAT`，包括：鏈不是陣列；L 是 null、陣列或原始值；L 缺 `reason`，或 `reason` 是空字串、前後有空白、不是字串；
`ruleId` 非空的代理規則步驟（它的 `reason` 是規則的 `scopeType`，本來就不在名單內）；`reason` 是 `SLA_ESCALATION`；
host 經 `DecideTaskOptions.transferReason` 傳的**任何自訂 reason，包括空字串**。不新增碼。

理由：

- **只看鏈尾**：對齊引擎自己判斷「誰是代理對象」的寫法，只取鏈尾連續的規則步驟。三種轉移（整張轉簽、座位轉簽、管理員改派）
  都把新步驟接在原鏈後面，所以「代理人把單人關卡轉簽給取回者」時鏈是 `[規則步驟, 轉簽步驟]`，鏈尾是轉簽，放行。
- **讀原始鏈、不正規化**：正規化會把缺欄位的步驟整步丟掉，鏈尾缺 `reason` 時鏈會退成前一步甚至變空，反而放行，與 fail closed 相反。
  取回後照抄鏈用的也是原始鏈。
- **要查 `to`**：R11 只比列的 `memberId` 與 `status`，「單一核准」那條只看決策，沒有任何一條會看鏈尾的 `to`。引擎寫的列兩者一定相同，
  但那只是寫入時的不變式，非引擎寫入的列可以不同。
- **名單而不是黑名單**：host 可以用公開的 `transferReason` 傳任何字串，空字串也不會被 `??` 補成預設值，原樣寫進鏈尾。只放行兩個已知值才是 fail closed。
  名單外的 reason 擋是保守預設，要不要放寬是產品決定。

鏈中段的規則步驟與 SLA 升級步驟會被照抄到新任務（原樣抄原始鏈）。這裡有一個已知的延期風險：SLA 掃描看的是**任務層**的鏈有沒有升級步驟。

- 單人任務或整張轉簽：X 的任務鏈等於候選人鏈，X 本來就不會再升級，照抄後新任務相同；但 `slaDueAt` 從取回當下重算，逾時動作因此往後延。
- 群組座位：SLA 升級與座位轉簽一定接在候選人列上，但只有轉出者剛好是**任務層的持有人**（`assigneeMemberId`）時，才會同時接到任務鏈上；
  群組任務開著時任務層沒有持有人，一旦有人投過票，持有人就會被設成投票的人。所以任務層沒有持有人時，X 的任務鏈仍是空的、X 還會升級；
  照抄到新的單人任務後，新任務的鏈帶著 SLA 步驟，永遠不會再升級，比 X 更不會升級。轉出者就是任務層持有人時，X 的任務鏈本來就有這一步，與上一種情況相同。

#### 5.6.4 取回後的狀態（鎖內、同一個交易）

1. **開關關著**時，mutation 在查任務、拿鎖**之前**就丟 409 `SIGNER_RECALL_DISABLED`，所以開關關著時任務不存在也是 409，不是 404。
   開關開著而找不到任務，回 404（`NotFoundException`）。
2. 先讀任務取得 `instanceId`，拿 `pg_advisory_xact_lock(hashtext(instanceId))`，鎖後 planner 會把任務與案件重讀一次再判，所以判的是鎖後的狀態。不過就丟 `ConflictException`，body 是
   `{ code, error: 'Conflict', message, statusCode: 409 }`；`message` 是英文，給 log 用，畫面文案請 client 依 `code` 自己對照。
3. 把整張單開著的 token 設成 `CONSUMED`，開著的任務（只會有 N 的那一張）設成 `CANCELLED`，候選人跟著 `CANCELLED`。
   planner 已保證整張單沒有別的開著狀態。
4. 把這張單上尚未處理的待簽通知作廢：`resolution` 設成 `SUPERSEDED`、狀態設成 `READ`，不分管道，也不只限 N 的；
   所以還卡在勿擾時段或每日彙整的待簽 email 不會再寄（寄送掃描只撿 `PENDING` 的列）。
   可作廢的類型只有 `TASK_ASSIGNED`、`TASK_TRANSFERRED`；**N 的 SLA 預警與逾時通知不在其中**，卡在勿擾時段或彙整佇列的仍會寄出。
5. 寫 `TASK_RECALLED`：`actorMemberId` 是取回者，`nodeId` 是 M，`taskId` 是 X，payload 是
   `{ decisionId, recalledTaskId, cancelledNodeId, cancelledTaskIds, comment }`；`comment` 去頭尾空白後為空就存 `null`。只放 id 與意見，不放表單值。
6. **開一個新 token**：`currentNodeId = M`、`status = WAITING`、`parentTokenId` 沿用 T 的。寫 `TOKEN_CREATED`，payload 帶 `tokenId`（新 token）、`recalledFromNodeId`（N）與 `recalledTaskId`。
   原因是排除名單以 (節點, token) 分批。沿用舊 token 時，取回者重簽後的核准會跟 X 上的 D 落在同一批，D 在重簽之前就被算進 M 的核准；
   例如取回後把新任務轉簽給同事、同事核准，N 若排除 M，取回者也會一起被排除。開新 token 之後，M 的最新一批只有新任務上的核准。
7. **直接替取回者建任務**（不重跑解析）：`assigneeMemberId` 是取回者、`assignmentType = DIRECT_MEMBER`、`decisionPolicySnapshot = { type: 'SINGLE' }`、`isAdhoc = false`；
   `originalAssigneeMemberId` 與 `delegationChain` 抄 X 上取回者那一列；`slaDueAt` 照節點的 SLA 設定從現在重算；`createdAt` 是本次的時間（「最新一批」以最大的 `createdAt` 判，
   所以不能比 X 早）。候選人一列：`memberId`、`originalMemberId`、`delegationChain`、`sourceType` 抄取回者那一列，狀態 `PENDING`。
   - 寫 `TASK_CREATED`（payload 多一個 `recalledTaskId`，`actorMemberId` 是取回者）。**必須寫**：主管鏈與其他「上一輪是建任務還是跳過」的判斷，都拿 `TASK_CREATED` 的 `seq` 比。
   - 寫案件事件 `NODE_ACTIVATED { nodeId: M, taskIds: [新任務] }`，並對取回者發 `TASK_ASSIGNED` 通知。
8. **不做**：`processRunningInstance`（M 不重新進關）、`spawnCountersignTasksForNode`、`dispatchAdhocStageNotifications`、`cancelPendingAdhocDirectives`（只剩結案通知指令，保留）、
   host 的決策前檢查（instance guard）、簽章。也不包 `ADVANCE_FAILED` 的記錄：取回不解析簽核人，沒有「往下走失敗」可記。

M 的節點在案件快照裡找不到 userTask 時，寫入側會丟 409（訊息是 `Workflow node … was not found`），**這個 409 不帶 `SIGNER_RECALL_` 碼**。
planner 不檢查 M 的型別；這條走不到靠的是資料不變式：非臨時任務只建在 userTask 上（建任務的函式只在 userTask 分支呼叫；其餘建任務的路徑都沿用既有任務的 `nodeId`：轉簽、取回，以及臨時前加簽被駁回後重開原任務）。
保留它只是型別守衛與 fail closed。

X 維持 `COMPLETED`，D 與它的簽章原樣保留。歷程呈現「核准、取回、新任務」；簽核歷史列表仍會把 X 顯示成已核准。

#### 5.6.5 刻意重疊的縱深

下列檢查彼此重疊：**拿掉其中一道，准或擋的結論不變**（碼相同，或另一道會接手擋），這是刻意的縱深。差別只在回的碼或例外，下面逐條寫明。唯一的例外是最後的 R13 形狀檢查，它不是重疊：拿掉會讓不合形狀的資料丟例外。

- **開關有三道**：query 一開頭就回 `null`、mutation 在查任務與拿鎖之前先擋、planner 的 R0。拿掉 planner 的 R0 時，只有直接呼叫 planner 的人會發現；
  拿掉 query 的短路時，對存在且可讀的案件，planner 的 R0 仍回 `DISABLED`，query 照樣回 `null`；
  但未知或不可讀的 `instanceId` 會從回 `null` 變成丟 404，因為 `readRecallableTaskId` 之後會先讀案件（`getApprovalInstance`）。
  mutation 那一道另有可觀察的效果：開關關著時，不存在的任務 id 是 409 而不是 404。
- **「單一核准」與 R4b**：「同一關有別人的核准」由兩處各自擋下，碼相同。「單一核准」擋 X 自己有兩筆 `APPROVED`；R4b 擋同一關其他任務上的核准。
  把「單一核准」放寬成「改取取回者自己的那一筆」時，結論不變，因為 R4b 接手擋；只有這一個缺陷時，碼也相同（若同時有別的缺陷，中間的 R12、R2、R3 可能先回自己的碼）。
- **R7 與 R8**：平行分流、兄弟分支還開著這類情形，兩條都會擋，碼相同；只有「兄弟已停在匯流點、沒有開著的任務」只有 R7 擋得到，
  「N 正在臨時會簽」只有 R8 擋得到。
- **R9 與 R6 的 WEBHOOK 條件**：T 路上的 WEBHOOK 結果，結果紀錄已經寫進來時由 R6 先擋（回 `NEXT_STAGE_ACTED`，R6 的順序在 R9 前面）；
  結果還沒寫進來時（WEBHOOK 在 commit 之後才寫結果）只有 R9 擋（回 `PASSED_SERVICE_TASK`）。所以 R6 白名單裡「不在 T 經過的節點」這個條件拿掉時，
  仍然是擋，只是碼不同。
- **R13 的 `typeof L.reason === 'string'`**：與後面的嚴格相等重疊。之後本來就是跟兩個字串比，非字串不會相等，所以拿掉它行為完全相同。
- **R1、R4b 與 R13**：代理人代簽、本人要取回時，R1 回 `NOT_THE_SIGNER`；拿掉 R1 仍是擋，因為座位的鏈尾是規則步驟，R13 接手，碼變成 `DELEGATED_SEAT`。
  依序簽的最後一席被 SLA 升級給取回者時，R4b 回 `STAGE_NOT_SETTLED_BY_THIS_APPROVAL`；R4b 若改成只看 X，R13 接手（鏈尾是 SLA 步驟），碼同樣變成 `DELEGATED_SEAT`。
- **R13 的形狀檢查**（鏈是陣列、鏈尾是非 null 的物件）不是重疊，它的作用是讓**不合形狀的資料回碼，而不是丟 `TypeError`**（上線會變成 500）；
  拿掉它，這類資料不再回 `DELEGATED_SEAT`，而是丟例外。
- **R4b、R5 的查詢**：兩條共用同一支關卡任務查詢，條件是 `instanceId`、`nodeId`、`tokenId` 三個等值。`tokenId` 本身就只屬於這張單，
  所以另外加的 `instanceId` 是縱深，拿掉後行為不變；有意義的漏法是只用 `nodeId` 查，同範本別張單停在 M 的任務會被算進來。

#### 5.6.6 為什麼直接建任務、不重跑解析

| | A. 開新 token 後重跑 `processRunningInstance` | B. 直接替取回者建任務（採用） |
| --- | --- | --- |
| 誰拿到任務 | 重新解析：可能換人、可能整群候選人都回來 | 只有取回者 |
| 進入條件 | 重算。取回者當初補填的欄位可能讓 M 這次被跳過，token 直接往下衝 | 不重算 |
| 排除規則、主管鏈 | 重算，可能因此被跳過 | 不重算。M 之前的關卡沒變，算出來也會一樣 |
| 失敗模式 | 解析失敗會丟錯，要包 `ADVANCE_FAILED` | 沒有解析，不會失敗 |
| 後果 | 任一人簽即可的關卡，同事也拿得到 | 任一人簽即可的三人關卡，另外兩人的座位不會回來（他們本來就沒動作） |

這是設計取捨，不是規則的字面要求：取回的語意是「讓我自己重辦」，所以只給取回者。

#### 5.6.7 收不回的東西與階段通知（R14）

- **表單欄位不還原**：引擎只記錄改了哪些欄位，不記舊值，案件的表單資料是直接覆寫。取回者重簽時會再過一次補填驗證，可以改值。選項快照同理。
- **已寄出的 email、webhook 收不回**；host 的通知觀察者也不會被告知「作廢」，跟撤回案件相同。取回不另外通知 N 的人與申請人。
- **host 要重讀任務**：取回只發 `NODE_ACTIVATED`（回到取回者那一關），不發 `INSTANCE_RETURNED`；N 被取消的任務沒有對應事件，
  host 收到 `NODE_ACTIVATED` 時要重讀該案件的 tasks（見 `docs/10-bpm-embedding-auth.md`）。
- **M 的階段通知已送出時不准取回（R14）**：核准的當下已對外送出「階段已通過」的通知，收不回，所以擋。站內通知成功時不寫歷程，
  只能看臨時指令表裡 `STAGE_NOTIFY` 那一列的 `consumedAt`。時間條件不能省：退回後重簽時，前一輪消耗掉的階段通知仍是 `CONSUMED`，不能因此永遠擋。
  查詢帶 `instanceId`：`originNodeId` 是範本節點 id，不帶的話同範本另一張單較晚送出的階段通知會誤擋本單。
- **取回意見**：`comment` 選填，存在 `TASK_RECALLED` 的 payload。GraphQL 輸入最多 2000 字；直接呼叫 service 時沒有這個限制。

#### 5.6.8 與「上一輪」判斷的互動

- **M**：取回後最新一批是新任務，重簽前它沒有核准，「讀 M 的核准人」得到空集合。期間 token 停在 M，沒有後面的關卡會去讀。
- **N**：被取消的任務，其 `TASK_CREATED` 留在紀錄裡。重簽後 N 再進關，會有更新的 `TASK_CREATED` 或跳過紀錄蓋過它。
  若 N 沒再進關，讀排除名單的後段關卡也走不到：發布檢查要求被列的關卡在每條路徑上都在它前面。
- **`excludeNodeActors`**：直接建任務不重查排除。M 之前的關卡、申請人、代送人都沒變。
- **取回後新任務被轉簽**：轉簽給同事、同事核准後，M 的最新一批只有同事的核准；X 的 D 在舊 token 那一批，不會被算進去，N 若排除 M 就只排除同事。
- **取回之後再退回或駁回**：新任務是一般任務；退回目標由流程定義靜態決定，不依賴新 token 的走過紀錄，所以可以照常退回上一關或駁回。
- **次數不限**：取回、重新核准、再取回都可以；每一輪都會重新通知 N 的人。

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

**AUTO_APPROVE 失敗之後**：自動同意只會試一次，不會自動重試（逾期通知已建立，下一輪掃描不再執行動作）。失敗若屬 §5.5 的範圍，
會留下 `ADVANCE_FAILED`（`automatic: 'SLA_AUTO_APPROVE'`）。該 task 有 assignee 時，管理員改派給新持有人後，新持有人還沒收過逾期通知，
下一輪掃描會以新持有人名義再自動同意一次。

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

上表的 CEL 評估點（表單欄位那列不是 CEL）遇到執行期錯誤（語法、缺 key、型別、預算、結果、函式失敗，見 §9.2）都是 fail closed：
丟 `ExpressionRuntimeError`（`BadRequestException`），所在交易回滾，案件不前進。只有 NOTIFY webhook 的 `EXPRESSION` 參數例外，
失敗記在 delivery 上，審批照常進行（§9.2）；另外設計器建的邊在欄位未填時會改由結構化欄位回答（§3.1，未發佈）。

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

### 9.1 Dry run 預算與 webhook 派送時機（升級注意）

**Dry run**：`dryRunApprovalWorkflow` 的權限與 GraphQL schema 都沒有變。單一輸入超過 1 MiB、遍歷超過 10,000 次、
或模擬超過 2 秒時回 `valid: false` 與一則 `errors` 訊息。流程若連續多個會同時走全部分支的閘道，路徑數會逐層加倍，
這類設計現在會得到上述結果。2 秒的時間上限保護事件迴圈，不限制記憶體。

**Webhook**：`WEBHOOK` 服務節點與 ad-hoc webhook 目標改在交易 commit 後才送出。`BPMWorkflowServiceTaskDispatcher`
介面與 mutation 回傳都沒有變，mutation 仍會等送出完成，回傳時活動紀錄已寫入。知會節點的 outbox 路徑（ADR 18）本來就在 commit 後投遞。

| 項目 | 之前 | 現在 |
| --- | --- | --- |
| 派送時機 | 交易內，持有案件鎖與資料庫連線 | commit 後，不持有兩者 |
| 交易 rollback | webhook 已送出，無法收回 | 不送 |
| 端點回呼 BPM API | 讀到舊狀態，或等待案件鎖 | 讀到已 commit 的狀態 |
| 活動紀錄順序（`seq`） | 結果排在後續節點的事件之前 | 結果排在同一交易所有事件之後 |
| commit 後程序崩潰 | 不會發生 | webhook 不會送出，也沒有結果紀錄；ad-hoc directive 已是 `CONSUMED` |
| 內建 dispatcher 逾時 | 無（undici 預設約 300 秒） | 30 秒，逾時記 `SERVICE_TASK_FAILED` |
| 同時約 10 個以上決策 | 交易內再要第二條連線，連線池死結，API 需重啟才恢復 | 交易內的委派規則與通知偏好都走同一條連線 |

宿主需要檢查的事：

- 以活動紀錄相鄰順序判斷流程的程式，改用 `action`、`tokenId`、`directiveId` 比對。
- 回應超過 30 秒的端點，改為 `202` 後非同步處理，或綁定自己的 dispatcher。
- 自訂 dispatcher 不受 30 秒限制，請自行設定逾時，否則 mutation 會一直等待端點回應。
- 內建案件歷程本來就不顯示這類服務節點紀錄，不受順序變動影響。
- 不能遺失的 webhook 請改用知會節點，它有 outbox 與重試；`WEBHOOK` 服務節點與 ad-hoc 目標沒有。

### 9.2 表達式方言、預算與 fail closed（未發佈，Phase 23）

語法、lint 與使用點見 [docs/05](./05-conditions-cel.md)；本節只講引擎在執行時怎麼選方言、怎麼計時、失敗時怎麼處理。

**每個評估點讀哪裡的方言**（方言缺少一律視為 `cel-legacy`）：

| 評估點 | 方言來源 |
| --- | --- |
| 發起權限 `initiatorPolicyCel`（送出、可發起清單） | 所屬模板版本的 `workflowDefinition.expressionDialect`；式子空白時不讀方言 |
| 節點 `entryCondition` | 案件 `workflowSnapshot`；式子空白時不讀方言 |
| 邊條件、簽核人 `EXPRESSION`、服務節點 `WEBHOOK` payload、`SET_FORM_FIELD` 的值 | 案件 `workflowSnapshot` |
| 委派規則 `scopeConditionCel` | 規則自己的 `scopeConditionDialect`（§4.2） |
| Dry run | 送來的草稿定義；在預算外先 `prepareEngine(dialect)` 載入引擎 |
| DataSource／NOTIFY webhook 的 `EXPRESSION` binding | 固定 `cel-v2`，沒有方言欄位 |

- 案件用的是發起當下的快照，所以模板之後升級方言，不會改變進行中案件的路由。
- 不認得的方言值（較新版本寫入或手改）不會改用 `cel-legacy` 猜測，評估時回 `EXPRESSION_SYNTAX_ERROR`。
  只有真的有式子要評估時才讀方言，沒有運算式的版本不受影響。可發起清單遇到這種版本時只排除該模板並記 warn，
  不讓整份清單失敗。發布時 `workflow-definition.validator.ts` 會先擋下未知方言。

**預算**（`expression-budget.ts`）：單一式子 100 ms，同一次操作累計 250 ms，耗盡回 `EXPRESSION_BUDGET_EXCEEDED`，
不會當成 `false`。「一次操作」的範圍：

- 引擎的每個交易（`runEngineTransaction`）是一次操作，交易內所有評估共用 250 ms，包括交易內的委派條件與 DataSource 驗證。
- 可發起清單的每個模板各自是一次操作，一個慢的模板不會用完其他模板的額度。
- Dry run 是一次操作，外層另有 2 秒的整體上限（§9.1）。
- NOTIFY webhook 每次 enqueue 另開一份預算，不佔交易的額度。

引擎在開機時（`ConditionService.onApplicationBootstrap`）預熱兩種方言，冷啟動的載入成本不會落在第一筆案件的預算內；
成功時寫一行 `code=EXPRESSION_WARM_UP_DONE cel-legacy=<ms>ms cel-v2=<ms>ms`，失敗的方言寫 `failed` 並另有
`code=EXPRESSION_WARM_UP_FAILED` warn，預熱失敗不擋開機。

**失敗一律 fail closed**：

- 對外只有六個錯誤碼與 label（`EXPRESSION_SYNTAX_ERROR`、`EXPRESSION_MISSING_KEY`、`EXPRESSION_TYPE_ERROR`、
  `EXPRESSION_BUDGET_EXCEEDED`、`EXPRESSION_INVALID_RESULT`、`EXPRESSION_FUNCTION_FAILED`），不含引擎原文與 context 值。
- 錯誤是 `ExpressionRuntimeError`（繼承 `BadRequestException`）：交易回滾，案件、任務、token 與 `formData` 都不變。
  邊條件失敗不會改走 default 邊（設計器建的邊在欄位未填時改由結構化欄位回答，見 §3.1，這不是改走 default）。委派條件失敗依 §4.2：只有該規則正是要套用的那條時才讓派送失敗。
- 宿主或內建函式失敗（丟錯、回 thenable、回傳型別不符、函式已下架）是 `EXPRESSION_FUNCTION_FAILED`，而且不會被
  `||`、`&&`、`exists` 吸收：評估中只要有一次函式呼叫失敗，整次就判失敗。被短路而沒有執行的呼叫不算。
- 函式從宿主移除後，引用它的進行中案件在評估時回 `EXPRESSION_FUNCTION_FAILED` 並回滾；宿主補回函式後同一案件可以繼續推進。
- registry 本身讀不到（`list`／`get` 丟錯或回答形狀不對）時，所有式子都回 `EXPRESSION_FUNCTION_FAILED`，失敗不快取。
- 例外：NOTIFY webhook 的 `EXPRESSION` 參數失敗時，delivery 記 `FAILED`（`WEBHOOK_PARAMETER_INVALID`，細節只有錯誤碼），
  審批不回滾。DataSource 的 `EXPRESSION` 預算耗盡回 `FORM_DATA_SOURCE_TIMEOUT`，其他失敗回 `FORM_DATA_SOURCE_INVALID_BINDING`，
  都不寫入 instance。

## 10. 並發策略

- 一個 instance 的處理用 **transaction 層級的 PostgreSQL advisory lock**：`SELECT pg_advisory_xact_lock(hashtext(instance_id))`，
  在進行變更的交易開頭取得，交易結束（commit 或 rollback）時自動釋放，不需要手動 release。
- 同 instance 的多個事件序列化處理，避免 token 狀態混亂；決策、取消、逾期終止、ad-hoc 指令等變更入口都在交易內取得同一把鎖（`workflow-engine.service.ts` 中的 `pg_advisory_xact_lock` 呼叫）。
- 取回重辦（§5.6）也在交易開頭取同一把鎖，鎖後重讀任務與案件再判。兩種先後：
  - 取回先拿到鎖：下一關持有人之後的 `decideTask` 鎖後重讀，看到任務已 `CANCELLED`，回任務不是待處理。
  - 下一關持有人先決定：取回在鎖後跑 planner，依那個決定的結果分兩種。決定讓案件離開 `RUNNING`（駁回、退回申請人、最後一關核准），
    R3 先擋，回 `INSTANCE_NOT_RUNNING`；案件仍是 `RUNNING`（例如核准後往再下一關走），由 R6 擋下，回 `NEXT_STAGE_ACTED`。
  - 同一人連按兩次：第二次鎖後看到 `TASK_RECALLED`，回 `ALREADY_RECALLED`（R12）。
  - query `recallableTaskId` 不拿鎖，可能讀到舊狀態；按下去時 mutation 會在鎖內重判。
- **SLA 掃描與取回的空窗**（既有的競態，取回沒有修它）：掃描用另一把鎖（`bpm-sla:<taskId>`），而且一開始就把所有候選任務撈成快照，
  之後逐筆處理；迴圈只重讀案件，不重查任務狀態。取回若落在「撈出」與「處理」之間，那張已被取消的下一關任務仍會被處理：
  - 逾時動作是 `AUTO_APPROVE`：`decideTask` 鎖後發現任務不是待處理而丟錯。這個錯不是 instance guard 的錯，掃描不接，`runSlaScan` 被拒，本輪後面的任務都不處理。
  - 逾時動作是 `ESCALATE`：同樣丟任務不是待處理，外面沒有 try/catch，結果同上。
  - 逾時動作是 `TERMINATE_INSTANCE`：先對已取消的任務發逾時通知、寫 `SLA_TRIGGERED`，再呼叫 `expireApprovalInstance`。它鎖內只檢查案件狀態，
    不檢查那張任務還開不開著，所以**整張單變 `EXPIRED`，取回者剛拿到的新任務一起被終止**。
  - 跟撤回案件的類比只對前兩種成立：撤回後案件是 `CANCELLED`，`expireApprovalInstance` 一看狀態就直接回傳；取回後案件仍是 `RUNNING`，
    所以第三種是取回特有的放大。同樣的空窗對「下一關核准後單子往下走」本來就存在，屬於既有問題。
- 取回與臨時指令入口也有既有的舊資料判斷：臨時指令入口拿到鎖之後，判斷任務狀態用的是鎖前讀到的資料。取回先拿到鎖時，
  下一關持有人同時送出的臨時指令靠之後重讀的候選人列才擋下，錯誤訊息是已決定；舊式沒有候選人列的任務會直接漏過
  （案件仍是 `RUNNING`，案件狀態那道擋不住）。撤回後案件是 `CANCELLED`，同樣的請求會被案件狀態擋下，所以取回讓這個空窗更容易被打到。
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
