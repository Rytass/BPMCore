# 08 — 前端工作流 Schema 與設計器現況

`WorkflowDefinition` 是 BPMCore 目前儲存於
`approval_template_versions.workflow_definition` 的 canonical JSON shape。型別來源以
`libs/shared/src/lib/workflow.ts` 為準；前端 React Flow 設計器會將畫布狀態序列化成
這個 shape，後端模板驗證器與 workflow engine 也讀取同一份資料。

本文區分兩件事：

- **Shared schema 支援**：型別與後端 validator 可接受的 JSON。
- **目前 designer UI 支援**：`apps/client` 實際可建立與編輯的能力。

---

## 1. 頂層結構

```ts
interface WorkflowDefinition {
  readonly edges: readonly WorkflowEdge[];
  readonly meta: WorkflowDefinitionMeta;
  readonly nodes: readonly WorkflowNode[];
}

interface WorkflowDefinitionMeta {
  readonly diagramVersion?: string;
  readonly schemaVersion: 1;
}
```

---

## 2. 節點

```ts
type WorkflowNode = StartEventNode | EndEventNode | UserTaskNode | ServiceTaskNode | ExclusiveGatewayNode | ParallelGatewayNode;

interface BaseNodeData {
  readonly label: string;
  readonly triggerMode?: 'AND' | 'OR';
}
```

`triggerMode` 是目前多 incoming edge 的匯合語意：

- `AND`：全部前置節點完成後才進入。
- `OR`：任一前置節點完成後即可進入，並取消同層 sibling token。

當節點 incoming edge 少於 2 條時，designer 會固定 `triggerMode: 'AND'`。

### Start Event

```ts
type StartEventNode = BaseWorkflowNode<'startEvent', BaseNodeData>;
```

發起權限不寫在 Start Event node data。Designer 目前在版本層級產生
`initiatorPolicyCel`，支援下列模式：

- `NONE`：未設定，視為不限制。
- `ALL`：所有登入成員。
- `ORG_UNIT`：限定指定組織，可包含子組織。
- `ORG_UNIT_POSITION`：限定指定組織 + 職位，可包含子組織。
- `CUSTOM`：直接輸入 CEL。

目前沒有「指定角色」模式；若需要角色條件，使用 `CUSTOM` CEL。

### End Event

```ts
interface EndEventNodeData extends BaseNodeData {
  readonly endState?: 'APPROVED' | 'REJECTED';
}
```

`endState` 預設視為 `APPROVED`。

### User Task

```ts
interface UserTaskNodeData extends BaseNodeData {
  readonly allowAddSigner: boolean;
  readonly allowReject: boolean;
  readonly allowTransfer: boolean;
  readonly approverResolver: ApproverResolver;
  readonly decisionPolicy: DecisionPolicy;
  readonly description?: string;
  readonly entryCondition?: string;
  readonly excludeInitiator?: ExcludeInitiatorConfig;
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
  readonly returnBehavior: ReturnBehavior;
  readonly sla?: SlaConfig;
}

interface ExcludeInitiatorConfig {
  /** 排除申請人後沒有任何簽核人時的處理方式。 */
  readonly whenEmpty: 'FAIL' | 'INITIATOR_MANAGER' | 'SKIP_NODE';
}
```

`excludeInitiator` 是權責分離設定：存在時，送出單據的人（`initiatorMemberId`）
不會是該節點的簽核人，代理人替申請人簽也算申請人本人。省略此欄位時行為與過去
完全相同，因此既有模板與進行中的 instance 不受影響。`whenEmpty` 只接受上述三個值，
runtime 規則見 [07-workflow-execution.md](./07-workflow-execution.md) §4.4。

Shared schema 保留完整欄位；目前 designer UI 實際可編輯的是：

- 節點名稱。
- 簽核者來源與 resolver 詳細設定。
- resolver fallback。
- `returnBehavior.resubmitStrategy`、`returnBehavior.requireComment`。
- `sla`（期限、單位、`calendar` 計算方式、`onTimeout`、`escalateLevelsUp`、
  `warningAt`）。
- 多 incoming edge 時的 `triggerMode`。

Designer 目前固定新建節點的 `decisionPolicy` 為 `{ type: 'SINGLE' }`；既有
snapshot 若帶有其他策略，designer 會以該策略的實際完成條件顯示提示。多人
簽核可由 direct resolver 指定多位成員，runtime 會依 snapshot 中的
`decisionPolicy` 判定完成條件。

目前 designer 可編輯 `allowAddSigner`、`allowTransfer`、`allowReject`、
`excludeInitiator`（`setUserTaskExcludeInitiator` command；AI 工具
`set_user_task_exclude_initiator`），以及
`description`、`entryCondition`、`fieldPermissions`、`notification` 仍未提供
UI。這些未提供 UI 的欄位仍保留在 shared schema 供後續實作與相容資料使用。

`SEQUENTIAL`（designer 選項「依序簽核」）依候選簽核人的順序一次只開放一位：
`task_candidates.sequence`（0 起算）排定順序，輪到的候選人為 `PENDING`，其餘為
`WAITING`（目前畫面不顯示候選人狀態）；前一位同意後才輪到下一位，任一位拒絕或退回即
結束該關。節點面板的提示文字照此說明。

Task 相關欄位（`TaskRecord`／activity payload）：

- `candidateMemberIds`：task 上所有候選人（顯示用摘要，含尚未輪到者）。
- `openCandidateMemberIds`：現在可以操作的候選人（候選狀態為 `PENDING` 或
  `CLAIMED`），順序同 `candidateMemberIds`。判斷「某人是否能簽」請用這個欄位
  （`canMemberActOnTask` 在欄位缺席時才退回 `candidateMemberIds`，這只涵蓋自行撰寫
  查詢的 host；內建 client 一律選取此欄位，舊版 server 會直接拒絕整個查詢，所以
  client 與 server 必須同版升級，即同一個 release）；SEQUENTIAL
  以外的 task 兩者只差已決議者。
- activity `TASK_CREATED` payload：`candidateMemberIds` 只列目前開放的人；
  SEQUENTIAL task 另帶 `sequentialCandidateMemberIds`（完整順序，只有 SEQUENTIAL
  task 才有此 key），時間軸顯示為「簽核順序：A → B → C」。
- activity `TASK_CANDIDATE_ACTIVATED`（時間軸標題「輪到下一位簽核」）：payload
  `{ assigneeMemberId, candidateMemberIds, originalAssigneeMemberId, assignmentType,
  candidateMemberId, originalMemberId, sequence, previousMemberId, tokenId }`；
  前四個欄位與 `TASK_CREATED` 的收件人欄位同義，這個事件是 SEQUENTIAL task「現在輪到這位」
  的訊號（細節見 `07-workflow-execution.md` §4.3）。

`sla` 的期限以「數量 + 單位（日／小時）」輸入而非直接寫 ISO duration，因此
designer 不會產生 `P1DT4H` 這種日與時混用的值——`BUSINESS_DAY` 只對「日」的部分
跳過非工作日，混用時語意會不直觀。「計算方式」選項僅在單位為「日」時出現；改為
「小時」時會自動正規化回 `CALENDAR`。

### Approver Resolver

```ts
type ApproverResolver =
  | { readonly memberIds: readonly string[]; readonly type: 'DIRECT' }
  | { readonly positionId: string; readonly type: 'POSITION' }
  | {
      readonly includeDescendants?: boolean;
      readonly orgUnitId: string;
      readonly type: 'ORG_UNIT_MEMBER';
    }
  | {
      readonly includeDescendants?: boolean;
      readonly orgUnitId: string;
      readonly positionId: string;
      readonly type: 'ORG_UNIT_POSITION';
    }
  | {
      readonly baseFromInitiator: boolean;
      readonly fallback?: ApproverResolverFallback;
      readonly levelsUp: number;
      readonly type: 'ORG_MANAGER';
    }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly orgUnitId: string;
      readonly type: 'ORG_UNIT_MANAGER';
    }
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly minPositionLevel: number;
      readonly type: 'ORG_MANAGER_CHAIN';
    }
  | { readonly formPath: string; readonly type: 'DYNAMIC_FORM' }
  | { readonly expression: string; readonly type: 'EXPRESSION' };

type ApproverResolverFallback =
  | { readonly type: 'NONE' }
  | {
      readonly allowInitiatorSelfApproval?: boolean;
      readonly memberId: string;
      readonly type: 'DIRECT';
    };
```

Designer 目前提供「指定會員」、「依表單欄位指定」（`DYNAMIC_FORM`）、發起人主管、主管鏈、
指定組織主管、組織任一人、組織特定職位、指定職位等模式；`EXPRESSION` 不開放給一般使用者，
只由 API／AI 建立並照常顯示。「依表單欄位指定」只列出綁定表單中的 `member` 欄位
（`formPath` = 欄位的 `fieldKey`）；表單沒有人員選擇欄位時會提示先到表單設計加入，儲存值
已不再指向人員選擇欄位時保留顯示並警告，不會自動清掉。
後端 publish validation 會檢查 resolver 必要欄位是否存在，但不會查詢 member /
position / org id 是否真實存在。

#### 人員選擇欄位（`member`）與 `DYNAMIC_FORM`

試跑（dry run）對「依職位／組織」這類要到送出時才能決定人選的 resolver，回傳的
`assigneeMemberId` 是占位字串（`position:<id>`、`orgUnitMember:<id>`、
`orgUnitPosition:<orgUnitId>:<positionId>`、`orgUnitManager:<id>`、`orgManagerChain:<level>`）；
designer 的試跑結果會把它們顯示成中文（例如「職位：經理（送出時依當下人員決定）」），真實成員 id
顯示姓名，不認得的字串原樣顯示。試跑的範例表單資料中，`member` 欄位預設填入試跑發起人
（可複選則為單元素陣列），讓「依表單欄位指定」的節點能解析出人。

`DYNAMIC_FORM` 的 `formPath` 讀到的值必須是成員 id（字串）或成員 id 陣列。表單欄位
類型 **`member`（人員選擇）** 就是為此而設：

```ts
type MemberFieldDefinition = BaseFormFieldDefinition<'member'> & {
  readonly multiple?: boolean; // 可複選；省略或 false = 單選
};
```

- **儲存值**：單選為成員 id 字串，可複選為成員 id 字串陣列；只存 id，不存 `{ id, name }`，
  名稱在顯示時才以成員目錄解析。沒選人時，單選是省略／`null`，可複選是 `[]`，與其他選填
  欄位一致。因此 `formPath` 直接寫欄位的 `fieldKey`（例如 `reviewer`）即可。
- **Builder**：欄位庫的「人員選擇」，設定項有「可複選」與一般欄位共有的標題、必填等；
  不提供預設值 UI，也不能當作表格欄（V1）。
- **Renderer**：填寫與唯讀都用同一個成員搜尋（姓名或信箱，與 designer 指定會員同一組
  `searchMembers`／`resolveMembers` 查詢）；唯讀時顯示姓名，找不到的 id 顯示「未知會員」。
- **條件**：只提供「已填寫／未填寫」（`IS_FILLED`／`IS_EMPTY`），不提供等於／不等於——成員 id
  不是人能手打的值。表單內的顯示／必填／唯讀規則也不會把人員選擇欄位列為條件來源。
- **送出驗證**：必填沿用既有檢查（空字串、空陣列視為未填）；有值時必須是非空字串（可複選
  為非空字串陣列），否則 `400`。後端不會查成員是否存在，這和 `DIRECT` resolver 一致。

`ORG_MANAGER_CHAIN`（沿主管鏈簽到職等門檻，規則見
[07-workflow-execution.md](07-workflow-execution.md) §4.1.1）另有兩條 publish 檢查：
`minPositionLevel` 必須是有限整數；`userTask` 的 `decisionPolicy` 只能是
`SEQUENTIAL` 或 `PARALLEL_ALL`，否則第一位主管簽完就會讓節點結案。同一個 resolver
用在 `NOTIFY.recipients` 時不受 decision policy 限制（所有人都會收到通知）。

### Service Task

```ts
type ServiceAction =
  | {
      readonly channels: readonly Exclude<NotificationChannel, 'WEBHOOK'>[];
      readonly recipients: ApproverResolver;
      readonly template?: string;
      readonly type: 'NOTIFY';
      /** 呼叫宿主註冊的端點（ADR 18）；最多 10 個。 */
      readonly webhooks?: readonly NotifyWebhookTarget[];
    }
  | {
      readonly headers?: Readonly<Record<string, string>>;
      readonly payload?: string;
      readonly type: 'WEBHOOK';
      readonly url: string;
    }
  | {
      readonly fieldPath: string;
      readonly type: 'SET_FORM_FIELD';
      readonly value: string;
    };
```

Shared schema 與後端 validator 支援 `NOTIFY`、`WEBHOOK`、`SET_FORM_FIELD`。
workflow runtime 會執行這三種 service task：`WEBHOOK` 預設以 JSON `POST`
dispatch，且可由宿主透過 `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` 替換成 signing、
queue 或 integration bus。Designer 目前只建立 `NOTIFY` + `DIRECT` members，
channel 固定為 `IN_APP`；`WEBHOOK` 與 `SET_FORM_FIELD` 目前仍屬於 schema/API
能力，尚未提供 designer 表單介面。

#### 知會節點 Webhook（ADR 18）

```ts
interface NotifyWebhookTarget {
  readonly id: string; // 穩定 id，投遞以 (token, target id) 去重，勿重新產生
  readonly endpoint: { readonly key: string; readonly version: number };
  readonly bindings: readonly {
    readonly parameter: string;
    readonly from: { readonly kind: 'FIELD'; readonly fieldKey: string } | { readonly kind: 'CONSTANT'; readonly value: boolean | number | string | null } | { readonly kind: 'CONTEXT'; readonly path: NotifyWebhookContextPath };
  }[];
}
```

- 模板只存端點 key／version 與參數綁定，**不存 URL、header 或金鑰**；結構 lint 會拒絕
  target 或 binding 上的任何未知欄位（`url`、`headers`、`secret` 等）。
- `CONTEXT` 路徑：`instance.id`、`instance.title`、`instance.templateId`、
  `instance.templateVersionId`、`initiator.memberId`、`node.id`、`node.label`，一律為字串。
- 知會對象可為空（`DIRECT` 且 `memberIds: []`），前提是至少有一個 webhook。
- 設計器：知會節點面板的「Webhook」區塊從 `workflowWebhookEndpoints` catalog 選端點，
  每個宣告的參數一列，來源可選表單欄位（只列型別相容者）、固定值、案件資訊；已停用或
  已下架的端點會保留並警告。卡片顯示「Webhook N 個」，試跑會列出將送出的 webhook。
- 設計器與後端發布檢查共用 `readNotifyWebhookStructureIssues`（結構）與
  `readNotifyWebhookTargetCatalogIssues`（對照 catalog 與表單）；catalog 規則只擋發布，
  不擋儲存草稿。

### Gateway

`exclusiveGateway` 已可由 designer 建立，edge 條件以 CEL 儲存在
`edge.data.condition`，default flow 以 `edge.data.isDefault` 表示。

`parallelGateway` 是 schema/runtime/唯讀檢視相容型別。Designer palette 目前不提供
新增 Parallel Gateway；多分支與匯合主要使用多條 edge 搭配後續節點
`triggerMode`。

---

## 3. Edge

```ts
interface WorkflowEdge {
  readonly data: WorkflowEdgeData;
  readonly id: string;
  readonly source: string;
  readonly sourceHandle?: string | null;
  readonly target: string;
  readonly targetHandle?: string | null;
  readonly type?: 'smoothstep';
}

interface WorkflowEdgeData {
  readonly condition?: string;
  readonly conditionFieldKey?: string;
  readonly conditionOperator?: WorkflowEdgeConditionOperator;
  readonly conditionValue?: string;
  readonly isDefault?: boolean;
  readonly label?: string;
}
```

`sourceHandle` / `targetHandle` 是 React Flow rendering metadata，designer 會持久化
以維持連線位置。`condition` 是 runtime 執行的 CEL expression；
`conditionFieldKey`、`conditionOperator`、`conditionValue` 是 designer UI 的
structured condition metadata，供表單式條件編輯與 fallback 顯示。

---

## 4. Designer Runtime

目前 designer 路徑：

```text
apps/client/src/app/templates/[id]/designer
```

主要能力：

- React Flow 畫布與自訂節點/edge renderer。
- 節點 palette：Start、End、User Task、Service Task、Exclusive Gateway。
- User Task resolver 屬性面板。
- Edge 條件與 default flow 屬性面板。
- 儲存 draft、發布版本、版本歷程。
- Dry Run，在設計器中呼叫後端 `dryRunApprovalWorkflow` mutation。
- 自動排版。

目前沒有獨立的後端 lint API onChange/onBlur。Designer 會做少量前端 incomplete
檢查，Dry Run 會呼叫後端模擬；正式發布時，後端 `TemplateService.publish`
會執行 workflow definition validation 與 CEL lint。

---

## 5. 發布驗證現況

模板發布前目前會檢查：

| 規則              | 目前行為                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Start             | 必須恰有一個 `startEvent`。                                                                               |
| End               | 必須至少有一個 `endEvent`。                                                                               |
| 連通性            | 從 Start 可達節點與必要連線會被檢查。                                                                     |
| User Task         | resolver 必要欄位必須存在。                                                                               |
| Service Task      | `NOTIFY` 需要知會對象或至少一個 webhook；webhook 端點必須存在且未停用、必填參數有綁定、綁定欄位型別相容。 |
| Exclusive Gateway | split 需要 default outgoing edge；條件 edge 會做 CEL lint。                                               |
| CEL               | 目前做 parse/lint，不做 context schema 靜態型別推導。                                                     |

目前尚未實作 cycle detector、XOR 至少兩條出邊檢查、resolver id 存在性查詢、或
frontend 即時後端 lint endpoint。若要把這些列為正式規則，應補 validator 與測試後
再更新本文。

---

## 6. Client Runtime

前端 GraphQL 與 auth endpoint resolver 的實際行為：

- localhost / `127.0.0.1`：GraphQL 使用 `http://localhost:17603/graphql`，
  auth 使用 `http://localhost:17603`（root origin，不再有 `/api` prefix）。
- deployed hostname：GraphQL 使用 same-origin `/graphql`，auth 使用 same-origin
  根路徑下的 `/auth/...`。
- `NEXT_PUBLIC_API_URL` 與 `NEXT_PUBLIC_API_AUTH_URL` 可以覆寫；plain `API_URL`
  不會被 browser bundle 讀取。
- Auth 使用 `apps/api` 的 signed HTTP-only cookie。Client 登入後會重新讀
  `/auth/me`，未登入時導向 `/login`。
