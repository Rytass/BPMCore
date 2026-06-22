# BPM 簽核引擎 — 系統規劃

本目錄收錄系統的功能規劃、設計決策、資料模型與開發路線圖。

## 閱讀順序

| #   | 文件                                                     | 內容                                              |
| --- | -------------------------------------------------------- | ------------------------------------------------- |
| 01  | [系統概述與設計決策](./01-overview-and-decisions.md)     | 系統定位、確認的設計決策、模組劃分                |
| 02  | [領域模型](./02-domain-model.md)                         | 10 個核心領域的職責                               |
| 03  | [BPMN 引擎](./03-bpmn-engine.md)                         | BPMN 標準完整解釋（Token、Gateway、Event）        |
| 04  | [模板版本機制](./04-versioning.md)                       | 模板與表單的版本管理與回退                        |
| 05  | [CEL 條件機制](./05-conditions-cel.md)                   | CEL parse/lint/evaluate 現況與後續強化項          |
| 06  | [資料模型 (ER)](./06-data-model.md)                      | 資料表設計與關聯                                  |
| 07  | [流程執行細節](./07-workflow-execution.md)               | 狀態機、Token 流轉、Resolver、Delegation 解析順序 |
| 08  | [前端工作流 JSON Schema](./08-frontend-schema.md)        | React Flow 對應的 WorkflowDefinition              |
| 09  | [開發路線圖](./09-roadmap.md)                            | M1–M4 里程碑與週級任務拆解                        |
| 10  | [BPM 嵌入式模組與 Auth 設計](./10-bpm-embedding-auth.md) | NestJS 宿主整合、Auth contract 與 API host 邊界   |
| 11  | [Consumer Quickstart](./11-consumer-quickstart.md)       | 從零接入三個 npm package 的最短路徑               |
| 12  | [流程設計器 AI 助理](./12-ai-assistant.md)               | LLM 聊天助理的使用、架構、環境變數與部署設定      |
| 13  | [Ad-hoc 臨時指令](./13-adhoc-directives.md)              | 臨時會簽/加簽/階段通知/結案通知的流程與介接方式   |
| ★   | [Public API Reference](./api-reference.md)               | 4 個 lib 套件所有 export 的完整清冊（必維護）     |

## Stack

- **Backend**: NestJS + TypeScript + PostgreSQL
- **Frontend**: Next.js + React Flow + TypeScript
- **條件 DSL**: CEL (Common Expression Language)
- **Workflow**: BPMN 2.0 子集（Token-based 引擎）

## 範圍

本系統為 **內部使用** 的 BPM 簽核核心，整合到單一公司現有系統。
不處理 i18n、多租戶、橫向擴展。
