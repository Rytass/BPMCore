# 28 — 宿主深度整合開發 Phase

- **對應 ADR**：[27 — 宿主深度整合能力](./27-host-integration-round-adr.md)
- **基準版本**：0.22.0（`8990d251`）
- **狀態**：P1–P5 完成，P6 進行中
- **交付**：單一 PR（分支 `feat/host-integration-round`），一次發版 `0.23.0`
- **原則**：每個 phase 都是一組 atomic commit，結束時 `typecheck`、`lint`、`test` 全綠才進下一個；`docs/api-reference.md` 在同一個 commit 內同步

## 順序

依「越小、越獨立越前面；會動 `decideTask` 與交易邊界的放後面」排序：

```
P0 docs (ADR 27 / 28)
P1 7 inbox filter, 4c boolean required, 8 data-source default, 5-param snapshot
P2 6 template key, 9 hostManaged, 5 launchMode, migration 32000
P3 3 missing fields as null
P4 1 instance events (outbox), 2 instance guard
P5 4b data-source fill, 4a table per-column fill
P6 docs sweep, /review, release prep
```

## P0 — 文件

- ADR 27、Phase 28、`docs/README.md` 索引。
- **gate**：使用者核可 ADR 27，特別是 §12 標「採建議值」的子題與 F6 的列結構鎖定提案。

## P1 — 小而獨立的四項（完成）

| 項        | 改動                                                                                                                                                                                  | 測試                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 7         | `inboxTasks`／`inboxTaskCount`／`approvalHistoryTasks`／`approvalHistoryTaskCount` 加 `templateIds`、`templateKey`（`templateKey` 在 P2 的欄位上線後接上）；client `list*Page` 加參數 | 篩選後的清單與 count 一致；不給參數時結果與 0.22.0 相同                        |
| 4(c)      | 移除 `approverFilledRequiredBoolean` lint 與矩陣停用；補填 UI 對必填 boolean 帶出畫面值；ADR 20 §3.4 修正                                                                             | 沒碰過的必填開關以 `false` 送出可通過；`undefined` 仍擋                        |
| 8         | validator 放寬（無 `FIELD`／`EXPRESSION` 依賴）；發布 preview 警告；渲染端主動解析預設值；設計器不再清掉預設值                                                                        | 有依賴時仍拒絕；預設值不在選項內時送件回 `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` |
| 5（參數） | `submitApprovalInstance` service 輸入加 `initiatorCustomFields`；與 `initiatorMetadataSnapshotJson` 互斥                                                                              | 合併順序（resolver 之上再疊 host 值）、互斥 400、GraphQL 無法帶入              |

## P2 — 範本層欄位與 migration（完成）

- Migration `0000000032000-host-integration-round`：ADR 27 §10.1 全部，包含 P4 才會用到的 `approval_instance_events` 表，一支 migration 一次建好。
- 6：`key` 欄位、partial unique index、compose 依 key upsert、`approvalTemplateByKey`、`approvalInstances` 系列與 P1 的 `templateKey` 篩選。
- 9：兩張表的 `host_managed`、四個清單查詢預設排除與 `includeHostManaged`、compose 傳遞；GraphQL 欄位 description 依 ADR §9.2 撰寫；前端五處清單維持不帶參數，代理設定頁的既有規則以依 id 查詢顯示名稱。
- 5：`launch_mode`、可發起清單排除、GraphQL 送件與重送 403、設計器的發起設定區加上選項。
- **gate**：
  - migration 的 `up`、`down`、`up` 在本機 Postgres 走一次。
  - 既有 migration spec 全綠。
  - key 唯一性：軟刪除後可重用、未刪除時重複回 409。

## P3 — 未填欄位當 null（完成）

- `expressionMissingFormFieldsAsNull` 選項，三個 context 建立點共用同一個補值函式。
- **測試**（`test-real-engine`）：
  - 每個評估點在開與關時的結果，包含 `has()` 翻轉的對照。
  - 補值不寫回 `form_data`。
- **文件**：05 的對照表、p2-p3 lint 文件矛盾的修正。

## P4 — 生命週期事件與決策前檢查（完成）

兩項都動交易邊界，放在同一個 phase。

- 1：
  - 事件寫入點有 9 個時點、5 個以上的呼叫處。
  - outbox service 依同案件順序認領。
  - subscriber 與排程器比照 webhook delivery。
  - 管理 resolver；保留期清理。
- 2：
  - `BPM_INSTANCE_GUARD` 掛在三條路徑。
  - 逾時 `instanceGuardTimeoutMs`，回 503。
  - `FormDataIssue` 新增 `HOST_RULE` 與 `code`。
  - SLA 自動同意失敗時發 `TASK_AUTO_DECISION_FAILED`。
- **gate**：
  - 回滾的交易不留事件列。
  - host 自帶交易回滾時事件列一併消失。
  - observer 失敗後會重試；達上限標 FAILED，且不阻擋同案件後續事件。
  - 同一案件的事件依序送達，包括兩個副本同時掃描的情況。
  - guard 擋下時交易回滾；逾時回 503 並回滾。
  - SLA 自動同意被擋時任務維持開啟並發事件。
  - 沒有 observer 或 guard 時，行為與 0.22.0 相同。

## P5 — 補填放寬（完成）

- 4(b)：
  - decide 交易內（`WorkflowEngineService` 取得案件 advisory lock、比對 `expectedFormDataFingerprint` 之後）以簽核人身分重新解析補填的資料來源值：整欄補填走 `refreshApproverFilledOptionSnapshots`，逐欄模式的開放格走 `refreshApproverFilledOpenCellSnapshots`（`ROW_FIELD` 取同列值）；兩者的結果寫入 `formDataOptionSnapshot`。值已不在選項內時，經 `answerValueNotResolved` 轉為 400 `formDataErrors`（`VALUE_NOT_RESOLVED`）。
  - lint 放寬。
  - 補填 UI 的資料來源控制項。
- 4(a)：
  - `FieldAccessEntry.columns` 型別與 lint（以 `(fieldKey, columnKey)` 判斷單一補填節點）。
  - 鎖內逐格合併。
  - 列數或列序不一致時回 `FORM_FIELD_ACCESS_TABLE_ROWS_LOCKED`。
  - 設計器矩陣展開各欄；補填 UI 只開放指定欄。
  - 逐欄模式下有資料來源的欄，以 `ROW_FIELD` 取同列值解析。
- **gate**：
  - 補填者竄改非開放欄或增刪列時被拒。
  - 兩個節點各補同一張 table 的不同欄。
  - 補填的資料來源值有選項快照，且顯示名稱正確。
  - 來源欄被補填、依賴欄未開給同一節點：發布被拒（ROW_FIELD 與 EXPRESSION 各測一次）。
  - 兩欄都開給同一節點：decide 時依賴欄以補填後的值重新解析。
  - 舊範本（發布規則上線前）依賴欄未開放而來源欄被改動：decide 回 `FORM_FIELD_ACCESS_DEPENDENT_COLUMN_STALE`。

## P6 — 收尾與發版準備（進行中）

- `docs/api-reference.md` 全面比對新增 export，並更新「Last verified against」。
- [10 — 嵌入式模組](./10-bpm-embedding-auth.md)、[11 — Consumer Quickstart](./11-consumer-quickstart.md) 補上新的 token 與選項。
- 全套驗證：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm e2e:client`。
- 在本機 Postgres 加 worktree 內自起的 api 與 client 做瀏覽器實測：

| 情境                               | 預期                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| 補填必填 boolean，不碰開關直接核准 | 以 `false` 通過                                                    |
| 補填資料來源欄                     | 下拉可選，核准後詳情顯示名稱正確                                   |
| table 逐欄補填                     | 只有指定欄可編輯，不能增刪列                                       |
| 資料來源欄設預設值                 | 新增頁帶入並顯示名稱                                               |
| `hostManaged` 範本                 | 範本管理頁、表單清單、案件篩選、代理選擇器都看不到；依 id 開啟正常 |
| `HOST_ONLY` 範本                   | 發起清單沒有它；GraphQL 送件與重送被拒                             |
| 決策前檢查擋下                     | 畫面顯示 host 的訊息                                               |

- 跑 `/review` 稽核，修到沒有中、高嚴重度問題。
- **發版**（合併與發版另外取得同意）：

```bash
npx nx release 0.23.0 --skip-publish --dry-run < /dev/null
npx nx release 0.23.0 --skip-publish < /dev/null
pnpm nx run-many -t build -p shared,bpm-core,bpm-core-client --skip-nx-cache
npx nx release publish --otp=<6 digits>
```

發版後依 CLAUDE.md 逐一查 registry，確認四個套件都已發布。
