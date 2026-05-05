# 03 — BPMN 引擎完整解釋

## BPMN 是什麼

**BPMN** = Business Process Model and Notation，由 **OMG (Object Management Group)** 維護的國際標準，現行版本 BPMN 2.0（2011 發布，後收錄為 ISO/IEC 19510）。

它規範了三件事：

1. **圖形符號**：圓 = 事件、矩形 = 活動、菱形 = Gateway
2. **執行語意**：Token 如何在節點間流動
3. **XML 序列化格式**（`.bpmn`）：可在不同引擎間移植

主流引擎：Camunda、Flowable、Activiti、Zeebe — 它們之間流程定義可互通就是因為都遵守 BPMN 2.0。

> 我們**遵循 BPMN 2.0 執行語意**，但儲存使用自訂 JSON（對齊 React Flow），未來可寫 BPMN XML adapter。

---

## 1. 核心概念：Token（令牌）

Token 是 BPMN 執行語意的核心。把它想像成一顆 **沿著流程線移動的小球**。

```
[Start] ──→ [Task A] ──→ [Task B] ──→ [End]
   ●                                    ●
   小球從這裡產生                      小球到這裡消滅 = 流程結束
```

執行規則只有四條：

1. 流程開始時，**Start Event 產生一顆 token**
2. Token 沿著 **Sequence Flow（連線）** 流動
3. 碰到節點 → 停下來執行；節點完成 → token 移到下個節點
4. 碰到 **Gateway（菱形）** → token 可能 **分裂** 成多顆，或 **合併** 回一顆

當所有 token 都走到 End Event（消滅），流程才算結束。

---

## 2. 節點類型（Activity）

| 節點             | 圖形                | 在我們系統的對應                                  |
| ---------------- | ------------------- | ------------------------------------------------- |
| **User Task**    | 圓角矩形 + 人形圖示 | **簽核節點**（需要人決策）                        |
| **Service Task** | 圓角矩形 + 齒輪圖示 | **知會節點 / 系統動作**（發 webhook、加章、發信） |
| **Script Task**  | 圓角矩形 + 紙捲圖示 | 跑表達式（MVP 不用）                              |

每個 task 的規則：token 進來 → 執行任務 → 任務完成 → token 出去到下個節點。

對 User Task 來說，「執行任務」= 等到簽核者按下決策按鈕。

---

## 3. 事件（Event）

| 事件                       | 圖形               | 用途                                      |
| -------------------------- | ------------------ | ----------------------------------------- |
| **Start Event**            | 細圓圈             | 流程起點，產生 token                      |
| **End Event**              | 粗圓圈             | 流程終點，吸收 token                      |
| **Boundary Event (Timer)** | 圓圈附在 task 邊上 | **SLA 逾時觸發**（task 等太久就走另一條） |
| **Intermediate Event**     | 雙圓圈             | 流程中途等待（MVP 可不用）                |

### Boundary Timer Event

BPMN 處理 SLA 的標準做法：

```
              ┌─ [(timer 3天)] ─→ [自動同意]
              │
[Start] ──→ [簽核 Task] ──→ [End]
```

含義：簽核 task 上掛一個 3 天計時器，如果 3 天內沒簽，token 從計時器那條邊跑出去做「自動同意」。

---

## 4. Gateway — 重點

Gateway = 菱形 = 控制 token 怎麼分流或合併。三種類型，差異在 **token 數量怎麼變化**。

### 4.1 Exclusive Gateway（XOR / 互斥）

> 圖形：菱形內含 X
> 語意：if-else

#### 分流（Split）

Token 進來 → 依序檢查每條出邊的條件 → **只走第一個 true 的**

```
            ┌─ [amount > 100萬] ─→ [CFO 簽] ─┐
[填單] ──XOR┤                                XOR──→ [End]
            └─ [其他] ────────→ [部門主管簽] ──┘
```

進去 1 顆 token，出來 1 顆 token。

#### 會合（Join）

**第一個到達的 token 就直接通過，不等別人**（因為本來就只會有一顆會到）。

#### 用途

- 條件分歧（金額大走 A、小走 B）
- if-else 邏輯

---

### 4.2 Parallel Gateway（AND / 平行）

> 圖形：菱形內含 +
> 語意：會簽 — 全部完成
> 設計器 MVP 不提供 Parallel Gateway 工具；會簽用多個 User Task 節點 + 後續節點 `triggerMode: 'AND'` 表達。此節保留作為底層引擎語意與未來擴充參考。

#### 分流（Split）

Token 進來 → **所有出邊都發一顆 token**（不檢查條件）

```
              ┌─ [財務會簽] ─┐
[發起] ──AND──┼─ [法務會簽] ──AND──→ [End]
              └─ [採購會簽] ─┘
```

進去 1 顆，出來 N 顆。

#### 會合（Join）

**等所有入邊的 token 都到齊** 才放行下一顆出去。

進去 N 顆，出來 1 顆。

#### 用途

- 底層平行 token 語意
- 未來進階流程建模
- 多人同時審核同一份文件

---

### 4.3 Inclusive Gateway（OR / 包容）— **不採用**

> 圖形：菱形內含 O
> 語意：條件性多分支

#### 為什麼不採用

OR Join 必須知道「**哪些路徑被啟動**」並只等啟動的路徑，這在含環狀或巢狀分歧的流程中實作極為複雜（Camunda 引擎的 OR Join 是 bug 最多的部分之一）。

#### 替代方案：AND + 各分支內 XOR

```
              ┌─ [需要 CFO?]  ─XOR─┬─ [CFO 簽]  ─┐
              │                    └─ skip ──────┤
[發起] ──AND──┼─ [需要法務?]  ─XOR─┬─ [法務簽]   AND──→ [End]
              │                    └─ skip ──────┤
              └─ [需要風控?]  ─XOR─┴─ [風控簽]  ─┘
```

每個分支自己決定要不要做，但都會走到 AND Join。語意完全等價，且不需要 OR 的特殊邏輯。

---

### 4.4 三種 Gateway 對照

| Gateway             | Split   | Join         | 場景         | 採用 |
| ------------------- | ------- | ------------ | ------------ | ---- |
| **Exclusive (XOR)** | 走 1 條 | 第一個到就走 | if-else      | ✅   |
| **Parallel (AND)**  | 走全部  | 等全部到     | 會簽         | ✅   |
| **Inclusive (OR)**  | 走 N 條 | 等啟動的到齊 | 條件性多分支 | ❌   |

> 設計器 MVP 不把「會簽」藏在單一 User Task 的簽核策略裡。多位簽核者應拆成多個 User Task 節點；後續節點以 `triggerMode: 'AND' | 'OR'` 表示「全部前置完成」或「任一前置完成」。Parallel Gateway 可作為底層流程語意保留，但 UI 優先使用節點拓樸與前置條件呈現。

---

## 5. Sequence Flow（連線）

連線本身可以帶條件（CEL 表達式）：

- 從 XOR 出來的線 → **條件決定走不走**
- 從 AND 出來的線 → **條件被忽略**（一定走）

特殊：**Default Flow（預設邊）**

- 圖示：線上加一條斜槓
- XOR 的所有條件都不滿足時，走 default
- 每個 XOR 應該都要設一條 default 防呆

---

## 6. 死鎖與循環

引擎要防範兩種狀況：

### 死鎖

AND Join 等永遠不會到的 token：

```
[A] ──XOR──┬─→ [B] ──→ AND Join ──→ [End]
           └─→ [C] ─────────────────→ [End]
```

這個流程設計錯了：XOR 只走 B 或 C，但 AND Join 卻在等兩個 token，永遠等不到。

### 死循環

流程繞不出去：

```
[A] ──→ [B] ──→ [A]   ← 沒有 End
```

### 處理方式

- **靜態分析**（模板發布前驗證）：
  - 結構檢查：所有 token 路徑都能走到 End
  - AND Join 配對檢查：每個 AND Join 的入邊都源自同一個 AND Split
  - XOR 的 default flow 檢查
- **執行期保護**：
  - 最大步數上限（例：500 步即視為異常）
  - Token 存活時間上限

---

## 7. MVP 採用清單（重申）

| 元素                     | MVP | 備註                                     |
| ------------------------ | --- | ---------------------------------------- |
| Start / End Event        | ✅  | 必要                                     |
| User Task                | ✅  | 簽核核心；一節點一位主要簽核責任人       |
| Service Task             | ✅  | 知會、系統動作                           |
| Exclusive Gateway        | ✅  | 條件分流；條件設定在線上                 |
| Parallel Gateway         | ❌  | UI 不提供；用多 outgoing + `triggerMode` |
| Inclusive Gateway        | ❌  | 用 XOR + 節點前置條件組合                |
| Boundary Timer Event     | ✅  | SLA 逾時                                 |
| Sub-Process              | ❌  | 後期擴充                                 |
| Pool / Lane              | ❌  | 由 Approver Resolver 取代                |
| Intermediate Catch Event | ❌  | 後期擴充                                 |
| Compensation Event       | ❌  | 後期擴充                                 |

---

## 8. 我們的 Token 引擎（簡述）

詳細實作見 [07 — 流程執行](./07-workflow-execution.md)。

```
┌────────────────────────────────────────────┐
│           ApprovalInstance                 │
│   ┌──────────────────────────────────┐     │
│   │      WorkflowTokens              │     │
│   │   ┌─────┐  ┌─────┐  ┌─────┐      │     │
│   │   │Tok 1│  │Tok 2│  │Tok 3│      │     │
│   │   └──┬──┘  └──┬──┘  └──┬──┘      │     │
│   │      │        │        │         │     │
│   │      ▼        ▼        ▼         │     │
│   │   stays at currently waiting node│     │
│   └──────────────────────────────────┘     │
└────────────────────────────────────────────┘
```

每個 instance 持有多顆 token；每顆 token 標示「目前停在哪個節點」與其狀態（active / waiting / consumed）。

引擎主要操作：

1. **Advance**：把 token 從當前節點移到下個節點（執行 Sequence Flow）
2. **Split**：在 AND Split / XOR Split 處分裂或選擇
3. **Join**：在 AND Join 處合併
4. **Consume**：在 End Event 處消滅
5. **Pause**：在 User Task 處暫停（等待人類決策）
6. **Resume**：簽核者決策後恢復

當 instance 中所有 token 都 consumed → 流程結束。
