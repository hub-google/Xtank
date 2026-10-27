# X-TANK ONLINE（X 坦克）

這個 repository 整理約 2000–2002 年 VisualLand《X-TANK ONLINE》的玩法、坦克、武器、地圖、模式與版本資料，目標是讓**完全沒玩過的人也能從零理解這款遊戲怎麼玩**。

> 資料原則：能由當年新聞、保存站或版本資料直接確認的內容，標示為「可確認」；依已知規則整理出的現代化定位、推薦打法與教學，屬於「理解／策略整理」，不是當年官方原文。

## 從哪裡開始？

第一次接觸建議依序閱讀：

1. [新手入門](docs/00_新手入門.md) — 先用 5 分鐘知道一場遊戲在做什麼
2. [核心玩法與操作](docs/01_核心玩法與操作.md) — 移動、瞄準、射擊、換武器與使用道具
3. [坦克類別](docs/02_坦克類別.md) — 原始八種坦克的差異與適合玩家
4. [武器與裝備](docs/03_武器與裝備.md) — 已知武器類型、快捷欄與裝備概念
5. [地圖與場景](docs/04_地圖與場景.md) — 可確認的場景主題、版本地圖集合與資料限制
6. [遊戲模式](docs/05_遊戲模式.md) — Deathmatch、Team Death Match、Capture the Flag
7. [成長與經濟](docs/06_成長與經濟.md) — 經驗、金錢、升級與五項能力
8. [戰鬥策略與搭配](docs/07_戰鬥策略與搭配.md) — 用已知機制推導的新手打法
9. [版本歷史與資料來源](docs/08_版本歷史與資料來源.md) — 版本時間線、可信度與研究邊界
10. [名詞表與 FAQ](docs/09_名詞表與FAQ.md) — 快速查詢與常見問題

## 一句話理解 X-TANK

X-TANK 是一款最多 8 人同場的 3D 第三人稱即時坦克射擊遊戲。玩家選擇性能不同的坦克、購買武器與道具後進入房間戰鬥，透過勝利獲得經驗與金錢，再強化坦克能力與調整裝備，形成「配裝 → 對戰 → 成長 → 再配裝」的循環。

## 原始彙整文件

原本的單一文件 [X-TANK_ONLINE_資料彙整.md](X-TANK_ONLINE_資料彙整.md) 已改為導覽與研究摘要；完整主題內容拆分在 `docs/` 目錄，避免一份文件同時混合玩法、史料、攻略與資料限制。


---

## 連線復刻開發設計（2026-10-22 新增）

本 repo 原 00–09 為 2000–2002 年《X-TANK ONLINE》的歷史研究文件；**以下 10–20 是為將來實作真正多人連線遊戲而制定的規格草案**。已考證、玩家回顧、未查明與新設計的數值均分開標記，切勿將提案當成原版官方設定。

| 文件 | 主題 |
|---|---|
| [10 開發總規格](docs/10_連線復刻開發總規格.md) | 範圍、分期、版本原則 |
| [11 對戰模式與房間](docs/11_對戰模式與房間規則.md) | 3 種模式、勝負、重生、斷線、開房 |
| [12 武器、道具與技能](docs/12_武器道具與技能效果.md) | 歷史名稱候選、P0 傷害、道具和技能效果 |
| [13 地圖藍圖](docs/13_地圖設計與精確藍圖.md) | 地圖規範、書桌座標與另外 2 張圖設計 |
| [14 坦克平衡](docs/14_八種坦克與數值系統.md) | 8 車、2.0 版歷史排名與 P 數值 |
| [15 連線部署](docs/15_網路架構與安全部署.md) | 權威伺服器、同步、反作弊、免費層限制 |
| [16 帳號／商店](docs/16_帳號商店與成長規格.md) | 背包、貨幣、成長與公平競技 |
| [17 畫面／音效](docs/17_畫面美術音效與輸入.md) | UI、HUD、五種鏡頭、素材授權 |
| [18 開發及驗收](docs/18_開發優先序與驗收清單.md) | 待辦與可驗收的完成定義 |
| [19 史料追蹤](docs/19_史料引用版本差異與待查.md) | 當年來源、回顧來源、文獻矛盾與待查項 |
| [20 配置與協定](docs/20_配置資料結構與網路協定.md) | 資料欄位、WebSocket 訊息與一致性 |

**歷史進度備註：此段記錄 2026-10-22 遊戲程式建立前的文件狀態。現在已有可執行的 0.2.0 遊戲原型；最新版進度見本頁底部。仍未有全天候公開多人伺服器。**

重要發現：2002 年同期報導的「12 張地圖」與宣傳所稱的「50 種背景」不是同一個已核實量；舊 README 的單一玩法資料和韓文回顧可能屬不同版本，對照表見 [19](docs/19_史料引用版本差異與待查.md)。


## 第一個單機版本（歷史版本 0.1.0）
這是最初推出的 3D 單機版本（8 種坦克、三種對戰模式、AI、武器及小地圖）。**此段已被下方 0.2.0 版本取代；0.2.0 已加入 LAN 真人連線，但尚無公開雲端伺服器、正式帳號與原版素材。**從 [Build Windows EXE 工作流程](https://github.com/hub-google/Xtank/actions/workflows/windows-exe.yml) 找到成功的執行，在 Artifacts 下載 \`XTANK-Windows-Portable-EXE\` ZIP，解壓後執行 EXE。詳細玩法和已知限制見 [21 試玩說明](docs/21_實作進度與試玩方式.md)。



## 遊戲程式現行版本：0.2.2（待完整正式驗收）

這個儲存庫已由歷史資料整理進入遊戲實作階段。最新 **Windows Portable EXE** 提供巨型書桌 3D 射擊、8 台車、個人／團隊／持旗對戰、7 種武器、6 種道具與 AI，並可讓最多 8 名真人在同一個 **LAN 房間**連線（未滿房由 AI 補位）。房間中的生命、命中、旗戰計分與物理規則由 WebSocket 伺服器運算。

**[下載最新 Windows EXE（請選最新成功的 Actions 執行）](https://github.com/hub-google/Xtank/actions/workflows/windows-exe.yml)**

**[多人連線及 EXE 操作教學](docs/22_多人連線與EXE試玩.md)**

注意：目前**沒有公開 24 小時的線上遊戲伺服器**。跨不同網路的玩家需要自行部署可連線的 WSS 主機；只靠 GitHub Pages 不足以支援持續多人對戰。完整歷史地圖、全部官方武器、正式帳號、商城與經驗成長已有資料庫及玩家介面程式，但尚待完整 Windows EXE 端到端驗收。這不是宣稱已完成全部 X-TANK 復刻。

開發者使用 Node.js 22+：
\`npm install\`、\`npm test\`、\`npm run build\`、\`npm run server\`（獨立伺服器）或 \`npm run desktop\`（Electron）。


### 2026-10-27 修正：三地圖實際可選
最新程式已加入「巨型書桌、棋盤戰場、電路板戰場」三地圖選單，連線房間由主機選定地圖、伺服器統一碰撞物理並同步給所有客戶端。若之前的 EXE 點開始沒有反應，請從最新成功的 Actions Build Windows EXE 重新下載；不要沿用舊壓縮檔。


## 完整產品規格、Supabase 永久資料庫及 EXE 全流程 QA（2026-10-27）

- [27｜3 組已建立並驗證可登入的測試帳號與跨對話使用說明](docs/27_測試帳號與跨對話接續.md)：真實密碼留在 Supabase 私有表，不公開提交至 GitHub。

- [24｜X-TANK 完整遊戲 PRD](docs/24_完整遊戲PRD.md)：從開 EXE、登入、選坦克、機庫、商店、房間、戰鬥、結算、永久成長到退出的完整產品需求及驗收。
- [25｜Supabase 完整資料庫架構](docs/25_Supabase完整資料庫架構.md)：Game 專案文件記錄 `xtank` 共 66 張資料表並開啟 RLS。玩家帳號、商店及社群等介面已存在，仍需正式 EXE 端到端驗收。
- [26｜完整遊戲端到端測試計畫](docs/26_完整遊戲端到端測試計畫.md)：Windows 原生 EXE、多人體驗、登入、經濟、重連、戰績、作弊、效能及逐項證據的完整 QA 契約。
- [Supabase Migration SQL](supabase/migrations/20261027_xtank_62_table_game_schema_v1.sql)；[交易程序](supabase/migrations/20261027_xtank_secure_economy_procedures_v1.sql)；[商店一致性修正與初始商品](supabase/migrations/20261027_xtank_shop_checkout_consistency_v2.sql)。


## 2026-10-27 開發進度同步（依原始碼核查）
目前 package.json 版本 **0.2.2**；舊版 0.2.0 說明為歷史資訊，不是最新發行版。正式完整產品仍未達成。

| 工作流 / 能力 | 本次確認情況 | 正式驗收 |
| --- | --- | --- |
| 8 車、3 模式、3 張地圖、LAN 權威戰鬥 | 程式及測試案例存在 | 尚需最新 Windows EXE 全案例證據 |
| 公開/密碼房、快速配對、READY、房間聊天 | server/host.cjs 與 test/multiplayer.test.js 有實作 | 單元/協定測試存在；非跨網正式驗收 |
| 官方房間 3 秒倒數 | 已修正伺服器實際等待從 2.1 秒為 3.0 秒（commit 71393dc） | 尚待 CI 執行確認 |
| 永久資料 | Supabase 文件記錄 66 張資料表（62 業務表、2 QA、2 帳務表） | 資料庫建立不代表 EXE 全流程已完成 |
| 帳號、機庫、購買與配裝 | 已有模擬後端 GUI 測試及正式介面規格 | 真 Supabase 登入、購買、結算、重登入仍待真實 E2E |
| 官方公網 WSS | 尚無經驗收的 24 小時正式端點 | BLOCKED |
| 社交、公會、賽季、任務、郵件、管理後台 | 已有部分表及規格 | 尚未完整實作與驗收 |

**完成標準**：兩台不同網路上的原生 Windows EXE，實際註冊/登入、選車配裝、購買、加入官方房間、對戰、權威結算、金幣及 XP 唯一入帳、關閉重登入資料一致；再完成社交/營運與安全壓測。未取得對應 Actions 測試證據前不得標記 PASS。

本次變更：`server/host.cjs` 對正式對戰 READY 倒數時間修正；此版本沒有宣稱已完成所有功能或通過實機驗收。避免與其他開發對話並行寫入同一檔案，後續修改須先取得最新檔案 SHA。


### 2026-10-27 多人房間房主斷線恢復修正
- 修復 `server/host.cjs`：當房間最後一名線上玩家（房主）離線，原邏輯將 `hostId` 設為 `null`，其在 30 秒重連期限內用 `RESUME` 回來時，無法恢復房主資格，導致不能按 `START`。現在若原房主席位空缺，會在有效 session 重連時恢復房主權限。
- 新增 `test/multiplayer.test.js` 回歸案例：建房 → 唯一房主離線 → 同 session 恢復 → 確認 `JOINED.host` 與 `LOBBY.hostId` → 第二人加入 → 房主成功開局。
- 程式 commit：`f67a852`；測試 commit：`6262036`。
- **驗收狀態：程式與測試已推送，但本環境無法直接存取 GitHub 原始碼以執行本機整合測試，且未取得最新 Actions PASS；未標記正式驗收完成。**


### 2026-10-27 本輪整合：玩家道具配裝正式接入戰鬥驗證

- `src/account.js` 已加入 F1–F6 六種道具的配裝欄位（第七槽保留），以 `xtank_save_loadout` 持久化武器及道具欄位；僅列出已擁有的道具。
- `server/official.cjs` 現在只允許玩家使用**已登入身份、已選用坦克的有效配裝內**且背包持有的消耗品；不再將全部背包道具自動發進官方對局。
- `test/official-match-e2e.test.cjs` 增加「未裝備的道具即使背包有 9 個仍不能使用」的 WebSocket 正式模式 mock-DB 回歸測試；`scripts/windows-gui-qa.cjs` 增加 Windows EXE 模擬 API 的道具配裝儲存操作。
- 程式提交：[道具配裝 UI](https://github.com/hub-google/Xtank/commit/93ed990f3dd54ae9d835cfc985553b03a8a750b3) / [正式房間配裝驗證](https://github.com/hub-google/Xtank/commit/4021ff69f2d888c8c8b2b9f6ed1447b9c42bc1bc) / [對戰測試](https://github.com/hub-google/Xtank/commit/eb6b03e8f25cba4f2a59f9b5b05718a86184bb26) / [GUI 測試](https://github.com/hub-google/Xtank/commit/516d309c83825e558f6540319e7075f1bdf26051)。
- **本輪 Actions 狀態須以最新 [Windows EXE 工作流程](https://github.com/hub-google/Xtank/actions/workflows/windows-exe.yml) 實際結果為準；提交程式不等於 PASS。** 目前仍未有已驗證全天候公網 WSS，也未取得兩台不同網路原生 EXE 真實全流程證據。



### 2026-10-27 對戰結算與再戰流程可靠性修正

- 正式賽事在 Supabase 獎勵確認前**不能重設房間**；收到 `MATCH_SETTLEMENT_PENDING` 會保持結算畫面，不假裝下一局已準備完成。
- 玩家（包含非房主）在賽事完成且確認入帳後可以要求回到房間；伺服器以 `LOBBY` 確認後客戶端才切換畫面，不會自行預先切換而造成狀態分歧。
- 每局開始重設對應的 `officialMatchId`，避免沿用上一場成功結果解除下一場的入帳鎖。
- 持久化 outbox 即使在最初數次儲存失敗、稍後自動重送成功，也會回報 `MATCH_SAVED`，避免玩家永久卡在「結算等待」。
- 已新增多玩家及 Supabase 模擬故障的自動回歸測試：`test/official-match-e2e.test.cjs`、`test/official-recovery.test.cjs`。
- 本次核心程式提交：`bf9b881`、`a9b0396`、`e8c2f67`、`3fe8b05`、`0c06f31`、`eed5dea`、`3a5e13e`。依 [Windows EXE Actions](https://github.com/hub-google/Xtank/actions/workflows/windows-exe.yml) 的最新成功 Run 判定是否通過單元測試、建置和 scoped GUI；**scoped GUI 不等於完整發行驗收**。

**仍未具備正式版交付證據：** 持續營運的公開 WSS 主機、跨不同網路的兩台 Windows EXE 真實玩家端到端驗收、全部 A–H 情境與長時間安全壓力測試。在完成前版本維持 0.2.2 開發中，不標記正式發行。


### 2026-10-27 斷線與未完成賽事保護（附實際測試）

- 修復 WebSocket 房間清理：最後一位玩家逾時離線時，若權威引擎仍在 `live` 階段，不得直接刪除房間並中斷該局。引擎自然結束後才可清除無人的房間。
- `RESUME` 重新加入現在會檢查伺服器端的 30 秒斷線寬限期；超時 session 不可復活。
- 新增 `test/room-lifecycle.test.js`，涵蓋中途無人離線與過期 session；初次 Windows CI 發現新測試事件時序競態，已於 [e89feb5](https://github.com/hub-google/Xtank/commit/e89feb58510d8aa2d3845a04f30a9c46f9e0a891) 修正。
- 程式碼提交 [ab5dd50](https://github.com/hub-google/Xtank/commit/ab5dd500876cae0b41080f7ca05f0345d8be6801)，測試提交 [a78e500](https://github.com/hub-google/Xtank/commit/a78e5006bfd7f2484f237038d00d8d288f61401b)。**是否通過測試以對應 GitHub Actions 最終結果為準**。
- 尚未完成的交付門檻不變：官方持續公網 WSS 部署、兩台不同網路原生 Windows EXE 完整真人驗收、真實 Supabase 結算與重啟、72 組完整 GUI／耐久性／安全測試。此項修復不代表正式版已完成。


## 2026-10-27 本輪繼續開發：戰鬥時鐘、重連安全與 72 組 Windows GUI

本輪新增與修復以下**實際程式碼**，已直接推送 `main`：

- **正式對戰結算介面**：`src/game.js` 會顯示「官方獎勵入帳中」，直到伺服器發出 `MATCH_SAVED` 才允許返回房間；避免玩家在尚未確認入帳時誤以為已完成。
- **權威伺服器 20Hz 固定時間步**：`server/fixed-step-clock.cjs` 以單調時鐘補算短暫 event-loop 停頓後錯過的 tick，最多一次追趕 5 步，避免跑到無界迴圈；`test/fixed-step-clock.test.cjs` 及多人 socket 測試覆蓋此行為。
- **密碼房安全效能**：`server/host.cjs` 使用非同步 scrypt 驗證加入密碼，另阻擋同一 WebSocket 並行 `JOIN`；其他房間不應因惡意密碼嘗試而卡頓。
- **官方帳號斷線續連**：`src/online.js` 每次 `RESUME` 前向 `xtankAccount` 要求最新 Supabase access token；登入被撤銷時停止重試並顯示重新登入訊息，LAN 遊客仍可不帶 JWT 續連。回歸測試見 `test/online-resume.test.js`。
- **Windows 72 組 GUI QA**：同一份 `.github/workflows/windows-exe.yml` 現在於程式 push 時額外執行 8 車 × 3 模式 × 3 地圖 GUI 測試；手動 `qa_filter=^` 可進行整份 GUI QA。尚需使用各次 Actions 的 `REPORT.md` 區分 PASS、FAIL、BLOCKED，不能因為程式存在便宣稱完整驗收。
- **公網部署藍圖**：新增 `render.yaml`、[正式公網 WSS 部署與交付驗收](docs/28_正式公網部署與交付驗收.md)。已具備 Docker/Render 單一節點、持久化結算 outbox 和 server-only Supabase secret 的部署規格；**尚未在 Render 實際建立或驗收公開服務**。

建置與測試：[Windows EXE Actions](https://github.com/hub-google/Xtank/actions/workflows/windows-exe.yml)。GitHub 原始碼更新與 Windows CI 通過只代表各自的項目通過，**完整正式版仍以真實兩網 Windows EXE、正式 WSS、永久結算、防作弊、長時間測試皆具證據才算完成**。


### 2026-10-27 自訂遊戲鍵位（程式已提交，待最新 Windows EXE QA）

- 主畫面展開「**自訂鍵位（儲存於本機）**」，即可逐一指定前後左右移動、射擊、技能、暫停、7 個武器槽及 6 個道具槽（共 20 個動作），或按「恢復預設鍵位」。
- 快捷鍵使用實體按鍵碼（`KeyboardEvent.code`）而不是字元，重複指定會自動交換兩個動作，避免某個操作變得無法使用。Esc 保留給選單。
- 本機 `localStorage` 保存按鍵設定；目前尚未同步至 Supabase 帳號，換另一台 Windows 裝置需重新設定。
- 新增 `src/controls.js` 與 `test/controls.test.js`，並修改 `src/game.js`、`index.html`、`src/style.css`。程式提交：[c5accb3](https://github.com/hub-google/Xtank/commit/c5accb3e8e7f4e60e6a3c5aa82045022cb158dd0)、[424a677](https://github.com/hub-google/Xtank/commit/424a677095ad4371158d5511a61f91679e31342a)、[a00af46](https://github.com/hub-google/Xtank/commit/a00af4660d6912a3cf877530851e98e353c37e78)、[2521d91](https://github.com/hub-google/Xtank/commit/2521d91a319b683155011b33c3b21d31ddfa0186)。
- 版本仍為開發版；鍵位功能應以**含此 commit 的 GitHub Actions**編譯、單元測試及 Windows 原生 EXE GUI 驗證後，再標記正式完成。


### 2026-10-27 防止並行開發中斷正式 Windows QA

由於多個開發工作持續向 `main` push，原本單一 `cancel-in-progress` 會令所有耗時 Windows GUI 測試在 EXE 打包或 72-case 執行前不斷取消。現在 `.github/workflows/windows-exe.yml` 以 Git 分支 ref 分組，主線仍維持「同分支只跑最新」，並新增固定版本的 [release-validation/20261027-full-gui](https://github.com/hub-google/Xtank/tree/release-validation/20261027-full-gui) 驗收分支。

- [獨立 Windows QA Run #151](https://github.com/hub-google/Xtank/actions/runs/40506020053)：驗收分支將獨立完成 Node、Docker、EXE、72 組 GUI，不因主線持續開發而取消。
- 此分支**不是正式版本標籤或已通過證書**；只能在 GitHub Actions job 成功且逐項證據確認後，標示實際 PASS。


### 開發中：五種自選鏡頭
`feat/five-gameplay-cameras-20261027` 分支增加近距、中距、戰術俯角、低角與第一人稱等五種可循環鏡頭，`C` 可自訂為其他快捷鍵。為避免打斷正在進行的 `main` Windows GUI 矩陣，先在獨立分支開發及確認語法，尚未宣稱已通過 Windows 實測。
