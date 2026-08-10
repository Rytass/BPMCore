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
  readonly fieldPermissions?: readonly FieldPermission[];
  readonly notification?: NotificationOverride;
  readonly returnBehavior: ReturnBehavior;
  readonly sla?: SlaConfig;
}
```

Shared schema 保留完整欄位；目前 designer UI 實際可編輯的是：

- 節點名稱。
- 簽核者來源與 resolver 詳細設定。
- resolver fallback。
- `returnBehavior.resubmitStrategy`、`returnBehavior.requireComment`。
- `sla`（期限、單位、`calendar` 計算方式、`onTimeout`、`escalateLevelsUp`、
  `warningAt`）。
- 多 incoming edge 時的 `triggerMode`。

Designer 目前固定新建節點的 `decisionPolicy` 為 `{ type: 'SINGLE' }`。多人簽核
建議用多個 User Task 節點與拓樸表達，而不是把多人藏在單一節點策略中。

目前 designer 尚未提供 UI 編輯 `description`、`entryCondition`、
`allowAddSigner`、`allowTransfer`、`allowReject`、`fieldPermissions`、
`notification`。這些欄位仍保留在 shared schema 供後續實作與相容資料使用。

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

Designer 目前提供 direct member、position、org-unit member、org-unit position、
initiator manager、specific org-unit manager、dynamic form、expression 等模式。
後端 publish validation 會檢查 resolver 必要欄位是否存在，但不會查詢 member /
position / org id 是否真實存在。

### Service Task

```ts
type ServiceAction =
  | {
      readonly channels: readonly Exclude<NotificationChannel, 'WEBHOOK'>[];
      readonly recipients: ApproverResolver;
      readonly template?: string;
      readonly type: 'NOTIFY';
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

| 規則              | 目前行為                                                    |
| ----------------- | ----------------------------------------------------------- |
| Start             | 必須恰有一個 `startEvent`。                                 |
| End               | 必須至少有一個 `endEvent`。                                 |
| 連通性            | 從 Start 可達節點與必要連線會被檢查。                       |
| User Task         | resolver 必要欄位必須存在。                                 |
| Service Task      | `NOTIFY` 必須有知會對象；其他 action shape 僅 schema 預留。 |
| Exclusive Gateway | split 需要 default outgoing edge；條件 edge 會做 CEL lint。 |
| CEL               | 目前做 parse/lint，不做 context schema 靜態型別推導。       |

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
