# 21 — 簽核人補填欄位開發 Phase

- **狀態**：PLANNED（2026-10-21 規劃；ADR 20 Accepted）
- **規劃日期**：2026-10-21
- **權威決策**：[20 — ADR：簽核人補填欄位](./20-approver-filled-fields-adr.md)
- **介面設計稿**：<https://claude.ai/artifact/66grS2TYLEdEuumygeMatE>（PR2-1～PR2-4、PR3-1、PR3-3；PR3-2 已不採用）
- **完成定義**：所有 Phase gate、demo seed 場景、E2E matrix 與文件同步完成

每個 phase 可獨立 ship（typecheck／lint／test／build 全綠），phase 間依序相依。狀態機沿用
`PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，VERIFIED 由未參與實作的獨立 verifier 推進。

所有 UI 一律以 `@mezzanine-ui/react` 元件組合（main 目前為 1.7.0），不新增自建元件、不覆寫元件外觀；
樣式只透過 design tokens 調整自己的版面元素。

## Phase 總覽

| Phase | 交付 | 分支／PR | 相依 | 狀態 |
| --- | --- | --- | --- | --- |
| P0 | PR1 收尾：`fieldPermissions` → `fieldAccess`、申請人規則檢查、lint label 集中 | #109（推到作者 fork 分支） | — | IMPLEMENTED |
| P1 | FormRenderer 逐欄位顯示／可編輯、檢視者欄位權限計算 | PR2（疊在 #109 之上） | P0 | IMPLEMENTED |
| P2 | 案件詳情補填流程：輸入、驗證、同意、衝突、任務與歷程 | PR2 | P1 | PLANNED |
| P3 | 設計器：欄位與關卡總覽矩陣、`setFieldAccessMatrix` command、節點面板摘要、舊鍵提示 | PR3（疊在 #109 之上） | P0 | PLANNED |
| P4 | E2E golden path、demo seed、文件、發布 | PR2／PR3 合併後 | P2、P3 | PLANNED |

P1–P2 與 P3 互不相依，可以並行。

## P0 — PR1 收尾（#109）

**Scope**

- `libs/shared/src/lib/workflow.ts`：新增 `FieldAccessEntry`、`UserTaskNodeData.fieldAccess`；`FieldPermission` 與
  `fieldPermissions` 標 `@deprecated`，註明「從未生效，發布會被擋」。
- `libs/shared/src/lib/field-permissions.ts` 改名為 `field-access.ts`，依 ADR 20 §3.2 對照表改 helper 與型別名稱；
  `readNodeFieldAccess` 容錯讀取 `display`／`fill` 列舉，不讀舊鍵。
- 引擎（`workflow-engine.service.ts`）、通知（`requiresForm` → `hasFillableFields`）、`template.service.ts`、
  `workflow-definition.validator.ts`、client（`workflow-api.ts`、`workflow-lint-errors.ts`）、react
  （`approver-filled-form.ts`）全部改讀 `fieldAccess`。
- 發布 lint 調整：
  - 新增 `legacyFieldPermissions`：任何節點含 `fieldPermissions` 即擋。
  - 新增 `fieldAccessFillHidden`：`fill !== 'NONE'` 而 `display: 'HIDE'`。
  - 新增 `applicantRuleReadsApproverFilled`：申請人欄位的 `requiredWhen`／`visibleWhen`／`readonlyWhen`
    引用任一補填欄位（ADR 20 §3.4 最後一列）。
  - 新增 `approverFilledMultipleFillNodesOnPath`：同一欄位的兩個補填節點之間有可達路徑（ADR 20 §4 第 6 點）；
    互斥分支各自補填不受限。
  - 移除「`fieldPath` 含 `.`／`[`」與「`required` 而不可填」兩條（型別已無法表達）。
- lint label：`readNodeExpressions`／`readEdgeFieldReadLabels` 產生的 label 改由 `libs/shared` 匯出的函式產生，
  server 與 client 翻譯表共用；補一個 spec 斷言兩端對同一個定義產生相同 label。
- 文件：`docs/08-frontend-schema.md` §2、§8 全面改用新名稱；`docs/api-reference.md` 依新匯出更新；
  `docs/09-roadmap.md` 一行改名。

**Gate**

- `pnpm typecheck && pnpm lint && pnpm test` 全綠；新增的三條 lint 各至少一個正反向 test。
- 回歸：含舊鍵 `fieldPermissions` 的**已發布版本**與**案件快照**在引擎中完全無效（送出不剝鍵、核准不驗證），以 spec 釘住。
- #109 既有的 Playwright spec（`workflow-launch-entry`、`workflow-linear-w5`）本機實跑通過。
- 推送前向使用者確認；推送到 `coollugi/BPMCore` 的 `coollugi/field-permissions`（`maintainerCanModify: true`），
  commit 依 scope 拆分。

## P1 — 逐欄位顯示與可編輯（PR2 前半）

- **狀態**：IMPLEMENTED（2026-10-21）。`FormRenderer` 的 `fieldAccess` 以自有屬性讀取（欄位鍵 `constructor` 不會讀到原型鏈）；
  `readActingTask`（`detail/sections/shared.ts`）取代兩處各自挑選任務的程式；`readFillValidationSchema` 放在
  `views/instances/approver-filled-form.ts`。檢視者計算尚未接到案件詳情畫面，由 P2 接上。

**Scope**

- `FormRendererView.tsx`：新增選填 prop `fieldAccess?: Readonly<Record<string, { visible: boolean; editable: boolean }>>`。
  - 未傳時行為完全不變。
  - `visible: false` 的欄位不渲染（與 `hidden` 同一條過濾路徑，`FormRendererView.tsx:165` 附近）。
  - `editable: false` 的欄位唯讀；`editable: true` 的欄位即使整份表單 `readonly` 也可編輯
    （`fieldReadonly` 計算處，`:309`）。表格欄位的新增列、刪除列跟著該欄位的可編輯狀態（`:603-661`）。
- `libs/bpm-core-react/src/views/instances/viewer-field-access.ts`（新檔）：
  - `readRevealedNodeIds(activityLogs, tasks)`：`TASK_CREATED` 且 `taskId` 對到 `isAdhoc === false` 的 task，取 `nodeId`
    （docs/08 §8.3，不看 payload 的 `adhocDirectiveId`）。
  - `readViewerFieldAccess({ instance, tasks, activityLogs, actingTask })` → `resolveFieldAccess` 的結果。
    `actingTask` 為 `null`（申請人、管理員、已結案）時套 ADR 20 §3.3 第 3、4 點。
- `readFillValidationSchema(schema, node)`：只留本節點可補填欄位，`fill: 'REQUIRED'` 的欄位設 `required: true`；
  表格欄位交給既有的 `max(minRows, 1)` 規則。供 `validateFormRendererValues` 使用，與 server 錯誤表二對齊。
- 「可處理的任務」挑選改為：同一位檢視者同時有加簽與一般任務時，優先取一般任務（目前取第一筆，
  `InstanceDetailView.tsx:376`、`InstanceTasksSection.tsx:255`）。

**Gate**

- FormRenderer：不傳 `fieldAccess` 的既有 302 個 react spec 全數不變。
- 新增 spec：隱藏、唯讀、整份 readonly 中單一欄位可編輯、表格增刪列跟隨可編輯狀態。
- `readViewerFieldAccess`：申請人（未揭露／已揭露）、補填節點簽核人、同節點加簽者、後續節點簽核人、
  退回重走後（揭露不回收）、加簽被拒後重開原任務，各一個 case。

## P2 — 案件詳情補填流程（PR2 後半）

對應設計稿 PR2-1～PR2-4。

**Scope**

- 狀態上提：補填值 `fillDraft`、補填錯誤、`formDataFingerprint` 由 `InstanceDetailView` 持有，傳給
  `InstanceFormSection`（顯示與輸入）與 `InstanceTasksSection`（送出）。
- 表單 Section（PR2-1）：
  - `FormRenderer` 傳入 `fieldAccess` 與 `value = { ...instance.formData, ...fillDraft }`。
  - 本關有補填欄位時，Section 頂端放 `InlineMessage severity="info"`：「本關需要你補填 N 個欄位，按『同意』時會一起送出並納入簽章。」
  - 補填欄位 label 旁放 `Tag readOnly size="minor"`：檢視者是填寫者時寫「本關補填」，其他人寫「<節點名稱>補填」。
- 同意（PR2-2、PR2-3）：
  - 頁首「同意」先以 `readFillValidationSchema` 驗證；不通過不開 Modal，顯示欄位錯誤、`focusFormRendererField`
    到第一個錯誤，並以 `Message` 提示「還有 N 個補填欄位需要完成」。
  - 通過後開既有同意 Modal，上方以 `Description` 列出將一併送出的補填欄位摘要（表格顯示列數，數字欄位可加總時顯示合計）。
  - 「送出同意」呼叫 `decideTask({ ..., fill: { formData: 本關可補填鍵, expectedFormDataFingerprint } })`。
    本關有補填欄位時一律帶 `fill`（即使沒有修改），讓 server 端驗證與指紋比對都生效。
  - `ConflictException`（`form data changed; refresh and retry`）：關閉 Modal，Section 內顯示
    `InlineMessage severity="error"` 與「重新載入」按鈕；重新載入後 `fillDraft` 疊回新資料，不清空。
  - server 回錯誤表二的訊息：轉成欄位錯誤（`formData.<key>[<i>].<col>` 路徑沿用 `readFormTableCellPath`）。
- 加簽任務、後續節點、申請人（PR2-4）：依 `fieldAccess` 唯讀或不顯示；不出現輸入框與 InlineMessage。
- 任務 Section：新增「補填」欄，節點有可補填欄位且任務未完成時顯示 `Badge variant="dot-warning" text="需補填 N 欄"`。
- 歷程 Section：`TASK_DECIDED.payload.changedFieldKeys` 存在時，於該筆下方加一行「補填 N 個欄位：<label>、<label>」
  （只列欄位名稱，不顯示值）。
- 重送編輯狀態：沿用 #109 的 `readApplicantFormSchema`，改為 `fieldAccess` 驅動（補填欄位不顯示輸入）。
- 通知抽屜快速同意（`components/notification-drawer.tsx:88`、`:311-330`）：目前直接呼叫 `decideTask` 且不帶 `fill`，
  補填節點的任務一定會被 server 以「缺少必填」擋下。通知 payload 的 `hasFillableFields` 為 `true` 時，
  把「同意」動作換成「開啟案件」（導向案件詳情），不顯示快速同意 Modal。舊通知沒有此鍵，當 `false` 處理。
- 待辦清單（`InboxView`）：任務列顯示 `Badge variant="dot-warning" text="需補填"`。清單查詢需要帶出
  「該任務的節點是否有可補填欄位」：在 `TaskEntity` 的 GraphQL 型別加計算欄位 `hasFillableFields`
  （非加簽且節點 `readNodeFillableFieldKeys` 非空，讀 instance 快照；以 DataLoader 批次載入 instance，
  避免清單 N+1），client `TaskRecord` 與待辦查詢一併選取。這一項動到 bpm-core，需同步更新 `docs/api-reference.md`。

**Gate**

- react spec：補填輸入與一般欄位唯讀並存、驗證失敗不開 Modal、送出帶 `fill`、衝突後保留草稿、
  加簽者看不到輸入框、歷程顯示 `changedFieldKeys`。
- 真實介面驗證（`pnpm dev`，由使用者啟動）：以 demo seed 的差旅單跑完 PR2-1～PR2-4 四個畫面，截圖附在 PR。

## P3 — 設計器（PR3）

對應設計稿 PR3-1（節點面板）與 PR3-3（欄位與關卡總覽）。PR3-2 的單節點抽屜不實作（ADR 20 §3.3：設定介面以欄位為主軸）。

**Scope**

- `libs/shared/src/lib/workflow-command.ts`：
  - `setFieldAccessMatrix { entries: { nodeId, fieldKey, display, fill }[] }`：一次寫入多個節點，未出現在 `entries`
    的節點 `fieldAccess` 清空；只作用於 userTask。
  - `removeLegacyFieldPermissions { nodeId }`。
  - `workflow-toolset.ts` 同步提供給 AI 助理，system prompt 註明「隱藏不是權限」。
- shared 純函式 `readFieldAccessMatrix(definition, schema)`：回傳列（欄位）× 欄（依流程拓撲順序的 userTask 節點）的格子，
  每格含 `{ explicit: FieldAccessEntry | null, effective: '填寫' | '唯讀' | '不顯示' | '隱藏' | '補填（選填）' | '補填（必填）', reason }`，
  以及每列的問題清單（與發布 lint 共用同一套判斷，含 ADR 20 §4 第 6 點）。矩陣畫面與 lint 不各寫一份規則。
- 節點面板（PR3-1，`renderUserTaskPanel` 尾端）：
  - 標題「欄位顯示與補填」與 `Button size="sub"`「開啟欄位總覽」。
  - 摘要三行：本關補填 N 個（必填 M）、本關隱藏 N 個、其他欄位依預設。
  - 節點含舊鍵時：`InlineMessage severity="warning"` 與「移除舊設定」按鈕（不自動轉換，ADR 20 §5.2）。
  - 決策方式為 `PARALLEL_ALL`／`QUORUM`、逾時 `AUTO_APPROVE`、`excludeInitiator.whenEmpty: 'SKIP_NODE'`
    而本節點已有補填欄位時：`InlineMessage severity="warning"` 說明衝突。
- 欄位與關卡總覽（PR3-3）：設計器工具列另放「欄位總覽」入口，以 `Drawer size="wide"` 開啟。
  - 頂端 `InlineMessage severity="warning"` 彙總待處理問題；沒有問題時改為 `severity="info"`，說明補填與隱藏的語意。
  - `Toggle`「只看有設定或有問題的欄位」，預設開啟；下方以文字說明收起了幾個欄位。
  - `Table`：欄位（label + fieldKey）、申請人（唯讀文字：填寫，或「不顯示（關卡 N 補填）」）、各 userTask 節點一欄、檢查。
    - 節點欄標頭顯示「關卡 N」與節點名稱；互斥分支的節點並列，標頭註明分支條件名稱。
    - 每格為 `Select size="sub"`，選項：預設、顯示、隱藏、補填（選填）、補填（必填）。選「預設」＝該節點不寫這筆。
      未設定的格子以「預設：<推導結果>」顯示推導值。
    - 不能補填的欄位停用兩個補填選項（`file_upload`、DataSource、含 DataSource 欄的表格、表單層有
      `required`／`requiredWhen`／`visibleWhen`／`readonlyWhen`／`hidden`／`defaultValue`）；boolean 只停用「補填（必填）」。
      原因寫在檢查欄。
    - 節點決策方式不允許補填時，該欄的補填選項停用。
    - 檢查欄：`Badge variant="dot-success" text="沒有問題"`、`dot-info`（提示，例如「關卡 1 會看到空白欄位」）、
      `dot-warning`（會擋發布，例如「兩個關卡都會補填，後者會覆寫前者」）。
  - 底部 `bottomPrimaryActionText="套用"`、`bottomGhostActionText="取消"`；套用時 dispatch 一次 `setFieldAccessMatrix`。
  - 欄位清單取 `webhookFormSchema`（`TemplateDesignerView.tsx:1184`），涵蓋 embedded 模式與未存的表單草稿。
  - 元件抽成 `views/templates/designer/field-access-matrix/` 下的新檔，不加長 `TemplateDesignerView.tsx`。
- 節點卡片：有補填或隱藏設定時顯示 `Tag readOnly size="minor"`（例如「補填 2 · 隱藏 1」）。
- 設計器前端檢查（`readWorkflowDefinitionIssue`）改用 `readFieldAccessMatrix` 的問題清單，讓儲存前就看得到；
  其餘仍由發布 lint 擋。

**Gate**

- shared spec：`setFieldAccessMatrix`（多節點寫入、未列節點清空、只作用於 userTask）、`removeLegacyFieldPermissions`；
  `readFieldAccessMatrix` 的推導值與問題清單，以及與發布 lint 結果一致的對照 test。
- react spec：選「預設」不寫入、停用條件、問題標示、篩選開關、套用前不改 state、舊鍵移除。
- 真實介面驗證：在設計器以總覽設定差旅範本的財務節點並發布成功；故意讓兩個串接關卡補填同一欄位，確認被標示且無法發布。

## P4 — E2E、demo seed、文件與發布

**Scope**

- demo seed（`pnpm demo:reset`）：新增「差旅費申請」範本，財務節點補填 `financeItems`（表格、必填）與
  `financeNote`（選填），另一關隱藏 `costCenter`。
- Playwright spec `workflow-approver-fill.spec.ts`，matrix：

| # | 情境 | 期望 |
| --- | --- | --- |
| E1 | 申請人發起 | 發起頁不出現補填欄位 |
| E2 | 主管（補填節點之前）檢視 | 補填欄位不顯示 |
| E3 | 財務未填必填就按同意 | 不開確認視窗，錯誤定位到表格 |
| E4 | 財務填寫後同意 | 案件推進；歷程顯示補填欄位名稱 |
| E5 | 財務長檢視 | 補填值唯讀顯示，`costCenter` 依設定隱藏 |
| E6 | 財務開啟後另一分頁改了資料再同意 | 顯示「資料已變更」，重新載入後草稿保留 |
| E7 | 財務節點加簽者檢視 | 只看得到、不能輸入 |
| E8 | 退回重走 | 補填值保留唯讀；財務第二輪可修改 |
| E9 | 設計器以欄位總覽設定並發布 | 發布成功；兩個串接關卡補填同一欄位時被標示且無法發布 |
| E10 | 舊鍵草稿發布 | 被擋，訊息指向 `fieldAccess`；移除後可發布 |

- 文件：`docs/08` §8 移除「UI 尚未提供」的說明；`docs/09-roadmap.md` 勾選；`docs/api-reference.md` 補 FormRenderer
  `fieldAccess` prop、新 command 與 helper，並在發版後更新「Last verified against」。
- 發布：依 CLAUDE.md「Releasing」兩段式流程；發布後以 registry curl 逐一確認四個套件。

**Gate**

- E1–E10 全綠；`pnpm e2e:client` 全套不退步。
- 獨立 verifier 依本文件逐 phase 推進 VERIFIED。

## 待決

- 設計稿為私人 artifact，由擁有者自行分享（2026-10-21）。

## 已知風險

- `FormRendererView.tsx` 是共用元件，P1 的 `fieldAccess` 一旦有 bug 會影響所有表單畫面；P1 gate 要求既有 spec 全數不變。
- `InstanceDetailView` 與 `InstanceTasksSection` 之間以 imperative handle 溝通，P2 的狀態上提會動到兩個大檔
  （約 1000 行與 1200 行）；PR 需要拆成「上提」與「補填 UI」兩個 commit 方便 review。
- `TemplateDesignerView.tsx` 已 5645 行；P3 的 Drawer 與面板區塊應抽成同目錄的新檔，不再加長主檔。
