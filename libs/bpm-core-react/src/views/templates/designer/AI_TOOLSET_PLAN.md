# 模板設計器 LLM Toolset 抽象化 — 任務計畫

目標：把 React Flow 畫布 / 節點選單 / 屬性表單的所有操作抽象成「型別化 command + JSON Schema toolset」，
讓 LLM 能像使用者一樣操作流程設計器。UI 按鈕與 LLM 走**同一條 dispatch 路徑**。

## 決策（已與使用者確認）

1. 命令顆粒度：**雙層** — 細顆粒原語 (addNode/connectEdge/...) + 高階 macro (insertApprovalStep/...)
2. 純 reducer 放置：**libs/shared**（可被後端複用驗證）
3. 重構範圍：**一次重構** — 現有 UI mutation closure 全改走 command dispatch

## 架構

- `libs/shared`：保持零新增執行期依賴。reducer 為 structure-only，dagre 排版以「可注入後處理」留在 React。

## 工作分解

- [x] P1. `libs/shared/src/lib/workflow-graph.ts` — 純結構轉換已搬移。零 DOM / 零 dagre。typecheck OK。
- [x] P2. `libs/shared/src/lib/workflow-command.ts` — `WorkflowCommand` + `WorkflowMacroCommand` +
      `WorkflowDesignerState` + `applyWorkflowCommand` / `applyWorkflowMacroCommand` / `applyWorkflowCommands`。
      reducer 為 structure-only，topology 變更回傳 `effects.layout` 旗標。
- [x] P3. `libs/shared/src/lib/workflow-toolset.ts` — `WORKFLOW_TOOLSET`（22 tools：mutation/macro/query）+
      `executeWorkflowTool` + `readWorkflowSnapshot`。provider-agnostic JSON Schema。
- [x] P4. index.ts / package.json exports+typesVersions / tsconfig.base.json paths 全部接好（4 subpath）。
- [x] P7. 測試：`workflow-command.spec.ts` + `workflow-toolset.spec.ts`，16 tests 全綠。lint 僅 1 warning。
- [x] P5. `use-workflow-designer-controller.ts`（react）— 持有 state、`dispatch`/`dispatchMacro`/`executeTool`、
      注入 dagre 排版 + `onLayout` viewport callback。typecheck OK（bpm-core-react）。
- [x] P8. 更新 `docs/api-reference.md` — 新增 workflow-graph / workflow-command / workflow-toolset 三段，版本線 bump。
- [x] P6. 重構 `TemplateDesignerView.tsx` — controller 成為 WorkflowDesignerState 唯一擁有者
      （definition/selection/form/policy）；setter shim 保持 SetStateAction 相容讓 render 不需改；
      addNode/connect/delete/rename/approver/serviceAction/triggerMode/edgeCondition/edgeDefault/autoLayout
      全部改走 `controller.dispatch`（與 LLM toolset 同一條 reducer）。移除 435+35 行已搬至 shared 的死碼。
      typecheck(react+client) / lint(0 warning) 全綠。⚠️ 行為等價仍需 dev server 實機驗證。

## 後續（本次未做，屬於 step-2「AI 助理面板」）

- AI 聊天面板 UI：呼叫 `controller.tools`(WORKFLOW_TOOLSET) + `controller.executeTool(name, input)`，
  接 LLM（建議走 Vercel AI Gateway，`provider/model` 字串）的 tool-calling 迴圈。
- 觀察-行動迴圈：每次 tool 回傳 snapshot + issue 餵回模型。
- initiator policy 的結構化 macro（目前僅 `setInitiatorPolicyCel` 原語）。

## 獨立子代理驗證（已完成）

獨立 general-purpose 子代理重跑全部指令 + 審查行為等價，結論「可提交」，並找出 2 點已修正：
- (已修) `workflow-graph.ts` `readInsertedOutgoingEdgeData` 移除未使用的 `_replacedEdge` 參數 → shared lint 回到 0 warning。
- (已修) **重排時機嚴格等價**：原版手動拉線/刪除不重排，故 `connectEdge`/`deleteNode`/`deleteEdge`/
  `setServiceAction` 改回 `NO_EFFECTS`，只有 `addNode`/`autoLayout` 觸發 dagre 重排。新增 spec 鎖定此語意。
- 確認 4 個 lint error 全在未變更的 `package.json`／`BPMNextProviders.tsx`（既有問題）。死碼移除未誤傷。
- 修正後：shared typecheck/lint **0 問題**、test **17 passed**；bpm-core-react/client typecheck 綠。

## 已驗證指令

```
npx nx typecheck shared   # OK
npx nx test shared        # 16 passed
npx nx lint shared        # 0 errors (1 warning: _replacedEdge 保留簽名對稱)
```

## 注意

- shared 是已發布套件 (private:false)；新增 runtime 邏輯 OK，但**不可新增重量級依賴**。
- 忠實搬移：先以現有實作為準，不改語意；重構後跑 typecheck/lint/test 驗證等價。
