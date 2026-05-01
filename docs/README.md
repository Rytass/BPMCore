# BPM 簽核引擎 — 系統規劃

本目錄收錄系統的功能規劃、設計決策、資料模型與開發路線圖。

## 閱讀順序

| # | 文件 | 內容 |
|---|---|---|
| 01 | [系統概述與設計決策](./01-overview-and-decisions.md) | 系統定位、確認的設計決策、模組劃分 |
| 02 | [領域模型](./02-domain-model.md) | 10 個核心領域的職責 |
| 03 | [BPMN 引擎](./03-bpmn-engine.md) | BPMN 標準完整解釋（Token、Gateway、Event） |
| 04 | [模板版本機制](./04-versioning.md) | 模板與表單的版本管理與回退 |
| 05 | [CEL 條件機制](./05-conditions-cel.md) | CEL 表達式、Context Schema、應用點 |
| 06 | [資料模型 (ER)](./06-data-model.md) | 資料表設計與關聯 |
| 07 | [流程執行細節](./07-workflow-execution.md) | 狀態機、Token 流轉、Resolver、Delegation 解析順序 |
| 08 | [前端工作流 JSON Schema](./08-frontend-schema.md) | React Flow 對應的 WorkflowDefinition |
| 09 | [開發路線圖](./09-roadmap.md) | M1–M4 里程碑與週級任務拆解 |

## Stack

- **Backend**: NestJS + TypeScript + PostgreSQL
- **Frontend**: Next.js + React Flow + TypeScript
- **條件 DSL**: CEL (Common Expression Language)
- **Workflow**: BPMN 2.0 子集（Token-based 引擎）

## 範圍

本系統為 **內部使用** 的 BPM 簽核核心，整合到單一公司現有系統。
不處理 i18n、多租戶、橫向擴展。
