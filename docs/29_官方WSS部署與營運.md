# X-TANK｜官方 WebSocket 伺服器部署（待上線）
> 日期 2026-10-27：程式及 Docker 部署定義已提交 GitHub，但**尚未部署到實際公開的常駐主機**。本文件不是營運上線證明。

## 1. 主機責任與資料路徑
- `XTANK_OFFICIAL_MODE=1` 啟用官方模式；此時所有建立/加入房間都需要 Supabase Auth token 驗證。
- 登入驗證由 `server/official.cjs` 呼叫 `/auth/v1/user` 及限權 `xtank_player_api`，並檢查有無該坦克/合法裝備。
- 權威對局狀態只在 `server/host.cjs` 運算、透過 WebSocket 傳到 EXE；結束時調用 `public.xtank_record_official_match`，用不可重複 round_id 原子保存獎勵。
- 給客戶端的 URL 必須 `wss://game.your-domain.example`，**不可將 service_role 金鑰放到 Electron、GitHub 前端、Docs 或 Actions artifact**。
- 玩家自架 LAN 不開啟 `XTANK_OFFICIAL_MODE`，不會向正式 DB 發獎。

## 2. 開箱與部署
```bash
# 只在可信的 Linux/Windows Docker 主機執行，設定不公開的環境變數：
export SUPABASE_URL="https://<SUPABASE_PROJECT_REF>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<BACKEND_SECRET_FROM_SECURE_STORE>"
docker compose -f compose.official.example.yml up -d --build
curl http://127.0.0.1:8787/health
```

服務預設綁在宿主的 127.0.0.1:8787，不直接對公網公開明文 WebSocket。透過可信的 HTTPS/WSS 反向代理公開到遊戲域名；設定憑證、自動更新與狀態監控。公開反向代理請設定相容的 Upgrade/Connection headers、讀取/保持連線逾時、TCP keepalive。

## 3. EXE 使用方法
1. 在玩家中心以正式玩家登入；不登入時官方模式會拒絕房間建立或加入（`AUTH_FAILED`）。
2. 在「伺服器 WebSocket 網址」填入你的 `wss://` 域名（目前尚無公開官方域名）。
3. 按「快速加入／建立公開房」或「公開房間列表」，或建立密碼房並分享房碼。
4. 官方房間要兩名真正登入玩家且全部按「準備」，房主才可開局。
5. 只可使用伺服器回傳的合法武器列表；更改本地畫面數值、血量或擊殺分數不會讓後端記帳。

## 4. 尚需完成的營運驗收（阻斷上線）
- 取得具備 WebSocket 和固定 TLS 域名的主機，部署並記錄健康檢查與憑證；現階段未完成。
- 兩台不同公網的 Windows EXE，在官方 WSS 實際完成自然結束的對局；資料庫金幣、經驗、裝備、戰績經重啟讀回；現階段未完成。
- 驗證房主離開、任一玩家斷線/重連、多人房 8 人長時間穩定、負載/延遲/封包丟失/故障後重試。
- 已新增 `server/settlement-outbox.cjs`：結算前將合法賽果寫入權限限制的持久資料夾；寫 DB 失敗保留待補送檔案，服務啟動或定時重試，並由 `server_round_id` 保證 DB 防重複。**但仍需在正式主機驗證斷電/重啟的真實資料恢復。**
- 公開房與快速加入採同一台遊戲伺服器的房間邏輯；依使用者指示不開發跨伺服器 MMR 排位佇列。



## 2026-10-28 範圍調整
本專案的正式上線目標僅需一個能持續運作的 WSS 端點，支援不同網路的玩家登入與加入同一遊戲伺服器；不需要全球跨主機 MMR 配對。已移除與跨伺服器票券分配相關的設定與 API。依然需要實際雲端主機、TLS 網域、持久化結算資料夾，才能視為部署完成。
