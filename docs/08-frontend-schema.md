# 08 — 前端工作流 JSON Schema (React Flow)

`WorkflowDefinition` 與 React Flow 的資料結構直接對齊，前端拖拉的結果可直接序列化送到後端。

---

## 1. 頂層結構

```typescript
interface WorkflowDefinition {
  // React Flow 標準欄位
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  // 流程級設定
  meta: {
    schemaVersion: 1;          // 此 schema 自身的版本
    diagramVersion?: string;   // 流程圖的設計版本（顯示用）
  };
}
```

---

## 2. 節點類型 (WorkflowNode)

```typescript
type WorkflowNode =
  | StartEventNode
  | EndEventNode
  | UserTaskNode
  | ServiceTaskNode
  | ExclusiveGatewayNode
  | ParallelGatewayNode;

interface BaseNode {
  id: string;                          // 唯一 ID（前端產生）
  position: { x: number; y: number };  // React Flow 座標
  data: { label: string };             // 顯示文字
}
```

### 2.1 Start Event

```typescript
interface StartEventNode extends BaseNode {
  type: 'startEvent';
  data: {
    label: string;
  };
}
```

### 2.2 End Event

```typescript
interface EndEventNode extends BaseNode {
  type: 'endEvent';
  data: {
    label: string;
    endState?: 'APPROVED' | 'REJECTED';  // 該結束點對應的 instance 狀態，預設 APPROVED
  };
}
```

> 一個流程可有多個 End Event，分別代表不同結局。

### 2.3 User Task（簽核節點）

```typescript
interface UserTaskNode extends BaseNode {
  type: 'userTask';
  data: {
    label: string;
    description?: string;

    // 簽核者解析
    approverResolver: ApproverResolver;

    // 簽核策略
    decisionPolicy: DecisionPolicy;

    // 進入條件（不滿足則跳過）
    entryCondition?: string;  // CEL

    // 退回行為
    returnBehavior: {
      allowReturn: boolean;
      allowedTargets: 'PREVIOUS' | 'INITIATOR' | 'ANY';  // 可退回的範圍
    };

    // 加簽 / 轉派
    allowAddSigner: boolean;
    allowTransfer: boolean;
    allowReject: boolean;       // 是否允許拒絕（部分節點只能同意/退回）

    // SLA
    sla?: SlaConfig;

    // 表單欄位節點級權限
    fieldPermissions?: FieldPermission[];

    // 通知客製
    notification?: NotificationOverride;
  };
}

type ApproverResolver =
  | { type: 'DIRECT'; memberIds: string[] }
  | { type: 'POSITION'; positionId: string }
  | { type: 'ORG_MANAGER'; levelsUp: number; baseFromInitiator: boolean }
  | { type: 'DYNAMIC_FORM'; formPath: string }    // 例：'form.projectOwner'
  | { type: 'EXPRESSION'; expression: string };    // CEL 回傳 member_id 或 member_id[]

type DecisionPolicy =
  | { type: 'SINGLE' }
  | { type: 'SEQUENTIAL' }
  | { type: 'PARALLEL_ALL' }
  | { type: 'PARALLEL_ANY' }
  | { type: 'QUORUM'; threshold: number; thresholdType: 'COUNT' | 'PERCENTAGE' };

interface SlaConfig {
  duration: string;              // ISO 8601 duration: 'P3D', 'PT2H'
  warningAt?: number;            // 0~1，達 % 時提醒
  onTimeout: 'REMIND' | 'AUTO_APPROVE' | 'ESCALATE' | 'TERMINATE_INSTANCE';
  escalateLevelsUp?: number;     // onTimeout = ESCALATE 時用
}

interface FieldPermission {
  fieldPath: string;
  visible: boolean;
  editable: boolean;
}

interface NotificationOverride {
  channels?: ('IN_APP' | 'EMAIL' | 'WEBHOOK')[];
  customTemplate?: string;
}
```

### 2.4 Service Task（知會 / 系統動作）

```typescript
interface ServiceTaskNode extends BaseNode {
  type: 'serviceTask';
  data: {
    label: string;
    action: ServiceAction;
    entryCondition?: string;
  };
}

type ServiceAction =
  | { type: 'NOTIFY'; recipients: ApproverResolver; channels: ('IN_APP' | 'EMAIL')[]; template?: string }
  | { type: 'WEBHOOK'; url: string; headers?: Record<string,string>; payload?: string /* CEL */ }
  | { type: 'SET_FORM_FIELD'; fieldPath: string; value: string /* CEL */ };  // 系統寫回表單欄位
```

### 2.5 Exclusive Gateway (XOR)

```typescript
interface ExclusiveGatewayNode extends BaseNode {
  type: 'exclusiveGateway';
  data: {
    label: string;
    direction: 'split' | 'join';  // join 不需要條件，純合流
  };
}
```

### 2.6 Parallel Gateway (AND)

```typescript
interface ParallelGatewayNode extends BaseNode {
  type: 'parallelGateway';
  data: {
    label: string;
    direction: 'split' | 'join';
  };
}
```

---

## 3. Edge

```typescript
interface WorkflowEdge {
  id: string;
  source: string;          // sourceNodeId
  target: string;          // targetNodeId
  type?: 'smoothstep';     // React Flow edge type，預設 smoothstep
  data: {
    label?: string;
    condition?: string;    // CEL，僅 XOR 出邊有意義
    isDefault?: boolean;   // XOR default flow
  };
}
```

---

## 4. 完整範例

### 4.1 簡單請假流程

```json
{
  "meta": { "schemaVersion": 1, "diagramVersion": "v1" },
  "nodes": [
    {
      "id": "start",
      "type": "startEvent",
      "position": { "x": 100, "y": 200 },
      "data": { "label": "開始" }
    },
    {
      "id": "task_manager",
      "type": "userTask",
      "position": { "x": 300, "y": 200 },
      "data": {
        "label": "直屬主管簽核",
        "approverResolver": { "type": "ORG_MANAGER", "levelsUp": 1, "baseFromInitiator": true },
        "decisionPolicy": { "type": "SINGLE" },
        "returnBehavior": { "allowReturn": true, "allowedTargets": "INITIATOR" },
        "allowAddSigner": false,
        "allowTransfer": true,
        "allowReject": true,
        "sla": { "duration": "P3D", "warningAt": 0.7, "onTimeout": "REMIND" }
      }
    },
    {
      "id": "end_approved",
      "type": "endEvent",
      "position": { "x": 500, "y": 200 },
      "data": { "label": "完成", "endState": "APPROVED" }
    }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "task_manager", "type": "smoothstep", "data": {} },
    { "id": "e2", "source": "task_manager", "target": "end_approved", "type": "smoothstep", "data": {} }
  ]
}
```

### 4.2 含條件分歧 + 會簽

```json
{
  "meta": { "schemaVersion": 1 },
  "nodes": [
    { "id": "start", "type": "startEvent", "position": {"x":100,"y":200}, "data": { "label": "開始" } },

    { "id": "task_manager", "type": "userTask", "position": {"x":250,"y":200},
      "data": {
        "label": "部門主管",
        "approverResolver": { "type": "ORG_MANAGER", "levelsUp": 1, "baseFromInitiator": true },
        "decisionPolicy": { "type": "SINGLE" },
        "returnBehavior": { "allowReturn": true, "allowedTargets": "INITIATOR" },
        "allowAddSigner": false, "allowTransfer": true, "allowReject": true
      }
    },

    { "id": "xor_amount", "type": "exclusiveGateway", "position": {"x":400,"y":200},
      "data": { "label": "金額分歧", "direction": "split" } },

    { "id": "and_split", "type": "parallelGateway", "position": {"x":550,"y":150},
      "data": { "label": "會簽分流", "direction": "split" } },

    { "id": "task_finance", "type": "userTask", "position": {"x":700,"y":100},
      "data": {
        "label": "財務簽核",
        "approverResolver": { "type": "POSITION", "positionId": "FINANCE_HEAD" },
        "decisionPolicy": { "type": "SINGLE" },
        "returnBehavior": { "allowReturn": true, "allowedTargets": "PREVIOUS" },
        "allowAddSigner": false, "allowTransfer": false, "allowReject": true
      }
    },

    { "id": "task_legal", "type": "userTask", "position": {"x":700,"y":200},
      "data": {
        "label": "法務簽核",
        "approverResolver": { "type": "POSITION", "positionId": "LEGAL_HEAD" },
        "decisionPolicy": { "type": "SINGLE" },
        "returnBehavior": { "allowReturn": true, "allowedTargets": "PREVIOUS" },
        "allowAddSigner": false, "allowTransfer": false, "allowReject": true
      }
    },

    { "id": "and_join", "type": "parallelGateway", "position": {"x":850,"y":150},
      "data": { "label": "會簽合流", "direction": "join" } },

    { "id": "task_cfo", "type": "userTask", "position": {"x":1000,"y":150},
      "data": {
        "label": "CFO 簽核",
        "approverResolver": { "type": "POSITION", "positionId": "CFO" },
        "decisionPolicy": { "type": "SINGLE" },
        "returnBehavior": { "allowReturn": true, "allowedTargets": "PREVIOUS" },
        "allowAddSigner": false, "allowTransfer": false, "allowReject": true
      }
    },

    { "id": "end_approved", "type": "endEvent", "position": {"x":1150,"y":200},
      "data": { "label": "完成", "endState": "APPROVED" } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "task_manager", "type": "smoothstep", "data": {} },
    { "id": "e2", "source": "task_manager", "target": "xor_amount", "type": "smoothstep", "data": {} },
    { "id": "e3", "source": "xor_amount", "target": "and_split", "type": "smoothstep",
      "data": { "label": "金額 > 100萬", "condition": "form.amount > 1000000" } },
    { "id": "e4", "source": "xor_amount", "target": "end_approved", "type": "smoothstep",
      "data": { "label": "其他", "isDefault": true } },
    { "id": "e5", "source": "and_split", "target": "task_finance", "type": "smoothstep", "data": {} },
    { "id": "e6", "source": "and_split", "target": "task_legal", "type": "smoothstep", "data": {} },
    { "id": "e7", "source": "task_finance", "target": "and_join", "type": "smoothstep", "data": {} },
    { "id": "e8", "source": "task_legal", "target": "and_join", "type": "smoothstep", "data": {} },
    { "id": "e9", "source": "and_join", "target": "task_cfo", "type": "smoothstep", "data": {} },
    { "id": "e10", "source": "task_cfo", "target": "end_approved", "type": "smoothstep", "data": {} }
  ]
}
```

---

## 5. 前端設計器架構

```
templates/[id]/designer
├── DesignerCanvas (React Flow)
│   ├── 自訂 nodeTypes
│   │   ├── StartEventNode
│   │   ├── EndEventNode
│   │   ├── UserTaskNode (顯示節點 label + 簽核者摘要)
│   │   ├── ServiceTaskNode
│   │   ├── ExclusiveGatewayNode (菱形 + X)
│   │   └── ParallelGatewayNode (菱形 + +)
│   └── 自訂 edgeTypes
│       └── ConditionalEdge (顯示條件 label)
├── NodePalette (左側拖拉區)
├── PropertiesPanel (右側屬性面板)
│   ├── 節點選中 → 顯示對應屬性表單
│   └── 邊選中 → 顯示 condition / isDefault
├── Toolbar
│   ├── 儲存 (DRAFT)
│   ├── 發布 (publish)
│   ├── Dry Run
│   ├── 版本歷程
│   └── 自動排版（dagre）
└── ValidationPanel (底部，顯示 lint 錯誤)
```

### 5.1 節點屬性面板要支援的設定（User Task）

- 節點名稱、描述
- **簽核者解析器**
  - 切換 5 種類型（DIRECT / POSITION / ORG_MANAGER / DYNAMIC_FORM / EXPRESSION）
  - 對應的設定 UI
- **簽核策略** + threshold（QUORUM）
- **進入條件** (CEL textarea + lint)
- **退回設定**
- **權限**：是否允許加簽 / 轉派 / 拒絕
- **SLA**：duration + onTimeout
- **欄位權限**：勾選哪些欄位本節點可看 / 可編
- **通知客製**

### 5.2 即時驗證

設計器開啟 onChange 即時 lint：
- 流程結構檢查（孤立節點、未連線、無法到達 End）
- AND Join 配對檢查
- XOR default flow 缺失警告
- CEL 表達式語法 / 型別檢查（呼叫後端 lint API）

---

## 6. 流程結構驗證規則

模板發布前要通過所有檢查：

| 規則 | 檢查內容 |
|---|---|
| 唯一 Start | 流程必須恰有一個 startEvent |
| 至少一個 End | 流程必須至少有一個 endEvent |
| 連通性 | 從 Start 出發必能走到至少一個 End |
| 無孤立節點 | 每個節點都要被連到 |
| AND Join 配對 | 每個 AND Join 的入邊應源自同一個 AND Split（最簡規則）|
| 無循環迴路 | 不允許未受控的回邊（DAG 化處理）|
| XOR 出邊 | 至少 2 條出邊，且需有 default flow |
| CEL 表達式 | 所有 CEL 通過型別檢查 |
| Resolver 存在 | DIRECT 的 member_id、POSITION 的 position_id 都存在於系統 |

---

## 7. 與後端的對應

前端送出的 `WorkflowDefinition` JSON 直接存入：
```
approval_template_versions.workflow_definition (jsonb)
```

引擎執行時不直接查表，而是讀取 `approval_instances.workflow_snapshot`（發起時拷貝）。

> 引擎內部的「節點操作」只認 node.id 與 node.type，不依賴 React Flow 的 position 等視覺欄位 — 視覺欄位純粹給前端渲染用。
