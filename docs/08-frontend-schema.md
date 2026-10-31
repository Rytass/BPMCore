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
  readonly fieldAccess?: readonly FieldAccessEntry[];
  /** @deprecated 從未生效；草稿仍帶這個鍵時無法發布（見 §8.6）。 */
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
  readonly returnBehavior: ReturnBehavior;
  readonly sla?: SlaConfig;
}

interface ExcludeInitiatorConfig {
  /** 排除申請人後沒有任何簽核人時的處理方式。 */
  readonly whenEmpty: 'FAIL' | 'INITIATOR_MANAGER' | 'SKIP_NODE';
}

interface FieldAccessEntry {
  /** 表單頂層 fieldKey；表格整張一起設定，不收 `items.price`、`items[0]`。 */
  readonly fieldKey: string;
  /** 本關畫面是否顯示；`HIDE` 只是顯示選項，不是權限邊界。 */
  readonly display: 'SHOW' | 'HIDE';
  /** 本關簽核人核准時能否補填；`REQUIRED` 表示核准前必須有值。 */
  readonly fill: 'NONE' | 'OPTIONAL' | 'REQUIRED';
}
```

`excludeInitiator` 是權責分離設定：存在時，送出單據的人（`initiatorMemberId`）
不會是該節點的簽核人，代理人替申請人簽也算申請人本人。省略此欄位時行為與過去
完全相同，因此既有模板與進行中的 instance 不受影響。`whenEmpty` 只接受上述三個值，
runtime 規則見 [07-workflow-execution.md](./07-workflow-execution.md) §4.4。
單據有「代送人」（`submittedByMemberId`，建單人替申請人送出時才會與申請人不同）時，
同一個設定也會把代送人排除，規則與申請人完全一樣。
Client 端的 `ApprovalInstanceRecord.submittedByMemberId`（選填、可為 `null`）就是這個欄位；
`null`、缺省、或等於 `initiatorMemberId` 都表示申請人自己送出，只有不同的非空值才顯示「由 X 代 Y 送出」。
讀取權限與通知內文見 [07-workflow-execution.md](./07-workflow-execution.md) §4.4。

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
`set_user_task_exclude_initiator`）與 `fieldAccess`（見下方說明），以及
`description`、`entryCondition`、`notification` 仍未提供
UI。這些未提供 UI 的欄位仍保留在 shared schema 供後續實作與相容資料使用。

> `fieldAccess` 由 server 強制執行：`fill` 不是 `NONE` 的欄位，只有該節點非加簽任務的
> 簽核人能在核准時補填；`display: 'HIDE'` 只是顯示選項，不是權限邊界。規則、發布檢查與
> host 注意事項見 [§8](#8-節點層級欄位存取fieldaccess)。designer 以「欄位與關卡總覽」
> 設定（側欄「欄位總覽」或節點面板「開啟欄位總覽」）：列為表單欄位、欄為依流程順序的簽核節點，
> 套用時以 `setFieldAccessMatrix` 一次寫入所有節點（AI 工具 `set_field_access_matrix` 只改寫 `nodeIds` 列出的節點）；
> 節點上殘留的舊鍵以 `removeLegacyFieldPermissions` 移除。總覽與發布檢查共用
> `readFieldAccessMatrix` 的同一套規則，問題只擋發布、不擋儲存草稿。要讓某個欄位不出現在
> 畫面上，用表單欄位的 `hidden`（見 §7）。

`SEQUENTIAL`（designer 選項「依序簽核」）依候選簽核人的順序一次只開放一位：
`task_candidates.sequence`（0 起算）排定順序，輪到的候選人為 `PENDING`，其餘為
`WAITING`（目前畫面不顯示候選人狀態）；前一位同意後才輪到下一位，任一位拒絕或退回即
結束該關。節點面板的提示文字照此說明。

Task 相關欄位（`TaskRecord`／activity payload）：

- `nodeLabel`：task 所在節點的顯示名稱（`node.data.label`）。由 server 依 task 所屬
  案件的 `workflow_snapshot` 解析、不存進 task 資料列（無 migration）；`inboxTasks`／
  `approvalHistoryTasks`／`tasks` 以一次查詢取得整批 task 的案件快照，不會每筆 task
  各查一次。快照裡找不到該節點時為 `null`。清單類畫面（待簽，以及待簽頁的「歷史簽核記錄」分頁）顯示
  `nodeLabel ?? nodeId`，不再顯示內部 id（如 `band-0`）；臨時加簽／會簽產生的 task
  沿用它所在節點的名稱，畫面另依 `isAdhoc`／`adhocType` 加「（臨時加簽）」或
  「（臨時會簽）」。內建 client 一律選取此欄位，舊版 server 會直接拒絕整個查詢，
  所以 client 與 server 必須同版升級，即同一個 release。
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
  | { readonly expression: string; readonly type: 'EXPRESSION' }
  // 未發佈：依表單上選的人，簽那個人往上 levelsUp 層的主管
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly formPath: string; // 指向 member 單選欄位
      readonly levelsUp: number;
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'FORM_MEMBER_MANAGER';
    }
  // 未發佈：依表單上選的組織，簽該組織的主管
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly formPath: string; // 指向 org_unit 欄位
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'FORM_ORG_UNIT_MANAGER';
    }
  // 未發佈：簽前面指定關卡實際簽核的人
  | { readonly nodeIds: readonly string[]; readonly type: 'NODE_ACTOR' }
  // 未發佈：前面指定關卡實際簽核的人，往上 levelsUp 層的主管
  | {
      readonly fallback?: ApproverResolverFallback;
      readonly levelsUp: number;
      readonly nodeIds: readonly string[];
      readonly preferClosestOrgUnit?: boolean;
      readonly type: 'NODE_ACTOR_MANAGER';
    };

type ApproverResolverFallback =
  | { readonly type: 'NONE' }
  | {
      readonly allowInitiatorSelfApproval?: boolean;
      readonly memberId: string;
      readonly type: 'DIRECT';
    }
  // 未發佈（v0.16.2 之後）：該職位目前所有有效成員都成為候選人
  | {
      readonly allowInitiatorSelfApproval?: boolean;
      readonly positionId: string;
      readonly type: 'POSITION';
    };
```

`readUnsupportedApproverFallbackType(fallback)`（未發佈，v0.16.2 之後）回傳本版本不認得的 fallback `type`
（例如由較新版本存下的定義），否則為 `null`；Designer 遇到時以唯讀顯示，引擎則在節點啟動時拒絕。

Designer 目前提供「指定會員」、「依表單欄位指定」（`DYNAMIC_FORM`）、發起人主管、主管鏈、
指定組織主管、組織任一人、組織特定職位、指定職位等模式；`EXPRESSION` 不開放給一般使用者，
只由 API／AI 建立並照常顯示。「依表單欄位指定」只列出綁定表單中的 `member` 欄位
（`formPath` = 欄位的 `fieldKey`）；表單沒有人員選擇欄位時會提示先到表單設計加入，儲存值
已不再指向人員選擇欄位時保留顯示並警告，不會自動清掉。
後端 publish validation 會檢查 resolver 必要欄位是否存在，但不會查詢 member /
position / org id 是否真實存在。

四種新來源（`FORM_MEMBER_MANAGER`、`FORM_ORG_UNIT_MANAGER`、`NODE_ACTOR`、`NODE_ACTOR_MANAGER`，未發佈）
的就緒檢查（`readApproverResolverIssue`）：`formPath` 不可空白、`nodeIds` 不可為空、
`FORM_MEMBER_MANAGER`／`NODE_ACTOR_MANAGER` 的 `levelsUp` 須為 ≥ 1 的整數，三個主管型的
`fallback` 與既有主管型同規則（`DIRECT` 要有 `memberId`、`POSITION` 要有 `positionId`）。
`NODE_ACTOR`／`NODE_ACTOR_MANAGER` 另有圖檢查 `readNodeActorSourceIssues(definition, nodeId, sourceNodeIds)`：
來源關卡必須是存在的簽核關卡、不得有進入條件或「排除發起人後沒人時跳過此關」、不得重複或指到自己；
從起點出發不經過任何來源關卡就走不到本節點（涵蓋）；兩個來源不得分在同一個平行閘道的不同出邊上；
每個來源都必須在本節點的上游（從該來源出發走得到本節點）——排在本節點之後或沒接上流程的關卡不能當來源。
**知會節點的收件人不開放這四種來源**（`isNotifyRecipientResolverType`），`readNotifyRecipientsIssue`
會擋，AI 工具組寫入知會收件人時一律退回預設的直屬主管。

後端 publish validation 對這四種來源另有檢查（`lintWorkflowDefinition`／`TemplateService`）：
結構規則同上（`formPath`、`levelsUp`、`nodeIds` 存在且是簽核關卡、不含自己、fallback 欄位），
認不得的 resolver `type` 與知會收件人用這四種來源都直接擋；`FORM_MEMBER_MANAGER` 的 `formPath`
須指向**單選**、必填、不會被 `visibleWhen`／`hidden` 藏起來的 `member` 欄位，
`FORM_ORG_UNIT_MANAGER` 須指向必填且不會被藏的 `org_unit` 欄位（判準與 `DYNAMIC_FORM` 同一套）；
`NODE_ACTOR`／`NODE_ACTOR_MANAGER` 的圖檢查（`readNodeActorSourceIssues`）在結構檢查通過後執行。

AI 工具組（`set_user_task_approver` 的 `approverResolver`）認得這四種來源；必要欄位
（`formPath`、`nodeIds`）缺漏時照既有慣例退回預設的直屬主管。換簽核來源時，新的三個主管型與
既有主管型一樣沿用節點原本的 `fallback`。

#### 人員選擇欄位（`member`）與 `DYNAMIC_FORM`

試跑（dry run）對「依職位／組織」這類要到送出時才能決定人選的 resolver，回傳的
`assigneeMemberId` 是占位字串（`position:<id>`、`orgUnitMember:<id>`、
`orgUnitPosition:<orgUnitId>:<positionId>`、`orgUnitManager:<id>`、`orgManagerChain:<level>`）；
designer 的試跑結果會把它們顯示成中文（例如「職位：經理（送出時依當下人員決定）」），真實成員 id
顯示姓名，不認得的字串原樣顯示。試跑的範例表單資料中，`member` 欄位預設填入占位值
`formMember:<fieldKey>`（可複選則為單元素陣列），讓「依表單欄位指定」的節點能解析出人，
試跑結果顯示為「表單欄位「<欄位名稱>」選的人（送出時依填寫內容決定）」（欄位沒有名稱或已刪除時顯示 `fieldKey`）。刻意不填試跑發起人：
真實送出時通常選的是別人，填發起人會讓設了「排除申請人」的節點在試跑中被略過或停住。
要模擬特定人員，直接把 JSON 中的值改成該成員 id。

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

#### 組織選擇欄位（`org_unit`，未發佈）與 `FORM_ORG_UNIT_MANAGER`

`FORM_ORG_UNIT_MANAGER` 的 `formPath` 讀到的值必須是組織單位 id（字串）。表單欄位類型
**`org_unit`（組織選擇）** 就是為此而設：

```ts
type OrgUnitFieldDefinition = BaseFormFieldDefinition<'org_unit'>;
```

- **儲存值**：單一組織單位 id 字串；只存 id，名稱在顯示時才解析。沒選時是省略／`null`。
  沒有 `multiple`（只能選一個組織），也不能當表格欄。`isFormOrgUnitValue(value)` 判斷
  儲存值是否合格（非空白字串）。
- **條件**：只提供「已填寫／未填寫」（`IS_FILLED`／`IS_EMPTY`），不提供等於／不等於——組織
  id 不是人能手打的值；也可以餵給 webhook 的 `string` 參數（`json` 亦可）。
- **與簽核來源的關係**：`FORM_ORG_UNIT_MANAGER` 簽該欄位所選組織的主管；`formPath` 指向
  的欄位須是 `org_unit`、必填且不會被隱藏（publish 時檢查；試跑由後續任務補上）。
- **未發佈／尚未實作**：後端表單 schema 對 `org_unit` 欄位的接受與送出驗證、Builder 的欄位
  庫與設定項、Renderer 的組織搜尋控制項、試跑範例值與案件頁的部門名稱顯示，都由後續任務
  補上；目前只有型別、`isOrgUnitFieldDefinition`／`isFormOrgUnitValue`、條件與 webhook
  相容判斷已在 `@rytass/bpm-core-shared`。

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

`SET_FORM_FIELD` 寫入頂層文字欄位時，套用與填寫者相同的長度與格式規則（`minLength`、
`maxLength`、`pattern`，格式比對同樣有 50 ms 時間預算）。不符合時拋 `400`，觸發這一步的送出或
簽核整筆回滾、值不會寫入；案件依範本快照執行，修正範本不會影響已在進行中的案件。

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
| Exclusive Gateway | split 需至少兩條 outgoing edge 且需要 default outgoing edge；條件 edge 會做 CEL lint。                                               |
| CEL               | 目前做 parse/lint，不做 context schema 靜態型別推導。                                                     |

上表之外，以下規則已在 `libs/bpm-core/src/lib/template/workflow-definition.validator.ts` 實作：

- cycle detector（`lintCycles`）：從 Start 可達的環會被拒絕（退回不是流程上的環，不在此檢查範圍）。
- XOR 至少兩條出邊（`lintExclusiveGateways`）：split 型 exclusive gateway 需至少兩條 outgoing edge，且需有 default。
- 欄位存取（`fieldAccess`）：舊鍵 `fieldPermissions`、形狀、重複、補填卻隱藏、補填節點的決策策略／SLA／
  `excludeInitiator` 限制、同一路徑只能有一個補填節點、`SET_FORM_FIELD` 不得寫補填欄位，以及發布範本版本時
  對照綁定表單、申請人欄位規則不得讀補填欄位、「補填之前不得讀補填欄位」的檢查，
  見 [§8.6](#86-發布檢查)。

目前仍未實作：resolver id 存在性查詢（發布驗證不查 member／position 是否存在），以及 frontend 即時後端 lint endpoint
（目前沒有獨立的 lint query／mutation，驗證只在發布時執行）。若要把這些列為正式規則，應補 validator 與測試後再更新本文。

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

---

## 7. 表單欄位的顯示選項（`hidden`、`displayAs`）

型別來源是 `libs/shared/src/lib/form.ts`。這兩個選項只影響畫面如何呈現，不改變
`form_data` 的內容。

### `hidden`：只存不顯示

```ts
{ fieldKey: 'sourceDocId', label: '來源單據', required: false, type: 'text', hidden: true }
```

給宿主系統放技術欄位用（來源單據編號、版本、型別…）：值由 service 層送進 `form_data`，
簽核人看不到。

- **畫面**：填寫、唯讀、重送都不渲染這個欄位；案件標題也不會挑它當標題欄位。
- **值**：照存。renderer 送出的值仍包含隱藏欄位，重送時不會被丟掉。
- **驗證**：前端與後端 `validateSubmittedFormData` 都把 `hidden` 欄位當成「不可見」，
  不檢查必填；後端不會剝掉已送入的值。
- **發布檢查**：`hidden` 必須是 boolean；`hidden: true` 不可與 `required: true` 並用
  （沒人填得到必填值，表單會送不出去）；table 的 column 不支援 `hidden`。
- **隱藏的選項來源（DataSource）欄位**：`hidden` 欄位（或 `hidden` table 的 column）若設了
  `dataSource`，其 `FIELD` 綁定只能指向同為 `hidden` 的欄位；綁定到顯示中的欄位會被發布檢查
  擋下。原因：隱藏欄位不會被渲染，前端的 DataSource 閘門看不到它，但後端送出時仍會解析；
  依賴的欄位值有問題時，重送者會被後端擋下卻沒有任何欄位可以修。只依賴其他 `hidden`
  欄位、或只用常數綁定都允許。
- **隱藏的 table**：後端仍檢查它的值是合法的 table（必須是列的陣列、每列是物件、欄位 key
  合法）與 `maxRows` 上限；只略過必填、`minRows` 與列內必填欄位。
- **與 `visibleWhen` 並用**：允許，`hidden` 優先（永遠不顯示）。`requiredWhen`
  同理被略過。
- **仍可被引用**：條件式（`visibleWhen` / `requiredWhen` / 流程條件）、webhook 綁定、
  dry-run 範例資料都照常讀得到隱藏欄位。
- **不是權限邊界**：API 回傳的 `formData` 仍然包含這些值，任何能讀案件的人都拿得到。
- **設計器**：欄位設定的「只存不顯示（系統整合用）」；勾選時會一併取消必填，欄位仍列在
  設計器清單中並標示「只存不顯示」。

### `displayAs: 'link'`：文字欄位以連結呈現

只能設在 `text` / `textarea` 欄位，值只能是 `'link'`（其他型別、其他值、table column
都會被發布檢查擋下）。值仍是字串，條件與驗證完全不變。

唯讀畫面（案件詳情等）才會變成連結，填寫畫面維持一般輸入框。只有下列值會變成連結，
其他一律顯示純文字：

| 值                                  | 呈現                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `/` 開頭、但不是 `//` 開頭的站內路徑 | 同一分頁開啟                                         |
| `http://` / `https://` 網址         | 新分頁開啟，`rel="noopener noreferrer"`，並附「（另開新分頁）」提示（`title` 與螢幕閱讀器專用文字） |
| `javascript:`、`data:`、`//host`、含空白或控制字元、含反斜線、帶帳號密碼的網址，以及 `/.//host` 這類 dot segment 化簡後變成 `//` 的路徑 | 純文字 |

判斷邏輯在 `libs/bpm-core-react/src/views/forms/renderer/form-field-link.ts`。
設計器欄位設定的「以連結顯示」。

---

## 8. 節點層級欄位存取（`fieldAccess`）

未設定 `fieldAccess` 的節點行為不變。唯一對所有節點都生效的差異是 `decideTask`：取得 advisory
lock 之後會重讀 task，輸給鎖的那一筆核准現在回 `Task <id> is not pending`（過去用鎖前讀到的舊狀態判斷）。

這一節描述 server 與 shared helper 的行為。案件詳情的補填輸入與 `FormRenderer` 的
`fieldAccess` 見 docs/21 P1／P2，designer 的設定介面見 §2 結尾的說明。

### 8.1 名詞與設定

`fieldAccess` 是 userTask 節點上的清單，每筆 `{ fieldKey, display, fill }`（型別見 §2）。
`display` 為 `SHOW`／`HIDE`；`fill` 為 `NONE`（不補填）、`OPTIONAL`（補填、可留空）、`REQUIRED`（補填、核准前必須有值）。

- **補填欄位**：在任一 userTask 節點被設為 `fill` 不是 `NONE` 的欄位，由流程定義靜態算出
  （`readApproverFilledFieldKeys`）。
- **補填節點**：把某個補填欄位設為 `fill` 不是 `NONE` 的那些節點。同一個欄位在同一條路徑上只能有一個
  補填節點（互斥分支各自一個可以，見 §8.6）。
- **已揭露**：案件在某補填欄位的任一補填節點**建立過非加簽任務**。任務一建立就揭露：財務還在填的時候，
  申請人回頭看已經看得到那塊（唯讀、可能是空的）。
- `fieldKey` 只收頂層欄位。表格整張一起設定：整張表補填時，填的人可以改任何欄、增刪列
  （表格欄級權限不在 V1）。
- **設為補填＝申請人不能填**：終端使用者的送出與重送一律丟棄補填欄位的值（見 §8.4）。
  只有簽核人在核准時能寫。

典型設定：差旅費申請單，區域財務那一關補填 `financeItems`（必填）：

```json
{
  "id": "task_finance",
  "type": "userTask",
  "data": {
    "label": "區域財務",
    "fieldAccess": [
      { "fieldKey": "financeItems", "display": "SHOW", "fill": "REQUIRED" }
    ]
  }
}
```

只要在填寫那一關設「補填」：之前的關還沒揭露、不顯示該欄位；之後的關與申請人回頭看，都是唯讀顯示。

### 8.2 顯示與可補填：由 shared helper 算

`resolveFieldAccess({ definition, fieldKeys, nodeId, isAdhocTask, revealedFieldKeys })` 對每個欄位回
`ResolvedFieldAccess`（`{ visible, editable }`），依序判斷，前者勝：

1. 檢視者在某節點有可處理的**非加簽**任務，且該節點設定有列這個欄位 ⇒ `visible` 為 `display === 'SHOW'`，
   `editable` 為 `fill !== 'NONE'`。
2. 檢視者的任務是加簽任務，且該節點設定有列這個欄位 ⇒ 只取 `display`，`editable` 一律 `false`。
3. 補填欄位、未被第 1／2 點命中：**已揭露 ⇒ 顯示唯讀；未揭露 ⇒ 不顯示**。
4. 一般欄位、未被命中：顯示唯讀（與沒有 `fieldAccess` 時相同）。

- 不看「值是否為空」：host 預填、boolean `false`、預設值都不會讓欄位提早出現。
- 退回後重走（RESTART／FROM_RETURN_POINT）：已揭露狀態不回收，補填值保留並唯讀可見。
  退回重走之後，補填節點之前的關會看到第一輪填的值（唯讀）。
- 申請人、歷程、管理員、已結案案件等「任何一關之外」的檢視，`nodeId` 傳 `null`，只套第 3、4 點。
- 這是**顯示**規則。`display: 'HIDE'` 與表單欄位的 `hidden` 一樣不是權限邊界：查詢結果仍含值。
- 目前 BPM 內建的案件詳情仍以完整 schema 唯讀顯示所有欄位，尚未套用第 3 點。

### 8.3 已揭露怎麼判斷

`readRevealedFieldKeys(definition, nodeIdsWithNonAdhocTask)` 吃的是「建立過非加簽任務的節點 id」。
從活動紀錄算：取 `TASK_CREATED` 的紀錄，且其 `taskId` 對應的 task `isAdhoc === false`，取它的 `nodeId`。

- **不要**用 payload 有沒有 `adhocDirectiveId` 判斷：臨時加簽被拒絕後重開原任務那筆 `TASK_CREATED`
  （payload 帶 `reopenedFromTaskId`）也帶 `adhocDirectiveId`，但那是原節點的一般任務，要算進去。
- 補填節點被 `entryCondition` 排除，或被閘道略過 ⇒ 沒有建立任務，不揭露、核准時也不驗證
  ＝ 這張單不需要補填。流程後段若要讀該欄位，該補填節點就不能帶 `entryCondition`（見 §8.6，發布檢查會擋）。
- 不用 `TOKEN_ADVANCED` 判斷：節點被抵達就會寫，被跳過的節點也會寫，會把「不適用」與「走過」混在一起。

### 8.4 送出與重送（終端使用者與 host）

**終端使用者**（GraphQL `submitApprovalInstance`／`resubmitApprovalInstance`）：mutation 對 service
帶 `endUserSubmission: true`（放在 `...input` 展開之後，也不在 DTO 裡，client 帶不了）。判斷放在
service，因為 mutation 層沒有流程定義，自己去讀 `currentVersionId` 會與發布競態。

- 送出：把補填欄位的鍵從 `formData` 移除。定義取自案件綁定的範本版本，不是範本目前版本。
- 重送：目前存的 `formData` 有這個鍵 ⇒ 用存的值；沒有 ⇒ 刪掉提交的鍵（發起頁種的 `false`、空列不會存進去）。
- 不拒絕、不比對相等：BPM 發起頁會替每個欄位種預設值，拒絕會讓它全部送不出去。
- 補填欄位在送出／重送**只驗形狀**（表格列形狀、成員值形狀），不驗必填、`minRows`、欄必填：
  這些在補填節點核准時才驗。

**host**（直接呼叫 service，不帶 `endUserSubmission`）：送出可以預填補填欄位；重送時 `formData` 整包替換，
沒帶的鍵會消失，見 §8.7。

BPM 自己的發起頁與重送編輯狀態**不渲染、不驗證、不送出**補填欄位（否則申請人填了會被默默丟掉，
且補填表格的 `minRows` 會擋住發起）。已揭露的補填值在重送編輯狀態不顯示（唯讀檢視不受影響）。

### 8.5 核准時補填（`decideTask`）

`DecideTaskInput` 新增：

- `formDataJson?: string | null`：JSON 物件，鍵為頂層 `fieldKey`，部分更新。「有帶」的判準是不為
  `null`／`undefined`，所以 `'{}'` 也算。
- `expectedFormDataFingerprint?: string | null`：原樣帶回讀案件時拿到的 `ApprovalInstance.formDataFingerprint`
  （server 算的指紋；client 不自己算）。GraphQL mutation 在 `formDataJson` 有帶時必填；service 層（host）
  可省略，省略就不做比對。

引擎行為：

1. 取 advisory lock 後重讀 task。
2. `formDataJson` 只能搭配 `APPROVED`、只能來自非加簽任務，每個鍵必須是**本節點可補填**（`fill` 不是 `NONE`）的欄位。
3. 帶了指紋而與目前 `formData` 不同 ⇒ `ConflictException`（防並行分支或 `SET_FORM_FIELD` 在畫面打開後改過值）。
4. 非加簽任務、`APPROVED`、本節點有任何可補填欄位 ⇒ **一律驗證**（對合併後的資料），不論這次有沒有帶
   `formDataJson`（host 預填了表格、財務什麼都沒改直接核准，也要被擋）：表格列形狀、欄必填、`minRows`、
   成員值形狀，加上本節點 `fill: 'REQUIRED'` 的欄位不得為空。「空」＝`undefined`／`null`／trim 後為空字串／
   空陣列（與送出同語意；`false`、`0` 不算空）。引擎沒有一般欄位的型別檢查（`minimum`／`maxLength`
   是前端提示），這裡也沒有新增。
5. 驗證通過、且有鍵真的變了，才把合併結果**先儲存、同步回 `instance`，再簽章與往下推進**：簽章涵蓋補填值、
   後面的閘道讀得到補填值、補填那關就是最後一關時結案也不會把舊值寫回。
6. `TASK_DECIDED` 的 payload 加 `changedFieldKeys`（排序過的鍵名，**不含值**，沒變更就不加）。不放值：
   host 可能把 `TASK_DECIDED` 原樣推給第三方。沒有新增 `ActivityLogEventType`。

`SEQUENTIAL` 節點每位候選人核准都驗，所以**第一位就必須填**。轉簽、代理、管理員改派的接手者照同一份
節點設定。SLA `ESCALATE`→`TRANSFERRED` 不動表單。

通知：`TASK_ASSIGNED`／`TASK_TRANSFERRED` 的 payload 帶 `hasFillableFields`（非加簽任務、節點有可補填
欄位時為 `true`），讓 host 在推播時改成「開啟案件」而不是一鍵同意。舊通知沒有這個鍵，請當作 `false`。

#### 錯誤表一：`decideTask` 新增的拒絕

訊息是穩定契約（host 的 server-to-server 核准會遇到，需要轉譯）。一個請求同時踩到好幾條時，
**不要依賴先回哪一條**（含它們與引擎既有拒絕之間的先後，以及只在 GraphQL mutation 層檢查的那一條）。

| 情境 | 例外 | 訊息 |
| --- | --- | --- |
| 任務已不是待處理（含輸給鎖的並行核准；所有節點都適用） | `ConflictException` | `Task <taskId> is not pending` |
| 僅 GraphQL mutation：帶了 `formDataJson` 沒帶 `expectedFormDataFingerprint`（`'{}'` 也算有帶） | `BadRequestException` | `expectedFormDataFingerprint is required when formDataJson is set` |
| `formDataJson` 搭配非 `APPROVED` | `BadRequestException` | `formDataJson can only be sent with an APPROVED decision` |
| `formDataJson` 不是合法 JSON | `BadRequestException` | `JSON.parse` 的錯誤訊息（依 runtime 而定） |
| `formDataJson` 是合法 JSON 但不是物件（陣列、字串、數字、`null`） | `BadRequestException` | `formDataJson must be a JSON object` |
| 加簽任務帶 `formDataJson` | `ForbiddenException` | `Ad-hoc task <taskId> cannot fill in form fields` |
| 有鍵不是本節點可補填的欄位（鍵名依 JSON 物件順序列出） | `ForbiddenException` | `Workflow node <nodeId> does not let approvers fill in: <key>, <key>` |
| `expectedFormDataFingerprint` 與目前 `formData` 的指紋不同 | `ConflictException` | `Approval instance <instanceId> form data changed; refresh and retry` |

`REJECTED` 且沒有填意見的請求，即使同時帶了 `formDataJson`，先收到既有的
`Reject decision comment is required`（`BadRequestException`），不是上表第三列。

#### 錯誤表二：補填節點核准時的驗證（`BadRequestException`）

第 5 點的驗證只丟 `BadRequestException`，依序檢查，**前一類有問題就不檢查後一類**；成員與表格各類的
多筆訊息以 `; ` 串接。訊息沿用送出時的那一套，host 靠自己呼叫的是哪一支 API 分辨來源。

| 檢查 | 訊息 |
| --- | --- |
| 本節點 `fill: 'REQUIRED'` 的非表格補填欄位為空 | `Form data is missing required fields: <label or fieldKey>, …` |
| 成員欄位的值形狀不對 | `formData.<fieldKey> must be a member id`（單選）／`formData.<fieldKey> must be an array of member ids`（多選） |
| 表格不是列的陣列 | `formData.<fieldKey> must be an array of rows` |
| 列不是物件 | `formData.<fieldKey>[<i>] must be an object` |
| 列裡有不存在的欄 | `formData.<fieldKey>[<i>].<columnKey> is not a table column` |
| 儲存格值不合法 | `formData.<fieldKey>[<i>].<columnKey> is not a valid cell value` |
| 欄必填而儲存格為空 | `formData.<fieldKey>[<i>].<columnKey> is required` |
| 列數不足（`<n>` 為 `minRows`；節點把該表設為 `fill: 'REQUIRED'` 時取 `max(minRows, 1)`；表格沒有值時一律取 `max(minRows, 1)`） | `formData.<fieldKey> must include at least <n> row(s)` |
| 列數超過 `maxRows` | `formData.<fieldKey> must include at most <n> row(s)` |

表格本身設為 `fill: 'REQUIRED'` 時，缺值或空陣列走「列數不足」這一列，不走第一列。

### 8.6 發布檢查

訊息為英文、帶路徑前綴，登記在 `WORKFLOW_LINT_MESSAGES`，zh-TW／en 翻譯在 client 的
`readWorkflowLintMessage`。以下規則**每條都擋發布**。

**只看流程定義**（`lintWorkflowDefinition`）

- 節點仍帶舊鍵 `fieldPermissions`（任何值，含 `[]`）：`legacyFieldPermissions`。這個鍵從未生效，引擎不讀、
  也不自動轉換；已發布版本與案件快照不受影響。designer 提供「移除舊設定」之前，請透過 API 移除後重新設定。
- `fieldAccess` 不是陣列，或有一筆不是物件、`fieldKey` 為空、`display`／`fill` 不是列舉值：只回報形狀那一行，
  該節點的其他欄位存取規則先略過。
- `fieldKey` 重複。
- `fill` 不是 `NONE` 而 `display: 'HIDE'`（`fieldAccessFillHidden`）。
- 補填節點不能用多人決策（`PARALLEL_ALL`／`QUORUM`）。
- 補填節點不能設 `sla.onTimeout: 'AUTO_APPROVE'`（自動核准每次都會被「一律驗證」擋下）。
- 補填節點不能設 `excludeInitiator.whenEmpty: 'SKIP_NODE'`（該關被跳過就沒人補填，案件卻照樣核准；
  要用會指派到別人的選項）。
- `SET_FORM_FIELD` 的 `fieldPath` 第一段是補填欄位。
- 同一個補填欄位的兩個補填節點之間有可達路徑（`approverFilledMultipleFillNodesOnPath`）：後填的會覆寫先填的。
  並行分流（parallelGateway）的兩條分支各自補填同一欄位也算（兩關都會執行）。互斥分支（例如北區、南區財務各走一條）
  不受限，並行 join 之後再分成互斥分支也不受限。

**對照綁定的表單**（發布範本版本時，`validatePublishableVersion`）

- `fieldKey` 必須是表單頂層欄位；`items.price` 這類巢狀路徑以「表單沒有的欄位」擋下。
- 補填欄位在表單層不得設 `required`（`true`）、`requiredWhen`、`visibleWhen`、`readonlyWhen`、
  `hidden`（`true`）、`defaultValue`；每個欄位、每條規則只報一次，不論幾個節點讓它補填。
- 補填欄位不得是選項來源（DataSource）欄位或 `file_upload`；補填欄位是表格時，表格內任何一欄也不得是
  DataSource 欄（decide 不重解選項快照、也不收附件）。
- 節點 `fill: 'REQUIRED'` 的補填欄位不得是 boolean（`false` 是有效答案，會被「為空」檢查擋下）。
- 申請人欄位的 `requiredWhen`／`visibleWhen`／`readonlyWhen` 不得引用補填欄位
  （`applicantRuleReadsApproverFilled`）：送出時補填欄位還是空的，規則只會拿空值比較。
- DYNAMIC_FORM 的 `formPath` 指向補填欄位是 V1 不支援的組合：`formPath` 欄位必須是必填成員欄位，補填欄位
  又禁止必填，所以兩邊的檢查互相衝突，怎麼設都擋（有時兩行同時出現）。

**條件式不能在補填之前讀補填欄位**（發布時以圖可達性判斷，不依賴 CEL 語意）

終端使用者送出後那個鍵不存在；CEL 讀缺鍵會丟錯，在上一關核准的交易裡丟錯，那張單就卡死。結構化條件不丟錯，
但讀到空值，分流結果沒有意義。所以下列來源若在補填之前就可能被求值而引用補填欄位，發布會被擋：

- 邊的 `condition`（CEL）與結構化的 `conditionFieldKey`；
- 節點的 `entryCondition`、`EXPRESSION` approver resolver、`WEBHOOK` payload、`SET_FORM_FIELD` 的值、
  NOTIFY 通知對象的 `EXPRESSION` 運算式。補填節點自己的 `entryCondition`／resolver 運算式也算
  （它們在補填之前跑）。

辨識的寫法：`form.x`、`form["x"]`、`formData.x`（含 `form . x` 空白與其後的 `.y`、`[0]`），`has(form.x)`
也算「讀」。有 `entryCondition` 的補填節點可能被跳過，所以**不算「已補填」**。

- 並行 fork 之後 join 再讀，會被保守地擋下（圖看不出每條分支是否都經過補填節點）。請把補填關移到
  fork 之前。
- 補填之後若選填的補填欄位留空，鍵可能不存在，條件式請用 `has(form.x)` 防護（與其他選填欄位相同）。
  `has(form.x)` 擋不掉「補填之前」的讀取，那一類只能改流程。
- 成員委派的 `scopeConditionCel` 不在範本內，這個檢查管不到：引用補填欄位屬已知限制。
- 已知限制：判斷是正則比對，不認得 raw／跳脫字串當鍵（`form[r"x"]`、`form["\x78"]`）與可選選取
  （`form.?x`）；字串字面值剛好寫成 `form.x`、或 `a. form.x` 會被當成讀取（只會更嚴，不會漏擋已認得的寫法）。
- 已知限制：NOTIFY 的 webhook 參數綁定若用 `from.kind === 'FIELD'` 指向補填欄位，而該 NOTIFY 節點在補填節點
  之前就被走到，參數解析為沒有值；參數宣告為必填時，這筆 delivery 會被記成 `FAILED`
  （`workflow-webhook-enqueue.ts` 的 `resolveParameters`）。早讀檢查不看 webhook 綁定。這類參數只綁在
  補填節點**之後**的 NOTIFY 節點。

### 8.7 給 host 的注意

1. **預填補填欄位只能走 service 層。** GraphQL 送出的補填欄位值會被丟棄。
2. **重送前讀回目前 `formData`，保留補填欄位的值。** service 層重送是整包替換，沒帶的鍵會消失。
3. **表格補填是整張可改。** 需要「只填某幾欄」的 host，讀回時用自己的鍵（例如序號）比對列，並檢查
   自己預填的欄位沒有被改。
4. **核准後要抄回值：** 在 `APPROVED` 之後讀 `formData`；`TASK_DECIDED.changedFieldKeys` 只告訴你哪些鍵變了。
5. **server-to-server 核准會遇到 §8.5 的新錯誤。** 需要轉譯；可用 `resolveFieldAccess` 判斷該節點要不要改成
   「開啟案件」，或讀通知 payload 的 `hasFillableFields`。
