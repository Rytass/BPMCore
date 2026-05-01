# 05 — CEL 條件機制

## CEL 是什麼

**CEL (Common Expression Language)** 是 Google 開源的表達式語言，用於設定中允許安全的條件邏輯。

特性：
- 語法接近 TypeScript（易讀）
- **強型別**，發布前可做靜態檢查
- **沙箱** — 沒有迴圈、沒有 I/O、沒有 Turing complete 結構
- **可序列化** — 字串形式儲存，可保存於 DB
- 已有 TS 實作（`cel-js`）

被 Google Cloud IAM、Envoy、Kubernetes 採用。

---

## 1. 基本語法範例

```cel
// 數值比較
form.amount > 1_000_000

// 字串比較
form.region == 'TW'

// 邏輯
form.amount > 100_000 && initiator.org.code == 'FIN'

// 集合
'manager' in initiator.roles
form.region in ['TW', 'JP', 'KR']

// 字串方法
initiator.org.code.startsWith('FIN')
form.email.contains('@example.com')

// 時間
env.now > timestamp('2025-01-01T00:00:00Z')
duration('72h')

// 三元
form.amount > 1_000_000 ? 'CFO' : 'MANAGER'

// 範圍
form.amount >= 100_000 && form.amount <= 1_000_000
```

---

## 2. 在系統內的應用點

| 應用點 | Context | 範例 |
|---|---|---|
| **發起權限** (template) | `subject` | `'manager' in subject.roles && subject.org.code == 'TW01'` |
| **節點進入條件** | `form`, `initiator`, `instance` | `form.amount > 1_000_000` |
| **Sequence Flow 條件** | `form`, `initiator`, `instance`, `lastDecision` | `lastDecision.action == 'approved'` |
| **Approver Resolver** | `form`, `initiator` | `form.region == 'JP' ? 'JP_HEAD' : 'TW_HEAD'` |
| **Form 欄位顯示/必填** | `form` | `form.type == 'urgent'` → 緊急說明欄變必填 |
| **Delegation 條件** | `subject`, `instance`, `template` | `instance.amount < 100_000`（小金額才代理）|

---

## 3. Context Schema 設計

CEL 強型別需要先註冊「**每個應用點當下能存取哪些變數及其型別**」。我們稱之為 **Context Schema**，並依用點分類。

### 3.1 共通型別

```typescript
// 系統共通常駐物件
interface SubjectContext {
  memberId: string;
  name: string;
  email: string;
  org: OrgContext;        // 主要組織
  position: PositionContext;
  roles: string[];         // 系統角色 (system_admin, org_admin, ...)
  customFields: Record<string, unknown>;  // 外部 SSO 提供的擴充欄位
}

interface OrgContext {
  id: string;
  code: string;
  name: string;
  type: string;           // company / division / department / team
  parentId: string | null;
  path: string[];          // 從根到自己的 OrgUnit ID 列表
  costCenter?: string;
  location?: string;
}

interface PositionContext {
  id: string;
  code: string;
  name: string;
  level: number;
}

interface EnvContext {
  now: timestamp;          // 當前時間
}
```

### 3.2 各應用點的 Context

| 應用點 | 變數 |
|---|---|
| **發起權限** | `subject`, `env` |
| **節點進入條件** | `form`, `initiator` (= 發起人 SubjectContext), `instance`, `env` |
| **Sequence Flow 條件** | `form`, `initiator`, `instance`, `lastDecision`, `env` |
| **Approver Resolver** | `form`, `initiator`, `instance`, `env` |
| **Form 欄位條件** | `form`, `initiator`, `env` |
| **Delegation 條件** | `subject` (= 被代理者), `task`, `instance`, `template`, `env` |

### 3.3 `form` 變數的型別

`form` 變數的 schema **依當前模板綁定的 FormDefinitionVersion** 而定。

```typescript
// 範例: 採購申請表單 v3 對應的 form 型別
type FormContextV3 = {
  amount: number;          // 對應 number 欄位
  region: string;          // 對應 select 欄位
  vendor: string;          // 對應 reference_field
  items: Array<{           // 對應 table 欄位
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  attachments: string[];   // 對應 file_upload (回傳 attachment IDs)
  needsCfoApproval: boolean;
  description: string;
};
```

> 模板發布時，CEL 表達式會帶入此型別做**靜態檢查**：引用了不存在的欄位、型別不匹配會在發布前被擋下。

### 3.4 `instance` 變數

```typescript
interface InstanceContext {
  id: string;
  templateId: string;
  templateVersion: number;
  startedAt: timestamp;
  // 流程目前的中繼資料（不含 form / initiator，那兩個獨立提供）
}
```

### 3.5 `lastDecision` 變數

只在 **Sequence Flow 條件** 有效（離開 user task 時）：

```typescript
interface LastDecisionContext {
  taskId: string;
  nodeId: string;
  action: 'approved' | 'rejected' | 'returned';
  comment: string;
  decidedBy: SubjectContext;
  decidedAt: timestamp;
}
```

---

## 4. 自訂函式註冊

CEL 預設函式之外，可註冊自訂函式擴充表達力。

### 規劃中的自訂函式

| 函式 | 用途 | 範例 |
|---|---|---|
| `daysBetween(a, b)` | 計算日期差 | `daysBetween(form.startDate, form.endDate) > 7` |
| `hasRole(member, role)` | 檢查角色 | `hasRole(initiator, 'manager')` |
| `isInOrg(member, orgCode)` | 檢查組織歸屬 | `isInOrg(initiator, 'FIN')` |
| `sumField(items, field)` | 加總表格欄位 | `sumField(form.items, 'unitPrice') > 100_000` |
| `lookupOrg(orgId)` | 查組織 metadata | `lookupOrg(form.targetOrgId).level` |

> 自訂函式必須在 `condition/` 模組內統一註冊，且在 Context Schema 文件中聲明簽章。

---

## 5. 引擎整合

### 5.1 Module 結構

```
condition/
├── cel-evaluator.service.ts       # 包裝 cel-js
├── context-schema.registry.ts     # 註冊各應用點的 schema
├── context-builder.service.ts     # 給定 instance + 應用點 → 組出 context
├── custom-functions.ts            # 自訂函式定義
├── static-checker.service.ts      # 模板發布時的型別檢查
└── condition.module.ts
```

### 5.2 Runtime 評估流程

```typescript
class CelEvaluatorService {
  async evaluate(
    expression: string,
    contextType: ContextType,  // ENTRY_CONDITION / FLOW_CONDITION / ...
    contextData: Record<string, unknown>,
  ): Promise<unknown> {
    // 1. 從 registry 取出該 contextType 的 schema
    const schema = this.registry.get(contextType);

    // 2. 解析表達式 (parse)
    const ast = this.parse(expression);

    // 3. 型別檢查（防 runtime 才炸）
    this.typeCheck(ast, schema);

    // 4. 在 sandbox 中執行
    return await this.execute(ast, contextData, {
      timeoutMs: 100,
      maxSteps: 1000,
    });
  }
}
```

### 5.3 靜態檢查（發布時）

```typescript
class StaticCheckerService {
  async checkTemplate(version: ApprovalTemplateVersion): Promise<CheckResult> {
    const issues: Issue[] = [];
    const formSchema = await this.deriveFormType(version.formDefinitionVersionId);

    // 檢查發起權限
    issues.push(...this.checkExpression(
      version.initiatorPolicyCel,
      ContextType.INITIATOR_POLICY,
      { formSchema },
    ));

    // 檢查每個節點
    for (const node of version.workflowDefinition.nodes) {
      if (node.data.entryCondition) {
        issues.push(...this.checkExpression(
          node.data.entryCondition,
          ContextType.ENTRY_CONDITION,
          { formSchema },
        ));
      }
      // ... approverResolver 的 expression、form 欄位的條件
    }

    // 檢查每條 edge
    for (const edge of version.workflowDefinition.edges) {
      if (edge.data.condition) {
        issues.push(...this.checkExpression(
          edge.data.condition,
          ContextType.FLOW_CONDITION,
          { formSchema },
        ));
      }
    }

    return { ok: issues.length === 0, issues };
  }
}
```

---

## 6. 表達式編輯器（前端）

| 階段 | 體驗 |
|---|---|
| **MVP** | Textarea + 後端即時 lint API（onBlur 呼叫，回傳錯誤） |
| **後期** | Monaco Editor + CEL syntax highlighting + 可用變數 IntelliSense |

CEL 比 JSON Logic 對 IT 設計者門檻略高，所以 IntelliSense 重要性高。

---

## 7. Sandbox 安全限制

| 項目 | 限制 |
|---|---|
| 執行時間 | 100ms |
| AST 步數 | 1000 步 |
| 字串長度 | 表達式 ≤ 1000 字元 |
| 集合大小 | 對 form.items 等陣列存取，限制長度上限 |
| 遞迴深度 | 不適用（CEL 無遞迴） |

執行超限 → 拋例外，記錄 audit log（可能是惡意設計）。

---

## 8. 範例：完整流程的 CEL 應用

模板：「採購申請」

| 位置 | 表達式 | 用途 |
|---|---|---|
| Initiator policy | `subject.org.code.startsWith('PURCH') \|\| 'admin' in subject.roles` | 限定採購部 + admin 可發起 |
| Form 欄位 `cfoNote` 條件顯示 | `form.amount > 1_000_000` | 大金額需填 CFO 備註 |
| 節點 `cfo_review` 進入條件 | `form.amount > 1_000_000` | 小金額跳過 CFO 簽 |
| 節點 `legal_review` 進入條件 | `form.region != 'TW'` | 海外才需法務 |
| Edge `to_urgent_path` 條件 | `form.priority == 'urgent'` | 緊急走加急 |
| Approver resolver `dept_head` 表達式 | `lookupOrg(initiator.org.id).managerMemberId` | 動態取部門主管 |
