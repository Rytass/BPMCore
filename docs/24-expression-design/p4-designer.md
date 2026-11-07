# P4 設計器細部設計：流程表達式編輯、preview、函式目錄、AI 助理、CSP

- **對應文件**：[docs/23 — 流程表達式開發 Phase](docs/23-expression-functions-phases.md) §P4
- **權威決策**：[docs/22 — ADR：流程表達式與宿主函式](docs/22-expression-functions-adr.md)（本文只引用已讀到的條文：§1.1、§3.1、§3.2、§3.7）
- **狀態**：已實作，以 [docs/24](../24-expression-functions-detailed-design.md) 為準；錯誤碼以 docs/24 §2 為準
- **日期**：2026-11-07
- **相依**：P3（宿主函式 registry，提供函式目錄的資料來源）；P0 的錯誤淨化與時間預算（preview 與 dry run 共用）
- **先決條件（阻擋實作）**：docs/23 標註 P4 需「UI 設計稿」。本文沒有設計稿，所有版面都是「文字描述＋元件選型」，需設計確認（見 §12）。

---

## 0. 讀碼範圍與引用說明

每個既有程式的主張都標 `path:line`，行號取自實際讀取；若某行號僅來自摘要而未在本次複核，會標註「未複核」。

已讀取的檔案（本次設計的依據）：

- `docs/23-expression-functions-phases.md`、`docs/05-conditions-cel.md`、`libs/bpm-core-client/src/lib/form/form-pattern-worker.ts`（全檔）
- 其餘行號由前一段工作階段的讀碼與 grep 取得，見各節標註。

---

## 1. 現況盤點（只列與 P4 直接相關者）

### 1.1 設計器沒有任何 CEL 自由文字輸入

- 邊條件只有結構化欄位／運算子／值的建構器：`renderConditionEdgeSettingsForm`（`libs/bpm-core-react/src/views/templates/designer/TemplateDesignerView.tsx` 約 3993）。
- 發起權限 CUSTOM 只有舊版顯示（`TemplateDesignerView.tsx` 約 2537–2545）。
- 觸發條件「前置條件」標籤在 `renderNodeTriggerModePanel`（約 2636，標籤約 2656）。
- 簽核人來源的 `EXPRESSION` 只在下拉中以註解處理（約 2832–2855，註解約 2841）；`approver-resolver-model.ts` 的 `readApproverResolverMode`（約 150）不映射 `EXPRESSION`，EXPRESSION 摘要在約 372。
- 服務動作面板 `renderServiceTaskPanel`（約 3799）只編輯 NOTIFY webhook（約 3884、3900）。
- 試跑對話框 `renderDryRunModal`（約 2358）只顯示 `entryCondition`（約 2442–2446）。

結論：**目前沒有任何元件可以輸入 CEL 自由文字**。P4 的表達式編輯欄位是新增的 UI 能力，不是既有欄位的改版。

### 1.2 設計器的 mutation 單一路徑

- `use-workflow-designer-controller.ts`（186 行）的 `executeTool` 與 `dispatch` 是畫布變更的唯一入口（見 `libs/bpm-core-react/src/views/templates/designer/use-workflow-designer-controller.ts`，全檔已讀）。
- 工具呼叫都在瀏覽器端執行（`workflow-chat-route.ts` 與 `use-workflow-chat.ts` 的設計）。

### 1.3 後端既有 designer-only 模式

- `@BPMDesignerOnly()` 定義於 `libs/bpm-core/src/lib/bpm-auth/bpm-auth.authorization.ts:60–68`，非 designer 回 403。
- designer-only Query 的先例：`libs/bpm-core/src/lib/form-data-source/form-data-source.queries.ts:306–320`（`previewFormFieldOptions`）。
- DTO 命名先例：`form-data-source.queries.ts:141` 的 `@InputType('BPMPreviewFormFieldOptionsInput')`；長度上限先例 `form-data-source.queries.ts:37` 的 `MAX_VALUES_JSON_LENGTH = 8_192`。
- 模板 mutation 類別以 `@BPMDesignerOnly()` 標註：`libs/bpm-core/src/lib/template/template.mutations.ts:16`。

### 1.4 現有 lint 與評估路徑

- `ConditionService.lintExpression` 約 `libs/bpm-core/src/lib/condition/condition.service.ts:95`；`CEL_KEYWORDS` 約 82；`evaluateValue` 於 `:143–170`（已複核），第 167–168 行把 `error.message` 直接丟出為 `BadRequestException`（與 ADR §3.2 衝突，見 §11）。
- 發布 lint：`libs/bpm-core/src/lib/template/template.service.ts:965–1050`，`lintExpressions` 依使用點白名單（`INITIATOR_POLICY_ROOT_IDENTIFIERS`、`WORKFLOW_EXPRESSION_ROOT_IDENTIFIERS`，邊另加 `lastDecision`）。`readNodeExpressions` 約 1760–1790。
- 結構 lint 不含 CEL：`libs/bpm-core/src/lib/template/workflow-definition.validator.ts`。
- dry run 的時間預算與上限：`libs/bpm-core/src/lib/workflow-engine/workflow-engine.service.ts:201–204`（`MAX_DRY_RUN_INPUT_LENGTH = 1_048_576`、`MAX_DRY_RUN_VISITS = 10_000`、`DRY_RUN_TIME_BUDGET_MS = 2_000`；`:203` 已複核）；`runWithinTimeBudget` 於 `:154` 匯入、`:3210` 使用，定義於 `libs/bpm-core/src/lib/workflow-engine/time-budget.ts`。CEL 預熱於 `:3206`（已複核，在預算之外）；失敗回傳於 `:3227`，直接回傳 `error.message`（已複核）。
- 共享 lint 文字表：`libs/shared/src/lib/workflow-graph.ts` 的 `WORKFLOW_EXPRESSION_LABELS`（約 111，路徑格式 `workflow.edges.${edgeId}.data.condition` 等）。
- 表單 `form` 欄位依賴的 regex：`libs/shared/src/lib/field-access-lint.ts:441` 的 `referencesFormField`（publish 端於 `template.service.ts` 約 1647、1677 使用）。

### 1.5 欄位總覽矩陣

- 資料：`libs/shared/src/lib/field-access-matrix.ts`，`FieldAccessMatrixRow` 約 :93–110，`readFieldAccessMatrix` 約 :274。
- 顯示：`libs/bpm-core-react/src/views/templates/designer/field-access-matrix/FieldAccessMatrixDrawer.tsx`，`readCellOptions` 約 312，badge 判斷約 537–605，Table 約 648。

### 1.6 AI 助理

- 設計器抽屜 `workflow-chat-drawer.tsx`（`<style>` 約 184，Textarea 約 220–226）。
- 傳輸 `use-workflow-chat.ts`（69 行，`DefaultChatTransport` 指向 `/api/chat`，未過濾 system 訊息）。
- 路由 `libs/bpm-core-react/src/next/workflow-chat-route.ts`：`createWorkflowChatPOST` 從 body 取 `messages`，**沒有認證、沒有啟用旗標檢查**（docs/23 已列為 P0 SSRF／`/api/chat` 項目）；`WORKFLOW_CHAT_SYSTEM_PROMPT` 是設計器限定的護欄。
- 離線 Chrome 路徑 `chrome-workflow-chat.ts`：`readOfflineSystemPrompt()` 於第 78 行定義，第 188 行以 `initialPrompts` 注入 system 訊息。
- 工具定義 `libs/shared/src/lib/workflow-toolset.ts`：`set_edge_condition` 描述約 363–365；`set_initiator_policy_cel` 約 422–424（接受原始 CEL）；`set_user_task_approver` 約 208–222；`set_service_action` 約 326–333；`WorkflowDirectory` 約 689–695（**沒有表達式相關 hook**）；`WorkflowToolKind` 含 `'query'`（約 64）。
- `AI_TOOLSET_PLAN.md`：發起權限宏（macro）仍列為待辦。

### 1.7 前端 Mezzanine 元件可用性（已讀 .d.ts）

- `Textarea`：`type: 'default' | 'warning' | 'error'`；`readOnly`、`disabled` 只對 `default` 有效。
- `AlertBanner`：有 `severity`，但會浮到頁面頂端（`sticky; top: 0`），**不可用於區塊內說明**。
- `InlineMessage`：`content` prop，用於區塊內說明與警語。
- `AutoComplete`：`options`、`addable`、`searchDebounceTime`。
- `RadioGroup type="segment"` 與 `Radio type="segment"`：分段切換。
- `Badge variant="dot-*" text`：狀態徽章；`Tag` 沒有語意色。

（以上來自 `node_modules/@mezzanine-ui/react` 的 .d.ts 與 Mezzanine skill 的選型規則。）

### 1.8 CSP、worker 與 PDF 現況

- `apps/client/next.config.js`：`output: 'standalone'`、`agentRules: false`；**沒有 `headers()`、沒有 CSP、沒有 middleware**。
- `apps/client/src/app/providers.tsx:12–22`：`PdfWorkerSetup` 以 `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` 設定 worker。
- `apps/client/src/app/layout.tsx`：沒有外部 `<link>` 或外部字型。
- `libs/bpm-core-react/src/components/pdf-preview.tsx:42–52、198`：react-pdf `Document file={fileUrl}`。
- `libs/bpm-core-client/src/lib/form/form-pattern-worker.ts`（已讀全檔）：
  - 第 81–101 行以 blob URL 建立 Worker；`createFormPatternWorker` 在 CSP 不允許 `worker-src blob:` 時會拋錯，被 `try/catch` 接成 `null`（第 114–118 行）。
  - 第 193–200 行 `validateFormRendererValuesInWorker`：無 Worker 或 worker 失敗時**靜默回退到主執行緒，沒有時間限制**（第 226–238 行）。
  - 含義：CSP 設錯時不會報錯，只會悄悄失去逾時保護。**CSP 驗證必須確認 worker 真的有回答，而不是只看頁面能不能用。**
- `apps/client/src/app/api/chat/route.ts`：一行 re-export，`runtime = 'nodejs'`。

---

## 2. 表達式輸入點（P4 範圍內）

P4 只處理設計器中**已存在、且 ADR 允許的** CEL 使用點。P5 的 DataSource／webhook `EXPRESSION` binding 不在本階段。

| # | 使用點 | 設計器位置（既有） | 根識別字（依 docs/05 §2） | P4 行為 |
|---|---|---|---|---|
| E1 | 發起權限 `initiatorPolicyCel` | 發起權限區塊（`renderStartEventPanel` 約 2503；CUSTOM 舊顯示 2537–2545） | `env`、`initiator`、`subject` | 新增 `ExpressionField`，取代 CUSTOM 舊顯示的唯讀文字 |
| E2 | 節點進入條件 `entryCondition` | 節點面板（`renderNodeTriggerModePanel` 約 2636，「前置條件」約 2656） | `env`、`form`、`formData`、`initiator`、`instance` | 新增 `ExpressionField`；試跑 modal 維持顯示 |
| E3 | 邊條件 `condition` | `renderConditionEdgeSettingsForm`（約 3993）與 `renderEdgeSettingsModal`（約 3954） | 同 E2，另加 `lastDecision` | 結構化建構器保留；新增「進階：CEL」切換 → `ExpressionField`（**見 Q3**） |
| E4 | 簽核人 `EXPRESSION` | `renderUserTaskPanel` 來源下拉（約 2832–2855） | 同 E2 | 新增 `ExpressionField`；移除「註解」處理 |
| E5 | 服務動作 `SET_FORM_FIELD` 值 | `renderServiceTaskPanel`（約 3799） | 同 E2（`lastDecision` 不允許） | P4 只做 `SET_FORM_FIELD` 值；NOTIFY 的 recipients 表達式不在 P4，留待 P5 評估（不在 §12 決策清單） |

不納入 P4：委派規則 `scopeConditionCel`（`DelegationsView.tsx` 約 386、821 目前寫 null 且唯讀）。理由：docs/23 P4 的交付沒有列委派；若要做，另開 P4.1。

---

## 3. 共用編輯元件 `ExpressionField`

### 3.1 位置與職責

- 檔案：新增 `libs/bpm-core-react/src/views/templates/designer/expression/ExpressionField.tsx`。
- 職責：只做展示與輸入，**不做 CEL 解析**（ADR §3.1：瀏覽器不執行 CEL）。所有驗證結果來自後端 `previewExpression`。
- 是否算「自建元件」：這是**組合元件**，內部只用 Mezzanine 的 `Textarea`、`InlineMessage`、`AutoComplete`、`Badge`，不覆寫其外觀，符合 CLAUDE.md「以 Mezzanine UI 元件組合實作」。

### 3.2 介面

```ts
// libs/bpm-core-react/src/views/templates/designer/expression/expression-field.types.ts
import type { ExpressionUsagePoint } from '@rytass/bpm-core-shared';

export type ExpressionFieldProps = Readonly<{
  usagePoint: ExpressionUsagePoint;     // E1..E5 對應的使用點
  value: string;
  onChange: (next: string) => void;
  templateVersionId: string;            // 供後端取得表單 schema 與函式目錄
  nodeId?: string;                      // 邊與節點表達式需要
  disabled?: boolean;                   // 只有已發布版本為 true
  onLintStateChange?: (state: ExpressionLintState) => void;
}>;

export type ExpressionLintState = Readonly<{
  status: 'idle' | 'checking' | 'ok' | 'error' | 'unavailable';
  issues: readonly ExpressionIssueView[];
}>;

export type ExpressionIssueView = Readonly<{
  code: ExpressionErrorCode;            // §5.3
  message: string;                      // 後端回傳的 label 化文字，不含 context 值
  severity: 'error' | 'warning';
}>;
```

`ExpressionUsagePoint` 定義在 `libs/shared/src/lib/expression-usage-point.ts`（**新增**，見 §8），是字串聯集：`'INITIATOR_POLICY' | 'ENTRY_CONDITION' | 'FLOW_CONDITION' | 'APPROVER_RESOLVER' | 'SERVICE_FORM_FIELD_VALUE'`。它會取代 `docs/05` §3 中從未被引用的 `ConditionContextType`（已確認未被引用，見 docs/05 §3）。

### 3.3 版面（文字描述，無設計稿）

```
[標籤：發起權限條件]                         [說明：InlineMessage，type 依 lint 狀態]
+------------------------------------------------------------+
| Textarea  (rows 3–6, 等寬字型由 design token 設定)           |
+------------------------------------------------------------+
[AutoComplete：插入欄位／函式]  [ Badge: 語法正常 | 有錯誤 ]
[InlineMessage 列出 issues，每筆附錯誤碼與欄位路徑]
```

- 狀態反映：`Textarea type="error"`（有 error）、`type="warning"`（有 warning）、`type="default"` 其他。`readOnly` 與 `disabled` 只能在 `default` 用（來自 `Textarea.d.ts`），因此**已發布版本（唯讀）必須維持 `type="default"`，錯誤以 `InlineMessage` 呈現**。
- 狀態徽章用 `Badge variant="dot-success"` 或 `dot-error`，不用 `Tag`（符合 Mezzanine 選型鐵則）。
- **字型**：文件原本建議以 design token 設定等寬字型。`Textarea` 的 .d.ts 沒有字型 prop，若要等寬需要覆寫外觀，屬於鐵則 3 禁止的做法。因此**列為設計確認項目**：預設使用 Mezzanine 的字型，等寬需求交由設計決定（見 §12 Q0）。
- 插入欄位與函式目錄用 `AutoComplete`（`options` 來自 `expressionCatalog`），選到項目時在游標處插入文字。

### 3.4 Lint 時機（答 docs/23 的「語法與 lint 回饋」）

| 時機 | 呼叫 | 後端行為 | 說明 |
|---|---|---|---|
| 輸入中（debounce 400 ms） | `previewExpression(mode: 'LINT')` | 只做長度、空白、語法、根白名單 | 不評估，不需要 context，成本低 |
| 離開欄位（blur） | 同上，立即送出 | 同上 | 取消上一個未完成的請求（`signal`） |
| 按「試算」 | `previewExpression(mode: 'EVALUATE', sample)` | 加 context 評估，受時間預算限制 | 顯示結果值與型別 |
| 儲存或發布 | 不由欄位觸發 | 發布 lint 仍以 `template.service.ts:965–1050` 為準 | 欄位的 lint 只是提示，**不可取代發布 lint** |

理由：瀏覽器不能評估 CEL，所以即時回饋必須來自後端；LINT 模式不評估，可以避免每次按鍵都跑表達式。

Debounce 與取消：沿用 `requestGraphQl` 的 `signal` 選項（`libs/bpm-core-client/src/lib/graphql/graphql-client.ts:56–67`，已讀）。

### 3.5 錯誤與 lint 文字的 label

- 欄位錯誤的 `label` 使用 `WORKFLOW_EXPRESSION_LABELS`（`workflow-graph.ts` 約 111），例如 `workflow.edges.<id>.data.condition`。
- 前端訊息表 `workflow-lint-errors.ts` 的 `readWorkflowLintMessage` 必須補上新錯誤碼（docs/23 P2 的 Gate 也要求前後端 lint 訊息對應完整）。

---

## 4. 後端 API

### 4.1 `previewExpression`（Query，designer-only）

**選擇 Query、不是 Mutation**：預覽沒有副作用，`form-data-source.queries.ts:306–320` 已有同類先例。docs/23 寫「`previewExpression`、`expressionCatalog`（皆 `@BPMDesignerOnly()`）」，與此處一致，只是歸類為 Query。

檔案：新增 `libs/bpm-core/src/lib/expression/expression-preview.queries.ts`、`expression-preview.input.ts`、`expression-preview.dto.ts`。

```ts
// expression-preview.input.ts
export const MAX_PREVIEW_EXPRESSION_LENGTH = 2_000;      // 與 ConditionService 預設一致
export const MAX_PREVIEW_CONTEXT_JSON_LENGTH = 8_192;    // 與 form-data-source 先例一致

@InputType('BPMPreviewExpressionInput')
export class BPMPreviewExpressionInput {
  @Field(() => String) @MaxLength(MAX_PREVIEW_EXPRESSION_LENGTH) expression!: string;
  @Field(() => ExpressionUsagePointEnum) usagePoint!: ExpressionUsagePoint;
  @Field(() => ExpressionPreviewMode) mode!: 'LINT' | 'EVALUATE';
  @Field(() => String, { nullable: true }) @MaxLength(MAX_PREVIEW_CONTEXT_JSON_LENGTH) sampleContextJson?: string;
  @Field(() => ID, { nullable: true }) templateVersionId?: string;   // 用來取得 form schema
}
```

```ts
// expression-preview.dto.ts
@ObjectType('BPMExpressionPreview')
export class BPMExpressionPreview {
  @Field(() => Boolean) valid!: boolean;
  @Field(() => [BPMExpressionIssue]) issues!: BPMExpressionIssue[];
  @Field(() => String, { nullable: true }) resultJson?: string;     // EVALUATE 且成功時
  @Field(() => String, { nullable: true }) resultType?: 'boolean' | 'string' | 'number' | 'null' | 'list' | 'map';
}

@ObjectType('BPMExpressionIssue')
export class BPMExpressionIssue {
  @Field(() => String) code!: ExpressionErrorCode;
  @Field(() => String) label!: string;      // 例如 workflow.edges.<id>.data.condition，不含值
  @Field(() => String) message!: string;    // 固定文字，依 code 查表，不含引擎原文
}
```

Query：

```ts
// expression-preview.queries.ts
@Resolver()
export class ExpressionPreviewQueries {
  @BPMDesignerOnly()
  @Query(() => BPMExpressionPreview, { name: 'previewExpression' })
  previewExpression(@Args('input') input: BPMPreviewExpressionInput): Promise<BPMExpressionPreview>;
}
```

行為規則：

1. `mode === 'LINT'`：不需要 `sampleContextJson`；呼叫 `ConditionService.lintExpression`（`condition.service.ts:95`）並套用 `usagePoint` 的白名單。
2. `mode === 'EVALUATE'`：`sampleContextJson` 必須是 JSON 物件，否則回 `EXPRESSION_SAMPLE_INVALID`；評估包在 `runWithinTimeBudget`（`time-budget.ts`）內，預算值見 §4.3。
3. 評估的 context 由 `usagePoint` 決定根物件（與 `buildWorkflowExpressionContext` 相同的形狀），**不得**接受呼叫端指定的根名稱。
4. 回傳的 `resultJson` 必須先經過 P0 的輸出正規化 walker；非 JSON 形狀（例如 `form.constructor`）回 `EXPRESSION_RESULT_NOT_JSON`。
5. 所有錯誤都回 `issues`，**不丟 GraphQL error**，讓前端顯示與 lint 同一套 UI。認證失敗仍由 guard 回 403（既有行為）。

### 4.2 `expressionCatalog`（Query，designer-only）

```ts
@InputType('BPMExpressionCatalogInput')
export class BPMExpressionCatalogInput {
  @Field(() => ExpressionUsagePointEnum) usagePoint!: ExpressionUsagePoint;
  @Field(() => ID) templateVersionId!: string;
}

@ObjectType('BPMExpressionCatalog')
export class BPMExpressionCatalog {
  @Field(() => [BPMExpressionRootEntry]) roots!: BPMExpressionRootEntry[];     // env、form、initiator…
  @Field(() => [BPMExpressionFunctionEntry]) functions!: BPMExpressionFunctionEntry[];  // P3 registry
}

@ObjectType('BPMExpressionRootEntry')
export class BPMExpressionRootEntry {
  @Field(() => String) name!: string;
  @Field(() => [BPMExpressionFieldEntry]) fields!: BPMExpressionFieldEntry[];
}

@ObjectType('BPMExpressionFieldEntry')
export class BPMExpressionFieldEntry {
  @Field(() => String) path!: string;       // 例如 form.amount，必須通過 fieldPath 保留片段檢查（P2）
  @Field(() => String) valueType!: 'string' | 'number' | 'boolean' | 'list' | 'map' | 'unknown';
  @Field(() => String, { nullable: true }) labelKey?: string;   // 表單欄位標籤，供 AutoComplete 顯示
}

@ObjectType('BPMExpressionFunctionEntry')
export class BPMExpressionFunctionEntry {
  @Field(() => String) name!: string;
  @Field(() => String) signature!: string;  // 例如 (string, string) -> bool
  @Field(() => String) version!: string;
}
```

- `roots` 的來源：白名單（§4.4 的常數表）與表單 schema（`templateVersionId` 指向的 `FormDefinitionVersion`）。`initiator`、`instance` 等 snapshot 欄位只列名稱，不列值。
- `functions` 的來源：P3 的 registry。P3 未完成時回空陣列（**P4 不能先於 P3 發布函式目錄**，見 §9）。

### 4.3 時間預算

- preview 的評估預算**與 dry run 分開定義**：`EXPRESSION_PREVIEW_TIME_BUDGET_MS`，預設值待 P0 的實測定案（P0 Gate「量測：現有 seed 流程的評估耗時」）。
- 暫定值：與 `DRY_RUN_TIME_BUDGET_MS = 2_000`（`workflow-engine.service.ts:201–204`）相同，直到 P0 量測為止。**這是臨時值，不是決定**（見 Q1）。
- 注意：`workflow-engine.service.ts:3206` 的 CEL 預熱在預算之外（已複核）。preview 不能複製這個問題：預熱要計入預算，或在預算外另設上限。

### 4.4 白名單常數

- 新增 `libs/shared/src/lib/expression-usage-point.ts`，匯出：

```ts
export const EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT = {
  INITIATOR_POLICY: ['env', 'initiator', 'subject'],
  ENTRY_CONDITION: ['env', 'form', 'formData', 'initiator', 'instance'],
  FLOW_CONDITION: ['env', 'form', 'formData', 'initiator', 'instance', 'lastDecision'],
  APPROVER_RESOLVER: ['env', 'form', 'formData', 'initiator', 'instance'],
  SERVICE_FORM_FIELD_VALUE: ['env', 'form', 'formData', 'initiator', 'instance'],
} as const satisfies Record<ExpressionUsagePoint, readonly string[]>;
```

- 來源是 `docs/05` §2 與 §5 的既有白名單；本常數**取代** `template.service.ts:965–1050` 內散落的白名單（P4 不改發布行為，只把常數集中；發布 lint 改為引用此常數，行為不變）。
- 注意：`docs/05` §5 說明 v0.16.2 之前的版本共用一份白名單，因此新常數**不得**回溯改變既有已發布版本的 lint（docs/23 P2 Gate：既有已發布版本不被重新 lint）。

### 4.5 `ExpressionErrorCode`（P4 使用的錯誤碼）

| 錯誤碼 | 來源 | 對應 ADR §3.2 |
|---|---|---|
| `EXPRESSION_EMPTY` | lint | 既有 |
| `EXPRESSION_TOO_LONG` | lint、DTO `@MaxLength` | 既有（2000 字元） |
| `EXPRESSION_SYNTAX` | parse | 固定訊息，不含 parser 原文 |
| `EXPRESSION_ROOT_NOT_ALLOWED` | 白名單 | 固定訊息，只回根名稱（名稱來自表達式本身，不含值） |
| `EXPRESSION_SAMPLE_INVALID` | preview | 新增 |
| `EXPRESSION_TIME_BUDGET_EXCEEDED` | `runWithinTimeBudget` | 新增，與 P0 的 `TimeBudgetExceededError` 對應 |
| `EXPRESSION_EVALUATION_FAILED` | 執行期錯誤 | **固定訊息**，不回 `error.message` |
| `EXPRESSION_RESULT_NOT_JSON` | 輸出 walker | 新增 |
| `EXPRESSION_FUNCTION_UNAVAILABLE`（P3 之後） | registry | 由 P3 定義 |

規則：`message` 一律由 code 查表產生；`label` 只能是 `WORKFLOW_EXPRESSION_LABELS` 的路徑；**任何錯誤回應都不含 context 的值**（docs/23 P0 Gate）。

---

## 5. 資料流

```
 瀏覽器（設計器）                         GraphQL 端點（本機 localhost:17603，部署同源）   NestJS apps/api
┌────────────────────┐   debounce 400ms   ┌──────────────────────┐   GraphQL   ┌──────────────────────────┐
│ ExpressionField    │───────────────────▶│ requestGraphQl       │────────────▶│ previewExpression (Query) │
│  Textarea          │   signal 可取消    │ (graphql-client.ts)  │             │  BPMDesignerOnly guard    │
│  InlineMessage     │◀───────────────────│                      │◀────────────│  ConditionService.lint    │
│  AutoComplete      │   issues[]         └──────────────────────┘  issues[]   │  runWithinTimeBudget      │
└────────────────────┘                                                       └──────────────────────────┘
```

- 目錄資料：`expressionCatalog` 在進入設計器時載入一次，依 `templateVersionId` 快取；表單 schema 變更時失效。
- 發布路徑不變：發布仍由 `template.service.ts` 的 lint 決定能否發布。
- AI 助理的資料流見 §7。

---

## 6. 版本方言升級 UX（P1 之後）

前提：P1 會在模板與委派規則上加 `expressionDialect`。P4 只做 UI 與流程，不實作方言本身。

建議：

1. **不做就地升級**。升級會建立**新的模板版本**（`templateVersionId` 不變，版本號遞增），既有案件仍綁舊版本；這樣能保證 P1 Gate「進行中案件的路由結果與升級前相同」。
2. 版本列表上標示方言：以 `Badge variant="dot-*"` 顯示「cel-js」或「cel-v2」（不用 `Tag`）。
3. 差異提示：以 `InlineMessage` 列出差異測試的結論（來自 P1 的差異工具），例如「3 條邊條件的錯誤類別改變」。
4. 升級按鈕放在模板版本的操作區，按下後開確認對話框（Mezzanine `Modal`，按鈕配置依既有模式，見 CLAUDE.md「Modal 按鈕配置」）。
5. 差異不可接受時，UI 不顯示升級按鈕，只顯示 P1 決策點的說明（P1 Gate 的 `cel-v2` 停用路徑）。

（Q2 待決定：方言是按模板還是按表達式逐條記錄。）

---

## 7. AI 助理變更

### 7.1 工具（`workflow-toolset.ts`）

| 工具 | 性質 | 說明 |
|---|---|---|
| `preview_expression` | 讀取 | 新增。內部呼叫 `previewExpression`，由瀏覽器執行（與其他工具一樣，沒有伺服器端 `execute`）。 |
| `get_expression_catalog` | 讀取 | 新增。呼叫 `expressionCatalog`。 |
| `set_initiator_policy_cel` | 寫入 | 既有（約 422–424，接受原始 CEL）。**新增**：寫入前必須先呼叫 `preview_expression` 的 LINT，錯誤時拒絕。 |
| `set_edge_condition` | 寫入 | 既有（約 363–365）。不變。 |
| `set_service_action`（SET_FORM_FIELD 值） | 寫入 | 既有（約 326–333）。**新增**同樣的 LINT 前置檢查。 |

- 寫入工具的 LINT 前置檢查放在 `WorkflowToolset` 的參數驗證，而不是只靠系統提示。
- `WorkflowDirectory`（約 689–695）目前沒有表達式 hook；新增 `expressionCatalog` 的唯讀欄位，讓 AI 能列出可用欄位（不列值）。

### 7.2 系統提示

- `WORKFLOW_CHAT_SYSTEM_PROMPT`（`workflow-chat-route.ts`）新增一段：表達式只能用目錄內的根與欄位；不確定時先呼叫 `get_expression_catalog`。
- 離線路徑 `readOfflineSystemPrompt()`（`chrome-workflow-chat.ts:78`，於 `:188` 注入）必須與線上路徑同步；兩者以同一常數產生，避免漂移。

### 7.3 安全邊界（依賴 P0）

- `/api/chat` 目前沒有認證（docs/23 P0 列為 SSRF／未驗證項目，信心 7/10，取決於 repo 外部署）。**P4 的 AI 變更在 P0 的 `/api/chat` 修補完成前不得上線**。
- 客戶端送來的 `system` 訊息必須過濾（P0 項目）；P4 不得依賴客戶端的系統提示來限制權限。
- AI 寫入表達式的權限與人工相同（只能經 `executeTool`，即 `dispatch` 的單一路徑）。

### 7.4 AI_TOOLSET_PLAN.md

- 發起權限宏仍為待辦；P4 不處理宏，只處理 CEL 文字。文件中「宏」與「原始 CEL」的關係需要在 `AI_TOOLSET_PLAN.md` 補一句（P4 完成時更新）。

---

## 8. 欄位總覽矩陣標示表達式依賴

### 8.1 資料

- `libs/shared/src/lib/field-access-matrix.ts` 的 `FieldAccessMatrixRow`（約 :93–110）新增欄位：

```ts
export type FieldAccessMatrixRow = Readonly<{
  // ...既有欄位
  expressionRefs: readonly Readonly<{
    usagePoint: ExpressionUsagePoint;
    label: string;                 // WORKFLOW_EXPRESSION_LABELS 路徑
    fieldPath: string;             // 例如 form.amount
  }>[];
}>;
```

- `readFieldAccessMatrix`（約 :274）為純函式，保持純。表達式字串由呼叫端傳入，**不在這裡讀取資料庫**。
- 偵測來源（過渡期）：`referencesFormField`（`field-access-lint.ts:441`，regex）。P2 完成後改用 AST；P4 的介面不變。

（Q4 待決定：過渡期 regex 的誤判（例如字串常值內含 `form.x`）是否可接受。建議：可接受並在矩陣加註「依文字比對」，P2 後移除註記。）

### 8.2 顯示

- `FieldAccessMatrixDrawer.tsx`：在既有 badge 判斷（約 537–605）之後新增一種 badge，以 `Badge` 呈現（依 Mezzanine 選型規則，這是「是否被引用」的狀態，不是分類，因此不用 `Tag`），文字為「被表達式引用」。
- 點擊 badge 展開 `InlineMessage` 或 `Popover`（不自建）列出引用位置；不做跳轉（跳轉屬 P4 範圍外，見 Q5）。
- Table 的欄位與 `rowActions` 依既有模式，不改版面結構。

---

## 9. CSP、nosniff 與 worker

### 9.1 目前狀態

- 無 `headers()`、無 CSP、無 middleware（`apps/client/next.config.js`）。
- 驗證依據：docs/23 P4 Gate 要求補 CSP 與 `nosniff`，並驗證 PDF 預覽與 blob worker 仍可運作。

### 9.2 Next 官方文件（已讀 CSP 指南的關鍵段落）

- `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`

**待辦**：實作前必須讀完上述兩份文件，確認 Next 16.4 的 nonce 需要 middleware（proxy）與動態渲染。本設計的推論來自摘要，尚未在文件中逐條核對。

### 9.3 建議政策

依 Next 文件 `content-security-policy.md:419–438`（不使用 nonce 的做法）：在 `next.config.js` 的 `headers()` 設定，dev 與 prod 拆開。dev 必須加 `'unsafe-eval'`，文件於第 42 行說明 React 在 dev 會用 `eval` 重建伺服器錯誤堆疊；prod 不需要。

```
X-Content-Type-Options: nosniff
Content-Security-Policy（prod）:
  default-src 'self';
  script-src 'self' 'unsafe-inline';        # 文件 :426 的做法；Next 會注入 inline script
  style-src 'self' 'unsafe-inline';         # 設計器的 <style> 注入（TemplateDesignerView 約 1958、2163；workflow-chat-drawer 約 184）
  img-src 'self' data: blob: <API origin>;
  font-src 'self' data:;
  connect-src 'self' <API origin>;
  worker-src 'self' blob:;                  # form-pattern-worker 的 blob worker
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';

Content-Security-Policy（dev）:             # 與 prod 相同，另加：
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  connect-src 'self' <API origin> ws://localhost:*;   # HMR websocket：未在文件中確認，dev 實機驗證
```

- `dev` 的判斷沿用文件的 `process.env.NODE_ENV === 'development'` 寫法；**不得**在 `.env` 檔設定 `NODE_ENV`（CLAUDE.md、`configuring-nx-nextjs-environment`）。
- `<API origin>`：開發環境為 `http://localhost:17603`；部署環境為同源，預設不需加。
- `worker-src blob:` 必須保留，否則 `form-pattern-worker` 靜默回退（§1.8）。
- `'wasm-unsafe-eval'`：本次只在 `node_modules/pdfjs-dist/package.json` 查無字樣，**未確認 pdfjs-dist 5 是否使用 WebAssembly**，不宣稱需要或不需要；以實機 console 的 CSP 違規為準（§9.5）。
- 文件 :412 明言：只有「嚴格安全要求禁止 `'unsafe-inline'`」時才需要 nonce；本專案目前沒有此要求，因此採文件的非 nonce 做法。

- `<API origin>`：開發環境為 `http://localhost:17603`；部署環境為同源，預設不需加。
- `worker-src blob:` 必須保留，否則 `form-pattern-worker` 靜默回退（§1.8），逾時保護失效而無人察覺。
- `pdfjs` 的 worker 來自同源 `new URL(..., import.meta.url)`（`providers.tsx:12–22`），`worker-src 'self'` 可涵蓋；react-pdf 若使用 `blob:` 取檔需確認 `connect-src` 與 `img-src`（實機驗證）。

### 9.4 Trade-off（需決定，見 Q6）

- 方案 A（建議）：`script-src 'self' 'unsafe-inline'`（文件 :426 的做法），先以 `Content-Security-Policy-Report-Only` 上線一週收集違規，再切為強制。缺點：inline script 仍可執行，對 XSS 的防護主要靠 React 文字輸出與本 P4 的 E2E。
- 方案 B：nonce（文件 :38、:181、:385–397）。需要 proxy 產生 nonce，並且**所有頁面動態渲染**，靜態最佳化與 ISR 停用，PPR 不相容。文件 :412 只在「嚴格禁止 `'unsafe-inline'`」時才建議，目前沒有這個要求。

### 9.5 驗證（P4 Gate 的實機項目）

1. 以 `pnpm dev` 啟動（依 CLAUDE.md，由使用者啟動；agent 不自行啟動 dev server）。
2. 檢查 PDF 預覽能渲染（`pdf-preview.tsx:42–52、198`）。
3. 檢查 `form-pattern-worker` **確實使用 worker**：驗證方式是比對 `validateFormRendererValuesInWorker` 的回應來源，而不是只看頁面可用。建議在測試中注入 `createWorker` 參數（`form-pattern-worker.ts:203`，已有此注入點），並另以瀏覽器 console 的 CSP 違規事件確認沒有 `worker-src` 違規。
4. 無 `Refused to ...` 的 CSP 違規於主要頁面（設計器、案件詳情、通知抽屜）。

---

## 10. XSS E2E

### 10.1 目標（docs/23 P4 Gate）

表單填入 `<img src=x onerror=...>`，經表達式寫入欄位後，在案件詳情與通知抽屜中**以文字顯示**，且 DOM 中不存在被注入的元素。

### 10.2 測試設計

- 檔案：新增 `apps/client-e2e/specs/expression-xss-real.spec.ts`（沿用既有 `*-real.spec.ts` 命名，例如 `form-table-field-real.spec.ts`）。
- 前置：`pnpm demo:reset` 的 seed 不得被修改；測試用的模板由 API 建立（依既有 `template-designer-w3.spec.ts` 的模式）。
- 步驟：
  1. 建立模板，含兩個文字欄位：`note`（發起人填寫）與 `copy`（由表達式寫入）。發起人在 `note` 填入 `<img src=x onerror=window.__xss=1>`。
  2. 節點 `SET_FORM_FIELD` 的值表達式讀取使用者輸入，例如 `form.note`（或字串串接），寫入 `copy`。使用者輸入因此經過表達式，不是測試內寫死的字面值。發布模板。
  3. 發起案件，觸發服務動作。
  4. 斷言 `copy` 欄位：案件詳情頁中該欄位的文字等於原始字串 `<img src=x onerror=window.__xss=1>`；`page.locator('img[src="x"]').count() === 0`；`window.__xss` 為 `undefined`。
  5. 通知抽屜：`libs/bpm-core-react/src/components/notification-drawer.tsx` 目前顯示的是通知的 `title`（約 127、593 行，`resolveDisplayTitle(record)`），**沒有直接顯示表單欄位值**。因此只有當通知標題由含 `copy` 的樣板產生時，步驟 5 才有意義。該樣板的來源**尚未確認**（見 §16）；確認前，通知抽屜的斷言僅驗證「標題為文字、無注入元素」，不宣稱涵蓋表單值。
- 同時斷言 `Content-Security-Policy` 標頭存在（配合 §9）。

### 10.3 注意

- 這個 E2E 需要 dev server 與資料庫，由使用者在 `pnpm dev` 下執行；agent 不啟動伺服器。
- 測試中的 `window.__xss` 只用於偵測，不得在 production 程式碼中留下。

---

## 11. 與 ADR／既有文件的衝突

| 項目 | 位置 | 衝突 | 建議 |
|---|---|---|---|
| dry run 錯誤回傳 `error.message` | `workflow-engine.service.ts:3227`（已複核，`createFailedDryRunResult(... error.message)`） | ADR §3.2 要求固定錯誤碼與訊息 | 屬 P0；P4 的 preview 不沿用此行為 |
| `evaluateValue` 丟出 `error.message` | `condition.service.ts:167–168`（已複核） | ADR §3.2 | 屬 P0；P4 的 preview 經 `ExpressionErrorCode` 轉譯 |
| CEL 預熱在預算外 | `workflow-engine.service.ts:3206`（已複核） | P0 的時間預算 | preview 需計入預算（§4.3） |
| `/api/chat` 未驗證 | `workflow-chat-route.ts`（`createWorkflowChatPOST`） | docs/23 P0 | P4 AI 變更依賴此修補（§7.3） |
| `ConditionContextType` 未被引用 | `libs/shared/src/lib/condition.ts`，`docs/05` §3 | 無 | P4 新增 `ExpressionUsagePoint` 取代其角色；`ConditionContextType` 的處置由 P3 決定 |
| `docs/05` §5 將 v0.16.2 之前與之後的白名單混寫 | `docs/05-conditions-cel.md` | 文件描述不一致 | P4 不改發布行為；文件修正列入 P4 文件同步 |
| 表單版本鎖定的條件判斷範圍 | `libs/shared/src/lib/workflow-graph.ts:1425–1437` `hasConfiguredConditionEdges`；呼叫於 `TemplateDesignerView.tsx:1252` | **已複核，前版敘述有誤**：此函式**同時**檢查 `edge.data.condition`（CEL 字串）與 `conditionFieldKey`、`conditionOperator`、`conditionValue`，不是只看結構化欄位。它只看**來源為 `exclusiveGateway` 的邊**（`isExclusiveGatewaySourceEdge`，`workflow-graph.ts:908–915`）。 | P4 的 E3 表達式寫入 `condition`，已被涵蓋。**唯一風險**：若 P4 允許在非 exclusiveGateway 的邊設定表達式，鎖定就不會觸發。建議：E3 只允許在 exclusiveGateway 出口邊編輯；若產品要開放其他來源，需同步擴充此函式。docs/23 不需因此回寫。 |

---

## 12. 需要產品擁有者決定的事

每題附建議；只列自己無法決定的事。

- **Q0（阻擋）UI 設計稿**：docs/23 P4 註明需要設計稿。沒有設計稿時，本文的版面是文字描述。**建議**：先以本文版面實作零覆寫版本，並請設計確認。
- **Q1 preview 時間預算（已決定，建議即決定）**：EVALUATE 預算不超過 500 ms；暫以 500 ms 實作，P0 seed 量測後調整。LINT 不走評估。**不列入 decisionsNeeded。**
- **Q2 方言升級粒度**：按模板版本整體升級，或逐條表達式升級。**建議**：整體升級（§6），因為 P1 的 Gate 以案件為單位；逐條升級會讓差異難以解釋。
- **Q3 邊條件的 CEL 入口**：是否在 `renderConditionEdgeSettingsForm` 內保留結構化建構器並新增「進階：CEL」切換，或完全改為 CEL 文字。**建議**：保留結構化建構器為預設，「進階」切換為次要入口，避免改變既有使用者的操作（CLAUDE.md：不可更動元件既有 UX 行為）。
- **Q4 矩陣的過渡期偵測（已決定）**：接受 regex 過渡，矩陣加註「依文字比對」，P2 後移除（§8.1）。**不列入 decisionsNeeded。**
- **Q5 矩陣 badge 的跳轉（已決定）**：P4 不做跳轉，只列出位置文字（§8.2）。**不列入 decisionsNeeded。**
- **Q6 CSP 政策**：方案 A（unsafe-inline + Report-Only 先行）或方案 B（nonce 與動態渲染）。**建議**：方案 A（§9.4）。
- **Q7 AI 是否可寫入 `set_service_action` 的 SET_FORM_FIELD 值**：目前 AI 可寫 NOTIFY 與 SET_FORM_FIELD 等服務動作。**建議**：本階段允許，但寫入前必須通過 LINT 前置檢查（§7.1）。
- **Q8 目錄是否列出欄位的標籤（labelKey）（已決定）**：目錄會列出表單欄位名稱與標籤；欄位名稱本身不是機密，但若表單 schema 未對外公開，需確認 designer 權限已足夠。**建議**：只列 designer 權限可讀取的 `FormDefinitionVersion`，與既有 `form-data-source` 的權限一致。

---

## 13. 測試清單

### 13.1 後端（`libs/bpm-core`）

| 測試 | 類型 | 斷言 |
|---|---|---|
| `previewExpression` 非 designer 呼叫 | 整合 | 403 |
| `expressionCatalog` 非 designer 呼叫 | 整合 | 403 |
| LINT 模式：語法錯誤 | 單元 | `EXPRESSION_SYNTAX`，`message` 為固定文字，不含 parser 原文 |
| LINT 模式：超長 | 單元 | `EXPRESSION_TOO_LONG`；DTO 層 `@MaxLength` 也擋下 |
| LINT 模式：未知根 | 單元 | `EXPRESSION_ROOT_NOT_ALLOWED`，依 `usagePoint` 不同結果不同 |
| EVALUATE：context 缺欄位 | 單元 | 回應與 log 不含 context 任何值（P0 Gate） |
| EVALUATE：巢狀 `map` 超預算 | 單元（**真引擎**） | `EXPRESSION_TIME_BUDGET_EXCEEDED`，無副作用 |
| EVALUATE：`form.constructor` | 單元 | `EXPRESSION_RESULT_NOT_JSON` |
| EVALUATE：`sampleContextJson` 非物件 | 單元 | `EXPRESSION_SAMPLE_INVALID` |
| 白名單常數與發布 lint 一致 | 單元 | 發布 lint 改為引用常數後，既有測試全部通過（行為不變） |

**注意**：`libs/bpm-core/jest.config.cts` 的 `moduleNameMapper` 把 `^cel-js$` 對映到 `testing/cel-js.jest.ts`，該替身以 `Function`／`with` 執行（JS 語意，不是 CEL）。**CEL 語意測試不可用替身**，必須採用 `cel-js-list-behaviour.spec.ts` 的子行程真引擎模式，或另開不套用 mapper 的 jest project。

### 13.2 前端（`libs/bpm-core-react`）

| 測試 | 斷言 |
|---|---|
| `ExpressionField` debounce | 連續輸入只送出一次 LINT |
| `ExpressionField` 取消 | 新輸入到達時，舊請求的 `signal` 被 abort |
| `Textarea type` 對應 | 有 error → `type="error"`；已發布版本維持 `type="default"` 且 `readOnly` |
| 矩陣 badge | 表達式引用的欄位顯示 badge；無引用不顯示 |

### 13.3 E2E（`apps/client-e2e`）

- `expression-xss-real.spec.ts`（§10）。
- 實機（docs/23 P4 Gate）：在設計器撰寫 `contains` 與宿主函式兩條路徑，preview、發布、發起案件。`contains` 的正確範例見 `docs/05` §1（`form.email.contains('@example.com')`）；docs/23 P0 也要求修正 `docs/05` 的 `contains` 範例與限制。

### 13.4 CSP

- §9.5 的四項實機檢查。

---

## 14. 檔案清單

### 新增

- `libs/shared/src/lib/expression-usage-point.ts`：`ExpressionUsagePoint`、白名單常數。
- `libs/bpm-core/src/lib/expression/expression-preview.queries.ts`
- `libs/bpm-core/src/lib/expression/expression-preview.input.ts`
- `libs/bpm-core/src/lib/expression/expression-preview.dto.ts`
- `libs/bpm-core/src/lib/expression/expression-catalog.queries.ts`（可與 preview 合併，實作時定案）
- `libs/bpm-core/src/lib/expression/expression-error-code.ts`
- `libs/bpm-core/src/lib/expression/expression-preview.service.ts`
- `libs/bpm-core-client/src/lib/expression/expression-api.ts`（typed client，沿用 `template-api.ts:764–810` 的 `dryRunApprovalWorkflow` 模式）
- `libs/bpm-core-react/src/views/templates/designer/expression/ExpressionField.tsx`
- `libs/bpm-core-react/src/views/templates/designer/expression/expression-field.types.ts`
- `apps/client-e2e/specs/expression-xss-real.spec.ts`

### 修改

- `libs/bpm-core/src/lib/template/template.service.ts`：發布 lint 引用白名單常數（行為不變）。
- `libs/shared/src/lib/field-access-matrix.ts`：`FieldAccessMatrixRow` 新增 `expressionRefs`（約 :93–110）。
- `libs/bpm-core-react/src/views/templates/designer/field-access-matrix/FieldAccessMatrixDrawer.tsx`：新增 badge。
- `libs/bpm-core-react/src/views/templates/designer/TemplateDesignerView.tsx`：E1–E5 的 `ExpressionField` 接入；CUSTOM 舊顯示改寫；`renderConditionEdgeSettingsForm` 加入「進階」入口。
- `libs/bpm-core-react/src/views/templates/designer/approver-resolver-model.ts`：`readApproverResolverMode` 映射 `EXPRESSION`（約 150）。
- `libs/bpm-core-react/src/views/templates/designer/use-workflow-designer-controller.ts`：新工具的 dispatch。
- `libs/shared/src/lib/workflow-toolset.ts`：`preview_expression`、`get_expression_catalog`；寫入工具的 LINT 前置檢查。
- `libs/bpm-core-react/src/next/workflow-chat-route.ts`：系統提示新段落。
- `libs/bpm-core-react/src/views/templates/designer/chrome-workflow-chat.ts`：`readOfflineSystemPrompt`（78）與線上提示同步。
- `libs/bpm-core-react/src/views/templates/designer/AI_TOOLSET_PLAN.md`：補「宏」與「原始 CEL」的關係。
- `libs/bpm-core-client/src/lib/template/workflow-lint-errors.ts`：新錯誤碼的訊息（已確認為唯一路徑）。
- `apps/client/next.config.js`：`headers()`（§9）。
- `docs/api-reference.md`：所有新 export 與 `libs/*/src/**` 變更（CLAUDE.md 維護不變式）。
- `docs/05-conditions-cel.md`：`contains` 範例與限制；白名單文字修正。

---

## 15. 與其他 Phase 的介面

| Phase | P4 依賴 | P4 提供 |
|---|---|---|
| P0 | 錯誤淨化函式、`runWithinTimeBudget` 的預算語意、輸出正規化 walker、`/api/chat` 修補 | `ExpressionErrorCode` 的使用端、preview 的錯誤轉譯 |
| P1 | `expressionDialect` 型別與差異工具 | 方言升級 UI（§6） |
| P2 | AST lint、`env.check()` 的型別結果 | 矩陣的 `expressionRefs` 改用 AST 時介面不變；LINT 結果顯示 |
| P3 | `BPMExpressionFunction` registry | `expressionCatalog.functions`；函式錯誤碼 |
| P5 | `ExpressionUsagePoint` 會增加 binding 點 | P4 的 `ExpressionField` 可重用於 binding 的 `EXPRESSION` 輸入 |

### 型別與函式簽名（給其他 Phase 依賴）

```ts
// libs/shared/src/lib/expression-usage-point.ts
export type ExpressionUsagePoint =
  | 'INITIATOR_POLICY'
  | 'ENTRY_CONDITION'
  | 'FLOW_CONDITION'
  | 'APPROVER_RESOLVER'
  | 'SERVICE_FORM_FIELD_VALUE';

export const EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT: Readonly<
  Record<ExpressionUsagePoint, readonly string[]>
>;

// libs/bpm-core/src/lib/expression/expression-preview.service.ts
export class ExpressionPreviewService {
  preview(input: Readonly<{
    expression: string;
    usagePoint: ExpressionUsagePoint;
    mode: 'LINT' | 'EVALUATE';
    sampleContext?: Readonly<Record<string, unknown>>;
    templateVersionId?: string;
  }>): Promise<BPMExpressionPreview>;

  catalog(input: Readonly<{
    usagePoint: ExpressionUsagePoint;
    templateVersionId: string;
  }>): Promise<BPMExpressionCatalog>;
}

// libs/bpm-core-client/src/lib/expression/expression-api.ts
export function previewExpression(
  input: Readonly<{ expression: string; usagePoint: ExpressionUsagePoint; mode: 'LINT' | 'EVALUATE'; sampleContextJson?: string; templateVersionId?: string }>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<BPMExpressionPreview>;
```

函式回傳型別全部明示，符合 CLAUDE.md 的 TypeScript 規範；實作時禁用 `any`。

---

## 16. 驗證結論與待辦（本次設計的限制）

- 本文件是設計，**未實作、未執行測試、未啟動 dev server**。
- 下列主張仍待複核，實作前必須完成：
  1. 讀完 Next 16.4 的 CSP 與 headers 文件（§9.2）。
  2. 以 `grep -n` 重新定位 `workflow-engine.service.ts` 約 3176–3230、3206 行與 `TemplateDesignerView.tsx` 的各行號（本文件中多數為約略值）。
  3. 確認 `apps/client-e2e/specs/template-designer-w3.spec.ts` 的實際模式（§10、§13.3）。
  4. 確認 `workflow-lint-errors.ts` 所在的確切路徑（§14 列了兩個候選）。
- 未確認的斷言已在內文標註「未複核」或「約」。

---

## 17. 尚未回覆的問題

（本段由主線 agent 轉交時填寫；目前列出設計階段需要產品擁有者決定的事，全文見 §12。）

- Q0 UI 設計稿是否提供，否則以零覆寫文字版實作。
- Q1 preview 時間預算的定案時機。
- Q2 方言升級粒度（整體或逐條）。
- Q3 邊條件是否保留結構化建構器為預設、CEL 為進階入口。
- Q4 矩陣過渡期 regex 誤判是否接受。
- Q5 矩陣 badge 是否要跳轉。
- Q6 CSP 採方案 A（unsafe-inline + Report-Only）或方案 B（nonce）。
- Q7 AI 是否可寫入 SET_FORM_FIELD 值（建議允許，寫入前必須 LINT）。
- Q8 目錄欄位的權限範圍：只列 designer 權限可讀取的 `FormDefinitionVersion`（見 §12 Q8）。
