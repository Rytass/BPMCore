---
name: operating-dev-supervisor
description: 操作 BPMCore dev supervisor 控制通道（pnpm dev:ctl）重啟或診斷單一 dev service（api / client）。Use when a dev service needs restart after code changes, a service appears crashed or stuck, reading service logs, or interpreting dev:ctl exit codes and restart failure reasons. Trigger — dev:ctl, restart service, 重啟 service, service 掛了, dev server 沒反應, webpack compiled with errors, Next.js ⨯ 錯誤.
---

# Dev Supervisor 控制通道（`pnpm dev:ctl`）

`scripts/dev-supervisor.mts`（`pnpm dev`）內建一條 Unix domain socket 控制通道（`tmp/dev-supervisor/control.sock`），讓 agent 能在**使用者已自行啟動 `pnpm dev` 的前提下**改完程式碼後自行重啟單一 service，不必中斷使用者、也不必自己起 dev server。

- **邊界不變**：dev server 仍由使用者手動 `pnpm dev` 啟動；agent **不得**自行執行 `pnpm dev`。`dev:ctl` 只是在既有 session 之上重啟其中一個 service，不會、也不能把整套 dev server 起起來。
- **何時該主動用**：`pnpm dev` 已在跑，改完程式碼後發現某個 service（`api` / `client`）需要重啟（例如改了 server 端程式碼、service 疑似掛掉）——**應主動**執行 `pnpm dev:ctl restart <service>`，依 exit code 判斷結果，不要停下來等使用者手動按鍵重啟。

指令（service 名稱固定為 `api` / `client`，對應鍵盤 `a` / `c`）：

| 指令                                             | 用途                          |
| ------------------------------------------------ | ----------------------------- |
| `pnpm dev:ctl ping`                               | 確認 supervisor 是否在跑        |
| `pnpm dev:ctl status [--json]`                    | 列出 api/client 狀態、pid、port |
| `pnpm dev:ctl restart <api\|client\|all>`         | 重啟指定 service（或全部）      |
| `pnpm dev:ctl logs <api\|client> [--lines <n>]`   | 讀取該 service 最近 N 行 log    |

均支援 `--json`（結構化輸出）；`restart` 另支援 `--timeout <ms>`（預設 60000）。

**exit code 契約**（務必依此判斷，不要用文字輸出猜測）：

- `0`：指令成功（restart 代表該 service 已確認就緒）。
- `1`：指令有執行，但結果失敗（restart 後仍 crash 或逾時）——讀回傳的 `logTail` 定位問題，修正程式碼後再 `pnpm dev:ctl restart` 一次。
- `2`：用法錯誤（打錯指令或 service 名稱），檢查拼字。
- `3`：**dev server 根本沒在跑**（socket 不存在，或殘留的 socket 檔已無人監聽）——此時不要重試、也不要自己起 dev server，直接停下來請使用者執行 `pnpm dev`。

**restart 失敗時的三種 `reason`**（exit `1` 時看這個，不要只看 exit code 就重試）：

- `exited`：service process 真的結束了（帶 `exitCode`）——通常是啟動時就掛掉，直接照 `logTail` 修。
- `crashed`：process **還活著**，但輸出比對到已知的 crash pattern（見 `scripts/dev-supervisor.mts` 內 `CRASH_PATTERNS` 註解：`api` 是 webpack build 失敗橫幅（`compiled with N error(s)`，pattern 特別容許橫幅內的 ANSI 色碼，因為錯誤數字本身會被上色）；`client` 是 Next.js 的統一錯誤級別符號 `⨯`（`next dev --turbopack` 不論是編譯錯誤還是 runtime uncaughtException/unhandledRejection 都會印這個符號）——`next dev` 即使壞了也不會關掉 port，所以這是唯一能抓到「port 開著但其實壞了」的訊號）——語意上等同真的失敗，一樣照 `logTail` 修，不要因為 process 沒死就以為只是還沒好。
- `timeout`：逾時前**既沒偵測到 crash、也沒偵測到就緒**——`api`/`client` 都是「port 一直連不上」——常見原因是編譯很慢或真的卡住，**不是**已知的失敗訊號；此時該做的是讀 `logTail` 判斷實際狀況，而不是直接無腦重試。

**`readinessConfidence`**（restart 成功時才有意義）：`'high'` 表示就緒是靠 port 連得上確認的，可信；`'low'` 表示退回到「process 活過 N 毫秒沒死」這個較弱訊號——**目前 `api`/`client` 兩個 service 都設有 port，正常不會落到這條路徑**，只有未來新增無 port 的 service 且忘記設 `readyPattern` 時才會出現。看到 `'low'` 時，`ok:true` 只代表「大概沒事」，不是「已驗證正常」，後續動作若依賴該 service 真的可用，先用 `status` / `logs` 再確認一次。

**典型流程**：改動 server 端程式碼 → `pnpm dev:ctl restart api` → exit `0` 收工；exit `1` 則依 `reason` 讀 `logTail` 找出錯誤再修一次 → 重試；exit `3` 則告知使用者尚未啟動 `pnpm dev`。

**`client` 就緒判定的已知限制**：`client` 的就緒訊號來自 port TCP-probe（見上方 readinessConfidence 說明），只證明 Next.js dev server 已經在監聽該 port，**不代表**正在改的那個頁面能編譯成功——Next.js 會先把 port 開起來，頁面則是 lazy compile（第一次被請求時才編譯），兩者互相獨立。所以 `pnpm dev:ctl restart client` 拿到 `ok:true` 之後，若該頁面本身有編譯錯誤，仍不會被這次 restart 抓到；要嘛靠使用者/瀏覽器實際打開該頁面觸發編譯，要嘛之後再用 `pnpm dev:ctl logs client` 讀 log 找 `CRASH_PATTERNS` 會抓到的 `⨯` 錯誤標記，才能確認該頁面真的沒問題。
