# 23 — 流程表達式開發 Phase

- **狀態**：PLANNED（2026-11-07 規劃；ADR 22 Accepted，獨立安全修補先行）
- **規劃日期**：2026-11-07
- **權威決策**：[22 — ADR：流程表達式與宿主函式](./22-expression-functions-adr.md)
- **完成定義**：所有 Phase gate、安全測試、demo seed 場景、E2E matrix 與文件同步完成

每個 phase 可獨立 ship（typecheck／lint／test／build 全綠），phase 間依序相依。狀態機沿用
`PLANNED → IMPLEMENTING → IMPLEMENTED → VERIFYING → VERIFIED`，VERIFIED 由未參與實作的獨立 verifier 推進。

所有 UI 一律以 `@mezzanine-ui/react` 元件組合，不新增自建元件、不覆寫元件外觀。

## Phase 總覽

| Phase | 交付 | 相依 | 需先確認 | 狀態 |
| --- | --- | --- | --- | --- |
| P0 | 安全修補：錯誤淨化、評估預算、輸出正規化 | 獨立安全修補 | — | PLANNED |
| P1 | 方言欄位與候選引擎差異測試 | P0 | 引擎去留 | PLANNED |
| P2 | AST lint、欄位依賴、schema 型別檢查 | P1 | — | PLANNED |
| P3 | 宿主函式 Registry 與內建函式 | P2 | 內建函式清單 | PLANNED |
| P4 | 設計器：編輯器、preview、函式目錄、AI 助理 | P3 | UI 設計稿 | PLANNED |
| P5 | DataSource／webhook 的 `EXPRESSION` binding | P4 | — | PLANNED |

## 獨立安全修補（不依賴本功能，建議先做）

來源：2026-11-07 安全審查。這些是現有程式的問題，不必等 ADR 22 確認。

| 項目 | 位置 | 修法 |
| --- | --- | --- |
| Dry run 指數遍歷阻塞事件迴圈 | `workflow-engine.service.ts:3070` | 整次模擬加時間預算與 visit 上限；超過回 `valid: false`，權限與 schema 不變 |
| 交易內同步 webhook，可佔住案件鎖並耗盡連線池 | `workflow-engine.service.ts:2969`、`:7813`；`workflow-service-task-dispatcher.token.ts:28` | 派送移到交易 commit 之後；預設 dispatcher 加逾時；dispatcher 介面不變 |
| 先取鎖才檢查參與者；資料庫沒有逾時設定 | `workflow-engine.service.ts:968`、`:2188`；`database/typeorm.config.ts:44` | webhook 移出後不再有長時間持鎖，暫不改動；連線與鎖逾時建議由宿主設定 |
| 路徑 C ad-hoc webhook SSRF | `workflow-engine.service.ts:9729` | 套用 `isWorkflowWebhookUrlAllowed`；不接受呼叫者指定 headers；不回寫回應本文 |
| `/api/chat` 未驗證（信心 7/10，取決於 repo 外的部署設定） | `next/workflow-chat-route.ts:100` | 未啟用回 404；驗證 session；過濾 client 的 `system` 訊息；限制長度與輸出 token |

**Gate**：實機以慢速端點驗證案件操作不再被 webhook 卡住，其他案件與登入不受影響。

## P0 — 安全修補

不新增功能，對既有已發布版本行為不變（錯誤訊息除外）。

**交付**：

- `ConditionService` 淨化引擎錯誤：對外只有錯誤碼與 label，比對不到已知樣式就不抽任何內容。
  這是 hardening：審查確認目前沒有跨越案件讀取邊界，目的是避免值流進 log 或外部通道。
- 檢查所有評估點，確認錯誤沒有另外寫進活動紀錄、通知或 log。
- dry run 評估時套用 root 白名單。
- Runtime 預算：固定腳本 `vm.Script` 加 `timeout`，同時支援單次與單次操作累計。
- 輸出正規化 walker。
- 修正 `docs/05-conditions-cel.md` 的 `contains` 範例，並補上現況限制。

**Gate**：

- 測試：缺欄位錯誤的回應與 log 不含 context 內任何值。
- 測試：巢狀 `map` 在預算內被中斷，回傳穩定錯誤碼，交易回滾，案件狀態不變。
- 測試：`form.constructor` 等非 JSON 結果被拒絕。
- 量測：現有 seed 流程的評估耗時，用來定案預算值。
- 實機：在 `pnpm dev` 下以實際 API 驗證上述錯誤回應與中斷行為。

## P1 — 方言與引擎

**交付**：

- `expressionDialect` 型別、parse、snapshot 讀取；委派規則方言欄位與可回復的 migration。
- `cel-v2` 引擎載入（比照 `loadCelEngine` 的延遲載入）、混合數字運算子、bigint 正規化。
- 差異測試工具：同一批表達式與 context，比較兩個方言的結果與錯誤類別。

**Gate**：

- repo 內所有既有表達式樣式都有差異測試結果；差異逐項列在本文件並判定可接受與否。
- 進行中案件在方言缺少時，路由結果與升級前相同。
- **決策點**：差異不可接受時，停用 `cel-v2`，保留 `cel-js`，繼續 P2 的舊方言可行部分與 P3。

## P2 — AST lint

**交付**：

- 複雜度、root、computed key、整體引用、`fieldPath` 保留片段檢查。
- 由表單 schema 宣告 `form` 欄位型別，以 `env.check()` 檢查存在性與回傳型別。
- `referencesFormField`、`referencesTableInternals` 等在 `cel-v2` 改用 AST；舊方言保留 regex。
- 選填欄位缺 `has()`、隱藏欄位複製到可見欄位、簽核人表達式引用 `form` 的警告。

**Gate**：

- 測試：`form["sec"+"ret"]`、`string(form)`、`__proto__` 路徑都在發布時被擋下。
- 測試：既有已發布版本不被重新 lint。
- 前後端 lint 訊息對應完整（`workflow-lint-errors.ts`）。

## P3 — 宿主函式

**交付**：

- `BPMExpressionFunction` contract、registry token、`BPMRootModule` 選項，未註冊時為空。
- 註冊驗證：命名、拒絕 async、參數與回傳型別。
- 引數複製與凍結、thenable 檢查、回傳驗證、錯誤隔離。
- 內建純函式。
- `apps/api` 示範函式，僅屬 wrapper host。
- 發布 lint 檢查函式與版本是否註冊。

**Gate**：

- 測試：async handler 註冊失敗；回傳 Promise 的 handler 評估失敗。
- 測試：handler 改動引數會丟錯，`formData` 不變。
- 測試：handler 訊息不出現在 API 回應。
- 測試：函式下架後，引用它的新版本無法發布，進行中案件 fail closed。
- `docs/api-reference.md` 同步。

## P4 — 設計器

**交付**：

- 表達式編輯欄位：語法與 lint 回饋、可用欄位與函式目錄。
- `previewExpression`、`expressionCatalog`（皆 `@BPMDesignerOnly()`）。
- 模板方言升級流程與差異提示。
- AI 助理工具與系統提示更新。
- 欄位總覽矩陣標示表達式依賴。

**Gate**：

- 實機：在設計器撰寫、preview、發布、發起案件，走完 `contains` 與宿主函式兩條路徑。
- 測試：非 designer 呼叫 preview 與 catalog 得到 403。
- E2E：表單填入 `<img src=x onerror=...>`，經表達式寫入欄位後，在案件詳情、通知抽屜都以文字顯示。
- `apps/client` 補 CSP 與 `nosniff`，驗證 PDF 預覽與 `form-pattern-worker` 的 blob worker 仍可運作。

## P5 — `EXPRESSION` binding

2026-11-07 產品擁有者同意納入，部分取代 ADR 14、18 的相關條款（範圍見 ADR 22 §3.7）。

**交付**：

- shared 型別、schema 驗證、靜態依賴、循環檢查。
- `form-data-source.validation.ts` 單一實作內評估，search、resolve、submit 共用。
- webhook binding 失敗時記 `FAILED`，不回滾。
- Builder 綁定 UI。

**Gate**：

- 測試：search、resolve、submit 對相同輸入得到相同值與 `bindingHash`。
- 測試：瀏覽器送入的 expression 或 binding 被忽略。
- 測試：預算耗盡時回傳既有 `UNAVAILABLE` 語意，不寫入 instance。
- 實機：以 wrapper host 的 `demo.cost-centers` 驗證依賴欄位變更與重新送出。
