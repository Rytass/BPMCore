# 流程設計器 AI 助理

流程設計頁（`/templates/<id>/designer`）內建的 LLM 聊天助理：使用者用自然語言
描述一個簽核流程，助理直接在 React Flow 畫布上把流程畫出來、改好。它驅動的是與
UI 按鈕**同一套** workflow toolset，所以「助理能做的 = 使用者在頁面上能做的」。

同一個助理也出現在**建立模板精靈**（`/templates/compose`）的第 2 步「流程設計」——
該步驟內嵌的是 embedded 模式的 designer，AI 入口改放在右側「流程工具」面板的
「AI 協助」按鈕（精靈沒有頂部工具列）。opt-in 條件與 standalone designer 完全相同。

- **可選功能，預設隱藏**（lib 層）。各部署自行 opt-in。
- 沒有 LLM 金鑰時：按鈕顯示為 **disabled 的 placeholder**（「AI 助理（未設定）」），不是壞掉的功能。

## 使用方式

1. 在設計頁右上角點「AI 助理」開啟側邊 Drawer。
2. 用一兩句話描述流程，例如：
   - 「建立三關簽核：部門主管 → 經理 → 財務，金額大於十萬走財務複核」
   - 「在財務覆核前加一個條件分流：金額大於十萬才需要財務覆核，否則直接完成」
   - 「把『財務覆核』的簽核人，用搜尋找名字含『經理』的人來指定」
3. 助理會先讀畫布現況，再呼叫工具把節點、連線、條件畫上去，最後驗證並用一兩句
   話說明做了什麼、哪些地方建議你再確認。
4. 操作鍵：`Enter` 送出、`Shift + Enter` 換行（中文輸入法組字中的 Enter 不會誤送）。

行為要點：
- **畫初稿很果斷**：使用者沒指定簽核人時，預設用「直屬主管」（`ORG_MANAGER`，往上 1 層），
  不需要真實會員 id —— 純預設畫出的流程也能通過驗證，不會卡著反覆追問。
- **指定真實的人/部門**：點名某人時，助理會先用 `search_members` / `list_org_units` /
  `list_positions` 查到真實 id 再設定。
- **條件分流一定保留「其他情況」**：exclusiveGateway 必須有一條 `isDefault` 的 else 出口，
  缺了驗證會擋下、助理會主動補上。
- **只做這個頁面的事**：與設計流程無關的請求（閒聊、寫程式、查天氣…）一律婉拒。

## 架構

工具呼叫**必須在瀏覽器執行**（因為要改 React 端的畫布狀態），所以採「server 持金鑰跑模型、
client 執行工具」的分工：

```
[AI Drawer]  useChat (@ai-sdk/react)
   |  1. 送出訊息
   v
[POST /api/chat]  streamText + OpenAI(@ai-sdk/openai, 直連, 無 Gateway)
   |  宣告 WORKFLOW_TOOLSET 為 tools(無 server execute) + 嚴格 system prompt
   |  2. 串流模型的 tool-call
   v
[useChat.onToolCall]  controller.executeTool(name,input)  <-- 改 React 畫布狀態
   |  3. 回傳 snapshot 餵回模型  -> 自動續送，迴圈直到不再呼叫工具
   +-- 與 UI 按鈕走同一個 applyWorkflowCommand reducer
```

- **Toolset（純層）**：`@rytass/bpm-core-shared` 的 `WORKFLOW_TOOLSET`（mutation / macro /
  query 工具，provider-agnostic JSON Schema）、`executeWorkflowTool`、`readWorkflowSnapshot`。
  零資料依賴；組織資料（會員/組織/職位）由 host 透過 `WorkflowDirectory` 注入。
- **Server route**：`@rytass/bpm-core-react/next/workflow-chat-route` 的 `createWorkflowChatPOST`。
  `apps/client/src/app/api/chat/route.ts` 是一行 re-export。
- **Client**：設計頁的 `useWorkflowDesignerController`（`executeTool` / 注入 directory）、
  `WorkflowChatDrawer`、`useWorkflowChat`。
- **離線備援（實驗）**：偵測到 Chrome 內建 AI（Prompt API）時提供 on-device 模式；偵測不到則隱藏。

詳細 export 清單見 [api-reference.md](./api-reference.md) 的
`@rytass/bpm-core-shared/workflow-toolset` 與 `@rytass/bpm-core-react/next/workflow-chat-route`。

## 設定（環境變數）

都是 **Next.js client host 的 server-only env**（`apps/client`，不是 `apps/api`；
**絕不可** 加 `NEXT_PUBLIC_` 前綴）：

| 變數                       | 必填 | 預設            | 用途                                                        |
| -------------------------- | ---- | --------------- | ----------------------------------------------------------- |
| `BPM_AI_ASSISTANT_ENABLED` | 是   | （未設＝隱藏）  | `'true'` 才會顯示 AI 助理按鈕。預設隱藏，各部署 opt-in。     |
| `OPENAI_API_KEY`           | 是   | —               | OpenAI 金鑰。沒設則按鈕顯示為 disabled placeholder。         |
| `BPM_LLM_MODEL`            | 否   | `gpt-5.4-mini`  | OpenAI model id（可填 `openai/` 前綴，會自動去除）。         |

元件層 props（`TemplateDesignerView`，供直接整合者控制）：

| Prop                   | 預設    | 行為                                                    |
| ---------------------- | ------- | ------------------------------------------------------- |
| `showAiAssistant`      | `false` | 是否顯示按鈕。父層傳 `false` 可完全隱藏整個功能。       |
| `aiAssistantAvailable` | `true`  | 後端是否已設定金鑰。`false` → 按鈕 disabled + placeholder。 |

designer 的 page shim（`pages/templates/designer`）會自動把上述 env 換成這兩個 prop：
`showAiAssistant = BPM_AI_ASSISTANT_ENABLED === 'true'`、`aiAssistantAvailable = Boolean(OPENAI_API_KEY)`。
建立模板精靈的 page shim（`pages/templates/compose`）以同樣方式把 env 傳給
`TemplateComposeWizardView`，再往下傳到第 2 步的 embedded designer。

## 本地開發

在 `apps/client/.env.local`（已被 gitignore，**勿提交**）：

```bash
BPM_AI_ASSISTANT_ENABLED=true
OPENAI_API_KEY=sk-...
# 選填
# BPM_LLM_MODEL=gpt-4o
```

改了 `.env.local` 後需重啟 `pnpm client`（Next.js 啟動時才載入 env）。

## 部署（Staging / GKE）

client 容器的 env 由 `tools/deployment-staging.yml` 注入：

```yaml
# client container
env:
  - name: BPM_AI_ASSISTANT_ENABLED
    value: 'true'
  - name: OPENAI_API_KEY
    valueFrom:
      secretKeyRef:
        name: vault-secret
        key: OPENAI_API_KEY
        optional: true   # 無金鑰也不會崩，僅顯示 disabled placeholder
```

金鑰值寫進 cluster 的 `vault-secret`（**不進 git**）：

```bash
# 從檔案讀值、不在 shell 留痕（PF 指向一個臨時 patch 檔）
kubectl patch secret vault-secret -n bpm-core-staging --type merge \
  --patch-file <(printf '{"stringData":{"OPENAI_API_KEY":"%s"}}' "$OPENAI_API_KEY")
```

> `optional: true` 讓「設 secret」與「push 部署」順序解耦：即使 key 還沒設，新 pod 也能
> 正常啟動（AI 只是顯示為未設定）。要立即可用就先 patch secret 再 push。

注意：**runtime 依賴需宣告在 root `package.json`**。Docker 在 `COPY . .` 前就先裝 root 依賴，
`ai` / `@ai-sdk/react` / `@ai-sdk/openai` 因此同時列在 root 與 `libs/bpm-core-react`。

部署流程（push `staging` → GitHub Actions → build images → `kubectl apply` + rollout）見
[infrastructure.md](./infrastructure.md)。

## 安全

- LLM 金鑰只在 server 端（route / 容器 env），瀏覽器拿不到。
- 模型只被授予 `WORKFLOW_TOOLSET`（無 web / file / 其他能力），加上 server 端的嚴格
  system prompt → 天然限縮在「設計這個流程」。
- system prompt 放 server，較難被 client 訊息竄改。
