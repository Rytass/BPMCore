# 09 — 開發路線圖

## 里程碑總覽

| 里程碑 | 主題                                             | 預估 | 累計 |
| ------ | ------------------------------------------------ | ---- | ---- |
| **M0** | 專案初始化                                       | 1 週 | 1    |
| **M1** | 基礎骨架（Identity / Org / Form / Template）     | 3 週 | 4    |
| **M2** | 流程引擎核心                                     | 4 週 | 8    |
| **M3** | 人本能力（代理、通知、SLA、簽章、附件、Inbox）   | 3 週 | 11   |
| **M4** | 管理與優化（Dry Run、欄位權限、Dashboard、加簽） | 2 週 | 13   |
| **M5** | 內部試運行 + 修正                                | 2 週 | 15   |

> 預估以一位資深全端 + 一位後端 + 一位前端為基準。可平行工作的部分已標註。

---

## M0 — 專案初始化（1 週）

### 任務

- [ ] Nx Monorepo 初始化（`apps/api`, `apps/client`, `libs/shared`）
- [ ] NestJS API 專案骨架（health check、logging、global exception filter）
- [ ] Next.js Web 專案骨架（基礎 layout、auth middleware）
- [ ] PostgreSQL 連線（TypeORM 或 Prisma — 建議 TypeORM 配合 NestJS 慣例）
- [ ] Migration 工具設定
- [ ] ESLint / Prettier / commitlint / Husky
- [ ] Docker compose（PG + minio + adminer）
- [ ] CI: GitHub Actions（lint + build + test）
- [ ] 共用型別 lib（`@bpm/shared-types`：Workflow JSON Schema、Form Schema、CEL Context Types）

### 驗收

- 本機 `pnpm api` / `pnpm client` 啟動 API + client + db
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通過

---

## M1 — 基礎骨架（3 週）

### W1 — Identity + Organization

**Backend**

- [ ] `member_metadata_cache` 表 + migration
- [ ] `MemberResolver` interface + Mock 實作（給開發用）
- [ ] `IdentityModule`：member 查詢 + cache（TTL 5 分鐘）
- [ ] `org_units`、`positions`、`memberships`、`manager_resolutions` 表 + migration
- [ ] `OrganizationModule`：CRUD + 樹狀查詢（用 ltree）
- [ ] 主管解析 service（含優先序邏輯）

**Frontend**

- [ ] `/admin/orgs` 組織樹維護介面
- [ ] `/admin/users` 會員清單（從 mock resolver 拉）
- [ ] 共用元件：`<MemberPicker>`, `<OrgUnitPicker>`

**驗收**：能維護組織樹、查到任一 member 的所屬組織與主管。

### W2 — Form Builder

**Backend**

- [ ] `form_definitions`、`form_definition_versions` 表
- [ ] `FormModule`：CRUD + 版本管理（fork、publish、archive、rollback）
- [ ] FormSchema 驗證器（內含欄位類型 registry）
- [ ] 表單 schema lint API（給 designer 用）

**Frontend**

- [ ] `/forms` 列表頁
- [ ] `/forms/[id]/builder` 表單設計器
  - 拖拉欄位（基本 6–8 種：text / number / date / select / radio / checkbox / file / textarea）
  - 屬性面板（標籤、必填、預設值）
  - 條件邏輯（顯示/必填/唯讀，先用簡單表達式輸入框）
- [ ] FormRenderer 元件（根據 schema 渲染表單）

**驗收**：能建立表單、發布版本、用 FormRenderer 渲染並填寫。

### W3 — Approval Template + 版本管理

**Backend**

- [ ] `approval_templates`、`approval_template_versions` 表
- [ ] `TemplateModule`：CRUD + 版本管理（fork、publish、rollback）
- [ ] 流程結構靜態驗證器（先做基本：唯一 Start、連通性、AND Join 配對）
- [ ] `ConditionModule` 雛型：CEL evaluator + Context Schema registry
  - 整合 `cel-js`
  - 註冊核心 Context Types
  - 簡易型別檢查

**Frontend**

- [ ] `/templates` 列表頁
- [ ] `/templates/[id]/designer` 流程設計器（**核心，本週重點**）
  - React Flow 整合
  - 6 種節點類型 + 自訂渲染
  - 節點屬性面板
  - Edge 條件編輯
  - 自動排版（dagre）
  - 儲存 / 發布按鈕
- [ ] `/templates/[id]/versions` 版本歷程

**驗收**：能用設計器拉出流程、設定簽核者、發布模板版本、查看版本歷程。

---

## M2 — 流程引擎核心（4 週）

### W4 — 引擎基礎結構

**Backend**

- [ ] `approval_instances`、`workflow_tokens`、`tasks`、`task_decisions` 表
- [ ] `WorkflowEngineModule` 骨架
- [ ] Instance 發起（submit）：驗證 + snapshot（template, form, initiator metadata）
- [ ] Token 建立（Start Event）
- [ ] 引擎主迴圈骨架（含 Advisory Lock 並發保護）
- [ ] Activity Log 寫入

**驗收**：能建立 instance、Start Event 產生 token、紀錄 activity log。

### W5 — 線性節點處理

**Backend**

- [ ] Start Event / End Event 處理
- [ ] User Task 處理（含 Approver Resolver 5 種類型，先不含 Delegation）
- [ ] Service Task — `NOTIFY` 類型（先不接外部）
- [ ] User Task 單一主要簽核者處理（設計器固定 `decisionPolicy: SINGLE`）
- [ ] Task 決策 API（同意 / 拒絕，先無簽章）
- [ ] Token advance / consume
- [ ] Instance 完成判定

**Frontend**

- [x] `/instances/new?templateId=xxx` 發起頁（FormRenderer）
- [x] 發起入口補強
  - [x] `/instances/new` 無 `templateId` 時顯示「可發起模板」列表，使用者選模板後進入填表。
  - [x] 工作台 `/` 的主操作改為「發起簽核」，導向 `/instances/new`。
  - [x] `/templates` 列表在已發布模板上提供「發起」捷徑，導向 `/instances/new?templateId=xxx`。
  - [x] `/inbox` 提供次要「發起簽核」入口，導向 `/instances/new`，但不作為唯一入口。
  - [x] 未發布、未綁定已發布表單版本、或沒有 current published version 的模板不得作為可發起選項。
- [x] `/instances/[id]` 簽核操作頁（基礎版）
  - 顯示表單快照（唯讀）
  - 顯示流程圖（React Flow 唯讀模式 + token 位置標示）
  - 顯示歷程（task_decisions + activity_logs）
  - 同意 / 拒絕按鈕（限該 task 的 assignee）
- [x] Inbox 雛型（`/inbox`）

**驗收**：能從工作台或已發布模板進入發起頁，跑通「請假流程」線性 case：發起 → 主管簽 → 完成。

### W6 — Gateway + 平行/條件

**Backend**

- [x] Exclusive Gateway 處理（含 default flow）
- [x] 多分支 outgoing edge 處理
- [x] 節點前置條件 `AND` / `OR` 處理（全部前置完成 / 任一前置完成）
- [ ] CEL 在 Edge / Entry Condition / Approver Resolver 整合

**Frontend**

- [x] `/instances/[id]` 唯讀流程圖，顯示節點 runtime 狀態
- [x] 條件線 / default flow label 顯示
- [x] pending / completed / cancelled / waiting 節點狀態顯示

> W6 runtime 目前執行設計器產出的 structured edge condition 欄位，不直接執行完整 CEL parser。`edge.data.condition` 保留作為畫布顯示與相容欄位；完整 CEL runtime 整合延後到 Dry Run / expression runtime 階段一併收斂。

**驗收**：能跑通含 XOR + 多前置節點 AND/OR 的流程；條件分歧基於表單內容正確路由。

### W7 — 退回 / 重送 / Dry Run

**Backend**

- [ ] 退回（target = previous / initiator / specific node）
- [ ] 退回後重新提交（重跑 vs 從退回點繼續，依模板設定）
- [ ] 撤銷 instance
- [ ] **Dry Run** API：給定假 initiator + 表單值 → 純記憶體模擬流程

**Frontend**

- [ ] 退回 / 撤銷 UI
- [ ] Dry Run 介面（在設計器內）

**驗收**：完整流程行為符合預期；模板設計者可 Dry Run 驗證。

---

## M3 — 人本能力（3 週）

### W8 — Delegation + Transfer

**Backend**

- [ ] `delegation_rules` 表
- [ ] `DelegationModule`：規則 CRUD
- [ ] 引擎整合：建立 task 時套用 delegation 解析（含循環防護、CEL scope）
- [ ] Task 轉派（manual transfer）

**Frontend**

- [ ] `/admin/delegations` 代理規則維護
- [ ] 個人代理設定頁（自助）
- [ ] Task 轉派 UI

**驗收**：A 設定代理給 B → 派給 A 的 task 自動派給 B；代理鏈正確紀錄。

### W9 — 通知 + SLA

**Backend**

- [ ] `notifications`、`notification_preferences` 表
- [ ] `NotificationModule`：in-app + email（用 nodemailer 或 SES）+ webhook
- [ ] 通知模板系統（簡單 Handlebars）
- [ ] SLA Scheduler（cron 每分鐘）
  - 預警 / 逾時 / 自動同意 / 升級 / 終止
- [ ] Boundary Timer Event 處理

**Frontend**

- [ ] In-app 通知中心（鈴鐺 + 列表）
- [ ] 通知偏好設定頁
- [ ] Inbox 顯示 SLA due 倒數

**驗收**：派任務有通知、SLA 預警與逾時行為符合預期。

### W10 — 簽章 + 附件

**Backend**

- [ ] `signatures` 表
- [ ] `SignatureModule`：L1 HMAC（含金鑰版本管理 / 輪替支援）
- [ ] RFC 3161 TSA client（可選實作 — 先 mock）
- [ ] 鏈式簽章邏輯（`previous_signature_hash`）
- [ ] Decision API 整合簽章
- [ ] `attachments` 表
- [ ] `AttachmentModule`：上傳 / 下載 / 預覽 signed URL
- [ ] 整合 MinIO / S3
- [ ] 加密儲存

**Frontend**

- [ ] FormRenderer 整合附件上傳
- [ ] PDF 預覽元件（react-pdf）
- [ ] 簽核操作頁顯示附件 + 預覽

**驗收**：每筆決策有簽章紀錄；附件可上傳、PDF 可預覽。

---

## M4 — 管理與優化（2 週）

### W11 — 進階能力 1

**Backend**

- [ ] 加簽 / 減簽 / 跳簽 API
- [ ] 表單欄位節點級權限（依 fieldPermissions 過濾）
- [ ] ABAC 發起權限細化（initiator policy 完整支援）
- [ ] 角色 / 組織代碼目錄查詢 API，並將開始節點發起權限 AutoComplete 改為 server-controlled async

**Frontend**

- [ ] 加簽 / 減簽 / 跳簽 UI
- [ ] FormRenderer 套用欄位權限（visible / editable）

### W12 — 進階能力 2 + Dashboard

**Backend**

- [ ] 統計 API（流程平均耗時、卡關熱點、SLA 達成率）
- [ ] 全文搜尋（pg_trgm 或 tsvector）

**Frontend**

- [ ] `/sent`、`/cc`、`/search` 完整版
- [ ] `/dashboard` — 流程效能、卡關熱點
- [ ] 模板列表頁的「使用情況」統計

**驗收**：管理者可看到流程運作狀態、瓶頸、SLA 達成率。

---

## M5 — 內部試運行（2 週）

- [ ] 整合外部真實 SSO Resolver（取代 mock）
- [ ] 整合真實 Email 服務
- [ ] 整合真實對象儲存
- [ ] 性能測試：模擬 100 個並發 instance
- [ ] 安全檢查：CEL sandbox、檔案上傳、SQL injection、XSS
- [ ] 試運行 2–3 個真實流程（請假、採購、合約）
- [ ] 修正 bug、收斂體驗
- [ ] 寫使用者文件（IT 設計者、一般使用者）

---

## 不在 MVP 範圍（後期）

| 功能                                      | 預估時程                    |
| ----------------------------------------- | --------------------------- |
| Inclusive Gateway                         | 1 週（含 OR Join 死鎖偵測） |
| Sub-Process                               | 2 週                        |
| BPMN XML import / export                  | 1 週                        |
| 多語言 i18n                               | 1 週                        |
| L2 / L3 進階簽章（PKI / 自然人憑證）      | 2 週                        |
| PDF 上視覺化蓋章覆蓋（PAdES）             | 2 週                        |
| 行動端原生 App                            | 6+ 週                       |
| 多租戶改造                                | 2 週                        |
| 流程圖版本 diff 工具                      | 1 週                        |
| 進階表達式編輯器（Monaco + IntelliSense） | 1 週                        |

---

## 風險與緩解

| 風險                   | 緩解                                               |
| ---------------------- | -------------------------------------------------- |
| `cel-js` 成熟度不足    | 早期準備好降版方案：純 TS function-based 條件      |
| AND Join 並發 race     | 提早設計 advisory lock；做壓力測試                 |
| 流程設計器體驗         | 投入時間 / 找專人做 UX，不要把它當小元件           |
| 模板版本暴增           | UI 上區分「已用過 / 未用過」版本，並加歸檔工具     |
| 外部 SSO Resolver 不穩 | 加 cache、加 fallback 用最後一次 metadata snapshot |
| 簽章鏈完整性           | 簽章寫入 transaction 內，並做定期完整性掃描        |

---

## 開發優先序原則

1. **先讓引擎跑通最簡 case**（線性流程） → 再加 Gateway → 再加 SLA → 再加代理
2. **後端模型穩定後再做 UI 優化**（避免 schema 反覆改動）
3. **模板設計器是門面**：M1 W3 投入時間做好，後續每個 milestone 都加值
4. **永遠保有 mock resolver / mock email / mock storage**：方便本機開發與測試

---

## 跨里程碑共通

每個里程碑結束都應該：

- 撰寫該里程碑的整合測試（Playwright e2e + Jest 單元）
- 更新 docs（如本目錄）
- Demo 給內部使用者看一次（避免閉門造車）
