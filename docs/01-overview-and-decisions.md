# 01 — 系統概述與設計決策

## 系統定位

提供使用者一個 **「Form Builder / PDF / 各種附件檔案 作為主體」**，並可自由設定簽核流程與工作的 BPM 引擎。

## Core User Story

> 使用者建立一個簽核模板，設定簽核需要經過哪些人或組織的流程，可以要求該模板要填寫的表單內容（Form Builder）。每一個簽核點可以設定條件（基於組織、人的 metadata、或是填寫內容，類似 ABAC 的機制），可以發起的人、組織的權限。
>
> 有權限的人可以基於這個模板建立一筆簽核，照模板的設定自動通知、簽核並加上數位簽章。

## Core Capabilities

| 能力     | 描述                                                |
| -------- | --------------------------------------------------- |
| 表單建構 | 自訂表單欄位、驗證規則、條件邏輯（IT 主導）         |
| 流程設計 | 拖拉式設計簽核流程（React Flow），含分歧、會簽、SLA |
| 條件路由 | 基於組織、人員 metadata、表單內容的 ABAC 條件       |
| 數位簽章 | 平台簽章（HMAC + RFC 3161 時戳）                    |
| 代理人   | 規則代理 + 即時轉派                                 |
| 附件     | 上傳任意檔案，PDF 可線上預覽                        |

## 角色

| 角色                       | 職責                           |
| -------------------------- | ------------------------------ |
| **System Admin**           | 系統管理（連線設定、外部整合） |
| **Org Admin**              | 組織樹、職位、代理規則         |
| **Template Designer (IT)** | 設計表單與流程模板             |
| **User**                   | 發起簽核、處理待簽             |

## 確認的設計決策

| #   | 議題              | 決定                                         | 理由                                                               |
| --- | ----------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| 1   | 流程模型          | **BPMN 2.0 子集**                            | 語意已被產業驗證；儲存使用自訂 JSON 以對齊 React Flow              |
| 2   | 版本綁定          | 修改 = 新版；可回退；instance 鎖定建立時版本 | 歷史資料一致性                                                     |
| 3   | 條件 DSL          | **CEL**                                      | 可序列化；目前已做 parse/lint/evaluate，靜態型別檢查仍是後續強化項 |
| 4   | 多租戶            | **單租戶**                                   | 內部單公司部署                                                     |
| 5   | 簽章等級          | **L1 — HMAC + RFC 3161 時戳**                | 內部稽核需求即可                                                   |
| 6   | Sub-process       | **MVP 不做**                                 | 引擎複雜度，可後期再加                                             |
| 7   | i18n              | **不處理**                                   | 內部單一語言                                                       |
| 8   | Identity          | **外部 Resolver Pattern**                    | 系統只存 member_id，metadata 由外部 SSO 解析                       |
| 9   | PDF 模式          | 上傳 + 線上預覽                              | 不做 PDF 上視覺化蓋章覆蓋                                          |
| 10  | 流程設計器        | **React Flow**                               | 使用體驗優先                                                       |
| 11  | 規模              | **單機 Postgres + cron**                     | 內部使用，不需橫向擴展                                             |
| 12  | Inclusive Gateway | **不採用**                                   | 用 Parallel + Exclusive 組合替代，避免 OR Join 複雜度              |
| 13  | 表單動態選項      | **宿主註冊的版本化 DataSource Registry**     | 不在 schema 保存 secret/URL；送出時驗證並保存 label snapshot       |

表單動態選項的完整決策與交付 gate 見
[14 — ADR：表單選項 DataSource 架構](./14-form-option-data-source-adr.md)及
[15 — 表單選項 DataSource 開發 Phase](./15-form-option-data-source-phases.md)。

## BPMN 子集

| 元素                    | 採用 | 替代方案                                                       |
| ----------------------- | ---- | -------------------------------------------------------------- |
| Start / End Event       | ✅   | —                                                              |
| User Task               | ✅   | 簽核                                                           |
| Service Task            | ✅   | 目前 runtime 執行 `NOTIFY`；webhook / set-field 為 schema 預留 |
| Exclusive Gateway (XOR) | ✅   | —                                                              |
| Parallel Gateway (AND)  | ✅   | —                                                              |
| Inclusive Gateway (OR)  | ❌   | AND + 各分支內 XOR                                             |
| Boundary Timer Event    | ✅   | SLA 逾時                                                       |
| Sub-Process             | ❌   | 後期再加                                                       |
| Pool / Lane             | ❌   | 由 Approver Resolver 取代                                      |

詳見 [03 — BPMN 引擎](./03-bpmn-engine.md)。

## 後端模組劃分（NestJS）

```
identity/         會員 ID + 外部 Resolver 介面（不存 user 詳細資料）
organization/     OrgUnit / Position / Membership / ManagerResolution
delegation/       代理規則 + 解析
form/             FormDefinition + 版本
template/         ApprovalTemplate + 版本 + 發布/回退
workflow-engine/  Instance / Task / 狀態機 / Token 管理 / Scheduler
condition/        CEL parse / lint / evaluate（Context Schema registry 尚未實作）
signature/        L1 HMAC + RFC 3161
attachment/       附件儲存（預設 local，可替換 storage adapter）
notification/     通知（in-app + email + webhook）
audit/            ActivityLog (append-only)
reporting/        Inbox / Notifications 已實作；Sent / CC / Search / Dashboard 規劃中
```

## 前端結構（Next.js）

```
/                                   工作台與發起簽核入口
/inbox                                我的待簽
/notifications                        通知中心
/templates                            模板列表（IT）
  /templates/compose                  表單 + 流程建立 wizard
  /templates/[id]/designer            流程設計器（React Flow）
  /templates/[id]/versions            版本管理
/instances/new?templateId=xxx         發起新簽核
/instances/[id]                       簽核操作頁
/admin/orgs                           組織管理
/admin/users                          帳號管理（member_id 對照）
/admin/delegations                    代理規則
```

`/sent`、`/cc`、`/search`、`/dashboard` 屬於後續 W12 規劃，尚不是目前 client
實作頁面。

## 不在 MVP 範圍

- Inclusive Gateway
- Sub-Process
- 多語言介面
- 多租戶
- 進階簽章（L2 PKI、L3 自然人憑證）
- BPMN XML 匯入匯出
- PDF 上視覺化蓋章覆蓋
- 行動裝置原生 App
